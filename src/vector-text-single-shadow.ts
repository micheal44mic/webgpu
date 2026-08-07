export const VECTOR_TEXT_SINGLE_SHADOW_BLUR_STRATEGY =
  "webgpu-slug-r16float-mask-separable-gaussian-roi-cache-v3" as const;

export const VECTOR_TEXT_SINGLE_SHADOW_BLUR_MAXIMUM = 300;
export const VECTOR_TEXT_SINGLE_SHADOW_MAX_PIXELS = 4 * 1024 * 1024;
export const VECTOR_TEXT_SINGLE_SHADOW_MAX_TEXTURE_SIZE = 4096;
export const VECTOR_TEXT_SINGLE_SHADOW_MAX_SIGMA_PIXELS = 8;
export const VECTOR_TEXT_SINGLE_SHADOW_MAX_KERNEL_RADIUS = 24;

export interface VectorTextSingleShadowBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface VectorTextSingleShadowBlurPlan {
  readonly bounds: Float64Array;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly sigmaPixels: number;
  readonly radius: number;
}

function finite(
  value: number,
  fallback: number,
  minimum = -Infinity,
  maximum = Infinity,
): number {
  return Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, value))
    : fallback;
}

export function vectorTextSingleShadowBlurSupport(value: number): number {
  const blur = finite(value, 0, 0, VECTOR_TEXT_SINGLE_SHADOW_BLUR_MAXIMUM);
  return blur > 0 ? blur * 3 + 1 : 0;
}

/**
 * Port del planner di paint-webgpu-m1/geom/vector-shadow-blur-renderer.js.
 * Il blur resta in coordinate locali, ma la mask viene rasterizzata soltanto
 * alla densità utile per la vista corrente. Sigma e kernel sono limitati e
 * l'area non può superare quattro megapixel.
 */
export function planVectorTextSingleShadowBlur(
  bounds: VectorTextSingleShadowBounds,
  blur: number,
  pixelScale: number,
  {
    maxTextureSize = VECTOR_TEXT_SINGLE_SHADOW_MAX_TEXTURE_SIZE,
    maxPixels = VECTOR_TEXT_SINGLE_SHADOW_MAX_PIXELS,
  }: {
    maxTextureSize?: number;
    maxPixels?: number;
  } = {},
): VectorTextSingleShadowBlurPlan {
  const sigmaLocal = finite(
    blur,
    0,
    0,
    VECTOR_TEXT_SINGLE_SHADOW_BLUR_MAXIMUM,
  );
  const support = vectorTextSingleShadowBlurSupport(sigmaLocal);
  const paddedBounds = new Float64Array([
    Number(bounds.left) - support,
    Number(bounds.top) - support,
    Number(bounds.right) + support,
    Number(bounds.bottom) + support,
  ]);
  const logicalWidth = Math.max(1e-6, paddedBounds[2] - paddedBounds[0]);
  const logicalHeight = Math.max(1e-6, paddedBounds[3] - paddedBounds[1]);
  let scale = finite(pixelScale, 1, 0.0001, 1_000_000);
  if (sigmaLocal > 0 && sigmaLocal * scale > VECTOR_TEXT_SINGLE_SHADOW_MAX_SIGMA_PIXELS) {
    scale = VECTOR_TEXT_SINGLE_SHADOW_MAX_SIGMA_PIXELS / sigmaLocal;
  }
  const sizeAtScale = () => ({
    width: Math.max(2, Math.ceil(logicalWidth * scale)),
    height: Math.max(2, Math.ceil(logicalHeight * scale)),
  });
  let size = sizeAtScale();
  const dimensionRatio = Math.min(
    1,
    maxTextureSize / size.width,
    maxTextureSize / size.height,
  );
  const pixelRatio = Math.min(
    1,
    Math.sqrt(maxPixels / Math.max(1, size.width * size.height)),
  );
  const ratio = Math.min(dimensionRatio, pixelRatio);
  if (ratio < 1) {
    scale = Math.max(0.0001, scale * ratio * 0.999);
    size = sizeAtScale();
  }
  const sigmaPixels = Math.max(0.01, sigmaLocal * scale);
  return Object.freeze({
    bounds: paddedBounds,
    width: Math.min(maxTextureSize, size.width),
    height: Math.min(maxTextureSize, size.height),
    scale,
    sigmaPixels,
    radius: Math.max(
      1,
      Math.min(
        VECTOR_TEXT_SINGLE_SHADOW_MAX_KERNEL_RADIUS,
        Math.ceil(sigmaPixels * 3),
      ),
    ),
  });
}
