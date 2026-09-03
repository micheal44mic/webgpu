import { vectorTextFloat64Key } from "./vector-text-lod.ts";

export const VECTOR_GPU_BLUR_CACHE_KEY_VERSION =
  "vector-gpu-blur-content-v3-adaptive-tent" as const;

export interface VectorGpuBlurCacheKeySource {
  readonly kind: "mesh" | "slug";
  readonly revision: string;
}

export interface VectorGpuBlurCacheKeyPlan {
  readonly bounds: ArrayLike<number>;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly sigmaPixels: number;
  readonly radius: number;
}

function exactFiniteNumberKey(label: string, value: number): string {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite.`);
  }
  return vectorTextFloat64Key(value);
}

/**
 * Names a reusable blurred matte by source content and its complete raster plan.
 * Scene identity, paint, opacity and transforms are deliberately excluded: they
 * are applied after the cached local-space matte has been built.
 */
export function vectorGpuBlurCacheKey(
  source: Readonly<VectorGpuBlurCacheKeySource>,
  plan: Readonly<VectorGpuBlurCacheKeyPlan>,
): string {
  if (!source.revision) {
    throw new TypeError("The blur source revision must not be empty.");
  }
  if (plan.bounds.length !== 4) {
    throw new TypeError("The blur matte must have exactly four bounds.");
  }
  return [
    VECTOR_GPU_BLUR_CACHE_KEY_VERSION,
    source.kind,
    JSON.stringify(source.revision),
    exactFiniteNumberKey("Blur bound left", plan.bounds[0]),
    exactFiniteNumberKey("Blur bound top", plan.bounds[1]),
    exactFiniteNumberKey("Blur bound right", plan.bounds[2]),
    exactFiniteNumberKey("Blur bound bottom", plan.bounds[3]),
    exactFiniteNumberKey("Blur width", plan.width),
    exactFiniteNumberKey("Blur height", plan.height),
    exactFiniteNumberKey("Blur scale", plan.scale),
    exactFiniteNumberKey("Blur sigma", plan.sigmaPixels),
    exactFiniteNumberKey("Blur radius", plan.radius),
  ].join(":");
}
