import { prepareScalarMaskJs } from "../wasm/shape-mask-kernel/runtime.mjs";
import {
  assertGrainPngPreprocessingInput,
  assertGrainScalarPreprocessingInput,
  isGrainPngPreprocessingInput,
  preprocessGrainPng,
  preprocessGrainScalar,
  type GrainPreprocessingRequest,
  type GrainPreprocessingResult,
} from "./grain-preprocessing-core";
import {
  GRAIN_PREPROCESSING_PROTOCOL_VERSION,
  type GrainPreprocessingWorkerPreparePngRequest,
  type GrainPreprocessingWorkerPrepareScalarRequest,
  type GrainPreprocessingWorkerRequest,
  type GrainPreprocessingWorkerResponse,
} from "./grain-preprocessing-worker-protocol";

export const GRAIN_PREPROCESSING_DEFAULT_IDLE_TERMINATION_MS = 15_000;
export const GRAIN_PREPROCESSING_DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export interface GrainPreprocessingClientOptions {
  readonly idleTerminationMs?: number;
  readonly requestTimeoutMs?: number;
  /** Test seam; production uses the lazy module Worker declared below. */
  readonly workerFactory?: () => Worker;
}

export interface GrainPreprocessingRequestOptions {
  readonly signal?: AbortSignal;
}

interface PendingRequest {
  readonly resolve: (result: GrainPreprocessingResult) => void;
  readonly reject: (error: Error) => void;
  readonly timer: number;
  readonly abortSignal: AbortSignal | null;
  readonly abortListener: (() => void) | null;
}

function normalizedDelay(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("Grain preprocessing timeout must be a non-negative number.");
  }
  return Math.floor(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function abortError(): DOMException {
  return new DOMException("Grain preprocessing was aborted.", "AbortError");
}

/** Lazy Worker owner with exact JavaScript fallback and idle memory reclamation. */
export class GrainPreprocessingClient {
  private readonly idleTerminationMs: number;
  private readonly requestTimeoutMs: number;
  private readonly workerFactory: () => Worker;
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private idleTimer = 0;
  private fallbackTail: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(options: GrainPreprocessingClientOptions = {}) {
    this.idleTerminationMs = normalizedDelay(
      options.idleTerminationMs,
      GRAIN_PREPROCESSING_DEFAULT_IDLE_TERMINATION_MS,
    );
    this.requestTimeoutMs = normalizedDelay(
      options.requestTimeoutMs,
      GRAIN_PREPROCESSING_DEFAULT_REQUEST_TIMEOUT_MS,
    );
    this.workerFactory = options.workerFactory ?? (() => new Worker(
      new URL("./grain-preprocessing-worker.ts", import.meta.url),
      { type: "module", name: "grain-preprocessing" },
    ));
  }

  async prepare(
    input: Readonly<GrainPreprocessingRequest>,
    options: GrainPreprocessingRequestOptions = {},
  ): Promise<GrainPreprocessingResult> {
    if (isGrainPngPreprocessingInput(input)) {
      assertGrainPngPreprocessingInput(input);
    } else {
      assertGrainScalarPreprocessingInput(input);
    }
    if (this.disposed) throw new Error("Grain preprocessing client is disposed.");
    if (options.signal?.aborted) throw abortError();
    try {
      return await this.prepareInWorker(input, options.signal ?? null);
    } catch (error) {
      if (this.disposed || options.signal?.aborted) throw error;
      return await this.enqueueFallback(
        input,
        errorMessage(error),
        options.signal ?? null,
      );
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopWorker(new Error("Grain preprocessing client was disposed."));
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    if (this.idleTimer !== 0) {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = 0;
    }
    const worker = this.workerFactory();
    worker.onmessage = (event: MessageEvent<GrainPreprocessingWorkerResponse>): void => {
      this.handleWorkerMessage(event.data);
    };
    worker.onerror = (event): void => {
      this.stopWorker(new Error(event.message || "Grain preprocessing worker stopped."));
    };
    worker.onmessageerror = (): void => {
      this.stopWorker(new Error("Grain preprocessing worker returned an invalid message."));
    };
    this.worker = worker;
    return worker;
  }

  private prepareInWorker(
    input: Readonly<GrainPreprocessingRequest>,
    signal: AbortSignal | null,
  ): Promise<GrainPreprocessingResult> {
    const worker = this.ensureWorker();
    if (this.idleTimer !== 0) {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = 0;
    }
    const requestId = this.nextRequestId++;
    const request: GrainPreprocessingWorkerPrepareScalarRequest
      | GrainPreprocessingWorkerPreparePngRequest = isGrainPngPreprocessingInput(input)
        ? {
            type: "prepare-png",
            requestId,
            pngBytes: input.pngBytes.slice(0),
            expectedWidth: input.expectedWidth,
            expectedHeight: input.expectedHeight,
            invertLuminance: input.invertLuminance === true,
          }
        : {
            type: "prepare-scalar",
            requestId,
            scalar16: input.scalar16.slice(),
            width: input.width,
            height: input.height,
            invertLuminance: input.invertLuminance === true,
            sourceBitDepth: input.sourceBitDepth ?? 16,
          };
    const transfer = request.type === "prepare-png"
      ? request.pngBytes
      : request.scalar16.buffer as ArrayBuffer;

    return new Promise<GrainPreprocessingResult>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.stopWorker(new Error(`Grain preprocessing request ${requestId} timed out.`));
      }, this.requestTimeoutMs);
      const abortListener = signal
        ? () => {
            const pending = this.takePending(requestId);
            if (!pending) return;
            const cancel: GrainPreprocessingWorkerRequest = { type: "cancel", requestId };
            this.worker?.postMessage(cancel);
            pending.reject(abortError());
            this.armIdleTermination();
          }
        : null;
      this.pending.set(requestId, {
        resolve,
        reject,
        timer,
        abortSignal: signal,
        abortListener,
      });
      signal?.addEventListener("abort", abortListener!, { once: true });
      try {
        worker.postMessage(request, [transfer]);
      } catch (error) {
        this.takePending(requestId)?.reject(
          error instanceof Error ? error : new Error(String(error)),
        );
        this.armIdleTermination();
      }
    });
  }

  private enqueueFallback(
    input: Readonly<GrainPreprocessingRequest>,
    failure: string,
    signal: AbortSignal | null,
  ): Promise<GrainPreprocessingResult> {
    const result = this.fallbackTail.then(async () => {
      if (this.disposed) throw new Error("Grain preprocessing client is disposed.");
      if (signal?.aborted) throw abortError();
      if (isGrainPngPreprocessingInput(input)) {
        return await preprocessGrainPng(
          { ...input, pngBytes: input.pngBytes.slice(0) },
          { backend: "js", prepare: prepareScalarMaskJs },
          failure,
        );
      }
      return preprocessGrainScalar(
        { ...input, scalar16: input.scalar16.slice() },
        { backend: "js", prepare: prepareScalarMaskJs },
        { acceleratorFailure: failure },
      );
    });
    this.fallbackTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private handleWorkerMessage(response: GrainPreprocessingWorkerResponse): void {
    if (response.type === "ready") {
      if (response.protocolVersion !== GRAIN_PREPROCESSING_PROTOCOL_VERSION) {
        this.stopWorker(new Error("Grain preprocessing worker protocol is incompatible."));
      }
      return;
    }
    const pending = this.takePending(response.requestId);
    if (!pending) return;
    if (response.type === "failed") {
      pending.reject(new Error(response.message));
    } else {
      pending.resolve({
        scalar16: response.scalar16,
        width: response.width,
        height: response.height,
        identity: response.identity,
        scalarIdentity: response.scalarIdentity,
        sourceBitDepth: response.sourceBitDepth,
        previewRgba: response.previewRgba,
        backend: response.backend,
        acceleratorFailure: response.acceleratorFailure,
        retainedWasmMemoryBytes: response.retainedWasmMemoryBytes,
        timings: response.timings,
      });
    }
    this.armIdleTermination();
  }

  private takePending(requestId: number): PendingRequest | null {
    const pending = this.pending.get(requestId);
    if (!pending) return null;
    this.pending.delete(requestId);
    window.clearTimeout(pending.timer);
    if (pending.abortSignal && pending.abortListener) {
      pending.abortSignal.removeEventListener("abort", pending.abortListener);
    }
    return pending;
  }

  private armIdleTermination(): void {
    if (this.disposed || this.pending.size > 0 || !this.worker) return;
    if (this.idleTimer !== 0) window.clearTimeout(this.idleTimer);
    if (this.idleTerminationMs === 0) {
      this.terminateIdleWorker();
      return;
    }
    this.idleTimer = window.setTimeout(
      () => this.terminateIdleWorker(),
      this.idleTerminationMs,
    );
  }

  private terminateIdleWorker(): void {
    this.idleTimer = 0;
    if (this.pending.size > 0) return;
    const worker = this.worker;
    this.worker = null;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    }
  }

  private stopWorker(error: Error): void {
    if (this.idleTimer !== 0) {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = 0;
    }
    const worker = this.worker;
    this.worker = null;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    }
    for (const requestId of [...this.pending.keys()]) {
      this.takePending(requestId)?.reject(error);
    }
  }
}
