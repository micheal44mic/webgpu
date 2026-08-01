/**
 * Forme dei report di telemetria del motore. Sono contratti di sola lettura
 * verso interfaccia, benchmark e suite golden: nessuna logica, nessuno stato.
 */
import type {
  AdaptivePreviewActivationReason,
  AdaptivePreviewConcreteActivationReason,
} from "./adaptive-preview-runtime";
import type { RasterBevelRect, RasterBevelStyle } from "./bevel-core";
import { EFFECTS_SCRATCH_POOL_STRATEGY } from "./effects-scratch-pool";
import { EFFECTS_WORKING_SET_STRATEGY } from "./effects-workbench";
import { FILL_REFERENCE_LAYER_STRATEGY } from "./fill-core";
import { lightGlazeAdditionalMemoryMiB, paintDisplayPyramidAdditionalMemoryMiB } from "./engine-memory-model";
import {
  LAYER_BAKE_STRATEGY,
  LAYER_COMPOSITE_STRATEGY,
  type AdaptivePreviewStaleFrameStrategy,
  type AdaptivePreviewStrategy,
  type AdaptivePreviewTriggerStrategy,
  type AdaptivePreviewVisibleCanvasStrategy,
  type AdaptiveSpacingStrategy,
  type BrushOpacityStrategy,
  type FragmentCoverageStrategy,
  type GrainAdaptivePreviewStrategy,
  type GrainCoordinateStrategy,
  type GrainCoverageStrategy,
  type GrainMipStrategy,
  type GrainPipelineStrategy,
  type GrainSamplingStrategy,
  type GrainStrategy,
  type HistoryReplayStrategy,
  type HistoryStampRetentionStrategy,
  type HistoryStorageStrategy,
  type LightGlazeAdaptivePreviewStrategy,
  type LightGlazeStorageMode,
  type LightGlazeStrategy,
  type PaintDisplayLodSelectionStrategy,
  type PaintDisplayPyramidStrategy,
  type PresentationCacheStrategy,
  type PresentationTransferStrategy,
  type ShapeMaskDecodeStrategy,
  type ShapeSamplingStrategy,
  type StampGeometry,
  type ThicknessDynamicsPreviewStrategy,
} from "./engine-strategies";
import type { DirtyRect } from "./engine-stroke-types";
import type { AdaptiveSpacingEvent, LayerFormat, MixedSceneSnapshot } from "./engine-types";
import type { GpuHistorySlice } from "./gpu-history-storage";
import {
  LAYER_STORAGE_GRID_SIZE,
  LAYER_STORAGE_STRATEGY,
  LAYER_STORAGE_TILE_COUNT,
  LAYER_STORAGE_TILE_SIZE,
} from "./layer-storage-study";
import type { RasterInnerShadowStyle, RasterOuterShadowStyle } from "./shadow-core";
import type { ShapeOccupancyFallbackReason, ShapeOccupancySelection } from "./shape-occupancy";
import type { RasterStrokeStyle } from "./stroke-core";
import type { ThicknessDynamicsStrategy } from "./thickness-dynamics";

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
  fillRendererMiB: number;
  lightGlazeMiB: number;
  lightGlazeTransitionPeakMiB: number;
  thicknessTailMiB: number;
  historyGpuMiB: number;
  historyGpuUsedMiB: number;
  historyGpuPageCount: number;
  countedTotalMiB: number;
}

export interface LayerStorageLayerEstimate {
  id: number;
  name: string;
  active: boolean;
  reference: boolean;
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
  referenceLayerId: number | null;
  fillReferenceLayerStrategy: typeof FILL_REFERENCE_LAYER_STRATEGY;
  /** Extra full mip 0 retained only when Reference differs from active. */
  fillReferenceLayerMiB: number;
  mixedScene: MixedSceneSnapshot | null;
  layerBakeStrategy: typeof LAYER_BAKE_STRATEGY;
  layerCompositeStrategy: typeof LAYER_COMPOSITE_STRATEGY;
  layerStorageStudy: LayerStorageStudyStats;
  layers: readonly {
    id: number;
    name: string;
    visible: boolean;
    opacity: number;
    reference: boolean;
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

export interface SubmitTiming {
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
  historyGpuSlice: GpuHistorySlice | null;
}

export interface RenderFrameTiming {
  totalCpuMs: number;
  resizeCanvasMs: number;
  batchExtractionMs: number;
  statsPublishMs: number;
}

export interface MutableStrokePerformanceProfile {
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
