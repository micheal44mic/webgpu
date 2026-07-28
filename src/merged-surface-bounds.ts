export interface MergedSurfaceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Mixed-scene merged surfaces contain raster records only. They are derived
 * document-space caches at one texel per document pixel; semantic text never
 * enters them and is rerasterized independently at viewport resolution.
 */
export const MIXED_MERGED_SURFACE_STORAGE_STRATEGY =
  "mixed-raster-bbox-document-mips-vector-viewport-v3" as const;
export const MIXED_MERGED_SURFACE_ALIGNMENT = 64;
export const MIXED_MERGED_SURFACE_TRANSPARENT_GUARD = 64;
export const MIXED_MERGED_SURFACE_MAX_DISPLAY_MIP = 5;
function normalizedRect(
  rect: Readonly<MergedSurfaceRect>,
  documentSize: number,
): MergedSurfaceRect | null {
  if (
    !Number.isFinite(rect.x)
    || !Number.isFinite(rect.y)
    || !Number.isFinite(rect.width)
    || !Number.isFinite(rect.height)
    || !Number.isFinite(documentSize)
    || documentSize < 1
  ) {
    return null;
  }
  const left = Math.max(0, Math.min(documentSize, Math.floor(rect.x)));
  const top = Math.max(0, Math.min(documentSize, Math.floor(rect.y)));
  const right = Math.max(
    left,
    Math.min(documentSize, Math.ceil(rect.x + rect.width)),
  );
  const bottom = Math.max(
    top,
    Math.min(documentSize, Math.ceil(rect.y + rect.height)),
  );
  if (right <= left || bottom <= top) {
    return null;
  }
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

export function unionMergedSurfaceRects(
  rects: readonly Readonly<MergedSurfaceRect>[],
  documentSize: number,
): MergedSurfaceRect | null {
  let left = documentSize;
  let top = documentSize;
  let right = 0;
  let bottom = 0;
  let found = false;
  for (const rect of rects) {
    const normalized = normalizedRect(rect, documentSize);
    if (!normalized) {
      continue;
    }
    found = true;
    left = Math.min(left, normalized.x);
    top = Math.min(top, normalized.y);
    right = Math.max(right, normalized.x + normalized.width);
    bottom = Math.max(bottom, normalized.y + normalized.height);
  }
  return found
    ? { x: left, y: top, width: right - left, height: bottom - top }
    : null;
}

export function alignedMergedSurfaceBounds(
  contentBounds: Readonly<MergedSurfaceRect>,
  documentSize: number,
  alignment = MIXED_MERGED_SURFACE_ALIGNMENT,
  transparentGuard = MIXED_MERGED_SURFACE_TRANSPARENT_GUARD,
): MergedSurfaceRect {
  const normalized = normalizedRect(contentBounds, documentSize);
  if (!normalized) {
    throw new Error("Bounds merged privi di pixel validi.");
  }
  if (
    !Number.isInteger(alignment)
    || alignment < 1
    || !Number.isInteger(transparentGuard)
    || transparentGuard < 0
  ) {
    throw new Error("Allineamento o guardia merged non validi.");
  }
  const left = Math.max(
    0,
    Math.floor((normalized.x - transparentGuard) / alignment) * alignment,
  );
  const top = Math.max(
    0,
    Math.floor((normalized.y - transparentGuard) / alignment) * alignment,
  );
  const right = Math.min(
    documentSize,
    Math.ceil(
      (normalized.x + normalized.width + transparentGuard) / alignment,
    ) * alignment,
  );
  const bottom = Math.min(
    documentSize,
    Math.ceil(
      (normalized.y + normalized.height + transparentGuard) / alignment,
    ) * alignment,
  );
  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

export function intersectMergedSurfaceRects(
  first: Readonly<MergedSurfaceRect>,
  second: Readonly<MergedSurfaceRect>,
  documentSize: number,
): MergedSurfaceRect | null {
  const a = normalizedRect(first, documentSize);
  const b = normalizedRect(second, documentSize);
  if (!a || !b) {
    return null;
  }
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > left && bottom > top
    ? { x: left, y: top, width: right - left, height: bottom - top }
    : null;
}

export function mergedSurfaceLocalRect(
  documentRect: Readonly<MergedSurfaceRect>,
  surfaceBounds: Readonly<MergedSurfaceRect>,
): MergedSurfaceRect {
  const x = documentRect.x - surfaceBounds.x;
  const y = documentRect.y - surfaceBounds.y;
  if (
    x < 0
    || y < 0
    || x + documentRect.width > surfaceBounds.width
    || y + documentRect.height > surfaceBounds.height
  ) {
    throw new Error("Il contenuto eccede i bounds della superficie merged.");
  }
  return { x, y, width: documentRect.width, height: documentRect.height };
}

export function mergedSurfacePhysicalRect(
  documentRect: Readonly<MergedSurfaceRect>,
  surfaceBounds: Readonly<MergedSurfaceRect>,
  resolutionScale: number,
): MergedSurfaceRect {
  if (!Number.isInteger(resolutionScale) || resolutionScale < 1) {
    throw new Error("Densità merged non valida.");
  }
  const local = mergedSurfaceLocalRect(documentRect, surfaceBounds);
  return {
    x: local.x * resolutionScale,
    y: local.y * resolutionScale,
    width: local.width * resolutionScale,
    height: local.height * resolutionScale,
  };
}

export function mergedSurfaceMipLevelCount(
  bounds: Readonly<Pick<MergedSurfaceRect, "width" | "height">>,
): number {
  const maximumExtent = Math.max(1, Math.floor(bounds.width), Math.floor(bounds.height));
  return Math.floor(Math.log2(maximumExtent)) + 1;
}

export function mergedSurfaceMemoryBytes(
  bounds: Readonly<Pick<MergedSurfaceRect, "width" | "height">>,
  bytesPerPixel: number,
): {
  mip0Bytes: number;
  mipChainBytes: number;
  totalBytes: number;
  mipLevelCount: number;
} {
  if (!Number.isFinite(bytesPerPixel) || bytesPerPixel <= 0) {
    throw new Error("Byte per pixel merged non validi.");
  }
  let width = Math.max(1, Math.floor(bounds.width));
  let height = Math.max(1, Math.floor(bounds.height));
  const mip0Bytes = width * height * bytesPerPixel;
  let mipChainBytes = 0;
  let mipLevelCount = 1;
  while (width > 1 || height > 1) {
    width = Math.max(1, Math.floor(width / 2));
    height = Math.max(1, Math.floor(height / 2));
    mipChainBytes += width * height * bytesPerPixel;
    mipLevelCount += 1;
  }
  return {
    mip0Bytes,
    mipChainBytes,
    totalBytes: mip0Bytes + mipChainBytes,
    mipLevelCount,
  };
}
