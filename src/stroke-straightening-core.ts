import type { PointerSample } from "./engine-types";

/** Delay after the endpoint settles before a nearly straight stroke is locked. */
export const STRAIGHT_LINE_HOLD_MS = 500;

/** Screen-space thresholds keep the gesture consistent at every document zoom. */
export const STRAIGHT_LINE_MIN_LENGTH_PX = 24;
export const STRAIGHT_LINE_ENDPOINT_SETTLE_PX = 2.5;
export const STRAIGHT_LINE_MIN_LINEARITY = 0.96;
export const STRAIGHT_LINE_DEVIATION_RATIO = 0.035;
export const STRAIGHT_LINE_MIN_DEVIATION_PX = 2.5;
export const STRAIGHT_LINE_MAX_DEVIATION_PX = 8;
export const STRAIGHT_LINE_MAX_TRACKED_SAMPLES = 1_024;

export interface StrokeStraightnessAnalysis {
  readonly eligible: boolean;
  readonly chordLengthPx: number;
  readonly pathLengthPx: number;
  readonly linearity: number;
  readonly maximumDeviationPx: number;
  readonly allowedDeviationPx: number;
}

function finiteSample(sample: PointerSample): boolean {
  return Number.isFinite(sample.clientX)
    && Number.isFinite(sample.clientY)
    && Number.isFinite(sample.pressure)
    && Number.isFinite(sample.timeMs);
}

/**
 * Scores the complete gesture, not just its endpoints. The path/chord ratio
 * rejects reversals along the same axis, while perpendicular deviation rejects
 * bows that happen to finish on a plausible endpoint.
 */
export function analyzeStrokeStraightness(
  samples: readonly PointerSample[],
): StrokeStraightnessAnalysis {
  if (samples.length < 2 || !samples.every(finiteSample)) {
    return {
      eligible: false,
      chordLengthPx: 0,
      pathLengthPx: 0,
      linearity: 0,
      maximumDeviationPx: Number.POSITIVE_INFINITY,
      allowedDeviationPx: STRAIGHT_LINE_MIN_DEVIATION_PX,
    };
  }

  const first = samples[0];
  const last = samples[samples.length - 1];
  const chordX = last.clientX - first.clientX;
  const chordY = last.clientY - first.clientY;
  const chordLengthPx = Math.hypot(chordX, chordY);
  let pathLengthPx = 0;
  for (let index = 1; index < samples.length; index += 1) {
    pathLengthPx += Math.hypot(
      samples[index].clientX - samples[index - 1].clientX,
      samples[index].clientY - samples[index - 1].clientY,
    );
  }

  const allowedDeviationPx = Math.min(
    STRAIGHT_LINE_MAX_DEVIATION_PX,
    Math.max(
      STRAIGHT_LINE_MIN_DEVIATION_PX,
      chordLengthPx * STRAIGHT_LINE_DEVIATION_RATIO,
    ),
  );
  const linearity = pathLengthPx > 0 ? chordLengthPx / pathLengthPx : 0;
  let maximumDeviationPx = 0;
  if (chordLengthPx > 0) {
    for (let index = 1; index < samples.length - 1; index += 1) {
      const relativeX = samples[index].clientX - first.clientX;
      const relativeY = samples[index].clientY - first.clientY;
      const deviation = Math.abs(relativeX * chordY - relativeY * chordX)
        / chordLengthPx;
      maximumDeviationPx = Math.max(maximumDeviationPx, deviation);
    }
  }

  return {
    eligible: chordLengthPx >= STRAIGHT_LINE_MIN_LENGTH_PX
      && linearity >= STRAIGHT_LINE_MIN_LINEARITY
      && maximumDeviationPx <= allowedDeviationPx,
    chordLengthPx,
    pathLengthPx,
    linearity,
    maximumDeviationPx,
    allowedDeviationPx,
  };
}

/**
 * Projects every input sample onto the start/end chord using cumulative travel
 * as progress. Pressure and timestamps remain authored by the gesture, while
 * every generated center is mathematically collinear.
 */
export function straightenPointerSamples(
  samples: readonly PointerSample[],
): PointerSample[] {
  if (samples.length < 2) return [...samples];
  const first = samples[0];
  const last = samples[samples.length - 1];
  let pathLength = 0;
  const cumulative = new Float64Array(samples.length);
  for (let index = 1; index < samples.length; index += 1) {
    pathLength += Math.hypot(
      samples[index].clientX - samples[index - 1].clientX,
      samples[index].clientY - samples[index - 1].clientY,
    );
    cumulative[index] = pathLength;
  }
  const deltaX = last.clientX - first.clientX;
  const deltaY = last.clientY - first.clientY;
  return samples.map((sample, index) => {
    const progress = index === samples.length - 1
      ? 1
      : pathLength > 0
        ? cumulative[index] / pathLength
        : 0;
    return {
      clientX: first.clientX + deltaX * progress,
      clientY: first.clientY + deltaY * progress,
      pressure: sample.pressure,
      timeMs: sample.timeMs,
    };
  });
}

/** Bounded spatial history for long held gestures; first and last always survive. */
export function compactStraightLineSamples(samples: PointerSample[]): void {
  while (samples.length > STRAIGHT_LINE_MAX_TRACKED_SAMPLES) {
    const compacted: PointerSample[] = [samples[0]];
    for (let index = 2; index < samples.length - 1; index += 2) {
      compacted.push(samples[index]);
    }
    compacted.push(samples[samples.length - 1]);
    samples.splice(0, samples.length, ...compacted);
  }
}
