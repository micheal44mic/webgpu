/** Document-space reflection applied to every physical copy of a paint stamp. */
export type StrokeSymmetryMode = "off" | "vertical" | "horizontal";

export const STROKE_SYMMETRY_COPY_COUNT_MASK = 0xff;
export const STROKE_SYMMETRY_MODE_SHIFT = 8;

export function normalizeStrokeSymmetryMode(value: unknown): StrokeSymmetryMode {
  return value === "vertical" || value === "horizontal" ? value : "off";
}

export function strokeSymmetryModeCode(mode: StrokeSymmetryMode): 0 | 1 | 2 {
  return mode === "vertical" ? 1 : mode === "horizontal" ? 2 : 0;
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

export function strokeSymmetryModeForStampBatch(
  stamps: readonly { readonly symmetryMode?: unknown }[],
  fallback: StrokeSymmetryMode = "off",
): StrokeSymmetryMode {
  let batchMode = fallback;
  for (let index = 0; index < stamps.length; index += 1) {
    const rawMode = stamps[index].symmetryMode;
    const mode = rawMode === undefined ? "off" : normalizeStrokeSymmetryMode(rawMode);
    if (rawMode !== undefined && rawMode !== mode) {
      throw new Error("Invalid stamp symmetry mode.");
    }
    if (index === 0) batchMode = mode;
    else if (mode !== batchMode) {
      throw new Error("A paint batch contains multiple symmetry modes.");
    }
  }
  return batchMode;
}

export function reflectStrokeSymmetryCenter(
  x: number,
  y: number,
  mode: StrokeSymmetryMode,
  documentWidth: number,
  documentHeight: number,
): readonly [number, number] {
  if (mode === "vertical") return [documentWidth - x, y];
  if (mode === "horizontal") return [x, documentHeight - y];
  return [x, y];
}
