/**
 * Pure geometry for a transactional raster-layer transform.
 *
 * The transform is expressed in document pixels and always samples one
 * immutable source. Keeping this module free of DOM/WebGPU objects makes the
 * dirty bounds, sparse tile projection and shader ABI independently testable.
 */

export const RASTER_TRANSFORM_MATH_STRATEGY =
  "document-space-uniform-affine-scale-aware-sampling-per-source-tile-mask-v2" as const;

export const RASTER_TRANSFORM_DOCUMENT_SIZE = 4096;
export const RASTER_TRANSFORM_TILE_SIZE = 256;
export const RASTER_TRANSFORM_FILTER_PADDING_PX = 2;
export const RASTER_TRANSFORM_MINIMUM_ABS_SCALE = 0.01;
export const RASTER_TRANSFORM_MAXIMUM_ABS_SCALE = 64;
export const RASTER_TRANSFORM_UNIFORM_BYTES = 64;

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

/** Uniform scale, clockwise-positive rotation in the document's Y-down space. */
export interface RasterTransformAffine {
  translationX: number;
  translationY: number;
  scale: number;
  rotation: number;
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
}

function requireFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} deve essere finito.`);
  }
  return value;
}

function requirePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} deve essere un intero positivo sicuro.`);
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
    throw new Error(`${label} deve avere larghezza e altezza positive.`);
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
  transform: RasterTransformAffine,
): RasterTransformAffine {
  const translationX = requireFinite(transform.translationX, "translationX");
  const translationY = requireFinite(transform.translationY, "translationY");
  const requestedScale = requireFinite(transform.scale, "scale");
  const sign = requestedScale < 0 ? -1 : 1;
  const scale = sign * Math.min(
    RASTER_TRANSFORM_MAXIMUM_ABS_SCALE,
    Math.max(RASTER_TRANSFORM_MINIMUM_ABS_SCALE, Math.abs(requestedScale)),
  );
  const rotation = normalizedAngle(requireFinite(transform.rotation, "rotation"));
  return { translationX, translationY, scale, rotation };
}

export function rasterTransformInverseRows(
  transform: RasterTransformAffine,
): RasterTransformInverseRows {
  const normalized = normalizeRasterTransform(transform);
  const inverseScale = 1 / normalized.scale;
  const cosine = Math.cos(normalized.rotation);
  const sine = Math.sin(normalized.rotation);
  const canonicalZero = (value: number): number => value === 0 ? 0 : value;
  return {
    row0: [
      canonicalZero(cosine * inverseScale),
      canonicalZero(sine * inverseScale),
    ],
    row1: [
      canonicalZero(-sine * inverseScale),
      canonicalZero(cosine * inverseScale),
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
  const localX = (pointX - pivotX) * normalized.scale;
  const localY = (pointY - pivotY) * normalized.scale;
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
  documentSize = RASTER_TRANSFORM_DOCUMENT_SIZE,
): RasterTransformRect | null {
  if (!rect) return null;
  const size = requirePositiveInteger(documentSize, "documentSize");
  const candidate = validatedRect(rect, "rect");
  const x = Math.max(0, Math.floor(candidate.x));
  const y = Math.max(0, Math.floor(candidate.y));
  const right = Math.min(size, Math.ceil(rectRight(candidate)));
  const bottom = Math.min(size, Math.ceil(rectBottom(candidate)));
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
  documentSize = RASTER_TRANSFORM_DOCUMENT_SIZE,
): RasterTransformRect | null {
  const left = clipRasterTransformRect(first, documentSize);
  const right = clipRasterTransformRect(second, documentSize);
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
    padding?: number;
  } = {},
): RasterTransformRect | null {
  if (!sourceBounds) return null;
  const source = validatedRect(sourceBounds, "sourceBounds");
  const documentSize = options.documentSize ?? RASTER_TRANSFORM_DOCUMENT_SIZE;
  requirePositiveInteger(documentSize, "documentSize");
  const padding = requireFinite(
    options.padding ?? RASTER_TRANSFORM_FILTER_PADDING_PX,
    "padding",
  );
  if (padding < 0) throw new Error("padding non può essere negativo.");
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
  }, documentSize);
}

export function rasterTransformDirtyRect(
  previousBounds: RasterTransformRect | null,
  nextBounds: RasterTransformRect | null,
  documentSize = RASTER_TRANSFORM_DOCUMENT_SIZE,
  padding = RASTER_TRANSFORM_FILTER_PADDING_PX,
): RasterTransformRect | null {
  requirePositiveInteger(documentSize, "documentSize");
  const safePadding = requireFinite(padding, "padding");
  if (safePadding < 0) throw new Error("padding non può essere negativo.");
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
    documentSize,
  );
}

/**
 * Destination-space support of the linear reconstruction kernel. Magnifying a
 * source texel also magnifies its half-texel filter radius; rotation projects
 * that square onto both destination axes. Minification is already prefiltered
 * by the mip pyramid and needs only the fixed two-pixel reconstruction guard.
 */
export function rasterTransformSamplingPadding(
  transform: RasterTransformAffine,
): number {
  const normalized = normalizeRasterTransform(transform);
  const nearInteger = (value: number): boolean =>
    Math.abs(value - Math.round(value)) <= 1e-7;
  if (
    Math.abs(normalized.scale - 1) <= 1e-7
    && Math.abs(normalized.rotation) <= 1e-7
    && nearInteger(normalized.translationX)
    && nearInteger(normalized.translationY)
  ) {
    // Pixel centres map exactly to pixel centres. LOD 0 therefore performs a
    // byte-equivalent texel copy and has no reconstruction fringe to reserve.
    return 0;
  }
  const absoluteScale = Math.abs(normalized.scale);
  const projectedSourceRadius = absoluteScale * 0.5 * (
    Math.abs(Math.cos(normalized.rotation))
    + Math.abs(Math.sin(normalized.rotation))
  );
  return Math.ceil(Math.max(
    RASTER_TRANSFORM_FILTER_PADDING_PX,
    projectedSourceRadius + 1,
  ));
}

export function rasterTransformSamplingBounds(
  sourceBounds: RasterTransformRect | null,
  sourcePivot: RasterTransformPoint,
  transform: RasterTransformAffine,
  documentSize = RASTER_TRANSFORM_DOCUMENT_SIZE,
): RasterTransformRect | null {
  return rasterTransformBounds(sourceBounds, sourcePivot, transform, {
    documentSize,
    padding: rasterTransformSamplingPadding(transform),
  });
}

function tileGridSize(documentSize: number, tileSize: number): number {
  const size = requirePositiveInteger(documentSize, "documentSize");
  const tile = requirePositiveInteger(tileSize, "tileSize");
  if (size % tile !== 0) {
    throw new Error("documentSize deve essere divisibile esattamente per tileSize.");
  }
  return size / tile;
}

function expectedTileMaskWords(gridSize: number): number {
  return Math.ceil(gridSize * gridSize / 32);
}

function requireTileMask(
  mask: Uint32Array,
  documentSize: number,
  tileSize: number,
): number {
  const gridSize = tileGridSize(documentSize, tileSize);
  const expectedWords = expectedTileMaskWords(gridSize);
  if (mask.length !== expectedWords) {
    throw new Error(`Maschera tile non valida: ${mask.length} word, attese ${expectedWords}.`);
  }
  return gridSize;
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
  gridSize: number,
  tileSize: number,
): void {
  const firstTileX = Math.max(0, Math.floor(rect.x / tileSize));
  const firstTileY = Math.max(0, Math.floor(rect.y / tileSize));
  const lastTileX = Math.min(gridSize, Math.ceil(rectRight(rect) / tileSize));
  const lastTileY = Math.min(gridSize, Math.ceil(rectBottom(rect) / tileSize));
  for (let tileY = firstTileY; tileY < lastTileY; tileY += 1) {
    for (let tileX = firstTileX; tileX < lastTileX; tileX += 1) {
      setTile(mask, tileY * gridSize + tileX);
    }
  }
}

export function rasterTransformTileIndices(
  mask: Uint32Array,
  documentSize = RASTER_TRANSFORM_DOCUMENT_SIZE,
  tileSize = RASTER_TRANSFORM_TILE_SIZE,
): number[] {
  const gridSize = requireTileMask(mask, documentSize, tileSize);
  const indices: number[] = [];
  for (let tileIndex = 0; tileIndex < gridSize * gridSize; tileIndex += 1) {
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
  documentSize = RASTER_TRANSFORM_DOCUMENT_SIZE,
  tileSize = RASTER_TRANSFORM_TILE_SIZE,
): RasterTransformRect | null {
  const gridSize = requireTileMask(sourceMask, documentSize, tileSize);
  let minimumTileX = gridSize;
  let minimumTileY = gridSize;
  let maximumTileX = -1;
  let maximumTileY = -1;
  for (const tileIndex of rasterTransformTileIndices(sourceMask, documentSize, tileSize)) {
    const tileX = tileIndex % gridSize;
    const tileY = Math.floor(tileIndex / gridSize);
    minimumTileX = Math.min(minimumTileX, tileX);
    minimumTileY = Math.min(minimumTileY, tileY);
    maximumTileX = Math.max(maximumTileX, tileX);
    maximumTileY = Math.max(maximumTileY, tileY);
  }
  return maximumTileX >= minimumTileX && maximumTileY >= minimumTileY
    ? {
      x: minimumTileX * tileSize,
      y: minimumTileY * tileSize,
      width: (maximumTileX - minimumTileX + 1) * tileSize,
      height: (maximumTileY - minimumTileY + 1) * tileSize,
    }
    : null;
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
    tileSize?: number;
    padding?: number;
  } = {},
): Uint32Array {
  const documentSize = options.documentSize ?? RASTER_TRANSFORM_DOCUMENT_SIZE;
  const tileSize = options.tileSize ?? RASTER_TRANSFORM_TILE_SIZE;
  const gridSize = requireTileMask(sourceMask, documentSize, tileSize);
  const result = new Uint32Array(expectedTileMaskWords(gridSize));
  const clippedSourceBounds = clipRasterTransformRect(sourceBounds, documentSize);
  if (!clippedSourceBounds) return result;

  for (const tileIndex of rasterTransformTileIndices(sourceMask, documentSize, tileSize)) {
    const tileX = tileIndex % gridSize;
    const tileY = Math.floor(tileIndex / gridSize);
    const occupiedPart = intersectRasterTransformRects(
      {
        x: tileX * tileSize,
        y: tileY * tileSize,
        width: tileSize,
        height: tileSize,
      },
      clippedSourceBounds,
    );
    if (!occupiedPart) continue;
    const transformed = rasterTransformBounds(
      occupiedPart,
      sourcePivot,
      transform,
      {
        documentSize,
        padding: options.padding ?? RASTER_TRANSFORM_FILTER_PADDING_PX,
      },
    );
    if (transformed) markRectTiles(result, transformed, gridSize, tileSize);
  }
  return result;
}

/** Packs the exact 64-byte ABI consumed by `rasterTransformShader`. */
export function packRasterTransformUniforms(
  input: RasterTransformUniformInput,
  target: Float32Array = new Float32Array(RASTER_TRANSFORM_UNIFORM_BYTES / 4),
): Float32Array {
  if (target.byteLength !== RASTER_TRANSFORM_UNIFORM_BYTES) {
    throw new Error(
      `Uniform Trasforma non valida: ${target.byteLength} B, `
      + `attesi ${RASTER_TRANSFORM_UNIFORM_BYTES} B.`,
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
    throw new Error("sourceContentBounds deve essere contenuto nello scratch.");
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
  return target;
}
