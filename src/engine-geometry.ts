
import { type VectorTextGpuDraw, type VectorTextViewState } from "./vector-text-types";
import { type DirtyRect } from "./engine-stroke-types";
import { vectorTextGpuDrawUsesBlur, vectorTextGpuDrawUsesMesh } from "./engine-vector-text-resources";
import { clamp } from "./color";
import { DOCUMENT_HEIGHT, DOCUMENT_WIDTH } from "./engine-limits";/**
 * Geometria di supporto del motore: rettangoli sporchi, normalizzazione dei
 * rect di livello, dimensioni dei mip e bounding box dei run di testo. Funzioni
 * pure: nessuno stato, nessuna risorsa GPU.
 */

export function vectorTextGpuRunBounds(
  draws: readonly VectorTextGpuDraw[],
  view: VectorTextViewState,
): DirtyRect {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const draw of draws) {
    const cosine = Math.cos(draw.rotation);
    const sine = Math.sin(draw.rotation);
    const bounds = vectorTextGpuDrawUsesBlur(draw)
      ? draw.blurBounds
      : vectorTextGpuDrawUsesMesh(draw)
        ? [draw.mesh.left, draw.mesh.top, draw.mesh.right, draw.mesh.bottom] as const
        : [draw.slug.left, draw.slug.top, draw.slug.right, draw.slug.bottom] as const;
    const localCorners = [
      [bounds[0], bounds[1]],
      [bounds[2], bounds[1]],
      [bounds[2], bounds[3]],
      [bounds[0], bounds[3]],
    ] as const;
    for (const [sourceX, sourceY] of localCorners) {
      const localX = (sourceX + draw.localOffsetX) * draw.scale;
      const localY = (sourceY + draw.localOffsetY) * draw.scale;
      const layerX = draw.x + cosine * localX - sine * localY;
      const layerY = draw.y + sine * localX + cosine * localY;
      const deltaX = layerX - view.centerX;
      const deltaY = layerY - view.centerY;
      const canvasX = view.canvasWidth * 0.5 + view.zoom * (
        view.rotationCos * deltaX - view.rotationSin * deltaY
      );
      const canvasY = view.canvasHeight * 0.5 + view.zoom * (
        view.rotationSin * deltaX + view.rotationCos * deltaY
      );
      left = Math.min(left, canvasX);
      top = Math.min(top, canvasY);
      right = Math.max(right, canvasX);
      bottom = Math.max(bottom, canvasY);
    }
  }
  if (!Number.isFinite(left)) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  const margin = 2;
  const x = Math.max(0, Math.floor(left - margin));
  const y = Math.max(0, Math.floor(top - margin));
  const clippedRight = Math.min(view.canvasWidth, Math.ceil(right + margin));
  const clippedBottom = Math.min(view.canvasHeight, Math.ceil(bottom + margin));
  return {
    x: Math.min(view.canvasWidth - 1, x),
    y: Math.min(view.canvasHeight - 1, y),
    width: Math.max(1, clippedRight - x),
    height: Math.max(1, clippedBottom - y),
  };
}

export function vectorTextGpuClearBounds(
  first: DirtyRect | null,
  second: DirtyRect,
): DirtyRect {
  if (!first) {
    return second;
  }
  const x = Math.min(first.x, second.x);
  const y = Math.min(first.y, second.y);
  const right = Math.max(
    first.x + first.width,
    second.x + second.width,
  );
  const bottom = Math.max(
    first.y + first.height,
    second.y + second.height,
  );
  return { x, y, width: right - x, height: bottom - y };
}

export function normalizeLayerRect(rect: DirtyRect | null): DirtyRect | null {
  if (!rect) {
    return null;
  }
  const x = clamp(Math.floor(rect.x), 0, DOCUMENT_WIDTH);
  const y = clamp(Math.floor(rect.y), 0, DOCUMENT_HEIGHT);
  const right = clamp(Math.ceil(rect.x + rect.width), 0, DOCUMENT_WIDTH);
  const bottom = clamp(Math.ceil(rect.y + rect.height), 0, DOCUMENT_HEIGHT);
  return right > x && bottom > y
    ? { x, y, width: right - x, height: bottom - y }
    : null;
}

export function mergeDirtyRects(left: DirtyRect | null, right: DirtyRect | null): DirtyRect | null {
  if (!left) {
    return right ? { ...right } : null;
  }
  if (!right) {
    return { ...left };
  }
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const maximumX = Math.max(left.x + left.width, right.x + right.width);
  const maximumY = Math.max(left.y + left.height, right.y + right.height);
  return { x, y, width: maximumX - x, height: maximumY - y };
}

export function paintMipDimensions(mipLevel: number): { width: number; height: number } {
  return {
    width: Math.max(1, DOCUMENT_WIDTH >> mipLevel),
    height: Math.max(1, DOCUMENT_HEIGHT >> mipLevel),
  };
}
