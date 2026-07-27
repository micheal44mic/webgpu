import type {
  LayerCompressionChunkMeasurement,
  LayerCompressionStorage,
} from "./layer-compression-study";

export const LAYER_COLD_COMPRESSION_RUNTIME_BUILD =
  "worker-gzip-multi-distant-layers-adjacent-raw-v3" as const;
export const LAYER_COLD_COMPRESSION_IDLE_DELAY_MS = 1500 as const;
export const LAYER_COLD_COMPRESSION_MINIMUM_DISTANCE = 2 as const;

export interface LayerColdCompressedChunk {
  storage: LayerCompressionStorage;
  bytes: ArrayBuffer;
  rawBytes: number;
  storedBytes: number;
  sourceHash: number;
}

export type LayerColdCompressionWorkerRequest =
  | {
    type: "compress";
    id: number;
    bytes: ArrayBuffer;
    tileByteLength: number;
  }
  | {
    type: "decompress";
    id: number;
    storage: LayerCompressionStorage;
    bytes: ArrayBuffer;
    expectedRawBytes: number;
    expectedHash: number;
  };

export type LayerColdCompressionWorkerResponse =
  | {
    type: "ready";
    supported: boolean;
    reason?: string;
  }
  | {
    type: "compressed";
    id: number;
    storage: LayerCompressionStorage;
    bytes: ArrayBuffer;
    measurement: LayerCompressionChunkMeasurement;
  }
  | {
    type: "decompressed";
    id: number;
    bytes: ArrayBuffer;
    hash: number;
  }
  | {
    type: "error";
    id: number;
    message: string;
  };

type PendingRequest = {
  resolve: (response: LayerColdCompressionWorkerResponse) => void;
  reject: (error: Error) => void;
  timer: number;
};

function transferableBuffer(bytes: Uint8Array): ArrayBuffer {
  if (
    bytes.buffer instanceof ArrayBuffer
    && bytes.byteOffset === 0
    && bytes.byteLength === bytes.buffer.byteLength
  ) {
    return bytes.buffer;
  }
  return bytes.slice().buffer as ArrayBuffer;
}

export class LayerColdCompressionClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private readySettled = false;
  private readonly readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;
  private readonly readyTimer: number;
  private disposed = false;

  constructor() {
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.worker = new Worker(
      new URL("./layer-cold-compression-worker.ts", import.meta.url),
      { type: "module", name: "layer-cold-compression" },
    );
    this.worker.onmessage = (event: MessageEvent<LayerColdCompressionWorkerResponse>) => {
      this.handleMessage(event.data);
    };
    this.worker.onerror = (event) => {
      this.fail(new Error(event.message || "Worker compressione livelli non disponibile."));
    };
    this.worker.onmessageerror = () => {
      this.fail(new Error("Risposta non valida dal worker compressione livelli."));
    };
    this.readyTimer = window.setTimeout(() => {
      this.fail(new Error("Timeout inizializzazione worker compressione livelli."));
    }, 5_000);
  }

  async ready(): Promise<void> {
    return this.readyPromise;
  }

  async compress(
    bytes: Uint8Array,
    tileByteLength: number,
  ): Promise<{
    chunk: LayerColdCompressedChunk;
    measurement: LayerCompressionChunkMeasurement;
  }> {
    const buffer = transferableBuffer(bytes);
    const response = await this.request({
      type: "compress",
      id: this.nextRequestId++,
      bytes: buffer,
      tileByteLength,
    }, [buffer]);
    if (response.type !== "compressed") {
      throw new Error("Risposta compressione inattesa.");
    }
    return {
      chunk: {
        storage: response.storage,
        bytes: response.bytes,
        rawBytes: response.measurement.rawBytes,
        storedBytes: response.bytes.byteLength,
        sourceHash: response.measurement.sourceHash,
      },
      measurement: response.measurement,
    };
  }

  async decompress(chunk: LayerColdCompressedChunk): Promise<Uint8Array> {
    // Never transfer the authoritative stored buffer. If the worker fails after
    // taking ownership, the layer must still be recoverable for a retry.
    const workerCopy = chunk.bytes.slice(0);
    const response = await this.request({
      type: "decompress",
      id: this.nextRequestId++,
      storage: chunk.storage,
      bytes: workerCopy,
      expectedRawBytes: chunk.rawBytes,
      expectedHash: chunk.sourceHash,
    }, [workerCopy]);
    if (response.type !== "decompressed") {
      throw new Error("Risposta decompressione inattesa.");
    }
    return new Uint8Array(response.bytes);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.fail(new Error("Worker compressione livelli terminato."));
  }

  private async request(
    message: LayerColdCompressionWorkerRequest,
    transfer: Transferable[],
  ): Promise<LayerColdCompressionWorkerResponse> {
    await this.readyPromise;
    if (this.disposed) {
      throw new Error("Worker compressione livelli non disponibile.");
    }
    return new Promise<LayerColdCompressionWorkerResponse>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(message.id);
        reject(new Error(`Timeout worker compressione richiesta ${message.id}.`));
      }, 30_000);
      this.pending.set(message.id, { resolve, reject, timer });
      try {
        this.worker.postMessage(message, transfer);
      } catch (error) {
        window.clearTimeout(timer);
        this.pending.delete(message.id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private handleMessage(response: LayerColdCompressionWorkerResponse): void {
    if (response.type === "ready") {
      if (this.readySettled) {
        return;
      }
      this.readySettled = true;
      window.clearTimeout(this.readyTimer);
      if (response.supported) {
        this.resolveReady();
      } else {
        const error = new Error(
          response.reason || "CompressionStream non disponibile nel worker.",
        );
        this.rejectReady(error);
        this.worker.terminate();
        this.disposed = true;
      }
      return;
    }
    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }
    this.pending.delete(response.id);
    window.clearTimeout(pending.timer);
    if (response.type === "error") {
      pending.reject(new Error(response.message));
    } else {
      pending.resolve(response);
    }
  }

  private fail(error: Error): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    window.clearTimeout(this.readyTimer);
    this.worker.terminate();
    if (!this.readySettled) {
      this.readySettled = true;
      this.rejectReady(error);
    }
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
