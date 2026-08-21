import type {
  BlendHistoryRenderBatch,
  FillHistoryRenderBatch,
  HistoryAction,
  HistoryRenderBatch,
  LayerAddHistoryAction,
  LayerDeleteHistoryAction,
  LayerMergeHistoryAction,
  PaintHistoryRenderBatch,
  RasterFilterHistoryAction,
  RasterImportHistoryAction,
  RasterTransformHistoryAction,
  SelectionHistoryMaskSnapshot,
  VectorRasterizeHistoryAction,
} from "./engine-history-types";
import {
  emptyHistoryMemoryLedger,
  historyMemoryTotalBytes,
  type HistoryMemoryLedger,
} from "./history-retention-core.ts";

export interface HistoryServiceTelemetry {
  readonly actionCount: number;
  readonly cursor: number;
  readonly batchCount: number;
  readonly storedBaseStamps: number;
  readonly discardedActionCount: number;
  readonly compactionPending: boolean;
  readonly busy: boolean;
  readonly inconsistent: boolean;
  readonly checkpointCount: number;
  readonly floorCursor: number;
  readonly memory: HistoryMemoryLedger;
  readonly totalMemoryBytes: number;
}

export type HistoryPublicationFaultPoint =
  | "after-redo-truncate"
  | "after-action-publish"
  | "after-batch-publish";

export interface HistoryServiceHooks {
  /**
   * All fallible work (notably generating the next storage branch identity)
   * happens here, before the journal is touched. The returned commit closes
   * over that prepared state and must not throw.
   */
  prepareBranchCut(): () => void;
  scheduleDiscardedCleanup(): void;
}

export interface HistoryServiceCommands {
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
}

export interface HistoryCommitOptions {
  readonly reservedActionId?: boolean;
  readonly batches?: readonly HistoryRenderBatch[];
  readonly storedBaseStamps?: number;
  /** Releases payload ownership when publication cannot commit. */
  readonly releasePayloadOnCancel?: () => void;
}

export interface HistoryAppendBatchOptions {
  readonly storedBaseStamps?: number;
  /** Releases payload ownership when publication cannot commit. */
  readonly releasePayloadOnCancel?: () => void;
}

export interface HistoryServiceStateSnapshot {
  readonly actions: readonly HistoryAction[];
  readonly cursor: number;
  readonly nextActionId: number;
  readonly batches: readonly HistoryRenderBatch[];
  readonly storedBaseStamps: number;
  readonly compactionPending: boolean;
}

export interface HistoryInvariantSnapshot {
  readonly actionCount: number;
  readonly batchCount: number;
  readonly cursor: number;
  readonly nextActionId: number;
  readonly orphanedBatchCount: number;
}

interface HistoryTransactionSnapshot {
  readonly cursor: number;
  readonly actionsLength: number;
  readonly redoActions: readonly HistoryAction[];
  readonly nextActionId: number;
  readonly batchesLength: number;
  readonly storedBaseStamps: number;
  readonly discardedVectorLength: number;
  readonly discardedImportLength: number;
  readonly discardedTransformLength: number;
  readonly discardedLayerAddLength: number;
  readonly discardedLayerDeleteLength: number;
  readonly discardedLayerMergeLength: number;
  readonly compactionPending: boolean;
}

function appendWithoutPush<T>(target: T[], value: T): void {
  target[target.length] = value;
}

function restoreTailWithoutPush<T>(
  target: T[],
  prefixLength: number,
  tail: readonly T[],
): void {
  target.length = prefixLength;
  for (let index = 0; index < tail.length; index += 1) {
    target[prefixLength + index] = tail[index];
  }
}

function throwAfterPayloadRelease(
  error: unknown,
  releasePayloadOnCancel: (() => void) | undefined,
): never {
  if (!releasePayloadOnCancel) throw error;
  try {
    releasePayloadOnCancel();
  } catch (releaseError) {
    throw new AggregateError(
      [error, releaseError],
      "History publication failed and the payload could not be fully released.",
    );
  }
  throw error;
}

/**
 * Owns the ordered journal and its payload ownership metadata.
 *
 * Rendering/session objects stay outside this class. They prepare a mutation,
 * then publish its action and payload through one short CPU transaction. The
 * local-storage branch is cut only after every journal/batch write succeeds.
 */
export class HistoryService {
  actions: HistoryAction[] = [];
  cursor = 0;
  nextActionId = 1;
  batches: HistoryRenderBatch[] = [];
  storedBaseStamps = 0;

  discardedVectorRasterActions: VectorRasterizeHistoryAction[] = [];
  discardedRasterImportActions: RasterImportHistoryAction[] = [];
  discardedRasterTransformActions: Array<
    RasterTransformHistoryAction | RasterFilterHistoryAction
  > = [];
  discardedLayerAddActions: LayerAddHistoryAction[] = [];
  discardedLayerDeleteActions: LayerDeleteHistoryAction[] = [];
  discardedLayerMergeActions: LayerMergeHistoryAction[] = [];

  readonly selectionMasksByAction = new Map<number, SelectionHistoryMaskSnapshot>();
  readonly selectionMasksByRevision = new Map<number, SelectionHistoryMaskSnapshot>();
  readonly selectionClipBindGroups = new Map<number, GPUBindGroup>();

  compactionPending = false;
  busy = false;
  inconsistent = false;
  checkpointCount = 0;
  floorCursor = 0;
  memoryLedger: HistoryMemoryLedger = emptyHistoryMemoryLedger();

  private hooks: HistoryServiceHooks = {
    prepareBranchCut: () => () => undefined,
    scheduleDiscardedCleanup: () => undefined,
  };
  private commands: HistoryServiceCommands | null = null;
  private maintenanceOwner: object | null = null;
  private openTransaction: HistoryTransaction | null = null;
  private publicationFaultQueue: HistoryPublicationFaultPoint[] = [];

  configureHooks(hooks: HistoryServiceHooks): void {
    if (this.openTransaction) {
      throw new Error("History hooks cannot be changed during a transaction.");
    }
    this.hooks = hooks;
  }

  configureCommands(commands: HistoryServiceCommands): void {
    if (this.openTransaction) {
      throw new Error("History commands cannot be changed during a transaction.");
    }
    this.commands = commands;
  }

  /**
   * Keeps the checkpoint/accounting state under the same explicit owner as the
   * journal without coupling this core service to the engine maintenance adapter.
   */
  claimMaintenanceState<T extends object>(factory: () => T): T {
    if (!this.maintenanceOwner) this.maintenanceOwner = factory();
    return this.maintenanceOwner as T;
  }

  releaseMaintenanceState<T extends object>(): T | null {
    const state = this.maintenanceOwner as T | null;
    this.maintenanceOwner = null;
    return state;
  }

  reserveActionId(): number {
    const id = this.nextActionId;
    this.nextActionId += 1;
    return id;
  }

  begin(): HistoryTransaction {
    if (this.openTransaction) {
      throw new Error("A History transaction is already open.");
    }
    const snapshot: HistoryTransactionSnapshot = {
      cursor: this.cursor,
      actionsLength: this.actions.length,
      redoActions: this.actions.slice(this.cursor),
      nextActionId: this.nextActionId,
      batchesLength: this.batches.length,
      storedBaseStamps: this.storedBaseStamps,
      discardedVectorLength: this.discardedVectorRasterActions.length,
      discardedImportLength: this.discardedRasterImportActions.length,
      discardedTransformLength: this.discardedRasterTransformActions.length,
      discardedLayerAddLength: this.discardedLayerAddActions.length,
      discardedLayerDeleteLength: this.discardedLayerDeleteActions.length,
      discardedLayerMergeLength: this.discardedLayerMergeActions.length,
      compactionPending: this.compactionPending,
    };
    const preparedBranchCut = snapshot.redoActions.length > 0
      ? this.hooks.prepareBranchCut()
      : null;
    const transaction = new HistoryTransaction(this, snapshot, preparedBranchCut);
    this.openTransaction = transaction;
    return transaction;
  }

  commit(transaction: HistoryTransaction): void {
    transaction.commit();
  }

  cancel(transaction: HistoryTransaction): void {
    transaction.cancel();
  }

  commitAction(action: HistoryAction, options: HistoryCommitOptions = {}): void {
    let transaction: HistoryTransaction | null = null;
    try {
      transaction = this.begin();
      transaction.publishAction(action, options.reservedActionId ?? false);
      for (const batch of options.batches ?? []) transaction.publishBatch(batch);
      transaction.addStoredBaseStamps(options.storedBaseStamps ?? 0);
      this.commit(transaction);
    } catch (error) {
      if (transaction) this.cancel(transaction);
      throwAfterPayloadRelease(error, options.releasePayloadOnCancel);
    }
  }

  appendBatch(
    batch: HistoryRenderBatch,
    options: HistoryAppendBatchOptions = {},
  ): void {
    if (!this.actions.some((action) => action.id === batch.actionId)) {
      throwAfterPayloadRelease(
        new Error(`History batch has no action ${batch.actionId}.`),
        options.releasePayloadOnCancel,
      );
    }
    let transaction: HistoryTransaction | null = null;
    try {
      transaction = this.begin();
      transaction.publishBatch(batch);
      transaction.addStoredBaseStamps(options.storedBaseStamps ?? 0);
      this.commit(transaction);
    } catch (error) {
      if (transaction) this.cancel(transaction);
      throwAfterPayloadRelease(error, options.releasePayloadOnCancel);
    }
  }

  state(): HistoryServiceStateSnapshot {
    return {
      actions: [...this.actions],
      cursor: this.cursor,
      nextActionId: this.nextActionId,
      batches: [...this.batches],
      storedBaseStamps: this.storedBaseStamps,
      compactionPending: this.compactionPending,
    };
  }

  updateMaintenanceOwnership(update: {
    readonly checkpointCount: number;
    readonly floorCursor: number;
    readonly memory: HistoryMemoryLedger;
  }): void {
    if (!Number.isSafeInteger(update.checkpointCount) || update.checkpointCount < 0) {
      throw new RangeError(`Invalid History checkpoint count: ${update.checkpointCount}.`);
    }
    if (!Number.isSafeInteger(update.floorCursor) || update.floorCursor < 0) {
      throw new RangeError(`Invalid History floor: ${update.floorCursor}.`);
    }
    this.checkpointCount = update.checkpointCount;
    this.floorCursor = update.floorCursor;
    this.memoryLedger = { ...update.memory };
  }

  telemetry(): HistoryServiceTelemetry {
    return {
      actionCount: this.actions.length,
      cursor: this.cursor,
      batchCount: this.batches.length,
      storedBaseStamps: this.storedBaseStamps,
      discardedActionCount: this.discardedVectorRasterActions.length
        + this.discardedRasterImportActions.length
        + this.discardedRasterTransformActions.length
        + this.discardedLayerAddActions.length
        + this.discardedLayerDeleteActions.length
        + this.discardedLayerMergeActions.length,
      compactionPending: this.compactionPending,
      busy: this.busy,
      inconsistent: this.inconsistent,
      checkpointCount: this.checkpointCount,
      floorCursor: this.floorCursor,
      memory: { ...this.memoryLedger },
      totalMemoryBytes: historyMemoryTotalBytes(this.memoryLedger),
    };
  }

  undo(): Promise<boolean> {
    if (!this.commands) throw new Error("The History Undo command is not configured.");
    return this.commands.undo();
  }

  redo(): Promise<boolean> {
    if (!this.commands) throw new Error("The History Redo command is not configured.");
    return this.commands.redo();
  }

  setCursor(cursor: number): void {
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > this.actions.length) {
      throw new RangeError(`Invalid History cursor: ${cursor}.`);
    }
    this.cursor = cursor;
  }

  replaceRetainedBatches(
    batches: HistoryRenderBatch[],
    storedBaseStamps: number,
  ): void {
    if (!Number.isSafeInteger(storedBaseStamps) || storedBaseStamps < 0) {
      throw new RangeError(`Invalid History stamp accounting: ${storedBaseStamps}.`);
    }
    this.batches = batches;
    this.storedBaseStamps = storedBaseStamps;
  }

  completeRedoCompaction(
    batches: HistoryRenderBatch[],
    storedBaseStamps: number,
  ): void {
    this.replaceRetainedBatches(batches, storedBaseStamps);
    this.discardedVectorRasterActions = [];
    this.discardedRasterImportActions = [];
    this.discardedRasterTransformActions = [];
    this.discardedLayerAddActions = [];
    this.discardedLayerDeleteActions = [];
    this.discardedLayerMergeActions = [];
    this.compactionPending = false;
    this.checkpointCount = 0;
    this.floorCursor = 0;
    this.memoryLedger = emptyHistoryMemoryLedger();
  }

  reset(): void {
    if (this.openTransaction) this.cancel(this.openTransaction);
    this.actions = [];
    this.cursor = 0;
    this.nextActionId = 1;
    this.batches = [];
    this.storedBaseStamps = 0;
    this.discardedVectorRasterActions = [];
    this.discardedRasterImportActions = [];
    this.discardedRasterTransformActions = [];
    this.discardedLayerAddActions = [];
    this.discardedLayerDeleteActions = [];
    this.discardedLayerMergeActions = [];
    this.selectionMasksByAction.clear();
    this.selectionMasksByRevision.clear();
    this.selectionClipBindGroups.clear();
    this.compactionPending = false;
    this.checkpointCount = 0;
    this.floorCursor = 0;
    this.memoryLedger = emptyHistoryMemoryLedger();
    this.publicationFaultQueue = [];
  }

  injectPublicationFault(...points: HistoryPublicationFaultPoint[]): void {
    this.publicationFaultQueue = [...points];
  }

  consumePublicationFault(point: HistoryPublicationFaultPoint): void {
    if (this.publicationFaultQueue[0] !== point) return;
    this.publicationFaultQueue.shift();
    throw new Error(`Fault injection History publication: ${point}.`);
  }

  truncateRedoInTransaction(): void {
    if (this.cursor >= this.actions.length) return;
    for (const action of this.actions.slice(this.cursor)) {
      if (action.kind === "vector-rasterize") {
        appendWithoutPush(this.discardedVectorRasterActions, action);
      } else if (action.kind === "raster-import") {
        appendWithoutPush(this.discardedRasterImportActions, action);
      } else if (action.kind === "raster-transform" || action.kind === "raster-filter") {
        appendWithoutPush(this.discardedRasterTransformActions, action);
      } else if (action.kind === "layer-add") {
        appendWithoutPush(this.discardedLayerAddActions, action);
      } else if (action.kind === "layer-delete") {
        appendWithoutPush(this.discardedLayerDeleteActions, action);
      } else if (action.kind === "layer-merge") {
        appendWithoutPush(this.discardedLayerMergeActions, action);
      }
    }
    this.actions.length = this.cursor;
    this.compactionPending = true;
  }

  closeTransaction(transaction: HistoryTransaction): void {
    if (this.openTransaction !== transaction) {
      throw new Error("The History transaction does not own the store.");
    }
    this.openTransaction = null;
  }

  restoreTransaction(snapshot: HistoryTransactionSnapshot): void {
    restoreTailWithoutPush(this.actions, snapshot.cursor, snapshot.redoActions);
    this.cursor = snapshot.cursor;
    this.nextActionId = snapshot.nextActionId;
    this.batches.length = snapshot.batchesLength;
    this.storedBaseStamps = snapshot.storedBaseStamps;
    this.discardedVectorRasterActions.length = snapshot.discardedVectorLength;
    this.discardedRasterImportActions.length = snapshot.discardedImportLength;
    this.discardedRasterTransformActions.length = snapshot.discardedTransformLength;
    this.discardedLayerAddActions.length = snapshot.discardedLayerAddLength;
    this.discardedLayerDeleteActions.length = snapshot.discardedLayerDeleteLength;
    this.discardedLayerMergeActions.length = snapshot.discardedLayerMergeLength;
    this.compactionPending = snapshot.compactionPending;
  }

  finishCommittedTransaction(branchWasCut: boolean): void {
    if (!branchWasCut) return;
    try {
      this.hooks.scheduleDiscardedCleanup();
    } catch {
      // Cleanup is fenced idle maintenance. A scheduler failure must not turn
      // an already-committed document mutation into an apparent rollback.
    }
  }
}

export class HistoryTransaction {
  private closed = false;
  private actionPublished = false;
  private branchWasCut = false;
  private readonly service: HistoryService;
  private readonly snapshot: HistoryTransactionSnapshot;
  private readonly preparedBranchCut: (() => void) | null;

  constructor(
    service: HistoryService,
    snapshot: HistoryTransactionSnapshot,
    preparedBranchCut: (() => void) | null,
  ) {
    this.service = service;
    this.snapshot = snapshot;
    this.preparedBranchCut = preparedBranchCut;
  }

  publishAction(action: HistoryAction, reservedActionId = false): void {
    this.assertOpen();
    if (this.actionPublished) throw new Error("The transaction already owns an action.");
    const expectedActionId = reservedActionId
      ? this.service.nextActionId - 1
      : this.service.nextActionId;
    if (action.id !== expectedActionId) {
      throw new Error(
        `Unexpected History action ID ${action.id}; expected ${expectedActionId}.`,
      );
    }
    this.service.truncateRedoInTransaction();
    this.service.consumePublicationFault("after-redo-truncate");
    appendWithoutPush(this.service.actions, action);
    if (!reservedActionId) this.service.nextActionId += 1;
    this.service.cursor = this.service.actions.length;
    this.actionPublished = true;
    this.service.consumePublicationFault("after-action-publish");
  }

  publishBatch(batch: HistoryRenderBatch): void {
    this.assertOpen();
    const actionExists = this.service.actions.some((action) => action.id === batch.actionId);
    if (!actionExists) {
      throw new Error(`History batch has no action ${batch.actionId}.`);
    }
    appendWithoutPush(this.service.batches, batch);
    this.service.consumePublicationFault("after-batch-publish");
  }

  addStoredBaseStamps(count: number): void {
    this.assertOpen();
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new RangeError(`Invalid History stamp count: ${count}.`);
    }
    this.service.storedBaseStamps += count;
  }

  commit(): void {
    this.assertOpen();
    if (this.preparedBranchCut) {
      this.preparedBranchCut();
      this.branchWasCut = true;
    }
    this.closed = true;
    this.service.closeTransaction(this);
    this.service.finishCommittedTransaction(this.branchWasCut);
  }

  cancel(): void {
    if (this.closed) return;
    this.service.restoreTransaction(this.snapshot);
    this.closed = true;
    this.service.closeTransaction(this);
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("The History transaction is already closed.");
  }
}

export function assertHistoryServiceInvariants(
  service: HistoryService,
): HistoryInvariantSnapshot {
  if (!Number.isSafeInteger(service.cursor) || service.cursor < 0) {
    throw new Error(`Invalid History cursor: ${service.cursor}.`);
  }
  if (service.cursor > service.actions.length) {
    throw new Error(
      `History cursor ${service.cursor} exceeds ${service.actions.length} actions.`,
    );
  }
  if (!Number.isSafeInteger(service.nextActionId) || service.nextActionId <= 0) {
    throw new Error(`Invalid next History ID: ${service.nextActionId}.`);
  }
  if (!Number.isSafeInteger(service.storedBaseStamps) || service.storedBaseStamps < 0) {
    throw new Error(`Invalid History stamp accounting: ${service.storedBaseStamps}.`);
  }

  const liveActionById = new Map<number, HistoryAction>();
  let previousActionId = 0;
  for (const action of service.actions) {
    if (!Number.isSafeInteger(action.id) || action.id <= previousActionId) {
      throw new Error(`History IDs are not increasing at ${action.id}.`);
    }
    if (liveActionById.has(action.id)) {
      throw new Error(`Duplicate History action ID: ${action.id}.`);
    }
    liveActionById.set(action.id, action);
    previousActionId = action.id;
  }
  if (previousActionId >= service.nextActionId) {
    throw new Error(
      `Next History ID ${service.nextActionId} does not exceed the tail ${previousActionId}.`,
    );
  }

  let orphanedBatchCount = 0;
  for (const batch of service.batches) {
    const owner = liveActionById.get(batch.actionId);
    if (!owner) {
      orphanedBatchCount += 1;
      continue;
    }
    if (batch.kind === "fill" && owner.kind !== "fill") {
      throw new Error(`Fill batch ${batch.actionId} is owned by ${owner.kind}.`);
    }
    if ((batch.kind === "paint" || batch.kind === "blend") && owner.kind !== "stroke") {
      throw new Error(`${batch.kind} batch ${batch.actionId} is owned by ${owner.kind}.`);
    }
  }
  if (orphanedBatchCount > 0 && !service.compactionPending) {
    throw new Error(
      `${orphanedBatchCount} batches have no action and no compaction is pending.`,
    );
  }

  const liveActions = new Set(service.actions);
  const discardedGroups: readonly (readonly HistoryAction[])[] = [
    service.discardedVectorRasterActions,
    service.discardedRasterImportActions,
    service.discardedRasterTransformActions,
    service.discardedLayerAddActions,
    service.discardedLayerDeleteActions,
    service.discardedLayerMergeActions,
  ];
  for (const group of discardedGroups) {
    for (const action of group) {
      if (liveActions.has(action)) {
        throw new Error(`History action ${action.id} is both live and discarded.`);
      }
    }
  }

  return {
    actionCount: service.actions.length,
    batchCount: service.batches.length,
    cursor: service.cursor,
    nextActionId: service.nextActionId,
    orphanedBatchCount,
  };
}

export type AnyRasterHistoryBatch =
  | PaintHistoryRenderBatch
  | BlendHistoryRenderBatch
  | FillHistoryRenderBatch;
