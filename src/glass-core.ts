/** Pure, deterministic controls and procedural surface math for Glass. */

export const DESTRUCTIVE_RASTER_GLASS_CORE_BUILD =
  "destructive-raster-glass-core-v1-analytic-gradient-refraction" as const;

export const DESTRUCTIVE_RASTER_GLASS_ALGORITHM =
  "analytic-gradient-refraction-v1" as const;
export const DESTRUCTIVE_RASTER_GLASS_ALGORITHM_VERSION = 1 as const;

export const DESTRUCTIVE_RASTER_GLASS_MAX_DISTORTION_PERCENT = 100;
export const DESTRUCTIVE_RASTER_GLASS_MAX_DISPLACEMENT_PIXELS = 128;
export const DESTRUCTIVE_RASTER_GLASS_MIN_SCALE_PERCENT = 0;
export const DESTRUCTIVE_RASTER_GLASS_MAX_SCALE_PERCENT = 100;
export const DESTRUCTIVE_RASTER_GLASS_MIN_SCALE_PIXELS = 8;
export const DESTRUCTIVE_RASTER_GLASS_MAX_SCALE_PIXELS = 256;
export const DESTRUCTIVE_RASTER_GLASS_MAX_OCTAVES = 5;

const GLASS_SURFACE_SALT = 0x6a09e667;

export interface RasterGlassSeed {
  readonly low: number;
  readonly high: number;
}

export interface RasterGlassSettings {
  readonly distortionPercent: number;
  readonly smoothnessPercent: number;
  readonly scalePercent: number;
  readonly invert: boolean;
}

export interface RasterGlassRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface RasterGlassVector {
  readonly x: number;
  readonly y: number;
}

export const DEFAULT_RASTER_GLASS_SETTINGS: Readonly<RasterGlassSettings> =
  Object.freeze({
    distortionPercent: 30,
    smoothnessPercent: 60,
    scalePercent: 50,
    invert: false,
  });

function finite(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizedPercent(value: unknown, fallback: number): number {
  return clamp(finite(value, fallback), 0, 100);
}

export function normalizeRasterGlassSettings(
  input: Partial<RasterGlassSettings> | null | undefined,
): RasterGlassSettings {
  const value = input ?? {};
  return {
    distortionPercent: normalizedPercent(
      value.distortionPercent,
      DEFAULT_RASTER_GLASS_SETTINGS.distortionPercent,
    ),
    smoothnessPercent: normalizedPercent(
      value.smoothnessPercent,
      DEFAULT_RASTER_GLASS_SETTINGS.smoothnessPercent,
    ),
    scalePercent: clamp(
      finite(value.scalePercent, DEFAULT_RASTER_GLASS_SETTINGS.scalePercent),
      DESTRUCTIVE_RASTER_GLASS_MIN_SCALE_PERCENT,
      DESTRUCTIVE_RASTER_GLASS_MAX_SCALE_PERCENT,
    ),
    invert: typeof value.invert === "boolean"
      ? value.invert
      : DEFAULT_RASTER_GLASS_SETTINGS.invert,
  };
}

export function normalizeRasterGlassSeed(
  input: Partial<RasterGlassSeed> | null | undefined,
): RasterGlassSeed {
  return {
    low: Math.trunc(finite(input?.low, 0)) >>> 0,
    high: Math.trunc(finite(input?.high, 0)) >>> 0,
  };
}

export function rasterGlassScalePixels(
  scalePercent: unknown,
): number {
  const normalized = clamp(
    finite(scalePercent, DEFAULT_RASTER_GLASS_SETTINGS.scalePercent),
    DESTRUCTIVE_RASTER_GLASS_MIN_SCALE_PERCENT,
    DESTRUCTIVE_RASTER_GLASS_MAX_SCALE_PERCENT,
  );
  const octaveSpan = Math.log2(
    DESTRUCTIVE_RASTER_GLASS_MAX_SCALE_PIXELS
    / DESTRUCTIVE_RASTER_GLASS_MIN_SCALE_PIXELS,
  );
  return DESTRUCTIVE_RASTER_GLASS_MIN_SCALE_PIXELS
    * 2 ** (octaveSpan * normalized / 100);
}

export function rasterGlassMaxDisplacementPixels(
  distortionPercent: unknown,
): number {
  const normalized = normalizedPercent(
    distortionPercent,
    DEFAULT_RASTER_GLASS_SETTINGS.distortionPercent,
  );
  return DESTRUCTIVE_RASTER_GLASS_MAX_DISPLACEMENT_PIXELS * normalized / 100;
}

export function rasterGlassSmoothness(
  smoothnessPercent: unknown,
): number {
  return normalizedPercent(
    smoothnessPercent,
    DEFAULT_RASTER_GLASS_SETTINGS.smoothnessPercent,
  ) / 100;
}

export function rasterGlassBounds(
  source: Readonly<RasterGlassRect> | null,
  displacementPixels: unknown,
  documentWidth: number,
  documentHeight: number,
): RasterGlassRect | null {
  if (!source || source.width <= 0 || source.height <= 0) return null;
  const support = Math.ceil(Math.max(0, finite(displacementPixels, 0)));
  const left = Math.max(0, Math.floor(source.x) - support);
  const top = Math.max(0, Math.floor(source.y) - support);
  const right = Math.min(
    Math.max(0, Math.floor(documentWidth)),
    Math.ceil(source.x + source.width) + support,
  );
  const bottom = Math.min(
    Math.max(0, Math.floor(documentHeight)),
    Math.ceil(source.y + source.height) + support,
  );
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function rasterGlassResultBounds(
  source: Readonly<RasterGlassRect> | null,
  settings: Partial<RasterGlassSettings> | null | undefined,
  documentWidth: number,
  documentHeight: number,
): RasterGlassRect | null {
  const normalized = normalizeRasterGlassSettings(settings);
  return rasterGlassBounds(
    source,
    rasterGlassMaxDisplacementPixels(normalized.distortionPercent),
    documentWidth,
    documentHeight,
  );
}

export function rasterGlassMaximumBounds(
  source: Readonly<RasterGlassRect> | null,
  documentWidth: number,
  documentHeight: number,
): RasterGlassRect | null {
  return rasterGlassBounds(
    source,
    DESTRUCTIVE_RASTER_GLASS_MAX_DISPLACEMENT_PIXELS,
    documentWidth,
    documentHeight,
  );
}

export function unionRasterGlassRects(
  left: Readonly<RasterGlassRect> | null,
  right: Readonly<RasterGlassRect> | null,
): RasterGlassRect | null {
  if (!left) return right ? { ...right } : null;
  if (!right) return { ...left };
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const rightEdge = Math.max(left.x + left.width, right.x + right.width);
  const bottomEdge = Math.max(left.y + left.height, right.y + right.height);
  return { x, y, width: rightEdge - x, height: bottomEdge - y };
}

export function rasterGlassPcgHash32(input: number): number {
  const state = (Math.imul(input >>> 0, 747_796_405) + 2_891_336_453) >>> 0;
  const shift = (state >>> 28) + 4;
  const word = Math.imul(
    (((state >>> shift) ^ state) >>> 0),
    277_803_737,
  ) >>> 0;
  return ((word >>> 22) ^ word) >>> 0;
}

function latticeHash(
  x: number,
  y: number,
  seed: Readonly<RasterGlassSeed>,
  octave: number,
): number {
  let hash = (seed.low ^ GLASS_SURFACE_SALT) >>> 0;
  hash = rasterGlassPcgHash32((hash ^ (x >>> 0)) >>> 0);
  hash = rasterGlassPcgHash32((hash ^ (y >>> 0) ^ seed.high) >>> 0);
  return rasterGlassPcgHash32(
    (hash ^ Math.imul(octave + 1, 0x9e3779b9)) >>> 0,
  );
}

function gradient(index: number): RasterGlassVector {
  const diagonal = Math.SQRT1_2;
  switch (index & 7) {
    case 0: return { x: 1, y: 0 };
    case 1: return { x: -1, y: 0 };
    case 2: return { x: 0, y: 1 };
    case 3: return { x: 0, y: -1 };
    case 4: return { x: diagonal, y: diagonal };
    case 5: return { x: -diagonal, y: diagonal };
    case 6: return { x: diagonal, y: -diagonal };
    default: return { x: -diagonal, y: -diagonal };
  }
}

function fade(value: number): number {
  return value * value * value * (value * (value * 6 - 15) + 10);
}

function fadeDerivative(value: number): number {
  const distance = value - 1;
  return 30 * value * value * distance * distance;
}

function lerp(left: number, right: number, amount: number): number {
  return left + (right - left) * amount;
}

interface GradientSample {
  readonly value: number;
  readonly dx: number;
  readonly dy: number;
}

/** Value and analytic derivatives of one seeded gradient-noise octave. */
export function evaluateRasterGlassGradientNoise(
  x: number,
  y: number,
  seedInput: Readonly<RasterGlassSeed>,
  octave = 0,
): GradientSample {
  const seed = normalizeRasterGlassSeed(seedInput);
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  const fractionX = x - cellX;
  const fractionY = y - cellY;
  const blendX = fade(fractionX);
  const blendY = fade(fractionY);
  const derivativeX = fadeDerivative(fractionX);
  const derivativeY = fadeDerivative(fractionY);

  const g00 = gradient(latticeHash(cellX, cellY, seed, octave));
  const g10 = gradient(latticeHash(cellX + 1, cellY, seed, octave));
  const g01 = gradient(latticeHash(cellX, cellY + 1, seed, octave));
  const g11 = gradient(latticeHash(cellX + 1, cellY + 1, seed, octave));
  const n00 = g00.x * fractionX + g00.y * fractionY;
  const n10 = g10.x * (fractionX - 1) + g10.y * fractionY;
  const n01 = g01.x * fractionX + g01.y * (fractionY - 1);
  const n11 = g11.x * (fractionX - 1) + g11.y * (fractionY - 1);

  const upper = lerp(n00, n10, blendX);
  const lower = lerp(n01, n11, blendX);
  const upperDx = lerp(g00.x, g10.x, blendX) + (n10 - n00) * derivativeX;
  const lowerDx = lerp(g01.x, g11.x, blendX) + (n11 - n01) * derivativeX;
  const upperDy = lerp(g00.y, g10.y, blendX);
  const lowerDy = lerp(g01.y, g11.y, blendX);
  const normalization = Math.SQRT2;
  return {
    value: lerp(upper, lower, blendY) * normalization,
    dx: lerp(upperDx, lowerDx, blendY) * normalization,
    dy: (
      lerp(upperDy, lowerDy, blendY)
      + (lower - upper) * derivativeY
    ) * normalization,
  };
}

/**
 * Returns a destination-to-source offset in document pixels. Coordinates are
 * document-space pixel centers, so changing a layer crop or viewport cannot
 * move the procedural surface.
 */
export function evaluateRasterGlassDisplacement(
  documentX: number,
  documentY: number,
  settingsInput: Partial<RasterGlassSettings> | null | undefined,
  seedInput: Readonly<RasterGlassSeed>,
): RasterGlassVector {
  const settings = normalizeRasterGlassSettings(settingsInput);
  const seed = normalizeRasterGlassSeed(seedInput);
  const period = rasterGlassScalePixels(settings.scalePercent);
  const roughness = 1 - rasterGlassSmoothness(settings.smoothnessPercent);
  const octaveSpan = 1 + (DESTRUCTIVE_RASTER_GLASS_MAX_OCTAVES - 1) * roughness;
  const persistence = 0.08 + 0.54 * roughness;
  let frequency = 1;
  let amplitude = 1;
  let slopeX = 0;
  let slopeY = 0;
  let weightSum = 0;
  for (let octave = 0; octave < DESTRUCTIVE_RASTER_GLASS_MAX_OCTAVES; octave += 1) {
    const fraction = clamp(octaveSpan - octave, 0, 1);
    if (fraction <= 0) break;
    const sample = evaluateRasterGlassGradientNoise(
      documentX * frequency / period,
      documentY * frequency / period,
      seed,
      octave,
    );
    const weight = amplitude * fraction;
    slopeX += sample.dx * frequency * weight;
    slopeY += sample.dy * frequency * weight;
    weightSum += weight;
    frequency *= 2;
    amplitude *= persistence;
  }
  if (weightSum > 0) {
    slopeX /= weightSum;
    slopeY /= weightSum;
  }
  const magnitude = Math.hypot(slopeX, slopeY);
  const displacement = rasterGlassMaxDisplacementPixels(settings.distortionPercent);
  if (displacement === 0) return { x: 0, y: 0 };
  const direction = settings.invert ? -1 : 1;
  const attenuation = 1 / (1 + magnitude);
  return {
    x: direction * displacement * slopeX * attenuation,
    y: direction * displacement * slopeY * attenuation,
  };
}
