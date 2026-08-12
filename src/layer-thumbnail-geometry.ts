export const LAYER_THUMBNAIL_SIZE = 64 as const;

export interface LayerThumbnailDimensions {
  readonly width: number;
  readonly height: number;
}

export function layerThumbnailDimensions(
  documentWidth: number,
  documentHeight: number,
  maximumEdge = LAYER_THUMBNAIL_SIZE,
): LayerThumbnailDimensions {
  if (
    !Number.isFinite(documentWidth)
    || !Number.isFinite(documentHeight)
    || !Number.isFinite(maximumEdge)
    || documentWidth <= 0
    || documentHeight <= 0
    || maximumEdge < 1
  ) {
    throw new RangeError("Dimensioni miniatura livello non valide.");
  }
  const scale = Math.min(maximumEdge / documentWidth, maximumEdge / documentHeight);
  return {
    width: Math.max(1, Math.round(documentWidth * scale)),
    height: Math.max(1, Math.round(documentHeight * scale)),
  };
}
