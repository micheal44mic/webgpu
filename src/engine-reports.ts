import type { BrushEngine } from "./brush-engine";
import { type LayerFormat } from "./engine-types";
import { STROKE_CURVE_STRATEGY } from "./stroke-curve-core";
import { STROKE_STABILIZATION_STRATEGY } from "./stroke-stabilization-core";
import {
  ADAPTIVE_PREVIEW_STALE_FRAME_STRATEGY,
  ADAPTIVE_PREVIEW_STRATEGY,
  ADAPTIVE_PREVIEW_TRIGGER_STRATEGY,
  ADAPTIVE_PREVIEW_VISIBLE_CANVAS_STRATEGY,
  ADAPTIVE_SPACING_STRATEGY,
  BRUSH_OPACITY_STRATEGY,
  CIRCLE_FRAGMENT_COVERAGE_STRATEGY,
  COLOR_SEED_STRATEGY,
  DIRTY_RECT_STRATEGY,
  GRAIN_ADAPTIVE_PREVIEW_STRATEGY,
  GRAIN_COVERAGE_STRATEGY,
  GRAIN_MIP_STRATEGY,
  GRAIN_PIPELINE_STRATEGY,
  GRAIN_STORAGE_LIFECYCLE_STRATEGY,
  HISTORY_REPLAY_STRATEGY,
  HISTORY_STAMP_RETENTION_STRATEGY,
  HISTORY_STORAGE_STRATEGY,
  LAYER_BAKE_STRATEGY,
  LAYER_COMPOSITE_STRATEGY,
  LIGHT_GLAZE_ADAPTIVE_PREVIEW_STRATEGY,
  LIGHT_GLAZE_STORAGE_LIFECYCLE_STRATEGY,
  PAINT_DISPLAY_LOD_SELECTION_STRATEGY,
  PAINT_DISPLAY_PYRAMID_STRATEGY,
  PRESENTATION_CACHE_STRATEGY,
  PRESENTATION_TRANSFER_STRATEGY,
  SHAPE_FRAGMENT_COVERAGE_STRATEGY,
  SHAPE_STORAGE_LIFECYCLE_STRATEGY,
  STAMP_GEOMETRY,
  THICKNESS_DYNAMICS_PREVIEW_STRATEGY,
  isTexturizedGrainActive,
  lightGlazeStrategyForBlendMode,
  type FragmentCoverageStrategy,
  type GrainAdaptivePreviewStrategy,
  type GrainCoordinateStrategy,
  type GrainCoverageStrategy,
  type GrainSamplingStrategy,
  type GrainStrategy,
  type LightGlazeStorageMode,
  type LightGlazeStrategy,
  type ShapeMaskDecodeStrategy,
  type ShapeSamplingStrategy,
  type StampGeometry,
  type ThicknessDynamicsPreviewStrategy,
} from "./engine-strategies";
import {
  type EngineGpuMemoryStats,
  type EngineStats,
  type LayerMemoryState,
  type LayerStorageExactLayerMeasurement,
  type LayerStorageExactStudy,
  type LayerStorageLayerEstimate,
  type LayerStorageStudyStats,
  type StrokePerformanceProfile,
} from "./engine-stats";
import { EFFECTS_WORKING_SET_STRATEGY } from "./effects-workbench";
import { EFFECTS_SCRATCH_POOL_STRATEGY } from "./effects-scratch-pool";
import { rasterImageGpuMemoryBytes } from "./engine-raster-image-runtime";
import {
  RASTER_STROKE_COMPACT_SCRATCH_MAX_WIDTH,
  RASTER_STROKE_SCRATCH_STRATEGY,
  copyRasterStrokeStyle,
  type RasterStrokeStyle,
} from "./stroke-core";
import {
  RASTER_COLOR_OVERLAY_STRATEGY,
  copyRasterColorOverlayStyle,
  type RasterColorOverlayStyle,
} from "./raster-color-overlay-core";
import {
  RASTER_STROKE_COVERAGE_STRATEGY,
  RASTER_STROKE_DISTANCE_STORAGE_STRATEGY,
  RASTER_STROKE_GEOMETRY_STORAGE_STRATEGY,
  RASTER_STROKE_MUTATION_GATE_STRATEGY,
  RASTER_STROKE_STYLED_STORAGE_STRATEGY,
  type RasterStrokeSourceMode,
} from "./stroke-renderer";
import { copyRasterBevelStyle, type RasterBevelRect, type RasterBevelStyle } from "./bevel-core";
import {
  RASTER_BEVEL_BOUNDING_FIELD_STRATEGY,
  RASTER_BEVEL_DISTANCE_STRATEGY,
  RASTER_BEVEL_FIELD_STRATEGY,
  RASTER_BEVEL_WORKSPACE_STRATEGY,
} from "./bevel-renderer";
import {
  copyRasterInnerShadowStyle,
  copyRasterOuterShadowStyle,
  type RasterInnerShadowStyle,
  type RasterOuterShadowStyle,
} from "./shadow-core";
import { RASTER_SHADOW_STORAGE_STRATEGY, RASTER_SHADOW_WORKSPACE_STRATEGY } from "./shadow-renderer";
import { DRY_BLEND_SCRATCH_LIFECYCLE_STRATEGY } from "./blend-core";
import { FILL_REFERENCE_LAYER_STRATEGY } from "./fill-core";
import { type ShapeOccupancyFallbackReason } from "./shape-occupancy";
import {
  THICKNESS_DYNAMICS_STRATEGY,
  THICKNESS_TAPER_WINDOW_MS,
  type ThicknessDynamicsStrategy,
} from "./thickness-dynamics";
import {
  DOCUMENT_HEIGHT,
  DOCUMENT_MAX_EDGE,
  DOCUMENT_WIDTH,
  MEBIBYTE_BYTES,
  PAINT_DISPLAY_MIP_LEVEL_COUNT,
  SHAPE_OCCUPANCY_GRID_SIZE,
  SHAPE_OCCUPANCY_MAP_BYTES,
  SHAPE_OCCUPANCY_MAX_COVERAGE_RATIO,
  SHAPE_OCCUPANCY_MAX_MIP,
  SHAPE_OCCUPANCY_MIN_RADIUS,
  STAMP_STRIDE_BYTES,
  STAMP_VERTICES_PER_COPY,
  THICKNESS_TAIL_MAXIMUM_TEXTURE_DIMENSION,
  THICKNESS_TAIL_TEXTURE_QUANTUM,
} from "./engine-limits";
import {
  type MemoryZone,
  memoryLedgerUsedBytes,
  memoryZoneFor,
} from "./memory-governor-core";
import {
  layerBaseMemoryMiB,
  lightGlazeAdditionalMemoryMiB,
  paintDisplayPyramidAdditionalMemoryMiB,
  shapeTextureMemoryMiB,
  staticPaintBufferMemoryMiB,
} from "./engine-memory-model";
import {
  ADAPTIVE_PREVIEW_EXACT_LINEAR_SCALE,
  ADAPTIVE_PREVIEW_JS_BUDGET_MS,
  ADAPTIVE_PREVIEW_MAX_PATCH_CSS_PIXELS,
  ADAPTIVE_PREVIEW_MAX_TIP_BASE_STAMPS,
  ADAPTIVE_PREVIEW_PROBE_INTERVAL_SUBMISSIONS,
  ADAPTIVE_PREVIEW_PROBE_NEAR_MISS_MINIMUM_MS,
  ADAPTIVE_PREVIEW_SLOW_COMPLETION_THRESHOLD_MS,
  ADAPTIVE_PREVIEW_TRIGGER_CONSECUTIVE_PROBES,
  ADAPTIVE_PREVIEW_TRIGGER_THRESHOLD_MS,
  ADAPTIVE_SPACING_STEP_PERCENT_POINTS,
} from "./adaptive-preview-runtime";
import { LAYER_COLD_COMPRESSION_RUNTIME_BUILD } from "./layer-cold-compression-client";
import { LAYER_BLEND_MODE_ORDER } from "./layer-blend-modes";
import {
  VECTOR_TEXT_GPU_SAMPLE_COUNT,
  VECTOR_TEXT_GPU_TARGET_BYTES_PER_PIXEL,
} from "./vector-text-gpu-shader";
import { VECTOR_TEXT_RUN_CACHE_UNIFORM_BYTES } from "./engine-vector-text-resources";
import { average, maximum, percentile } from "./engine-math";
import {
  LAYER_STORAGE_GRID_SIZE,
  LAYER_STORAGE_STRATEGY,
  LAYER_STORAGE_TILE_COUNT,
  LAYER_STORAGE_TILE_SIZE,
  alignedBoundsTileCount,
  compareLayerStorageMasks,
  countLayerStorageTiles,
  exactLayerStorageTileMask,
  layerStorageTileMemoryMiB,
} from "./layer-storage-study";
import { MIXED_MERGED_SURFACE_STORAGE_STRATEGY } from "./merged-surface-bounds";
import { type DirtyRect } from "./engine-stroke-types";
import { type MergedSurfaceResources } from "./engine-layer-resources";
import { historyCheckpointAllocatedBytes } from "./history-maintenance-runtime";

export function getBenchmarkEnvironment(engine: BrushEngine): {
  canvasWidth: number;
  canvasHeight: number;
  layerSize: number;
  layerFormat: LayerFormat;
  layerMemoryMiB: number;
  layerCount: number;
  activeLayerId: number;
  referenceLayerId: number | null;
  fillReferenceLayerStrategy: typeof FILL_REFERENCE_LAYER_STRATEGY;
  fillReferenceLayerMiB: number;
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
  rasterColorOverlayStyle: RasterColorOverlayStyle;
  rasterColorOverlayStrategy: typeof RASTER_COLOR_OVERLAY_STRATEGY;
  rasterColorOverlayScratchMemoryMiB: 0;
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
  strokeCurveStrategy: typeof STROKE_CURVE_STRATEGY;
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
  grainTextureFormat: "r16float";
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
  lightGlazeCommitStrategy:
    | "fixed-function-render-target"
    | "compute-in-place-read-write-storage"
    | "render-copy-scratch-tile";
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
  const effectsScratch = engine.effectsWorkbench?.scratchPool.snapshot();
  const layerStorageStudy = getLayerStorageStudy(engine);
  const bevelField = engine.rasterBevelRenderer?.fieldState ?? {
    bounded: engine.bevelBoundingFieldEnabled,
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
    canvasWidth: engine.canvas.width,
    canvasHeight: engine.canvas.height,
    layerSize: DOCUMENT_MAX_EDGE,
    layerFormat: engine.layerFormat,
    layerMemoryMiB: layerStorageStudy.actualRawMiB,
    layerCount: engine.layerStack.count,
    activeLayerId: engine.layerStack.active.id,
    referenceLayerId: engine.layerStack.referenceLayerId,
    fillReferenceLayerStrategy: FILL_REFERENCE_LAYER_STRATEGY,
    fillReferenceLayerMiB:
      engine.layerStack.referenceLayerId !== null
        && engine.layerStack.referenceLayerId !== engine.layerStack.active.id
        ? layerBaseMemoryMiB(engine.layerFormat)
        : 0,
    layerBakeStrategy: LAYER_BAKE_STRATEGY,
    layerCompositeStrategy: LAYER_COMPOSITE_STRATEGY,
    layerStorageStudy,
    gpuLabel: engine.gpuLabel,
    effectsWorkingSetStrategy: EFFECTS_WORKING_SET_STRATEGY,
    effectsWorkingSetGeneration: engine.effectsWorkbench?.generation ?? 0,
    effectsWorkingSetSourceFormat: engine.effectsWorkbench?.sourceFormat ?? engine.layerFormat,
    effectsScratchPoolStrategy: EFFECTS_SCRATCH_POOL_STRATEGY,
    effectsScratchPoolCurrentBytes: effectsScratch?.currentBytes ?? 0,
    effectsScratchPoolPeakBytes: effectsScratch?.peakBytes ?? 0,
    effectsScratchPoolGeneration: effectsScratch?.generation ?? 0,
    effectsScratchPoolAllocationCount: effectsScratch?.allocationCount ?? 0,
    effectsScratchPoolShrinkCount: effectsScratch?.shrinkCount ?? 0,
    effectsScratchPoolRequirementsBytes: effectsScratch?.requirements ?? {},
    rasterColorOverlayStyle: copyRasterColorOverlayStyle(
      engine.rasterColorOverlayStyle,
    ),
    rasterColorOverlayStrategy: RASTER_COLOR_OVERLAY_STRATEGY,
    rasterColorOverlayScratchMemoryMiB: 0,
    timestampQueriesSupported: engine.device?.features.has("timestamp-query") ?? false,
    rasterStrokeRendererBuild: engine.rasterStrokeRenderer?.build ?? null,
    rasterStrokeStyle: copyRasterStrokeStyle(engine.rasterStrokeStyle),
    rasterStrokePersistentMemoryMiB:
      (engine.rasterStrokeRenderer?.persistentMemoryBytes ?? 0) / (1024 * 1024),
    rasterStrokeCoverageMemoryMiB:
      (engine.rasterStrokeRenderer?.coverageMemoryBytes ?? 0) / (1024 * 1024),
    rasterStrokeScratchMemoryMiB:
      (engine.rasterStrokeRenderer?.scratchMemoryBytes ?? 0) / (1024 * 1024),
    rasterStrokeCoverageStrategy: RASTER_STROKE_COVERAGE_STRATEGY,
    rasterStrokeGeometryStorageStrategy: RASTER_STROKE_GEOMETRY_STORAGE_STRATEGY,
    rasterStrokeGeometryResident: engine.rasterStrokeRenderer?.strokeGeometryEnabled ?? false,
    rasterStrokeStyledStorageStrategy: RASTER_STROKE_STYLED_STORAGE_STRATEGY,
    rasterStrokeDistanceStorageStrategy: RASTER_STROKE_DISTANCE_STORAGE_STRATEGY,
    rasterStrokeMutationGateStrategy: RASTER_STROKE_MUTATION_GATE_STRATEGY,
    rasterStrokeScratchStrategy: RASTER_STROKE_SCRATCH_STRATEGY,
    rasterStrokeScratchExtent: engine.rasterStrokeRenderer?.scratchExtent ?? 0,
    rasterStrokeScratchCompactMaxWidth: RASTER_STROKE_COMPACT_SCRATCH_MAX_WIDTH,
    dryBlendScratchLifecycleStrategy: DRY_BLEND_SCRATCH_LIFECYCLE_STRATEGY,
    rasterBevelRendererBuild: engine.rasterBevelRenderer?.build ?? null,
    rasterBevelStyle: copyRasterBevelStyle(engine.rasterBevelStyle),
    rasterBevelHeightMemoryMiB:
      (engine.rasterBevelRenderer?.heightMemoryBytes ?? 0) / MEBIBYTE_BYTES,
    rasterBevelScratchMemoryMiB:
      (engine.rasterBevelRenderer?.workspaceMemoryBytes ?? 0) / MEBIBYTE_BYTES,
    rasterBevelScratchExtent: engine.rasterBevelRenderer?.workspaceExtent ?? 0,
    rasterBevelFieldStrategy: engine.bevelBoundingFieldEnabled
      ? RASTER_BEVEL_BOUNDING_FIELD_STRATEGY
      : RASTER_BEVEL_FIELD_STRATEGY,
    rasterBevelBoundingFieldEnabled: engine.bevelBoundingFieldEnabled,
    rasterBevelFieldAllocationBounds: bevelField.allocationBounds,
    rasterBevelFieldValidBounds: bevelField.validBounds,
    rasterBevelFieldTextureWidth: bevelField.textureWidth,
    rasterBevelFieldTextureHeight: bevelField.textureHeight,
    rasterBevelFieldGeneration: bevelField.generation,
    rasterBevelFieldAllocationCount: bevelField.allocationCount,
    rasterBevelFieldShrinkCount: bevelField.shrinkCount,
    rasterBevelDistanceStrategy: RASTER_BEVEL_DISTANCE_STRATEGY,
    rasterBevelWorkspaceStrategy: RASTER_BEVEL_WORKSPACE_STRATEGY,
    rasterBevelHeightSourceMode: engine.rasterBevelHeightSourceMode,
    rasterOuterShadowRendererBuild: engine.rasterOuterShadowRenderer?.build ?? null,
    rasterOuterShadowStyle: copyRasterOuterShadowStyle(engine.rasterOuterShadowStyle),
    rasterOuterShadowMatteMemoryMiB:
      (engine.rasterOuterShadowRenderer?.coverageMemoryBytes ?? 0) / MEBIBYTE_BYTES,
    rasterOuterShadowControlMemoryMiB:
      (engine.rasterOuterShadowRenderer?.controlMemoryBytes ?? 0) / MEBIBYTE_BYTES,
    rasterOuterShadowScratchMemoryMiB:
      (engine.rasterOuterShadowRenderer?.workspaceMemoryBytes ?? 0) / MEBIBYTE_BYTES,
    rasterOuterShadowScratchExtent: engine.rasterOuterShadowRenderer?.workspaceExtent ?? 0,
    rasterOuterShadowStorageStrategy: RASTER_SHADOW_STORAGE_STRATEGY,
    rasterOuterShadowWorkspaceStrategy: RASTER_SHADOW_WORKSPACE_STRATEGY,
    rasterOuterShadowSourceMode: engine.rasterOuterShadowSourceMode,
    rasterInnerShadowRendererBuild: engine.rasterInnerShadowRenderer?.build ?? null,
    rasterInnerShadowStyle: copyRasterInnerShadowStyle(engine.rasterInnerShadowStyle),
    rasterInnerShadowMatteMemoryMiB:
      (engine.rasterInnerShadowRenderer?.coverageMemoryBytes ?? 0) / MEBIBYTE_BYTES,
    rasterInnerShadowControlMemoryMiB:
      (engine.rasterInnerShadowRenderer?.controlMemoryBytes ?? 0) / MEBIBYTE_BYTES,
    rasterInnerShadowScratchMemoryMiB:
      (engine.rasterInnerShadowRenderer?.workspaceMemoryBytes ?? 0) / MEBIBYTE_BYTES,
    rasterInnerShadowScratchExtent: engine.rasterInnerShadowRenderer?.workspaceExtent ?? 0,
    rasterInnerShadowStorageStrategy: RASTER_SHADOW_STORAGE_STRATEGY,
    rasterInnerShadowWorkspaceStrategy: RASTER_SHADOW_WORKSPACE_STRATEGY,
    rasterInnerShadowSourceMode: engine.rasterInnerShadowSourceMode,

    stampGeometry: engine.settings.shape === "shape" ? engine.lastStampGeometry : STAMP_GEOMETRY,
    stampVerticesPerCopy: engine.settings.shape === "shape"
      ? engine.lastStampVerticesPerCopy
      : STAMP_VERTICES_PER_COPY,
    fragmentCoverageStrategy: engine.settings.shape === "shape"
      ? SHAPE_FRAGMENT_COVERAGE_STRATEGY
      : CIRCLE_FRAGMENT_COVERAGE_STRATEGY,
    shapeSamplingStrategy: engine.settings.shape === "shape"
      ? engine.lastShapeSamplingStrategy
      : "none",
    shapeMaskDecodeStrategy: engine.shapeMaskDecodeStrategy,
    shapeOccupancyFallbackReason: engine.settings.shape === "shape"
      ? engine.lastShapeOccupancyFallbackReason
      : "none",
    shapeOccupancyGridSize: SHAPE_OCCUPANCY_GRID_SIZE,
    shapeOccupancyMipLevel: engine.settings.shape === "shape" ? engine.lastShapeOccupancyMipLevel : -1,
    shapeOccupancyActiveCells: engine.settings.shape === "shape" ? engine.lastShapeOccupancyActiveCells : 0,
    shapeOccupancyCoverageRatio: engine.settings.shape === "shape" ? engine.lastShapeOccupancyCoverageRatio : 0,
    shapeOccupancyCandidateMipLevel: engine.settings.shape === "shape"
      ? engine.lastShapeOccupancyCandidateMipLevel
      : -1,
    shapeOccupancyCandidateActiveCells: engine.settings.shape === "shape"
      ? engine.lastShapeOccupancyCandidateActiveCells
      : 0,
    shapeOccupancyCandidateCoverageRatio: engine.settings.shape === "shape"
      ? engine.lastShapeOccupancyCandidateCoverageRatio
      : 0,
    shapeOccupancyMaximumMip: SHAPE_OCCUPANCY_MAX_MIP,
    shapeOccupancyMinimumRadius: SHAPE_OCCUPANCY_MIN_RADIUS,
    shapeOccupancyMaximumCoverageRatio: SHAPE_OCCUPANCY_MAX_COVERAGE_RATIO,
    shapeOccupancyBitmaskBytes: SHAPE_OCCUPANCY_MAP_BYTES,
    shapeMaskResident: engine.shapeResident,
    shapeStorageLifecycleStrategy: SHAPE_STORAGE_LIFECYCLE_STRATEGY,
    colorSeedStrategy: COLOR_SEED_STRATEGY,
    dirtyRectStrategy: DIRTY_RECT_STRATEGY,
    strokeCurveStrategy: STROKE_CURVE_STRATEGY,
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
    paintDisplaySelectedMipLevel: engine.paintDisplaySelectedMipLevel,
    paintDisplayPyramidAdditionalMemoryMiB:
      paintDisplayPyramidAdditionalMemoryMiB(engine.layerFormat),
    brushOpacityStrategy: BRUSH_OPACITY_STRATEGY,
    grainStrategy: engine.grainStrategy(engine.settings),
    grainCoordinateStrategy: engine.grainCoordinateStrategy(engine.settings),
    grainSamplingStrategy: engine.grainSamplingStrategy(engine.settings),
    grainMipStrategy: GRAIN_MIP_STRATEGY,
    grainTextureFormat: "r16float",
    grainTextureWidth: engine.grainTextureWidth,
    grainTextureHeight: engine.grainTextureHeight,
    grainTextureMipLevelCount: engine.grainTextureMipLevelCount,
    grainTextureMemoryMiB: engine.grainTextureMemoryBytes / MEBIBYTE_BYTES,
    grainTextureIdentity: engine.grainTextureIdentity,
    grainPipelineStrategy: GRAIN_PIPELINE_STRATEGY,
    grainCoverageStrategy: isTexturizedGrainActive(engine.settings)
      ? GRAIN_COVERAGE_STRATEGY
      : "none",
    grainAdaptivePreviewStrategy: isTexturizedGrainActive(engine.settings)
      ? GRAIN_ADAPTIVE_PREVIEW_STRATEGY
      : "legacy",
    grainStartupDecodeMs: engine.grainStartupDecodeMs,
    grainStartupMipBuildMs: engine.grainStartupMipBuildMs,
    grainStartupUploadMs: engine.grainStartupUploadMs,
    grainTextureResident: engine.grainResident,
    grainStorageLifecycleStrategy: GRAIN_STORAGE_LIFECYCLE_STRATEGY,
    lightGlazeStrategy: lightGlazeStrategyForBlendMode(engine.settings.blendMode),
    lightGlazeAdaptivePreviewStrategy: LIGHT_GLAZE_ADAPTIVE_PREVIEW_STRATEGY,
    lightGlazeStorageAllocated: engine.lightGlazeStorageAllocated,
    lightGlazeStorageMode: engine.lightGlazeStorageMode,
    lightGlazeCommitStrategy: engine.lightGlazeStorageMode === "r16float-coverage"
      ? "fixed-function-render-target"
      : engine.lightGlazeInPlaceCommitPipeline && engine.lightGlazeInPlaceCommitBindGroup
        ? "compute-in-place-read-write-storage"
        : "render-copy-scratch-tile",
    lightGlazeAdditionalMemoryMiB: engine.lightGlazeStorageAllocated
      ? lightGlazeAdditionalMemoryMiB(
        engine.layerFormat,
        engine.lightGlazeStorageMode,
        undefined,
        Boolean(engine.lightGlazeCommitTileTexture),
      )
      : 0,
    lightGlazeStorageLifecycleStrategy: LIGHT_GLAZE_STORAGE_LIFECYCLE_STRATEGY,
    adaptivePreviewStrategy: ADAPTIVE_PREVIEW_STRATEGY,
    adaptivePreviewTriggerStrategy: ADAPTIVE_PREVIEW_TRIGGER_STRATEGY,
    adaptivePreviewStaleFrameStrategy: ADAPTIVE_PREVIEW_STALE_FRAME_STRATEGY,
    adaptivePreviewVisibleCanvasStrategy: ADAPTIVE_PREVIEW_VISIBLE_CANVAS_STRATEGY,
    adaptivePreviewVisibleCanvasRequestedDesynchronized:
      engine.adaptivePreviewVisibleCanvasRequestedDesynchronized,
    adaptivePreviewVisibleCanvasAlpha: engine.adaptivePreviewVisibleContextAttributes.alpha,
    adaptivePreviewVisibleCanvasDesynchronized:
      engine.adaptivePreviewVisibleContextAttributes.desynchronized,
    adaptivePreviewVisibleCanvasColorSpace:
      engine.adaptivePreviewVisibleContextAttributes.colorSpace,
    adaptivePreviewScratchCanvasAlpha: engine.adaptivePreviewScratchContextAttributes.alpha,
    adaptivePreviewScratchCanvasDesynchronized:
      engine.adaptivePreviewScratchContextAttributes.desynchronized,
    adaptivePreviewScratchCanvasColorSpace:
      engine.adaptivePreviewScratchContextAttributes.colorSpace,
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
    adaptiveSpacingMaxExtraPercentPoints: engine.adaptiveSpacingMaxExtraPercentPoints,
    historyStorageStrategy: HISTORY_STORAGE_STRATEGY,
    historyReplayStrategy: HISTORY_REPLAY_STRATEGY,
    historyStampRetentionStrategy: HISTORY_STAMP_RETENTION_STRATEGY,
  };
}

export function getStats(engine: BrushEngine): EngineStats {
  const now = performance.now();
  engine.renderTimestamps = engine.renderTimestamps.filter((timestamp) => now - timestamp <= 1000);
  const gpuMemory = getGpuMemoryStats(engine);
  const layerStorageStudy = getLayerStorageStudy(engine);
  const effectsScratch = engine.effectsWorkbench?.scratchPool.snapshot();
  return {
    fps: engine.renderTimestamps.length,
    lastCpuFrameMs: engine.lastCpuFrameMs,
    totalBaseStamps: engine.totalBaseStamps,
    avoidedLogicalDraws: engine.avoidedLogicalDraws,
    layerMemoryMiB:
      gpuMemory.layerBaseMiB
      + gpuMemory.layerColdMiB
      + gpuMemory.layerHydrationMiB,
    mixedScene: engine.createMixedSceneSnapshot(),
    layerCount: engine.layerStack.count,
    documentBackground: { ...engine.documentBackground },
    activeLayerId: engine.layerStack.active.id,
    referenceLayerId: engine.layerStack.referenceLayerId,
    fillReferenceLayerStrategy: FILL_REFERENCE_LAYER_STRATEGY,
    fillReferenceLayerMiB:
      engine.layerStack.referenceLayerId !== null
        && engine.layerStack.referenceLayerId !== engine.layerStack.active.id
        ? layerBaseMemoryMiB(engine.layerFormat)
        : 0,
    layerBakeStrategy: LAYER_BAKE_STRATEGY,
    layerCompositeStrategy: LAYER_COMPOSITE_STRATEGY,
    layerStorageStudy,
    layers: engine.layerStack.layers.map((record, index) => {
      const gpu = engine.layerGpu.get(record.id);
      const storage = layerStorageStudy.layers[index];
      return {
        id: record.id,
        name: record.name,
        visible: record.visible,
        opacity: record.opacity,
        contentOpacity: record.contentOpacity,
        blendMode: record.blendMode,
        cutoutMode: record.cutoutMode,
        tonalBlend: {
          current: [...record.tonalBlend.current],
          underlying: [...record.tonalBlend.underlying],
        },
        reference: record.id === engine.layerStack.referenceLayerId,
        clippingParentId: record.clippingParentId,
        // The record's copy is only written back when the layer stops being
        // active, so for the active one the engine field is the live truth.
        // Reading the record here would report "empty" while the user paints.
        hasContent: record.id === engine.layerStack.active.id
          ? engine.layerHasContent
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
    activeLayerIndex: engine.layerStack.activeIndex,
    layerColdCompressionEnabled: engine.layerColdCompressionEnabled,
    layerColdCompressionStatusEnabled:
      engine.layerColdCompressionStatusEnabled,
    layerColdDirectHotHydrationEnabled:
      engine.layerColdDirectHotHydrationEnabled,
    layerColdTileCompositeEnabled: engine.layerColdTileCompositeEnabled,
    layerColdTileComposite: {
      foldCount: engine.layerColdTileCompositeFoldCount,
      residentFoldCount: engine.layerColdTileCompositeResidentFoldCount,
      compressedFoldCount: engine.layerColdTileCompositeCompressedFoldCount,
      tileCount: engine.layerColdTileCompositeTileCount,
      submissionCount: engine.layerColdTileCompositeSubmissionCount,
      scratchActiveMiB:
        engine.layerColdTileCompositeScratchActiveBytes / MEBIBYTE_BYTES,
      scratchPeakMiB:
        engine.layerColdTileCompositeScratchPeakBytes / MEBIBYTE_BYTES,
      avoidedHydrationMiB:
        engine.layerColdTileCompositeAvoidedHydrationBytes / MEBIBYTE_BYTES,
    },
    layerColdAdjacentPrefetchEnabled: engine.layerColdAdjacentPrefetchEnabled,
    layerColdCompressionDistantGpuMiB: engine.layerColdCompressionEnabled
      ? engine.layerColdCompressionDistantGpuBytes() / MEBIBYTE_BYTES
      : 0,
    layerColdCompressionRuntimeBuild: engine.layerColdCompressionEnabled
      ? LAYER_COLD_COMPRESSION_RUNTIME_BUILD
      : null,
    layerColdCompressionWorkerUnavailable: engine.layerColdCompressionWorkerUnavailable,
    layerColdCompressionProgress: engine.layerColdCompressionProgress
      ? {
        layerId: engine.layerColdCompressionProgress.record.id,
        completedTileCount: engine.layerColdCompressionProgress.nextArrayLayer,
        totalTileCount: engine.layerColdCompressionProgress.cold.tileIndices.length,
        storedCpuMiB: engine.layerColdCompressionProgress.storedBytes / MEBIBYTE_BYTES,
        pausedByStroke: engine.activeStroke !== null,
      }
      : null,
    rasterColorOverlayStyle: copyRasterColorOverlayStyle(
      engine.rasterColorOverlayStyle,
    ),
    rasterColorOverlayStrategy: RASTER_COLOR_OVERLAY_STRATEGY,
    rasterColorOverlayScratchMemoryMiB: 0,
    rasterStrokeStyle: copyRasterStrokeStyle(engine.rasterStrokeStyle),
    rasterStrokePersistentMemoryMiB:
      (engine.rasterStrokeRenderer?.persistentMemoryBytes ?? 0) / MEBIBYTE_BYTES,
    rasterStrokeScratchMemoryMiB:
      (engine.rasterStrokeRenderer?.scratchMemoryBytes ?? 0) / MEBIBYTE_BYTES,
    rasterStrokeBuilds: engine.rasterStrokeTotalBuilds,
    rasterStrokeComposes: engine.rasterStrokeTotalComposes,
    rasterStrokeRendererBuild: engine.rasterStrokeRenderer?.build ?? null,
    rasterBevelStyle: copyRasterBevelStyle(engine.rasterBevelStyle),
    rasterBevelPersistentMemoryMiB: (
      (engine.rasterBevelRenderer?.heightMemoryBytes ?? 0)
      + (engine.rasterBevelRenderer?.lutMemoryBytes ?? 0)
      + (engine.rasterBevelRenderer?.controlMemoryBytes ?? 0)
    ) / MEBIBYTE_BYTES,
    rasterBevelScratchMemoryMiB:
      (engine.rasterBevelRenderer?.workspaceMemoryBytes ?? 0) / MEBIBYTE_BYTES,
    rasterBevelBuilds: engine.rasterBevelTotalBuilds,
    rasterBevelPasses: engine.rasterBevelTotalPasses,
    rasterBevelRendererBuild: engine.rasterBevelRenderer?.build ?? null,
    rasterOuterShadowStyle: copyRasterOuterShadowStyle(engine.rasterOuterShadowStyle),
    rasterOuterShadowPersistentMemoryMiB: (
      (engine.rasterOuterShadowRenderer?.coverageMemoryBytes ?? 0)
      + (engine.rasterOuterShadowRenderer?.controlMemoryBytes ?? 0)
    ) / MEBIBYTE_BYTES,
    rasterOuterShadowScratchMemoryMiB:
      (engine.rasterOuterShadowRenderer?.workspaceMemoryBytes ?? 0) / MEBIBYTE_BYTES,
    rasterOuterShadowBuilds: engine.rasterOuterShadowTotalBuilds,
    rasterOuterShadowPasses: engine.rasterOuterShadowTotalPasses,
    rasterOuterShadowRendererBuild: engine.rasterOuterShadowRenderer?.build ?? null,
    rasterInnerShadowStyle: copyRasterInnerShadowStyle(engine.rasterInnerShadowStyle),
    rasterInnerShadowPersistentMemoryMiB: (
      (engine.rasterInnerShadowRenderer?.coverageMemoryBytes ?? 0)
      + (engine.rasterInnerShadowRenderer?.controlMemoryBytes ?? 0)
    ) / MEBIBYTE_BYTES,
    rasterInnerShadowScratchMemoryMiB:
      (engine.rasterInnerShadowRenderer?.workspaceMemoryBytes ?? 0) / MEBIBYTE_BYTES,
    rasterInnerShadowBuilds: engine.rasterInnerShadowTotalBuilds,
    rasterInnerShadowPasses: engine.rasterInnerShadowTotalPasses,
    rasterInnerShadowRendererBuild: engine.rasterInnerShadowRenderer?.build ?? null,
    effectsWorkingSetStrategy: EFFECTS_WORKING_SET_STRATEGY,
    effectsWorkingSetGeneration: engine.effectsWorkbench?.generation ?? 0,
    effectsWorkingSetSourceFormat: engine.effectsWorkbench?.sourceFormat ?? engine.layerFormat,
    effectsScratchPoolStrategy: EFFECTS_SCRATCH_POOL_STRATEGY,
    effectsScratchPoolCurrentMiB: gpuMemory.effectsScratchPoolMiB,
    effectsScratchPoolPeakMiB: gpuMemory.effectsScratchPoolPeakMiB,
    effectsScratchPoolGeneration: effectsScratch?.generation ?? 0,
    effectsScratchPoolAllocationCount: effectsScratch?.allocationCount ?? 0,
    effectsScratchPoolShrinkCount: effectsScratch?.shrinkCount ?? 0,
    gpuMemory,
    gpuLabel: engine.gpuLabel,
    layerFormat: engine.layerFormat,
  };
}

export function getGpuMemoryStats(engine: BrushEngine): EngineGpuMemoryStats {
  const baseResourcesAllocated = engine.initialized;
  const registered = engine.gpuResourceRegistry.snapshot();
  const registeredCurrentMiB = registered.currentBytes / MEBIBYTE_BYTES;
  const registeredPeakMiB = registered.peakBytes / MEBIBYTE_BYTES;
  const registeredCategories = registered.categories.map((entry) => ({
    category: entry.category,
    currentMiB: entry.bytes / MEBIBYTE_BYTES,
    peakMiB: entry.peakBytes / MEBIBYTE_BYTES,
    count: entry.count,
  }));
  const bytesPerPixel = engine.layerFormat === "rgba16float" ? 8 : 4;
  const rasterStroke = engine.rasterStrokeRenderer;
  const rasterBevel = engine.rasterBevelRenderer;
  const rasterOuterShadow = engine.rasterOuterShadowRenderer;
  const rasterInnerShadow = engine.rasterInnerShadowRenderer;
  const effectsScratch = engine.effectsWorkbench?.scratchPool.snapshot();
  // Exactly one active layer owns a full authoritative mip 0 at idle. Inactive
  // layers keep only their conservative 256px tiles. A second full texture may
  // exist briefly while a hydration/switch transaction is still reversible.
  const fullLayerMiB = layerBaseMemoryMiB(engine.layerFormat);
  const hotLayerCount = [...engine.layerGpu.values()].reduce(
    (count, gpu) => count + (gpu.hot ? 1 : 0),
    0,
  );
  const layerBaseMiB = baseResourcesAllocated
    ? fullLayerMiB * hotLayerCount
    : 0;
  const layerColdMiB = baseResourcesAllocated
    ? [...engine.layerGpu.values()].reduce(
      (total, gpu) => total + (gpu.cold?.memoryBytes ?? 0),
      0,
    ) / MEBIBYTE_BYTES
    : 0;
  const retainedCompressedLayerStores = engine.retainedCompressedLayerStores();
  const layerCompressedCpuMiB = (
    [...retainedCompressedLayerStores].reduce(
      (total, compressed) => total + compressed.storedBytes,
      0,
    ) + (engine.layerColdCompressionProgress?.storedBytes ?? 0)
  ) / MEBIBYTE_BYTES;
  const layerCompressedRawMiB = [...retainedCompressedLayerStores].reduce(
    (total, compressed) => total + compressed.rawBytes,
    0,
  ) / MEBIBYTE_BYTES;
  // Peso per singolo livello. Le righe aggregate sopra rispondono "quanto
  // pesano i livelli"; questa risponde "quale", che e' la domanda vera quando
  // la memoria sale e non si sa perche'. I byte vengono dalle stesse fonti del
  // totale, cosi' la somma di queste righe non puo' divergere da quelle.
  const activeLayerIndex = engine.layerStack.activeIndex;
  const displayPyramidMiB = paintDisplayPyramidAdditionalMemoryMiB(engine.layerFormat);
  const perLayerMemory = baseResourcesAllocated
    ? engine.layerStack.layers.map((record, index) => {
      const gpu = engine.layerGpu.get(record.id);
      const active = index === activeLayerIndex;
      const hotMiB = gpu?.hot ? fullLayerMiB : 0;
      // La piramide display segue il livello attivo, non ogni livello caldo:
      // caricarla su tutti farebbe mentire la riga.
      const mipMiB = gpu?.hot && active ? displayPyramidMiB : 0;
      const coldMiB = (gpu?.cold?.memoryBytes ?? 0) / MEBIBYTE_BYTES;
      const compressedStores = new Set([
        gpu?.compressed,
        engine.restoredProjectHistoryBaselines.get(record.id)?.compressed,
      ].filter((compressed) => compressed !== null && compressed !== undefined));
      const compressedCpuMiB = [...compressedStores].reduce(
        (total, compressed) => total + compressed.storedBytes,
        0,
      ) / MEBIBYTE_BYTES;
      const compressedRawMiB = [...compressedStores].reduce(
        (total, compressed) => total + compressed.rawBytes,
        0,
      ) / MEBIBYTE_BYTES;
      const gpuMiB = hotMiB + mipMiB + coldMiB;
      const state: LayerMemoryState = gpu?.hot
        ? "hot"
        : gpu?.cold
        ? "cold"
        : gpu?.compressed
        ? "compressed"
        : "empty";
      return {
        id: record.id,
        index,
        name: record.name,
        active,
        visible: record.visible,
        state,
        hotMiB,
        mipMiB,
        coldMiB,
        compressedCpuMiB,
        compressedRawMiB,
        gpuMiB,
        totalMiB: gpuMiB + compressedCpuMiB,
      };
    })
    : [];

  const layerHydrationMiB = (
    [...engine.liveLayerHydrationTextures.values()].reduce(
      (total, bytes) => total + bytes,
      0,
    ) + engine.layerColdRestoreActiveBytes
      + engine.layerColdTileCompositeScratchActiveBytes
  ) / MEBIBYTE_BYTES;
  // Exactly one full raw-layer pyramid follows the active layer. Mixed-scene
  // merged sides report their real cropped mip bytes instead of charging a
  // full `LAYER_SIZE²` chain per side.
  const activeClippingSurfaces = new Set(
    [
      engine.activeClippingGroup?.prefix,
      engine.activeClippingGroup?.suffix,
      ...(engine.activeClippingGroup?.suffixSteps.map((step) => step.surface) ?? []),
    ].filter((surface): surface is NonNullable<typeof surface> => Boolean(surface)),
  );
  const mergedSurfaces = [...engine.liveMergedSurfaceTextures.values()].filter(
    (surface) => !activeClippingSurfaces.has(surface),
  );
  const mergedMipChainMiB = mergedSurfaces.reduce(
    (total, surface) => total + surface.mipChainMemoryBytes,
    0,
  ) / MEBIBYTE_BYTES;
  const layerMipChainMiB = baseResourcesAllocated
    ? paintDisplayPyramidAdditionalMemoryMiB(engine.layerFormat) + mergedMipChainMiB
    : 0;
  // Per-layer analytic bakes exist only inside a transaction. Merged mip 0
  // is accounted from its actual allocation bounds, including candidates.
  const transientBakeMiB = [...engine.liveLayerBakeTextures.values()].reduce(
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
  const grainTextureMiB = baseResourcesAllocated && engine.grainResident
    ? engine.grainTextureMemoryBytes / MEBIBYTE_BYTES
    : 0;
  const shapeTextureMiB = baseResourcesAllocated && engine.shapeResident
    ? shapeTextureMemoryMiB()
    : 0;
  const paintBuffersMiB = baseResourcesAllocated ? staticPaintBufferMemoryMiB() : 0;
  const presentationCacheMiB = engine.presentationCacheTexture
    ? engine.presentationCacheWidth * engine.presentationCacheHeight * 4 / MEBIBYTE_BYTES
    : 0;
  const layerThumbnailMiB =
    (engine.layerThumbnailRenderer?.residentBytes ?? 0) / MEBIBYTE_BYTES;
  const vectorTextRunResources = [...engine.vectorTextRunTextures.values()];
  const vectorTextLegacyTextureCount = Number(Boolean(engine.vectorTextBelowTexture))
    + Number(Boolean(engine.vectorTextAboveTexture));
  const vectorTextLegacyBytes = vectorTextLegacyTextureCount
    * engine.vectorTextTextureWidth
    * engine.vectorTextTextureHeight
    * VECTOR_TEXT_GPU_TARGET_BYTES_PER_PIXEL;
  const vectorTextRunBytes = vectorTextRunResources.length
    * VECTOR_TEXT_RUN_CACHE_UNIFORM_BYTES
    + vectorTextRunResources.reduce(
      (total, resources) => total
        + resources.textureBounds.width
        * resources.textureBounds.height
        * VECTOR_TEXT_GPU_TARGET_BYTES_PER_PIXEL
        + (resources.fallbackBounds
          ? resources.fallbackBounds.width
            * resources.fallbackBounds.height
            * VECTOR_TEXT_GPU_TARGET_BYTES_PER_PIXEL
          : 0),
      0,
    );
  const vectorTextViewportMiB =
    (vectorTextLegacyBytes + vectorTextRunBytes) / MEBIBYTE_BYTES;
  const vectorTextBlurMiB =
    engine.vectorTextGpuBlurMemoryBytes() / MEBIBYTE_BYTES;
  const vectorTextGpuScratchMiB = engine.vectorTextGpuMsaaTexture
    ? engine.vectorTextGpuScratchWidth * engine.vectorTextGpuScratchHeight
      * VECTOR_TEXT_GPU_TARGET_BYTES_PER_PIXEL * (VECTOR_TEXT_GPU_SAMPLE_COUNT + 1)
      / MEBIBYTE_BYTES
    : 0;
  const vectorTextGpuGeometryMiB = [...engine.vectorTextGpuMeshes.values()]
    .reduce((total, resources) => total + resources.memoryBytes, 0)
    / MEBIBYTE_BYTES;

  // The ordered scene owns one RGBA16F canonical cache. When semantic nodes
  // keep advanced layer blending on the viewport path it also owns bounded
  // scratch roles for ping-pong, operands, authored matte, clipping state and
  // the immutable Deep floor. Count every texture that is actually resident.
  // The raster-only path instead owns the bounded native-format compositor:
  // three 1024² tiles plus its GPU uniform rings. Count the resources that
  // are actually resident, rather than inferring them from the current mode.
  const mixedSceneTextureCount = Number(Boolean(engine.mixedSceneLinearTexture))
    + Number(Boolean(engine.mixedSceneBlendScratchTexture))
    + Number(Boolean(engine.mixedSceneBlendOperandTexture))
    + Number(Boolean(engine.mixedSceneBlendCutoutTexture))
    + Number(Boolean(engine.mixedSceneBlendGroupTexture))
    + Number(Boolean(engine.mixedSceneBlendClippingBaseTexture))
    + Number(Boolean(engine.mixedSceneBlendDocumentMaskTexture))
    + Number(Boolean(engine.mixedSceneBlendDeepFloorTexture));
  const mixedSceneLinearMiB = mixedSceneTextureCount
    * engine.mixedSceneLinearWidth * engine.mixedSceneLinearHeight
    * 8 / MEBIBYTE_BYTES;
  const layerBlendTileCompositorMiB =
    (engine.layerBlendTileCompositor?.stableMemoryBytes ?? 0) / MEBIBYTE_BYTES;
  const layerBlendCompositorControlMiB = engine.layerBlendCompositorUniformBuffer
    ? engine.layerBlendCompositorUniformStride * LAYER_BLEND_MODE_ORDER.length
      * 2 / MEBIBYTE_BYTES
    : 0;
  const vectorTextPresentationMiB =
    vectorTextViewportMiB
    + vectorTextBlurMiB
    + vectorTextGpuScratchMiB
    + vectorTextGpuGeometryMiB
    + mixedSceneLinearMiB
    + layerBlendTileCompositorMiB
    + layerBlendCompositorControlMiB;
  const rasterImageMiB = (
    rasterImageGpuMemoryBytes(engine)
    + (engine.activeRasterTransformSession?.memoryBytes ?? 0)
    + (engine.activeRasterGaussianBlurSession?.memoryBytes ?? 0)
    + (engine.activeRasterMotionBlurSession?.memoryBytes ?? 0)
    + (engine.activeRasterNoiseSession?.memoryBytes ?? 0)
    + (engine.activeRasterGlassSession?.memoryBytes ?? 0)
    + (engine.activeRasterLiquifySession?.memoryBytes ?? 0)
  ) / MEBIBYTE_BYTES;
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
    bounded: engine.bevelBoundingFieldEnabled,
    allocationBounds: null,
    validBounds: null,
    textureWidth: 0,
    textureHeight: 0,
    memoryBytes: 0,
    generation: 0,
    allocationCount: 0,
    shrinkCount: 0,
  };
  const blendRendererMiB = engine.blendRenderer?.allocatedMemoryMiB() ?? 0;
  const fillRendererMiB = (engine.fillRenderer?.residentBytes ?? 0) / MEBIBYTE_BYTES;
  const selectionRendererMiB =
    (engine.selectionRenderer?.residentBytes ?? 0) / MEBIBYTE_BYTES;
  const lightGlazeMiB = engine.lightGlazeStorageAllocated
    ? lightGlazeAdditionalMemoryMiB(
      engine.layerFormat,
      engine.lightGlazeStorageMode,
      undefined,
      Boolean(engine.lightGlazeCommitTileTexture),
    )
    : 0;
  // Compatibility field name: it now accounts for the cropped RGBA prefix,
  // aggregated Normal suffix, or ordered mip-0 child operands of the live
  // clipping group. Those surfaces are excluded from the generic merged rows
  // above so the total is never counted twice.
  const activeClippingMaskMiB = [...activeClippingSurfaces].reduce(
    (total, surface) => total + surface.mip0MemoryBytes + surface.mipChainMemoryBytes,
    0,
  ) / MEBIBYTE_BYTES;
  const stabilizationTailBytesPerPixel = engine.stabilizationSnapshotStorageMode
    === "r16float-coverage" ? 2 : 8;
  const stabilizationTailMiB = engine.stabilizationSnapshotTexture
    ? engine.stabilizationSnapshotWidth * engine.stabilizationSnapshotHeight
      * stabilizationTailBytesPerPixel / MEBIBYTE_BYTES
    : 0;
  const thicknessTailMiB = engine.thicknessTailTexture
    ? engine.thicknessTailTextureWidth * engine.thicknessTailTextureHeight
      * bytesPerPixel / MEBIBYTE_BYTES
    : 0;
  const historyGpu = engine.historyGpuStorage?.stats() ?? {
    allocatedBytes: 0,
    usedLogicalBytes: 0,
    pageCount: 0,
  };
  // Incremental maintenance owns the physical seed ledger. Reading memory
  // stats must not rescan a 1000-action journal on every publishStats call.
  const historyRasterSeedBytes = historyCheckpointAllocatedBytes(engine);
  const historyGpuMiB = (historyGpu.allocatedBytes + historyRasterSeedBytes) / MEBIBYTE_BYTES;
  const historyGpuUsedMiB =
    (historyGpu.usedLogicalBytes + historyRasterSeedBytes) / MEBIBYTE_BYTES;
  const countedTotalMiB = [
    layerBaseMiB,
    layerMipChainMiB,
    layerColdMiB,
    activeClippingMaskMiB,
    layerHydrationMiB,
    layerBakeMiB,
    layerCompositeMiB,
    grainTextureMiB,
    shapeTextureMiB,
    paintBuffersMiB,
    presentationCacheMiB,
    layerThumbnailMiB,
    vectorTextPresentationMiB,
    rasterImageMiB,
    rasterStrokeStyledMiB,
    rasterStrokeCoverageMiB,
    rasterStrokeMaskAndControlMiB,
    effectsScratchPoolMiB,
    blendRendererMiB,
    fillRendererMiB,
    selectionRendererMiB,
    lightGlazeMiB,
    stabilizationTailMiB,
    thicknessTailMiB,
    rasterBevelHeightMiB,
    rasterBevelLutAndControlMiB,
    rasterOuterShadowMatteMiB,
    historyGpuMiB,
    rasterOuterShadowControlMiB,
    rasterInnerShadowMatteMiB,
    rasterInnerShadowControlMiB,
  ].reduce((total, value) => total + value, 0);
  const countedGpuPlusCompressedCpuMiB = countedTotalMiB + layerCompressedCpuMiB;

  // Stato del governor, per ora in sola osservazione: nessuna allocazione viene
  // ancora rifiutata. Serve a calibrare, ed e' l'ordine giusto — un tetto che
  // rifiuta prima di essere stato misurato su dispositivi veri rompe l'app in
  // scenari legittimi. I byte vengono dal registro, non dal modello dichiarato.
  //
  // Il liberabile conta solo cio' che il motore sa gia' ricostruire dai pixel
  // autorevoli: cache di presentazione, miniature e superfici merged. La RAM
  // dei cold compressi resta fuori finche' non esiste un livello sotto verso
  // cui sfogarla: senza storage non e' liberabile, e' soltanto perdibile.
  const governorReclaimableBytes = Math.round(
    (presentationCacheMiB + layerThumbnailMiB + layerCompositeMiB) * MEBIBYTE_BYTES,
  );
  const governorLedger = {
    committedBytes: registered.currentBytes,
    reservedBytes: engine.memoryReservations.pendingBytes,
    reclaimableBytes: Math.min(governorReclaimableBytes, registered.currentBytes),
    inFlightBytes: Math.round(layerCompressedCpuMiB * MEBIBYTE_BYTES),
  };
  const governorLimits = engine.memoryGovernorLimits;
  const governorUsedBytes = memoryLedgerUsedBytes(governorLedger);
  const governorZone: MemoryZone = memoryZoneFor(governorLedger, governorLimits);
  const governorCeilingBytes =
    governorLimits.hardCapBytes - governorLimits.emergencyReserveBytes;

  return {
    layers: perLayerMemory,
    governorZone,
    governorHardCapMiB: governorLimits.hardCapBytes / MEBIBYTE_BYTES,
    governorCeilingMiB: governorCeilingBytes / MEBIBYTE_BYTES,
    governorUsedMiB: governorUsedBytes / MEBIBYTE_BYTES,
    governorHeadroomMiB: (governorCeilingBytes - governorUsedBytes) / MEBIBYTE_BYTES,
    governorReclaimableMiB: governorLedger.reclaimableBytes / MEBIBYTE_BYTES,
    governorReservedMiB: governorLedger.reservedBytes / MEBIBYTE_BYTES,
    registeredCurrentMiB,
    registeredPeakMiB,
    registeredTextureCount: registered.textureCount,
    registeredBufferCount: registered.bufferCount,
    registeredUnmeasurableCount: registered.unmeasurableCount,
    registeredCategories,
    layerBaseMiB,
    layerMipChainMiB,
    layerColdMiB,
    activeClippingMaskMiB,
    layerCompressedCpuMiB,
    layerCompressedRawMiB,
    layerHydrationMiB,
    layerBakeMiB,
    layerCompositeMiB,
    grainTextureMiB,
    shapeTextureMiB,
    paintBuffersMiB,
    presentationCacheMiB,
    layerThumbnailMiB,
    vectorTextPresentationMiB,
    rasterImageMiB,
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
    fillRendererMiB,
    selectionRendererMiB,
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
    lightGlazeTransitionPeakMiB: engine.lightGlazeTransitionPeakMiB,
    stabilizationTailMiB,
    thicknessTailMiB,
    historyGpuMiB,
    historyGpuUsedMiB,
    historyGpuPageCount: historyGpu.pageCount,
    countedTotalMiB,
    countedGpuPlusCompressedCpuMiB,
  };
}

export function finishStrokePerformanceProfile(engine: BrushEngine): StrokePerformanceProfile | null {
  const profile = engine.activeStrokeProfile;
  engine.activeStrokeProfile = null;
  if (!profile) {
    return null;
  }
  const averageRenderIntervalMs = average(profile.renderIntervalMs);

  return {
    stampGeometry: profile.stampGeometry,
    stampVerticesPerCopy: profile.stampVerticesPerCopy,
    fragmentCoverageStrategy: profile.fragmentCoverageStrategy,
    shapeSamplingStrategy: profile.shapeSamplingStrategy,
    shapeMaskDecodeStrategy: engine.shapeMaskDecodeStrategy,
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
    strokeCurveStrategy: STROKE_CURVE_STRATEGY,
    strokeStabilizationStrategy: STROKE_STABILIZATION_STRATEGY,
    strokeStabilizationAmount: profile.strokeStabilizationAmount,
    strokeStabilizationInputSamples: profile.strokeStabilizationInputSamples,
    strokeStabilizationMaturePoints: profile.strokeStabilizationMaturePoints,
    strokeStabilizationForcedMaturePoints:
      profile.strokeStabilizationForcedMaturePoints,
    strokeStabilizationMaximumTailPoints:
      profile.strokeStabilizationMaximumTailPoints,
    strokeStabilizationTailFrames: profile.strokeStabilizationTailFrames,
    strokeStabilizationTailBaseStamps: profile.strokeStabilizationTailBaseStamps,
    strokeStabilizationTailPhysicalCopies:
      profile.strokeStabilizationTailPhysicalCopies,
    strokeStabilizationMaximumSnapshotPixels:
      profile.strokeStabilizationMaximumSnapshotPixels,
    strokeStabilizationAdditionalMemoryMiB:
      profile.strokeStabilizationMaximumSnapshotBytes / MEBIBYTE_BYTES,
    strokeCurveInputSegments: profile.strokeCurveInputSegments,
    strokeCurveSmoothedSegments: profile.strokeCurveSmoothedSegments,
    strokeCurveFlattenedSegments: profile.strokeCurveFlattenedSegments,
    strokeCurveSharpCornerBypasses: profile.strokeCurveSharpCornerBypasses,
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
      * (engine.layerFormat === "rgba16float" ? 8 : 4)
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
    paintDisplaySelectedMipLevel: engine.paintDisplaySelectedMipLevel,
    paintDisplayMaximumSelectedMipLevel: profile.paintDisplayMaximumSelectedMipLevel,
    paintDisplayPyramidAdditionalMemoryMiB:
      paintDisplayPyramidAdditionalMemoryMiB(engine.layerFormat),
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
    grainTextureFormat: "r16float",
    grainTextureWidth: engine.grainTextureWidth,
    grainTextureHeight: engine.grainTextureHeight,
    grainTextureMipLevelCount: engine.grainTextureMipLevelCount,
    grainTextureMemoryMiB: engine.grainTextureMemoryBytes / MEBIBYTE_BYTES,
    grainTextureIdentity: engine.grainTextureIdentity,
    grainPipelineStrategy: GRAIN_PIPELINE_STRATEGY,
    grainCoverageStrategy: profile.grainCoverageStrategy,
    grainAdaptivePreviewStrategy: profile.grainAdaptivePreviewStrategy,
    grainStartupDecodeMs: engine.grainStartupDecodeMs,
    grainStartupMipBuildMs: engine.grainStartupMipBuildMs,
    grainStartupUploadMs: engine.grainStartupUploadMs,
    grainBatches: profile.grainBatches,
    grainBaseStamps: profile.grainBaseStamps,
    grainPhysicalCopies: profile.grainPhysicalCopies,
    grainCircleBatches: profile.grainCircleBatches,
    grainShapeBatches: profile.grainShapeBatches,
    grainAdaptivePreviewSkips: profile.grainAdaptivePreviewSkips,
    lightGlazeStrategy: profile.lightGlazeStrategy,
    lightGlazeAdaptivePreviewStrategy: LIGHT_GLAZE_ADAPTIVE_PREVIEW_STRATEGY,
    lightGlazeStorageAllocated: engine.lightGlazeStorageAllocated,
    lightGlazeStorageMode: engine.lightGlazeStorageMode,
    lightGlazeAdditionalMemoryMiB: engine.lightGlazeStorageAllocated
      ? lightGlazeAdditionalMemoryMiB(
        engine.layerFormat,
        engine.lightGlazeStorageMode,
        undefined,
        Boolean(engine.lightGlazeCommitTileTexture),
      )
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
      engine.adaptivePreviewVisibleCanvasRequestedDesynchronized,
    adaptivePreviewVisibleCanvasAlpha: engine.adaptivePreviewVisibleContextAttributes.alpha,
    adaptivePreviewVisibleCanvasDesynchronized:
      engine.adaptivePreviewVisibleContextAttributes.desynchronized,
    adaptivePreviewVisibleCanvasColorSpace:
      engine.adaptivePreviewVisibleContextAttributes.colorSpace,
    adaptivePreviewScratchCanvasAlpha: engine.adaptivePreviewScratchContextAttributes.alpha,
    adaptivePreviewScratchCanvasDesynchronized:
      engine.adaptivePreviewScratchContextAttributes.desynchronized,
    adaptivePreviewScratchCanvasColorSpace:
      engine.adaptivePreviewScratchContextAttributes.colorSpace,
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
    adaptiveSpacingMaxExtraPercentPoints: engine.adaptiveSpacingMaxExtraPercentPoints,
    adaptiveSpacingInitialPercent: profile.adaptiveSpacingInitialPercent,
    adaptiveSpacingFinalPercent: profile.adaptiveSpacingFinalPercent,
    adaptiveSpacingIncreaseCount: profile.adaptiveSpacingEvents.length,
    adaptiveSpacingReachedMaximum:
      profile.adaptiveSpacingFinalPercent
        >= profile.adaptiveSpacingInitialPercent
          + engine.adaptiveSpacingMaxExtraPercentPoints
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
    historyStoredBaseStampsAtEnd: engine.historyStoredBaseStamps,
    historyLogicalStampBytesAtEnd: engine.historyStoredBaseStamps * STAMP_STRIDE_BYTES,
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

export function startStrokePerformanceProfile(engine: BrushEngine): void {
  engine.activeStrokeProfile = {
    startedAt: performance.now(),
    stampGeometry: STAMP_GEOMETRY,
    stampVerticesPerCopy: STAMP_VERTICES_PER_COPY,
    fragmentCoverageStrategy: engine.settings.shape === "shape"
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
    strokeStabilizationAmount: engine.settings.stabilization,
    strokeStabilizationInputSamples: 0,
    strokeStabilizationMaturePoints: 0,
    strokeStabilizationForcedMaturePoints: 0,
    strokeStabilizationMaximumTailPoints: 0,
    strokeStabilizationTailFrames: 0,
    strokeStabilizationTailBaseStamps: 0,
    strokeStabilizationTailPhysicalCopies: 0,
    strokeStabilizationMaximumSnapshotPixels: 0,
    strokeStabilizationMaximumSnapshotBytes: 0,
    strokeCurveInputSegments: 0,
    strokeCurveSmoothedSegments: 0,
    strokeCurveFlattenedSegments: 0,
    strokeCurveSharpCornerBypasses: 0,
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
    adaptiveSpacingInitialPercent: engine.settings.spacingPercent,
    adaptiveSpacingFinalPercent: engine.settings.spacingPercent,
    adaptiveSpacingEvents: [],
    grainStrategy: engine.grainStrategy(engine.settings),
    grainCoordinateStrategy: engine.grainCoordinateStrategy(engine.settings),
    grainSamplingStrategy: engine.grainSamplingStrategy(engine.settings),
    grainCoverageStrategy: isTexturizedGrainActive(engine.settings)
      ? GRAIN_COVERAGE_STRATEGY
      : "none",
    grainAdaptivePreviewStrategy: isTexturizedGrainActive(engine.settings)
      ? GRAIN_ADAPTIVE_PREVIEW_STRATEGY
      : "legacy",
    grainBatches: 0,
    grainBaseStamps: 0,
    grainPhysicalCopies: 0,
    grainCircleBatches: 0,
    grainShapeBatches: 0,
    grainAdaptivePreviewSkips: 0,
    lightGlazeStrategy: lightGlazeStrategyForBlendMode(engine.settings.blendMode),
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

export function getLayerStorageStudy(engine: BrushEngine): LayerStorageStudyStats {
  const bytesPerPixel = engine.layerFormat === "rgba16float" ? 8 : 4;
  const fullLayerMiB = layerStorageTileMemoryMiB(
    LAYER_STORAGE_TILE_COUNT,
    bytesPerPixel,
  );
  const activeId = engine.layerStack.active.id;
  const referenceId = engine.layerStack.referenceLayerId;
  const fullResidentIds = new Set<number>([activeId]);
  if (referenceId !== null) {
    fullResidentIds.add(referenceId);
  }
  const layers = engine.layerStack.layers.map((record): LayerStorageLayerEstimate => {
    const gpu = engine.layerGpu.get(record.id);
    const active = record.id === activeId;
    const hasContent = active ? engine.layerHasContent : record.hasContent;
    const contentBounds = active ? engine.layerContentBounds : record.contentBounds;
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
      reference: record.id === referenceId,
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
  const coldProjected = layers.filter((layer) => !fullResidentIds.has(layer.id));
  const inactiveConservativeTileMiB = coldProjected.reduce(
    (total, layer) => total + layer.conservativeTileMiB,
    0,
  );
  const inactiveAlignedBboxMiB = coldProjected.reduce(
    (total, layer) => total + layer.alignedBboxMiB,
    0,
  );
  const eagerFullRawMiB = fullLayerMiB * engine.layerGpu.size;
  const actualRawMiB = layers.reduce((total, layer) => total + layer.actualRawMiB, 0);
  const residentFullCount = engine.layerGpu.size > 0 ? fullResidentIds.size : 0;
  const residentFullMiB = fullLayerMiB * residentFullCount;
  const projectedConservativeRawMiB = residentFullMiB + inactiveConservativeTileMiB;
  const projectedAlignedBboxRawMiB = residentFullMiB + inactiveAlignedBboxMiB;
  return {
    strategy: LAYER_STORAGE_STRATEGY,
    measurementOnly: false,
    tileSizePx: LAYER_STORAGE_TILE_SIZE,
    gridSize: LAYER_STORAGE_GRID_SIZE,
    tileCount: LAYER_STORAGE_TILE_COUNT,
    bytesPerPixel,
    fullLayerMiB,
    actualRawMiB,
    inactiveFullMiB:
      fullLayerMiB * Math.max(0, engine.layerGpu.size - residentFullCount),
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

export async function measureExactLayerStorageStudy(engine: BrushEngine): Promise<LayerStorageExactStudy> {
  if (!import.meta.env.DEV) {
    throw new Error("Exact cold-storage measurement is available only in dev mode.");
  }
  if (!engine.initialized) {
    throw new Error("The engine is not initialized yet.");
  }
  if (engine.activeStroke || engine.historyBusy || engine.layerSwitchBusy) {
    throw new Error("Exact measurement requires the engine to be idle.");
  }

  await engine.waitForIdle();
  const temporaryReadbackBytesBefore = engine.devReadbackActiveBytes;
  if (temporaryReadbackBytesBefore !== 0) {
    throw new Error(
      `Cold-storage probe started with ${temporaryReadbackBytesBefore} readback bytes still live.`,
    );
  }
  engine.devReadbackPeakBytes = temporaryReadbackBytesBefore;

  const countedGpuMiBBefore = getGpuMemoryStats(engine).countedTotalMiB;
  const estimate = getLayerStorageStudy(engine);
  const bytesPerPixel: 4 | 8 = engine.layerFormat === "rgba16float" ? 8 : 4;
  const layers: LayerStorageExactLayerMeasurement[] = [];
  for (let index = 0; index < engine.layerStack.count; index += 1) {
    const record = engine.layerStack.at(index);
    const pixels = await engine.readLayerPixels(undefined, index);
    const exactMask = exactLayerStorageTileMask(
      pixels,
      DOCUMENT_WIDTH,
      DOCUMENT_HEIGHT,
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

  const fullResidentIds = new Set<number>([engine.layerStack.active.id]);
  if (engine.layerStack.referenceLayerId !== null) {
    fullResidentIds.add(engine.layerStack.referenceLayerId);
  }
  const inactiveExactMiB = layers
    .filter((layer) => !fullResidentIds.has(layer.id))
    .reduce((total, layer) => total + layer.exactTileMiB, 0);
  const residentFullMiB = estimate.fullLayerMiB * fullResidentIds.size;
  const projectedExactRawMiB = residentFullMiB + inactiveExactMiB;
  const countedGpuMiBAfter = getGpuMemoryStats(engine).countedTotalMiB;
  const temporaryReadbackBytesAfter = engine.devReadbackActiveBytes;
  const temporaryReadbackPeakBytes = engine.devReadbackPeakBytes;
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

export function getAdaptivePreviewDiagnostics(engine: BrushEngine): {
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
    active: engine.adaptivePreviewActive,
    frozen: engine.adaptivePreviewFrozen,
    visible: engine.adaptivePreviewCanvas?.style.opacity === "1",
    submittedSerial: engine.adaptivePreviewSubmittedSerial,
    confirmedSerial: engine.adaptivePreviewConfirmedSerial,
    lastPresentedSerial: engine.adaptivePreviewLastPresentedSerial,
    retirementTargetSerial: engine.adaptivePreviewRetirementTargetSerial,
    candidateCount: engine.adaptivePreviewCandidates.length,
    presentedUnboundCandidates: engine.adaptivePreviewCandidates.filter(
      (candidate) => candidate.presented && candidate.serial === null,
    ).length,
    drawFramePending: engine.adaptivePreviewFrameRequest !== null,
    retirementFramePending: engine.adaptivePreviewRetirementFrame !== null,
  };
}

export function getLayerCompositeState(engine: BrushEngine): {
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
    selectedMipLevel: engine.paintDisplaySelectedMipLevel,
    below: describe(engine.mergedBelow),
    above: describe(engine.mergedAbove),
  };
}

export function getLayerBakeState(engine: BrushEngine, layerIndex: number): {
  allocated: boolean;
  valid: boolean;
  generation: number;
  memoryMiB: number;
} {
  if (!import.meta.env.DEV) {
    throw new Error("Bake diagnostics are available only in dev mode.");
  }
  if (!engine.initialized) {
    throw new Error("The engine is not initialized yet.");
  }
  const gpu = engine.requireLayerGpu(engine.layerStack.at(layerIndex).id);
  return {
    allocated: Boolean(gpu.bake),
    valid: gpu.bakeValid,
    generation: gpu.bake?.generation ?? 0,
    memoryMiB: (gpu.bake?.memoryBytes ?? 0) / MEBIBYTE_BYTES,
  };
}
