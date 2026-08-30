import {
  sceneLocalToLayer,
  type SceneLocalBounds,
  type SceneTransform,
  type SceneTransformHandle,
} from "./scene-transform-geometry";
import type { VectorTextViewState } from "./vector-text-types";

export interface SceneAxisAlignedBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export type SceneSnapAxis = "x" | "y";
export type SceneSnapTargetKind = "document" | "layer" | "grid";
export type SceneSnapAnchor = "start" | "center" | "end";

export interface SceneSnapTarget {
  readonly axis: SceneSnapAxis;
  readonly position: number;
  readonly kind: Exclude<SceneSnapTargetKind, "grid">;
  readonly key?: string;
}

export interface SceneSnapTargetIndex {
  readonly x: readonly SceneSnapTarget[];
  readonly y: readonly SceneSnapTarget[];
}

export type SceneSnapTargetSource = readonly SceneSnapTarget[] | SceneSnapTargetIndex;

export interface SceneSnapMatch {
  readonly axis: SceneSnapAxis;
  readonly position: number;
  readonly kind: SceneSnapTargetKind;
  readonly anchor: SceneSnapAnchor;
  readonly key?: string;
}

export interface SceneSnapLatch {
  readonly x: SceneSnapMatch | null;
  readonly y: SceneSnapMatch | null;
}

export interface SceneTranslationSnapInput {
  readonly startBounds: Readonly<SceneAxisAlignedBounds>;
  readonly rawDelta: Readonly<{ x: number; y: number }>;
  readonly targets: SceneSnapTargetSource;
  readonly view: Readonly<VectorTextViewState>;
  readonly gridStep?: number | null;
  readonly enterCssPx?: number;
  readonly releaseCssPx?: number;
  /** Pixel selections can only realize whole-pixel translations. */
  readonly quantizeStep?: number | null;
  readonly previous?: Readonly<SceneSnapLatch> | null;
  readonly disabled?: boolean;
}

export interface SceneTranslationSnapResult {
  readonly delta: Readonly<{ x: number; y: number }>;
  readonly matches: readonly SceneSnapMatch[];
  readonly latch: SceneSnapLatch;
}

export interface SceneScaleSnapLatch {
  readonly scale: number;
  readonly match: SceneSnapMatch;
}

export interface SceneScaleSnapInput {
  readonly transform: Readonly<SceneTransform>;
  readonly localBounds: Readonly<SceneLocalBounds>;
  readonly handle: SceneTransformHandle;
  readonly rawScale: number;
  readonly targets: SceneSnapTargetSource;
  readonly view: Readonly<VectorTextViewState>;
  readonly gridStep?: number | null;
  readonly minScale?: number;
  readonly maxScale?: number;
  readonly enterCssPx?: number;
  readonly releaseCssPx?: number;
  readonly previous?: Readonly<SceneScaleSnapLatch> | null;
  readonly disabled?: boolean;
}

export interface SceneScaleSnapResult {
  readonly scale: number;
  readonly matches: readonly SceneSnapMatch[];
  readonly latch: SceneScaleSnapLatch | null;
}

export interface SceneRotationSnapLatch {
  readonly rotation: number;
  readonly match: SceneSnapMatch;
}

export interface SceneRotationSnapInput {
  readonly transform: Readonly<SceneTransform>;
  readonly localBounds: Readonly<SceneLocalBounds>;
  readonly rawRotation: number;
  /** Layer-space radius and angle of the rotation handle under the pointer. */
  readonly handleRadius: number;
  readonly handleAngle: number;
  readonly targets: SceneSnapTargetSource;
  readonly view: Readonly<VectorTextViewState>;
  readonly gridStep?: number | null;
  readonly enterCssPx?: number;
  readonly releaseCssPx?: number;
  readonly previous?: Readonly<SceneRotationSnapLatch> | null;
  readonly disabled?: boolean;
}

export interface SceneRotationSnapResult {
  readonly rotation: number;
  readonly matches: readonly SceneSnapMatch[];
  readonly latch: SceneRotationSnapLatch | null;
}

const EMPTY_LATCH: SceneSnapLatch = { x: null, y: null };
const ANCHORS: readonly SceneSnapAnchor[] = ["start", "center", "end"];

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function coordinateTolerance(...values: readonly number[]): number {
  const magnitude = values.reduce(
    (maximum, value) => Math.max(maximum, Math.abs(value)),
    1,
  );
  return Math.max(1e-7, Number.EPSILON * 64 * magnitude);
}

function axisAnchors(
  bounds: Readonly<SceneAxisAlignedBounds>,
  axis: SceneSnapAxis,
): Readonly<Record<SceneSnapAnchor, number>> {
  const start = axis === "x" ? bounds.left : bounds.top;
  const end = axis === "x" ? bounds.right : bounds.bottom;
  return { start, center: (start + end) * 0.5, end };
}

function axisDeltaCssPixels(
  axis: SceneSnapAxis,
  delta: number,
  view: Readonly<VectorTextViewState>,
): number {
  return layerDeltaCssPixels(
    axis === "x" ? { x: delta, y: 0 } : { x: 0, y: delta },
    view,
  );
}

function layerDeltaCssPixels(
  delta: Readonly<{ x: number; y: number }>,
  view: Readonly<VectorTextViewState>,
): number {
  const backingX = view.canvasWidth / Math.max(1, view.cssWidth);
  const backingY = view.canvasHeight / Math.max(1, view.cssHeight);
  const canvasX = (
    view.rotationCos * delta.x - view.rotationSin * delta.y
  ) * view.zoom;
  const canvasY = (
    view.rotationSin * delta.x + view.rotationCos * delta.y
  ) * view.zoom;
  return Math.hypot(canvasX / backingX, canvasY / backingY);
}

function targetPriority(kind: SceneSnapTargetKind): number {
  return kind === "document" ? 0 : kind === "layer" ? 1 : 2;
}

/** Deduplicates and indexes targets once at pointerdown for bounded live lookup. */
export function sceneIndexedSnapTargets(
  targets: readonly SceneSnapTarget[],
): SceneSnapTargetIndex {
  const byAxis: Record<SceneSnapAxis, Map<number, SceneSnapTarget>> = {
    x: new Map(),
    y: new Map(),
  };
  for (const target of targets) {
    if (!finite(target.position)) continue;
    const previous = byAxis[target.axis].get(target.position);
    if (
      !previous
      || targetPriority(target.kind) < targetPriority(previous.kind)
    ) byAxis[target.axis].set(target.position, { ...target });
  }
  return {
    x: [...byAxis.x.values()].sort((first, second) =>
      first.position - second.position),
    y: [...byAxis.y.values()].sort((first, second) =>
      first.position - second.position),
  };
}

function indexedTargets(
  targets: SceneSnapTargetSource,
): targets is SceneSnapTargetIndex {
  return !Array.isArray(targets);
}

function lowerTargetBound(
  targets: readonly SceneSnapTarget[],
  position: number,
): number {
  let low = 0;
  let high = targets.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (targets[middle].position < position) low = middle + 1;
    else high = middle;
  }
  return low;
}

function sceneSnapTargetsWithin(
  targets: SceneSnapTargetSource,
  axis: SceneSnapAxis,
  minimum: number,
  maximum: number,
): readonly SceneSnapTarget[] {
  if (!indexedTargets(targets)) {
    return targets.filter((target) =>
      target.axis === axis
      && finite(target.position)
      && target.position >= minimum
      && target.position <= maximum);
  }
  const axisTargets = targets[axis];
  const first = lowerTargetBound(axisTargets, minimum);
  const last = lowerTargetBound(axisTargets, maximum + coordinateTolerance(maximum));
  return axisTargets.slice(first, last);
}

interface AxisCandidate {
  readonly correction: number;
  readonly distanceCss: number;
  readonly match: SceneSnapMatch;
}

function candidateForMatch(
  axis: SceneSnapAxis,
  anchors: Readonly<Record<SceneSnapAnchor, number>>,
  rawAxisDelta: number,
  match: Readonly<SceneSnapMatch>,
  view: Readonly<VectorTextViewState>,
  quantizeStep: number | null,
): AxisCandidate | null {
  const idealDelta = match.position - anchors[match.anchor];
  const realizedDelta = quantizeStep && quantizeStep > 0
    ? Math.round(idealDelta / quantizeStep) * quantizeStep
    : idealDelta;
  if (Math.abs(anchors[match.anchor] + realizedDelta - match.position) > 1e-5) {
    return null;
  }
  const correction = realizedDelta - rawAxisDelta;
  return {
    correction,
    distanceCss: axisDeltaCssPixels(axis, correction, view),
    match: { ...match },
  };
}

function resolveAxis(
  input: Readonly<SceneTranslationSnapInput>,
  axis: SceneSnapAxis,
): AxisCandidate | null {
  const anchors = axisAnchors(input.startBounds, axis);
  const rawInputDelta = axis === "x" ? input.rawDelta.x : input.rawDelta.y;
  const quantizeStep = input.quantizeStep && input.quantizeStep > 0
    ? input.quantizeStep
    : null;
  const rawAxisDelta = quantizeStep
    ? Math.round(rawInputDelta / quantizeStep) * quantizeStep
    : rawInputDelta;
  const releaseCssPx = Math.max(input.enterCssPx ?? 6, input.releaseCssPx ?? 10);
  const gridStep = input.gridStep ?? null;
  const gridEnabled = gridStep !== null && finite(gridStep) && gridStep > 0;
  const previous = input.previous?.[axis] ?? null;
  if (previous && (previous.kind !== "grid" || gridEnabled)) {
    const held = candidateForMatch(
      axis,
      anchors,
      rawAxisDelta,
      previous,
      input.view,
      quantizeStep,
    );
    if (held && held.distanceCss <= releaseCssPx) return held;
  }

  const enterCssPx = Math.max(0, input.enterCssPx ?? 6);
  const maximumAxisDistance = enterCssPx / minimumLayerCssScale(input.view);
  let best: AxisCandidate | null = null;
  const consider = (candidate: AxisCandidate): void => {
    if (candidate.distanceCss > enterCssPx) return;
    if (
      !best
      || candidate.distanceCss < best.distanceCss - 1e-6
      || (
        Math.abs(candidate.distanceCss - best.distanceCss) <= 1e-6
        && targetPriority(candidate.match.kind) < targetPriority(best.match.kind)
      )
    ) best = candidate;
  };

  for (const anchor of ANCHORS) {
    const movedPosition = anchors[anchor] + rawAxisDelta;
    for (const target of sceneSnapTargetsWithin(
      input.targets,
      axis,
      movedPosition - maximumAxisDistance,
      movedPosition + maximumAxisDistance,
    )) {
      const candidate = candidateForMatch(axis, anchors, rawAxisDelta, {
        axis,
        position: target.position,
        kind: target.kind,
        anchor,
        key: target.key,
      }, input.view, quantizeStep);
      if (candidate) consider(candidate);
    }
  }

  if (gridEnabled) {
    for (const anchor of ANCHORS) {
      const movedPosition = anchors[anchor] + rawAxisDelta;
      const position = Math.round(movedPosition / gridStep) * gridStep;
      const candidate = candidateForMatch(axis, anchors, rawAxisDelta, {
        axis,
        position,
        kind: "grid",
        anchor,
      }, input.view, quantizeStep);
      if (candidate) consider(candidate);
    }
  }

  return best;
}

export function resolveSceneTranslationSnap(
  input: Readonly<SceneTranslationSnapInput>,
): SceneTranslationSnapResult {
  if (
    input.disabled
    || !finite(input.rawDelta.x)
    || !finite(input.rawDelta.y)
  ) {
    return {
      delta: { ...input.rawDelta },
      matches: [],
      latch: EMPTY_LATCH,
    };
  }
  const x = resolveAxis(input, "x");
  const y = resolveAxis(input, "y");
  const quantizeStep = input.quantizeStep && input.quantizeStep > 0
    ? input.quantizeStep
    : null;
  const rawX = quantizeStep
    ? Math.round(input.rawDelta.x / quantizeStep) * quantizeStep
    : input.rawDelta.x;
  const rawY = quantizeStep
    ? Math.round(input.rawDelta.y / quantizeStep) * quantizeStep
    : input.rawDelta.y;
  const latch: SceneSnapLatch = {
    x: x?.match ?? null,
    y: y?.match ?? null,
  };
  return {
    delta: {
      x: rawX + (x?.correction ?? 0),
      y: rawY + (y?.correction ?? 0),
    },
    matches: [x?.match, y?.match].filter(
      (match): match is SceneSnapMatch => match !== undefined,
    ),
    latch,
  };
}

function localPointForHandle(
  bounds: Readonly<SceneLocalBounds>,
  handle: SceneTransformHandle,
): Readonly<{ x: number; y: number }> {
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

function uniformScaleRatios(
  transform: Readonly<SceneTransform>,
): Readonly<{ x: number; y: number }> | null {
  if (!finite(transform.scale) || Math.abs(transform.scale) <= Number.EPSILON) {
    return null;
  }
  return {
    x: (transform.scaleX ?? transform.scale) / transform.scale,
    y: (transform.scaleY ?? transform.scale) / transform.scale,
  };
}

function uniformScaleUnit(
  point: Readonly<{ x: number; y: number }>,
  transform: Readonly<SceneTransform>,
): Readonly<{ x: number; y: number }> | null {
  const ratios = uniformScaleRatios(transform);
  if (!ratios) return null;
  const scaledX = point.x * ratios.x;
  const scaledY = point.y * ratios.y;
  const cosine = Math.cos(transform.rotation);
  const sine = Math.sin(transform.rotation);
  return {
    x: cosine * scaledX - sine * scaledY,
    y: sine * scaledX + cosine * scaledY,
  };
}

function scaleSupportAnchor(
  input: Readonly<SceneScaleSnapInput>,
  localPoint: Readonly<{ x: number; y: number }>,
  axis: SceneSnapAxis,
): SceneSnapAnchor | null {
  const coordinate = (point: Readonly<{ x: number; y: number }>): number => {
    const unit = uniformScaleUnit(point, input.transform);
    return axis === "x" ? unit?.x ?? 0 : unit?.y ?? 0;
  };
  const coordinates = localCorners(input.localBounds).map(coordinate);
  const handleCoordinate = coordinate(localPoint);
  const minimum = Math.min(...coordinates);
  const maximum = Math.max(...coordinates);
  const tolerance = coordinateTolerance(handleCoordinate, minimum, maximum);
  if (Math.abs(handleCoordinate - minimum) <= tolerance) return "start";
  if (Math.abs(handleCoordinate - maximum) <= tolerance) return "end";
  return null;
}

interface ScaleCandidate {
  readonly scale: number;
  readonly distanceCss: number;
  readonly match: SceneSnapMatch;
}

function scaleCandidateForMatch(
  input: Readonly<SceneScaleSnapInput>,
  unit: Readonly<{ x: number; y: number }>,
  rawPoint: Readonly<{ x: number; y: number }>,
  match: Readonly<SceneSnapMatch>,
): ScaleCandidate | null {
  const component = match.axis === "x" ? unit.x : unit.y;
  if (Math.abs(component) <= 1e-9) return null;
  const pivot = match.axis === "x" ? input.transform.x : input.transform.y;
  const scale = (match.position - pivot) / component;
  const minimum = Math.max(Number.EPSILON, input.minScale ?? Number.EPSILON);
  const maximum = Math.max(minimum, input.maxScale ?? Number.POSITIVE_INFINITY);
  if (!finite(scale) || scale < minimum || scale > maximum) return null;
  const snappedPoint = {
    x: input.transform.x + unit.x * scale,
    y: input.transform.y + unit.y * scale,
  };
  return {
    scale,
    distanceCss: layerDeltaCssPixels({
      x: snappedPoint.x - rawPoint.x,
      y: snappedPoint.y - rawPoint.y,
    }, input.view),
    match: { ...match },
  };
}

function betterScaleCandidate(
  candidate: Readonly<ScaleCandidate>,
  best: Readonly<ScaleCandidate> | null,
): boolean {
  return !best
    || candidate.distanceCss < best.distanceCss - 1e-6
    || (
      Math.abs(candidate.distanceCss - best.distanceCss) <= 1e-6
      && targetPriority(candidate.match.kind) < targetPriority(best.match.kind)
    );
}

function selectScaleCandidate(
  best: Readonly<ScaleCandidate> | null,
  candidate: ScaleCandidate | null,
  maximumDistanceCss: number,
): ScaleCandidate | null {
  if (!candidate || candidate.distanceCss > maximumDistanceCss) return best;
  return betterScaleCandidate(candidate, best) ? candidate : best;
}

export function resolveSceneScaleSnap(
  input: Readonly<SceneScaleSnapInput>,
): SceneScaleSnapResult {
  if (input.disabled || !finite(input.rawScale)) {
    return { scale: input.rawScale, matches: [], latch: null };
  }
  const localPoint = localPointForHandle(input.localBounds, input.handle);
  const unit = uniformScaleUnit(localPoint, input.transform);
  if (!unit) return { scale: input.rawScale, matches: [], latch: null };
  const rawPoint = {
    x: input.transform.x + unit.x * input.rawScale,
    y: input.transform.y + unit.y * input.rawScale,
  };
  const supportAnchors = {
    x: scaleSupportAnchor(input, localPoint, "x"),
    y: scaleSupportAnchor(input, localPoint, "y"),
  };
  const enterCssPx = Math.max(0, input.enterCssPx ?? 6);
  const releaseCssPx = Math.max(enterCssPx, input.releaseCssPx ?? 10);
  const gridStep = input.gridStep ?? null;
  const gridEnabled = gridStep !== null && finite(gridStep) && gridStep > 0;
  const previous = input.previous ?? null;
  if (previous && (previous.match.kind !== "grid" || gridEnabled)) {
    const ratio = previous.scale / input.transform.scale;
    const heldPoint = sceneLocalToLayer(localPoint, {
      ...input.transform,
      scale: previous.scale,
      scaleX: (input.transform.scaleX ?? input.transform.scale) * ratio,
      scaleY: (input.transform.scaleY ?? input.transform.scale) * ratio,
    });
    const heldDistance = layerDeltaCssPixels({
      x: heldPoint.x - rawPoint.x,
      y: heldPoint.y - rawPoint.y,
    }, input.view);
    if (heldDistance <= releaseCssPx) {
      return {
        scale: previous.scale,
        matches: [{ ...previous.match }],
        latch: { scale: previous.scale, match: { ...previous.match } },
      };
    }
  }

  let best: ScaleCandidate | null = null;
  const maximumAxisDistance = enterCssPx / minimumLayerCssScale(input.view);
  for (const axis of ["x", "y"] as const) {
    const anchor = supportAnchors[axis];
    if (anchor === null) continue;
    const rawCoordinate = axis === "x" ? rawPoint.x : rawPoint.y;
    for (const target of sceneSnapTargetsWithin(
      input.targets,
      axis,
      rawCoordinate - maximumAxisDistance,
      rawCoordinate + maximumAxisDistance,
    )) {
      best = selectScaleCandidate(best, scaleCandidateForMatch(input, unit, rawPoint, {
        axis,
        position: target.position,
        kind: target.kind,
        anchor,
        key: target.key,
      }), enterCssPx);
    }
  }
  if (gridEnabled) {
    for (const axis of ["x", "y"] as const) {
      const anchor = supportAnchors[axis];
      if (anchor === null) continue;
      const coordinate = axis === "x" ? rawPoint.x : rawPoint.y;
      best = selectScaleCandidate(best, scaleCandidateForMatch(input, unit, rawPoint, {
        axis,
        position: Math.round(coordinate / gridStep) * gridStep,
        kind: "grid",
        anchor,
      }), enterCssPx);
    }
  }
  if (!best) return { scale: input.rawScale, matches: [], latch: null };
  return {
    scale: best.scale,
    matches: [{ ...best.match }],
    latch: { scale: best.scale, match: { ...best.match } },
  };
}

function localCorners(
  bounds: Readonly<SceneLocalBounds>,
): readonly Readonly<{ x: number; y: number }>[] {
  return [
    { x: bounds.left, y: bounds.top },
    { x: bounds.right, y: bounds.top },
    { x: bounds.right, y: bounds.bottom },
    { x: bounds.left, y: bounds.bottom },
  ];
}

function anchorForCorner(
  cornerIndex: number,
  axis: SceneSnapAxis,
): SceneSnapAnchor {
  if (axis === "x") return cornerIndex === 0 || cornerIndex === 3 ? "start" : "end";
  return cornerIndex === 0 || cornerIndex === 1 ? "start" : "end";
}

function equivalentAngleNear(angle: number, reference: number): number {
  const turn = Math.PI * 2;
  return angle + Math.round((reference - angle) / turn) * turn;
}

export function sceneWrappedAngleDelta(current: number, previous: number): number {
  const delta = current - previous;
  return Math.atan2(Math.sin(delta), Math.cos(delta));
}

export const SCENE_ROTATION_CONSTRAINT_STEP = Math.PI / 4;

/** Quantizes an absolute scene rotation without collapsing completed turns. */
export function sceneQuantizeAbsoluteRotation(
  rotation: number,
  step = SCENE_ROTATION_CONSTRAINT_STEP,
): number {
  if (!finite(rotation) || !finite(step) || step <= 0) {
    throw new RangeError("Rotation and step must be finite, with a positive step.");
  }
  const quantized = Math.round(rotation / step) * step;
  return Object.is(quantized, -0) ? 0 : quantized;
}

function contactAngles(
  input: Readonly<SceneRotationSnapInput>,
  localPoint: Readonly<{ x: number; y: number }>,
  axis: SceneSnapAxis,
  position: number,
): readonly number[] {
  const scaledX = localPoint.x * (input.transform.scaleX ?? input.transform.scale);
  const scaledY = localPoint.y * (input.transform.scaleY ?? input.transform.scale);
  const a = axis === "x" ? scaledX : scaledY;
  const b = axis === "x" ? -scaledY : scaledX;
  const radius = Math.hypot(a, b);
  if (radius <= 1e-9) return [];
  const pivot = axis === "x" ? input.transform.x : input.transform.y;
  const ratio = (position - pivot) / radius;
  if (ratio < -1 - 1e-9 || ratio > 1 + 1e-9) return [];
  const phase = Math.atan2(b, a);
  const offset = Math.acos(Math.max(-1, Math.min(1, ratio)));
  const first = equivalentAngleNear(phase + offset, input.rawRotation);
  const second = equivalentAngleNear(phase - offset, input.rawRotation);
  return Math.abs(first - second) <= 1e-9 ? [first] : [first, second];
}

function rotationHandleDistanceCss(
  input: Readonly<SceneRotationSnapInput>,
  rotation: number,
): number {
  const delta = rotation - input.rawRotation;
  const snappedAngle = input.handleAngle + delta;
  const rawPoint = {
    x: input.handleRadius * Math.cos(input.handleAngle),
    y: input.handleRadius * Math.sin(input.handleAngle),
  };
  const snappedPoint = {
    x: input.handleRadius * Math.cos(snappedAngle),
    y: input.handleRadius * Math.sin(snappedAngle),
  };
  return layerDeltaCssPixels({
    x: snappedPoint.x - rawPoint.x,
    y: snappedPoint.y - rawPoint.y,
  }, input.view);
}

interface RotationCandidate {
  readonly rotation: number;
  readonly distanceCss: number;
  readonly match: SceneSnapMatch;
}

function rotationContactCandidate(
  input: Readonly<SceneRotationSnapInput>,
  corners: readonly Readonly<{ x: number; y: number }>[],
  cornerIndex: number,
  match: Readonly<SceneSnapMatch>,
): RotationCandidate | null {
  const point = corners[cornerIndex];
  let best: RotationCandidate | null = null;
  for (const rotation of contactAngles(input, point, match.axis, match.position)) {
    const coordinates = corners.map((corner) => {
      const transformed = sceneLocalToLayer(corner, {
        ...input.transform,
        rotation,
      });
      return match.axis === "x" ? transformed.x : transformed.y;
    });
    const coordinate = coordinates[cornerIndex];
    const minimum = Math.min(...coordinates);
    const maximum = Math.max(...coordinates);
    const tolerance = coordinateTolerance(coordinate, minimum, maximum);
    const anchor = Math.abs(coordinate - minimum) <= tolerance
      ? "start"
      : Math.abs(coordinate - maximum) <= tolerance
        ? "end"
        : null;
    if (anchor === null) continue;
    const candidate: RotationCandidate = {
      rotation,
      distanceCss: rotationHandleDistanceCss(input, rotation),
      match: { ...match, anchor },
    };
    if (!best || candidate.distanceCss < best.distanceCss) best = candidate;
  }
  return best;
}

function rotationCandidatePriority(candidate: Readonly<RotationCandidate>): number {
  return targetPriority(candidate.match.kind);
}

function minimumLayerCssScale(view: Readonly<VectorTextViewState>): number {
  const backingX = view.canvasWidth / Math.max(1, view.cssWidth);
  const backingY = view.canvasHeight / Math.max(1, view.cssHeight);
  return Math.max(1e-9, view.zoom / Math.max(backingX, backingY));
}

function supportCornerIndices(
  points: readonly Readonly<{ x: number; y: number }>[],
  axis: SceneSnapAxis,
): readonly number[] {
  const coordinates = points.map((point) => axis === "x" ? point.x : point.y);
  const minimum = Math.min(...coordinates);
  const maximum = Math.max(...coordinates);
  const tolerance = coordinateTolerance(minimum, maximum);
  return coordinates.flatMap((coordinate, index) =>
    Math.abs(coordinate - minimum) <= tolerance
      || Math.abs(coordinate - maximum) <= tolerance
      ? [index]
      : []);
}

function betterRotationCandidate(
  candidate: Readonly<RotationCandidate>,
  best: Readonly<RotationCandidate> | null,
): boolean {
  return !best
    || candidate.distanceCss < best.distanceCss - 1e-6
    || (
      Math.abs(candidate.distanceCss - best.distanceCss) <= 1e-6
      && rotationCandidatePriority(candidate) < rotationCandidatePriority(best)
    );
}

function selectRotationCandidate(
  best: Readonly<RotationCandidate> | null,
  candidate: RotationCandidate | null,
  maximumDistanceCss: number,
): RotationCandidate | null {
  if (!candidate || candidate.distanceCss > maximumDistanceCss) return best;
  return betterRotationCandidate(candidate, best) ? candidate : best;
}

export function resolveSceneRotationSnap(
  input: Readonly<SceneRotationSnapInput>,
): SceneRotationSnapResult {
  if (
    input.disabled
    || !finite(input.rawRotation)
    || !finite(input.handleRadius)
    || input.handleRadius <= 0
    || !finite(input.handleAngle)
  ) {
    return { rotation: input.rawRotation, matches: [], latch: null };
  }
  const corners = localCorners(input.localBounds);
  const rawCorners = corners.map((corner) => sceneLocalToLayer(corner, {
    ...input.transform,
    rotation: input.rawRotation,
  }));
  const supportIndices = {
    x: supportCornerIndices(rawCorners, "x"),
    y: supportCornerIndices(rawCorners, "y"),
  };
  const enterCssPx = Math.max(0, input.enterCssPx ?? 6);
  const releaseCssPx = Math.max(enterCssPx, input.releaseCssPx ?? 10);
  const gridStep = input.gridStep ?? null;
  const gridEnabled = gridStep !== null && finite(gridStep) && gridStep > 0;
  const previous = input.previous ?? null;
  if (previous && (previous.match.kind !== "grid" || gridEnabled)) {
    const heldDistance = rotationHandleDistanceCss(input, previous.rotation);
    if (heldDistance <= releaseCssPx) {
      return {
        rotation: previous.rotation,
        matches: [{ ...previous.match }],
        latch: {
          rotation: previous.rotation,
          match: { ...previous.match },
        },
      };
    }
  }

  let best: RotationCandidate | null = null;
  const handleLayerDistance = enterCssPx / minimumLayerCssScale(input.view);
  for (const axis of ["x", "y"] as const) {
    for (const cornerIndex of supportIndices[axis]) {
      const rawCoordinate = axis === "x"
        ? rawCorners[cornerIndex].x
        : rawCorners[cornerIndex].y;
      const supportRadius = Math.hypot(
        corners[cornerIndex].x * (input.transform.scaleX ?? input.transform.scale),
        corners[cornerIndex].y * (input.transform.scaleY ?? input.transform.scale),
      );
      const maximumAxisDistance = handleLayerDistance
        * supportRadius / input.handleRadius;
      for (const target of sceneSnapTargetsWithin(
        input.targets,
        axis,
        rawCoordinate - maximumAxisDistance,
        rawCoordinate + maximumAxisDistance,
      )) {
        best = selectRotationCandidate(best, rotationContactCandidate(input, corners, cornerIndex, {
          axis,
          position: target.position,
          kind: target.kind,
          anchor: anchorForCorner(cornerIndex, axis),
          key: target.key,
        }), enterCssPx);
      }
    }
  }
  if (gridEnabled) {
    for (const axis of ["x", "y"] as const) {
      for (const cornerIndex of supportIndices[axis]) {
        const rawPoint = rawCorners[cornerIndex];
        const coordinate = axis === "x" ? rawPoint.x : rawPoint.y;
        best = selectRotationCandidate(best, rotationContactCandidate(input, corners, cornerIndex, {
          axis,
          position: Math.round(coordinate / gridStep) * gridStep,
          kind: "grid",
          anchor: anchorForCorner(cornerIndex, axis),
        }), enterCssPx);
      }
    }
  }
  if (!best) return { rotation: input.rawRotation, matches: [], latch: null };
  return {
    rotation: best.rotation,
    matches: [{ ...best.match }],
    latch: {
      rotation: best.rotation,
      match: { ...best.match },
    },
  };
}

export function sceneTransformedAxisAlignedBounds(
  bounds: Readonly<SceneLocalBounds>,
  transform: Readonly<SceneTransform>,
): SceneAxisAlignedBounds {
  const points = [
    { x: bounds.left, y: bounds.top },
    { x: bounds.right, y: bounds.top },
    { x: bounds.right, y: bounds.bottom },
    { x: bounds.left, y: bounds.bottom },
  ].map((point) => sceneLocalToLayer(point, transform));
  return scenePointCloudBounds(points);
}

export function scenePointCloudBounds(
  points: readonly Readonly<{ x: number; y: number }>[],
): SceneAxisAlignedBounds {
  if (points.length === 0) {
    return { left: 0, top: 0, right: 0, bottom: 0 };
  }
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    left = Math.min(left, point.x);
    top = Math.min(top, point.y);
    right = Math.max(right, point.x);
    bottom = Math.max(bottom, point.y);
  }
  return { left, top, right, bottom };
}

export function sceneBoundsSnapTargets(
  bounds: Readonly<SceneAxisAlignedBounds>,
  key?: string,
): readonly SceneSnapTarget[] {
  return [
    { axis: "x", position: bounds.left, kind: "layer", key },
    { axis: "x", position: (bounds.left + bounds.right) * 0.5, kind: "layer", key },
    { axis: "x", position: bounds.right, kind: "layer", key },
    { axis: "y", position: bounds.top, kind: "layer", key },
    { axis: "y", position: (bounds.top + bounds.bottom) * 0.5, kind: "layer", key },
    { axis: "y", position: bounds.bottom, kind: "layer", key },
  ];
}

export function sceneDocumentSnapTargets(
  width: number,
  height: number,
): readonly SceneSnapTarget[] {
  return [
    { axis: "x", position: 0, kind: "document" },
    { axis: "x", position: width * 0.5, kind: "document" },
    { axis: "x", position: width, kind: "document" },
    { axis: "y", position: 0, kind: "document" },
    { axis: "y", position: height * 0.5, kind: "document" },
    { axis: "y", position: height, kind: "document" },
  ];
}
