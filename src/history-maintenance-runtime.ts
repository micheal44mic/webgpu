import type { BrushEngine } from "./brush-engine";
import {
  createLayerColdStorageCandidate,
  destroyLayerColdStorage,
} from "./engine-cold-storage";
import type { DirtyRect } from "./engine-stroke-types";
import type { LayerColdStorageResources } from "./engine-layer-resources";
import type { HistoryRenderBatch } from "./engine-history-types";
import type { GpuHistorySlice } from "./gpu-history-storage";
import {
  countLayerStorageTiles,
  createLayerStorageTileMask,
  markLayerStorageRect,
} from "./layer-storage-study";
import {
  createHistoryBudget,
  emptyHistoryMemoryLedger,
  historyBudgetPressure,
  historyMemoryTotalBytes,
  nearestHistoryCheckpoint,
  planHistoryCheckpoint,
  type HistoryMemoryLedger,
} from "./history-retention-core";

const MEBIBYTE_BYTES = 1024 * 1024;
const HISTORY_MOBILE_BUDGET_BYTES = 192 * MEBIBYTE_BYTES;
const HISTORY_DESKTOP_BUDGET_BYTES = 512 * MEBIBYTE_BYTES;
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
  evictedPayloadBytes: number;
  budgetCheckpointBlocked: boolean;
  checkpointBytes: number;
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
      evictedPayloadBytes: 0,
      budgetCheckpointBlocked: false,
      checkpointBytes: 0,
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

function mobileHistoryBudget(): boolean {
  return typeof matchMedia === "function" && matchMedia("(max-width: 700px)").matches;
}

function actionIndexById(engine: BrushEngine): Map<number, number> {
  return new Map(engine.historyActions.map((action, index) => [action.id, index]));
}

function latestCheckpoint(
  engine: BrushEngine,
  layerId: number,
): { checkpoint: PeriodicRasterHistoryCheckpoint; actionIndex: number } | null {
  return nearestHistoryCheckpoint(
    engine.historyActions,
    engine.historyCursor,
    layerId,
    stateFor(engine).checkpoints,
  ) as { checkpoint: PeriodicRasterHistoryCheckpoint; actionIndex: number } | null;
}

function rasterActionAffectsPixels(kind: string): boolean {
  return kind === "stroke"
    || kind === "fill"
    || kind === "clear"
    || kind === "vector-rasterize"
    || kind === "raster-import"
    || kind === "raster-transform";
}

function lastRasterActionForLayer(engine: BrushEngine, layerId: number): {
  id: number;
  index: number;
} | null {
  for (let index = engine.historyCursor - 1; index >= 0; index -= 1) {
    const action = engine.historyActions[index];
    if (
      "layerId" in action
      && action.layerId === layerId
      && rasterActionAffectsPixels(action.kind)
    ) {
      return { id: action.id, index };
    }
  }
  return null;
}

function bytesForCheckpointCpuMetadata(checkpoint: PeriodicRasterHistoryCheckpoint): number {
  return checkpoint.baseTileMask.byteLength + 96;
}

function estimateStructuralBytes(roots: readonly (readonly unknown[])[]): number {
  const seen = new WeakSet<object>();
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

function estimateCpuHistoryBytes(engine: BrushEngine): number {
  return estimateStructuralBytes([
    engine.historyActions,
    engine.discardedVectorRasterHistoryActions,
    engine.discardedRasterImportHistoryActions,
    engine.discardedRasterTransformHistoryActions,
  ]);
}

export function historyMemoryLedger(engine: BrushEngine): HistoryMemoryLedger {
  const ledger = emptyHistoryMemoryLedger();
  const gpuStorage = engine.historyGpuStorage.stats();
  ledger.gpuReservedBytes = gpuStorage.usedReservedBytes;
  ledger.gpuAllocatedBytes = gpuStorage.allocatedBytes;
  const selectionSliceIds = new Set<number>();
  const addSelectionSnapshot = (
    snapshot: { gpuSlice: GpuHistorySlice } | null | undefined,
  ): void => {
    if (!snapshot || selectionSliceIds.has(snapshot.gpuSlice.id)) return;
    selectionSliceIds.add(snapshot.gpuSlice.id);
    ledger.selectionFillMaskBytes += snapshot.gpuSlice.logicalBytes;
  };
  for (const snapshot of engine.selectionHistoryMasksByRevision.values()) {
    addSelectionSnapshot(snapshot);
  }
  for (const snapshot of engine.selectionHistoryMasksByAction.values()) {
    addSelectionSnapshot(snapshot);
  }
  for (const batch of engine.historyBatches) {
    if (batch.kind === "paint") addSelectionSnapshot(batch.selectionMask);
  }
  for (const action of [
    ...engine.historyActions,
    ...engine.discardedRasterTransformHistoryActions,
  ]) {
    if (action.kind !== "raster-transform") continue;
    addSelectionSnapshot(action.selectionBefore);
    addSelectionSnapshot(action.selectionAfter);
  }
  for (const batch of engine.historyBatches) {
    if (batch.kind === "fill") {
      ledger.selectionFillMaskBytes += batch.gpuSlice.logicalBytes;
    } else if (!selectionSliceIds.has(batch.gpuSlice.id)) {
      ledger.gpuPayloadBytes += batch.gpuSlice.logicalBytes;
    }
  }
  for (const checkpoint of stateFor(engine).checkpoints) {
    ledger.checkpointBytes += checkpoint.memoryBytes + bytesForCheckpointCpuMetadata(checkpoint);
  }
  const checkpointSeeds = new Set<LayerColdStorageResources>();
  for (const action of [
    ...engine.historyActions,
    ...engine.discardedVectorRasterHistoryActions,
    ...engine.discardedRasterImportHistoryActions,
    ...engine.discardedRasterTransformHistoryActions,
  ]) {
    if (
      action.kind === "vector-rasterize"
      || action.kind === "raster-import"
      || action.kind === "raster-transform"
    ) {
      if (action.seed && !checkpointSeeds.has(action.seed)) {
        checkpointSeeds.add(action.seed);
        ledger.checkpointBytes += action.seed.memoryBytes;
      }
    }
  }
  ledger.cpuVectorBytes = estimateCpuHistoryBytes(engine);
  for (const resource of engine.rasterImageGpuResources.values()) {
    ledger.assetBytes += resource.memoryBytes;
  }
  ledger.assetBytes += engine.customBrushAssets.memoryBytes();
  return ledger;
}

function historyBudgetForEngine(engine: BrushEngine) {
  void engine;
  return createHistoryBudget(
    mobileHistoryBudget() ? HISTORY_MOBILE_BUDGET_BYTES : HISTORY_DESKTOP_BUDGET_BYTES,
  );
}

function replayTailMetrics(engine: BrushEngine, layerId: number): {
  actions: number;
  batches: number;
  bytes: number;
} {
  const latest = latestCheckpoint(engine, layerId);
  const firstIndex = latest ? latest.actionIndex + 1 : 0;
  const relevantActionIds = new Set<number>();
  let actions = 0;
  for (let index = firstIndex; index < engine.historyCursor; index += 1) {
    const action = engine.historyActions[index];
    if (
      "layerId" in action
      && action.layerId === layerId
      && rasterActionAffectsPixels(action.kind)
    ) {
      relevantActionIds.add(action.id);
      actions += 1;
    }
  }
  let batches = 0;
  let bytes = 0;
  for (const batch of engine.historyBatches) {
    if (batch.layerId === layerId && relevantActionIds.has(batch.actionId)) {
      batches += 1;
      bytes += batch.gpuSlice.logicalBytes;
    }
  }
  return { actions, batches, bytes };
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

async function capturePeriodicCheckpoint(engine: BrushEngine): Promise<void> {
  const state = stateFor(engine);
  if (state.captureInFlight || !historyMaintenanceEngineIdle(engine)) return;
  const record = engine.layerStack.active;
  const layerId = record.id;
  const lastRasterAction = lastRasterActionForLayer(engine, layerId);
  if (!lastRasterAction) return;
  const duplicate = state.checkpoints.some((checkpoint) => (
    checkpoint.layerId === layerId && checkpoint.afterActionId === lastRasterAction.id
  ));
  if (duplicate) return;

  const current = latestCheckpoint(engine, layerId);
  const tail = replayTailMetrics(engine, layerId);
  const ledger = historyMemoryLedger(engine);
  const budget = historyBudgetForEngine(engine);
  const plan = planHistoryCheckpoint({
    actionsSinceCheckpoint: tail.actions,
    replayBatchesSinceCheckpoint: tail.batches,
    payloadBytesSinceCheckpoint: tail.bytes,
    budgetPressure: historyBudgetPressure(ledger, budget),
  });
  if (!plan.capture) return;

  const checkpointOrdinal = state.checkpoints.filter((checkpoint) => (
    checkpoint.layerId === layerId
  )).length + 1;
  const delta = changedTileMask(engine, layerId, current?.actionIndex ?? -1);
  const forceFull = !current
    || delta.requiresFull
    || historyBudgetPressure(ledger, budget) >= 1
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
  const generation = ++state.generation;
  state.captureInFlight = true;
  state.capturesStarted += 1;
  let seed: LayerColdStorageResources | null = null;
  try {
    await engine.waitForIdle();
    if (!historyMaintenanceEngineIdle(engine)) return;
    if (!blank) {
      const hot = engine.requireLayerGpu(layerId).hot;
      if (!hot) return;
      seed = await createLayerColdStorageCandidate(
        engine,
        record,
        hot,
        mask,
        state.nextCheckpointId,
      );
    }
    const anchorStillAtCursor = engine.historyCursor === anchorCursor
      && engine.historyActions[anchorCursor - 1]?.id >= anchorId
      && engine.layerStack.active.id === activeLayerId
      && historyMaintenanceEngineIdle(engine);
    if (generation !== state.generation || !anchorStillAtCursor) {
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
  for (const checkpoint of state.checkpoints) {
    if (!liveActionIds.has(checkpoint.afterActionId)) {
      state.checkpointBytes -= checkpoint.memoryBytes;
      destroyLayerColdStorage(checkpoint.seed);
      continue;
    }
    if (checkpoint.parentId !== null && !retainedIds.has(checkpoint.parentId)) {
      state.checkpointBytes -= checkpoint.memoryBytes;
      destroyLayerColdStorage(checkpoint.seed);
      continue;
    }
    retained.push(checkpoint);
    retainedIds.add(checkpoint.id);
  }
  state.checkpoints = retained;
}

function latestFullCheckpointByLayer(
  engine: BrushEngine,
): Map<number, { checkpoint: PeriodicRasterHistoryCheckpoint; actionIndex: number }> | null {
  const state = stateFor(engine);
  const indices = actionIndexById(engine);
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
      if (actionIndex === undefined || actionIndex >= engine.historyCursor) continue;
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
 */
function enforceHistoryBudget(engine: BrushEngine): void {
  const state = stateFor(engine);
  const ledger = historyMemoryLedger(engine);
  const budget = historyBudgetForEngine(engine);
  if (historyMemoryTotalBytes(ledger) <= budget.hardBytes) {
    state.budgetCheckpointBlocked = false;
    return;
  }
  const baselines = latestFullCheckpointByLayer(engine);
  if (!baselines || baselines.size === 0) {
    state.budgetCheckpointBlocked = true;
    return;
  }
  const candidateFloor = Math.max(
    state.floorCursor,
    ...[...baselines.values()].map(({ actionIndex }) => actionIndex + 1),
  );
  if (candidateFloor <= state.floorCursor) {
    state.budgetCheckpointBlocked = true;
    return;
  }
  const actionIndices = actionIndexById(engine);
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
  state.budgetEvictions += 1;
  state.evictedPayloadBytes += evictedPayloadBytes;
  state.budgetCheckpointBlocked = false;
  engine.historyGpuStorage.trimEmptyPages(true);
  engine.publishHistoryState();
  engine.publishStats();
}

export function historyFloorCursor(engine: BrushEngine): number {
  return stateFor(engine).floorCursor;
}

export function historyCheckpointAllocatedBytes(engine: BrushEngine): number {
  return stateFor(engine).checkpointBytes;
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
      discardStalePeriodicCheckpoints(engine);
      await capturePeriodicCheckpoint(engine);
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
  const budget = historyBudgetForEngine(engine);
  return {
    checkpointCount: state.checkpoints.length,
    fullCheckpointCount: state.checkpoints.filter((item) => item.kind !== "delta").length,
    deltaCheckpointCount: state.checkpoints.filter((item) => item.kind === "delta").length,
    checkpointBytes: state.checkpoints.reduce((sum, item) => sum + item.memoryBytes, 0),
    memory,
    totalBytes: historyMemoryTotalBytes(memory),
    budgetBytes: budget.hardBytes,
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
  };
}
