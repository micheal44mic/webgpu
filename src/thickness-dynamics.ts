export const THICKNESS_DYNAMICS_STRATEGY =
  "time-window-quadratic-ease-out-tail-holdback" as const;
export const THICKNESS_TAPER_WINDOW_MS = 100;
export const THICKNESS_SPEED_FILTER_TIME_MS = 50;

export type ThicknessDynamicsStrategy = typeof THICKNESS_DYNAMICS_STRATEGY;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function quadraticEaseOut(progress: number): number {
  const remaining = 1 - clamp(progress, 0, 1);
  return 1 - remaining * remaining;
}

export function filterStrokeSpeed(
  previousSpeedPxPerMs: number,
  rawSpeedPxPerMs: number,
  deltaTimeMs: number,
  initialized: boolean,
): number {
  const safeRawSpeed = Math.max(0, Number.isFinite(rawSpeedPxPerMs) ? rawSpeedPxPerMs : 0);
  if (!initialized) {
    return safeRawSpeed;
  }
  if (!Number.isFinite(deltaTimeMs) || deltaTimeMs <= 0) {
    return Math.max(0, previousSpeedPxPerMs);
  }
  const blend = 1 - Math.exp(-deltaTimeMs / THICKNESS_SPEED_FILTER_TIME_MS);
  return Math.max(0, previousSpeedPxPerMs + (safeRawSpeed - previousSpeedPxPerMs) * blend);
}

export function speedThicknessFactor(
  speedPxPerMs: number,
  brushSizePx: number,
  speedThicknessPercent: number,
): number {
  const safeBrushSize = Math.max(0.001, brushSizePx);
  const normalizedSpeed = clamp(
    Math.max(0, speedPxPerMs) * THICKNESS_TAPER_WINDOW_MS / safeBrushSize,
    0,
    1,
  );
  const response = quadraticEaseOut(normalizedSpeed);
  return clamp(1 + clamp(speedThicknessPercent, -200, 200) / 200 * response, 0, 2);
}

export function startThicknessFactor(
  startThicknessRatio: number,
  centerThicknessFactor: number,
  elapsedMs: number,
): number {
  const start = clamp(startThicknessRatio, 0, 2);
  const center = clamp(centerThicknessFactor, 0, 2);
  const progress = quadraticEaseOut(elapsedMs / THICKNESS_TAPER_WINDOW_MS);
  return start + (center - start) * progress;
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

export function thicknessDynamicsNeedsTailHoldback(
  endThicknessRatio: number,
  speedThicknessPercent: number,
): boolean {
  return Math.abs(clamp(endThicknessRatio, 0, 2) - 1) > Number.EPSILON * 8
    || Math.abs(clamp(speedThicknessPercent, -200, 200)) > Number.EPSILON * 8;
}

export function thicknessDynamicsIsNeutral(
  startThicknessRatio: number,
  endThicknessRatio: number,
  speedThicknessPercent: number,
): boolean {
  return Math.abs(clamp(startThicknessRatio, 0, 2) - 1) <= Number.EPSILON * 8
    && !thicknessDynamicsNeedsTailHoldback(endThicknessRatio, speedThicknessPercent);
}

export function selectEvenlySpacedItems<T>(
  items: readonly T[],
  maximumItems: number,
): T[] {
  const limit = Math.max(0, Math.floor(maximumItems));
  if (limit === 0 || items.length === 0) {
    return [];
  }
  if (items.length <= limit) {
    return [...items];
  }
  if (limit === 1) {
    return [items[items.length - 1]];
  }

  const selected: T[] = [];
  for (let sampleIndex = 0; sampleIndex < limit; sampleIndex += 1) {
    const itemIndex = Math.round(sampleIndex * (items.length - 1) / (limit - 1));
    selected.push(items[itemIndex]);
  }
  return selected;
}
