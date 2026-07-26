// Pure CPU contract for the raster Stroke ("Traccia") effect.
//
// The constants, tile math, JFA schedule, distance encoding, coverage ramp,
// and compositing equations are intentionally kept equivalent to the legacy
// WebGL implementation in paint-webgpu-m1. This module has no DOM or WebGPU
// dependency and can therefore act as the oracle for the WebGPU port.

export const RASTER_STROKE_CORE_BUILD =
  "raster-stroke-core-v1-m1-q10.6-extent-jfa" as const;
export const RASTER_STROKE_TILE_SIZE = 256;
export const RASTER_STROKE_MAX_WIDTH = 512;
export const RASTER_STROKE_DISTANCE_SCALE = 64;
export const RASTER_STROKE_MAX_DISTANCE = 1023;
export const RASTER_STROKE_MAX_BUILD_EXTENT = 4096;
export const RASTER_STROKE_ALPHA_THRESHOLD = 127.5 / 255;
export const RASTER_STROKE_JFA_TIE_ORDER = "yx" as const;
export const RASTER_STROKE_JFA_TIE_EPSILON = 1e-5;
export const RASTER_STROKE_SCRATCH_STRATEGY =
  "compositor-only-8-otherwise-width-tiered-1024-through-128-or-2048" as const;
export const RASTER_STROKE_COMPOSITOR_ONLY_SCRATCH_EXTENT = 8;
export const RASTER_STROKE_COMPACT_SCRATCH_EXTENT = 1024;
export const RASTER_STROKE_COMPACT_SCRATCH_MAX_WIDTH = 128;
export const RASTER_STROKE_FULL_SCRATCH_EXTENT = 2048;

export function rasterStrokeScratchExtentForWidth(width: unknown): number {
  const normalizedWidth = Math.min(
    RASTER_STROKE_MAX_WIDTH,
    Math.max(0, Number(width) || 0),
  );
  return normalizedWidth <= RASTER_STROKE_COMPACT_SCRATCH_MAX_WIDTH
    ? RASTER_STROKE_COMPACT_SCRATCH_EXTENT
    : RASTER_STROKE_FULL_SCRATCH_EXTENT;
}

export function rasterStrokeScratchExtentForRenderer(
  strokeEnabled: unknown,
  width: unknown,
): number {
  const normalizedWidth = Math.min(
    RASTER_STROKE_MAX_WIDTH,
    Math.max(0, Number(width) || 0),
  );
  return Boolean(strokeEnabled) && normalizedWidth > 0
    ? rasterStrokeScratchExtentForWidth(normalizedWidth)
    : RASTER_STROKE_COMPOSITOR_ONLY_SCRATCH_EXTENT;
}

export const RASTER_STROKE_POSITIONS = [
  "inside",
  "center",
  "outside",
] as const;

export type RasterStrokePosition = (typeof RASTER_STROKE_POSITIONS)[number];
export type RasterStrokeRgba = [number, number, number, number];
export type RasterStrokeReadonlyRgba = readonly [number, number, number, number];

export interface RasterStrokeStyle {
  enabled: boolean;
  width: number;
  position: RasterStrokePosition;
  color: RasterStrokeRgba;
}

export interface RasterStrokeBuildRegion {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  w: number;
  h: number;
  halo: number;
}

export interface RasterStrokeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RasterStrokeSeed {
  x: number;
  y: number;
}

const DEFAULT_COLOR = Object.freeze([
  1,
  0.643,
  0.282,
  1,
] as const);

export const DEFAULT_RASTER_STROKE_STYLE = Object.freeze({
  enabled: false,
  width: 14,
  position: "outside" as const,
  color: DEFAULT_COLOR,
});

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

function finite(value: unknown, name: string): number {
  const result = Number(value);
  if (!Number.isFinite(result)) {
    throw new TypeError(`${name} deve essere finito`);
  }
  return result;
}

function unit(value: unknown, name: string): number {
  const result = finite(value, name);
  if (result < 0 || result > 1) {
    throw new RangeError(`${name} deve stare fra 0 e 1`);
  }
  return result;
}

function sourceRecord(value: unknown): Record<PropertyKey, unknown> {
  return value && typeof value === "object"
    ? value as Record<PropertyKey, unknown>
    : {};
}

function arrayLike(value: unknown): ArrayLike<unknown> | null {
  if (!value) {
    return null;
  }
  const candidate = value as { length?: unknown };
  return typeof candidate.length === "number"
    ? value as ArrayLike<unknown>
    : null;
}

export function normalizeRasterStrokeStyle(
  style: unknown = {},
): RasterStrokeStyle {
  const source = sourceRecord(style);
  const rawWidth = Number(
    source.width ?? DEFAULT_RASTER_STROKE_STYLE.width,
  );
  const width = Number.isFinite(rawWidth)
    ? clamp(rawWidth, 0, RASTER_STROKE_MAX_WIDTH)
    : DEFAULT_RASTER_STROKE_STYLE.width;
  const rawPosition = String(
    source.position ?? DEFAULT_RASTER_STROKE_STYLE.position,
  ).toLowerCase();
  const position = (
    RASTER_STROKE_POSITIONS as readonly string[]
  ).includes(rawPosition)
    ? rawPosition as RasterStrokePosition
    : DEFAULT_RASTER_STROKE_STYLE.position;
  const rawColor = arrayLike(source.color) ?? DEFAULT_COLOR;
  const color = Array.from({ length: 4 }, (_, index) => {
    const fallback = DEFAULT_COLOR[index];
    const value = Number(rawColor[index] ?? fallback);
    return Number.isFinite(value) ? clamp(value, 0, 1) : fallback;
  }) as RasterStrokeRgba;
  return {
    enabled: Boolean(source.enabled),
    width,
    position,
    color,
  };
}

export function copyRasterStrokeStyle(style: unknown = {}): RasterStrokeStyle {
  const value = normalizeRasterStrokeStyle(style);
  return {
    ...value,
    color: [...value.color],
  };
}

export function rasterStrokeStylesEqual(a: unknown, b: unknown): boolean {
  const left = normalizeRasterStrokeStyle(a);
  const right = normalizeRasterStrokeStyle(b);
  return left.enabled === right.enabled
    && left.width === right.width
    && left.position === right.position
    && left.color.every((value, index) => value === right.color[index]);
}

export function nextRasterStrokeMipValidThroughLevel(
  previousValidThroughLevel: number,
  selectedMipLevel: number,
  baseChanged: boolean,
): number {
  return baseChanged
    ? selectedMipLevel
    : Math.max(previousValidThroughLevel, selectedMipLevel);
}

export function rasterStrokeTileHalo(
  tileSize = RASTER_STROKE_TILE_SIZE,
  width = RASTER_STROKE_MAX_WIDTH,
): number {
  const normalizedTileSize = Math.max(
    1,
    Math.trunc(Number(tileSize) || RASTER_STROKE_TILE_SIZE),
  );
  const clampedWidth = Math.min(
    RASTER_STROKE_MAX_WIDTH,
    Math.max(0, Number(width) || 0),
  );
  // The +1.5 is part of the distance-field validity contract.
  return Math.max(1, Math.ceil((clampedWidth + 1.5) / normalizedTileSize));
}

function normalizeTileKeys(
  values: unknown,
  tileCount: number,
): number[] {
  const result: number[] = [];
  const iterator = values == null
    ? null
    : (values as { [Symbol.iterator]?: unknown })[Symbol.iterator];
  if (typeof iterator === "function") {
    for (const raw of values as Iterable<unknown>) {
      const key = Number(raw);
      if (
        Number.isInteger(key)
        && key >= 0
        && key < tileCount
        && !result.includes(key)
      ) {
        result.push(key);
      }
    }
  }
  return result;
}

export function dilateRasterStrokeTileKeys(
  values: unknown,
  tilesX = 16,
  tilesY = 16,
  tileSize = RASTER_STROKE_TILE_SIZE,
  width = RASTER_STROKE_MAX_WIDTH,
): number[] {
  const normalizedTilesX = Math.max(1, Math.trunc(Number(tilesX) || 1));
  const normalizedTilesY = Math.max(1, Math.trunc(Number(tilesY) || 1));
  const tileCount = normalizedTilesX * normalizedTilesY;
  const radius = rasterStrokeTileHalo(tileSize, width);
  const marks = new Uint8Array(tileCount);
  let source: number[];
  if (values instanceof Uint8Array && values.length === tileCount) {
    source = [];
    for (let key = 0; key < tileCount; key += 1) {
      if (values[key]) {
        source.push(key);
      }
    }
  } else {
    source = normalizeTileKeys(values, tileCount);
  }
  for (const key of source) {
    const tileX = key % normalizedTilesX;
    const tileY = (key / normalizedTilesX) | 0;
    for (
      let y = Math.max(0, tileY - radius);
      y <= Math.min(normalizedTilesY - 1, tileY + radius);
      y += 1
    ) {
      for (
        let x = Math.max(0, tileX - radius);
        x <= Math.min(normalizedTilesX - 1, tileX + radius);
        x += 1
      ) {
        marks[y * normalizedTilesX + x] = 1;
      }
    }
  }
  const result: number[] = [];
  for (let key = 0; key < tileCount; key += 1) {
    if (marks[key]) {
      result.push(key);
    }
  }
  return result;
}

export function rasterStrokeBuildRegion(
  keys: unknown,
  width = 4096,
  height = 4096,
  tileSize = RASTER_STROKE_TILE_SIZE,
  strokeWidth = RASTER_STROKE_MAX_WIDTH,
): RasterStrokeBuildRegion | null {
  const normalizedWidth = Math.trunc(Number(width));
  const normalizedHeight = Math.trunc(Number(height));
  const normalizedTileSize = Math.trunc(Number(tileSize));
  const tilesX = normalizedWidth / normalizedTileSize;
  const tilesY = normalizedHeight / normalizedTileSize;
  const values = normalizeTileKeys(keys, tilesX * tilesY);
  if (!values.length) {
    return null;
  }
  let x0 = normalizedWidth;
  let y0 = normalizedHeight;
  let x1 = 0;
  let y1 = 0;
  for (const key of values) {
    const tileX = key % tilesX;
    const tileY = (key / tilesX) | 0;
    x0 = Math.min(x0, tileX * normalizedTileSize);
    y0 = Math.min(y0, tileY * normalizedTileSize);
    x1 = Math.max(x1, (tileX + 1) * normalizedTileSize);
    y1 = Math.max(y1, (tileY + 1) * normalizedTileSize);
  }
  // The +2 apron guarantees every sample read by the render ramp is covered.
  const halo = Math.min(
    RASTER_STROKE_MAX_WIDTH,
    Math.max(0, Number(strokeWidth) || 0),
  ) + 2;
  x0 = Math.max(-1, x0 - halo);
  y0 = Math.max(-1, y0 - halo);
  x1 = Math.min(normalizedWidth + 1, x1 + halo);
  y1 = Math.min(normalizedHeight + 1, y1 + halo);
  return {
    x0,
    y0,
    x1,
    y1,
    w: x1 - x0,
    h: y1 - y0,
    halo,
  };
}

export function partitionRasterStrokeBuildKeys(
  values: unknown,
  width = 4096,
  height = 4096,
  tileSize = RASTER_STROKE_TILE_SIZE,
  maxTexture = Math.max(width, height),
  strokeWidth = RASTER_STROKE_MAX_WIDTH,
): number[][] {
  const normalizedWidth = Math.trunc(Number(width));
  const normalizedHeight = Math.trunc(Number(height));
  const normalizedTileSize = Math.trunc(Number(tileSize));
  const normalizedMaxTexture = Math.trunc(Number(maxTexture));
  const tilesX = normalizedWidth / normalizedTileSize;
  const tilesY = normalizedHeight / normalizedTileSize;
  const source = normalizeTileKeys(values, tilesX * tilesY)
    .sort((a, b) => a - b);
  const result: number[][] = [];
  if (!source.length) {
    return result;
  }
  if (normalizedMaxTexture <= 0) {
    throw new RangeError("MAX_TEXTURE_SIZE Traccia non valido");
  }

  const split = (keys: number[]): void => {
    const region = rasterStrokeBuildRegion(
      keys,
      normalizedWidth,
      normalizedHeight,
      normalizedTileSize,
      strokeWidth,
    );
    if (!region) {
      throw new Error("regione JFA Traccia mancante");
    }
    if (
      region.w <= normalizedMaxTexture
      && region.h <= normalizedMaxTexture
    ) {
      result.push(keys);
      return;
    }
    const splitX = (
      region.w > normalizedMaxTexture
      && region.h <= normalizedMaxTexture
    ) || (
      region.w > normalizedMaxTexture
      && region.w >= region.h
    );
    let lower = Infinity;
    let upper = -Infinity;
    for (const key of keys) {
      const value = splitX ? key % tilesX : (key / tilesX) | 0;
      lower = Math.min(lower, value);
      upper = Math.max(upper, value);
    }
    if (lower === upper) {
      throw new RangeError(
        `regione JFA Traccia non partizionabile:`
        + ` ${region.w}x${region.h} > ${normalizedMaxTexture}`,
      );
    }
    const pivot = (lower + upper) >> 1;
    const before: number[] = [];
    const after: number[] = [];
    for (const key of keys) {
      const value = splitX ? key % tilesX : (key / tilesX) | 0;
      (value <= pivot ? before : after).push(key);
    }
    if (!before.length || !after.length) {
      throw new RangeError(
        `partizione JFA Traccia vuota: ${region.w}x${region.h}`,
      );
    }
    split(before);
    split(after);
  };

  split(source);
  return result;
}

const finiteInteger = (value: unknown, fallback = 1): number => {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) ? number : fallback;
};

export function jfaScheduleForExtent(
  extent: unknown,
  { plusOne = true }: { plusOne?: boolean } = {},
): number[] {
  const normalizedExtent = Math.max(1, finiteInteger(extent));
  let step = 1;
  while (step < normalizedExtent) {
    step *= 2;
  }
  step = Math.max(1, step >> 1);
  const result: number[] = [];
  for (; step >= 1; step >>= 1) {
    result.push(step);
  }
  if (plusOne) {
    result.push(1);
  }
  return result;
}

export function rasterStrokeJfaScheduleForRegion(
  region: Pick<RasterStrokeBuildRegion, "w" | "h">,
): number[] {
  // Deliberately extent-based, matching m1. A radius-based schedule changes
  // which seed wins and is therefore not a pixel-preserving optimization.
  return jfaScheduleForExtent(Math.max(region.w, region.h), {
    plusOne: true,
  });
}

export function rasterStrokeJfaSeedTieLess(
  left: RasterStrokeSeed,
  right: RasterStrokeSeed,
): boolean {
  return left.y < right.y || (left.y === right.y && left.x < right.x);
}

export function rasterStrokeJfaCandidateWins(
  center: RasterStrokeSeed,
  candidate: RasterStrokeSeed,
  incumbent: RasterStrokeSeed | null,
): boolean {
  if (!incumbent) {
    return true;
  }
  const candidateX = center.x - candidate.x;
  const candidateY = center.y - candidate.y;
  const incumbentX = center.x - incumbent.x;
  const incumbentY = center.y - incumbent.y;
  const candidateDistanceSquared =
    candidateX * candidateX + candidateY * candidateY;
  const incumbentDistanceSquared =
    incumbentX * incumbentX + incumbentY * incumbentY;
  return candidateDistanceSquared
      < incumbentDistanceSquared - RASTER_STROKE_JFA_TIE_EPSILON
    || (
      Math.abs(candidateDistanceSquared - incumbentDistanceSquared)
        <= RASTER_STROKE_JFA_TIE_EPSILON
      && rasterStrokeJfaSeedTieLess(candidate, incumbent)
    );
}

export function quantizeRasterStrokeDistance(distance: number): number {
  const value = finite(distance, "distance Traccia");
  if (value < 0) {
    throw new RangeError("distance Traccia deve essere >= 0");
  }
  // Exact DISTANCE_FRAGMENT equation:
  // floor(min(distance, 1023.0) * 64.0 + 0.5).
  return Math.floor(
    Math.min(value, RASTER_STROKE_MAX_DISTANCE)
      * RASTER_STROKE_DISTANCE_SCALE
    + 0.5,
  );
}

export function packRasterStrokeDistanceQ10_6(
  distance: number,
): [number, number] {
  const fixedDistance = quantizeRasterStrokeDistance(distance);
  return [
    fixedDistance & 255,
    (fixedDistance >>> 8) & 255,
  ];
}

export function unpackRasterStrokeFixedDistanceFromUnorm(
  low: number,
  high: number,
): number {
  const lowUnorm = unit(low, "distance.low");
  const highUnorm = unit(high, "distance.high");
  // Exact NODE_FRAGMENT RG8 decode, including the defensive +0.5 rounding.
  return Math.floor(lowUnorm * 255 + 0.5)
    + Math.floor(highUnorm * 255 + 0.5) * 256;
}

export function unpackRasterStrokeDistanceQ10_6(
  low: number,
  high: number,
): number {
  return unpackRasterStrokeFixedDistanceFromUnorm(low, high)
    / RASTER_STROKE_DISTANCE_SCALE;
}

export function rasterStrokeSignedDistance(
  alpha: number,
  distance: number,
): number {
  const normalizedAlpha = unit(alpha, "alpha Traccia");
  const normalizedDistance = finite(distance, "distance Traccia");
  if (normalizedDistance < 0) {
    throw new RangeError("distance Traccia deve essere >= 0");
  }
  return normalizedAlpha >= RASTER_STROKE_ALPHA_THRESHOLD
    ? 1.5 - normalizedAlpha - normalizedDistance
    : normalizedDistance - 0.5 - normalizedAlpha;
}

export function rasterStrokeRampAt(
  offset: number,
  signedDistance: number,
): number {
  return clamp(
    finite(offset, "offset Traccia")
      + 0.5
      - finite(signedDistance, "signedDistance Traccia"),
    0,
    1,
  );
}

export function quantizeRasterStrokeCoverage(coverage: number): number {
  return Math.floor(
    clamp(finite(coverage, "coverage Traccia"), 0, 1) * 255 + 0.5,
  ) / 255;
}

export function rasterStrokeCoverageFromSignedDistance(
  signedDistance: number,
  width: number,
  position: RasterStrokePosition,
): number {
  const normalizedWidth = clamp(
    finite(width, "width Traccia"),
    0,
    RASTER_STROKE_MAX_WIDTH,
  );
  const f0 = rasterStrokeRampAt(0, signedDistance);
  let coverage: number;
  if (position === "outside") {
    coverage = rasterStrokeRampAt(normalizedWidth, signedDistance) - f0;
  } else if (position === "inside") {
    coverage = f0
      - rasterStrokeRampAt(-normalizedWidth, signedDistance);
  } else if (position === "center") {
    const radius = normalizedWidth * 0.5;
    coverage = rasterStrokeRampAt(radius, signedDistance)
      - rasterStrokeRampAt(-radius, signedDistance);
  } else {
    throw new RangeError(`posizione Traccia sconosciuta: ${String(position)}`);
  }
  return quantizeRasterStrokeCoverage(coverage);
}

export function rasterStrokeCoverageFromFixedDistance(
  alpha: number,
  fixedDistance: number,
  width: number,
  position: RasterStrokePosition,
): number {
  const normalizedFixedDistance = finite(
    fixedDistance,
    "fixedDistance Traccia",
  );
  // Zero is the clear/unavailable sentinel in the legacy RG8 field.
  if (normalizedFixedDistance < 1) {
    return 0;
  }
  return rasterStrokeCoverageFromSignedDistance(
    rasterStrokeSignedDistance(
      alpha,
      normalizedFixedDistance / RASTER_STROKE_DISTANCE_SCALE,
    ),
    width,
    position,
  );
}

export function compositeRasterStrokePixel(
  base: RasterStrokeReadonlyRgba,
  coverage: number,
  style: unknown,
  opacity = 1,
): RasterStrokeRgba {
  if (!base || base.length !== 4) {
    throw new TypeError("pixel base Traccia non valido");
  }
  const normalizedBase = base.map((value, index) =>
    unit(value, `base Traccia[${index}]`)
  ) as RasterStrokeRgba;
  const normalizedCoverage = clamp(
    finite(coverage, "coverage Traccia"),
    0,
    1,
  );
  const normalizedStyle = normalizeRasterStrokeStyle(style);
  const normalizedOpacity = clamp(Number(opacity) || 0, 0, 1);
  const alpha = normalizedBase[3];
  let strokeWeight = normalizedCoverage * normalizedStyle.color[3];
  if (normalizedStyle.position === "outside") {
    strokeWeight = Math.min(strokeWeight, 1 - alpha);
  }
  const baseWeight = normalizedStyle.position === "outside"
    ? alpha
    : Math.max(0, alpha - strokeWeight);
  const finalAlpha = normalizedStyle.position === "outside"
    ? Math.min(1, alpha + strokeWeight)
    : Math.max(alpha, strokeWeight);
  const baseStraight: [number, number, number] = alpha > 0
    ? [
      normalizedBase[0] / alpha,
      normalizedBase[1] / alpha,
      normalizedBase[2] / alpha,
    ]
    : [0, 0, 0];
  const red = clamp(
    normalizedStyle.color[0] * strokeWeight
      + baseStraight[0] * baseWeight,
    0,
    finalAlpha,
  );
  const green = clamp(
    normalizedStyle.color[1] * strokeWeight
      + baseStraight[1] * baseWeight,
    0,
    finalAlpha,
  );
  const blue = clamp(
    normalizedStyle.color[2] * strokeWeight
      + baseStraight[2] * baseWeight,
    0,
    finalAlpha,
  );
  return [
    red * normalizedOpacity,
    green * normalizedOpacity,
    blue * normalizedOpacity,
    clamp(finalAlpha, 0, 1) * normalizedOpacity,
  ];
}
