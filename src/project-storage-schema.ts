import type { RasterBevelStyle } from "./bevel-core";
import type { BrushSettings, LayerFormat } from "./engine-types";
import type { LayerBlendMode } from "./layer-blend-modes";
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
export const PROJECT_STORAGE_QUOTA_RESERVE_BYTES = 16 * 1024 * 1024;

export const PROJECT_STORE = "projects";
export const MANIFEST_STORE = "manifests";
export const CHUNK_STORE = "chunks";
export const PROJECT_INDEX = "byProject";
export const GENERATION_INDEX = "byGeneration";

export const LAYER_BLEND_MODES = new Set<string>([
  "multiply",
  "darken",
  "shade",
  "color-burn",
  "linear-burn",
  "darker-color",
  "normal",
  "lighten",
  "screen",
  "color-dodge",
  "add",
  "lighter-color",
  "overlay",
  "soft-light",
  "hard-light",
  "vivid-light",
  "linear-light",
  "pin-light",
  "hard-mix",
  "difference",
  "exclusion",
  "subtract",
  "divide",
  "hue",
  "saturation",
  "color",
  "luminosity",
]);

export const PROJECT_ID_PATTERN = /^[A-Za-z0-9._-]{1,160}$/;
export const GENERATION_ID_PATTERN = /^[A-Za-z0-9._-]{1,160}$/;

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
