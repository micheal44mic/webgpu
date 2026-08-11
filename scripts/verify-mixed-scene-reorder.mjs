import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LayerStack } from "../src/layer-stack.ts";
import { MixedSceneStack } from "../src/mixed-scene-stack.ts";
import {
  MIXED_SCENE_REORDER_STRATEGY,
  isMixedSceneOrderStateApplicable,
  mixedSceneReorderTargets,
  planMixedSceneRasterInsertion,
  planMixedSceneReorder,
} from "../src/mixed-scene-reorder-core.ts";

assert.equal(
  MIXED_SCENE_REORDER_STRATEGY,
  "top-first-removal-slot-atomic-clipping-unit-exact-order-v1",
);

const ordinaryRaster = [
  { id: 1, clippingParentId: null },
  { id: 2, clippingParentId: null },
  { id: 3, clippingParentId: null },
];

// Slots are expressed against top-first rows after extraction. The plan gives
// both the heterogeneous order and the raster-only projection for one commit.
{
  const bottomUp = ["raster:1", "text:1", "raster:2", "svg:1", "raster:3"];
  const targets = mixedSceneReorderTargets(bottomUp, ordinaryRaster, "text:1");
  assert.deepEqual(targets.movingKeys, ["text:1"]);
  assert.deepEqual(targets.topFirstKeysWithoutMoving, [
    "raster:3", "svg:1", "raster:2", "raster:1",
  ]);
  assert.deepEqual(targets.validTargetTopFirstSlots, [0, 1, 2, 3, 4]);
  const plan = planMixedSceneReorder(bottomUp, ordinaryRaster, "text:1", 0);
  assert.deepEqual(plan.bottomUpKeys, [
    "raster:1", "raster:2", "svg:1", "raster:3", "text:1",
  ]);
  assert.deepEqual(plan.rasterLayerIds, [1, 2, 3]);
  assert.equal(plan.changed, true);
  const originalSlot = targets.topFirstKeysWithoutMoving.indexOf("raster:1");
  assert.equal(
    planMixedSceneReorder(bottomUp, ordinaryRaster, "text:1", 3).changed,
    false,
  );
  assert.ok(originalSlot >= 0);
}

const clippedRaster = [
  { id: 1, clippingParentId: null },
  { id: 2, clippingParentId: 1 },
  { id: 3, clippingParentId: 1 },
  { id: 4, clippingParentId: null },
];
const clippedBottomUp = [
  "raster:1", "raster:2", "raster:3", "text:1", "raster:4", "svg:1",
];

// Dragging a base extracts the complete clipping unit, preserving child order.
{
  const targets = mixedSceneReorderTargets(clippedBottomUp, clippedRaster, "raster:1");
  assert.deepEqual(targets.movingKeys, ["raster:3", "raster:2", "raster:1"]);
  const plan = planMixedSceneReorder(clippedBottomUp, clippedRaster, "raster:1", 0);
  assert.deepEqual(plan.bottomUpKeys, [
    "text:1", "raster:4", "svg:1", "raster:1", "raster:2", "raster:3",
  ]);
  assert.deepEqual(plan.rasterLayerIds, [4, 1, 2, 3]);
}

// A child is movable only within its own contiguous group. A semantic row has
// every gap except the ones between clipping members.
{
  const childTargets = mixedSceneReorderTargets(
    clippedBottomUp,
    clippedRaster,
    "raster:2",
  );
  assert.deepEqual(childTargets.movingKeys, ["raster:2"]);
  assert.deepEqual(childTargets.validTargetTopFirstSlots, [3, 4]);
  const childPlan = planMixedSceneReorder(
    clippedBottomUp,
    clippedRaster,
    "raster:2",
    3,
  );
  assert.deepEqual(childPlan.rasterLayerIds, [1, 3, 2, 4]);
  assert.throws(
    () => planMixedSceneReorder(clippedBottomUp, clippedRaster, "raster:2", 0),
    /non valido/,
  );

  const textTargets = mixedSceneReorderTargets(
    clippedBottomUp,
    clippedRaster,
    "text:1",
  );
  assert.ok(!textTargets.validTargetTopFirstSlots.includes(3));
  assert.ok(!textTargets.validTargetTopFirstSlots.includes(4));
}

// Invalid source models fail before any mutable stack is touched.
assert.throws(
  () => mixedSceneReorderTargets(
    ["raster:1", "text:1", "raster:2"],
    [{ id: 1, clippingParentId: null }, { id: 2, clippingParentId: 1 }],
    "text:1",
  ),
  /consecutivo/,
);
assert.throws(
  () => planMixedSceneReorder(["raster:1"], ordinaryRaster, "raster:1", 0),
  /incoerente/,
);

// Clipping mutations are intentionally not journalled. If a reorder made two
// raster rows adjacent and one later becomes a clipping child, the current
// order remains valid but Undo must not restore an older order that split them
// with a semantic row.
{
  const before = {
    bottomUpKeys: ["raster:1", "text:1", "raster:2"],
    rasterLayerIds: [1, 2],
  };
  const after = {
    bottomUpKeys: ["raster:1", "raster:2", "text:1"],
    rasterLayerIds: [1, 2],
  };
  const clippingChanged = [
    { id: 1, clippingParentId: null },
    { id: 2, clippingParentId: 1 },
  ];
  assert.equal(
    isMixedSceneOrderStateApplicable(
      after,
      after.bottomUpKeys,
      clippingChanged,
    ),
    true,
    "l'ordine live resta valido dopo la nuova relazione di clipping",
  );
  assert.equal(
    isMixedSceneOrderStateApplicable(
      before,
      after.bottomUpKeys,
      clippingChanged,
    ),
    false,
    "Undo deve rifiutare l'ordine storico che ora spezzerebbe il clipping",
  );
}

const createStyles = () => ({
  strokeStyle: {},
  bevelStyle: {},
  outerShadowStyle: {},
  innerShadowStyle: {},
  colorOverlayStyle: {},
});

const textSeed = (text = "INSERT") => ({
  text,
  fontFamily: "sans-serif",
  fontSize: 32,
  color: "#ffffff",
  outlineWidth: 0,
  outlineColor: "#000000",
  outlineJoin: "round",
  blockShadowEnabled: false,
  blockShadowColor: "#000000",
  blockShadowOpacity: 1,
  blockShadowOffset: 0,
  blockShadowAngle: 0,
  blockShadowOutlineWidth: 0,
  singleShadowEnabled: false,
  singleShadowColor: "#000000",
  singleShadowOpacity: 1,
  singleShadowOffset: 0,
  singleShadowAngle: 0,
  singleShadowBlur: 0,
  innerShadowEnabled: false,
  innerShadowColor: "#000000",
  innerShadowOpacity: 1,
  innerShadowOffset: 0,
  innerShadowAngle: 0,
  innerShadowBlur: 0,
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
});

// Add uses one heterogeneous slot for both models. This is the exact former
// failure: raster 2 stays active while a text between 1 and 2 is selected.
{
  const stack = new LayerStack(createStyles);
  stack.add("Raster 2");
  const scene = new MixedSceneStack([1, 2]);
  scene.select("raster:1");
  const text = scene.addTextAboveSelection(textSeed());
  scene.select(`text:${text.id}`);
  assert.equal(stack.active.id, 2);

  const plan = planMixedSceneRasterInsertion(
    scene.items.map((item) => item.key),
    stack.layers.map(({ id, clippingParentId }) => ({ id, clippingParentId })),
    scene.selected.key,
    null,
  );
  assert.deepEqual(plan, { sceneIndex: 2, rasterLayerIndex: 1 });
  const insertedIndex = stack.insertAt(plan.rasterLayerIndex, "Raster 3");
  const inserted = stack.at(insertedIndex);
  scene.insertRasterAt(inserted.id, plan.sceneIndex);
  assert.deepEqual(stack.layers.map((record) => record.id), [1, 3, 2]);
  assert.deepEqual(
    scene.items.filter((item) => item.kind === "raster").map((item) => item.rasterLayerId),
    [1, 3, 2],
  );

  // The recorded exact indices remain reversible for structural Undo/Redo.
  scene.removeRaster(inserted.id, 2);
  const detached = stack.remove(stack.indexOfId(inserted.id));
  assert.deepEqual(stack.layers.map((record) => record.id), [1, 2]);
  stack.attach(detached, plan.rasterLayerIndex);
  scene.insertRasterAt(detached.id, plan.sceneIndex);
  assert.deepEqual(stack.layers.map((record) => record.id), [1, 3, 2]);
  assert.deepEqual(
    scene.items.filter((item) => item.kind === "raster").map((item) => item.rasterLayerId),
    [1, 3, 2],
  );
}

// Semantic positions below, between and above raster rows all derive the
// matching raster-only insertion index without consulting the active raster.
{
  const raster = [
    { id: 1, clippingParentId: null },
    { id: 2, clippingParentId: null },
  ];
  assert.deepEqual(
    planMixedSceneRasterInsertion(["text:1", "raster:1", "raster:2"], raster, "text:1", null),
    { sceneIndex: 1, rasterLayerIndex: 0 },
  );
  assert.deepEqual(
    planMixedSceneRasterInsertion(["raster:1", "text:1", "raster:2"], raster, "text:1", null),
    { sceneIndex: 2, rasterLayerIndex: 1 },
  );
  assert.deepEqual(
    planMixedSceneRasterInsertion(["raster:1", "raster:2", "text:1"], raster, "text:1", null),
    { sceneIndex: 3, rasterLayerIndex: 2 },
  );
}

// A normal Add over a clipping base and an explicit new clipping mask both go
// above the entire base+children unit; neither can split it with a new raster.
{
  assert.deepEqual(
    planMixedSceneRasterInsertion(clippedBottomUp, clippedRaster, "raster:1", null),
    { sceneIndex: 3, rasterLayerIndex: 3 },
  );
  assert.deepEqual(
    planMixedSceneRasterInsertion(clippedBottomUp, clippedRaster, "raster:1", 1),
    { sceneIndex: 3, rasterLayerIndex: 3 },
  );
}

// The exact-order primitives preserve identity-based active/reference/selection
// and reject partial or duplicate permutations.
{
  const stack = new LayerStack(createStyles);
  stack.add();
  stack.add();
  stack.setActiveIndex(1);
  stack.setReferenceIndex(2);
  const activeId = stack.active.id;
  const referenceId = stack.referenceLayerId;
  assert.equal(stack.reorderByIds([3, 1, 2]), true);
  assert.deepEqual(stack.layers.map((record) => record.id), [3, 1, 2]);
  assert.equal(stack.active.id, activeId);
  assert.equal(stack.referenceLayerId, referenceId);
  assert.equal(stack.reorderByIds([3, 1, 2]), false);
  assert.throws(() => stack.reorderByIds([1, 1, 2]), /duplicati/);
  assert.throws(() => stack.reorderByIds([1, 2]), /tutti/);

  const scene = new MixedSceneStack([1, 2, 3]);
  scene.select("raster:2");
  assert.equal(scene.reorderByKeys(["raster:3", "raster:1", "raster:2"]), true);
  assert.deepEqual(scene.items.map((item) => item.key), [
    "raster:3", "raster:1", "raster:2",
  ]);
  assert.equal(scene.selected.key, "raster:2");
  assert.equal(scene.reorderByKeys(["raster:3", "raster:1", "raster:2"]), false);
}

// The before/after payload is an exact reversible permutation. A clipping
// group can move across semantic rows while active/reference/selection survive
// both redo and undo without cloning a LayerRecord or vector node.
{
  const stack = new LayerStack(createStyles);
  stack.add("Clip A");
  stack.setClippingParent(1, 1);
  stack.add("Clip B");
  stack.setClippingParent(2, 1);
  stack.add("Other");
  stack.setActiveIndex(1);
  stack.setReferenceIndex(0);
  const activeId = stack.active.id;
  const referenceId = stack.referenceLayerId;
  const scene = new MixedSceneStack([1, 2, 3, 4]);
  scene.select("raster:2");

  const before = {
    bottomUpKeys: scene.items.map((item) => item.key),
    rasterLayerIds: stack.layers.map((record) => record.id),
  };
  const after = planMixedSceneReorder(
    before.bottomUpKeys,
    stack.layers.map(({ id, clippingParentId }) => ({ id, clippingParentId })),
    "raster:1",
    0,
  );
  stack.reorderByIds(after.rasterLayerIds);
  scene.reorderByKeys(after.bottomUpKeys);
  assert.deepEqual(stack.layers.map((record) => record.id), [4, 1, 2, 3]);
  assert.equal(stack.active.id, activeId);
  assert.equal(stack.referenceLayerId, referenceId);
  assert.equal(scene.selected.key, "raster:2");

  stack.reorderByIds(before.rasterLayerIds);
  scene.reorderByKeys(before.bottomUpKeys);
  assert.deepEqual(stack.layers.map((record) => record.id), [1, 2, 3, 4]);
  assert.deepEqual(scene.items.map((item) => item.key), before.bottomUpKeys);
  assert.equal(stack.active.id, activeId);
  assert.equal(stack.referenceLayerId, referenceId);
  assert.equal(scene.selected.key, "raster:2");
}

// Static integration guard: one pixel-free action, one successful rebuild,
// and Undo/Redo routed through the same exact-order transaction.
{
  const historySource = readFileSync(
    new URL("../src/engine-history-runtime.ts", import.meta.url),
    "utf8",
  );
  const typesSource = readFileSync(
    new URL("../src/engine-history-types.ts", import.meta.url),
    "utf8",
  );
  assert.match(typesSource, /kind: "scene-reorder";[\s\S]*?before: MixedSceneOrderState;[\s\S]*?after: MixedSceneOrderState;/);
  assert.match(historySource, /crossedAction\.kind === "scene-reorder"[\s\S]*?applyMixedSceneOrderState/);
  const moveStart = historySource.indexOf("export async function moveMixedSceneItem(");
  const moveEnd = historySource.indexOf("export function scheduleHistoryGpuTrim", moveStart);
  assert.ok(moveStart >= 0 && moveEnd > moveStart);
  const moveBody = historySource.slice(moveStart, moveEnd);
  assert.equal((moveBody.match(/await applyMixedSceneOrderState\(engine, after\)/g) ?? []).length, 1);
  assert.doesNotMatch(moveBody, /GPUTexture|GPUBuffer|copyTexture|copyBuffer|historyGpuStorage/);

  const gateStart = historySource.indexOf("export function historyStepBlockedByLayer(");
  const gateEnd = historySource.indexOf("export function maybeInjectHistoryReplayFault", gateStart);
  assert.ok(gateStart >= 0 && gateEnd > gateStart);
  assert.match(
    historySource.slice(gateStart, gateEnd),
    /action\?\.kind === "scene-reorder"[\s\S]*?!isMixedSceneOrderStateApplicable\(/,
  );

  const recordStart = historySource.indexOf("function recordMixedSceneReorderHistoryAction(");
  const recordEnd = historySource.indexOf("export async function moveMixedSceneItem(", recordStart);
  assert.ok(recordStart >= 0 && recordEnd > recordStart);
  const recordBody = historySource.slice(recordStart, recordEnd);
  const truncateIndex = recordBody.indexOf("truncateRedoHistory(engine);");
  const pushIndex = recordBody.indexOf("engine.historyActions.push(action);");
  const cursorIndex = recordBody.indexOf("engine.historyCursor = engine.historyActions.length;");
  const sweepIndex = recordBody.indexOf("engine.sweepRasterImageGpuResources();");
  assert.ok(
    truncateIndex >= 0
      && truncateIndex < pushIndex
      && pushIndex < cursorIndex
      && cursorIndex < sweepIndex,
    "il recorder reorder deve spazzare le immagini solo dopo troncamento e commit",
  );
  assert.equal(
    (recordBody.match(/engine\.sweepRasterImageGpuResources\(\);/g) ?? []).length,
    1,
  );
}

console.log("Mixed scene reorder verification passed.");
