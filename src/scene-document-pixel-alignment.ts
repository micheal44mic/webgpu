import {
  sceneLocalToLayer,
  type SceneLocalBounds,
  type ScenePoint,
  type SceneTransform,
  type SceneTransformHandle,
  type SceneTransformSideHandle,
} from "./scene-transform-geometry.ts";
import {
  sceneSideScaleUpdate,
  type SceneAxisTransformUpdate,
  type SceneSideScaleInput,
} from "./scene-group-transform.ts";

export const DOCUMENT_PIXEL_ALIGNMENT_STEP = 1;

export interface SceneDocumentPixelFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function withoutNegativeZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

export function sceneDocumentPixelCoordinate(value: number): number {
  return withoutNegativeZero(Math.round(finite(value)));
}

/** Pixel-valued effect measurements are stored in whole document pixels. */
export function sceneDocumentPixelLength(value: number): number {
  return Math.max(0, sceneDocumentPixelCoordinate(value));
}

export function sceneDocumentPixelIsCardinalRotation(
  rotation: number,
  tolerance = 1e-7,
): boolean {
  if (!Number.isFinite(rotation)) return false;
  const quarterTurn = Math.PI * 0.5;
  const nearest = Math.round(rotation / quarterTurn) * quarterTurn;
  const delta = Math.atan2(
    Math.sin(rotation - nearest),
    Math.cos(rotation - nearest),
  );
  return Math.abs(delta) <= Math.max(0, tolerance);
}

export type SceneDocumentPixelQuarterTurn = 0 | 1 | 2 | 3;

export function sceneDocumentPixelQuarterTurn(
  rotation: number,
  tolerance = 1e-7,
): SceneDocumentPixelQuarterTurn | null {
  if (!sceneDocumentPixelIsCardinalRotation(rotation, tolerance)) return null;
  const turns = Math.round(rotation / (Math.PI * 0.5));
  return ((turns % 4) + 4) % 4 as SceneDocumentPixelQuarterTurn;
}

/**
 * Aligns a center-drawn frame without making preview and committed geometry
 * disagree. Integer outer edges are preferred over retaining a fractional
 * pointer center; an odd-sized frame therefore has a half-pixel center.
 */
export function sceneDocumentPixelCenteredFrame(
  frame: Readonly<SceneDocumentPixelFrame>,
  square = false,
): SceneDocumentPixelFrame {
  const centerX = finite(frame.x) + Math.max(0, finite(frame.width)) * 0.5;
  const centerY = finite(frame.y) + Math.max(0, finite(frame.height)) * 0.5;
  let width = sceneDocumentPixelLength(frame.width);
  let height = sceneDocumentPixelLength(frame.height);
  if (square) {
    const side = sceneDocumentPixelLength(Math.max(frame.width, frame.height));
    width = side;
    height = side;
  }
  const x = sceneDocumentPixelCoordinate(centerX - width * 0.5);
  const y = sceneDocumentPixelCoordinate(centerY - height * 0.5);
  return { x, y, width, height };
}

export function sceneDocumentPixelExpandedBounds(
  bounds: Readonly<SceneLocalBounds>,
  reach: number,
): SceneLocalBounds {
  const safeReach = Math.max(0, finite(reach));
  return {
    left: bounds.left - safeReach,
    top: bounds.top - safeReach,
    right: bounds.right + safeReach,
    bottom: bounds.bottom + safeReach,
  };
}

function localPointForHandle(
  bounds: Readonly<SceneLocalBounds>,
  handle: SceneTransformHandle,
): ScenePoint {
  const centerX = (bounds.left + bounds.right) * 0.5;
  const centerY = (bounds.top + bounds.bottom) * 0.5;
  return {
    x: handle === "north" || handle === "south"
      ? centerX
      : handle === "north-west" || handle === "south-west" || handle === "west"
        ? bounds.left
        : bounds.right,
    y: handle === "east" || handle === "west"
      ? centerY
      : handle === "north-west" || handle === "north-east" || handle === "north"
        ? bounds.top
        : bounds.bottom,
  };
}

function transformedBounds(
  localBounds: Readonly<SceneLocalBounds>,
  transform: Readonly<SceneTransform>,
): SceneLocalBounds {
  const points = [
    { x: localBounds.left, y: localBounds.top },
    { x: localBounds.right, y: localBounds.top },
    { x: localBounds.right, y: localBounds.bottom },
    { x: localBounds.left, y: localBounds.bottom },
  ].map((point) => sceneLocalToLayer(point, transform));
  return {
    left: Math.min(...points.map((point) => point.x)),
    top: Math.min(...points.map((point) => point.y)),
    right: Math.max(...points.map((point) => point.x)),
    bottom: Math.max(...points.map((point) => point.y)),
  };
}

/** Aligns the outer start edges while preserving the object's geometry. */
export function sceneDocumentPixelAlignedPosition(
  localBounds: Readonly<SceneLocalBounds>,
  transform: Readonly<SceneTransform>,
): ScenePoint {
  const bounds = transformedBounds(localBounds, transform);
  return {
    x: transform.x + sceneDocumentPixelCoordinate(bounds.left) - bounds.left,
    y: transform.y + sceneDocumentPixelCoordinate(bounds.top) - bounds.top,
  };
}

/**
 * Whole-document-pixel translation is permanent and intentionally independent
 * of the optional smart-guide and visible-grid preferences.
 */
export function sceneDocumentPixelAlignedTranslation(
  startBounds: Readonly<SceneLocalBounds>,
  rawDelta: Readonly<ScenePoint>,
): ScenePoint {
  return {
    x: sceneDocumentPixelCoordinate(startBounds.left + rawDelta.x) - startBounds.left,
    y: sceneDocumentPixelCoordinate(startBounds.top + rawDelta.y) - startBounds.top,
  };
}

function uniformScaleUnit(
  point: Readonly<ScenePoint>,
  transform: Readonly<SceneTransform>,
): ScenePoint | null {
  const baseScale = transform.scale;
  if (!Number.isFinite(baseScale) || Math.abs(baseScale) <= Number.EPSILON) return null;
  const scaleXRatio = (transform.scaleX ?? baseScale) / baseScale;
  const scaleYRatio = (transform.scaleY ?? baseScale) / baseScale;
  const scaledX = point.x * scaleXRatio;
  const scaledY = point.y * scaleYRatio;
  const cosine = Math.cos(transform.rotation);
  const sine = Math.sin(transform.rotation);
  return {
    x: cosine * scaledX - sine * scaledY,
    y: sine * scaledX + cosine * scaledY,
  };
}

/**
 * Snaps the moving transform handle to the nearest reachable document-pixel
 * line. Uniform corner scaling is preserved, including pre-existing unequal
 * axis scales; no source path coordinate is rounded.
 */
export function sceneDocumentPixelAlignedUniformScale(input: Readonly<{
  transform: Readonly<SceneTransform>;
  localBounds: Readonly<SceneLocalBounds>;
  handle: SceneTransformHandle;
  rawScale: number;
  minimumScale: number;
  maximumScale: number;
}>): number {
  if (!Number.isFinite(input.rawScale)) return input.rawScale;
  const point = localPointForHandle(input.localBounds, input.handle);
  const unit = uniformScaleUnit(point, input.transform);
  if (!unit) return input.rawScale;
  const rawPoint = {
    x: input.transform.x + unit.x * input.rawScale,
    y: input.transform.y + unit.y * input.rawScale,
  };
  const minimum = Math.max(Number.EPSILON, input.minimumScale);
  const maximum = Math.max(minimum, input.maximumScale);
  let bestScale = input.rawScale;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const axis of ["x", "y"] as const) {
    const component = unit[axis];
    if (Math.abs(component) <= 1e-9) continue;
    const coordinate = rawPoint[axis];
    const targets = new Set([
      Math.floor(coordinate),
      Math.round(coordinate),
      Math.ceil(coordinate),
    ]);
    for (const target of targets) {
      const pivot = input.transform[axis];
      const scale = (target - pivot) / component;
      if (!Number.isFinite(scale) || scale < minimum || scale > maximum) continue;
      const pointX = input.transform.x + unit.x * scale;
      const pointY = input.transform.y + unit.y * scale;
      const distance = Math.hypot(pointX - rawPoint.x, pointY - rawPoint.y);
      if (
        distance < bestDistance - 1e-9
        || (Math.abs(distance - bestDistance) <= 1e-9
          && Math.abs(scale - input.rawScale) < Math.abs(bestScale - input.rawScale))
      ) {
        bestDistance = distance;
        bestScale = scale;
      }
    }
  }
  return Math.min(maximum, Math.max(minimum, bestScale));
}

function sideMovementDirection(
  rotation: number,
  handle: SceneTransformSideHandle,
): ScenePoint {
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  return handle === "east" || handle === "west"
    ? { x: cosine, y: sine }
    : { x: -sine, y: cosine };
}

/** Keeps the fixed side fixed and snaps the dragged side to a document-pixel line. */
export function sceneDocumentPixelAlignedSideScaleUpdate(
  input: Readonly<SceneSideScaleInput>,
): SceneAxisTransformUpdate | null {
  const rawUpdate = sceneSideScaleUpdate(input);
  if (!rawUpdate) return null;
  const { bounds, handle } = input;
  const movingPoint = localPointForHandle(bounds, handle);
  const rawMovingPoint = sceneLocalToLayer(movingPoint, rawUpdate);
  const direction = sideMovementDirection(input.start.rotation, handle);
  const axis = Math.abs(direction.x) >= Math.abs(direction.y) ? "x" : "y";
  const component = direction[axis];
  if (Math.abs(component) <= 1e-9) return rawUpdate;
  const correction = (
    sceneDocumentPixelCoordinate(rawMovingPoint[axis]) - rawMovingPoint[axis]
  ) / component;
  const adjustedPointer = {
    x: input.pointer.x + direction.x * correction,
    y: input.pointer.y + direction.y * correction,
  };
  return sceneSideScaleUpdate({ ...input, pointer: adjustedPointer }) ?? rawUpdate;
}
