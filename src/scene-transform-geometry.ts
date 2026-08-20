import type { VectorTextViewState } from "./vector-text-types";

export interface ScenePoint {
  readonly x: number;
  readonly y: number;
}

export interface SceneLocalBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface SceneTransform {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly rotation: number;
}

export type SceneTransformHandle =
  | "north-west"
  | "north-east"
  | "south-east"
  | "south-west";

const TRANSFORM_HANDLES: readonly SceneTransformHandle[] = [
  "north-west",
  "north-east",
  "south-east",
  "south-west",
];

export function scenePointDistance(first: ScenePoint, second: ScenePoint): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

export function scenePointInConvexPolygon(
  point: ScenePoint,
  polygon: readonly ScenePoint[],
): boolean {
  let sign = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    const cross = (next.x - current.x) * (point.y - current.y)
      - (next.y - current.y) * (point.x - current.x);
    if (Math.abs(cross) < 1e-6) continue;
    const nextSign = Math.sign(cross);
    if (sign !== 0 && nextSign !== sign) return false;
    sign = nextSign;
  }
  return true;
}

/** Even/odd hit test for concave Warp boundaries. */
export function scenePointInPolygon(
  point: ScenePoint,
  polygon: readonly ScenePoint[],
): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let current = 0, previous = polygon.length - 1;
    current < polygon.length;
    previous = current, current += 1) {
    const first = polygon[current];
    const second = polygon[previous];
    const crosses = (first.y > point.y) !== (second.y > point.y)
      && point.x < (second.x - first.x) * (point.y - first.y)
        / (second.y - first.y) + first.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function scenePointToSegmentDistance(
  point: ScenePoint,
  start: ScenePoint,
  end: ScenePoint,
): number {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const squaredLength = deltaX * deltaX + deltaY * deltaY;
  if (squaredLength <= 1e-12) return scenePointDistance(point, start);
  const parameter = Math.min(1, Math.max(0,
    ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / squaredLength,
  ));
  return scenePointDistance(point, {
    x: start.x + deltaX * parameter,
    y: start.y + deltaY * parameter,
  });
}

export function sceneLocalToLayer(
  point: ScenePoint,
  transform: Readonly<SceneTransform>,
): ScenePoint {
  const scaledX = point.x * transform.scale;
  const scaledY = point.y * transform.scale;
  const cosine = Math.cos(transform.rotation);
  const sine = Math.sin(transform.rotation);
  return {
    x: transform.x + cosine * scaledX - sine * scaledY,
    y: transform.y + sine * scaledX + cosine * scaledY,
  };
}

export function sceneLayerToLocal(
  point: ScenePoint,
  transform: Readonly<SceneTransform>,
): ScenePoint {
  const deltaX = point.x - transform.x;
  const deltaY = point.y - transform.y;
  const cosine = Math.cos(transform.rotation);
  const sine = Math.sin(transform.rotation);
  const safeScale = Math.max(Number.EPSILON, Math.abs(transform.scale));
  return {
    x: (cosine * deltaX + sine * deltaY) / safeScale,
    y: (-sine * deltaX + cosine * deltaY) / safeScale,
  };
}

export function sceneLayerToCanvas(
  point: ScenePoint,
  view: Readonly<VectorTextViewState>,
): ScenePoint {
  const deltaX = point.x - view.centerX;
  const deltaY = point.y - view.centerY;
  return {
    x: view.canvasWidth * 0.5
      + (view.rotationCos * deltaX - view.rotationSin * deltaY) * view.zoom,
    y: view.canvasHeight * 0.5
      + (view.rotationSin * deltaX + view.rotationCos * deltaY) * view.zoom,
  };
}

export function sceneTransformCorners(
  bounds: Readonly<SceneLocalBounds>,
  transform: Readonly<SceneTransform>,
  view: Readonly<VectorTextViewState>,
): readonly ScenePoint[] {
  return [
    { x: bounds.left, y: bounds.top },
    { x: bounds.right, y: bounds.top },
    { x: bounds.right, y: bounds.bottom },
    { x: bounds.left, y: bounds.bottom },
  ].map((point) => sceneLayerToCanvas(sceneLocalToLayer(point, transform), view));
}

export function sceneRotationHandle(
  corners: readonly ScenePoint[],
  transform: Readonly<SceneTransform>,
  view: Readonly<VectorTextViewState>,
  offsetCssPixels: number,
): ScenePoint {
  const topCenter = {
    x: (corners[0].x + corners[1].x) * 0.5,
    y: (corners[0].y + corners[1].y) * 0.5,
  };
  const center = sceneLayerToCanvas({ x: transform.x, y: transform.y }, view);
  const directionX = topCenter.x - center.x;
  const directionY = topCenter.y - center.y;
  const length = Math.max(1, Math.hypot(directionX, directionY));
  const backingPerCssPixel = view.canvasWidth / Math.max(1, view.cssWidth);
  const offset = offsetCssPixels * backingPerCssPixel;
  return {
    x: topCenter.x + directionX / length * offset,
    y: topCenter.y + directionY / length * offset,
  };
}

export function hitSceneTransformHandle(
  point: ScenePoint,
  corners: readonly ScenePoint[],
  rotationHandle: ScenePoint,
  hitRadius: number,
): SceneTransformHandle | "rotate" | null {
  if (scenePointDistance(point, rotationHandle) <= hitRadius) return "rotate";
  const index = corners.findIndex(
    (corner) => scenePointDistance(point, corner) <= hitRadius,
  );
  return index >= 0 ? TRANSFORM_HANDLES[index] : null;
}

export function hitsSceneTransformBody(
  point: ScenePoint,
  corners: readonly ScenePoint[],
  minimumEdgeReach = 0,
): boolean {
  if (scenePointInConvexPolygon(point, corners)) return true;
  if (minimumEdgeReach <= 0) return false;
  for (let index = 0; index < corners.length; index += 1) {
    if (
      scenePointToSegmentDistance(
        point,
        corners[index],
        corners[(index + 1) % corners.length],
      ) <= minimumEdgeReach
    ) return true;
  }
  return false;
}

export function closestSceneControlPoint(
  point: ScenePoint,
  controls: readonly ScenePoint[],
  hitRadius: number,
): number | null {
  let closestIndex: number | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < controls.length; index += 1) {
    const distance = scenePointDistance(point, controls[index]);
    if (distance <= hitRadius && distance < closestDistance) {
      closestIndex = index;
      closestDistance = distance;
    }
  }
  return closestIndex;
}
