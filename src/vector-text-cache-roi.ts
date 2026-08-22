/** Pure capacity planner for persistent vector-text run caches. */
export interface VectorTextCacheRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Persistent caches use a small guard and 64 px buckets. The geometry bounds
 * already exist for the cropped MSAA pass; this planner adds only O(1) integer
 * arithmetic and never scans pixels or reads data back from the GPU.
 */
export const VECTOR_TEXT_RUN_CACHE_GUARD_PX = 32;
export const VECTOR_TEXT_RUN_CACHE_BUCKET_PX = 64;

/**
 * Grows one cache axis independently. An already sufficient axis is retained;
 * this avoids multiplying both dimensions when only one side of a run grows.
 */
export function growVectorTextGpuCacheAxisCapacity(
  currentCapacity: number,
  requiredCapacity: number,
  maximumCapacity: number,
): number {
  const maximum = Math.max(1, Math.floor(maximumCapacity));
  const required = Math.max(1, Math.ceil(requiredCapacity));
  if (required > maximum) {
    throw new RangeError(
      `Vector-text cache requires ${required}px, above the ${maximum}px axis limit.`,
    );
  }
  const current = Math.max(0, Math.floor(currentCapacity));
  if (current >= required) {
    return Math.min(current, maximum);
  }
  const grown = current > 0
    ? Math.max(required, current * 1.5)
    : required;
  const bucketed = Math.ceil(grown / VECTOR_TEXT_RUN_CACHE_BUCKET_PX)
    * VECTOR_TEXT_RUN_CACHE_BUCKET_PX;
  return Math.min(maximum, bucketed);
}

export function vectorTextGpuRunCacheAllocationBounds(
  bounds: VectorTextCacheRect,
  canvasWidth: number,
  canvasHeight: number,
  roiEnabled = true,
): VectorTextCacheRect {
  const width = Math.max(1, Math.floor(canvasWidth));
  const height = Math.max(1, Math.floor(canvasHeight));
  if (!roiEnabled) {
    return { x: 0, y: 0, width, height };
  }

  const bucket = VECTOR_TEXT_RUN_CACHE_BUCKET_PX;
  const guard = VECTOR_TEXT_RUN_CACHE_GUARD_PX;
  const left = Math.max(0, Math.floor((bounds.x - guard) / bucket) * bucket);
  const top = Math.max(0, Math.floor((bounds.y - guard) / bucket) * bucket);
  const requestedRight = Math.min(width, bounds.x + bounds.width + guard);
  const requestedBottom = Math.min(height, bounds.y + bounds.height + guard);
  const right = Math.min(width, Math.max(left + 1, Math.ceil(requestedRight / bucket) * bucket));
  const bottom = Math.min(
    height,
    Math.max(top + 1, Math.ceil(requestedBottom / bucket) * bucket),
  );
  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

export function vectorTextGpuRunCacheContains(
  allocation: VectorTextCacheRect,
  bounds: VectorTextCacheRect,
): boolean {
  return bounds.x >= allocation.x
    && bounds.y >= allocation.y
    && bounds.x + bounds.width <= allocation.x + allocation.width
    && bounds.y + bounds.height <= allocation.y + allocation.height;
}

/** Repositions an existing capacity around new bounds without reallocating it. */
export function placeVectorTextGpuRunCache(
  bounds: VectorTextCacheRect,
  capacityWidth: number,
  capacityHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): VectorTextCacheRect {
  const width = Math.max(1, Math.min(Math.floor(canvasWidth), Math.floor(capacityWidth)));
  const height = Math.max(1, Math.min(Math.floor(canvasHeight), Math.floor(capacityHeight)));
  const spareX = Math.max(0, width - bounds.width);
  const spareY = Math.max(0, height - bounds.height);
  const x = Math.max(
    0,
    Math.min(Math.floor(canvasWidth) - width, Math.floor(bounds.x - spareX * 0.5)),
  );
  const y = Math.max(
    0,
    Math.min(Math.floor(canvasHeight) - height, Math.floor(bounds.y - spareY * 0.5)),
  );
  return { x, y, width, height };
}
