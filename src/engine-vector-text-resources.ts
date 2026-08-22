/**
 * Record delle risorse GPU del testo vettoriale: mesh, slug, cache di sfocatura
 * e run in attesa di presentazione.
 */
import type { DirtyRect } from "./engine-stroke-types";
import type { RasterStrokeSourceMode } from "./stroke-renderer";
import type {
  VectorTextGpuBlurSourceDraw,
  VectorTextGpuDraw,
  VectorTextPlacement,
  VectorTextViewState,
} from "./vector-text-types";

/** One vec2 origin for the primary cache and one for its fallback. */
export const VECTOR_TEXT_RUN_CACHE_UNIFORM_BYTES = 16;

export interface VectorTextRunTextureResources {
  texture: GPUTexture;
  view: GPUTextureView;
  /** Allocation rectangle in capture-viewport coordinates. */
  textureBounds: DirtyRect;
  fallbackTexture: GPUTexture | null;
  fallbackView: GPUTextureView | null;
  /** Allocation rectangle in fallback-capture coordinates. */
  fallbackBounds: DirtyRect | null;
  /** Per-run primary/fallback origins consumed by the mixed-scene shader. */
  cacheUniformBuffer: GPUBuffer;
  cacheUniformUpload: Float32Array;
  bindGroup: GPUBindGroup;

  lastBounds: DirtyRect | null;
  initialized: boolean;
}

export interface VectorTextGpuMeshResources {
  revision: string;
  kind: "mesh";
  vertexBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;
  indexCount: number;
  memoryBytes: number;
}

export interface VectorTextGpuSlugResources {
  kind: "slug";
  revision: string;
  curveTexture: GPUTexture;
  bandTexture: GPUTexture;
  bindGroup: GPUBindGroup;
  curveCount: number;
  memoryBytes: number;
}

export type VectorTextGpuDrawResources =
  | VectorTextGpuMeshResources
  | VectorTextGpuSlugResources;

export type VectorTextGpuMeshSourceDraw = Extract<
  VectorTextGpuDraw,
  { readonly mesh: unknown }
>;

export function vectorTextGpuDrawUsesMesh(
  draw: VectorTextGpuDraw,
): draw is VectorTextGpuMeshSourceDraw {
  return draw.mode === "mesh-direct"
    || draw.mode === "mesh-blur"
    || draw.mode === "mesh-inner-shadow-blur";
}

export function vectorTextGpuDrawUsesBlur(
  draw: VectorTextGpuDraw,
): draw is VectorTextGpuBlurSourceDraw {
  return draw.mode === "slug-blur"
    || draw.mode === "slug-inner-shadow-blur"
    || draw.mode === "mesh-blur"
    || draw.mode === "mesh-inner-shadow-blur";
}

export interface VectorTextGpuBlurCacheResources {
  texture: GPUTexture;
  view: GPUTextureView;
  compositeBindGroup: GPUBindGroup;
  innerShadowBindGroup: GPUBindGroup;
  width: number;
  height: number;
  memoryBytes: number;
  needsBuild: boolean;
}

export interface VectorTextGpuPendingRun {
  placement: Extract<VectorTextPlacement, `text-run:${string}`>;
  resources: VectorTextRunTextureResources;
  target: "primary" | "fallback";
  targetTexture: GPUTexture;
  targetView: GPUTextureView;
  /** Allocation rectangle of targetTexture in run.view canvas coordinates. */
  targetBounds: DirtyRect;
  draws: readonly VectorTextGpuDraw[];
  drawResources: readonly VectorTextGpuDrawResources[];
  blurResources: readonly (VectorTextGpuBlurCacheResources | null)[];
  view: VectorTextViewState;

  bounds: DirtyRect;
}

export type MixedSceneActivePresentation =
  | { kind: "base" }
  | { kind: "thickness-tail" }
  | { kind: "light-glaze" }
  | { kind: "raster-stroke"; sourceMode: RasterStrokeSourceMode };
