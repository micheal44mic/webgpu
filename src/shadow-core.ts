export const RASTER_SHADOW_CORE_BUILD =
  "raster-shadow-core-webgpu-v2-morphology-then-adaptive-tent";

export const RASTER_SHADOW_TILE_SIZE = 256;
export const RASTER_SHADOW_MAX_SIZE = 250;
export const RASTER_SHADOW_MAX_DISTANCE = 1024;
export const RASTER_SHADOW_MAX_NOISE = 100;

export const RASTER_SHADOW_BLEND_MODES = ["normal", "multiply"] as const;
export const RASTER_SHADOW_CONTOURS = [
  "linear",
  "cone",
  "gaussian",
  "ring",
] as const;

export type RasterShadowBlendMode = (typeof RASTER_SHADOW_BLEND_MODES)[number];
export type RasterShadowContour = (typeof RASTER_SHADOW_CONTOURS)[number];
export type RasterShadowColor = readonly [number, number, number];
export type RasterShadowKind = "outer" | "inner";

export interface RasterOuterShadowStyle {
  enabled: boolean;
  blendMode: RasterShadowBlendMode;
  color: RasterShadowColor;
  opacity: number;
  angle: number;
  useGlobalLight: boolean;
  distance: number;
  spread: number;
  size: number;
  contour: RasterShadowContour;
  contourAA: boolean;
  noise: number;
  layerKnocksOut: boolean;
}

export interface RasterInnerShadowStyle {
  enabled: boolean;
  blendMode: RasterShadowBlendMode;
  color: RasterShadowColor;
  opacity: number;
  angle: number;
  useGlobalLight: boolean;
  distance: number;
  choke: number;
  size: number;
  contour: RasterShadowContour;
  contourAA: boolean;
  noise: number;
}

export interface RasterShadowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RasterShadowKernel {
  morphologyRadius: number;
  blurRadius: number;
  sigma: number;
  influenceRadius: number;
}

export interface RasterShadowStyleChange {
  changed: boolean;
  matteChanged: boolean;
  composeOnly: boolean;
  release: boolean;
}

const DEFAULT_SHADOW_COLOR: RasterShadowColor = [0, 0, 0];

export const DEFAULT_RASTER_OUTER_SHADOW_STYLE:
Readonly<RasterOuterShadowStyle> = Object.freeze({
  enabled: false,
  blendMode: "multiply",
  color: DEFAULT_SHADOW_COLOR,
  opacity: 75,
  angle: 120,
  useGlobalLight: false,
  distance: 5,
  spread: 0,
  size: 5,
  contour: "linear",
  contourAA: true,
  noise: 0,
  layerKnocksOut: true,
});

export const DEFAULT_RASTER_INNER_SHADOW_STYLE:
Readonly<RasterInnerShadowStyle> = Object.freeze({
  enabled: false,
  blendMode: "multiply",
  color: DEFAULT_SHADOW_COLOR,
  opacity: 75,
  angle: 120,
  useGlobalLight: false,
  distance: 5,
  choke: 0,
  size: 5,
  contour: "linear",
  contourAA: true,
  noise: 0,
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

function normalizeAngle(value: unknown, fallback: number): number {
  return ((finite(value, fallback) % 360) + 360) % 360;
}

function normalizeColor(
  value: unknown,
  fallback: RasterShadowColor,
): RasterShadowColor {
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

function normalizeCommon<T extends {
  enabled: boolean;
  blendMode: RasterShadowBlendMode;
  color: RasterShadowColor;
  opacity: number;
  angle: number;
  useGlobalLight: boolean;
  distance: number;
  size: number;
  contour: RasterShadowContour;
  contourAA: boolean;
  noise: number;
}>(
  source: unknown,
  fallback: T,
): Omit<T, never> {
  const value: Partial<T> = source && typeof source === "object"
    ? source as Partial<T>
    : {};
  return {
    ...fallback,
    enabled: value.enabled === true,
    blendMode: includes(RASTER_SHADOW_BLEND_MODES, value.blendMode)
      ? value.blendMode
      : fallback.blendMode,
    color: normalizeColor(value.color, fallback.color),
    opacity: clamp(finite(value.opacity, fallback.opacity), 0, 100),
    angle: normalizeAngle(value.angle, fallback.angle),
    useGlobalLight: value.useGlobalLight === true,
    distance: clamp(
      finite(value.distance, fallback.distance),
      0,
      RASTER_SHADOW_MAX_DISTANCE,
    ),
    size: clamp(finite(value.size, fallback.size), 0, RASTER_SHADOW_MAX_SIZE),
    contour: includes(RASTER_SHADOW_CONTOURS, value.contour)
      ? value.contour
      : fallback.contour,
    contourAA: value.contourAA !== false,
    noise: clamp(finite(value.noise, fallback.noise), 0, RASTER_SHADOW_MAX_NOISE),
  };
}

export function normalizeRasterOuterShadowStyle(
  source: unknown = {},
): RasterOuterShadowStyle {
  const value = source && typeof source === "object"
    ? source as Partial<RasterOuterShadowStyle>
    : {};
  return {
    ...normalizeCommon(source, DEFAULT_RASTER_OUTER_SHADOW_STYLE),
    spread: clamp(
      finite(value.spread, DEFAULT_RASTER_OUTER_SHADOW_STYLE.spread),
      0,
      100,
    ),
    layerKnocksOut: value.layerKnocksOut !== false,
  };
}

export function normalizeRasterInnerShadowStyle(
  source: unknown = {},
): RasterInnerShadowStyle {
  const value = source && typeof source === "object"
    ? source as Partial<RasterInnerShadowStyle>
    : {};
  return {
    ...normalizeCommon(source, DEFAULT_RASTER_INNER_SHADOW_STYLE),
    choke: clamp(
      finite(value.choke, DEFAULT_RASTER_INNER_SHADOW_STYLE.choke),
      0,
      100,
    ),
  };
}

export function copyRasterOuterShadowStyle(
  source: unknown = {},
): RasterOuterShadowStyle {
  const value = normalizeRasterOuterShadowStyle(source);
  return {
    ...value,
    color: [...value.color] as [number, number, number],
  };
}

export function copyRasterInnerShadowStyle(
  source: unknown = {},
): RasterInnerShadowStyle {
  const value = normalizeRasterInnerShadowStyle(source);
  return {
    ...value,
    color: [...value.color] as [number, number, number],
  };
}

function commonStylesEqual(
  left: RasterOuterShadowStyle | RasterInnerShadowStyle,
  right: RasterOuterShadowStyle | RasterInnerShadowStyle,
): boolean {
  return left.enabled === right.enabled
    && left.blendMode === right.blendMode
    && left.opacity === right.opacity
    && left.angle === right.angle
    && left.useGlobalLight === right.useGlobalLight
    && left.distance === right.distance
    && left.size === right.size
    && left.contour === right.contour
    && left.contourAA === right.contourAA
    && left.noise === right.noise
    && left.color.every((channel, index) => channel === right.color[index]);
}

export function rasterOuterShadowStylesEqual(
  left: unknown,
  right: unknown,
): boolean {
  const a = normalizeRasterOuterShadowStyle(left);
  const b = normalizeRasterOuterShadowStyle(right);
  return commonStylesEqual(a, b)
    && a.spread === b.spread
    && a.layerKnocksOut === b.layerKnocksOut;
}

export function rasterInnerShadowStylesEqual(
  left: unknown,
  right: unknown,
): boolean {
  const a = normalizeRasterInnerShadowStyle(left);
  const b = normalizeRasterInnerShadowStyle(right);
  return commonStylesEqual(a, b) && a.choke === b.choke;
}

export function rasterOuterShadowIsBlackMultiply(
  source: unknown,
): boolean {
  const style = normalizeRasterOuterShadowStyle(source);
  return style.blendMode === "multiply"
    && style.color.every((channel) => channel === 0);
}

export function rasterOuterShadowUsesSupportedBlend(
  source: unknown,
): boolean {
  const style = normalizeRasterOuterShadowStyle(source);
  return style.blendMode === "normal" || rasterOuterShadowIsBlackMultiply(style);
}

function kernel(size: number, hardnessPercent: number): RasterShadowKernel {
  const normalizedSize = clamp(
    finite(size, 0),
    0,
    RASTER_SHADOW_MAX_SIZE,
  );
  const hardness = clamp(finite(hardnessPercent, 0) / 100, 0, 1);
  const morphologyRadius = Math.round(normalizedSize * hardness);
  const blurExtent = Math.max(0, normalizedSize - morphologyRadius);
  const blurRadius = Math.ceil(blurExtent);
  return {
    morphologyRadius,
    blurRadius,
    sigma: blurRadius > 0 ? Math.max(0.3, blurExtent / 3) : 0,
    influenceRadius: morphologyRadius + blurRadius,
  };
}

export function rasterOuterShadowKernel(
  source: unknown,
): RasterShadowKernel {
  const style = normalizeRasterOuterShadowStyle(source);
  return kernel(style.size, style.spread);
}

export function rasterInnerShadowKernel(
  source: unknown,
): RasterShadowKernel {
  const style = normalizeRasterInnerShadowStyle(source);
  return kernel(style.size, style.choke);
}

/**
 * Document coordinates use +Y downward. The 120° default therefore casts
 * toward the lower-right with this light-to-shadow mapping.
 * The sign remains a golden-locked calibration point rather than shader-local
 * magic.
 */
export function rasterShadowOffset(
  angle: unknown,
  distance: unknown,
): readonly [number, number] {
  const radians = normalizeAngle(angle, 120) * Math.PI / 180;
  const length = clamp(
    finite(distance, 0),
    0,
    RASTER_SHADOW_MAX_DISTANCE,
  );
  return [-Math.cos(radians) * length, Math.sin(radians) * length];
}

function normalizedRect(
  rect: RasterShadowRect | null | undefined,
  documentWidth: number,
  documentHeight: number,
): RasterShadowRect | null {
  if (!rect) {
    return null;
  }
  const x = clamp(Math.floor(rect.x), 0, documentWidth);
  const y = clamp(Math.floor(rect.y), 0, documentHeight);
  const right = clamp(Math.ceil(rect.x + rect.width), 0, documentWidth);
  const bottom = clamp(Math.ceil(rect.y + rect.height), 0, documentHeight);
  return right > x && bottom > y
    ? { x, y, width: right - x, height: bottom - y }
    : null;
}

function expandedRect(
  rect: RasterShadowRect | null | undefined,
  expandX: number,
  expandY: number,
  offsetX: number,
  offsetY: number,
  documentWidth: number,
  documentHeight: number,
): RasterShadowRect | null {
  if (!rect) {
    return null;
  }
  return normalizedRect({
    x: rect.x + offsetX - expandX,
    y: rect.y + offsetY - expandY,
    width: rect.width + expandX * 2,
    height: rect.height + expandY * 2,
  }, documentWidth, documentHeight);
}

/** Bounds of the unshifted persistent matte. */
export function rasterOuterShadowInfluenceBounds(
  rect: RasterShadowRect | null | undefined,
  source: unknown,
  documentWidth: number,
  documentHeight: number,
): RasterShadowRect | null {
  const style = normalizeRasterOuterShadowStyle(source);
  if (!style.enabled || !rect) {
    return null;
  }
  const radius = rasterOuterShadowKernel(style).influenceRadius;
  return expandedRect(
    rect,
    radius,
    radius,
    0,
    0,
    documentWidth,
    documentHeight,
  );
}

export function rasterInnerShadowInfluenceBounds(
  rect: RasterShadowRect | null | undefined,
  source: unknown,
  documentWidth: number,
  documentHeight: number,
): RasterShadowRect | null {
  const style = normalizeRasterInnerShadowStyle(source);
  if (!style.enabled || !rect) {
    return null;
  }
  const radius = rasterInnerShadowKernel(style).influenceRadius;
  return expandedRect(
    rect,
    radius,
    radius,
    0,
    0,
    documentWidth,
    documentHeight,
  );
}

/** Bounds dirtied in the final styled layer after applying the offset. */
export function rasterOuterShadowVisualBounds(
  rect: RasterShadowRect | null | undefined,
  source: unknown,
  documentWidth: number,
  documentHeight: number,
): RasterShadowRect | null {
  const style = normalizeRasterOuterShadowStyle(source);
  if (!style.enabled || !rect) {
    return null;
  }
  const radius = rasterOuterShadowKernel(style).influenceRadius + 1;
  const [offsetX, offsetY] = rasterShadowOffset(style.angle, style.distance);
  const shadowBounds = expandedRect(
    rect,
    radius,
    radius,
    offsetX,
    offsetY,
    documentWidth,
    documentHeight,
  );
  const sourceBounds = normalizedRect(rect, documentWidth, documentHeight);
  if (!shadowBounds) {
    return sourceBounds;
  }
  if (!sourceBounds) {
    return shadowBounds;
  }
  const x = Math.min(sourceBounds.x, shadowBounds.x);
  const y = Math.min(sourceBounds.y, shadowBounds.y);
  const right = Math.max(
    sourceBounds.x + sourceBounds.width,
    shadowBounds.x + shadowBounds.width,
  );
  const bottom = Math.max(
    sourceBounds.y + sourceBounds.height,
    shadowBounds.y + shadowBounds.height,
  );
  return { x, y, width: right - x, height: bottom - y };
}

export function rasterInnerShadowVisualBounds(
  rect: RasterShadowRect | null | undefined,
  source: unknown,
  documentWidth: number,
  documentHeight: number,
): RasterShadowRect | null {
  const style = normalizeRasterInnerShadowStyle(source);
  return style.enabled
    ? normalizedRect(rect, documentWidth, documentHeight)
    : null;
}

function commonMatteKey(
  style: RasterOuterShadowStyle | RasterInnerShadowStyle,
  hardness: number,
): string {
  return [style.enabled ? 1 : 0, style.size, hardness].join("|");
}

export function classifyRasterOuterShadowStyleChange(
  before: unknown,
  after: unknown,
): RasterShadowStyleChange {
  const left = normalizeRasterOuterShadowStyle(before);
  const right = normalizeRasterOuterShadowStyle(after);
  const matteChanged = commonMatteKey(left, left.spread)
    !== commonMatteKey(right, right.spread);
  const changed = !rasterOuterShadowStylesEqual(left, right);
  return {
    changed,
    matteChanged,
    composeOnly: changed && !matteChanged,
    release: left.enabled && !right.enabled,
  };
}

export function classifyRasterInnerShadowStyleChange(
  before: unknown,
  after: unknown,
): RasterShadowStyleChange {
  const left = normalizeRasterInnerShadowStyle(before);
  const right = normalizeRasterInnerShadowStyle(after);
  const matteChanged = commonMatteKey(left, left.choke)
    !== commonMatteKey(right, right.choke);
  const changed = !rasterInnerShadowStylesEqual(left, right);
  return {
    changed,
    matteChanged,
    composeOnly: changed && !matteChanged,
    release: left.enabled && !right.enabled,
  };
}
