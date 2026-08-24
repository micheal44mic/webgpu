/**
 * Record delle risorse GPU per livello: texture, piramide di display, superfici
 * unite, bake e archiviazione fredda (compressa e non).
 */
import type { DirtyRect } from "./engine-stroke-types";
import type { LayerFormat } from "./engine-types";
import type { LayerColdCompressedChunk } from "./layer-cold-compression-client";
import type { LayerRecord } from "./layer-stack";
import type { LayerBlendMode } from "./layer-blend-modes";
import type { MixedSceneRasterRunKey } from "./mixed-scene-stack";

export interface LayerTextureResources {
  texture: GPUTexture;
  view: GPUTextureView;
  samplingView: GPUTextureView;
  /** Format signature used to reject incompatible raw GPU copies. */
  format: LayerFormat;
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
  /**
   * Lazily allocated 1024² backdrop/output tiles and dynamic uniforms used
   * only while non-Normal layers are folded. They are never published and are
   * released before the surface leaves its build transaction.
   */
  blendFoldBackdropScratchTexture: GPUTexture | null;
  blendFoldBackdropScratchView: GPUTextureView | null;
  blendFoldScratchTexture: GPUTexture | null;
  blendFoldScratchView: GPUTextureView | null;
  blendFoldUniformBuffer: GPUBuffer | null;
  blendFoldUniformStride: number;
  blendFoldTileWidth: number;
  blendFoldTileHeight: number;
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
 * contains the raw parent plus clipped siblings below the active child.
 * An all-Normal upper suffix stays in the single aggregated `suffix` fast
 * path. If any upper child owns an advanced blend mode, `suffixSteps` retains
 * every visible child as an opacity-free operand so the live tile compositor
 * can apply source-atop in exact stack order. With the parent active only the
 * suffix representation is needed.
 */
export interface ActiveClippingSuffixStepResources {
  layerId: number;
  blendMode: LayerBlendMode;
  opacity: number;
  surface: MergedSurfaceResources;
  viewportSegment: MixedSceneRasterSegmentResources;
}

export interface ActiveClippingGroupResources {
  parentId: number;
  activeLayerId: number;
  mode: "active-parent" | "active-child";
  parentOpacity: number;
  prefix: MergedSurfaceResources | null;
  suffix: MergedSurfaceResources | null;
  suffixSteps: readonly ActiveClippingSuffixStepResources[];
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
  /** Raw tiled pixels retain the authoritative document format byte-for-byte. */
  format: LayerFormat;
}

export interface LayerCompressedColdStorageResources {
  tileIndices: readonly number[];
  chunks: readonly LayerColdCompressedChunk[];
  rawBytes: number;
  storedBytes: number;
  sourceHash: number;
  generation: number;
  encodeMs: number;
  /**
   * Il codec del worker comprime byte grezzi, quindi segue il formato del
   * documento invece di imporne uno. Il campo resta perche' un cold compresso
   * di un formato non deve mai essere ripristinato dentro l'altro.
   */
  format: LayerFormat;
}

/**
 * Non-undoable raster state installed when a saved project is opened. History
 * starts at cursor zero, but replay still needs this exact state underneath the
 * first session action instead of treating the layer as newly blank.
 */
export interface RestoredProjectHistoryBaseline {
  readonly compressed: LayerCompressedColdStorageResources | null;
  readonly baseBounds: DirtyRect | null;
  readonly baseTileMask: Uint32Array;
  readonly noiseMipSmoothing: boolean;
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

/**
 * A blend-mode change uses the layer-switch gate during a direct edit, but an
 * Undo/Redo already owns the History gate and must identify itself explicitly.
 */
export function effectsRetargetCallerForHistoryReplay(
  historyReplay: boolean,
): Extract<EffectsRetargetCaller, "layer-switch" | "history-replay"> {
  return historyReplay ? "history-replay" : "layer-switch";
}

/**
 * The active raster is kept outside every derived raster run. Its blend mode
 * is consumed live by both ordered presentation paths (including the active
 * clipping parent/child uniforms), so changing that mode cannot invalidate a
 * merged surface while the document stays in the same Normal/advanced
 * topology. Inactive rasters remain conservative because their mode can alter
 * how the surrounding cached run is split.
 */
export function activeLayerBlendModeCanUseLiveComposition(
  targetLayerId: number,
  activeLayerId: number,
  currentMode: LayerBlendMode,
  nextMode: LayerBlendMode,
  anotherAdvancedModeIsPresent: boolean,
): boolean {
  if (targetLayerId !== activeLayerId || currentMode === nextMode) {
    return false;
  }
  const orderedBlendWasRequired = currentMode !== "normal"
    || anotherAdvancedModeIsPresent;
  const orderedBlendWillBeRequired = nextMode !== "normal"
    || anotherAdvancedModeIsPresent;
  return orderedBlendWasRequired === orderedBlendWillBeRequired;
}

export type LayerGpuCompletionPolicy =
  | "await-immediately"
  | "defer-to-fold-fence";

export type LayerEffectsRebuildDomain =
  | "full-document"
  | "content-bounds";
