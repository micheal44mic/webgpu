import type { DirtyRect } from "./engine-stroke-types";

export interface MixedSceneCompositeViewport {
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly zoom: number;
  readonly rotationCos: number;
  readonly rotationSin: number;
}

export function intersectMixedSceneCompositeRects(
  first: Readonly<DirtyRect>,
  second: Readonly<DirtyRect>,
): DirtyRect | null {
  const left = Math.max(first.x, second.x);
  const top = Math.max(first.y, second.y);
  const right = Math.min(first.x + first.width, second.x + second.width);
  const bottom = Math.min(first.y + first.height, second.y + second.height);
  return right > left && bottom > top
    ? { x: left, y: top, width: right - left, height: bottom - top }
    : null;
}

export function paddedMixedSceneDocumentRect(
  bounds: Readonly<DirtyRect>,
  padding: number,
  documentWidth: number,
  documentHeight: number,
): DirtyRect | null {
  const safePadding = Math.max(0, Number.isFinite(padding) ? padding : 0);
  const left = Math.max(0, bounds.x - safePadding);
  const top = Math.max(0, bounds.y - safePadding);
  const right = Math.min(documentWidth, bounds.x + bounds.width + safePadding);
  const bottom = Math.min(documentHeight, bounds.y + bounds.height + safePadding);
  return right > left && bottom > top
    ? { x: left, y: top, width: right - left, height: bottom - top }
    : null;
}

/** Conservatively projects a document-space source rectangle into canvas pixels. */
export function mixedSceneDocumentRectToPresentationRect(
  viewport: Readonly<MixedSceneCompositeViewport>,
  bounds: Readonly<DirtyRect>,
  canvasPadding = 1,
): DirtyRect | null {
  if (
    viewport.canvasWidth <= 0
    || viewport.canvasHeight <= 0
    || !Number.isFinite(viewport.zoom)
    || viewport.zoom <= 0
    || bounds.width <= 0
    || bounds.height <= 0
  ) {
    return null;
  }
  const project = (x: number, y: number): { x: number; y: number } => {
    const deltaX = x - viewport.centerX;
    const deltaY = y - viewport.centerY;
    return {
      x: viewport.canvasWidth * 0.5
        + (viewport.rotationCos * deltaX - viewport.rotationSin * deltaY) * viewport.zoom,
      y: viewport.canvasHeight * 0.5
        + (viewport.rotationSin * deltaX + viewport.rotationCos * deltaY) * viewport.zoom,
    };
  };
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  const corners = [
    project(bounds.x, bounds.y),
    project(right, bounds.y),
    project(bounds.x, bottom),
    project(right, bottom),
  ];
  const padding = Math.max(0, Math.ceil(canvasPadding));
  const leftPx = Math.max(0, Math.floor(Math.min(...corners.map((point) => point.x))) - padding);
  const topPx = Math.max(0, Math.floor(Math.min(...corners.map((point) => point.y))) - padding);
  const rightPx = Math.min(
    viewport.canvasWidth,
    Math.ceil(Math.max(...corners.map((point) => point.x))) + padding,
  );
  const bottomPx = Math.min(
    viewport.canvasHeight,
    Math.ceil(Math.max(...corners.map((point) => point.y))) + padding,
  );
  return rightPx > leftPx && bottomPx > topPx
    ? { x: leftPx, y: topPx, width: rightPx - leftPx, height: bottomPx - topPx }
    : null;
}

/**
 * The active raster pyramid stores logical mip 1 at physical level 0. One
 * extra logical texel on both sides covers the bilinear footprint and mip
 * quantization, matching the established partial-presentation policy.
 */
export function activeRasterCompositeSamplingPadding(
  zoom: number,
  selectedMipLevel: number,
  maximumLogicalMipLevel: number,
): number {
  const safeMaximum = Math.max(0, Math.floor(maximumLogicalMipLevel));
  const continuousMip = Number.isFinite(zoom) && zoom > 0 && zoom < 1
    ? Math.log2(1 / zoom)
    : 0;
  const requiredMip = Math.min(
    safeMaximum,
    Math.max(
      0,
      Math.floor(selectedMipLevel),
      Math.ceil(continuousMip - 1e-6),
    ),
  );
  return Math.max(2, 2 ** (requiredMip + 1));
}
