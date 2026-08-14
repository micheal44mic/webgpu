import type { LayerRect } from "./layer-stack";
import type { RasterImageDocument } from "./scene-image-model";

export const RASTER_LAYER_SOURCE_STRATEGY =
  "immutable-encoded-master-cumulative-document-matrix-derived-raster-cache-v1" as const;

/**
 * Non-destructive provenance for an imported raster layer.
 *
 * The encoded Blob and GPU mip chain live in the engine asset registry. This
 * small structured-clone-safe value is the only part carried by layer state,
 * History and project manifests. Transform never rewrites the asset: it only
 * replaces these document-space matrix parameters and rebuilds the native
 * raster cache from the same master.
 */
export interface RasterLayerSource {
  readonly document: RasterImageDocument;
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

export interface RasterLayerAffineDelta {
  readonly translationX: number;
  readonly translationY: number;
  readonly scale: number;
  readonly rotation: number;
}

export function cloneRasterLayerSource(
  source: Readonly<RasterLayerSource> | null,
): RasterLayerSource | null {
  return source
    ? {
      ...source,
      document: { ...source.document },
    }
    : null;
}

export function composeRasterLayerSourceTransform(
  source: Readonly<RasterLayerSource>,
  delta: Readonly<RasterLayerAffineDelta>,
): RasterLayerSource {
  const scale = Number.isFinite(delta.scale)
    ? Math.min(64, Math.max(0.01, source.scale * delta.scale))
    : source.scale;
  const rotation = Math.atan2(
    Math.sin(source.rotation + delta.rotation),
    Math.cos(source.rotation + delta.rotation),
  );
  return {
    document: { ...source.document },
    x: source.x + delta.translationX,
    y: source.y + delta.translationY,
    scale,
    rotation,
  };
}

/** Exact AABB of the transformed source quad, optionally clipped to a document. */
export function rasterLayerSourceBounds(
  source: Readonly<RasterLayerSource>,
  documentWidth?: number,
  documentHeight?: number,
): LayerRect | null {
  const halfWidth = Math.abs(source.document.width * source.scale * 0.5);
  const halfHeight = Math.abs(source.document.height * source.scale * 0.5);
  const cosine = Math.abs(Math.cos(source.rotation));
  const sine = Math.abs(Math.sin(source.rotation));
  const extentX = cosine * halfWidth + sine * halfHeight;
  const extentY = sine * halfWidth + cosine * halfHeight;
  let left = Math.floor(source.x - extentX);
  let top = Math.floor(source.y - extentY);
  let right = Math.ceil(source.x + extentX);
  let bottom = Math.ceil(source.y + extentY);
  if (![left, top, right, bottom].every(Number.isFinite)) return null;
  if (documentWidth !== undefined) {
    left = Math.max(0, Math.min(documentWidth, left));
    right = Math.max(0, Math.min(documentWidth, right));
  }
  if (documentHeight !== undefined) {
    top = Math.max(0, Math.min(documentHeight, top));
    bottom = Math.max(0, Math.min(documentHeight, bottom));
  }
  return right > left && bottom > top
    ? { x: left, y: top, width: right - left, height: bottom - top }
    : null;
}

export function rasterLayerSourcesEqual(
  left: Readonly<RasterLayerSource> | null,
  right: Readonly<RasterLayerSource> | null,
): boolean {
  if (!left || !right) return left === right;
  return left.document.assetId === right.document.assetId
    && left.document.sourceName === right.document.sourceName
    && left.document.mimeType === right.document.mimeType
    && left.document.sourceBytes === right.document.sourceBytes
    && left.document.width === right.document.width
    && left.document.height === right.document.height
    && left.x === right.x
    && left.y === right.y
    && left.scale === right.scale
    && left.rotation === right.rotation;
}
