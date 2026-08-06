import {
  DOCUMENT_TILE_GRID_SIZE,
  DOCUMENT_TILE_SIZE,
} from "./engine-limits.ts";

export const LAYER_STORAGE_STRATEGY =
  "single-active-plus-optional-reference-full-inactive-256-array-tiles-rehydrate-fold" as const;

// I tile restano 256 per documento: e' il loro lato a scalare con la taglia del
// documento, cosi' l'array texture del cold storage e la maschera da 8 word
// hanno la stessa forma a 4096² e a 2048².
export const LAYER_STORAGE_TILE_SIZE = DOCUMENT_TILE_SIZE;
export const LAYER_STORAGE_GRID_SIZE = DOCUMENT_TILE_GRID_SIZE;
export const LAYER_STORAGE_TILE_COUNT =
  LAYER_STORAGE_GRID_SIZE * LAYER_STORAGE_GRID_SIZE;
export const LAYER_STORAGE_MASK_WORD_COUNT = LAYER_STORAGE_TILE_COUNT / 32;
export const LAYER_STORAGE_DOCUMENT_SIZE =
  LAYER_STORAGE_TILE_SIZE * LAYER_STORAGE_GRID_SIZE;

const MEBIBYTE_BYTES = 1024 * 1024;

export interface LayerStorageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type LayerStorageTileMask = Uint32Array;

export interface LayerStorageMaskComparison {
  missedReferenceTiles: number;
  extraCandidateTiles: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function assertMask(mask: LayerStorageTileMask): void {
  if (mask.length !== LAYER_STORAGE_MASK_WORD_COUNT) {
    throw new Error(
      `Maschera tile non valida: ${mask.length} word, attese ${LAYER_STORAGE_MASK_WORD_COUNT}.`,
    );
  }
}

function setTile(mask: LayerStorageTileMask, tileX: number, tileY: number): void {
  const tileIndex = tileY * LAYER_STORAGE_GRID_SIZE + tileX;
  const wordIndex = tileIndex >>> 5;
  const bitIndex = tileIndex & 31;
  mask[wordIndex] |= (1 << bitIndex) >>> 0;
}

function popcount32(value: number): number {
  let remaining = value >>> 0;
  remaining -= (remaining >>> 1) & 0x55555555;
  remaining = (remaining & 0x33333333) + ((remaining >>> 2) & 0x33333333);
  return (((remaining + (remaining >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function normalizedTileRange(rect: LayerStorageRect): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} | null {
  if (
    !Number.isFinite(rect.x)
    || !Number.isFinite(rect.y)
    || !Number.isFinite(rect.width)
    || !Number.isFinite(rect.height)
    || rect.width <= 0
    || rect.height <= 0
  ) {
    return null;
  }

  const pixelLeft = clamp(Math.floor(rect.x), 0, LAYER_STORAGE_DOCUMENT_SIZE);
  const pixelTop = clamp(Math.floor(rect.y), 0, LAYER_STORAGE_DOCUMENT_SIZE);
  const pixelRight = clamp(
    Math.ceil(rect.x + rect.width),
    0,
    LAYER_STORAGE_DOCUMENT_SIZE,
  );
  const pixelBottom = clamp(
    Math.ceil(rect.y + rect.height),
    0,
    LAYER_STORAGE_DOCUMENT_SIZE,
  );
  if (pixelRight <= pixelLeft || pixelBottom <= pixelTop) {
    return null;
  }

  return {
    left: Math.floor(pixelLeft / LAYER_STORAGE_TILE_SIZE),
    top: Math.floor(pixelTop / LAYER_STORAGE_TILE_SIZE),
    right: Math.ceil(pixelRight / LAYER_STORAGE_TILE_SIZE),
    bottom: Math.ceil(pixelBottom / LAYER_STORAGE_TILE_SIZE),
  };
}

export function createLayerStorageTileMask(): LayerStorageTileMask {
  return new Uint32Array(LAYER_STORAGE_MASK_WORD_COUNT);
}

export function clearLayerStorageTileMask(mask: LayerStorageTileMask): void {
  assertMask(mask);
  mask.fill(0);
}

/**
 * Marks every 256² tile touched by a conservative raw-layer mutation rect.
 *
 * False positives are allowed and measurable. False negatives are not: this
 * mask is the candidate source of truth for a future cold store, so a missed
 * dirty tile would become silent pixel loss after eviction.
 */
export function markLayerStorageRect(
  mask: LayerStorageTileMask,
  rect: LayerStorageRect,
): void {
  assertMask(mask);
  const range = normalizedTileRange(rect);
  if (!range) {
    return;
  }
  for (let tileY = range.top; tileY < range.bottom; tileY += 1) {
    for (let tileX = range.left; tileX < range.right; tileX += 1) {
      setTile(mask, tileX, tileY);
    }
  }
}

export function countLayerStorageTiles(mask: LayerStorageTileMask): number {
  assertMask(mask);
  let count = 0;
  for (const word of mask) {
    count += popcount32(word);
  }
  return count;
}

export function layerStorageTileIndices(mask: LayerStorageTileMask): number[] {
  assertMask(mask);
  const indices: number[] = [];
  for (let tileIndex = 0; tileIndex < LAYER_STORAGE_TILE_COUNT; tileIndex += 1) {
    const wordIndex = tileIndex >>> 5;
    const bitIndex = tileIndex & 31;
    if (((mask[wordIndex] >>> bitIndex) & 1) !== 0) {
      indices.push(tileIndex);
    }
  }
  return indices;
}

export function alignedBoundsTileCount(rect: LayerStorageRect | null): number {
  if (!rect) {
    return 0;
  }
  const range = normalizedTileRange(rect);
  return range
    ? (range.right - range.left) * (range.bottom - range.top)
    : 0;
}

export function layerStorageTileMemoryMiB(
  tileCount: number,
  bytesPerPixel: 4 | 8,
): number {
  const clampedCount = clamp(
    Math.floor(Number.isFinite(tileCount) ? tileCount : 0),
    0,
    LAYER_STORAGE_TILE_COUNT,
  );
  return clampedCount
    * LAYER_STORAGE_TILE_SIZE
    * LAYER_STORAGE_TILE_SIZE
    * bytesPerPixel
    / MEBIBYTE_BYTES;
}

/**
 * Dev/reference path: derives exact occupied tiles from raw texture bytes.
 *
 * "Occupied" deliberately means ANY non-zero byte, not only alpha. The future
 * cold store must preserve the authoritative texture byte-for-byte, including
 * a malformed or future texel whose RGB is non-zero while alpha is zero.
 */
export function exactLayerStorageTileMask(
  pixels: Uint8Array,
  width: number,
  height: number,
  bytesPerPixel: 4 | 8,
): LayerStorageTileMask {
  if (
    !Number.isInteger(width)
    || !Number.isInteger(height)
    || width < 0
    || height < 0
    || width > LAYER_STORAGE_DOCUMENT_SIZE
    || height > LAYER_STORAGE_DOCUMENT_SIZE
  ) {
    throw new Error(`Dimensioni readback non valide: ${width}×${height}.`);
  }
  if (pixels.byteLength !== width * height * bytesPerPixel) {
    throw new Error(
      `Readback non valido: ${pixels.byteLength} byte, attesi `
      + `${width * height * bytesPerPixel}.`,
    );
  }

  const mask = createLayerStorageTileMask();
  const canUseWords = pixels.byteOffset % 4 === 0 && pixels.byteLength % 4 === 0;
  const words = canUseWords
    ? new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.byteLength / 4)
    : null;

  const tileColumns = Math.ceil(width / LAYER_STORAGE_TILE_SIZE);
  const tileRows = Math.ceil(height / LAYER_STORAGE_TILE_SIZE);
  for (let tileY = 0; tileY < tileRows; tileY += 1) {
    const firstY = tileY * LAYER_STORAGE_TILE_SIZE;
    const lastY = Math.min(height, firstY + LAYER_STORAGE_TILE_SIZE);
    for (let tileX = 0; tileX < tileColumns; tileX += 1) {
      const firstX = tileX * LAYER_STORAGE_TILE_SIZE;
      const lastX = Math.min(width, firstX + LAYER_STORAGE_TILE_SIZE);
      let occupied = false;
      for (let y = firstY; y < lastY && !occupied; y += 1) {
        const firstByte = (y * width + firstX) * bytesPerPixel;
        const lastByte = (y * width + lastX) * bytesPerPixel;
        if (words) {
          const firstWord = firstByte / 4;
          const lastWord = lastByte / 4;
          for (let index = firstWord; index < lastWord; index += 1) {
            if (words[index] !== 0) {
              occupied = true;
              break;
            }
          }
        } else {
          for (let index = firstByte; index < lastByte; index += 1) {
            if (pixels[index] !== 0) {
              occupied = true;
              break;
            }
          }
        }
      }
      if (occupied) {
        setTile(mask, tileX, tileY);
      }
    }
  }
  return mask;
}

export function compareLayerStorageMasks(
  reference: LayerStorageTileMask,
  candidate: LayerStorageTileMask,
): LayerStorageMaskComparison {
  assertMask(reference);
  assertMask(candidate);
  let missedReferenceTiles = 0;
  let extraCandidateTiles = 0;
  for (let index = 0; index < LAYER_STORAGE_MASK_WORD_COUNT; index += 1) {
    const referenceWord = reference[index] >>> 0;
    const candidateWord = candidate[index] >>> 0;
    missedReferenceTiles += popcount32(referenceWord & ~candidateWord);
    extraCandidateTiles += popcount32(candidateWord & ~referenceWord);
  }
  return { missedReferenceTiles, extraCandidateTiles };
}
