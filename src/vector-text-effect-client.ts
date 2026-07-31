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
  readonly slotKey: string;
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

export interface VectorTextEffectMeshResult {
  readonly mesh: VectorTextGpuMeshData | null;
  readonly matchesRequestedIdentity: boolean;
  readonly matchesRequestedLod: boolean;
}

const MAXIMUM_READY_EFFECT_CACHE_ENTRIES = 48;
const MAXIMUM_REGISTERED_PATHS = 128;

function effectIdentity(
  sourceRevision: string,
  effect: VectorTextEffectDescription,
): string {
  if (effect.kind === "source-fill") {
    return [
      VECTOR_TEXT_GEOMETRY_COMPILER_VERSION,
      sourceRevision,
      effect.kind,
    ].join(":");
  }

  if (effect.kind === "source-outline") {
    return [
      VECTOR_TEXT_GEOMETRY_COMPILER_VERSION,
      sourceRevision,
      effect.kind,
      vectorTextFloat64Key(effect.width),
      effect.join,
      effect.includeFill === true ? "include-fill" : "outside-ring",
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

function requiresExactEffectLod(effect: VectorTextEffectDescription): boolean {
  return effect.kind === "block"
    || effect.kind === "block-outline"
    || (
      effect.kind === "source-outline"
      && effect.includeFill !== true
    );
}

export class VectorTextEffectCompilerClient {
  private readonly worker = new Worker(
    new URL("./vector-text-effect-worker.ts", import.meta.url),
    { type: "module", name: "vector-text-effect-compiler" },
  );
  private readonly registeredPaths = new Set<string>();
  private readonly pendingByRequest = new Map<number, PendingEffect>();
  private readonly pendingKeys = new Set<string>();
  private readonly queuedBySlot = new Map<string, QueuedEffect>();
  private readonly readyByKey = new Map<string, ReadyEffect>();
  private readonly displayedBySlot = new Map<string, DisplayedEffect>();
  private readonly desiredKeyBySlot = new Map<string, string>();
  private readonly pinnedSlots = new Set<string>();
  private activeRequestId: number | null = null;
  private nextRequestId = 1;
  private failedJobs = 0;
  private lastError: string | null = null;
  private resourceRevision = 0;
  private readonly resourceWaiters = new Set<() => void>();

  constructor(private readonly onResourceReady: () => void) {
    this.worker.onmessage = (
      event: MessageEvent<VectorTextEffectWorkerResponse>,
    ): void => {
      this.acceptWorkerResponse(event.data);
    };
    this.worker.onerror = (event): void => {
      this.failedJobs += 1;
      this.lastError = event.message || "Worker geometria testo interrotto.";
      this.notifyResourceReady();
    };
  }

  meshForSlot(
    slotKey: string,
    sourceRevision: string,
    path: Shadow3dPathData,
    lod: VectorTextLod,
    effect: VectorTextEffectDescription,
    allowAtomicSwap: boolean,
  ): VectorTextEffectMeshResult {
    const identity = effectIdentity(sourceRevision, effect);
    const key = cacheKey(identity, lod);
    this.desiredKeyBySlot.set(slotKey, key);
    this.registerPath(sourceRevision, path);

    const current = this.displayedBySlot.get(slotKey);
    const exactLod = requiresExactEffectLod(effect);
    const currentAlreadySuitable =
      current !== undefined
      && current.effectIdentity === identity
      && (exactLod
        ? current.lodBucket === lod.bucket
        : current.lodBucket >= lod.bucket);
    if (!currentAlreadySuitable) {
      this.requestEffect(
        slotKey,
        key,
        identity,
        sourceRevision,
        lod,
        effect,
      );
    }
    if (!allowAtomicSwap) {
      return {
        mesh: current?.mesh ?? null,
        matchesRequestedIdentity: current?.effectIdentity === identity,
        matchesRequestedLod: currentAlreadySuitable,
      };
    }

    const ready = this.readyByKey.get(key);
    if (
      ready
      && (
        !current
        || current.effectIdentity !== identity
        || exactLod
        || ready.lodBucket >= current.lodBucket
      )
    ) {
      this.displayedBySlot.set(slotKey, { ...ready, slotKey });
      this.pruneReadyLods(identity, ready.lodBucket);
      return {
        mesh: ready.mesh,
        matchesRequestedIdentity: true,
        matchesRequestedLod: true,
      };
    }
    return {
      mesh: current?.mesh ?? null,
      matchesRequestedIdentity: current?.effectIdentity === identity,
      matchesRequestedLod: currentAlreadySuitable,
    };
  }

  pinSlot(slotKey: string): void {
    this.pinnedSlots.add(slotKey);
  }

  releasePinnedSlot(slotKey: string): void {
    this.pinnedSlots.delete(slotKey);
    this.clearSlot(slotKey);
  }

  clearSlot(slotKey: string): void {
    this.displayedBySlot.delete(slotKey);
    this.desiredKeyBySlot.delete(slotKey);
    const queued = this.queuedBySlot.get(slotKey);
    if (queued) {
      this.pendingKeys.delete(queued.cacheKey);
      this.queuedBySlot.delete(slotKey);
    }
    this.pruneRegisteredPaths();
  }

  retainSlots(liveSlots: ReadonlySet<string>): void {
    const knownSlots = new Set([
      ...this.displayedBySlot.keys(),
      ...this.desiredKeyBySlot.keys(),
      ...this.queuedBySlot.keys(),
    ]);
    for (const slot of knownSlots) {
      if (!liveSlots.has(slot) && !this.pinnedSlots.has(slot)) {
        this.clearSlot(slot);
      }
    }
  }

  diagnostics(): VectorTextEffectClientDiagnostics {
    return {
      registeredPaths: this.registeredPaths.size,
      pendingJobs: this.pendingByRequest.size + this.queuedBySlot.size,
      readyJobs: this.readyByKey.size,
      displayedSlots: this.displayedBySlot.size,
      failedJobs: this.failedJobs,
      lastError: this.lastError,
    };
  }

  resourceRevisionValue(): number {
    return this.resourceRevision;
  }

  waitForResourceReady(afterRevision: number, timeoutMs = 30_000): Promise<number> {
    if (this.resourceRevision !== afterRevision) {
      return Promise.resolve(this.resourceRevision);
    }
    return new Promise<number>((resolve, reject) => {
      const finish = () => {
        window.clearTimeout(timer);
        this.resourceWaiters.delete(finish);
        resolve(this.resourceRevision);
      };
      const timer = window.setTimeout(() => {
        this.resourceWaiters.delete(finish);
        reject(new Error("Timeout durante la preparazione esatta delle mesh vettoriali."));
      }, timeoutMs);
      this.resourceWaiters.add(finish);
    });
  }

  private notifyResourceReady(): void {
    this.resourceRevision += 1;
    this.onResourceReady();
    const waiters = [...this.resourceWaiters];
    this.resourceWaiters.clear();
    waiters.forEach((resolve) => resolve());
  }
  private registerPath(
    revision: string,
    path: Shadow3dPathData,
  ): void {
    if (this.registeredPaths.has(revision)) {
      this.registeredPaths.delete(revision);
      this.registeredPaths.add(revision);
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
    this.pruneRegisteredPaths();
  }

  private pruneRegisteredPaths(): void {
    if (this.registeredPaths.size <= MAXIMUM_REGISTERED_PATHS) {
      return;
    }
    const protectedRevisions = new Set([
      ...[...this.pendingByRequest.values()].map((value) => value.sourceRevision),
      ...[...this.queuedBySlot.values()].map((value) => value.sourceRevision),
      ...[...this.displayedBySlot.values()].map((value) => value.sourceRevision),
    ]);
    for (const revision of this.registeredPaths) {
      if (this.registeredPaths.size <= MAXIMUM_REGISTERED_PATHS) {
        break;
      }
      if (protectedRevisions.has(revision)) {
        continue;
      }
      const message: VectorTextEffectWorkerRequest = {
        type: "release-path",
        revision,
      };
      this.worker.postMessage(message);
      this.registeredPaths.delete(revision);
    }
  }

  private requestEffect(
    slotKey: string,
    key: string,
    identity: string,
    sourceRevision: string,
    lod: VectorTextLod,
    effect: VectorTextEffectDescription,
  ): void {
    const superseded = this.queuedBySlot.get(slotKey);
    if (superseded && superseded.cacheKey !== key) {
      this.pendingKeys.delete(superseded.cacheKey);
      this.queuedBySlot.delete(slotKey);
    }
    if (this.readyByKey.has(key) || this.pendingKeys.has(key)) {
      return;
    }
    const queued: QueuedEffect = {
      slotKey,
      cacheKey: key,
      effectIdentity: identity,
      sourceRevision,
      lodBucket: lod.bucket,
      lod,
      effect,
    };
    this.queuedBySlot.set(slotKey, queued);
    this.pendingKeys.add(key);
    this.pumpQueue();
  }

  private pumpQueue(): void {
    if (this.activeRequestId !== null) {
      return;
    }
    const next = this.queuedBySlot.entries().next();
    if (next.done) {
      return;
    }
    const [slotKey, queued] = next.value;
    this.queuedBySlot.delete(slotKey);
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
    } else if (
      [...this.desiredKeyBySlot.values()].some(
        (desiredKey) => desiredKey === response.cacheKey,
      )
    ) {
      this.readyByKey.set(response.cacheKey, {
        ...pending,
        mesh: response.mesh,
      });
    }
    this.pruneRegisteredPaths();
    this.notifyResourceReady();
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
    if (this.readyByKey.size <= MAXIMUM_READY_EFFECT_CACHE_ENTRIES) {
      return;
    }
    const displayedKeys = new Set(
      [...this.displayedBySlot.values()].map((value) => value.cacheKey),
    );
    for (const key of this.readyByKey.keys()) {
      if (this.readyByKey.size <= MAXIMUM_READY_EFFECT_CACHE_ENTRIES) {
        break;
      }
      if (!displayedKeys.has(key)) {
        this.readyByKey.delete(key);
      }
    }
  }
}
