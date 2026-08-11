/**
 * Pure policy and versioned DTOs for session-local History spill.
 *
 * Browser storage is deliberately absent from this module so planning,
 * fingerprints and quota arithmetic remain executable in the Node verify
 * suite. The first format stores only payloads whose CPU action metadata stays
 * resident; it is not a document-recovery format.
 */

export const HISTORY_LOCAL_STORAGE_SCHEMA_VERSION = 1 as const;
export const HISTORY_LOCAL_STORAGE_DATABASE = "m1m4-history-v1" as const;
export const HISTORY_LOCAL_STORAGE_SEGMENT_MAGIC = "M1M4_HISTORY_SEGMENT" as const;
export const HISTORY_LOCAL_STORAGE_COMMIT_MAGIC = "M1M4_HISTORY_COMMIT_V1" as const;

export const HISTORY_STORAGE_MOBILE_TARGET_SEGMENT_BYTES = 32 * 1024 * 1024;
export const HISTORY_STORAGE_DESKTOP_TARGET_SEGMENT_BYTES = 64 * 1024 * 1024;
export const HISTORY_STORAGE_MOBILE_MAXIMUM_SEGMENT_BYTES = 64 * 1024 * 1024;
export const HISTORY_STORAGE_DESKTOP_MAXIMUM_SEGMENT_BYTES = 128 * 1024 * 1024;
export const HISTORY_STORAGE_MOBILE_CHUNK_BYTES = 1024 * 1024;
export const HISTORY_STORAGE_DESKTOP_CHUNK_BYTES = 2 * 1024 * 1024;
/**
 * The hot tail is bounded twice: by action count and by logical payload bytes.
 * Count keeps ordinary recent Undo predictable; the byte ceiling prevents one
 * import/transform/merge from turning that convenience window into an
 * unbounded GPU fallback.
 */
export const HISTORY_STORAGE_MOBILE_MAXIMUM_HOT_ACTIONS = 2;
export const HISTORY_STORAGE_DESKTOP_MAXIMUM_HOT_ACTIONS = 4;
export const HISTORY_STORAGE_MOBILE_HOT_PAYLOAD_HARD_BYTES = 48 * 1024 * 1024;
export const HISTORY_STORAGE_DESKTOP_HOT_PAYLOAD_HARD_BYTES = 160 * 1024 * 1024;
/** Compatibility default for pure callers that do not provide a device cap. */
export const HISTORY_STORAGE_KEEP_HOT_ACTIONS =
  HISTORY_STORAGE_DESKTOP_MAXIMUM_HOT_ACTIONS;
/** Compatibility default; runtime policy selects the device-specific ceiling. */
export const HISTORY_STORAGE_SPILL_HIGH_WATER_BYTES =
  HISTORY_STORAGE_DESKTOP_HOT_PAYLOAD_HARD_BYTES;

const MEBIBYTE_BYTES = 1024 * 1024;
const GIBIBYTE_BYTES = 1024 * MEBIBYTE_BYTES;
/** Aggregate descriptor bound; payload I/O remains independently chunked. */
export const HISTORY_STORAGE_MAXIMUM_DESCRIPTOR_BYTES = 8 * GIBIBYTE_BYTES;

export type HistoryStorageBackendKind =
  | "opfs-worker"
  | "indexeddb-chunks"
  | "memory-only";

export type StoredHistoryPayloadKind =
  | "paint-gpu"
  | "blend-gpu"
  | "fill-gpu"
  | "selection-mask-gpu"
  | "layer-seed";

export type StoredHistoryChunkCodec = "raw" | "gzip" | "gzip-shuffle16";

export interface HistoryDocumentFingerprintV1 {
  readonly layerSize: number;
  readonly layerFormat: "rgba8unorm" | "rgba16float";
  readonly stampStrideBytes: number;
  readonly journalStrategy: string;
  readonly retentionStrategy: string;
  readonly segmentSchemaVersion: 1;
  readonly codecVersion: 1;
  readonly engineBuildId: string;
}

export interface StoredHistoryChunkV1 {
  /** Monotonic within one physical segment. */
  readonly storageChunkIndex: number;
  /** Monotonic within the owning payload. */
  readonly payloadChunkIndex: number;
  /** Byte offset in OPFS; zero for the IndexedDB chunk backend. */
  readonly fileOffset: number;
  readonly rawBytes: number;
  readonly storedBytes: number;
  readonly codec: StoredHistoryChunkCodec;
  readonly storedSha256: string;
  readonly rawHash32: number;
}

export interface StoredGpuHistoryPayloadMetadataV1 {
  readonly logicalBytes: number;
  readonly label: string;
  readonly alignmentBytes: number;
}

export interface StoredColdSeedMetadataV1 {
  readonly tileIndices: readonly number[];
  readonly rawBytes: number;
  readonly sourceHash: number;
  readonly generation: number;
  readonly format: "rgba8unorm" | "rgba16float";
}

export interface StoredHistoryPayloadV1 {
  readonly payloadId: string;
  readonly serializerId: "opaque-gpu-v1" | "cold-seed-v1";
  readonly kind: StoredHistoryPayloadKind;
  readonly ownerActionId: number;
  readonly layerId: number | null;
  readonly rawBytes: number;
  readonly storedBytes: number;
  readonly chunks: readonly StoredHistoryChunkV1[];
  readonly gpu: StoredGpuHistoryPayloadMetadataV1 | null;
  readonly coldSeed: StoredColdSeedMetadataV1 | null;
}

export interface HistorySegmentDescriptorV1 {
  readonly magic: typeof HISTORY_LOCAL_STORAGE_SEGMENT_MAGIC;
  readonly version: typeof HISTORY_LOCAL_STORAGE_SCHEMA_VERSION;
  readonly sessionId: string;
  readonly instanceId: string;
  readonly branchIdAtCreation: string;
  readonly segmentId: string;
  readonly commitNonce: string;
  readonly backend: Exclude<HistoryStorageBackendKind, "memory-only">;
  readonly startCursor: number;
  readonly endCursor: number;
  readonly firstActionId: number;
  readonly lastActionId: number;
  readonly journalEpoch: number;
  readonly documentFingerprint: HistoryDocumentFingerprintV1;
  readonly payloads: readonly StoredHistoryPayloadV1[];
  readonly rawBytes: number;
  readonly storedBytes: number;
  readonly chunkCount: number;
  readonly descriptorSha256: string;
  readonly commitMarker: typeof HISTORY_LOCAL_STORAGE_COMMIT_MAGIC;
}

export interface HistoryManifestV1 {
  readonly magic: "M1M4_HISTORY_MANIFEST";
  readonly version: typeof HISTORY_LOCAL_STORAGE_SCHEMA_VERSION;
  readonly sessionId: string;
  readonly instanceId: string;
  readonly branchId: string;
  readonly generation: number;
  readonly parentGeneration: number | null;
  readonly journalEpoch: number;
  readonly ownershipEpoch: number;
  readonly journalLength: number;
  readonly headActionId: number | null;
  readonly logicalFloorCursor: number;
  readonly logicalCeilingCursor: number;
  readonly segmentIds: readonly string[];
  readonly committedBytes: number;
  readonly documentFingerprint: HistoryDocumentFingerprintV1;
  readonly commitMarker: "COMMITTED";
}

export interface HistorySegmentPlanningAction {
  readonly actionId: number;
  readonly cursor: number;
  readonly payloadBytes: number;
  readonly payloadCount: number;
  readonly alreadyStored: boolean;
  readonly pinned: boolean;
}

export interface HistorySegmentPlan {
  readonly required: boolean;
  readonly actionIds: readonly number[];
  readonly startCursor: number;
  readonly endCursor: number;
  readonly rawBytes: number;
  readonly payloadCount: number;
  readonly oversize: boolean;
  readonly reason: "below-high-water" | "no-eligible-payload" | "segment";
}

/**
 * Converts a byte-bounded hot payload set into the cursor suffix expected by
 * the segment planner. A large recent action may shrink the suffix below the
 * ordinary count, including to zero, so the byte ceiling always wins.
 */
export function adaptiveHistoryStorageKeepHotActions(options: {
  readonly currentResidentBytes: number;
  readonly highWaterBytes: number;
  readonly hotPayloadBudgetBytes: number;
  readonly journalLength: number;
  readonly maximumHotActions?: number;
  readonly actions: readonly Pick<
    HistorySegmentPlanningAction,
    "cursor" | "payloadBytes"
  >[];
}): number {
  const journalLength = Math.max(0, Math.trunc(options.journalLength));
  const maximum = Math.min(
    journalLength,
    Math.max(0, Math.trunc(options.maximumHotActions ?? HISTORY_STORAGE_KEEP_HOT_ACTIONS)),
  );
  if (finiteNonNegative(options.currentResidentBytes) <= finiteNonNegative(options.highWaterBytes)) {
    return maximum;
  }
  const hotBudget = finiteNonNegative(options.hotPayloadBudgetBytes);
  const minimumCursor = Math.max(0, journalLength - maximum);
  const recent = [...options.actions]
    .filter((action) => (
      action.cursor >= minimumCursor
      && action.cursor < journalLength
      && action.payloadBytes > 0
    ))
    .sort((left, right) => right.cursor - left.cursor);
  let bytes = 0;
  let oldestProtectedCursor: number | null = null;
  for (const action of recent) {
    if (bytes + action.payloadBytes > hotBudget) break;
    bytes += action.payloadBytes;
    oldestProtectedCursor = action.cursor;
  }
  return oldestProtectedCursor === null
    ? 0
    : Math.min(maximum, journalLength - oldestProtectedCursor);
}

/**
 * Selects an oldest global cursor range without ever splitting an action.
 * Gaps containing CPU-only actions remain part of the global range; the
 * payload list is merely a secondary index and never becomes the ordering
 * authority.
 */
export function planHistoryStorageSegment(options: {
  readonly currentResidentBytes: number;
  readonly highWaterBytes: number;
  readonly targetSegmentBytes: number;
  readonly maximumSegmentBytes: number;
  readonly journalLength: number;
  readonly keepHotActions?: number;
  readonly actions: readonly HistorySegmentPlanningAction[];
}): HistorySegmentPlan {
  const current = finiteNonNegative(options.currentResidentBytes);
  const highWater = finiteNonNegative(options.highWaterBytes);
  const target = positiveInteger(options.targetSegmentBytes, "targetSegmentBytes");
  const maximum = positiveInteger(options.maximumSegmentBytes, "maximumSegmentBytes");
  if (target > maximum) {
    throw new RangeError("Il target del segmento non può superare il massimo.");
  }
  const keepHot = Math.max(0, Math.trunc(options.keepHotActions ?? HISTORY_STORAGE_KEEP_HOT_ACTIONS));
  const coldCeiling = Math.max(0, Math.trunc(options.journalLength) - keepHot);
  const eligible = [...options.actions]
    .filter((action) =>
      action.cursor >= 0
      && action.cursor < coldCeiling
      && action.payloadBytes > 0
      && action.payloadCount > 0
      && !action.alreadyStored
      && !action.pinned
    )
    .sort((left, right) => left.cursor - right.cursor || left.actionId - right.actionId);
  if (eligible.length === 0) {
    return emptySegmentPlan(current <= highWater ? "below-high-water" : "no-eligible-payload");
  }

  const selected: HistorySegmentPlanningAction[] = [];
  let rawBytes = 0;
  let payloadCount = 0;
  for (const action of eligible) {
    if (selected.length > 0 && rawBytes + action.payloadBytes > maximum) break;
    selected.push(action);
    rawBytes += action.payloadBytes;
    payloadCount += action.payloadCount;
    // A single action is allowed to exceed the ordinary maximum. It receives
    // an oversize segment instead of being split into an unreplayable half.
    if (selected.length === 1 && rawBytes > maximum) break;
    if (rawBytes >= target) break;
  }
  const startCursor = selected[0].cursor;
  const endCursor = selected.at(-1)!.cursor + 1;
  return {
    required: true,
    actionIds: selected.map((action) => action.actionId),
    startCursor,
    endCursor,
    rawBytes,
    payloadCount,
    oversize: rawBytes > maximum,
    reason: "segment",
  };
}

export interface HistoryDiskBudget {
  readonly hardBytes: number;
  readonly targetBytes: number;
  readonly freeAfterReserveBytes: number;
  readonly reserveBytes: number;
}

/** Conservative quota share; every write must still handle QuotaExceeded. */
export function historyDiskBudget(options: {
  readonly quota: number;
  readonly usage: number;
  readonly committedHistoryBytes: number;
  readonly maximumStoredSegmentBytes: number;
  readonly mobile: boolean;
}): HistoryDiskBudget {
  if (options.quota === 0) {
    // Some capable/private browser modes omit quota estimates. Try a bounded
    // allowance and let QuotaExceeded remain the final authority instead of
    // disabling a working IDB/OPFS backend pre-emptively.
    const hardBytes = options.mobile ? 256 * MEBIBYTE_BYTES : GIBIBYTE_BYTES;
    return {
      hardBytes,
      targetBytes: Math.floor(hardBytes * 0.85),
      freeAfterReserveBytes: Math.max(
        0,
        hardBytes - finiteNonNegative(options.committedHistoryBytes),
      ),
      reserveBytes: Math.max(
        finiteNonNegative(options.maximumStoredSegmentBytes) * 2,
        options.mobile ? 128 * MEBIBYTE_BYTES : 512 * MEBIBYTE_BYTES,
      ),
    };
  }
  const quota = finiteNonNegative(options.quota);
  const usage = Math.min(quota, finiteNonNegative(options.usage));
  const committed = finiteNonNegative(options.committedHistoryBytes);
  const maximumSegment = finiteNonNegative(options.maximumStoredSegmentBytes);
  const deviceReserve = options.mobile ? 256 * MEBIBYTE_BYTES : GIBIBYTE_BYTES;
  const reserveBytes = Math.max(deviceReserve, quota * 0.10, maximumSegment * 2);
  const freeAfterReserveBytes = Math.max(0, quota - usage - reserveBytes);
  const classCap = options.mobile ? GIBIBYTE_BYTES : 8 * GIBIBYTE_BYTES;
  const quotaShareCap = quota * (options.mobile ? 0.15 : 0.25);
  const absoluteCap = Math.min(classCap, quotaShareCap);
  const hardBytes = Math.max(0, Math.min(
    absoluteCap,
    committed + Math.floor(freeAfterReserveBytes * 0.50),
  ));
  return {
    hardBytes,
    targetBytes: Math.floor(hardBytes * 0.85),
    freeAfterReserveBytes,
    reserveBytes,
  };
}

export function historyStorageTargetSegmentBytes(mobile: boolean): number {
  return mobile
    ? HISTORY_STORAGE_MOBILE_TARGET_SEGMENT_BYTES
    : HISTORY_STORAGE_DESKTOP_TARGET_SEGMENT_BYTES;
}

export function historyStorageMaximumSegmentBytes(mobile: boolean): number {
  return mobile
    ? HISTORY_STORAGE_MOBILE_MAXIMUM_SEGMENT_BYTES
    : HISTORY_STORAGE_DESKTOP_MAXIMUM_SEGMENT_BYTES;
}

export function historyStorageChunkBytes(mobile: boolean): number {
  return mobile ? HISTORY_STORAGE_MOBILE_CHUNK_BYTES : HISTORY_STORAGE_DESKTOP_CHUNK_BYTES;
}

export function historyStorageMaximumHotActions(mobile: boolean): number {
  return mobile
    ? HISTORY_STORAGE_MOBILE_MAXIMUM_HOT_ACTIONS
    : HISTORY_STORAGE_DESKTOP_MAXIMUM_HOT_ACTIONS;
}

export function historyStorageHotPayloadHardBytes(mobile: boolean): number {
  return mobile
    ? HISTORY_STORAGE_MOBILE_HOT_PAYLOAD_HARD_BYTES
    : HISTORY_STORAGE_DESKTOP_HOT_PAYLOAD_HARD_BYTES;
}

export function historyHash32(bytes: Uint8Array): number {
  let hash = 0x811c9dc5;
  for (const value of bytes) hash = Math.imul(hash ^ value, 0x01000193) >>> 0;
  return hash;
}

export function canonicalHistoryJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalHistoryJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalHistoryJson(record[key])}`
  )).join(",")}}`;
}

function emptySegmentPlan(
  reason: "below-high-water" | "no-eligible-payload",
): HistorySegmentPlan {
  return {
    required: false,
    actionIds: [],
    startCursor: 0,
    endCursor: 0,
    rawBytes: 0,
    payloadCount: 0,
    oversize: false,
    reason,
  };
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} deve essere un intero positivo.`);
  }
  return value;
}
