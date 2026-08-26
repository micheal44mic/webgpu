/**
 * Modello della cronologia unificata: azioni raster e vettoriali, batch di
 * replay e confronto degli stati vettoriali.
 */
import type { DryBlendHistoryGeometry } from "./blend-renderer";
import type { DirtyRect, Stamp } from "./engine-stroke-types";
import type { BrushSettings } from "./engine-types";
import type { GpuHistorySlice } from "./gpu-history-storage";
import type { FillCompositeMode } from "./fill-core";
import type {
  MixedSceneVectorHistoryDelta,
  MixedSceneVectorHistoryState,
  MixedSceneVectorKey,
  MixedSceneItem,
} from "./mixed-scene-stack";
import type { VectorSvgNode } from "./scene-svg-model";
import type { RasterImageNode } from "./scene-image-model";
import type { ShapeOccupancySelection } from "./shape-occupancy";
import { MAX_STAMPS_PER_BATCH, STAMP_STRIDE_BYTES } from "./engine-limits";
import type { LayerColdStorageResources } from "./engine-layer-resources";
import type { LayerClippingHistoryEntry, LayerRecord } from "./layer-stack";
import { CLONE_SOURCE_PAGE_TABLE_LENGTH } from "./clone-gpu-core";
import type { LayerBlendMode } from "./layer-blend-modes";
import type { MixedSceneOrderState } from "./mixed-scene-reorder-core";
import type { RasterStrokeStyle } from "./stroke-core";
import type { RasterBevelStyle } from "./bevel-core";
import type { RasterInnerShadowStyle, RasterOuterShadowStyle } from "./shadow-core";
import type { RasterColorOverlayStyle } from "./raster-color-overlay-core";
import type { RasterNoiseChannels, RasterNoiseStyle } from "./noise-core";
import type { LiquifyMode } from "./liquify-core";
import type { SpatialBlurPin } from "./spatial-blur-core";
import type { RasterLayerSource } from "./raster-layer-source";
import type { RasterLayerEffectsSnapshot } from "./raster-layer-effects";
import type { DocumentBackgroundState } from "./document-background";
import type {
  LayerCutoutMode,
  LayerOptionsState,
  LayerTonalBlend,
} from "./layer-composition.ts";

export interface SelectionHistoryMaskSnapshot {
  readonly revision: number;
  /** Stable mask lineage used for compare-and-swap Undo/Redo semantics. */
  readonly identity: number;
  readonly gpuSlice: GpuHistorySlice;
  readonly selectedPixels: number;
  readonly activeTiles: number;
  readonly bounds: DirtyRect | null;
  readonly tileMask: Uint32Array;
}

export interface RasterHistoryAction {
  id: number;
  kind: "stroke" | "fill" | "clear";
  layerId: number;
  /** Filled atomically when this edit rasterizes an imported source layer. */
  rasterSourceBefore?: RasterLayerSource | null;
  rasterSourceAfter?: RasterLayerSource | null;
}

export interface VectorHistoryAction {
  id: number;
  kind: "vector";
  delta: MixedSceneVectorHistoryDelta;
}

/** One reversible, non-destructive change to a raster layer's composition. */
export interface LayerBlendModeHistoryAction {
  id: number;
  kind: "layer-blend-mode";
  layerId: number;
  before: LayerBlendMode;
  after: LayerBlendMode;
}

/** One compact, pixel-free permutation of the heterogeneous layer stack. */
export interface MixedSceneReorderHistoryAction {
  id: number;
  kind: "scene-reorder";
  operation?: "reorder" | "clipping";
  before: MixedSceneOrderState;
  after: MixedSceneOrderState;
}

/** One compact, layer-independent change to the document backdrop. */
export interface DocumentBackgroundHistoryAction {
  id: number;
  kind: "document-background";
  before: DocumentBackgroundState;
  after: DocumentBackgroundState;
}

/** One journal field per independent raster property/effect gesture. */
export interface RasterLayerMetadataHistoryValueMap {
  readonly visibility: boolean;
  readonly opacity: number;
  /** One panel session owns all continuously previewed layer-composition fields. */
  readonly "layer-options": LayerOptionsState;
  readonly "content-opacity": number;
  readonly cutout: LayerCutoutMode;
  readonly "tonal-blend": LayerTonalBlend;
  readonly clipping: readonly LayerClippingHistoryEntry[];
  readonly stroke: RasterStrokeStyle;
  readonly bevel: RasterBevelStyle;
  readonly "outer-shadow": RasterOuterShadowStyle;
  readonly "inner-shadow": RasterInnerShadowStyle;
  readonly "color-overlay": RasterColorOverlayStyle;
}

export type RasterLayerMetadataHistoryProperty =
  keyof RasterLayerMetadataHistoryValueMap;

/** Small CPU-only snapshot captured at one gesture boundary. */
export type RasterLayerMetadataHistoryState = {
  [Property in RasterLayerMetadataHistoryProperty]: {
    readonly layerId: number;
    readonly property: Property;
    readonly value: RasterLayerMetadataHistoryValueMap[Property];
  }
}[RasterLayerMetadataHistoryProperty];

/**
 * A discriminated delta. `before` and `after` can only contain the field named
 * by `property`; unrelated styles can neither consume memory nor be replayed.
 */
export type RasterLayerMetadataHistoryAction = {
  [Property in RasterLayerMetadataHistoryProperty]: {
    id: number;
    kind: "layer-metadata";
    layerId: number;
    property: Property;
    before: RasterLayerMetadataHistoryValueMap[Property];
    after: RasterLayerMetadataHistoryValueMap[Property];
  }
}[RasterLayerMetadataHistoryProperty];

/**
 * Common authoritative checkpoint retained by raster actions.
 *
 * The seed always describes the byte-exact pixels AFTER the action and carries
 * the authoritative layer format used to encode those bytes. A null seed is valid
 * only when the resulting layer is empty; bounds and tile metadata must then
 * be empty as well. Keeping this contract explicit prevents replay from
 * accidentally treating a transform as a geometric node layered over pixels.
 */
export interface RasterHistoryCheckpoint {
  layerId: number;
  seed: LayerColdStorageResources | null;
  baseBounds: DirtyRect | null;
  baseTileMask: Uint32Array;
}

export interface VectorRasterizeHistoryAction extends RasterHistoryCheckpoint {
  id: number;
  kind: "vector-rasterize";
  sourceKind: "text" | "svg";
  layerRecord: LayerRecord;
  rasterLayerIndex: number;
  vectorState: MixedSceneVectorHistoryState;
  /** Raster attivo prima della conversione, ripristinato esattamente dall'Undo. */
  activeRasterLayerIdBefore: number;
  seed: LayerColdStorageResources;
  baseBounds: DirtyRect;
}

export interface RasterImportSourceMetadata {
  sourceName: string;
  mimeType: string;
  width: number;
  height: number;
}

/** A decoded image is immediately materialized as a normal raster layer. */
export interface RasterImportHistoryAction extends RasterHistoryCheckpoint {
  id: number;
  kind: "raster-import";
  layerRecord: LayerRecord;
  rasterLayerIndex: number;
  sceneIndex: number;
  selectedKeyBefore: MixedSceneItem["key"];
  activeRasterLayerIdBefore: number;
  seed: LayerColdStorageResources;
  baseBounds: DirtyRect;
  source: RasterImportSourceMetadata;
  /** Immutable master provenance retained even while the layer is detached. */
  rasterSource: RasterLayerSource;
}

/**
 * Un livello cancellato conserva tutto cio' che serve a rimetterlo dov'era:
 * il record, la posizione nello stack e nella scena, e i pixel nel `seed`.
 *
 * Cancellare un parent di ritaglio cancella **l'intera unita'**, quindi le
 * voci sono un elenco: una maschera senza il suo parent verrebbe disegnata
 * come livello normale e cambierebbe l'immagine. L'elenco e' ordinato dal
 * basso verso l'alto, cosi' il ripristino puo' reinserire in avanti.
 */
export interface DeletedLayerEntry {
  layerRecord: LayerRecord;
  rasterLayerIndex: number;
  sceneIndex: number;
  clippingParentId: number | null;
  /** Authoritative heterogeneous clipping base; absent in legacy actions. */
  sceneClippingParentKey?: MixedSceneItem["key"] | null;
  /** Existing semantic children that must reconnect when this base returns. */
  sceneClippingChildKeys?: readonly MixedSceneItem["key"][];
  /** `null` quando il livello era vuoto: non c'e' nulla da reidratare. */
  seed: LayerColdStorageResources | null;
  baseBounds: DirtyRect | null;
}

export interface LayerDeleteHistoryAction {
  id: number;
  kind: "layer-delete";
  entries: readonly DeletedLayerEntry[];
  selectedKeyBefore: MixedSceneItem["key"];
  /** Selezione autorevole dopo la cancellazione, usata dal Redo. */
  selectedKeyAfter: MixedSceneItem["key"];
  activeRasterLayerIdBefore: number;
  /** Raster attivo dopo la cancellazione, per rifare il Redo senza indovinare. */
  activeRasterLayerIdAfter: number;
  referenceRasterLayerIdBefore: number | null;
  referenceRasterLayerIdAfter: number | null;
}

export type LayerMergeHistoryInput =
  | {
    readonly kind: "raster";
    readonly key: Extract<MixedSceneItem, { readonly kind: "raster" }>["key"];
    readonly entry: DeletedLayerEntry;
  }
  | {
    readonly kind: "vector";
    readonly key: MixedSceneVectorKey;
    /** Null only after the global History floor made this Undo unreachable. */
    state: MixedSceneVectorHistoryState | null;
  };

/**
 * The output record remains the live mutable layer metadata after the merge.
 * Keep the merge-time sparse mask separately: later paint/history replay is
 * allowed to mutate `layerRecord.storageTileMask`, but Redo must hydrate the
 * exact checkpoint originally produced by this action.
 */
export interface LayerMergeHistoryOutput extends DeletedLayerEntry {
  baseTileMask: Uint32Array;
}

/**
 * One heterogeneous scene interval becomes one new raster identity.
 *
 * Text/SVG nodes remain semantic snapshots in this single action; they are
 * rasterized only while producing `output.seed` and never appear as temporary
 * layers or journal entries. Raster inputs retain exact tiled seeds. This is a
 * structural checkpoint, not N independent vector-rasterize operations.
 */
export interface LayerMergeHistoryAction {
  id: number;
  kind: "layer-merge";
  readonly inputs: readonly LayerMergeHistoryInput[];
  readonly output: LayerMergeHistoryOutput;
  readonly selectedKeyBefore: MixedSceneItem["key"];
  readonly selectedKeyAfter: Extract<MixedSceneItem, { readonly kind: "raster" }>["key"];
  readonly activeRasterLayerIdBefore: number;
  readonly activeRasterLayerIdAfter: number;
  readonly referenceRasterLayerIdBefore: number | null;
  readonly referenceRasterLayerIdAfter: number | null;
  /** True only for one complete raster clipping unit/single raster. */
  readonly preservesParentPresentation: boolean;
  /** Heavy seeds/vector snapshots were retired after the global floor crossed this action. */
  payloadsRetiredBelowFloor: boolean;
}

/**
 * La creazione di un livello e' journaled: prima troncava il Redo perche' le
 * azioni `scene-reorder` conservano un ordine assoluto e un'inserzione non
 * registrata le rendeva inapplicabili. Registrandola, lo stato a qualsiasi
 * cursore si ottiene applicando le azioni in ordine e la coda resta coerente.
 *
 * Un Add normale conserva un checkpoint vuoto. Duplicate usa lo stesso evento
 * strutturale ma porta un seed tiled: e' sia il payload del Redo sia la baseline
 * dalla quale ricostruire le pennellate successive sul nuovo livello.
 */
export interface LayerAddHistoryAction extends RasterHistoryCheckpoint {
  id: number;
  kind: "layer-add";
  /** Distinguishes a cheap blank layer from a byte-exact duplicated baseline. */
  creation: "blank" | "duplicate";
  /** Source identity is diagnostic only: replay is authoritative from `seed`. */
  sourceLayerId: number | null;
  layerRecord: LayerRecord;
  rasterLayerIndex: number;
  sceneIndex: number;
  clippingParentId: number | null;
  /** Authoritative heterogeneous clipping base; absent in legacy actions. */
  sceneClippingParentKey?: MixedSceneItem["key"] | null;
  selectedKeyBefore: MixedSceneItem["key"];
  activeRasterLayerIdBefore: number;
  /** Baseline presentation policy copied with the duplicated raster. */
  baseNoiseMipSmoothing: boolean;
  /** Aggiungere un livello non cambia il riferimento Fill. */
  referenceRasterLayerIdBefore: number | null;
}

export type RasterTransformMatrix = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
];

/**
 * A raster transform stores its exact post-Apply cache for deterministic
 * Undo/Redo. For an imported source-backed layer the before/after source
 * matrices remain authoritative; the checkpoint is only a native Paint/Fill
 * cache and subsequent transforms rebuild from the immutable master.
 */
interface RasterTransformHistoryActionMetadata {
  id: number;
  kind: "raster-transform";
  layerId: number;
  baseTileMask: Uint32Array;
  /** Handle/pivot geometry, separate from filtered raster support in baseBounds. */
  geometryBounds: DirtyRect | null;
  matrix: RasterTransformMatrix;
  filterStrategy: string;
  scope: "layer" | "selection";
  selectionBefore: SelectionHistoryMaskSnapshot | null;
  selectionAfter: SelectionHistoryMaskSnapshot | null;
  rasterSourceBefore: RasterLayerSource | null;
  rasterSourceAfter: RasterLayerSource | null;
}

export type RasterTransformHistoryAction = RasterTransformHistoryActionMetadata & (
  | {
    seed: LayerColdStorageResources;
    baseBounds: DirtyRect;
  }
  | {
    seed: null;
    baseBounds: null;
  }
);

/**
 * One Transform gesture can update independent semantic nodes and raster
 * layers while preserving every item as a separate layer. Raster members keep
 * the same exact post-Apply checkpoint as a normal raster Transform; their
 * nested id is the owning group action id so local-storage ownership remains
 * unambiguous.
 */
export interface MixedSceneGroupTransformHistoryAction {
  id: number;
  kind: "group-transform";
  readonly vectors: readonly MixedSceneVectorHistoryDelta[];
  readonly rasters: readonly RasterTransformHistoryAction[];
  readonly selectedKeyBefore: MixedSceneItem["key"];
  readonly selectedKeyAfter: MixedSceneItem["key"];
  readonly activeRasterLayerIdBefore: number;
  readonly activeRasterLayerIdAfter: number;
}

/**
 * Exact post-Apply pixels produced by a destructive raster filter.
 *
 * Undo/Redo hydrates the checkpoint and never evaluates the filter again, so a
 * future shader change cannot alter an existing document's history.
 */
interface RasterFilterHistoryActionCommon extends RasterHistoryCheckpoint {
  id: number;
  kind: "raster-filter";
  rasterSourceBefore?: RasterLayerSource | null;
  rasterSourceAfter?: RasterLayerSource | null;
}

export type RasterFilterHistoryAction = RasterFilterHistoryActionCommon & (
  | {
    filter: "gaussian-blur";
    radius: number;
    sigma: number;
    supportRadius: number;
    precision: "rgba16float-f32-accumulation";
    edgeMode:
      | "transparent-black"
      | "transparent-content-clamp-document-edge";
  }
  | {
    filter: "spatial-blur";
    pins: readonly SpatialBlurPin[];
    maximumRadius: number;
    radiusQuantization: 4;
    fieldStrategy: "inverse-distance-quarter-pixel-radius";
    kernelStrategy: "shared-gaussian-kernel-v1";
    precision: "rgba16float-f32-accumulation";
    edgeMode: "transparent-content-clamp-document-edge";
  }
  | {
    filter: "motion-blur";
    distance: number;
    angle: number;
    sampleCount: number;
    passCount: number;
    supportX: number;
    supportY: number;
    precision: "rgba16float-f32-accumulation";
    edgeMode:
      | "transparent-black"
      | "transparent-content-clamp-document-edge";
  }
  | {
    filter: "noise";
    amountPercent: number;
    scalePercent: number;
    octavesPercent: number;
    turbulencePercent: number;
    style: RasterNoiseStyle;
    channels: RasterNoiseChannels;
    additive: boolean;
    randomSeedLow: number;
    randomSeedHigh: number;
    algorithm: "gradient-fbm-domain-warp-v1";
    algorithmVersion: 1;
    precision: "rgba16float-storage-f32-procedural";
    colorSpace: "linear-premultiplied";
    alphaMode: "preserve";
    boundsMode: "preserve";
  }
  | {
    filter: "glass";
    distortionPercent: number;
    smoothnessPercent: number;
    scalePercent: number;
    invert: boolean;
    randomSeedLow: number;
    randomSeedHigh: number;
    maximumDisplacementPixels: number;
    surfaceScalePixels: number;
    algorithm: "analytic-gradient-refraction-v1";
    algorithmVersion: 1;
    precision: "rgba16float-source-and-output-f32-field-and-bilinear";
    edgeMode: "transparent-content-clamp-document-edge";
    coordinateSpace: "document-pixel-centers";
  }
  | {
    filter: "liquify";
    strokeCount: number;
    dabCount: number;
    modes: readonly LiquifyMode[];
    amountPercent: number;
    strategy: string;
    precision: "rgba16float-source-and-displacement-f32-math";
    displacementFormat: "rgba16float";
  }
  | {
    filter: "rasterize-layer";
    /** Exact pixels immediately before Rasterize, including a loaded-project baseline. */
    beforeSeed: LayerColdStorageResources;
    beforeBounds: DirtyRect;
    beforeTileMask: Uint32Array;
    effectsBefore: RasterLayerEffectsSnapshot;
    effectsAfter: RasterLayerEffectsSnapshot;
    strategy:
      "bake-content-and-style-stack-into-authoritative-pixels-preserve-opacity-blend-and-clipping-v2";
    preservesLayerOpacity: true;
    preservesBlendMode: true;
    preservesClipping: true;
  }
);

export type RasterHistoryCheckpointAction =
  | VectorRasterizeHistoryAction
  | RasterImportHistoryAction
  | RasterTransformHistoryAction
  | RasterFilterHistoryAction
  | LayerAddHistoryAction;

export type HistoryAction =
  | RasterHistoryAction
  | VectorHistoryAction
  | DocumentBackgroundHistoryAction
  | LayerBlendModeHistoryAction
  | RasterLayerMetadataHistoryAction
  | MixedSceneReorderHistoryAction
  | VectorRasterizeHistoryAction
  | RasterImportHistoryAction
  | RasterTransformHistoryAction
  | MixedSceneGroupTransformHistoryAction
  | RasterFilterHistoryAction
  | LayerAddHistoryAction
  | LayerDeleteHistoryAction
  | LayerMergeHistoryAction;

/**
 * Mutazioni che cambiano **quali** livelli esistono, non il loro contenuto.
 * Chi ramifica sul tipo di azione deve trattarle insieme: sono le uniche che
 * possono invalidare un indice di livello memorizzato altrove.
 */
export function isLayerStructureHistoryAction(
  action: HistoryAction,
): action is LayerAddHistoryAction | LayerDeleteHistoryAction | LayerMergeHistoryAction {
  return action.kind === "layer-add"
    || action.kind === "layer-delete"
    || action.kind === "layer-merge";
}

export function isRasterHistoryCheckpointAction(
  action: HistoryAction,
): action is RasterHistoryCheckpointAction {
  return action.kind === "vector-rasterize"
    || action.kind === "raster-import"
    || action.kind === "raster-transform"
    || action.kind === "raster-filter"
    || action.kind === "layer-add";
}

export interface ActiveVectorHistoryEdit {
  key: MixedSceneVectorKey;
  before: MixedSceneVectorHistoryState;
  scope: "property" | "transform";
}

export type ActiveRasterLayerMetadataHistoryEdit = RasterLayerMetadataHistoryState;

export function vectorHistoryStatesEqual(
  left: MixedSceneVectorHistoryState,
  right: MixedSceneVectorHistoryState,
): boolean {
  if (
    left.key !== right.key
    || left.index !== right.index
    || left.selectedKey !== right.selectedKey
    || (left.clippingParentKey ?? null) !== (right.clippingParentKey ?? null)
    || JSON.stringify(left.clippingChildKeys ?? [])
      !== JSON.stringify(right.clippingChildKeys ?? [])
  ) {
    return false;
  }
  if (!left.node || !right.node) return left.node === right.node;
  if (left.node.kind !== right.node.kind) return false;
  if (left.node.kind === "text") {
    return JSON.stringify(left.node) === JSON.stringify(right.node);
  }
  if (left.node.kind === "image") {
    const { document: _leftDocument, ...leftNode } = left.node as RasterImageNode;
    const { document: _rightDocument, ...rightNode } = right.node as RasterImageNode;
    return JSON.stringify(leftNode) === JSON.stringify(rightNode);
  }
  const { document: _leftDocument, ...leftNode } = left.node as VectorSvgNode;
  const { document: _rightDocument, ...rightNode } = right.node as VectorSvgNode;
  return JSON.stringify(leftNode) === JSON.stringify(rightNode);
}

export interface PaintHistoryRenderBatch {
  kind: "paint";
  actionId: number;
  layerId: number;
  settings: BrushSettings;
  stampCount: number;
  firstSeed: number;
  gpuSlice: GpuHistorySlice;
  clearLayer: boolean;
  dirtyRect: DirtyRect | null;
  shapeOccupancySelection: ShapeOccupancySelection | null;
  shapeMaskIdentity: number | null;
  grainTextureIdentity: number | null;
  selectionMask: SelectionHistoryMaskSnapshot | null;
  /** Immutable virtual-texture pages required to replay a Clone batch. */
  cloneSource: CloneHistorySourcePayload | null;
}

export interface CloneHistorySourcePayload {
  /** Retained for diagnostics; rotated replay uses the authoritative affine fields below. */
  readonly offsetX: number;
  readonly offsetY: number;
  readonly sourceX: number;
  readonly sourceY: number;
  readonly destinationX: number;
  readonly destinationY: number;
  readonly rotationCos: number;
  readonly rotationSin: number;
  readonly angleDegrees: number;
  readonly tileIndices: readonly number[];
  readonly stampBytes: number;
  readonly sourceByteOffset: number;
  readonly bytesPerRow: number;
  readonly rowsPerImage: number;
  readonly tileStrideBytes: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly documentWidth: number;
  readonly documentHeight: number;
}

export interface BlendHistoryRenderBatch {
  kind: "blend";
  actionId: number;
  layerId: number;
  settings: BrushSettings;
  batches: DryBlendHistoryGeometry[];
  gpuSlice: GpuHistorySlice;
  clearLayer: boolean;
  dirtyRect: DirtyRect | null;
  shapeMaskIdentity: number | null;
  grainTextureIdentity: number | null;
}

export interface FillHistoryRenderBatch {
  kind: "fill";
  actionId: number;
  layerId: number;
  /** Diagnostic only: replay is authoritative from gpuSlice, never from source. */
  sourceLayerId: number;
  color: string;
  linearColor: readonly [number, number, number, number];
  /** Premultiplied-linear seed base captured with this immutable Fill mask. */
  sourceSeedColorLinear: readonly [number, number, number, number];
  /** Topology-safe darker antialias pixels rendered beyond the stored CCL core. */
  residualFringeRadius: 0 | 1 | 2 | 3;
  tolerancePercent: number;
  /** Pixel contract used to reproduce the final mask without consulting its source layer. */
  compositeMode: FillCompositeMode;
  gpuSlice: GpuHistorySlice;
  clearLayer: false;
  dirtyRect: DirtyRect;
  tileMask: Uint32Array;
}

export type HistoryRenderBatch =
  | PaintHistoryRenderBatch
  | BlendHistoryRenderBatch
  | FillHistoryRenderBatch;

export function resolvePaintHistoryStampCount(
  stamps: readonly Stamp[],
  replayBatch: PaintHistoryRenderBatch | null,
): number {
  if (!replayBatch) {
    return stamps.length;
  }
  if (stamps.length !== 0) {
    throw new Error("GPU Paint replay must not retain stamps on the CPU.");
  }
  if (
    !Number.isInteger(replayBatch.stampCount)
    || replayBatch.stampCount <= 0
    || replayBatch.stampCount > MAX_STAMPS_PER_BATCH
  ) {
    throw new RangeError("Invalid GPU history stamp count.");
  }
  const expectedStampBytes = replayBatch.stampCount * STAMP_STRIDE_BYTES;
  const cloneSource = replayBatch.cloneSource;
  const expectedBytes = cloneSource
    ? cloneSource.sourceByteOffset
      + cloneSource.tileStrideBytes * cloneSource.tileIndices.length
    : expectedStampBytes;
  const cloneTransformValues = cloneSource
    ? [
      cloneSource.sourceX,
      cloneSource.sourceY,
      cloneSource.destinationX,
      cloneSource.destinationY,
      cloneSource.rotationCos,
      cloneSource.rotationSin,
      cloneSource.angleDegrees,
    ]
    : [];
  const cloneTiles = cloneSource?.tileIndices ?? [];
  const cloneRotationLength = cloneSource
    ? cloneSource.rotationCos * cloneSource.rotationCos
      + cloneSource.rotationSin * cloneSource.rotationSin
    : 1;
  if (
    cloneSource
    && (
      cloneSource.stampBytes !== expectedStampBytes
      || cloneSource.sourceByteOffset < expectedStampBytes
      || cloneSource.sourceByteOffset % 256 !== 0
      || cloneSource.bytesPerRow % 256 !== 0
      || cloneSource.tileStrideBytes
        !== cloneSource.bytesPerRow * cloneSource.rowsPerImage
      || cloneTransformValues.some((value) => !Number.isFinite(value))
      || cloneSource.angleDegrees < -180
      || cloneSource.angleDegrees > 180
      || Math.abs(cloneRotationLength - 1) > 1e-5
      || new Set(cloneTiles).size !== cloneTiles.length
      || cloneTiles.some((tileIndex) => (
        !Number.isInteger(tileIndex)
        || tileIndex < 0
        || tileIndex >= CLONE_SOURCE_PAGE_TABLE_LENGTH
      ))
    )
  ) {
    throw new Error("Invalid Clone history source layout.");
  }
  if (replayBatch.gpuSlice.logicalBytes !== expectedBytes) {
    throw new Error(
      `GPU Paint payload ${replayBatch.gpuSlice.logicalBytes} B; `
      + `expected ${expectedBytes} B.`,
    );
  }
  return replayBatch.stampCount;
}
