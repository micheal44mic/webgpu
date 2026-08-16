/**
 * Arbitration between a one-finger Paint gesture and the first contact of a
 * two-finger navigation gesture. Only touch drawing input is eligible: pen,
 * mouse and Blend retain their immediate path.
 */
export const TOUCH_PAINT_INTENT_STRATEGY =
  "touch-paint-input-buffer-move-3-css-px-timeout-28ms-v1" as const;

export const TOUCH_PAINT_INTENT_HOLD_MS = 28;
export const TOUCH_PAINT_INTENT_MOVE_THRESHOLD_PX = 3;

export interface TouchPaintIntentPoint {
  readonly clientX: number;
  readonly clientY: number;
}

export function shouldHoldTouchPaintIntent(
  enabled: boolean,
  pointerType: string,
  activeTool: string,
): boolean {
  return enabled
    && pointerType === "touch"
    && (activeTool === "paint" || activeTool === "erase");
}

export function touchPaintIntentMovementReached(
  start: TouchPaintIntentPoint,
  samples: readonly TouchPaintIntentPoint[],
  thresholdPx = TOUCH_PAINT_INTENT_MOVE_THRESHOLD_PX,
): boolean {
  const safeThreshold = Number.isFinite(thresholdPx)
    ? Math.max(0, thresholdPx)
    : TOUCH_PAINT_INTENT_MOVE_THRESHOLD_PX;
  const thresholdSquared = safeThreshold * safeThreshold;
  for (const sample of samples) {
    const deltaX = sample.clientX - start.clientX;
    const deltaY = sample.clientY - start.clientY;
    if (deltaX * deltaX + deltaY * deltaY >= thresholdSquared) {
      return true;
    }
  }
  return false;
}
