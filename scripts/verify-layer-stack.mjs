import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readEngineSource } from "./engine-source.mjs";

// Il motore è diviso in più moduli concatenati: un marcatore di fine che non
// esiste più fa tornare -1 a indexOf, e `slice(start, -1)` allargherebbe la
// finestra a quasi tutto il sorgente, rendendo vera per caso ogni asserzione
// di ordine e falsa per caso ogni asserzione negativa. Ogni sezione va chiusa.
const SECTION_MAXIMUM_BYTES = 60_000;
const assertSection = (label, start, end) => {
  assert.ok(start >= 0, `sezione ${label}: marcatore iniziale assente`);
  assert.ok(end > start, `sezione ${label}: marcatore finale assente o precedente all'inizio`);
  assert.ok(
    end - start <= SECTION_MAXIMUM_BYTES,
    `sezione ${label}: ${end - start} byte, oltre il limite di ${SECTION_MAXIMUM_BYTES}`
    + " — il marcatore è disallineato e l'asserzione non verificherebbe più nulla",
  );
};
import {
  LAYER_STACK_MAXIMUM,
  LAYER_STACK_STRATEGY,
  LayerStack,
  layerEffectRendererRequirements,
} from "../src/layer-stack.ts";
import {
  activeLayerBlendModeCanUseLiveComposition,
  effectsRetargetCallerForHistoryReplay,
} from "../src/engine-layer-resources.ts";
import { runGpuAllocationTransaction } from "../src/gpu-allocation-transaction.ts";
import {
  MOBILE_TOOLS_SHEET_CLOSE_FLICK_MIN_DISTANCE_PX,
  MOBILE_TOOLS_SHEET_CLOSE_FLICK_MIN_VELOCITY_PX_PER_MS,
  MOBILE_TOOLS_SHEET_CLOSE_FROM_PEEK_DISTANCE_PX,
  MOBILE_TOOLS_SHEET_CLOSE_PAST_PEEK_DISTANCE_PX,
  shouldCloseMobileToolsSheetDrag,
} from "../src/mobile-tools-sheet-gesture.ts";
import {
  MOBILE_SEMANTIC_LAYER_THUMBNAIL_STRATEGY,
  MOBILE_SEMANTIC_LAYER_THUMBNAIL_SIZE,
  MOBILE_SEMANTIC_THUMBNAIL_MAXIMUM_COMMANDS,
  mobileSemanticLayerThumbnailSignature,
} from "../src/mobile-semantic-layer-thumbnail.ts";
import {
  layerThumbnailDimensions,
} from "../src/layer-thumbnail-geometry.ts";
import {
  BoundedMobileRasterThumbnailCache,
  MOBILE_RASTER_THUMBNAIL_CACHE_GENERATIONS,
  MOBILE_RASTER_THUMBNAIL_CACHE_MAXIMUM,
  MOBILE_RASTER_THUMBNAIL_CACHE_MAXIMUM_BYTES,
  MOBILE_RASTER_THUMBNAIL_EDGE_PX,
  MOBILE_RASTER_THUMBNAIL_RGBA_BYTES,
} from "../src/mobile-raster-thumbnail-cache.ts";
import {
  DEFAULT_RASTER_INNER_SHADOW_STYLE,
  DEFAULT_RASTER_OUTER_SHADOW_STYLE,
  copyRasterInnerShadowStyle,
  copyRasterOuterShadowStyle,
} from "../src/shadow-core.ts";
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
} from "../src/raster-color-overlay-core.ts";
import {
  LAYER_STORAGE_GRID_SIZE,
  LAYER_STORAGE_MASK_WORD_COUNT,
  LAYER_STORAGE_STRATEGY,
  LAYER_STORAGE_TILE_COUNT,
  alignedBoundsTileCount,
  clearLayerStorageTileMask,
  compareLayerStorageMasks,
  countLayerStorageTiles,
  createLayerStorageTileMask,
  exactLayerStorageTileMask,
  layerStorageTileMemoryMiB,
  markLayerStorageRect,
  layerStorageTileIndices,
} from "../src/layer-storage-study.ts";

assert.equal(
  LAYER_STACK_STRATEGY,
  "ordered-records-single-active-single-reference-per-layer-blend-mode-contiguous-raster-clipping-groups-monotonic-ids",
);

// An active advanced mode is a live presentation parameter: cycling it must
// not wait for or rebuild any derived raster surface. Crossing the boundary
// where the first/last advanced layer appears still takes the transactional
// allocation/rebuild path. An inactive raster always stays conservative.
assert.equal(
  activeLayerBlendModeCanUseLiveComposition(7, 7, "multiply", "screen", false),
  true,
);
assert.equal(
  activeLayerBlendModeCanUseLiveComposition(7, 7, "normal", "multiply", false),
  false,
);
assert.equal(
  activeLayerBlendModeCanUseLiveComposition(7, 7, "multiply", "normal", false),
  false,
);
assert.equal(
  activeLayerBlendModeCanUseLiveComposition(7, 7, "normal", "multiply", true),
  true,
);
assert.equal(
  activeLayerBlendModeCanUseLiveComposition(8, 7, "multiply", "screen", false),
  false,
);

// Color Overlay is an analytic style, not another full-canvas resource owner.
// Its CPU oracle pins both alpha modes before the same equations are embedded
// into the shared raster-effects compositor.
{
  assert.equal(
    RASTER_COLOR_OVERLAY_STRATEGY,
    "analytic-linear-selectable-source-or-uniform-alpha-color-overlay-zero-scratch-v2",
  );
  assert.equal(RASTER_COLOR_OVERLAY_EFFECT_ID, "color-overlay");
  assert.equal(RASTER_COLOR_OVERLAY_SCRATCH_BYTES, 0);
  assert.deepEqual(DEFAULT_RASTER_COLOR_OVERLAY_STYLE, {
    enabled: false,
    color: [0, 0, 0],
    uniformAlpha: false,
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
    /Invalid Color Overlay HEX color/,
  );
  assert.throws(
    () => srgbChannelToLinearColorOverlay(Number.NaN),
    /must be finite/,
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
    uniformAlpha: false,
    opacity: 100,
  });
  assert.deepEqual(normalizeRasterColorOverlayStyle({
    enabled: "true",
    color: "non-un-colore",
    opacity: Number.NaN,
  }), {
    enabled: false,
    color: [0, 0, 0],
    uniformAlpha: false,
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
  assert.deepEqual(copy, {
    enabled: true,
    color: [1, 0, 0],
    uniformAlpha: false,
    opacity: 35,
  });
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
  assert.deepEqual(compositeRasterColorOverlayPixel(base, {
    enabled: true,
    color: [0.25, 0.5, 1],
    uniformAlpha: true,
    opacity: 75,
  }), [0.1875, 0.375, 0.75, 0.75],
  "uniform alpha deve sostituire ogni alpha positivo con Opacity");
  assert.deepEqual(compositeRasterColorOverlayPixel(base, {
    enabled: true,
    color: [1, 1, 1],
    uniformAlpha: true,
    opacity: 0,
  }), [0, 0, 0, 0],
  "uniform alpha 0% deve nascondere i pixel occupati, non disattivare l'effetto");
  assert.deepEqual(compositeRasterColorOverlayPixel([0, 0, 0, 0], {
    enabled: true,
    color: [1, 1, 1],
    opacity: 100,
  }), [0, 0, 0, 0], "un pixel trasparente non può diventare occupato");

  const colorOverlayCoreSource = readFileSync(
    new URL("../src/raster-color-overlay-core.ts", import.meta.url),
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
    /must remain below/,
    "il parent non può essere spostato sopra i propri ritagli",
  );
  assert.deepEqual(
    stack.layers.map((record) => record.id),
    [parentId, secondId, firstId],
    "un riordino non valido deve essere atomico",
  );
  assert.throws(
    () => stack.move(1, 0),
    /must remain below/,
    "un ritaglio non può essere spostato sotto il parent",
  );
  assert.throws(
    () => stack.setClippingParent(0, stack.at(first).id),
    /parent must be a base raster layer/i,
  );
  assert.throws(
    () => stack.setClippingParent(0, 999),
    /missing/,
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
    /clipping group.*contiguous/i,
  );
  assert.deepEqual(stack.layers.map((record) => record.id), groupIds);
  assert.equal(stack.active.id, activeId);

  const detachedOrdinary = { ...newStack().active, id: 999 };
  assert.throws(
    () => stack.attach(detachedOrdinary, 2),
    /clipping group.*contiguous/i,
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
    /clipping group.*contiguous/i,
  );
  assert.equal(stack.at(child).clippingParentId, null);
  assert.deepEqual(stack.layers.map((record) => record.id), [parentId, 2, childId]);

  stack.move(unrelated, child);
  assert.equal(stack.setClippingParent(1, parentId), true);
  const validOrder = stack.layers.map((record) => record.id);
  const validActiveId = stack.active.id;
  assert.throws(
    () => stack.move(2, 1),
    /clipping group.*contiguous/i,
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
    /linked clipping masks/,
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
    /raster layer immediately below/i,
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
    /missing/,
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
    /must remain below/,
  );
  assert.equal(stack.count, 1, "attach fallito non deve mutare lo stack");
  const missingParent = { ...child, id: 999, clippingParentId: 998 };
  assert.throws(
    () => stack.attach(missingParent, 1),
    /missing/,
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
  assert.throws(() => stack.setReferenceIndex(99), /out of range/);
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
    /already present/,
    "lo stesso record non può essere collegato due volte",
  );
  assert.throws(() => stack.insertAt(-1), /out of range/);
  assert.throws(() => stack.insertAt(stack.count + 1), /out of range/);
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
  assert.throws(() => stack.remove(0), /last layer/);
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
  assert.throws(() => stack.setActiveIndex(7), /out of range/);
  assert.throws(() => stack.at(-1), /out of range/);
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
  assert.throws(() => stack.move(0, 9), /out of range/);
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

// The cap is enforced. Only the authoritative mip 0 scales per layer
// (64 MiB RGBA8 / 128 MiB RGBA16F); display pyramids are shared.
{
  const stack = newStack();
  while (stack.count < LAYER_STACK_MAXIMUM) {
    stack.add();
  }
  assert.equal(stack.count, LAYER_STACK_MAXIMUM);
  assert.throws(() => stack.add(), /Maximum/);
}

// Fill Reference adds at most one second full canvas; every other inactive
// layer remains a deterministic 256² tile array.
assert.equal(
  LAYER_STORAGE_STRATEGY,
  "single-active-plus-optional-reference-full-inactive-256-array-tiles-direct-native-fold-fallback-rehydrate",
);
assert.equal(LAYER_STORAGE_GRID_SIZE, 16);
assert.equal(LAYER_STORAGE_TILE_COUNT, 256);
assert.equal(LAYER_STORAGE_MASK_WORD_COUNT * Uint32Array.BYTES_PER_ELEMENT, 32);

// Every record owns a fresh mask. Sharing one would make painting on B mark A.
{
  const stack = newStack();
  stack.add();
  assert.notEqual(stack.at(0).storageTileMask, stack.at(1).storageTileMask);
  assert.equal(countLayerStorageTiles(stack.at(0).storageTileMask), 0);
  assert.equal(countLayerStorageTiles(stack.at(1).storageTileMask), 0);
  markLayerStorageRect(stack.at(0).storageTileMask, {
    x: 32,
    y: 48,
    width: 8,
    height: 12,
  });
  assert.equal(countLayerStorageTiles(stack.at(0).storageTileMask), 1);
  assert.equal(countLayerStorageTiles(stack.at(1).storageTileMask), 0);
}

// A rect straddling both 256-pixel seams touches exactly four tiles. Clamping a
// document-sized rect must cover all 256 without writing outside the bitset.
{
  const mask = createLayerStorageTileMask();
  markLayerStorageRect(mask, { x: 255, y: 255, width: 2, height: 2 });
  assert.equal(countLayerStorageTiles(mask), 4);
  clearLayerStorageTileMask(mask);
  markLayerStorageRect(mask, { x: -50, y: -80, width: 5000, height: 5000 });
  assert.equal(countLayerStorageTiles(mask), LAYER_STORAGE_TILE_COUNT);
  clearLayerStorageTileMask(mask);
  assert.equal(countLayerStorageTiles(mask), 0);
}

// Sparse corners demonstrate the storage win: two occupied
// pages versus a full-document aligned bbox.
{
  const mask = createLayerStorageTileMask();
  markLayerStorageRect(mask, { x: 0, y: 0, width: 1, height: 1 });
  markLayerStorageRect(mask, { x: 4095, y: 4095, width: 1, height: 1 });
  assert.equal(countLayerStorageTiles(mask), 2);
  assert.equal(
    alignedBoundsTileCount({ x: 0, y: 0, width: 4096, height: 4096 }),
    256,
  );
  assert.equal(layerStorageTileMemoryMiB(1, 4), 0.25);
  assert.equal(layerStorageTileMemoryMiB(1, 8), 0.5);
  assert.equal(layerStorageTileMemoryMiB(256, 4), 64);
  assert.equal(layerStorageTileMemoryMiB(256, 8), 128);
}

// Array slices must be deterministic because hydration uses the same ordered
// list to map each slice back to its document tile.
{
  const mask = createLayerStorageTileMask();
  markLayerStorageRect(mask, { x: 4095, y: 4095, width: 1, height: 1 });
  markLayerStorageRect(mask, { x: 0, y: 256, width: 1, height: 1 });
  markLayerStorageRect(mask, { x: 3840, y: 0, width: 1, height: 1 });
  markLayerStorageRect(mask, { x: 0, y: 0, width: 1, height: 1 });
  assert.deepEqual(layerStorageTileIndices(mask), [0, 15, 16, 255]);
}
// Exact occupancy means any non-zero raw byte, not alpha. This preserves a
// future or malformed transparent-RGB texel byte-for-byte.
{
  const pixels = new Uint8Array(512 * 512 * 4);
  pixels[0] = 17; // RGB non-zero, alpha remains zero.
  pixels[(300 * 512 + 300) * 4 + 3] = 255;
  const exact = exactLayerStorageTileMask(pixels, 512, 512, 4);
  assert.equal(countLayerStorageTiles(exact), 2);

  const conservative = createLayerStorageTileMask();
  markLayerStorageRect(conservative, { x: 0, y: 0, width: 1, height: 1 });
  markLayerStorageRect(conservative, { x: 300, y: 300, width: 1, height: 1 });
  assert.deepEqual(compareLayerStorageMasks(exact, conservative), {
    missedReferenceTiles: 0,
    extraCandidateTiles: 0,
  });

  const underMarked = createLayerStorageTileMask();
  markLayerStorageRect(underMarked, { x: 0, y: 0, width: 1, height: 1 });
  assert.equal(compareLayerStorageMasks(exact, underMarked).missedReferenceTiles, 1);
}

// RGBA16F is scanned as raw bytes too: a non-zero high half in the second word
// of a texel must still keep the tile.
{
  const pixels = new Uint8Array(256 * 256 * 8);
  pixels[7] = 0x80;
  assert.equal(
    countLayerStorageTiles(exactLayerStorageTileMask(pixels, 256, 256, 8)),
    1,
  );
}

// Deterministic differential fuzz: every non-zero texel chosen inside a dirty
// rect must be covered by the conservative mask. Over-marking is allowed.
{
  let state = 0x12345678;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
  const pixels = new Uint8Array(512 * 512 * 4);
  const conservative = createLayerStorageTileMask();
  for (let index = 0; index < 128; index += 1) {
    const x = Math.floor(random() * 500);
    const y = Math.floor(random() * 500);
    const width = 1 + Math.floor(random() * (512 - x));
    const height = 1 + Math.floor(random() * (512 - y));
    markLayerStorageRect(conservative, { x, y, width, height });
    const pixelX = x + Math.floor(random() * width);
    const pixelY = y + Math.floor(random() * height);
    pixels[(pixelY * 512 + pixelX) * 4] = 1;
  }
  const exact = exactLayerStorageTileMask(pixels, 512, 512, 4);
  assert.equal(compareLayerStorageMasks(exact, conservative).missedReferenceTiles, 0);
}

assert.throws(
  () => exactLayerStorageTileMask(new Uint8Array(3), 1, 1, 4),
  /Invalid readback/,
);

{
  const stack = newStack();
  assert.equal(stack.anyHasContent(), false);
  stack.add();
  stack.at(0).hasContent = true;
  assert.equal(stack.anyHasContent(), true);
}

// Smusso is displayed by the shared RasterStrokeRenderer even when Traccia is
// disabled. This is the lifecycle case that previously returned with the
// Smusso checkbox checked but no composed effect after another layer released
// the renderers.
{
  assert.deepEqual(
    layerEffectRendererRequirements(
      { enabled: false, width: 14 },
      { enabled: true },
    ),
    {
      needsStrokeRenderer: true,
      needsBevelRenderer: true,
      needsOuterShadowRenderer: false,
      needsInnerShadowRenderer: false,
      needsColorOverlayRenderer: false,
      colorOverlayScratchBytes: 0,
      strokeWidth: 14,
    },
  );
  assert.equal(
    layerEffectRendererRequirements(
      { enabled: false, width: 14 },
      { enabled: false },
    ).needsStrokeRenderer,
    false,
  );
  assert.equal(
    layerEffectRendererRequirements(
      { enabled: true, width: 512 },
      { enabled: false },
    ).needsStrokeRenderer,
    true,
  );
  assert.deepEqual(
    layerEffectRendererRequirements(
      { enabled: false, width: 14 },
      { enabled: false },
      { enabled: true },
      { enabled: false },
    ),
    {
      needsStrokeRenderer: true,
      needsBevelRenderer: false,
      needsOuterShadowRenderer: true,
      needsInnerShadowRenderer: false,
      needsColorOverlayRenderer: false,
      colorOverlayScratchBytes: 0,
      strokeWidth: 14,
    },
  );
  assert.equal(
    layerEffectRendererRequirements(
      { enabled: false, width: 14 },
      { enabled: false },
      { enabled: false },
      { enabled: true },
    ).needsInnerShadowRenderer,
    true,
  );
  assert.deepEqual(
    layerEffectRendererRequirements(
      { enabled: false, width: 14 },
      { enabled: false },
      { enabled: false },
      { enabled: false },
      { enabled: true, opacity: 65 },
    ),
    {
      needsStrokeRenderer: true,
      needsBevelRenderer: false,
      needsOuterShadowRenderer: false,
      needsInnerShadowRenderer: false,
      needsColorOverlayRenderer: true,
      colorOverlayScratchBytes: 0,
      strokeWidth: 14,
    },
  );
  assert.equal(
    layerEffectRendererRequirements(
      { enabled: false, width: 14 },
      { enabled: false },
      { enabled: false },
      { enabled: false },
      { enabled: true, opacity: 0 },
    ).needsStrokeRenderer,
    false,
    "opacity zero non deve trattenere il compositore condiviso",
  );
  assert.equal(
    layerEffectRendererRequirements(
      { enabled: false, width: 14 },
      { enabled: false },
      { enabled: false },
      { enabled: false },
      { enabled: true, opacity: 0, uniformAlpha: true },
    ).needsStrokeRenderer,
    true,
    "uniform alpha 0% deve trattenere il compositore perché rende trasparenti i pixel occupati",
  );
}

// WebGPU reports texture OOM asynchronously when error scopes are popped. The
// allocation transaction must destroy a candidate even when its factory
// returned normally, and must leave a successful candidate alive.
{
  const pushed = [];
  const errors = [null, { message: "OOM simulato" }];
  const host = {
    pushErrorScope(filter) {
      pushed.push(filter);
    },
    async popErrorScope() {
      return errors.shift() ?? null;
    },
  };
  let destroyed = false;
  await assert.rejects(
    runGpuAllocationTransaction(host, "Texture test", (transaction) => {
      transaction.deferRollback(() => { destroyed = true; });
      return { candidate: true };
    }),
    /Texture test: OOM simulato/,
  );
  assert.deepEqual(pushed, ["out-of-memory", "validation"]);
  assert.equal(errors.length, 0, "entrambi gli error scope devono essere chiusi");
  assert.equal(destroyed, true, "il candidato OOM deve essere distrutto");
}

{
  const host = {
    pushErrorScope() {},
    async popErrorScope() { return null; },
  };
  let destroyed = false;
  const candidate = await runGpuAllocationTransaction(
    host,
    "Texture valida",
    (transaction) => {
      transaction.deferRollback(() => { destroyed = true; });
      return { candidate: true };
    },
  );
  assert.deepEqual(candidate, { candidate: true });
  assert.equal(destroyed, false, "il commit non deve distruggere il candidato valido");
}

// The pixel probe is what makes multi-layer claims falsifiable: correctness
// cannot be read off the screen, because the display shows one composite and a
// dropped submit leaves the previous image in place. Guard it against silent
// removal, and against losing its dev gate.
const engineSource = readEngineSource();
const layerThumbnailSource = readFileSync(
  new URL("../src/layer-thumbnail-renderer.ts", import.meta.url),
  "utf8",
);
const layerThumbnailControllerSource = readFileSync(
  new URL("../src/layer-thumbnail-controller.ts", import.meta.url),
  "utf8",
);
const layerPanelSource = readFileSync(
  new URL("../src/layer-panel-controller.ts", import.meta.url),
  "utf8",
);
const layerThumbnailGeometrySource = readFileSync(
  new URL("../src/layer-thumbnail-geometry.ts", import.meta.url),
  "utf8",
);
const mobileSemanticThumbnailSource = readFileSync(
  new URL("../src/mobile-semantic-layer-thumbnail.ts", import.meta.url),
  "utf8",
);
const clippingGroupShaderSource = readFileSync(
  new URL("../src/clipping-group-shader.ts", import.meta.url),
  "utf8",
);
const layerBlendTileRuntimeSource = readFileSync(
  new URL("../src/engine-layer-blend-tile-runtime.ts", import.meta.url),
  "utf8",
);
const strokeRendererBlendSource = readFileSync(
  new URL("../src/stroke-renderer.ts", import.meta.url),
  "utf8",
);
const mixedSceneStackSource = readFileSync(
  new URL("../src/mixed-scene-stack.ts", import.meta.url),
  "utf8",
);
const historyReplayPlanSource = readFileSync(
  new URL("../src/history-replay-plan.ts", import.meta.url),
  "utf8",
);
const compositionSegmentsStart = mixedSceneStackSource.indexOf("  compositionSegments(");
const compositionSegmentsReturn = mixedSceneStackSource.indexOf(
  "    return segments;",
  compositionSegmentsStart,
);
const compositionSegmentsEnd = compositionSegmentsReturn < 0
  ? -1
  : compositionSegmentsReturn + "    return segments;".length;
assertSection(
  "segmentazione scena mista",
  compositionSegmentsStart,
  compositionSegmentsEnd,
);
const compositionSegmentsBody = mixedSceneStackSource.slice(
  compositionSegmentsStart,
  compositionSegmentsEnd,
);
assert.match(
  compositionSegmentsBody,
  /const vector = item\.kind === "text"\s*\? this\.textById\(item\.textNodeId\)\s*: this\.svgById\(item\.svgNodeId\)/,
  "la segmentazione deve consultare lo stato vivo sia del testo sia dell'SVG",
);
assert.match(
  compositionSegmentsBody,
  /if \(!vector\.visible \|\| vector\.opacity <= 0\) \{\s*continue;\s*\}[\s\S]*?flushRasterRun\(\);\s*textRun\.push\(item\)/,
  "testo e SVG invisibili o trasparenti devono essere ignorati prima di spezzare le run",
);
assert.match(
  engineSource,
  /async readLayerPixels\(rect\?: DirtyRect, layerIndex\?: number\): Promise<Uint8Array>/,
);
assert.match(
  engineSource,
  /rasterClippingParentId: record\.clippingParentId/,
  "lo snapshot pubblico deve serializzare l'id stabile del parent, mai un indice di stack",
);
assert.match(
  engineSource,
  /rasterClippingParentId: number \| null/,
  "lo snapshot distingue esplicitamente un raster ordinario da un ritaglio",
);
// Reading a NAMED layer is what makes the test bilateral: "A kept its pixels
// while B was rebuilt" needs both records. Cold records are rehydrated only for
// the probe and the temporary full texture must be released in finally.
const probeStart = engineSource.indexOf("async readLayerPixels(");
const probeBody = engineSource.slice(probeStart, probeStart + 2_600);
assert.match(probeBody, /import\.meta\.env\.DEV/, "la sonda deve restare solo-dev");
assert.match(probeBody, /const record = layerIndex === undefined/);
assert.match(probeBody, /if \(gpu\.hot\)/);
assert.match(probeBody, /await createHydratedLayerTexture\(this,/);
assert.match(
  probeBody,
  /finally \{\s*destroyTransientLayerHydration\(this, hydration\);/,
  "la sonda cold deve sempre rilasciare la reidratazione full-canvas",
);
const textureProbeStart = engineSource.indexOf("async readTexturePixels(");
const textureProbeBody = engineSource.slice(textureProbeStart, textureProbeStart + 3_000);
assert.match(textureProbeBody, /copyTextureToBuffer/);
assert.match(textureProbeBody, /\{ texture: target, mipLevel, origin:/,
  "la sonda deve inoltrare esplicitamente il mip richiesto");
assert.match(textureProbeBody, /Math\.ceil\(unpaddedBytesPerRow \/ 256\) \* 256/,
  "bytesPerRow deve restare allineato a 256");
assert.match(
  textureProbeBody,
  /destroyTrackedReadbackBuffer\(this, readbackBuffer, readbackBytes\)/,
  "la sonda deve rilasciare il buffer attraverso la contabilità dev",
);
const destroyReadbackStart = engineSource.indexOf("export function destroyTrackedReadbackBuffer(");
const destroyReadbackBody = engineSource.slice(destroyReadbackStart, destroyReadbackStart + 500);
assert.match(destroyReadbackBody, /buffer\.destroy\(\)/, "il rilascio tracciato deve distruggere il buffer");
assert.match(destroyReadbackBody, /engine\.devReadbackActiveBytes -= size/,
  "il rilascio tracciato deve azzerare la residenza temporanea");

// Steps 12–14: analytic bakes are transactional, transient and bounded by the
// conservative union of every active effect's final-pixel domain. A successful
// rebuild folds them into at most two persistent surfaces, then releases every
// per-layer bake. Raw inactive layers own no mip chain.
assert.match(engineSource, /LAYER_BAKE_STRATEGY =\s*\n\s*"transient-analytic-bounded-visual-rect-no-handoff-residency-mip0-fused-into-two-merged-surfaces"/);
assert.match(
  engineSource,
  /LAYER_COMPOSITE_STRATEGY =\s*\n\s*"merged-above-over-isolated-active-clipping-group-over-merged-below-source-atop-live-prefix-suffix-compose-before-filter-parent-opacity-once-direct-authoritative-cold-tiles-normal-no-effects-deferred-to-fold-fence-bounded-visual-rect"/,
);
assert.ok(
  (engineSource.match(/layerBakeStrategy: LAYER_BAKE_STRATEGY/g) ?? []).length >= 2,
  "stats e benchmark devono firmare la strategia dei bake",
);
assert.ok(
  (engineSource.match(/layerCompositeStrategy: LAYER_COMPOSITE_STRATEGY/g) ?? []).length >= 2,
  "stats e benchmark devono firmare la strategia di compositing",
);
const clippingToggleStart = engineSource.indexOf("export async function setLayerClipping(");
const clippingToggleEnd = engineSource.indexOf(
  "export async function setLayerPresentation(",
  clippingToggleStart,
);
assertSection("toggle maschera raster", clippingToggleStart, clippingToggleEnd);
const clippingToggleBody = engineSource.slice(clippingToggleStart, clippingToggleEnd);
assert.match(clippingToggleBody, /await engine\.waitForIdle\(\)/);
assert.match(clippingToggleBody, /engine\.layerStack\.setClippingEnabled\(index, enabled\)/);
assert.match(clippingToggleBody, /await engine\.rebuildMergedLayerSurfaces\(\)/,
  "il toggle deve ricostruire gruppo attivo e lati fusi dalla relazione nuova");
assert.match(
  clippingToggleBody,
  /engine\.layerStack\.setClippingEnabled\(index, previousEnabled\)[\s\S]*?await engine\.rebuildMergedLayerSurfaces\("layer-switch"\)/,
  "un errore GPU deve ripristinare relazione e compositi precedenti",
);
assert.match(clippingToggleBody, /publishMixedScene\(engine\)/,
  "la UI mista deve ricevere subito i nuovi parent id");
const layerBlendStart = engineSource.indexOf("export async function setLayerBlendMode(");
const layerBlendEnd = engineSource.indexOf(
  "export function resolveFillSource(",
  layerBlendStart,
);
assertSection("fusione livello raster", layerBlendStart, layerBlendEnd);
const layerBlendBody = engineSource.slice(layerBlendStart, layerBlendEnd);
assert.equal(effectsRetargetCallerForHistoryReplay(false), "layer-switch");
assert.equal(effectsRetargetCallerForHistoryReplay(true), "history-replay");
assert.match(layerBlendBody, /isLayerBlendMode\(blendMode\)/,
  "l'API non deve accettare codici WGSL o stringhe arbitrarie");
assert.match(layerBlendBody, /const previousBlendMode = record\.blendMode/);
assert.match(layerBlendBody, /record\.blendMode = blendMode/);
const liveBlendStart = layerBlendBody.indexOf("if (liveActiveComposition)");
const slowBlendStart = layerBlendBody.indexOf("await engine.waitForIdle()", liveBlendStart);
assertSection("fusione attiva live", liveBlendStart, slowBlendStart);
const liveBlendBody = layerBlendBody.slice(liveBlendStart, slowBlendStart);
assert.match(liveBlendBody, /record\.blendMode = blendMode/);
assert.doesNotMatch(liveBlendBody, /waitForIdle|rebuildMergedLayerSurfaces/,
  "advanced→advanced sul raster attivo deve limitarsi ai metadata e al prossimo frame");
assert.match(
  engineSource,
  /displayUniformUpload\[16\][\s\S]{0,300}LAYER_BLEND_MODE_CODES\[this\.layerStack\.active\.blendMode\]/,
  "il clipping child attivo deve leggere il mode vivo dai display uniforms",
);
assert.match(
  layerBlendTileRuntimeSource,
  /activeRecord\.blendMode[\s\S]{0,1800}activeOperandMode = parent\.blendMode/,
  "il tile compositor deve leggere live sia il child attivo sia il parent attivo",
);
const activeClippingBuildStart = engineSource.indexOf(
  "export async function buildActiveClippingGroupResources(",
);
const activeClippingBuildEnd = engineSource.indexOf(
  "export function destroyActiveClippingGroupResources(",
  activeClippingBuildStart,
);
assertSection(
  "costruzione clipping attivo",
  activeClippingBuildStart,
  activeClippingBuildEnd,
);
const activeClippingBuildBody = engineSource.slice(
  activeClippingBuildStart,
  activeClippingBuildEnd,
);
assert.match(activeClippingBuildBody, /unit\.slice\(1, activeIndex\)/);
assert.match(activeClippingBuildBody, /unit\.slice\(activeIndex \+ 1\)/,
  "prefix e suffix clipping non devono fotografare il mode del raster attivo");
const slowBlendPublish = layerBlendBody.indexOf(
  "record.blendMode = blendMode",
  slowBlendStart,
);
assert.ok(
  layerBlendBody.indexOf("prewarmMixedSceneLinearTextureForLayerBlend(")
    < slowBlendPublish,
  "il path che cambia topologia deve validare cache, ping-pong e tile prima dei metadata",
);
assert.match(
  layerBlendBody,
  /const visibleSemantics = Boolean\(engine\.mixedSceneStack\?\.visibleSemanticCount\)[\s\S]*?candidateNeedsTile = candidateAdvanced && !visibleSemantics[\s\S]*?candidateNeedsViewportBlend = candidateAdvanced && visibleSemantics/,
  "il prewarm deve allocare soltanto la famiglia realmente usata dalla scena candidata",
);
assert.match(
  layerBlendBody,
  /const rebuildCaller = effectsRetargetCallerForHistoryReplay\(historyReplay\)/,
  "Undo/Redo della fusione deve propagare l'esenzione della transazione History",
);
assert.equal(
  (layerBlendBody.match(/rebuildMergedLayerSurfaces\(\s*rebuildCaller,/g) ?? []).length,
  2,
  "sia il compositing sia il rollback della fusione devono usare lo stesso caller",
);
assert.equal(
  (layerBlendBody.match(/reuseUnchangedRasterRuns: true/g) ?? []).length,
  2,
  "il path lento e il rollback devono conservare i raster-run non coinvolti",
);
assert.match(
  layerBlendBody,
  /record\.blendMode = previousBlendMode;[\s\S]*?await engine\.rebuildMergedLayerSurfaces\(\s*rebuildCaller,/,
  "un errore GPU deve ripristinare metadata e superfici precedenti",
);
assert.match(
  layerBlendBody,
  /const combined = new Error\([\s\S]*?latchDocumentStateInconsistent\([\s\S]*?combined/,
  "un doppio fallimento deve conservare l'errore completo nel rapporto diagnostico",
);
assert.match(
  engineSource,
  /async setLayerBlendMode\(index: number, blendMode: LayerBlendMode\): Promise<boolean>[\s\S]{0,1200}kind: "layer-blend-mode"[\s\S]{0,300}before,[\s\S]{0,200}after: blendMode/,
  "una scelta riuscita deve produrre una sola azione before/after",
);
assert.match(
  engineSource,
  /export async function prewarmMixedSceneLinearTextureForLayerBlend\([\s\S]*?runGpuAllocationTransaction\([\s\S]*?oldTexture\?\.destroy\(\)/,
  "il prewarm viewport deve pubblicare il candidato solo dopo i due error scope",
);
assert.match(
  layerBlendTileRuntimeSource,
  /runGpuAllocationTransaction\([\s\S]*?Stroke renderer for the layer-blend compositor[\s\S]*?deferRollback\(\(\) => releaseRasterStrokeRenderer\(engine, true\)\)/,
  "anche l'attach finale del renderer Traccia deve restare transazionale",
);
assert.match(
  strokeRendererBlendSource,
  /const BAKE_PARAMETER_CAPACITY = 32;[\s\S]*?bakeParameterBuffer[\s\S]*?Stroke isolated tile-bake parameters/,
  "i bake tile devono usare un ring GPU separato dai dispatch live Traccia",
);
assert.match(
  strokeRendererBlendSource,
  /encodeBake\([\s\S]*?deferParameterUpload[\s\S]*?this\.bakeParameterBuffer[\s\S]*?bakeBindGroup/,
  "encodeBake non deve più riscrivere il parameterBuffer dei dispatch già codificati",
);
assert.match(
  layerBlendTileRuntimeSource,
  /prepareBakeStyle\([\s\S]{0,160}?engine\.rasterBevelStyle,[\s\S]{0,160}?contentOpacity[\s\S]*?deferParameterUpload: true[\s\S]*?sharedStylePrepared: true[\s\S]*?flushBakeParameters\(bakeParameterSlot\)/,
  "il tile path deve preparare lo stile e caricare tutti i parametri bake una volta per frame",
);
assert.match(
  engineSource,
  /if \(crossedAction\.kind === "layer-blend-mode"\)[\s\S]{0,900}await setLayerBlendMode\([\s\S]{0,220}true,[\s\S]{0,180}engine\.history\.setCursor\(nextCursor\)/,
  "Undo/Redo deve cambiare solo compositing e avanzare il cursore dopo il successo",
);
const retargetStart = engineSource.indexOf("export async function retargetEffectsWorkingSetInternal(");
const retargetEnd = engineSource.indexOf("export function releaseLayerBlendFoldScratch(", retargetStart);
assertSection("retarget effects working set", retargetStart, retargetEnd);
const retargetBody = engineSource.slice(retargetStart, retargetEnd);
assert.match(retargetBody, /completionPolicy: LayerGpuCompletionPolicy = "await-immediately"/);
assert.match(retargetBody, /rebuildDomain: LayerEffectsRebuildDomain = "full-document"/);
assert.match(retargetBody, /styleStackRetargetBounds = rebuildDomain === "content-bounds"/,
  "solo il fold inattivo può restringere il dominio del rebuild analitico");
assert.match(
  retargetBody,
  /if \(completionPolicy === "await-immediately"\) \{\s*await engine\.waitForIdle\(\{\s*allowFrozenDerivedPresentation: caller !== "public",\s*\}\);/,
  "il retarget pubblico deve conservare il fence iniziale e solo i caller strutturali possono coalescere un frame congelato",
);
assert.match(retargetBody, /if \(completionPolicy === "await-immediately"\) \{\s*await engine\.waitForGpuCapped\(`Retarget effects workbench #\$\{generation\}`\);/,
  "solo la catena fold può rinviare il timeout GPU al fence del record");
const bakeCandidateStart = engineSource.indexOf("async createLayerBakeCandidate(");
const bakeCandidateEnd = engineSource.indexOf("async bakeActiveLayerForSwitch(", bakeCandidateStart);
const bakeCandidateBody = engineSource.slice(bakeCandidateStart, bakeCandidateEnd);
assert.match(bakeCandidateBody, /runGpuAllocationTransaction\(/,
  "il bake deve restare dentro allocation, validation, submit e rollback atomici");
assert.match(bakeCandidateBody, /GPUTextureUsage\.STORAGE_BINDING/);
assert.match(bakeCandidateBody, /GPUTextureUsage\.TEXTURE_BINDING/);
assert.match(bakeCandidateBody, /GPUTextureUsage\.COPY_SRC/);
assert.match(bakeCandidateBody, /renderer\.encodeBake\(/,
  "la fusione deve partire dal compositore analitico promosso dal golden");
assert.match(bakeCandidateBody, /const nonTransparentBounds = layerCompositeVisualBounds\(this, record\)/);
assert.match(bakeCandidateBody, /rect: nonTransparentBounds/,
  "il bake analitico inattivo non deve tornare al dispatch 4096²");
assert.match(bakeCandidateBody, /nonTransparentBounds: \{ \.\.\.nonTransparentBounds \}/);
assert.match(bakeCandidateBody, /await this\.waitForGpuCapped\(`/,
  "ogni nuovo submit atteso deve avere un timeout");
assert.match(bakeCandidateBody, /maybeInjectLayerBakeFault\(this, "after-candidate-submit"\)/);
assert.match(engineSource, /readonly liveLayerBakeTextures = new Map<GPUTexture, number>\(\)/);
assert.match(engineSource, /transaction\.deferRollback\(\(\) => destroyLayerBakeTexture\(this, texture\)\)/,
  "il fault post-submit deve rendere osservabile anche il rilascio del candidato");

// Il percorso raster è condiviso anche dallo stack misto; includi l'helper
// estratto nel corpo verificato, non soltanto il wrapper legacy.
const mergedStart = engineSource.indexOf(
  "export async function foldRasterRecordIntoMergedSurface(",
);
const mergedEnd = engineSource.indexOf(
  "export async function restoreEffectsWorkbenchToActiveLayer(",
  mergedStart,
);
assert.ok(mergedStart >= 0 && mergedEnd > mergedStart, "sezione merged surface non trovata");
const mergedBody = engineSource.slice(mergedStart, mergedEnd);
assert.match(mergedBody, /record\.visible && record\.opacity > 0 && record\.hasContent/);
assert.match(mergedBody, /await materializeLayerCompositeSource\(engine, record, caller\)/);
assert.match(
  mergedBody,
  /const contentBounds = unionMergedSurfaceRects\([\s\S]*?visibleRecords\.map\([\s\S]*?layerCompositeVisualBounds\(engine, record\)/,
  "anche il compositore raster legacy deve derivare una bbox visiva conservativa",
);
assert.match(
  mergedBody,
  /const allocationBounds = alignedMergedSurfaceBounds\(\s*contentBounds,\s*DOCUMENT_WIDTH,\s*64,\s*64,\s*DOCUMENT_HEIGHT,?\s*\)[\s\S]*?visibleRecords\.length,[\s\S]*?allocationBounds/,
  "la merged raster legacy non deve tornare a una texture full-document",
);
assert.doesNotMatch(
  mergedBody,
  /alignedMergedSurfaceBounds\(contentBounds, LAYER_SIZE\)/,
  "i bounds merged non devono ricostruire un documento quadrato dal lato massimo",
);
assert.match(
  engineSource,
  /export async function restoreEffectsWorkbenchToActiveLayer\([\s\S]*?rebuildDomain: LayerEffectsRebuildDomain = "full-document"[\s\S]*?"await-immediately",\s*rebuildDomain/,
  "il retarget attivo deve conservare il dominio full di default e permettere il dominio contenuto soltanto ai chiamanti espliciti",
);
assert.match(
  engineSource,
  /layerCompositeVisualBounds\([\s\S]*?rasterStrokeEffectRect[\s\S]*?rasterBevelEffectRect[\s\S]*?rasterOuterShadowEffectRect[\s\S]*?rasterInnerShadowEffectRect/,
  "i bounds del bake devono unire Traccia, Smusso e le due Ombre",
);
assert.match(
  engineSource,
  /export async function materializeLayerCompositeSource\([\s\S]*?"defer-to-fold-fence"[\s\S]*?"defer-to-fold-fence"[\s\S]*?"defer-to-fold-fence"/,
  "hydrate, retarget e bake temporanei devono appartenere allo stesso fence del fold",
);
const foldViewStart = engineSource.indexOf("async function foldViewIntoMergedSurface(");
const foldViewEnd = engineSource.indexOf("function recordHasLiveContent(", foldViewStart);
assertSection("fold view into merged surface", foldViewStart, foldViewEnd);
const foldViewBody = engineSource.slice(foldViewStart, foldViewEnd);
assert.ok(
  foldViewBody.indexOf("engine.device.queue.submit([encoder.finish()]);")
    < foldViewBody.indexOf("await engine.waitForGpuCapped(label);"),
  "il fence unico del fold deve seguire il submit",
);
assert.match(foldViewBody, /pass\.setScissorRect\(/,
  "i fold renderizzati devono restare limitati ai bounds conservativi");
assert.match(foldViewBody, /loadOp: clearDestination \? "clear" : "load"/,
  "il primo fold deve pulire la superficie e i successivi caricarla");
const foldUniformStart = engineSource.indexOf("function packLayerCompositeUniforms(");
const foldUniformEnd = engineSource.indexOf("async function foldViewIntoMergedSurface(", foldUniformStart);
assertSection("layer composite uniforms", foldUniformStart, foldUniformEnd);
const foldUniformBody = engineSource.slice(foldUniformStart, foldUniformEnd);
assert.match(foldUniformBody, /new ArrayBuffer\(LAYER_COMPOSITE_UNIFORM_BYTES\)/);
assert.match(foldUniformBody, /f32\[0\] = destinationOrigin\.x/);
assert.match(foldUniformBody, /f32\[1\] = destinationOrigin\.y/);
assert.match(foldUniformBody, /f32\[2\] = destinationScale/);
assert.match(foldUniformBody, /f32\[3\] = opacity/);
assert.match(foldUniformBody, /f32\[4\] = sourceOrigin\.x/);
assert.match(foldUniformBody, /f32\[5\] = sourceOrigin\.y/);
assert.match(foldUniformBody, /f32\[6\] = sourceScale/);
assert.match(foldUniformBody, /u32\[10\] = LAYER_BLEND_MODE_CODES\[blendMode\]/);
assert.match(foldUniformBody, /u32\[11\] = operator === "source-atop" \? 1 : 0/);
assert.match(
  foldUniformBody,
  /packLayerCompositeUniforms\([\s\S]*?destination\.bounds,[\s\S]*?destination\.resolutionScale,/,
  "il wrapper Normal deve conservare l'ABI document-space originale",
);
assert.match(foldViewBody, /mergedSurfacePhysicalRect\(/);
assert.match(foldViewBody, /if \(!advancedComposition\)/,
  "Normal senza controlli tonali o cutout deve conservare il percorso fixed-function senza scratch");
assert.match(
  foldViewBody,
  /operator === "source-atop"[\s\S]*?engine\.layerSourceAtopPipeline[\s\S]*?engine\.layerCompositePipeline/,
  "Normal deve scegliere le pipeline hardware source-atop/source-over preesistenti",
);
assert.match(foldViewBody, /engine\.layerBlendFoldPipeline/,
  "i modi avanzati devono usare lo shader che campiona il backdrop");
assert.match(foldViewBody, /binding: 0, resource: backdropScratchView/,
  "il fold avanzato deve campionare il tile backdrop separato");
assert.match(foldViewBody, /view: outputScratchView/,
  "il fold avanzato non può campionare la propria render attachment");
assert.match(foldViewBody, /destination\.blendFoldTileWidth/,
  "la dirty rect deve essere suddivisa nei tile scratch riusabili");
assert.match(foldViewBody, /packLayerCompositeUniforms\([\s\S]*?tile\.x \/ destination\.resolutionScale/,
  "ogni tile deve conservare le coordinate document-space globali");
assert.match(foldViewBody, /pass\.setBindGroup\(0, bindGroup, \[tileIndex \* uniformStride\]\)/,
  "un solo upload deve alimentare i record uniform dinamici di tutti i tile");
assert.equal(
  (foldViewBody.match(/encoder\.copyTextureToTexture\(/g) ?? []).length,
  4,
  "ogni tile deve copiare colore e mask tra canonical e scratch senza aliasing",
);
assert.match(
  foldViewBody,
  /if \(accumulatesDocumentMask\)[\s\S]*?documentMaskSurface\.blendFoldBackdropScratchTexture/,
  "la union document-scoped deve leggere una mask immutabile separata dalla render attachment",
);
assert.match(mergedBody, /engine\.destroyLayerBake\(source\.transientBake\)/);
assert.match(
  engineSource,
  /async rebuildMergedLayerSurfaces\(\s*caller: EffectsRetargetCaller = "layer-switch",\s*view: VectorTextViewState = this\.getVectorTextViewState\(\),\s*options: RebuildMergedLayerSurfacesOptions = \{\},\s*\): Promise<void>/,
);
const rebuildMethodStart = engineSource.indexOf("async rebuildMergedLayerSurfaces(");
const rebuildMethodEnd = engineSource.indexOf("  async addLayer(", rebuildMethodStart);
const rebuildMethodBody = engineSource.slice(rebuildMethodStart, rebuildMethodEnd);
const rebuildFreeze = rebuildMethodBody.indexOf("this.layerPresentationFrozen = true;");
const rebuildDestroyBelow = rebuildMethodBody.indexOf("this.destroyMergedSurface(previousBelow);");
const rebuildDestroyAbove = rebuildMethodBody.indexOf("this.destroyMergedSurface(previousAbove);");
const rebuildFirstCandidate = rebuildMethodBody.indexOf("candidateBelow = await buildMergedSurfaceCandidate(this, ");
assert.ok(
  rebuildFreeze >= 0
    && rebuildDestroyBelow > rebuildFreeze
    && rebuildDestroyAbove > rebuildFreeze
    && rebuildFirstCandidate > rebuildDestroyBelow
    && rebuildFirstCandidate > rebuildDestroyAbove,
  "le superfici fuse precedenti devono essere evacuate prima di allocare i candidati",
);
assert.match(
  rebuildMethodBody,
  /rebuildLayerDisplayBindGroups\(this\);[\s\S]*?this\.layerPresentationFrozen = false;/,
  "la presentazione può ripartire solo dopo la pubblicazione dei nuovi bind group",
);
assert.match(
  engineSource,
  /renderFrame\(timestamp: number\): void \{[\s\S]*?if \(this\.layerPresentationFrozen\) \{[\s\S]*?return;/,
  "nessun frame deve referenziare view evacuate durante la ricostruzione",
);
assert.match(
  engineSource,
  /record\.visible = previousVisible;[\s\S]*?record\.opacity = previousOpacity;[\s\S]*?await engine\.rebuildMergedLayerSurfaces\("layer-switch"\)/,
  "il rollback dello stile deve ricostruire le superfici evacuate dai raw autorevoli",
);
assert.match(
  engineSource,
  /export async function materializeLayerCompositeSource\([\s\S]*?caller: EffectsRetargetCaller,[\s\S]*?retargetEffectsWorkingSetInternal\([\s\S]*?caller,/,
  "la fusione deve conservare l'esenzione history-replay durante i retarget temporanei",
);
assert.match(
  engineSource,
  /foldRasterRecordIntoMergedSurface\([\s\S]*?caller: EffectsRetargetCaller,[\s\S]*?materializeLayerCompositeSource\(engine, record, caller\)/,
);
assert.match(
  engineSource,
  /async activateLayer\([\s\S]*?caller: EffectsRetargetCaller = "layer-switch",[\s\S]*?rebuildMergedLayerSurfaces\(caller\)/,
  "Undo/Redo cross-layer deve propagare il caller anche al compositing dei livelli",
);
assert.match(engineSource, /maybeInjectLayerCompositeFault\(this, "after-candidate-submit"\)/);
assert.match(engineSource, /let activeWorkbenchRestored = false;/);
assert.match(engineSource, /if \(!activeWorkbenchRestored\) \{[\s\S]*?restoreEffectsWorkbenchToActiveLayer\(this, caller, true\)/,
  "un errore durante la fusione deve forzare il retarget inverso del banco");
assert.match(engineSource, /Inconsistent state after compositing: reload before continuing/);
assert.match(
  engineSource,
  /latchDocumentStateInconsistent\(message: string, trigger\?: unknown\): void/,
  "il latch documentale deve poter conservare l'errore originale e il suo stack",
);
assert.match(engineSource, /firstDocumentInconsistentDiagnostic/);
assert.match(engineSource, /this\.historyStateInconsistent = true;[\s\S]*?this\.historyBusy = true;/,
  "il latch documentale deve bloccare ogni mutazione successiva");
assert.match(engineSource, /releaseFusedLayerBakes\(this\)/);
assert.match(engineSource, /readonly liveMergedSurfaceTextures = new Map<GPUTexture, MergedSurfaceResources>\(\)/);
assert.match(engineSource, /layerCompositeMiB/,
  "le superfici fuse e i bake transitori devono avere righe di memoria distinte");
const compositePipelineStart = engineSource.indexOf("const layerCompositePipeline = engine.device.createRenderPipeline(");
const compositePipelineBody = engineSource.slice(compositePipelineStart, compositePipelineStart + 1_100);
assert.match(
  compositePipelineBody,
  /srcFactor: "one", dstFactor: "one-minus-src-alpha"/,
  "la fusione deve usare source-over premoltiplicato",
);
const sourceAtopPipelineStart = engineSource.indexOf(
  "const layerSourceAtopPipeline = engine.device.createRenderPipeline(",
);
const sourceAtopPipelineBody = engineSource.slice(sourceAtopPipelineStart, sourceAtopPipelineStart + 1_100);
assert.match(sourceAtopPipelineBody, /srcFactor: "dst-alpha"/,
  "il colore del child deve essere moltiplicato per l'alpha continuo del parent");
assert.match(sourceAtopPipelineBody, /dstFactor: "one-minus-src-alpha"/);
assert.match(sourceAtopPipelineBody, /alpha: \{ operation: "add", srcFactor: "zero", dstFactor: "one" \}/,
  "source-atop deve conservare esattamente l'alpha del parent");
assert.match(clippingGroupShaderSource, /let matte = clamp\(destination\.a, 0\.0, 1\.0\)/);
assert.match(clippingGroupShaderSource, /source\.rgb \* matte \+ destination\.rgb \* \(1\.0 - sourceAlpha\)/);
assert.match(clippingGroupShaderSource, /return group \* display\.clippingParentOpacity/,
  "l'opacità del parent va applicata una sola volta al gruppo isolato");
assert.doesNotMatch(clippingGroupShaderSource, /step\s*\(|threshold|discard/i,
  "i bordi morbidi devono usare tutti i valori alpha, senza soglie");

const clippingSuffixBuildStart = engineSource.indexOf(
  "async function buildActiveClippingSuffixResources(",
);
const clippingSuffixBuildEnd = engineSource.indexOf(
  "async function buildClippingPrefixSurface(",
  clippingSuffixBuildStart,
);
assertSection(
  "suffix ritaglio live ordinato",
  clippingSuffixBuildStart,
  clippingSuffixBuildEnd,
);
const clippingSuffixBuildBody = engineSource.slice(
  clippingSuffixBuildStart,
  clippingSuffixBuildEnd,
);
assert.match(
  clippingSuffixBuildBody,
  /visible\.every\(\(record\) => !layerNeedsBackdropComposition\(record\)\)[\s\S]*?buildClippingOverlaySurface\(/,
  "il suffix senza composizione dipendente dal backdrop deve conservare la superficie aggregata veloce",
);
assert.match(
  clippingSuffixBuildBody,
  /forceOrderedSteps = false[\s\S]*?!forceOrderedSteps[\s\S]*?visible\.every\(\(record\) => !layerNeedsBackdropComposition\(record\)\)/,
  "un child attivo avanzato deve poter forzare operandi ordinati anche per i suffix Normal",
);
assert.match(
  activeClippingBuildBody,
  /Live clipping group suffix[\s\S]*?layerNeedsBackdropComposition\(engine\.layerStack\.active\)[\s\S]*?Boolean\(prefixResources\?\.documentMaskSurface\)/,
  "il gruppo live deve forzare i suffix ordinati quando il child attivo o una mask precedente dipende dal backdrop",
);
assert.match(
  clippingSuffixBuildBody,
  /for \(const record of visible\)[\s\S]*?suffixSteps\.push\(\{[\s\S]*?blendMode: record\.blendMode,[\s\S]*?opacity: record\.opacity/,
  "un suffix avanzato deve conservare modo e opacità di ogni child in ordine",
);
assert.match(
  engineSource,
  /buildClippingSuffixStepSurface\([\s\S]*?alignedMergedSurfaceBounds\(bounded, DOCUMENT_WIDTH, 64, 64, DOCUMENT_HEIGHT\),[\s\S]*?1,[\s\S]*?false,[\s\S]*?foldViewIntoMergedSurface\([\s\S]*?\n\s*1,[\s\S]*?\n\s*DOCUMENT_WIDTH,[\s\S]*?\n\s*DOCUMENT_HEIGHT,[\s\S]*?\n\s*1,[\s\S]*?\n\s*bounded,[\s\S]*?"normal",[\s\S]*?"source-over"/,
  "l'operando child deve essere mip0-only e non deve incorporare l'opacità",
);
assert.match(
  engineSource,
  /buildClippingSuffixStepSurface\([\s\S]*?runGpuAllocationTransaction\([\s\S]*?transaction\.deferRollback\(\(\) => engine\.destroyMergedSurface\(candidate\)\)/,
  "validation/OOM di un operando child deve distruggere il candidato prima del rollback esterno",
);
assert.match(
  layerBlendTileRuntimeSource,
  /for \(const step of activeGroup\.suffixSteps\)[\s\S]*?step\.blendMode,[\s\S]*?step\.opacity,[\s\S]*?"source-atop"/,
  "il tile runtime deve applicare i child avanzati source-atop nell'ordine dello stack",
);
assert.match(
  layerBlendTileRuntimeSource,
  /if \(activeGroup\?\.suffix\)[\s\S]*?sourceForSurface\(activeGroup\.suffix\),[\s\S]*?"normal",[\s\S]*?1,[\s\S]*?"source-atop"/,
  "il tile runtime deve mantenere il fold unico per il suffix tutto-Normal",
);
assert.match(
  layerBlendTileRuntimeSource,
  /const corners = \[[\s\S]*?\[0, 0\],[\s\S]*?\[canvasWidth, 0\],[\s\S]*?\[0, canvasHeight\],[\s\S]*?\[canvasWidth, canvasHeight\]/,
  "la ricostruzione LOD0 deve delimitare il viewport tramite tutti i quattro angoli",
);
assert.match(
  layerBlendTileRuntimeSource,
  /documentX = engine\.viewCenterX[\s\S]*?engine\.viewRotationCos \* displayX[\s\S]*?engine\.viewRotationSin \* displayY[\s\S]*?documentY = engine\.viewCenterY[\s\S]*?- engine\.viewRotationSin \* displayX[\s\S]*?engine\.viewRotationCos \* displayY/,
  "la bbox visibile deve usare la stessa trasformazione inversa ruotata del display WGSL",
);
assert.match(layerBlendTileRuntimeSource, /const margin = 2;/,
  "la bbox LOD0 deve conservare due pixel documento di margine");
assert.match(
  layerBlendTileRuntimeSource,
  /reuseFinalPyramid[\s\S]*?: requiresFullRebuild[\s\S]*?selectedMipLevel === 0[\s\S]*?visibleLodZeroDocumentRect\(engine\)[\s\S]*?: fullDocumentRect/,
  "ogni full rebuild LOD0 deve delimitarsi al viewport, indipendentemente dallo zoom",
);
assert.match(
  layerBlendTileRuntimeSource,
  /function dirtyTileCores\([\s\S]*?for \(let y = rect\.y; y < bottom; y \+= coreExtent\)[\s\S]*?for \(let x = rect\.x; x < right; x \+= coreExtent\)/,
  "un update parziale deve partire dalla dirty reale, non dalla griglia globale da 1022 px",
);
assert.match(
  layerBlendTileRuntimeSource,
  /requireEvenEdges[\s\S]*?rect\.x % 2 !== 0[\s\S]*?rect\.y % 2 !== 0[\s\S]*?rect\.width % 2 !== 0[\s\S]*?rect\.height % 2 !== 0/,
  "i chunk destinati al mip 1 devono conservare bordi document-space pari per il box 2×2",
);
assert.match(
  layerBlendTileRuntimeSource,
  /requiresFullRebuild[\s\S]*?selectedMipLevel > 0[\s\S]*?alignedTileCores\(documentRect, coreExtent\)[\s\S]*?: dirtyTileCores\(documentRect, coreExtent, false\)[\s\S]*?: dirtyTileCores\(documentRect, coreExtent, selectedMipLevel > 0\)/,
  "solo i full rebuild mip 1+ devono restare agganciati alla griglia globale dei core",
);
assert.match(
  layerBlendTileRuntimeSource,
  /selectedMipLevel > 0[\s\S]*?\? core[\s\S]*?: clampDocumentRect\(expandRect\(core, 1\)\)!/,
  "ogni chunk LOD0 deve mantenere l'apron bilineare di un pixel",
);
assert.match(
  layerBlendTileRuntimeSource,
  /targetRect: \{[\s\S]*?x: core\.x \/ 2,[\s\S]*?y: core\.y \/ 2,[\s\S]*?width: core\.width \/ 2,[\s\S]*?height: core\.height \/ 2/,
  "il core mip pari deve essere ridotto esattamente sulla griglia 2×2",
);
assert.match(
  engineSource,
  /group\.suffixSteps\.forEach\(\(step\) => \{[\s\S]*?destroyMixedSceneRasterSegment\(engine, step\.viewportSegment\)/,
  "distruzione e rollback devono rilasciare binding viewport e operando child",
);
assert.match(
  engineSource,
  /export function destroyMixedSceneRasterSegment\([\s\S]*?segment\.uniformBuffer\.destroy\(\);[\s\S]*?engine\.destroyMergedSurface\(segment\.surface\)/,
  "il distruttore condiviso deve rilasciare uniform e superficie dell'operando",
);
assert.match(
  engineSource,
  /activeClippingGroup\?\.suffixSteps\.map\(\(step\) => step\.surface\)/,
  "gli operandi child devono entrare nella contabilità GPU del gruppo live",
);
assert.match(
  engineSource,
  /writeBlendControls\([\s\S]*?blendMode,[\s\S]*?"source-over",[\s\S]*?compositionRecord,[\s\S]*?engine\.activeClippingGroup\?\.parentOpacity \?\? 1/,
  "il fold esterno del gruppo live deve applicare l'opacità del parent una sola volta",
);

// Oracle premoltiplicato: anche con due child opachi il bordo al 25% del
// parent resta al 25%, invece di crescere a ogni composizione.
const sourceAtop = (source, destination) => {
  const matte = destination[3];
  return [
    source[0] * matte + destination[0] * (1 - source[3]),
    source[1] * matte + destination[1] * (1 - source[3]),
    source[2] * matte + destination[2] * (1 - source[3]),
    matte,
  ];
};
const softParent = [0.25, 0, 0, 0.25];
const firstClip = sourceAtop([0, 1, 0, 1], softParent);
const secondClip = sourceAtop([0, 0, 1, 1], firstClip);
assert.equal(firstClip[3], 0.25);
assert.equal(secondClip[3], 0.25);
assert.deepEqual(secondClip, [0, 0, 0.25, 0.25]);

// Le allocazioni delle risorse di livello vivono in `engine-layer-runtime`:
// la sezione parte dalla definizione, non dalla prima chiamata.
// `allocateLayerTexture` è rimasta un membro del motore, la piramide e le
// superfici fuse sono in `engine-layer-runtime`: la sezione le copre entrambe.
const allocationStart = engineSource.indexOf("  allocateLayerTexture(format: LayerFormat)");
assert.ok(allocationStart >= 0, "allocateLayerTexture non trovata");
const pyramidStart = engineSource.indexOf("export function allocateActiveLayerDisplayPyramid(");
assert.ok(pyramidStart >= 0, "allocateActiveLayerDisplayPyramid non trovata");
const mergedSurfaceStart = engineSource.indexOf("export function allocateMergedSurface(");
assert.ok(mergedSurfaceStart >= 0, "allocateMergedSurface non trovata");
const allocationBody = engineSource.slice(allocationStart, allocationStart + 1_500)
  + engineSource.slice(pyramidStart, pyramidStart + 2_000)
  + engineSource.slice(mergedSurfaceStart, mergedSurfaceStart + 4_000);
assert.match(allocationBody, /mipLevelCount: 1/,
  "ogni layer inattivo deve possedere soltanto il mip 0 autorevole");
// `allocateActiveLayerDisplayPyramid(` e `allocateMergedSurface(` non vanno
// asseriti qui: la finestra è costruita partendo da quelle stesse stringhe,
// quindi l'asserzione sarebbe vera per costruzione. Restano i vincoli sul
// contenuto, che sono l'unica cosa che può regredire.
assert.match(allocationBody, /mipLevelCount: PAINT_DISPLAY_MIP_LEVEL_COUNT - 1/);
assert.match(allocationBody, /const fullMipLevelCount = mergedSurfaceMipLevelCount\(physicalBounds\)/);
assert.match(allocationBody, /const mipLevelCount = maintainMipChain \? fullMipLevelCount : 1/,
  "gli operandi live-only devono poter evitare la piramide che non campionano");
assert.match(allocationBody, /const textureWidth = normalizedBounds\.width \* resolutionScale/);
assert.match(allocationBody, /const textureHeight = normalizedBounds\.height \* resolutionScale/);
assert.match(allocationBody, /mip0MemoryBytes: memory\.mip0Bytes/);
assert.match(allocationBody, /mipChainMemoryBytes: maintainMipChain \? memory\.mipChainBytes : 0/);
assert.match(allocationBody, /GPUTextureUsage\.COPY_DST/,
  "la superficie fusa deve accettare il percorso veloce byte-esatto");
assert.match(
  engineSource,
  /export async function allocateLayerGpuResources\([\s\S]*?runGpuAllocationTransaction\(engine\.device, label/,
  "l'allocazione completa del mip 0 deve chiudere validation e OOM scope prima del commit",
);
assert.equal(
  (engineSource.match(
    /label: `\$\{DOCUMENT_WIDTH\}×\$\{DOCUMENT_HEIGHT\} authoritative paint layer \$\{format\}`/g,
  ) ?? []).length,
  1,
  "la creazione della texture autorevole deve esistere in un solo punto",
);

// Every display path receives below/active/above before checkerboard and sRGB.
assert.match(engineSource, /this\.displayUniformUpload\[9\] = this\.mergedBelow\?\.resolutionScale \?\? 0/);
assert.match(engineSource, /this\.displayUniformUpload\[10\] = this\.mergedAbove\?\.resolutionScale \?\? 0/);
assert.match(engineSource, /this\.displayUniformUpload\[11\] = this\.layerStack\.active\.visible/);
assert.match(engineSource, /this\.displayUniformUpload\[12\] = this\.mergedBelow\?\.bounds\.x \?\? 0/);
assert.match(engineSource, /this\.displayUniformUpload\[15\] = this\.mergedAbove\?\.bounds\.y \?\? 0/);
assert.match(engineSource, /this\.displayUniformUpload\[16\] = clippingGroup\?\.mode === "active-parent"/);
assert.match(engineSource, /this\.displayUniformUpload\[17\] = clippingGroup\?\.parentOpacity \?\? 0/);
assert.match(engineSource, /this\.displayUniformUpload\[18\] = clippingGroup\?\.prefix\?\.resolutionScale \?\? 0/);
assert.match(engineSource, /this\.displayUniformUpload\[19\] = clippingGroup\?\.suffix\?\.resolutionScale \?\? 0/);
assert.match(engineSource, /this\.displayUniformUpload\[23\] = clippingGroup\?\.suffix\?\.bounds\.y \?\? 0/);
const shaderSource = readFileSync(new URL("../src/shaders.ts", import.meta.url), "utf8");
const mergedSurfaceShaderSource = readFileSync(
  new URL("../src/merged-surface-shader.ts", import.meta.url),
  "utf8",
);
assert.match(shaderSource, /fn composeLayerStackSamples\(/);
assert.match(shaderSource, /return composeActiveClippingGroupTexel\(activeTexel, pixel\)/,
  "il mip 0 deve comporre il gruppo live direttamente dal texel autorevole");
assert.match(shaderSource, /let activeContribution = select\([\s\S]*?display\.clippingMode < 0\.5/,
  "il compositore stack non deve applicare due volte l'opacità al gruppo isolato");
assert.match(mergedSurfaceShaderSource, /sampleMergedAbove\(layerPosition/);
assert.match(mergedSurfaceShaderSource, /layerPosition - display\.mergedAboveOrigin/);
assert.equal(
  (shaderSource.match(/fn composeLayerStackSamples\(/g) ?? []).length,
  1,
  "il display base deve avere un solo compositore per i campioni raster",
);
assert.equal(
  (shaderSource.match(/fn composeLayerStack\(\s*activePaint: vec4<f32>,\s*layerPosition: vec2<f32>,\s*fragmentPosition: vec2<f32>/g) ?? []).length,
  2,
  "coda e Light Glaze devono accettare le coordinate viewport del testo",
);
assert.match(shaderSource, /composeLayerStackSamples\(activePaint, belowPaint, abovePaint\)/);
assert.equal(
  (shaderSource.match(/paint = composeLayerStack\(paint, layerPosition, fragmentPosition\.xy\);/g) ?? []).length,
  2,
  "coda e Light Glaze devono comporre merged e testo in coordinate documento\/viewport",
);
const strokeRendererSource = readFileSync(
  new URL("../src/stroke-renderer.ts", import.meta.url),
  "utf8",
);
assert.match(strokeRendererSource, /paint = composeLayerStack\(paint, layerPosition, fragmentPosition\.xy\);/);
assert.match(strokeRendererSource, /@group\(1\) @binding\(15\) var mergedBelowTexture/);
assert.match(strokeRendererSource, /@group\(1\) @binding\(16\) var mergedAboveTexture/);
assert.ok(
  shaderSource.indexOf("paint = composeLayerStack(paint, layerPosition, fragmentPosition.xy);")
    < shaderSource.indexOf(
      "let checkerCell",
      shaderSource.indexOf("paint = composeLayerStack(paint, layerPosition, fragmentPosition.xy);"),
    ),
  "la coda spessore deve comporre layer e testo prima della scacchiera e della conversione sRGB",
);
// All five effect styles must live on the layer record, not on the engine, or a
// switch would show the outgoing layer's effects on the incoming one.
// Accessors keep existing call sites working while making the styles
// follow the active layer by construction rather than by remembering to copy.
assert.match(engineSource, /readonly layerStack = new LayerStack\(\(\) => \(\{/);
assert.match(
  engineSource,
  /get rasterStrokeStyle\(\): RasterStrokeStyle \{\s*return this\.layerStack\.active\.strokeStyle;/,
);
assert.match(
  engineSource,
  /get rasterBevelStyle\(\): RasterBevelStyle \{\s*return this\.layerStack\.active\.bevelStyle;/,
);
assert.match(
  engineSource,
  /get rasterOuterShadowStyle\(\): RasterOuterShadowStyle \{\s*return this\.layerStack\.active\.outerShadowStyle;/,
);
assert.match(
  engineSource,
  /get rasterInnerShadowStyle\(\): RasterInnerShadowStyle \{\s*return this\.layerStack\.active\.innerShadowStyle;/,
);
assert.match(
  engineSource,
  /get rasterColorOverlayStyle\(\): RasterColorOverlayStyle \{\s*return this\.layerStack\.active\.colorOverlayStyle;/,
);
assert.doesNotMatch(
  engineSource,
  /(private )?rasterStrokeStyle: RasterStrokeStyle =/,
  "lo stile Traccia non può tornare a essere un campo del motore",
);
assert.doesNotMatch(
  engineSource,
  /(private )?rasterBevelStyle: RasterBevelStyle =/,
  "lo stile Smusso non può tornare a essere un campo del motore",
);
assert.doesNotMatch(
  engineSource,
  /(private )?rasterOuterShadowStyle: RasterOuterShadowStyle =/,
  "lo stile Ombra esterna non può tornare a essere un campo del motore",
);
assert.doesNotMatch(
  engineSource,
  /(private )?rasterInnerShadowStyle: RasterInnerShadowStyle =/,
  "lo stile Ombra interna non può tornare a essere un campo del motore",
);
const colorOverlaySetterStart = engineSource.indexOf(
  "async setRasterColorOverlayStyle(",
);
const colorOverlaySetterEnd = engineSource.indexOf(
  "async setRasterStrokeStyle(",
  colorOverlaySetterStart,
);
assert.notEqual(colorOverlaySetterStart, -1);
assert.notEqual(colorOverlaySetterEnd, -1);
const colorOverlaySetterBody = engineSource.slice(
  colorOverlaySetterStart,
  colorOverlaySetterEnd,
);
assert.match(
  colorOverlaySetterBody,
  /if \(rendererWillBeReleased\) \{\s*await this\.waitForIdle\(\);/,
  "solo la distruzione del compositore può imporre queue-idle a Color Overlay",
);
assert.match(
  colorOverlaySetterBody,
  /previousDisplayUsesStyle !== nextDisplayUsesStyle/,
  "un cambio colore caldo non deve ricostruire tutta la cache di presentazione",
);

// After a switch the effect controls must be re-read from the engine, or the
// panel would show the outgoing layer's Traccia and Smusso while the brush
// paints on the incoming one — wrong in a way that looks like a rendering bug.
const mainSource = readFileSync(
  new URL("../src/main.ts", import.meta.url),
  "utf8",
);
const gpuMemoryPanelSource = readFileSync(
  new URL("../src/gpu-memory-panel-controller.ts", import.meta.url),
  "utf8",
);
const canvasToolSource = readFileSync(
  new URL("../src/canvas-tool-controller.ts", import.meta.url),
  "utf8",
);
const rasterStyleSource = readFileSync(
  new URL("../src/raster-style-controller.ts", import.meta.url),
  "utf8",
);
const canvasInputSource = readFileSync(
  new URL("../src/canvas-input-controller.ts", import.meta.url),
  "utf8",
);
const documentInteractionSource = readFileSync(
  new URL("../src/document-interaction-controller.ts", import.meta.url),
  "utf8",
);
const brushQuickControlsSource = readFileSync(
  new URL("../src/brush-quick-controls-controller.ts", import.meta.url),
  "utf8",
);
const sceneEditorSource = readFileSync(
  new URL("../src/scene-editor-controller.ts", import.meta.url),
  "utf8",
);
const brushLibrarySource = readFileSync(
  new URL("../src/brush-library-controller.ts", import.meta.url),
  "utf8",
);
const editorToolsSource = readFileSync(
  new URL("../src/editor-tools-controller.ts", import.meta.url),
  "utf8",
);
const editorLabsSource = readFileSync(
  new URL("../src/labs/editor-labs.ts", import.meta.url),
  "utf8",
);
const labsStartupSource = readFileSync(
  new URL("../src/labs/startup.ts", import.meta.url),
  "utf8",
);
const labOperationsSource = readFileSync(
  new URL("../src/labs/engine-lab-operations.ts", import.meta.url),
  "utf8",
);
const humanLabSource = readFileSync(
  new URL("../src/labs/human-stroke-lab.ts", import.meta.url),
  "utf8",
);
const indexSource = readFileSync(
  new URL("../index.html", import.meta.url),
  "utf8",
);
const stylesSource = readFileSync(
  new URL("../src/styles.css", import.meta.url),
  "utf8",
);
const mobileToolSettingsSource = readFileSync(
  new URL("../src/mobile-tool-settings-sheet.ts", import.meta.url),
  "utf8",
);
assert.match(layerThumbnailGeometrySource, /export const LAYER_THUMBNAIL_SIZE = 64 as const/);
assert.match(layerThumbnailSource, /export const LAYER_THUMBNAIL_SAMPLE_GRID = 8 as const/);
assert.match(
  layerThumbnailSource,
  /"lazy-idle-gpu-area-sample-document-aspect-64-readback-cache-v2" as const/,
);
assert.deepEqual(layerThumbnailDimensions(1080, 1920), { width: 36, height: 64 });
assert.deepEqual(layerThumbnailDimensions(1920, 1080), { width: 64, height: 36 });
assert.match(layerThumbnailSource, /copyTextureToBuffer\(/);
assert.match(layerThumbnailSource, /GPUBufferUsage\.COPY_DST \| GPUBufferUsage\.MAP_READ/);
assert.match(
  layerThumbnailSource,
  /readonly residentBytes = LAYER_THUMBNAIL_BYTE_LENGTH \+ LAYER_THUMBNAIL_TEXTURE_BYTES/,
);
assert.match(
  layerThumbnailSource,
  /Math\.ceil\(\s*LAYER_THUMBNAIL_TIGHT_BYTES_PER_ROW \/ 256,?\s*\) \* 256/,
);
assert.match(layerThumbnailSource, /mappedBytes\.subarray\(/);
assert.match(layerThumbnailSource, /rowsPerImage: LAYER_THUMBNAIL_HEIGHT/);
assert.match(
  layerThumbnailSource,
  /for \(var sampleY = 0; sampleY < \$\{LAYER_THUMBNAIL_SAMPLE_GRID\}/,
);
assert.match(
  layerThumbnailSource,
  /for \(var sampleX = 0; sampleX < \$\{LAYER_THUMBNAIL_SAMPLE_GRID\}/,
);
assert.doesNotMatch(
  layerThumbnailSource,
  /createHydratedLayerTexture|LayerColdStorage|onSubmittedWorkDone/,
  "la miniatura non deve reidratare cold store o imporre un drain globale della coda",
);
assert.match(engineSource, /async captureActiveLayerThumbnail\(\)/);
assert.match(engineSource, /engine\.layerThumbnailRenderer\?\.residentBytes/);
assert.match(layerThumbnailControllerSource, /new BoundedMobileRasterThumbnailCache/);
assert.doesNotMatch(
  layerThumbnailControllerSource,
  /liveRasterIds[\s\S]{0,300}this\.cache\.delete/,
  "merge must not purge previews for layer ids that structural undo can restore",
);
assert.match(
  mainSource,
  /captureBusy: \(\) => canvasInputController\?\.isPointerActive === true[\s\S]*?historyState\.busy/,
);
assert.match(mainSource, /function requestMobileLayerThumbnailCapture\(delayMs = 120\)/);
assert.match(
  layerThumbnailControllerSource,
  /new this\.options\.browser\.ImageData\([\s\S]*?capture\.width,[\s\S]*?capture\.height/,
);
assert.match(layerPanelSource, /thumbnailCanvas\.width = LAYER_THUMBNAIL_WIDTH/);
assert.match(layerPanelSource, /thumbnailCanvas\.height = LAYER_THUMBNAIL_HEIGHT/);
assert.match(layerPanelSource, /--mobile-layer-thumbnail-width/);
assert.match(layerPanelSource, /--mobile-layer-thumbnail-height/);
assert.equal(MOBILE_RASTER_THUMBNAIL_EDGE_PX, 64);
assert.equal(MOBILE_RASTER_THUMBNAIL_RGBA_BYTES, 64 * 64 * 4);
assert.equal(MOBILE_RASTER_THUMBNAIL_CACHE_GENERATIONS, 4);
assert.equal(
  MOBILE_RASTER_THUMBNAIL_CACHE_MAXIMUM,
  LAYER_STACK_MAXIMUM * MOBILE_RASTER_THUMBNAIL_CACHE_GENERATIONS,
);
assert.equal(MOBILE_RASTER_THUMBNAIL_CACHE_MAXIMUM_BYTES, 1024 * 1024);
const rasterThumbnailCache = new BoundedMobileRasterThumbnailCache(2);
rasterThumbnailCache.set(1, "detached-by-merge");
rasterThumbnailCache.set(2, "merged-result");
assert.equal(rasterThumbnailCache.get(1), "detached-by-merge");
rasterThumbnailCache.set(3, "newer-preview");
assert.equal(
  rasterThumbnailCache.get(1),
  "detached-by-merge",
  "reading a restored undo preview must keep it resident",
);
assert.equal(
  rasterThumbnailCache.get(2),
  undefined,
  "the least-recent preview must be evicted at the hard cap",
);
assert.equal(rasterThumbnailCache.get(3), "newer-preview");
assert.equal(
  MOBILE_SEMANTIC_LAYER_THUMBNAIL_STRATEGY,
  "lazy-canvas2d-semantic-text-svg-document-aspect-64-signature-cache-v2",
);
assert.equal(MOBILE_SEMANTIC_LAYER_THUMBNAIL_SIZE, 64);
assert.equal(MOBILE_SEMANTIC_THUMBNAIL_MAXIMUM_COMMANDS, 25_000);
assert.notEqual(
  mobileSemanticLayerThumbnailSignature({
    kind: "text",
    node: { text: "ONE", fontFamily: "Anton", fontSize: 360, color: "#112233" },
  }),
  mobileSemanticLayerThumbnailSignature({
    kind: "text",
    node: { text: "TWO", fontFamily: "Anton", fontSize: 360, color: "#112233" },
  }),
  "the text thumbnail signature must follow authoritative text content",
);
assert.notEqual(
  mobileSemanticLayerThumbnailSignature({
    kind: "svg",
    node: { document: { sourceRevision: "svg-a" }, paintColors: ["#112233"] },
  }),
  mobileSemanticLayerThumbnailSignature({
    kind: "svg",
    node: { document: { sourceRevision: "svg-a" }, paintColors: ["#445566"] },
  }),
  "the SVG thumbnail signature must follow its editable authoritative palette",
);
assert.match(mobileSemanticThumbnailSource, /context\.fillText\(/);
assert.match(mobileSemanticThumbnailSource, /const width = context\.canvas\.width/);
assert.match(mobileSemanticThumbnailSource, /const canvasHeight = context\.canvas\.height/);
assert.match(mobileSemanticThumbnailSource, /paint\.path\.verbs/);
assert.match(mobileSemanticThumbnailSource, /context\.bezierCurveTo\(/);
assert.match(mobileSemanticThumbnailSource, /paint\.fillRule === 1 \? "evenodd" : "nonzero"/);
assert.match(mobileSemanticThumbnailSource, /commandCount > MOBILE_SEMANTIC_THUMBNAIL_MAXIMUM_COMMANDS/);
assert.match(mobileSemanticThumbnailSource, /const textThumbnailFontStates = new Map/);
assert.doesNotMatch(
  mobileSemanticThumbnailSource,
  /navigator\.gpu|GPU(?:Device|Texture|Buffer|Queue|CommandEncoder)|copyTextureToBuffer|mapAsync|setInterval/,
  "semantic thumbnails must remain cached Canvas2D work without GPU readback or polling",
);
assert.match(layerPanelSource, /semanticThumbnailSignature: mobileSemanticLayerThumbnailSignature/);
assert.match(
  layerThumbnailControllerSource,
  /renderMobileSemanticLayerThumbnail\([\s\S]*?view\.semanticThumbnail/,
);
assert.match(stylesSource, /\.mobile-layers-panel \{[\s\S]*?right: 0;/);
assert.match(stylesSource, /\.mobile-layer-thumbnail-canvas \{[\s\S]*?background: #ffffff;/);
assert.match(
  stylesSource,
  /\.mobile-layer-select,\s*\.mobile-layer-select:hover,\s*\.mobile-layer-select:active\s*\{[^}]*padding: 5px 6px;/,
  "tap, hover and selected-row interaction must preserve the thumbnail padding",
);
assert.match(
  indexSource,
  /minimum-scale=1\.0, maximum-scale=1\.0, user-scalable=no/,
);
assert.equal(MOBILE_TOOLS_SHEET_CLOSE_FLICK_MIN_DISTANCE_PX, 28);
assert.equal(MOBILE_TOOLS_SHEET_CLOSE_FLICK_MIN_VELOCITY_PX_PER_MS, 0.45);
assert.equal(MOBILE_TOOLS_SHEET_CLOSE_FROM_PEEK_DISTANCE_PX, 36);
assert.equal(MOBILE_TOOLS_SHEET_CLOSE_PAST_PEEK_DISTANCE_PX, 36);
const mobileToolsSheetCloseGestureBase = {
  peekOffsetPx: 600,
  closedOffsetPx: 800,
};
assert.equal(shouldCloseMobileToolsSheetDrag({
  ...mobileToolsSheetCloseGestureBase,
  startSnap: "expanded",
  deltaY: 30,
  releaseVelocityY: 0.55,
  offsetPx: 30,
}), true, "un flick rapido deve chiudere direttamente dallo snap alto");
assert.equal(shouldCloseMobileToolsSheetDrag({
  ...mobileToolsSheetCloseGestureBase,
  startSnap: "expanded",
  deltaY: 80,
  releaseVelocityY: 0.1,
  offsetPx: 80,
}), false, "un trascinamento lento e corto dallo snap alto deve ancora fermarsi a peek");
assert.equal(shouldCloseMobileToolsSheetDrag({
  ...mobileToolsSheetCloseGestureBase,
  startSnap: "peek",
  deltaY: 36,
  releaseVelocityY: 0,
  offsetPx: 636,
}), true, "da peek devono bastare 36 px verso il basso per chiudere");
assert.equal(shouldCloseMobileToolsSheetDrag({
  ...mobileToolsSheetCloseGestureBase,
  startSnap: "peek",
  deltaY: 35,
  releaseVelocityY: 0,
  offsetPx: 635,
}), false, "un movimento sotto soglia da peek non deve chiudere accidentalmente");
assert.equal(shouldCloseMobileToolsSheetDrag({
  ...mobileToolsSheetCloseGestureBase,
  startSnap: "expanded",
  deltaY: 636,
  releaseVelocityY: 0,
  offsetPx: 636,
}), true, "superare peek di 36 px deve chiudere anche senza velocità");
assert.match(editorToolsSource, /const shouldClose = shouldCloseMobileToolsSheetDrag\(\{/);
assert.match(editorToolsSource, /this\.snap\(this\.dragStartSnap\)/);
assert.match(
  indexSource,
  /id="mobileBrushLibrarySheet"[\s\S]*?M1M4 BRUSHES[\s\S]*?data-mobile-brush-category="pencil"[\s\S]*?data-mobile-brush-category="painting"[\s\S]*?data-mobile-brush-category="spray-paint"/,
  "la Brush Library mobile deve conservare titolo e tre categorie reali",
);
assert.match(
  indexSource,
  /id="mobileCurrentBrushCard"[\s\S]*?Default Brush[\s\S]*?id="mobileBrushLibraryPreviewCanvas"/,
  "lo slot legacy deve avere un nome reale e una preview propria",
);
assert.match(
  brushLibrarySource,
  /private visibleBrushIds\(\)[\s\S]*?const visible = \[this\.activeBrushId\][\s\S]*?brushId !== this\.activeBrushId[\s\S]*?card\.dataset\.mobileBrushCategoryCard === this\.category[\s\S]*?visible\.push\(brushId\)/,
  "ogni categoria deve mostrare prima il pennello attivo e poi i propri pennelli non duplicati",
);
assert.match(
  brushLibrarySource,
  /private setCategory\(category:[\s\S]*?const ordered[\s\S]*?this\.activeBrushId[\s\S]*?dataset\.mobileBrushCategoryCard === category[\s\S]*?this\.elements\.list\.append\(card\)/,
  "la card attiva deve essere riordinata fisicamente al primo posto in ogni categoria",
);
assert.match(
  brushLibrarySource,
  /this\.activeBrushId = brushId;[\s\S]*?this\.setCategory\(this\.categoryFor\(brushId\)\)[\s\S]*?this\.syncSelection\(\)/,
  "la selezione deve aggiornare subito ordine e stato della categoria visibile",
);
assert.match(
  stylesSource,
  /\.mobile-brush-library-layout \{[\s\S]*?grid-template-columns: 88px minmax\(0, 1fr\);/,
);
assert.match(
  stylesSource,
  /\.mobile-brush-card\.is-selected \{[\s\S]*?border-color: #dd5c35;[\s\S]*?background: #1a1d23;/,
);
assert.match(
  canvasToolSource,
  /paintButton\.addEventListener\("click", \(\) => \{[\s\S]*?this\.activeCanvasTool === "paint"[\s\S]*?options\.toggleBrushLibrary\(\);[\s\S]*?this\.select\("paint"\);/,
  "il primo tap deve selezionare Paint e soltanto un tap sul Paint già attivo apre la library",
);
assert.match(
  mainSource + brushLibrarySource,
  /beforeOpen:[\s\S]*?editorToolsController\?\.setOpen\(false\)[\s\S]*?layerPanelController\?\.isOpen[\s\S]*?layerPanelController\.setOpen\(false\)[\s\S]*?setOpen\(open: boolean\)[\s\S]*?this\.setOffset\(0\)/,
  "la Brush Library deve aprirsi expanded ed escludere Tools e Layers",
);
assert.match(
  mainSource,
  /isSuppressedBySurface: \(\) =>[\s\S]*?layerPanelController\?\.isOpen[\s\S]*?editorToolsController\?\.isOpen[\s\S]*?brushLibraryController\.isOpen/,
  "Size e Opacity non devono restare sopra la Brush Library",
);
assert.match(
  brushQuickControlsSource,
  /const suppressed = !brushContext \|\| this\.options\.isSuppressedBySurface\(\)/,
);
assert.match(
  brushLibrarySource,
  /startSnap: "expanded",[\s\S]*?peekOffsetPx: Math\.min\(closedOffset, Math\.max\(96, closedOffset \* 0\.22\)\)/,
  "il drawer della Brush Library deve usare la gesture facile di chiusura senza snap intermedio",
);
const mobileBrushLibraryPreviewStart = brushLibrarySource.indexOf(
  "private renderPreview(): void",
);
const mobileBrushLibraryPreviewEnd = brushLibrarySource.indexOf(
  "private schedulePreview(): void",
  mobileBrushLibraryPreviewStart,
);
assertSection(
  "orchestrazione preview WebGPU Brush Library",
  mobileBrushLibraryPreviewStart,
  mobileBrushLibraryPreviewEnd,
);
const mobileBrushLibraryPreviewSource = brushLibrarySource.slice(
  mobileBrushLibraryPreviewStart,
  mobileBrushLibraryPreviewEnd,
);
assert.match(
  mobileBrushLibraryPreviewSource,
  /this\.previewRenderer[\s\S]*?\.render\(/,
);
assert.doesNotMatch(
  mobileBrushLibraryPreviewSource,
  /setBrushSettings|queue\.submit|copyTextureToBuffer|mapAsync|onSubmittedWorkDone/,
  "il controller deve soltanto orchestrare la cache: submit e readback vivono nel renderer WebGPU condiviso",
);
assert.match(documentInteractionSource, /DOUBLE_TAP_ZOOM_INTERVAL_MS = 350/);
assert.match(documentInteractionSource, /document\.addEventListener\("touchend",[\s\S]*?passive: false/);
assert.match(documentInteractionSource, /document\.addEventListener\("dblclick",[\s\S]*?preventDefault\(\)/);
assert.match(
  indexSource,
  /id="mobileBrushStudioSize" type="range" min="1" max="1000" step="1" value="30"/,
);
assert.match(
  indexSource,
  /id="mobileBrushSizeControl"[\s\S]*?aria-valuemin="1"[\s\S]*?aria-valuemax="1000"[\s\S]*?aria-valuenow="96"[\s\S]*?aria-valuetext="Size 96 px"/,
);
assert.match(
  indexSource,
  /id="mobileBrushStretchControl"[\s\S]*?aria-valuemin="0"[\s\S]*?aria-valuemax="100"[\s\S]*?aria-valuetext="Stretch 18%"/,
);
assert.match(
  indexSource,
  /id="mobileBrushPaintControl"[\s\S]*?aria-valuemin="0"[\s\S]*?aria-valuemax="100"[\s\S]*?aria-valuetext="Paint 14%"/,
);
assert.match(
  indexSource,
  /id="mobileBrushBlurControl"[\s\S]*?aria-valuemin="0"[\s\S]*?aria-valuemax="100"[\s\S]*?aria-valuetext="Blur 0%"/,
);
assert.match(brushQuickControlsSource, /this\.options\.settings\.quickControl\(kind\)/);
assert.match(brushQuickControlsSource, /const CONTROL_INDICATOR_MAX_CSS_PIXELS = 41;/);
assert.match(
  brushQuickControlsSource,
  /const diameter = kind === "size"[\s\S]*?: CONTROL_INDICATOR_MAX_CSS_PIXELS \* percent \/ 100;[\s\S]*?"--mobile-brush-opacity-indicator"[\s\S]*?`\$\{diameter\.toFixed\(2\)\}px`/,
);
assert.match(
  stylesSource,
  /\[data-mobile-brush-control="opacity"\] \.mobile-brush-control-value \{[\s\S]*?width: var\(--mobile-brush-opacity-indicator, 41px\);[\s\S]*?height: var\(--mobile-brush-opacity-indicator, 41px\);/,
);
assert.match(
  brushQuickControlsSource,
  /if \(kind === "size"\) return `Size \$\{Math\.round\(value\)\} px`;[\s\S]*?if \(kind === "opacity"\) return `Opacity \$\{Math\.round\(value\)\}%`;[\s\S]*?if \(kind === "stretch"\) return `Stretch \$\{Math\.round\(value\)\}%`;[\s\S]*?if \(kind === "paint"\) return `Paint \$\{Math\.round\(value\)\}%`;[\s\S]*?return `Blur \$\{Math\.round\(value\)\}%`/,
);
assert.match(
  brushQuickControlsSource,
  /tracks\.opacity\.hidden = false;[\s\S]*?tracks\.stretch\.hidden = !blend;[\s\S]*?tracks\.paint\.hidden = !blend;[\s\S]*?tracks\.blur\.hidden = !blend;/,
  "Paint/Eraser retain Size and Opacity while Blend also exposes Stretch, Paint and Blur",
);
assert.match(
  stylesSource,
  /\.mobile-brush-controls\.is-blend \.mobile-brush-control-track \{[\s\S]*?height: clamp\(56px, 13%, 100px\);[\s\S]*?#mobileBrushSizeTrack \{[\s\S]*?top: 1%;[\s\S]*?#mobileBrushOpacityTrack \{[\s\S]*?top: 21%;[\s\S]*?#mobileBrushStretchTrack \{[\s\S]*?top: 41%;[\s\S]*?#mobileBrushPaintTrack \{[\s\S]*?top: 61%;[\s\S]*?#mobileBrushBlurTrack \{[\s\S]*?top: 81%;/,
  "the five Blend circles must use evenly spaced tracks",
);
assert.match(
  brushQuickControlsSource,
  /finishDrag\(commit: boolean\)[\s\S]*?if \(commit && drag\.currentValue !== drag\.startValue\) \{[\s\S]*?this\.options\.settings\.setQuickControl\(drag\.kind, drag\.currentValue\);/,
  "the five Blend controls must apply authoritative settings once on release",
);
assert.doesNotMatch(mainSource, /size\.max = blend \? "1024" : "1500"/);
const mobileToolRailCssStart = stylesSource.indexOf("  .mobile-tool-rail {");
const mobileToolRailCssEnd = stylesSource.indexOf("\n  }", mobileToolRailCssStart);
assertSection("CSS mobile tool rail", mobileToolRailCssStart, mobileToolRailCssEnd);
const mobileToolRailCss = stylesSource.slice(mobileToolRailCssStart, mobileToolRailCssEnd);
assert.match(
  mobileToolRailCss,
  /top: calc\(64px \+ env\(safe-area-inset-top\)\);[\s\S]*?bottom: max\(12px, env\(safe-area-inset-bottom\)\);[\s\S]*?margin-block: auto;/,
);
assert.doesNotMatch(
  mobileToolRailCss,
  /top: 50%;|transform: translateY\(-50%\);/,
);
assert.match(
  stylesSource,
  /\.mobile-layer-reference,[\s\S]*?\.mobile-layer-visibility \{[\s\S]*?align-self: center;[\s\S]*?justify-self: center;/,
);
const pointerMoveStart = canvasInputSource.indexOf("const handlePointerMove =");
const pointerMoveEnd = canvasInputSource.indexOf("const finishPointer =", pointerMoveStart);
assert.ok(pointerMoveStart >= 0 && pointerMoveEnd > pointerMoveStart);
assert.doesNotMatch(
  canvasInputSource.slice(pointerMoveStart, pointerMoveEnd),
  /Thumbnail|thumbnail/,
  "il pointermove Paint non deve conoscere né aggiornare le miniature",
);
assert.match(
  humanLabSource,
  /HUMAN_STROKE_PERFORMANCE_TELEMETRY_REVISION = 67/,
  "il contratto persistito del benchmark deve conservare la revisione 67",
);
assert.match(engineSource, /layerBakeStrategy: typeof LAYER_BAKE_STRATEGY;/);
assert.match(engineSource, /layerCompositeStrategy: typeof LAYER_COMPOSITE_STRATEGY;/);
assert.match(sceneEditorSource, /private async setLayerVisibilityTransaction\(/);
assert.match(sceneEditorSource, /private async setLayerOpacityTransaction\(/);
assert.match(sceneEditorSource, /LAYER_BLEND_MODE_LABELS/);
assert.match(mobileToolSettingsSource, /LAYER_BLEND_MODE_CATEGORIES/);
assert.match(
  mobileToolSettingsSource,
  /for \(const category of LAYER_BLEND_MODE_CATEGORIES\)[\s\S]*?this\.layerBlendMode\.append\(group\)/,
  "la UI visibile deve costruire l'elenco completo dei metodi di fusione",
);
assert.match(sceneEditorSource, /private async setRasterBlendModeTransaction\(/);
assert.match(
  sceneEditorSource,
  /await this\.options\.engine\.setLayerBlendMode\([\s\S]*?target\.rasterIndex,[\s\S]*?blendMode/,
  "la scelta UI deve pubblicare subito il modo, senza un pulsante Applica",
);
assert.match(mainSource, /mobileLayerClippingButton/);
assert.match(sceneEditorSource, /private async setRasterClippingTransaction\(/);
assert.match(
  sceneEditorSource,
  /const changed = await this\.options\.engine\.setLayerClipping\(target\.rasterIndex, enabled\)/,
  "il controllo per riga deve agire anche su un raster esistente, non crearne uno nuovo",
);
assert.match(sceneEditorSource, /Additional consecutive masks will use the same base/);
assert.doesNotMatch(indexSource, /id="addClippingMask"/,
  "il vecchio comando globale Crea maschera non deve restare duplicato");
assert.doesNotMatch(
  indexSource,
  /id="layerList"|id="addLayer"/,
  "la lista livelli invisibile non deve restare come seconda UI autorevole",
);
assert.match(indexSource, /id="mobileLayerClipping"/);
assert.match(mainSource, /function syncActiveLayerControls\(\): void \{/);
const syncStart = mainSource.indexOf("function syncActiveLayerControls(");
const syncBody = mainSource.slice(syncStart, syncStart + 600);
assert.match(syncBody, /mobileStrokeSheet\?\.sync\(rasterStyleController\.getStrokeStyle\(\)\)/);
assert.match(syncBody, /mobileRasterEffectsSheet\?\.syncOpenStyle\(\)/);
assert.match(syncBody, /syncMobileToolsMenuState\(\)/);
assert.doesNotMatch(
  syncBody,
  /syncRaster(?:ColorOverlay|Stroke|OuterShadow|InnerShadow|Bevel)Controls/,
  "il cambio livello non deve più sincronizzare controlli effetto nascosti",
);
const selectStart = sceneEditorSource.indexOf("private async selectLayerTransaction(");
assert.notEqual(selectStart, -1, "selectLayer deve esistere");
assert.match(
  sceneEditorSource.slice(selectStart, selectStart + 5_500),
  /await this\.options\.engine\.setActiveLayer\(target\.rasterIndex\);\s*this\.options\.syncActiveRasterControls\(\);/,
  "il cambio livello deve risincronizzare i controlli degli effetti",
);
assert.match(
  sceneEditorSource,
  /const result = await this\.options\.engine\.addLayer\(\);\s*this\.options\.syncActiveRasterControls\(\);/,
  "anche la creazione di un livello deve risincronizzare i controlli",
);
assert.match(
  rasterStyleSource,
  /colorOverlayTargetIsSelected\(\): boolean \{[\s\S]*?getMixedSceneSnapshot\(\) === null[\s\S]*?canPaintSelectedSceneItem\(\);/,
  "Color Overlay deve essere modificabile solo quando è selezionato un raster",
);
assert.match(
  rasterStyleSource,
  /requiresSelectedTarget && !this\.colorOverlayTargetIsSelected\(\)/,
  "il commit UI non può ricadere sul raster di lavoro sotto un nodo vettoriale",
);
assert.match(
  indexSource,
  /id="layerLoadingOverlay"[\s\S]*?role="status"[\s\S]*?aria-live="polite"[\s\S]*?hidden/,
  "il cambio livello deve avere un indicatore fullscreen annunciato e inizialmente nascosto",
);
assert.match(stylesSource, /\.layer-loading-overlay \{[\s\S]*?position: fixed;[\s\S]*?inset: 0;/);
assert.match(stylesSource, /\.layer-loading-overlay\[hidden\] \{\s*display: none;/);
const loadingStyles = stylesSource.slice(
  stylesSource.indexOf(".layer-loading-overlay {"),
  stylesSource.indexOf(".layer-loading-overlay[hidden]"),
);
assert.match(loadingStyles, /background: rgba\(9, 11, 15, 0\.38\);/);
assert.match(loadingStyles, /-webkit-backdrop-filter: blur\(3px\);/);
assert.match(loadingStyles, /backdrop-filter: blur\(3px\);/);
assert.doesNotMatch(
  loadingStyles,
  /background: #0d0f13;/,
  "il loader non deve più sembrare un ricaricamento opaco dell'intera app",
);
assert.match(
  stylesSource,
  /\.layer-loading-content \{[\s\S]*?background: rgba\(20, 23, 31, 0\.84\);/,
  "spinner e testo devono restare in una piccola scheda semitrasparente",
);
const loadingStart = sceneEditorSource.indexOf("private async showLoading(");
const loadingBody = sceneEditorSource.slice(loadingStart, loadingStart + 1_300);
assert.match(loadingBody, /loadingOverlay\.hidden = false;/);
assert.match(
  loadingBody,
  /await this\.nextAnimationFrame\(\);\s*if \(this\.disposed\) return false;\s*await this\.nextAnimationFrame\(\);/,
  "il loader deve ricevere un paint prima del lavoro di cambio livello",
);
assert.match(loadingBody, /loadingOverlay\.hidden = true;/);
const selectUiBody = sceneEditorSource.slice(selectStart, selectStart + 5_500);
assert.match(
  selectUiBody,
  /await this\.showLoading\("Loading layer…"\)[\s\S]*?await this\.options\.engine\.setActiveLayer\(target\.rasterIndex\);[\s\S]*?await this\.options\.engine\.waitForIdle\(\);/,
  "il loader dello switch deve coprire anche presentazione e completamento GPU",
);
assert.match(selectUiBody, /finally \{[\s\S]*?this\.finish\(\{ loading: true \}\);/);
const addUiStart = sceneEditorSource.indexOf("private async addRasterLayerTransaction(");
const addUiBody = sceneEditorSource.slice(addUiStart, addUiStart + 1_300);
assert.match(
  addUiBody,
  /await this\.showLoading\("Creating layer…"\)[\s\S]*?await this\.options\.engine\.addLayer\(\);[\s\S]*?await this\.options\.engine\.waitForIdle\(\);/,
  "anche il nuovo livello deve restare coperto finché il frame è pronto",
);
assert.match(addUiBody, /finally \{[\s\S]*?this\.finish\(\{ loading: true \}\);/);

// The record's hasContent is only written back when a layer stops being active,
// so reading it for the ACTIVE layer would report "empty" while the user paints.
assert.match(
  engineSource,
  /hasContent: record\.id === engine\.layerStack\.active\.id\s*\?\s*engine\.layerHasContent\s*:\s*record\.hasContent/,
  "hasContent del livello attivo deve venire dal campo vivo, non dal record",
);
// The switch result must not claim to report a rebuilt pyramid level: the switch
// only invalidates the pyramid, and the next frame rebuilds it.
assert.doesNotMatch(engineSource, /rebuiltPyramidThroughLevel/);

// Replay is layer-aware through the same pure selector exercised behaviorally by
// history:verify. This assertion is only the integration seam: it prevents the
// engine from drifting back to a second, untested implementation.
const rebuildStart = engineSource.indexOf("export async function rebuildActiveLayerFromHistory(");
assert.notEqual(rebuildStart, -1, "il replay deve dichiarare di ricostruire il livello ATTIVO");
const rebuildBody = engineSource.slice(rebuildStart, rebuildStart + 2_200);
assert.match(
  rebuildBody,
  /const replayPlan = checkpointOverride[\s\S]*?: planRasterHistoryReplay\(\{\s*actions: engine\.historyActions,\s*cursor: engine\.historyCursor,\s*batches: engine\.historyBatches,\s*layerId,\s*periodicSelection,\s*sessionBaseline: restoredProjectBaseline,\s*\}\)/,
  "il replay reale deve usare l'unico planner condiviso, salvo il rollback checkpoint esplicito",
);
assert.match(
  historyReplayPlanSource,
  /const journalSelection = selectLayerReplayAfterCheckpoint\(\s*options\.actions,\s*options\.cursor,\s*options\.batches,\s*options\.layerId,\s*\)/,
  "il planner condiviso deve restare per-livello e checkpoint-aware",
);
assert.match(
  rebuildBody,
  /periodicCheckpointChainForReplay\(engine, layerId\)/,
  "il replay deve preferire il checkpoint periodico più vicino quando è più recente",
);
// Nothing in the replay may index the unfiltered array, or a single stray index
// would reintroduce another layer's batch.
// Il ricevitore è alternato: nella classe è `this`, nei moduli estratti è
// `engine`. Un negativo ancorato a un solo ricevitore non fallirebbe mai.
assert.doesNotMatch(
  engineSource.slice(rebuildStart, rebuildStart + 5_000),
  /(this|engine)\.historyBatches\[/,
  "il replay non deve indicizzare l'array non filtrato",
);

// Crossing another LIVE layer is supported transactionally. Only a step whose
// owner was deleted is refused, both in button state and in the engine API.
assert.match(
  engineSource,
  /export function historyStepBlockedByLayer\(engine: BrushEngine, delta: -1 \| 1\): boolean \{/,
);
const historyGateStart = engineSource.indexOf("export function historyStepBlockedByLayer(");
const historyGateEnd = engineSource.indexOf(
  "export function maybeInjectHistoryReplayFault(",
  historyGateStart,
);
assertSection("historyStepBlockedByLayer", historyGateStart, historyGateEnd);
const historyGateBody = engineSource.slice(historyGateStart, historyGateEnd);
assert.match(
  historyGateBody,
  /return historyStepTargetsMissingLayer\(/,
  "anche il gate per-passo deve usare la funzione pura testata",
);
assert.match(engineSource, /const undoBlockedReason = this\.historyBlockedReason\(-1\)/);
assert.match(engineSource, /const redoBlockedReason = this\.historyBlockedReason\(1\)/);
assert.match(engineSource, /canUndo: undoBlockedReason === null/);
assert.match(engineSource, /canRedo: redoBlockedReason === null/);
const cursorStart = engineSource.indexOf("export async function moveHistoryCursor(");
const cursorEnd = engineSource.indexOf(
  "export async function rebuildActiveLayerFromHistory(",
  cursorStart,
);
const cursorBody = engineSource.slice(cursorStart, cursorEnd);
assert.match(
  cursorBody,
  /if \(historyStepBlockedByLayer\(engine, delta\)\) \{/,
  "il gate deve valere anche chiamando l'API, non solo il bottone",
);
assert.match(
  cursorBody,
  /delta < 0[\s\S]*cannot be undone[\s\S]*cannot be redone/,
  "il messaggio del gate deve distinguere Undo da Redo",
);

// The cross-layer transaction has three non-interchangeable phases: derive the
// switch before the awaited activation, restore a partially written TARGET under
// the old cursor, then reactivate the original layer. Reversing the last two loses
// pixels while CPU cursor/index state still looks correct.
const evictStart = engineSource.indexOf("export function evictReconstructibleLayerResources(");
const evictEnd = engineSource.indexOf("export async function ensureActiveLayerHot(", evictStart);
const evictBody = engineSource.slice(evictStart, evictEnd);
assert.match(
  evictBody,
  /if \(record\.hasContent && !gpu\.cold && !gpu\.compressed\)[\s\S]*?throw new Error/,
  "un hot con contenuto non può essere evacuato senza storage raw o compresso autorevole",
);
const evictFreeze = evictBody.indexOf("engine.layerPresentationFrozen = true;");
const evictBake = evictBody.indexOf("engine.destroyLayerBake(gpu.bake);");
const evictHot = evictBody.indexOf("destroyLayerHot(gpu.hot);");
assert.ok(
  evictFreeze >= 0 && evictBake > evictFreeze && evictHot > evictBake,
  "l'evizione deve congelare il display e liberare bake e hot in quest'ordine",
);
const prepareStart = engineSource.indexOf("async prepareActiveLayerForSwitch(");
const prepareBody = engineSource.slice(prepareStart, prepareStart + 1_800);
assert.match(
  prepareBody,
  /if \(import\.meta\.env\.DEV && this\.layerBakeFaultQueue\.length > 0\) \{\s*await bakeActiveLayerForSwitch\(this\);/,
  "il bake completo resta soltanto come sonda transazionale DEV",
);
assert.match(
  prepareBody,
  /this\.layerStack\.active\.id === this\.layerStack\.referenceLayerId[\s\S]*?this\.layerPresentationFrozen = true;[\s\S]*?return;/,
  "il riferimento deve restare hot e autorevole quando si attiva la destinazione",
);
const prepareFreeze = prepareBody.indexOf("await freezeActiveLayerToCold(this);");
const prepareEvict = prepareBody.indexOf(
  "evictReconstructibleLayerResources(this, this.layerStack.active);",
);
assert.ok(
  prepareFreeze >= 0 && prepareEvict > prepareFreeze,
  "la preparazione deve completare il cold autorevole prima dell'evizione",
);
assert.match(prepareBody, /catch \(error\)[\s\S]*?this\.destroyLayerBake\(gpu\.bake\)/,
  "un pack fallito deve rilasciare l'eventuale bake della sonda DEV");

// Moving the one Reference identity is a strict GPU-residency transaction.
// The outgoing Reference becomes cold only after its candidate has completed;
// allocation failure restores the old identity and never substitutes a slower
// source. This protects the no-fallback contract from a future refactor.
const referenceSetStart = engineSource.indexOf("export async function setLayerReference(");
const referenceSetEnd = engineSource.indexOf(
  "export async function shrinkEffectsScratchAfterIdle(",
  referenceSetStart,
);
assertSection("setLayerReference", referenceSetStart, referenceSetEnd);
const referenceSetBody = engineSource.slice(referenceSetStart, referenceSetEnd);
const referenceCandidate = referenceSetBody.indexOf(
  "demotion = await createReferenceLayerDemotion(engine, previousReference);",
);
const referenceIdentityChange = referenceSetBody.indexOf(
  "engine.layerStack.setReferenceIndex(enabled ? index : null);",
);
const referenceColdPublish = referenceSetBody.indexOf(
  "demotion.gpu.cold = demotion.cold;",
);
const referenceHotDestroy = referenceSetBody.indexOf("destroyLayerHot(demotion.hot);");
assert.ok(
  referenceCandidate >= 0
    && referenceCandidate < referenceIdentityChange
    && referenceIdentityChange < referenceColdPublish
    && referenceColdPublish < referenceHotDestroy,
  "il nuovo cold deve completarsi prima del cambio identità e l'hot uscente va distrutto per ultimo",
);
assert.match(
  referenceSetBody,
  /catch \(error\) \{[\s\S]*?if \(referenceChanged\) \{[\s\S]*?setReferenceIndex\(previousIndex >= 0 \? previousIndex : null\);[\s\S]*?retargetFillRendererSource\(engine\);/,
  "un errore prima del commit deve ripristinare identità e sorgente Fill precedenti",
);
assert.match(
  referenceSetBody,
  /if \(demotion\?\.cold\) \{\s*destroyLayerColdStorage\(demotion\.cold\);\s*\}[\s\S]*?throw error;/,
  "il candidato non pubblicato va distrutto e l'errore deve propagarsi senza fallback",
);
assert.doesNotMatch(
  referenceSetBody,
  /ensureActiveLayerHot|createHydratedLayerTexture|setReferenceIndex\(null\)[\s\S]*?return true/,
  "il cambio Riferimento non deve reidratare o degradare silenziosamente sull'attivo",
);

const residencyCommitStart = engineSource.indexOf(
  "export function commitActiveLayerResidency(",
);
const residencyCommitEnd = engineSource.indexOf(
  "export function rebuildActiveLayerPyramidBindings(",
  residencyCommitStart,
);
assertSection("commitActiveLayerResidency", residencyCommitStart, residencyCommitEnd);
const residencyCommitBody = engineSource.slice(residencyCommitStart, residencyCommitEnd);
const referenceResidencyGate = residencyCommitBody.indexOf(
  "previousRecord.id === engine.layerStack.referenceLayerId",
);
const outgoingHotDestroy = residencyCommitBody.indexOf("destroyLayerHot(previousGpu.hot);");
assert.ok(
  referenceResidencyGate >= 0 && outgoingHotDestroy > referenceResidencyGate,
  "il commit dello switch deve uscire prima di distruggere l'hot del Riferimento",
);
const switchedDeclaration = cursorBody.indexOf("const switched =");
const historyOutgoingPrepare = cursorBody.indexOf("await engine.prepareActiveLayerForSwitch();");
const forwardIndexChange = cursorBody.indexOf("engine.layerStack.setActiveIndex(targetIndex);");
const forwardActivation = cursorBody.indexOf(
  'await engine.activateLayer(previousActiveIndex, "history-replay");',
);
assert.ok(switchedDeclaration >= 0 && switchedDeclaration < forwardActivation,
  "switched deve essere noto prima che activateLayer possa fallire");
assert.ok(
  historyOutgoingPrepare > switchedDeclaration && historyOutgoingPrepare < forwardIndexChange,
  "Undo/Redo cross-layer deve preparare il cold ed evacuare l'uscente prima del target",
);
const operationCatch = cursorBody.indexOf("catch (operationError)");
const cursorRestore = cursorBody.indexOf(
  "engine.history.setCursor(previousCursor);",
  operationCatch,
);
const targetRestore = cursorBody.indexOf(
  "await rebuildActiveLayerFromHistory(engine);",
  operationCatch,
);
const rollbackPrepare = cursorBody.indexOf(
  "await engine.prepareActiveLayerForSwitch();",
  operationCatch,
);
const reverseIndex = cursorBody.indexOf(
  "engine.layerStack.setActiveIndex(previousActiveIndex);",
  operationCatch,
);
const reverseActivation = cursorBody.indexOf(
  'await engine.activateLayer(targetIndex, "history-replay");',
  operationCatch,
);
assert.ok(
  operationCatch >= 0
    && cursorRestore > operationCatch
    && targetRestore > cursorRestore
    && rollbackPrepare > targetRestore
    && reverseIndex > rollbackPrepare
    && reverseActivation > reverseIndex,
  "il rollback deve ripristinare, impacchettare e poi lasciare il target",
);
const rollbackEvict = cursorBody.indexOf(
  "evictReconstructibleLayerResources(engine, engine.layerStack.at(targetIndex));",
  operationCatch,
);
assert.ok(
  rollbackEvict > rollbackPrepare && rollbackEvict < reverseIndex,
  "il rollback history deve evacuare il target fallito prima di reidratare l'origine",
);
assert.match(cursorBody, /engine\.historyStateInconsistent = true;/,
  "un rollback fallito deve alzare il latch fatale");
assert.match(cursorBody, /if \(switched && targetPreparedForRelease\)/,
  "un pack fallito deve conservare il full-canvas e impedire lo switch inverso distruttivo");
assert.match(cursorBody, /Reload the page before continuing/,
  "anche l'errore propagato alla UI deve dire che serve il reload");
assert.match(cursorBody, /engine\.historyBusy = engine\.historyStateInconsistent;/,
  "il latch fatale deve mantenere bloccate le mutazioni");
assert.match(cursorBody, /engine\.historyReplayFaultQueue = \[\];/,
  "un fault point non consumato non deve contaminare la transazione successiva");
assert.match(cursorBody, /engine\.layerColdStorageFaultQueue = \[\];/,
  "un fault cold non consumato non deve contaminare la transazione successiva");
assert.match(engineSource, /inconsistent: this\.historyStateInconsistent/,
  "lo stato fatale deve essere osservabile dalla UI e dai test");
// One fault point lands in the half-switch window, after engine/Blend changed
// source but before the workbench; the other lands only after a real GPU submit.
const activateStart = engineSource.indexOf("  async activateLayer(");
const activateEnd = engineSource.indexOf(
  "  destroyThicknessTailOverlayResources(): void",
  activateStart,
);
assertSection("activateLayer", activateStart, activateEnd);
const activateBody = engineSource.slice(activateStart, activateEnd);
const blendRetarget = activateBody.indexOf("this.blendRenderer?.retarget(");
const switchFault = activateBody.indexOf(
  'maybeInjectHistoryReplayFault(this, "during-switch-activation")',
);
const workbenchRetarget = activateBody.indexOf("retargetEffectsWorkingSetInternal(this, ");
assert.ok(
  blendRetarget >= 0 && switchFault > blendRetarget && workbenchRetarget > switchFault,
  "il fault di attivazione deve discriminare davvero uno switch parziale",
);
const replayEnd = engineSource.indexOf(
  "export async function applyVectorHistoryState(",
  rebuildStart,
);
assertSection("rebuildActiveLayerFromHistory", rebuildStart, replayEnd);
const replayBody = engineSource.slice(rebuildStart, replayEnd);
assert.match(replayBody, /maybeInjectHistoryReplayFault\(engine, "after-first-replay-submit"\)/);
assert.ok(
  [...replayBody.matchAll(/observeReplaySubmit\(\);/g)].length >= 4,
  "ogni variante del primo submit Paint/Blend/clear deve raggiungere il fault point",
);
const vectorHistoryStart = replayEnd;
const vectorHistoryEnd = engineSource.indexOf(
  "export function recordBlendHistoryBatch(",
  vectorHistoryStart,
);
assertSection("applyVectorHistoryState", vectorHistoryStart, vectorHistoryEnd);
const vectorHistoryBody = engineSource.slice(vectorHistoryStart, vectorHistoryEnd);
assert.match(
  vectorHistoryBody,
  /caller: EffectsRetargetCaller = "layer-switch"/,
  "il ripristino diretto vettoriale conserva il gate di layer switch",
);
assert.equal(
  (vectorHistoryBody.match(/rebuildMergedLayerSurfaces\(\s*caller,/g) ?? []).length,
  2,
  "commit e rollback vettoriali devono propagare lo stesso caller",
);
assert.match(
  engineSource,
  /crossedAction\.kind === "vector"[\s\S]{0,500}applyVectorHistoryState\([\s\S]{0,240}"history-replay"/,
  "Undo/Redo vettoriale deve dichiarare il contesto History al banco effetti",
);
assert.match(
  vectorHistoryBody,
  /const combined = new Error\([\s\S]*?latchDocumentStateInconsistent\([\s\S]*?combined/,
  "il doppio fallimento vettoriale deve restare diagnosticabile",
);

// The GPU regression is persistent, destructive on a fresh page and capped.
// History rollback and the absolute three-surface compositor references run in
// the same `?layerHistoryTest=1` harness.
const layerHistoryGpuTestSource = readFileSync(
  new URL("../src/labs/gpu/layer-history-gpu-test.ts", import.meta.url),
  "utf8",
);
const layerCompositeGpuTestSource = readFileSync(
  new URL("../src/labs/gpu/layer-composite-gpu-test.ts", import.meta.url),
  "utf8",
);
assert.doesNotMatch(mainSource, /layerHistoryTest|runLayerHistoryGpuTest/);
assert.match(editorLabsSource, /case "layer-history"/);
assert.match(editorLabsSource, /import\("\.\/gpu\/layer-history-gpu-test"\)/);
assert.match(editorLabsSource, /runLayerHistoryGpuTest\(engine\)/);
assert.match(
  editorLabsSource,
  /return await Promise\.race\(\[\s*runLayerHistoryGpuTest\(engine\),/,
  "l'esecuzione dell'harness deve avere un tetto di tempo",
);
assert.match(editorLabsSource, /Test livelli scaduto dopo 180 s/);
assert.match(editorLabsSource, /180_000/);
assert.match(editorLabsSource, /window\.clearTimeout\(timeoutId\)/,
  "il timer dell'harness deve essere disarmato dopo successo o errore");
assert.match(editorLabsSource, /this\.#latchedBusy = true/,
  "dopo timeout la pagina Labs deve restare bloccata perché Promise.race non cancella il test");
assert.match(layerHistoryGpuTestSource, /LAYER_HISTORY_GPU_TEST_VERSION = 13 as const/);
assert.match(layerHistoryGpuTestSource, /await engine\.duplicateSelectedLayer\(\)/);
assert.match(layerHistoryGpuTestSource, /duplicatePaintUndoUsedSeedByteExactly/);
assert.match(layerHistoryGpuTestSource, /duplicateStructuralUndoRedoWasByteExact/);
assert.match(layerHistoryGpuTestSource, /initialStats\.layerFormat !== "rgba16float"/);
assert.match(layerHistoryGpuTestSource, /const rawBytesPerPixel = 8 as const/);
assert.match(layerHistoryGpuTestSource, /storageStudyUsesRgba16fBytes/);
assert.match(layerHistoryGpuTestSource, /crossLayerRedoRestoredAStrokeByteExactly/);
assert.match(layerHistoryGpuTestSource, /redoRestoredBByteExactly/);
assert.match(layerCompositeGpuTestSource, /fiveLayerSwitchMemoryPeaks/);
assert.match(layerCompositeGpuTestSource, /fiveLayerMiddleSwitchMemoryPeaks/);
assert.match(layerCompositeGpuTestSource, /measureMemoryPeakDuring/);
assert.match(layerHistoryGpuTestSource, /measureActiveStyleBakeGap\(engine, pRect\)/);
assert.match(layerHistoryGpuTestSource, /engine\.injectLayerBakeFault\("after-candidate-submit"\)/);
assert.match(layerHistoryGpuTestSource, /injectedBakeFailureReleasedCandidate/);
assert.match(layerHistoryGpuTestSource, /readLayerPixels\(auditRect, 0\)/);
assert.match(layerHistoryGpuTestSource, /readLayerPixels\(auditRect, 1\)/);
assert.match(layerHistoryGpuTestSource, /const undoReturned = await engine\.undo\(\)/);
assert.match(layerHistoryGpuTestSource, /const redoReturned = await engine\.redo\(\)/);
assert.match(
  layerHistoryGpuTestSource,
  /await engine\.setActiveLayer\(1\);\s*const activeBeforeCrossLayerRedo[\s\S]*?const crossLayerRedoReturned = await engine\.redo\(\)/,
  "il redo cross-layer deve partire deliberatamente dal livello sbagliato",
);
assert.match(
  layerHistoryGpuTestSource,
  /await engine\.setActiveLayer\(0\);[\s\S]{0,500}await draw\(768, 512,[\s\S]{0,500}const layerAHistoryBaseline[\s\S]{0,250}await engine\.setActiveLayer\(1\)/,
  "il probe cross-layer deve registrare un Paint su A dopo layer-add e tornare su B",
);
assert.match(layerHistoryGpuTestSource, /probeRollback\("after-first-replay-submit"\)/);
assert.match(layerHistoryGpuTestSource, /probeRollback\("during-switch-activation"\)/);
assert.match(
  layerHistoryGpuTestSource,
  /probeRollback\(\s*"after-first-replay-submit",\s*"during-switch-activation",\s*\)/,
  "il test deve esercitare anche un errore durante il rollback",
);
assert.match(layerHistoryGpuTestSource, /fatalRollbackLatchedInconsistent: fatalRollback\.historyInconsistent/);
assert.match(layerHistoryGpuTestSource, /fatalLatchRefusedAnotherUndo: !fatalFollowUpUndoReturned/);
assert.match(layerHistoryGpuTestSource, /twoAndFiveLayerMipMemoryTracksBoundedComposites/);
assert.match(layerHistoryGpuTestSource, /twoAndFiveLayerCompositeMemoryIsBounded/);
assert.match(layerCompositeGpuTestSource, /decodeFloat16/);
assert.match(
  layerCompositeGpuTestSource,
  /const fullLayerMiB = engine\.layerSize \* engine\.layerSize \* 8/,
);

assert.match(layerCompositeGpuTestSource, /expectedPresentation\(/);
assert.match(layerCompositeGpuTestSource, /sourceOver\(above, sourceOver\(active, below\)\)/,
  "il riferimento indipendente deve fissare sopra over attivo over sotto");
assert.match(layerCompositeGpuTestSource, /wrongSrgbSpacePresentation\(/,
  "il riferimento deve discriminare la composizione eseguita nello spazio sbagliato");
assert.match(layerCompositeGpuTestSource, /engine\.injectLayerCompositeFault\("after-candidate-submit"\)/);
assert.match(layerCompositeGpuTestSource, /setLayerOpacity\(2, 0\.25\)/);
assert.match(layerCompositeGpuTestSource, /setLayerVisibility\(2, false\)/);
assert.match(layerCompositeGpuTestSource, /readMergedLayerPixels\(\s*"above",[\s\S]*?2,\s*true,/,
  "la sonda matematica zoom deve completare esplicitamente la piramide merged");
assert.match(layerCompositeGpuTestSource, /zoomBuiltFinalRasterStackMip2/,
  "il test visuale zoom deve verificare il percorso final-raster-stack corrente");
assert.match(layerCompositeGpuTestSource, /zoomExplicitReadbackCompletedMergedAboveMip2/);
assert.match(layerCompositeGpuTestSource, /zoomMip2MatchesIndependentBoxFilter/);
assert.match(layerCompositeGpuTestSource, /fiveLayerBakesWereReleased/);
assert.match(layerCompositeGpuTestSource, /opaqueRawFastPathIsByteExact/);
// The switch lock has to be held across the awaits, or a pointerdown landing
// during the 150-215 ms rebuild starts a stroke on a half-swapped layer.
// Ancorata alla dichiarazione del campo: un assegnamento dentro un `finally`
// soddisfarebbe il pattern senza provare che il campo esista ancora.
assert.match(engineSource, /^ {2}layerSwitchBusy = false;$/m);
assert.match(
  engineSource,
  /if \(\s*this\.historyBusy\s*\|\| this\.activeStroke\s*\|\| this\.straightLineAdjustment\s*\|\| this\.layerSwitchBusy\s*\|\| this\.selectionBusy\s*\) \{/,
  "beginStrokeAtLayer deve rifiutare durante uno switch",
);
assert.match(mainSource, /return !engineInitialized\s*\|\| sceneEditorController\?\.isBusy === true/,
  "il lock di switch deve entrare in operationLocked, non solo nella lista");

// The workbench is one retargetable instance, so a layer whose record says
// Traccia OR Smusso is enabled can arrive after another layer released the
// renderer. Without this the checkbox returns on and the effect stays absent.
assert.match(engineSource, /async ensureEffectRenderersForRecord\(record: LayerRecord\): Promise<void>/);
assert.match(
  engineSource,
  /await ensureEffectRenderersForRecord\(this, record\);/,
  "activateLayer deve garantire i renderer del livello entrante",
);
const ensureStart = engineSource.indexOf("export async function ensureEffectRenderersForRecord(");
const ensureBody = engineSource.slice(ensureStart, ensureStart + 1_800);
assert.match(ensureBody, /layerEffectRendererRequirements\(/,
  "la decisione Smusso-only deve passare dall'invariante testato");
assert.match(ensureBody, /if \(requirements\.needsStrokeRenderer\)/,
  "Smusso deve ricreare anche il compositore Traccia");
assert.match(
  ensureBody,
  /rasterStrokeScratchExtentForRenderer\([\s\S]*?strokeGeometryActive,[\s\S]*?requirements\.strokeWidth/,
  "il tier dipende dall'attività della Traccia e dalla width del livello entrante",
);
assert.match(ensureBody, /record\.strokeStyle\.enabled && record\.strokeStyle\.width > 0/,
  "un compositore senza Traccia deve usare lo scratch minimo");
assert.match(ensureBody, /renderer\.resizeScratch\(scratchExtent\)/);
assert.match(ensureBody, /setRasterStrokeGeometryEnabled\(engine, false\)/,
  "un livello senza Traccia deve liberare la geometria residente condivisa");
assert.match(engineSource, /strokeGeometryEnabled: strokeGeometryActive/,
  "la creazione del compositore deve rispettare la Traccia del livello entrante");

// A failed activation mutates Blend, effects and live content fields before it
// can reject. Rollback therefore has to run the complete activation path back
// to the outgoing layer; rebinding only the texture is not sufficient.
const selectMethodStart = engineSource.indexOf("async setActiveLayer(");
const selectMethodBody = engineSource.slice(selectMethodStart, selectMethodStart + 2_600);
assert.match(selectMethodBody, /activationStarted = true/);
const selectPrepare = selectMethodBody.indexOf("await this.prepareActiveLayerForSwitch();");
const selectIndexChange = selectMethodBody.indexOf("this.layerStack.setActiveIndex(index);");
assert.ok(
  selectPrepare >= 0 && selectIndexChange > selectPrepare,
  "setActiveLayer deve completare pack ed evizione prima di cambiare indice",
);
assert.match(selectMethodBody, /evictReconstructibleLayerResources\(this, this\.layerStack\.at\(index\)\);[\s\S]*?this\.layerStack\.setActiveIndex\(fromIndex\);[\s\S]*?await this\.activateLayer\(index\);/,
  "il rollback dello switch deve evacuare il target fallito prima di reidratare l'origine");
assert.match(selectMethodBody, /this\.layerStack\.setActiveIndex\(fromIndex\);[\s\S]*?await this\.activateLayer\(index\);/,
  "il rollback dello switch deve ritargettare tutti i sottosistemi");
assert.match(selectMethodBody, /State is inconsistent after switching layers[\s\S]*?Reload the page/,
  "un doppio fallimento dello switch deve alzare il latch fatale");
const addMethodStart = engineSource.indexOf("async addLayer(");
// La transazione include ora anche il rollback dello stack misto raster/testo.
const addMethodEnd = engineSource.indexOf("async setActiveLayer(", addMethodStart);
assertSection("add layer", addMethodStart, addMethodEnd);
const addMethodBody = engineSource.slice(addMethodStart, addMethodEnd);
const addPrepare = addMethodBody.indexOf("await this.prepareActiveLayerForSwitch();");
const addRecord = addMethodBody.indexOf("this.layerStack.insertAt(layerInsertIndex, name)");
assert.ok(
  addPrepare >= 0 && addRecord > addPrepare,
  "addLayer deve congelare e impacchettare l'uscente prima del nuovo record",
);
assert.match(
  addMethodBody,
  /planMixedSceneRasterInsertion\([\s\S]*?scene\.selected\.key,[\s\S]*?clippingParentId/,
  "stack raster e scena mista devono derivare entrambi da un solo slot autorevole",
);
assert.match(
  addMethodBody,
  /scene\.insertRasterAt\(record\.id, sceneInsertIndex\)/,
  "l'inserimento eterogeneo pianificato deve pubblicare lo stesso raster nella scena",
);
assert.match(addMethodBody, /await allocateLayerGpuResources\(this,/);
const addActivation = addMethodBody.indexOf(
  "const result = await this.activateLayer(outgoingIndexAfterInsertion);",
);
const addLiveTextClear = addMethodBody.indexOf("this.clearVectorTextPresentation();");
assert.ok(
  addActivation >= 0 && addLiveTextClear > addActivation,
  "addLayer deve liberare la preview testo soltanto dopo che activateLayer ha "
    + "sbloccato la presentazione, altrimenti waitForIdle resta su displayDirty",
);
assert.match(addMethodBody, /State is inconsistent after layer creation\. Reload before continuing/,
  "un doppio fallimento di addLayer deve alzare il latch fatale");
assert.match(
  addMethodBody,
  /const combined = new Error\([\s\S]*?Reload the page before continuing[\s\S]*?latchDocumentStateInconsistent\([\s\S]*?combined/,
  "la diagnosi fatale di Add deve conservare insieme errore iniziale e rollback",
);
assert.match(addMethodBody, /const insertedIndex = this\.layerStack\.indexOfId\(record\.id\);[\s\S]*?this\.layerStack\.remove\(insertedIndex\);[\s\S]*?const restoredIndex = this\.layerStack\.indexOfId\(activeRasterLayerIdBefore\);[\s\S]*?await this\.activateLayer\(restoredIndex\);/,
  "un OOM del nuovo mip 0 deve reidratare l'uscente già evacuato");
assert.match(addMethodBody, /evictReconstructibleLayerResources\(this, record\);[\s\S]*?const candidateIndex = this\.layerStack\.indexOfId\(record\.id\);[\s\S]*?this\.layerStack\.remove\(candidateIndex\);[\s\S]*?const restoredIndex = this\.layerStack\.indexOfId\(activeRasterLayerIdBefore\);[\s\S]*?await this\.activateLayer\(restoredIndex\);/,
  "il rollback di addLayer deve evacuare il nuovo hot prima di reidratare l'origine");
assert.match(addMethodBody, /this\.layerGpu\.delete\(record\.id\);[\s\S]*?destroyLayerGpuResources\(this, gpu\);[\s\S]*?await this\.activateLayer\(restoredIndex\);/,
  "il candidato fallito deve essere rimosso prima di ricostruire la scena originaria");

// Measurement setups reset the GLOBAL journal but clear only the active layer.
assert.match(engineSource, /get documentWideResetBlockedByLayers\(\): boolean/);
assert.match(engineSource, /if \(this\.documentWideResetBlockedByLayers\) \{/);
// A format change allocates the one active full texture before destruction; the
// inactive records are empty cold slots because the operation clears all layers.
assert.ok(
  engineSource.indexOf("const replacement = new Map<number, LayerGpuResources>();")
    < engineSource.indexOf("const supersededLayerGpu = [...engine.layerGpu.values()];"),
  "il cambio formato deve allocare prima di distruggere",
);
const recreateStart = engineSource.indexOf("export async function recreateLayerResources(");
const recreateEnd = engineSource.indexOf(
  "export async function retargetEffectsWorkingSetInternal(",
  recreateStart,
);
assert.ok(recreateStart >= 0 && recreateEnd > recreateStart,
  "il verifier deve isolare per intero recreateLayerResources");
const recreateBody = engineSource.slice(recreateStart, recreateEnd);
assert.match(recreateBody, /runGpuAllocationTransaction\(\s*engine\.device,\s*`Layer format pipeline/,
  "anche pipeline e layout devono chiudere validation/OOM scope");
assert.match(recreateBody, /record\.id === engine\.layerStack\.active\.id[\s\S]*?await allocateLayerGpuResources\(engine,[\s\S]*?: createColdLayerGpuResources\(\)/,
  "il cambio formato deve allocare full solo per il livello attivo");
assert.match(recreateBody, /for \(const gpu of replacement\.values\(\)\) \{\s*destroyLayerGpuResources\(engine, gpu\);/,
  "un fallimento deve eliminare tutti i candidati, incluso quello attivo");
assert.doesNotMatch(recreateBody, /layerId !== (this|engine)\.layerStack\.active\.id/,
  "il cleanup non può saltare il candidato del livello attivo");

// Public mutations must not interleave with the awaited layer switch.
assert.match(
  engineSource,
  /setBrushSettings\([\s\S]*?this\.initialized && \(this\.layerSwitchBusy \|\| this\.historyBusy\)/,
  "le impostazioni non devono riattivare render o allocazioni dopo un latch fatale",
);
assert.doesNotMatch(engineSource, /\bsetLayerFormat\(/);
assert.match(
  labOperationsSource,
  /async function benchmarkEffectsWorkingSet\([\s\S]*?engine\.layerSwitchBusy/,
);
// Each caller's exemption is named rather than passed as an unreadable boolean.
// A layer switch may cross layerSwitchBusy because that flag is its own;
// history replay and structural SVG history may cross historyBusy because they
// are the history transaction.
assert.match(
  engineSource,
  /type EffectsRetargetCaller =[\s\S]*?\| "public"[\s\S]*?\| "layer-switch"[\s\S]*?\| "history-replay"[\s\S]*?\| "structural-history";/,
);
assert.match(engineSource, /\(!duringLayerSwitch && engine\.layerSwitchBusy\)/,
  "solo i retarget interni possono attraversare il lock di switch");
assert.match(engineSource, /\(!duringHistoryTransaction && engine\.historyBusy\)/,
  "solo le transazioni history nominate possono attraversare historyBusy");
assert.match(
  engineSource,
  /const duringHistoryTransaction =[\s\S]*?caller === "history-replay" \|\| caller === "structural-history";/,
);
// The public entry point must never grant itself an exemption.
assert.match(
  engineSource,
  /return retargetEffectsWorkingSetInternal\(this,\s*layerView,\s*layerFormat,\s*contentBounds,\s*"public",\s*\)/,
);
// Telemetry has to sign both layer identity and actual hot/cold storage.
assert.match(engineSource, /layerCount: engine\.layerStack\.count/);
assert.match(
  engineSource,
  /layerMemoryMiB:\s*gpuMemory\.layerBaseMiB\s*\+ gpuMemory\.layerColdMiB\s*\+ gpuMemory\.layerHydrationMiB/,
);
assert.match(engineSource, /layerCount: number;/);
assert.match(engineSource, /activeLayerId: number;/);

const layerStorageStudySource = readFileSync(
  new URL("../src/layer-storage-study.ts", import.meta.url),
  "utf8",
);
assert.match(
  layerStorageStudySource,
  /single-active-plus-optional-reference-full-inactive-256-array-tiles-direct-native-fold-fallback-rehydrate/,
);
assert.match(layerStorageStudySource, /LAYER_STORAGE_TILE_WIDTH = DOCUMENT_TILE_WIDTH/);
assert.match(layerStorageStudySource, /LAYER_STORAGE_TILE_HEIGHT = DOCUMENT_TILE_HEIGHT/);
assert.match(layerStorageStudySource, /LAYER_STORAGE_DOCUMENT_WIDTH = DOCUMENT_WIDTH/);
assert.match(layerStorageStudySource, /LAYER_STORAGE_DOCUMENT_HEIGHT = DOCUMENT_HEIGHT/);
assert.match(
  layerStorageStudySource,
  /Math\.floor\(pixelLeft \/ LAYER_STORAGE_TILE_WIDTH\)[\s\S]*?Math\.floor\(pixelTop \/ LAYER_STORAGE_TILE_HEIGHT\)/,
  "la griglia cold deve mappare X e Y con estensioni tile indipendenti",
);
assert.match(layerStorageStudySource, /"Occupied" deliberately means ANY non-zero byte/);
assert.doesNotMatch(
  layerStorageStudySource,
  /GPUTexture|GPUBuffer|GPUDevice|GPUQueue/,
  "la matematica delle tile deve restare pura e testabile senza WebGPU",
);
const mutationStart = engineSource.indexOf("noteLayerMutation(");
const mutationBody = engineSource.slice(mutationStart, mutationStart + 1_100);
assert.match(
  mutationBody,
  /clearLayerStorageTileMask\(this\.layerStack\.active\.storageTileMask\)/,
  "clear deve azzerare la maschera del solo livello attivo",
);
assert.match(
  mutationBody,
  /markLayerStorageRect\(this\.layerStack\.active\.storageTileMask, dirtyRect\)/,
  "ogni mutazione raw deve raggiungere il collo di bottiglia della maschera",
);
const packStart = engineSource.indexOf("export async function createLayerColdStorageCandidate(");
const packBody = engineSource.slice(packStart, packStart + 4_300);
assert.match(packBody, /hot\.format !== engine\.layerFormat/);
assert.match(packBody, /const format = hot\.format/);
assert.match(packBody, /layerFormatBytesPerPixel\(format\)/);
assert.match(packBody, /return \{ texture, tileIndices, memoryBytes, generation, format \}/);
assert.match(packBody, /depthOrArrayLayers: tileIndices\.length/);
assert.match(packBody, /tileIndices\.forEach\(\(tileIndex, arrayLayer\) =>/);
assert.match(packBody, /copyTextureToTexture\(/);
assert.ok(
  packBody.indexOf("await engine.waitForGpuCapped(")
    < packBody.indexOf('engine.maybeInjectLayerColdStorageFault("after-pack-submit")'),
  "il candidato cold non può essere pubblicato prima del completamento GPU",
);
const freezeStart = engineSource.indexOf("export async function freezeActiveLayerToCold(");
const freezeBody = engineSource.slice(freezeStart, freezeStart + 1_400);
assert.match(freezeBody, /const candidate = await createLayerColdStorageCandidate\(engine,/);
assert.match(freezeBody, /gpu\.cold = candidate;/);
assert.match(freezeBody, /record\.storageTileMask\.set\(mask\)/);
const hydrateStart = engineSource.indexOf("export async function createHydratedLayerTexture(");
const hydrateBody = engineSource.slice(hydrateStart, hydrateStart + 2_600);
assert.match(hydrateBody, /encodeLayerColdHydration\(encoder, cold, hot\)/);
assert.match(engineSource, /assertColdMatchesHot\(cold, hot\)/);
// Il codec non e' piu' vincolato a quattro byte: la taglia del tile viene dal
// formato del documento. L'invariante che conta si e' spostata, non indebolita —
// un cold compresso deve descrivere lo **stesso** formato del documento, perche'
// decomprimere byte di un formato dentro una texture dell'altro produrrebbe
// pixel plausibili e sbagliati.
assert.match(
  engineSource,
  /function coldCodecTileBytes\(format: LayerFormat\)[\s\S]*?layerFormatBytesPerPixel\(format\)/,
  "la taglia del tile compresso deve seguire il formato del documento",
);
assert.doesNotMatch(
  engineSource,
  /RGBA8_COLD_CODEC_BYTES_PER_PIXEL/,
  "la costante a quattro byte non deve sopravvivere alla generalizzazione",
);
assert.match(
  engineSource,
  /compressed\.format !== engine\.layerFormat/,
  "il ripristino deve rifiutare un cold compresso di formato diverso dal documento",
);
// La compressione si paga in latenza al prossimo cambio livello, quindi non
// deve partire a vuoto. Ma il criterio non puo' essere la sola pressione: con
// un tetto largo la zona resta verde per sempre e la compressione non parte
// mai. Servono entrambe le vie — pressione **oppure** abbastanza da recuperare.
assert.match(
  engineSource,
  /compressionIsWorthwhile\(\)[\s\S]*?if \(zone !== "green"\) return true;/,
  "sotto pressione la compressione deve partire sempre",
);
assert.match(
  engineSource,
  /layerColdCompressionDistantGpuBytes\(\)\s*>= layerBytes \* LAYER_COLD_COMPRESSION_IDLE_THRESHOLD_RATIO/,
  "in zona verde la compressione deve partire quando c'e' abbastanza da recuperare",
);
assert.doesNotMatch(
  engineSource,
  /return zone !== "green";\s*\}/,
  "la sola pressione non basta come criterio: con un tetto largo non scatterebbe mai",
);
assert.match(
  engineSource,
  /!this\.layerColdCompressionEnabled \|\| !this\.compressionIsWorthwhile\(\)/,
  "il candidato alla compressione deve passare dal cancello",
);
assert.match(hydrateBody, /await engine\.waitForGpuCapped\(label\)/);
assert.match(hydrateBody, /engine\.liveLayerHydrationTextures\.set\(hot\.texture, memoryBytes\)/);
const activateStorageBody = engineSource.slice(activateStart, activateEnd);
assert.ok(
  activateStorageBody.indexOf("await ensureActiveLayerHot(this, record);")
    < activateStorageBody.indexOf("bindActiveLayerResources(this);"),
  "il livello entrante deve essere reidratato prima di legare i renderer",
);
assert.ok(
  activateStorageBody.indexOf("await this.rebuildMergedLayerSurfaces(caller);")
    < activateStorageBody.indexOf("commitActiveLayerResidency(this, fromIndex);"),
  "il cold duplicato dell'attivo può essere rilasciato solo dopo il compositing riuscito",
);
assert.match(engineSource, /const layerColdMiB = baseResourcesAllocated/);
assert.match(engineSource, /const layerHydrationMiB = \([\s\S]*?engine\.layerColdRestoreActiveBytes/);
assert.match(engineSource, /measurementOnly: false/);
assert.match(
  engineSource,
  /projectedConservativeRawMiB = residentFullMiB \+ inactiveConservativeTileMiB/,
  "la proiezione deve conservare attivo e riferimento full-canvas",
);
const exactStudyStart = engineSource.indexOf("export async function measureExactLayerStorageStudy(");
const exactStudyBody = engineSource.slice(exactStudyStart, exactStudyStart + 4_500);
assert.match(exactStudyBody, /import\.meta\.env\.DEV/);
assert.match(exactStudyBody, /await engine\.readLayerPixels\(undefined, index\)/);
assert.match(exactStudyBody, /compareLayerStorageMasks\(exactMask, record\.storageTileMask\)/);
assert.match(exactStudyBody, /countedGpuMiBBefore/);
assert.match(exactStudyBody, /countedGpuMiBAfter/);
assert.match(exactStudyBody, /temporaryReadbackPeakMiB/);
assert.match(
  layerCompositeGpuTestSource,
  /compositeSchedulingAndBoundsSignatureMatches:[\s\S]*?deferred-to-fold-fence-bounded-visual-rect/,
  "l'harness GPU deve firmare scheduling e bounds prima di leggere i tempi",
);
assert.match(
  layerCompositeGpuTestSource,
  /boundedBakeSignatureMatches:[\s\S]*?transient-analytic-bounded-visual-rect/,
  "l'harness GPU deve firmare anche il bake bounded",
);
assert.match(layerCompositeGpuTestSource, /fiveLayerAnalyticBakeDomainWasBounded/);
assert.match(layerCompositeGpuTestSource, /fiveLayerSwitchBreakdownIsConsistent/);
assert.match(layerHistoryGpuTestSource, /measureExactLayerStorageStudy\(\)/);
assert.match(layerHistoryGpuTestSource, /conservativeTilesContainEveryExactTile/);
assert.match(layerHistoryGpuTestSource, /exactReadbackReleasedItsTemporaryBuffers/);
assert.match(humanLabSource, /HUMAN_STROKE_PERFORMANCE_TELEMETRY_REVISION = 67/);
assert.match(gpuMemoryPanelSource, /gpuMemoryLayerCold/);
assert.match(gpuMemoryPanelSource, /gpuMemoryLayerCompressed/);
assert.match(gpuMemoryPanelSource, /gpuMemoryLayerHydration/);
assert.match(gpuMemoryPanelSource, /Raw layers · actual/);
assert.match(gpuMemoryPanelSource, /Logical WebGPU memory actually allocated/);
assert.match(gpuMemoryPanelSource, /this is not allocated memory/);

// The production-query stress fixture must be explicit, isolated and leave the
// ordinary layer controls available after it has built real ~1 GiB residency.
const layerMemoryStressSource = readFileSync(
  new URL("../src/labs/memory/layer-memory-stress-test.ts", import.meta.url),
  "utf8",
);
assert.doesNotMatch(mainSource, /layerMemoryStressTestRequested|runLayerMemoryStressTest/);
assert.match(labsStartupSource, /layerMemoryStressTestEnabled: true/);
assert.match(editorLabsSource, /\["memory-stress", "Stress memoria livelli"\]/);
assert.match(editorLabsSource, /import\("\.\/memory\/layer-memory-stress-test"\)/);
assert.match(labOperationsSource, /async function seedActiveLayerMemoryStress\([\s\S]*?storageTileCount = LAYER_STORAGE_TILE_COUNT/);
const memoryStressSeedStart = labOperationsSource.indexOf("export async function seedActiveLayerMemoryStress(");
const memoryStressSeedBody = labOperationsSource.slice(memoryStressSeedStart, memoryStressSeedStart + 4_000);
assert.match(memoryStressSeedBody, /engine\.layerMemoryStressTestEnabled/);
assert.match(memoryStressSeedBody, /const markerSize = 64/);
assert.match(memoryStressSeedBody, /storageTileMask\.fill\(0\)/);
assert.match(memoryStressSeedBody, /markStorageTile\(markerTileIndex\)/);
assert.match(layerMemoryStressSource, /LAYER_MEMORY_STRESS_TARGET_MIB = 1000/);
assert.match(layerMemoryStressSource, /initial\.layerCount !== 1/);
assert.match(layerMemoryStressSource, /layer\.coldTileCount !== 256/);
assert.match(layerMemoryStressSource, /layer\.conservativeTileCount !== 256/);
assert.match(layerMemoryStressSource, /manualSwitchReady: true/);

// The iPhone fixture advances in real cold-tile increments and writes a remote
// checkpoint before each allocation/switch. A restored page converts the last
// pending attempt into an interrupted result, so the user never has to copy it.
const iphoneMemoryLimitSource = readFileSync(
  new URL("../src/labs/memory/iphone-memory-limit-test.ts", import.meta.url),
  "utf8",
);
const sitesBuildSource = readFileSync(
  new URL("../scripts/prepare-sites-build.mjs", import.meta.url),
  "utf8",
);
const iphoneMemoryMigrationSource = readFileSync(
  new URL("../.openai/drizzle/0003_iphone_memory_limit_runs.sql", import.meta.url),
  "utf8",
);
assert.match(iphoneMemoryLimitSource,
  /iphone-rgba16f-gpu-plus-compressed-cpu-peaks-v3/);
assert.match(sitesBuildSource, /iphone-rgba16f-gpu-plus-compressed-cpu-peaks-v3/);
assert.match(
  iphoneMemoryLimitSource,
  /TILE_MEMORY_MIB_RGBA16F\s*=\s*\n?\s*LAYER_STORAGE_TILE_WIDTH \* LAYER_STORAGE_TILE_HEIGHT\s*\* RGBA16F_BYTES_PER_PIXEL \/ MEBIBYTE_BYTES;/,
);
assert.doesNotMatch(
  iphoneMemoryLimitSource,
  /LAYER_STORAGE_TILE_SIZE \*\* 2/,
  "il piano memoria iPhone non deve sovrastimare i tile rettangolari come quadrati",
);
assert.match(iphoneMemoryLimitSource, /initialStats\.layerFormat !== "rgba16float"/);
assert.match(iphoneMemoryLimitSource, /countedGpuPlusCompressedCpuMiB/);
assert.match(iphoneMemoryLimitSource, /peakCountedGpuPlusCompressedCpuMiB/);
assert.match(
  iphoneMemoryLimitSource,
  /variant: \{[\s\S]*?layerColdCompressionEnabled: stats\.layerColdCompressionEnabled[\s\S]*?layerColdCompressionRuntimeBuild: stats\.layerColdCompressionRuntimeBuild[\s\S]*?layerColdDirectHotHydrationEnabled:[\s\S]*?stats\.layerColdDirectHotHydrationEnabled[\s\S]*?layerColdAdjacentPrefetchEnabled:[\s\S]*?stats\.layerColdAdjacentPrefetchEnabled/,
  "ogni run iPhone deve firmare la variante lifecycle per impedire aggregazioni spurie",
);
const iphoneStoragePlanMatch = iphoneMemoryLimitSource.match(
  /IPHONE_MEMORY_LIMIT_STORAGE_TILE_PLAN = Object\.freeze\(\[([\s\S]*?)\]\)/,
);
assert.ok(iphoneStoragePlanMatch);
const iphoneStorageTilePlan = [...iphoneStoragePlanMatch[1].matchAll(/\d+/g)]
  .map((match) => Number(match[0]));
assert.equal(iphoneStorageTilePlan.length, LAYER_STACK_MAXIMUM - 1);
assert.equal(
  iphoneStorageTilePlan.reduce((sum, tileCount) => sum + tileCount, 0),
  3_328,
);
assert.ok(iphoneStorageTilePlan.every(
  (tileCount) => Number.isInteger(tileCount) && tileCount > 0 && tileCount <= 256,
));
assert.doesNotMatch(mainSource, /iphoneMemoryLimitTest|recoverInterruptedIphoneMemoryLimitRun/);
assert.match(editorLabsSource, /\["iphone-memory", "Ricerca limite iPhone"\]/);
assert.match(editorLabsSource, /recoverInterruptedIphoneMemoryLimitRun/);
assert.match(editorLabsSource, /serverRequired,/);
assert.match(iphoneMemoryLimitSource, /LOCAL_STORAGE_KEY/);
assert.match(iphoneMemoryLimitSource, /publishRunIdToHash\(run\.runId\)/);
assert.match(iphoneMemoryLimitSource, /recoverInterruptedIphoneMemoryLimitRun/);
assert.match(iphoneMemoryLimitSource, /kind: "interrupted"/);
assert.match(iphoneMemoryLimitSource, /\n\s+"switch-middle",/);
assert.match(iphoneMemoryLimitSource, /\n\s+"switch-top",/);
const firstIphoneAttempt = iphoneMemoryLimitSource.indexOf('kind: "attempt"');
const firstIphoneCheckpoint = iphoneMemoryLimitSource.indexOf(
  "await postCheckpoint(run, serverRequired)",
  firstIphoneAttempt,
);
const firstIphoneAllocation = iphoneMemoryLimitSource.indexOf(
  "await seedActiveLayerMemoryStress(engine, planIndex, storageTileCount)",
  firstIphoneAttempt,
);
assert.ok(firstIphoneAttempt >= 0 && firstIphoneCheckpoint > firstIphoneAttempt);
assert.ok(firstIphoneAllocation > firstIphoneCheckpoint);
assert.match(sitesBuildSource, /handleIphoneMemoryLimitRuns/);
assert.match(sitesBuildSource, /\/api\/iphone-memory-limit-runs/);
assert.match(sitesBuildSource, /ON CONFLICT\(id\) DO UPDATE/);
assert.match(iphoneMemoryMigrationSource, /CREATE TABLE IF NOT EXISTS iphone_memory_limit_runs/);
console.log("Layer stack verification passed.");

// --- Cancellazione: messaggi che spiegano ------------------------------------
{
  const engineSource = readFileSync(new URL("../src/brush-engine.ts", import.meta.url), "utf8");
  const panelSource = readFileSync(
    new URL("../src/layer-panel-controller.ts", import.meta.url),
    "utf8",
  );

  // Cancellare la base di un ritaglio si porta via l'intera unita'. Dire
  // "ultimo livello" mentre ne sta eliminando quattro sembra un blocco
  // arbitrario: l'utente non ha modo di capire cosa fare.
  const deleteLayer = engineSource.slice(
    engineSource.indexOf("  async deleteLayer(index: number): Promise<void> {"),
    engineSource.indexOf("this.assertLayerSwitchAllowed();",
      engineSource.indexOf("  async deleteLayer(index: number): Promise<void> {")),
  );
  assert.ok(deleteLayer.length > 0, "deleteLayer non individuata");
  assert.match(
    deleteLayer,
    /unit\.length > 1/,
    "il rifiuto deve distinguere l'unita' di ritaglio dal singolo livello",
  );
  assert.match(
    deleteLayer,
    /Deleting the clipping base also deletes its entire unit/,
    "il messaggio deve spiegare che la base si porta via il gruppo",
  );
  assert.match(
    deleteLayer,
    /Delete the masks first, /,
    "il messaggio deve dire cosa fare, non solo cosa non si puo' fare",
  );

  // Il livello bloccato usciva in silenzio: pulsante inerte, nessun messaggio,
  // indistinguibile da un guasto dell'app.
  const deleteButton = panelSource.slice(
    panelSource.indexOf("private async requestDelete(): Promise<void>"),
    panelSource.indexOf("private async duplicateSelected()", panelSource.indexOf(
      "private async requestDelete(): Promise<void>",
    )),
  );
  assert.ok(deleteButton.length > 0, "handler di eliminazione non individuato");
  assert.match(
    deleteButton,
    /if \(properties\.locked\) \{[\s\S]{0,320}Layer locked/,
    "il livello bloccato deve dire perche' non si elimina",
  );
}

console.log("Layer delete messaging verified.");

// --- Frecce Undo/Redo: lo stato spento si deve vedere -------------------------
// Le frecce mobile restano toccabili di proposito, cosi' un'operazione bloccata
// puo' spiegarsi invece di sembrare un tocco perso: `disabled` resta `false` e
// lo stato passa per `aria-disabled` e `.is-disabled`. Il risultato e' che il
// segnale e' solo visivo, e va garantito qui — altrimenti le frecce sembrano
// sempre accese e non dicono piu' se puoi andare avanti o indietro.
{
  const historyControlsSource = readFileSync(
    new URL("../src/history-controls-controller.ts", import.meta.url),
    "utf8",
  );
  const cssSource = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

  const controlli = historyControlsSource.slice(
    historyControlsSource.indexOf("refreshControls(): void {"),
    historyControlsSource.indexOf("request(operation: HistoryOperation)"),
  );
  assert.ok(controlli.length > 0, "HistoryControlsController.refreshControls non individuato");
  assert.match(
    controlli,
    /button\.setAttribute\("aria-disabled", String\(blocked\)\)/,
    "lo stato bloccato va esposto su aria-disabled",
  );
  assert.match(
    controlli,
    /button\.classList\.toggle\("is-disabled", blocked\)/,
    "lo stato bloccato va esposto anche come classe, per lo stile",
  );

  // Lo stato spento deve attenuare davvero. `opacity: 1` qui significa
  // "identico ad acceso": e' il bug che questa asserzione impedisce.
  const spento = cssSource.slice(
    cssSource.indexOf(".mobile-tool-action:disabled,"),
    cssSource.indexOf(".mobile-color-action,"),
  );
  assert.ok(spento.length > 0, "regola dello stato spento non individuata");
  const opacita = /opacity:\s*([0-9.]+)/.exec(spento);
  assert.ok(opacita, "lo stato spento deve dichiarare un'opacita'");
  assert.ok(
    Number(opacita[1]) < 0.9,
    `lo stato spento deve essere visibilmente attenuato, trovato opacity ${opacita[1]}`,
  );

  // La regola del colore "acceso" ha specificita' piu' alta di quella dello
  // stato disabilitato: senza escludere aria-disabled vince lei, e la freccia
  // bloccata resta a colore pieno.
  assert.match(
    cssSource,
    /\.mobile-tool-action:not\(:disabled\):not\(\[aria-pressed\]\):not\(\[aria-disabled="true"\]\)/,
    "la regola del colore acceso deve escludere aria-disabled, o vince per specificita'",
  );
}

console.log("Undo/Redo affordance verified.");
