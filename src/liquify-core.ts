/** Pure, allocation-light contract shared by the Liquify UI and WebGPU runtime. */

export const LIQUIFY_CORE_STRATEGY =
  "procreate-style-displacement-field-v2-composed-warp-mode-aware-resampling" as const;

export const LIQUIFY_MODES = Object.freeze([
  "push",
  "twirl-right",
  "twirl-left",
  "pinch",
  "expand",
  "crystals",
  "edge",
  "reconstruct",
] as const);

export type LiquifyMode = (typeof LIQUIFY_MODES)[number];

export interface LiquifySettings {
  mode: LiquifyMode;
  /** Brush diameter in document pixels. */
  size: number;
  /** User strength multiplier, normalized to 0..1. */
  pressure: number;
  /** Mode irregularity/falloff shaping, normalized to 0..1. */
  distortion: number;
  /** Post-lift inertial continuation, normalized to 0..1. */
  momentum: number;
}

export const LIQUIFY_LIMITS = Object.freeze({
  minimumSize: 1,
  maximumSize: 1_000,
  minimumPressure: 0,
  maximumPressure: 1,
  minimumDistortion: 0,
  maximumDistortion: 1,
  minimumMomentum: 0,
  maximumMomentum: 1,
  minimumSpacing: 0.75,
  maximumSpacing: 32,
  bilinearGuardPixels: 2,
});

export const DEFAULT_LIQUIFY_SETTINGS: Readonly<LiquifySettings> = Object.freeze({
  mode: "push",
  size: 180,
  pressure: 0.5,
  distortion: 0,
  momentum: 0,
});

export interface LiquifyPoint {
  x: number;
  y: number;
  /** Pointer pressure, normalized to 0..1. */
  pressure: number;
  timeMs: number;
}

export interface LiquifyRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LiquifyModeControls {
  size: true;
  pressure: true;
  distortion: boolean;
  momentum: boolean;
}

const MODE_CODES: Readonly<Record<LiquifyMode, number>> = Object.freeze({
  push: 0,
  "twirl-right": 1,
  "twirl-left": 2,
  pinch: 3,
  expand: 4,
  crystals: 5,
  edge: 6,
  reconstruct: 7,
});

const finiteOr = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

export function isLiquifyMode(value: unknown): value is LiquifyMode {
  return typeof value === "string" && (LIQUIFY_MODES as readonly string[]).includes(value);
}

export function liquifyModeCode(mode: LiquifyMode): number {
  return MODE_CODES[mode];
}

export function liquifyModeControls(mode: LiquifyMode): LiquifyModeControls {
  return {
    size: true,
    pressure: true,
    distortion: mode !== "reconstruct",
    momentum: true,
  };
}

export function normalizeLiquifySettings(
  value: Partial<LiquifySettings> | null | undefined,
  fallback: Readonly<LiquifySettings> = DEFAULT_LIQUIFY_SETTINGS,
): LiquifySettings {
  const source = value ?? {};
  return {
    mode: isLiquifyMode(source.mode) ? source.mode : fallback.mode,
    size: clamp(
      finiteOr(source.size, fallback.size),
      LIQUIFY_LIMITS.minimumSize,
      LIQUIFY_LIMITS.maximumSize,
    ),
    pressure: clamp(
      finiteOr(source.pressure, fallback.pressure),
      LIQUIFY_LIMITS.minimumPressure,
      LIQUIFY_LIMITS.maximumPressure,
    ),
    distortion: clamp(
      finiteOr(source.distortion, fallback.distortion),
      LIQUIFY_LIMITS.minimumDistortion,
      LIQUIFY_LIMITS.maximumDistortion,
    ),
    momentum: clamp(
      finiteOr(source.momentum, fallback.momentum),
      LIQUIFY_LIMITS.minimumMomentum,
      LIQUIFY_LIMITS.maximumMomentum,
    ),
  };
}

export function liquifyBrushRadius(settings: Readonly<LiquifySettings>): number {
  return normalizeLiquifySettings(settings).size * 0.5;
}

/** Diameter fractions for smooth and maximally distorted input sampling. */
const MODE_SPACING_FRACTIONS: Readonly<Record<LiquifyMode, readonly [number, number]>> =
  Object.freeze({
    push: [0.045, 0.028],
    "twirl-right": [0.06, 0.038],
    "twirl-left": [0.06, 0.038],
    pinch: [0.055, 0.034],
    expand: [0.055, 0.034],
    crystals: [0.043, 0.024],
    edge: [0.043, 0.026],
    reconstruct: [0.04, 0.04],
  });

/**
 * Distance between generated dabs. Modes with sharp or chaotic structure are
 * sampled more densely, and increasing Distortion tightens rather than loosens
 * spacing. This avoids holes and scalloped edges during fast pen movement.
 */
export function liquifySpacingPx(settings: Readonly<LiquifySettings>): number {
  const normalized = normalizeLiquifySettings(settings);
  const [smoothFraction, distortedFraction] = MODE_SPACING_FRACTIONS[normalized.mode];
  const diameterFraction = smoothFraction
    + (distortedFraction - smoothFraction) * normalized.distortion;
  return clamp(
    normalized.size * diameterFraction,
    LIQUIFY_LIMITS.minimumSpacing,
    LIQUIFY_LIMITS.maximumSpacing,
  );
}

export function liquifySegmentStepCount(
  start: Pick<LiquifyPoint, "x" | "y">,
  end: Pick<LiquifyPoint, "x" | "y">,
  spacingPx: number,
): number {
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const spacing = clamp(
    finiteOr(spacingPx, LIQUIFY_LIMITS.minimumSpacing),
    LIQUIFY_LIMITS.minimumSpacing,
    LIQUIFY_LIMITS.maximumSpacing,
  );
  return Math.max(1, Math.ceil(distance / spacing));
}

/** Writes one interpolated sample without allocating a segment-sized array. */
export function liquifyInterpolatedPoint(
  start: Readonly<LiquifyPoint>,
  end: Readonly<LiquifyPoint>,
  stepIndex: number,
  stepCount: number,
  target: LiquifyPoint = { x: 0, y: 0, pressure: 0, timeMs: 0 },
): LiquifyPoint {
  const count = Math.max(1, Math.trunc(finiteOr(stepCount, 1)));
  const index = clamp(Math.trunc(finiteOr(stepIndex, count)), 1, count);
  const t = index / count;
  target.x = start.x + (end.x - start.x) * t;
  target.y = start.y + (end.y - start.y) * t;
  target.pressure = clamp(
    start.pressure + (end.pressure - start.pressure) * t,
    0,
    1,
  );
  target.timeMs = start.timeMs + (end.timeMs - start.timeMs) * t;
  return target;
}

export function clipLiquifyRect(
  rect: Readonly<LiquifyRect>,
  documentWidth: number,
  documentHeight: number,
): LiquifyRect | null {
  const width = Math.max(0, Math.trunc(finiteOr(documentWidth, 0)));
  const height = Math.max(0, Math.trunc(finiteOr(documentHeight, 0)));
  if (width === 0 || height === 0) return null;
  const left = clamp(Math.floor(rect.x), 0, width);
  const top = clamp(Math.floor(rect.y), 0, height);
  const right = clamp(Math.ceil(rect.x + rect.width), 0, width);
  const bottom = clamp(Math.ceil(rect.y + rect.height), 0, height);
  return right > left && bottom > top
    ? { x: left, y: top, width: right - left, height: bottom - top }
    : null;
}

export function unionLiquifyRects(
  left: Readonly<LiquifyRect> | null,
  right: Readonly<LiquifyRect> | null,
): LiquifyRect | null {
  if (!left) return right ? { ...right } : null;
  if (!right) return { ...left };
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const farX = Math.max(left.x + left.width, right.x + right.width);
  const farY = Math.max(left.y + left.height, right.y + right.height);
  return { x, y, width: farX - x, height: farY - y };
}

export function liquifyDabDirtyBounds(
  center: Pick<LiquifyPoint, "x" | "y">,
  settings: Readonly<LiquifySettings>,
  documentWidth: number,
  documentHeight: number,
): LiquifyRect | null {
  const radius = liquifyBrushRadius(settings) + LIQUIFY_LIMITS.bilinearGuardPixels;
  return clipLiquifyRect(
    {
      x: center.x - radius,
      y: center.y - radius,
      width: radius * 2,
      height: radius * 2,
    },
    documentWidth,
    documentHeight,
  );
}

export function liquifySegmentDirtyBounds(
  start: Pick<LiquifyPoint, "x" | "y">,
  end: Pick<LiquifyPoint, "x" | "y">,
  settings: Readonly<LiquifySettings>,
  documentWidth: number,
  documentHeight: number,
): LiquifyRect | null {
  return unionLiquifyRects(
    liquifyDabDirtyBounds(start, settings, documentWidth, documentHeight),
    liquifyDabDirtyBounds(end, settings, documentWidth, documentHeight),
  );
}

/** Dynamic-uniform stride; only the first 128 bytes are currently consumed. */
export const LIQUIFY_UNIFORM_BYTES = 256;
export const LIQUIFY_UNIFORM_USED_BYTES = 128;

export const LIQUIFY_UNIFORM_OFFSETS = Object.freeze({
  dispatchOrigin: 0,
  dispatchSize: 8,
  fieldOrigin: 16,
  fieldSize: 24,
  center: 32,
  previousCenter: 40,
  delta: 48,
  size: 56,
  pressure: 60,
  distortion: 64,
  momentum: 68,
  spacing: 72,
  elapsedSeconds: 76,
  seed: 80,
  mode: 84,
  strength: 88,
  maximumDisplacement: 92,
  sourceOrigin: 96,
  sourceSize: 104,
  documentSize: 112,
  strokeDirection: 120,
});

export interface LiquifyUniformInput {
  dispatchOriginX: number;
  dispatchOriginY: number;
  dispatchWidth: number;
  dispatchHeight: number;
  fieldOriginX: number;
  fieldOriginY: number;
  fieldWidth: number;
  fieldHeight: number;
  centerX: number;
  centerY: number;
  previousCenterX: number;
  previousCenterY: number;
  deltaX: number;
  deltaY: number;
  settings: Readonly<LiquifySettings>;
  pointerPressure: number;
  elapsedSeconds: number;
  seed: number;
  strength?: number;
  maximumDisplacement?: number;
  sourceOriginX: number;
  sourceOriginY: number;
  sourceWidth: number;
  sourceHeight: number;
  documentWidth: number;
  documentHeight: number;
  /** Stable unit tangent for directional modes such as Edge. */
  strokeDirectionX?: number;
  strokeDirectionY?: number;
}

function requireBuffer(target: ArrayBuffer | undefined): ArrayBuffer {
  if (target && target.byteLength < LIQUIFY_UNIFORM_BYTES) {
    throw new RangeError(
      `Buffer uniformi Liquify di ${target.byteLength} byte, richiesti ${LIQUIFY_UNIFORM_BYTES}.`,
    );
  }
  return target ?? new ArrayBuffer(LIQUIFY_UNIFORM_BYTES);
}

/** Packs the ABI consumed verbatim by both WGSL modules. */
export function packLiquifyUniforms(
  input: Readonly<LiquifyUniformInput>,
  target?: ArrayBuffer,
): ArrayBuffer {
  const buffer = requireBuffer(target);
  new Uint8Array(buffer, 0, LIQUIFY_UNIFORM_BYTES).fill(0);
  const view = new DataView(buffer);
  const littleEndian = true;
  const settings = normalizeLiquifySettings(input.settings);
  const i32 = (offset: number, value: number) =>
    view.setInt32(offset, Math.trunc(finiteOr(value, 0)), littleEndian);
  const u32 = (offset: number, value: number) =>
    view.setUint32(offset, Math.max(0, Math.trunc(finiteOr(value, 0))), littleEndian);
  const f32 = (offset: number, value: number) =>
    view.setFloat32(offset, finiteOr(value, 0), littleEndian);

  i32(0, input.dispatchOriginX);
  i32(4, input.dispatchOriginY);
  u32(8, input.dispatchWidth);
  u32(12, input.dispatchHeight);
  i32(16, input.fieldOriginX);
  i32(20, input.fieldOriginY);
  u32(24, input.fieldWidth);
  u32(28, input.fieldHeight);
  f32(32, input.centerX);
  f32(36, input.centerY);
  f32(40, input.previousCenterX);
  f32(44, input.previousCenterY);
  f32(48, input.deltaX);
  f32(52, input.deltaY);
  f32(56, settings.size);
  f32(60, settings.pressure * clamp(finiteOr(input.pointerPressure, 1), 0, 1));
  f32(64, settings.distortion);
  f32(68, settings.momentum);
  f32(72, liquifySpacingPx(settings));
  f32(76, Math.max(0, finiteOr(input.elapsedSeconds, 0)));
  u32(80, input.seed);
  u32(84, liquifyModeCode(settings.mode));
  f32(88, Math.max(0, finiteOr(input.strength, 1)));
  f32(
    92,
    Math.max(settings.size, finiteOr(input.maximumDisplacement, settings.size * 4)),
  );
  i32(96, input.sourceOriginX);
  i32(100, input.sourceOriginY);
  u32(104, input.sourceWidth);
  u32(108, input.sourceHeight);
  u32(112, input.documentWidth);
  u32(116, input.documentHeight);
  f32(120, finiteOr(input.strokeDirectionX, input.deltaX));
  f32(124, finiteOr(input.strokeDirectionY, input.deltaY));
  return buffer;
}
