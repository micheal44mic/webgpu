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

/** Primary/fallback origins plus one post-composite opacity vec4. */
export const VECTOR_TEXT_RUN_CACHE_UNIFORM_BYTES = 32;
const VECTOR_TEXT_RUN_CACHE_BYTES_PER_PIXEL = 8;

/** Complete mip count for one non-empty 2D run-cache allocation. */
export function vectorTextRunCacheMipLevelCount(width: number, height: number): number {
  const maximumAxis = Math.max(1, Math.floor(width), Math.floor(height));
  return Math.floor(Math.log2(maximumAxis)) + 1;
}

/** Descriptor bytes retained by one tagged-domain premultiplied RGBA16F mip chain. */
export function vectorTextRunCacheMemoryBytes(width: number, height: number): number {
  let mipWidth = Math.max(1, Math.floor(width));
  let mipHeight = Math.max(1, Math.floor(height));
  let pixels = 0;
  while (true) {
    pixels += mipWidth * mipHeight;
    if (mipWidth === 1 && mipHeight === 1) break;
    mipWidth = Math.max(1, Math.floor(mipWidth / 2));
    mipHeight = Math.max(1, Math.floor(mipHeight / 2));
  }
  return pixels * VECTOR_TEXT_RUN_CACHE_BYTES_PER_PIXEL;
}

export interface VectorTextRunTextureResources {
  texture: GPUTexture;
  /** Sampling view exposing the complete tagged-domain premultiplied mip chain. */
  view: GPUTextureView;
  /** Render-attachment view restricted to the exact mip-zero presentation. */
  mipZeroView: GPUTextureView;
  mipLevelCount: number;
  /** Allocation rectangle in capture-viewport coordinates. */
  textureBounds: DirtyRect;
  fallbackTexture: GPUTexture | null;
  fallbackView: GPUTextureView | null;
  fallbackMipLevelCount: number;
  /** Allocation rectangle in fallback-capture coordinates. */
  fallbackBounds: DirtyRect | null;
  /** Per-run primary/fallback origins consumed by the mixed-scene shader. */
  cacheUniformBuffer: GPUBuffer;
  cacheUniformUpload: Float32Array;
  /** Applied once after every internal vector draw in this run is composited. */
  opacity: number;
  /** Color-domain tags are tracked per capture so an in-flight mode switch is safe. */
  primaryEncodedSrgb: boolean;
  fallbackEncodedSrgb: boolean;
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
  /** Meaningful vertex and index bytes uploaded into the allocation. */
  payloadBytes: number;
  /** Descriptor bytes, including the minimum allocation for empty buffers. */
  allocatedBytes: number;
}

export interface VectorTextGpuSlugResources {
  kind: "slug";
  revision: string;
  curveTexture: GPUTexture;
  bandTexture: GPUTexture;
  bindGroup: GPUBindGroup;
  curveCount: number;
  memoryBytes: number;
  /** Meaningful curve and band texel bytes uploaded into the allocation. */
  payloadBytes: number;
  /** Texture descriptor bytes owned by this cache entry. */
  allocatedBytes: number;
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

/**
 * Returns the sole cache key used by resource lookup and authoritative prune.
 * The legacy path intentionally preserves its node-scoped key verbatim.
 */
export function vectorTextGpuResourceKey(
  draw: VectorTextGpuDraw,
  sharingEnabled: boolean,
): string {
  if (!sharingEnabled) return draw.meshKey;
  return vectorTextGpuDrawUsesMesh(draw)
    ? `mesh:${draw.mesh.revision}`
    : `slug:${draw.slug.revision}`;
}

export interface VectorGeometryGpuDiagnostics {
  readonly resourceSharingEnabled: boolean;
  readonly cacheEntries: number;
  readonly meshCacheEntries: number;
  readonly slugCacheEntries: number;
  /** Monotonic cache lookup counters for this engine instance. */
  readonly cacheLookupCount: number;
  readonly cacheHitCount: number;
  readonly cacheMissCount: number;
  /** Monotonic successful resource creation counters. */
  readonly createdBufferCount: number;
  readonly createdTextureCount: number;
  /** Monotonic meaningful bytes uploaded for successful cache misses. */
  readonly uploadBytes: number;
  /** Current meaningful bytes retained by live geometry cache entries. */
  readonly payloadBytes: number;
  /** Current descriptor bytes allocated by live geometry cache entries. */
  readonly liveAllocatedBytes: number;
}

export function pruneVectorTextGpuResourceCache(
  resourcesByKey: Map<string, VectorTextGpuDrawResources>,
  activeResourceKeys: ReadonlySet<string>,
  destroyResource: (resources: VectorTextGpuDrawResources) => void,
): void {
  for (const [key, resources] of resourcesByKey) {
    if (activeResourceKeys.has(key)) continue;
    destroyResource(resources);
    resourcesByKey.delete(key);
  }
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
  targetMipLevelCount: number;
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
