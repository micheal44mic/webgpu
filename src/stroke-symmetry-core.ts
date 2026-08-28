/** Document-space reflection applied to every physical copy of a paint stamp. */
export type StrokeSymmetryMode = "off" | "vertical" | "horizontal" | "angle";

export interface StrokeSymmetryTransform {
  readonly mode: StrokeSymmetryMode;
  readonly angleRadians: number;
}

export const DEFAULT_STROKE_SYMMETRY_ANGLE_RADIANS = Math.PI * 0.5;

export const STROKE_SYMMETRY_COPY_COUNT_MASK = 0xff;
export const STROKE_SYMMETRY_MODE_SHIFT = 8;

export function normalizeStrokeSymmetryMode(value: unknown): StrokeSymmetryMode {
  return value === "vertical" || value === "horizontal" || value === "angle"
    ? value
    : "off";
}

export function strokeSymmetryModeCode(mode: StrokeSymmetryMode): 0 | 1 | 2 | 3 {
  return mode === "vertical" ? 1 : mode === "horizontal" ? 2 : mode === "angle" ? 3 : 0;
}

export function normalizeStrokeSymmetryAngleRadians(
  value: unknown,
  fallback = DEFAULT_STROKE_SYMMETRY_ANGLE_RADIANS,
): number {
  const finiteFallback = Number.isFinite(fallback)
    ? fallback
    : DEFAULT_STROKE_SYMMETRY_ANGLE_RADIANS;
  const numeric = typeof value === "number" && Number.isFinite(value)
    ? value
    : finiteFallback;
  const normalized = ((numeric % Math.PI) + Math.PI) % Math.PI;
  return Math.abs(normalized - Math.PI) <= Number.EPSILON ? 0 : normalized;
}

export function resolvedStrokeSymmetryAngleRadians(
  mode: StrokeSymmetryMode,
  angleRadians?: unknown,
): number {
  if (mode === "vertical") return Math.PI * 0.5;
  if (mode === "horizontal" || mode === "off") return 0;
  return normalizeStrokeSymmetryAngleRadians(angleRadians);
}

export function strokeSymmetryReflectionCoefficients(
  mode: StrokeSymmetryMode,
  angleRadians?: unknown,
): readonly [number, number] {
  if (mode === "off") return [0, 0];
  const angle = resolvedStrokeSymmetryAngleRadians(mode, angleRadians);
  const snap = (value: number): number => {
    if (Math.abs(value) < 1e-7) return 0;
    if (Math.abs(value - 1) < 1e-7) return 1;
    if (Math.abs(value + 1) < 1e-7) return -1;
    return Math.fround(value);
  };
  return [snap(Math.cos(angle * 2)), snap(Math.sin(angle * 2))];
}

export function encodeStrokeSymmetryOptions(
  brushCopyCount: number,
  mode: StrokeSymmetryMode,
): number {
  const normalizedCopyCount = Math.max(
    1,
    Math.min(STROKE_SYMMETRY_COPY_COUNT_MASK, Math.trunc(brushCopyCount)),
  );
  return (
    normalizedCopyCount
    | (strokeSymmetryModeCode(mode) << STROKE_SYMMETRY_MODE_SHIFT)
  ) >>> 0;
}

export function strokeSymmetryCopyCount(mode: StrokeSymmetryMode): 1 | 2 {
  return mode === "off" ? 1 : 2;
}

export function strokeSymmetryPhysicalCopyCount(
  brushCopyCount: number,
  mode: StrokeSymmetryMode,
): number {
  return Math.max(1, Math.trunc(brushCopyCount)) * strokeSymmetryCopyCount(mode);
}

export function strokeSymmetryTransformForStampBatch(
  stamps: readonly {
    readonly symmetryMode?: unknown;
    readonly symmetryAngleRadians?: unknown;
  }[],
  fallbackMode: StrokeSymmetryMode = "off",
  fallbackAngleRadians = resolvedStrokeSymmetryAngleRadians(fallbackMode),
): StrokeSymmetryTransform {
  let batchMode = normalizeStrokeSymmetryMode(fallbackMode);
  let batchAngleRadians = resolvedStrokeSymmetryAngleRadians(
    batchMode,
    fallbackAngleRadians,
  );
  for (let index = 0; index < stamps.length; index += 1) {
    const rawMode = stamps[index].symmetryMode;
    const mode = rawMode === undefined ? "off" : normalizeStrokeSymmetryMode(rawMode);
    if (rawMode !== undefined && rawMode !== mode) {
      throw new Error("Invalid stamp symmetry mode.");
    }
    const rawAngleRadians = stamps[index].symmetryAngleRadians;
    if (mode === "angle" && (typeof rawAngleRadians !== "number" || !Number.isFinite(rawAngleRadians))) {
      throw new Error("Invalid stamp symmetry angle.");
    }
    const angleRadians = resolvedStrokeSymmetryAngleRadians(mode, rawAngleRadians);
    if (index === 0) {
      batchMode = mode;
      batchAngleRadians = angleRadians;
    } else if (
      mode !== batchMode
      || Math.abs(angleRadians - batchAngleRadians) > 1e-7
    ) {
      throw new Error("A paint batch contains multiple symmetry transforms.");
    }
  }
  return { mode: batchMode, angleRadians: batchAngleRadians };
}

export function reflectStrokeSymmetryCenter(
  x: number,
  y: number,
  mode: StrokeSymmetryMode,
  documentWidth: number,
  documentHeight: number,
  angleRadians?: number,
): readonly [number, number] {
  if (mode === "off") return [x, y];
  const [cosineDoubleAngle, sineDoubleAngle] = strokeSymmetryReflectionCoefficients(
    mode,
    angleRadians,
  );
  const offsetX = x - documentWidth * 0.5;
  const offsetY = y - documentHeight * 0.5;
  return [
    documentWidth * 0.5 + cosineDoubleAngle * offsetX + sineDoubleAngle * offsetY,
    documentHeight * 0.5 + sineDoubleAngle * offsetX - cosineDoubleAngle * offsetY,
  ];
}

export function reflectedStrokeSymmetryExtent(
  reachX: number,
  reachY: number,
  mode: StrokeSymmetryMode,
  angleRadians?: number,
): readonly [number, number] {
  if (mode === "off") return [reachX, reachY];
  const [cosineDoubleAngle, sineDoubleAngle] = strokeSymmetryReflectionCoefficients(
    mode,
    angleRadians,
  );
  return [
    Math.abs(cosineDoubleAngle) * reachX + Math.abs(sineDoubleAngle) * reachY,
    Math.abs(sineDoubleAngle) * reachX + Math.abs(cosineDoubleAngle) * reachY,
  ];
}

export function strokeSymmetryCopiesIntersectDocument(
  x: number,
  y: number,
  reachX: number,
  reachY: number,
  mode: StrokeSymmetryMode,
  documentWidth: number,
  documentHeight: number,
  angleRadians?: number,
): boolean {
  const intersects = (
    centerX: number,
    centerY: number,
    halfWidth: number,
    halfHeight: number,
  ): boolean => centerX + halfWidth >= 0
    && centerY + halfHeight >= 0
    && centerX - halfWidth < documentWidth
    && centerY - halfHeight < documentHeight;
  if (intersects(x, y, reachX, reachY)) return true;
  if (mode === "off") return false;
  const [reflectedX, reflectedY] = reflectStrokeSymmetryCenter(
    x,
    y,
    mode,
    documentWidth,
    documentHeight,
    angleRadians,
  );
  const [reflectedReachX, reflectedReachY] = reflectedStrokeSymmetryExtent(
    reachX,
    reachY,
    mode,
    angleRadians,
  );
  return intersects(reflectedX, reflectedY, reflectedReachX, reflectedReachY);
}
