import type {
  StrokeGeometryProcessor,
  StrokeGeometrySession,
  StrokeGeometryStats,
  StrokeGeometryStreamingResult,
} from "../wasm/stroke-geometry-kernel/runtime.mjs";

export type StrokeGeometryActiveBackend = "javascript" | "wasm";

export type {
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

export function wasmStrokeGeometryReady(
  processor: StrokeGeometryProcessor | null,
): processor is StrokeGeometryProcessor & {
  readonly backend: "wasm";
  readonly begin: NonNullable<StrokeGeometryProcessor["begin"]>;
} {
  return processor?.backend === "wasm" && typeof processor.begin === "function";
}
