export const SHAPE_CREATION_KINDS = [
  "rectangle",
  "ellipse",
  "star",
] as const;

export type ShapeCreationKind = (typeof SHAPE_CREATION_KINDS)[number];
export type ShapeCreationPointerType = "mouse" | "pen" | "touch";
export type ShapeAspectConstraintSource =
  | "none"
  | "requested"
  | "multi-touch"
  | "shape";

export interface ShapeCreationPoint {
  readonly x: number;
  readonly y: number;
}

export interface ShapeCreationPointerInput {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly point: ShapeCreationPoint;
  /** A keyboard, button or other explicit request for a 1:1 frame. */
  readonly constrainAspect?: boolean;
}

export interface ShapeCreationGesture {
  readonly kind: ShapeCreationKind;
  readonly primaryPointerId: number;
  readonly primaryPointerType: ShapeCreationPointerType;
  readonly startPoint: ShapeCreationPoint;
  readonly currentPoint: ShapeCreationPoint;
  readonly horizontalDirection: -1 | 1;
  readonly verticalDirection: -1 | 1;
  readonly constraintRequested: boolean;
  /** Includes the primary pointer when the gesture began with touch. */
  readonly activeTouchPointerIds: readonly number[];
}

export interface ShapeCreationFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ShapeCreationDraft {
  readonly kind: ShapeCreationKind;
  /** The fixed center of the shape. */
  readonly startPoint: ShapeCreationPoint;
  /** The unmodified position of the drawing pointer. */
  readonly rawEndPoint: ShapeCreationPoint;
  /** The endpoint after applying the current aspect policy. */
  readonly endPoint: ShapeCreationPoint;
  readonly frame: ShapeCreationFrame;
  readonly signedHalfWidth: number;
  readonly signedHalfHeight: number;
  readonly aspectConstrained: boolean;
  readonly constraintSource: ShapeAspectConstraintSource;
}

export interface ShapeCreationPointerEnd {
  readonly gesture: ShapeCreationGesture | null;
  readonly completedDraft: ShapeCreationDraft | null;
  readonly primaryEnded: boolean;
}

function finiteCoordinate(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function normalizePoint(point: Readonly<ShapeCreationPoint>): ShapeCreationPoint {
  return {
    x: finiteCoordinate(point.x),
    y: finiteCoordinate(point.y),
  };
}

function normalizePointerType(pointerType: string): ShapeCreationPointerType {
  if (pointerType === "touch" || pointerType === "pen") return pointerType;
  return "mouse";
}

function directionFromDelta(value: number, fallback: -1 | 1): -1 | 1 {
  if (value > 0) return 1;
  if (value < 0) return -1;
  return fallback;
}

function appendUnique(values: readonly number[], value: number): readonly number[] {
  return values.includes(value) ? values : [...values, value];
}

export function beginShapeCreation(
  kind: ShapeCreationKind,
  input: Readonly<ShapeCreationPointerInput>,
): ShapeCreationGesture {
  const point = normalizePoint(input.point);
  const pointerType = normalizePointerType(input.pointerType);
  return {
    kind,
    primaryPointerId: input.pointerId,
    primaryPointerType: pointerType,
    startPoint: point,
    currentPoint: point,
    horizontalDirection: 1,
    verticalDirection: 1,
    constraintRequested: input.constrainAspect === true,
    activeTouchPointerIds: pointerType === "touch" ? [input.pointerId] : [],
  };
}

/**
 * Adds a modifier touch without changing the drawing pointer or either of its
 * coordinates. Mouse and pen gestures remain single-pointer gestures.
 */
export function addShapeCreationPointer(
  gesture: Readonly<ShapeCreationGesture>,
  input: Readonly<ShapeCreationPointerInput>,
): ShapeCreationGesture {
  if (
    gesture.primaryPointerType !== "touch"
    || normalizePointerType(input.pointerType) !== "touch"
  ) return gesture as ShapeCreationGesture;
  const activeTouchPointerIds = appendUnique(
    gesture.activeTouchPointerIds,
    input.pointerId,
  );
  if (activeTouchPointerIds === gesture.activeTouchPointerIds) {
    return gesture as ShapeCreationGesture;
  }
  return { ...gesture, activeTouchPointerIds };
}

export function updateShapeCreationPointer(
  gesture: Readonly<ShapeCreationGesture>,
  input: Readonly<ShapeCreationPointerInput>,
): ShapeCreationGesture {
  if (input.pointerId !== gesture.primaryPointerId) {
    return gesture as ShapeCreationGesture;
  }
  const currentPoint = normalizePoint(input.point);
  const deltaX = currentPoint.x - gesture.startPoint.x;
  const deltaY = currentPoint.y - gesture.startPoint.y;
  return {
    ...gesture,
    currentPoint,
    horizontalDirection: directionFromDelta(deltaX, gesture.horizontalDirection),
    verticalDirection: directionFromDelta(deltaY, gesture.verticalDirection),
    constraintRequested: input.constrainAspect === undefined
      ? gesture.constraintRequested
      : input.constrainAspect,
  };
}

export function setShapeCreationConstraintRequested(
  gesture: Readonly<ShapeCreationGesture>,
  requested: boolean,
): ShapeCreationGesture {
  if (gesture.constraintRequested === requested) {
    return gesture as ShapeCreationGesture;
  }
  return { ...gesture, constraintRequested: requested };
}

export function removeShapeCreationPointer(
  gesture: Readonly<ShapeCreationGesture>,
  pointerId: number,
): ShapeCreationGesture {
  if (
    pointerId === gesture.primaryPointerId
    || !gesture.activeTouchPointerIds.includes(pointerId)
  ) return gesture as ShapeCreationGesture;
  return {
    ...gesture,
    activeTouchPointerIds: gesture.activeTouchPointerIds.filter(
      (activePointerId) => activePointerId !== pointerId,
    ),
  };
}

export function shapeCreationConstraintSource(
  gesture: Readonly<ShapeCreationGesture>,
): ShapeAspectConstraintSource {
  if (gesture.kind === "star") return "shape";
  if (
    gesture.primaryPointerType === "touch"
    && gesture.activeTouchPointerIds.length >= 2
  ) return "multi-touch";
  if (gesture.constraintRequested) return "requested";
  return "none";
}

export function currentShapeCreationDraft(
  gesture: Readonly<ShapeCreationGesture>,
): ShapeCreationDraft {
  const rawDeltaX = gesture.currentPoint.x - gesture.startPoint.x;
  const rawDeltaY = gesture.currentPoint.y - gesture.startPoint.y;
  const constraintSource = shapeCreationConstraintSource(gesture);
  const aspectConstrained = constraintSource !== "none";
  const side = Math.max(Math.abs(rawDeltaX), Math.abs(rawDeltaY));
  const signedHalfWidth = aspectConstrained
    ? side * gesture.horizontalDirection
    : rawDeltaX;
  const signedHalfHeight = aspectConstrained
    ? side * gesture.verticalDirection
    : rawDeltaY;
  const endPoint = {
    x: gesture.startPoint.x + signedHalfWidth,
    y: gesture.startPoint.y + signedHalfHeight,
  };
  const absoluteHalfWidth = Math.abs(signedHalfWidth);
  const absoluteHalfHeight = Math.abs(signedHalfHeight);
  return {
    kind: gesture.kind,
    startPoint: normalizePoint(gesture.startPoint),
    rawEndPoint: normalizePoint(gesture.currentPoint),
    endPoint,
    frame: {
      x: gesture.startPoint.x - absoluteHalfWidth,
      y: gesture.startPoint.y - absoluteHalfHeight,
      width: absoluteHalfWidth * 2,
      height: absoluteHalfHeight * 2,
    },
    signedHalfWidth,
    signedHalfHeight,
    aspectConstrained,
    constraintSource,
  };
}

export function endShapeCreationPointer(
  gesture: Readonly<ShapeCreationGesture>,
  pointerId: number,
  commit = true,
): ShapeCreationPointerEnd {
  if (pointerId !== gesture.primaryPointerId) {
    return {
      gesture: removeShapeCreationPointer(gesture, pointerId),
      completedDraft: null,
      primaryEnded: false,
    };
  }
  return {
    gesture: null,
    completedDraft: commit ? currentShapeCreationDraft(gesture) : null,
    primaryEnded: true,
  };
}
