import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HistoryService,
  assertHistoryServiceInvariants,
} from "../src/history-service.ts";

const stroke = (id, layerId = 1) => ({ id, kind: "stroke", layerId });
const fill = (id, layerId = 1) => ({ id, kind: "fill", layerId });
const fakeLayerAdd = (id, layerId = 2) => ({
  id,
  kind: "layer-add",
  creation: "blank",
  sourceLayerId: null,
  layerId,
  seed: null,
  baseBounds: null,
  baseTileMask: new Uint32Array(),
  layerRecord: { id: layerId },
  rasterLayerIndex: 1,
  sceneIndex: 1,
  clippingParentId: null,
  selectedKeyBefore: "raster:1",
  activeRasterLayerIdBefore: 1,
  baseNoiseMipSmoothing: false,
  referenceRasterLayerIdBefore: null,
});
const fakeFillBatch = (actionId) => ({
  kind: "fill",
  actionId,
  layerId: 1,
  sourceLayerId: 1,
  color: "#000000",
  linearColor: [0, 0, 0, 1],
  tolerancePercent: 0,
  gpuSlice: { id: actionId, logicalBytes: 1 },
  clearLayer: false,
  dirtyRect: null,
  tileMask: new Uint32Array(),
});

const branch = { prepared: 0, committed: 0, cleanup: 0 };
const service = new HistoryService();
service.configureHooks({
  prepareBranchCut: () => {
    branch.prepared += 1;
    return () => {
      branch.committed += 1;
    };
  },
  scheduleDiscardedCleanup: () => {
    branch.cleanup += 1;
  },
});

service.commitAction(stroke(1));
service.commitAction(fakeLayerAdd(2));
assert.deepEqual(assertHistoryServiceInvariants(service), {
  actionCount: 2,
  batchCount: 0,
  cursor: 2,
  nextActionId: 3,
  orphanedBatchCount: 0,
});
assert.deepEqual(branch, { prepared: 0, committed: 0, cleanup: 0 });

const exactState = () => ({
  actions: [...service.actions],
  cursor: service.cursor,
  nextActionId: service.nextActionId,
  batches: [...service.batches],
  storedBaseStamps: service.storedBaseStamps,
  discardedLayerAdds: [...service.discardedLayerAddActions],
  compactionPending: service.compactionPending,
});

for (const point of [
  "after-redo-truncate",
  "after-action-publish",
  "after-batch-publish",
]) {
  service.cursor = 1;
  const before = exactState();
  let releasedPayloads = 0;
  service.injectPublicationFault(point);
  assert.throws(
    () => service.commitAction(fill(3), {
      batches: [fakeFillBatch(3)],
      releasePayloadOnCancel: () => {
        releasedPayloads += 1;
      },
    }),
    new RegExp(point),
  );
  assert.equal(releasedPayloads, 1, `${point}: payload non rilasciato esattamente una volta`);
  assert.deepEqual(exactState(), before, `${point}: rollback non esatto`);
  assert.equal(branch.committed, 0, `${point}: branch storage tagliato prima del commit`);
  assertHistoryServiceInvariants(service);
}

service.cursor = 1;
let successfulReleaseCount = 0;
service.commitAction(fill(3), {
  batches: [fakeFillBatch(3)],
  releasePayloadOnCancel: () => {
    successfulReleaseCount += 1;
  },
});
assert.equal(successfulReleaseCount, 0, "un payload pubblicato appartiene alla History");
assert.deepEqual(service.actions.map((action) => [action.id, action.kind]), [
  [1, "stroke"],
  [3, "fill"],
]);
assert.equal(service.batches.at(-1)?.actionId, 3);
assert.equal(service.discardedLayerAddActions.length, 1);
assert.deepEqual(branch, { prepared: 4, committed: 1, cleanup: 1 });
assert.equal(assertHistoryServiceInvariants(service).orphanedBatchCount, 0);

const preparationFailure = new HistoryService();
preparationFailure.commitAction(stroke(1));
preparationFailure.commitAction(fakeLayerAdd(2));
preparationFailure.setCursor(1);
preparationFailure.configureHooks({
  prepareBranchCut: () => {
    throw new Error("storage branch preparation fault");
  },
  scheduleDiscardedCleanup: () => undefined,
});
let preparationFailureReleases = 0;
assert.throws(
  () => preparationFailure.commitAction(fill(3), {
    batches: [fakeFillBatch(3)],
    releasePayloadOnCancel: () => {
      preparationFailureReleases += 1;
    },
  }),
  /storage branch preparation fault/,
);
assert.equal(preparationFailureReleases, 1);
assert.deepEqual(preparationFailure.actions.map((action) => action.id), [1, 2]);
assert.equal(preparationFailure.cursor, 1);
assert.equal(preparationFailure.discardedLayerAddActions.length, 0);
assertHistoryServiceInvariants(preparationFailure);

const manual = service.begin();
manual.publishAction(stroke(4));
service.cancel(manual);
assert.deepEqual(service.actions.map((action) => action.id), [1, 3]);
assert.equal(service.nextActionId, 4);

const reserved = new HistoryService();
const reservedId = reserved.reserveActionId();
assert.equal(reservedId, 1);
reserved.commitAction(stroke(reservedId), { reservedActionId: true });
assert.equal(reserved.nextActionId, 2);
assert.deepEqual(reserved.actions.map((action) => action.id), [1]);
assertHistoryServiceInvariants(reserved);

let orphanReleaseCount = 0;
assert.throws(
  () => reserved.appendBatch(fakeFillBatch(99), {
    releasePayloadOnCancel: () => {
      orphanReleaseCount += 1;
    },
  }),
  /has no action 99/,
);
assert.equal(orphanReleaseCount, 1);

let appendReleaseCount = 0;
reserved.injectPublicationFault("after-batch-publish");
assert.throws(
  () => reserved.appendBatch(fakeFillBatch(1), {
    storedBaseStamps: 1,
    releasePayloadOnCancel: () => {
      appendReleaseCount += 1;
    },
  }),
  /after-batch-publish/,
);
assert.equal(appendReleaseCount, 1);
assert.equal(reserved.batches.length, 0);
assert.equal(reserved.storedBaseStamps, 0);

const firstMaintenanceState = reserved.claimMaintenanceState(() => ({ generation: 1 }));
assert.equal(
  reserved.claimMaintenanceState(() => ({ generation: 2 })),
  firstMaintenanceState,
  "lo stato checkpoint/accounting deve avere un solo proprietario",
);
assert.equal(reserved.releaseMaintenanceState(), firstMaintenanceState);
assert.equal(reserved.releaseMaintenanceState(), null);

reserved.updateMaintenanceOwnership({
  checkpointCount: 2,
  floorCursor: 1,
  memory: {
    gpuPayloadBytes: 10,
    gpuReservedBytes: 20,
    gpuAllocatedBytes: 30,
    checkpointBytes: 40,
    selectionFillMaskBytes: 5,
    cpuVectorBytes: 6,
    assetBytes: 7,
  },
});
assert.equal(reserved.telemetry().checkpointCount, 2);
assert.equal(reserved.telemetry().floorCursor, 1);
assert.equal(reserved.telemetry().totalMemoryBytes, 83);

const commandCalls = [];
reserved.configureCommands({
  undo: async () => {
    commandCalls.push("undo");
    return true;
  },
  redo: async () => {
    commandCalls.push("redo");
    return false;
  },
});
assert.equal(await reserved.undo(), true);
assert.equal(await reserved.redo(), false);
assert.deepEqual(commandCalls, ["undo", "redo"]);
assert.equal(reserved.state().cursor, 1);

const resettable = new HistoryService();
resettable.commitAction(stroke(1));
resettable.reset();
assert.deepEqual(resettable.state(), {
  actions: [],
  cursor: 0,
  nextActionId: 1,
  batches: [],
  storedBaseStamps: 0,
  compactionPending: false,
});

const semantic = new HistoryService();
let semanticBranchCuts = 0;
semantic.configureHooks({
  prepareBranchCut: () => () => {
    semanticBranchCuts += 1;
  },
  scheduleDiscardedCleanup: () => undefined,
});
semantic.configureCommands({
  undo: async () => {
    if (semantic.cursor === 0) return false;
    semantic.setCursor(semantic.cursor - 1);
    return true;
  },
  redo: async () => {
    if (semantic.cursor === semantic.actions.length) return false;
    semantic.setCursor(semantic.cursor + 1);
    return true;
  },
});
semantic.commitAction(stroke(1));
semantic.commitAction(stroke(2));
semantic.commitAction(stroke(3));
assert.equal(await semantic.undo(), true);
assert.equal(await semantic.undo(), true);
assert.equal(semantic.cursor, 1);
assert.equal(await semantic.redo(), true);
assert.equal(semantic.cursor, 2);
assert.equal(await semantic.undo(), true);
const cancelledBranch = semantic.begin();
cancelledBranch.publishAction(fill(4));
semantic.cancel(cancelledBranch);
assert.deepEqual(semantic.actions.map((action) => action.id), [1, 2, 3]);
assert.equal(semantic.cursor, 1);
semantic.commitAction(fill(4));
assert.deepEqual(semantic.actions.map((action) => action.id), [1, 4]);
assert.equal(semantic.cursor, 2);
assert.equal(semanticBranchCuts, 1);
assert.equal(await semantic.redo(), false, "un nuovo commit deve troncare il ramo Redo");
assertHistoryServiceInvariants(semantic);

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
const source = (relativePath) => readFileSync(resolve(sourceRoot, relativePath), "utf8");
const historyHostSource = source("history-host.ts");
const storageCoordinatorSource = source("history-storage-coordinator.ts");
const engineAdapterSource = source("engine-history-storage-host.ts");
const maintenanceSource = source("history-maintenance-runtime.ts");
const checkpointTypesSource = source("history-checkpoint-types.ts");
const brushEngineSource = source("brush-engine.ts");
const maintenanceAdapterSource = source("history-maintenance-engine-adapter.ts");
const historyRuntimeSource = source("engine-history-runtime.ts");
const fillRuntimeSource = source("engine-fill-runtime.ts");
const projectStorageSource = source("project-storage.ts");
const engineProjectRuntimeSource = source("engine-project-runtime.ts");

assert.match(historyHostSource, /export interface HistoryHost\s*{/);
assert.match(historyHostSource, /readonly runtime: HistoryRuntimeHost/);
assert.match(historyHostSource, /readonly maintenance: HistoryMaintenanceHost/);
assert.match(historyHostSource, /readonly storage: HistoryStorageHost/);
assert.doesNotMatch(
  historyHostSource,
  /from\s+["'][^"']*(?:project-storage|project-session|controller|main)[^"']*["']/i,
  "HistoryHost non deve dipendere da salvataggio progetto o UI",
);
assert.doesNotMatch(
  checkpointTypesSource,
  /BrushEngine|project-storage|ProjectDocument/,
  "i checkpoint devono essere un contratto History puro",
);
assert.doesNotMatch(
  storageCoordinatorSource,
  /(?:import|export)\s+(?:type\s+)?[^;]*BrushEngine|this\.engine/,
  "lo storage History deve consumare soltanto HistoryStorageHost",
);
assert.match(storageCoordinatorSource, /constructor\(host: HistoryStorageHost\)/);
assert.match(engineAdapterSource, /createEngineHistoryHost\(engine: BrushEngine\)/);
assert.doesNotMatch(
  maintenanceSource,
  /stateByEngine|new WeakMap<BrushEngine, HistoryMaintenanceState>/,
  "checkpoint e accounting non devono vivere in uno store globale nascosto",
);
assert.match(
  maintenanceSource,
  /engine\.history\.claimMaintenanceState\(createHistoryMaintenanceState\)/,
);
for (const genericHistoryModule of [
  "history-service.ts",
  "history-host.ts",
  "history-checkpoint-types.ts",
  "history-journal.ts",
  "history-replay-plan.ts",
  "history-retention-core.ts",
  "history-storage-coordinator.ts",
  "history-maintenance-runtime.ts",
]) {
  assert.doesNotMatch(
    source(genericHistoryModule),
    /from\s+["']\.\/brush-engine(?:\.ts)?["']/,
    `${genericHistoryModule}: un modulo History generico non deve ricevere BrushEngine`,
  );
}
assert.match(
  maintenanceAdapterSource,
  /export type EngineHistoryMaintenanceHost = Pick<[\s\S]*?BrushEngine,/,
  "l'unico adattatore engine-specifico deve elencare le capacità di manutenzione",
);
assert.doesNotMatch(
  maintenanceSource,
  /\bBrushEngine\b/,
  "la manutenzione deve dipendere dall'adattatore ristretto",
);
for (const projectModule of [projectStorageSource, engineProjectRuntimeSource]) {
  assert.doesNotMatch(
    projectModule,
    /from\s+["'][^"']*(?:history-storage-coordinator|history-service|gpu-history-storage)[^"']*["']/,
    "il salvataggio progetto non deve dipendere dalla cache evictable History",
  );
}
for (const cacheModule of [storageCoordinatorSource, maintenanceSource, historyHostSource]) {
  assert.doesNotMatch(
    cacheModule,
    /from\s+["'][^"']*(?:project-storage|engine-project-runtime|project-session)[^"']*["']/,
    "la cache History non deve dipendere dal repository dei progetti",
  );
}
assert.match(brushEngineSource, /async undo\(\): Promise<boolean>\s*{\s*return this\.history\.undo\(\);/);
assert.match(brushEngineSource, /async redo\(\): Promise<boolean>\s*{\s*return this\.history\.redo\(\);/);
assert.match(brushEngineSource, /this\.history\.reset\(\);/);
assert.match(
  brushEngineSource,
  /recordHistoryBatch\([\s\S]*?releasePayloadOnCancel[\s\S]*?this\.history\.commitAction\(/,
  "Paint deve trasferire al proprietario anche il rilascio del payload",
);
assert.match(
  historyRuntimeSource,
  /recordBlendHistoryBatch\([\s\S]*?releasePayloadOnCancel[\s\S]*?engine\.history\.commitAction\(/,
  "Blend deve trasferire al proprietario anche il rilascio del payload",
);
assert.match(
  fillRuntimeSource,
  /releasePayloadOnCancel:[\s\S]*?historyGpuStorage\.release\(capturedHistorySlice\)[\s\S]*?historySlice = null/,
  "Fill deve rilasciare una sola volta la mask se la pubblicazione fallisce",
);
assert.match(
  fillRuntimeSource,
  /catch \(error\)[\s\S]*?await rebuildActiveLayerFromHistory\(engine\)/,
  "Fill deve ricostruire i pixel se il commit History fallisce",
);
assert.match(
  brushEngineSource,
  /async clear\(\)[\s\S]*?pixelsCleared && !historyPublicationSettled[\s\S]*?await rebuildActiveLayerFromHistory\(this\)/,
  "Clear deve ricostruire i pixel se il commit History fallisce",
);
assert.match(
  brushEngineSource,
  /async deleteLayer\([\s\S]*?catch \(error\) \{\s*for \(const entry of entries\) destroyLayerColdStorage\(entry\.seed\)/,
  "Delete deve liberare anche i seed catturati prima di un fault intermedio",
);
assert.match(
  brushEngineSource,
  /commitRasterLayerMetadataHistoryEdit\([\s\S]*?catch \(error\)[\s\S]*?restoreRasterLayerMetadataHistorySnapshot\(this, edit\)[\s\S]*?latchDocumentStateInconsistent/,
  "il commit metadata deve ripristinare lo snapshot prima di bloccare uno stato non pubblicato",
);
assert.match(
  brushEngineSource,
  /rollbackUnpublishedVectorHistoryMutation\([\s\S]*?scene\.restoreVectorHistoryState\(before\)[\s\S]*?latchDocumentStateInconsistent/,
  "un commit vettoriale rifiutato deve ripristinare il modello before",
);
assert.match(
  brushEngineSource,
  /commitVectorHistoryEdit\(\)[\s\S]*?recordVectorHistoryAction\([\s\S]*?rollbackUnpublishedVectorHistoryMutation\(edit\.before, error\)/,
  "la fine gesto vettoriale deve conservare lo snapshot fino al commit",
);

for (const relativePath of readdirSync(sourceRoot, { recursive: true, encoding: "utf8" })) {
  if (!relativePath.endsWith(".ts") || relativePath === "history-service.ts") continue;
  const fileSource = readFileSync(resolve(sourceRoot, relativePath), "utf8");
  assert.doesNotMatch(
    fileSource,
    /historyActions\.(?:push|splice|pop|shift|unshift)\s*\(/,
    `${relativePath}: il journal può essere mutato soltanto da HistoryService`,
  );
  assert.doesNotMatch(
    fileSource,
    /historyBatches\.(?:push|splice|pop|shift|unshift)\s*\(/,
    `${relativePath}: i batch possono essere mutati soltanto da HistoryService`,
  );
  assert.doesNotMatch(
    fileSource,
    /(?:engine|this)\.(?:historyActions|historyBatches|historyCursor|nextHistoryActionId|historyStoredBaseStamps|historyCompactionPending)\s*(?:=(?!=)|\+=|-=|\+\+|--)/,
    `${relativePath}: lo stato History non può essere assegnato fuori dal proprietario`,
  );
}

console.log("History service transaction verification passed.");
