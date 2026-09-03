import { createVectorGeometryKernel } from "../wasm/vector-geometry-kernel/runtime.mjs";
import { VECTOR_TEXT_GEOMETRY_COMPILER_VERSION } from "./vector-text-lod";
import type {
  VectorTextEffectWorkerRequest,
  VectorTextEffectWorkerResponse,
  VectorTextWorkerPathData,
} from "./vector-text-effect-worker-protocol";

interface RegisteredWorkerPath {
  readonly handle: number;
  path: VectorTextWorkerPathData | null;
  registration: Promise<void>;
  error: unknown;
}

const paths = new Map<string, RegisteredWorkerPath>();
let nextPathHandle = 1;
let initializationError: unknown = null;
const kernelPromise = createVectorGeometryKernel().catch((error: unknown) => {
  initializationError = error;
  return null;
});

function respond(
  message: VectorTextEffectWorkerResponse,
  transfer: Transferable[] = [],
): void {
  self.postMessage(message, { transfer });
}

async function handleMessage(
  message: VectorTextEffectWorkerRequest,
): Promise<void> {
  if (message.type === "register-path") {
    const previous = paths.get(message.revision);
    if (previous) {
      paths.delete(message.revision);
      void previous.registration.then(async () => {
        const kernel = await kernelPromise;
        kernel?.releasePath(previous.handle);
      });
    }
    const entry: RegisteredWorkerPath = {
      handle: nextPathHandle,
      path: message.path,
      registration: Promise.resolve(),
      error: null,
    };
    nextPathHandle = nextPathHandle === 0xffff_ffff ? 1 : nextPathHandle + 1;
    paths.set(message.revision, entry);
    entry.registration = kernelPromise.then((kernel) => {
      if (!kernel) {
        throw initializationError ?? new Error("Required vector geometry Wasm is unavailable.");
      }
      if (paths.get(message.revision) !== entry) return;
      const path = entry.path;
      if (!path) {
        throw new Error("Vector path data was released before registration.");
      }
      kernel.registerPath(entry.handle, path);
      entry.path = null;
    }).catch((error: unknown) => {
      entry.path = null;
      entry.error = error;
    });
    return;
  }
  if (message.type === "release-path") {
    const entry = paths.get(message.revision);
    paths.delete(message.revision);
    if (entry) {
      void entry.registration.then(async () => {
        const kernel = await kernelPromise;
        kernel?.releasePath(entry.handle);
      });
    }
    return;
  }

  const entry = paths.get(message.revision);
  if (!entry) {
    respond({
      type: "effect-failed",
      requestId: message.requestId,
      cacheKey: message.cacheKey,
      backend: "wasm",
      message: `Path ${message.revision} is not registered in the worker.`,
    });
    return;
  }
  try {
    const kernel = await kernelPromise;
    if (!kernel) {
      const detail = initializationError instanceof Error
        ? initializationError.message
        : String(initializationError ?? "unknown initialization error");
      throw new Error(`Required vector geometry Wasm is unavailable: ${detail}`);
    }
    await entry.registration;
    if (entry.error) {
      throw entry.error;
    }
    const result = kernel.compileRegistered(
      entry.handle,
      message.lod,
      message.effect,
      `${VECTOR_TEXT_GEOMETRY_COMPILER_VERSION}:${message.cacheKey}`,
    );
    const transfer: Transferable[] = [];
    if (result.mesh) {
      transfer.push(result.mesh.vertices.buffer, result.mesh.indices.buffer);
    }
    respond({
      type: "effect-ready",
      requestId: message.requestId,
      cacheKey: message.cacheKey,
      backend: "wasm",
      computeMs: result.computeMs,
      memoryBytes: result.memoryBytes,
      mesh: result.mesh,
    }, transfer);
  } catch (error) {
    respond({
      type: "effect-failed",
      requestId: message.requestId,
      cacheKey: message.cacheKey,
      backend: "wasm",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

self.onmessage = (event: MessageEvent<VectorTextEffectWorkerRequest>): void => {
  void handleMessage(event.data);
};
