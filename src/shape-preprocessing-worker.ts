import wasmUrl from "../wasm/shape-mask-kernel/dist/shape_mask_kernel.wasm?url";
import { createScalarMaskPreprocessor } from "../wasm/shape-mask-kernel/runtime.mjs";
import { decodeGrayscalePng } from "./png-mask";
import {
  assertShapePngPreprocessingInput,
  preprocessShapeMask,
} from "./shape-preprocessing-core";
import {
  SHAPE_PREPROCESSING_PROTOCOL_VERSION,
  workerPngRequestInput,
  workerRequestInput,
  type ShapePreprocessingWorkerPreparedResponse,
  type ShapePreprocessingWorkerRequest,
  type ShapePreprocessingWorkerResponse,
} from "./shape-preprocessing-worker-protocol";

const cancelled = new Set<number>();
let queue = Promise.resolve();

const preprocessorPromise = createScalarMaskPreprocessor({ url: wasmUrl });

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function transferableBuffers(
  response: ShapePreprocessingWorkerPreparedResponse,
): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  const add = (view: ArrayBufferView): void => {
    if (view.buffer instanceof ArrayBuffer) buffers.add(view.buffer);
  };
  add(response.scalar16);
  add(response.previewMask);
  add(response.occupancyWords);
  add(response.occupancyActiveCells);
  add(response.occupancyCoverageRatios);
  add(response.outline.boundingHull);
  response.outline.paths.forEach(add);
  return [...buffers];
}

void preprocessorPromise.then((preprocessor) => {
  const initializationError = "initializationError" in preprocessor
    ? preprocessor.initializationError
    : null;
  const response: ShapePreprocessingWorkerResponse = {
    type: "ready",
    protocolVersion: SHAPE_PREPROCESSING_PROTOCOL_VERSION,
    backend: preprocessor.backend,
    acceleratorFailure: initializationError === null
      ? null
      : errorMessage(initializationError),
  };
  self.postMessage(response);
});

async function handlePrepare(
  request: Exclude<ShapePreprocessingWorkerRequest, { type: "cancel" }>,
): Promise<void> {
  if (cancelled.delete(request.requestId)) return;
  try {
    let decodeMs = 0;
    const input = request.type === "prepare-png"
      ? await (async () => {
          const pngInput = workerPngRequestInput(request);
          assertShapePngPreprocessingInput(pngInput);
          const decodeStartedAt = performance.now();
          const decoded = await decodeGrayscalePng(pngInput.pngBytes);
          decodeMs = performance.now() - decodeStartedAt;
          if (
            decoded.width !== pngInput.expectedWidth
            || decoded.height !== pngInput.expectedHeight
          ) {
            throw new Error(
              `Shape PNG must remain ${pngInput.expectedWidth}×${pngInput.expectedHeight}px; `
              + `found ${decoded.width}×${decoded.height}px.`,
            );
          }
          return {
            source: decoded.pixels,
            sourceWidth: decoded.width,
            sourceHeight: decoded.height,
            invert: pngInput.invert,
            maskFormat: pngInput.maskFormat,
          };
        })()
      : workerRequestInput(request);
    const preprocessor = await preprocessorPromise;
    if (cancelled.delete(request.requestId)) return;
    const result = preprocessShapeMask(input, preprocessor, undefined, decodeMs);
    if (cancelled.delete(request.requestId)) return;
    const response: ShapePreprocessingWorkerPreparedResponse = {
      type: "prepared",
      requestId: request.requestId,
      ...result,
    };
    self.postMessage(response, { transfer: transferableBuffers(response) });
  } catch (error) {
    if (cancelled.delete(request.requestId)) return;
    const response: ShapePreprocessingWorkerResponse = {
      type: "failed",
      requestId: request.requestId,
      message: errorMessage(error),
    };
    self.postMessage(response);
  }
}

self.onmessage = (event: MessageEvent<ShapePreprocessingWorkerRequest>): void => {
  const request = event.data;
  if (request.type === "cancel") {
    cancelled.add(request.requestId);
    return;
  }
  queue = queue.then(
    () => handlePrepare(request),
    () => handlePrepare(request),
  );
};

self.onmessageerror = (): void => {
  // A malformed structured clone cannot be associated reliably with a request.
  // Throwing makes the client reject every pending job and use its preserved
  // source for the deterministic JavaScript fallback.
  throw new Error("Shape preprocessing worker received an invalid message.");
};

export {};
