export const DESTRUCTIVE_GAUSSIAN_BLUR_CORE_BUILD =
  "destructive-gaussian-blur-core-v2-three-sigma-format-neutral";

export const DESTRUCTIVE_GAUSSIAN_BLUR_DEFAULT_RADIUS = 5;
export const DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS = 500;
export const DESTRUCTIVE_GAUSSIAN_BLUR_RADIUS_STEP = 1;
export const DESTRUCTIVE_GAUSSIAN_BLUR_STRIP_HEIGHT = 256;

export interface GaussianBlurRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GaussianBlurKernel {
  /** Integer three-sigma support used by both separable passes. */
  radius: number;
  sigma: number;
  /** Center weight followed by the weights for positive offsets. */
  weights: readonly number[];
}

function finite(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function normalizeDestructiveGaussianBlurRadius(value: unknown): number {
  return clamp(
    finite(value, DESTRUCTIVE_GAUSSIAN_BLUR_DEFAULT_RADIUS),
    0,
    DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS,
  );
}

export function destructiveGaussianBlurSupportRadius(value: unknown): number {
  return Math.ceil(normalizeDestructiveGaussianBlurRadius(value));
}

export function destructiveGaussianBlurSigma(value: unknown): number {
  const radius = normalizeDestructiveGaussianBlurRadius(value);
  return radius > 0 ? Math.max(0.3, radius / 3) : 0;
}

export function destructiveGaussianBlurKernel(value: unknown): GaussianBlurKernel {
  const radius = destructiveGaussianBlurSupportRadius(value);
  const sigma = destructiveGaussianBlurSigma(value);
  if (radius === 0 || sigma === 0) {
    return { radius: 0, sigma: 0, weights: Object.freeze([1]) };
  }

  const weights = new Array<number>(radius + 1);
  const inverseTwoSigmaSquared = 0.5 / (sigma * sigma);
  weights[0] = 1;
  let total = 1;
  for (let offset = 1; offset <= radius; offset += 1) {
    const weight = Math.exp(-(offset * offset) * inverseTwoSigmaSquared);
    weights[offset] = weight;
    total += weight * 2;
  }
  for (let offset = 0; offset < weights.length; offset += 1) {
    weights[offset] /= total;
  }
  return { radius, sigma, weights: Object.freeze(weights) };
}

export function normalizeGaussianBlurRect(
  rect: GaussianBlurRect | null | undefined,
  documentWidth: number,
  documentHeight: number,
): GaussianBlurRect | null {
  if (!rect) return null;
  const x = clamp(Math.floor(finite(rect.x, 0)), 0, documentWidth);
  const y = clamp(Math.floor(finite(rect.y, 0)), 0, documentHeight);
  const right = clamp(
    Math.ceil(finite(rect.x, 0) + Math.max(0, finite(rect.width, 0))),
    0,
    documentWidth,
  );
  const bottom = clamp(
    Math.ceil(finite(rect.y, 0) + Math.max(0, finite(rect.height, 0))),
    0,
    documentHeight,
  );
  return right > x && bottom > y
    ? { x, y, width: right - x, height: bottom - y }
    : null;
}

export function destructiveGaussianBlurBounds(
  contentBounds: GaussianBlurRect | null | undefined,
  radius: unknown,
  documentWidth: number,
  documentHeight: number,
): GaussianBlurRect | null {
  const normalized = normalizeGaussianBlurRect(
    contentBounds,
    documentWidth,
    documentHeight,
  );
  if (!normalized) return null;
  const support = destructiveGaussianBlurSupportRadius(radius);
  return normalizeGaussianBlurRect({
    x: normalized.x - support,
    y: normalized.y - support,
    width: normalized.width + support * 2,
    height: normalized.height + support * 2,
  }, documentWidth, documentHeight);
}

export function unionGaussianBlurRects(
  left: GaussianBlurRect | null | undefined,
  right: GaussianBlurRect | null | undefined,
): GaussianBlurRect | null {
  if (!left) return right ? { ...right } : null;
  if (!right) return { ...left };
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const rightEdge = Math.max(left.x + left.width, right.x + right.width);
  const bottom = Math.max(left.y + left.height, right.y + right.height);
  return { x, y, width: rightEdge - x, height: bottom - y };
}
