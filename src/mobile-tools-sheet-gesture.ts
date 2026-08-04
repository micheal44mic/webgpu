export type MobileToolsSheetSnap = "peek" | "expanded";

export const MOBILE_TOOLS_SHEET_CLOSE_FLICK_MIN_DISTANCE_PX = 28;
export const MOBILE_TOOLS_SHEET_CLOSE_FLICK_MIN_VELOCITY_PX_PER_MS = 0.45;
export const MOBILE_TOOLS_SHEET_CLOSE_FROM_PEEK_DISTANCE_PX = 36;
export const MOBILE_TOOLS_SHEET_CLOSE_PAST_PEEK_DISTANCE_PX = 36;
export const MOBILE_TOOLS_SHEET_CLOSE_REMAINING_VISIBLE_PX = 48;

export interface MobileToolsSheetCloseGesture {
  readonly startSnap: MobileToolsSheetSnap;
  readonly deltaY: number;
  readonly releaseVelocityY: number;
  readonly offsetPx: number;
  readonly peekOffsetPx: number;
  readonly closedOffsetPx: number;
}

export function shouldCloseMobileToolsSheetDrag(
  gesture: MobileToolsSheetCloseGesture,
): boolean {
  const {
    startSnap,
    deltaY,
    releaseVelocityY,
    offsetPx,
    peekOffsetPx,
    closedOffsetPx,
  } = gesture;
  const closeThreshold = Math.max(
    peekOffsetPx,
    closedOffsetPx - MOBILE_TOOLS_SHEET_CLOSE_REMAINING_VISIBLE_PX,
  );
  const fastDownwardFlick = deltaY >= MOBILE_TOOLS_SHEET_CLOSE_FLICK_MIN_DISTANCE_PX
    && releaseVelocityY >= MOBILE_TOOLS_SHEET_CLOSE_FLICK_MIN_VELOCITY_PX_PER_MS;
  const pushedDownFromPeek = startSnap === "peek"
    && deltaY >= MOBILE_TOOLS_SHEET_CLOSE_FROM_PEEK_DISTANCE_PX;
  const draggedPastPeek = startSnap === "expanded"
    && offsetPx >= Math.min(
      closedOffsetPx,
      peekOffsetPx + MOBILE_TOOLS_SHEET_CLOSE_PAST_PEEK_DISTANCE_PX,
    );
  return offsetPx >= closeThreshold
    || fastDownwardFlick
    || pushedDownFromPeek
    || draggedPastPeek;
}
