/** Deterministic Hue, Saturation and Brightness adjustment math. */

import {
  encodedRgbToLinearRgb,
  linearRgbToEncodedRgb,
} from "./raster-tone-curves-core.ts";

export const RASTER_COLOR_ADJUST_MIN_HUE_DEGREES = -180;
export const RASTER_COLOR_ADJUST_MAX_HUE_DEGREES = 180;
export const RASTER_COLOR_ADJUST_MIN_PERCENT = -100;
export const RASTER_COLOR_ADJUST_MAX_PERCENT = 100;

export interface RasterColorAdjustSettings {
  readonly hueDegrees: number;
  readonly saturationPercent: number;
  readonly brightnessPercent: number;
}

export const DEFAULT_RASTER_COLOR_ADJUST_SETTINGS: RasterColorAdjustSettings =
  Object.freeze({
    hueDegrees: 0,
    saturationPercent: 0,
    brightnessPercent: 0,
  });

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

export function normalizeRasterColorAdjustSettings(
  input: Partial<RasterColorAdjustSettings>,
  fallback: Readonly<RasterColorAdjustSettings> = DEFAULT_RASTER_COLOR_ADJUST_SETTINGS,
): RasterColorAdjustSettings {
  return Object.freeze({
    hueDegrees: clamp(
      finiteOr(input.hueDegrees, fallback.hueDegrees),
      RASTER_COLOR_ADJUST_MIN_HUE_DEGREES,
      RASTER_COLOR_ADJUST_MAX_HUE_DEGREES,
    ),
    saturationPercent: clamp(
      finiteOr(input.saturationPercent, fallback.saturationPercent),
      RASTER_COLOR_ADJUST_MIN_PERCENT,
      RASTER_COLOR_ADJUST_MAX_PERCENT,
    ),
    brightnessPercent: clamp(
      finiteOr(input.brightnessPercent, fallback.brightnessPercent),
      RASTER_COLOR_ADJUST_MIN_PERCENT,
      RASTER_COLOR_ADJUST_MAX_PERCENT,
    ),
  });
}

export function isRasterColorAdjustIdentity(
  settings: Readonly<RasterColorAdjustSettings>,
): boolean {
  return settings.hueDegrees === 0
    && settings.saturationPercent === 0
    && settings.brightnessPercent === 0;
}

export function rasterColorAdjustSettingsEqual(
  left: Readonly<RasterColorAdjustSettings>,
  right: Readonly<RasterColorAdjustSettings>,
): boolean {
  return left.hueDegrees === right.hueDegrees
    && left.saturationPercent === right.saturationPercent
    && left.brightnessPercent === right.brightnessPercent;
}

interface HsvColor {
  readonly hue: number;
  readonly saturation: number;
  readonly brightness: number;
}

function encodedRgbToHsv(red: number, green: number, blue: number): HsvColor {
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  let hue = 0;
  if (delta > 1e-7) {
    if (maximum === red) hue = (green - blue) / delta;
    else if (maximum === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue = ((hue / 6) % 1 + 1) % 1;
  }
  return {
    hue,
    saturation: maximum <= 1e-7 ? 0 : delta / maximum,
    brightness: maximum,
  };
}

function hsvToEncodedRgb(color: HsvColor): readonly [number, number, number] {
  const hue = ((color.hue % 1) + 1) % 1;
  const saturation = clamp(color.saturation, 0, 1);
  const brightness = clamp(color.brightness, 0, 1);
  const chroma = brightness * saturation;
  const sector = hue * 6;
  const intermediate = chroma * (1 - Math.abs((sector % 2) - 1));
  let red = 0;
  let green = 0;
  let blue = 0;
  if (sector < 1) [red, green] = [chroma, intermediate];
  else if (sector < 2) [red, green] = [intermediate, chroma];
  else if (sector < 3) [green, blue] = [chroma, intermediate];
  else if (sector < 4) [green, blue] = [intermediate, chroma];
  else if (sector < 5) [red, blue] = [intermediate, chroma];
  else [red, blue] = [chroma, intermediate];
  const match = brightness - chroma;
  return [red + match, green + match, blue + match];
}

function adjustUnitComponent(value: number, signedAmount: number): number {
  const amount = clamp(signedAmount, -1, 1);
  return amount < 0
    ? value * (1 + amount)
    : value + (1 - value) * amount;
}

/**
 * CPU oracle for the WebGPU kernel. Input and output are premultiplied linear
 * RGBA. The color controls operate on straight encoded RGB and preserve alpha.
 */
export function applyRasterColorAdjustToPremultipliedLinearRgba(
  rgba: readonly [number, number, number, number],
  input: Readonly<RasterColorAdjustSettings>,
): readonly [number, number, number, number] {
  const settings = normalizeRasterColorAdjustSettings(input);
  const alpha = clamp(Number.isFinite(rgba[3]) ? rgba[3] : 0, 0, 1);
  if (alpha <= 1e-7) return [0, 0, 0, alpha];
  const encoded = [0, 1, 2].map((channel) => {
    const premultiplied = Number.isFinite(rgba[channel]) ? rgba[channel] : 0;
    return linearRgbToEncodedRgb(clamp(premultiplied / alpha, 0, 1));
  });
  const hsv = encodedRgbToHsv(encoded[0], encoded[1], encoded[2]);
  const adjusted = hsvToEncodedRgb({
    hue: hsv.hue + settings.hueDegrees / 360,
    saturation: adjustUnitComponent(
      hsv.saturation,
      settings.saturationPercent / 100,
    ),
    brightness: adjustUnitComponent(
      hsv.brightness,
      settings.brightnessPercent / 100,
    ),
  });
  return [
    encodedRgbToLinearRgb(adjusted[0]) * alpha,
    encodedRgbToLinearRgb(adjusted[1]) * alpha,
    encodedRgbToLinearRgb(adjusted[2]) * alpha,
    alpha,
  ];
}
