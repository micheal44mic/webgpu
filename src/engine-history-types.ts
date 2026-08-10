/**
 * Modello della cronologia unificata: azioni raster e vettoriali, batch di
 * replay e confronto degli stati vettoriali.
 */
import type { DryBlendHistoryGeometry } from "./blend-renderer";
import type { DirtyRect, Stamp } from "./engine-stroke-types";
import type { BrushSettings } from "./engine-types";
import type { GpuHistorySlice } from "./gpu-history-storage";
import type {
  MixedSceneVectorHistoryDelta,
  MixedSceneVectorHistoryState,
  MixedSceneVectorKey,
  MixedSceneItem,
  RasterImageNode,
  VectorSvgNode,
} from "./mixed-scene-stack";
import type { ShapeOccupancySelection } from "./shape-occupancy";
import { MAX_STAMPS_PER_BATCH, STAMP_STRIDE_BYTES } from "./engine-limits";
import type { LayerColdStorageResources } from "./engine-layer-resources";
import type { LayerClippingHistoryEntry, LayerRecord } from "./layer-stack";
import type { LayerBlendMode } from "./layer-blend-modes";
import type { MixedSceneOrderState } from "./mixed-scene-reorder-core";
import type { RasterStrokeStyle } from "./stroke-core";
import type { RasterBevelStyle } from "./bevel-core";
import type { RasterInnerShadowStyle, RasterOuterShadowStyle } from "./shadow-core";
import type { RasterColorOverlayStyle } from "./raster-color-overlay-core";
import type { RasterNoiseChannels, RasterNoiseStyle } from "./noise-core";

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
  before: MixedSceneOrderState;
  after: MixedSceneOrderState;
}

/** One journal field per independent raster property/effect gesture. */
export interface RasterLayerMetadataHistoryValueMap {
  readonly visibility: boolean;
  readonly opacity: number;
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
 * Non serve un `seed`: quando l'Undo attraversa la creazione, tutte le azioni
 * successive sono gia' state annullate, quindi il livello e' vuoto.
 */
export interface LayerAddHistoryAction {
  id: number;
  kind: "layer-add";
  layerRecord: LayerRecord;
  rasterLayerIndex: number;
  sceneIndex: number;
  clippingParentId: number | null;
  selectedKeyBefore: MixedSceneItem["key"];
  activeRasterLayerIdBefore: number;
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
 * A raster transform stores its exact post-Apply tiled pixels. The affine
 * matrix is diagnostic/UI metadata; Undo/Redo hydrates `seed` and never
 * resamples the layer a second time.
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
 * Exact post-Apply pixels produced by a destructive raster filter.
 *
 * Undo/Redo hydrates the checkpoint and never evaluates the filter again, so a
 * future shader change cannot alter an existing document's history.
 */
interface RasterFilterHistoryActionCommon extends RasterHistoryCheckpoint {
  id: number;
  kind: "raster-filter";
  seed: LayerColdStorageResources;
  baseBounds: DirtyRect;
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
);

export type RasterHistoryCheckpointAction =
  | VectorRasterizeHistoryAction
  | RasterImportHistoryAction
  | RasterTransformHistoryAction
  | RasterFilterHistoryAction;

export type HistoryAction =
  | RasterHistoryAction
  | VectorHistoryAction
  | LayerBlendModeHistoryAction
  | RasterLayerMetadataHistoryAction
  | MixedSceneReorderHistoryAction
  | VectorRasterizeHistoryAction
  | RasterImportHistoryAction
  | RasterTransformHistoryAction
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
    || action.kind === "raster-filter";
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
  tolerancePercent: number;
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
    throw new Error("Il replay Paint GPU non deve conservare stamp sul CPU.");
  }
  if (
    !Number.isInteger(replayBatch.stampCount)
    || replayBatch.stampCount <= 0
    || replayBatch.stampCount > MAX_STAMPS_PER_BATCH
  ) {
    throw new RangeError("Conteggio stamp della cronologia GPU non valido.");
  }
  const expectedBytes = replayBatch.stampCount * STAMP_STRIDE_BYTES;
  if (replayBatch.gpuSlice.logicalBytes !== expectedBytes) {
    throw new Error(
      `Payload GPU Paint ${replayBatch.gpuSlice.logicalBytes} B, `
      + `attesi ${expectedBytes} B.`,
    );
  }
  return replayBatch.stampCount;
}
