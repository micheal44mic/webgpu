/**
 * Record delle risorse GPU per livello: texture, piramide di display, superfici
 * unite, bake e archiviazione fredda (compressa e non).
 */
import type { DirtyRect } from "./engine-stroke-types";
import type { LayerColdCompressedChunk } from "./layer-cold-compression-client";
import type { LayerRecord } from "./layer-stack";
import type { MixedSceneRasterRunKey } from "./mixed-scene-stack";

export interface LayerTextureResources {
  texture: GPUTexture;
  view: GPUTextureView;
  samplingView: GPUTextureView;
}

export interface DisplayPyramidResources {
  texture: GPUTexture;
  samplingView: GPUTextureView;
  mipViews: GPUTextureView[];
}

export interface MergedSurfaceResources {
  texture: GPUTexture;
  samplingView: GPUTextureView;
  mipViews: GPUTextureView[];
  mipDownsampleBindGroups: GPUBindGroup[];
  bounds: DirtyRect;
  resolutionScale: number;
  textureWidth: number;
  textureHeight: number;
  mip0MemoryBytes: number;
  mipChainMemoryBytes: number;
  validThroughLevel: number;
  layerCount: number;
  foldedPixels: number;
  analyticBakePixels: number;
}

/**
 * One clipping unit is presented as a single active raster segment. `prefix`
 * contains the raw parent plus clipped siblings below the active child;
 * `suffix` contains the ordinary source-over collapse of siblings above it.
 * With the parent active only `suffix` is needed.
 */
export interface ActiveClippingGroupResources {
  parentId: number;
  activeLayerId: number;
  mode: "active-parent" | "active-child";
  parentOpacity: number;
  prefix: MergedSurfaceResources | null;
  suffix: MergedSurfaceResources | null;
}

export interface MixedSceneRasterSegmentResources {
  key: MixedSceneRasterRunKey;
  surface: MergedSurfaceResources;
  uniformBuffer: GPUBuffer;
  bindGroup: GPUBindGroup;
}

export interface RebuildMergedLayerSurfacesOptions {
  reuseUnchangedRasterRuns?: boolean;
}

export interface LayerBakeResources {
  texture: GPUTexture;
  storageView: GPUTextureView;
  samplingView: GPUTextureView;
  memoryBytes: number;
  generation: number;
  nonTransparentBounds: DirtyRect;
}

export interface LayerColdStorageResources {
  texture: GPUTexture;
  tileIndices: readonly number[];
  memoryBytes: number;
  generation: number;
}

export interface LayerCompressedColdStorageResources {
  tileIndices: readonly number[];
  chunks: readonly LayerColdCompressedChunk[];
  rawBytes: number;
  storedBytes: number;
  sourceHash: number;
  generation: number;
  encodeMs: number;
}

export interface LayerColdCompressionProgress {
  record: LayerRecord;
  gpu: LayerGpuResources;
  cold: LayerColdStorageResources;
  chunks: LayerColdCompressedChunk[];
  nextArrayLayer: number;
  rawBytes: number;
  storedBytes: number;
  sourceHash: number;
  encodeMs: number;
  pauseReported: boolean;
}

export type LayerGpuResources = {
  hot: LayerTextureResources | null;
  cold: LayerColdStorageResources | null;
  compressed: LayerCompressedColdStorageResources | null;
  bake: LayerBakeResources | null;
  bakeValid: boolean;
};

/**
 * Who is asking the effects working set to change source. Each value carries a
 * different set of legitimate exemptions from the "engine must be idle" guard,
 * and naming them beats threading booleans that nobody can read back.
 */
export type EffectsRetargetCaller =
  | "public"
  | "layer-switch"
  | "history-replay"
  | "structural-history";

export type LayerGpuCompletionPolicy =
  | "await-immediately"
  | "defer-to-fold-fence";

export type LayerEffectsRebuildDomain =
  | "full-document"
  | "content-bounds";
