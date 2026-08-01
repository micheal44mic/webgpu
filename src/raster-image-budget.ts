/** Pure logical memory model for one imported raster image. */

export const RASTER_IMAGE_BYTES_PER_PIXEL = 4;
export const RASTER_IMAGE_UNIFORM_BYTES = 32;

export interface RasterImageMemoryBudget {
  readonly width: number;
  readonly height: number;
  readonly mipLevelCount: number;
  /** Persistent rgba8unorm-srgb mip chain plus the transform uniform. */
  readonly residentGpuBytes: number;
  /** Temporary straight-sRGB GPU upload texture. */
  readonly uploadTextureBytes: number;
  /** Conservative decoded ImageBitmap surface estimate. */
  readonly decodedBitmapBytes: number;
  /** Full byte-inspection ArrayBuffer retained conservatively through decode. */
  readonly inspectionBytes: number;
  readonly logicalImportPeakBytes: number;
}

export interface RasterImageAggregateMemoryBudget {
  readonly asset: RasterImageMemoryBudget;
  readonly existingResidentBytes: number;
  readonly resultingResidentBytes: number;
  readonly aggregateLogicalImportPeakBytes: number;
}

function requirePositiveDimension(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} deve essere un intero positivo sicuro.`);
  }
  return value;
}

export function rasterImageMipLevelCount(width: number, height: number): number {
  const safeWidth = requirePositiveDimension(width, "La larghezza");
  const safeHeight = requirePositiveDimension(height, "L’altezza");
  return 1 + Math.floor(Math.log2(Math.max(safeWidth, safeHeight)));
}

export function rasterImageMipChainBytes(
  width: number,
  height: number,
  levels = rasterImageMipLevelCount(width, height),
): number {
  const safeWidth = requirePositiveDimension(width, "La larghezza");
  const safeHeight = requirePositiveDimension(height, "L’altezza");
  if (!Number.isSafeInteger(levels) || levels <= 0) {
    throw new Error("Il numero di mip deve essere un intero positivo sicuro.");
  }
  const maximumLevels = rasterImageMipLevelCount(safeWidth, safeHeight);
  if (levels > maximumLevels) {
    throw new Error(`La texture ammette al massimo ${maximumLevels} livelli mip.`);
  }
  let total = 0;
  for (let level = 0; level < levels; level += 1) {
    const divisor = 2 ** level;
    total += Math.max(1, Math.floor(safeWidth / divisor))
      * Math.max(1, Math.floor(safeHeight / divisor))
      * RASTER_IMAGE_BYTES_PER_PIXEL;
  }
  if (!Number.isSafeInteger(total)) {
    throw new Error("La memoria della catena mip supera l’intervallo sicuro.");
  }
  return total;
}

export function planRasterImageMemory(
  width: number,
  height: number,
  sourceBytes: number,
): RasterImageMemoryBudget {
  const safeWidth = requirePositiveDimension(width, "La larghezza");
  const safeHeight = requirePositiveDimension(height, "L’altezza");
  if (!Number.isSafeInteger(sourceBytes) || sourceBytes < 0) {
    throw new Error("I byte sorgente devono essere un intero sicuro non negativo.");
  }
  const mipLevelCount = rasterImageMipLevelCount(safeWidth, safeHeight);
  const baseBytes = safeWidth * safeHeight * RASTER_IMAGE_BYTES_PER_PIXEL;
  const residentGpuBytes = rasterImageMipChainBytes(
    safeWidth,
    safeHeight,
    mipLevelCount,
  ) + RASTER_IMAGE_UNIFORM_BYTES;
  const uploadTextureBytes = baseBytes;
  const decodedBitmapBytes = baseBytes;
  const inspectionBytes = sourceBytes;
  const logicalImportPeakBytes = residentGpuBytes
    + uploadTextureBytes
    + decodedBitmapBytes
    + inspectionBytes;
  if (!Number.isSafeInteger(logicalImportPeakBytes)) {
    throw new Error("Il picco logico d’importazione supera l’intervallo sicuro.");
  }
  return Object.freeze({
    width: safeWidth,
    height: safeHeight,
    mipLevelCount,
    residentGpuBytes,
    uploadTextureBytes,
    decodedBitmapBytes,
    inspectionBytes,
    logicalImportPeakBytes,
  });
}

export function planRasterImageAggregateMemory(
  existingResidentBytes: number,
  width: number,
  height: number,
  sourceBytes: number,
): RasterImageAggregateMemoryBudget {
  if (!Number.isSafeInteger(existingResidentBytes) || existingResidentBytes < 0) {
    throw new Error("I byte GPU già residenti devono essere un intero sicuro non negativo.");
  }
  const asset = planRasterImageMemory(width, height, sourceBytes);
  const resultingResidentBytes = existingResidentBytes + asset.residentGpuBytes;
  const aggregateLogicalImportPeakBytes = existingResidentBytes
    + asset.logicalImportPeakBytes;
  if (!Number.isSafeInteger(resultingResidentBytes)
    || !Number.isSafeInteger(aggregateLogicalImportPeakBytes)) {
    throw new Error("La memoria aggregata delle immagini supera l’intervallo sicuro.");
  }
  return Object.freeze({
    asset,
    existingResidentBytes,
    resultingResidentBytes,
    aggregateLogicalImportPeakBytes,
  });
}
