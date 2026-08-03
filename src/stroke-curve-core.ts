/**
 * Causal, allocation-free curve planning for Paint input samples.
 *
 * Every segment is available as soon as its endpoint arrives: there is no
 * look-ahead sample and therefore no extra input interval of latency. The
 * planner predicts the endpoint tangent from the last observed turn, carries
 * it into the next segment while curvature stays coherent, and corrects it
 * immediately when the input changes direction. Every raw point remains an
 * exact endpoint; deliberate sharp corners bypass rounding.
 */

export const STROKE_CURVE_STRATEGY =
  "causal-endpoint-exact-predictive-hermite-corrective-tangents-quarter-pixel-target-v1" as const;

export const STROKE_CURVE_MAXIMUM_SMOOTH_TURN_RADIANS = Math.PI / 3;
export const STROKE_CURVE_MAXIMUM_TANGENT_CORRECTION_RADIANS = Math.PI / 12;
export const STROKE_CURVE_FLATTENING_TOLERANCE_PX = 0.25;
export const STROKE_CURVE_MAXIMUM_SUBDIVISIONS = 512;

const MINIMUM_SEGMENT_LENGTH = 0.0001;
const DIRECTION_EPSILON = 1e-7;
const ANGLE_COMPARISON_EPSILON = 1e-7;

export interface CausalStrokeCurveSegment {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  control1X: number;
  control1Y: number;
  control2X: number;
  control2Y: number;
  coefficientAX: number;
  coefficientAY: number;
  coefficientBX: number;
  coefficientBY: number;
  coefficientCX: number;
  coefficientCY: number;
  startTangentX: number;
  startTangentY: number;
  endTangentX: number;
  endTangentY: number;
  rawTurnRadians: number;
  flatteningErrorBoundPx: number;
  subdivisionCount: number;
  smoothed: boolean;
  sharpCornerBypass: boolean;
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

function cubicCoefficientA(
  start: number,
  control1: number,
  control2: number,
  end: number,
): number {
  return -start + 3 * control1 - 3 * control2 + end;
}

function cubicCoefficientB(
  start: number,
  control1: number,
  control2: number,
): number {
  return 3 * start - 6 * control1 + 3 * control2;
}

function cubicCoefficientC(start: number, control1: number): number {
  return 3 * (control1 - start);
}

export function evaluateStrokeCurveCoordinate(
  start: number,
  coefficientA: number,
  coefficientB: number,
  coefficientC: number,
  parameter: number,
): number {
  const t = clamp(parameter, 0, 1);
  return ((coefficientA * t + coefficientB) * t + coefficientC) * t + start;
}

export function evaluateStrokeCurveX(
  segment: Readonly<CausalStrokeCurveSegment>,
  parameter: number,
): number {
  return evaluateStrokeCurveCoordinate(
    segment.startX,
    segment.coefficientAX,
    segment.coefficientBX,
    segment.coefficientCX,
    parameter,
  );
}

export function evaluateStrokeCurveY(
  segment: Readonly<CausalStrokeCurveSegment>,
  parameter: number,
): number {
  return evaluateStrokeCurveCoordinate(
    segment.startY,
    segment.coefficientAY,
    segment.coefficientBY,
    segment.coefficientCY,
    parameter,
  );
}

export class CausalStrokeCurvePlanner {
  private hasPreviousDirection = false;
  private hasPredictedEndTangent = false;
  private previousDirectionX = 1;
  private previousDirectionY = 0;
  private previousEndTangentX = 1;
  private previousEndTangentY = 0;

  readonly segment: CausalStrokeCurveSegment = {
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
    control1X: 0,
    control1Y: 0,
    control2X: 0,
    control2Y: 0,
    coefficientAX: 0,
    coefficientAY: 0,
    coefficientBX: 0,
    coefficientBY: 0,
    coefficientCX: 0,
    coefficientCY: 0,
    startTangentX: 1,
    startTangentY: 0,
    endTangentX: 1,
    endTangentY: 0,
    rawTurnRadians: 0,
    flatteningErrorBoundPx: 0,
    subdivisionCount: 1,
    smoothed: false,
    sharpCornerBypass: false,
  };

  reset(): void {
    this.hasPreviousDirection = false;
    this.hasPredictedEndTangent = false;
    this.previousDirectionX = 1;
    this.previousDirectionY = 0;
    this.previousEndTangentX = 1;
    this.previousEndTangentY = 0;
  }

  /**
   * Copies only the preallocated planner state. A revisionable preview can
   * therefore continue from the authoritative mature prefix without mutating
   * the planner that will later commit that prefix.
   */
  copyStateFrom(source: CausalStrokeCurvePlanner): void {
    this.hasPreviousDirection = source.hasPreviousDirection;
    this.hasPredictedEndTangent = source.hasPredictedEndTangent;
    this.previousDirectionX = source.previousDirectionX;
    this.previousDirectionY = source.previousDirectionY;
    this.previousEndTangentX = source.previousEndTangentX;
    this.previousEndTangentY = source.previousEndTangentY;
  }

  plan(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
  ): Readonly<CausalStrokeCurveSegment> {
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const length = Math.hypot(deltaX, deltaY);
    const directionX = length > MINIMUM_SEGMENT_LENGTH ? deltaX / length : 1;
    const directionY = length > MINIMUM_SEGMENT_LENGTH ? deltaY / length : 0;
    const hadPreviousDirection = this.hasPreviousDirection;
    let startTangentX = directionX;
    let startTangentY = directionY;
    let endTangentX = directionX;
    let endTangentY = directionY;
    let rawTurnRadians = 0;
    let sharpCornerBypass = false;
    let smoothed = false;

    if (length > MINIMUM_SEGMENT_LENGTH && hadPreviousDirection) {
      const directionDot = clamp(
        this.previousDirectionX * directionX
          + this.previousDirectionY * directionY,
        -1,
        1,
      );
      const directionCross = this.previousDirectionX * directionY
        - this.previousDirectionY * directionX;
      rawTurnRadians = Math.atan2(directionCross, directionDot);
      sharpCornerBypass =
        Math.abs(rawTurnRadians)
          > STROKE_CURVE_MAXIMUM_SMOOTH_TURN_RADIANS
            + ANGLE_COMPARISON_EPSILON;

      if (sharpCornerBypass) {
        startTangentX = directionX;
        startTangentY = directionY;
      } else {
        const predictedTurn = rawTurnRadians * 0.5;
        const cosine = Math.cos(predictedTurn);
        const sine = Math.sin(predictedTurn);
        const expectedStartTangentX =
          this.previousDirectionX * cosine
            - this.previousDirectionY * sine;
        const expectedStartTangentY =
          this.previousDirectionX * sine
            + this.previousDirectionY * cosine;
        const predictedStartDot = clamp(
          this.previousEndTangentX * expectedStartTangentX
            + this.previousEndTangentY * expectedStartTangentY,
          -1,
          1,
        );
        const predictedStartCross =
          this.previousEndTangentX * expectedStartTangentY
            - this.previousEndTangentY * expectedStartTangentX;
        const tangentCorrection = Math.abs(Math.atan2(
          predictedStartCross,
          predictedStartDot,
        ));
        if (
          !this.hasPredictedEndTangent
          || tangentCorrection
            > STROKE_CURVE_MAXIMUM_TANGENT_CORRECTION_RADIANS
              + ANGLE_COMPARISON_EPSILON
        ) {
          startTangentX = expectedStartTangentX;
          startTangentY = expectedStartTangentY;
        } else {
          startTangentX = this.previousEndTangentX;
          startTangentY = this.previousEndTangentY;
        }
        endTangentX = directionX * cosine - directionY * sine;
        endTangentY = directionX * sine + directionY * cosine;
        const startTurn = Math.atan2(
          startTangentX * directionY - startTangentY * directionX,
          clamp(
            startTangentX * directionX + startTangentY * directionY,
            -1,
            1,
          ),
        );
        smoothed = Math.abs(rawTurnRadians) > DIRECTION_EPSILON
          || Math.abs(startTurn) > DIRECTION_EPSILON;
      }
    }

    if (length <= MINIMUM_SEGMENT_LENGTH) {
      startTangentX = this.previousEndTangentX;
      startTangentY = this.previousEndTangentY;
      endTangentX = startTangentX;
      endTangentY = startTangentY;
    }

    const quarterTurn = clamp(
      Math.abs(rawTurnRadians) * 0.25,
      0,
      STROKE_CURVE_MAXIMUM_SMOOTH_TURN_RADIANS * 0.25,
    );
    const tangentLength = sharpCornerBypass
      ? length
      : length / Math.max(0.75, Math.cos(quarterTurn) ** 2);
    const controlScale = tangentLength / 3;
    const control1X = startX + startTangentX * controlScale;
    const control1Y = startY + startTangentY * controlScale;
    const control2X = endX - endTangentX * controlScale;
    const control2Y = endY - endTangentY * controlScale;
    const coefficientAX = cubicCoefficientA(startX, control1X, control2X, endX);
    const coefficientAY = cubicCoefficientA(startY, control1Y, control2Y, endY);
    const coefficientBX = cubicCoefficientB(startX, control1X, control2X);
    const coefficientBY = cubicCoefficientB(startY, control1Y, control2Y);
    const maximumSecondDerivative = Math.max(
      Math.hypot(2 * coefficientBX, 2 * coefficientBY),
      Math.hypot(
        6 * coefficientAX + 2 * coefficientBX,
        6 * coefficientAY + 2 * coefficientBY,
      ),
    );
    const subdivisionCount = smoothed
      ? clamp(
        Math.ceil(Math.sqrt(
          maximumSecondDerivative
            / (8 * STROKE_CURVE_FLATTENING_TOLERANCE_PX),
        )),
        1,
        STROKE_CURVE_MAXIMUM_SUBDIVISIONS,
      )
      : 1;
    const flatteningErrorBoundPx = maximumSecondDerivative
      / (8 * subdivisionCount * subdivisionCount);

    const segment = this.segment;
    segment.startX = startX;
    segment.startY = startY;
    segment.endX = endX;
    segment.endY = endY;
    segment.control1X = control1X;
    segment.control1Y = control1Y;
    segment.control2X = control2X;
    segment.control2Y = control2Y;
    segment.coefficientAX = coefficientAX;
    segment.coefficientAY = coefficientAY;
    segment.coefficientBX = coefficientBX;
    segment.coefficientBY = coefficientBY;
    segment.coefficientCX = cubicCoefficientC(startX, control1X);
    segment.coefficientCY = cubicCoefficientC(startY, control1Y);
    segment.startTangentX = startTangentX;
    segment.startTangentY = startTangentY;
    segment.endTangentX = endTangentX;
    segment.endTangentY = endTangentY;
    segment.rawTurnRadians = rawTurnRadians;
    segment.flatteningErrorBoundPx = flatteningErrorBoundPx;
    segment.subdivisionCount = subdivisionCount;
    segment.smoothed = smoothed;
    segment.sharpCornerBypass = sharpCornerBypass;

    if (length > MINIMUM_SEGMENT_LENGTH) {
      this.hasPreviousDirection = true;
      this.hasPredictedEndTangent = hadPreviousDirection && !sharpCornerBypass;
      this.previousDirectionX = directionX;
      this.previousDirectionY = directionY;
      this.previousEndTangentX = endTangentX;
      this.previousEndTangentY = endTangentY;
    }
    return segment;
  }
}
