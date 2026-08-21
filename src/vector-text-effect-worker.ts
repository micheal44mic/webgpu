import { compileVectorTextEffect } from "./vector-text-effect-geometry";
import type {
  VectorTextEffectWorkerRequest,
  VectorTextEffectWorkerResponse,
  VectorTextWorkerPathData,
} from "./vector-text-effect-worker-protocol";

const paths = new Map<string, VectorTextWorkerPathData>();

function respond(
  message: VectorTextEffectWorkerResponse,
  transfer: Transferable[] = [],
): void {
  self.postMessage(message, { transfer });
}

self.onmessage = (
  event: MessageEvent<VectorTextEffectWorkerRequest>,
): void => {
  const message = event.data;
  if (message.type === "register-path") {
    paths.set(message.revision, message.path);
    return;
  }
  if (message.type === "release-path") {
    paths.delete(message.revision);
    return;
  }

  const path = paths.get(message.revision);
  if (!path) {
    respond({
      type: "effect-failed",
      requestId: message.requestId,
      cacheKey: message.cacheKey,
      message: `Path ${message.revision} is not registered in the worker.`,
    });
    return;
  }
  try {
    const mesh = compileVectorTextEffect(
      path,
      message.lod,
      message.effect,
      message.cacheKey,
    );
    const transfer: Transferable[] = [];
    if (mesh) {
      transfer.push(mesh.vertices.buffer, mesh.indices.buffer);
    }
    respond({
      type: "effect-ready",
      requestId: message.requestId,
      cacheKey: message.cacheKey,
      mesh,
    }, transfer);
  } catch (error) {
    respond({
      type: "effect-failed",
      requestId: message.requestId,
      cacheKey: message.cacheKey,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
