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
  historyColdSeedResidentBytes,
  isHistoryColdSeedHandle,
} from "./history-cold-seed";
import {
  countLayerStorageTiles,
  createLayerStorageTileMask,
  LAYER_STORAGE_TILE_SIZE,
  markLayerStorageRect,
} from "./layer-storage-study";
import { LAYER_SIZE, MOBILE_DEVICE_CLASS } from "./engine-limits";
import {
  HISTORY_MINIMUM_BUDGET_BYTES,
  createHistoryBudget,
  emptyHistoryMemoryLedger,
  historyBaseBudgetBytes,
  admitHistoryCheckpoint,
  historyAccountingIsAppendOnly,
  historyBudgetPressure,
  historyMemoryTotalBytes,
  HISTORY_SPILL_BUDGET_FRACTION,
  HISTORY_SPILL_HIGH_WATER_BYTES,
  nearestHistoryCheckpoint,
  planHistoryCheckpoint,
  planHistoryBudgetRecovery,
  selectCheckpointRepresentation,
  type HistoryMemoryLedger,
} from "./history-retention-core";

const MEBIBYTE_BYTES = 1024 * 1024;
const HISTORY_FULL_CHECKPOINT_PERIOD = 8;
const HISTORY_MAINTENANCE_DELAY_MS = 140;
const HISTORY_DEV_SPILL_HIGH_WATER_BYTES = (() => {
  if (!import.meta.env.DEV || typeof location === "undefined") return null;
  const raw = new URLSearchParams(location.search).get("historySpillMiB");
  if (raw === null) return null;
  const mib = Number(raw);
  return Number.isFinite(mib) && mib > 0
    ? Math.max(64 * 1024, Math.floor(mib * MEBIBYTE_BYTES))
    : null;
})();

export interface PeriodicRasterHistoryCheckpoint {
  readonly id: number;
  readonly layerId: number;
  readonly afterActionId: number;
  readonly parentId: number | null;
  readonly kind: "full" | "delta" | "blank";
  seed: LayerColdStorageResources | null;
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
  /** Resident-byte threshold that starts the local-storage spill pass. */
  readonly spillHighWaterBytes: number;
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
  readonly evictedPayloadBytes: number;
  readonly budgetCheckpointBlocked: boolean;
  readonly accountingFullRebuilds: number;
  readonly accountingIncrementalActions: number;
  readonly accountingIncrementalBatches: number;
  readonly localStorage: ReturnType<BrushEngine["historyLocalStorage"]["telemetry"]>;
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
  /** Catture rifiutate perche' avrebbero sforato il bersaglio del budget. */
  capturesRefusedForBudget: number;
  /** Checkpoint buttati come cache, senza toccare la profondita' di Undo. */
  checkpointCacheEvictions: number;
  redoCompactionsScheduled: number;
  redoCompactionsCompleted: number;
  redoCompactionsAborted: number;
  redoCompactionChunks: number;
  redoCompactionYields: number;
  redoReleasedSlices: number;
  floorCursor: number;
  budgetEvictions: number;
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
  /** Cursore al momento dell'ultima sincronizzazione: spostarlo invalida. */
  observedCursor: number;
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
  observedDiscardedStructuralLength: number;
  observedDiscardedStructuralTail: object | null;
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
      capturesRefusedForBudget: 0,
      checkpointCacheEvictions: 0,
      redoCompactionsScheduled: 0,
      redoCompactionsCompleted: 0,
      redoCompactionsAborted: 0,
      redoCompactionChunks: 0,
      redoCompactionYields: 0,
      redoReleasedSlices: 0,
      floorCursor: 0,
      budgetEvictions: 0,
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
      observedCursor: -1,
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
      observedDiscardedStructuralLength: 0,
      observedDiscardedStructuralTail: null,
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

function historyMaintenanceEngineIdle(
  engine: BrushEngine,
  allowCurrentStorageOperation = false,
): boolean {
  const storageBusy = engine.historyLocalStorage.telemetry().busy;
  return engine.initialized
    && !engine.activeStroke
    && !engine.historyBusy
    && !engine.historyStateInconsistent
    && !engine.layerSwitchBusy
    && !engine.selectionBusy
    && !engine.activeVectorHistoryEdit
    && !engine.activeRasterLayerMetadataHistoryEdit
    && !engine.activeRasterTransformSession
    && !engine.activeRasterGaussianBlurSession
    && !engine.activeRasterMotionBlurSession
    && !engine.activeRasterNoiseSession
    && !engine.rasterStrokeBusy
    && !engine.rasterBevelBusy
    && !engine.rasterOuterShadowBusy
    && !engine.rasterInnerShadowBusy
    && (allowCurrentStorageOperation ? storageBusy !== "hydrating" : storageBusy === "idle")
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
  cursor = engine.historyCursor,
): { checkpoint: PeriodicRasterHistoryCheckpoint; actionIndex: number } | null {
  if (cursor !== engine.historyActions.length) {
    return nearestHistoryCheckpoint(
      engine.historyActions,
      cursor,
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
    || kind === "raster-transform"
    || kind === "raster-filter"
    || kind === "layer-merge";
}

function bytesForCheckpointCpuMetadata(checkpoint: PeriodicRasterHistoryCheckpoint): number {
  return checkpoint.baseTileMask.byteLength + 96;
}

function estimateStructuralBytes(
  engine: BrushEngine,
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
    // Stable History handles intentionally expose throwing accessors while
    // their physical payload is on disk. They are opaque references here:
    // GPU/cold bytes have their own exact ledger and structural accounting
    // must never dereference a non-resident payload.
    if (isHistoryColdSeedHandle(value as LayerColdStorageResources)) {
      bytes += 96;
      continue;
    }
    const id = Object.getOwnPropertyDescriptor(object, "id")?.value;
    if (
      typeof id === "number"
      && engine.historyGpuStorage.contains(value as GpuHistorySlice)
    ) {
      bytes += 64;
      continue;
    }
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

function tailObject(values: readonly object[]): object | null {
  return values.length > 0 ? values[values.length - 1] : null;
}

function discardedStructuralHistoryActions(engine: BrushEngine): readonly HistoryAction[] {
  if (engine.discardedLayerMergeHistoryActions.length === 0) {
    return engine.discardedLayerDeleteHistoryActions;
  }
  return [
    ...engine.discardedLayerDeleteHistoryActions,
    ...engine.discardedLayerMergeHistoryActions,
  ];
}

function emptyReplayTail(): HistoryReplayTailAccounting {
  return { actions: 0, batches: 0, bytes: 0 };
}

function accountSelectionSnapshot(
  engine: BrushEngine,
  state: HistoryMaintenanceState,
  snapshot: { gpuSlice: GpuHistorySlice } | null | undefined,
): void {
  if (!snapshot || state.accountingSelectionSliceIds.has(snapshot.gpuSlice.id)) return;
  state.accountingSelectionSliceIds.add(snapshot.gpuSlice.id);
  if (engine.historyGpuStorage.isResident(snapshot.gpuSlice)) {
    state.accounting.selectionFillMaskBytes += snapshot.gpuSlice.logicalBytes;
  }
}

function accountCheckpointSeed(
  state: HistoryMaintenanceState,
  action: HistoryAction,
): void {
  const account = (seed: LayerColdStorageResources | null | undefined): void => {
    if (!seed || state.accountingCheckpointSeeds.has(seed)) return;
    state.accountingCheckpointSeeds.add(seed);
    const residentBytes = historyColdSeedResidentBytes(seed);
    state.accounting.checkpointBytes += residentBytes;
    state.actionCheckpointBytes += residentBytes;
  };
  if (action.kind === "layer-delete") {
    for (const entry of action.entries) account(entry.seed);
    return;
  }
  if (action.kind === "layer-merge") {
    for (const input of action.inputs) {
      if (input.kind === "raster") account(input.entry.seed);
    }
    account(action.output.seed);
    return;
  }
  if (
    action.kind !== "vector-rasterize"
    && action.kind !== "raster-import"
    && action.kind !== "raster-transform"
    && action.kind !== "raster-filter"
  ) {
    return;
  }
  account(action.seed);
}

function accountHistoryAction(
  engine: BrushEngine,
  state: HistoryMaintenanceState,
  action: HistoryAction,
  liveIndex: number | null,
): void {
  state.accounting.cpuVectorBytes += estimateStructuralBytes(
    engine,
    [[action]],
    state.accountingCpuSeen,
  );
  accountCheckpointSeed(state, action);
  if (action.kind === "raster-transform") {
    accountSelectionSnapshot(engine, state, action.selectionBefore);
    accountSelectionSnapshot(engine, state, action.selectionAfter);
  }
  if (liveIndex !== null && action.kind === "layer-merge") {
    const layerId = action.output.layerRecord.id;
    state.actionIndexById.set(action.id, liveIndex);
    state.lastRasterActionByLayer.set(layerId, { id: action.id, index: liveIndex });
    state.replayTailByLayer.set(layerId, emptyReplayTail());
    return;
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
  engine: BrushEngine,
  state: HistoryMaintenanceState,
  batch: HistoryRenderBatch,
): void {
  if (batch.kind === "paint") accountSelectionSnapshot(engine, state, batch.selectionMask);
  if (batch.kind === "fill" && engine.historyGpuStorage.isResident(batch.gpuSlice)) {
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
  const discardedStructural = discardedStructuralHistoryActions(engine);
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
    const residentBytes = historyColdSeedResidentBytes(checkpoint.seed);
    state.checkpointBytes += residentBytes;
    if (checkpoint.kind === "delta") state.deltaCheckpointCount += 1;
    else state.fullCheckpointCount += 1;
    state.accounting.checkpointBytes +=
      residentBytes + bytesForCheckpointCpuMetadata(checkpoint);
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
    accountHistoryAction(engine, state, action, index < engine.historyCursor ? index : null);
  });
  for (const action of engine.discardedVectorRasterHistoryActions) {
    accountHistoryAction(engine, state, action, null);
  }
  for (const action of engine.discardedRasterImportHistoryActions) {
    accountHistoryAction(engine, state, action, null);
  }
  for (const action of engine.discardedRasterTransformHistoryActions) {
    accountHistoryAction(engine, state, action, null);
  }
  for (const action of discardedStructural) {
    accountHistoryAction(engine, state, action, null);
  }
  for (const snapshot of engine.selectionHistoryMasksByRevision.values()) {
    accountSelectionSnapshot(engine, state, snapshot);
  }
  for (const snapshot of engine.selectionHistoryMasksByAction.values()) {
    accountSelectionSnapshot(engine, state, snapshot);
  }
  for (const batch of engine.historyBatches) accountHistoryBatch(engine, state, batch);

  state.observedCursor = engine.historyCursor;
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
  state.observedDiscardedStructuralLength = discardedStructural.length;
  state.observedDiscardedStructuralTail = tailObject(discardedStructural);
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
  const discardedStructural = discardedStructuralHistoryActions(engine);
  // La decisione vive in `history-retention-core`, che non importa il motore e
  // quindi si puo' esercitare nella suite senza GPU. Qui resta solo il compito
  // di dire cosa si vede: e' il punto in cui il difetto del cursore si era
  // nascosto, e tenerlo in un modulo provabile e' l'unica difesa che regge.
  const appendOnly = historyAccountingIsAppendOnly(
    {
      initialized: state.accountingInitialized,
      cursor: state.observedCursor,
      actionsLength: state.observedActionsLength,
      actionsTail: state.observedActionsTail,
      batchesLength: state.observedBatchesLength,
      batchesTail: state.observedBatchesTail,
      discardedVectorLength: state.observedDiscardedVectorLength,
      discardedVectorTail: state.observedDiscardedVectorTail,
      discardedImportLength: state.observedDiscardedImportLength,
      discardedImportTail: state.observedDiscardedImportTail,
      discardedTransformLength: state.observedDiscardedTransformLength,
      discardedTransformTail: state.observedDiscardedTransformTail,
      discardedStructuralLength: state.observedDiscardedStructuralLength,
      discardedStructuralTail: state.observedDiscardedStructuralTail,
      selectionRevisionSize: state.observedSelectionRevisionSize,
      selectionActionSize: state.observedSelectionActionSize,
    },
    {
      cursor: engine.historyCursor,
      actions: engine.historyActions,
      batches: engine.historyBatches,
      discardedVector: engine.discardedVectorRasterHistoryActions,
      discardedImport: engine.discardedRasterImportHistoryActions,
      discardedTransform: engine.discardedRasterTransformHistoryActions,
      discardedStructural,
      selectionRevisionSize: engine.selectionHistoryMasksByRevision.size,
      selectionActionSize: engine.selectionHistoryMasksByAction.size,
    },
  );
  if (!appendOnly) {
    rebuildHistoryAccounting(engine);
    return true;
  }

  for (let index = state.observedActionsLength; index < engine.historyActions.length; index += 1) {
    accountHistoryAction(engine, state, engine.historyActions[index], index);
    state.accountingIncrementalActions += 1;
  }
  const accountDiscarded = <T extends HistoryAction>(
    values: readonly T[],
    start: number,
  ): void => {
    for (let index = start; index < values.length; index += 1) {
      accountHistoryAction(engine, state, values[index], null);
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
  accountDiscarded(
    discardedStructural,
    state.observedDiscardedStructuralLength,
  );
  for (let index = state.observedBatchesLength; index < engine.historyBatches.length; index += 1) {
    accountHistoryBatch(engine, state, engine.historyBatches[index]);
    state.accountingIncrementalBatches += 1;
  }
  state.observedCursor = engine.historyCursor;
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
  state.observedDiscardedStructuralLength = discardedStructural.length;
  state.observedDiscardedStructuralTail = tailObject(discardedStructural);
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
  const checkpointBytes = historyDeviceCheckpointBytes(engine);
  const baseBytes = historyBaseBudgetBytes({
    checkpointBytes,
    mobile: MOBILE_DEVICE_CLASS,
  });
  const effectsBytes = effectsWorkingSetBytes(engine);
  const availableBytes = Math.max(
    HISTORY_MINIMUM_BUDGET_BYTES,
    checkpointBytes,
    baseBytes - effectsBytes,
  );
  return {
    budget: createHistoryBudget(availableBytes),
    baseBytes,
    effectsBytes,
  };
}

function historySpillHighWaterBytes(engine: BrushEngine): number {
  const { budget } = historyBudgetForEngine(engine);
  return Math.min(
    HISTORY_SPILL_HIGH_WATER_BYTES,
    Math.floor(budget.hardBytes * HISTORY_SPILL_BUDGET_FRACTION),
    HISTORY_DEV_SPILL_HIGH_WATER_BYTES ?? Number.POSITIVE_INFINITY,
  );
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
      || action.kind === "raster-filter"
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
  // `budgetPressure >= 1` non compare piu' qui, ed e' la correzione centrale.
  //
  // Faceva diventare full ogni checkpoint appena la cronologia toccava il
  // proprio tetto, mentre `planHistoryCheckpoint` accorciava l'intervallo a
  // otto azioni: sforare produceva fotografie piu' grosse tre volte piu'
  // spesso, il che faceva sforare di piu'. Un anello che non si apriva da solo.
  //
  // L'intento era creare boundary su cui consolidare. Ma il consolidamento e'
  // spesso bloccato per motivi suoi, quindi si pagavano i full e non si otteneva
  // niente in cambio. Il freno adesso e' `admitHistoryCheckpoint`, che guarda i
  // byte invece della cadenza.
  // Il full e' **obbligatorio** solo quando la correttezza lo impone: senza un
  // genitore su cui appoggiarsi, dopo un reset o dopo un'operazione strutturale.
  const fullRequired = !current
    || delta.requiresFull
    || delta.reset;
  // Il full periodico e' invece una **preferenza**: rifonda la catena e accorcia
  // l'idratazione. Se non c'e' spazio, un delta e' meglio di niente.
  const rebasePreferred = checkpointOrdinal % HISTORY_FULL_CHECKPOINT_PERIOD === 0;

  const blank = !engine.layerHasContent;
  const bytesPerPixel = engine.layerFormat === "rgba16float" ? 8 : 4;
  const buildMask = (full: boolean): Uint32Array => {
    const candidate = full ? record.storageTileMask.slice() : delta.mask.slice();
    if (full && engine.layerContentBounds) {
      markLayerStorageRect(candidate, engine.layerContentBounds);
    }
    return candidate;
  };
  const bytesOf = (candidate: Uint32Array): number =>
    blank
      ? 0
      : countLayerStorageTiles(candidate)
        * LAYER_STORAGE_TILE_SIZE
        * LAYER_STORAGE_TILE_SIZE
        * bytesPerPixel;

  // Entrambi i candidati vengono costruiti e misurati, e solo dopo si sceglie.
  // Sceglierne uno prima e chiedere poi se ci sta era il difetto: un full
  // rifiutato non lasciava spazio a un delta che sarebbe entrato.
  const fullMask = buildMask(true);
  const deltaMask = buildMask(false);
  const currentReplayChain = current
    ? periodicCheckpointChainForReplay(engine, layerId, engine.historyCursor)
    : null;
  const currentReplayChainBytes = currentReplayChain
    ? currentReplayChain.checkpoints.reduce(
      (total, checkpoint) => total + checkpoint.memoryBytes,
      0,
    )
    : 0;
  // A stored-only checkpoint still has its immutable raw size in
  // `memoryBytes`. Bound the full+delta chain to one full-canvas equivalent:
  // target+rollback therefore fit in two such windows even after a long
  // session repeatedly frees the resident copies back to local storage.
  const replayChainBudgetBytes = historyDeviceCheckpointBytes(engine);
  const rebaseRequiredForReplayBudget = Boolean(
    current
    && currentReplayChainBytes + bytesOf(deltaMask) > replayChainBudgetBytes,
  );
  const currentBytes = historyMemoryTotalBytes(historyMemoryLedger(engine));
  const budget = historyBudgetForEngine(engine).budget;
  const valuta = (candidate: Uint32Array, mandatory: boolean) => ({
    valid: blank || countLayerStorageTiles(candidate) > 0,
    admitted: admitHistoryCheckpoint({
      currentBytes,
      candidateBytes: bytesOf(candidate),
      budget,
      mandatory,
    }).admitted,
  });
  const fullEsito = valuta(fullMask, fullRequired);
  const deltaEsito = valuta(deltaMask, false);
  const scelta = selectCheckpointRepresentation({
    fullRequired,
    rebaseRequired: rebaseRequiredForReplayBudget,
    rebasePreferred,
    fullValid: fullEsito.valid,
    fullAdmitted: fullEsito.admitted,
    deltaValid: deltaEsito.valid,
    deltaAdmitted: deltaEsito.admitted,
  });
  if (scelta === "none") {
    state.capturesRefusedForBudget += 1;
    return;
  }
  const forceFull = scelta === "full";
  const mask = forceFull ? fullMask : deltaMask;

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
  cursor = engine.historyCursor,
): { checkpoints: PeriodicRasterHistoryCheckpoint[]; actionIndex: number } | null {
  const state = stateFor(engine);
  const selected = latestCheckpoint(engine, layerId, cursor);
  if (!selected) return null;
  const byId = new Map(state.checkpoints.map((checkpoint) => [checkpoint.id, checkpoint]));
  const reverse: PeriodicRasterHistoryCheckpoint[] = [];
  let checkpointCursor: PeriodicRasterHistoryCheckpoint | undefined = selected.checkpoint;
  const seen = new Set<number>();
  while (checkpointCursor) {
    if (seen.has(checkpointCursor.id)) throw new Error("Ciclo nei checkpoint raster periodici.");
    seen.add(checkpointCursor.id);
    reverse.push(checkpointCursor);
    if (checkpointCursor.kind === "full" || checkpointCursor.kind === "blank") break;
    checkpointCursor = checkpointCursor.parentId === null
      ? undefined
      : byId.get(checkpointCursor.parentId);
  }
  if (reverse.at(-1)?.kind === "delta") {
    return null;
  }
  return { checkpoints: reverse.reverse(), actionIndex: selected.actionIndex };
}

/** Storage wraps/demotes only the seed; checkpoint topology remains owned here. */
export function periodicHistoryCheckpoints(
  engine: BrushEngine,
): readonly PeriodicRasterHistoryCheckpoint[] {
  return stateFor(engine).checkpoints;
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

function latestFullCheckpointByLayer(
  engine: BrushEngine,
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
    const layerId = action.kind === "layer-merge"
      ? action.output.layerRecord.id
      : "layerId" in action
        ? action.layerId
        : null;
    if (
      layerId !== null
      && rasterActionAffectsPixels(action.kind)
      && engine.layerStack.byId(layerId)
    ) {
      rasterLayerIdsWithHistory.add(layerId);
    }
  }
  for (const layerId of rasterLayerIdsWithHistory) {
    let selected: {
      checkpoint: PeriodicRasterHistoryCheckpoint;
      actionIndex: number;
    } | null = null;
    for (const checkpoint of state.checkpoints) {
      if (checkpoint.layerId !== layerId || checkpoint.kind === "delta") continue;
      if (
        checkpoint.kind === "full"
        && historyColdSeedResidentBytes(checkpoint.seed) === 0
      ) {
        // A destructive in-memory floor must never depend on local storage.
        // Stored-only checkpoints remain valid replay accelerators, not RAM
        // baselines that authorize deleting the journal.
        continue;
      }
      const actionIndex = indices.get(checkpoint.afterActionId);
      if (
        actionIndex === undefined
        || actionIndex >= engine.historyCursor
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
 * Lo invoca soltanto il budget in byte, dopo avere sacrificato le cache
 * ricostruibili. Il numero di azioni non e' mai una ragione per accorciare la
 * profondita' di Undo.
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
      state.checkpointBytes -= historyColdSeedResidentBytes(checkpoint.seed);
      destroyLayerColdStorage(checkpoint.seed);
    } else {
      retainedCheckpoints.push(checkpoint);
    }
  }
  state.checkpoints = retainedCheckpoints;

  // The global floor makes structural Undo below it unreachable. Keeping the
  // full raster seeds (and semantic vector snapshots) inside diagnostic action
  // metadata would retain GPU/OPFS ownership forever without preserving a
  // single user-visible step. IDs/order/record metadata remain for lineage.
  for (let index = 0; index < candidateFloor; index += 1) {
    const action = engine.historyActions[index];
    if (action.kind !== "layer-merge" || action.payloadsRetiredBelowFloor) continue;
    for (const input of action.inputs) {
      if (input.kind === "raster") {
        evictedPayloadBytes += historyColdSeedResidentBytes(input.entry.seed);
        destroyLayerColdStorage(input.entry.seed);
        input.entry.seed = null;
      } else {
        input.state = null;
      }
    }
    evictedPayloadBytes += historyColdSeedResidentBytes(action.output.seed);
    destroyLayerColdStorage(action.output.seed);
    action.output.seed = null;
    action.payloadsRetiredBelowFloor = true;
  }
  state.floorCursor = candidateFloor;
  state.evictedPayloadBytes += evictedPayloadBytes;
  engine.historyGpuStorage.trimEmptyPages(true);
  rebuildHistoryAccounting(engine);
  // Le azioni sotto il nuovo pavimento restano come metadata diagnostici, ma
  // non sono piu' attraversabili: non devono continuare a trattenere renderer
  // di effetti che nessun layer o stato Undo/Redo raggiungibile possiede.
  engine.scheduleEffectsScratchShrink();
  engine.publishHistoryState();
  engine.publishStats();
  return true;
}

function enforceHistoryBudget(engine: BrushEngine, allowJournalEviction = true): void {
  const state = stateFor(engine);
  const ledger = historyMemoryLedger(engine);
  const { budget } = historyBudgetForEngine(engine);
  if (historyMemoryTotalBytes(ledger) <= budget.hardBytes) {
    state.budgetCheckpointBlocked = false;
    return;
  }
  // PRIMA la cache, POI — solo se davvero non basta — il journal.
  //
  // E' l'inversione che corregge il difetto centrale. I checkpoint periodici
  // sono acceleratori ricostruibili: buttarli costa un replay piu' lungo. Le
  // azioni sotto il pavimento sono l'unica copia dei passi di Undo: buttarle
  // costa lavoro che l'utente non riavra' mai. Il motore sacrificava le seconde
  // per proteggere i primi, ed e' il motivo per cui una sessione poteva
  // ritrovarsi con il pavimento a 54 su 55 azioni e 246 MiB di checkpoint
  // ancora residenti: massimo danno, nessun guadagno.
  const recovery = planHistoryBudgetRecovery({
    currentBytes: historyMemoryTotalBytes(ledger),
    budget,
    checkpoints: state.checkpoints.map((checkpoint) => ({
      id: checkpoint.id,
      layerId: checkpoint.layerId,
      parentId: checkpoint.parentId,
      kind: checkpoint.kind,
      actionIndex: state.actionIndexById.get(checkpoint.afterActionId) ?? -1,
      bytes: historyColdSeedResidentBytes(checkpoint.seed),
    })),
  });
  if (recovery.required) {
    const buttati = new Set(recovery.checkpointIdsToDrop);
    state.checkpoints = state.checkpoints.filter((checkpoint) => {
      if (!buttati.has(checkpoint.id)) return true;
      destroyLayerColdStorage(checkpoint.seed);
      return false;
    });
    state.checkpointCacheEvictions += recovery.checkpointIdsToDrop.length;
    // Ricostruzione diretta, non invalidazione: qui il cursore e' in fondo per
    // il gate della manutenzione, quindi ricostruire e' sicuro. Invalidare e
    // basta lascerebbe il rifacimento a un momento che non controlliamo, ed e'
    // esattamente da li' che e' passato il difetto del ledger.
    rebuildHistoryAccounting(engine);
  }
  if (recovery.reachedTarget) {
    // La cache e' bastata: il journal non si tocca e la profondita' di Undo
    // resta intera. E' il caso normale, e deve restarlo.
    state.budgetCheckpointBlocked = false;
    return;
  }

  if (!allowJournalEviction) {
    // More authoritative payload can still be published to local storage.
    // Keep the cache cleanup above, then defer the irreversible cursor floor.
    state.budgetCheckpointBlocked = false;
    return;
  }

  // Solo qui il journal diventa discutibile: la cache e' finita e siamo ancora
  // sopra il tetto.
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
      // Local spill runs only at the journal end and publishes storage before
      // releasing a resident payload. Residence changes rebuild the ledger in
      // the same operation, with the cursor watermark included, so the old
      // mid-cursor accounting corruption cannot reappear.
      const spillHighWaterBytes = historySpillHighWaterBytes(engine);
      const spillOptions = {
        highWaterBytes: spillHighWaterBytes,
        logicalFloorCursor: state.floorCursor,
        currentResidentBytes: () => historyMemoryTotalBytes(historyMemoryLedger(engine)),
        shouldContinue: () => (
          expectedGeneration === state.generation
          // spillIfNeeded publishes busy="spilling" before its first await.
          // The current storage operation must not invalidate its own gate;
          // foreground/history state and the maintenance generation remain
          // the authorities that abort it.
          && historyMaintenanceEngineIdle(engine, true)
          && !engine.deviceLostError
        ),
        afterResidenceChange: () => refreshHistoryAccountingAfterStorageChange(engine),
      } as const;
      await engine.historyLocalStorage.spillIfNeeded(spillOptions);
      if (expectedGeneration !== state.generation) return;
      const deferJournalEviction = engine.historyLocalStorage.shouldDeferJournalEviction(
        spillOptions,
      );
      enforceHistoryBudget(engine, !deferJournalEviction);
      if (deferJournalEviction) engine.resumeHistoryStorageMaintenance();
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

export function refreshHistoryAccountingAfterStorageChange(engine: BrushEngine): void {
  rebuildHistoryAccounting(engine);
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
    spillHighWaterBytes: historySpillHighWaterBytes(engine),
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
    evictedPayloadBytes: state.evictedPayloadBytes,
    budgetCheckpointBlocked: state.budgetCheckpointBlocked,
    accountingFullRebuilds: state.accountingFullRebuilds,
    accountingIncrementalActions: state.accountingIncrementalActions,
    accountingIncrementalBatches: state.accountingIncrementalBatches,
    localStorage: engine.historyLocalStorage.telemetry(),
  };
}
