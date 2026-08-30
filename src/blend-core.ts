// Pure CPU core for the proprietary dry Blend brush.
//
// This module intentionally contains no DOM, WebGPU, renderer, or history code.
// Its output is a deterministic stream of continuous sweep
// segments plus the conservative ROI needed by the later GPU port.

import { LAYER_SIZE as DRY_BLEND_DEFAULT_DOCUMENT_SIZE } from "./engine-limits.ts";

export const DRY_BLEND_CORE_BUILD = "dry-blend-continuous-core-v1-pressure-inert";
export const DRY_BLEND_REFERENCE_STEP_RATIO = 0.06;
export const DRY_BLEND_REFERENCE_MIN_STEP_PX = 2.5;
export const DRY_BLEND_REFERENCE_MAX_STEP_PX = 48;
export const DRY_BLEND_BLUR_MAX_SUPPORT_PX = 64;
export const DRY_BLEND_BLUR_REDUCED_MAX_SUPPORT_PX = 12;
export const DRY_BLEND_BLUR_DIAMETER_RATIO = 0.25;
// Compatibility default remains a live view of the active document edge.
export { DRY_BLEND_DEFAULT_DOCUMENT_SIZE };
export const DRY_BLEND_DEFAULT_SCRATCH_SIZE = 1664;
export const DRY_BLEND_DEFAULT_TILE_SIZE = 256;
export const DRY_BLEND_SCRATCH_LIFECYCLE_STRATEGY =
  "allocate-on-tool-select-release-when-idle-deselected" as const;

const POSITION_QUANTUM = 1 / 256;

export interface DryBlendControls {
  size: number;
  strength: number;
  spacing: number;
  flow: number;
  stretch: number;
  paint: number;
  blur: number;
  aspect: number;
  angle: number;
  orientToStroke: boolean;
  seed: number;
}

export const DEFAULT_DRY_BLEND_CONTROLS: Readonly<DryBlendControls> = Object.freeze({
  size: 64,
  strength: 1,
  spacing: 0.15,
  flow: 1,
  stretch: 0.18,
  paint: 0.14,
  blur: 0,
  aspect: 1,
  angle: 0,
  orientToStroke: true,
  seed: 1,
});

export interface DryBlendSample {
  x: number;
  y: number;
  timeMs?: number;
  timeStamp?: number;
  // Accepted for a shared pointer-input boundary, but deliberately ignored.
  pressure?: number;
}

export interface QuantizedDryBlendSample {
  x: number;
  y: number;
  timeMs: number;
  readonly pressure: 1;
}

export interface BlendRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DryBlendStep {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  dirX: number;
  dirY: number;
  distance: number;
  fromDiameter: number;
  toDiameter: number;
  diameter: number;
  fromHalfWidth: number;
  fromHalfHeight: number;
  toHalfWidth: number;
  toHalfHeight: number;
  fromAngle: number;
  toAngle: number;
  angle: number;
  // The original renderer called this warpStrength. In dry Blend it is the
  // pressure-independent deposit strength; the name is retained for port ABI.
  warpStrength: number;
  flow: number;
  spacing: number;
  arcStart: number;
  arcEnd: number;
  speed: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  maxHalo: number;
}

export interface DryBlendBatch {
  readonly build: typeof DRY_BLEND_CORE_BUILD;
  generation: number;
  stepCount: 1;
  readonly steps: [DryBlendStep];
  empty: boolean;
  maxHalo: number;
  readRect: BlendRect;
  writeRect: BlendRect;
  localWriteRect: BlendRect;
  clippedReadRect: BlendRect;
  dirtyRect: BlendRect;
  readTiles: Uint32Array;
  writeTiles: Uint32Array;
  readTileCount: number;
  writeTileCount: number;
}

export interface DryBlendPushResult {
  accepted: boolean;
  steps: number;
  stationary: boolean;
  reason: "capacity" | null;
  requiredSteps: number;
  capacity: DryBlendPlannerCapacity | null;
}

export interface DryBlendPlannerCapacity {
  steps: number;
  stepFree: number;
}

export interface DryBlendPlannerOptions {
  documentWidth?: number;
  documentHeight?: number;
  tileSize?: number;
  scratchSize?: number;
  maxSteps?: number;
}

export interface DryBlendPlanner {
  readonly build: typeof DRY_BLEND_CORE_BUILD;
  readonly controls: Readonly<DryBlendControls>;
  configure(nextControls?: Partial<DryBlendControls>): Readonly<DryBlendControls>;
  reset(initialSample: DryBlendSample): QuantizedDryBlendSample;
  discardPending(): true;
  pushSample(sample: DryBlendSample): DryBlendPushResult;
  pushSamples(samples: readonly DryBlendSample[]): DryBlendPushResult;
  finish(): DryBlendPushResult;
  buildNextBatch(): DryBlendBatch | null;
  snapshotSteps(): DryBlendStep[];
  capacity(): DryBlendPlannerCapacity;
  sampleMovesFromLast(sample: DryBlendSample): boolean;
  pendingSteps(): number;
  lastSample(): QuantizedDryBlendSample | null;
  memoryLedger(): {
    stepCapacity: number;
    stepBytes: number;
    batchBytes: number;
    totalBytes: number;
  };
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

const finite = (value: unknown, name: string): number => {
  const result = Number(value);
  if (!Number.isFinite(result)) {
    throw new TypeError(`${name} must be finite`);
  }
  return result;
};

const positive = (value: unknown, name: string): number => {
  const result = finite(value, name);
  if (!(result > 0)) {
    throw new RangeError(`${name} must be > 0`);
  }
  return result;
};

const unit = (value: unknown, name: string): number => {
  const result = finite(value, name);
  if (result < 0 || result > 1) {
    throw new RangeError(`${name} must be between 0 and 1`);
  }
  return result;
};

const positiveInteger = (value: unknown, name: string): number => {
  const result = Math.trunc(finite(value, name));
  if (result < 1) {
    throw new RangeError(`${name} must be >= 1`);
  }
  return result;
};

const f32 = (value: number): number => Math.fround(value);
const lerp = (a: number, b: number, ratio: number): number => a + (b - a) * ratio;

export function normalizeDryBlendControls(
  source: Partial<DryBlendControls> = {},
): Readonly<DryBlendControls> {
  if (!source || typeof source !== "object") {
    throw new TypeError("invalid Blend dry controls");
  }
  return Object.freeze({
    size: clamp(positive(source.size ?? DEFAULT_DRY_BLEND_CONTROLS.size, "size"), 1, 1024),
    strength: unit(source.strength ?? DEFAULT_DRY_BLEND_CONTROLS.strength, "strength"),
    spacing: clamp(
      positive(source.spacing ?? DEFAULT_DRY_BLEND_CONTROLS.spacing, "spacing"),
      0.01,
      4,
    ),
    flow: unit(source.flow ?? DEFAULT_DRY_BLEND_CONTROLS.flow, "flow"),
    stretch: unit(source.stretch ?? DEFAULT_DRY_BLEND_CONTROLS.stretch, "stretch"),
    paint: unit(source.paint ?? DEFAULT_DRY_BLEND_CONTROLS.paint, "paint"),
    blur: unit(source.blur ?? DEFAULT_DRY_BLEND_CONTROLS.blur, "blur"),
    aspect: clamp(
      positive(source.aspect ?? DEFAULT_DRY_BLEND_CONTROLS.aspect, "aspect"),
      0.05,
      20,
    ),
    angle: finite(source.angle ?? DEFAULT_DRY_BLEND_CONTROLS.angle, "angle"),
    orientToStroke: source.orientToStroke
      ?? DEFAULT_DRY_BLEND_CONTROLS.orientToStroke
      ? true
      : false,
    seed: Math.trunc(finite(source.seed ?? DEFAULT_DRY_BLEND_CONTROLS.seed, "seed")) >>> 0,
  });
}

export function blendStretchCoefficient(
  value: number = DEFAULT_DRY_BLEND_CONTROLS.stretch,
): number {
  return Math.sqrt(unit(value, "stretch"));
}

export function blendPaintCoefficient(
  value: number = DEFAULT_DRY_BLEND_CONTROLS.paint,
): number {
  const normalized = unit(value, "paint");
  return normalized * normalized;
}

/**
 * Controls how much picked-up or loaded pigment is deposited after the
 * Gaussian pass. With both transport controls at zero, any positive Blur is
 * a pure, colorless blur and must not redeposit the carrier over its result.
 */
export function blendPigmentDepositScale(
  blur: number = DEFAULT_DRY_BLEND_CONTROLS.blur,
  stretch: number = DEFAULT_DRY_BLEND_CONTROLS.stretch,
  paint: number = DEFAULT_DRY_BLEND_CONTROLS.paint,
): number {
  const normalizedBlur = unit(blur, "blur");
  const normalizedStretch = unit(stretch, "stretch");
  const normalizedPaint = unit(paint, "paint");
  if (normalizedBlur > 0 && normalizedStretch === 0 && normalizedPaint === 0) {
    return 0;
  }
  return 1 - normalizedBlur;
}

/**
 * Maps the public 0..1 control to the three-sigma support used by the same
 * normalized Gaussian kernel as the layer Gaussian Blur. The brush-relative
 * radius keeps the effect visually stable across sizes, while the cap bounds
 * both scratch halo and GPU work for very large tips.
 */
export function blendBlurSupportRadius(
  value: number = DEFAULT_DRY_BLEND_CONTROLS.blur,
  diameter: number = DEFAULT_DRY_BLEND_CONTROLS.size,
): number {
  const normalized = unit(value, "blur");
  if (normalized <= 0) return 0;
  const maximum = Math.min(
    DRY_BLEND_BLUR_MAX_SUPPORT_PX,
    Math.max(1, positive(diameter, "diameter") * DRY_BLEND_BLUR_DIAMETER_RATIO),
  );
  return Math.max(1, Math.ceil(maximum * normalized));
}

/**
 * Large brush-local blurs run on a document-anchored reduced grid. Keeping the
 * Gaussian support at twelve reduced pixels bounds the interactive shader
 * work while retaining full-resolution convolution for small radii.
 */
export function blendBlurSamplingScale(
  value: number = DEFAULT_DRY_BLEND_CONTROLS.blur,
  diameter: number = DEFAULT_DRY_BLEND_CONTROLS.size,
): number {
  const radius = blendBlurSupportRadius(value, diameter);
  return radius <= DRY_BLEND_BLUR_REDUCED_MAX_SUPPORT_PX
    ? 1
    : Math.ceil(radius / DRY_BLEND_BLUR_REDUCED_MAX_SUPPORT_PX);
}

/** Conservative read halo for reduced-grid box sampling and bilinear restore. */
export function blendBlurReadSupportRadius(
  value: number = DEFAULT_DRY_BLEND_CONTROLS.blur,
  diameter: number = DEFAULT_DRY_BLEND_CONTROLS.size,
): number {
  const radius = blendBlurSupportRadius(value, diameter);
  const scale = blendBlurSamplingScale(value, diameter);
  return scale === 1
    ? radius
    : Math.ceil(radius / scale) * scale + scale * 2;
}

export function quantizeDryBlendSample(sample: DryBlendSample): QuantizedDryBlendSample {
  if (!sample || typeof sample !== "object") {
    throw new TypeError("invalid Blend dry sample");
  }
  // Pressure is intentionally normalized to the neutral value. This guarantees
  // that changing pointer pressure cannot alter size, strength, ROI, or steps.
  return {
    x: Math.round(finite(sample.x, "sample.x") * 256) / 256,
    y: Math.round(finite(sample.y, "sample.y") * 256) / 256,
    timeMs: Math.round(finite(sample.timeMs ?? sample.timeStamp ?? 0, "sample.timeMs")),
    pressure: 1,
  };
}

export function dryBlendReferenceStep(diameter: number): number {
  return clamp(
    positive(diameter, "diameter") * DRY_BLEND_REFERENCE_STEP_RATIO,
    DRY_BLEND_REFERENCE_MIN_STEP_PX,
    DRY_BLEND_REFERENCE_MAX_STEP_PX,
  );
}

function emptyStep(): DryBlendStep {
  return {
    fromX: 0,
    fromY: 0,
    toX: 0,
    toY: 0,
    dirX: 0,
    dirY: 0,
    distance: 0,
    fromDiameter: 0,
    toDiameter: 0,
    diameter: 0,
    fromHalfWidth: 0,
    fromHalfHeight: 0,
    toHalfWidth: 0,
    toHalfHeight: 0,
    fromAngle: 0,
    toAngle: 0,
    angle: 0,
    warpStrength: 0,
    flow: 1,
    spacing: 0.15,
    arcStart: 0,
    arcEnd: 0,
    speed: 0,
    minX: 0,
    minY: 0,
    maxX: 0,
    maxY: 0,
    maxHalo: 0,
  };
}

function copyStep(source: DryBlendStep): DryBlendStep {
  return { ...source };
}

function copyStepInto(target: DryBlendStep, source: DryBlendStep): DryBlendStep {
  target.fromX = source.fromX;
  target.fromY = source.fromY;
  target.toX = source.toX;
  target.toY = source.toY;
  target.dirX = source.dirX;
  target.dirY = source.dirY;
  target.distance = source.distance;
  target.fromDiameter = source.fromDiameter;
  target.toDiameter = source.toDiameter;
  target.diameter = source.diameter;
  target.fromHalfWidth = source.fromHalfWidth;
  target.fromHalfHeight = source.fromHalfHeight;
  target.toHalfWidth = source.toHalfWidth;
  target.toHalfHeight = source.toHalfHeight;
  target.fromAngle = source.fromAngle;
  target.toAngle = source.toAngle;
  target.angle = source.angle;
  target.warpStrength = source.warpStrength;
  target.flow = source.flow;
  target.spacing = source.spacing;
  target.arcStart = source.arcStart;
  target.arcEnd = source.arcEnd;
  target.speed = source.speed;
  target.minX = source.minX;
  target.minY = source.minY;
  target.maxX = source.maxX;
  target.maxY = source.maxY;
  target.maxHalo = source.maxHalo;
  return target;
}

function copySample(
  target: QuantizedDryBlendSample,
  source: QuantizedDryBlendSample,
): QuantizedDryBlendSample {
  target.x = source.x;
  target.y = source.y;
  target.timeMs = source.timeMs;
  return target;
}

function interpolateSample(
  target: QuantizedDryBlendSample,
  from: QuantizedDryBlendSample,
  to: QuantizedDryBlendSample,
  ratio: number,
): QuantizedDryBlendSample {
  target.x = f32(lerp(from.x, to.x, ratio));
  target.y = f32(lerp(from.y, to.y, ratio));
  target.timeMs = lerp(from.timeMs, to.timeMs, ratio);
  return target;
}

function setRect(
  target: BlendRect,
  x: number,
  y: number,
  width: number,
  height: number,
): BlendRect {
  target.x = x;
  target.y = y;
  target.width = width;
  target.height = height;
  return target;
}

function fillTileKeys(
  target: Uint32Array,
  rect: BlendRect,
  documentWidth: number,
  documentHeight: number,
  tileSize: number,
): number {
  if (rect.width <= 0 || rect.height <= 0) {
    return 0;
  }
  const tilesX = Math.ceil(documentWidth / tileSize);
  const tilesY = Math.ceil(documentHeight / tileSize);
  const x0 = Math.floor(rect.x / tileSize);
  const y0 = Math.floor(rect.y / tileSize);
  const x1 = Math.ceil((rect.x + rect.width) / tileSize);
  const y1 = Math.ceil((rect.y + rect.height) / tileSize);
  let count = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (x >= 0 && y >= 0 && x < tilesX && y < tilesY) {
        target[count] = y * tilesX + x;
        count += 1;
      }
    }
  }
  return count;
}

function sweepBounds(step: DryBlendStep): void {
  if (
    step.fromHalfWidth === step.toHalfWidth
    && step.fromHalfHeight === step.toHalfHeight
    && step.fromAngle === step.toAngle
  ) {
    // The current pressure-inert planner keeps size, aspect, and rotation
    // constant inside a step. The footprint extents are therefore constant
    // too, and the extrema of its linear center sweep are exactly at the two
    // endpoints. Keep the sampled path below for future variable transforms.
    const cosine = Math.abs(Math.cos(step.fromAngle));
    const sine = Math.abs(Math.sin(step.fromAngle));
    const extentX = cosine * step.fromHalfWidth + sine * step.fromHalfHeight + 2;
    const extentY = sine * step.fromHalfWidth + cosine * step.fromHalfHeight + 2;
    const fromCenterX = lerp(step.fromX, step.toX, 0);
    const fromCenterY = lerp(step.fromY, step.toY, 0);
    const toCenterX = lerp(step.fromX, step.toX, 1);
    const toCenterY = lerp(step.fromY, step.toY, 1);
    step.minX = Math.min(
      Math.floor(fromCenterX - extentX),
      Math.floor(toCenterX - extentX),
    );
    step.minY = Math.min(
      Math.floor(fromCenterY - extentY),
      Math.floor(toCenterY - extentY),
    );
    step.maxX = Math.max(
      Math.ceil(fromCenterX + extentX),
      Math.ceil(toCenterX + extentX),
    );
    step.maxY = Math.max(
      Math.ceil(fromCenterY + extentY),
      Math.ceil(toCenterY + extentY),
    );
    return;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  // These five samples only produce a conservative bbox while size/rotation
  // vary. GPU coverage will remain one continuous sweep.
  for (let index = 0; index < 5; index += 1) {
    const ratio = index * 0.25;
    const centerX = lerp(step.fromX, step.toX, ratio);
    const centerY = lerp(step.fromY, step.toY, ratio);
    const halfWidth = lerp(step.fromHalfWidth, step.toHalfWidth, ratio);
    const halfHeight = lerp(step.fromHalfHeight, step.toHalfHeight, ratio);
    const angle = lerp(step.fromAngle, step.toAngle, ratio);
    const cosine = Math.abs(Math.cos(angle));
    const sine = Math.abs(Math.sin(angle));
    const extentX = cosine * halfWidth + sine * halfHeight + 2;
    const extentY = sine * halfWidth + cosine * halfHeight + 2;
    minX = Math.min(minX, Math.floor(centerX - extentX));
    minY = Math.min(minY, Math.floor(centerY - extentY));
    maxX = Math.max(maxX, Math.ceil(centerX + extentX));
    maxY = Math.max(maxY, Math.ceil(centerY + extentY));
  }
  step.minX = minX;
  step.minY = minY;
  step.maxX = maxX;
  step.maxY = maxY;
}

function makeBatch(tileCount: number): DryBlendBatch {
  const writeRect = { x: 0, y: 0, width: 0, height: 0 };
  return {
    build: DRY_BLEND_CORE_BUILD,
    generation: 0,
    stepCount: 1,
    steps: [emptyStep()],
    empty: true,
    maxHalo: 0,
    readRect: { x: 0, y: 0, width: 0, height: 0 },
    writeRect,
    localWriteRect: { x: 0, y: 0, width: 0, height: 0 },
    clippedReadRect: { x: 0, y: 0, width: 0, height: 0 },
    dirtyRect: writeRect,
    readTiles: new Uint32Array(tileCount),
    writeTiles: new Uint32Array(tileCount),
    readTileCount: 0,
    writeTileCount: 0,
  };
}

function finalizeBatch(
  batch: DryBlendBatch,
  step: DryBlendStep,
  documentWidth: number,
  documentHeight: number,
  tileSize: number,
  scratchSize: number,
): void {
  const x0 = clamp(step.minX, 0, documentWidth);
  const y0 = clamp(step.minY, 0, documentHeight);
  const x1 = clamp(step.maxX, 0, documentWidth);
  const y1 = clamp(step.maxY, 0, documentHeight);
  const halo = step.maxHalo;
  setRect(batch.writeRect, x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0));
  setRect(
    batch.readRect,
    x0 - halo,
    y0 - halo,
    Math.max(0, x1 - x0) + halo * 2,
    Math.max(0, y1 - y0) + halo * 2,
  );
  if (batch.readRect.width > scratchSize || batch.readRect.height > scratchSize) {
    throw new RangeError(
      `Dry Blend segment ${batch.readRect.width}x${batch.readRect.height}`
      + ` exceeds scratch size ${scratchSize}`,
    );
  }
  setRect(
    batch.localWriteRect,
    halo,
    halo,
    batch.writeRect.width,
    batch.writeRect.height,
  );
  const clippedX0 = clamp(batch.readRect.x, 0, documentWidth);
  const clippedY0 = clamp(batch.readRect.y, 0, documentHeight);
  const clippedX1 = clamp(batch.readRect.x + batch.readRect.width, 0, documentWidth);
  const clippedY1 = clamp(batch.readRect.y + batch.readRect.height, 0, documentHeight);
  setRect(
    batch.clippedReadRect,
    clippedX0,
    clippedY0,
    Math.max(0, clippedX1 - clippedX0),
    Math.max(0, clippedY1 - clippedY0),
  );
  batch.writeTileCount = fillTileKeys(
    batch.writeTiles,
    batch.writeRect,
    documentWidth,
    documentHeight,
    tileSize,
  );
  batch.readTileCount = fillTileKeys(
    batch.readTiles,
    batch.clippedReadRect,
    documentWidth,
    documentHeight,
    tileSize,
  );
  batch.maxHalo = halo;
  batch.empty = batch.writeRect.width <= 0 || batch.writeRect.height <= 0;
  batch.dirtyRect = batch.writeRect;
}

export function createDryBlendPlanner(
  controlSource: Partial<DryBlendControls> = {},
  options: DryBlendPlannerOptions = {},
): DryBlendPlanner {
  let controls = normalizeDryBlendControls(controlSource);
  const documentWidth = positiveInteger(
    options.documentWidth ?? DRY_BLEND_DEFAULT_DOCUMENT_SIZE,
    "documentWidth",
  );
  const documentHeight = positiveInteger(
    options.documentHeight ?? DRY_BLEND_DEFAULT_DOCUMENT_SIZE,
    "documentHeight",
  );
  const tileSize = positiveInteger(
    options.tileSize ?? DRY_BLEND_DEFAULT_TILE_SIZE,
    "tileSize",
  );
  const scratchSize = positiveInteger(
    options.scratchSize ?? DRY_BLEND_DEFAULT_SCRATCH_SIZE,
    "scratchSize",
  );
  const maxSteps = positiveInteger(options.maxSteps ?? 8192, "maxSteps");
  const tileCount = Math.ceil(documentWidth / tileSize) * Math.ceil(documentHeight / tileSize);
  const ring = Array.from({ length: maxSteps }, emptyStep);
  const batch = makeBatch(tileCount);
  const lastPoint: QuantizedDryBlendSample = { x: 0, y: 0, timeMs: 0, pressure: 1 };
  const fromPoint: QuantizedDryBlendSample = { x: 0, y: 0, timeMs: 0, pressure: 1 };
  const toPoint: QuantizedDryBlendSample = { x: 0, y: 0, timeMs: 0, pressure: 1 };
  const fitProbe = emptyStep();
  let begun = false;
  let finished = false;
  let moved = false;
  let read = 0;
  let write = 0;
  let queued = 0;
  let generation = 0;
  let arc = 0;

  const capacity = (): DryBlendPlannerCapacity => ({
    steps: queued,
    stepFree: maxSteps - queued,
  });

  const accepted = (steps: number, stationary: boolean): DryBlendPushResult => ({
    accepted: true,
    steps,
    stationary,
    reason: null,
    requiredSteps: 0,
    capacity: null,
  });

  const rejected = (requiredSteps: number): DryBlendPushResult => ({
    accepted: false,
    steps: 0,
    stationary: false,
    reason: "capacity",
    requiredSteps,
    capacity: capacity(),
  });

  const discardPending = (): true => {
    begun = false;
    finished = false;
    moved = false;
    read = 0;
    write = 0;
    queued = 0;
    generation = 0;
    arc = 0;
    return true;
  };

  const configure = (
    nextControls: Partial<DryBlendControls> = {},
  ): Readonly<DryBlendControls> => {
    if (queued > 0) {
      throw new Error("Dry Blend configuration requires an empty queue");
    }
    controls = normalizeDryBlendControls(nextControls);
    discardPending();
    return controls;
  };

  const reset = (initialSample: DryBlendSample): QuantizedDryBlendSample => {
    discardPending();
    copySample(lastPoint, quantizeDryBlendSample(initialSample));
    begun = true;
    return { ...lastPoint };
  };

  const populateStep = (
    target: DryBlendStep,
    from: QuantizedDryBlendSample,
    to: QuantizedDryBlendSample,
    arcStart: number,
  ): void => {
    const deltaX = to.x - from.x;
    const deltaY = to.y - from.y;
    const distance = Math.hypot(deltaX, deltaY);
    const directionX = deltaX / distance;
    const directionY = deltaY / distance;
    // Pressure is deliberately absent from size and strength.
    const fromDiameter = controls.size;
    const toDiameter = controls.size;
    const diameter = controls.size;
    const directionAngle = Math.atan2(directionY, directionX);
    const angle = controls.angle + (controls.orientToStroke ? directionAngle : 0);
    const deltaSeconds = Math.max(0.001, (to.timeMs - from.timeMs) / 1000);
    const halfWidth = f32(fromDiameter * 0.5);
    const halfHeight = f32(fromDiameter * 0.5 * controls.aspect);
    const stepAngle = f32(angle);
    target.fromX = from.x;
    target.fromY = from.y;
    target.toX = to.x;
    target.toY = to.y;
    target.dirX = f32(directionX);
    target.dirY = f32(directionY);
    target.distance = f32(distance);
    target.fromDiameter = f32(fromDiameter);
    target.toDiameter = f32(toDiameter);
    target.diameter = f32(diameter);
    target.fromHalfWidth = halfWidth;
    target.fromHalfHeight = halfHeight;
    target.toHalfWidth = halfWidth;
    target.toHalfHeight = halfHeight;
    target.fromAngle = stepAngle;
    target.toAngle = stepAngle;
    target.angle = stepAngle;
    target.warpStrength = f32(controls.strength);
    target.flow = f32(controls.flow);
    target.spacing = f32(controls.spacing);
    target.arcStart = f32(arcStart);
    target.arcEnd = f32(arcStart + distance);
    target.speed = f32(distance / deltaSeconds);
    target.maxHalo = Math.ceil(distance * target.warpStrength)
      + 2
      + blendBlurReadSupportRadius(controls.blur, diameter);
    sweepBounds(target);
  };

  const stepFitsScratch = (step: DryBlendStep): boolean => {
    const x0 = clamp(step.minX, 0, documentWidth);
    const y0 = clamp(step.minY, 0, documentHeight);
    const x1 = clamp(step.maxX, 0, documentWidth);
    const y1 = clamp(step.maxY, 0, documentHeight);
    return x1 - x0 + step.maxHalo * 2 <= scratchSize
      && y1 - y0 + step.maxHalo * 2 <= scratchSize;
  };

  const emitStep = (
    from: QuantizedDryBlendSample,
    to: QuantizedDryBlendSample,
  ): void => {
    const target = ring[write];
    populateStep(target, from, to, arc);
    const distance = target.distance;
    arc += distance;
    write = (write + 1) % maxSteps;
    queued += 1;
    moved = true;
  };

  const pushSample = (sample: DryBlendSample): DryBlendPushResult => {
    if (!begun) {
      throw new Error("Blend dry planner is not initialized: call reset(down)");
    }
    if (finished) {
      throw new Error("The Dry Blend planner has already been finalized");
    }
    const next = quantizeDryBlendSample(sample);
    const deltaX = next.x - lastPoint.x;
    const deltaY = next.y - lastPoint.y;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance < POSITION_QUANTUM) {
      copySample(lastPoint, next);
      return accepted(0, true);
    }
    let count = Math.max(1, Math.ceil(distance / dryBlendReferenceStep(controls.size)));
    // A large, rotated tip can need a slightly shorter sweep than the regular
    // reference step once transport and Blur halos are included. Refine the
    // whole input interval before mutating the ring so every emitted ROI is
    // guaranteed to fit and capacity rejection remains atomic.
    copySample(fromPoint, lastPoint);
    interpolateSample(toPoint, lastPoint, next, Math.min(1, POSITION_QUANTUM / distance));
    populateStep(fitProbe, fromPoint, toPoint, arc);
    const tipCanFitScratch = stepFitsScratch(fitProbe);
    if (!tipCanFitScratch) {
      throw new RangeError(
        `Dry Blend tip cannot fit inside scratch size ${scratchSize}`,
      );
    }
    for (;;) {
      let allFit = true;
      copySample(fromPoint, lastPoint);
      for (let index = 1; index <= count; index += 1) {
        interpolateSample(toPoint, lastPoint, next, index / count);
        populateStep(fitProbe, fromPoint, toPoint, arc);
        if (!stepFitsScratch(fitProbe)) {
          allFit = false;
          break;
        }
        copySample(fromPoint, toPoint);
      }
      if (allFit) break;
      if (count > Math.floor(maxSteps / 2)) {
        count = maxSteps + 1;
        break;
      }
      count *= 2;
    }
    if (count > maxSteps - queued) {
      return rejected(count);
    }
    copySample(fromPoint, lastPoint);
    for (let index = 1; index <= count; index += 1) {
      interpolateSample(toPoint, lastPoint, next, index / count);
      emitStep(fromPoint, toPoint);
      copySample(fromPoint, toPoint);
    }
    copySample(lastPoint, next);
    return accepted(count, false);
  };

  const pushSamples = (samples: readonly DryBlendSample[]): DryBlendPushResult => {
    let steps = 0;
    for (const sample of samples) {
      const result = pushSample(sample);
      if (!result.accepted) {
        return { ...result, steps };
      }
      steps += result.steps;
    }
    return accepted(steps, false);
  };

  const finish = (): DryBlendPushResult => {
    if (!begun) {
      throw new Error("Blend dry planner is not initialized: call reset(down)");
    }
    if (finished) {
      return accepted(0, !moved);
    }
    finished = true;
    return accepted(0, !moved);
  };

  const buildNextBatch = (): DryBlendBatch | null => {
    if (queued === 0) {
      return null;
    }
    const source = ring[read];
    const target = batch.steps[0];
    copyStepInto(target, source);
    batch.generation = ++generation;
    finalizeBatch(
      batch,
      target,
      documentWidth,
      documentHeight,
      tileSize,
      scratchSize,
    );
    read = (read + 1) % maxSteps;
    queued -= 1;
    return batch;
  };

  const snapshotSteps = (): DryBlendStep[] => {
    const result: DryBlendStep[] = [];
    for (let index = 0; index < queued; index += 1) {
      result.push(copyStep(ring[(read + index) % maxSteps]));
    }
    return result;
  };

  const sampleMovesFromLast = (sample: DryBlendSample): boolean => {
    if (!begun) {
      return true;
    }
    const next = quantizeDryBlendSample(sample);
    return next.x !== lastPoint.x || next.y !== lastPoint.y;
  };

  const memoryLedger = () => {
    const stepBytes = maxSteps * Object.keys(emptyStep()).length * 8;
    const batchBytes = batch.readTiles.byteLength + batch.writeTiles.byteLength;
    return {
      stepCapacity: maxSteps,
      stepBytes,
      batchBytes,
      totalBytes: stepBytes + batchBytes,
    };
  };

  return {
    build: DRY_BLEND_CORE_BUILD,
    get controls() {
      return controls;
    },
    configure,
    reset,
    discardPending,
    pushSample,
    pushSamples,
    finish,
    buildNextBatch,
    snapshotSteps,
    capacity,
    sampleMovesFromLast,
    pendingSteps: () => queued,
    lastSample: () => (begun ? { ...lastPoint } : null),
    memoryLedger,
  };
}

export function resampleDryBlendStroke(
  rawSamples: readonly DryBlendSample[],
  controlSource: Partial<DryBlendControls> = {},
  options: DryBlendPlannerOptions = {},
): {
  build: typeof DRY_BLEND_CORE_BUILD;
  controls: Readonly<DryBlendControls>;
  samples: QuantizedDryBlendSample[];
  steps: DryBlendStep[];
} {
  if (!Array.isArray(rawSamples) || rawSamples.length === 0) {
    throw new TypeError("Dry Blend resampling requires samples");
  }
  const ordered = rawSamples
    .map((sample, index) => ({ sample: quantizeDryBlendSample(sample), index }))
    .sort((a, b) => a.sample.timeMs - b.sample.timeMs || a.index - b.index);
  const planner = createDryBlendPlanner(controlSource, {
    ...options,
    maxSteps: options.maxSteps ?? 65536,
  });
  planner.reset(ordered[0].sample);
  for (let index = 1; index < ordered.length; index += 1) {
    const result = planner.pushSample(ordered[index].sample);
    if (!result.accepted) {
      throw new RangeError("Insufficient Dry Blend capacity");
    }
  }
  planner.finish();
  return {
    build: DRY_BLEND_CORE_BUILD,
    controls: planner.controls,
    samples: ordered.map((item) => item.sample),
    steps: planner.snapshotSteps(),
  };
}
