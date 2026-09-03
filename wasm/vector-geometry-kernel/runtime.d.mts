import type {
  VectorTextEffectDescription,
  VectorTextGpuMeshData,
} from "../../src/vector-text-effect-geometry.ts";
import type { VectorTextWorkerPathData } from "../../src/vector-text-effect-worker-protocol.ts";
import type { VectorTextLod } from "../../src/vector-text-lod.ts";

export interface VectorGeometryCompileResult {
  readonly mesh: VectorTextGpuMeshData | null;
  readonly computeMs: number;
  readonly memoryBytes: number;
}

export interface VectorGeometryKernel {
  readonly backend: "wasm";
  readonly abiVersion: 1;
  readonly wasmByteLength: number | null;
  readonly memoryBytes: () => number;
  readonly diagnostics: () => {
    readonly registeredPaths: number;
    readonly registeredPathBytes: number;
    readonly canonicalCacheEntries: number;
    readonly canonicalCacheBytes: number;
    readonly canonicalCacheHits: number;
    readonly canonicalCacheMisses: number;
    readonly canonicalCacheEvictions: number;
    readonly memoryBytes: number;
  };
  readonly registerPath: (handle: number, path: VectorTextWorkerPathData) => void;
  readonly releasePath: (handle: number) => void;
  readonly compileRegistered: (
    handle: number,
    lod: VectorTextLod,
    effect: VectorTextEffectDescription,
    revision: string,
  ) => VectorGeometryCompileResult;
  readonly compile: (
    path: VectorTextWorkerPathData,
    lod: VectorTextLod,
    effect: VectorTextEffectDescription,
    revision: string,
  ) => VectorGeometryCompileResult;
}

export function instantiateVectorGeometryKernel(
  moduleOrBytes: WebAssembly.Module | BufferSource,
): Promise<VectorGeometryKernel>;

export function createVectorGeometryKernel(options?: {
  readonly url?: URL | string;
  readonly fetchImplementation?: typeof fetch;
}): Promise<VectorGeometryKernel>;
