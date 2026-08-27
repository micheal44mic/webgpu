/** Pure model, interpolation, LUT and color math for destructive raster curves. */

export const RASTER_TONE_CURVES_CORE_BUILD =
  "raster-tone-curves-core-v1-shape-preserving-rgb-lut" as const;

export const RASTER_TONE_CURVE_LUT_SIZE = 256;
export const RASTER_TONE_CURVE_MAX_POINTS = 16;
export const RASTER_TONE_CURVE_LUT_BYTE_SIZE =
  RASTER_TONE_CURVE_LUT_SIZE * 4 * Float32Array.BYTES_PER_ELEMENT;
export const RASTER_TONE_HISTOGRAM_BIN_COUNT = 256;
export const RASTER_TONE_HISTOGRAM_CHANNEL_COUNT = 4;
export const RASTER_TONE_HISTOGRAM_VALUE_COUNT =
  RASTER_TONE_HISTOGRAM_BIN_COUNT * RASTER_TONE_HISTOGRAM_CHANNEL_COUNT;
export const RASTER_TONE_HISTOGRAM_BYTE_SIZE =
  RASTER_TONE_HISTOGRAM_VALUE_COUNT * Uint32Array.BYTES_PER_ELEMENT;

const CURVE_POINT_EPSILON = 1e-7;
const COLOR_EPSILON = 1e-7;

export type RasterToneCurveChannel =
  | "composite"
  | "red"
  | "green"
  | "blue";

export interface RasterToneCurvePoint {
  /** Normalized encoded input value. */
  readonly x: number;
  /** Normalized encoded output value. */
  readonly y: number;
}

export interface RasterToneCurveSet {
  readonly composite: readonly RasterToneCurvePoint[];
  readonly red: readonly RasterToneCurvePoint[];
  readonly green: readonly RasterToneCurvePoint[];
  readonly blue: readonly RasterToneCurvePoint[];
}

export interface CompiledRasterToneCurve {
  readonly points: readonly RasterToneCurvePoint[];
  readonly slopes: readonly number[];
}

export type RasterToneRgba = readonly [number, number, number, number];

const IDENTITY_CURVE: readonly RasterToneCurvePoint[] = Object.freeze([
  Object.freeze({ x: 0, y: 0 }),
  Object.freeze({ x: 1, y: 1 }),
]);

export const DEFAULT_RASTER_TONE_CURVE_SET: Readonly<RasterToneCurveSet> =
  Object.freeze({
    composite: IDENTITY_CURVE,
    red: IDENTITY_CURVE,
    green: IDENTITY_CURVE,
    blue: IDENTITY_CURVE,
  });

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function finite(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Produces a stable curve domain. Points are sorted by input, exact/near input
 * collisions keep the most recently supplied point. A complete curve keeps
 * its first and last input positions so those handles can define input
 * clipping. Empty input becomes identity; a single point receives identity
 * endpoints so every interpolation interval remains well-defined.
 */
export function normalizeRasterToneCurve(
  input: readonly Partial<RasterToneCurvePoint>[] | null | undefined,
): readonly RasterToneCurvePoint[] {
  const candidates = (input ?? []).flatMap((point, order) => {
    const x = finite(point.x);
    const y = finite(point.y);
    return x === null || y === null
      ? []
      : [{ x: clampUnit(x), y: clampUnit(y), order }];
  });
  candidates.sort((left, right) => left.x - right.x || left.order - right.order);

  const distinct: Array<{ x: number; y: number; order: number }> = [];
  for (const point of candidates) {
    const previous = distinct.at(-1);
    if (previous && point.x - previous.x <= CURVE_POINT_EPSILON) {
      if (point.order >= previous.order) distinct[distinct.length - 1] = point;
    } else {
      distinct.push(point);
    }
  }

  if (distinct.length > RASTER_TONE_CURVE_MAX_POINTS) {
    throw new RangeError(
      `A raster tone curve supports at most ${RASTER_TONE_CURVE_MAX_POINTS} points.`,
    );
  }
  if (distinct.length === 0) return IDENTITY_CURVE;
  if (distinct.length === 1) {
    const only = distinct[0];
    if (only.x > 0) distinct.unshift({ x: 0, y: 0, order: -1 });
    if (only.x < 1) {
      distinct.push({ x: 1, y: 1, order: Number.MAX_SAFE_INTEGER });
    }
  }

  return Object.freeze(distinct.map(({ x, y }) => Object.freeze({ x, y })));
}

export function normalizeRasterToneCurveSet(
  input: Partial<RasterToneCurveSet> | null | undefined,
): RasterToneCurveSet {
  return Object.freeze({
    composite: normalizeRasterToneCurve(input?.composite),
    red: normalizeRasterToneCurve(input?.red),
    green: normalizeRasterToneCurve(input?.green),
    blue: normalizeRasterToneCurve(input?.blue),
  });
}

/** True only when the full 0...1 domain maps exactly to itself. */
export function isRasterToneCurveSetIdentity(
  curvesInput: Partial<RasterToneCurveSet> | null | undefined,
): boolean {
  const curves = normalizeRasterToneCurveSet(curvesInput);
  return (["composite", "red", "green", "blue"] as const).every((channel) => {
    const points = curves[channel];
    return points[0].x === 0
      && points[0].y === 0
      && points[points.length - 1].x === 1
      && points[points.length - 1].y === 1
      && points.every((point) => point.x === point.y);
  });
}

function endpointSlope(
  firstWidth: number,
  secondWidth: number,
  firstSecant: number,
  secondSecant: number,
): number {
  let slope = (
    (2 * firstWidth + secondWidth) * firstSecant
      - firstWidth * secondSecant
  ) / (firstWidth + secondWidth);
  if (Math.sign(slope) !== Math.sign(firstSecant)) return 0;
  if (
    Math.sign(firstSecant) !== Math.sign(secondSecant)
    && Math.abs(slope) > Math.abs(3 * firstSecant)
  ) {
    slope = 3 * firstSecant;
  }
  return slope;
}

/** Compiles shape-preserving cubic slopes once for repeated LUT evaluation. */
export function compileRasterToneCurve(
  input: readonly Partial<RasterToneCurvePoint>[] | null | undefined,
): CompiledRasterToneCurve {
  const points = normalizeRasterToneCurve(input);
  const intervalCount = points.length - 1;
  const widths = new Array<number>(intervalCount);
  const secants = new Array<number>(intervalCount);
  for (let index = 0; index < intervalCount; index += 1) {
    widths[index] = points[index + 1].x - points[index].x;
    secants[index] = (points[index + 1].y - points[index].y) / widths[index];
  }

  if (points.length === 2) {
    return Object.freeze({
      points,
      slopes: Object.freeze([secants[0], secants[0]]),
    });
  }

  const slopes = new Array<number>(points.length).fill(0);
  slopes[0] = endpointSlope(widths[0], widths[1], secants[0], secants[1]);
  for (let index = 1; index < points.length - 1; index += 1) {
    const left = secants[index - 1];
    const right = secants[index];
    if (left === 0 || right === 0 || Math.sign(left) !== Math.sign(right)) {
      slopes[index] = 0;
      continue;
    }
    const leftWeight = 2 * widths[index] + widths[index - 1];
    const rightWeight = widths[index] + 2 * widths[index - 1];
    slopes[index] = (leftWeight + rightWeight)
      / (leftWeight / left + rightWeight / right);
  }
  const final = points.length - 1;
  slopes[final] = endpointSlope(
    widths[final - 1],
    widths[final - 2],
    secants[final - 1],
    secants[final - 2],
  );
  return Object.freeze({ points, slopes: Object.freeze(slopes) });
}

function intervalForInput(
  points: readonly RasterToneCurvePoint[],
  input: number,
): number {
  let low = 0;
  let high = points.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >>> 1;
    if (input < points[middle].x) high = middle;
    else low = middle;
  }
  return low;
}

/** Evaluates a compiled shape-preserving cubic without overshooting a segment. */
export function evaluateCompiledRasterToneCurve(
  curve: Readonly<CompiledRasterToneCurve>,
  input: number,
): number {
  const value = clampUnit(Number.isFinite(input) ? input : 0);
  if (value <= curve.points[0].x) return curve.points[0].y;
  if (value >= curve.points[curve.points.length - 1].x) {
    return curve.points[curve.points.length - 1].y;
  }
  const index = intervalForInput(curve.points, value);
  const left = curve.points[index];
  const right = curve.points[index + 1];
  const width = right.x - left.x;
  const t = (value - left.x) / width;
  const t2 = t * t;
  const t3 = t2 * t;
  const interpolated =
    (2 * t3 - 3 * t2 + 1) * left.y
    + (t3 - 2 * t2 + t) * width * curve.slopes[index]
    + (-2 * t3 + 3 * t2) * right.y
    + (t3 - t2) * width * curve.slopes[index + 1];
  return clampUnit(Math.max(
    Math.min(left.y, right.y),
    Math.min(Math.max(left.y, right.y), interpolated),
  ));
}

export function evaluateRasterToneCurve(
  curve: readonly Partial<RasterToneCurvePoint>[] | null | undefined,
  input: number,
): number {
  return evaluateCompiledRasterToneCurve(compileRasterToneCurve(curve), input);
}

/**
 * Packs one 16-byte entry per input bin: composite, red, green, blue. The
 * layout can be uploaded directly to a WebGPU read-only storage buffer.
 */
export function createPackedRasterToneCurveLut(
  input: Partial<RasterToneCurveSet> | null | undefined,
): Float32Array<ArrayBuffer> {
  const curves = normalizeRasterToneCurveSet(input);
  const compiled = [
    compileRasterToneCurve(curves.composite),
    compileRasterToneCurve(curves.red),
    compileRasterToneCurve(curves.green),
    compileRasterToneCurve(curves.blue),
  ];
  const result = new Float32Array(RASTER_TONE_CURVE_LUT_SIZE * 4);
  for (let index = 0; index < RASTER_TONE_CURVE_LUT_SIZE; index += 1) {
    const inputValue = index / (RASTER_TONE_CURVE_LUT_SIZE - 1);
    const offset = index * 4;
    for (let channel = 0; channel < 4; channel += 1) {
      result[offset + channel] = evaluateCompiledRasterToneCurve(
        compiled[channel],
        inputValue,
      );
    }
  }
  return result;
}

function samplePackedLutChannel(
  lut: Float32Array,
  channel: number,
  input: number,
): number {
  if (lut.length < RASTER_TONE_CURVE_LUT_SIZE * 4) {
    throw new Error("The raster tone curve LUT is incomplete.");
  }
  const position = clampUnit(input) * (RASTER_TONE_CURVE_LUT_SIZE - 1);
  const lower = Math.floor(position);
  const upper = Math.min(RASTER_TONE_CURVE_LUT_SIZE - 1, lower + 1);
  const amount = position - lower;
  const left = lut[lower * 4 + channel];
  const right = lut[upper * 4 + channel];
  return left + (right - left) * amount;
}

export function linearRgbToEncodedRgb(value: number): number {
  const linear = clampUnit(Number.isFinite(value) ? value : 0);
  return linear <= 0.0031308
    ? linear * 12.92
    : 1.055 * linear ** (1 / 2.4) - 0.055;
}

export function encodedRgbToLinearRgb(value: number): number {
  const encoded = clampUnit(Number.isFinite(value) ? value : 0);
  return encoded <= 0.04045
    ? encoded / 12.92
    : ((encoded + 0.055) / 1.055) ** 2.4;
}

/**
 * CPU oracle for the compute shader. Source and result are premultiplied
 * linear RGBA. Curves operate on straight encoded RGB; alpha is unchanged.
 * Per-channel curves run first, followed by the composite curve.
 */
export function applyPackedRasterToneCurveLut(
  source: RasterToneRgba,
  lut: Float32Array,
): [number, number, number, number] {
  const alphaValue = Number(source[3]);
  const alpha = Number.isFinite(alphaValue) ? clampUnit(alphaValue) : 0;
  if (alpha <= COLOR_EPSILON) return [0, 0, 0, alpha];

  const encoded = [0, 1, 2].map((channel) => {
    const premultiplied = Number.isFinite(source[channel]) ? source[channel] : 0;
    return linearRgbToEncodedRgb(clampUnit(premultiplied / alpha));
  });
  const adjusted = encoded.map((value, channel) => {
    const component = samplePackedLutChannel(lut, channel + 1, value);
    return samplePackedLutChannel(lut, 0, component);
  });
  return [
    encodedRgbToLinearRgb(adjusted[0]) * alpha,
    encodedRgbToLinearRgb(adjusted[1]) * alpha,
    encodedRgbToLinearRgb(adjusted[2]) * alpha,
    alpha,
  ];
}

export function rasterToneHistogramOffset(
  channel: RasterToneCurveChannel,
): number {
  switch (channel) {
    case "composite": return 0;
    case "red": return RASTER_TONE_HISTOGRAM_BIN_COUNT;
    case "green": return RASTER_TONE_HISTOGRAM_BIN_COUNT * 2;
    case "blue": return RASTER_TONE_HISTOGRAM_BIN_COUNT * 3;
  }
}

export function rasterToneHistogramBin(value: number): number {
  return Math.min(
    RASTER_TONE_HISTOGRAM_BIN_COUNT - 1,
    Math.floor(clampUnit(Number.isFinite(value) ? value : 0)
      * RASTER_TONE_HISTOGRAM_BIN_COUNT),
  );
}

export function createEmptyRasterToneHistogram(): Uint32Array<ArrayBuffer> {
  return new Uint32Array(RASTER_TONE_HISTOGRAM_VALUE_COUNT);
}
