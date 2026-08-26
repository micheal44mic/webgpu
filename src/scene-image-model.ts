import { normalizeSceneAxisScale } from "./scene-axis-scale.ts";

/**
 * Immutable metadata for a decoded raster asset. Blob, ImageBitmap and
 * GPUTexture live in the engine asset registry, so scene snapshots and history
 * can share this record without retaining or cloning pixel payloads.
 */
export interface RasterImageDocument {
  readonly assetId: string;
  readonly sourceName: string;
  readonly mimeType: string;
  readonly sourceBytes: number;
  readonly width: number;
  readonly height: number;
}

export interface RasterImageNode {
  readonly id: number;
  readonly kind: "image";
  name: string;
  visible: boolean;
  opacity: number;
  document: RasterImageDocument;
  x: number;
  y: number;
  /** Horizontal compatibility alias; old documents use it for both axes. */
  scale: number;
  scaleX?: number;
  scaleY?: number;
  rotation: number;
}

export interface RasterImageNodeSeed {
  document: RasterImageDocument;
  x: number;
  y: number;
  scale: number;
  scaleX?: number;
  scaleY?: number;
  rotation: number;
}

export function cloneRasterImageDocument(
  documentValue: Readonly<RasterImageDocument>,
): RasterImageDocument {
  return { ...documentValue };
}

export function cloneRasterImageNode(
  node: Readonly<RasterImageNode>,
): RasterImageNode {
  return {
    ...node,
    ...normalizeSceneAxisScale(node),
    document: cloneRasterImageDocument(node.document),
  };
}

/** History snapshots share immutable asset metadata and never clone pixels. */
export function cloneRasterImageNodeForHistory(
  node: Readonly<RasterImageNode>,
): RasterImageNode {
  return {
    ...node,
    ...normalizeSceneAxisScale(node),
    document: node.document,
  };
}
