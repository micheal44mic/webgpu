import wasmUrl from "../wasm/shape-mask-kernel/dist/shape_mask_kernel.wasm?url";
import { createScalarMaskPreprocessor } from "../wasm/shape-mask-kernel/runtime.mjs";
import {
  preprocessGrainPng,
  preprocessGrainScalar,
} from "./grain-preprocessing-core";
import {
  GRAIN_PREPROCESSING_PROTOCOL_VERSION,
  type GrainPreprocessingWorkerPreparedResponse,
  type GrainPreprocessingWorkerRequest,
  type GrainPreprocessingWorkerResponse,
} from "./grain-preprocessing-worker-protocol";

const cancelled = new Set<number>();
const active = new Set<number>();
let queue = Promise.resolve();

const preprocessorPromise = createScalarMaskPreprocessor({ url: wasmUrl });

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

void preprocessorPromise.then((preprocessor) => {
  const initializationError = "initializationError" in preprocessor
    ? preprocessor.initializationError
    : null;
  const response: GrainPreprocessingWorkerResponse = {
    type: "ready",
    protocolVersion: GRAIN_PREPROCESSING_PROTOCOL_VERSION,
    backend: preprocessor.backend,
    acceleratorFailure: initializationError === null
      ? null
      : errorMessage(initializationError),
  };
  self.postMessage(response);
});

async function handlePrepare(
  request: Exclude<GrainPreprocessingWorkerRequest, { type: "cancel" }>,
): Promise<void> {
  try {
    if (cancelled.has(request.requestId)) return;
    const preprocessor = await preprocessorPromise;
    if (cancelled.has(request.requestId)) return;
    const result = request.type === "prepare-png"
      ? await preprocessGrainPng(
          {
            kind: "png",
            pngBytes: request.pngBytes,
            expectedWidth: request.expectedWidth,
            expectedHeight: request.expectedHeight,
            invertLuminance: request.invertLuminance,
          },
          preprocessor,
        )
      : preprocessGrainScalar(
          {
            kind: "scalar",
            scalar16: request.scalar16,
            width: request.width,
            height: request.height,
            invertLuminance: request.invertLuminance,
            sourceBitDepth: request.sourceBitDepth,
          },
          preprocessor,
        );
    if (cancelled.has(request.requestId)) return;
    const response: GrainPreprocessingWorkerPreparedResponse = {
      type: "prepared",
      requestId: request.requestId,
      ...result,
    };
    const transfer = new Set<ArrayBuffer>();
    if (response.scalar16.buffer instanceof ArrayBuffer) {
      transfer.add(response.scalar16.buffer);
    }
    if (response.previewRgba.buffer instanceof ArrayBuffer) {
      transfer.add(response.previewRgba.buffer);
    }
    self.postMessage(response, { transfer: [...transfer] });
  } catch (error) {
    if (cancelled.has(request.requestId)) return;
    const response: GrainPreprocessingWorkerResponse = {
      type: "failed",
      requestId: request.requestId,
      message: errorMessage(error),
    };
    self.postMessage(response);
  } finally {
    cancelled.delete(request.requestId);
    active.delete(request.requestId);
  }
}

self.onmessage = (event: MessageEvent<GrainPreprocessingWorkerRequest>): void => {
  const request = event.data;
  if (request.type === "cancel") {
    if (active.has(request.requestId)) cancelled.add(request.requestId);
    return;
  }
  active.add(request.requestId);
  queue = queue.then(
    () => handlePrepare(request),
    () => handlePrepare(request),
  );
};

self.onmessageerror = (): void => {
  throw new Error("Grain preprocessing worker received an invalid message.");
};

export {};
