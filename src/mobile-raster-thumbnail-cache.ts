import { LAYER_STACK_MAXIMUM } from "./layer-stack.ts";

/**
 * Keep a few detached structural-history generations so merge -> undo can
 * restore the original layer previews without another GPU readback. The cap
 * is deliberately expressed in layer-stack generations instead of being an
 * unbounded cache of every layer id ever created by the document.
 */
export const MOBILE_RASTER_THUMBNAIL_CACHE_GENERATIONS = 4 as const;
export const MOBILE_RASTER_THUMBNAIL_EDGE_PX = 64 as const;
export const MOBILE_RASTER_THUMBNAIL_CACHE_MAXIMUM =
  LAYER_STACK_MAXIMUM * MOBILE_RASTER_THUMBNAIL_CACHE_GENERATIONS;
export const MOBILE_RASTER_THUMBNAIL_RGBA_BYTES =
  MOBILE_RASTER_THUMBNAIL_EDGE_PX * MOBILE_RASTER_THUMBNAIL_EDGE_PX * 4;
export const MOBILE_RASTER_THUMBNAIL_CACHE_MAXIMUM_BYTES =
  MOBILE_RASTER_THUMBNAIL_CACHE_MAXIMUM * MOBILE_RASTER_THUMBNAIL_RGBA_BYTES;

/**
 * A tiny LRU keyed by the monotonic raster layer id. Reading touches an entry,
 * so previews for the live layer list stay newer than detached undo records.
 */
export class BoundedMobileRasterThumbnailCache<Value> {
  private readonly entries = new Map<number, Value>();
  readonly maximum: number;

  constructor(maximum = MOBILE_RASTER_THUMBNAIL_CACHE_MAXIMUM) {
    if (!Number.isSafeInteger(maximum) || maximum < 1) {
      throw new Error("The thumbnail cache limit must be a positive integer.");
    }
    this.maximum = maximum;
  }

  get size(): number {
    return this.entries.size;
  }

  get(layerId: number): Value | undefined {
    const value = this.entries.get(layerId);
    if (value === undefined) return undefined;
    this.entries.delete(layerId);
    this.entries.set(layerId, value);
    return value;
  }

  set(layerId: number, value: Value): void {
    this.entries.delete(layerId);
    this.entries.set(layerId, value);
    while (this.entries.size > this.maximum) {
      const oldest = this.entries.keys().next();
      if (oldest.done) return;
      this.entries.delete(oldest.value);
    }
  }

  delete(layerId: number): boolean {
    return this.entries.delete(layerId);
  }

  clear(): void {
    this.entries.clear();
  }
}
