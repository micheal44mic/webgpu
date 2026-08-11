import type { BrushEngine } from "./brush-engine";
import {
  decompressLayerColdChunk,
  destroyLayerColdStorage,
  restoreColdStorageResourcesFromChunkStream,
  uploadColdStorageChunkStreamIntoHot,
} from "./engine-cold-storage";
import type {
  LayerColdStorageResources,
  LayerTextureResources,
} from "./engine-layer-resources";
import type {
  HistoryAction,
  HistoryRenderBatch,
  LayerMergeHistoryAction,
  SelectionHistoryMaskSnapshot,
} from "./engine-history-types";
import { HISTORY_JOURNAL_STRATEGY } from "./history-journal";
import {
  createHistoryColdSeedHandle,
  isHistoryColdSeedHandle,
  type HistoryColdSeedHandle,
} from "./history-cold-seed";
import {
  canonicalHistoryJson,
  adaptiveHistoryStorageKeepHotActions,
  historyDiskBudget,
  historyHash32,
  historyStorageChunkBytes,
  historyStorageHotPayloadHardBytes,
  historyStorageMaximumHotActions,
  historyStorageMaximumSegmentBytes,
  historyStorageTargetSegmentBytes,
  planHistoryStorageSegment,
  HISTORY_LOCAL_STORAGE_COMMIT_MAGIC,
  HISTORY_LOCAL_STORAGE_SCHEMA_VERSION,
  HISTORY_LOCAL_STORAGE_SEGMENT_MAGIC,
  HISTORY_STORAGE_MAXIMUM_DESCRIPTOR_BYTES,
  type HistoryDocumentFingerprintV1,
  type HistoryManifestV1,
  type HistorySegmentPlan,
  type HistorySegmentDescriptorV1,
  type HistoryStorageBackendKind,
  type StoredHistoryChunkCodec,
  type StoredHistoryChunkV1,
  type StoredHistoryPayloadKind,
  type StoredHistoryPayloadV1,
} from "./history-storage-core";
import { HistoryStorageCatalog } from "./history-storage-idb";
import { HistoryOpfsClient } from "./history-storage-opfs-client";
import {
  GPU_HISTORY_HYDRATION_CHUNK_BYTES,
  type GpuHistorySlice,
} from "./gpu-history-storage";
import {
  HISTORY_RETENTION_STRATEGY,
} from "./history-retention-core";
import {
  LAYER_SIZE,
  MOBILE_DEVICE_CLASS,
  STAMP_STRIDE_BYTES,
} from "./engine-limits";
import { combineCompressionHashes } from "./engine-math";
import type { LayerColdCompressedChunk } from "./layer-cold-compression-client";
import {
  enforceHistoryMetadataLimit,
  historyFloorCursor,
  periodicCheckpointChainForReplay,
  periodicHistoryCheckpoints,
} from "./history-maintenance-runtime";
import { planRasterHistoryReplay } from "./history-replay-plan";

const SESSION_LEASE_MS = 24 * 60 * 60_000;
const SESSION_HEARTBEAT_MS = 60_000;
const PERSIST_REQUEST_THRESHOLD_BYTES = 32 * 1024 * 1024;
const MAX_DESCRIPTOR_PAYLOADS = 16_384;
const MAX_DESCRIPTOR_CHUNKS = 131_072;
const HISTORY_DEV_FORCE_IDB = import.meta.env.DEV
  && typeof location !== "undefined"
  && new URLSearchParams(location.search).get("historyStorageBackend") === "idb";

type GpuPayloadCandidate = {
  readonly storage: "gpu";
  readonly payloadId: string;
  readonly kind: Exclude<StoredHistoryPayloadKind, "layer-seed">;
  readonly ownerActionId: number;
  readonly ownerCursor: number;
  readonly layerId: number | null;
  readonly rawBytes: number;
  readonly slice: GpuHistorySlice;
};

type ColdPayloadCandidate = {
  readonly storage: "cold";
  readonly payloadId: string;
  readonly kind: "layer-seed";
  readonly ownerActionId: number;
  readonly ownerCursor: number;
  readonly layerId: number;
  readonly rawBytes: number;
  readonly handle: HistoryColdSeedHandle;
};

type HistoryPayloadCandidate = GpuPayloadCandidate | ColdPayloadCandidate;

interface HistoryPayloadRequirementCollector {
  readonly required: Map<string, HistoryPayloadCandidate>;
  readonly addSlice: (slice: GpuHistorySlice) => void;
  readonly addSnapshot: (snapshot: SelectionHistoryMaskSnapshot | null) => void;
  readonly addSeed: (seed: LayerColdStorageResources | null) => void;
}

interface StoredPayloadLocation {
  readonly segment: HistorySegmentDescriptorV1;
  readonly payload: StoredHistoryPayloadV1;
}

interface SpillToken {
  readonly sessionId: string;
  readonly branchId: string;
  readonly operationEpoch: number;
  readonly cursor: number;
  readonly actionsLength: number;
  readonly actionsTail: HistoryAction | null;
}

interface CandidateWriter {
  readonly backend: Exclude<HistoryStorageBackendKind, "memory-only">;
  append(bytes: ArrayBuffer): Promise<number>;
  finish(footerJson: string): Promise<void>;
  abort(): Promise<void>;
}

export interface HistoryLocalStorageTelemetry {
  readonly backend: HistoryStorageBackendKind;
  readonly ready: boolean;
  readonly writable: boolean;
  readonly busy: "idle" | "spilling" | "hydrating";
  readonly committedBytes: number;
  readonly storedPayloads: number;
  readonly storedOnlyPayloads: number;
  readonly storedActions: number;
  readonly segments: number;
  readonly spillsCommitted: number;
  readonly spillFailures: number;
  readonly hydrationsCompleted: number;
  readonly hydrationFailures: number;
  readonly hydratedBytes: number;
  readonly persistenceRequested: boolean;
  readonly persistenceGranted: boolean | null;
  readonly lastError: string | null;
}

export interface HistoryStorageSpillOptions {
  readonly highWaterBytes: number;
  readonly logicalFloorCursor: number;
  readonly currentResidentBytes: () => number;
  readonly shouldContinue: () => boolean;
  readonly afterResidenceChange: () => void;
}

export class HistoryStorageCoordinator {
  private readonly engine: BrushEngine;
  private readonly catalog = new HistoryStorageCatalog();
  private opfs: HistoryOpfsClient | null = null;
  private backend: HistoryStorageBackendKind = "memory-only";
  private ready = false;
  private writable = false;
  private storageBusy: "idle" | "spilling" | "hydrating" = "idle";
  private sessionId = makeId("s");
  private readonly instanceId = makeId("i");
  private branchId = makeId("b");
  private operationEpoch = 1;
  private journalEpoch = 1;
  private ownershipEpoch = 1;
  private manifestGeneration = 0;
  private manifestLogicalFloorCursor = 0;
  private committedBytes = 0;
  private nextColdPayloadId = 1;
  private readonly storedPayloads = new Map<string, StoredPayloadLocation>();
  private readonly segments = new Map<string, HistorySegmentDescriptorV1>();
  private readonly garbageSegmentIds = new Set<string>();
  private readonly opfsGarbageCandidates = new Map<
    string,
    { readonly sessionId: string; readonly segmentId: string }
  >();
  private readonly gpuStableOwnerActionIds = new Map<number, number>();
  private rawSeedHandles = new WeakMap<LayerColdStorageResources, HistoryColdSeedHandle>();
  private readonly coldHandles = new Map<string, HistoryColdSeedHandle>();
  /** One oversized action must not disable spill for every later action. */
  private readonly diskBudgetBlockedActionIds = new Set<number>();
  private heartbeatTimer: number | null = null;
  private sessionLockRelease: (() => void) | null = null;
  private initializePromise: Promise<void>;
  private spillsCommitted = 0;
  private spillFailures = 0;
  private consecutiveSpillFailures = 0;
  private lastSpillFailureSignature: string | null = null;
  private hydrationsCompleted = 0;
  private hydrationFailures = 0;
  private hydratedBytes = 0;
  private persistenceRequested = false;
  private persistenceGranted: boolean | null = null;
  private lastError: string | null = null;
  private destroyed = false;

  constructor(engine: BrushEngine) {
    this.engine = engine;
    this.initializePromise = this.initializeSession();
  }

  telemetry(): HistoryLocalStorageTelemetry {
    const storedOnlyPayloads = [...this.storedPayloads.keys()].filter((payloadId) => {
      const gpuId = gpuSliceIdFromPayloadId(payloadId);
      if (gpuId !== null) {
        const slice = this.engine.historyGpuStorage.sliceById(gpuId);
        return !slice || !this.engine.historyGpuStorage.isResident(slice);
      }
      const handle = this.coldHandles.get(payloadId);
      return Boolean(handle && !handle.resident);
    }).length;
    const storedActions = new Set(
      [...this.storedPayloads.values()].map(({ payload }) => payload.ownerActionId),
    ).size;
    return {
      backend: this.backend,
      ready: this.ready,
      writable: this.writable,
      busy: this.storageBusy,
      committedBytes: this.committedBytes,
      storedPayloads: this.storedPayloads.size,
      storedOnlyPayloads,
      storedActions,
      segments: this.segments.size,
      spillsCommitted: this.spillsCommitted,
      spillFailures: this.spillFailures,
      hydrationsCompleted: this.hydrationsCompleted,
      hydrationFailures: this.hydrationFailures,
      hydratedBytes: this.hydratedBytes,
      persistenceRequested: this.persistenceRequested,
      persistenceGranted: this.persistenceGranted,
      lastError: this.lastError,
    };
  }

  /**
   * Conservative JS-heap allowance for the live storage index. Payload bytes
   * are excluded: this counts descriptors, chunk records, strings and map
   * entries that remain resident while their data lives on disk.
   */
  metadataResidentBytes(): number {
    const stringBytes = (value: string): number => 16 + value.length * 2;
    let bytes = 512
      + this.storedPayloads.size * 64
      + this.segments.size * 80
      + this.garbageSegmentIds.size * 40
      + this.opfsGarbageCandidates.size * 96
      + this.gpuStableOwnerActionIds.size * 32
      + this.coldHandles.size * 128
      + this.diskBudgetBlockedActionIds.size * 24;
    for (const descriptor of this.segments.values()) {
      bytes += 640
        + stringBytes(descriptor.sessionId)
        + stringBytes(descriptor.instanceId)
        + stringBytes(descriptor.branchIdAtCreation)
        + stringBytes(descriptor.segmentId)
        + stringBytes(descriptor.commitNonce)
        + stringBytes(descriptor.descriptorSha256);
      for (const payload of descriptor.payloads) {
        bytes += 384
          + stringBytes(payload.payloadId)
          + stringBytes(payload.serializerId)
          + stringBytes(payload.kind);
        if (payload.gpu) bytes += 128 + stringBytes(payload.gpu.label);
        if (payload.coldSeed) bytes += 160 + payload.coldSeed.tileIndices.length * 8;
        for (const chunk of payload.chunks) {
          bytes += 224 + stringBytes(chunk.codec) + stringBytes(chunk.storedSha256);
        }
      }
    }
    return Math.ceil(bytes);
  }

  /** Payload bytes that still have no durable authority, hot tail included. */
  unstoredResidentPayloadBytes(): number {
    if (this.destroyed) return 0;
    this.wrapAllHistorySeeds();
    return this.collectPayloadCandidates().reduce((total, candidate) => {
      if (this.storedPayloads.has(candidate.payloadId)) return total;
      const resident = candidate.storage === "gpu"
        ? this.engine.historyGpuStorage.isResident(candidate.slice)
        : candidate.handle.resident;
      return total + (resident ? candidate.rawBytes : 0);
    }, 0);
  }

  /**
   * Unstored bytes outside the bounded hot suffix. These are the bytes that a
   * failed spill must treat as stranded; the authorised 2/4-action suffix is a
   * bounded working set, not an accidental memory-only fallback.
   */
  unstoredResidentPayloadPressureBytes(): number {
    if (this.destroyed) return 0;
    this.wrapAllHistorySeeds();
    const candidates = this.collectPayloadCandidates();
    const policy = this.residentHotWindowPolicy(candidates);
    return policy.unprotected.reduce((total, candidate) => (
      total + (this.storedPayloads.has(candidate.payloadId) ? 0 : candidate.rawBytes)
    ), 0);
  }

  /** Every physically resident History payload, including durable hot caches. */
  totalResidentPayloadBytes(): number {
    if (this.destroyed) return 0;
    this.wrapAllHistorySeeds();
    return this.residentHotWindowPolicy(this.collectPayloadCandidates()).residentBytes;
  }

  /**
   * Bytes that must drain before another payload-producing mutation is safe.
   * The historical method name is retained for BrushEngine's admission seam;
   * zero now means "inside the bounded hot policy", not "nothing resident".
   */
  residentPayloadBytes(): number {
    if (this.destroyed) return 0;
    this.wrapAllHistorySeeds();
    return this.residentHotWindowPolicy(this.collectPayloadCandidates()).unprotectedBytes;
  }

  /** A document reset starts a new disposable storage namespace immediately. */
  resetSession(): void {
    if (this.destroyed) return;
    const abandonedSessionId = this.sessionId;
    this.operationEpoch += 1;
    this.journalEpoch += 1;
    this.ownershipEpoch += 1;
    this.sessionId = makeId("s");
    this.branchId = makeId("b");
    this.manifestGeneration = 0;
    this.manifestLogicalFloorCursor = 0;
    this.committedBytes = 0;
    this.storedPayloads.clear();
    this.segments.clear();
    this.garbageSegmentIds.clear();
    this.gpuStableOwnerActionIds.clear();
    this.coldHandles.clear();
    this.diskBudgetBlockedActionIds.clear();
    this.rawSeedHandles = new WeakMap();
    this.nextColdPayloadId = 1;
    this.resetSpillFailureCircuit();
    this.ready = false;
    this.writable = false;
    this.stopHeartbeat();
    this.releaseSessionLock();
    const previousInitialization = this.initializePromise;
    this.initializePromise = previousInitialization.catch(() => undefined).then(async () => {
      await this.waitForStorageIdle();
      await this.deleteSessionBestEffort(abandonedSessionId);
      await this.initializeSession();
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.operationEpoch += 1;
    this.stopHeartbeat();
    this.releaseSessionLock();
    const abandonedSessionId = this.sessionId;
    void this.initializePromise.catch(() => undefined).then(async () => {
      await this.waitForStorageIdle();
      await this.deleteSessionBestEffort(abandonedSessionId);
      this.opfs?.dispose();
      this.opfs = null;
      this.catalog.close();
    });
  }

  onGpuSliceReleased(slice: GpuHistorySlice): void {
    this.retireStoredPayload(gpuPayloadId(slice.id));
  }

  noteBranchCut(): void {
    this.operationEpoch += 1;
    this.journalEpoch += 1;
    this.branchId = makeId("b");
    this.diskBudgetBlockedActionIds.clear();
    this.resetSpillFailureCircuit();
  }

  /**
   * Called from fenced idle maintenance. It first drops resident caches that
   * already have a durable copy, then writes at most four bounded segments.
   */
  async spillIfNeeded(options: HistoryStorageSpillOptions): Promise<boolean> {
    await this.initializePromise;
    if (
      this.destroyed
      || !this.ready
      || this.storageBusy !== "idle"
      || !options.shouldContinue()
    ) {
      return false;
    }
    this.wrapAllHistorySeeds();
    let changed = this.demoteStoredResidentCaches(options);
    if (changed) {
      options.afterResidenceChange();
      this.engine.historyGpuStorage.trimEmptyPages(false);
    }
    if (this.opfsGarbageCandidates.size > 0) {
      this.storageBusy = "spilling";
      try {
        await this.cleanupOpfsGarbageCandidates();
      } finally {
        this.storageBusy = "idle";
      }
    }
    if (this.garbageSegmentIds.size > 0) {
      this.storageBusy = "spilling";
      try {
        await this.collectGarbageSegments(options.shouldContinue);
      } finally {
        this.storageBusy = "idle";
      }
    }
    // Existing durable authority can always release its resident cache even
    // after quota/backend failures have disabled further writes.
    if (!this.writable) return changed;
    for (let segmentCount = 0; segmentCount < 4; segmentCount += 1) {
      if (!options.shouldContinue()) break;
      // Count pressure can require spilling an old action even while the hot
      // suffix is below its byte ceiling, so bytes alone cannot stop the pass.
      if (!this.residentPayloadSegmentPlan(options).plan.required) break;
      const beforeBackend = this.backend;
      // Publish the exclusion state before spillOneSegment reaches its first
      // await (quota estimate included), so Undo cannot observe a resident
      // payload and then race its demotion.
      this.storageBusy = "spilling";
      let result: "committed" | "none" | "backend-fallback" | "budget-skip";
      try {
        result = await this.spillOneSegment(options);
      } finally {
        this.storageBusy = "idle";
      }
      if (result === "committed") {
        changed = true;
        options.afterResidenceChange();
        this.engine.historyGpuStorage.trimEmptyPages(false);
        continue;
      }
      if (result === "budget-skip") continue;
      // An OPFS runtime failure degrades new writes to IDB. Retry the same
      // resident payload once rather than letting byte eviction run first.
      if (result === "backend-fallback" && beforeBackend !== this.backend) continue;
      break;
    }
    if (!options.shouldContinue()) this.engine.resumeHistoryStorageMaintenance();
    return changed;
  }

  shouldDeferJournalEviction(options: HistoryStorageSpillOptions): boolean {
    if (
      this.destroyed
      || !this.ready
      || !this.writable
    ) {
      return false;
    }
    if (this.storageBusy === "spilling") return true;
    if (this.storageBusy !== "idle") return false;
    this.wrapAllHistorySeeds();
    return this.residentPayloadSegmentPlan(options).plan.required;
  }

  /**
   * Preflights target and rollback dependencies before moveHistoryCursor mutates
   * the cursor. Heavy replay payloads stay on disk and are consumed just in
   * time; only the two compare-and-swap selection masks of a transform are
   * hydrated eagerly because the transaction may need either one for rollback.
   */
  async prepareHistoryStep(delta: -1 | 1): Promise<void> {
    // A user gesture invalidates background maintenance synchronously. Give a
    // running spill the chance to publish or abort. Dependencies must be
    // collected only afterwards: a payload that was resident on entry may
    // have become stored-only at the durable commit boundary.
    await this.waitForForegroundStorageAccess();
    this.wrapAllHistorySeeds();
    if (!enforceHistoryMetadataLimit(this.engine)) {
      throw new Error("Metadata History oltre il limite prima di Undo/Redo.");
    }
    await this.flushUnstoredPayloadsBeforeNavigation();
    const required = this.payloadsRequiredForStep(delta);
    const previousCursor = this.engine.historyCursor;
    const crossed = delta < 0
      ? this.engine.historyActions[previousCursor - 1]
      : this.engine.historyActions[previousCursor];
    await this.assertRequiredPayloadsAvailable(required);
    if (
      (crossed?.kind === "layer-delete" && delta > 0)
      || (crossed?.kind === "layer-add" && delta < 0)
    ) {
      // These two directions detach and destroy live layer resources before a
      // later structural step may fail. Their seeds are rollback authority and
      // must be read and verified before the first detach. The opposite attach
      // directions already keep each attached layer live for compensation.
      await this.verifyRequiredPayloadsForRollback(required);
    }
    if (
      crossed
      && (
        crossed.kind === "stroke"
        || crossed.kind === "fill"
        || crossed.kind === "clear"
        || crossed.kind === "raster-transform"
        || crossed.kind === "raster-filter"
      )
    ) {
      // Only the current state is a rollback dependency. Reading target bytes
      // twice would slow every deep step without improving failure atomicity.
      await this.verifyRequiredPayloadsForRollback(
        this.payloadsRequiredForRasterReplay(crossed.layerId, [previousCursor]),
      );
    }
    if (crossed?.kind === "raster-transform") {
      const selectionMasks = this.createPayloadRequirementCollector();
      selectionMasks.addSnapshot(crossed.selectionBefore);
      selectionMasks.addSnapshot(crossed.selectionAfter);
      await this.hydrateRequiredPayloads([...selectionMasks.required.values()]);
    }
  }

  /**
   * Pointer-up schedules idle maintenance on the next browser turn. An
   * immediate Undo may keep the bounded hot suffix resident in the Redo tail;
   * only bytes outside that suffix must become durable before leaving the
   * journal end, where background spill can no longer reach them.
   */
  private async flushUnstoredPayloadsBeforeNavigation(): Promise<void> {
    const token = this.captureToken();
    const shouldContinue = (): boolean => (
      this.tokenIsCurrent(token)
      && this.engine.historyBusy
      && !this.engine.deviceLostError
    );
    const options: HistoryStorageSpillOptions = {
      highWaterBytes: historyStorageHotPayloadHardBytes(MOBILE_DEVICE_CLASS),
      logicalFloorCursor: historyFloorCursor(this.engine),
      currentResidentBytes: () => this.totalResidentPayloadBytes(),
      shouldContinue,
      afterResidenceChange: () => this.engine.historyStorageResidenceChanged(),
    };
    for (;;) {
      this.assertToken(token);
      const before = this.unstoredResidentPayloadPressureBytes();
      if (before === 0) return;
      await this.spillIfNeeded(options);
      if (!enforceHistoryMetadataLimit(this.engine)) {
        throw new Error("Metadata History oltre il limite durante lo spill Undo/Redo.");
      }
      this.assertToken(token);
      const after = this.unstoredResidentPayloadPressureBytes();
      if (after === 0) return;
      if (after >= before || !this.writable) break;
      await yieldBrowserTurn();
    }

    const storage = this.telemetry();
    const reason = storage.lastError ?? "quota/backend non scrivibile";
    // Artwork lives in document textures, independently from History. Retire
    // the non-durable journal before moveHistoryCursor can mutate anything.
    this.engine.resetHistoryState();
    this.engine.publishStatus(
      `Cronologia locale non disponibile (${reason}); `
      + "Undo svuotato senza modificare il disegno.",
      "error",
    );
    this.engine.publishHistoryState();
    this.engine.publishStats();
    throw new Error("Payload History non persistibili prima di Undo/Redo.");
  }

  /** Hydrates exactly one merge seed immediately before its bounded GPU copy. */
  async ensureLayerMergeSeedResident(
    seed: LayerColdStorageResources | null,
  ): Promise<void> {
    if (!seed || !isHistoryColdSeedHandle(seed) || seed.resident) return;
    await this.waitForForegroundStorageAccess();
    const collector = this.createPayloadRequirementCollector();
    collector.addSeed(seed);
    const required = [...collector.required.values()];
    if (required.length !== 1) {
      throw new Error("Seed merge locale non più raggiungibile nello storage History.");
    }
    await this.hydrateRequiredPayloads(required);
  }

  /**
   * Makes one render batch available immediately before it is submitted.
   * Returns true when the slice has durable authority and may therefore be
   * demoted after the caller's GPU fence.
   */
  async ensureGpuSliceResidentForReplay(slice: GpuHistorySlice): Promise<boolean> {
    return (await this.ensureGpuSlicesResidentForReplay([slice])).has(slice.id);
  }

  /** Hydrates one batch and its optional selection mask in the same queue turn. */
  async ensureGpuSlicesResidentForReplay(
    slices: readonly GpuHistorySlice[],
  ): Promise<ReadonlySet<number>> {
    await this.waitForForegroundStorageAccess();
    this.wrapAllHistorySeeds();
    const candidatesBySliceId = new Map(
      this.collectPayloadCandidates().flatMap((item) => item.storage === "gpu"
        ? [[item.slice.id, item] as const]
        : []),
    );
    const candidates: GpuPayloadCandidate[] = [];
    const durableSliceIds = new Set<number>();
    const seenSliceIds = new Set<number>();
    for (const slice of slices) {
      const candidate = candidatesBySliceId.get(slice.id);
      if (!candidate || candidate.slice !== slice) {
        throw new Error("Slice del replay History non più raggiungibile.");
      }
      if (seenSliceIds.has(slice.id)) continue;
      seenSliceIds.add(slice.id);
      candidates.push(candidate);
      if (this.storedPayloads.has(candidate.payloadId)) durableSliceIds.add(slice.id);
    }
    const missing = candidates.filter((candidate) =>
      !this.engine.historyGpuStorage.isResident(candidate.slice)
    );
    for (const candidate of missing) {
      if (!durableSliceIds.has(candidate.slice.id)) {
        throw new Error(
          "La slice del replay non è residente e non possiede una copia locale.",
        );
      }
    }
    if (missing.length > 0) {
      // Queue.writeBuffer and the following replay submit share one ordered
      // GPUQueue. The replay fence is also the hydration fence, saving two
      // round-trips for Paint+selection while preserving the same byte bound.
      await this.hydrateRequiredPayloads(missing, false);
    }
    return durableSliceIds;
  }

  /** Caller must fence every GPU use before releasing these bindings. */
  demoteStoredGpuSlicesAfterReplay(
    slices: readonly GpuHistorySlice[],
    trimEmptyPages = true,
  ): number {
    if (this.destroyed || this.storageBusy !== "idle") return 0;
    const demotable: GpuHistorySlice[] = [];
    const seenSliceIds = new Set<number>();
    for (const slice of slices) {
      if (seenSliceIds.has(slice.id)) continue;
      seenSliceIds.add(slice.id);
      if (
        this.storedPayloads.has(gpuPayloadId(slice.id))
        && this.engine.historyGpuStorage.contains(slice)
        && this.engine.historyGpuStorage.isResident(slice)
      ) {
        demotable.push(slice);
      }
    }
    if (demotable.length === 0) return 0;
    const demoted = this.engine.historyGpuStorage
      .prepareDemoteMany(demotable)
      .commitNoThrow();
    if (demoted === 0) return 0;
    for (const slice of demotable) {
      this.engine.selectionHistoryClipBindGroups.delete(slice.id);
    }
    if (trimEmptyPages) this.engine.historyGpuStorage.trimEmptyPages(false);
    this.ownershipEpoch += 1;
    this.engine.historyStorageResidenceChanged();
    return demoted;
  }

  demoteStoredGpuSliceAfterReplay(
    slice: GpuHistorySlice,
    trimEmptyPages = true,
  ): boolean {
    return this.demoteStoredGpuSlicesAfterReplay([slice], trimEmptyPages) > 0;
  }

  /**
   * Streams a stored-only tiled checkpoint straight into the live hot texture.
   * No History texture is allocated: the only CPU object is the current bounded
   * compression chunk, and the destination is document state rather than cache.
   */
  async streamStoredColdSeedIntoHot(
    seed: LayerColdStorageResources | null,
    hot: LayerTextureResources,
  ): Promise<boolean> {
    if (!seed || !isHistoryColdSeedHandle(seed) || seed.resident) return false;
    await this.waitForForegroundStorageAccess();
    this.wrapAllHistorySeeds();
    const candidate = this.collectPayloadCandidates().find((item) =>
      item.storage === "cold" && item.handle === seed
    );
    if (!candidate) {
      throw new Error("Checkpoint raster History non più raggiungibile.");
    }
    await this.initializePromise;
    if (!this.ready || this.storageBusy !== "idle") {
      throw new Error("La cronologia locale non è disponibile in questo momento.");
    }
    const location = this.storedPayloads.get(candidate.payloadId);
    if (!location) {
      throw new Error("Checkpoint raster History assente dallo storage locale.");
    }
    assertStoredPayloadCompatible(location.payload, candidate);
    const metadata = this.coldSeedMetadata(location);
    const token = this.captureToken();
    this.storageBusy = "hydrating";
    this.engine.publishStatus(
      `Streaming checkpoint locale… ${formatMiB(candidate.rawBytes)} MiB`,
      "working",
    );
    try {
      this.assertToken(token);
      await uploadColdStorageChunkStreamIntoHot(
        this.engine,
        {
          tileIndices: [...metadata.tileIndices],
          rawBytes: metadata.rawBytes,
          sourceHash: metadata.sourceHash,
          format: metadata.format,
        },
        this.readColdSeedChunksFromStorage(
          location,
          () => this.assertToken(token),
        ),
        hot,
        `Replay checkpoint locale · azione ${candidate.ownerActionId}`,
        () => this.assertToken(token),
      );
      this.assertToken(token);
      this.hydrationsCompleted += 1;
      this.hydratedBytes += candidate.rawBytes;
      return true;
    } catch (error) {
      this.hydrationFailures += 1;
      this.lastError = errorMessage(error);
      throw error;
    } finally {
      this.storageBusy = "idle";
    }
  }

  /**
   * Restores one stored-only seed as a detached live cold authority. Merge Undo
   * uses this to avoid the old restore-then-clone pair of History textures.
   */
  async restoreStoredColdSeedForDetachedReplay(
    seed: LayerColdStorageResources | null,
  ): Promise<LayerColdStorageResources | null> {
    if (!seed || !isHistoryColdSeedHandle(seed) || seed.resident) return null;
    await this.waitForForegroundStorageAccess();
    this.wrapAllHistorySeeds();
    const candidate = this.collectPayloadCandidates().find((item) =>
      item.storage === "cold" && item.handle === seed
    );
    if (!candidate) {
      throw new Error("Seed detached History non più raggiungibile.");
    }
    await this.initializePromise;
    if (!this.ready || this.storageBusy !== "idle") {
      throw new Error("La cronologia locale non è disponibile in questo momento.");
    }
    const location = this.storedPayloads.get(candidate.payloadId);
    if (!location) {
      throw new Error("Seed detached History assente dallo storage locale.");
    }
    assertStoredPayloadCompatible(location.payload, candidate);
    const token = this.captureToken();
    let restored: LayerColdStorageResources | null = null;
    this.storageBusy = "hydrating";
    this.engine.publishStatus(
      `Streaming seed locale… ${formatMiB(candidate.rawBytes)} MiB`,
      "working",
    );
    try {
      restored = await this.restoreColdSeedFromStorage(
        location,
        candidate.ownerActionId,
        () => this.assertToken(token),
      );
      this.assertToken(token);
      this.hydrationsCompleted += 1;
      this.hydratedBytes += candidate.rawBytes;
      const result = restored;
      restored = null;
      return result;
    } catch (error) {
      if (restored) destroyLayerColdStorage(restored);
      this.hydrationFailures += 1;
      this.lastError = errorMessage(error);
      throw error;
    } finally {
      this.storageBusy = "idle";
    }
  }

  /** Demotes durable caches before admission and after each streamed copy. */
  demoteStoredLayerMergeSeeds(action: LayerMergeHistoryAction): boolean {
    this.wrapAllHistorySeeds();
    let changed = false;
    for (const input of action.inputs) {
      if (input.kind === "raster") {
        changed = this.demoteStoredLayerMergeSeed(input.entry.seed) || changed;
      }
    }
    changed = this.demoteStoredLayerMergeSeed(action.output.seed) || changed;
    return changed;
  }

  demoteStoredLayerMergeSeed(seed: LayerColdStorageResources | null): boolean {
    if (
      !seed
      || !isHistoryColdSeedHandle(seed)
      || !seed.resident
      || !this.storedPayloads.has(seed.payloadId)
    ) {
      return false;
    }
    const resident = seed.demoteResidentNoThrow();
    try {
      resident?.texture.destroy();
    } catch {
      // The committed local payload remains authoritative.
    }
    this.ownershipEpoch += 1;
    return true;
  }

  /**
   * Preflights the exact replay plan used to roll a live raster operation back.
   * Fill calls this before its first pixel mutation, so a stored-only periodic
   * checkpoint can never make an error path unable to restore the document.
   */
  async prepareRasterReplayAtCursor(layerId: number, cursor: number): Promise<void> {
    if (cursor < 0 || cursor > this.engine.historyActions.length) {
      throw new Error("Cursore History non valido per il preflight raster.");
    }
    await this.waitForForegroundStorageAccess();
    this.wrapAllHistorySeeds();
    const required = this.payloadsRequiredForRasterReplay(layerId, [cursor]);
    await this.assertRequiredPayloadsAvailable(required);
    await this.verifyRequiredPayloadsForRollback(required);
  }

  private async waitForForegroundStorageAccess(): Promise<void> {
    const deadline = performance.now() + 60_000;
    while (this.storageBusy === "spilling" && performance.now() < deadline) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 10));
    }
    if (this.storageBusy !== "idle") {
      throw new Error("La cronologia locale è ancora occupata; il disegno non è stato modificato.");
    }
  }

  private async hydrateRequiredPayloads(
    required: readonly HistoryPayloadCandidate[],
    fenceAfterHydration = true,
  ): Promise<void> {
    const missing = required.filter((candidate) => candidate.storage === "gpu"
      ? !this.engine.historyGpuStorage.isResident(candidate.slice)
      : !candidate.handle.resident
    );
    if (missing.length === 0) return;
    await this.initializePromise;
    if (!this.ready || this.storageBusy !== "idle") {
      throw new Error("La cronologia locale non è disponibile in questo momento.");
    }
    for (const candidate of missing) {
      if (!this.storedPayloads.has(candidate.payloadId)) {
        throw new Error(
          "La parte locale della cronologia non è più disponibile. "
          + "Il disegno corrente non è stato modificato.",
        );
      }
    }

    const token = this.captureToken();
    const totalBytes = missing.reduce((total, candidate) => total + candidate.rawBytes, 0);
    let loadedBytes = 0;
    let residenceChanged = false;
    const newlyHydrated: HistoryPayloadCandidate[] = [];
    this.storageBusy = "hydrating";
    this.engine.publishStatus(
      `Caricamento cronologia locale… 0,0 / ${formatMiB(totalBytes)} MiB`,
      "working",
    );
    try {
      for (const candidate of missing) {
        this.assertToken(token);
        const location = this.storedPayloads.get(candidate.payloadId)!;
        assertStoredPayloadCompatible(location.payload, candidate);
        if (candidate.storage === "gpu") {
          await this.hydrateGpuPayloadFromStorage(
            location,
            candidate.slice,
            () => this.assertToken(token),
          );
          residenceChanged = true;
          newlyHydrated.push(candidate);
        } else {
          const restored = await this.restoreColdSeedFromStorage(
            location,
            candidate.ownerActionId,
            () => this.assertToken(token),
          );
          try {
            this.assertToken(token);
            candidate.handle.attachResident(restored);
            residenceChanged = true;
            newlyHydrated.push(candidate);
          } catch (error) {
            destroyLayerColdStorage(restored);
            throw error;
          }
        }
        loadedBytes += candidate.rawBytes;
        this.hydratedBytes += candidate.rawBytes;
        this.engine.publishStatus(
          `Caricamento cronologia locale… ${formatMiB(loadedBytes)} / `
          + `${formatMiB(totalBytes)} MiB`,
          "working",
        );
        await yieldBrowserTurn();
      }
      if (fenceAfterHydration) {
        await this.engine.waitForGpuCapped("Hydrate cronologia locale", 60_000);
      }
      this.assertToken(token);
      this.hydrationsCompleted += 1;
      this.ownershipEpoch += 1;
      this.engine.historyStorageResidenceChanged();
    } catch (error) {
      this.hydrationFailures += 1;
      this.lastError = errorMessage(error);
      if (residenceChanged) {
        // A multi-payload preflight is all-or-nothing as a cache operation.
        // Earlier candidates are reconstructible from their durable copy; do
        // not strand them resident merely because a later chunk failed.
        let fenceCompleted = false;
        try {
          await this.engine.waitForGpuCapped(
            "Rollback idratazione History locale",
            60_000,
          );
          fenceCompleted = true;
        } catch {
          // Never free a binding or texture whose last GPU use is unknown.
          // A later successful fenced trim may reclaim the quarantined cache.
        }
        if (fenceCompleted) {
          const gpuSlices = newlyHydrated.flatMap((candidate) => (
            candidate.storage === "gpu"
            && this.engine.historyGpuStorage.contains(candidate.slice)
            && this.engine.historyGpuStorage.isResident(candidate.slice)
              ? [candidate.slice]
              : []
          ));
          try {
            this.engine.historyGpuStorage.prepareDemoteMany(gpuSlices).commitNoThrow();
          } catch {
            // reset/destroy may already have retired the same handles.
          }
          for (const candidate of newlyHydrated) {
            if (candidate.storage !== "cold" || !candidate.handle.resident) continue;
            const resident = candidate.handle.demoteResidentNoThrow();
            try {
              resident?.texture.destroy();
            } catch {
              // The stored payload remains authoritative.
            }
          }
          this.engine.selectionHistoryClipBindGroups.clear();
          try {
            this.engine.historyGpuStorage.trimEmptyPages(false);
          } catch {
            // Engine destruction already reclaimed allocator ownership.
          }
          this.ownershipEpoch += 1;
          this.engine.historyStorageResidenceChanged();
        }
      }
      throw error;
    } finally {
      this.storageBusy = "idle";
    }
  }

  private async assertRequiredPayloadsAvailable(
    required: readonly HistoryPayloadCandidate[],
  ): Promise<void> {
    const missing = required.filter((candidate) => candidate.storage === "gpu"
      ? !this.engine.historyGpuStorage.isResident(candidate.slice)
      : !candidate.handle.resident
    );
    if (missing.length === 0) return;
    await this.initializePromise;
    if (!this.ready || this.storageBusy !== "idle") {
      throw new Error("La cronologia locale non è disponibile in questo momento.");
    }
    for (const candidate of missing) {
      if (!this.storedPayloads.has(candidate.payloadId)) {
        throw new Error(
          "La parte locale della cronologia non è più disponibile. "
          + "Il disegno corrente non è stato modificato.",
        );
      }
    }
  }

  /** Reads durable rollback authority without materialising the full payload. */
  private async verifyRequiredPayloadsForRollback(
    required: readonly HistoryPayloadCandidate[],
  ): Promise<void> {
    const pending = required.filter((candidate) =>
      this.storedPayloads.has(candidate.payloadId)
    );
    if (pending.length === 0) return;
    await this.initializePromise;
    if (!this.ready || this.storageBusy !== "idle") {
      throw new Error("La cronologia locale non è disponibile per il rollback.");
    }
    const token = this.captureToken();
    const totalBytes = pending.reduce((total, candidate) => total + candidate.rawBytes, 0);
    let verifiedBytes = 0;
    this.storageBusy = "hydrating";
    this.engine.publishStatus(
      `Verifica rollback locale… 0,0 / ${formatMiB(totalBytes)} MiB`,
      "working",
    );
    try {
      for (const candidate of pending) {
        this.assertToken(token);
        const location = this.storedPayloads.get(candidate.payloadId);
        if (!location) throw new Error("Payload rollback locale non più disponibile.");
        assertStoredPayloadCompatible(location.payload, candidate);
        for (const chunk of [...location.payload.chunks].sort(
          (left, right) => left.payloadChunkIndex - right.payloadChunkIndex,
        )) {
          this.assertToken(token);
          const bytes = new Uint8Array(await this.readStoredChunk(location.segment, chunk));
          this.assertToken(token);
          await verifyStoredChunk(bytes, chunk);
          if (candidate.storage === "gpu") {
            if (chunk.codec !== "raw" || historyHash32(bytes) !== chunk.rawHash32) {
              throw new Error("Hash raw del payload rollback locale non valido.");
            }
          } else {
            // Stored SHA alone cannot prove that a cold checkpoint remains
            // decompressible. Exercise the exact decompressor and raw hash now,
            // before a destructive operation can need this seed for rollback.
            await decompressLayerColdChunk(this.engine, {
              storage: chunk.codec,
              bytes: exactArrayBuffer(bytes),
              rawBytes: chunk.rawBytes,
              storedBytes: chunk.storedBytes,
              sourceHash: chunk.rawHash32,
            });
          }
          this.assertToken(token);
          await yieldBrowserTurn();
        }
        this.assertToken(token);
        verifiedBytes += candidate.rawBytes;
        this.engine.publishStatus(
          `Verifica rollback locale… ${formatMiB(verifiedBytes)} / `
          + `${formatMiB(totalBytes)} MiB`,
          "working",
        );
      }
    } catch (error) {
      this.lastError = errorMessage(error);
      throw error;
    } finally {
      this.storageBusy = "idle";
    }
  }

  /**
   * Keeps deep navigation byte-bounded. Rehydrated payloads are replay inputs,
   * not live document state, so after the caller's GPU fence every durable
   * resident copy can be demoted immediately; there is no adjacent hot cache.
   */
  trimHydratedWorkingSetAfterStep(_preferredDelta: -1 | 1): boolean {
    if (this.storageBusy !== "idle" || this.destroyed) return false;
    this.wrapAllHistorySeeds();
    // History V2 deliberately has no adjacent-step hot cache. OPFS remains
    // authoritative and every reconstructible hydration is released after the
    // replay fence, including the payload just crossed by Undo/Redo.
    const candidates = this.collectPayloadCandidates().filter((candidate) =>
      this.storedPayloads.has(candidate.payloadId)
      && (candidate.storage === "gpu"
        ? this.engine.historyGpuStorage.isResident(candidate.slice)
        : candidate.handle.resident)
    );
    if (candidates.length === 0) return false;
    const gpuSlices = candidates.flatMap((candidate) =>
      candidate.storage === "gpu" ? [candidate.slice] : []
    );
    const prepared = this.engine.historyGpuStorage.prepareDemoteMany(gpuSlices);
    prepared.commitNoThrow();
    for (const candidate of candidates) {
      if (candidate.storage !== "cold") continue;
      const resident = candidate.handle.demoteResidentNoThrow();
      try {
        resident?.texture.destroy();
      } catch {
        // The durable payload remains authoritative.
      }
    }
    this.engine.selectionHistoryClipBindGroups.clear();
    this.engine.historyGpuStorage.trimEmptyPages(false);
    this.ownershipEpoch += 1;
    this.engine.historyStorageResidenceChanged();
    return true;
  }

  private async initializeSession(): Promise<void> {
    const initializingSessionId = this.sessionId;
    let candidate: HistoryOpfsClient | null = null;
    try {
      await this.catalog.selfTest();
      if (!this.sessionIsCurrent(initializingSessionId)) return;
      await this.catalog.registerSession(
        initializingSessionId,
        this.instanceId,
        SESSION_LEASE_MS,
      );
      if (!this.sessionIsCurrent(initializingSessionId)) return;
      const lockProtected = await this.acquireSessionLock(initializingSessionId);
      if (!this.sessionIsCurrent(initializingSessionId)) return;
      if (lockProtected) {
        await this.catalog.markSessionLockProtected(initializingSessionId);
        if (!this.sessionIsCurrent(initializingSessionId)) return;
      }
      this.backend = "indexeddb-chunks";
      this.writable = true;
      this.opfs?.dispose();
      this.opfs = null;
      try {
        if (HISTORY_DEV_FORCE_IDB) throw new Error("Backend IDB forzato dalla QA locale.");
        candidate = new HistoryOpfsClient();
        const result = await candidate.selfTest();
        if (!this.sessionIsCurrent(initializingSessionId)) return;
        if (result.supported) {
          await this.catalog.markSessionUsesOpfs(initializingSessionId);
          if (!this.sessionIsCurrent(initializingSessionId)) return;
          this.opfs = candidate;
          candidate = null;
          this.backend = "opfs-worker";
        }
      } catch {
        // IndexedDB chunks remain the complete fallback.
      }
      if (!this.sessionIsCurrent(initializingSessionId)) return;
      this.startHeartbeat(initializingSessionId);
      await this.cleanupOrphanedSessions(initializingSessionId);
      if (!this.sessionIsCurrent(initializingSessionId)) return;
      this.ready = true;
      this.lastError = null;
    } catch (error) {
      if (!this.sessionIsCurrent(initializingSessionId)) return;
      this.releaseSessionLock();
      this.backend = "memory-only";
      this.writable = false;
      this.ready = true;
      this.lastError = errorMessage(error);
    } finally {
      candidate?.dispose();
    }
  }

  private residentHotWindowPolicy(
    candidates: readonly HistoryPayloadCandidate[],
    highWaterBytes = historyStorageHotPayloadHardBytes(MOBILE_DEVICE_CLASS),
  ): {
    readonly resident: readonly HistoryPayloadCandidate[];
    readonly unprotected: readonly HistoryPayloadCandidate[];
    readonly residentBytes: number;
    readonly unprotectedBytes: number;
    readonly keepHotActions: number;
    readonly coldCeiling: number;
  } {
    const resident = candidates.filter((candidate) => candidate.storage === "gpu"
      ? this.engine.historyGpuStorage.isResident(candidate.slice)
      : candidate.handle.resident
    );
    const byAction = new Map<number, { cursor: number; payloadBytes: number }>();
    for (const candidate of resident) {
      const current = byAction.get(candidate.ownerActionId) ?? {
        cursor: candidate.ownerCursor,
        payloadBytes: 0,
      };
      current.cursor = Math.max(current.cursor, candidate.ownerCursor);
      current.payloadBytes += candidate.rawBytes;
      byAction.set(candidate.ownerActionId, current);
    }
    const residentBytes = resident.reduce((total, candidate) => total + candidate.rawBytes, 0);
    const keepHotActions = adaptiveHistoryStorageKeepHotActions({
      currentResidentBytes: residentBytes,
      highWaterBytes,
      hotPayloadBudgetBytes: highWaterBytes,
      journalLength: this.engine.historyActions.length,
      maximumHotActions: historyStorageMaximumHotActions(MOBILE_DEVICE_CLASS),
      actions: [...byAction.values()],
    });
    const coldCeiling = Math.max(
      0,
      this.engine.historyActions.length - keepHotActions,
    );
    const unprotected = resident.filter((candidate) => candidate.ownerCursor < coldCeiling);
    return {
      resident,
      unprotected,
      residentBytes,
      unprotectedBytes: unprotected.reduce((total, candidate) => total + candidate.rawBytes, 0),
      keepHotActions,
      coldCeiling,
    };
  }

  private residentPayloadSegmentPlan(options: HistoryStorageSpillOptions): {
    candidates: HistoryPayloadCandidate[];
    plan: HistorySegmentPlan;
  } {
    const candidates = this.collectPayloadCandidates();
    const policy = this.residentHotWindowPolicy(candidates, options.highWaterBytes);
    const byAction = new Map<number, {
      cursor: number;
      bytes: number;
      count: number;
    }>();
    for (const candidate of policy.resident) {
      if (this.storedPayloads.has(candidate.payloadId)) continue;
      const current = byAction.get(candidate.ownerActionId) ?? {
        cursor: candidate.ownerCursor,
        bytes: 0,
        count: 0,
      };
      current.cursor = Math.max(current.cursor, candidate.ownerCursor);
      current.bytes += candidate.rawBytes;
      current.count += 1;
      byAction.set(candidate.ownerActionId, current);
    }
    const planningActions = [...byAction].map(([actionId, value]) => ({
      actionId,
      cursor: value.cursor,
      payloadBytes: value.bytes,
      payloadCount: value.count,
      alreadyStored: false,
      pinned: this.diskBudgetBlockedActionIds.has(actionId),
    }));
    const maximumSegmentBytes = historyStorageMaximumSegmentBytes(MOBILE_DEVICE_CLASS);
    return {
      candidates,
      plan: planHistoryStorageSegment({
        currentResidentBytes: Math.max(
          policy.residentBytes,
          options.currentResidentBytes(),
        ),
        highWaterBytes: options.highWaterBytes,
        targetSegmentBytes: historyStorageTargetSegmentBytes(MOBILE_DEVICE_CLASS),
        maximumSegmentBytes,
        journalLength: this.engine.historyActions.length,
        keepHotActions: policy.keepHotActions,
        actions: planningActions,
      }),
    };
  }

  private async spillOneSegment(
    options: HistoryStorageSpillOptions,
  ): Promise<"committed" | "none" | "backend-fallback" | "budget-skip"> {
    const { candidates, plan } = this.residentPayloadSegmentPlan(options);
    if (!plan.required) return "none";
    const selectedActionIds = new Set(plan.actionIds);
    const selected = candidates.filter((candidate) =>
      selectedActionIds.has(candidate.ownerActionId)
      && !this.storedPayloads.has(candidate.payloadId)
    );
    if (selected.length === 0) return "none";

    const token = this.captureToken();
    const estimate = typeof navigator.storage?.estimate === "function"
      ? await navigator.storage.estimate().catch(() => ({ usage: 0, quota: 0 }))
      : { usage: 0, quota: 0 };
    if (!this.tokenIsCurrent(token) || !options.shouldContinue()) return "none";
    const diskBudget = historyDiskBudget({
      quota: estimate.quota ?? 0,
      usage: estimate.usage ?? 0,
      committedHistoryBytes: this.committedBytes,
      maximumStoredSegmentBytes: historyStorageMaximumSegmentBytes(MOBILE_DEVICE_CLASS),
      mobile: MOBILE_DEVICE_CLASS,
    });
    if (
      diskBudget.hardBytes <= this.committedBytes
      || plan.rawBytes > diskBudget.hardBytes - this.committedBytes
    ) {
      for (const actionId of plan.actionIds) {
        this.diskBudgetBlockedActionIds.add(actionId);
      }
      this.lastError =
        "Azione History troppo grande per il budget locale; gli altri payload restano spillabili.";
      return "budget-skip";
    }

    const segmentId = makeId("seg");
    const commitNonce = makeId("c");
    let writer: CandidateWriter | null = null;
    let manifestCommitted = false;
    this.storageBusy = "spilling";
    try {
      await this.engine.waitForIdle();
      await this.engine.device.queue.onSubmittedWorkDone();
      this.assertToken(token);
      if (!options.shouldContinue()) throw new Error("Spill History interrotto dall'utente.");
      writer = await this.beginCandidate(segmentId);
      let storageChunkIndex = 0;
      const storedPayloads: StoredHistoryPayloadV1[] = [];
      for (const candidate of selected) {
        this.assertToken(token);
        if (!options.shouldContinue()) throw new Error("Spill History diventato stale.");
        const serialized = candidate.storage === "gpu"
          ? await this.serializeGpuPayload(candidate, writer, storageChunkIndex, options)
          : await this.serializeColdPayload(candidate, writer, storageChunkIndex, options);
        storedPayloads.push(serialized.payload);
        storageChunkIndex = serialized.nextStorageChunkIndex;
        await yieldBrowserTurn();
      }
      this.assertToken(token);
      if (!options.shouldContinue()) throw new Error("Spill History diventato stale.");
      const rawBytes = storedPayloads.reduce((total, payload) => total + payload.rawBytes, 0);
      const storedBytes = storedPayloads.reduce((total, payload) => total + payload.storedBytes, 0);
      const actionIds = plan.actionIds;
      const descriptorBase = {
        magic: HISTORY_LOCAL_STORAGE_SEGMENT_MAGIC,
        version: HISTORY_LOCAL_STORAGE_SCHEMA_VERSION,
        sessionId: token.sessionId,
        instanceId: this.instanceId,
        branchIdAtCreation: token.branchId,
        segmentId,
        commitNonce,
        backend: writer.backend,
        startCursor: plan.startCursor,
        endCursor: plan.endCursor,
        firstActionId: actionIds[0],
        lastActionId: actionIds.at(-1)!,
        journalEpoch: this.journalEpoch,
        documentFingerprint: this.fingerprint(),
        payloads: storedPayloads,
        rawBytes,
        storedBytes,
        chunkCount: storageChunkIndex,
        commitMarker: HISTORY_LOCAL_STORAGE_COMMIT_MAGIC,
      } as const;
      const descriptorSha256 = await sha256Text(canonicalHistoryJson(descriptorBase));
      const descriptor: HistorySegmentDescriptorV1 = {
        ...descriptorBase,
        descriptorSha256,
      };
      assertSegmentDescriptor(descriptor, this.fingerprint());
      await writer.finish(JSON.stringify({
        magic: HISTORY_LOCAL_STORAGE_COMMIT_MAGIC,
        segmentId,
        commitNonce,
        descriptorSha256,
      }));
      await this.verifyCandidate(descriptor);
      this.assertToken(token);
      if (!options.shouldContinue()) throw new Error("Spill History stale prima del manifest.");

      // Prevalidate every physical release before the durable publication.
      const gpuSlices = selected.flatMap((candidate) =>
        candidate.storage === "gpu" ? [candidate.slice] : []
      );
      const gpuDemotion = this.engine.historyGpuStorage.prepareDemoteMany(gpuSlices);
      const coldHandles = selected.flatMap((candidate) =>
        candidate.storage === "cold" ? [candidate.handle] : []
      );
      if (coldHandles.some((handle) => !handle.resident || handle.retired)) {
        throw new Error("Seed History non più residente prima del commit.");
      }

      const nextManifest = this.nextManifest(descriptor, options.logicalFloorCursor);
      await this.catalog.commitSegmentCAS({
        expectedManifestGeneration: this.manifestGeneration,
        segment: descriptor,
        nextManifest,
      });
      manifestCommitted = true;

      // resetSession/destroy move ownership to another namespace immediately,
      // while their cleanup waits for this operation to leave storageBusy.
      // Never publish the old manifest generation into the new session.
      if (token.sessionId !== this.sessionId || this.destroyed) return "none";

      // From here to ownership publication there is no awaited/fallible work.
      // A foreground gesture may have invalidated maintenance while the CAS
      // was pending. The durable copy is still published, but resident data is
      // demoted only when the exact prevalidated journal token remains current.
      const demotionStillSafe = this.tokenIsCurrent(token) && options.shouldContinue();
      const livePayloadIds = new Set(selected.flatMap((candidate) => {
        if (candidate.storage === "gpu") {
          return this.engine.historyGpuStorage.contains(candidate.slice)
            ? [candidate.payloadId]
            : [];
        }
        return candidate.handle.retired ? [] : [candidate.payloadId];
      }));
      this.manifestGeneration = nextManifest.generation;
      this.manifestLogicalFloorCursor = nextManifest.logicalFloorCursor;
      this.committedBytes = nextManifest.committedBytes;
      this.segments.set(segmentId, descriptor);
      for (const payload of descriptor.payloads) {
        if (livePayloadIds.has(payload.payloadId)) {
          this.storedPayloads.set(payload.payloadId, { segment: descriptor, payload });
        }
      }
      this.markSegmentGarbageIfDead(descriptor);
      this.ownershipEpoch += 1;
      if (demotionStillSafe) {
        gpuDemotion.commitNoThrow();
        for (const handle of coldHandles) {
          const resident = handle.demoteResidentNoThrow();
          try {
            resident?.texture.destroy();
          } catch {
            // Durable storage is authoritative; a failed destroy is only a leak.
          }
        }
        this.engine.selectionHistoryClipBindGroups.clear();
      }
      this.spillsCommitted += 1;
      this.resetSpillFailureCircuit();
      this.lastError = null;
      void this.maybeRequestPersistence();
      return "committed";
    } catch (error) {
      const interrupted = !options.shouldContinue() || !this.tokenIsCurrent(token);
      if (!interrupted) {
        this.spillFailures += 1;
        const failureName = errorName(error);
        const failureSignature = [
          writer?.backend ?? this.backend,
          token.branchId,
          plan.actionIds.join(","),
          failureName,
        ].join(":");
        this.lastSpillFailureSignature = failureSignature;
        // Bound retries per backend, not per error name. Browsers may alternate
        // AbortError/UnknownError for the same broken storage authority.
        this.consecutiveSpillFailures += 1;
        this.lastError = errorMessage(error);
      }
      if (!manifestCommitted) {
        const opfsCandidate = writer?.backend === "opfs-worker" || this.backend === "opfs-worker";
        await writer?.abort().catch(() => undefined);
        await this.catalog.deleteSegmentPayload(token.sessionId, segmentId).catch(() => undefined);
        if (opfsCandidate) {
          this.queueOpfsGarbageCandidate(token.sessionId, segmentId);
          await this.cleanupOpfsGarbageCandidates();
        }
      }
      if (this.backend === "opfs-worker" && isStorageBackendFailure(error)) {
        this.opfs?.dispose();
        this.opfs = null;
        this.backend = "indexeddb-chunks";
        this.writable = true;
        // The next attempt uses an independent backend, so it starts a fresh
        // bounded retry window.
        this.resetSpillFailureCircuit();
        return "backend-fallback";
      }
      if (!interrupted && (isQuotaError(error) || this.consecutiveSpillFailures >= 3)) {
        // Do not livelock idle maintenance with non-durable resident payloads.
        // The maintenance owner observes writable=false and fails closed by
        // retiring History while preserving the live document artwork.
        this.writable = false;
      }
      return "none";
    } finally {
      this.storageBusy = "idle";
    }
  }

  private async serializeGpuPayload(
    candidate: GpuPayloadCandidate,
    writer: CandidateWriter,
    firstStorageChunkIndex: number,
    options: HistoryStorageSpillOptions,
  ): Promise<{ payload: StoredHistoryPayloadV1; nextStorageChunkIndex: number }> {
    const chunks: StoredHistoryChunkV1[] = [];
    let storageChunkIndex = firstStorageChunkIndex;
    let payloadChunkIndex = 0;
    let storedBytes = 0;
    for await (const raw of readGpuHistorySliceChunks(
      this.engine,
      candidate.slice,
      historyStorageChunkBytes(MOBILE_DEVICE_CLASS),
    )) {
      if (!options.shouldContinue()) throw new Error("Readback History interrotto.");
      const storedSha256 = await sha256Bytes(raw);
      // OPFS transfers (and therefore detaches) the exact buffer passed to
      // append. Capture all metadata before crossing that ownership boundary.
      const rawBytes = raw.byteLength;
      const rawHash32 = historyHash32(raw);
      const bytes = exactArrayBuffer(raw);
      const fileOffset = await writer.append(bytes);
      chunks.push({
        storageChunkIndex,
        payloadChunkIndex,
        fileOffset,
        rawBytes,
        storedBytes: rawBytes,
        codec: "raw",
        storedSha256,
        rawHash32,
      });
      storedBytes += rawBytes;
      storageChunkIndex += 1;
      payloadChunkIndex += 1;
    }
    if (storedBytes !== candidate.rawBytes) {
      throw new Error(`Readback slice ${candidate.slice.id} incompleto.`);
    }
    return {
      payload: {
        payloadId: candidate.payloadId,
        serializerId: "opaque-gpu-v1",
        kind: candidate.kind,
        ownerActionId: candidate.ownerActionId,
        layerId: candidate.layerId,
        rawBytes: candidate.rawBytes,
        storedBytes,
        chunks,
        gpu: {
          logicalBytes: candidate.slice.logicalBytes,
          label: candidate.slice.label,
          alignmentBytes: this.engine.historyGpuStorage.alignmentBytes(candidate.slice),
        },
        coldSeed: null,
      },
      nextStorageChunkIndex: storageChunkIndex,
    };
  }

  private async serializeColdPayload(
    candidate: ColdPayloadCandidate,
    writer: CandidateWriter,
    firstStorageChunkIndex: number,
    options: HistoryStorageSpillOptions,
  ): Promise<{ payload: StoredHistoryPayloadV1; nextStorageChunkIndex: number }> {
    const resident = candidate.handle.residentValue();
    if (!resident) throw new Error("Seed History non residente durante lo spill.");
    const chunks: StoredHistoryChunkV1[] = [];
    let storageChunkIndex = firstStorageChunkIndex;
    let rawBytes = 0;
    let storedBytes = 0;
    let sourceHash = 0x811c9dc5;
    const tileByteLength = resident.memoryBytes / resident.tileIndices.length;
    if (!Number.isInteger(tileByteLength) || tileByteLength <= 0) {
      throw new Error("Layout tile del seed History non valido.");
    }
    let compressionClient: Awaited<ReturnType<BrushEngine["requireLayerColdCompressionClient"]>> | null = null;
    try {
      compressionClient = await this.engine.requireLayerColdCompressionClient();
    } catch {
      // Raw is a complete, lossless backend and does not need CompressionStream.
    }
    let payloadChunkIndex = 0;
    for (let firstTile = 0; firstTile < resident.tileIndices.length; firstTile += 4) {
      if (!options.shouldContinue()) throw new Error("Compressione seed History interrotta.");
      const tileCount = Math.min(4, resident.tileIndices.length - firstTile);
      const raw = await this.engine.readLayerColdStorageTiles(
        resident,
        firstTile,
        tileCount,
        `History locale · seed azione ${candidate.ownerActionId}`,
      );
      let chunk: LayerColdCompressedChunk;
      if (compressionClient) {
        try {
          // The compression client transfers its input to a worker. Preserve
          // the authoritative readback so a worker failure can still degrade
          // losslessly to a raw chunk.
          chunk = (await compressionClient.compress(
            raw.slice(),
            tileByteLength,
            resident.format === "rgba16float" ? 2 : 1,
          )).chunk;
        } catch {
          compressionClient.dispose();
          compressionClient = null;
          const hash = historyHash32(raw);
          chunk = {
            storage: "raw",
            bytes: exactArrayBuffer(raw),
            rawBytes: raw.byteLength,
            storedBytes: raw.byteLength,
            sourceHash: hash,
          };
        }
      } else {
        const hash = historyHash32(raw);
        chunk = {
          storage: "raw",
          bytes: exactArrayBuffer(raw),
          rawBytes: raw.byteLength,
          storedBytes: raw.byteLength,
          sourceHash: hash,
        };
      }
      const stored = new Uint8Array(chunk.bytes);
      const storedSha256 = await sha256Bytes(stored);
      const fileOffset = await writer.append(chunk.bytes);
      chunks.push({
        storageChunkIndex,
        payloadChunkIndex,
        fileOffset,
        rawBytes: chunk.rawBytes,
        storedBytes: chunk.storedBytes,
        codec: chunk.storage,
        storedSha256,
        rawHash32: chunk.sourceHash,
      });
      storageChunkIndex += 1;
      payloadChunkIndex += 1;
      rawBytes += chunk.rawBytes;
      storedBytes += chunk.storedBytes;
      sourceHash = combineCompressionHashes(sourceHash, chunk.sourceHash, chunk.rawBytes);
      await yieldBrowserTurn();
    }
    if (rawBytes !== resident.memoryBytes) throw new Error("Seed History letto solo in parte.");
    return {
      payload: {
        payloadId: candidate.payloadId,
        serializerId: "cold-seed-v1",
        kind: "layer-seed",
        ownerActionId: candidate.ownerActionId,
        layerId: candidate.layerId,
        rawBytes,
        storedBytes,
        chunks,
        gpu: null,
        coldSeed: {
          tileIndices: [...resident.tileIndices],
          rawBytes,
          sourceHash,
          generation: resident.generation,
          format: resident.format,
        },
      },
      nextStorageChunkIndex: storageChunkIndex,
    };
  }

  private async beginCandidate(segmentId: string): Promise<CandidateWriter> {
    const sessionId = this.sessionId;
    if (this.backend === "opfs-worker") {
      const opfs = await this.requireOpfs();
      const writerId = await opfs.begin(sessionId, segmentId);
      return {
        backend: "opfs-worker",
        append: async (bytes) => await opfs.append(writerId, bytes),
        finish: async (footerJson) => await opfs.finish(writerId, footerJson),
        abort: async () => {
          await opfs.abort(writerId).catch(() => undefined);
          await opfs.deleteSegment(sessionId, segmentId);
        },
      };
    }
    if (this.backend !== "indexeddb-chunks") {
      throw new Error("Backend History locale non scrivibile.");
    }
    let chunkIndex = 0;
    return {
      backend: "indexeddb-chunks",
      append: async (bytes) => {
        const current = chunkIndex++;
        await this.catalog.putCandidateChunk({
          sessionId,
          segmentId,
          chunkIndex: current,
          bytes,
        });
        return 0;
      },
      finish: async () => undefined,
      abort: async () => {
        await this.catalog.deleteSegmentPayload(sessionId, segmentId);
      },
    };
  }

  private async verifyCandidate(descriptor: HistorySegmentDescriptorV1): Promise<void> {
    const chunks = descriptor.payloads.flatMap((payload) => payload.chunks);
    if (descriptor.backend === "opfs-worker") {
      const opfs = await this.requireOpfs();
      await opfs.verify({
        sessionId: descriptor.sessionId,
        segmentId: descriptor.segmentId,
        commitNonce: descriptor.commitNonce,
        descriptorSha256: descriptor.descriptorSha256,
        chunks,
      });
      return;
    }
    for (const chunk of chunks) {
      const bytes = await this.catalog.readChunk(
        descriptor.sessionId,
        descriptor.segmentId,
        chunk.storageChunkIndex,
      );
      if (bytes.byteLength !== chunk.storedBytes) {
        throw new Error("Chunk IndexedDB History con lunghezza errata.");
      }
      if (await sha256Bytes(new Uint8Array(bytes)) !== chunk.storedSha256) {
        throw new Error("Hash chunk IndexedDB History non valido.");
      }
    }
  }

  private nextManifest(
    segment: HistorySegmentDescriptorV1,
    logicalFloorCursor: number,
  ): HistoryManifestV1 {
    return {
      magic: "M1M4_HISTORY_MANIFEST",
      version: HISTORY_LOCAL_STORAGE_SCHEMA_VERSION,
      sessionId: this.sessionId,
      instanceId: this.instanceId,
      branchId: this.branchId,
      generation: this.manifestGeneration + 1,
      parentGeneration: this.manifestGeneration === 0 ? null : this.manifestGeneration,
      journalEpoch: this.journalEpoch,
      ownershipEpoch: this.ownershipEpoch + 1,
      journalLength: this.engine.historyActions.length,
      headActionId: this.engine.historyActions.at(-1)?.id ?? null,
      logicalFloorCursor: Math.max(0, Math.trunc(logicalFloorCursor)),
      logicalCeilingCursor: this.engine.historyActions.length,
      segmentIds: [...this.segments.keys(), segment.segmentId],
      committedBytes: this.committedBytes + segment.storedBytes,
      documentFingerprint: this.fingerprint(),
      commitMarker: "COMMITTED",
    };
  }

  private nextManifestAfterSegmentRemoval(
    segment: HistorySegmentDescriptorV1,
  ): HistoryManifestV1 {
    return {
      magic: "M1M4_HISTORY_MANIFEST",
      version: HISTORY_LOCAL_STORAGE_SCHEMA_VERSION,
      sessionId: this.sessionId,
      instanceId: this.instanceId,
      branchId: this.branchId,
      generation: this.manifestGeneration + 1,
      parentGeneration: this.manifestGeneration === 0 ? null : this.manifestGeneration,
      journalEpoch: this.journalEpoch,
      ownershipEpoch: this.ownershipEpoch + 1,
      journalLength: this.engine.historyActions.length,
      headActionId: this.engine.historyActions.at(-1)?.id ?? null,
      logicalFloorCursor: this.manifestLogicalFloorCursor,
      logicalCeilingCursor: this.engine.historyActions.length,
      segmentIds: [...this.segments.keys()].filter((id) => id !== segment.segmentId),
      committedBytes: Math.max(0, this.committedBytes - segment.storedBytes),
      documentFingerprint: this.fingerprint(),
      commitMarker: "COMMITTED",
    };
  }

  private fingerprint(): HistoryDocumentFingerprintV1 {
    return {
      layerSize: LAYER_SIZE,
      layerFormat: this.engine.layerFormat,
      stampStrideBytes: STAMP_STRIDE_BYTES,
      journalStrategy: HISTORY_JOURNAL_STRATEGY,
      retentionStrategy: HISTORY_RETENTION_STRATEGY,
      segmentSchemaVersion: 1,
      codecVersion: 1,
      engineBuildId: "history-local-bounded-hot-streaming-v3",
    };
  }

  private collectPayloadCandidates(): HistoryPayloadCandidate[] {
    this.wrapAllHistorySeeds();
    const actionIndexById = new Map(
      this.engine.historyActions.map((action, index) => [action.id, index]),
    );
    const gpuById = new Map<number, GpuPayloadCandidate>();
    const addGpu = (
      slice: GpuHistorySlice,
      kind: GpuPayloadCandidate["kind"],
      ownerActionId: number,
      layerId: number | null,
    ): void => {
      const cursor = actionIndexById.get(ownerActionId);
      if (cursor === undefined || !this.engine.historyGpuStorage.contains(slice)) return;
      const stableOwnerActionId = this.gpuStableOwnerActionIds.get(slice.id) ?? ownerActionId;
      this.gpuStableOwnerActionIds.set(slice.id, stableOwnerActionId);
      const existing = gpuById.get(slice.id);
      if (existing && existing.ownerCursor >= cursor) return;
      gpuById.set(slice.id, {
        storage: "gpu",
        payloadId: gpuPayloadId(slice.id),
        kind,
        ownerActionId: stableOwnerActionId,
        ownerCursor: cursor,
        layerId,
        rawBytes: slice.logicalBytes,
        slice,
      });
    };
    for (const batch of this.engine.historyBatches) {
      addGpu(
        batch.gpuSlice,
        batch.kind === "paint" ? "paint-gpu" : batch.kind === "blend" ? "blend-gpu" : "fill-gpu",
        batch.actionId,
        batch.layerId,
      );
      if (batch.kind === "paint" && batch.selectionMask) {
        addGpu(batch.selectionMask.gpuSlice, "selection-mask-gpu", batch.actionId, null);
      }
    }
    for (const [actionId, snapshot] of this.engine.selectionHistoryMasksByAction) {
      addGpu(snapshot.gpuSlice, "selection-mask-gpu", actionId, null);
    }
    for (const action of this.engine.historyActions) {
      if (action.kind !== "raster-transform") continue;
      for (const snapshot of [action.selectionBefore, action.selectionAfter]) {
        if (snapshot) addGpu(snapshot.gpuSlice, "selection-mask-gpu", action.id, null);
      }
    }
    const cold: ColdPayloadCandidate[] = [];
    for (const handle of this.coldHandles.values()) {
      const ownerCursor = actionIndexById.get(handle.ownerActionId);
      if (ownerCursor === undefined || handle.retired) continue;
      cold.push({
        storage: "cold",
        payloadId: handle.payloadId,
        kind: "layer-seed",
        ownerActionId: handle.ownerActionId,
        ownerCursor,
        layerId: handle.layerId,
        rawBytes: handle.memoryBytes,
        handle,
      });
    }
    return [...gpuById.values(), ...cold];
  }

  private demoteStoredResidentCaches(options: HistoryStorageSpillOptions): boolean {
    if (!options.shouldContinue() || this.engine.historyCursor !== this.engine.historyActions.length) {
      return false;
    }
    const policy = this.residentHotWindowPolicy(
      this.collectPayloadCandidates(),
      options.highWaterBytes,
    );
    const candidates = policy.unprotected.filter((candidate) =>
      this.storedPayloads.has(candidate.payloadId)
    );
    if (candidates.length === 0) return false;
    const gpuSlices = candidates.flatMap((candidate) =>
      candidate.storage === "gpu" ? [candidate.slice] : []
    );
    const prepared = this.engine.historyGpuStorage.prepareDemoteMany(gpuSlices);
    prepared.commitNoThrow();
    for (const candidate of candidates) {
      if (candidate.storage !== "cold") continue;
      const resident = candidate.handle.demoteResidentNoThrow();
      try {
        resident?.texture.destroy();
      } catch {
        // Stored authority remains valid.
      }
    }
    this.engine.selectionHistoryClipBindGroups.clear();
    this.ownershipEpoch += 1;
    return true;
  }

  private createPayloadRequirementCollector(): HistoryPayloadRequirementCollector {
    const candidates = this.collectPayloadCandidates();
    const byGpuId = new Map(
      candidates.flatMap((candidate) => candidate.storage === "gpu"
        ? [[candidate.slice.id, candidate] as const]
        : []),
    );
    const byColdId = new Map(
      candidates.flatMap((candidate) => candidate.storage === "cold"
        ? [[candidate.payloadId, candidate] as const]
        : []),
    );
    const required = new Map<string, HistoryPayloadCandidate>();
    const addSlice = (slice: GpuHistorySlice): void => {
      const candidate = byGpuId.get(slice.id);
      if (candidate) required.set(candidate.payloadId, candidate);
    };
    const addSnapshot = (snapshot: SelectionHistoryMaskSnapshot | null): void => {
      if (snapshot) addSlice(snapshot.gpuSlice);
    };
    const addSeed = (seed: LayerColdStorageResources | null): void => {
      if (!seed || !isHistoryColdSeedHandle(seed)) return;
      const candidate = byColdId.get(seed.payloadId);
      if (candidate) required.set(candidate.payloadId, candidate);
    };
    return { required, addSlice, addSnapshot, addSeed };
  }

  private addRasterReplayRequirements(
    collector: HistoryPayloadRequirementCollector,
    layerId: number,
    cursors: readonly number[],
  ): void {
    for (const cursor of cursors) {
      const periodicSelection = periodicCheckpointChainForReplay(
        this.engine,
        layerId,
        cursor,
      );
      const replay = planRasterHistoryReplay({
        actions: this.engine.historyActions,
        cursor,
        batches: this.engine.historyBatches,
        layerId,
        periodicSelection,
      });
      if (replay.seedAction) collector.addSeed(replay.seedAction.seed);
      for (const checkpoint of replay.periodicChain) collector.addSeed(checkpoint.seed);
      for (const batch of replay.batches) {
        collector.addSlice(batch.gpuSlice);
        if (batch.kind === "paint") collector.addSnapshot(batch.selectionMask);
      }
    }
  }

  private payloadsRequiredForRasterReplay(
    layerId: number,
    cursors: readonly number[],
  ): HistoryPayloadCandidate[] {
    const collector = this.createPayloadRequirementCollector();
    this.addRasterReplayRequirements(collector, layerId, cursors);
    return [...collector.required.values()];
  }

  private payloadsRequiredForStep(delta: -1 | 1): HistoryPayloadCandidate[] {
    const collector = this.createPayloadRequirementCollector();
    const { required, addSnapshot, addSeed } = collector;
    const previousCursor = this.engine.historyCursor;
    const nextCursor = previousCursor + delta;
    const crossed = delta < 0
      ? this.engine.historyActions[previousCursor - 1]
      : this.engine.historyActions[previousCursor];
    if (!crossed) return [];

    if (
      crossed.kind === "raster-transform"
      || crossed.kind === "raster-filter"
      || crossed.kind === "layer-add"
      || (delta > 0 && (
        crossed.kind === "vector-rasterize"
        || crossed.kind === "raster-import"
      ))
    ) {
      addSeed(crossed.seed);
    } else if (crossed.kind === "layer-delete") {
      for (const entry of crossed.entries) addSeed(entry.seed);
    } else if (crossed.kind === "layer-merge") {
      if (delta < 0) {
        for (const input of crossed.inputs) {
          if (input.kind === "raster") addSeed(input.entry.seed);
        }
      } else {
        addSeed(crossed.output.seed);
      }
    }
    if (crossed.kind === "raster-transform") {
      addSnapshot(crossed.selectionBefore);
      addSnapshot(crossed.selectionAfter);
    }

    if (
      crossed.kind === "stroke"
      || crossed.kind === "fill"
      || crossed.kind === "clear"
      || crossed.kind === "raster-transform"
      || crossed.kind === "raster-filter"
    ) {
      this.addRasterReplayRequirements(
        collector,
        crossed.layerId,
        [previousCursor, nextCursor],
      );
    }
    return [...required.values()];
  }

  private wrapAllHistorySeeds(): void {
    for (const action of this.engine.historyActions) {
      if (
        action.kind === "vector-rasterize"
        || action.kind === "raster-import"
        || action.kind === "layer-add"
        || action.kind === "raster-transform"
        || action.kind === "raster-filter"
      ) {
        if (action.seed) action.seed = this.wrapSeed(action.seed, action.id, action.layerId);
      } else if (action.kind === "layer-delete") {
        for (const entry of action.entries) {
          if (entry.seed) entry.seed = this.wrapSeed(
            entry.seed,
            action.id,
            entry.layerRecord.id,
          );
        }
      } else if (action.kind === "layer-merge") {
        for (const input of action.inputs) {
          if (input.kind !== "raster" || !input.entry.seed) continue;
          input.entry.seed = this.wrapSeed(
            input.entry.seed,
            action.id,
            input.entry.layerRecord.id,
          );
        }
        if (action.output.seed) {
          action.output.seed = this.wrapSeed(
            action.output.seed,
            action.id,
            action.output.layerRecord.id,
          );
        }
      }
    }
    for (const checkpoint of periodicHistoryCheckpoints(this.engine)) {
      if (checkpoint.seed) {
        checkpoint.seed = this.wrapSeed(
          checkpoint.seed,
          checkpoint.afterActionId,
          checkpoint.layerId,
        );
      }
    }
  }

  private wrapSeed(
    seed: LayerColdStorageResources,
    ownerActionId: number,
    layerId: number,
  ): HistoryColdSeedHandle {
    if (isHistoryColdSeedHandle(seed)) return seed;
    const existing = this.rawSeedHandles.get(seed);
    if (existing) return existing;
    const payloadId = `cold-${this.nextColdPayloadId++}`;
    const handle = createHistoryColdSeedHandle({
      payloadId,
      ownerActionId,
      layerId,
      seed,
      onRetire: (retired) => {
        this.coldHandles.delete(retired.payloadId);
        this.retireStoredPayload(retired.payloadId);
      },
    });
    this.rawSeedHandles.set(seed, handle);
    this.coldHandles.set(payloadId, handle);
    return handle;
  }

  private async hydrateGpuPayloadFromStorage(
    location: StoredPayloadLocation,
    slice: GpuHistorySlice,
    assertCurrent: () => void,
  ): Promise<void> {
    const payload = location.payload;
    if (payload.rawBytes > HISTORY_STORAGE_MAXIMUM_DESCRIPTOR_BYTES) {
      throw new Error("Payload History troppo grande.");
    }
    if (payload.rawBytes !== slice.logicalBytes) {
      throw new Error("Payload History GPU incompatibile con la slice destinazione.");
    }
    const hydration = this.engine.historyGpuStorage.beginHydration(slice);
    let payloadOffset = 0;
    try {
      for (const chunk of [...payload.chunks].sort(
        (left, right) => left.payloadChunkIndex - right.payloadChunkIndex,
      )) {
        assertCurrent();
        if (chunk.codec !== "raw") {
          throw new Error("Codec compresso inatteso per una slice GPU History.");
        }
        const bytes = new Uint8Array(await this.readStoredChunk(location.segment, chunk));
        assertCurrent();
        await verifyStoredChunk(bytes, chunk);
        assertCurrent();
        if (historyHash32(bytes) !== chunk.rawHash32) {
          throw new Error("Hash raw della slice History non valido.");
        }
        if (payloadOffset + bytes.byteLength > payload.rawBytes) {
          throw new Error("Chunk slice History oltre la lunghezza dichiarata.");
        }
        for (let sourceOffset = 0; sourceOffset < bytes.byteLength;) {
          const length = Math.min(
            GPU_HISTORY_HYDRATION_CHUNK_BYTES,
            bytes.byteLength - sourceOffset,
          );
          hydration.writeChunk(payloadOffset, bytes, sourceOffset, length);
          sourceOffset += length;
          payloadOffset += length;
        }
      }
      if (payloadOffset !== payload.rawBytes) {
        throw new Error("Payload slice History incompleto.");
      }
      assertCurrent();
      hydration.commit();
    } catch (error) {
      hydration.rollbackNoThrow();
      throw error;
    }
  }

  private async restoreColdSeedFromStorage(
    location: StoredPayloadLocation,
    ownerActionId: number,
    assertCurrent: () => void,
  ): Promise<LayerColdStorageResources> {
    const metadata = this.coldSeedMetadata(location);
    return await restoreColdStorageResourcesFromChunkStream(this.engine, {
      tileIndices: [...metadata.tileIndices],
      rawBytes: metadata.rawBytes,
      sourceHash: metadata.sourceHash,
      generation: metadata.generation,
      format: metadata.format,
    }, this.readColdSeedChunksFromStorage(
      location,
      assertCurrent,
    ), `Hydrate History locale · azione ${ownerActionId}`);
  }

  private coldSeedMetadata(location: StoredPayloadLocation) {
    const metadata = location.payload.coldSeed;
    if (!metadata) throw new Error("Metadata cold seed History assenti.");
    if (
      metadata.rawBytes !== location.payload.rawBytes
      || location.payload.rawBytes > HISTORY_STORAGE_MAXIMUM_DESCRIPTOR_BYTES
    ) {
      throw new Error("Dimensione cold seed History non valida.");
    }
    return metadata;
  }

  private async *readColdSeedChunksFromStorage(
    location: StoredPayloadLocation,
    assertCurrent: () => void,
  ): AsyncGenerator<LayerColdCompressedChunk> {
    const descriptors = [...location.payload.chunks].sort(
      (left, right) => left.payloadChunkIndex - right.payloadChunkIndex,
    );
    let storedBytes = 0;
    for (const descriptor of descriptors) {
      assertCurrent();
      const bytes = new Uint8Array(
        await this.readStoredChunk(location.segment, descriptor),
      );
      assertCurrent();
      await verifyStoredChunk(bytes, descriptor);
      assertCurrent();
      storedBytes += descriptor.storedBytes;
      // The ArrayBuffer is owned by this one-shot stream. The decompressor may
      // release it as soon as the corresponding GPU upload is queued.
      yield {
        storage: descriptor.codec,
        bytes: exactArrayBuffer(bytes),
        rawBytes: descriptor.rawBytes,
        storedBytes: descriptor.storedBytes,
        sourceHash: descriptor.rawHash32,
      };
    }
    if (storedBytes !== location.payload.storedBytes) {
      throw new Error("Cold seed History incompleto.");
    }
  }

  private async readStoredChunk(
    segment: HistorySegmentDescriptorV1,
    chunk: StoredHistoryChunkV1,
  ): Promise<ArrayBuffer> {
    if (segment.backend === "indexeddb-chunks") {
      return await this.catalog.readChunk(
        segment.sessionId,
        segment.segmentId,
        chunk.storageChunkIndex,
      );
    }
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const opfs = await this.requireOpfs(attempt > 0);
        return await opfs.read(
          segment.sessionId,
          segment.segmentId,
          chunk.fileOffset,
          chunk.storedBytes,
        );
      } catch (error) {
        lastError = error;
        this.opfs?.dispose();
        this.opfs = null;
      }
    }
    throw new Error(`Lettura OPFS History fallita: ${errorMessage(lastError)}.`);
  }

  private async requireOpfs(recreate = false): Promise<HistoryOpfsClient> {
    if (recreate && this.opfs) {
      this.opfs.dispose();
      this.opfs = null;
    }
    if (!this.opfs) {
      // The backend was capability-tested when the session was initialized.
      // Recreated workers must be allowed to read/delete already committed
      // data even when quota is full and a write-based self-test would fail.
      this.opfs = new HistoryOpfsClient();
    }
    return this.opfs;
  }

  private captureToken(): SpillToken {
    return {
      sessionId: this.sessionId,
      branchId: this.branchId,
      operationEpoch: this.operationEpoch,
      cursor: this.engine.historyCursor,
      actionsLength: this.engine.historyActions.length,
      actionsTail: this.engine.historyActions.at(-1) ?? null,
    };
  }

  private assertToken(token: SpillToken): void {
    if (!this.tokenIsCurrent(token)) {
      throw new Error("Operazione History locale diventata stale.");
    }
  }

  private tokenIsCurrent(token: SpillToken): boolean {
    return !(
      token.sessionId !== this.sessionId
      || token.branchId !== this.branchId
      || token.operationEpoch !== this.operationEpoch
      || token.cursor !== this.engine.historyCursor
      || token.actionsLength !== this.engine.historyActions.length
      || token.actionsTail !== (this.engine.historyActions.at(-1) ?? null)
    );
  }

  private sessionIsCurrent(sessionId: string): boolean {
    return !this.destroyed && sessionId === this.sessionId;
  }

  private resetSpillFailureCircuit(): void {
    this.consecutiveSpillFailures = 0;
    this.lastSpillFailureSignature = null;
  }

  private markSegmentGarbageIfDead(segment: HistorySegmentDescriptorV1): void {
    if (segment.payloads.every((payload) => !this.storedPayloads.has(payload.payloadId))) {
      this.garbageSegmentIds.add(segment.segmentId);
    }
  }

  private async collectGarbageSegments(shouldContinue: () => boolean): Promise<void> {
    for (const segmentId of [...this.garbageSegmentIds]) {
      if (!shouldContinue()) return;
      const segment = this.segments.get(segmentId);
      if (!segment) {
        this.garbageSegmentIds.delete(segmentId);
        continue;
      }
      if (segment.payloads.some((payload) => this.storedPayloads.has(payload.payloadId))) {
        this.garbageSegmentIds.delete(segmentId);
        continue;
      }
      const nextManifest = this.nextManifestAfterSegmentRemoval(segment);
      const gcSessionId = this.sessionId;
      try {
        await this.catalog.removeSegmentCAS({
          sessionId: gcSessionId,
          segmentId,
          expectedManifestGeneration: this.manifestGeneration,
          nextManifest,
        });
      } catch (error) {
        this.lastError = errorMessage(error);
        return;
      }
      if (gcSessionId !== this.sessionId || this.destroyed) return;
      this.manifestGeneration = nextManifest.generation;
      this.manifestLogicalFloorCursor = nextManifest.logicalFloorCursor;
      this.committedBytes = nextManifest.committedBytes;
      this.segments.delete(segmentId);
      this.garbageSegmentIds.delete(segmentId);
      this.ownershipEpoch += 1;
      if (segment.backend === "opfs-worker") {
        try {
          const opfs = await this.requireOpfs();
          await opfs.deleteSegment(segment.sessionId, segmentId);
        } catch {
          this.queueOpfsGarbageCandidate(segment.sessionId, segmentId);
        }
      }
      if (this.backend !== "memory-only") this.writable = true;
    }
  }

  private retireStoredPayload(payloadId: string): void {
    const gpuId = gpuSliceIdFromPayloadId(payloadId);
    if (gpuId !== null) this.gpuStableOwnerActionIds.delete(gpuId);
    const location = this.storedPayloads.get(payloadId);
    if (!location || !this.storedPayloads.delete(payloadId)) return;
    // Immutable segments are reclaimed only when every payload they contain is
    // unreachable. Partially live segments remain byte-identical.
    this.markSegmentGarbageIfDead(location.segment);
  }

  private async maybeRequestPersistence(): Promise<void> {
    if (
      this.persistenceRequested
      || this.committedBytes < PERSIST_REQUEST_THRESHOLD_BYTES
      || typeof navigator.storage?.persist !== "function"
    ) {
      return;
    }
    this.persistenceRequested = true;
    try {
      this.persistenceGranted = await navigator.storage.persist();
    } catch {
      this.persistenceGranted = false;
    }
  }

  private startHeartbeat(sessionId: string): void {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      void this.catalog.touchSession(sessionId, SESSION_LEASE_MS).catch(() => undefined);
    }, SESSION_HEARTBEAT_MS);
  }

  private async waitForStorageIdle(): Promise<void> {
    while (this.storageBusy !== "idle") {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 10));
    }
  }

  private async acquireSessionLock(sessionId: string): Promise<boolean> {
    this.releaseSessionLock();
    const locks = optionalLockManager();
    if (!locks) return false;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.sessionLockRelease = release;
    const acquired = await new Promise<boolean>((resolve) => {
      void locks.request(
        sessionLockName(sessionId),
        { mode: "exclusive", ifAvailable: true },
        async (lock) => {
          if (!lock) {
            resolve(false);
            return;
          }
          resolve(true);
          await held;
        },
      ).catch(() => resolve(false));
    });
    if (!acquired) {
      if (this.sessionLockRelease === release) this.sessionLockRelease = null;
      release();
    }
    return acquired;
  }

  private releaseSessionLock(): void {
    const release = this.sessionLockRelease;
    this.sessionLockRelease = null;
    release?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer === null) return;
    window.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private async cleanupOrphanedSessions(activeSessionId: string): Promise<void> {
    const locks = optionalLockManager();
    const candidates = await this.catalog.cleanupCandidatesExcept(activeSessionId).catch(() => []);
    const now = Date.now();
    for (const candidate of candidates) {
      const leaseExpired = candidate.leaseExpiresAt <= now;
      // Without Web Locks, or when the originating tab never confirmed that it
      // held one, a long renewable lease is the conservative liveness signal.
      if (!locks) {
        if (leaseExpired) await this.deleteSessionBestEffort(candidate.sessionId);
        continue;
      }
      if (!candidate.lockProtected && !leaseExpired) continue;
      let lockRequestFailed = false;
      await locks.request(
        sessionLockName(candidate.sessionId),
        { mode: "exclusive", ifAvailable: true },
        async (lock) => {
          if (lock) await this.deleteSessionBestEffort(candidate.sessionId);
        },
      ).catch(() => {
        lockRequestFailed = true;
      });
      // Some embedded/Safari contexts expose navigator.locks but reject every
      // request. In that case only the already-expired conservative lease may
      // authorize cleanup; lock=null still means another live tab owns it.
      if (lockRequestFailed && leaseExpired) {
        await this.deleteSessionBestEffort(candidate.sessionId);
      }
    }
  }

  private queueOpfsGarbageCandidate(sessionId: string, segmentId: string): void {
    this.opfsGarbageCandidates.set(`${sessionId}:${segmentId}`, { sessionId, segmentId });
  }

  private async cleanupOpfsGarbageCandidates(): Promise<void> {
    for (const [key, candidate] of [...this.opfsGarbageCandidates]) {
      // Use a fresh worker and issue the deletion directly. A failed writer's
      // client may be disposed, and cleanup must not require a quota-consuming
      // write probe before it can free space.
      const opfs = new HistoryOpfsClient();
      try {
        await opfs.deleteSegment(candidate.sessionId, candidate.segmentId);
        this.opfsGarbageCandidates.delete(key);
      } catch {
        // Keep the in-memory tombstone and retry during the next idle pass.
      } finally {
        opfs.dispose();
      }
    }
  }

  private async deleteSessionBestEffort(sessionId: string): Promise<void> {
    const opfsMayExist = await this.catalog.sessionMayUseOpfs(sessionId).catch(() => true);
    let opfsReclaimed = !opfsMayExist;
    if (opfsMayExist) {
      const opfs = new HistoryOpfsClient();
      try {
        // Deletion is useful precisely when quota is exhausted, so it must not
        // be gated by the write-based OPFS self-test.
        await opfs.deleteSession(sessionId);
        opfsReclaimed = true;
      } catch {
        // Keep the IDB session record as a tombstone: it is the only durable
        // index that lets a future startup retry OPFS cleanup.
      } finally {
        opfs.dispose();
      }
    }
    if (opfsReclaimed) {
      await this.catalog.deleteSession(sessionId).catch(() => undefined);
      for (const [key, candidate] of this.opfsGarbageCandidates) {
        if (candidate.sessionId === sessionId) this.opfsGarbageCandidates.delete(key);
      }
    }
  }
}

async function* readGpuHistorySliceChunks(
  engine: BrushEngine,
  slice: GpuHistorySlice,
  maximumLogicalChunkBytes: number,
): AsyncGenerator<Uint8Array> {
  if (!engine.historyGpuStorage.isResident(slice)) {
    throw new Error(`Slice History ${slice.id} non residente per il readback.`);
  }
  let logicalOffset = 0;
  while (logicalOffset < slice.logicalBytes) {
    const logicalChunkBytes = Math.min(
      maximumLogicalChunkBytes,
      slice.logicalBytes - logicalOffset,
    );
    const copyBytes = align4(logicalChunkBytes);
    if (logicalOffset + copyBytes > slice.reservedBytes) {
      throw new Error("Readback History oltre i byte riservati della slice.");
    }
    const staging = engine.device.createBuffer({
      label: `Readback History slice ${slice.id} @${logicalOffset}`,
      size: copyBytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    try {
      const encoder = engine.device.createCommandEncoder({
        label: `Readback History slice ${slice.id}`,
      });
      encoder.copyBufferToBuffer(
        slice.buffer,
        slice.offsetBytes + logicalOffset,
        staging,
        0,
        copyBytes,
      );
      engine.device.queue.submit([encoder.finish()]);
      await Promise.race([
        staging.mapAsync(GPUMapMode.READ),
        timeoutReject(60_000, "Timeout readback slice History."),
      ]);
      yield new Uint8Array(staging.getMappedRange(), 0, logicalChunkBytes).slice();
    } finally {
      if (staging.mapState === "mapped") staging.unmap();
      staging.destroy();
    }
    logicalOffset += logicalChunkBytes;
  }
}

function assertSegmentDescriptor(
  descriptor: HistorySegmentDescriptorV1,
  fingerprint: HistoryDocumentFingerprintV1,
): void {
  if (
    descriptor.magic !== HISTORY_LOCAL_STORAGE_SEGMENT_MAGIC
    || descriptor.version !== 1
    || descriptor.commitMarker !== HISTORY_LOCAL_STORAGE_COMMIT_MAGIC
    || canonicalHistoryJson(descriptor.documentFingerprint) !== canonicalHistoryJson(fingerprint)
  ) {
    throw new Error("Descriptor History locale incompatibile.");
  }
  if (
    descriptor.payloads.length > MAX_DESCRIPTOR_PAYLOADS
    || descriptor.chunkCount > MAX_DESCRIPTOR_CHUNKS
    || descriptor.rawBytes < 0
    || descriptor.rawBytes > HISTORY_STORAGE_MAXIMUM_DESCRIPTOR_BYTES
    || descriptor.storedBytes < 0
    || descriptor.storedBytes > HISTORY_STORAGE_MAXIMUM_DESCRIPTOR_BYTES
  ) {
    throw new Error("Descriptor History locale oltre i limiti ammessi.");
  }
  const payloadIds = new Set<string>();
  const chunkIndexes = new Set<number>();
  for (const payload of descriptor.payloads) {
    if (payloadIds.has(payload.payloadId)) throw new Error("Payload History duplicato.");
    payloadIds.add(payload.payloadId);
    let expectedPayloadChunk = 0;
    for (const chunk of payload.chunks) {
      if (
        chunk.payloadChunkIndex !== expectedPayloadChunk
        || chunkIndexes.has(chunk.storageChunkIndex)
        || chunk.rawBytes <= 0
        || chunk.storedBytes <= 0
      ) {
        throw new Error("Indice chunk History non valido.");
      }
      expectedPayloadChunk += 1;
      chunkIndexes.add(chunk.storageChunkIndex);
    }
  }
  if (chunkIndexes.size !== descriptor.chunkCount) {
    throw new Error("Conteggio chunk History incoerente.");
  }
}

function assertStoredPayloadCompatible(
  payload: StoredHistoryPayloadV1,
  candidate: HistoryPayloadCandidate,
): void {
  if (
    payload.payloadId !== candidate.payloadId
    || payload.kind !== candidate.kind
    || payload.ownerActionId !== candidate.ownerActionId
    || payload.rawBytes !== candidate.rawBytes
    || payload.layerId !== candidate.layerId
  ) {
    throw new Error("Payload History locale non corrisponde alla risorsa richiesta.");
  }
  if (candidate.storage === "gpu") {
    if (
      payload.serializerId !== "opaque-gpu-v1"
      || payload.gpu?.logicalBytes !== candidate.slice.logicalBytes
      || payload.coldSeed !== null
    ) {
      throw new Error("ABI della slice History locale incompatibile.");
    }
  } else if (
    payload.serializerId !== "cold-seed-v1"
    || payload.coldSeed?.format !== candidate.handle.format
    || payload.coldSeed.generation !== candidate.handle.generation
    || payload.coldSeed.tileIndices.length !== candidate.handle.tileIndices.length
    || payload.coldSeed.tileIndices.some(
      (tile, index) => tile !== candidate.handle.tileIndices[index],
    )
  ) {
    throw new Error("ABI del seed History locale incompatibile.");
  }
}

async function verifyStoredChunk(bytes: Uint8Array, chunk: StoredHistoryChunkV1): Promise<void> {
  if (bytes.byteLength !== chunk.storedBytes) {
    throw new Error("Lunghezza chunk History locale non valida.");
  }
  if (await sha256Bytes(bytes) !== chunk.storedSha256) {
    throw new Error("Hash stored del chunk History locale non valido.");
  }
}

function gpuPayloadId(sliceId: number): string {
  return `gpu-${sliceId}`;
}

function gpuSliceIdFromPayloadId(payloadId: string): number | null {
  const match = /^gpu-(\d+)$/.exec(payloadId);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) ? id : null;
}

function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function optionalLockManager(): LockManager | null {
  return (navigator as Navigator & { readonly locks?: LockManager }).locks ?? null;
}

function sessionLockName(sessionId: string): string {
  return `m1m4-history-session:${sessionId}`;
}

function align4(value: number): number {
  return Math.ceil(value / 4) * 4;
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (
    bytes.buffer instanceof ArrayBuffer
    && bytes.byteOffset === 0
    && bytes.byteLength === bytes.buffer.byteLength
  ) {
    return bytes.buffer;
  }
  return bytes.slice().buffer as ArrayBuffer;
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const source = exactArrayBuffer(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", source));
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256Text(value: string): Promise<string> {
  return await sha256Bytes(new TextEncoder().encode(value));
}

function timeoutReject(delayMs: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    window.setTimeout(() => reject(new Error(message)), delayMs);
  });
}

function yieldBrowserTurn(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function formatMiB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1).replace(".", ",");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorName(error: unknown): string {
  const name = (error as { readonly name?: unknown } | null)?.name;
  return typeof name === "string" ? name : "Error";
}

function isQuotaError(error: unknown): boolean {
  const record = error as { readonly name?: unknown; readonly message?: unknown } | null;
  const name = typeof record?.name === "string" ? record.name : "";
  const message = typeof record?.message === "string" ? record.message : String(error);
  return name === "QuotaExceededError" || /quota exceeded|quotaexceeded/i.test(message);
}

function isStorageBackendFailure(error: unknown): boolean {
  if (isQuotaError(error)) return false;
  const message = errorMessage(error);
  return /OPFS|worker|sync access|file|handle/i.test(message);
}
