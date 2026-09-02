/**
 * Pure Paint stamp generation primitives shared by the live engine and by
 * deterministic renderers such as Brush Studio previews.
 *
 * This module deliberately knows nothing about layers, history or the render
 * pump. Callers decide where emitted samples are committed.
 */
import type { LayerPoint } from "./engine-types.ts";
import {
  evaluateStrokeCurveX,
  evaluateStrokeCurveY,
  type CausalStrokeCurveSegment,
} from "./stroke-curve-core.ts";

export type PaintStampSampleEmitter<Context> = (
  context: Context,
  point: LayerPoint,
  directionX: number,
  directionY: number,
) => void;

export type PaintStampSpacingResolver = (point: Readonly<LayerPoint>) => number;

const clampUnit = (value: number): number => Math.max(0, Math.min(1, value));

/** The authoritative deterministic seed assigned to one base stamp. */
export function nextPaintStampSeed(sequence: number): number {
  return (Math.imul(sequence, 0x9e3779b1) ^ 0xa511e9b3) >>> 0;
}

/**
 * Walks one already-planned causal curve at a fixed spatial interval.
 *
 * The returned distance is the carry for the following input segment. When
 * the per-input cap is reached, the complete remaining curve is still
 * measured and the carry is reduced modulo spacing, matching the live Paint
 * path without emitting an unbounded batch.
 */
export function resamplePaintCurveSegment<Context>(
  curveSegment: Readonly<CausalStrokeCurveSegment>,
  start: Readonly<LayerPoint>,
  end: Readonly<LayerPoint>,
  spacing: number,
  distanceSinceStamp: number,
  maximumStamps: number,
  emitContext: Context,
  emit: PaintStampSampleEmitter<Context>,
): number {
  const deltaTimeMs = end.timeMs - start.timeMs;
  let generatedOnInputSegment = 0;
  let stampLimitReached = false;
  let curveStartX = start.x;
  let curveStartY = start.y;
  let parameterStart = 0;

  for (
    let subdivision = 1;
    subdivision <= curveSegment.subdivisionCount;
    subdivision += 1
  ) {
    const parameterEnd = subdivision / curveSegment.subdivisionCount;
    const curveEndX = subdivision === curveSegment.subdivisionCount
      ? end.x
      : evaluateStrokeCurveX(curveSegment, parameterEnd);
    const curveEndY = subdivision === curveSegment.subdivisionCount
      ? end.y
      : evaluateStrokeCurveY(curveSegment, parameterEnd);
    const curveDeltaX = curveEndX - curveStartX;
    const curveDeltaY = curveEndY - curveStartY;
    const curveSegmentLength = Math.hypot(curveDeltaX, curveDeltaY);
    let distanceAlongCurveSegment = 0;

    if (curveSegmentLength > 0.0001) {
      const directionX = curveDeltaX / curveSegmentLength;
      const directionY = curveDeltaY / curveSegmentLength;
      while (
        !stampLimitReached
        && distanceSinceStamp
          + (curveSegmentLength - distanceAlongCurveSegment)
          >= spacing
      ) {
        const distanceToNextStamp = spacing - distanceSinceStamp;
        distanceAlongCurveSegment += distanceToNextStamp;
        const localInterpolation = clampUnit(
          distanceAlongCurveSegment / curveSegmentLength,
        );
        const curveParameter = parameterStart
          + (parameterEnd - parameterStart) * localInterpolation;
        emit(emitContext, {
          x: curveStartX + curveDeltaX * localInterpolation,
          y: curveStartY + curveDeltaY * localInterpolation,
          pressure: start.pressure
            + (end.pressure - start.pressure) * curveParameter,
          timeMs: start.timeMs + deltaTimeMs * curveParameter,
        }, directionX, directionY);
        distanceSinceStamp = 0;
        generatedOnInputSegment += 1;

        if (generatedOnInputSegment >= maximumStamps) {
          stampLimitReached = true;
          break;
        }
      }
      distanceSinceStamp += Math.max(
        0,
        curveSegmentLength - distanceAlongCurveSegment,
      );
    }

    curveStartX = curveEndX;
    curveStartY = curveEndY;
    parameterStart = parameterEnd;
  }

  return stampLimitReached ? distanceSinceStamp % spacing : distanceSinceStamp;
}

/**
 * Walks a curve with spacing chosen from the pressure at the last emitted dab.
 *
 * The state is the remaining distance to the next dab, rather than distance
 * since the previous one. That makes the result independent from pointer-event
 * segmentation when pressure changes between samples.
 */
export function resamplePaintCurveSegmentWithVariableSpacing<Context>(
  curveSegment: Readonly<CausalStrokeCurveSegment>,
  start: Readonly<LayerPoint>,
  end: Readonly<LayerPoint>,
  distanceToNextStamp: number,
  maximumStamps: number,
  emitContext: Context,
  emit: PaintStampSampleEmitter<Context>,
  spacingForPoint: PaintStampSpacingResolver,
): number {
  const deltaTimeMs = end.timeMs - start.timeMs;
  let remaining = Math.max(0.1, distanceToNextStamp);
  let generatedOnInputSegment = 0;
  let curveStartX = start.x;
  let curveStartY = start.y;
  let parameterStart = 0;

  for (
    let subdivision = 1;
    subdivision <= curveSegment.subdivisionCount;
    subdivision += 1
  ) {
    const parameterEnd = subdivision / curveSegment.subdivisionCount;
    const curveEndX = subdivision === curveSegment.subdivisionCount
      ? end.x
      : evaluateStrokeCurveX(curveSegment, parameterEnd);
    const curveEndY = subdivision === curveSegment.subdivisionCount
      ? end.y
      : evaluateStrokeCurveY(curveSegment, parameterEnd);
    const curveDeltaX = curveEndX - curveStartX;
    const curveDeltaY = curveEndY - curveStartY;
    const curveLength = Math.hypot(curveDeltaX, curveDeltaY);
    let distanceAlongCurve = 0;

    if (curveLength > 0.0001) {
      const directionX = curveDeltaX / curveLength;
      const directionY = curveDeltaY / curveLength;
      while (curveLength - distanceAlongCurve >= remaining) {
        distanceAlongCurve += remaining;
        const localInterpolation = clampUnit(distanceAlongCurve / curveLength);
        const curveParameter = parameterStart
          + (parameterEnd - parameterStart) * localInterpolation;
        const point: LayerPoint = {
          x: curveStartX + curveDeltaX * localInterpolation,
          y: curveStartY + curveDeltaY * localInterpolation,
          pressure: start.pressure
            + (end.pressure - start.pressure) * curveParameter,
          timeMs: start.timeMs + deltaTimeMs * curveParameter,
        };
        if (generatedOnInputSegment < maximumStamps) {
          emit(emitContext, point, directionX, directionY);
          generatedOnInputSegment += 1;
        }
        remaining = Math.max(0.1, spacingForPoint(point));
      }
      remaining -= Math.max(0, curveLength - distanceAlongCurve);
    }

    curveStartX = curveEndX;
    curveStartY = curveEndY;
    parameterStart = parameterEnd;
  }

  return Math.max(Number.EPSILON, remaining);
}
