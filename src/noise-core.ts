export const DESTRUCTIVE_RASTER_NOISE_CORE_BUILD =
  "destructive-raster-noise-core-v1-gradient-fbm-domain-warp";

export const DESTRUCTIVE_RASTER_NOISE_ALGORITHM_VERSION = 1 as const;
export const DESTRUCTIVE_RASTER_NOISE_ALGORITHM =
  "gradient-fbm-domain-warp-v1" as const;
export const DESTRUCTIVE_RASTER_NOISE_MAX_AMOUNT_PERCENT = 300;
export const DESTRUCTIVE_RASTER_NOISE_AMOUNT_STEP = 1;
export const DESTRUCTIVE_RASTER_NOISE_PERCENT_MIN = 0;
export const DESTRUCTIVE_RASTER_NOISE_PERCENT_MAX = 100;
export const DESTRUCTIVE_RASTER_NOISE_MAX_OCTAVES = 8;
export const DESTRUCTIVE_RASTER_NOISE_HALF_MAX = 65_504;

export const RASTER_NOISE_CHANNEL_SALT_R = 0x243f6a88;
export const RASTER_NOISE_CHANNEL_SALT_G = 0x85a308d3;
export const RASTER_NOISE_CHANNEL_SALT_B = 0x13198a2e;
export const RASTER_NOISE_WARP_SALT_X = 0xa511e9b3;
export const RASTER_NOISE_WARP_SALT_Y = 0x63d83595;

export type RasterNoiseStyle = "clouds" | "billows" | "ridges";
export type RasterNoiseChannels = "single" | "multi";

export interface RasterNoiseSettings {
  readonly amountPercent: number;
  readonly scalePercent: number;
  readonly octavesPercent: number;
  readonly turbulencePercent: number;
  readonly style: RasterNoiseStyle;
  readonly channels: RasterNoiseChannels;
  readonly additive: boolean;
}

export interface RasterNoiseSeed {
  readonly low: number;
  readonly high: number;
}

export interface RasterNoiseRgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface RasterNoisePixel {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export const DEFAULT_RASTER_NOISE_SETTINGS: Readonly<RasterNoiseSettings> =
  Object.freeze({
    amountPercent: 0,
    scalePercent: 50,
    octavesPercent: 50,
    turbulencePercent: 0,
    style: "clouds",
    channels: "single",
    additive: true,
  });

function finite(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizePercent(value: unknown, fallback: number): number {
  return clamp(
    finite(value, fallback),
    DESTRUCTIVE_RASTER_NOISE_PERCENT_MIN,
    DESTRUCTIVE_RASTER_NOISE_PERCENT_MAX,
  );
}

export function normalizeRasterNoiseSettings(
  input: Partial<RasterNoiseSettings> | null | undefined,
): RasterNoiseSettings {
  const value = input ?? {};
  return {
    amountPercent: clamp(
      finite(value.amountPercent, DEFAULT_RASTER_NOISE_SETTINGS.amountPercent),
      0,
      DESTRUCTIVE_RASTER_NOISE_MAX_AMOUNT_PERCENT,
    ),
    scalePercent: normalizePercent(
      value.scalePercent,
      DEFAULT_RASTER_NOISE_SETTINGS.scalePercent,
    ),
    octavesPercent: normalizePercent(
      value.octavesPercent,
      DEFAULT_RASTER_NOISE_SETTINGS.octavesPercent,
    ),
    turbulencePercent: normalizePercent(
      value.turbulencePercent,
      DEFAULT_RASTER_NOISE_SETTINGS.turbulencePercent,
    ),
    style: value.style === "billows" || value.style === "ridges"
      ? value.style
      : "clouds",
    channels: value.channels === "multi" ? "multi" : "single",
    additive: typeof value.additive === "boolean"
      ? value.additive
      : DEFAULT_RASTER_NOISE_SETTINGS.additive,
  };
}

export function rasterNoisePeriodPixels(scalePercent: unknown): number {
  const normalized = normalizePercent(
    scalePercent,
    DEFAULT_RASTER_NOISE_SETTINGS.scalePercent,
  );
  return 2 ** (10 * normalized / 100);
}

export function rasterNoiseOctaveCount(octavesPercent: unknown): number {
  const normalized = normalizePercent(
    octavesPercent,
    DEFAULT_RASTER_NOISE_SETTINGS.octavesPercent,
  );
  return 1 + 7 * normalized / 100;
}

export function rasterNoiseTurbulence(turbulencePercent: unknown): number {
  return normalizePercent(
    turbulencePercent,
    DEFAULT_RASTER_NOISE_SETTINGS.turbulencePercent,
  ) / 100;
}

export function rasterNoiseAmountFactor(amountPercent: unknown): number {
  return clamp(
    finite(amountPercent, DEFAULT_RASTER_NOISE_SETTINGS.amountPercent),
    0,
    DESTRUCTIVE_RASTER_NOISE_MAX_AMOUNT_PERCENT,
  ) / 100;
}

export function pcgHash32(input: number): number {
  const state = (Math.imul(input >>> 0, 747_796_405) + 2_891_336_453) >>> 0;
  const shift = (state >>> 28) + 4;
  const word = Math.imul((((state >>> shift) ^ state) >>> 0), 277_803_737) >>> 0;
  return ((word >>> 22) ^ word) >>> 0;
}

export function rasterNoiseLatticeHash(
  x: number,
  y: number,
  seedLow: number,
  seedHigh: number,
  salt: number,
): number {
  let hash = ((seedLow >>> 0) ^ (salt >>> 0)) >>> 0;
  hash = pcgHash32((hash ^ (x >>> 0)) >>> 0);
  hash = pcgHash32((hash ^ (y >>> 0) ^ (seedHigh >>> 0)) >>> 0);
  return hash;
}

export function rasterNoiseUniform01(hash: number): number {
  return (hash >>> 8) * (1 / 16_777_216);
}

function quinticFade(value: number): number {
  return value * value * value * (value * (value * 6 - 15) + 10);
}

function gradientDot(index: number, x: number, y: number): number {
  const diagonal = Math.SQRT1_2;
  switch (index & 7) {
    case 0: return x;
    case 1: return -x;
    case 2: return y;
    case 3: return -y;
    case 4: return diagonal * (x + y);
    case 5: return diagonal * (-x + y);
    case 6: return diagonal * (x - y);
    default: return diagonal * (-x - y);
  }
}

function lerp(left: number, right: number, amount: number): number {
  return left + (right - left) * amount;
}

export function rasterNoiseGradient(
  x: number,
  y: number,
  seed: RasterNoiseSeed,
  salt: number,
): number {
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  const fractionX = x - cellX;
  const fractionY = y - cellY;
  const fadeX = quinticFade(fractionX);
  const fadeY = quinticFade(fractionY);
  const corner = (offsetX: number, offsetY: number): number => gradientDot(
    rasterNoiseLatticeHash(
      cellX + offsetX,
      cellY + offsetY,
      seed.low,
      seed.high,
      salt,
    ),
    fractionX - offsetX,
    fractionY - offsetY,
  );
  const top = lerp(corner(0, 0), corner(1, 0), fadeX);
  const bottom = lerp(corner(0, 1), corner(1, 1), fadeX);
  return clamp(lerp(top, bottom, fadeY) * Math.SQRT2, -1, 1);
}

function styleNoise(value: number, style: RasterNoiseStyle): number {
  const magnitude = Math.abs(value);
  const sign = value < 0 ? -1 : value > 0 ? 1 : 0;
  if (style === "billows") return sign * (2 * magnitude - magnitude * magnitude);
  if (style === "ridges") return sign * Math.sqrt(magnitude);
  return value;
}

function octaveSalt(channelSalt: number, octave: number): number {
  return pcgHash32(
    (channelSalt ^ Math.imul(octave + 1, 0x9e3779b9)) >>> 0,
  );
}

function fbm(
  x: number,
  y: number,
  periodPixels: number,
  octaves: number,
  style: RasterNoiseStyle,
  seed: RasterNoiseSeed,
  channelSalt: number,
  maximumOctaves = DESTRUCTIVE_RASTER_NOISE_MAX_OCTAVES,
): number {
  let remaining = octaves;
  let period = periodPixels;
  let amplitude = 1;
  let sum = 0;
  let weightSum = 0;
  for (let octave = 0; octave < maximumOctaves; octave += 1) {
    const fraction = Math.min(1, remaining);
    if (fraction <= 0 || period < 1) break;
    const value = styleNoise(
      rasterNoiseGradient(
        x / period,
        y / period,
        seed,
        octaveSalt(channelSalt, octave),
      ),
      style,
    );
    const weight = fraction * amplitude;
    sum += value * weight;
    weightSum += weight;
    remaining -= 1;
    amplitude *= 0.5;
    period *= 0.5;
  }
  return weightSum > 0 ? clamp(sum / weightSum, -1, 1) : 0;
}

function warpedPosition(
  documentX: number,
  documentY: number,
  periodPixels: number,
  turbulence: number,
  seed: RasterNoiseSeed,
): readonly [number, number] {
  if (turbulence <= 0) return [documentX, documentY];
  const warpPeriod = Math.max(2, periodPixels * 2);
  const warpAmplitude = 0.75 * turbulence * turbulence * periodPixels;
  const warpX = fbm(
    documentX,
    documentY,
    warpPeriod,
    3,
    "clouds",
    seed,
    RASTER_NOISE_WARP_SALT_X,
    3,
  );
  const warpY = fbm(
    documentX,
    documentY,
    warpPeriod,
    3,
    "clouds",
    seed,
    RASTER_NOISE_WARP_SALT_Y,
    3,
  );
  return [
    documentX + warpAmplitude * warpX,
    documentY + warpAmplitude * warpY,
  ];
}

function evaluateChannel(
  x: number,
  y: number,
  periodPixels: number,
  octaves: number,
  style: RasterNoiseStyle,
  seed: RasterNoiseSeed,
  salt: number,
): number {
  return clamp(
    0.5 + 0.5 * fbm(x, y, periodPixels, octaves, style, seed, salt),
    0,
    1,
  );
}

export function evaluateRasterNoise(
  documentX: number,
  documentY: number,
  settingsInput: Partial<RasterNoiseSettings> | null | undefined,
  seed: RasterNoiseSeed,
): RasterNoiseRgb {
  const settings = normalizeRasterNoiseSettings(settingsInput);
  const periodPixels = rasterNoisePeriodPixels(settings.scalePercent);
  const octaves = rasterNoiseOctaveCount(settings.octavesPercent);
  const turbulence = rasterNoiseTurbulence(settings.turbulencePercent);
  const [warpedX, warpedY] = warpedPosition(
    documentX,
    documentY,
    periodPixels,
    turbulence,
    seed,
  );
  const red = evaluateChannel(
    warpedX,
    warpedY,
    periodPixels,
    octaves,
    settings.style,
    seed,
    RASTER_NOISE_CHANNEL_SALT_R,
  );
  if (settings.channels === "single") return { r: red, g: red, b: red };
  return {
    r: red,
    g: evaluateChannel(
      warpedX,
      warpedY,
      periodPixels,
      octaves,
      settings.style,
      seed,
      RASTER_NOISE_CHANNEL_SALT_G,
    ),
    b: evaluateChannel(
      warpedX,
      warpedY,
      periodPixels,
      octaves,
      settings.style,
      seed,
      RASTER_NOISE_CHANNEL_SALT_B,
    ),
  };
}

function clampHalf(value: number): number {
  return clamp(value, -DESTRUCTIVE_RASTER_NOISE_HALF_MAX, DESTRUCTIVE_RASTER_NOISE_HALF_MAX);
}

export function applyRasterNoiseToPremultipliedPixel(
  source: RasterNoisePixel,
  noise: RasterNoiseRgb,
  settingsInput: Partial<RasterNoiseSettings> | null | undefined,
): RasterNoisePixel {
  const settings = normalizeRasterNoiseSettings(settingsInput);
  const amount = rasterNoiseAmountFactor(settings.amountPercent);
  if (
    amount === 0
    || !(source.a > 0)
    || !Number.isFinite(source.r)
    || !Number.isFinite(source.g)
    || !Number.isFinite(source.b)
    || !Number.isFinite(source.a)
  ) {
    return { ...source };
  }
  const channels = [noise.r, noise.g, noise.b] as const;
  const sourceChannels = [source.r, source.g, source.b] as const;
  const output = sourceChannels.map((value, index) => {
    const field = channels[index];
    if (!Number.isFinite(field)) return value;
    if (settings.additive) {
      return clampHalf(value + source.a * amount * (field - 0.5));
    }
    if (amount <= 1) {
      return clampHalf(lerp(value, source.a * field, amount));
    }
    return clampHalf(source.a * (0.5 + amount * (field - 0.5)));
  });
  return { r: output[0], g: output[1], b: output[2], a: source.a };
}
