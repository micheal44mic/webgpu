import type { DirtyRect } from "./engine-stroke-types";

export interface DeferredErasePreviewPlanInput {
  totalStampCount: number;
  presentedStampCount: number;
  previousPresentedRect: DirtyRect | null;
  nextDirtyRect: DirtyRect;
  forceRebuild: boolean;
  textureChanged: boolean;
  textureWidth: number;
  textureHeight: number;
  previousOriginX: number;
  previousOriginY: number;
  documentWidth: number;
  documentHeight: number;
}

export interface DeferredErasePreviewPlan {
  rebuild: boolean;
  stampStart: number;
  presentedRect: DirtyRect;
  originX: number;
  originY: number;
}

export interface DeferredPreviewTextureExtentInput {
  currentExtent: number;
  requiredExtent: number;
  maximumExtent: number;
  quantum: number;
  allowShrink: boolean;
}

function mergeRects(left: DirtyRect | null, right: DirtyRect): DirtyRect {
  if (!left) return { ...right };
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const rightEdge = Math.max(left.x + left.width, right.x + right.width);
  const bottomEdge = Math.max(left.y + left.height, right.y + right.height);
  return { x, y, width: rightEdge - x, height: bottomEdge - y };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function centeredOrigin(
  start: number,
  extent: number,
  textureExtent: number,
  documentExtent: number,
): number {
  return clamp(
    Math.floor(start + extent * 0.5 - textureExtent * 0.5),
    0,
    Math.max(0, documentExtent - textureExtent),
  );
}

function rectFitsTexture(
  rect: DirtyRect,
  originX: number,
  originY: number,
  textureWidth: number,
  textureHeight: number,
): boolean {
  return rect.x >= originX
    && rect.y >= originY
    && rect.x + rect.width <= originX + textureWidth
    && rect.y + rect.height <= originY + textureHeight;
}

/** Gives a growing Eraser ROI enough travel room without doubling huge tips. */
export function deferredEraseTextureMinimum(
  contentExtent: number,
  maximumExtent: number,
): number {
  const extent = Math.max(1, Math.ceil(contentExtent));
  return Math.min(maximumExtent, extent + Math.min(512, extent));
}

/**
 * Grows the transient texture geometrically and optionally drops an old,
 * heavily oversized allocation at the start of a new gesture.
 */
export function planDeferredPreviewTextureExtent(
  input: DeferredPreviewTextureExtentInput,
): number {
  const maximum = Math.max(1, Math.floor(input.maximumExtent));
  const quantum = Math.max(1, Math.floor(input.quantum));
  const minimum = Math.min(quantum, maximum);
  const required = clamp(
    Math.ceil(Math.max(1, input.requiredExtent) / quantum) * quantum,
    minimum,
    maximum,
  );
  const current = clamp(Math.floor(input.currentExtent), 0, maximum);
  if (current <= 0) return required;
  if (input.allowShrink && current > Math.min(maximum, required * 2)) {
    return required;
  }
  if (current >= required) return current;
  return Math.min(maximum, Math.max(required, current * 2));
}

/**
 * Chooses whether the non-destructive Eraser surface can accept only the new
 * stamps or must be rebuilt from its permanent-layer snapshot. The steady
 * state is one new upload/draw per stamp; full replay is reserved for resource
 * growth, ROI relocation and Quick Line geometry replacement.
 */
export function planDeferredErasePreview(
  input: DeferredErasePreviewPlanInput,
): DeferredErasePreviewPlan {
  const presentedRect = mergeRects(input.previousPresentedRect, input.nextDirtyRect);
  const previousPresentationValid = input.presentedStampCount > 0
    && input.presentedStampCount <= input.totalStampCount
    && input.previousPresentedRect !== null
    && !input.forceRebuild
    && !input.textureChanged;
  const rebuild = !previousPresentationValid || !rectFitsTexture(
    presentedRect,
    input.previousOriginX,
    input.previousOriginY,
    input.textureWidth,
    input.textureHeight,
  );

  return {
    rebuild,
    stampStart: rebuild ? 0 : input.presentedStampCount,
    presentedRect,
    originX: rebuild
      ? centeredOrigin(
        presentedRect.x,
        presentedRect.width,
        input.textureWidth,
        input.documentWidth,
      )
      : input.previousOriginX,
    originY: rebuild
      ? centeredOrigin(
        presentedRect.y,
        presentedRect.height,
        input.textureHeight,
        input.documentHeight,
      )
      : input.previousOriginY,
  };
}
