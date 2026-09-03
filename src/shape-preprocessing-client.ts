import { prepareScalarMaskJs } from "../wasm/shape-mask-kernel/runtime.mjs";
import {
  assertShapePngPreprocessingInput,
  assertShapePreprocessingInput,
  isShapePngPreprocessingInput,
  preprocessShapeMask,
  type ShapePreprocessingRequest,
  type ShapePreprocessingResult,
} from "./shape-preprocessing-core";
import { decodeGrayscalePng } from "./png-mask";
import {
  SHAPE_PREPROCESSING_PROTOCOL_VERSION,
  type ShapePreprocessingWorkerPrepareRequest,
  type ShapePreprocessingWorkerPreparePngRequest,
  type ShapePreprocessingWorkerRequest,
  type ShapePreprocessingWorkerResponse,
} from "./shape-preprocessing-worker-protocol";

export const SHAPE_PREPROCESSING_DEFAULT_IDLE_TERMINATION_MS = 15_000;
export const SHAPE_PREPROCESSING_DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export interface ShapePreprocessingClientOptions {
  readonly idleTerminationMs?: number;
  readonly requestTimeoutMs?: number;
  /** Test seam; production uses the module Worker declared below. */
  readonly workerFactory?: () => Worker;
}

export interface ShapePreprocessingRequestOptions {
  readonly signal?: AbortSignal;
}

interface PendingRequest {
  readonly resolve: (result: ShapePreprocessingResult) => void;
  readonly reject: (error: Error) => void;
  readonly timer: number;
  readonly abortSignal: AbortSignal | null;
  readonly abortListener: (() => void) | null;
}

function normalizedDelay(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("Shape preprocessing timeout must be a non-negative number.");
  }
  return Math.floor(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function abortError(): DOMException {
  return new DOMException("Shape preprocessing was aborted.", "AbortError");
}

/** Lazy Worker owner with deterministic in-thread fallback and idle reclamation. */
export class ShapePreprocessingClient {
  private readonly idleTerminationMs: number;
  private readonly requestTimeoutMs: number;
  private readonly workerFactory: () => Worker;
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private idleTimer = 0;
  private disposed = false;

  constructor(options: ShapePreprocessingClientOptions = {}) {
    this.idleTerminationMs = normalizedDelay(
      options.idleTerminationMs,
      SHAPE_PREPROCESSING_DEFAULT_IDLE_TERMINATION_MS,
    );
    this.requestTimeoutMs = normalizedDelay(
      options.requestTimeoutMs,
      SHAPE_PREPROCESSING_DEFAULT_REQUEST_TIMEOUT_MS,
    );
    this.workerFactory = options.workerFactory ?? (() => new Worker(
      new URL("./shape-preprocessing-worker.ts", import.meta.url),
      { type: "module", name: "shape-preprocessing" },
    ));
  }

  async prepare(
    input: Readonly<ShapePreprocessingRequest>,
    options: ShapePreprocessingRequestOptions = {},
  ): Promise<ShapePreprocessingResult> {
    if (isShapePngPreprocessingInput(input)) {
      assertShapePngPreprocessingInput(input);
    } else {
      assertShapePreprocessingInput(input);
    }
    if (this.disposed) throw new Error("Shape preprocessing client is disposed.");
    if (options.signal?.aborted) throw abortError();
    try {
      return await this.prepareInWorker(input, options.signal ?? null);
    } catch (error) {
      if (this.disposed || options.signal?.aborted) throw error;
      return await this.prepareFallback(input, errorMessage(error));
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopWorker(new Error("Shape preprocessing client was disposed."));
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    if (this.idleTimer !== 0) {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = 0;
    }
    const worker = this.workerFactory();
    worker.onmessage = (event: MessageEvent<ShapePreprocessingWorkerResponse>): void => {
      this.handleWorkerMessage(event.data);
    };
    worker.onerror = (event): void => {
      this.stopWorker(new Error(event.message || "Shape preprocessing worker stopped."));
    };
    worker.onmessageerror = (): void => {
      this.stopWorker(new Error("Shape preprocessing worker returned an invalid message."));
    };
    this.worker = worker;
    return worker;
  }

  private prepareInWorker(
    input: Readonly<ShapePreprocessingRequest>,
    signal: AbortSignal | null,
  ): Promise<ShapePreprocessingResult> {
    const worker = this.ensureWorker();
    if (this.idleTimer !== 0) {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = 0;
    }
    const requestId = this.nextRequestId++;
    // Preserve the caller-owned decoded source so a Worker crash can still
    // complete through the exact JavaScript implementation.
    const request: ShapePreprocessingWorkerPrepareRequest
      | ShapePreprocessingWorkerPreparePngRequest = isShapePngPreprocessingInput(input)
        ? {
            type: "prepare-png",
            requestId,
            pngBytes: input.pngBytes.slice(0),
            expectedWidth: input.expectedWidth,
            expectedHeight: input.expectedHeight,
            invert: input.invert,
            maskFormat: input.maskFormat,
          }
        : {
            type: "prepare",
            requestId,
            source: input.source.slice(),
            sourceWidth: input.sourceWidth,
            sourceHeight: input.sourceHeight,
            invert: input.invert,
            maskFormat: input.maskFormat,
          };
    const transfer = request.type === "prepare-png"
      ? request.pngBytes
      : request.source.buffer as ArrayBuffer;
    return new Promise<ShapePreprocessingResult>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.stopWorker(new Error(`Shape preprocessing request ${requestId} timed out.`));
      }, this.requestTimeoutMs);
      const abortListener = signal
        ? () => {
            const pending = this.takePending(requestId);
            if (!pending) return;
            const cancel: ShapePreprocessingWorkerRequest = { type: "cancel", requestId };
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
        const pending = this.takePending(requestId);
        pending?.reject(error instanceof Error ? error : new Error(String(error)));
        this.armIdleTermination();
      }
    });
  }

  private async prepareFallback(
    input: Readonly<ShapePreprocessingRequest>,
    failure: string,
  ): Promise<ShapePreprocessingResult> {
    if (!isShapePngPreprocessingInput(input)) {
      return preprocessShapeMask(
        input,
        { backend: "js", prepare: prepareScalarMaskJs },
        failure,
      );
    }
    const decodeStartedAt = performance.now();
    const decoded = await decodeGrayscalePng(input.pngBytes.slice(0));
    const decodeMs = performance.now() - decodeStartedAt;
    if (
      decoded.width !== input.expectedWidth
      || decoded.height !== input.expectedHeight
    ) {
      throw new Error(
        `Shape PNG must remain ${input.expectedWidth}×${input.expectedHeight}px; `
        + `found ${decoded.width}×${decoded.height}px.`,
      );
    }
    return preprocessShapeMask(
      {
        source: decoded.pixels,
        sourceWidth: decoded.width,
        sourceHeight: decoded.height,
        invert: input.invert,
        maskFormat: input.maskFormat,
      },
      { backend: "js", prepare: prepareScalarMaskJs },
      failure,
      decodeMs,
    );
  }

  private handleWorkerMessage(response: ShapePreprocessingWorkerResponse): void {
    if (response.type === "ready") {
      if (response.protocolVersion !== SHAPE_PREPROCESSING_PROTOCOL_VERSION) {
        this.stopWorker(new Error("Shape preprocessing worker protocol is incompatible."));
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
        sourceWidth: response.sourceWidth,
        sourceHeight: response.sourceHeight,
        identity: response.identity,
        sourceIdentity: response.sourceIdentity,
        outline: response.outline,
        previewMask: response.previewMask,
        previewSize: response.previewSize,
        occupancyWords: response.occupancyWords,
        occupancyActiveCells: response.occupancyActiveCells,
        occupancyCoverageRatios: response.occupancyCoverageRatios,
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
