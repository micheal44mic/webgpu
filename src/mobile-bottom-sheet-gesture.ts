export type MobileBottomSheetSnap = "minimized" | "peek" | "expanded";

export interface MobileBottomSheetDragDecisionOptions {
  readonly startSnap: MobileBottomSheetSnap;
  readonly deltaY: number;
  readonly releaseVelocityY: number;
  readonly offsetPx: number;
  readonly peekOffsetPx: number;
  readonly minimizedOffsetPx: number;
}

export const MOBILE_BOTTOM_SHEET_STEP_DISTANCE_PX = 36;
export const MOBILE_BOTTOM_SHEET_DIRECT_CLOSE_FLICK_DISTANCE_PX = 28;
export const MOBILE_BOTTOM_SHEET_DIRECT_CLOSE_FLICK_VELOCITY_PX_PER_MS = 0.9;
export const MOBILE_BOTTOM_SHEET_UPWARD_FLICK_VELOCITY_PX_PER_MS = -0.45;
export const MOBILE_BOTTOM_SHEET_MIN_PEEK_PX = 160;
export const MOBILE_BOTTOM_SHEET_MAX_PEEK_PX = 240;
export const MOBILE_BOTTOM_SHEET_PEEK_VIEWPORT_RATIO = 0.26;

export function mobileBottomSheetPeekHeight(viewportHeight: number): number {
  return Math.min(
    MOBILE_BOTTOM_SHEET_MAX_PEEK_PX,
    Math.max(
      MOBILE_BOTTOM_SHEET_MIN_PEEK_PX,
      viewportHeight * MOBILE_BOTTOM_SHEET_PEEK_VIEWPORT_RATIO,
    ),
  );
}

/**
 * Shared three-detent gesture used by persistent mobile tool/effect sheets.
 * A slow downward gesture preserves the sheet at the next lower detent; only
 * a second gesture from minimized, or a deliberate fast flick, closes it.
 */
export function resolveMobileBottomSheetDrag(
  options: MobileBottomSheetDragDecisionOptions,
): "closed" | MobileBottomSheetSnap {
  const directCloseFlick = options.deltaY
    >= MOBILE_BOTTOM_SHEET_DIRECT_CLOSE_FLICK_DISTANCE_PX
    && options.releaseVelocityY
      >= MOBILE_BOTTOM_SHEET_DIRECT_CLOSE_FLICK_VELOCITY_PX_PER_MS;
  if (directCloseFlick) return "closed";

  if (options.startSnap === "minimized") {
    if (options.deltaY >= MOBILE_BOTTOM_SHEET_STEP_DISTANCE_PX) return "closed";
    if (
      options.deltaY <= -MOBILE_BOTTOM_SHEET_STEP_DISTANCE_PX
      || options.releaseVelocityY <= MOBILE_BOTTOM_SHEET_UPWARD_FLICK_VELOCITY_PX_PER_MS
    ) {
      return "peek";
    }
    return "minimized";
  }

  if (options.startSnap === "peek") {
    if (
      options.deltaY <= -MOBILE_BOTTOM_SHEET_STEP_DISTANCE_PX
      || options.releaseVelocityY <= MOBILE_BOTTOM_SHEET_UPWARD_FLICK_VELOCITY_PX_PER_MS
    ) {
      return "expanded";
    }
    if (options.deltaY >= MOBILE_BOTTOM_SHEET_STEP_DISTANCE_PX) {
      return "minimized";
    }
    return "peek";
  }

  if (options.deltaY < MOBILE_BOTTOM_SHEET_STEP_DISTANCE_PX) return "expanded";
  const minimizedBoundary = (
    options.peekOffsetPx + options.minimizedOffsetPx
  ) * 0.5;
  return options.offsetPx >= minimizedBoundary ? "minimized" : "peek";
}

export function nextMobileBottomSheetTapSnap(
  snap: MobileBottomSheetSnap,
): MobileBottomSheetSnap {
  if (snap === "minimized") return "peek";
  return snap === "peek" ? "expanded" : "peek";
}
