import {
  compressLosslessGzipChunk,
  gunzipBytes,
  hashCompressionBytes,
} from "./layer-compression-study";
import type {
  LayerColdCompressionWorkerRequest,
  LayerColdCompressionWorkerResponse,
} from "./layer-cold-compression-client";

type WorkerScope = {
  onmessage: ((event: MessageEvent<LayerColdCompressionWorkerRequest>) => void) | null;
  postMessage(message: LayerColdCompressionWorkerResponse, transfer?: Transferable[]): void;
};

const workerScope = self as unknown as WorkerScope;
const compressionSupported =
  typeof CompressionStream === "function"
  && typeof DecompressionStream === "function";

workerScope.postMessage({
  type: "ready",
  supported: compressionSupported,
  reason: compressionSupported
    ? undefined
    : "CompressionStream gzip non disponibile nel Web Worker.",
});

workerScope.onmessage = (event): void => {
  const request = event.data;
  void handleRequest(request).catch((error) => {
    workerScope.postMessage({
      type: "error",
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
    });
  });
};

async function handleRequest(
  request: LayerColdCompressionWorkerRequest,
): Promise<void> {
  if (!compressionSupported) {
    throw new Error("CompressionStream gzip non disponibile nel Web Worker.");
  }
  if (request.type === "compress") {
    const result = await compressLosslessGzipChunk(
      new Uint8Array(request.bytes),
      request.tileByteLength,
    );
    const output = result.bytes.buffer instanceof ArrayBuffer
        && result.bytes.byteOffset === 0
        && result.bytes.byteLength === result.bytes.buffer.byteLength
      ? result.bytes.buffer
      : result.bytes.slice().buffer as ArrayBuffer;
    workerScope.postMessage({
      type: "compressed",
      id: request.id,
      storage: result.storage,
      bytes: output,
      measurement: result.measurement,
    }, [output]);
    return;
  }

  const stored = new Uint8Array(request.bytes);
  const restored = request.storage === "gzip"
    ? await gunzipBytes(stored)
    : stored;
  if (restored.byteLength !== request.expectedRawBytes) {
    throw new Error(
      `Decompressione di ${restored.byteLength} byte; attesi ${request.expectedRawBytes}.`,
    );
  }
  const hash = hashCompressionBytes(restored);
  if (hash !== request.expectedHash) {
    throw new Error(
      `Hash decompressione ${hash.toString(16)} diverso da `
      + `${request.expectedHash.toString(16)}.`,
    );
  }
  const output = restored.buffer instanceof ArrayBuffer
      && restored.byteOffset === 0
      && restored.byteLength === restored.buffer.byteLength
    ? restored.buffer
    : restored.slice().buffer as ArrayBuffer;
  workerScope.postMessage({
    type: "decompressed",
    id: request.id,
    bytes: output,
    hash,
  }, [output]);
}

export {};
