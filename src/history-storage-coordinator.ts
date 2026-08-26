import {
  destroyLayerColdStorage,
} from "./engine-cold-storage";
import type {
  LayerColdStorageResources,
  LayerCompressedColdStorageResources,
} from "./engine-layer-resources";
import type {
  HistoryAction,
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
  historyStorageMaximumSegmentBytes,
  historyStorageTargetSegmentBytes,
  planHistoryStorageSegment,
  HISTORY_LOCAL_STORAGE_COMMIT_MAGIC,
  HISTORY_LOCAL_STORAGE_SCHEMA_VERSION,
  HISTORY_LOCAL_STORAGE_SEGMENT_MAGIC,
  type HistoryDocumentFingerprintV1,
  type HistoryManifestV1,
  type HistorySegmentPlan,
  type HistorySegmentDescriptorV1,
  type HistoryStorageBackendKind,
  type StoredHistoryChunkV1,
  type StoredHistoryPayloadKind,
  type StoredHistoryPayloadV1,
} from "./history-storage-core";
import { HistoryStorageCatalog } from "./history-storage-idb";
import { HistoryOpfsClient } from "./history-storage-opfs-client";
import type { GpuHistorySlice } from "./gpu-history-storage";
import {
  HISTORY_RETENTION_STRATEGY,
} from "./history-retention-core";
import {
  DOCUMENT_HEIGHT,
  DOCUMENT_MAX_EDGE,
  DOCUMENT_WIDTH,
  MOBILE_DEVICE_CLASS,
  STAMP_STRIDE_BYTES,
} from "./engine-limits";
import { combineCompressionHashes } from "./engine-math";
import type { LayerColdCompressedChunk } from "./layer-cold-compression-client";
import { planRasterHistoryReplay } from "./history-replay-plan";
import type { HistoryStorageHost } from "./history-host";

const SESSION_LEASE_MS = 24 * 60 * 60_000;
const SESSION_HEARTBEAT_MS = 60_000;
const PERSIST_REQUEST_THRESHOLD_BYTES = 32 * 1024 * 1024;
const MAX_DESCRIPTOR_PAYLOADS = 16_384;
const MAX_DESCRIPTOR_CHUNKS = 131_072;
const MAX_DESCRIPTOR_BYTES = 2 * 1024 * 1024 * 1024;
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
  private readonly host: HistoryStorageHost;
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

  constructor(host: HistoryStorageHost) {
    this.host = host;
    this.initializePromise = this.initializeSession();
  }

  telemetry(): HistoryLocalStorageTelemetry {
    const storedOnlyPayloads = [...this.storedPayloads.keys()].filter((payloadId) => {
      const gpuId = gpuSliceIdFromPayloadId(payloadId);
      if (gpuId !== null) {
        const slice = this.host.gpuStorage.sliceById(gpuId);
        return !slice || !this.host.gpuStorage.isResident(slice);
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
    this.prepareBranchCut()();
  }

  /**
   * Prepares the only fallible part (the fresh UUID) before a journal
   * transaction mutates CPU state. The returned closure performs synchronous,
   * non-allocating publication after action and payload insertion succeeded.
   */
  prepareBranchCut(): () => void {
    const nextBranchId = makeId("b");
    return () => {
      this.operationEpoch += 1;
      this.journalEpoch += 1;
      this.branchId = nextBranchId;
      this.diskBudgetBlockedActionIds.clear();
      this.resetSpillFailureCircuit();
    };
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
    if (!this.writable) return false;
    this.wrapAllHistorySeeds();
    let changed = this.demoteStoredResidentCaches(options);
    if (changed) {
      options.afterResidenceChange();
      this.host.gpuStorage.trimEmptyPages(true);
    }
    for (let segmentCount = 0; segmentCount < 4; segmentCount += 1) {
      if (
        options.currentResidentBytes() <= options.highWaterBytes
        || !options.shouldContinue()
      ) {
        break;
      }
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
        this.host.gpuStorage.trimEmptyPages(true);
        continue;
      }
      if (result === "budget-skip") continue;
      // An OPFS runtime failure degrades new writes to IDB. Retry the same
      // resident payload once rather than letting byte eviction run first.
      if (result === "backend-fallback" && beforeBackend !== this.backend) continue;
      break;
    }
    if (!options.shouldContinue()) this.host.resumeMaintenance();
    return changed;
  }

  shouldDeferJournalEviction(options: HistoryStorageSpillOptions): boolean {
    if (
      options.currentResidentBytes() <= options.highWaterBytes
      || this.destroyed
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

  /** Hydrates target and rollback dependencies before moveHistoryCursor mutates the cursor. */
  async prepareHistoryStep(delta: -1 | 1): Promise<void> {
    // A user gesture invalidates background maintenance synchronously. Give a
    // running spill the chance to publish or abort. Dependencies must be
    // collected only afterwards: a payload that was resident on entry may
    // have become stored-only at the durable commit boundary.
    await this.waitForForegroundStorageAccess();
    this.wrapAllHistorySeeds();
    const required = this.payloadsRequiredForStep(delta);
    const previousCursor = this.host.store.cursor;
    const crossed = delta < 0
      ? this.host.store.actions[previousCursor - 1]
      : this.host.store.actions[previousCursor];
    if (crossed?.kind === "layer-merge") {
      // The merge runtime streams one seed at a time and retains detached live
      // GPU resources as its rollback closure. Hydrating N+1 seeds here would
      // recreate the old unbounded peak before the transaction even starts.
      await this.assertRequiredPayloadsAvailable(required);
      return;
    }
    await this.hydrateRequiredPayloads(required);
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
      throw new Error("The local merge seed is no longer reachable in History storage.");
    }
    await this.hydrateRequiredPayloads(required);
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
    if (cursor < 0 || cursor > this.host.store.actions.length) {
      throw new Error("Invalid History cursor for raster preflight.");
    }
    await this.waitForForegroundStorageAccess();
    this.wrapAllHistorySeeds();
    await this.hydrateRequiredPayloads(
      this.payloadsRequiredForRasterReplay(layerId, [cursor]),
    );
  }

  private async waitForForegroundStorageAccess(): Promise<void> {
    const deadline = performance.now() + 60_000;
    while (this.storageBusy === "spilling" && performance.now() < deadline) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 10));
    }
    if (this.storageBusy !== "idle") {
      throw new Error("Local history is still busy; the artwork was not modified.");
    }
  }

  private async hydrateRequiredPayloads(
    required: readonly HistoryPayloadCandidate[],
  ): Promise<void> {
    const missing = required.filter((candidate) => candidate.storage === "gpu"
      ? !this.host.gpuStorage.isResident(candidate.slice)
      : !candidate.handle.resident
    );
    if (missing.length === 0) return;
    await this.initializePromise;
    if (!this.ready || this.storageBusy !== "idle") {
      throw new Error("Local history is currently unavailable.");
    }
    for (const candidate of missing) {
      if (!this.storedPayloads.has(candidate.payloadId)) {
        throw new Error(
          "The local portion of history is no longer available. "
          + "The current artwork was not modified.",
        );
      }
    }

    const token = this.captureToken();
    const totalBytes = missing.reduce((total, candidate) => total + candidate.rawBytes, 0);
    let loadedBytes = 0;
    let residenceChanged = false;
    this.storageBusy = "hydrating";
    this.host.publishStatus(
      `Loading local history… 0.0 / ${formatMiB(totalBytes)} MiB`,
      "working",
    );
    try {
      for (const candidate of missing) {
        this.assertToken(token);
        const location = this.storedPayloads.get(candidate.payloadId)!;
        assertStoredPayloadCompatible(location.payload, candidate);
        if (candidate.storage === "gpu") {
          const bytes = await this.readPayloadBytes(location);
          this.assertToken(token);
          this.host.gpuStorage.hydrate(candidate.slice, bytes);
          residenceChanged = true;
        } else {
          const compressed = await this.readColdSeed(location);
          this.assertToken(token);
          const restored = await this.host.restoreColdStorage(
            compressed,
            `Hydrate local History · action ${candidate.ownerActionId}`,
          );
          try {
            this.assertToken(token);
            candidate.handle.attachResident(restored);
            residenceChanged = true;
          } catch (error) {
            destroyLayerColdStorage(restored);
            throw error;
          }
        }
        loadedBytes += candidate.rawBytes;
        this.hydratedBytes += candidate.rawBytes;
        this.host.publishStatus(
          `Loading local history… ${formatMiB(loadedBytes)} / `
          + `${formatMiB(totalBytes)} MiB`,
          "working",
        );
        await yieldBrowserTurn();
      }
      await this.host.waitForGpu("Hydrate local history", 60_000);
      this.assertToken(token);
      this.hydrationsCompleted += 1;
      this.ownershipEpoch += 1;
      this.host.onResidenceChanged();
    } catch (error) {
      this.hydrationFailures += 1;
      this.lastError = errorMessage(error);
      if (residenceChanged) {
        this.ownershipEpoch += 1;
        this.host.onResidenceChanged();
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
      ? !this.host.gpuStorage.isResident(candidate.slice)
      : !candidate.handle.resident
    );
    if (missing.length === 0) return;
    await this.initializePromise;
    if (!this.ready || this.storageBusy !== "idle") {
      throw new Error("Local history is currently unavailable.");
    }
    for (const candidate of missing) {
      if (!this.storedPayloads.has(candidate.payloadId)) {
        throw new Error(
          "The local portion of history is no longer available. "
          + "The current artwork was not modified.",
        );
      }
    }
  }

  /**
   * Keeps deep navigation byte-bounded. Rehydrated payloads are replay inputs,
   * not live document state, so after the caller's GPU fence every durable
   * resident copy outside a small adjacent-step working set can be demoted.
   */
  trimHydratedWorkingSetAfterStep(preferredDelta: -1 | 1): boolean {
    if (this.storageBusy !== "idle" || this.destroyed) return false;
    this.wrapAllHistorySeeds();
    const protectedPayloadIds = new Set<string>();
    const workingSetBudget = historyStorageMaximumSegmentBytes(MOBILE_DEVICE_CLASS);
    let protectedBytes = 0;
    for (const delta of [preferredDelta, preferredDelta === -1 ? 1 : -1] as const) {
      for (const candidate of this.payloadsRequiredForStep(delta)) {
        if (
          protectedPayloadIds.has(candidate.payloadId)
          || !this.storedPayloads.has(candidate.payloadId)
          || protectedBytes + candidate.rawBytes > workingSetBudget
        ) {
          continue;
        }
        protectedPayloadIds.add(candidate.payloadId);
        protectedBytes += candidate.rawBytes;
      }
    }
    const candidates = this.collectPayloadCandidates().filter((candidate) =>
      this.storedPayloads.has(candidate.payloadId)
      && !protectedPayloadIds.has(candidate.payloadId)
      && (candidate.storage === "gpu"
        ? this.host.gpuStorage.isResident(candidate.slice)
        : candidate.handle.resident)
    );
    if (candidates.length === 0) return false;
    const gpuSlices = candidates.flatMap((candidate) =>
      candidate.storage === "gpu" ? [candidate.slice] : []
    );
    const prepared = this.host.gpuStorage.prepareDemoteMany(gpuSlices);
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
    this.host.store.selectionClipBindGroups.clear();
    this.host.gpuStorage.trimEmptyPages(true);
    this.ownershipEpoch += 1;
    this.host.onResidenceChanged();
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
        if (HISTORY_DEV_FORCE_IDB) throw new Error("The IDB backend was forced by local QA.");
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

  private residentPayloadSegmentPlan(options: HistoryStorageSpillOptions): {
    candidates: HistoryPayloadCandidate[];
    plan: HistorySegmentPlan;
  } {
    const candidates = this.collectPayloadCandidates();
    const byAction = new Map<number, {
      cursor: number;
      bytes: number;
      count: number;
    }>();
    for (const candidate of candidates) {
      if (
        this.storedPayloads.has(candidate.payloadId)
        || (candidate.storage === "gpu"
          ? !this.host.gpuStorage.isResident(candidate.slice)
          : !candidate.handle.resident)
      ) {
        continue;
      }
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
    const keepHotActions = adaptiveHistoryStorageKeepHotActions({
      currentResidentBytes: options.currentResidentBytes(),
      highWaterBytes: options.highWaterBytes,
      hotPayloadBudgetBytes: Math.min(
        maximumSegmentBytes,
        Math.floor(options.highWaterBytes * 0.25),
      ),
      journalLength: this.host.store.actions.length,
      actions: planningActions,
    });
    return {
      candidates,
      plan: planHistoryStorageSegment({
        currentResidentBytes: options.currentResidentBytes(),
        highWaterBytes: options.highWaterBytes,
        targetSegmentBytes: historyStorageTargetSegmentBytes(MOBILE_DEVICE_CLASS),
        maximumSegmentBytes,
        journalLength: this.host.store.actions.length,
        keepHotActions,
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
        "The History action is too large for the local budget; other payloads can still spill.";
      return "budget-skip";
    }

    const segmentId = makeId("seg");
    const commitNonce = makeId("c");
    let writer: CandidateWriter | null = null;
    let manifestCommitted = false;
    this.storageBusy = "spilling";
    try {
      await this.host.waitForIdle();
      await this.host.device.queue.onSubmittedWorkDone();
      this.assertToken(token);
      if (!options.shouldContinue()) throw new Error("History spill was interrupted by the user.");
      writer = await this.beginCandidate(segmentId);
      let storageChunkIndex = 0;
      const storedPayloads: StoredHistoryPayloadV1[] = [];
      for (const candidate of selected) {
        this.assertToken(token);
        if (!options.shouldContinue()) throw new Error("History spill became stale.");
        const serialized = candidate.storage === "gpu"
          ? await this.serializeGpuPayload(candidate, writer, storageChunkIndex, options)
          : await this.serializeColdPayload(candidate, writer, storageChunkIndex, options);
        storedPayloads.push(serialized.payload);
        storageChunkIndex = serialized.nextStorageChunkIndex;
        await yieldBrowserTurn();
      }
      this.assertToken(token);
      if (!options.shouldContinue()) throw new Error("History spill became stale.");
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
      if (!options.shouldContinue()) throw new Error("History spill became stale before the manifest.");

      // Prevalidate every physical release before the durable publication.
      const gpuSlices = selected.flatMap((candidate) =>
        candidate.storage === "gpu" ? [candidate.slice] : []
      );
      const gpuDemotion = this.host.gpuStorage.prepareDemoteMany(gpuSlices);
      const coldHandles = selected.flatMap((candidate) =>
        candidate.storage === "cold" ? [candidate.handle] : []
      );
      if (coldHandles.some((handle) => !handle.resident || handle.retired)) {
        throw new Error("The History seed is no longer resident before commit.");
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
          return this.host.gpuStorage.contains(candidate.slice)
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
        this.host.store.selectionClipBindGroups.clear();
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
        if (failureSignature === this.lastSpillFailureSignature) {
          this.consecutiveSpillFailures += 1;
        } else {
          this.lastSpillFailureSignature = failureSignature;
          this.consecutiveSpillFailures = 1;
        }
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
        // Do not livelock idle maintenance above the hard RAM budget. Once the
        // durable path has failed repeatedly, retention may fall back to its
        // byte-bounded in-memory policy for this disposable session.
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
      this.host,
      candidate.slice,
      historyStorageChunkBytes(MOBILE_DEVICE_CLASS),
    )) {
      if (!options.shouldContinue()) throw new Error("History readback was interrupted.");
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
      throw new Error(`Incomplete readback for slice ${candidate.slice.id}.`);
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
          alignmentBytes: this.host.gpuStorage.alignmentBytes(candidate.slice),
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
    if (!resident) throw new Error("The History seed is not resident during spill.");
    const chunks: StoredHistoryChunkV1[] = [];
    let storageChunkIndex = firstStorageChunkIndex;
    let rawBytes = 0;
    let storedBytes = 0;
    let sourceHash = 0x811c9dc5;
    const tileByteLength = resident.memoryBytes / resident.tileIndices.length;
    if (!Number.isInteger(tileByteLength) || tileByteLength <= 0) {
      throw new Error("Invalid History seed tile layout.");
    }
    let compressionClient: Awaited<ReturnType<HistoryStorageHost["compressionClient"]>> | null = null;
    try {
      compressionClient = await this.host.compressionClient();
    } catch {
      // Raw is a complete, lossless backend and does not need CompressionStream.
    }
    let payloadChunkIndex = 0;
    for (let firstTile = 0; firstTile < resident.tileIndices.length; firstTile += 4) {
      if (!options.shouldContinue()) throw new Error("History seed compression was interrupted.");
      const tileCount = Math.min(4, resident.tileIndices.length - firstTile);
      const raw = await this.host.readColdStorageTiles(
        resident,
        firstTile,
        tileCount,
        `Local History · action seed ${candidate.ownerActionId}`,
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
    if (rawBytes !== resident.memoryBytes) throw new Error("The History seed was only partially read.");
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
      throw new Error("The local History backend is not writable.");
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
        throw new Error("IndexedDB History chunk has an invalid length.");
      }
      if (await sha256Bytes(new Uint8Array(bytes)) !== chunk.storedSha256) {
        throw new Error("Invalid IndexedDB History chunk hash.");
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
      journalLength: this.host.store.actions.length,
      headActionId: this.host.store.actions.at(-1)?.id ?? null,
      logicalFloorCursor: Math.max(0, Math.trunc(logicalFloorCursor)),
      logicalCeilingCursor: this.host.store.actions.length,
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
      journalLength: this.host.store.actions.length,
      headActionId: this.host.store.actions.at(-1)?.id ?? null,
      logicalFloorCursor: this.manifestLogicalFloorCursor,
      logicalCeilingCursor: this.host.store.actions.length,
      segmentIds: [...this.segments.keys()].filter((id) => id !== segment.segmentId),
      committedBytes: Math.max(0, this.committedBytes - segment.storedBytes),
      documentFingerprint: this.fingerprint(),
      commitMarker: "COMMITTED",
    };
  }

  private fingerprint(): HistoryDocumentFingerprintV1 {
    return {
      documentWidth: DOCUMENT_WIDTH,
      documentHeight: DOCUMENT_HEIGHT,
      layerSize: DOCUMENT_MAX_EDGE,
      layerFormat: this.host.layerFormat,
      stampStrideBytes: STAMP_STRIDE_BYTES,
      journalStrategy: HISTORY_JOURNAL_STRATEGY,
      retentionStrategy: HISTORY_RETENTION_STRATEGY,
      segmentSchemaVersion: 1,
      codecVersion: 1,
      engineBuildId: "history-local-spill-rect-v2",
    };
  }

  private collectPayloadCandidates(): HistoryPayloadCandidate[] {
    this.wrapAllHistorySeeds();
    const actionIndexById = new Map(
      this.host.store.actions.map((action, index) => [action.id, index]),
    );
    const gpuById = new Map<number, GpuPayloadCandidate>();
    const addGpu = (
      slice: GpuHistorySlice,
      kind: GpuPayloadCandidate["kind"],
      ownerActionId: number,
      layerId: number | null,
    ): void => {
      const cursor = actionIndexById.get(ownerActionId);
      if (cursor === undefined || !this.host.gpuStorage.contains(slice)) return;
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
    for (const batch of this.host.store.batches) {
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
    for (const [actionId, snapshot] of this.host.store.selectionMasksByAction) {
      addGpu(snapshot.gpuSlice, "selection-mask-gpu", actionId, null);
    }
    for (const action of this.host.store.actions) {
      const transforms = action.kind === "raster-transform"
        ? [action]
        : action.kind === "group-transform"
          ? action.rasters
          : [];
      for (const transform of transforms) {
        for (const snapshot of [transform.selectionBefore, transform.selectionAfter]) {
          if (snapshot) addGpu(snapshot.gpuSlice, "selection-mask-gpu", action.id, null);
        }
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
    if (!options.shouldContinue() || this.host.store.cursor !== this.host.store.actions.length) {
      return false;
    }
    const residentStored = this.collectPayloadCandidates().filter((candidate) =>
      this.storedPayloads.has(candidate.payloadId)
      && (candidate.storage === "gpu"
        ? this.host.gpuStorage.isResident(candidate.slice)
        : candidate.handle.resident)
    );
    const byAction = new Map<number, { cursor: number; payloadBytes: number }>();
    for (const candidate of residentStored) {
      const current = byAction.get(candidate.ownerActionId) ?? {
        cursor: candidate.ownerCursor,
        payloadBytes: 0,
      };
      current.cursor = Math.max(current.cursor, candidate.ownerCursor);
      current.payloadBytes += candidate.rawBytes;
      byAction.set(candidate.ownerActionId, current);
    }
    const maximumSegmentBytes = historyStorageMaximumSegmentBytes(MOBILE_DEVICE_CLASS);
    const keepHotActions = adaptiveHistoryStorageKeepHotActions({
      currentResidentBytes: options.currentResidentBytes(),
      highWaterBytes: options.highWaterBytes,
      hotPayloadBudgetBytes: Math.min(
        maximumSegmentBytes,
        Math.floor(options.highWaterBytes * 0.25),
      ),
      journalLength: this.host.store.actions.length,
      actions: [...byAction.values()],
    });
    const coldCeiling = Math.max(
      0,
      this.host.store.actions.length - keepHotActions,
    );
    const candidates = residentStored.filter((candidate) =>
      candidate.ownerCursor < coldCeiling
    );
    if (candidates.length === 0) return false;
    const gpuSlices = candidates.flatMap((candidate) =>
      candidate.storage === "gpu" ? [candidate.slice] : []
    );
    const prepared = this.host.gpuStorage.prepareDemoteMany(gpuSlices);
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
    this.host.store.selectionClipBindGroups.clear();
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
      const periodicSelection = this.host.periodicCheckpointChain(layerId, cursor);
      const replay = planRasterHistoryReplay({
        actions: this.host.store.actions,
        cursor,
        batches: this.host.store.batches,
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
    const previousCursor = this.host.store.cursor;
    const nextCursor = previousCursor + delta;
    const crossed = delta < 0
      ? this.host.store.actions[previousCursor - 1]
      : this.host.store.actions[previousCursor];
    if (!crossed) return [];

    if (
      crossed.kind === "vector-rasterize"
      || crossed.kind === "raster-import"
      || crossed.kind === "layer-add"
      || crossed.kind === "raster-transform"
      || crossed.kind === "raster-filter"
    ) {
      addSeed(crossed.seed);
      if (crossed.kind === "raster-filter" && crossed.filter === "rasterize-layer") {
        addSeed(crossed.beforeSeed);
      }
    } else if (crossed.kind === "layer-delete") {
      for (const entry of crossed.entries) addSeed(entry.seed);
    } else if (crossed.kind === "layer-merge") {
      for (const input of crossed.inputs) {
        if (input.kind === "raster") addSeed(input.entry.seed);
      }
      addSeed(crossed.output.seed);
    } else if (crossed.kind === "group-transform") {
      for (const entry of crossed.rasters) addSeed(entry.seed);
    }
    const crossedTransforms = crossed.kind === "raster-transform"
      ? [crossed]
      : crossed.kind === "group-transform"
        ? crossed.rasters
        : [];
    for (const transform of crossedTransforms) {
      addSnapshot(transform.selectionBefore);
      addSnapshot(transform.selectionAfter);
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
    } else if (crossed.kind === "group-transform") {
      for (const entry of crossed.rasters) {
        this.addRasterReplayRequirements(
          collector,
          entry.layerId,
          [previousCursor, nextCursor],
        );
      }
    }
    return [...required.values()];
  }

  private wrapAllHistorySeeds(): void {
    for (const action of this.host.store.actions) {
      if (
        action.kind === "vector-rasterize"
        || action.kind === "raster-import"
        || action.kind === "layer-add"
        || action.kind === "raster-transform"
        || action.kind === "raster-filter"
      ) {
        if (action.seed) action.seed = this.wrapSeed(action.seed, action.id, action.layerId);
        if (
          action.kind === "raster-filter"
          && action.filter === "rasterize-layer"
        ) {
          action.beforeSeed = this.wrapSeed(
            action.beforeSeed,
            action.id,
            action.layerId,
          );
        }
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
      } else if (action.kind === "group-transform") {
        for (const entry of action.rasters) {
          if (entry.seed) {
            entry.seed = this.wrapSeed(entry.seed, action.id, entry.layerId);
          }
        }
      }
    }
    for (const checkpoint of this.host.periodicCheckpoints()) {
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

  private async readPayloadBytes(location: StoredPayloadLocation): Promise<Uint8Array> {
    const payload = location.payload;
    if (payload.rawBytes > MAX_DESCRIPTOR_BYTES) throw new Error("History payload is too large.");
    const output = new Uint8Array(payload.rawBytes);
    let offset = 0;
    for (const chunk of [...payload.chunks].sort(
      (left, right) => left.payloadChunkIndex - right.payloadChunkIndex,
    )) {
      if (chunk.codec !== "raw") {
        throw new Error("Unexpected compressed codec for a GPU History slice.");
      }
      const bytes = new Uint8Array(await this.readStoredChunk(location.segment, chunk));
      await verifyStoredChunk(bytes, chunk);
      if (historyHash32(bytes) !== chunk.rawHash32) {
        throw new Error("Invalid raw History slice hash.");
      }
      if (offset + bytes.byteLength > output.byteLength) {
        throw new Error("History slice chunk exceeds the declared length.");
      }
      output.set(bytes, offset);
      offset += bytes.byteLength;
    }
    if (offset !== output.byteLength) throw new Error("History slice payload is incomplete.");
    return output;
  }

  private async readColdSeed(
    location: StoredPayloadLocation,
  ): Promise<LayerCompressedColdStorageResources> {
    const metadata = location.payload.coldSeed;
    if (!metadata) throw new Error("Cold History seed metadata is missing.");
    const chunks: LayerColdCompressedChunk[] = [];
    let storedBytes = 0;
    for (const descriptor of [...location.payload.chunks].sort(
      (left, right) => left.payloadChunkIndex - right.payloadChunkIndex,
    )) {
      const bytes = new Uint8Array(await this.readStoredChunk(location.segment, descriptor));
      await verifyStoredChunk(bytes, descriptor);
      chunks.push({
        storage: descriptor.codec,
        bytes: exactArrayBuffer(bytes),
        rawBytes: descriptor.rawBytes,
        storedBytes: descriptor.storedBytes,
        sourceHash: descriptor.rawHash32,
      });
      storedBytes += descriptor.storedBytes;
    }
    if (storedBytes !== location.payload.storedBytes) {
      throw new Error("The cold History seed is incomplete.");
    }
    return {
      tileIndices: [...metadata.tileIndices],
      chunks,
      rawBytes: metadata.rawBytes,
      storedBytes,
      sourceHash: metadata.sourceHash,
      generation: metadata.generation,
      encodeMs: 0,
      format: metadata.format,
    };
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
    throw new Error(`History OPFS read failed: ${errorMessage(lastError)}.`);
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
      cursor: this.host.store.cursor,
      actionsLength: this.host.store.actions.length,
      actionsTail: this.host.store.actions.at(-1) ?? null,
    };
  }

  private assertToken(token: SpillToken): void {
    if (!this.tokenIsCurrent(token)) {
      throw new Error("The local History operation became stale.");
    }
  }

  private tokenIsCurrent(token: SpillToken): boolean {
    return !(
      token.sessionId !== this.sessionId
      || token.branchId !== this.branchId
      || token.operationEpoch !== this.operationEpoch
      || token.cursor !== this.host.store.cursor
      || token.actionsLength !== this.host.store.actions.length
      || token.actionsTail !== (this.host.store.actions.at(-1) ?? null)
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
  host: HistoryStorageHost,
  slice: GpuHistorySlice,
  maximumLogicalChunkBytes: number,
): AsyncGenerator<Uint8Array> {
  if (!host.gpuStorage.isResident(slice)) {
    throw new Error(`History slice ${slice.id} is not resident for readback.`);
  }
  let logicalOffset = 0;
  while (logicalOffset < slice.logicalBytes) {
    const logicalChunkBytes = Math.min(
      maximumLogicalChunkBytes,
      slice.logicalBytes - logicalOffset,
    );
    const copyBytes = align4(logicalChunkBytes);
    if (logicalOffset + copyBytes > slice.reservedBytes) {
      throw new Error("History readback exceeds the slice's reserved bytes.");
    }
    const staging = host.device.createBuffer({
      label: `Readback History slice ${slice.id} @${logicalOffset}`,
      size: copyBytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    try {
      const encoder = host.device.createCommandEncoder({
        label: `Readback History slice ${slice.id}`,
      });
      encoder.copyBufferToBuffer(
        slice.buffer,
        slice.offsetBytes + logicalOffset,
        staging,
        0,
        copyBytes,
      );
      host.device.queue.submit([encoder.finish()]);
      await Promise.race([
        staging.mapAsync(GPUMapMode.READ),
        timeoutReject(60_000, "History slice readback timed out."),
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
    throw new Error("The local History descriptor is incompatible.");
  }
  if (
    descriptor.payloads.length > MAX_DESCRIPTOR_PAYLOADS
    || descriptor.chunkCount > MAX_DESCRIPTOR_CHUNKS
    || descriptor.rawBytes < 0
    || descriptor.rawBytes > MAX_DESCRIPTOR_BYTES
    || descriptor.storedBytes < 0
    || descriptor.storedBytes > MAX_DESCRIPTOR_BYTES
  ) {
    throw new Error("The local History descriptor exceeds the allowed limits.");
  }
  const payloadIds = new Set<string>();
  const chunkIndexes = new Set<number>();
  for (const payload of descriptor.payloads) {
    if (payloadIds.has(payload.payloadId)) throw new Error("Duplicate History payload.");
    payloadIds.add(payload.payloadId);
    let expectedPayloadChunk = 0;
    for (const chunk of payload.chunks) {
      if (
        chunk.payloadChunkIndex !== expectedPayloadChunk
        || chunkIndexes.has(chunk.storageChunkIndex)
        || chunk.rawBytes <= 0
        || chunk.storedBytes <= 0
      ) {
        throw new Error("Invalid History chunk index.");
      }
      expectedPayloadChunk += 1;
      chunkIndexes.add(chunk.storageChunkIndex);
    }
  }
  if (chunkIndexes.size !== descriptor.chunkCount) {
    throw new Error("Inconsistent History chunk count.");
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
    throw new Error("The local History payload does not match the requested resource.");
  }
  if (candidate.storage === "gpu") {
    if (
      payload.serializerId !== "opaque-gpu-v1"
      || payload.gpu?.logicalBytes !== candidate.slice.logicalBytes
      || payload.coldSeed !== null
    ) {
      throw new Error("The local History slice ABI is incompatible.");
    }
  } else if (
    payload.serializerId !== "cold-seed-v1"
    || payload.coldSeed?.format !== candidate.handle.format
    || payload.coldSeed.generation !== candidate.handle.generation
  ) {
    throw new Error("The local History seed ABI is incompatible.");
  }
}

async function verifyStoredChunk(bytes: Uint8Array, chunk: StoredHistoryChunkV1): Promise<void> {
  if (bytes.byteLength !== chunk.storedBytes) {
    throw new Error("Invalid local History chunk length.");
  }
  if (await sha256Bytes(bytes) !== chunk.storedSha256) {
    throw new Error("Invalid stored hash for the local History chunk.");
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
