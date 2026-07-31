/**
 * Modello di memoria dichiarato: quanti MiB costa ogni risorsa del motore.
 * E' la fonte dei numeri riportati nei pannelli memoria e nei benchmark.
 */
import {
  LAYER_SIZE,
  LIGHT_GLAZE_COMMIT_TILE_EXTENT,
  MEBIBYTE_BYTES,
  PAINT_DISPLAY_MIP_LEVEL_COUNT,
  SHAPE_MASK_PIXEL_COUNT,
  STATIC_PAINT_BUFFER_BYTES,
} from "./engine-limits";
import type { LightGlazeStorageMode } from "./engine-strategies";
import type { LayerFormat } from "./engine-types";

export function paintDisplayPyramidAdditionalMemoryMiB(format: LayerFormat): number {
  const bytesPerPixel = format === "rgba16float" ? 8 : 4;
  let pixels = 0;
  for (let mipLevel = 1; mipLevel < PAINT_DISPLAY_MIP_LEVEL_COUNT; mipLevel += 1) {
    const dimension = Math.max(1, LAYER_SIZE >> mipLevel);
    pixels += dimension * dimension;
  }
  return (pixels * bytesPerPixel) / (1024 * 1024);
}

export function layerBaseMemoryMiB(format: LayerFormat): number {
  return format === "rgba16float" ? 128 : 64;
}

export function lightGlazeAdditionalMemoryMiB(
  format: LayerFormat,
  storageMode: LightGlazeStorageMode,
): number {
  if (storageMode === "none") {
    return 0;
  }
  const accumulatorMiB = storageMode === "r8-coverage"
    ? LAYER_SIZE * LAYER_SIZE / MEBIBYTE_BYTES
    : 128;
  const commitTileMiB = storageMode === "rgba16float-stroke"
    ? LIGHT_GLAZE_COMMIT_TILE_EXTENT * LIGHT_GLAZE_COMMIT_TILE_EXTENT
      * (format === "rgba16float" ? 8 : 4) / MEBIBYTE_BYTES
    : 0;
  return accumulatorMiB + paintDisplayPyramidAdditionalMemoryMiB(format) + commitTileMiB;
}

export function shapeTextureMemoryMiB(): number {
  return SHAPE_MASK_PIXEL_COUNT / MEBIBYTE_BYTES;
}

export function staticPaintBufferMemoryMiB(): number {
  return STATIC_PAINT_BUFFER_BYTES / MEBIBYTE_BYTES;
}
