import {
  SHAPE_MASK_FILTER_GUARD_TEXELS,
  SHAPE_MASK_SIZE,
  SHAPE_OCCUPANCY_MAX_MIP,
} from "./engine-limits";
import {
  buildBrushMaskOutline,
  type BrushMaskOutline,
} from "./brush-outline-core";
import {
  downsampleShapeMask2x,
  downsampleShapeMaskSupport2x,
  resampleShapeMaskSupportIntoTransparentGuard,
} from "./shape-mask-filtering";
import { buildShapeOccupancyMaps } from "./shape-occupancy";
import type {
  ScalarMaskPrepareOptions,
  ScalarMaskPrepareResult,
} from "../wasm/shape-mask-kernel/runtime.mjs";

export type ShapePreprocessingBackend = "js" | "wasm";
export type ShapePreprocessingMaskFormat = "r8unorm" | "r16float";
export const SHAPE_PREPROCESSING_MAX_SOURCE_DIMENSION = 4096;

export interface ShapePreprocessingInput {
  readonly source: Uint16Array;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  /** True only when the decoded polarity differs from the requested polarity. */
  readonly invert: boolean;
  readonly maskFormat: ShapePreprocessingMaskFormat;
}

export interface ShapePngPreprocessingInput {
  readonly pngBytes: ArrayBuffer;
  readonly expectedWidth: number;
  readonly expectedHeight: number;
  /** True only when the decoded polarity differs from the requested polarity. */
  readonly invert: boolean;
  readonly maskFormat: ShapePreprocessingMaskFormat;
}

export type ShapePreprocessingRequest =
  | ShapePreprocessingInput
  | ShapePngPreprocessingInput;

export interface ShapePreprocessingTimings {
  readonly decodeMs: number;
  readonly scalarMs: number;
  readonly outlineMs: number;
  readonly mipMs: number;
  readonly occupancyMs: number;
  readonly totalMs: number;
}

export interface ShapePreprocessingResult {
  readonly scalar16: Uint16Array;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  /** Format-discriminated identity, ready for the Shape resource cache. */
  readonly identity: number;
  readonly sourceIdentity: number;
  readonly outline: BrushMaskOutline;
  readonly previewMask: Uint8Array;
  readonly previewSize: number;
  readonly occupancyWords: Uint32Array;
  readonly occupancyActiveCells: Uint32Array;
  readonly occupancyCoverageRatios: Float32Array;
  readonly backend: ShapePreprocessingBackend;
  readonly acceleratorFailure: string | null;
  readonly retainedWasmMemoryBytes: number;
  readonly timings: ShapePreprocessingTimings;
}

export interface ShapeScalarMaskPreprocessor {
  readonly backend: ShapePreprocessingBackend;
  readonly initializationError?: unknown;
  memoryBytes?(): number;
  prepare(
    source: Uint16Array,
    sourceWidth: number,
    sourceHeight: number,
    options?: ScalarMaskPrepareOptions,
  ): ScalarMaskPrepareResult;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function assertShapePreprocessingInput(
  input: Readonly<ShapePreprocessingInput>,
): void {
  if (!(input.source instanceof Uint16Array)) {
    throw new TypeError("Shape preprocessing source must be a Uint16Array.");
  }
  if (
    !Number.isSafeInteger(input.sourceWidth)
    || !Number.isSafeInteger(input.sourceHeight)
    || input.sourceWidth < 1
    || input.sourceHeight < 1
    || input.sourceWidth > SHAPE_PREPROCESSING_MAX_SOURCE_DIMENSION
    || input.sourceHeight > SHAPE_PREPROCESSING_MAX_SOURCE_DIMENSION
  ) {
    throw new RangeError("Shape preprocessing source dimensions are invalid.");
  }
  if (input.source.length !== input.sourceWidth * input.sourceHeight) {
    throw new RangeError("Shape preprocessing sample count does not match its dimensions.");
  }
  if (input.maskFormat !== "r8unorm" && input.maskFormat !== "r16float") {
    throw new TypeError("Shape preprocessing mask format is invalid.");
  }
}

export function assertShapePngPreprocessingInput(
  input: Readonly<ShapePngPreprocessingInput>,
): void {
  if (!(input.pngBytes instanceof ArrayBuffer) || input.pngBytes.byteLength === 0) {
    throw new TypeError("Shape PNG preprocessing source must be a non-empty ArrayBuffer.");
  }
  if (
    !Number.isSafeInteger(input.expectedWidth)
    || !Number.isSafeInteger(input.expectedHeight)
    || input.expectedWidth < 1
    || input.expectedHeight < 1
    || input.expectedWidth > SHAPE_PREPROCESSING_MAX_SOURCE_DIMENSION
    || input.expectedHeight > SHAPE_PREPROCESSING_MAX_SOURCE_DIMENSION
  ) {
    throw new RangeError("Shape PNG preprocessing dimensions are invalid.");
  }
  if (input.maskFormat !== "r8unorm" && input.maskFormat !== "r16float") {
    throw new TypeError("Shape preprocessing mask format is invalid.");
  }
}

export function isShapePngPreprocessingInput(
  input: Readonly<ShapePreprocessingRequest>,
): input is Readonly<ShapePngPreprocessingInput> {
  return "pngBytes" in input;
}

/** Pure synchronous pipeline, safe to execute in a Worker or as a last-resort fallback. */
export function preprocessShapeMask(
  input: Readonly<ShapePreprocessingInput>,
  scalarPreprocessor: ShapeScalarMaskPreprocessor,
  acceleratorFailure: string | null = scalarPreprocessor.initializationError === undefined
    ? null
    : errorMessage(scalarPreprocessor.initializationError),
  decodeMs = 0,
): ShapePreprocessingResult {
  assertShapePreprocessingInput(input);
  const totalStartedAt = performance.now();
  const scalarStartedAt = performance.now();
  const scalar = scalarPreprocessor.prepare(
    input.source,
    input.sourceWidth,
    input.sourceHeight,
    {
      targetSize: SHAPE_MASK_SIZE,
      invert: input.invert,
      quantizeR8: input.maskFormat === "r8unorm",
      emitBase: true,
      emitSupport: true,
    },
  );
  const scalarMs = performance.now() - scalarStartedAt;
  if (!scalar.baseMask || !scalar.supportMask) {
    throw new Error("Shape scalar preprocessing omitted required derivatives.");
  }

  const outlineStartedAt = performance.now();
  const outline = buildBrushMaskOutline(
    scalar.baseMask,
    SHAPE_MASK_SIZE,
    SHAPE_MASK_SIZE,
  );
  const outlineMs = performance.now() - outlineStartedAt;

  const mipStartedAt = performance.now();
  let previewLevelMask = scalar.baseMask;
  let occupancyLevelMask = resampleShapeMaskSupportIntoTransparentGuard(
    scalar.supportMask,
    SHAPE_MASK_SIZE,
    SHAPE_MASK_FILTER_GUARD_TEXELS,
  );
  const occupancyMipMasks: Uint8Array[] = [occupancyLevelMask];
  let levelSize = SHAPE_MASK_SIZE;
  for (let mipLevel = 1; mipLevel <= SHAPE_OCCUPANCY_MAX_MIP; mipLevel += 1) {
    previewLevelMask = downsampleShapeMask2x(previewLevelMask, levelSize);
    occupancyLevelMask = downsampleShapeMaskSupport2x(occupancyLevelMask, levelSize);
    levelSize /= 2;
    occupancyMipMasks.push(occupancyLevelMask);
  }
  const mipMs = performance.now() - mipStartedAt;

  const occupancyStartedAt = performance.now();
  const occupancy = buildShapeOccupancyMaps(
    occupancyMipMasks,
    { coordinateFrame: "protected" },
  );
  const occupancyMs = performance.now() - occupancyStartedAt;
  const sourceIdentity = scalar.identity >>> 0;
  const identity = input.maskFormat === "r16float"
    ? Math.imul(sourceIdentity ^ 0x16f016f0, 0x01000193) >>> 0
    : sourceIdentity;

  return {
    scalar16: scalar.scalar16,
    sourceWidth: input.sourceWidth,
    sourceHeight: input.sourceHeight,
    identity,
    sourceIdentity,
    outline,
    previewMask: previewLevelMask,
    previewSize: levelSize,
    occupancyWords: occupancy.words,
    occupancyActiveCells: Uint32Array.from(occupancy.activeCells),
    occupancyCoverageRatios: Float32Array.from(occupancy.coverageRatios),
    backend: scalar.backend,
    acceleratorFailure,
    retainedWasmMemoryBytes: scalarPreprocessor.memoryBytes?.() ?? 0,
    timings: {
      decodeMs,
      scalarMs,
      outlineMs,
      mipMs,
      occupancyMs,
      totalMs: decodeMs + performance.now() - totalStartedAt,
    },
  };
}
