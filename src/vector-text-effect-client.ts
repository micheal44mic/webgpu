import type { Shadow3dPathData } from "./vector-shadow-3d.js";
import type {
  VectorTextEffectDescription,
  VectorTextGpuMeshData,
} from "./vector-text-effect-geometry";
import type {
  VectorTextEffectWorkerRequest,
  VectorTextEffectWorkerResponse,
} from "./vector-text-effect-worker-protocol";
import {
  VECTOR_TEXT_GEOMETRY_COMPILER_VERSION,
  vectorTextFloat64Key,
  type VectorTextLod,
} from "./vector-text-lod";

interface PendingEffect {
  readonly cacheKey: string;
  readonly effectIdentity: string;
  readonly sourceRevision: string;
  readonly lodBucket: number;
}

interface ReadyEffect extends PendingEffect {
  readonly mesh: VectorTextGpuMeshData | null;
}

interface DisplayedEffect extends ReadyEffect {
  readonly slotKey: string;
}

interface QueuedEffect extends PendingEffect {
  readonly lod: VectorTextLod;
  readonly effect: VectorTextEffectDescription;
}

export interface VectorTextEffectClientDiagnostics {
  readonly registeredPaths: number;
  readonly pendingJobs: number;
  readonly readyJobs: number;
  readonly displayedSlots: number;
  readonly failedJobs: number;
  readonly lastError: string | null;
}

function effectIdentity(
  sourceRevision: string,
  effect: VectorTextEffectDescription,
): string {
  if (effect.kind === "source-outline") {
    return [
      VECTOR_TEXT_GEOMETRY_COMPILER_VERSION,
      sourceRevision,
      effect.kind,
      vectorTextFloat64Key(effect.width),
      effect.join,
      "miter-limit-4",
    ].join(":");
  }
  const vectorX = vectorTextFloat64Key(effect.vectorX);
  const vectorY = vectorTextFloat64Key(effect.vectorY);
  if (effect.kind === "block") {
    return [
      VECTOR_TEXT_GEOMETRY_COMPILER_VERSION,
      sourceRevision,
      effect.kind,
      vectorX,
      vectorY,
    ].join(":");
  }
  return [
    VECTOR_TEXT_GEOMETRY_COMPILER_VERSION,
    sourceRevision,
    effect.kind,
    vectorX,
    vectorY,
    vectorTextFloat64Key(effect.width),
    effect.join,
    "miter-limit-4",
  ].join(":");
}

function cacheKey(
  identity: string,
  lod: VectorTextLod,
): string {
  return [
    identity,
    `lod-${lod.bucket}`,
    `fixed-${lod.integerScale}`,
  ].join(":");
}

export class VectorTextEffectCompilerClient {
  private readonly worker = new Worker(
    new URL("./vector-text-effect-worker.ts", import.meta.url),
    { type: "module", name: "vector-text-effect-compiler" },
  );
  private readonly registeredPaths = new Set<string>();
  private readonly pendingByRequest = new Map<number, PendingEffect>();
  private readonly pendingKeys = new Set<string>();
  private readonly queuedByIdentity = new Map<string, QueuedEffect>();
  private readonly readyByKey = new Map<string, ReadyEffect>();
  private readonly displayedBySlot = new Map<string, DisplayedEffect>();
  private activeRequestId: number | null = null;
  private nextRequestId = 1;
  private failedJobs = 0;
  private lastError: string | null = null;

  constructor(private readonly onResourceReady: () => void) {
    this.worker.onmessage = (
      event: MessageEvent<VectorTextEffectWorkerResponse>,
    ): void => {
      this.acceptWorkerResponse(event.data);
    };
    this.worker.onerror = (event): void => {
      this.failedJobs += 1;
      this.lastError = event.message || "Worker geometria testo interrotto.";
      this.onResourceReady();
    };
  }

  meshForSlot(
    slotKey: string,
    sourceRevision: string,
    path: Shadow3dPathData,
    lod: VectorTextLod,
    effect: VectorTextEffectDescription,
    allowAtomicSwap: boolean,
  ): VectorTextGpuMeshData | null {
    const identity = effectIdentity(sourceRevision, effect);
    const key = cacheKey(identity, lod);
    this.registerPath(sourceRevision, path);

    const displayed = this.displayedBySlot.get(slotKey);
    if (displayed && displayed.sourceRevision !== sourceRevision) {
      this.displayedBySlot.delete(slotKey);
    }
    const current = this.displayedBySlot.get(slotKey);
    const currentAlreadyFiner =
      current?.effectIdentity === identity
      && current.lodBucket >= lod.bucket;
    if (!currentAlreadyFiner) {
      this.requestEffect(key, identity, sourceRevision, lod, effect);
    }
    if (!allowAtomicSwap) {
      return current?.mesh ?? null;
    }

    const ready = this.readyByKey.get(key);
    if (
      ready
      && (
        !current
        || current.effectIdentity !== identity
        || ready.lodBucket >= current.lodBucket
      )
    ) {
      this.displayedBySlot.set(slotKey, { ...ready, slotKey });
      this.pruneReadyLods(identity, ready.lodBucket);
      return ready.mesh;
    }
    return current?.mesh ?? null;
  }

  clearSlot(slotKey: string): void {
    this.displayedBySlot.delete(slotKey);
  }

  retainSlots(liveSlots: ReadonlySet<string>): void {
    for (const slot of this.displayedBySlot.keys()) {
      if (!liveSlots.has(slot)) {
        this.displayedBySlot.delete(slot);
      }
    }
  }

  diagnostics(): VectorTextEffectClientDiagnostics {
    return {
      registeredPaths: this.registeredPaths.size,
      pendingJobs: this.pendingByRequest.size + this.queuedByIdentity.size,
      readyJobs: this.readyByKey.size,
      displayedSlots: this.displayedBySlot.size,
      failedJobs: this.failedJobs,
      lastError: this.lastError,
    };
  }

  private registerPath(
    revision: string,
    path: Shadow3dPathData,
  ): void {
    if (this.registeredPaths.has(revision)) {
      return;
    }
    const verbs = new Uint8Array(path.verbs);
    const coords = new Float64Array(path.coords);
    const contourOffsets = new Uint32Array(path.contourOffsets);
    const message: VectorTextEffectWorkerRequest = {
      type: "register-path",
      revision,
      path: {
        fillRule: Number(path.fillRule),
        verbs,
        coords,
        contourOffsets,
      },
    };
    this.worker.postMessage(message, [
      verbs.buffer,
      coords.buffer,
      contourOffsets.buffer,
    ]);
    this.registeredPaths.add(revision);
  }

  private requestEffect(
    key: string,
    identity: string,
    sourceRevision: string,
    lod: VectorTextLod,
    effect: VectorTextEffectDescription,
  ): void {
    if (this.readyByKey.has(key) || this.pendingKeys.has(key)) {
      return;
    }
    const queued: QueuedEffect = {
      cacheKey: key,
      effectIdentity: identity,
      sourceRevision,
      lodBucket: lod.bucket,
      lod,
      effect,
    };
    const superseded = this.queuedByIdentity.get(identity);
    if (superseded) {
      this.pendingKeys.delete(superseded.cacheKey);
    }
    this.queuedByIdentity.set(identity, queued);
    this.pendingKeys.add(key);
    this.pumpQueue();
  }

  private pumpQueue(): void {
    if (this.activeRequestId !== null) {
      return;
    }
    const next = this.queuedByIdentity.entries().next();
    if (next.done) {
      return;
    }
    const [identity, queued] = next.value;
    this.queuedByIdentity.delete(identity);
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    this.activeRequestId = requestId;
    this.pendingByRequest.set(requestId, queued);
    const message: VectorTextEffectWorkerRequest = {
      type: "build-effect",
      requestId,
      revision: queued.sourceRevision,
      cacheKey: queued.cacheKey,
      lod: queued.lod,
      effect: queued.effect,
    };
    this.worker.postMessage(message);
  }

  private acceptWorkerResponse(
    response: VectorTextEffectWorkerResponse,
  ): void {
    const pending = this.pendingByRequest.get(response.requestId);
    if (!pending || pending.cacheKey !== response.cacheKey) {
      return;
    }
    this.pendingByRequest.delete(response.requestId);
    this.pendingKeys.delete(response.cacheKey);
    if (this.activeRequestId === response.requestId) {
      this.activeRequestId = null;
    }
    if (response.type === "effect-failed") {
      this.failedJobs += 1;
      this.lastError = response.message;
    } else {
      this.readyByKey.set(response.cacheKey, {
        ...pending,
        mesh: response.mesh,
      });
    }
    this.onResourceReady();
    this.pumpQueue();
  }

  private pruneReadyLods(
    identity: string,
    displayedBucket: number,
  ): void {
    const entries = [...this.readyByKey.entries()]
      .filter(([, value]) => value.effectIdentity === identity)
      .sort((first, second) => (
        Math.abs(first[1].lodBucket - displayedBucket)
        - Math.abs(second[1].lodBucket - displayedBucket)
      ));
    for (const [key] of entries.slice(3)) {
      this.readyByKey.delete(key);
    }
  }
}
