/** Pure geometry and vertex packing for raster Warp and Perspective. */
import {
  clipRasterTransformRect,
  rasterTransformPoint,
  type RasterTransformAffine,
  type RasterTransformPoint,
  type RasterTransformRect,
} from "./raster-transform-math.ts";

export const RASTER_WARP_GRID_SIZES = [3, 4, 5] as const;
export type RasterWarpGridSize = (typeof RASTER_WARP_GRID_SIZES)[number];
export type RasterTransformMode = "affine" | "warp" | "perspective";
export type RasterTransformControlPoint = RasterTransformPoint;
export const RASTER_WARP_BEZIER_HANDLE_COUNT = 8;
/**
 * Two independent Bézier tangents per extreme corner, ordered as:
 * TL→right, TL→down, TR→left, TR→down, BL→right, BL→up, BR→left, BR→up.
 */
export type RasterWarpBezierHandles = readonly [
  RasterTransformControlPoint,
  RasterTransformControlPoint,
  RasterTransformControlPoint,
  RasterTransformControlPoint,
  RasterTransformControlPoint,
  RasterTransformControlPoint,
  RasterTransformControlPoint,
  RasterTransformControlPoint,
];
export interface RasterWarpSurfaceParameter {
  readonly u: number;
  readonly v: number;
}

export const RASTER_DEFORM_VERTEX_FLOATS = 5;
/** Dense enough to keep the Catmull-Rom Warp surface visually continuous at high zoom. */
export const RASTER_WARP_RENDER_SUBDIVISIONS = 16;
/** Local-cell emphasis: the touched cell moves much more than distant cells. */
export const RASTER_WARP_INFLUENCE_RADIUS_CELLS = 0.9;
export const RASTER_DEFORM_MAX_VERTICES =
  ((5 - 1) * RASTER_WARP_RENDER_SUBDIVISIONS) ** 2 * 6;
export const RASTER_DEFORM_MAX_VERTEX_BYTES =
  RASTER_DEFORM_MAX_VERTICES * RASTER_DEFORM_VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT;

const IDENTITY_AFFINE: RasterTransformAffine = {
  translationX: 0,
  translationY: 0,
  scale: 1,
  rotation: 0,
};

function finitePoint(
  point: Readonly<RasterTransformControlPoint>,
  label: string,
): RasterTransformControlPoint {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error(`${label} deve contenere coordinate finite.`);
  }
  return { x: point.x, y: point.y };
}

export function isRasterWarpGridSize(value: number): value is RasterWarpGridSize {
  return value === 3 || value === 4 || value === 5;
}

export function rasterDeformGridSize(
  mode: RasterTransformMode,
  warpGridSize: RasterWarpGridSize,
): number {
  return mode === "perspective" ? 2 : warpGridSize;
}

export function rasterDeformPointCount(
  mode: RasterTransformMode,
  warpGridSize: RasterWarpGridSize,
): number {
  if (mode === "affine") return 0;
  const size = rasterDeformGridSize(mode, warpGridSize);
  return size * size;
}

export function rasterDeformInitialPoints(
  bounds: Readonly<RasterTransformRect>,
  mode: Exclude<RasterTransformMode, "affine">,
  warpGridSize: RasterWarpGridSize,
  transform: Readonly<RasterTransformAffine> = IDENTITY_AFFINE,
): RasterTransformControlPoint[] {
  const size = rasterDeformGridSize(mode, warpGridSize);
  const pivot = {
    x: bounds.x + bounds.width * 0.5,
    y: bounds.y + bounds.height * 0.5,
  };
  const points: RasterTransformControlPoint[] = [];
  for (let row = 0; row < size; row += 1) {
    const y = bounds.y + bounds.height * row / (size - 1);
    for (let column = 0; column < size; column += 1) {
      const x = bounds.x + bounds.width * column / (size - 1);
      points.push(rasterTransformPoint({ x, y }, pivot, transform));
    }
  }
  return points;
}

export function normalizeRasterDeformPoints(
  points: readonly Readonly<RasterTransformControlPoint>[],
  mode: Exclude<RasterTransformMode, "affine">,
  warpGridSize: RasterWarpGridSize,
): RasterTransformControlPoint[] {
  const expected = rasterDeformPointCount(mode, warpGridSize);
  if (points.length !== expected) {
    throw new Error(
      `Punti ${mode} non validi: ricevuti ${points.length}, attesi ${expected}.`,
    );
  }
  return points.map((point, index) => finitePoint(point, `Punto ${index + 1}`));
}

export function rasterDeformBounds(
  points: readonly Readonly<RasterTransformControlPoint>[],
  documentWidth: number,
  documentHeight: number,
  padding = 0,
): RasterTransformRect | null {
  if (points.length === 0) return null;
  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < points.length; index += 1) {
    const point = finitePoint(points[index], `Punto ${index + 1}`);
    minimumX = Math.min(minimumX, point.x);
    minimumY = Math.min(minimumY, point.y);
    maximumX = Math.max(maximumX, point.x);
    maximumY = Math.max(maximumY, point.y);
  }
  const safePadding = Number.isFinite(padding) ? Math.max(0, padding) : 0;
  return clipRasterTransformRect(
    {
      x: minimumX - safePadding,
      y: minimumY - safePadding,
      width: maximumX - minimumX + safePadding * 2,
      height: maximumY - minimumY + safePadding * 2,
    },
    documentWidth,
    documentHeight,
  );
}

export function rasterDeformCenter(
  points: readonly Readonly<RasterTransformControlPoint>[],
): RasterTransformControlPoint {
  if (points.length === 0) return { x: 0, y: 0 };
  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < points.length; index += 1) {
    const point = finitePoint(points[index], `Punto ${index + 1}`);
    minimumX = Math.min(minimumX, point.x);
    minimumY = Math.min(minimumY, point.y);
    maximumX = Math.max(maximumX, point.x);
    maximumY = Math.max(maximumY, point.y);
  }
  return { x: (minimumX + maximumX) * 0.5, y: (minimumY + maximumY) * 0.5 };
}

export function translateRasterDeformPoints(
  points: readonly Readonly<RasterTransformControlPoint>[],
  deltaX: number,
  deltaY: number,
): RasterTransformControlPoint[] {
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
    throw new Error("Lo spostamento dei punti Warp deve essere finito.");
  }
  return points.map((point, index) => {
    const finite = finitePoint(point, `Punto ${index + 1}`);
    return { x: finite.x + deltaX, y: finite.y + deltaY };
  });
}

function bilinearPoint(
  topLeft: Readonly<RasterTransformControlPoint>,
  topRight: Readonly<RasterTransformControlPoint>,
  bottomLeft: Readonly<RasterTransformControlPoint>,
  bottomRight: Readonly<RasterTransformControlPoint>,
  u: number,
  v: number,
): RasterTransformControlPoint {
  const topX = topLeft.x + (topRight.x - topLeft.x) * u;
  const topY = topLeft.y + (topRight.y - topLeft.y) * u;
  const bottomX = bottomLeft.x + (bottomRight.x - bottomLeft.x) * u;
  const bottomY = bottomLeft.y + (bottomRight.y - bottomLeft.y) * u;
  return {
    x: topX + (bottomX - topX) * v,
    y: topY + (bottomY - topY) * v,
  };
}

function catmullRom(
  previous: number,
  start: number,
  end: number,
  next: number,
  amount: number,
): number {
  const amountSquared = amount * amount;
  const amountCubed = amountSquared * amount;
  return 0.5 * (
    2 * start
    + (-previous + end) * amount
    + (2 * previous - 5 * start + 4 * end - next) * amountSquared
    + (-previous + 3 * start - 3 * end + next) * amountCubed
  );
}

function extrapolatePoint(
  edge: Readonly<RasterTransformControlPoint>,
  neighbor: Readonly<RasterTransformControlPoint>,
): RasterTransformControlPoint {
  return {
    x: edge.x * 2 - neighbor.x,
    y: edge.y * 2 - neighbor.y,
  };
}

function pointToward(
  start: Readonly<RasterTransformControlPoint>,
  end: Readonly<RasterTransformControlPoint>,
  amount: number,
): RasterTransformControlPoint {
  return {
    x: start.x + (end.x - start.x) * amount,
    y: start.y + (end.y - start.y) * amount,
  };
}

export function rasterWarpDefaultBezierHandles(
  points: readonly Readonly<RasterTransformControlPoint>[],
  size: number,
): RasterWarpBezierHandles {
  if (!Number.isSafeInteger(size) || size < 2 || points.length !== size * size) {
    throw new Error("Griglia Warp non valida.");
  }
  const topLeft = finitePoint(points[0], "Angolo alto sinistro");
  const topRight = finitePoint(points[size - 1], "Angolo alto destro");
  const bottomLeftIndex = (size - 1) * size;
  const bottomRightIndex = size * size - 1;
  const bottomLeft = finitePoint(points[bottomLeftIndex], "Angolo basso sinistro");
  const bottomRight = finitePoint(points[bottomRightIndex], "Angolo basso destro");
  return [
    pointToward(topLeft, points[1], 1 / 3),
    pointToward(topLeft, points[size], 1 / 3),
    pointToward(topRight, points[size - 2], 1 / 3),
    pointToward(topRight, points[size * 2 - 1], 1 / 3),
    pointToward(bottomLeft, points[bottomLeftIndex + 1], 1 / 3),
    pointToward(bottomLeft, points[bottomLeftIndex - size], 1 / 3),
    pointToward(bottomRight, points[bottomRightIndex - 1], 1 / 3),
    pointToward(bottomRight, points[bottomRightIndex - size], 1 / 3),
  ];
}

export function normalizeRasterWarpBezierHandles(
  handles: readonly Readonly<RasterTransformControlPoint>[] | null | undefined,
  points: readonly Readonly<RasterTransformControlPoint>[],
  size: number,
): RasterWarpBezierHandles {
  if (!handles || handles.length === 0) {
    return rasterWarpDefaultBezierHandles(points, size);
  }
  if (handles.length !== RASTER_WARP_BEZIER_HANDLE_COUNT) {
    throw new Error("Warp richiede otto maniglie Bézier d’angolo.");
  }
  return handles.map((point, index) =>
    finitePoint(point, `Maniglia Bézier ${index + 1}`)) as unknown as RasterWarpBezierHandles;
}

export function rasterWarpBezierHandleAnchorIndex(
  size: number,
  handleIndex: number,
): number {
  if (!Number.isSafeInteger(size) || size < 2) {
    throw new Error("Griglia Warp non valida.");
  }
  if (
    !Number.isSafeInteger(handleIndex)
    || handleIndex < 0
    || handleIndex >= RASTER_WARP_BEZIER_HANDLE_COUNT
  ) {
    throw new Error("Indice maniglia Bézier Warp non valido.");
  }
  return [
    0,
    0,
    size - 1,
    size - 1,
    (size - 1) * size,
    (size - 1) * size,
    size * size - 1,
    size * size - 1,
  ][handleIndex];
}

export function moveRasterWarpBezierHandle(
  handles: readonly Readonly<RasterTransformControlPoint>[],
  points: readonly Readonly<RasterTransformControlPoint>[],
  size: number,
  handleIndex: number,
  target: Readonly<RasterTransformControlPoint>,
): RasterWarpBezierHandles {
  const normalized = normalizeRasterWarpBezierHandles(handles, points, size);
  const next = finitePoint(target, "Posizione maniglia Bézier");
  rasterWarpBezierHandleAnchorIndex(size, handleIndex);
  return normalized.map((handle, index) => index === handleIndex
    ? next
    : { ...handle }) as unknown as RasterWarpBezierHandles;
}

/** Preserves each authored tangent while the underlying Warp grid changes. */
export function remapRasterWarpBezierHandles(
  previousPoints: readonly Readonly<RasterTransformControlPoint>[],
  previousSize: number,
  nextPoints: readonly Readonly<RasterTransformControlPoint>[],
  nextSize: number,
  handles: readonly Readonly<RasterTransformControlPoint>[] | null | undefined,
  isolatedCornerIndex: number | null = null,
): RasterWarpBezierHandles {
  const normalized = normalizeRasterWarpBezierHandles(
    handles,
    previousPoints,
    previousSize,
  );
  const previousDefaults = rasterWarpDefaultBezierHandles(previousPoints, previousSize);
  const nextDefaults = rasterWarpDefaultBezierHandles(nextPoints, nextSize);
  return normalized.map((handle, index) => {
    const previousAnchorIndex = rasterWarpBezierHandleAnchorIndex(previousSize, index);
    const nextAnchorIndex = rasterWarpBezierHandleAnchorIndex(nextSize, index);
    if (isolatedCornerIndex === previousAnchorIndex) {
      return {
        x: handle.x + nextPoints[nextAnchorIndex].x - previousPoints[previousAnchorIndex].x,
        y: handle.y + nextPoints[nextAnchorIndex].y - previousPoints[previousAnchorIndex].y,
      };
    }
    const authored = Math.abs(handle.x - previousDefaults[index].x) > 1e-7
      || Math.abs(handle.y - previousDefaults[index].y) > 1e-7;
    if (authored) {
      return {
        x: nextPoints[nextAnchorIndex].x + handle.x - previousPoints[previousAnchorIndex].x,
        y: nextPoints[nextAnchorIndex].y + handle.y - previousPoints[previousAnchorIndex].y,
      };
    }
    return {
      ...nextDefaults[index],
    };
  }) as unknown as RasterWarpBezierHandles;
}

function previousFromBezierHandle(
  start: Readonly<RasterTransformControlPoint>,
  end: Readonly<RasterTransformControlPoint>,
  handle: Readonly<RasterTransformControlPoint>,
): RasterTransformControlPoint {
  return {
    x: end.x - 6 * (handle.x - start.x),
    y: end.y - 6 * (handle.y - start.y),
  };
}

function nextFromBezierHandle(
  start: Readonly<RasterTransformControlPoint>,
  end: Readonly<RasterTransformControlPoint>,
  handle: Readonly<RasterTransformControlPoint>,
): RasterTransformControlPoint {
  return {
    x: start.x + 6 * (end.x - handle.x),
    y: start.y + 6 * (end.y - handle.y),
  };
}

function sampleRasterWarpFlatRow(
  points: readonly Readonly<RasterTransformControlPoint>[],
  left: number,
  amount: number,
  startHandle: Readonly<RasterTransformControlPoint> | null = null,
  endHandle: Readonly<RasterTransformControlPoint> | null = null,
): RasterTransformControlPoint {
  const start = points[left];
  const end = points[left + 1];
  const previous = left > 0
    ? points[left - 1]
    : startHandle
      ? previousFromBezierHandle(start, end, startHandle)
      : extrapolatePoint(start, end);
  const next = left + 2 < points.length
    ? points[left + 2]
    : endHandle
      ? nextFromBezierHandle(start, end, endHandle)
      : extrapolatePoint(end, start);
  return {
    x: catmullRom(previous.x, start.x, end.x, next.x, amount),
    y: catmullRom(previous.y, start.y, end.y, next.y, amount),
  };
}

function sampleRasterWarpRow(
  points: readonly Readonly<RasterTransformControlPoint>[],
  size: number,
  row: number,
  left: number,
  amount: number,
  handles: RasterWarpBezierHandles,
): RasterTransformControlPoint {
  const rowOffset = row * size;
  const startHandle = row === 0
    ? handles[0]
    : row === size - 1
      ? handles[4]
      : null;
  const endHandle = row === 0
    ? handles[2]
    : row === size - 1
      ? handles[6]
      : null;
  const start = points[rowOffset + left];
  const end = points[rowOffset + left + 1];
  const previous = left > 0
    ? points[rowOffset + left - 1]
    : startHandle
      ? previousFromBezierHandle(start, end, startHandle)
      : extrapolatePoint(start, end);
  const next = left + 2 < size
    ? points[rowOffset + left + 2]
    : endHandle
      ? nextFromBezierHandle(start, end, endHandle)
      : extrapolatePoint(end, start);
  return {
    x: catmullRom(previous.x, start.x, end.x, next.x, amount),
    y: catmullRom(previous.y, start.y, end.y, next.y, amount),
  };
}

interface RasterWarpSurfaceSamplerContext {
  readonly points: readonly Readonly<RasterTransformControlPoint>[];
  readonly size: number;
  readonly handles: RasterWarpBezierHandles;
  readonly topGhostRow: readonly Readonly<RasterTransformControlPoint>[];
  readonly bottomGhostRow: readonly Readonly<RasterTransformControlPoint>[];
}

function createRasterWarpSurfaceSamplerContext(
  points: readonly Readonly<RasterTransformControlPoint>[],
  size: number,
  handles: readonly Readonly<RasterTransformControlPoint>[] | null | undefined,
): RasterWarpSurfaceSamplerContext {
  if (!Number.isSafeInteger(size) || size < 2 || points.length !== size * size) {
    throw new Error("Griglia Warp non valida.");
  }
  const normalizedHandles = normalizeRasterWarpBezierHandles(handles, points, size);
  const bottomOffset = (size - 1) * size;
  const topGhostRow: RasterTransformControlPoint[] = [];
  const bottomGhostRow: RasterTransformControlPoint[] = [];
  for (let column = 0; column < size; column += 1) {
    const top = points[column];
    const belowTop = points[size + column];
    const topHandle = column === 0
      ? normalizedHandles[1]
      : column === size - 1
        ? normalizedHandles[3]
        : pointToward(top, belowTop, 1 / 3);
    topGhostRow.push(previousFromBezierHandle(top, belowTop, topHandle));

    const bottom = points[bottomOffset + column];
    const aboveBottom = points[bottomOffset - size + column];
    const bottomHandle = column === 0
      ? normalizedHandles[5]
      : column === size - 1
        ? normalizedHandles[7]
        : pointToward(bottom, aboveBottom, 1 / 3);
    bottomGhostRow.push(nextFromBezierHandle(aboveBottom, bottom, bottomHandle));
  }
  return {
    points,
    size,
    handles: normalizedHandles,
    topGhostRow,
    bottomGhostRow,
  };
}

function sampleRasterWarpSurfaceFromContext(
  context: Readonly<RasterWarpSurfaceSamplerContext>,
  u: number,
  v: number,
): RasterTransformControlPoint {
  const { points, size, handles, topGhostRow, bottomGhostRow } = context;
  const scaledX = Math.min(size - 1, Math.max(0, u * (size - 1)));
  const scaledY = Math.min(size - 1, Math.max(0, v * (size - 1)));
  const left = Math.min(size - 2, Math.floor(scaledX));
  const top = Math.min(size - 2, Math.floor(scaledY));
  const localU = scaledX - left;
  const localV = scaledY - top;
  const start = sampleRasterWarpRow(points, size, top, left, localU, handles);
  const end = sampleRasterWarpRow(points, size, top + 1, left, localU, handles);
  const previous = top > 0
    ? sampleRasterWarpRow(points, size, top - 1, left, localU, handles)
    : sampleRasterWarpFlatRow(topGhostRow, left, localU);
  const next = top + 2 < size
    ? sampleRasterWarpRow(points, size, top + 2, left, localU, handles)
    : sampleRasterWarpFlatRow(bottomGhostRow, left, localU);
  return {
    x: catmullRom(previous.x, start.x, end.x, next.x, localV),
    y: catmullRom(previous.y, start.y, end.y, next.y, localV),
  };
}

export function rasterWarpSurfaceSampler(
  points: readonly Readonly<RasterTransformControlPoint>[],
  size: number,
  handles?: readonly Readonly<RasterTransformControlPoint>[] | null,
): (u: number, v: number) => RasterTransformControlPoint {
  const context = createRasterWarpSurfaceSamplerContext(points, size, handles);
  return (u, v) => sampleRasterWarpSurfaceFromContext(context, u, v);
}

/** Samples the smooth Warp surface while preserving a perfectly affine grid. */
export function sampleRasterWarpSurface(
  points: readonly Readonly<RasterTransformControlPoint>[],
  size: number,
  u: number,
  v: number,
  handles?: readonly Readonly<RasterTransformControlPoint>[] | null,
): RasterTransformControlPoint {
  return rasterWarpSurfaceSampler(points, size, handles)(u, v);
}

/** Finds the surface coordinate beneath a layer-space gesture anchor. */
export function rasterWarpClosestSurfaceParameter(
  points: readonly Readonly<RasterTransformControlPoint>[],
  size: number,
  target: Readonly<RasterTransformControlPoint>,
  handles?: readonly Readonly<RasterTransformControlPoint>[] | null,
): RasterWarpSurfaceParameter {
  if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) {
    throw new Error("Il punto di presa Warp deve essere finito.");
  }
  const cells = (size - 1) * RASTER_WARP_RENDER_SUBDIVISIONS;
  let bestU = 0;
  let bestV = 0;
  let bestDistanceSquared = Number.POSITIVE_INFINITY;
  const sample = rasterWarpSurfaceSampler(points, size, handles);
  const consider = (u: number, v: number): void => {
    const safeU = Math.min(1, Math.max(0, u));
    const safeV = Math.min(1, Math.max(0, v));
    const point = sample(safeU, safeV);
    const deltaX = point.x - target.x;
    const deltaY = point.y - target.y;
    const distanceSquared = deltaX * deltaX + deltaY * deltaY;
    if (distanceSquared >= bestDistanceSquared) return;
    bestDistanceSquared = distanceSquared;
    bestU = safeU;
    bestV = safeV;
  };
  for (let row = 0; row <= cells; row += 1) {
    for (let column = 0; column <= cells; column += 1) {
      consider(column / cells, row / cells);
    }
  }
  let step = 1 / cells;
  for (let iteration = 0; iteration < 7; iteration += 1) {
    const centerU = bestU;
    const centerV = bestV;
    for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
      for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
        consider(
          centerU + columnOffset * step,
          centerV + rowOffset * step,
        );
      }
    }
    step *= 0.5;
  }
  return { u: bestU, v: bestV };
}

function sampleRasterDeformGrid(
  points: readonly Readonly<RasterTransformControlPoint>[],
  size: number,
  u: number,
  v: number,
): RasterTransformControlPoint {
  const scaledX = Math.min(size - 1, Math.max(0, u * (size - 1)));
  const scaledY = Math.min(size - 1, Math.max(0, v * (size - 1)));
  const left = Math.min(size - 2, Math.floor(scaledX));
  const top = Math.min(size - 2, Math.floor(scaledY));
  const localU = scaledX - left;
  const localV = scaledY - top;
  const topLeft = points[top * size + left];
  const topRight = points[top * size + left + 1];
  const bottomLeft = points[(top + 1) * size + left];
  const bottomRight = points[(top + 1) * size + left + 1];
  return bilinearPoint(topLeft, topRight, bottomLeft, bottomRight, localU, localV);
}

export function resampleRasterDeformGrid(
  points: readonly Readonly<RasterTransformControlPoint>[],
  sourceSize: number,
  destinationSize: number,
): RasterTransformControlPoint[] {
  if (sourceSize < 2 || points.length !== sourceSize * sourceSize) {
    throw new Error("Griglia Warp sorgente non valida.");
  }
  if (destinationSize < 2) throw new Error("Griglia Warp destinazione non valida.");
  const result: RasterTransformControlPoint[] = [];
  for (let row = 0; row < destinationSize; row += 1) {
    for (let column = 0; column < destinationSize; column += 1) {
      result.push(sampleRasterDeformGrid(
        points,
        sourceSize,
        column / (destinationSize - 1),
        row / (destinationSize - 1),
      ));
    }
  }
  return result;
}

export function rasterDeformBoundaryIndices(size: number): number[] {
  if (!Number.isSafeInteger(size) || size < 2) return [];
  const indices: number[] = [];
  for (let column = 0; column < size; column += 1) indices.push(column);
  for (let row = 1; row < size; row += 1) indices.push(row * size + size - 1);
  for (let column = size - 2; column >= 0; column -= 1) {
    indices.push((size - 1) * size + column);
  }
  for (let row = size - 2; row > 0; row -= 1) indices.push(row * size);
  return indices;
}

export function rasterWarpCornerIndices(size: number): readonly number[] {
  if (!Number.isSafeInteger(size) || size < 2) return [];
  return [0, size - 1, (size - 1) * size, size * size - 1];
}

/**
 * Procreate-style Warp gesture. A direct corner grab moves only that corner;
 * every other grab applies one smooth, locally dominant falloff while pinning
 * all corners.
 */
export function moveRasterWarpControlPoints(
  points: readonly Readonly<RasterTransformControlPoint>[],
  size: number,
  anchor: Readonly<RasterTransformControlPoint>,
  deltaX: number,
  deltaY: number,
  isolatedCornerIndex: number | null = null,
  anchorParameter: Readonly<RasterWarpSurfaceParameter> | null = null,
): RasterTransformControlPoint[] {
  if (!Number.isSafeInteger(size) || size < 2 || points.length !== size * size) {
    throw new Error("Griglia Warp non valida.");
  }
  if (
    !Number.isFinite(anchor.x)
    || !Number.isFinite(anchor.y)
    || !Number.isFinite(deltaX)
    || !Number.isFinite(deltaY)
  ) {
    throw new Error("Il gesto Warp deve usare coordinate finite.");
  }
  const corners = new Set(rasterWarpCornerIndices(size));
  if (isolatedCornerIndex !== null) {
    if (!corners.has(isolatedCornerIndex)) {
      throw new Error("Solo i quattro angoli Warp possono essere spostati isolatamente.");
    }
    return points.map((point, index) => index === isolatedCornerIndex
      ? { x: point.x + deltaX, y: point.y + deltaY }
      : { ...point });
  }

  let horizontalSpacing = 0;
  let verticalSpacing = 0;
  let horizontalCount = 0;
  let verticalCount = 0;
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const point = points[row * size + column];
      if (column + 1 < size) {
        const next = points[row * size + column + 1];
        horizontalSpacing += Math.hypot(next.x - point.x, next.y - point.y);
        horizontalCount += 1;
      }
      if (row + 1 < size) {
        const next = points[(row + 1) * size + column];
        verticalSpacing += Math.hypot(next.x - point.x, next.y - point.y);
        verticalCount += 1;
      }
    }
  }
  const radiusX = Math.max(
    1,
    horizontalSpacing / Math.max(1, horizontalCount)
      * RASTER_WARP_INFLUENCE_RADIUS_CELLS,
  );
  const radiusY = Math.max(
    1,
    verticalSpacing / Math.max(1, verticalCount)
      * RASTER_WARP_INFLUENCE_RADIUS_CELLS,
  );
  const weights = points.map((point, index) => {
    if (corners.has(index)) return 0;
    const normalizedX = (point.x - anchor.x) / radiusX;
    const normalizedY = (point.y - anchor.y) / radiusY;
    const distanceSquared = normalizedX * normalizedX + normalizedY * normalizedY;
    // Quartic falloff: no hard edge, but a pronounced local cell response.
    return 1 / (1 + distanceSquared * distanceSquared);
  });
  const peakWeight = Math.max(1e-6, ...weights);
  const parameter = anchorParameter ?? rasterWarpClosestSurfaceParameter(
    points,
    size,
    anchor,
  );
  const anchorResponse = sampleRasterWarpSurface(
    weights.map((weight) => ({ x: weight / peakWeight, y: 0 })),
    size,
    parameter.u,
    parameter.v,
  ).x;
  const responseScale = 1 / Math.max(1e-3, anchorResponse);
  return points.map((point, index) => {
    const weight = weights[index] / peakWeight * responseScale;
    return {
      x: point.x + deltaX * weight,
      y: point.y + deltaY * weight,
    };
  });
}

export function rasterDeformRenderedBounds(
  points: readonly Readonly<RasterTransformControlPoint>[],
  documentWidth: number,
  documentHeight: number,
  mode: Exclude<RasterTransformMode, "affine">,
  warpGridSize: RasterWarpGridSize,
  padding = 0,
  bezierHandles?: readonly Readonly<RasterTransformControlPoint>[] | null,
): RasterTransformRect | null {
  const normalized = normalizeRasterDeformPoints(points, mode, warpGridSize);
  if (mode === "perspective") {
    return rasterDeformBounds(normalized, documentWidth, documentHeight, padding);
  }
  const size = rasterDeformGridSize(mode, warpGridSize);
  const renderedPoints: RasterTransformControlPoint[] = [];
  const cells = (size - 1) * RASTER_WARP_RENDER_SUBDIVISIONS;
  const sample = rasterWarpSurfaceSampler(normalized, size, bezierHandles);
  for (let row = 0; row <= cells; row += 1) {
    for (let column = 0; column <= cells; column += 1) {
      renderedPoints.push(sample(column / cells, row / cells));
    }
  }
  return rasterDeformBounds(renderedPoints, documentWidth, documentHeight, padding);
}

/** Projective clip-space weights for row-major TL, TR, BL, BR points. */
export function rasterPerspectiveWeights(
  points: readonly Readonly<RasterTransformControlPoint>[],
): readonly [number, number, number, number] {
  if (points.length !== 4) throw new Error("La Prospettiva richiede quattro angoli.");
  const topLeft = finitePoint(points[0], "Angolo alto sinistro");
  const topRight = finitePoint(points[1], "Angolo alto destro");
  const bottomLeft = finitePoint(points[2], "Angolo basso sinistro");
  const bottomRight = finitePoint(points[3], "Angolo basso destro");
  const dx1 = topRight.x - bottomRight.x;
  const dx2 = bottomLeft.x - bottomRight.x;
  const dx3 = topLeft.x - topRight.x + bottomRight.x - bottomLeft.x;
  const dy1 = topRight.y - bottomRight.y;
  const dy2 = bottomLeft.y - bottomRight.y;
  const dy3 = topLeft.y - topRight.y + bottomRight.y - bottomLeft.y;
  const determinant = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) return [1, 1, 1, 1];
  if (Math.abs(determinant) < 1e-9) return [1, 1, 1, 1];
  const g = (dx3 * dy2 - dx2 * dy3) / determinant;
  const h = (dx1 * dy3 - dx3 * dy1) / determinant;
  const weights = [1, 1 + g, 1 + h, 1 + g + h] as const;
  // A projective pole inside the quad would cross clip-space w=0. Keep all
  // four handles usable by falling back to a stable piecewise-affine quad.
  return weights.every((weight) => Number.isFinite(weight) && weight > 1e-4)
    ? weights
    : [1, 1, 1, 1];
}

export function rasterDeformIsIdentity(
  points: readonly Readonly<RasterTransformControlPoint>[],
  bounds: Readonly<RasterTransformRect>,
  mode: Exclude<RasterTransformMode, "affine">,
  warpGridSize: RasterWarpGridSize,
  epsilon = 1e-6,
  bezierHandles?: readonly Readonly<RasterTransformControlPoint>[] | null,
): boolean {
  const identity = rasterDeformInitialPoints(bounds, mode, warpGridSize);
  if (points.length !== identity.length) return false;
  const pointsAreIdentity = points.every((point, index) =>
    Math.abs(point.x - identity[index].x) <= epsilon
    && Math.abs(point.y - identity[index].y) <= epsilon);
  if (!pointsAreIdentity || mode !== "warp") return pointsAreIdentity;
  const size = rasterDeformGridSize(mode, warpGridSize);
  const normalizedHandles = normalizeRasterWarpBezierHandles(
    bezierHandles,
    points,
    size,
  );
  const identityHandles = rasterWarpDefaultBezierHandles(identity, size);
  return normalizedHandles.every((handle, index) =>
    Math.abs(handle.x - identityHandles[index].x) <= epsilon
    && Math.abs(handle.y - identityHandles[index].y) <= epsilon);
}

/**
 * Packs triangle-list vertices as destination.xy, sourceUv.xy, projectiveW.
 * Perspective uses clip-space weights. Warp tessellates a smooth Catmull-Rom
 * surface and keeps affine mesh weights (w = 1).
 */
export function packRasterDeformVertices(
  points: readonly Readonly<RasterTransformControlPoint>[],
  sourceBounds: Readonly<RasterTransformRect>,
  sourceTextureRect: Readonly<RasterTransformRect>,
  mode: Exclude<RasterTransformMode, "affine">,
  warpGridSize: RasterWarpGridSize,
  target: Float32Array<ArrayBufferLike> = new Float32Array(
    RASTER_DEFORM_MAX_VERTICES * RASTER_DEFORM_VERTEX_FLOATS,
  ),
  bezierHandles?: readonly Readonly<RasterTransformControlPoint>[] | null,
): { data: Float32Array<ArrayBufferLike>; vertexCount: number } {
  const size = rasterDeformGridSize(mode, warpGridSize);
  const normalized = normalizeRasterDeformPoints(points, mode, warpGridSize);
  const cells = mode === "warp"
    ? (size - 1) * RASTER_WARP_RENDER_SUBDIVISIONS
    : size - 1;
  const vertexCount = cells * cells * 6;
  if (target.length < vertexCount * RASTER_DEFORM_VERTEX_FLOATS) {
    throw new Error("Buffer vertici Warp troppo piccolo.");
  }
  if (sourceTextureRect.width <= 0 || sourceTextureRect.height <= 0) {
    throw new Error("Rettangolo texture Warp non valido.");
  }
  const weights = mode === "perspective"
    ? rasterPerspectiveWeights(normalized)
    : null;
  const sampleWarp = mode === "warp"
    ? rasterWarpSurfaceSampler(normalized, size, bezierHandles)
    : null;
  let cursor = 0;
  const append = (row: number, column: number) => {
    const u = column / cells;
    const v = row / cells;
    const controlIndex = mode === "perspective" ? row * size + column : -1;
    const destination = mode === "warp"
      ? sampleWarp!(u, v)
      : normalized[controlIndex];
    const sourceX = sourceBounds.x + sourceBounds.width * u;
    const sourceY = sourceBounds.y + sourceBounds.height * v;
    target[cursor++] = destination.x;
    target[cursor++] = destination.y;
    target[cursor++] = (sourceX - sourceTextureRect.x) / sourceTextureRect.width;
    target[cursor++] = (sourceY - sourceTextureRect.y) / sourceTextureRect.height;
    target[cursor++] = controlIndex >= 0 ? weights?.[controlIndex] ?? 1 : 1;
  };
  for (let row = 0; row < cells; row += 1) {
    for (let column = 0; column < cells; column += 1) {
      append(row, column);
      append(row, column + 1);
      append(row + 1, column + 1);
      append(row, column);
      append(row + 1, column + 1);
      append(row + 1, column);
    }
  }
  return { data: target.subarray(0, cursor), vertexCount };
}
