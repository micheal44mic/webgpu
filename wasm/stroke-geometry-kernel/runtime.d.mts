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

export interface StrokeStampPackOptions {
  readonly size: number;
  readonly positionJitterLinear?: number;
  readonly positionJitterLateral?: number;
  readonly shapeExtentFactor?: number;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly reflectionCosineDoubleAngle?: number;
  readonly reflectionSineDoubleAngle?: number;
  readonly seedSequence?: number;
  readonly stampOrdinal?: number;
  readonly radiusMode?: "fixed" | "direct-pressure";
  readonly shapeSequenceMode?: "ordered" | "random";
  readonly shapeLayerCount?: number;
  readonly symmetryEnabled?: boolean;
  readonly startThickness?: number;
  readonly endThickness?: number;
  readonly startedAtMs?: number;
  /** Skip the aggregate copy when the caller uploads packedChunks directly. */
  readonly flattenPackedStamps?: boolean;
}

export interface PackedStrokeStampResult {
  readonly backend: "wasm-packed";
  /** Exact x/y/radius/pressure/seed/shape-layer/direction GPU records. */
  readonly packedStamps: Uint8Array;
  readonly packedChunks: readonly Readonly<{
    packedStamps: Uint8Array;
    stampCount: number;
    firstSeed: number | null;
    dirtyRect: Readonly<{ x: number; y: number; width: number; height: number }> | null;
    minimumRadius: number;
    culledDabCount: number;
  }>[];
  readonly stampCount: number;
  readonly firstSeed: number | null;
  readonly dirtyRect: Readonly<{
    x: number;
    y: number;
    width: number;
    height: number;
  }> | null;
  readonly minimumRadius: number;
  readonly nextSeedSequence: number;
  readonly nextStampOrdinal: number;
  readonly culledDabCount: number;
  /** Newly generated dabs whose seed and ordinal were consumed by this result. */
  readonly consumedDabCount: number;
  readonly generatedHeldDabCount: number;
  readonly releasedHeldDabCount: number;
  readonly releasedHeldAtLiftDabCount: number;
  readonly remainingHeldDabCount: number;
  readonly maximumHeldDabCount: number;
  readonly packComputeMs: number;
}

export interface PackedStrokeGeometryStreamingResult extends PackedStrokeStampResult {
  readonly tail: Float64Array;
  readonly previewPackedStamps: PackedStrokeStampResult;
  readonly stats: StrokeGeometryStats;
}

export interface PackedStrokeGeometrySession {
  readonly backend: "wasm-packed";
  readonly initialDab: Float64Array;
  readonly initialPackedStamps: PackedStrokeStampResult;
  readonly initialPreviewPackedStamps: PackedStrokeStampResult;
  updateFixedSpacing(
    spacing: number,
    options?: { readonly includePreviewTail?: boolean },
  ): PackedStrokeStampResult;
  processBatch(
    samples: readonly StrokeGeometrySample[],
    options?: {
      readonly includePreviewTail?: boolean;
      readonly includeTail?: boolean;
      readonly spacing?: number;
    },
  ): PackedStrokeGeometryStreamingResult;
  refreshThickness(referenceTimeMs?: number): Readonly<{
    releasedPackedStamps: PackedStrokeStampResult;
    previewPackedStamps: PackedStrokeStampResult;
  }>;
  finish(options?: { readonly referenceTimeMs?: number }): PackedStrokeGeometryStreamingResult;
  cancel(): void;
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
  readonly beginPacked?: (
    first: StrokeGeometrySample,
    options: StrokeGeometryOptions & { readonly maximumBatchSize?: number },
    packedOptions: StrokeStampPackOptions,
  ) => PackedStrokeGeometrySession;
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

export function createRequiredStrokeGeometryProcessor(options?: {
  readonly moduleOrBytes?: WebAssembly.Module | BufferSource;
  readonly url?: URL | string;
  readonly fetchImplementation?: typeof fetch;
}): Promise<StrokeGeometryProcessor & {
  readonly backend: "wasm";
  readonly beginPacked: NonNullable<StrokeGeometryProcessor["beginPacked"]>;
}>;
