import type { VectorTextGpuMeshData } from "./vector-text-effect-geometry.ts";
import {
  VECTOR_SVG_STATIC_STROKE_TOLERANCE,
  dashedStrokeSubpaths,
  flattenStrokeSubpaths,
  matrixMaximumScale,
  transformPoint,
  type VectorSvgFlatStrokeSubpath,
  type VectorSvgStroke,
  type VectorSvgStrokeExpansionQuality,
  type VectorSvgStrokePoint,
} from "./vector-svg-import.ts";

export const DIRECT_VECTOR_SVG_STROKE_STRATEGY =
  "retained-centerline-direct-triangle-mesh-v1" as const;

export interface DirectVectorSvgStrokeMeshMetadata {
  readonly lodBucket?: number;
  readonly integerScale?: number;
}

export interface DirectVectorSvgStrokeCompileMetrics {
  readonly strategy: typeof DIRECT_VECTOR_SVG_STROKE_STRATEGY;
  readonly strokeCount: number;
  readonly sourceVerbCount: number;
  readonly sourceCoordinateCount: number;
  readonly flattenedSubpathCount: number;
  readonly flattenedPointCount: number;
  readonly dashedSubpathCount: number;
  readonly segmentCount: number;
  readonly degenerateSegmentCount: number;
  readonly joinCount: number;
  readonly bevelJoinCount: number;
  readonly miterJoinCount: number;
  readonly roundJoinCount: number;
  readonly miterFallbackCount: number;
  readonly reversalJoinCount: number;
  readonly capCount: number;
  readonly buttCapCount: number;
  readonly squareCapCount: number;
  readonly roundCapCount: number;
  readonly arcTriangleCount: number;
  readonly vertexCount: number;
  readonly indexCount: number;
  readonly vertexBytes: number;
  readonly indexBytes: number;
  readonly totalBytes: number;
  readonly flattenMs: number;
  readonly dashMs: number;
  readonly emitMs: number;
  readonly totalMs: number;
}

export interface DirectVectorSvgStrokeCompileResult {
  readonly mesh: VectorTextGpuMeshData | null;
  readonly metrics: DirectVectorSvgStrokeCompileMetrics;
}

interface MutableMetrics {
  strokeCount: number;
  sourceVerbCount: number;
  sourceCoordinateCount: number;
  flattenedSubpathCount: number;
  flattenedPointCount: number;
  dashedSubpathCount: number;
  segmentCount: number;
  degenerateSegmentCount: number;
  joinCount: number;
  bevelJoinCount: number;
  miterJoinCount: number;
  roundJoinCount: number;
  miterFallbackCount: number;
  reversalJoinCount: number;
  capCount: number;
  buttCapCount: number;
  squareCapCount: number;
  roundCapCount: number;
  arcTriangleCount: number;
  flattenMs: number;
  dashMs: number;
}

interface PreparedSubpath {
  readonly stroke: VectorSvgStroke;
  readonly subpath: VectorSvgFlatStrokeSubpath;
  readonly radius: number;
  readonly arcTolerance: number;
}

interface DirectSegment {
  readonly start: VectorSvgStrokePoint;
  readonly end: VectorSvgStrokePoint;
  readonly tangent: VectorSvgStrokePoint;
  readonly normal: VectorSvgStrokePoint;
}

const TAU = Math.PI * 2;
const GEOMETRY_EPSILON = 1e-12;
const MAXIMUM_ARC_TRIANGLES = 65_536;
const MAXIMUM_VERTEX_COUNT = 0xffff_ffff;

function clockNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function squaredDistance(
  first: VectorSvgStrokePoint,
  second: VectorSvgStrokePoint,
): number {
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  return dx * dx + dy * dy;
}

function signedAngle(
  first: VectorSvgStrokePoint,
  second: VectorSvgStrokePoint,
): number {
  return Math.atan2(
    first.x * second.y - first.y * second.x,
    first.x * second.x + first.y * second.y,
  );
}

function arcTriangleCount(
  radius: number,
  sweep: number,
  tolerance: number,
  minimum: number,
): number {
  if (!(radius > 0) || !(Math.abs(sweep) > 0)) return 0;
  const safeTolerance = finitePositive(tolerance, radius * 0.01);
  const cosine = Math.min(1, Math.max(-1, 1 - safeTolerance / radius));
  const maximumAngle = 2 * Math.acos(cosine);
  const safeMaximumAngle = maximumAngle > GEOMETRY_EPSILON
    ? maximumAngle
    : Math.sqrt(8 * safeTolerance / radius);
  const count = Math.max(
    minimum,
    Math.ceil(Math.abs(sweep) / Math.max(GEOMETRY_EPSILON, safeMaximumAngle)),
  );
  if (count > MAXIMUM_ARC_TRIANGLES) {
    throw new Error(
      `Direct stroke arc exceeds ${MAXIMUM_ARC_TRIANGLES} triangles.`,
    );
  }
  return count;
}

function createMutableMetrics(strokes: readonly VectorSvgStroke[]): MutableMetrics {
  return {
    strokeCount: strokes.length,
    sourceVerbCount: strokes.reduce(
      (total, stroke) => total + stroke.sourcePath.verbs.length,
      0,
    ),
    sourceCoordinateCount: strokes.reduce(
      (total, stroke) => total + stroke.sourcePath.coords.length,
      0,
    ),
    flattenedSubpathCount: 0,
    flattenedPointCount: 0,
    dashedSubpathCount: 0,
    segmentCount: 0,
    degenerateSegmentCount: 0,
    joinCount: 0,
    bevelJoinCount: 0,
    miterJoinCount: 0,
    roundJoinCount: 0,
    miterFallbackCount: 0,
    reversalJoinCount: 0,
    capCount: 0,
    buttCapCount: 0,
    squareCapCount: 0,
    roundCapCount: 0,
    arcTriangleCount: 0,
    flattenMs: 0,
    dashMs: 0,
  };
}

function prepareSubpaths(
  strokes: readonly VectorSvgStroke[],
  quality: VectorSvgStrokeExpansionQuality,
  metrics: MutableMetrics,
): PreparedSubpath[] {
  const prepared: PreparedSubpath[] = [];
  for (const stroke of strokes) {
    if (!(stroke.width > 0) || !Number.isFinite(stroke.width)) continue;
    const transformScale = Math.max(
      Number.EPSILON,
      matrixMaximumScale(stroke.transform),
    );
    const centerlineTolerance = finitePositive(
      quality.centerlineTolerance,
      VECTOR_SVG_STATIC_STROKE_TOLERANCE,
    ) / transformScale;
    const arcTolerance = finitePositive(
      quality.roundArcSagittaTolerance,
      VECTOR_SVG_STATIC_STROKE_TOLERANCE,
    ) / transformScale;

    const flattenStartedAt = clockNow();
    const flattened = flattenStrokeSubpaths(
      stroke.sourcePath,
      centerlineTolerance,
    );
    metrics.flattenMs += clockNow() - flattenStartedAt;
    metrics.flattenedSubpathCount += flattened.length;
    metrics.flattenedPointCount += flattened.reduce(
      (total, subpath) => total + subpath.points.length,
      0,
    );

    const dashStartedAt = clockNow();
    for (const subpath of flattened) {
      const dashed = dashedStrokeSubpaths(
        subpath,
        stroke.dashArray,
        stroke.dashOffset,
        stroke.linecap !== "butt",
      );
      metrics.dashedSubpathCount += dashed.length;
      for (const value of dashed) {
        prepared.push({
          stroke,
          subpath: value,
          radius: stroke.width * 0.5,
          arcTolerance,
        });
      }
    }
    metrics.dashMs += clockNow() - dashStartedAt;
  }
  return prepared;
}

class DirectMeshBuilder {
  private readonly absoluteVertices: number[] = [];
  private readonly indices: number[] = [];
  private left = Infinity;
  private top = Infinity;
  private right = -Infinity;
  private bottom = -Infinity;

  get vertexCount(): number {
    return this.absoluteVertices.length / 2;
  }

  get indexCount(): number {
    return this.indices.length;
  }

  private vertex(
    stroke: VectorSvgStroke,
    point: VectorSvgStrokePoint,
  ): number {
    const transformed = transformPoint(stroke.transform, point.x, point.y);
    if (!Number.isFinite(transformed.x) || !Number.isFinite(transformed.y)) {
      throw new Error("Direct stroke expansion produced a non-finite vertex.");
    }
    const index = this.absoluteVertices.length / 2;
    if (index >= MAXIMUM_VERTEX_COUNT) {
      throw new Error("Direct stroke expansion exceeds the 32-bit vertex budget.");
    }
    this.absoluteVertices.push(transformed.x, transformed.y);
    this.left = Math.min(this.left, transformed.x);
    this.top = Math.min(this.top, transformed.y);
    this.right = Math.max(this.right, transformed.x);
    this.bottom = Math.max(this.bottom, transformed.y);
    return index;
  }

  triangle(
    stroke: VectorSvgStroke,
    first: VectorSvgStrokePoint,
    second: VectorSvgStrokePoint,
    third: VectorSvgStrokePoint,
  ): void {
    const base = this.vertex(stroke, first);
    this.vertex(stroke, second);
    this.vertex(stroke, third);
    this.indices.push(base, base + 1, base + 2);
  }

  quad(
    stroke: VectorSvgStroke,
    first: VectorSvgStrokePoint,
    second: VectorSvgStrokePoint,
    third: VectorSvgStrokePoint,
    fourth: VectorSvgStrokePoint,
  ): void {
    const base = this.vertex(stroke, first);
    this.vertex(stroke, second);
    this.vertex(stroke, third);
    this.vertex(stroke, fourth);
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  arcFan(
    stroke: VectorSvgStroke,
    center: VectorSvgStrokePoint,
    radius: number,
    startAngle: number,
    sweep: number,
    tolerance: number,
    minimumTriangles: number,
  ): number {
    const count = arcTriangleCount(
      radius,
      sweep,
      tolerance,
      minimumTriangles,
    );
    if (count === 0) return 0;
    const centerIndex = this.vertex(stroke, center);
    const firstIndex = this.vertex(stroke, {
      x: center.x + Math.cos(startAngle) * radius,
      y: center.y + Math.sin(startAngle) * radius,
    });
    let previousIndex = firstIndex;
    for (let index = 1; index <= count; index += 1) {
      const angle = startAngle + sweep * index / count;
      const currentIndex = this.vertex(stroke, {
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
      });
      if (sweep >= 0) {
        this.indices.push(centerIndex, previousIndex, currentIndex);
      } else {
        this.indices.push(centerIndex, currentIndex, previousIndex);
      }
      previousIndex = currentIndex;
    }
    return count;
  }

  finish(
    revision: string,
    metadata: DirectVectorSvgStrokeMeshMetadata,
  ): VectorTextGpuMeshData | null {
    if (this.indices.length === 0 || this.absoluteVertices.length === 0) {
      return null;
    }
    const originX = (this.left + this.right) * 0.5;
    const originY = (this.top + this.bottom) * 0.5;
    const vertices = new Float32Array(this.absoluteVertices.length);
    for (let index = 0; index < this.absoluteVertices.length; index += 2) {
      vertices[index] = this.absoluteVertices[index] - originX;
      vertices[index + 1] = this.absoluteVertices[index + 1] - originY;
    }
    const integerScale = Number.isFinite(metadata.integerScale)
      && (metadata.integerScale ?? 0) > 0
      ? Math.max(1, Math.floor(metadata.integerScale!))
      : 1;
    const lodBucket = Number.isFinite(metadata.lodBucket)
      ? Math.trunc(metadata.lodBucket!)
      : 0;
    return {
      revision: `${DIRECT_VECTOR_SVG_STROKE_STRATEGY}:${revision}`,
      vertices,
      indices: new Uint32Array(this.indices),
      left: this.left - originX,
      top: this.top - originY,
      right: this.right - originX,
      bottom: this.bottom - originY,
      originX,
      originY,
      lodBucket,
      integerScale,
    };
  }
}

function normalizedSegments(
  points: readonly VectorSvgStrokePoint[],
  closed: boolean,
  metrics: MutableMetrics,
): DirectSegment[] {
  const segments: DirectSegment[] = [];
  const segmentCount = closed ? points.length : Math.max(0, points.length - 1);
  for (let index = 0; index < segmentCount; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (!(length > GEOMETRY_EPSILON)) {
      metrics.degenerateSegmentCount += 1;
      continue;
    }
    const tangent = { x: dx / length, y: dy / length };
    segments.push({
      start,
      end,
      tangent,
      normal: { x: -tangent.y, y: tangent.x },
    });
  }
  metrics.segmentCount += segments.length;
  return segments;
}

function offsetPoint(
  point: VectorSvgStrokePoint,
  vector: VectorSvgStrokePoint,
  distance: number,
): VectorSvgStrokePoint {
  return {
    x: point.x + vector.x * distance,
    y: point.y + vector.y * distance,
  };
}

function emitPointStroke(
  builder: DirectMeshBuilder,
  prepared: PreparedSubpath,
  metrics: MutableMetrics,
): void {
  const point = prepared.subpath.points[0];
  const tangentValue = prepared.subpath.zeroLengthTangent ?? { x: 1, y: 0 };
  const tangentLength = Math.hypot(tangentValue.x, tangentValue.y);
  const tangent = tangentLength > GEOMETRY_EPSILON
    ? { x: tangentValue.x / tangentLength, y: tangentValue.y / tangentLength }
    : { x: 1, y: 0 };
  const normal = { x: -tangent.y, y: tangent.x };
  metrics.capCount += 1;
  if (prepared.stroke.linecap === "butt") {
    metrics.buttCapCount += 1;
    return;
  }
  if (prepared.stroke.linecap === "square") {
    metrics.squareCapCount += 1;
    builder.quad(
      prepared.stroke,
      offsetPoint(offsetPoint(point, tangent, -prepared.radius), normal, prepared.radius),
      offsetPoint(offsetPoint(point, tangent, prepared.radius), normal, prepared.radius),
      offsetPoint(offsetPoint(point, tangent, prepared.radius), normal, -prepared.radius),
      offsetPoint(offsetPoint(point, tangent, -prepared.radius), normal, -prepared.radius),
    );
    return;
  }
  metrics.roundCapCount += 1;
  const count = builder.arcFan(
    prepared.stroke,
    point,
    prepared.radius,
    0,
    TAU,
    prepared.arcTolerance,
    3,
  );
  metrics.arcTriangleCount += count;
}

function emitSegmentQuads(
  builder: DirectMeshBuilder,
  prepared: PreparedSubpath,
  segments: readonly DirectSegment[],
): void {
  const square = !prepared.subpath.closed
    && prepared.stroke.linecap === "square";
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const start = square && index === 0
      ? offsetPoint(segment.start, segment.tangent, -prepared.radius)
      : segment.start;
    const end = square && index === segments.length - 1
      ? offsetPoint(segment.end, segment.tangent, prepared.radius)
      : segment.end;
    const startLeft = offsetPoint(start, segment.normal, prepared.radius);
    const endLeft = offsetPoint(end, segment.normal, prepared.radius);
    const endRight = offsetPoint(end, segment.normal, -prepared.radius);
    const startRight = offsetPoint(start, segment.normal, -prepared.radius);
    builder.quad(
      prepared.stroke,
      startLeft,
      endLeft,
      endRight,
      startRight,
    );
  }
}

function emitOpenCaps(
  builder: DirectMeshBuilder,
  prepared: PreparedSubpath,
  segments: readonly DirectSegment[],
  metrics: MutableMetrics,
): void {
  if (prepared.subpath.closed || segments.length === 0) return;
  metrics.capCount += 2;
  if (prepared.stroke.linecap === "butt") {
    metrics.buttCapCount += 2;
    return;
  }
  if (prepared.stroke.linecap === "square") {
    metrics.squareCapCount += 2;
    return;
  }
  metrics.roundCapCount += 2;
  const first = segments[0];
  const last = segments[segments.length - 1];
  const firstNormalAngle = Math.atan2(first.normal.y, first.normal.x);
  const lastNormalAngle = Math.atan2(last.normal.y, last.normal.x);
  metrics.arcTriangleCount += builder.arcFan(
    prepared.stroke,
    first.start,
    prepared.radius,
    firstNormalAngle,
    Math.PI,
    prepared.arcTolerance,
    2,
  );
  metrics.arcTriangleCount += builder.arcFan(
    prepared.stroke,
    last.end,
    prepared.radius,
    lastNormalAngle,
    -Math.PI,
    prepared.arcTolerance,
    2,
  );
}

function miterPoint(
  vertex: VectorSvgStrokePoint,
  previous: DirectSegment,
  next: DirectSegment,
  side: number,
  radius: number,
): VectorSvgStrokePoint | null {
  const previousOuter = offsetPoint(vertex, previous.normal, radius * side);
  const nextOuter = offsetPoint(vertex, next.normal, radius * side);
  const denominator = previous.tangent.x * next.tangent.y
    - previous.tangent.y * next.tangent.x;
  if (Math.abs(denominator) <= GEOMETRY_EPSILON) return null;
  const between = {
    x: nextOuter.x - previousOuter.x,
    y: nextOuter.y - previousOuter.y,
  };
  const distance = (
    between.x * next.tangent.y - between.y * next.tangent.x
  ) / denominator;
  const result = offsetPoint(previousOuter, previous.tangent, distance);
  return Number.isFinite(result.x) && Number.isFinite(result.y) ? result : null;
}

function emitJoin(
  builder: DirectMeshBuilder,
  prepared: PreparedSubpath,
  vertex: VectorSvgStrokePoint,
  previous: DirectSegment,
  next: DirectSegment,
  metrics: MutableMetrics,
): void {
  const cross = previous.tangent.x * next.tangent.y
    - previous.tangent.y * next.tangent.x;
  const dot = previous.tangent.x * next.tangent.x
    + previous.tangent.y * next.tangent.y;
  if (Math.abs(cross) <= GEOMETRY_EPSILON) {
    if (dot >= 0) return;
    metrics.joinCount += 1;
    metrics.reversalJoinCount += 1;
    if (prepared.stroke.linejoin === "round") {
      metrics.roundJoinCount += 1;
      metrics.arcTriangleCount += builder.arcFan(
        prepared.stroke,
        vertex,
        prepared.radius,
        0,
        TAU,
        prepared.arcTolerance,
        3,
      );
    } else {
      metrics.bevelJoinCount += 1;
    }
    return;
  }

  metrics.joinCount += 1;
  const outerSide = cross > 0 ? -1 : 1;
  const previousOuter = offsetPoint(
    vertex,
    previous.normal,
    prepared.radius * outerSide,
  );
  const nextOuter = offsetPoint(
    vertex,
    next.normal,
    prepared.radius * outerSide,
  );

  if (prepared.stroke.linejoin === "round") {
    metrics.roundJoinCount += 1;
    const previousVector = {
      x: previous.normal.x * outerSide,
      y: previous.normal.y * outerSide,
    };
    const nextVector = {
      x: next.normal.x * outerSide,
      y: next.normal.y * outerSide,
    };
    const sweep = signedAngle(previousVector, nextVector);
    metrics.arcTriangleCount += builder.arcFan(
      prepared.stroke,
      vertex,
      prepared.radius,
      Math.atan2(previousVector.y, previousVector.x),
      sweep,
      prepared.arcTolerance,
      1,
    );
    return;
  }

  if (prepared.stroke.linejoin === "miter") {
    const miter = miterPoint(
      vertex,
      previous,
      next,
      outerSide,
      prepared.radius,
    );
    const miterRatio = miter
      ? Math.sqrt(squaredDistance(vertex, miter)) / prepared.radius
      : Infinity;
    if (
      miter
      && Number.isFinite(miterRatio)
      && miterRatio <= Math.max(1, prepared.stroke.miterLimit)
    ) {
      metrics.miterJoinCount += 1;
      builder.quad(
        prepared.stroke,
        vertex,
        previousOuter,
        miter,
        nextOuter,
      );
      return;
    }
    metrics.miterFallbackCount += 1;
  }

  metrics.bevelJoinCount += 1;
  builder.triangle(
    prepared.stroke,
    vertex,
    previousOuter,
    nextOuter,
  );
}

function emitJoins(
  builder: DirectMeshBuilder,
  prepared: PreparedSubpath,
  segments: readonly DirectSegment[],
  metrics: MutableMetrics,
): void {
  if (segments.length < 2) return;
  if (prepared.subpath.closed) {
    for (let index = 0; index < segments.length; index += 1) {
      const previous = segments[(index + segments.length - 1) % segments.length];
      const next = segments[index];
      emitJoin(builder, prepared, next.start, previous, next, metrics);
    }
    return;
  }
  for (let index = 1; index < segments.length; index += 1) {
    const previous = segments[index - 1];
    const next = segments[index];
    const sharedVertex = squaredDistance(previous.end, next.start)
      <= GEOMETRY_EPSILON
      ? next.start
      : previous.end;
    emitJoin(builder, prepared, sharedVertex, previous, next, metrics);
  }
}

function immutableMetrics(
  mutable: MutableMetrics,
  mesh: VectorTextGpuMeshData | null,
  emitMs: number,
  totalMs: number,
): DirectVectorSvgStrokeCompileMetrics {
  const vertexBytes = mesh?.vertices.byteLength ?? 0;
  const indexBytes = mesh?.indices.byteLength ?? 0;
  return {
    strategy: DIRECT_VECTOR_SVG_STROKE_STRATEGY,
    ...mutable,
    vertexCount: mesh ? mesh.vertices.length / 2 : 0,
    indexCount: mesh?.indices.length ?? 0,
    vertexBytes,
    indexBytes,
    totalBytes: vertexBytes + indexBytes,
    emitMs,
    totalMs,
  };
}

/**
 * Expands retained centerlines directly into segment, join, and cap triangles.
 * The output intentionally performs no polygon union or general triangulation.
 */
export function compileDirectVectorSvgStrokeMesh(
  strokes: readonly VectorSvgStroke[],
  quality: VectorSvgStrokeExpansionQuality,
  revision: string,
  metadata: DirectVectorSvgStrokeMeshMetadata = {},
): DirectVectorSvgStrokeCompileResult {
  const totalStartedAt = clockNow();
  const metrics = createMutableMetrics(strokes);
  const prepared = prepareSubpaths(strokes, quality, metrics);
  const builder = new DirectMeshBuilder();
  const emitStartedAt = clockNow();
  for (const item of prepared) {
    if (item.subpath.points.length === 1) {
      emitPointStroke(builder, item, metrics);
      continue;
    }
    const segments = normalizedSegments(
      item.subpath.points,
      item.subpath.closed,
      metrics,
    );
    if (segments.length === 0) {
      emitPointStroke(builder, item, metrics);
      continue;
    }
    emitSegmentQuads(builder, item, segments);
    emitJoins(builder, item, segments, metrics);
    emitOpenCaps(builder, item, segments, metrics);
  }
  const mesh = builder.finish(revision, metadata);
  const emitMs = clockNow() - emitStartedAt;
  const totalMs = clockNow() - totalStartedAt;
  return {
    mesh,
    metrics: immutableMetrics(metrics, mesh, emitMs, totalMs),
  };
}
