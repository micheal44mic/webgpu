import { clamp, hexToHsl } from "./color";
import { decodeGrayscalePng8 } from "./png-mask";
import {
  createDryBlendPlanner,
  DRY_BLEND_SCRATCH_LIFECYCLE_STRATEGY,
  type DryBlendPlanner,
} from "./blend-core";
import {
  DryBlendRenderer,
  cloneDryBlendRenderBatch,
  type DryBlendRenderBatch,
} from "./blend-renderer";
import {
  brushShader,
  displayShader,
  grainMipShader,
  layerCompositeShader,
  lightGlazeCompositeMipShader,
  lightGlazeCompositeShader,
  lightGlazeDisplayShader,
  paintMipDownsampleShader,
  texturizedGrainShader,
  thicknessTailDisplayShader,
} from "./shaders";
import {
  vectorTextDisplayShader,
  VECTOR_TEXT_PRESENTATION_STRATEGY,
} from "./vector-text-shader";

import {
  MIXED_SCENE_STACK_STRATEGY,
  MixedSceneStack,
  cloneVectorTextNode,
  type MixedSceneCompositionSegment,
  type MixedSceneItem,
  type VectorTextNode,
  type VectorTextNodeSeed,
} from "./mixed-scene-stack";
import {
  MIXED_SCENE_COMPOSITOR_STRATEGY,
  MIXED_SCENE_LINEAR_FORMAT,
  mixedSceneClearShader,
  mixedScenePresentShader,
  mixedSceneRasterSegmentShader,
  mixedSceneTextSegmentShader,
} from "./mixed-scene-compositor-shader";
import {
  MIXED_MERGED_SURFACE_MAX_DISPLAY_MIP,
  MIXED_MERGED_SURFACE_STORAGE_STRATEGY,
  alignedMergedSurfaceBounds,
  intersectMergedSurfaceRects,
  mergedSurfaceLocalRect,
  mergedSurfaceMemoryBytes,
  mergedSurfaceMipLevelCount,
  mergedSurfacePhysicalRect,
  unionMergedSurfaceRects,
  type MergedSurfaceRect,
} from "./merged-surface-bounds";
import type {
  VectorTextGpuDraw,
  VectorTextGpuPresentationStats,
  VectorTextGpuSlugBlurSourceDraw,
  VectorTextPlacement,
  VectorTextViewState,
} from "./vector-text-prototype";
import {
  VECTOR_TEXT_GPU_BLUR_COMPOSITE_UNIFORM_BYTES,
  VECTOR_TEXT_GPU_BLUR_FILTER_UNIFORM_BYTES,
  VECTOR_TEXT_GPU_BLUR_FORMAT,
  VECTOR_TEXT_GPU_RENDER_STRATEGY,
  VECTOR_TEXT_GPU_SAMPLE_COUNT,
  VECTOR_TEXT_GPU_TARGET_FORMAT,
  VECTOR_TEXT_GPU_UNIFORM_BYTES,
  VECTOR_TEXT_GPU_UNIFORM_FLOATS,
  VECTOR_TEXT_GPU_UNIFORM_STRIDE,
  vectorTextGpuBlurCompositeShader,
  vectorTextGpuGaussianBlurShader,
  vectorTextGpuShader,
} from "./vector-text-gpu-shader";
import {
  VECTOR_TEXT_SLUG_GPU_RENDER_STRATEGY,
  VECTOR_TEXT_SLUG_UNIFORM_BYTES,
  vectorTextSlugGpuShader,
} from "./vector-text-slug-gpu-shader";
import {
  createVectorTextGpuMeshResources,
  createVectorTextGpuSlugResources,
  destroyVectorTextGpuResources,
} from "./vector-text-gpu-resources";
import {
  VECTOR_TEXT_INNER_SHADOW_GPU_STRATEGY,
  vectorTextInnerShadowGpuShader,
} from "./vector-text-inner-shadow-gpu-shader";
import {
  THICKNESS_DYNAMICS_STRATEGY,
  THICKNESS_TAPER_WINDOW_MS,
  endThicknessRadius,
  startThicknessFactor,
  thicknessDynamicsIsNeutral,
  thicknessDynamicsNeedsTailHoldback,
  type ThicknessDynamicsStrategy,
} from "./thickness-dynamics";
import {
  RASTER_STROKE_COVERAGE_STRATEGY,
  RASTER_STROKE_GEOMETRY_STORAGE_STRATEGY,
  RASTER_STROKE_DISTANCE_STORAGE_STRATEGY,
  RASTER_STROKE_MUTATION_GATE_STRATEGY,
  RASTER_STROKE_STYLED_STORAGE_STRATEGY,
  RasterStrokeRenderer,
  rasterStrokeDisplayShader,
  type RasterStrokeEncodeResult,
  type RasterStrokeSourceMode,
} from "./stroke-renderer";
import type { RasterStrokeGoldenReport } from "./stroke-golden";
import type { RasterShadowGoldenReport } from "./shadow-golden";
import {
  DEFAULT_RASTER_STROKE_STYLE,
  RASTER_STROKE_COMPACT_SCRATCH_MAX_WIDTH,
  RASTER_STROKE_COMPOSITOR_ONLY_SCRATCH_EXTENT,
  RASTER_STROKE_SCRATCH_STRATEGY,
  copyRasterStrokeStyle,
  normalizeRasterStrokeStyle,
  rasterStrokeScratchExtentForWidth,
  rasterStrokeScratchExtentForRenderer,
  rasterStrokeStylesEqual,
  type RasterStrokeRect,
  type RasterStrokeStyle,
} from "./stroke-core";

import {
  RASTER_BEVEL_BOUNDING_FIELD_STRATEGY,
  RASTER_BEVEL_DISTANCE_STRATEGY,
  RASTER_BEVEL_FIELD_STRATEGY,
  RASTER_BEVEL_WORKSPACE_STRATEGY,
  RasterBevelRenderer,
  type RasterBevelEncodeResult,
} from "./bevel-renderer";
import {
  DEFAULT_RASTER_BEVEL_STYLE,
  RASTER_BEVEL_FIELD_IDLE_SHRINK_DELAY_MS,
  classifyRasterBevelStyleChange,
  copyRasterBevelStyle,
  rasterBevelInfluenceBounds,
  normalizeRasterBevelStyle,
  rasterBevelRadiusBucket,
  rasterBevelStylesEqual,
  rasterBevelVisualBounds,
  type RasterBevelRect,
  type RasterBevelStyle,
} from "./bevel-core";
import {
  RASTER_SHADOW_STORAGE_STRATEGY,
  RASTER_SHADOW_WORKSPACE_STRATEGY,
  RasterShadowRenderer,
  type RasterShadowEncodeResult,
} from "./shadow-renderer";
import {
  DEFAULT_RASTER_INNER_SHADOW_STYLE,
  DEFAULT_RASTER_OUTER_SHADOW_STYLE,
  classifyRasterInnerShadowStyleChange,
  classifyRasterOuterShadowStyleChange,
  copyRasterInnerShadowStyle,
  copyRasterOuterShadowStyle,
  normalizeRasterInnerShadowStyle,
  normalizeRasterOuterShadowStyle,
  rasterInnerShadowInfluenceBounds,
  rasterInnerShadowStylesEqual,
  rasterInnerShadowVisualBounds,
  rasterOuterShadowInfluenceBounds,
  rasterOuterShadowStylesEqual,
  rasterOuterShadowUsesSupportedBlend,
  rasterOuterShadowVisualBounds,
  type RasterInnerShadowStyle,
  type RasterOuterShadowStyle,
  type RasterShadowRect,
} from "./shadow-core";
import {
  EFFECTS_WORKING_SET_STRATEGY,
  EffectsWorkbench,
} from "./effects-workbench";
import type { EffectsWorkbenchBenchmarkReport } from "./effects-benchmark";
import {
  LAYER_STACK_MAXIMUM,
  LayerStack,
  layerEffectRendererRequirements,
  type LayerRecord,
} from "./layer-stack";
import {
  hasVisibleContent,
  historyStepTargetsMissingLayer,
  layersWithVisibleContent,
  selectLayerReplay,
} from "./history-journal";
import { runGpuAllocationTransaction } from "./gpu-allocation-transaction";
import {
  EFFECTS_SCRATCH_POOL_IDLE_SHRINK_DELAY_MS,
  EFFECTS_SCRATCH_POOL_STRATEGY,
  effectsScratchCanShrink,
  effectsScratchShrinkIsWorthwhile,
} from "./effects-scratch-pool";
import {
  LAYER_STORAGE_GRID_SIZE,
  LAYER_STORAGE_STRATEGY,
  LAYER_STORAGE_TILE_COUNT,
  LAYER_STORAGE_TILE_SIZE,
  alignedBoundsTileCount,
  clearLayerStorageTileMask,
  compareLayerStorageMasks,
  countLayerStorageTiles,
  exactLayerStorageTileMask,
  layerStorageTileMemoryMiB,
  layerStorageTileIndices,
  markLayerStorageRect,
} from "./layer-storage-study";
import type {
  LayerCompressionLayerReport,
  LayerCompressionStudyProgress,
  LayerCompressionStudyReport,
} from "./layer-compression-study";
import {
  LAYER_COLD_COMPRESSION_IDLE_DELAY_MS,
  LAYER_COLD_COMPRESSION_MINIMUM_DISTANCE,
  LAYER_COLD_COMPRESSION_RUNTIME_BUILD,
  LayerColdCompressionClient,
  type LayerColdCompressedChunk,
} from "./layer-cold-compression-client";

function combineCompressionHashes(
  previous: number,
  next: number,
  byteLength: number,
): number {
  let hash = previous >>> 0;
  hash ^= next >>> 0;
  hash = Math.imul(hash, 0x01000193);
  hash ^= byteLength >>> 0;
  return Math.imul(hash, 0x01000193) >>> 0;
}

export type {
  RasterStrokePosition,
  RasterStrokeStyle,
} from "./stroke-core";


export type BlendMode = "normal" | "additive" | "light-glaze" | "m1-glaze";
export type BrushTool = "paint" | "blend";
export type LayerFormat = "rgba8unorm" | "rgba16float";
export type BrushShape = "circle" | "shape";
export type GrainMode = "off" | "texturized" | "moving";
export type GrainFiltering = "no" | "classic" | "improved";
export type GrainBlendMode = "multiply";
export type {
  RasterBevelContour,
  RasterBevelDirection,
  RasterBevelGloss,
  RasterBevelMode,
  RasterBevelStyle,
  RasterBevelTechnique,
} from "./bevel-core";
export type {
  RasterInnerShadowStyle,
  RasterOuterShadowStyle,
  RasterShadowBlendMode,
  RasterShadowContour,
} from "./shadow-core";

export type StampGeometry = "quad" | "oriented-support-quads";
export type FragmentCoverageStrategy = "generic-smoothstep" | "shape-alpha-mask-2k";
export type ShapeSamplingStrategy =
  | "none"
  | "legacy-full-mask"
  | "coarse-occupancy-bitmask"
  | "mixed";
export type ShapeMaskDecodeStrategy = "png-gray8-direct" | "canvas-fallback";
export type HistoryStorageStrategy = "cpu-render-batch-journal";
export type HistoryReplayStrategy = "clear-and-stable-gpu-replay";
export type HistoryStampRetentionStrategy = "shared-immutable-references";
export type PresentationCacheStrategy = "persistent-full-resolution-screen-cache";
export type PresentationTransferStrategy = "copy-texture-to-current-texture";
export type PaintDisplayPyramidStrategy = "live-dirty-box-filter-mip-chain";
export type PaintDisplayLodSelectionStrategy = "largest-power-of-two-without-upscaling";
export type AdaptivePreviewStrategy =
  "queue-lag-canvas2d-tip-patch";
export type AdaptivePreviewTriggerStrategy = "single-sampled-queue-prefix-latency";
export type AdaptivePreviewStaleFrameStrategy =
  "hide-confirmed-stale-bitmap-and-single-raf-retry";
export type AdaptivePreviewVisibleCanvasStrategy =
  "iphone-desynchronized-others-synchronized-canvas2d";
export type AdaptiveSpacingStrategy = "queue-lag-step-up-per-stroke";
export type BrushOpacityStrategy = "per-stamp-uniform-alpha-multiplier";
export type GrainStrategy =
  | "disabled-legacy-pipeline"
  | "rgba8-native-2500-fixed-coverage-multiply"
  | "rgba8-native-2500-moving-coverage-multiply";
export type GrainCoordinateStrategy =
  | "none"
  | "authoritative-layer-position"
  | "stamp-local-position";
export type GrainSamplingStrategy =
  | "none"
  | "repeat-nearest"
  | "repeat-linear-mip-nearest"
  | "repeat-linear-trilinear"
  | "clamp-nearest"
  | "clamp-linear-mip-nearest"
  | "clamp-linear-trilinear";
export type GrainMipStrategy = "webgpu-wgsl-linear-full-chain";
export type GrainPipelineStrategy = "separate-opt-in-pipelines";
export type GrainCoverageStrategy =
  | "none"
  | "post-tip-coverage-pre-alpha-multiply";
export type GrainAdaptivePreviewStrategy =
  | "legacy"
  | "disabled-semantic-mismatch-probe-spacing-active";
export type LightGlazeStrategy =
  | "lazy-stroke-mip0-format-quantized-composite-mips-single-commit"
  | "m1-r8-quantized-max-coverage-plus-composited-mips-single-commit";
export type LightGlazeAdaptivePreviewStrategy = "disabled-semantic-mismatch";
export type LightGlazeStorageMode = "none" | "rgba-stroke" | "r8-coverage";
export type AdaptiveSpacingTriggerReason = "probe-timeout" | "slow-completion";
export type AdaptivePreviewConcreteActivationReason =
  | "probe-timeout"
  | "consecutive-slow"
  | "diagnostic-force";
export type AdaptivePreviewActivationReason =
  | "none"
  | AdaptivePreviewConcreteActivationReason
  | "mixed";
export type ShapeOccupancyFallbackReason =
  | "none"
  | "minimum-radius"
  | "mip-out-of-range"
  | "coverage-too-dense"
  | "mixed";
export type ThicknessDynamicsPreviewStrategy = "predictive-webgpu-tail-overlay";

export interface BrushSettings {
  tool: BrushTool;
  shape: BrushShape;
  shapeScatter: number;
  grainMode: GrainMode;
  grainScale: number;
  grainDepth: number;
  grainBrightness: number;
  grainContrast: number;
  grainInvert: boolean;
  grainFiltering: GrainFiltering;
  grainBlendMode: GrainBlendMode;
  color: string;
  size: number;
  spacingPercent: number;
  startThickness: number;
  endThickness: number;
  count: number;
  flow: number;
  opacity: number;
  hardness: number;
  blendIntensity: number;
  blendMode: BlendMode;
  blendStretch: number;
  blendPaint: number;
  jitterMaster: number;
  hueJitterDegrees: number;
  saturationJitter: number;
  lightnessJitter: number;
  darknessJitter: number;
  jitterPerCopy: boolean;
  positionJitterLateral: number;
  positionJitterLinear: number;
}

export interface AdaptiveSpacingEvent {
  offsetMs: number;
  reason: AdaptiveSpacingTriggerReason;
  spacingPercent: number;
  extraPercentPoints: number;
  backlogBaseStamps: number;
  generatedBaseStamps: number;
}

export interface PointerSample {
  clientX: number;
  clientY: number;
  pressure: number;
  timeMs: number;
}

export interface MixedSceneSnapshot {
  strategy: typeof MIXED_SCENE_STACK_STRATEGY;
  selectedKey: MixedSceneItem["key"];
  activeRasterLayerId: number;
  previewTextNodeId: number | null;
  items: readonly (
    | {
      key: `raster:${number}`;
      kind: "raster";
      rasterLayerId: number;
      rasterLayerIndex: number;
    }
    | {
      key: `text:${number}`;
      kind: "text";
      textNode: Readonly<VectorTextNode>;
    }
  )[];
}

export interface EngineGpuMemoryStats {
  layerBaseMiB: number;
  layerColdMiB: number;
  // RAM CPU dei cold store compressi: visibile ma esclusa dal totale GPU.
  layerCompressedCpuMiB: number;
  layerCompressedRawMiB: number;
  layerHydrationMiB: number;
  layerMipChainMiB: number;
  layerBakeMiB: number;
  layerCompositeMiB: number;
  grainTextureMiB: number;
  shapeTextureMiB: number;
  paintBuffersMiB: number;
  presentationCacheMiB: number;
  vectorTextPresentationMiB: number;
  rasterStrokeStyledMiB: number;
  rasterStrokeCoverageMiB: number;
  rasterStrokeMaskAndControlMiB: number;
  effectsScratchPoolMiB: number;
  effectsScratchPoolPeakMiB: number;
  effectsScratchStrokeExtent: number;
  effectsScratchBevelExtent: number;
  effectsScratchOuterShadowExtent: number;
  effectsScratchInnerShadowExtent: number;
  rasterOuterShadowMatteMiB: number;
  rasterOuterShadowControlMiB: number;
  rasterInnerShadowMatteMiB: number;
  rasterInnerShadowControlMiB: number;
  rasterBevelHeightMiB: number;
  rasterBevelLutAndControlMiB: number;
  rasterBevelFieldBounded: boolean;
  rasterBevelFieldAllocationBounds: RasterBevelRect | null;
  rasterBevelFieldValidBounds: RasterBevelRect | null;
  rasterBevelFieldTextureWidth: number;
  rasterBevelFieldTextureHeight: number;
  rasterBevelFieldGeneration: number;
  rasterBevelFieldAllocationCount: number;
  rasterBevelFieldShrinkCount: number;
  blendRendererMiB: number;
  lightGlazeMiB: number;
  thicknessTailMiB: number;
  // RAM CPU del journal Undo/Redo (32 B per stamp): mostrata nel monitor ma
  // esclusa dal totale GPU conteggiato.
  historyCpuMiB: number;
  countedTotalMiB: number;
}

export interface LayerStorageLayerEstimate {
  id: number;
  name: string;
  active: boolean;
  hasContent: boolean;
  hotAllocated: boolean;
  coldTileCount: number;
  compressed: boolean;
  compressedCpuMiB: number;
  compressedRawMiB: number;
  actualRawMiB: number;
  conservativeTileCount: number;
  alignedBboxTileCount: number;
  conservativeTileMiB: number;
  alignedBboxMiB: number;
}

/**
 * Actual hot/cold raw storage plus the two counterfactual projections retained
 * from 14a. Only actualRawMiB contributes to counted GPU memory.
 */
export interface LayerStorageStudyStats {
  strategy: typeof LAYER_STORAGE_STRATEGY;
  measurementOnly: false;
  tileSizePx: typeof LAYER_STORAGE_TILE_SIZE;
  gridSize: typeof LAYER_STORAGE_GRID_SIZE;
  tileCount: typeof LAYER_STORAGE_TILE_COUNT;
  bytesPerPixel: 4 | 8;
  fullLayerMiB: number;
  eagerFullRawMiB: number;
  actualRawMiB: number;
  inactiveFullMiB: number;
  inactiveConservativeTileMiB: number;
  inactiveAlignedBboxMiB: number;
  projectedConservativeRawMiB: number;
  projectedAlignedBboxRawMiB: number;
  conservativeSavingsMiB: number;
  alignedBboxSavingsMiB: number;
  layers: readonly LayerStorageLayerEstimate[];
}

export interface LayerStorageExactLayerMeasurement extends LayerStorageLayerEstimate {
  exactTileCount: number;
  exactTileMiB: number;
  missedExactTiles: number;
  conservativelyExtraTiles: number;
}

export interface LayerStorageExactStudy {
  strategy: typeof LAYER_STORAGE_STRATEGY;
  reference: "any-nonzero-raw-byte";
  tileSizePx: typeof LAYER_STORAGE_TILE_SIZE;
  bytesPerPixel: 4 | 8;
  eagerFullRawMiB: number;
  actualRawMiB: number;
  projectedExactRawMiB: number;
  projectedConservativeRawMiB: number;
  projectedAlignedBboxRawMiB: number;
  exactSavingsMiB: number;
  totalMissedExactTiles: number;
  totalConservativelyExtraTiles: number;
  countedGpuMiBBefore: number;
  countedGpuMiBAfter: number;
  temporaryReadbackMiBBefore: number;
  temporaryReadbackMiBAfter: number;
  temporaryReadbackPeakMiB: number;
  layers: readonly LayerStorageExactLayerMeasurement[];
}

export interface EngineStats {
  fps: number;
  lastCpuFrameMs: number;
  totalBaseStamps: number;
  avoidedLogicalDraws: number;
  layerMemoryMiB: number;
  layerCount: number;
  activeLayerId: number;
  mixedScene: MixedSceneSnapshot | null;
  layerBakeStrategy: typeof LAYER_BAKE_STRATEGY;
  layerCompositeStrategy: typeof LAYER_COMPOSITE_STRATEGY;
  layerStorageStudy: LayerStorageStudyStats;
  layers: readonly {
    id: number;
    name: string;
    visible: boolean;
    opacity: number;
    hasContent: boolean;
    hotAllocated: boolean;
    coldTileCount: number;
    compressed: boolean;
    compressedCpuMiB: number;
    compressedRawMiB: number;
    actualRawMiB: number;
    conservativeTileCount: number;
    alignedBboxTileCount: number;
    conservativeTileMiB: number;
    alignedBboxMiB: number;
    bakeAllocated: boolean;
    bakeValid: boolean;
    bakeGeneration: number;
  }[];
  activeLayerIndex: number;
  layerColdCompressionEnabled: boolean;
  layerColdCompressionRuntimeBuild: string | null;
  layerColdCompressionWorkerUnavailable: boolean;
  layerColdCompressionProgress: {
    layerId: number;
    completedTileCount: number;
    totalTileCount: number;
    storedCpuMiB: number;
    pausedByStroke: boolean;
  } | null;
  rasterStrokeStyle: RasterStrokeStyle;
  rasterStrokePersistentMemoryMiB: number;
  rasterStrokeScratchMemoryMiB: number;
  rasterStrokeBuilds: number;
  rasterStrokeComposes: number;
  rasterStrokeRendererBuild: string | null;
  rasterBevelStyle: RasterBevelStyle;
  rasterBevelPersistentMemoryMiB: number;
  rasterBevelScratchMemoryMiB: number;
  rasterBevelBuilds: number;
  rasterBevelPasses: number;
  rasterBevelRendererBuild: string | null;
  rasterOuterShadowStyle: RasterOuterShadowStyle;
  rasterOuterShadowPersistentMemoryMiB: number;
  rasterOuterShadowScratchMemoryMiB: number;
  rasterOuterShadowBuilds: number;
  rasterOuterShadowPasses: number;
  rasterOuterShadowRendererBuild: string | null;
  rasterInnerShadowStyle: RasterInnerShadowStyle;
  rasterInnerShadowPersistentMemoryMiB: number;
  rasterInnerShadowScratchMemoryMiB: number;
  rasterInnerShadowBuilds: number;
  rasterInnerShadowPasses: number;
  rasterInnerShadowRendererBuild: string | null;

  gpuMemory: EngineGpuMemoryStats;
  gpuLabel: string;
  layerFormat: LayerFormat;
  effectsWorkingSetStrategy: typeof EFFECTS_WORKING_SET_STRATEGY;
  effectsWorkingSetGeneration: number;
  effectsWorkingSetSourceFormat: LayerFormat;
  effectsScratchPoolStrategy: typeof EFFECTS_SCRATCH_POOL_STRATEGY;
  effectsScratchPoolCurrentMiB: number;
  effectsScratchPoolPeakMiB: number;
  effectsScratchPoolGeneration: number;
  effectsScratchPoolAllocationCount: number;
  effectsScratchPoolShrinkCount: number;
}

export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  busy: boolean;
  /** A rollback failed; editing stays locked until the page is reloaded. */
  inconsistent: boolean;
  actionCount: number;
  cursor: number;
  storedBaseStamps: number;
  logicalStampBytes: number;
}

export interface BenchmarkResult {
  baseStamps: number;
  logicalCopies: number;
  cpuSubmitMs: number;
  gpuCompletionMs: number;
  estimatedCoveredFragments: number;
  strategy: string;
}

export interface EffectsWorkbenchRetargetResult {
  strategy: typeof EFFECTS_WORKING_SET_STRATEGY;
  generation: number;
  layerFormat: LayerFormat;
  contentBounds: DirtyRect | null;
  contentPixels: number;
  fullDocumentPixels: number;
  cpuRetargetAndEncodeMs: number;
  queueCompletionMs: number;
  totalMs: number;
  stroke: RasterStrokeEncodeResult | null;
  bevel: RasterBevelEncodeResult | null;
  outerShadow: RasterShadowEncodeResult | null;
  innerShadow: RasterShadowEncodeResult | null;
}

export interface StrokePerformanceProfile {
  stampGeometry: StampGeometry;
  stampVerticesPerCopy: number;
  fragmentCoverageStrategy: FragmentCoverageStrategy;
  shapeSamplingStrategy: ShapeSamplingStrategy;
  shapeMaskDecodeStrategy: ShapeMaskDecodeStrategy;
  shapeOccupancyFallbackReason: ShapeOccupancyFallbackReason;
  shapeOccupancyGridSize: number;
  shapeOccupancyMipLevel: number;
  shapeOccupancyActiveCells: number;
  shapeOccupancyCoverageRatio: number;
  shapeOccupancyCandidateMipLevel: number;
  shapeOccupancyCandidateActiveCells: number;
  shapeOccupancyCandidateCoverageRatio: number;
  shapeOccupancyMaximumMip: number;
  shapeOccupancyMinimumRadius: number;
  shapeOccupancyMaximumCoverageRatio: number;
  shapeOccupancyBitmaskBytes: number;
  colorSeedStrategy: "reuse-position-copy-seed";
  dirtyRectStrategy: "directional-jitter-bounds";
  thicknessDynamicsStrategy: ThicknessDynamicsStrategy;
  thicknessDynamicsTaperWindowMs: number;
  thicknessDynamicsHeldBaseStamps: number;
  thicknessDynamicsMaximumHeldBaseStamps: number;
  thicknessDynamicsReleasedDuringStroke: number;
  thicknessDynamicsReleasedAtLift: number;
  thicknessDynamicsPreviewStrategy: ThicknessDynamicsPreviewStrategy;
  thicknessDynamicsPreviewTextureQuantum: number;
  thicknessDynamicsPreviewMaximumTextureDimension: number;
  thicknessDynamicsPreviewFrames: number;
  thicknessDynamicsPreviewBaseStamps: number;
  thicknessDynamicsPreviewPhysicalCopies: number;
  thicknessDynamicsPreviewMaximumTexturePixels: number;
  thicknessDynamicsPreviewAdditionalMemoryMiB: number;
  presentationCacheStrategy: PresentationCacheStrategy;
  presentationTransferStrategy: PresentationTransferStrategy;
  presentationCacheFullRebuilds: number;
  presentationCachePartialUpdates: number;
  presentationCacheOffscreenSkips: number;
  presentationCacheLod0FullRebuildTraceEnabledPasses: number;
  presentationCacheLod0FullRebuildTraceEnabledCpuEncodingMs: number;
  presentationCacheLod0FullRebuildTraceDisabledPasses: number;
  presentationCacheLod0FullRebuildTraceDisabledCpuEncodingMs: number;
  presentationCacheUpdatedPixels: number;
  legacyDisplayShaderPixels: number;
  presentationCopiedPixels: number;
  paintDisplayPyramidStrategy: PaintDisplayPyramidStrategy;
  paintDisplayLodSelectionStrategy: PaintDisplayLodSelectionStrategy;
  paintDisplayMipLevelCount: number;
  paintDisplaySelectedMipLevel: number;
  paintDisplayMaximumSelectedMipLevel: number;
  paintDisplayPyramidAdditionalMemoryMiB: number;
  paintDisplayPyramidMaintenanceFrames: number;
  paintDisplayPyramidFullLevelBuilds: number;
  paintDisplayPyramidDirtyLevelUpdates: number;
  paintDisplayPyramidPasses: number;
  paintDisplayPyramidBaseDirtyPixels: number;
  paintDisplayPyramidUpdatedPixels: number;
  paintDisplayPyramidEncodingMs: number;
  adaptivePreviewStrategy: AdaptivePreviewStrategy;
  adaptivePreviewTriggerStrategy: AdaptivePreviewTriggerStrategy;
  adaptivePreviewStaleFrameStrategy: AdaptivePreviewStaleFrameStrategy;
  adaptivePreviewVisibleCanvasStrategy: AdaptivePreviewVisibleCanvasStrategy;
  adaptivePreviewVisibleCanvasRequestedDesynchronized: boolean;
  adaptivePreviewVisibleCanvasAlpha: boolean | null;
  adaptivePreviewVisibleCanvasDesynchronized: boolean | null;
  adaptivePreviewVisibleCanvasColorSpace: string | null;
  adaptivePreviewScratchCanvasAlpha: boolean | null;
  adaptivePreviewScratchCanvasDesynchronized: boolean | null;
  adaptivePreviewScratchCanvasColorSpace: string | null;
  adaptivePreviewExactLinearScale: number;
  adaptivePreviewJsBudgetMs: number;
  adaptivePreviewMaxTipBaseStamps: number;
  adaptivePreviewMaxPatchCssPixels: number;
  adaptivePreviewProbeIntervalSubmissions: number;
  adaptivePreviewTriggerThresholdMs: number;
  adaptivePreviewSlowCompletionThresholdMs: number;
  adaptivePreviewTriggerConsecutiveProbes: number;
  adaptivePreviewProbeNearMissMinimumMs: number;
  adaptivePreviewProbeStarts: number;
  adaptivePreviewProbeResolvedFast: number;
  adaptivePreviewProbeResolvedSlow: number;
  adaptivePreviewProbeTimeouts: number;
  adaptivePreviewProbeCancellations: number;
  adaptivePreviewProbeRejections: number;
  adaptivePreviewProbeNearMisses: number;
  adaptiveSpacingStrategy: AdaptiveSpacingStrategy;
  adaptiveSpacingStepPercentPoints: number;
  adaptiveSpacingMaxExtraPercentPoints: number;
  adaptiveSpacingInitialPercent: number;
  adaptiveSpacingFinalPercent: number;
  adaptiveSpacingIncreaseCount: number;
  adaptiveSpacingReachedMaximum: boolean;
  adaptiveSpacingEvents: AdaptiveSpacingEvent[];
  brushOpacityStrategy: BrushOpacityStrategy;
  grainStrategy: GrainStrategy;
  grainCoordinateStrategy: GrainCoordinateStrategy;
  grainSamplingStrategy: GrainSamplingStrategy;
  grainMipStrategy: GrainMipStrategy;
  grainTextureFormat: "rgba8unorm";
  grainTextureWidth: number;
  grainTextureHeight: number;
  grainTextureMipLevelCount: number;
  grainTextureMemoryMiB: number;
  grainTextureIdentity: number;
  grainPipelineStrategy: GrainPipelineStrategy;
  grainCoverageStrategy: GrainCoverageStrategy;
  grainAdaptivePreviewStrategy: GrainAdaptivePreviewStrategy;
  grainStartupDecodeMs: number;
  grainStartupMipBuildMs: number;
  grainStartupUploadMs: number;
  grainBatches: number;
  grainBaseStamps: number;
  grainPhysicalCopies: number;
  grainCircleBatches: number;
  grainShapeBatches: number;
  grainAdaptivePreviewSkips: number;
  lightGlazeStrategy: LightGlazeStrategy;
  lightGlazeAdaptivePreviewStrategy: LightGlazeAdaptivePreviewStrategy;
  lightGlazeStorageAllocated: boolean;
  lightGlazeStorageMode: LightGlazeStorageMode;
  lightGlazeAdditionalMemoryMiB: number;
  lightGlazeBatches: number;
  lightGlazeCommits: number;
  lightGlazeCompositePixels: number;
  lightGlazePyramidPasses: number;
  lightGlazePyramidUpdatedPixels: number;
  adaptivePreviewActivations: number;
  adaptivePreviewActivationReason: AdaptivePreviewActivationReason;
  adaptivePreviewFirstActivationReason: AdaptivePreviewConcreteActivationReason | null;
  adaptivePreviewFirstActivationMs: number | null;
  adaptivePreviewSecondActivationReason: AdaptivePreviewConcreteActivationReason | null;
  adaptivePreviewSecondActivationMs: number | null;
  adaptivePreviewFrames: number;
  adaptivePreviewBaseStampsDrawn: number;
  adaptivePreviewPhysicalCopiesDrawn: number;
  adaptivePreviewBudgetSkips: number;
  adaptivePreviewConfirmedStaleBitmapHides: number;
  adaptivePreviewIncompleteFrameRetryRequests: number;
  adaptivePreviewOversizedSkips: number;
  adaptivePreviewPatchPixels: number;
  adaptivePreviewMaxPatchBackingPixels: number;
  adaptivePreviewJsTotalMs: number;
  adaptivePreviewJsP50Ms: number;
  adaptivePreviewJsP95Ms: number;
  adaptivePreviewJsMaxMs: number;
  adaptivePreviewMaxLifetimeMs: number;
  adaptivePreviewProbeLatencyP50Ms: number;
  adaptivePreviewProbeLatencyP95Ms: number;
  adaptivePreviewMaxQueueProbeLatencyMs: number;
  adaptivePreviewProbeBacklogP50BaseStamps: number;
  adaptivePreviewProbeBacklogP95BaseStamps: number;
  adaptivePreviewProbeBacklogMaxBaseStamps: number;
  adaptivePreviewProbeTimeoutLatenessP50Ms: number;
  adaptivePreviewProbeTimeoutLatenessP95Ms: number;
  adaptivePreviewProbeTimeoutLatenessMaxMs: number;
  adaptivePreviewMaxUnconfirmedBaseStamps: number;
  adaptivePreviewRetirements: number;
  adaptivePreviewFrozenAtLift: number;
  adaptivePreviewLiftPendingBaseStamps: number;
  adaptivePreviewLiftPendingSerialBindings: number;
  adaptivePreviewUnsupportedBlendSkips: number;
  adaptivePreviewDeferredBaseStamps: number;
  adaptivePreviewResolvedBaseStamps: number;
  adaptivePreviewExactReplayBatches: number;
  adaptivePreviewLiftGpuSubmissions: number;
  adaptivePreviewExactBaseStampsSubmitted: number;
  adaptivePreviewExactBatchesSubmitted: number;
  historyStorageStrategy: HistoryStorageStrategy;
  historyReplayStrategy: HistoryReplayStrategy;
  historyStampRetentionStrategy: HistoryStampRetentionStrategy;
  historyCapturedBaseStamps: number;
  historyCapturedBatches: number;
  historyCommittedActions: number;
  historyStoredBaseStampsAtEnd: number;
  historyLogicalStampBytesAtEnd: number;
  historyReplayOperations: number;
  baseStamps: number;
  physicalCopies: number;
  renderFrames: number;
  brushBatches: number;
  largestBatchStamps: number;
  estimatedScissorPixels: number;
  stampGenerationMs: number;
  stampPackingMs: number;
  instanceUploadMs: number;
  brushEncodingMs: number;
  displayEncodingMs: number;
  commandSubmitMs: number;
  submitImmediateP50Ms: number;
  submitImmediateP95Ms: number;
  submitImmediateMaxMs: number;
  renderFrameTotalP50Ms: number;
  renderFrameTotalP95Ms: number;
  renderFrameTotalMaxMs: number;
  renderFrameOverheadP50Ms: number;
  renderFrameOverheadP95Ms: number;
  renderFrameOverheadMaxMs: number;
  resizeCanvasTotalMs: number;
  batchExtractionTotalMs: number;
  statsPublishTotalMs: number;
  cpuFrameP50Ms: number;
  cpuFrameP95Ms: number;
  cpuFrameMaxMs: number;
  renderIntervalP50Ms: number;
  renderIntervalP95Ms: number;
  renderIntervalMaxMs: number;
  averageRenderFps: number;
  delayedRenderFrames: number;
}

export interface EngineCallbacks {
  onStatus?: (message: string, kind: "working" | "ok" | "error") => void;
  onStats?: (stats: EngineStats) => void;
  onHistoryChange?: (state: HistoryState) => void;
  onViewRotationChange?: (degrees: number, snappedToZero: boolean) => void;
  onViewChange?: (state: VectorTextViewState) => void;
  onMixedSceneChange?: (snapshot: MixedSceneSnapshot) => void;
  /**
   * A global undo can move the active layer, so the UI has to be told: without
   * this the layer panel would keep highlighting the layer the user left.
   */
  onActiveLayerChange?: (activeIndex: number) => void;
}

export interface BrushEngineOptions {
  bevelBoundingFieldEnabled?: boolean;
  /**
   * Enables the destructive, query-gated layer memory stress fixture. Normal
   * application sessions never need to reserve deliberately pessimistic cold
   * tile capacity, so the public helper remains unavailable unless the page
   * opted into that fixture before constructing the engine.
   */
  layerMemoryStressTestEnabled?: boolean;
  /**
   * Enables the query-gated, measurement-only lossless compression study.
   * Normal sessions never read cold textures back to JavaScript.
   */
  layerCompressionTestEnabled?: boolean;
  /**
   * Enables the query-gated runtime experiment: one distant inactive RGBA8
   * cold store may move from GPU tiles to lossless CPU bytes in a worker.
   */
  layerColdCompressionEnabled?: boolean;
  /**
   * Enables the local, query-gated mixed raster/vector text prototype. The
   * ordinary application does not compile its extra pipeline or allocate its
   * viewport texture.
   */
  vectorTextPrototypeEnabled?: boolean;
}

export interface LayerPoint {
  x: number;
  y: number;
  pressure: number;
  timeMs: number;
}

interface Stamp {
  x: number;
  y: number;
  radius: number;
  pressure: number;
  seed: number;
  directionX: number;
  directionY: number;
  historyActionId: number;
}

interface HeldThicknessStamp {
  stamp: Stamp;
  timeMs: number;
  baseRadius: number;
  liveThicknessFactor: number;
}

interface ActiveStroke {
  tool: BrushTool;
  lastInput: LayerPoint;
  startedAtMs: number;
  thicknessSettings: Pick<BrushSettings, "startThickness" | "endThickness">;
  thicknessDynamicsNeutral: boolean;
  thicknessTailHoldback: boolean;
  heldThicknessStamps: HeldThicknessStamp[];
  heldThicknessHead: number;
  distanceSinceStamp: number;
  adaptiveSpacingInitialPercent: number;
  adaptiveSpacingPercent: number;
  historyActionId: number;
  historyCommitted: boolean;
  submitted: boolean;
  seedSequenceBeforeStroke: number;
  historyCursorBeforeStroke: number;
  redoActionsBeforeStroke: HistoryAction[] | null;
  historyCompactionPendingBeforeStroke: boolean;
  lightGlazeSettings: BrushSettings | null;
  blendSettings: BrushSettings | null;
  blendPlanner: DryBlendPlanner | null;
}

interface LightGlazeSession {
  historyActionId: number;
  settings: BrushSettings;
  dirtyRect: DirtyRect | null;
  needsClear: boolean;
  hasContent: boolean;
  endRequested: boolean;
  commitRequested: boolean;
  mipValidThroughLevel: number;
  tintLinear: [number, number, number] | null;
}

interface DirtyRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LayerTextureResources {
  texture: GPUTexture;
  view: GPUTextureView;
  samplingView: GPUTextureView;
}

interface DisplayPyramidResources {
  texture: GPUTexture;
  samplingView: GPUTextureView;
  mipViews: GPUTextureView[];
}

interface MergedSurfaceResources {
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

interface MixedSceneRasterSegmentResources {
  key: Extract<MixedSceneCompositionSegment, { kind: "raster-run" }>["key"];
  surface: MergedSurfaceResources;
  uniformBuffer: GPUBuffer;
  bindGroup: GPUBindGroup;
}

interface VectorTextRunTextureResources {
  texture: GPUTexture;
  view: GPUTextureView;
  bindGroup: GPUBindGroup;

  lastBounds: DirtyRect | null;
  initialized: boolean;
}

interface VectorTextGpuMeshResources {
  revision: string;
  kind: "mesh";
  vertexBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;
  indexCount: number;
  memoryBytes: number;
}

interface VectorTextGpuSlugResources {
  kind: "slug";
  revision: string;
  curveTexture: GPUTexture;
  bandTexture: GPUTexture;
  bindGroup: GPUBindGroup;
  curveCount: number;
  memoryBytes: number;
}

type VectorTextGpuDrawResources =
  | VectorTextGpuMeshResources
  | VectorTextGpuSlugResources;

interface VectorTextGpuBlurCacheResources {
  texture: GPUTexture;
  view: GPUTextureView;
  compositeBindGroup: GPUBindGroup;
  innerShadowBindGroup: GPUBindGroup;
  width: number;
  height: number;
  memoryBytes: number;
  needsBuild: boolean;
}

interface VectorTextGpuPendingRun {
  placement: Extract<VectorTextPlacement, `text-run:${string}`>;
  resources: VectorTextRunTextureResources;
  draws: readonly VectorTextGpuDraw[];
  drawResources: readonly VectorTextGpuDrawResources[];
  blurResources: readonly (VectorTextGpuBlurCacheResources | null)[];
  view: VectorTextViewState;

  bounds: DirtyRect;
}

type MixedSceneActivePresentation =
  | { kind: "base" }
  | { kind: "thickness-tail" }
  | { kind: "light-glaze" }
  | { kind: "raster-stroke"; sourceMode: RasterStrokeSourceMode };

interface LayerBakeResources {
  texture: GPUTexture;
  storageView: GPUTextureView;
  samplingView: GPUTextureView;
  memoryBytes: number;
  generation: number;
  nonTransparentBounds: DirtyRect;
}

interface LayerColdStorageResources {
  texture: GPUTexture;
  tileIndices: readonly number[];
  memoryBytes: number;
  generation: number;
}

interface LayerCompressedColdStorageResources {
  tileIndices: readonly number[];
  chunks: readonly LayerColdCompressedChunk[];
  rawBytes: number;
  storedBytes: number;
  sourceHash: number;
  generation: number;
  encodeMs: number;
}

interface LayerColdCompressionProgress {
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
type LayerGpuResources = {
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
type EffectsRetargetCaller = "public" | "layer-switch" | "history-replay";

export type HistoryReplayFaultPoint =
  | "during-switch-activation"
  | "after-first-replay-submit";

export type LayerBakeFaultPoint = "after-candidate-submit";
export type LayerCompositeFaultPoint = "after-candidate-submit";
export type LayerColdStorageFaultPoint =
  | "after-pack-submit"
  | "after-hydrate-submit";

type LayerGpuCompletionPolicy =
  | "await-immediately"
  | "defer-to-fold-fence";

type LayerEffectsRebuildDomain =
  | "full-document"
  | "content-bounds";

export interface LayerSwitchResult {
  fromIndex: number;
  toIndex: number;
  layerId: number;
  /** Wall clock across the whole switch, including the field rebuild. */
  totalMs: number;
  /** The dominant incoming-layer term: retarget plus effect-field rebuild. */
  effectsMs: number;
  /** Rebuild and transactional publication of mergedBelow/mergedAbove. */
  compositeMs: number;
  /**
   * Generation of the effects working set after the retarget. Deliberately not a
   * "pyramid rebuilt through level" figure: the switch only invalidates the
   * pyramid, and the next frame is what rebuilds it up to the selected level.
   */
  effectsGeneration: number;
  contentBoundsRestored: boolean;
}

interface PackedStampUpload {
  dirtyRect: DirtyRect | null;
  minimumRadius: number;
}

interface ThicknessTailFrame {
  settings: BrushSettings;
  stamps: Stamp[];
  dirtyRect: DirtyRect;
  shapeOccupancySelection: ShapeOccupancySelection | null;
  grainActive: boolean;
}

interface ShapeMaskResources {
  texture: GPUTexture;
  decodeStrategy: ShapeMaskDecodeStrategy;
  identity: number;
  occupancyWords: Uint32Array;
  occupancyActiveCells: number[];
  occupancyCoverageRatios: number[];
  previewSprite: HTMLCanvasElement;
}

interface GrainTextureResources {
  texture: GPUTexture;
  identity: number;
  decodeMs: number;
  mipBuildMs: number;
  uploadMs: number;
}

interface AdaptivePreviewCandidate {
  serial: number | null;
  stamp: Stamp;
  settings: BrushSettings;
  presented: boolean;
}

interface AdaptivePreviewProbe {
  generation: number;
  startedAt: number;
  prefixSerial: number;
  timeout: number;
  spacingIncreaseApplied: boolean;
  telemetryProfile: MutableStrokePerformanceProfile | null;
}

interface AdaptivePreviewCopy {
  x: number;
  y: number;
  radius: number;
  rotation: number;
  alpha: number;
  candidateIndex: number;
  red: number;
  green: number;
  blue: number;
  color: string;
}

interface AdaptivePreviewShapePaletteEntry {
  red: number;
  green: number;
  blue: number;
  sprite: HTMLCanvasElement;
}

interface ShapeOccupancySelection {
  selectedMipLevel: number | null;
  fallbackReason: Exclude<ShapeOccupancyFallbackReason, "mixed">;
  candidateMipLevel: number;
  candidateActiveCells: number;
  candidateCoverageRatio: number;
}

interface HistoryAction {
  id: number;
  kind: "stroke" | "clear";
  /**
   * Which layer the action belongs to. The stack stays global so undo walks the
   * user's actions in the order they happened, but visibility is resolved per
   * layer: a clear on one layer must not hide another layer's strokes.
   */
  layerId: number;
}

interface PaintHistoryRenderBatch {
  kind: "paint";
  layerId: number;
  settings: BrushSettings;
  stamps: Stamp[];
  clearLayer: boolean;
  dirtyRect: DirtyRect | null;
  shapeOccupancySelection: ShapeOccupancySelection | null;
  shapeMaskIdentity: number;
  grainTextureIdentity: number | null;
}

interface BlendHistoryRenderBatch {
  kind: "blend";
  actionId: number;
  layerId: number;
  settings: BrushSettings;
  batches: DryBlendRenderBatch[];
  clearLayer: boolean;
  dirtyRect: DirtyRect | null;
  shapeMaskIdentity: number;
  grainTextureIdentity: number | null;
}

type HistoryRenderBatch = PaintHistoryRenderBatch | BlendHistoryRenderBatch;

interface PendingBlendBatch {
  actionId: number;
  settings: BrushSettings;
  batch: DryBlendRenderBatch;
}

interface SubmitTiming {
  totalCpuMs: number;
  stampPackingMs: number;
  instanceUploadMs: number;
  brushEncodingMs: number;
  displayEncodingMs: number;
  commandSubmitMs: number;
  scissorPixels: number;
  dirtyRect: DirtyRect | null;
  shapeOccupancySelection: ShapeOccupancySelection | null;
  presentationCacheFullRebuilds: number;
  presentationCachePartialUpdates: number;
  presentationCacheOffscreenSkips: number;
  presentationCacheLod0FullRebuildTraceEnabledPasses: number;
  presentationCacheLod0FullRebuildTraceEnabledCpuEncodingMs: number;
  presentationCacheLod0FullRebuildTraceDisabledPasses: number;
  presentationCacheLod0FullRebuildTraceDisabledCpuEncodingMs: number;
  presentationCacheUpdatedPixels: number;
  legacyDisplayShaderPixels: number;
  presentationCopiedPixels: number;
  displaySelectedMipLevel: number;
  paintDisplayPyramidMaintenanceFrames: number;
  paintDisplayPyramidFullLevelBuilds: number;
  paintDisplayPyramidDirtyLevelUpdates: number;
  paintDisplayPyramidPasses: number;
  paintDisplayPyramidBaseDirtyPixels: number;
  paintDisplayPyramidUpdatedPixels: number;
  paintDisplayPyramidEncodingMs: number;
  lightGlazeBatches: number;
  lightGlazeCommits: number;
  lightGlazeCompositePixels: number;
  lightGlazePyramidPasses: number;
  lightGlazePyramidUpdatedPixels: number;
  grainBatches: number;
  grainBaseStamps: number;
  grainPhysicalCopies: number;
  grainCircleBatches: number;
  grainShapeBatches: number;
}

interface RenderFrameTiming {
  totalCpuMs: number;
  resizeCanvasMs: number;
  batchExtractionMs: number;
  statsPublishMs: number;
}

interface MutableStrokePerformanceProfile {
  startedAt: number;
  stampGeometry: StampGeometry;
  stampVerticesPerCopy: number;
  fragmentCoverageStrategy: FragmentCoverageStrategy;
  shapeSamplingStrategy: ShapeSamplingStrategy;
  shapeOccupancyFallbackReason: ShapeOccupancyFallbackReason;
  shapeOccupancyMipLevel: number;
  shapeOccupancyActiveCells: number;
  shapeOccupancyCoverageRatio: number;
  shapeOccupancyCandidateMipLevel: number;
  shapeOccupancyCandidateActiveCells: number;
  shapeOccupancyCandidateCoverageRatio: number;
  historyCapturedBaseStamps: number;
  historyCapturedBatches: number;
  historyCommittedActions: number;
  historyReplayOperations: number;
  baseStamps: number;
  physicalCopies: number;
  renderFrames: number;
  brushBatches: number;
  largestBatchStamps: number;
  estimatedScissorPixels: number;
  thicknessDynamicsHeldBaseStamps: number;
  thicknessDynamicsMaximumHeldBaseStamps: number;
  thicknessDynamicsReleasedDuringStroke: number;
  thicknessDynamicsReleasedAtLift: number;
  thicknessDynamicsPreviewFrames: number;
  thicknessDynamicsPreviewBaseStamps: number;
  thicknessDynamicsPreviewPhysicalCopies: number;
  thicknessDynamicsPreviewMaximumTexturePixels: number;
  presentationCacheFullRebuilds: number;
  presentationCachePartialUpdates: number;
  presentationCacheOffscreenSkips: number;
  presentationCacheLod0FullRebuildTraceEnabledPasses: number;
  presentationCacheLod0FullRebuildTraceEnabledCpuEncodingMs: number;
  presentationCacheLod0FullRebuildTraceDisabledPasses: number;
  presentationCacheLod0FullRebuildTraceDisabledCpuEncodingMs: number;
  presentationCacheUpdatedPixels: number;
  legacyDisplayShaderPixels: number;
  presentationCopiedPixels: number;
  paintDisplayMaximumSelectedMipLevel: number;
  paintDisplayPyramidMaintenanceFrames: number;
  paintDisplayPyramidFullLevelBuilds: number;
  paintDisplayPyramidDirtyLevelUpdates: number;
  paintDisplayPyramidPasses: number;
  paintDisplayPyramidBaseDirtyPixels: number;
  paintDisplayPyramidUpdatedPixels: number;
  paintDisplayPyramidEncodingMs: number;
  adaptivePreviewProbeStarts: number;
  adaptivePreviewProbeResolvedFast: number;
  adaptivePreviewProbeResolvedSlow: number;
  adaptivePreviewProbeTimeouts: number;
  adaptivePreviewProbeCancellations: number;
  adaptivePreviewProbeRejections: number;
  adaptivePreviewProbeNearMisses: number;
  adaptivePreviewProbeLatencyMs: number[];
  adaptivePreviewProbeBacklogBaseStamps: number[];
  adaptivePreviewProbeTimeoutLatenessMs: number[];
  adaptiveSpacingInitialPercent: number;
  adaptiveSpacingFinalPercent: number;
  adaptiveSpacingEvents: AdaptiveSpacingEvent[];
  grainStrategy: GrainStrategy;
  grainCoordinateStrategy: GrainCoordinateStrategy;
  grainSamplingStrategy: GrainSamplingStrategy;
  grainCoverageStrategy: GrainCoverageStrategy;
  grainAdaptivePreviewStrategy: GrainAdaptivePreviewStrategy;
  grainBatches: number;
  grainBaseStamps: number;
  grainPhysicalCopies: number;
  grainCircleBatches: number;
  grainShapeBatches: number;
  grainAdaptivePreviewSkips: number;
  lightGlazeStrategy: LightGlazeStrategy;
  lightGlazeBatches: number;
  lightGlazeCommits: number;
  lightGlazeCompositePixels: number;
  lightGlazePyramidPasses: number;
  lightGlazePyramidUpdatedPixels: number;
  adaptivePreviewActivations: number;
  adaptivePreviewActivationReason: AdaptivePreviewActivationReason;
  adaptivePreviewFirstActivationReason: AdaptivePreviewConcreteActivationReason | null;
  adaptivePreviewFirstActivationMs: number | null;
  adaptivePreviewSecondActivationReason: AdaptivePreviewConcreteActivationReason | null;
  adaptivePreviewSecondActivationMs: number | null;
  adaptivePreviewFrames: number;
  adaptivePreviewBaseStampsDrawn: number;
  adaptivePreviewPhysicalCopiesDrawn: number;
  adaptivePreviewBudgetSkips: number;
  adaptivePreviewConfirmedStaleBitmapHides: number;
  adaptivePreviewIncompleteFrameRetryRequests: number;
  adaptivePreviewOversizedSkips: number;
  adaptivePreviewPatchPixels: number;
  adaptivePreviewMaxPatchBackingPixels: number;
  adaptivePreviewJsTotalMs: number;
  adaptivePreviewJsFrameMs: number[];
  adaptivePreviewMaxLifetimeMs: number;
  adaptivePreviewMaxQueueProbeLatencyMs: number;
  adaptivePreviewMaxUnconfirmedBaseStamps: number;
  adaptivePreviewRetirements: number;
  adaptivePreviewFrozenAtLift: number;
  adaptivePreviewLiftPendingBaseStamps: number;
  adaptivePreviewLiftPendingSerialBindings: number;
  adaptivePreviewUnsupportedBlendSkips: number;
  adaptivePreviewExactBaseStampsSubmitted: number;
  adaptivePreviewExactBatchesSubmitted: number;
  stampGenerationMs: number;
  stampPackingMs: number;
  instanceUploadMs: number;
  brushEncodingMs: number;
  displayEncodingMs: number;
  commandSubmitMs: number;
  cpuFrameMs: number[];
  renderFrameTotalMs: number[];
  renderFrameOverheadMs: number[];
  resizeCanvasMs: number;
  batchExtractionMs: number;
  statsPublishMs: number;
  renderIntervalMs: number[];
  previousFrameTimestamp: number | null;
}

const LAYER_SIZE = 4096;
const MEBIBYTE_BYTES = 1024 * 1024;
const PAINT_DISPLAY_MIP_LEVEL_COUNT = Math.floor(Math.log2(LAYER_SIZE)) + 1;
const STAMP_STRIDE_BYTES = 32;
const MAX_STAMPS_PER_BATCH = 65_536;
// Il drenaggio dei batch Blend è limitato dai pixel-pass per frame, non da un
// conteggio fisso per size: col renderer compute un segmento costa il deposit
// sulla propria writeRect più la quota di gather/scatter del gruppo (~2 pass
// equivalenti sulla readRect). Un budget in pixel lascia alle size piccole
// centinaia di segmenti per frame (il tratto resta attaccato al puntatore) e
// continua a proteggere il frame time sulle size grandi.
const DRY_BLEND_FRAME_PIXEL_BUDGET = 24_000_000;
const DRY_BLEND_MAX_BATCHES_PER_FRAME = 256;
const STAMP_VERTICES_PER_COPY = 4;
const STAMP_GEOMETRY = "quad" as const;
const CIRCLE_FRAGMENT_COVERAGE_STRATEGY = "generic-smoothstep" as const;
const SHAPE_FRAGMENT_COVERAGE_STRATEGY = "shape-alpha-mask-2k" as const;
const SHAPE_OCCUPANCY_STRATEGY = "coarse-occupancy-bitmask" as const;
const SHAPE_LEGACY_STRATEGY = "legacy-full-mask" as const;
const SHAPE_DIRECT_DECODE_STRATEGY = "png-gray8-direct" as const;
const SHAPE_CANVAS_DECODE_STRATEGY = "canvas-fallback" as const;
const COLOR_SEED_STRATEGY = "reuse-position-copy-seed" as const;
const DIRTY_RECT_STRATEGY = "directional-jitter-bounds" as const;
const PRESENTATION_CACHE_STRATEGY = "persistent-full-resolution-screen-cache" as const;
const PRESENTATION_TRANSFER_STRATEGY = "copy-texture-to-current-texture" as const;
const PAINT_DISPLAY_PYRAMID_STRATEGY = "live-dirty-box-filter-mip-chain" as const;
export const LAYER_BAKE_STRATEGY =
  "transient-analytic-bounded-visual-rect-no-handoff-residency-mip0-fused-into-two-merged-surfaces" as const;
export const LAYER_COMPOSITE_STRATEGY =
  "merged-above-over-active-over-merged-below-source-over-evict-derived-before-rebuild-deferred-to-fold-fence-bounded-visual-rect" as const;
const PAINT_DISPLAY_LOD_SELECTION_STRATEGY =
  "largest-power-of-two-without-upscaling" as const;
const BRUSH_OPACITY_STRATEGY = "per-stamp-uniform-alpha-multiplier" as const;
const GRAIN_DISABLED_STRATEGY = "disabled-legacy-pipeline" as const;
const GRAIN_FIXED_STRATEGY = "rgba8-native-2500-fixed-coverage-multiply" as const;
const GRAIN_MOVING_STRATEGY = "rgba8-native-2500-moving-coverage-multiply" as const;
const GRAIN_FIXED_COORDINATE_STRATEGY = "authoritative-layer-position" as const;
const GRAIN_MOVING_COORDINATE_STRATEGY = "stamp-local-position" as const;
const GRAIN_MIP_STRATEGY = "webgpu-wgsl-linear-full-chain" as const;
const GRAIN_PIPELINE_STRATEGY = "separate-opt-in-pipelines" as const;
const GRAIN_COVERAGE_STRATEGY = "post-tip-coverage-pre-alpha-multiply" as const;
const GRAIN_ADAPTIVE_PREVIEW_STRATEGY =
  "disabled-semantic-mismatch-probe-spacing-active" as const;
const LIGHT_GLAZE_STRATEGY =
  "lazy-stroke-mip0-format-quantized-composite-mips-single-commit" as const;
const M1_GLAZE_STRATEGY =
  "m1-r8-quantized-max-coverage-plus-composited-mips-single-commit" as const;
const LIGHT_GLAZE_ADAPTIVE_PREVIEW_STRATEGY = "disabled-semantic-mismatch" as const;
const LIGHT_GLAZE_STORAGE_LIFECYCLE_STRATEGY =
  "allocate-on-glaze-select-release-when-idle-deselected" as const;
const GRAIN_STORAGE_LIFECYCLE_STRATEGY =
  "allocate-on-grain-select-release-when-idle-unused" as const;
const SHAPE_STORAGE_LIFECYCLE_STRATEGY =
  "allocate-on-shape-select-release-when-idle-unused" as const;
const ADAPTIVE_PREVIEW_STRATEGY =
  "queue-lag-canvas2d-tip-patch" as const;
const THICKNESS_DYNAMICS_PREVIEW_STRATEGY =
  "predictive-webgpu-tail-overlay" as const;
const ADAPTIVE_PREVIEW_TRIGGER_STRATEGY = "single-sampled-queue-prefix-latency" as const;
const ADAPTIVE_PREVIEW_STALE_FRAME_STRATEGY =
  "hide-confirmed-stale-bitmap-and-single-raf-retry" as const;
const ADAPTIVE_PREVIEW_VISIBLE_CANVAS_STRATEGY =
  "iphone-desynchronized-others-synchronized-canvas2d" as const;
const ADAPTIVE_PREVIEW_EXACT_LINEAR_SCALE = 0.5;
const ADAPTIVE_PREVIEW_JS_BUDGET_MS = 1.25;
const ADAPTIVE_PREVIEW_COMMIT_BUDGET_RESERVE_MS = 0.2;
const ADAPTIVE_PREVIEW_MAX_TIP_BASE_STAMPS = 2;
const THICKNESS_TAIL_TEXTURE_QUANTUM = 256;
const THICKNESS_TAIL_MAXIMUM_TEXTURE_DIMENSION = LAYER_SIZE;
const ADAPTIVE_PREVIEW_MAX_PATCH_CSS_PIXELS = 384;
const ADAPTIVE_PREVIEW_MIN_PATCH_CSS_PIXELS = 32;
const ADAPTIVE_PREVIEW_PATCH_QUANTUM_CSS_PIXELS = 32;
const ADAPTIVE_PREVIEW_PATCH_MARGIN_CSS_PIXELS = 3;
const ADAPTIVE_PREVIEW_ALPHA_SCALE = 0.86;
const ADAPTIVE_PREVIEW_SHAPE_PALETTE_SIZE = 12;
const ADAPTIVE_PREVIEW_PROBE_INTERVAL_SUBMISSIONS = 4;
const ADAPTIVE_PREVIEW_TRIGGER_THRESHOLD_MS = 60;
const ADAPTIVE_PREVIEW_SLOW_COMPLETION_THRESHOLD_MS = 58;
const ADAPTIVE_PREVIEW_TRIGGER_CONSECUTIVE_PROBES = 2;
const ADAPTIVE_PREVIEW_PROBE_NEAR_MISS_MINIMUM_MS = 45;
const ADAPTIVE_SPACING_STRATEGY = "queue-lag-step-up-per-stroke" as const;
const ADAPTIVE_SPACING_STEP_PERCENT_POINTS = 0.25;
const ADAPTIVE_SPACING_MAX_EXTRA_PERCENT_POINTS = 1.5;
const ADAPTIVE_SPACING_ANDROID_MAX_EXTRA_PERCENT_POINTS = 4;
const ADAPTIVE_PREVIEW_FORCE = import.meta.env.DEV
  && typeof window !== "undefined"
  && new URLSearchParams(window.location.search).get("adaptivePreview") === "force";

interface AdaptivePreviewContextAttributes {
  alpha: boolean | null;
  desynchronized: boolean | null;
  colorSpace: string | null;
}

function readAdaptivePreviewContextAttributes(
  context: CanvasRenderingContext2D | null,
): AdaptivePreviewContextAttributes {
  if (!context || typeof context.getContextAttributes !== "function") {
    return { alpha: null, desynchronized: null, colorSpace: null };
  }
  const attributes = context.getContextAttributes();
  return {
    alpha: typeof attributes.alpha === "boolean" ? attributes.alpha : null,
    desynchronized: typeof attributes.desynchronized === "boolean"
      ? attributes.desynchronized
      : null,
    colorSpace: typeof attributes.colorSpace === "string" ? attributes.colorSpace : null,
  };
}

function shouldDesynchronizeAdaptivePreviewVisibleCanvas(): boolean {
  return navigator.platform === "iPhone" || /\biPhone\b/.test(navigator.userAgent);
}

function adaptiveSpacingMaxExtraPercentPointsForPlatform(): number {
  return /\bAndroid\b/i.test(navigator.userAgent)
    ? ADAPTIVE_SPACING_ANDROID_MAX_EXTRA_PERCENT_POINTS
    : ADAPTIVE_SPACING_MAX_EXTRA_PERCENT_POINTS;
}
const HISTORY_STORAGE_STRATEGY = "cpu-render-batch-journal" as const;
const HISTORY_REPLAY_STRATEGY = "clear-and-stable-gpu-replay" as const;
const HISTORY_STAMP_RETENTION_STRATEGY = "shared-immutable-references" as const;
const SHAPE_MASK_SIZE = 2048;
const GRAIN_TEXTURE_SIZE = 2500;
const GRAIN_TEXTURE_MIP_LEVEL_COUNT = Math.floor(Math.log2(GRAIN_TEXTURE_SIZE)) + 1;
const GRAIN_TEXTURE_PIXEL_COUNT = Array.from(
  { length: GRAIN_TEXTURE_MIP_LEVEL_COUNT },
  (_, mipLevel) => {
    const dimension = Math.max(1, Math.floor(GRAIN_TEXTURE_SIZE / (2 ** mipLevel)));
    return dimension * dimension;
  },
).reduce((sum, pixels) => sum + pixels, 0);
const SHAPE_MASK_PIXEL_COUNT = Array.from(
  { length: Math.log2(SHAPE_MASK_SIZE) + 1 },
  (_, mipLevel) => {
    const dimension = Math.max(1, SHAPE_MASK_SIZE >> mipLevel);
    return dimension * dimension;
  },
).reduce((sum, pixels) => sum + pixels, 0);
const SHAPE_OCCUPANCY_GRID_SIZE = 256;
const SHAPE_OCCUPANCY_CELL_SIZE = SHAPE_MASK_SIZE / SHAPE_OCCUPANCY_GRID_SIZE;
const SHAPE_OCCUPANCY_CELL_COUNT = SHAPE_OCCUPANCY_GRID_SIZE * SHAPE_OCCUPANCY_GRID_SIZE;
const SHAPE_OCCUPANCY_WORDS_PER_MAP = SHAPE_OCCUPANCY_CELL_COUNT / 32;
const SHAPE_OCCUPANCY_MAX_MIP = 4;
const SHAPE_OCCUPANCY_MAP_COUNT = SHAPE_OCCUPANCY_MAX_MIP + 1;
const SHAPE_OCCUPANCY_MIN_RADIUS = 128;
const SHAPE_OCCUPANCY_MAX_COVERAGE_RATIO = 0.5;
const SHAPE_OCCUPANCY_MAP_BYTES = SHAPE_OCCUPANCY_WORDS_PER_MAP * 4;
const BRUSH_UNIFORM_BYTES = 96;
const GRAIN_UNIFORM_BYTES = 32;
const DISPLAY_UNIFORM_BYTES = 64;
const VECTOR_TEXT_CAPTURE_UNIFORM_BYTES = 32;
const VECTOR_TEXT_GPU_MAXIMUM_DRAWS = 512;
const VIEW_ROTATION_SNAP_ENTER_RADIANS = 3 * Math.PI / 180;
const VIEW_ROTATION_SNAP_RELEASE_RADIANS = 7 * Math.PI / 180;
const LAYER_COMPOSITE_UNIFORM_BYTES = 32;
const LIGHT_GLAZE_UNIFORM_BYTES = 32;
const THICKNESS_TAIL_UNIFORM_BYTES = 32;
const STATIC_PAINT_BUFFER_BYTES =
  BRUSH_UNIFORM_BYTES * 2
  + GRAIN_UNIFORM_BYTES
  + DISPLAY_UNIFORM_BYTES
  + VECTOR_TEXT_CAPTURE_UNIFORM_BYTES
  + LAYER_COMPOSITE_UNIFORM_BYTES
  + THICKNESS_TAIL_UNIFORM_BYTES
  + LIGHT_GLAZE_UNIFORM_BYTES
  + MAX_STAMPS_PER_BATCH * STAMP_STRIDE_BYTES * 2
  + SHAPE_OCCUPANCY_MAP_BYTES * SHAPE_OCCUPANCY_MAP_COUNT;

function normalizeViewRotation(angle: number): number {
  if (!Number.isFinite(angle)) {
    return 0;
  }
  const turn = Math.PI * 2;
  let normalized = (angle + Math.PI) % turn;
  if (normalized < 0) {
    normalized += turn;
  }
  return normalized - Math.PI;
}

function isStrokeGlazeBlendMode(mode: BlendMode): boolean {
  return mode === "light-glaze" || mode === "m1-glaze";
}

function lightGlazeStrategyForBlendMode(mode: BlendMode): LightGlazeStrategy {
  return mode === "m1-glaze" ? M1_GLAZE_STRATEGY : LIGHT_GLAZE_STRATEGY;
}

function paintDisplayPyramidAdditionalMemoryMiB(format: LayerFormat): number {
  const bytesPerPixel = format === "rgba16float" ? 8 : 4;
  let pixels = 0;
  for (let mipLevel = 1; mipLevel < PAINT_DISPLAY_MIP_LEVEL_COUNT; mipLevel += 1) {
    const dimension = Math.max(1, LAYER_SIZE >> mipLevel);
    pixels += dimension * dimension;
  }
  return (pixels * bytesPerPixel) / (1024 * 1024);
}

function layerBaseMemoryMiB(format: LayerFormat): number {
  return format === "rgba16float" ? 128 : 64;
}

function lightGlazeAdditionalMemoryMiB(
  format: LayerFormat,
  storageMode: LightGlazeStorageMode,
): number {
  if (storageMode === "none") {
    return 0;
  }
  const accumulatorMiB = storageMode === "r8-coverage"
    ? LAYER_SIZE * LAYER_SIZE / MEBIBYTE_BYTES
    : layerBaseMemoryMiB(format);
  return accumulatorMiB + paintDisplayPyramidAdditionalMemoryMiB(format);
}

function shapeTextureMemoryMiB(): number {
  return SHAPE_MASK_PIXEL_COUNT / MEBIBYTE_BYTES;
}

function staticPaintBufferMemoryMiB(): number {
  return STATIC_PAINT_BUFFER_BYTES / MEBIBYTE_BYTES;
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function hashBytes(bytes: Uint8Array): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < bytes.length; index += 1) {
    hash = Math.imul(hash ^ bytes[index], 0x01000193) >>> 0;
  }
  return hash;
}

function maximum(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}

function average(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function previewHash32(value: number): number {
  let result = value >>> 0;
  result = (result ^ (result >>> 16)) >>> 0;
  result = Math.imul(result, 0x7feb352d) >>> 0;
  result = (result ^ (result >>> 15)) >>> 0;
  result = Math.imul(result, 0x846ca68b) >>> 0;
  result = (result ^ (result >>> 16)) >>> 0;
  return result;
}

function previewRandom01(seed: number, salt: number): number {
  const salted = (seed ^ Math.imul(salt, 0x9e3779b9)) >>> 0;
  return (previewHash32(salted) & 0x00ffffff) / 16777216;
}

function previewHueToRgb(p: number, q: number, input: number): number {
  const value = ((input % 1) + 1) % 1;
  if (value < 1 / 6) {
    return p + (q - p) * 6 * value;
  }
  if (value < 1 / 2) {
    return q;
  }
  if (value < 2 / 3) {
    return p + (q - p) * (2 / 3 - value) * 6;
  }
  return p;
}

function previewHslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const h = ((hue % 1) + 1) % 1;
  const s = clamp(saturation, 0, 1);
  const l = clamp(lightness, 0, 1);
  if (s <= 0.00001) {
    const channel = Math.round(l * 255);
    return [channel, channel, channel];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(clamp(previewHueToRgb(p, q, h + 1 / 3), 0, 1) * 255),
    Math.round(clamp(previewHueToRgb(p, q, h), 0, 1) * 255),
    Math.round(clamp(previewHueToRgb(p, q, h - 1 / 3), 0, 1) * 255),
  ];
}

function srgbByteToLinear(channel: number): number {
  const value = clamp(channel / 255, 0, 1);
  return value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4;
}

function buildShapeOccupancyMaps(mipMasks: readonly Uint8Array[]): {
  words: Uint32Array;
  activeCells: number[];
  coverageRatios: number[];
} {
  const words = new Uint32Array(SHAPE_OCCUPANCY_WORDS_PER_MAP * SHAPE_OCCUPANCY_MAP_COUNT);
  const occupied = new Uint8Array(SHAPE_OCCUPANCY_CELL_COUNT);
  const activeCells: number[] = [];
  const coverageRatios: number[] = [];

  for (let mipLevel = 0; mipLevel < SHAPE_OCCUPANCY_MAP_COUNT; mipLevel += 1) {
    const levelMask = mipMasks[mipLevel];
    const levelSize = SHAPE_MASK_SIZE >> mipLevel;
    const sourceScale = 1 << mipLevel;

    for (let y = 0; y < levelSize; y += 1) {
      for (let x = 0; x < levelSize; x += 1) {
        if (levelMask[y * levelSize + x] === 0) {
          continue;
        }

        const minimumSourceX = Math.max(0, (x - 0.5) * sourceScale);
        const maximumSourceX = Math.min(SHAPE_MASK_SIZE, (x + 1.5) * sourceScale);
        const minimumSourceY = Math.max(0, (y - 0.5) * sourceScale);
        const maximumSourceY = Math.min(SHAPE_MASK_SIZE, (y + 1.5) * sourceScale);
        const minimumCellX = Math.max(0, Math.floor(minimumSourceX / SHAPE_OCCUPANCY_CELL_SIZE));
        const maximumCellX = Math.min(
          SHAPE_OCCUPANCY_GRID_SIZE - 1,
          Math.ceil(maximumSourceX / SHAPE_OCCUPANCY_CELL_SIZE) - 1,
        );
        const minimumCellY = Math.max(0, Math.floor(minimumSourceY / SHAPE_OCCUPANCY_CELL_SIZE));
        const maximumCellY = Math.min(
          SHAPE_OCCUPANCY_GRID_SIZE - 1,
          Math.ceil(maximumSourceY / SHAPE_OCCUPANCY_CELL_SIZE) - 1,
        );

        for (let cellY = minimumCellY; cellY <= maximumCellY; cellY += 1) {
          const row = cellY * SHAPE_OCCUPANCY_GRID_SIZE;
          for (let cellX = minimumCellX; cellX <= maximumCellX; cellX += 1) {
            occupied[row + cellX] = 1;
          }
        }
      }
    }

    let count = 0;
    const wordOffset = mipLevel * SHAPE_OCCUPANCY_WORDS_PER_MAP;
    for (let cellIndex = 0; cellIndex < occupied.length; cellIndex += 1) {
      if (occupied[cellIndex] === 0) {
        continue;
      }
      count += 1;
      const wordIndex = wordOffset + (cellIndex >>> 5);
      words[wordIndex] |= (1 << (cellIndex & 31)) >>> 0;
    }
    activeCells.push(count);
    coverageRatios.push(count / SHAPE_OCCUPANCY_CELL_COUNT);
  }

  return { words, activeCells, coverageRatios };
}

export const defaultBrushSettings: BrushSettings = {
  tool: "paint",
  shape: "circle",
  shapeScatter: 0,
  grainMode: "off",
  grainScale: 1.4,
  grainDepth: 1,
  grainBrightness: 0,
  grainContrast: 0,
  grainInvert: false,
  grainFiltering: "improved",
  grainBlendMode: "multiply",
  color: "#ff5b35",
  size: 96,
  spacingPercent: 1,
  startThickness: 1,
  endThickness: 1,
  count: 24,
  flow: 0.07,
  opacity: 1,
  hardness: 0.88,
  blendIntensity: 1,
  blendMode: "normal",
  blendStretch: 0.18,
  blendPaint: 0.14,
  jitterMaster: 1,
  hueJitterDegrees: 12,
  saturationJitter: 0.18,
  lightnessJitter: 0.12,
  darknessJitter: 0.18,
  jitterPerCopy: false,
  positionJitterLateral: 1,
  positionJitterLinear: 1,
};

export class BrushEngine {
  readonly layerSize = LAYER_SIZE;

  private readonly canvas: HTMLCanvasElement;
  private readonly callbacks: EngineCallbacks;
  private readonly bevelBoundingFieldEnabled: boolean;
  private readonly layerMemoryStressTestEnabled: boolean;
  private readonly layerCompressionTestEnabled: boolean;
  private readonly layerColdCompressionEnabled: boolean;
  private readonly vectorTextPrototypeEnabled: boolean;

  private adapter!: GPUAdapter;
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private canvasFormat!: GPUTextureFormat;

  private layerFormat: LayerFormat = "rgba8unorm";
  private layerTexture!: GPUTexture;
  private layerView!: GPUTextureView;
  private layerSamplingView!: GPUTextureView;
  private blendRenderer: DryBlendRenderer | null = null;
  private effectsWorkbench: EffectsWorkbench | null = null;
  private effectsScratchShrinkTimer: number | null = null;
  private effectsScratchShrinkInFlight = false;
  private bevelFieldShrinkTimer: number | null = null;
  private bevelFieldShrinkInFlight = false;
  private bevelFieldShrinkOnNextEncode = false;

  private get rasterStrokeRenderer(): RasterStrokeRenderer | null {
    return this.effectsWorkbench?.strokeRenderer ?? null;
  }

  private get rasterBevelRenderer(): RasterBevelRenderer | null {
    return this.effectsWorkbench?.bevelRenderer ?? null;
  }

  private get rasterOuterShadowRenderer(): RasterShadowRenderer | null {
    return this.effectsWorkbench?.outerShadowRenderer ?? null;
  }

  private get rasterInnerShadowRenderer(): RasterShadowRenderer | null {
    return this.effectsWorkbench?.innerShadowRenderer ?? null;
  }
  /**
   * The stack owns the CPU state the map classified as per-layer. Today it holds
   * exactly one record, so behaviour is unchanged; routing the styles through it
   * now means the switch has somewhere to read the incoming layer's effects from
   * instead of retrofitting 68 call sites later.
   */
  private readonly layerStack = new LayerStack(() => ({
    strokeStyle: copyRasterStrokeStyle(DEFAULT_RASTER_STROKE_STYLE),
    bevelStyle: copyRasterBevelStyle(DEFAULT_RASTER_BEVEL_STYLE),
    outerShadowStyle: copyRasterOuterShadowStyle(DEFAULT_RASTER_OUTER_SHADOW_STYLE),
    innerShadowStyle: copyRasterInnerShadowStyle(DEFAULT_RASTER_INNER_SHADOW_STYLE),
  }));

  private readonly mixedSceneStack: MixedSceneStack | null;
  private vectorTextPreviewExcludedNodeId: number | null = null;

  /**
   * GPU resources per layer, keyed by the record's stable id. Ids are never
   * reused after a delete, so an entry can never be handed to a different layer
   * than the one it was allocated for.
   */
  private readonly layerGpu = new Map<number, LayerGpuResources>();

  /**
   * Held for the WHOLE duration of a switch, awaits included.
   *
   * The guards at the top of addLayer/setActiveLayer only prove the engine was
   * idle when they ran; the switch then awaits waitForIdle and the field rebuild,
   * and during those 150–215 ms a pointerdown could otherwise start a stroke on
   * a layer that is halfway through being swapped.
   */
  private layerSwitchBusy = false;

  /**
   * While reconstructible layer resources are evicted, keep presenting the last
   * screen-space cache and submit no frame that could reference destroyed views.
   * Every successful activation/rebuild clears the flag before requesting a frame.
   */
  private layerPresentationFrozen = false;

  /** Dev-only injections for post-submit rollback boundaries. */
  private layerBakeFaultQueue: LayerBakeFaultPoint[] = [];
  private layerCompositeFaultQueue: LayerCompositeFaultPoint[] = [];
  private layerColdStorageFaultQueue: LayerColdStorageFaultPoint[] = [];
  private readonly liveLayerBakeTextures = new Map<GPUTexture, number>();
  private readonly liveMergedSurfaceTextures = new Map<GPUTexture, MergedSurfaceResources>();
  private readonly liveLayerHydrationTextures = new Map<GPUTexture, number>();
  /** Dev probe buffers are excluded from counted GPU memory, so track them separately. */
  private devReadbackActiveBytes = 0;
  private devReadbackPeakBytes = 0;
  private layerColdCompressionClient: LayerColdCompressionClient | null = null;
  private layerColdCompressionWorkerUnavailable = false;
  private layerColdCompressionIdleTimer: number | null = null;
  private layerColdCompressionEpoch = 0;
  private layerColdCompressionJobRunning = false;
  private layerColdCompressionProgress: LayerColdCompressionProgress | null = null;
  private layerColdRestoreActiveBytes = 0;

  // Accessors rather than fields: every read site keeps working, and the styles
  // follow the active layer by construction rather than by remembering to copy
  // them on every switch.
  private get rasterStrokeStyle(): RasterStrokeStyle {
    return this.layerStack.active.strokeStyle;
  }

  private set rasterStrokeStyle(style: RasterStrokeStyle) {
    this.layerStack.active.strokeStyle = style;
  }

  private rasterStrokeCoverageValid = false;
  private rasterStrokeStyledInitialized = false;
  private rasterStrokeMipValidThroughLevel = 0;
  private rasterStrokeMipDownsampleBindGroups: GPUBindGroup[] = [];
  private rasterStrokeDisplayBindGroups = new Map<RasterStrokeSourceMode, GPUBindGroup>();
  private rasterStrokePendingComposeRect: DirtyRect | null = null;
  private rasterStrokeBusy = false;
  private rasterStrokeLastEncode: RasterStrokeEncodeResult | null = null;
  private get rasterBevelStyle(): RasterBevelStyle {
    return this.layerStack.active.bevelStyle;
  }

  private set rasterBevelStyle(style: RasterBevelStyle) {
    this.layerStack.active.bevelStyle = style;
  }

  private rasterBevelHeightValid = false;
  private rasterBevelHeightSourceMode: RasterStrokeSourceMode | null = null;
  private rasterBevelPendingComposeRect: DirtyRect | null = null;
  private rasterBevelBusy = false;
  private rasterBevelLastEncode: RasterBevelEncodeResult | null = null;
  private rasterBevelTotalBuilds = 0;
  private rasterBevelTotalPasses = 0;

  private get rasterOuterShadowStyle(): RasterOuterShadowStyle {
    return this.layerStack.active.outerShadowStyle;
  }

  private set rasterOuterShadowStyle(style: RasterOuterShadowStyle) {
    this.layerStack.active.outerShadowStyle = style;
  }

  private rasterOuterShadowMatteValid = false;
  private rasterOuterShadowSourceMode: RasterStrokeSourceMode | null = null;
  private rasterOuterShadowPendingComposeRect: DirtyRect | null = null;
  private rasterOuterShadowBusy = false;
  private rasterOuterShadowLastEncode: RasterShadowEncodeResult | null = null;
  private rasterOuterShadowTotalBuilds = 0;
  private rasterOuterShadowTotalPasses = 0;

  private get rasterInnerShadowStyle(): RasterInnerShadowStyle {
    return this.layerStack.active.innerShadowStyle;
  }

  private set rasterInnerShadowStyle(style: RasterInnerShadowStyle) {
    this.layerStack.active.innerShadowStyle = style;
  }

  private rasterInnerShadowMatteValid = false;
  private rasterInnerShadowSourceMode: RasterStrokeSourceMode | null = null;
  private rasterInnerShadowPendingComposeRect: DirtyRect | null = null;
  private rasterInnerShadowBusy = false;
  private rasterInnerShadowLastEncode: RasterShadowEncodeResult | null = null;
  private rasterInnerShadowTotalBuilds = 0;
  private rasterInnerShadowTotalPasses = 0;

  private rasterStrokeTotalBuilds = 0;
  private rasterStrokeTotalComposes = 0;
  private layerContentBounds: DirtyRect | null = null;

  private activeLayerDisplayPyramid!: DisplayPyramidResources;
  private transparentLayerTexture!: GPUTexture;
  private transparentLayerView!: GPUTextureView;
  private mergedBelow: MergedSurfaceResources | null = null;
  private mergedAbove: MergedSurfaceResources | null = null;
  private mixedSceneCompositionSegments: readonly MixedSceneCompositionSegment[] = [];
  private mixedSceneRasterSegments: MixedSceneRasterSegmentResources[] = [];
  private paintMipViews: GPUTextureView[] = [];
  private paintMipDownsampleBindGroups: GPUBindGroup[] = [];
  private paintDisplayMipValidThroughLevel = 0;
  private paintDisplaySelectedMipLevel = 0;
  private presentationCacheTexture: GPUTexture | null = null;
  private presentationCacheView: GPUTextureView | null = null;
  private presentationCacheWidth = 0;
  private presentationCacheHeight = 0;
  private presentationCacheNeedsFullRebuild = true;
  private vectorTextCaptureView: VectorTextViewState | null = null;
  private vectorTextFastPresentationEnabled = false;
  private mixedSceneLinearTexture: GPUTexture | null = null;
  private mixedSceneLinearView: GPUTextureView | null = null;
  private mixedSceneLinearWidth = 0;
  private mixedSceneLinearHeight = 0;
  private mixedScenePresentBindGroup: GPUBindGroup | null = null;
  private readonly vectorTextRunTextures = new Map<
    Extract<VectorTextPlacement, `text-run:${string}`>,
    VectorTextRunTextureResources
  >();
  private readonly vectorTextGpuMeshes =
    new Map<string, VectorTextGpuDrawResources>();
  private readonly vectorTextGpuBlurCaches =
    new Map<string, VectorTextGpuBlurCacheResources>();
  private readonly vectorTextGpuPendingRuns: VectorTextGpuPendingRun[] = [];
  private vectorTextGpuMsaaTexture: GPUTexture | null = null;
  private vectorTextGpuMsaaView: GPUTextureView | null = null;
  private vectorTextGpuResolvedTexture: GPUTexture | null = null;
  private vectorTextGpuResolvedView: GPUTextureView | null = null;
  private vectorTextGpuScratchWidth = 0;
  private vectorTextGpuScratchHeight = 0;
  private vectorTextGpuUniformBuffer: GPUBuffer | null = null;
  private vectorTextGpuUniformBindGroup: GPUBindGroup | null = null;
  private readonly vectorTextGpuUniformUpload = new Float32Array(
    VECTOR_TEXT_GPU_MAXIMUM_DRAWS * VECTOR_TEXT_GPU_UNIFORM_STRIDE / 4,
  );
  private vectorTextBelowTexture: GPUTexture | null = null;
  private readonly vectorTextGpuUniformUploadUnsigned = new Uint32Array(
    this.vectorTextGpuUniformUpload.buffer,
  );
  private vectorTextGpuBlurScratchATexture: GPUTexture | null = null;
  private vectorTextGpuBlurScratchAView: GPUTextureView | null = null;
  private vectorTextGpuBlurScratchBTexture: GPUTexture | null = null;
  private vectorTextGpuBlurScratchBView: GPUTextureView | null = null;
  private vectorTextGpuBlurScratchWidth = 0;
  private vectorTextGpuBlurScratchHeight = 0;
  private vectorTextGpuBlurFilterUniformBuffer: GPUBuffer | null = null;
  private readonly vectorTextGpuBlurFilterUniformUpload = new Float32Array(
    VECTOR_TEXT_GPU_MAXIMUM_DRAWS * VECTOR_TEXT_GPU_UNIFORM_STRIDE / 4,
  );
  private readonly vectorTextGpuBlurFilterUniformUploadUnsigned = new Uint32Array(
    this.vectorTextGpuBlurFilterUniformUpload.buffer,
  );
  private vectorTextGpuBlurFilterBindGroupAToB: GPUBindGroup | null = null;
  private vectorTextGpuBlurFilterBindGroupBToA: GPUBindGroup | null = null;
  private vectorTextGpuBlurSampler: GPUSampler | null = null;
  private vectorTextBelowView: GPUTextureView | null = null;
  private vectorTextAboveTexture: GPUTexture | null = null;
  private vectorTextAboveView: GPUTextureView | null = null;
  private vectorTextTextureWidth = 0;
  private vectorTextTextureHeight = 0;
  private vectorTextDisplayBindGroup: GPUBindGroup | null = null;
  private lightGlazeTexture: GPUTexture | null = null;
  private lightGlazeCompositeMipTexture: GPUTexture | null = null;
  private lightGlazeView: GPUTextureView | null = null;
  private lightGlazeSamplingView: GPUTextureView | null = null;
  private lightGlazeMipViews: GPUTextureView[] = [];
  private lightGlazeMipDownsampleBindGroups: GPUBindGroup[] = [];
  private lightGlazeCompositeMipBindGroup: GPUBindGroup | null = null;
  private lightGlazeDisplayBindGroup: GPUBindGroup | null = null;
  private lightGlazeCompositeBindGroup: GPUBindGroup | null = null;
  private lightGlazeSession: LightGlazeSession | null = null;
  private lightGlazeStorageAllocated = false;
  private lightGlazeStorageMode: LightGlazeStorageMode = "none";
  private thicknessTailTexture: GPUTexture | null = null;
  private thicknessTailView: GPUTextureView | null = null;
  private thicknessTailDisplayBindGroup: GPUBindGroup | null = null;
  private thicknessTailTextureWidth = 0;
  private thicknessTailTextureHeight = 0;
  private thicknessTailPresentedRect: DirtyRect | null = null;
  private readonly adaptivePreviewCanvas: HTMLCanvasElement | null;
  private readonly adaptivePreviewContext: CanvasRenderingContext2D | null;
  private readonly adaptivePreviewScratchCanvas: HTMLCanvasElement | null;
  private readonly adaptivePreviewScratchContext: CanvasRenderingContext2D | null;
  private readonly adaptiveSpacingMaxExtraPercentPoints: number;
  private readonly adaptivePreviewVisibleCanvasRequestedDesynchronized: boolean;
  private readonly adaptivePreviewVisibleContextAttributes: AdaptivePreviewContextAttributes;
  private readonly adaptivePreviewScratchContextAttributes: AdaptivePreviewContextAttributes;
  private adaptivePreviewShapeSprite: HTMLCanvasElement | null = null;
  private adaptivePreviewShapePalette: AdaptivePreviewShapePaletteEntry[] = [];
  private adaptivePreviewShapePaletteKey = "";
  private adaptivePreviewGeneration = 1;
  private adaptivePreviewSubmissionsSinceProbe = 0;
  private adaptivePreviewSubmittedSerial = 0;
  private adaptivePreviewConfirmedSerial = 0;
  private adaptivePreviewLastPresentedSerial = 0;
  private adaptivePreviewLastIncompleteRetrySerial = 0;
  private adaptivePreviewCandidates: AdaptivePreviewCandidate[] = [];
  private adaptivePreviewProbe: AdaptivePreviewProbe | null = null;
  private adaptivePreviewConsecutiveSlowProbes = 0;
  private adaptivePreviewActive = false;
  private adaptivePreviewFrozen = false;
  private adaptivePreviewForceStroke = false;
  private adaptivePreviewStartedAt = 0;
  private adaptivePreviewRetirementTargetSerial = 0;
  private adaptivePreviewFrameRequest: number | null = null;
  private adaptivePreviewRetirementFrame: number | null = null;
  private adaptivePreviewCssWidth = 0;
  private adaptivePreviewCssHeight = 0;
  private canvasCssWidth = 1;
  private canvasCssHeight = 1;

  private brushUniformBuffer!: GPUBuffer;
  private thicknessTailBrushUniformBuffer!: GPUBuffer;
  private grainUniformBuffer!: GPUBuffer;
  private displayUniformBuffer!: GPUBuffer;
  private vectorTextCaptureUniformBuffer!: GPUBuffer;
  private thicknessTailDisplayUniformBuffer!: GPUBuffer;
  private lightGlazeUniformBuffer!: GPUBuffer;
  private instanceBuffer!: GPUBuffer;
  private thicknessTailInstanceBuffer!: GPUBuffer;
  private shapeOccupancyUniformBuffers: GPUBuffer[] = [];
  private sampler!: GPUSampler;
  private shapeMaskTexture: GPUTexture | null = null;
  private shapeMaskView!: GPUTextureView;
  private shapeMaskPlaceholderTexture!: GPUTexture;
  private shapeMaskPlaceholderView!: GPUTextureView;
  private shapeResident = false;
  private shapeLoadingPromise: Promise<void> | null = null;
  private shapeMaskSampler!: GPUSampler;
  private grainTexture: GPUTexture | null = null;
  private grainTextureView!: GPUTextureView;
  private grainPlaceholderTexture!: GPUTexture;
  private grainPlaceholderView!: GPUTextureView;
  private grainResident = false;
  private grainLoadingPromise: Promise<void> | null = null;
  private grainSamplers!: Record<"fixed" | "moving", Record<GrainFiltering, GPUSampler>>;
  private grainTextureIdentity = 0;
  private grainStartupDecodeMs = 0;
  private grainStartupMipBuildMs = 0;
  private grainStartupUploadMs = 0;
  private shapeMaskDecodeStrategy: ShapeMaskDecodeStrategy = SHAPE_CANVAS_DECODE_STRATEGY;
  private shapeMaskIdentity = 0;
  private shapeOccupancyActiveCells = new Array<number>(SHAPE_OCCUPANCY_MAP_COUNT).fill(0);
  private shapeOccupancyCoverageRatios = new Array<number>(SHAPE_OCCUPANCY_MAP_COUNT).fill(1);
  private packedMinimumRadius = Number.POSITIVE_INFINITY;

  private brushBindGroupLayout!: GPUBindGroupLayout;
  private brushOccupancyBindGroupLayout!: GPUBindGroupLayout;
  private grainBrushBindGroupLayout!: GPUBindGroupLayout;
  private grainBrushOccupancyBindGroupLayout!: GPUBindGroupLayout;
  private displayBindGroupLayout!: GPUBindGroupLayout;
  private vectorTextDisplayBindGroupLayout: GPUBindGroupLayout | null = null;
  private mixedSceneRasterSegmentBindGroupLayout: GPUBindGroupLayout | null = null;
  private mixedSceneTextSegmentBindGroupLayout: GPUBindGroupLayout | null = null;
  private vectorTextGpuSlugBindGroupLayout: GPUBindGroupLayout | null = null;
  private mixedScenePresentBindGroupLayout: GPUBindGroupLayout | null = null;
  private vectorTextGpuUniformBindGroupLayout: GPUBindGroupLayout | null = null;
  private vectorTextGpuBlurFilterBindGroupLayout: GPUBindGroupLayout | null = null;
  private vectorTextGpuBlurCompositeBindGroupLayout: GPUBindGroupLayout | null = null;
  private vectorTextGpuInnerShadowBindGroupLayout: GPUBindGroupLayout | null = null;
  private rasterStrokeDisplayScreenBindGroupLayout!: GPUBindGroupLayout;
  private rasterStrokeDisplaySourceBindGroupLayout!: GPUBindGroupLayout;
  private thicknessTailDisplayBindGroupLayout!: GPUBindGroupLayout;
  private lightGlazeDisplayBindGroupLayout!: GPUBindGroupLayout;
  private lightGlazeCompositeMipBindGroupLayout!: GPUBindGroupLayout;
  private lightGlazeCompositeBindGroupLayout!: GPUBindGroupLayout;
  private paintMipDownsampleBindGroupLayout!: GPUBindGroupLayout;
  private layerCompositeBindGroupLayout!: GPUBindGroupLayout;
  private brushBindGroup!: GPUBindGroup;
  private thicknessTailBrushBindGroup!: GPUBindGroup;
  private brushOccupancyBindGroups: GPUBindGroup[] = [];
  private thicknessTailBrushOccupancyBindGroups: GPUBindGroup[] = [];
  private grainBrushBindGroups!: Record<
    "fixed" | "moving",
    Record<GrainFiltering, GPUBindGroup>
  >;
  private grainBrushOccupancyBindGroups!: Record<
    "fixed" | "moving",
    Record<GrainFiltering, GPUBindGroup[]>
  >;
  private thicknessTailGrainBrushBindGroups!: Record<
    "fixed" | "moving",
    Record<GrainFiltering, GPUBindGroup>
  >;
  private thicknessTailGrainBrushOccupancyBindGroups!: Record<
    "fixed" | "moving",
    Record<GrainFiltering, GPUBindGroup[]>
  >;
  private displayBindGroup!: GPUBindGroup;
  private rasterStrokeDisplayScreenBindGroup!: GPUBindGroup;

  private brushShaderModule!: GPUShaderModule;
  private texturizedGrainShaderModule!: GPUShaderModule;
  private displayShaderModule!: GPUShaderModule;
  private vectorTextGpuSlugShaderModule: GPUShaderModule | null = null;
  private vectorTextDisplayShaderModule: GPUShaderModule | null = null;
  private vectorTextGpuShaderModule: GPUShaderModule | null = null;
  private vectorTextGpuGaussianBlurShaderModule: GPUShaderModule | null = null;
  private vectorTextGpuBlurCompositeShaderModule: GPUShaderModule | null = null;
  private vectorTextGpuInnerShadowShaderModule: GPUShaderModule | null = null;
  private mixedSceneRasterSegmentShaderModule: GPUShaderModule | null = null;
  private mixedSceneTextSegmentShaderModule: GPUShaderModule | null = null;
  private mixedSceneClearShaderModule: GPUShaderModule | null = null;
  private mixedScenePresentShaderModule: GPUShaderModule | null = null;
  private rasterStrokeDisplayShaderModule!: GPUShaderModule;
  private thicknessTailDisplayShaderModule!: GPUShaderModule;
  private lightGlazeDisplayShaderModule!: GPUShaderModule;
  private lightGlazeCompositeMipShaderModule!: GPUShaderModule;
  private lightGlazeCompositeShaderModule!: GPUShaderModule;
  private paintMipDownsampleShaderModule!: GPUShaderModule;
  private layerCompositeShaderModule!: GPUShaderModule;
  private normalPipeline!: GPURenderPipeline;
  private additivePipeline!: GPURenderPipeline;
  private shapeNormalPipeline!: GPURenderPipeline;
  private shapeAdditivePipeline!: GPURenderPipeline;
  private shapeOccupancyNormalPipeline!: GPURenderPipeline;
  private shapeOccupancyAdditivePipeline!: GPURenderPipeline;
  private grainNormalPipeline!: GPURenderPipeline;
  private grainAdditivePipeline!: GPURenderPipeline;
  private grainShapeNormalPipeline!: GPURenderPipeline;
  private grainShapeAdditivePipeline!: GPURenderPipeline;
  private grainShapeOccupancyNormalPipeline!: GPURenderPipeline;
  private grainShapeOccupancyAdditivePipeline!: GPURenderPipeline;
  private m1GlazePipeline!: GPURenderPipeline;
  private m1GlazeShapePipeline!: GPURenderPipeline;
  private m1GlazeShapeOccupancyPipeline!: GPURenderPipeline;
  private grainM1GlazePipeline!: GPURenderPipeline;
  private grainM1GlazeShapePipeline!: GPURenderPipeline;
  private grainM1GlazeShapeOccupancyPipeline!: GPURenderPipeline;
  private vectorTextGpuSlugPipeline: GPURenderPipeline | null = null;
  private displayPipeline!: GPURenderPipeline;
  private vectorTextDisplayPipeline: GPURenderPipeline | null = null;
  private vectorTextGpuFillPipeline: GPURenderPipeline | null = null;
  private vectorTextGpuBlurMaskPipeline: GPURenderPipeline | null = null;
  private vectorTextGpuBlurHorizontalPipeline: GPURenderPipeline | null = null;
  private vectorTextGpuBlurVerticalPipeline: GPURenderPipeline | null = null;
  private vectorTextGpuBlurCompositePipeline: GPURenderPipeline | null = null;
  private vectorTextGpuInnerShadowDirectPipeline: GPURenderPipeline | null = null;
  private vectorTextGpuInnerShadowBlurPipeline: GPURenderPipeline | null = null;
  private vectorTextGpuClearPipeline: GPURenderPipeline | null = null;
  private mixedSceneClearPipeline: GPURenderPipeline | null = null;
  private mixedSceneRasterSegmentPipeline: GPURenderPipeline | null = null;
  private mixedSceneTextSegmentPipeline: GPURenderPipeline | null = null;
  private mixedScenePresentPipeline: GPURenderPipeline | null = null;
  private mixedSceneActiveDisplayPipeline: GPURenderPipeline | null = null;
  private mixedSceneActiveRasterStrokeDisplayPipeline: GPURenderPipeline | null = null;
  private mixedSceneActiveThicknessTailDisplayPipeline: GPURenderPipeline | null = null;
  private mixedSceneActiveLightGlazeDisplayPipeline: GPURenderPipeline | null = null;
  private rasterStrokeDisplayPipeline!: GPURenderPipeline;
  private thicknessTailDisplayPipeline!: GPURenderPipeline;
  private lightGlazeDisplayPipeline!: GPURenderPipeline;
  private lightGlazeCompositeMipPipeline!: GPURenderPipeline;
  private lightGlazeCompositePipeline!: GPURenderPipeline;
  private paintMipDownsamplePipeline!: GPURenderPipeline;
  private layerCompositePipeline!: GPURenderPipeline;

  private readonly instanceUpload = new ArrayBuffer(MAX_STAMPS_PER_BATCH * STAMP_STRIDE_BYTES);
  private readonly instanceUploadF32 = new Float32Array(this.instanceUpload);
  private readonly instanceUploadU32 = new Uint32Array(this.instanceUpload);
  private readonly thicknessTailInstanceUpload = new ArrayBuffer(
    MAX_STAMPS_PER_BATCH * STAMP_STRIDE_BYTES,
  );
  private readonly thicknessTailInstanceUploadF32 = new Float32Array(
    this.thicknessTailInstanceUpload,
  );
  private readonly thicknessTailInstanceUploadU32 = new Uint32Array(
    this.thicknessTailInstanceUpload,
  );
  private readonly brushUniformUpload = new ArrayBuffer(BRUSH_UNIFORM_BYTES);
  private readonly thicknessTailBrushUniformUpload = new ArrayBuffer(BRUSH_UNIFORM_BYTES);
  private readonly grainUniformUpload = new Float32Array(GRAIN_UNIFORM_BYTES / 4);
  private readonly displayUniformUpload = new Float32Array(DISPLAY_UNIFORM_BYTES / 4);
  private readonly vectorTextCaptureUniformUpload = new Float32Array(8);
  private layerCompositeUniformBuffer!: GPUBuffer;
  private readonly thicknessTailDisplayUniformUpload = new ArrayBuffer(
    THICKNESS_TAIL_UNIFORM_BYTES,
  );

  private settings: BrushSettings = { ...defaultBrushSettings };
  private pendingStamps: Stamp[] = [];
  private pendingBlendBatches: PendingBlendBatch[] = [];
  private activeStroke: ActiveStroke | null = null;
  private seedSequence = 1;

  private historyActions: HistoryAction[] = [];
  private historyCursor = 0;
  private nextHistoryActionId = 1;
  private historyBatches: HistoryRenderBatch[] = [];
  private historyStoredBaseStamps = 0;
  private historyCompactionPending = false;
  private historyBusy = false;
  private historyStateInconsistent = false;
  private layerHasContent = false;

  private frameRequest: number | null = null;
  private clearRequested = true;
  private displayDirty = true;
  private initialized = false;

  private viewCenterX = LAYER_SIZE * 0.5;
  private viewCenterY = LAYER_SIZE * 0.5;
  private zoom = 1;
  private viewRotation = 0;
  private viewRotationCos = 1;
  private viewRotationSin = 0;
  private viewRotationGestureRaw = 0;
  private viewRotationGestureActive = false;
  private viewRotationSnappedToZero = true;
  private hasFittedView = false;

  private totalBaseStamps = 0;
  private avoidedLogicalDraws = 0;
  private lastCpuFrameMs = 0;
  private renderTimestamps: number[] = [];
  private gpuLabel = "GPU WebGPU";
  private activeStrokeProfile: MutableStrokePerformanceProfile | null = null;
  private lastStampGeometry: StampGeometry = STAMP_GEOMETRY;
  private lastStampVerticesPerCopy = STAMP_VERTICES_PER_COPY;
  private lastShapeSamplingStrategy: ShapeSamplingStrategy = "none";
  private lastShapeOccupancyFallbackReason: ShapeOccupancyFallbackReason = "none";
  private lastShapeOccupancyMipLevel = -1;
  private lastShapeOccupancyActiveCells = 0;
  private lastShapeOccupancyCoverageRatio = 0;
  private lastShapeOccupancyCandidateMipLevel = -1;
  private lastShapeOccupancyCandidateActiveCells = 0;
  private lastShapeOccupancyCandidateCoverageRatio = 0;

  constructor(
    canvas: HTMLCanvasElement,
    callbacks: EngineCallbacks = {},
    adaptivePreviewCanvas: HTMLCanvasElement | null = null,
    options: BrushEngineOptions = {},
  ) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.bevelBoundingFieldEnabled = options.bevelBoundingFieldEnabled === true;
    this.layerMemoryStressTestEnabled = options.layerMemoryStressTestEnabled === true;
    this.layerCompressionTestEnabled = options.layerCompressionTestEnabled === true;
    this.layerColdCompressionEnabled = options.layerColdCompressionEnabled === true;
    this.vectorTextPrototypeEnabled = options.vectorTextPrototypeEnabled === true;
    this.mixedSceneStack = this.vectorTextPrototypeEnabled
      ? new MixedSceneStack(this.layerStack.layers.map((record) => record.id))
      : null;
    this.adaptivePreviewCanvas = adaptivePreviewCanvas;
    this.adaptiveSpacingMaxExtraPercentPoints =
      adaptiveSpacingMaxExtraPercentPointsForPlatform();
    this.adaptivePreviewVisibleCanvasRequestedDesynchronized =
      shouldDesynchronizeAdaptivePreviewVisibleCanvas();
    this.adaptivePreviewContext = adaptivePreviewCanvas?.getContext("2d", {
      alpha: true,
      desynchronized: this.adaptivePreviewVisibleCanvasRequestedDesynchronized,
    }) ?? null;
    this.adaptivePreviewScratchCanvas = this.adaptivePreviewContext
      ? document.createElement("canvas")
      : null;
    this.adaptivePreviewScratchContext = this.adaptivePreviewScratchCanvas?.getContext("2d", {
      alpha: true,
      desynchronized: true,
    }) ?? null;
    this.adaptivePreviewVisibleContextAttributes = readAdaptivePreviewContextAttributes(
      this.adaptivePreviewContext,
    );
    this.adaptivePreviewScratchContextAttributes = readAdaptivePreviewContextAttributes(
      this.adaptivePreviewScratchContext,
    );
  }

  async initialize(): Promise<void> {
    this.callbacks.onStatus?.("Richiesta adapter WebGPU…", "working");

    if (!navigator.gpu) {
      throw new Error("WebGPU non è disponibile in questo browser o in questo contesto.");
    }

    const adapterOptions: GPURequestAdapterOptions | undefined =
      /\bWindows\b/i.test(navigator.userAgent)
        ? undefined
        : { powerPreference: "high-performance" };
    const adapter = await navigator.gpu.requestAdapter(adapterOptions);
    if (!adapter) {
      throw new Error("Nessun adapter WebGPU compatibile trovato.");
    }
    this.adapter = adapter;

    if (adapter.limits.maxTextureDimension2D < LAYER_SIZE) {
      throw new Error(
        `La GPU supporta texture fino a ${adapter.limits.maxTextureDimension2D}px, meno dei ${LAYER_SIZE}px richiesti.`,
      );
    }

    this.device = await adapter.requestDevice();
    this.device.lost.then((info) => {
      this.invalidateAdaptivePreview();
      const reason = info.message || info.reason;
      this.callbacks.onStatus?.(`Device WebGPU perso: ${reason}`, "error");
    });

    const context = this.canvas.getContext("webgpu") as GPUCanvasContext | null;
    if (!context) {
      throw new Error("Impossibile ottenere GPUCanvasContext.");
    }
    this.context = context;

    this.canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: this.canvasFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
      alphaMode: "opaque",
      colorSpace: "srgb",
    });

    this.gpuLabel = this.describeAdapter(adapter);
    await this.createStaticResources();
    this.prepareAdaptivePreviewShapePalette(this.settings);
    await this.recreateLayerResources(this.layerFormat);

    this.resizeCanvas();
    this.fitView();
    this.writeBrushUniforms();

    this.initialized = true;
    if (this.settings.grainMode !== "off") {
      this.requestGrainLoad();
    }
    if (this.settings.shape === "shape") {
      this.requestShapeLoad();
    }
    this.clearAdaptivePreviewCanvas();
    this.requestRender();
    this.callbacks.onStatus?.("WebGPU pronto. Disegna sul canvas.", "ok");
    this.publishStats();
    this.publishHistoryState();
  }

  getSettings(): BrushSettings {
    return { ...this.settings };
  }

  setBrushSettings(next: Partial<BrushSettings>): void {
    if (this.initialized && (this.layerSwitchBusy || this.historyBusy)) {
      throw new Error(
        "Le impostazioni non possono cambiare durante uno switch o un replay della cronologia.",
      );
    }
    this.flushPendingWorkBeforeSettingsChange();
    const previousTool = this.settings.tool;
    const tool = next.tool === "paint" || next.tool === "blend"
      ? next.tool
      : this.settings.tool;
    this.settings = {
      ...this.settings,
      ...next,
      tool,
      shape: next.shape === "shape" || next.shape === "circle" ? next.shape : this.settings.shape,
      shapeScatter: clamp(next.shapeScatter ?? this.settings.shapeScatter, 0, 1),
      grainMode: next.grainMode === "off"
        || next.grainMode === "texturized"
        || next.grainMode === "moving"
        ? next.grainMode
        : this.settings.grainMode,
      grainScale: clamp(next.grainScale ?? this.settings.grainScale, 0.1, 4),
      grainDepth: clamp(next.grainDepth ?? this.settings.grainDepth, 0, 1),
      grainBrightness: clamp(next.grainBrightness ?? this.settings.grainBrightness, -1, 1),
      grainContrast: clamp(next.grainContrast ?? this.settings.grainContrast, -1, 1),
      grainInvert: typeof next.grainInvert === "boolean"
        ? next.grainInvert
        : this.settings.grainInvert,
      grainFiltering: next.grainFiltering === "no"
        || next.grainFiltering === "classic"
        || next.grainFiltering === "improved"
        ? next.grainFiltering
        : this.settings.grainFiltering,
      grainBlendMode: next.grainBlendMode === "multiply"
        ? next.grainBlendMode
        : this.settings.grainBlendMode,
      count: clamp(Math.round(next.count ?? this.settings.count), 1, 24),
      size: clamp(next.size ?? this.settings.size, tool === "blend" ? 1 : 4, tool === "blend" ? 1024 : 1500),
      spacingPercent: clamp(
        next.spacingPercent ?? this.settings.spacingPercent,
        tool === "blend" ? 1 : 0.25,
        tool === "blend" ? 400 : 25,
      ),
      startThickness: clamp(next.startThickness ?? this.settings.startThickness, 0, 2),
      endThickness: clamp(next.endThickness ?? this.settings.endThickness, 0, 2),
      flow: clamp(next.flow ?? this.settings.flow, 0.001, 1),
      opacity: clamp(next.opacity ?? this.settings.opacity, 0, 1),
      hardness: clamp(next.hardness ?? this.settings.hardness, 0, 1),
      blendIntensity: clamp(next.blendIntensity ?? this.settings.blendIntensity, 0.1, 4),
      blendMode: next.blendMode === "normal"
        || next.blendMode === "additive"
        || next.blendMode === "light-glaze"
        || next.blendMode === "m1-glaze"
        ? next.blendMode
        : this.settings.blendMode,
      blendStretch: clamp(next.blendStretch ?? this.settings.blendStretch, 0, 1),
      blendPaint: clamp(next.blendPaint ?? this.settings.blendPaint, 0, 1),
      jitterMaster: clamp(next.jitterMaster ?? this.settings.jitterMaster, 0, 1),
      hueJitterDegrees: clamp(next.hueJitterDegrees ?? this.settings.hueJitterDegrees, 0, 180),
      saturationJitter: clamp(next.saturationJitter ?? this.settings.saturationJitter, 0, 1),
      lightnessJitter: clamp(next.lightnessJitter ?? this.settings.lightnessJitter, 0, 1),
      darknessJitter: clamp(next.darknessJitter ?? this.settings.darknessJitter, 0, 1),
      positionJitterLateral: clamp(next.positionJitterLateral ?? this.settings.positionJitterLateral, 0, 1),
      positionJitterLinear: clamp(next.positionJitterLinear ?? this.settings.positionJitterLinear, 0, 1),
    };
    this.prepareAdaptivePreviewShapePalette(this.settings);

    if (this.initialized) {
      if (tool !== previousTool) {
        if (tool === "blend") {
          // L'allocazione avviene al select così l'eventuale costo del driver
          // cade sul click UI e mai dentro la prima pennellata.
          this.blendRenderer?.prewarmScratch();
        } else {
          this.maybeReleaseIdleBlendScratch();
        }
      }
      const glazeSelected = tool === "paint"
        && isStrokeGlazeBlendMode(this.settings.blendMode);
      if (glazeSelected) {
        // Prewarm al select del blending glaze (gestisce anche il cambio di
        // storage rgba↔r8); con sessione o tratto attivi provvede il frame.
        if (!this.lightGlazeSession && !this.activeStroke) {
          this.ensureLightGlazeResources(this.settings.blendMode);
        }
      } else {
        this.maybeReleaseIdleLightGlazeResources();
      }
      if (this.settings.grainMode !== "off") {
        this.requestGrainLoad();
      } else {
        this.maybeReleaseIdleGrainResources();
      }
      if (this.settings.shape === "shape") {
        this.requestShapeLoad();
      } else {
        this.maybeReleaseIdleShapeResources();
      }
      this.invalidateAdaptivePreview();
      this.writeBrushUniforms();
      if (this.isTexturizedGrainActive(this.settings)) {
        this.writeGrainUniforms(this.settings);
      }
      this.displayDirty = true;
      this.requestRender();
    }
  }

  getRasterStrokeStyle(): RasterStrokeStyle {
    return copyRasterStrokeStyle(this.rasterStrokeStyle);
  }

  isRasterStrokeBusy(): boolean {
    return this.rasterStrokeBusy;
  }
  getRasterBevelStyle(): RasterBevelStyle {
    return copyRasterBevelStyle(this.rasterBevelStyle);
  }

  isRasterBevelBusy(): boolean {
    return this.rasterBevelBusy;
  }

  getRasterOuterShadowStyle(): RasterOuterShadowStyle {
    return copyRasterOuterShadowStyle(this.rasterOuterShadowStyle);
  }

  isRasterOuterShadowBusy(): boolean {
    return this.rasterOuterShadowBusy;
  }

  getRasterInnerShadowStyle(): RasterInnerShadowStyle {
    return copyRasterInnerShadowStyle(this.rasterInnerShadowStyle);
  }

  isRasterInnerShadowBusy(): boolean {
    return this.rasterInnerShadowBusy;
  }


  private rasterStrokeActive(): boolean {
    return Boolean(
      this.rasterStrokeRenderer
      && this.rasterStrokeStyle.enabled
      && this.rasterStrokeStyle.width > 0,
    );
  }
  private rasterBevelActive(): boolean {
    return Boolean(
      this.rasterBevelRenderer
      && this.rasterBevelStyle.enabled,
    );
  }
  private rasterOuterShadowActive(): boolean {
    return Boolean(
      this.rasterOuterShadowRenderer
      && this.rasterOuterShadowStyle.enabled,
    );
  }
  private rasterInnerShadowActive(): boolean {
    return Boolean(
      this.rasterInnerShadowRenderer
      && this.rasterInnerShadowStyle.enabled,
    );
  }

  private styleStackActive(): boolean {
    return Boolean(
      this.rasterStrokeRenderer
      && (
        (this.rasterStrokeStyle.enabled && this.rasterStrokeStyle.width > 0)
        || this.rasterBevelStyle.enabled
        || this.rasterOuterShadowStyle.enabled
        || this.rasterInnerShadowStyle.enabled
      ),
    );
  }


  private mergedBelowView(): GPUTextureView {
    return this.mergedBelow?.samplingView ?? this.transparentLayerView;
  }

  private mergedAboveView(): GPUTextureView {
    return this.mergedAbove?.samplingView ?? this.transparentLayerView;
  }

  private rebuildRasterStrokeDisplayBindGroups(): void {
    const renderer = this.rasterStrokeRenderer;
    this.rasterStrokeDisplayBindGroups.clear();
    if (!renderer) {
      return;
    }
    const modes: RasterStrokeSourceMode[] = [
      "permanent",
      "light-glaze",
      "thickness-tail",
    ];
    for (const mode of modes) {
      this.rasterStrokeDisplayBindGroups.set(
        mode,
        renderer.createDisplayBindGroup(
          this.rasterStrokeDisplaySourceBindGroupLayout,
          this.sampler,
          mode,
          this.mergedBelowView(),
          this.mergedAboveView(),
        ),
      );
    }
  }

  /**
   * The coverage buffer is captured both by renderer-owned compute bind groups
   * and by the engine-owned direct LOD-0 display bind groups. Keep the swap
   * atomic from the frame scheduler's point of view: after the renderer moves
   * between real geometry and its placeholder, no display bind group may keep
   * referencing the buffer that was just destroyed.
   */
  private async setRasterStrokeGeometryEnabled(enabled: boolean): Promise<boolean> {
    const renderer = this.rasterStrokeRenderer;
    if (!renderer) {
      return false;
    }
    const changed = await renderer.setStrokeGeometryEnabled(enabled);
    if (!changed) {
      return false;
    }
    this.rasterStrokeCoverageValid = false;
    this.rebuildRasterStrokeDisplayBindGroups();
    return true;
  }

  private requireEffectsWorkbench(): EffectsWorkbench {
    if (!this.effectsWorkbench) {
      throw new Error("Banco effetti non inizializzato per il layer attivo.");
    }
    return this.effectsWorkbench;
  }

  private async ensureRasterStrokeRenderer(
    styleWidth = this.rasterStrokeStyle.width,
    strokeGeometryActive =
      this.rasterStrokeStyle.enabled && styleWidth > 0,
  ): Promise<RasterStrokeRenderer> {
    if (this.rasterStrokeRenderer) {
      await this.setRasterStrokeGeometryEnabled(strokeGeometryActive);
      return this.rasterStrokeRenderer;
    }
    const scratchExtent = rasterStrokeScratchExtentForRenderer(
      strokeGeometryActive,
      styleWidth,
    );
    const renderer = await RasterStrokeRenderer.create({
      device: this.device,
      documentWidth: LAYER_SIZE,
      documentHeight: LAYER_SIZE,
      layerFormat: this.layerFormat,
      layerView: this.layerView,
      lightGlazeUniformBuffer: this.lightGlazeUniformBuffer,
      thicknessTailUniformBuffer: this.thicknessTailDisplayUniformBuffer,
      scratchExtent,
      strokeGeometryEnabled: strokeGeometryActive,
      scratchPool: this.requireEffectsWorkbench().scratchPool,
      bevelBoundingFieldEnabled: this.bevelBoundingFieldEnabled,
    });
    renderer.setLightGlazeView(this.lightGlazeView);
    renderer.setThicknessTailView(this.thicknessTailView);
    renderer.setBevelResources(
      this.rasterBevelRenderer?.heightView ?? null,
      this.rasterBevelRenderer?.glossView ?? null,
    );
    if (this.rasterBevelRenderer) {
      renderer.updateBevelFieldParameters(this.rasterBevelRenderer.fieldState);
    }
    renderer.updateBevelParameters(this.rasterBevelStyle);
    renderer.setShadowResources(
      "outer",
      this.rasterOuterShadowRenderer?.coverageBuffer ?? null,
      this.rasterOuterShadowRenderer?.compositionUniformBuffer ?? null,
    );
    renderer.setShadowResources(
      "inner",
      this.rasterInnerShadowRenderer?.coverageBuffer ?? null,
      this.rasterInnerShadowRenderer?.compositionUniformBuffer ?? null,
    );
    this.requireEffectsWorkbench().attachStrokeRenderer(renderer);
    this.rebuildRasterStrokeDisplayBindGroups();
    this.rasterStrokeMipDownsampleBindGroups = renderer.mipViews
      .slice(0, -1)
      .map((sourceView, sourceMipIndex) => this.device.createBindGroup({
        label: `Traccia styled logical mip ${sourceMipIndex + 1} to ${sourceMipIndex + 2}`,
        layout: this.paintMipDownsampleBindGroupLayout,
        entries: [{ binding: 0, resource: sourceView }],
      }));
    this.rasterStrokeCoverageValid = false;
    this.rasterStrokeStyledInitialized = false;
    this.rasterStrokeMipValidThroughLevel = 0;
    this.rasterStrokeLastEncode = null;
    return renderer;
  }

  private releaseRasterStrokeRenderer(): void {
    this.effectsWorkbench?.releaseStrokeRenderer();
    this.rasterStrokeDisplayBindGroups.clear();
    this.rasterStrokeMipDownsampleBindGroups = [];
    this.rasterStrokeCoverageValid = false;
    this.rasterStrokeStyledInitialized = false;
    this.rasterStrokeMipValidThroughLevel = 0;
    this.rasterStrokePendingComposeRect = null;
    this.rasterStrokeLastEncode = null;
  }

  private async ensureRasterBevelRenderer(): Promise<RasterBevelRenderer> {
    if (this.rasterBevelRenderer) {
      return this.rasterBevelRenderer;
    }
    const renderer = await RasterBevelRenderer.create({
      device: this.device,
      documentWidth: LAYER_SIZE,
      documentHeight: LAYER_SIZE,
      layerView: this.layerView,
      lightGlazeUniformBuffer: this.lightGlazeUniformBuffer,
      thicknessTailUniformBuffer: this.thicknessTailDisplayUniformBuffer,
      scratchPool: this.requireEffectsWorkbench().scratchPool,
      boundingFieldEnabled: this.bevelBoundingFieldEnabled,
    });
    renderer.setLightGlazeView(this.lightGlazeView);
    renderer.setThicknessTailView(this.thicknessTailView);
    renderer.updateStyleResources(this.rasterBevelStyle);
    this.requireEffectsWorkbench().attachBevelRenderer(renderer);
    this.rasterBevelHeightValid = false;
    this.rasterBevelHeightSourceMode = null;
    this.rasterBevelLastEncode = null;
    if (this.rasterStrokeRenderer) {
      this.rasterStrokeRenderer.setBevelResources(renderer.heightView, renderer.glossView);
      this.rasterStrokeRenderer.updateBevelFieldParameters(renderer.fieldState);
      this.rasterStrokeRenderer.updateBevelParameters(this.rasterBevelStyle);
      this.rebuildRasterStrokeDisplayBindGroups();
    }
    return renderer;
  }

  private releaseRasterBevelRenderer(): void {
    this.cancelBevelFieldShrink();
    this.effectsWorkbench?.releaseBevelRenderer();
    this.rasterBevelHeightValid = false;
    this.rasterBevelHeightSourceMode = null;
    this.rasterBevelLastEncode = null;
    if (this.rasterStrokeRenderer) {
      this.rasterStrokeRenderer.setBevelResources(null, null);
      this.rasterStrokeRenderer.updateBevelParameters(this.rasterBevelStyle);
      this.rebuildRasterStrokeDisplayBindGroups();
    }
  }

  private async ensureRasterOuterShadowRenderer(): Promise<RasterShadowRenderer> {
    if (this.rasterOuterShadowRenderer) {
      return this.rasterOuterShadowRenderer;
    }
    const renderer = await RasterShadowRenderer.create({
      device: this.device,
      scratchPool: this.requireEffectsWorkbench().scratchPool,
      kind: "outer",
      documentWidth: LAYER_SIZE,
      documentHeight: LAYER_SIZE,
      layerView: this.layerView,
      lightGlazeUniformBuffer: this.lightGlazeUniformBuffer,
      thicknessTailUniformBuffer: this.thicknessTailDisplayUniformBuffer,
    });
    try {
      renderer.setLightGlazeView(this.lightGlazeView);
      renderer.setThicknessTailView(this.thicknessTailView);
      renderer.updateStyle(this.rasterOuterShadowStyle);
    } catch (error) {
      renderer.destroy();
      throw error;
    }
    this.requireEffectsWorkbench().attachOuterShadowRenderer(renderer);
    this.rasterOuterShadowMatteValid = false;
    this.rasterOuterShadowSourceMode = null;
    this.rasterOuterShadowLastEncode = null;
    if (this.rasterStrokeRenderer) {
      this.rasterStrokeRenderer.setShadowResources(
        "outer",
        renderer.coverageBuffer,
        renderer.compositionUniformBuffer,
      );
      this.rebuildRasterStrokeDisplayBindGroups();
    }
    return renderer;
  }

  private releaseRasterOuterShadowRenderer(): void {
    if (this.rasterStrokeRenderer) {
      this.rasterStrokeRenderer.setShadowResources("outer", null, null);
    }
    this.effectsWorkbench?.releaseOuterShadowRenderer();
    this.rasterOuterShadowMatteValid = false;
    this.rasterOuterShadowSourceMode = null;
    this.rasterOuterShadowLastEncode = null;
    if (this.rasterStrokeRenderer) {
      this.rebuildRasterStrokeDisplayBindGroups();
    }
  }

  private async ensureRasterInnerShadowRenderer(): Promise<RasterShadowRenderer> {
    if (this.rasterInnerShadowRenderer) {
      return this.rasterInnerShadowRenderer;
    }
    const renderer = await RasterShadowRenderer.create({
      device: this.device,
      scratchPool: this.requireEffectsWorkbench().scratchPool,
      kind: "inner",
      documentWidth: LAYER_SIZE,
      documentHeight: LAYER_SIZE,
      layerView: this.layerView,
      lightGlazeUniformBuffer: this.lightGlazeUniformBuffer,
      thicknessTailUniformBuffer: this.thicknessTailDisplayUniformBuffer,
    });
    try {
      renderer.setLightGlazeView(this.lightGlazeView);
      renderer.setThicknessTailView(this.thicknessTailView);
      renderer.updateStyle(this.rasterInnerShadowStyle);
    } catch (error) {
      renderer.destroy();
      throw error;
    }
    this.requireEffectsWorkbench().attachInnerShadowRenderer(renderer);
    this.rasterInnerShadowMatteValid = false;
    this.rasterInnerShadowSourceMode = null;
    this.rasterInnerShadowLastEncode = null;
    if (this.rasterStrokeRenderer) {
      this.rasterStrokeRenderer.setShadowResources(
        "inner",
        renderer.coverageBuffer,
        renderer.compositionUniformBuffer,
      );
      this.rebuildRasterStrokeDisplayBindGroups();
    }
    return renderer;
  }

  private releaseRasterInnerShadowRenderer(): void {
    if (this.rasterStrokeRenderer) {
      this.rasterStrokeRenderer.setShadowResources("inner", null, null);
    }
    this.effectsWorkbench?.releaseInnerShadowRenderer();
    this.rasterInnerShadowMatteValid = false;
    this.rasterInnerShadowSourceMode = null;
    this.rasterInnerShadowLastEncode = null;
    if (this.rasterStrokeRenderer) {
      this.rebuildRasterStrokeDisplayBindGroups();
    }
  }

  async setRasterStrokeStyle(style: unknown): Promise<boolean> {
    const normalized = normalizeRasterStrokeStyle(style);
    const normalizedActive = normalized.enabled && normalized.width > 0;
    if (this.initialized && this.layerSwitchBusy) {
      return false;
    }
    if (
      rasterStrokeStylesEqual(normalized, this.rasterStrokeStyle)
      && (normalizedActive
        ? this.rasterStrokeRenderer?.strokeGeometryEnabled === true
        : this.rasterStrokeRenderer?.strokeGeometryEnabled !== true)
    ) {
      return true;
    }
    if (!this.initialized) {
      this.rasterStrokeStyle = normalized;
      return true;
    }
    if (
      this.activeStroke
      || this.historyBusy
      || this.layerSwitchBusy
      || this.rasterStrokeBusy
      || this.rasterBevelBusy
      || this.rasterOuterShadowBusy
      || this.rasterInnerShadowBusy
    ) {
      return false;
    }

    this.flushPendingWorkBeforeSettingsChange();
    const previous = copyRasterStrokeStyle(this.rasterStrokeStyle);
    const previousActive = previous.enabled && previous.width > 0;
    const nextActive = normalized.enabled && normalized.width > 0;
    this.rasterStrokeBusy = true;
    try {
      if (nextActive) {
        const scratchExtent = rasterStrokeScratchExtentForWidth(normalized.width);
        const rendererNeedsCreation = !this.rasterStrokeRenderer;
        const geometryNeedsAllocation =
          !this.rasterStrokeRenderer?.strokeGeometryEnabled;
        const scratchNeedsResize = Boolean(
          this.rasterStrokeRenderer
          && this.rasterStrokeRenderer.scratchExtent !== scratchExtent,
        );
        if (rendererNeedsCreation || geometryNeedsAllocation || scratchNeedsResize) {
          this.callbacks.onStatus?.(
            rendererNeedsCreation || geometryNeedsAllocation
              ? "Preparo la geometria della Traccia WebGPU…"
              : "Adatto la memoria scratch della Traccia…",
            "working",
          );
          await this.waitForIdle();
          const renderer = await this.ensureRasterStrokeRenderer(normalized.width, true);
          if (renderer.scratchExtent !== scratchExtent) {
            renderer.resizeScratch(scratchExtent);
          }
        }
      }

      this.rasterStrokeStyle = normalized;
      this.invalidateActiveLayerBake();
      if (nextActive) {
        const coverageStyleChanged = normalized.width !== previous.width
          || normalized.position !== previous.position;
        if (!previousActive || coverageStyleChanged) {
          this.rasterStrokeCoverageValid = false;
        }
        this.rasterStrokePendingComposeRect = this.rasterStrokeEffectRect(
          this.layerContentBounds,
          Math.max(previous.width, normalized.width),
        );
        this.presentationCacheNeedsFullRebuild = true;
        this.displayDirty = true;
        this.requestRender();
        this.callbacks.onStatus?.("Traccia WebGPU attiva.", "ok");
      } else {
        await this.waitForIdle();
        if (
          this.rasterBevelStyle.enabled
          || this.rasterOuterShadowStyle.enabled
          || this.rasterInnerShadowStyle.enabled
        ) {
          await this.setRasterStrokeGeometryEnabled(false);
          this.rasterStrokePendingComposeRect = this.rasterStrokeEffectRect(
            this.layerContentBounds,
            previous.width,
          );
          if (
            this.rasterStrokeRenderer
            && this.rasterStrokeRenderer.scratchExtent
              !== RASTER_STROKE_COMPOSITOR_ONLY_SCRATCH_EXTENT
          ) {
            this.rasterStrokeRenderer.resizeScratch(
              RASTER_STROKE_COMPOSITOR_ONLY_SCRATCH_EXTENT,
            );
            this.scheduleEffectsScratchShrink();
          }
        } else {
          this.releaseRasterStrokeRenderer();
        }
        this.paintDisplayMipValidThroughLevel = 0;
        this.presentationCacheNeedsFullRebuild = true;
        this.displayDirty = true;
        this.requestRender();
        if (previousActive) {
          this.callbacks.onStatus?.(
            this.rasterBevelStyle.enabled || this.rasterOuterShadowStyle.enabled || this.rasterInnerShadowStyle.enabled
              ? "Traccia disattivata; il compositore condiviso resta per gli altri effetti."
              : "Traccia disattivata; memoria GPU liberata.",
            "ok",
          );
        }
      }
      this.publishStats();
      return true;
    } catch (error) {
      this.rasterStrokeStyle = previous;
      try {
        if (previousActive && !this.rasterStrokeRenderer) {
          await this.ensureRasterStrokeRenderer(previous.width, true);
        }
        if (this.rasterStrokeRenderer) {
          await this.setRasterStrokeGeometryEnabled(previousActive);
          const previousScratchExtent = rasterStrokeScratchExtentForRenderer(
            previousActive,
            previous.width,
          );
          if (this.rasterStrokeRenderer.scratchExtent !== previousScratchExtent) {
            this.rasterStrokeRenderer.resizeScratch(previousScratchExtent);
          }
        }
      } catch (restoreError) {
        console.error("Ripristino risorse Traccia non riuscito", restoreError);
      }
      if (
        !previousActive
        && !this.rasterBevelStyle.enabled
        && !this.rasterOuterShadowStyle.enabled
        && !this.rasterInnerShadowStyle.enabled
      ) {
        this.releaseRasterStrokeRenderer();
      }
      const message = error instanceof Error ? error.message : String(error);
      this.callbacks.onStatus?.(`Traccia WebGPU non disponibile: ${message}`, "error");
      throw error;
    } finally {
      this.rasterStrokeBusy = false;
    }
  }

  async setRasterBevelStyle(style: unknown): Promise<boolean> {
    const normalized = normalizeRasterBevelStyle(style);
    if (this.initialized && this.layerSwitchBusy) {
      return false;
    }
    const change = classifyRasterBevelStyleChange(
      this.rasterBevelStyle,
      normalized,
      this.rasterBevelHeightValid ? rasterBevelRadiusBucket(this.rasterBevelStyle) : 0,
    );
    if (
      rasterBevelStylesEqual(normalized, this.rasterBevelStyle)
      && (!normalized.enabled || (this.rasterBevelRenderer && this.rasterStrokeRenderer))
    ) {
      return true;
    }
    if (!this.initialized) {
      this.rasterBevelStyle = normalized;
      return true;
    }
    if (
      this.activeStroke
      || this.historyBusy
      || this.layerSwitchBusy
      || this.rasterStrokeBusy
      || this.rasterBevelBusy
      || this.rasterOuterShadowBusy
      || this.rasterInnerShadowBusy
    ) {
      return false;
    }

    this.flushPendingWorkBeforeSettingsChange();
    const previous = copyRasterBevelStyle(this.rasterBevelStyle);
    const previousActive = previous.enabled;
    const previousRect = rasterBevelVisualBounds(
      this.layerContentBounds,
      previous,
      LAYER_SIZE,
      LAYER_SIZE,
    );
    this.rasterBevelBusy = true;
    try {
      await this.waitForIdle();
      this.rasterBevelStyle = normalized;
      this.invalidateActiveLayerBake();
      if (normalized.enabled) {
        if (!this.rasterBevelRenderer) {
          this.callbacks.onStatus?.("Preparo lo Smusso/Rilievo Heightfield V2…", "working");
          await this.ensureRasterBevelRenderer();
        }
        if (!this.rasterStrokeRenderer) {
          await this.ensureRasterStrokeRenderer();
        }
        this.rasterBevelRenderer!.updateStyleResources(normalized);
        this.rasterStrokeRenderer!.setBevelResources(
          this.rasterBevelRenderer!.heightView,
          this.rasterBevelRenderer!.glossView,
        );
        this.rasterStrokeRenderer!.updateBevelFieldParameters(
          this.rasterBevelRenderer!.fieldState,
        );
        this.rasterStrokeRenderer!.updateBevelParameters(normalized);
        this.rebuildRasterStrokeDisplayBindGroups();
        if (!previousActive || change.geometryRebuild) {
          this.rasterBevelHeightValid = false;
          this.rasterBevelHeightSourceMode = null;
        }
        const nextRect = rasterBevelVisualBounds(
          this.layerContentBounds,
          normalized,
          LAYER_SIZE,
          LAYER_SIZE,
        );
        this.rasterBevelPendingComposeRect = this.mergeDirtyRects(
          previousRect,
          nextRect,
        );
        this.callbacks.onStatus?.("Smusso/Rilievo Heightfield V2 attivo.", "ok");
      } else {
        this.rasterBevelPendingComposeRect = previousRect;
        this.releaseRasterBevelRenderer();
        if (
          !(this.rasterStrokeStyle.enabled && this.rasterStrokeStyle.width > 0)
          && !this.rasterOuterShadowStyle.enabled
          && !this.rasterInnerShadowStyle.enabled
        ) {
          this.releaseRasterStrokeRenderer();
        }
        if (previousActive) {
          this.callbacks.onStatus?.(
            "Smusso/Rilievo disattivato; memoria Heightfield liberata.",
            "ok",
          );
        }
      }
      this.paintDisplayMipValidThroughLevel = 0;
      this.presentationCacheNeedsFullRebuild = true;
      this.displayDirty = true;
      this.requestRender();
      this.publishStats();
      return true;
    } catch (error) {
      this.rasterBevelStyle = previous;
      if (!previousActive) {
        this.releaseRasterBevelRenderer();
        if (
          !(this.rasterStrokeStyle.enabled && this.rasterStrokeStyle.width > 0)
          && !this.rasterOuterShadowStyle.enabled
          && !this.rasterInnerShadowStyle.enabled
        ) {
          this.releaseRasterStrokeRenderer();
        }
      } else {
        this.rasterBevelHeightValid = false;
        this.rasterBevelHeightSourceMode = null;
        this.rasterBevelRenderer?.updateStyleResources(previous);
        this.rasterStrokeRenderer?.updateBevelParameters(previous);
      }
      const message = error instanceof Error ? error.message : String(error);
      this.callbacks.onStatus?.(`Smusso/Rilievo WebGPU non disponibile: ${message}`, "error");
      throw error;
    } finally {
      this.rasterBevelBusy = false;
    }
  }

  async setRasterOuterShadowStyle(style: unknown): Promise<boolean> {
    const normalized = normalizeRasterOuterShadowStyle(style);
    if (!rasterOuterShadowUsesSupportedBlend(normalized)) {
      throw new Error(
        "L'Ombra esterna Multiply è esatta solo con colore nero; "
        + "usa Normale per un'ombra colorata.",
      );
    }
    if (this.initialized && this.layerSwitchBusy) {
      return false;
    }
    const change = classifyRasterOuterShadowStyleChange(
      this.rasterOuterShadowStyle,
      normalized,
    );
    if (
      rasterOuterShadowStylesEqual(normalized, this.rasterOuterShadowStyle)
      && (!normalized.enabled || (this.rasterOuterShadowRenderer && this.rasterStrokeRenderer))
    ) {
      return true;
    }
    if (!this.initialized) {
      this.rasterOuterShadowStyle = normalized;
      return true;
    }
    if (
      this.activeStroke
      || this.historyBusy
      || this.layerSwitchBusy
      || this.rasterStrokeBusy
      || this.rasterBevelBusy
      || this.rasterOuterShadowBusy
      || this.rasterInnerShadowBusy
    ) {
      return false;
    }

    this.flushPendingWorkBeforeSettingsChange();
    const previous = copyRasterOuterShadowStyle(this.rasterOuterShadowStyle);
    const previousRect = rasterOuterShadowVisualBounds(
      this.layerContentBounds,
      previous,
      LAYER_SIZE,
      LAYER_SIZE,
    );
    this.rasterOuterShadowBusy = true;
    try {
      await this.waitForIdle();
      this.rasterOuterShadowStyle = normalized;
      this.invalidateActiveLayerBake();
      if (normalized.enabled) {
        if (!this.rasterOuterShadowRenderer) {
          this.callbacks.onStatus?.("Preparo l'Ombra esterna WebGPU…", "working");
          await this.ensureRasterOuterShadowRenderer();
        }
        if (!this.rasterStrokeRenderer) {
          await this.ensureRasterStrokeRenderer();
        }
        this.rasterOuterShadowRenderer!.updateStyle(normalized);
        this.rasterStrokeRenderer!.setShadowResources(
          "outer",
          this.rasterOuterShadowRenderer!.coverageBuffer,
          this.rasterOuterShadowRenderer!.compositionUniformBuffer,
        );
        if (change.matteChanged) {
          this.rasterOuterShadowMatteValid = false;
          this.rasterOuterShadowSourceMode = null;
        }
        const nextRect = rasterOuterShadowVisualBounds(
          this.layerContentBounds,
          normalized,
          LAYER_SIZE,
          LAYER_SIZE,
        );
        this.rasterOuterShadowPendingComposeRect = this.mergeDirtyRects(
          previousRect,
          nextRect,
        );
        this.callbacks.onStatus?.("Ombra esterna WebGPU attiva.", "ok");
      } else {
        this.rasterOuterShadowPendingComposeRect = previousRect;
        this.releaseRasterOuterShadowRenderer();
        if (
          !(this.rasterStrokeStyle.enabled && this.rasterStrokeStyle.width > 0)
          && !this.rasterBevelStyle.enabled
          && !this.rasterInnerShadowStyle.enabled
        ) {
          this.releaseRasterStrokeRenderer();
        }
        this.callbacks.onStatus?.(
          "Ombra esterna disattivata; matte R8 liberata.",
          "ok",
        );
      }
      this.paintDisplayMipValidThroughLevel = 0;
      this.presentationCacheNeedsFullRebuild = true;
      this.displayDirty = true;
      this.requestRender();
      this.publishStats();
      return true;
    } catch (error) {
      this.rasterOuterShadowStyle = previous;
      if (!previous.enabled) {
        this.releaseRasterOuterShadowRenderer();
        if (
          !(this.rasterStrokeStyle.enabled && this.rasterStrokeStyle.width > 0)
          && !this.rasterBevelStyle.enabled
          && !this.rasterInnerShadowStyle.enabled
        ) {
          this.releaseRasterStrokeRenderer();
        }
      } else {
        this.rasterOuterShadowMatteValid = false;
        this.rasterOuterShadowSourceMode = null;
        this.rasterOuterShadowRenderer?.updateStyle(previous);
      }
      const message = error instanceof Error ? error.message : String(error);
      this.callbacks.onStatus?.(`Ombra esterna WebGPU non disponibile: ${message}`, "error");
      throw error;
    } finally {
      this.rasterOuterShadowBusy = false;
    }
  }

  async setRasterInnerShadowStyle(style: unknown): Promise<boolean> {
    const normalized = normalizeRasterInnerShadowStyle(style);
    if (this.initialized && this.layerSwitchBusy) {
      return false;
    }
    const change = classifyRasterInnerShadowStyleChange(
      this.rasterInnerShadowStyle,
      normalized,
    );
    if (
      rasterInnerShadowStylesEqual(normalized, this.rasterInnerShadowStyle)
      && (!normalized.enabled || (this.rasterInnerShadowRenderer && this.rasterStrokeRenderer))
    ) {
      return true;
    }
    if (!this.initialized) {
      this.rasterInnerShadowStyle = normalized;
      return true;
    }
    if (
      this.activeStroke
      || this.historyBusy
      || this.layerSwitchBusy
      || this.rasterStrokeBusy
      || this.rasterBevelBusy
      || this.rasterOuterShadowBusy
      || this.rasterInnerShadowBusy
    ) {
      return false;
    }

    this.flushPendingWorkBeforeSettingsChange();
    const previous = copyRasterInnerShadowStyle(this.rasterInnerShadowStyle);
    const previousRect = rasterInnerShadowVisualBounds(
      this.layerContentBounds,
      previous,
      LAYER_SIZE,
      LAYER_SIZE,
    );
    this.rasterInnerShadowBusy = true;
    try {
      await this.waitForIdle();
      this.rasterInnerShadowStyle = normalized;
      this.invalidateActiveLayerBake();
      if (normalized.enabled) {
        if (!this.rasterInnerShadowRenderer) {
          this.callbacks.onStatus?.("Preparo l'Ombra interna WebGPU…", "working");
          await this.ensureRasterInnerShadowRenderer();
        }
        if (!this.rasterStrokeRenderer) {
          await this.ensureRasterStrokeRenderer();
        }
        this.rasterInnerShadowRenderer!.updateStyle(normalized);
        this.rasterStrokeRenderer!.setShadowResources(
          "inner",
          this.rasterInnerShadowRenderer!.coverageBuffer,
          this.rasterInnerShadowRenderer!.compositionUniformBuffer,
        );
        if (change.matteChanged) {
          this.rasterInnerShadowMatteValid = false;
          this.rasterInnerShadowSourceMode = null;
        }
        const nextRect = rasterInnerShadowVisualBounds(
          this.layerContentBounds,
          normalized,
          LAYER_SIZE,
          LAYER_SIZE,
        );
        this.rasterInnerShadowPendingComposeRect = this.mergeDirtyRects(
          previousRect,
          nextRect,
        );
        this.callbacks.onStatus?.("Ombra interna WebGPU attiva.", "ok");
      } else {
        this.rasterInnerShadowPendingComposeRect = previousRect;
        this.releaseRasterInnerShadowRenderer();
        if (
          !(this.rasterStrokeStyle.enabled && this.rasterStrokeStyle.width > 0)
          && !this.rasterBevelStyle.enabled
          && !this.rasterOuterShadowStyle.enabled
        ) {
          this.releaseRasterStrokeRenderer();
        }
        this.callbacks.onStatus?.(
          "Ombra interna disattivata; matte R8 liberata.",
          "ok",
        );
      }
      this.paintDisplayMipValidThroughLevel = 0;
      this.presentationCacheNeedsFullRebuild = true;
      this.displayDirty = true;
      this.requestRender();
      this.publishStats();
      return true;
    } catch (error) {
      this.rasterInnerShadowStyle = previous;
      if (!previous.enabled) {
        this.releaseRasterInnerShadowRenderer();
        if (
          !(this.rasterStrokeStyle.enabled && this.rasterStrokeStyle.width > 0)
          && !this.rasterBevelStyle.enabled
          && !this.rasterOuterShadowStyle.enabled
        ) {
          this.releaseRasterStrokeRenderer();
        }
      } else {
        this.rasterInnerShadowMatteValid = false;
        this.rasterInnerShadowSourceMode = null;
        this.rasterInnerShadowRenderer?.updateStyle(previous);
      }
      const message = error instanceof Error ? error.message : String(error);
      this.callbacks.onStatus?.(`Ombra interna WebGPU non disponibile: ${message}`, "error");
      throw error;
    } finally {
      this.rasterInnerShadowBusy = false;
    }
  }

  async setLayerFormat(format: LayerFormat): Promise<boolean> {
    if (format === this.layerFormat) {
      return true;
    }
    if (!this.initialized || this.historyBusy || this.activeStroke || this.layerSwitchBusy) {
      return false;
    }

    this.cancelLayerColdCompressionIdle();
    const previousFormat = this.layerFormat;
    this.invalidateAdaptivePreview();
    this.historyBusy = true;
    this.publishHistoryState();
    this.callbacks.onStatus?.(`Ricreo il layer in formato ${format}…`, "working");
    try {
      await this.waitForIdle();
      await this.recreateLayerResources(format);
      this.layerFormat = format;
      this.resetHistoryState();
      this.clearRequested = true;
      this.displayDirty = true;
      this.layerStack.active.contentBounds = null;
      this.layerStack.active.hasContent = false;
      clearLayerStorageTileMask(this.layerStack.active.storageTileMask);
      this.layerHasContent = false;
      this.layerContentBounds = null;
      try {
        if (this.rasterBevelStyle.enabled) {
          await this.ensureRasterBevelRenderer();
        }
        if (this.rasterOuterShadowStyle.enabled) {
          await this.ensureRasterOuterShadowRenderer();
        }
        if (this.rasterInnerShadowStyle.enabled) {
          await this.ensureRasterInnerShadowRenderer();
        }
        if (
          (this.rasterStrokeStyle.enabled && this.rasterStrokeStyle.width > 0)
          || this.rasterBevelStyle.enabled
          || this.rasterOuterShadowStyle.enabled
          || this.rasterInnerShadowStyle.enabled
        ) {
          await this.ensureRasterStrokeRenderer();
        }
      } catch (styleError) {
        this.rasterStrokeStyle = { ...this.rasterStrokeStyle, enabled: false };
        this.rasterBevelStyle = { ...this.rasterBevelStyle, enabled: false };
        this.rasterOuterShadowStyle = { ...this.rasterOuterShadowStyle, enabled: false };
        this.rasterInnerShadowStyle = { ...this.rasterInnerShadowStyle, enabled: false };
        this.releaseRasterOuterShadowRenderer();
        this.releaseRasterInnerShadowRenderer();
        this.releaseRasterBevelRenderer();
        this.releaseRasterStrokeRenderer();
        console.error(
          "Ricreazione style stack dopo cambio formato non riuscita",
          styleError,
        );
      }
      this.requestRender();
      this.callbacks.onStatus?.(`Layer ${format} pronto. Il contenuto è stato azzerato.`, "ok");
      this.publishStats();
      return true;
    } catch (error) {
      // recreateLayerResources assegna e distrugge le risorse precedenti solo
      // dopo che pipeline, texture di tutti i livelli e Blend candidati hanno
      // chiuso gli scope validation/OOM. In caso di errore, il documento e la
      // sua cronologia sono quindi ancora validi.
      this.layerFormat = previousFormat;
      const message = error instanceof Error ? error.message : String(error);
      this.callbacks.onStatus?.(`Formato ${format} non disponibile: ${message}`, "error");
      throw error;
    } finally {
      this.historyBusy = false;
      this.publishHistoryState();
      this.scheduleLayerColdCompression();
    }
  }

  resizeCanvas(): void {
    if (!this.device || !this.context) {
      return;
    }

    const rectangle = this.canvas.getBoundingClientRect();
    this.canvasCssWidth = Math.max(1, rectangle.width);
    this.canvasCssHeight = Math.max(1, rectangle.height);
    const devicePixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(rectangle.width * devicePixelRatio));
    const height = Math.max(1, Math.floor(rectangle.height * devicePixelRatio));

    if (this.canvas.width === width && this.canvas.height === height) {
      return;
    }

    this.invalidateAdaptivePreview();
    this.canvas.width = width;
    this.canvas.height = height;
    this.displayDirty = true;
    this.presentationCacheNeedsFullRebuild = true;

    if (!this.hasFittedView) {
      this.fitView();
    } else {
      this.notifyViewChange();
      this.requestRender();
    }
  }

  getVectorTextViewState(): VectorTextViewState {
    return {
      canvasWidth: Math.max(1, this.canvas.width),
      canvasHeight: Math.max(1, this.canvas.height),
      cssWidth: Math.max(1, this.canvasCssWidth),
      cssHeight: Math.max(1, this.canvasCssHeight),
      centerX: this.viewCenterX,
      centerY: this.viewCenterY,
      zoom: this.zoom,
      rotationRadians: this.viewRotation,
      rotationCos: this.viewRotationCos,
      rotationSin: this.viewRotationSin,
    };
  }

  isPaintStrokeActive(): boolean {
    return this.activeStroke !== null;
  }

  private createMixedSceneSnapshot(): MixedSceneSnapshot | null {
    const scene = this.mixedSceneStack;
    if (!scene) {
      return null;
    }
    return {
      strategy: MIXED_SCENE_STACK_STRATEGY,
      selectedKey: scene.selected.key,
      activeRasterLayerId: this.layerStack.active.id,
      previewTextNodeId: this.vectorTextPreviewExcludedNodeId,
      items: scene.items.map((item) => {
        if (item.kind === "raster") {
          const rasterLayerIndex = this.layerStack.indexOfId(item.rasterLayerId);
          if (rasterLayerIndex < 0) {
            throw new Error(
              `Raster ${item.rasterLayerId} presente nella scena ma assente dallo stack GPU.`,
            );
          }
          return {
            key: item.key,
            kind: item.kind,
            rasterLayerId: item.rasterLayerId,
            rasterLayerIndex,
          };
        }
        return {
          key: item.key,
          kind: item.kind,
          textNode: cloneVectorTextNode(scene.textById(item.textNodeId)),
        };
      }),
    };
  }

  getMixedSceneSnapshot(): MixedSceneSnapshot | null {
    return this.createMixedSceneSnapshot();
  }

  private publishMixedScene(): void {
    const snapshot = this.createMixedSceneSnapshot();
    if (snapshot) {
      this.callbacks.onMixedSceneChange?.(snapshot);
    }
  }

  canPaintSelectedSceneItem(): boolean {
    return this.mixedSceneStack?.selected.kind !== "text";
  }

  private notifyViewChange(): void {
    this.callbacks.onViewChange?.(this.getVectorTextViewState());
  }

  private writeVectorTextCaptureUniforms(): void {
    const view = this.vectorTextCaptureView ?? this.getVectorTextViewState();
    const upload = this.vectorTextCaptureUniformUpload;
    upload[0] = view.canvasWidth;
    upload[1] = view.canvasHeight;
    upload[2] = view.rotationCos;
    upload[3] = view.rotationSin;
    upload[4] = view.centerX;
    upload[5] = view.centerY;
    upload[6] = view.zoom;
    upload[7] = this.vectorTextFastPresentationEnabled ? 1 : 0;
    this.device.queue.writeBuffer(
      this.vectorTextCaptureUniformBuffer,
      0,
      upload,
    );
  }

  private captureVectorTextPresentationView(): void {
    const next = this.getVectorTextViewState();
    const previous = this.vectorTextCaptureView;
    if (
      previous
      && previous.canvasWidth === next.canvasWidth
      && previous.canvasHeight === next.canvasHeight
      && previous.centerX === next.centerX
      && previous.centerY === next.centerY
      && previous.zoom === next.zoom
      && previous.rotationCos === next.rotationCos
      && previous.rotationSin === next.rotationSin
    ) {
      return;
    }
    this.vectorTextCaptureView = next;
    this.writeVectorTextCaptureUniforms();
  }

  setVectorTextFastPresentationEnabled(enabled: boolean): void {
    if (!this.vectorTextPrototypeEnabled || !this.initialized) {
      return;
    }
    const next = enabled && this.vectorTextCaptureView !== null;
    if (this.vectorTextFastPresentationEnabled === next) {
      return;
    }
    this.vectorTextFastPresentationEnabled = next;
    this.writeVectorTextCaptureUniforms();
    this.displayDirty = true;
    this.presentationCacheNeedsFullRebuild = true;
    this.requestRender();
  }
  updateVectorTextPresentation(
    source: HTMLCanvasElement,
    placement: VectorTextPlacement,
  ): VectorTextGpuPresentationStats {
    if (!this.vectorTextPrototypeEnabled || !this.initialized) {
      throw new Error("Prototipo testo vettoriale non abilitato per questa pagina.");
    }
    const width = Math.max(1, this.canvas.width);
    const height = Math.max(1, this.canvas.height);
    if (source.width !== width || source.height !== height) {
      throw new Error(
        `Cache testo ${source.width}×${source.height} diversa dal viewport ${width}×${height}.`,
      );
    }
    this.captureVectorTextPresentationView();
    const texture = this.ensureVectorTextPresentationTexture(width, height, placement);
    this.device.queue.copyExternalImageToTexture(
      { source },
      {
        texture,
        premultipliedAlpha: true,
        colorSpace: "srgb",
      },
      { width, height, depthOrArrayLayers: 1 },
    );
    this.displayDirty = true;
    this.presentationCacheNeedsFullRebuild = true;
    this.requestRender();
    return {
      strategy: VECTOR_TEXT_PRESENTATION_STRATEGY,
      width,
      height,
      gpuMemoryMiB: width * height * 4 / MEBIBYTE_BYTES,
      placement,
      blurGpuMemoryMiB: 0,
      blurCacheEntries: 0,
    };
  }

  private ensureVectorTextGpuScratch(width: number, height: number): void {
    if (
      this.vectorTextGpuMsaaTexture
      && this.vectorTextGpuMsaaView
      && this.vectorTextGpuResolvedTexture
      && this.vectorTextGpuResolvedView
      && this.vectorTextGpuScratchWidth === width
      && this.vectorTextGpuScratchHeight === height
    ) {
      return;
    }
    this.vectorTextGpuMsaaTexture?.destroy();
    this.vectorTextGpuResolvedTexture?.destroy();
    this.vectorTextGpuMsaaTexture = this.device.createTexture({
      label: `Vector text shared MSAA4 color ${width}×${height}`,
      size: { width, height, depthOrArrayLayers: 1 },
      sampleCount: VECTOR_TEXT_GPU_SAMPLE_COUNT,
      format: VECTOR_TEXT_GPU_TARGET_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.vectorTextGpuMsaaView = this.vectorTextGpuMsaaTexture.createView({
      label: "Vector text shared MSAA4 color view",
    });
    this.vectorTextGpuResolvedTexture = this.device.createTexture({
      label: `Vector text shared resolved crop ${width}×${height}`,
      size: { width, height, depthOrArrayLayers: 1 },
      format: VECTOR_TEXT_GPU_TARGET_FORMAT,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT
        | GPUTextureUsage.COPY_SRC,
    });
    this.vectorTextGpuResolvedView = this.vectorTextGpuResolvedTexture.createView({
      label: "Vector text shared resolved crop view",
    });
    this.vectorTextGpuScratchWidth = width;
    this.vectorTextGpuScratchHeight = height;
  }

  private releaseVectorTextGpuScratch(): void {
    this.vectorTextGpuMsaaTexture?.destroy();
    this.vectorTextGpuResolvedTexture?.destroy();
    this.vectorTextGpuMsaaTexture = null;
    this.vectorTextGpuMsaaView = null;
    this.vectorTextGpuResolvedTexture = null;
    this.vectorTextGpuResolvedView = null;
    this.vectorTextGpuScratchWidth = 0;
    this.vectorTextGpuScratchHeight = 0;
  }

  private ensureVectorTextGpuResource(
    draw: VectorTextGpuDraw,
  ): VectorTextGpuDrawResources {
    const revision = draw.mode === "mesh-direct"
      ? draw.mesh.revision
      : draw.slug.revision;
    const existing = this.vectorTextGpuMeshes.get(draw.meshKey);
    if (
      existing
      && existing.revision === revision
      && existing.kind === (draw.mode === "mesh-direct" ? "mesh" : "slug")
    ) {
      return existing;
    }
    let created: VectorTextGpuDrawResources;
    if (draw.mode === "mesh-direct") {
      created = createVectorTextGpuMeshResources(this.device, draw);
    } else {
      const uniformBuffer = this.vectorTextGpuUniformBuffer;
      const layout = this.vectorTextGpuSlugBindGroupLayout;
      if (!uniformBuffer || !layout) {
        throw new Error("Layout Slug del testo vettoriale non inizializzato.");
      }
      created = createVectorTextGpuSlugResources(
        this.device,
        draw,
        uniformBuffer,
        layout,
        VECTOR_TEXT_SLUG_UNIFORM_BYTES,
      );
    }
    this.vectorTextGpuMeshes.set(draw.meshKey, created);
    if (existing) {
      destroyVectorTextGpuResources(existing);
    }
    return created;
  }

  private ensureVectorTextGpuBlurCache(
    draw: VectorTextGpuSlugBlurSourceDraw,
  ): VectorTextGpuBlurCacheResources {
    const existing = this.vectorTextGpuBlurCaches.get(draw.blurKey);
    if (
      existing
      && existing.width === draw.blurWidth
      && existing.height === draw.blurHeight
    ) {
      return existing;
    }
    if (existing) {
      existing.texture.destroy();
      this.vectorTextGpuBlurCaches.delete(draw.blurKey);
    }
    const layout = this.vectorTextGpuBlurCompositeBindGroupLayout;
    const innerLayout = this.vectorTextGpuInnerShadowBindGroupLayout;
    const uniformBuffer = this.vectorTextGpuUniformBuffer;
    const sampler = this.vectorTextGpuBlurSampler;
    if (!layout || !innerLayout || !uniformBuffer || !sampler) {
      throw new Error("Compositore GPU del blur testo non inizializzato.");
    }
    const texture = this.device.createTexture({
      label: `Vector text GPU blur cache ${draw.blurKey} ${draw.blurWidth}×${draw.blurHeight}`,
      size: {
        width: draw.blurWidth,
        height: draw.blurHeight,
        depthOrArrayLayers: 1,
      },
      format: VECTOR_TEXT_GPU_BLUR_FORMAT,
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
    });
    try {
      const view = texture.createView({
        label: `Vector text GPU blur cache view ${draw.blurKey}`,
      });
      const compositeBindGroup = this.device.createBindGroup({
        label: `Vector text GPU blur composite ${draw.blurKey}`,
        layout,
        entries: [
          {
            binding: 0,
            resource: {
              buffer: uniformBuffer,
              offset: 0,
              size: VECTOR_TEXT_GPU_BLUR_COMPOSITE_UNIFORM_BYTES,
            },
          },
          { binding: 1, resource: view },
          { binding: 2, resource: sampler },
        ],
      });
      const innerShadowBindGroup = this.device.createBindGroup({
        label: `Vector text GPU inner-shadow mask ${draw.blurKey}`,
        layout: innerLayout,
        entries: [
          { binding: 0, resource: view },
          { binding: 1, resource: sampler },
        ],
      });
      const created: VectorTextGpuBlurCacheResources = {
        texture,
        view,
        compositeBindGroup,
        innerShadowBindGroup,
        width: draw.blurWidth,
        height: draw.blurHeight,
        memoryBytes: draw.blurWidth * draw.blurHeight,
        needsBuild: true,
      };
      this.vectorTextGpuBlurCaches.set(draw.blurKey, created);
      return created;
    } catch (error) {
      texture.destroy();
      throw error;
    }
  }

  private ensureVectorTextGpuBlurScratch(width: number, height: number): void {
    const requiredWidth = Math.max(1, Math.ceil(width));
    const requiredHeight = Math.max(1, Math.ceil(height));
    if (
      this.vectorTextGpuBlurScratchATexture
      && this.vectorTextGpuBlurScratchAView
      && this.vectorTextGpuBlurScratchBTexture
      && this.vectorTextGpuBlurScratchBView
      && this.vectorTextGpuBlurFilterBindGroupAToB
      && this.vectorTextGpuBlurFilterBindGroupBToA
      && this.vectorTextGpuBlurScratchWidth >= requiredWidth
      && this.vectorTextGpuBlurScratchHeight >= requiredHeight
    ) {
      return;
    }
    this.releaseVectorTextGpuBlurScratch();
    const layout = this.vectorTextGpuBlurFilterBindGroupLayout;
    const uniformBuffer = this.vectorTextGpuBlurFilterUniformBuffer;
    if (!layout || !uniformBuffer) {
      throw new Error("Filtro GPU del blur testo non inizializzato.");
    }
    const textureDescriptor: GPUTextureDescriptor = {
      size: {
        width: requiredWidth,
        height: requiredHeight,
        depthOrArrayLayers: 1,
      },
      format: VECTOR_TEXT_GPU_BLUR_FORMAT,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT
        | GPUTextureUsage.TEXTURE_BINDING
        | GPUTextureUsage.COPY_SRC,
    };
    const textureA = this.device.createTexture({
      ...textureDescriptor,
      label: `Vector text GPU blur scratch A ${requiredWidth}×${requiredHeight}`,
    });
    const textureB = this.device.createTexture({
      ...textureDescriptor,
      label: `Vector text GPU blur scratch B ${requiredWidth}×${requiredHeight}`,
    });
    try {
      const viewA = textureA.createView({ label: "Vector text GPU blur scratch A view" });
      const viewB = textureB.createView({ label: "Vector text GPU blur scratch B view" });
      const uniformEntry: GPUBindGroupEntry = {
        binding: 0,
        resource: {
          buffer: uniformBuffer,
          offset: 0,
          size: VECTOR_TEXT_GPU_BLUR_FILTER_UNIFORM_BYTES,
        },
      };
      this.vectorTextGpuBlurFilterBindGroupAToB = this.device.createBindGroup({
        label: "Vector text GPU blur horizontal A to B",
        layout,
        entries: [uniformEntry, { binding: 1, resource: viewA }],
      });
      this.vectorTextGpuBlurFilterBindGroupBToA = this.device.createBindGroup({
        label: "Vector text GPU blur vertical B to A",
        layout,
        entries: [uniformEntry, { binding: 1, resource: viewB }],
      });
      this.vectorTextGpuBlurScratchATexture = textureA;
      this.vectorTextGpuBlurScratchAView = viewA;
      this.vectorTextGpuBlurScratchBTexture = textureB;
      this.vectorTextGpuBlurScratchBView = viewB;
      this.vectorTextGpuBlurScratchWidth = requiredWidth;
      this.vectorTextGpuBlurScratchHeight = requiredHeight;
    } catch (error) {
      textureA.destroy();
      textureB.destroy();
      throw error;
    }
  }

  private releaseVectorTextGpuBlurScratch(): void {
    this.vectorTextGpuBlurScratchATexture?.destroy();
    this.vectorTextGpuBlurScratchBTexture?.destroy();
    this.vectorTextGpuBlurScratchATexture = null;
    this.vectorTextGpuBlurScratchAView = null;
    this.vectorTextGpuBlurScratchBTexture = null;
    this.vectorTextGpuBlurScratchBView = null;
    this.vectorTextGpuBlurScratchWidth = 0;
    this.vectorTextGpuBlurScratchHeight = 0;
    this.vectorTextGpuBlurFilterBindGroupAToB = null;
    this.vectorTextGpuBlurFilterBindGroupBToA = null;
  }

  private writeVectorTextGpuBlurSourceUniform(
    draw: VectorTextGpuSlugBlurSourceDraw,
    drawIndex: number,
  ): void {
    const base = drawIndex * VECTOR_TEXT_GPU_UNIFORM_STRIDE / 4;
    const upload = this.vectorTextGpuUniformUpload;
    upload.fill(0, base, base + VECTOR_TEXT_GPU_UNIFORM_STRIDE / 4);
    upload[base] = draw.blurWidth;
    upload[base + 1] = draw.blurHeight;
    upload[base + 2] = 1;
    upload[base + 4] = (draw.blurBounds[0] + draw.blurBounds[2]) * 0.5;
    upload[base + 5] = (draw.blurBounds[1] + draw.blurBounds[3]) * 0.5;
    upload[base + 6] = draw.blurScale;
    upload[base + 10] = 1;
    upload[base + 12] = 1;
    upload[base + 13] = draw.slug.originX;
    upload[base + 14] = draw.slug.originY;
    upload[base + 16] = 1;
    upload[base + 17] = 1;
    upload[base + 18] = 1;
    upload[base + 19] = 1;
    upload[base + 22] = draw.blurWidth;
    upload[base + 23] = draw.blurHeight;
    upload[base + 24] = draw.slug.left;
    upload[base + 25] = draw.slug.top;
    upload[base + 26] = draw.slug.right;
    upload[base + 27] = draw.slug.bottom;
    upload[base + 28] = draw.slug.bandScaleX;
    upload[base + 29] = draw.slug.bandScaleY;
    upload[base + 30] = draw.slug.bandOffsetX;
    upload[base + 31] = draw.slug.bandOffsetY;
    const unsigned = this.vectorTextGpuUniformUploadUnsigned;
    unsigned[base + 32] = draw.slug.horizontalHeaderBase;
    unsigned[base + 33] = draw.slug.verticalHeaderBase;
    unsigned[base + 34] = draw.slug.horizontalBandCount;
    unsigned[base + 35] = draw.slug.verticalBandCount;
    unsigned[base + 36] = draw.slug.curveTexture.logWidth;
    unsigned[base + 37] = draw.slug.bandTexture.logWidth;
  }

  private writeVectorTextGpuBlurFilterUniform(
    draw: VectorTextGpuSlugBlurSourceDraw,
    filterIndex: number,
  ): void {
    const base = filterIndex * VECTOR_TEXT_GPU_UNIFORM_STRIDE / 4;
    const upload = this.vectorTextGpuBlurFilterUniformUpload;
    const unsigned = this.vectorTextGpuBlurFilterUniformUploadUnsigned;
    upload.fill(0, base, base + VECTOR_TEXT_GPU_UNIFORM_STRIDE / 4);
    unsigned[base] = draw.blurWidth;
    unsigned[base + 1] = draw.blurHeight;
    unsigned[base + 2] = draw.blurRadius;
    const sigma = Math.max(0.01, draw.blurSigmaPixels);
    const weights = new Float64Array(draw.blurRadius + 1);
    let normalizer = 0;
    for (let index = 0; index <= draw.blurRadius; index += 1) {
      const weight = Math.exp(-0.5 * (index / sigma) ** 2);
      weights[index] = weight;
      normalizer += index === 0 ? weight : weight * 2;
    }
    for (let index = 0; index <= draw.blurRadius; index += 1) {
      upload[base + 4 + index] = weights[index] / normalizer;
    }
  }

  private vectorTextGpuBlurMemoryBytes(): number {
    const cacheBytes = [...this.vectorTextGpuBlurCaches.values()].reduce(
      (total, resources) => total + resources.memoryBytes,
      0,
    );
    const scratchBytes = this.vectorTextGpuBlurScratchATexture
      ? this.vectorTextGpuBlurScratchWidth * this.vectorTextGpuBlurScratchHeight * 2
      : 0;
    return cacheBytes + scratchBytes;
  }
  private writeVectorTextGpuDrawUniform(
    draw: VectorTextGpuDraw,
    view: VectorTextViewState,
    drawIndex: number,
    targetBounds: DirtyRect,
  ): void {
    const base = drawIndex * VECTOR_TEXT_GPU_UNIFORM_STRIDE / 4;
    const upload = this.vectorTextGpuUniformUpload;
    upload.fill(0, base, base + VECTOR_TEXT_GPU_UNIFORM_STRIDE / 4);
    upload[base] = view.canvasWidth;
    upload[base + 1] = view.canvasHeight;
    upload[base + 2] = view.rotationCos;
    upload[base + 3] = view.rotationSin;
    upload[base + 4] = view.centerX;
    upload[base + 5] = view.centerY;
    upload[base + 6] = view.zoom;
    upload[base + 8] = draw.x;
    upload[base + 9] = draw.y;
    upload[base + 10] = Math.cos(draw.rotation);
    upload[base + 11] = Math.sin(draw.rotation);
    upload[base + 12] = draw.scale;
    upload[base + 13] = draw.localOffsetX;
    upload[base + 14] = draw.localOffsetY;
    upload[base + 16] = draw.color[0];
    upload[base + 20] = targetBounds.x;
    upload[base + 21] = targetBounds.y;
    upload[base + 22] = this.vectorTextGpuScratchWidth;
    upload[base + 23] = this.vectorTextGpuScratchHeight;
    upload[base + 17] = draw.color[1];
    upload[base + 18] = draw.color[2];
    upload[base + 19] = draw.opacity;
    if (draw.mode !== "mesh-direct") {
      const shapeBounds = (
        draw.mode === "slug-blur"
        || draw.mode === "slug-inner-shadow-blur"
      )
        ? draw.blurBounds
        : [draw.slug.left, draw.slug.top, draw.slug.right, draw.slug.bottom] as const;
      upload[base + 24] = shapeBounds[0];
      upload[base + 25] = shapeBounds[1];
      upload[base + 26] = shapeBounds[2];
      upload[base + 27] = shapeBounds[3];
      upload[base + 28] = draw.slug.bandScaleX;
      upload[base + 29] = draw.slug.bandScaleY;
      upload[base + 30] = draw.slug.bandOffsetX;
      upload[base + 31] = draw.slug.bandOffsetY;
      const unsigned = this.vectorTextGpuUniformUploadUnsigned;
      unsigned[base + 32] = draw.slug.horizontalHeaderBase;
      unsigned[base + 33] = draw.slug.verticalHeaderBase;
      unsigned[base + 34] = draw.slug.horizontalBandCount;
      unsigned[base + 35] = draw.slug.verticalBandCount;
      unsigned[base + 36] = draw.slug.curveTexture.logWidth;
      unsigned[base + 37] = draw.slug.bandTexture.logWidth;
      if (
        draw.mode === "slug-inner-shadow-direct"
        || draw.mode === "slug-inner-shadow-blur"
      ) {
        upload[base + 40] = draw.sampleOffsetX;
        upload[base + 41] = draw.sampleOffsetY;
      }
    }
  }

  private vectorTextGpuRunBounds(
    draws: readonly VectorTextGpuDraw[],
    view: VectorTextViewState,
  ): DirtyRect {
    let left = Number.POSITIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    for (const draw of draws) {
      const cosine = Math.cos(draw.rotation);
      const sine = Math.sin(draw.rotation);
      const bounds = draw.mode === "slug-blur"
        ? draw.blurBounds
        : draw.mode === "mesh-direct"
          ? [draw.mesh.left, draw.mesh.top, draw.mesh.right, draw.mesh.bottom] as const
          : [draw.slug.left, draw.slug.top, draw.slug.right, draw.slug.bottom] as const;
      const localCorners = [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[1]],
        [bounds[2], bounds[3]],
        [bounds[0], bounds[3]],
      ] as const;
      for (const [sourceX, sourceY] of localCorners) {
        const localX = (sourceX + draw.localOffsetX) * draw.scale;
        const localY = (sourceY + draw.localOffsetY) * draw.scale;
        const layerX = draw.x + cosine * localX - sine * localY;
        const layerY = draw.y + sine * localX + cosine * localY;
        const deltaX = layerX - view.centerX;
        const deltaY = layerY - view.centerY;
        const canvasX = view.canvasWidth * 0.5 + view.zoom * (
          view.rotationCos * deltaX - view.rotationSin * deltaY
        );
        const canvasY = view.canvasHeight * 0.5 + view.zoom * (
          view.rotationSin * deltaX + view.rotationCos * deltaY
        );
        left = Math.min(left, canvasX);
        top = Math.min(top, canvasY);
        right = Math.max(right, canvasX);
        bottom = Math.max(bottom, canvasY);
      }
    }
    if (!Number.isFinite(left)) {
      return { x: 0, y: 0, width: 1, height: 1 };
    }
    const margin = 2;
    const x = Math.max(0, Math.floor(left - margin));
    const y = Math.max(0, Math.floor(top - margin));
    const clippedRight = Math.min(view.canvasWidth, Math.ceil(right + margin));
    const clippedBottom = Math.min(view.canvasHeight, Math.ceil(bottom + margin));
    return {
      x: Math.min(view.canvasWidth - 1, x),
      y: Math.min(view.canvasHeight - 1, y),
      width: Math.max(1, clippedRight - x),
      height: Math.max(1, clippedBottom - y),
    };
  }

  private vectorTextGpuClearBounds(
    first: DirtyRect | null,
    second: DirtyRect,
  ): DirtyRect {
    if (!first) {
      return second;
    }
    const x = Math.min(first.x, second.x);
    const y = Math.min(first.y, second.y);
    const right = Math.max(
      first.x + first.width,
      second.x + second.width,
    );
    const bottom = Math.max(
      first.y + first.height,
      second.y + second.height,
    );
    return { x, y, width: right - x, height: bottom - y };
  }

  updateVectorTextGpuPresentation(
    placement: VectorTextPlacement,
    draws: readonly VectorTextGpuDraw[],
  ): VectorTextGpuPresentationStats {
    if (!this.vectorTextPrototypeEnabled || !this.initialized) {
      throw new Error("Renderer testo vettoriale GPU non abilitato.");
    }
    if (!placement.startsWith("text-run:")) {
      throw new Error("Il renderer GPU richiede un run testo segmentato.");
    }
    if (draws.length > VECTOR_TEXT_GPU_MAXIMUM_DRAWS) {
      throw new Error(
        `Troppe draw call testo (${draws.length}/${VECTOR_TEXT_GPU_MAXIMUM_DRAWS}).`,
      );
    }
    const width = Math.max(1, this.canvas.width);
    const height = Math.max(1, this.canvas.height);

    this.captureVectorTextPresentationView();
    this.ensureVectorTextPresentationTexture(width, height, placement);
    const key =
      placement as Extract<VectorTextPlacement, `text-run:${string}`>;
    const resources = this.vectorTextRunTextures.get(key);
    if (!resources) {
      throw new Error(`Run testo GPU ${placement} non allocato.`);
    }
    const view = this.getVectorTextViewState();
    const drawResources = draws.map(
      (draw) => this.ensureVectorTextGpuResource(draw),
    );
    const blurResources = draws.map((draw) =>
      (
        draw.mode === "slug-blur"
        || draw.mode === "slug-inner-shadow-blur"
      )
        ? this.ensureVectorTextGpuBlurCache(draw)
        : null,
    );
    const bounds = this.vectorTextGpuRunBounds(draws, view);

    this.vectorTextGpuPendingRuns.push({
      placement: key,
      resources,
      draws,
      drawResources,
      blurResources,
      view,
      bounds,
    });

    let geometryBytes = 0;
    const uniqueDrawResources = new Set(drawResources);
    for (const resourcesForDraw of uniqueDrawResources) {
      geometryBytes += resourcesForDraw.memoryBytes;
    }
    return {
      strategy: VECTOR_TEXT_PRESENTATION_STRATEGY,
      width,
      height,
      gpuMemoryMiB:
        (
          width * height * 4
          + geometryBytes
        )
        / MEBIBYTE_BYTES,
      placement,
      blurGpuMemoryMiB: this.vectorTextGpuBlurMemoryBytes() / MEBIBYTE_BYTES,
      blurCacheEntries: this.vectorTextGpuBlurCaches.size,
    };
  }

  private flushVectorTextGpuPresentations(): void {
    if (this.vectorTextGpuPendingRuns.length === 0) {
      return;
    }
    let scratchWidth = 1;
    let scratchHeight = 1;
    let blurScratchWidth = 0;
    let blurScratchHeight = 0;
    for (const run of this.vectorTextGpuPendingRuns) {
      scratchWidth = Math.max(scratchWidth, run.bounds.width);
      scratchHeight = Math.max(scratchHeight, run.bounds.height);
      for (let index = 0; index < run.draws.length; index += 1) {
        const draw = run.draws[index];
        const cache = run.blurResources[index];
        if (
          (draw.mode === "slug-blur" || draw.mode === "slug-inner-shadow-blur")
          && cache?.needsBuild
        ) {
          blurScratchWidth = Math.max(blurScratchWidth, draw.blurWidth);
          blurScratchHeight = Math.max(blurScratchHeight, draw.blurHeight);
        }
      }
    }
    this.ensureVectorTextGpuScratch(scratchWidth, scratchHeight);
    if (blurScratchWidth > 0 && blurScratchHeight > 0) {
      this.ensureVectorTextGpuBlurScratch(blurScratchWidth, blurScratchHeight);
    }

    const uniformBuffer = this.vectorTextGpuUniformBuffer;
    const uniformBindGroup = this.vectorTextGpuUniformBindGroup;
    const filterUniformBuffer = this.vectorTextGpuBlurFilterUniformBuffer;
    const msaaView = this.vectorTextGpuMsaaView;
    const resolvedTexture = this.vectorTextGpuResolvedTexture;
    const resolvedView = this.vectorTextGpuResolvedView;
    const fillPipeline = this.vectorTextGpuFillPipeline;
    const slugPipeline = this.vectorTextGpuSlugPipeline;
    const blurMaskPipeline = this.vectorTextGpuBlurMaskPipeline;
    const blurHorizontalPipeline = this.vectorTextGpuBlurHorizontalPipeline;
    const blurVerticalPipeline = this.vectorTextGpuBlurVerticalPipeline;
    const blurCompositePipeline = this.vectorTextGpuBlurCompositePipeline;
    const innerShadowDirectPipeline = this.vectorTextGpuInnerShadowDirectPipeline;
    const innerShadowBlurPipeline = this.vectorTextGpuInnerShadowBlurPipeline;
    const clearPipeline = this.vectorTextGpuClearPipeline;
    if (
      !uniformBuffer
      || !uniformBindGroup
      || !filterUniformBuffer
      || !msaaView
      || !resolvedTexture
      || !resolvedView
      || !fillPipeline
      || !slugPipeline
      || !blurMaskPipeline
      || !blurHorizontalPipeline
      || !blurVerticalPipeline
      || !blurCompositePipeline
      || !innerShadowDirectPipeline
      || !innerShadowBlurPipeline
      || !clearPipeline
    ) {
      throw new Error("Pipeline batch del testo vettoriale GPU non pronta.");
    }

    const totalMainDraws = this.vectorTextGpuPendingRuns.reduce(
      (total, run) => total + run.draws.length,
      0,
    );
    if (totalMainDraws > VECTOR_TEXT_GPU_MAXIMUM_DRAWS) {
      throw new Error(
        `Batch testo GPU oltre ${VECTOR_TEXT_GPU_MAXIMUM_DRAWS} draw call.`,
      );
    }
    let mainDrawIndex = 0;
    for (const run of this.vectorTextGpuPendingRuns) {
      for (const draw of run.draws) {
        this.writeVectorTextGpuDrawUniform(
          draw,
          run.view,
          mainDrawIndex,
          run.bounds,
        );
        mainDrawIndex += 1;
      }
    }

    const blurBuilds: {
      draw: VectorTextGpuSlugBlurSourceDraw;
      resources: VectorTextGpuSlugResources;
      cache: VectorTextGpuBlurCacheResources;
      sourceUniformIndex: number;
      filterIndex: number;
    }[] = [];
    const queuedCaches = new Set<VectorTextGpuBlurCacheResources>();
    let nextSourceUniformIndex = totalMainDraws;
    for (const run of this.vectorTextGpuPendingRuns) {
      for (let index = 0; index < run.draws.length; index += 1) {
        const draw = run.draws[index];
        const drawResources = run.drawResources[index];
        const cache = run.blurResources[index];
        if (
          (
            draw.mode !== "slug-blur"
            && draw.mode !== "slug-inner-shadow-blur"
          )
          || !cache?.needsBuild
          || queuedCaches.has(cache)
        ) {
          continue;
        }
        if (drawResources.kind !== "slug") {
          throw new Error("Risorsa Slug incoerente con la mask blur GPU.");
        }
        if (nextSourceUniformIndex >= VECTOR_TEXT_GPU_MAXIMUM_DRAWS) {
          throw new Error(
            `Uniform testo GPU oltre ${VECTOR_TEXT_GPU_MAXIMUM_DRAWS} slot.`,
          );
        }
        const filterIndex = blurBuilds.length;
        this.writeVectorTextGpuBlurSourceUniform(
          draw,
          nextSourceUniformIndex,
        );
        this.writeVectorTextGpuBlurFilterUniform(draw, filterIndex);
        blurBuilds.push({
          draw,
          resources: drawResources,
          cache,
          sourceUniformIndex: nextSourceUniformIndex,
          filterIndex,
        });
        queuedCaches.add(cache);
        nextSourceUniformIndex += 1;
      }
    }

    if (nextSourceUniformIndex > 0) {
      this.device.queue.writeBuffer(
        uniformBuffer,
        0,
        this.vectorTextGpuUniformUpload,
        0,
        nextSourceUniformIndex * VECTOR_TEXT_GPU_UNIFORM_STRIDE / 4,
      );
    }
    if (blurBuilds.length > 0) {
      this.device.queue.writeBuffer(
        filterUniformBuffer,
        0,
        this.vectorTextGpuBlurFilterUniformUpload,
        0,
        blurBuilds.length * VECTOR_TEXT_GPU_UNIFORM_STRIDE / 4,
      );
    }

    const encoder = this.device.createCommandEncoder({
      label: `Vector text GPU batched exact redraw · ${this.vectorTextGpuPendingRuns.length} runs`,
    });

    if (blurBuilds.length > 0) {
      const scratchATexture = this.vectorTextGpuBlurScratchATexture;
      const scratchAView = this.vectorTextGpuBlurScratchAView;
      const scratchBView = this.vectorTextGpuBlurScratchBView;
      const filterAToB = this.vectorTextGpuBlurFilterBindGroupAToB;
      const filterBToA = this.vectorTextGpuBlurFilterBindGroupBToA;
      if (
        !scratchATexture
        || !scratchAView
        || !scratchBView
        || !filterAToB
        || !filterBToA
      ) {
        throw new Error("Scratch GPU del blur testo non pronto.");
      }
      for (const build of blurBuilds) {
        const width = build.draw.blurWidth;
        const height = build.draw.blurHeight;
        const sourcePass = encoder.beginRenderPass({
          label: `Vector text GPU blur analytic mask ${build.draw.blurKey}`,
          colorAttachments: [{
            view: scratchAView,
            loadOp: "clear",
            storeOp: "store",
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          }],
        });
        sourcePass.setViewport(0, 0, width, height, 0, 1);
        sourcePass.setScissorRect(0, 0, width, height);
        sourcePass.setPipeline(blurMaskPipeline);
        sourcePass.setBindGroup(
          0,
          build.resources.bindGroup,
          [build.sourceUniformIndex * VECTOR_TEXT_GPU_UNIFORM_STRIDE],
        );
        sourcePass.draw(6, 1, 0, 0);
        sourcePass.end();

        const filterOffset = build.filterIndex * VECTOR_TEXT_GPU_UNIFORM_STRIDE;
        const horizontalPass = encoder.beginRenderPass({
          label: `Vector text GPU blur horizontal ${build.draw.blurKey}`,
          colorAttachments: [{
            view: scratchBView,
            loadOp: "clear",
            storeOp: "store",
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          }],
        });
        horizontalPass.setViewport(0, 0, width, height, 0, 1);
        horizontalPass.setScissorRect(0, 0, width, height);
        horizontalPass.setPipeline(blurHorizontalPipeline);
        horizontalPass.setBindGroup(0, filterAToB, [filterOffset]);
        horizontalPass.draw(3, 1, 0, 0);
        horizontalPass.end();

        const verticalPass = encoder.beginRenderPass({
          label: `Vector text GPU blur vertical ${build.draw.blurKey}`,
          colorAttachments: [{
            view: scratchAView,
            loadOp: "clear",
            storeOp: "store",
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          }],
        });
        verticalPass.setViewport(0, 0, width, height, 0, 1);
        verticalPass.setScissorRect(0, 0, width, height);
        verticalPass.setPipeline(blurVerticalPipeline);
        verticalPass.setBindGroup(0, filterBToA, [filterOffset]);
        verticalPass.draw(3, 1, 0, 0);
        verticalPass.end();

        encoder.copyTextureToTexture(
          { texture: scratchATexture },
          { texture: build.cache.texture },
          { width, height, depthOrArrayLayers: 1 },
        );
        build.cache.needsBuild = false;
      }
    }

    let drawOffset = 0;
    for (const run of this.vectorTextGpuPendingRuns) {
      const pass = encoder.beginRenderPass({
        label: `Vector text GPU exact camera redraw ${run.placement}`,
        colorAttachments: [
          {
            view: msaaView,
            resolveTarget: resolvedView,
            loadOp: "clear",
            storeOp: "discard",
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          },
        ],
      });

      for (let index = 0; index < run.draws.length; index += 1) {
        const draw = run.draws[index];
        const resourcesForDraw = run.drawResources[index];
        const blurResources = run.blurResources[index];
        const uniformIndex = drawOffset + index;
        if (draw.opacity <= 0) {
          continue;
        }
        const dynamicOffset = uniformIndex * VECTOR_TEXT_GPU_UNIFORM_STRIDE;
        if (draw.mode === "slug-blur") {
          if (!blurResources) {
            throw new Error("Cache GPU del blur testo mancante.");
          }
          pass.setPipeline(blurCompositePipeline);
          pass.setBindGroup(0, blurResources.compositeBindGroup, [dynamicOffset]);
          pass.draw(6, 1, 0, 0);
        } else if (draw.mode === "slug-inner-shadow-direct") {
          if (resourcesForDraw.kind !== "slug") {
            throw new Error("Risorsa Slug incoerente con l’ombra interna GPU.");
          }
          if (resourcesForDraw.curveCount === 0) {
            continue;
          }
          pass.setPipeline(innerShadowDirectPipeline);
          pass.setBindGroup(0, resourcesForDraw.bindGroup, [dynamicOffset]);
          pass.draw(6, 1, 0, 0);
        } else if (draw.mode === "slug-inner-shadow-blur") {
          if (!blurResources) {
            throw new Error("Cache GPU dell’ombra interna sfocata mancante.");
          }
          if (resourcesForDraw.kind !== "slug") {
            throw new Error("Risorsa Slug incoerente con l’ombra interna sfocata.");
          }
          if (resourcesForDraw.curveCount === 0) {
            continue;
          }
          pass.setPipeline(innerShadowBlurPipeline);
          pass.setBindGroup(0, resourcesForDraw.bindGroup, [dynamicOffset]);
          pass.setBindGroup(1, blurResources.innerShadowBindGroup);
          pass.draw(6, 1, 0, 0);
        } else if (draw.mode === "mesh-direct") {
          if (resourcesForDraw.kind !== "mesh") {
            throw new Error("Risorsa mesh testo incoerente con la draw call.");
          }
          if (resourcesForDraw.indexCount === 0) {
            continue;
          }
          pass.setPipeline(fillPipeline);
          pass.setBindGroup(0, uniformBindGroup, [dynamicOffset]);
          pass.setVertexBuffer(0, resourcesForDraw.vertexBuffer);
          pass.setIndexBuffer(resourcesForDraw.indexBuffer, "uint32");
          pass.drawIndexed(resourcesForDraw.indexCount, 1, 0, 0, 0);
        } else {
          if (resourcesForDraw.kind !== "slug") {
            throw new Error("Risorsa Slug testo incoerente con la draw call.");
          }
          if (resourcesForDraw.curveCount === 0) {
            continue;
          }
          pass.setPipeline(slugPipeline);
          pass.setBindGroup(0, resourcesForDraw.bindGroup, [dynamicOffset]);
          pass.draw(6, 1, 0, 0);
        }
      }
      pass.end();

      const wasInitialized = run.resources.initialized;
      const clearBounds = this.vectorTextGpuClearBounds(
        run.resources.lastBounds,
        run.bounds,
      );
      const clearPass = encoder.beginRenderPass({
        label: `Vector text GPU clear old crop ${run.placement}`,
        colorAttachments: [
          {
            view: run.resources.view,
            loadOp: wasInitialized ? "load" : "clear",
            storeOp: "store",
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          },
        ],
      });
      if (wasInitialized) {
        clearPass.setPipeline(clearPipeline);
        clearPass.setScissorRect(
          clearBounds.x,
          clearBounds.y,
          clearBounds.width,
          clearBounds.height,
        );
        clearPass.draw(3, 1, 0, 0);
      }
      clearPass.end();
      encoder.copyTextureToTexture(
        {
          texture: resolvedTexture,
          origin: { x: 0, y: 0, z: 0 },
        },
        {
          texture: run.resources.texture,
          origin: { x: run.bounds.x, y: run.bounds.y, z: 0 },
        },
        {
          width: run.bounds.width,
          height: run.bounds.height,
          depthOrArrayLayers: 1,
        },
      );
      run.resources.lastBounds = run.bounds;
      run.resources.initialized = true;
      drawOffset += run.draws.length;
    }
    this.vectorTextGpuPendingRuns.length = 0;
    this.device.queue.submit([encoder.finish()]);
    this.displayDirty = true;
    this.presentationCacheNeedsFullRebuild = true;
    this.requestRender();
  }
  pruneVectorTextGpuMeshes(activeMeshKeys: ReadonlySet<string>): void {
    this.flushVectorTextGpuPresentations();
    for (const [key, resources] of this.vectorTextGpuMeshes) {
      if (activeMeshKeys.has(key)) {
        continue;
      }
      destroyVectorTextGpuResources(resources);
      this.vectorTextGpuMeshes.delete(key);
    }
    let activeBlurCacheCount = 0;
    for (const [key, resources] of this.vectorTextGpuBlurCaches) {
      if (activeMeshKeys.has(key)) {
        activeBlurCacheCount += 1;
        continue;
      }
      resources.texture.destroy();
      this.vectorTextGpuBlurCaches.delete(key);
    }
    if (activeBlurCacheCount === 0) {
      this.releaseVectorTextGpuBlurScratch();
    }
    if (activeMeshKeys.size === 0) {
      this.releaseVectorTextGpuScratch();
    }
  }

  clearVectorTextPresentation(placement?: VectorTextPlacement): void {
    let changed = false;
    let legacyBindingsChanged = false;
    if (!placement || placement === "below-active") {
      const texture = this.vectorTextBelowTexture;
      this.vectorTextBelowTexture = null;
      this.vectorTextBelowView = null;
      if (texture) {
        texture.destroy();
        changed = true;
        legacyBindingsChanged = true;
      }
    }
    if (!placement || placement === "above-active") {
      const texture = this.vectorTextAboveTexture;
      this.vectorTextAboveTexture = null;
      this.vectorTextAboveView = null;
      if (texture) {
        texture.destroy();
        changed = true;
        legacyBindingsChanged = true;
      }
    }
    if (!placement) {
      for (const resources of this.vectorTextRunTextures.values()) {
        resources.texture.destroy();
        changed = true;
      }
      this.vectorTextRunTextures.clear();
    } else if (placement.startsWith("text-run:")) {
      const key = placement as Extract<VectorTextPlacement, `text-run:${string}`>;
      const resources = this.vectorTextRunTextures.get(key);
      if (resources) {
        resources.texture.destroy();
        this.vectorTextRunTextures.delete(key);
        changed = true;
      }
    }
    if (
      !this.vectorTextBelowTexture
      && !this.vectorTextAboveTexture
      && this.vectorTextRunTextures.size === 0
    ) {
      if (!placement) {
        for (const resources of this.vectorTextGpuMeshes.values()) {
          destroyVectorTextGpuResources(resources);
        }
        this.vectorTextGpuMeshes.clear();
        for (const resources of this.vectorTextGpuBlurCaches.values()) {
          resources.texture.destroy();
        }
        this.vectorTextGpuBlurCaches.clear();
      }
      this.releaseVectorTextGpuBlurScratch();
      this.releaseVectorTextGpuScratch();
      this.vectorTextTextureWidth = 0;
      this.vectorTextTextureHeight = 0;
      this.vectorTextCaptureView = null;
      this.vectorTextFastPresentationEnabled = false;
      this.writeVectorTextCaptureUniforms();
    }
    if (legacyBindingsChanged) {
      this.rebuildVectorTextDisplayBindGroup();
    }
    if (changed && this.initialized) {
      this.displayDirty = true;
      this.presentationCacheNeedsFullRebuild = true;
      this.requestRender();
    }
  }
  fitView(): void {
    this.invalidateAdaptivePreview();
    const width = Math.max(1, this.canvas.width);
    const height = Math.max(1, this.canvas.height);
    this.viewCenterX = LAYER_SIZE * 0.5;
    this.viewCenterY = LAYER_SIZE * 0.5;
    const rotatedLayerSpan = LAYER_SIZE
      * (Math.abs(this.viewRotationCos) + Math.abs(this.viewRotationSin));
    this.zoom = Math.max(
      0.01, Math.min(width / rotatedLayerSpan, height / rotatedLayerSpan) * 0.94);
    this.hasFittedView = true;
    this.displayDirty = true;
    this.presentationCacheNeedsFullRebuild = true;
    this.notifyViewChange();
    this.requestRender();
  }

  zoomBy(factor: number, clientX?: number, clientY?: number): void {
    this.invalidateAdaptivePreview();
    const rectangle = this.canvas.getBoundingClientRect();
    const anchorClientX = clientX ?? rectangle.left + rectangle.width * 0.5;
    const anchorClientY = clientY ?? rectangle.top + rectangle.height * 0.5;
    const anchorBefore = this.clientToLayer(anchorClientX, anchorClientY);

    this.zoom = clamp(this.zoom * factor, 0.02, 64);

    const screen = this.clientToCanvasPixels(anchorClientX, anchorClientY);
    const anchorOffset = this.canvasOffsetToLayerOffset(
      screen.x - this.canvas.width * 0.5,
      screen.y - this.canvas.height * 0.5,
    );
    this.viewCenterX = anchorBefore.x - anchorOffset.x;
    this.viewCenterY = anchorBefore.y - anchorOffset.y;
    this.displayDirty = true;
    this.presentationCacheNeedsFullRebuild = true;
    this.notifyViewChange();
    this.requestRender();
  }

  panByClientDelta(deltaClientX: number, deltaClientY: number): void {
    this.invalidateAdaptivePreview();
    const rectangle = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / Math.max(1, rectangle.width);
    const scaleY = this.canvas.height / Math.max(1, rectangle.height);
    const layerDelta = this.canvasOffsetToLayerOffset(
      deltaClientX * scaleX,
      deltaClientY * scaleY,
    );
    this.viewCenterX -= layerDelta.x;
    this.viewCenterY -= layerDelta.y;
    this.displayDirty = true;
    this.presentationCacheNeedsFullRebuild = true;
    this.notifyViewChange();
    this.requestRender();
  }

  getViewRotationDegrees(): number {
    return this.viewRotation * 180 / Math.PI;
  }

  beginViewRotationGesture(): void {
    if (this.viewRotationGestureActive) {
      return;
    }
    this.viewRotationGestureActive = true;
    this.viewRotationGestureRaw = this.viewRotation;
    this.viewRotationSnappedToZero = Math.abs(this.viewRotation) < 1e-7;
  }

  rotateViewBy(
    deltaRadians: number,
    anchorClientX?: number,
    anchorClientY?: number,
  ): void {
    if (!Number.isFinite(deltaRadians) || Math.abs(deltaRadians) < 1e-12) {
      return;
    }
    const ownsGesture = !this.viewRotationGestureActive;
    if (ownsGesture) {
      this.beginViewRotationGesture();
    }

    this.viewRotationGestureRaw = normalizeViewRotation(
      this.viewRotationGestureRaw + deltaRadians,
    );
    const distanceFromZero = Math.abs(this.viewRotationGestureRaw);
    if (this.viewRotationSnappedToZero) {
      if (distanceFromZero > VIEW_ROTATION_SNAP_RELEASE_RADIANS) {
        this.viewRotationSnappedToZero = false;
      }
    } else if (distanceFromZero <= VIEW_ROTATION_SNAP_ENTER_RADIANS) {
      this.viewRotationSnappedToZero = true;
    }

    this.applyViewRotation(
      this.viewRotationSnappedToZero ? 0 : this.viewRotationGestureRaw,
      anchorClientX,
      anchorClientY,
    );
    if (ownsGesture) {
      this.endViewRotationGesture();
    }
  }

  endViewRotationGesture(): void {
    if (!this.viewRotationGestureActive) {
      return;
    }
    this.viewRotationGestureActive = false;
    this.viewRotationGestureRaw = this.viewRotationSnappedToZero ? 0 : this.viewRotation;
  }

  resetViewRotation(): void {
    this.viewRotationGestureActive = false;
    this.viewRotationGestureRaw = 0;
    this.viewRotationSnappedToZero = true;
    this.applyViewRotation(0);
  }

  private applyViewRotation(
    angle: number,
    anchorClientX?: number,
    anchorClientY?: number,
  ): void {
    const normalizedAngle = normalizeViewRotation(angle);
    if (Math.abs(normalizedAngle - this.viewRotation) < 1e-12) {
      return;
    }
    this.invalidateAdaptivePreview();
    const rectangle = this.canvas.getBoundingClientRect();
    const resolvedAnchorX = anchorClientX ?? rectangle.left + rectangle.width * 0.5;
    const resolvedAnchorY = anchorClientY ?? rectangle.top + rectangle.height * 0.5;
    const anchorBefore = this.clientToLayer(resolvedAnchorX, resolvedAnchorY);
    const screen = this.clientToCanvasPixels(resolvedAnchorX, resolvedAnchorY);

    this.viewRotation = normalizedAngle;
    this.viewRotationCos = Math.cos(normalizedAngle);
    this.viewRotationSin = Math.sin(normalizedAngle);
    const anchorOffset = this.canvasOffsetToLayerOffset(
      screen.x - this.canvas.width * 0.5,
      screen.y - this.canvas.height * 0.5,
    );
    this.viewCenterX = anchorBefore.x - anchorOffset.x;
    this.viewCenterY = anchorBefore.y - anchorOffset.y;
    this.displayDirty = true;
    this.presentationCacheNeedsFullRebuild = true;
    this.callbacks.onViewRotationChange?.(
      this.getViewRotationDegrees(),
      this.viewRotationSnappedToZero,
    );
    this.notifyViewChange();
    this.requestRender();
  }

  beginStroke(sample: PointerSample): void {
    this.beginStrokeAtLayer(this.toLayerPoint(sample));
  }

  beginStrokeAtLayer(point: LayerPoint): void {
    // layerSwitchBusy is held across the switch's awaits, so a pointerdown
    // landing mid-switch cannot start a stroke on a half-swapped layer.
    if (this.historyBusy || this.activeStroke || this.layerSwitchBusy) {
      return;
    }
    if (!this.canPaintSelectedSceneItem()) {
      this.callbacks.onStatus?.(
        "Il testo è selezionato: scegli un livello raster per usare il pennello.",
        "working",
      );
      return;
    }
    if (this.settings.grainMode !== "off" && !this.grainResident) {
      // Senza texture residente i pixel non sarebbero identici: il tratto
      // attende il load partito alla selezione del grain (o parte ora).
      this.requestGrainLoad();
      this.callbacks.onStatus?.(
        "Grain M1 in caricamento: riprova tra un istante…",
        "working",
      );
      return;
    }
    if (this.settings.shape === "shape" && !this.shapeResident) {
      this.requestShapeLoad();
      this.callbacks.onStatus?.(
        "Shape 2K in caricamento: riprova tra un istante…",
        "working",
      );
      return;
    }
    this.pauseLayerColdCompressionIdle();
    const normalizedPoint: LayerPoint = {
      ...point,
      timeMs: Number.isFinite(point.timeMs) ? point.timeMs : performance.now(),
    };
    this.flushPendingWorkBeforeSettingsChange();
    this.flushClosingLightGlazeSessionBeforeNewStroke();
    this.cancelEffectsScratchShrink();
    this.cancelBevelFieldShrink();
    if (this.rasterBevelActive()) {
      // Prewarm before activeStroke is assigned: the pool never reallocates
      // while a pen/finger stroke is active, even after an idle shrink.
      this.rasterBevelRenderer?.prewarmWorkspace(this.rasterBevelStyle);
    }
    if (this.rasterOuterShadowActive()) {
      this.rasterOuterShadowRenderer?.prewarmWorkspace(this.rasterOuterShadowStyle);
    }
    if (this.rasterInnerShadowActive()) {
      this.rasterInnerShadowRenderer?.prewarmWorkspace(this.rasterInnerShadowStyle);
    }
    this.invalidateAdaptivePreview();
    const tool = this.settings.tool;
    const lightGlazeSettings = tool === "paint" && isStrokeGlazeBlendMode(this.settings.blendMode)
      ? { ...this.settings }
      : null;
    if (lightGlazeSettings && this.thicknessTailPresentedRect) {
      this.thicknessTailPresentedRect = null;
      this.presentationCacheNeedsFullRebuild = true;
      this.displayDirty = true;
    }
    this.adaptivePreviewForceStroke = tool === "paint"
      && ADAPTIVE_PREVIEW_FORCE
      && !lightGlazeSettings;
    const historyActionId = this.nextHistoryActionId++;
    const thicknessSource = lightGlazeSettings ?? this.settings;
    const thicknessSettings = {
      startThickness: thicknessSource.startThickness,
      endThickness: thicknessSource.endThickness,
    };
    const blendPlanner = tool === "blend"
      ? createDryBlendPlanner({
        size: this.settings.size,
        strength: 1,
        spacing: this.settings.spacingPercent / 100,
        flow: this.settings.flow,
        stretch: this.settings.blendStretch,
        paint: this.settings.blendPaint,
        aspect: 1,
        angle: 0,
        orientToStroke: true,
        seed: historyActionId,
      }, {
        documentWidth: LAYER_SIZE,
        documentHeight: LAYER_SIZE,
      })
      : null;
    blendPlanner?.reset(normalizedPoint);
    this.activeStroke = {
      tool,
      lastInput: normalizedPoint,
      startedAtMs: normalizedPoint.timeMs,
      thicknessSettings,
      thicknessDynamicsNeutral: tool === "blend" || thicknessDynamicsIsNeutral(
        thicknessSettings.startThickness,
        thicknessSettings.endThickness,
      ),
      thicknessTailHoldback: tool === "paint" && thicknessDynamicsNeedsTailHoldback(
        thicknessSettings.endThickness,
      ),
      heldThicknessStamps: [],
      heldThicknessHead: 0,
      distanceSinceStamp: 0,
      adaptiveSpacingInitialPercent: lightGlazeSettings?.spacingPercent ?? this.settings.spacingPercent,
      adaptiveSpacingPercent: lightGlazeSettings?.spacingPercent ?? this.settings.spacingPercent,
      historyActionId,
      historyCommitted: false,
      submitted: false,
      seedSequenceBeforeStroke: this.seedSequence,
      historyCursorBeforeStroke: this.historyCursor,
      redoActionsBeforeStroke: this.historyCursor < this.historyActions.length
        ? this.historyActions.slice(this.historyCursor)
        : null,
      historyCompactionPendingBeforeStroke: this.historyCompactionPending,
      lightGlazeSettings,
      blendSettings: tool === "blend" ? { ...this.settings } : null,
      blendPlanner,
    };
    if (lightGlazeSettings) {
      this.startLightGlazeSession(historyActionId, lightGlazeSettings);
    }
    if (tool === "blend") {
      this.blendRenderer?.beginStroke(historyActionId);
    } else {
      this.emitStamp(normalizedPoint, 1, 0);
    }
  }

  extendStroke(samples: readonly PointerSample[]): void {
    this.extendStrokeAtLayer(samples.map((sample) => this.toLayerPoint(sample)));
  }

  extendStrokeAtLayer(points: readonly LayerPoint[]): void {
    if (!this.activeStroke) {
      return;
    }

    for (const point of points) {
      this.appendPoint(point);
    }
  }

  endStroke(timeMs?: number): void {
    const endingStroke = this.activeStroke;
    if (endingStroke?.tool === "blend") {
      endingStroke.blendPlanner?.finish();
      this.drainBlendPlanner(endingStroke);
      const historyChanged = endingStroke.historyCommitted;
      this.activeStroke = null;
      if (this.pendingBlendBatches.length > 0) {
        this.displayDirty = true;
        this.requestRender();
      }
      if (historyChanged) {
        this.publishHistoryState();
      }
      this.scheduleLayerColdCompression();
      return;
    }
    const hadPredictiveThicknessTail = Boolean(
      endingStroke?.thicknessTailHoldback
      && !endingStroke.lightGlazeSettings
      && (this.settings.blendMode === "normal" || this.settings.blendMode === "additive"),
    );
    if (endingStroke) {
      const requestedLiftTime = Number.isFinite(timeMs)
        ? timeMs as number
        : endingStroke.lastInput.timeMs;
      const liftTime = Math.max(endingStroke.lastInput.timeMs, requestedLiftTime);
      this.releaseHeldThicknessStamps(liftTime, true);
    }
    const historyChanged = endingStroke?.historyCommitted ?? false;
    if (
      endingStroke?.lightGlazeSettings
      && this.lightGlazeSession?.historyActionId === endingStroke.historyActionId
    ) {
      this.lightGlazeSession.endRequested = true;
      this.displayDirty = true;
      this.requestRender();
    }
    this.freezeAdaptivePreviewAtLift();
    this.activeStroke = null;
    if (hadPredictiveThicknessTail || this.thicknessTailPresentedRect) {
      // The same next GPU submit commits the final held stamps and redraws the
      // previous tail area from the authoritative layer, avoiding a blank or
      // doubled frame at lift.
      this.displayDirty = true;
      this.requestRender();
    }
    if (historyChanged) {
      this.publishHistoryState();
    }
    this.scheduleLayerColdCompression();
  }

  cancelStrokeBeforeRender(): boolean {
    const stroke = this.activeStroke;
    if (!stroke || stroke.submitted) {
      return false;
    }

    let removedStampCount = 0;
    this.pendingStamps = this.pendingStamps.filter((stamp) => {
      const belongsToStroke = stamp.historyActionId === stroke.historyActionId;
      if (belongsToStroke) {
        removedStampCount += 1;
      }
      return !belongsToStroke;
    });
    const pendingBlendCountBeforeCancel = this.pendingBlendBatches.length;
    this.pendingBlendBatches = this.pendingBlendBatches.filter(
      (pending) => pending.actionId !== stroke.historyActionId,
    );
    removedStampCount += pendingBlendCountBeforeCancel - this.pendingBlendBatches.length;
    stroke.blendPlanner?.discardPending();
    this.seedSequence = stroke.seedSequenceBeforeStroke;

    if (stroke.historyCommitted) {
      this.historyActions.length = stroke.historyCursorBeforeStroke;
      if (stroke.redoActionsBeforeStroke) {
        this.historyActions.push(...stroke.redoActionsBeforeStroke);
      }
      this.historyCursor = stroke.historyCursorBeforeStroke;
      this.historyCompactionPending = stroke.historyCompactionPendingBeforeStroke;
      if (this.activeStrokeProfile) {
        this.activeStrokeProfile.baseStamps = Math.max(
          0,
          this.activeStrokeProfile.baseStamps - removedStampCount,
        );
        this.activeStrokeProfile.historyCommittedActions = Math.max(
          0,
          this.activeStrokeProfile.historyCommittedActions - 1,
        );
      }
    }

    this.activeStroke = null;
    if (this.lightGlazeSession?.historyActionId === stroke.historyActionId) {
      this.abandonLightGlazeSession();
    }
    this.invalidateAdaptivePreview();
    if (this.thicknessTailPresentedRect) {
      this.displayDirty = true;
      this.requestRender();
    }
    if (stroke.historyCommitted) {
      this.publishHistoryState();
    }
    this.scheduleLayerColdCompression();
    return true;
  }

  async clear(): Promise<boolean> {
    if (
      !this.initialized
      || this.activeStroke
      || this.historyBusy
      || this.layerSwitchBusy
    ) {
      return false;
    }

    this.cancelLayerColdCompressionIdle();
    this.historyBusy = true;
    this.invalidateAdaptivePreview();
    this.publishHistoryState();
    this.callbacks.onStatus?.("Pulizia del layer…", "working");

    try {
      await this.waitForIdle();
      if (!this.layerHasContent) {
        this.callbacks.onStatus?.("Il layer è già vuoto.", "ok");
        return false;
      }

      this.submitImmediate([], true, this.settings, true, null);
      this.clearRequested = false;
      this.displayDirty = false;
      await this.device.queue.onSubmittedWorkDone();
      this.layerHasContent = false;

      // La mutazione della cronologia viene committata soltanto dopo che il
      // clear GPU è terminato: un errore di submission non può perdere il Redo.
      // Clearing affects the ACTIVE layer, so the recorded action and the
      // decision to record one are both per-layer. The shortcut of resetting the
      // whole journal is only legitimate when nothing is left anywhere:
      // otherwise clearing an empty layer would throw away another layer's undo.
      if (this.hasVisibleHistoryContent(this.layerStack.active.id)) {
        this.truncateRedoHistory();
        this.historyActions.push({
          id: this.nextHistoryActionId++,
          kind: "clear",
          layerId: this.layerStack.active.id,
        });
        this.historyCursor = this.historyActions.length;
        this.compactDiscardedHistory();
        if (this.activeStrokeProfile) {
          this.activeStrokeProfile.historyCommittedActions += 1;
        }
      } else if (
        // Defensive, and today unreachable from the UI: clear() returns early
        // when the active layer has no content, so this branch needs a layer
        // that has pixels but no visible history. Replay in the next step makes
        // that state reachable, and resetting the journal there would throw away
        // another layer's undo.
        layersWithVisibleContent(this.historyActions, this.historyCursor).size === 0
      ) {
        this.resetHistoryState();
      }

      this.callbacks.onStatus?.("Layer pulito.", "ok");
      return true;
    } finally {
      this.historyBusy = false;
      this.publishHistoryState();
      this.scheduleEffectsScratchShrink();
      this.scheduleBevelFieldShrink();
      this.scheduleLayerColdCompression();
    }
  }

  resetDocument(): boolean {
    if (this.historyBusy || this.layerSwitchBusy) {
      return false;
    }
    if (this.documentWideResetBlockedByLayers) {
      this.callbacks.onStatus?.(
        "Il ripristino del documento non è ancora disponibile con più livelli.",
        "error",
      );
      return false;
    }
    this.cancelLayerColdCompressionIdle();
    if (this.frameRequest !== null) {
      cancelAnimationFrame(this.frameRequest);
      this.frameRequest = null;
    }
    this.pendingStamps.length = 0;
    this.pendingBlendBatches.length = 0;
    this.activeStroke = null;
    this.abandonLightGlazeSession();
    this.invalidateAdaptivePreview();
    this.resetHistoryState();
    this.clearRequested = true;
    this.displayDirty = true;
    this.presentationCacheNeedsFullRebuild = true;
    this.layerHasContent = false;
    this.layerContentBounds = null;
    this.requestRender();
    clearLayerStorageTileMask(this.layerStack.active.storageTileMask);
    this.publishHistoryState();
    this.scheduleEffectsScratchShrink();
    this.scheduleBevelFieldShrink();
    this.scheduleLayerColdCompression();
    return true;
  }

  /**
   * Clears only the hot raster reserved for the query-gated mixed memory
   * benchmark. The seeded cold rasters and every vector node remain resident,
   * so repeated canonical replays measure the same working set. Normal
   * documents must keep using resetDocument(), whose multi-layer guard remains
   * unchanged.
   */
  resetActiveLayerForMemoryBenchmark(): boolean {
    if (!this.layerMemoryStressTestEnabled || !this.mixedSceneStack) {
      throw new Error("Reset benchmark misto non abilitato per questa pagina.");
    }
    if (this.historyBusy || this.layerSwitchBusy) {
      return false;
    }
    this.cancelLayerColdCompressionIdle();
    if (this.frameRequest !== null) {
      cancelAnimationFrame(this.frameRequest);
      this.frameRequest = null;
    }
    this.pendingStamps.length = 0;
    this.pendingBlendBatches.length = 0;
    this.activeStroke = null;
    this.abandonLightGlazeSession();
    this.invalidateAdaptivePreview();
    this.resetHistoryState();
    this.clearRequested = true;
    this.displayDirty = true;
    this.presentationCacheNeedsFullRebuild = true;
    this.layerHasContent = false;
    this.layerContentBounds = null;
    clearLayerStorageTileMask(this.layerStack.active.storageTileMask);
    this.persistActiveLayerState();
    this.requestRender();
    this.publishHistoryState();
    this.scheduleEffectsScratchShrink();
    this.scheduleBevelFieldShrink();
    this.scheduleLayerColdCompression();
    return true;
  }

  async undo(): Promise<boolean> {
    return this.moveHistoryCursor(-1);
  }

  async redo(): Promise<boolean> {
    return this.moveHistoryCursor(1);
  }

  async runBenchmark(baseStampCount: number): Promise<BenchmarkResult> {
    if (!this.initialized) {
      throw new Error("Il motore non è ancora inizializzato.");
    }
    if (this.historyBusy || this.activeStroke || this.layerSwitchBusy) {
      throw new Error("Concludi prima il tratto o l'operazione Undo/Redo.");
    }
    if (this.documentWideResetBlockedByLayers) {
      throw new Error(
        "Il benchmark azzera la cronologia dell'intero documento: tienilo a un solo livello.",
      );
    }
    if (this.settings.tool === "blend") {
      throw new Error("Il benchmark GPU sintetico misura Paint: seleziona Pennello Paint.");
    }
    if (this.lightGlazeSession) {
      await this.waitForIdle();
    }
    // Il benchmark sottomette stamp senza passare da beginStroke: gli asset
    // lazy vanno garantiti qui, mai campionare i placeholder.
    if (this.settings.shape === "shape") {
      await this.ensureShapeResources();
    }
    if (this.settings.grainMode !== "off") {
      await this.ensureGrainResources();
    }

    const count = clamp(Math.round(baseStampCount), 1, Math.min(12_000, MAX_STAMPS_PER_BATCH));
    this.invalidateAdaptivePreview();
    this.pendingStamps.length = 0;
    this.pendingBlendBatches.length = 0;
    this.activeStroke = null;
    this.resetHistoryState();
    this.publishHistoryState();

    if (this.frameRequest !== null) {
      cancelAnimationFrame(this.frameRequest);
      this.frameRequest = null;
    }

    await this.device.queue.onSubmittedWorkDone();
    const benchmarkSettings = this.settings;
    const stamps = this.generateBenchmarkStamps(count, benchmarkSettings);

    if (isStrokeGlazeBlendMode(benchmarkSettings.blendMode)) {
      this.startLightGlazeSession(0, benchmarkSettings);
      this.lightGlazeSession!.endRequested = true;
      this.lightGlazeSession!.commitRequested = true;
    }

    const completionStart = performance.now();
    const timing = this.submitImmediate(stamps, true, benchmarkSettings);
    const cpuSubmitMs = timing.totalCpuMs;
    this.clearRequested = false;
    this.displayDirty = false;
    this.layerHasContent = true;
    await this.device.queue.onSubmittedWorkDone();
    const gpuCompletionMs = performance.now() - completionStart;

    // Il benchmark resta escluso dalle proprie misure di history, ma il suo
    // risultato visibile diventa comunque un'unica azione annullabile.
    const historyActionId = this.nextHistoryActionId++;
    for (const stamp of stamps) {
      stamp.historyActionId = historyActionId;
    }
    this.historyActions.push({ id: historyActionId, kind: "stroke", layerId: this.layerStack.active.id });
    this.historyCursor = this.historyActions.length;
    this.recordHistoryBatch(stamps, benchmarkSettings, timing, true);

    this.totalBaseStamps += stamps.length;
    this.avoidedLogicalDraws += stamps.length * Math.max(0, benchmarkSettings.count - 1);
    this.recordRenderedFrame(performance.now());
    this.publishStats();
    this.publishHistoryState();

    const averageRadiusSquared = stamps.reduce((sum, stamp) => sum + stamp.radius * stamp.radius, 0) / stamps.length;
    const estimatedCoveredFragments = Math.round(
      Math.PI * averageRadiusSquared * stamps.length * benchmarkSettings.count,
    );
    const strategy = [
      "1 draw instanziata",
      `${benchmarkSettings.count} copie fisiche GPU per stamp base`,
      benchmarkSettings.shape === "shape"
        ? this.lastShapeSamplingStrategy === SHAPE_OCCUPANCY_STRATEGY
          ? `bitmask alpha ${SHAPE_OCCUPANCY_GRID_SIZE}², mip ${this.lastShapeOccupancyMipLevel}, campioni 2K ammessi ${(this.lastShapeOccupancyCoverageRatio * 100).toFixed(1)}%`
          : `quad Shape legacy da 4 vertici, fallback ${this.lastShapeOccupancyFallbackReason}, mappa candidata ${(this.lastShapeOccupancyCandidateCoverageRatio * 100).toFixed(1)}%`
        : "geometria quad triangle-strip (4 vertici)",
      benchmarkSettings.shape === "shape"
        ? "coverage da maschera alpha 2048²"
        : "coverage fragment smoothstep generica",
      benchmarkSettings.shape === "shape"
        ? this.shapeMaskDecodeStrategy === SHAPE_DIRECT_DECODE_STRATEGY
          ? "PNG grayscale decodificata direttamente"
          : "PNG decodificata tramite fallback canvas"
        : "nessuna maschera Shape",
      benchmarkSettings.shape === "shape"
        ? `scatter rotazione ${(benchmarkSettings.shapeScatter * 100).toFixed(0)}%`
        : "orientamento circolare invariato",
      "riuso copySeed per jitter colore per copia",
      "dirty rect direzionale conservativo",
      this.isTexturizedGrainActive(benchmarkSettings)
        ? `grain Cotton Fleece M1 2500 ${benchmarkSettings.grainMode} `
          + `${benchmarkSettings.grainFiltering}, `
          + `scale ${(benchmarkSettings.grainScale * 100).toFixed(0)}%, `
          + `depth ${(benchmarkSettings.grainDepth * 100).toFixed(0)}%`
        : "grain Off, pipeline legacy",
    ].join(" · ");

    return {
      baseStamps: stamps.length,
      logicalCopies: stamps.length * benchmarkSettings.count,
      cpuSubmitMs,
      gpuCompletionMs,
      estimatedCoveredFragments,
      strategy,
    };
  }

  private getGpuMemoryStats(): EngineGpuMemoryStats {
    const baseResourcesAllocated = this.initialized;
    const bytesPerPixel = this.layerFormat === "rgba16float" ? 8 : 4;
    const rasterStroke = this.rasterStrokeRenderer;
    const rasterBevel = this.rasterBevelRenderer;
    const rasterOuterShadow = this.rasterOuterShadowRenderer;
    const rasterInnerShadow = this.rasterInnerShadowRenderer;
    const effectsScratch = this.effectsWorkbench?.scratchPool.snapshot();
    // Exactly one active layer owns a full authoritative mip 0 at idle. Inactive
    // layers keep only their conservative 256px tiles. A second full texture may
    // exist briefly while a hydration/switch transaction is still reversible.
    const fullLayerMiB = layerBaseMemoryMiB(this.layerFormat);
    const hotLayerCount = [...this.layerGpu.values()].reduce(
      (count, gpu) => count + (gpu.hot ? 1 : 0),
      0,
    );
    const layerBaseMiB = baseResourcesAllocated
      ? fullLayerMiB * hotLayerCount
      : 0;
    const layerColdMiB = baseResourcesAllocated
      ? [...this.layerGpu.values()].reduce(
        (total, gpu) => total + (gpu.cold?.memoryBytes ?? 0),
        0,
      ) / MEBIBYTE_BYTES
      : 0;
    const layerCompressedCpuMiB = (
      [...this.layerGpu.values()].reduce(
        (total, gpu) => total + (gpu.compressed?.storedBytes ?? 0),
        0,
      ) + (this.layerColdCompressionProgress?.storedBytes ?? 0)
    ) / MEBIBYTE_BYTES;
    const layerCompressedRawMiB = [...this.layerGpu.values()].reduce(
      (total, gpu) => total + (gpu.compressed?.rawBytes ?? 0),
      0,
    ) / MEBIBYTE_BYTES;
    const layerHydrationMiB = (
      [...this.liveLayerHydrationTextures.values()].reduce(
        (total, bytes) => total + bytes,
        0,
      ) + this.layerColdRestoreActiveBytes
    ) / MEBIBYTE_BYTES;
    // Exactly one full raw-layer pyramid follows the active layer. Mixed-scene
    // merged sides report their real cropped mip bytes instead of charging a
    // full 4096² chain per side.
    const mergedSurfaces = [...this.liveMergedSurfaceTextures.values()];
    const mergedMipChainMiB = mergedSurfaces.reduce(
      (total, surface) => total + surface.mipChainMemoryBytes,
      0,
    ) / MEBIBYTE_BYTES;
    const layerMipChainMiB = baseResourcesAllocated
      ? paintDisplayPyramidAdditionalMemoryMiB(this.layerFormat) + mergedMipChainMiB
      : 0;
    // Per-layer analytic bakes exist only inside a transaction. Merged mip 0
    // is accounted from its actual allocation bounds, including candidates.
    const transientBakeMiB = [...this.liveLayerBakeTextures.values()].reduce(
      (total, bytes) => total + bytes,
      0,
    ) / MEBIBYTE_BYTES;
    const layerBakeMiB = baseResourcesAllocated ? transientBakeMiB : 0;
    const layerCompositeMiB = baseResourcesAllocated
      ? mergedSurfaces.reduce(
        (total, surface) => total + surface.mip0MemoryBytes,
        0,
      ) / MEBIBYTE_BYTES
      : 0;
    const grainTextureMiB = baseResourcesAllocated && this.grainResident
      ? GRAIN_TEXTURE_PIXEL_COUNT * 4 / MEBIBYTE_BYTES
      : 0;
    const shapeTextureMiB = baseResourcesAllocated && this.shapeResident
      ? shapeTextureMemoryMiB()
      : 0;
    const paintBuffersMiB = baseResourcesAllocated ? staticPaintBufferMemoryMiB() : 0;
    const presentationCacheMiB = this.presentationCacheTexture
      ? this.presentationCacheWidth * this.presentationCacheHeight * 4 / MEBIBYTE_BYTES
      : 0;
    const vectorTextTextureCount = Number(Boolean(this.vectorTextBelowTexture))
      + Number(Boolean(this.vectorTextAboveTexture))
      + this.vectorTextRunTextures.size;
    const vectorTextViewportMiB = vectorTextTextureCount > 0
      ? vectorTextTextureCount * this.vectorTextTextureWidth
        * this.vectorTextTextureHeight * 4 / MEBIBYTE_BYTES
      : 0;
    const vectorTextBlurMiB =
      this.vectorTextGpuBlurMemoryBytes() / MEBIBYTE_BYTES;
    const vectorTextGpuScratchMiB = this.vectorTextGpuMsaaTexture
      ? this.vectorTextGpuScratchWidth * this.vectorTextGpuScratchHeight
        * 4 * (VECTOR_TEXT_GPU_SAMPLE_COUNT + 1) / MEBIBYTE_BYTES
      : 0;
    const vectorTextGpuGeometryMiB = [...this.vectorTextGpuMeshes.values()]
      .reduce((total, resources) => total + resources.memoryBytes, 0)
      / MEBIBYTE_BYTES;

    const mixedSceneLinearMiB = this.mixedSceneLinearTexture
      ? this.mixedSceneLinearWidth * this.mixedSceneLinearHeight * 8 / MEBIBYTE_BYTES
      : 0;
    const vectorTextPresentationMiB =
      vectorTextViewportMiB
      + vectorTextBlurMiB
      + vectorTextGpuScratchMiB
      + vectorTextGpuGeometryMiB
      + mixedSceneLinearMiB;
    const rasterStrokeStyledMiB =
      (rasterStroke?.styledMemoryBytes ?? 0) / MEBIBYTE_BYTES;
    const rasterStrokeCoverageMiB =
      (rasterStroke?.coverageMemoryBytes ?? 0) / MEBIBYTE_BYTES;
    const rasterStrokeMaskAndControlMiB = (
      (rasterStroke?.thresholdMaskMemoryBytes ?? 0)
      + (rasterStroke?.controlMemoryBytes ?? 0)
    ) / MEBIBYTE_BYTES;
    const effectsScratchPoolMiB =
      (effectsScratch?.currentBytes ?? 0) / MEBIBYTE_BYTES;
    const effectsScratchPoolPeakMiB =
      (effectsScratch?.peakBytes ?? 0) / MEBIBYTE_BYTES;
    const effectsScratchStrokeExtent = rasterStroke?.scratchExtent ?? 0;
    const effectsScratchBevelExtent = rasterBevel?.workspaceExtent ?? 0;
    const effectsScratchOuterShadowExtent = rasterOuterShadow?.workspaceExtent ?? 0;
    const effectsScratchInnerShadowExtent = rasterInnerShadow?.workspaceExtent ?? 0;
    const rasterBevelHeightMiB =
      (rasterBevel?.heightMemoryBytes ?? 0) / MEBIBYTE_BYTES;
    const rasterBevelLutAndControlMiB = (
      (rasterBevel?.lutMemoryBytes ?? 0)
      + (rasterBevel?.controlMemoryBytes ?? 0)
    ) / MEBIBYTE_BYTES;
    const rasterOuterShadowMatteMiB =
      (rasterOuterShadow?.coverageMemoryBytes ?? 0) / MEBIBYTE_BYTES;
    const rasterOuterShadowControlMiB =
      (rasterOuterShadow?.controlMemoryBytes ?? 0) / MEBIBYTE_BYTES;
    const rasterInnerShadowMatteMiB =
      (rasterInnerShadow?.coverageMemoryBytes ?? 0) / MEBIBYTE_BYTES;
    const rasterInnerShadowControlMiB =
      (rasterInnerShadow?.controlMemoryBytes ?? 0) / MEBIBYTE_BYTES;
    const rasterBevelField = rasterBevel?.fieldState ?? {
      bounded: this.bevelBoundingFieldEnabled,
      allocationBounds: null,
      validBounds: null,
      textureWidth: 0,
      textureHeight: 0,
      memoryBytes: 0,
      generation: 0,
      allocationCount: 0,
      shrinkCount: 0,
    };
    const blendRendererMiB = this.blendRenderer?.allocatedMemoryMiB() ?? 0;
    const lightGlazeMiB = this.lightGlazeStorageAllocated
      ? lightGlazeAdditionalMemoryMiB(this.layerFormat, this.lightGlazeStorageMode)
      : 0;
    const thicknessTailMiB = this.thicknessTailTexture
      ? this.thicknessTailTextureWidth * this.thicknessTailTextureHeight
        * bytesPerPixel / MEBIBYTE_BYTES
      : 0;
    const historyCpuMiB =
      this.historyStoredBaseStamps * STAMP_STRIDE_BYTES / MEBIBYTE_BYTES;
    const countedTotalMiB = [
      layerBaseMiB,
      layerMipChainMiB,
      layerColdMiB,
      layerHydrationMiB,
      layerBakeMiB,
      layerCompositeMiB,
      grainTextureMiB,
      shapeTextureMiB,
      paintBuffersMiB,
      presentationCacheMiB,
      vectorTextPresentationMiB,
      rasterStrokeStyledMiB,
      rasterStrokeCoverageMiB,
      rasterStrokeMaskAndControlMiB,
      effectsScratchPoolMiB,
      blendRendererMiB,
      lightGlazeMiB,
      thicknessTailMiB,
      rasterBevelHeightMiB,
      rasterBevelLutAndControlMiB,
      rasterOuterShadowMatteMiB,
      rasterOuterShadowControlMiB,
      rasterInnerShadowMatteMiB,
      rasterInnerShadowControlMiB,
    ].reduce((total, value) => total + value, 0);

    return {
      layerBaseMiB,
      layerMipChainMiB,
      layerColdMiB,
      layerCompressedCpuMiB,
      layerCompressedRawMiB,
      layerHydrationMiB,
      layerBakeMiB,
      layerCompositeMiB,
      grainTextureMiB,
      shapeTextureMiB,
      paintBuffersMiB,
      presentationCacheMiB,
      vectorTextPresentationMiB,
      rasterStrokeStyledMiB,
      rasterStrokeCoverageMiB,
      rasterStrokeMaskAndControlMiB,
      effectsScratchPoolMiB,
      effectsScratchPoolPeakMiB,
      effectsScratchStrokeExtent,
      effectsScratchBevelExtent,
      effectsScratchOuterShadowExtent,
      effectsScratchInnerShadowExtent,
      blendRendererMiB,
      rasterBevelHeightMiB,
      rasterBevelLutAndControlMiB,
      rasterOuterShadowMatteMiB,
      rasterOuterShadowControlMiB,
      rasterInnerShadowMatteMiB,
      rasterInnerShadowControlMiB,
      rasterBevelFieldBounded: rasterBevelField.bounded,
      rasterBevelFieldAllocationBounds: rasterBevelField.allocationBounds,
      rasterBevelFieldValidBounds: rasterBevelField.validBounds,
      rasterBevelFieldTextureWidth: rasterBevelField.textureWidth,
      rasterBevelFieldTextureHeight: rasterBevelField.textureHeight,
      rasterBevelFieldGeneration: rasterBevelField.generation,
      rasterBevelFieldAllocationCount: rasterBevelField.allocationCount,
      rasterBevelFieldShrinkCount: rasterBevelField.shrinkCount,
      lightGlazeMiB,
      thicknessTailMiB,
      historyCpuMiB,
      countedTotalMiB,
    };
  }

  private getLayerStorageStudy(): LayerStorageStudyStats {
    const bytesPerPixel = this.layerFormat === "rgba16float" ? 8 : 4;
    const fullLayerMiB = layerStorageTileMemoryMiB(
      LAYER_STORAGE_TILE_COUNT,
      bytesPerPixel,
    );
    const activeId = this.layerStack.active.id;
    const layers = this.layerStack.layers.map((record): LayerStorageLayerEstimate => {
      const gpu = this.layerGpu.get(record.id);
      const active = record.id === activeId;
      const hasContent = active ? this.layerHasContent : record.hasContent;
      const contentBounds = active ? this.layerContentBounds : record.contentBounds;
      const conservativeTileCount = hasContent
        ? countLayerStorageTiles(record.storageTileMask)
        : 0;
      const alignedBboxTileCount = hasContent
        ? alignedBoundsTileCount(contentBounds)
        : 0;
      const hotAllocated = Boolean(gpu?.hot);
      const coldTileCount = gpu?.cold?.tileIndices.length ?? 0;
      const compressed = Boolean(gpu?.compressed);
      const compressedCpuMiB = (gpu?.compressed?.storedBytes ?? 0) / MEBIBYTE_BYTES;
      const compressedRawMiB = (gpu?.compressed?.rawBytes ?? 0) / MEBIBYTE_BYTES;
      const actualRawMiB = (hotAllocated ? fullLayerMiB : 0)
        + (gpu?.cold?.memoryBytes ?? 0) / MEBIBYTE_BYTES;
      return {
        id: record.id,
        name: record.name,
        active,
        hasContent,
        conservativeTileCount,
        hotAllocated,
        coldTileCount,
        compressed,
        compressedCpuMiB,
        compressedRawMiB,
        actualRawMiB,
        alignedBboxTileCount,
        conservativeTileMiB: layerStorageTileMemoryMiB(
          conservativeTileCount,
          bytesPerPixel,
        ),
        alignedBboxMiB: layerStorageTileMemoryMiB(
          alignedBboxTileCount,
          bytesPerPixel,
        ),
      };
    });
    const inactive = layers.filter((layer) => !layer.active);
    const inactiveConservativeTileMiB = inactive.reduce(
      (total, layer) => total + layer.conservativeTileMiB,
      0,
    );
    const inactiveAlignedBboxMiB = inactive.reduce(
      (total, layer) => total + layer.alignedBboxMiB,
      0,
    );
    const eagerFullRawMiB = fullLayerMiB * this.layerGpu.size;
    const actualRawMiB = layers.reduce((total, layer) => total + layer.actualRawMiB, 0);
    const activeFullMiB = this.layerGpu.size > 0 ? fullLayerMiB : 0;
    const projectedConservativeRawMiB = activeFullMiB + inactiveConservativeTileMiB;
    const projectedAlignedBboxRawMiB = activeFullMiB + inactiveAlignedBboxMiB;
    return {
      strategy: LAYER_STORAGE_STRATEGY,
      measurementOnly: false,
      tileSizePx: LAYER_STORAGE_TILE_SIZE,
      gridSize: LAYER_STORAGE_GRID_SIZE,
      tileCount: LAYER_STORAGE_TILE_COUNT,
      bytesPerPixel,
      fullLayerMiB,
      actualRawMiB,
      inactiveFullMiB: fullLayerMiB * Math.max(0, this.layerGpu.size - 1),
      eagerFullRawMiB,
      inactiveConservativeTileMiB,
      inactiveAlignedBboxMiB,
      projectedConservativeRawMiB,
      projectedAlignedBboxRawMiB,
      conservativeSavingsMiB: Math.max(0, eagerFullRawMiB - projectedConservativeRawMiB),
      alignedBboxSavingsMiB: Math.max(0, eagerFullRawMiB - projectedAlignedBboxRawMiB),
      layers,
    };
  }

  getStats(): EngineStats {
    const now = performance.now();
    this.renderTimestamps = this.renderTimestamps.filter((timestamp) => now - timestamp <= 1000);
    const gpuMemory = this.getGpuMemoryStats();
    const layerStorageStudy = this.getLayerStorageStudy();
    const effectsScratch = this.effectsWorkbench?.scratchPool.snapshot();
    return {
      fps: this.renderTimestamps.length,
      lastCpuFrameMs: this.lastCpuFrameMs,
      totalBaseStamps: this.totalBaseStamps,
      avoidedLogicalDraws: this.avoidedLogicalDraws,
      layerMemoryMiB:
        gpuMemory.layerBaseMiB
        + gpuMemory.layerColdMiB
        + gpuMemory.layerHydrationMiB,
      mixedScene: this.createMixedSceneSnapshot(),
      layerCount: this.layerStack.count,
      activeLayerId: this.layerStack.active.id,
      layerBakeStrategy: LAYER_BAKE_STRATEGY,
      layerCompositeStrategy: LAYER_COMPOSITE_STRATEGY,
      layerStorageStudy,
      layers: this.layerStack.layers.map((record, index) => {
        const gpu = this.layerGpu.get(record.id);
        const storage = layerStorageStudy.layers[index];
        return {
          id: record.id,
          name: record.name,
          visible: record.visible,
          opacity: record.opacity,
          // The record's copy is only written back when the layer stops being
          // active, so for the active one the engine field is the live truth.
          // Reading the record here would report "empty" while the user paints.
          hasContent: record.id === this.layerStack.active.id
            ? this.layerHasContent
            : record.hasContent,
          conservativeTileCount: storage.conservativeTileCount,
          hotAllocated: storage.hotAllocated,
          coldTileCount: storage.coldTileCount,
          compressed: storage.compressed,
          compressedCpuMiB: storage.compressedCpuMiB,
          compressedRawMiB: storage.compressedRawMiB,
          actualRawMiB: storage.actualRawMiB,
          alignedBboxTileCount: storage.alignedBboxTileCount,
          conservativeTileMiB: storage.conservativeTileMiB,
          alignedBboxMiB: storage.alignedBboxMiB,
          bakeAllocated: Boolean(gpu?.bake),
          bakeValid: gpu?.bakeValid ?? false,
          bakeGeneration: gpu?.bake?.generation ?? 0,
        };
      }),
      activeLayerIndex: this.layerStack.activeIndex,
      layerColdCompressionEnabled: this.layerColdCompressionEnabled,
      layerColdCompressionRuntimeBuild: this.layerColdCompressionEnabled
        ? LAYER_COLD_COMPRESSION_RUNTIME_BUILD
        : null,
      layerColdCompressionWorkerUnavailable: this.layerColdCompressionWorkerUnavailable,
      layerColdCompressionProgress: this.layerColdCompressionProgress
        ? {
          layerId: this.layerColdCompressionProgress.record.id,
          completedTileCount: this.layerColdCompressionProgress.nextArrayLayer,
          totalTileCount: this.layerColdCompressionProgress.cold.tileIndices.length,
          storedCpuMiB: this.layerColdCompressionProgress.storedBytes / MEBIBYTE_BYTES,
          pausedByStroke: this.activeStroke !== null,
        }
        : null,
      rasterStrokeStyle: copyRasterStrokeStyle(this.rasterStrokeStyle),
      rasterStrokePersistentMemoryMiB:
        (this.rasterStrokeRenderer?.persistentMemoryBytes ?? 0) / MEBIBYTE_BYTES,
      rasterStrokeScratchMemoryMiB:
        (this.rasterStrokeRenderer?.scratchMemoryBytes ?? 0) / MEBIBYTE_BYTES,
      rasterStrokeBuilds: this.rasterStrokeTotalBuilds,
      rasterStrokeComposes: this.rasterStrokeTotalComposes,
      rasterStrokeRendererBuild: this.rasterStrokeRenderer?.build ?? null,
      rasterBevelStyle: copyRasterBevelStyle(this.rasterBevelStyle),
      rasterBevelPersistentMemoryMiB: (
        (this.rasterBevelRenderer?.heightMemoryBytes ?? 0)
        + (this.rasterBevelRenderer?.lutMemoryBytes ?? 0)
        + (this.rasterBevelRenderer?.controlMemoryBytes ?? 0)
      ) / MEBIBYTE_BYTES,
      rasterBevelScratchMemoryMiB:
        (this.rasterBevelRenderer?.workspaceMemoryBytes ?? 0) / MEBIBYTE_BYTES,
      rasterBevelBuilds: this.rasterBevelTotalBuilds,
      rasterBevelPasses: this.rasterBevelTotalPasses,
      rasterBevelRendererBuild: this.rasterBevelRenderer?.build ?? null,
      rasterOuterShadowStyle: copyRasterOuterShadowStyle(this.rasterOuterShadowStyle),
      rasterOuterShadowPersistentMemoryMiB: (
        (this.rasterOuterShadowRenderer?.coverageMemoryBytes ?? 0)
        + (this.rasterOuterShadowRenderer?.controlMemoryBytes ?? 0)
      ) / MEBIBYTE_BYTES,
      rasterOuterShadowScratchMemoryMiB:
        (this.rasterOuterShadowRenderer?.workspaceMemoryBytes ?? 0) / MEBIBYTE_BYTES,
      rasterOuterShadowBuilds: this.rasterOuterShadowTotalBuilds,
      rasterOuterShadowPasses: this.rasterOuterShadowTotalPasses,
      rasterOuterShadowRendererBuild: this.rasterOuterShadowRenderer?.build ?? null,
      rasterInnerShadowStyle: copyRasterInnerShadowStyle(this.rasterInnerShadowStyle),
      rasterInnerShadowPersistentMemoryMiB: (
        (this.rasterInnerShadowRenderer?.coverageMemoryBytes ?? 0)
        + (this.rasterInnerShadowRenderer?.controlMemoryBytes ?? 0)
      ) / MEBIBYTE_BYTES,
      rasterInnerShadowScratchMemoryMiB:
        (this.rasterInnerShadowRenderer?.workspaceMemoryBytes ?? 0) / MEBIBYTE_BYTES,
      rasterInnerShadowBuilds: this.rasterInnerShadowTotalBuilds,
      rasterInnerShadowPasses: this.rasterInnerShadowTotalPasses,
      rasterInnerShadowRendererBuild: this.rasterInnerShadowRenderer?.build ?? null,
      effectsWorkingSetStrategy: EFFECTS_WORKING_SET_STRATEGY,
      effectsWorkingSetGeneration: this.effectsWorkbench?.generation ?? 0,
      effectsWorkingSetSourceFormat: this.effectsWorkbench?.sourceFormat ?? this.layerFormat,
      effectsScratchPoolStrategy: EFFECTS_SCRATCH_POOL_STRATEGY,
      effectsScratchPoolCurrentMiB: gpuMemory.effectsScratchPoolMiB,
      effectsScratchPoolPeakMiB: gpuMemory.effectsScratchPoolPeakMiB,
      effectsScratchPoolGeneration: effectsScratch?.generation ?? 0,
      effectsScratchPoolAllocationCount: effectsScratch?.allocationCount ?? 0,
      effectsScratchPoolShrinkCount: effectsScratch?.shrinkCount ?? 0,
      gpuMemory,
      gpuLabel: this.gpuLabel,
      layerFormat: this.layerFormat,
    };
  }

  getBlendRuntimeState(): { scratchAllocated: boolean; scratchMemoryMiB: number } {
    const scratchMemoryMiB = this.blendRenderer?.memoryMiB() ?? 0;
    return {
      scratchAllocated: scratchMemoryMiB > 0,
      scratchMemoryMiB,
    };
  }

  private effectsScratchHasQueuedWork(): boolean {
    return this.frameRequest !== null
      || this.pendingStamps.length > 0
      || this.pendingBlendBatches.length > 0
      || this.clearRequested
      || this.displayDirty
      || this.lightGlazeSession !== null;
  }

  private effectsScratchCanShrinkNow(): boolean {
    return effectsScratchCanShrink({
      initialized: this.initialized,
      activeStroke: this.activeStroke !== null,
      historyBusy: this.historyBusy,
      rasterStrokeBusy: this.rasterStrokeBusy,
      rasterBevelBusy: this.rasterBevelBusy,
      rasterOuterShadowBusy: this.rasterOuterShadowBusy,
      rasterInnerShadowBusy: this.rasterInnerShadowBusy,
      queuedWork: this.effectsScratchHasQueuedWork(),
    });
  }

  private effectsScratchNeedsShrink(): boolean {
    const snapshot = this.effectsWorkbench?.scratchPool.snapshot();
    if (!snapshot || snapshot.currentBytes === 0) {
      return false;
    }
    let retainedBytes = 0;
    for (const [effectId, bytes] of Object.entries(snapshot.requirements)) {
      if (effectId !== "bevel") {
        retainedBytes = Math.max(retainedBytes, bytes);
      }
    }
    // Releasing the Smusso workspace only pays off when it actually reclaims
    // something material. When the Smusso footprint merely exceeds the Traccia
    // one by a little — reachable from the shipped UI with a hard chisel at a
    // large size — an unconditional comparison stays true in steady state and
    // turns every idle gap between two strokes into a free/regrow cycle.
    return effectsScratchShrinkIsWorthwhile(snapshot.currentBytes, retainedBytes);
  }

  private bevelFieldBlocksScratchShrink(): boolean {
    return this.bevelFieldShrinkTimer !== null
      || this.bevelFieldShrinkInFlight
      || this.bevelFieldShrinkOnNextEncode
      || this.bevelFieldNeedsShrink();
  }

  private cancelEffectsScratchShrink(): void {
    if (this.effectsScratchShrinkTimer === null) {
      return;
    }
    window.clearTimeout(this.effectsScratchShrinkTimer);
    this.effectsScratchShrinkTimer = null;
  }

  private scheduleEffectsScratchShrink(): void {
    if (
      this.effectsScratchShrinkTimer !== null
      || this.effectsScratchShrinkInFlight
      || this.bevelFieldBlocksScratchShrink()
      || !this.effectsScratchNeedsShrink()
    ) {
      return;
    }
    this.effectsScratchShrinkTimer = window.setTimeout(() => {
      this.effectsScratchShrinkTimer = null;
      void this.shrinkEffectsScratchAfterIdle();
    }, EFFECTS_SCRATCH_POOL_IDLE_SHRINK_DELAY_MS);
  }

  private async shrinkEffectsScratchAfterIdle(): Promise<void> {
    if (
      this.effectsScratchShrinkInFlight
      || this.bevelFieldBlocksScratchShrink()
      || !this.effectsScratchNeedsShrink()
    ) {
      this.scheduleBevelFieldShrink();
      return;
    }
    if (!this.effectsScratchCanShrinkNow()) {
      this.scheduleEffectsScratchShrink();
      return;
    }

    this.effectsScratchShrinkInFlight = true;
    try {
      await this.device.queue.onSubmittedWorkDone();
      if (
        !this.effectsScratchCanShrinkNow()
        || this.bevelFieldBlocksScratchShrink()
      ) {
        this.scheduleBevelFieldShrink();
        return;
      }

      const pool = this.effectsWorkbench?.scratchPool;
      if (!pool) {
        return;
      }
      const before = pool.snapshot();
      const retainedWithoutBevel = Math.max(
        0,
        ...Object.entries(before.requirements)
          .filter(([effectId]) => effectId !== "bevel")
          .map(([, bytes]) => bytes),
      );
      if ((before.requirements.bevel ?? 0) > retainedWithoutBevel) {
        this.rasterBevelRenderer?.releaseIdleWorkspace();
      }
      const shrunk = pool.shrinkToFit();
      if (shrunk) {
        this.publishStats();
      }
    } finally {
      this.effectsScratchShrinkInFlight = false;
      if (this.effectsScratchNeedsShrink()) {
        this.scheduleEffectsScratchShrink();
      }
    }
  }

  private bevelFieldTargetBounds(): DirtyRect | null {
    return this.rasterBevelInfluenceRect(this.layerContentBounds);
  }

  private bevelFieldNeedsShrink(): boolean {
    if (!this.bevelBoundingFieldEnabled || !this.rasterBevelStyle.enabled) {
      return false;
    }
    return this.rasterBevelRenderer?.fieldNeedsShrink(
      this.bevelFieldTargetBounds(),
    ) ?? false;
  }

  private cancelBevelFieldShrink(): void {
    if (this.bevelFieldShrinkTimer !== null) {
      window.clearTimeout(this.bevelFieldShrinkTimer);
      this.bevelFieldShrinkTimer = null;
    }
    this.bevelFieldShrinkOnNextEncode = false;
  }

  private scheduleBevelFieldShrink(): void {
    if (
      this.bevelFieldShrinkTimer !== null
      || this.bevelFieldShrinkInFlight
      || this.bevelFieldShrinkOnNextEncode
      || !this.bevelFieldNeedsShrink()
    ) {
      return;
    }
    // The field rebuild needs the Bevel workspace once more. Let it finish
    // before the shared scratch pool is released, avoiding a shrink/regrow pair.
    this.cancelEffectsScratchShrink();
    this.bevelFieldShrinkTimer = window.setTimeout(() => {
      this.bevelFieldShrinkTimer = null;
      void this.armBevelFieldShrinkAfterIdle();
    }, RASTER_BEVEL_FIELD_IDLE_SHRINK_DELAY_MS);
  }

  private async armBevelFieldShrinkAfterIdle(): Promise<void> {
    if (this.bevelFieldShrinkInFlight) {
      return;
    }
    if (!this.bevelFieldNeedsShrink()) {
      this.scheduleEffectsScratchShrink();
      return;
    }
    if (!this.effectsScratchCanShrinkNow()) {
      this.scheduleBevelFieldShrink();
      return;
    }

    this.bevelFieldShrinkInFlight = true;
    try {
      await this.device.queue.onSubmittedWorkDone();
      if (!this.effectsScratchCanShrinkNow() || !this.bevelFieldNeedsShrink()) {
        return;
      }
      // The next regular frame replaces the texture before the first command
      // that can read or write the heightfield, then rebuilds the whole new bbox.
      this.bevelFieldShrinkOnNextEncode = true;
      this.displayDirty = true;
      this.requestRender();
    } finally {
      this.bevelFieldShrinkInFlight = false;
      if (this.bevelFieldNeedsShrink()) {
        this.scheduleBevelFieldShrink();
      }
    }
  }

  // Lo scratch Blend (~53 MiB) resta residente solo mentre lo strumento è
  // selezionato. Mai rilasciare con un tratto attivo, batch in coda o replay
  // in corso: il carrier ring del tratto vive in quei buffer.
  private maybeReleaseIdleBlendScratch(): void {
    if (
      !this.initialized
      || this.settings.tool === "blend"
      || this.activeStroke !== null
      || this.historyBusy
      || this.pendingBlendBatches.length > 0
    ) {
      return;
    }
    if (this.blendRenderer?.releaseScratch()) {
      this.publishStats();
    }
  }

  // Lo storage Light Glaze (fino a ~85,3 MiB) resta residente solo mentre un
  // blending glaze è selezionato sul Paint. Mai rilasciare con sessione o
  // tratto attivi, replay in corso o stamp in coda: la sessione vive
  // nell'accumulatore fino al commit.
  private maybeReleaseIdleLightGlazeResources(): void {
    if (
      !this.initialized
      || !this.lightGlazeStorageAllocated
      || (this.settings.tool === "paint"
        && isStrokeGlazeBlendMode(this.settings.blendMode))
      || this.lightGlazeSession !== null
      || this.activeStroke !== null
      || this.historyBusy
      || this.pendingStamps.length > 0
    ) {
      return;
    }
    this.destroyLightGlazeResources();
    this.publishStats();
  }

  private requestGrainLoad(): void {
    if (this.grainResident || this.grainLoadingPromise) {
      return;
    }
    void this.ensureGrainResources().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.callbacks.onStatus?.(`Grain M1 non disponibile: ${message}`, "error");
    });
  }

  private ensureGrainResources(): Promise<void> {
    if (this.grainResident) {
      return Promise.resolve();
    }
    if (this.grainLoadingPromise) {
      return this.grainLoadingPromise;
    }
    this.callbacks.onStatus?.("Carico la texture Grain M1…", "working");
    const loading = (async () => {
      const resources = await this.createGrainTextureResources();
      this.grainTexture = resources.texture;
      this.grainTextureView = this.grainTexture.createView({
        label: "Cotton Fleece M1 native grain full mip view",
      });
      this.grainTextureIdentity = resources.identity;
      this.grainStartupDecodeMs = resources.decodeMs;
      this.grainStartupMipBuildMs = resources.mipBuildMs;
      this.grainStartupUploadMs = resources.uploadMs;
      this.rebuildGrainBrushBindGroups();
      this.blendRenderer?.setGrainTextureView(this.grainTextureView);
      this.grainResident = true;
      this.callbacks.onStatus?.("Grain M1 pronto.", "ok");
      this.publishStats();
    })();
    this.grainLoadingPromise = loading.finally(() => {
      this.grainLoadingPromise = null;
    });
    return this.grainLoadingPromise;
  }

  // La texture Grain M1 (~31,8 MiB) resta residente solo mentre un grain mode
  // è selezionato o c'è lavoro in corso che può campionarla. Il replay
  // Undo/Redo la ricarica da solo prima di ridisegnare batch con grain.
  private maybeReleaseIdleGrainResources(): void {
    if (
      !this.initialized
      || !this.grainResident
      || this.grainLoadingPromise !== null
      || this.settings.grainMode !== "off"
      || this.activeStroke !== null
      || this.lightGlazeSession !== null
      || this.historyBusy
      || this.pendingStamps.length > 0
      || this.pendingBlendBatches.length > 0
    ) {
      return;
    }
    this.grainTexture?.destroy();
    this.grainTexture = null;
    this.grainTextureView = this.grainPlaceholderView;
    this.rebuildGrainBrushBindGroups();
    this.blendRenderer?.setGrainTextureView(this.grainPlaceholderView);
    this.grainResident = false;
    this.publishStats();
  }

  private requestShapeLoad(): void {
    if (this.shapeResident || this.shapeLoadingPromise) {
      return;
    }
    void this.ensureShapeResources().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.callbacks.onStatus?.(`Shape 2K non disponibile: ${message}`, "error");
    });
  }

  private ensureShapeResources(): Promise<void> {
    if (this.shapeResident) {
      return Promise.resolve();
    }
    if (this.shapeLoadingPromise) {
      return this.shapeLoadingPromise;
    }
    this.callbacks.onStatus?.("Carico la maschera Shape 2K…", "working");
    const loading = (async () => {
      const resources = await this.createShapeMaskResources();
      this.shapeMaskTexture = resources.texture;
      this.shapeMaskView = this.shapeMaskTexture.createView({ label: "Shape 2K mask view" });
      this.shapeMaskDecodeStrategy = resources.decodeStrategy;
      this.shapeMaskIdentity = resources.identity;
      this.shapeOccupancyActiveCells = resources.occupancyActiveCells;
      this.shapeOccupancyCoverageRatios = resources.occupancyCoverageRatios;
      this.adaptivePreviewShapeSprite = resources.previewSprite;
      this.shapeOccupancyUniformBuffers.forEach((buffer, mipLevel) => {
        const wordOffset = mipLevel * SHAPE_OCCUPANCY_WORDS_PER_MAP;
        this.device.queue.writeBuffer(
          buffer,
          0,
          resources.occupancyWords.subarray(
            wordOffset,
            wordOffset + SHAPE_OCCUPANCY_WORDS_PER_MAP,
          ),
        );
      });
      this.rebuildShapeBrushBindGroups();
      this.rebuildGrainBrushBindGroups();
      this.blendRenderer?.setShapeMaskView(this.shapeMaskView);
      this.prepareAdaptivePreviewShapePalette(this.settings);
      this.shapeResident = true;
      this.callbacks.onStatus?.("Shape 2K pronta.", "ok");
      this.publishStats();
    })();
    this.shapeLoadingPromise = loading.finally(() => {
      this.shapeLoadingPromise = null;
    });
    return this.shapeLoadingPromise;
  }

  // La maschera Shape 2K (~5,3 MiB) resta residente solo mentre la Shape è
  // selezionata o c'è lavoro in corso che può campionarla. Sprite di preview,
  // identità e statistiche di occupazione (CPU) sopravvivono al rilascio.
  private maybeReleaseIdleShapeResources(): void {
    if (
      !this.initialized
      || !this.shapeResident
      || this.shapeLoadingPromise !== null
      || this.settings.shape === "shape"
      || this.activeStroke !== null
      || this.lightGlazeSession !== null
      || this.historyBusy
      || this.pendingStamps.length > 0
      || this.pendingBlendBatches.length > 0
    ) {
      return;
    }
    this.shapeMaskTexture?.destroy();
    this.shapeMaskTexture = null;
    this.shapeMaskView = this.shapeMaskPlaceholderView;
    this.rebuildShapeBrushBindGroups();
    this.rebuildGrainBrushBindGroups();
    this.blendRenderer?.setShapeMaskView(this.shapeMaskPlaceholderView);
    this.shapeResident = false;
    this.publishStats();
  }

  /**
   * Index of the layer the crossed action belongs to, or null when the step stays
   * on the active layer or there is nothing to cross.
   */
  private historyStepTargetLayerIndex(delta: -1 | 1): number | null {
    const action = delta < 0
      ? this.historyActions[this.historyCursor - 1]
      : this.historyActions[this.historyCursor];
    if (!action) {
      return null;
    }
    const index = this.layerStack.indexOfId(action.layerId);
    return index >= 0 ? index : null;
  }

  /**
   * True only when the crossed action belongs to a layer that no longer exists.
   *
   * Crossing into ANOTHER live layer is supported now: the active layer moves
   * with the cursor. What cannot be replayed is an action whose layer is gone,
   * because there is no texture to rebuild — refusing beats applying it somewhere
   * else.
   */
  private historyStepBlockedByLayer(delta: -1 | 1): boolean {
    return historyStepTargetsMissingLayer(
      this.historyActions,
      this.historyCursor,
      delta,
      new Set(this.layerStack.layers.map((record) => record.id)),
    );
  }

  /**
   * Measurement setups — resetDocument() and runBenchmark() — reset the GLOBAL
   * journal but only clear the active layer, so with several layers they would
   * silently destroy every other layer's undo while leaving its pixels behind.
   *
   * Refusing is right on a second ground too: AGENTS.md requires a run to be
   * compared against the baseline at parity, and a canonical replay with a
   * different layer count is not that. Note that setLayerFormat is NOT gated —
   * it recreates every layer's texture, so its journal reset is genuinely
   * document-wide.
   */
  private get documentWideResetBlockedByLayers(): boolean {
    return this.layerStack.count > 1;
  }

  getHistoryState(): HistoryState {
    return {
      canUndo: !this.historyBusy
        && this.historyCursor > 0
        && !this.historyStepBlockedByLayer(-1),
      canRedo: !this.historyBusy
        && this.historyCursor < this.historyActions.length
        && !this.historyStepBlockedByLayer(1),
      busy: this.historyBusy,
      inconsistent: this.historyStateInconsistent,
      actionCount: this.historyActions.length,
      cursor: this.historyCursor,
      storedBaseStamps: this.historyStoredBaseStamps,
      logicalStampBytes: this.historyStoredBaseStamps * STAMP_STRIDE_BYTES,
    };
  }

  getAdaptivePreviewDiagnostics(): {
    active: boolean;
    frozen: boolean;
    visible: boolean;
    submittedSerial: number;
    confirmedSerial: number;
    lastPresentedSerial: number;
    retirementTargetSerial: number;
    candidateCount: number;
    presentedUnboundCandidates: number;
    drawFramePending: boolean;
    retirementFramePending: boolean;
  } {
    return {
      active: this.adaptivePreviewActive,
      frozen: this.adaptivePreviewFrozen,
      visible: this.adaptivePreviewCanvas?.style.opacity === "1",
      submittedSerial: this.adaptivePreviewSubmittedSerial,
      confirmedSerial: this.adaptivePreviewConfirmedSerial,
      lastPresentedSerial: this.adaptivePreviewLastPresentedSerial,
      retirementTargetSerial: this.adaptivePreviewRetirementTargetSerial,
      candidateCount: this.adaptivePreviewCandidates.length,
      presentedUnboundCandidates: this.adaptivePreviewCandidates.filter(
        (candidate) => candidate.presented && candidate.serial === null,
      ).length,
      drawFramePending: this.adaptivePreviewFrameRequest !== null,
      retirementFramePending: this.adaptivePreviewRetirementFrame !== null,
    };
  }

  async waitForGpu(): Promise<void> {
    if (!this.initialized) {
      throw new Error("Il motore non è ancora inizializzato.");
    }
    await this.device.queue.onSubmittedWorkDone();
  }

  async retargetEffectsWorkingSet(
    layerView: GPUTextureView,
    layerFormat: LayerFormat = this.layerFormat,
    contentBounds: DirtyRect | null | undefined = undefined,
  ): Promise<EffectsWorkbenchRetargetResult> {
    return this.retargetEffectsWorkingSetInternal(
      layerView,
      layerFormat,
      contentBounds,
      "public",
    );
  }

  private async retargetEffectsWorkingSetInternal(
    layerView: GPUTextureView,
    layerFormat: LayerFormat,
    contentBounds: DirtyRect | null | undefined,
    caller: EffectsRetargetCaller,
    styles: Pick<
      LayerRecord,
      "strokeStyle" | "bevelStyle" | "outerShadowStyle" | "innerShadowStyle"
    > | null = null,
    publish = true,
    maintainDisplayPyramid = true,
    completionPolicy: LayerGpuCompletionPolicy = "await-immediately",
    rebuildDomain: LayerEffectsRebuildDomain = "full-document",
  ): Promise<EffectsWorkbenchRetargetResult> {
    if (!this.initialized) {
      throw new Error("Il motore non è ancora inizializzato.");
    }
    // Each caller's exemption is spelled out rather than hidden behind booleans.
    // A layer switch legitimately runs while layerSwitchBusy is its own flag, and
    // cross-layer undo legitimately runs while historyBusy is high because it IS
    // the history transaction — that is the whole reason it cannot go through the
    // public method.
    const duringLayerSwitch = caller !== "public";
    const duringHistoryReplay = caller === "history-replay";
    if (
      this.activeStroke
      || (!duringHistoryReplay && this.historyBusy)
      || (!duringLayerSwitch && this.layerSwitchBusy)
      || this.rasterStrokeBusy
      || this.rasterBevelBusy
      || this.rasterOuterShadowBusy
      || this.rasterInnerShadowBusy
    ) {
      throw new Error("Il banco effetti può cambiare sorgente solo a motore fermo.");
    }
    const workbench = this.requireEffectsWorkbench();
    if (layerFormat !== this.layerFormat || layerFormat !== workbench.sourceFormat) {
      throw new Error(
        `Formato banco effetti ${workbench.sourceFormat} incompatibile con ${layerFormat}; `
        + "usa setLayerFormat() per il fallback con ricreazione completa.",
      );
    }

    if (completionPolicy === "await-immediately") {
      await this.waitForIdle();
    }
    const strokeStyle = styles?.strokeStyle ?? this.rasterStrokeStyle;
    const bevelStyle = styles?.bevelStyle ?? this.rasterBevelStyle;
    const outerShadowStyle = styles?.outerShadowStyle ?? this.rasterOuterShadowStyle;
    const innerShadowStyle = styles?.innerShadowStyle ?? this.rasterInnerShadowStyle;
    const fullDocumentRect: DirtyRect = {
      x: 0,
      y: 0,
      width: LAYER_SIZE,
      height: LAYER_SIZE,
    };
    // Omitted preserves the pre-PR3 contract; explicit null means an empty source.
    const normalizedContentBounds = contentBounds === undefined
      ? fullDocumentRect
      : this.normalizeLayerRect(contentBounds);
    const boundedContentRect = normalizedContentBounds ?? fullDocumentRect;
    const styleStackRetargetBounds = rebuildDomain === "content-bounds"
      ? boundedContentRect
      : fullDocumentRect;
    const bevelRetargetContentBounds = this.bevelBoundingFieldEnabled
      ? normalizedContentBounds
      : fullDocumentRect;
    this.rasterStrokeBusy = true;
    this.rasterBevelBusy = true;
    this.rasterOuterShadowBusy = true;
    this.rasterInnerShadowBusy = true;
    const startedAt = performance.now();
    try {
      const generation = workbench.retarget({ view: layerView, format: layerFormat });
      this.rebuildRasterStrokeDisplayBindGroups();
      this.rasterStrokeCoverageValid = false;
      this.rasterStrokeStyledInitialized = false;
      this.rasterStrokeMipValidThroughLevel = 0;
      this.rasterStrokePendingComposeRect = null;
      this.rasterStrokeLastEncode = null;
      this.rasterBevelHeightValid = false;
      this.rasterBevelHeightSourceMode = null;
      this.rasterBevelPendingComposeRect = null;
      this.rasterBevelLastEncode = null;
      this.rasterOuterShadowMatteValid = false;
      this.rasterOuterShadowSourceMode = null;
      this.rasterOuterShadowPendingComposeRect = null;
      this.rasterOuterShadowLastEncode = null;
      this.rasterInnerShadowMatteValid = false;
      this.rasterInnerShadowSourceMode = null;
      this.rasterInnerShadowPendingComposeRect = null;
      this.rasterInnerShadowLastEncode = null;

      const encoder = this.device.createCommandEncoder({
        label: this.bevelBoundingFieldEnabled
          ? `Banco effetti retarget #${generation}: rebuild campo bbox`
          : `Banco effetti retarget #${generation}: rebuild documento completo`,
      });
      // Public/active retargets preserve the full-document rebuild contract.
      // Fold-only materialization may use the conservative visual-domain input:
      // every buffer is still document-addressed, only dispatched work is bounded.
      const update = this.encodeRasterStrokeUpdate(
        encoder,
        "permanent",
        styleStackRetargetBounds,
        styleStackRetargetBounds,
        true,
        bevelRetargetContentBounds,
        this.bevelBoundingFieldEnabled,
        strokeStyle,
        bevelStyle,
        outerShadowStyle,
        innerShadowStyle,
        normalizedContentBounds,
      );
      if (maintainDisplayPyramid) {
        this.encodeRasterStrokeDisplayPyramid(
          encoder,
          update.dirtyRect,
          this.paintDisplaySelectedMipLevel,
        );
      }
      this.device.queue.submit([encoder.finish()]);
      const submittedAt = performance.now();
      if (completionPolicy === "await-immediately") {
        await this.waitForGpuCapped(`Retarget banco effetti #${generation}`);
      }
      const completedAt = performance.now();
      const result: EffectsWorkbenchRetargetResult = {
        strategy: EFFECTS_WORKING_SET_STRATEGY,
        generation,
        layerFormat,
        contentBounds: normalizedContentBounds ? { ...normalizedContentBounds } : null,
        contentPixels: normalizedContentBounds
          ? normalizedContentBounds.width * normalizedContentBounds.height
          : 0,
        fullDocumentPixels: LAYER_SIZE * LAYER_SIZE,
        cpuRetargetAndEncodeMs: submittedAt - startedAt,
        queueCompletionMs: completedAt - submittedAt,
        totalMs: completedAt - startedAt,
        stroke: update.timing,
        bevel: this.rasterBevelLastEncode,
        outerShadow: this.rasterOuterShadowLastEncode,
        innerShadow: this.rasterInnerShadowLastEncode,
      };
      if (publish) {
        this.presentationCacheNeedsFullRebuild = true;
        this.displayDirty = true;
        this.requestRender();
        this.publishStats();
      }
      if (import.meta.env.DEV && completionPolicy === "await-immediately") {
        console.info(
          this.bevelBoundingFieldEnabled
            ? "[EffectsWorkbench] retarget con campo Smusso bbox completato"
            : "[EffectsWorkbench] retarget 4096² completato",
          result,
        );
      }
      return result;
    } finally {
      this.rasterStrokeBusy = false;
      this.rasterBevelBusy = false;
      this.rasterOuterShadowBusy = false;
      this.rasterInnerShadowBusy = false;
    }
  }

  async benchmarkEffectsWorkingSet(
    samples = 3,
  ): Promise<EffectsWorkbenchBenchmarkReport> {
    if (!import.meta.env.DEV) {
      throw new Error("Il benchmark del banco effetti è disponibile solo in modalità dev.");
    }
    if (!this.initialized) {
      throw new Error("Il motore non è ancora inizializzato.");
    }
    if (
      this.activeStroke
      || this.historyBusy
      || this.layerSwitchBusy
      || this.rasterStrokeBusy
      || this.rasterBevelBusy
      || this.rasterOuterShadowBusy
      || this.rasterInnerShadowBusy
    ) {
      throw new Error("Ferma il motore prima del benchmark del banco effetti.");
    }
    await this.waitForIdle();
    if (
      this.rasterStrokeRenderer
      || this.rasterBevelRenderer
      || this.rasterOuterShadowRenderer
      || this.rasterInnerShadowRenderer
    ) {
      throw new Error(
        "Disattiva Traccia, Smusso e Ombre prima del benchmark per evitare due working set residenti.",
      );
    }

    const originalWorkbench = this.requireEffectsWorkbench();
    this.rasterStrokeBusy = true;
    this.rasterBevelBusy = true;
    this.rasterOuterShadowBusy = true;
    this.rasterInnerShadowBusy = true;
    this.callbacks.onStatus?.("Benchmark banco effetti 4096² in corso…", "working");
    try {
      const { benchmarkEffectsWorkbench } = await import("./effects-benchmark");
      const report = await benchmarkEffectsWorkbench({
        device: this.device,
        sourceTexture: this.layerTexture,
        layerFormat: this.layerFormat,
        lightGlazeUniformBuffer: this.lightGlazeUniformBuffer,
        thicknessTailUniformBuffer: this.thicknessTailDisplayUniformBuffer,
        documentWidth: LAYER_SIZE,
        documentHeight: LAYER_SIZE,
        gpuLabel: this.gpuLabel,
        timestampQueriesSupported: this.device.features.has("timestamp-query"),
        samples,
        onWorkbenchChanged: (workbench) => {
          this.effectsWorkbench = workbench ?? originalWorkbench;
          this.publishStats();
        },
        onMemoryChanged: () => this.publishStats(),
      });
      console.info("[EffectsWorkbench] benchmark 4096²", report);
      console.table(Object.fromEntries(report.scenarios.map((scenario) => [
        scenario.id,
        {
          retargetCpuMs: scenario.retarget.cpuSetupAndEncodeMedianMs,
          retargetQueueMs: scenario.retarget.queueCompletionMedianMs,
          retargetTotalMs: scenario.retarget.totalMedianMs,
          recreateTotalMs: scenario.destroyRecreate.totalMedianMs,
          heightfieldMiB: scenario.heightfieldMemoryMiB,
          resolvedPixels: scenario.retarget.bevelResolvedPixelsMedian,
        },
      ])));
      this.callbacks.onStatus?.("Benchmark banco effetti completato.", "ok");
      return report;
    } finally {
      this.effectsWorkbench = originalWorkbench;
      this.rasterStrokeBusy = false;
      this.rasterBevelBusy = false;
      this.rasterOuterShadowBusy = false;
      this.rasterInnerShadowBusy = false;
      this.publishStats();
    }
  }

  /**
   * Reads authoritative mip 0 back from a paint layer, for tests that must
   * assert on two layers at once.
   *
   * Multi-layer correctness cannot be proved from the screen: the display shows
   * one composite, so "layer A kept its pixels while layer B was rebuilt" is
   * invisible there. Worse, a comparison against the previously presented image
   * passes when a submit is silently dropped, because a dropped submit leaves
   * exactly that image in place — a trap this repo has already fallen into
   * twice. Asserting absolute values in two distinct textures is the only form
   * that cannot pass vacuously.
   */
  /**
   * True when the effects working set points at the layer the stack calls active.
   *
   * This is the one invariant a cross-layer undo can break while leaving every
   * pixel correct: the switch happens inside the history transaction, so a failed
   * rollback can leave the workbench on the layer the cursor no longer selects.
   * The next stroke would then build its fields from the wrong source. No pixel
   * comparison can see it, which is why it is exposed as state.
   */
  effectsWorkingSetMatchesActiveLayer(): boolean {
    if (!import.meta.env.DEV) {
      throw new Error("Diagnostica disponibile solo in modalità dev.");
    }
    const workbench = this.effectsWorkbench;
    if (!workbench) {
      return false;
    }
    const active = this.layerGpu.get(this.layerStack.active.id);
    return Boolean(active?.hot) && workbench.sourceView === active!.hot!.view;
  }

  async readLayerPixels(rect?: DirtyRect, layerIndex?: number): Promise<Uint8Array> {
    if (!import.meta.env.DEV) {
      throw new Error("La sonda dei pixel di livello è disponibile solo in modalità dev.");
    }
    if (!this.initialized) {
      throw new Error("Il motore non è ancora inizializzato.");
    }
    // Reading a NAMED layer rather than only the active one is what makes the
    // test bilateral: "layer A kept its pixels while B was rebuilt" needs both
    // textures, and the active one alone cannot express it.
    const record = layerIndex === undefined
      ? this.layerStack.active
      : this.layerStack.at(layerIndex);
    const gpu = this.requireLayerGpu(record.id);
    if (gpu.hot) {
      return this.readTexturePixels(gpu.hot.texture, rect, "livello");
    }
    const hydration = await this.createHydratedLayerTexture(
      record,
      gpu,
      `Sonda reidratazione livello ${record.id}`,
      false,
    );
    try {
      return await this.readTexturePixels(hydration.texture, rect, "livello");
    } finally {
      this.destroyTransientLayerHydration(hydration);
    }
  }

  /**
   * Dev-only ground truth for the tiled cold store. Full raw readbacks are
   * absent from normal telemetry: they would stall and transfer 64/128 MiB per
   * layer. The destructive GPU harness pays that cost once and compares the
   * resulting any-nonzero-byte mask with the always-on conservative metadata.
   */
  async measureExactLayerStorageStudy(): Promise<LayerStorageExactStudy> {
    if (!import.meta.env.DEV) {
      throw new Error("Misura esatta cold storage disponibile solo in modalità dev.");
    }
    if (!this.initialized) {
      throw new Error("Il motore non è ancora inizializzato.");
    }
    if (this.activeStroke || this.historyBusy || this.layerSwitchBusy) {
      throw new Error("La misura esatta richiede il motore fermo.");
    }

    await this.waitForIdle();
    const temporaryReadbackBytesBefore = this.devReadbackActiveBytes;
    if (temporaryReadbackBytesBefore !== 0) {
      throw new Error(
        `Sonda cold storage avviata con ${temporaryReadbackBytesBefore} byte readback ancora vivi.`,
      );
    }
    this.devReadbackPeakBytes = temporaryReadbackBytesBefore;

    const countedGpuMiBBefore = this.getGpuMemoryStats().countedTotalMiB;
    const estimate = this.getLayerStorageStudy();
    const bytesPerPixel: 4 | 8 = this.layerFormat === "rgba16float" ? 8 : 4;
    const layers: LayerStorageExactLayerMeasurement[] = [];
    for (let index = 0; index < this.layerStack.count; index += 1) {
      const record = this.layerStack.at(index);
      const pixels = await this.readLayerPixels(undefined, index);
      const exactMask = exactLayerStorageTileMask(
        pixels,
        LAYER_SIZE,
        LAYER_SIZE,
        bytesPerPixel,
      );
      const comparison = compareLayerStorageMasks(exactMask, record.storageTileMask);
      const base = estimate.layers[index];
      const exactTileCount = countLayerStorageTiles(exactMask);
      layers.push({
        ...base,
        exactTileCount,
        exactTileMiB: layerStorageTileMemoryMiB(exactTileCount, bytesPerPixel),
        missedExactTiles: comparison.missedReferenceTiles,
        conservativelyExtraTiles: comparison.extraCandidateTiles,
      });
    }

    const inactiveExactMiB = layers
      .filter((layer) => !layer.active)
      .reduce((total, layer) => total + layer.exactTileMiB, 0);
    const activeFullMiB = this.layerGpu.size > 0 ? estimate.fullLayerMiB : 0;
    const projectedExactRawMiB = activeFullMiB + inactiveExactMiB;
    const countedGpuMiBAfter = this.getGpuMemoryStats().countedTotalMiB;
    const temporaryReadbackBytesAfter = this.devReadbackActiveBytes;
    const temporaryReadbackPeakBytes = this.devReadbackPeakBytes;
    return {
      strategy: LAYER_STORAGE_STRATEGY,
      reference: "any-nonzero-raw-byte",
      tileSizePx: LAYER_STORAGE_TILE_SIZE,
      bytesPerPixel,
      actualRawMiB: estimate.actualRawMiB,
      eagerFullRawMiB: estimate.eagerFullRawMiB,
      projectedExactRawMiB,
      projectedConservativeRawMiB: estimate.projectedConservativeRawMiB,
      projectedAlignedBboxRawMiB: estimate.projectedAlignedBboxRawMiB,
      exactSavingsMiB: Math.max(0, estimate.eagerFullRawMiB - projectedExactRawMiB),
      totalMissedExactTiles: layers.reduce(
        (total, layer) => total + layer.missedExactTiles,
        0,
      ),
      totalConservativelyExtraTiles: layers.reduce(
        (total, layer) => total + layer.conservativelyExtraTiles,
        0,
      ),
      countedGpuMiBBefore,
      countedGpuMiBAfter,
      temporaryReadbackMiBBefore: temporaryReadbackBytesBefore / MEBIBYTE_BYTES,
      temporaryReadbackMiBAfter: temporaryReadbackBytesAfter / MEBIBYTE_BYTES,
      temporaryReadbackPeakMiB: temporaryReadbackPeakBytes / MEBIBYTE_BYTES,
      layers,
    };
  }

  /**
   * Measurement-only compression pass over the authoritative inactive tile
   * arrays. It never replaces or destroys a cold texture.
   */
  async measureLayerColdCompressionStudy(
    onProgress?: (progress: LayerCompressionStudyProgress) => void,
  ): Promise<LayerCompressionStudyReport> {
    if (!this.layerCompressionTestEnabled) {
      throw new Error("Studio compressione livelli non abilitato per questa pagina.");
    }
    if (!this.initialized) {
      throw new Error("Il motore non è ancora inizializzato.");
    }
    if (this.layerFormat !== "rgba8unorm") {
      throw new Error("Lo studio compressione v1 richiede livelli RGBA8.");
    }
    if (this.activeStroke || this.historyBusy || this.layerSwitchBusy) {
      throw new Error("La compressione richiede il motore fermo.");
    }
    if (
      typeof CompressionStream !== "function"
      || typeof DecompressionStream !== "function"
    ) {
      throw new Error("CompressionStream gzip non disponibile in questo browser.");
    }

    await this.waitForIdle();
    if (this.devReadbackActiveBytes !== 0) {
      throw new Error(
        `Compressione avviata con ${this.devReadbackActiveBytes} byte readback ancora vivi.`,
      );
    }
    this.devReadbackPeakBytes = 0;

    const {
      LAYER_COMPRESSION_CHUNK_TILE_COUNT,
      LAYER_COMPRESSION_CODEC,
      LAYER_COMPRESSION_STUDY_BUILD,
      LAYER_COMPRESSION_STUDY_VERSION,
      bytesToMiB,
      combineCompressionHashes,
      formatCompressionHash,
      measureLosslessGzipChunk,
    } = await import("./layer-compression-study");
    const sources = this.layerStack.layers.flatMap((record, index) => {
      if (index === this.layerStack.activeIndex) {
        return [];
      }
      const gpu = this.requireLayerGpu(record.id);
      if (record.hasContent && !gpu.cold) {
        throw new Error(
          `Livello inattivo ${record.id}: cold store autorevole mancante.`,
        );
      }
      return gpu.cold ? [{ record, index, cold: gpu.cold }] : [];
    });
    if (sources.length === 0) {
      throw new Error(
        "Servono almeno due livelli e un livello inattivo con contenuto.",
      );
    }

    const startedAt = performance.now();
    const countedGpuMiBBefore = this.getGpuMemoryStats().countedTotalMiB;
    const tileByteLength =
      LAYER_STORAGE_TILE_SIZE * LAYER_STORAGE_TILE_SIZE * 4;
    const totalTiles = sources.reduce(
      (total, source) => total + source.cold.tileIndices.length,
      0,
    );
    const layers: LayerCompressionLayerReport[] = [];
    let completedTiles = 0;
    let totalRawBytes = 0;
    let totalGzipBytes = 0;
    let totalAdaptiveBytes = 0;
    let totalEncodeMs = 0;
    let totalDecodeMs = 0;
    let totalZeroTiles = 0;
    let totalSolidTiles = 0;
    let totalRawFallbackChunks = 0;
    let totalChunkCount = 0;
    let maximumLogicalChunkWorkingBytes = 0;

    for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
      const { record, index, cold } = sources[sourceIndex];
      let rawBytes = 0;
      let gzipBytes = 0;
      let adaptiveBytes = 0;
      let encodeMs = 0;
      let decodeMs = 0;
      let zeroTileCount = 0;
      let solidTileCount = 0;
      let rawFallbackChunks = 0;
      let chunkCount = 0;
      let sourceHash = 0x811c9dc5;
      let restoredHash = 0x811c9dc5;

      for (
        let firstArrayLayer = 0;
        firstArrayLayer < cold.tileIndices.length;
        firstArrayLayer += LAYER_COMPRESSION_CHUNK_TILE_COUNT
      ) {
        const chunkTileCount = Math.min(
          LAYER_COMPRESSION_CHUNK_TILE_COUNT,
          cold.tileIndices.length - firstArrayLayer,
        );
        const payload = await this.readLayerColdStorageTiles(
          cold,
          firstArrayLayer,
          chunkTileCount,
          `compressione livello ${record.id}`,
        );
        const expectedBytes = chunkTileCount * tileByteLength;
        if (payload.byteLength !== expectedBytes) {
          throw new Error(
            `Readback compressione livello ${record.id}: ${payload.byteLength} byte, `
            + `attesi ${expectedBytes}.`,
          );
        }
        const measurement = await measureLosslessGzipChunk(
          payload,
          tileByteLength,
        );
        rawBytes += measurement.rawBytes;
        gzipBytes += measurement.gzipBytes;
        adaptiveBytes += measurement.adaptiveStoredBytes;
        encodeMs += measurement.encodeMs;
        decodeMs += measurement.decodeMs;
        zeroTileCount += measurement.zeroTileCount;
        solidTileCount += measurement.solidTileCount;
        rawFallbackChunks += measurement.usedRawFallback ? 1 : 0;
        chunkCount += 1;
        sourceHash = combineCompressionHashes(
          sourceHash,
          measurement.sourceHash,
          measurement.rawBytes,
        );
        restoredHash = combineCompressionHashes(
          restoredHash,
          measurement.restoredHash,
          measurement.rawBytes,
        );
        maximumLogicalChunkWorkingBytes = Math.max(
          maximumLogicalChunkWorkingBytes,
          measurement.rawBytes * 2 + measurement.gzipBytes,
        );
        completedTiles += chunkTileCount;
        totalRawBytes += measurement.rawBytes;
        totalGzipBytes += measurement.gzipBytes;
        totalAdaptiveBytes += measurement.adaptiveStoredBytes;
        totalEncodeMs += measurement.encodeMs;
        totalDecodeMs += measurement.decodeMs;
        totalZeroTiles += measurement.zeroTileCount;
        totalSolidTiles += measurement.solidTileCount;
        totalRawFallbackChunks += measurement.usedRawFallback ? 1 : 0;
        totalChunkCount += 1;
        onProgress?.({
          layerNumber: sourceIndex + 1,
          layerCount: sources.length,
          layerName: record.name,
          completedTiles,
          totalTiles,
          rawMiB: bytesToMiB(totalRawBytes),
          adaptiveStoredMiB: bytesToMiB(totalAdaptiveBytes),
          savingsPercent: totalRawBytes === 0
            ? 0
            : (1 - totalAdaptiveBytes / totalRawBytes) * 100,
        });
        if ((totalChunkCount & 3) === 0) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        }
      }

      if (rawBytes !== cold.memoryBytes) {
        throw new Error(
          `Livello ${record.id}: misurati ${rawBytes} byte, cold store `
          + `dichiara ${cold.memoryBytes}.`,
        );
      }
      if (sourceHash !== restoredHash) {
        throw new Error(`Livello ${record.id}: hash finale non identico.`);
      }
      const adaptiveSavings = rawBytes - adaptiveBytes;
      layers.push({
        index,
        id: record.id,
        name: record.name,
        tileCount: cold.tileIndices.length,
        chunkCount,
        rawMiB: bytesToMiB(rawBytes),
        gzipMiB: bytesToMiB(gzipBytes),
        adaptiveStoredMiB: bytesToMiB(adaptiveBytes),
        adaptiveSavingsMiB: bytesToMiB(adaptiveSavings),
        adaptiveSavingsPercent: rawBytes === 0
          ? 0
          : adaptiveSavings / rawBytes * 100,
        compressionRatio: adaptiveBytes === 0 ? 0 : rawBytes / adaptiveBytes,
        encodeMs,
        decodeMs,
        zeroTileCount,
        solidTileCount,
        rawFallbackChunks,
        sourceHash: formatCompressionHash(sourceHash),
        restoredHash: formatCompressionHash(restoredHash),
        byteIdentical: true,
      });
    }

    if (this.devReadbackActiveBytes !== 0) {
      throw new Error(
        `Compressione terminata con ${this.devReadbackActiveBytes} byte readback vivi.`,
      );
    }
    const countedGpuMiBAfter = this.getGpuMemoryStats().countedTotalMiB;
    if (Math.abs(countedGpuMiBAfter - countedGpuMiBBefore) > 0.000_001) {
      throw new Error(
        `La diagnostica ha cambiato la memoria GPU conteggiata: `
        + `${countedGpuMiBBefore} → ${countedGpuMiBAfter} MiB.`,
      );
    }
    const adaptiveSavingsBytes = totalRawBytes - totalAdaptiveBytes;
    return {
      version: LAYER_COMPRESSION_STUDY_VERSION,
      build: LAYER_COMPRESSION_STUDY_BUILD,
      passed: true,
      measurementOnly: true,
      codec: LAYER_COMPRESSION_CODEC,
      tileSizePx: LAYER_STORAGE_TILE_SIZE,
      chunkTileCount: LAYER_COMPRESSION_CHUNK_TILE_COUNT,
      layerFormat: "rgba8unorm",
      bytesPerPixel: 4,
      recordedAt: new Date().toISOString(),
      elapsedMs: performance.now() - startedAt,
      layerCount: this.layerStack.count,
      inactiveLayerCount: this.layerStack.count - 1,
      measuredLayerCount: layers.length,
      tileCount: totalTiles,
      chunkCount: totalChunkCount,
      rawMiB: bytesToMiB(totalRawBytes),
      gzipMiB: bytesToMiB(totalGzipBytes),
      adaptiveStoredMiB: bytesToMiB(totalAdaptiveBytes),
      adaptiveSavingsMiB: bytesToMiB(adaptiveSavingsBytes),
      adaptiveSavingsPercent: totalRawBytes === 0
        ? 0
        : adaptiveSavingsBytes / totalRawBytes * 100,
      compressionRatio: totalAdaptiveBytes === 0
        ? 0
        : totalRawBytes / totalAdaptiveBytes,
      encodeMs: totalEncodeMs,
      decodeMs: totalDecodeMs,
      zeroTileCount: totalZeroTiles,
      solidTileCount: totalSolidTiles,
      rawFallbackChunks: totalRawFallbackChunks,
      byteIdentical: true,
      countedGpuMiBBefore,
      countedGpuMiBAfter,
      temporaryReadbackPeakMiB: bytesToMiB(this.devReadbackPeakBytes),
      maximumLogicalChunkWorkingMiB: bytesToMiB(maximumLogicalChunkWorkingBytes),
      environment: {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        devicePixelRatio: window.devicePixelRatio,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        gpuLabel: this.gpuLabel,
      },
      layers,
    };
  }

  getLayerBakeState(layerIndex: number): {
    allocated: boolean;
    valid: boolean;
    generation: number;
    memoryMiB: number;
  } {
    if (!import.meta.env.DEV) {
      throw new Error("Diagnostica bake disponibile solo in modalità dev.");
    }
    if (!this.initialized) {
      throw new Error("Il motore non è ancora inizializzato.");
    }
    const gpu = this.requireLayerGpu(this.layerStack.at(layerIndex).id);
    return {
      allocated: Boolean(gpu.bake),
      valid: gpu.bakeValid,
      generation: gpu.bake?.generation ?? 0,
      memoryMiB: (gpu.bake?.memoryBytes ?? 0) / MEBIBYTE_BYTES,
    };
  }

  async readLayerBakePixels(rect?: DirtyRect, layerIndex = 0): Promise<Uint8Array> {
    if (!import.meta.env.DEV) {
      throw new Error("La sonda del bake è disponibile solo in modalità dev.");
    }
    if (!this.initialized) {
      throw new Error("Il motore non è ancora inizializzato.");
    }
    const gpu = this.requireLayerGpu(this.layerStack.at(layerIndex).id);
    if (!gpu.bake || !gpu.bakeValid) {
      throw new Error(`Bake valido non disponibile per il livello ${layerIndex}.`);
    }
    return this.readTexturePixels(gpu.bake.texture, rect, "bake livello");
  }

  getLayerCompositeState(): {
    storageStrategy: typeof MIXED_MERGED_SURFACE_STORAGE_STRATEGY;
    selectedMipLevel: number;
    below: {
      allocated: boolean;
      bounds: DirtyRect | null;
      resolutionScale: number;
      textureWidth: number;
      textureHeight: number;
      mipLevelCount: number;
      validThroughLevel: number;
      layerCount: number;
      foldedPixels: number;
      analyticBakePixels: number;
      mip0MiB: number;
      mipChainMiB: number;
    };
    above: {
      allocated: boolean;
      bounds: DirtyRect | null;
      resolutionScale: number;
      textureWidth: number;
      textureHeight: number;
      mipLevelCount: number;
      validThroughLevel: number;
      layerCount: number;
      foldedPixels: number;
      analyticBakePixels: number;
      mip0MiB: number;
      mipChainMiB: number;
    };
  } {
    const describe = (surface: MergedSurfaceResources | null) => ({
      allocated: surface !== null,
      bounds: surface ? { ...surface.bounds } : null,
      resolutionScale: surface?.resolutionScale ?? 1,
      textureWidth: surface?.textureWidth ?? 0,
      textureHeight: surface?.textureHeight ?? 0,
      mipLevelCount: surface?.mipViews.length ?? 0,
      validThroughLevel: surface?.validThroughLevel ?? -1,
      layerCount: surface?.layerCount ?? 0,
      foldedPixels: surface?.foldedPixels ?? 0,
      analyticBakePixels: surface?.analyticBakePixels ?? 0,
      mip0MiB: (surface?.mip0MemoryBytes ?? 0) / MEBIBYTE_BYTES,
      mipChainMiB: (surface?.mipChainMemoryBytes ?? 0) / MEBIBYTE_BYTES,
    });
    return {
      storageStrategy: MIXED_MERGED_SURFACE_STORAGE_STRATEGY,
      selectedMipLevel: this.paintDisplaySelectedMipLevel,
      below: describe(this.mergedBelow),
      above: describe(this.mergedAbove),
    };
  }
  async readMergedLayerPixels(
    side: "below" | "above",
    rect?: DirtyRect,
    mipLevel = 0,
    completePyramid = true,
  ): Promise<Uint8Array> {
    if (!import.meta.env.DEV) {
      throw new Error("Sonda merged disponibile solo in modalità dev.");
    }
    const surface = side === "below" ? this.mergedBelow : this.mergedAbove;
    if (!surface) {
      throw new Error(`Superficie merged ${side} non allocata.`);
    }
    if (!Number.isInteger(mipLevel) || mipLevel < 0 || mipLevel >= surface.mipViews.length) {
      throw new Error(
        `Mip merged ${side} ${mipLevel} fuori da 0–${surface.mipViews.length - 1}.`,
      );
    }
    if (mipLevel > surface.validThroughLevel && completePyramid) {
      const encoder = this.device.createCommandEncoder({
        label: `Complete merged ${side} pyramid for readback`,
      });
      this.encodeMergedSurfacePyramid(encoder, surface, mipLevel);
      this.device.queue.submit([encoder.finish()]);
      await this.waitForGpuCapped(`Readback merged ${side}`);
    }
    const mipScale = 2 ** mipLevel;
    const localRect = rect
      ? {
        x: Math.floor(
          (rect.x - surface.bounds.x) * surface.resolutionScale / mipScale,
        ),
        y: Math.floor(
          (rect.y - surface.bounds.y) * surface.resolutionScale / mipScale,
        ),
        width: Math.max(
          1,
          Math.ceil(rect.width * surface.resolutionScale / mipScale),
        ),
        height: Math.max(
          1,
          Math.ceil(rect.height * surface.resolutionScale / mipScale),
        ),
      }
      : undefined;
    return this.readTexturePixels(
      surface.texture,
      localRect,
      `merged ${side}`,
      mipLevel,
    );
  }

  setLayerCompositeTestView(centerX: number, centerY: number, zoom = 1): void {
    if (!import.meta.env.DEV) {
      throw new Error("Vista test compositing disponibile solo in modalità dev.");
    }
    this.viewCenterX = centerX;
    this.viewCenterY = centerY;
    this.zoom = clamp(zoom, 0.02, 64);
    this.viewRotation = 0;
    this.viewRotationCos = 1;
    this.viewRotationSin = 0;
    this.viewRotationGestureRaw = 0;
    this.viewRotationGestureActive = false;
    this.viewRotationSnappedToZero = true;
    this.hasFittedView = true;
    this.presentationCacheNeedsFullRebuild = true;
    this.displayDirty = true;
    this.notifyViewChange();
    this.requestRender();
  }

  private async readPresentationLayerRect(rect: DirtyRect): Promise<Uint8Array> {
    if (Math.abs(this.zoom - 1) > 1e-6 || Math.abs(this.viewRotation) > 1e-7) {
      throw new Error("La sonda rettangolare richiede zoom 1:1 e rotazione zero.");
    }
    await this.waitForIdle();
    if (!this.presentationCacheTexture) {
      throw new Error("Cache di presentazione non allocata.");
    }
    const x = Math.floor(rect.x);
    const y = Math.floor(rect.y);
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);
    if (
      x < 0 || y < 0 || width <= 0 || height <= 0
      || x + width > LAYER_SIZE || y + height > LAYER_SIZE
    ) {
      throw new Error("Rettangolo della sonda presentazione non valido.");
    }
    const canvasPosition = this.layerToCanvasPixels(x + 0.5, y + 0.5);
    const canvasX = Math.round(canvasPosition.x - 0.5);
    const canvasY = Math.round(canvasPosition.y - 0.5);
    if (
      canvasX < 0 || canvasY < 0
      || canvasX + width > this.canvas.width
      || canvasY + height > this.canvas.height
    ) {
      throw new Error("Rettangolo della sonda presentazione fuori dal canvas.");
    }

    const unpaddedBytesPerRow = width * 4;
    const bytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256;
    const buffer = this.device.createBuffer({
      label: `Layer presentation rect probe ${width}×${height}`,
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    try {
      const encoder = this.device.createCommandEncoder({
        label: "Layer presentation rect probe",
      });
      encoder.copyTextureToBuffer(
        {
          texture: this.presentationCacheTexture,
          origin: { x: canvasX, y: canvasY, z: 0 },
        },
        { buffer, bytesPerRow, rowsPerImage: height },
        { width, height, depthOrArrayLayers: 1 },
      );
      this.device.queue.submit([encoder.finish()]);
      let timer = 0;
      try {
        await Promise.race([
          buffer.mapAsync(GPUMapMode.READ),
          new Promise<never>((_, reject) => {
            timer = window.setTimeout(
              () => reject(new Error("Sonda presentazione: timeout readback dopo 10 s.")),
              10_000,
            );
          }),
        ]);
      } finally {
        if (timer !== 0) {
          window.clearTimeout(timer);
        }
      }
      const mapped = new Uint8Array(buffer.getMappedRange());
      const rgba = new Uint8Array(unpaddedBytesPerRow * height);
      const bgra = this.canvasFormat.startsWith("bgra");
      for (let row = 0; row < height; row += 1) {
        for (let column = 0; column < width; column += 1) {
          const sourceOffset = row * bytesPerRow + column * 4;
          const targetOffset = row * unpaddedBytesPerRow + column * 4;
          rgba[targetOffset] = mapped[sourceOffset + (bgra ? 2 : 0)];
          rgba[targetOffset + 1] = mapped[sourceOffset + 1];
          rgba[targetOffset + 2] = mapped[sourceOffset + (bgra ? 0 : 2)];
          rgba[targetOffset + 3] = mapped[sourceOffset + 3];
        }
      }
      buffer.unmap();
      return rgba;
    } finally {
      buffer.destroy();
    }
  }

  async readPresentationPixelAtLayer(x: number, y: number): Promise<Uint8Array> {
    if (!import.meta.env.DEV) {
      throw new Error("Sonda presentazione disponibile solo in modalità dev.");
    }
    await this.waitForIdle();
    if (!this.presentationCacheTexture) {
      throw new Error("Cache di presentazione non allocata.");
    }
    const canvasPosition = this.layerToCanvasPixels(x + 0.5, y + 0.5);
    const canvasX = Math.round(canvasPosition.x - 0.5);
    const canvasY = Math.round(canvasPosition.y - 0.5);
    if (
      canvasX < 0 || canvasY < 0
      || canvasX >= this.canvas.width || canvasY >= this.canvas.height
    ) {
      throw new Error("Texel di presentazione fuori dal canvas di test.");
    }
    const buffer = this.device.createBuffer({
      label: "Layer presentation pixel probe",
      size: 256,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    try {
      const encoder = this.device.createCommandEncoder({
        label: "Layer presentation pixel probe",
      });
      encoder.copyTextureToBuffer(
        {
          texture: this.presentationCacheTexture,
          origin: { x: canvasX, y: canvasY, z: 0 },
        },
        { buffer, bytesPerRow: 256, rowsPerImage: 1 },
        { width: 1, height: 1, depthOrArrayLayers: 1 },
      );
      this.device.queue.submit([encoder.finish()]);
      let timer = 0;
      try {
        await Promise.race([
          buffer.mapAsync(GPUMapMode.READ),
          new Promise<never>((_, reject) => {
            timer = window.setTimeout(
              () => reject(new Error("Sonda presentazione: timeout readback dopo 10 s.")),
              10_000,
            );
          }),
        ]);
      } finally {
        if (timer !== 0) {
          window.clearTimeout(timer);
        }
      }
      const stored = new Uint8Array(buffer.getMappedRange(), 0, 4);
      const rgba = this.canvasFormat.startsWith("bgra")
        ? new Uint8Array([stored[2], stored[1], stored[0], stored[3]])
        : new Uint8Array(stored);
      buffer.unmap();
      return rgba;
    } finally {
      buffer.destroy();
    }
  }

  /**
   * Measures, without choosing between them, the live fragment-derivative
   * contour and the analytic mip-0 bake used after a layer loses focus.
   */
  async measureActiveStyleBakeGap(rect: DirtyRect): Promise<{
    comparedPixels: number;
    comparedBytes: number;
    differingPixels: number;
    differingBytes: number;
    maxDelta: number;
    maxDeltaByChannel: readonly [number, number, number, number];
    firstDifference: {
      x: number;
      y: number;
      channel: "r" | "g" | "b" | "a";
      live: number;
      analyticBake: number;
    } | null;
  }> {
    if (!import.meta.env.DEV) {
      throw new Error("Misura fwidth/bake disponibile solo in modalità dev.");
    }
    if (!this.initialized || this.layerFormat !== "rgba8unorm") {
      throw new Error("La misura fwidth/bake richiede un layer RGBA8 inizializzato.");
    }
    if (this.layerStack.count !== 1 || !this.styleStackActive()) {
      throw new Error("La misura fwidth/bake richiede un solo livello con effetti attivi.");
    }
    await this.waitForIdle();

    const previousView = {
      centerX: this.viewCenterX,
      centerY: this.viewCenterY,
      zoom: this.zoom,
      rotation: this.viewRotation,
      rotationCos: this.viewRotationCos,
      rotationSin: this.viewRotationSin,
      rotationGestureRaw: this.viewRotationGestureRaw,
      rotationGestureActive: this.viewRotationGestureActive,
      rotationSnappedToZero: this.viewRotationSnappedToZero,
      hasFittedView: this.hasFittedView,
    };
    let candidate: LayerBakeResources | null = null;
    try {
      this.viewCenterX = rect.x + rect.width * 0.5;
      this.viewCenterY = rect.y + rect.height * 0.5;
      this.zoom = 1;
      this.viewRotation = 0;
      this.viewRotationCos = 1;
      this.viewRotationSin = 0;
      this.viewRotationGestureRaw = 0;
      this.viewRotationGestureActive = false;
      this.viewRotationSnappedToZero = true;
      this.hasFittedView = true;
      this.presentationCacheNeedsFullRebuild = true;
      this.displayDirty = true;
      this.requestRender();
      const live = await this.readPresentationLayerRect(rect);

      const record = this.layerStack.active;
      const gpu = this.requireLayerGpu(record.id);
      candidate = await this.createLayerBakeCandidate(
        record,
        (gpu.bake?.generation ?? 0) + 1,
        false,
      );
      const analytic = await this.readTexturePixels(
        candidate.texture,
        rect,
        "bake analitico per misura fwidth",
      );
      if (analytic.length !== live.length) {
        throw new Error("Misura fwidth/bake: dimensioni readback incoerenti.");
      }

      const srgbToLinear = (value: number): number => value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
      const linearToSrgb = (value: number): number => value <= 0.0031308
        ? value * 12.92
        : 1.055 * Math.max(value, 0) ** (1 / 2.4) - 0.055;
      const quantizeUnorm = (value: number): number => {
        const scaled = clamp(value, 0, 1) * 255;
        const lower = Math.floor(scaled);
        const fraction = scaled - lower;
        if (fraction < 0.5) {
          return lower;
        }
        if (fraction > 0.5) {
          return lower + 1;
        }
        return lower % 2 === 0 ? lower : lower + 1;
      };
      const activeAlpha = record.visible ? clamp(record.opacity, 0, 1) : 0;
      const channelNames = ["r", "g", "b", "a"] as const;
      const maxDeltaByChannel = [0, 0, 0, 0] as [number, number, number, number];
      let differingPixels = 0;
      let differingBytes = 0;
      let firstDifference: {
        x: number;
        y: number;
        channel: "r" | "g" | "b" | "a";
        live: number;
        analyticBake: number;
      } | null = null;
      const width = Math.floor(rect.width);
      const height = Math.floor(rect.height);
      for (let row = 0; row < height; row += 1) {
        for (let column = 0; column < width; column += 1) {
          const offset = (row * width + column) * 4;
          const alpha = analytic[offset + 3] / 255 * activeAlpha;
          const checkerX = Math.floor((rect.x + column + 0.5) / 96);
          const checkerY = Math.floor((rect.y + row + 0.5) / 96);
          const backgroundSrgb = ((checkerX + checkerY) & 1) === 0 ? 0.91 : 0.82;
          const backgroundLinear = srgbToLinear(backgroundSrgb);
          const expected = [
            quantizeUnorm(linearToSrgb(
              analytic[offset] / 255 * activeAlpha + backgroundLinear * (1 - alpha),
            )),
            quantizeUnorm(linearToSrgb(
              analytic[offset + 1] / 255 * activeAlpha + backgroundLinear * (1 - alpha),
            )),
            quantizeUnorm(linearToSrgb(
              analytic[offset + 2] / 255 * activeAlpha + backgroundLinear * (1 - alpha),
            )),
            255,
          ];
          let pixelDiffers = false;
          for (let channel = 0; channel < 4; channel += 1) {
            const delta = Math.abs(live[offset + channel] - expected[channel]);
            maxDeltaByChannel[channel] = Math.max(maxDeltaByChannel[channel], delta);
            if (delta > 0) {
              differingBytes += 1;
              pixelDiffers = true;
              firstDifference ??= {
                x: Math.floor(rect.x) + column,
                y: Math.floor(rect.y) + row,
                channel: channelNames[channel],
                live: live[offset + channel],
                analyticBake: expected[channel],
              };
            }
          }
          if (pixelDiffers) {
            differingPixels += 1;
          }
        }
      }
      return {
        comparedPixels: width * height,
        comparedBytes: live.length,
        differingPixels,
        differingBytes,
        maxDelta: Math.max(...maxDeltaByChannel),
        maxDeltaByChannel,
        firstDifference,
      };
    } finally {
      this.destroyLayerBake(candidate);
      this.viewCenterX = previousView.centerX;
      this.viewCenterY = previousView.centerY;
      this.zoom = previousView.zoom;
      this.viewRotation = previousView.rotation;
      this.viewRotationCos = previousView.rotationCos;
      this.viewRotationSin = previousView.rotationSin;
      this.viewRotationGestureRaw = previousView.rotationGestureRaw;
      this.viewRotationGestureActive = previousView.rotationGestureActive;
      this.viewRotationSnappedToZero = previousView.rotationSnappedToZero;
      this.hasFittedView = previousView.hasFittedView;
      this.presentationCacheNeedsFullRebuild = true;
      this.displayDirty = true;
      this.requestRender();
    }
  }
  private destroyTrackedReadbackBuffer(buffer: GPUBuffer, size: number): void {
    buffer.destroy();
    this.devReadbackActiveBytes -= size;
    if (this.devReadbackActiveBytes < 0) {
      this.devReadbackActiveBytes = 0;
      throw new Error("Contabilità readback GPU negativa.");
    }
  }
  private async readLayerColdStorageTiles(
    cold: LayerColdStorageResources,
    firstArrayLayer: number,
    arrayLayerCount: number,
    label: string,
  ): Promise<Uint8Array> {
    if (
      !Number.isInteger(firstArrayLayer)
      || !Number.isInteger(arrayLayerCount)
      || firstArrayLayer < 0
      || arrayLayerCount < 1
      || firstArrayLayer + arrayLayerCount > cold.tileIndices.length
    ) {
      throw new Error("Intervallo readback cold storage non valido.");
    }
    const bytesPerPixel = this.layerFormat === "rgba16float" ? 8 : 4;
    const bytesPerRow = LAYER_STORAGE_TILE_SIZE * bytesPerPixel;
    const rowsPerImage = LAYER_STORAGE_TILE_SIZE;
    const readbackBytes = bytesPerRow * rowsPerImage * arrayLayerCount;
    const readbackBuffer = this.device.createBuffer({
      label: `Sonda ${label} tile ${firstArrayLayer}+${arrayLayerCount}`,
      size: readbackBytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    this.devReadbackActiveBytes += readbackBytes;
    this.devReadbackPeakBytes = Math.max(
      this.devReadbackPeakBytes,
      this.devReadbackActiveBytes,
    );
    let mapped = false;
    try {
      const encoder = this.device.createCommandEncoder({
        label: `Sonda ${label}`,
      });
      encoder.copyTextureToBuffer(
        {
          texture: cold.texture,
          origin: { x: 0, y: 0, z: firstArrayLayer },
        },
        { buffer: readbackBuffer, bytesPerRow, rowsPerImage },
        {
          width: LAYER_STORAGE_TILE_SIZE,
          height: LAYER_STORAGE_TILE_SIZE,
          depthOrArrayLayers: arrayLayerCount,
        },
      );
      this.device.queue.submit([encoder.finish()]);
      let timer = 0;
      try {
        await Promise.race([
          readbackBuffer.mapAsync(GPUMapMode.READ),
          new Promise<never>((_, reject) => {
            timer = window.setTimeout(
              () => reject(new Error(`Sonda ${label}: timeout readback dopo 30 s.`)),
              30_000,
            );
          }),
        ]);
      } finally {
        if (timer !== 0) {
          window.clearTimeout(timer);
        }
      }
      mapped = true;
      return new Uint8Array(readbackBuffer.getMappedRange()).slice();
    } finally {
      if (mapped) {
        readbackBuffer.unmap();
      }
      this.destroyTrackedReadbackBuffer(readbackBuffer, readbackBytes);
    }
  }

  private async readTexturePixels(
    target: GPUTexture,
    rect: DirtyRect | undefined,
    label: string,
    mipLevel = 0,
  ): Promise<Uint8Array> {
    const dimension = Math.max(1, LAYER_SIZE >> mipLevel);
    const requested = rect ?? { x: 0, y: 0, width: dimension, height: dimension };
    const x = clamp(Math.floor(requested.x), 0, dimension);
    const y = clamp(Math.floor(requested.y), 0, dimension);
    const width = clamp(Math.ceil(requested.width), 0, dimension - x);
    const height = clamp(Math.ceil(requested.height), 0, dimension - y);
    if (width <= 0 || height <= 0) {
      return new Uint8Array();
    }
    await this.waitForIdle();
    const bytesPerPixel = this.layerFormat === "rgba16float" ? 8 : 4;
    const unpaddedBytesPerRow = width * bytesPerPixel;
    const bytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256;
    const readbackBytes = bytesPerRow * height;
    const readbackBuffer = this.device.createBuffer({
      label: `Sonda pixel ${label} ${width}×${height}`,
      size: readbackBytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    this.devReadbackActiveBytes += readbackBytes;
    this.devReadbackPeakBytes = Math.max(this.devReadbackPeakBytes, this.devReadbackActiveBytes);

    try {
      const encoder = this.device.createCommandEncoder({
        label: `Sonda pixel ${label}`,
      });
      encoder.copyTextureToBuffer(
        { texture: target, mipLevel, origin: { x, y, z: 0 } },
        { buffer: readbackBuffer, bytesPerRow, rowsPerImage: height },
        { width, height, depthOrArrayLayers: 1 },
      );
      this.device.queue.submit([encoder.finish()]);
      let timer = 0;
      try {
        await Promise.race([
          readbackBuffer.mapAsync(GPUMapMode.READ),
          new Promise<never>((_, reject) => {
            timer = window.setTimeout(
              () => reject(new Error(`Sonda ${label}: timeout readback dopo 10 s.`)),
              10_000,
            );
          }),
        ]);
      } finally {
        if (timer !== 0) {
          window.clearTimeout(timer);
        }
      }
      const mapped = new Uint8Array(readbackBuffer.getMappedRange());
      const compact = new Uint8Array(unpaddedBytesPerRow * height);
      for (let row = 0; row < height; row += 1) {
        compact.set(
          mapped.subarray(row * bytesPerRow, row * bytesPerRow + unpaddedBytesPerRow),
          row * unpaddedBytesPerRow,
        );
      }
      readbackBuffer.unmap();
      return compact;
    } finally {
      this.destroyTrackedReadbackBuffer(readbackBuffer, readbackBytes);
    }
  }

  async runRasterStrokeGolden(): Promise<RasterStrokeGoldenReport> {
    if (!this.initialized) {
      throw new Error("WebGPU non ancora inizializzato.");
    }
    if (this.activeStroke) {
      throw new Error("Termina prima la pennellata attiva.");
    }
    await this.waitForIdle();
    const { runRasterStrokeGolden } = await import("./stroke-golden");
    return runRasterStrokeGolden(this.device, {
      bevelBoundingFieldEnabled: this.bevelBoundingFieldEnabled,
    });
  }

  async runRasterShadowGolden(): Promise<RasterShadowGoldenReport> {
    if (!this.initialized) {
      throw new Error("WebGPU non ancora inizializzato.");
    }
    if (this.activeStroke) {
      throw new Error("Termina prima la pennellata attiva.");
    }
    await this.waitForIdle();
    const { runRasterShadowGolden } = await import("./shadow-golden");
    return runRasterShadowGolden(this.device);
  }

  async waitForIdle(): Promise<void> {
    if (!this.initialized) {
      throw new Error("Il motore non è ancora inizializzato.");
    }

    while (this.grainLoadingPromise) {
      await this.grainLoadingPromise;
    }
    while (this.shapeLoadingPromise) {
      await this.shapeLoadingPromise;
    }
    while (
      this.frameRequest !== null ||
      this.pendingStamps.length > 0 ||
      this.pendingBlendBatches.length > 0 ||
      this.clearRequested ||
      this.displayDirty ||
      Boolean(this.lightGlazeSession?.commitRequested)
    ) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }

    await this.device.queue.onSubmittedWorkDone();
    this.retireAdaptivePreviewAfterGpuIdle();
  }

  resetStrokeRandomSeed(): void {
    this.seedSequence = 1;
  }

  startStrokePerformanceProfile(): void {
    this.activeStrokeProfile = {
      startedAt: performance.now(),
      stampGeometry: STAMP_GEOMETRY,
      stampVerticesPerCopy: STAMP_VERTICES_PER_COPY,
      fragmentCoverageStrategy: this.settings.shape === "shape"
        ? SHAPE_FRAGMENT_COVERAGE_STRATEGY
        : CIRCLE_FRAGMENT_COVERAGE_STRATEGY,
      shapeSamplingStrategy: "none",
      shapeOccupancyFallbackReason: "none",
      shapeOccupancyMipLevel: -1,
      shapeOccupancyActiveCells: 0,
      shapeOccupancyCoverageRatio: 0,
      shapeOccupancyCandidateMipLevel: -1,
      shapeOccupancyCandidateActiveCells: 0,
      shapeOccupancyCandidateCoverageRatio: 0,
      historyCapturedBaseStamps: 0,
      historyCapturedBatches: 0,
      historyCommittedActions: 0,
      historyReplayOperations: 0,
      baseStamps: 0,
      physicalCopies: 0,
      renderFrames: 0,
      brushBatches: 0,
      largestBatchStamps: 0,
      estimatedScissorPixels: 0,
      thicknessDynamicsHeldBaseStamps: 0,
      thicknessDynamicsMaximumHeldBaseStamps: 0,
      thicknessDynamicsReleasedDuringStroke: 0,
      thicknessDynamicsReleasedAtLift: 0,
      thicknessDynamicsPreviewFrames: 0,
      thicknessDynamicsPreviewBaseStamps: 0,
      thicknessDynamicsPreviewPhysicalCopies: 0,
      thicknessDynamicsPreviewMaximumTexturePixels: 0,
      presentationCacheFullRebuilds: 0,
      presentationCachePartialUpdates: 0,
      presentationCacheOffscreenSkips: 0,
      presentationCacheLod0FullRebuildTraceEnabledPasses: 0,
      presentationCacheLod0FullRebuildTraceEnabledCpuEncodingMs: 0,
      presentationCacheLod0FullRebuildTraceDisabledPasses: 0,
      presentationCacheLod0FullRebuildTraceDisabledCpuEncodingMs: 0,
      presentationCacheUpdatedPixels: 0,
      legacyDisplayShaderPixels: 0,
      presentationCopiedPixels: 0,
      paintDisplayMaximumSelectedMipLevel: 0,
      paintDisplayPyramidMaintenanceFrames: 0,
      paintDisplayPyramidFullLevelBuilds: 0,
      paintDisplayPyramidDirtyLevelUpdates: 0,
      paintDisplayPyramidPasses: 0,
      paintDisplayPyramidBaseDirtyPixels: 0,
      paintDisplayPyramidUpdatedPixels: 0,
      paintDisplayPyramidEncodingMs: 0,
      adaptivePreviewProbeStarts: 0,
      adaptivePreviewProbeResolvedFast: 0,
      adaptivePreviewProbeResolvedSlow: 0,
      adaptivePreviewProbeTimeouts: 0,
      adaptivePreviewProbeCancellations: 0,
      adaptivePreviewProbeRejections: 0,
      adaptivePreviewProbeNearMisses: 0,
      adaptivePreviewProbeLatencyMs: [],
      adaptivePreviewProbeBacklogBaseStamps: [],
      adaptivePreviewProbeTimeoutLatenessMs: [],
      adaptiveSpacingInitialPercent: this.settings.spacingPercent,
      adaptiveSpacingFinalPercent: this.settings.spacingPercent,
      adaptiveSpacingEvents: [],
      grainStrategy: this.grainStrategy(this.settings),
      grainCoordinateStrategy: this.grainCoordinateStrategy(this.settings),
      grainSamplingStrategy: this.grainSamplingStrategy(this.settings),
      grainCoverageStrategy: this.isTexturizedGrainActive(this.settings)
        ? GRAIN_COVERAGE_STRATEGY
        : "none",
      grainAdaptivePreviewStrategy: this.isTexturizedGrainActive(this.settings)
        ? GRAIN_ADAPTIVE_PREVIEW_STRATEGY
        : "legacy",
      grainBatches: 0,
      grainBaseStamps: 0,
      grainPhysicalCopies: 0,
      grainCircleBatches: 0,
      grainShapeBatches: 0,
      grainAdaptivePreviewSkips: 0,
      lightGlazeStrategy: lightGlazeStrategyForBlendMode(this.settings.blendMode),
      lightGlazeBatches: 0,
      lightGlazeCommits: 0,
      lightGlazeCompositePixels: 0,
      lightGlazePyramidPasses: 0,
      lightGlazePyramidUpdatedPixels: 0,
      adaptivePreviewActivations: 0,
      adaptivePreviewActivationReason: "none",
      adaptivePreviewFirstActivationReason: null,
      adaptivePreviewFirstActivationMs: null,
      adaptivePreviewSecondActivationReason: null,
      adaptivePreviewSecondActivationMs: null,
      adaptivePreviewFrames: 0,
      adaptivePreviewBaseStampsDrawn: 0,
      adaptivePreviewPhysicalCopiesDrawn: 0,
      adaptivePreviewBudgetSkips: 0,
      adaptivePreviewConfirmedStaleBitmapHides: 0,
      adaptivePreviewIncompleteFrameRetryRequests: 0,
      adaptivePreviewOversizedSkips: 0,
      adaptivePreviewPatchPixels: 0,
      adaptivePreviewMaxPatchBackingPixels: 0,
      adaptivePreviewJsTotalMs: 0,
      adaptivePreviewJsFrameMs: [],
      adaptivePreviewMaxLifetimeMs: 0,
      adaptivePreviewMaxQueueProbeLatencyMs: 0,
      adaptivePreviewMaxUnconfirmedBaseStamps: 0,
      adaptivePreviewRetirements: 0,
      adaptivePreviewFrozenAtLift: 0,
      adaptivePreviewLiftPendingBaseStamps: 0,
      adaptivePreviewLiftPendingSerialBindings: 0,
      adaptivePreviewUnsupportedBlendSkips: 0,
      adaptivePreviewExactBaseStampsSubmitted: 0,
      adaptivePreviewExactBatchesSubmitted: 0,
      stampGenerationMs: 0,
      stampPackingMs: 0,
      instanceUploadMs: 0,
      brushEncodingMs: 0,
      displayEncodingMs: 0,
      commandSubmitMs: 0,
      cpuFrameMs: [],
      renderFrameTotalMs: [],
      renderFrameOverheadMs: [],
      resizeCanvasMs: 0,
      batchExtractionMs: 0,
      statsPublishMs: 0,
      renderIntervalMs: [],
      previousFrameTimestamp: null,
    };
  }

  finishStrokePerformanceProfile(): StrokePerformanceProfile | null {
    const profile = this.activeStrokeProfile;
    this.activeStrokeProfile = null;
    if (!profile) {
      return null;
    }
    const averageRenderIntervalMs = average(profile.renderIntervalMs);

    return {
      stampGeometry: profile.stampGeometry,
      stampVerticesPerCopy: profile.stampVerticesPerCopy,
      fragmentCoverageStrategy: profile.fragmentCoverageStrategy,
      shapeSamplingStrategy: profile.shapeSamplingStrategy,
      shapeMaskDecodeStrategy: this.shapeMaskDecodeStrategy,
      shapeOccupancyFallbackReason: profile.shapeOccupancyFallbackReason,
      shapeOccupancyGridSize: SHAPE_OCCUPANCY_GRID_SIZE,
      shapeOccupancyMipLevel: profile.shapeOccupancyMipLevel,
      shapeOccupancyActiveCells: profile.shapeOccupancyActiveCells,
      shapeOccupancyCoverageRatio: profile.shapeOccupancyCoverageRatio,
      shapeOccupancyCandidateMipLevel: profile.shapeOccupancyCandidateMipLevel,
      shapeOccupancyCandidateActiveCells: profile.shapeOccupancyCandidateActiveCells,
      shapeOccupancyCandidateCoverageRatio: profile.shapeOccupancyCandidateCoverageRatio,
      shapeOccupancyMaximumMip: SHAPE_OCCUPANCY_MAX_MIP,
      shapeOccupancyMinimumRadius: SHAPE_OCCUPANCY_MIN_RADIUS,
      shapeOccupancyMaximumCoverageRatio: SHAPE_OCCUPANCY_MAX_COVERAGE_RATIO,
      shapeOccupancyBitmaskBytes: SHAPE_OCCUPANCY_MAP_BYTES,
      colorSeedStrategy: COLOR_SEED_STRATEGY,
      dirtyRectStrategy: DIRTY_RECT_STRATEGY,
      thicknessDynamicsStrategy: THICKNESS_DYNAMICS_STRATEGY,
      thicknessDynamicsTaperWindowMs: THICKNESS_TAPER_WINDOW_MS,
      thicknessDynamicsHeldBaseStamps: profile.thicknessDynamicsHeldBaseStamps,
      thicknessDynamicsMaximumHeldBaseStamps:
        profile.thicknessDynamicsMaximumHeldBaseStamps,
      thicknessDynamicsReleasedDuringStroke:
        profile.thicknessDynamicsReleasedDuringStroke,
      thicknessDynamicsReleasedAtLift: profile.thicknessDynamicsReleasedAtLift,
      thicknessDynamicsPreviewStrategy: THICKNESS_DYNAMICS_PREVIEW_STRATEGY,
      thicknessDynamicsPreviewTextureQuantum: THICKNESS_TAIL_TEXTURE_QUANTUM,
      thicknessDynamicsPreviewMaximumTextureDimension:
        THICKNESS_TAIL_MAXIMUM_TEXTURE_DIMENSION,
      thicknessDynamicsPreviewFrames: profile.thicknessDynamicsPreviewFrames,
      thicknessDynamicsPreviewBaseStamps: profile.thicknessDynamicsPreviewBaseStamps,
      thicknessDynamicsPreviewPhysicalCopies:
        profile.thicknessDynamicsPreviewPhysicalCopies,
      thicknessDynamicsPreviewMaximumTexturePixels:
        profile.thicknessDynamicsPreviewMaximumTexturePixels,
      thicknessDynamicsPreviewAdditionalMemoryMiB:
        profile.thicknessDynamicsPreviewMaximumTexturePixels
        * (this.layerFormat === "rgba16float" ? 8 : 4)
        / (1024 * 1024),
      presentationCacheStrategy: PRESENTATION_CACHE_STRATEGY,
      presentationTransferStrategy: PRESENTATION_TRANSFER_STRATEGY,
      presentationCacheFullRebuilds: profile.presentationCacheFullRebuilds,
      presentationCachePartialUpdates: profile.presentationCachePartialUpdates,
      presentationCacheOffscreenSkips: profile.presentationCacheOffscreenSkips,
      presentationCacheLod0FullRebuildTraceEnabledPasses:
        profile.presentationCacheLod0FullRebuildTraceEnabledPasses,
      presentationCacheLod0FullRebuildTraceEnabledCpuEncodingMs:
        profile.presentationCacheLod0FullRebuildTraceEnabledCpuEncodingMs,
      presentationCacheLod0FullRebuildTraceDisabledPasses:
        profile.presentationCacheLod0FullRebuildTraceDisabledPasses,
      presentationCacheLod0FullRebuildTraceDisabledCpuEncodingMs:
        profile.presentationCacheLod0FullRebuildTraceDisabledCpuEncodingMs,
      presentationCacheUpdatedPixels: profile.presentationCacheUpdatedPixels,
      legacyDisplayShaderPixels: profile.legacyDisplayShaderPixels,
      presentationCopiedPixels: profile.presentationCopiedPixels,
      paintDisplayPyramidStrategy: PAINT_DISPLAY_PYRAMID_STRATEGY,
      paintDisplayLodSelectionStrategy: PAINT_DISPLAY_LOD_SELECTION_STRATEGY,
      paintDisplayMipLevelCount: PAINT_DISPLAY_MIP_LEVEL_COUNT,
      paintDisplaySelectedMipLevel: this.paintDisplaySelectedMipLevel,
      paintDisplayMaximumSelectedMipLevel: profile.paintDisplayMaximumSelectedMipLevel,
      paintDisplayPyramidAdditionalMemoryMiB:
        paintDisplayPyramidAdditionalMemoryMiB(this.layerFormat),
      paintDisplayPyramidMaintenanceFrames: profile.paintDisplayPyramidMaintenanceFrames,
      paintDisplayPyramidFullLevelBuilds: profile.paintDisplayPyramidFullLevelBuilds,
      paintDisplayPyramidDirtyLevelUpdates: profile.paintDisplayPyramidDirtyLevelUpdates,
      paintDisplayPyramidPasses: profile.paintDisplayPyramidPasses,
      paintDisplayPyramidBaseDirtyPixels: profile.paintDisplayPyramidBaseDirtyPixels,
      paintDisplayPyramidUpdatedPixels: profile.paintDisplayPyramidUpdatedPixels,
      paintDisplayPyramidEncodingMs: profile.paintDisplayPyramidEncodingMs,
      brushOpacityStrategy: BRUSH_OPACITY_STRATEGY,
      grainStrategy: profile.grainStrategy,
      grainCoordinateStrategy: profile.grainCoordinateStrategy,
      grainSamplingStrategy: profile.grainSamplingStrategy,
      grainMipStrategy: GRAIN_MIP_STRATEGY,
      grainTextureFormat: "rgba8unorm",
      grainTextureWidth: GRAIN_TEXTURE_SIZE,
      grainTextureHeight: GRAIN_TEXTURE_SIZE,
      grainTextureMipLevelCount: GRAIN_TEXTURE_MIP_LEVEL_COUNT,
      grainTextureMemoryMiB: GRAIN_TEXTURE_PIXEL_COUNT * 4 / (1024 * 1024),
      grainTextureIdentity: this.grainTextureIdentity,
      grainPipelineStrategy: GRAIN_PIPELINE_STRATEGY,
      grainCoverageStrategy: profile.grainCoverageStrategy,
      grainAdaptivePreviewStrategy: profile.grainAdaptivePreviewStrategy,
      grainStartupDecodeMs: this.grainStartupDecodeMs,
      grainStartupMipBuildMs: this.grainStartupMipBuildMs,
      grainStartupUploadMs: this.grainStartupUploadMs,
      grainBatches: profile.grainBatches,
      grainBaseStamps: profile.grainBaseStamps,
      grainPhysicalCopies: profile.grainPhysicalCopies,
      grainCircleBatches: profile.grainCircleBatches,
      grainShapeBatches: profile.grainShapeBatches,
      grainAdaptivePreviewSkips: profile.grainAdaptivePreviewSkips,
      lightGlazeStrategy: profile.lightGlazeStrategy,
      lightGlazeAdaptivePreviewStrategy: LIGHT_GLAZE_ADAPTIVE_PREVIEW_STRATEGY,
      lightGlazeStorageAllocated: this.lightGlazeStorageAllocated,
      lightGlazeStorageMode: this.lightGlazeStorageMode,
      lightGlazeAdditionalMemoryMiB: this.lightGlazeStorageAllocated
        ? lightGlazeAdditionalMemoryMiB(this.layerFormat, this.lightGlazeStorageMode)
        : 0,
      lightGlazeBatches: profile.lightGlazeBatches,
      lightGlazeCommits: profile.lightGlazeCommits,
      lightGlazeCompositePixels: profile.lightGlazeCompositePixels,
      lightGlazePyramidPasses: profile.lightGlazePyramidPasses,
      lightGlazePyramidUpdatedPixels: profile.lightGlazePyramidUpdatedPixels,
      adaptivePreviewStrategy: ADAPTIVE_PREVIEW_STRATEGY,
      adaptivePreviewTriggerStrategy: ADAPTIVE_PREVIEW_TRIGGER_STRATEGY,
      adaptivePreviewStaleFrameStrategy: ADAPTIVE_PREVIEW_STALE_FRAME_STRATEGY,
      adaptivePreviewVisibleCanvasStrategy: ADAPTIVE_PREVIEW_VISIBLE_CANVAS_STRATEGY,
      adaptivePreviewVisibleCanvasRequestedDesynchronized:
        this.adaptivePreviewVisibleCanvasRequestedDesynchronized,
      adaptivePreviewVisibleCanvasAlpha: this.adaptivePreviewVisibleContextAttributes.alpha,
      adaptivePreviewVisibleCanvasDesynchronized:
        this.adaptivePreviewVisibleContextAttributes.desynchronized,
      adaptivePreviewVisibleCanvasColorSpace:
        this.adaptivePreviewVisibleContextAttributes.colorSpace,
      adaptivePreviewScratchCanvasAlpha: this.adaptivePreviewScratchContextAttributes.alpha,
      adaptivePreviewScratchCanvasDesynchronized:
        this.adaptivePreviewScratchContextAttributes.desynchronized,
      adaptivePreviewScratchCanvasColorSpace:
        this.adaptivePreviewScratchContextAttributes.colorSpace,
      adaptivePreviewExactLinearScale: ADAPTIVE_PREVIEW_EXACT_LINEAR_SCALE,
      adaptivePreviewJsBudgetMs: ADAPTIVE_PREVIEW_JS_BUDGET_MS,
      adaptivePreviewMaxTipBaseStamps: ADAPTIVE_PREVIEW_MAX_TIP_BASE_STAMPS,
      adaptivePreviewMaxPatchCssPixels: ADAPTIVE_PREVIEW_MAX_PATCH_CSS_PIXELS,
      adaptivePreviewProbeIntervalSubmissions: ADAPTIVE_PREVIEW_PROBE_INTERVAL_SUBMISSIONS,
      adaptivePreviewTriggerThresholdMs: ADAPTIVE_PREVIEW_TRIGGER_THRESHOLD_MS,
      adaptivePreviewSlowCompletionThresholdMs: ADAPTIVE_PREVIEW_SLOW_COMPLETION_THRESHOLD_MS,
      adaptivePreviewTriggerConsecutiveProbes: ADAPTIVE_PREVIEW_TRIGGER_CONSECUTIVE_PROBES,
      adaptivePreviewProbeNearMissMinimumMs: ADAPTIVE_PREVIEW_PROBE_NEAR_MISS_MINIMUM_MS,
      adaptivePreviewProbeStarts: profile.adaptivePreviewProbeStarts,
      adaptivePreviewProbeResolvedFast: profile.adaptivePreviewProbeResolvedFast,
      adaptivePreviewProbeResolvedSlow: profile.adaptivePreviewProbeResolvedSlow,
      adaptivePreviewProbeTimeouts: profile.adaptivePreviewProbeTimeouts,
      adaptivePreviewProbeCancellations: profile.adaptivePreviewProbeCancellations,
      adaptivePreviewProbeRejections: profile.adaptivePreviewProbeRejections,
      adaptivePreviewProbeNearMisses: profile.adaptivePreviewProbeNearMisses,
      adaptiveSpacingStrategy: ADAPTIVE_SPACING_STRATEGY,
      adaptiveSpacingStepPercentPoints: ADAPTIVE_SPACING_STEP_PERCENT_POINTS,
      adaptiveSpacingMaxExtraPercentPoints: this.adaptiveSpacingMaxExtraPercentPoints,
      adaptiveSpacingInitialPercent: profile.adaptiveSpacingInitialPercent,
      adaptiveSpacingFinalPercent: profile.adaptiveSpacingFinalPercent,
      adaptiveSpacingIncreaseCount: profile.adaptiveSpacingEvents.length,
      adaptiveSpacingReachedMaximum:
        profile.adaptiveSpacingFinalPercent
          >= profile.adaptiveSpacingInitialPercent
            + this.adaptiveSpacingMaxExtraPercentPoints
            - Number.EPSILON * 8,
      adaptiveSpacingEvents: profile.adaptiveSpacingEvents,
      adaptivePreviewActivations: profile.adaptivePreviewActivations,
      adaptivePreviewActivationReason: profile.adaptivePreviewActivationReason,
      adaptivePreviewFirstActivationReason: profile.adaptivePreviewFirstActivationReason,
      adaptivePreviewFirstActivationMs: profile.adaptivePreviewFirstActivationMs,
      adaptivePreviewSecondActivationReason: profile.adaptivePreviewSecondActivationReason,
      adaptivePreviewSecondActivationMs: profile.adaptivePreviewSecondActivationMs,
      adaptivePreviewFrames: profile.adaptivePreviewFrames,
      adaptivePreviewBaseStampsDrawn: profile.adaptivePreviewBaseStampsDrawn,
      adaptivePreviewPhysicalCopiesDrawn: profile.adaptivePreviewPhysicalCopiesDrawn,
      adaptivePreviewBudgetSkips: profile.adaptivePreviewBudgetSkips,
      adaptivePreviewConfirmedStaleBitmapHides:
        profile.adaptivePreviewConfirmedStaleBitmapHides,
      adaptivePreviewIncompleteFrameRetryRequests:
        profile.adaptivePreviewIncompleteFrameRetryRequests,
      adaptivePreviewOversizedSkips: profile.adaptivePreviewOversizedSkips,
      adaptivePreviewPatchPixels: profile.adaptivePreviewPatchPixels,
      adaptivePreviewMaxPatchBackingPixels: profile.adaptivePreviewMaxPatchBackingPixels,
      adaptivePreviewJsTotalMs: profile.adaptivePreviewJsTotalMs,
      adaptivePreviewJsP50Ms: percentile(profile.adaptivePreviewJsFrameMs, 0.5),
      adaptivePreviewJsP95Ms: percentile(profile.adaptivePreviewJsFrameMs, 0.95),
      adaptivePreviewJsMaxMs: maximum(profile.adaptivePreviewJsFrameMs),
      adaptivePreviewMaxLifetimeMs: profile.adaptivePreviewMaxLifetimeMs,
      adaptivePreviewProbeLatencyP50Ms: percentile(profile.adaptivePreviewProbeLatencyMs, 0.5),
      adaptivePreviewProbeLatencyP95Ms: percentile(profile.adaptivePreviewProbeLatencyMs, 0.95),
      adaptivePreviewMaxQueueProbeLatencyMs: profile.adaptivePreviewMaxQueueProbeLatencyMs,
      adaptivePreviewProbeBacklogP50BaseStamps: percentile(
        profile.adaptivePreviewProbeBacklogBaseStamps,
        0.5,
      ),
      adaptivePreviewProbeBacklogP95BaseStamps: percentile(
        profile.adaptivePreviewProbeBacklogBaseStamps,
        0.95,
      ),
      adaptivePreviewProbeBacklogMaxBaseStamps: maximum(
        profile.adaptivePreviewProbeBacklogBaseStamps,
      ),
      adaptivePreviewProbeTimeoutLatenessP50Ms: percentile(
        profile.adaptivePreviewProbeTimeoutLatenessMs,
        0.5,
      ),
      adaptivePreviewProbeTimeoutLatenessP95Ms: percentile(
        profile.adaptivePreviewProbeTimeoutLatenessMs,
        0.95,
      ),
      adaptivePreviewProbeTimeoutLatenessMaxMs: maximum(
        profile.adaptivePreviewProbeTimeoutLatenessMs,
      ),
      adaptivePreviewMaxUnconfirmedBaseStamps: profile.adaptivePreviewMaxUnconfirmedBaseStamps,
      adaptivePreviewRetirements: profile.adaptivePreviewRetirements,
      adaptivePreviewFrozenAtLift: profile.adaptivePreviewFrozenAtLift,
      adaptivePreviewLiftPendingBaseStamps: profile.adaptivePreviewLiftPendingBaseStamps,
      adaptivePreviewLiftPendingSerialBindings: profile.adaptivePreviewLiftPendingSerialBindings,
      adaptivePreviewUnsupportedBlendSkips: profile.adaptivePreviewUnsupportedBlendSkips,
      adaptivePreviewDeferredBaseStamps: 0,
      adaptivePreviewResolvedBaseStamps: 0,
      adaptivePreviewExactReplayBatches: 0,
      adaptivePreviewLiftGpuSubmissions: 0,
      adaptivePreviewExactBaseStampsSubmitted: profile.adaptivePreviewExactBaseStampsSubmitted,
      adaptivePreviewExactBatchesSubmitted: profile.adaptivePreviewExactBatchesSubmitted,
      historyStorageStrategy: HISTORY_STORAGE_STRATEGY,
      historyReplayStrategy: HISTORY_REPLAY_STRATEGY,
      historyStampRetentionStrategy: HISTORY_STAMP_RETENTION_STRATEGY,
      historyCapturedBaseStamps: profile.historyCapturedBaseStamps,
      historyCapturedBatches: profile.historyCapturedBatches,
      historyCommittedActions: profile.historyCommittedActions,
      historyStoredBaseStampsAtEnd: this.historyStoredBaseStamps,
      historyLogicalStampBytesAtEnd: this.historyStoredBaseStamps * STAMP_STRIDE_BYTES,
      historyReplayOperations: profile.historyReplayOperations,
      baseStamps: profile.baseStamps,
      physicalCopies: profile.physicalCopies,
      renderFrames: profile.renderFrames,
      brushBatches: profile.brushBatches,
      largestBatchStamps: profile.largestBatchStamps,
      estimatedScissorPixels: profile.estimatedScissorPixels,
      stampGenerationMs: profile.stampGenerationMs,
      stampPackingMs: profile.stampPackingMs,
      instanceUploadMs: profile.instanceUploadMs,
      brushEncodingMs: profile.brushEncodingMs,
      displayEncodingMs: profile.displayEncodingMs,
      commandSubmitMs: profile.commandSubmitMs,
      submitImmediateP50Ms: percentile(profile.cpuFrameMs, 0.5),
      submitImmediateP95Ms: percentile(profile.cpuFrameMs, 0.95),
      submitImmediateMaxMs: maximum(profile.cpuFrameMs),
      renderFrameTotalP50Ms: percentile(profile.renderFrameTotalMs, 0.5),
      renderFrameTotalP95Ms: percentile(profile.renderFrameTotalMs, 0.95),
      renderFrameTotalMaxMs: maximum(profile.renderFrameTotalMs),
      renderFrameOverheadP50Ms: percentile(profile.renderFrameOverheadMs, 0.5),
      renderFrameOverheadP95Ms: percentile(profile.renderFrameOverheadMs, 0.95),
      renderFrameOverheadMaxMs: maximum(profile.renderFrameOverheadMs),
      resizeCanvasTotalMs: profile.resizeCanvasMs,
      batchExtractionTotalMs: profile.batchExtractionMs,
      statsPublishTotalMs: profile.statsPublishMs,
      // Compatibilità con le run precedenti: questi tre campi continuano a
      // rappresentare soltanto submitImmediate(), non l'intero renderFrame().
      cpuFrameP50Ms: percentile(profile.cpuFrameMs, 0.5),
      cpuFrameP95Ms: percentile(profile.cpuFrameMs, 0.95),
      cpuFrameMaxMs: maximum(profile.cpuFrameMs),
      renderIntervalP50Ms: percentile(profile.renderIntervalMs, 0.5),
      renderIntervalP95Ms: percentile(profile.renderIntervalMs, 0.95),
      renderIntervalMaxMs: maximum(profile.renderIntervalMs),
      averageRenderFps: averageRenderIntervalMs > 0
        ? 1_000 / averageRenderIntervalMs
        : 0,
      delayedRenderFrames: profile.renderIntervalMs.filter((duration) => duration > 20).length,
    };
  }

  getBenchmarkEnvironment(): {
    canvasWidth: number;
    canvasHeight: number;
    layerSize: number;
    layerFormat: LayerFormat;
    layerMemoryMiB: number;
    layerCount: number;
    activeLayerId: number;
    layerBakeStrategy: typeof LAYER_BAKE_STRATEGY;
    layerCompositeStrategy: typeof LAYER_COMPOSITE_STRATEGY;
    layerStorageStudy: LayerStorageStudyStats;
    gpuLabel: string;
    effectsWorkingSetStrategy: typeof EFFECTS_WORKING_SET_STRATEGY;
    effectsWorkingSetGeneration: number;
    effectsWorkingSetSourceFormat: LayerFormat;
    effectsScratchPoolStrategy: typeof EFFECTS_SCRATCH_POOL_STRATEGY;
    effectsScratchPoolCurrentBytes: number;
    effectsScratchPoolPeakBytes: number;
    effectsScratchPoolGeneration: number;
    effectsScratchPoolAllocationCount: number;
    effectsScratchPoolShrinkCount: number;
    effectsScratchPoolRequirementsBytes: Readonly<Record<string, number>>;
    rasterStrokeRendererBuild: string | null;
    rasterStrokeStyle: RasterStrokeStyle;
    rasterStrokePersistentMemoryMiB: number;
    rasterStrokeCoverageMemoryMiB: number;
    rasterStrokeScratchMemoryMiB: number;
    rasterStrokeCoverageStrategy: typeof RASTER_STROKE_COVERAGE_STRATEGY;
    rasterStrokeGeometryStorageStrategy: typeof RASTER_STROKE_GEOMETRY_STORAGE_STRATEGY;
    rasterStrokeGeometryResident: boolean;
    rasterStrokeStyledStorageStrategy: typeof RASTER_STROKE_STYLED_STORAGE_STRATEGY;
    rasterStrokeDistanceStorageStrategy: typeof RASTER_STROKE_DISTANCE_STORAGE_STRATEGY;
    rasterStrokeMutationGateStrategy: typeof RASTER_STROKE_MUTATION_GATE_STRATEGY;
    rasterStrokeScratchStrategy: typeof RASTER_STROKE_SCRATCH_STRATEGY;
    rasterStrokeScratchExtent: number;
    rasterStrokeScratchCompactMaxWidth: number;
    rasterBevelRendererBuild: string | null;
    rasterBevelStyle: RasterBevelStyle;
    rasterBevelHeightMemoryMiB: number;
    rasterBevelScratchMemoryMiB: number;
    rasterBevelScratchExtent: number;
    rasterBevelFieldStrategy:
      | typeof RASTER_BEVEL_FIELD_STRATEGY
      | typeof RASTER_BEVEL_BOUNDING_FIELD_STRATEGY;
    rasterBevelBoundingFieldEnabled: boolean;
    rasterBevelFieldAllocationBounds: RasterBevelRect | null;
    rasterBevelFieldValidBounds: RasterBevelRect | null;
    rasterBevelFieldTextureWidth: number;
    rasterBevelFieldTextureHeight: number;
    rasterBevelFieldGeneration: number;
    rasterBevelFieldAllocationCount: number;
    rasterBevelFieldShrinkCount: number;
    rasterBevelDistanceStrategy: typeof RASTER_BEVEL_DISTANCE_STRATEGY;
    rasterBevelWorkspaceStrategy: typeof RASTER_BEVEL_WORKSPACE_STRATEGY;
    rasterBevelHeightSourceMode: RasterStrokeSourceMode | null;
    rasterOuterShadowRendererBuild: string | null;
    rasterOuterShadowStyle: RasterOuterShadowStyle;
    rasterOuterShadowMatteMemoryMiB: number;
    rasterOuterShadowControlMemoryMiB: number;
    rasterOuterShadowScratchMemoryMiB: number;
    rasterOuterShadowScratchExtent: number;
    rasterOuterShadowStorageStrategy: typeof RASTER_SHADOW_STORAGE_STRATEGY;
    rasterOuterShadowWorkspaceStrategy: typeof RASTER_SHADOW_WORKSPACE_STRATEGY;
    rasterOuterShadowSourceMode: RasterStrokeSourceMode | null;
    rasterInnerShadowRendererBuild: string | null;
    rasterInnerShadowStyle: RasterInnerShadowStyle;
    rasterInnerShadowMatteMemoryMiB: number;
    rasterInnerShadowControlMemoryMiB: number;
    rasterInnerShadowScratchMemoryMiB: number;
    rasterInnerShadowScratchExtent: number;
    rasterInnerShadowStorageStrategy: typeof RASTER_SHADOW_STORAGE_STRATEGY;
    rasterInnerShadowWorkspaceStrategy: typeof RASTER_SHADOW_WORKSPACE_STRATEGY;
    rasterInnerShadowSourceMode: RasterStrokeSourceMode | null;

    dryBlendScratchLifecycleStrategy: typeof DRY_BLEND_SCRATCH_LIFECYCLE_STRATEGY;
    timestampQueriesSupported: boolean;
    stampGeometry: StampGeometry;
    stampVerticesPerCopy: number;
    fragmentCoverageStrategy: FragmentCoverageStrategy;
    shapeSamplingStrategy: ShapeSamplingStrategy;
    shapeMaskDecodeStrategy: ShapeMaskDecodeStrategy;
    shapeOccupancyFallbackReason: ShapeOccupancyFallbackReason;
    shapeOccupancyGridSize: number;
    shapeOccupancyMipLevel: number;
    shapeOccupancyActiveCells: number;
    shapeOccupancyCoverageRatio: number;
    shapeOccupancyCandidateMipLevel: number;
    shapeOccupancyCandidateActiveCells: number;
    shapeOccupancyCandidateCoverageRatio: number;
    shapeOccupancyMaximumMip: number;
    shapeOccupancyMinimumRadius: number;
    shapeOccupancyMaximumCoverageRatio: number;
    shapeOccupancyBitmaskBytes: number;
    shapeMaskResident: boolean;
    shapeStorageLifecycleStrategy: typeof SHAPE_STORAGE_LIFECYCLE_STRATEGY;
    colorSeedStrategy: typeof COLOR_SEED_STRATEGY;
    dirtyRectStrategy: typeof DIRTY_RECT_STRATEGY;
    thicknessDynamicsStrategy: ThicknessDynamicsStrategy;
    thicknessDynamicsTaperWindowMs: number;
    thicknessDynamicsPreviewStrategy: ThicknessDynamicsPreviewStrategy;
    thicknessDynamicsPreviewTextureQuantum: number;
    thicknessDynamicsPreviewMaximumTextureDimension: number;
    presentationCacheStrategy: typeof PRESENTATION_CACHE_STRATEGY;
    presentationTransferStrategy: typeof PRESENTATION_TRANSFER_STRATEGY;
    paintDisplayPyramidStrategy: typeof PAINT_DISPLAY_PYRAMID_STRATEGY;
    paintDisplayLodSelectionStrategy: typeof PAINT_DISPLAY_LOD_SELECTION_STRATEGY;
    paintDisplayMipLevelCount: number;
    paintDisplaySelectedMipLevel: number;
    paintDisplayPyramidAdditionalMemoryMiB: number;
    brushOpacityStrategy: typeof BRUSH_OPACITY_STRATEGY;
    grainStrategy: GrainStrategy;
    grainCoordinateStrategy: GrainCoordinateStrategy;
    grainSamplingStrategy: GrainSamplingStrategy;
    grainMipStrategy: typeof GRAIN_MIP_STRATEGY;
    grainTextureFormat: "rgba8unorm";
    grainTextureWidth: number;
    grainTextureHeight: number;
    grainTextureMipLevelCount: number;
    grainTextureMemoryMiB: number;
    grainTextureIdentity: number;
    grainPipelineStrategy: typeof GRAIN_PIPELINE_STRATEGY;
    grainCoverageStrategy: GrainCoverageStrategy;
    grainAdaptivePreviewStrategy: GrainAdaptivePreviewStrategy;
    grainStartupDecodeMs: number;
    grainStartupMipBuildMs: number;
    grainStartupUploadMs: number;
    grainTextureResident: boolean;
    grainStorageLifecycleStrategy: typeof GRAIN_STORAGE_LIFECYCLE_STRATEGY;
    lightGlazeStrategy: LightGlazeStrategy;
    lightGlazeAdaptivePreviewStrategy: typeof LIGHT_GLAZE_ADAPTIVE_PREVIEW_STRATEGY;
    lightGlazeStorageAllocated: boolean;
    lightGlazeStorageMode: LightGlazeStorageMode;
    lightGlazeAdditionalMemoryMiB: number;
    lightGlazeStorageLifecycleStrategy: typeof LIGHT_GLAZE_STORAGE_LIFECYCLE_STRATEGY;
    adaptivePreviewStrategy: typeof ADAPTIVE_PREVIEW_STRATEGY;
    adaptivePreviewTriggerStrategy: typeof ADAPTIVE_PREVIEW_TRIGGER_STRATEGY;
    adaptivePreviewStaleFrameStrategy: typeof ADAPTIVE_PREVIEW_STALE_FRAME_STRATEGY;
    adaptivePreviewVisibleCanvasStrategy: typeof ADAPTIVE_PREVIEW_VISIBLE_CANVAS_STRATEGY;
    adaptivePreviewVisibleCanvasRequestedDesynchronized: boolean;
    adaptivePreviewVisibleCanvasAlpha: boolean | null;
    adaptivePreviewVisibleCanvasDesynchronized: boolean | null;
    adaptivePreviewVisibleCanvasColorSpace: string | null;
    adaptivePreviewScratchCanvasAlpha: boolean | null;
    adaptivePreviewScratchCanvasDesynchronized: boolean | null;
    adaptivePreviewScratchCanvasColorSpace: string | null;
    adaptivePreviewExactLinearScale: number;
    adaptivePreviewJsBudgetMs: number;
    adaptivePreviewMaxTipBaseStamps: number;
    adaptivePreviewMaxPatchCssPixels: number;
    adaptivePreviewProbeIntervalSubmissions: number;
    adaptivePreviewTriggerThresholdMs: number;
    adaptivePreviewSlowCompletionThresholdMs: number;
    adaptivePreviewTriggerConsecutiveProbes: number;
    adaptivePreviewProbeNearMissMinimumMs: number;
    adaptiveSpacingStrategy: typeof ADAPTIVE_SPACING_STRATEGY;
    adaptiveSpacingStepPercentPoints: number;
    adaptiveSpacingMaxExtraPercentPoints: number;
    historyStorageStrategy: typeof HISTORY_STORAGE_STRATEGY;
    historyReplayStrategy: typeof HISTORY_REPLAY_STRATEGY;
    historyStampRetentionStrategy: typeof HISTORY_STAMP_RETENTION_STRATEGY;
  } {
    const effectsScratch = this.effectsWorkbench?.scratchPool.snapshot();
    const layerStorageStudy = this.getLayerStorageStudy();
    const bevelField = this.rasterBevelRenderer?.fieldState ?? {
      bounded: this.bevelBoundingFieldEnabled,
      allocationBounds: null,
      validBounds: null,
      textureWidth: 0,
      textureHeight: 0,
      memoryBytes: 0,
      generation: 0,
      allocationCount: 0,
      shrinkCount: 0,
    };
    return {
      canvasWidth: this.canvas.width,
      canvasHeight: this.canvas.height,
      layerSize: LAYER_SIZE,
      layerFormat: this.layerFormat,
      layerMemoryMiB: layerStorageStudy.actualRawMiB,
      layerCount: this.layerStack.count,
      activeLayerId: this.layerStack.active.id,
      layerBakeStrategy: LAYER_BAKE_STRATEGY,
      layerCompositeStrategy: LAYER_COMPOSITE_STRATEGY,
      layerStorageStudy,
      gpuLabel: this.gpuLabel,
      effectsWorkingSetStrategy: EFFECTS_WORKING_SET_STRATEGY,
      effectsWorkingSetGeneration: this.effectsWorkbench?.generation ?? 0,
      effectsWorkingSetSourceFormat: this.effectsWorkbench?.sourceFormat ?? this.layerFormat,
      effectsScratchPoolStrategy: EFFECTS_SCRATCH_POOL_STRATEGY,
      effectsScratchPoolCurrentBytes: effectsScratch?.currentBytes ?? 0,
      effectsScratchPoolPeakBytes: effectsScratch?.peakBytes ?? 0,
      effectsScratchPoolGeneration: effectsScratch?.generation ?? 0,
      effectsScratchPoolAllocationCount: effectsScratch?.allocationCount ?? 0,
      effectsScratchPoolShrinkCount: effectsScratch?.shrinkCount ?? 0,
      effectsScratchPoolRequirementsBytes: effectsScratch?.requirements ?? {},
      timestampQueriesSupported: this.device?.features.has("timestamp-query") ?? false,
      rasterStrokeRendererBuild: this.rasterStrokeRenderer?.build ?? null,
      rasterStrokeStyle: copyRasterStrokeStyle(this.rasterStrokeStyle),
      rasterStrokePersistentMemoryMiB:
        (this.rasterStrokeRenderer?.persistentMemoryBytes ?? 0) / (1024 * 1024),
      rasterStrokeCoverageMemoryMiB:
        (this.rasterStrokeRenderer?.coverageMemoryBytes ?? 0) / (1024 * 1024),
      rasterStrokeScratchMemoryMiB:
        (this.rasterStrokeRenderer?.scratchMemoryBytes ?? 0) / (1024 * 1024),
      rasterStrokeCoverageStrategy: RASTER_STROKE_COVERAGE_STRATEGY,
      rasterStrokeGeometryStorageStrategy: RASTER_STROKE_GEOMETRY_STORAGE_STRATEGY,
      rasterStrokeGeometryResident: this.rasterStrokeRenderer?.strokeGeometryEnabled ?? false,
      rasterStrokeStyledStorageStrategy: RASTER_STROKE_STYLED_STORAGE_STRATEGY,
      rasterStrokeDistanceStorageStrategy: RASTER_STROKE_DISTANCE_STORAGE_STRATEGY,
      rasterStrokeMutationGateStrategy: RASTER_STROKE_MUTATION_GATE_STRATEGY,
      rasterStrokeScratchStrategy: RASTER_STROKE_SCRATCH_STRATEGY,
      rasterStrokeScratchExtent: this.rasterStrokeRenderer?.scratchExtent ?? 0,
      rasterStrokeScratchCompactMaxWidth: RASTER_STROKE_COMPACT_SCRATCH_MAX_WIDTH,
      dryBlendScratchLifecycleStrategy: DRY_BLEND_SCRATCH_LIFECYCLE_STRATEGY,
      rasterBevelRendererBuild: this.rasterBevelRenderer?.build ?? null,
      rasterBevelStyle: copyRasterBevelStyle(this.rasterBevelStyle),
      rasterBevelHeightMemoryMiB:
        (this.rasterBevelRenderer?.heightMemoryBytes ?? 0) / MEBIBYTE_BYTES,
      rasterBevelScratchMemoryMiB:
        (this.rasterBevelRenderer?.workspaceMemoryBytes ?? 0) / MEBIBYTE_BYTES,
      rasterBevelScratchExtent: this.rasterBevelRenderer?.workspaceExtent ?? 0,
      rasterBevelFieldStrategy: this.bevelBoundingFieldEnabled
        ? RASTER_BEVEL_BOUNDING_FIELD_STRATEGY
        : RASTER_BEVEL_FIELD_STRATEGY,
      rasterBevelBoundingFieldEnabled: this.bevelBoundingFieldEnabled,
      rasterBevelFieldAllocationBounds: bevelField.allocationBounds,
      rasterBevelFieldValidBounds: bevelField.validBounds,
      rasterBevelFieldTextureWidth: bevelField.textureWidth,
      rasterBevelFieldTextureHeight: bevelField.textureHeight,
      rasterBevelFieldGeneration: bevelField.generation,
      rasterBevelFieldAllocationCount: bevelField.allocationCount,
      rasterBevelFieldShrinkCount: bevelField.shrinkCount,
      rasterBevelDistanceStrategy: RASTER_BEVEL_DISTANCE_STRATEGY,
      rasterBevelWorkspaceStrategy: RASTER_BEVEL_WORKSPACE_STRATEGY,
      rasterBevelHeightSourceMode: this.rasterBevelHeightSourceMode,
      rasterOuterShadowRendererBuild: this.rasterOuterShadowRenderer?.build ?? null,
      rasterOuterShadowStyle: copyRasterOuterShadowStyle(this.rasterOuterShadowStyle),
      rasterOuterShadowMatteMemoryMiB:
        (this.rasterOuterShadowRenderer?.coverageMemoryBytes ?? 0) / MEBIBYTE_BYTES,
      rasterOuterShadowControlMemoryMiB:
        (this.rasterOuterShadowRenderer?.controlMemoryBytes ?? 0) / MEBIBYTE_BYTES,
      rasterOuterShadowScratchMemoryMiB:
        (this.rasterOuterShadowRenderer?.workspaceMemoryBytes ?? 0) / MEBIBYTE_BYTES,
      rasterOuterShadowScratchExtent: this.rasterOuterShadowRenderer?.workspaceExtent ?? 0,
      rasterOuterShadowStorageStrategy: RASTER_SHADOW_STORAGE_STRATEGY,
      rasterOuterShadowWorkspaceStrategy: RASTER_SHADOW_WORKSPACE_STRATEGY,
      rasterOuterShadowSourceMode: this.rasterOuterShadowSourceMode,
      rasterInnerShadowRendererBuild: this.rasterInnerShadowRenderer?.build ?? null,
      rasterInnerShadowStyle: copyRasterInnerShadowStyle(this.rasterInnerShadowStyle),
      rasterInnerShadowMatteMemoryMiB:
        (this.rasterInnerShadowRenderer?.coverageMemoryBytes ?? 0) / MEBIBYTE_BYTES,
      rasterInnerShadowControlMemoryMiB:
        (this.rasterInnerShadowRenderer?.controlMemoryBytes ?? 0) / MEBIBYTE_BYTES,
      rasterInnerShadowScratchMemoryMiB:
        (this.rasterInnerShadowRenderer?.workspaceMemoryBytes ?? 0) / MEBIBYTE_BYTES,
      rasterInnerShadowScratchExtent: this.rasterInnerShadowRenderer?.workspaceExtent ?? 0,
      rasterInnerShadowStorageStrategy: RASTER_SHADOW_STORAGE_STRATEGY,
      rasterInnerShadowWorkspaceStrategy: RASTER_SHADOW_WORKSPACE_STRATEGY,
      rasterInnerShadowSourceMode: this.rasterInnerShadowSourceMode,

      stampGeometry: this.settings.shape === "shape" ? this.lastStampGeometry : STAMP_GEOMETRY,
      stampVerticesPerCopy: this.settings.shape === "shape"
        ? this.lastStampVerticesPerCopy
        : STAMP_VERTICES_PER_COPY,
      fragmentCoverageStrategy: this.settings.shape === "shape"
        ? SHAPE_FRAGMENT_COVERAGE_STRATEGY
        : CIRCLE_FRAGMENT_COVERAGE_STRATEGY,
      shapeSamplingStrategy: this.settings.shape === "shape"
        ? this.lastShapeSamplingStrategy
        : "none",
      shapeMaskDecodeStrategy: this.shapeMaskDecodeStrategy,
      shapeOccupancyFallbackReason: this.settings.shape === "shape"
        ? this.lastShapeOccupancyFallbackReason
        : "none",
      shapeOccupancyGridSize: SHAPE_OCCUPANCY_GRID_SIZE,
      shapeOccupancyMipLevel: this.settings.shape === "shape" ? this.lastShapeOccupancyMipLevel : -1,
      shapeOccupancyActiveCells: this.settings.shape === "shape" ? this.lastShapeOccupancyActiveCells : 0,
      shapeOccupancyCoverageRatio: this.settings.shape === "shape" ? this.lastShapeOccupancyCoverageRatio : 0,
      shapeOccupancyCandidateMipLevel: this.settings.shape === "shape"
        ? this.lastShapeOccupancyCandidateMipLevel
        : -1,
      shapeOccupancyCandidateActiveCells: this.settings.shape === "shape"
        ? this.lastShapeOccupancyCandidateActiveCells
        : 0,
      shapeOccupancyCandidateCoverageRatio: this.settings.shape === "shape"
        ? this.lastShapeOccupancyCandidateCoverageRatio
        : 0,
      shapeOccupancyMaximumMip: SHAPE_OCCUPANCY_MAX_MIP,
      shapeOccupancyMinimumRadius: SHAPE_OCCUPANCY_MIN_RADIUS,
      shapeOccupancyMaximumCoverageRatio: SHAPE_OCCUPANCY_MAX_COVERAGE_RATIO,
      shapeOccupancyBitmaskBytes: SHAPE_OCCUPANCY_MAP_BYTES,
      shapeMaskResident: this.shapeResident,
      shapeStorageLifecycleStrategy: SHAPE_STORAGE_LIFECYCLE_STRATEGY,
      colorSeedStrategy: COLOR_SEED_STRATEGY,
      dirtyRectStrategy: DIRTY_RECT_STRATEGY,
      thicknessDynamicsStrategy: THICKNESS_DYNAMICS_STRATEGY,
      thicknessDynamicsTaperWindowMs: THICKNESS_TAPER_WINDOW_MS,
      thicknessDynamicsPreviewStrategy: THICKNESS_DYNAMICS_PREVIEW_STRATEGY,
      thicknessDynamicsPreviewTextureQuantum: THICKNESS_TAIL_TEXTURE_QUANTUM,
      thicknessDynamicsPreviewMaximumTextureDimension:
        THICKNESS_TAIL_MAXIMUM_TEXTURE_DIMENSION,
      presentationCacheStrategy: PRESENTATION_CACHE_STRATEGY,
      presentationTransferStrategy: PRESENTATION_TRANSFER_STRATEGY,
      paintDisplayPyramidStrategy: PAINT_DISPLAY_PYRAMID_STRATEGY,
      paintDisplayLodSelectionStrategy: PAINT_DISPLAY_LOD_SELECTION_STRATEGY,
      paintDisplayMipLevelCount: PAINT_DISPLAY_MIP_LEVEL_COUNT,
      paintDisplaySelectedMipLevel: this.paintDisplaySelectedMipLevel,
      paintDisplayPyramidAdditionalMemoryMiB:
        paintDisplayPyramidAdditionalMemoryMiB(this.layerFormat),
      brushOpacityStrategy: BRUSH_OPACITY_STRATEGY,
      grainStrategy: this.grainStrategy(this.settings),
      grainCoordinateStrategy: this.grainCoordinateStrategy(this.settings),
      grainSamplingStrategy: this.grainSamplingStrategy(this.settings),
      grainMipStrategy: GRAIN_MIP_STRATEGY,
      grainTextureFormat: "rgba8unorm",
      grainTextureWidth: GRAIN_TEXTURE_SIZE,
      grainTextureHeight: GRAIN_TEXTURE_SIZE,
      grainTextureMipLevelCount: GRAIN_TEXTURE_MIP_LEVEL_COUNT,
      grainTextureMemoryMiB: GRAIN_TEXTURE_PIXEL_COUNT * 4 / (1024 * 1024),
      grainTextureIdentity: this.grainTextureIdentity,
      grainPipelineStrategy: GRAIN_PIPELINE_STRATEGY,
      grainCoverageStrategy: this.isTexturizedGrainActive(this.settings)
        ? GRAIN_COVERAGE_STRATEGY
        : "none",
      grainAdaptivePreviewStrategy: this.isTexturizedGrainActive(this.settings)
        ? GRAIN_ADAPTIVE_PREVIEW_STRATEGY
        : "legacy",
      grainStartupDecodeMs: this.grainStartupDecodeMs,
      grainStartupMipBuildMs: this.grainStartupMipBuildMs,
      grainStartupUploadMs: this.grainStartupUploadMs,
      grainTextureResident: this.grainResident,
      grainStorageLifecycleStrategy: GRAIN_STORAGE_LIFECYCLE_STRATEGY,
      lightGlazeStrategy: lightGlazeStrategyForBlendMode(this.settings.blendMode),
      lightGlazeAdaptivePreviewStrategy: LIGHT_GLAZE_ADAPTIVE_PREVIEW_STRATEGY,
      lightGlazeStorageAllocated: this.lightGlazeStorageAllocated,
      lightGlazeStorageMode: this.lightGlazeStorageMode,
      lightGlazeAdditionalMemoryMiB: this.lightGlazeStorageAllocated
        ? lightGlazeAdditionalMemoryMiB(this.layerFormat, this.lightGlazeStorageMode)
        : 0,
      lightGlazeStorageLifecycleStrategy: LIGHT_GLAZE_STORAGE_LIFECYCLE_STRATEGY,
      adaptivePreviewStrategy: ADAPTIVE_PREVIEW_STRATEGY,
      adaptivePreviewTriggerStrategy: ADAPTIVE_PREVIEW_TRIGGER_STRATEGY,
      adaptivePreviewStaleFrameStrategy: ADAPTIVE_PREVIEW_STALE_FRAME_STRATEGY,
      adaptivePreviewVisibleCanvasStrategy: ADAPTIVE_PREVIEW_VISIBLE_CANVAS_STRATEGY,
      adaptivePreviewVisibleCanvasRequestedDesynchronized:
        this.adaptivePreviewVisibleCanvasRequestedDesynchronized,
      adaptivePreviewVisibleCanvasAlpha: this.adaptivePreviewVisibleContextAttributes.alpha,
      adaptivePreviewVisibleCanvasDesynchronized:
        this.adaptivePreviewVisibleContextAttributes.desynchronized,
      adaptivePreviewVisibleCanvasColorSpace:
        this.adaptivePreviewVisibleContextAttributes.colorSpace,
      adaptivePreviewScratchCanvasAlpha: this.adaptivePreviewScratchContextAttributes.alpha,
      adaptivePreviewScratchCanvasDesynchronized:
        this.adaptivePreviewScratchContextAttributes.desynchronized,
      adaptivePreviewScratchCanvasColorSpace:
        this.adaptivePreviewScratchContextAttributes.colorSpace,
      adaptivePreviewExactLinearScale: ADAPTIVE_PREVIEW_EXACT_LINEAR_SCALE,
      adaptivePreviewJsBudgetMs: ADAPTIVE_PREVIEW_JS_BUDGET_MS,
      adaptivePreviewMaxTipBaseStamps: ADAPTIVE_PREVIEW_MAX_TIP_BASE_STAMPS,
      adaptivePreviewMaxPatchCssPixels: ADAPTIVE_PREVIEW_MAX_PATCH_CSS_PIXELS,
      adaptivePreviewProbeIntervalSubmissions: ADAPTIVE_PREVIEW_PROBE_INTERVAL_SUBMISSIONS,
      adaptivePreviewTriggerThresholdMs: ADAPTIVE_PREVIEW_TRIGGER_THRESHOLD_MS,
      adaptivePreviewSlowCompletionThresholdMs: ADAPTIVE_PREVIEW_SLOW_COMPLETION_THRESHOLD_MS,
      adaptivePreviewTriggerConsecutiveProbes: ADAPTIVE_PREVIEW_TRIGGER_CONSECUTIVE_PROBES,
      adaptivePreviewProbeNearMissMinimumMs: ADAPTIVE_PREVIEW_PROBE_NEAR_MISS_MINIMUM_MS,
      adaptiveSpacingStrategy: ADAPTIVE_SPACING_STRATEGY,
      adaptiveSpacingStepPercentPoints: ADAPTIVE_SPACING_STEP_PERCENT_POINTS,
      adaptiveSpacingMaxExtraPercentPoints: this.adaptiveSpacingMaxExtraPercentPoints,
      historyStorageStrategy: HISTORY_STORAGE_STRATEGY,
      historyReplayStrategy: HISTORY_REPLAY_STRATEGY,
      historyStampRetentionStrategy: HISTORY_STAMP_RETENTION_STRATEGY,
    };
  }

  private async createStaticResources(): Promise<void> {
    this.brushUniformBuffer = this.device.createBuffer({
      label: "Brush uniforms",
      size: BRUSH_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.thicknessTailBrushUniformBuffer = this.device.createBuffer({
      label: "Predictive thickness tail brush uniforms",
      size: BRUSH_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.grainUniformBuffer = this.device.createBuffer({
      label: "Texturized grain uniforms",
      size: GRAIN_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.displayUniformBuffer = this.device.createBuffer({
      label: "Display uniforms",
      size: DISPLAY_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.vectorTextCaptureUniformBuffer = this.device.createBuffer({
      label: "Adaptive vector text capture view uniforms",
      size: VECTOR_TEXT_CAPTURE_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.layerCompositeUniformBuffer = this.device.createBuffer({
      label: "Layer composite opacity",
      size: LAYER_COMPOSITE_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.thicknessTailDisplayUniformBuffer = this.device.createBuffer({
      label: "Predictive thickness tail display uniforms",
      size: THICKNESS_TAIL_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.lightGlazeUniformBuffer = this.device.createBuffer({
      label: "Light Glaze stroke opacity",
      size: LIGHT_GLAZE_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.instanceBuffer = this.device.createBuffer({
      label: "Stamp instance storage",
      size: MAX_STAMPS_PER_BATCH * STAMP_STRIDE_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this.thicknessTailInstanceBuffer = this.device.createBuffer({
      label: "Predictive thickness tail instance storage",
      size: MAX_STAMPS_PER_BATCH * STAMP_STRIDE_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this.sampler = this.device.createSampler({
      label: "Layer linear sampler",
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "nearest",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });

    this.shapeMaskSampler = this.device.createSampler({
      label: "Shape 2K mask sampler",
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    const createGrainSamplerSet = (
      mode: "fixed" | "moving",
      addressMode: GPUAddressMode,
    ): Record<GrainFiltering, GPUSampler> => ({
      no: this.device.createSampler({
        label: `Cotton Fleece M1 ${mode} no filtering`,
        magFilter: "nearest",
        minFilter: "nearest",
        // A linear mip declaration makes this sampler valid for the common
        // filtering binding. WGSL supplies a rounded integer LOD, so the
        // effective mip and texel choices both remain nearest.
        mipmapFilter: "linear",
        addressModeU: addressMode,
        addressModeV: addressMode,
      }),
      classic: this.device.createSampler({
        label: `Cotton Fleece M1 ${mode} classic filtering`,
        magFilter: "linear",
        minFilter: "linear",
        mipmapFilter: "nearest",
        addressModeU: addressMode,
        addressModeV: addressMode,
      }),
      improved: this.device.createSampler({
        label: `Cotton Fleece M1 ${mode} improved filtering`,
        magFilter: "linear",
        minFilter: "linear",
        mipmapFilter: "linear",
        addressModeU: addressMode,
        addressModeV: addressMode,
      }),
    });
    this.grainSamplers = {
      fixed: createGrainSamplerSet("fixed", "repeat"),
      moving: createGrainSamplerSet("moving", "clamp-to-edge"),
    };
    // Il Grain M1 non viene più caricato allo startup: la texture vera arriva
    // con ensureGrainResources alla selezione di un grain mode. Il placeholder
    // bianco (identità del multiply) mantiene validi tutti i bind group.
    this.grainPlaceholderTexture = this.device.createTexture({
      label: "Grain placeholder 1×1 while released",
      size: { width: 1, height: 1, depthOrArrayLayers: 1 },
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.device.queue.writeTexture(
      { texture: this.grainPlaceholderTexture },
      new Uint8Array([255, 255, 255, 255]),
      { bytesPerRow: 256, rowsPerImage: 1 },
      { width: 1, height: 1, depthOrArrayLayers: 1 },
    );
    this.grainPlaceholderView = this.grainPlaceholderTexture.createView({
      label: "Grain placeholder view",
    });
    this.grainTextureView = this.grainPlaceholderView;
    // La Shape 2K non viene più caricata allo startup: la maschera vera
    // arriva con ensureShapeResources alla selezione della Shape. Il
    // placeholder 1×1 bianco tiene validi i bind group; le mappe di
    // occupazione restano a zero finché la decodifica non le riempie (mai
    // consultate vuote: i tratti Shape senza maschera vengono rifiutati).
    this.shapeMaskPlaceholderTexture = this.device.createTexture({
      label: "Shape placeholder 1×1 while released",
      size: { width: 1, height: 1, depthOrArrayLayers: 1 },
      format: "r8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.device.queue.writeTexture(
      { texture: this.shapeMaskPlaceholderTexture },
      new Uint8Array(256).fill(255),
      { bytesPerRow: 256, rowsPerImage: 1 },
      { width: 1, height: 1, depthOrArrayLayers: 1 },
    );
    this.shapeMaskPlaceholderView = this.shapeMaskPlaceholderTexture.createView({
      label: "Shape placeholder view",
    });
    this.shapeMaskView = this.shapeMaskPlaceholderView;
    this.shapeOccupancyUniformBuffers = Array.from(
      { length: SHAPE_OCCUPANCY_MAP_COUNT },
      (_, mipLevel) => this.device.createBuffer({
        label: `Shape conservative occupancy bitmask mip ${mipLevel}`,
        size: SHAPE_OCCUPANCY_MAP_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
    );

    const brushLayoutEntries: GPUBindGroupLayoutEntry[] = [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float", viewDimension: "2d" },
      },
      {
        binding: 3,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: { type: "filtering" },
      },
    ];
    this.brushBindGroupLayout = this.device.createBindGroupLayout({
      label: "Brush legacy bind group layout",
      entries: brushLayoutEntries,
    });
    this.brushOccupancyBindGroupLayout = this.device.createBindGroupLayout({
      label: "Brush occupancy bind group layout",
      entries: [
        ...brushLayoutEntries,
        {
          binding: 4,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
      ],
    });

    this.displayBindGroupLayout = this.device.createBindGroupLayout({
      label: "Three-surface layer display bind group layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      ],
    });
    this.rasterStrokeDisplayScreenBindGroupLayout = this.device.createBindGroupLayout({
      label: "Traccia display screen bind group layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      ],
    });
    this.rasterStrokeDisplaySourceBindGroupLayout = this.device.createBindGroupLayout({
      label: "Traccia direct LOD 0 and coarse mip display source layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        {
          binding: 5,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "read-only-storage" },
        },
        { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 7, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        {
          binding: 8,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "unfilterable-float" },
        },
        {
          binding: 9,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "unfilterable-float" },
        },
        {
          binding: 10,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
        {
          binding: 11,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 12,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
        {
          binding: 13,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 14,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
        { binding: 15, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 16, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      ],
    });
    this.lightGlazeDisplayBindGroupLayout = this.device.createBindGroupLayout({
      label: "Light Glaze live display bind group layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float", viewDimension: "2d" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float", viewDimension: "2d" },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: "filtering" },
        },
        {
          binding: 4,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
        {
          binding: 5,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float", viewDimension: "2d" },
        },
        { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 7, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 8, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 9, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      ],
    });
    this.thicknessTailDisplayBindGroupLayout = this.device.createBindGroupLayout({
      label: "Predictive thickness tail display bind group layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float", viewDimension: "2d" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: "filtering" },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float", viewDimension: "2d" },
        },
        {
          binding: 4,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 7, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 8, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 9, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      ],
    });
    const grainLayoutEntries: GPUBindGroupLayoutEntry[] = [
      ...brushLayoutEntries,
      {
        binding: 5,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float", viewDimension: "2d" },
      },
      {
        binding: 6,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: { type: "filtering" },
      },
      {
        binding: 7,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
    ];
    this.grainBrushBindGroupLayout = this.device.createBindGroupLayout({
      label: "Texturized grain brush bind group layout",
      entries: grainLayoutEntries,
    });
    this.grainBrushOccupancyBindGroupLayout = this.device.createBindGroupLayout({
      label: "Texturized grain occupancy brush bind group layout",
      entries: [
        ...grainLayoutEntries,
        {
          binding: 4,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
      ],
    });
    this.lightGlazeCompositeMipBindGroupLayout = this.device.createBindGroupLayout({
      label: "Light Glaze composited mip 1 bind group layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float", viewDimension: "2d" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float", viewDimension: "2d" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
      ],
    });
    this.lightGlazeCompositeBindGroupLayout = this.device.createBindGroupLayout({
      label: "Light Glaze final composite bind group layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float", viewDimension: "2d" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
      ],
    });
    this.paintMipDownsampleBindGroupLayout = this.device.createBindGroupLayout({
      label: "Paint display mip downsample bind group layout",
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float", viewDimension: "2d" },
      }],
    });
    this.layerCompositeBindGroupLayout = this.device.createBindGroupLayout({
      label: "Layer source-over fold bind group layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ],
    });

    this.rebuildShapeBrushBindGroups();
    this.rebuildGrainBrushBindGroups();
    await this.finishStaticResourceCreation();
  }

  // I gruppi base del pennello (Paint e coda spessore, con e senza occupancy)
  // legano la maschera Shape: vanno ricostruiti a ogni load/release. I gruppi
  // grain la legano anch'essi e vengono ricostruiti dal chiamante.
  private rebuildShapeBrushBindGroups(): void {
    this.brushBindGroup = this.device.createBindGroup({
      label: "Brush legacy bind group",
      layout: this.brushBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.brushUniformBuffer } },
        { binding: 1, resource: { buffer: this.instanceBuffer } },
        { binding: 2, resource: this.shapeMaskView },
        { binding: 3, resource: this.shapeMaskSampler },
      ],
    });
    this.brushOccupancyBindGroups = this.shapeOccupancyUniformBuffers.map(
      (buffer, mipLevel) => this.device.createBindGroup({
        label: `Brush occupancy bind group mip ${mipLevel}`,
        layout: this.brushOccupancyBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.brushUniformBuffer } },
          { binding: 1, resource: { buffer: this.instanceBuffer } },
          { binding: 2, resource: this.shapeMaskView },
          { binding: 3, resource: this.shapeMaskSampler },
          { binding: 4, resource: { buffer } },
        ],
      }),
    );
    this.thicknessTailBrushBindGroup = this.device.createBindGroup({
      label: "Predictive thickness tail brush legacy bind group",
      layout: this.brushBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.thicknessTailBrushUniformBuffer } },
        { binding: 1, resource: { buffer: this.thicknessTailInstanceBuffer } },
        { binding: 2, resource: this.shapeMaskView },
        { binding: 3, resource: this.shapeMaskSampler },
      ],
    });
    this.thicknessTailBrushOccupancyBindGroups = this.shapeOccupancyUniformBuffers.map(
      (buffer, mipLevel) => this.device.createBindGroup({
        label: `Predictive thickness tail brush occupancy bind group mip ${mipLevel}`,
        layout: this.brushOccupancyBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.thicknessTailBrushUniformBuffer } },
          { binding: 1, resource: { buffer: this.thicknessTailInstanceBuffer } },
          { binding: 2, resource: this.shapeMaskView },
          { binding: 3, resource: this.shapeMaskSampler },
          { binding: 4, resource: { buffer } },
        ],
      }),
    );
  }

  // I quattro gruppi di bind dipendono dalla view grain corrente (placeholder
  // o M1 residente): vanno ricostruiti a ogni load/release della texture.
  private rebuildGrainBrushBindGroups(): void {
    const grainFilteringModes: GrainFiltering[] = ["no", "classic", "improved"];
    const grainCoordinateModes = ["fixed", "moving"] as const;
    this.grainBrushBindGroups = Object.fromEntries(
      grainCoordinateModes.map((mode) => [
        mode,
        Object.fromEntries(
          grainFilteringModes.map((filtering) => [
            filtering,
            this.device.createBindGroup({
              label: `Texturized M1 ${mode} brush bind group ${filtering}`,
              layout: this.grainBrushBindGroupLayout,
              entries: [
                { binding: 0, resource: { buffer: this.brushUniformBuffer } },
                { binding: 1, resource: { buffer: this.instanceBuffer } },
                { binding: 2, resource: this.shapeMaskView },
                { binding: 3, resource: this.shapeMaskSampler },
                { binding: 5, resource: this.grainTextureView },
                { binding: 6, resource: this.grainSamplers[mode][filtering] },
                { binding: 7, resource: { buffer: this.grainUniformBuffer } },
              ],
            }),
          ]),
        ) as Record<GrainFiltering, GPUBindGroup>,
      ]),
    ) as Record<"fixed" | "moving", Record<GrainFiltering, GPUBindGroup>>;
    this.grainBrushOccupancyBindGroups = Object.fromEntries(
      grainCoordinateModes.map((mode) => [
        mode,
        Object.fromEntries(
          grainFilteringModes.map((filtering) => [
            filtering,
            this.shapeOccupancyUniformBuffers.map((buffer, mipLevel) => this.device.createBindGroup({
              label: `Texturized M1 ${mode} occupancy bind group ${filtering} mip ${mipLevel}`,
              layout: this.grainBrushOccupancyBindGroupLayout,
              entries: [
                { binding: 0, resource: { buffer: this.brushUniformBuffer } },
                { binding: 1, resource: { buffer: this.instanceBuffer } },
                { binding: 2, resource: this.shapeMaskView },
                { binding: 3, resource: this.shapeMaskSampler },
                { binding: 4, resource: { buffer } },
                { binding: 5, resource: this.grainTextureView },
                { binding: 6, resource: this.grainSamplers[mode][filtering] },
                { binding: 7, resource: { buffer: this.grainUniformBuffer } },
              ],
            })),
          ]),
        ) as Record<GrainFiltering, GPUBindGroup[]>,
      ]),
    ) as Record<"fixed" | "moving", Record<GrainFiltering, GPUBindGroup[]>>;
    this.thicknessTailGrainBrushBindGroups = Object.fromEntries(
      grainCoordinateModes.map((mode) => [
        mode,
        Object.fromEntries(
          grainFilteringModes.map((filtering) => [
            filtering,
            this.device.createBindGroup({
              label: `Predictive thickness tail ${mode} grain bind group ${filtering}`,
              layout: this.grainBrushBindGroupLayout,
              entries: [
                { binding: 0, resource: { buffer: this.thicknessTailBrushUniformBuffer } },
                { binding: 1, resource: { buffer: this.thicknessTailInstanceBuffer } },
                { binding: 2, resource: this.shapeMaskView },
                { binding: 3, resource: this.shapeMaskSampler },
                { binding: 5, resource: this.grainTextureView },
                { binding: 6, resource: this.grainSamplers[mode][filtering] },
                { binding: 7, resource: { buffer: this.grainUniformBuffer } },
              ],
            }),
          ]),
        ) as Record<GrainFiltering, GPUBindGroup>,
      ]),
    ) as Record<"fixed" | "moving", Record<GrainFiltering, GPUBindGroup>>;
    this.thicknessTailGrainBrushOccupancyBindGroups = Object.fromEntries(
      grainCoordinateModes.map((mode) => [
        mode,
        Object.fromEntries(
          grainFilteringModes.map((filtering) => [
            filtering,
            this.shapeOccupancyUniformBuffers.map((buffer, mipLevel) =>
              this.device.createBindGroup({
                label:
                  `Predictive thickness tail ${mode} grain occupancy ${filtering} mip ${mipLevel}`,
                layout: this.grainBrushOccupancyBindGroupLayout,
                entries: [
                  { binding: 0, resource: { buffer: this.thicknessTailBrushUniformBuffer } },
                  { binding: 1, resource: { buffer: this.thicknessTailInstanceBuffer } },
                  { binding: 2, resource: this.shapeMaskView },
                  { binding: 3, resource: this.shapeMaskSampler },
                  { binding: 4, resource: { buffer } },
                  { binding: 5, resource: this.grainTextureView },
                  { binding: 6, resource: this.grainSamplers[mode][filtering] },
                  { binding: 7, resource: { buffer: this.grainUniformBuffer } },
                ],
              }),
            ),
          ]),
        ) as Record<GrainFiltering, GPUBindGroup[]>,
      ]),
    ) as Record<"fixed" | "moving", Record<GrainFiltering, GPUBindGroup[]>>;
  }

  private async finishStaticResourceCreation(): Promise<void> {
    this.brushShaderModule = this.device.createShaderModule({ label: "Brush WGSL", code: brushShader });
    this.texturizedGrainShaderModule = this.device.createShaderModule({
      label: "Texturized grain fragment WGSL",
      code: texturizedGrainShader,
    });
    this.displayShaderModule = this.device.createShaderModule({ label: "Display WGSL", code: displayShader });
    this.rasterStrokeDisplayShaderModule = this.device.createShaderModule({
      label: "Traccia direct LOD 0 and coarse mip display WGSL",
      code: rasterStrokeDisplayShader(
        LAYER_SIZE,
        LAYER_SIZE,
        this.bevelBoundingFieldEnabled,
      ),
    });
    this.thicknessTailDisplayShaderModule = this.device.createShaderModule({
      label: "Predictive thickness tail display WGSL",
      code: thicknessTailDisplayShader,
    });
    this.lightGlazeDisplayShaderModule = this.device.createShaderModule({
      label: "Light Glaze live display WGSL",
      code: lightGlazeDisplayShader,
    });
    this.lightGlazeCompositeMipShaderModule = this.device.createShaderModule({
      label: "Light Glaze composited mip 1 WGSL",
      code: lightGlazeCompositeMipShader,
    });
    this.lightGlazeCompositeShaderModule = this.device.createShaderModule({
      label: "Light Glaze final composite WGSL",
      code: lightGlazeCompositeShader,
    });
    this.paintMipDownsampleShaderModule = this.device.createShaderModule({
      label: "Paint display mip downsample WGSL",
      code: paintMipDownsampleShader,
    });
    this.layerCompositeShaderModule = this.device.createShaderModule({
      label: "Layer source-over fold WGSL",
      code: layerCompositeShader,
    });
    await Promise.all([
      this.assertShaderCompiled(this.brushShaderModule, "brush"),
      this.assertShaderCompiled(this.texturizedGrainShaderModule, "Texturized grain fragment"),
      this.assertShaderCompiled(this.displayShaderModule, "display"),
      this.assertShaderCompiled(this.rasterStrokeDisplayShaderModule, "Traccia display"),
      this.assertShaderCompiled(
        this.thicknessTailDisplayShaderModule,
        "predictive thickness tail display",
      ),
      this.assertShaderCompiled(this.lightGlazeDisplayShaderModule, "Light Glaze live display"),
      this.assertShaderCompiled(
        this.lightGlazeCompositeMipShaderModule,
        "Light Glaze composited mip 1",
      ),
      this.assertShaderCompiled(this.lightGlazeCompositeShaderModule, "Light Glaze final composite"),
      this.assertShaderCompiled(this.paintMipDownsampleShaderModule, "paint display mip downsample"),
      this.assertShaderCompiled(this.layerCompositeShaderModule, "layer source-over fold"),
    ]);

    const displayPipelineLayout = this.device.createPipelineLayout({
      label: "Display pipeline layout",
      bindGroupLayouts: [this.displayBindGroupLayout],
    });

    this.displayPipeline = this.device.createRenderPipeline({
      label: "Display pipeline",
      layout: displayPipelineLayout,
      vertex: {
        module: this.displayShaderModule,
        entryPoint: "vertexMain",
      },
      fragment: {
        module: this.displayShaderModule,
        entryPoint: "fragmentMain",
        targets: [{ format: this.canvasFormat }],
      },
      primitive: { topology: "triangle-list" },
    });

    if (this.vectorTextPrototypeEnabled) {
      this.vectorTextDisplayShaderModule = this.device.createShaderModule({
        label: "Dual viewport vector text mixed-layer display WGSL",
        code: vectorTextDisplayShader,
      });
      this.mixedSceneRasterSegmentShaderModule = this.device.createShaderModule({
        label: "Mixed scene raster segment WGSL",
        code: mixedSceneRasterSegmentShader,
      });
      this.mixedSceneTextSegmentShaderModule = this.device.createShaderModule({
        label: "Mixed scene text segment WGSL",
        code: mixedSceneTextSegmentShader,
      });
      this.mixedSceneClearShaderModule = this.device.createShaderModule({
        label: "Mixed scene partial clear WGSL",
        code: mixedSceneClearShader,
      });
      this.mixedScenePresentShaderModule = this.device.createShaderModule({
        label: "Mixed scene checker presentation WGSL",
        code: mixedScenePresentShader,
      });
      await Promise.all([
        this.assertShaderCompiled(
          this.vectorTextDisplayShaderModule,
          "dual viewport vector text mixed-layer display",
        ),
        this.assertShaderCompiled(
          this.mixedSceneRasterSegmentShaderModule,
          "mixed scene raster segment",
        ),
        this.assertShaderCompiled(
          this.mixedSceneTextSegmentShaderModule,
          "mixed scene text segment",
        ),
        this.assertShaderCompiled(this.mixedSceneClearShaderModule, "mixed scene partial clear"),
        this.assertShaderCompiled(
          this.mixedScenePresentShaderModule,
          "mixed scene checker presentation",
        ),
      ]);
      await this.initializeVectorTextGpuRenderer();
      this.vectorTextDisplayBindGroupLayout = this.device.createBindGroupLayout({
        label: "Dual viewport vector text mixed-layer display bind group layout",
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
          { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
          { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
          { binding: 5, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
          { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
          { binding: 7, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        ],
      });
      this.mixedSceneRasterSegmentBindGroupLayout = this.device.createBindGroupLayout({
        label: "Mixed scene raster segment bind group layout",
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
          { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        ],
      });
      this.mixedSceneTextSegmentBindGroupLayout = this.device.createBindGroupLayout({
        label: "Mixed scene text segment bind group layout",
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
          { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        ],
      });
      this.mixedScenePresentBindGroupLayout = this.device.createBindGroupLayout({
        label: "Mixed scene presentation bind group layout",
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        ],
      });
      const vectorTextPipelineLayout = this.device.createPipelineLayout({
        label: "Dual viewport vector text mixed-layer display pipeline layout",
        bindGroupLayouts: [this.vectorTextDisplayBindGroupLayout],
      });
      this.vectorTextDisplayPipeline = this.device.createRenderPipeline({
        label: "Dual viewport vector text mixed-layer display pipeline",
        layout: vectorTextPipelineLayout,
        vertex: {
          module: this.vectorTextDisplayShaderModule,
          entryPoint: "vertexMain",
        },
        fragment: {
          module: this.vectorTextDisplayShaderModule,
          entryPoint: "fragmentMain",
          targets: [{ format: this.canvasFormat }],
        },
        primitive: { topology: "triangle-list" },
      });
      this.vectorTextGpuBlurFilterUniformBuffer = this.device.createBuffer({
      label: `Vector text GPU blur filter uniforms ${VECTOR_TEXT_GPU_MAXIMUM_DRAWS}`,
      size: VECTOR_TEXT_GPU_MAXIMUM_DRAWS * VECTOR_TEXT_GPU_UNIFORM_STRIDE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.vectorTextGpuBlurSampler = this.device.createSampler({
      label: "Vector text GPU blur linear clamp sampler",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
      magFilter: "linear",
      minFilter: "linear",
    });

    const sourceOverBlend: GPUBlendState = {
        color: {
          srcFactor: "one",
          dstFactor: "one-minus-src-alpha",
          operation: "add",
        },
        alpha: {
          srcFactor: "one",
          dstFactor: "one-minus-src-alpha",
          operation: "add",
        },
      };
      const mixedRasterPipelineLayout = this.device.createPipelineLayout({
        label: "Mixed scene raster segment pipeline layout",
        bindGroupLayouts: [this.mixedSceneRasterSegmentBindGroupLayout],
      });
      this.mixedSceneRasterSegmentPipeline = this.device.createRenderPipeline({
        label: "Mixed scene raster segment source-over pipeline",
        layout: mixedRasterPipelineLayout,
        vertex: { module: this.mixedSceneRasterSegmentShaderModule, entryPoint: "vertexMain" },
        fragment: {
          module: this.mixedSceneRasterSegmentShaderModule,
          entryPoint: "fragmentMain",
          targets: [{ format: MIXED_SCENE_LINEAR_FORMAT, blend: sourceOverBlend }],
        },
        primitive: { topology: "triangle-list" },
      });
      const mixedTextPipelineLayout = this.device.createPipelineLayout({
        label: "Mixed scene text segment pipeline layout",
        bindGroupLayouts: [this.mixedSceneTextSegmentBindGroupLayout],
      });
      this.mixedSceneTextSegmentPipeline = this.device.createRenderPipeline({
        label: "Mixed scene text segment source-over pipeline",
        layout: mixedTextPipelineLayout,
        vertex: { module: this.mixedSceneTextSegmentShaderModule, entryPoint: "vertexMain" },
        fragment: {
          module: this.mixedSceneTextSegmentShaderModule,
          entryPoint: "fragmentMain",
          targets: [{ format: MIXED_SCENE_LINEAR_FORMAT, blend: sourceOverBlend }],
        },
        primitive: { topology: "triangle-list" },
      });
      this.mixedSceneClearPipeline = this.device.createRenderPipeline({
        label: "Mixed scene partial transparent clear pipeline",
        layout: this.device.createPipelineLayout({
          label: "Mixed scene partial transparent clear pipeline layout",
          bindGroupLayouts: [],
        }),
        vertex: { module: this.mixedSceneClearShaderModule, entryPoint: "vertexMain" },
        fragment: {
          module: this.mixedSceneClearShaderModule,
          entryPoint: "fragmentMain",
          targets: [{ format: MIXED_SCENE_LINEAR_FORMAT }],
        },
        primitive: { topology: "triangle-list" },
      });
      this.mixedScenePresentPipeline = this.device.createRenderPipeline({
        label: "Mixed scene checker presentation pipeline",
        layout: this.device.createPipelineLayout({
          label: "Mixed scene checker presentation pipeline layout",
          bindGroupLayouts: [this.mixedScenePresentBindGroupLayout],
        }),
        vertex: { module: this.mixedScenePresentShaderModule, entryPoint: "vertexMain" },
        fragment: {
          module: this.mixedScenePresentShaderModule,
          entryPoint: "fragmentMain",
          targets: [{ format: this.canvasFormat }],
        },
        primitive: { topology: "triangle-list" },
      });
      this.mixedSceneActiveDisplayPipeline = this.device.createRenderPipeline({
        label: "Mixed scene active base layer source-over pipeline",
        layout: displayPipelineLayout,
        vertex: { module: this.displayShaderModule, entryPoint: "vertexMain" },
        fragment: {
          module: this.displayShaderModule,
          entryPoint: "activeFragmentMain",
          targets: [{ format: MIXED_SCENE_LINEAR_FORMAT, blend: sourceOverBlend }],
        },
        primitive: { topology: "triangle-list" },
      });
    }
    const rasterStrokeDisplayPipelineLayout = this.device.createPipelineLayout({
      label: "Traccia display pipeline layout",
      bindGroupLayouts: [
        this.rasterStrokeDisplayScreenBindGroupLayout,
        this.rasterStrokeDisplaySourceBindGroupLayout,
      ],
    });
    this.rasterStrokeDisplayPipeline = this.device.createRenderPipeline({
      label: "Traccia direct LOD 0 and coarse mip display pipeline",
      layout: rasterStrokeDisplayPipelineLayout,
      vertex: {
        module: this.rasterStrokeDisplayShaderModule,
        entryPoint: "vertexMain",
      },
      fragment: {
        module: this.rasterStrokeDisplayShaderModule,
        entryPoint: "fragmentMain",
        targets: [{ format: this.canvasFormat }],
      },
      primitive: { topology: "triangle-list" },
    });
    if (this.vectorTextPrototypeEnabled) {
      this.mixedSceneActiveRasterStrokeDisplayPipeline = this.device.createRenderPipeline({
        label: "Mixed scene active Traccia/effects source-over pipeline",
        layout: rasterStrokeDisplayPipelineLayout,
        vertex: { module: this.rasterStrokeDisplayShaderModule, entryPoint: "vertexMain" },
        fragment: {
          module: this.rasterStrokeDisplayShaderModule,
          entryPoint: "activeFragmentMain",
          targets: [{
            format: MIXED_SCENE_LINEAR_FORMAT,
            blend: {
              color: {
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
              },
              alpha: {
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
              },
            },
          }],
        },
        primitive: { topology: "triangle-list" },
      });
    }

    const thicknessTailDisplayPipelineLayout = this.device.createPipelineLayout({
      label: "Predictive thickness tail display pipeline layout",
      bindGroupLayouts: [this.thicknessTailDisplayBindGroupLayout],
    });
    this.thicknessTailDisplayPipeline = this.device.createRenderPipeline({
      label: "Predictive thickness tail display pipeline",
      layout: thicknessTailDisplayPipelineLayout,
      vertex: {
        module: this.thicknessTailDisplayShaderModule,
        entryPoint: "vertexMain",
      },
      fragment: {
        module: this.thicknessTailDisplayShaderModule,
        entryPoint: "fragmentMain",
        targets: [{ format: this.canvasFormat }],
      },
      primitive: { topology: "triangle-list" },
    });
    if (this.vectorTextPrototypeEnabled) {
      this.mixedSceneActiveThicknessTailDisplayPipeline = this.device.createRenderPipeline({
        label: "Mixed scene active thickness tail source-over pipeline",
        layout: thicknessTailDisplayPipelineLayout,
        vertex: { module: this.thicknessTailDisplayShaderModule, entryPoint: "vertexMain" },
        fragment: {
          module: this.thicknessTailDisplayShaderModule,
          entryPoint: "activeFragmentMain",
          targets: [{
            format: MIXED_SCENE_LINEAR_FORMAT,
            blend: {
              color: {
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
              },
              alpha: {
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
              },
            },
          }],
        },
        primitive: { topology: "triangle-list" },
      });
    }

    const lightGlazeDisplayPipelineLayout = this.device.createPipelineLayout({
      label: "Light Glaze live display pipeline layout",
      bindGroupLayouts: [this.lightGlazeDisplayBindGroupLayout],
    });
    this.lightGlazeDisplayPipeline = this.device.createRenderPipeline({
      label: "Light Glaze live display pipeline",
      layout: lightGlazeDisplayPipelineLayout,
      vertex: {
        module: this.lightGlazeDisplayShaderModule,
        entryPoint: "vertexMain",
      },
      fragment: {
        module: this.lightGlazeDisplayShaderModule,
        entryPoint: "fragmentMain",
        targets: [{ format: this.canvasFormat }],
      },
      primitive: { topology: "triangle-list" },
    });
    if (this.vectorTextPrototypeEnabled) {
      this.mixedSceneActiveLightGlazeDisplayPipeline = this.device.createRenderPipeline({
        label: "Mixed scene active Light Glaze source-over pipeline",
        layout: lightGlazeDisplayPipelineLayout,
        vertex: { module: this.lightGlazeDisplayShaderModule, entryPoint: "vertexMain" },
        fragment: {
          module: this.lightGlazeDisplayShaderModule,
          entryPoint: "activeFragmentMain",
          targets: [{
            format: MIXED_SCENE_LINEAR_FORMAT,
            blend: {
              color: {
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
              },
              alpha: {
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
              },
            },
          }],
        },
        primitive: { topology: "triangle-list" },
      });
    }
  }

  private async createGrainTextureResources(): Promise<GrainTextureResources> {
    const response = await fetch(new URL("../graincottonfleece.PNG", import.meta.url));
    if (!response.ok) {
      throw new Error(`Impossibile caricare Cotton Fleece M1 originale (${response.status}).`);
    }

    const source = await response.arrayBuffer();
    const decodeStart = performance.now();
    // Match the M1 path: let the browser decode the original RGBA PNG,
    // including its embedded color profile, without premultiplying alpha.
    const bitmap = await createImageBitmap(new Blob([source], { type: "image/png" }), {
      colorSpaceConversion: "default",
      premultiplyAlpha: "none",
    });
    const decodeMs = performance.now() - decodeStart;
    if (bitmap.width !== GRAIN_TEXTURE_SIZE || bitmap.height !== GRAIN_TEXTURE_SIZE) {
      bitmap.close();
      throw new Error(
        `Il grain M1 originale deve restare ${GRAIN_TEXTURE_SIZE}×${GRAIN_TEXTURE_SIZE}px; `
        + `trovata ${bitmap.width}×${bitmap.height}px.`,
      );
    }

    const texture = this.device.createTexture({
      label: "Cotton Fleece M1 original 2500 RGBA grain",
      size: {
        width: GRAIN_TEXTURE_SIZE,
        height: GRAIN_TEXTURE_SIZE,
        depthOrArrayLayers: 1,
      },
      mipLevelCount: GRAIN_TEXTURE_MIP_LEVEL_COUNT,
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING
        | GPUTextureUsage.COPY_DST
        | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    const uploadStart = performance.now();
    this.device.queue.copyExternalImageToTexture(
      { source: bitmap },
      { texture, mipLevel: 0, premultipliedAlpha: false, colorSpace: "srgb" },
      {
        width: GRAIN_TEXTURE_SIZE,
        height: GRAIN_TEXTURE_SIZE,
        depthOrArrayLayers: 1,
      },
    );
    const uploadMs = performance.now() - uploadStart;
    bitmap.close();

    const mipBuildStart = performance.now();
    const mipShaderModule = this.device.createShaderModule({
      label: "Cotton Fleece M1 mip generation WGSL",
      code: grainMipShader,
    });
    await this.assertShaderCompiled(mipShaderModule, "Cotton Fleece M1 mip generation");
    const mipBindGroupLayout = this.device.createBindGroupLayout({
      label: "Cotton Fleece M1 mip generation bind group layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float", viewDimension: "2d" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: "filtering" },
        },
      ],
    });
    const mipPipeline = this.device.createRenderPipeline({
      label: "Cotton Fleece M1 mip generation pipeline",
      layout: this.device.createPipelineLayout({
        label: "Cotton Fleece M1 mip generation pipeline layout",
        bindGroupLayouts: [mipBindGroupLayout],
      }),
      vertex: { module: mipShaderModule, entryPoint: "vertexMain" },
      fragment: {
        module: mipShaderModule,
        entryPoint: "fragmentMain",
        targets: [{ format: "rgba8unorm" }],
      },
      primitive: { topology: "triangle-list" },
    });
    const mipSampler = this.device.createSampler({
      label: "Cotton Fleece M1 mip generation linear sampler",
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "nearest",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    const encoder = this.device.createCommandEncoder({
      label: "Cotton Fleece M1 full mip chain encoder",
    });
    for (let mipLevel = 1; mipLevel < GRAIN_TEXTURE_MIP_LEVEL_COUNT; mipLevel += 1) {
      const sourceView = texture.createView({
        label: `Cotton Fleece M1 mip ${mipLevel - 1} source`,
        baseMipLevel: mipLevel - 1,
        mipLevelCount: 1,
      });
      const targetView = texture.createView({
        label: `Cotton Fleece M1 mip ${mipLevel} target`,
        baseMipLevel: mipLevel,
        mipLevelCount: 1,
      });
      const bindGroup = this.device.createBindGroup({
        label: `Cotton Fleece M1 mip ${mipLevel} bind group`,
        layout: mipBindGroupLayout,
        entries: [
          { binding: 0, resource: sourceView },
          { binding: 1, resource: mipSampler },
        ],
      });
      const pass = encoder.beginRenderPass({
        label: `Cotton Fleece M1 build mip ${mipLevel}`,
        colorAttachments: [
          {
            view: targetView,
            loadOp: "clear",
            storeOp: "store",
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          },
        ],
      });
      pass.setPipeline(mipPipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3, 1, 0, 0);
      pass.end();
    }
    this.device.queue.submit([encoder.finish()]);
    await this.device.queue.onSubmittedWorkDone();
    const mipBuildMs = performance.now() - mipBuildStart;

    return {
      texture,
      identity: hashBytes(new Uint8Array(source)),
      decodeMs,
      mipBuildMs,
      uploadMs,
    };
  }

  private async decodeShapeMaskWithCanvas(source: ArrayBuffer): Promise<Uint8Array> {
    const bitmap = await createImageBitmap(new Blob([source], { type: "image/png" }), {
      colorSpaceConversion: "none",
      premultiplyAlpha: "none",
    });

    try {
      if (bitmap.width !== SHAPE_MASK_SIZE || bitmap.height !== SHAPE_MASK_SIZE) {
        throw new Error(
          `Shape.png deve restare ${SHAPE_MASK_SIZE}×${SHAPE_MASK_SIZE}px; trovata ${bitmap.width}×${bitmap.height}px.`,
        );
      }

      const sourceCanvas = document.createElement("canvas");
      sourceCanvas.width = SHAPE_MASK_SIZE;
      sourceCanvas.height = SHAPE_MASK_SIZE;
      const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
      if (!sourceContext) {
        throw new Error("Impossibile leggere la maschera Shape.png.");
      }
      sourceContext.drawImage(bitmap, 0, 0);
      const rgba = sourceContext.getImageData(0, 0, SHAPE_MASK_SIZE, SHAPE_MASK_SIZE).data;
      const baseMask = new Uint8Array(SHAPE_MASK_SIZE * SHAPE_MASK_SIZE);

      for (let pixelIndex = 0, rgbaIndex = 0; pixelIndex < baseMask.length; pixelIndex += 1, rgbaIndex += 4) {
        const luminance = Math.round(
          rgba[rgbaIndex] * 0.2126
          + rgba[rgbaIndex + 1] * 0.7152
          + rgba[rgbaIndex + 2] * 0.0722,
        );
        baseMask[pixelIndex] = Math.round((luminance * rgba[rgbaIndex + 3]) / 255);
      }
      return baseMask;
    } finally {
      bitmap.close();
    }
  }

  private async createShapeMaskResources(): Promise<ShapeMaskResources> {
    const response = await fetch(new URL("../Shape.png", import.meta.url));
    if (!response.ok) {
      throw new Error(`Impossibile caricare Shape.png (${response.status}).`);
    }

    const source = await response.arrayBuffer();
    let baseMask: Uint8Array;
    let decodeStrategy: ShapeMaskDecodeStrategy;
    try {
      const decoded = await decodeGrayscalePng8(source);
      if (decoded.width !== SHAPE_MASK_SIZE || decoded.height !== SHAPE_MASK_SIZE) {
        throw new Error(
          `Shape.png deve restare ${SHAPE_MASK_SIZE}×${SHAPE_MASK_SIZE}px; trovata ${decoded.width}×${decoded.height}px.`,
        );
      }
      baseMask = decoded.pixels;
      decodeStrategy = SHAPE_DIRECT_DECODE_STRATEGY;
    } catch {
      baseMask = await this.decodeShapeMaskWithCanvas(source);
      decodeStrategy = SHAPE_CANVAS_DECODE_STRATEGY;
    }

    const mipLevelCount = Math.log2(SHAPE_MASK_SIZE) + 1;
    const texture = this.device.createTexture({
      label: "Shape 2K white-times-alpha mask",
      size: {
        width: SHAPE_MASK_SIZE,
        height: SHAPE_MASK_SIZE,
        depthOrArrayLayers: 1,
      },
      mipLevelCount,
      format: "r8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    let levelMask = baseMask;
    let levelSize = SHAPE_MASK_SIZE;
    const occupancyMipMasks: Uint8Array[] = [];
    for (let mipLevel = 0; mipLevel < mipLevelCount; mipLevel += 1) {
      if (mipLevel <= SHAPE_OCCUPANCY_MAX_MIP) {
        occupancyMipMasks.push(levelMask);
      }
      const bytesPerRow = Math.ceil(levelSize / 256) * 256;
      let upload = levelMask;
      if (bytesPerRow !== levelSize) {
        upload = new Uint8Array(bytesPerRow * levelSize);
        for (let row = 0; row < levelSize; row += 1) {
          upload.set(levelMask.subarray(row * levelSize, (row + 1) * levelSize), row * bytesPerRow);
        }
      }

      this.device.queue.writeTexture(
        { texture, mipLevel },
        upload,
        { offset: 0, bytesPerRow, rowsPerImage: levelSize },
        { width: levelSize, height: levelSize, depthOrArrayLayers: 1 },
      );

      if (levelSize === 1) {
        continue;
      }

      const nextSize = levelSize / 2;
      const nextMask = new Uint8Array(nextSize * nextSize);
      for (let y = 0; y < nextSize; y += 1) {
        for (let x = 0; x < nextSize; x += 1) {
          const sourceIndex = y * 2 * levelSize + x * 2;
          nextMask[y * nextSize + x] = Math.round(
            (
              levelMask[sourceIndex]
              + levelMask[sourceIndex + 1]
              + levelMask[sourceIndex + levelSize]
              + levelMask[sourceIndex + levelSize + 1]
            ) / 4,
          );
        }
      }
      levelMask = nextMask;
      levelSize = nextSize;
    }

    const occupancy = buildShapeOccupancyMaps(occupancyMipMasks);
    const previewMask = occupancyMipMasks[SHAPE_OCCUPANCY_MAX_MIP];
    const previewSize = SHAPE_MASK_SIZE >> SHAPE_OCCUPANCY_MAX_MIP;
    const previewSprite = document.createElement("canvas");
    previewSprite.width = previewSize;
    previewSprite.height = previewSize;
    const previewContext = previewSprite.getContext("2d");
    if (previewContext && previewMask) {
      const image = previewContext.createImageData(previewSize, previewSize);
      for (let index = 0; index < previewMask.length; index += 1) {
        const rgbaIndex = index * 4;
        image.data[rgbaIndex] = 255;
        image.data[rgbaIndex + 1] = 255;
        image.data[rgbaIndex + 2] = 255;
        image.data[rgbaIndex + 3] = previewMask[index];
      }
      previewContext.putImageData(image, 0, 0);
    }
    return {
      texture,
      decodeStrategy,
      identity: hashBytes(baseMask),
      occupancyWords: occupancy.words,
      occupancyActiveCells: occupancy.activeCells,
      occupancyCoverageRatios: occupancy.coverageRatios,
      previewSprite,
    };
  }

  /**
   * One authoritative layer is exactly one 4096² mip-0 texture. Display mips
   * live in one reusable active-layer pyramid instead of every layer texture.
   */
  private allocateLayerTexture(format: LayerFormat): LayerTextureResources {
    const texture = this.device.createTexture({
      label: `4096² authoritative paint layer ${format}`,
      size: { width: LAYER_SIZE, height: LAYER_SIZE, depthOrArrayLayers: 1 },
      mipLevelCount: 1,
      format,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT
        | GPUTextureUsage.TEXTURE_BINDING
        | GPUTextureUsage.COPY_SRC
        | GPUTextureUsage.COPY_DST,
    });
    try {
      const view = texture.createView({ label: `Paint layer mip 0 ${format}` });
      const samplingView = texture.createView({ label: `Paint layer sampling mip 0 ${format}` });
      return { texture, view, samplingView };
    } catch (error) {
      texture.destroy();
      throw error;
    }
  }

  /** Logical mips 1–12 for whichever raw layer is active right now. */
  private allocateActiveLayerDisplayPyramid(format: LayerFormat): DisplayPyramidResources {
    const texture = this.device.createTexture({
      label: `Single active-layer display pyramid ${format}`,
      size: { width: LAYER_SIZE >> 1, height: LAYER_SIZE >> 1, depthOrArrayLayers: 1 },
      mipLevelCount: PAINT_DISPLAY_MIP_LEVEL_COUNT - 1,
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    try {
      const samplingView = texture.createView({ label: `Active logical mips 1–12 ${format}` });
      const mipViews = Array.from(
        { length: PAINT_DISPLAY_MIP_LEVEL_COUNT - 1 },
        (_, mipLevel) => texture.createView({
          label: `Active logical mip ${mipLevel + 1} ${format}`,
          baseMipLevel: mipLevel,
          mipLevelCount: 1,
        }),
      );
      return { texture, samplingView, mipViews };
    } catch (error) {
      texture.destroy();
      throw error;
    }
  }

  /** Derived side cache at a view-adaptive texel density. */
  private allocateMergedSurface(
    format: LayerFormat,
    side: "below" | "above",
    layerCount: number,
    bounds: DirtyRect = { x: 0, y: 0, width: LAYER_SIZE, height: LAYER_SIZE },
    resolutionScale = 1,
  ): MergedSurfaceResources {
    const normalizedBounds = this.normalizeLayerRect(bounds);
    if (!normalizedBounds) {
      throw new Error(`Merged ${side}: bounds di allocazione non validi.`);
    }
    if (
      !Number.isInteger(resolutionScale)
      || resolutionScale < 1
      || resolutionScale > 64
    ) {
      throw new Error(`Merged ${side}: densità ${resolutionScale} non valida.`);
    }
    const textureWidth = normalizedBounds.width * resolutionScale;
    const textureHeight = normalizedBounds.height * resolutionScale;
    const maximumTextureExtent = this.device.limits.maxTextureDimension2D;
    if (textureWidth > maximumTextureExtent || textureHeight > maximumTextureExtent) {
      throw new Error(
        `Merged ${side}: ${textureWidth}×${textureHeight} supera il limite `
        + `${maximumTextureExtent} della GPU.`,
      );
    }
    const physicalBounds = { width: textureWidth, height: textureHeight };
    const mipLevelCount = mergedSurfaceMipLevelCount(physicalBounds);
    const memory = mergedSurfaceMemoryBytes(
      physicalBounds,
      format === "rgba16float" ? 8 : 4,
    );
    const texture = this.device.createTexture({
      label:
        `Merged ${side} surface (${layerCount} layers) ${format} `
        + `${textureWidth}×${textureHeight} (${normalizedBounds.width}×`
        + `${normalizedBounds.height} doc @ ${resolutionScale}x) `
        + `@ ${normalizedBounds.x},${normalizedBounds.y}`,
      size: { width: textureWidth, height: textureHeight, depthOrArrayLayers: 1 },
      mipLevelCount,
      format,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT
        | GPUTextureUsage.TEXTURE_BINDING
        | GPUTextureUsage.COPY_DST
        | GPUTextureUsage.COPY_SRC,
    });
    try {
      const samplingView = texture.createView({
        label: `Merged ${side} sampling chain ${format}`,
      });
      const mipViews = Array.from(
        { length: mipLevelCount },
        (_, mipLevel) => texture.createView({
          label: `Merged ${side} mip ${mipLevel} ${format}`,
          baseMipLevel: mipLevel,
          mipLevelCount: 1,
        }),
      );
      const mipDownsampleBindGroups = mipViews.slice(0, -1).map(
        (sourceView, sourceMipLevel) => this.device.createBindGroup({
          label: `Merged ${side} mip ${sourceMipLevel} to ${sourceMipLevel + 1}`,
          layout: this.paintMipDownsampleBindGroupLayout,
          entries: [{ binding: 0, resource: sourceView }],
        }),
      );
      const surface: MergedSurfaceResources = {
        texture,
        samplingView,
        mipViews,
        mipDownsampleBindGroups,
        bounds: { ...normalizedBounds },
        resolutionScale,
        textureWidth,
        textureHeight,
        mip0MemoryBytes: memory.mip0Bytes,
        mipChainMemoryBytes: memory.mipChainBytes,
        validThroughLevel: 0,
        layerCount,
        foldedPixels: 0,
        analyticBakePixels: 0,
      };
      this.liveMergedSurfaceTextures.set(texture, surface);
      return surface;
    } catch (error) {
      texture.destroy();
      throw error;
    }
  }
  private async allocateLayerGpuResources(
    format: LayerFormat,
    label: string,
  ): Promise<LayerGpuResources> {
    return runGpuAllocationTransaction(this.device, label, (transaction) => {
      const hot = this.allocateLayerTexture(format);
      transaction.deferRollback(() => hot.texture.destroy());
      return { hot, cold: null, compressed: null, bake: null, bakeValid: false };
    });
  }

  private createColdLayerGpuResources(): LayerGpuResources {
    return { hot: null, cold: null, compressed: null, bake: null, bakeValid: false };
  }

  private requireLayerGpu(layerId: number): LayerGpuResources {
    const gpu = this.layerGpu.get(layerId);
    if (!gpu) {
      throw new Error(`Risorse GPU del livello ${layerId} non allocate.`);
    }
    return gpu;
  }

  private requireLayerHot(layerId: number): LayerTextureResources {
    const hot = this.requireLayerGpu(layerId).hot;
    if (!hot) {
      throw new Error(`Texture full-canvas del livello ${layerId} non residente.`);
    }
    return hot;
  }

  injectLayerColdStorageFault(...faultPoints: LayerColdStorageFaultPoint[]): void {
    if (!import.meta.env.DEV) {
      throw new Error("Iniezione guasti cold storage disponibile solo in modalità dev.");
    }
    if (faultPoints.length === 0) {
      throw new Error("Specifica almeno un punto di guasto del cold storage.");
    }
    this.layerColdStorageFaultQueue = [...faultPoints];
  }

  private maybeInjectLayerColdStorageFault(point: LayerColdStorageFaultPoint): void {
    if (!import.meta.env.DEV || this.layerColdStorageFaultQueue[0] !== point) {
      return;
    }
    this.layerColdStorageFaultQueue.shift();
    throw new Error(`Guasto iniettato nel cold storage: ${point}.`);
  }

  private destroyLayerColdStorage(cold: LayerColdStorageResources | null | undefined): void {
    cold?.texture.destroy();
  }

  private destroyLayerHot(hot: LayerTextureResources | null | undefined): void {
    hot?.texture.destroy();
  }

  private destroyTransientLayerHydration(hot: LayerTextureResources | null | undefined): void {
    if (!hot) {
      return;
    }
    this.liveLayerHydrationTextures.delete(hot.texture);
    hot.texture.destroy();
  }

  private destroyLayerGpuResources(gpu: LayerGpuResources): void {
    this.destroyLayerBake(gpu.bake);
    this.destroyLayerColdStorage(gpu.cold);
    this.destroyLayerHot(gpu.hot);
    gpu.bake = null;
    gpu.bakeValid = false;
    gpu.cold = null;
    gpu.compressed = null;
    gpu.hot = null;
  }

  private layerColdCompressionEngineIdle(): boolean {
    return this.initialized
      && !this.activeStroke
      && !this.historyBusy
      && !this.layerSwitchBusy
      && !this.rasterStrokeBusy
      && !this.rasterBevelBusy
      && !this.rasterOuterShadowBusy
      && !this.rasterInnerShadowBusy
      && !this.effectsScratchHasQueuedWork()
      && this.devReadbackActiveBytes === 0;
  }

  private selectLayerColdCompressionCandidate(): {
    record: LayerRecord;
    index: number;
    gpu: LayerGpuResources;
    cold: LayerColdStorageResources;
    distance: number;
  } | null {
    if (
      !this.layerColdCompressionEnabled
      || this.layerFormat !== "rgba8unorm"
    ) {
      return null;
    }
    const activeIndex = this.layerStack.activeIndex;
    const progress = this.layerColdCompressionProgress;
    if (progress) {
      const index = this.layerStack.layers.findIndex(
        (record) => record.id === progress.record.id,
      );
      const distance = Math.abs(index - activeIndex);
      if (
        index >= 0
        && distance >= LAYER_COLD_COMPRESSION_MINIMUM_DISTANCE
        && progress.record.hasContent
        && !progress.gpu.hot
        && !progress.gpu.compressed
        && progress.gpu.cold === progress.cold
      ) {
        return {
          record: progress.record,
          index,
          gpu: progress.gpu,
          cold: progress.cold,
          distance,
        };
      }
      this.layerColdCompressionProgress = null;
    }
    let selected: {
      record: LayerRecord;
      index: number;
      gpu: LayerGpuResources;
      cold: LayerColdStorageResources;
      distance: number;
    } | null = null;
    this.layerStack.layers.forEach((record, index) => {
      const distance = Math.abs(index - activeIndex);
      const gpu = this.requireLayerGpu(record.id);
      const cold = gpu.cold;
      if (
        distance < LAYER_COLD_COMPRESSION_MINIMUM_DISTANCE
        || !record.hasContent
        || gpu.hot
        || gpu.compressed
        || !cold
      ) {
        return;
      }
      if (
        !selected
        || distance > selected.distance
        || (distance === selected.distance && cold.memoryBytes > selected.cold.memoryBytes)
      ) {
        selected = { record, index, gpu, cold, distance };
      }
    });
    return selected;
  }

  private async ensureAdjacentLayerColdStorageResident(): Promise<void> {
    const activeIndex = this.layerStack.activeIndex;
    for (const index of [activeIndex - 1, activeIndex + 1]) {
      if (index < 0 || index >= this.layerStack.count) {
        continue;
      }
      const record = this.layerStack.at(index);
      if (!record.hasContent) {
        continue;
      }
      const gpu = this.requireLayerGpu(record.id);
      if (gpu.compressed) {
        await this.ensureLayerColdStorageResident(record, gpu);
      }
    }
  }
  private clearLayerColdCompressionIdleTimer(): void {
    if (this.layerColdCompressionIdleTimer !== null) {
      window.clearTimeout(this.layerColdCompressionIdleTimer);
      this.layerColdCompressionIdleTimer = null;
    }
  }

  private pauseLayerColdCompressionIdle(): void {
    this.clearLayerColdCompressionIdleTimer();
  }

  private cancelLayerColdCompressionIdle(): void {
    this.clearLayerColdCompressionIdleTimer();
    this.layerColdCompressionEpoch += 1;
    this.layerColdCompressionProgress = null;
  }

  private scheduleLayerColdCompression(): void {
    if (
      !this.layerColdCompressionEnabled
      || this.layerColdCompressionWorkerUnavailable
      || !this.initialized
      || this.layerFormat !== "rgba8unorm"
      || this.layerColdCompressionIdleTimer !== null
      || this.layerColdCompressionJobRunning
      || this.activeStroke !== null
      || this.historyBusy
      || this.layerSwitchBusy
      || !this.selectLayerColdCompressionCandidate()
    ) {
      return;
    }
    const token = this.layerColdCompressionEpoch;
    const delayMs = this.layerColdCompressionProgress
      ? 0
      : LAYER_COLD_COMPRESSION_IDLE_DELAY_MS;
    this.layerColdCompressionIdleTimer = window.setTimeout(() => {
      this.layerColdCompressionIdleTimer = null;
      void this.compressOneDistantLayerInBackground(token);
    }, delayMs);
  }

  private async requireLayerColdCompressionClient(
    allowUnavailableRetry = false,
  ): Promise<LayerColdCompressionClient> {
    if (this.layerColdCompressionWorkerUnavailable && !allowUnavailableRetry) {
      throw new Error("Worker compressione livelli non disponibile.");
    }
    if (!this.layerColdCompressionClient) {
      this.layerColdCompressionClient = new LayerColdCompressionClient();
    }
    try {
      await this.layerColdCompressionClient.ready();
      return this.layerColdCompressionClient;
    } catch (error) {
      this.layerColdCompressionClient.dispose();
      this.layerColdCompressionClient = null;
      if (!allowUnavailableRetry) {
        this.layerColdCompressionWorkerUnavailable = true;
      }
      throw error;
    }
  }

  private async compressOneDistantLayerInBackground(token: number): Promise<void> {
    if (
      token !== this.layerColdCompressionEpoch
      || this.layerColdCompressionJobRunning
      || !this.layerColdCompressionEngineIdle()
    ) {
      this.scheduleLayerColdCompression();
      return;
    }
    const source = this.selectLayerColdCompressionCandidate();
    if (!source) {
      return;
    }
    let progress = this.layerColdCompressionProgress;
    if (
      !progress
      || progress.record !== source.record
      || progress.gpu !== source.gpu
      || progress.cold !== source.cold
    ) {
      progress = {
        record: source.record,
        gpu: source.gpu,
        cold: source.cold,
        chunks: [],
        nextArrayLayer: 0,
        rawBytes: 0,
        storedBytes: 0,
        sourceHash: 0x811c9dc5,
        encodeMs: 0,
        pauseReported: false,
      };
      this.layerColdCompressionProgress = progress;
    }
    this.layerColdCompressionJobRunning = true;
    const tileByteLength = LAYER_STORAGE_TILE_SIZE * LAYER_STORAGE_TILE_SIZE * 4;
    try {
      const client = await this.requireLayerColdCompressionClient();
      await this.waitForIdle();
      if (
        token !== this.layerColdCompressionEpoch
        || this.layerColdCompressionProgress !== progress
        || source.gpu.cold !== source.cold
      ) {
        return;
      }
      progress.pauseReported = false;
      while (progress.nextArrayLayer < source.cold.tileIndices.length) {
        if (
          token !== this.layerColdCompressionEpoch
          || this.layerColdCompressionProgress !== progress
          || source.gpu.cold !== source.cold
        ) {
          return;
        }
        // Never enqueue a new GPU readback while a stroke or another engine
        // mutation is active. A chunk already read may still finish in the
        // worker; its verified result is retained below before pausing.
        if (!this.layerColdCompressionEngineIdle()) {
          return;
        }
        const firstArrayLayer = progress.nextArrayLayer;
        const chunkTileCount = Math.min(
          4,
          source.cold.tileIndices.length - firstArrayLayer,
        );
        const payload = await this.readLayerColdStorageTiles(
          source.cold,
          firstArrayLayer,
          chunkTileCount,
          `worker compressione livello ${source.record.id}`,
        );
        if (
          token !== this.layerColdCompressionEpoch
          || this.layerColdCompressionProgress !== progress
          || source.gpu.cold !== source.cold
        ) {
          return;
        }
        const result = await client.compress(payload, tileByteLength);
        if (
          token !== this.layerColdCompressionEpoch
          || this.layerColdCompressionProgress !== progress
          || source.gpu.cold !== source.cold
        ) {
          return;
        }
        progress.chunks.push(result.chunk);
        progress.nextArrayLayer += chunkTileCount;
        progress.rawBytes += result.measurement.rawBytes;
        progress.storedBytes += result.chunk.storedBytes;
        progress.encodeMs += result.measurement.encodeMs;
        progress.sourceHash = combineCompressionHashes(
          progress.sourceHash,
          result.measurement.sourceHash,
          result.measurement.rawBytes,
        );
        if (!this.layerColdCompressionEngineIdle()) {
          if (!progress.pauseReported) {
            progress.pauseReported = true;
            this.callbacks.onStatus?.(
              `Compressione ${source.record.name} in pausa: `
              + `${progress.nextArrayLayer}/${source.cold.tileIndices.length} tile verificati.`,
              "working",
            );
          }
          this.publishStats();
          return;
        }
      }
      if (!this.layerColdCompressionEngineIdle()) {
        return;
      }
      if (progress.rawBytes !== source.cold.memoryBytes) {
        throw new Error(
          `Compressione livello ${source.record.id}: ${progress.rawBytes} byte letti, `
          + `${source.cold.memoryBytes} attesi.`,
        );
      }
      await this.waitForGpuCapped(`Evizione cold livello ${source.record.id}`);
      if (
        token !== this.layerColdCompressionEpoch
        || this.layerColdCompressionProgress !== progress
        || !this.layerColdCompressionEngineIdle()
        || source.gpu.cold !== source.cold
        || source.gpu.compressed
        || Math.abs(source.index - this.layerStack.activeIndex)
          < LAYER_COLD_COMPRESSION_MINIMUM_DISTANCE
      ) {
        return;
      }
      source.gpu.compressed = {
        tileIndices: [...source.cold.tileIndices],
        chunks: [...progress.chunks],
        rawBytes: progress.rawBytes,
        storedBytes: progress.storedBytes,
        sourceHash: progress.sourceHash,
        generation: source.cold.generation,
        encodeMs: progress.encodeMs,
      };
      source.gpu.cold = null;
      this.layerColdCompressionProgress = null;
      this.destroyLayerColdStorage(source.cold);
      this.callbacks.onStatus?.(
        `${source.record.name} compresso in background: `
        + `${(progress.rawBytes / MEBIBYTE_BYTES).toFixed(1)} MiB GPU → `
        + `${(progress.storedBytes / MEBIBYTE_BYTES).toFixed(1)} MiB RAM.`,
        "ok",
      );
      this.publishStats();
    } catch (error) {
      if (token === this.layerColdCompressionEpoch) {
        this.layerColdCompressionProgress = null;
        this.layerColdCompressionWorkerUnavailable = true;
        this.layerColdCompressionClient?.dispose();
        this.layerColdCompressionClient = null;
        const message = error instanceof Error ? error.message : String(error);
        this.callbacks.onStatus?.(
          `Compressione background non disponibile; cold GPU mantenuto: ${message}`,
          "error",
        );
        this.publishStats();
      }
    } finally {
      this.layerColdCompressionJobRunning = false;
      this.scheduleLayerColdCompression();
    }
  }
  private async decompressLayerColdChunk(
    chunk: LayerColdCompressedChunk,
  ): Promise<Uint8Array> {
    let firstError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const client = await this.requireLayerColdCompressionClient(true);
        return await client.decompress(chunk);
      } catch (error) {
        firstError ??= error;
        this.layerColdCompressionClient?.dispose();
        this.layerColdCompressionClient = null;
      }
    }
    const message = firstError instanceof Error ? firstError.message : String(firstError);
    throw new Error(`Worker decompressione non recuperabile: ${message}`);
  }

  private async ensureLayerColdStorageResident(
    record: LayerRecord,
    gpu: LayerGpuResources,
  ): Promise<void> {
    if (gpu.cold || !record.hasContent) {
      return;
    }
    const compressed = gpu.compressed;
    if (!compressed) {
      throw new Error(`Livello ${record.id}: storage autorevole mancante.`);
    }
    const tileByteLength = LAYER_STORAGE_TILE_SIZE * LAYER_STORAGE_TILE_SIZE * 4;
    const texture = this.device.createTexture({
      label: `Cold ripristinato livello ${record.id} #${compressed.generation}`,
      size: {
        width: LAYER_STORAGE_TILE_SIZE,
        height: LAYER_STORAGE_TILE_SIZE,
        depthOrArrayLayers: compressed.tileIndices.length,
      },
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.COPY_SRC
        | GPUTextureUsage.COPY_DST
        | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.layerColdRestoreActiveBytes += compressed.rawBytes;
    let committed = false;
    try {
      let firstArrayLayer = 0;
      let restoredBytes = 0;
      let restoredHash = 0x811c9dc5;
      for (const chunk of compressed.chunks) {
        const restored = await this.decompressLayerColdChunk(chunk);
        if (restored.byteLength % tileByteLength !== 0) {
          throw new Error(`Chunk livello ${record.id} non allineato ai tile.`);
        }
        const chunkTileCount = restored.byteLength / tileByteLength;
        this.device.queue.writeTexture(
          { texture, origin: { x: 0, y: 0, z: firstArrayLayer } },
          restored,
          {
            bytesPerRow: LAYER_STORAGE_TILE_SIZE * 4,
            rowsPerImage: LAYER_STORAGE_TILE_SIZE,
          },
          {
            width: LAYER_STORAGE_TILE_SIZE,
            height: LAYER_STORAGE_TILE_SIZE,
            depthOrArrayLayers: chunkTileCount,
          },
        );
        firstArrayLayer += chunkTileCount;
        restoredBytes += restored.byteLength;
        restoredHash = combineCompressionHashes(
          restoredHash,
          chunk.sourceHash,
          restored.byteLength,
        );
      }
      if (
        firstArrayLayer !== compressed.tileIndices.length
        || restoredBytes !== compressed.rawBytes
        || restoredHash !== compressed.sourceHash
      ) {
        throw new Error(`Integrità aggregata livello ${record.id} non valida.`);
      }
      await this.waitForGpuCapped(`Upload cold compresso livello ${record.id}`);
      if (gpu.compressed !== compressed || gpu.cold) {
        throw new Error(`Ripristino livello ${record.id} diventato stale.`);
      }
      gpu.cold = {
        texture,
        tileIndices: compressed.tileIndices,
        memoryBytes: compressed.rawBytes,
        generation: compressed.generation,
      };
      gpu.compressed = null;
      committed = true;
      this.callbacks.onStatus?.(
        `${record.name} ripristinato dal worker senza perdita.`,
        "ok",
      );
      this.publishStats();
    } finally {
      this.layerColdRestoreActiveBytes -= compressed.rawBytes;
      if (!committed) {
        texture.destroy();
      }
    }
  }
  private coldStorageMaskForRecord(record: LayerRecord): Uint32Array {
    const mask = record.storageTileMask.slice();
    if (record.contentBounds) {
      // The bbox is an independent conservative fallback. A future writer that
      // forgets the sparse bit still cannot silently discard a pixel inside the
      // document-wide bounds.
      markLayerStorageRect(mask, record.contentBounds);
    }
    if (record.hasContent && countLayerStorageTiles(mask) === 0) {
      // Last-resort safety for inconsistent metadata: keep the whole layer.
      // This loses the memory win, never the user pixels.
      mask.fill(0xffffffff);
    }
    return mask;
  }

  private async createLayerColdStorageCandidate(
    record: LayerRecord,
    hot: LayerTextureResources,
    mask: Uint32Array,
    generation: number,
  ): Promise<LayerColdStorageResources> {
    const tileIndices = layerStorageTileIndices(mask);
    if (tileIndices.length === 0) {
      throw new Error(`Cold storage livello ${record.id}: contenuto senza tile.`);
    }
    if (tileIndices.length > this.device.limits.maxTextureArrayLayers) {
      throw new Error(
        `Cold storage livello ${record.id}: ${tileIndices.length} tile superano `
        + `maxTextureArrayLayers=${this.device.limits.maxTextureArrayLayers}.`,
      );
    }
    const bytesPerPixel = this.layerFormat === "rgba16float" ? 8 : 4;
    const memoryBytes = tileIndices.length
      * LAYER_STORAGE_TILE_SIZE
      * LAYER_STORAGE_TILE_SIZE
      * bytesPerPixel;
    return runGpuAllocationTransaction(
      this.device,
      `Pack cold livello ${record.id}`,
      async (transaction) => {
        const texture = this.device.createTexture({
          label: `Cold tile livello ${record.id} #${generation}`,
          size: {
            width: LAYER_STORAGE_TILE_SIZE,
            height: LAYER_STORAGE_TILE_SIZE,
            depthOrArrayLayers: tileIndices.length,
          },
          format: this.layerFormat,
          usage:
            GPUTextureUsage.COPY_SRC
            | GPUTextureUsage.COPY_DST
            | GPUTextureUsage.TEXTURE_BINDING,
        });
        transaction.deferRollback(() => texture.destroy());
        const encoder = this.device.createCommandEncoder({
          label: `Pack cold livello ${record.id} #${generation}`,
        });
        tileIndices.forEach((tileIndex, arrayLayer) => {
          const tileX = tileIndex % LAYER_STORAGE_GRID_SIZE;
          const tileY = Math.floor(tileIndex / LAYER_STORAGE_GRID_SIZE);
          encoder.copyTextureToTexture(
            {
              texture: hot.texture,
              origin: {
                x: tileX * LAYER_STORAGE_TILE_SIZE,
                y: tileY * LAYER_STORAGE_TILE_SIZE,
                z: 0,
              },
            },
            { texture, origin: { x: 0, y: 0, z: arrayLayer } },
            {
              width: LAYER_STORAGE_TILE_SIZE,
              height: LAYER_STORAGE_TILE_SIZE,
              depthOrArrayLayers: 1,
            },
          );
        });
        this.device.queue.submit([encoder.finish()]);
        await this.waitForGpuCapped(`Pack cold livello ${record.id}`);
        this.maybeInjectLayerColdStorageFault("after-pack-submit");
        return { texture, tileIndices, memoryBytes, generation };
      },
    );
  }

  private async freezeActiveLayerToCold(): Promise<void> {
    const record = this.layerStack.active;
    const gpu = this.requireLayerGpu(record.id);
    const hot = this.requireLayerHot(record.id);
    const previous = gpu.cold;
    const previousCompressed = gpu.compressed;
    if (!record.hasContent) {
      gpu.cold = null;
      gpu.compressed = null;
      this.destroyLayerColdStorage(previous);
      return;
    }
    const mask = this.coldStorageMaskForRecord(record);
    const generation = Math.max(
      previous?.generation ?? 0,
      previousCompressed?.generation ?? 0,
    ) + 1;
    const candidate = await this.createLayerColdStorageCandidate(
      record,
      hot,
      mask,
      generation,
    );
    gpu.cold = candidate;
    gpu.compressed = null;
    record.storageTileMask.set(mask);
    this.destroyLayerColdStorage(previous);
  }

  private releaseActiveColdDuplicate(): void {
    const gpu = this.requireLayerGpu(this.layerStack.active.id);
    this.destroyLayerColdStorage(gpu.cold);
    gpu.cold = null;
    gpu.compressed = null;
  }

  private evictReconstructibleLayerResources(record: LayerRecord): void {
    const gpu = this.requireLayerGpu(record.id);
    if (record.hasContent && !gpu.cold && !gpu.compressed) {
      throw new Error(
        `Evizione livello ${record.id} rifiutata: storage autorevole mancante.`,
      );
    }
    this.layerPresentationFrozen = true;
    this.destroyLayerBake(gpu.bake);
    gpu.bake = null;
    gpu.bakeValid = false;
    this.destroyLayerHot(gpu.hot);
    gpu.hot = null;
  }

  private encodeLayerColdHydration(
    encoder: GPUCommandEncoder,
    cold: LayerColdStorageResources,
    hot: LayerTextureResources,
  ): void {
    cold.tileIndices.forEach((tileIndex, arrayLayer) => {
      const tileX = tileIndex % LAYER_STORAGE_GRID_SIZE;
      const tileY = Math.floor(tileIndex / LAYER_STORAGE_GRID_SIZE);
      encoder.copyTextureToTexture(
        { texture: cold.texture, origin: { x: 0, y: 0, z: arrayLayer } },
        {
          texture: hot.texture,
          origin: {
            x: tileX * LAYER_STORAGE_TILE_SIZE,
            y: tileY * LAYER_STORAGE_TILE_SIZE,
            z: 0,
          },
        },
        {
          width: LAYER_STORAGE_TILE_SIZE,
          height: LAYER_STORAGE_TILE_SIZE,
          depthOrArrayLayers: 1,
        },
      );
    });
  }

  private async uploadCompressedLayerIntoHot(
    record: LayerRecord,
    gpu: LayerGpuResources,
    compressed: LayerCompressedColdStorageResources,
    hot: LayerTextureResources,
  ): Promise<void> {
    const tileByteLength = LAYER_STORAGE_TILE_SIZE * LAYER_STORAGE_TILE_SIZE * 4;
    let firstTile = 0;
    let restoredBytes = 0;
    let restoredHash = 0x811c9dc5;
    for (const chunk of compressed.chunks) {
      const restored = await this.decompressLayerColdChunk(chunk);
      if (
        gpu.compressed !== compressed
        || gpu.cold
        || restored.byteLength !== chunk.rawBytes
        || restored.byteLength % tileByteLength !== 0
      ) {
        throw new Error(`Reidratazione transitoria livello ${record.id} non valida.`);
      }
      const chunkTileCount = restored.byteLength / tileByteLength;
      if (firstTile + chunkTileCount > compressed.tileIndices.length) {
        throw new Error(`Chunk transitorio livello ${record.id} oltre i tile attesi.`);
      }
      for (let chunkTile = 0; chunkTile < chunkTileCount; chunkTile += 1) {
        const tileIndex = compressed.tileIndices[firstTile + chunkTile];
        const tileX = tileIndex % LAYER_STORAGE_GRID_SIZE;
        const tileY = Math.floor(tileIndex / LAYER_STORAGE_GRID_SIZE);
        const byteOffset = chunkTile * tileByteLength;
        this.device.queue.writeTexture(
          {
            texture: hot.texture,
            origin: {
              x: tileX * LAYER_STORAGE_TILE_SIZE,
              y: tileY * LAYER_STORAGE_TILE_SIZE,
              z: 0,
            },
          },
          restored.subarray(byteOffset, byteOffset + tileByteLength),
          {
            bytesPerRow: LAYER_STORAGE_TILE_SIZE * 4,
            rowsPerImage: LAYER_STORAGE_TILE_SIZE,
          },
          {
            width: LAYER_STORAGE_TILE_SIZE,
            height: LAYER_STORAGE_TILE_SIZE,
            depthOrArrayLayers: 1,
          },
        );
      }
      firstTile += chunkTileCount;
      restoredBytes += restored.byteLength;
      restoredHash = combineCompressionHashes(
        restoredHash,
        chunk.sourceHash,
        restored.byteLength,
      );
    }
    if (
      gpu.compressed !== compressed
      || gpu.cold
      || firstTile !== compressed.tileIndices.length
      || restoredBytes !== compressed.rawBytes
      || restoredHash !== compressed.sourceHash
    ) {
      throw new Error(`Integrità transitoria livello ${record.id} non valida.`);
    }
  }

  private async createHydratedLayerTexture(
    record: LayerRecord,
    gpu: LayerGpuResources,
    label: string,
    injectFault: boolean,
    completionPolicy: LayerGpuCompletionPolicy = "await-immediately",
  ): Promise<LayerTextureResources> {
    if (injectFault && completionPolicy !== "await-immediately") {
      throw new Error("Il fault hydrate richiede il completamento GPU immediato.");
    }
    const transientCompressed = completionPolicy === "defer-to-fold-fence"
      ? gpu.compressed
      : null;
    if (!transientCompressed) {
      await this.ensureLayerColdStorageResident(record, gpu);
    }
    const cold = gpu.cold;
    if (record.hasContent && !cold && !transientCompressed) {
      throw new Error(`Reidratazione livello ${record.id}: cold store mancante.`);
    }
    const memoryBytes = LAYER_SIZE * LAYER_SIZE
      * (this.layerFormat === "rgba16float" ? 8 : 4);
    return runGpuAllocationTransaction(
      this.device,
      label,
      async (transaction) => {
        const hot = this.allocateLayerTexture(this.layerFormat);
        this.liveLayerHydrationTextures.set(hot.texture, memoryBytes);
        transaction.deferRollback(() => this.destroyTransientLayerHydration(hot));
        if (transientCompressed) {
          await this.uploadCompressedLayerIntoHot(record, gpu, transientCompressed, hot);
        } else if (cold) {
          const encoder = this.device.createCommandEncoder({ label });
          this.encodeLayerColdHydration(encoder, cold, hot);
          this.device.queue.submit([encoder.finish()]);
          if (completionPolicy === "await-immediately") {
            await this.waitForGpuCapped(label);
            if (injectFault) {
              this.maybeInjectLayerColdStorageFault("after-hydrate-submit");
            }
          }
        }
        return hot;
      },
    );
  }

  private async ensureActiveLayerHot(record: LayerRecord): Promise<void> {
    const gpu = this.requireLayerGpu(record.id);
    if (gpu.hot) {
      return;
    }
    const hot = await this.createHydratedLayerTexture(
      record,
      gpu,
      `Reidrata livello ${record.id}`,
      true,
    );
    gpu.hot = hot;
    this.liveLayerHydrationTextures.delete(hot.texture);
  }

  private commitActiveLayerResidency(fromIndex: number): void {
    const activeGpu = this.requireLayerGpu(this.layerStack.active.id);
    this.requireLayerHot(this.layerStack.active.id);
    this.destroyLayerColdStorage(activeGpu.cold);
    activeGpu.cold = null;
    activeGpu.compressed = null;

    const previousRecord = this.layerStack.at(fromIndex);
    if (previousRecord.id === this.layerStack.active.id) {
      return;
    }
    const previousGpu = this.requireLayerGpu(previousRecord.id);
    this.destroyLayerHot(previousGpu.hot);
    previousGpu.hot = null;
  }

  private invalidateActiveLayerBake(): void {
    if (!this.initialized) {
      return;
    }
    const gpu = this.layerGpu.get(this.layerStack.active.id);
    if (gpu) {
      gpu.bakeValid = false;
    }
  }

  injectLayerBakeFault(...faultPoints: LayerBakeFaultPoint[]): void {
    if (!import.meta.env.DEV) {
      throw new Error("Iniezione di guasti bake disponibile solo in modalità dev.");
    }
    if (faultPoints.length === 0) {
      throw new Error("Specifica almeno un punto di guasto del bake.");
    }
    this.layerBakeFaultQueue = [...faultPoints];
  }

  private maybeInjectLayerBakeFault(point: LayerBakeFaultPoint): void {
    if (!import.meta.env.DEV || this.layerBakeFaultQueue[0] !== point) {
      return;
    }
    this.layerBakeFaultQueue.shift();
    throw new Error(`Guasto iniettato nel bake: ${point}.`);
  }

  private destroyLayerBakeTexture(texture: GPUTexture): void {
    this.liveLayerBakeTextures.delete(texture);
    texture.destroy();
  }

  private destroyLayerBake(bake: LayerBakeResources | null | undefined): void {
    if (bake) {
      this.destroyLayerBakeTexture(bake.texture);
    }
  }
  private async createLayerBakeCandidate(
    record: LayerRecord,
    generation: number,
    injectBakeFault: boolean,
    completionPolicy: LayerGpuCompletionPolicy = "await-immediately",
  ): Promise<LayerBakeResources> {
    if (injectBakeFault && completionPolicy !== "await-immediately") {
      throw new Error("Il fault bake richiede il completamento GPU immediato.");
    }
    const renderer = this.rasterStrokeRenderer;
    if (!renderer) {
      throw new Error("Bake impossibile: compositore effetti non disponibile.");
    }
    const bytesPerPixel = this.layerFormat === "rgba16float" ? 8 : 4;
    const memoryBytes = LAYER_SIZE * LAYER_SIZE * bytesPerPixel;
    const nonTransparentBounds = this.layerCompositeVisualBounds(record);
    return runGpuAllocationTransaction(
      this.device,
      `Bake analitico livello ${record.id}`,
      async (transaction) => {
        const texture = this.device.createTexture({
          label: `Bake analitico livello ${record.id} #${generation}`,
          size: { width: LAYER_SIZE, height: LAYER_SIZE, depthOrArrayLayers: 1 },
          format: this.layerFormat,
          usage:
            GPUTextureUsage.STORAGE_BINDING
            | GPUTextureUsage.TEXTURE_BINDING
            | GPUTextureUsage.COPY_SRC,
        });
        this.liveLayerBakeTextures.set(texture, memoryBytes);
        transaction.deferRollback(() => this.destroyLayerBakeTexture(texture));
        const storageView = texture.createView({
          label: `Bake analitico storage livello ${record.id} #${generation}`,
        });
        const samplingView = texture.createView({
          label: `Bake analitico sampling livello ${record.id} #${generation}`,
        });
        const encoder = this.device.createCommandEncoder({
          label: `Bake analitico livello ${record.id} #${generation}`,
        });
        renderer.encodeBake({
          encoder,
          targetView: storageView,
          sourceMode: "permanent",
          style: record.strokeStyle,
          bevelStyle: record.bevelStyle,
          rect: nonTransparentBounds,
        });
        this.device.queue.submit([encoder.finish()]);
        if (completionPolicy === "await-immediately") {
          await this.waitForGpuCapped(`Bake livello ${record.id}`);
          if (injectBakeFault) {
            this.maybeInjectLayerBakeFault("after-candidate-submit");
          }
        }
        return {
          texture,
          storageView,
          samplingView,
          memoryBytes,
          generation,
          nonTransparentBounds: { ...nonTransparentBounds },
        };
      },
    );
  }

  /**
   * Builds the legacy hand-off bake only for DEV fault probes. Normal switches
   * reconstruct inactive styling inside the bounded fold, avoiding this extra
   * full-canvas residency while preserving the transactional failure boundary.
   */
  private async bakeActiveLayerForSwitch(): Promise<void> {
    try {
      await this.bakeActiveLayerForSwitchAttempt();
    } finally {
      if (import.meta.env.DEV) {
        // A fault that was not reached by this attempt must not ambush a later,
        // unrelated switch.
        this.layerBakeFaultQueue = [];
      }
    }
  }

  private async prepareActiveLayerForSwitch(): Promise<void> {
    // Keep the allocation-transaction fault probe, but normal switches no longer
    // retain a 64 MiB hand-off bake while other inactive records are materialized.
    if (import.meta.env.DEV && this.layerBakeFaultQueue.length > 0) {
      await this.bakeActiveLayerForSwitch();
    }
    try {
      await this.freezeActiveLayerToCold();
    } catch (error) {
      // The raw full-canvas and workbench still point at the active layer. A dev
      // hand-off candidate, if requested, is abandoned without touching residency.
      const gpu = this.requireLayerGpu(this.layerStack.active.id);
      this.destroyLayerBake(gpu.bake);
      gpu.bake = null;
      gpu.bakeValid = false;
      throw error;
    }
    // The completed cold copy is now authoritative and byte-exact. Retaining the
    // outgoing full texture and bake until commit caused the dangerous mobile peak.
    this.evictReconstructibleLayerResources(this.layerStack.active);
  }
  private async bakeActiveLayerForSwitchAttempt(): Promise<void> {
    const record = this.layerStack.active;
    const gpu = this.requireLayerGpu(record.id);
    const hot = this.requireLayerHot(record.id);
    const requirements = layerEffectRendererRequirements(
      record.strokeStyle,
      normalizeRasterBevelStyle(record.bevelStyle),
      normalizeRasterOuterShadowStyle(record.outerShadowStyle),
      normalizeRasterInnerShadowStyle(record.innerShadowStyle),
    );
    if (!this.layerHasContent || !requirements.needsStrokeRenderer) {
      const previous = gpu.bake;
      gpu.bake = null;
      gpu.bakeValid = false;
      this.destroyLayerBake(previous);
      return;
    }

    const faultForcesCandidate = import.meta.env.DEV
      && this.layerBakeFaultQueue[0] === "after-candidate-submit";
    if (gpu.bake && gpu.bakeValid && !faultForcesCandidate) {
      return;
    }

    const workbench = this.effectsWorkbench;
    if (!this.rasterStrokeRenderer || !workbench) {
      throw new Error("Bake impossibile: compositore effetti non disponibile.");
    }
    if (
      this.layerView !== hot.view
      || workbench.sourceView !== hot.view
      || this.layerStack.active.id !== record.id
    ) {
      throw new Error("Bake rifiutato: il banco effetti non punta al livello uscente.");
    }

    const previous = gpu.bake;
    const generation = (previous?.generation ?? 0) + 1;
    const completed = await this.createLayerBakeCandidate(record, generation, true);
    gpu.bake = completed;
    gpu.bakeValid = true;
    this.destroyLayerBake(previous);
  }
  /** Rebinds the one reusable raw-layer pyramid to the currently active mip 0. */
  private rebuildActiveLayerPyramidBindings(): void {
    this.paintMipViews = [this.layerView, ...this.activeLayerDisplayPyramid.mipViews];
    const sources = [
      this.layerView,
      ...this.activeLayerDisplayPyramid.mipViews.slice(0, -1),
    ];
    this.paintMipDownsampleBindGroups = sources.map((sourceView, sourceMipLevel) =>
      this.device.createBindGroup({
        label: `Active display logical mip ${sourceMipLevel} to ${sourceMipLevel + 1}`,
        layout: this.paintMipDownsampleBindGroupLayout,
        entries: [{ binding: 0, resource: sourceView }],
      })
    );
  }

  /** Rebinds every transient/effect display path to the semantic text caches. */
  private rebuildVectorTextDependentDisplayBindGroups(): void {
    const belowView = this.vectorTextBelowView ?? this.transparentLayerView;
    const aboveView = this.vectorTextAboveView ?? this.transparentLayerView;
    this.rasterStrokeDisplayScreenBindGroup = this.device.createBindGroup({
      label: "Traccia display screen + semantic text bind group",
      layout: this.rasterStrokeDisplayScreenBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.displayUniformBuffer } },
        { binding: 1, resource: belowView },
        { binding: 2, resource: aboveView },
      ],
    });
    if (this.thicknessTailView) {
      this.thicknessTailDisplayBindGroup = this.device.createBindGroup({
        label: "Predictive thickness tail mixed-scene display bind group",
        layout: this.thicknessTailDisplayBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.displayUniformBuffer } },
          { binding: 1, resource: this.layerView },
          { binding: 2, resource: this.sampler },
          { binding: 3, resource: this.thicknessTailView },
          { binding: 4, resource: { buffer: this.thicknessTailDisplayUniformBuffer } },
          { binding: 5, resource: this.activeLayerDisplayPyramid.samplingView },
          { binding: 6, resource: this.mergedBelowView() },
          { binding: 7, resource: this.mergedAboveView() },
          { binding: 8, resource: belowView },
          { binding: 9, resource: aboveView },
        ],
      });
    }
    if (this.lightGlazeView && this.lightGlazeSamplingView) {
      this.lightGlazeDisplayBindGroup = this.device.createBindGroup({
        label: "Light Glaze mixed-scene live display bind group",
        layout: this.lightGlazeDisplayBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.displayUniformBuffer } },
          { binding: 1, resource: this.layerView },
          { binding: 2, resource: this.lightGlazeView },
          { binding: 3, resource: this.sampler },
          { binding: 4, resource: { buffer: this.lightGlazeUniformBuffer } },
          { binding: 5, resource: this.lightGlazeSamplingView },
          { binding: 6, resource: this.mergedBelowView() },
          { binding: 7, resource: this.mergedAboveView() },
          { binding: 8, resource: belowView },
          { binding: 9, resource: aboveView },
        ],
      });
    }
  }

  /** Every display path sees the same below/text/active/text/above triplet. */
  private rebuildVectorTextDisplayBindGroup(): void {
    const layout = this.vectorTextDisplayBindGroupLayout;
    const belowView = this.vectorTextBelowView;
    const aboveView = this.vectorTextAboveView;
    if (!layout || (!belowView && !aboveView)) {
      this.vectorTextDisplayBindGroup = null;
    } else {
      this.vectorTextDisplayBindGroup = this.device.createBindGroup({
        label: "Dual viewport vector text mixed-layer display bind group",
        layout,
        entries: [
          { binding: 0, resource: { buffer: this.displayUniformBuffer } },
          { binding: 1, resource: this.layerView },
          { binding: 2, resource: this.activeLayerDisplayPyramid.samplingView },
          { binding: 3, resource: this.mergedBelowView() },
          { binding: 4, resource: this.mergedAboveView() },
          { binding: 5, resource: this.sampler },
          { binding: 6, resource: belowView ?? this.transparentLayerView },
          { binding: 7, resource: aboveView ?? this.transparentLayerView },
        ],
      });
    }
    this.rebuildVectorTextDependentDisplayBindGroups();
  }

  private rebuildLayerDisplayBindGroups(): void {
    this.displayBindGroup = this.device.createBindGroup({
      label: "Three-surface layer display bind group",
      layout: this.displayBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.displayUniformBuffer } },
        { binding: 1, resource: this.layerView },
        { binding: 2, resource: this.activeLayerDisplayPyramid.samplingView },
        { binding: 3, resource: this.mergedBelowView() },
        { binding: 4, resource: this.mergedAboveView() },
        { binding: 5, resource: this.sampler },
      ],
    });
    this.rebuildVectorTextDisplayBindGroup();
    this.rebuildRasterStrokeDisplayBindGroups();
  }
  /** Points the engine's active-layer fields at one layer's resources. */
  private bindActiveLayerResources(): void {
    const hot = this.requireLayerHot(this.layerStack.active.id);
    this.layerTexture = hot.texture;
    this.layerView = hot.view;
    this.layerSamplingView = hot.samplingView;
    this.rebuildActiveLayerPyramidBindings();
    this.rebuildLayerDisplayBindGroups();
  }

  private async waitForGpuCapped(label: string, timeoutMs = 30_000): Promise<void> {
    let timer = 0;
    try {
      await Promise.race([
        this.device.queue.onSubmittedWorkDone(),
        new Promise<never>((_, reject) => {
          timer = window.setTimeout(
            () => reject(new Error(`${label}: timeout GPU dopo ${timeoutMs} ms.`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer !== 0) {
        window.clearTimeout(timer);
      }
    }
  }

  injectLayerCompositeFault(...faultPoints: LayerCompositeFaultPoint[]): void {
    if (!import.meta.env.DEV) {
      throw new Error("Iniezione guasti compositing disponibile solo in modalità dev.");
    }
    if (faultPoints.length === 0) {
      throw new Error("Specifica almeno un punto di guasto del compositing.");
    }
    this.layerCompositeFaultQueue = [...faultPoints];
  }

  private maybeInjectLayerCompositeFault(point: LayerCompositeFaultPoint): void {
    if (!import.meta.env.DEV || this.layerCompositeFaultQueue[0] !== point) {
      return;
    }
    this.layerCompositeFaultQueue.shift();
    throw new Error(`Guasto iniettato nel compositing: ${point}.`);
  }

  private async materializeLayerCompositeSource(
    record: LayerRecord,
    caller: EffectsRetargetCaller,
  ): Promise<{
    texture: GPUTexture;
    view: GPUTextureView;
    transientBake: LayerBakeResources | null;
    transientHydration: LayerTextureResources | null;
    nonTransparentBounds: DirtyRect;
    analyticBakePixels: number;
  }> {
    const gpu = this.requireLayerGpu(record.id);
    const requirements = layerEffectRendererRequirements(
      record.strokeStyle,
      normalizeRasterBevelStyle(record.bevelStyle),
      normalizeRasterOuterShadowStyle(record.outerShadowStyle),
      normalizeRasterInnerShadowStyle(record.innerShadowStyle),
    );
    if (gpu.bake && gpu.bakeValid) {
      return {
        texture: gpu.bake.texture,
        view: gpu.bake.samplingView,
        transientBake: null,
        transientHydration: null,
        nonTransparentBounds: { ...gpu.bake.nonTransparentBounds },
        analyticBakePixels:
          gpu.bake.nonTransparentBounds.width * gpu.bake.nonTransparentBounds.height,
      };
    }

    const transientHydration = gpu.hot
      ? null
      : await this.createHydratedLayerTexture(
        record,
        gpu,
        `Fold reidratazione livello ${record.id}`,
        false,
        "defer-to-fold-fence",
      );
    const hot = gpu.hot ?? transientHydration;
    if (!hot) {
      throw new Error(`Fold livello ${record.id}: sorgente full-canvas mancante.`);
    }
    if (!requirements.needsStrokeRenderer) {
      return {
        texture: hot.texture,
        view: hot.view,
        transientBake: null,
        transientHydration,
        nonTransparentBounds: this.normalizeLayerRect(record.contentBounds) ?? {
          x: 0,
          y: 0,
          width: LAYER_SIZE,
          height: LAYER_SIZE,
        },
        analyticBakePixels: 0,
      };
    }

    try {
      await this.ensureEffectRenderersForRecord(record);
      await this.retargetEffectsWorkingSetInternal(
        hot.view,
        this.layerFormat,
        record.contentBounds,
        caller,
        record,
        false,
        false,
        "defer-to-fold-fence",
        "content-bounds",
      );
      const transientBake = await this.createLayerBakeCandidate(
        record,
        1,
        false,
        "defer-to-fold-fence",
      );
      return {
        texture: transientBake.texture,
        view: transientBake.samplingView,
        transientBake,
        transientHydration,
        nonTransparentBounds: { ...transientBake.nonTransparentBounds },
        analyticBakePixels:
          transientBake.nonTransparentBounds.width * transientBake.nonTransparentBounds.height,
      };
    } catch (error) {
      this.destroyTransientLayerHydration(transientHydration);
      throw error;
    }
  }

  private mergedSurfaceSamplingLod(surface: MergedSurfaceResources): number {
    return Math.max(
      0,
      Math.log2(surface.resolutionScale / Math.max(this.zoom, 1e-6)),
    );
  }

  private requiredMergedSurfaceMipLevel(surface: MergedSurfaceResources): number {
    return Math.min(
      surface.mipViews.length - 1,
      Math.ceil(this.mergedSurfaceSamplingLod(surface)),
    );
  }

  private encodeMergedSurfacePyramid(
    encoder: GPUCommandEncoder,
    surface: MergedSurfaceResources,
    selectedMipLevel: number,
  ): number {
    let passes = 0;
    const targetMipLevel = Math.min(
      selectedMipLevel,
      surface.mipViews.length - 1,
    );
    for (
      let mipLevel = surface.validThroughLevel + 1;
      mipLevel <= targetMipLevel;
      mipLevel += 1
    ) {
      const pass = encoder.beginRenderPass({
        label: `Build merged surface mip ${mipLevel}`,
        colorAttachments: [{
          view: surface.mipViews[mipLevel],
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      });
      pass.setPipeline(this.paintMipDownsamplePipeline);
      pass.setBindGroup(0, surface.mipDownsampleBindGroups[mipLevel - 1]);
      pass.draw(3, 1, 0, 0);
      pass.end();
      passes += 1;
    }
    surface.validThroughLevel = Math.max(surface.validThroughLevel, targetMipLevel);
    return passes;
  }

  private encodeMergedDisplayPyramids(
    encoder: GPUCommandEncoder,
    selectedMipLevel: number,
  ): number {
    let passes = 0;
    if (this.mergedBelow) {
      passes += this.encodeMergedSurfacePyramid(
        encoder,
        this.mergedBelow,
        Math.max(selectedMipLevel, this.requiredMergedSurfaceMipLevel(this.mergedBelow)),
      );
    }
    if (this.mergedAbove) {
      passes += this.encodeMergedSurfacePyramid(
        encoder,
        this.mergedAbove,
        Math.max(selectedMipLevel, this.requiredMergedSurfaceMipLevel(this.mergedAbove)),
      );
    }
    for (const segment of this.mixedSceneRasterSegments) {
      passes += this.encodeMergedSurfacePyramid(
        encoder,
        segment.surface,
        Math.max(
          selectedMipLevel,
          this.requiredMergedSurfaceMipLevel(segment.surface),
        ),
      );
    }
    return passes;
  }
  private destroyMergedSurfaceTexture(texture: GPUTexture): void {
    this.liveMergedSurfaceTextures.delete(texture);
    texture.destroy();
  }

  private destroyMergedSurface(surface: MergedSurfaceResources | null | undefined): void {
    if (surface) {
      this.destroyMergedSurfaceTexture(surface.texture);
    }
  }

  private createMixedSceneRasterSegmentResources(
    key: Extract<MixedSceneCompositionSegment, { kind: "raster-run" }>["key"],
    surface: MergedSurfaceResources,
  ): MixedSceneRasterSegmentResources {
    const layout = this.mixedSceneRasterSegmentBindGroupLayout;
    if (!layout) {
      throw new Error("Layout del compositore raster/testo non inizializzato.");
    }
    const uniformBuffer = this.device.createBuffer({
      label: `Mixed scene raster segment ${key} uniforms`,
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    try {
      this.device.queue.writeBuffer(
        uniformBuffer,
        0,
        new Float32Array([
          surface.bounds.x,
          surface.bounds.y,
          surface.resolutionScale,
          0,
        ]),
      );
      const bindGroup = this.device.createBindGroup({
        label: `Mixed scene raster segment ${key} bind group`,
        layout,
        entries: [
          { binding: 0, resource: { buffer: this.displayUniformBuffer } },
          { binding: 1, resource: { buffer: uniformBuffer } },
          { binding: 2, resource: surface.samplingView },
          { binding: 3, resource: this.sampler },
        ],
      });
      return { key, surface, uniformBuffer, bindGroup };
    } catch (error) {
      uniformBuffer.destroy();
      throw error;
    }
  }

  private destroyMixedSceneRasterSegment(
    segment: MixedSceneRasterSegmentResources,
  ): void {
    segment.uniformBuffer.destroy();
    this.destroyMergedSurface(segment.surface);
  }

  private clearMixedSceneRasterSegments(): void {
    for (const segment of this.mixedSceneRasterSegments) {
      this.destroyMixedSceneRasterSegment(segment);
    }
    this.mixedSceneRasterSegments = [];
    this.mixedSceneCompositionSegments = [];
  }

  private async foldRasterRecordIntoMergedSurface(
    surface: MergedSurfaceResources,
    record: LayerRecord,
    side: "below" | "above",
    caller: EffectsRetargetCaller,
    first: boolean,
  ): Promise<boolean> {
    const source = await this.materializeLayerCompositeSource(record, caller);
    const sourceRect = intersectMergedSurfaceRects(
      source.nonTransparentBounds,
      surface.bounds,
      LAYER_SIZE,
    );
    if (!sourceRect) {
      this.destroyLayerBake(source.transientBake);
      this.destroyTransientLayerHydration(source.transientHydration);
      return false;
    }
    const destinationRect = mergedSurfacePhysicalRect(
      sourceRect,
      surface.bounds,
      surface.resolutionScale,
    );
    surface.foldedPixels += destinationRect.width * destinationRect.height;
    surface.analyticBakePixels += source.analyticBakePixels;
    try {
      const encoder = this.device.createCommandEncoder({
        label: `Fold layer ${record.id} into merged ${side}`,
      });
      if (first && record.opacity >= 1 && surface.resolutionScale === 1) {
        // A fresh WebGPU texture is zero-initialized. For the common
        // singleton/opaque side at 1x, copy only the visible source rectangle.
        encoder.copyTextureToTexture(
          {
            texture: source.texture,
            origin: { x: sourceRect.x, y: sourceRect.y, z: 0 },
          },
          {
            texture: surface.texture,
            origin: { x: destinationRect.x, y: destinationRect.y, z: 0 },
          },
          {
            width: sourceRect.width,
            height: sourceRect.height,
            depthOrArrayLayers: 1,
          },
        );
      } else {
        const uniformUpload = new ArrayBuffer(LAYER_COMPOSITE_UNIFORM_BYTES);
        const uniformU32 = new Uint32Array(uniformUpload);
        const uniformF32 = new Float32Array(uniformUpload);
        uniformF32[0] = surface.bounds.x;
        uniformF32[1] = surface.bounds.y;
        uniformF32[2] = surface.resolutionScale;
        uniformF32[3] = record.opacity;
        uniformU32[4] = LAYER_SIZE;
        uniformU32[5] = LAYER_SIZE;
        this.device.queue.writeBuffer(
          this.layerCompositeUniformBuffer,
          0,
          uniformUpload,
        );
        const bindGroup = this.device.createBindGroup({
          label: `Fold layer ${record.id} into merged ${side}`,
          layout: this.layerCompositeBindGroupLayout,
          entries: [
            { binding: 0, resource: source.view },
            { binding: 1, resource: { buffer: this.layerCompositeUniformBuffer } },
          ],
        });
        const pass = encoder.beginRenderPass({
          label: `Source-over layer ${record.id} into merged ${side}`,
          colorAttachments: [{
            view: surface.mipViews[0],
            loadOp: first ? "clear" : "load",
            storeOp: "store",
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          }],
        });
        pass.setPipeline(this.layerCompositePipeline);
        pass.setBindGroup(0, bindGroup);
        pass.setScissorRect(
          destinationRect.x,
          destinationRect.y,
          destinationRect.width,
          destinationRect.height,
        );
        pass.draw(3, 1, 0, 0);
        pass.end();
      }
      this.device.queue.submit([encoder.finish()]);
      // Queue order owns hydration, effect rebuild, analytic bake and fold.
      // Keeping one bounded fence releases each record's full temporaries
      // before the following scene item is materialized.
      await this.waitForGpuCapped(`Fold livello ${record.id}`);
      return true;
    } finally {
      this.destroyLayerBake(source.transientBake);
      this.destroyTransientLayerHydration(source.transientHydration);
    }
  }

  private mixedSceneItemIsVisible(item: MixedSceneItem): boolean {
    if (item.kind !== "raster") {
      return false;
    }
    const record = this.layerStack.byId(item.rasterLayerId);
    if (!record) {
      throw new Error(`Raster ${item.rasterLayerId} assente durante il compositing.`);
    }
    return record.visible && record.opacity > 0 && record.hasContent;
  }
  private async buildMergedSurfaceCandidate(
    records: readonly LayerRecord[],
    side: "below" | "above",
    caller: EffectsRetargetCaller,
  ): Promise<MergedSurfaceResources | null> {
    const visibleRecords = records.filter(
      (record) => record.visible && record.opacity > 0 && record.hasContent,
    );
    if (visibleRecords.length === 0) {
      return null;
    }

    return runGpuAllocationTransaction(
      this.device,
      `Merged ${side} surface transaction`,
      async (transaction) => {
        const surface = this.allocateMergedSurface(
          this.layerFormat,
          side,
          visibleRecords.length,
        );
        transaction.deferRollback(() => this.destroyMergedSurface(surface));

        let first = true;
        for (const record of visibleRecords) {
          await this.foldRasterRecordIntoMergedSurface(surface, record, side, caller, first);
          first = false;
        }

        if (this.paintDisplaySelectedMipLevel > 0) {
          const encoder = this.device.createCommandEncoder({
            label: `Build merged ${side} display pyramid`,
          });
          this.encodeMergedSurfacePyramid(
            encoder,
            surface,
            this.paintDisplaySelectedMipLevel,
          );
          this.device.queue.submit([encoder.finish()]);
          await this.waitForGpuCapped(`Piramide merged ${side}`);
        }
        return surface;
      },
    );
  }

  private async buildMixedMergedSurfaceCandidate(
    items: readonly MixedSceneItem[],
    side: "below" | "above",
    caller: EffectsRetargetCaller,
    view: VectorTextViewState,
  ): Promise<MergedSurfaceResources | null> {
    const rasterItems = items.filter(
      (item): item is Extract<MixedSceneItem, { kind: "raster" }> => item.kind === "raster",
    );
    const boundedItems = rasterItems
      .filter((item) => this.mixedSceneItemIsVisible(item))
      .map((item) => {
        const record = this.layerStack.byId(item.rasterLayerId);
        if (!record) {
          throw new Error(`Raster ${item.rasterLayerId} assente durante il calcolo bounds.`);
        }
        return { item, bounds: this.layerCompositeVisualBounds(record) };
      })
      .filter((entry): entry is {
        item: Extract<MixedSceneItem, { kind: "raster" }>;
        bounds: DirtyRect;
      } => entry.bounds !== null);
    if (boundedItems.length === 0) {
      return null;
    }

    const contentBounds = unionMergedSurfaceRects(
      boundedItems.map((entry) => entry.bounds as MergedSurfaceRect),
      LAYER_SIZE,
    );
    if (!contentBounds) {
      return null;
    }
    const allocation = {
      bounds: alignedMergedSurfaceBounds(contentBounds, LAYER_SIZE),
      resolutionScale: 1,
    } as const;
    const visibleItems = boundedItems.filter((entry) =>
      intersectMergedSurfaceRects(entry.bounds, allocation.bounds, LAYER_SIZE) !== null
    );
    if (visibleItems.length === 0) {
      return null;
    }

    const requiredInitialMip = Math.min(
      MIXED_MERGED_SURFACE_MAX_DISPLAY_MIP,
      Math.ceil(Math.max(0, Math.log2(1 / Math.max(view.zoom, 1e-6)))),
    );
    if (mergedSurfaceMipLevelCount(allocation.bounds) <= requiredInitialMip) {
      throw new Error("Superficie merged raster priva dei mip display richiesti.");
    }
    const surface = await runGpuAllocationTransaction(
      this.device,
      `Merged raster ${side} allocation · ${MIXED_MERGED_SURFACE_STORAGE_STRATEGY}`,
      (transaction) => {
        const allocated = this.allocateMergedSurface(
          this.layerFormat,
          side,
          visibleItems.length,
          allocation.bounds,
          allocation.resolutionScale,
        );
        transaction.deferRollback(() => this.destroyMergedSurface(allocated));
        return allocated;
      },
    );
    try {
      let first = true;
      for (const { item } of visibleItems) {
        const record = this.layerStack.byId(item.rasterLayerId);
        if (!record) {
          throw new Error(`Raster ${item.rasterLayerId} assente durante il fold.`);
        }
        const didFold = await this.foldRasterRecordIntoMergedSurface(
          surface,
          record,
          side,
          caller,
          first,
        );
        first = first && !didFold;
      }
      if (first) {
        this.destroyMergedSurface(surface);
        return null;
      }
      const initialMipLevel = this.requiredMergedSurfaceMipLevel(surface);
      if (initialMipLevel > 0) {
        const encoder = this.device.createCommandEncoder({
          label: `Build merged raster ${side} display pyramid`,
        });
        this.encodeMergedSurfacePyramid(encoder, surface, initialMipLevel);
        this.device.queue.submit([encoder.finish()]);
        await this.waitForGpuCapped(`Piramide merged raster ${side}`);
      }
      return surface;
    } catch (error) {
      this.destroyMergedSurface(surface);
      throw error;
    }
  }
  private async restoreEffectsWorkbenchToActiveLayer(
    caller: EffectsRetargetCaller = "layer-switch",
    force = false,
  ): Promise<void> {
    const record = this.layerStack.active;
    const hot = this.requireLayerHot(record.id);
    if (!force && this.effectsWorkbench?.sourceView === hot.view) {
      return;
    }
    await this.ensureEffectRenderersForRecord(record);
    await this.retargetEffectsWorkingSetInternal(
      hot.view,
      this.layerFormat,
      record.contentBounds,
      caller,
      record,
      false,
      true,
    );
  }

  private releaseFusedLayerBakes(): void {
    for (const gpu of this.layerGpu.values()) {
      this.destroyLayerBake(gpu.bake);
      gpu.bake = null;
      gpu.bakeValid = false;
    }
  }

  /**
   * Rebuilds both derived sides while the last screen-space presentation remains
   * frozen. Old merged textures are evicted before candidates are allocated, so
   * mobile peak memory never contains both complete pairs. Raw hot/cold pixels are
   * authoritative; an error is rolled back by reconstructing these caches.
   */
  private async rebuildMergedLayerSurfaces(
    caller: EffectsRetargetCaller = "layer-switch",
    view: VectorTextViewState = this.getVectorTextViewState(),
  ): Promise<void> {
    const previousBelow = this.mergedBelow;
    const previousAbove = this.mergedAbove;
    this.layerPresentationFrozen = true;
    this.mergedBelow = null;
    this.mergedAbove = null;
    this.destroyMergedSurface(previousBelow);
    this.destroyMergedSurface(previousAbove);
    this.clearMixedSceneRasterSegments();

    let candidateBelow: MergedSurfaceResources | null = null;
    let candidateAbove: MergedSurfaceResources | null = null;
    const candidateMixedSegments: MixedSceneRasterSegmentResources[] = [];
    let candidateCompositionSegments: readonly MixedSceneCompositionSegment[] = [];
    let activeWorkbenchRestored = false;
    try {
      if (this.mixedSceneStack?.textCount) {
        candidateCompositionSegments = this.mixedSceneStack.compositionSegments(
          this.layerStack.active.id,
        );
        const activePosition = candidateCompositionSegments.findIndex(
          (segment) => segment.kind === "active-raster",
        );
        for (
          let index = 0;
          index < candidateCompositionSegments.length;
          index += 1
        ) {
          const segment = candidateCompositionSegments[index];
          if (segment.kind !== "raster-run") {
            continue;
          }
          const side = index < activePosition ? "below" : "above";
          const surface = await this.buildMixedMergedSurfaceCandidate(
            segment.items,
            side,
            caller,
            view,
          );
          if (!surface) {
            continue;
          }
          try {
            candidateMixedSegments.push(
              this.createMixedSceneRasterSegmentResources(segment.key, surface),
            );
          } catch (error) {
            this.destroyMergedSurface(surface);
            throw error;
          }
        }
      } else if (this.mixedSceneStack) {
        const partition = this.mixedSceneStack.partitionAroundRaster(
          this.layerStack.active.id,
        );
        candidateBelow = await this.buildMixedMergedSurfaceCandidate(
          partition.below,
          "below",
          caller,
          view,
        );
        candidateAbove = await this.buildMixedMergedSurfaceCandidate(
          partition.above,
          "above",
          caller,
          view,
        );
      } else {
        candidateBelow = await this.buildMergedSurfaceCandidate(
          this.layerStack.below(), "below", caller,
        );
        candidateAbove = await this.buildMergedSurfaceCandidate(
          this.layerStack.above(), "above", caller,
        );
      }
      await this.restoreEffectsWorkbenchToActiveLayer(caller);
      activeWorkbenchRestored = true;
      this.maybeInjectLayerCompositeFault("after-candidate-submit");

      this.mergedBelow = candidateBelow;
      this.mergedAbove = candidateAbove;
      this.mixedSceneRasterSegments = candidateMixedSegments;
      this.mixedSceneCompositionSegments = candidateCompositionSegments;
      candidateBelow = null;
      candidateAbove = null;
      this.rebuildLayerDisplayBindGroups();
      this.releaseFusedLayerBakes();
      this.presentationCacheNeedsFullRebuild = true;
      this.layerPresentationFrozen = false;
    } catch (error) {
      this.destroyMergedSurface(candidateBelow);
      this.destroyMergedSurface(candidateAbove);
      for (const segment of candidateMixedSegments) {
        this.destroyMixedSceneRasterSegment(segment);
      }
      if (!activeWorkbenchRestored) {
        // A failed retarget may already have changed sourceView before its GPU
        // rebuild failed. Force the reverse retarget instead of trusting the
        // pointer equality fast path.
        await this.restoreEffectsWorkbenchToActiveLayer(caller, true);
      }
      throw error;
    } finally {
      if (import.meta.env.DEV) {
        this.layerCompositeFaultQueue = [];
      }
    }
  }
  private requireMixedSceneStack(): MixedSceneStack {
    if (!this.mixedSceneStack) {
      throw new Error("Scena raster/testo non abilitata per questa pagina.");
    }
    return this.mixedSceneStack;
  }

  private async mutateMixedScenePresentation<Result>(
    mutate: (scene: MixedSceneStack) => Result,
  ): Promise<Result> {
    if (!this.initialized) {
      throw new Error("Il motore non è ancora inizializzato.");
    }
    const scene = this.requireMixedSceneStack();
    this.assertLayerSwitchAllowed();
    this.cancelLayerColdCompressionIdle();
    this.layerSwitchBusy = true;
    const previousState = scene.captureState();
    const previousExcludedNodeId = this.vectorTextPreviewExcludedNodeId;
    try {
      this.callbacks.onStatus?.("Preparazione della scena raster/testo…", "working");
      await this.waitForIdle();
      const result = mutate(scene);
      const selected = scene.selected;
      this.vectorTextPreviewExcludedNodeId = selected.kind === "text"
        ? selected.textNodeId
        : null;
      this.clearVectorTextPresentation();
      this.callbacks.onStatus?.("Composizione dei livelli raster/testo…", "working");
      await this.rebuildMergedLayerSurfaces("layer-switch");
      this.callbacks.onStatus?.("Scena raster/testo pronta.", "ok");
      this.presentationCacheNeedsFullRebuild = true;
      this.displayDirty = true;
      this.requestRender();
      return result;
    } catch (error) {
      scene.restoreState(previousState);
      this.vectorTextPreviewExcludedNodeId = previousExcludedNodeId;
      this.clearVectorTextPresentation();
      try {
        await this.rebuildMergedLayerSurfaces("layer-switch");
      } catch (restoreError) {
        this.latchDocumentStateInconsistent(
          "Stato incoerente dopo la modifica della scena mista: ricarica la pagina.",
        );
        const originalMessage = error instanceof Error ? error.message : String(error);
        const restoreMessage = restoreError instanceof Error
          ? restoreError.message
          : String(restoreError);
        throw new Error(
          `Modifica scena fallita (${originalMessage}) e ripristino fallito `
          + `(${restoreMessage}). Ricarica la pagina.`,
        );
      }
      throw error;
    } finally {
      this.layerSwitchBusy = false;
      this.scheduleLayerColdCompression();
      this.publishMixedScene();
      this.publishHistoryState();
      this.publishStats();
    }
  }

  async addVectorTextNode(
    seed: VectorTextNodeSeed,
    name?: string,
  ): Promise<Readonly<VectorTextNode>> {
    const node = await this.mutateMixedScenePresentation(
      (scene) => scene.addTextAboveSelection(seed, name),
    );
    return { ...node };
  }

  /**
   * Fixture-only batch insertion: sixty-four semantic text nodes are committed
   * through one scene transaction and one merged-surface rebuild instead of
   * paying that setup cost once per node. Rendering and document order are the
   * same as repeated addVectorTextNode() calls.
   */
  async addVectorTextNodesBatch(
    entries: readonly {
      seed: VectorTextNodeSeed;
      name?: string;
    }[],
  ): Promise<readonly Readonly<VectorTextNode>[]> {
    if (!this.layerMemoryStressTestEnabled) {
      throw new Error("Batch testi benchmark non abilitata per questa pagina.");
    }
    if (entries.length === 0) {
      return [];
    }
    const nodes = await this.mutateMixedScenePresentation((scene) =>
      entries.map((entry) => scene.addTextAboveSelection(entry.seed, entry.name))
    );
    return nodes.map((node) => ({ ...node }));
  }

  async setActiveMixedSceneItem(
    key: MixedSceneItem["key"],
  ): Promise<LayerSwitchResult | null> {
    const scene = this.requireMixedSceneStack();
    const item = scene.itemByKey(key);
    if (item.kind === "raster") {
      const index = this.layerStack.indexOfId(item.rasterLayerId);
      if (index < 0) {
        throw new Error(`Raster ${item.rasterLayerId} assente dallo stack GPU.`);
      }
      if (scene.selected.key === key && index === this.layerStack.activeIndex) {
        return null;
      }
      if (index === this.layerStack.activeIndex) {
        await this.mutateMixedScenePresentation((mutableScene) => {
          mutableScene.select(key);
        });
        return null;
      }

      this.assertLayerSwitchAllowed();
      const previousState = scene.captureState();
      const previousExcludedNodeId = this.vectorTextPreviewExcludedNodeId;
      scene.select(key);
      this.vectorTextPreviewExcludedNodeId = null;
      this.clearVectorTextPresentation();
      try {
        return await this.setActiveLayer(index);
      } catch (error) {
        scene.restoreState(previousState);
        this.vectorTextPreviewExcludedNodeId = previousExcludedNodeId;
        try {
          await this.mutateMixedScenePresentation(() => undefined);
        } catch (restoreError) {
          this.latchDocumentStateInconsistent(
            "Stato incoerente dopo la selezione raster: ricarica la pagina.",
          );
          const originalMessage = error instanceof Error ? error.message : String(error);
          const restoreMessage = restoreError instanceof Error
            ? restoreError.message
            : String(restoreError);
          throw new Error(
            `Selezione raster fallita (${originalMessage}) e ripristino fallito `
            + `(${restoreMessage}). Ricarica la pagina.`,
          );
        }
        throw error;
      } finally {
        this.publishMixedScene();
        this.publishStats();
      }
    }
    if (scene.selected.key === key) {
      return null;
    }
    await this.mutateMixedScenePresentation((mutableScene) => {
      mutableScene.select(key);
    });
    return null;
  }

  updateVectorTextNode(
    id: number,
    update: Partial<Omit<VectorTextNode, "id" | "visible" | "opacity">>,
  ): Readonly<VectorTextNode> {
    const scene = this.requireMixedSceneStack();
    const selected = scene.selected;
    if (selected.kind !== "text" || selected.textNodeId !== id) {
      throw new Error("È modificabile soltanto il nodo testo selezionato.");
    }
    const node = scene.updateText(id, update);
    this.publishMixedScene();
    this.publishStats();
    return { ...node };
  }

  async setVectorTextNodeVisibility(id: number, visible: boolean): Promise<boolean> {
    return this.mutateMixedScenePresentation(
      (scene) => scene.setTextVisibility(id, Boolean(visible)),
    );
  }

  async setVectorTextNodeOpacity(id: number, opacity: number): Promise<boolean> {
    return this.mutateMixedScenePresentation(
      (scene) => scene.setTextOpacity(id, opacity),
    );
  }

  async moveVectorTextNode(id: number, delta: -1 | 1): Promise<boolean> {
    return this.mutateMixedScenePresentation(
      (scene) => scene.moveText(id, delta),
    );
  }

  async deleteVectorTextNode(id: number): Promise<Readonly<VectorTextNode>> {
    const removed = await this.mutateMixedScenePresentation(
      (scene) => scene.deleteText(id, this.layerStack.active.id),
    );
    return { ...removed };
  }

  /**
   * Gives the dedicated memory fixture a tiny visible marker while deliberately
   * reserving an exact number of raw-storage tiles. The default keeps the
   * original full-layer stress fixture unchanged; the iPhone staircase passes
   * smaller counts so every checkpoint advances by a known amount.
   */
  async seedActiveLayerMemoryStress(
    markerIndex: number,
    storageTileCount = LAYER_STORAGE_TILE_COUNT,
  ): Promise<void> {
    if (!this.layerMemoryStressTestEnabled) {
      throw new Error("Stress memoria livelli non abilitato per questa pagina.");
    }
    if (!this.initialized) {
      throw new Error("Il motore non è ancora inizializzato.");
    }
    if (this.layerFormat !== "rgba8unorm") {
      throw new Error("Lo stress memoria da 1000 MiB richiede il formato RGBA8.");
    }
    if (this.styleStackActive()) {
      throw new Error("Disattiva Traccia, Smusso e Ombre prima dello stress memoria.");
    }
    if (
      !Number.isInteger(storageTileCount)
      || storageTileCount < 1
      || storageTileCount > LAYER_STORAGE_TILE_COUNT
    ) {
      throw new Error(
        `Numero tile stress non valido: ${storageTileCount}; atteso 1-${LAYER_STORAGE_TILE_COUNT}.`,
      );
    }
    this.assertLayerSwitchAllowed();
    this.cancelLayerColdCompressionIdle();
    await this.waitForIdle();

    const markerSize = 64;
    const gridColumn = markerIndex % 4;
    const gridRow = Math.floor(markerIndex / 4) % 4;
    const x = 512 + gridColumn * 896;
    const y = 512 + gridRow * 896;
    const red = 72 + (markerIndex * 73) % 176;
    const green = 72 + (markerIndex * 109) % 176;
    const blue = 72 + (markerIndex * 151) % 176;
    const pixels = new Uint8Array(markerSize * markerSize * 4);
    for (let offset = 0; offset < pixels.length; offset += 4) {
      pixels[offset] = red;
      pixels[offset + 1] = green;
      pixels[offset + 2] = blue;
      pixels[offset + 3] = 255;
    }
    this.device.queue.writeTexture(
      { texture: this.layerTexture, origin: { x, y, z: 0 } },
      pixels,
      { bytesPerRow: markerSize * 4, rowsPerImage: markerSize },
      { width: markerSize, height: markerSize, depthOrArrayLayers: 1 },
    );
    await this.waitForGpuCapped(`Marker stress memoria livello ${markerIndex + 1}`);

    const markerRect = { x, y, width: markerSize, height: markerSize };
    this.layerHasContent = true;
    this.noteLayerMutation(markerRect, false);
    // The marker remains tiny so merged-surface rebuilds stay interactive. Its
    // real tile is always included, then deterministic additional tiles are
    // marked until the requested cold-store capacity is reached.
    const storageTileMask = this.layerStack.active.storageTileMask;
    storageTileMask.fill(0);
    const markerTileIndex =
      Math.floor(y / LAYER_STORAGE_TILE_SIZE) * LAYER_STORAGE_GRID_SIZE
      + Math.floor(x / LAYER_STORAGE_TILE_SIZE);
    const markStorageTile = (tileIndex: number): void => {
      const wordIndex = tileIndex >>> 5;
      storageTileMask[wordIndex] |= 1 << (tileIndex & 31);
    };
    markStorageTile(markerTileIndex);
    let markedTileCount = 1;
    for (
      let tileIndex = 0;
      tileIndex < LAYER_STORAGE_TILE_COUNT && markedTileCount < storageTileCount;
      tileIndex += 1
    ) {
      if (tileIndex !== markerTileIndex) {
        markStorageTile(tileIndex);
        markedTileCount += 1;
      }
    }
    this.persistActiveLayerState();
    this.paintDisplayMipValidThroughLevel = 0;
    this.presentationCacheNeedsFullRebuild = true;
    this.displayDirty = true;
    this.requestRender();
    this.publishStats();
    this.scheduleLayerColdCompression();
  }

  /**
   * Adds a layer above the active one and selects it.
   *
   * Deliberately not routed through recreateLayerResources: that function's tail
   * destroys the outgoing texture, the blend renderer and the effects workbench,
   * which is right for a format change and fatal here. The 21 render pipelines
   * depend only on the format, so a new layer in the same format reuses them.
   */
  async addLayer(name?: string): Promise<LayerSwitchResult> {
    if (!this.initialized) {
      throw new Error("Il motore non è ancora inizializzato.");
    }
    if (this.layerStack.count >= LAYER_STACK_MAXIMUM) {
      throw new Error(`Massimo ${LAYER_STACK_MAXIMUM} livelli raggiunto.`);
    }
    this.assertLayerSwitchAllowed();
    this.cancelLayerColdCompressionIdle();
    this.layerSwitchBusy = true;
    try {
      await this.waitForIdle();
      const mixedSceneState = this.mixedSceneStack?.captureState() ?? null;
      const previousExcludedNodeId = this.vectorTextPreviewExcludedNodeId;
      const fromIndex = this.layerStack.activeIndex;
      this.persistActiveLayerState();
      await this.prepareActiveLayerForSwitch();
      const index = this.layerStack.add(name);
      const record = this.layerStack.at(index);
      if (this.mixedSceneStack) {
        this.mixedSceneStack.addRasterAboveSelection(record.id);
        this.vectorTextPreviewExcludedNodeId = null;
      }
      let gpu: LayerGpuResources;
      try {
        gpu = await this.allocateLayerGpuResources(
          this.layerFormat,
          `Allocazione livello ${record.id}`,
        );
        this.layerGpu.set(record.id, gpu);
      } catch (error) {
        // Leave the stack exactly as it was rather than holding a record with no
        // GPU resources, which every later switch would trip over.
        this.layerStack.remove(index);
        this.layerStack.setActiveIndex(fromIndex);
        if (this.mixedSceneStack && mixedSceneState) {
          this.mixedSceneStack.restoreState(mixedSceneState);
          this.vectorTextPreviewExcludedNodeId = previousExcludedNodeId;
        }
        try {
          // The outgoing full texture was deliberately evicted after its exact
          // cold copy completed. Rehydrate it and rebuild derived caches before
          // reporting the allocation failure.
          await this.activateLayer(fromIndex);
        } catch (restoreError) {
          const originalMessage = error instanceof Error ? error.message : String(error);
          const restoreMessage = restoreError instanceof Error
            ? restoreError.message
            : String(restoreError);
          this.latchDocumentStateInconsistent(
            "Stato incoerente dopo l'allocazione del livello: ricarica prima di continuare.",
          );
          throw new Error(
            `Creazione livello fallita: ${originalMessage}; ripristino fallito: ${restoreMessage}. `
            + "Ricarica la pagina prima di continuare.",
          );
        }
        throw error;
      }
      try {
        const result = await this.activateLayer(fromIndex);
        // prepareActiveLayerForSwitch freezes presentation. Clearing the live
        // text texture before activation marks displayDirty while frozen, so
        // the effect retarget's waitForIdle can never drain it. The new mixed
        // partition already excludes no text; release the old live preview only
        // after activation has rebuilt the static sides and unfrozen rendering.
        this.clearVectorTextPresentation();
        return result;
      } catch (error) {
        // activateLayer mutates more than the selected index: it binds texture
        // fields, retargets Blend and the effect workbench, and loads content
        // metadata. Restore through the same complete path before discarding the
        // candidate. Its blank full texture is reconstructible, so release it
        // before rehydrating the outgoing layer and keep one hot mip 0 at a time.
        try {
          this.evictReconstructibleLayerResources(record);
          if (this.mixedSceneStack && mixedSceneState) {
            this.mixedSceneStack.restoreState(mixedSceneState);
            this.vectorTextPreviewExcludedNodeId = previousExcludedNodeId;
          }
          this.layerStack.setActiveIndex(fromIndex);
          await this.activateLayer(index);
        } catch (restoreError) {
          const originalMessage = error instanceof Error ? error.message : String(error);
          const restoreMessage = restoreError instanceof Error
            ? restoreError.message
            : String(restoreError);
          this.latchDocumentStateInconsistent(
            "Stato incoerente dopo la creazione del livello: ricarica prima di continuare.",
          );
          throw new Error(
            `Creazione livello fallita: ${originalMessage}; ripristino fallito: ${restoreMessage}. `
            + "Ricarica la pagina prima di continuare.",
          );
        }
        this.layerGpu.delete(record.id);
        this.layerStack.remove(index);
        this.destroyLayerGpuResources(gpu);
        throw error;
      }
    } finally {
      this.layerSwitchBusy = false;
      this.scheduleLayerColdCompression();
      if (import.meta.env.DEV) {
        this.layerColdStorageFaultQueue = [];
      }
      this.publishHistoryState();
      this.publishStats();
      this.publishMixedScene();
    }
  }

  /** Selects an existing layer, paying the switch cost. */
  async setActiveLayer(index: number): Promise<LayerSwitchResult | null> {
    if (!this.initialized) {
      throw new Error("Il motore non è ancora inizializzato.");
    }
    this.layerStack.at(index);
    if (index === this.layerStack.activeIndex) {
      return null;
    }
    this.assertLayerSwitchAllowed();
    this.cancelLayerColdCompressionIdle();
    this.layerSwitchBusy = true;
    const fromIndex = this.layerStack.activeIndex;
    let activationStarted = false;
    try {
      await this.waitForIdle();
      this.persistActiveLayerState();
      await this.prepareActiveLayerForSwitch();
      this.layerStack.setActiveIndex(index);
      activationStarted = true;
      return await this.activateLayer(fromIndex);
    } catch (error) {
      if (activationStarted) {
        // Restoring only the selected index and texture fields is insufficient:
        // Blend, content metadata and the effect workbench may already target the
        // incoming layer. Its cold store is still authoritative until commit, so
        // evict the failed hot candidate before running activation in reverse.
        try {
          this.evictReconstructibleLayerResources(this.layerStack.at(index));
          this.layerStack.setActiveIndex(fromIndex);
          await this.activateLayer(index);
        } catch (restoreError) {
          const originalMessage = error instanceof Error ? error.message : String(error);
          const restoreMessage = restoreError instanceof Error
            ? restoreError.message
            : String(restoreError);
          this.latchDocumentStateInconsistent(
            "Stato incoerente dopo il cambio livello: ricarica prima di continuare.",
          );
          throw new Error(
            `Cambio livello fallito: ${originalMessage}; ripristino fallito: ${restoreMessage}. `
            + "Ricarica la pagina prima di continuare.",
          );
        }
      }
      throw error;
    } finally {
      this.layerSwitchBusy = false;
      this.scheduleLayerColdCompression();
      if (import.meta.env.DEV) {
        this.layerColdStorageFaultQueue = [];
      }
      this.publishHistoryState();
      this.publishStats();
    }
  }

  async setLayerVisibility(index: number, visible: boolean): Promise<boolean> {
    return this.setLayerPresentation(index, Boolean(visible), undefined);
  }

  async setLayerOpacity(index: number, opacity: number): Promise<boolean> {
    return this.setLayerPresentation(index, undefined, clamp(opacity, 0, 1));
  }

  private async setLayerPresentation(
    index: number,
    visible: boolean | undefined,
    opacity: number | undefined,
  ): Promise<boolean> {
    if (!this.initialized) {
      throw new Error("Il motore non è ancora inizializzato.");
    }
    const record = this.layerStack.at(index);
    const nextVisible = visible ?? record.visible;
    const nextOpacity = opacity ?? record.opacity;
    if (nextVisible === record.visible && nextOpacity === record.opacity) {
      return false;
    }
    this.assertLayerSwitchAllowed();
    this.cancelLayerColdCompressionIdle();
    this.layerSwitchBusy = true;
    const previousVisible = record.visible;
    const previousOpacity = record.opacity;
    try {
      await this.waitForIdle();
      record.visible = nextVisible;
      record.opacity = nextOpacity;
      if (index !== this.layerStack.activeIndex) {
        await this.rebuildMergedLayerSurfaces();
      }
      this.presentationCacheNeedsFullRebuild = true;
      this.displayDirty = true;
      this.requestRender();
      this.publishStats();
      return true;
    } catch (error) {
      record.visible = previousVisible;
      record.opacity = previousOpacity;
      try {
        // The old merged textures were deliberately evicted before allocation.
        // Rebuild the reverted presentation from authoritative raw storage; the
        // injected fault queue was cleared by the failed attempt.
        await this.rebuildMergedLayerSurfaces("layer-switch");
      } catch (restoreError) {
        this.latchDocumentStateInconsistent(
          "Stato incoerente dopo il compositing: ricarica prima di continuare.",
        );
        const originalMessage = error instanceof Error ? error.message : String(error);
        const restoreMessage = restoreError instanceof Error
          ? restoreError.message
          : String(restoreError);
        throw new Error(
          `Compositing non riuscito (${originalMessage}) e ripristino fallito `
          + `(${restoreMessage}). Ricarica la pagina prima di continuare.`,
        );
      }
      throw error;
    } finally {
      this.layerSwitchBusy = false;
      this.scheduleLayerColdCompression();
    }
  }
  private latchDocumentStateInconsistent(message: string): void {
    this.historyStateInconsistent = true;
    this.historyBusy = true;
    this.publishHistoryState();
    this.callbacks.onStatus?.(message, "error");
  }

  private assertLayerSwitchAllowed(): void {
    if (
      this.activeStroke
      || this.lightGlazeSession
      || this.historyBusy
      || this.layerSwitchBusy
      || this.rasterStrokeBusy
      || this.rasterBevelBusy
      || this.rasterOuterShadowBusy
      || this.rasterInnerShadowBusy
    ) {
      throw new Error("Il livello può cambiare solo a motore fermo.");
    }
  }

  /**
   * Writes the engine's live per-layer state back onto the outgoing record.
   * Without this the incoming layer would inherit the outgoing layer's content
   * bounds, and the bbox bevel field would be sized for the wrong content.
   */
  private persistActiveLayerState(): void {
    const record = this.layerStack.active;
    record.contentBounds = this.layerContentBounds;
    record.hasContent = this.layerHasContent;
  }

  /**
   * Makes the effect renderers match the INCOMING layer's stored styles.
   *
   * The workbench is a single retargetable instance, so a layer whose record says
   * Traccia is enabled can arrive after another layer released the renderer — it
   * would come back with the style checkbox on and no effect drawn. The scratch
   * tier is width-derived too, so a layer stored at width 512 entering while the
   * renderer sits at the 1024 tier needs the resize that setRasterStrokeStyle
   * would have done.
   *
   * Renderer shells are deliberately NOT released when the incoming layer does
   * not use them: the working set is shared and singular, so keeping it costs
   * nothing per layer. Heavy Traccia-only geometry does follow the incoming
   * style, while the small placeholders keep the shared compositor bind groups
   * valid without rebuilding every pipeline on each switch.
   */
  private async ensureEffectRenderersForRecord(record: LayerRecord): Promise<void> {
    const requirements = layerEffectRendererRequirements(
      record.strokeStyle,
      normalizeRasterBevelStyle(record.bevelStyle),
      normalizeRasterOuterShadowStyle(record.outerShadowStyle),
      normalizeRasterInnerShadowStyle(record.innerShadowStyle),
    );
    if (requirements.needsBevelRenderer && !this.rasterBevelRenderer) {
      await this.ensureRasterBevelRenderer();
    }
    if (requirements.needsOuterShadowRenderer && !this.rasterOuterShadowRenderer) {
      await this.ensureRasterOuterShadowRenderer();
    }
    if (requirements.needsInnerShadowRenderer && !this.rasterInnerShadowRenderer) {
      await this.ensureRasterInnerShadowRenderer();
    }
    if (requirements.needsStrokeRenderer) {
      const strokeGeometryActive =
        record.strokeStyle.enabled && record.strokeStyle.width > 0;
      const scratchExtent = rasterStrokeScratchExtentForRenderer(
        strokeGeometryActive,
        requirements.strokeWidth,
      );
      const renderer = await this.ensureRasterStrokeRenderer(
        requirements.strokeWidth,
        strokeGeometryActive,
      );
      if (renderer.scratchExtent !== scratchExtent) {
        renderer.resizeScratch(scratchExtent);
      }
    } else if (this.rasterStrokeRenderer) {
      await this.setRasterStrokeGeometryEnabled(false);
      if (this.rasterStrokeRenderer.scratchExtent !== RASTER_STROKE_COMPOSITOR_ONLY_SCRATCH_EXTENT) {
        this.rasterStrokeRenderer.resizeScratch(RASTER_STROKE_COMPOSITOR_ONLY_SCRATCH_EXTENT);
      }
    }
    this.rasterOuterShadowRenderer?.updateStyle(record.outerShadowStyle);
    this.rasterInnerShadowRenderer?.updateStyle(record.innerShadowStyle);
    if (this.rasterStrokeRenderer) {
      this.rasterStrokeRenderer.setShadowResources(
        "outer",
        this.rasterOuterShadowRenderer?.coverageBuffer ?? null,
        this.rasterOuterShadowRenderer?.compositionUniformBuffer ?? null,
      );
      this.rasterStrokeRenderer.setShadowResources(
        "inner",
        this.rasterInnerShadowRenderer?.coverageBuffer ?? null,
        this.rasterInnerShadowRenderer?.compositionUniformBuffer ?? null,
      );
    }
  }

  private async activateLayer(
    fromIndex: number,
    caller: EffectsRetargetCaller = "layer-switch",
  ): Promise<LayerSwitchResult> {
    const startedAt = performance.now();
    const record = this.layerStack.active;
    if (this.mixedSceneStack && caller === "history-replay") {
      this.mixedSceneStack.select(`raster:${record.id}`);
      this.vectorTextPreviewExcludedNodeId = null;
      this.clearVectorTextPresentation();
    }
    await this.ensureActiveLayerHot(record);
    await this.ensureAdjacentLayerColdStorageResident();
    this.bindActiveLayerResources();
    this.layerContentBounds = record.contentBounds;
    this.layerHasContent = record.hasContent;
    // The incoming layer's deep pyramid levels may never have been built, so
    // incremental maintenance would refine stale garbage. Force a full rebuild.
    this.paintDisplayMipValidThroughLevel = 0;
    this.blendRenderer?.retarget(this.layerView, this.layerSamplingView);
    if (caller === "history-replay") {
      // After the engine fields and Blend have moved, but before the workbench
      // does: this is the half-switched state the transaction must recover from.
      this.maybeInjectHistoryReplayFault("during-switch-activation");
    }
    this.destroyLightGlazeResources();
    this.destroyThicknessTailOverlayResources();
    await this.ensureEffectRenderersForRecord(record);

    const effectsStartedAt = performance.now();
    const effects = await this.retargetEffectsWorkingSetInternal(
      this.layerView,
      this.layerFormat,
      record.contentBounds,
      caller,
      record,
      false,
      true,
    );
    const effectsMs = performance.now() - effectsStartedAt;
    const compositeStartedAt = performance.now();
    await this.rebuildMergedLayerSurfaces(caller);
    const compositeMs = performance.now() - compositeStartedAt;
    this.commitActiveLayerResidency(fromIndex);

    this.presentationCacheNeedsFullRebuild = true;
    this.displayDirty = true;
    this.requestRender();
    this.publishStats();
    this.publishMixedScene();
    return {
      fromIndex,
      toIndex: this.layerStack.activeIndex,
      layerId: record.id,
      totalMs: performance.now() - startedAt,
      effectsMs,
      compositeMs,
      effectsGeneration: effects.generation,
      contentBoundsRestored: record.contentBounds !== null,
    };
  }

  private async recreateLayerResources(format: LayerFormat): Promise<void> {
    const oldBlendRenderer = this.blendRenderer;
    const oldEffectsWorkbench = this.effectsWorkbench;
    const previousScratchPeakBytes = oldEffectsWorkbench?.scratchPool.peakBytes ?? 0;
    const {
      normalPipeline,
      additivePipeline,
      shapeNormalPipeline,
      shapeAdditivePipeline,
      shapeOccupancyNormalPipeline,
      shapeOccupancyAdditivePipeline,
      grainNormalPipeline,
      grainAdditivePipeline,
      grainShapeNormalPipeline,
      grainShapeAdditivePipeline,
      grainShapeOccupancyNormalPipeline,
      grainShapeOccupancyAdditivePipeline,
      m1GlazePipeline,
      m1GlazeShapePipeline,
      m1GlazeShapeOccupancyPipeline,
      grainM1GlazePipeline,
      grainM1GlazeShapePipeline,
      grainM1GlazeShapeOccupancyPipeline,
      lightGlazeCompositeMipPipeline,
      lightGlazeCompositePipeline,
      paintMipDownsamplePipeline,
      layerCompositePipeline,
    } = await runGpuAllocationTransaction(
      this.device,
      `Pipeline formato layer ${format}`,
      () => {
    const brushPipelineLayout = this.device.createPipelineLayout({
      label: `Brush legacy pipeline layout ${format}`,
      bindGroupLayouts: [this.brushBindGroupLayout],
    });
    const brushOccupancyPipelineLayout = this.device.createPipelineLayout({
      label: `Brush occupancy pipeline layout ${format}`,
      bindGroupLayouts: [this.brushOccupancyBindGroupLayout],
    });
    const grainBrushPipelineLayout = this.device.createPipelineLayout({
      label: `Texturized grain brush pipeline layout ${format}`,
      bindGroupLayouts: [this.grainBrushBindGroupLayout],
    });
    const grainBrushOccupancyPipelineLayout = this.device.createPipelineLayout({
      label: `Texturized grain occupancy pipeline layout ${format}`,
      bindGroupLayouts: [this.grainBrushOccupancyBindGroupLayout],
    });
    const paintMipDownsamplePipelineLayout = this.device.createPipelineLayout({
      label: `Paint display mip downsample pipeline layout ${format}`,
      bindGroupLayouts: [this.paintMipDownsampleBindGroupLayout],
    });
    const layerCompositePipelineLayout = this.device.createPipelineLayout({
      label: `Layer source-over fold pipeline layout ${format}`,
      bindGroupLayouts: [this.layerCompositeBindGroupLayout],
    });
    const lightGlazeCompositeMipPipelineLayout = this.device.createPipelineLayout({
      label: `Light Glaze composited mip 1 pipeline layout ${format}`,
      bindGroupLayouts: [this.lightGlazeCompositeMipBindGroupLayout],
    });
    const lightGlazeCompositePipelineLayout = this.device.createPipelineLayout({
      label: `Light Glaze final composite pipeline layout ${format}`,
      bindGroupLayouts: [this.lightGlazeCompositeBindGroupLayout],
    });

    const normalPipeline = this.device.createRenderPipeline({
      label: `Brush normal ${format}`,
      layout: brushPipelineLayout,
      vertex: {
        module: this.brushShaderModule,
        entryPoint: "vertexMain",
      },
      fragment: {
        module: this.brushShaderModule,
        entryPoint: "fragmentMain",
        targets: [
          {
            format,
            blend: {
              color: {
                operation: "add",
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
              },
              alpha: {
                operation: "add",
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
              },
            },
          },
        ],
      },
      primitive: { topology: "triangle-strip" },
    });

    const additivePipeline = this.device.createRenderPipeline({
      label: `Brush additive ${format}`,
      layout: brushPipelineLayout,
      vertex: {
        module: this.brushShaderModule,
        entryPoint: "vertexMain",
      },
      fragment: {
        module: this.brushShaderModule,
        entryPoint: "fragmentMain",
        targets: [
          {
            format,
            blend: {
              color: {
                operation: "add",
                srcFactor: "one",
                dstFactor: "one",
              },
              alpha: {
                operation: "add",
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
              },
            },
          },
        ],
      },
      primitive: { topology: "triangle-strip" },
    });

    const shapeNormalPipeline = this.device.createRenderPipeline({
      label: `Brush shape 2K legacy normal ${format}`,
      layout: brushPipelineLayout,
      vertex: {
        module: this.brushShaderModule,
        entryPoint: "shapeVertexMain",
      },
      fragment: {
        module: this.brushShaderModule,
        entryPoint: "shapeFragmentMain",
        targets: [
          {
            format,
            blend: {
              color: {
                operation: "add",
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
              },
              alpha: {
                operation: "add",
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
              },
            },
          },
        ],
      },
      primitive: { topology: "triangle-strip" },
    });

    const shapeAdditivePipeline = this.device.createRenderPipeline({
      label: `Brush shape 2K legacy additive ${format}`,
      layout: brushPipelineLayout,
      vertex: {
        module: this.brushShaderModule,
        entryPoint: "shapeVertexMain",
      },
      fragment: {
        module: this.brushShaderModule,
        entryPoint: "shapeFragmentMain",
        targets: [
          {
            format,
            blend: {
              color: {
                operation: "add",
                srcFactor: "one",
                dstFactor: "one",
              },
              alpha: {
                operation: "add",
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
              },
            },
          },
        ],
      },
      primitive: { topology: "triangle-strip" },
    });

    const shapeOccupancyNormalPipeline = this.device.createRenderPipeline({
      label: `Brush shape 2K occupancy normal ${format}`,
      layout: brushOccupancyPipelineLayout,
      vertex: {
        module: this.brushShaderModule,
        entryPoint: "shapeVertexMain",
      },
      fragment: {
        module: this.brushShaderModule,
        entryPoint: "shapeOccupancyFragmentMain",
        targets: [
          {
            format,
            blend: {
              color: {
                operation: "add",
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
              },
              alpha: {
                operation: "add",
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
              },
            },
          },
        ],
      },
      primitive: { topology: "triangle-strip" },
    });

    const shapeOccupancyAdditivePipeline = this.device.createRenderPipeline({
      label: `Brush shape 2K occupancy additive ${format}`,
      layout: brushOccupancyPipelineLayout,
      vertex: {
        module: this.brushShaderModule,
        entryPoint: "shapeVertexMain",
      },
      fragment: {
        module: this.brushShaderModule,
        entryPoint: "shapeOccupancyFragmentMain",
        targets: [
          {
            format,
            blend: {
              color: {
                operation: "add",
                srcFactor: "one",
                dstFactor: "one",
              },
              alpha: {
                operation: "add",
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
              },
            },
          },
        ],
      },
      primitive: { topology: "triangle-strip" },
    });

    const grainNormalPipeline = this.device.createRenderPipeline({
      label: `Brush Texturized grain normal ${format}`,
      layout: grainBrushPipelineLayout,
      vertex: {
        module: this.brushShaderModule,
        entryPoint: "vertexMain",
      },
      fragment: {
        module: this.texturizedGrainShaderModule,
        entryPoint: "fragmentMain",
        targets: [
          {
            format,
            blend: {
              color: {
                operation: "add",
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
              },
              alpha: {
                operation: "add",
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
              },
            },
          },
        ],
      },
      primitive: { topology: "triangle-strip" },
    });

    const grainAdditivePipeline = this.device.createRenderPipeline({
      label: `Brush Texturized grain additive ${format}`,
      layout: grainBrushPipelineLayout,
      vertex: {
        module: this.brushShaderModule,
        entryPoint: "vertexMain",
      },
      fragment: {
        module: this.texturizedGrainShaderModule,
        entryPoint: "fragmentMain",
        targets: [
          {
            format,
            blend: {
              color: {
                operation: "add",
                srcFactor: "one",
                dstFactor: "one",
              },
              alpha: {
                operation: "add",
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
              },
            },
          },
        ],
      },
      primitive: { topology: "triangle-strip" },
    });

    const grainShapeNormalPipeline = this.device.createRenderPipeline({
      label: `Brush Shape 2K Texturized grain normal ${format}`,
      layout: grainBrushPipelineLayout,
      vertex: {
        module: this.brushShaderModule,
        entryPoint: "shapeVertexMain",
      },
      fragment: {
        module: this.texturizedGrainShaderModule,
        entryPoint: "shapeFragmentMain",
        targets: [
          {
            format,
            blend: {
              color: {
                operation: "add",
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
              },
              alpha: {
                operation: "add",
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
              },
            },
          },
        ],
      },
      primitive: { topology: "triangle-strip" },
    });

    const grainShapeAdditivePipeline = this.device.createRenderPipeline({
      label: `Brush Shape 2K Texturized grain additive ${format}`,
      layout: grainBrushPipelineLayout,
      vertex: {
        module: this.brushShaderModule,
        entryPoint: "shapeVertexMain",
      },
      fragment: {
        module: this.texturizedGrainShaderModule,
        entryPoint: "shapeFragmentMain",
        targets: [
          {
            format,
            blend: {
              color: {
                operation: "add",
                srcFactor: "one",
                dstFactor: "one",
              },
              alpha: {
                operation: "add",
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
              },
            },
          },
        ],
      },
      primitive: { topology: "triangle-strip" },
    });

    const grainShapeOccupancyNormalPipeline = this.device.createRenderPipeline({
      label: `Brush Shape 2K occupancy Texturized grain normal ${format}`,
      layout: grainBrushOccupancyPipelineLayout,
      vertex: {
        module: this.brushShaderModule,
        entryPoint: "shapeVertexMain",
      },
      fragment: {
        module: this.texturizedGrainShaderModule,
        entryPoint: "shapeOccupancyFragmentMain",
        targets: [
          {
            format,
            blend: {
              color: {
                operation: "add",
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
              },
              alpha: {
                operation: "add",
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
              },
            },
          },
        ],
      },
      primitive: { topology: "triangle-strip" },
    });

    const grainShapeOccupancyAdditivePipeline = this.device.createRenderPipeline({
      label: `Brush Shape 2K occupancy Texturized grain additive ${format}`,
      layout: grainBrushOccupancyPipelineLayout,
      vertex: {
        module: this.brushShaderModule,
        entryPoint: "shapeVertexMain",
      },
      fragment: {
        module: this.texturizedGrainShaderModule,
        entryPoint: "shapeOccupancyFragmentMain",
        targets: [
          {
            format,
            blend: {
              color: {
                operation: "add",
                srcFactor: "one",
                dstFactor: "one",
              },
              alpha: {
                operation: "add",
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
              },
            },
          },
        ],
      },
      primitive: { topology: "triangle-strip" },
    });

    const createM1GlazePipeline = (
      label: string,
      layout: GPUPipelineLayout,
      fragmentModule: GPUShaderModule,
      vertexEntryPoint: "vertexMain" | "shapeVertexMain",
      fragmentEntryPoint:
        | "coverageFragmentMain"
        | "shapeCoverageFragmentMain"
        | "shapeOccupancyCoverageFragmentMain",
    ): GPURenderPipeline => this.device.createRenderPipeline({
      label,
      layout,
      vertex: {
        module: this.brushShaderModule,
        entryPoint: vertexEntryPoint,
      },
      fragment: {
        module: fragmentModule,
        entryPoint: fragmentEntryPoint,
        targets: [
          {
            format: "r8unorm",
            blend: {
              color: {
                operation: "max",
                srcFactor: "one",
                dstFactor: "one",
              },
              alpha: {
                operation: "max",
                srcFactor: "one",
                dstFactor: "one",
              },
            },
          },
        ],
      },
      primitive: { topology: "triangle-strip" },
    });
    const m1GlazePipeline = createM1GlazePipeline(
      `Brush M1 Glaze circle MAX coverage r8unorm`,
      brushPipelineLayout,
      this.brushShaderModule,
      "vertexMain",
      "coverageFragmentMain",
    );
    const m1GlazeShapePipeline = createM1GlazePipeline(
      `Brush M1 Glaze Shape MAX coverage r8unorm`,
      brushPipelineLayout,
      this.brushShaderModule,
      "shapeVertexMain",
      "shapeCoverageFragmentMain",
    );
    const m1GlazeShapeOccupancyPipeline = createM1GlazePipeline(
      `Brush M1 Glaze Shape occupancy MAX coverage r8unorm`,
      brushOccupancyPipelineLayout,
      this.brushShaderModule,
      "shapeVertexMain",
      "shapeOccupancyCoverageFragmentMain",
    );
    const grainM1GlazePipeline = createM1GlazePipeline(
      `Brush M1 Glaze Texturized circle MAX coverage r8unorm`,
      grainBrushPipelineLayout,
      this.texturizedGrainShaderModule,
      "vertexMain",
      "coverageFragmentMain",
    );
    const grainM1GlazeShapePipeline = createM1GlazePipeline(
      `Brush M1 Glaze Texturized Shape MAX coverage r8unorm`,
      grainBrushPipelineLayout,
      this.texturizedGrainShaderModule,
      "shapeVertexMain",
      "shapeCoverageFragmentMain",
    );
    const grainM1GlazeShapeOccupancyPipeline = createM1GlazePipeline(
      `Brush M1 Glaze Texturized Shape occupancy MAX coverage r8unorm`,
      grainBrushOccupancyPipelineLayout,
      this.texturizedGrainShaderModule,
      "shapeVertexMain",
      "shapeOccupancyCoverageFragmentMain",
    );

    const lightGlazeCompositeMipPipeline = this.device.createRenderPipeline({
      label: `Light Glaze composited mip 1 ${format}`,
      layout: lightGlazeCompositeMipPipelineLayout,
      vertex: {
        module: this.lightGlazeCompositeMipShaderModule,
        entryPoint: "vertexMain",
      },
      fragment: {
        module: this.lightGlazeCompositeMipShaderModule,
        entryPoint: "fragmentMain",
        targets: [{ format }],
      },
      primitive: { topology: "triangle-list" },
    });

    const lightGlazeCompositePipeline = this.device.createRenderPipeline({
      label: `Light Glaze final source-over composite ${format}`,
      layout: lightGlazeCompositePipelineLayout,
      vertex: {
        module: this.lightGlazeCompositeShaderModule,
        entryPoint: "vertexMain",
      },
      fragment: {
        module: this.lightGlazeCompositeShaderModule,
        entryPoint: "fragmentMain",
        targets: [
          {
            format,
            blend: {
              color: {
                operation: "add",
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
              },
              alpha: {
                operation: "add",
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
              },
            },
          },
        ],
      },
      primitive: { topology: "triangle-list" },
    });

    const paintMipDownsamplePipeline = this.device.createRenderPipeline({
      label: `Paint display mip downsample ${format}`,
      layout: paintMipDownsamplePipelineLayout,
      vertex: {
        module: this.paintMipDownsampleShaderModule,
        entryPoint: "vertexMain",
      },
      fragment: {
        module: this.paintMipDownsampleShaderModule,
        entryPoint: "fragmentMain",
        targets: [{ format }],
      },
      primitive: { topology: "triangle-list" },
    });
    const layerCompositePipeline = this.device.createRenderPipeline({
      label: `Layer source-over fold ${format}`,
      layout: layerCompositePipelineLayout,
      vertex: { module: this.layerCompositeShaderModule, entryPoint: "vertexMain" },
      fragment: {
        module: this.layerCompositeShaderModule,
        entryPoint: "fragmentMain",
        targets: [{
          format,
          blend: {
            color: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" },
            alpha: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" },
          },
        }],
      },
      primitive: { topology: "triangle-list" },
    });
        return {
          normalPipeline,
          additivePipeline,
          shapeNormalPipeline,
          shapeAdditivePipeline,
          shapeOccupancyNormalPipeline,
          shapeOccupancyAdditivePipeline,
          grainNormalPipeline,
          grainAdditivePipeline,
          grainShapeNormalPipeline,
          grainShapeAdditivePipeline,
          grainShapeOccupancyNormalPipeline,
          grainShapeOccupancyAdditivePipeline,
          m1GlazePipeline,
          m1GlazeShapePipeline,
          m1GlazeShapeOccupancyPipeline,
          grainM1GlazePipeline,
          grainM1GlazeShapePipeline,
          grainM1GlazeShapeOccupancyPipeline,
          lightGlazeCompositeMipPipeline,
          lightGlazeCompositePipeline,
          paintMipDownsamplePipeline,
          layerCompositePipeline,
        };
      },
    );

    // A format change invalidates every layer's texture, not just the active one,
    // and setLayerFormat already tells the user the content is cleared.
    //
    // Allocate everything BEFORE destroying anything. Destroying first would mean
    // an OOM partway through the remaining layers left the document with neither
    // the old textures nor the new ones — losing content the caller was told it
    // could still recover, since setLayerFormat's error path restores the previous
    // format and expects the old resources to still be there.
    const replacement = new Map<number, LayerGpuResources>();
    let blendRenderer: DryBlendRenderer | null = null;
    let nextEffectsWorkbench: EffectsWorkbench | null = null;
    let nextDisplayPyramid: DisplayPyramidResources | null = null;
    let nextTransparentTexture: GPUTexture | null = null;
    let nextTransparentView: GPUTextureView | null = null;
    try {
      const displayInfrastructure = await runGpuAllocationTransaction(
        this.device,
        `Display layer infrastructure ${format}`,
        (transaction) => {
          const pyramid = this.allocateActiveLayerDisplayPyramid(format);
          transaction.deferRollback(() => pyramid.texture.destroy());
          const transparentTexture = this.device.createTexture({
            label: `Transparent layer placeholder ${format}`,
            size: { width: 1, height: 1, depthOrArrayLayers: 1 },
            format,
            usage: GPUTextureUsage.TEXTURE_BINDING,
          });
          transaction.deferRollback(() => transparentTexture.destroy());
          return {
            pyramid,
            transparentTexture,
            transparentView: transparentTexture.createView(),
          };
        },
      );
      nextDisplayPyramid = displayInfrastructure.pyramid;
      nextTransparentTexture = displayInfrastructure.transparentTexture;
      nextTransparentView = displayInfrastructure.transparentView;
      for (const record of this.layerStack.layers) {
        const gpu = record.id === this.layerStack.active.id
          ? await this.allocateLayerGpuResources(
            format,
            `Cambio formato: livello ${record.id}`,
          )
          : this.createColdLayerGpuResources();
        replacement.set(record.id, gpu);
      }

      const activeGpu = replacement.get(this.layerStack.active.id);
      const activeHot = activeGpu?.hot;
      if (!activeGpu || !activeHot) {
        throw new Error("Risorse candidate mancanti per il livello attivo.");
      }
      blendRenderer = await runGpuAllocationTransaction(
        this.device,
        `Renderer Blend formato ${format}`,
        async (transaction) => {
          const candidate = await DryBlendRenderer.create({
            device: this.device,
            documentWidth: LAYER_SIZE,
            documentHeight: LAYER_SIZE,
            layerFormat: format,
            layerView: activeHot.view,
            layerSamplingView: activeHot.samplingView,
            shapeMaskView: this.shapeMaskView,
            shapeMaskSampler: this.shapeMaskSampler,
            grainTextureView: this.grainTextureView,
            grainSamplers: this.grainSamplers,
          });
          transaction.deferRollback(() => candidate.destroy());
          return candidate;
        },
      );
      nextEffectsWorkbench = new EffectsWorkbench({
        device: this.device,
        view: activeHot.view,
        format,
        canReallocateScratch: () => this.activeStroke === null,
        initialScratchPeakBytes: previousScratchPeakBytes,
      });
    } catch (error) {
      // Nothing has been swapped in yet: every candidate is disposable and all
      // old textures/renderers still describe the intact document.
      nextEffectsWorkbench?.destroy();
      blendRenderer?.destroy();
      nextDisplayPyramid?.texture.destroy();
      nextTransparentTexture?.destroy();
      for (const gpu of replacement.values()) {
        this.destroyLayerGpuResources(gpu);
      }
      throw error;
    }

    const activeGpu = replacement.get(this.layerStack.active.id);
    const activeHot = activeGpu?.hot;
    if (
      !activeGpu
      || !activeHot
      || !blendRenderer
      || !nextEffectsWorkbench
      || !nextDisplayPyramid
      || !nextTransparentTexture
      || !nextTransparentView
    ) {
      nextEffectsWorkbench?.destroy();
      blendRenderer?.destroy();
      nextDisplayPyramid?.texture.destroy();
      nextTransparentTexture?.destroy();
      for (const gpu of replacement.values()) {
        this.destroyLayerGpuResources(gpu);
      }
      throw new Error("Transazione cambio formato incompleta.");
    }
    const { texture, view, samplingView } = activeHot;

    this.destroyLightGlazeResources();
    this.destroyThicknessTailOverlayResources();
    const supersededLayerGpu = [...this.layerGpu.values()];
    const supersededDisplayPyramid = this.activeLayerDisplayPyramid;
    const supersededTransparentTexture = this.transparentLayerTexture;
    const supersededMergedBelow = this.mergedBelow;
    const supersededMergedAbove = this.mergedAbove;
    const supersededMixedSceneRasterSegments = this.mixedSceneRasterSegments;
    this.layerGpu.clear();
    for (const [layerId, gpu] of replacement) {
      this.layerGpu.set(layerId, gpu);
    }
    for (const other of this.layerStack.layers) {
      if (other.id === this.layerStack.active.id) {
        continue;
      }
      other.contentBounds = null;
      other.hasContent = false;
      clearLayerStorageTileMask(other.storageTileMask);
    }
    this.layerTexture = texture;
    this.layerView = view;
    this.layerSamplingView = samplingView;
    this.blendRenderer = blendRenderer;
    this.activeLayerDisplayPyramid = nextDisplayPyramid;
    this.transparentLayerTexture = nextTransparentTexture;
    this.transparentLayerView = nextTransparentView;
    this.mergedBelow = null;
    this.mergedAbove = null;
    this.mixedSceneRasterSegments = [];
    this.mixedSceneCompositionSegments = this.mixedSceneStack?.textCount
      ? this.mixedSceneStack.compositionSegments(this.layerStack.active.id)
      : [];
    this.normalPipeline = normalPipeline;
    this.additivePipeline = additivePipeline;
    this.shapeNormalPipeline = shapeNormalPipeline;
    this.shapeAdditivePipeline = shapeAdditivePipeline;
    this.shapeOccupancyNormalPipeline = shapeOccupancyNormalPipeline;
    this.shapeOccupancyAdditivePipeline = shapeOccupancyAdditivePipeline;
    this.grainNormalPipeline = grainNormalPipeline;
    this.grainAdditivePipeline = grainAdditivePipeline;
    this.grainShapeNormalPipeline = grainShapeNormalPipeline;
    this.grainShapeAdditivePipeline = grainShapeAdditivePipeline;
    this.grainShapeOccupancyNormalPipeline = grainShapeOccupancyNormalPipeline;
    this.grainShapeOccupancyAdditivePipeline = grainShapeOccupancyAdditivePipeline;
    this.m1GlazePipeline = m1GlazePipeline;
    this.m1GlazeShapePipeline = m1GlazeShapePipeline;
    this.m1GlazeShapeOccupancyPipeline = m1GlazeShapeOccupancyPipeline;
    this.grainM1GlazePipeline = grainM1GlazePipeline;
    this.grainM1GlazeShapePipeline = grainM1GlazeShapePipeline;
    this.grainM1GlazeShapeOccupancyPipeline = grainM1GlazeShapeOccupancyPipeline;
    this.lightGlazeCompositeMipPipeline = lightGlazeCompositeMipPipeline;
    this.lightGlazeCompositePipeline = lightGlazeCompositePipeline;
    this.paintMipDownsamplePipeline = paintMipDownsamplePipeline;
    this.layerCompositePipeline = layerCompositePipeline;
    this.layerFormat = format;
    this.rebuildActiveLayerPyramidBindings();
    this.rebuildLayerDisplayBindGroups();
    // The direct Traccia LOD 0 path uses the format flag to reproduce the
    // quantization that the removed full-resolution styled texture applied.
    this.writeLightGlazeUniforms(1, "source-over", null);
    this.paintDisplayMipValidThroughLevel = 0;
    this.paintDisplaySelectedMipLevel = 0;
    this.presentationCacheNeedsFullRebuild = true;
    this.releaseRasterStrokeRenderer();
    this.releaseRasterBevelRenderer();
    this.releaseRasterOuterShadowRenderer();
    this.releaseRasterInnerShadowRenderer();
    oldEffectsWorkbench?.destroy();
    this.effectsWorkbench = nextEffectsWorkbench;
    oldBlendRenderer?.destroy();
    supersededDisplayPyramid?.texture.destroy();
    supersededTransparentTexture?.destroy();
    this.destroyMergedSurface(supersededMergedBelow);
    this.destroyMergedSurface(supersededMergedAbove);
    for (const segment of supersededMixedSceneRasterSegments) {
      this.destroyMixedSceneRasterSegment(segment);
    }
    for (const gpu of supersededLayerGpu) {
      this.destroyLayerGpuResources(gpu);
    }
  }

  private ensureThicknessTailOverlayResources(
    minimumWidth: number,
    minimumHeight: number,
  ): void {
    const roundedWidth = clamp(
      Math.ceil(Math.max(1, minimumWidth) / THICKNESS_TAIL_TEXTURE_QUANTUM)
        * THICKNESS_TAIL_TEXTURE_QUANTUM,
      THICKNESS_TAIL_TEXTURE_QUANTUM,
      THICKNESS_TAIL_MAXIMUM_TEXTURE_DIMENSION,
    );
    const roundedHeight = clamp(
      Math.ceil(Math.max(1, minimumHeight) / THICKNESS_TAIL_TEXTURE_QUANTUM)
        * THICKNESS_TAIL_TEXTURE_QUANTUM,
      THICKNESS_TAIL_TEXTURE_QUANTUM,
      THICKNESS_TAIL_MAXIMUM_TEXTURE_DIMENSION,
    );
    if (
      this.thicknessTailTexture
      && this.thicknessTailView
      && this.thicknessTailDisplayBindGroup
      && this.thicknessTailTextureWidth >= roundedWidth
      && this.thicknessTailTextureHeight >= roundedHeight
    ) {
      return;
    }

    const width = Math.max(this.thicknessTailTextureWidth, roundedWidth);
    const height = Math.max(this.thicknessTailTextureHeight, roundedHeight);
    const texture = this.device.createTexture({
      label: `Predictive thickness tail ${width}×${height} ${this.layerFormat}`,
      size: { width, height, depthOrArrayLayers: 1 },
      format: this.layerFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const view = texture.createView({ label: "Predictive thickness tail view" });
    const displayBindGroup = this.device.createBindGroup({
      label: "Predictive thickness tail display bind group",
      layout: this.thicknessTailDisplayBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.displayUniformBuffer } },
        { binding: 1, resource: this.layerSamplingView },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: view },
        { binding: 4, resource: { buffer: this.thicknessTailDisplayUniformBuffer } },
        { binding: 5, resource: this.activeLayerDisplayPyramid.samplingView },
        { binding: 6, resource: this.mergedBelowView() },
        { binding: 7, resource: this.mergedAboveView() },
        { binding: 8, resource: this.vectorTextBelowView ?? this.transparentLayerView },
        { binding: 9, resource: this.vectorTextAboveView ?? this.transparentLayerView },
      ],
    });

    const oldTexture = this.thicknessTailTexture;
    this.thicknessTailTexture = texture;
    this.thicknessTailView = view;
    this.thicknessTailDisplayBindGroup = displayBindGroup;
    this.thicknessTailTextureWidth = width;
    this.thicknessTailTextureHeight = height;
    this.rasterStrokeRenderer?.setThicknessTailView(view);
    this.rasterBevelRenderer?.setThicknessTailView(view);
    this.rasterOuterShadowRenderer?.setThicknessTailView(view);
    this.rasterInnerShadowRenderer?.setThicknessTailView(view);
    this.rebuildRasterStrokeDisplayBindGroups();
    oldTexture?.destroy();
  }

  private destroyThicknessTailOverlayResources(): void {
    this.rasterStrokeRenderer?.setThicknessTailView(null);
    this.rasterBevelRenderer?.setThicknessTailView(null);
    this.rasterOuterShadowRenderer?.setThicknessTailView(null);
    this.rasterInnerShadowRenderer?.setThicknessTailView(null);
    this.rebuildRasterStrokeDisplayBindGroups();
    this.thicknessTailTexture?.destroy();
    this.thicknessTailTexture = null;
    this.thicknessTailView = null;
    this.thicknessTailDisplayBindGroup = null;
    this.thicknessTailTextureWidth = 0;
    this.thicknessTailTextureHeight = 0;
    this.thicknessTailPresentedRect = null;
  }

  private ensureLightGlazeResources(blendMode: BlendMode): void {
    const storageMode: LightGlazeStorageMode = blendMode === "m1-glaze"
      ? "r8-coverage"
      : "rgba-stroke";
    if (
      this.lightGlazeTexture
      && this.lightGlazeCompositeMipTexture
      && this.lightGlazeView
      && this.lightGlazeSamplingView
      && this.lightGlazeCompositeMipBindGroup
      && this.lightGlazeDisplayBindGroup
      && this.lightGlazeCompositeBindGroup
      && this.lightGlazeStorageMode === storageMode
    ) {
      return;
    }
    if (this.lightGlazeTexture || this.lightGlazeCompositeMipTexture) {
      this.destroyLightGlazeResources();
    }

    const accumulatorFormat: GPUTextureFormat = storageMode === "r8-coverage"
      ? "r8unorm"
      : this.layerFormat;
    const texture = this.device.createTexture({
      label: `Lazy Light Glaze stroke accumulator ${accumulatorFormat}`,
      size: { width: LAYER_SIZE, height: LAYER_SIZE, depthOrArrayLayers: 1 },
      format: accumulatorFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const compositeMipTexture = this.device.createTexture({
      label: `Lazy Light Glaze composited logical mip 1+ ${this.layerFormat}`,
      size: {
        width: Math.max(1, LAYER_SIZE >> 1),
        height: Math.max(1, LAYER_SIZE >> 1),
        depthOrArrayLayers: 1,
      },
      mipLevelCount: PAINT_DISPLAY_MIP_LEVEL_COUNT - 1,
      format: this.layerFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const view = texture.createView({
      label: "Light Glaze authoritative stroke mip 0",
    });
    const samplingView = compositeMipTexture.createView({
      label: "Light Glaze final-composite logical mip 1+ sampling chain",
      baseMipLevel: 0,
      mipLevelCount: PAINT_DISPLAY_MIP_LEVEL_COUNT - 1,
    });
    const compositeMipViews = Array.from(
      { length: PAINT_DISPLAY_MIP_LEVEL_COUNT - 1 },
      (_, mipIndex) => compositeMipTexture.createView({
        label: `Light Glaze final-composite logical mip ${mipIndex + 1}`,
        baseMipLevel: mipIndex,
        mipLevelCount: 1,
      }),
    );
    const downsampleBindGroups = compositeMipViews
      .slice(0, -1)
      .map((sourceView, sourceMipIndex) => this.device.createBindGroup({
        label: `Light Glaze logical mip ${sourceMipIndex + 1} to ${sourceMipIndex + 2}`,
        layout: this.paintMipDownsampleBindGroupLayout,
        entries: [{ binding: 0, resource: sourceView }],
      }));
    const compositeMipBindGroup = this.device.createBindGroup({
      label: "Light Glaze permanent + stroke to composited logical mip 1",
      layout: this.lightGlazeCompositeMipBindGroupLayout,
      entries: [
        { binding: 0, resource: this.layerView },
        { binding: 1, resource: view },
        { binding: 2, resource: { buffer: this.lightGlazeUniformBuffer } },
      ],
    });
    const displayBindGroup = this.device.createBindGroup({
      label: "Light Glaze live display bind group",
      layout: this.lightGlazeDisplayBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.displayUniformBuffer } },
        { binding: 1, resource: this.layerSamplingView },
        { binding: 2, resource: view },
        { binding: 3, resource: this.sampler },
        { binding: 4, resource: { buffer: this.lightGlazeUniformBuffer } },
        { binding: 5, resource: samplingView },
        { binding: 6, resource: this.mergedBelowView() },
        { binding: 7, resource: this.mergedAboveView() },
        { binding: 8, resource: this.vectorTextBelowView ?? this.transparentLayerView },
        { binding: 9, resource: this.vectorTextAboveView ?? this.transparentLayerView },
      ],
    });
    const compositeBindGroup = this.device.createBindGroup({
      label: "Light Glaze final composite bind group",
      layout: this.lightGlazeCompositeBindGroupLayout,
      entries: [
        { binding: 0, resource: view },
        { binding: 1, resource: { buffer: this.lightGlazeUniformBuffer } },
      ],
    });

    this.lightGlazeTexture = texture;
    this.lightGlazeCompositeMipTexture = compositeMipTexture;
    this.lightGlazeView = view;
    this.lightGlazeSamplingView = samplingView;
    this.lightGlazeMipViews = [view, ...compositeMipViews];
    this.lightGlazeMipDownsampleBindGroups = downsampleBindGroups;
    this.lightGlazeCompositeMipBindGroup = compositeMipBindGroup;
    this.lightGlazeDisplayBindGroup = displayBindGroup;
    this.lightGlazeCompositeBindGroup = compositeBindGroup;
    this.lightGlazeStorageAllocated = true;
    this.lightGlazeStorageMode = storageMode;
    this.rasterStrokeRenderer?.setLightGlazeView(view);
    this.rasterBevelRenderer?.setLightGlazeView(view);
    this.rasterOuterShadowRenderer?.setLightGlazeView(view);
    this.rasterInnerShadowRenderer?.setLightGlazeView(view);
    this.rebuildRasterStrokeDisplayBindGroups();
  }
  private destroyLightGlazeResources(): void {
    this.rasterStrokeRenderer?.setLightGlazeView(null);
    this.rasterBevelRenderer?.setLightGlazeView(null);
    this.rasterOuterShadowRenderer?.setLightGlazeView(null);
    this.rasterInnerShadowRenderer?.setLightGlazeView(null);
    this.rebuildRasterStrokeDisplayBindGroups();
    this.lightGlazeSession = null;
    this.lightGlazeTexture?.destroy();
    this.lightGlazeCompositeMipTexture?.destroy();
    this.lightGlazeTexture = null;
    this.lightGlazeCompositeMipTexture = null;
    this.lightGlazeView = null;
    this.lightGlazeSamplingView = null;
    this.lightGlazeMipViews = [];
    this.lightGlazeMipDownsampleBindGroups = [];
    this.lightGlazeCompositeMipBindGroup = null;
    this.lightGlazeDisplayBindGroup = null;
    this.lightGlazeCompositeBindGroup = null;
    this.lightGlazeStorageAllocated = false;
    this.lightGlazeStorageMode = "none";
  }

  private startLightGlazeSession(historyActionId: number, settings: BrushSettings): void {
    if (this.lightGlazeSession) {
      throw new Error("Un tratto Light Glaze precedente non è ancora stato finalizzato.");
    }
    this.ensureLightGlazeResources(settings.blendMode);
    this.lightGlazeSession = {
      historyActionId,
      settings: {
        ...settings,
        opacity: Number.isFinite(settings.opacity) ? clamp(settings.opacity, 0, 1) : 1,
        blendMode: settings.blendMode === "m1-glaze" ? "m1-glaze" : "light-glaze",
      },
      dirtyRect: null,
      needsClear: true,
      hasContent: false,
      endRequested: false,
      commitRequested: false,
      mipValidThroughLevel: 0,
      tintLinear: null,
    };
  }

  private abandonLightGlazeSession(): void {
    if (!this.lightGlazeSession) {
      return;
    }
    this.lightGlazeSession = null;
    // The screen cache may contain the transient live composite. Any caller
    // that abandons a stroke (reset, cancel or failure) must rebuild it before
    // it is shown again.
    this.presentationCacheNeedsFullRebuild = true;
    this.deferRasterStrokeMutation(false);
  }

  private flushClosingLightGlazeSessionBeforeNewStroke(): void {
    if (!this.lightGlazeSession?.endRequested) {
      return;
    }

    let iterations = 0;
    const maximumIterations = Math.ceil(this.pendingStamps.length / MAX_STAMPS_PER_BATCH) + 2;
    while (this.lightGlazeSession?.endRequested) {
      if (this.frameRequest !== null) {
        cancelAnimationFrame(this.frameRequest);
        this.frameRequest = null;
      }
      this.renderFrame(performance.now());
      iterations += 1;
      if (iterations > maximumIterations) {
        throw new Error("Impossibile finalizzare il tratto Light Glaze precedente.");
      }
    }
  }

  private flushPendingWorkBeforeSettingsChange(): void {
    if (!this.initialized || this.activeStroke || this.historyBusy) {
      return;
    }

    // Pointer-up may leave the last interactive batch queued until the next
    // animation frame. Preserve the settings that produced those stamps before
    // a control change can replace them. For Light Glaze this also guarantees
    // that the old accumulator is committed before another blend mode starts.
    this.flushClosingLightGlazeSessionBeforeNewStroke();
    if (
      this.lightGlazeSession
      || (this.pendingStamps.length === 0 && this.pendingBlendBatches.length === 0)
    ) {
      return;
    }

    let iterations = 0;
    // Il drenaggio Blend è a budget di pixel: nel caso peggiore (ROI enormi)
    // un frame consuma un solo batch, quindi il tetto usa quel minimo garantito.
    const maximumIterations = Math.ceil(this.pendingStamps.length / MAX_STAMPS_PER_BATCH)
      + this.pendingBlendBatches.length
      + 2;
    while (this.pendingStamps.length > 0 || this.pendingBlendBatches.length > 0) {
      if (this.frameRequest !== null) {
        cancelAnimationFrame(this.frameRequest);
        this.frameRequest = null;
      }
      const pendingBeforeRender = this.pendingStamps.length + this.pendingBlendBatches.length;
      this.renderFrame(performance.now());
      iterations += 1;
      if (
        this.pendingStamps.length + this.pendingBlendBatches.length >= pendingBeforeRender
        || iterations > maximumIterations
      ) {
        throw new Error("Impossibile finalizzare gli stamp prima del cambio impostazioni.");
      }
    }
  }

  private writeLightGlazeUniforms(
    opacity: number,
    accumulationMode: "source-over" | "m1-max-coverage",
    tintLinear: readonly [number, number, number] | null,
  ): void {
    const upload = new ArrayBuffer(LIGHT_GLAZE_UNIFORM_BYTES);
    const floats = new Float32Array(upload);
    const unsigned = new Uint32Array(upload);
    floats[0] = Number.isFinite(opacity) ? clamp(opacity, 0, 1) : 1;
    unsigned[1] = this.layerFormat === "rgba16float" ? 1 : 0;
    unsigned[2] = accumulationMode === "m1-max-coverage" ? 1 : 0;
    floats[4] = tintLinear?.[0] ?? 0;
    floats[5] = tintLinear?.[1] ?? 0;
    floats[6] = tintLinear?.[2] ?? 0;
    floats[7] = 1;
    this.device.queue.writeBuffer(this.lightGlazeUniformBuffer, 0, upload);
  }

  private normalizeLayerRect(rect: DirtyRect | null): DirtyRect | null {
    if (!rect) {
      return null;
    }
    const x = clamp(Math.floor(rect.x), 0, LAYER_SIZE);
    const y = clamp(Math.floor(rect.y), 0, LAYER_SIZE);
    const right = clamp(Math.ceil(rect.x + rect.width), 0, LAYER_SIZE);
    const bottom = clamp(Math.ceil(rect.y + rect.height), 0, LAYER_SIZE);
    return right > x && bottom > y
      ? { x, y, width: right - x, height: bottom - y }
      : null;
  }

  private mergeDirtyRects(left: DirtyRect | null, right: DirtyRect | null): DirtyRect | null {
    if (!left) {
      return right ? { ...right } : null;
    }
    if (!right) {
      return { ...left };
    }
    const x = Math.min(left.x, right.x);
    const y = Math.min(left.y, right.y);
    const maximumX = Math.max(left.x + left.width, right.x + right.width);
    const maximumY = Math.max(left.y + left.height, right.y + right.height);
    return { x, y, width: maximumX - x, height: maximumY - y };
  }

  /**
   * Conservative final-pixel domain for an inactive analytic style stack.
   * Each helper is already the authoritative invalidation bound for its effect;
   * their union is therefore safe for both the sparse bake and the fold scissor.
   */
  private layerCompositeVisualBounds(record: LayerRecord): DirtyRect {
    const fullDocumentRect: DirtyRect = {
      x: 0,
      y: 0,
      width: LAYER_SIZE,
      height: LAYER_SIZE,
    };
    const contentBounds = this.normalizeLayerRect(record.contentBounds);
    if (!contentBounds) {
      // `hasContent` with no bounds is inconsistent metadata. Preserve pixels by
      // falling back to the old full-document contract.
      return fullDocumentRect;
    }

    let bounds: DirtyRect | null = contentBounds;
    const strokeStyle = normalizeRasterStrokeStyle(record.strokeStyle);
    if (strokeStyle.enabled && strokeStyle.width > 0) {
      bounds = this.mergeDirtyRects(
        bounds,
        this.rasterStrokeEffectRect(contentBounds, strokeStyle.width),
      );
    }

    const bevelStyle = normalizeRasterBevelStyle(record.bevelStyle);
    if (bevelStyle.enabled) {
      bounds = this.mergeDirtyRects(
        bounds,
        this.rasterBevelEffectRect(contentBounds, bevelStyle),
      );
    }

    const outerShadowStyle = normalizeRasterOuterShadowStyle(record.outerShadowStyle);
    if (outerShadowStyle.enabled) {
      bounds = this.mergeDirtyRects(
        bounds,
        this.rasterOuterShadowEffectRect(contentBounds, outerShadowStyle),
      );
    }

    const innerShadowStyle = normalizeRasterInnerShadowStyle(record.innerShadowStyle);
    if (innerShadowStyle.enabled) {
      bounds = this.mergeDirtyRects(
        bounds,
        this.rasterInnerShadowEffectRect(contentBounds, innerShadowStyle),
      );
    }
    return this.normalizeLayerRect(bounds) ?? fullDocumentRect;
  }

  private rasterStrokeEffectRect(
    rect: DirtyRect | RasterStrokeRect | null,
    width = this.rasterStrokeStyle.width,
  ): DirtyRect | null {
    if (!rect) {
      return null;
    }
    const margin = Math.ceil(Math.max(0, width) + 1.5);
    const x = Math.max(0, Math.floor(rect.x) - margin);
    const y = Math.max(0, Math.floor(rect.y) - margin);
    const right = Math.min(LAYER_SIZE, Math.ceil(rect.x + rect.width) + margin);
    const bottom = Math.min(LAYER_SIZE, Math.ceil(rect.y + rect.height) + margin);
    return right > x && bottom > y
      ? { x, y, width: right - x, height: bottom - y }
      : null;
  }

  private rasterBevelEffectRect(
    rect: DirtyRect | RasterBevelRect | null,
    style: RasterBevelStyle = this.rasterBevelStyle,
  ): DirtyRect | null {
    return rasterBevelVisualBounds(rect, style, LAYER_SIZE, LAYER_SIZE);
  }

  private rasterBevelInfluenceRect(
    rect: DirtyRect | RasterBevelRect | null,
    style: RasterBevelStyle = this.rasterBevelStyle,
  ): DirtyRect | null {
    return rasterBevelInfluenceBounds(rect, style, LAYER_SIZE, LAYER_SIZE);
  }

  private rasterOuterShadowEffectRect(
    rect: DirtyRect | RasterShadowRect | null,
    style: RasterOuterShadowStyle = this.rasterOuterShadowStyle,
  ): DirtyRect | null {
    return rasterOuterShadowVisualBounds(rect, style, LAYER_SIZE, LAYER_SIZE);
  }

  private rasterOuterShadowInfluenceRect(
    rect: DirtyRect | RasterShadowRect | null,
    style: RasterOuterShadowStyle = this.rasterOuterShadowStyle,
  ): DirtyRect | null {
    return rasterOuterShadowInfluenceBounds(rect, style, LAYER_SIZE, LAYER_SIZE);
  }

  private rasterInnerShadowEffectRect(
    rect: DirtyRect | RasterShadowRect | null,
    style: RasterInnerShadowStyle = this.rasterInnerShadowStyle,
  ): DirtyRect | null {
    return rasterInnerShadowVisualBounds(rect, style, LAYER_SIZE, LAYER_SIZE);
  }

  private rasterInnerShadowInfluenceRect(
    rect: DirtyRect | RasterShadowRect | null,
    style: RasterInnerShadowStyle = this.rasterInnerShadowStyle,
  ): DirtyRect | null {
    return rasterInnerShadowInfluenceBounds(rect, style, LAYER_SIZE, LAYER_SIZE);
  }

  private noteLayerMutation(dirtyRect: DirtyRect | null, cleared: boolean): void {
    if (dirtyRect || cleared) {
      this.invalidateActiveLayerBake();
    }
    if (cleared) {
      this.layerContentBounds = null;
      clearLayerStorageTileMask(this.layerStack.active.storageTileMask);
      this.rasterStrokeCoverageValid = false;
      this.rasterBevelHeightValid = false;
      this.rasterBevelHeightSourceMode = null;
      this.rasterOuterShadowMatteValid = false;
      this.rasterOuterShadowSourceMode = null;
      this.rasterInnerShadowMatteValid = false;
      this.rasterInnerShadowSourceMode = null;
    }
    if (dirtyRect) {
      this.layerContentBounds = this.mergeDirtyRects(this.layerContentBounds, dirtyRect);
      markLayerStorageRect(this.layerStack.active.storageTileMask, dirtyRect);
    }
    if (!this.rasterStrokeActive()) {
      this.rasterStrokeCoverageValid = false;
    }
  }

  private deferRasterStrokeMutation(cleared: boolean): void {
    this.invalidateActiveLayerBake();
    this.rasterStrokeCoverageValid = false;
    this.rasterBevelHeightValid = false;
    this.rasterBevelHeightSourceMode = null;
    this.rasterOuterShadowMatteValid = false;
    this.rasterOuterShadowSourceMode = null;
    this.rasterInnerShadowMatteValid = false;
    this.rasterInnerShadowSourceMode = null;
    if (cleared) {
      this.rasterStrokeStyledInitialized = false;
      this.rasterStrokeMipValidThroughLevel = 0;
    }
  }

  private encodeRasterStrokeUpdate(
    encoder: GPUCommandEncoder,
    sourceMode: RasterStrokeSourceMode,
    mutationRect: DirtyRect | null,
    virtualContentBounds: DirtyRect | null = this.layerContentBounds,
    layerCleared = false,
    bevelContentBounds: DirtyRect | null = virtualContentBounds,
    allowBevelFieldShrink = false,
    strokeStyle: RasterStrokeStyle = this.rasterStrokeStyle,
    bevelStyle: RasterBevelStyle = this.rasterBevelStyle,
    outerShadowStyle: RasterOuterShadowStyle = this.rasterOuterShadowStyle,
    innerShadowStyle: RasterInnerShadowStyle = this.rasterInnerShadowStyle,
    shadowContentBounds: DirtyRect | null = virtualContentBounds,
  ): { dirtyRect: DirtyRect | null; timing: RasterStrokeEncodeResult | null } {
    const renderer = this.rasterStrokeRenderer;
    const styleStackActive = Boolean(
      renderer
      && ((strokeStyle.enabled && strokeStyle.width > 0)
        || bevelStyle.enabled
        || outerShadowStyle.enabled
        || innerShadowStyle.enabled)
    );
    if (!renderer || !styleStackActive) {
      if (mutationRect || layerCleared) {
        this.rasterStrokeCoverageValid = false;
        this.rasterBevelHeightValid = false;
        this.rasterBevelHeightSourceMode = null;
        this.rasterOuterShadowMatteValid = false;
        this.rasterOuterShadowSourceMode = null;
        this.rasterInnerShadowMatteValid = false;
        this.rasterInnerShadowSourceMode = null;
      }
      return { dirtyRect: mutationRect, timing: null };
    }

    if (layerCleared) {
      this.rasterStrokeCoverageValid = false;
      this.rasterBevelHeightValid = false;
      this.rasterBevelHeightSourceMode = null;
      this.rasterOuterShadowMatteValid = false;
      this.rasterOuterShadowSourceMode = null;
      this.rasterInnerShadowMatteValid = false;
      this.rasterInnerShadowSourceMode = null;
      this.rasterStrokeMipValidThroughLevel = 0;
    }
    const clearStyled = layerCleared || !this.rasterStrokeStyledInitialized;
    let composeRect: DirtyRect | null = null;

    const bevelActive = Boolean(this.rasterBevelRenderer && bevelStyle.enabled);
    if (bevelActive) {
      const bevelRenderer = this.rasterBevelRenderer!;
      const sourceChanged = this.rasterBevelHeightSourceMode !== sourceMode;
      const allowFieldShrink = allowBevelFieldShrink || (
        this.bevelFieldShrinkOnNextEncode
        && sourceMode === "permanent"
        && this.activeStroke === null
      );
      const clearHeight = !this.rasterBevelHeightValid
        || sourceChanged
        || allowFieldShrink;
      const bevelFieldBounds = this.rasterBevelInfluenceRect(bevelContentBounds, bevelStyle);
      const bevelRebuildRect = clearHeight
        ? bevelFieldBounds
        : mutationRect
          ? this.rasterBevelInfluenceRect(mutationRect, bevelStyle)
          : null;
      const bevelTiming = bevelRenderer.encode({
        encoder,
        style: bevelStyle,
        sourceMode,
        rebuildRect: bevelRebuildRect,
        changeDetectionRect: clearHeight ? null : mutationRect,
        clearHeight,
        fieldBounds: bevelFieldBounds,
        allowFieldShrink,
      });
      if (allowFieldShrink && this.bevelFieldShrinkOnNextEncode) {
        this.bevelFieldShrinkOnNextEncode = false;
      }
      if (bevelTiming.fieldReallocated) {
        renderer.setBevelResources(bevelRenderer.heightView, bevelRenderer.glossView);
        this.rebuildRasterStrokeDisplayBindGroups();
      }
      renderer.updateBevelFieldParameters(bevelTiming.fieldState);
      this.rasterBevelLastEncode = bevelTiming;
      this.rasterBevelHeightValid = true;
      this.rasterBevelHeightSourceMode = sourceMode;
      if (bevelTiming.jobs > 0 || bevelTiming.cleared) {
        this.rasterBevelTotalBuilds += 1;
        this.rasterBevelTotalPasses += bevelTiming.passes;
      }
      composeRect = this.mergeDirtyRects(
        composeRect,
        bevelTiming.fieldFullRebuild
          ? bevelTiming.fieldState.validBounds
          : bevelRebuildRect,
      );
    } else {
      this.rasterBevelHeightValid = false;
      this.rasterBevelHeightSourceMode = null;
    }
    composeRect = this.mergeDirtyRects(composeRect, this.rasterBevelPendingComposeRect);

    const outerShadowActive = Boolean(
      this.rasterOuterShadowRenderer && outerShadowStyle.enabled,
    );
    if (outerShadowActive) {
      const shadowRenderer = this.rasterOuterShadowRenderer!;
      shadowRenderer.updateStyle(outerShadowStyle);
      const sourceChanged = this.rasterOuterShadowSourceMode !== sourceMode;
      const clearMatte = !this.rasterOuterShadowMatteValid || sourceChanged;
      const rebuildRect = clearMatte
        ? this.rasterOuterShadowInfluenceRect(shadowContentBounds, outerShadowStyle)
        : mutationRect
          ? this.rasterOuterShadowInfluenceRect(mutationRect, outerShadowStyle)
          : null;
      const shadowTiming = shadowRenderer.encode({
        encoder,
        style: outerShadowStyle,
        sourceMode,
        rebuildRect,
        clearMatte,
      });
      this.rasterOuterShadowLastEncode = shadowTiming;
      this.rasterOuterShadowMatteValid = true;
      this.rasterOuterShadowSourceMode = sourceMode;
      if (shadowTiming.jobs > 0 || shadowTiming.cleared) {
        this.rasterOuterShadowTotalBuilds += 1;
        this.rasterOuterShadowTotalPasses += shadowTiming.passes;
      }
      composeRect = this.mergeDirtyRects(
        composeRect,
        clearMatte
          ? this.rasterOuterShadowEffectRect(shadowContentBounds, outerShadowStyle)
          : mutationRect
            ? this.rasterOuterShadowEffectRect(mutationRect, outerShadowStyle)
            : null,
      );
    } else {
      this.rasterOuterShadowMatteValid = false;
      this.rasterOuterShadowSourceMode = null;
    }
    composeRect = this.mergeDirtyRects(
      composeRect,
      this.rasterOuterShadowPendingComposeRect,
    );

    const innerShadowActive = Boolean(
      this.rasterInnerShadowRenderer && innerShadowStyle.enabled,
    );
    if (innerShadowActive) {
      const shadowRenderer = this.rasterInnerShadowRenderer!;
      shadowRenderer.updateStyle(innerShadowStyle);
      const sourceChanged = this.rasterInnerShadowSourceMode !== sourceMode;
      const clearMatte = !this.rasterInnerShadowMatteValid || sourceChanged;
      const rebuildRect = clearMatte
        ? this.rasterInnerShadowInfluenceRect(shadowContentBounds, innerShadowStyle)
        : mutationRect
          ? this.rasterInnerShadowInfluenceRect(mutationRect, innerShadowStyle)
          : null;
      const shadowTiming = shadowRenderer.encode({
        encoder,
        style: innerShadowStyle,
        sourceMode,
        rebuildRect,
        clearMatte,
      });
      this.rasterInnerShadowLastEncode = shadowTiming;
      this.rasterInnerShadowMatteValid = true;
      this.rasterInnerShadowSourceMode = sourceMode;
      if (shadowTiming.jobs > 0 || shadowTiming.cleared) {
        this.rasterInnerShadowTotalBuilds += 1;
        this.rasterInnerShadowTotalPasses += shadowTiming.passes;
      }
      composeRect = this.mergeDirtyRects(
        composeRect,
        clearMatte
          ? this.rasterInnerShadowEffectRect(shadowContentBounds, innerShadowStyle)
          : mutationRect
            ? this.rasterInnerShadowEffectRect(mutationRect, innerShadowStyle)
            : null,
      );
    } else {
      this.rasterInnerShadowMatteValid = false;
      this.rasterInnerShadowSourceMode = null;
    }
    composeRect = this.mergeDirtyRects(
      composeRect,
      this.rasterInnerShadowPendingComposeRect,
    );

    const strokeActive = strokeStyle.enabled && strokeStyle.width > 0;
    const coverageWasValid = strokeActive && this.rasterStrokeCoverageValid;
    let rebuildRect: DirtyRect | null = null;
    let changeDetectionRect: DirtyRect | null = null;
    let conditionalComposeRect: DirtyRect | null = null;

    if (strokeActive) {
      if (!coverageWasValid) {
        rebuildRect = this.mergeDirtyRects(
          this.rasterStrokeEffectRect(
            virtualContentBounds,
            strokeStyle.width,
          ),
          this.rasterStrokePendingComposeRect,
        );
        composeRect = this.mergeDirtyRects(composeRect, rebuildRect);
      } else if (mutationRect) {
        rebuildRect = this.rasterStrokeEffectRect(
          mutationRect,
          strokeStyle.width,
        );
        changeDetectionRect = mutationRect;
        composeRect = this.mergeDirtyRects(composeRect, mutationRect);
        conditionalComposeRect = rebuildRect;
      }
    } else {
      this.rasterStrokeCoverageValid = false;
    }
    composeRect = this.mergeDirtyRects(composeRect, this.rasterStrokePendingComposeRect);
    if (mutationRect && !bevelActive && !outerShadowActive && !innerShadowActive && !strokeActive) {
      composeRect = this.mergeDirtyRects(composeRect, mutationRect);
    }

    const timing = renderer.encode({
      encoder,
      style: strokeStyle,
      bevelStyle,
      sourceMode,
      rebuildRect,
      changeDetectionRect,
      composeRect,
      conditionalComposeRect,
      clearStyled,
      resetThresholdMask: strokeActive && !coverageWasValid,
    });
    this.rasterStrokeLastEncode = timing;
    this.rasterStrokeStyledInitialized = true;
    this.rasterStrokePendingComposeRect = null;
    this.rasterBevelPendingComposeRect = null;
    this.rasterOuterShadowPendingComposeRect = null;
    this.rasterInnerShadowPendingComposeRect = null;
    if (clearStyled) {
      this.rasterStrokeMipValidThroughLevel = 0;
    }
    if (strokeActive && (rebuildRect || !virtualContentBounds)) {
      this.rasterStrokeCoverageValid = true;
    }
    if (timing.buildJobs > 0) {
      this.rasterStrokeTotalBuilds += 1;
    }
    if (timing.composeDispatches > 0 || timing.cleared) {
      this.rasterStrokeTotalComposes += 1;
    }

    return {
      dirtyRect: clearStyled
        ? { x: 0, y: 0, width: LAYER_SIZE, height: LAYER_SIZE }
        : this.mergeDirtyRects(composeRect, conditionalComposeRect),
      timing,
    };
  }

  private encodeRasterStrokeDisplayPyramid(
    encoder: GPUCommandEncoder,
    baseDirtyRect: DirtyRect | null,
    selectedMipLevel: number,
  ): { passes: number; updatedPixels: number } {
    const renderer = this.rasterStrokeRenderer;
    if (!renderer || !this.styleStackActive()) {
      return { passes: 0, updatedPixels: 0 };
    }
    const previousValidThroughLevel = this.rasterStrokeMipValidThroughLevel;
    const baseChanged = baseDirtyRect !== null;
    let sourceDirtyRect = baseDirtyRect
      ? this.downsampleDirtyRect(baseDirtyRect, 1)
      : null;
    let passes = 0;
    let updatedPixels = 0;

    // Il renderer materializza già il mip logico 1 direttamente da layer +
    // coverage. Solo i livelli 2+ vengono derivati e conservati nella catena.
    for (let mipLevel = 2; mipLevel <= selectedMipLevel; mipLevel += 1) {
      const dimensions = this.paintMipDimensions(mipLevel);
      const needsFullBuild = mipLevel > previousValidThroughLevel;
      const targetDirtyRect = needsFullBuild
        ? { x: 0, y: 0, ...dimensions }
        : sourceDirtyRect
          ? this.downsampleDirtyRect(sourceDirtyRect, mipLevel)
          : null;
      if (!targetDirtyRect || targetDirtyRect.width <= 0 || targetDirtyRect.height <= 0) {
        sourceDirtyRect = null;
        continue;
      }

      const pass = encoder.beginRenderPass({
        label: needsFullBuild
          ? `Build full Traccia styled logical mip ${mipLevel}`
          : `Update Traccia styled logical mip ${mipLevel} dirty rect`,
        colorAttachments: [{
          view: renderer.mipViews[mipLevel - 1],
          loadOp: needsFullBuild ? "clear" : "load",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      });
      pass.setPipeline(this.paintMipDownsamplePipeline);
      pass.setBindGroup(0, this.rasterStrokeMipDownsampleBindGroups[mipLevel - 2]);
      if (!needsFullBuild) {
        pass.setScissorRect(
          targetDirtyRect.x,
          targetDirtyRect.y,
          targetDirtyRect.width,
          targetDirtyRect.height,
        );
      }
      pass.draw(3, 1, 0, 0);
      pass.end();
      passes += 1;
      updatedPixels += targetDirtyRect.width * targetDirtyRect.height;
      sourceDirtyRect = targetDirtyRect;
    }

    if (baseChanged) {
      this.rasterStrokeMipValidThroughLevel = Math.max(1, selectedMipLevel);
    } else if (selectedMipLevel > previousValidThroughLevel) {
      this.rasterStrokeMipValidThroughLevel = selectedMipLevel;
    }
    return { passes, updatedPixels };
  }
  private encodeLightGlazeDisplayPyramid(
    encoder: GPUCommandEncoder,
    session: LightGlazeSession,
    baseDirtyRect: DirtyRect | null,
    selectedMipLevel: number,
  ): { passes: number; updatedPixels: number } {
    const previousValidThroughLevel = session.mipValidThroughLevel;
    const baseChanged = baseDirtyRect !== null;
    let sourceDirtyRect = baseDirtyRect;
    let passes = 0;
    let updatedPixels = 0;

    for (let mipLevel = 1; mipLevel <= selectedMipLevel; mipLevel += 1) {
      const dimensions = this.paintMipDimensions(mipLevel);
      const needsFullBuild = mipLevel > previousValidThroughLevel;
      const targetDirtyRect = needsFullBuild
        ? { x: 0, y: 0, ...dimensions }
        : sourceDirtyRect
          ? this.downsampleDirtyRect(sourceDirtyRect, mipLevel)
          : null;
      if (!targetDirtyRect || targetDirtyRect.width <= 0 || targetDirtyRect.height <= 0) {
        continue;
      }

      const pass = encoder.beginRenderPass({
        label: needsFullBuild
          ? `Build full Light Glaze final-composite mip ${mipLevel}`
          : `Update Light Glaze final-composite mip ${mipLevel} dirty rect`,
        colorAttachments: [
          {
            view: this.lightGlazeMipViews[mipLevel],
            loadOp: needsFullBuild ? "clear" : "load",
            storeOp: "store",
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          },
        ],
      });
      if (mipLevel === 1) {
        pass.setPipeline(this.lightGlazeCompositeMipPipeline);
        pass.setBindGroup(0, this.lightGlazeCompositeMipBindGroup!);
      } else {
        pass.setPipeline(this.paintMipDownsamplePipeline);
        pass.setBindGroup(0, this.lightGlazeMipDownsampleBindGroups[mipLevel - 2]);
      }
      if (!needsFullBuild) {
        pass.setScissorRect(
          targetDirtyRect.x,
          targetDirtyRect.y,
          targetDirtyRect.width,
          targetDirtyRect.height,
        );
      }
      pass.draw(3, 1, 0, 0);
      pass.end();
      passes += 1;
      updatedPixels += targetDirtyRect.width * targetDirtyRect.height;
      sourceDirtyRect = targetDirtyRect;
    }

    if (baseChanged) {
      session.mipValidThroughLevel = selectedMipLevel;
    } else if (selectedMipLevel > previousValidThroughLevel) {
      session.mipValidThroughLevel = selectedMipLevel;
    }
    return { passes, updatedPixels };
  }

  private isTexturizedGrainActive(settings: BrushSettings): boolean {
    return (settings.grainMode === "texturized" || settings.grainMode === "moving")
      && settings.grainBlendMode === "multiply"
      && settings.grainDepth > 0;
  }

  private grainCoordinateMode(settings: BrushSettings): "fixed" | "moving" {
    return settings.grainMode === "moving" ? "moving" : "fixed";
  }

  private grainStrategy(settings: BrushSettings): GrainStrategy {
    if (!this.isTexturizedGrainActive(settings)) {
      return GRAIN_DISABLED_STRATEGY;
    }
    return settings.grainMode === "moving" ? GRAIN_MOVING_STRATEGY : GRAIN_FIXED_STRATEGY;
  }

  private grainCoordinateStrategy(settings: BrushSettings): GrainCoordinateStrategy {
    if (!this.isTexturizedGrainActive(settings)) {
      return "none";
    }
    return settings.grainMode === "moving"
      ? GRAIN_MOVING_COORDINATE_STRATEGY
      : GRAIN_FIXED_COORDINATE_STRATEGY;
  }

  private grainSamplingStrategy(settings: BrushSettings): GrainSamplingStrategy {
    if (!this.isTexturizedGrainActive(settings)) {
      return "none";
    }
    const moving = settings.grainMode === "moving";
    if (settings.grainFiltering === "no") {
      return moving ? "clamp-nearest" : "repeat-nearest";
    }
    if (settings.grainFiltering === "classic") {
      return moving ? "clamp-linear-mip-nearest" : "repeat-linear-mip-nearest";
    }
    return moving ? "clamp-linear-trilinear" : "repeat-linear-trilinear";
  }

  private writeGrainUniforms(settings: BrushSettings): void {
    const floats = this.grainUniformUpload;
    const unsigned = new Uint32Array(floats.buffer);
    floats.fill(0);
    const scale = clamp(settings.grainScale, 0.1, 4);
    const polarity = settings.grainInvert ? -1 : 1;
    floats[0] = 1 / (GRAIN_TEXTURE_SIZE * scale);
    floats[1] = clamp(settings.grainDepth, 0, 1);
    // Folding inversion into the existing affine transform preserves the
    // fragment shader and its cost:
    // 1 - clamp((s - .5) * c + .5 + b) =
    //     clamp((s - .5) * -c + .5 - b).
    floats[2] = clamp(settings.grainBrightness, -1, 1) * polarity;
    floats[3] = (1 + clamp(settings.grainContrast, -1, 1)) * polarity;
    unsigned[4] = settings.grainFiltering === "no"
      ? 0
      : settings.grainFiltering === "classic" ? 1 : 2;
    unsigned[5] = settings.grainMode === "moving" ? 1 : 0;
    this.device.queue.writeBuffer(this.grainUniformBuffer, 0, floats);
  }

  private populateBrushUniformUpload(
    upload: ArrayBuffer,
    settings: BrushSettings,
    targetWidth: number,
    targetHeight: number,
    targetOriginX: number,
    targetOriginY: number,
  ): void {
    const floats = new Float32Array(upload);
    const unsigned = new Uint32Array(upload);
    floats.fill(0);

    const [hue, saturation, lightness] = hexToHsl(settings.color);
    const jitterMaster = settings.jitterMaster;

    floats[0] = targetWidth;
    floats[1] = targetHeight;
    floats[2] = targetOriginX;
    floats[3] = targetOriginY;
    floats[4] = hue;
    floats[5] = saturation;
    floats[6] = lightness;
    // The WGSL already multiplied baseHslAlpha.w into every physical stamp.
    // Feeding opacity through that existing lane keeps Normal at 100% on the
    // same shader and pipeline path while extending Normal/Additive exactly.
    floats[7] = Number.isFinite(settings.opacity) ? clamp(settings.opacity, 0, 1) : 1;
    floats[8] = (settings.hueJitterDegrees / 360) * jitterMaster;
    floats[9] = settings.saturationJitter * jitterMaster;
    floats[10] = settings.lightnessJitter * jitterMaster;
    floats[11] = settings.darknessJitter * jitterMaster;
    floats[12] = settings.flow;
    floats[13] = settings.hardness;
    floats[14] = settings.blendIntensity;
    // Keep the uniform ABI stable; pressure-to-alpha has been removed.
    floats[15] = 0;
    floats[16] = settings.positionJitterLinear;
    floats[17] = settings.positionJitterLateral;
    floats[18] = settings.shapeScatter;
    unsigned[20] = settings.count >>> 0;
    unsigned[21] = settings.jitterPerCopy ? 1 : 0;
    unsigned[22] = settings.blendMode === "additive" ? 1 : 0;
    unsigned[23] = 0;
  }

  private writeBrushUniforms(settings: BrushSettings = this.settings): void {
    this.populateBrushUniformUpload(
      this.brushUniformUpload,
      settings,
      LAYER_SIZE,
      LAYER_SIZE,
      0,
      0,
    );
    this.device.queue.writeBuffer(this.brushUniformBuffer, 0, this.brushUniformUpload);
  }

  private writeThicknessTailBrushUniforms(
    settings: BrushSettings,
    targetWidth: number,
    targetHeight: number,
    targetOriginX: number,
    targetOriginY: number,
  ): void {
    this.populateBrushUniformUpload(
      this.thicknessTailBrushUniformUpload,
      settings,
      targetWidth,
      targetHeight,
      targetOriginX,
      targetOriginY,
    );
    this.device.queue.writeBuffer(
      this.thicknessTailBrushUniformBuffer,
      0,
      this.thicknessTailBrushUniformUpload,
    );
  }

  private desiredPaintDisplayMipLevel(): number {
    if (!Number.isFinite(this.zoom) || this.zoom >= 1) {
      return 0;
    }
    // Pick the coarsest power-of-two variant that is still at least as large
    // as its projected size. The residual operation is therefore always a
    // downscale (or 1:1), never a blurry upscale.
    return clamp(
      Math.floor(Math.log2(1 / Math.max(this.zoom, Number.EPSILON)) + 1e-6),
      0,
      PAINT_DISPLAY_MIP_LEVEL_COUNT - 1,
    );
  }

  private paintMipDimensions(mipLevel: number): { width: number; height: number } {
    const dimension = Math.max(1, LAYER_SIZE >> mipLevel);
    return { width: dimension, height: dimension };
  }

  private downsampleDirtyRect(dirtyRect: DirtyRect, mipLevel: number): DirtyRect {
    const { width, height } = this.paintMipDimensions(mipLevel);
    const x = Math.max(0, Math.floor(dirtyRect.x / 2));
    const y = Math.max(0, Math.floor(dirtyRect.y / 2));
    const right = Math.min(width, Math.ceil((dirtyRect.x + dirtyRect.width) / 2));
    const bottom = Math.min(height, Math.ceil((dirtyRect.y + dirtyRect.height) / 2));
    return {
      x,
      y,
      width: Math.max(0, right - x),
      height: Math.max(0, bottom - y),
    };
  }

  private encodePaintDisplayPyramid(
    encoder: GPUCommandEncoder,
    baseDirtyRect: DirtyRect | null,
    selectedMipLevel: number,
  ): {
    maintenanceFrames: number;
    fullLevelBuilds: number;
    dirtyLevelUpdates: number;
    passes: number;
    baseDirtyPixels: number;
    updatedPixels: number;
    encodingMs: number;
  } {
    const startedAt = performance.now();
    const previousValidThroughLevel = this.paintDisplayMipValidThroughLevel;
    const baseChanged = baseDirtyRect !== null;
    let sourceDirtyRect = baseDirtyRect;
    let fullLevelBuilds = 0;
    let dirtyLevelUpdates = 0;
    let passes = 0;
    let updatedPixels = 0;

    for (let mipLevel = 1; mipLevel <= selectedMipLevel; mipLevel += 1) {
      const dimensions = this.paintMipDimensions(mipLevel);
      const needsFullBuild = mipLevel > previousValidThroughLevel;
      let targetDirtyRect: DirtyRect | null;

      if (needsFullBuild) {
        targetDirtyRect = { x: 0, y: 0, ...dimensions };
      } else if (sourceDirtyRect) {
        targetDirtyRect = this.downsampleDirtyRect(sourceDirtyRect, mipLevel);
      } else {
        targetDirtyRect = null;
      }

      if (!targetDirtyRect || targetDirtyRect.width <= 0 || targetDirtyRect.height <= 0) {
        continue;
      }

      const pass = encoder.beginRenderPass({
        label: needsFullBuild
          ? `Build full paint display mip ${mipLevel}`
          : `Update paint display mip ${mipLevel} dirty rect`,
        colorAttachments: [
          {
            view: this.paintMipViews[mipLevel],
            loadOp: needsFullBuild ? "clear" : "load",
            storeOp: "store",
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          },
        ],
      });
      pass.setPipeline(this.paintMipDownsamplePipeline);
      pass.setBindGroup(0, this.paintMipDownsampleBindGroups[mipLevel - 1]);
      if (!needsFullBuild) {
        pass.setScissorRect(
          targetDirtyRect.x,
          targetDirtyRect.y,
          targetDirtyRect.width,
          targetDirtyRect.height,
        );
      }
      pass.draw(3, 1, 0, 0);
      pass.end();

      passes += 1;
      updatedPixels += targetDirtyRect.width * targetDirtyRect.height;
      if (needsFullBuild) {
        fullLevelBuilds += 1;
      } else {
        dirtyLevelUpdates += 1;
      }
      sourceDirtyRect = targetDirtyRect;
    }

    if (baseChanged) {
      // Levels coarser than the one maintained for this frame become stale.
      // A later zoom-out rebuilds the first missing level in full, then safely
      // derives all following levels from it.
      this.paintDisplayMipValidThroughLevel = selectedMipLevel;
    } else if (selectedMipLevel > previousValidThroughLevel) {
      this.paintDisplayMipValidThroughLevel = selectedMipLevel;
    }

    return {
      maintenanceFrames: passes > 0 ? 1 : 0,
      fullLevelBuilds,
      dirtyLevelUpdates,
      passes,
      baseDirtyPixels: baseDirtyRect ? baseDirtyRect.width * baseDirtyRect.height : 0,
      updatedPixels,
      encodingMs: passes > 0 ? performance.now() - startedAt : 0,
    };
  }

  private writeDisplayUniforms(selectedMipLevel = this.paintDisplaySelectedMipLevel): void {
    this.displayUniformUpload[0] = this.canvas.width;
    this.displayUniformUpload[1] = this.canvas.height;
    this.displayUniformUpload[2] = this.viewRotationCos;
    this.displayUniformUpload[3] = this.viewRotationSin;
    this.displayUniformUpload[4] = this.viewCenterX;
    this.displayUniformUpload[5] = this.viewCenterY;
    this.displayUniformUpload[6] = this.zoom;
    this.displayUniformUpload[7] = 96;
    this.displayUniformUpload[8] = selectedMipLevel;
    this.displayUniformUpload[9] = this.mergedBelow?.resolutionScale ?? 0;
    this.displayUniformUpload[10] = this.mergedAbove?.resolutionScale ?? 0;
    this.displayUniformUpload[11] = this.layerStack.active.visible
      ? clamp(this.layerStack.active.opacity, 0, 1)
      : 0;
    this.displayUniformUpload[12] = this.mergedBelow?.bounds.x ?? 0;
    this.displayUniformUpload[13] = this.mergedBelow?.bounds.y ?? 0;
    this.displayUniformUpload[14] = this.mergedAbove?.bounds.x ?? 0;
    this.displayUniformUpload[15] = this.mergedAbove?.bounds.y ?? 0;

    this.device.queue.writeBuffer(this.displayUniformBuffer, 0, this.displayUniformUpload);
  }

  private writeThicknessTailDisplayUniforms(
    originX: number,
    originY: number,
    settings: BrushSettings,
  ): void {
    const floats = new Float32Array(this.thicknessTailDisplayUniformUpload);
    const unsigned = new Uint32Array(this.thicknessTailDisplayUniformUpload);
    floats.fill(0);
    floats[0] = originX;
    floats[1] = originY;
    floats[2] = this.thicknessTailTextureWidth;
    floats[3] = this.thicknessTailTextureHeight;
    unsigned[4] = settings.blendMode === "additive" ? 1 : 0;
    this.device.queue.writeBuffer(
      this.thicknessTailDisplayUniformBuffer,
      0,
      this.thicknessTailDisplayUniformUpload,
    );
  }

  private async initializeVectorTextGpuRenderer(): Promise<void> {
    this.vectorTextGpuShaderModule = this.device.createShaderModule({
      label: `Vector text geometry WGSL · ${VECTOR_TEXT_GPU_RENDER_STRATEGY}`,
      code: vectorTextGpuShader,
    });
    this.vectorTextGpuSlugShaderModule = this.device.createShaderModule({
      label: `Vector text Slug WGSL · ${VECTOR_TEXT_SLUG_GPU_RENDER_STRATEGY}`,
      code: vectorTextSlugGpuShader,
    });

    this.vectorTextGpuGaussianBlurShaderModule = this.device.createShaderModule({
      label: "Vector text GPU separable Gaussian blur WGSL",
      code: vectorTextGpuGaussianBlurShader,
    });
    this.vectorTextGpuBlurCompositeShaderModule = this.device.createShaderModule({
      label: "Vector text GPU blurred mask composite WGSL",
      code: vectorTextGpuBlurCompositeShader,
    });
    this.vectorTextGpuInnerShadowShaderModule = this.device.createShaderModule({
      label: `Vector text inner shadow WGSL · ${VECTOR_TEXT_INNER_SHADOW_GPU_STRATEGY}`,
      code: vectorTextInnerShadowGpuShader,
    });
    await Promise.all([
      this.assertShaderCompiled(
        this.vectorTextGpuShaderModule,
        "vector text indexed geometry",
      ),
      this.assertShaderCompiled(
        this.vectorTextGpuSlugShaderModule,
        "vector text Slug analytic source fill",
      ),

      this.assertShaderCompiled(
        this.vectorTextGpuGaussianBlurShaderModule,
        "vector text separable Gaussian blur",
      ),
      this.assertShaderCompiled(
        this.vectorTextGpuBlurCompositeShaderModule,
        "vector text blurred mask composite",
      ),
      this.assertShaderCompiled(
        this.vectorTextGpuInnerShadowShaderModule,
        "vector text inner shadow analytic clip",
      ),
    ]);

    this.vectorTextGpuUniformBindGroupLayout =
      this.device.createBindGroupLayout({
        label: "Vector text dynamic draw uniform bind group layout",
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: {
              type: "uniform",
              hasDynamicOffset: true,
              minBindingSize: VECTOR_TEXT_GPU_UNIFORM_BYTES,
            },
          },
        ],
      });

    this.vectorTextGpuBlurFilterBindGroupLayout =
      this.device.createBindGroupLayout({
        label: "Vector text GPU blur filter bind group layout",
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.FRAGMENT,
            buffer: {
              type: "uniform",
              hasDynamicOffset: true,
              minBindingSize: VECTOR_TEXT_GPU_BLUR_FILTER_UNIFORM_BYTES,
            },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.FRAGMENT,
            texture: { sampleType: "float" },
          },
        ],
      });
    this.vectorTextGpuBlurCompositeBindGroupLayout =
      this.device.createBindGroupLayout({
        label: "Vector text GPU blur composite bind group layout",
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: {
              type: "uniform",
              hasDynamicOffset: true,
              minBindingSize: VECTOR_TEXT_GPU_BLUR_COMPOSITE_UNIFORM_BYTES,
            },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.FRAGMENT,
            texture: { sampleType: "float" },
          },
          {
            binding: 2,
            visibility: GPUShaderStage.FRAGMENT,
            sampler: { type: "filtering" },
          },
        ],
      });
    this.vectorTextGpuInnerShadowBindGroupLayout =
      this.device.createBindGroupLayout({
        label: "Vector text GPU inner-shadow blurred mask layout",
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.FRAGMENT,
            texture: { sampleType: "float" },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.FRAGMENT,
            sampler: { type: "filtering" },
          },
        ],
      });
    this.vectorTextGpuSlugBindGroupLayout =
      this.device.createBindGroupLayout({
        label: "Vector text Slug dynamic uniform and data textures layout",
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: {
              type: "uniform",
              hasDynamicOffset: true,
              minBindingSize: VECTOR_TEXT_SLUG_UNIFORM_BYTES,
            },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.FRAGMENT,
            texture: { sampleType: "unfilterable-float" },
          },
          {
            binding: 2,
            visibility: GPUShaderStage.FRAGMENT,
            texture: { sampleType: "uint" },
          },
        ],
      });

    this.vectorTextGpuUniformBuffer = this.device.createBuffer({
      label: `Vector text dynamic uniforms ${VECTOR_TEXT_GPU_MAXIMUM_DRAWS}`,
      size: VECTOR_TEXT_GPU_MAXIMUM_DRAWS * VECTOR_TEXT_GPU_UNIFORM_STRIDE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.vectorTextGpuUniformBindGroup = this.device.createBindGroup({
      label: "Vector text dynamic uniform bind group",
      layout: this.vectorTextGpuUniformBindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: {
            buffer: this.vectorTextGpuUniformBuffer,
            offset: 0,
            size: VECTOR_TEXT_GPU_UNIFORM_BYTES,
          },
        },
      ],
    });

    this.vectorTextGpuBlurFilterUniformBuffer = this.device.createBuffer({
      label: `Vector text GPU blur filter uniforms ${VECTOR_TEXT_GPU_MAXIMUM_DRAWS}`,
      size: VECTOR_TEXT_GPU_MAXIMUM_DRAWS * VECTOR_TEXT_GPU_UNIFORM_STRIDE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.vectorTextGpuBlurSampler = this.device.createSampler({
      label: "Vector text GPU blur linear clamp sampler",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
      magFilter: "linear",
      minFilter: "linear",
    });

    const sourceOverBlend: GPUBlendState = {
      color: {
        srcFactor: "one",
        dstFactor: "one-minus-src-alpha",
        operation: "add",
      },
      alpha: {
        srcFactor: "one",
        dstFactor: "one-minus-src-alpha",
        operation: "add",
      },
    };
    const vertex: GPUVertexState = {
      module: this.vectorTextGpuShaderModule,
      entryPoint: "vertexMain",
      buffers: [
        {
          arrayStride: 8,
          attributes: [
            {
              shaderLocation: 0,
              offset: 0,
              format: "float32x2",
            },
          ],
        },
      ],
    };
    const textLayout = this.device.createPipelineLayout({
      label: "Vector text geometry pipeline layout",
      bindGroupLayouts: [this.vectorTextGpuUniformBindGroupLayout],
    });

    this.vectorTextGpuFillPipeline = this.device.createRenderPipeline({
      label: "Vector text indexed fill MSAA4 source-over pipeline",
      layout: textLayout,
      vertex,
      fragment: {
        module: this.vectorTextGpuShaderModule,
        entryPoint: "fragmentMain",
        targets: [
          { format: VECTOR_TEXT_GPU_TARGET_FORMAT, blend: sourceOverBlend },
        ],
      },
      primitive: { topology: "triangle-list" },
      multisample: { count: VECTOR_TEXT_GPU_SAMPLE_COUNT },
    });

    const slugLayout = this.device.createPipelineLayout({
      label: "Vector text Slug pipeline layout",
      bindGroupLayouts: [this.vectorTextGpuSlugBindGroupLayout],
    });
    this.vectorTextGpuSlugPipeline = this.device.createRenderPipeline({
      label: "Vector text whole-node Slug source fill MSAA4 source-over pipeline",
      layout: slugLayout,
      vertex: {
        module: this.vectorTextGpuSlugShaderModule,
        entryPoint: "vertexMain",
      },
      fragment: {
        module: this.vectorTextGpuSlugShaderModule,
        entryPoint: "fragmentMain",
        targets: [
          { format: VECTOR_TEXT_GPU_TARGET_FORMAT, blend: sourceOverBlend },
        ],
      },
      primitive: { topology: "triangle-list", cullMode: "none" },
      multisample: { count: VECTOR_TEXT_GPU_SAMPLE_COUNT },
    });

    this.vectorTextGpuBlurMaskPipeline = this.device.createRenderPipeline({
      label: "Vector text analytic Slug mask for GPU blur",
      layout: slugLayout,
      vertex: {
        module: this.vectorTextGpuSlugShaderModule,
        entryPoint: "vertexMain",
      },
      fragment: {
        module: this.vectorTextGpuSlugShaderModule,
        entryPoint: "fragmentMain",
        targets: [{ format: VECTOR_TEXT_GPU_BLUR_FORMAT }],
      },
      primitive: { topology: "triangle-list", cullMode: "none" },
    });

    const blurFilterLayout = this.device.createPipelineLayout({
      label: "Vector text GPU Gaussian filter pipeline layout",
      bindGroupLayouts: [this.vectorTextGpuBlurFilterBindGroupLayout],
    });
    this.vectorTextGpuBlurHorizontalPipeline = this.device.createRenderPipeline({
      label: "Vector text GPU Gaussian horizontal pipeline",
      layout: blurFilterLayout,
      vertex: {
        module: this.vectorTextGpuGaussianBlurShaderModule,
        entryPoint: "vertexMain",
      },
      fragment: {
        module: this.vectorTextGpuGaussianBlurShaderModule,
        entryPoint: "horizontalMain",
        targets: [{ format: VECTOR_TEXT_GPU_BLUR_FORMAT }],
      },
      primitive: { topology: "triangle-list" },
    });
    this.vectorTextGpuBlurVerticalPipeline = this.device.createRenderPipeline({
      label: "Vector text GPU Gaussian vertical pipeline",
      layout: blurFilterLayout,
      vertex: {
        module: this.vectorTextGpuGaussianBlurShaderModule,
        entryPoint: "vertexMain",
      },
      fragment: {
        module: this.vectorTextGpuGaussianBlurShaderModule,
        entryPoint: "verticalMain",
        targets: [{ format: VECTOR_TEXT_GPU_BLUR_FORMAT }],
      },
      primitive: { topology: "triangle-list" },
    });
    this.vectorTextGpuBlurCompositePipeline = this.device.createRenderPipeline({
      label: "Vector text GPU blurred mask MSAA4 source-over composite",
      layout: this.device.createPipelineLayout({
        label: "Vector text GPU blur composite pipeline layout",
        bindGroupLayouts: [this.vectorTextGpuBlurCompositeBindGroupLayout],
      }),
      vertex: {
        module: this.vectorTextGpuBlurCompositeShaderModule,
        entryPoint: "vertexMain",
      },
      fragment: {
        module: this.vectorTextGpuBlurCompositeShaderModule,
        entryPoint: "fragmentMain",
        targets: [
          { format: VECTOR_TEXT_GPU_TARGET_FORMAT, blend: sourceOverBlend },
        ],
      },
      primitive: { topology: "triangle-list" },
      multisample: { count: VECTOR_TEXT_GPU_SAMPLE_COUNT },
    });
    this.vectorTextGpuInnerShadowDirectPipeline = this.device.createRenderPipeline({
      label: "Vector text inner shadow direct Slug MSAA4 source-over",
      layout: slugLayout,
      vertex: {
        module: this.vectorTextGpuInnerShadowShaderModule,
        entryPoint: "vertexMain",
      },
      fragment: {
        module: this.vectorTextGpuInnerShadowShaderModule,
        entryPoint: "innerShadowDirectFragmentMain",
        targets: [
          { format: VECTOR_TEXT_GPU_TARGET_FORMAT, blend: sourceOverBlend },
        ],
      },
      primitive: { topology: "triangle-list", cullMode: "none" },
      multisample: { count: VECTOR_TEXT_GPU_SAMPLE_COUNT },
    });
    const innerShadowBlurLayout = this.device.createPipelineLayout({
      label: "Vector text inner shadow blurred clip pipeline layout",
      bindGroupLayouts: [
        this.vectorTextGpuSlugBindGroupLayout,
        this.vectorTextGpuInnerShadowBindGroupLayout,
      ],
    });
    this.vectorTextGpuInnerShadowBlurPipeline = this.device.createRenderPipeline({
      label: "Vector text inner shadow blurred Slug clip MSAA4 source-over",
      layout: innerShadowBlurLayout,
      vertex: {
        module: this.vectorTextGpuInnerShadowShaderModule,
        entryPoint: "innerShadowBlurVertexMain",
      },
      fragment: {
        module: this.vectorTextGpuInnerShadowShaderModule,
        entryPoint: "innerShadowBlurFragmentMain",
        targets: [
          { format: VECTOR_TEXT_GPU_TARGET_FORMAT, blend: sourceOverBlend },
        ],
      },
      primitive: { topology: "triangle-list", cullMode: "none" },
      multisample: { count: VECTOR_TEXT_GPU_SAMPLE_COUNT },
    });
    if (!this.mixedSceneClearShaderModule) {
      throw new Error("Shader clear trasparente non inizializzato.");
    }
    this.vectorTextGpuClearPipeline = this.device.createRenderPipeline({
      label: "Vector text cropped run transparent clear pipeline",
      layout: this.device.createPipelineLayout({
        label: "Vector text cropped run transparent clear pipeline layout",
        bindGroupLayouts: [],
      }),
      vertex: {
        module: this.mixedSceneClearShaderModule,
        entryPoint: "vertexMain",
      },
      fragment: {
        module: this.mixedSceneClearShaderModule,
        entryPoint: "fragmentMain",
        targets: [{ format: VECTOR_TEXT_GPU_TARGET_FORMAT }],
      },
      primitive: { topology: "triangle-list" },
    });
  }

  private ensureVectorTextPresentationTexture(
    width: number,
    height: number,
    placement: VectorTextPlacement,
  ): GPUTexture {
    if (
      this.vectorTextTextureWidth !== width
      || this.vectorTextTextureHeight !== height
    ) {
      const legacyBindingsChanged = Boolean(
        this.vectorTextBelowTexture || this.vectorTextAboveTexture,
      );
      this.vectorTextBelowTexture?.destroy();
      this.vectorTextAboveTexture?.destroy();
      for (const resources of this.vectorTextRunTextures.values()) {
        resources.texture.destroy();
      }
      this.vectorTextRunTextures.clear();
      this.vectorTextBelowTexture = null;
      this.vectorTextBelowView = null;
      this.vectorTextAboveTexture = null;
      this.vectorTextAboveView = null;
      this.vectorTextTextureWidth = width;
      this.vectorTextTextureHeight = height;
      if (legacyBindingsChanged) {
        this.rebuildVectorTextDisplayBindGroup();
      }
    }

    if (placement.startsWith("text-run:")) {
      const key = placement as Extract<VectorTextPlacement, `text-run:${string}`>;
      const existingRun = this.vectorTextRunTextures.get(key);
      if (existingRun) {
        return existingRun.texture;
      }
      const layout = this.mixedSceneTextSegmentBindGroupLayout;
      if (!layout) {
        throw new Error("Layout delle cache testo segmentate non inizializzato.");
      }
      const texture = this.device.createTexture({
        label: `Vector text ${key} viewport cache ${width}×${height}`,
        size: { width, height, depthOrArrayLayers: 1 },
        format: "rgba8unorm-srgb",
        usage:
          GPUTextureUsage.COPY_DST
          | GPUTextureUsage.RENDER_ATTACHMENT
          | GPUTextureUsage.TEXTURE_BINDING,
      });
      try {
        const view = texture.createView({
          label: `Vector text ${key} viewport cache view`,
        });
        const bindGroup = this.device.createBindGroup({
          label: `Vector text ${key} segment bind group`,
          layout,
          entries: [
            { binding: 0, resource: { buffer: this.displayUniformBuffer } },
            { binding: 1, resource: { buffer: this.vectorTextCaptureUniformBuffer } },
            { binding: 2, resource: view },
            { binding: 3, resource: this.sampler },
          ],
        });
        this.vectorTextRunTextures.set(key, {
          texture,
          view,
          bindGroup,
          lastBounds: null,
          initialized: false,
        });
        return texture;
      } catch (error) {
        texture.destroy();
        throw error;
      }
    }

    const existing = placement === "below-active"
      ? this.vectorTextBelowTexture
      : this.vectorTextAboveTexture;
    if (existing) {
      return existing;
    }

    const texture = this.device.createTexture({
      label: `Vector text ${placement} viewport cache ${width}×${height}`,
      size: { width, height, depthOrArrayLayers: 1 },
      format: "rgba8unorm-srgb",
      usage:
        GPUTextureUsage.COPY_DST
        | GPUTextureUsage.RENDER_ATTACHMENT
        | GPUTextureUsage.TEXTURE_BINDING,
    });
    const view = texture.createView({
      label: `Vector text ${placement} viewport cache view`,
    });
    if (placement === "below-active") {
      this.vectorTextBelowTexture = texture;
      this.vectorTextBelowView = view;
    } else {
      this.vectorTextAboveTexture = texture;
      this.vectorTextAboveView = view;
    }
    this.rebuildVectorTextDisplayBindGroup();
    return texture;
  }

  private ensureMixedSceneLinearTexture(width: number, height: number): void {
    if (!this.mixedSceneStack?.textCount) {
      this.mixedSceneLinearTexture?.destroy();
      this.mixedSceneLinearTexture = null;
      this.mixedSceneLinearView = null;
      this.mixedSceneLinearWidth = 0;
      this.mixedSceneLinearHeight = 0;
      this.mixedScenePresentBindGroup = null;
      return;
    }
    if (
      this.mixedSceneLinearTexture
      && this.mixedSceneLinearView
      && this.mixedSceneLinearWidth === width
      && this.mixedSceneLinearHeight === height
    ) {
      return;
    }
    const layout = this.mixedScenePresentBindGroupLayout;
    if (!layout) {
      throw new Error("Layout di presentazione della scena mista non inizializzato.");
    }
    const oldTexture = this.mixedSceneLinearTexture;
    const texture = this.device.createTexture({
      label: `Ordered mixed scene linear cache ${width}×${height}`,
      size: { width, height, depthOrArrayLayers: 1 },
      format: MIXED_SCENE_LINEAR_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    try {
      const view = texture.createView({ label: "Ordered mixed scene linear cache view" });
      const bindGroup = this.device.createBindGroup({
        label: "Ordered mixed scene checker presentation bind group",
        layout,
        entries: [
          { binding: 0, resource: { buffer: this.displayUniformBuffer } },
          { binding: 1, resource: view },
        ],
      });
      this.mixedSceneLinearTexture = texture;
      this.mixedSceneLinearView = view;
      this.mixedSceneLinearWidth = width;
      this.mixedSceneLinearHeight = height;
      this.mixedScenePresentBindGroup = bindGroup;
      this.presentationCacheNeedsFullRebuild = true;
      oldTexture?.destroy();
    } catch (error) {
      texture.destroy();
      throw error;
    }
  }

  private ensurePresentationCacheTexture(): void {
    const width = Math.max(1, this.canvas.width);
    const height = Math.max(1, this.canvas.height);
    this.ensureMixedSceneLinearTexture(width, height);
    if (
      this.presentationCacheTexture
      && this.presentationCacheView
      && this.presentationCacheWidth === width
      && this.presentationCacheHeight === height
    ) {
      return;
    }

    const oldTexture = this.presentationCacheTexture;
    const texture = this.device.createTexture({
      label: `Persistent presentation cache ${width}×${height}`,
      size: { width, height, depthOrArrayLayers: 1 },
      format: this.canvasFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });

    this.presentationCacheTexture = texture;
    this.presentationCacheView = texture.createView({ label: "Persistent presentation cache view" });
    this.presentationCacheWidth = width;
    this.presentationCacheHeight = height;
    this.presentationCacheNeedsFullRebuild = true;
    oldTexture?.destroy();
  }

  private encodeMixedSceneSegmentedPresentation(
    encoder: GPUCommandEncoder,
    presentationDirtyRect: DirtyRect,
    requiresFullRebuild: boolean,
    activePresentation: MixedSceneActivePresentation,
    label: string,
  ): void {
    const linearView = this.mixedSceneLinearView;
    const presentBindGroup = this.mixedScenePresentBindGroup;
    const clearPipeline = this.mixedSceneClearPipeline;
    const rasterPipeline = this.mixedSceneRasterSegmentPipeline;
    const textPipeline = this.mixedSceneTextSegmentPipeline;
    const presentPipeline = this.mixedScenePresentPipeline;
    if (
      !this.mixedSceneStack?.textCount
      || !linearView
      || !presentBindGroup
      || !clearPipeline
      || !rasterPipeline
      || !textPipeline
      || !presentPipeline
      || !this.presentationCacheView
    ) {
      throw new Error("Compositore segmentato raster/testo non pronto.");
    }

    const scenePass = encoder.beginRenderPass({
      label: `${label} · ${MIXED_SCENE_COMPOSITOR_STRATEGY}`,
      colorAttachments: [
        {
          view: linearView,
          loadOp: requiresFullRebuild ? "clear" : "load",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        },
      ],
    });
    scenePass.setScissorRect(
      presentationDirtyRect.x,
      presentationDirtyRect.y,
      presentationDirtyRect.width,
      presentationDirtyRect.height,
    );
    if (!requiresFullRebuild) {
      scenePass.setPipeline(clearPipeline);
      scenePass.draw(3, 1, 0, 0);
    }

    for (const segment of this.mixedSceneCompositionSegments) {
      if (segment.kind === "raster-run") {
        const resources = this.mixedSceneRasterSegments.find(
          (candidate) => candidate.key === segment.key,
        );
        if (resources) {
          scenePass.setPipeline(rasterPipeline);
          scenePass.setBindGroup(0, resources.bindGroup);
          scenePass.draw(3, 1, 0, 0);
        }
        continue;
      }
      if (segment.kind === "text-run") {
        const resources = this.vectorTextRunTextures.get(segment.key);
        if (resources) {
          scenePass.setPipeline(textPipeline);
          scenePass.setBindGroup(0, resources.bindGroup);
          scenePass.draw(3, 1, 0, 0);
        }
        continue;
      }

      if (activePresentation.kind === "raster-stroke") {
        const pipeline = this.mixedSceneActiveRasterStrokeDisplayPipeline;
        const sourceBindGroup = this.rasterStrokeDisplayBindGroups.get(
          activePresentation.sourceMode,
        );
        if (!pipeline || !sourceBindGroup) {
          throw new Error("Pipeline del raster attivo con effetti non pronta.");
        }
        scenePass.setPipeline(pipeline);
        scenePass.setBindGroup(0, this.rasterStrokeDisplayScreenBindGroup);
        scenePass.setBindGroup(1, sourceBindGroup);
      } else if (activePresentation.kind === "thickness-tail") {
        const pipeline = this.mixedSceneActiveThicknessTailDisplayPipeline;
        if (!pipeline || !this.thicknessTailDisplayBindGroup) {
          throw new Error("Pipeline del tail attivo non pronta.");
        }
        scenePass.setPipeline(pipeline);
        scenePass.setBindGroup(0, this.thicknessTailDisplayBindGroup);
      } else if (activePresentation.kind === "light-glaze") {
        const pipeline = this.mixedSceneActiveLightGlazeDisplayPipeline;
        if (!pipeline || !this.lightGlazeDisplayBindGroup) {
          throw new Error("Pipeline Light Glaze del raster attivo non pronta.");
        }
        scenePass.setPipeline(pipeline);
        scenePass.setBindGroup(0, this.lightGlazeDisplayBindGroup);
      } else {
        const pipeline = this.mixedSceneActiveDisplayPipeline;
        if (!pipeline) {
          throw new Error("Pipeline base del raster attivo non pronta.");
        }
        scenePass.setPipeline(pipeline);
        scenePass.setBindGroup(0, this.displayBindGroup);
      }
      scenePass.draw(3, 1, 0, 0);
    }
    scenePass.end();

    const presentPass = encoder.beginRenderPass({
      label: `${label} · checker finale`,
      colorAttachments: [
        {
          view: this.presentationCacheView,
          loadOp: requiresFullRebuild ? "clear" : "load",
          storeOp: "store",
          clearValue: { r: 0.02, g: 0.02, b: 0.025, a: 1 },
        },
      ],
    });
    presentPass.setPipeline(presentPipeline);
    presentPass.setBindGroup(0, presentBindGroup);
    presentPass.setScissorRect(
      presentationDirtyRect.x,
      presentationDirtyRect.y,
      presentationDirtyRect.width,
      presentationDirtyRect.height,
    );
    presentPass.draw(3, 1, 0, 0);
    presentPass.end();
  }
  private layerDirtyRectToPresentationRect(
    dirtyRect: DirtyRect,
    selectedMipLevel: number,
  ): DirtyRect | null {
    const width = this.canvas.width;
    const height = this.canvas.height;
    if (width <= 0 || height <= 0) {
      return null;
    }

    // Il display usa filtraggio lineare sul mip selezionato: un texel derivato
    // copre 2^LOD pixel layer e può contribuire anche al campione adiacente.
    // Il margine 2^(LOD+1), più un pixel canvas, è conservativo anche rispetto
    // agli arrotondamenti f32 e ai confini interi dello scissor.
    const layerMargin = Math.max(2, 2 ** (selectedMipLevel + 1));
    const canvasMargin = 1;
    const layerLeft = dirtyRect.x - layerMargin;
    const layerTop = dirtyRect.y - layerMargin;
    const layerRight = dirtyRect.x + dirtyRect.width + layerMargin;
    const layerBottom = dirtyRect.y + dirtyRect.height + layerMargin;
    const topLeft = this.layerToCanvasPixels(layerLeft, layerTop);
    const topRight = this.layerToCanvasPixels(layerRight, layerTop);
    const bottomLeft = this.layerToCanvasPixels(layerLeft, layerBottom);
    const bottomRight = this.layerToCanvasPixels(layerRight, layerBottom);
    const canvasLeft = Math.min(topLeft.x, topRight.x, bottomLeft.x, bottomRight.x);
    const canvasTop = Math.min(topLeft.y, topRight.y, bottomLeft.y, bottomRight.y);
    const canvasRight = Math.max(topLeft.x, topRight.x, bottomLeft.x, bottomRight.x);
    const canvasBottom = Math.max(topLeft.y, topRight.y, bottomLeft.y, bottomRight.y);

    const x = Math.max(0, Math.floor(Math.min(canvasLeft, canvasRight)) - canvasMargin);
    const y = Math.max(0, Math.floor(Math.min(canvasTop, canvasBottom)) - canvasMargin);
    const right = Math.min(width, Math.ceil(Math.max(canvasLeft, canvasRight)) + canvasMargin);
    const bottom = Math.min(height, Math.ceil(Math.max(canvasTop, canvasBottom)) + canvasMargin);
    const dirtyWidth = Math.max(0, right - x);
    const dirtyHeight = Math.max(0, bottom - y);
    return dirtyWidth > 0 && dirtyHeight > 0
      ? { x, y, width: dirtyWidth, height: dirtyHeight }
      : null;
  }

  toLayerPoint(sample: PointerSample): LayerPoint {
    const layer = this.clientToLayer(sample.clientX, sample.clientY);
    return {
      x: layer.x,
      y: layer.y,
      pressure: clamp(sample.pressure, 0.01, 1),
      timeMs: Number.isFinite(sample.timeMs) ? sample.timeMs : performance.now(),
    };
  }

  private clientToCanvasPixels(clientX: number, clientY: number): { x: number; y: number } {
    const rectangle = this.canvas.getBoundingClientRect();
    return {
      x: ((clientX - rectangle.left) / Math.max(1, rectangle.width)) * this.canvas.width,
      y: ((clientY - rectangle.top) / Math.max(1, rectangle.height)) * this.canvas.height,
    };
  }

  private canvasOffsetToLayerOffset(deltaX: number, deltaY: number): { x: number; y: number } {
    const scaledX = deltaX / this.zoom;
    const scaledY = deltaY / this.zoom;
    return {
      x: this.viewRotationCos * scaledX + this.viewRotationSin * scaledY,
      y: -this.viewRotationSin * scaledX + this.viewRotationCos * scaledY,
    };
  }

  private layerOffsetToCanvasOffset(deltaX: number, deltaY: number): { x: number; y: number } {
    return {
      x: (this.viewRotationCos * deltaX - this.viewRotationSin * deltaY) * this.zoom,
      y: (this.viewRotationSin * deltaX + this.viewRotationCos * deltaY) * this.zoom,
    };
  }

  private layerToCanvasPixels(layerX: number, layerY: number): { x: number; y: number } {
    const offset = this.layerOffsetToCanvasOffset(
      layerX - this.viewCenterX,
      layerY - this.viewCenterY,
    );
    return {
      x: this.canvas.width * 0.5 + offset.x,
      y: this.canvas.height * 0.5 + offset.y,
    };
  }

  private clientToLayer(clientX: number, clientY: number): { x: number; y: number } {
    const screen = this.clientToCanvasPixels(clientX, clientY);
    const offset = this.canvasOffsetToLayerOffset(
      screen.x - this.canvas.width * 0.5,
      screen.y - this.canvas.height * 0.5,
    );
    return {
      x: this.viewCenterX + offset.x,
      y: this.viewCenterY + offset.y,
    };
  }

  private appendPoint(point: LayerPoint): void {
    const generationStart = this.activeStrokeProfile ? performance.now() : 0;
    const stroke = this.activeStroke;
    if (!stroke) {
      return;
    }
    if (stroke.tool === "blend") {
      const normalizedPoint: LayerPoint = {
        ...point,
        timeMs: Math.max(
          stroke.lastInput.timeMs,
          Number.isFinite(point.timeMs) ? point.timeMs : stroke.lastInput.timeMs,
        ),
      };
      const result = stroke.blendPlanner?.pushSample(normalizedPoint);
      if (result && !result.accepted) {
        throw new Error(
          `Coda Blend dry piena: servono ${result.requiredSteps} segmenti.`,
        );
      }
      stroke.lastInput = normalizedPoint;
      this.drainBlendPlanner(stroke);
      this.recordStampGenerationTime(generationStart);
      return;
    }

    const start = stroke.lastInput;
    const normalizedPoint: LayerPoint = {
      ...point,
      timeMs: Math.max(
        start.timeMs,
        Number.isFinite(point.timeMs) ? point.timeMs : start.timeMs,
      ),
    };
    const deltaX = normalizedPoint.x - start.x;
    const deltaY = normalizedPoint.y - start.y;
    const segmentLength = Math.hypot(deltaX, deltaY);
    const deltaTimeMs = normalizedPoint.timeMs - start.timeMs;

    this.releaseHeldThicknessStamps(normalizedPoint.timeMs, false);

    if (segmentLength <= 0.0001) {
      stroke.lastInput = normalizedPoint;
      this.recordStampGenerationTime(generationStart);
      return;
    }

    const generationSettings = stroke.lightGlazeSettings ?? this.settings;
    const spacing = Math.max(
      0.1,
      generationSettings.size * (stroke.adaptiveSpacingPercent / 100),
    );
    const directionX = deltaX / segmentLength;
    const directionY = deltaY / segmentLength;
    let distanceAlongSegment = 0;
    let distanceSinceStamp = stroke.distanceSinceStamp;
    let generatedOnSegment = 0;

    while (distanceSinceStamp + (segmentLength - distanceAlongSegment) >= spacing) {
      const distanceToNextStamp = spacing - distanceSinceStamp;
      distanceAlongSegment += distanceToNextStamp;
      const interpolation = clamp(distanceAlongSegment / segmentLength, 0, 1);
      this.emitStamp({
        x: start.x + deltaX * interpolation,
        y: start.y + deltaY * interpolation,
        pressure: start.pressure + (normalizedPoint.pressure - start.pressure) * interpolation,
        timeMs: start.timeMs + deltaTimeMs * interpolation,
      }, directionX, directionY);
      distanceSinceStamp = 0;
      generatedOnSegment += 1;

      if (generatedOnSegment >= MAX_STAMPS_PER_BATCH) {
        break;
      }
    }

    distanceSinceStamp += Math.max(0, segmentLength - distanceAlongSegment);
    stroke.lastInput = normalizedPoint;
    stroke.distanceSinceStamp = distanceSinceStamp;
    this.releaseHeldThicknessStamps(normalizedPoint.timeMs, false);
    this.recordStampGenerationTime(generationStart);
  }

  private drainBlendPlanner(stroke: ActiveStroke): void {
    const planner = stroke.blendPlanner;
    const settings = stroke.blendSettings;
    if (!planner || !settings) {
      return;
    }
    let batch = planner.buildNextBatch();
    while (batch) {
      if (!batch.empty) {
        if (!stroke.historyCommitted) {
          this.truncateRedoHistory();
          this.historyActions.push({ id: stroke.historyActionId, kind: "stroke", layerId: this.layerStack.active.id });
          this.historyCursor = this.historyActions.length;
          stroke.historyCommitted = true;
          if (this.activeStrokeProfile) {
            this.activeStrokeProfile.historyCommittedActions += 1;
          }
        }
        this.pendingBlendBatches.push({
          actionId: stroke.historyActionId,
          settings,
          batch: cloneDryBlendRenderBatch(batch),
        });
        if (this.activeStrokeProfile) {
          this.activeStrokeProfile.baseStamps += 1;
        }
      }
      batch = planner.buildNextBatch();
    }
    if (this.pendingBlendBatches.length > 0) {
      this.displayDirty = true;
      this.requestRender();
    }
  }

  private emitStamp(point: LayerPoint, directionX: number, directionY: number): void {
    const stroke = this.activeStroke;
    if (!stroke) {
      return;
    }
    const generationSettings = stroke.lightGlazeSettings ?? this.settings;
    const pressure = clamp(point.pressure, 0.01, 1);
    const baseRadius = Math.max(0.5, generationSettings.size * 0.5);
    const liveThicknessFactor = stroke.thicknessDynamicsNeutral
      ? 1
      : startThicknessFactor(
        stroke.thicknessSettings.startThickness,
        Math.max(0, point.timeMs - stroke.startedAtMs),
      );
    const radius = stroke.thicknessDynamicsNeutral
      ? baseRadius
      : baseRadius * liveThicknessFactor;
    const seed = (Math.imul(this.seedSequence++, 0x9e3779b1) ^ 0xa511e9b3) >>> 0;
    const stamp: Stamp = {
      x: point.x,
      y: point.y,
      radius,
      pressure,
      seed,
      directionX,
      directionY,
      historyActionId: stroke.historyActionId,
    };

    if (stroke.thicknessTailHoldback) {
      stroke.heldThicknessStamps.push({
        stamp,
        timeMs: point.timeMs,
        baseRadius,
        liveThicknessFactor,
      });
      if (this.activeStrokeProfile) {
        this.activeStrokeProfile.thicknessDynamicsHeldBaseStamps += 1;
        this.activeStrokeProfile.thicknessDynamicsMaximumHeldBaseStamps = Math.max(
          this.activeStrokeProfile.thicknessDynamicsMaximumHeldBaseStamps,
          stroke.heldThicknessStamps.length - stroke.heldThicknessHead,
        );
      }
      // The permanent layer still waits for the exact lift time, but the
      // predictive WebGPU tail must be presented immediately.
      this.displayDirty = true;
      this.requestRender();
      return;
    }

    this.commitThicknessStamp(stamp, stroke);
  }

  private releaseHeldThicknessStamps(referenceTimeMs: number, atLift: boolean): void {
    const stroke = this.activeStroke;
    if (!stroke || !stroke.thicknessTailHoldback) {
      return;
    }

    const held = stroke.heldThicknessStamps;
    let released = 0;
    while (stroke.heldThicknessHead < held.length) {
      const candidate = held[stroke.heldThicknessHead];
      const millisecondsBeforeReference = Math.max(0, referenceTimeMs - candidate.timeMs);
      if (!atLift && millisecondsBeforeReference < THICKNESS_TAPER_WINDOW_MS) {
        break;
      }

      candidate.stamp.radius = atLift
        ? endThicknessRadius(
          candidate.baseRadius,
          candidate.liveThicknessFactor,
          stroke.thicknessSettings.endThickness,
          millisecondsBeforeReference,
        )
        : candidate.baseRadius * candidate.liveThicknessFactor;
      this.commitThicknessStamp(candidate.stamp, stroke);
      stroke.heldThicknessHead += 1;
      released += 1;
    }

    if (released > 0 && this.activeStrokeProfile) {
      if (atLift) {
        this.activeStrokeProfile.thicknessDynamicsReleasedAtLift += released;
      } else {
        this.activeStrokeProfile.thicknessDynamicsReleasedDuringStroke += released;
      }
    }

    if (stroke.heldThicknessHead === held.length) {
      stroke.heldThicknessStamps = [];
      stroke.heldThicknessHead = 0;
    } else if (stroke.heldThicknessHead >= 1024) {
      stroke.heldThicknessStamps = held.slice(stroke.heldThicknessHead);
      stroke.heldThicknessHead = 0;
    }
  }

  private thicknessTailReferenceTimeMs(): number {
    const stroke = this.activeStroke;
    if (!stroke) {
      return performance.now();
    }
    return Math.max(stroke.lastInput.timeMs, performance.now());
  }

  private thicknessTailPreviewEligible(): boolean {
    const stroke = this.activeStroke;
    if (
      !stroke
      || !stroke.thicknessTailHoldback
      || stroke.lightGlazeSettings
      || stroke.heldThicknessHead >= stroke.heldThicknessStamps.length
    ) {
      return false;
    }
    return this.settings.blendMode === "normal" || this.settings.blendMode === "additive";
  }

  private prepareThicknessTailFrame(): ThicknessTailFrame | null {
    const stroke = this.activeStroke;
    if (!stroke || !this.thicknessTailPreviewEligible()) {
      return null;
    }

    const settings = this.settings;
    const held = stroke.heldThicknessStamps;
    const firstHeld = Math.max(
      stroke.heldThicknessHead,
      held.length - MAX_STAMPS_PER_BATCH,
    );
    const referenceTimeMs = this.thicknessTailReferenceTimeMs();
    const stamps: Stamp[] = [];
    for (let index = firstHeld; index < held.length; index += 1) {
      const candidate = held[index];
      const radius = endThicknessRadius(
        candidate.baseRadius,
        candidate.liveThicknessFactor,
        stroke.thicknessSettings.endThickness,
        Math.max(0, referenceTimeMs - candidate.timeMs),
      );
      if (!Number.isFinite(radius) || radius <= 0) {
        continue;
      }
      stamps.push({ ...candidate.stamp, radius });
    }
    if (stamps.length === 0) {
      return null;
    }

    const packed = this.packThicknessTailStamps(stamps, settings);
    if (!packed.dirtyRect) {
      return null;
    }
    this.ensureThicknessTailOverlayResources(
      packed.dirtyRect.width,
      packed.dirtyRect.height,
    );
    this.writeThicknessTailBrushUniforms(
      settings,
      this.thicknessTailTextureWidth,
      this.thicknessTailTextureHeight,
      packed.dirtyRect.x,
      packed.dirtyRect.y,
    );
    this.writeThicknessTailDisplayUniforms(
      packed.dirtyRect.x,
      packed.dirtyRect.y,
      settings,
    );
    this.device.queue.writeBuffer(
      this.thicknessTailInstanceBuffer,
      0,
      this.thicknessTailInstanceUpload,
      0,
      stamps.length * STAMP_STRIDE_BYTES,
    );

    return {
      settings,
      stamps,
      dirtyRect: packed.dirtyRect,
      shapeOccupancySelection: settings.shape === "shape"
        ? this.selectShapeOccupancy(packed.minimumRadius)
        : null,
      grainActive: this.isTexturizedGrainActive(settings),
    };
  }

  private encodeThicknessTailFrame(
    encoder: GPUCommandEncoder,
    frame: ThicknessTailFrame,
  ): void {
    const settings = frame.settings;
    const isShape = settings.shape === "shape";
    const shapeOccupancyMip = frame.shapeOccupancySelection?.selectedMipLevel ?? null;
    const useShapeOccupancy = isShape && shapeOccupancyMip !== null;
    const pipeline = frame.grainActive
      ? isShape
        ? useShapeOccupancy
          ? settings.blendMode === "additive"
            ? this.grainShapeOccupancyAdditivePipeline
            : this.grainShapeOccupancyNormalPipeline
          : settings.blendMode === "additive"
            ? this.grainShapeAdditivePipeline
            : this.grainShapeNormalPipeline
        : settings.blendMode === "additive"
          ? this.grainAdditivePipeline
          : this.grainNormalPipeline
      : isShape
        ? useShapeOccupancy
          ? settings.blendMode === "additive"
            ? this.shapeOccupancyAdditivePipeline
            : this.shapeOccupancyNormalPipeline
          : settings.blendMode === "additive"
            ? this.shapeAdditivePipeline
            : this.shapeNormalPipeline
        : settings.blendMode === "additive" ? this.additivePipeline : this.normalPipeline;
    const bindGroup = frame.grainActive
      ? useShapeOccupancy
        ? this.thicknessTailGrainBrushOccupancyBindGroups[
          this.grainCoordinateMode(settings)
        ][settings.grainFiltering][shapeOccupancyMip!]
        : this.thicknessTailGrainBrushBindGroups[
          this.grainCoordinateMode(settings)
        ][settings.grainFiltering]
      : useShapeOccupancy
        ? this.thicknessTailBrushOccupancyBindGroups[shapeOccupancyMip!]
        : this.thicknessTailBrushBindGroup;

    const pass = encoder.beginRenderPass({
      label: "Rebuild predictive thickness tail",
      colorAttachments: [
        {
          view: this.thicknessTailView!,
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setScissorRect(0, 0, frame.dirtyRect.width, frame.dirtyRect.height);
    pass.draw(STAMP_VERTICES_PER_COPY, frame.stamps.length * settings.count, 0, 0);
    pass.end();

    const profile = this.activeStrokeProfile;
    if (profile) {
      profile.thicknessDynamicsPreviewFrames += 1;
      profile.thicknessDynamicsPreviewBaseStamps += frame.stamps.length;
      profile.thicknessDynamicsPreviewPhysicalCopies += frame.stamps.length * settings.count;
      profile.thicknessDynamicsPreviewMaximumTexturePixels = Math.max(
        profile.thicknessDynamicsPreviewMaximumTexturePixels,
        this.thicknessTailTextureWidth * this.thicknessTailTextureHeight,
      );
    }
  }

  private commitThicknessStamp(stamp: Stamp, stroke: ActiveStroke): void {
    if (stamp.radius <= 0) {
      return;
    }
    const generationSettings = stroke.lightGlazeSettings ?? this.settings;
    const jitterReach = stamp.radius * 2 * (
      generationSettings.positionJitterLinear + generationSettings.positionJitterLateral
    );

    if (
      stamp.x + stamp.radius + jitterReach < 0 ||
      stamp.y + stamp.radius + jitterReach < 0 ||
      stamp.x - stamp.radius - jitterReach >= LAYER_SIZE ||
      stamp.y - stamp.radius - jitterReach >= LAYER_SIZE
    ) {
      return;
    }

    if (!stroke.historyCommitted) {
      this.truncateRedoHistory();
      this.historyActions.push({ id: stroke.historyActionId, kind: "stroke", layerId: this.layerStack.active.id });
      this.historyCursor = this.historyActions.length;
      stroke.historyCommitted = true;
      if (this.activeStrokeProfile) {
        this.activeStrokeProfile.historyCommittedActions += 1;
      }
    }

    this.pendingStamps.push(stamp);
    if (this.activeStrokeProfile) {
      this.activeStrokeProfile.baseStamps += 1;
    }
    this.displayDirty = true;
    this.requestRender();
  }

  private requestRender(): void {
    if (!this.initialized) {
      return;
    }
    if (this.frameRequest !== null) {
      return;
    }
    this.frameRequest = requestAnimationFrame((timestamp) => this.renderFrame(timestamp));
  }

  private renderFrame(timestamp: number): void {
    const frameStart = performance.now();
    this.frameRequest = null;
    if (!this.initialized) {
      return;
    }
    if (this.layerPresentationFrozen) {
      // The persistent screen cache already contains the last complete stack.
      // Do not submit bind groups that may still name an evicted derived texture;
      // the successful rebuild requests a fresh frame after publishing new views.
      return;
    }

    const resizeStart = performance.now();
    this.resizeCanvas();
    const resizeCanvasMs = performance.now() - resizeStart;

    if (this.activeStroke?.thicknessTailHoldback) {
      this.releaseHeldThicknessStamps(this.thicknessTailReferenceTimeMs(), false);
    }

    const batchExtractionStart = performance.now();
    let availableBatchSize = this.pendingStamps.length;
    const lightGlazeSession = this.lightGlazeSession;
    if (lightGlazeSession) {
      availableBatchSize = 0;
      while (
        availableBatchSize < this.pendingStamps.length
        && this.pendingStamps[availableBatchSize].historyActionId
          === lightGlazeSession.historyActionId
      ) {
        availableBatchSize += 1;
      }
    }
    const batchSize = Math.min(availableBatchSize, MAX_STAMPS_PER_BATCH);
    const batch = batchSize > 0 ? this.pendingStamps.splice(0, batchSize) : [];
    let blendBatch: PendingBlendBatch[] = [];
    if (!lightGlazeSession && batch.length === 0 && this.pendingBlendBatches.length > 0) {
      const first = this.pendingBlendBatches[0];
      let remainingPixelBudget = DRY_BLEND_FRAME_PIXEL_BUDGET;
      let blendBatchSize = 0;
      while (
        blendBatchSize < this.pendingBlendBatches.length
        && blendBatchSize < DRY_BLEND_MAX_BATCHES_PER_FRAME
        && this.pendingBlendBatches[blendBatchSize].actionId === first.actionId
      ) {
        const readRect = this.pendingBlendBatches[blendBatchSize].batch.readRect;
        const batchCost = readRect.width * readRect.height * 2;
        if (blendBatchSize > 0 && batchCost > remainingPixelBudget) {
          break;
        }
        remainingPixelBudget -= batchCost;
        blendBatchSize += 1;
      }
      blendBatch = this.pendingBlendBatches.splice(0, blendBatchSize);
    }
    if (lightGlazeSession) {
      lightGlazeSession.commitRequested = lightGlazeSession.endRequested
        && !this.pendingStamps.some(
          (stamp) => stamp.historyActionId === lightGlazeSession.historyActionId,
        );
    }
    const batchExtractionMs = performance.now() - batchExtractionStart;
    const shouldSubmit = this.clearRequested
      || batch.length > 0
      || blendBatch.length > 0
      || this.displayDirty
      || Boolean(lightGlazeSession?.commitRequested)
      || this.thicknessTailPreviewEligible()
      || this.thicknessTailPresentedRect !== null;

    if (!shouldSubmit || this.canvas.width <= 0 || this.canvas.height <= 0) {
      return;
    }

    const clearLayer = this.clearRequested;
    const renderSettings = blendBatch[0]?.settings
      ?? lightGlazeSession?.settings
      ?? this.settings;
    const start = performance.now();
    const timing = blendBatch.length > 0
      ? this.submitBlendImmediate(
        blendBatch.map((pending) => pending.batch),
        clearLayer,
        renderSettings,
        blendBatch[0].actionId,
      )
      : this.submitImmediate(batch, clearLayer, renderSettings);
    this.lastCpuFrameMs = performance.now() - start;

    if (blendBatch.length > 0) {
      this.recordBlendHistoryBatch(blendBatch, timing, clearLayer);
      this.layerHasContent = true;
    } else if (batch.length > 0) {
      this.trackAdaptivePreviewExactSubmission(batch, renderSettings);
      this.recordHistoryBatch(batch, renderSettings, timing, clearLayer);
      this.layerHasContent = true;
    } else if (clearLayer) {
      this.layerHasContent = false;
    }

    this.clearRequested = false;
    this.displayDirty = false;
    this.totalBaseStamps += batch.length + blendBatch.length;
    if (batch.length > 0) {
      this.avoidedLogicalDraws += batch.length * Math.max(0, renderSettings.count - 1);
    }
    this.recordRenderedFrame(timestamp);

    const statsPublishStart = performance.now();
    this.publishStats();
    const statsPublishMs = performance.now() - statsPublishStart;

    if (
      this.pendingStamps.length > 0
      || this.pendingBlendBatches.length > 0
      || this.displayDirty
      || this.clearRequested
      || Boolean(this.lightGlazeSession?.commitRequested)
      || this.thicknessTailPreviewEligible()
      || this.thicknessTailPresentedRect !== null
    ) {
      this.requestRender();
    }

    this.recordStrokeFrameTiming(
      timestamp,
      batch.length + blendBatch.length,
      blendBatch.length > 0 ? 1 : renderSettings.count,
      timing,
      {
      totalCpuMs: performance.now() - frameStart,
      resizeCanvasMs,
      batchExtractionMs,
      statsPublishMs,
      },
    );

    // Copre i rilasci differiti: cambio strumento o blending arrivato durante
    // un tratto o un replay, oppure pool riallocati dal replay Undo/Redo.
    this.maybeReleaseIdleBlendScratch();
    this.maybeReleaseIdleLightGlazeResources();
    this.maybeReleaseIdleGrainResources();
    this.maybeReleaseIdleShapeResources();
    this.scheduleEffectsScratchShrink();
    this.scheduleBevelFieldShrink();
  }

  private recordHistoryBatch(
    batch: Stamp[],
    settings: BrushSettings,
    timing: SubmitTiming,
    clearLayer: boolean,
  ): void {
    // pendingStamps riceve soltanto stamp interattivi e quindi ogni batch live
    // è interamente storico. Il benchmark sintetico usa submitImmediate()
    // direttamente e non passa da qui: evitiamo così una copia per frame.
    if (batch.length === 0 || batch[0].historyActionId === 0) {
      return;
    }

    if (
      this.activeStroke
      && batch.some((stamp) => stamp.historyActionId === this.activeStroke?.historyActionId)
    ) {
      this.activeStroke.submitted = true;
    }

    this.historyBatches.push({
      kind: "paint",
      // Safe to read the active layer here because switching is refused while a
      // stroke is open (assertLayerSwitchAllowed), so the layer that recorded
      // the stamps is still the active one when the batch is stored.
      layerId: this.layerStack.active.id,
      settings,
      stamps: batch,
      clearLayer,
      dirtyRect: timing.dirtyRect,
      shapeOccupancySelection: timing.shapeOccupancySelection,
      shapeMaskIdentity: this.shapeMaskIdentity,
      grainTextureIdentity: this.isTexturizedGrainActive(settings)
        ? this.grainTextureIdentity
        : null,
    });
    this.historyStoredBaseStamps += batch.length;

    if (this.activeStrokeProfile) {
      this.activeStrokeProfile.historyCapturedBaseStamps += batch.length;
      this.activeStrokeProfile.historyCapturedBatches += 1;
    }
  }

  private truncateRedoHistory(): void {
    if (this.historyCursor >= this.historyActions.length) {
      return;
    }
    this.historyActions.length = this.historyCursor;

    // Il primo stamp dopo un Undo deve restare O(1): gli array abbandonati
    // vengono esclusi subito e liberati alla prossima operazione esplicita.
    this.historyCompactionPending = true;
  }

  private compactDiscardedHistory(): void {
    if (!this.historyCompactionPending) {
      return;
    }

    const retainedActionIds = new Set(
      this.historyActions
        .filter((action) => action.kind === "stroke")
        .map((action) => action.id),
    );

    const retainedBatches: HistoryRenderBatch[] = [];
    let retainedStampCount = 0;
    for (const batch of this.historyBatches) {
      if (batch.kind === "blend") {
        if (!retainedActionIds.has(batch.actionId)) {
          continue;
        }
        retainedBatches.push(batch);
        retainedStampCount += batch.batches.length;
        continue;
      }
      const retainedStamps = batch.stamps.filter(
        (stamp) => retainedActionIds.has(stamp.historyActionId),
      );
      if (retainedStamps.length === 0) {
        continue;
      }
      retainedBatches.push(retainedStamps.length === batch.stamps.length
        ? batch
        : { ...batch, stamps: retainedStamps });
      retainedStampCount += retainedStamps.length;
    }
    this.historyBatches = retainedBatches;
    this.historyStoredBaseStamps = retainedStampCount;
    this.historyCompactionPending = false;
  }

  private hasVisibleHistoryContent(layerId?: number): boolean {
    return hasVisibleContent(this.historyActions, this.historyCursor, layerId);
  }

  private resetHistoryState(): void {
    this.historyActions = [];
    this.historyCursor = 0;
    this.nextHistoryActionId = 1;
    this.historyBatches = [];
    this.historyStoredBaseStamps = 0;
    this.historyCompactionPending = false;
  }

  private async moveHistoryCursor(delta: -1 | 1): Promise<boolean> {
    if (!this.initialized || this.activeStroke || this.historyBusy) {
      return false;
    }
    if (this.layerSwitchBusy) {
      return false;
    }
    const nextCursor = this.historyCursor + delta;
    if (nextCursor < 0 || nextCursor > this.historyActions.length) {
      return false;
    }
    // The refusal lives here as well as in getHistoryState: reporting
    // canUndo=false only greys out a button, and the API is reachable directly.
    // Only a vanished layer is refused now — a step into another live layer moves
    // the active layer with the cursor further down.
    if (this.historyStepBlockedByLayer(delta)) {
      this.callbacks.onStatus?.(
        delta < 0
          ? "Il livello di quel passo non esiste più: impossibile annullarlo."
          : "Il livello di quel passo non esiste più: impossibile ripristinarlo.",
        "error",
      );
      return false;
    }

    const previousCursor = this.historyCursor;
    this.cancelLayerColdCompressionIdle();
    this.invalidateAdaptivePreview();
    this.historyBusy = true;
    this.publishHistoryState();
    this.callbacks.onStatus?.(
      delta < 0 ? "Undo: ricostruzione del layer…" : "Redo: ricostruzione del layer…",
      "working",
    );

    try {
      await this.waitForIdle();
      // Eventuali rami Redo già invalidati vengono liberati soltanto dentro
      // un'operazione esplicita, mai durante o subito dopo una pennellata.
      this.compactDiscardedHistory();
      // Cross-layer Undo/Redo is one transaction: switch, move the cursor, replay.
      // Any failure restores the target pixels under the OLD cursor before moving
      // the active layer back. Reversing that order would strand a partially
      // cleared target texture behind an apparently successful rollback.
      const previousActiveIndex = this.layerStack.activeIndex;
      const targetIndex = this.historyStepTargetLayerIndex(delta);
      const switched = targetIndex !== null && targetIndex !== previousActiveIndex;
      if (switched) {
        // Freeze both the visible effect result and the authoritative raw tiles
        // before the shared workbench is pointed elsewhere. Neither candidate is
        // published until its GPU copy completes.
        this.persistActiveLayerState();
        await this.prepareActiveLayerForSwitch();
      }
      let replayAttempted = false;
      try {
        if (switched) {
          this.layerStack.setActiveIndex(targetIndex);
          await this.activateLayer(previousActiveIndex, "history-replay");
        }
        this.historyCursor = nextCursor;
        replayAttempted = true;
        await this.rebuildActiveLayerFromHistory();
      } catch (operationError) {
        this.historyCursor = previousCursor;
        const rollbackErrors: unknown[] = [];

        // If replay was entered, it may already have submitted a clear or one or
        // more batches. Restore the TARGET while it is still active and while the
        // cursor again describes the pre-operation document. A switched target
        // must then receive a fresh cold candidate before reverse activation is
        // allowed to release its repaired full texture.
        let targetPreparedForRelease = !replayAttempted;
        if (replayAttempted) {
          try {
            await this.rebuildActiveLayerFromHistory();
            if (switched) {
              this.persistActiveLayerState();
              await this.prepareActiveLayerForSwitch();
            }
            targetPreparedForRelease = true;
          } catch (restoreTargetError) {
            rollbackErrors.push(restoreTargetError);
          }
        }

        // activateLayer itself can fail after binding engine fields and Blend but
        // before retargeting the effects workbench. switched is derived before
        // that await, so this reverse activation also repairs a half-switch. If
        // target recovery/packing failed, keep its full texture alive and latch
        // the document instead of silently discarding the only valid copy.
        if (switched && targetPreparedForRelease) {
          try {
            // A failed activation can leave the target hot while its pre-switch
            // cold store is still authoritative. Release that reconstructible
            // candidate before rehydrating the previous active layer.
            this.evictReconstructibleLayerResources(this.layerStack.at(targetIndex));
            this.layerStack.setActiveIndex(previousActiveIndex);
            await this.activateLayer(targetIndex, "history-replay");
          } catch (restoreSwitchError) {
            rollbackErrors.push(restoreSwitchError);
          }
        }

        if (rollbackErrors.length > 0) {
          const originalMessage = operationError instanceof Error
            ? operationError.message
            : String(operationError);
          const restoreMessage = rollbackErrors.map((rollbackError) =>
            rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
          ).join("; ");
          // A damaged target or half-retargeted workbench is not safe to edit.
          // Latch historyBusy in finally; every existing mutation guard and the UI
          // already treats it as a hard lock, and only a reload clears the latch.
          this.historyStateInconsistent = true;
          this.callbacks.onStatus?.(
            "Stato incoerente dopo Undo/Redo: ricarica prima di continuare.",
            "error",
          );
          throw new Error(
            `Undo/Redo non riuscito (${originalMessage}) e ripristino fallito (${restoreMessage}). `
            + "Ricarica la pagina prima di continuare.",
          );
        }
        throw operationError;
      }
      if (switched) {
        this.callbacks.onActiveLayerChange?.(this.layerStack.activeIndex);
      }
      if (this.activeStrokeProfile) {
        this.activeStrokeProfile.historyReplayOperations += 1;
      }
      this.callbacks.onStatus?.(
        delta < 0 ? "Undo completato." : "Redo completato.",
        "ok",
      );
      return true;
    } finally {
      // A failed rollback is a terminal document state. Keeping historyBusy high
      // reuses every engine-side mutation guard and the UI lock; a status message
      // alone would still let the user continue painting on incoherent resources.
      this.historyBusy = this.historyStateInconsistent;
      if (import.meta.env.DEV) {
        // A point that did not match this transaction must not ambush a later
        // unrelated Undo/Redo. Multi-point rollback probes are consumed before
        // this outer transaction finally runs.
        this.historyReplayFaultQueue = [];
        this.layerColdStorageFaultQueue = [];
      }
      this.publishHistoryState();
      this.scheduleEffectsScratchShrink();
      this.scheduleBevelFieldShrink();
      this.scheduleLayerColdCompression();
    }
  }

  /**
   * Rebuilds the ACTIVE layer by clearing it and re-applying its own visible
   * strokes.
   *
   * Both the visible-id scan and the batch list are filtered by layer. Without
   * that filter the replay re-applied every layer's visible strokes onto the
   * active texture: with P on layer A and Q on layer B, undoing Q while B was
   * active painted A's stroke onto B. Reproduced on GPU as layer B going from
   * {P:0, Q:1024} to {P:1024, Q:0}.
   *
   * This routine deliberately writes only to the active layer. The history
   * transaction switches to the action's owner before calling it; on failure it
   * restores that target under the old cursor before switching back.
   *
   * Dev-only fault injection makes both destructive replay and half-activation
   * failures observable rather than trusting an unreachable rollback path.
   *
   * The rollback is the part of a global undo that can lose the user's work, and
   * the happy path never runs it — mutating the rollback leaves every test green.
   * Deliberately injectable so the failure can be exercised on purpose instead of
   * shipped on trust.
   */
  private historyReplayFaultQueue: HistoryReplayFaultPoint[] = [];

  injectHistoryReplayFault(...faultPoints: HistoryReplayFaultPoint[]): void {
    if (!import.meta.env.DEV) {
      throw new Error("Iniezione di guasti disponibile solo in modalità dev.");
    }
    if (faultPoints.length === 0) {
      throw new Error("Specifica almeno un punto di guasto della cronologia.");
    }
    this.historyReplayFaultQueue = [...faultPoints];
  }

  private maybeInjectHistoryReplayFault(point: HistoryReplayFaultPoint): void {
    if (!import.meta.env.DEV || this.historyReplayFaultQueue[0] !== point) {
      return;
    }
    this.historyReplayFaultQueue.shift();
    throw new Error(`Guasto iniettato nella cronologia: ${point}.`);
  }

  private async rebuildActiveLayerFromHistory(): Promise<void> {
    const layerId = this.layerStack.active.id;
    const {
      batches: layerBatches,
      visibleStrokeIds: visibleIds,
    } = selectLayerReplay(
      this.historyActions,
      this.historyCursor,
      this.historyBatches,
      layerId,
    );
    if (layerBatches.some((batch) => batch.grainTextureIdentity !== null)) {
      await this.ensureGrainResources();
    }
    if (layerBatches.some((batch) => batch.settings.shape === "shape")) {
      await this.ensureShapeResources();
    }
    // Force the first historical Blend action to reset its persistent carrier,
    // even when its numeric id matches the last live action rendered.
    this.blendRenderer?.beginStroke(0);
    let firstVisibleBatchIndex = -1;
    let lastVisibleBatchIndex = -1;
    let firstReplaySubmitObserved = false;
    const observeReplaySubmit = (): void => {
      if (firstReplaySubmitObserved) {
        return;
      }
      firstReplaySubmitObserved = true;
      this.maybeInjectHistoryReplayFault("after-first-replay-submit");
    };
    for (let index = 0; index < layerBatches.length; index += 1) {
      const batch = layerBatches[index];
      const visible = batch.kind === "blend"
        ? visibleIds.has(batch.actionId)
        : batch.stamps.some((stamp) => visibleIds.has(stamp.historyActionId));
      if (!visible) {
        continue;
      }
      if (firstVisibleBatchIndex < 0) {
        firstVisibleBatchIndex = index;
      }
      lastVisibleBatchIndex = index;
    }

    try {
      if (lastVisibleBatchIndex < 0) {
        this.submitImmediate([], true, this.settings, true, null);
        observeReplaySubmit();
      } else {
        const firstVisibleBatch = layerBatches[firstVisibleBatchIndex];
        if (!firstVisibleBatch.clearLayer) {
          // Il clear originale era un pass separato (per esempio dopo
          // "Pulisci"): manteniamo quel confine prima del primo batch visibile.
          this.submitImmediate([], true, firstVisibleBatch.settings, false, null);
          observeReplaySubmit();
        }

        for (let index = firstVisibleBatchIndex; index <= lastVisibleBatchIndex; index += 1) {
          const batch = layerBatches[index];
          if (batch.kind === "blend") {
            if (!visibleIds.has(batch.actionId)) {
              continue;
            }
            this.submitBlendImmediate(
              batch.batches,
              batch.clearLayer,
              batch.settings,
              batch.actionId,
              index === lastVisibleBatchIndex,
              batch,
            );
            observeReplaySubmit();
            continue;
          }
          const allVisible = batch.stamps.every((stamp) => visibleIds.has(stamp.historyActionId));
          const replayStamps = allVisible
            ? batch.stamps
            : batch.stamps.filter((stamp) => visibleIds.has(stamp.historyActionId));
          if (replayStamps.length === 0) {
            continue;
          }

          if (isStrokeGlazeBlendMode(batch.settings.blendMode)) {
            const actionId = replayStamps[0].historyActionId;
            if (replayStamps.some((stamp) => stamp.historyActionId !== actionId)) {
              throw new Error("Un batch Light Glaze storico contiene più pennellate.");
            }
            if (!this.lightGlazeSession) {
              this.startLightGlazeSession(actionId, batch.settings);
            } else if (this.lightGlazeSession.historyActionId !== actionId) {
              throw new Error("Ordine storico Light Glaze non valido.");
            }
            let hasLaterBatchForAction = false;
            for (let nextIndex = index + 1; nextIndex <= lastVisibleBatchIndex; nextIndex += 1) {
              const nextBatch = layerBatches[nextIndex];
              if (
                nextBatch.kind === "paint"
                && nextBatch.stamps.some(
                  (stamp) => stamp.historyActionId === actionId && visibleIds.has(actionId),
                )
              ) {
                hasLaterBatchForAction = true;
                break;
              }
            }
            const replaySession = this.lightGlazeSession;
            if (!replaySession) {
              throw new Error("Sessione Light Glaze storica non inizializzata.");
            }
            replaySession.endRequested = !hasLaterBatchForAction;
            replaySession.commitRequested = !hasLaterBatchForAction;
          }

          this.writeBrushUniforms(batch.settings);
          this.submitImmediate(
            replayStamps,
            batch.clearLayer,
            batch.settings,
            index === lastVisibleBatchIndex,
            batch,
          );
          observeReplaySubmit();
        }
        if (this.lightGlazeSession) {
          throw new Error("La ricostruzione storica ha lasciato un tratto Light Glaze aperto.");
        }
      }
    } finally {
      if (this.lightGlazeSession) {
        this.abandonLightGlazeSession();
      }
      // Ogni writeBuffer è ordinata sulla stessa GPUQueue: il ripristino arriva
      // dopo tutti i batch storici e prima di un eventuale tratto successivo.
      this.writeBrushUniforms(this.settings);
      if (this.isTexturizedGrainActive(this.settings)) {
        this.writeGrainUniforms(this.settings);
      }
    }

    this.clearRequested = false;
    this.displayDirty = false;
    this.layerHasContent = lastVisibleBatchIndex >= 0;
    await this.device.queue.onSubmittedWorkDone();
  }

  private selectShapeOccupancy(minimumRadius: number): ShapeOccupancySelection {
    const finiteRadius = Number.isFinite(minimumRadius);
    const estimatedLod = finiteRadius
      ? Math.log2(SHAPE_MASK_SIZE / Math.max(1, minimumRadius * 2))
      : Number.POSITIVE_INFINITY;
    const requiredMip = finiteRadius
      ? Math.max(0, Math.ceil(estimatedLod + 0.0001))
      : -1;
    const candidateInRange = requiredMip >= 0 && requiredMip <= SHAPE_OCCUPANCY_MAX_MIP;
    const candidateActiveCells = candidateInRange
      ? this.shapeOccupancyActiveCells[requiredMip]
      : 0;
    const candidateCoverageRatio = candidateInRange
      ? this.shapeOccupancyCoverageRatios[requiredMip]
      : 0;

    if (!finiteRadius || minimumRadius < SHAPE_OCCUPANCY_MIN_RADIUS) {
      return {
        selectedMipLevel: null,
        fallbackReason: "minimum-radius",
        candidateMipLevel: requiredMip,
        candidateActiveCells,
        candidateCoverageRatio,
      };
    }
    if (!candidateInRange) {
      return {
        selectedMipLevel: null,
        fallbackReason: "mip-out-of-range",
        candidateMipLevel: requiredMip,
        candidateActiveCells: 0,
        candidateCoverageRatio: 0,
      };
    }
    if (candidateCoverageRatio > SHAPE_OCCUPANCY_MAX_COVERAGE_RATIO) {
      return {
        selectedMipLevel: null,
        fallbackReason: "coverage-too-dense",
        candidateMipLevel: requiredMip,
        candidateActiveCells,
        candidateCoverageRatio,
      };
    }
    return {
      selectedMipLevel: requiredMip,
      fallbackReason: "none",
      candidateMipLevel: requiredMip,
      candidateActiveCells,
      candidateCoverageRatio,
    };
  }

  private recordShapeSampling(selection: ShapeOccupancySelection): void {
    const occupancyMip = selection.selectedMipLevel;
    const strategy: ShapeSamplingStrategy = occupancyMip === null
      ? SHAPE_LEGACY_STRATEGY
      : SHAPE_OCCUPANCY_STRATEGY;
    const activeCells = occupancyMip === null ? 0 : this.shapeOccupancyActiveCells[occupancyMip];
    const coverageRatio = occupancyMip === null ? 0 : this.shapeOccupancyCoverageRatios[occupancyMip];

    this.lastStampGeometry = STAMP_GEOMETRY;
    this.lastStampVerticesPerCopy = STAMP_VERTICES_PER_COPY;
    this.lastShapeSamplingStrategy = strategy;
    this.lastShapeOccupancyFallbackReason = selection.fallbackReason;
    this.lastShapeOccupancyMipLevel = occupancyMip ?? -1;
    this.lastShapeOccupancyActiveCells = activeCells;
    this.lastShapeOccupancyCoverageRatio = coverageRatio;
    this.lastShapeOccupancyCandidateMipLevel = selection.candidateMipLevel;
    this.lastShapeOccupancyCandidateActiveCells = selection.candidateActiveCells;
    this.lastShapeOccupancyCandidateCoverageRatio = selection.candidateCoverageRatio;

    const profile = this.activeStrokeProfile;
    if (!profile) {
      return;
    }
    profile.stampGeometry = STAMP_GEOMETRY;
    profile.stampVerticesPerCopy = STAMP_VERTICES_PER_COPY;
    const previousStrategy = profile.shapeSamplingStrategy;
    profile.shapeSamplingStrategy = profile.shapeSamplingStrategy === "none"
      ? strategy
      : profile.shapeSamplingStrategy === strategy
        ? strategy
        : "mixed";
    if (previousStrategy !== "none" && previousStrategy !== strategy) {
      profile.shapeOccupancyFallbackReason = "mixed";
    } else if (selection.fallbackReason !== "none") {
      profile.shapeOccupancyFallbackReason = profile.shapeOccupancyFallbackReason === "none"
        ? selection.fallbackReason
        : profile.shapeOccupancyFallbackReason === selection.fallbackReason
          ? selection.fallbackReason
          : "mixed";
    }
    profile.shapeOccupancyCandidateMipLevel = Math.max(
      profile.shapeOccupancyCandidateMipLevel,
      selection.candidateMipLevel,
    );
    profile.shapeOccupancyCandidateActiveCells = Math.max(
      profile.shapeOccupancyCandidateActiveCells,
      selection.candidateActiveCells,
    );
    profile.shapeOccupancyCandidateCoverageRatio = Math.max(
      profile.shapeOccupancyCandidateCoverageRatio,
      selection.candidateCoverageRatio,
    );
    if (occupancyMip !== null) {
      profile.shapeOccupancyMipLevel = Math.max(profile.shapeOccupancyMipLevel, occupancyMip);
      profile.shapeOccupancyActiveCells = Math.max(profile.shapeOccupancyActiveCells, activeCells);
      profile.shapeOccupancyCoverageRatio = Math.max(profile.shapeOccupancyCoverageRatio, coverageRatio);
    }
  }

  private recordBlendHistoryBatch(
    pending: readonly PendingBlendBatch[],
    timing: SubmitTiming,
    clearLayer: boolean,
  ): void {
    if (pending.length === 0 || pending[0].actionId === 0) {
      return;
    }
    const actionId = pending[0].actionId;
    if (pending.some((entry) => entry.actionId !== actionId)) {
      throw new Error("Un batch storico Blend contiene più pennellate.");
    }
    if (this.activeStroke?.historyActionId === actionId) {
      this.activeStroke.submitted = true;
    }
    const settings = pending[0].settings;
    this.historyBatches.push({
      kind: "blend",
      actionId,
      layerId: this.layerStack.active.id,
      settings,
      batches: pending.map((entry) => entry.batch),
      clearLayer,
      dirtyRect: timing.dirtyRect,
      shapeMaskIdentity: this.shapeMaskIdentity,
      grainTextureIdentity: this.isTexturizedGrainActive(settings)
        ? this.grainTextureIdentity
        : null,
    });
    this.historyStoredBaseStamps += pending.length;
    if (this.activeStrokeProfile) {
      this.activeStrokeProfile.historyCapturedBaseStamps += pending.length;
      this.activeStrokeProfile.historyCapturedBatches += 1;
    }
  }

  private adaptivePreviewRgb(
    colorSeed: number,
    settings: BrushSettings,
    baseHsl: readonly [number, number, number] = hexToHsl(settings.color),
  ): [number, number, number] {
    const jitterMaster = settings.jitterMaster;
    const hueDelta = (previewRandom01(colorSeed, 1) - 0.5)
      * 2
      * (settings.hueJitterDegrees / 360)
      * jitterMaster;
    const saturationDelta = (previewRandom01(colorSeed, 2) - 0.5)
      * 2
      * settings.saturationJitter
      * jitterMaster;
    const lightnessDelta = (previewRandom01(colorSeed, 3) - 0.5)
      * 2
      * settings.lightnessJitter
      * jitterMaster;
    const darkness = previewRandom01(colorSeed, 4) * settings.darknessJitter * jitterMaster;
    const lightnessBeforeDarkness = clamp(baseHsl[2] + lightnessDelta, 0, 1);
    return previewHslToRgb(
      baseHsl[0] + hueDelta,
      baseHsl[1] + saturationDelta,
      lightnessBeforeDarkness * (1 - darkness),
    );
  }

  private prepareAdaptivePreviewShapePalette(settings: BrushSettings): void {
    const source = this.adaptivePreviewShapeSprite;
    if (settings.shape !== "shape" || !source || !this.adaptivePreviewContext) {
      return;
    }
    const key = [
      settings.color,
      settings.jitterMaster,
      settings.hueJitterDegrees,
      settings.saturationJitter,
      settings.lightnessJitter,
      settings.darknessJitter,
      settings.hardness,
    ].join("|");
    if (key === this.adaptivePreviewShapePaletteKey) {
      return;
    }

    const baseHsl = hexToHsl(settings.color);
    const coverageSource = document.createElement("canvas");
    coverageSource.width = source.width;
    coverageSource.height = source.height;
    const coverageContext = coverageSource.getContext("2d");
    const sourceContext = source.getContext("2d");
    if (!coverageContext || !sourceContext) {
      this.adaptivePreviewShapePalette = [];
      this.adaptivePreviewShapePaletteKey = key;
      return;
    }
    const coverageImage = sourceContext.getImageData(0, 0, source.width, source.height);
    const hardness = clamp(settings.hardness, 0, 1);
    for (let index = 3; index < coverageImage.data.length; index += 4) {
      const sourceCoverage = coverageImage.data[index] / 255;
      const coverage = sourceCoverage * sourceCoverage * (1 - hardness)
        + sourceCoverage * hardness;
      coverageImage.data[index] = Math.round(clamp(coverage, 0, 1) * 255);
    }
    coverageContext.putImageData(coverageImage, 0, 0);

    const entries: AdaptivePreviewShapePaletteEntry[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < ADAPTIVE_PREVIEW_SHAPE_PALETTE_SIZE; index += 1) {
      const seed = previewHash32(Math.imul(index + 1, 0x9e3779b1) ^ 0xa511e9b3);
      const [red, green, blue] = this.adaptivePreviewRgb(seed, settings, baseHsl);
      const color = `rgb(${red} ${green} ${blue})`;
      if (seen.has(color)) {
        continue;
      }
      const sprite = document.createElement("canvas");
      sprite.width = source.width;
      sprite.height = source.height;
      const context = sprite.getContext("2d");
      if (!context) {
        continue;
      }
      context.drawImage(coverageSource, 0, 0);
      context.globalCompositeOperation = "source-in";
      context.fillStyle = color;
      context.fillRect(0, 0, sprite.width, sprite.height);
      entries.push({ red, green, blue, sprite });
      seen.add(color);
    }
    this.adaptivePreviewShapePalette = entries;
    this.adaptivePreviewShapePaletteKey = key;
  }

  private nearestAdaptivePreviewShapeSprite(copy: AdaptivePreviewCopy): HTMLCanvasElement | null {
    let nearest: AdaptivePreviewShapePaletteEntry | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const entry of this.adaptivePreviewShapePalette) {
      const red = entry.red - copy.red;
      const green = entry.green - copy.green;
      const blue = entry.blue - copy.blue;
      const distance = red * red + green * green + blue * blue;
      if (distance < nearestDistance) {
        nearest = entry;
        nearestDistance = distance;
      }
    }
    return nearest?.sprite ?? null;
  }

  private adaptivePreviewCandidatesForFrame(): AdaptivePreviewCandidate[] {
    return this.adaptivePreviewCandidates
      .filter((candidate) => candidate.serial === null
        || candidate.serial > this.adaptivePreviewConfirmedSerial)
      .slice(-ADAPTIVE_PREVIEW_MAX_TIP_BASE_STAMPS);
  }

  private finishAdaptivePreviewLifetime(timestamp = performance.now()): void {
    if (this.adaptivePreviewStartedAt <= 0) {
      return;
    }
    if (this.activeStrokeProfile) {
      this.activeStrokeProfile.adaptivePreviewMaxLifetimeMs = Math.max(
        this.activeStrokeProfile.adaptivePreviewMaxLifetimeMs,
        timestamp - this.adaptivePreviewStartedAt,
      );
    }
    this.adaptivePreviewStartedAt = 0;
  }

  private clearAdaptivePreviewCanvas(): void {
    const canvas = this.adaptivePreviewCanvas;
    const context = this.adaptivePreviewContext;
    if (!canvas || !context) {
      return;
    }
    const hasVisibleBitmap = canvas.style.opacity === "1"
      || this.adaptivePreviewLastPresentedSerial > 0
      || this.adaptivePreviewCandidates.some((candidate) => candidate.presented);
    if (!hasVisibleBitmap) {
      this.adaptivePreviewLastPresentedSerial = 0;
      return;
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.clearRect(0, 0, canvas.width, canvas.height);
    canvas.style.opacity = "0";
    canvas.style.left = "-10000px";
    canvas.style.top = "-10000px";
    this.adaptivePreviewLastPresentedSerial = 0;
    for (const candidate of this.adaptivePreviewCandidates) {
      candidate.presented = false;
    }
  }

  private hideConfirmedStaleAdaptivePreviewBitmap(): boolean {
    const canvas = this.adaptivePreviewCanvas;
    if (
      !canvas
      || canvas.style.opacity !== "1"
      || this.adaptivePreviewLastPresentedSerial <= 0
      || this.adaptivePreviewLastPresentedSerial > this.adaptivePreviewConfirmedSerial
      || this.hasAdaptivePreviewPresentedUnboundCandidate()
    ) {
      return false;
    }

    // Il backing resta intatto e verrà sostituito atomicamente con `copy` al
    // prossimo commit riuscito. Nascondere soltanto l'elemento evita di
    // aggiungere un clear Canvas2D proprio nel frame che ha già sforato il
    // budget, ma impedisce a un tip ormai raggiunto dalla GPU di restare fermo
    // sopra stamp esatti più recenti.
    canvas.style.opacity = "0";
    this.adaptivePreviewLastPresentedSerial = 0;
    for (const candidate of this.adaptivePreviewCandidates) {
      candidate.presented = false;
    }
    if (this.activeStrokeProfile) {
      this.activeStrokeProfile.adaptivePreviewConfirmedStaleBitmapHides += 1;
    }
    return true;
  }

  private requestAdaptivePreviewIncompleteFrameRetry(
    candidates: readonly AdaptivePreviewCandidate[],
  ): void {
    if (!this.adaptivePreviewActive || this.adaptivePreviewFrozen) {
      return;
    }

    let latestSerial = 0;
    for (const candidate of candidates) {
      if (candidate.serial !== null) {
        latestSerial = Math.max(latestSerial, candidate.serial);
      }
    }
    if (
      latestSerial <= 0
      || latestSerial <= this.adaptivePreviewLastIncompleteRetrySerial
    ) {
      return;
    }

    // Un solo tentativo aggiuntivo per ogni nuovo tip: evita un loop rAF
    // quando il dispositivo non riesce stabilmente a rispettare il budget.
    this.adaptivePreviewLastIncompleteRetrySerial = latestSerial;
    if (this.activeStrokeProfile) {
      this.activeStrokeProfile.adaptivePreviewIncompleteFrameRetryRequests += 1;
    }
    this.requestAdaptivePreviewDraw();
  }

  private finishIncompleteAdaptivePreviewFrame(
    startedAt: number,
    budgetAlreadyCounted: boolean,
    candidates: readonly AdaptivePreviewCandidate[],
    retry: boolean,
  ): void {
    this.hideConfirmedStaleAdaptivePreviewBitmap();
    if (retry) {
      this.requestAdaptivePreviewIncompleteFrameRetry(candidates);
    }
    this.recordAdaptivePreviewJsFrame(startedAt, budgetAlreadyCounted);
  }

  private cancelAdaptivePreviewProbe(): void {
    const probe = this.adaptivePreviewProbe;
    if (!probe) {
      return;
    }
    window.clearTimeout(probe.timeout);
    this.adaptivePreviewProbe = null;
    if (probe.telemetryProfile) {
      probe.telemetryProfile.adaptivePreviewProbeCancellations += 1;
    }
  }

  private invalidateAdaptivePreview(): void {
    this.finishAdaptivePreviewLifetime();
    this.adaptivePreviewGeneration += 1;
    this.cancelAdaptivePreviewProbe();
    if (this.adaptivePreviewFrameRequest !== null) {
      cancelAnimationFrame(this.adaptivePreviewFrameRequest);
      this.adaptivePreviewFrameRequest = null;
    }
    if (this.adaptivePreviewRetirementFrame !== null) {
      cancelAnimationFrame(this.adaptivePreviewRetirementFrame);
      this.adaptivePreviewRetirementFrame = null;
    }
    this.adaptivePreviewSubmissionsSinceProbe = 0;
    this.adaptivePreviewSubmittedSerial = 0;
    this.adaptivePreviewConfirmedSerial = 0;
    this.adaptivePreviewLastIncompleteRetrySerial = 0;
    this.adaptivePreviewCandidates.length = 0;
    this.adaptivePreviewConsecutiveSlowProbes = 0;
    this.adaptivePreviewActive = false;
    this.adaptivePreviewFrozen = false;
    this.adaptivePreviewForceStroke = false;
    this.adaptivePreviewRetirementTargetSerial = 0;
    this.clearAdaptivePreviewCanvas();
  }

  private activateAdaptivePreview(
    reason: AdaptivePreviewConcreteActivationReason,
  ): void {
    if (
      this.adaptivePreviewActive
      || this.adaptivePreviewFrozen
      || !this.adaptivePreviewContext
      || this.adaptivePreviewCandidates.length === 0
    ) {
      return;
    }
    const settings = this.adaptivePreviewCandidates[this.adaptivePreviewCandidates.length - 1].settings;
    if (settings.blendMode !== "normal") {
      if (this.activeStrokeProfile) {
        this.activeStrokeProfile.adaptivePreviewUnsupportedBlendSkips += 1;
      }
      return;
    }

    this.adaptivePreviewActive = true;
    const activatedAt = performance.now();
    this.adaptivePreviewStartedAt = activatedAt;
    const profile = this.activeStrokeProfile;
    if (profile) {
      const activationOffsetMs = activatedAt - profile.startedAt;
      if (profile.adaptivePreviewActivations === 0) {
        profile.adaptivePreviewFirstActivationReason = reason;
        profile.adaptivePreviewFirstActivationMs = activationOffsetMs;
      } else if (profile.adaptivePreviewActivations === 1) {
        profile.adaptivePreviewSecondActivationReason = reason;
        profile.adaptivePreviewSecondActivationMs = activationOffsetMs;
      }
      profile.adaptivePreviewActivations += 1;
      profile.adaptivePreviewActivationReason = profile.adaptivePreviewActivationReason === "none"
        ? reason
        : profile.adaptivePreviewActivationReason === reason
          ? reason
          : "mixed";
    }
    this.requestAdaptivePreviewDraw();
  }

  private retireAdaptivePreview(countRetirement: boolean): void {
    const hadPreview = this.adaptivePreviewActive
      || this.adaptivePreviewFrozen
      || this.adaptivePreviewLastPresentedSerial > 0;
    this.finishAdaptivePreviewLifetime();
    this.adaptivePreviewGeneration += 1;
    this.cancelAdaptivePreviewProbe();
    if (this.adaptivePreviewFrameRequest !== null) {
      cancelAnimationFrame(this.adaptivePreviewFrameRequest);
      this.adaptivePreviewFrameRequest = null;
    }
    if (this.adaptivePreviewRetirementFrame !== null) {
      cancelAnimationFrame(this.adaptivePreviewRetirementFrame);
      this.adaptivePreviewRetirementFrame = null;
    }
    this.adaptivePreviewCandidates.length = 0;
    this.adaptivePreviewActive = false;
    this.adaptivePreviewFrozen = false;
    this.adaptivePreviewForceStroke = false;
    this.adaptivePreviewRetirementTargetSerial = 0;
    this.adaptivePreviewSubmissionsSinceProbe = 0;
    this.adaptivePreviewLastIncompleteRetrySerial = 0;
    this.adaptivePreviewConsecutiveSlowProbes = 0;
    this.clearAdaptivePreviewCanvas();
    if (hadPreview && countRetirement && this.activeStrokeProfile) {
      this.activeStrokeProfile.adaptivePreviewRetirements += 1;
    }
  }

  private retireAdaptivePreviewAfterGpuIdle(): void {
    if (
      this.adaptivePreviewActive
      || this.adaptivePreviewFrozen
      || this.adaptivePreviewLastPresentedSerial > 0
    ) {
      this.adaptivePreviewConfirmedSerial = Math.max(
        this.adaptivePreviewConfirmedSerial,
        this.adaptivePreviewSubmittedSerial,
      );
      if (this.adaptivePreviewFrozen) {
        this.scheduleAdaptivePreviewRetirement();
      } else {
        this.scheduleAdaptivePreviewCatchUpClear();
      }
    } else {
      this.clearAdaptivePreviewCanvas();
    }
  }

  private hasAdaptivePreviewPresentedUnboundCandidate(): boolean {
    return this.adaptivePreviewCandidates.some(
      (candidate) => candidate.presented && candidate.serial === null,
    );
  }

  private hasAdaptivePreviewUnconfirmedCandidate(): boolean {
    return this.adaptivePreviewCandidates.some(
      (candidate) => candidate.serial === null
        || candidate.serial > this.adaptivePreviewConfirmedSerial,
    );
  }

  private scheduleAdaptivePreviewRetirement(): void {
    if (this.adaptivePreviewRetirementFrame !== null) {
      return;
    }
    const generation = this.adaptivePreviewGeneration;
    this.adaptivePreviewRetirementFrame = requestAnimationFrame(() => {
      this.adaptivePreviewRetirementFrame = null;
      const targetSerial = this.adaptivePreviewRetirementTargetSerial;
      if (
        generation !== this.adaptivePreviewGeneration
        || !this.adaptivePreviewFrozen
        || this.hasAdaptivePreviewPresentedUnboundCandidate()
        || targetSerial <= 0
        || this.adaptivePreviewConfirmedSerial < targetSerial
      ) {
        return;
      }
      this.retireAdaptivePreview(true);
    });
  }

  private scheduleAdaptivePreviewCatchUpClear(): void {
    if (this.adaptivePreviewRetirementFrame !== null) {
      return;
    }
    const generation = this.adaptivePreviewGeneration;
    const targetSerial = this.adaptivePreviewLastPresentedSerial;
    this.adaptivePreviewRetirementFrame = requestAnimationFrame(() => {
      this.adaptivePreviewRetirementFrame = null;
      if (
        generation !== this.adaptivePreviewGeneration
        || !this.adaptivePreviewActive
        || this.adaptivePreviewFrozen
        || this.adaptivePreviewConfirmedSerial < targetSerial
        || this.hasAdaptivePreviewUnconfirmedCandidate()
      ) {
        return;
      }
      if (this.adaptivePreviewForceStroke && this.activeStroke) {
        this.clearAdaptivePreviewCanvas();
      } else {
        this.retireAdaptivePreview(true);
      }
    });
  }

  private freezeAdaptivePreviewAtLift(): void {
    if (!this.adaptivePreviewActive) {
      this.invalidateAdaptivePreview();
      return;
    }
    if (this.adaptivePreviewFrameRequest !== null) {
      cancelAnimationFrame(this.adaptivePreviewFrameRequest);
      this.adaptivePreviewFrameRequest = null;
    }
    if (this.adaptivePreviewRetirementFrame !== null) {
      cancelAnimationFrame(this.adaptivePreviewRetirementFrame);
      this.adaptivePreviewRetirementFrame = null;
    }

    const stroke = this.activeStroke;
    if (stroke) {
      const pendingTip: Stamp[] = [];
      let pendingCandidatesAdded = 0;
      const candidateLimit = ADAPTIVE_PREVIEW_MAX_TIP_BASE_STAMPS;
      for (
        let index = this.pendingStamps.length - 1;
        index >= 0 && pendingTip.length < candidateLimit;
        index -= 1
      ) {
        const stamp = this.pendingStamps[index];
        if (stamp.historyActionId === stroke.historyActionId) {
          pendingTip.unshift(stamp);
        }
      }
      for (const stamp of pendingTip) {
        if (!this.adaptivePreviewCandidates.some((candidate) => candidate.stamp === stamp)) {
          this.adaptivePreviewCandidates.push({
            serial: null,
            stamp,
            settings: this.settings,
            presented: false,
          });
          pendingCandidatesAdded += 1;
        }
      }
      this.adaptivePreviewCandidates = this.adaptivePreviewCandidates
        .slice(-candidateLimit);
      if (this.activeStrokeProfile) {
        this.activeStrokeProfile.adaptivePreviewLiftPendingBaseStamps += pendingCandidatesAdded;
      }
    }

    this.adaptivePreviewFrozen = true;
    this.drawAdaptivePreviewFrame();
    if (
      this.adaptivePreviewLastPresentedSerial <= 0
      && !this.hasAdaptivePreviewPresentedUnboundCandidate()
    ) {
      this.invalidateAdaptivePreview();
      return;
    }
    this.adaptivePreviewRetirementTargetSerial = this.adaptivePreviewLastPresentedSerial;
    if (this.activeStrokeProfile) {
      this.activeStrokeProfile.adaptivePreviewFrozenAtLift += 1;
    }
    if (this.hasAdaptivePreviewPresentedUnboundCandidate()) {
      return;
    }
    if (this.adaptivePreviewConfirmedSerial >= this.adaptivePreviewRetirementTargetSerial) {
      this.scheduleAdaptivePreviewRetirement();
      return;
    }
    this.startAdaptivePreviewProbe(true);
  }

  private requestAdaptivePreviewDraw(): void {
    if (
      !this.adaptivePreviewActive
      || this.adaptivePreviewFrozen
      || !this.adaptivePreviewContext
      || this.adaptivePreviewFrameRequest !== null
    ) {
      return;
    }
    const generation = this.adaptivePreviewGeneration;
    this.adaptivePreviewFrameRequest = requestAnimationFrame(() => {
      this.adaptivePreviewFrameRequest = null;
      if (
        generation !== this.adaptivePreviewGeneration
        || !this.adaptivePreviewActive
        || this.adaptivePreviewFrozen
      ) {
        return;
      }
      this.drawAdaptivePreviewFrame();
    });
  }

  private increaseAdaptiveSpacing(reason: AdaptiveSpacingTriggerReason): void {
    const stroke = this.activeStroke;
    if (!stroke || this.adaptivePreviewFrozen) {
      return;
    }

    const maximumSpacingPercent =
      stroke.adaptiveSpacingInitialPercent + this.adaptiveSpacingMaxExtraPercentPoints;
    const nextSpacingPercent = Math.min(
      maximumSpacingPercent,
      stroke.adaptiveSpacingPercent + ADAPTIVE_SPACING_STEP_PERCENT_POINTS,
    );
    if (nextSpacingPercent <= stroke.adaptiveSpacingPercent) {
      return;
    }

    stroke.adaptiveSpacingPercent = nextSpacingPercent;
    const profile = this.activeStrokeProfile;
    if (!profile) {
      return;
    }

    profile.adaptiveSpacingFinalPercent = nextSpacingPercent;
    profile.adaptiveSpacingEvents.push({
      offsetMs: Math.max(0, performance.now() - profile.startedAt),
      reason,
      spacingPercent: nextSpacingPercent,
      extraPercentPoints: nextSpacingPercent - stroke.adaptiveSpacingInitialPercent,
      backlogBaseStamps: Math.max(
        0,
        this.adaptivePreviewSubmittedSerial - this.adaptivePreviewConfirmedSerial,
      ),
      generatedBaseStamps: profile.baseStamps,
    });
  }

  private startAdaptivePreviewProbe(force: boolean): void {
    if (
      !this.adaptivePreviewContext
      || this.adaptivePreviewProbe
      || this.adaptivePreviewSubmittedSerial <= this.adaptivePreviewConfirmedSerial
      || (!this.activeStroke && !this.adaptivePreviewFrozen)
      || (!force && this.adaptivePreviewSubmissionsSinceProbe < ADAPTIVE_PREVIEW_PROBE_INTERVAL_SUBMISSIONS)
    ) {
      return;
    }

    const startedAt = performance.now();
    const telemetryProfile = this.activeStrokeProfile;
    const backlogBaseStamps = Math.max(
      0,
      this.adaptivePreviewSubmittedSerial - this.adaptivePreviewConfirmedSerial,
    );
    const probe: AdaptivePreviewProbe = {
      generation: this.adaptivePreviewGeneration,
      startedAt,
      prefixSerial: this.adaptivePreviewSubmittedSerial,
      timeout: 0,
      spacingIncreaseApplied: false,
      telemetryProfile,
    };
    if (telemetryProfile) {
      telemetryProfile.adaptivePreviewProbeStarts += 1;
      telemetryProfile.adaptivePreviewProbeBacklogBaseStamps.push(backlogBaseStamps);
    }
    this.adaptivePreviewSubmissionsSinceProbe = 0;
    probe.timeout = window.setTimeout(() => {
      const timedOutAt = performance.now();
      if (
        this.adaptivePreviewProbe !== probe
        || probe.generation !== this.adaptivePreviewGeneration
        || !this.activeStroke
        || this.adaptivePreviewFrozen
      ) {
        return;
      }
      if (probe.telemetryProfile) {
        probe.telemetryProfile.adaptivePreviewProbeTimeouts += 1;
        probe.telemetryProfile.adaptivePreviewProbeTimeoutLatenessMs.push(
          Math.max(
            0,
            timedOutAt - (probe.startedAt + ADAPTIVE_PREVIEW_TRIGGER_THRESHOLD_MS),
          ),
        );
      }
      probe.spacingIncreaseApplied = true;
      this.increaseAdaptiveSpacing("probe-timeout");
      this.activateAdaptivePreview("probe-timeout");
    }, ADAPTIVE_PREVIEW_TRIGGER_THRESHOLD_MS);
    this.adaptivePreviewProbe = probe;

    void this.device.queue.onSubmittedWorkDone().then(() => {
      if (this.adaptivePreviewProbe !== probe || probe.generation !== this.adaptivePreviewGeneration) {
        return;
      }
      window.clearTimeout(probe.timeout);
      this.adaptivePreviewProbe = null;
      const completedAt = performance.now();
      const latency = completedAt - probe.startedAt;
      if (
        latency >= ADAPTIVE_PREVIEW_SLOW_COMPLETION_THRESHOLD_MS
        && !probe.spacingIncreaseApplied
      ) {
        probe.spacingIncreaseApplied = true;
        this.increaseAdaptiveSpacing("slow-completion");
      }
      this.adaptivePreviewConfirmedSerial = Math.max(
        this.adaptivePreviewConfirmedSerial,
        probe.prefixSerial,
      );
      const profile = probe.telemetryProfile;
      if (profile) {
        profile.adaptivePreviewProbeLatencyMs.push(latency);
        if (latency >= ADAPTIVE_PREVIEW_SLOW_COMPLETION_THRESHOLD_MS) {
          profile.adaptivePreviewProbeResolvedSlow += 1;
        } else {
          profile.adaptivePreviewProbeResolvedFast += 1;
        }
        if (
          latency >= ADAPTIVE_PREVIEW_PROBE_NEAR_MISS_MINIMUM_MS
          && latency < ADAPTIVE_PREVIEW_TRIGGER_THRESHOLD_MS
        ) {
          profile.adaptivePreviewProbeNearMisses += 1;
        }
        profile.adaptivePreviewMaxQueueProbeLatencyMs = Math.max(
          profile.adaptivePreviewMaxQueueProbeLatencyMs,
          latency,
        );
      }

      this.adaptivePreviewCandidates = this.adaptivePreviewCandidates.filter(
        (candidate) => candidate.serial === null
          || candidate.serial > this.adaptivePreviewConfirmedSerial,
      );

      if (this.adaptivePreviewFrozen) {
        if (this.hasAdaptivePreviewPresentedUnboundCandidate()) {
          return;
        }
        if (this.adaptivePreviewConfirmedSerial >= this.adaptivePreviewRetirementTargetSerial) {
          this.scheduleAdaptivePreviewRetirement();
        } else {
          this.startAdaptivePreviewProbe(true);
        }
        return;
      }

      if (latency >= ADAPTIVE_PREVIEW_SLOW_COMPLETION_THRESHOLD_MS) {
        this.adaptivePreviewConsecutiveSlowProbes += 1;
      } else {
        this.adaptivePreviewConsecutiveSlowProbes = 0;
      }
      if (
        !this.adaptivePreviewActive
        && this.activeStroke
        && this.adaptivePreviewConsecutiveSlowProbes >= ADAPTIVE_PREVIEW_TRIGGER_CONSECUTIVE_PROBES
      ) {
        this.activateAdaptivePreview("consecutive-slow");
      }

      if (this.adaptivePreviewActive) {
        if (this.adaptivePreviewCandidates.length > 0) {
          this.requestAdaptivePreviewDraw();
        } else {
          this.scheduleAdaptivePreviewCatchUpClear();
          return;
        }
      }

      if (this.activeStroke && this.adaptivePreviewSubmittedSerial > this.adaptivePreviewConfirmedSerial) {
        this.startAdaptivePreviewProbe(
          this.adaptivePreviewActive
          || this.adaptivePreviewSubmissionsSinceProbe >= ADAPTIVE_PREVIEW_PROBE_INTERVAL_SUBMISSIONS,
        );
      }
    }).catch(() => {
      if (probe.telemetryProfile) {
        probe.telemetryProfile.adaptivePreviewProbeRejections += 1;
      }
      if (this.adaptivePreviewProbe === probe) {
        window.clearTimeout(probe.timeout);
        this.adaptivePreviewProbe = null;
      }
      if (probe.generation === this.adaptivePreviewGeneration) {
        this.invalidateAdaptivePreview();
      }
    });
  }

  private trackAdaptivePreviewExactSubmission(
    batch: readonly Stamp[],
    settings: BrushSettings,
  ): void {
    const profile = this.activeStrokeProfile;
    if (profile) {
      profile.adaptivePreviewExactBaseStampsSubmitted += batch.length;
      profile.adaptivePreviewExactBatchesSubmitted += 1;
    }

    const startSerial = this.adaptivePreviewSubmittedSerial;
    this.adaptivePreviewSubmittedSerial += batch.length;
    this.adaptivePreviewSubmissionsSinceProbe += 1;
    if (profile) {
      profile.adaptivePreviewMaxUnconfirmedBaseStamps = Math.max(
        profile.adaptivePreviewMaxUnconfirmedBaseStamps,
        this.adaptivePreviewSubmittedSerial - this.adaptivePreviewConfirmedSerial,
      );
    }

    for (const candidate of this.adaptivePreviewCandidates) {
      if (candidate.serial !== null) {
        continue;
      }
      const index = batch.indexOf(candidate.stamp);
      if (index < 0) {
        continue;
      }
      candidate.serial = startSerial + index + 1;
      if (profile) {
        profile.adaptivePreviewLiftPendingSerialBindings += 1;
      }
      if (candidate.presented) {
        this.adaptivePreviewLastPresentedSerial = Math.max(
          this.adaptivePreviewLastPresentedSerial,
          candidate.serial,
        );
        this.adaptivePreviewRetirementTargetSerial = Math.max(
          this.adaptivePreviewRetirementTargetSerial,
          candidate.serial,
        );
      }
    }

    if (this.adaptivePreviewFrozen || !this.activeStroke) {
      if (this.adaptivePreviewFrozen) {
        if (this.hasAdaptivePreviewPresentedUnboundCandidate()) {
          return;
        }
        if (
          this.adaptivePreviewRetirementTargetSerial > 0
          && this.adaptivePreviewConfirmedSerial >= this.adaptivePreviewRetirementTargetSerial
        ) {
          this.scheduleAdaptivePreviewRetirement();
        } else {
          this.startAdaptivePreviewProbe(true);
        }
      }
      return;
    }
    if (this.isTexturizedGrainActive(settings)) {
      if (profile) {
        profile.grainAdaptivePreviewSkips += 1;
      }
      this.adaptivePreviewCandidates.length = 0;
      this.clearAdaptivePreviewCanvas();
      // A smooth Canvas2D tip would misrepresent the authoritative
      // layer-anchored grain. Queue probes remain active so the promoted
      // adaptive-spacing policy still reacts to GPU latency.
      this.startAdaptivePreviewProbe(false);
      return;
    }
    if (settings.blendMode !== "normal") {
      if (profile) {
        profile.adaptivePreviewUnsupportedBlendSkips += 1;
      }
      this.adaptivePreviewCandidates.length = 0;
      this.clearAdaptivePreviewCanvas();
      // Light Glaze cannot use a two-stamp Canvas2D patch without violating
      // its stroke-wide opacity cap. Keep the queue probe alive solely for the
      // promoted adaptive-spacing policy; no transient bitmap is produced.
      if (isStrokeGlazeBlendMode(settings.blendMode)) {
        this.startAdaptivePreviewProbe(false);
      }
      return;
    }

    const candidateLimit = ADAPTIVE_PREVIEW_MAX_TIP_BASE_STAMPS;
    const firstCandidate = Math.max(0, batch.length - candidateLimit);
    for (let index = firstCandidate; index < batch.length; index += 1) {
      if (!this.adaptivePreviewCandidates.some((candidate) => candidate.stamp === batch[index])) {
        this.adaptivePreviewCandidates.push({
          serial: startSerial + index + 1,
          stamp: batch[index],
          settings,
          presented: false,
        });
      }
    }
    this.adaptivePreviewCandidates = this.adaptivePreviewCandidates
      .filter((candidate) => candidate.serial === null
        || candidate.serial > this.adaptivePreviewConfirmedSerial)
      .slice(-candidateLimit);

    if (this.adaptivePreviewForceStroke) {
      this.activateAdaptivePreview("diagnostic-force");
    }
    if (this.adaptivePreviewActive) {
      this.requestAdaptivePreviewDraw();
    }
    this.startAdaptivePreviewProbe(this.adaptivePreviewActive);
  }

  private recordAdaptivePreviewJsFrame(startedAt: number, budgetAlreadyCounted: boolean): void {
    const duration = performance.now() - startedAt;
    const profile = this.activeStrokeProfile;
    if (!profile) {
      return;
    }
    profile.adaptivePreviewJsTotalMs += duration;
    profile.adaptivePreviewJsFrameMs.push(duration);
    if (!budgetAlreadyCounted && duration > ADAPTIVE_PREVIEW_JS_BUDGET_MS) {
      profile.adaptivePreviewBudgetSkips += 1;
    }
  }

  private drawAdaptivePreviewFrame(): void {
    const startedAt = performance.now();
    const canvas = this.adaptivePreviewCanvas;
    const visibleContext = this.adaptivePreviewContext;
    const scratchCanvas = this.adaptivePreviewScratchCanvas;
    const context = this.adaptivePreviewScratchContext;
    const candidates = this.adaptivePreviewCandidatesForFrame();
    if (!canvas || !visibleContext || !scratchCanvas || !context || candidates.length === 0) {
      this.finishIncompleteAdaptivePreviewFrame(startedAt, false, candidates, false);
      return;
    }

    const settings = candidates[candidates.length - 1].settings;
    if (this.isTexturizedGrainActive(settings)) {
      if (this.activeStrokeProfile) {
        this.activeStrokeProfile.grainAdaptivePreviewSkips += 1;
      }
      this.finishIncompleteAdaptivePreviewFrame(startedAt, false, candidates, false);
      return;
    }
    if (settings.blendMode !== "normal") {
      if (this.activeStrokeProfile) {
        this.activeStrokeProfile.adaptivePreviewUnsupportedBlendSkips += 1;
      }
      this.finishIncompleteAdaptivePreviewFrame(startedAt, false, candidates, false);
      return;
    }
    if (settings.shape === "shape") {
      this.prepareAdaptivePreviewShapePalette(settings);
      if (this.adaptivePreviewShapePalette.length === 0) {
        this.finishIncompleteAdaptivePreviewFrame(startedAt, false, candidates, false);
        return;
      }
    }

    const cssWidth = this.canvasCssWidth;
    const cssHeight = this.canvasCssHeight;
    const canvasWidth = Math.max(1, this.canvas.width);
    const canvasHeight = Math.max(1, this.canvas.height);
    const layerToCssX = this.zoom * cssWidth / canvasWidth;
    const layerToCssY = this.zoom * cssHeight / canvasHeight;
    const radiusScale = (Math.abs(layerToCssX) + Math.abs(layerToCssY)) * 0.5;
    if (
      cssWidth <= 0
      || cssHeight <= 0
      || !Number.isFinite(radiusScale)
      || radiusScale <= 0
    ) {
      this.finishIncompleteAdaptivePreviewFrame(startedAt, false, candidates, false);
      return;
    }

    const copies: AdaptivePreviewCopy[] = [];
    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
      const candidate = candidates[candidateIndex];
      const candidateSettings = candidate.settings;
      if (
        candidateSettings.shape !== settings.shape
        || candidateSettings.blendMode !== settings.blendMode
      ) {
        continue;
      }
      const stamp = candidate.stamp;
      const stampX = Math.fround(stamp.x);
      const stampY = Math.fround(stamp.y);
      const radius = Math.fround(stamp.radius);
      if (radius <= 0) {
        continue;
      }
      const directionXRaw = Math.fround(stamp.directionX);
      const directionYRaw = Math.fround(stamp.directionY);
      const directionLength = Math.hypot(directionXRaw, directionYRaw);
      const directionX = directionLength > 0.0001 ? directionXRaw / directionLength : 1;
      const directionY = directionLength > 0.0001 ? directionYRaw / directionLength : 0;
      const baseHsl = hexToHsl(candidateSettings.color);
      const alpha = clamp(
        candidateSettings.flow
          * candidateSettings.opacity
          * candidateSettings.blendIntensity,
        0,
        0.999999,
      ) * ADAPTIVE_PREVIEW_ALPHA_SCALE;
      const count = clamp(Math.round(candidateSettings.count), 1, 24);

      for (let copyIndex = 0; copyIndex < count; copyIndex += 1) {
        const copySeed = previewHash32(
          (stamp.seed ^ Math.imul(copyIndex, 0x85ebca6b)) >>> 0,
        );
        const linearOffset = (previewRandom01(copySeed, 5) - 0.5)
          * 4
          * radius
          * Math.fround(candidateSettings.positionJitterLinear);
        const lateralOffset = (previewRandom01(copySeed, 6) - 0.5)
          * 4
          * radius
          * Math.fround(candidateSettings.positionJitterLateral);
        const centerX = stampX
          + directionX * linearOffset
          - directionY * lateralOffset;
        const centerY = stampY
          + directionY * linearOffset
          + directionX * lateralOffset;
        const rotation = candidateSettings.shape === "shape"
          ? (previewRandom01(copySeed, 7) - 0.5) * Math.PI * 2 * candidateSettings.shapeScatter
          : 0;
        const colorSeed = candidateSettings.jitterPerCopy
          ? copySeed
          : previewHash32(stamp.seed);
        const [red, green, blue] = this.adaptivePreviewRgb(
          colorSeed,
          candidateSettings,
          baseHsl,
        );
        const centerOffsetX = centerX - this.viewCenterX;
        const centerOffsetY = centerY - this.viewCenterY;
        copies.push({
          x: (this.viewRotationCos * centerOffsetX - this.viewRotationSin * centerOffsetY)
            * layerToCssX + cssWidth * 0.5,
          y: (this.viewRotationSin * centerOffsetX + this.viewRotationCos * centerOffsetY)
            * layerToCssY + cssHeight * 0.5,
          radius: Math.max(0.25, radius * radiusScale),
          rotation: rotation + this.viewRotation,
          alpha,
          candidateIndex,
          red,
          green,
          blue,
          color: `rgb(${red} ${green} ${blue})`,
        });
      }
    }

    if (copies.length === 0) {
      this.finishIncompleteAdaptivePreviewFrame(startedAt, false, candidates, false);
      return;
    }
    if (performance.now() - startedAt > ADAPTIVE_PREVIEW_JS_BUDGET_MS) {
      if (this.activeStrokeProfile) {
        this.activeStrokeProfile.adaptivePreviewBudgetSkips += 1;
      }
      this.finishIncompleteAdaptivePreviewFrame(startedAt, true, candidates, true);
      return;
    }

    let minimumX = Number.POSITIVE_INFINITY;
    let minimumY = Number.POSITIVE_INFINITY;
    let maximumX = Number.NEGATIVE_INFINITY;
    let maximumY = Number.NEGATIVE_INFINITY;
    for (const copy of copies) {
      const shapeExtent = settings.shape === "shape"
        ? copy.radius * (Math.abs(Math.cos(copy.rotation)) + Math.abs(Math.sin(copy.rotation)))
        : copy.radius;
      minimumX = Math.min(minimumX, copy.x - shapeExtent);
      minimumY = Math.min(minimumY, copy.y - shapeExtent);
      maximumX = Math.max(maximumX, copy.x + shapeExtent);
      maximumY = Math.max(maximumY, copy.y + shapeExtent);
    }
    const visibleLeft = Math.max(0, minimumX - ADAPTIVE_PREVIEW_PATCH_MARGIN_CSS_PIXELS);
    const visibleTop = Math.max(0, minimumY - ADAPTIVE_PREVIEW_PATCH_MARGIN_CSS_PIXELS);
    const visibleRight = Math.min(cssWidth, maximumX + ADAPTIVE_PREVIEW_PATCH_MARGIN_CSS_PIXELS);
    const visibleBottom = Math.min(cssHeight, maximumY + ADAPTIVE_PREVIEW_PATCH_MARGIN_CSS_PIXELS);
    const requiredWidth = Math.max(0, visibleRight - visibleLeft);
    const requiredHeight = Math.max(0, visibleBottom - visibleTop);
    if (requiredWidth <= 0 || requiredHeight <= 0) {
      this.finishIncompleteAdaptivePreviewFrame(startedAt, false, candidates, false);
      return;
    }
    if (
      requiredWidth > ADAPTIVE_PREVIEW_MAX_PATCH_CSS_PIXELS
      || requiredHeight > ADAPTIVE_PREVIEW_MAX_PATCH_CSS_PIXELS
    ) {
      const profile = this.activeStrokeProfile;
      if (profile) {
        profile.adaptivePreviewOversizedSkips += 1;
      }
      this.finishIncompleteAdaptivePreviewFrame(startedAt, false, candidates, false);
      return;
    }

    const quantizePatch = (value: number, maximum: number): number => Math.min(
      maximum,
      Math.max(
        ADAPTIVE_PREVIEW_MIN_PATCH_CSS_PIXELS,
        Math.ceil(value / ADAPTIVE_PREVIEW_PATCH_QUANTUM_CSS_PIXELS)
          * ADAPTIVE_PREVIEW_PATCH_QUANTUM_CSS_PIXELS,
      ),
    );
    const patchCssWidth = quantizePatch(requiredWidth, Math.min(
      ADAPTIVE_PREVIEW_MAX_PATCH_CSS_PIXELS,
      Math.ceil(cssWidth),
    ));
    const patchCssHeight = quantizePatch(requiredHeight, Math.min(
      ADAPTIVE_PREVIEW_MAX_PATCH_CSS_PIXELS,
      Math.ceil(cssHeight),
    ));
    const patchLeft = clamp(
      Math.floor((visibleLeft + visibleRight - patchCssWidth) * 0.5),
      0,
      Math.max(0, Math.ceil(cssWidth) - patchCssWidth),
    );
    const patchTop = clamp(
      Math.floor((visibleTop + visibleBottom - patchCssHeight) * 0.5),
      0,
      Math.max(0, Math.ceil(cssHeight) - patchCssHeight),
    );
    const previewBackingScaleX = canvasWidth / cssWidth * ADAPTIVE_PREVIEW_EXACT_LINEAR_SCALE;
    const previewBackingScaleY = canvasHeight / cssHeight * ADAPTIVE_PREVIEW_EXACT_LINEAR_SCALE;
    const backingWidth = Math.max(1, Math.ceil(patchCssWidth * previewBackingScaleX));
    const backingHeight = Math.max(1, Math.ceil(patchCssHeight * previewBackingScaleY));
    if (scratchCanvas.width !== backingWidth || scratchCanvas.height !== backingHeight) {
      scratchCanvas.width = backingWidth;
      scratchCanvas.height = backingHeight;
    }

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalCompositeOperation = "source-over";
    context.globalAlpha = 1;
    context.clearRect(0, 0, backingWidth, backingHeight);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "low";
    const backingScaleX = backingWidth / patchCssWidth;
    const backingScaleY = backingHeight / patchCssHeight;
    const drawnCandidateIndexes = new Set<number>();
    let physicalCopiesDrawn = 0;
    let budgetExceeded = false;
    let complete = true;
    const drawDeadlineMs = Math.max(
      0,
      ADAPTIVE_PREVIEW_JS_BUDGET_MS - ADAPTIVE_PREVIEW_COMMIT_BUDGET_RESERVE_MS,
    );

    for (const copy of copies) {
      if (performance.now() - startedAt > drawDeadlineMs) {
        budgetExceeded = true;
        complete = false;
        break;
      }
      const x = (copy.x - patchLeft) * backingScaleX;
      const y = (copy.y - patchTop) * backingScaleY;
      const radiusX = copy.radius * backingScaleX;
      const radiusY = copy.radius * backingScaleY;
      context.globalAlpha = copy.alpha;
      if (settings.shape === "shape") {
        const sprite = this.nearestAdaptivePreviewShapeSprite(copy);
        if (!sprite) {
          complete = false;
          break;
        }
        context.save();
        context.translate(x, y);
        context.rotate(copy.rotation);
        context.drawImage(sprite, -radiusX, -radiusY, radiusX * 2, radiusY * 2);
        context.restore();
      } else {
        context.beginPath();
        context.ellipse(x, y, radiusX, radiusY, 0, 0, Math.PI * 2);
        context.fillStyle = copy.color;
        if (settings.hardness >= 0.995) {
          context.fill();
        } else {
          const gradient = context.createRadialGradient(x, y, 0, x, y, Math.max(radiusX, radiusY));
          const innerStop = clamp(settings.hardness, 0, 0.999);
          gradient.addColorStop(0, copy.color);
          gradient.addColorStop(innerStop, copy.color);
          gradient.addColorStop(1, `rgb(${copy.red} ${copy.green} ${copy.blue} / 0)`);
          context.fillStyle = gradient;
          context.fill();
        }
      }
      drawnCandidateIndexes.add(copy.candidateIndex);
      physicalCopiesDrawn += 1;
    }
    context.globalAlpha = 1;

    if (
      !complete
      || budgetExceeded
      || physicalCopiesDrawn !== copies.length
      || performance.now() - startedAt > drawDeadlineMs
    ) {
      if (this.activeStrokeProfile) {
        this.activeStrokeProfile.adaptivePreviewBudgetSkips += 1;
      }
      this.finishIncompleteAdaptivePreviewFrame(startedAt, true, candidates, true);
      return;
    }

    if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
      canvas.width = backingWidth;
      canvas.height = backingHeight;
    }
    if (
      this.adaptivePreviewCssWidth !== patchCssWidth
      || this.adaptivePreviewCssHeight !== patchCssHeight
    ) {
      canvas.style.width = `${patchCssWidth}px`;
      canvas.style.height = `${patchCssHeight}px`;
      this.adaptivePreviewCssWidth = patchCssWidth;
      this.adaptivePreviewCssHeight = patchCssHeight;
    }
    canvas.style.left = `${patchLeft}px`;
    canvas.style.top = `${patchTop}px`;
    visibleContext.setTransform(1, 0, 0, 1, 0, 0);
    visibleContext.globalCompositeOperation = "copy";
    visibleContext.globalAlpha = 1;
    visibleContext.drawImage(scratchCanvas, 0, 0);
    visibleContext.globalCompositeOperation = "source-over";

    for (const candidate of this.adaptivePreviewCandidates) {
      candidate.presented = false;
    }

    let representedSerial = 0;
    for (const candidateIndex of drawnCandidateIndexes) {
      const candidate = candidates[candidateIndex];
      candidate.presented = true;
      if (candidate.serial !== null) {
        representedSerial = Math.max(representedSerial, candidate.serial);
      }
    }
    this.adaptivePreviewLastPresentedSerial = representedSerial;
    canvas.style.opacity = "1";
    const profile = this.activeStrokeProfile;
    if (profile) {
      profile.adaptivePreviewFrames += 1;
      profile.adaptivePreviewBaseStampsDrawn += drawnCandidateIndexes.size;
      profile.adaptivePreviewPhysicalCopiesDrawn += physicalCopiesDrawn;
      profile.adaptivePreviewPatchPixels += backingWidth * backingHeight;
      profile.adaptivePreviewMaxPatchBackingPixels = Math.max(
        profile.adaptivePreviewMaxPatchBackingPixels,
        backingWidth * backingHeight,
      );
    }
    this.recordAdaptivePreviewJsFrame(startedAt, false);
  }

  private submitLightGlazeImmediate(
    stamps: readonly Stamp[],
    clearLayer: boolean,
    settings: BrushSettings,
    present: boolean,
    replayBatch: PaintHistoryRenderBatch | null,
  ): SubmitTiming {
    if (this.thicknessTailPresentedRect) {
      this.thicknessTailPresentedRect = null;
      this.presentationCacheNeedsFullRebuild = true;
    }
    const session = this.lightGlazeSession;
    if (!session || !isStrokeGlazeBlendMode(session.settings.blendMode)) {
      throw new Error("Sessione Light Glaze mancante durante il rendering.");
    }
    if (replayBatch && replayBatch.shapeMaskIdentity !== this.shapeMaskIdentity) {
      throw new Error("La Shape usata dalla cronologia non corrisponde alla risorsa corrente.");
    }
    const expectedGrainIdentity = this.isTexturizedGrainActive(settings)
      ? this.grainTextureIdentity
      : null;
    if (replayBatch && replayBatch.grainTextureIdentity !== expectedGrainIdentity) {
      throw new Error("Il Grain usato dalla cronologia non corrisponde alla risorsa corrente.");
    }
    this.ensureLightGlazeResources(settings.blendMode);
    const grainActive = this.isTexturizedGrainActive(settings);
    const m1Glaze = settings.blendMode === "m1-glaze";

    const cpuStart = performance.now();
    if (present) {
      this.ensurePresentationCacheTexture();
    }
    // Flow, coverage and jitter remain per stamp. Opacity is applied
    // exactly once to the accumulated stroke by the live/final compositors.
    this.writeBrushUniforms({ ...settings, opacity: 1, blendMode: "normal" });
    if (grainActive) {
      this.writeGrainUniforms(settings);
    }
    if (m1Glaze && session.tintLinear === null && stamps.length > 0) {
      const [red, green, blue] = this.adaptivePreviewRgb(
        previewHash32(stamps[0].seed),
        settings,
      );
      session.tintLinear = [
        srgbByteToLinear(red),
        srgbByteToLinear(green),
        srgbByteToLinear(blue),
      ];
    }
    this.writeLightGlazeUniforms(
      settings.opacity,
      m1Glaze ? "m1-max-coverage" : "source-over",
      session.tintLinear,
    );

    const encoder = this.device.createCommandEncoder({ label: "Light Glaze frame encoder" });
    let stampPackingMs = 0;
    let instanceUploadMs = 0;
    let brushEncodingMs = 0;
    let displayEncodingMs = 0;
    let commandSubmitMs = 0;
    let scissorPixels = 0;
    let submittedDirtyRect: DirtyRect | null = null;
    let submittedShapeOccupancySelection: ShapeOccupancySelection | null = null;
    let presentationCacheFullRebuilds = 0;
    let presentationCachePartialUpdates = 0;
    let presentationCacheOffscreenSkips = 0;
    let presentationCacheLod0FullRebuildTraceEnabledPasses = 0;
    let presentationCacheLod0FullRebuildTraceEnabledCpuEncodingMs = 0;
    let presentationCacheLod0FullRebuildTraceDisabledPasses = 0;
    let presentationCacheLod0FullRebuildTraceDisabledCpuEncodingMs = 0;
    let presentationCacheUpdatedPixels = 0;
    let legacyDisplayShaderPixels = 0;
    let presentationCopiedPixels = 0;
    let presentationCacheWasUpdated = false;
    let displaySelectedMipLevel = this.paintDisplaySelectedMipLevel;
    let paintDisplayPyramidMaintenanceFrames = 0;
    let paintDisplayPyramidFullLevelBuilds = 0;
    let paintDisplayPyramidDirtyLevelUpdates = 0;
    let paintDisplayPyramidPasses = 0;
    let paintDisplayPyramidBaseDirtyPixels = 0;
    let paintDisplayPyramidUpdatedPixels = 0;
    let paintDisplayPyramidEncodingMs = 0;
    let lightGlazeBatches = 0;
    let lightGlazeCommits = 0;
    let lightGlazeCompositePixels = 0;
    let lightGlazePyramidPasses = 0;
    let lightGlazePyramidUpdatedPixels = 0;
    let grainBatches = 0;
    let grainBaseStamps = 0;
    let grainPhysicalCopies = 0;
    let grainCircleBatches = 0;
    let grainShapeBatches = 0;

    const brushEncodingStart = performance.now();
    if (clearLayer) {
      const clearPass = encoder.beginRenderPass({
        label: "Clear permanent layer before Light Glaze",
        colorAttachments: [
          {
            view: this.layerView,
            loadOp: "clear",
            storeOp: "store",
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          },
        ],
      });
      clearPass.end();
      this.paintDisplayMipValidThroughLevel = 0;
      this.noteLayerMutation(null, true);
    }

    if (stamps.length > 0) {
      const packingStart = performance.now();
      const packedDirtyRect = this.packStamps(stamps, settings);
      submittedDirtyRect = replayBatch ? replayBatch.dirtyRect : packedDirtyRect;
      stampPackingMs = performance.now() - packingStart;
      const uploadStart = performance.now();
      this.device.queue.writeBuffer(
        this.instanceBuffer,
        0,
        this.instanceUpload,
        0,
        stamps.length * STAMP_STRIDE_BYTES,
      );
      if (settings.shape === "shape") {
        submittedShapeOccupancySelection = replayBatch
          ? replayBatch.shapeOccupancySelection
          : this.selectShapeOccupancy(this.packedMinimumRadius);
      }
      instanceUploadMs = performance.now() - uploadStart;

      const brushPass = encoder.beginRenderPass({
        label: "Accumulate Light Glaze stroke",
        colorAttachments: [
          {
            view: this.lightGlazeView!,
            loadOp: session.needsClear ? "clear" : "load",
            storeOp: "store",
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          },
        ],
      });
      if (submittedDirtyRect) {
        scissorPixels = submittedDirtyRect.width * submittedDirtyRect.height;
        const isShape = settings.shape === "shape";
        const shapeOccupancyMip = submittedShapeOccupancySelection?.selectedMipLevel ?? null;
        const useShapeOccupancy = isShape && shapeOccupancyMip !== null;
        const pipeline = m1Glaze
          ? grainActive
            ? isShape
              ? useShapeOccupancy
                ? this.grainM1GlazeShapeOccupancyPipeline
                : this.grainM1GlazeShapePipeline
              : this.grainM1GlazePipeline
            : isShape
              ? useShapeOccupancy
                ? this.m1GlazeShapeOccupancyPipeline
                : this.m1GlazeShapePipeline
              : this.m1GlazePipeline
          : grainActive
            ? isShape
              ? useShapeOccupancy
                ? this.grainShapeOccupancyNormalPipeline
                : this.grainShapeNormalPipeline
              : this.grainNormalPipeline
            : isShape
              ? useShapeOccupancy
                ? this.shapeOccupancyNormalPipeline
                : this.shapeNormalPipeline
              : this.normalPipeline;
        brushPass.setPipeline(pipeline);
        brushPass.setBindGroup(
          0,
          grainActive
            ? useShapeOccupancy
              ? this.grainBrushOccupancyBindGroups[
                this.grainCoordinateMode(settings)
              ][settings.grainFiltering][shapeOccupancyMip!]
              : this.grainBrushBindGroups[
                this.grainCoordinateMode(settings)
              ][settings.grainFiltering]
            : useShapeOccupancy
              ? this.brushOccupancyBindGroups[shapeOccupancyMip!]
              : this.brushBindGroup,
        );
        brushPass.setScissorRect(
          submittedDirtyRect.x,
          submittedDirtyRect.y,
          submittedDirtyRect.width,
          submittedDirtyRect.height,
        );
        if (isShape && submittedShapeOccupancySelection && !replayBatch) {
          this.recordShapeSampling(submittedShapeOccupancySelection);
        }
        brushPass.draw(STAMP_VERTICES_PER_COPY, stamps.length * settings.count, 0, 0);
        if (grainActive) {
          grainBatches = 1;
          grainBaseStamps = stamps.length;
          grainPhysicalCopies = stamps.length * settings.count;
          grainCircleBatches = isShape ? 0 : 1;
          grainShapeBatches = isShape ? 1 : 0;
        }
      }
      brushPass.end();
      session.needsClear = false;
      session.hasContent = session.hasContent || submittedDirtyRect !== null;
      session.dirtyRect = this.mergeDirtyRects(session.dirtyRect, submittedDirtyRect);
      lightGlazeBatches = 1;
    }
    brushEncodingMs += performance.now() - brushEncodingStart;

    if (!present && (clearLayer || stamps.length > 0 || session.commitRequested)) {
      this.presentationCacheNeedsFullRebuild = true;
      this.paintDisplayMipValidThroughLevel = 0;
      this.deferRasterStrokeMutation(clearLayer);
    }

    if (present) {
      const displayEncodingStart = performance.now();
      displaySelectedMipLevel = this.desiredPaintDisplayMipLevel();
      if (displaySelectedMipLevel !== this.paintDisplaySelectedMipLevel) {
        this.presentationCacheNeedsFullRebuild = true;
      }
      this.paintDisplaySelectedMipLevel = displaySelectedMipLevel;

      const canvasPixels = this.canvas.width * this.canvas.height;
      legacyDisplayShaderPixels = canvasPixels;
      presentationCopiedPixels = canvasPixels;

      // A finalizing frame is presented from the committed permanent layer
      // below. Intermediate frames use mip 0 for direct live composition and
      // mip 1+ from the temporary final-composite pyramid.
      if (!session.commitRequested) {
        const rasterStrokeActive = this.styleStackActive();
        const rasterStrokeUpdate = rasterStrokeActive
          ? this.encodeRasterStrokeUpdate(
            encoder,
            "light-glaze",
            submittedDirtyRect,
            this.mergeDirtyRects(this.layerContentBounds, session.dirtyRect),
            clearLayer,
          )
          : { dirtyRect: null, timing: null };
        if (rasterStrokeActive) {
          if (clearLayer || submittedDirtyRect) {
            this.paintDisplayMipValidThroughLevel = 0;
          }
          const rasterPyramidStart = performance.now();
          const rasterPyramid = this.encodeRasterStrokeDisplayPyramid(
            encoder,
            rasterStrokeUpdate.dirtyRect,
            displaySelectedMipLevel,
          );
          paintDisplayPyramidMaintenanceFrames += rasterPyramid.passes > 0 ? 1 : 0;
          paintDisplayPyramidPasses += rasterPyramid.passes;
          paintDisplayPyramidBaseDirtyPixels += rasterStrokeUpdate.dirtyRect
            ? rasterStrokeUpdate.dirtyRect.width * rasterStrokeUpdate.dirtyRect.height
            : 0;
          paintDisplayPyramidUpdatedPixels += rasterPyramid.updatedPixels;
          paintDisplayPyramidEncodingMs += performance.now() - rasterPyramidStart;
        } else if (session.hasContent) {
          const glazePyramid = this.encodeLightGlazeDisplayPyramid(
            encoder,
            session,
            submittedDirtyRect,
            displaySelectedMipLevel,
          );
          lightGlazePyramidPasses += glazePyramid.passes;
          lightGlazePyramidUpdatedPixels += glazePyramid.updatedPixels;
        } else {
          const mainPyramid = this.encodePaintDisplayPyramid(
            encoder,
            clearLayer ? { x: 0, y: 0, width: LAYER_SIZE, height: LAYER_SIZE } : null,
            displaySelectedMipLevel,
          );
          paintDisplayPyramidMaintenanceFrames += mainPyramid.maintenanceFrames;
          paintDisplayPyramidFullLevelBuilds += mainPyramid.fullLevelBuilds;
          paintDisplayPyramidDirtyLevelUpdates += mainPyramid.dirtyLevelUpdates;
          paintDisplayPyramidPasses += mainPyramid.passes;
          paintDisplayPyramidBaseDirtyPixels += mainPyramid.baseDirtyPixels;
          paintDisplayPyramidUpdatedPixels += mainPyramid.updatedPixels;
          paintDisplayPyramidEncodingMs += mainPyramid.encodingMs;
        }

        const requiresFullRebuild = this.presentationCacheNeedsFullRebuild || clearLayer;
        const presentationLayerDirtyRect = rasterStrokeActive
          ? rasterStrokeUpdate.dirtyRect
          : submittedDirtyRect;
        const presentationDirtyRect = requiresFullRebuild
          ? { x: 0, y: 0, width: this.canvas.width, height: this.canvas.height }
          : presentationLayerDirtyRect
            ? this.layerDirtyRectToPresentationRect(presentationLayerDirtyRect, displaySelectedMipLevel)
            : null;

        if (presentationDirtyRect) {
          this.encodeMergedDisplayPyramids(encoder, displaySelectedMipLevel);
          this.writeDisplayUniforms(displaySelectedMipLevel);
          if (rasterStrokeActive) {
            this.rasterStrokeRenderer!.updateDisplayParameters(
              "light-glaze",
              this.rasterStrokeStyle,
              this.rasterBevelStyle,
            );
          }
          const lod0FullRebuildCpuEncodingStart = requiresFullRebuild
            && displaySelectedMipLevel === 0 ? performance.now() : 0;
          if (this.mixedSceneStack?.textCount) {
            const activePresentation: MixedSceneActivePresentation = rasterStrokeActive
              ? { kind: "raster-stroke", sourceMode: "light-glaze" }
              : session.hasContent
                ? { kind: "light-glaze" }
                : { kind: "base" };
            this.encodeMixedSceneSegmentedPresentation(
              encoder,
              presentationDirtyRect,
              requiresFullRebuild,
              activePresentation,
              requiresFullRebuild
                ? "Rebuild segmented presentation cache with live Light Glaze"
                : "Update segmented presentation cache with live Light Glaze",
            );
          } else {
            const displayPass = encoder.beginRenderPass({
              label: requiresFullRebuild
                ? "Rebuild presentation cache with live Light Glaze"
                : "Update presentation cache with live Light Glaze",
              colorAttachments: [
                {
                  view: this.presentationCacheView!,
                  loadOp: requiresFullRebuild ? "clear" : "load",
                  storeOp: "store",
                  clearValue: { r: 0.02, g: 0.02, b: 0.025, a: 1 },
                },
              ],
            });
            displayPass.setPipeline(
              rasterStrokeActive
                ? this.rasterStrokeDisplayPipeline
                : session.hasContent
                  ? this.lightGlazeDisplayPipeline
                  : this.vectorTextDisplayPipeline && this.vectorTextDisplayBindGroup
                    ? this.vectorTextDisplayPipeline
                    : this.displayPipeline,
            );
            if (rasterStrokeActive) {
              displayPass.setBindGroup(0, this.rasterStrokeDisplayScreenBindGroup);
              displayPass.setBindGroup(
                1,
                this.rasterStrokeDisplayBindGroups.get("light-glaze")!,
              );
            } else {
              displayPass.setBindGroup(
                0,
                session.hasContent
                  ? this.lightGlazeDisplayBindGroup!
                  : this.vectorTextDisplayBindGroup ?? this.displayBindGroup,
              );
            }
            if (!requiresFullRebuild) {
              displayPass.setScissorRect(
                presentationDirtyRect.x,
                presentationDirtyRect.y,
                presentationDirtyRect.width,
                presentationDirtyRect.height,
              );
            }
            displayPass.draw(3, 1, 0, 0);
            displayPass.end();
          }
          presentationCacheWasUpdated = true;
          if (lod0FullRebuildCpuEncodingStart > 0) {
            const elapsed = performance.now() - lod0FullRebuildCpuEncodingStart;
            if (rasterStrokeActive) {
              presentationCacheLod0FullRebuildTraceEnabledPasses += 1;
              presentationCacheLod0FullRebuildTraceEnabledCpuEncodingMs += elapsed;
            } else {
              presentationCacheLod0FullRebuildTraceDisabledPasses += 1;
              presentationCacheLod0FullRebuildTraceDisabledCpuEncodingMs += elapsed;
            }
          }
          presentationCacheUpdatedPixels = presentationDirtyRect.width * presentationDirtyRect.height;
          if (requiresFullRebuild) {
            presentationCacheFullRebuilds = 1;
          } else {
            presentationCachePartialUpdates = 1;
          }
        } else if (presentationLayerDirtyRect) {
          presentationCacheOffscreenSkips = 1;
        }
      }
      displayEncodingMs += performance.now() - displayEncodingStart;
    }

    if (session.commitRequested) {
      if (session.hasContent && session.dirtyRect) {
        const compositeStart = performance.now();
        const compositePass = encoder.beginRenderPass({
          label: "Commit complete Light Glaze stroke once",
          colorAttachments: [
            {
              view: this.layerView,
              loadOp: "load",
              storeOp: "store",
            },
          ],
        });
        compositePass.setPipeline(this.lightGlazeCompositePipeline);
        compositePass.setBindGroup(0, this.lightGlazeCompositeBindGroup!);
        compositePass.setScissorRect(
          session.dirtyRect.x,
          session.dirtyRect.y,
          session.dirtyRect.width,
          session.dirtyRect.height,
        );
        compositePass.draw(3, 1, 0, 0);
        compositePass.end();
        brushEncodingMs += performance.now() - compositeStart;
        lightGlazeCommits = 1;
        lightGlazeCompositePixels = session.dirtyRect.width * session.dirtyRect.height;
      }
      this.noteLayerMutation(session.dirtyRect, false);

      if (present) {
        const canonicalDisplayStart = performance.now();
        const rasterStrokeActive = this.styleStackActive();
        const rasterStrokeUpdate = rasterStrokeActive
          ? this.encodeRasterStrokeUpdate(
            encoder,
            "permanent",
            session.dirtyRect,
            this.layerContentBounds,
            clearLayer,
          )
          : { dirtyRect: null, timing: null };
        const canonicalLayerDirtyRect = clearLayer
          ? { x: 0, y: 0, width: LAYER_SIZE, height: LAYER_SIZE }
          : session.dirtyRect;
        if (rasterStrokeActive) {
          this.paintDisplayMipValidThroughLevel = 0;
          const rasterPyramidStart = performance.now();
          const rasterPyramid = this.encodeRasterStrokeDisplayPyramid(
            encoder,
            rasterStrokeUpdate.dirtyRect,
            displaySelectedMipLevel,
          );
          paintDisplayPyramidMaintenanceFrames += rasterPyramid.passes > 0 ? 1 : 0;
          paintDisplayPyramidPasses += rasterPyramid.passes;
          paintDisplayPyramidBaseDirtyPixels += rasterStrokeUpdate.dirtyRect
            ? rasterStrokeUpdate.dirtyRect.width * rasterStrokeUpdate.dirtyRect.height
            : 0;
          paintDisplayPyramidUpdatedPixels += rasterPyramid.updatedPixels;
          paintDisplayPyramidEncodingMs += performance.now() - rasterPyramidStart;
        } else {
          const mainPyramid = this.encodePaintDisplayPyramid(
            encoder,
            canonicalLayerDirtyRect,
            displaySelectedMipLevel,
          );
          paintDisplayPyramidMaintenanceFrames += mainPyramid.maintenanceFrames;
          paintDisplayPyramidFullLevelBuilds += mainPyramid.fullLevelBuilds;
          paintDisplayPyramidDirtyLevelUpdates += mainPyramid.dirtyLevelUpdates;
          paintDisplayPyramidPasses += mainPyramid.passes;
          paintDisplayPyramidBaseDirtyPixels += mainPyramid.baseDirtyPixels;
          paintDisplayPyramidUpdatedPixels += mainPyramid.updatedPixels;
          paintDisplayPyramidEncodingMs += mainPyramid.encodingMs;
        }

        // Replace every live-composite cache pixel touched by this stroke with
        // the canonical permanent-layer result. Subsequent partial updates can
        // therefore never mix live and committed mip semantics.
        const requiresFullRebuild = this.presentationCacheNeedsFullRebuild || clearLayer;
        const presentationLayerDirtyRect = rasterStrokeActive
          ? rasterStrokeUpdate.dirtyRect
          : session.dirtyRect;
        const presentationDirtyRect = requiresFullRebuild
          ? { x: 0, y: 0, width: this.canvas.width, height: this.canvas.height }
          : presentationLayerDirtyRect
            ? this.layerDirtyRectToPresentationRect(presentationLayerDirtyRect, displaySelectedMipLevel)
            : null;
        if (presentationDirtyRect) {
          this.encodeMergedDisplayPyramids(encoder, displaySelectedMipLevel);
          this.writeDisplayUniforms(displaySelectedMipLevel);
          if (rasterStrokeActive) {
            this.rasterStrokeRenderer!.updateDisplayParameters(
              "permanent",
              this.rasterStrokeStyle,
              this.rasterBevelStyle,
            );
          }
          const lod0FullRebuildCpuEncodingStart = requiresFullRebuild
            && displaySelectedMipLevel === 0 ? performance.now() : 0;
          if (this.mixedSceneStack?.textCount) {
            this.encodeMixedSceneSegmentedPresentation(
              encoder,
              presentationDirtyRect,
              requiresFullRebuild,
              rasterStrokeActive
                ? { kind: "raster-stroke", sourceMode: "permanent" }
                : { kind: "base" },
              requiresFullRebuild
                ? "Rebuild segmented canonical cache after Light Glaze commit"
                : "Canonicalize segmented Light Glaze cache after commit",
            );
          } else {
            const displayPass = encoder.beginRenderPass({
              label: requiresFullRebuild
                ? "Rebuild canonical presentation cache after Light Glaze commit"
                : "Canonicalize Light Glaze presentation cache after commit",
              colorAttachments: [
                {
                  view: this.presentationCacheView!,
                  loadOp: requiresFullRebuild ? "clear" : "load",
                  storeOp: "store",
                  clearValue: { r: 0.02, g: 0.02, b: 0.025, a: 1 },
                },
              ],
            });
            displayPass.setPipeline(
              rasterStrokeActive
                ? this.rasterStrokeDisplayPipeline
                : this.vectorTextDisplayPipeline && this.vectorTextDisplayBindGroup
                  ? this.vectorTextDisplayPipeline
                  : this.displayPipeline,
            );
            if (rasterStrokeActive) {
              displayPass.setBindGroup(0, this.rasterStrokeDisplayScreenBindGroup);
              displayPass.setBindGroup(
                1,
                this.rasterStrokeDisplayBindGroups.get("permanent")!,
              );
            } else {
              displayPass.setBindGroup(0, this.vectorTextDisplayBindGroup ?? this.displayBindGroup);
            }
            if (!requiresFullRebuild) {
              displayPass.setScissorRect(
                presentationDirtyRect.x,
                presentationDirtyRect.y,
                presentationDirtyRect.width,
                presentationDirtyRect.height,
              );
            }
            displayPass.draw(3, 1, 0, 0);
            displayPass.end();
          }
          presentationCacheWasUpdated = true;
          if (lod0FullRebuildCpuEncodingStart > 0) {
            const elapsed = performance.now() - lod0FullRebuildCpuEncodingStart;
            if (rasterStrokeActive) {
              presentationCacheLod0FullRebuildTraceEnabledPasses += 1;
              presentationCacheLod0FullRebuildTraceEnabledCpuEncodingMs += elapsed;
            } else {
              presentationCacheLod0FullRebuildTraceDisabledPasses += 1;
              presentationCacheLod0FullRebuildTraceDisabledCpuEncodingMs += elapsed;
            }
          }
          presentationCacheUpdatedPixels = presentationDirtyRect.width * presentationDirtyRect.height;
          if (requiresFullRebuild) {
            presentationCacheFullRebuilds = 1;
          } else {
            presentationCachePartialUpdates = 1;
          }
        } else if (presentationLayerDirtyRect) {
          presentationCacheOffscreenSkips = 1;
        }
        displayEncodingMs += performance.now() - canonicalDisplayStart;
      }
    }

    if (present) {
      const displayEncodingStart = performance.now();
      const currentTexture = this.context.getCurrentTexture();
      encoder.copyTextureToTexture(
        { texture: this.presentationCacheTexture! },
        { texture: currentTexture },
        {
          width: this.canvas.width,
          height: this.canvas.height,
          depthOrArrayLayers: 1,
        },
      );
      displayEncodingMs += performance.now() - displayEncodingStart;
    }

    const submitStart = performance.now();
    this.device.queue.submit([encoder.finish()]);
    commandSubmitMs = performance.now() - submitStart;
    if (present && presentationCacheWasUpdated) {
      this.presentationCacheNeedsFullRebuild = false;
    }
    if (session.commitRequested) {
      this.lightGlazeSession = null;
    }
    // Restore the current UI settings after the ordered Light Glaze submit so
    // a following Normal/Additive frame sees the ordinary uniform contents.
    this.writeBrushUniforms(this.settings);
    if (this.isTexturizedGrainActive(this.settings)) {
      this.writeGrainUniforms(this.settings);
    }

    return {
      totalCpuMs: performance.now() - cpuStart,
      stampPackingMs,
      instanceUploadMs,
      brushEncodingMs,
      displayEncodingMs,
      commandSubmitMs,
      scissorPixels,
      dirtyRect: submittedDirtyRect,
      shapeOccupancySelection: submittedShapeOccupancySelection,
      presentationCacheFullRebuilds,
      presentationCachePartialUpdates,
      presentationCacheOffscreenSkips,
      presentationCacheLod0FullRebuildTraceEnabledPasses,
      presentationCacheLod0FullRebuildTraceEnabledCpuEncodingMs,
      presentationCacheLod0FullRebuildTraceDisabledPasses,
      presentationCacheLod0FullRebuildTraceDisabledCpuEncodingMs,
      presentationCacheUpdatedPixels,
      legacyDisplayShaderPixels,
      presentationCopiedPixels,
      displaySelectedMipLevel,
      paintDisplayPyramidMaintenanceFrames,
      paintDisplayPyramidFullLevelBuilds,
      paintDisplayPyramidDirtyLevelUpdates,
      paintDisplayPyramidPasses,
      paintDisplayPyramidBaseDirtyPixels,
      paintDisplayPyramidUpdatedPixels,
      paintDisplayPyramidEncodingMs,
      lightGlazeBatches,
      lightGlazeCommits,
      lightGlazeCompositePixels,
      lightGlazePyramidPasses,
      lightGlazePyramidUpdatedPixels,
      grainBatches,
      grainBaseStamps,
      grainPhysicalCopies,
      grainCircleBatches,
      grainShapeBatches,
    };
  }

  private submitBlendImmediate(
    batches: readonly DryBlendRenderBatch[],
    clearLayer: boolean,
    settings: BrushSettings,
    historyActionId: number,
    present = true,
    replayBatch: BlendHistoryRenderBatch | null = null,
  ): SubmitTiming {
    const renderer = this.blendRenderer;
    if (!renderer) {
      throw new Error("Renderer WebGPU Blend dry non inizializzato.");
    }
    if (replayBatch && replayBatch.shapeMaskIdentity !== this.shapeMaskIdentity) {
      throw new Error("La Shape Blend usata dalla cronologia non corrisponde alla risorsa corrente.");
    }
    const expectedGrainIdentity = this.isTexturizedGrainActive(settings)
      ? this.grainTextureIdentity
      : null;
    if (replayBatch && replayBatch.grainTextureIdentity !== expectedGrainIdentity) {
      throw new Error("Il Grain Blend usato dalla cronologia non corrisponde alla risorsa corrente.");
    }

    // Il renderer accetta al massimo maximumBatchesPerSubmit batch per submit;
    // il drenaggio per frame può superarlo, quindi qui si spezza in chunk.
    let blendCpuMs = 0;
    let blendDirtyRect: DirtyRect | null = null;
    if (batches.length === 0) {
      const blendTiming = renderer.submit(batches, settings, historyActionId, clearLayer);
      blendCpuMs = blendTiming.cpuMs;
      blendDirtyRect = blendTiming.dirtyRect;
    } else {
      for (
        let start = 0;
        start < batches.length;
        start += renderer.maximumBatchesPerSubmit
      ) {
        const chunk = batches.slice(start, start + renderer.maximumBatchesPerSubmit);
        const chunkTiming = renderer.submit(
          chunk,
          settings,
          historyActionId,
          clearLayer && start === 0,
        );
        blendCpuMs += chunkTiming.cpuMs;
        blendDirtyRect = this.mergeDirtyRects(blendDirtyRect, chunkTiming.dirtyRect);
      }
    }
    if (clearLayer) {
      this.presentationCacheNeedsFullRebuild = true;
      this.paintDisplayMipValidThroughLevel = 0;
    }
    const timing = this.submitImmediate(
      [],
      false,
      settings,
      present,
      null,
      blendDirtyRect,
      clearLayer,
    );
    return {
      ...timing,
      totalCpuMs: timing.totalCpuMs + blendCpuMs,
      brushEncodingMs: timing.brushEncodingMs + blendCpuMs,
      scissorPixels: batches.reduce(
        (total, batch) => total + batch.readRect.width * batch.readRect.height,
        0,
      ),
      dirtyRect: blendDirtyRect,
      shapeOccupancySelection: null,
    };
  }

  private submitImmediate(
    stamps: readonly Stamp[],
    clearLayer: boolean,
    settings: BrushSettings = this.settings,
    present = true,
    replayBatch: PaintHistoryRenderBatch | null = null,
    externalDirtyRect: DirtyRect | null = null,
    externalLayerCleared = false,
  ): SubmitTiming {
    if (isStrokeGlazeBlendMode(settings.blendMode)) {
      if (this.lightGlazeSession) {
        return this.submitLightGlazeImmediate(stamps, clearLayer, settings, present, replayBatch);
      }
      if (stamps.length > 0) {
        throw new Error("Stamp Light Glaze senza sessione per-stroke.");
      }
    }
    const grainActive = this.isTexturizedGrainActive(settings);
    if (grainActive) {
      this.writeGrainUniforms(settings);
    }
    const cpuStart = performance.now();
    if (present) {
      this.ensurePresentationCacheTexture();
    }
    const thicknessTailFrame = present ? this.prepareThicknessTailFrame() : null;
    if (thicknessTailFrame?.grainActive && !grainActive) {
      this.writeGrainUniforms(thicknessTailFrame.settings);
    }
    const encoder = this.device.createCommandEncoder({ label: "Brush frame encoder" });
    let stampPackingMs = 0;
    let instanceUploadMs = 0;
    let brushEncodingMs = 0;
    let displayEncodingMs = 0;
    let commandSubmitMs = 0;
    let scissorPixels = 0;
    let submittedDirtyRect: DirtyRect | null = externalDirtyRect;
    let submittedShapeOccupancySelection: ShapeOccupancySelection | null = null;
    let presentationCacheFullRebuilds = 0;
    let presentationCachePartialUpdates = 0;
    let presentationCacheOffscreenSkips = 0;
    let presentationCacheLod0FullRebuildTraceEnabledPasses = 0;
    let presentationCacheLod0FullRebuildTraceEnabledCpuEncodingMs = 0;
    let presentationCacheLod0FullRebuildTraceDisabledPasses = 0;
    let presentationCacheLod0FullRebuildTraceDisabledCpuEncodingMs = 0;
    let presentationCacheUpdatedPixels = 0;
    let legacyDisplayShaderPixels = 0;
    let presentationCopiedPixels = 0;
    let presentationCacheWasUpdated = false;
    let displaySelectedMipLevel = this.paintDisplaySelectedMipLevel;
    let paintDisplayPyramidMaintenanceFrames = 0;
    let paintDisplayPyramidFullLevelBuilds = 0;
    let paintDisplayPyramidDirtyLevelUpdates = 0;
    let paintDisplayPyramidPasses = 0;
    let paintDisplayPyramidBaseDirtyPixels = 0;
    let paintDisplayPyramidUpdatedPixels = 0;
    let paintDisplayPyramidEncodingMs = 0;
    let grainBatches = 0;
    let grainBaseStamps = 0;
    let grainPhysicalCopies = 0;
    let grainCircleBatches = 0;
    let grainShapeBatches = 0;

    if (replayBatch && replayBatch.shapeMaskIdentity !== this.shapeMaskIdentity) {
      throw new Error("La Shape usata dalla cronologia non corrisponde alla risorsa corrente.");
    }
    const expectedGrainIdentity = this.isTexturizedGrainActive(settings)
      ? this.grainTextureIdentity
      : null;
    if (replayBatch && replayBatch.grainTextureIdentity !== expectedGrainIdentity) {
      throw new Error("Il Grain usato dalla cronologia non corrisponde alla risorsa corrente.");
    }

    if (clearLayer || stamps.length > 0) {
      let dirtyRect: DirtyRect | null = null;
      let shapeOccupancySelection: ShapeOccupancySelection | null = null;
      if (stamps.length > 0) {
        const packingStart = performance.now();
        const packedDirtyRect = this.packStamps(stamps, settings);
        dirtyRect = replayBatch ? replayBatch.dirtyRect : packedDirtyRect;
        stampPackingMs = performance.now() - packingStart;
        const uploadStart = performance.now();
        this.device.queue.writeBuffer(
          this.instanceBuffer,
          0,
          this.instanceUpload,
          0,
          stamps.length * STAMP_STRIDE_BYTES,
        );
        if (settings.shape === "shape") {
          shapeOccupancySelection = replayBatch
            ? replayBatch.shapeOccupancySelection
            : this.selectShapeOccupancy(this.packedMinimumRadius);
        }
        instanceUploadMs = performance.now() - uploadStart;
      }
      submittedDirtyRect = dirtyRect;
      submittedShapeOccupancySelection = shapeOccupancySelection;

      const brushEncodingStart = performance.now();
      const brushPass = encoder.beginRenderPass({
        label: "Paint into 4096² layer",
        colorAttachments: [
          {
            view: this.layerView,
            loadOp: clearLayer ? "clear" : "load",
            storeOp: "store",
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          },
        ],
      });

      if (stamps.length > 0 && dirtyRect) {
        scissorPixels = dirtyRect.width * dirtyRect.height;
        const isShape = settings.shape === "shape";
        const shapeOccupancyMip = shapeOccupancySelection?.selectedMipLevel ?? null;
        const useShapeOccupancy = isShape && shapeOccupancyMip !== null;
        const pipeline = grainActive
          ? isShape
            ? useShapeOccupancy
              ? settings.blendMode === "additive"
                ? this.grainShapeOccupancyAdditivePipeline
                : this.grainShapeOccupancyNormalPipeline
              : settings.blendMode === "additive"
                ? this.grainShapeAdditivePipeline
                : this.grainShapeNormalPipeline
            : settings.blendMode === "additive"
              ? this.grainAdditivePipeline
              : this.grainNormalPipeline
          : isShape
            ? useShapeOccupancy
              ? settings.blendMode === "additive"
                ? this.shapeOccupancyAdditivePipeline
                : this.shapeOccupancyNormalPipeline
              : settings.blendMode === "additive"
                ? this.shapeAdditivePipeline
                : this.shapeNormalPipeline
            : settings.blendMode === "additive" ? this.additivePipeline : this.normalPipeline;
        brushPass.setPipeline(pipeline);
        brushPass.setBindGroup(
          0,
          grainActive
            ? useShapeOccupancy
              ? this.grainBrushOccupancyBindGroups[
                this.grainCoordinateMode(settings)
              ][settings.grainFiltering][shapeOccupancyMip!]
              : this.grainBrushBindGroups[
                this.grainCoordinateMode(settings)
              ][settings.grainFiltering]
            : useShapeOccupancy
              ? this.brushOccupancyBindGroups[shapeOccupancyMip!]
              : this.brushBindGroup,
        );
        brushPass.setScissorRect(dirtyRect.x, dirtyRect.y, dirtyRect.width, dirtyRect.height);
        if (isShape && shapeOccupancySelection && !replayBatch) {
          this.recordShapeSampling(shapeOccupancySelection);
        }
        brushPass.draw(STAMP_VERTICES_PER_COPY, stamps.length * settings.count, 0, 0);
        if (grainActive) {
          grainBatches = 1;
          grainBaseStamps = stamps.length;
          grainPhysicalCopies = stamps.length * settings.count;
          grainCircleBatches = isShape ? 0 : 1;
          grainShapeBatches = isShape ? 1 : 0;
        }
      }
      brushPass.end();
      brushEncodingMs = performance.now() - brushEncodingStart;
    }
    const layerCleared = clearLayer || externalLayerCleared;
    if (layerCleared || submittedDirtyRect) {
      this.noteLayerMutation(submittedDirtyRect, layerCleared);
    }


    if (thicknessTailFrame) {
      const thicknessTailEncodingStart = performance.now();
      this.encodeThicknessTailFrame(encoder, thicknessTailFrame);
      brushEncodingMs += performance.now() - thicknessTailEncodingStart;
    }

    if (!present && (clearLayer || stamps.length > 0 || externalDirtyRect || externalLayerCleared)) {
      // Una ricostruzione Undo/Redo omette i display intermedi. La cache non
      // deve quindi essere riutilizzata finché l'ultimo batch non la ricrea.
      this.presentationCacheNeedsFullRebuild = true;
      this.paintDisplayMipValidThroughLevel = 0;
      this.deferRasterStrokeMutation(layerCleared);
    }

    if (present) {
      const displayEncodingStart = performance.now();
      displaySelectedMipLevel = this.desiredPaintDisplayMipLevel();
      if (displaySelectedMipLevel !== this.paintDisplaySelectedMipLevel) {
        // A screen-space cache must never contain a mixture of samples from
        // two pyramid levels. A LOD switch therefore rebuilds it atomically.
        this.presentationCacheNeedsFullRebuild = true;
      }
      this.paintDisplaySelectedMipLevel = displaySelectedMipLevel;
      const rasterStrokeActive = this.styleStackActive();
      const transientMutationRect = this.mergeDirtyRects(
        this.thicknessTailPresentedRect,
        thicknessTailFrame?.dirtyRect ?? null,
      );
      const rasterStrokeMutationRect = this.mergeDirtyRects(
        submittedDirtyRect,
        transientMutationRect,
      );
      const rasterStrokeVirtualBounds = thicknessTailFrame
        ? this.mergeDirtyRects(this.layerContentBounds, thicknessTailFrame.dirtyRect)
        : this.layerContentBounds;
      const rasterStrokeUpdate = rasterStrokeActive
        ? this.encodeRasterStrokeUpdate(
          encoder,
          thicknessTailFrame ? "thickness-tail" : "permanent",
          rasterStrokeMutationRect,
          rasterStrokeVirtualBounds,
          layerCleared,
        )
        : { dirtyRect: null, timing: null };


      const baseDirtyRect = layerCleared
        ? { x: 0, y: 0, width: LAYER_SIZE, height: LAYER_SIZE }
        : submittedDirtyRect;
      if (layerCleared || (rasterStrokeActive && submittedDirtyRect)) {
        this.paintDisplayMipValidThroughLevel = 0;
      }
      if (!rasterStrokeActive) {
        const pyramidTiming = this.encodePaintDisplayPyramid(
          encoder,
          baseDirtyRect,
          displaySelectedMipLevel,
        );
        paintDisplayPyramidMaintenanceFrames = pyramidTiming.maintenanceFrames;
        paintDisplayPyramidFullLevelBuilds = pyramidTiming.fullLevelBuilds;
        paintDisplayPyramidDirtyLevelUpdates = pyramidTiming.dirtyLevelUpdates;
        paintDisplayPyramidPasses = pyramidTiming.passes;
        paintDisplayPyramidBaseDirtyPixels = pyramidTiming.baseDirtyPixels;
        paintDisplayPyramidUpdatedPixels = pyramidTiming.updatedPixels;
        paintDisplayPyramidEncodingMs = pyramidTiming.encodingMs;
      } else {
        const rasterPyramidStart = performance.now();
        const rasterPyramid = this.encodeRasterStrokeDisplayPyramid(
          encoder,
          rasterStrokeUpdate.dirtyRect,
          displaySelectedMipLevel,
        );
        paintDisplayPyramidMaintenanceFrames = rasterPyramid.passes > 0 ? 1 : 0;
        paintDisplayPyramidPasses = rasterPyramid.passes;
        paintDisplayPyramidBaseDirtyPixels = rasterStrokeUpdate.dirtyRect
          ? rasterStrokeUpdate.dirtyRect.width * rasterStrokeUpdate.dirtyRect.height
          : 0;
        paintDisplayPyramidUpdatedPixels = rasterPyramid.updatedPixels;
        paintDisplayPyramidEncodingMs = performance.now() - rasterPyramidStart;
      }

      const canvasPixels = this.canvas.width * this.canvas.height;
      legacyDisplayShaderPixels = canvasPixels;
      presentationCopiedPixels = canvasPixels;

      const requiresFullRebuild = this.presentationCacheNeedsFullRebuild || layerCleared;
      const presentationLayerDirtyRect = rasterStrokeActive
        ? rasterStrokeUpdate.dirtyRect
        : this.mergeDirtyRects(
          submittedDirtyRect,
          this.mergeDirtyRects(
            this.thicknessTailPresentedRect,
            thicknessTailFrame?.dirtyRect ?? null,
          ),
        );
      const presentationDirtyRect = requiresFullRebuild
        ? { x: 0, y: 0, width: this.canvas.width, height: this.canvas.height }
        : presentationLayerDirtyRect
          ? this.layerDirtyRectToPresentationRect(
            presentationLayerDirtyRect,
            displaySelectedMipLevel,
          )
          : null;

      const vectorTextDisplayPipeline = this.vectorTextDisplayPipeline;
      const useVectorTextDisplay = Boolean(
        (this.vectorTextBelowTexture || this.vectorTextAboveTexture)
        && !rasterStrokeActive
        && !thicknessTailFrame
        && this.vectorTextDisplayBindGroup
        && vectorTextDisplayPipeline,
      );
      if (presentationDirtyRect) {
        this.encodeMergedDisplayPyramids(encoder, displaySelectedMipLevel);
        this.writeDisplayUniforms(displaySelectedMipLevel);
        if (rasterStrokeActive) {
          this.rasterStrokeRenderer!.updateDisplayParameters(
            thicknessTailFrame ? "thickness-tail" : "permanent",
            this.rasterStrokeStyle,
            this.rasterBevelStyle,
          );
        }
        const lod0FullRebuildCpuEncodingStart = requiresFullRebuild
          && displaySelectedMipLevel === 0 ? performance.now() : 0;
        if (this.mixedSceneStack?.textCount) {
          const activePresentation: MixedSceneActivePresentation = rasterStrokeActive
            ? {
              kind: "raster-stroke",
              sourceMode: thicknessTailFrame ? "thickness-tail" : "permanent",
            }
            : thicknessTailFrame
              ? { kind: "thickness-tail" }
              : { kind: "base" };
          this.encodeMixedSceneSegmentedPresentation(
            encoder,
            presentationDirtyRect,
            requiresFullRebuild,
            activePresentation,
            requiresFullRebuild
              ? "Rebuild segmented persistent presentation cache"
              : "Update segmented persistent presentation cache dirty rect",
          );
        } else {
          const displayPass = encoder.beginRenderPass({
            label: requiresFullRebuild
              ? "Rebuild persistent presentation cache"
              : "Update persistent presentation cache dirty rect",
            colorAttachments: [
              {
                view: this.presentationCacheView!,
                loadOp: requiresFullRebuild ? "clear" : "load",
                storeOp: "store",
                clearValue: { r: 0.02, g: 0.02, b: 0.025, a: 1 },
              },
            ],
          });
          displayPass.setPipeline(
            rasterStrokeActive
              ? this.rasterStrokeDisplayPipeline
              : thicknessTailFrame
                ? this.thicknessTailDisplayPipeline
                : useVectorTextDisplay
                  ? vectorTextDisplayPipeline!
                  : this.displayPipeline,
          );
          if (rasterStrokeActive) {
            displayPass.setBindGroup(0, this.rasterStrokeDisplayScreenBindGroup);
            displayPass.setBindGroup(
              1,
              this.rasterStrokeDisplayBindGroups.get(
                thicknessTailFrame ? "thickness-tail" : "permanent",
              )!,
            );
          } else if (useVectorTextDisplay) {
            displayPass.setBindGroup(0, this.vectorTextDisplayBindGroup!);
          } else {
            displayPass.setBindGroup(
              0,
              thicknessTailFrame ? this.thicknessTailDisplayBindGroup! : this.displayBindGroup,
            );
          }
          if (!requiresFullRebuild) {
            displayPass.setScissorRect(
              presentationDirtyRect.x,
              presentationDirtyRect.y,
              presentationDirtyRect.width,
              presentationDirtyRect.height,
            );
          }
          displayPass.draw(3, 1, 0, 0);
          displayPass.end();
        }

        presentationCacheWasUpdated = true;
        if (lod0FullRebuildCpuEncodingStart > 0) {
          const elapsed = performance.now() - lod0FullRebuildCpuEncodingStart;
          if (rasterStrokeActive) {
            presentationCacheLod0FullRebuildTraceEnabledPasses += 1;
            presentationCacheLod0FullRebuildTraceEnabledCpuEncodingMs += elapsed;
          } else {
            presentationCacheLod0FullRebuildTraceDisabledPasses += 1;
            presentationCacheLod0FullRebuildTraceDisabledCpuEncodingMs += elapsed;
          }
        }
        presentationCacheUpdatedPixels = presentationDirtyRect.width * presentationDirtyRect.height;
        if (requiresFullRebuild) {
          presentationCacheFullRebuilds = 1;
        } else {
          presentationCachePartialUpdates = 1;
        }
      } else if (presentationLayerDirtyRect) {
        presentationCacheOffscreenSkips = 1;
      }

      const currentTexture = this.context.getCurrentTexture();
      encoder.copyTextureToTexture(
        { texture: this.presentationCacheTexture! },
        { texture: currentTexture },
        {
          width: this.canvas.width,
          height: this.canvas.height,
          depthOrArrayLayers: 1,
        },
      );
      displayEncodingMs = performance.now() - displayEncodingStart;
    }

    const submitStart = performance.now();
    this.device.queue.submit([encoder.finish()]);
    commandSubmitMs = performance.now() - submitStart;
    if (present && presentationCacheWasUpdated) {
      this.presentationCacheNeedsFullRebuild = false;
    }
    if (present) {
      this.thicknessTailPresentedRect = thicknessTailFrame
        ? { ...thicknessTailFrame.dirtyRect }
        : null;
    }
    return {
      totalCpuMs: performance.now() - cpuStart,
      stampPackingMs,
      instanceUploadMs,
      brushEncodingMs,
      displayEncodingMs,
      commandSubmitMs,
      scissorPixels,
      dirtyRect: submittedDirtyRect,
      shapeOccupancySelection: submittedShapeOccupancySelection,
      presentationCacheFullRebuilds,
      presentationCachePartialUpdates,
      presentationCacheOffscreenSkips,
      presentationCacheLod0FullRebuildTraceEnabledPasses,
      presentationCacheLod0FullRebuildTraceEnabledCpuEncodingMs,
      presentationCacheLod0FullRebuildTraceDisabledPasses,
      presentationCacheLod0FullRebuildTraceDisabledCpuEncodingMs,
      presentationCacheUpdatedPixels,
      legacyDisplayShaderPixels,
      presentationCopiedPixels,
      displaySelectedMipLevel,
      paintDisplayPyramidMaintenanceFrames,
      paintDisplayPyramidFullLevelBuilds,
      paintDisplayPyramidDirtyLevelUpdates,
      paintDisplayPyramidPasses,
      paintDisplayPyramidBaseDirtyPixels,
      paintDisplayPyramidUpdatedPixels,
      paintDisplayPyramidEncodingMs,
      lightGlazeBatches: 0,
      lightGlazeCommits: 0,
      lightGlazeCompositePixels: 0,
      lightGlazePyramidPasses: 0,
      lightGlazePyramidUpdatedPixels: 0,
      grainBatches,
      grainBaseStamps,
      grainPhysicalCopies,
      grainCircleBatches,
      grainShapeBatches,
    };
  }

  private packStampsIntoUpload(
    stamps: readonly Stamp[],
    settings: BrushSettings,
    uploadF32: Float32Array,
    uploadU32: Uint32Array,
  ): PackedStampUpload {
    let minimumX = LAYER_SIZE;
    let minimumY = LAYER_SIZE;
    let maximumX = 0;
    let maximumY = 0;
    let minimumRadius = Number.POSITIVE_INFINITY;
    const maximumShapeAngle = Math.PI * settings.shapeScatter;
    const shapeExtentFactor = settings.shape === "shape"
      ? maximumShapeAngle >= Math.PI * 0.25
        ? Math.SQRT2
        : Math.cos(maximumShapeAngle) + Math.sin(maximumShapeAngle)
      : 1;

    for (let index = 0; index < stamps.length; index += 1) {
      const stamp = stamps[index];
      const base = index * (STAMP_STRIDE_BYTES / 4);
      uploadF32[base] = stamp.x;
      uploadF32[base + 1] = stamp.y;
      uploadF32[base + 2] = stamp.radius;
      uploadF32[base + 3] = stamp.pressure;
      uploadU32[base + 4] = stamp.seed;
      uploadU32[base + 5] = 0;
      uploadF32[base + 6] = stamp.directionX;
      uploadF32[base + 7] = stamp.directionY;

      const packedX = uploadF32[base];
      const packedY = uploadF32[base + 1];
      const packedRadius = uploadF32[base + 2];
      minimumRadius = Math.min(minimumRadius, packedRadius);
      const packedDirectionX = uploadF32[base + 6];
      const packedDirectionY = uploadF32[base + 7];
      const directionLength = Math.hypot(packedDirectionX, packedDirectionY);
      const linearReach = packedRadius * 2 * settings.positionJitterLinear;
      const lateralReach = packedRadius * 2 * settings.positionJitterLateral;
      const brushReach = packedRadius * shapeExtentFactor;
      let reachX: number;
      let reachY: number;

      if (directionLength > 0.0002) {
        const directionX = packedDirectionX / directionLength;
        const directionY = packedDirectionY / directionLength;
        reachX = brushReach
          + Math.abs(directionX) * linearReach
          + Math.abs(directionY) * lateralReach
          + 2;
        reachY = brushReach
          + Math.abs(directionY) * linearReach
          + Math.abs(directionX) * lateralReach
          + 2;
      } else {
        const isotropicReach = brushReach + linearReach + lateralReach + 2;
        reachX = isotropicReach;
        reachY = isotropicReach;
      }

      minimumX = Math.min(minimumX, packedX - reachX);
      minimumY = Math.min(minimumY, packedY - reachY);
      maximumX = Math.max(maximumX, packedX + reachX);
      maximumY = Math.max(maximumY, packedY + reachY);
    }

    const x = clamp(Math.floor(minimumX), 0, LAYER_SIZE - 1);
    const y = clamp(Math.floor(minimumY), 0, LAYER_SIZE - 1);
    const right = clamp(Math.ceil(maximumX), 1, LAYER_SIZE);
    const bottom = clamp(Math.ceil(maximumY), 1, LAYER_SIZE);
    const width = Math.max(0, right - x);
    const height = Math.max(0, bottom - y);

    return {
      dirtyRect: width > 0 && height > 0 ? { x, y, width, height } : null,
      minimumRadius,
    };
  }

  private packStamps(stamps: readonly Stamp[], settings: BrushSettings): DirtyRect | null {
    const packed = this.packStampsIntoUpload(
      stamps,
      settings,
      this.instanceUploadF32,
      this.instanceUploadU32,
    );
    this.packedMinimumRadius = packed.minimumRadius;
    return packed.dirtyRect;
  }

  private packThicknessTailStamps(
    stamps: readonly Stamp[],
    settings: BrushSettings,
  ): PackedStampUpload {
    return this.packStampsIntoUpload(
      stamps,
      settings,
      this.thicknessTailInstanceUploadF32,
      this.thicknessTailInstanceUploadU32,
    );
  }

  private generateBenchmarkStamps(count: number, settings: BrushSettings): Stamp[] {
    const stamps = new Array<Stamp>(count);
    const center = LAYER_SIZE * 0.5;
    const maximumPathRadius = LAYER_SIZE * 0.39;

    for (let index = 0; index < count; index += 1) {
      const progress = count <= 1 ? 0 : index / (count - 1);
      const angle = progress * Math.PI * 18;
      const pathRadius = maximumPathRadius * (0.12 + progress * 0.88);
      const pressure = clamp(0.58 + Math.sin(progress * Math.PI * 15) * 0.28, 0.1, 1);
      const radius = Math.max(0.5, settings.size * 0.5);

      stamps[index] = {
        x: center + Math.cos(angle) * pathRadius,
        y: center + Math.sin(angle * 1.037) * pathRadius,
        radius,
        pressure,
        seed: (Math.imul(this.seedSequence++, 0x9e3779b1) ^ 0xa511e9b3) >>> 0,
        directionX: -Math.sin(angle),
        directionY: Math.cos(angle * 1.037),
        historyActionId: 0,
      };
    }

    return stamps;
  }

  private recordRenderedFrame(timestamp: number): void {
    this.renderTimestamps.push(timestamp);
    const cutoff = timestamp - 1000;
    while (this.renderTimestamps.length > 0 && this.renderTimestamps[0] < cutoff) {
      this.renderTimestamps.shift();
    }
  }

  private recordStampGenerationTime(startTime: number): void {
    if (startTime > 0 && this.activeStrokeProfile) {
      this.activeStrokeProfile.stampGenerationMs += performance.now() - startTime;
    }
  }

  private recordStrokeFrameTiming(
    timestamp: number,
    batchSize: number,
    copyCount: number,
    timing: SubmitTiming,
    frameTiming: RenderFrameTiming,
  ): void {
    const profile = this.activeStrokeProfile;
    if (!profile) {
      return;
    }

    if (profile.previousFrameTimestamp !== null) {
      profile.renderIntervalMs.push(Math.max(0, timestamp - profile.previousFrameTimestamp));
    }
    profile.previousFrameTimestamp = timestamp;
    profile.renderFrames += 1;
    profile.cpuFrameMs.push(this.lastCpuFrameMs);
    profile.renderFrameTotalMs.push(frameTiming.totalCpuMs);
    profile.renderFrameOverheadMs.push(Math.max(0, frameTiming.totalCpuMs - timing.totalCpuMs));
    profile.resizeCanvasMs += frameTiming.resizeCanvasMs;
    profile.batchExtractionMs += frameTiming.batchExtractionMs;
    profile.statsPublishMs += frameTiming.statsPublishMs;
    profile.stampPackingMs += timing.stampPackingMs;
    profile.instanceUploadMs += timing.instanceUploadMs;
    profile.brushEncodingMs += timing.brushEncodingMs;
    profile.displayEncodingMs += timing.displayEncodingMs;
    profile.commandSubmitMs += timing.commandSubmitMs;
    profile.estimatedScissorPixels += timing.scissorPixels;
    profile.presentationCacheFullRebuilds += timing.presentationCacheFullRebuilds;
    profile.presentationCachePartialUpdates += timing.presentationCachePartialUpdates;
    profile.presentationCacheOffscreenSkips += timing.presentationCacheOffscreenSkips;
    profile.presentationCacheLod0FullRebuildTraceEnabledPasses +=
      timing.presentationCacheLod0FullRebuildTraceEnabledPasses;
    profile.presentationCacheLod0FullRebuildTraceEnabledCpuEncodingMs +=
      timing.presentationCacheLod0FullRebuildTraceEnabledCpuEncodingMs;
    profile.presentationCacheLod0FullRebuildTraceDisabledPasses +=
      timing.presentationCacheLod0FullRebuildTraceDisabledPasses;
    profile.presentationCacheLod0FullRebuildTraceDisabledCpuEncodingMs +=
      timing.presentationCacheLod0FullRebuildTraceDisabledCpuEncodingMs;
    profile.presentationCacheUpdatedPixels += timing.presentationCacheUpdatedPixels;
    profile.legacyDisplayShaderPixels += timing.legacyDisplayShaderPixels;
    profile.presentationCopiedPixels += timing.presentationCopiedPixels;
    profile.paintDisplayMaximumSelectedMipLevel = Math.max(
      profile.paintDisplayMaximumSelectedMipLevel,
      timing.displaySelectedMipLevel,
    );
    profile.paintDisplayPyramidMaintenanceFrames +=
      timing.paintDisplayPyramidMaintenanceFrames;
    profile.paintDisplayPyramidFullLevelBuilds += timing.paintDisplayPyramidFullLevelBuilds;
    profile.paintDisplayPyramidDirtyLevelUpdates +=
      timing.paintDisplayPyramidDirtyLevelUpdates;
    profile.paintDisplayPyramidPasses += timing.paintDisplayPyramidPasses;
    profile.paintDisplayPyramidBaseDirtyPixels += timing.paintDisplayPyramidBaseDirtyPixels;
    profile.paintDisplayPyramidUpdatedPixels += timing.paintDisplayPyramidUpdatedPixels;
    profile.paintDisplayPyramidEncodingMs += timing.paintDisplayPyramidEncodingMs;
    profile.lightGlazeBatches += timing.lightGlazeBatches;
    profile.lightGlazeCommits += timing.lightGlazeCommits;
    profile.lightGlazeCompositePixels += timing.lightGlazeCompositePixels;
    profile.lightGlazePyramidPasses += timing.lightGlazePyramidPasses;
    profile.lightGlazePyramidUpdatedPixels += timing.lightGlazePyramidUpdatedPixels;
    profile.grainBatches += timing.grainBatches;
    profile.grainBaseStamps += timing.grainBaseStamps;
    profile.grainPhysicalCopies += timing.grainPhysicalCopies;
    profile.grainCircleBatches += timing.grainCircleBatches;
    profile.grainShapeBatches += timing.grainShapeBatches;

    if (batchSize > 0) {
      profile.brushBatches += 1;
      profile.physicalCopies += batchSize * copyCount;
      profile.largestBatchStamps = Math.max(profile.largestBatchStamps, batchSize);
    }
  }

  private publishStats(): void {
    this.callbacks.onStats?.(this.getStats());
  }

  private publishHistoryState(): void {
    this.callbacks.onHistoryChange?.(this.getHistoryState());
  }

  private async assertShaderCompiled(module: GPUShaderModule, label: string): Promise<void> {
    const compilationInfo = await module.getCompilationInfo();
    const errors = compilationInfo.messages.filter((message) => message.type === "error");
    if (errors.length === 0) {
      return;
    }

    const description = errors
      .map((error) => `${error.lineNum}:${error.linePos} ${error.message}`)
      .join("\n");
    throw new Error(`Errore WGSL nel modulo ${label}:\n${description}`);
  }

  private describeAdapter(adapter: GPUAdapter): string {
    const info = adapter.info;
    const values = [info.vendor, info.architecture, info.device, info.description]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value));
    return [...new Set(values)].join(" · ") || "GPU WebGPU";
  }
}
