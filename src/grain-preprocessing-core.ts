import { hashBytes } from "./engine-math";
import { decodeGrayscalePng, type GrayscalePngBitDepth } from "./png-mask";
import type {
  ScalarMaskPrepareOptions,
  ScalarMaskPrepareResult,
} from "../wasm/shape-mask-kernel/runtime.mjs";

export const GRAIN_PREPROCESSING_MAX_DIMENSION = 4096;

export type GrainPreprocessingBackend = "js" | "wasm";

export interface GrainScalarPreprocessingInput {
  readonly kind: "scalar";
  readonly scalar16: Uint16Array;
  readonly width: number;
  readonly height: number;
  /** Applies authored polarity before hashing, preview generation, and upload. */
  readonly invertLuminance?: boolean;
  readonly sourceBitDepth?: GrayscalePngBitDepth;
}

export interface GrainPngPreprocessingInput {
  readonly kind: "png";
  readonly pngBytes: ArrayBuffer;
  readonly expectedWidth: number;
  readonly expectedHeight: number;
  /** Applies authored polarity after decode without changing encoded-byte identity. */
  readonly invertLuminance?: boolean;
}

export type GrainPreprocessingRequest =
  | GrainScalarPreprocessingInput
  | GrainPngPreprocessingInput;

export interface GrainPreprocessingTimings {
  readonly decodeMs: number;
  readonly scalarMs: number;
  readonly previewMs: number;
  readonly totalMs: number;
}

export interface GrainPreprocessingResult {
  readonly scalar16: Uint16Array;
  readonly width: number;
  readonly height: number;
  /**
   * Cache identity matching the authored source contract. Scalar inputs hash
   * post-inversion samples; PNG inputs hash the original encoded bytes.
   */
  readonly identity: number;
  /** Hash of the post-inversion scalar samples for diagnostics and parity tests. */
  readonly scalarIdentity: number;
  readonly sourceBitDepth: GrayscalePngBitDepth;
  /** Full-resolution grayscale RGBA8 display proxy with opaque alpha. */
  readonly previewRgba: Uint8Array;
  readonly backend: GrainPreprocessingBackend;
  readonly acceleratorFailure: string | null;
  readonly retainedWasmMemoryBytes: number;
  readonly timings: GrainPreprocessingTimings;
}

export interface GrainScalarPreprocessor {
  readonly backend: GrainPreprocessingBackend;
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

function assertDimension(value: number, label: string): void {
  if (
    !Number.isSafeInteger(value)
    || value < 1
    || value > GRAIN_PREPROCESSING_MAX_DIMENSION
  ) {
    throw new RangeError(
      `${label} must be an integer between 1 and ${GRAIN_PREPROCESSING_MAX_DIMENSION}.`,
    );
  }
}

export function assertGrainScalarPreprocessingInput(
  input: Readonly<GrainScalarPreprocessingInput>,
): void {
  if (!(input.scalar16 instanceof Uint16Array)) {
    throw new TypeError("Grain preprocessing source must be a Uint16Array.");
  }
  assertDimension(input.width, "Grain width");
  assertDimension(input.height, "Grain height");
  if (input.scalar16.length !== input.width * input.height) {
    throw new RangeError("Grain sample count does not match its dimensions.");
  }
  if (
    input.sourceBitDepth !== undefined
    && input.sourceBitDepth !== 8
    && input.sourceBitDepth !== 16
  ) {
    throw new RangeError("Grain source bit depth must be 8 or 16.");
  }
}

export function assertGrainPngPreprocessingInput(
  input: Readonly<GrainPngPreprocessingInput>,
): void {
  if (!(input.pngBytes instanceof ArrayBuffer) || input.pngBytes.byteLength === 0) {
    throw new TypeError("Grain PNG source must be a non-empty ArrayBuffer.");
  }
  assertDimension(input.expectedWidth, "Expected Grain width");
  assertDimension(input.expectedHeight, "Expected Grain height");
}

export function grainPreviewRgbaFromScalar16(source: Uint16Array): Uint8Array {
  const previewRgba = new Uint8Array(source.length * 4);
  for (
    let sourceIndex = 0, targetIndex = 0;
    sourceIndex < source.length;
    sourceIndex += 1, targetIndex += 4
  ) {
    const value = Math.round(source[sourceIndex] / 257);
    previewRgba[targetIndex] = value;
    previewRgba[targetIndex + 1] = value;
    previewRgba[targetIndex + 2] = value;
    previewRgba[targetIndex + 3] = 255;
  }
  return previewRgba;
}

interface ScalarPipelineOptions {
  readonly encodedIdentity?: number;
  readonly decodeMs?: number;
  readonly acceleratorFailure?: string | null;
  readonly totalStartedAt?: number;
}

/** Pure synchronous scalar path, suitable for a Worker or deterministic fallback. */
export function preprocessGrainScalar(
  input: Readonly<GrainScalarPreprocessingInput>,
  scalarPreprocessor: GrainScalarPreprocessor,
  options: Readonly<ScalarPipelineOptions> = {},
): GrainPreprocessingResult {
  assertGrainScalarPreprocessingInput(input);
  const totalStartedAt = options.totalStartedAt ?? performance.now();
  const scalarStartedAt = performance.now();
  const prepared = scalarPreprocessor.prepare(
    input.scalar16,
    input.width,
    input.height,
    {
      targetSize: 1,
      invert: input.invertLuminance === true,
      emitBase: false,
      emitSupport: false,
    },
  );
  const scalarMs = performance.now() - scalarStartedAt;

  const previewStartedAt = performance.now();
  const previewRgba = grainPreviewRgbaFromScalar16(prepared.scalar16);
  const previewMs = performance.now() - previewStartedAt;
  const decodeMs = options.decodeMs ?? 0;
  const initializationFailure = scalarPreprocessor.initializationError === undefined
    ? null
    : errorMessage(scalarPreprocessor.initializationError);

  return {
    scalar16: prepared.scalar16,
    width: input.width,
    height: input.height,
    identity: (options.encodedIdentity ?? prepared.identity) >>> 0,
    scalarIdentity: prepared.identity >>> 0,
    sourceBitDepth: input.sourceBitDepth ?? 16,
    previewRgba,
    backend: prepared.backend,
    acceleratorFailure: options.acceleratorFailure ?? initializationFailure,
    retainedWasmMemoryBytes: scalarPreprocessor.memoryBytes?.() ?? 0,
    timings: {
      decodeMs,
      scalarMs,
      previewMs,
      totalMs: performance.now() - totalStartedAt,
    },
  };
}

/** Decode and validate a built-in PNG before running the shared scalar path. */
export async function preprocessGrainPng(
  input: Readonly<GrainPngPreprocessingInput>,
  scalarPreprocessor: GrainScalarPreprocessor,
  acceleratorFailure?: string | null,
): Promise<GrainPreprocessingResult> {
  assertGrainPngPreprocessingInput(input);
  const totalStartedAt = performance.now();
  const encodedIdentity = hashBytes(new Uint8Array(input.pngBytes));
  const decodeStartedAt = performance.now();
  const decoded = await decodeGrayscalePng(input.pngBytes);
  const decodeMs = performance.now() - decodeStartedAt;
  if (
    decoded.width !== input.expectedWidth
    || decoded.height !== input.expectedHeight
  ) {
    throw new Error(
      `Grain PNG must remain ${input.expectedWidth}×${input.expectedHeight}px; `
      + `found ${decoded.width}×${decoded.height}px.`,
    );
  }
  return preprocessGrainScalar(
    {
      kind: "scalar",
      scalar16: decoded.pixels,
      width: decoded.width,
      height: decoded.height,
      invertLuminance: input.invertLuminance,
      sourceBitDepth: decoded.sourceBitDepth,
    },
    scalarPreprocessor,
    {
      encodedIdentity,
      decodeMs,
      acceleratorFailure,
      totalStartedAt,
    },
  );
}

export function isGrainPngPreprocessingInput(
  input: Readonly<GrainPreprocessingRequest>,
): input is Readonly<GrainPngPreprocessingInput> {
  return input.kind === "png";
}
