import { clamp, hexToHsl } from "./color";
import { decodeGrayscalePng8 } from "./png-mask";
import {
  createDryBlendPlanner,
  DRY_BLEND_CORE_BUILD,
  DRY_BLEND_SCRATCH_LIFECYCLE_STRATEGY,
  type DryBlendPlanner,
} from "./blend-core";
import {
  DryBlendRenderer,
  cloneDryBlendRenderBatch,
  compactDryBlendHistoryGeometry,
  type DryBlendHistoryGeometry,
  type DryBlendRenderBatch,
} from "./blend-renderer";
import type { FillRenderer } from "./fill-renderer";
import { FILL_REFERENCE_LAYER_STRATEGY } from "./fill-core";
import type { SelectionRenderer } from "./selection-renderer";
import {
  LAYER_THUMBNAIL_SIZE,
  LayerThumbnailRenderer,
  type LayerThumbnailPixels,
} from "./layer-thumbnail-renderer";
import {
  emptyPixelSelectionState,
  SELECTION_TILE_MASK_WORDS,
  type PixelSelectionState,
  type SelectionCombineMode,
  type SelectionMethod,
  type SelectionOperationResult,
  type SelectionPoint,
} from "./selection-core";
import {
  GPU_HISTORY_STORAGE_STRATEGY,
  GpuHistoryStorage,
  type GpuHistorySlice,
} from "./gpu-history-storage";
import {
  brushShader,
  displayShader,
  grainMipShader,
  layerCompositeShader,
  lightGlazeCommitTileShader,
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
  cloneRasterImageNode,
  cloneVectorSvgNode,
  cloneVectorTextNode,
  reusableMixedSceneRasterRunKeys,
  type MixedSceneCompositionSegment,
  type MixedSceneItem,
  type MixedSceneRasterRunKey,
  type MixedSceneVectorHistoryDelta,
  type MixedSceneVectorHistoryState,
  type MixedSceneVectorKey,
  type RasterImageNode,
  type VectorSvgNode,
  type VectorSvgNodeSeed,
  type VectorTextNode,
  type VectorTextNodeSeed,
} from "./mixed-scene-stack";
import type {
  NativeRasterImageImportResult,
  NativeRasterImageHistorySeed,
  RasterImageGpuResource,
} from "./engine-raster-image-runtime";
import {
  applyLayerDeleteHistory,
  destroyLayerDeleteHistorySeeds,
} from "./engine-layer-structure-runtime";
import {
  deleteRasterImageNode,
  destroyRasterImportHistorySeed,
  importRasterImageFile as importRasterImageFileRuntime,
  moveRasterImageNode,
  setRasterImageNodeOpacity,
  setRasterImageNodeVisibility,
  updateRasterImageNode,
} from "./engine-raster-image-runtime";
import {
  beginRasterLayerTransform as beginRasterLayerTransformRuntime,
  cancelRasterLayerTransform as cancelRasterLayerTransformRuntime,
  commitRasterLayerTransform as commitRasterLayerTransformRuntime,
  nudgeRasterLayerTransform as nudgeRasterLayerTransformRuntime,
  updateRasterLayerTransform as updateRasterLayerTransformRuntime,
  type ActiveRasterTransformSession,
} from "./engine-raster-transform-runtime";
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
  VectorTextGpuBlurSourceDraw,
  VectorTextPlacement,
  VectorTextViewState,
} from "./vector-text-types";
import type { VectorTextFastPresentationMode } from "./vector-text-adaptive-zoom";
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
  DEFAULT_RASTER_COLOR_OVERLAY_STYLE,
  RASTER_COLOR_OVERLAY_EFFECT_ID,
  RASTER_COLOR_OVERLAY_STRATEGY,
  copyRasterColorOverlayStyle,
  normalizeRasterColorOverlayStyle,
  rasterColorOverlayStylesEqual,
  type RasterColorOverlayStyle,
} from "./raster-color-overlay-core";

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
import { LAYER_BLEND_MODE_CODES, type LayerBlendMode } from "./layer-blend-modes";
import type { LayerBlendTileCompositor } from "./layer-blend-tile-compositor";
import {
  encodeLayerBlendTilePresentation,
  layerBlendTilePresentationRequired,
} from "./engine-layer-blend-tile-runtime";
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
import {
  ADAPTIVE_PREVIEW_ALPHA_SCALE,
  ADAPTIVE_PREVIEW_COMMIT_BUDGET_RESERVE_MS,
  ADAPTIVE_PREVIEW_EXACT_LINEAR_SCALE,
  ADAPTIVE_PREVIEW_FORCE,
  ADAPTIVE_PREVIEW_JS_BUDGET_MS,
  ADAPTIVE_PREVIEW_MAX_PATCH_CSS_PIXELS,
  ADAPTIVE_PREVIEW_MAX_TIP_BASE_STAMPS,
  ADAPTIVE_PREVIEW_MIN_PATCH_CSS_PIXELS,
  ADAPTIVE_PREVIEW_PATCH_MARGIN_CSS_PIXELS,
  ADAPTIVE_PREVIEW_PATCH_QUANTUM_CSS_PIXELS,
  ADAPTIVE_PREVIEW_PROBE_INTERVAL_SUBMISSIONS,
  ADAPTIVE_PREVIEW_PROBE_NEAR_MISS_MINIMUM_MS,
  ADAPTIVE_PREVIEW_SHAPE_PALETTE_SIZE,
  ADAPTIVE_PREVIEW_SLOW_COMPLETION_THRESHOLD_MS,
  ADAPTIVE_PREVIEW_TRIGGER_CONSECUTIVE_PROBES,
  ADAPTIVE_PREVIEW_TRIGGER_THRESHOLD_MS,
  ADAPTIVE_SPACING_STEP_PERCENT_POINTS,
  type AdaptivePreviewCandidate,
  type AdaptivePreviewConcreteActivationReason,
  type AdaptivePreviewContextAttributes,
  type AdaptivePreviewCopy,
  type AdaptivePreviewProbe,
  adaptivePreviewRgb,
  type AdaptivePreviewShapePaletteEntry,
  adaptiveSpacingMaxExtraPercentPointsForPlatform,
  readAdaptivePreviewContextAttributes,
  shouldDesynchronizeAdaptivePreviewVisibleCanvas,
} from "./adaptive-preview-runtime";
import {
  type ActiveVectorHistoryEdit,
  type ActiveRasterLayerMetadataHistoryEdit,
  type BlendHistoryRenderBatch,
  type FillHistoryRenderBatch,
  type HistoryAction,
  type HistoryRenderBatch,
  type LayerAddHistoryAction,
  type LayerDeleteHistoryAction,
  type DeletedLayerEntry,
  type RasterImportHistoryAction,
  type RasterLayerMetadataHistoryAction,
  type RasterLayerMetadataHistoryState,
  type RasterTransformHistoryAction,
  type SelectionHistoryMaskSnapshot,
  type VectorRasterizeHistoryAction,
  type PaintHistoryRenderBatch,
  resolvePaintHistoryStampCount,
  vectorHistoryStatesEqual,
} from "./engine-history-types";
import type {
  ActiveClippingGroupResources,
  DisplayPyramidResources,
  EffectsRetargetCaller,
  LayerBakeResources,
  LayerColdCompressionProgress,
  LayerColdStorageResources,
  LayerCompressedColdStorageResources,
  LayerEffectsRebuildDomain,
  LayerGpuCompletionPolicy,
  LayerGpuResources,
  LayerTextureResources,
  MergedSurfaceResources,
  MixedSceneRasterSegmentResources,
  RebuildMergedLayerSurfacesOptions,
} from "./engine-layer-resources";
import {
  BRUSH_UNIFORM_BYTES,
  DISPLAY_UNIFORM_BYTES,
  DRY_BLEND_FRAME_PIXEL_BUDGET,
  DRY_BLEND_MAX_BATCHES_PER_FRAME,
  GRAIN_TEXTURE_MIP_LEVEL_COUNT,
  GRAIN_TEXTURE_PIXEL_COUNT,
  GRAIN_TEXTURE_SIZE,
  GRAIN_UNIFORM_BYTES,
  LAYER_COMPOSITE_UNIFORM_BYTES,
  LAYER_SIZE,
  LIGHT_GLAZE_COMMIT_TILE_EXTENT,
  LIGHT_GLAZE_COMMIT_TILE_SLOT_COUNT,
  LIGHT_GLAZE_COMMIT_TILE_UNIFORM_BUFFER_BYTES,
  LIGHT_GLAZE_COMMIT_TILE_UNIFORM_BYTES,
  LIGHT_GLAZE_COMMIT_TILE_UNIFORM_STRIDE_BYTES,
  LIGHT_GLAZE_UNIFORM_BYTES,
  MAX_STAMPS_PER_BATCH,
  MEBIBYTE_BYTES,
  PAINT_DISPLAY_MIP_LEVEL_COUNT,
  SHAPE_MASK_SIZE,
  SHAPE_OCCUPANCY_GRID_SIZE,
  SHAPE_OCCUPANCY_MAP_BYTES,
  SHAPE_OCCUPANCY_MAP_COUNT,
  SHAPE_OCCUPANCY_MAX_COVERAGE_RATIO,
  SHAPE_OCCUPANCY_MAX_MIP,
  SHAPE_OCCUPANCY_MIN_RADIUS,
  SHAPE_OCCUPANCY_WORDS_PER_MAP,
  STAMP_STRIDE_BYTES,
  STAMP_VERTICES_PER_COPY,
  THICKNESS_TAIL_MAXIMUM_TEXTURE_DIMENSION,
  THICKNESS_TAIL_TEXTURE_QUANTUM,
  THICKNESS_TAIL_UNIFORM_BYTES,
  VECTOR_TEXT_CAPTURE_UNIFORM_BYTES,
  VECTOR_TEXT_GPU_MAXIMUM_DRAWS,
  VIEW_ROTATION_SNAP_ENTER_RADIANS,
  VIEW_ROTATION_SNAP_RELEASE_RADIANS,
} from "./engine-limits";
import {
  average,
  combineCompressionHashes,
  hashBytes,
  maximum,
  normalizeViewRotation,
  percentile,
  previewHash32,
  previewHslToRgb,
  previewRandom01,
  srgbByteToLinear,
} from "./engine-math";
import {
  layerBaseMemoryMiB,
  lightGlazeAdditionalMemoryMiB,
  paintDisplayPyramidAdditionalMemoryMiB,
  shapeTextureMemoryMiB,
  staticPaintBufferMemoryMiB,
} from "./engine-memory-model";
import {
  destroyLightGlazeResourceSet,
  type GrainTextureResources,
  type LightGlazeResourceSet,
  type LightGlazeSession,
  type ShapeMaskResources,
} from "./engine-paint-resources";
import type {
  EngineGpuMemoryStats,
  EngineStats,
  LayerStorageExactLayerMeasurement,
  LayerStorageExactStudy,
  LayerStorageLayerEstimate,
  LayerStorageStudyStats,
  MutableStrokePerformanceProfile,
  RenderFrameTiming,
  StrokePerformanceProfile,
  SubmitTiming,
} from "./engine-stats";
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
  type FragmentCoverageStrategy,
  GRAIN_ADAPTIVE_PREVIEW_STRATEGY,
  GRAIN_COVERAGE_STRATEGY,
  GRAIN_DISABLED_STRATEGY,
  GRAIN_FIXED_COORDINATE_STRATEGY,
  GRAIN_FIXED_STRATEGY,
  GRAIN_MIP_STRATEGY,
  GRAIN_MOVING_COORDINATE_STRATEGY,
  GRAIN_MOVING_ROLLER_COORDINATE_STRATEGY,
  GRAIN_MOVING_STRATEGY,
  GRAIN_PIPELINE_STRATEGY,
  GRAIN_STORAGE_LIFECYCLE_STRATEGY,
  PENCIL_GRAIN_FIXED_STRATEGY,
  PENCIL_GRAIN_MOVING_STRATEGY,
  type GrainAdaptivePreviewStrategy,
  grainCoordinateMode,
  type GrainCoordinateStrategy,
  type GrainCoverageStrategy,
  type GrainSamplingStrategy,
  type GrainStrategy,
  HISTORY_REPLAY_STRATEGY,
  HISTORY_STAMP_RETENTION_STRATEGY,
  HISTORY_STORAGE_STRATEGY,
  isStrokeGlazeBlendMode,
  isTexturizedGrainActive,
  LAYER_BAKE_STRATEGY,
  LAYER_COMPOSITE_STRATEGY,
  LIGHT_GLAZE_ADAPTIVE_PREVIEW_STRATEGY,
  LIGHT_GLAZE_STORAGE_LIFECYCLE_STRATEGY,
  type LightGlazeStorageMode,
  lightGlazeStorageModeFor,
  type LightGlazeStrategy,
  lightGlazeStrategyForBlendMode,
  PAINT_DISPLAY_LOD_SELECTION_STRATEGY,
  PAINT_DISPLAY_PYRAMID_STRATEGY,
  PRESENTATION_CACHE_STRATEGY,
  PRESENTATION_TRANSFER_STRATEGY,
  SHAPE_CANVAS_DECODE_STRATEGY,
  SHAPE_DIRECT_DECODE_STRATEGY,
  SHAPE_FRAGMENT_COVERAGE_STRATEGY,
  SHAPE_LEGACY_STRATEGY,
  SHAPE_OCCUPANCY_STRATEGY,
  SHAPE_STORAGE_LIFECYCLE_STRATEGY,
  type ShapeMaskDecodeStrategy,
  type ShapeSamplingStrategy,
  STAMP_GEOMETRY,
  type StampGeometry,
  THICKNESS_DYNAMICS_PREVIEW_STRATEGY,
  type ThicknessDynamicsPreviewStrategy,
  usesBlendRenderer,
  usesStrokeGlazeRenderer,
} from "./engine-strategies";
import type {
  ActiveStroke,
  DirtyRect,
  PackedStampUpload,
  PendingBlendBatch,
  Stamp,
  StabilizationTailFrame,
  ThicknessTailFrame,
} from "./engine-stroke-types";
import {
  defaultBrushSettings,
  type AdaptiveSpacingTriggerReason,
  type BenchmarkResult,
  type BlendMode,
  type BrushEngineOptions,
  type BrushGrainAssetId,
  type BrushSettings,
  type BrushShapeAssetId,
  type CustomBrushGrainAssetId,
  type CustomBrushShapeAssetId,
  type BrushTool,
  type EffectsWorkbenchRetargetResult,
  type EngineCallbacks,
  type GrainFiltering,
  type HistoryReplayFaultPoint,
  type HistoryState,
  type LayerBakeFaultPoint,
  type LayerColdStorageFaultPoint,
  type LayerCompositeFaultPoint,
  type LayerFormat,
  type LayerPoint,
  type LayerSwitchResult,
  type MixedSceneSnapshot,
  type PointerSample,
} from "./engine-types";
import {
  CustomBrushAssetRegistry,
  type CustomBrushAssetSnapshot,
  type DecodedCustomBrushImage,
  grainAssetIdForSettings,
  isCustomGrainAssetId,
  isCustomShapeAssetId,
  normalizeGrainAssetId,
  normalizeShapeAssetId,
  shapeAssetIdForSettings,
  shapeInvertForSettings,
} from "./engine-brush-assets";
import {
  vectorTextGpuDrawUsesBlur,
  vectorTextGpuDrawUsesMesh,
  type MixedSceneActivePresentation,
  type VectorTextGpuBlurCacheResources,
  type VectorTextGpuDrawResources,
  type VectorTextGpuPendingRun,
  type VectorTextRunTextureResources,
} from "./engine-vector-text-resources";
import {
  buildShapeOccupancyMaps,
  type ShapeOccupancyFallbackReason,
  type ShapeOccupancySelection,
} from "./shape-occupancy";
import { assertShaderCompiled, describeAdapter } from "./engine-gpu-utils";
import {
  CausalStrokeCurvePlanner,
  evaluateStrokeCurveX,
  evaluateStrokeCurveY,
} from "./stroke-curve-core";
import { resamplePaintCurveSegment } from "./paint-stamp-generation-core";
import {
  CausalFadedStrokeStabilizer,
  type StrokeStabilizationUpdate,
} from "./stroke-stabilization-core";
import {
  mergeDirtyRects,
  normalizeLayerRect,
  paintMipDimensions,
  vectorTextGpuClearBounds,
  vectorTextGpuRunBounds,
} from "./engine-geometry";
import { decodeShapeMaskWithCanvas } from "./shape-mask-decode";
import {
  clearLayerColdCompressionIdleTimer,
  coldStorageMaskForRecord,
  compressOneDistantLayerInBackground,
  createColdLayerGpuResources,
  createHydratedLayerTexture,
  createLayerColdStorageCandidate,
  destroyLayerColdStorage,
  destroyLayerHot,
  destroyTransientLayerHydration,
  encodeLayerColdHydration,
  ensureActiveLayerHot,
  ensureAdjacentLayerColdStorageResident,
  evictReconstructibleLayerResources,
  pauseLayerColdCompressionIdle,
} from "./engine-cold-storage";
import {
  packStampsIntoUpload,
  populateBrushUniformUpload,
  populateGrainUniformUpload,
  populateStrokeGlazeUniformUpload,
} from "./engine-stamp-upload";
import {
  benchmarkEffectsWorkingSet,
  finishStrokePerformanceProfile,
  getAdaptivePreviewDiagnostics,
  getBenchmarkEnvironment,
  getGpuMemoryStats,
  getLayerBakeState,
  getLayerCompositeState,
  getStats,
  measureActiveStyleBakeGap,
  measureExactLayerStorageStudy,
  measureLayerColdCompressionStudy,
  resetActiveLayerForMemoryBenchmark,
  runBenchmark,
  seedActiveLayerMemoryStress,
  setLayerCompositeTestView,
  startStrokePerformanceProfile,
} from "./engine-reports";
import {
  captureVectorTextPresentationView,
  captureVectorTextFallbackPresentation,
  clearVectorTextFallbackPresentation,
  clearVectorTextPresentationForTransaction,
  createMixedSceneRasterSegmentResources,
  destroyMixedSceneRasterSegment,
  encodeMixedSceneSegmentedPresentation,
  ensureMixedSceneLinearTexture,
  ensureVectorTextGpuBlurCache,
  ensureVectorTextGpuResource,
  ensureVectorTextPresentationTexture,
  flushVectorTextGpuPresentations,
  initializeVectorTextGpuRenderer,
  mixedSceneItemIsVisible,
  mutateMixedScenePresentation,
  publishMixedScene,
  probeVectorTextFastCompositeAlpha,
  probeVectorTextFallbackAlpha,
  rebuildVectorTextDisplayBindGroup,
  releaseVectorTextGpuBlurScratch,
  releaseVectorTextGpuScratch,
  requireMixedSceneStack,
  writeVectorTextCaptureUniforms,
} from "./engine-vector-text-runtime";
import {
  applyVectorHistoryState,
  captureRasterLayerMetadataHistoryState,
  getMixedSceneReorderTargets,
  compactDiscardedHistoryIncrementally,
  type HistoryIncrementalCompactionHooks,
  type HistoryIncrementalCompactionResult,
  hasVisibleHistoryContent,
  historyStepBlockedByLayer,
  maybeInjectHistoryReplayFault,
  moveHistoryCursor,
  moveMixedSceneItem,
  rasterLayerMetadataHistoryStatesEqual,
  recordBlendHistoryBatch,
  recordRasterLayerMetadataHistoryAction,
  recordVectorHistoryAction,
  scheduleHistoryGpuTrim,
  truncateRedoHistory,
} from "./engine-history-runtime";
import {
  cancelHistoryMaintenance,
  destroyHistoryMaintenance,
  historyCursorWithinRetainedRange,
  historyMaintenanceTelemetry,
  scheduleHistoryMaintenance,
} from "./history-maintenance-runtime";
import {
  buildGpuMemoryAuditReport,
  collectGpuMemoryEntries,
} from "./gpu-memory-audit";
import {
  GpuResourceRegistry,
  instrumentGpuDevice,
} from "./gpu-resource-registry";
import {
  ensureFillRenderer,
  fillAtClientPoint,
  setFillToolSelected,
  submitFillHistoryBatch,
  type FillOperationResult,
} from "./engine-fill-runtime";
import {
  clearPixelSelection,
  bindPaintPipelineWithPixelSelection,
  capturePaintSelectionHistoryMask,
  clipPaintDirtyRectToPixelSelection,
  renderPixelSelectionOverlay,
  releasePaintSelectionHistoryMask,
  resetPixelSelectionState,
  scheduleSelectionRendererRelease,
  selectConnectedAtClientPoint,
  selectionNeedsConnectedColorScratch,
  selectPixelsByClientLasso,
  selectPixelsByColor,
  setSelectionToolSelected,
} from "./engine-selection-runtime";
import {
  destroyVectorRasterHistorySeed,
  rasterizeVectorNodeToLayer,
} from "./engine-vector-raster-runtime";
import {
  applyLightGlazeResourceSet,
  createLightGlazeResourceSet,
  currentLightGlazeResourceSet,
  destroyLightGlazeResources,
  destroyStrokeStabilizationSnapshot,
  encodeLightGlazeDisplayPyramid,
  ensureStrokeStabilizationSnapshot,
  flushClosingLightGlazeSessionBeforeNewStroke,
  lightGlazeResourcesMatch,
  maybeReleaseIdleLightGlazeResources,
  requestLightGlazeResources,
} from "./engine-glaze-runtime";
import {
  activateAdaptivePreview,
  adaptivePreviewCandidatesForFrame,
  cancelAdaptivePreviewProbe,
  clearAdaptivePreviewCanvas,
  finishAdaptivePreviewLifetime,
  finishIncompleteAdaptivePreviewFrame,
  freezeAdaptivePreviewAtLift,
  hasAdaptivePreviewPresentedUnboundCandidate,
  prepareAdaptivePreviewShapePalette,
  requestAdaptivePreviewDraw,
  retireAdaptivePreviewAfterGpuIdle,
  scheduleAdaptivePreviewCatchUpClear,
  scheduleAdaptivePreviewRetirement,
} from "./engine-adaptive-preview-runtime";
import {
  allocateLayerGpuResources,
  bakeActiveLayerForSwitch,
  bindActiveLayerResources,
  buildActiveClippingGroupResources,
  buildMergedSurfaceCandidate,
  buildMixedMergedSurfaceCandidate,
  cancelEffectsScratchShrink,
  canvasOffsetToLayerOffset,
  clientToLayer,
  commitActiveLayerResidency,
  destroyLayerBakeTexture,
  destroyLayerGpuResources,
  destroyActiveClippingGroupResources,
  destroyMergedSurfaceTexture,
  effectsScratchCanShrinkNow,
  effectsScratchNeedsShrink,
  encodeMergedDisplayPyramids,
  encodeMergedSurfacePyramid,
  freezeActiveLayerToCold,
  invalidateActiveLayerBake,
  layerCompositeVisualBounds,
  layerDirtyRectToPresentationRect,
  layerToCanvasPixels,
  maybeInjectLayerBakeFault,
  maybeInjectLayerCompositeFault,
  mixedSceneSegmentLayerBlendMode,
  orderedLayerBlendPresentationRequired,
  rebuildLayerDisplayBindGroups,
  recreateLayerResources,
  releaseFusedLayerBakes,
  retargetFillRendererSource,
  restoreEffectsWorkbenchToActiveLayer,
  retargetEffectsWorkingSetInternal,
  setLayerClipping,
  setLayerBlendMode,
  setLayerReference,
  setLayerPresentation,
  splitMixedSceneRasterRunsForLayerBlend,
  shrinkEffectsScratchAfterIdle,
} from "./engine-layer-runtime";
import {
  applyGrainTextureResources,
  applyShapeMaskResources,
  createGrainTextureResources,
  createShapeMaskResources,
  createStaticResources,
  destroyThicknessTailOverlayResources,
  destroyGrainTextureResources,
  destroyShapeMaskResources,
  destroyTrackedReadbackBuffer,
  ensureEffectRenderersForRecord,
  ensurePresentationCacheTexture,
  ensureRasterBevelRenderer,
  ensureRasterInnerShadowRenderer,
  ensureRasterOuterShadowRenderer,
  ensureRasterStrokeRenderer,
  ensureThicknessTailOverlayResources,
  maybeReleaseIdleBlendScratch,
  maybeReleaseIdleGrainResources,
  maybeReleaseIdleShapeResources,
  rebuildGrainBrushBindGroups,
  rebuildShapeBrushBindGroups,
  releaseHeldThicknessStamps,
  releaseRasterBevelRenderer,
  releaseRasterInnerShadowRenderer,
  releaseRasterOuterShadowRenderer,
  releaseRasterStrokeRenderer,
} from "./engine-resource-setup";
import {
  applyViewRotation,
  armBevelFieldShrinkAfterIdle,
  assertVectorUpdateAllowed,
  bevelFieldBlocksScratchShrink,
  bevelFieldNeedsShrink,
  cancelBevelFieldShrink,
  clientToCanvasPixels,
  commitThicknessStamp,
  deferRasterStrokeMutation,
  drainBlendPlanner,
  emitStamp,
  encodeRasterStrokeDisplayPyramid,
  finishStaticResourceCreation,
  flushPendingWorkBeforeSettingsChange,
  hasPendingRenderWork,
  packStamps,
  rasterBevelActive,
  rasterBevelEffectRect,
  rasterBevelInfluenceRect,
  rasterInnerShadowActive,
  rasterInnerShadowEffectRect,
  rasterInnerShadowInfluenceRect,
  rasterOuterShadowActive,
  rasterOuterShadowEffectRect,
  rasterOuterShadowInfluenceRect,
  rasterStrokeActive,
  rasterStrokeEffectRect,
  recordStampGenerationTime,
  requestGrainLoad,
  requestShapeLoad,
  runRenderFrame,
  setRasterStrokeGeometryEnabled,
  thicknessTailReferenceTimeMs,
  throwIfRenderUnavailable,
  waitForRenderPump,
} from "./engine-runtime-misc";

export type {
  RasterStrokePosition,
  RasterStrokeStyle,
} from "./stroke-core";
export type { RasterColorOverlayStyle } from "./raster-color-overlay-core";

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

/**
 * Il motore. La classe conserva lo stato e il percorso caldo del tratto; il
 * resto vive nei moduli `engine-*`, che ricevono l'istanza come primo
 * parametro.
 *
 * Convenzione sulla visibilita', da rispettare quando si aggiunge un membro:
 *
 * - `private`  = dettaglio della classe, non lo tocca nessun modulo esterno;
 * - senza modificatore = interno al motore, condiviso con i moduli `engine-*`
 *   dello stesso pacchetto. NON e' API pubblica: fuori da `src/engine-*.ts`
 *   non va usato;
 * - i metodi documentati come API (quelli che chiamano `main.ts`, i benchmark
 *   e gli strumenti DEV) restano metodi della classe anche quando il corpo e'
 *   stato spostato: nel corpo resta la sola chiamata alla funzione estratta,
 *   cosi' la firma pubblica non cambia mai.
 *
 * Il percorso caldo per tratto (`submitImmediate`, `submitLightGlazeImmediate`,
 * `encodeRasterStrokeUpdate`, `renderFrame` e i loro aiutanti per stamp) resta
 * deliberatamente qui: non va spostato per ridurre le righe.
 */
export class BrushEngine {
  readonly layerSize = LAYER_SIZE;

  readonly canvas: HTMLCanvasElement;
  readonly callbacks: EngineCallbacks;
  readonly bevelBoundingFieldEnabled: boolean;
  readonly layerMemoryStressTestEnabled: boolean;
  readonly layerCompressionTestEnabled: boolean;
  readonly layerColdCompressionEnabled: boolean;
  readonly layerColdCompressionStatusEnabled: boolean;
  readonly layerColdDirectHotHydrationEnabled: boolean;
  readonly layerColdAdjacentPrefetchEnabled: boolean;
  readonly vectorTextPrototypeEnabled: boolean;
  readonly selectionOverlayCanvas: HTMLCanvasElement | null;

  private adapter!: GPUAdapter;
  device!: GPUDevice;

  /** Contabilita' misurata di ogni texture e buffer creati dal device. */
  gpuResourceRegistry = new GpuResourceRegistry();
  deviceLostError: Error | null = null;
  deviceLostSignal: Promise<Error> = new Promise(() => undefined);
  renderFrameError: Error | null = null;
  private context!: GPUCanvasContext;
  canvasFormat!: GPUTextureFormat;

  layerFormat: LayerFormat = "rgba8unorm";
  layerTexture!: GPUTexture;
  layerView!: GPUTextureView;
  layerSamplingView!: GPUTextureView;
  blendRenderer: DryBlendRenderer | null = null;
  fillRenderer: FillRenderer | null = null;
  fillRendererLoadingPromise: Promise<FillRenderer> | null = null;
  fillToolSelected = false;
  fillScratchReleaseTimer: number | null = null;
  selectionRenderer: SelectionRenderer | null = null;
  selectionRendererLoadingPromise: Promise<SelectionRenderer> | null = null;
  selectionRendererReleaseTimer: number | null = null;
  selectionOverlayFrameRequest: number | null = null;
  selectionToolSelected = false;
  selectionMethod: SelectionMethod = "magic-wand";
  selectionBusy = false;
  pixelSelectionState: PixelSelectionState = emptyPixelSelectionState();
  pixelSelectionTileMask = new Uint32Array(SELECTION_TILE_MASK_WORDS);
  pixelSelectionIdentity = 0;
  nextPixelSelectionIdentity = 1;
  effectsWorkbench: EffectsWorkbench | null = null;
  effectsScratchShrinkTimer: number | null = null;
  effectsScratchShrinkInFlight = false;
  bevelFieldShrinkTimer: number | null = null;
  bevelFieldShrinkInFlight = false;
  bevelFieldShrinkOnNextEncode = false;

  get rasterStrokeRenderer(): RasterStrokeRenderer | null {
    return this.effectsWorkbench?.strokeRenderer ?? null;
  }

  get rasterBevelRenderer(): RasterBevelRenderer | null {
    return this.effectsWorkbench?.bevelRenderer ?? null;
  }

  get rasterOuterShadowRenderer(): RasterShadowRenderer | null {
    return this.effectsWorkbench?.outerShadowRenderer ?? null;
  }

  get rasterInnerShadowRenderer(): RasterShadowRenderer | null {
    return this.effectsWorkbench?.innerShadowRenderer ?? null;
  }
  /**
   * The stack owns the CPU state the map classified as per-layer. Today it holds
   * exactly one record, so behaviour is unchanged; routing the styles through it
   * now means the switch has somewhere to read the incoming layer's effects from
   * instead of retrofitting 68 call sites later.
   */
  readonly layerStack = new LayerStack(() => ({
    strokeStyle: copyRasterStrokeStyle(DEFAULT_RASTER_STROKE_STYLE),
    bevelStyle: copyRasterBevelStyle(DEFAULT_RASTER_BEVEL_STYLE),
    outerShadowStyle: copyRasterOuterShadowStyle(DEFAULT_RASTER_OUTER_SHADOW_STYLE),
    innerShadowStyle: copyRasterInnerShadowStyle(DEFAULT_RASTER_INNER_SHADOW_STYLE),
    colorOverlayStyle: copyRasterColorOverlayStyle(
      DEFAULT_RASTER_COLOR_OVERLAY_STYLE,
    ),
  }));

  readonly mixedSceneStack: MixedSceneStack | null;
  vectorTextPreviewExcludedNodeId: number | null = null;

  /**
   * GPU resources per layer, keyed by the record's stable id. Ids are never
   * reused after a delete, so an entry can never be handed to a different layer
   * than the one it was allocated for.
   */
  readonly layerGpu = new Map<number, LayerGpuResources>();
  layerThumbnailRenderer: LayerThumbnailRenderer | null = null;

  /**
   * Held for the WHOLE duration of a switch, awaits included.
   *
   * The guards at the top of addLayer/setActiveLayer only prove the engine was
   * idle when they ran; the switch then awaits waitForIdle and the field rebuild,
   * and during those 150–215 ms a pointerdown could otherwise start a stroke on
   * a layer that is halfway through being swapped.
   */
  layerSwitchBusy = false;

  /**
   * While reconstructible layer resources are evicted, keep presenting the last
   * screen-space cache and submit no frame that could reference destroyed views.
   * Every successful activation/rebuild clears the flag before requesting a frame.
   */
  layerPresentationFrozen = false;

  /** Dev-only injections for post-submit rollback boundaries. */
  layerBakeFaultQueue: LayerBakeFaultPoint[] = [];
  layerCompositeFaultQueue: LayerCompositeFaultPoint[] = [];
  layerColdStorageFaultQueue: LayerColdStorageFaultPoint[] = [];
  readonly liveLayerBakeTextures = new Map<GPUTexture, number>();
  readonly liveMergedSurfaceTextures = new Map<GPUTexture, MergedSurfaceResources>();
  readonly liveLayerHydrationTextures = new Map<GPUTexture, number>();
  /** Dev probe buffers are excluded from counted GPU memory, so track them separately. */
  devReadbackActiveBytes = 0;
  devReadbackPeakBytes = 0;
  layerColdCompressionClient: LayerColdCompressionClient | null = null;
  layerColdCompressionWorkerUnavailable = false;
  layerColdCompressionIdleTimer: number | null = null;
  layerColdCompressionEpoch = 0;
  layerColdCompressionJobRunning = false;
  layerColdCompressionInteractionActive = false;
  layerColdCompressionProgress: LayerColdCompressionProgress | null = null;
  layerColdRestoreActiveBytes = 0;

  // Accessors rather than fields: every read site keeps working, and the styles
  // follow the active layer by construction rather than by remembering to copy
  // them on every switch.
  get rasterStrokeStyle(): RasterStrokeStyle {
    return this.layerStack.active.strokeStyle;
  }

  set rasterStrokeStyle(style: RasterStrokeStyle) {
    this.layerStack.active.strokeStyle = style;
  }

  get rasterColorOverlayStyle(): RasterColorOverlayStyle {
    return this.layerStack.active.colorOverlayStyle;
  }

  set rasterColorOverlayStyle(style: RasterColorOverlayStyle) {
    this.layerStack.active.colorOverlayStyle = style;
  }

  rasterStrokeCoverageValid = false;
  rasterStrokeStyledInitialized = false;
  rasterStrokeMipValidThroughLevel = 0;
  rasterStrokeMipDownsampleBindGroups: GPUBindGroup[] = [];
  rasterStrokeDisplayBindGroups = new Map<RasterStrokeSourceMode, GPUBindGroup>();
  rasterStrokePendingComposeRect: DirtyRect | null = null;
  rasterStrokeBusy = false;
  rasterStrokeLastEncode: RasterStrokeEncodeResult | null = null;
  get rasterBevelStyle(): RasterBevelStyle {
    return this.layerStack.active.bevelStyle;
  }

  set rasterBevelStyle(style: RasterBevelStyle) {
    this.layerStack.active.bevelStyle = style;
  }

  rasterBevelHeightValid = false;
  rasterBevelHeightSourceMode: RasterStrokeSourceMode | null = null;
  rasterBevelPendingComposeRect: DirtyRect | null = null;
  rasterBevelBusy = false;
  rasterBevelLastEncode: RasterBevelEncodeResult | null = null;
  rasterBevelTotalBuilds = 0;
  rasterBevelTotalPasses = 0;

  get rasterOuterShadowStyle(): RasterOuterShadowStyle {
    return this.layerStack.active.outerShadowStyle;
  }

  set rasterOuterShadowStyle(style: RasterOuterShadowStyle) {
    this.layerStack.active.outerShadowStyle = style;
  }

  rasterOuterShadowMatteValid = false;
  rasterOuterShadowSourceMode: RasterStrokeSourceMode | null = null;
  rasterOuterShadowPendingComposeRect: DirtyRect | null = null;
  rasterOuterShadowBusy = false;
  rasterOuterShadowLastEncode: RasterShadowEncodeResult | null = null;
  rasterOuterShadowTotalBuilds = 0;
  rasterOuterShadowTotalPasses = 0;

  get rasterInnerShadowStyle(): RasterInnerShadowStyle {
    return this.layerStack.active.innerShadowStyle;
  }

  set rasterInnerShadowStyle(style: RasterInnerShadowStyle) {
    this.layerStack.active.innerShadowStyle = style;
  }

  rasterInnerShadowMatteValid = false;
  rasterInnerShadowSourceMode: RasterStrokeSourceMode | null = null;
  rasterInnerShadowPendingComposeRect: DirtyRect | null = null;
  rasterInnerShadowBusy = false;
  rasterInnerShadowLastEncode: RasterShadowEncodeResult | null = null;
  rasterInnerShadowTotalBuilds = 0;
  rasterInnerShadowTotalPasses = 0;

  rasterStrokeTotalBuilds = 0;
  rasterStrokeTotalComposes = 0;
  layerContentBounds: DirtyRect | null = null;

  activeLayerDisplayPyramid!: DisplayPyramidResources;
  transparentLayerTexture!: GPUTexture;
  transparentLayerView!: GPUTextureView;
  mergedBelow: MergedSurfaceResources | null = null;
  mergedAbove: MergedSurfaceResources | null = null;
  activeClippingGroup: ActiveClippingGroupResources | null = null;
  mixedSceneCompositionSegments: readonly MixedSceneCompositionSegment[] = [];
  mixedSceneRasterSegments: MixedSceneRasterSegmentResources[] = [];
  paintMipViews: GPUTextureView[] = [];
  paintMipDownsampleBindGroups: GPUBindGroup[] = [];
  paintStackCompositeMipBindGroup!: GPUBindGroup;
  paintDisplayMipValidThroughLevel = 0;
  paintDisplayPyramidContent:
    | "active-only"
    | "active-clipping-group"
    | "final-raster-stack" = "active-only";
  paintDisplaySelectedMipLevel = 0;
  presentationCacheTexture: GPUTexture | null = null;
  presentationCacheView: GPUTextureView | null = null;
  presentationCacheWidth = 0;
  presentationCacheHeight = 0;
  presentationCacheNeedsFullRebuild = true;
  vectorTextCaptureView: VectorTextViewState | null = null;
  vectorTextFallbackCaptureView: VectorTextViewState | null = null;
  vectorTextFastPresentationEnabled = false;
  vectorTextFastPresentationMode: VectorTextFastPresentationMode = "precise";
  vectorTextFastPresentationInFlight = false;
  vectorTextFastPresentationLatestRequested = false;
  vectorTextFastPresentationSubmissionCount = 0;
  vectorTextFastPresentationCoalescedRequestCount = 0;
  vectorTextFastRequestedRevision = 0;
  vectorTextFastSubmittedRevision = 0;
  vectorTextFastCompletedRevision = 0;
  mixedSceneLinearTexture: GPUTexture | null = null;
  mixedSceneLinearView: GPUTextureView | null = null;
  mixedSceneLinearWidth = 0;
  mixedSceneLinearHeight = 0;
  mixedScenePresentBindGroup: GPUBindGroup | null = null;
  mixedSceneBlendScratchTexture: GPUTexture | null = null;
  mixedSceneBlendScratchView: GPUTextureView | null = null;
  mixedSceneBlendOperandTexture: GPUTexture | null = null;
  mixedSceneBlendOperandView: GPUTextureView | null = null;
  mixedSceneBlendGroupTexture: GPUTexture | null = null;
  mixedSceneBlendGroupView: GPUTextureView | null = null;
  mixedSceneBlendFromLinearBindGroup: GPUBindGroup | null = null;
  mixedSceneBlendFromScratchBindGroup: GPUBindGroup | null = null;
  mixedSceneBlendFromGroupBindGroup: GPUBindGroup | null = null;
  layerBlendTileCompositor: LayerBlendTileCompositor | null = null;
  readonly rasterImageGpuResources = new Map<string, RasterImageGpuResource>();
  nextRasterImageAssetId = 1;
  readonly vectorTextRunTextures = new Map<
    Extract<VectorTextPlacement, `text-run:${string}`>,
    VectorTextRunTextureResources
  >();
  readonly vectorTextGpuMeshes =
    new Map<string, VectorTextGpuDrawResources>();
  readonly vectorTextGpuBlurCaches =
    new Map<string, VectorTextGpuBlurCacheResources>();
  readonly vectorTextGpuPendingRuns: VectorTextGpuPendingRun[] = [];
  vectorTextGpuMsaaTexture: GPUTexture | null = null;
  vectorTextGpuMsaaView: GPUTextureView | null = null;
  vectorTextGpuResolvedTexture: GPUTexture | null = null;
  vectorTextGpuResolvedView: GPUTextureView | null = null;
  vectorTextGpuScratchWidth = 0;
  vectorTextGpuScratchHeight = 0;
  vectorTextGpuUniformBuffer: GPUBuffer | null = null;
  vectorTextGpuUniformBindGroup: GPUBindGroup | null = null;
  readonly vectorTextGpuUniformUpload = new Float32Array(
    VECTOR_TEXT_GPU_MAXIMUM_DRAWS * VECTOR_TEXT_GPU_UNIFORM_STRIDE / 4,
  );
  vectorTextBelowTexture: GPUTexture | null = null;
  readonly vectorTextGpuUniformUploadUnsigned = new Uint32Array(
    this.vectorTextGpuUniformUpload.buffer,
  );
  vectorTextGpuBlurScratchATexture: GPUTexture | null = null;
  vectorTextGpuBlurScratchAView: GPUTextureView | null = null;
  vectorTextGpuBlurScratchBTexture: GPUTexture | null = null;
  vectorTextGpuBlurScratchBView: GPUTextureView | null = null;
  vectorTextGpuBlurScratchWidth = 0;
  vectorTextGpuBlurScratchHeight = 0;
  vectorTextGpuBlurFilterUniformBuffer: GPUBuffer | null = null;
  readonly vectorTextGpuBlurFilterUniformUpload = new Float32Array(
    VECTOR_TEXT_GPU_MAXIMUM_DRAWS * VECTOR_TEXT_GPU_UNIFORM_STRIDE / 4,
  );
  readonly vectorTextGpuBlurFilterUniformUploadUnsigned = new Uint32Array(
    this.vectorTextGpuBlurFilterUniformUpload.buffer,
  );
  vectorTextGpuBlurFilterBindGroupAToB: GPUBindGroup | null = null;
  vectorTextGpuBlurFilterBindGroupBToA: GPUBindGroup | null = null;
  vectorTextGpuBlurSampler: GPUSampler | null = null;
  vectorTextBelowView: GPUTextureView | null = null;
  vectorTextAboveTexture: GPUTexture | null = null;
  vectorTextAboveView: GPUTextureView | null = null;
  vectorTextTextureWidth = 0;
  vectorTextTextureHeight = 0;
  vectorTextDisplayBindGroup: GPUBindGroup | null = null;
  lightGlazeTexture: GPUTexture | null = null;
  lightGlazeCompositeMipTexture: GPUTexture | null = null;
  lightGlazeView: GPUTextureView | null = null;
  lightGlazeSamplingView: GPUTextureView | null = null;
  lightGlazeMipViews: GPUTextureView[] = [];
  lightGlazeMipDownsampleBindGroups: GPUBindGroup[] = [];
  lightGlazeCompositeMipBindGroup: GPUBindGroup | null = null;
  lightGlazeDisplayBindGroup: GPUBindGroup | null = null;
  lightGlazeCompositeBindGroup: GPUBindGroup | null = null;
  lightGlazeCommitTileTexture: GPUTexture | null = null;
  lightGlazeCommitTileView: GPUTextureView | null = null;
  lightGlazeCommitTileBindGroup: GPUBindGroup | null = null;
  lightGlazeSession: LightGlazeSession | null = null;
  lightGlazeStaleRect: DirtyRect | null = null;
  lightGlazeStorageAllocated = false;
  lightGlazeStorageMode: LightGlazeStorageMode = "none";
  lightGlazeLoadingPromise: Promise<void> | null = null;
  private lightGlazeLoadingStorageMode: LightGlazeStorageMode = "none";
  private lightGlazeDesiredStorageMode: LightGlazeStorageMode = "none";
  lightGlazeTransitionPeakMiB = 0;
  stabilizationSnapshotTexture: GPUTexture | null = null;
  stabilizationSnapshotWidth = 0;
  stabilizationSnapshotHeight = 0;
  stabilizationSnapshotStorageMode: LightGlazeStorageMode = "none";
  stabilizationSnapshotRect: DirtyRect | null = null;
  thicknessTailTexture: GPUTexture | null = null;
  thicknessTailView: GPUTextureView | null = null;
  thicknessTailDisplayBindGroup: GPUBindGroup | null = null;
  thicknessTailTextureWidth = 0;
  thicknessTailTextureHeight = 0;
  thicknessTailPresentedRect: DirtyRect | null = null;
  readonly adaptivePreviewCanvas: HTMLCanvasElement | null;
  readonly adaptivePreviewContext: CanvasRenderingContext2D | null;
  private readonly adaptivePreviewScratchCanvas: HTMLCanvasElement | null;
  private readonly adaptivePreviewScratchContext: CanvasRenderingContext2D | null;
  readonly adaptiveSpacingMaxExtraPercentPoints: number;
  readonly adaptivePreviewVisibleCanvasRequestedDesynchronized: boolean;
  readonly adaptivePreviewVisibleContextAttributes: AdaptivePreviewContextAttributes;
  readonly adaptivePreviewScratchContextAttributes: AdaptivePreviewContextAttributes;
  adaptivePreviewShapeSprite: HTMLCanvasElement | null = null;
  adaptivePreviewShapePalette: AdaptivePreviewShapePaletteEntry[] = [];
  adaptivePreviewShapePaletteKey = "";
  adaptivePreviewGeneration = 1;
  adaptivePreviewSubmissionsSinceProbe = 0;
  adaptivePreviewSubmittedSerial = 0;
  adaptivePreviewConfirmedSerial = 0;
  adaptivePreviewLastPresentedSerial = 0;
  adaptivePreviewLastIncompleteRetrySerial = 0;
  adaptivePreviewCandidates: AdaptivePreviewCandidate[] = [];
  adaptivePreviewProbe: AdaptivePreviewProbe | null = null;
  adaptivePreviewConsecutiveSlowProbes = 0;
  adaptivePreviewActive = false;
  adaptivePreviewFrozen = false;
  adaptivePreviewForceStroke = false;
  adaptivePreviewStartedAt = 0;
  adaptivePreviewRetirementTargetSerial = 0;
  adaptivePreviewFrameRequest: number | null = null;
  adaptivePreviewRetirementFrame: number | null = null;
  private adaptivePreviewCssWidth = 0;
  private adaptivePreviewCssHeight = 0;
  private canvasCssWidth = 1;
  private canvasCssHeight = 1;

  brushUniformBuffer!: GPUBuffer;
  thicknessTailBrushUniformBuffer!: GPUBuffer;
  grainUniformBuffer!: GPUBuffer;
  displayUniformBuffer!: GPUBuffer;
  vectorTextCaptureUniformBuffer!: GPUBuffer;
  vectorTextFallbackCaptureUniformBuffer!: GPUBuffer;
  thicknessTailDisplayUniformBuffer!: GPUBuffer;
  lightGlazeUniformBuffer!: GPUBuffer;
  lightGlazeCommitTileUniformBuffer!: GPUBuffer;
  instanceBuffer!: GPUBuffer;
  thicknessTailInstanceBuffer!: GPUBuffer;
  shapeOccupancyUniformBuffers: GPUBuffer[] = [];
  sampler!: GPUSampler;
  shapeMaskTexture: GPUTexture | null = null;
  shapeResourceSet: ShapeMaskResources | null = null;
  shapeMaskView!: GPUTextureView;
  shapeMaskPlaceholderTexture!: GPUTexture;
  shapeMaskPlaceholderView!: GPUTextureView;
  shapeResident = false;
  shapeLoadingPromise: Promise<void> | null = null;
  shapeDesiredAssetId: BrushShapeAssetId = "legacy-shape";
  shapeDesiredInvert = false;
  shapeLoadingAssetId: BrushShapeAssetId | null = null;
  shapeLoadingInvert: boolean | null = null;
  shapeLoadedAssetId: BrushShapeAssetId | null = null;
  shapeLoadedInvert: boolean | null = null;
  shapeMaskSampler!: GPUSampler;
  grainTexture: GPUTexture | null = null;
  grainResourceSet: GrainTextureResources | null = null;
  grainTextureView!: GPUTextureView;
  grainPlaceholderTexture!: GPUTexture;
  grainPlaceholderView!: GPUTextureView;
  grainResident = false;
  grainLoadingPromise: Promise<void> | null = null;
  grainDesiredAssetId: BrushGrainAssetId = "legacy-grain";
  grainLoadingAssetId: BrushGrainAssetId | null = null;
  grainLoadedAssetId: BrushGrainAssetId | null = null;
  grainSamplers!: Record<"fixed" | "moving", Record<GrainFiltering, GPUSampler>>;
  grainTextureIdentity = 0;
  grainTextureWidth = GRAIN_TEXTURE_SIZE;
  grainTextureHeight = GRAIN_TEXTURE_SIZE;
  grainTextureMipLevelCount = GRAIN_TEXTURE_MIP_LEVEL_COUNT;
  grainTextureMemoryBytes = GRAIN_TEXTURE_PIXEL_COUNT * 4;
  grainPreviewSprite: HTMLCanvasElement | null = null;
  grainStartupDecodeMs = 0;
  grainStartupMipBuildMs = 0;
  grainStartupUploadMs = 0;
  shapeMaskDecodeStrategy: ShapeMaskDecodeStrategy = SHAPE_CANVAS_DECODE_STRATEGY;
  shapeMaskIdentity = 0;
  shapeOccupancyActiveCells = new Array<number>(SHAPE_OCCUPANCY_MAP_COUNT).fill(0);
  shapeOccupancyCoverageRatios = new Array<number>(SHAPE_OCCUPANCY_MAP_COUNT).fill(1);
  packedMinimumRadius = Number.POSITIVE_INFINITY;

  brushBindGroupLayout!: GPUBindGroupLayout;
  brushOccupancyBindGroupLayout!: GPUBindGroupLayout;
  grainBrushBindGroupLayout!: GPUBindGroupLayout;
  grainBrushOccupancyBindGroupLayout!: GPUBindGroupLayout;
  selectionMaskBindGroupLayout!: GPUBindGroupLayout;
  displayBindGroupLayout!: GPUBindGroupLayout;
  vectorTextDisplayBindGroupLayout: GPUBindGroupLayout | null = null;
  mixedSceneRasterSegmentBindGroupLayout: GPUBindGroupLayout | null = null;
  mixedSceneTextSegmentBindGroupLayout: GPUBindGroupLayout | null = null;
  rasterImageMipmapBindGroupLayout: GPUBindGroupLayout | null = null;
  rasterImageMixedSceneBindGroupLayout: GPUBindGroupLayout | null = null;
  vectorTextGpuSlugBindGroupLayout: GPUBindGroupLayout | null = null;
  mixedScenePresentBindGroupLayout: GPUBindGroupLayout | null = null;
  layerBlendCompositorBindGroupLayout: GPUBindGroupLayout | null = null;
  vectorTextGpuUniformBindGroupLayout: GPUBindGroupLayout | null = null;
  vectorTextGpuBlurFilterBindGroupLayout: GPUBindGroupLayout | null = null;
  vectorTextGpuBlurCompositeBindGroupLayout: GPUBindGroupLayout | null = null;
  vectorTextGpuInnerShadowBindGroupLayout: GPUBindGroupLayout | null = null;
  rasterStrokeDisplayScreenBindGroupLayout!: GPUBindGroupLayout;
  rasterStrokeDisplaySourceBindGroupLayout!: GPUBindGroupLayout;
  thicknessTailDisplayBindGroupLayout!: GPUBindGroupLayout;
  lightGlazeDisplayBindGroupLayout!: GPUBindGroupLayout;
  lightGlazeCompositeMipBindGroupLayout!: GPUBindGroupLayout;
  lightGlazeCompositeBindGroupLayout!: GPUBindGroupLayout;
  lightGlazeCommitTileBindGroupLayout!: GPUBindGroupLayout;
  paintMipDownsampleBindGroupLayout!: GPUBindGroupLayout;
  paintStackCompositeMipBindGroupLayout!: GPUBindGroupLayout;
  layerCompositeBindGroupLayout!: GPUBindGroupLayout;
  layerBlendFoldBindGroupLayout!: GPUBindGroupLayout;
  brushBindGroup!: GPUBindGroup;
  thicknessTailBrushBindGroup!: GPUBindGroup;
  brushOccupancyBindGroups: GPUBindGroup[] = [];
  thicknessTailBrushOccupancyBindGroups: GPUBindGroup[] = [];
  grainBrushBindGroups!: Record<
    "fixed" | "moving",
    Record<GrainFiltering, GPUBindGroup>
  >;
  grainBrushOccupancyBindGroups!: Record<
    "fixed" | "moving",
    Record<GrainFiltering, GPUBindGroup[]>
  >;
  thicknessTailGrainBrushBindGroups!: Record<
    "fixed" | "moving",
    Record<GrainFiltering, GPUBindGroup>
  >;
  thicknessTailGrainBrushOccupancyBindGroups!: Record<
    "fixed" | "moving",
    Record<GrainFiltering, GPUBindGroup[]>
  >;
  displayBindGroup!: GPUBindGroup;
  rasterStrokeDisplayScreenBindGroup!: GPUBindGroup;

  brushShaderModule!: GPUShaderModule;
  texturizedGrainShaderModule!: GPUShaderModule;
  selectionBrushShaderModule!: GPUShaderModule;
  selectionTexturizedGrainShaderModule!: GPUShaderModule;
  displayShaderModule!: GPUShaderModule;
  vectorTextGpuSlugShaderModule: GPUShaderModule | null = null;
  vectorTextDisplayShaderModule: GPUShaderModule | null = null;
  vectorTextGpuShaderModule: GPUShaderModule | null = null;
  vectorTextGpuGaussianBlurShaderModule: GPUShaderModule | null = null;
  vectorTextGpuBlurCompositeShaderModule: GPUShaderModule | null = null;
  vectorTextGpuInnerShadowShaderModule: GPUShaderModule | null = null;
  mixedSceneRasterSegmentShaderModule: GPUShaderModule | null = null;
  mixedSceneTextSegmentShaderModule: GPUShaderModule | null = null;
  rasterImageMipmapShaderModule: GPUShaderModule | null = null;
  rasterImageMixedSceneShaderModule: GPUShaderModule | null = null;
  mixedSceneClearShaderModule: GPUShaderModule | null = null;
  mixedScenePresentShaderModule: GPUShaderModule | null = null;
  layerBlendCompositorShaderModule: GPUShaderModule | null = null;
  rasterStrokeDisplayShaderModule!: GPUShaderModule;
  thicknessTailDisplayShaderModule!: GPUShaderModule;
  lightGlazeDisplayShaderModule!: GPUShaderModule;
  lightGlazeCompositeMipShaderModule!: GPUShaderModule;
  lightGlazeCompositeShaderModule!: GPUShaderModule;
  lightGlazeCommitTileShaderModule!: GPUShaderModule;
  lightGlazeClearShaderModule!: GPUShaderModule;
  paintMipDownsampleShaderModule!: GPUShaderModule;
  paintStackCompositeMipShaderModule!: GPUShaderModule;
  layerCompositeShaderModule!: GPUShaderModule;
  layerBlendFoldShaderModule!: GPUShaderModule;
  normalPipeline!: GPURenderPipeline;
  additivePipeline!: GPURenderPipeline;
  shapeNormalPipeline!: GPURenderPipeline;
  shapeAdditivePipeline!: GPURenderPipeline;
  shapeOccupancyNormalPipeline!: GPURenderPipeline;
  shapeOccupancyAdditivePipeline!: GPURenderPipeline;
  grainNormalPipeline!: GPURenderPipeline;
  grainAdditivePipeline!: GPURenderPipeline;
  grainShapeNormalPipeline!: GPURenderPipeline;
  grainShapeAdditivePipeline!: GPURenderPipeline;
  grainShapeOccupancyNormalPipeline!: GPURenderPipeline;
  grainShapeOccupancyAdditivePipeline!: GPURenderPipeline;
  uniformedGlazePipeline!: GPURenderPipeline;
  uniformedGlazeShapePipeline!: GPURenderPipeline;
  uniformedGlazeShapeOccupancyPipeline!: GPURenderPipeline;
  grainUniformedGlazePipeline!: GPURenderPipeline;
  grainUniformedGlazeShapePipeline!: GPURenderPipeline;
  grainUniformedGlazeShapeOccupancyPipeline!: GPURenderPipeline;
  intenseBlendingPipeline!: GPURenderPipeline;
  intenseBlendingShapePipeline!: GPURenderPipeline;
  intenseBlendingShapeOccupancyPipeline!: GPURenderPipeline;
  grainIntenseBlendingPipeline!: GPURenderPipeline;
  grainIntenseBlendingShapePipeline!: GPURenderPipeline;
  grainIntenseBlendingShapeOccupancyPipeline!: GPURenderPipeline;
  lightNoBuildUpPipeline!: GPURenderPipeline;
  lightNoBuildUpShapePipeline!: GPURenderPipeline;
  lightNoBuildUpShapeOccupancyPipeline!: GPURenderPipeline;
  grainLightNoBuildUpPipeline!: GPURenderPipeline;
  grainLightNoBuildUpShapePipeline!: GPURenderPipeline;
  grainLightNoBuildUpShapeOccupancyPipeline!: GPURenderPipeline;
  selectionPipelineByBase = new Map<GPURenderPipeline, GPURenderPipeline>();
  vectorTextGpuSlugPipeline: GPURenderPipeline | null = null;
  displayPipeline!: GPURenderPipeline;
  finalRasterStackDisplayPipeline!: GPURenderPipeline;
  vectorTextDisplayPipeline: GPURenderPipeline | null = null;
  vectorTextGpuFillPipeline: GPURenderPipeline | null = null;
  vectorTextGpuBlurMaskPipeline: GPURenderPipeline | null = null;
  vectorTextGpuMeshBlurMaskPipeline: GPURenderPipeline | null = null;
  vectorTextGpuBlurHorizontalPipeline: GPURenderPipeline | null = null;
  vectorTextGpuBlurVerticalPipeline: GPURenderPipeline | null = null;
  vectorTextGpuBlurCompositePipeline: GPURenderPipeline | null = null;
  vectorTextGpuInnerShadowDirectPipeline: GPURenderPipeline | null = null;
  vectorTextGpuInnerShadowBlurPipeline: GPURenderPipeline | null = null;
  vectorTextGpuMeshInnerShadowBlurPipeline: GPURenderPipeline | null = null;
  vectorTextGpuClearPipeline: GPURenderPipeline | null = null;
  mixedSceneClearPipeline: GPURenderPipeline | null = null;
  mixedSceneRasterSegmentPipeline: GPURenderPipeline | null = null;
  mixedSceneTextSegmentPipeline: GPURenderPipeline | null = null;
  rasterImageMipmapPipeline: GPURenderPipeline | null = null;
  rasterImagePremultiplyPipeline: GPURenderPipeline | null = null;
  rasterImageMixedScenePipeline: GPURenderPipeline | null = null;
  mixedScenePresentPipeline: GPURenderPipeline | null = null;
  layerBlendCompositorPipeline: GPURenderPipeline | null = null;
  layerBlendCompositorUniformBuffer: GPUBuffer | null = null;
  layerBlendCompositorUniformStride = 0;
  mixedSceneActiveDisplayPipeline: GPURenderPipeline | null = null;
  mixedSceneActiveRasterStrokeDisplayPipeline: GPURenderPipeline | null = null;
  mixedSceneActiveThicknessTailDisplayPipeline: GPURenderPipeline | null = null;
  mixedSceneActiveLightGlazeDisplayPipeline: GPURenderPipeline | null = null;
  rasterImageSampler: GPUSampler | null = null;
  rasterStrokeDisplayPipeline!: GPURenderPipeline;
  thicknessTailDisplayPipeline!: GPURenderPipeline;
  lightGlazeDisplayPipeline!: GPURenderPipeline;
  lightGlazeCompositeMipPipeline!: GPURenderPipeline;
  lightGlazeCompositePipeline!: GPURenderPipeline;
  lightGlazeCommitTilePipeline!: GPURenderPipeline;
  lightGlazeClearR8Pipeline!: GPURenderPipeline;
  lightGlazeClearRgba16FloatPipeline!: GPURenderPipeline;
  paintMipDownsamplePipeline!: GPURenderPipeline;
  paintStackCompositeMipPipeline!: GPURenderPipeline;
  activeClippingGroupMipPipeline!: GPURenderPipeline;
  layerCompositePipeline!: GPURenderPipeline;
  layerSourceAtopPipeline!: GPURenderPipeline;
  layerBlendFoldPipeline!: GPURenderPipeline;

  private readonly instanceUpload = new ArrayBuffer(MAX_STAMPS_PER_BATCH * STAMP_STRIDE_BYTES);
  readonly instanceUploadF32 = new Float32Array(this.instanceUpload);
  readonly instanceUploadU32 = new Uint32Array(this.instanceUpload);
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
  readonly vectorTextCaptureUniformUpload = new Float32Array(8);
  readonly vectorTextFallbackCaptureUniformUpload = new Float32Array(8);
  layerCompositeUniformBuffer!: GPUBuffer;
  private readonly thicknessTailDisplayUniformUpload = new ArrayBuffer(
    THICKNESS_TAIL_UNIFORM_BYTES,
  );

  settings: BrushSettings = { ...defaultBrushSettings };
  readonly customBrushAssets = new CustomBrushAssetRegistry();
  pendingStamps: Stamp[] = [];
  pendingBlendBatches: PendingBlendBatch[] = [];
  private readonly paintCurvePlanner = new CausalStrokeCurvePlanner();
  private readonly paintStabilizer = new CausalFadedStrokeStabilizer();
  private readonly stabilizationPreviewCurvePlanner = new CausalStrokeCurvePlanner();
  private readonly stabilizationPreviewStamps: Stamp[] = [];
  private stabilizationPreviewStampCount = 0;
  activeStroke: ActiveStroke | null = null;
  seedSequence = 1;

  historyActions: HistoryAction[] = [];
  historyCursor = 0;
  nextHistoryActionId = 1;
  discardedVectorRasterHistoryActions: VectorRasterizeHistoryAction[] = [];
  discardedRasterImportHistoryActions: RasterImportHistoryAction[] = [];

  /** Cancellazioni abbandonate dal Redo: i loro seed vanno liberati. */
  discardedLayerDeleteHistoryActions: LayerDeleteHistoryAction[] = [];
  discardedRasterTransformHistoryActions: RasterTransformHistoryAction[] = [];
  historyBatches: HistoryRenderBatch[] = [];
  selectionHistoryMasksByAction = new Map<number, SelectionHistoryMaskSnapshot>();
  selectionHistoryMasksByRevision = new Map<number, SelectionHistoryMaskSnapshot>();
  selectionHistoryClipBindGroups = new Map<number, GPUBindGroup>();
  selectionLiveClipBindGroup: {
    revision: number;
    buffer: GPUBuffer;
    bindGroup: GPUBindGroup;
  } | null = null;
  selectionOverlaySuppressed = false;
  selectionOverlayOffsetX = 0;
  selectionOverlayOffsetY = 0;
  historyStoredBaseStamps = 0;
  historyCompactionPending = false;
  historyBusy = false;
  historyStateInconsistent = false;
  activeVectorHistoryEdit: ActiveVectorHistoryEdit | null = null;
  activeRasterLayerMetadataHistoryEdit: (
    ActiveRasterLayerMetadataHistoryEdit & { readonly token: number }
  ) | null = null;
  nextRasterLayerMetadataHistoryEditToken = 1;
  activeRasterTransformSession: ActiveRasterTransformSession | null = null;
  historyGpuStorage!: GpuHistoryStorage;
  historyGpuTrimGeneration = 0;
  layerHasContent = false;

  frameRequest: number | null = null;
  clearRequested = true;
  displayDirty = true;
  semanticPresentationDirtyRect: DirtyRect | null = null;
  initialized = false;

  viewCenterX = LAYER_SIZE * 0.5;
  viewCenterY = LAYER_SIZE * 0.5;
  zoom = 1;
  viewRotation = 0;
  viewRotationCos = 1;
  viewRotationSin = 0;
  viewRotationGestureRaw = 0;
  viewRotationGestureActive = false;
  viewRotationSnappedToZero = true;
  hasFittedView = false;

  totalBaseStamps = 0;
  avoidedLogicalDraws = 0;
  lastCpuFrameMs = 0;
  renderTimestamps: number[] = [];
  gpuLabel = "GPU WebGPU";
  activeStrokeProfile: MutableStrokePerformanceProfile | null = null;
  lastStampGeometry: StampGeometry = STAMP_GEOMETRY;
  lastStampVerticesPerCopy = STAMP_VERTICES_PER_COPY;
  lastShapeSamplingStrategy: ShapeSamplingStrategy = "none";
  lastShapeOccupancyFallbackReason: ShapeOccupancyFallbackReason = "none";
  lastShapeOccupancyMipLevel = -1;
  lastShapeOccupancyActiveCells = 0;
  lastShapeOccupancyCoverageRatio = 0;
  lastShapeOccupancyCandidateMipLevel = -1;
  lastShapeOccupancyCandidateActiveCells = 0;
  lastShapeOccupancyCandidateCoverageRatio = 0;

  constructor(
    canvas: HTMLCanvasElement,
    callbacks: EngineCallbacks = {},
    adaptivePreviewCanvas: HTMLCanvasElement | null = null,
    options: BrushEngineOptions = {},
    selectionOverlayCanvas: HTMLCanvasElement | null = null,
  ) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.bevelBoundingFieldEnabled = options.bevelBoundingFieldEnabled === true;
    this.layerMemoryStressTestEnabled = options.layerMemoryStressTestEnabled === true;
    this.layerCompressionTestEnabled = options.layerCompressionTestEnabled === true;
    this.layerColdCompressionEnabled = options.layerColdCompressionEnabled === true;
    this.layerColdCompressionStatusEnabled =
      options.layerColdCompressionStatusEnabled === true;
    this.layerColdDirectHotHydrationEnabled =
      options.layerColdDirectHotHydrationEnabled !== false;
    this.layerColdAdjacentPrefetchEnabled =
      options.layerColdAdjacentPrefetchEnabled !== false;
    this.vectorTextPrototypeEnabled = options.vectorTextPrototypeEnabled === true;
    this.selectionOverlayCanvas = selectionOverlayCanvas;
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

    // Unico punto da cui il motore ottiene il device: strumentarlo qui rende
    // contabilizzata ogni allocazione, presente e futura, senza toccare i 125
    // siti che creano texture e buffer.
    const instrumented = instrumentGpuDevice(await adapter.requestDevice());
    this.device = instrumented.device;
    this.gpuResourceRegistry = instrumented.registry;
    this.deviceLostSignal = this.device.lost.then((info) => {
      this.invalidateAdaptivePreview();
      const reason = info.message || info.reason;
      const error = new Error(`Device WebGPU perso: ${reason}`);
      this.deviceLostError = error;
      this.renderFrameError ??= error;
      if (this.frameRequest !== null) {
        cancelAnimationFrame(this.frameRequest);
        this.frameRequest = null;
      }
      this.callbacks.onStatus?.(`Device WebGPU perso: ${reason}`, "error");
      return error;
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

    this.gpuLabel = describeAdapter(adapter);
    await createStaticResources(this);
    prepareAdaptivePreviewShapePalette(this, this.settings);
    await recreateLayerResources(this, this.layerFormat);

    this.historyGpuStorage = new GpuHistoryStorage(this.device);
    this.historyGpuStorage.prewarm();
    this.resizeCanvas();
    this.fitView();
    this.writeBrushUniforms();

    this.initialized = true;
    if (usesBlendRenderer(this.settings)) {
      this.blendRenderer?.prewarmScratch();
    }
    if (
      usesStrokeGlazeRenderer(this.settings)
    ) {
      await this.ensureLightGlazeResources(this.settings.blendMode);
    }
    if (this.settings.grainMode !== "off") {
      requestGrainLoad(this);
    }
    if (this.settings.shape === "shape") {
      requestShapeLoad(this);
    }
    clearAdaptivePreviewCanvas(this);
    this.requestRender();
    this.callbacks.onStatus?.("WebGPU pronto. Disegna sul canvas.", "ok");
    this.publishStats();
    this.publishHistoryState();
  }

  getSettings(): BrushSettings {
    return { ...this.settings };
  }

  registerCustomShapeAsset(
    source: DecodedCustomBrushImage,
    requestedId?: CustomBrushShapeAssetId,
  ): CustomBrushShapeAssetId {
    return this.customBrushAssets.registerShape(source, requestedId);
  }

  registerCustomGrainAsset(
    source: DecodedCustomBrushImage,
    requestedId?: CustomBrushGrainAssetId,
  ): CustomBrushGrainAssetId {
    return this.customBrushAssets.registerGrain(source, requestedId);
  }

  getCustomBrushAsset(
    id: BrushShapeAssetId | BrushGrainAssetId,
  ): CustomBrushAssetSnapshot | null {
    return this.customBrushAssets.snapshot(id);
  }

  removeCustomBrushAsset(id: BrushShapeAssetId | BrushGrainAssetId): boolean {
    if (!isCustomShapeAssetId(id) && !isCustomGrainAssetId(id)) {
      throw new TypeError("Soltanto gli asset custom possono essere rimossi.");
    }
    const referencedBySettings = this.settings.shapeAssetId === id
      || this.settings.grainAssetId === id;
    const referencedByResources = this.shapeLoadedAssetId === id
      || this.shapeLoadingAssetId === id
      || this.shapeDesiredAssetId === id
      || this.grainLoadedAssetId === id
      || this.grainLoadingAssetId === id
      || this.grainDesiredAssetId === id;
    const referencedByHistory = this.historyBatches.some((batch) => (
      batch.kind !== "fill"
      && (batch.settings.shapeAssetId === id || batch.settings.grainAssetId === id)
    ));
    if (referencedBySettings || referencedByResources || referencedByHistory) {
      throw new Error("L'asset custom è ancora attivo o necessario alla cronologia.");
    }
    return this.customBrushAssets.remove(id);
  }

  renderBrushTipPreview(
    canvas: HTMLCanvasElement,
    cssSize: number,
    diameterCssPixels: number,
    opacity = 1,
  ): void {
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;

    const logicalSize = Math.max(1, Math.round(cssSize));
    const pixelRatio = clamp(window.devicePixelRatio || 1, 1, 2);
    const backingSize = Math.max(1, Math.round(logicalSize * pixelRatio));
    if (canvas.width !== backingSize || canvas.height !== backingSize) {
      canvas.width = backingSize;
      canvas.height = backingSize;
    }

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.clearRect(0, 0, logicalSize, logicalSize);

    const diameter = clamp(diameterCssPixels, 0, logicalSize - 4);
    const alpha = clamp(opacity, 0, 1);
    if (diameter <= 0 || alpha <= 0) return;

    const left = (logicalSize - diameter) * 0.5;
    const top = (logicalSize - diameter) * 0.5;
    const neutralTipColor = "rgb(242 240 233)";
    const shapeSprite = this.settings.shape === "shape"
      ? this.adaptivePreviewShapePalette[0]?.sprite ?? this.adaptivePreviewShapeSprite
      : null;

    if (shapeSprite) {
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(shapeSprite, left, top, diameter, diameter);
      context.globalCompositeOperation = "source-in";
      context.globalAlpha = alpha;
      context.fillStyle = neutralTipColor;
      context.fillRect(left, top, diameter, diameter);
    } else {
      const center = logicalSize * 0.5;
      const radius = diameter * 0.5;
      context.globalAlpha = alpha;
      context.beginPath();
      context.arc(center, center, radius, 0, Math.PI * 2);
      if (this.settings.hardness >= 0.995) {
        context.fillStyle = neutralTipColor;
      } else {
        const gradient = context.createRadialGradient(center, center, 0, center, center, radius);
        const innerStop = clamp(this.settings.hardness, 0, 0.999);
        gradient.addColorStop(0, neutralTipColor);
        gradient.addColorStop(innerStop, neutralTipColor);
        gradient.addColorStop(1, "rgb(242 240 233 / 0)");
        context.fillStyle = gradient;
      }
      context.fill();
    }

    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
  }

  setBrushSettings(next: Partial<BrushSettings>): void {
    if (this.initialized && (this.layerSwitchBusy || this.historyBusy)) {
      throw new Error(
        "Le impostazioni non possono cambiare durante uno switch o un replay della cronologia.",
      );
    }
    flushPendingWorkBeforeSettingsChange(this);
    const previousUsesBlendRenderer = usesBlendRenderer(this.settings);
    const tool = next.tool === "paint" || next.tool === "blend"
      ? next.tool
      : this.settings.tool;
    const blendMode = next.blendMode === "normal"
      || next.blendMode === "additive"
      || next.blendMode === "light-glaze"
      || next.blendMode === "uniformed-glaze"
      || next.blendMode === "intense-blending"
      || next.blendMode === "m1-glaze"
      ? next.blendMode
      : this.settings.blendMode;
    this.settings = {
      ...this.settings,
      ...next,
      tool,
      shape: next.shape === "shape" || next.shape === "circle" ? next.shape : this.settings.shape,
      shapeAssetId: normalizeShapeAssetId(next.shapeAssetId ?? this.settings.shapeAssetId),
      shapeInvert: typeof next.shapeInvert === "boolean"
        ? next.shapeInvert
        : this.settings.shapeInvert,
      shapeRotation: next.shapeRotation === "follow-stroke" || next.shapeRotation === "fixed"
        ? next.shapeRotation
        : this.settings.shapeRotation,
      shapeScatter: clamp(next.shapeScatter ?? this.settings.shapeScatter, 0, 1),
      grainMode: next.grainMode === "off"
        || next.grainMode === "texturized"
        || next.grainMode === "moving"
        ? next.grainMode
        : this.settings.grainMode,
      grainAssetId: normalizeGrainAssetId(next.grainAssetId ?? this.settings.grainAssetId),
      grainScale: clamp(next.grainScale ?? this.settings.grainScale, 0.1, 4),
      grainMovement: clamp(next.grainMovement ?? this.settings.grainMovement, 0, 1),
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
      size: clamp(
        next.size ?? this.settings.size,
        1,
        // The public mobile control stops at 1000 px. Keep the historical
        // internal headroom used by the canonical Blend background fixture.
        tool === "blend" ? 1024 : 1500,
      ),
      spacingPercent: clamp(
        next.spacingPercent ?? this.settings.spacingPercent,
        tool === "blend" ? 1 : 0.25,
        tool === "blend" ? 400 : 25,
      ),
      stabilization: clamp(next.stabilization ?? this.settings.stabilization, 0, 1),
      startThickness: clamp(next.startThickness ?? this.settings.startThickness, 0, 2),
      endThickness: clamp(next.endThickness ?? this.settings.endThickness, 0, 2),
      flow: clamp(next.flow ?? this.settings.flow, 0.001, 1),
      opacity: clamp(next.opacity ?? this.settings.opacity, 0, 1),
      // Brush Studio intentionally has no Paint hardness control. Preserve the
      // dry Blend setting, while every Paint setting/history batch is authored at 100%.
      hardness: tool === "paint" ? 1 : clamp(next.hardness ?? this.settings.hardness, 0, 1),
      // Kept in the history ABI only. Rendering now has one unambiguous Flow control.
      blendIntensity: 1,
      blendMode,
      blendStretch: clamp(next.blendStretch ?? this.settings.blendStretch, 0, 1),
      blendPaint: clamp(next.blendPaint ?? this.settings.blendPaint, 0, 1),
      // Legacy presets may still carry this field, but the four Color Dynamics
      // controls are authoritative and must never be scaled a second time.
      jitterMaster: 1,
      hueJitterDegrees: clamp(next.hueJitterDegrees ?? this.settings.hueJitterDegrees, 0, 180),
      saturationJitter: clamp(next.saturationJitter ?? this.settings.saturationJitter, 0, 1),
      lightnessJitter: clamp(next.lightnessJitter ?? this.settings.lightnessJitter, 0, 1),
      darknessJitter: clamp(next.darknessJitter ?? this.settings.darknessJitter, 0, 1),
      positionJitterLateral: clamp(next.positionJitterLateral ?? this.settings.positionJitterLateral, 0, 1),
      positionJitterLinear: clamp(next.positionJitterLinear ?? this.settings.positionJitterLinear, 0, 1),
    };
    prepareAdaptivePreviewShapePalette(this, this.settings);

    if (this.initialized) {
      const nextUsesBlendRenderer = usesBlendRenderer(this.settings);
      const glazeSelected = usesStrokeGlazeRenderer(this.settings);
      this.lightGlazeDesiredStorageMode = glazeSelected
        ? lightGlazeStorageModeFor(this.settings.blendMode)
        : "none";

      if (!glazeSelected) {
        maybeReleaseIdleLightGlazeResources(this);
      }
      if (
        this.settings.stabilization === 0
        && !this.activeStroke
        && !this.lightGlazeSession
      ) {
        destroyStrokeStabilizationSnapshot(this);
      }
      if (!nextUsesBlendRenderer && previousUsesBlendRenderer) {
        maybeReleaseIdleBlendScratch(this);
      }
      if (nextUsesBlendRenderer) {
        // Prewarm on selection so allocation never lands inside the first stroke.
        this.blendRenderer?.prewarmScratch();
      }
      if (
        glazeSelected
        && !this.lightGlazeSession
        && !this.activeStroke
      ) {
        // Prewarm at selection (including r8↔rgba retarget).
        requestLightGlazeResources(this, this.settings.blendMode);
      }
      if (this.settings.grainMode !== "off") {
        requestGrainLoad(this);
      } else {
        maybeReleaseIdleGrainResources(this);
      }
      if (this.settings.shape === "shape") {
        requestShapeLoad(this);
      } else {
        maybeReleaseIdleShapeResources(this);
      }
      this.invalidateAdaptivePreview();
      this.writeBrushUniforms();
      if (isTexturizedGrainActive(this.settings)) {
        this.writeGrainUniforms(this.settings);
      }
      this.displayDirty = true;
      this.requestRender();
    }
  }

  getRasterStrokeStyle(): RasterStrokeStyle {
    return copyRasterStrokeStyle(this.rasterStrokeStyle);
  }

  getRasterColorOverlayStyle(): RasterColorOverlayStyle {
    return copyRasterColorOverlayStyle(this.rasterColorOverlayStyle);
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

  styleStackNeedsCompositor(): boolean {
    return layerEffectRendererRequirements(
      this.rasterStrokeStyle,
      this.rasterBevelStyle,
      this.rasterOuterShadowStyle,
      this.rasterInnerShadowStyle,
      this.rasterColorOverlayStyle,
    ).needsStrokeRenderer;
  }

  styleStackActive(): boolean {
    return Boolean(this.rasterStrokeRenderer && this.styleStackNeedsCompositor());
  }

  usesOrderedScenePresentation(): boolean {
    return Boolean(this.mixedSceneStack?.visibleSemanticCount)
      || orderedLayerBlendPresentationRequired(this);
  }

  usesLayerBlendTilePresentation(): boolean {
    return layerBlendTilePresentationRequired(this);
  }

  compositionSegmentBlendMode(segment: MixedSceneCompositionSegment): LayerBlendMode {
    return mixedSceneSegmentLayerBlendMode(this, segment);
  }

  mergedBelowView(): GPUTextureView {
    return this.mergedBelow?.samplingView ?? this.transparentLayerView;
  }

  mergedAboveView(): GPUTextureView {
    return this.mergedAbove?.samplingView ?? this.transparentLayerView;
  }

  activeClippingPrefixView(): GPUTextureView {
    return this.activeClippingGroup?.prefix?.samplingView ?? this.transparentLayerView;
  }

  activeClippingSuffixView(): GPUTextureView {
    return this.activeClippingGroup?.suffix?.samplingView ?? this.transparentLayerView;
  }

  rebuildRasterStrokeDisplayBindGroups(): void {
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
          this.activeClippingPrefixView(),
          this.activeClippingSuffixView(),
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
  async setRasterStrokeGeometryEnabled(enabled: boolean): Promise<boolean> {
    return await setRasterStrokeGeometryEnabled(this, enabled);
  }

  requireEffectsWorkbench(): EffectsWorkbench {
    if (!this.effectsWorkbench) {
      throw new Error("Banco effetti non inizializzato per il layer attivo.");
    }
    return this.effectsWorkbench;
  }

  releaseRasterStrokeRenderer(): void {
    releaseRasterStrokeRenderer(this);
  }

  releaseRasterBevelRenderer(): void {
    releaseRasterBevelRenderer(this);
  }

  releaseRasterOuterShadowRenderer(): void {
    releaseRasterOuterShadowRenderer(this);
  }

  releaseRasterInnerShadowRenderer(): void {
    releaseRasterInnerShadowRenderer(this);
  }

  async setRasterColorOverlayStyle(style: unknown): Promise<boolean> {
    const normalized = normalizeRasterColorOverlayStyle(style);
    const normalizedActive = normalized.enabled && normalized.opacity > 0;
    if (this.initialized && !this.rasterLayerMetadataHistoryEditAllows("color-overlay")) {
      return false;
    }
    if (this.initialized && this.layerSwitchBusy) {
      return false;
    }
    if (
      rasterColorOverlayStylesEqual(normalized, this.rasterColorOverlayStyle)
      && (!normalizedActive || Boolean(this.rasterStrokeRenderer))
    ) {
      return true;
    }
    if (!this.initialized) {
      this.rasterColorOverlayStyle = normalized;
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

    flushPendingWorkBeforeSettingsChange(this);
    const historyBefore = captureRasterLayerMetadataHistoryState(
      this,
      this.layerStack.active.id,
      "color-overlay",
    );
    const previous = copyRasterColorOverlayStyle(this.rasterColorOverlayStyle);
    const previousActive = previous.enabled && previous.opacity > 0;
    const previousDisplayUsesStyle = Boolean(
      this.rasterStrokeRenderer && this.styleStackNeedsCompositor(),
    );
    const nextStackNeedsCompositor = layerEffectRendererRequirements(
      this.rasterStrokeStyle,
      this.rasterBevelStyle,
      this.rasterOuterShadowStyle,
      this.rasterInnerShadowStyle,
      normalized,
    ).needsStrokeRenderer;
    const rendererNeedsCreation = normalizedActive && !this.rasterStrokeRenderer;
    const rendererWillBeReleased = Boolean(
      this.rasterStrokeRenderer && !nextStackNeedsCompositor,
    );
    const styleDirtyRect = previousActive || normalizedActive
      ? this.layerContentBounds
        ?? (this.layerHasContent
          ? { x: 0, y: 0, width: LAYER_SIZE, height: LAYER_SIZE }
          : null)
      : null;
    this.rasterStrokeBusy = true;
    try {
      // Destroying a renderer must wait for every older submission. Hot color
      // and opacity edits only enqueue new uniform data after older queue work,
      // so they do not pay a queue-idle round trip.
      if (rendererWillBeReleased) {
        await this.waitForIdle();
      }
      if (normalizedActive) {
        if (rendererNeedsCreation) {
          this.callbacks.onStatus?.(
            "Preparo la Sovrapposizione colore WebGPU…",
            "working",
          );
        }
        await ensureRasterStrokeRenderer(
          this,
          this.rasterStrokeStyle.width,
          this.rasterStrokeStyle.enabled && this.rasterStrokeStyle.width > 0,
        );
        this.requireEffectsWorkbench().scratchPool.declareEffect(
          RASTER_COLOR_OVERLAY_EFFECT_ID,
          [],
        );
      }

      this.rasterColorOverlayStyle = normalized;
      invalidateActiveLayerBake(this);
      this.rasterStrokePendingComposeRect = mergeDirtyRects(
        this.rasterStrokePendingComposeRect,
        styleDirtyRect,
      );

      if (!normalizedActive) {
        this.requireEffectsWorkbench().scratchPool.releaseRequirement(
          RASTER_COLOR_OVERLAY_EFFECT_ID,
        );
        if (rendererWillBeReleased) {
          releaseRasterStrokeRenderer(this);
        }
      }

      this.paintDisplayMipValidThroughLevel = 0;
      const nextDisplayUsesStyle = Boolean(
        this.rasterStrokeRenderer && this.styleStackNeedsCompositor(),
      );
      if (previousDisplayUsesStyle !== nextDisplayUsesStyle) {
        this.presentationCacheNeedsFullRebuild = true;
      }
      this.displayDirty = true;
      this.requestRender();
      this.callbacks.onStatus?.(
        normalizedActive
          ? "Sovrapposizione colore WebGPU attiva."
          : normalized.enabled
            ? "Sovrapposizione colore attiva ma invisibile: opacità 0%."
            : "Sovrapposizione colore disattivata.",
        "ok",
      );
      this.publishStats();
      this.recordRasterLayerMetadataMutation("color-overlay", historyBefore);
      return true;
    } catch (error) {
      this.rasterColorOverlayStyle = previous;
      try {
        if (previousActive) {
          await ensureRasterStrokeRenderer(
            this,
            this.rasterStrokeStyle.width,
            this.rasterStrokeStyle.enabled && this.rasterStrokeStyle.width > 0,
          );
          this.requireEffectsWorkbench().scratchPool.declareEffect(
            RASTER_COLOR_OVERLAY_EFFECT_ID,
            [],
          );
        } else {
          this.requireEffectsWorkbench().scratchPool.releaseRequirement(
            RASTER_COLOR_OVERLAY_EFFECT_ID,
          );
          if (!this.styleStackNeedsCompositor()) {
            releaseRasterStrokeRenderer(this);
          }
        }
      } catch (restoreError) {
        console.error(
          "Ripristino Sovrapposizione colore non riuscito",
          restoreError,
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      this.callbacks.onStatus?.(
        `Sovrapposizione colore WebGPU non disponibile: ${message}`,
        "error",
      );
      throw error;
    } finally {
      this.rasterStrokeBusy = false;
    }
  }

  async setRasterStrokeStyle(style: unknown): Promise<boolean> {
    const normalized = normalizeRasterStrokeStyle(style);
    const normalizedActive = normalized.enabled && normalized.width > 0;
    if (this.initialized && !this.rasterLayerMetadataHistoryEditAllows("stroke")) {
      return false;
    }
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

    flushPendingWorkBeforeSettingsChange(this);
    const historyBefore = captureRasterLayerMetadataHistoryState(
      this,
      this.layerStack.active.id,
      "stroke",
    );
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
          const renderer = await ensureRasterStrokeRenderer(this, normalized.width, true);
          if (renderer.scratchExtent !== scratchExtent) {
            renderer.resizeScratch(scratchExtent);
          }
        }
      }

      this.rasterStrokeStyle = normalized;
      invalidateActiveLayerBake(this);
      if (nextActive) {
        const coverageStyleChanged = normalized.width !== previous.width
          || normalized.position !== previous.position;
        if (!previousActive || coverageStyleChanged) {
          this.rasterStrokeCoverageValid = false;
        }
        this.rasterStrokePendingComposeRect = rasterStrokeEffectRect(this, 
          this.layerContentBounds,
          Math.max(previous.width, normalized.width),
        );
        this.presentationCacheNeedsFullRebuild = true;
        this.displayDirty = true;
        this.requestRender();
        this.callbacks.onStatus?.("Traccia WebGPU attiva.", "ok");
      } else {
        await this.waitForIdle();
        if (this.styleStackNeedsCompositor()) {
          await setRasterStrokeGeometryEnabled(this, false);
          this.rasterStrokePendingComposeRect = rasterStrokeEffectRect(this, 
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
          releaseRasterStrokeRenderer(this);
        }
        this.paintDisplayMipValidThroughLevel = 0;
        this.presentationCacheNeedsFullRebuild = true;
        this.displayDirty = true;
        this.requestRender();
        if (previousActive) {
          this.callbacks.onStatus?.(
            this.styleStackNeedsCompositor()
              ? "Traccia disattivata; il compositore condiviso resta per gli altri effetti."
              : "Traccia disattivata; memoria GPU liberata.",
            "ok",
          );
        }
      }
      this.publishStats();
      this.recordRasterLayerMetadataMutation("stroke", historyBefore);
      return true;
    } catch (error) {
      this.rasterStrokeStyle = previous;
      try {
        if (previousActive && !this.rasterStrokeRenderer) {
          await ensureRasterStrokeRenderer(this, previous.width, true);
        }
        if (this.rasterStrokeRenderer) {
          await setRasterStrokeGeometryEnabled(this, previousActive);
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
      if (!previousActive && !this.styleStackNeedsCompositor()) {
        releaseRasterStrokeRenderer(this);
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
    if (this.initialized && !this.rasterLayerMetadataHistoryEditAllows("bevel")) {
      return false;
    }
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

    flushPendingWorkBeforeSettingsChange(this);
    const historyBefore = captureRasterLayerMetadataHistoryState(
      this,
      this.layerStack.active.id,
      "bevel",
    );
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
      invalidateActiveLayerBake(this);
      if (normalized.enabled) {
        if (!this.rasterBevelRenderer) {
          this.callbacks.onStatus?.("Preparo lo Smusso/Rilievo Heightfield V2…", "working");
          await ensureRasterBevelRenderer(this);
        }
        if (!this.rasterStrokeRenderer) {
          await ensureRasterStrokeRenderer(this);
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
        this.rasterBevelPendingComposeRect = mergeDirtyRects(
          previousRect,
          nextRect,
        );
        this.callbacks.onStatus?.("Smusso/Rilievo Heightfield V2 attivo.", "ok");
      } else {
        this.rasterBevelPendingComposeRect = previousRect;
        releaseRasterBevelRenderer(this);
        if (!this.styleStackNeedsCompositor()) {
          releaseRasterStrokeRenderer(this);
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
      this.recordRasterLayerMetadataMutation("bevel", historyBefore);
      return true;
    } catch (error) {
      this.rasterBevelStyle = previous;
      if (!previousActive) {
        releaseRasterBevelRenderer(this);
        if (!this.styleStackNeedsCompositor()) {
          releaseRasterStrokeRenderer(this);
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
    if (this.initialized && !this.rasterLayerMetadataHistoryEditAllows("outer-shadow")) {
      return false;
    }
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

    flushPendingWorkBeforeSettingsChange(this);
    const historyBefore = captureRasterLayerMetadataHistoryState(
      this,
      this.layerStack.active.id,
      "outer-shadow",
    );
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
      invalidateActiveLayerBake(this);
      if (normalized.enabled) {
        if (!this.rasterOuterShadowRenderer) {
          this.callbacks.onStatus?.("Preparo l'Ombra esterna WebGPU…", "working");
          await ensureRasterOuterShadowRenderer(this);
        }
        if (!this.rasterStrokeRenderer) {
          await ensureRasterStrokeRenderer(this);
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
        this.rasterOuterShadowPendingComposeRect = mergeDirtyRects(
          previousRect,
          nextRect,
        );
        this.callbacks.onStatus?.("Ombra esterna WebGPU attiva.", "ok");
      } else {
        this.rasterOuterShadowPendingComposeRect = previousRect;
        releaseRasterOuterShadowRenderer(this);
        if (!this.styleStackNeedsCompositor()) {
          releaseRasterStrokeRenderer(this);
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
      this.recordRasterLayerMetadataMutation("outer-shadow", historyBefore);
      return true;
    } catch (error) {
      this.rasterOuterShadowStyle = previous;
      if (!previous.enabled) {
        releaseRasterOuterShadowRenderer(this);
        if (!this.styleStackNeedsCompositor()) {
          releaseRasterStrokeRenderer(this);
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
    if (this.initialized && !this.rasterLayerMetadataHistoryEditAllows("inner-shadow")) {
      return false;
    }
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

    flushPendingWorkBeforeSettingsChange(this);
    const historyBefore = captureRasterLayerMetadataHistoryState(
      this,
      this.layerStack.active.id,
      "inner-shadow",
    );
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
      invalidateActiveLayerBake(this);
      if (normalized.enabled) {
        if (!this.rasterInnerShadowRenderer) {
          this.callbacks.onStatus?.("Preparo l'Ombra interna WebGPU…", "working");
          await ensureRasterInnerShadowRenderer(this);
        }
        if (!this.rasterStrokeRenderer) {
          await ensureRasterStrokeRenderer(this);
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
        this.rasterInnerShadowPendingComposeRect = mergeDirtyRects(
          previousRect,
          nextRect,
        );
        this.callbacks.onStatus?.("Ombra interna WebGPU attiva.", "ok");
      } else {
        this.rasterInnerShadowPendingComposeRect = previousRect;
        releaseRasterInnerShadowRenderer(this);
        if (!this.styleStackNeedsCompositor()) {
          releaseRasterStrokeRenderer(this);
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
      this.recordRasterLayerMetadataMutation("inner-shadow", historyBefore);
      return true;
    } catch (error) {
      this.rasterInnerShadowStyle = previous;
      if (!previous.enabled) {
        releaseRasterInnerShadowRenderer(this);
        if (!this.styleStackNeedsCompositor()) {
          releaseRasterStrokeRenderer(this);
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
    if (
      !this.initialized
      || this.historyBusy
      || this.activeStroke
      || this.layerSwitchBusy
      || this.selectionBusy
    ) {
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
      if (this.fillRendererLoadingPromise) {
        await this.fillRendererLoadingPromise;
      }
      await this.fillRenderer?.waitForPrewarm();
      if (this.selectionRendererLoadingPromise) {
        await this.selectionRendererLoadingPromise;
      }
      await recreateLayerResources(this, format);
      // The format transaction clears every raster record and allocates only
      // the active mip 0. A previous Reference designation would otherwise
      // point at a deliberately non-resident, now-empty source.
      this.layerStack.setReferenceIndex(null);
      this.layerFormat = format;
      this.fillRenderer?.destroy();
      this.fillRenderer = null;
      this.selectionRenderer?.setSourceSamplingView(this.layerSamplingView);
      this.selectionRenderer?.clearSelection();
      resetPixelSelectionState(this);
      let renderingPrewarmWarning: string | null = null;
      let styleStackWarning: string | null = null;
      try {
        if (usesBlendRenderer(this.settings)) {
          this.blendRenderer?.prewarmScratch();
        }
        if (usesStrokeGlazeRenderer(this.settings)) {
          await this.ensureLightGlazeResources(this.settings.blendMode);
        }
        if (selectionNeedsConnectedColorScratch(this)) {
          const renderer = await ensureFillRenderer(this);
          renderer.setSourceSamplingView(this.layerSamplingView);
          await renderer.prewarm();
        }
      } catch (prewarmError) {
        renderingPrewarmWarning = prewarmError instanceof Error
          ? prewarmError.message
          : String(prewarmError);
        console.error("Prewarm rendering dopo cambio formato non riuscito", prewarmError);
      }
      this.resetHistoryState();
      this.clearRequested = true;
      this.displayDirty = true;
      this.layerStack.active.contentBounds = null;
      this.layerStack.active.hasContent = false;
      clearLayerStorageTileMask(this.layerStack.active.storageTileMask);
      this.layerHasContent = false;
      this.layerContentBounds = null;
      try {
        await ensureEffectRenderersForRecord(this, this.layerStack.active);
      } catch (styleError) {
        styleStackWarning = styleError instanceof Error
          ? styleError.message
          : String(styleError);
        this.rasterStrokeStyle = { ...this.rasterStrokeStyle, enabled: false };
        this.rasterBevelStyle = { ...this.rasterBevelStyle, enabled: false };
        this.rasterOuterShadowStyle = { ...this.rasterOuterShadowStyle, enabled: false };
        this.rasterInnerShadowStyle = { ...this.rasterInnerShadowStyle, enabled: false };
        this.rasterColorOverlayStyle = {
          ...this.rasterColorOverlayStyle,
          enabled: false,
        };
        this.effectsWorkbench?.scratchPool.releaseRequirement(
          RASTER_COLOR_OVERLAY_EFFECT_ID,
        );
        releaseRasterOuterShadowRenderer(this);
        releaseRasterInnerShadowRenderer(this);
        releaseRasterBevelRenderer(this);
        releaseRasterStrokeRenderer(this);
        console.error(
          "Ricreazione style stack dopo cambio formato non riuscita",
          styleError,
        );
      }
      this.requestRender();
      const formatWarnings = [
        renderingPrewarmWarning
          ? `rendering selezionato: ${renderingPrewarmWarning}`
          : null,
        styleStackWarning
          ? `effetti raster: ${styleStackWarning}`
          : null,
      ].filter((warning): warning is string => Boolean(warning));
      this.callbacks.onStatus?.(
        formatWarnings.length > 0
          ? `Layer ${format} pronto, ma alcune risorse non sono disponibili: ${formatWarnings.join(" · ")}`
          : `Layer ${format} pronto. Il contenuto è stato azzerato.`,
        formatWarnings.length > 0 ? "error" : "ok",
      );
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
    this.selectionRenderer?.resizeOverlay(width, height);
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

  createMixedSceneSnapshot(): MixedSceneSnapshot | null {
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
          const record = this.layerStack.at(rasterLayerIndex);
          const rasterIsActive = record.id === this.layerStack.active.id;
          const rasterHasContent = rasterIsActive ? this.layerHasContent : record.hasContent;
          const rasterContentBounds = rasterIsActive
            ? this.layerContentBounds
            : record.contentBounds;
          const transform = this.activeRasterTransformSession?.layerId === record.id
            ? {
              layerId: record.id,
              scope: this.activeRasterTransformSession.scope,
              x: this.activeRasterTransformSession.sourcePivot.x
                + this.activeRasterTransformSession.transform.translationX,
              y: this.activeRasterTransformSession.sourcePivot.y
                + this.activeRasterTransformSession.transform.translationY,
              scale: this.activeRasterTransformSession.transform.scale,
              rotation: this.activeRasterTransformSession.transform.rotation,
              sourceBounds: { ...this.activeRasterTransformSession.sourceBounds },
              resultBounds: this.activeRasterTransformSession.resultBounds
                ? { ...this.activeRasterTransformSession.resultBounds }
                : null,
            }
            : null;
          return {
            key: item.key,
            kind: item.kind,
            rasterLayerId: item.rasterLayerId,
            rasterLayerIndex,
            rasterLayerName: record.name,
            rasterClippingParentId: record.clippingParentId,
            rasterHasContent,
            rasterContentBounds: rasterContentBounds ? { ...rasterContentBounds } : null,
            rasterTransform: transform,
          };
        }
        if (item.kind === "text") {
          return {
            key: item.key,
            kind: item.kind,
            textNode: cloneVectorTextNode(scene.textById(item.textNodeId)),
          };
        }
        if (item.kind === "svg") {
          return {
            key: item.key,
            kind: item.kind,
            svgNode: cloneVectorSvgNode(scene.svgById(item.svgNodeId)),
          };
        }
        return {
          key: item.key,
          kind: item.kind,
          imageNode: cloneRasterImageNode(scene.imageById(item.imageNodeId)),
        };
      }),
    };
  }

  getMixedSceneSnapshot(): MixedSceneSnapshot | null {
    return this.createMixedSceneSnapshot();
  }

  canPaintSelectedSceneItem(): boolean {
    return this.mixedSceneStack?.selected.kind === "raster";
  }

  setFillToolSelected(selected: boolean): Promise<boolean> {
    return setFillToolSelected(this, selected);
  }

  fillAtClientPoint(
    clientX: number,
    clientY: number,
    tolerancePercent: number,
    color: string,
  ): Promise<FillOperationResult | null> {
    return fillAtClientPoint(this, clientX, clientY, tolerancePercent, color);
  }

  submitFillHistoryBatch(
    batch: FillHistoryRenderBatch,
    present: boolean,
  ): Promise<void> {
    return submitFillHistoryBatch(this, batch, present);
  }

  setSelectionToolSelected(
    selected: boolean,
    method: SelectionMethod,
  ): Promise<boolean> {
    return setSelectionToolSelected(this, selected, method);
  }

  selectConnectedAtClientPoint(
    clientX: number,
    clientY: number,
    tolerance: number,
    combineMode: SelectionCombineMode,
  ): Promise<SelectionOperationResult | null> {
    return selectConnectedAtClientPoint(
      this,
      clientX,
      clientY,
      tolerance,
      combineMode,
    );
  }

  selectPixelsByColor(
    color: string,
    tolerance: number,
    combineMode: SelectionCombineMode,
  ): Promise<SelectionOperationResult | null> {
    return selectPixelsByColor(this, color, tolerance, combineMode);
  }

  selectPixelsByClientLasso(
    clientPoints: readonly SelectionPoint[],
    combineMode: SelectionCombineMode,
  ): Promise<SelectionOperationResult | null> {
    return selectPixelsByClientLasso(this, clientPoints, combineMode);
  }

  clearPixelSelection(): Promise<boolean> {
    return clearPixelSelection(this);
  }

  getPixelSelectionState(): PixelSelectionState {
    return {
      ...this.pixelSelectionState,
      bounds: this.pixelSelectionState.bounds
        ? { ...this.pixelSelectionState.bounds }
        : null,
    };
  }

  notifyViewChange(): void {
    if (this.vectorTextFastPresentationEnabled) {
      // The capture stays fixed while the current camera moves. Updating this
      // tiny uniform selects full-coverage or clipped reprojection before the
      // next coalesced presentation submit. Both stay attached to the camera.
      this.vectorTextFastRequestedRevision += 1;
      writeVectorTextCaptureUniforms(this);
    }
    this.callbacks.onViewChange?.(this.getVectorTextViewState());
    renderPixelSelectionOverlay(this);
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
    if (next) {
      this.vectorTextFastRequestedRevision += 1;
    }
    writeVectorTextCaptureUniforms(this);
    this.displayDirty = true;
    this.presentationCacheNeedsFullRebuild = true;
    this.requestRender();
  }

  getVectorTextFastPresentationMode(): VectorTextFastPresentationMode {
    return this.vectorTextFastPresentationMode;
  }

  getVectorTextFastPresentationBackpressureStats(): {
    submissionCount: number;
    coalescedRequestCount: number;
    requestedRevision: number;
    submittedRevision: number;
    completedRevision: number;
  } {
    return {
      submissionCount: this.vectorTextFastPresentationSubmissionCount,
      coalescedRequestCount: this.vectorTextFastPresentationCoalescedRequestCount,
      requestedRevision: this.vectorTextFastRequestedRevision,
      submittedRevision: this.vectorTextFastSubmittedRevision,
      completedRevision: this.vectorTextFastCompletedRevision,
    };
  }

  async waitForVectorTextFastPresentationRevision(
    revision: number,
    timeoutMs = 3000,
  ): Promise<void> {
    if (!Number.isInteger(revision) || revision < 0) {
      throw new RangeError(`Revisione fast non valida: ${revision}.`);
    }
    const deadline = performance.now() + timeoutMs;
    while (this.vectorTextFastCompletedRevision < revision) {
      if (!this.vectorTextFastPresentationEnabled) {
        throw new Error("Presentazione fast disattivata prima dell'ack richiesto.");
      }
      if (performance.now() >= deadline) {
        throw new Error(
          `Presentazione fast ferma a ${this.vectorTextFastCompletedRevision}/${revision}.`,
        );
      }
      await new Promise<void>((resolve) => {
        let frame = 0;
        const timer = window.setTimeout(() => {
          cancelAnimationFrame(frame);
          resolve();
        }, 50);
        frame = requestAnimationFrame(() => {
          window.clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  waitForVectorTextPresentationCompletion(): Promise<void> {
    // Backpressure gate only. Safari includes the whole FIFO prefix and JS
    // callback delay, so callers must never interpret this as isolated GPU
    // duration telemetry.
    return this.device.queue.onSubmittedWorkDone();
  }

  captureVectorTextFallbackPresentation(): {
    textureCount: number;
    gpuMemoryMiB: number;
  } {
    if (!this.vectorTextPrototypeEnabled || !this.initialized) {
      throw new Error("Renderer testo vettoriale GPU non abilitato.");
    }
    return captureVectorTextFallbackPresentation(this);
  }

  clearVectorTextFallbackPresentation(): void {
    if (!this.vectorTextPrototypeEnabled || !this.initialized) return;
    clearVectorTextFallbackPresentation(this);
  }

  probeVectorTextFallbackAlpha(
    layerPoints: readonly { x: number; y: number }[],
  ): Promise<{ runCount: number; alphaPixelCounts: number[] }> {
    if (!this.vectorTextPrototypeEnabled || !this.initialized) {
      throw new Error("Renderer testo vettoriale GPU non abilitato.");
    }
    return probeVectorTextFallbackAlpha(this, layerPoints);
  }

  probeVectorTextFastCompositeAlpha(
    layerPoints: readonly { x: number; y: number }[],
  ): Promise<{ alphaPixelCounts: number[] }> {
    if (!this.vectorTextPrototypeEnabled || !this.initialized) {
      throw new Error("Renderer testo vettoriale GPU non abilitato.");
    }
    return probeVectorTextFastCompositeAlpha(this, layerPoints);
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
    captureVectorTextPresentationView(this);
    const texture = ensureVectorTextPresentationTexture(this, width, height, placement);
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

  vectorTextGpuBlurMemoryBytes(): number {
    const cacheBytes = [...this.vectorTextGpuBlurCaches.values()].reduce(
      (total, resources) => total + resources.memoryBytes,
      0,
    );
    const scratchBytes = this.vectorTextGpuBlurScratchATexture
      ? this.vectorTextGpuBlurScratchWidth * this.vectorTextGpuBlurScratchHeight * 2
      : 0;
    return cacheBytes + scratchBytes;
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

    captureVectorTextPresentationView(this);
    ensureVectorTextPresentationTexture(this, width, height, placement);
    const key =
      placement as Extract<VectorTextPlacement, `text-run:${string}`>;
    const resources = this.vectorTextRunTextures.get(key);
    if (!resources) {
      throw new Error(`Run testo GPU ${placement} non allocato.`);
    }
    const view = this.getVectorTextViewState();
    const drawResources = draws.map(
      (draw) => ensureVectorTextGpuResource(this, draw),
    );
    const blurResources = draws.map((draw) =>
      vectorTextGpuDrawUsesBlur(draw)
        ? ensureVectorTextGpuBlurCache(this, draw)
        : null,
    );
    const bounds = vectorTextGpuRunBounds(draws, view);

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

  pruneVectorTextGpuMeshes(activeMeshKeys: ReadonlySet<string>): void {
    flushVectorTextGpuPresentations(this);
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
      releaseVectorTextGpuBlurScratch(this);
    }
    if (activeMeshKeys.size === 0) {
      releaseVectorTextGpuScratch(this);
    }
  }

  clearVectorTextPresentation(
    placement?: VectorTextPlacement,
    deferDisplayInvalidation = false,
  ): void {
    // A queued vector run owns references to the textures and mesh buffers
    // released below. Drop it before destroying those resources, otherwise a
    // later controller flush can submit stale GPU objects after a vector-to-raster
    // transaction has already removed the semantic node.
    if (!placement) {
      this.vectorTextGpuPendingRuns.length = 0;
    } else {
      for (let index = this.vectorTextGpuPendingRuns.length - 1; index >= 0; index -= 1) {
        if (this.vectorTextGpuPendingRuns[index].placement === placement) {
          this.vectorTextGpuPendingRuns.splice(index, 1);
        }
      }
    }
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
        resources.fallbackTexture?.destroy();
        changed = true;
      }
      this.vectorTextRunTextures.clear();
    } else if (placement.startsWith("text-run:")) {
      const key = placement as Extract<VectorTextPlacement, `text-run:${string}`>;
      const resources = this.vectorTextRunTextures.get(key);
      if (resources) {
        resources.texture.destroy();
        resources.fallbackTexture?.destroy();
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
      releaseVectorTextGpuBlurScratch(this);
      releaseVectorTextGpuScratch(this);
      this.vectorTextTextureWidth = 0;
      this.vectorTextTextureHeight = 0;
      this.vectorTextCaptureView = null;
      this.vectorTextFallbackCaptureView = null;
      this.vectorTextFastPresentationEnabled = false;
      writeVectorTextCaptureUniforms(this);
    }
    if (legacyBindingsChanged && !deferDisplayInvalidation) {
      rebuildVectorTextDisplayBindGroup(this);
    }
    if (changed && this.initialized && !deferDisplayInvalidation) {
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
    const anchorBefore = clientToLayer(this, anchorClientX, anchorClientY);

    this.zoom = clamp(this.zoom * factor, 0.02, 64);

    const screen = clientToCanvasPixels(this, anchorClientX, anchorClientY);
    const anchorOffset = canvasOffsetToLayerOffset(this, 
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
    const layerDelta = canvasOffsetToLayerOffset(this, 
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

    applyViewRotation(this, 
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
    applyViewRotation(this, 0);
  }

  beginStroke(sample: PointerSample): boolean {
    return this.beginStrokeAtLayer(this.toLayerPoint(sample));
  }

  beginStrokeAtLayer(point: LayerPoint): boolean {
    // layerSwitchBusy is held across the switch's awaits, so a pointerdown
    // landing mid-switch cannot start a stroke on a half-swapped layer.
    if (this.activeVectorHistoryEdit || this.activeRasterLayerMetadataHistoryEdit) {
      this.callbacks.onStatus?.(
        this.activeRasterLayerMetadataHistoryEdit
          ? "Completo la modifica dell'effetto prima di iniziare il tratto…"
          : "Completa la modifica vettoriale prima di iniziare il tratto.",
        "working",
      );
      return false;
    }
    if (this.historyBusy || this.activeStroke || this.layerSwitchBusy || this.selectionBusy) {
      return false;
    }
    if (!this.canPaintSelectedSceneItem()) {
      this.callbacks.onStatus?.(
        "Un vettore è selezionato: scegli un livello raster per usare il pennello.",
        "working",
      );
      return false;
    }
    if (this.settings.tool === "blend" && this.pixelSelectionState.selectedPixels > 0) {
      this.callbacks.onStatus?.(
        "Blend non modifica una Selezione pixel: deseleziona oppure usa Paint/Riempimento.",
        "working",
      );
      return false;
    }
    if (
      this.settings.grainMode !== "off"
      && (
        !this.grainResident
        || this.grainLoadedAssetId !== grainAssetIdForSettings(this.settings)
      )
    ) {
      // Senza texture residente i pixel non sarebbero identici: il tratto
      // attende il load partito alla selezione del grain (o parte ora).
      requestGrainLoad(this);
      this.callbacks.onStatus?.(
        "Grain in caricamento: riprova tra un istante…",
        "working",
      );
      return false;
    }
    if (
      this.settings.shape === "shape"
      && (
        !this.shapeResident
        || this.shapeLoadedAssetId !== shapeAssetIdForSettings(this.settings)
        || this.shapeLoadedInvert !== shapeInvertForSettings(this.settings)
      )
    ) {
      requestShapeLoad(this);
      this.callbacks.onStatus?.(
        "Shape in caricamento: riprova tra un istante…",
        "working",
      );
      return false;
    }
    if (
      usesStrokeGlazeRenderer(this.settings)
      && (
        this.lightGlazeLoadingPromise !== null
        || !lightGlazeResourcesMatch(this, 
          lightGlazeStorageModeFor(this.settings.blendMode),
        )
      )
    ) {
      requestLightGlazeResources(this, this.settings.blendMode);
      this.callbacks.onStatus?.(
        "Rendering glaze in preparazione: riprova tra un istante…",
        "working",
      );
      return false;
    }
    pauseLayerColdCompressionIdle(this);
    const normalizedPoint: LayerPoint = {
      ...point,
      timeMs: Number.isFinite(point.timeMs) ? point.timeMs : performance.now(),
    };
    flushPendingWorkBeforeSettingsChange(this);
    flushClosingLightGlazeSessionBeforeNewStroke(this);
    cancelEffectsScratchShrink(this);
    cancelBevelFieldShrink(this);
    if (rasterBevelActive(this)) {
      // Prewarm before activeStroke is assigned: the pool never reallocates
      // while a pen/finger stroke is active, even after an idle shrink.
      this.rasterBevelRenderer?.prewarmWorkspace(this.rasterBevelStyle);
    }
    if (rasterOuterShadowActive(this)) {
      this.rasterOuterShadowRenderer?.prewarmWorkspace(this.rasterOuterShadowStyle);
    }
    if (rasterInnerShadowActive(this)) {
      this.rasterInnerShadowRenderer?.prewarmWorkspace(this.rasterInnerShadowStyle);
    }
    this.invalidateAdaptivePreview();
    const tool: BrushTool = this.settings.tool;
    const lightGlazeSettings = usesStrokeGlazeRenderer(this.settings)
      ? { ...this.settings }
      : null;
    if (lightGlazeSettings && this.thicknessTailPresentedRect) {
      this.thicknessTailPresentedRect = null;
      this.presentationCacheNeedsFullRebuild = true;
      this.displayDirty = true;
    }
    this.adaptivePreviewForceStroke = tool === "paint"
      && ADAPTIVE_PREVIEW_FORCE
      && !lightGlazeSettings
      && this.pixelSelectionState.selectedPixels === 0;
    const historyActionId = this.nextHistoryActionId;
    if (tool === "paint") {
      try {
        capturePaintSelectionHistoryMask(this, historyActionId);
      } catch (error) {
        this.scheduleLayerColdCompression();
        const message = error instanceof Error ? error.message : String(error);
        this.callbacks.onStatus?.(
          `Pennellata annullata prima del rendering: ${message}`,
          "error",
        );
        return false;
      }
    }
    this.nextHistoryActionId += 1;
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
    const curvePlanner = tool === "paint" ? this.paintCurvePlanner : null;
    curvePlanner?.reset();
    // Public Paint modes already own a per-gesture accumulator. Stabilization
    // keeps only its recent tail revisionable in that accumulator; the exact
    // zero setting deliberately stays on the pre-existing hot path below.
    const stabilizer = tool === "paint"
      && lightGlazeSettings
      && lightGlazeSettings.stabilization > 0
      ? this.paintStabilizer
      : null;
    const stabilizationUpdate = stabilizer?.begin(
      normalizedPoint,
      lightGlazeSettings?.stabilization ?? 0,
    ) ?? null;
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
      curvePlanner,
      stabilizer,
      stabilizationUpdate,
      // Separate mutable cursor for the authoritative stabilized prefix. It
      // must never alias `lastInput`, which always remains the latest raw
      // pointer sample.
      stabilizationCommittedInput: { ...normalizedPoint },
    };
    if (stabilizer && this.activeStrokeProfile) {
      this.activeStrokeProfile.strokeStabilizationInputSamples += 1;
      this.activeStrokeProfile.strokeStabilizationMaximumTailPoints = Math.max(
        this.activeStrokeProfile.strokeStabilizationMaximumTailPoints,
        stabilizationUpdate?.tailCount ?? 0,
      );
    }
    if (lightGlazeSettings) {
      this.startLightGlazeSession(historyActionId, lightGlazeSettings);
    }
    if (usesBlendRenderer(this.settings)) {
      this.blendRenderer?.beginStroke(historyActionId);
    }
    if (tool !== "blend") {
      emitStamp(this, normalizedPoint, 1, 0);
    }
    return true;
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
      drainBlendPlanner(this, endingStroke);
      const historyChanged = endingStroke.historyCommitted;
      this.activeStroke = null;
      if (this.pendingBlendBatches.length > 0) {
        this.displayDirty = true;
        this.requestRender();
      }
      if (historyChanged) {
        this.sweepRasterImageGpuResources();
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
      if (endingStroke.stabilizer) {
        const finalGeometry = endingStroke.stabilizer.finish();
        endingStroke.stabilizationUpdate = finalGeometry;
        if (this.activeStrokeProfile) {
          this.activeStrokeProfile.strokeStabilizationMaturePoints += Math.max(
            0,
            finalGeometry.tailCount - 1,
          );
        }
        // tail[0] is the already-authoritative seam. Committing tail[1..]
        // materializes exactly the geometry that was visible immediately
        // before pointer-up; no ageing, snap or catch-up segment is introduced.
        for (let index = 1; index < finalGeometry.tailCount; index += 1) {
          this.appendStabilizedMaturePoint(
            finalGeometry.tailX[index],
            finalGeometry.tailY[index],
            finalGeometry.tailPressure[index],
            finalGeometry.tailTimeMs[index],
            endingStroke,
          );
        }
        endingStroke.stabilizer = null;
        endingStroke.stabilizationUpdate = null;
      }
      const requestedLiftTime = Number.isFinite(timeMs)
        ? timeMs as number
        : endingStroke.lastInput.timeMs;
      const liftTime = Math.max(endingStroke.lastInput.timeMs, requestedLiftTime);
      releaseHeldThicknessStamps(this, liftTime, true);
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
    freezeAdaptivePreviewAtLift(this);
    this.activeStroke = null;
    if (hadPredictiveThicknessTail || this.thicknessTailPresentedRect) {
      // The same next GPU submit commits the final held stamps and redraws the
      // previous tail area from the authoritative layer, avoiding a blank or
      // doubled frame at lift.
      this.displayDirty = true;
      this.requestRender();
    }
    if (historyChanged) {
      this.sweepRasterImageGpuResources();
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
    releasePaintSelectionHistoryMask(this, stroke.historyActionId);
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
      || this.selectionBusy
      || this.activeVectorHistoryEdit
      || this.activeRasterLayerMetadataHistoryEdit
    ) {
      return false;
    }
    if (this.pixelSelectionState.selectedPixels > 0) {
      this.callbacks.onStatus?.(
        "Pulisci agisce sul livello intero: deseleziona prima, oppure colora la selezione con Paint/Riempimento.",
        "working",
      );
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
      if (hasVisibleHistoryContent(this, this.layerStack.active.id)) {
        truncateRedoHistory(this);
        this.historyActions.push({
          id: this.nextHistoryActionId++,
          kind: "clear",
          layerId: this.layerStack.active.id,
        });
        this.historyCursor = this.historyActions.length;
        this.sweepRasterImageGpuResources();
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
    if (
      this.historyBusy
      || this.layerSwitchBusy
      || this.selectionBusy
      || this.activeVectorHistoryEdit
      || this.activeRasterLayerMetadataHistoryEdit
    ) {
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
    this.selectionRenderer?.clearSelection();
    resetPixelSelectionState(this);
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
    return resetActiveLayerForMemoryBenchmark(this);
  }

  async undo(): Promise<boolean> {
    return moveHistoryCursor(this, -1);
  }

  async redo(): Promise<boolean> {
    return moveHistoryCursor(this, 1);
  }

  async compactDiscardedHistoryIncrementally(
    hooks: HistoryIncrementalCompactionHooks,
  ): Promise<HistoryIncrementalCompactionResult> {
    return await compactDiscardedHistoryIncrementally(this, hooks);
  }

  interruptHistoryMaintenance(): void {
    cancelHistoryMaintenance(this);
  }

  resumeDiscardedHistoryMaintenance(): void {
    if (this.historyCompactionPending) scheduleHistoryMaintenance(this);
  }

  async runBenchmark(baseStampCount: number): Promise<BenchmarkResult> {
    return await runBenchmark(this, baseStampCount);
  }

  resetLightGlazeTransitionPeak(): void {
    this.lightGlazeTransitionPeakMiB = 0;
  }

  getStats(): EngineStats {
    return getStats(this);
  }

  getBlendRuntimeState(): { scratchAllocated: boolean; scratchMemoryMiB: number } {
    const scratchMemoryMiB = this.blendRenderer?.memoryMiB() ?? 0;
    return {
      scratchAllocated: scratchMemoryMiB > 0,
      scratchMemoryMiB,
    };
  }

  effectsScratchHasQueuedWork(): boolean {
    return this.frameRequest !== null
      || this.pendingStamps.length > 0
      || this.pendingBlendBatches.length > 0
      || this.clearRequested
      || this.displayDirty
      || this.lightGlazeSession !== null;
  }

  bevelFieldBlocksScratchShrink(): boolean {
    return bevelFieldBlocksScratchShrink(this);
  }

  scheduleEffectsScratchShrink(): void {
    if (
      this.effectsScratchShrinkTimer !== null
      || this.effectsScratchShrinkInFlight
      || bevelFieldBlocksScratchShrink(this)
      || !effectsScratchNeedsShrink(this)
    ) {
      return;
    }
    this.effectsScratchShrinkTimer = window.setTimeout(() => {
      this.effectsScratchShrinkTimer = null;
      void shrinkEffectsScratchAfterIdle(this);
    }, EFFECTS_SCRATCH_POOL_IDLE_SHRINK_DELAY_MS);
  }

  cancelBevelFieldShrink(): void {
    cancelBevelFieldShrink(this);
  }

  scheduleBevelFieldShrink(): void {
    if (
      this.bevelFieldShrinkTimer !== null
      || this.bevelFieldShrinkInFlight
      || this.bevelFieldShrinkOnNextEncode
      || !bevelFieldNeedsShrink(this)
    ) {
      return;
    }
    // The field rebuild needs the Bevel workspace once more. Let it finish
    // before the shared scratch pool is released, avoiding a shrink/regrow pair.
    cancelEffectsScratchShrink(this);
    this.bevelFieldShrinkTimer = window.setTimeout(() => {
      this.bevelFieldShrinkTimer = null;
      void armBevelFieldShrinkAfterIdle(this);
    }, RASTER_BEVEL_FIELD_IDLE_SHRINK_DELAY_MS);
  }

  ensureGrainResources(
    requestedAssetId: BrushGrainAssetId = grainAssetIdForSettings(this.settings),
  ): Promise<void> {
    const assetId = normalizeGrainAssetId(requestedAssetId);
    this.grainDesiredAssetId = assetId;
    const inFlight = this.grainLoadingPromise;
    if (inFlight) {
      const inFlightAssetId = this.grainLoadingAssetId;
      return inFlight.then(
        () => {
          if (this.grainDesiredAssetId !== assetId) return;
          return this.ensureGrainResources(assetId);
        },
        (error: unknown) => {
          if (this.grainDesiredAssetId === assetId && inFlightAssetId === assetId) {
            throw error;
          }
          if (this.grainDesiredAssetId === assetId) {
            return this.ensureGrainResources(assetId);
          }
        },
      );
    }
    if (this.grainResident && this.grainLoadedAssetId === assetId) {
      return Promise.resolve();
    }

    const label = assetId === "pencil-grain" ? "Grain Pencil" : "Grain M1";
    this.callbacks.onStatus?.(`Carico ${label}…`, "working");
    const loading = (async () => {
      let resources: GrainTextureResources;
      try {
        resources = await runGpuAllocationTransaction(
          this.device,
          `Allocazione ${label}`,
          async (transaction) => {
            const candidate = await createGrainTextureResources(this, assetId);
            transaction.deferRollback(() => destroyGrainTextureResources(candidate));
            return candidate;
          },
        );
      } catch (error) {
        if (this.grainDesiredAssetId !== assetId) return;
        throw error;
      }

      if (this.grainDesiredAssetId !== assetId) {
        destroyGrainTextureResources(resources);
        return;
      }

      const previous = this.grainResourceSet;
      if (previous) {
        await this.waitForGpuCapped("Cambio asset Grain", 60_000);
      }
      if (this.grainDesiredAssetId !== assetId) {
        destroyGrainTextureResources(resources);
        return;
      }
      await runGpuAllocationTransaction(
        this.device,
        `Retarget ${label}`,
        (transaction) => {
          transaction.deferRollback(() => destroyGrainTextureResources(resources));
          transaction.deferRollback(() => applyGrainTextureResources(this, previous));
          applyGrainTextureResources(this, resources);
        },
      );

      if (this.grainDesiredAssetId !== assetId) {
        try {
          await runGpuAllocationTransaction(
            this.device,
            "Ripristino asset Grain precedente",
            (transaction) => {
              transaction.deferRollback(() => applyGrainTextureResources(this, resources));
              applyGrainTextureResources(this, previous);
            },
          );
          destroyGrainTextureResources(resources);
          this.publishStats();
          return;
        } catch (error) {
          destroyGrainTextureResources(previous);
          throw error;
        }
      }

      destroyGrainTextureResources(previous);
      if (this.grainDesiredAssetId === assetId) {
        this.callbacks.onStatus?.(`${label} pronto.`, "ok");
      }
      this.publishStats();
    })();
    let completedSuccessfully = false;
    const tracked = loading.then(() => {
      completedSuccessfully = true;
    }).finally(() => {
      if (this.grainLoadingPromise !== tracked) return;
      this.grainLoadingPromise = null;
      this.grainLoadingAssetId = null;
      const selectedAssetId = grainAssetIdForSettings(this.settings);
      if (
        completedSuccessfully
        && !this.historyBusy
        && isTexturizedGrainActive(this.settings)
        && (this.grainLoadedAssetId !== selectedAssetId || !this.grainResident)
      ) {
        requestGrainLoad(this);
      } else {
        maybeReleaseIdleGrainResources(this);
      }
    });
    this.grainLoadingPromise = tracked;
    this.grainLoadingAssetId = assetId;
    return tracked;
  }

  ensureShapeResources(
    requestedAssetId: BrushShapeAssetId = shapeAssetIdForSettings(this.settings),
    requestedInvert: boolean = shapeInvertForSettings(this.settings),
  ): Promise<void> {
    const assetId = normalizeShapeAssetId(requestedAssetId);
    const invert = requestedInvert === true;
    this.shapeDesiredAssetId = assetId;
    this.shapeDesiredInvert = invert;
    const inFlight = this.shapeLoadingPromise;
    if (inFlight) {
      const inFlightAssetId = this.shapeLoadingAssetId;
      const inFlightInvert = this.shapeLoadingInvert;
      return inFlight.then(
        () => {
          if (this.shapeDesiredAssetId !== assetId || this.shapeDesiredInvert !== invert) return;
          return this.ensureShapeResources(assetId, invert);
        },
        (error: unknown) => {
          if (
            this.shapeDesiredAssetId === assetId
            && this.shapeDesiredInvert === invert
            && inFlightAssetId === assetId
            && inFlightInvert === invert
          ) {
            throw error;
          }
          if (this.shapeDesiredAssetId === assetId && this.shapeDesiredInvert === invert) {
            return this.ensureShapeResources(assetId, invert);
          }
        },
      );
    }
    if (
      this.shapeResident
      && this.shapeLoadedAssetId === assetId
      && this.shapeLoadedInvert === invert
    ) {
      return Promise.resolve();
    }

    const label = assetId === "pencil-shape" ? "Shape Pencil" : "Shape 2K";
    this.callbacks.onStatus?.(`Carico ${label}…`, "working");
    const loading = (async () => {
      let resources: ShapeMaskResources;
      try {
        resources = await runGpuAllocationTransaction(
          this.device,
          `Allocazione ${label}`,
          async (transaction) => {
            const candidate = await createShapeMaskResources(this, assetId, invert);
            transaction.deferRollback(() => destroyShapeMaskResources(candidate));
            return candidate;
          },
        );
      } catch (error) {
        if (this.shapeDesiredAssetId !== assetId || this.shapeDesiredInvert !== invert) return;
        throw error;
      }

      if (this.shapeDesiredAssetId !== assetId || this.shapeDesiredInvert !== invert) {
        destroyShapeMaskResources(resources);
        return;
      }

      const previous = this.shapeResourceSet;
      if (previous) {
        await this.waitForGpuCapped("Cambio asset Shape", 60_000);
      }
      if (this.shapeDesiredAssetId !== assetId || this.shapeDesiredInvert !== invert) {
        destroyShapeMaskResources(resources);
        return;
      }
      await runGpuAllocationTransaction(
        this.device,
        `Retarget ${label}`,
        (transaction) => {
          transaction.deferRollback(() => destroyShapeMaskResources(resources));
          transaction.deferRollback(() => applyShapeMaskResources(this, previous));
          applyShapeMaskResources(this, resources);
        },
      );

      if (this.shapeDesiredAssetId !== assetId || this.shapeDesiredInvert !== invert) {
        try {
          await runGpuAllocationTransaction(
            this.device,
            "Ripristino asset Shape precedente",
            (transaction) => {
              transaction.deferRollback(() => applyShapeMaskResources(this, resources));
              applyShapeMaskResources(this, previous);
            },
          );
          destroyShapeMaskResources(resources);
          this.publishStats();
          return;
        } catch (error) {
          destroyShapeMaskResources(previous);
          throw error;
        }
      }

      destroyShapeMaskResources(previous);
      if (this.shapeDesiredAssetId === assetId && this.shapeDesiredInvert === invert) {
        this.callbacks.onStatus?.(`${label} pronta.`, "ok");
      }
      this.publishStats();
    })();
    let completedSuccessfully = false;
    const tracked = loading.then(() => {
      completedSuccessfully = true;
    }).finally(() => {
      if (this.shapeLoadingPromise !== tracked) return;
      this.shapeLoadingPromise = null;
      this.shapeLoadingAssetId = null;
      this.shapeLoadingInvert = null;
      const selectedAssetId = shapeAssetIdForSettings(this.settings);
      const selectedInvert = shapeInvertForSettings(this.settings);
      if (
        completedSuccessfully
        && !this.historyBusy
        && this.settings.shape === "shape"
        && (
          this.shapeLoadedAssetId !== selectedAssetId
          || this.shapeLoadedInvert !== selectedInvert
          || !this.shapeResident
        )
      ) {
        requestShapeLoad(this);
      } else {
        maybeReleaseIdleShapeResources(this);
      }
    });
    this.shapeLoadingPromise = tracked;
    this.shapeLoadingAssetId = assetId;
    this.shapeLoadingInvert = invert;
    return tracked;
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
  get documentWideResetBlockedByLayers(): boolean {
    return this.layerStack.count > 1;
  }

  private historyBlockedReason(delta: -1 | 1): string | null {
    if (this.historyStateInconsistent) return "La cronologia è incoerente: ricarica la pagina.";
    if (this.historyBusy) return "La cronologia sta completando un'altra operazione.";
    if (this.activeStroke) return "Termina il tratto prima di usare Undo o Redo.";
    if (this.layerSwitchBusy) return "Attendi il completamento del cambio livello.";
    if (this.selectionBusy) return "Attendi il completamento della selezione.";
    if (this.activeRasterTransformSession) {
      return "Completa o annulla Trasforma prima di usare Undo o Redo.";
    }
    if (this.activeVectorHistoryEdit || this.activeRasterLayerMetadataHistoryEdit) {
      return "Termina la modifica corrente prima di usare Undo o Redo.";
    }
    const nextCursor = this.historyCursor + delta;
    if (nextCursor < 0) return "Non ci sono azioni da annullare.";
    if (nextCursor > this.historyActions.length) return "Non ci sono azioni da ripristinare.";
    if (!historyCursorWithinRetainedRange(this, nextCursor)) {
      return "Le azioni più vecchie sono state consolidate per liberare memoria.";
    }
    if (historyStepBlockedByLayer(this, delta)) {
      const action = delta < 0
        ? this.historyActions[this.historyCursor - 1]
        : this.historyActions[this.historyCursor];
      return action?.kind === "scene-reorder"
        ? "Il riordino non è compatibile con la struttura livelli corrente."
        : action?.kind === "layer-metadata"
          ? "La proprietà non è compatibile con la struttura clipping corrente."
        : "Il livello richiesto dalla cronologia non esiste più.";
    }
    return null;
  }

  getHistoryState(): HistoryState {
    const undoBlockedReason = this.historyBlockedReason(-1);
    const redoBlockedReason = this.historyBlockedReason(1);
    return {
      canUndo: undoBlockedReason === null,
      canRedo: redoBlockedReason === null,
      busy: this.historyBusy,
      inconsistent: this.historyStateInconsistent,
      actionCount: this.historyActions.length,
      cursor: this.historyCursor,
      storedBaseStamps: this.historyStoredBaseStamps,
      logicalStampBytes: this.historyStoredBaseStamps * STAMP_STRIDE_BYTES,
      undoBlockedReason,
      redoBlockedReason,
      openEdit: this.activeRasterTransformSession
        ? "transform"
        : this.activeVectorHistoryEdit?.scope
          ?? (this.activeRasterLayerMetadataHistoryEdit ? "raster-property" : null),
    };
  }

  getHistoryMaintenanceTelemetry() {
    return historyMaintenanceTelemetry(this);
  }

  /**
   * Cancella un livello, in modo annullabile. Se il livello e' parent di un
   * gruppo di ritaglio si porta via **l'intera unita'**: una maschera senza il
   * suo parent verrebbe disegnata come livello normale e cambierebbe l'immagine.
   *
   * I pixel di ogni livello con contenuto vengono conservati in un seed di cold
   * storage, che e' il costo dichiarato della reversibilita': `LAYER_SIZE² ×
   * byte per pixel` per livello, dentro il budget History.
   */
  async deleteLayer(index: number): Promise<void> {
    if (!this.initialized) throw new Error("Il motore non è ancora inizializzato.");
    const target = this.layerStack.at(index);
    const unit = target.clippingParentId === null
      ? this.layerStack.clippingUnit(target.id)
      : [target];
    const doomed = new Set(unit.map((record) => record.id));
    const survivor = this.layerStack.layers.find((record) => !doomed.has(record.id));
    if (!survivor) {
      throw new Error("Non è possibile eliminare l'ultimo livello del documento.");
    }
    this.assertLayerSwitchAllowed();
    this.cancelLayerColdCompressionIdle();
    await this.waitForIdle();

    const scene = this.mixedSceneStack;
    if (!scene) throw new Error("Scena mista non disponibile per l'eliminazione.");
    // L'elenco e' dal basso verso l'alto: il ripristino reinserisce in avanti e
    // gli indici restano validi mentre la pila ricresce.
    const ordered = [...unit].sort(
      (left, right) => this.layerStack.indexOfId(left.id) - this.layerStack.indexOfId(right.id),
    );
    const entries: DeletedLayerEntry[] = [];
    for (const record of ordered) {
      const gpu = this.layerGpu.get(record.id);
      const hot = gpu?.hot ?? null;
      const seed = record.hasContent && hot
        ? await createLayerColdStorageCandidate(
          this,
          record,
          hot,
          coldStorageMaskForRecord(record),
          this.nextHistoryActionId,
        )
        : null;
      entries.push({
        layerRecord: record,
        rasterLayerIndex: this.layerStack.indexOfId(record.id),
        sceneIndex: scene.indexOfKey(`raster:${record.id}`),
        clippingParentId: record.clippingParentId,
        seed,
        baseBounds: record.contentBounds ? { ...record.contentBounds } : null,
      });
    }

    // La cattura dei seed sottomette copie GPU. Senza drenarle, la transazione
    // strutturale trova la presentazione congelata con lavoro pendente e si
    // interrompe: il guard e' giusto, mancava l'attesa.
    await this.waitForIdle();

    const action: LayerDeleteHistoryAction = {
      id: this.nextHistoryActionId++,
      kind: "layer-delete",
      entries,
      selectedKeyBefore: scene.selected.key,
      activeRasterLayerIdBefore: this.layerStack.active.id,
      activeRasterLayerIdAfter: survivor.id,
    };
    truncateRedoHistory(this);
    try {
      await applyLayerDeleteHistory(this, action, 1);
    } catch (error) {
      for (const entry of entries) destroyLayerColdStorage(entry.seed);
      throw error;
    }
    this.historyActions.push(action);
    this.historyCursor = this.historyActions.length;
    this.publishHistoryState();
    this.publishStats();
    scheduleHistoryMaintenance(this);
  }

  /**
   * Memoria GPU **misurata**: somma esatta dei descrittori di ogni texture e
   * buffer vivi, raccolta al momento della creazione. Non e' una stima e non
   * richiede manutenzione quando cambiano documento, formato o effetti.
   */
  measuredGpuMemory() {
    return this.gpuResourceRegistry.snapshot();
  }

  /**
   * Confronto fra la memoria misurata e quella dichiarata dal modello del
   * pannello. Serve solo finche' le righe semantiche del pannello vengono dal
   * modello: quando arriveranno dal registro, lo scarto sara' nullo per
   * costruzione e questo confronto potra' sparire.
   */
  auditGpuMemory(declaredMiB = this.getStats().gpuMemory.countedTotalMiB) {
    return buildGpuMemoryAuditReport(
      collectGpuMemoryEntries(this, "engine"),
      declaredMiB * MEBIBYTE_BYTES,
    );
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
    return getAdaptivePreviewDiagnostics(this);
  }

  async waitForGpu(): Promise<void> {
    if (!this.initialized) {
      throw new Error("Il motore non è ancora inizializzato.");
    }
    await this.device.queue.onSubmittedWorkDone();
  }

  async captureActiveLayerThumbnail(): Promise<LayerThumbnailPixels & {
    readonly layerId: number;
  }> {
    if (!this.initialized) {
      throw new Error("Il motore non è ancora inizializzato.");
    }
    if (this.activeStroke || this.layerSwitchBusy || this.historyBusy) {
      throw new Error("Miniatura rimandata finché il motore non torna inattivo.");
    }
    await this.waitForIdle();
    if (this.activeStroke || this.layerSwitchBusy || this.historyBusy) {
      throw new Error("Miniatura rimandata: è iniziata una nuova operazione.");
    }

    const layerId = this.layerStack.active.id;
    if (!this.layerHasContent) {
      return {
        layerId,
        width: LAYER_THUMBNAIL_SIZE,
        height: LAYER_THUMBNAIL_SIZE,
        rgba: new Uint8ClampedArray(LAYER_THUMBNAIL_SIZE * LAYER_THUMBNAIL_SIZE * 4),
      };
    }
    if (!this.layerThumbnailRenderer) {
      this.layerThumbnailRenderer = await LayerThumbnailRenderer.create(this.device);
    }
    if (
      layerId !== this.layerStack.active.id
      || this.activeStroke
      || this.layerSwitchBusy
      || this.historyBusy
    ) {
      throw new Error("Miniatura rimandata: il livello attivo è cambiato.");
    }
    const pixels = await this.layerThumbnailRenderer.capture(this.layerSamplingView);
    return { layerId, ...pixels };
  }

  async retargetEffectsWorkingSet(
    layerView: GPUTextureView,
    layerFormat: LayerFormat = this.layerFormat,
    contentBounds: DirtyRect | null | undefined = undefined,
  ): Promise<EffectsWorkbenchRetargetResult> {
    return retargetEffectsWorkingSetInternal(this, 
      layerView,
      layerFormat,
      contentBounds,
      "public",
    );
  }

  async benchmarkEffectsWorkingSet(samples = 3): Promise<EffectsWorkbenchBenchmarkReport> {
    return await benchmarkEffectsWorkingSet(this, samples);
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
    const hydration = await createHydratedLayerTexture(this, 
      record,
      gpu,
      `Sonda reidratazione livello ${record.id}`,
      false,
    );
    try {
      return await this.readTexturePixels(hydration.texture, rect, "livello");
    } finally {
      destroyTransientLayerHydration(this, hydration);
    }
  }

  /**
   * Dev-only ground truth for the tiled cold store. Full raw readbacks are
   * absent from normal telemetry: they would stall and transfer 64/128 MiB per
   * layer. The destructive GPU harness pays that cost once and compares the
   * resulting any-nonzero-byte mask with the always-on conservative metadata.
   */
  async measureExactLayerStorageStudy(): Promise<LayerStorageExactStudy> {
    return await measureExactLayerStorageStudy(this);
  }

  /**
   * Measurement-only compression pass over the authoritative inactive tile
   * arrays. It never replaces or destroys a cold texture.
   */
  async measureLayerColdCompressionStudy(onProgress?: (progress: LayerCompressionStudyProgress) => void): Promise<LayerCompressionStudyReport> {
    return await measureLayerColdCompressionStudy(this, onProgress);
  }

  getLayerBakeState(layerIndex: number): {
    allocated: boolean;
    valid: boolean;
    generation: number;
    memoryMiB: number;
  } {
    return getLayerBakeState(this, layerIndex);
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
    return getLayerCompositeState(this);
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
      encodeMergedSurfacePyramid(this, encoder, surface, mipLevel);
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
    setLayerCompositeTestView(this, centerX, centerY, zoom);
  }

  async readPresentationLayerRect(rect: DirtyRect): Promise<Uint8Array> {
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
    const canvasPosition = layerToCanvasPixels(this, x + 0.5, y + 0.5);
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
    const canvasPosition = layerToCanvasPixels(this, x + 0.5, y + 0.5);
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
    return await measureActiveStyleBakeGap(this, rect);
  }
  
  async readLayerColdStorageTiles(
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
      destroyTrackedReadbackBuffer(this, readbackBuffer, readbackBytes);
    }
  }

  async readTexturePixels(
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
      destroyTrackedReadbackBuffer(this, readbackBuffer, readbackBytes);
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

  private renderProgressSignature(): string {
    return [
      this.frameRequest === null ? 0 : 1,
      this.pendingStamps.length,
      this.pendingBlendBatches.length,
      Number(this.clearRequested),
      Number(this.displayDirty),
      Number(Boolean(this.lightGlazeSession?.commitRequested)),
      Number(Boolean(this.lightGlazeSession?.endRequested)),
      Number(this.layerPresentationFrozen),
    ].join(":");
  }

  async waitForIdle(): Promise<void> {
    if (!this.initialized) {
      throw new Error("Il motore non è ancora inizializzato.");
    }

    while (this.lightGlazeLoadingPromise) {
      await this.lightGlazeLoadingPromise;
    }
    while (this.grainLoadingPromise) {
      await this.grainLoadingPromise;
    }
    while (this.shapeLoadingPromise) {
      await this.shapeLoadingPromise;
    }
    throwIfRenderUnavailable(this);
    for (;;) {
      let progressSignature = this.renderProgressSignature();
      let lastProgressAt = performance.now();
      while (hasPendingRenderWork(this)) {
        if (this.layerPresentationFrozen) {
          throw new Error(
            "Presentazione congelata con lavoro render pendente: transazione interrotta in sicurezza.",
          );
        }
        await waitForRenderPump(this);
        const nextSignature = this.renderProgressSignature();
        if (nextSignature !== progressSignature) {
          progressSignature = nextSignature;
          lastProgressAt = performance.now();
        } else if (performance.now() - lastProgressAt > 10_000) {
          throw new Error(
            "Il motore non avanza da 10 secondi; Undo/Redo è stato interrotto in sicurezza.",
          );
        }
      }
      await this.waitForGpuCapped("Attesa completamento motore", 60_000);
      retireAdaptivePreviewAfterGpuIdle(this);
      // A callback can enqueue a frame while the GPU fence is pending. Recheck
      // instead of returning a false-idle state to a resource transaction.
      if (!hasPendingRenderWork(this)) {
        return;
      }
    }
  }

  resetStrokeRandomSeed(): void {
    this.seedSequence = 1;
  }

  startStrokePerformanceProfile(): void {
    startStrokePerformanceProfile(this);
  }

  finishStrokePerformanceProfile(): StrokePerformanceProfile | null {
    return finishStrokePerformanceProfile(this);
  }

  getBenchmarkEnvironment(): {
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
    strokeCurveStrategy: StrokePerformanceProfile["strokeCurveStrategy"];
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
    return getBenchmarkEnvironment(this);
  }

  async finishStaticResourceCreation(): Promise<void> {
    await finishStaticResourceCreation(this);
  }

  /**
   * One authoritative layer is exactly one `LAYER_SIZE²` mip-0 texture. Display
   * mips live in one reusable active-layer pyramid instead of every layer
   * texture.
   */
  allocateLayerTexture(format: LayerFormat): LayerTextureResources {
    const texture = this.device.createTexture({
      label: `${LAYER_SIZE}² authoritative paint layer ${format}`,
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

  requireLayerGpu(layerId: number): LayerGpuResources {
    const gpu = this.layerGpu.get(layerId);
    if (!gpu) {
      throw new Error(`Risorse GPU del livello ${layerId} non allocate.`);
    }
    return gpu;
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

  maybeInjectLayerColdStorageFault(point: LayerColdStorageFaultPoint): void {
    if (!import.meta.env.DEV || this.layerColdStorageFaultQueue[0] !== point) {
      return;
    }
    this.layerColdStorageFaultQueue.shift();
    throw new Error(`Guasto iniettato nel cold storage: ${point}.`);
  }

  selectLayerColdCompressionCandidate(): {
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

  cancelLayerColdCompressionIdle(): void {
    clearLayerColdCompressionIdleTimer(this);
    this.layerColdCompressionEpoch += 1;
    this.layerColdCompressionProgress = null;
  }

  publishLayerColdCompressionStatus(
    message: string,
    kind: "working" | "ok" | "error",
  ): void {
    if (this.layerColdCompressionStatusEnabled) {
      this.callbacks.onStatus?.(message, kind);
    }
  }

  pauseLayerColdCompressionForInteraction(): void {
    this.layerColdCompressionInteractionActive = true;
    pauseLayerColdCompressionIdle(this);
  }

  resumeLayerColdCompressionAfterInteraction(): void {
    if (!this.layerColdCompressionInteractionActive) {
      return;
    }
    this.layerColdCompressionInteractionActive = false;
    this.scheduleLayerColdCompression();
  }

  layerColdCompressionDistantGpuBytes(): number {
    const activeIndex = this.layerStack.activeIndex;
    return this.layerStack.layers.reduce((total, record, index) => {
      if (
        Math.abs(index - activeIndex) < LAYER_COLD_COMPRESSION_MINIMUM_DISTANCE
        || !record.hasContent
      ) {
        return total;
      }
      const gpu = this.requireLayerGpu(record.id);
      return total + (!gpu.hot && !gpu.compressed ? gpu.cold?.memoryBytes ?? 0 : 0);
    }, 0);
  }

  scheduleLayerColdCompression(): void {
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
      || this.layerColdCompressionInteractionActive
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
      void compressOneDistantLayerInBackground(this, token);
    }, delayMs);
  }

  async requireLayerColdCompressionClient(
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

  injectLayerBakeFault(...faultPoints: LayerBakeFaultPoint[]): void {
    if (!import.meta.env.DEV) {
      throw new Error("Iniezione di guasti bake disponibile solo in modalità dev.");
    }
    if (faultPoints.length === 0) {
      throw new Error("Specifica almeno un punto di guasto del bake.");
    }
    this.layerBakeFaultQueue = [...faultPoints];
  }

  destroyLayerBake(bake: LayerBakeResources | null | undefined): void {
    if (bake) {
      destroyLayerBakeTexture(this, bake.texture);
    }
  }
  async createLayerBakeCandidate(
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
    const nonTransparentBounds = layerCompositeVisualBounds(this, record);
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
        transaction.deferRollback(() => destroyLayerBakeTexture(this, texture));
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
          colorOverlayStyle: record.colorOverlayStyle,
          rect: nonTransparentBounds,
        });
        this.device.queue.submit([encoder.finish()]);
        if (completionPolicy === "await-immediately") {
          await this.waitForGpuCapped(`Bake livello ${record.id}`);
          if (injectBakeFault) {
            maybeInjectLayerBakeFault(this, "after-candidate-submit");
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

  async prepareActiveLayerForSwitch(): Promise<void> {
    // Keep the allocation-transaction fault probe, but normal switches no longer
    // retain a 64 MiB hand-off bake while other inactive records are materialized.
    if (import.meta.env.DEV && this.layerBakeFaultQueue.length > 0) {
      await bakeActiveLayerForSwitch(this);
    }
    if (this.layerStack.active.id === this.layerStack.referenceLayerId) {
      // The Reference layer is the zero-copy Fill source. Keep its raw mip 0
      // authoritative and full-resident while another raster becomes active.
      // Presentation still freezes until activation atomically retargets every
      // consumer, and derived bakes remain reconstructible.
      this.layerPresentationFrozen = true;
      const gpu = this.requireLayerGpu(this.layerStack.active.id);
      this.destroyLayerBake(gpu.bake);
      gpu.bake = null;
      gpu.bakeValid = false;
      return;
    }
    try {
      await freezeActiveLayerToCold(this);
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
    evictReconstructibleLayerResources(this, this.layerStack.active);
  }

  async waitForGpuCapped(label: string, timeoutMs = 30_000): Promise<void> {
    throwIfRenderUnavailable(this);
    let timer = 0;
    try {
      await Promise.race([
        this.device.queue.onSubmittedWorkDone(),
        this.deviceLostSignal.then((error) => Promise.reject(error)),
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
    throwIfRenderUnavailable(this);
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

  destroyMergedSurface(surface: MergedSurfaceResources | null | undefined): void {
    if (surface) {
      destroyMergedSurfaceTexture(this, surface.texture);
    }
  }

  /**
   * Rebuilds both derived sides while the last screen-space presentation remains
   * frozen. Old merged textures are evicted before candidates are allocated, so
   * mobile peak memory never contains both complete pairs. Raw hot/cold pixels are
   * authoritative; an error is rolled back by reconstructing these caches.
   */
  async rebuildMergedLayerSurfaces(
    caller: EffectsRetargetCaller = "layer-switch",
    view: VectorTextViewState = this.getVectorTextViewState(),
    options: RebuildMergedLayerSurfacesOptions = {},
  ): Promise<void> {
    if (hasPendingRenderWork(this)) {
      throw new Error(
        "Ricostruzione livelli rifiutata: il render deve essere fermo prima del freeze.",
      );
    }
    const previousBelow = this.mergedBelow;
    const previousAbove = this.mergedAbove;
    const previousMixedSegments = this.mixedSceneRasterSegments;
    const previousCompositionSegments = this.mixedSceneCompositionSegments;
    const previousActiveClippingGroup = this.activeClippingGroup;
    const activeClippingUnit = this.layerStack.clippingUnit(this.layerStack.active.id);
    const activeClippingUnitIds = activeClippingUnit.length > 1
      ? activeClippingUnit.map((record) => record.id)
      : [];
    let candidateCompositionSegments: readonly MixedSceneCompositionSegment[] = [];
    if (this.mixedSceneStack && this.usesOrderedScenePresentation()) {
      // Compute the new plan before evicting anything. A malformed scene must
      // leave the complete previous presentation untouched.
      candidateCompositionSegments = splitMixedSceneRasterRunsForLayerBlend(
        this,
        this.mixedSceneStack.compositionSegments(
          this.layerStack.active.id,
          activeClippingUnitIds,
        ),
      );
    }
    const reusableKeys = options.reuseUnchangedRasterRuns
      ? reusableMixedSceneRasterRunKeys(
        previousCompositionSegments,
        candidateCompositionSegments,
      )
      : new Set<MixedSceneRasterRunKey>();
    const reusableSegments = new Map<
      MixedSceneRasterRunKey,
      MixedSceneRasterSegmentResources
    >();
    const survivingPreviousSegments: MixedSceneRasterSegmentResources[] = [];

    this.layerPresentationFrozen = true;
    this.mergedBelow = null;
    this.mergedAbove = null;
    this.mixedSceneRasterSegments = [];
    this.mixedSceneCompositionSegments = [];
    this.activeClippingGroup = null;
    this.destroyMergedSurface(previousBelow);
    this.destroyMergedSurface(previousAbove);
    destroyActiveClippingGroupResources(this, previousActiveClippingGroup);
    for (const segment of previousMixedSegments) {
      if (reusableKeys.has(segment.key) && !reusableSegments.has(segment.key)) {
        reusableSegments.set(segment.key, segment);
        survivingPreviousSegments.push(segment);
      } else {
        // Obsolete runs are evicted before replacements are allocated, keeping
        // vector reorders out of an old+new raster-surface memory peak.
        destroyMixedSceneRasterSegment(this, segment);
      }
    }

    let candidateBelow: MergedSurfaceResources | null = null;
    let candidateAbove: MergedSurfaceResources | null = null;
    let candidateActiveClippingGroup: ActiveClippingGroupResources | null = null;
    const candidateMixedSegments: MixedSceneRasterSegmentResources[] = [];
    const reusedCandidateSegments = new Set<MixedSceneRasterSegmentResources>();
    let activeWorkbenchRestored = false;
    let candidatePublished = false;
    try {
      candidateActiveClippingGroup = await buildActiveClippingGroupResources(this, caller);
      if (this.mixedSceneStack && this.usesOrderedScenePresentation()) {
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
          const reusable = reusableSegments.get(segment.key);
          if (reusable) {
            candidateMixedSegments.push(reusable);
            reusedCandidateSegments.add(reusable);
            continue;
          }
          const side = index < activePosition ? "below" : "above";
          const surface = await buildMixedMergedSurfaceCandidate(this, 
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
              createMixedSceneRasterSegmentResources(this, segment.key, surface),
            );
          } catch (error) {
            this.destroyMergedSurface(surface);
            throw error;
          }
        }
      } else if (this.mixedSceneStack) {
        const partition = this.mixedSceneStack.partitionAroundRaster(
          this.layerStack.active.id,
          activeClippingUnitIds,
        );
        candidateBelow = await buildMixedMergedSurfaceCandidate(this, 
          partition.below,
          "below",
          caller,
          view,
        );
        candidateAbove = await buildMixedMergedSurfaceCandidate(this, 
          partition.above,
          "above",
          caller,
          view,
        );
      } else {
        const activeUnitStart = this.layerStack.indexOfId(activeClippingUnit[0].id);
        const activeUnitEnd = activeUnitStart + activeClippingUnit.length;
        candidateBelow = await buildMergedSurfaceCandidate(this, 
          this.layerStack.layers.slice(0, activeUnitStart), "below", caller,
        );
        candidateAbove = await buildMergedSurfaceCandidate(this, 
          this.layerStack.layers.slice(activeUnitEnd), "above", caller,
        );
      }
      await restoreEffectsWorkbenchToActiveLayer(this, caller);
      activeWorkbenchRestored = true;
      maybeInjectLayerCompositeFault(this, "after-candidate-submit");

      this.mergedBelow = candidateBelow;
      this.mergedAbove = candidateAbove;
      this.activeClippingGroup = candidateActiveClippingGroup;
      this.mixedSceneRasterSegments = candidateMixedSegments;
      this.mixedSceneCompositionSegments = candidateCompositionSegments;
      rebuildLayerDisplayBindGroups(this);
      releaseFusedLayerBakes(this);
      this.presentationCacheNeedsFullRebuild = true;
      this.layerPresentationFrozen = false;
      candidatePublished = true;
    } catch (error) {
      if (!candidatePublished) {
        this.mergedBelow = null;
        this.mergedAbove = null;
        this.activeClippingGroup = null;
        // Keep only still-valid old runs reachable so the caller's rollback
        // rebuild can reuse them. Rendering remains frozen until that succeeds.
        this.mixedSceneRasterSegments = survivingPreviousSegments;
        this.mixedSceneCompositionSegments = previousCompositionSegments;
      }
      this.destroyMergedSurface(candidateBelow);
      this.destroyMergedSurface(candidateAbove);
      destroyActiveClippingGroupResources(this, candidateActiveClippingGroup);
      for (const segment of candidateMixedSegments) {
        if (!reusedCandidateSegments.has(segment)) {
          destroyMixedSceneRasterSegment(this, segment);
        }
      }
      if (!activeWorkbenchRestored) {
        // A failed retarget may already have changed sourceView before its GPU
        // rebuild failed. Force the reverse retarget instead of trusting the
        // pointer equality fast path.
        await restoreEffectsWorkbenchToActiveLayer(this, caller, true);
      }
      throw error;
    } finally {
      if (import.meta.env.DEV) {
        this.layerCompositeFaultQueue = [];
      }
    }
  }

  recordVectorHistoryAction(before: MixedSceneVectorHistoryState, after: MixedSceneVectorHistoryState): boolean {
    return recordVectorHistoryAction(this, before, after);
  }

  getMixedSceneReorderTargets(key: MixedSceneItem["key"]) {
    return getMixedSceneReorderTargets(this, key);
  }

  async moveMixedSceneItem(
    key: MixedSceneItem["key"],
    targetTopFirstSlot: number,
  ): Promise<boolean> {
    return moveMixedSceneItem(this, key, targetTopFirstSlot);
  }

  beginRasterLayerMetadataHistoryEdit(
    property: RasterLayerMetadataHistoryAction["property"],
  ): number | null {
    if (
      !this.initialized
      || this.activeStroke !== null
      || this.historyBusy
      || this.layerSwitchBusy
      || this.selectionBusy
      || this.historyStateInconsistent
      || this.activeVectorHistoryEdit
      || this.rasterStrokeBusy
      || this.rasterBevelBusy
      || this.rasterOuterShadowBusy
      || this.rasterInnerShadowBusy
    ) {
      return null;
    }
    cancelHistoryMaintenance(this);
    const layerId = this.layerStack.active.id;
    const active = this.activeRasterLayerMetadataHistoryEdit;
    if (active) {
      return active.layerId === layerId && active.property === property
        ? active.token
        : null;
    }
    const token = this.nextRasterLayerMetadataHistoryEditToken;
    this.nextRasterLayerMetadataHistoryEditToken = token >= Number.MAX_SAFE_INTEGER ? 1 : token + 1;
    const before = captureRasterLayerMetadataHistoryState(this, layerId, property);
    this.activeRasterLayerMetadataHistoryEdit = {
      token,
      ...before,
    };
    this.publishHistoryState();
    return token;
  }

  commitRasterLayerMetadataHistoryEdit(token: number): boolean {
    const edit = this.activeRasterLayerMetadataHistoryEdit;
    if (!edit || edit.token !== token) return false;
    const after = captureRasterLayerMetadataHistoryState(
      this,
      edit.layerId,
      edit.property,
    );
    recordRasterLayerMetadataHistoryAction(
      this,
      edit.property,
      edit,
      after,
    );
    this.activeRasterLayerMetadataHistoryEdit = null;
    this.publishHistoryState();
    return true;
  }

  cancelRasterLayerMetadataHistoryEdit(token: number): boolean {
    const edit = this.activeRasterLayerMetadataHistoryEdit;
    if (!edit || edit.token !== token) return false;
    const current = captureRasterLayerMetadataHistoryState(
      this,
      edit.layerId,
      edit.property,
    );
    // Cancellation is safe only for an untouched handshake. Once the style
    // changed, the caller must commit it so the visible mutation remains
    // reachable through Undo instead of silently disappearing from history.
    if (!rasterLayerMetadataHistoryStatesEqual(edit, current)) return false;
    this.activeRasterLayerMetadataHistoryEdit = null;
    this.publishHistoryState();
    return true;
  }

  private rasterLayerMetadataHistoryEditAllows(
    property: RasterLayerMetadataHistoryAction["property"],
    layerId = this.layerStack.active.id,
  ): boolean {
    const edit = this.activeRasterLayerMetadataHistoryEdit;
    return !edit || (edit.layerId === layerId && edit.property === property);
  }

  private recordRasterLayerMetadataMutation(
    property: RasterLayerMetadataHistoryAction["property"],
    before: RasterLayerMetadataHistoryState,
  ): void {
    const edit = this.activeRasterLayerMetadataHistoryEdit;
    if (edit) {
      if (edit.layerId !== before.layerId || edit.property !== property) {
        throw new Error(
          `La transazione ${edit.property} non può assorbire la modifica ${property}.`,
        );
      }
      return;
    }
    recordRasterLayerMetadataHistoryAction(
      this,
      property,
      before,
      captureRasterLayerMetadataHistoryState(this, before.layerId, property),
    );
    this.publishHistoryState();
  }

  beginVectorHistoryEdit(scope: "property" | "transform" = "property"): boolean {
    if (
      !this.initialized
      || this.activeStroke !== null
      || this.historyBusy
      || this.layerSwitchBusy
      || this.historyStateInconsistent
      || this.activeRasterLayerMetadataHistoryEdit
    ) {
      return false;
    }
    const scene = requireMixedSceneStack(this);
    const selected = scene.selected;
    if (selected.kind === "raster") {
      return false;
    }
    const key = selected.key;
    if (this.activeVectorHistoryEdit) {
      return this.activeVectorHistoryEdit.key === key
        && this.activeVectorHistoryEdit.scope === scope;
    }
    this.activeVectorHistoryEdit = {
      key,
      before: scene.captureVectorHistoryState(key),
      scope,
    };
    this.publishHistoryState();
    return true;
  }

  commitVectorHistoryEdit(): boolean {
    const edit = this.activeVectorHistoryEdit;
    if (!edit) {
      return false;
    }
    const scene = requireMixedSceneStack(this);
    this.activeVectorHistoryEdit = null;
    const after = scene.captureVectorHistoryState(edit.key);
    const changed = recordVectorHistoryAction(this, edit.before, after);
    this.publishHistoryState();
    return changed;
  }

  async cancelVectorHistoryEdit(): Promise<boolean> {
    const edit = this.activeVectorHistoryEdit;
    if (!edit) {
      return false;
    }
    await applyVectorHistoryState(this, edit.before);
    if (this.activeVectorHistoryEdit !== edit) {
      throw new Error("La transazione Trasforma è cambiata durante il ripristino.");
    }
    this.activeVectorHistoryEdit = null;
    this.publishHistoryState();
    return true;
  }

  async addVectorTextNode(
    seed: VectorTextNodeSeed,
    name?: string,
  ): Promise<Readonly<VectorTextNode>> {
    const node = await mutateMixedScenePresentation(this, 
      (scene) => scene.addTextAboveSelection(seed, name),
      {
        addedKey: (added) => `text:${added.id}`,
      },
    );
    return { ...node };
  }

  /**
   * Fixture-only batch insertion: semantic text nodes are committed through
   * one scene transaction and one merged-surface rebuild instead of paying
   * that setup cost once per node. Rendering and document order are the same
   * as repeated addVectorTextNode() calls.
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
    const nodes = await mutateMixedScenePresentation(this, (scene) =>
      entries.map((entry) => scene.addTextAboveSelection(entry.seed, entry.name))
    );
    return nodes.map((node) => ({ ...node }));
  }

  async setActiveMixedSceneItem(
    key: MixedSceneItem["key"],
  ): Promise<LayerSwitchResult | null> {
    const scene = requireMixedSceneStack(this);
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
        await mutateMixedScenePresentation(this, (mutableScene) => {
          mutableScene.select(key);
        });
        return null;
      }

      this.assertLayerSwitchAllowed();
      // Drain any already-scheduled frame before releasing text textures. The
      // transactional clear deliberately leaves bind groups untouched until
      // activation publishes the replacement layer resources.
      await this.waitForIdle();
      const previousState = scene.captureState();
      const previousExcludedNodeId = this.vectorTextPreviewExcludedNodeId;
      scene.select(key);
      this.vectorTextPreviewExcludedNodeId = null;
      clearVectorTextPresentationForTransaction(this);
      try {
        return await this.setActiveLayer(index);
      } catch (error) {
        scene.restoreState(previousState);
        this.vectorTextPreviewExcludedNodeId = previousExcludedNodeId;
        try {
          await mutateMixedScenePresentation(this, () => undefined);
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
        publishMixedScene(this);
        this.publishStats();
      }
    }
    if (scene.selected.key === key) {
      return null;
    }
    await mutateMixedScenePresentation(this, (mutableScene) => {
      mutableScene.select(key);
    });
    return null;
  }

  updateVectorTextNode(
    id: number,
    update: Partial<Omit<VectorTextNode, "id" | "visible" | "opacity">>,
  ): Readonly<VectorTextNode> {
    const scene = requireMixedSceneStack(this);
    const key = `text:${id}` as const;
    assertVectorUpdateAllowed(this, key, Object.keys(update));
    const selected = scene.selected;
    if (selected.kind !== "text" || selected.textNodeId !== id) {
      throw new Error("È modificabile soltanto il nodo testo selezionato.");
    }
    const before = this.activeVectorHistoryEdit
      ? null
      : scene.captureVectorHistoryState(key);
    const node = scene.updateText(id, update);
    if (before) {
      recordVectorHistoryAction(this, before, scene.captureVectorHistoryState(key));
      this.publishHistoryState();
    }
    publishMixedScene(this);
    this.publishStats();
    return { ...node };
  }

  async addVectorSvgNode(
    seed: VectorSvgNodeSeed,
    name?: string,
  ): Promise<Readonly<VectorSvgNode>> {
    const node = await mutateMixedScenePresentation(this, 
      (scene) => scene.addSvgAboveSelection(seed, name),
      {
        addedKey: (added) => `svg:${added.id}`,
      },
    );
    return cloneVectorSvgNode(node);
  }

  updateVectorSvgNode(
    id: number,
    update: Partial<Omit<VectorSvgNode, "id" | "document" | "visible" | "opacity">>,
  ): Readonly<VectorSvgNode> {
    const scene = requireMixedSceneStack(this);
    const key = `svg:${id}` as const;
    assertVectorUpdateAllowed(this, key, Object.keys(update));
    const selected = scene.selected;
    if (selected.kind !== "svg" || selected.svgNodeId !== id) {
      throw new Error("È modificabile soltanto il nodo SVG selezionato.");
    }
    const before = this.activeVectorHistoryEdit
      ? null
      : scene.captureVectorHistoryState(key);
    const node = scene.updateSvg(id, update);
    if (before) {
      recordVectorHistoryAction(this, before, scene.captureVectorHistoryState(key));
      this.publishHistoryState();
    }
    publishMixedScene(this);
    this.publishStats();
    return cloneVectorSvgNode(node);
  }

  async setVectorSvgNodeVisibility(id: number, visible: boolean): Promise<boolean> {
    return mutateMixedScenePresentation(this, 
      (scene) => scene.setSvgVisibility(id, Boolean(visible)),
      { targetKey: `svg:${id}` },
    );
  }

  async setVectorSvgNodeOpacity(id: number, opacity: number): Promise<boolean> {
    return mutateMixedScenePresentation(this, 
      (scene) => scene.setSvgOpacity(id, opacity),
      { targetKey: `svg:${id}` },
    );
  }

  async moveVectorSvgNode(id: number, delta: -1 | 1): Promise<boolean> {
    return mutateMixedScenePresentation(this, 
      (scene) => scene.moveSvg(id, delta),
      { targetKey: `svg:${id}` },
    );
  }

  async deleteVectorSvgNode(id: number): Promise<Readonly<VectorSvgNode>> {
    const removed = await mutateMixedScenePresentation(this, 
      (scene) => scene.deleteSvg(id, this.layerStack.active.id),
      { targetKey: `svg:${id}` },
    );
    return cloneVectorSvgNode(removed);
  }

  async importRasterImageFile(file: File): Promise<Readonly<NativeRasterImageImportResult>> {
    const imported = await importRasterImageFileRuntime(this, file, (history) => {
      this.commitRasterImportHistory(history);
    });
    return imported;
  }

  commitRasterImportHistory(history: NativeRasterImageHistorySeed): void {
    const actionId = this.nextHistoryActionId;
    // All allocations precede the point that invalidates Redo.
    const action: RasterImportHistoryAction = {
      id: actionId,
      kind: "raster-import",
      layerId: history.layerRecord.id,
      layerRecord: history.layerRecord,
      rasterLayerIndex: history.rasterLayerIndex,
      sceneIndex: history.sceneIndex,
      selectedKeyBefore: history.selectedKeyBefore,
      activeRasterLayerIdBefore: history.activeRasterLayerIdBefore,
      seed: history.seed,
      baseBounds: { ...history.baseBounds },
      baseTileMask: history.baseTileMask.slice(),
      source: { ...history.source },
    };
    const cursorBefore = this.historyCursor;
    const redoActions = this.historyActions.slice(cursorBefore);
    const discardedVectorLength = this.discardedVectorRasterHistoryActions.length;
    const discardedImportLength = this.discardedRasterImportHistoryActions.length;
    const discardedTransformLength = this.discardedRasterTransformHistoryActions.length;
    const compactionPendingBefore = this.historyCompactionPending;
    try {
      truncateRedoHistory(this);
      this.historyActions.push(action);
      this.nextHistoryActionId = actionId + 1;
      this.historyCursor = this.historyActions.length;
      if (this.activeStrokeProfile) {
        this.activeStrokeProfile.historyCommittedActions += 1;
      }
    } catch (error) {
      this.historyActions.length = cursorBefore;
      for (const redoAction of redoActions) this.historyActions.push(redoAction);
      this.historyCursor = cursorBefore;
      this.nextHistoryActionId = actionId;
      this.discardedVectorRasterHistoryActions.length = discardedVectorLength;
      this.discardedRasterImportHistoryActions.length = discardedImportLength;
      this.discardedRasterTransformHistoryActions.length = discardedTransformLength;
      this.historyCompactionPending = compactionPendingBefore;
      throw error;
    }
  }

  beginRasterLayerTransform() {
    return beginRasterLayerTransformRuntime(this);
  }

  updateRasterLayerTransform(
    update: Parameters<typeof updateRasterLayerTransformRuntime>[1],
  ) {
    return updateRasterLayerTransformRuntime(this, update);
  }

  nudgeRasterLayerTransform(deltaX: number, deltaY: number) {
    return nudgeRasterLayerTransformRuntime(this, deltaX, deltaY);
  }

  commitRasterLayerTransform(): Promise<boolean> {
    return commitRasterLayerTransformRuntime(this);
  }

  cancelRasterLayerTransform(): Promise<boolean> {
    return cancelRasterLayerTransformRuntime(this);
  }

  updateRasterImageNode(
    id: number,
    update: Partial<
      Omit<RasterImageNode, "id" | "kind" | "document" | "visible" | "opacity">
    >,
  ): Readonly<RasterImageNode> {
    return updateRasterImageNode(this, id, update);
  }

  async setRasterImageNodeVisibility(id: number, visible: boolean): Promise<boolean> {
    return setRasterImageNodeVisibility(this, id, visible);
  }

  async setRasterImageNodeOpacity(id: number, opacity: number): Promise<boolean> {
    return setRasterImageNodeOpacity(this, id, opacity);
  }

  async moveRasterImageNode(id: number, delta: -1 | 1): Promise<boolean> {
    return moveRasterImageNode(this, id, delta);
  }

  async deleteRasterImageNode(id: number): Promise<Readonly<RasterImageNode>> {
    return deleteRasterImageNode(this, id);
  }

  private async rasterizeVectorNode(
    sourceKind: VectorRasterizeHistoryAction["sourceKind"],
    id: number,
    draws: readonly VectorTextGpuDraw[],
  ): Promise<{ layerId: number; chunkCount: number; tileCount: number }> {
    const converted = await rasterizeVectorNodeToLayer(
      this,
      sourceKind,
      id,
      draws,
    );
    truncateRedoHistory(this);
    this.historyActions.push({
      id: this.nextHistoryActionId++,
      kind: "vector-rasterize",
      ...converted.history,
    });
    this.historyCursor = this.historyActions.length;
    this.sweepRasterImageGpuResources();
    if (this.activeStrokeProfile) {
      this.activeStrokeProfile.historyCommittedActions += 1;
    }
    this.publishHistoryState();
    this.publishStats();
    return {
      layerId: converted.history.layerId,
      chunkCount: converted.chunkCount,
      tileCount: converted.tileCount,
    };
  }

  async rasterizeVectorTextNode(
    id: number,
    draws: readonly VectorTextGpuDraw[],
  ): Promise<{ layerId: number; chunkCount: number; tileCount: number }> {
    return this.rasterizeVectorNode("text", id, draws);
  }

  async rasterizeVectorSvgNode(
    id: number,
    draws: readonly VectorTextGpuDraw[],
  ): Promise<{ layerId: number; chunkCount: number; tileCount: number }> {
    return this.rasterizeVectorNode("svg", id, draws);
  }

  async setVectorTextNodeVisibility(id: number, visible: boolean): Promise<boolean> {
    return mutateMixedScenePresentation(this, 
      (scene) => scene.setTextVisibility(id, Boolean(visible)),
      { targetKey: `text:${id}` },
    );
  }

  async setVectorTextNodeOpacity(id: number, opacity: number): Promise<boolean> {
    return mutateMixedScenePresentation(this, 
      (scene) => scene.setTextOpacity(id, opacity),
      { targetKey: `text:${id}` },
    );
  }

  async moveVectorTextNode(id: number, delta: -1 | 1): Promise<boolean> {
    return mutateMixedScenePresentation(this, 
      (scene) => scene.moveText(id, delta),
      { targetKey: `text:${id}` },
    );
  }

  async deleteVectorTextNode(id: number): Promise<Readonly<VectorTextNode>> {
    const removed = await mutateMixedScenePresentation(this, 
      (scene) => scene.deleteText(id, this.layerStack.active.id),
      { targetKey: `text:${id}` },
    );
    return { ...removed };
  }

  /**
   * Gives the dedicated memory fixture a tiny visible marker while deliberately
   * reserving an exact number of raw-storage tiles. The default keeps the
   * original full-layer stress fixture unchanged; the iPhone staircase passes
   * smaller counts so every checkpoint advances by a known amount.
   */
  async seedActiveLayerMemoryStress(markerIndex: number, storageTileCount = LAYER_STORAGE_TILE_COUNT): Promise<void> {
    await seedActiveLayerMemoryStress(this, markerIndex, storageTileCount);
  }

  /**
   * Adds a layer above the active one and selects it.
   *
   * Deliberately not routed through recreateLayerResources: that function's tail
   * destroys the outgoing texture, the blend renderer and the effects workbench,
   * which is right for a format change and fatal here. The 21 render pipelines
   * depend only on the format, so a new layer in the same format reuses them.
   */
  async addLayer(
    name?: string,
    clippingParentId: number | null = null,
  ): Promise<LayerSwitchResult> {
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
      let clippingLayerInsertIndex: number | null = null;
      let clippingSceneInsertIndex: number | null = null;
      if (clippingParentId !== null) {
        const parent = this.layerStack.byId(clippingParentId);
        if (!parent || parent.clippingParentId !== null) {
          throw new Error("Parent raster della maschera non valido.");
        }
        const unit = this.layerStack.clippingUnit(parent.id);
        clippingLayerInsertIndex = this.layerStack.indexOfId(unit[unit.length - 1].id) + 1;
        if (this.mixedSceneStack) {
          const sceneIndices = unit.map((member) =>
            this.mixedSceneStack!.indexOfKey(`raster:${member.id}` as const));
          if (
            sceneIndices.some((sceneIndex) => sceneIndex < 0)
            || sceneIndices.some((sceneIndex, offset) =>
              sceneIndex !== sceneIndices[0] + offset)
          ) {
            throw new Error(
              `Il gruppo di ritaglio ${parent.id} non è consecutivo nella scena mista.`,
            );
          }
          clippingSceneInsertIndex = sceneIndices[sceneIndices.length - 1] + 1;
        }
      }
      const fromIndex = this.layerStack.activeIndex;
      // Catturati **prima** dell'inserimento: sono lo stato a cui l'Undo torna.
      const selectedKeyBefore = this.mixedSceneStack?.selected.key ?? null;
      const activeRasterLayerIdBefore = this.layerStack.active.id;
      this.persistActiveLayerState();
      await this.prepareActiveLayerForSwitch();
      const index = clippingLayerInsertIndex === null
        ? this.layerStack.add(name)
        : this.layerStack.insertAt(clippingLayerInsertIndex, name);
      const record = this.layerStack.at(index);
      if (clippingParentId !== null) {
        this.layerStack.setClippingParent(index, clippingParentId);
      }
      if (this.mixedSceneStack) {
        if (clippingSceneInsertIndex === null) {
          this.mixedSceneStack.addRasterAboveSelection(record.id);
        } else {
          this.mixedSceneStack.insertRasterAt(record.id, clippingSceneInsertIndex);
        }
        this.vectorTextPreviewExcludedNodeId = null;
      }
      let gpu: LayerGpuResources;
      try {
        gpu = await allocateLayerGpuResources(this, 
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
        // La creazione e' journaled. Prima troncava il Redo perche' le azioni
        // `scene-reorder` conservano un ordine assoluto e un'inserzione non
        // registrata le rendeva inapplicabili; registrandola, lo stato a
        // qualsiasi cursore si ottiene applicando le azioni in ordine e la coda
        // resta coerente. Il troncamento resta solo come regola generale del
        // ramo Redo abbandonato, non come conseguenza dell'inserimento.
        truncateRedoHistory(this);
        if (selectedKeyBefore !== null && this.mixedSceneStack) {
          this.historyActions.push({
            id: this.nextHistoryActionId++,
            kind: "layer-add",
            layerRecord: record,
            rasterLayerIndex: this.layerStack.indexOfId(record.id),
            sceneIndex: this.mixedSceneStack.indexOfKey(`raster:${record.id}`),
            clippingParentId: clippingParentId,
            selectedKeyBefore,
            activeRasterLayerIdBefore,
          } satisfies LayerAddHistoryAction);
          this.historyCursor = this.historyActions.length;
          this.publishHistoryState();
        }
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
          evictReconstructibleLayerResources(this, record);
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
        destroyLayerGpuResources(this, gpu);
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
      publishMixedScene(this);
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
          evictReconstructibleLayerResources(this, this.layerStack.at(index));
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
    const layerId = this.layerStack.at(index).id;
    if (!this.rasterLayerMetadataHistoryEditAllows("visibility", layerId)) return false;
    const before = captureRasterLayerMetadataHistoryState(this, layerId, "visibility");
    const changed = await setLayerPresentation(this, index, Boolean(visible), undefined);
    if (changed) this.recordRasterLayerMetadataMutation("visibility", before);
    return changed;
  }

  async setLayerOpacity(index: number, opacity: number): Promise<boolean> {
    const layerId = this.layerStack.at(index).id;
    if (!this.rasterLayerMetadataHistoryEditAllows("opacity", layerId)) return false;
    const before = captureRasterLayerMetadataHistoryState(this, layerId, "opacity");
    const changed = await setLayerPresentation(this, index, undefined, clamp(opacity, 0, 1));
    if (changed) this.recordRasterLayerMetadataMutation("opacity", before);
    return changed;
  }

  async setLayerBlendMode(index: number, blendMode: LayerBlendMode): Promise<boolean> {
    const record = this.layerStack.at(index);
    if (this.activeRasterLayerMetadataHistoryEdit) return false;
    const before = record.blendMode;
    const changed = await setLayerBlendMode(this, index, blendMode);
    if (!changed) {
      return false;
    }
    truncateRedoHistory(this);
    this.historyActions.push({
      id: this.nextHistoryActionId++,
      kind: "layer-blend-mode",
      layerId: record.id,
      before,
      after: blendMode,
    });
    this.historyCursor = this.historyActions.length;
    if (this.activeStrokeProfile) {
      this.activeStrokeProfile.historyCommittedActions += 1;
    }
    this.publishHistoryState();
    return true;
  }

  async setLayerClipping(index: number, enabled: boolean): Promise<boolean> {
    const layerId = this.layerStack.at(index).id;
    if (!this.rasterLayerMetadataHistoryEditAllows("clipping", layerId)) return false;
    const before = captureRasterLayerMetadataHistoryState(this, layerId, "clipping");
    const changed = await setLayerClipping(this, index, Boolean(enabled));
    if (changed) this.recordRasterLayerMetadataMutation("clipping", before);
    return changed;
  }

  /**
   * Procreate-style clipping mask: create a normal raster immediately above
   * the selected raster. The base directly underneath becomes its parent.
   */
  async addClippingMaskLayer(): Promise<LayerSwitchResult> {
    const scene = requireMixedSceneStack(this);
    const selected = scene.selected;
    if (selected.kind !== "raster") {
      throw new Error("Seleziona un livello raster per creare la maschera.");
    }
    const selectedIndex = this.layerStack.indexOfId(selected.rasterLayerId);
    if (selectedIndex < 0 || selectedIndex !== this.layerStack.activeIndex) {
      throw new Error("Il raster selezionato deve essere il livello attivo.");
    }
    const selectedRecord = this.layerStack.at(selectedIndex);
    const parentId = selectedRecord.clippingParentId ?? selectedRecord.id;
    const parent = this.layerStack.byId(parentId);
    if (!parent || parent.clippingParentId !== null) {
      throw new Error("Parent raster della maschera non valido.");
    }
    const ordinal = this.layerStack.clippingDependents(parent.id).length + 1;
    return await this.addLayer(`Maschera ritaglio ${ordinal}`, parent.id);
  }

  async setLayerReference(index: number, enabled: boolean): Promise<boolean> {
    return setLayerReference(this, index, Boolean(enabled));
  }

  latchDocumentStateInconsistent(message: string): void {
    this.historyStateInconsistent = true;
    this.historyBusy = true;
    this.publishHistoryState();
    this.callbacks.onStatus?.(message, "error");
  }

  assertLayerSwitchAllowed(): void {
    if (
      this.activeStroke
      || this.lightGlazeSession
      || this.historyBusy
      || this.selectionBusy
      || this.activeVectorHistoryEdit
      || this.activeRasterLayerMetadataHistoryEdit
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
  persistActiveLayerState(): void {
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
  async ensureEffectRenderersForRecord(record: LayerRecord): Promise<void> {
    await ensureEffectRenderersForRecord(this, record);
  }

  async activateLayer(
    fromIndex: number,
    caller: EffectsRetargetCaller = "layer-switch",
  ): Promise<LayerSwitchResult> {
    const startedAt = performance.now();
    const record = this.layerStack.active;
    if (this.mixedSceneStack && caller === "history-replay") {
      this.mixedSceneStack.select(`raster:${record.id}`);
      this.vectorTextPreviewExcludedNodeId = null;
      clearVectorTextPresentationForTransaction(this);
    }
    await ensureActiveLayerHot(this, record);
    if (this.layerColdAdjacentPrefetchEnabled) {
      await ensureAdjacentLayerColdStorageResident(this);
    }
    bindActiveLayerResources(this);
    this.layerContentBounds = record.contentBounds;
    this.layerHasContent = record.hasContent;
    // The incoming layer's deep pyramid levels may never have been built, so
    // incremental maintenance would refine stale garbage. Force a full rebuild.
    this.paintDisplayMipValidThroughLevel = 0;
    this.blendRenderer?.retarget(this.layerView, this.layerSamplingView);
    retargetFillRendererSource(this);
    if (caller === "history-replay") {
      // After the engine fields and Blend have moved, but before the workbench
      // does: this is the half-switched state the transaction must recover from.
      maybeInjectHistoryReplayFault(this, "during-switch-activation");
    }
    destroyLightGlazeResources(this);
    destroyThicknessTailOverlayResources(this);
    await ensureEffectRenderersForRecord(this, record);

    const effectsStartedAt = performance.now();
    const effects = await retargetEffectsWorkingSetInternal(this, 
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
    commitActiveLayerResidency(this, fromIndex);

    this.presentationCacheNeedsFullRebuild = true;
    this.displayDirty = true;
    this.requestRender();
    this.publishStats();
    publishMixedScene(this);
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

  destroyThicknessTailOverlayResources(): void {
    destroyThicknessTailOverlayResources(this);
  }

  ensureLightGlazeResources(blendMode: BlendMode): Promise<void> {
    const storageMode = lightGlazeStorageModeFor(blendMode);
    this.lightGlazeDesiredStorageMode = storageMode;

    const inFlight = this.lightGlazeLoadingPromise;
    if (inFlight) {
      const inFlightMode = this.lightGlazeLoadingStorageMode;
      return inFlight.then(
        () => {
          if (this.lightGlazeDesiredStorageMode !== storageMode) {
            return;
          }
          return this.ensureLightGlazeResources(blendMode);
        },
        (error: unknown) => {
          if (
            this.lightGlazeDesiredStorageMode === storageMode
            && inFlightMode === storageMode
          ) {
            throw error;
          }
          if (this.lightGlazeDesiredStorageMode === storageMode) {
            return this.ensureLightGlazeResources(blendMode);
          }
        },
      );
    }
    if (lightGlazeResourcesMatch(this, storageMode)) {
      return Promise.resolve();
    }

    const loading = (async () => {
      const steadyTotalMiB = getGpuMemoryStats(this).countedTotalMiB;
      let resources: LightGlazeResourceSet;
      try {
        resources = await runGpuAllocationTransaction(
          this.device,
          `Allocazione rendering glaze ${storageMode}`,
          (transaction) => {
            const candidate = createLightGlazeResourceSet(this, storageMode);
            this.lightGlazeTransitionPeakMiB = Math.max(
              this.lightGlazeTransitionPeakMiB,
              steadyTotalMiB + lightGlazeAdditionalMemoryMiB(this.layerFormat, storageMode),
            );
            transaction.deferRollback(() => destroyLightGlazeResourceSet(candidate));
            return candidate;
          },
        );
      } catch (error) {
        if (this.lightGlazeDesiredStorageMode !== storageMode) {
          return;
        }
        throw error;
      }

      if (this.lightGlazeDesiredStorageMode !== storageMode) {
        destroyLightGlazeResourceSet(resources);
        return;
      }

      const previous = currentLightGlazeResourceSet(this);
      const previousStaleRect = this.lightGlazeStaleRect
        ? { ...this.lightGlazeStaleRect }
        : null;
      await runGpuAllocationTransaction(
        this.device,
        `Retarget rendering glaze ${storageMode}`,
        (transaction) => {
          // Registered separately so a failed restore cannot skip candidate cleanup.
          // Rollback is LIFO: restore the previous bindings first, then destroy
          // the rejected candidate in an independent guarded action.
          transaction.deferRollback(() => destroyLightGlazeResourceSet(resources));
          transaction.deferRollback(() => {
            applyLightGlazeResourceSet(this, previous);
            this.lightGlazeStaleRect = previousStaleRect;
          });
          applyLightGlazeResourceSet(this, resources);
          this.lightGlazeStaleRect = null;
        },
      );

      if (
        this.lightGlazeDesiredStorageMode !== storageMode
        && previous
        && previous.storageMode === this.lightGlazeDesiredStorageMode
      ) {
        try {
          await runGpuAllocationTransaction(
            this.device,
            `Ripristino rendering glaze ${previous.storageMode}`,
            (transaction) => {
              transaction.deferRollback(() => {
                applyLightGlazeResourceSet(this, resources);
                this.lightGlazeStaleRect = null;
              });
              applyLightGlazeResourceSet(this, previous);
              this.lightGlazeStaleRect = previousStaleRect;
            },
          );
          destroyLightGlazeResourceSet(resources);
          this.publishStats();
          return;
        } catch (error) {
          destroyLightGlazeResourceSet(previous);
          throw error;
        }
      }

      destroyLightGlazeResourceSet(previous);
      this.publishStats();
    })();
    let completedSuccessfully = false;
    const tracked = loading.then(() => {
      completedSuccessfully = true;
    }).finally(() => {
      if (this.lightGlazeLoadingPromise === tracked) {
        this.lightGlazeLoadingPromise = null;
        this.lightGlazeLoadingStorageMode = "none";
        const selectedGlaze = usesStrokeGlazeRenderer(this.settings);
        if (
          completedSuccessfully
          && selectedGlaze
          && !this.historyBusy
          && !this.lightGlazeSession
          && !this.activeStroke
          && !lightGlazeResourcesMatch(this, 
            lightGlazeStorageModeFor(this.settings.blendMode),
          )
        ) {
          requestLightGlazeResources(this, this.settings.blendMode);
        } else {
          maybeReleaseIdleLightGlazeResources(this);
        }
      }
    });
    this.lightGlazeLoadingPromise = tracked;
    this.lightGlazeLoadingStorageMode = storageMode;
    return tracked;
  }

  startLightGlazeSession(historyActionId: number, settings: BrushSettings): void {
    if (this.lightGlazeSession) {
      throw new Error("Un tratto Light Glaze precedente non è ancora stato finalizzato.");
    }
    const storageMode = lightGlazeStorageModeFor(settings.blendMode);
    if (storageMode === "none") {
      throw new Error("Modalita storage glaze non valida durante il rendering.");
    }
    if (!lightGlazeResourcesMatch(this, storageMode)) {
      throw new Error("Risorse rendering glaze non pronte all'inizio della pennellata.");
    }
    this.stabilizationSnapshotRect = null;
    this.lightGlazeSession = {
      historyActionId,
      settings: {
        ...settings,
        opacity: Number.isFinite(settings.opacity) ? clamp(settings.opacity, 0, 1) : 1,
      },
      dirtyRect: null,
      authoritativeDirtyRect: null,
      needsClear: this.lightGlazeStaleRect !== null,
      hasContent: false,
      endRequested: false,
      commitRequested: false,
      mipValidThroughLevel: 0,
      tintLinear: null,
    };
  }

  abandonLightGlazeSession(): void {
    if (!this.lightGlazeSession) {
      return;
    }
    this.lightGlazeStaleRect = mergeDirtyRects(
      this.lightGlazeStaleRect,
      this.lightGlazeSession.dirtyRect,
    );
    this.stabilizationSnapshotRect = null;
    this.lightGlazeSession = null;
    // The screen cache may contain the transient live composite. Any caller
    // that abandons a stroke (reset, cancel or failure) must rebuild it before
    // it is shown again.
    this.presentationCacheNeedsFullRebuild = true;
    deferRasterStrokeMutation(this, false);
  }

  writeLightGlazeUniforms(
    opacity: number,
    accumulationMode: "source-over" | "light-no-build-up" | "encoded-srgb-source-over",
    tintLinear: readonly [number, number, number] | null,
  ): void {
    const upload = new ArrayBuffer(LIGHT_GLAZE_UNIFORM_BYTES);
    // Mode 1 is the public Light contract: Flow belongs to each candidate
    // deposit, the R8 attachment keeps only MAX during pointer-down, and this
    // Opacity value is consumed once when the gesture is composited at lift.
    populateStrokeGlazeUniformUpload(
      upload,
      opacity,
      this.layerFormat,
      accumulationMode,
      tintLinear,
    );
    this.device.queue.writeBuffer(this.lightGlazeUniformBuffer, 0, upload);
  }

  rasterStrokeEffectRect(rect: DirtyRect | RasterStrokeRect | null, width = this.rasterStrokeStyle.width): DirtyRect | null {
    return rasterStrokeEffectRect(this, rect, width);
  }

  rasterBevelEffectRect(rect: DirtyRect | RasterBevelRect | null, style: RasterBevelStyle = this.rasterBevelStyle): DirtyRect | null {
    return rasterBevelEffectRect(this, rect, style);
  }

  rasterOuterShadowEffectRect(rect: DirtyRect | RasterShadowRect | null, style: RasterOuterShadowStyle = this.rasterOuterShadowStyle): DirtyRect | null {
    return rasterOuterShadowEffectRect(this, rect, style);
  }

  rasterInnerShadowEffectRect(rect: DirtyRect | RasterShadowRect | null, style: RasterInnerShadowStyle = this.rasterInnerShadowStyle): DirtyRect | null {
    return rasterInnerShadowEffectRect(this, rect, style);
  }

  noteLayerMutation(dirtyRect: DirtyRect | null, cleared: boolean): void {
    if (dirtyRect || cleared) {
      invalidateActiveLayerBake(this);
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
      this.layerContentBounds = mergeDirtyRects(this.layerContentBounds, dirtyRect);
      markLayerStorageRect(this.layerStack.active.storageTileMask, dirtyRect);
    }
    if (!rasterStrokeActive(this)) {
      this.rasterStrokeCoverageValid = false;
    }
  }

  encodeRasterStrokeUpdate(
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
    colorOverlayStyle: RasterColorOverlayStyle = this.rasterColorOverlayStyle,
  ): { dirtyRect: DirtyRect | null; timing: RasterStrokeEncodeResult | null } {
    const renderer = this.rasterStrokeRenderer;
    const styleStackActive = Boolean(
      renderer
      && ((strokeStyle.enabled && strokeStyle.width > 0)
        || bevelStyle.enabled
        || outerShadowStyle.enabled
        || innerShadowStyle.enabled
        || (colorOverlayStyle.enabled && colorOverlayStyle.opacity > 0))
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
      const bevelFieldBounds = rasterBevelInfluenceRect(this, bevelContentBounds, bevelStyle);
      const bevelRebuildRect = clearHeight
        ? bevelFieldBounds
        : mutationRect
          ? rasterBevelInfluenceRect(this, mutationRect, bevelStyle)
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
      composeRect = mergeDirtyRects(
        composeRect,
        bevelTiming.fieldFullRebuild
          ? bevelTiming.fieldState.validBounds
          : bevelRebuildRect,
      );
    } else {
      this.rasterBevelHeightValid = false;
      this.rasterBevelHeightSourceMode = null;
    }
    composeRect = mergeDirtyRects(composeRect, this.rasterBevelPendingComposeRect);

    const outerShadowActive = Boolean(
      this.rasterOuterShadowRenderer && outerShadowStyle.enabled,
    );
    if (outerShadowActive) {
      const shadowRenderer = this.rasterOuterShadowRenderer!;
      shadowRenderer.updateStyle(outerShadowStyle);
      const sourceChanged = this.rasterOuterShadowSourceMode !== sourceMode;
      const clearMatte = !this.rasterOuterShadowMatteValid || sourceChanged;
      const rebuildRect = clearMatte
        ? rasterOuterShadowInfluenceRect(this, shadowContentBounds, outerShadowStyle)
        : mutationRect
          ? rasterOuterShadowInfluenceRect(this, mutationRect, outerShadowStyle)
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
      composeRect = mergeDirtyRects(
        composeRect,
        clearMatte
          ? rasterOuterShadowEffectRect(this, shadowContentBounds, outerShadowStyle)
          : mutationRect
            ? rasterOuterShadowEffectRect(this, mutationRect, outerShadowStyle)
            : null,
      );
    } else {
      this.rasterOuterShadowMatteValid = false;
      this.rasterOuterShadowSourceMode = null;
    }
    composeRect = mergeDirtyRects(
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
        ? rasterInnerShadowInfluenceRect(this, shadowContentBounds, innerShadowStyle)
        : mutationRect
          ? rasterInnerShadowInfluenceRect(this, mutationRect, innerShadowStyle)
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
      composeRect = mergeDirtyRects(
        composeRect,
        clearMatte
          ? rasterInnerShadowEffectRect(this, shadowContentBounds, innerShadowStyle)
          : mutationRect
            ? rasterInnerShadowEffectRect(this, mutationRect, innerShadowStyle)
            : null,
      );
    } else {
      this.rasterInnerShadowMatteValid = false;
      this.rasterInnerShadowSourceMode = null;
    }
    composeRect = mergeDirtyRects(
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
        rebuildRect = mergeDirtyRects(
          rasterStrokeEffectRect(this, 
            virtualContentBounds,
            strokeStyle.width,
          ),
          this.rasterStrokePendingComposeRect,
        );
        composeRect = mergeDirtyRects(composeRect, rebuildRect);
      } else if (mutationRect) {
        rebuildRect = rasterStrokeEffectRect(this, 
          mutationRect,
          strokeStyle.width,
        );
        changeDetectionRect = mutationRect;
        composeRect = mergeDirtyRects(composeRect, mutationRect);
        conditionalComposeRect = rebuildRect;
      }
    } else {
      this.rasterStrokeCoverageValid = false;
    }
    composeRect = mergeDirtyRects(composeRect, this.rasterStrokePendingComposeRect);
    if (mutationRect && !bevelActive && !outerShadowActive && !innerShadowActive && !strokeActive) {
      composeRect = mergeDirtyRects(composeRect, mutationRect);
    }

    const timing = renderer.encode({
      encoder,
      style: strokeStyle,
      bevelStyle,
      colorOverlayStyle,
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
        : mergeDirtyRects(composeRect, conditionalComposeRect),
      timing,
    };
  }

  encodeRasterStrokeDisplayPyramid(encoder: GPUCommandEncoder, baseDirtyRect: DirtyRect | null, selectedMipLevel: number): { passes: number; updatedPixels: number } {
    return encodeRasterStrokeDisplayPyramid(this, encoder, baseDirtyRect, selectedMipLevel);
  }

  grainStrategy(settings: BrushSettings): GrainStrategy {
    if (!isTexturizedGrainActive(settings)) {
      return GRAIN_DISABLED_STRATEGY;
    }
    if (grainAssetIdForSettings(settings) === "pencil-grain") {
      return settings.grainMode === "moving"
        ? PENCIL_GRAIN_MOVING_STRATEGY
        : PENCIL_GRAIN_FIXED_STRATEGY;
    }
    return settings.grainMode === "moving" ? GRAIN_MOVING_STRATEGY : GRAIN_FIXED_STRATEGY;
  }

  grainCoordinateStrategy(settings: BrushSettings): GrainCoordinateStrategy {
    if (!isTexturizedGrainActive(settings)) {
      return "none";
    }
    if (settings.grainMode !== "moving") return GRAIN_FIXED_COORDINATE_STRATEGY;
    return (settings.grainMovement ?? 0) > 0
      ? GRAIN_MOVING_ROLLER_COORDINATE_STRATEGY
      : GRAIN_MOVING_COORDINATE_STRATEGY;
  }

  grainSamplingStrategy(settings: BrushSettings): GrainSamplingStrategy {
    if (!isTexturizedGrainActive(settings)) {
      return "none";
    }
    if (settings.grainFiltering === "no") {
      return "repeat-nearest";
    }
    if (settings.grainFiltering === "classic") {
      return "repeat-linear-mip-nearest";
    }
    return "repeat-linear-trilinear";
  }

  writeGrainUniforms(settings: BrushSettings): void {
    populateGrainUniformUpload(
      this.grainUniformUpload,
      settings,
      this.grainTextureWidth,
      this.grainTextureMipLevelCount,
    );
    this.device.queue.writeBuffer(this.grainUniformBuffer, 0, this.grainUniformUpload);
  }

  writeBrushUniforms(settings: BrushSettings = this.settings): void {
    populateBrushUniformUpload(
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
    populateBrushUniformUpload(
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

  downsampleDirtyRect(dirtyRect: DirtyRect, mipLevel: number): DirtyRect {
    const { width, height } = paintMipDimensions(mipLevel);
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

  private finalRasterStackMipAvailable(): boolean {
    if (
      (this.mergedBelow && this.mergedBelow.resolutionScale !== 1)
      || (this.mergedAbove && this.mergedAbove.resolutionScale !== 1)
    ) {
      return false;
    }
    const activePresent = this.layerStack.active.visible
      && this.layerStack.active.opacity > 0
      && this.layerContentBounds !== null;
    const surfaceCount = Number(activePresent)
      + Number(this.mergedBelow !== null)
      + Number(this.mergedAbove !== null);
    return surfaceCount >= 2;
  }

  private encodePaintDisplayPyramid(
    encoder: GPUCommandEncoder,
    baseDirtyRect: DirtyRect | null,
    selectedMipLevel: number,
    requestedContent: "active-only" | "final-raster-stack" = "active-only",
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
    const content = requestedContent === "final-raster-stack"
      && selectedMipLevel > 0
      && this.finalRasterStackMipAvailable()
      ? "final-raster-stack"
      : selectedMipLevel > 0 && this.activeClippingGroup
        ? "active-clipping-group"
        : "active-only";
    if (content !== this.paintDisplayPyramidContent) {
      this.paintDisplayPyramidContent = content;
      this.paintDisplayMipValidThroughLevel = 0;
      // A partial cache update cannot mix pixels sourced from two pyramid
      // meanings, even though both are intended to represent the same stack.
      this.presentationCacheNeedsFullRebuild = true;
    }
    const previousValidThroughLevel = this.paintDisplayMipValidThroughLevel;
    const baseChanged = baseDirtyRect !== null;
    let sourceDirtyRect = baseDirtyRect;
    let fullLevelBuilds = 0;
    let dirtyLevelUpdates = 0;
    let passes = 0;
    let updatedPixels = 0;

    if (content !== "active-only" && selectedMipLevel > 0) {
      // The mip-1 compositor reads the same uniforms as the final display.
      // Queue writes precede the command-buffer submission even though the
      // render passes themselves are encoded first.
      this.writeDisplayUniforms(selectedMipLevel);
    }

    for (let mipLevel = 1; mipLevel <= selectedMipLevel; mipLevel += 1) {
      const dimensions = paintMipDimensions(mipLevel);
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
          ? `Build full ${content} paint display mip ${mipLevel}`
          : `Update ${content} paint display mip ${mipLevel} dirty rect`,
        colorAttachments: [
          {
            view: this.paintMipViews[mipLevel],
            loadOp: needsFullBuild ? "clear" : "load",
            storeOp: "store",
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          },
        ],
      });
      if (content === "final-raster-stack" && mipLevel === 1) {
        pass.setPipeline(this.paintStackCompositeMipPipeline);
        pass.setBindGroup(0, this.paintStackCompositeMipBindGroup);
      } else if (content === "active-clipping-group" && mipLevel === 1) {
        pass.setPipeline(this.activeClippingGroupMipPipeline);
        pass.setBindGroup(0, this.paintStackCompositeMipBindGroup);
      } else {
        pass.setPipeline(this.paintMipDownsamplePipeline);
        pass.setBindGroup(0, this.paintMipDownsampleBindGroups[mipLevel - 1]);
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
    const clippingGroup = this.activeClippingGroup;
    this.displayUniformUpload[16] = clippingGroup?.mode === "active-parent"
      ? 1
      : clippingGroup?.mode === "active-child"
        ? 2 + LAYER_BLEND_MODE_CODES[this.layerStack.active.blendMode] / 64
        : 0;
    this.displayUniformUpload[17] = clippingGroup?.parentOpacity ?? 0;
    this.displayUniformUpload[18] = clippingGroup?.prefix?.resolutionScale ?? 0;
    this.displayUniformUpload[19] = clippingGroup?.suffix?.resolutionScale ?? 0;
    this.displayUniformUpload[20] = clippingGroup?.prefix?.bounds.x ?? 0;
    this.displayUniformUpload[21] = clippingGroup?.prefix?.bounds.y ?? 0;
    this.displayUniformUpload[22] = clippingGroup?.suffix?.bounds.x ?? 0;
    this.displayUniformUpload[23] = clippingGroup?.suffix?.bounds.y ?? 0;

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

  toLayerPoint(sample: PointerSample): LayerPoint {
    const layer = clientToLayer(this, sample.clientX, sample.clientY);
    return {
      x: layer.x,
      y: layer.y,
      pressure: clamp(sample.pressure, 0.01, 1),
      timeMs: Number.isFinite(sample.timeMs) ? sample.timeMs : performance.now(),
    };
  }

  clientToCanvasPixels(clientX: number, clientY: number): { x: number; y: number } {
    return clientToCanvasPixels(this, clientX, clientY);
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
      drainBlendPlanner(this, stroke);
      recordStampGenerationTime(this, generationStart);
      return;
    }

    if (stroke.stabilizer) {
      this.appendStabilizedPoint(point, stroke, generationStart);
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
    releaseHeldThicknessStamps(this, normalizedPoint.timeMs, false);

    if (segmentLength <= 0.0001) {
      stroke.lastInput = normalizedPoint;
      recordStampGenerationTime(this, generationStart);
      return;
    }

    const generationSettings = stroke.lightGlazeSettings ?? this.settings;
    const spacing = Math.max(
      0.1,
      generationSettings.size * (stroke.adaptiveSpacingPercent / 100),
    );
    const curveSegment = stroke.curvePlanner?.plan(
      start.x,
      start.y,
      normalizedPoint.x,
      normalizedPoint.y,
    );
    if (!curveSegment) {
      throw new Error("Planner curva Paint non disponibile.");
    }
    if (this.activeStrokeProfile) {
      this.activeStrokeProfile.strokeCurveInputSegments += 1;
      this.activeStrokeProfile.strokeCurveFlattenedSegments +=
        curveSegment.subdivisionCount;
      if (curveSegment.smoothed) {
        this.activeStrokeProfile.strokeCurveSmoothedSegments += 1;
      }
      if (curveSegment.sharpCornerBypass) {
        this.activeStrokeProfile.strokeCurveSharpCornerBypasses += 1;
      }
    }

    const distanceSinceStamp = resamplePaintCurveSegment(
      curveSegment,
      start,
      normalizedPoint,
      spacing,
      stroke.distanceSinceStamp,
      MAX_STAMPS_PER_BATCH,
      this,
      emitStamp,
    );

    stroke.lastInput = normalizedPoint;
    stroke.distanceSinceStamp = distanceSinceStamp;
    releaseHeldThicknessStamps(this, normalizedPoint.timeMs, false);
    recordStampGenerationTime(this, generationStart);
  }

  private appendStabilizedPoint(
    point: LayerPoint,
    stroke: ActiveStroke,
    generationStart: number,
  ): void {
    const rawStart = stroke.lastInput;
    const normalizedPoint: LayerPoint = {
      ...point,
      timeMs: Math.max(
        rawStart.timeMs,
        Number.isFinite(point.timeMs) ? point.timeMs : rawStart.timeMs,
      ),
    };
    const update = stroke.stabilizer!.push(normalizedPoint);
    stroke.lastInput = normalizedPoint;
    stroke.stabilizationUpdate = update;
    if (this.activeStrokeProfile) {
      this.activeStrokeProfile.strokeStabilizationInputSamples += 1;
      this.activeStrokeProfile.strokeStabilizationMaturePoints += update.matureCount;
      this.activeStrokeProfile.strokeStabilizationForcedMaturePoints +=
        update.forcedMatureCount;
      this.activeStrokeProfile.strokeStabilizationMaximumTailPoints = Math.max(
        this.activeStrokeProfile.strokeStabilizationMaximumTailPoints,
        update.tailCount,
      );
    }

    releaseHeldThicknessStamps(this, normalizedPoint.timeMs, false);
    for (let index = 0; index < update.matureCount; index += 1) {
      this.appendStabilizedMaturePoint(
        update.matureX[index],
        update.matureY[index],
        update.maturePressure[index],
        update.matureTimeMs[index],
        stroke,
      );
    }
    releaseHeldThicknessStamps(this, normalizedPoint.timeMs, false);

    // Even when no point crossed the mature frontier, the latest-only GPU
    // tail changed and must replace its previous revision on the next frame.
    this.displayDirty = true;
    this.requestRender();
    recordStampGenerationTime(this, generationStart);
  }

  private appendStabilizedMaturePoint(
    pointX: number,
    pointY: number,
    pointPressure: number,
    pointTimeMs: number,
    stroke: ActiveStroke,
  ): void {
    const start = stroke.stabilizationCommittedInput;
    const normalizedTimeMs = Math.max(
      start.timeMs,
      Number.isFinite(pointTimeMs) ? pointTimeMs : start.timeMs,
    );
    const deltaX = pointX - start.x;
    const deltaY = pointY - start.y;
    const segmentLength = Math.hypot(deltaX, deltaY);
    if (segmentLength <= 0.0001) {
      start.x = pointX;
      start.y = pointY;
      start.pressure = pointPressure;
      start.timeMs = normalizedTimeMs;
      return;
    }

    const generationSettings = stroke.lightGlazeSettings ?? this.settings;
    const spacing = Math.max(
      0.1,
      generationSettings.size * (stroke.adaptiveSpacingPercent / 100),
    );
    const curveSegment = stroke.curvePlanner?.plan(
      start.x,
      start.y,
      pointX,
      pointY,
    );
    if (!curveSegment) {
      throw new Error("Planner curva Paint non disponibile per la stabilizzazione.");
    }
    if (this.activeStrokeProfile) {
      this.activeStrokeProfile.strokeCurveInputSegments += 1;
      this.activeStrokeProfile.strokeCurveFlattenedSegments +=
        curveSegment.subdivisionCount;
      if (curveSegment.smoothed) {
        this.activeStrokeProfile.strokeCurveSmoothedSegments += 1;
      }
      if (curveSegment.sharpCornerBypass) {
        this.activeStrokeProfile.strokeCurveSharpCornerBypasses += 1;
      }
    }

    const distanceSinceStamp = resamplePaintCurveSegment(
      curveSegment,
      start,
      {
        x: pointX,
        y: pointY,
        pressure: pointPressure,
        timeMs: normalizedTimeMs,
      },
      spacing,
      stroke.distanceSinceStamp,
      MAX_STAMPS_PER_BATCH,
      this,
      emitStamp,
    );

    start.x = pointX;
    start.y = pointY;
    start.pressure = pointPressure;
    start.timeMs = normalizedTimeMs;
    stroke.distanceSinceStamp = distanceSinceStamp;
  }

  private stabilizationPreviewStamp(index: number): Stamp {
    let stamp = this.stabilizationPreviewStamps[index];
    if (!stamp) {
      stamp = {
        x: 0,
        y: 0,
        radius: 0,
        pressure: 1,
        seed: 0,
        directionX: 1,
        directionY: 0,
        historyActionId: 0,
      };
      this.stabilizationPreviewStamps[index] = stamp;
    }
    return stamp;
  }

  private prepareStabilizationTailFrame(
    update: Readonly<StrokeStabilizationUpdate>,
  ): StabilizationTailFrame | null {
    const stroke = this.activeStroke;
    if (
      !stroke
      || !stroke.stabilizer
      || !stroke.lightGlazeSettings
      || update.bypassed
      || update.tailCount < 2
    ) {
      this.stabilizationPreviewStampCount = 0;
      return null;
    }

    const settings = stroke.lightGlazeSettings;
    const referenceTimeMs = Math.max(stroke.lastInput.timeMs, performance.now());
    let stampCount = 0;

    // End-thickness holdback and stabilization share the same provisional
    // accumulator revision. Stamps already generated by the mature prefix keep
    // their exact seed/position; only their live end-radius is recalculated.
    for (
      let heldIndex = stroke.heldThicknessHead;
      heldIndex < stroke.heldThicknessStamps.length;
      heldIndex += 1
    ) {
      const candidate = stroke.heldThicknessStamps[heldIndex];
      const radius = endThicknessRadius(
        candidate.baseRadius,
        candidate.liveThicknessFactor,
        stroke.thicknessSettings.endThickness,
        Math.max(0, referenceTimeMs - candidate.timeMs),
      );
      if (!Number.isFinite(radius) || radius <= 0) {
        continue;
      }
      if (stampCount >= MAX_STAMPS_PER_BATCH) {
        throw new Error("Coda stabilizzazione oltre il buffer massimo di stamp.");
      }
      const target = this.stabilizationPreviewStamp(stampCount);
      target.x = candidate.stamp.x;
      target.y = candidate.stamp.y;
      target.radius = radius;
      target.pressure = candidate.stamp.pressure;
      target.seed = candidate.stamp.seed;
      target.directionX = candidate.stamp.directionX;
      target.directionY = candidate.stamp.directionY;
      target.historyActionId = candidate.stamp.historyActionId;
      stampCount += 1;
    }

    const planner = this.stabilizationPreviewCurvePlanner;
    if (!stroke.curvePlanner) {
      throw new Error("Planner curva autorevole mancante nella stabilizzazione.");
    }
    planner.copyStateFrom(stroke.curvePlanner);
    let distanceSinceStamp = stroke.distanceSinceStamp;
    let seedSequence = this.seedSequence;
    const spacing = Math.max(
      0.1,
      settings.size * (stroke.adaptiveSpacingPercent / 100),
    );
    let startX = update.tailX[0];
    let startY = update.tailY[0];
    let startPressure = update.tailPressure[0];
    let startTimeMs = update.tailTimeMs[0];

    const appendPreviewStamp = (
      pointX: number,
      pointY: number,
      pointPressure: number,
      pointTimeMs: number,
      directionX: number,
      directionY: number,
    ): void => {
      const pressure = clamp(pointPressure, 0.01, 1);
      const baseRadius = Math.max(0.5, settings.size * 0.5);
      const liveThicknessFactor = stroke.thicknessDynamicsNeutral
        ? 1
        : startThicknessFactor(
          stroke.thicknessSettings.startThickness,
          Math.max(0, pointTimeMs - stroke.startedAtMs),
        );
      const radius = stroke.thicknessTailHoldback
        ? endThicknessRadius(
          baseRadius,
          liveThicknessFactor,
          stroke.thicknessSettings.endThickness,
          Math.max(0, referenceTimeMs - pointTimeMs),
        )
        : baseRadius * liveThicknessFactor;
      const seed = (Math.imul(seedSequence++, 0x9e3779b1) ^ 0xa511e9b3) >>> 0;
      if (!Number.isFinite(radius) || radius <= 0) {
        return;
      }
      const jitterReach = radius * 2 * (
        settings.positionJitterLinear + settings.positionJitterLateral
      );
      if (
        pointX + radius + jitterReach < 0
        || pointY + radius + jitterReach < 0
        || pointX - radius - jitterReach >= LAYER_SIZE
        || pointY - radius - jitterReach >= LAYER_SIZE
      ) {
        return;
      }
      if (stampCount >= MAX_STAMPS_PER_BATCH) {
        throw new Error("Coda stabilizzazione oltre il buffer massimo di stamp.");
      }
      const stamp = this.stabilizationPreviewStamp(stampCount);
      stamp.x = pointX;
      stamp.y = pointY;
      stamp.radius = radius;
      stamp.pressure = pressure;
      stamp.seed = seed;
      stamp.directionX = directionX;
      stamp.directionY = directionY;
      stamp.historyActionId = stroke.historyActionId;
      stampCount += 1;
    };

    for (let tailIndex = 1; tailIndex < update.tailCount; tailIndex += 1) {
      const endX = update.tailX[tailIndex];
      const endY = update.tailY[tailIndex];
      const endPressure = update.tailPressure[tailIndex];
      const endTimeMs = update.tailTimeMs[tailIndex];
      const deltaTimeMs = Math.max(0, endTimeMs - startTimeMs);
      const curveSegment = planner.plan(startX, startY, endX, endY);
      let curveStartX = startX;
      let curveStartY = startY;
      let parameterStart = 0;

      for (
        let subdivision = 1;
        subdivision <= curveSegment.subdivisionCount;
        subdivision += 1
      ) {
        const parameterEnd = subdivision / curveSegment.subdivisionCount;
        const curveEndX = subdivision === curveSegment.subdivisionCount
          ? endX
          : evaluateStrokeCurveX(curveSegment, parameterEnd);
        const curveEndY = subdivision === curveSegment.subdivisionCount
          ? endY
          : evaluateStrokeCurveY(curveSegment, parameterEnd);
        const curveDeltaX = curveEndX - curveStartX;
        const curveDeltaY = curveEndY - curveStartY;
        const curveLength = Math.hypot(curveDeltaX, curveDeltaY);
        let distanceAlongCurve = 0;

        if (curveLength > 0.0001) {
          const directionX = curveDeltaX / curveLength;
          const directionY = curveDeltaY / curveLength;
          while (
            distanceSinceStamp + (curveLength - distanceAlongCurve) >= spacing
          ) {
            const distanceToNextStamp = spacing - distanceSinceStamp;
            distanceAlongCurve += distanceToNextStamp;
            const localInterpolation = clamp(distanceAlongCurve / curveLength, 0, 1);
            const curveParameter = parameterStart
              + (parameterEnd - parameterStart) * localInterpolation;
            appendPreviewStamp(
              curveStartX + curveDeltaX * localInterpolation,
              curveStartY + curveDeltaY * localInterpolation,
              startPressure + (endPressure - startPressure) * curveParameter,
              startTimeMs + deltaTimeMs * curveParameter,
              directionX,
              directionY,
            );
            distanceSinceStamp = 0;
          }
          distanceSinceStamp += Math.max(0, curveLength - distanceAlongCurve);
        }
        curveStartX = curveEndX;
        curveStartY = curveEndY;
        parameterStart = parameterEnd;
      }
      startX = endX;
      startY = endY;
      startPressure = endPressure;
      startTimeMs = endTimeMs;
    }

    this.stabilizationPreviewStampCount = stampCount;
    if (stampCount === 0) {
      return null;
    }
    const packed = packStampsIntoUpload(
      this.stabilizationPreviewStamps,
      settings,
      this.thicknessTailInstanceUploadF32,
      this.thicknessTailInstanceUploadU32,
      stampCount,
    );
    if (!packed.dirtyRect) {
      return null;
    }
    const intenseBlending = settings.blendMode === "intense-blending";
    this.writeThicknessTailBrushUniforms({
      ...settings,
      opacity: intenseBlending ? settings.opacity : 1,
      blendMode: "normal",
    }, LAYER_SIZE, LAYER_SIZE, 0, 0);
    this.device.queue.writeBuffer(
      this.thicknessTailInstanceBuffer,
      0,
      this.thicknessTailInstanceUpload,
      0,
      stampCount * STAMP_STRIDE_BYTES,
    );
    return {
      settings,
      stampCount,
      dirtyRect: packed.dirtyRect,
      shapeOccupancySelection: settings.shape === "shape"
        ? this.selectShapeOccupancy(packed.minimumRadius)
        : null,
      grainActive: isTexturizedGrainActive(settings),
    };
  }

  thicknessTailPreviewEligible(): boolean {
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
    const referenceTimeMs = thicknessTailReferenceTimeMs(this);
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
    ensureThicknessTailOverlayResources(this, 
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
      grainActive: isTexturizedGrainActive(settings),
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
          grainCoordinateMode(settings)
        ][settings.grainFiltering][shapeOccupancyMip!]
        : this.thicknessTailGrainBrushBindGroups[
          grainCoordinateMode(settings)
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
    bindPaintPipelineWithPixelSelection(this, pass, pipeline);
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

  private encodeStabilizationTailFrame(
    encoder: GPUCommandEncoder,
    frame: StabilizationTailFrame,
  ): void {
    const settings = frame.settings;
    const isShape = settings.shape === "shape";
    const shapeOccupancyMip = frame.shapeOccupancySelection?.selectedMipLevel ?? null;
    const useShapeOccupancy = isShape && shapeOccupancyMip !== null;
    const lightNoBuildUp = settings.blendMode === "light-glaze"
      || settings.blendMode === "m1-glaze";
    const intenseBlending = settings.blendMode === "intense-blending";
    const pipeline = lightNoBuildUp
      ? frame.grainActive
        ? isShape
          ? useShapeOccupancy
            ? this.grainLightNoBuildUpShapeOccupancyPipeline
            : this.grainLightNoBuildUpShapePipeline
          : this.grainLightNoBuildUpPipeline
        : isShape
          ? useShapeOccupancy
            ? this.lightNoBuildUpShapeOccupancyPipeline
            : this.lightNoBuildUpShapePipeline
          : this.lightNoBuildUpPipeline
      : intenseBlending
        ? frame.grainActive
          ? isShape
            ? useShapeOccupancy
              ? this.grainIntenseBlendingShapeOccupancyPipeline
              : this.grainIntenseBlendingShapePipeline
            : this.grainIntenseBlendingPipeline
          : isShape
            ? useShapeOccupancy
              ? this.intenseBlendingShapeOccupancyPipeline
              : this.intenseBlendingShapePipeline
            : this.intenseBlendingPipeline
        : frame.grainActive
          ? isShape
            ? useShapeOccupancy
              ? this.grainUniformedGlazeShapeOccupancyPipeline
              : this.grainUniformedGlazeShapePipeline
            : this.grainUniformedGlazePipeline
          : isShape
            ? useShapeOccupancy
              ? this.uniformedGlazeShapeOccupancyPipeline
              : this.uniformedGlazeShapePipeline
            : this.uniformedGlazePipeline;
    const bindGroup = frame.grainActive
      ? useShapeOccupancy
        ? this.thicknessTailGrainBrushOccupancyBindGroups[
          grainCoordinateMode(settings)
        ][settings.grainFiltering][shapeOccupancyMip!]
        : this.thicknessTailGrainBrushBindGroups[
          grainCoordinateMode(settings)
        ][settings.grainFiltering]
      : useShapeOccupancy
        ? this.thicknessTailBrushOccupancyBindGroups[shapeOccupancyMip!]
        : this.thicknessTailBrushBindGroup;

    const pass = encoder.beginRenderPass({
      label: "Draw revisionable stabilization tail into gesture accumulator",
      colorAttachments: [{
        view: this.lightGlazeView!,
        loadOp: "load",
        storeOp: "store",
      }],
    });
    bindPaintPipelineWithPixelSelection(this, pass, pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setScissorRect(
      frame.dirtyRect.x,
      frame.dirtyRect.y,
      frame.dirtyRect.width,
      frame.dirtyRect.height,
    );
    pass.draw(STAMP_VERTICES_PER_COPY, frame.stampCount * settings.count, 0, 0);
    pass.end();
    if (this.activeStrokeProfile) {
      this.activeStrokeProfile.strokeStabilizationTailFrames += 1;
      this.activeStrokeProfile.strokeStabilizationTailBaseStamps += frame.stampCount;
      this.activeStrokeProfile.strokeStabilizationTailPhysicalCopies +=
        frame.stampCount * settings.count;
    }
  }

  commitThicknessStamp(stamp: Stamp, stroke: ActiveStroke): void {
    commitThicknessStamp(this, stamp, stroke);
  }

  private vectorTextFastPresentationHasAuthoritativeWork(): boolean {
    return this.pendingStamps.length > 0
      || this.pendingBlendBatches.length > 0
      || this.clearRequested
      || Boolean(this.lightGlazeSession?.commitRequested)
      || this.thicknessTailPreviewEligible()
      || this.thicknessTailPresentedRect !== null;
  }

  private trackVectorTextFastPresentationSubmission(): void {
    if (this.vectorTextFastPresentationInFlight) {
      return;
    }
    const submittedRevision = this.vectorTextFastRequestedRevision;
    this.vectorTextFastPresentationInFlight = true;
    this.vectorTextFastSubmittedRevision = Math.max(
      this.vectorTextFastSubmittedRevision,
      submittedRevision,
    );
    this.vectorTextFastPresentationSubmissionCount += 1;
    void this.device.queue.onSubmittedWorkDone().then(() => {
      this.vectorTextFastCompletedRevision = Math.max(
        this.vectorTextFastCompletedRevision,
        submittedRevision,
      );
      this.vectorTextFastPresentationInFlight = false;
      if (
        this.vectorTextFastPresentationEnabled
        && this.vectorTextFastPresentationLatestRequested
      ) {
        this.vectorTextFastPresentationLatestRequested = false;
        this.displayDirty = true;
        this.presentationCacheNeedsFullRebuild = true;
        this.requestRender();
      } else {
        this.vectorTextFastPresentationLatestRequested = false;
      }
    }).catch(() => {
      // Device loss has its own authoritative reporting path. This promise is
      // only a non-blocking backpressure gate and must never surface as an
      // unhandled rejection or be interpreted as timing telemetry.
      this.vectorTextFastPresentationInFlight = false;
      this.vectorTextFastPresentationLatestRequested = false;
    });
  }

  requestRender(): void {
    if (!this.initialized || this.renderFrameError || this.deviceLostError) {
      return;
    }
    if (this.frameRequest !== null) {
      return;
    }
    if (this.vectorTextFastPresentationEnabled && this.vectorTextFastPresentationInFlight) {
      this.vectorTextFastPresentationLatestRequested = true;
      if (!this.vectorTextFastPresentationHasAuthoritativeWork()) {
        this.vectorTextFastPresentationCoalescedRequestCount += 1;
        return;
      }
    }
    this.frameRequest = requestAnimationFrame((timestamp) => runRenderFrame(this, timestamp));
  }

  renderFrame(timestamp: number): void {
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
      releaseHeldThicknessStamps(this, thicknessTailReferenceTimeMs(this), false);
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
    const batch = batchSize > 0 ? this.pendingStamps.slice(0, batchSize) : [];
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
      blendBatch = this.pendingBlendBatches.slice(0, blendBatchSize);
    }
    if (lightGlazeSession) {
      let hasPendingStampForGesture = false;
      for (let index = batchSize; index < this.pendingStamps.length; index += 1) {
        if (
          this.pendingStamps[index].historyActionId
          === lightGlazeSession.historyActionId
        ) {
          hasPendingStampForGesture = true;
          break;
        }
      }
      lightGlazeSession.commitRequested = lightGlazeSession.endRequested
        && !hasPendingStampForGesture;
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
    if (batch.length > 0) {
      this.pendingStamps.splice(0, batch.length);
    }
    if (blendBatch.length > 0) {
      this.pendingBlendBatches.splice(0, blendBatch.length);
    }
    this.lastCpuFrameMs = performance.now() - start;

    if (blendBatch.length > 0) {
      recordBlendHistoryBatch(this, blendBatch, timing, clearLayer);
      this.layerHasContent = true;
    } else if (batch.length > 0) {
      this.trackAdaptivePreviewExactSubmission(batch, renderSettings);
      this.recordHistoryBatch(batch, renderSettings, timing, clearLayer);
      if (clearLayer) this.layerHasContent = timing.dirtyRect !== null;
      else if (timing.dirtyRect) this.layerHasContent = true;
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
    if (
      this.vectorTextFastPresentationEnabled
      && batch.length === 0
      && blendBatch.length === 0
      && !clearLayer
      && !lightGlazeSession?.commitRequested
      && !this.thicknessTailPreviewEligible()
      && this.thicknessTailPresentedRect === null
    ) {
      this.trackVectorTextFastPresentationSubmission();
    }

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
    maybeReleaseIdleBlendScratch(this);
    maybeReleaseIdleLightGlazeResources(this);
    maybeReleaseIdleGrainResources(this);
    maybeReleaseIdleShapeResources(this);
    this.scheduleEffectsScratchShrink();
    this.scheduleBevelFieldShrink();
  }

  recordHistoryBatch(
    batch: Stamp[],
    settings: BrushSettings,
    timing: SubmitTiming,
    clearLayer: boolean,
    capturedSlice: GpuHistorySlice | null = timing.historyGpuSlice,
  ): void {
    if (batch.length === 0 || batch[0].historyActionId === 0) {
      return;
    }
    const actionId = batch[0].historyActionId;
    if (batch.at(-1)?.historyActionId !== actionId) {
      if (capturedSlice) this.historyGpuStorage.release(capturedSlice);
      throw new Error("Un batch Paint storico contiene più pennellate.");
    }
    if (!capturedSlice) {
      throw new Error("Payload GPU della cronologia Paint mancante.");
    }
    const expectedBytes = batch.length * STAMP_STRIDE_BYTES;
    if (capturedSlice.logicalBytes !== expectedBytes) {
      this.historyGpuStorage.release(capturedSlice);
      throw new Error(
        `Payload GPU Paint ${capturedSlice.logicalBytes} B, attesi ${expectedBytes} B.`,
      );
    }

    if (
      this.activeStroke
      && actionId === this.activeStroke.historyActionId
    ) {
      this.activeStroke.submitted = true;
    }

    const selectionMask = this.selectionHistoryMasksByAction.get(actionId) ?? null;
    if (this.pixelSelectionState.selectedPixels > 0 && !selectionMask) {
      this.historyGpuStorage.release(capturedSlice);
      throw new Error("Maschera storica Paint non acquisita prima del rendering.");
    }

    this.historyBatches.push({
      kind: "paint",
      actionId,
      // Safe to read the active layer here because switching is refused while a
      // stroke is open (assertLayerSwitchAllowed), so the layer that recorded
      // the stamps is still the active one when the batch is stored.
      layerId: this.layerStack.active.id,
      settings,
      stampCount: batch.length,
      firstSeed: batch[0].seed,
      gpuSlice: capturedSlice,
      clearLayer,
      dirtyRect: timing.dirtyRect,
      shapeOccupancySelection: timing.shapeOccupancySelection,
      shapeMaskIdentity: settings.shape === "shape" ? this.shapeMaskIdentity : null,
      grainTextureIdentity: isTexturizedGrainActive(settings)
        ? this.grainTextureIdentity
        : null,
      selectionMask,
    });
    this.historyStoredBaseStamps += batch.length;

    if (this.activeStrokeProfile) {
      this.activeStrokeProfile.historyCapturedBaseStamps += batch.length;
      this.activeStrokeProfile.historyCapturedBatches += 1;
    }
  }

  resetHistoryState(): void {
    destroyHistoryMaintenance(this);
    const vectorRasterActions = new Set([
      ...this.historyActions,
      ...this.discardedVectorRasterHistoryActions,
      ...this.discardedRasterImportHistoryActions,
      ...this.discardedRasterTransformHistoryActions,
      ...this.discardedLayerDeleteHistoryActions,
    ]);
    for (const action of vectorRasterActions) {
      if (action.kind === "vector-rasterize") {
        destroyVectorRasterHistorySeed(action);
      } else if (action.kind === "raster-import") {
        destroyRasterImportHistorySeed(action);
      } else if (action.kind === "raster-transform") {
        destroyLayerColdStorage(action.seed);
      } else if (action.kind === "layer-delete") {
        destroyLayerDeleteHistorySeeds(action);
      }
    }
    this.discardedVectorRasterHistoryActions = [];
    this.discardedRasterImportHistoryActions = [];
    this.discardedRasterTransformHistoryActions = [];
    this.discardedLayerDeleteHistoryActions = [];
    if (this.historyGpuStorage) {
      this.historyGpuStorage.releaseAll();
      this.selectionHistoryMasksByAction.clear();
      this.selectionHistoryMasksByRevision.clear();
      this.selectionHistoryClipBindGroups.clear();
      this.selectionLiveClipBindGroup = null;
      scheduleHistoryGpuTrim(this);
    }
    this.historyActions = [];
    this.historyCursor = 0;
    this.nextHistoryActionId = 1;
    this.historyBatches = [];
    this.historyStoredBaseStamps = 0;
    this.historyCompactionPending = false;
    this.activeVectorHistoryEdit = null;
    this.activeRasterLayerMetadataHistoryEdit = null;
    this.sweepRasterImageGpuResources();
  }

  sweepRasterImageGpuResources(): number {
    const retainedAssetIds = new Set<string>();
    const retainNode = (node: VectorTextNode | VectorSvgNode | RasterImageNode | null) => {
      if (node?.kind === "image") retainedAssetIds.add(node.document.assetId);
    };
    const scene = this.mixedSceneStack;
    if (scene) {
      for (const item of scene.items) {
        if (item.kind === "image") {
          retainedAssetIds.add(scene.imageById(item.imageNodeId).document.assetId);
        }
      }
    }
    for (const action of this.historyActions) {
      if (action.kind === "vector") {
        retainNode(action.delta.before.node);
        retainNode(action.delta.after.node);
      } else if (action.kind === "vector-rasterize") {
        retainNode(action.vectorState.node);
      }
    }
    for (const action of this.discardedVectorRasterHistoryActions) {
      retainNode(action.vectorState.node);
    }
    for (const action of this.activeStroke?.redoActionsBeforeStroke ?? []) {
      if (action.kind === "vector") {
        retainNode(action.delta.before.node);
        retainNode(action.delta.after.node);
      } else if (action.kind === "vector-rasterize") {
        retainNode(action.vectorState.node);
      }
    }
    retainNode(this.activeVectorHistoryEdit?.before.node ?? null);

    let released = 0;
    for (const [assetId, resource] of this.rasterImageGpuResources) {
      if (retainedAssetIds.has(assetId)) continue;
      resource.uniformBuffer.destroy();
      resource.texture.destroy();
      this.rasterImageGpuResources.delete(assetId);
      released += 1;
    }
    return released;
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
  historyReplayFaultQueue: HistoryReplayFaultPoint[] = [];

  injectHistoryReplayFault(...faultPoints: HistoryReplayFaultPoint[]): void {
    if (!import.meta.env.DEV) {
      throw new Error("Iniezione di guasti disponibile solo in modalità dev.");
    }
    if (faultPoints.length === 0) {
      throw new Error("Specifica almeno un punto di guasto della cronologia.");
    }
    this.historyReplayFaultQueue = [...faultPoints];
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

  invalidateAdaptivePreview(): void {
    finishAdaptivePreviewLifetime(this);
    this.adaptivePreviewGeneration += 1;
    cancelAdaptivePreviewProbe(this);
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
    clearAdaptivePreviewCanvas(this);
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

  startAdaptivePreviewProbe(force: boolean): void {
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
      activateAdaptivePreview(this, "probe-timeout");
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
        if (hasAdaptivePreviewPresentedUnboundCandidate(this)) {
          return;
        }
        if (this.adaptivePreviewConfirmedSerial >= this.adaptivePreviewRetirementTargetSerial) {
          scheduleAdaptivePreviewRetirement(this);
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
        activateAdaptivePreview(this, "consecutive-slow");
      }

      if (this.adaptivePreviewActive) {
        if (this.adaptivePreviewCandidates.length > 0) {
          requestAdaptivePreviewDraw(this);
        } else {
          scheduleAdaptivePreviewCatchUpClear(this);
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
        if (hasAdaptivePreviewPresentedUnboundCandidate(this)) {
          return;
        }
        if (
          this.adaptivePreviewRetirementTargetSerial > 0
          && this.adaptivePreviewConfirmedSerial >= this.adaptivePreviewRetirementTargetSerial
        ) {
          scheduleAdaptivePreviewRetirement(this);
        } else {
          this.startAdaptivePreviewProbe(true);
        }
      }
      return;
    }
    if (this.pixelSelectionState.selectedPixels > 0) {
      this.adaptivePreviewCandidates.length = 0;
      clearAdaptivePreviewCanvas(this);
      // The Canvas2D emergency tip cannot sample the document-wide one-bit
      // selection. Queue probes remain active for adaptive spacing, while the
      // only visible stroke is the exact selection-clipped WebGPU result.
      this.startAdaptivePreviewProbe(false);
      return;
    }
    if (isTexturizedGrainActive(settings)) {
      if (profile) {
        profile.grainAdaptivePreviewSkips += 1;
      }
      this.adaptivePreviewCandidates.length = 0;
      clearAdaptivePreviewCanvas(this);
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
      clearAdaptivePreviewCanvas(this);
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
      activateAdaptivePreview(this, "diagnostic-force");
    }
    if (this.adaptivePreviewActive) {
      requestAdaptivePreviewDraw(this);
    }
    this.startAdaptivePreviewProbe(this.adaptivePreviewActive);
  }

  recordAdaptivePreviewJsFrame(startedAt: number, budgetAlreadyCounted: boolean): void {
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

  drawAdaptivePreviewFrame(): void {
    const startedAt = performance.now();
    const canvas = this.adaptivePreviewCanvas;
    const visibleContext = this.adaptivePreviewContext;
    const scratchCanvas = this.adaptivePreviewScratchCanvas;
    const context = this.adaptivePreviewScratchContext;
    const candidates = adaptivePreviewCandidatesForFrame(this);
    if (
      this.pixelSelectionState.selectedPixels > 0
      || !canvas
      || !visibleContext
      || !scratchCanvas
      || !context
      || candidates.length === 0
    ) {
      finishIncompleteAdaptivePreviewFrame(this, startedAt, false, candidates, false);
      return;
    }

    const settings = candidates[candidates.length - 1].settings;
    if (isTexturizedGrainActive(settings)) {
      if (this.activeStrokeProfile) {
        this.activeStrokeProfile.grainAdaptivePreviewSkips += 1;
      }
      finishIncompleteAdaptivePreviewFrame(this, startedAt, false, candidates, false);
      return;
    }
    if (settings.blendMode !== "normal") {
      if (this.activeStrokeProfile) {
        this.activeStrokeProfile.adaptivePreviewUnsupportedBlendSkips += 1;
      }
      finishIncompleteAdaptivePreviewFrame(this, startedAt, false, candidates, false);
      return;
    }
    if (settings.shape === "shape") {
      prepareAdaptivePreviewShapePalette(this, settings);
      if (this.adaptivePreviewShapePalette.length === 0) {
        finishIncompleteAdaptivePreviewFrame(this, startedAt, false, candidates, false);
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
      finishIncompleteAdaptivePreviewFrame(this, startedAt, false, candidates, false);
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
        candidateSettings.flow * candidateSettings.opacity,
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
          ? (
              candidateSettings.shapeRotation === "follow-stroke"
                ? Math.atan2(directionY, directionX)
                : 0
            )
            + (previewRandom01(copySeed, 7) - 0.5)
              * Math.PI
              * 2
              * candidateSettings.shapeScatter
          : 0;
        const colorSeed = candidateSettings.jitterPerCopy
          ? copySeed
          : previewHash32(stamp.seed);
        const [red, green, blue] = adaptivePreviewRgb(
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
      finishIncompleteAdaptivePreviewFrame(this, startedAt, false, candidates, false);
      return;
    }
    if (performance.now() - startedAt > ADAPTIVE_PREVIEW_JS_BUDGET_MS) {
      if (this.activeStrokeProfile) {
        this.activeStrokeProfile.adaptivePreviewBudgetSkips += 1;
      }
      finishIncompleteAdaptivePreviewFrame(this, startedAt, true, candidates, true);
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
      finishIncompleteAdaptivePreviewFrame(this, startedAt, false, candidates, false);
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
      finishIncompleteAdaptivePreviewFrame(this, startedAt, false, candidates, false);
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
      finishIncompleteAdaptivePreviewFrame(this, startedAt, true, candidates, true);
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

  private encodePaintHistoryReplay(
    encoder: GPUCommandEncoder,
    replayBatch: PaintHistoryRenderBatch | null,
  ): void {
    if (!replayBatch) {
      return;
    }
    encoder.copyBufferToBuffer(
      replayBatch.gpuSlice.buffer,
      replayBatch.gpuSlice.offsetBytes,
      this.instanceBuffer,
      0,
      replayBatch.gpuSlice.logicalBytes,
    );
  }

  private encodePaintHistoryCapture(
    encoder: GPUCommandEncoder,
    stamps: readonly Stamp[],
    label: string,
  ): GpuHistorySlice | null {
    if (stamps.length === 0 || stamps[0].historyActionId === 0) {
      return null;
    }
    const actionId = stamps[0].historyActionId;
    if (stamps.at(-1)?.historyActionId !== actionId) {
      throw new Error("Un submit Paint live contiene più pennellate.");
    }
    const byteLength = stamps.length * STAMP_STRIDE_BYTES;
    const slice = this.historyGpuStorage.allocate(
      byteLength,
      `${label} · azione ${actionId} · ${stamps.length} stamp`,
    );
    try {
      encoder.copyBufferToBuffer(
        this.instanceBuffer,
        0,
        slice.buffer,
        slice.offsetBytes,
        byteLength,
      );
      return slice;
    } catch (error) {
      this.historyGpuStorage.release(slice);
      throw error;
    }
  }

  captureCurrentInstanceBufferForHistory(
    stampCount: number,
    label: string,
  ): GpuHistorySlice {
    const byteLength = stampCount * STAMP_STRIDE_BYTES;
    const slice = this.historyGpuStorage.allocate(byteLength, label);
    try {
      const encoder = this.device.createCommandEncoder({
        label: "Cattura GPU cronologia benchmark",
      });
      encoder.copyBufferToBuffer(
        this.instanceBuffer,
        0,
        slice.buffer,
        slice.offsetBytes,
        byteLength,
      );
      this.device.queue.submit([encoder.finish()]);
      return slice;
    } catch (error) {
      this.historyGpuStorage.release(slice);
      throw error;
    }
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
    const stampCount = resolvePaintHistoryStampCount(stamps, replayBatch);
    if (!session || !isStrokeGlazeBlendMode(session.settings.blendMode)) {
      throw new Error("Sessione Light Glaze mancante durante il rendering.");
    }
    const expectedShapeIdentity = settings.shape === "shape" ? this.shapeMaskIdentity : null;
    if (replayBatch && replayBatch.shapeMaskIdentity !== expectedShapeIdentity) {
      throw new Error("La Shape usata dalla cronologia non corrisponde alla risorsa corrente.");
    }
    const expectedGrainIdentity = isTexturizedGrainActive(settings)
      ? this.grainTextureIdentity
      : null;
    if (replayBatch && replayBatch.grainTextureIdentity !== expectedGrainIdentity) {
      throw new Error("Il Grain usato dalla cronologia non corrisponde alla risorsa corrente.");
    }
    const storageMode = lightGlazeStorageModeFor(settings.blendMode);
    if (storageMode === "none") {
      throw new Error("Modalita storage glaze non valida durante il rendering.");
    }
    if (!lightGlazeResourcesMatch(this, storageMode)) {
      throw new Error("Risorse rendering glaze mancanti durante il rendering.");
    }
    const grainActive = isTexturizedGrainActive(settings);
    const lightNoBuildUp = settings.blendMode === "light-glaze"
      || settings.blendMode === "m1-glaze";
    const stabilizationUpdate = present
      && !replayBatch
      && this.activeStroke?.historyActionId === session.historyActionId
      && this.activeStroke.stabilizer
      && this.activeStroke.stabilizationUpdate
      && this.pendingStamps.length <= stampCount
      ? this.activeStroke.stabilizationUpdate
      : null;
    const stabilizationFrame = stabilizationUpdate
      ? this.prepareStabilizationTailFrame(stabilizationUpdate)
      : null;
    const stabilizationRestoreTexture = present
      ? this.stabilizationSnapshotTexture
      : null;
    const stabilizationRestoreRect = present
      ? this.stabilizationSnapshotRect
      : null;
    let retiredStabilizationSnapshot: GPUTexture | null = null;
    if (stabilizationFrame) {
      retiredStabilizationSnapshot = ensureStrokeStabilizationSnapshot(
        this,
        storageMode,
        stabilizationFrame.dirtyRect.width,
        stabilizationFrame.dirtyRect.height,
      );
      if (this.activeStrokeProfile) {
        const snapshotPixels = this.stabilizationSnapshotWidth
          * this.stabilizationSnapshotHeight;
        const snapshotBytesPerPixel = storageMode === "r8-coverage" ? 1 : 8;
        this.activeStrokeProfile.strokeStabilizationMaximumSnapshotPixels = Math.max(
          this.activeStrokeProfile.strokeStabilizationMaximumSnapshotPixels,
          snapshotPixels,
        );
        this.activeStrokeProfile.strokeStabilizationMaximumSnapshotBytes = Math.max(
          this.activeStrokeProfile.strokeStabilizationMaximumSnapshotBytes,
          snapshotPixels * snapshotBytesPerPixel,
        );
      }
    }
    if (stabilizationRestoreRect && !stabilizationRestoreTexture) {
      throw new Error("Snapshot della coda stabilizzata mancante.");
    }

    const cpuStart = performance.now();
    if (present) {
      ensurePresentationCacheTexture(this);
    }
    const intenseBlending = settings.blendMode === "intense-blending";
    // Light: Flow enters each candidate deposit, but MAX — never source-over —
    // combines every physical stamp belonging to this pointer-down. Opacity is
    // deliberately forced to 1 here and applied exactly once at lift. A later
    // pointer-down starts a fresh accumulator and source-overs at its own lift.
    // Uniformed also applies Opacity once to its completed gesture.
    // Intense applies it to every physical deposit: overlapping stamps then
    // converge by ordinary premultiplied source-over, exactly like the
    // measured Procreate spacing/jitter fixtures.
    this.writeBrushUniforms({
      ...settings,
      opacity: intenseBlending ? settings.opacity : 1,
      blendMode: "normal",
    });
    if (grainActive) {
      this.writeGrainUniforms(settings);
    }
    const firstSeed = replayBatch?.firstSeed
      ?? stamps[0]?.seed
      ?? (stabilizationFrame ? this.stabilizationPreviewStamps[0]?.seed : undefined);
    if (lightNoBuildUp && session.tintLinear === null && firstSeed !== undefined) {
      const [red, green, blue] = adaptivePreviewRgb(
        previewHash32(firstSeed),
        settings,
      );
      session.tintLinear = [
        srgbByteToLinear(red),
        srgbByteToLinear(green),
        srgbByteToLinear(blue),
      ];
    }
    this.writeLightGlazeUniforms(
      intenseBlending ? 1 : settings.opacity,
      lightNoBuildUp
        ? "light-no-build-up"
        : intenseBlending
          ? "encoded-srgb-source-over"
          : "source-over",
      session.tintLinear,
    );

    const encoder = this.device.createCommandEncoder({ label: "Light Glaze frame encoder" });
    if (stabilizationRestoreRect && stabilizationRestoreTexture) {
      encoder.copyTextureToTexture(
        { texture: stabilizationRestoreTexture },
        {
          texture: this.lightGlazeTexture!,
          origin: {
            x: stabilizationRestoreRect.x,
            y: stabilizationRestoreRect.y,
            z: 0,
          },
        },
        {
          width: stabilizationRestoreRect.width,
          height: stabilizationRestoreRect.height,
          depthOrArrayLayers: 1,
        },
      );
    }
    let stampPackingMs = 0;
    let instanceUploadMs = 0;
    let brushEncodingMs = 0;
    let displayEncodingMs = 0;
    let commandSubmitMs = 0;
    let scissorPixels = 0;
    let submittedDirtyRect: DirtyRect | null = null;
    let liveDirtyRect: DirtyRect | null = stabilizationRestoreRect;
    let submittedShapeOccupancySelection: ShapeOccupancySelection | null = null;
    let lightGlazeClearEncoded = false;
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

    if (stampCount > 0) {
      if (replayBatch) {
        submittedDirtyRect = replayBatch.dirtyRect;
        submittedShapeOccupancySelection = settings.shape === "shape"
          ? replayBatch.shapeOccupancySelection
          : null;
        this.encodePaintHistoryReplay(encoder, replayBatch);
      } else {
        const packingStart = performance.now();
        submittedDirtyRect = packStamps(this, stamps, settings);
        stampPackingMs = performance.now() - packingStart;
        const uploadStart = performance.now();
        this.device.queue.writeBuffer(
          this.instanceBuffer,
          0,
          this.instanceUpload,
          0,
          stampCount * STAMP_STRIDE_BYTES,
        );
        if (settings.shape === "shape") {
          submittedShapeOccupancySelection = this.selectShapeOccupancy(this.packedMinimumRadius);
        }
        instanceUploadMs = performance.now() - uploadStart;
      }
      submittedDirtyRect = clipPaintDirtyRectToPixelSelection(
        this,
        submittedDirtyRect,
        replayBatch,
      );

      const brushPass = encoder.beginRenderPass({
        label: "Accumulate Light Glaze stroke",
        colorAttachments: [{
          view: this.lightGlazeView!,
          loadOp: "load",
          storeOp: "store",
        }],
      });
      if (session.needsClear) {
        const staleRect = this.lightGlazeStaleRect;
        if (staleRect) {
          brushPass.setPipeline(
            this.lightGlazeStorageMode === "r8-coverage"
              ? this.lightGlazeClearR8Pipeline
              : this.lightGlazeClearRgba16FloatPipeline,
          );
          brushPass.setScissorRect(
            staleRect.x,
            staleRect.y,
            staleRect.width,
            staleRect.height,
          );
          brushPass.draw(3, 1, 0, 0);
        }
        lightGlazeClearEncoded = true;
      }
      if (submittedDirtyRect) {
        scissorPixels = submittedDirtyRect.width * submittedDirtyRect.height;
        const isShape = settings.shape === "shape";
        const shapeOccupancyMip = submittedShapeOccupancySelection?.selectedMipLevel ?? null;
        const useShapeOccupancy = isShape && shapeOccupancyMip !== null;
        const pipeline = lightNoBuildUp
          ? grainActive
            ? isShape
              ? useShapeOccupancy
                ? this.grainLightNoBuildUpShapeOccupancyPipeline
                : this.grainLightNoBuildUpShapePipeline
              : this.grainLightNoBuildUpPipeline
            : isShape
              ? useShapeOccupancy
                ? this.lightNoBuildUpShapeOccupancyPipeline
                : this.lightNoBuildUpShapePipeline
              : this.lightNoBuildUpPipeline
          : intenseBlending
            ? grainActive
              ? isShape
                ? useShapeOccupancy
                  ? this.grainIntenseBlendingShapeOccupancyPipeline
                  : this.grainIntenseBlendingShapePipeline
                : this.grainIntenseBlendingPipeline
              : isShape
                ? useShapeOccupancy
                  ? this.intenseBlendingShapeOccupancyPipeline
                  : this.intenseBlendingShapePipeline
                : this.intenseBlendingPipeline
            : grainActive
              ? isShape
                ? useShapeOccupancy
                  ? this.grainUniformedGlazeShapeOccupancyPipeline
                  : this.grainUniformedGlazeShapePipeline
                : this.grainUniformedGlazePipeline
              : isShape
                ? useShapeOccupancy
                  ? this.uniformedGlazeShapeOccupancyPipeline
                  : this.uniformedGlazeShapePipeline
                : this.uniformedGlazePipeline;
        bindPaintPipelineWithPixelSelection(this, brushPass, pipeline, replayBatch);
        brushPass.setBindGroup(
          0,
          grainActive
            ? useShapeOccupancy
              ? this.grainBrushOccupancyBindGroups[
                grainCoordinateMode(settings)
              ][settings.grainFiltering][shapeOccupancyMip!]
              : this.grainBrushBindGroups[
                grainCoordinateMode(settings)
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
        brushPass.draw(STAMP_VERTICES_PER_COPY, stampCount * settings.count, 0, 0);
        if (grainActive) {
          grainBatches = 1;
          grainBaseStamps = stampCount;
          grainPhysicalCopies = stampCount * settings.count;
          grainCircleBatches = isShape ? 0 : 1;
          grainShapeBatches = isShape ? 1 : 0;
        }
      }
      brushPass.end();
      session.hasContent = session.hasContent || submittedDirtyRect !== null;
      session.dirtyRect = mergeDirtyRects(session.dirtyRect, submittedDirtyRect);
      session.authoritativeDirtyRect = mergeDirtyRects(
        session.authoritativeDirtyRect,
        submittedDirtyRect,
      );
      lightGlazeBatches = 1;
    }

    if (stabilizationFrame && session.needsClear && stampCount === 0) {
      const staleRect = this.lightGlazeStaleRect;
      if (staleRect) {
        const clearPass = encoder.beginRenderPass({
          label: "Clear stale glaze before first stabilization-only frame",
          colorAttachments: [{
            view: this.lightGlazeView!,
            loadOp: "load",
            storeOp: "store",
          }],
        });
        clearPass.setPipeline(
          this.lightGlazeStorageMode === "r8-coverage"
            ? this.lightGlazeClearR8Pipeline
            : this.lightGlazeClearRgba16FloatPipeline,
        );
        clearPass.setScissorRect(staleRect.x, staleRect.y, staleRect.width, staleRect.height);
        clearPass.draw(3, 1, 0, 0);
        clearPass.end();
      }
      lightGlazeClearEncoded = true;
    }

    liveDirtyRect = mergeDirtyRects(liveDirtyRect, submittedDirtyRect);
    if (stabilizationFrame) {
      if (!this.stabilizationSnapshotTexture) {
        throw new Error("Allocazione snapshot della stabilizzazione mancante.");
      }
      encoder.copyTextureToTexture(
        {
          texture: this.lightGlazeTexture!,
          origin: {
            x: stabilizationFrame.dirtyRect.x,
            y: stabilizationFrame.dirtyRect.y,
            z: 0,
          },
        },
        { texture: this.stabilizationSnapshotTexture },
        {
          width: stabilizationFrame.dirtyRect.width,
          height: stabilizationFrame.dirtyRect.height,
          depthOrArrayLayers: 1,
        },
      );
      this.encodeStabilizationTailFrame(encoder, stabilizationFrame);
      session.hasContent = true;
      session.dirtyRect = mergeDirtyRects(session.dirtyRect, stabilizationFrame.dirtyRect);
      liveDirtyRect = mergeDirtyRects(liveDirtyRect, stabilizationFrame.dirtyRect);
      scissorPixels += stabilizationFrame.dirtyRect.width
        * stabilizationFrame.dirtyRect.height;
    }
    brushEncodingMs += performance.now() - brushEncodingStart;

    if (!present && (clearLayer || stampCount > 0 || session.commitRequested)) {
      this.presentationCacheNeedsFullRebuild = true;
      this.paintDisplayMipValidThroughLevel = 0;
      deferRasterStrokeMutation(this, clearLayer);
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
            liveDirtyRect,
            mergeDirtyRects(this.layerContentBounds, session.dirtyRect),
            clearLayer,
          )
          : { dirtyRect: null, timing: null };
        const tileBlendOwnsPyramid = displaySelectedMipLevel > 0
          && this.usesLayerBlendTilePresentation();
        if (rasterStrokeActive && !tileBlendOwnsPyramid) {
          if (clearLayer || liveDirtyRect) {
            this.paintDisplayMipValidThroughLevel = 0;
          }
          const rasterPyramidStart = performance.now();
          const rasterPyramid = encodeRasterStrokeDisplayPyramid(this, 
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
        } else if (session.hasContent && !tileBlendOwnsPyramid) {
          const glazePyramid = encodeLightGlazeDisplayPyramid(this, 
            encoder,
            session,
            liveDirtyRect,
            displaySelectedMipLevel,
          );
          lightGlazePyramidPasses += glazePyramid.passes;
          lightGlazePyramidUpdatedPixels += glazePyramid.updatedPixels;
        } else if (!tileBlendOwnsPyramid) {
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
          : liveDirtyRect;
        const presentationDirtyRect = requiresFullRebuild
          ? { x: 0, y: 0, width: this.canvas.width, height: this.canvas.height }
          : presentationLayerDirtyRect
            ? layerDirtyRectToPresentationRect(this, presentationLayerDirtyRect, displaySelectedMipLevel)
            : null;

        if (presentationDirtyRect) {
          if (!tileBlendOwnsPyramid) {
            encodeMergedDisplayPyramids(this, encoder, displaySelectedMipLevel);
          }
          this.writeDisplayUniforms(displaySelectedMipLevel);
          if (rasterStrokeActive) {
            this.rasterStrokeRenderer!.updateDisplayParameters(
              "light-glaze",
              this.rasterStrokeStyle,
              this.rasterBevelStyle,
              this.rasterColorOverlayStyle,
            );
          }
          const lod0FullRebuildCpuEncodingStart = requiresFullRebuild
            && displaySelectedMipLevel === 0 ? performance.now() : 0;
          if (this.usesOrderedScenePresentation()) {
            const activePresentation: MixedSceneActivePresentation = rasterStrokeActive
              ? { kind: "raster-stroke", sourceMode: "light-glaze" }
              : session.hasContent
                ? { kind: "light-glaze" }
                : { kind: "base" };
            const blendLabel = requiresFullRebuild
              ? "Rebuild segmented presentation cache with live Light Glaze"
              : "Update segmented presentation cache with live Light Glaze";
            if (this.usesLayerBlendTilePresentation()) {
              encodeLayerBlendTilePresentation(
                this,
                encoder,
                presentationDirtyRect,
                presentationLayerDirtyRect,
                requiresFullRebuild,
                activePresentation,
                blendLabel,
              );
            } else {
              encodeMixedSceneSegmentedPresentation(
                this,
                encoder,
                presentationDirtyRect,
                requiresFullRebuild,
                activePresentation,
                blendLabel,
              );
            }
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

    const authoritativeDirtyRect = session.authoritativeDirtyRect;
    if (session.commitRequested) {
      if (session.hasContent && authoritativeDirtyRect) {
        const compositeStart = performance.now();
        if (
          session.settings.blendMode === "uniformed-glaze"
          || session.settings.blendMode === "intense-blending"
        ) {
          if (
            !this.lightGlazeCommitTileTexture
            || !this.lightGlazeCommitTileView
            || !this.lightGlazeCommitTileBindGroup
          ) {
            throw new Error("Scratch tile Intense Blending non disponibile al commit.");
          }
          const tileUniformUpload = new Uint32Array(
            LIGHT_GLAZE_COMMIT_TILE_UNIFORM_BUFFER_BYTES / Uint32Array.BYTES_PER_ELEMENT,
          );
          let tileIndex = 0;
          const dirtyRight = authoritativeDirtyRect.x + authoritativeDirtyRect.width;
          const dirtyBottom = authoritativeDirtyRect.y + authoritativeDirtyRect.height;
          for (
            let tileY = authoritativeDirtyRect.y;
            tileY < dirtyBottom;
            tileY += LIGHT_GLAZE_COMMIT_TILE_EXTENT
          ) {
            for (
              let tileX = authoritativeDirtyRect.x;
              tileX < dirtyRight;
              tileX += LIGHT_GLAZE_COMMIT_TILE_EXTENT
            ) {
              if (tileIndex >= LIGHT_GLAZE_COMMIT_TILE_SLOT_COUNT) {
                throw new Error("Numero di tile Intense Blending oltre il limite del documento.");
              }
              const tileWidth = Math.min(
                LIGHT_GLAZE_COMMIT_TILE_EXTENT,
                dirtyRight - tileX,
              );
              const tileHeight = Math.min(
                LIGHT_GLAZE_COMMIT_TILE_EXTENT,
                dirtyBottom - tileY,
              );
              const uniformWordOffset = (
                tileIndex * LIGHT_GLAZE_COMMIT_TILE_UNIFORM_STRIDE_BYTES
              ) / Uint32Array.BYTES_PER_ELEMENT;
              tileUniformUpload[uniformWordOffset] = tileX;
              tileUniformUpload[uniformWordOffset + 1] = tileY;

              const tilePass = encoder.beginRenderPass({
                label: `Commit high precision glaze tile ${tileIndex}`,
                colorAttachments: [{
                  view: this.lightGlazeCommitTileView,
                  loadOp: "load",
                  storeOp: "store",
                }],
              });
              tilePass.setPipeline(this.lightGlazeCommitTilePipeline);
              tilePass.setBindGroup(
                0,
                this.lightGlazeCommitTileBindGroup,
                [tileIndex * LIGHT_GLAZE_COMMIT_TILE_UNIFORM_STRIDE_BYTES],
              );
              tilePass.setViewport(0, 0, tileWidth, tileHeight, 0, 1);
              tilePass.setScissorRect(0, 0, tileWidth, tileHeight);
              tilePass.draw(3, 1, 0, 0);
              tilePass.end();
              encoder.copyTextureToTexture(
                { texture: this.lightGlazeCommitTileTexture },
                {
                  texture: this.layerTexture,
                  origin: { x: tileX, y: tileY, z: 0 },
                },
                { width: tileWidth, height: tileHeight, depthOrArrayLayers: 1 },
              );
              tileIndex += 1;
            }
          }
          this.device.queue.writeBuffer(
            this.lightGlazeCommitTileUniformBuffer,
            0,
            tileUniformUpload,
          );
        } else {
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
            authoritativeDirtyRect.x,
            authoritativeDirtyRect.y,
            authoritativeDirtyRect.width,
            authoritativeDirtyRect.height,
          );
          compositePass.draw(3, 1, 0, 0);
          compositePass.end();
        }
        brushEncodingMs += performance.now() - compositeStart;
        lightGlazeCommits = 1;
        lightGlazeCompositePixels = authoritativeDirtyRect.width
          * authoritativeDirtyRect.height;
      }
      this.noteLayerMutation(authoritativeDirtyRect, false);

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
        const tileBlendOwnsPyramid = displaySelectedMipLevel > 0
          && this.usesLayerBlendTilePresentation();
        const canonicalLayerDirtyRect = clearLayer
          ? { x: 0, y: 0, width: LAYER_SIZE, height: LAYER_SIZE }
          : authoritativeDirtyRect;
        if (rasterStrokeActive && !tileBlendOwnsPyramid) {
          this.paintDisplayMipValidThroughLevel = 0;
          const rasterPyramidStart = performance.now();
          const rasterPyramid = encodeRasterStrokeDisplayPyramid(this, 
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
        } else if (!tileBlendOwnsPyramid) {
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
            ? layerDirtyRectToPresentationRect(this, presentationLayerDirtyRect, displaySelectedMipLevel)
            : null;
        if (presentationDirtyRect) {
          if (!tileBlendOwnsPyramid) {
            encodeMergedDisplayPyramids(this, encoder, displaySelectedMipLevel);
          }
          this.writeDisplayUniforms(displaySelectedMipLevel);
          if (rasterStrokeActive) {
            this.rasterStrokeRenderer!.updateDisplayParameters(
              "permanent",
              this.rasterStrokeStyle,
              this.rasterBevelStyle,
              this.rasterColorOverlayStyle,
            );
          }
          const lod0FullRebuildCpuEncodingStart = requiresFullRebuild
            && displaySelectedMipLevel === 0 ? performance.now() : 0;
          if (this.usesOrderedScenePresentation()) {
            const activePresentation: MixedSceneActivePresentation = rasterStrokeActive
              ? { kind: "raster-stroke", sourceMode: "permanent" }
              : { kind: "base" };
            const blendLabel = requiresFullRebuild
              ? "Rebuild segmented canonical cache after Light Glaze commit"
              : "Canonicalize segmented Light Glaze cache after commit";
            if (this.usesLayerBlendTilePresentation()) {
              encodeLayerBlendTilePresentation(
                this,
                encoder,
                presentationDirtyRect,
                presentationLayerDirtyRect,
                requiresFullRebuild,
                activePresentation,
                blendLabel,
              );
            } else {
              encodeMixedSceneSegmentedPresentation(
                this,
                encoder,
                presentationDirtyRect,
                requiresFullRebuild,
                activePresentation,
                blendLabel,
              );
            }
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

    let historyGpuSlice: GpuHistorySlice | null = null;
    const submitStart = performance.now();
    try {
      if (!replayBatch) {
        historyGpuSlice = this.encodePaintHistoryCapture(
          encoder,
          stamps,
          "Paint glaze",
        );
      }
      this.device.queue.submit([encoder.finish()]);
    } catch (error) {
      if (historyGpuSlice) this.historyGpuStorage.release(historyGpuSlice);
      retiredStabilizationSnapshot?.destroy();
      this.stabilizationSnapshotRect = null;
      throw error;
    }
    commandSubmitMs = performance.now() - submitStart;
    if (present) {
      this.stabilizationSnapshotRect = stabilizationFrame
        ? { ...stabilizationFrame.dirtyRect }
        : null;
    }
    retiredStabilizationSnapshot?.destroy();
    if (lightGlazeClearEncoded) {
      session.needsClear = false;
      this.lightGlazeStaleRect = null;
    }
    if (present && presentationCacheWasUpdated) {
      this.presentationCacheNeedsFullRebuild = false;
    }
    if (session.commitRequested) {
      if (session.hasContent && authoritativeDirtyRect) {
        this.lightGlazeStaleRect = { ...authoritativeDirtyRect };
      }
      this.lightGlazeSession = null;
      if (
        usesStrokeGlazeRenderer(this.settings)
        && !lightGlazeResourcesMatch(this, 
          lightGlazeStorageModeFor(this.settings.blendMode),
        )
      ) {
        requestLightGlazeResources(this, this.settings.blendMode);
      }
      // endStroke() runs before the deferred glaze commit reaches this submit.
      // Re-fold clipped children now that the parent's authoritative pixels are
      // actually in the layer, once per completed action and never per stamp.
    }
    // Restore the current UI settings after the ordered Light Glaze submit so
    // a following Normal/Additive frame sees the ordinary uniform contents.
    this.writeBrushUniforms(this.settings);
    if (isTexturizedGrainActive(this.settings)) {
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
      historyGpuSlice,
    };
  }

  submitBlendImmediate(
    batches: readonly DryBlendHistoryGeometry[],
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
    if (replayBatch && replayBatch.actionId !== historyActionId) {
      throw new Error("Azione Blend GPU non coerente con il batch storico.");
    }
    const expectedShapeIdentity = settings.shape === "shape" ? this.shapeMaskIdentity : null;
    if (replayBatch && replayBatch.shapeMaskIdentity !== expectedShapeIdentity) {
      throw new Error("La Shape Blend usata dalla cronologia non corrisponde alla risorsa corrente.");
    }
    const expectedGrainIdentity = isTexturizedGrainActive(settings)
      ? this.grainTextureIdentity
      : null;
    if (replayBatch && replayBatch.grainTextureIdentity !== expectedGrainIdentity) {
      throw new Error("Il Grain Blend usato dalla cronologia non corrisponde alla risorsa corrente.");
    }

    const historyBytes = renderer.historyUniformBytes(batches);
    let historyGpuSlice: GpuHistorySlice | null = null;
    if (replayBatch) {
      if (replayBatch.gpuSlice.logicalBytes !== historyBytes) {
        throw new Error(
          `Payload GPU Blend ${replayBatch.gpuSlice.logicalBytes} B, attesi ${historyBytes} B.`,
        );
      }
    } else if (historyActionId !== 0 && historyBytes > 0) {
      historyGpuSlice = this.historyGpuStorage.allocate(
        historyBytes,
        `Blend dry · azione ${historyActionId} · ${batches.length} batch`,
      );
    }

    // Il renderer accetta al massimo maximumBatchesPerSubmit batch per submit;
    // il drenaggio per frame può superarlo, quindi qui si spezza in chunk.
    let blendCpuMs = 0;
    let blendDirtyRect: DirtyRect | null = null;
    let historyByteOffset = 0;
    try {
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
          const chunkBytes = renderer.historyUniformBytes(chunk);
          const sourceSlice = replayBatch?.gpuSlice ?? historyGpuSlice;
          const historyTransfer = sourceSlice && chunkBytes > 0
            ? replayBatch
              ? {
                replay: {
                  buffer: sourceSlice.buffer,
                  offsetBytes: sourceSlice.offsetBytes + historyByteOffset,
                  sizeBytes: chunkBytes,
                },
              }
              : {
                capture: {
                  buffer: sourceSlice.buffer,
                  offsetBytes: sourceSlice.offsetBytes + historyByteOffset,
                  sizeBytes: chunkBytes,
                },
              }
            : null;
          const chunkTiming = renderer.submit(
            chunk,
            settings,
            historyActionId,
            clearLayer && start === 0,
            historyTransfer,
          );
          historyByteOffset += chunkBytes;
          blendCpuMs += chunkTiming.cpuMs;
          blendDirtyRect = mergeDirtyRects(blendDirtyRect, chunkTiming.dirtyRect);
        }
      }
      if (historyByteOffset !== historyBytes) {
        throw new Error("Offset del payload storico Blend non coerente.");
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
        historyGpuSlice,
      };
    } catch (error) {
      if (historyGpuSlice) this.historyGpuStorage.release(historyGpuSlice);
      throw error;
    }
  }

  submitImmediate(
    stamps: readonly Stamp[],
    clearLayer: boolean,
    settings: BrushSettings = this.settings,
    present = true,
    replayBatch: PaintHistoryRenderBatch | null = null,
    externalDirtyRect: DirtyRect | null = null,
    externalLayerCleared = false,
  ): SubmitTiming {
    const stampCount = resolvePaintHistoryStampCount(stamps, replayBatch);
    if (usesStrokeGlazeRenderer(settings)) {
      if (this.lightGlazeSession) {
        return this.submitLightGlazeImmediate(stamps, clearLayer, settings, present, replayBatch);
      }
      if (stampCount > 0) {
        const actionIds = replayBatch
          ? [replayBatch.actionId]
          : [...new Set(stamps.map((stamp) => stamp.historyActionId))];
        throw new Error(
          `Stamp Light Glaze senza sessione per-stroke: mode=${settings.blendMode}; `
          + `batch=${actionIds.join(",")}; active=${this.activeStroke?.historyActionId ?? "none"}.`,
        );
      }
    }
    const grainActive = isTexturizedGrainActive(settings);
    if (grainActive) {
      this.writeGrainUniforms(settings);
    }
    const cpuStart = performance.now();
    if (present) {
      ensurePresentationCacheTexture(this);
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

    const expectedShapeIdentity = settings.shape === "shape" ? this.shapeMaskIdentity : null;
    if (replayBatch && replayBatch.shapeMaskIdentity !== expectedShapeIdentity) {
      throw new Error("La Shape usata dalla cronologia non corrisponde alla risorsa corrente.");
    }
    const expectedGrainIdentity = isTexturizedGrainActive(settings)
      ? this.grainTextureIdentity
      : null;
    if (replayBatch && replayBatch.grainTextureIdentity !== expectedGrainIdentity) {
      throw new Error("Il Grain usato dalla cronologia non corrisponde alla risorsa corrente.");
    }

    if (clearLayer || stampCount > 0) {
      let dirtyRect: DirtyRect | null = null;
      let shapeOccupancySelection: ShapeOccupancySelection | null = null;
      if (stampCount > 0) {
        if (replayBatch) {
          dirtyRect = replayBatch.dirtyRect;
          shapeOccupancySelection = settings.shape === "shape"
            ? replayBatch.shapeOccupancySelection
            : null;
          this.encodePaintHistoryReplay(encoder, replayBatch);
        } else {
          const packingStart = performance.now();
          dirtyRect = packStamps(this, stamps, settings);
          stampPackingMs = performance.now() - packingStart;
          const uploadStart = performance.now();
          this.device.queue.writeBuffer(
            this.instanceBuffer,
            0,
            this.instanceUpload,
            0,
            stampCount * STAMP_STRIDE_BYTES,
          );
          if (settings.shape === "shape") {
            shapeOccupancySelection = this.selectShapeOccupancy(this.packedMinimumRadius);
          }
          instanceUploadMs = performance.now() - uploadStart;
        }
        dirtyRect = clipPaintDirtyRectToPixelSelection(this, dirtyRect, replayBatch);
      }
      submittedDirtyRect = dirtyRect;
      submittedShapeOccupancySelection = shapeOccupancySelection;

      const brushEncodingStart = performance.now();
      const brushPass = encoder.beginRenderPass({
        label: `Paint into ${LAYER_SIZE}² layer`,
        colorAttachments: [
          {
            view: this.layerView,
            loadOp: clearLayer ? "clear" : "load",
            storeOp: "store",
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          },
        ],
      });

      if (stampCount > 0 && dirtyRect) {
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
        bindPaintPipelineWithPixelSelection(this, brushPass, pipeline, replayBatch);
        brushPass.setBindGroup(
          0,
          grainActive
            ? useShapeOccupancy
              ? this.grainBrushOccupancyBindGroups[
                grainCoordinateMode(settings)
              ][settings.grainFiltering][shapeOccupancyMip!]
              : this.grainBrushBindGroups[
                grainCoordinateMode(settings)
              ][settings.grainFiltering]
            : useShapeOccupancy
              ? this.brushOccupancyBindGroups[shapeOccupancyMip!]
              : this.brushBindGroup,
        );
        brushPass.setScissorRect(dirtyRect.x, dirtyRect.y, dirtyRect.width, dirtyRect.height);
        if (isShape && shapeOccupancySelection && !replayBatch) {
          this.recordShapeSampling(shapeOccupancySelection);
        }
        brushPass.draw(STAMP_VERTICES_PER_COPY, stampCount * settings.count, 0, 0);
        if (grainActive) {
          grainBatches = 1;
          grainBaseStamps = stampCount;
          grainPhysicalCopies = stampCount * settings.count;
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

    if (!present && (clearLayer || stampCount > 0 || externalDirtyRect || externalLayerCleared)) {
      // Una ricostruzione Undo/Redo omette i display intermedi. La cache non
      // deve quindi essere riutilizzata finché l'ultimo batch non la ricrea.
      this.presentationCacheNeedsFullRebuild = true;
      this.paintDisplayMipValidThroughLevel = 0;
      deferRasterStrokeMutation(this, layerCleared);
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
      const vectorTextDisplayPipeline = this.vectorTextDisplayPipeline;
      const useVectorTextDisplay = Boolean(
        (this.vectorTextBelowTexture || this.vectorTextAboveTexture)
        && !rasterStrokeActive
        && !thicknessTailFrame
        && this.vectorTextDisplayBindGroup
        && vectorTextDisplayPipeline,
      );
      const requestFinalRasterStackMip = displaySelectedMipLevel > 0
        && !rasterStrokeActive
        && !thicknessTailFrame
        && !useVectorTextDisplay
        && !this.usesOrderedScenePresentation();
      const transientMutationRect = mergeDirtyRects(
        this.thicknessTailPresentedRect,
        thicknessTailFrame?.dirtyRect ?? null,
      );
      const rasterStrokeMutationRect = mergeDirtyRects(
        submittedDirtyRect,
        transientMutationRect,
      );
      const rasterStrokeVirtualBounds = thicknessTailFrame
        ? mergeDirtyRects(this.layerContentBounds, thicknessTailFrame.dirtyRect)
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
      const tileBlendOwnsPyramid = displaySelectedMipLevel > 0
        && this.usesLayerBlendTilePresentation();

      const baseDirtyRect = layerCleared
        ? { x: 0, y: 0, width: LAYER_SIZE, height: LAYER_SIZE }
        : submittedDirtyRect;
      if (layerCleared || (rasterStrokeActive && submittedDirtyRect)) {
        this.paintDisplayMipValidThroughLevel = 0;
      }
      if (!rasterStrokeActive && !tileBlendOwnsPyramid) {
        const pyramidTiming = this.encodePaintDisplayPyramid(
          encoder,
          baseDirtyRect,
          displaySelectedMipLevel,
          requestFinalRasterStackMip ? "final-raster-stack" : "active-only",
        );
        paintDisplayPyramidMaintenanceFrames = pyramidTiming.maintenanceFrames;
        paintDisplayPyramidFullLevelBuilds = pyramidTiming.fullLevelBuilds;
        paintDisplayPyramidDirtyLevelUpdates = pyramidTiming.dirtyLevelUpdates;
        paintDisplayPyramidPasses = pyramidTiming.passes;
        paintDisplayPyramidBaseDirtyPixels = pyramidTiming.baseDirtyPixels;
        paintDisplayPyramidUpdatedPixels = pyramidTiming.updatedPixels;
        paintDisplayPyramidEncodingMs = pyramidTiming.encodingMs;
      } else if (!tileBlendOwnsPyramid) {
        const rasterPyramidStart = performance.now();
        const rasterPyramid = encodeRasterStrokeDisplayPyramid(this, 
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
      const useFinalRasterStackMip = !rasterStrokeActive
        && this.paintDisplayPyramidContent === "final-raster-stack";

      const canvasPixels = this.canvas.width * this.canvas.height;
      legacyDisplayShaderPixels = canvasPixels;
      presentationCopiedPixels = canvasPixels;

      const requiresFullRebuild = this.presentationCacheNeedsFullRebuild || layerCleared;
      const presentationLayerDirtyRect = rasterStrokeActive
        ? rasterStrokeUpdate.dirtyRect
        : mergeDirtyRects(
          submittedDirtyRect,
          mergeDirtyRects(
            this.semanticPresentationDirtyRect,
            mergeDirtyRects(
              this.thicknessTailPresentedRect,
              thicknessTailFrame?.dirtyRect ?? null,
            ),
          ),
        );
      const presentationDirtyRect = requiresFullRebuild
        ? { x: 0, y: 0, width: this.canvas.width, height: this.canvas.height }
        : presentationLayerDirtyRect
          ? layerDirtyRectToPresentationRect(this, 
            presentationLayerDirtyRect,
            displaySelectedMipLevel,
          )
          : null;

      if (presentationDirtyRect) {
        if (!useFinalRasterStackMip && !tileBlendOwnsPyramid) {
          encodeMergedDisplayPyramids(this, encoder, displaySelectedMipLevel);
        }
        this.writeDisplayUniforms(displaySelectedMipLevel);
        if (rasterStrokeActive) {
          this.rasterStrokeRenderer!.updateDisplayParameters(
            thicknessTailFrame ? "thickness-tail" : "permanent",
            this.rasterStrokeStyle,
            this.rasterBevelStyle,
            this.rasterColorOverlayStyle,
          );
        }
        const lod0FullRebuildCpuEncodingStart = requiresFullRebuild
          && displaySelectedMipLevel === 0 ? performance.now() : 0;
        if (this.usesOrderedScenePresentation()) {
          const activePresentation: MixedSceneActivePresentation = rasterStrokeActive
            ? {
              kind: "raster-stroke",
              sourceMode: thicknessTailFrame ? "thickness-tail" : "permanent",
            }
            : thicknessTailFrame
              ? { kind: "thickness-tail" }
              : { kind: "base" };
          const blendLabel = requiresFullRebuild
            ? "Rebuild segmented persistent presentation cache"
            : "Update segmented persistent presentation cache dirty rect";
          if (this.usesLayerBlendTilePresentation()) {
            encodeLayerBlendTilePresentation(
              this,
              encoder,
              presentationDirtyRect,
              presentationLayerDirtyRect,
              requiresFullRebuild,
              activePresentation,
              blendLabel,
            );
          } else {
            encodeMixedSceneSegmentedPresentation(
              this,
              encoder,
              presentationDirtyRect,
              requiresFullRebuild,
              activePresentation,
              blendLabel,
            );
          }
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
                  : useFinalRasterStackMip
                    ? this.finalRasterStackDisplayPipeline
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

    let historyGpuSlice: GpuHistorySlice | null = null;
    const submitStart = performance.now();
    try {
      if (!replayBatch) {
        historyGpuSlice = this.encodePaintHistoryCapture(
          encoder,
          stamps,
          "Paint",
        );
      }
      this.device.queue.submit([encoder.finish()]);
    } catch (error) {
      if (historyGpuSlice) this.historyGpuStorage.release(historyGpuSlice);
      throw error;
    }
    commandSubmitMs = performance.now() - submitStart;
    if (present && presentationCacheWasUpdated) {
      this.presentationCacheNeedsFullRebuild = false;
    }
    if (present) {
      this.semanticPresentationDirtyRect = null;
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
      historyGpuSlice,
    };
  }

  private packThicknessTailStamps(
    stamps: readonly Stamp[],
    settings: BrushSettings,
  ): PackedStampUpload {
    return packStampsIntoUpload(
      stamps,
      settings,
      this.thicknessTailInstanceUploadF32,
      this.thicknessTailInstanceUploadU32,
    );
  }

  recordRenderedFrame(timestamp: number): void {
    this.renderTimestamps.push(timestamp);
    const cutoff = timestamp - 1000;
    while (this.renderTimestamps.length > 0 && this.renderTimestamps[0] < cutoff) {
      this.renderTimestamps.shift();
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

  publishStats(): void {
    try {
      this.callbacks.onStats?.(getStats(this));
    } catch (error) {
      console.error("Observer statistiche ignorato per preservare la transazione:", error);
    }
  }

  publishHistoryState(): void {
    try {
      this.callbacks.onHistoryChange?.(this.getHistoryState());
    } catch (error) {
      console.error("Observer cronologia ignorato per preservare la transazione:", error);
    }
    if (this.initialized && !this.historyStateInconsistent) {
      scheduleHistoryMaintenance(this);
    }
  }

  publishActiveLayerChange(): void {
    try {
      this.callbacks.onActiveLayerChange?.(this.layerStack.activeIndex);
    } catch (error) {
      console.error("Observer livello attivo ignorato per preservare la transazione:", error);
    }
  }

  publishStatus(message: string, kind: "working" | "ok" | "error"): void {
    try {
      this.callbacks.onStatus?.(message, kind);
    } catch (error) {
      console.error("Observer stato ignorato per preservare la transazione:", error);
    }
  }

}
