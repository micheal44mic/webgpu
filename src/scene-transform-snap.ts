import {
  sceneLocalToLayer,
  type SceneLocalBounds,
  type SceneTransform,
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
  readonly targets: readonly SceneSnapTarget[];
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

const EMPTY_LATCH: SceneSnapLatch = { x: null, y: null };
const ANCHORS: readonly SceneSnapAnchor[] = ["start", "center", "end"];

function finite(value: number): boolean {
  return Number.isFinite(value);
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
  const backingX = view.canvasWidth / Math.max(1, view.cssWidth);
  const backingY = view.canvasHeight / Math.max(1, view.cssHeight);
  const layerX = axis === "x" ? delta : 0;
  const layerY = axis === "y" ? delta : 0;
  const canvasX = (view.rotationCos * layerX - view.rotationSin * layerY) * view.zoom;
  const canvasY = (view.rotationSin * layerX + view.rotationCos * layerY) * view.zoom;
  return Math.hypot(canvasX / backingX, canvasY / backingY);
}

function targetPriority(kind: SceneSnapTargetKind): number {
  return kind === "document" ? 0 : kind === "layer" ? 1 : 2;
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
  const previous = input.previous?.[axis] ?? null;
  if (previous) {
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

  for (const target of input.targets) {
    if (target.axis !== axis || !finite(target.position)) continue;
    for (const anchor of ANCHORS) {
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

  const gridStep = input.gridStep ?? null;
  if (gridStep !== null && finite(gridStep) && gridStep > 0) {
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
