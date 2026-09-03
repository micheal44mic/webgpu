import type { MergedSurfaceResources } from "./engine-layer-resources";

export const MIXED_SCENE_RASTER_SEGMENT_UNIFORM_FLOATS = 12;
export const MIXED_SCENE_RASTER_SEGMENT_UNIFORM_BYTES =
  MIXED_SCENE_RASTER_SEGMENT_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT;

export interface MixedSceneRasterTransformPreview {
  readonly key: `raster:${number}`;
  readonly pivotX: number;
  readonly pivotY: number;
  readonly translationX: number;
  readonly translationY: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly rotation: number;
}

export interface NormalizedMixedSceneRasterTransformPreview
  extends MixedSceneRasterTransformPreview {
  readonly rasterLayerId: number;
}

const MINIMUM_INVERTIBLE_SCALE = 0.0001;

export function rasterLayerIdFromPreviewKey(key: `raster:${number}`): number {
  const value = Number(key.slice("raster:".length));
  if (!Number.isSafeInteger(value) || value <= 0 || key !== `raster:${value}`) {
    throw new RangeError(`Invalid raster preview key ${key}.`);
  }
  return value;
}

export function normalizeMixedSceneRasterTransformPreview(
  value: MixedSceneRasterTransformPreview,
): NormalizedMixedSceneRasterTransformPreview {
  const rasterLayerId = rasterLayerIdFromPreviewKey(value.key);
  const numeric = [
    value.pivotX,
    value.pivotY,
    value.translationX,
    value.translationY,
    value.scaleX,
    value.scaleY,
    value.rotation,
  ];
  if (numeric.some((candidate) => !Number.isFinite(candidate))) {
    throw new RangeError(`Raster preview ${value.key} contains a non-finite transform.`);
  }
  if (
    Math.abs(value.scaleX) < MINIMUM_INVERTIBLE_SCALE
    || Math.abs(value.scaleY) < MINIMUM_INVERTIBLE_SCALE
  ) {
    throw new RangeError(
      `Raster preview ${value.key} must remain invertible on both axes.`,
    );
  }
  return { ...value, rasterLayerId };
}

/**
 * Returns an inverse document-space affine. The segment presenter evaluates
 * destination pixels, so it maps each destination point back into the
 * immutable source surface instead of resampling that surface every frame.
 */
export function mixedSceneRasterPreviewInverseAffine(
  transform: Pick<
    MixedSceneRasterTransformPreview,
    | "pivotX"
    | "pivotY"
    | "translationX"
    | "translationY"
    | "scaleX"
    | "scaleY"
    | "rotation"
  >,
): readonly [number, number, number, number, number, number] {
  const cosine = Math.cos(transform.rotation);
  const sine = Math.sin(transform.rotation);
  const m00 = cosine / transform.scaleX;
  const m01 = sine / transform.scaleX;
  const m10 = -sine / transform.scaleY;
  const m11 = cosine / transform.scaleY;
  const translatedPivotX = transform.pivotX + transform.translationX;
  const translatedPivotY = transform.pivotY + transform.translationY;
  const offsetX = transform.pivotX
    - m00 * translatedPivotX
    - m01 * translatedPivotY;
  const offsetY = transform.pivotY
    - m10 * translatedPivotX
    - m11 * translatedPivotY;
  return [m00, m01, offsetX, m10, m11, offsetY];
}

/** Forward-projects a source rectangle through the same affine used by the presenter. */
export function mixedSceneRasterPreviewTransformedBounds(
  bounds: Readonly<{ x: number; y: number; width: number; height: number }>,
  transform: Pick<
    MixedSceneRasterTransformPreview,
    | "pivotX"
    | "pivotY"
    | "translationX"
    | "translationY"
    | "scaleX"
    | "scaleY"
    | "rotation"
  > | null,
): { x: number; y: number; width: number; height: number } {
  if (!transform) return { ...bounds };
  const cosine = Math.cos(transform.rotation);
  const sine = Math.sin(transform.rotation);
  const translatedPivotX = transform.pivotX + transform.translationX;
  const translatedPivotY = transform.pivotY + transform.translationY;
  const project = (x: number, y: number): { x: number; y: number } => {
    const deltaX = (x - transform.pivotX) * transform.scaleX;
    const deltaY = (y - transform.pivotY) * transform.scaleY;
    return {
      x: translatedPivotX + cosine * deltaX - sine * deltaY,
      y: translatedPivotY + sine * deltaX + cosine * deltaY,
    };
  };
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  const corners = [
    project(bounds.x, bounds.y),
    project(right, bounds.y),
    project(bounds.x, bottom),
    project(right, bottom),
  ];
  const left = Math.min(...corners.map((point) => point.x));
  const top = Math.min(...corners.map((point) => point.y));
  const transformedRight = Math.max(...corners.map((point) => point.x));
  const transformedBottom = Math.max(...corners.map((point) => point.y));
  return {
    x: left,
    y: top,
    width: transformedRight - left,
    height: transformedBottom - top,
  };
}

export function mixedSceneRasterSegmentUniformValues(
  surface: Pick<MergedSurfaceResources, "bounds" | "resolutionScale">,
  opacity: number,
  transform: MixedSceneRasterTransformPreview | null = null,
): Float32Array {
  const inverse = transform
    ? mixedSceneRasterPreviewInverseAffine(transform)
    : [1, 0, 0, 0, 1, 0] as const;
  const inverseFootprint = transform
    ? Math.max(1 / Math.abs(transform.scaleX), 1 / Math.abs(transform.scaleY))
    : 1;
  return new Float32Array([
    surface.bounds.x,
    surface.bounds.y,
    surface.resolutionScale,
    Math.min(1, Math.max(0, opacity)),
    inverse[0],
    inverse[1],
    inverse[2],
    inverseFootprint,
    inverse[3],
    inverse[4],
    inverse[5],
    0,
  ]);
}

export function mixedSceneRasterPreviewTransformsEqual(
  left: ReadonlyMap<number, NormalizedMixedSceneRasterTransformPreview>,
  right: ReadonlyMap<number, NormalizedMixedSceneRasterTransformPreview>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [id, value] of left) {
    const candidate = right.get(id);
    if (
      !candidate
      || value.pivotX !== candidate.pivotX
      || value.pivotY !== candidate.pivotY
      || value.translationX !== candidate.translationX
      || value.translationY !== candidate.translationY
      || value.scaleX !== candidate.scaleX
      || value.scaleY !== candidate.scaleY
      || value.rotation !== candidate.rotation
    ) {
      return false;
    }
  }
  return true;
}
