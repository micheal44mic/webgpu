/** Deterministic tonal color-balance math for destructive raster adjustment. */

import {
  encodedRgbToLinearRgb,
  linearRgbToEncodedRgb,
} from "./raster-tone-curves-core.ts";

export const RASTER_COLOR_BALANCE_MIN_PERCENT = -100;
export const RASTER_COLOR_BALANCE_MAX_PERCENT = 100;

export const RASTER_COLOR_BALANCE_TONES = [
  "shadows",
  "midtones",
  "highlights",
] as const;

export type RasterColorBalanceTone = (typeof RASTER_COLOR_BALANCE_TONES)[number];

export interface RasterColorBalanceToneAdjustment {
  readonly cyanRedPercent: number;
  readonly magentaGreenPercent: number;
  readonly yellowBluePercent: number;
}

export interface RasterColorBalanceSettings {
  readonly shadows: Readonly<RasterColorBalanceToneAdjustment>;
  readonly midtones: Readonly<RasterColorBalanceToneAdjustment>;
  readonly highlights: Readonly<RasterColorBalanceToneAdjustment>;
  readonly preserveLuminosity: boolean;
}

export interface RasterColorBalanceSettingsInput {
  readonly shadows?: Partial<RasterColorBalanceToneAdjustment>;
  readonly midtones?: Partial<RasterColorBalanceToneAdjustment>;
  readonly highlights?: Partial<RasterColorBalanceToneAdjustment>;
  readonly preserveLuminosity?: boolean;
}

export const DEFAULT_RASTER_COLOR_BALANCE_TONE_ADJUSTMENT:
Readonly<RasterColorBalanceToneAdjustment> = Object.freeze({
  cyanRedPercent: 0,
  magentaGreenPercent: 0,
  yellowBluePercent: 0,
});

export const DEFAULT_RASTER_COLOR_BALANCE_SETTINGS: RasterColorBalanceSettings =
  Object.freeze({
    shadows: DEFAULT_RASTER_COLOR_BALANCE_TONE_ADJUSTMENT,
    midtones: DEFAULT_RASTER_COLOR_BALANCE_TONE_ADJUSTMENT,
    highlights: DEFAULT_RASTER_COLOR_BALANCE_TONE_ADJUSTMENT,
    preserveLuminosity: true,
  });

const LUMINANCE_RED = 0.2126;
const LUMINANCE_GREEN = 0.7152;
const LUMINANCE_BLUE = 0.0722;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function normalizeToneAdjustment(
  input: Partial<RasterColorBalanceToneAdjustment> | undefined,
  fallback: Readonly<RasterColorBalanceToneAdjustment>,
): Readonly<RasterColorBalanceToneAdjustment> {
  return Object.freeze({
    cyanRedPercent: clamp(
      finiteOr(input?.cyanRedPercent, fallback.cyanRedPercent),
      RASTER_COLOR_BALANCE_MIN_PERCENT,
      RASTER_COLOR_BALANCE_MAX_PERCENT,
    ),
    magentaGreenPercent: clamp(
      finiteOr(input?.magentaGreenPercent, fallback.magentaGreenPercent),
      RASTER_COLOR_BALANCE_MIN_PERCENT,
      RASTER_COLOR_BALANCE_MAX_PERCENT,
    ),
    yellowBluePercent: clamp(
      finiteOr(input?.yellowBluePercent, fallback.yellowBluePercent),
      RASTER_COLOR_BALANCE_MIN_PERCENT,
      RASTER_COLOR_BALANCE_MAX_PERCENT,
    ),
  });
}

export function normalizeRasterColorBalanceSettings(
  input: RasterColorBalanceSettingsInput,
  fallback: Readonly<RasterColorBalanceSettings> = DEFAULT_RASTER_COLOR_BALANCE_SETTINGS,
): RasterColorBalanceSettings {
  return Object.freeze({
    shadows: normalizeToneAdjustment(input.shadows, fallback.shadows),
    midtones: normalizeToneAdjustment(input.midtones, fallback.midtones),
    highlights: normalizeToneAdjustment(input.highlights, fallback.highlights),
    preserveLuminosity: input.preserveLuminosity ?? fallback.preserveLuminosity,
  });
}

function toneAdjustmentIsIdentity(
  adjustment: Readonly<RasterColorBalanceToneAdjustment>,
): boolean {
  return adjustment.cyanRedPercent === 0
    && adjustment.magentaGreenPercent === 0
    && adjustment.yellowBluePercent === 0;
}

export function isRasterColorBalanceIdentity(
  settings: Readonly<RasterColorBalanceSettings>,
): boolean {
  return toneAdjustmentIsIdentity(settings.shadows)
    && toneAdjustmentIsIdentity(settings.midtones)
    && toneAdjustmentIsIdentity(settings.highlights);
}

function toneAdjustmentEqual(
  left: Readonly<RasterColorBalanceToneAdjustment>,
  right: Readonly<RasterColorBalanceToneAdjustment>,
): boolean {
  return left.cyanRedPercent === right.cyanRedPercent
    && left.magentaGreenPercent === right.magentaGreenPercent
    && left.yellowBluePercent === right.yellowBluePercent;
}

export function rasterColorBalanceSettingsEqual(
  left: Readonly<RasterColorBalanceSettings>,
  right: Readonly<RasterColorBalanceSettings>,
): boolean {
  return toneAdjustmentEqual(left.shadows, right.shadows)
    && toneAdjustmentEqual(left.midtones, right.midtones)
    && toneAdjustmentEqual(left.highlights, right.highlights)
    && left.preserveLuminosity === right.preserveLuminosity;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Partition-of-unity weights driven by the immutable source luminance. */
export function rasterColorBalanceToneWeights(
  encodedLuminance: number,
): readonly [number, number, number] {
  const luminance = clamp(
    Number.isFinite(encodedLuminance) ? encodedLuminance : 0,
    0,
    1,
  );
  if (luminance <= 0.5) {
    const midtones = smoothstep(0, 0.5, luminance);
    return [1 - midtones, midtones, 0];
  }
  const highlights = smoothstep(0.5, 1, luminance);
  return [0, 1 - highlights, highlights];
}

function encodedLuminance(rgb: readonly [number, number, number]): number {
  return rgb[0] * LUMINANCE_RED
    + rgb[1] * LUMINANCE_GREEN
    + rgb[2] * LUMINANCE_BLUE;
}

function adjustUnitComponent(value: number, signedAmount: number): number {
  const amount = clamp(signedAmount, -1, 1);
  return amount < 0
    ? value * (1 + amount)
    : value + (1 - value) * amount;
}

function matchEncodedLuminance(
  rgb: readonly [number, number, number],
  targetLuminance: number,
): readonly [number, number, number] {
  const delta = targetLuminance - encodedLuminance(rgb);
  let result: [number, number, number] = [
    rgb[0] + delta,
    rgb[1] + delta,
    rgb[2] + delta,
  ];
  const luminance = encodedLuminance(result);
  const minimum = Math.min(result[0], result[1], result[2]);
  const maximum = Math.max(result[0], result[1], result[2]);
  if (minimum < 0) {
    const denominator = luminance - minimum;
    result = denominator > 1e-7
      ? result.map((channel) => (
        luminance + (channel - luminance) * luminance / denominator
      )) as [number, number, number]
      : [0, 0, 0];
  }
  if (maximum > 1) {
    const denominator = maximum - luminance;
    result = denominator > 1e-7
      ? result.map((channel) => (
        luminance + (channel - luminance) * (1 - luminance) / denominator
      )) as [number, number, number]
      : [1, 1, 1];
  }
  return [clamp(result[0], 0, 1), clamp(result[1], 0, 1), clamp(result[2], 0, 1)];
}

function weightedAdjustment(
  settings: Readonly<RasterColorBalanceSettings>,
  weights: readonly [number, number, number],
  key: keyof RasterColorBalanceToneAdjustment,
): number {
  return (
    settings.shadows[key] * weights[0]
    + settings.midtones[key] * weights[1]
    + settings.highlights[key] * weights[2]
  ) / 100;
}

/**
 * CPU oracle for the WebGPU kernel. Input and output are premultiplied linear
 * RGBA. Tonal weights and channel adjustments operate on straight encoded RGB.
 */
export function applyRasterColorBalanceToPremultipliedLinearRgba(
  rgba: readonly [number, number, number, number],
  input: Readonly<RasterColorBalanceSettings>,
): readonly [number, number, number, number] {
  const settings = normalizeRasterColorBalanceSettings(input);
  const alpha = clamp(Number.isFinite(rgba[3]) ? rgba[3] : 0, 0, 1);
  if (alpha <= 1e-7) return [0, 0, 0, alpha];
  const encoded: [number, number, number] = [0, 1, 2].map((channel) => {
    const premultiplied = Number.isFinite(rgba[channel]) ? rgba[channel] : 0;
    return linearRgbToEncodedRgb(clamp(premultiplied / alpha, 0, 1));
  }) as [number, number, number];
  const sourceLuminance = encodedLuminance(encoded);
  const weights = rasterColorBalanceToneWeights(sourceLuminance);
  let adjusted: readonly [number, number, number] = [
    adjustUnitComponent(
      encoded[0],
      weightedAdjustment(settings, weights, "cyanRedPercent"),
    ),
    adjustUnitComponent(
      encoded[1],
      weightedAdjustment(settings, weights, "magentaGreenPercent"),
    ),
    adjustUnitComponent(
      encoded[2],
      weightedAdjustment(settings, weights, "yellowBluePercent"),
    ),
  ];
  if (settings.preserveLuminosity) {
    adjusted = matchEncodedLuminance(adjusted, sourceLuminance);
  }
  return [
    encodedRgbToLinearRgb(adjusted[0]) * alpha,
    encodedRgbToLinearRgb(adjusted[1]) * alpha,
    encodedRgbToLinearRgb(adjusted[2]) * alpha,
    alpha,
  ];
}
