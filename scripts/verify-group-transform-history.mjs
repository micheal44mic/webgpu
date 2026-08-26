import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  hasVisibleContent,
  historyStepTargetsMissingLayer,
  latestLayerReplayCheckpoint,
  visibleRasterBatchActionIdsAfterCheckpoint,
} from "../src/history-journal.ts";

const source = (relative) => readFileSync(
  fileURLToPath(new URL(relative, import.meta.url)),
  "utf8",
);

const seed11 = { label: "seed-11" };
const seed22 = { label: "seed-22" };
const group = {
  id: 7,
  kind: "group-transform",
  vectors: [],
  rasters: [
    { layerId: 11, seed: seed11, baseBounds: { x: 2, y: 3, width: 20, height: 30 }, baseTileMask: new Uint32Array([1]) },
    { layerId: 22, seed: seed22, baseBounds: null, baseTileMask: new Uint32Array([0]) },
  ],
};
const actions = [
  { id: 1, kind: "stroke", layerId: 11 },
  group,
  { id: 8, kind: "stroke", layerId: 11 },
];

assert.equal(latestLayerReplayCheckpoint(actions, 3, 11)?.action, group);
assert.equal(latestLayerReplayCheckpoint(actions, 3, 22)?.action, group);
assert.equal(latestLayerReplayCheckpoint(actions, 3, 33), null);
assert.equal(hasVisibleContent(actions, 2, 11), true);
assert.equal(hasVisibleContent(actions, 2, 22), false);
assert.deepEqual([...visibleRasterBatchActionIdsAfterCheckpoint(actions, 3, 11)], [8]);
assert.equal(
  historyStepTargetsMissingLayer(actions, 2, -1, new Set([11, 22])),
  false,
);
assert.equal(
  historyStepTargetsMissingLayer(actions, 2, -1, new Set([11])),
  true,
);

const replayPlan = source("../src/history-replay-plan.ts");
assert.match(
  replayPlan,
  /checkpointAction\?\.kind === "group-transform"[\s\S]*?checkpointAction\.rasters\.find/,
);

const runtime = source("../src/engine-history-runtime.ts");
assert.match(runtime, /recordMixedSceneGroupTransformHistoryAction/);
assert.match(runtime, /applyMixedSceneGroupTransformHistory/);
assert.match(runtime, /replayGroupRasterMembers/);
const groupVectorStart = runtime.indexOf("async function applyGroupVectorHistoryStates(");
const groupVectorEnd = runtime.indexOf(
  "async function switchGroupHistoryRaster(",
  groupVectorStart,
);
assert.ok(groupVectorStart >= 0 && groupVectorEnd > groupVectorStart);
const groupVectorReplay = runtime.slice(groupVectorStart, groupVectorEnd);
const idleDrainIndex = groupVectorReplay.indexOf("await engine.waitForIdle();");
const semanticRestoreIndex = groupVectorReplay.indexOf("scene.restoreVectorHistoryState(target)");
const presentationClearIndex = groupVectorReplay.indexOf(
  "clearVectorTextPresentationForTransaction(engine)",
);
const surfaceRebuildIndex = groupVectorReplay.indexOf("await engine.rebuildMergedLayerSurfaces(");
assert.ok(
  idleDrainIndex >= 0
    && idleDrainIndex < semanticRestoreIndex
    && semanticRestoreIndex < presentationClearIndex
    && presentationClearIndex < surfaceRebuildIndex,
  "Group replay must drain the final raster presentation before mutating semantics and rebuilding the shared scene.",
);
assert.match(runtime, /engine\.history\.setCursor\(previousCursor\)/);
assert.match(runtime, /latchDocumentStateInconsistent\([\s\S]*?group Transform Undo\/Redo/);
const groupHistoryStart = runtime.indexOf("async function applyMixedSceneGroupTransformHistory(");
const groupHistoryEnd = runtime.indexOf(
  "export function recordBlendHistoryBatch(",
  groupHistoryStart,
);
const groupHistoryReplay = runtime.slice(groupHistoryStart, groupHistoryEnd);
assert.equal(
  (groupHistoryReplay.match(/applyGroupVectorHistoryStates\(/g) ?? []).length,
  2,
  "Forward replay and rollback must share the same idle-drained semantic phase.",
);

const storage = source("../src/history-storage-coordinator.ts");
assert.match(storage, /crossed\.kind === "group-transform"[\s\S]*?crossed\.rasters/);
assert.match(storage, /action\.kind === "group-transform"[\s\S]*?this\.wrapSeed/);

const maintenance = source("../src/history-maintenance-runtime.ts");
assert.match(maintenance, /action\.kind === "group-transform"[\s\S]*?account\(entry\.seed\)/);
assert.match(maintenance, /action\.kind === "group-transform"[\s\S]*?lastRasterActionByLayer/);

console.log("Group Transform History verification passed.");
