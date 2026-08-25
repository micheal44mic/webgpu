import {
  SPATIAL_BLUR_MAX_RADIUS,
  normalizeSpatialBlurRadius,
  type SpatialBlurPin,
} from "./spatial-blur-core";

export const SPATIAL_BLUR_MODES = ["add", "adjust", "remove"] as const;
export type SpatialBlurMode = (typeof SPATIAL_BLUR_MODES)[number];

export const SPATIAL_BLUR_MOUSE_HIT_RADIUS_PX = 24;
export const SPATIAL_BLUR_TOUCH_HIT_RADIUS_PX = 30;
export const SPATIAL_BLUR_ADJUST_RATE = 2;
export const SPATIAL_BLUR_TAP_MOVE_THRESHOLD_PX = 8;

export interface SpatialBlurScreenPin extends SpatialBlurPin {
  readonly id: number;
  readonly clientX: number;
  readonly clientY: number;
}

export function isSpatialBlurMode(value: string | undefined): value is SpatialBlurMode {
  return value !== undefined
    && (SPATIAL_BLUR_MODES as readonly string[]).includes(value);
}

export function spatialBlurAdjustedRadius(
  initialRadius: unknown,
  initialClientY: number,
  currentClientY: number,
): number {
  return normalizeSpatialBlurRadius(
    Number(initialRadius)
      + (Number(initialClientY) - Number(currentClientY)) * SPATIAL_BLUR_ADJUST_RATE,
  );
}

export function spatialBlurPinFillPercent(radius: unknown): number {
  return normalizeSpatialBlurRadius(radius) / SPATIAL_BLUR_MAX_RADIUS * 100;
}

export function hitTestSpatialBlurPins(
  pins: readonly Readonly<SpatialBlurScreenPin>[],
  clientX: number,
  clientY: number,
  pointerType: string,
): number | null {
  const radius = pointerType === "touch"
    ? SPATIAL_BLUR_TOUCH_HIT_RADIUS_PX
    : SPATIAL_BLUR_MOUSE_HIT_RADIUS_PX;
  const radiusSquared = radius * radius;
  let closestId: number | null = null;
  let closestDistanceSquared = Number.POSITIVE_INFINITY;
  for (let index = pins.length - 1; index >= 0; index -= 1) {
    const pin = pins[index];
    const dx = clientX - pin.clientX;
    const dy = clientY - pin.clientY;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared <= radiusSquared && distanceSquared < closestDistanceSquared) {
      closestDistanceSquared = distanceSquared;
      closestId = pin.id;
    }
  }
  return closestId;
}

export function spatialBlurPointerMoved(
  initialClientX: number,
  initialClientY: number,
  currentClientX: number,
  currentClientY: number,
): boolean {
  return Math.hypot(
    currentClientX - initialClientX,
    currentClientY - initialClientY,
  ) > SPATIAL_BLUR_TAP_MOVE_THRESHOLD_PX;
}
