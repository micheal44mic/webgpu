import type { RasterBevelStyle } from "./bevel-core";
import type { BrushSettings, LayerFormat } from "./engine-types";
import {
  migrateLegacyLayerBlendMode,
  type LayerBlendMode,
} from "./layer-blend-modes.ts";
import type { LayerCompressionStorage } from "./layer-compression-codec";
import type { MixedSceneState } from "./mixed-scene-stack";
import type { RasterColorOverlayStyle } from "./raster-color-overlay-core";
import type {
  RasterInnerShadowStyle,
  RasterOuterShadowStyle,
} from "./shadow-core";
import type { RasterStrokeStyle } from "./stroke-core";

/**
 * Durable, user-owned artwork storage. This database is intentionally
 * separate from History: History is an evictable editing cache, while a
 * project head is a recovery promise that survives reopening the app.
 */
export const PROJECT_STORAGE_DATABASE_NAME = "m1m4-projects" as const;
export const PROJECT_STORAGE_DATABASE_VERSION = 1 as const;
export const PROJECT_DOCUMENT_SCHEMA_VERSION = 1 as const;
export const PROJECT_MANIFEST_MAGIC = "M1M4_PROJECT_MANIFEST_V1" as const;

export const PROJECT_STORAGE_TILE_GRID_SIZE = 16 as const;
export const PROJECT_STORAGE_TILE_COUNT =
  PROJECT_STORAGE_TILE_GRID_SIZE * PROJECT_STORAGE_TILE_GRID_SIZE;
export const PROJECT_STORAGE_TILE_MASK_WORDS = PROJECT_STORAGE_TILE_COUNT / 32;
export const PROJECT_STORAGE_MIN_DOCUMENT_DIMENSION = 64 as const;
export const PROJECT_STORAGE_MAX_DOCUMENT_DIMENSION = 4000 as const;
/** Existing 4096² documents remain readable even though new canvases cap at 4000 px. */
export const PROJECT_STORAGE_LEGACY_DOCUMENT_DIMENSION = 4096 as const;
export const PROJECT_STORAGE_MAX_LAYERS = 16 as const;
export const PROJECT_STORAGE_MAX_TITLE_LENGTH = 80 as const;
export const PROJECT_STORAGE_MAX_THUMBNAIL_BYTES = 4 * 1024 * 1024;
export const PROJECT_STORAGE_MAX_CHUNK_BYTES = 64 * 1024 * 1024;
export const PROJECT_STORAGE_MAX_RASTER_SOURCE_BYTES = 64 * 1024 * 1024;
export const PROJECT_STORAGE_QUOTA_RESERVE_BYTES = 16 * 1024 * 1024;

const PROJECT_STORE = "projects";
const MANIFEST_STORE = "manifests";
const CHUNK_STORE = "chunks";
const PROJECT_INDEX = "byProject";
const GENERATION_INDEX = "byGeneration";

const PROJECT_ID_PATTERN = /^[A-Za-z0-9._-]{1,160}$/;
const GENERATION_ID_PATTERN = /^[A-Za-z0-9._-]{1,160}$/;

export interface ProjectSummaryV1 {
  readonly schemaVersion: typeof PROJECT_DOCUMENT_SCHEMA_VERSION;
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly headGenerationId: string;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly layerCount: number;
  /** Compressed raster payload plus thumbnail bytes, excluding small IDB metadata. */
  readonly storedBytes: number;
  readonly thumbnail: Blob | null;
}

export interface ProjectDocumentDescriptorV1 {
  readonly schemaVersion: typeof PROJECT_DOCUMENT_SCHEMA_VERSION;
  readonly width: number;
  readonly height: number;
  readonly layerFormat: LayerFormat;
  readonly tileGridSize: typeof PROJECT_STORAGE_TILE_GRID_SIZE;
  readonly colorSpace: "linear-premultiplied";
}

export interface ProjectRectV1 {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Metadata for one independently verifiable compression chunk. */
export interface ProjectLayerChunkDescriptorV1 {
  readonly schemaVersion: typeof PROJECT_DOCUMENT_SCHEMA_VERSION;
  readonly chunkIndex: number;
  /** Index into ProjectLayerPixelsV1.tileIndices, not a document tile id. */
  readonly firstTileOffset: number;
  readonly tileCount: number;
  readonly storage: LayerCompressionStorage;
  readonly rawBytes: number;
  readonly storedBytes: number;
  readonly sourceHash: number;
}

/**
 * Sparse authoritative pixels for one raster layer. `tileIndices` has the
 * same order used when packing the chunks; no GPU object enters this DTO.
 */
export interface ProjectLayerPixelsV1 {
  readonly schemaVersion: typeof PROJECT_DOCUMENT_SCHEMA_VERSION;
  readonly format: LayerFormat;
  readonly tileIndices: readonly number[];
  readonly chunks: readonly ProjectLayerChunkDescriptorV1[];
  readonly rawBytes: number;
  readonly storedBytes: number;
  readonly sourceHash: number;
  readonly generation: number;
}

/** Encoded immutable master and cumulative matrix for one imported raster. */
export interface ProjectRasterLayerSourceV1 {
  readonly schemaVersion: typeof PROJECT_DOCUMENT_SCHEMA_VERSION;
  readonly assetId: string;
  readonly sourceName: string;
  readonly mimeType: string;
  readonly sourceBytes: number;
  readonly width: number;
  readonly height: number;
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly rotation: number;
  readonly blob: Blob;
}

/** Structured-clone-safe equivalent of the engine's CPU-side LayerRecord. */
export interface ProjectLayerV1 {
  readonly schemaVersion: typeof PROJECT_DOCUMENT_SCHEMA_VERSION;
  readonly id: number;
  readonly name: string;
  readonly visible: boolean;
  readonly opacity: number;
  readonly blendMode: LayerBlendMode;
  readonly clippingParentId: number | null;
  readonly contentBounds: ProjectRectV1 | null;
  readonly storageTileMask: Uint32Array;
  readonly hasContent: boolean;
  readonly noiseMipSmoothing: boolean;
  /** Optional for backward-compatible V1 manifests saved before source retention. */
  readonly rasterSource?: ProjectRasterLayerSourceV1 | null;
  readonly strokeStyle: RasterStrokeStyle;
  readonly bevelStyle: RasterBevelStyle;
  readonly outerShadowStyle: RasterOuterShadowStyle;
  readonly innerShadowStyle: RasterInnerShadowStyle;
  readonly colorOverlayStyle: RasterColorOverlayStyle;
  readonly pixels: ProjectLayerPixelsV1 | null;
}

export interface ProjectViewStateV1 {
  readonly schemaVersion: typeof PROJECT_DOCUMENT_SCHEMA_VERSION;
  readonly centerX: number;
  readonly centerY: number;
  readonly zoom: number;
  readonly rotationRadians: number;
}

export interface ProjectDocumentBackgroundV1 {
  readonly schemaVersion: typeof PROJECT_DOCUMENT_SCHEMA_VERSION;
  readonly visible: boolean;
  readonly color: string;
}

/**
 * Versioned wrapper over the pure MixedSceneState. SVG path typed arrays stay
 * typed arrays under structured clone; image/GPU resources must not be added.
 */
export interface ProjectMixedSceneStateV1 extends MixedSceneState {
  readonly schemaVersion: typeof PROJECT_DOCUMENT_SCHEMA_VERSION;
}

export interface ProjectSnapshotV1 {
  readonly schemaVersion: typeof PROJECT_DOCUMENT_SCHEMA_VERSION;
  readonly document: ProjectDocumentDescriptorV1;
  readonly layers: readonly ProjectLayerV1[];
  readonly activeRasterLayerId: number;
  readonly referenceRasterLayerId: number | null;
  readonly mixedScene: ProjectMixedSceneStateV1;
  readonly view: ProjectViewStateV1;
  /** Optional for V1 projects saved before the structural background existed. */
  readonly background?: ProjectDocumentBackgroundV1;
  /** Current editor brush; Undo/Redo history remains deliberately session-only. */
  readonly brushSettings: BrushSettings;
}

export interface ProjectManifestV1 {
  readonly magic: typeof PROJECT_MANIFEST_MAGIC;
  readonly schemaVersion: typeof PROJECT_DOCUMENT_SCHEMA_VERSION;
  readonly projectId: string;
  readonly generationId: string;
  readonly projectName: string;
  readonly createdAt: number;
  readonly savedAt: number;
  readonly snapshot: ProjectSnapshotV1;
}

/** Bytes supplied by the engine for one descriptor in a ProjectLayerV1. */
export interface ProjectChunkWriteV1 {
  readonly schemaVersion: typeof PROJECT_DOCUMENT_SCHEMA_VERSION;
  readonly layerId: number;
  readonly chunkIndex: number;
  readonly storage: LayerCompressionStorage;
  readonly rawBytes: number;
  readonly storedBytes: number;
  readonly sourceHash: number;
  readonly bytes: ArrayBuffer;
}

/** The record stored in IndexedDB. All key material is repeated for indexes. */
export interface ProjectStoredChunkV1 extends ProjectChunkWriteV1 {
  readonly key: string;
  readonly projectId: string;
  readonly generationId: string;
  readonly generationKey: string;
}

export interface ProjectSaveRequestV1 {
  readonly schemaVersion: typeof PROJECT_DOCUMENT_SCHEMA_VERSION;
  /** Omit for a new project; pass the existing id to publish a new generation. */
  readonly projectId?: string;
  readonly name: string;
  /** Used only when creating/importing a project. Existing projects keep theirs. */
  readonly createdAt?: number;
  /** Undefined preserves an existing thumbnail; null explicitly clears it. */
  readonly thumbnail?: Blob | null;
  readonly snapshot: ProjectSnapshotV1;
  readonly chunks: readonly ProjectChunkWriteV1[];
}

export interface ProjectLoadResultV1 {
  readonly summary: ProjectSummaryV1;
  readonly manifest: ProjectManifestV1;
  readonly chunks: readonly ProjectStoredChunkV1[];
}

export type ProjectStorageBackend = "uninitialized" | "indexeddb" | "memory";

export interface ProjectStorageQuotaEstimate {
  readonly usageBytes: number | null;
  readonly quotaBytes: number | null;
  readonly availableBytes: number | null;
  readonly persisted: boolean | null;
  readonly backend?: Exclude<ProjectStorageBackend, "uninitialized">;
}

export interface ProjectStorageCapacity {
  readonly requiredBytes: number;
  readonly availableBytes: number | null;
  readonly reserveBytes: number | null;
  /** Null means the browser did not expose a quota estimate. */
  readonly fits: boolean | null;
}

export interface ProjectStorageManagerLike {
  estimate?: () => Promise<StorageEstimate>;
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
}

export interface ProjectStorageOptions {
  readonly databaseName?: string;
  /** Passing null explicitly exercises the in-memory fallback. */
  readonly indexedDB?: IDBFactory | null;
  readonly storageManager?: ProjectStorageManagerLike | null;
  readonly forceMemory?: boolean;
}

export type ProjectStorageErrorCode =
  | "database"
  | "not-found"
  | "quota"
  | "unavailable"
  | "validation";

export class ProjectStorageError extends Error {
  readonly code: ProjectStorageErrorCode;
  override readonly cause: unknown;

  constructor(
    message: string,
    code: ProjectStorageErrorCode = "database",
    cause?: unknown,
  ) {
    super(message);
    this.name = "ProjectStorageError";
    this.code = code;
    this.cause = cause;
  }
}

export class ProjectStorageValidationError extends ProjectStorageError {
  readonly path: string;

  constructor(message: string, path = "project") {
    super(`${path}: ${message}`, "validation");
    this.name = "ProjectStorageValidationError";
    this.path = path;
  }
}

interface StoredManifestRecord {
  readonly key: string;
  readonly projectId: string;
  readonly generationId: string;
  readonly manifest: ProjectManifestV1;
}

interface MemoryDatabase {
  readonly projects: Map<string, ProjectSummaryV1>;
  readonly manifests: Map<string, StoredManifestRecord>;
  readonly chunks: Map<string, ProjectStoredChunkV1>;
}

const MEMORY_DATABASES = new Map<string, MemoryDatabase>();

function memoryDatabase(name: string): MemoryDatabase {
  let database = MEMORY_DATABASES.get(name);
  if (!database) {
    database = {
      projects: new Map(),
      manifests: new Map(),
      chunks: new Map(),
    };
    MEMORY_DATABASES.set(name, database);
  }
  return database;
}

function manifestKey(projectId: string, generationId: string): string {
  return `${projectId}|${generationId}`;
}

function chunkKey(
  projectId: string,
  generationId: string,
  layerId: number,
  chunkIndex: number,
): string {
  return `${manifestKey(projectId, generationId)}|${layerId}|${chunkIndex}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(path: string, message: string): never {
  throw new ProjectStorageValidationError(message, path);
}

function assertSchemaVersion(value: unknown, path: string): void {
  if (value !== PROJECT_DOCUMENT_SCHEMA_VERSION) {
    fail(path, `unsupported schema version ${String(value)}`);
  }
}

function assertFinite(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(path, "must be a finite number");
  }
}

function assertNonNegativeInteger(
  value: unknown,
  path: string,
): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail(path, "must be a non-negative safe integer");
  }
}

function assertPositiveInteger(
  value: unknown,
  path: string,
): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    fail(path, "must be a positive safe integer");
  }
}

function assertBoolean(value: unknown, path: string): asserts value is boolean {
  if (typeof value !== "boolean") fail(path, "must be boolean");
}

function assertString(
  value: unknown,
  path: string,
  maximum = 16_384,
): asserts value is string {
  if (typeof value !== "string" || value.length > maximum) {
    fail(path, `must be a string of at most ${maximum} characters`);
  }
}

function assertUnitInterval(value: unknown, path: string): asserts value is number {
  assertFinite(value, path);
  if (value < 0 || value > 1) fail(path, "must be between 0 and 1");
}

function assertProjectId(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !PROJECT_ID_PATTERN.test(value)) {
    fail(path, "contains unsupported project-id characters");
  }
}

function assertGenerationId(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !GENERATION_ID_PATTERN.test(value)) {
    fail(path, "contains unsupported generation-id characters");
  }
}

function assertPlainStructuredValue(
  value: unknown,
  path: string,
  seen = new WeakSet<object>(),
): void {
  if (
    value === null
    || value === undefined
    || typeof value === "string"
    || typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(path, "contains a non-finite number");
    return;
  }
  if (typeof value !== "object") {
    fail(path, `contains non-cloneable ${typeof value}`);
  }
  const objectValue = value as object;
  if (seen.has(objectValue)) fail(path, "must not contain cyclic references");
  if (value instanceof ArrayBuffer) return;
  if (ArrayBuffer.isView(value)) {
    if (!(value.buffer instanceof ArrayBuffer)) {
      fail(path, "SharedArrayBuffer-backed views are not supported");
    }
    return;
  }
  if (typeof Blob !== "undefined" && value instanceof Blob) return;

  seen.add(objectValue);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      assertPlainStructuredValue(entry, `${path}[${index}]`, seen);
    });
    seen.delete(objectValue);
    return;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(path, "contains a non-DTO object (DOM, GPU, Map, Set, or class instance)");
  }
  for (const [key, entry] of Object.entries(value)) {
    assertPlainStructuredValue(entry, `${path}.${key}`, seen);
  }
  seen.delete(objectValue);
}

function cloneFallback(
  value: unknown,
  seen = new WeakMap<object, unknown>(),
): unknown {
  if (value === null || typeof value !== "object") return value;
  const existing = seen.get(value);
  if (existing !== undefined) return existing;
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (ArrayBuffer.isView(value)) {
    const source = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const copied = source.slice().buffer;
    if (value instanceof DataView) return new DataView(copied);
    const Constructor = value.constructor as unknown as {
      new (buffer: ArrayBuffer): ArrayBufferView;
    };
    return new Constructor(copied);
  }
  if (typeof Blob !== "undefined" && value instanceof Blob) {
    return value.slice(0, value.size, value.type);
  }
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    value.forEach((entry) => copy.push(cloneFallback(entry, seen)));
    return copy;
  }
  const copy: Record<string, unknown> = {};
  seen.set(value, copy);
  for (const [key, entry] of Object.entries(value)) {
    copy[key] = cloneFallback(entry, seen);
  }
  return copy;
}

function cloneStructured<T>(value: T): T {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return cloneFallback(value) as T;
}

export function normalizeProjectTitle(name: string): string {
  const normalized = String(name ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, PROJECT_STORAGE_MAX_TITLE_LENGTH);
  return normalized || "Untitled Artwork";
}

let fallbackIdSequence = 0;

function uniqueToken(prefix: "project" | "generation"): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}-${uuid}`;
  fallbackIdSequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${fallbackIdSequence.toString(36)}`;
}

function assertRect(
  value: unknown,
  document: ProjectDocumentDescriptorV1,
  path: string,
): asserts value is ProjectRectV1 {
  if (!isRecord(value)) fail(path, "must be a rectangle object");
  assertFinite(value.x, `${path}.x`);
  assertFinite(value.y, `${path}.y`);
  assertFinite(value.width, `${path}.width`);
  assertFinite(value.height, `${path}.height`);
  if (value.width <= 0 || value.height <= 0) {
    fail(path, "must have positive dimensions");
  }
  if (
    value.x < 0
    || value.y < 0
    || value.x + value.width > document.width
    || value.y + value.height > document.height
  ) {
    fail(path, "must stay inside the document");
  }
}

function assertColorTuple(
  value: unknown,
  length: 3 | 4,
  path: string,
): void {
  if (!Array.isArray(value) || value.length !== length) {
    fail(path, `must contain ${length} color channels`);
  }
  value.forEach((channel, index) => {
    assertFinite(channel, `${path}[${index}]`);
    if (channel < 0 || channel > 1) {
      fail(`${path}[${index}]`, "must be between 0 and 1");
    }
  });
}

function assertLayerStyles(layer: Record<string, unknown>, path: string): void {
  const stroke = layer.strokeStyle;
  if (!isRecord(stroke)) fail(`${path}.strokeStyle`, "must be an object");
  assertBoolean(stroke.enabled, `${path}.strokeStyle.enabled`);
  assertFinite(stroke.width, `${path}.strokeStyle.width`);
  if (stroke.width < 0) fail(`${path}.strokeStyle.width`, "must be non-negative");
  if (!new Set(["inside", "center", "outside"]).has(String(stroke.position))) {
    fail(`${path}.strokeStyle.position`, "is unsupported");
  }
  assertColorTuple(stroke.color, 4, `${path}.strokeStyle.color`);

  const bevel = layer.bevelStyle;
  if (!isRecord(bevel)) fail(`${path}.bevelStyle`, "must be an object");
  assertBoolean(bevel.enabled, `${path}.bevelStyle.enabled`);

  const outer = layer.outerShadowStyle;
  if (!isRecord(outer)) fail(`${path}.outerShadowStyle`, "must be an object");
  assertBoolean(outer.enabled, `${path}.outerShadowStyle.enabled`);

  const inner = layer.innerShadowStyle;
  if (!isRecord(inner)) fail(`${path}.innerShadowStyle`, "must be an object");
  assertBoolean(inner.enabled, `${path}.innerShadowStyle.enabled`);

  const overlay = layer.colorOverlayStyle;
  if (!isRecord(overlay)) fail(`${path}.colorOverlayStyle`, "must be an object");
  assertBoolean(overlay.enabled, `${path}.colorOverlayStyle.enabled`);
  assertColorTuple(overlay.color, 3, `${path}.colorOverlayStyle.color`);
  if (overlay.uniformAlpha !== undefined) {
    assertBoolean(
      overlay.uniformAlpha,
      `${path}.colorOverlayStyle.uniformAlpha`,
    );
  }
  assertFinite(overlay.opacity, `${path}.colorOverlayStyle.opacity`);
  if (overlay.opacity < 0 || overlay.opacity > 100) {
    fail(`${path}.colorOverlayStyle.opacity`, "must be between 0 and 100");
  }
}

function tileMaskIndices(mask: Uint32Array): number[] {
  const indices: number[] = [];
  for (let tileIndex = 0; tileIndex < PROJECT_STORAGE_TILE_COUNT; tileIndex += 1) {
    const word = mask[tileIndex >>> 5] >>> 0;
    if (((word >>> (tileIndex & 31)) & 1) !== 0) indices.push(tileIndex);
  }
  return indices;
}

function tileOriginIsInsideDocument(
  tileIndex: number,
  document: ProjectDocumentDescriptorV1,
): boolean {
  const tileWidth = Math.ceil(document.width / document.tileGridSize);
  const tileHeight = Math.ceil(document.height / document.tileGridSize);
  const tileX = tileIndex % document.tileGridSize;
  const tileY = Math.floor(tileIndex / document.tileGridSize);
  return tileX * tileWidth < document.width
    && tileY * tileHeight < document.height;
}

function assertLayerPixels(
  value: unknown,
  document: ProjectDocumentDescriptorV1,
  maskIndices: readonly number[],
  path: string,
): asserts value is ProjectLayerPixelsV1 {
  if (!isRecord(value)) fail(path, "must be an object");
  assertSchemaVersion(value.schemaVersion, `${path}.schemaVersion`);
  if (value.format !== document.layerFormat) {
    fail(`${path}.format`, "must match the document layer format");
  }
  if (!Array.isArray(value.tileIndices)) {
    fail(`${path}.tileIndices`, "must be an array");
  }
  const tileIndices = value.tileIndices as unknown[];
  let previousTile = -1;
  tileIndices.forEach((tileIndex, index) => {
    assertNonNegativeInteger(tileIndex, `${path}.tileIndices[${index}]`);
    if (tileIndex >= PROJECT_STORAGE_TILE_COUNT) {
      fail(`${path}.tileIndices[${index}]`, "is outside the document tile grid");
    }
    const tileWidth = Math.ceil(document.width / document.tileGridSize);
    const tileHeight = Math.ceil(document.height / document.tileGridSize);
    const tileX = (tileIndex as number) % document.tileGridSize;
    const tileY = Math.floor((tileIndex as number) / document.tileGridSize);
    if (tileX * tileWidth >= document.width || tileY * tileHeight >= document.height) {
      fail(`${path}.tileIndices[${index}]`, "starts outside the document extent");
    }
    if (tileIndex <= previousTile) {
      fail(`${path}.tileIndices`, "must be strictly increasing and unique");
    }
    previousTile = tileIndex;
  });
  if (
    tileIndices.length !== maskIndices.length
    || tileIndices.some((tileIndex, index) => tileIndex !== maskIndices[index])
  ) {
    const differingIndex = tileIndices.findIndex(
      (tileIndex, index) => tileIndex !== maskIndices[index],
    );
    const firstMismatch = differingIndex >= 0
      ? differingIndex
      : Math.min(tileIndices.length, maskIndices.length);
    fail(
      `${path}.tileIndices`,
      "must exactly match storageTileMask "
        + `(pixels=${tileIndices.length}, mask=${maskIndices.length}, `
        + `first=${String(tileIndices[firstMismatch])}/${String(maskIndices[firstMismatch])})`,
    );
  }

  if (!Array.isArray(value.chunks)) fail(`${path}.chunks`, "must be an array");
  assertNonNegativeInteger(value.rawBytes, `${path}.rawBytes`);
  assertNonNegativeInteger(value.storedBytes, `${path}.storedBytes`);
  assertNonNegativeInteger(value.sourceHash, `${path}.sourceHash`);
  if (value.sourceHash > 0xffff_ffff) {
    fail(`${path}.sourceHash`, "must be an unsigned 32-bit integer");
  }
  assertNonNegativeInteger(value.generation, `${path}.generation`);

  // The logical mask always has 16 × 16 slots. Non-divisible and rectangular
  // documents store each slot in a normalized, zero-padded rectangular tile;
  // edge clipping is an engine concern and does not change the payload stride.
  const tileWidth = Math.ceil(document.width / document.tileGridSize);
  const tileHeight = Math.ceil(document.height / document.tileGridSize);
  const bytesPerPixel = document.layerFormat === "rgba16float" ? 8 : 4;
  const tileBytes = tileWidth * tileHeight * bytesPerPixel;
  const expectedRawBytes = tileIndices.length * tileBytes;
  if (value.rawBytes !== expectedRawBytes) {
    fail(`${path}.rawBytes`, `must equal ${expectedRawBytes} bytes for its tiles`);
  }

  let firstTileOffset = 0;
  let rawBytes = 0;
  let storedBytes = 0;
  (value.chunks as unknown[]).forEach((entry, index) => {
    const chunkPath = `${path}.chunks[${index}]`;
    if (!isRecord(entry)) fail(chunkPath, "must be an object");
    assertSchemaVersion(entry.schemaVersion, `${chunkPath}.schemaVersion`);
    if (entry.chunkIndex !== index) {
      fail(`${chunkPath}.chunkIndex`, "must be contiguous from zero");
    }
    if (entry.firstTileOffset !== firstTileOffset) {
      fail(`${chunkPath}.firstTileOffset`, "must continue the prior chunk");
    }
    assertPositiveInteger(entry.tileCount, `${chunkPath}.tileCount`);
    if (!new Set(["gzip", "gzip-shuffle16", "raw"]).has(String(entry.storage))) {
      fail(`${chunkPath}.storage`, "is not a supported compression storage mode");
    }
    assertPositiveInteger(entry.rawBytes, `${chunkPath}.rawBytes`);
    assertPositiveInteger(entry.storedBytes, `${chunkPath}.storedBytes`);
    if (entry.storedBytes > PROJECT_STORAGE_MAX_CHUNK_BYTES) {
      fail(`${chunkPath}.storedBytes`, "exceeds the chunk size limit");
    }
    if (entry.rawBytes !== entry.tileCount * tileBytes) {
      fail(`${chunkPath}.rawBytes`, "does not match tileCount");
    }
    assertNonNegativeInteger(entry.sourceHash, `${chunkPath}.sourceHash`);
    if (entry.sourceHash > 0xffff_ffff) {
      fail(`${chunkPath}.sourceHash`, "must be an unsigned 32-bit integer");
    }
    firstTileOffset += entry.tileCount;
    rawBytes += entry.rawBytes;
    storedBytes += entry.storedBytes;
  });
  if (firstTileOffset !== tileIndices.length) {
    fail(`${path}.chunks`, "must cover every packed tile exactly once");
  }
  if (rawBytes !== value.rawBytes || storedBytes !== value.storedBytes) {
    fail(path, "chunk byte totals do not match the layer totals");
  }
}

function assertDocument(
  value: unknown,
  path: string,
): asserts value is ProjectDocumentDescriptorV1 {
  if (!isRecord(value)) fail(path, "must be an object");
  assertSchemaVersion(value.schemaVersion, `${path}.schemaVersion`);
  assertDocumentDimensions(value.width, value.height, path);
  if (value.layerFormat !== "rgba8unorm" && value.layerFormat !== "rgba16float") {
    fail(`${path}.layerFormat`, "is unsupported");
  }
  if (value.tileGridSize !== PROJECT_STORAGE_TILE_GRID_SIZE) {
    fail(`${path}.tileGridSize`, "is unsupported");
  }
  if (value.colorSpace !== "linear-premultiplied") {
    fail(`${path}.colorSpace`, "is unsupported");
  }
}

function assertDocumentDimensions(
  width: unknown,
  height: unknown,
  path: string,
): asserts width is number {
  if (!Number.isInteger(width)) fail(`${path}.width`, "must be a whole number of pixels");
  if (!Number.isInteger(height)) fail(`${path}.height`, "must be a whole number of pixels");
  if (
    width === PROJECT_STORAGE_LEGACY_DOCUMENT_DIMENSION
    && height === PROJECT_STORAGE_LEGACY_DOCUMENT_DIMENSION
  ) {
    return;
  }
  if (
    (width as number) < PROJECT_STORAGE_MIN_DOCUMENT_DIMENSION
    || (width as number) > PROJECT_STORAGE_MAX_DOCUMENT_DIMENSION
  ) {
    fail(
      `${path}.width`,
      `must be between ${PROJECT_STORAGE_MIN_DOCUMENT_DIMENSION} and `
        + `${PROJECT_STORAGE_MAX_DOCUMENT_DIMENSION} pixels`,
    );
  }
  if (
    (height as number) < PROJECT_STORAGE_MIN_DOCUMENT_DIMENSION
    || (height as number) > PROJECT_STORAGE_MAX_DOCUMENT_DIMENSION
  ) {
    fail(
      `${path}.height`,
      `must be between ${PROJECT_STORAGE_MIN_DOCUMENT_DIMENSION} and `
        + `${PROJECT_STORAGE_MAX_DOCUMENT_DIMENSION} pixels`,
    );
  }
}

function assertLayer(
  value: unknown,
  document: ProjectDocumentDescriptorV1,
  path: string,
): asserts value is ProjectLayerV1 {
  if (!isRecord(value)) fail(path, "must be an object");
  assertSchemaVersion(value.schemaVersion, `${path}.schemaVersion`);
  assertPositiveInteger(value.id, `${path}.id`);
  assertString(value.name, `${path}.name`, 160);
  if (value.name.trim().length === 0) fail(`${path}.name`, "must not be blank");
  assertBoolean(value.visible, `${path}.visible`);
  assertUnitInterval(value.opacity, `${path}.opacity`);
  const migratedBlendMode = migrateLegacyLayerBlendMode(value.blendMode);
  if (migratedBlendMode === null) {
    fail(`${path}.blendMode`, "is unsupported");
  }
  if (value.blendMode === "shade") {
    // Loaded IDB manifests are structured clones and therefore mutable.
    // Rewrite only the retired value: canonical save inputs (which callers may
    // freeze) remain validation-only and are never assigned to.
    value.blendMode = migratedBlendMode;
  }
  if (value.clippingParentId !== null) {
    assertPositiveInteger(value.clippingParentId, `${path}.clippingParentId`);
  }
  assertBoolean(value.hasContent, `${path}.hasContent`);
  assertBoolean(value.noiseMipSmoothing, `${path}.noiseMipSmoothing`);
  if (value.rasterSource !== undefined && value.rasterSource !== null) {
    const source = value.rasterSource;
    if (!isRecord(source)) fail(`${path}.rasterSource`, "must be an object or null");
    assertSchemaVersion(source.schemaVersion, `${path}.rasterSource.schemaVersion`);
    assertString(source.assetId, `${path}.rasterSource.assetId`, 256);
    assertString(source.sourceName, `${path}.rasterSource.sourceName`, 512);
    assertString(source.mimeType, `${path}.rasterSource.mimeType`, 256);
    assertNonNegativeInteger(source.sourceBytes, `${path}.rasterSource.sourceBytes`);
    if ((source.sourceBytes as number) > PROJECT_STORAGE_MAX_RASTER_SOURCE_BYTES) {
      fail(`${path}.rasterSource.sourceBytes`, "exceeds the raster source size limit");
    }
    assertPositiveInteger(source.width, `${path}.rasterSource.width`);
    assertPositiveInteger(source.height, `${path}.rasterSource.height`);
    assertFinite(source.x, `${path}.rasterSource.x`);
    assertFinite(source.y, `${path}.rasterSource.y`);
    assertFinite(source.scale, `${path}.rasterSource.scale`);
    if ((source.scale as number) <= 0) fail(`${path}.rasterSource.scale`, "must be positive");
    assertFinite(source.rotation, `${path}.rasterSource.rotation`);
    if (!(source.blob instanceof Blob)) {
      fail(`${path}.rasterSource.blob`, "must be a Blob");
    }
    if (source.blob.size !== source.sourceBytes) {
      fail(`${path}.rasterSource.blob`, "size must match sourceBytes");
    }
  }
  if (!(value.storageTileMask instanceof Uint32Array)) {
    fail(`${path}.storageTileMask`, "must be a Uint32Array");
  }
  if (value.storageTileMask.length !== PROJECT_STORAGE_TILE_MASK_WORDS) {
    fail(`${path}.storageTileMask`, `must contain ${PROJECT_STORAGE_TILE_MASK_WORDS} words`);
  }
  assertLayerStyles(value, path);

  if (value.contentBounds !== null) {
    assertRect(value.contentBounds, document, `${path}.contentBounds`);
  }
  const maskIndices = tileMaskIndices(value.storageTileMask);
  maskIndices.forEach((tileIndex) => {
    if (!tileOriginIsInsideDocument(tileIndex, document)) {
      fail(
        `${path}.storageTileMask`,
        `contains tile ${tileIndex}, whose origin lies outside the document`,
      );
    }
  });
  if (value.hasContent) {
    if (value.contentBounds === null) fail(`${path}.contentBounds`, "is required for content");
    if (maskIndices.length === 0) fail(`${path}.storageTileMask`, "must retain content tiles");
    assertLayerPixels(value.pixels, document, maskIndices, `${path}.pixels`);
  } else {
    if (value.contentBounds !== null) fail(`${path}.contentBounds`, "must be null when empty");
    if (maskIndices.length !== 0) fail(`${path}.storageTileMask`, "must be empty when no content exists");
    if (value.pixels !== null) fail(`${path}.pixels`, "must be null when no content exists");
  }
}

function assertSemanticNodeBasics(
  value: unknown,
  expectedKind: "text" | "svg" | "image",
  path: string,
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) fail(path, "must be an object");
  assertPositiveInteger(value.id, `${path}.id`);
  if (value.kind !== expectedKind) fail(`${path}.kind`, `must be ${expectedKind}`);
  assertString(value.name, `${path}.name`, 160);
  assertBoolean(value.visible, `${path}.visible`);
  assertUnitInterval(value.opacity, `${path}.opacity`);
  for (const coordinate of ["x", "y", "scale", "rotation"] as const) {
    assertFinite(value[coordinate], `${path}.${coordinate}`);
  }
  if ((value.scale as number) <= 0) fail(`${path}.scale`, "must be positive");
}

function assertMixedScene(
  value: unknown,
  layers: readonly ProjectLayerV1[],
  path: string,
): asserts value is ProjectMixedSceneStateV1 {
  if (!isRecord(value)) fail(path, "must be an object");
  assertSchemaVersion(value.schemaVersion, `${path}.schemaVersion`);
  if (!Array.isArray(value.items)) fail(`${path}.items`, "must be an array");
  if (!Array.isArray(value.textNodes)) fail(`${path}.textNodes`, "must be an array");
  if (!Array.isArray(value.svgNodes)) fail(`${path}.svgNodes`, "must be an array");
  if (!Array.isArray(value.imageNodes)) fail(`${path}.imageNodes`, "must be an array");

  const nodesByKind = {
    text: new Set<number>(),
    svg: new Set<number>(),
    image: new Set<number>(),
  };
  (value.textNodes as unknown[]).forEach((node, index) => {
    const nodePath = `${path}.textNodes[${index}]`;
    assertSemanticNodeBasics(node, "text", nodePath);
    if (nodesByKind.text.has(node.id as number)) fail(`${nodePath}.id`, "is duplicated");
    nodesByKind.text.add(node.id as number);
  });
  (value.svgNodes as unknown[]).forEach((node, index) => {
    const nodePath = `${path}.svgNodes[${index}]`;
    assertSemanticNodeBasics(node, "svg", nodePath);
    if (!isRecord(node.document)) fail(`${nodePath}.document`, "must be an SVG DTO");
    if (!Array.isArray(node.paintColors)) fail(`${nodePath}.paintColors`, "must be an array");
    if (nodesByKind.svg.has(node.id as number)) fail(`${nodePath}.id`, "is duplicated");
    nodesByKind.svg.add(node.id as number);
  });
  (value.imageNodes as unknown[]).forEach((node, index) => {
    const nodePath = `${path}.imageNodes[${index}]`;
    assertSemanticNodeBasics(node, "image", nodePath);
    if (!isRecord(node.document)) fail(`${nodePath}.document`, "must be an image DTO");
    assertString(node.document.assetId, `${nodePath}.document.assetId`, 256);
    assertString(node.document.mimeType, `${nodePath}.document.mimeType`, 256);
    assertPositiveInteger(node.document.width, `${nodePath}.document.width`);
    assertPositiveInteger(node.document.height, `${nodePath}.document.height`);
    if (nodesByKind.image.has(node.id as number)) fail(`${nodePath}.id`, "is duplicated");
    nodesByKind.image.add(node.id as number);
  });

  const rasterIds = new Set(layers.map((layer) => layer.id));
  const seenRasterIds = new Set<number>();
  const seenTextIds = new Set<number>();
  const seenSvgIds = new Set<number>();
  const seenImageIds = new Set<number>();
  const seenKeys = new Set<string>();
  (value.items as unknown[]).forEach((item, index) => {
    const itemPath = `${path}.items[${index}]`;
    if (!isRecord(item)) fail(itemPath, "must be an object");
    assertString(item.key, `${itemPath}.key`, 192);
    if (seenKeys.has(item.key)) fail(`${itemPath}.key`, "is duplicated");
    seenKeys.add(item.key);
    if (item.kind === "raster") {
      assertPositiveInteger(item.rasterLayerId, `${itemPath}.rasterLayerId`);
      if (item.key !== `raster:${item.rasterLayerId}`) fail(`${itemPath}.key`, "does not match id");
      if (!rasterIds.has(item.rasterLayerId)) fail(itemPath, "references a missing raster layer");
      if (seenRasterIds.has(item.rasterLayerId)) fail(itemPath, "duplicates a raster layer");
      seenRasterIds.add(item.rasterLayerId);
    } else if (item.kind === "text") {
      assertPositiveInteger(item.textNodeId, `${itemPath}.textNodeId`);
      if (item.key !== `text:${item.textNodeId}`) fail(`${itemPath}.key`, "does not match id");
      if (!nodesByKind.text.has(item.textNodeId)) fail(itemPath, "references missing text");
      seenTextIds.add(item.textNodeId);
    } else if (item.kind === "svg") {
      assertPositiveInteger(item.svgNodeId, `${itemPath}.svgNodeId`);
      if (item.key !== `svg:${item.svgNodeId}`) fail(`${itemPath}.key`, "does not match id");
      if (!nodesByKind.svg.has(item.svgNodeId)) fail(itemPath, "references missing SVG");
      seenSvgIds.add(item.svgNodeId);
    } else if (item.kind === "image") {
      assertPositiveInteger(item.imageNodeId, `${itemPath}.imageNodeId`);
      if (item.key !== `image:${item.imageNodeId}`) fail(`${itemPath}.key`, "does not match id");
      if (!nodesByKind.image.has(item.imageNodeId)) fail(itemPath, "references missing image");
      seenImageIds.add(item.imageNodeId);
    } else {
      fail(`${itemPath}.kind`, "is unsupported");
    }
  });
  if (seenRasterIds.size !== rasterIds.size) {
    fail(`${path}.items`, "must contain every raster layer exactly once");
  }
  if (
    seenTextIds.size !== nodesByKind.text.size
    || seenSvgIds.size !== nodesByKind.svg.size
    || seenImageIds.size !== nodesByKind.image.size
  ) {
    fail(`${path}.items`, "must contain every semantic node exactly once");
  }
  const sceneIndexByRasterId = new Map<number, number>();
  (value.items as Record<string, unknown>[]).forEach((item, index) => {
    if (item.kind === "raster") sceneIndexByRasterId.set(item.rasterLayerId as number, index);
  });
  layers.forEach((base) => {
    if (base.clippingParentId !== null) return;
    const dependents = layers.filter((layer) => layer.clippingParentId === base.id);
    const baseSceneIndex = sceneIndexByRasterId.get(base.id);
    if (baseSceneIndex === undefined) return;
    dependents.forEach((dependent, offset) => {
      if (sceneIndexByRasterId.get(dependent.id) !== baseSceneIndex + offset + 1) {
        fail(
          `${path}.items`,
          `clipping group for raster ${base.id} must remain contiguous in the mixed scene`,
        );
      }
    });
  });
  if (typeof value.selectedKey !== "string" || !seenKeys.has(value.selectedKey)) {
    fail(`${path}.selectedKey`, "must select an existing scene item");
  }
  for (const [kind, idSet, nextName] of [
    ["text", nodesByKind.text, "nextTextNodeId"],
    ["svg", nodesByKind.svg, "nextSvgNodeId"],
    ["image", nodesByKind.image, "nextImageNodeId"],
  ] as const) {
    const nextId = value[nextName];
    assertPositiveInteger(nextId, `${path}.${nextName}`);
    const maximum = idSet.size > 0 ? Math.max(...idSet) : 0;
    if (nextId <= maximum) fail(`${path}.${nextName}`, `must exceed every ${kind} id`);
  }
}

function assertSnapshot(
  value: unknown,
  path: string,
): asserts value is ProjectSnapshotV1 {
  if (!isRecord(value)) fail(path, "must be an object");
  assertSchemaVersion(value.schemaVersion, `${path}.schemaVersion`);
  const document = value.document;
  assertDocument(document, `${path}.document`);
  if (!Array.isArray(value.layers)) fail(`${path}.layers`, "must be an array");
  if (value.layers.length < 1 || value.layers.length > PROJECT_STORAGE_MAX_LAYERS) {
    fail(`${path}.layers`, `must contain 1 to ${PROJECT_STORAGE_MAX_LAYERS} layers`);
  }
  const layers = value.layers as unknown[];
  const layerIds = new Set<number>();
  layers.forEach((layer, index) => {
    assertLayer(layer, document, `${path}.layers[${index}]`);
    if (layerIds.has(layer.id)) fail(`${path}.layers[${index}].id`, "is duplicated");
    layerIds.add(layer.id);
  });

  layers.forEach((layer, index) => {
    if (!isRecord(layer) || layer.clippingParentId === null) return;
    const parentIndex = layers.findIndex(
      (candidate) => isRecord(candidate) && candidate.id === layer.clippingParentId,
    );
    if (parentIndex < 0) fail(`${path}.layers[${index}].clippingParentId`, "is missing");
    if (parentIndex >= index) {
      fail(`${path}.layers[${index}].clippingParentId`, "must be below the clipped layer");
    }
    const parent = layers[parentIndex] as Record<string, unknown>;
    if (parent.clippingParentId !== null) {
      fail(`${path}.layers[${index}].clippingParentId`, "must target an unclipped base");
    }
  });
  layers.forEach((parent, parentIndex) => {
    if (!isRecord(parent) || parent.clippingParentId !== null) return;
    const dependents = layers
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => isRecord(candidate) && candidate.clippingParentId === parent.id)
      .map(({ index }) => index);
    dependents.forEach((dependentIndex, offset) => {
      if (dependentIndex !== parentIndex + offset + 1) {
        fail(`${path}.layers`, `clipping group for layer ${String(parent.id)} is not contiguous`);
      }
    });
  });

  assertPositiveInteger(value.activeRasterLayerId, `${path}.activeRasterLayerId`);
  if (!layerIds.has(value.activeRasterLayerId)) {
    fail(`${path}.activeRasterLayerId`, "does not exist in layers");
  }
  if (value.referenceRasterLayerId !== null) {
    assertPositiveInteger(value.referenceRasterLayerId, `${path}.referenceRasterLayerId`);
    if (!layerIds.has(value.referenceRasterLayerId)) {
      fail(`${path}.referenceRasterLayerId`, "does not exist in layers");
    }
  }
  assertMixedScene(value.mixedScene, value.layers, `${path}.mixedScene`);

  if (!isRecord(value.view)) fail(`${path}.view`, "must be an object");
  assertSchemaVersion(value.view.schemaVersion, `${path}.view.schemaVersion`);
  assertFinite(value.view.centerX, `${path}.view.centerX`);
  assertFinite(value.view.centerY, `${path}.view.centerY`);
  assertFinite(value.view.zoom, `${path}.view.zoom`);
  if (value.view.zoom <= 0) fail(`${path}.view.zoom`, "must be positive");
  assertFinite(value.view.rotationRadians, `${path}.view.rotationRadians`);

  if (value.background !== undefined) {
    if (!isRecord(value.background)) fail(`${path}.background`, "must be an object");
    assertSchemaVersion(value.background.schemaVersion, `${path}.background.schemaVersion`);
    assertBoolean(value.background.visible, `${path}.background.visible`);
    assertString(value.background.color, `${path}.background.color`, 7);
    if (!/^#[0-9a-f]{6}$/i.test(String(value.background.color))) {
      fail(`${path}.background.color`, "must be a six-digit hexadecimal color");
    }
  }

  if (!isRecord(value.brushSettings)) {
    fail(`${path}.brushSettings`, "must be an object");
  }
  assertString(value.brushSettings.color, `${path}.brushSettings.color`, 64);
  assertFinite(value.brushSettings.size, `${path}.brushSettings.size`);
  if (value.brushSettings.size <= 0) fail(`${path}.brushSettings.size`, "must be positive");
}

function expectedChunkDescriptors(
  snapshot: ProjectSnapshotV1,
): Map<string, ProjectLayerChunkDescriptorV1> {
  const expected = new Map<string, ProjectLayerChunkDescriptorV1>();
  for (const layer of snapshot.layers) {
    for (const descriptor of layer.pixels?.chunks ?? []) {
      expected.set(`${layer.id}:${descriptor.chunkIndex}`, descriptor);
    }
  }
  return expected;
}

function assertChunkWrite(
  value: unknown,
  path: string,
): asserts value is ProjectChunkWriteV1 {
  if (!isRecord(value)) fail(path, "must be an object");
  assertSchemaVersion(value.schemaVersion, `${path}.schemaVersion`);
  assertPositiveInteger(value.layerId, `${path}.layerId`);
  assertNonNegativeInteger(value.chunkIndex, `${path}.chunkIndex`);
  if (!new Set(["gzip", "gzip-shuffle16", "raw"]).has(String(value.storage))) {
    fail(`${path}.storage`, "is not supported");
  }
  assertPositiveInteger(value.rawBytes, `${path}.rawBytes`);
  assertPositiveInteger(value.storedBytes, `${path}.storedBytes`);
  if (value.storedBytes > PROJECT_STORAGE_MAX_CHUNK_BYTES) {
    fail(`${path}.storedBytes`, "exceeds the chunk size limit");
  }
  assertNonNegativeInteger(value.sourceHash, `${path}.sourceHash`);
  if (value.sourceHash > 0xffff_ffff) {
    fail(`${path}.sourceHash`, "must be an unsigned 32-bit integer");
  }
  if (!(value.bytes instanceof ArrayBuffer)) {
    fail(`${path}.bytes`, "must be an ArrayBuffer");
  }
  if (value.bytes.byteLength !== value.storedBytes) {
    fail(`${path}.bytes`, "byteLength must equal storedBytes");
  }
}

function assertChunkSetMatchesSnapshot(
  chunks: readonly ProjectChunkWriteV1[],
  snapshot: ProjectSnapshotV1,
  path: string,
): void {
  const expected = expectedChunkDescriptors(snapshot);
  const seen = new Set<string>();
  chunks.forEach((chunk, index) => {
    const chunkPath = `${path}[${index}]`;
    assertChunkWrite(chunk, chunkPath);
    const identity = `${chunk.layerId}:${chunk.chunkIndex}`;
    if (seen.has(identity)) fail(chunkPath, "duplicates a layer chunk");
    seen.add(identity);
    const descriptor = expected.get(identity);
    if (!descriptor) fail(chunkPath, "has no matching manifest descriptor");
    for (const field of [
      "storage",
      "rawBytes",
      "storedBytes",
      "sourceHash",
    ] as const) {
      if (chunk[field] !== descriptor[field]) {
        fail(`${chunkPath}.${field}`, "does not match the manifest descriptor");
      }
    }
  });
  if (seen.size !== expected.size) {
    const missing = [...expected.keys()].filter((identity) => !seen.has(identity));
    fail(path, `is missing ${missing.length} manifest chunk(s): ${missing.join(", ")}`);
  }
}

function assertThumbnail(value: unknown, path: string): asserts value is Blob | null {
  if (value === null) return;
  if (typeof Blob === "undefined" || !(value instanceof Blob)) {
    fail(path, "must be a Blob or null");
  }
  if (value.size > PROJECT_STORAGE_MAX_THUMBNAIL_BYTES) {
    fail(path, "exceeds the thumbnail size limit");
  }
  if (value.type && !value.type.startsWith("image/")) {
    fail(path, "must use an image MIME type");
  }
}

function assertTimestamp(value: unknown, path: string): asserts value is number {
  assertFinite(value, path);
  if (value < 0) fail(path, "must be non-negative");
}

function assertSummary(
  value: unknown,
  path: string,
): asserts value is ProjectSummaryV1 {
  if (!isRecord(value)) fail(path, "must be an object");
  assertSchemaVersion(value.schemaVersion, `${path}.schemaVersion`);
  assertProjectId(value.id, `${path}.id`);
  assertString(value.name, `${path}.name`, PROJECT_STORAGE_MAX_TITLE_LENGTH);
  if (value.name !== normalizeProjectTitle(value.name)) {
    fail(`${path}.name`, "must be normalized and non-empty");
  }
  assertTimestamp(value.createdAt, `${path}.createdAt`);
  assertTimestamp(value.updatedAt, `${path}.updatedAt`);
  if (value.updatedAt < value.createdAt) {
    fail(`${path}.updatedAt`, "must not precede createdAt");
  }
  assertGenerationId(value.headGenerationId, `${path}.headGenerationId`);
  assertDocumentDimensions(
    value.documentWidth,
    value.documentHeight,
    `${path}.document`,
  );
  assertPositiveInteger(value.layerCount, `${path}.layerCount`);
  if (value.layerCount > PROJECT_STORAGE_MAX_LAYERS) {
    fail(`${path}.layerCount`, "exceeds the layer limit");
  }
  assertNonNegativeInteger(value.storedBytes, `${path}.storedBytes`);
  assertThumbnail(value.thumbnail, `${path}.thumbnail`);
}

export function validateProjectSaveRequest(
  request: unknown,
): asserts request is ProjectSaveRequestV1 {
  assertPlainStructuredValue(request, "request");
  if (!isRecord(request)) fail("request", "must be an object");
  assertSchemaVersion(request.schemaVersion, "request.schemaVersion");
  if (request.projectId !== undefined) {
    assertProjectId(request.projectId, "request.projectId");
  }
  assertString(request.name, "request.name", 4_096);
  if (request.createdAt !== undefined) {
    assertTimestamp(request.createdAt, "request.createdAt");
  }
  if (request.thumbnail !== undefined) {
    assertThumbnail(request.thumbnail, "request.thumbnail");
  }
  assertSnapshot(request.snapshot, "request.snapshot");
  if (!Array.isArray(request.chunks)) fail("request.chunks", "must be an array");
  assertChunkSetMatchesSnapshot(
    request.chunks as readonly ProjectChunkWriteV1[],
    request.snapshot,
    "request.chunks",
  );
}

export function validateProjectManifest(
  manifest: unknown,
): asserts manifest is ProjectManifestV1 {
  assertPlainStructuredValue(manifest, "manifest");
  if (!isRecord(manifest)) fail("manifest", "must be an object");
  if (manifest.magic !== PROJECT_MANIFEST_MAGIC) {
    fail("manifest.magic", "is not an M1M4 project manifest");
  }
  assertSchemaVersion(manifest.schemaVersion, "manifest.schemaVersion");
  assertProjectId(manifest.projectId, "manifest.projectId");
  assertGenerationId(manifest.generationId, "manifest.generationId");
  assertString(manifest.projectName, "manifest.projectName", PROJECT_STORAGE_MAX_TITLE_LENGTH);
  if (manifest.projectName !== normalizeProjectTitle(manifest.projectName)) {
    fail("manifest.projectName", "must be normalized and non-empty");
  }
  assertTimestamp(manifest.createdAt, "manifest.createdAt");
  assertTimestamp(manifest.savedAt, "manifest.savedAt");
  if (manifest.savedAt < manifest.createdAt) {
    fail("manifest.savedAt", "must not precede createdAt");
  }
  assertSnapshot(manifest.snapshot, "manifest.snapshot");
}

export function validateLoadedProject(
  project: unknown,
): asserts project is ProjectLoadResultV1 {
  assertPlainStructuredValue(project, "project");
  if (!isRecord(project)) fail("project", "must be an object");
  const summary = project.summary;
  const manifest = project.manifest;
  assertSummary(summary, "project.summary");
  validateProjectManifest(manifest);
  if (!Array.isArray(project.chunks)) fail("project.chunks", "must be an array");
  if (summary.id !== manifest.projectId) {
    fail("project", "summary and manifest project ids differ");
  }
  if (summary.headGenerationId !== manifest.generationId) {
    fail("project", "summary does not point to the loaded manifest generation");
  }
  if (
    summary.documentWidth !== manifest.snapshot.document.width
    || summary.documentHeight !== manifest.snapshot.document.height
    || summary.layerCount !== manifest.snapshot.layers.length
  ) {
    fail("project.summary", "does not describe the manifest snapshot");
  }

  const plainChunks: ProjectChunkWriteV1[] = [];
  (project.chunks as unknown[]).forEach((value, index) => {
    const path = `project.chunks[${index}]`;
    if (!isRecord(value)) fail(path, "must be an object");
    assertChunkWrite(value, path);
    assertString(value.key, `${path}.key`, 512);
    assertProjectId(value.projectId, `${path}.projectId`);
    assertGenerationId(value.generationId, `${path}.generationId`);
    assertString(value.generationKey, `${path}.generationKey`, 384);
    if (
      value.projectId !== summary.id
      || value.generationId !== summary.headGenerationId
      || value.generationKey !== manifestKey(value.projectId, value.generationId)
      || value.key !== chunkKey(
        value.projectId,
        value.generationId,
        value.layerId as number,
        value.chunkIndex as number,
      )
    ) {
      fail(path, "has inconsistent storage keys");
    }
    plainChunks.push(value as unknown as ProjectChunkWriteV1);
  });
  assertChunkSetMatchesSnapshot(plainChunks, manifest.snapshot, "project.chunks");
  const rasterSourceBytes = manifest.snapshot.layers.reduce(
    (sum, layer) => sum + (layer.rasterSource?.blob.size ?? 0),
    0,
  );
  const storedBytes = plainChunks.reduce((sum, chunk) => sum + chunk.storedBytes, 0)
    + rasterSourceBytes
    + (summary.thumbnail?.size ?? 0);
  if (storedBytes !== summary.storedBytes) {
    fail("project.summary.storedBytes", "does not match chunks and thumbnail");
  }
}

export function estimateProjectSaveBytes(request: ProjectSaveRequestV1): number {
  validateProjectSaveRequest(request);
  return request.chunks.reduce((total, chunk) => total + chunk.storedBytes, 0)
    + request.snapshot.layers.reduce(
      (total, layer) => total + (layer.rasterSource?.blob.size ?? 0),
      0,
    )
    + (request.thumbnail?.size ?? 0);
}

export function checkProjectStorageCapacity(
  requiredBytes: number,
  estimate: Pick<ProjectStorageQuotaEstimate, "availableBytes" | "quotaBytes">,
): ProjectStorageCapacity {
  assertNonNegativeInteger(requiredBytes, "requiredBytes");
  const reserveBytes = estimate.quotaBytes === null
    ? null
    : Math.max(
      PROJECT_STORAGE_QUOTA_RESERVE_BYTES,
      Math.floor(estimate.quotaBytes * 0.05),
    );
  const fits = estimate.availableBytes === null || reserveBytes === null
    ? null
    : requiredBytes + reserveBytes <= estimate.availableBytes;
  return {
    requiredBytes,
    availableBytes: estimate.availableBytes,
    reserveBytes,
    fits,
  };
}

function globalStorageManager(): ProjectStorageManagerLike | null {
  return typeof navigator !== "undefined" && navigator.storage
    ? navigator.storage
    : null;
}

export async function estimateProjectStorageQuota(
  manager: ProjectStorageManagerLike | null = globalStorageManager(),
): Promise<ProjectStorageQuotaEstimate> {
  if (!manager) {
    return {
      usageBytes: null,
      quotaBytes: null,
      availableBytes: null,
      persisted: null,
    };
  }
  let usageBytes: number | null = null;
  let quotaBytes: number | null = null;
  let persisted: boolean | null = null;
  try {
    const estimate = await manager.estimate?.();
    usageBytes = typeof estimate?.usage === "number" && Number.isFinite(estimate.usage)
      ? Math.max(0, estimate.usage)
      : null;
    quotaBytes = typeof estimate?.quota === "number" && Number.isFinite(estimate.quota)
      ? Math.max(0, estimate.quota)
      : null;
  } catch {
    // Quota telemetry is advisory. A failed estimate must not disable saving.
  }
  try {
    persisted = manager.persisted ? await manager.persisted() : null;
  } catch {
    persisted = null;
  }
  return {
    usageBytes,
    quotaBytes,
    availableBytes: usageBytes !== null && quotaBytes !== null
      ? Math.max(0, quotaBytes - usageBytes)
      : null,
    persisted,
  };
}

export async function requestPersistentProjectStorage(
  manager: ProjectStorageManagerLike | null = globalStorageManager(),
): Promise<boolean | null> {
  if (!manager?.persist) return null;
  try {
    return await manager.persist();
  } catch {
    return false;
  }
}

function requestResult<T>(request: IDBRequest<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => {
      reject(request.error ?? new ProjectStorageError(`${label}: IndexedDB request failed.`));
    }, { once: true });
  });
}

function transactionCompletion(
  transaction: IDBTransaction,
  label: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => {
      reject(transaction.error ?? new ProjectStorageError(`${label}: transaction aborted.`));
    }, { once: true });
    transaction.addEventListener("error", () => {
      reject(transaction.error ?? new ProjectStorageError(`${label}: transaction failed.`));
    }, { once: true });
  });
}

function openTransaction(
  database: IDBDatabase,
  stores: string | readonly string[],
  mode: IDBTransactionMode,
  strictDurability = false,
): IDBTransaction {
  const storeNames = typeof stores === "string" ? stores : [...stores];
  if (strictDurability) {
    try {
      return database.transaction(storeNames, mode, { durability: "strict" });
    } catch {
      // Safari versions without the durability option still provide atomicity.
    }
  }
  return database.transaction(storeNames, mode);
}

function asStorageError(error: unknown, label: string): ProjectStorageError {
  if (error instanceof ProjectStorageError) return error;
  if (
    typeof DOMException !== "undefined"
    && error instanceof DOMException
    && (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED")
  ) {
    return new ProjectStorageError(
      `${label}: browser storage quota was exceeded.`,
      "quota",
      error,
    );
  }
  return new ProjectStorageError(
    `${label}: ${error instanceof Error ? error.message : String(error)}`,
    "database",
    error,
  );
}

async function openProjectDatabase(
  factory: IDBFactory,
  databaseName: string,
): Promise<IDBDatabase> {
  return await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(databaseName, PROJECT_STORAGE_DATABASE_VERSION);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PROJECT_STORE)) {
        database.createObjectStore(PROJECT_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(MANIFEST_STORE)) {
        const store = database.createObjectStore(MANIFEST_STORE, { keyPath: "key" });
        store.createIndex(PROJECT_INDEX, "projectId", { unique: false });
      }
      if (!database.objectStoreNames.contains(CHUNK_STORE)) {
        const store = database.createObjectStore(CHUNK_STORE, { keyPath: "key" });
        store.createIndex(PROJECT_INDEX, "projectId", { unique: false });
        store.createIndex(GENERATION_INDEX, "generationKey", { unique: false });
      }
    });
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => {
      reject(request.error ?? new ProjectStorageError("Project database is unavailable."));
    }, { once: true });
    request.addEventListener("blocked", () => {
      reject(new ProjectStorageError(
        "Project database upgrade is blocked by another tab.",
        "unavailable",
      ));
    }, { once: true });
  });
}

function deleteIndexRecords(
  index: IDBIndex,
  query: IDBValidKey,
  shouldDelete: (value: unknown) => boolean = () => true,
): void {
  const cursorRequest = index.openCursor(query);
  cursorRequest.addEventListener("success", () => {
    const cursor = cursorRequest.result;
    if (!cursor) return;
    if (shouldDelete(cursor.value)) cursor.delete();
    cursor.continue();
  });
}

interface MaterializedGeneration {
  readonly summary: ProjectSummaryV1;
  readonly manifestRecord: StoredManifestRecord;
  readonly chunks: readonly ProjectStoredChunkV1[];
}

function materializeGeneration(
  request: ProjectSaveRequestV1,
  projectId: string,
  previous: ProjectSummaryV1 | null,
): MaterializedGeneration {
  const name = normalizeProjectTitle(request.name);
  const generationId = uniqueToken("generation");
  const wallClock = Date.now();
  const createdAt = previous?.createdAt ?? request.createdAt ?? wallClock;
  const savedAt = Math.max(wallClock, createdAt, previous?.updatedAt ?? 0);
  const snapshot = cloneStructured(request.snapshot);
  const manifest: ProjectManifestV1 = {
    magic: PROJECT_MANIFEST_MAGIC,
    schemaVersion: PROJECT_DOCUMENT_SCHEMA_VERSION,
    projectId,
    generationId,
    projectName: name,
    createdAt,
    savedAt,
    snapshot,
  };
  const generationKeyValue = manifestKey(projectId, generationId);
  const chunks: ProjectStoredChunkV1[] = request.chunks.map((chunk) => ({
    schemaVersion: PROJECT_DOCUMENT_SCHEMA_VERSION,
    key: chunkKey(projectId, generationId, chunk.layerId, chunk.chunkIndex),
    projectId,
    generationId,
    generationKey: generationKeyValue,
    layerId: chunk.layerId,
    chunkIndex: chunk.chunkIndex,
    storage: chunk.storage,
    rawBytes: chunk.rawBytes,
    storedBytes: chunk.storedBytes,
    sourceHash: chunk.sourceHash,
    // Never transfer/detach the engine's authoritative compression buffer.
    bytes: chunk.bytes.slice(0),
  }));
  const thumbnail = request.thumbnail === undefined
    ? cloneStructured(previous?.thumbnail ?? null)
    : cloneStructured(request.thumbnail);
  const summary: ProjectSummaryV1 = {
    schemaVersion: PROJECT_DOCUMENT_SCHEMA_VERSION,
    id: projectId,
    name,
    createdAt,
    updatedAt: savedAt,
    headGenerationId: generationId,
    documentWidth: snapshot.document.width,
    documentHeight: snapshot.document.height,
    layerCount: snapshot.layers.length,
    storedBytes: chunks.reduce((total, chunk) => total + chunk.storedBytes, 0)
      + snapshot.layers.reduce(
        (total, layer) => total + (layer.rasterSource?.blob.size ?? 0),
        0,
      )
      + (thumbnail?.size ?? 0),
    thumbnail,
  };
  const manifestRecord: StoredManifestRecord = {
    key: generationKeyValue,
    projectId,
    generationId,
    manifest,
  };
  validateLoadedProject({ summary, manifest, chunks });
  return { summary, manifestRecord, chunks };
}

export class ProjectStorage {
  readonly databaseName: string;

  private readonly indexedDbFactory: IDBFactory | null;
  private readonly storageManager: ProjectStorageManagerLike | null;
  private readonly forceMemory: boolean;
  private database: IDBDatabase | null = null;
  private memory: MemoryDatabase | null = null;
  private initializePromise: Promise<void> | null = null;
  private _backend: ProjectStorageBackend = "uninitialized";
  private mutationTail: Promise<void> = Promise.resolve();
  private _initializationError: { readonly message: string } | null = null;

  constructor(options: ProjectStorageOptions = {}) {
    this.databaseName = options.databaseName?.trim() || PROJECT_STORAGE_DATABASE_NAME;
    this.forceMemory = options.forceMemory === true;
    this.indexedDbFactory = Object.prototype.hasOwnProperty.call(options, "indexedDB")
      ? options.indexedDB ?? null
      : typeof indexedDB !== "undefined"
        ? indexedDB
        : null;
    this.storageManager = Object.prototype.hasOwnProperty.call(options, "storageManager")
      ? options.storageManager ?? null
      : globalStorageManager();
  }

  get backend(): ProjectStorageBackend {
    return this._backend;
  }

  get fallbackReason(): string | null {
    return this._initializationError?.message ?? null;
  }

  async initialize(): Promise<void> {
    if (this._backend !== "uninitialized") return;
    if (!this.initializePromise) {
      this.initializePromise = this.initializeBackend().catch((error: unknown) => {
        this.initializePromise = null;
        throw error;
      });
    }
    await this.initializePromise;
  }

  private async initializeBackend(): Promise<void> {
    if (this.forceMemory || !this.indexedDbFactory) {
      this.memory = memoryDatabase(this.databaseName);
      this._backend = "memory";
      if (!this.forceMemory && !this.indexedDbFactory) {
        this._initializationError = { message: "IndexedDB is unavailable." };
      }
      return;
    }
    try {
      const database = await openProjectDatabase(this.indexedDbFactory, this.databaseName);
      database.addEventListener("versionchange", () => {
        database.close();
        if (this.database === database) {
          this.database = null;
          this._backend = "uninitialized";
          this.initializePromise = null;
        }
      });
      this.database = database;
      this._backend = "indexeddb";
    } catch (error) {
      this._initializationError = {
        message: error instanceof Error ? error.message : String(error),
      };
      this.memory = memoryDatabase(this.databaseName);
      this._backend = "memory";
    }
  }

  async listProjects(): Promise<ProjectSummaryV1[]> {
    await this.initialize();
    let summaries: ProjectSummaryV1[];
    if (this._backend === "memory") {
      summaries = [...this.requireMemory().projects.values()].map(cloneStructured);
    } else {
      const transaction = openTransaction(this.requireDatabase(), PROJECT_STORE, "readonly");
      const completion = transactionCompletion(transaction, "List projects");
      summaries = await requestResult<ProjectSummaryV1[]>(
        transaction.objectStore(PROJECT_STORE).getAll(),
        "List projects",
      );
      await completion;
    }
    summaries.forEach((summary, index) => assertSummary(summary, `projects[${index}]`));
    return summaries
      .sort((left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name))
      .map(cloneStructured);
  }

  async loadProject(projectId: string): Promise<ProjectLoadResultV1 | null> {
    assertProjectId(projectId, "projectId");
    await this.initialize();
    const project = this._backend === "memory"
      ? this.loadFromMemory(projectId)
      : await this.loadFromIndexedDb(projectId);
    if (!project) return null;
    validateLoadedProject(project);
    return cloneStructured(project);
  }

  private loadFromMemory(projectId: string): ProjectLoadResultV1 | null {
    const memory = this.requireMemory();
    const summary = memory.projects.get(projectId);
    if (!summary) return null;
    const manifestRecord = memory.manifests.get(
      manifestKey(projectId, summary.headGenerationId),
    );
    if (!manifestRecord) {
      throw new ProjectStorageError(
        `Project ${projectId} points to a missing manifest.`,
        "database",
      );
    }
    const generationKeyValue = manifestRecord.key;
    const chunks = [...memory.chunks.values()]
      .filter((chunk) => chunk.generationKey === generationKeyValue)
      .sort((left, right) => left.layerId - right.layerId || left.chunkIndex - right.chunkIndex);
    return cloneStructured({
      summary,
      manifest: manifestRecord.manifest,
      chunks,
    });
  }

  private async loadFromIndexedDb(projectId: string): Promise<ProjectLoadResultV1 | null> {
    const database = this.requireDatabase();
    return await new Promise<ProjectLoadResultV1 | null>((resolve, reject) => {
      const transaction = openTransaction(
        database,
        [PROJECT_STORE, MANIFEST_STORE, CHUNK_STORE],
        "readonly",
      );
      let project: ProjectLoadResultV1 | null = null;
      let localError: unknown = null;
      const summaryRequest = transaction.objectStore(PROJECT_STORE).get(projectId) as
        IDBRequest<ProjectSummaryV1 | undefined>;
      summaryRequest.addEventListener("success", () => {
        try {
          const summary = summaryRequest.result;
          if (!summary) return;
          assertSummary(summary, "project.summary");
          const manifestRequest = transaction.objectStore(MANIFEST_STORE).get(
            manifestKey(projectId, summary.headGenerationId),
          ) as IDBRequest<StoredManifestRecord | undefined>;
          manifestRequest.addEventListener("success", () => {
            try {
              const manifestRecord = manifestRequest.result;
              if (!manifestRecord) {
                throw new ProjectStorageError(
                  `Project ${projectId} points to a missing manifest.`,
                  "database",
                );
              }
              const chunkRequest = transaction.objectStore(CHUNK_STORE)
                .index(GENERATION_INDEX)
                .getAll(manifestRecord.key) as IDBRequest<ProjectStoredChunkV1[]>;
              chunkRequest.addEventListener("success", () => {
                project = {
                  summary,
                  manifest: manifestRecord.manifest,
                  chunks: chunkRequest.result.sort(
                    (left, right) => left.layerId - right.layerId
                      || left.chunkIndex - right.chunkIndex,
                  ),
                };
              }, { once: true });
            } catch (error) {
              localError = error;
              transaction.abort();
            }
          }, { once: true });
        } catch (error) {
          localError = error;
          transaction.abort();
        }
      }, { once: true });
      transaction.addEventListener("complete", () => resolve(project), { once: true });
      transaction.addEventListener("abort", () => {
        reject(localError ?? transaction.error ?? new ProjectStorageError("Load project aborted."));
      }, { once: true });
      transaction.addEventListener("error", () => {
        reject(transaction.error ?? new ProjectStorageError("Load project failed."));
      }, { once: true });
    });
  }

  async saveProject(request: ProjectSaveRequestV1): Promise<ProjectSummaryV1> {
    return await this.enqueueMutation(async () => {
      validateProjectSaveRequest(request);
      await this.initialize();
      const previous = request.projectId
        ? await this.readSummary(request.projectId)
        : null;
      if (request.projectId && !previous) {
        throw new ProjectStorageError(
          `Project ${request.projectId} does not exist.`,
          "not-found",
        );
      }
      const projectId = previous?.id ?? uniqueToken("project");
      const generation = materializeGeneration(request, projectId, previous);
      try {
        // Phase 1: stage an immutable manifest and every referenced byte chunk.
        // No reader can observe them yet because the project head still points
        // at the previous generation.
        await this.writeStagedGeneration(generation);
        // Phase 2: publish only after staging committed. This small transaction
        // verifies the manifest still exists before atomically moving the head.
        await this.commitProjectHead(generation.summary, generation.manifestRecord.key);
      } catch (error) {
        throw asStorageError(error, `Save project ${projectId}`);
      }

      // Delete only the previously observed head. Other generations may be
      // concurrent, already staged writes from another tab and must not be
      // mistaken for garbage. Cleanup failure cannot uncommit a successful save.
      if (previous && previous.headGenerationId !== generation.summary.headGenerationId) {
        try {
          await this.deleteGeneration(projectId, previous.headGenerationId);
        } catch {
          // A later save/delete will reclaim this now-unreferenced generation.
        }
      }
      return cloneStructured(generation.summary);
    });
  }

  private async readSummary(projectId: string): Promise<ProjectSummaryV1 | null> {
    if (this._backend === "memory") {
      const summary = this.requireMemory().projects.get(projectId) ?? null;
      if (summary) assertSummary(summary, "project.summary");
      return summary ? cloneStructured(summary) : null;
    }
    const transaction = openTransaction(this.requireDatabase(), PROJECT_STORE, "readonly");
    const completion = transactionCompletion(transaction, "Read project summary");
    const summary = await requestResult<ProjectSummaryV1 | undefined>(
      transaction.objectStore(PROJECT_STORE).get(projectId),
      "Read project summary",
    );
    await completion;
    if (summary) assertSummary(summary, "project.summary");
    return summary ? cloneStructured(summary) : null;
  }

  private async writeStagedGeneration(generation: MaterializedGeneration): Promise<void> {
    if (this._backend === "memory") {
      const memory = this.requireMemory();
      memory.manifests.set(
        generation.manifestRecord.key,
        cloneStructured(generation.manifestRecord),
      );
      for (const chunk of generation.chunks) {
        memory.chunks.set(chunk.key, cloneStructured(chunk));
      }
      return;
    }
    const transaction = openTransaction(
      this.requireDatabase(),
      [MANIFEST_STORE, CHUNK_STORE],
      "readwrite",
      true,
    );
    const completion = transactionCompletion(transaction, "Stage project generation");
    transaction.objectStore(MANIFEST_STORE).put(generation.manifestRecord);
    const chunkStore = transaction.objectStore(CHUNK_STORE);
    for (const chunk of generation.chunks) chunkStore.put(chunk);
    await completion;
  }

  private async commitProjectHead(
    summary: ProjectSummaryV1,
    expectedManifestKey: string,
  ): Promise<void> {
    if (this._backend === "memory") {
      const memory = this.requireMemory();
      if (!memory.manifests.has(expectedManifestKey)) {
        throw new ProjectStorageError("Cannot publish a missing staged manifest.");
      }
      // Last mutation in the memory backend too: tests see the same contract.
      memory.projects.set(summary.id, cloneStructured(summary));
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const transaction = openTransaction(
        this.requireDatabase(),
        [PROJECT_STORE, MANIFEST_STORE],
        "readwrite",
        true,
      );
      let localError: unknown = null;
      const request = transaction.objectStore(MANIFEST_STORE).get(expectedManifestKey) as
        IDBRequest<StoredManifestRecord | undefined>;
      request.addEventListener("success", () => {
        if (!request.result) {
          localError = new ProjectStorageError("Cannot publish a missing staged manifest.");
          transaction.abort();
          return;
        }
        transaction.objectStore(PROJECT_STORE).put(summary);
      }, { once: true });
      transaction.addEventListener("complete", () => resolve(), { once: true });
      transaction.addEventListener("abort", () => {
        reject(localError ?? transaction.error ?? new ProjectStorageError("Head commit aborted."));
      }, { once: true });
      transaction.addEventListener("error", () => {
        reject(transaction.error ?? new ProjectStorageError("Head commit failed."));
      }, { once: true });
    });
  }

  private async deleteGeneration(projectId: string, generationId: string): Promise<void> {
    const generationKeyValue = manifestKey(projectId, generationId);
    if (this._backend === "memory") {
      const memory = this.requireMemory();
      memory.manifests.delete(generationKeyValue);
      for (const [key, chunk] of memory.chunks) {
        if (chunk.generationKey === generationKeyValue) memory.chunks.delete(key);
      }
      return;
    }
    const transaction = openTransaction(
      this.requireDatabase(),
      [MANIFEST_STORE, CHUNK_STORE],
      "readwrite",
    );
    const completion = transactionCompletion(transaction, "Delete old project generation");
    transaction.objectStore(MANIFEST_STORE).delete(generationKeyValue);
    deleteIndexRecords(
      transaction.objectStore(CHUNK_STORE).index(GENERATION_INDEX),
      generationKeyValue,
    );
    await completion;
  }

  async renameProject(projectId: string, requestedName: string): Promise<ProjectSummaryV1> {
    assertProjectId(projectId, "projectId");
    assertString(requestedName, "name", 4_096);
    const name = normalizeProjectTitle(requestedName);
    return await this.enqueueMutation(async () => {
      await this.initialize();
      try {
        if (this._backend === "memory") {
          const memory = this.requireMemory();
          const summary = memory.projects.get(projectId);
          if (!summary) {
            throw new ProjectStorageError(`Project ${projectId} does not exist.`, "not-found");
          }
          const manifestRecord = memory.manifests.get(
            manifestKey(projectId, summary.headGenerationId),
          );
          if (!manifestRecord) throw new ProjectStorageError("Project manifest is missing.");
          const renamedSummary: ProjectSummaryV1 = {
            ...summary,
            name,
            updatedAt: Math.max(Date.now(), summary.updatedAt),
          };
          const renamedManifest: StoredManifestRecord = {
            ...manifestRecord,
            manifest: { ...manifestRecord.manifest, projectName: name },
          };
          memory.manifests.set(renamedManifest.key, cloneStructured(renamedManifest));
          memory.projects.set(projectId, cloneStructured(renamedSummary));
          return cloneStructured(renamedSummary);
        }
        return await this.renameInIndexedDb(projectId, name);
      } catch (error) {
        throw asStorageError(error, `Rename project ${projectId}`);
      }
    });
  }

  private async renameInIndexedDb(
    projectId: string,
    name: string,
  ): Promise<ProjectSummaryV1> {
    return await new Promise<ProjectSummaryV1>((resolve, reject) => {
      const transaction = openTransaction(
        this.requireDatabase(),
        [PROJECT_STORE, MANIFEST_STORE],
        "readwrite",
        true,
      );
      let result: ProjectSummaryV1 | null = null;
      let localError: unknown = null;
      const summaryRequest = transaction.objectStore(PROJECT_STORE).get(projectId) as
        IDBRequest<ProjectSummaryV1 | undefined>;
      summaryRequest.addEventListener("success", () => {
        const summary = summaryRequest.result;
        if (!summary) {
          localError = new ProjectStorageError(`Project ${projectId} does not exist.`, "not-found");
          transaction.abort();
          return;
        }
        const manifestRequest = transaction.objectStore(MANIFEST_STORE).get(
          manifestKey(projectId, summary.headGenerationId),
        ) as IDBRequest<StoredManifestRecord | undefined>;
        manifestRequest.addEventListener("success", () => {
          const manifestRecord = manifestRequest.result;
          if (!manifestRecord) {
            localError = new ProjectStorageError("Project manifest is missing.");
            transaction.abort();
            return;
          }
          result = {
            ...summary,
            name,
            updatedAt: Math.max(Date.now(), summary.updatedAt),
          };
          transaction.objectStore(MANIFEST_STORE).put({
            ...manifestRecord,
            manifest: { ...manifestRecord.manifest, projectName: name },
          });
          transaction.objectStore(PROJECT_STORE).put(result);
        }, { once: true });
      }, { once: true });
      transaction.addEventListener("complete", () => {
        if (result) resolve(cloneStructured(result));
        else reject(new ProjectStorageError("Rename completed without a result."));
      }, { once: true });
      transaction.addEventListener("abort", () => {
        reject(localError ?? transaction.error ?? new ProjectStorageError("Rename aborted."));
      }, { once: true });
      transaction.addEventListener("error", () => {
        reject(transaction.error ?? new ProjectStorageError("Rename failed."));
      }, { once: true });
    });
  }

  async deleteProject(projectId: string): Promise<boolean> {
    assertProjectId(projectId, "projectId");
    return await this.enqueueMutation(async () => {
      await this.initialize();
      try {
        if (this._backend === "memory") {
          const memory = this.requireMemory();
          const existed = memory.projects.delete(projectId);
          for (const [key, record] of memory.manifests) {
            if (record.projectId === projectId) memory.manifests.delete(key);
          }
          for (const [key, chunk] of memory.chunks) {
            if (chunk.projectId === projectId) memory.chunks.delete(key);
          }
          return existed;
        }
        return await this.deleteFromIndexedDb(projectId);
      } catch (error) {
        throw asStorageError(error, `Delete project ${projectId}`);
      }
    });
  }

  private async deleteFromIndexedDb(projectId: string): Promise<boolean> {
    const transaction = openTransaction(
      this.requireDatabase(),
      [PROJECT_STORE, MANIFEST_STORE, CHUNK_STORE],
      "readwrite",
      true,
    );
    const completion = transactionCompletion(transaction, "Delete project");
    const existingRequest = transaction.objectStore(PROJECT_STORE).get(projectId) as
      IDBRequest<ProjectSummaryV1 | undefined>;
    transaction.objectStore(PROJECT_STORE).delete(projectId);
    deleteIndexRecords(
      transaction.objectStore(MANIFEST_STORE).index(PROJECT_INDEX),
      projectId,
    );
    deleteIndexRecords(
      transaction.objectStore(CHUNK_STORE).index(PROJECT_INDEX),
      projectId,
    );
    const existing = await requestResult(existingRequest, "Read project before delete");
    await completion;
    return existing !== undefined;
  }

  async estimateQuota(): Promise<ProjectStorageQuotaEstimate> {
    await this.initialize();
    const estimate = await estimateProjectStorageQuota(this.storageManager);
    return {
      ...estimate,
      backend: this._backend === "indexeddb" ? "indexeddb" : "memory",
    };
  }

  async requestPersistence(): Promise<boolean | null> {
    await this.initialize();
    if (this._backend === "memory") return null;
    return await requestPersistentProjectStorage(this.storageManager);
  }

  close(): void {
    this.database?.close();
    this.database = null;
    this.memory = null;
    this.initializePromise = null;
    this._backend = "uninitialized";
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private requireDatabase(): IDBDatabase {
    if (!this.database || this._backend !== "indexeddb") {
      throw new ProjectStorageError("IndexedDB project backend is not initialized.");
    }
    return this.database;
  }

  private requireMemory(): MemoryDatabase {
    if (!this.memory || this._backend !== "memory") {
      throw new ProjectStorageError("Memory project backend is not initialized.");
    }
    return this.memory;
  }
}

export function createProjectStorage(
  options: ProjectStorageOptions = {},
): ProjectStorage {
  return new ProjectStorage(options);
}
