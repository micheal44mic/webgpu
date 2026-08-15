export const BRUSH_OUTLINE_ALPHA_THRESHOLD = 0;
export const BRUSH_OUTLINE_MIN_VISIBLE_CSS_PIXELS = 1;

export interface BrushMaskOutline {
  /**
   * Closed paths in brush-local coordinates. Both axes use -0.5..0.5, so the
   * outline stays registered to the exact center used by the stamp shader.
   */
  readonly paths: readonly Float32Array[];
  /**
   * Convex hull of every retained path vertex, in the same local coordinates.
   * It is built once with the alpha boundary so pointer movement never scans
   * thousands of contour vertices merely to evaluate Krita's cursor guards.
   */
  readonly boundingHull: Float32Array;
  readonly precise: boolean;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly edgeCount: number;
}

interface OutlinePoint {
  readonly x: number;
  readonly y: number;
}

export interface BrushOutlineSnapshot {
  readonly kind: "circle" | "shape" | "unavailable";
  readonly outline: BrushMaskOutline | null;
  readonly diameterCssPixels: number;
  readonly viewRotationRadians: number;
  readonly followsStroke: boolean;
}

export interface BrushOutlineGpuTarget {
  readonly device: GPUDevice;
  readonly format: GPUTextureFormat;
}

interface EdgeField {
  readonly outgoing: Uint8Array;
  readonly stride: number;
  readonly edgeCount: number;
}

const DIRECTION_X = [1, 0, -1, 0] as const;
const DIRECTION_Y = [0, 1, 0, -1] as const;

function assertMaskDimensions(mask: Uint8Array, width: number, height: number): void {
  if (
    !Number.isInteger(width)
    || !Number.isInteger(height)
    || width < 1
    || height < 1
    || mask.length !== width * height
  ) {
    throw new Error("La maschera alpha del pennello ha dimensioni non valide.");
  }
}

function addEdge(
  outgoing: Uint8Array,
  stride: number,
  x: number,
  y: number,
  direction: number,
): void {
  outgoing[y * stride + x] |= 1 << direction;
}

function buildEdgeField(
  mask: Uint8Array,
  width: number,
  height: number,
): EdgeField {
  const stride = width + 1;
  const outgoing = new Uint8Array(stride * (height + 1));
  let edgeCount = 0;
  const occupied = (x: number, y: number): boolean =>
    x >= 0
    && x < width
    && y >= 0
    && y < height
    && mask[y * width + x] > BRUSH_OUTLINE_ALPHA_THRESHOLD;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!occupied(x, y)) continue;
      if (!occupied(x, y - 1)) {
        addEdge(outgoing, stride, x, y, 0);
        edgeCount += 1;
      }
      if (!occupied(x + 1, y)) {
        addEdge(outgoing, stride, x + 1, y, 1);
        edgeCount += 1;
      }
      if (!occupied(x, y + 1)) {
        addEdge(outgoing, stride, x + 1, y + 1, 2);
        edgeCount += 1;
      }
      if (!occupied(x - 1, y)) {
        addEdge(outgoing, stride, x, y + 1, 3);
        edgeCount += 1;
      }
    }
  }
  return { outgoing, stride, edgeCount };
}

function firstDirection(bits: number): number {
  for (let direction = 0; direction < 4; direction += 1) {
    if ((bits & (1 << direction)) !== 0) return direction;
  }
  return -1;
}

/**
 * Krita's KisOutlineGenerator crosses a diagonal contact instead of splitting
 * it into two contours. In our clockwise, occupied-on-the-right edge field,
 * that is the left turn at the shared grid vertex.
 */
function continuationDirection(bits: number, incoming: number): number {
  const candidates = [
    (incoming + 3) & 3,
    incoming,
    (incoming + 1) & 3,
    (incoming + 2) & 3,
  ];
  for (const direction of candidates) {
    if ((bits & (1 << direction)) !== 0) return direction;
  }
  return -1;
}

function signedPathArea(points: readonly number[]): number {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 2) {
    const nextIndex = (index + 2) % points.length;
    twiceArea += points[index] * points[nextIndex + 1]
      - points[nextIndex] * points[index + 1];
  }
  return twiceArea * 0.5;
}

function traceEdgeField(
  field: EdgeField,
  width: number,
  height: number,
): readonly Float32Array[] {
  const paths: Float32Array[] = [];
  const { outgoing, stride } = field;
  const maximumTraceSteps = field.edgeCount + 1;

  for (let startVertex = 0; startVertex < outgoing.length; startVertex += 1) {
    while (outgoing[startVertex] !== 0) {
      const startDirection = firstDirection(outgoing[startVertex]);
      if (startDirection < 0) break;
      const points: number[] = [
        (startVertex % stride) / width - 0.5,
        Math.floor(startVertex / stride) / height - 0.5,
      ];
      let vertex = startVertex;
      let direction = startDirection;
      let closed = false;

      for (let step = 0; step < maximumTraceSteps; step += 1) {
        outgoing[vertex] &= ~(1 << direction);
        const x = vertex % stride;
        const y = Math.floor(vertex / stride);
        const nextX = x + DIRECTION_X[direction];
        const nextY = y + DIRECTION_Y[direction];
        const nextVertex = nextY * stride + nextX;
        if (nextVertex === startVertex) {
          closed = true;
          break;
        }
        const nextDirection = continuationDirection(outgoing[nextVertex], direction);
        if (nextDirection < 0) break;
        if (nextDirection !== direction) {
          points.push(nextX / width - 0.5, nextY / height - 0.5);
        }
        vertex = nextVertex;
        direction = nextDirection;
      }

      // KisBoundary enables KisOutlineGenerator::setSimpleOutline(true):
      // clockwise inner contours are traced/marked but omitted from the
      // returned brush outline. With screen-space Y increasing downwards,
      // retained outer contours have positive signed area here.
      if (closed && points.length >= 6 && signedPathArea(points) > 0) {
        paths.push(Float32Array.from(points));
      }
    }
  }
  return paths;
}

function cross(origin: OutlinePoint, a: OutlinePoint, b: OutlinePoint): number {
  return (a.x - origin.x) * (b.y - origin.y)
    - (a.y - origin.y) * (b.x - origin.x);
}

/** Monotone-chain hull used only while compiling a newly loaded brush tip. */
function buildBoundingHull(paths: readonly Float32Array[]): Float32Array {
  const points: OutlinePoint[] = [];
  for (const path of paths) {
    for (let index = 0; index < path.length; index += 2) {
      points.push({ x: path[index], y: path[index + 1] });
    }
  }
  if (points.length === 0) return new Float32Array();
  points.sort((a, b) => a.x - b.x || a.y - b.y);

  const unique: OutlinePoint[] = [];
  for (const point of points) {
    const previous = unique[unique.length - 1];
    if (!previous || previous.x !== point.x || previous.y !== point.y) unique.push(point);
  }
  if (unique.length <= 2) {
    return Float32Array.from(unique.flatMap((point) => [point.x, point.y]));
  }

  const lower: OutlinePoint[] = [];
  for (const point of unique) {
    while (
      lower.length >= 2
      && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper: OutlinePoint[] = [];
  for (let index = unique.length - 1; index >= 0; index -= 1) {
    const point = unique[index];
    while (
      upper.length >= 2
      && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return Float32Array.from(
    lower.concat(upper).flatMap((point) => [point.x, point.y]),
  );
}

/**
 * Builds the cached boundary from the same post-polarity alpha mask uploaded
 * to WebGPU. Non-zero alpha is deliberately the boundary criterion, matching
 * Krita's transparent-alpha outline source rather than an arbitrary 50% cut.
 * The result is always exact: it is never downsampled for complex custom tips.
 */
export function buildBrushMaskOutline(
  mask: Uint8Array,
  width: number,
  height: number,
): BrushMaskOutline {
  assertMaskDimensions(mask, width, height);
  const field = buildEdgeField(mask, width, height);
  const paths = traceEdgeField(field, width, height);
  return {
    paths,
    boundingHull: buildBoundingHull(paths),
    precise: true,
    sourceWidth: width,
    sourceHeight: height,
    edgeCount: field.edgeCount,
  };
}

export function brushOutlineDiameterCssPixels(
  brushSizePixels: number,
  zoom: number,
  cssWidth: number,
  cssHeight: number,
  backingWidth: number,
  backingHeight: number,
): number {
  const scaleX = zoom * Math.max(1, cssWidth) / Math.max(1, backingWidth);
  const scaleY = zoom * Math.max(1, cssHeight) / Math.max(1, backingHeight);
  return Math.max(0, brushSizePixels) * (Math.abs(scaleX) + Math.abs(scaleY)) * 0.5;
}

export function brushOutlineRotationRadians(
  followsStroke: boolean,
  viewRotationRadians: number,
  pointerDirectionRadians: number | null,
): number {
  return followsStroke && pointerDirectionRadians !== null
    ? pointerDirectionRadians
    : viewRotationRadians;
}

/**
 * Returns the width+height of the transformed outline bounding box, matching
 * the quantity Krita uses for its minimum/oversized cursor safeguards.
 */
export function brushOutlineBoundingExtentCssPixels(
  outline: BrushMaskOutline,
  diameterCssPixels: number,
  rotationRadians: number,
): number {
  if (outline.boundingHull.length === 0 || diameterCssPixels <= 0) return 0;
  const cosine = Math.cos(rotationRadians);
  const sine = Math.sin(rotationRadians);
  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < outline.boundingHull.length; index += 2) {
    const x = outline.boundingHull[index] * diameterCssPixels;
    const y = outline.boundingHull[index + 1] * diameterCssPixels;
    const transformedX = x * cosine - y * sine;
    const transformedY = x * sine + y * cosine;
    minimumX = Math.min(minimumX, transformedX);
    minimumY = Math.min(minimumY, transformedY);
    maximumX = Math.max(maximumX, transformedX);
    maximumY = Math.max(maximumY, transformedY);
  }
  return Number.isFinite(minimumX)
    ? maximumX - minimumX + maximumY - minimumY
    : 0;
}
