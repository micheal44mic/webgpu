import type { StoredHistoryChunkV1 } from "./history-storage-core";

export type HistoryOpfsWorkerRequest =
  | { readonly type: "self-test"; readonly id: number }
  | {
      readonly type: "begin";
      readonly id: number;
      readonly writerId: string;
      readonly sessionId: string;
      readonly segmentId: string;
    }
  | {
      readonly type: "append";
      readonly id: number;
      readonly writerId: string;
      readonly bytes: ArrayBuffer;
    }
  | {
      readonly type: "finish";
      readonly id: number;
      readonly writerId: string;
      readonly footerJson: string;
    }
  | { readonly type: "abort"; readonly id: number; readonly writerId: string }
  | {
      readonly type: "verify";
      readonly id: number;
      readonly sessionId: string;
      readonly segmentId: string;
      readonly commitNonce: string;
      readonly descriptorSha256: string;
      readonly chunks: readonly Pick<
        StoredHistoryChunkV1,
        "fileOffset" | "storedBytes" | "storedSha256"
      >[];
    }
  | {
      readonly type: "read";
      readonly id: number;
      readonly sessionId: string;
      readonly segmentId: string;
      readonly offset: number;
      readonly length: number;
    }
  | {
      readonly type: "delete-segment";
      readonly id: number;
      readonly sessionId: string;
      readonly segmentId: string;
    }
  | { readonly type: "delete-session"; readonly id: number; readonly sessionId: string };

export type HistoryOpfsWorkerResponse =
  | { readonly type: "ok"; readonly id: number; readonly offset?: number }
  | { readonly type: "self-test"; readonly id: number; readonly supported: boolean; readonly reason: string | null }
  | { readonly type: "read"; readonly id: number; readonly bytes: ArrayBuffer }
  | {
      readonly type: "error";
      readonly id: number;
      readonly name: string;
      readonly message: string;
    };

interface PendingRequest {
  readonly resolve: (response: HistoryOpfsWorkerResponse) => void;
  readonly reject: (error: Error) => void;
  readonly timer: number;
}

export class HistoryOpfsClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private disposed = false;

  constructor() {
    this.worker = new Worker(
      new URL("./history-storage-opfs-worker.ts", import.meta.url),
      { type: "module", name: "history-opfs" },
    );
    this.worker.onmessage = (event: MessageEvent<HistoryOpfsWorkerResponse>) => {
      const response = event.data;
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      window.clearTimeout(pending.timer);
      if (response.type === "error") {
        const error = new Error(`OPFS History: ${response.message}`);
        error.name = response.name;
        pending.reject(error);
      } else pending.resolve(response);
    };
    this.worker.onerror = (event) => {
      this.fail(new Error(event.message || "The History OPFS worker terminated."));
    };
    this.worker.onmessageerror = () => {
      this.fail(new Error("Invalid response from the History OPFS worker."));
    };
  }

  async selfTest(): Promise<{ supported: boolean; reason: string | null }> {
    const response = await this.request({ type: "self-test", id: this.nextRequestId++ });
    if (response.type !== "self-test") throw new Error("Unexpected OPFS self-test response.");
    return { supported: response.supported, reason: response.reason };
  }

  async begin(sessionId: string, segmentId: string): Promise<string> {
    const writerId = crypto.randomUUID();
    await this.expectOk({
      type: "begin",
      id: this.nextRequestId++,
      writerId,
      sessionId,
      segmentId,
    });
    return writerId;
  }

  async append(writerId: string, bytes: ArrayBuffer): Promise<number> {
    const response = await this.expectOk({
      type: "append",
      id: this.nextRequestId++,
      writerId,
      bytes,
    }, [bytes]);
    if (!Number.isInteger(response.offset) || response.offset! < 0) {
      throw new Error("Invalid History OPFS append offset.");
    }
    return response.offset!;
  }

  async finish(writerId: string, footerJson: string): Promise<void> {
    await this.expectOk({
      type: "finish",
      id: this.nextRequestId++,
      writerId,
      footerJson,
    });
  }

  async abort(writerId: string): Promise<void> {
    await this.expectOk({ type: "abort", id: this.nextRequestId++, writerId });
  }

  async verify(options: {
    readonly sessionId: string;
    readonly segmentId: string;
    readonly commitNonce: string;
    readonly descriptorSha256: string;
    readonly chunks: readonly Pick<
      StoredHistoryChunkV1,
      "fileOffset" | "storedBytes" | "storedSha256"
    >[];
  }): Promise<void> {
    await this.expectOk({ type: "verify", id: this.nextRequestId++, ...options });
  }

  async read(
    sessionId: string,
    segmentId: string,
    offset: number,
    length: number,
  ): Promise<ArrayBuffer> {
    const response = await this.request({
      type: "read",
      id: this.nextRequestId++,
      sessionId,
      segmentId,
      offset,
      length,
    });
    if (response.type !== "read") throw new Error("Unexpected OPFS read response.");
    return response.bytes;
  }

  async deleteSegment(sessionId: string, segmentId: string): Promise<void> {
    await this.expectOk({
      type: "delete-segment",
      id: this.nextRequestId++,
      sessionId,
      segmentId,
    });
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.expectOk({
      type: "delete-session",
      id: this.nextRequestId++,
      sessionId,
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.fail(new Error("The History OPFS worker was closed."));
  }

  private async expectOk(
    request: HistoryOpfsWorkerRequest,
    transfer: Transferable[] = [],
  ): Promise<Extract<HistoryOpfsWorkerResponse, { type: "ok" }>> {
    const response = await this.request(request, transfer);
    if (response.type !== "ok") throw new Error("Unexpected History OPFS response.");
    return response;
  }

  private request(
    request: HistoryOpfsWorkerRequest,
    transfer: Transferable[] = [],
  ): Promise<HistoryOpfsWorkerResponse> {
    if (this.disposed) return Promise.reject(new Error("The History OPFS worker is unavailable."));
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(request.id);
        reject(new Error(`History OPFS request ${request.id} timed out.`));
      }, 60_000);
      this.pending.set(request.id, { resolve, reject, timer });
      try {
        this.worker.postMessage(request, transfer);
      } catch (error) {
        window.clearTimeout(timer);
        this.pending.delete(request.id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private fail(error: Error): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.terminate();
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
