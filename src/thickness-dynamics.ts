export const THICKNESS_DYNAMICS_STRATEGY =
  "time-window-quadratic-ease-out-start-end-tail-holdback" as const;
export const THICKNESS_TAPER_WINDOW_MS = 100;

export type ThicknessDynamicsStrategy = typeof THICKNESS_DYNAMICS_STRATEGY;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function quadraticEaseOut(progress: number): number {
  const remaining = 1 - clamp(progress, 0, 1);
  return 1 - remaining * remaining;
}

export function startThicknessFactor(
  startThicknessRatio: number,
  elapsedMs: number,
): number {
  const start = clamp(startThicknessRatio, 0, 2);
  const progress = quadraticEaseOut(elapsedMs / THICKNESS_TAPER_WINDOW_MS);
  return start + (1 - start) * progress;
}

export function endThicknessFactor(
  liveThicknessFactor: number,
  endThicknessRatio: number,
  millisecondsBeforeLift: number,
): number {
  const live = clamp(liveThicknessFactor, 0, 2);
  const end = clamp(endThicknessRatio, 0, 2);
  const progressFromEnd = quadraticEaseOut(millisecondsBeforeLift / THICKNESS_TAPER_WINDOW_MS);
  return end + (live - end) * progressFromEnd;
}

export function endThicknessRadius(
  baseRadius: number,
  liveThicknessFactor: number,
  endThicknessRatio: number,
  millisecondsBeforeLift: number,
): number {
  return Math.max(0, baseRadius) * endThicknessFactor(
    liveThicknessFactor,
    endThicknessRatio,
    millisecondsBeforeLift,
  );
}

export function thicknessDynamicsNeedsTailHoldback(
  endThicknessRatio: number,
): boolean {
  return Math.abs(clamp(endThicknessRatio, 0, 2) - 1) > Number.EPSILON * 8;
}

export function thicknessDynamicsIsNeutral(
  startThicknessRatio: number,
  endThicknessRatio: number,
): boolean {
  return Math.abs(clamp(startThicknessRatio, 0, 2) - 1) <= Number.EPSILON * 8
    && !thicknessDynamicsNeedsTailHoldback(endThicknessRatio);
}
