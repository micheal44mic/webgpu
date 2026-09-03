export const ADAPTIVE_TENT_BLUR_MAX_WORK_RADIUS = 64;

export interface AdaptiveTentBlurPlan {
  /** Requested radius in the caller's logical pixel grid. */
  readonly radius: number;
  /** Initial device pixels represented by one logical pixel. */
  readonly renderScale: number;
  /** Requested tent radius before the bounded working-grid reduction. */
  readonly rawCount: number;
  /** Tent radius evaluated by each separable GPU pass. */
  readonly count: number;
  /** Working texels represented by one logical pixel. */
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

export interface AdaptiveTentBlurSamplePair {
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

/** Plans a continuously scaled separable tent blur for a normalized radius. */
export function planAdaptiveTentBlur(
  radiusValue: unknown,
  renderScaleValue: unknown = 1,
): AdaptiveTentBlurPlan {
  const radius = Math.max(0, finite(radiusValue, 0));
  const renderScale = Math.max(Number.EPSILON, finite(renderScaleValue, 1));
  const rawCount = radius * renderScale;
  const count = Math.min(rawCount, ADAPTIVE_TENT_BLUR_MAX_WORK_RADIUS);
  const workScale = radius > 0
    ? Math.min(renderScale, ADAPTIVE_TENT_BLUR_MAX_WORK_RADIUS / radius)
    : renderScale;
  const downsample = renderScale / workScale;
  const pairs = adaptiveTentBlurSamplePairs(count);
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
 * Combines adjacent logical tent taps into one linearly filtered coordinate.
 * Fractional radii retain the same normalization as individual logical taps.
 */
export function adaptiveTentBlurSamplePairs(
  countValue: unknown,
): readonly AdaptiveTentBlurSamplePair[] {
  const count = clamp(
    finite(countValue, 0),
    0,
    ADAPTIVE_TENT_BLUR_MAX_WORK_RADIUS,
  );
  const pairs: AdaptiveTentBlurSamplePair[] = [];
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

export function adaptiveTentBlurNormalization(countValue: unknown): number {
  const count = clamp(
    finite(countValue, 0),
    0,
    ADAPTIVE_TENT_BLUR_MAX_WORK_RADIUS,
  );
  if (count <= 0) return 1;
  return count + adaptiveTentBlurSamplePairs(count).reduce(
    (sum, pair) => sum + pair.weight * 2,
    0,
  );
}
