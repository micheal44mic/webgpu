/** Pure logical memory model for one imported raster image. */

/** Browser decoder/upload boundary: straight-alpha 8-bit sRGB. */
export const RASTER_IMAGE_DECODED_BYTES_PER_PIXEL = 4;
/** First authoritative intermediate: linear-premultiplied RGBA16F. */
export const RASTER_IMAGE_LINEAR_BYTES_PER_PIXEL = 8;
export const RASTER_IMAGE_UNIFORM_BYTES = 32;

export interface RasterImageMemoryBudget {
  readonly width: number;
  readonly height: number;
  readonly mipLevelCount: number;
  /** Linear-premultiplied rgba16float mip chain plus the transform uniform. */
  readonly residentGpuBytes: number;
  /** Temporary straight-sRGB GPU upload texture. */
  readonly uploadTextureBytes: number;
  /** Conservative decoded ImageBitmap surface estimate. */
  readonly decodedBitmapBytes: number;
  /** Full byte-inspection ArrayBuffer retained conservatively through decode. */
  readonly inspectionBytes: number;
  readonly logicalImportPeakBytes: number;
}

function requirePositiveDimension(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

export function rasterImageMipLevelCount(width: number, height: number): number {
  const safeWidth = requirePositiveDimension(width, "Width");
  const safeHeight = requirePositiveDimension(height, "Height");
  return 1 + Math.floor(Math.log2(Math.max(safeWidth, safeHeight)));
}

export function rasterImageMipChainBytes(
  width: number,
  height: number,
  levels = rasterImageMipLevelCount(width, height),
): number {
  const safeWidth = requirePositiveDimension(width, "Width");
  const safeHeight = requirePositiveDimension(height, "Height");
  if (!Number.isSafeInteger(levels) || levels <= 0) {
    throw new Error("The mip count must be a positive safe integer.");
  }
  const maximumLevels = rasterImageMipLevelCount(safeWidth, safeHeight);
  if (levels > maximumLevels) {
    throw new Error(`The texture supports at most ${maximumLevels} mip levels.`);
  }
  let total = 0;
  for (let level = 0; level < levels; level += 1) {
    const divisor = 2 ** level;
    total += Math.max(1, Math.floor(safeWidth / divisor))
      * Math.max(1, Math.floor(safeHeight / divisor))
      * RASTER_IMAGE_LINEAR_BYTES_PER_PIXEL;
  }
  if (!Number.isSafeInteger(total)) {
    throw new Error("Mip-chain memory exceeds the safe integer range.");
  }
  return total;
}

export function planRasterImageMemory(
  width: number,
  height: number,
  sourceBytes: number,
): RasterImageMemoryBudget {
  const safeWidth = requirePositiveDimension(width, "Width");
  const safeHeight = requirePositiveDimension(height, "Height");
  if (!Number.isSafeInteger(sourceBytes) || sourceBytes < 0) {
    throw new Error("Source bytes must be a non-negative safe integer.");
  }
  const mipLevelCount = rasterImageMipLevelCount(safeWidth, safeHeight);
  const decodedBaseBytes = safeWidth * safeHeight
    * RASTER_IMAGE_DECODED_BYTES_PER_PIXEL;
  const residentGpuBytes = rasterImageMipChainBytes(
    safeWidth,
    safeHeight,
    mipLevelCount,
  ) + RASTER_IMAGE_UNIFORM_BYTES;
  const uploadTextureBytes = decodedBaseBytes;
  const decodedBitmapBytes = decodedBaseBytes;
  const inspectionBytes = sourceBytes;
  const logicalImportPeakBytes = residentGpuBytes
    + uploadTextureBytes
    + decodedBitmapBytes
    + inspectionBytes;
  if (!Number.isSafeInteger(logicalImportPeakBytes)) {
    throw new Error("The logical import peak exceeds the safe integer range.");
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
