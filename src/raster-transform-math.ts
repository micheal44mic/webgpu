/**
 * Pure geometry for a transactional raster-layer transform.
 *
 * The transform is expressed in document pixels and always samples one
 * immutable source. Keeping this module free of DOM/WebGPU objects makes the
 * dirty bounds, sparse tile projection and shader ABI independently testable.
 */
import {
  DOCUMENT_HEIGHT as RASTER_TRANSFORM_DOCUMENT_HEIGHT,
  DOCUMENT_MAX_EDGE as RASTER_TRANSFORM_DOCUMENT_SIZE,
  DOCUMENT_TILE_GRID_SIZE,
  DOCUMENT_TILE_HEIGHT as RASTER_TRANSFORM_TILE_HEIGHT,
  DOCUMENT_TILE_SIZE as RASTER_TRANSFORM_TILE_SIZE,
  DOCUMENT_TILE_WIDTH as RASTER_TRANSFORM_TILE_WIDTH,
  DOCUMENT_WIDTH as RASTER_TRANSFORM_DOCUMENT_WIDTH,
} from "./engine-limits.ts";
import { RASTER_TRANSFORM_UNIFORM_BYTES } from "./raster-transform-program-abi.ts";
export { RASTER_TRANSFORM_UNIFORM_BYTES } from "./raster-transform-program-abi.ts";

export const RASTER_TRANSFORM_MATH_STRATEGY =
  "document-space-axis-scale-affine-sampling-per-source-tile-mask-v3" as const;

// La maschera tile consumata qui e' la stessa che producono Selezione e cold
// storage: griglia 16×16 sul documento, quindi il lato del tile scala con la
// taglia. Se questo restasse 256 fisso, a 2048² la maschera da 8 word verrebbe
// rifiutata da `requireTileMask` come lunga il quadruplo del previsto.
export {
  RASTER_TRANSFORM_DOCUMENT_HEIGHT,
  RASTER_TRANSFORM_DOCUMENT_SIZE,
  RASTER_TRANSFORM_DOCUMENT_WIDTH,
  RASTER_TRANSFORM_TILE_HEIGHT,
  RASTER_TRANSFORM_TILE_SIZE,
  RASTER_TRANSFORM_TILE_WIDTH,
};
/** @deprecated Prefer the independent document width and height bindings. */
export const RASTER_TRANSFORM_TILE_GRID_SIZE = DOCUMENT_TILE_GRID_SIZE;
export const RASTER_TRANSFORM_FILTER_PADDING_PX = 2;
export const RASTER_TRANSFORM_MINIMUM_ABS_SCALE = 0.01;
export const RASTER_TRANSFORM_MAXIMUM_ABS_SCALE = 64;
export interface RasterTransformPoint {
  x: number;
  y: number;
}

export interface RasterTransformRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Clockwise-positive rotation in the document's Y-down space. */
export interface RasterTransformAffine {
  translationX: number;
  translationY: number;
  /**
   * Legacy uniform scale. When an axis scale is omitted it falls back to this
   * value, or to one when all scale fields are omitted.
   *
   * @deprecated Prefer `scaleX` and `scaleY` for new callers.
   */
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  rotation: number;
}

/** Canonical affine emitted by `normalizeRasterTransform`. */
export interface NormalizedRasterTransformAffine extends RasterTransformAffine {
  /** Compatibility alias for `scaleX`. */
  scale: number;
  scaleX: number;
  scaleY: number;
}

export interface RasterTransformInverseRows {
  /** sourceDelta.x = row0.x * destinationDelta.x + row0.y * destinationDelta.y */
  row0: readonly [number, number];
  /** sourceDelta.y = row1.x * destinationDelta.x + row1.y * destinationDelta.y */
  row1: readonly [number, number];
}

export interface RasterTransformUniformInput {
  /** Tile-aligned rectangle copied into mip 0 of the immutable scratch. */
  sourceScratchRect: RasterTransformRect;
  /** Conservative non-transparent/mutated bounds inside that scratch. */
  sourceContentBounds: RasterTransformRect;
  sourcePivot: RasterTransformPoint;
  transform: RasterTransformAffine;
  documentWidth?: number;
  documentHeight?: number;
}

function requireFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be finite.`);
  }
  return value;
}

function requirePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a safe positive integer.`);
  }
  return value;
}

function normalizedAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function validatedRect(rect: RasterTransformRect, label: string): RasterTransformRect {
  const x = requireFinite(rect.x, `${label}.x`);
  const y = requireFinite(rect.y, `${label}.y`);
  const width = requireFinite(rect.width, `${label}.width`);
  const height = requireFinite(rect.height, `${label}.height`);
  if (width <= 0 || height <= 0) {
    throw new Error(`${label} must have a positive width and height.`);
  }
  return { x, y, width, height };
}

function rectRight(rect: RasterTransformRect): number {
  return rect.x + rect.width;
}

function rectBottom(rect: RasterTransformRect): number {
  return rect.y + rect.height;
}

export function normalizeRasterTransform(
  transform: Readonly<RasterTransformAffine>,
): NormalizedRasterTransformAffine {
  const translationX = requireFinite(transform.translationX, "translationX");
  const translationY = requireFinite(transform.translationY, "translationY");
  const legacyScale = transform.scale === undefined
    ? 1
    : requireFinite(transform.scale, "scale");
  const normalizedScale = (requestedScale: number, label: string): number => {
    requireFinite(requestedScale, label);
    const sign = requestedScale < 0 ? -1 : 1;
    return sign * Math.min(
      RASTER_TRANSFORM_MAXIMUM_ABS_SCALE,
      Math.max(RASTER_TRANSFORM_MINIMUM_ABS_SCALE, Math.abs(requestedScale)),
    );
  };
  const scaleX = normalizedScale(transform.scaleX ?? legacyScale, "scaleX");
  const scaleY = normalizedScale(transform.scaleY ?? legacyScale, "scaleY");
  // A single value cannot describe an anisotropic transform. Keep the legacy
  // field deterministic by treating it as the horizontal-axis alias; old
  // uniform inputs still round-trip exactly.
  const scale = scaleX;
  const rotation = normalizedAngle(requireFinite(transform.rotation, "rotation"));
  return { translationX, translationY, scale, scaleX, scaleY, rotation };
}

export function rasterTransformInverseRows(
  transform: RasterTransformAffine,
): RasterTransformInverseRows {
  const normalized = normalizeRasterTransform(transform);
  const inverseScaleX = 1 / normalized.scaleX;
  const inverseScaleY = 1 / normalized.scaleY;
  const cosine = Math.cos(normalized.rotation);
  const sine = Math.sin(normalized.rotation);
  const canonicalZero = (value: number): number => value === 0 ? 0 : value;
  return {
    row0: [
      canonicalZero(cosine * inverseScaleX),
      canonicalZero(sine * inverseScaleX),
    ],
    row1: [
      canonicalZero(-sine * inverseScaleY),
      canonicalZero(cosine * inverseScaleY),
    ],
  };
}

export function rasterTransformPoint(
  point: RasterTransformPoint,
  sourcePivot: RasterTransformPoint,
  transform: RasterTransformAffine,
): RasterTransformPoint {
  const normalized = normalizeRasterTransform(transform);
  const pointX = requireFinite(point.x, "point.x");
  const pointY = requireFinite(point.y, "point.y");
  const pivotX = requireFinite(sourcePivot.x, "sourcePivot.x");
  const pivotY = requireFinite(sourcePivot.y, "sourcePivot.y");
  const localX = (pointX - pivotX) * normalized.scaleX;
  const localY = (pointY - pivotY) * normalized.scaleY;
  const cosine = Math.cos(normalized.rotation);
  const sine = Math.sin(normalized.rotation);
  return {
    x: pivotX + normalized.translationX + cosine * localX - sine * localY,
    y: pivotY + normalized.translationY + sine * localX + cosine * localY,
  };
}

export function rasterInverseTransformPoint(
  point: RasterTransformPoint,
  sourcePivot: RasterTransformPoint,
  transform: RasterTransformAffine,
): RasterTransformPoint {
  const normalized = normalizeRasterTransform(transform);
  const inverse = rasterTransformInverseRows(normalized);
  const destinationPivotX = sourcePivot.x + normalized.translationX;
  const destinationPivotY = sourcePivot.y + normalized.translationY;
  const deltaX = requireFinite(point.x, "point.x") - destinationPivotX;
  const deltaY = requireFinite(point.y, "point.y") - destinationPivotY;
  return {
    x: sourcePivot.x + inverse.row0[0] * deltaX + inverse.row0[1] * deltaY,
    y: sourcePivot.y + inverse.row1[0] * deltaX + inverse.row1[1] * deltaY,
  };
}

export function clipRasterTransformRect(
  rect: RasterTransformRect | null,
  documentWidth = RASTER_TRANSFORM_DOCUMENT_WIDTH,
  documentHeight = arguments.length < 2
    ? RASTER_TRANSFORM_DOCUMENT_HEIGHT
    : documentWidth,
): RasterTransformRect | null {
  if (!rect) return null;
  const width = requirePositiveInteger(documentWidth, "documentWidth");
  const height = requirePositiveInteger(documentHeight, "documentHeight");
  const candidate = validatedRect(rect, "rect");
  const x = Math.max(0, Math.floor(candidate.x));
  const y = Math.max(0, Math.floor(candidate.y));
  const right = Math.min(width, Math.ceil(rectRight(candidate)));
  const bottom = Math.min(height, Math.ceil(rectBottom(candidate)));
  return right > x && bottom > y
    ? { x, y, width: right - x, height: bottom - y }
    : null;
}

export function intersectRasterTransformRects(
  left: RasterTransformRect,
  right: RasterTransformRect,
): RasterTransformRect | null {
  const a = validatedRect(left, "left");
  const b = validatedRect(right, "right");
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const maximumX = Math.min(rectRight(a), rectRight(b));
  const maximumY = Math.min(rectBottom(a), rectBottom(b));
  return maximumX > x && maximumY > y
    ? { x, y, width: maximumX - x, height: maximumY - y }
    : null;
}

export function mergeRasterTransformRects(
  first: RasterTransformRect | null,
  second: RasterTransformRect | null,
  documentWidth = RASTER_TRANSFORM_DOCUMENT_WIDTH,
  documentHeight = arguments.length < 3
    ? RASTER_TRANSFORM_DOCUMENT_HEIGHT
    : documentWidth,
): RasterTransformRect | null {
  const left = clipRasterTransformRect(first, documentWidth, documentHeight);
  const right = clipRasterTransformRect(second, documentWidth, documentHeight);
  if (!left) return right;
  if (!right) return left;
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const maximumX = Math.max(rectRight(left), rectRight(right));
  const maximumY = Math.max(rectBottom(left), rectBottom(right));
  return {
    x,
    y,
    width: maximumX - x,
    height: maximumY - y,
  };
}

/** AABB of the transformed source rectangle, including filtering safety pad. */
export function rasterTransformBounds(
  sourceBounds: RasterTransformRect | null,
  sourcePivot: RasterTransformPoint,
  transform: RasterTransformAffine,
  options: {
    documentSize?: number;
    documentWidth?: number;
    documentHeight?: number;
    padding?: number;
  } = {},
): RasterTransformRect | null {
  if (!sourceBounds) return null;
  const source = validatedRect(sourceBounds, "sourceBounds");
  const documentWidth = options.documentWidth
    ?? options.documentSize
    ?? RASTER_TRANSFORM_DOCUMENT_WIDTH;
  const documentHeight = options.documentHeight
    ?? options.documentSize
    ?? RASTER_TRANSFORM_DOCUMENT_HEIGHT;
  requirePositiveInteger(documentWidth, "documentWidth");
  requirePositiveInteger(documentHeight, "documentHeight");
  const padding = requireFinite(
    options.padding ?? RASTER_TRANSFORM_FILTER_PADDING_PX,
    "padding",
  );
  if (padding < 0) throw new Error("padding cannot be negative.");
  const corners = [
    { x: source.x, y: source.y },
    { x: rectRight(source), y: source.y },
    { x: rectRight(source), y: rectBottom(source) },
    { x: source.x, y: rectBottom(source) },
  ].map((point) => rasterTransformPoint(point, sourcePivot, transform));
  const minimumX = Math.min(...corners.map((point) => point.x));
  const minimumY = Math.min(...corners.map((point) => point.y));
  const maximumX = Math.max(...corners.map((point) => point.x));
  const maximumY = Math.max(...corners.map((point) => point.y));
  return clipRasterTransformRect({
    x: Math.floor(minimumX - padding),
    y: Math.floor(minimumY - padding),
    width: Math.ceil(maximumX + padding) - Math.floor(minimumX - padding),
    height: Math.ceil(maximumY + padding) - Math.floor(minimumY - padding),
  }, documentWidth, documentHeight);
}

export function rasterTransformDirtyRect(
  previousBounds: RasterTransformRect | null,
  nextBounds: RasterTransformRect | null,
  documentWidth = RASTER_TRANSFORM_DOCUMENT_WIDTH,
  padding = RASTER_TRANSFORM_FILTER_PADDING_PX,
  documentHeight = arguments.length < 3
    ? RASTER_TRANSFORM_DOCUMENT_HEIGHT
    : documentWidth,
): RasterTransformRect | null {
  requirePositiveInteger(documentWidth, "documentWidth");
  requirePositiveInteger(documentHeight, "documentHeight");
  const safePadding = requireFinite(padding, "padding");
  if (safePadding < 0) throw new Error("padding cannot be negative.");
  const padded = (rect: RasterTransformRect | null): RasterTransformRect | null => rect
    ? {
      x: rect.x - safePadding,
      y: rect.y - safePadding,
      width: rect.width + safePadding * 2,
      height: rect.height + safePadding * 2,
    }
    : null;
  return mergeRasterTransformRects(
    padded(previousBounds),
    padded(nextBounds),
    documentWidth,
    documentHeight,
  );
}

/**
 * Destination-space support of the linear reconstruction kernel. Magnifying a
 * source texel also magnifies its half-texel filter radius; independent scales
 * make that support rectangular, then rotation projects it onto both
 * destination axes. Minification is already prefiltered by the mip pyramid and
 * needs only the fixed two-pixel reconstruction guard.
 */
export function rasterTransformSamplingPadding(
  transform: RasterTransformAffine,
): number {
  const normalized = normalizeRasterTransform(transform);
  const nearInteger = (value: number): boolean =>
    Math.abs(value - Math.round(value)) <= 1e-7;
  if (
    Math.abs(normalized.scaleX - 1) <= 1e-7
    && Math.abs(normalized.scaleY - 1) <= 1e-7
    && Math.abs(normalized.rotation) <= 1e-7
    && nearInteger(normalized.translationX)
    && nearInteger(normalized.translationY)
  ) {
    // Pixel centres map exactly to pixel centres. LOD 0 therefore performs a
    // byte-equivalent texel copy and has no reconstruction fringe to reserve.
    return 0;
  }
  const absoluteScaleX = Math.abs(normalized.scaleX);
  const absoluteScaleY = Math.abs(normalized.scaleY);
  const absoluteCosine = Math.abs(Math.cos(normalized.rotation));
  const absoluteSine = Math.abs(Math.sin(normalized.rotation));
  const projectedSourceRadiusX = 0.5 * (
    absoluteCosine * absoluteScaleX + absoluteSine * absoluteScaleY
  );
  const projectedSourceRadiusY = 0.5 * (
    absoluteSine * absoluteScaleX + absoluteCosine * absoluteScaleY
  );
  return Math.ceil(Math.max(
    RASTER_TRANSFORM_FILTER_PADDING_PX,
    projectedSourceRadiusX + 1,
    projectedSourceRadiusY + 1,
  ));
}

export function rasterTransformSamplingBounds(
  sourceBounds: RasterTransformRect | null,
  sourcePivot: RasterTransformPoint,
  transform: RasterTransformAffine,
  documentWidth = RASTER_TRANSFORM_DOCUMENT_WIDTH,
  documentHeight = arguments.length < 4
    ? RASTER_TRANSFORM_DOCUMENT_HEIGHT
    : documentWidth,
): RasterTransformRect | null {
  return rasterTransformBounds(sourceBounds, sourcePivot, transform, {
    documentWidth,
    documentHeight,
    padding: rasterTransformSamplingPadding(transform),
  });
}

interface TileGridDimensions {
  readonly width: number;
  readonly height: number;
}

function tileGridDimensions(
  documentWidth: number,
  documentHeight: number,
  tileWidth: number,
  tileHeight: number,
): TileGridDimensions {
  const width = requirePositiveInteger(documentWidth, "documentWidth");
  const height = requirePositiveInteger(documentHeight, "documentHeight");
  const horizontalExtent = requirePositiveInteger(tileWidth, "tileWidth");
  const verticalExtent = requirePositiveInteger(tileHeight, "tileHeight");
  return {
    width: Math.ceil(width / horizontalExtent),
    height: Math.ceil(height / verticalExtent),
  };
}

function expectedTileMaskWords(grid: TileGridDimensions): number {
  return Math.ceil(grid.width * grid.height / 32);
}

function requireTileMask(
  mask: Uint32Array,
  documentWidth: number,
  documentHeight: number,
  tileWidth: number,
  tileHeight: number,
): TileGridDimensions {
  const grid = tileGridDimensions(
    documentWidth,
    documentHeight,
    tileWidth,
    tileHeight,
  );
  const expectedWords = expectedTileMaskWords(grid);
  if (mask.length !== expectedWords) {
    throw new Error(`Invalid tile mask: ${mask.length} words, expected ${expectedWords}.`);
  }
  return grid;
}

function tileIsSet(mask: Uint32Array, tileIndex: number): boolean {
  return ((mask[tileIndex >>> 5] >>> (tileIndex & 31)) & 1) !== 0;
}

function setTile(mask: Uint32Array, tileIndex: number): void {
  const wordIndex = tileIndex >>> 5;
  mask[wordIndex] = (mask[wordIndex] | ((1 << (tileIndex & 31)) >>> 0)) >>> 0;
}

function markRectTiles(
  mask: Uint32Array,
  rect: RasterTransformRect,
  grid: TileGridDimensions,
  tileWidth: number,
  tileHeight: number,
): void {
  const firstTileX = Math.max(0, Math.floor(rect.x / tileWidth));
  const firstTileY = Math.max(0, Math.floor(rect.y / tileHeight));
  const lastTileX = Math.min(grid.width, Math.ceil(rectRight(rect) / tileWidth));
  const lastTileY = Math.min(grid.height, Math.ceil(rectBottom(rect) / tileHeight));
  for (let tileY = firstTileY; tileY < lastTileY; tileY += 1) {
    for (let tileX = firstTileX; tileX < lastTileX; tileX += 1) {
      setTile(mask, tileY * grid.width + tileX);
    }
  }
}

export function rasterTransformTileIndices(
  mask: Uint32Array,
  documentWidth = RASTER_TRANSFORM_DOCUMENT_WIDTH,
  tileWidth = RASTER_TRANSFORM_TILE_WIDTH,
  documentHeight = arguments.length < 2
    ? RASTER_TRANSFORM_DOCUMENT_HEIGHT
    : documentWidth,
  tileHeight = arguments.length < 3
    ? RASTER_TRANSFORM_TILE_HEIGHT
    : tileWidth,
): number[] {
  const grid = requireTileMask(
    mask,
    documentWidth,
    documentHeight,
    tileWidth,
    tileHeight,
  );
  const indices: number[] = [];
  for (let tileIndex = 0; tileIndex < grid.width * grid.height; tileIndex += 1) {
    if (tileIsSet(mask, tileIndex)) indices.push(tileIndex);
  }
  return indices;
}

/**
 * Tile-aligned immutable scratch domain. It contains complete source tiles so
 * an exact replay can hydrate the same rectangle from a tiled history seed.
 */
export function rasterTransformScratchRect(
  sourceMask: Uint32Array,
  documentWidth = RASTER_TRANSFORM_DOCUMENT_WIDTH,
  tileWidth = RASTER_TRANSFORM_TILE_WIDTH,
  documentHeight = arguments.length < 2
    ? RASTER_TRANSFORM_DOCUMENT_HEIGHT
    : documentWidth,
  tileHeight = arguments.length < 3
    ? RASTER_TRANSFORM_TILE_HEIGHT
    : tileWidth,
): RasterTransformRect | null {
  const grid = requireTileMask(
    sourceMask,
    documentWidth,
    documentHeight,
    tileWidth,
    tileHeight,
  );
  let minimumTileX = grid.width;
  let minimumTileY = grid.height;
  let maximumTileX = -1;
  let maximumTileY = -1;
  for (const tileIndex of rasterTransformTileIndices(
    sourceMask,
    documentWidth,
    tileWidth,
    documentHeight,
    tileHeight,
  )) {
    const tileX = tileIndex % grid.width;
    const tileY = Math.floor(tileIndex / grid.width);
    minimumTileX = Math.min(minimumTileX, tileX);
    minimumTileY = Math.min(minimumTileY, tileY);
    maximumTileX = Math.max(maximumTileX, tileX);
    maximumTileY = Math.max(maximumTileY, tileY);
  }
  return maximumTileX >= minimumTileX && maximumTileY >= minimumTileY
    ? {
      x: minimumTileX * tileWidth,
      y: minimumTileY * tileHeight,
      width: Math.min(documentWidth, (maximumTileX + 1) * tileWidth)
        - minimumTileX * tileWidth,
      height: Math.min(documentHeight, (maximumTileY + 1) * tileHeight)
        - minimumTileY * tileHeight,
    }
    : null;
}

/**
 * Accende nella maschera ogni tile che tocca `rect`, restituendo una copia.
 *
 * Serve a garantire l'invariante che il resto del Trasforma da' per scontata:
 * **il contenuto dichiarato deve stare dentro i tile dichiarati**. I due valori
 * nascono da calcoli diversi — i bounds sono continui, la maschera e' per tile
 * proiettata tile per tile — e divergono di pochi pixel a ogni Applica. Basta
 * un pixel di sforo e la riapertura muore su "sourceContentBounds deve essere
 * contenuto nello scratch", perche' lo scratch si deriva dalla maschera:
 * misurato dopo due Applica, contenuto `0,0 903x490` contro maschera
 * `0,0 896x512`, sette pixel fuori a destra.
 *
 * La maschera puo' solo **crescere**: nel dubbio si salva un tile in piu' in
 * cold storage, mai un pixel in meno.
 */
export function tileMaskCoveringRect(
  mask: Uint32Array,
  rect: RasterTransformRect | null,
  documentWidth = RASTER_TRANSFORM_DOCUMENT_WIDTH,
  tileWidth = RASTER_TRANSFORM_TILE_WIDTH,
  documentHeight = arguments.length < 3
    ? RASTER_TRANSFORM_DOCUMENT_HEIGHT
    : documentWidth,
  tileHeight = arguments.length < 4
    ? RASTER_TRANSFORM_TILE_HEIGHT
    : tileWidth,
): Uint32Array {
  const grid = requireTileMask(
    mask,
    documentWidth,
    documentHeight,
    tileWidth,
    tileHeight,
  );
  const covering = mask.slice();
  if (!rect) return covering;
  const clipped = clipRasterTransformRect(rect, documentWidth, documentHeight);
  if (!clipped) return covering;
  const firstTileX = Math.floor(clipped.x / tileWidth);
  const firstTileY = Math.floor(clipped.y / tileHeight);
  // `rectRight` e' esclusivo: l'ultimo pixel e' `right - 1`, e prendere il tile
  // di `right` accenderebbe una colonna vuota su un bordo allineato.
  const lastTileX = Math.floor((rectRight(clipped) - 1) / tileWidth);
  const lastTileY = Math.floor((rectBottom(clipped) - 1) / tileHeight);
  for (let tileY = firstTileY; tileY <= lastTileY; tileY += 1) {
    for (let tileX = firstTileX; tileX <= lastTileX; tileX += 1) {
      const tileIndex = tileY * grid.width + tileX;
      covering[tileIndex >>> 5] |= 1 << (tileIndex & 31);
    }
  }
  return covering;
}

/**
 * Projects every occupied source tile separately. A transformed sparse mask
 * therefore stays sparse instead of degenerating into the AABB of all content.
 */
export function rasterTransformTileMask(
  sourceMask: Uint32Array,
  sourceBounds: RasterTransformRect | null,
  sourcePivot: RasterTransformPoint,
  transform: RasterTransformAffine,
  options: {
    documentSize?: number;
    documentWidth?: number;
    documentHeight?: number;
    tileSize?: number;
    tileWidth?: number;
    tileHeight?: number;
    padding?: number;
  } = {},
): Uint32Array {
  const documentWidth = options.documentWidth
    ?? options.documentSize
    ?? RASTER_TRANSFORM_DOCUMENT_WIDTH;
  const documentHeight = options.documentHeight
    ?? options.documentSize
    ?? RASTER_TRANSFORM_DOCUMENT_HEIGHT;
  const tileWidth = options.tileWidth
    ?? options.tileSize
    ?? RASTER_TRANSFORM_TILE_WIDTH;
  const tileHeight = options.tileHeight
    ?? options.tileSize
    ?? RASTER_TRANSFORM_TILE_HEIGHT;
  const grid = requireTileMask(
    sourceMask,
    documentWidth,
    documentHeight,
    tileWidth,
    tileHeight,
  );
  const result = new Uint32Array(expectedTileMaskWords(grid));
  const clippedSourceBounds = clipRasterTransformRect(
    sourceBounds,
    documentWidth,
    documentHeight,
  );
  if (!clippedSourceBounds) return result;

  for (const tileIndex of rasterTransformTileIndices(
    sourceMask,
    documentWidth,
    tileWidth,
    documentHeight,
    tileHeight,
  )) {
    const tileX = tileIndex % grid.width;
    const tileY = Math.floor(tileIndex / grid.width);
    const tileOriginX = tileX * tileWidth;
    const tileOriginY = tileY * tileHeight;
    const occupiedPart = intersectRasterTransformRects(
      {
        x: tileOriginX,
        y: tileOriginY,
        width: Math.min(tileWidth, documentWidth - tileOriginX),
        height: Math.min(tileHeight, documentHeight - tileOriginY),
      },
      clippedSourceBounds,
    );
    if (!occupiedPart) continue;
    const transformed = rasterTransformBounds(
      occupiedPart,
      sourcePivot,
      transform,
      {
        documentWidth,
        documentHeight,
        padding: options.padding ?? RASTER_TRANSFORM_FILTER_PADDING_PX,
      },
    );
    if (transformed) {
      markRectTiles(result, transformed, grid, tileWidth, tileHeight);
    }
  }
  return result;
}

/** Packs the stable 64-byte transform prefix plus the document-extent slot. */
export function packRasterTransformUniforms(
  input: RasterTransformUniformInput,
  target: Float32Array = new Float32Array(RASTER_TRANSFORM_UNIFORM_BYTES / 4),
): Float32Array {
  if (target.byteLength !== RASTER_TRANSFORM_UNIFORM_BYTES) {
    throw new Error(
      `Invalid Transform uniform: ${target.byteLength} B, `
      + `expected ${RASTER_TRANSFORM_UNIFORM_BYTES} B.`,
    );
  }
  const scratch = validatedRect(input.sourceScratchRect, "sourceScratchRect");
  const content = validatedRect(input.sourceContentBounds, "sourceContentBounds");
  const scratchRight = rectRight(scratch);
  const scratchBottom = rectBottom(scratch);
  if (
    content.x < scratch.x
    || content.y < scratch.y
    || rectRight(content) > scratchRight
    || rectBottom(content) > scratchBottom
  ) {
    throw new Error("sourceContentBounds must be contained within the scratch area.");
  }
  const pivotX = requireFinite(input.sourcePivot.x, "sourcePivot.x");
  const pivotY = requireFinite(input.sourcePivot.y, "sourcePivot.y");
  const transform = normalizeRasterTransform(input.transform);
  const inverse = rasterTransformInverseRows(transform);

  target[0] = scratch.x;
  target[1] = scratch.y;
  target[2] = scratch.width;
  target[3] = scratch.height;
  target[4] = content.x;
  target[5] = content.y;
  target[6] = rectRight(content);
  target[7] = rectBottom(content);
  target[8] = pivotX;
  target[9] = pivotY;
  target[10] = pivotX + transform.translationX;
  target[11] = pivotY + transform.translationY;
  target[12] = inverse.row0[0];
  target[13] = inverse.row0[1];
  target[14] = inverse.row1[0];
  target[15] = inverse.row1[1];
  target[16] = requirePositiveInteger(
    input.documentWidth ?? RASTER_TRANSFORM_DOCUMENT_WIDTH,
    "documentWidth",
  );
  target[17] = requirePositiveInteger(
    input.documentHeight ?? RASTER_TRANSFORM_DOCUMENT_HEIGHT,
    "documentHeight",
  );
  target[18] = 0;
  target[19] = 0;
  return target;
}
