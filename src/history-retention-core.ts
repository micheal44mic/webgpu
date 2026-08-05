/**
 * Pure planning primitives for bounded, checkpoint-aware Undo/Redo.
 *
 * This module deliberately owns no GPU resources and imports no engine code.
 * The runtime can therefore make every allocation/destruction decision after
 * a queue fence, while the policy and its long-session behaviour stay
 * deterministic and testable in Node.
 */

export const HISTORY_RETENTION_STRATEGY =
  "byte-budget-exact-tiled-checkpoints-idle-fenced-chunked-v1" as const;

export const HISTORY_CHECKPOINT_BASE_ACTION_INTERVAL = 24;
export const HISTORY_CHECKPOINT_MAX_REPLAY_BATCHES = 32;
export const HISTORY_CHECKPOINT_PAYLOAD_INTERVAL_BYTES = 8 * 1024 * 1024;
export const HISTORY_MAINTENANCE_CHUNK_ITEMS = 64;

export type HistoryMemoryCategory =
  | "gpuPayloadBytes"
  | "checkpointBytes"
  | "selectionFillMaskBytes"
  | "cpuVectorBytes"
  | "assetBytes";

export interface HistoryMemoryLedger {
  /** Logical payload bytes, useful for attribution but not the budget ceiling. */
  gpuPayloadBytes: number;
  /** Reserved bytes inside live GPU history slices. */
  gpuReservedBytes: number;
  /** Physical page bytes currently allocated by the paged GPU allocator. */
  gpuAllocatedBytes: number;
  checkpointBytes: number;
  selectionFillMaskBytes: number;
  cpuVectorBytes: number;
  assetBytes: number;
}

export interface HistoryBudget {
  /** Hard accounting ceiling. Maintenance must converge below this value. */
  hardBytes: number;
  /** Hysteresis target after eviction, preventing one-action maintenance loops. */
  targetBytes: number;
}

export interface HistoryCheckpointPressure {
  actionsSinceCheckpoint: number;
  replayBatchesSinceCheckpoint: number;
  payloadBytesSinceCheckpoint: number;
  /** 0 while comfortably below budget; 1 at the hard budget. */
  budgetPressure: number;
}

export type HistoryCheckpointReason =
  | "action-interval"
  | "replay-tail"
  | "payload-bytes"
  | "budget-pressure";

export interface HistoryCheckpointPlan {
  capture: boolean;
  reason: HistoryCheckpointReason | null;
  effectiveActionInterval: number;
}

export interface HistoryCompactionChunk {
  start: number;
  end: number;
  done: boolean;
}

export interface HistoryIncrementalWorkResult {
  completed: boolean;
  processedItems: number;
  chunks: number;
  yields: number;
}

export interface HistoryIncrementalWorkHooks {
  shouldContinue(): boolean;
  yieldTurn(): Promise<void>;
}

/** A stable checkpoint anchor; `afterActionId=null` is the blank baseline. */
export interface HistoryCheckpointAnchor {
  id: number;
  layerId: number;
  afterActionId: number | null;
}

export interface HistoryActionAnchor {
  id: number;
  kind: string;
  layerId?: number;
}

/**
 * A global boundary is eligible for prefix eviction only when every live
 * raster layer has an exact snapshot for the state at this cursor.
 */
export interface HistoryExactBoundary {
  cursor: number;
  retainedBytes: number;
  baselineBytes: number;
  exactLayerCount: number;
  liveLayerCount: number;
}

export interface HistoryEvictionPlan {
  required: boolean;
  boundaryCursor: number | null;
  projectedBytes: number;
  reason: "within-budget" | "exact-boundary" | "checkpoint-required";
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function emptyHistoryMemoryLedger(): HistoryMemoryLedger {
  return {
    gpuPayloadBytes: 0,
    gpuReservedBytes: 0,
    gpuAllocatedBytes: 0,
    checkpointBytes: 0,
    selectionFillMaskBytes: 0,
    cpuVectorBytes: 0,
    assetBytes: 0,
  };
}

export function historyMemoryTotalBytes(ledger: HistoryMemoryLedger): number {
  const logicalPagedBytes = finiteNonNegative(ledger.gpuPayloadBytes)
    + finiteNonNegative(ledger.selectionFillMaskBytes);
  // Pages are the amount the process really owns. `max` keeps synthetic or
  // legacy ledgers conservative even when physical stats are unavailable.
  const physicalPagedBytes = Math.max(
    logicalPagedBytes,
    finiteNonNegative(ledger.gpuReservedBytes),
    finiteNonNegative(ledger.gpuAllocatedBytes),
  );
  return physicalPagedBytes
    + finiteNonNegative(ledger.checkpointBytes)
    + finiteNonNegative(ledger.cpuVectorBytes)
    + finiteNonNegative(ledger.assetBytes);
}

/**
 * Builds a byte budget from an explicit amount of memory made available to
 * History. It intentionally never accepts an action count as a proxy for cost.
 */
export function createHistoryBudget(availableBytes: number): HistoryBudget {
  if (!Number.isFinite(availableBytes) || availableBytes < 16 * 1024 * 1024) {
    throw new RangeError("Il budget History deve essere almeno 16 MiB.");
  }
  const hardBytes = Math.floor(availableBytes);
  return {
    hardBytes,
    targetBytes: Math.floor(hardBytes * 0.82),
  };
}

export function historyBudgetPressure(
  ledger: HistoryMemoryLedger,
  budget: HistoryBudget,
): number {
  return Math.min(1, historyMemoryTotalBytes(ledger) / budget.hardBytes);
}

/**
 * Checkpoint cadence tightens under memory pressure but stays bounded. Replay
 * tail and payload bytes are independent triggers, so a single huge Fill or a
 * stamp-heavy brush does not wait for an arbitrary number of gestures.
 */
export function planHistoryCheckpoint(
  pressure: HistoryCheckpointPressure,
): HistoryCheckpointPlan {
  const normalizedPressure = Math.min(1, finiteNonNegative(pressure.budgetPressure));
  const effectiveActionInterval = Math.max(
    8,
    Math.round(HISTORY_CHECKPOINT_BASE_ACTION_INTERVAL * (1 - normalizedPressure * 0.66)),
  );
  if (pressure.replayBatchesSinceCheckpoint >= HISTORY_CHECKPOINT_MAX_REPLAY_BATCHES) {
    return { capture: true, reason: "replay-tail", effectiveActionInterval };
  }
  if (pressure.payloadBytesSinceCheckpoint >= HISTORY_CHECKPOINT_PAYLOAD_INTERVAL_BYTES) {
    return { capture: true, reason: "payload-bytes", effectiveActionInterval };
  }
  if (pressure.actionsSinceCheckpoint >= effectiveActionInterval) {
    return {
      capture: true,
      reason: normalizedPressure >= 0.75 ? "budget-pressure" : "action-interval",
      effectiveActionInterval,
    };
  }
  return { capture: false, reason: null, effectiveActionInterval };
}

/** Returns the newest checkpoint whose anchor remains in the visible prefix. */
export function nearestHistoryCheckpoint(
  actions: readonly HistoryActionAnchor[],
  cursor: number,
  layerId: number,
  checkpoints: readonly HistoryCheckpointAnchor[],
): { checkpoint: HistoryCheckpointAnchor; actionIndex: number } | null {
  const end = Math.max(0, Math.min(actions.length, Math.floor(cursor)));
  const actionIndexById = new Map<number, number>();
  let latestClearIndex = -1;
  for (let index = 0; index < end; index += 1) {
    const action = actions[index];
    actionIndexById.set(action.id, index);
    if (action.kind === "clear" && action.layerId === layerId) {
      latestClearIndex = index;
    }
  }
  let selected: { checkpoint: HistoryCheckpointAnchor; actionIndex: number } | null = null;
  for (const checkpoint of checkpoints) {
    if (checkpoint.layerId !== layerId) continue;
    const actionIndex = checkpoint.afterActionId === null
      ? -1
      : actionIndexById.get(checkpoint.afterActionId);
    if (actionIndex === undefined || actionIndex < latestClearIndex || actionIndex >= end) {
      continue;
    }
    if (!selected || actionIndex > selected.actionIndex) {
      selected = { checkpoint, actionIndex };
    }
  }
  return selected;
}

export function nextHistoryCompactionChunk(
  itemCount: number,
  start: number,
  maximumItems = HISTORY_MAINTENANCE_CHUNK_ITEMS,
): HistoryCompactionChunk {
  const count = Math.max(0, Math.floor(itemCount));
  const safeStart = Math.max(0, Math.min(count, Math.floor(start)));
  if (!Number.isInteger(maximumItems) || maximumItems <= 0) {
    throw new RangeError("Il chunk di manutenzione History deve essere positivo.");
  }
  const end = Math.min(count, safeStart + maximumItems);
  return { start: safeStart, end, done: end >= count };
}

/**
 * Processes at most one bounded chunk per browser turn. The continuation gate
 * is checked both before work and after every real yield, so pointer-down or a
 * new transaction can stop maintenance without waiting for the full journal.
 */
export async function processHistoryMaintenanceChunks(
  itemCount: number,
  processChunk: (start: number, end: number) => void,
  hooks: HistoryIncrementalWorkHooks,
  maximumItems = HISTORY_MAINTENANCE_CHUNK_ITEMS,
): Promise<HistoryIncrementalWorkResult> {
  const count = Math.max(0, Math.floor(itemCount));
  let cursor = 0;
  let chunks = 0;
  let yields = 0;
  while (cursor < count) {
    if (!hooks.shouldContinue()) {
      return {
        completed: false,
        processedItems: cursor,
        chunks,
        yields,
      };
    }
    const chunk = nextHistoryCompactionChunk(count, cursor, maximumItems);
    processChunk(chunk.start, chunk.end);
    cursor = chunk.end;
    chunks += 1;
    if (!chunk.done) {
      await hooks.yieldTurn();
      yields += 1;
      if (!hooks.shouldContinue()) {
        return {
          completed: false,
          processedItems: cursor,
          chunks,
          yields,
        };
      }
    }
  }
  return {
    completed: true,
    processedItems: cursor,
    chunks,
    yields,
  };
}

/**
 * Chooses the earliest exact boundary that reaches the hysteresis target,
 * thereby retaining the maximum possible Undo tail. A partial checkpoint set
 * is never considered an eviction boundary.
 */
export function planHistoryBudgetEviction(
  ledger: HistoryMemoryLedger,
  budget: HistoryBudget,
  boundaries: readonly HistoryExactBoundary[],
): HistoryEvictionPlan {
  const currentBytes = historyMemoryTotalBytes(ledger);
  if (currentBytes <= budget.hardBytes) {
    return {
      required: false,
      boundaryCursor: null,
      projectedBytes: currentBytes,
      reason: "within-budget",
    };
  }
  const eligible = boundaries
    .filter((boundary) => (
      Number.isInteger(boundary.cursor)
      && boundary.cursor > 0
      && boundary.liveLayerCount === boundary.exactLayerCount
      && boundary.retainedBytes + boundary.baselineBytes <= budget.targetBytes
    ))
    .sort((left, right) => left.cursor - right.cursor);
  const selected = eligible[0];
  if (!selected) {
    return {
      required: true,
      boundaryCursor: null,
      projectedBytes: currentBytes,
      reason: "checkpoint-required",
    };
  }
  return {
    required: true,
    boundaryCursor: selected.cursor,
    projectedBytes: selected.retainedBytes + selected.baselineBytes,
    reason: "exact-boundary",
  };
}
