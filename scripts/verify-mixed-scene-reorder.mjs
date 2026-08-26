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

const mixedClippingBottomUp = [
  "svg:10", "raster:1", "svg:11", "raster:2", "text:1", "raster:3",
];
const mixedClippingRelations = [
  { childKey: "raster:1", parentKey: "svg:10" },
  { childKey: "svg:11", parentKey: "svg:10" },
  { childKey: "raster:2", parentKey: "svg:10" },
];

// Heterogeneous bases carry their complete raster/vector unit. The raster-only
// projection changes in the same plan without losing the semantic members.
{
  const targets = mixedSceneReorderTargets(
    mixedClippingBottomUp,
    ordinaryRaster,
    "svg:10",
    mixedClippingRelations,
  );
  assert.deepEqual(targets.movingKeys, [
    "raster:2", "svg:11", "raster:1", "svg:10",
  ]);
  const plan = planMixedSceneReorder(
    mixedClippingBottomUp,
    ordinaryRaster,
    "svg:10",
    0,
    mixedClippingRelations,
  );
  assert.deepEqual(plan.bottomUpKeys, [
    "text:1", "raster:3", "svg:10", "raster:1", "svg:11", "raster:2",
  ]);
  assert.deepEqual(plan.rasterLayerIds, [3, 1, 2]);

  const childTargets = mixedSceneReorderTargets(
    mixedClippingBottomUp,
    ordinaryRaster,
    "raster:1",
    mixedClippingRelations,
  );
  assert.deepEqual(childTargets.movingKeys, ["raster:1"]);
  assert.ok(!childTargets.validTargetTopFirstSlots.includes(0));
  const childPlan = planMixedSceneReorder(
    mixedClippingBottomUp,
    ordinaryRaster,
    "raster:1",
    2,
    mixedClippingRelations,
  );
  assert.deepEqual(childPlan.bottomUpKeys, [
    "svg:10", "svg:11", "raster:2", "raster:1", "text:1", "raster:3",
  ]);
  assert.deepEqual(childPlan.rasterLayerIds, [2, 1, 3]);
}

// The retained raster projection and the generic graph may describe the same
// raster-to-raster edge. It is deduplicated while SVG siblings remain part of
// the one atomic unit.
{
  const hybridBottomUp = [
    "raster:1", "svg:20", "raster:2", "text:1", "raster:3",
  ];
  const hybridRaster = [
    { id: 1, clippingParentId: null },
    { id: 2, clippingParentId: 1 },
    { id: 3, clippingParentId: null },
  ];
  const hybridRelations = [
    { childKey: "svg:20", parentKey: "raster:1" },
    { childKey: "raster:2", parentKey: "raster:1" },
  ];
  const targets = mixedSceneReorderTargets(
    hybridBottomUp,
    hybridRaster,
    "raster:1",
    hybridRelations,
  );
  assert.deepEqual(targets.movingKeys, ["raster:2", "svg:20", "raster:1"]);
}

// Generic clipping rejects split groups, chains, incompatible participants
// and disagreement with the raster projection before producing any targets.
assert.throws(
  () => mixedSceneReorderTargets(
    ["svg:1", "text:1", "raster:1", "raster:2", "raster:3"],
    ordinaryRaster,
    "svg:1",
    [{ childKey: "raster:1", parentKey: "svg:1" }],
  ),
  /remain consecutive/,
);
assert.throws(
  () => mixedSceneReorderTargets(
    ["svg:1", "raster:1", "svg:2", "raster:2", "raster:3"],
    ordinaryRaster,
    "svg:1",
    [
      { childKey: "raster:1", parentKey: "svg:1" },
      { childKey: "svg:2", parentKey: "raster:1" },
    ],
  ),
  /chains are not supported/,
);
assert.throws(
  () => mixedSceneReorderTargets(
    ["raster:1", "image:1", "raster:2", "raster:3"],
    ordinaryRaster,
    "raster:1",
    [{ childKey: "image:1", parentKey: "raster:1" }],
  ),
  /Only raster, text, and SVG/,
);
assert.throws(
  () => mixedSceneReorderTargets(
    ["raster:1", "svg:1", "raster:2", "raster:3"],
    [
      { id: 1, clippingParentId: null },
      { id: 2, clippingParentId: 1 },
      { id: 3, clippingParentId: null },
    ],
    "raster:1",
    [{ childKey: "raster:2", parentKey: "svg:1" }],
  ),
  /conflicting bases/,
);

// Editable text participates in the same atomic unit as raster and SVG.
{
  const textBottomUp = [
    "raster:1", "text:1", "svg:1", "raster:2", "raster:3",
  ];
  const relations = [
    { childKey: "svg:1", parentKey: "text:1" },
    { childKey: "raster:2", parentKey: "text:1" },
  ];
  const targets = mixedSceneReorderTargets(
    textBottomUp,
    ordinaryRaster,
    "text:1",
    relations,
  );
  assert.deepEqual(targets.movingKeys, ["raster:2", "svg:1", "text:1"]);
  const plan = planMixedSceneReorder(
    textBottomUp,
    ordinaryRaster,
    "text:1",
    0,
    relations,
  );
  assert.deepEqual(plan.bottomUpKeys, [
    "raster:1", "raster:3", "text:1", "svg:1", "raster:2",
  ]);
  assert.deepEqual(plan.rasterLayerIds, [1, 3, 2]);
}

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
    /Invalid/,
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
  /remain consecutive/,
);
assert.throws(
  () => planMixedSceneReorder(["raster:1"], ordinaryRaster, "raster:1", 0),
  /inconsistent raster order/,
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

// Applicability uses the live heterogeneous graph as well as the retained
// raster projection, so an old permutation cannot split an SVG-based unit.
{
  const valid = {
    bottomUpKeys: mixedClippingBottomUp,
    rasterLayerIds: [1, 2, 3],
  };
  const split = {
    bottomUpKeys: [
      "svg:10", "raster:1", "text:1", "svg:11", "raster:2", "raster:3",
    ],
    rasterLayerIds: [1, 2, 3],
  };
  assert.equal(
    isMixedSceneOrderStateApplicable(
      valid,
      mixedClippingBottomUp,
      ordinaryRaster,
      mixedClippingRelations,
    ),
    true,
  );
  assert.equal(
    isMixedSceneOrderStateApplicable(
      split,
      mixedClippingBottomUp,
      ordinaryRaster,
      mixedClippingRelations,
    ),
    false,
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

  assert.deepEqual(
    planMixedSceneRasterInsertion(
      mixedClippingBottomUp,
      ordinaryRaster,
      "svg:10",
      null,
      mixedClippingRelations,
    ),
    { sceneIndex: 4, rasterLayerIndex: 2 },
  );
  assert.deepEqual(
    planMixedSceneRasterInsertion(
      mixedClippingBottomUp,
      ordinaryRaster,
      "svg:11",
      null,
      mixedClippingRelations,
    ),
    { sceneIndex: 4, rasterLayerIndex: 2 },
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
  assert.throws(() => stack.reorderByIds([1, 1, 2]), /duplicate IDs/);
  assert.throws(() => stack.reorderByIds([1, 2]), /every layer/);

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
  assert.match(
    historySource,
    /crossedAction\.kind === "scene-reorder"[\s\S]{0,500}applyMixedSceneOrderState\([\s\S]{0,240}"history-replay"/,
    "Undo/Redo del riordino deve dichiarare il contesto History",
  );
  const applyStart = historySource.indexOf("export async function applyMixedSceneOrderState(");
  const applyEnd = historySource.indexOf(
    "function recordMixedSceneReorderHistoryAction(",
    applyStart,
  );
  assert.ok(applyStart >= 0 && applyEnd > applyStart);
  const applyBody = historySource.slice(applyStart, applyEnd);
  assert.match(applyBody, /caller: EffectsRetargetCaller = "layer-switch"/);
  assert.equal(
    (applyBody.match(/rebuildMergedLayerSurfaces\(\s*caller,/g) ?? []).length,
    2,
    "commit e rollback del riordino devono propagare lo stesso caller",
  );
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
  const commitIndex = recordBody.indexOf("commitHistoryActionAtomically(engine, action);");
  const sweepIndex = recordBody.indexOf("engine.sweepRasterImageGpuResources();");
  assert.ok(
    commitIndex >= 0 && commitIndex < sweepIndex,
    "il recorder reorder deve spazzare le immagini solo dopo troncamento e commit",
  );
  assert.equal(
    (recordBody.match(/engine\.sweepRasterImageGpuResources\(\);/g) ?? []).length,
    1,
  );
}

console.log("Mixed scene reorder verification passed.");
