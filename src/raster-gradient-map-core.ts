/** Deterministic color-ramp mapping for destructive raster adjustment. */

import {
  encodedRgbToLinearRgb,
  linearRgbToEncodedRgb,
} from "./raster-tone-curves-core.ts";

export const RASTER_GRADIENT_MAP_MIN_STOPS = 2;
export const RASTER_GRADIENT_MAP_MAX_STOPS = 12;
export const RASTER_GRADIENT_MAP_LUT_SIZE = 1024;
export const RASTER_GRADIENT_MAP_LUT_COMPONENTS = 4;

export type RasterGradientMapInterpolation =
  | "perceptual"
  | "linear-light"
  | "encoded-rgb";

export interface RasterGradientMapStop {
  readonly position: number;
  readonly color: readonly [number, number, number];
}

export interface RasterGradientMapSettings {
  readonly stops: readonly RasterGradientMapStop[];
  readonly reverse: boolean;
  readonly dither: boolean;
  readonly interpolation: RasterGradientMapInterpolation;
}

export interface RasterGradientMapSettingsInput {
  readonly stops?: readonly RasterGradientMapStop[];
  readonly reverse?: boolean;
  readonly dither?: boolean;
  readonly interpolation?: RasterGradientMapInterpolation;
}

const BLACK_STOP: RasterGradientMapStop = Object.freeze({
  position: 0,
  color: Object.freeze([0, 0, 0]) as readonly [number, number, number],
});
const WHITE_STOP: RasterGradientMapStop = Object.freeze({
  position: 1,
  color: Object.freeze([1, 1, 1]) as readonly [number, number, number],
});
const DEFAULT_STOPS: readonly RasterGradientMapStop[] = Object.freeze([
  BLACK_STOP,
  WHITE_STOP,
]);

export const DEFAULT_RASTER_GRADIENT_MAP_SETTINGS: RasterGradientMapSettings =
  Object.freeze({
    stops: DEFAULT_STOPS,
    reverse: false,
    dither: true,
    interpolation: "perceptual",
  });

const LUMINANCE_RED = 0.2126;
const LUMINANCE_GREEN = 0.7152;
const LUMINANCE_BLUE = 0.0722;
const ALPHA_EPSILON = 1e-7;
const DITHER_RANGE = 1 / 255;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function isInterpolation(
  value: RasterGradientMapInterpolation | undefined,
): value is RasterGradientMapInterpolation {
  return value === "perceptual"
    || value === "linear-light"
    || value === "encoded-rgb";
}

function normalizeStop(
  stop: RasterGradientMapStop,
  fallback: RasterGradientMapStop,
): RasterGradientMapStop {
  const color = Object.freeze([
    clamp(finiteOr(stop?.color?.[0], fallback.color[0]), 0, 1),
    clamp(finiteOr(stop?.color?.[1], fallback.color[1]), 0, 1),
    clamp(finiteOr(stop?.color?.[2], fallback.color[2]), 0, 1),
  ]) as readonly [number, number, number];
  return Object.freeze({
    position: clamp(finiteOr(stop?.position, fallback.position), 0, 1),
    color,
  });
}

function validFallbackStops(
  fallback: Readonly<RasterGradientMapSettings>,
): readonly RasterGradientMapStop[] {
  return fallback.stops.length >= RASTER_GRADIENT_MAP_MIN_STOPS
    ? fallback.stops
    : DEFAULT_STOPS;
}

/**
 * Clamps, copies, freezes and stably sorts the stop list. Coincident stops are
 * retained so the editor can represent a hard color boundary.
 */
export function normalizeRasterGradientMapSettings(
  input: RasterGradientMapSettingsInput,
  fallback: Readonly<RasterGradientMapSettings> = DEFAULT_RASTER_GRADIENT_MAP_SETTINGS,
): RasterGradientMapSettings {
  const fallbackStops = validFallbackStops(fallback);
  const requestedStops = input.stops && input.stops.length >= RASTER_GRADIENT_MAP_MIN_STOPS
    ? input.stops
    : fallbackStops;
  const indexed = requestedStops
    .slice(0, RASTER_GRADIENT_MAP_MAX_STOPS)
    .map((stop, index) => ({
      index,
      stop: normalizeStop(
        stop,
        fallbackStops[Math.min(index, fallbackStops.length - 1)] ?? WHITE_STOP,
      ),
    }));
  indexed.sort((left, right) => (
    left.stop.position - right.stop.position || left.index - right.index
  ));
  const stops = Object.freeze(indexed.map(({ stop }) => stop));
  return Object.freeze({
    stops,
    reverse: input.reverse ?? fallback.reverse,
    dither: input.dither ?? fallback.dither,
    interpolation: isInterpolation(input.interpolation)
      ? input.interpolation
      : fallback.interpolation,
  });
}

export function rasterGradientMapSettingsEqual(
  left: Readonly<RasterGradientMapSettings>,
  right: Readonly<RasterGradientMapSettings>,
): boolean {
  if (
    left.reverse !== right.reverse
    || left.dither !== right.dither
    || left.interpolation !== right.interpolation
    || left.stops.length !== right.stops.length
  ) return false;
  return left.stops.every((stop, index) => {
    const other = right.stops[index];
    return stop.position === other.position
      && stop.color[0] === other.color[0]
      && stop.color[1] === other.color[1]
      && stop.color[2] === other.color[2];
  });
}

type Rgb = readonly [number, number, number];

function encodedToLinear(rgb: Rgb): Rgb {
  return [
    encodedRgbToLinearRgb(rgb[0]),
    encodedRgbToLinearRgb(rgb[1]),
    encodedRgbToLinearRgb(rgb[2]),
  ];
}

function linearToEncoded(rgb: Rgb): Rgb {
  return [
    linearRgbToEncodedRgb(clamp(rgb[0], 0, 1)),
    linearRgbToEncodedRgb(clamp(rgb[1], 0, 1)),
    linearRgbToEncodedRgb(clamp(rgb[2], 0, 1)),
  ];
}

function linearRgbToOklab(rgb: Rgb): Rgb {
  const l = Math.cbrt(
    0.4122214708 * rgb[0] + 0.5363325363 * rgb[1] + 0.0514459929 * rgb[2],
  );
  const m = Math.cbrt(
    0.2119034982 * rgb[0] + 0.6806995451 * rgb[1] + 0.1073969566 * rgb[2],
  );
  const s = Math.cbrt(
    0.0883024619 * rgb[0] + 0.2817188376 * rgb[1] + 0.6299787005 * rgb[2],
  );
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinearRgb(lab: Rgb): Rgb {
  const l = Math.pow(lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2], 3);
  const m = Math.pow(lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2], 3);
  const s = Math.pow(lab[0] - 0.0894841775 * lab[1] - 1.291485548 * lab[2], 3);
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function mixRgb(left: Rgb, right: Rgb, amount: number): Rgb {
  const t = clamp(amount, 0, 1);
  return [
    left[0] + (right[0] - left[0]) * t,
    left[1] + (right[1] - left[1]) * t,
    left[2] + (right[2] - left[2]) * t,
  ];
}

function interpolateStopColors(
  left: Rgb,
  right: Rgb,
  amount: number,
  interpolation: RasterGradientMapInterpolation,
): Rgb {
  if (interpolation === "encoded-rgb") return mixRgb(left, right, amount);
  const leftLinear = encodedToLinear(left);
  const rightLinear = encodedToLinear(right);
  if (interpolation === "linear-light") {
    return linearToEncoded(mixRgb(leftLinear, rightLinear, amount));
  }
  const mixedLab = mixRgb(
    linearRgbToOklab(leftLinear),
    linearRgbToOklab(rightLinear),
    amount,
  );
  return linearToEncoded(oklabToLinearRgb(mixedLab));
}

/** Samples a normalized stop list with right-continuous hard boundaries. */
export function sampleRasterGradientMapStops(
  stops: readonly RasterGradientMapStop[],
  position: number,
  interpolation: RasterGradientMapInterpolation,
): Rgb {
  const safeStops = stops.length >= RASTER_GRADIENT_MAP_MIN_STOPS
    ? stops
    : DEFAULT_STOPS;
  const t = clamp(Number.isFinite(position) ? position : 0, 0, 1);
  let leftIndex = -1;
  for (let index = 0; index < safeStops.length; index += 1) {
    if (safeStops[index].position <= t) leftIndex = index;
    else break;
  }
  if (leftIndex < 0) return safeStops[0].color;
  if (leftIndex >= safeStops.length - 1) return safeStops[safeStops.length - 1].color;
  const left = safeStops[leftIndex];
  let rightIndex = leftIndex + 1;
  while (
    rightIndex < safeStops.length - 1
    && safeStops[rightIndex].position <= left.position
  ) rightIndex += 1;
  const right = safeStops[rightIndex];
  const width = right.position - left.position;
  if (width <= 0) return right.color;
  return interpolateStopColors(
    left.color,
    right.color,
    (t - left.position) / width,
    interpolation,
  );
}

/** Builds the aligned RGBA LUT uploaded to the WebGPU storage buffer. */
export function generateRasterGradientMapLut(
  input: Readonly<RasterGradientMapSettings>,
): Float32Array {
  const settings = normalizeRasterGradientMapSettings(input);
  const lut = new Float32Array(
    RASTER_GRADIENT_MAP_LUT_SIZE * RASTER_GRADIENT_MAP_LUT_COMPONENTS,
  );
  for (let index = 0; index < RASTER_GRADIENT_MAP_LUT_SIZE; index += 1) {
    const position = index / (RASTER_GRADIENT_MAP_LUT_SIZE - 1);
    const color = sampleRasterGradientMapStops(
      settings.stops,
      settings.reverse ? 1 - position : position,
      settings.interpolation,
    );
    const offset = index * RASTER_GRADIENT_MAP_LUT_COMPONENTS;
    lut[offset] = color[0];
    lut[offset + 1] = color[1];
    lut[offset + 2] = color[2];
    lut[offset + 3] = 1;
  }
  return lut;
}

/** Deterministic document-space noise shared with the compute kernel. */
export function rasterGradientMapDitherOffset(x: number, y: number): number {
  let value = (
    Math.imul(Math.max(0, Math.floor(finiteOr(x, 0))) >>> 0, 0x9e3779b9)
    ^ Math.imul(Math.max(0, Math.floor(finiteOr(y, 0))) >>> 0, 0x85ebca6b)
    ^ 0xc2b2ae35
  ) >>> 0;
  value = (value ^ (value >>> 16)) >>> 0;
  value = Math.imul(value, 0x7feb352d) >>> 0;
  value = (value ^ (value >>> 15)) >>> 0;
  value = Math.imul(value, 0x846ca68b) >>> 0;
  value = (value ^ (value >>> 16)) >>> 0;
  return (((value & 0xffff) / 65535) - 0.5) * DITHER_RANGE;
}

export function sampleRasterGradientMapLut(
  lut: Float32Array,
  position: number,
): Rgb {
  if (lut.length !== RASTER_GRADIENT_MAP_LUT_SIZE * RASTER_GRADIENT_MAP_LUT_COMPONENTS) {
    throw new Error("Gradient Map LUT has an invalid length.");
  }
  const coordinate = clamp(Number.isFinite(position) ? position : 0, 0, 1)
    * (RASTER_GRADIENT_MAP_LUT_SIZE - 1);
  const leftIndex = Math.floor(coordinate);
  const rightIndex = Math.min(leftIndex + 1, RASTER_GRADIENT_MAP_LUT_SIZE - 1);
  const amount = coordinate - leftIndex;
  const leftOffset = leftIndex * RASTER_GRADIENT_MAP_LUT_COMPONENTS;
  const rightOffset = rightIndex * RASTER_GRADIENT_MAP_LUT_COMPONENTS;
  return [
    lut[leftOffset] + (lut[rightOffset] - lut[leftOffset]) * amount,
    lut[leftOffset + 1] + (lut[rightOffset + 1] - lut[leftOffset + 1]) * amount,
    lut[leftOffset + 2] + (lut[rightOffset + 2] - lut[leftOffset + 2]) * amount,
  ];
}

/**
 * CPU oracle for the WebGPU kernel. Input and output use premultiplied linear
 * RGBA; colors in the stop list and LUT use straight encoded RGB.
 */
export function applyRasterGradientMapToPremultipliedLinearRgba(
  rgba: readonly [number, number, number, number],
  input: Readonly<RasterGradientMapSettings>,
  documentX = 0,
  documentY = 0,
  preparedLut?: Float32Array,
): readonly [number, number, number, number] {
  const settings = normalizeRasterGradientMapSettings(input);
  const alpha = clamp(Number.isFinite(rgba[3]) ? rgba[3] : 0, 0, 1);
  if (alpha <= ALPHA_EPSILON) return [0, 0, 0, alpha];
  const encoded: Rgb = [0, 1, 2].map((channel) => {
    const premultiplied = Number.isFinite(rgba[channel]) ? rgba[channel] : 0;
    return linearRgbToEncodedRgb(clamp(premultiplied / alpha, 0, 1));
  }) as [number, number, number];
  let position = encoded[0] * LUMINANCE_RED
    + encoded[1] * LUMINANCE_GREEN
    + encoded[2] * LUMINANCE_BLUE;
  if (settings.dither) {
    position += rasterGradientMapDitherOffset(documentX, documentY);
  }
  const mapped = sampleRasterGradientMapLut(
    preparedLut ?? generateRasterGradientMapLut(settings),
    position,
  );
  return [
    encodedRgbToLinearRgb(mapped[0]) * alpha,
    encodedRgbToLinearRgb(mapped[1]) * alpha,
    encodedRgbToLinearRgb(mapped[2]) * alpha,
    alpha,
  ];
}
