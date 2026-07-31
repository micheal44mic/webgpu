

export const RASTER_BEVEL_TILE_SIZE = 256;
export const RASTER_BEVEL_NORMAL_APRON = 1;
export const RASTER_BEVEL_FIELD_IDLE_SHRINK_DELAY_MS = 1_500;
export const RASTER_BEVEL_FIELD_MINIMUM_SHRINK_BYTES = 8 * 1024 * 1024;
export const RASTER_BEVEL_MAX_RADIUS = 576;
export const RASTER_BEVEL_PROFILE_SIZE = 1024;

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

export type RasterBevelFieldTransitionKind = "retain" | "grow" | "shrink";

export interface RasterBevelFieldTransition {
  kind: RasterBevelFieldTransitionKind;
  allocationBounds: RasterBevelRect | null;
  validBounds: RasterBevelRect | null;
  reallocated: boolean;
  fullRebuild: boolean;
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

function copyRasterBevelRect(rect: RasterBevelRect | null): RasterBevelRect | null {
  return rect ? { ...rect } : null;
}

function rasterBevelRectsEqual(
  left: RasterBevelRect | null,
  right: RasterBevelRect | null,
): boolean {
  return left === right || Boolean(
    left
    && right
    && left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height,
  );
}

function rasterBevelRectContains(
  container: RasterBevelRect | null,
  candidate: RasterBevelRect | null,
): boolean {
  if (!candidate) {
    return true;
  }
  return Boolean(
    container
    && candidate.x >= container.x
    && candidate.y >= container.y
    && candidate.x + candidate.width <= container.x + container.width
    && candidate.y + candidate.height <= container.y + container.height,
  );
}

export function rasterBevelFieldMemoryBytes(
  bounds: RasterBevelRect | null,
): number {
  if (!bounds) {
    return 4;
  }
  return (bounds.width + RASTER_BEVEL_NORMAL_APRON * 2)
    * (bounds.height + RASTER_BEVEL_NORMAL_APRON * 2)
    * 4;
}

export function rasterBevelFieldShrinkIsWorthwhile(
  currentBounds: RasterBevelRect | null,
  targetBounds: RasterBevelRect | null,
): boolean {
  return rasterBevelFieldMemoryBytes(currentBounds)
    - rasterBevelFieldMemoryBytes(targetBounds)
    >= RASTER_BEVEL_FIELD_MINIMUM_SHRINK_BYTES;
}

export function planRasterBevelFieldTransition(
  currentAllocationBounds: RasterBevelRect | null,
  targetBounds: RasterBevelRect | null,
  allowShrink = false,
): RasterBevelFieldTransition {
  const allocationContainsTarget = rasterBevelRectContains(
    currentAllocationBounds,
    targetBounds,
  );
  const shrink = allocationContainsTarget
    && !rasterBevelRectsEqual(currentAllocationBounds, targetBounds)
    && allowShrink
    && rasterBevelFieldShrinkIsWorthwhile(currentAllocationBounds, targetBounds);
  const grow = !allocationContainsTarget;
  if (grow || shrink) {
    return {
      kind: shrink ? "shrink" : "grow",
      allocationBounds: copyRasterBevelRect(targetBounds),
      validBounds: copyRasterBevelRect(targetBounds),
      reallocated: true,
      fullRebuild: targetBounds !== null,
    };
  }
  return {
    kind: "retain",
    allocationBounds: copyRasterBevelRect(currentAllocationBounds),
    validBounds: copyRasterBevelRect(targetBounds),
    reallocated: false,
    fullRebuild: false,
  };
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

