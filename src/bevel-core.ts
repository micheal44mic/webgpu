export const RASTER_BEVEL_CORE_BUILD =
  "raster-bevel-core-webgpu-v1-heightfield-v2";
export const RASTER_BEVEL_STYLE_BUILD =
  "raster-bevel-style-v3-normal-apron";

export const RASTER_BEVEL_TILE_SIZE = 256;
export const RASTER_BEVEL_NORMAL_APRON = 1;
export const RASTER_BEVEL_MAX_RADIUS = 576;
export const RASTER_BEVEL_PROFILE_SIZE = 1024;
export const RASTER_BEVEL_GLOSS_SIZE = 256;
export const RASTER_BEVEL_DIRECTION_COUNT = 4096;
export const RASTER_BEVEL_DISTANCE_SCALE = 4;
export const RASTER_BEVEL_DISTANCE_SIGN_BIT = 0x0800;
export const RASTER_BEVEL_DISTANCE_MASK = 0x07ff;
export const RASTER_BEVEL_DISTANCE_DIRECTION_SHIFT = 12;
export const RASTER_BEVEL_MAX_WORK_SIDE =
  RASTER_BEVEL_TILE_SIZE + RASTER_BEVEL_MAX_RADIUS * 2;

export const RASTER_BEVEL_MODES = [
  "inner",
  "outer",
  "emboss",
  "pillow",
] as const;
export const RASTER_BEVEL_TECHNIQUES = [
  "smooth",
  "chiselHard",
  "chiselSoft",
] as const;
export const RASTER_BEVEL_DIRECTIONS = ["up", "down"] as const;
export const RASTER_BEVEL_GLOSSES = [
  "linear",
  "soft",
  "gaussian",
  "cone",
  "ring",
] as const;
export const RASTER_BEVEL_CONTOURS = [
  "linear",
  "cone",
  "gaussian",
  "ring",
] as const;

export type RasterBevelMode = (typeof RASTER_BEVEL_MODES)[number];
export type RasterBevelTechnique = (typeof RASTER_BEVEL_TECHNIQUES)[number];
export type RasterBevelDirection = (typeof RASTER_BEVEL_DIRECTIONS)[number];
export type RasterBevelGloss = (typeof RASTER_BEVEL_GLOSSES)[number];
export type RasterBevelContour = (typeof RASTER_BEVEL_CONTOURS)[number];
export type RasterBevelColor = readonly [number, number, number];

export interface RasterBevelStyle {
  enabled: boolean;
  mode: RasterBevelMode;
  technique: RasterBevelTechnique;
  direction: RasterBevelDirection;
  size: number;
  soften: number;
  depth: number;
  angle: number;
  altitude: number;
  highlightColor: RasterBevelColor;
  highlightOpacity: number;
  shadowColor: RasterBevelColor;
  shadowOpacity: number;
  gloss: RasterBevelGloss;
  contourAA: boolean;
  bevelContourEnabled: boolean;
  bevelContour: RasterBevelContour;
  bevelRange: number;
  fill: number;
}

export interface RasterBevelDerivedHeightfield {
  style: RasterBevelStyle;
  sigma1: number;
  sigmaTech: number;
  sigmaSoften: number;
  sigmaB: number;
  bandWidth: number;
  amplitudeScale: number;
  apron: number;
}

export interface RasterBevelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RasterBevelStyleChange {
  changed: boolean;
  geometryChanged: boolean;
  geometryRebuild: boolean;
  lutChanged: boolean;
  requestedRadius: number;
  requestedBucket: number;
  currentBucket: number;
  release: boolean;
  hotOnly: boolean;
}

const DEFAULT_HIGHLIGHT: RasterBevelColor = [1, 0.957, 0.875];
const DEFAULT_SHADOW: RasterBevelColor = [0.141, 0.078, 0.035];

export const DEFAULT_RASTER_BEVEL_STYLE: Readonly<RasterBevelStyle> = Object.freeze({
  enabled: false,
  mode: "inner",
  technique: "smooth",
  direction: "up",
  size: 32,
  soften: 4,
  depth: 100,
  angle: 135,
  altitude: 30,
  highlightColor: DEFAULT_HIGHLIGHT,
  highlightOpacity: 75,
  shadowColor: DEFAULT_SHADOW,
  shadowOpacity: 75,
  gloss: "linear",
  contourAA: true,
  bevelContourEnabled: false,
  bevelContour: "linear",
  bevelRange: 100,
  fill: 100,
});

// The eight explicit Heightfield V2 calibrations from the original renderer.
// Visual parity must be reached through these values, never through local
// exceptions in a shader.
export const RASTER_BEVEL_HEIGHTFIELD_CALIBRATION = Object.freeze({
  smoothSigmaScale: 0.5,
  chiselSoftSigmaScale: 0.15,
  softenSigmaScale: 1,
  smoothAmplitudeScale: 0.31,
  rangeHypothesis: "A",
  adaptiveIso: false,
  blurKernel: "gaussian",
  defaultEffectOpacity: Object.freeze({ highlight: 0.75, shadow: 0.75 }),
});

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function finite(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function includes<T extends string>(
  values: readonly T[],
  candidate: unknown,
): candidate is T {
  return typeof candidate === "string" && values.includes(candidate as T);
}

function normalizeColor(
  value: unknown,
  fallback: RasterBevelColor,
): RasterBevelColor {
  let source: unknown = value;
  if (typeof source === "string") {
    const match = /^#?([0-9a-f]{6})$/i.exec(source);
    if (match) {
      const packed = Number.parseInt(match[1], 16);
      source = [
        ((packed >>> 16) & 255) / 255,
        ((packed >>> 8) & 255) / 255,
        (packed & 255) / 255,
      ];
    }
  }
  const values = Array.isArray(source) || ArrayBuffer.isView(source)
    ? source as ArrayLike<unknown>
    : fallback;
  return [
    clamp(finite(values[0], fallback[0]), 0, 1),
    clamp(finite(values[1], fallback[1]), 0, 1),
    clamp(finite(values[2], fallback[2]), 0, 1),
  ];
}

export function nextPowerOfTwo(value: number): number {
  const normalized = Math.max(1, Math.ceil(finite(value, 1)));
  let result = 1;
  while (result < normalized) {
    result *= 2;
  }
  return result;
}

export function normalizeRasterBevelStyle(source: unknown = {}): RasterBevelStyle {
  const value = source && typeof source === "object"
    ? source as Partial<RasterBevelStyle>
    : {};
  const legacyColors = value as Partial<RasterBevelStyle> & {
    highlight?: unknown;
    shadow?: unknown;
  };
  const mode = includes(RASTER_BEVEL_MODES, value.mode)
    ? value.mode
    : DEFAULT_RASTER_BEVEL_STYLE.mode;
  const technique = includes(RASTER_BEVEL_TECHNIQUES, value.technique)
    ? value.technique
    : DEFAULT_RASTER_BEVEL_STYLE.technique;
  const direction = includes(RASTER_BEVEL_DIRECTIONS, value.direction)
    ? value.direction
    : DEFAULT_RASTER_BEVEL_STYLE.direction;
  const gloss = includes(RASTER_BEVEL_GLOSSES, value.gloss)
    ? value.gloss
    : DEFAULT_RASTER_BEVEL_STYLE.gloss;
  const bevelContour = includes(RASTER_BEVEL_CONTOURS, value.bevelContour)
    ? value.bevelContour
    : DEFAULT_RASTER_BEVEL_STYLE.bevelContour;
  return {
    enabled: Boolean(value.enabled),
    mode,
    technique,
    direction,
    gloss,
    contourAA: value.contourAA !== false,
    bevelContourEnabled: value.bevelContourEnabled === true,
    bevelContour,
    size: clamp(finite(value.size, DEFAULT_RASTER_BEVEL_STYLE.size), 0.5, 250),
    soften: clamp(finite(value.soften, DEFAULT_RASTER_BEVEL_STYLE.soften), 0, 64),
    bevelRange: clamp(
      finite(value.bevelRange, DEFAULT_RASTER_BEVEL_STYLE.bevelRange),
      1,
      100,
    ),
    fill: clamp(finite(value.fill, DEFAULT_RASTER_BEVEL_STYLE.fill), 0, 100),
    depth: clamp(finite(value.depth, DEFAULT_RASTER_BEVEL_STYLE.depth), 1, 1000),
    angle: (
      (finite(value.angle, DEFAULT_RASTER_BEVEL_STYLE.angle) % 360) + 360
    ) % 360,
    altitude: clamp(
      finite(value.altitude, DEFAULT_RASTER_BEVEL_STYLE.altitude),
      0,
      90,
    ),
    highlightColor: normalizeColor(value.highlightColor ?? legacyColors.highlight, DEFAULT_HIGHLIGHT),
    highlightOpacity: clamp(
      finite(value.highlightOpacity, DEFAULT_RASTER_BEVEL_STYLE.highlightOpacity),
      0,
      100,
    ),
    shadowColor: normalizeColor(value.shadowColor ?? legacyColors.shadow, DEFAULT_SHADOW),
    shadowOpacity: clamp(
      finite(value.shadowOpacity, DEFAULT_RASTER_BEVEL_STYLE.shadowOpacity),
      0,
      100,
    ),
  };
}

export function copyRasterBevelStyle(source: unknown = {}): RasterBevelStyle {
  const value = normalizeRasterBevelStyle(source);
  return {
    ...value,
    highlightColor: [...value.highlightColor] as [number, number, number],
    shadowColor: [...value.shadowColor] as [number, number, number],
  };
}

export function deriveRasterBevelHeightfield(
  source: unknown = DEFAULT_RASTER_BEVEL_STYLE,
): RasterBevelDerivedHeightfield {
  const style = normalizeRasterBevelStyle(source);
  const smooth = style.technique === "smooth";
  const sigma1 = smooth
    ? RASTER_BEVEL_HEIGHTFIELD_CALIBRATION.smoothSigmaScale * style.size
    : 0;
  const sigmaTech = style.technique === "chiselSoft"
    ? RASTER_BEVEL_HEIGHTFIELD_CALIBRATION.chiselSoftSigmaScale * style.size
    : 0;
  const sigmaSoften =
    RASTER_BEVEL_HEIGHTFIELD_CALIBRATION.softenSigmaScale * style.soften;
  const sigmaB = Math.hypot(0.5, sigmaTech, sigmaSoften);
  const bandWidth = (style.mode === "emboss" ? 2 : 1) * style.size;
  const amplitudeScale = bandWidth * (
    smooth ? RASTER_BEVEL_HEIGHTFIELD_CALIBRATION.smoothAmplitudeScale : 1
  );
  const apron = Math.ceil(
    Math.max(style.size, 3 * sigma1) + 3 * sigmaB + 2,
  );
  return {
    style,
    sigma1,
    sigmaTech,
    sigmaSoften,
    sigmaB,
    bandWidth,
    amplitudeScale,
    apron,
  };
}

export function rasterBevelProfileExtent(
  source: unknown = DEFAULT_RASTER_BEVEL_STYLE,
): number {
  return deriveRasterBevelHeightfield(source).apron;
}

export function rasterBevelRadiusBucket(
  source: unknown = DEFAULT_RASTER_BEVEL_STYLE,
): number {
  return clamp(
    nextPowerOfTwo(rasterBevelProfileExtent(source)),
    2,
    RASTER_BEVEL_MAX_RADIUS,
  );
}

export function rasterBevelGeometryKey(
  source: unknown = DEFAULT_RASTER_BEVEL_STYLE,
): string {
  const value = normalizeRasterBevelStyle(source);
  return [
    value.mode,
    value.technique,
    value.size,
    value.soften,
    value.bevelContourEnabled ? 1 : 0,
    value.bevelContour,
    value.bevelRange,
  ].join("|");
}

export function rasterBevelStylesEqual(left: unknown, right: unknown): boolean {
  const a = normalizeRasterBevelStyle(left);
  const b = normalizeRasterBevelStyle(right);
  return a.enabled === b.enabled
    && a.mode === b.mode
    && a.technique === b.technique
    && a.direction === b.direction
    && a.gloss === b.gloss
    && a.contourAA === b.contourAA
    && a.bevelContourEnabled === b.bevelContourEnabled
    && a.bevelContour === b.bevelContour
    && a.bevelRange === b.bevelRange
    && a.fill === b.fill
    && a.size === b.size
    && a.soften === b.soften
    && a.depth === b.depth
    && a.angle === b.angle
    && a.altitude === b.altitude
    && a.highlightOpacity === b.highlightOpacity
    && a.shadowOpacity === b.shadowOpacity
    && a.highlightColor.every((value, index) => value === b.highlightColor[index])
    && a.shadowColor.every((value, index) => value === b.shadowColor[index]);
}

export function classifyRasterBevelStyleChange(
  before: unknown,
  after: unknown,
  currentBucket = 0,
): RasterBevelStyleChange {
  const left = normalizeRasterBevelStyle(before);
  const right = normalizeRasterBevelStyle(after);
  const normalizedCurrentBucket = Math.max(0, Math.trunc(finite(currentBucket, 0)));
  const requestedBucket = right.enabled ? rasterBevelRadiusBucket(right) : 0;
  const geometryChanged = rasterBevelGeometryKey(left) !== rasterBevelGeometryKey(right);
  const geometryRebuild = right.enabled
    && (!left.enabled || geometryChanged || normalizedCurrentBucket < requestedBucket);
  return {
    changed: !rasterBevelStylesEqual(left, right),
    geometryChanged,
    geometryRebuild,
    lutChanged: left.gloss !== right.gloss,
    requestedRadius: requestedBucket,
    requestedBucket,
    currentBucket: normalizedCurrentBucket,
    release: left.enabled && !right.enabled,
    hotOnly: !geometryRebuild,
  };
}


export type RasterBevelAlphaTileClass = "empty" | "full" | "partial" | "unknown";

export function rasterBevelTileHalo(
  bucket: number,
  tileSize = RASTER_BEVEL_TILE_SIZE,
): number {
  const normalizedBucket = clamp(Math.trunc(finite(bucket, 2)), 2, RASTER_BEVEL_MAX_RADIUS);
  const normalizedTileSize = Math.max(1, Math.trunc(finite(tileSize, RASTER_BEVEL_TILE_SIZE)));
  return Math.ceil(normalizedBucket / normalizedTileSize);
}

function normalizedTileKeys(
  values: Iterable<unknown> | null | undefined,
  tileCount: number,
): number[] {
  const result: number[] = [];
  const seen = new Uint8Array(tileCount);
  if (values && typeof values[Symbol.iterator] === "function") {
    for (const raw of values) {
      const key = Number(raw);
      if (Number.isInteger(key) && key >= 0 && key < tileCount && !seen[key]) {
        seen[key] = 1;
        result.push(key);
      }
    }
  }
  return result;
}

export function dilateRasterBevelTileKeys(
  values: Iterable<unknown> | null | undefined,
  bucket: number,
  tilesX = 16,
  tilesY = 16,
  tileSize = RASTER_BEVEL_TILE_SIZE,
): number[] {
  const normalizedTilesX = Math.max(1, Math.trunc(finite(tilesX, 1)));
  const normalizedTilesY = Math.max(1, Math.trunc(finite(tilesY, 1)));
  const tileCount = normalizedTilesX * normalizedTilesY;
  const radius = rasterBevelTileHalo(bucket, tileSize);
  const marks = new Uint8Array(tileCount);
  for (const key of normalizedTileKeys(values, tileCount)) {
    const tileX = key % normalizedTilesX;
    const tileY = Math.floor(key / normalizedTilesX);
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
  return Array.from(marks.keys()).filter((key) => marks[key] !== 0);
}

export function classifyAlphaTile(
  bytes: Uint8Array | null | undefined,
  present = true,
): RasterBevelAlphaTileClass {
  if (!present) return "empty";
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 4) return "unknown";
  let any = false;
  let all = true;
  for (let index = 3; index < bytes.length; index += 4) {
    const alpha = bytes[index];
    if (alpha !== 0) any = true;
    if (alpha !== 255) all = false;
    if (any && !all) return "partial";
  }
  return !any ? "empty" : all ? "full" : "partial";
}

export function rasterBevelBandCandidateKeys(
  classes: readonly RasterBevelAlphaTileClass[],
  bucket: number,
  tilesX = 16,
  tilesY = 16,
  tileSize = RASTER_BEVEL_TILE_SIZE,
): number[] {
  const tileCount = tilesX * tilesY;
  if (!classes || classes.length !== tileCount) {
    throw new TypeError("classificazione alpha Smusso non valida");
  }
  const edge: number[] = [];
  for (let key = 0; key < tileCount; key += 1) {
    const kind = classes[key];
    if (kind === "empty") continue;
    if (kind !== "full") {
      edge.push(key);
      continue;
    }
    const x = key % tilesX;
    const y = Math.floor(key / tilesX);
    let boundary = x === 0 || y === 0 || x === tilesX - 1 || y === tilesY - 1;
    for (let oy = -1; oy <= 1 && !boundary; oy += 1) {
      for (let ox = -1; ox <= 1 && !boundary; ox += 1) {
        if ((ox || oy) && classes[(y + oy) * tilesX + x + ox] !== "full") boundary = true;
      }
    }
    if (boundary) edge.push(key);
  }
  return dilateRasterBevelTileKeys(edge, bucket, tilesX, tilesY, tileSize);
}
export function rasterBevelVisualBounds(
  bounds: RasterBevelRect | null,
  source: unknown,
  documentWidth = 4096,
  documentHeight = 4096,
): RasterBevelRect | null {
  if (!bounds) {
    return null;
  }
  const style = normalizeRasterBevelStyle(source);
  const expand = style.enabled && style.mode !== "inner"
    ? Math.ceil(rasterBevelProfileExtent(style) + 1)
    : 0;
  const x = clamp(Math.floor(bounds.x - expand), 0, documentWidth);
  const y = clamp(Math.floor(bounds.y - expand), 0, documentHeight);
  const right = clamp(
    Math.ceil(bounds.x + bounds.width + expand),
    0,
    documentWidth,
  );
  const bottom = clamp(
    Math.ceil(bounds.y + bounds.height + expand),
    0,
    documentHeight,
  );
  return right > x && bottom > y
    ? { x, y, width: right - x, height: bottom - y }
    : null;
}

// A source-alpha mutation can change the heightfield on either side of the
// edge, even for an inner bevel whose final visible pixels remain inside.
// This is intentionally distinct from rasterBevelVisualBounds.
export function rasterBevelInfluenceBounds(
  bounds: RasterBevelRect | null,
  source: unknown,
  documentWidth = 4096,
  documentHeight = 4096,
): RasterBevelRect | null {
  if (!bounds) {
    return null;
  }
  const style = normalizeRasterBevelStyle(source);
  const expand = style.enabled
    ? Math.ceil(rasterBevelProfileExtent(style) + RASTER_BEVEL_NORMAL_APRON)
    : 0;
  const x = clamp(Math.floor(bounds.x - expand), 0, documentWidth);
  const y = clamp(Math.floor(bounds.y - expand), 0, documentHeight);
  const right = clamp(
    Math.ceil(bounds.x + bounds.width + expand),
    0,
    documentWidth,
  );
  const bottom = clamp(
    Math.ceil(bounds.y + bounds.height + expand),
    0,
    documentHeight,
  );
  return right > x && bottom > y
    ? { x, y, width: right - x, height: bottom - y }
    : null;
}

export function rasterBevelAlignedFieldBounds(
  bounds: RasterBevelRect | null,
  documentWidth = 4096,
  documentHeight = 4096,
): RasterBevelRect | null {
  if (!bounds) {
    return null;
  }
  const normalizedWidth = Math.max(1, Math.trunc(finite(documentWidth, 4096)));
  const normalizedHeight = Math.max(1, Math.trunc(finite(documentHeight, 4096)));
  const x = clamp(
    Math.floor(bounds.x / RASTER_BEVEL_TILE_SIZE) * RASTER_BEVEL_TILE_SIZE,
    0,
    normalizedWidth,
  );
  const y = clamp(
    Math.floor(bounds.y / RASTER_BEVEL_TILE_SIZE) * RASTER_BEVEL_TILE_SIZE,
    0,
    normalizedHeight,
  );
  const right = clamp(
    Math.ceil((bounds.x + bounds.width) / RASTER_BEVEL_TILE_SIZE)
      * RASTER_BEVEL_TILE_SIZE,
    0,
    normalizedWidth,
  );
  const bottom = clamp(
    Math.ceil((bounds.y + bounds.height) / RASTER_BEVEL_TILE_SIZE)
      * RASTER_BEVEL_TILE_SIZE,
    0,
    normalizedHeight,
  );
  return right > x && bottom > y
    ? { x, y, width: right - x, height: bottom - y }
    : null;
}

export function rasterBevelOutsideFieldHeight(
  source: unknown = DEFAULT_RASTER_BEVEL_STYLE,
): number {
  const style = normalizeRasterBevelStyle(source);
  const neutralProfileInput = style.mode === "pillow" ? 1 : 0;
  if (!style.bevelContourEnabled) {
    return neutralProfileInput;
  }
  const values = makeRasterBevelSplineContourLut(
    style.bevelContour,
    RASTER_BEVEL_PROFILE_SIZE,
  );
  const normalizedInput = Math.min(
    neutralProfileInput / Math.max(style.bevelRange / 100, 1e-3),
    1,
  );
  const q = clamp(normalizedInput, 0, 1) * (RASTER_BEVEL_PROFILE_SIZE - 1);
  const first = Math.floor(q);
  const second = Math.min(RASTER_BEVEL_PROFILE_SIZE - 1, first + 1);
  const fraction = q - first;
  return values[first] * (1 - fraction) + values[second] * fraction;
}

export function rasterBevelLightVector(
  angleDegrees: number,
  altitudeDegrees: number,
): RasterBevelColor {
  const angle = finite(angleDegrees, 135) * Math.PI / 180;
  const altitude = clamp(finite(altitudeDegrees, 30), 0, 90) * Math.PI / 180;
  const planar = Math.cos(altitude);
  return [
    Math.cos(angle) * planar,
    Math.sin(angle) * planar,
    Math.sin(altitude),
  ];
}

export function rasterBevelProfileDerivative(
  technique: RasterBevelTechnique,
  u: number,
): number {
  if (!(u > 0 && u < 1)) return 0;
  if (technique === "smooth") return 30 * u * u * (1 - u) * (1 - u);
  if (technique === "chiselHard") return 1;
  const beta = 0.18;
  const scale = 1 / (1 - beta);
  if (u < beta) return scale * u / beta;
  if (u <= 1 - beta) return scale;
  return scale * (1 - u) / beta;
}

export interface RasterBevelProfileLut {
  bytes: Uint8Array;
  extent: number;
  slopeMax: number;
  maximumSlope: number;
  terminalHeight: number;
}

export function makeRasterBevelProfileLut(
  input: unknown = DEFAULT_RASTER_BEVEL_STYLE,
): RasterBevelProfileLut {
  const style = normalizeRasterBevelStyle(input);
  const count = RASTER_BEVEL_PROFILE_SIZE;
  const extent = rasterBevelProfileExtent(style);
  const dx = extent / (count - 1);
  const base = new Float32Array(count);
  const blurred = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    base[index] = rasterBevelProfileDerivative(
      style.technique,
      index * dx / style.size,
    );
  }
  if (style.soften <= 1e-5) {
    blurred.set(base);
  } else {
    const radius = Math.min(count - 1, Math.ceil(4 * style.soften / dx));
    const weights = new Float32Array(radius * 2 + 1);
    let weightSum = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const x = offset * dx;
      const weight = Math.exp(-0.5 * x * x / (style.soften * style.soften));
      weights[offset + radius] = weight;
      weightSum += weight;
    }
    for (let index = 0; index < count; index += 1) {
      let sum = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sample = index - offset;
        if (sample >= 0 && sample < count) {
          sum += base[sample] * weights[offset + radius];
        }
      }
      blurred[index] = sum / weightSum;
    }
  }
  const bytes = new Uint8Array(count * 2);
  let height = 0;
  let maximumSlope = 0;
  for (let index = 0; index < count; index += 1) {
    maximumSlope = Math.max(maximumSlope, blurred[index]);
    if (index > 0) {
      height += 0.5 * (blurred[index - 1] + blurred[index]) * dx / style.size;
    }
    bytes[index * 2] = Math.round(255 * clamp(height, 0, 1));
    bytes[index * 2 + 1] = Math.round(255 * Math.sqrt(clamp(blurred[index] / 4, 0, 1)));
  }
  return { bytes, extent, slopeMax: 4, maximumSlope, terminalHeight: height };
}


interface ContourPoint {
  x: number;
  y: number;
  corner?: boolean;
}

interface SplineRun {
  points: readonly ContourPoint[];
  second: Float64Array;
}

const RASTER_BEVEL_CONTOUR_POINTS: Readonly<Record<RasterBevelContour, readonly ContourPoint[]>>
  = Object.freeze({
    linear: Object.freeze([{ x: 0, y: 0 }, { x: 1, y: 1 }]),
    cone: Object.freeze([
      { x: 0, y: 0 },
      { x: 0.5, y: 1, corner: true },
      { x: 1, y: 0 },
    ]),
    gaussian: Object.freeze([
      { x: 0, y: 0 },
      { x: 0.25, y: 0.06 },
      { x: 0.75, y: 0.94 },
      { x: 1, y: 1 },
    ]),
    ring: Object.freeze([
      { x: 0, y: 0 },
      { x: 0.25, y: 1 },
      { x: 0.5, y: 0.1 },
      { x: 0.75, y: 0.9 },
      { x: 1, y: 1 },
    ]),
  });

function splineRuns(points: readonly ContourPoint[]): SplineRun[] {
  const runs: ContourPoint[][] = [[points[0]]];
  for (let index = 1; index < points.length; index += 1) {
    runs[runs.length - 1].push(points[index]);
    if (points[index].corner && index < points.length - 1) {
      runs.push([points[index]]);
    }
  }
  return runs.map((values) => {
    const count = values.length;
    const second = new Float64Array(count);
    if (count >= 3) {
      const lower = new Float64Array(count);
      const diagonal = new Float64Array(count);
      const upper = new Float64Array(count);
      const rhs = new Float64Array(count);
      diagonal[0] = 1;
      diagonal[count - 1] = 1;
      for (let index = 1; index < count - 1; index += 1) {
        const h0 = values[index].x - values[index - 1].x;
        const h1 = values[index + 1].x - values[index].x;
        lower[index] = h0;
        diagonal[index] = 2 * (h0 + h1);
        upper[index] = h1;
        rhs[index] = 6 * (
          (values[index + 1].y - values[index].y) / h1
          - (values[index].y - values[index - 1].y) / h0
        );
      }
      for (let index = 1; index < count; index += 1) {
        const factor = lower[index] / diagonal[index - 1];
        diagonal[index] -= factor * upper[index - 1];
        rhs[index] -= factor * rhs[index - 1];
      }
      for (let index = count - 2; index >= 1; index -= 1) {
        second[index] = (
          rhs[index] - upper[index] * second[index + 1]
        ) / diagonal[index];
      }
    }
    return { points: values, second };
  });
}

function evaluateSplineRun(run: SplineRun, x: number): number {
  const points = run.points;
  if (x <= points[0].x) {
    return points[0].y;
  }
  if (x >= points[points.length - 1].x) {
    return points[points.length - 1].y;
  }
  let index = 0;
  while (x > points[index + 1].x) {
    index += 1;
  }
  const h = points[index + 1].x - points[index].x;
  const t = (x - points[index].x) / h;
  return (1 - t) * points[index].y
    + t * points[index + 1].y
    + h * h / 6 * (
      (1 - t) * ((1 - t) ** 2 - 1) * run.second[index]
      + t * (t * t - 1) * run.second[index + 1]
    );
}

export function makeRasterBevelSplineContourLut(
  sourceKind: RasterBevelContour | RasterBevelGloss = "linear",
  requestedCount = RASTER_BEVEL_PROFILE_SIZE,
): Float32Array {
  const mappedKind = sourceKind === "soft" ? "gaussian" : sourceKind;
  const kind: RasterBevelContour = includes(RASTER_BEVEL_CONTOURS, mappedKind)
    ? mappedKind
    : "linear";
  const count = Math.max(2, Math.trunc(finite(requestedCount, RASTER_BEVEL_PROFILE_SIZE)));
  const runs = splineRuns(RASTER_BEVEL_CONTOUR_POINTS[kind]);
  const values = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    const x = index / (count - 1);
    const run = runs.find((candidate) =>
      x <= candidate.points[candidate.points.length - 1].x + 1e-9)
      ?? runs[runs.length - 1];
    values[index] = clamp(evaluateSplineRun(run, x), 0, 1);
  }
  return values;
}

function legacyContourValue(kind: RasterBevelGloss, rho: number): number {
  const magnitude = Math.abs(rho);
  const sign = Math.sign(rho);
  if (kind === "soft") return sign * Math.sqrt(magnitude);
  if (kind === "cone") return Math.sin(rho * Math.PI * 0.5);
  if (kind === "ring") return Math.sin(rho * Math.PI * 2.5) * Math.min(1, magnitude * 1.35);
  return rho;
}

export function makeRasterBevelGlossLut(
  requestedKind: RasterBevelGloss = "linear",
): Uint8Array {
  const kind = includes(RASTER_BEVEL_GLOSSES, requestedKind)
    ? requestedKind
    : "linear";
  const bytes = new Uint8Array(RASTER_BEVEL_GLOSS_SIZE * 2);
  for (let index = 0; index < RASTER_BEVEL_GLOSS_SIZE; index += 1) {
    const rho = index / (RASTER_BEVEL_GLOSS_SIZE - 1) * 2 - 1;
    const value = clamp(legacyContourValue(kind, rho), -1, 1);
    bytes[index * 2] = Math.round(255 * Math.max(value, 0));
    bytes[index * 2 + 1] = Math.round(255 * Math.max(-value, 0));
  }
  return bytes;
}

export function makeRasterBevelDirectionLut(): Uint8Array {
  const bytes = new Uint8Array(RASTER_BEVEL_DIRECTION_COUNT * 2);
  for (let index = 0; index < RASTER_BEVEL_DIRECTION_COUNT; index += 1) {
    const angle = index * Math.PI * 2 / RASTER_BEVEL_DIRECTION_COUNT;
    bytes[index * 2] = Math.round(255 * (Math.cos(angle) * 0.5 + 0.5));
    bytes[index * 2 + 1] = Math.round(255 * (Math.sin(angle) * 0.5 + 0.5));
  }
  return bytes;
}

export interface RasterBevelPackedFieldSample {
  distance: readonly [number, number];
  aux: number;
  inside: boolean;
  magnitude: number;
  directionIndex: number;
}

export interface RasterBevelUnpackedFieldSample {
  inside: boolean;
  magnitude: number;
  directionIndex: number;
  direction: readonly [number, number];
}

export function packRasterBevelFieldSample({
  magnitude: requestedMagnitude = 0,
  inside = false,
  direction = [1, 0] as readonly [number, number],
}: {
  magnitude?: number;
  inside?: boolean;
  direction?: readonly number[];
} = {}): RasterBevelPackedFieldSample {
  const magnitude = Math.max(0, finite(requestedMagnitude, 0));
  let x = finite(direction[0], 0);
  let y = finite(direction[1], 0);
  let length = Math.hypot(x, y);
  if (length <= 1e-12) {
    x = 1;
    y = 0;
    length = 1;
  }
  x /= length;
  y /= length;
  let angle = Math.atan2(y, x);
  if (angle < 0) angle += Math.PI * 2;
  const directionIndex = Math.round(
    angle * RASTER_BEVEL_DIRECTION_COUNT / (Math.PI * 2),
  ) & (RASTER_BEVEL_DIRECTION_COUNT - 1);
  const fixed = Math.min(
    RASTER_BEVEL_DISTANCE_MASK,
    Math.round(magnitude * RASTER_BEVEL_DISTANCE_SCALE),
  );
  const packedDistance = fixed
    | (inside ? RASTER_BEVEL_DISTANCE_SIGN_BIT : 0)
    | ((directionIndex >>> 8) << RASTER_BEVEL_DISTANCE_DIRECTION_SHIFT);
  return {
    distance: [packedDistance & 255, packedDistance >>> 8],
    aux: directionIndex & 255,
    inside: Boolean(inside),
    magnitude: fixed / RASTER_BEVEL_DISTANCE_SCALE,
    directionIndex,
  };
}

export function unpackRasterBevelFieldSample(
  distance: readonly number[],
  aux = 0,
): RasterBevelUnpackedFieldSample {
  const low = clamp(Math.trunc(finite(distance?.[0], 0)), 0, 255);
  const high = clamp(Math.trunc(finite(distance?.[1], 0)), 0, 255);
  const packedDistance = low | (high << 8);
  const inside = Boolean(packedDistance & RASTER_BEVEL_DISTANCE_SIGN_BIT);
  const directionLow = clamp(Math.trunc(finite(aux, 0)), 0, 255);
  const directionIndex = directionLow
    | ((packedDistance >>> RASTER_BEVEL_DISTANCE_DIRECTION_SHIFT) << 8);
  const angle = directionIndex * Math.PI * 2 / RASTER_BEVEL_DIRECTION_COUNT;
  return {
    inside,
    magnitude: (packedDistance & RASTER_BEVEL_DISTANCE_MASK) / RASTER_BEVEL_DISTANCE_SCALE,
    directionIndex,
    direction: [Math.cos(angle), Math.sin(angle)],
  };
}

export function rasterBevelScharrGradient(
  sample: (x: number, y: number) => unknown,
  x = 0,
  y = 0,
): readonly [number, number] {
  if (typeof sample !== "function") {
    throw new TypeError("sampler distanza Smusso non valido");
  }
  const at = (dx: number, dy: number): number => finite(sample(x + dx, y + dy), 0);
  const nw = at(-1, 1);
  const n = at(0, 1);
  const ne = at(1, 1);
  const w = at(-1, 0);
  const e = at(1, 0);
  const sw = at(-1, -1);
  const s = at(0, -1);
  const se = at(1, -1);
  return [
    (3 * (ne - nw) + 10 * (e - w) + 3 * (se - sw)) / 32,
    (3 * (nw - sw) + 10 * (n - s) + 3 * (ne - se)) / 32,
  ];
}

export function rasterBevelFilteredGradient(
  sample: (x: number, y: number) => unknown,
  x = 0,
  y = 0,
  requestedSpan = 6,
): readonly [number, number] {
  if (typeof sample !== "function") {
    throw new TypeError("sampler distanza Smusso non valido");
  }
  const span = Math.max(1, Math.trunc(finite(requestedSpan, 6)));
  const at = (dx: number, dy: number): number => finite(sample(x + dx, y + dy), 0);
  let gradientX = 0;
  let gradientY = 0;
  for (let offset = -1; offset <= 1; offset += 1) {
    const weight = offset === 0 ? 2 : 1;
    gradientX += weight * (at(span, offset) - at(-span, offset));
    gradientY += weight * (at(offset, span) - at(offset, -span));
  }
  return [gradientX / (8 * span), gradientY / (8 * span)];
}

export interface RasterBevelQueuedValue<T extends object> {
  value: T;
  generation: number;
}

export function createLatestWinsBevelQueue<T extends object>() {
  let generation = 0;
  let pending: RasterBevelQueuedValue<T> | null = null;
  let cancelledGenerations = 0;
  const clone = (entry: RasterBevelQueuedValue<T>): T & { generation: number } => ({
    ...entry.value,
    generation: entry.generation,
  });
  return {
    enqueue(value: T): T & { generation: number } {
      if (pending) cancelledGenerations += 1;
      pending = { value, generation: ++generation };
      return clone(pending);
    },
    cancel(): boolean {
      if (!pending) return false;
      pending = null;
      generation += 1;
      cancelledGenerations += 1;
      return true;
    },
    take(): (T & { generation: number }) | null {
      const value = pending;
      pending = null;
      return value ? clone(value) : null;
    },
    peek(): (T & { generation: number }) | null {
      return pending ? clone(pending) : null;
    },
    generation(): number {
      return generation;
    },
    cancelledGenerations(): number {
      return cancelledGenerations;
    },
  };
}

