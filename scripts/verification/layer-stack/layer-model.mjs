import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LAYER_STACK_STRATEGY,
  LayerStack,
} from "../../../src/layer-stack.ts";
import {
  DEFAULT_RASTER_INNER_SHADOW_STYLE,
  DEFAULT_RASTER_OUTER_SHADOW_STYLE,
  copyRasterInnerShadowStyle,
  copyRasterOuterShadowStyle,
} from "../../../src/shadow-core.ts";
import {
  DEFAULT_RASTER_COLOR_OVERLAY_STYLE,
  RASTER_COLOR_OVERLAY_EFFECT_ID,
  RASTER_COLOR_OVERLAY_SCRATCH_BYTES,
  RASTER_COLOR_OVERLAY_STRATEGY,
  compositeRasterColorOverlayPixel,
  copyRasterColorOverlayStyle,
  linearChannelToSrgbColorOverlay,
  normalizeRasterColorOverlayStyle,
  rasterColorOverlayColorFromHex,
  rasterColorOverlayColorToHex,
  rasterColorOverlayStylesEqual,
  srgbChannelToLinearColorOverlay,
} from "../../../src/raster-color-overlay-core.ts";

assert.equal(
  LAYER_STACK_STRATEGY,
  "ordered-records-single-active-single-reference-per-layer-blend-mode-contiguous-raster-clipping-groups-monotonic-ids",
);

// Color Overlay is a pure alpha-preserving style, not another full-canvas
// resource owner. Its CPU oracle and color conversions pin the contract before
// the same equation is embedded into the shared raster-effects compositor.
{
  assert.equal(
    RASTER_COLOR_OVERLAY_STRATEGY,
    "analytic-linear-alpha-preserving-color-overlay-zero-scratch-v1",
  );
  assert.equal(RASTER_COLOR_OVERLAY_EFFECT_ID, "color-overlay");
  assert.equal(RASTER_COLOR_OVERLAY_SCRATCH_BYTES, 0);
  assert.deepEqual(DEFAULT_RASTER_COLOR_OVERLAY_STYLE, {
    enabled: false,
    color: [0, 0, 0],
    opacity: 100,
  });

  const middleGray = rasterColorOverlayColorFromHex(" #808080 ");
  assert.ok(Math.abs(middleGray[0] - 0.21586050011389926) < 1e-15);
  assert.deepEqual(middleGray, [middleGray[0], middleGray[0], middleGray[0]]);
  assert.equal(rasterColorOverlayColorToHex(middleGray), "#808080");
  assert.equal(rasterColorOverlayColorToHex([1, 0, 0.5]), "#ff00bc");
  assert.equal(srgbChannelToLinearColorOverlay(0), 0);
  assert.equal(srgbChannelToLinearColorOverlay(1), 1);
  assert.equal(linearChannelToSrgbColorOverlay(0), 0);
  assert.ok(Math.abs(linearChannelToSrgbColorOverlay(1) - 1) < 1e-15);
  assert.throws(
    () => rasterColorOverlayColorFromHex("#abcd"),
    /HEX della sovrapposizione non valido/,
  );
  assert.throws(
    () => srgbChannelToLinearColorOverlay(Number.NaN),
    /deve essere finito/,
  );

  // Every 8-bit channel survives the sRGB HEX -> linear -> sRGB HEX roundtrip.
  for (let byte = 0; byte <= 255; byte += 1) {
    const encoded = byte.toString(16).padStart(2, "0");
    const hex = `#${encoded}${encoded}${encoded}`;
    assert.equal(rasterColorOverlayColorToHex(
      rasterColorOverlayColorFromHex(hex),
    ), hex);
  }

  assert.deepEqual(normalizeRasterColorOverlayStyle({
    enabled: true,
    color: new Float32Array([-1, 0.25, 2]),
    opacity: 130,
  }), {
    enabled: true,
    color: [0, 0.25, 1],
    opacity: 100,
  });
  assert.deepEqual(normalizeRasterColorOverlayStyle({
    enabled: "true",
    color: "non-un-colore",
    opacity: Number.NaN,
  }), {
    enabled: false,
    color: [0, 0, 0],
    opacity: 100,
  });
  assert.ok(rasterColorOverlayStylesEqual(
    { enabled: false, color: [-2, 0, 0], opacity: 120 },
    DEFAULT_RASTER_COLOR_OVERLAY_STYLE,
  ));
  const copy = copyRasterColorOverlayStyle({
    enabled: true,
    color: "#ff0000",
    opacity: 35,
  });
  assert.deepEqual(copy, { enabled: true, color: [1, 0, 0], opacity: 35 });
  assert.notEqual(copy.color, DEFAULT_RASTER_COLOR_OVERLAY_STYLE.color);

  const base = [0.1, 0.2, 0.3, 0.4];
  assert.deepEqual(
    compositeRasterColorOverlayPixel(base, DEFAULT_RASTER_COLOR_OVERLAY_STYLE),
    base,
  );
  const composed = compositeRasterColorOverlayPixel(base, {
    enabled: true,
    color: [1, 0, 0],
    opacity: 25,
  });
  assert.ok(Math.abs(composed[0] - 0.175) < 1e-15);
  assert.ok(Math.abs(composed[1] - 0.15) < 1e-15);
  assert.ok(Math.abs(composed[2] - 0.225) < 1e-15);
  assert.equal(composed[3], base[3], "Color Overlay non può cambiare alpha");
  assert.deepEqual(compositeRasterColorOverlayPixel([0, 0, 0, 0], {
    enabled: true,
    color: [1, 1, 1],
    opacity: 100,
  }), [0, 0, 0, 0], "un pixel trasparente non può diventare occupato");

  const colorOverlayCoreSource = readFileSync(
    new URL("../../../src/raster-color-overlay-core.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    colorOverlayCoreSource,
    /GPUTexture|GPUBuffer|GPUDevice|GPUQueue|document\.|window\./,
    "il contratto Color Overlay deve restare puro e testabile senza WebGPU/DOM",
  );
}

// Stand-in for the engine's real factory: shape-compatible, and deliberately
// returning a fresh object graph on every call so the tests below can tell
// "the stack asked for new styles" apart from "the stack reused one object".
let styleFactoryCalls = 0;
const createStyles = () => {
  styleFactoryCalls += 1;
  return {
    strokeStyle: { enabled: false, width: 14, position: "outside", color: [1, 0.643, 0.282, 1] },
    bevelStyle: { enabled: false, mode: "inner", technique: "smooth", size: 32, soften: 4 },
    outerShadowStyle: copyRasterOuterShadowStyle(DEFAULT_RASTER_OUTER_SHADOW_STYLE),
    innerShadowStyle: copyRasterInnerShadowStyle(DEFAULT_RASTER_INNER_SHADOW_STYLE),
    colorOverlayStyle: copyRasterColorOverlayStyle(DEFAULT_RASTER_COLOR_OVERLAY_STYLE),
  };
};
const newStack = () => new LayerStack(createStyles);

// A document always has exactly one layer to begin with, and it is selected.
{
  const stack = newStack();
  assert.equal(stack.count, 1);
  assert.equal(stack.activeIndex, 0);
  assert.equal(stack.active.id, 1);
  assert.equal(stack.active.visible, true);
  assert.equal(stack.active.opacity, 1);
  assert.equal(stack.active.blendMode, "normal");
  assert.equal(stack.active.hasContent, false);
  assert.equal(stack.active.contentBounds, null);
  assert.deepEqual(
    stack.active.colorOverlayStyle,
    DEFAULT_RASTER_COLOR_OVERLAY_STYLE,
  );
  assert.deepEqual(stack.below(), []);
  assert.deepEqual(stack.above(), []);
}

// A clipping mask is still a normal raster record. Multiple upper rasters can
// share one base parent. Parent identity is stable across valid reorder, a
// parent always stays below its clips and clipping chains are impossible.
{
  const stack = newStack();
  const parentId = stack.active.id;
  const first = stack.add("Clip 1");
  assert.equal(stack.setClippingParent(first, parentId), true);
  const second = stack.add("Clip 2");
  assert.equal(stack.setClippingParent(second, parentId), true);
  const firstId = stack.at(first).id;
  const secondId = stack.at(second).id;
  assert.equal(stack.clippingParent(stack.at(first))?.id, parentId);
  assert.deepEqual(
    stack.clippingDependents(parentId).map((record) => record.id),
    [firstId, secondId],
  );
  assert.deepEqual(
    stack.clippingUnit(parentId).map((record) => record.id),
    [parentId, firstId, secondId],
  );
  assert.deepEqual(
    stack.clippingUnit(firstId).map((record) => record.id),
    [parentId, firstId, secondId],
    "un figlio risolve la stessa unità atomica del proprio parent",
  );
  assert.equal(stack.move(second, first), true);
  assert.deepEqual(
    stack.clippingDependents(parentId).map((record) => record.id),
    [secondId, firstId],
    "riordinare due ritagli conserva il parent stabile per id",
  );
  assert.throws(
    () => stack.move(0, 2),
    /deve restare sotto/,
    "il parent non può essere spostato sopra i propri ritagli",
  );
  assert.deepEqual(
    stack.layers.map((record) => record.id),
    [parentId, secondId, firstId],
    "un riordino non valido deve essere atomico",
  );
  assert.throws(
    () => stack.move(1, 0),
    /deve restare sotto/,
    "un ritaglio non può essere spostato sotto il parent",
  );
  assert.throws(
    () => stack.setClippingParent(0, stack.at(first).id),
    /parent deve essere un livello raster base/i,
  );
  assert.throws(
    () => stack.setClippingParent(0, 999),
    /assente/,
  );
}

// Parent and children are one consecutive raster-order unit. An unrelated
// raster cannot be inserted or attached inside it, and a failed attempt must
// leave order, selection and the monotonic next id unchanged.
{
  const stack = newStack();
  const parentId = stack.active.id;
  const first = stack.add("Clip 1");
  stack.setClippingParent(first, parentId);
  const second = stack.add("Clip 2");
  stack.setClippingParent(second, parentId);
  const groupIds = stack.layers.map((record) => record.id);
  const activeId = stack.active.id;

  assert.throws(
    () => stack.insertAt(1, "Intruso"),
    /gruppo di ritaglio.*consecutivo/i,
  );
  assert.deepEqual(stack.layers.map((record) => record.id), groupIds);
  assert.equal(stack.active.id, activeId);

  const detachedOrdinary = { ...newStack().active, id: 999 };
  assert.throws(
    () => stack.attach(detachedOrdinary, 2),
    /gruppo di ritaglio.*consecutivo/i,
  );
  assert.deepEqual(stack.layers.map((record) => record.id), groupIds);
  assert.equal(stack.active.id, activeId);

  stack.setActiveIndex(0);
  const third = stack.add("Clip 3");
  assert.equal(third, 3, "Add dal parent inserisce sopra l'intera unità");
  assert.equal(stack.setClippingParent(third, parentId), true);
  const expandedGroupIds = [...groupIds, stack.active.id];
  assert.deepEqual(
    stack.clippingUnit(parentId).map((record) => record.id),
    expandedGroupIds,
    "il record appena aggiunto può diventare atomicamente il nuovo figlio superiore",
  );

  stack.setActiveIndex(1);
  const outside = stack.add("Fuori gruppo");
  assert.equal(outside, 4, "Add da un figlio inserisce sopra l'intera unità");
  assert.deepEqual(
    stack.layers.map((record) => record.id),
    [...expandedGroupIds, stack.active.id],
  );
  assert.deepEqual(
    stack.clippingUnit(stack.active).map((record) => record.id),
    [stack.active.id],
    "un raster ordinario resta un'unità di un solo elemento",
  );
}

// Attaching a child across an unrelated raster and moving any record so that
// it splits a group are rejected against a candidate copy, never half-applied.
{
  const stack = newStack();
  const parentId = stack.active.id;
  const unrelated = stack.add("Estraneo");
  const child = stack.add("Figlio candidato");
  const childId = stack.at(child).id;
  assert.throws(
    () => stack.setClippingParent(child, parentId),
    /gruppo di ritaglio.*consecutivo/i,
  );
  assert.equal(stack.at(child).clippingParentId, null);
  assert.deepEqual(stack.layers.map((record) => record.id), [parentId, 2, childId]);

  stack.move(unrelated, child);
  assert.equal(stack.setClippingParent(1, parentId), true);
  const validOrder = stack.layers.map((record) => record.id);
  const validActiveId = stack.active.id;
  assert.throws(
    () => stack.move(2, 1),
    /gruppo di ritaglio.*consecutivo/i,
  );
  assert.deepEqual(stack.layers.map((record) => record.id), validOrder);
  assert.equal(stack.active.id, validActiveId);
}

// The inverse chain is just as invalid: a base that already owns clipping
// dependents cannot later become a clipping layer itself.
{
  const stack = newStack();
  const lowerBaseId = stack.active.id;
  const upperBase = stack.add("Base superiore");
  const upperBaseId = stack.at(upperBase).id;
  const clip = stack.add("Ritaglio superiore");
  stack.setClippingParent(clip, upperBaseId);
  assert.throws(
    () => stack.setClippingParent(upperBase, lowerBaseId),
    /ritagli collegati/,
  );
  assert.equal(stack.at(upperBase).clippingParentId, null);
}

// The row-level toggle works on rasters that already exist. Consecutive
// enabled rows resolve the same nearest base, so one parent can own any number
// of clipping masks without allocating special layer records.
{
  const stack = newStack();
  const parentId = stack.active.id;
  const first = stack.add("Esistente 1");
  const firstId = stack.at(first).id;
  const second = stack.add("Esistente 2");
  const secondId = stack.at(second).id;
  assert.equal(stack.setClippingEnabled(first, true), true);
  assert.equal(stack.setClippingEnabled(second, true), true);
  assert.equal(stack.setClippingEnabled(second, true), false, "toggle idempotente");
  assert.deepEqual(
    stack.clippingUnit(parentId).map((record) => record.id),
    [parentId, firstId, secondId],
  );
  assert.deepEqual(
    stack.layers.map((record) => record.clippingParentId),
    [null, parentId, parentId],
  );
}

// Disabling a middle mask splits the group at that row: the row becomes the
// nearest base for all masks above. Enabling it again merges the two adjacent
// units exactly, including a base that already owns children.
{
  const stack = newStack();
  const baseId = stack.active.id;
  const first = stack.add("Clip 1");
  stack.setClippingEnabled(first, true);
  const second = stack.add("Clip 2");
  stack.setClippingEnabled(second, true);
  const third = stack.add("Clip 3");
  stack.setClippingEnabled(third, true);
  const firstId = stack.at(first).id;
  const secondId = stack.at(second).id;
  const thirdId = stack.at(third).id;

  assert.equal(stack.setClippingEnabled(second, false), true);
  assert.deepEqual(
    stack.layers.map((record) => record.clippingParentId),
    [null, baseId, null, secondId],
  );
  assert.deepEqual(
    stack.clippingUnit(baseId).map((record) => record.id),
    [baseId, firstId],
  );
  assert.deepEqual(
    stack.clippingUnit(secondId).map((record) => record.id),
    [secondId, thirdId],
  );

  assert.equal(stack.setClippingEnabled(second, true), true);
  assert.deepEqual(
    stack.layers.map((record) => record.clippingParentId),
    [null, baseId, baseId, baseId],
    "riattivare il toggle deve ricostruire esattamente il gruppo unico",
  );
  assert.throws(
    () => stack.setClippingEnabled(0, true),
    /livello raster immediatamente sotto/i,
  );
  assert.deepEqual(
    stack.layers.map((record) => record.clippingParentId),
    [null, baseId, baseId, baseId],
    "un toggle non valido deve lasciare intatti tutti i parent id",
  );
}

// History restores the complete graph by stable id in one atomic publication.
// A transient per-row restore would reject the same valid before/after pair.
{
  const stack = newStack();
  const baseId = stack.active.id;
  const first = stack.add("Clip storico 1");
  stack.setClippingEnabled(first, true);
  const second = stack.add("Clip storico 2");
  stack.setClippingEnabled(second, true);
  const joined = stack.captureClippingHistoryState();
  stack.setClippingEnabled(first, false);
  const split = stack.captureClippingHistoryState();
  assert.deepEqual(
    stack.layers.map((record) => record.clippingParentId),
    [null, null, stack.at(first).id],
  );
  assert.equal(stack.restoreClippingHistoryState(joined), true);
  assert.deepEqual(
    stack.layers.map((record) => record.clippingParentId),
    [null, baseId, baseId],
  );
  assert.equal(stack.restoreClippingHistoryState(split), true);
  const future = stack.add("Raster aggiunto dopo la storia");
  const futureId = stack.at(future).id;
  assert.equal(stack.restoreClippingHistoryState(joined), true);
  assert.deepEqual(
    stack.layers.map((record) => [record.id, record.clippingParentId]),
    [
      [baseId, null],
      [stack.at(first).id, baseId],
      [stack.at(second).id, baseId],
      [futureId, null],
    ],
    "Undo metadata deve preservare i raster aggiunti dopo lo snapshot",
  );
  const beforeInvalid = stack.captureClippingHistoryState();
  assert.throws(
    () => stack.restoreClippingHistoryState([
      ...beforeInvalid.slice(0, 2),
      { layerId: stack.at(second).id, parentId: 999 },
    ]),
    /assente/,
  );
  assert.deepEqual(stack.captureClippingHistoryState(), beforeInvalid);
}

// A future clipping child can make an old partial graph impossible. The gate
// must refuse it without mutating the live graph instead of publishing a chain.
{
  const stack = newStack();
  const baseId = stack.active.id;
  const child = stack.add("Base futura");
  stack.setClippingEnabled(child, true);
  const oldJoined = stack.captureClippingHistoryState();
  stack.setClippingEnabled(child, false);
  const futureChild = stack.add("Clip futuro");
  stack.setClippingEnabled(futureChild, true);
  const live = stack.captureClippingHistoryState();
  assert.equal(stack.isClippingHistoryStateApplicable(oldJoined), false);
  assert.throws(() => stack.restoreClippingHistoryState(oldJoined), /parent.*base/i);
  assert.deepEqual(stack.captureClippingHistoryState(), live);
  assert.equal(stack.byId(baseId)?.clippingParentId, null);
}

// Removing a base detaches all of its children instead of leaving dangling ids.
// Removing a child retains its parent id on the detached history record, and an
// exact valid reattach restores that relationship.
{
  const stack = newStack();
  const parentId = stack.active.id;
  const first = stack.add("Clip 1");
  stack.setClippingParent(first, parentId);
  const detachedChild = stack.remove(first);
  assert.equal(detachedChild.clippingParentId, parentId);
  assert.equal(stack.attach(detachedChild, 1), 1);
  assert.equal(stack.clippingParent(detachedChild)?.id, parentId);

  const second = stack.add("Clip 2");
  stack.setClippingParent(second, parentId);
  const removedParent = stack.remove(0);
  assert.equal(removedParent.id, parentId);
  assert.deepEqual(
    stack.layers.map((record) => record.clippingParentId),
    [null, null],
    "i figli del parent eliminato diventano raster ordinari",
  );
  assert.deepEqual(stack.clippingDependents(parentId), []);
}

// Structural-history attach validates the stored explicit id and the vertical
// order before mutating the live stack. It cannot publish a dangling or
// inverted relationship.
{
  const stack = newStack();
  const parentId = stack.active.id;
  const childIndex = stack.add("Clip storico");
  stack.setClippingParent(childIndex, parentId);
  const child = stack.remove(childIndex);
  assert.throws(
    () => stack.attach(child, 0),
    /deve restare sotto/,
  );
  assert.equal(stack.count, 1, "attach fallito non deve mutare lo stack");
  const missingParent = { ...child, id: 999, clippingParentId: 998 };
  assert.throws(
    () => stack.attach(missingParent, 1),
    /assente/,
  );
  assert.equal(stack.count, 1);
}

// Reference is a document-wide identity, never a per-row combination: setting
// another raster moves the flag, reorder preserves it and removal clears it.
{
  const stack = newStack();
  assert.equal(stack.referenceLayerId, null);
  assert.equal(stack.reference, null);
  assert.equal(stack.setReferenceIndex(0), true);
  assert.equal(stack.setReferenceIndex(0), false);
  assert.equal(stack.reference, stack.at(0));
  const second = stack.add();
  assert.equal(stack.setReferenceIndex(second), true);
  const referenceId = stack.referenceLayerId;
  stack.move(second, 0);
  assert.equal(stack.referenceLayerId, referenceId);
  assert.equal(stack.reference?.id, referenceId);
  const referenceIndex = stack.indexOfId(referenceId);
  stack.remove(referenceIndex);
  assert.equal(stack.referenceLayerId, null);
  assert.equal(stack.reference, null);
  assert.throws(() => stack.setReferenceIndex(99), /fuori intervallo/);
}

// add() inserts ABOVE the active layer and selects the new one.
{
  const stack = newStack();
  const index = stack.add();
  assert.equal(index, 1);
  assert.equal(stack.count, 2);
  assert.equal(stack.activeIndex, 1);
  assert.equal(stack.active.id, 2);
  // Inserting while a middle layer is selected must not append to the top.
  stack.setActiveIndex(0);
  const middle = stack.add();
  assert.equal(middle, 1);
  assert.deepEqual(stack.layers.map((l) => l.id), [1, 3, 2]);
  assert.equal(stack.activeIndex, 1);
}

// Structural history needs exact-position insertion and identity-preserving
// reattachment of the detached raster record.
{
  const stack = newStack();
  const insertedIndex = stack.insertAt(0, "Raster vettore");
  assert.equal(insertedIndex, 0);
  assert.deepEqual(stack.layers.map((layer) => layer.id), [2, 1]);
  assert.equal(stack.active.id, 2);

  const detached = stack.remove(0);
  assert.equal(detached.id, 2);
  const attachedIndex = stack.attach(detached, 1);
  assert.equal(attachedIndex, 1);
  assert.equal(stack.at(attachedIndex), detached, "il record storico va riusato, non clonato");
  assert.equal(stack.active, detached);
  assert.deepEqual(stack.layers.map((layer) => layer.id), [1, 2]);
  assert.throws(
    () => stack.attach(detached, 0),
    /già presente/,
    "lo stesso record non può essere collegato due volte",
  );
  assert.throws(() => stack.insertAt(-1), /fuori intervallo/);
  assert.throws(() => stack.insertAt(stack.count + 1), /fuori intervallo/);
}

// THE aliasing invariant: two records must never share one style object, or
// editing the bevel on one layer would silently change it on another. This is
// the whole point of per-layer effect state.
{
  const stack = newStack();
  stack.add();
  const [first, second] = stack.layers;
  assert.notEqual(first.strokeStyle, second.strokeStyle);
  assert.notEqual(first.bevelStyle, second.bevelStyle);
  assert.notEqual(first.outerShadowStyle, second.outerShadowStyle);
  assert.notEqual(first.innerShadowStyle, second.innerShadowStyle);
  assert.notEqual(first.colorOverlayStyle, second.colorOverlayStyle);
  assert.notEqual(first.outerShadowStyle.color, second.outerShadowStyle.color);
  assert.notEqual(first.innerShadowStyle.color, second.innerShadowStyle.color);
  assert.notEqual(first.strokeStyle.color, second.strokeStyle.color);
  assert.notEqual(first.colorOverlayStyle.color, second.colorOverlayStyle.color);
  first.bevelStyle.size = 47;
  first.strokeStyle.width = 93;
  first.strokeStyle.color[0] = 0.125;
  first.outerShadowStyle.size = 61;
  first.innerShadowStyle.choke = 42;
  first.colorOverlayStyle.color[1] = 0.75;
  assert.notEqual(second.bevelStyle.size, 47, "bevelStyle è aliasato fra livelli");
  assert.notEqual(second.strokeStyle.width, 93, "strokeStyle è aliasato fra livelli");
  assert.notEqual(
    second.strokeStyle.color[0],
    0.125,
    "il colore Traccia è aliasato fra livelli",
  );
  assert.notEqual(
    second.outerShadowStyle.size,
    61,
    "outerShadowStyle è aliasato fra livelli",
  );
  assert.notEqual(
    second.innerShadowStyle.choke,
    42,
    "innerShadowStyle è aliasato fra livelli",
  );
  assert.notEqual(
    second.colorOverlayStyle.color[1],
    0.75,
    "il colore Color Overlay è aliasato fra livelli",
  );
  // And neither may alias the frozen defaults.
  assert.doesNotThrow(() => { second.bevelStyle.size = 3; });
}

// The factory must be invoked once per record. Asserting only "the objects
// differ" would still pass if the stack called the factory once and deep-cloned
// the result, which would silently drop any per-layer default the engine wants
// to vary later.
{
  const before = styleFactoryCalls;
  const stack = newStack();
  assert.equal(styleFactoryCalls - before, 1, "il livello iniziale deve chiedere i propri stili");
  stack.add();
  stack.add();
  assert.equal(styleFactoryCalls - before, 3, "ogni livello aggiunto deve chiedere i propri stili");
  stack.remove(2);
  assert.equal(styleFactoryCalls - before, 3, "eliminare un livello non deve creare stili");
}

// Removing the active layer selects the one below; the last one cannot go.
{
  const stack = newStack();
  stack.add();
  stack.add();
  assert.equal(stack.activeIndex, 2);
  const removed = stack.remove(2);
  assert.equal(removed.id, 3);
  assert.equal(stack.count, 2);
  assert.equal(stack.activeIndex, 1);
  // Removing below the active index shifts the selection with it.
  stack.setActiveIndex(1);
  stack.remove(0);
  assert.equal(stack.activeIndex, 0);
  assert.equal(stack.active.id, 2);
  assert.throws(() => stack.remove(0), /ultimo livello/);
}

// ids are monotonic and never reused, so GPU resources keyed by id cannot be
// handed to a different layer after a delete.
{
  const stack = newStack();
  stack.add();
  stack.remove(1);
  const index = stack.add();
  assert.equal(stack.at(index).id, 3);
  assert.equal(stack.byId(2), null);
  assert.equal(stack.byId(3)?.id, 3);
  assert.equal(stack.indexOfId(99), -1);
}

// Selection changes report whether anything actually moved: the engine uses the
// boolean to decide whether to pay for a switch.
{
  const stack = newStack();
  stack.add();
  assert.equal(stack.setActiveIndex(1), false);
  assert.equal(stack.setActiveIndex(0), true);
  assert.throws(() => stack.setActiveIndex(7), /fuori intervallo/);
  assert.throws(() => stack.at(-1), /fuori intervallo/);
}

// Reorder keeps the same RECORD selected, not the same slot.
{
  const stack = newStack();
  stack.add();
  stack.add();
  stack.setActiveIndex(0);
  const activeId = stack.active.id;
  assert.equal(stack.move(0, 2), true);
  assert.deepEqual(stack.layers.map((l) => l.id), [2, 3, 1]);
  assert.equal(stack.active.id, activeId);
  assert.equal(stack.activeIndex, 2);
  assert.equal(stack.move(2, 2), false);
  assert.throws(() => stack.move(0, 9), /fuori intervallo/);
}

// below()/above() partition the stack around the active index, bottom-up.
{
  const stack = newStack();
  stack.add();
  stack.add();
  stack.setActiveIndex(1);
  assert.deepEqual(stack.layers.map((l) => l.id), [1, 2, 3]);
  assert.deepEqual(stack.below().map((l) => l.id), [1]);
  assert.deepEqual(stack.above().map((l) => l.id), [3]);
  assert.equal(stack.below().length + stack.above().length + 1, stack.count);
}
