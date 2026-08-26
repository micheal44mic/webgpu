export const CLONE_SAMPLE_MODES = [
  "current",
  "current-and-below",
  "all-visible",
] as const;

export type CloneSampleMode = (typeof CLONE_SAMPLE_MODES)[number];

export const DEFAULT_CLONE_SAMPLE_MODE: CloneSampleMode = "current-and-below";
export const DEFAULT_CLONE_ALIGNED = false;
export const DEFAULT_CLONE_ANGLE_DEGREES = 0;
export const CLONE_MIN_ANGLE_DEGREES = -180;
export const CLONE_MAX_ANGLE_DEGREES = 180;
export const CLONE_SOURCE_MOUSE_HIT_RADIUS_PX = 20;
export const CLONE_SOURCE_TOUCH_HIT_RADIUS_PX = 28;

export interface ClonePoint {
  readonly x: number;
  readonly y: number;
}

export interface CloneCanvasView {
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly zoom: number;
  readonly rotationCos: number;
  readonly rotationSin: number;
}

export interface CloneClientRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

interface CloneSourceGesture {
  readonly kind: "source-pick" | "source-drag";
  readonly initialSourcePoint: ClonePoint | null;
  readonly initialMarkerPoint: ClonePoint | null;
  readonly initialHoverTargetPoint: ClonePoint | null;
  readonly initialAlignedOffset: ClonePoint | null;
  readonly initialSourcePickArmed: boolean;
  readonly previewPoint: ClonePoint;
}

interface CloneStrokeGesture {
  readonly kind: "clone-stroke";
  readonly alignedAtStart: boolean;
  readonly angleDegreesAtStart: number;
  readonly samplingRotationCos: number;
  readonly samplingRotationSin: number;
  readonly sourceAnchorPoint: ClonePoint;
  readonly destinationAnchorPoint: ClonePoint;
  /** Affine bias in sample = rotate(target, angle) + bias. */
  readonly offset: ClonePoint;
  readonly targetPoint: ClonePoint;
  readonly samplePoint: ClonePoint;
  readonly initialMarkerPoint: ClonePoint | null;
  readonly initialHoverTargetPoint: ClonePoint | null;
  readonly initialAlignedOffset: ClonePoint | null;
}

export type CloneInteractionGesture = CloneSourceGesture | CloneStrokeGesture;

export interface CloneInteractionState {
  readonly sourcePoint: ClonePoint | null;
  readonly markerPoint: ClonePoint | null;
  readonly hoverTargetPoint: ClonePoint | null;
  readonly sampleMode: CloneSampleMode;
  readonly aligned: boolean;
  readonly angleDegrees: number;
  /** Cached inverse rotation used on the pointer hot path. */
  readonly samplingRotationCos: number;
  readonly samplingRotationSin: number;
  /** Affine bias retained between strokes while Aligned is enabled. */
  readonly alignedOffset: ClonePoint | null;
  readonly sourcePickArmed: boolean;
  readonly gesture: CloneInteractionGesture | null;
}

function finiteCoordinate(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function normalizeClonePoint(point: Readonly<ClonePoint>): ClonePoint {
  return {
    x: finiteCoordinate(point.x),
    y: finiteCoordinate(point.y),
  };
}

function copyPoint(point: Readonly<ClonePoint> | null): ClonePoint | null {
  return point ? normalizeClonePoint(point) : null;
}

function subtractPoints(left: Readonly<ClonePoint>, right: Readonly<ClonePoint>): ClonePoint {
  return {
    x: finiteCoordinate(left.x - right.x),
    y: finiteCoordinate(left.y - right.y),
  };
}

function addPoints(left: Readonly<ClonePoint>, right: Readonly<ClonePoint>): ClonePoint {
  return {
    x: finiteCoordinate(left.x + right.x),
    y: finiteCoordinate(left.y + right.y),
  };
}

export function normalizeCloneAngleDegrees(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_CLONE_ANGLE_DEGREES;
  }
  return Math.min(
    CLONE_MAX_ANGLE_DEGREES,
    Math.max(CLONE_MIN_ANGLE_DEGREES, value),
  );
}

function snappedTrig(value: number): number {
  if (Math.abs(value) < 1e-12) return 0;
  if (Math.abs(value - 1) < 1e-12) return 1;
  if (Math.abs(value + 1) < 1e-12) return -1;
  return value;
}

/** Rotates a document-space vector. Positive angles are clockwise on the y-down canvas. */
export function cloneRotatePoint(
  point: Readonly<ClonePoint>,
  angleDegrees: unknown,
): ClonePoint {
  const radians = normalizeCloneAngleDegrees(angleDegrees) * Math.PI / 180;
  const cosine = snappedTrig(Math.cos(radians));
  const sine = snappedTrig(Math.sin(radians));
  const normalized = normalizeClonePoint(point);
  return {
    x: finiteCoordinate(cosine * normalized.x - sine * normalized.y),
    y: finiteCoordinate(sine * normalized.x + cosine * normalized.y),
  };
}

export function cloneAffineSamplePoint(
  target: Readonly<ClonePoint>,
  bias: Readonly<ClonePoint>,
  angleDegrees: unknown,
): ClonePoint {
  // Sampling uses the inverse transform so a positive UI angle rotates the
  // cloned appearance clockwise rather than rotating the lookup path.
  return addPoints(
    cloneRotatePoint(target, -normalizeCloneAngleDegrees(angleDegrees)),
    bias,
  );
}

function cloneSamplingRotation(angleDegrees: unknown): {
  readonly cosine: number;
  readonly sine: number;
} {
  const radians = -normalizeCloneAngleDegrees(angleDegrees) * Math.PI / 180;
  return {
    cosine: snappedTrig(Math.cos(radians)),
    sine: snappedTrig(Math.sin(radians)),
  };
}

function cloneAffineSamplePointWithRotation(
  target: Readonly<ClonePoint>,
  bias: Readonly<ClonePoint>,
  cosine: number,
  sine: number,
): ClonePoint {
  const normalized = normalizeClonePoint(target);
  return addPoints({
    x: cosine * normalized.x - sine * normalized.y,
    y: sine * normalized.x + cosine * normalized.y,
  }, bias);
}

export function isCloneSampleMode(value: string | undefined): value is CloneSampleMode {
  return value !== undefined
    && (CLONE_SAMPLE_MODES as readonly string[]).includes(value);
}

export function normalizeCloneSampleMode(value: unknown): CloneSampleMode {
  return typeof value === "string" && isCloneSampleMode(value)
    ? value
    : DEFAULT_CLONE_SAMPLE_MODE;
}

export function createCloneInteractionState(
  initial: Partial<Pick<
    CloneInteractionState,
    "sourcePoint" | "sampleMode" | "aligned" | "angleDegrees" | "sourcePickArmed"
  >> = {},
): CloneInteractionState {
  const sourcePoint = copyPoint(initial.sourcePoint ?? null);
  const angleDegrees = normalizeCloneAngleDegrees(initial.angleDegrees);
  const samplingRotation = cloneSamplingRotation(angleDegrees);
  return {
    sourcePoint,
    markerPoint: copyPoint(sourcePoint),
    hoverTargetPoint: null,
    sampleMode: normalizeCloneSampleMode(initial.sampleMode),
    aligned: initial.aligned ?? DEFAULT_CLONE_ALIGNED,
    angleDegrees,
    samplingRotationCos: samplingRotation.cosine,
    samplingRotationSin: samplingRotation.sine,
    alignedOffset: null,
    sourcePickArmed: initial.sourcePickArmed === true,
    gesture: null,
  };
}

export function cloneSetSampleMode(
  state: Readonly<CloneInteractionState>,
  sampleMode: unknown,
): CloneInteractionState {
  if (state.gesture) return state as CloneInteractionState;
  return {
    ...state,
    sampleMode: normalizeCloneSampleMode(sampleMode),
  };
}

function markerForIdleState(
  state: Readonly<CloneInteractionState>,
  aligned = state.aligned,
): ClonePoint | null {
  if (
    aligned
    && state.alignedOffset
    && state.hoverTargetPoint
  ) {
    return cloneAffineSamplePointWithRotation(
      state.hoverTargetPoint,
      state.alignedOffset,
      state.samplingRotationCos,
      state.samplingRotationSin,
    );
  }
  return copyPoint(state.sourcePoint);
}

export function cloneSetAngle(
  state: Readonly<CloneInteractionState>,
  angleDegrees: unknown,
): CloneInteractionState {
  if (state.gesture) return state as CloneInteractionState;
  const normalized = normalizeCloneAngleDegrees(angleDegrees);
  if (normalized === state.angleDegrees) return state as CloneInteractionState;
  const samplingRotation = cloneSamplingRotation(normalized);
  return {
    ...state,
    angleDegrees: normalized,
    samplingRotationCos: samplingRotation.cosine,
    samplingRotationSin: samplingRotation.sine,
    // An aligned affine mapping belongs to the angle at which it was created.
    // Re-anchor the next stroke instead of making the source marker jump.
    alignedOffset: null,
    markerPoint: copyPoint(state.sourcePoint),
  };
}

export function cloneSetAligned(
  state: Readonly<CloneInteractionState>,
  aligned: boolean,
): CloneInteractionState {
  if (state.gesture) return state as CloneInteractionState;
  const next = {
    ...state,
    aligned: Boolean(aligned),
    alignedOffset: aligned ? copyPoint(state.alignedOffset) : null,
  };
  return {
    ...next,
    markerPoint: markerForIdleState(next),
  };
}

export function cloneSetSourcePickArmed(
  state: Readonly<CloneInteractionState>,
  armed: boolean,
): CloneInteractionState {
  if (state.gesture) return state as CloneInteractionState;
  return {
    ...state,
    sourcePickArmed: Boolean(armed),
  };
}

export function cloneSetSourcePoint(
  state: Readonly<CloneInteractionState>,
  point: Readonly<ClonePoint> | null,
): CloneInteractionState {
  if (state.gesture) return state as CloneInteractionState;
  const sourcePoint = copyPoint(point);
  return {
    ...state,
    sourcePoint,
    markerPoint: copyPoint(sourcePoint),
    hoverTargetPoint: null,
    alignedOffset: null,
    sourcePickArmed: false,
  };
}

export function cloneHoverTarget(
  state: Readonly<CloneInteractionState>,
  target: Readonly<ClonePoint>,
): CloneInteractionState {
  if (state.gesture || !state.sourcePoint) return state as CloneInteractionState;
  const hoverTargetPoint = normalizeClonePoint(target);
  const next = { ...state, hoverTargetPoint };
  return {
    ...next,
    markerPoint: markerForIdleState(next),
  };
}

export function cloneClearHoverTarget(
  state: Readonly<CloneInteractionState>,
): CloneInteractionState {
  if (state.gesture || state.hoverTargetPoint === null) return state as CloneInteractionState;
  return {
    ...state,
    hoverTargetPoint: null,
    markerPoint: copyPoint(state.sourcePoint),
  };
}

function beginSourceGesture(
  state: Readonly<CloneInteractionState>,
  point: Readonly<ClonePoint>,
  kind: CloneSourceGesture["kind"],
): CloneInteractionState {
  if (state.gesture) return state as CloneInteractionState;
  const previewPoint = normalizeClonePoint(point);
  return {
    ...state,
    markerPoint: previewPoint,
    hoverTargetPoint: null,
    gesture: {
      kind,
      initialSourcePoint: copyPoint(state.sourcePoint),
      initialMarkerPoint: copyPoint(state.markerPoint),
      initialHoverTargetPoint: copyPoint(state.hoverTargetPoint),
      initialAlignedOffset: copyPoint(state.alignedOffset),
      initialSourcePickArmed: state.sourcePickArmed,
      previewPoint,
    },
  };
}

export function cloneBeginSourcePick(
  state: Readonly<CloneInteractionState>,
  point: Readonly<ClonePoint>,
): CloneInteractionState {
  return beginSourceGesture(state, point, "source-pick");
}

export function cloneBeginSourceDrag(
  state: Readonly<CloneInteractionState>,
  point: Readonly<ClonePoint>,
): CloneInteractionState {
  if (!state.sourcePoint) return state as CloneInteractionState;
  return beginSourceGesture(state, point, "source-drag");
}

export function cloneBeginStroke(
  state: Readonly<CloneInteractionState>,
  target: Readonly<ClonePoint>,
): CloneInteractionState {
  if (!state.sourcePoint || state.gesture) return state as CloneInteractionState;
  const targetPoint = normalizeClonePoint(target);
  const rotatedTarget = cloneAffineSamplePointWithRotation(
    targetPoint,
    { x: 0, y: 0 },
    state.samplingRotationCos,
    state.samplingRotationSin,
  );
  const offset = state.aligned && state.alignedOffset
    ? copyPoint(state.alignedOffset)!
    : subtractPoints(state.sourcePoint, rotatedTarget);
  const samplePoint = cloneAffineSamplePointWithRotation(
    targetPoint,
    offset,
    state.samplingRotationCos,
    state.samplingRotationSin,
  );
  return {
    ...state,
    markerPoint: samplePoint,
    hoverTargetPoint: targetPoint,
    alignedOffset: state.aligned ? offset : state.alignedOffset,
    gesture: {
      kind: "clone-stroke",
      alignedAtStart: state.aligned,
      angleDegreesAtStart: state.angleDegrees,
      samplingRotationCos: state.samplingRotationCos,
      samplingRotationSin: state.samplingRotationSin,
      sourceAnchorPoint: copyPoint(samplePoint)!,
      destinationAnchorPoint: copyPoint(targetPoint)!,
      offset,
      targetPoint,
      samplePoint,
      initialMarkerPoint: copyPoint(state.markerPoint),
      initialHoverTargetPoint: copyPoint(state.hoverTargetPoint),
      initialAlignedOffset: copyPoint(state.alignedOffset),
    },
  };
}

export function cloneUpdateGesture(
  state: Readonly<CloneInteractionState>,
  point: Readonly<ClonePoint>,
): CloneInteractionState {
  const gesture = state.gesture;
  if (!gesture) return state as CloneInteractionState;
  const nextPoint = normalizeClonePoint(point);
  if (gesture.kind !== "clone-stroke") {
    return {
      ...state,
      markerPoint: nextPoint,
      gesture: { ...gesture, previewPoint: nextPoint },
    };
  }
  const samplePoint = cloneAffineSamplePointWithRotation(
    nextPoint,
    gesture.offset,
    gesture.samplingRotationCos,
    gesture.samplingRotationSin,
  );
  return {
    ...state,
    markerPoint: samplePoint,
    hoverTargetPoint: nextPoint,
    gesture: {
      ...gesture,
      targetPoint: nextPoint,
      samplePoint,
    },
  };
}

export function cloneEndGesture(
  state: Readonly<CloneInteractionState>,
  commit: boolean,
): CloneInteractionState {
  const gesture = state.gesture;
  if (!gesture) return state as CloneInteractionState;
  if (gesture.kind !== "clone-stroke") {
    if (!commit) {
      return {
        ...state,
        sourcePoint: copyPoint(gesture.initialSourcePoint),
        markerPoint: copyPoint(gesture.initialMarkerPoint),
        hoverTargetPoint: copyPoint(gesture.initialHoverTargetPoint),
        alignedOffset: copyPoint(gesture.initialAlignedOffset),
        sourcePickArmed: gesture.initialSourcePickArmed,
        gesture: null,
      };
    }
    const sourcePoint = copyPoint(gesture.previewPoint);
    return {
      ...state,
      sourcePoint,
      markerPoint: copyPoint(sourcePoint),
      hoverTargetPoint: null,
      alignedOffset: null,
      sourcePickArmed: false,
      gesture: null,
    };
  }
  if (!commit) {
    return {
      ...state,
      markerPoint: copyPoint(gesture.initialMarkerPoint),
      hoverTargetPoint: copyPoint(gesture.initialHoverTargetPoint),
      alignedOffset: copyPoint(gesture.initialAlignedOffset),
      gesture: null,
    };
  }
  return {
    ...state,
    markerPoint: gesture.alignedAtStart
      ? copyPoint(gesture.samplePoint)
      : copyPoint(state.sourcePoint),
    hoverTargetPoint: copyPoint(gesture.targetPoint),
    alignedOffset: gesture.alignedAtStart
      ? copyPoint(gesture.offset)
      : null,
    gesture: null,
  };
}

export interface CloneStrokeSample {
  readonly targetPoint: ClonePoint;
  readonly samplePoint: ClonePoint;
  readonly sourceAnchorPoint: ClonePoint;
  readonly destinationAnchorPoint: ClonePoint;
  readonly angleDegrees: number;
  /** Affine bias; at 0° this is the familiar source/destination offset. */
  readonly offset: ClonePoint;
}

export function cloneCurrentStrokeSample(
  state: Readonly<CloneInteractionState>,
): CloneStrokeSample | null {
  const gesture = state.gesture;
  if (!gesture || gesture.kind !== "clone-stroke") return null;
  return {
    targetPoint: copyPoint(gesture.targetPoint)!,
    samplePoint: copyPoint(gesture.samplePoint)!,
    sourceAnchorPoint: copyPoint(gesture.sourceAnchorPoint)!,
    destinationAnchorPoint: copyPoint(gesture.destinationAnchorPoint)!,
    angleDegrees: gesture.angleDegreesAtStart,
    offset: copyPoint(gesture.offset)!,
  };
}

export function hitTestCloneSourceMarker(
  markerClientPoint: Readonly<ClonePoint> | null,
  clientPoint: Readonly<ClonePoint>,
  pointerType: string,
): boolean {
  if (!markerClientPoint) return false;
  const radius = pointerType === "touch"
    ? CLONE_SOURCE_TOUCH_HIT_RADIUS_PX
    : CLONE_SOURCE_MOUSE_HIT_RADIUS_PX;
  const deltaX = finiteCoordinate(clientPoint.x) - markerClientPoint.x;
  const deltaY = finiteCoordinate(clientPoint.y) - markerClientPoint.y;
  return deltaX * deltaX + deltaY * deltaY <= radius * radius;
}

export function cloneDocumentPointToClient(
  point: Readonly<ClonePoint>,
  view: Readonly<CloneCanvasView>,
  rectangle: Readonly<CloneClientRect>,
): ClonePoint {
  const canvasWidth = Math.max(1, finiteCoordinate(view.canvasWidth));
  const canvasHeight = Math.max(1, finiteCoordinate(view.canvasHeight));
  const deltaX = finiteCoordinate(point.x) - finiteCoordinate(view.centerX);
  const deltaY = finiteCoordinate(point.y) - finiteCoordinate(view.centerY);
  const zoom = Math.max(0, finiteCoordinate(view.zoom));
  const canvasX = canvasWidth * 0.5 + zoom * (
    finiteCoordinate(view.rotationCos) * deltaX
      - finiteCoordinate(view.rotationSin) * deltaY
  );
  const canvasY = canvasHeight * 0.5 + zoom * (
    finiteCoordinate(view.rotationSin) * deltaX
      + finiteCoordinate(view.rotationCos) * deltaY
  );
  return {
    x: finiteCoordinate(rectangle.left)
      + canvasX * Math.max(0, finiteCoordinate(rectangle.width)) / canvasWidth,
    y: finiteCoordinate(rectangle.top)
      + canvasY * Math.max(0, finiteCoordinate(rectangle.height)) / canvasHeight,
  };
}
