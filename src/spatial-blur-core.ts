import {
  DESTRUCTIVE_GAUSSIAN_BLUR_DEFAULT_RADIUS,
  DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS,
  DESTRUCTIVE_GAUSSIAN_BLUR_RADIUS_STEP,
  destructiveGaussianBlurBounds,
  destructiveGaussianBlurKernel,
  normalizeDestructiveGaussianBlurRadius,
} from "./gaussian-blur-core";

export const SPATIAL_BLUR_CORE_BUILD =
  "spatial-blur-core-v3-inverse-square-pin-field" as const;

export const SPATIAL_BLUR_DEFAULT_RADIUS = DESTRUCTIVE_GAUSSIAN_BLUR_DEFAULT_RADIUS;
export const SPATIAL_BLUR_MAX_RADIUS = DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS;
export const SPATIAL_BLUR_MAX_PIN_COUNT = 32;
export const SPATIAL_BLUR_PIN_RADIUS_STEP = DESTRUCTIVE_GAUSSIAN_BLUR_RADIUS_STEP;
export const SPATIAL_BLUR_RADIUS_QUANTIZATION = 4;

/** The point field selects radii; weight generation remains the shared blur kernel. */
export const spatialBlurGaussianKernel = destructiveGaussianBlurKernel;

export interface SpatialBlurPin {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export interface SpatialBlurRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function finite(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function normalizeSpatialBlurRadius(value: unknown): number {
  return normalizeDestructiveGaussianBlurRadius(value);
}

export function snapSpatialBlurPinRadius(value: unknown): number {
  const radius = normalizeSpatialBlurRadius(value);
  return Math.round(radius / SPATIAL_BLUR_PIN_RADIUS_STEP)
    * SPATIAL_BLUR_PIN_RADIUS_STEP;
}

export function createInitialSpatialBlurPin(
  documentWidth: number,
  documentHeight: number,
  radius: unknown = SPATIAL_BLUR_DEFAULT_RADIUS,
): SpatialBlurPin {
  return Object.freeze({
    x: Math.max(1, finite(documentWidth, 1)) * 0.5,
    y: Math.max(1, finite(documentHeight, 1)) * 0.5,
    radius: snapSpatialBlurPinRadius(radius),
  });
}

export function normalizeSpatialBlurPins(
  pins: readonly Readonly<SpatialBlurPin>[] | null | undefined,
  documentWidth: number,
  documentHeight: number,
): readonly SpatialBlurPin[] {
  const width = Math.max(1, finite(documentWidth, 1));
  const height = Math.max(1, finite(documentHeight, 1));
  const normalized: SpatialBlurPin[] = [];
  for (const pin of pins ?? []) {
    if (normalized.length >= SPATIAL_BLUR_MAX_PIN_COUNT) break;
    normalized.push(Object.freeze({
      x: clamp(finite(pin?.x, width * 0.5), 0, width),
      y: clamp(finite(pin?.y, height * 0.5), 0, height),
      radius: snapSpatialBlurPinRadius(pin?.radius),
    }));
  }
  return Object.freeze(normalized);
}

export function spatialBlurPinsEqual(
  left: readonly Readonly<SpatialBlurPin>[],
  right: readonly Readonly<SpatialBlurPin>[],
): boolean {
  return left.length === right.length && left.every((pin, index) => {
    const other = right[index];
    return pin.x === other.x && pin.y === other.y && pin.radius === other.radius;
  });
}

export function spatialBlurMaximumRadius(
  pins: readonly Readonly<SpatialBlurPin>[],
): number {
  let maximum = 0;
  for (const pin of pins) maximum = Math.max(maximum, snapSpatialBlurPinRadius(pin.radius));
  return maximum;
}

/** Inverse-square interpolation shared by pin inheritance and GPU tests. */
export function spatialBlurRadiusAt(
  pins: readonly Readonly<SpatialBlurPin>[],
  x: number,
  y: number,
  documentWidth: number,
  documentHeight: number,
): number {
  const normalized = normalizeSpatialBlurPins(pins, documentWidth, documentHeight);
  if (normalized.length === 0) return 0;
  const sampleX = finite(x, 0);
  const sampleY = finite(y, 0);
  let weightedRadius = 0;
  let weightSum = 0;
  for (const pin of normalized) {
    const dx = sampleX - pin.x;
    const dy = sampleY - pin.y;
    const distanceSquared = dx * dx + dy * dy;
    // Pixel centers can be half a pixel away on both axes. Covering d² = 0.5
    // guarantees that every pin owns its nearest raster sample exactly.
    if (distanceSquared <= 0.5) return pin.radius;
    const weight = 1 / distanceSquared;
    weightedRadius += pin.radius * weight;
    weightSum += weight;
  }
  return weightSum > 0 ? normalizeSpatialBlurRadius(weightedRadius / weightSum) : 0;
}

export function normalizeSpatialBlurRect(
  rect: SpatialBlurRect | null | undefined,
  documentWidth: number,
  documentHeight: number,
): SpatialBlurRect | null {
  if (!rect) return null;
  const width = Math.max(1, Math.floor(finite(documentWidth, 1)));
  const height = Math.max(1, Math.floor(finite(documentHeight, 1)));
  const x = clamp(Math.floor(finite(rect.x, 0)), 0, width);
  const y = clamp(Math.floor(finite(rect.y, 0)), 0, height);
  const right = clamp(
    Math.ceil(finite(rect.x, 0) + Math.max(0, finite(rect.width, 0))),
    0,
    width,
  );
  const bottom = clamp(
    Math.ceil(finite(rect.y, 0) + Math.max(0, finite(rect.height, 0))),
    0,
    height,
  );
  return right > x && bottom > y
    ? { x, y, width: right - x, height: bottom - y }
    : null;
}

export function spatialBlurBounds(
  contentBounds: SpatialBlurRect | null | undefined,
  radius: unknown,
  documentWidth: number,
  documentHeight: number,
): SpatialBlurRect | null {
  return destructiveGaussianBlurBounds(
    contentBounds,
    radius,
    documentWidth,
    documentHeight,
  );
}

export function unionSpatialBlurRects(
  left: SpatialBlurRect | null | undefined,
  right: SpatialBlurRect | null | undefined,
): SpatialBlurRect | null {
  if (!left) return right ? { ...right } : null;
  if (!right) return { ...left };
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const rightEdge = Math.max(left.x + left.width, right.x + right.width);
  const bottom = Math.max(left.y + left.height, right.y + right.height);
  return { x, y, width: rightEdge - x, height: bottom - y };
}
