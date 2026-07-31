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
  VectorSvgNode,
} from "./mixed-scene-stack";
import type { ShapeOccupancySelection } from "./shape-occupancy";
import { MAX_STAMPS_PER_BATCH, STAMP_STRIDE_BYTES } from "./engine-limits";
import type { LayerColdStorageResources } from "./engine-layer-resources";
import type { LayerRecord } from "./layer-stack";

export interface RasterHistoryAction {
  id: number;
  kind: "stroke" | "clear";
  layerId: number;
}

export interface VectorHistoryAction {
  id: number;
  kind: "vector";
  delta: MixedSceneVectorHistoryDelta;
}

export interface VectorRasterizeHistoryAction {
  id: number;
  kind: "vector-rasterize";
  sourceKind: "text" | "svg";
  layerId: number;
  layerRecord: LayerRecord;
  rasterLayerIndex: number;
  vectorState: MixedSceneVectorHistoryState;
  seed: LayerColdStorageResources;
  baseBounds: DirtyRect;
  baseTileMask: Uint32Array;
}

export type HistoryAction =
  | RasterHistoryAction
  | VectorHistoryAction
  | VectorRasterizeHistoryAction;

export interface ActiveVectorHistoryEdit {
  key: MixedSceneVectorKey;
  before: MixedSceneVectorHistoryState;
}

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
  if (left.key.startsWith("text:")) {
    return JSON.stringify(left.node) === JSON.stringify(right.node);
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
  shapeMaskIdentity: number;
  grainTextureIdentity: number | null;
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
  shapeMaskIdentity: number;
  grainTextureIdentity: number | null;
}

export type HistoryRenderBatch = PaintHistoryRenderBatch | BlendHistoryRenderBatch;

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
