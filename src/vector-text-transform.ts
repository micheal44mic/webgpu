import type { Shadow3dPathData } from "./vector-shadow-3d.js";

export const VECTOR_TEXT_TRANSFORM_STRATEGY =
  "kittl-compatible-centered-arch-wave-distort-six-vertex-four-handle-cubic-distance-warp-circle-rigid-glyph-v3" as const;

export type VectorTextTransformType =
  | "none"
  | "distort"
  | "arch"
  | "circle"
  | "wave";

export interface VectorTextTransformParameters {
  readonly type: VectorTextTransformType;
  readonly curve: number;
  readonly circleRadiusPercent: number;
  readonly circleInverted: boolean;
  readonly distortPoints: VectorTextDistortPoints | null;
}

export interface VectorTextPoint {
  readonly x: number;
  readonly y: number;
}

export interface VectorTextBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export type VectorTextDistortPoints = readonly [
  topLeftVertex: VectorTextPoint,
  topMiddleVertex: VectorTextPoint,
  topRightVertex: VectorTextPoint,
  bottomRightVertex: VectorTextPoint,
  bottomMiddleVertex: VectorTextPoint,
  bottomLeftVertex: VectorTextPoint,
  topLeftHandle: VectorTextPoint,
  topRightHandle: VectorTextPoint,
  bottomLeftHandle: VectorTextPoint,
  bottomRightHandle: VectorTextPoint,
];

export interface VectorTextCurveGuide {
  readonly kind: "curve";
  readonly type: "arch" | "wave";
  readonly length: number;
  readonly startY: number;
  pointAtDistance(distance: number): VectorTextPoint;
  sample(count: number): readonly VectorTextPoint[];
}

export interface VectorTextCirclePlacement {
  readonly targetX: number;
  readonly targetY: number;
  readonly rotation: number;
}

export const VECTOR_TEXT_TRANSFORM_CURVE_MINIMUM = -100;
export const VECTOR_TEXT_TRANSFORM_CURVE_MAXIMUM = 100;
export const VECTOR_TEXT_CIRCLE_RADIUS_PERCENT_MINIMUM = 16;
export const VECTOR_TEXT_CIRCLE_RADIUS_PERCENT_MAXIMUM = 200;
export const VECTOR_TEXT_CIRCLE_RADIUS_PERCENT_DEFAULT = 50;
export const VECTOR_TEXT_TRANSFORM_CURVE_DEFAULT = 80;

// Kittl's two cubic presets, read in normalized object coordinates. Points
// 0/3/6 are anchors; 1/2 and 4/5 are the outgoing/incoming handles.
const CURVE_PRESETS = {
  arch: [
    { x: 0, y: 1 },
    { x: 0.2, y: 0.7 },
    { x: 0.33, y: 0.65 },
    { x: 0.5, y: 0.65 },
    { x: 0.67, y: 0.65 },
    { x: 0.8, y: 0.7 },
    { x: 1, y: 1 },
  ],
  wave: [
    { x: 0, y: 1 },
    { x: 0.35, y: 0.65 },
    { x: 0.45, y: 0.6 },
    { x: 0.65, y: 0.55 },
    { x: 0.75, y: 0.525 },
    { x: 0.8, y: 0.5 },
    { x: 1, y: 0.6 },
  ],
} as const;

const CUBIC_GUIDE_SAMPLES_PER_SEGMENT = 1024;
interface MutablePoint {
  x: number;
  y: number;
}

interface CubicSegment {
  readonly p0: VectorTextPoint;
  readonly p1: VectorTextPoint;
  readonly p2: VectorTextPoint;
  readonly p3: VectorTextPoint;
}

interface CurveSample {
  readonly distance: number;
  readonly point: VectorTextPoint;
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export function normalizeVectorTextTransformType(
  type: VectorTextTransformType | string | undefined,
): VectorTextTransformType {
  return type === "distort"
    || type === "arch"
    || type === "circle"
    || type === "wave"
    ? type
    : "none";
}

export function normalizeVectorTextDistortPoints(
  points: readonly VectorTextPoint[] | null | undefined,
): VectorTextDistortPoints | null {
  if (
    !points
    || points.length !== 10
    || points.some((point) =>
      !Number.isFinite(point?.x) || !Number.isFinite(point?.y))
  ) {
    return null;
  }
  return points.map((point) => ({
    x: point.x,
    y: point.y,
  })) as unknown as VectorTextDistortPoints;
}

export function defaultVectorTextDistortPoints(
  bounds: VectorTextBounds,
): VectorTextDistortPoints {
  const left = finite(bounds.left, 0);
  const top = finite(bounds.top, 0);
  const right = finite(bounds.right, left + 1);
  const bottom = finite(bounds.bottom, top + 1);
  const width = right - left;
  const middleX = left + width * 0.5;
  return [
    { x: left, y: top },
    { x: middleX, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: middleX, y: bottom },
    { x: left, y: bottom },
    { x: left + width * 0.25, y: top },
    { x: left + width * 0.75, y: top },
    { x: left + width * 0.25, y: bottom },
    { x: left + width * 0.75, y: bottom },
  ];
}

export function normalizeVectorTextTransformCurve(curve: number | undefined): number {
  return Math.min(
    VECTOR_TEXT_TRANSFORM_CURVE_MAXIMUM,
    Math.max(
      VECTOR_TEXT_TRANSFORM_CURVE_MINIMUM,
      finite(curve ?? VECTOR_TEXT_TRANSFORM_CURVE_DEFAULT, VECTOR_TEXT_TRANSFORM_CURVE_DEFAULT),
    ),
  );
}

export function normalizeVectorTextCircleRadiusPercent(
  radiusPercent: number | undefined,
): number {
  return Math.min(
    VECTOR_TEXT_CIRCLE_RADIUS_PERCENT_MAXIMUM,
    Math.max(
      VECTOR_TEXT_CIRCLE_RADIUS_PERCENT_MINIMUM,
      finite(
        radiusPercent ?? VECTOR_TEXT_CIRCLE_RADIUS_PERCENT_DEFAULT,
        VECTOR_TEXT_CIRCLE_RADIUS_PERCENT_DEFAULT,
      ),
    ),
  );
}

export function normalizeVectorTextTransformParameters(
  parameters: Partial<VectorTextTransformParameters> | undefined,
): VectorTextTransformParameters {
  return {
    type: normalizeVectorTextTransformType(parameters?.type),
    curve: normalizeVectorTextTransformCurve(parameters?.curve),
    circleRadiusPercent: normalizeVectorTextCircleRadiusPercent(
      parameters?.circleRadiusPercent,
    ),
    circleInverted: parameters?.circleInverted === true,
    distortPoints: normalizeVectorTextDistortPoints(
      parameters?.distortPoints,
    ),
  };
}

function cubicPoint(segment: CubicSegment, t: number): VectorTextPoint {
  const oneMinusT = 1 - t;
  const aa = oneMinusT * oneMinusT;
  const bb = t * t;
  const w0 = aa * oneMinusT;
  const w1 = 3 * aa * t;
  const w2 = 3 * oneMinusT * bb;
  const w3 = bb * t;
  return {
    x:
      segment.p0.x * w0
      + segment.p1.x * w1
      + segment.p2.x * w2
      + segment.p3.x * w3,
    y:
      segment.p0.y * w0
      + segment.p1.y * w1
      + segment.p2.y * w2
      + segment.p3.y * w3,
  };
}

function pointDistance(first: VectorTextPoint, second: VectorTextPoint): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function normalizedCurvePoints(
  type: "arch" | "wave",
  width: number,
  lineHeight: number,
  curve: number,
): readonly VectorTextPoint[] {
  const safeWidth = Math.max(1, finite(width, 1));
  const safeHeight = Math.max(1, finite(lineHeight, 1));
  const preset = CURVE_PRESETS[type];
  const raw = preset.map((point) => ({
    x: (point.x - 0.5) * safeWidth,
    y: (point.y - 0.5) * safeHeight,
  }));
  const minimumY = Math.min(...raw.map((point) => point.y));
  const maximumY = Math.max(...raw.map((point) => point.y));
  const middleY = (minimumY + maximumY) * 0.5;
  const range = Math.max(Number.EPSILON, maximumY - minimumY);
  const normalizedCurve = normalizeVectorTextTransformCurve(curve);
  // H5 uses H4(0) = 1e-6 to keep Paper.Path non-degenerate at 0%.
  const signedRatio = normalizedCurve === 0 ? 1e-6 : normalizedCurve / 100;
  const signedHeight = signedRatio * safeHeight;
  return raw.map((point) => ({
    x: point.x,
    y: middleY + (point.y - middleY) / range * signedHeight,
  }));
}

function sampledCurvePath(
  segments: readonly CubicSegment[],
): { samples: readonly CurveSample[]; length: number } {
  const samples: CurveSample[] = [];
  let distance = 0;
  let previous = segments[0].p0;
  samples.push({ distance: 0, point: previous });
  for (const segment of segments) {
    for (
      let index = 1;
      index <= CUBIC_GUIDE_SAMPLES_PER_SEGMENT;
      index += 1
    ) {
      const point = cubicPoint(
        segment,
        index / CUBIC_GUIDE_SAMPLES_PER_SEGMENT,
      );
      distance += pointDistance(previous, point);
      samples.push({ distance, point });
      previous = point;
    }
  }
  return { samples, length: distance };
}

function pointAtSampledDistance(
  samples: readonly CurveSample[],
  length: number,
  requestedDistance: number,
): VectorTextPoint {
  const target = Math.min(length, Math.max(0, requestedDistance));
  let low = 0;
  let high = samples.length - 1;
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if (samples[middle].distance < target) {
      low = middle;
    } else {
      high = middle;
    }
  }
  const first = samples[low];
  const second = samples[high];
  const span = second.distance - first.distance;
  if (span <= Number.EPSILON) {
    return second.point;
  }
  const ratio = (target - first.distance) / span;
  return {
    x: first.point.x + (second.point.x - first.point.x) * ratio,
    y: first.point.y + (second.point.y - first.point.y) * ratio,
  };
}

export function buildVectorTextCurveGuide(
  type: "arch" | "wave",
  width: number,
  lineHeight: number,
  curve: number,
): VectorTextCurveGuide {
  const points = normalizedCurvePoints(type, width, lineHeight, curve);
  const segments: readonly CubicSegment[] = [
    {
      p0: points[0],
      p1: points[1],
      p2: points[2],
      p3: points[3],
    },
    {
      p0: points[3],
      p1: points[4],
      p2: points[5],
      p3: points[6],
    },
  ];
  const sampled = sampledCurvePath(segments);
  return {
    kind: "curve",
    type,
    length: sampled.length,
    startY: points[0].y,
    pointAtDistance: (distance: number) =>
      pointAtSampledDistance(sampled.samples, sampled.length, distance),
    sample: (count: number) => {
      const safeCount = Math.max(2, Math.round(count));
      return Array.from({ length: safeCount }, (_unused, index) =>
        pointAtSampledDistance(
          sampled.samples,
          sampled.length,
          sampled.length * index / (safeCount - 1),
        ));
    },
  };
}

function evaluateQuadratic(
  start: VectorTextPoint,
  control: VectorTextPoint,
  end: VectorTextPoint,
  t: number,
): VectorTextPoint {
  const oneMinusT = 1 - t;
  return {
    x:
      oneMinusT * oneMinusT * start.x
      + 2 * oneMinusT * t * control.x
      + t * t * end.x,
    y:
      oneMinusT * oneMinusT * start.y
      + 2 * oneMinusT * t * control.y
      + t * t * end.y,
  };
}

function evaluateCubic(
  start: VectorTextPoint,
  firstControl: VectorTextPoint,
  secondControl: VectorTextPoint,
  end: VectorTextPoint,
  t: number,
): VectorTextPoint {
  return cubicPoint({
    p0: start,
    p1: firstControl,
    p2: secondControl,
    p3: end,
  }, t);
}

export function warpVectorTextPathAlongCurve(
  path: Shadow3dPathData,
  guide: VectorTextCurveGuide,
  sourceOriginX: number,
  sourceOriginY = 0,
  sourceDistanceOffset = 0,
): Shadow3dPathData {
  // Kittl maps every OpenType anchor/control point through Paper.Path#getPointAt
  // and deliberately preserves the original path verbs. This keeps the curve
  // count constant: changing the transform is a geometry edit, while zooming
  // remains the same analytic Slug/WebGPU draw as an unwarped text.
  const coords = new Float64Array(path.coords.length);
  for (let index = 0; index < path.coords.length; index += 2) {
    const point = {
      x: path.coords[index],
      y: path.coords[index + 1],
    };
    const curvePoint = guide.pointAtDistance(
      sourceDistanceOffset + point.x - sourceOriginX,
    );
    coords[index] = curvePoint.x;
    coords[index + 1] = curvePoint.y + point.y - sourceOriginY;
  }
  return {
    verbs: path.verbs.slice(),
    coords,
    contourOffsets: path.contourOffsets.slice(),
    fillRule: path.fillRule,
  };
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, finite(value, 0)));
}

function interpolatePoint(
  first: VectorTextPoint,
  second: VectorTextPoint,
  ratio: number,
): VectorTextPoint {
  return {
    x: first.x + (second.x - first.x) * ratio,
    y: first.y + (second.y - first.y) * ratio,
  };
}

interface PreparedCubicSegment {
  readonly samples: readonly CurveSample[];
  readonly length: number;
}

function prepareCubicSegment(segment: CubicSegment): PreparedCubicSegment {
  const sampled = sampledCurvePath([segment]);
  return {
    samples: sampled.samples,
    length: sampled.length,
  };
}

function preparedCubicPointAtLengthRatio(
  prepared: PreparedCubicSegment,
  ratio: number,
): VectorTextPoint {
  return pointAtSampledDistance(
    prepared.samples,
    prepared.length,
    prepared.length * clampUnit(ratio),
  );
}

export function moveVectorTextDistortPoint(
  points: VectorTextDistortPoints,
  pointIndex: number,
  target: VectorTextPoint,
): VectorTextDistortPoints {
  const next = normalizeVectorTextDistortPoints(points)!;
  if (
    !Number.isInteger(pointIndex)
    || pointIndex < 0
    || pointIndex >= next.length
    || !Number.isFinite(target.x)
    || !Number.isFinite(target.y)
  ) {
    return next;
  }
  const mutable = next as unknown as VectorTextPoint[];
  const original = points[pointIndex];
  const deltaX = target.x - original.x;
  const deltaY = target.y - original.y;
  mutable[pointIndex] = { x: target.x, y: target.y };

  if (pointIndex === 1 || pointIndex === 4) {
    const handles = pointIndex === 1 ? [6, 7] : [8, 9];
    for (const handleIndex of handles) {
      mutable[handleIndex] = {
        x: points[handleIndex].x + deltaX,
        y: points[handleIndex].y + deltaY,
      };
    }
  }

  const mirrorHandle = (
    firstHandle: number,
    secondHandle: number,
    anchorIndex: number,
  ) => {
    if (pointIndex !== firstHandle && pointIndex !== secondHandle) {
      return;
    }
    const oppositeIndex = pointIndex === firstHandle
      ? secondHandle
      : firstHandle;
    const anchor = points[anchorIndex];
    const directionX = target.x - anchor.x;
    const directionY = target.y - anchor.y;
    const directionLength = Math.hypot(directionX, directionY);
    if (directionLength <= Number.EPSILON) {
      return;
    }
    const oppositeLength = pointDistance(points[oppositeIndex], anchor);
    mutable[oppositeIndex] = {
      x: anchor.x - directionX / directionLength * oppositeLength,
      y: anchor.y - directionY / directionLength * oppositeLength,
    };
  };
  mirrorHandle(6, 7, 1);
  mirrorHandle(8, 9, 4);
  return next;
}

export function vectorTextDistortBoundaryPath(
  points: VectorTextDistortPoints,
): Shadow3dPathData {
  const [topLeft, topMiddle, topRight, bottomRight, bottomMiddle, bottomLeft,
    topHandleLeft, topHandleRight, bottomHandleLeft, bottomHandleRight] = points;
  return {
    verbs: new Uint8Array([0, 3, 3, 1, 3, 3, 1, 4]),
    coords: new Float64Array([
      topLeft.x, topLeft.y,
      topLeft.x, topLeft.y,
      topHandleLeft.x, topHandleLeft.y,
      topMiddle.x, topMiddle.y,
      topHandleRight.x, topHandleRight.y,
      topRight.x, topRight.y,
      topRight.x, topRight.y,
      bottomRight.x, bottomRight.y,
      bottomRight.x, bottomRight.y,
      bottomHandleRight.x, bottomHandleRight.y,
      bottomMiddle.x, bottomMiddle.y,
      bottomHandleLeft.x, bottomHandleLeft.y,
      bottomLeft.x, bottomLeft.y,
      bottomLeft.x, bottomLeft.y,
      topLeft.x, topLeft.y,
    ]),
    contourOffsets: new Uint32Array([0]),
    fillRule: 0,
  };
}

export function vectorTextDistortBounds(
  points: VectorTextDistortPoints,
): VectorTextBounds {
  return vectorTextPathBounds(vectorTextDistortBoundaryPath(points));
}

// Kittl H1: split the source bbox with the line joining two length-weighted
// breakpoints, normalize X inside the selected half, sample its top/bottom
// cubics at the same arc-length ratio, then interpolate them by source Y.
function createVectorTextFreeFormMapper(
  sourceBounds: VectorTextBounds,
  points: VectorTextDistortPoints,
): (point: VectorTextPoint) => VectorTextPoint {
  const [topLeft, topMiddle, topRight, bottomRight, bottomMiddle, bottomLeft,
    topHandleLeft, topHandleRight, bottomHandleLeft, bottomHandleRight] = points;
  const topLeftCurve = prepareCubicSegment({
    p0: topLeft,
    p1: topLeft,
    p2: topHandleLeft,
    p3: topMiddle,
  });
  const topRightCurve = prepareCubicSegment({
    p0: topMiddle,
    p1: topHandleRight,
    p2: topRight,
    p3: topRight,
  });
  const bottomLeftCurve = prepareCubicSegment({
    p0: bottomLeft,
    p1: bottomLeft,
    p2: bottomHandleLeft,
    p3: bottomMiddle,
  });
  const bottomRightCurve = prepareCubicSegment({
    p0: bottomMiddle,
    p1: bottomHandleRight,
    p2: bottomRight,
    p3: bottomRight,
  });
  const sourceWidth = Math.max(Number.EPSILON, sourceBounds.right - sourceBounds.left);
  const sourceHeight = Math.max(Number.EPSILON, sourceBounds.bottom - sourceBounds.top);
  const topBreakpointX = sourceBounds.left + sourceWidth
    * topLeftCurve.length
    / Math.max(Number.EPSILON, topLeftCurve.length + topRightCurve.length);
  const bottomBreakpointX = sourceBounds.left + sourceWidth
    * bottomLeftCurve.length
    / Math.max(Number.EPSILON, bottomLeftCurve.length + bottomRightCurve.length);
  return (point: VectorTextPoint): VectorTextPoint => {
    const verticalRatio = clampUnit((point.y - sourceBounds.top) / sourceHeight);
    const breakpointX = topBreakpointX
      + (bottomBreakpointX - topBreakpointX) * verticalRatio;
    const onLeft = point.x <= breakpointX;
    const horizontalRatio = onLeft
      ? clampUnit(
        (point.x - sourceBounds.left)
        / Math.max(Number.EPSILON, breakpointX - sourceBounds.left),
      )
      : clampUnit(
        (point.x - breakpointX)
        / Math.max(Number.EPSILON, sourceBounds.right - breakpointX),
      );
    const targetTop = preparedCubicPointAtLengthRatio(
      onLeft ? topLeftCurve : topRightCurve,
      horizontalRatio,
    );
    const targetBottom = preparedCubicPointAtLengthRatio(
      onLeft ? bottomLeftCurve : bottomRightCurve,
      horizontalRatio,
    );
    return interpolatePoint(targetTop, targetBottom, verticalRatio);
  };
}

export function warpVectorTextPointFreeForm(
  point: VectorTextPoint,
  sourceBounds: VectorTextBounds,
  points: VectorTextDistortPoints,
): VectorTextPoint {
  return createVectorTextFreeFormMapper(sourceBounds, points)(point);
}

export function warpVectorTextPathFreeForm(
  path: Shadow3dPathData,
  sourceBounds: VectorTextBounds,
  points: VectorTextDistortPoints,
): Shadow3dPathData {
  const coords = new Float64Array(path.coords.length);
  const transformPoint = createVectorTextFreeFormMapper(sourceBounds, points);
  for (let index = 0; index < path.coords.length; index += 2) {
    const transformed = transformPoint(
      { x: path.coords[index], y: path.coords[index + 1] },
    );
    coords[index] = transformed.x;
    coords[index + 1] = transformed.y;
  }
  return {
    verbs: path.verbs.slice(),
    coords,
    contourOffsets: path.contourOffsets.slice(),
    fillRule: path.fillRule,
  };
}

export function vectorTextCirclePlacement(
  glyphCenterX: number,
  textCenterX: number,
  radius: number,
  inverted: boolean,
): VectorTextCirclePlacement {
  const safeRadius = Math.max(1e-6, Math.abs(radius));
  const offset = (glyphCenterX - textCenterX) / safeRadius;
  // Kittl lays a centered line over getLineLength() = 2 * PI * radius.
  // Consequently the midpoint is PI radians after HH's start handle: the
  // upper arc for the normal direction and the lower arc when inverted.
  if (inverted) {
    return {
      targetX: Math.sin(offset) * safeRadius,
      targetY: Math.cos(offset) * safeRadius,
      rotation: -offset,
    };
  }
  return {
    targetX: Math.sin(offset) * safeRadius,
    targetY: -Math.cos(offset) * safeRadius,
    rotation: offset,
  };
}

export function vectorTextCircleAffine(
  pivotX: number,
  pivotY: number,
  textCenterX: number,
  radius: number,
  inverted: boolean,
): readonly [number, number, number, number, number, number] {
  const placement = vectorTextCirclePlacement(
    pivotX,
    textCenterX,
    radius,
    inverted,
  );
  const cosine = Math.cos(placement.rotation);
  const sine = Math.sin(placement.rotation);
  return [
    cosine,
    sine,
    -sine,
    cosine,
    placement.targetX - cosine * pivotX + sine * pivotY,
    placement.targetY - sine * pivotX - cosine * pivotY,
  ];
}

function transformPointAffine(
  point: VectorTextPoint,
  matrix: readonly [number, number, number, number, number, number],
): VectorTextPoint {
  return {
    x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
    y: matrix[1] * point.x + matrix[3] * point.y + matrix[5],
  };
}

export function transformVectorTextPathAffine(
  path: Shadow3dPathData,
  matrix: readonly [number, number, number, number, number, number],
): Shadow3dPathData {
  const coords = new Float64Array(path.coords.length);
  for (let index = 0; index < path.coords.length; index += 2) {
    const transformed = transformPointAffine({
      x: path.coords[index],
      y: path.coords[index + 1],
    }, matrix);
    coords[index] = transformed.x;
    coords[index + 1] = transformed.y;
  }
  return {
    verbs: path.verbs.slice(),
    coords,
    contourOffsets: path.contourOffsets.slice(),
    fillRule: path.fillRule,
  };
}

export function mergeVectorTextPaths(
  paths: readonly Shadow3dPathData[],
): Shadow3dPathData {
  const verbCount = paths.reduce((total, path) => total + path.verbs.length, 0);
  const coordinateCount = paths.reduce(
    (total, path) => total + path.coords.length,
    0,
  );
  const contourCount = paths.reduce(
    (total, path) => total + path.contourOffsets.length,
    0,
  );
  const verbs = new Uint8Array(verbCount);
  const coords = new Float64Array(coordinateCount);
  const contourOffsets = new Uint32Array(contourCount);
  let verbOffset = 0;
  let coordinateOffset = 0;
  let contourOffset = 0;
  for (const path of paths) {
    verbs.set(path.verbs, verbOffset);
    coords.set(path.coords, coordinateOffset);
    for (const sourceOffset of path.contourOffsets) {
      contourOffsets[contourOffset] = verbOffset + sourceOffset;
      contourOffset += 1;
    }
    verbOffset += path.verbs.length;
    coordinateOffset += path.coords.length;
  }
  return {
    verbs,
    coords,
    contourOffsets,
    fillRule: paths[0]?.fillRule ?? 0,
  };
}

function includePoint(bounds: MutablePoint[], point: VectorTextPoint): void {
  bounds[0].x = Math.min(bounds[0].x, point.x);
  bounds[0].y = Math.min(bounds[0].y, point.y);
  bounds[1].x = Math.max(bounds[1].x, point.x);
  bounds[1].y = Math.max(bounds[1].y, point.y);
}

function quadraticExtremum(
  start: number,
  control: number,
  end: number,
): number | null {
  const denominator = start - 2 * control + end;
  if (Math.abs(denominator) <= Number.EPSILON) {
    return null;
  }
  const t = (start - control) / denominator;
  return t > 0 && t < 1 ? t : null;
}

function cubicDerivativeRoots(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
): number[] {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  if (Math.abs(a) <= Number.EPSILON) {
    if (Math.abs(b) <= Number.EPSILON) {
      return [];
    }
    const root = -c / b;
    return root > 0 && root < 1 ? [root] : [];
  }
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) {
    return [];
  }
  const squareRoot = Math.sqrt(discriminant);
  const first = (-b + squareRoot) / (2 * a);
  const second = (-b - squareRoot) / (2 * a);
  return [first, second].filter((root) => root > 0 && root < 1);
}

export function vectorTextPathBounds(path: Shadow3dPathData): VectorTextBounds {
  const bounds: MutablePoint[] = [
    { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY },
    { x: Number.NEGATIVE_INFINITY, y: Number.NEGATIVE_INFINITY },
  ];
  let coordinateOffset = 0;
  let current: VectorTextPoint | null = null;
  let contourStart: VectorTextPoint | null = null;
  for (const rawVerb of path.verbs) {
    const verb = Number(rawVerb);
    if (verb === 0) {
      current = {
        x: path.coords[coordinateOffset],
        y: path.coords[coordinateOffset + 1],
      };
      coordinateOffset += 2;
      contourStart = current;
      includePoint(bounds, current);
    } else if (verb === 1 && current) {
      const end = {
        x: path.coords[coordinateOffset],
        y: path.coords[coordinateOffset + 1],
      };
      coordinateOffset += 2;
      includePoint(bounds, end);
      current = end;
    } else if (verb === 2 && current) {
      const control = {
        x: path.coords[coordinateOffset],
        y: path.coords[coordinateOffset + 1],
      };
      const end = {
        x: path.coords[coordinateOffset + 2],
        y: path.coords[coordinateOffset + 3],
      };
      coordinateOffset += 4;
      includePoint(bounds, end);
      const xRoot = quadraticExtremum(current.x, control.x, end.x);
      if (xRoot !== null) {
        includePoint(bounds, evaluateQuadratic(current, control, end, xRoot));
      }
      const yRoot = quadraticExtremum(current.y, control.y, end.y);
      if (yRoot !== null) {
        includePoint(bounds, evaluateQuadratic(current, control, end, yRoot));
      }
      current = end;
    } else if (verb === 3 && current) {
      const firstControl = {
        x: path.coords[coordinateOffset],
        y: path.coords[coordinateOffset + 1],
      };
      const secondControl = {
        x: path.coords[coordinateOffset + 2],
        y: path.coords[coordinateOffset + 3],
      };
      const end = {
        x: path.coords[coordinateOffset + 4],
        y: path.coords[coordinateOffset + 5],
      };
      coordinateOffset += 6;
      includePoint(bounds, end);
      const roots = new Set([
        ...cubicDerivativeRoots(
          current.x,
          firstControl.x,
          secondControl.x,
          end.x,
        ),
        ...cubicDerivativeRoots(
          current.y,
          firstControl.y,
          secondControl.y,
          end.y,
        ),
      ]);
      for (const root of roots) {
        includePoint(
          bounds,
          evaluateCubic(current, firstControl, secondControl, end, root),
        );
      }
      current = end;
    } else if (verb === 4) {
      current = contourStart;
    }
  }
  if (!Number.isFinite(bounds[0].x)) {
    return { left: 0, top: 0, right: 0, bottom: 0 };
  }
  return {
    left: bounds[0].x,
    top: bounds[0].y,
    right: bounds[1].x,
    bottom: bounds[1].y,
  };
}

export function shiftVectorTextPath(
  path: Shadow3dPathData,
  deltaX: number,
  deltaY: number,
): Shadow3dPathData {
  const coords = path.coords.slice();
  for (let index = 0; index < coords.length; index += 2) {
    coords[index] += deltaX;
    coords[index + 1] += deltaY;
  }
  return {
    verbs: path.verbs.slice(),
    coords,
    contourOffsets: path.contourOffsets.slice(),
    fillRule: path.fillRule,
  };
}

export function vectorTextCircleEnvelopeBounds(
  left: number,
  top: number,
  right: number,
  bottom: number,
  pivotY: number,
  radius: number,
  inverted: boolean,
  samples = 512,
): VectorTextBounds {
  const bounds: MutablePoint[] = [
    { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY },
    { x: Number.NEGATIVE_INFINITY, y: Number.NEGATIVE_INFINITY },
  ];
  const textCenterX = (left + right) * 0.5;
  const safeSamples = Math.max(8, Math.round(samples));
  for (let index = 0; index <= safeSamples; index += 1) {
    const x = left + (right - left) * index / safeSamples;
    const placement = vectorTextCirclePlacement(
      x,
      textCenterX,
      radius,
      inverted,
    );
    const cosine = Math.cos(placement.rotation);
    const sine = Math.sin(placement.rotation);
    for (const y of [top, bottom]) {
      const localY = y - pivotY;
      includePoint(bounds, {
        x: placement.targetX - sine * localY,
        y: placement.targetY + cosine * localY,
      });
    }
  }
  return {
    left: bounds[0].x,
    top: bounds[0].y,
    right: bounds[1].x,
    bottom: bounds[1].y,
  };
}
