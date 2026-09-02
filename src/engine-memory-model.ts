/**
 * Modello di memoria dichiarato: quanti MiB costa ogni risorsa del motore.
 * E' la fonte dei numeri riportati nei pannelli memoria e nei benchmark.
 *
 * Ogni funzione e' **pura rispetto alle dimensioni del documento**: le riceve
 * come parametri e usa le dimensioni risolte al boot come default. Un documento di taglia
 * arbitraria (canvas personalizzato, non quadrato, non potenza di due) si
 * misura passando la sua taglia, senza toccare questo file. E' la ragione per
 * cui non si legge piu' la costante globale dentro il corpo delle funzioni: un
 * numero cablato qui e' un pannello che mente, ed e' gia' successo.
 */
import {
  DOCUMENT_HEIGHT,
  DOCUMENT_WIDTH,
  LIGHT_GLAZE_COMMIT_TILE_EXTENT,
  MEBIBYTE_BYTES,
  SHAPE_MASK_PIXEL_COUNT,
  SHAPE_MASK_SIZE,
  STATIC_PAINT_BUFFER_BYTES,
} from "./engine-limits.ts";
import type { LightGlazeStorageMode } from "./engine-strategies";
import type { BrushShapeMaskFormat, LayerFormat } from "./engine-types";

export interface DocumentExtent {
  width?: number;
  height?: number;
}

function resolvedExtent(extent: DocumentExtent | undefined): {
  width: number;
  height: number;
} {
  const width = Math.max(1, Math.trunc(extent?.width ?? DOCUMENT_WIDTH));
  const height = Math.max(1, Math.trunc(extent?.height ?? DOCUMENT_HEIGHT));
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new RangeError("Document dimensions must be finite.");
  }
  return { width, height };
}

export function layerFormatBytesPerPixel(format: LayerFormat): number {
  return format === "rgba16float" ? 8 : 4;
}

/**
 * Numero di livelli mip della piramide display, incluso il mip 0. Deriva dal
 * lato piu' lungo, quindi resta corretto anche su documenti non quadrati.
 */
export function documentMipLevelCount(extent?: DocumentExtent): number {
  const { width, height } = resolvedExtent(extent);
  return Math.floor(Math.log2(Math.max(width, height))) + 1;
}

/** Pixel dei soli mip 1+ : il mip 0 e' il livello autorevole, contato a parte. */
function pyramidPixels(extent?: DocumentExtent): number {
  const { width, height } = resolvedExtent(extent);
  let pixels = 0;
  for (let mipLevel = 1; mipLevel < documentMipLevelCount({ width, height }); mipLevel += 1) {
    pixels += Math.max(1, width >> mipLevel) * Math.max(1, height >> mipLevel);
  }
  return pixels;
}

export function paintDisplayPyramidAdditionalMemoryMiB(
  format: LayerFormat,
  extent?: DocumentExtent,
): number {
  return (pyramidPixels(extent) * layerFormatBytesPerPixel(format)) / MEBIBYTE_BYTES;
}

export function layerBaseMemoryMiB(format: LayerFormat, extent?: DocumentExtent): number {
  const { width, height } = resolvedExtent(extent);
  return (width * height * layerFormatBytesPerPixel(format)) / MEBIBYTE_BYTES;
}

/**
 * L'accumulatore Light Glaze e' full-document: `r16float` in modalita' coverage,
 * `rgba16float` altrimenti. Il suo costo non ha nulla a che vedere col formato
 * del livello, che governa invece piramide e commit tile.
 */
export function lightGlazeAccumulatorBytesPerPixel(
  storageMode: LightGlazeStorageMode,
): number {
  return storageMode === "r16float-coverage" ? 2 : 8;
}

export function lightGlazeAdditionalMemoryMiB(
  format: LayerFormat,
  storageMode: LightGlazeStorageMode,
  extent?: DocumentExtent,
  includeCommitTile = storageMode === "rgba16float-stroke",
): number {
  if (storageMode === "none") {
    return 0;
  }
  const { width, height } = resolvedExtent(extent);
  const accumulatorMiB =
    (width * height * lightGlazeAccumulatorBytesPerPixel(storageMode)) / MEBIBYTE_BYTES;
  const commitTileMiB = includeCommitTile
    ? LIGHT_GLAZE_COMMIT_TILE_EXTENT * LIGHT_GLAZE_COMMIT_TILE_EXTENT
      * layerFormatBytesPerPixel(format) / MEBIBYTE_BYTES
    : 0;
  return accumulatorMiB
    + paintDisplayPyramidAdditionalMemoryMiB(format, { width, height })
    + commitTileMiB;
}

export function shapeTextureMemoryMiB(
  _format: BrushShapeMaskFormat = "r16float",
  layerCount = 1,
): number {
  // Both comparison modes use the same guarded R16F allocation. The 8-bit
  // mode quantizes source samples in the reconstruction shader only.
  const normalizedLayerCount = Math.max(1, Math.min(4, Math.trunc(layerCount)));
  return SHAPE_MASK_PIXEL_COUNT * 2 * normalizedLayerCount / MEBIBYTE_BYTES;
}

/** One native scalar16 upload texture; it has no mip chain. */
export function shapeTextureUploadStagingMemoryMiB(
  width = SHAPE_MASK_SIZE,
  height = SHAPE_MASK_SIZE,
): number {
  const normalizedWidth = Math.max(1, Math.trunc(width));
  const normalizedHeight = Math.max(1, Math.trunc(height));
  if (!Number.isFinite(normalizedWidth) || !Number.isFinite(normalizedHeight)) {
    throw new RangeError("Shape source dimensions must be finite.");
  }
  return normalizedWidth * normalizedHeight * 2 / MEBIBYTE_BYTES;
}

/**
 * Peak GPU residency while replacing one Shape array with another through the
 * sequential loader. The old and candidate arrays overlap until publication,
 * while only one source staging texture is live at any time.
 */
export function shapeTextureSequentialTransitionPeakMemoryMiB(
  previousLayerCount: number,
  nextLayerCount: number,
  largestSourceWidth = SHAPE_MASK_SIZE,
  largestSourceHeight = SHAPE_MASK_SIZE,
): number {
  const previous = previousLayerCount > 0
    ? shapeTextureMemoryMiB("r16float", previousLayerCount)
    : 0;
  const next = shapeTextureMemoryMiB("r16float", nextLayerCount);
  return previous
    + next
    + shapeTextureUploadStagingMemoryMiB(largestSourceWidth, largestSourceHeight);
}

export function staticPaintBufferMemoryMiB(): number {
  return STATIC_PAINT_BUFFER_BYTES / MEBIBYTE_BYTES;
}
