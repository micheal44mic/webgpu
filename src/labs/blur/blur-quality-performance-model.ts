export const BLUR_QUALITY_PERFORMANCE_LAB_ID = "blur-quality-performance";
export const BLUR_QUALITY_PERFORMANCE_REPORT_VERSION = 1;
export const BLUR_QUALITY_PERFORMANCE_STRATEGY =
  "exact-gaussian-vs-continuous-scale-tent-v1";
export const BLUR_QUALITY_PERFORMANCE_FIXTURE_REVISION =
  "high-contrast-brush-circle-v2";

export const BLUR_QUALITY_PERFORMANCE_RADII = Object.freeze([
  4,
  16,
  64,
  128,
  256,
] as const);

export interface BlurQualityPerformanceConfig {
  readonly size: number;
  readonly runs: number;
  readonly warmupRuns: number;
  readonly radii: readonly number[];
}

export interface BlurTimingSummary {
  readonly samplesMs: readonly number[];
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly minimumMs: number;
  readonly maximumMs: number;
}

export interface BlurQualityMetrics {
  readonly meanAbsoluteError: number;
  readonly rootMeanSquareError: number;
  readonly peakSignalToNoiseRatioDb: number | null;
  readonly maximumAbsoluteError: number;
  readonly alphaMeanAbsoluteError: number;
  readonly alphaEnergyRatio: number;
}

export interface BlurQualityPerformanceCaseReport {
  readonly radius: number;
  readonly baseline: BlurTimingSummary;
  readonly optimized: BlurTimingSummary;
  readonly speedup: number;
  readonly work: {
    readonly rawCount: number;
    readonly count: number;
    readonly downsample: number;
    readonly workScale: number;
    readonly prefilterSampleAxis: number;
    readonly prefilterWidth: number;
    readonly width: number;
    readonly height: number;
  };
  readonly quality: BlurQualityMetrics;
}

function finiteInteger(
  value: string | number | null | undefined,
  fallback: number,
): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function coverage(distance: number): number {
  return clamp(0.5 - distance, 0, 1);
}

interface BrushFixturePoint {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

function variableStrokeDistance(
  x: number,
  y: number,
  points: readonly BrushFixturePoint[],
): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const position = lengthSquared > 0
      ? clamp(
        ((x - start.x) * deltaX + (y - start.y) * deltaY) / lengthSquared,
        0,
        1,
      )
      : 0;
    const centerX = start.x + deltaX * position;
    const centerY = start.y + deltaY * position;
    const radius = start.radius + (end.radius - start.radius) * position;
    nearest = Math.min(nearest, Math.hypot(x - centerX, y - centerY) - radius);
  }
  return nearest;
}

function compositePremultiplied(
  pixels: Uint8Array,
  pixelIndex: number,
  red: number,
  green: number,
  blue: number,
  alpha: number,
): void {
  const offset = pixelIndex * 4;
  const sourceAlpha = clamp(alpha, 0, 1);
  const destinationAlpha = pixels[offset + 3] / 255;
  const inverse = 1 - sourceAlpha;
  pixels[offset] = Math.round(clamp(
    red * sourceAlpha + (pixels[offset] / 255) * inverse,
    0,
    1,
  ) * 255);
  pixels[offset + 1] = Math.round(clamp(
    green * sourceAlpha + (pixels[offset + 1] / 255) * inverse,
    0,
    1,
  ) * 255);
  pixels[offset + 2] = Math.round(clamp(
    blue * sourceAlpha + (pixels[offset + 2] / 255) * inverse,
    0,
    1,
  ) * 255);
  pixels[offset + 3] = Math.round(
    clamp(sourceAlpha + destinationAlpha * inverse, 0, 1) * 255,
  );
}

/** Deterministic premultiplied fixture with a bold brush mark and circle. */
export function createBlurQualityPerformanceFixture(size: number): Uint8Array {
  if (!Number.isInteger(size) || size <= 0) {
    throw new RangeError("Blur fixture size must be a positive integer.");
  }
  const pixels = new Uint8Array(size * size * 4);
  const circleX = size * 0.68;
  const circleY = size * 0.32;
  const circleRadius = size * 0.145;
  const circleOutlineWidth = Math.max(1.5, size * 0.018);
  const brushPoints: readonly BrushFixturePoint[] = [
    { x: size * 0.09, y: size * 0.72, radius: size * 0.042 },
    { x: size * 0.22, y: size * 0.59, radius: size * 0.052 },
    { x: size * 0.38, y: size * 0.61, radius: size * 0.061 },
    { x: size * 0.52, y: size * 0.76, radius: size * 0.066 },
    { x: size * 0.69, y: size * 0.78, radius: size * 0.052 },
    { x: size * 0.88, y: size * 0.64, radius: size * 0.026 },
  ];
  const highlightPoints: readonly BrushFixturePoint[] = brushPoints.map((point) => ({
    x: point.x,
    y: point.y - size * 0.012,
    radius: point.radius * 0.24,
  }));
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const pixelIndex = y * size + x;
      const px = x + 0.5;
      const py = y + 0.5;

      const distanceFromCircle = Math.hypot(px - circleX, py - circleY);
      const circleCoverage = coverage(distanceFromCircle - circleRadius);
      if (circleCoverage > 0) {
        const light = clamp(
          1 - Math.hypot(
            px - (circleX - circleRadius * 0.32),
            py - (circleY - circleRadius * 0.38),
          ) / (circleRadius * 1.45),
          0,
          1,
        );
        compositePremultiplied(
          pixels,
          pixelIndex,
          0.94 + light * 0.06,
          0.13 + light * 0.24,
          0.055 + light * 0.08,
          circleCoverage * 0.98,
        );
      }

      const outlineCoverage = coverage(
        Math.abs(distanceFromCircle - circleRadius) - circleOutlineWidth * 0.5,
      );
      if (outlineCoverage > 0) {
        compositePremultiplied(
          pixels,
          pixelIndex,
          0.055,
          0.075,
          0.13,
          outlineCoverage * 0.99,
        );
      }

      const strokeCoverage = coverage(
        variableStrokeDistance(px, py, brushPoints),
      );
      if (strokeCoverage > 0) {
        compositePremultiplied(
          pixels,
          pixelIndex,
          0.025,
          0.075,
          0.19,
          strokeCoverage * 0.99,
        );
      }

      const highlightCoverage = coverage(
        variableStrokeDistance(px, py, highlightPoints),
      );
      if (highlightCoverage > 0) {
        compositePremultiplied(
          pixels,
          pixelIndex,
          0.24,
          0.78,
          1,
          highlightCoverage * 0.82,
        );
      }
    }
  }
  return pixels;
}

export function blurFixtureHash(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32-${hash.toString(16).padStart(8, "0")}`;
}

export function serializeBlurQualityPerformanceReport(report: unknown): string {
  return JSON.stringify(report, null, 2);
}

/**
 * Produces a bounded workload that is repeatable across desktop and mobile.
 * Texture size is aligned to 64 pixels so RGBA8 upload rows are also aligned.
 */
export function createBlurQualityPerformanceConfig(
  values: {
    readonly size?: string | number | null;
    readonly runs?: string | number | null;
    readonly warmupRuns?: string | number | null;
  } = {},
): BlurQualityPerformanceConfig {
  const requestedSize = clamp(finiteInteger(values.size, 256), 128, 512);
  const size = Math.round(requestedSize / 64) * 64;
  return Object.freeze({
    size,
    runs: clamp(finiteInteger(values.runs, 3), 1, 10),
    warmupRuns: clamp(finiteInteger(values.warmupRuns, 1), 0, 3),
    radii: BLUR_QUALITY_PERFORMANCE_RADII,
  });
}

export function blurQualityPerformanceConfigFromSearch(
  search: URLSearchParams,
): BlurQualityPerformanceConfig {
  return createBlurQualityPerformanceConfig({
    size: search.get("size"),
    runs: search.get("runs"),
    warmupRuns: search.get("warmup"),
  });
}

function percentile(sortedValues: readonly number[], quantile: number): number {
  if (sortedValues.length === 0) return 0;
  const position = (sortedValues.length - 1) * clamp(quantile, 0, 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sortedValues[lower];
  const mix = position - lower;
  return sortedValues[lower] * (1 - mix) + sortedValues[upper] * mix;
}

export function summarizeBlurTimings(
  samplesMs: readonly number[],
): BlurTimingSummary {
  const samples = samplesMs
    .filter((value) => Number.isFinite(value) && value >= 0)
    .map((value) => Number(value));
  const sorted = [...samples].sort((left, right) => left - right);
  return Object.freeze({
    samplesMs: Object.freeze(samples),
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    minimumMs: sorted[0] ?? 0,
    maximumMs: sorted.at(-1) ?? 0,
  });
}

export function computeBlurQualityMetrics(
  baseline: Uint8Array,
  optimized: Uint8Array,
): BlurQualityMetrics {
  if (baseline.byteLength !== optimized.byteLength || baseline.byteLength % 4 !== 0) {
    throw new RangeError("Blur comparison payloads must have matching RGBA dimensions.");
  }
  const channelCount = baseline.byteLength;
  if (channelCount === 0) {
    throw new RangeError("Blur comparison payloads must not be empty.");
  }

  let absoluteError = 0;
  let squaredError = 0;
  let maximumAbsoluteError = 0;
  let alphaAbsoluteError = 0;
  let baselineAlphaEnergy = 0;
  let optimizedAlphaEnergy = 0;
  for (let index = 0; index < channelCount; index += 1) {
    const delta = Math.abs(optimized[index] - baseline[index]) / 255;
    absoluteError += delta;
    squaredError += delta * delta;
    maximumAbsoluteError = Math.max(maximumAbsoluteError, delta);
    if (index % 4 === 3) {
      alphaAbsoluteError += delta;
      baselineAlphaEnergy += baseline[index] / 255;
      optimizedAlphaEnergy += optimized[index] / 255;
    }
  }
  const pixelCount = channelCount / 4;
  const rootMeanSquareError = Math.sqrt(squaredError / channelCount);
  return Object.freeze({
    meanAbsoluteError: absoluteError / channelCount,
    rootMeanSquareError,
    peakSignalToNoiseRatioDb: rootMeanSquareError > 0
      ? 20 * Math.log10(1 / rootMeanSquareError)
      : null,
    maximumAbsoluteError,
    alphaMeanAbsoluteError: alphaAbsoluteError / pixelCount,
    alphaEnergyRatio: baselineAlphaEnergy > 0
      ? optimizedAlphaEnergy / baselineAlphaEnergy
      : 1,
  });
}

export function blurCaseSpeedup(
  baselineMedianMs: number,
  optimizedMedianMs: number,
): number {
  return optimizedMedianMs > 0 ? baselineMedianMs / optimizedMedianMs : 0;
}

export function blurQualityGuardrail(metrics: BlurQualityMetrics): boolean {
  const psnr = metrics.peakSignalToNoiseRatioDb ?? Number.POSITIVE_INFINITY;
  return psnr >= 20
    && metrics.alphaEnergyRatio >= 0.85
    && metrics.alphaEnergyRatio <= 1.15;
}

export function createBlurQualityPerformanceChecks(
  cases: readonly BlurQualityPerformanceCaseReport[],
  expectedRadii: readonly number[] = BLUR_QUALITY_PERFORMANCE_RADII,
): Readonly<Record<string, boolean>> {
  const completeRadii = cases.length === expectedRadii.length
    && expectedRadii.every((radius, index) => cases[index]?.radius === radius);
  const finiteTiming = cases.every((entry) => [
    entry.baseline.medianMs,
    entry.baseline.p95Ms,
    entry.optimized.medianMs,
    entry.optimized.p95Ms,
    entry.speedup,
  ].every((value) => Number.isFinite(value) && value >= 0));
  const finiteQuality = cases.every((entry) => [
    entry.quality.meanAbsoluteError,
    entry.quality.rootMeanSquareError,
    entry.quality.maximumAbsoluteError,
    entry.quality.alphaMeanAbsoluteError,
    entry.quality.alphaEnergyRatio,
  ].every(Number.isFinite));
  return Object.freeze({
    allScenariosCompleted: completeRadii,
    timingsAreFinite: finiteTiming,
    qualityMetricsAreFinite: finiteQuality,
    outputsRetainAlphaEnergy: cases.every((entry) => (
      entry.quality.alphaEnergyRatio >= 0.85
      && entry.quality.alphaEnergyRatio <= 1.15
    )),
  });
}
