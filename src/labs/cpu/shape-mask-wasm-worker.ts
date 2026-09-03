import wasmUrl from "../../../wasm/shape-mask-kernel/dist/shape_mask_kernel.wasm?url";
import {
  instantiateScalarMaskKernel,
  prepareScalarMaskJs,
  type ScalarMaskKernel,
} from "../../../wasm/shape-mask-kernel/runtime.mjs";
import type {
  ShapeMaskBenchmarkRequest,
  ShapeMaskBenchmarkResponse,
} from "./shape-mask-wasm-protocol";

interface LoadedKernel {
  readonly kernel: ScalarMaskKernel;
  readonly initializationMs: number;
}

let kernelPromise: Promise<LoadedKernel> | null = null;

async function loadKernel(): Promise<LoadedKernel> {
  if (kernelPromise) return kernelPromise;
  kernelPromise = (async () => {
    const startedAt = performance.now();
    const response = await fetch(wasmUrl);
    if (!response.ok) {
      throw new Error(`Shape mask Wasm fetch failed (${response.status}).`);
    }
    const kernel = await instantiateScalarMaskKernel(await response.arrayBuffer());
    return {
      kernel,
      initializationMs: performance.now() - startedAt,
    };
  })();
  return kernelPromise;
}

function ownedBuffer(view: Uint8Array | Uint16Array): ArrayBuffer {
  return view.buffer instanceof ArrayBuffer
      && view.byteOffset === 0
      && view.byteLength === view.buffer.byteLength
    ? view.buffer
    : view.slice().buffer as ArrayBuffer;
}

self.onmessage = (event: MessageEvent<ShapeMaskBenchmarkRequest>): void => {
  const request = event.data;
  void (async () => {
    const source = new Uint16Array(request.source);
    let initializationMs = 0;
    let wasmMemoryBytes = 0;
    const startedAt = performance.now();
    const prepared = request.backend === "wasm"
      ? await (async () => {
          const loaded = await loadKernel();
          initializationMs = loaded.initializationMs;
          const result = loaded.kernel.prepare(
            source,
            request.sourceWidth,
            request.sourceHeight,
            {
              targetSize: request.targetSize,
              invert: request.invert,
              quantizeR8: request.quantizeR8,
            },
          );
          wasmMemoryBytes = loaded.kernel.memoryBytes();
          return result;
        })()
      : prepareScalarMaskJs(
          source,
          request.sourceWidth,
          request.sourceHeight,
          {
            targetSize: request.targetSize,
            invert: request.invert,
            quantizeR8: request.quantizeR8,
          },
        );
    const computeMs = performance.now() - startedAt;
    if (!prepared.baseMask || !prepared.supportMask) {
      throw new Error("Shape mask benchmark did not produce both derivatives.");
    }
    const scalar16 = ownedBuffer(prepared.scalar16);
    const baseMask = ownedBuffer(prepared.baseMask);
    const supportMask = ownedBuffer(prepared.supportMask);
    const response: ShapeMaskBenchmarkResponse = {
      type: "prepared",
      id: request.id,
      backend: request.backend,
      scalar16,
      baseMask,
      supportMask,
      identity: prepared.identity,
      computeMs,
      initializationMs,
      wasmMemoryBytes,
    };
    self.postMessage(response, {
      transfer: [scalar16, baseMask, supportMask],
    });
  })().catch((error) => {
    const response: ShapeMaskBenchmarkResponse = {
      type: "failed",
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  });
};

export {};
