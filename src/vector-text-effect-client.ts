import type { Shadow3dPathData } from "./vector-shadow-3d.ts";
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
} from "./vector-text-lod.ts";
import { VectorPathIdentityPool } from "./vector-path-identity.ts";

interface PendingEffect {
  readonly slotKey: string;
  readonly cacheKey: string;
  readonly effectIdentity: string;
  readonly geometryIdentity: string;
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
  readonly registeredPathBytes: number;
  readonly pendingJobs: number;
  readonly readyJobs: number;
  readonly displayedSlots: number;
  readonly failedJobs: number;
  readonly lastError: string | null;
  readonly backend: "wasm";
  readonly lastComputeMs: number;
  readonly wasmMemoryBytes: number;
}

export interface VectorTextEffectMeshResult {
  readonly mesh: VectorTextGpuMeshData | null;
  readonly matchesRequestedIdentity: boolean;
  readonly matchesRequestedLod: boolean;
}

const MAXIMUM_READY_EFFECT_CACHE_ENTRIES = 48;
const MAXIMUM_READY_EFFECT_LODS_PER_IDENTITY = 3;
const MAXIMUM_REGISTERED_PATHS = 128;
const MAXIMUM_REGISTERED_PATH_BYTES = 32 * 1024 * 1024;
// Keep the worker busy while earlier responses cross back to the main thread.
// A per-slot guard below keeps newer edits replaceable until the prior job ends.
const MAXIMUM_IN_FLIGHT_EFFECT_JOBS = 4;

function effectIdentity(
  geometryIdentity: string,
  effect: VectorTextEffectDescription,
): string {
  if (effect.kind === "source-fill") {
    return [
      VECTOR_TEXT_GEOMETRY_COMPILER_VERSION,
      geometryIdentity,
      effect.kind,
    ].join(":");
  }

  if (effect.kind === "source-outline") {
    return [
      VECTOR_TEXT_GEOMETRY_COMPILER_VERSION,
      geometryIdentity,
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
      geometryIdentity,
      effect.kind,
      vectorX,
      vectorY,
    ].join(":");
  }
  return [
    VECTOR_TEXT_GEOMETRY_COMPILER_VERSION,
    geometryIdentity,
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
  private worker: Worker | null = null;
  // Insertion order is the LRU order. Values include every transferred path
  // array so the main thread and worker enforce the same bounded footprint.
  private readonly registeredPaths = new Map<string, number>();
  private registeredPathBytes = 0;
  private readonly pendingByRequest = new Map<number, PendingEffect>();
  private readonly pendingKeys = new Set<string>();
  private readonly failedKeys = new Set<string>();
  private readonly queuedBySlot = new Map<string, QueuedEffect>();
  private readonly readyByKey = new Map<string, ReadyEffect>();
  private readonly displayedBySlot = new Map<string, DisplayedEffect>();
  private readonly desiredKeyBySlot = new Map<string, string>();
  private readonly pinnedSlots = new Set<string>();
  private nextRequestId = 1;
  private failedJobs = 0;
  private lastError: string | null = null;
  private lastComputeMs = 0;
  private wasmMemoryBytes = 0;
  private workerFailure: string | null = null;
  private resourceRevision = 0;
  private readonly resourceWaiters = new Set<() => void>();
  private readonly onResourceReady: () => void;
  private readonly pathIdentities = new VectorPathIdentityPool();

  constructor(onResourceReady: () => void) {
    this.onResourceReady = onResourceReady;
    // Fetch and compile the required kernel while the mixed-scene runtime is
    // otherwise idle, before the first effect submits geometry.
    if (typeof Worker !== "undefined") {
      this.ensureWorker();
    }
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    if (this.workerFailure) {
      throw new Error(
        `Required vector geometry worker is unavailable: ${this.workerFailure}`,
      );
    }
    const worker = new Worker(
      new URL("./vector-text-effect-worker.ts", import.meta.url),
      { type: "module", name: "vector-text-effect-compiler" },
    );
    worker.onmessage = (
      event: MessageEvent<VectorTextEffectWorkerResponse>,
    ): void => {
      this.acceptWorkerResponse(event.data);
    };
    worker.onerror = (event): void => {
      event.preventDefault();
      this.handleWorkerFailure(
        worker,
        event.message || "Text geometry worker stopped.",
      );
    };
    worker.onmessageerror = (): void => {
      this.handleWorkerFailure(
        worker,
        "Text geometry worker returned an unreadable message.",
      );
    };
    this.worker = worker;
    return worker;
  }

  meshForSlot(
    slotKey: string,
    path: Shadow3dPathData,
    lod: VectorTextLod,
    effect: VectorTextEffectDescription,
    allowAtomicSwap: boolean,
  ): VectorTextEffectMeshResult {
    const geometryIdentity = this.geometryIdentity(path);
    const identity = effectIdentity(geometryIdentity, effect);
    const key = cacheKey(identity, lod);
    this.desiredKeyBySlot.set(slotKey, key);
    const current = this.displayedBySlot.get(slotKey);
    try {
      this.registerPath(geometryIdentity, path);
      const exactLod = requiresExactEffectLod(effect);
      const currentAlreadySuitable =
        current !== undefined
        && current.effectIdentity === identity
        && (exactLod
          ? current.lodBucket === lod.bucket
          : current.lodBucket >= lod.bucket);
      const ready = this.readyEffectForRequest(
        key,
        identity,
        lod.bucket,
        exactLod,
      );
      if (!currentAlreadySuitable) {
        if (!ready) {
          this.requestEffect(
            slotKey,
            key,
            identity,
            geometryIdentity,
            lod,
            effect,
          );
        }
      }
      if (!allowAtomicSwap) {
        return {
          mesh: current?.mesh ?? null,
          matchesRequestedIdentity: current?.effectIdentity === identity,
          matchesRequestedLod: currentAlreadySuitable,
        };
      }

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
    } catch (error) {
      this.failedJobs += 1;
      this.lastError = error instanceof Error ? error.message : String(error);
      this.failedKeys.add(key);
      return {
        mesh: current?.mesh ?? null,
        matchesRequestedIdentity: current?.effectIdentity === identity,
        matchesRequestedLod: false,
      };
    } finally {
      this.pruneRegisteredPaths(new Set([geometryIdentity]));
    }
  }

  private readyEffectForRequest(
    exactKey: string,
    identity: string,
    requestedLodBucket: number,
    exactLod: boolean,
  ): ReadyEffect | undefined {
    const exact = this.readyByKey.get(exactKey);
    if (exact || exactLod) return exact;

    let closestSuitable: ReadyEffect | undefined;
    for (const ready of this.readyByKey.values()) {
      if (
        ready.effectIdentity !== identity
        || ready.lodBucket < requestedLodBucket
      ) {
        continue;
      }
      if (
        !closestSuitable
        || ready.lodBucket < closestSuitable.lodBucket
      ) {
        closestSuitable = ready;
      }
    }
    return closestSuitable;
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
    this.pruneReadyCache();
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

  geometryIdentity(path: Readonly<Shadow3dPathData>): string {
    return this.pathIdentities.intern(path);
  }

  resetForDocument(): void {
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.onmessageerror = null;
      this.worker.terminate();
      this.worker = null;
    }
    this.registeredPaths.clear();
    this.registeredPathBytes = 0;
    this.pendingByRequest.clear();
    this.pendingKeys.clear();
    this.failedKeys.clear();
    this.queuedBySlot.clear();
    this.readyByKey.clear();
    this.displayedBySlot.clear();
    this.desiredKeyBySlot.clear();
    this.pinnedSlots.clear();
    this.nextRequestId = 1;
    this.failedJobs = 0;
    this.lastError = null;
    this.lastComputeMs = 0;
    this.wasmMemoryBytes = 0;
    this.workerFailure = null;
    this.pathIdentities.clear();
    this.advanceResourceRevision(false);
  }

  diagnostics(): VectorTextEffectClientDiagnostics {
    return {
      registeredPaths: this.registeredPaths.size,
      registeredPathBytes: this.registeredPathBytes,
      pendingJobs: this.pendingByRequest.size + this.queuedBySlot.size,
      readyJobs: this.readyByKey.size,
      displayedSlots: this.displayedBySlot.size,
      failedJobs: this.failedJobs,
      lastError: this.lastError,
      backend: "wasm",
      lastComputeMs: this.lastComputeMs,
      wasmMemoryBytes: this.wasmMemoryBytes,
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
        reject(new Error("Timed out while preparing exact vector meshes."));
      }, timeoutMs);
      this.resourceWaiters.add(finish);
    });
  }

  private notifyResourceReady(): void {
    this.advanceResourceRevision(true);
  }

  private advanceResourceRevision(notifyObserver: boolean): void {
    this.resourceRevision += 1;
    if (notifyObserver) {
      this.onResourceReady();
    }
    const waiters = [...this.resourceWaiters];
    this.resourceWaiters.clear();
    waiters.forEach((resolve) => resolve());
  }
  private registerPath(
    geometryIdentity: string,
    path: Shadow3dPathData,
  ): void {
    const existingBytes = this.registeredPaths.get(geometryIdentity);
    if (existingBytes !== undefined) {
      this.registeredPaths.delete(geometryIdentity);
      this.registeredPaths.set(geometryIdentity, existingBytes);
      return;
    }
    const pathBytes = path.verbs.byteLength
      + path.coords.byteLength
      + path.contourOffsets.byteLength;
    if (pathBytes > MAXIMUM_REGISTERED_PATH_BYTES) {
      throw new RangeError(
        "Vector path exceeds the 32 MiB registered-geometry limit.",
      );
    }
    this.pruneRegisteredPaths(new Set([geometryIdentity]), pathBytes);
    if (this.registeredPathBytes + pathBytes > MAXIMUM_REGISTERED_PATH_BYTES) {
      throw new Error(
        "Vector path cannot be registered within the bounded geometry cache.",
      );
    }
    const verbs = new Uint8Array(path.verbs);
    const coords = new Float64Array(path.coords);
    const contourOffsets = new Uint32Array(path.contourOffsets);
    const message: VectorTextEffectWorkerRequest = {
      type: "register-path",
      revision: geometryIdentity,
      path: {
        fillRule: Number(path.fillRule),
        verbs,
        coords,
        contourOffsets,
      },
    };
    this.ensureWorker().postMessage(message, [
      verbs.buffer,
      coords.buffer,
      contourOffsets.buffer,
    ]);
    this.registeredPaths.set(geometryIdentity, pathBytes);
    this.registeredPathBytes += pathBytes;
  }

  private pruneRegisteredPaths(
    additionalProtectedRevisions: ReadonlySet<string> = new Set(),
    requiredBytes = 0,
  ): void {
    if (
      this.registeredPaths.size + (requiredBytes > 0 ? 1 : 0)
        <= MAXIMUM_REGISTERED_PATHS
      && this.registeredPathBytes + requiredBytes
        <= MAXIMUM_REGISTERED_PATH_BYTES
    ) {
      return;
    }
    const protectedRevisions = new Set([
      ...[...this.pendingByRequest.values()].map((value) => value.geometryIdentity),
      ...[...this.queuedBySlot.values()].map((value) => value.geometryIdentity),
      ...[...this.displayedBySlot.values()].map((value) => value.geometryIdentity),
      ...additionalProtectedRevisions,
    ]);
    for (const [revision, byteLength] of this.registeredPaths) {
      if (
        this.registeredPaths.size + (requiredBytes > 0 ? 1 : 0)
          <= MAXIMUM_REGISTERED_PATHS
        && this.registeredPathBytes + requiredBytes
          <= MAXIMUM_REGISTERED_PATH_BYTES
      ) {
        break;
      }
      if (protectedRevisions.has(revision)) {
        continue;
      }
      const message: VectorTextEffectWorkerRequest = {
        type: "release-path",
        revision,
      };
      this.worker?.postMessage(message);
      this.registeredPaths.delete(revision);
      this.registeredPathBytes = Math.max(
        0,
        this.registeredPathBytes - byteLength,
      );
    }
  }

  private handleWorkerFailure(worker: Worker, message: string): void {
    if (this.worker !== worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    this.worker = null;
    const failedWork = this.pendingByRequest.size + this.queuedBySlot.size;
    this.failedJobs += Math.max(1, failedWork);
    this.lastError = message;
    this.workerFailure = message;
    for (const pending of this.pendingByRequest.values()) {
      this.failedKeys.add(pending.cacheKey);
    }
    for (const queued of this.queuedBySlot.values()) {
      this.failedKeys.add(queued.cacheKey);
    }
    this.pendingByRequest.clear();
    this.pendingKeys.clear();
    this.queuedBySlot.clear();
    this.registeredPaths.clear();
    this.registeredPathBytes = 0;
    this.wasmMemoryBytes = 0;
    this.notifyResourceReady();
  }

  private requestEffect(
    slotKey: string,
    key: string,
    identity: string,
    geometryIdentity: string,
    lod: VectorTextLod,
    effect: VectorTextEffectDescription,
  ): void {
    const superseded = this.queuedBySlot.get(slotKey);
    if (superseded && superseded.cacheKey !== key) {
      this.pendingKeys.delete(superseded.cacheKey);
      this.queuedBySlot.delete(slotKey);
    }
    if (
      this.readyByKey.has(key)
      || this.pendingKeys.has(key)
      || this.failedKeys.has(key)
    ) {
      return;
    }
    const queued: QueuedEffect = {
      slotKey,
      cacheKey: key,
      effectIdentity: identity,
      geometryIdentity,
      lodBucket: lod.bucket,
      lod,
      effect,
    };
    this.queuedBySlot.set(slotKey, queued);
    this.pendingKeys.add(key);
    this.pumpQueue();
  }

  private pumpQueue(): void {
    const inFlightSlots = new Set(
      [...this.pendingByRequest.values()].map((pending) => pending.slotKey),
    );
    while (this.pendingByRequest.size < MAXIMUM_IN_FLIGHT_EFFECT_JOBS) {
      let next: [string, QueuedEffect] | null = null;
      for (const entry of this.queuedBySlot) {
        const [slotKey, queued] = entry;
        if (this.desiredKeyBySlot.get(slotKey) !== queued.cacheKey) {
          this.queuedBySlot.delete(slotKey);
          this.pendingKeys.delete(queued.cacheKey);
          continue;
        }
        if (!inFlightSlots.has(slotKey)) {
          next = entry;
          break;
        }
      }
      if (!next) {
        return;
      }
      const [slotKey, queued] = next;
      this.queuedBySlot.delete(slotKey);
      const requestId = this.nextRequestId;
      this.nextRequestId += 1;
      this.pendingByRequest.set(requestId, queued);
      inFlightSlots.add(slotKey);
      const message: VectorTextEffectWorkerRequest = {
        type: "build-effect",
        requestId,
        revision: queued.geometryIdentity,
        cacheKey: queued.cacheKey,
        lod: queued.lod,
        effect: queued.effect,
      };
      this.ensureWorker().postMessage(message);
    }
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
    if (response.type === "effect-failed") {
      this.failedJobs += 1;
      this.lastError = response.message;
      this.failedKeys.add(response.cacheKey);
    } else if (
      [...this.desiredKeyBySlot.values()].some(
        (desiredKey) => desiredKey === response.cacheKey,
      )
    ) {
      this.lastComputeMs = response.computeMs;
      this.wasmMemoryBytes = response.memoryBytes;
      this.readyByKey.set(response.cacheKey, {
        ...pending,
        mesh: response.mesh,
      });
    }
    this.pruneReadyCache();
    this.pruneRegisteredPaths();
    this.notifyResourceReady();
    this.pumpQueue();
  }

  private requiredReadyKeys(): Set<string> {
    return new Set([
      ...[...this.displayedBySlot.values()].map((value) => value.cacheKey),
      ...this.desiredKeyBySlot.values(),
    ]);
  }

  private pruneReadyCache(
    requiredKeys = this.requiredReadyKeys(),
  ): void {
    if (this.readyByKey.size <= MAXIMUM_READY_EFFECT_CACHE_ENTRIES) {
      return;
    }
    for (const key of this.readyByKey.keys()) {
      if (this.readyByKey.size <= MAXIMUM_READY_EFFECT_CACHE_ENTRIES) {
        break;
      }
      if (!requiredKeys.has(key)) {
        this.readyByKey.delete(key);
      }
    }
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
    const requiredKeys = this.requiredReadyKeys();
    const requiredEntryCount = entries.reduce(
      (count, [key]) => count + (requiredKeys.has(key) ? 1 : 0),
      0,
    );
    let remainingUnrequiredLods = Math.max(
      0,
      MAXIMUM_READY_EFFECT_LODS_PER_IDENTITY - requiredEntryCount,
    );
    for (const [key] of entries) {
      if (requiredKeys.has(key)) {
        continue;
      }
      if (remainingUnrequiredLods > 0) {
        remainingUnrequiredLods -= 1;
        continue;
      }
      this.readyByKey.delete(key);
    }
    this.pruneReadyCache(requiredKeys);
  }
}
