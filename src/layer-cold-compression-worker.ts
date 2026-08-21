import {
  compressLosslessGzipChunk,
  gunzipBytes,
  hashCompressionBytes,
  unshuffle16,
} from "./layer-compression-codec";
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
    : "gzip CompressionStream is unavailable in the Web Worker.",
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
    throw new Error("gzip CompressionStream is unavailable in the Web Worker.");
  }
  if (request.type === "compress") {
    const result = await compressLosslessGzipChunk(
      new Uint8Array(request.bytes),
      request.tileByteLength,
      request.bytesPerComponent ?? 1,
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
  // Il tag descrive la trasformazione applicata, quindi l'inverso si sceglie
  // dal payload e non da cosa il chiamante crede di aver mandato.
  const restored = request.storage === "gzip-shuffle16"
    ? unshuffle16(await gunzipBytes(stored))
    : request.storage === "gzip"
    ? await gunzipBytes(stored)
    : stored;
  if (restored.byteLength !== request.expectedRawBytes) {
    throw new Error(
      `Decompressed ${restored.byteLength} bytes; expected ${request.expectedRawBytes}.`,
    );
  }
  const hash = hashCompressionBytes(restored);
  if (hash !== request.expectedHash) {
    throw new Error(
      `Decompression hash ${hash.toString(16)} differs from `
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
