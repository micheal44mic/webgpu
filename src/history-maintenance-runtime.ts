import type { BrushEngine } from "./brush-engine";
import {
  createLayerColdStorageCandidateIncrementally,
  destroyLayerColdStorage,
} from "./engine-cold-storage";
import type { DirtyRect } from "./engine-stroke-types";
import type { LayerColdStorageResources } from "./engine-layer-resources";
import type { HistoryAction, HistoryRenderBatch } from "./engine-history-types";
import type { GpuHistorySlice } from "./gpu-history-storage";
import {
  countLayerStorageTiles,
  createLayerStorageTileMask,
  markLayerStorageRect,
} from "./layer-storage-study";
import { LAYER_SIZE, MOBILE_DEVICE_CLASS } from "./engine-limits";
import {
  HISTORY_MINIMUM_BUDGET_BYTES,
  createHistoryBudget,
  emptyHistoryMemoryLedger,
  historyBaseBudgetBytes,
  historyBudgetPressure,
  historyMemoryTotalBytes,
  nearestHistoryCheckpoint,
  planHistoryCheckpoint,
  planHistoryDepthEviction,
  HISTORY_MAXIMUM_UNDO_DEPTH,
  type HistoryMemoryLedger,
} from "./history-retention-core";

const MEBIBYTE_BYTES = 1024 * 1024;
const HISTORY_FULL_CHECKPOINT_PERIOD = 8;
const HISTORY_MAINTENANCE_DELAY_MS = 140;

export interface PeriodicRasterHistoryCheckpoint {
  readonly id: number;
  readonly layerId: number;
  readonly afterActionId: number;
  readonly parentId: number | null;
  readonly kind: "full" | "delta" | "blank";
  readonly seed: LayerColdStorageResources | null;
  readonly baseBounds: DirtyRect | null;
  readonly baseTileMask: Uint32Array;
  readonly memoryBytes: number;
}

export interface HistoryMaintenanceTelemetry {
  readonly checkpointCount: number;
  readonly fullCheckpointCount: number;
  readonly deltaCheckpointCount: number;
  readonly checkpointBytes: number;
  readonly memory: HistoryMemoryLedger;
  readonly totalBytes: number;
  readonly budgetBytes: number;
  /** Device-class ceiling before live effects reserve their working set. */
  readonly baseBudgetBytes: number;
  /** Physical active effects resources excluded from the History allowance. */
  readonly effectsWorkingSetBytes: number;
  readonly budgetPressure: number;
  readonly replayTailBatches: number;
  readonly capturesStarted: number;
  readonly capturesCommitted: number;
  readonly capturesDiscardedStale: number;
  readonly capturesFailed: number;
  readonly redoCompactionsScheduled: number;
  readonly redoCompactionsCompleted: number;
  readonly redoCompactionsAborted: number;
  readonly redoCompactionChunks: number;
  readonly redoCompactionYields: number;
  readonly redoReleasedSlices: number;
  readonly floorCursor: number;
  readonly budgetEvictions: number;
  /** Eviction dovute al tetto di profondita', non alla pressione di memoria. */
  readonly depthEvictions: number;
  readonly maximumUndoDepth: number;
  readonly evictedPayloadBytes: number;
  readonly budgetCheckpointBlocked: boolean;
  readonly accountingFullRebuilds: number;
  readonly accountingIncrementalActions: number;
  readonly accountingIncrementalBatches: number;
}

interface HistoryReplayTailAccounting {
  actions: number;
  batches: number;
  bytes: number;
}

interface LatestCheckpointAccounting {
  checkpoint: PeriodicRasterHistoryCheckpoint;
  actionIndex: number;
}

interface HistoryMaintenanceState {
  checkpoints: PeriodicRasterHistoryCheckpoint[];
  timer: number | null;
  generation: number;
  nextCheckpointId: number;
  captureInFlight: boolean;
  capturesStarted: number;
  capturesCommitted: number;
  capturesDiscardedStale: number;
  capturesFailed: number;
  redoCompactionsScheduled: number;
  redoCompactionsCompleted: number;
  redoCompactionsAborted: number;
  redoCompactionChunks: number;
  redoCompactionYields: number;
  redoReleasedSlices: number;
  floorCursor: number;
  budgetEvictions: number;
  depthEvictions: number;
  evictedPayloadBytes: number;
  budgetCheckpointBlocked: boolean;
  checkpointBytes: number;
  actionCheckpointBytes: number;
  fullCheckpointCount: number;
  deltaCheckpointCount: number;
  accountingInitialized: boolean;
  accounting: HistoryMemoryLedger;
  accountingCpuSeen: WeakSet<object>;
  accountingSelectionSliceIds: Set<number>;
  accountingCheckpointSeeds: Set<LayerColdStorageResources>;
  observedActionsLength: number;
  observedActionsTail: object | null;
  observedBatchesLength: number;
  observedBatchesTail: object | null;
  observedDiscardedVectorLength: number;
  observedDiscardedVectorTail: object | null;
  observedDiscardedImportLength: number;
  observedDiscardedImportTail: object | null;
  observedDiscardedTransformLength: number;
  observedDiscardedTransformTail: object | null;
  observedSelectionRevisionSize: number;
  observedSelectionActionSize: number;
  observedRasterAssetSize: number;
  rasterAssetBytes: number;
  customAssetBytes: number;
  actionIndexById: Map<number, number>;
  latestCheckpointByLayer: Map<number, LatestCheckpointAccounting>;
  checkpointCountByLayer: Map<number, number>;
  lastRasterActionByLayer: Map<number, { id: number; index: number }>;
  replayTailByLayer: Map<number, HistoryReplayTailAccounting>;
  accountingFullRebuilds: number;
  accountingIncrementalActions: number;
  accountingIncrementalBatches: number;
}

const stateByEngine = new WeakMap<BrushEngine, HistoryMaintenanceState>();

function stateFor(engine: BrushEngine): HistoryMaintenanceState {
  let state = stateByEngine.get(engine);
  if (!state) {
    state = {
      checkpoints: [],
      timer: null,
      generation: 0,
      nextCheckpointId: 1,
      captureInFlight: false,
      capturesStarted: 0,
      capturesCommitted: 0,
      capturesDiscardedStale: 0,
      capturesFailed: 0,
      redoCompactionsScheduled: 0,
      redoCompactionsCompleted: 0,
      redoCompactionsAborted: 0,
      redoCompactionChunks: 0,
      redoCompactionYields: 0,
      redoReleasedSlices: 0,
      floorCursor: 0,
      budgetEvictions: 0,
      depthEvictions: 0,
      evictedPayloadBytes: 0,
      budgetCheckpointBlocked: false,
      checkpointBytes: 0,
      actionCheckpointBytes: 0,
      fullCheckpointCount: 0,
      deltaCheckpointCount: 0,
      accountingInitialized: false,
      accounting: emptyHistoryMemoryLedger(),
      accountingCpuSeen: new WeakSet<object>(),
      accountingSelectionSliceIds: new Set<number>(),
      accountingCheckpointSeeds: new Set<LayerColdStorageResources>(),
      observedActionsLength: 0,
      observedActionsTail: null,
      observedBatchesLength: 0,
      observedBatchesTail: null,
      observedDiscardedVectorLength: 0,
      observedDiscardedVectorTail: null,
      observedDiscardedImportLength: 0,
      observedDiscardedImportTail: null,
      observedDiscardedTransformLength: 0,
      observedDiscardedTransformTail: null,
      observedSelectionRevisionSize: 0,
      observedSelectionActionSize: 0,
      observedRasterAssetSize: 0,
      rasterAssetBytes: 0,
      customAssetBytes: 0,
      actionIndexById: new Map<number, number>(),
      latestCheckpointByLayer: new Map<number, LatestCheckpointAccounting>(),
      checkpointCountByLayer: new Map<number, number>(),
      lastRasterActionByLayer: new Map<number, { id: number; index: number }>(),
      replayTailByLayer: new Map<number, HistoryReplayTailAccounting>(),
      accountingFullRebuilds: 0,
      accountingIncrementalActions: 0,
      accountingIncrementalBatches: 0,
    };
    stateByEngine.set(engine, state);
  }
  return state;
}

function historyMaintenanceEngineIdle(engine: BrushEngine): boolean {
  return engine.initialized
    && !engine.activeStroke
    && !engine.historyBusy
    && !engine.historyStateInconsistent
    && !engine.layerSwitchBusy
    && !engine.selectionBusy
    && !engine.activeVectorHistoryEdit
    && !engine.activeRasterLayerMetadataHistoryEdit
    && !engine.activeRasterTransformSession
    && !engine.rasterStrokeBusy
    && !engine.rasterBevelBusy
    && !engine.rasterOuterShadowBusy
    && !engine.rasterInnerShadowBusy
    && engine.historyCursor === engine.historyActions.length;
}

function yieldHistoryMaintenanceTurn(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

// La classe del dispositivo arriva da `engine-limits`, la stessa che decide il
// documento. Prima veniva risonata qui con una media query sul viewport, quindi
// ruotare il telefono in landscape (`844 px`) portava il budget da 192 a 512
// MiB a meta' sessione, sullo stesso dispositivo.
function historyDeviceCheckpointBytes(engine: BrushEngine): number {
  return LAYER_SIZE * LAYER_SIZE * (engine.layerFormat === "rgba16float" ? 8 : 4);
}

function latestCheckpoint(
  engine: BrushEngine,
  layerId: number,
): { checkpoint: PeriodicRasterHistoryCheckpoint; actionIndex: number } | null {
  if (engine.historyCursor !== engine.historyActions.length) {
    return nearestHistoryCheckpoint(
      engine.historyActions,
      engine.historyCursor,
      layerId,
      stateFor(engine).checkpoints,
    ) as { checkpoint: PeriodicRasterHistoryCheckpoint; actionIndex: number } | null;
  }
  synchronizeHistoryAccounting(engine);
  return stateFor(engine).latestCheckpointByLayer.get(layerId) ?? null;
}

function rasterActionAffectsPixels(kind: string): boolean {
  return kind === "stroke"
    || kind === "fill"
    || kind === "clear"
    || kind === "vector-rasterize"
    || kind === "raster-import"
    || kind === "raster-transform";
}

function bytesForCheckpointCpuMetadata(checkpoint: PeriodicRasterHistoryCheckpoint): number {
  return checkpoint.baseTileMask.byteLength + 96;
}

function estimateStructuralBytes(
  roots: readonly (readonly unknown[])[],
  seen = new WeakSet<object>(),
): number {
  const stack: unknown[] = [];
  for (const root of roots) {
    for (let index = root.length - 1; index >= 0; index -= 1) stack.push(root[index]);
  }
  let bytes = 0;
  while (stack.length > 0) {
    const value = stack.pop();
    if (value === null || value === undefined) {
      bytes += 4;
      continue;
    }
    if (typeof value === "string") {
      bytes += 16 + value.length * 2;
      continue;
    }
    if (typeof value === "number" || typeof value === "bigint") {
      bytes += 8;
      continue;
    }
    if (typeof value === "boolean") {
      bytes += 4;
      continue;
    }
    if (typeof value !== "object" && typeof value !== "function") {
      bytes += 8;
      continue;
    }
    const object = value as object;
    if (seen.has(object)) continue;
    seen.add(object);
    if (value instanceof ArrayBuffer) {
      bytes += 24 + value.byteLength;
      continue;
    }
    if (ArrayBuffer.isView(value)) {
      bytes += 32 + value.byteLength;
      continue;
    }
    if (Array.isArray(value)) {
      bytes += 24 + value.length * 8;
      for (let index = value.length - 1; index >= 0; index -= 1) stack.push(value[index]);
      continue;
    }
    if (value instanceof Map) {
      bytes += 48 + value.size * 16;
      for (const [key, entry] of value) {
        stack.push(key, entry);
      }
      continue;
    }
    if (value instanceof Set) {
      bytes += 48 + value.size * 8;
      for (const entry of value) stack.push(entry);
      continue;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      // Native GPU/DOM handles are accounted by their owning GPU/asset
      // category. Keep only the JS wrapper allowance and never enumerate host
      // internals from a diagnostic pass.
      bytes += 64;
      continue;
    }
    const keys = Object.keys(value);
    bytes += 32 + keys.length * 8;
    for (const key of keys) {
      bytes += key.length * 2;
      stack.push((value as Record<string, unknown>)[key]);
    }
  }
  return bytes;
}

function appendOnlySince<T extends object>(
  values: readonly T[],
  observedLength: number,
  observedTail: object | null,
): boolean {
  return observedLength <= values.length
    && (observedLength === 0 || values[observedLength - 1] === observedTail);
}

function tailObject(values: readonly object[]): object | null {
  return values.length > 0 ? values[values.length - 1] : null;
}

function emptyReplayTail(): HistoryReplayTailAccounting {
  return { actions: 0, batches: 0, bytes: 0 };
}

function accountSelectionSnapshot(
  state: HistoryMaintenanceState,
  snapshot: { gpuSlice: GpuHistorySlice } | null | undefined,
): void {
  if (!snapshot || state.accountingSelectionSliceIds.has(snapshot.gpuSlice.id)) return;
  state.accountingSelectionSliceIds.add(snapshot.gpuSlice.id);
  state.accounting.selectionFillMaskBytes += snapshot.gpuSlice.logicalBytes;
}

function accountCheckpointSeed(
  state: HistoryMaintenanceState,
  action: HistoryAction,
): void {
  if (
    action.kind !== "vector-rasterize"
    && action.kind !== "raster-import"
    && action.kind !== "raster-transform"
  ) {
    return;
  }
  if (!action.seed || state.accountingCheckpointSeeds.has(action.seed)) return;
  state.accountingCheckpointSeeds.add(action.seed);
  state.accounting.checkpointBytes += action.seed.memoryBytes;
  state.actionCheckpointBytes += action.seed.memoryBytes;
}

function accountHistoryAction(
  state: HistoryMaintenanceState,
  action: HistoryAction,
  liveIndex: number | null,
): void {
  state.accounting.cpuVectorBytes += estimateStructuralBytes(
    [[action]],
    state.accountingCpuSeen,
  );
  accountCheckpointSeed(state, action);
  if (action.kind === "raster-transform") {
    accountSelectionSnapshot(state, action.selectionBefore);
    accountSelectionSnapshot(state, action.selectionAfter);
  }
  if (
    liveIndex === null
    || !("layerId" in action)
    || !rasterActionAffectsPixels(action.kind)
  ) {
    return;
  }
  state.actionIndexById.set(action.id, liveIndex);
  state.lastRasterActionByLayer.set(action.layerId, { id: action.id, index: liveIndex });
  const latest = state.latestCheckpointByLayer.get(action.layerId);
  if (latest && liveIndex <= latest.actionIndex) return;
  const tail = state.replayTailByLayer.get(action.layerId) ?? emptyReplayTail();
  tail.actions += 1;
  state.replayTailByLayer.set(action.layerId, tail);
}

function accountHistoryBatch(
  state: HistoryMaintenanceState,
  batch: HistoryRenderBatch,
): void {
  if (batch.kind === "paint") accountSelectionSnapshot(state, batch.selectionMask);
  if (batch.kind === "fill") {
    state.accounting.selectionFillMaskBytes += batch.gpuSlice.logicalBytes;
  }
  const actionIndex = state.actionIndexById.get(batch.actionId);
  if (actionIndex === undefined) return;
  const latest = state.latestCheckpointByLayer.get(batch.layerId);
  if (latest && actionIndex <= latest.actionIndex) return;
  const tail = state.replayTailByLayer.get(batch.layerId) ?? emptyReplayTail();
  tail.batches += 1;
  tail.bytes += batch.gpuSlice.logicalBytes;
  state.replayTailByLayer.set(batch.layerId, tail);
}

function refreshGpuAndAssetAccounting(
  engine: BrushEngine,
  state: HistoryMaintenanceState,
): void {
  const gpuStorage = engine.historyGpuStorage?.stats() ?? {
    allocatedBytes: 0,
    usedLogicalBytes: 0,
    usedReservedBytes: 0,
  };
  state.accounting.gpuReservedBytes = gpuStorage.usedReservedBytes;
  state.accounting.gpuAllocatedBytes = gpuStorage.allocatedBytes;
  // Physical pages are authoritative for the budget. This logical split is
  // diagnostic and includes fenced-but-not-yet-compacted Redo slices.
  state.accounting.gpuPayloadBytes = Math.max(
    0,
    gpuStorage.usedLogicalBytes - state.accounting.selectionFillMaskBytes,
  );
  if (state.observedRasterAssetSize !== engine.rasterImageGpuResources.size) {
    state.rasterAssetBytes = 0;
    for (const resource of engine.rasterImageGpuResources.values()) {
      state.rasterAssetBytes += resource.memoryBytes;
    }
    state.observedRasterAssetSize = engine.rasterImageGpuResources.size;
  }
  state.customAssetBytes = engine.customBrushAssets?.memoryBytes() ?? 0;
  state.accounting.assetBytes = state.rasterAssetBytes + state.customAssetBytes;
}

function rebuildHistoryAccounting(engine: BrushEngine): void {
  const state = stateFor(engine);
  state.accounting = emptyHistoryMemoryLedger();
  state.accountingCpuSeen = new WeakSet<object>();
  state.accountingSelectionSliceIds = new Set<number>();
  state.accountingCheckpointSeeds = new Set<LayerColdStorageResources>();
  state.actionIndexById.clear();
  state.latestCheckpointByLayer.clear();
  state.checkpointCountByLayer.clear();
  state.lastRasterActionByLayer.clear();
  state.replayTailByLayer.clear();
  state.checkpointBytes = 0;
  state.actionCheckpointBytes = 0;
  state.fullCheckpointCount = 0;
  state.deltaCheckpointCount = 0;

  for (let index = 0; index < engine.historyCursor; index += 1) {
    state.actionIndexById.set(engine.historyActions[index].id, index);
  }
  for (const checkpoint of state.checkpoints) {
    state.checkpointBytes += checkpoint.memoryBytes;
    if (checkpoint.kind === "delta") state.deltaCheckpointCount += 1;
    else state.fullCheckpointCount += 1;
    state.accounting.checkpointBytes +=
      checkpoint.memoryBytes + bytesForCheckpointCpuMetadata(checkpoint);
    state.checkpointCountByLayer.set(
      checkpoint.layerId,
      (state.checkpointCountByLayer.get(checkpoint.layerId) ?? 0) + 1,
    );
    const actionIndex = state.actionIndexById.get(checkpoint.afterActionId);
    if (actionIndex === undefined || actionIndex >= engine.historyCursor) continue;
    const selected = state.latestCheckpointByLayer.get(checkpoint.layerId);
    if (!selected || actionIndex > selected.actionIndex) {
      state.latestCheckpointByLayer.set(checkpoint.layerId, { checkpoint, actionIndex });
    }
  }
  engine.historyActions.forEach((action, index) => {
    accountHistoryAction(state, action, index < engine.historyCursor ? index : null);
  });
  for (const action of engine.discardedVectorRasterHistoryActions) {
    accountHistoryAction(state, action, null);
  }
  for (const action of engine.discardedRasterImportHistoryActions) {
    accountHistoryAction(state, action, null);
  }
  for (const action of engine.discardedRasterTransformHistoryActions) {
    accountHistoryAction(state, action, null);
  }
  for (const snapshot of engine.selectionHistoryMasksByRevision.values()) {
    accountSelectionSnapshot(state, snapshot);
  }
  for (const snapshot of engine.selectionHistoryMasksByAction.values()) {
    accountSelectionSnapshot(state, snapshot);
  }
  for (const batch of engine.historyBatches) accountHistoryBatch(state, batch);

  state.observedActionsLength = engine.historyActions.length;
  state.observedActionsTail = tailObject(engine.historyActions);
  state.observedBatchesLength = engine.historyBatches.length;
  state.observedBatchesTail = tailObject(engine.historyBatches);
  state.observedDiscardedVectorLength = engine.discardedVectorRasterHistoryActions.length;
  state.observedDiscardedVectorTail = tailObject(engine.discardedVectorRasterHistoryActions);
  state.observedDiscardedImportLength = engine.discardedRasterImportHistoryActions.length;
  state.observedDiscardedImportTail = tailObject(engine.discardedRasterImportHistoryActions);
  state.observedDiscardedTransformLength = engine.discardedRasterTransformHistoryActions.length;
  state.observedDiscardedTransformTail = tailObject(engine.discardedRasterTransformHistoryActions);
  state.observedSelectionRevisionSize = engine.selectionHistoryMasksByRevision.size;
  state.observedSelectionActionSize = engine.selectionHistoryMasksByAction.size;
  state.observedRasterAssetSize = -1;
  state.rasterAssetBytes = 0;
  state.customAssetBytes = 0;
  state.accountingInitialized = true;
  state.accountingFullRebuilds += 1;
  refreshGpuAndAssetAccounting(engine, state);
}

/**
 * Normal pointer-up is append-only: only the newly committed action/batches
 * are visited. Undo-branch truncation and compaction deliberately fall back to
 * one full rebuild, never to an O(N) scan after every gesture.
 */
function synchronizeHistoryAccounting(engine: BrushEngine): boolean {
  const state = stateFor(engine);
  const appendOnly = state.accountingInitialized
    && appendOnlySince(
      engine.historyActions,
      state.observedActionsLength,
      state.observedActionsTail,
    )
    && appendOnlySince(
      engine.historyBatches,
      state.observedBatchesLength,
      state.observedBatchesTail,
    )
    && appendOnlySince(
      engine.discardedVectorRasterHistoryActions,
      state.observedDiscardedVectorLength,
      state.observedDiscardedVectorTail,
    )
    && appendOnlySince(
      engine.discardedRasterImportHistoryActions,
      state.observedDiscardedImportLength,
      state.observedDiscardedImportTail,
    )
    && appendOnlySince(
      engine.discardedRasterTransformHistoryActions,
      state.observedDiscardedTransformLength,
      state.observedDiscardedTransformTail,
    )
    && state.observedSelectionRevisionSize <= engine.selectionHistoryMasksByRevision.size
    && state.observedSelectionActionSize <= engine.selectionHistoryMasksByAction.size;
  if (!appendOnly) {
    rebuildHistoryAccounting(engine);
    return true;
  }

  for (let index = state.observedActionsLength; index < engine.historyActions.length; index += 1) {
    accountHistoryAction(state, engine.historyActions[index], index);
    state.accountingIncrementalActions += 1;
  }
  const accountDiscarded = <T extends HistoryAction>(
    values: readonly T[],
    start: number,
  ): void => {
    for (let index = start; index < values.length; index += 1) {
      accountHistoryAction(state, values[index], null);
    }
  };
  accountDiscarded(
    engine.discardedVectorRasterHistoryActions,
    state.observedDiscardedVectorLength,
  );
  accountDiscarded(
    engine.discardedRasterImportHistoryActions,
    state.observedDiscardedImportLength,
  );
  accountDiscarded(
    engine.discardedRasterTransformHistoryActions,
    state.observedDiscardedTransformLength,
  );
  for (let index = state.observedBatchesLength; index < engine.historyBatches.length; index += 1) {
    accountHistoryBatch(state, engine.historyBatches[index]);
    state.accountingIncrementalBatches += 1;
  }
  state.observedActionsLength = engine.historyActions.length;
  state.observedActionsTail = tailObject(engine.historyActions);
  state.observedBatchesLength = engine.historyBatches.length;
  state.observedBatchesTail = tailObject(engine.historyBatches);
  state.observedDiscardedVectorLength = engine.discardedVectorRasterHistoryActions.length;
  state.observedDiscardedVectorTail = tailObject(engine.discardedVectorRasterHistoryActions);
  state.observedDiscardedImportLength = engine.discardedRasterImportHistoryActions.length;
  state.observedDiscardedImportTail = tailObject(engine.discardedRasterImportHistoryActions);
  state.observedDiscardedTransformLength = engine.discardedRasterTransformHistoryActions.length;
  state.observedDiscardedTransformTail = tailObject(engine.discardedRasterTransformHistoryActions);
  state.observedSelectionRevisionSize = engine.selectionHistoryMasksByRevision.size;
  state.observedSelectionActionSize = engine.selectionHistoryMasksByAction.size;
  refreshGpuAndAssetAccounting(engine, state);
  return false;
}

export function historyMemoryLedger(engine: BrushEngine): HistoryMemoryLedger {
  synchronizeHistoryAccounting(engine);
  return { ...stateFor(engine).accounting };
}

function effectsWorkingSetBytes(engine: BrushEngine): number {
  const stroke = engine.rasterStrokeRenderer;
  const bevel = engine.rasterBevelRenderer;
  const outer = engine.rasterOuterShadowRenderer;
  const inner = engine.rasterInnerShadowRenderer;
  return (engine.effectsWorkbench?.scratchPool.snapshot().currentBytes ?? 0)
    + (stroke?.styledMemoryBytes ?? 0)
    + (stroke?.coverageMemoryBytes ?? 0)
    + (stroke?.thresholdMaskMemoryBytes ?? 0)
    + (stroke?.controlMemoryBytes ?? 0)
    + (bevel?.heightMemoryBytes ?? 0)
    + (bevel?.lutMemoryBytes ?? 0)
    + (bevel?.controlMemoryBytes ?? 0)
    + (outer?.coverageMemoryBytes ?? 0)
    + (outer?.controlMemoryBytes ?? 0)
    + (inner?.coverageMemoryBytes ?? 0)
    + (inner?.controlMemoryBytes ?? 0);
}

function historyBudgetForEngine(engine: BrushEngine) {
  const baseBytes = historyBaseBudgetBytes({
    checkpointBytes: historyDeviceCheckpointBytes(engine),
    mobile: MOBILE_DEVICE_CLASS,
  });
  const effectsBytes = effectsWorkingSetBytes(engine);
  const availableBytes = Math.max(
    HISTORY_MINIMUM_BUDGET_BYTES,
    baseBytes - effectsBytes,
  );
  return {
    budget: createHistoryBudget(availableBytes),
    baseBytes,
    effectsBytes,
  };
}

function replayTailMetrics(engine: BrushEngine, layerId: number): HistoryReplayTailAccounting {
  synchronizeHistoryAccounting(engine);
  const tail = stateFor(engine).replayTailByLayer.get(layerId);
  return tail ? { ...tail } : emptyReplayTail();
}

function changedTileMask(
  engine: BrushEngine,
  layerId: number,
  afterActionIndex: number,
): { mask: Uint32Array; reset: boolean; requiresFull: boolean } {
  const mask = createLayerStorageTileMask();
  const includedActionIds = new Set<number>();
  let reset = false;
  let requiresFull = false;
  for (let index = afterActionIndex + 1; index < engine.historyCursor; index += 1) {
    const action = engine.historyActions[index];
    if (!("layerId" in action) || action.layerId !== layerId) continue;
    if (action.kind === "clear") {
      mask.fill(0);
      includedActionIds.clear();
      reset = true;
      requiresFull = false;
    } else if (
      action.kind === "vector-rasterize"
      || action.kind === "raster-import"
      || action.kind === "raster-transform"
    ) {
      requiresFull = true;
    }
    if (action.kind === "stroke" || action.kind === "fill") {
      includedActionIds.add(action.id);
    }
  }
  for (const batch of engine.historyBatches) {
    if (batch.layerId !== layerId || !includedActionIds.has(batch.actionId)) continue;
    if (batch.kind === "fill") {
      for (let index = 0; index < mask.length; index += 1) mask[index] |= batch.tileMask[index];
    } else if (batch.dirtyRect) {
      markLayerStorageRect(mask, batch.dirtyRect);
    }
  }
  return { mask, reset, requiresFull };
}

async function capturePeriodicCheckpoint(
  engine: BrushEngine,
  expectedGeneration = stateFor(engine).generation,
): Promise<void> {
  const state = stateFor(engine);
  const shouldContinue = (): boolean => (
    expectedGeneration === state.generation
    && historyMaintenanceEngineIdle(engine)
    && !engine.deviceLostError
  );
  if (state.captureInFlight || !shouldContinue()) return;
  synchronizeHistoryAccounting(engine);
  const record = engine.layerStack.active;
  const layerId = record.id;
  const lastRasterAction = state.lastRasterActionByLayer.get(layerId) ?? null;
  if (!lastRasterAction) return;
  const current = state.latestCheckpointByLayer.get(layerId) ?? null;
  if (current?.checkpoint.afterActionId === lastRasterAction.id) return;

  // O(1) after the normal append-only gesture: decide before deriving a tile
  // mask, indexing the journal or allocating a checkpoint texture.
  const tail = state.replayTailByLayer.get(layerId) ?? emptyReplayTail();
  const ledger = { ...state.accounting };
  const budgetInfo = historyBudgetForEngine(engine);
  const budgetPressure = historyBudgetPressure(ledger, budgetInfo.budget);
  const plan = planHistoryCheckpoint({
    actionsSinceCheckpoint: tail.actions,
    replayBatchesSinceCheckpoint: tail.batches,
    payloadBytesSinceCheckpoint: tail.bytes,
    budgetPressure,
  });
  if (!plan.capture) return;

  const checkpointOrdinal = (state.checkpointCountByLayer.get(layerId) ?? 0) + 1;
  const delta = changedTileMask(engine, layerId, current?.actionIndex ?? -1);
  // Il tetto di profondita' puo' liberare soltanto fino a un checkpoint full.
  // Se la coda ha gia' superato i passi promessi e non esiste un full
  // abbastanza recente, il tetto resterebbe inerte: qui gliene creiamo uno.
  // Non costa piu' di un delta in una sessione che dipinge in largo, dove il
  // delta copre comunque quasi tutti i tile.
  const depthCapNeedsBoundary = planHistoryDepthEviction({
    cursor: engine.historyCursor,
    floorCursor: state.floorCursor,
  }).required;
  const forceFull = !current
    || delta.requiresFull
    || budgetPressure >= 1
    || depthCapNeedsBoundary
    || checkpointOrdinal % HISTORY_FULL_CHECKPOINT_PERIOD === 0;
  const mask = forceFull ? record.storageTileMask.slice() : delta.mask;
  if (engine.layerContentBounds && forceFull) {
    markLayerStorageRect(mask, engine.layerContentBounds);
  }
  const blank = !engine.layerHasContent;
  if (!blank && countLayerStorageTiles(mask) === 0) return;

  const anchorId = lastRasterAction.id;
  const anchorCursor = engine.historyCursor;
  const activeLayerId = layerId;
  const baseBounds = engine.layerContentBounds ? { ...engine.layerContentBounds } : null;
  const baseTileMask = record.storageTileMask.slice();
  const parentId = forceFull || delta.reset ? null : current?.checkpoint.id ?? null;
  state.captureInFlight = true;
  state.capturesStarted += 1;
  let seed: LayerColdStorageResources | null = null;
  try {
    await engine.waitForIdle();
    if (!shouldContinue()) {
      state.capturesDiscardedStale += 1;
      return;
    }
    if (!blank) {
      const hot = engine.requireLayerGpu(layerId).hot;
      if (!hot) return;
      seed = await createLayerColdStorageCandidateIncrementally(
        engine,
        record,
        hot,
        mask,
        state.nextCheckpointId,
        {
          shouldContinue,
          yieldTurn: yieldHistoryMaintenanceTurn,
        },
      );
      if (!seed) {
        state.capturesDiscardedStale += 1;
        return;
      }
    }
    const anchorStillAtCursor = engine.historyCursor === anchorCursor
      && engine.historyActions[anchorCursor - 1]?.id >= anchorId
      && engine.layerStack.active.id === activeLayerId
      && shouldContinue();
    if (!anchorStillAtCursor) {
      destroyLayerColdStorage(seed);
      seed = null;
      state.capturesDiscardedStale += 1;
      return;
    }
    const checkpoint: PeriodicRasterHistoryCheckpoint = {
      id: state.nextCheckpointId++,
      layerId,
      afterActionId: anchorId,
      parentId,
      kind: blank ? "blank" : forceFull || delta.reset ? "full" : "delta",
      seed,
      baseBounds,
      baseTileMask,
      memoryBytes: seed?.memoryBytes ?? 0,
    };
    seed = null;
    state.checkpoints.push(checkpoint);
    state.checkpointBytes += checkpoint.memoryBytes;
    state.accounting.checkpointBytes +=
      checkpoint.memoryBytes + bytesForCheckpointCpuMetadata(checkpoint);
    state.checkpointCountByLayer.set(layerId, checkpointOrdinal);
    if (checkpoint.kind === "delta") state.deltaCheckpointCount += 1;
    else state.fullCheckpointCount += 1;
    state.latestCheckpointByLayer.set(layerId, {
      checkpoint,
      actionIndex: lastRasterAction.index,
    });
    state.replayTailByLayer.set(layerId, emptyReplayTail());
    state.capturesCommitted += 1;
    engine.publishStats();
  } catch (error) {
    state.capturesFailed += 1;
    throw error;
  } finally {
    destroyLayerColdStorage(seed);
    state.captureInFlight = false;
  }
}

/**
 * Returns a standalone/full checkpoint followed by zero or more delta tile
 * patches. Applying the chain in order after a clear reconstructs exact pixels.
 */
export function periodicCheckpointChainForReplay(
  engine: BrushEngine,
  layerId: number,
): { checkpoints: PeriodicRasterHistoryCheckpoint[]; actionIndex: number } | null {
  const state = stateFor(engine);
  const selected = latestCheckpoint(engine, layerId);
  if (!selected) return null;
  const byId = new Map(state.checkpoints.map((checkpoint) => [checkpoint.id, checkpoint]));
  const reverse: PeriodicRasterHistoryCheckpoint[] = [];
  let cursor: PeriodicRasterHistoryCheckpoint | undefined = selected.checkpoint;
  const seen = new Set<number>();
  while (cursor) {
    if (seen.has(cursor.id)) throw new Error("Ciclo nei checkpoint raster periodici.");
    seen.add(cursor.id);
    reverse.push(cursor);
    if (cursor.kind === "full" || cursor.kind === "blank") break;
    cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId);
  }
  if (reverse.at(-1)?.kind === "delta") {
    return null;
  }
  return { checkpoints: reverse.reverse(), actionIndex: selected.actionIndex };
}

export function discardStalePeriodicCheckpoints(engine: BrushEngine): void {
  const state = stateFor(engine);
  const liveActionIds = new Set(engine.historyActions.map((action) => action.id));
  const retained: PeriodicRasterHistoryCheckpoint[] = [];
  const retainedIds = new Set<number>();
  let changed = false;
  for (const checkpoint of state.checkpoints) {
    if (!liveActionIds.has(checkpoint.afterActionId)) {
      destroyLayerColdStorage(checkpoint.seed);
      changed = true;
      continue;
    }
    if (checkpoint.parentId !== null && !retainedIds.has(checkpoint.parentId)) {
      destroyLayerColdStorage(checkpoint.seed);
      changed = true;
      continue;
    }
    retained.push(checkpoint);
    retainedIds.add(checkpoint.id);
  }
  state.checkpoints = retained;
  if (changed) rebuildHistoryAccounting(engine);
}

/**
 * `newestAllowedActionIndex` limita quanto in avanti puo' spingersi il
 * boundary: il tetto di profondita' lo usa per non tagliare mai sotto i passi
 * di Undo che ha promesso di conservare.
 */
function latestFullCheckpointByLayer(
  engine: BrushEngine,
  newestAllowedActionIndex = Number.POSITIVE_INFINITY,
): Map<number, { checkpoint: PeriodicRasterHistoryCheckpoint; actionIndex: number }> | null {
  const state = stateFor(engine);
  synchronizeHistoryAccounting(engine);
  const indices = state.actionIndexById;
  const result = new Map<number, {
    checkpoint: PeriodicRasterHistoryCheckpoint;
    actionIndex: number;
  }>();
  const rasterLayerIdsWithHistory = new Set<number>();
  for (let index = 0; index < engine.historyCursor; index += 1) {
    const action = engine.historyActions[index];
    if (
      "layerId" in action
      && rasterActionAffectsPixels(action.kind)
      && engine.layerStack.byId(action.layerId)
    ) {
      rasterLayerIdsWithHistory.add(action.layerId);
    }
  }
  for (const layerId of rasterLayerIdsWithHistory) {
    let selected: {
      checkpoint: PeriodicRasterHistoryCheckpoint;
      actionIndex: number;
    } | null = null;
    for (const checkpoint of state.checkpoints) {
      if (checkpoint.layerId !== layerId || checkpoint.kind === "delta") continue;
      const actionIndex = indices.get(checkpoint.afterActionId);
      if (
        actionIndex === undefined
        || actionIndex >= engine.historyCursor
        || actionIndex > newestAllowedActionIndex
      ) {
        continue;
      }
      if (!selected || actionIndex > selected.actionIndex) {
        selected = { checkpoint, actionIndex };
      }
    }
    if (!selected) return null;
    result.set(layerId, selected);
  }
  return result;
}

/**
 * Evicts only payload already represented by standalone tiled checkpoints.
 * The global cursor floor prevents the user from crossing into released data;
 * metadata remains available for diagnostics and stable action ids.
 *
 * Due gate lo invocano: il tetto di profondita', che libera cio' che e' gia'
 * oltre i passi di Undo promessi, e il budget in byte, che resta l'autorita'
 * finale. Il primo non puo' mai tagliare piu' del secondo perche' riceve un
 * `newestAllowedActionIndex`.
 */
function evictHistoryBelowBaselines(
  engine: BrushEngine,
  baselines: Map<number, { checkpoint: PeriodicRasterHistoryCheckpoint; actionIndex: number }>,
): boolean {
  const state = stateFor(engine);
  const candidateFloor = Math.max(
    state.floorCursor,
    ...[...baselines.values()].map(({ actionIndex }) => actionIndex + 1),
  );
  if (candidateFloor <= state.floorCursor) return false;
  const actionIndices = state.actionIndexById;
  const retainedBatches: HistoryRenderBatch[] = [];
  const releasedSlices: GpuHistorySlice[] = [];
  let evictedPayloadBytes = 0;
  for (const batch of engine.historyBatches) {
    const baseline = baselines.get(batch.layerId);
    const batchIndex = actionIndices.get(batch.actionId);
    if (baseline && batchIndex !== undefined && batchIndex <= baseline.actionIndex) {
      releasedSlices.push(batch.gpuSlice);
      evictedPayloadBytes += batch.gpuSlice.logicalBytes;
    } else {
      retainedBatches.push(batch);
    }
  }
  engine.historyGpuStorage.releaseMany(releasedSlices);
  engine.historyBatches = retainedBatches;
  engine.historyStoredBaseStamps = retainedBatches.reduce((total, batch) => (
    total + (batch.kind === "paint"
      ? batch.stampCount
      : batch.kind === "blend"
        ? batch.batches.length
        : 0)
  ), 0);

  const retainedActionIds = new Set(retainedBatches.map((batch) => batch.actionId));
  for (const actionId of engine.selectionHistoryMasksByAction.keys()) {
    if (!retainedActionIds.has(actionId) && (actionIndices.get(actionId) ?? Infinity) < candidateFloor) {
      engine.selectionHistoryMasksByAction.delete(actionId);
    }
  }
  const retainedSnapshots = new Set(engine.selectionHistoryMasksByAction.values());
  const releasedSelectionSlices: GpuHistorySlice[] = [];
  for (const [revision, snapshot] of engine.selectionHistoryMasksByRevision) {
    if (!retainedSnapshots.has(snapshot)) {
      releasedSelectionSlices.push(snapshot.gpuSlice);
      engine.selectionHistoryMasksByRevision.delete(revision);
      engine.selectionHistoryClipBindGroups.delete(snapshot.gpuSlice.id);
    }
  }
  engine.historyGpuStorage.releaseMany(releasedSelectionSlices);
  evictedPayloadBytes += releasedSelectionSlices.reduce(
    (total, slice) => total + slice.logicalBytes,
    0,
  );

  const retainedCheckpoints: PeriodicRasterHistoryCheckpoint[] = [];
  for (const checkpoint of state.checkpoints) {
    const baseline = baselines.get(checkpoint.layerId);
    const checkpointIndex = actionIndices.get(checkpoint.afterActionId);
    if (
      baseline
      && checkpointIndex !== undefined
      && checkpointIndex < baseline.actionIndex
    ) {
      state.checkpointBytes -= checkpoint.memoryBytes;
      destroyLayerColdStorage(checkpoint.seed);
    } else {
      retainedCheckpoints.push(checkpoint);
    }
  }
  state.checkpoints = retainedCheckpoints;
  state.floorCursor = candidateFloor;
  state.evictedPayloadBytes += evictedPayloadBytes;
  engine.historyGpuStorage.trimEmptyPages(true);
  rebuildHistoryAccounting(engine);
  engine.publishHistoryState();
  engine.publishStats();
  return true;
}

/**
 * Tetto secondario: taglia solo cio' che e' gia' oltre `HISTORY_MAXIMUM_UNDO_DEPTH`
 * passi **e** coperto da un checkpoint full. Il budget in byte resta l'autorita',
 * questo rende soltanto prevedibile il caso tipico.
 */
function enforceHistoryDepthCap(engine: BrushEngine): void {
  const state = stateFor(engine);
  const plan = planHistoryDepthEviction({
    cursor: engine.historyCursor,
    floorCursor: state.floorCursor,
  });
  if (!plan.required || plan.newestRetainedActionIndex === null) return;
  const baselines = latestFullCheckpointByLayer(engine, plan.newestRetainedActionIndex);
  if (!baselines || baselines.size === 0) return;
  if (evictHistoryBelowBaselines(engine, baselines)) state.depthEvictions += 1;
}

function enforceHistoryBudget(engine: BrushEngine): void {
  const state = stateFor(engine);
  enforceHistoryDepthCap(engine);
  const ledger = historyMemoryLedger(engine);
  const { budget } = historyBudgetForEngine(engine);
  if (historyMemoryTotalBytes(ledger) <= budget.hardBytes) {
    state.budgetCheckpointBlocked = false;
    return;
  }
  const baselines = latestFullCheckpointByLayer(engine);
  if (!baselines || baselines.size === 0) {
    state.budgetCheckpointBlocked = true;
    return;
  }
  const evicted = evictHistoryBelowBaselines(engine, baselines);
  if (evicted) state.budgetEvictions += 1;
  state.budgetCheckpointBlocked = !evicted;
}

export function historyFloorCursor(engine: BrushEngine): number {
  return stateFor(engine).floorCursor;
}

export function historyCheckpointAllocatedBytes(engine: BrushEngine): number {
  synchronizeHistoryAccounting(engine);
  const state = stateFor(engine);
  return state.checkpointBytes + state.actionCheckpointBytes;
}

export function historyCursorWithinRetainedRange(
  engine: BrushEngine,
  nextCursor: number,
): boolean {
  return nextCursor >= stateFor(engine).floorCursor;
}

export function scheduleHistoryMaintenance(engine: BrushEngine): void {
  const state = stateFor(engine);
  state.generation += 1;
  if (engine.historyCompactionPending) state.redoCompactionsScheduled += 1;
  if (state.timer !== null) window.clearTimeout(state.timer);
  state.timer = window.setTimeout(() => {
    state.timer = null;
    if (!historyMaintenanceEngineIdle(engine)) {
      return;
    }
    const expectedGeneration = state.generation;
    void engine.device.queue.onSubmittedWorkDone().then(async () => {
      if (
        expectedGeneration !== state.generation
        || !historyMaintenanceEngineIdle(engine)
        || engine.deviceLostError
      ) {
        return;
      }
      // Pointer-up may still have a final RAF batch in JavaScript even though
      // the queue prefix observed above is empty. Pump it before deriving the
      // action tail and changed-tile mask; otherwise a checkpoint could miss
      // the final stamps of the gesture it claims to anchor.
      await engine.waitForIdle();
      if (
        expectedGeneration !== state.generation
        || !historyMaintenanceEngineIdle(engine)
        || engine.deviceLostError
      ) {
        return;
      }
      // Redo resources are not reused until this fence. Scan and destruction
      // then advance by one bounded chunk per browser turn; a new gesture or
      // transaction invalidates the gate before the next chunk.
      if (engine.historyCompactionPending) {
        const compaction = await engine.compactDiscardedHistoryIncrementally({
          shouldContinue: () => (
            expectedGeneration === state.generation
            && historyMaintenanceEngineIdle(engine)
            && !engine.deviceLostError
          ),
          yieldTurn: yieldHistoryMaintenanceTurn,
        });
        state.redoCompactionChunks += compaction.chunks;
        state.redoCompactionYields += compaction.yields;
        state.redoReleasedSlices += compaction.releasedSlices;
        if (!compaction.completed) {
          state.redoCompactionsAborted += 1;
          return;
        }
        state.redoCompactionsCompleted += 1;
      }
      const accountingRebuilt = synchronizeHistoryAccounting(engine);
      if (accountingRebuilt) discardStalePeriodicCheckpoints(engine);
      if (expectedGeneration !== state.generation) return;
      await capturePeriodicCheckpoint(engine, expectedGeneration);
      if (expectedGeneration !== state.generation) return;
      enforceHistoryBudget(engine);
    }).catch(() => {
      // device.lost is surfaced by the engine-wide gate.
    });
  }, HISTORY_MAINTENANCE_DELAY_MS);
}

export function cancelHistoryMaintenance(engine: BrushEngine): void {
  const state = stateFor(engine);
  state.generation += 1;
  if (state.timer !== null) {
    window.clearTimeout(state.timer);
    state.timer = null;
  }
}

export function destroyHistoryMaintenance(engine: BrushEngine): void {
  const state = stateFor(engine);
  cancelHistoryMaintenance(engine);
  for (const checkpoint of state.checkpoints) destroyLayerColdStorage(checkpoint.seed);
  state.checkpoints = [];
  state.checkpointBytes = 0;
  state.floorCursor = 0;
  stateByEngine.delete(engine);
}

export function historyMaintenanceTelemetry(
  engine: BrushEngine,
): HistoryMaintenanceTelemetry {
  const state = stateFor(engine);
  const memory = historyMemoryLedger(engine);
  const { budget, baseBytes, effectsBytes } = historyBudgetForEngine(engine);
  return {
    checkpointCount: state.checkpoints.length,
    fullCheckpointCount: state.fullCheckpointCount,
    deltaCheckpointCount: state.deltaCheckpointCount,
    checkpointBytes: state.checkpointBytes,
    memory,
    totalBytes: historyMemoryTotalBytes(memory),
    budgetBytes: budget.hardBytes,
    baseBudgetBytes: baseBytes,
    effectsWorkingSetBytes: effectsBytes,
    budgetPressure: historyBudgetPressure(memory, budget),
    replayTailBatches: replayTailMetrics(engine, engine.layerStack.active.id).batches,
    capturesStarted: state.capturesStarted,
    capturesCommitted: state.capturesCommitted,
    capturesDiscardedStale: state.capturesDiscardedStale,
    capturesFailed: state.capturesFailed,
    redoCompactionsScheduled: state.redoCompactionsScheduled,
    redoCompactionsCompleted: state.redoCompactionsCompleted,
    redoCompactionsAborted: state.redoCompactionsAborted,
    redoCompactionChunks: state.redoCompactionChunks,
    redoCompactionYields: state.redoCompactionYields,
    redoReleasedSlices: state.redoReleasedSlices,
    floorCursor: state.floorCursor,
    budgetEvictions: state.budgetEvictions,
    depthEvictions: state.depthEvictions,
    maximumUndoDepth: HISTORY_MAXIMUM_UNDO_DEPTH,
    evictedPayloadBytes: state.evictedPayloadBytes,
    budgetCheckpointBlocked: state.budgetCheckpointBlocked,
    accountingFullRebuilds: state.accountingFullRebuilds,
    accountingIncrementalActions: state.accountingIncrementalActions,
    accountingIncrementalBatches: state.accountingIncrementalBatches,
  };
}
