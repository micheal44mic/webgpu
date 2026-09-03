export type ShapeMaskBenchmarkBackend = "js" | "wasm";

export interface ShapeMaskBenchmarkRequest {
  readonly type: "prepare";
  readonly id: number;
  readonly backend: ShapeMaskBenchmarkBackend;
  readonly source: ArrayBuffer;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly targetSize: number;
  readonly invert: boolean;
  readonly quantizeR8: boolean;
}

export interface ShapeMaskBenchmarkSuccess {
  readonly type: "prepared";
  readonly id: number;
  readonly backend: ShapeMaskBenchmarkBackend;
  readonly scalar16: ArrayBuffer;
  readonly baseMask: ArrayBuffer;
  readonly supportMask: ArrayBuffer;
  readonly identity: number;
  readonly computeMs: number;
  readonly initializationMs: number;
  readonly wasmMemoryBytes: number;
}

export interface ShapeMaskBenchmarkFailure {
  readonly type: "failed";
  readonly id: number;
  readonly message: string;
}

export type ShapeMaskBenchmarkResponse =
  | ShapeMaskBenchmarkSuccess
  | ShapeMaskBenchmarkFailure;
