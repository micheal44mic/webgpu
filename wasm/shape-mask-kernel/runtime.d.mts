export interface ScalarMaskPrepareOptions {
  readonly targetSize?: number;
  readonly invert?: boolean;
  readonly quantizeR8?: boolean;
  readonly emitBase?: boolean;
  readonly emitSupport?: boolean;
}

export interface ScalarMaskPrepareResult {
  readonly backend: "js" | "wasm";
  readonly scalar16: Uint16Array;
  readonly baseMask: Uint8Array | null;
  readonly supportMask: Uint8Array | null;
  readonly identity: number;
}

export interface ScalarMaskKernel {
  readonly backend: "wasm";
  memoryBytes(): number;
  prepare(
    source: Uint16Array,
    sourceWidth: number,
    sourceHeight: number,
    options?: ScalarMaskPrepareOptions,
  ): ScalarMaskPrepareResult;
}

export function prepareScalarMaskJs(
  source: Uint16Array,
  sourceWidth: number,
  sourceHeight: number,
  options?: ScalarMaskPrepareOptions,
): ScalarMaskPrepareResult;

export function instantiateScalarMaskKernel(
  moduleOrBytes: WebAssembly.Module | BufferSource,
): Promise<ScalarMaskKernel>;

export function createScalarMaskPreprocessor(options?: {
  readonly moduleOrBytes?: WebAssembly.Module | BufferSource;
  readonly url?: URL | string;
  readonly fetchImplementation?: typeof fetch;
}): Promise<ScalarMaskKernel | {
  readonly backend: "js";
  readonly initializationError: unknown;
  readonly prepare: typeof prepareScalarMaskJs;
}>;
