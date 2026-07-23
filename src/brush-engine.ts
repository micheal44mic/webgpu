import { clamp, hexToHsl } from "./color";
import { decodeGrayscalePng8 } from "./png-mask";
import {
  createDryBlendPlanner,
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
  lightGlazeCompositeMipShader,
  lightGlazeCompositeShader,
  lightGlazeDisplayShader,
  paintMipDownsampleShader,
  texturizedGrainShader,
  thicknessTailDisplayShader,
} from "./shaders";
import {
  THICKNESS_DYNAMICS_STRATEGY,
  THICKNESS_TAPER_WINDOW_MS,
  endThicknessRadius,
  startThicknessFactor,
  thicknessDynamicsIsNeutral,
  thicknessDynamicsNeedsTailHoldback,
  type ThicknessDynamicsStrategy,
} from "./thickness-dynamics";

export type BlendMode = "normal" | "additive" | "light-glaze" | "m1-glaze";
export type BrushTool = "paint" | "blend";
export type LayerFormat = "rgba8unorm" | "rgba16float";
export type BrushShape = "circle" | "shape";
export type GrainMode = "off" | "texturized" | "moving";
export type GrainFiltering = "no" | "classic" | "improved";
export type GrainBlendMode = "multiply";
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
  | "m1-r8-quantized-max-coverage-rgba-compat-single-commit";
export type LightGlazeAdaptivePreviewStrategy = "disabled-semantic-mismatch";
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

export interface EngineStats {
  fps: number;
  lastCpuFrameMs: number;
  totalBaseStamps: number;
  avoidedLogicalDraws: number;
  layerMemoryMiB: number;
  gpuLabel: string;
  layerFormat: LayerFormat;
}

export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  busy: boolean;
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
}

interface PaintHistoryRenderBatch {
  kind: "paint";
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
  "m1-r8-quantized-max-coverage-rgba-compat-single-commit" as const;
const LIGHT_GLAZE_ADAPTIVE_PREVIEW_STRATEGY = "disabled-semantic-mismatch" as const;
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
const DISPLAY_UNIFORM_BYTES = 48;
const LIGHT_GLAZE_UNIFORM_BYTES = 32;
const THICKNESS_TAIL_UNIFORM_BYTES = 32;

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

function lightGlazeAdditionalMemoryMiB(format: LayerFormat): number {
  const authoritativeMipMiB = format === "rgba16float" ? 128 : 64;
  return authoritativeMipMiB + paintDisplayPyramidAdditionalMemoryMiB(format);
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

  private adapter!: GPUAdapter;
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private canvasFormat!: GPUTextureFormat;

  private layerFormat: LayerFormat = "rgba8unorm";
  private layerTexture!: GPUTexture;
  private layerView!: GPUTextureView;
  private layerSamplingView!: GPUTextureView;
  private blendRenderer: DryBlendRenderer | null = null;
  private paintMipViews: GPUTextureView[] = [];
  private paintMipDownsampleBindGroups: GPUBindGroup[] = [];
  private paintDisplayMipValidThroughLevel = 0;
  private paintDisplaySelectedMipLevel = 0;
  private presentationCacheTexture: GPUTexture | null = null;
  private presentationCacheView: GPUTextureView | null = null;
  private presentationCacheWidth = 0;
  private presentationCacheHeight = 0;
  private presentationCacheNeedsFullRebuild = true;
  private lightGlazeTexture: GPUTexture | null = null;
  private lightGlazeView: GPUTextureView | null = null;
  private lightGlazeSamplingView: GPUTextureView | null = null;
  private lightGlazeMipViews: GPUTextureView[] = [];
  private lightGlazeMipDownsampleBindGroups: GPUBindGroup[] = [];
  private lightGlazeCompositeMipBindGroup: GPUBindGroup | null = null;
  private lightGlazeDisplayBindGroup: GPUBindGroup | null = null;
  private lightGlazeCompositeBindGroup: GPUBindGroup | null = null;
  private lightGlazeSession: LightGlazeSession | null = null;
  private lightGlazeStorageAllocated = false;
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
  private thicknessTailDisplayUniformBuffer!: GPUBuffer;
  private lightGlazeUniformBuffer!: GPUBuffer;
  private instanceBuffer!: GPUBuffer;
  private thicknessTailInstanceBuffer!: GPUBuffer;
  private shapeOccupancyUniformBuffers: GPUBuffer[] = [];
  private sampler!: GPUSampler;
  private shapeMaskTexture!: GPUTexture;
  private shapeMaskView!: GPUTextureView;
  private shapeMaskSampler!: GPUSampler;
  private grainTexture!: GPUTexture;
  private grainTextureView!: GPUTextureView;
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
  private thicknessTailDisplayBindGroupLayout!: GPUBindGroupLayout;
  private lightGlazeDisplayBindGroupLayout!: GPUBindGroupLayout;
  private lightGlazeCompositeMipBindGroupLayout!: GPUBindGroupLayout;
  private lightGlazeCompositeBindGroupLayout!: GPUBindGroupLayout;
  private paintMipDownsampleBindGroupLayout!: GPUBindGroupLayout;
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

  private brushShaderModule!: GPUShaderModule;
  private texturizedGrainShaderModule!: GPUShaderModule;
  private displayShaderModule!: GPUShaderModule;
  private thicknessTailDisplayShaderModule!: GPUShaderModule;
  private lightGlazeDisplayShaderModule!: GPUShaderModule;
  private lightGlazeCompositeMipShaderModule!: GPUShaderModule;
  private lightGlazeCompositeShaderModule!: GPUShaderModule;
  private paintMipDownsampleShaderModule!: GPUShaderModule;
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
  private displayPipeline!: GPURenderPipeline;
  private thicknessTailDisplayPipeline!: GPURenderPipeline;
  private lightGlazeDisplayPipeline!: GPURenderPipeline;
  private lightGlazeCompositeMipPipeline!: GPURenderPipeline;
  private lightGlazeCompositePipeline!: GPURenderPipeline;
  private paintMipDownsamplePipeline!: GPURenderPipeline;

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
  private layerHasContent = false;

  private frameRequest: number | null = null;
  private clearRequested = true;
  private displayDirty = true;
  private initialized = false;

  private viewCenterX = LAYER_SIZE * 0.5;
  private viewCenterY = LAYER_SIZE * 0.5;
  private zoom = 1;
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
  ) {
    this.canvas = canvas;
    this.callbacks = callbacks;
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

    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
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
    this.flushPendingWorkBeforeSettingsChange();
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
      this.invalidateAdaptivePreview();
      this.writeBrushUniforms();
      if (this.isTexturizedGrainActive(this.settings)) {
        this.writeGrainUniforms(this.settings);
      }
      this.displayDirty = true;
      this.requestRender();
    }
  }

  async setLayerFormat(format: LayerFormat): Promise<boolean> {
    if (format === this.layerFormat) {
      return true;
    }
    if (!this.initialized || this.historyBusy || this.activeStroke) {
      return false;
    }

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
      this.layerHasContent = false;
      this.requestRender();
      this.callbacks.onStatus?.(`Layer ${format} pronto. Il contenuto è stato azzerato.`, "ok");
      this.publishStats();
      return true;
    } catch (error) {
      // recreateLayerResources assegna e distrugge la texture precedente solo
      // dopo che tutte le pipeline candidate sono state validate. In caso di
      // errore, il vecchio layer e la sua cronologia sono quindi ancora validi.
      this.layerFormat = previousFormat;
      const message = error instanceof Error ? error.message : String(error);
      this.callbacks.onStatus?.(`Formato ${format} non disponibile: ${message}`, "error");
      throw error;
    } finally {
      this.historyBusy = false;
      this.publishHistoryState();
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
      this.requestRender();
    }
  }

  fitView(): void {
    this.invalidateAdaptivePreview();
    const width = Math.max(1, this.canvas.width);
    const height = Math.max(1, this.canvas.height);
    this.viewCenterX = LAYER_SIZE * 0.5;
    this.viewCenterY = LAYER_SIZE * 0.5;
    this.zoom = Math.max(0.01, Math.min(width / LAYER_SIZE, height / LAYER_SIZE) * 0.94);
    this.hasFittedView = true;
    this.displayDirty = true;
    this.presentationCacheNeedsFullRebuild = true;
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
    this.viewCenterX = anchorBefore.x - (screen.x - this.canvas.width * 0.5) / this.zoom;
    this.viewCenterY = anchorBefore.y - (screen.y - this.canvas.height * 0.5) / this.zoom;
    this.displayDirty = true;
    this.presentationCacheNeedsFullRebuild = true;
    this.requestRender();
  }

  panByClientDelta(deltaClientX: number, deltaClientY: number): void {
    this.invalidateAdaptivePreview();
    const rectangle = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / Math.max(1, rectangle.width);
    const scaleY = this.canvas.height / Math.max(1, rectangle.height);
    this.viewCenterX -= (deltaClientX * scaleX) / this.zoom;
    this.viewCenterY -= (deltaClientY * scaleY) / this.zoom;
    this.displayDirty = true;
    this.presentationCacheNeedsFullRebuild = true;
    this.requestRender();
  }

  beginStroke(sample: PointerSample): void {
    this.beginStrokeAtLayer(this.toLayerPoint(sample));
  }

  beginStrokeAtLayer(point: LayerPoint): void {
    if (this.historyBusy) {
      return;
    }
    const normalizedPoint: LayerPoint = {
      ...point,
      timeMs: Number.isFinite(point.timeMs) ? point.timeMs : performance.now(),
    };
    this.flushPendingWorkBeforeSettingsChange();
    this.flushClosingLightGlazeSessionBeforeNewStroke();
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
    return true;
  }

  async clear(): Promise<boolean> {
    if (!this.initialized || this.activeStroke || this.historyBusy) {
      return false;
    }

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
      if (this.hasVisibleHistoryContent()) {
        this.truncateRedoHistory();
        this.historyActions.push({ id: this.nextHistoryActionId++, kind: "clear" });
        this.historyCursor = this.historyActions.length;
        this.compactDiscardedHistory();
        if (this.activeStrokeProfile) {
          this.activeStrokeProfile.historyCommittedActions += 1;
        }
      } else {
        this.resetHistoryState();
      }

      this.callbacks.onStatus?.("Layer pulito.", "ok");
      return true;
    } finally {
      this.historyBusy = false;
      this.publishHistoryState();
    }
  }

  resetDocument(): boolean {
    if (this.historyBusy) {
      return false;
    }
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
    this.requestRender();
    this.publishHistoryState();
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
    if (this.historyBusy || this.activeStroke) {
      throw new Error("Concludi prima il tratto o l'operazione Undo/Redo.");
    }
    if (this.settings.tool === "blend") {
      throw new Error("Il benchmark GPU sintetico misura Paint: seleziona Pennello Paint.");
    }
    if (this.lightGlazeSession) {
      await this.waitForIdle();
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
    this.historyActions.push({ id: historyActionId, kind: "stroke" });
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

  getStats(): EngineStats {
    const now = performance.now();
    this.renderTimestamps = this.renderTimestamps.filter((timestamp) => now - timestamp <= 1000);
    return {
      fps: this.renderTimestamps.length,
      lastCpuFrameMs: this.lastCpuFrameMs,
      totalBaseStamps: this.totalBaseStamps,
      avoidedLogicalDraws: this.avoidedLogicalDraws,
      layerMemoryMiB: this.layerFormat === "rgba16float" ? 128 : 64,
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

  getHistoryState(): HistoryState {
    return {
      canUndo: !this.historyBusy && this.historyCursor > 0,
      canRedo: !this.historyBusy && this.historyCursor < this.historyActions.length,
      busy: this.historyBusy,
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

  async waitForIdle(): Promise<void> {
    if (!this.initialized) {
      throw new Error("Il motore non è ancora inizializzato.");
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
      lightGlazeAdditionalMemoryMiB: this.lightGlazeStorageAllocated
        ? lightGlazeAdditionalMemoryMiB(this.layerFormat)
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
    gpuLabel: string;
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
    lightGlazeStrategy: LightGlazeStrategy;
    lightGlazeAdaptivePreviewStrategy: typeof LIGHT_GLAZE_ADAPTIVE_PREVIEW_STRATEGY;
    lightGlazeStorageAllocated: boolean;
    lightGlazeAdditionalMemoryMiB: number;
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
    return {
      canvasWidth: this.canvas.width,
      canvasHeight: this.canvas.height,
      layerSize: LAYER_SIZE,
      layerFormat: this.layerFormat,
      layerMemoryMiB: this.layerFormat === "rgba16float" ? 128 : 64,
      gpuLabel: this.gpuLabel,
      timestampQueriesSupported: this.device?.features.has("timestamp-query") ?? false,
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
      lightGlazeStrategy: lightGlazeStrategyForBlendMode(this.settings.blendMode),
      lightGlazeAdaptivePreviewStrategy: LIGHT_GLAZE_ADAPTIVE_PREVIEW_STRATEGY,
      lightGlazeStorageAllocated: this.lightGlazeStorageAllocated,
      lightGlazeAdditionalMemoryMiB: this.lightGlazeStorageAllocated
        ? lightGlazeAdditionalMemoryMiB(this.layerFormat)
        : 0,
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
    const grainResources = await this.createGrainTextureResources();
    this.grainTexture = grainResources.texture;
    this.grainTextureView = this.grainTexture.createView({
      label: "Cotton Fleece M1 native grain full mip view",
    });
    this.grainTextureIdentity = grainResources.identity;
    this.grainStartupDecodeMs = grainResources.decodeMs;
    this.grainStartupMipBuildMs = grainResources.mipBuildMs;
    this.grainStartupUploadMs = grainResources.uploadMs;
    const shapeMaskResources = await this.createShapeMaskResources();
    this.shapeMaskTexture = shapeMaskResources.texture;
    this.shapeMaskView = this.shapeMaskTexture.createView({ label: "Shape 2K mask view" });
    this.shapeMaskDecodeStrategy = shapeMaskResources.decodeStrategy;
    this.shapeMaskIdentity = shapeMaskResources.identity;
    this.shapeOccupancyActiveCells = shapeMaskResources.occupancyActiveCells;
    this.shapeOccupancyCoverageRatios = shapeMaskResources.occupancyCoverageRatios;
    this.adaptivePreviewShapeSprite = shapeMaskResources.previewSprite;
    this.shapeOccupancyUniformBuffers = Array.from(
      { length: SHAPE_OCCUPANCY_MAP_COUNT },
      (_, mipLevel) => {
        const buffer = this.device.createBuffer({
          label: `Shape conservative occupancy bitmask mip ${mipLevel}`,
          size: SHAPE_OCCUPANCY_MAP_BYTES,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        const wordOffset = mipLevel * SHAPE_OCCUPANCY_WORDS_PER_MAP;
        this.device.queue.writeBuffer(
          buffer,
          0,
          shapeMaskResources.occupancyWords.subarray(
            wordOffset,
            wordOffset + SHAPE_OCCUPANCY_WORDS_PER_MAP,
          ),
        );
        return buffer;
      },
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
      label: "Display bind group layout",
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
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float", viewDimension: "2d" },
        },
      ],
    });

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

    this.brushShaderModule = this.device.createShaderModule({ label: "Brush WGSL", code: brushShader });
    this.texturizedGrainShaderModule = this.device.createShaderModule({
      label: "Texturized grain fragment WGSL",
      code: texturizedGrainShader,
    });
    this.displayShaderModule = this.device.createShaderModule({ label: "Display WGSL", code: displayShader });
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
    await Promise.all([
      this.assertShaderCompiled(this.brushShaderModule, "brush"),
      this.assertShaderCompiled(this.texturizedGrainShaderModule, "Texturized grain fragment"),
      this.assertShaderCompiled(this.displayShaderModule, "display"),
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

  private async recreateLayerResources(format: LayerFormat): Promise<void> {
    const oldTexture = this.layerTexture;
    const oldBlendRenderer = this.blendRenderer;

    const texture = this.device.createTexture({
      label: `4096² paint layer ${format}`,
      size: { width: LAYER_SIZE, height: LAYER_SIZE, depthOrArrayLayers: 1 },
      mipLevelCount: PAINT_DISPLAY_MIP_LEVEL_COUNT,
      format,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.COPY_DST,
    });
    // Mip 0 remains the only authoritative brush attachment. The remaining
    // subresources are derived presentation data and are never blended into.
    const view = texture.createView({
      label: `Paint layer authoritative mip 0 ${format}`,
      baseMipLevel: 0,
      mipLevelCount: 1,
    });
    const samplingView = texture.createView({
      label: `Paint layer display mip chain ${format}`,
      baseMipLevel: 0,
      mipLevelCount: PAINT_DISPLAY_MIP_LEVEL_COUNT,
    });
    const mipViews = Array.from(
      { length: PAINT_DISPLAY_MIP_LEVEL_COUNT },
      (_, mipLevel) => texture.createView({
        label: `Paint layer mip ${mipLevel} ${format}`,
        baseMipLevel: mipLevel,
        mipLevelCount: 1,
      }),
    );

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
    const lightGlazeCompositeMipPipelineLayout = this.device.createPipelineLayout({
      label: `Light Glaze composited mip 1 pipeline layout ${format}`,
      bindGroupLayouts: [this.lightGlazeCompositeMipBindGroupLayout],
    });
    const lightGlazeCompositePipelineLayout = this.device.createPipelineLayout({
      label: `Light Glaze final composite pipeline layout ${format}`,
      bindGroupLayouts: [this.lightGlazeCompositeBindGroupLayout],
    });

    this.device.pushErrorScope("validation");
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
            format,
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
      `Brush M1 Glaze circle MAX coverage ${format}`,
      brushPipelineLayout,
      this.brushShaderModule,
      "vertexMain",
      "coverageFragmentMain",
    );
    const m1GlazeShapePipeline = createM1GlazePipeline(
      `Brush M1 Glaze Shape MAX coverage ${format}`,
      brushPipelineLayout,
      this.brushShaderModule,
      "shapeVertexMain",
      "shapeCoverageFragmentMain",
    );
    const m1GlazeShapeOccupancyPipeline = createM1GlazePipeline(
      `Brush M1 Glaze Shape occupancy MAX coverage ${format}`,
      brushOccupancyPipelineLayout,
      this.brushShaderModule,
      "shapeVertexMain",
      "shapeOccupancyCoverageFragmentMain",
    );
    const grainM1GlazePipeline = createM1GlazePipeline(
      `Brush M1 Glaze Texturized circle MAX coverage ${format}`,
      grainBrushPipelineLayout,
      this.texturizedGrainShaderModule,
      "vertexMain",
      "coverageFragmentMain",
    );
    const grainM1GlazeShapePipeline = createM1GlazePipeline(
      `Brush M1 Glaze Texturized Shape MAX coverage ${format}`,
      grainBrushPipelineLayout,
      this.texturizedGrainShaderModule,
      "shapeVertexMain",
      "shapeCoverageFragmentMain",
    );
    const grainM1GlazeShapeOccupancyPipeline = createM1GlazePipeline(
      `Brush M1 Glaze Texturized Shape occupancy MAX coverage ${format}`,
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

    const validationError = await this.device.popErrorScope();
    if (validationError) {
      texture.destroy();
      throw new Error(validationError.message);
    }

    const displayBindGroup = this.device.createBindGroup({
      label: `Display bind group ${format}`,
      layout: this.displayBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.displayUniformBuffer } },
        { binding: 1, resource: samplingView },
        { binding: 2, resource: this.sampler },
      ],
    });
    const paintMipDownsampleBindGroups = mipViews
      .slice(0, PAINT_DISPLAY_MIP_LEVEL_COUNT - 1)
      .map((sourceView, sourceMipLevel) => this.device.createBindGroup({
        label: `Paint display mip ${sourceMipLevel} to ${sourceMipLevel + 1} ${format}`,
        layout: this.paintMipDownsampleBindGroupLayout,
        entries: [{ binding: 0, resource: sourceView }],
      }));

    let blendRenderer: DryBlendRenderer;
    try {
      blendRenderer = await DryBlendRenderer.create({
        device: this.device,
        documentWidth: LAYER_SIZE,
        documentHeight: LAYER_SIZE,
        layerFormat: format,
        layerView: view,
        layerSamplingView: samplingView,
        shapeMaskView: this.shapeMaskView,
        shapeMaskSampler: this.shapeMaskSampler,
        grainTextureView: this.grainTextureView,
        grainSamplers: this.grainSamplers,
      });
    } catch (error) {
      texture.destroy();
      throw error;
    }

    this.destroyLightGlazeResources();
    this.destroyThicknessTailOverlayResources();
    this.layerTexture = texture;
    this.layerView = view;
    this.layerSamplingView = samplingView;
    this.blendRenderer = blendRenderer;
    this.paintMipViews = mipViews;
    this.paintMipDownsampleBindGroups = paintMipDownsampleBindGroups;
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
    this.displayBindGroup = displayBindGroup;
    this.layerFormat = format;
    this.paintDisplayMipValidThroughLevel = 0;
    this.paintDisplaySelectedMipLevel = 0;
    this.presentationCacheNeedsFullRebuild = true;

    oldBlendRenderer?.destroy();
    oldTexture?.destroy();
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
      ],
    });

    const oldTexture = this.thicknessTailTexture;
    this.thicknessTailTexture = texture;
    this.thicknessTailView = view;
    this.thicknessTailDisplayBindGroup = displayBindGroup;
    this.thicknessTailTextureWidth = width;
    this.thicknessTailTextureHeight = height;
    oldTexture?.destroy();
  }

  private destroyThicknessTailOverlayResources(): void {
    this.thicknessTailTexture?.destroy();
    this.thicknessTailTexture = null;
    this.thicknessTailView = null;
    this.thicknessTailDisplayBindGroup = null;
    this.thicknessTailTextureWidth = 0;
    this.thicknessTailTextureHeight = 0;
    this.thicknessTailPresentedRect = null;
  }

  private ensureLightGlazeResources(): void {
    if (
      this.lightGlazeTexture
      && this.lightGlazeView
      && this.lightGlazeSamplingView
      && this.lightGlazeCompositeMipBindGroup
      && this.lightGlazeDisplayBindGroup
      && this.lightGlazeCompositeBindGroup
    ) {
      return;
    }

    const texture = this.device.createTexture({
      label: `Lazy Light Glaze stroke accumulator ${this.layerFormat}`,
      size: { width: LAYER_SIZE, height: LAYER_SIZE, depthOrArrayLayers: 1 },
      mipLevelCount: PAINT_DISPLAY_MIP_LEVEL_COUNT,
      format: this.layerFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const view = texture.createView({
      label: "Light Glaze authoritative stroke mip 0",
      baseMipLevel: 0,
      mipLevelCount: 1,
    });
    const samplingView = texture.createView({
      label: "Light Glaze live display mip chain",
      baseMipLevel: 0,
      mipLevelCount: PAINT_DISPLAY_MIP_LEVEL_COUNT,
    });
    const mipViews = Array.from(
      { length: PAINT_DISPLAY_MIP_LEVEL_COUNT },
      (_, mipLevel) => texture.createView({
        label: `Light Glaze stroke mip ${mipLevel}`,
        baseMipLevel: mipLevel,
        mipLevelCount: 1,
      }),
    );
    const downsampleBindGroups = mipViews
      .slice(0, PAINT_DISPLAY_MIP_LEVEL_COUNT - 1)
      .map((sourceView, sourceMipLevel) => this.device.createBindGroup({
        label: `Light Glaze mip ${sourceMipLevel} to ${sourceMipLevel + 1}`,
        layout: this.paintMipDownsampleBindGroupLayout,
        entries: [{ binding: 0, resource: sourceView }],
      }));
    const compositeMipBindGroup = this.device.createBindGroup({
      label: "Light Glaze permanent + stroke to composited mip 1",
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
        { binding: 2, resource: samplingView },
        { binding: 3, resource: this.sampler },
        { binding: 4, resource: { buffer: this.lightGlazeUniformBuffer } },
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
    this.lightGlazeView = view;
    this.lightGlazeSamplingView = samplingView;
    this.lightGlazeMipViews = mipViews;
    this.lightGlazeMipDownsampleBindGroups = downsampleBindGroups;
    this.lightGlazeCompositeMipBindGroup = compositeMipBindGroup;
    this.lightGlazeDisplayBindGroup = displayBindGroup;
    this.lightGlazeCompositeBindGroup = compositeBindGroup;
    this.lightGlazeStorageAllocated = true;
  }

  private destroyLightGlazeResources(): void {
    this.lightGlazeSession = null;
    this.lightGlazeTexture?.destroy();
    this.lightGlazeTexture = null;
    this.lightGlazeView = null;
    this.lightGlazeSamplingView = null;
    this.lightGlazeMipViews = [];
    this.lightGlazeMipDownsampleBindGroups = [];
    this.lightGlazeCompositeMipBindGroup = null;
    this.lightGlazeDisplayBindGroup = null;
    this.lightGlazeCompositeBindGroup = null;
    this.lightGlazeStorageAllocated = false;
  }

  private startLightGlazeSession(historyActionId: number, settings: BrushSettings): void {
    if (this.lightGlazeSession) {
      throw new Error("Un tratto Light Glaze precedente non è ancora stato finalizzato.");
    }
    this.ensureLightGlazeResources();
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
        pass.setBindGroup(0, this.lightGlazeMipDownsampleBindGroups[mipLevel - 1]);
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
    this.displayUniformUpload[2] = LAYER_SIZE;
    this.displayUniformUpload[3] = LAYER_SIZE;
    this.displayUniformUpload[4] = this.viewCenterX;
    this.displayUniformUpload[5] = this.viewCenterY;
    this.displayUniformUpload[6] = this.zoom;
    this.displayUniformUpload[7] = 96;
    this.displayUniformUpload[8] = selectedMipLevel;
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

  private ensurePresentationCacheTexture(): void {
    const width = Math.max(1, this.canvas.width);
    const height = Math.max(1, this.canvas.height);
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
    const canvasLeft = (layerLeft - this.viewCenterX) * this.zoom + width * 0.5;
    const canvasTop = (layerTop - this.viewCenterY) * this.zoom + height * 0.5;
    const canvasRight = (layerRight - this.viewCenterX) * this.zoom + width * 0.5;
    const canvasBottom = (layerBottom - this.viewCenterY) * this.zoom + height * 0.5;

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

  private clientToLayer(clientX: number, clientY: number): { x: number; y: number } {
    const screen = this.clientToCanvasPixels(clientX, clientY);
    return {
      x: this.viewCenterX + (screen.x - this.canvas.width * 0.5) / this.zoom,
      y: this.viewCenterY + (screen.y - this.canvas.height * 0.5) / this.zoom,
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
          this.historyActions.push({ id: stroke.historyActionId, kind: "stroke" });
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
      this.historyActions.push({ id: stroke.historyActionId, kind: "stroke" });
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

  private visibleHistoryStrokeIds(): Set<number> {
    let firstVisibleAction = 0;
    for (let index = this.historyCursor - 1; index >= 0; index -= 1) {
      if (this.historyActions[index].kind === "clear") {
        firstVisibleAction = index + 1;
        break;
      }
    }

    const visibleIds = new Set<number>();
    for (let index = firstVisibleAction; index < this.historyCursor; index += 1) {
      const action = this.historyActions[index];
      if (action.kind === "stroke") {
        visibleIds.add(action.id);
      }
    }
    return visibleIds;
  }

  private hasVisibleHistoryContent(): boolean {
    return this.visibleHistoryStrokeIds().size > 0;
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
    const nextCursor = this.historyCursor + delta;
    if (nextCursor < 0 || nextCursor > this.historyActions.length) {
      return false;
    }

    const previousCursor = this.historyCursor;
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
      this.historyCursor = nextCursor;
      try {
        await this.rebuildLayerFromHistory();
      } catch (error) {
        this.historyCursor = previousCursor;
        try {
          await this.rebuildLayerFromHistory();
        } catch (restoreError) {
          const originalMessage = error instanceof Error ? error.message : String(error);
          const restoreMessage = restoreError instanceof Error ? restoreError.message : String(restoreError);
          throw new Error(
            `Undo/Redo non riuscito (${originalMessage}) e ripristino fallito (${restoreMessage}).`,
          );
        }
        throw error;
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
      this.historyBusy = false;
      this.publishHistoryState();
    }
  }

  private async rebuildLayerFromHistory(): Promise<void> {
    // Force the first historical Blend action to reset its persistent carrier,
    // even when its numeric id matches the last live action rendered.
    this.blendRenderer?.beginStroke(0);
    const visibleIds = this.visibleHistoryStrokeIds();
    let firstVisibleBatchIndex = -1;
    let lastVisibleBatchIndex = -1;
    for (let index = 0; index < this.historyBatches.length; index += 1) {
      const batch = this.historyBatches[index];
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
      } else {
        const firstVisibleBatch = this.historyBatches[firstVisibleBatchIndex];
        if (!firstVisibleBatch.clearLayer) {
          // Il clear originale era un pass separato (per esempio dopo
          // "Pulisci"): manteniamo quel confine prima del primo batch visibile.
          this.submitImmediate([], true, firstVisibleBatch.settings, false, null);
        }

        for (let index = firstVisibleBatchIndex; index <= lastVisibleBatchIndex; index += 1) {
          const batch = this.historyBatches[index];
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
              const nextBatch = this.historyBatches[nextIndex];
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
        copies.push({
          x: (centerX - this.viewCenterX) * layerToCssX + cssWidth * 0.5,
          y: (centerY - this.viewCenterY) * layerToCssY + cssHeight * 0.5,
          radius: Math.max(0.25, radius * radiusScale),
          rotation,
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
    this.ensureLightGlazeResources();
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
        if (session.hasContent) {
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
        const presentationDirtyRect = requiresFullRebuild
          ? { x: 0, y: 0, width: this.canvas.width, height: this.canvas.height }
          : submittedDirtyRect
            ? this.layerDirtyRectToPresentationRect(submittedDirtyRect, displaySelectedMipLevel)
            : null;

        if (presentationDirtyRect) {
          this.writeDisplayUniforms(displaySelectedMipLevel);
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
            session.hasContent ? this.lightGlazeDisplayPipeline : this.displayPipeline,
          );
          displayPass.setBindGroup(
            0,
            session.hasContent ? this.lightGlazeDisplayBindGroup! : this.displayBindGroup,
          );
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
          presentationCacheWasUpdated = true;
          presentationCacheUpdatedPixels = presentationDirtyRect.width * presentationDirtyRect.height;
          if (requiresFullRebuild) {
            presentationCacheFullRebuilds = 1;
          } else {
            presentationCachePartialUpdates = 1;
          }
        } else if (submittedDirtyRect) {
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

      if (present) {
        const canonicalDisplayStart = performance.now();
        const canonicalLayerDirtyRect = clearLayer
          ? { x: 0, y: 0, width: LAYER_SIZE, height: LAYER_SIZE }
          : session.dirtyRect;
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

        // Replace every live-composite cache pixel touched by this stroke with
        // the canonical permanent-layer result. Subsequent partial updates can
        // therefore never mix live and committed mip semantics.
        const requiresFullRebuild = this.presentationCacheNeedsFullRebuild || clearLayer;
        const presentationDirtyRect = requiresFullRebuild
          ? { x: 0, y: 0, width: this.canvas.width, height: this.canvas.height }
          : session.dirtyRect
            ? this.layerDirtyRectToPresentationRect(session.dirtyRect, displaySelectedMipLevel)
            : null;
        if (presentationDirtyRect) {
          this.writeDisplayUniforms(displaySelectedMipLevel);
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
          displayPass.setPipeline(this.displayPipeline);
          displayPass.setBindGroup(0, this.displayBindGroup);
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
          presentationCacheWasUpdated = true;
          presentationCacheUpdatedPixels = presentationDirtyRect.width * presentationDirtyRect.height;
          if (requiresFullRebuild) {
            presentationCacheFullRebuilds = 1;
          } else {
            presentationCachePartialUpdates = 1;
          }
        } else if (session.dirtyRect) {
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
    const presentationDirtyRect = clearLayer
      ? { x: 0, y: 0, width: LAYER_SIZE, height: LAYER_SIZE }
      : blendDirtyRect;
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
      presentationDirtyRect,
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

    if (thicknessTailFrame) {
      const thicknessTailEncodingStart = performance.now();
      this.encodeThicknessTailFrame(encoder, thicknessTailFrame);
      brushEncodingMs += performance.now() - thicknessTailEncodingStart;
    }

    if (!present && (clearLayer || stamps.length > 0 || externalDirtyRect)) {
      // Una ricostruzione Undo/Redo omette i display intermedi. La cache non
      // deve quindi essere riutilizzata finché l'ultimo batch non la ricrea.
      this.presentationCacheNeedsFullRebuild = true;
      this.paintDisplayMipValidThroughLevel = 0;
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

      const baseDirtyRect = clearLayer
        ? { x: 0, y: 0, width: LAYER_SIZE, height: LAYER_SIZE }
        : submittedDirtyRect;
      if (clearLayer) {
        this.paintDisplayMipValidThroughLevel = 0;
      }
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

      const canvasPixels = this.canvas.width * this.canvas.height;
      legacyDisplayShaderPixels = canvasPixels;
      presentationCopiedPixels = canvasPixels;

      const requiresFullRebuild = this.presentationCacheNeedsFullRebuild || clearLayer;
      const presentationLayerDirtyRect = this.mergeDirtyRects(
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

      if (presentationDirtyRect) {
        this.writeDisplayUniforms(displaySelectedMipLevel);
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
          thicknessTailFrame ? this.thicknessTailDisplayPipeline : this.displayPipeline,
        );
        displayPass.setBindGroup(
          0,
          thicknessTailFrame ? this.thicknessTailDisplayBindGroup! : this.displayBindGroup,
        );
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

        presentationCacheWasUpdated = true;
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
