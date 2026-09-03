export interface StrokeGeometrySample {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly timeMs: number;
}

export interface StrokeGeometryOptions {
  readonly stabilization?: number;
  readonly spacingMode?: "fixed" | "direct-pressure";
  readonly spacing?: number;
  readonly size?: number;
  readonly batchSize?: number;
  readonly dabCapacity?: number;
  readonly maximumStampsPerSegment?: number;
}

export interface StrokeGeometryStats {
  readonly totalDabs: number;
  readonly maturePoints: number;
  readonly forcedMaturePoints: number;
  readonly tailPoints: number;
  readonly maximumTailPoints: number;
  readonly curveInputSegments: number;
  readonly curveFlattenedSegments: number;
  readonly curveSmoothedSegments: number;
  readonly curveSharpCornerBypasses: number;
  readonly spacingCarry: number;
  readonly latestSequence: number;
  readonly stabilizationTimeConstantMs: number;
}

export interface StrokeGeometryResult {
  readonly backend: "js" | "wasm";
  /** Interleaved x, y, pressure, timeMs, directionX and directionY. */
  readonly dabs: Float64Array;
  /** Interleaved stabilized, raw, filtered and weight tail lanes. */
  readonly tail: Float64Array;
  readonly stats: StrokeGeometryStats;
  readonly memoryBytes?: number;
}

export interface StrokeGeometryStreamingResult extends StrokeGeometryResult {
  /** Revisionable tail dabs generated from a cloned planner state. */
  readonly previewDabs: Float64Array;
}

export interface StrokeGeometrySession {
  readonly backend: "js" | "wasm";
  readonly initialDab: Float64Array;
  /**
   * Changes fixed spacing without consuming an input sample. The optional
   * return value is the revisionable tail rebuilt from the unchanged state.
   */
  updateFixedSpacing(
    spacing: number,
    options?: { readonly includePreviewTail?: boolean },
  ): Float64Array;
  processBatch(
    samples: readonly StrokeGeometrySample[],
    options?: {
      readonly includePreviewTail?: boolean;
      /** Skip copying the revisionable tail out of Wasm memory. */
      readonly includeTail?: boolean;
      /** New fixed spacing; existing spatial carry is deliberately preserved. */
      readonly spacing?: number;
    },
  ): StrokeGeometryStreamingResult;
  finish(): StrokeGeometryStreamingResult;
  cancel(): void;
}

export interface StrokeGeometryProcessor {
  readonly backend: "js" | "wasm";
  readonly initializationError?: unknown;
  readonly memoryBytes?: () => number;
  readonly begin: (
    first: StrokeGeometrySample,
    options?: StrokeGeometryOptions & { readonly maximumBatchSize?: number },
  ) => StrokeGeometrySession;
  processStroke(
    samples: readonly StrokeGeometrySample[],
    options?: StrokeGeometryOptions,
  ): StrokeGeometryResult;
}

export function processStrokeGeometryJs(
  samples: readonly StrokeGeometrySample[],
  options?: StrokeGeometryOptions,
): StrokeGeometryResult;

export function beginStrokeGeometryJs(
  first: StrokeGeometrySample,
  options?: StrokeGeometryOptions & { readonly maximumBatchSize?: number },
): StrokeGeometrySession;

export function instantiateStrokeGeometryKernel(
  moduleOrBytes: WebAssembly.Module | BufferSource,
): Promise<StrokeGeometryProcessor>;

export function createStrokeGeometryProcessor(options?: {
  readonly moduleOrBytes?: WebAssembly.Module | BufferSource;
  readonly url?: URL | string;
  readonly fetchImplementation?: typeof fetch;
}): Promise<StrokeGeometryProcessor>;
