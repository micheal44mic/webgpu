export const DESTRUCTIVE_GAUSSIAN_BLUR_CORE_BUILD =
  "destructive-gaussian-blur-core-v2-three-sigma-format-neutral";

export const DESTRUCTIVE_GAUSSIAN_BLUR_DEFAULT_RADIUS = 5;
export const DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS = 500;
export const DESTRUCTIVE_GAUSSIAN_BLUR_RADIUS_STEP = 1;
export const DESTRUCTIVE_GAUSSIAN_BLUR_STRIP_HEIGHT = 256;
export const DESTRUCTIVE_TENT_BLUR_MAX_WORK_RADIUS = 64;

export type DestructiveGaussianBlurStrategy =
  | "baseline-gaussian"
  | "optimized-tent";

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

export interface DestructiveTentBlurPlan {
  /** Radius in document pixels after applying the public filter limits. */
  readonly radius: number;
  /** Initial device pixels represented by one document pixel. */
  readonly renderScale: number;
  /** Requested tent radius before the bounded working-grid reduction. */
  readonly rawCount: number;
  /** Tent radius evaluated by each separable GPU pass. */
  readonly count: number;
  /** Working texels represented by one document pixel. */
  readonly workScale: number;
  /** Initial-grid pixels represented by one working texel. */
  readonly downsample: number;
  /** Integer halo required around the working output. */
  readonly supportRadius: number;
  /** Axis sample count used by the bounded prefilter (one when unscaled). */
  readonly prefilterSampleAxis: number;
  /** Prefilter footprint in initial-grid pixels; widens continuously from zero. */
  readonly prefilterWidth: number;
  /** Center fetch plus two fetches for every paired positive offset. */
  readonly sampleCountPerPass: number;
}

export interface TentBlurSamplePair {
  /** Effective positive offset read with one linearly filtered sample. */
  readonly offset: number;
  /** Combined weight of the two adjacent logical taps. */
  readonly weight: number;
  readonly firstOffset: number;
  readonly secondOffset: number;
  readonly firstWeight: number;
  readonly secondWeight: number;
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

/**
 * Plans a continuously scaled separable tent blur.
 *
 * Production destructive filtering deliberately uses the default scale of one
 * so committed pixels never depend on camera zoom. Callers that render an
 * ephemeral comparison may pass their own device-pixel scale.
 */
export function destructiveTentBlurPlan(
  value: unknown,
  renderScaleValue: unknown = 1,
): DestructiveTentBlurPlan {
  const radius = normalizeDestructiveGaussianBlurRadius(value);
  const renderScale = Math.max(Number.EPSILON, finite(renderScaleValue, 1));
  const rawCount = radius * renderScale;
  const count = Math.min(rawCount, DESTRUCTIVE_TENT_BLUR_MAX_WORK_RADIUS);
  const workScale = radius > 0
    ? Math.min(renderScale, DESTRUCTIVE_TENT_BLUR_MAX_WORK_RADIUS / radius)
    : renderScale;
  const downsample = renderScale / workScale;
  const pairs = destructiveTentBlurSamplePairs(count);
  const prefilterSampleAxis = downsample <= 1.000001
    ? 1
    : Math.min(4, Math.max(2, Math.ceil(downsample)));
  return Object.freeze({
    radius,
    renderScale,
    rawCount,
    count,
    workScale,
    downsample,
    supportRadius: Math.ceil(count),
    prefilterSampleAxis,
    prefilterWidth: Math.max(0, downsample - 1),
    sampleCountPerPass: 1 + pairs.length * 2,
  });
}

/**
 * Combines adjacent logical tent taps into coordinates suitable for linear
 * texture filtering. The result is algebraically equivalent to evaluating the
 * individual taps, including for a fractional tent radius.
 */
export function destructiveTentBlurSamplePairs(
  countValue: unknown,
): readonly TentBlurSamplePair[] {
  const count = clamp(
    finite(countValue, 0),
    0,
    DESTRUCTIVE_TENT_BLUR_MAX_WORK_RADIUS,
  );
  const pairs: TentBlurSamplePair[] = [];
  for (let firstOffset = 1; firstOffset < count; firstOffset += 2) {
    const secondOffset = Math.min(firstOffset + 1, count);
    const firstWeight = count - firstOffset;
    const secondWeight = count - secondOffset;
    const weight = firstWeight + secondWeight;
    if (weight <= 0) continue;
    pairs.push(Object.freeze({
      offset: (
        firstOffset * firstWeight + secondOffset * secondWeight
      ) / weight,
      weight,
      firstOffset,
      secondOffset,
      firstWeight,
      secondWeight,
    }));
  }
  return Object.freeze(pairs);
}

export function destructiveTentBlurNormalization(countValue: unknown): number {
  const count = clamp(
    finite(countValue, 0),
    0,
    DESTRUCTIVE_TENT_BLUR_MAX_WORK_RADIUS,
  );
  if (count <= 0) return 1;
  return count + destructiveTentBlurSamplePairs(count).reduce(
    (sum, pair) => sum + pair.weight * 2,
    0,
  );
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
