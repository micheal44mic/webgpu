import type {
  PackedStrokeGeometrySession,
  PackedStrokeGeometryStreamingResult,
  PackedStrokeStampResult,
  StrokeGeometryProcessor,
  StrokeGeometrySession,
  StrokeGeometryStats,
  StrokeGeometryStreamingResult,
} from "../wasm/stroke-geometry-kernel/runtime.mjs";

export type StrokeGeometryActiveBackend = "javascript" | "wasm" | "wasm-packed";

export type {
  PackedStrokeGeometrySession,
  PackedStrokeGeometryStreamingResult,
  PackedStrokeStampResult,
  StrokeGeometryProcessor,
  StrokeGeometrySession,
  StrokeGeometryStats,
  StrokeGeometryStreamingResult,
};

/**
 * Keeps the optional WebAssembly module out of the first editor bundle. The
 * engine starts this load after its critical startup work and fixes the chosen
 * implementation only when the next gesture begins.
 */
export async function loadStrokeGeometryProcessor(): Promise<StrokeGeometryProcessor> {
  const { createStrokeGeometryProcessor } = await import(
    "../wasm/stroke-geometry-kernel/runtime.mjs"
  );
  return createStrokeGeometryProcessor();
}

/**
 * Loads the packed WebAssembly contract without substituting the JavaScript
 * implementation. Callers use this for paths whose queue and history payload
 * are already native GPU records.
 */
export async function loadRequiredPackedStrokeGeometryProcessor(): Promise<
  StrokeGeometryProcessor & {
    readonly backend: "wasm";
    readonly beginPacked: NonNullable<StrokeGeometryProcessor["beginPacked"]>;
  }
> {
  const { createRequiredStrokeGeometryProcessor } = await import(
    "../wasm/stroke-geometry-kernel/runtime.mjs"
  );
  return createRequiredStrokeGeometryProcessor();
}

export function wasmStrokeGeometryReady(
  processor: StrokeGeometryProcessor | null,
): processor is StrokeGeometryProcessor & {
  readonly backend: "wasm";
  readonly begin: NonNullable<StrokeGeometryProcessor["begin"]>;
} {
  return processor?.backend === "wasm" && typeof processor.begin === "function";
}

export function wasmPackedStrokeGeometryReady(
  processor: StrokeGeometryProcessor | null,
): processor is StrokeGeometryProcessor & {
  readonly backend: "wasm";
  readonly beginPacked: NonNullable<StrokeGeometryProcessor["beginPacked"]>;
} {
  return processor?.backend === "wasm" && typeof processor.beginPacked === "function";
}
