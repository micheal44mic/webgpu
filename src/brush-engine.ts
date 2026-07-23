import { clamp, hexToHsl } from "./color";
import { decodeGrayscalePng8 } from "./png-mask";
import { brushShader, displayShader } from "./shaders";

export type BlendMode = "normal" | "additive";
export type LayerFormat = "rgba8unorm" | "rgba16float";
export type BrushShape = "circle" | "shape";
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
export type AdaptivePreviewStrategy = "queue-lag-triggered-canvas2d-tip-patch";
export type AdaptivePreviewTriggerStrategy = "single-sampled-queue-prefix-latency";
export type AdaptivePreviewVisibleCanvasStrategy =
  "iphone-desynchronized-others-synchronized-canvas2d";
export type AdaptiveSpacingStrategy = "queue-lag-step-up-per-stroke";
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

export interface BrushSettings {
  shape: BrushShape;
  shapeScatter: number;
  color: string;
  size: number;
  spacingPercent: number;
  count: number;
  flow: number;
  hardness: number;
  blendIntensity: number;
  blendMode: BlendMode;
  jitterMaster: number;
  hueJitterDegrees: number;
  saturationJitter: number;
  lightnessJitter: number;
  darknessJitter: number;
  jitterPerCopy: boolean;
  positionJitterLateral: number;
  positionJitterLinear: number;
  pressureSize: number;
  pressureOpacity: number;
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
  presentationCacheStrategy: PresentationCacheStrategy;
  presentationTransferStrategy: PresentationTransferStrategy;
  presentationCacheFullRebuilds: number;
  presentationCachePartialUpdates: number;
  presentationCacheOffscreenSkips: number;
  presentationCacheUpdatedPixels: number;
  legacyDisplayShaderPixels: number;
  presentationCopiedPixels: number;
  adaptivePreviewStrategy: AdaptivePreviewStrategy;
  adaptivePreviewTriggerStrategy: AdaptivePreviewTriggerStrategy;
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

interface ActiveStroke {
  lastInput: LayerPoint;
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
}

interface DirtyRect {
  x: number;
  y: number;
  width: number;
  height: number;
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

interface HistoryRenderBatch {
  settings: BrushSettings;
  stamps: Stamp[];
  clearLayer: boolean;
  dirtyRect: DirtyRect | null;
  shapeOccupancySelection: ShapeOccupancySelection | null;
  shapeMaskIdentity: number;
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
  presentationCacheFullRebuilds: number;
  presentationCachePartialUpdates: number;
  presentationCacheOffscreenSkips: number;
  presentationCacheUpdatedPixels: number;
  legacyDisplayShaderPixels: number;
  presentationCopiedPixels: number;
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
const STAMP_STRIDE_BYTES = 32;
const MAX_STAMPS_PER_BATCH = 65_536;
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
const ADAPTIVE_PREVIEW_STRATEGY = "queue-lag-triggered-canvas2d-tip-patch" as const;
const ADAPTIVE_PREVIEW_TRIGGER_STRATEGY = "single-sampled-queue-prefix-latency" as const;
const ADAPTIVE_PREVIEW_VISIBLE_CANVAS_STRATEGY =
  "iphone-desynchronized-others-synchronized-canvas2d" as const;
const ADAPTIVE_PREVIEW_EXACT_LINEAR_SCALE = 0.5;
const ADAPTIVE_PREVIEW_JS_BUDGET_MS = 1.25;
const ADAPTIVE_PREVIEW_COMMIT_BUDGET_RESERVE_MS = 0.2;
const ADAPTIVE_PREVIEW_MAX_TIP_BASE_STAMPS = 2;
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
const DISPLAY_UNIFORM_BYTES = 32;

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
  shape: "circle",
  shapeScatter: 0,
  color: "#ff5b35",
  size: 96,
  spacingPercent: 1,
  count: 24,
  flow: 0.07,
  hardness: 0.88,
  blendIntensity: 1,
  blendMode: "normal",
  jitterMaster: 1,
  hueJitterDegrees: 12,
  saturationJitter: 0.18,
  lightnessJitter: 0.12,
  darknessJitter: 0.18,
  jitterPerCopy: false,
  positionJitterLateral: 1,
  positionJitterLinear: 1,
  pressureSize: 0.65,
  pressureOpacity: 0.35,
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
  private presentationCacheTexture: GPUTexture | null = null;
  private presentationCacheView: GPUTextureView | null = null;
  private presentationCacheWidth = 0;
  private presentationCacheHeight = 0;
  private presentationCacheNeedsFullRebuild = true;
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
  private displayUniformBuffer!: GPUBuffer;
  private instanceBuffer!: GPUBuffer;
  private shapeOccupancyUniformBuffers: GPUBuffer[] = [];
  private sampler!: GPUSampler;
  private shapeMaskTexture!: GPUTexture;
  private shapeMaskView!: GPUTextureView;
  private shapeMaskSampler!: GPUSampler;
  private shapeMaskDecodeStrategy: ShapeMaskDecodeStrategy = SHAPE_CANVAS_DECODE_STRATEGY;
  private shapeMaskIdentity = 0;
  private shapeOccupancyActiveCells = new Array<number>(SHAPE_OCCUPANCY_MAP_COUNT).fill(0);
  private shapeOccupancyCoverageRatios = new Array<number>(SHAPE_OCCUPANCY_MAP_COUNT).fill(1);
  private packedMinimumRadius = Number.POSITIVE_INFINITY;

  private brushBindGroupLayout!: GPUBindGroupLayout;
  private brushOccupancyBindGroupLayout!: GPUBindGroupLayout;
  private displayBindGroupLayout!: GPUBindGroupLayout;
  private brushBindGroup!: GPUBindGroup;
  private brushOccupancyBindGroups: GPUBindGroup[] = [];
  private displayBindGroup!: GPUBindGroup;

  private brushShaderModule!: GPUShaderModule;
  private displayShaderModule!: GPUShaderModule;
  private normalPipeline!: GPURenderPipeline;
  private additivePipeline!: GPURenderPipeline;
  private shapeNormalPipeline!: GPURenderPipeline;
  private shapeAdditivePipeline!: GPURenderPipeline;
  private shapeOccupancyNormalPipeline!: GPURenderPipeline;
  private shapeOccupancyAdditivePipeline!: GPURenderPipeline;
  private displayPipeline!: GPURenderPipeline;

  private readonly instanceUpload = new ArrayBuffer(MAX_STAMPS_PER_BATCH * STAMP_STRIDE_BYTES);
  private readonly instanceUploadF32 = new Float32Array(this.instanceUpload);
  private readonly instanceUploadU32 = new Uint32Array(this.instanceUpload);
  private readonly brushUniformUpload = new ArrayBuffer(BRUSH_UNIFORM_BYTES);
  private readonly displayUniformUpload = new Float32Array(DISPLAY_UNIFORM_BYTES / 4);

  private settings: BrushSettings = { ...defaultBrushSettings };
  private pendingStamps: Stamp[] = [];
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
    this.settings = {
      ...this.settings,
      ...next,
      shape: next.shape === "shape" || next.shape === "circle" ? next.shape : this.settings.shape,
      shapeScatter: clamp(next.shapeScatter ?? this.settings.shapeScatter, 0, 1),
      count: clamp(Math.round(next.count ?? this.settings.count), 1, 24),
      size: clamp(next.size ?? this.settings.size, 4, 1500),
      spacingPercent: clamp(next.spacingPercent ?? this.settings.spacingPercent, 0.25, 25),
      flow: clamp(next.flow ?? this.settings.flow, 0.001, 1),
      hardness: clamp(next.hardness ?? this.settings.hardness, 0, 1),
      blendIntensity: clamp(next.blendIntensity ?? this.settings.blendIntensity, 0.1, 4),
      jitterMaster: clamp(next.jitterMaster ?? this.settings.jitterMaster, 0, 1),
      hueJitterDegrees: clamp(next.hueJitterDegrees ?? this.settings.hueJitterDegrees, 0, 180),
      saturationJitter: clamp(next.saturationJitter ?? this.settings.saturationJitter, 0, 1),
      lightnessJitter: clamp(next.lightnessJitter ?? this.settings.lightnessJitter, 0, 1),
      darknessJitter: clamp(next.darknessJitter ?? this.settings.darknessJitter, 0, 1),
      positionJitterLateral: clamp(next.positionJitterLateral ?? this.settings.positionJitterLateral, 0, 1),
      positionJitterLinear: clamp(next.positionJitterLinear ?? this.settings.positionJitterLinear, 0, 1),
      pressureSize: clamp(next.pressureSize ?? this.settings.pressureSize, 0, 1),
      pressureOpacity: clamp(next.pressureOpacity ?? this.settings.pressureOpacity, 0, 1),
    };
    this.prepareAdaptivePreviewShapePalette(this.settings);

    if (this.initialized) {
      this.invalidateAdaptivePreview();
      this.writeBrushUniforms();
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
    this.invalidateAdaptivePreview();
    this.adaptivePreviewForceStroke = ADAPTIVE_PREVIEW_FORCE;
    const historyActionId = this.nextHistoryActionId++;
    this.activeStroke = {
      lastInput: point,
      distanceSinceStamp: 0,
      adaptiveSpacingInitialPercent: this.settings.spacingPercent,
      adaptiveSpacingPercent: this.settings.spacingPercent,
      historyActionId,
      historyCommitted: false,
      submitted: false,
      seedSequenceBeforeStroke: this.seedSequence,
      historyCursorBeforeStroke: this.historyCursor,
      redoActionsBeforeStroke: this.historyCursor < this.historyActions.length
        ? this.historyActions.slice(this.historyCursor)
        : null,
      historyCompactionPendingBeforeStroke: this.historyCompactionPending,
    };
    this.emitStamp(point, 1, 0);
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

  endStroke(): void {
    const historyChanged = this.activeStroke?.historyCommitted ?? false;
    this.freezeAdaptivePreviewAtLift();
    this.activeStroke = null;
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
    this.invalidateAdaptivePreview();
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
    this.activeStroke = null;
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

    const count = clamp(Math.round(baseStampCount), 1, Math.min(12_000, MAX_STAMPS_PER_BATCH));
    this.invalidateAdaptivePreview();
    this.pendingStamps.length = 0;
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
      this.clearRequested ||
      this.displayDirty
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
      presentationCacheFullRebuilds: 0,
      presentationCachePartialUpdates: 0,
      presentationCacheOffscreenSkips: 0,
      presentationCacheUpdatedPixels: 0,
      legacyDisplayShaderPixels: 0,
      presentationCopiedPixels: 0,
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
      presentationCacheStrategy: PRESENTATION_CACHE_STRATEGY,
      presentationTransferStrategy: PRESENTATION_TRANSFER_STRATEGY,
      presentationCacheFullRebuilds: profile.presentationCacheFullRebuilds,
      presentationCachePartialUpdates: profile.presentationCachePartialUpdates,
      presentationCacheOffscreenSkips: profile.presentationCacheOffscreenSkips,
      presentationCacheUpdatedPixels: profile.presentationCacheUpdatedPixels,
      legacyDisplayShaderPixels: profile.legacyDisplayShaderPixels,
      presentationCopiedPixels: profile.presentationCopiedPixels,
      adaptivePreviewStrategy: ADAPTIVE_PREVIEW_STRATEGY,
      adaptivePreviewTriggerStrategy: ADAPTIVE_PREVIEW_TRIGGER_STRATEGY,
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
    presentationCacheStrategy: typeof PRESENTATION_CACHE_STRATEGY;
    presentationTransferStrategy: typeof PRESENTATION_TRANSFER_STRATEGY;
    adaptivePreviewStrategy: typeof ADAPTIVE_PREVIEW_STRATEGY;
    adaptivePreviewTriggerStrategy: typeof ADAPTIVE_PREVIEW_TRIGGER_STRATEGY;
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
      presentationCacheStrategy: PRESENTATION_CACHE_STRATEGY,
      presentationTransferStrategy: PRESENTATION_TRANSFER_STRATEGY,
      adaptivePreviewStrategy: ADAPTIVE_PREVIEW_STRATEGY,
      adaptivePreviewTriggerStrategy: ADAPTIVE_PREVIEW_TRIGGER_STRATEGY,
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

    this.displayUniformBuffer = this.device.createBuffer({
      label: "Display uniforms",
      size: DISPLAY_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.instanceBuffer = this.device.createBuffer({
      label: "Stamp instance storage",
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

    this.brushShaderModule = this.device.createShaderModule({ label: "Brush WGSL", code: brushShader });
    this.displayShaderModule = this.device.createShaderModule({ label: "Display WGSL", code: displayShader });
    await Promise.all([
      this.assertShaderCompiled(this.brushShaderModule, "brush"),
      this.assertShaderCompiled(this.displayShaderModule, "display"),
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

    const texture = this.device.createTexture({
      label: `4096² paint layer ${format}`,
      size: { width: LAYER_SIZE, height: LAYER_SIZE, depthOrArrayLayers: 1 },
      format,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.COPY_DST,
    });
    const view = texture.createView();

    const brushPipelineLayout = this.device.createPipelineLayout({
      label: `Brush legacy pipeline layout ${format}`,
      bindGroupLayouts: [this.brushBindGroupLayout],
    });
    const brushOccupancyPipelineLayout = this.device.createPipelineLayout({
      label: `Brush occupancy pipeline layout ${format}`,
      bindGroupLayouts: [this.brushOccupancyBindGroupLayout],
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
        { binding: 1, resource: view },
        { binding: 2, resource: this.sampler },
      ],
    });

    this.layerTexture = texture;
    this.layerView = view;
    this.normalPipeline = normalPipeline;
    this.additivePipeline = additivePipeline;
    this.shapeNormalPipeline = shapeNormalPipeline;
    this.shapeAdditivePipeline = shapeAdditivePipeline;
    this.shapeOccupancyNormalPipeline = shapeOccupancyNormalPipeline;
    this.shapeOccupancyAdditivePipeline = shapeOccupancyAdditivePipeline;
    this.displayBindGroup = displayBindGroup;
    this.layerFormat = format;
    this.presentationCacheNeedsFullRebuild = true;

    oldTexture?.destroy();
  }

  private writeBrushUniforms(settings: BrushSettings = this.settings): void {
    const floats = new Float32Array(this.brushUniformUpload);
    const unsigned = new Uint32Array(this.brushUniformUpload);
    floats.fill(0);

    const [hue, saturation, lightness] = hexToHsl(settings.color);
    const jitterMaster = settings.jitterMaster;

    floats[0] = LAYER_SIZE;
    floats[1] = LAYER_SIZE;
    floats[4] = hue;
    floats[5] = saturation;
    floats[6] = lightness;
    floats[7] = 1;
    floats[8] = (settings.hueJitterDegrees / 360) * jitterMaster;
    floats[9] = settings.saturationJitter * jitterMaster;
    floats[10] = settings.lightnessJitter * jitterMaster;
    floats[11] = settings.darknessJitter * jitterMaster;
    floats[12] = settings.flow;
    floats[13] = settings.hardness;
    floats[14] = settings.blendIntensity;
    floats[15] = settings.pressureOpacity;
    floats[16] = settings.positionJitterLinear;
    floats[17] = settings.positionJitterLateral;
    floats[18] = settings.shapeScatter;
    unsigned[20] = settings.count >>> 0;
    unsigned[21] = settings.jitterPerCopy ? 1 : 0;
    unsigned[22] = settings.blendMode === "additive" ? 1 : 0;
    unsigned[23] = 0;

    this.device.queue.writeBuffer(this.brushUniformBuffer, 0, this.brushUniformUpload);
  }

  private writeDisplayUniforms(): void {
    this.displayUniformUpload[0] = this.canvas.width;
    this.displayUniformUpload[1] = this.canvas.height;
    this.displayUniformUpload[2] = LAYER_SIZE;
    this.displayUniformUpload[3] = LAYER_SIZE;
    this.displayUniformUpload[4] = this.viewCenterX;
    this.displayUniformUpload[5] = this.viewCenterY;
    this.displayUniformUpload[6] = this.zoom;
    this.displayUniformUpload[7] = 96;
    this.device.queue.writeBuffer(this.displayUniformBuffer, 0, this.displayUniformUpload);
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

  private layerDirtyRectToPresentationRect(dirtyRect: DirtyRect): DirtyRect | null {
    const width = this.canvas.width;
    const height = this.canvas.height;
    if (width <= 0 || height <= 0) {
      return null;
    }

    // Il display usa filtraggio lineare: un texel modificato può contribuire ai
    // campioni adiacenti. Due pixel layer più un pixel canvas proteggono anche
    // gli arrotondamenti f32 e i confini dello scissor a qualunque zoom.
    const layerMargin = 2;
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

    const start = stroke.lastInput;
    const deltaX = point.x - start.x;
    const deltaY = point.y - start.y;
    const segmentLength = Math.hypot(deltaX, deltaY);

    if (segmentLength <= 0.0001) {
      stroke.lastInput = point;
      this.recordStampGenerationTime(generationStart);
      return;
    }

    const spacing = Math.max(0.1, this.settings.size * (stroke.adaptiveSpacingPercent / 100));
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
        pressure: start.pressure + (point.pressure - start.pressure) * interpolation,
      }, directionX, directionY);
      distanceSinceStamp = 0;
      generatedOnSegment += 1;

      if (generatedOnSegment >= MAX_STAMPS_PER_BATCH) {
        break;
      }
    }

    distanceSinceStamp += Math.max(0, segmentLength - distanceAlongSegment);
    stroke.lastInput = point;
    stroke.distanceSinceStamp = distanceSinceStamp;
    this.recordStampGenerationTime(generationStart);
  }

  private emitStamp(point: LayerPoint, directionX: number, directionY: number): void {
    const pressure = clamp(point.pressure, 0.01, 1);
    const pressureSizeFactor = 1 - this.settings.pressureSize
      + this.settings.pressureSize * Math.max(0.08, pressure);
    const radius = Math.max(0.5, this.settings.size * 0.5 * pressureSizeFactor);
    const jitterReach = radius * 2 * (this.settings.positionJitterLinear + this.settings.positionJitterLateral);
    const seed = (Math.imul(this.seedSequence++, 0x9e3779b1) ^ 0xa511e9b3) >>> 0;

    if (
      point.x + radius + jitterReach < 0 ||
      point.y + radius + jitterReach < 0 ||
      point.x - radius - jitterReach >= LAYER_SIZE ||
      point.y - radius - jitterReach >= LAYER_SIZE
    ) {
      return;
    }

    const stroke = this.activeStroke;
    if (!stroke) {
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

    this.pendingStamps.push({
      x: point.x,
      y: point.y,
      radius,
      pressure,
      seed,
      directionX,
      directionY,
      historyActionId: stroke.historyActionId,
    });
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

    const batchExtractionStart = performance.now();
    const batchSize = Math.min(this.pendingStamps.length, MAX_STAMPS_PER_BATCH);
    const batch = batchSize > 0 ? this.pendingStamps.splice(0, batchSize) : [];
    const batchExtractionMs = performance.now() - batchExtractionStart;
    const shouldSubmit = this.clearRequested || batch.length > 0 || this.displayDirty;

    if (!shouldSubmit || this.canvas.width <= 0 || this.canvas.height <= 0) {
      return;
    }

    const clearLayer = this.clearRequested;
    const renderSettings = this.settings;
    const start = performance.now();
    const timing = this.submitImmediate(batch, clearLayer, renderSettings);
    this.lastCpuFrameMs = performance.now() - start;

    if (batch.length > 0) {
      this.trackAdaptivePreviewExactSubmission(batch, renderSettings);
      this.recordHistoryBatch(batch, renderSettings, timing, clearLayer);
      this.layerHasContent = true;
    } else if (clearLayer) {
      this.layerHasContent = false;
    }

    this.clearRequested = false;
    this.displayDirty = false;
    this.totalBaseStamps += batch.length;
    this.avoidedLogicalDraws += batch.length * Math.max(0, renderSettings.count - 1);
    this.recordRenderedFrame(timestamp);

    const statsPublishStart = performance.now();
    this.publishStats();
    const statsPublishMs = performance.now() - statsPublishStart;

    if (this.pendingStamps.length > 0 || this.displayDirty || this.clearRequested) {
      this.requestRender();
    }

    this.recordStrokeFrameTiming(timestamp, batch.length, timing, {
      totalCpuMs: performance.now() - frameStart,
      resizeCanvasMs,
      batchExtractionMs,
      statsPublishMs,
    });
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
      settings,
      stamps: batch,
      clearLayer,
      dirtyRect: timing.dirtyRect,
      shapeOccupancySelection: timing.shapeOccupancySelection,
      shapeMaskIdentity: this.shapeMaskIdentity,
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
    const visibleIds = this.visibleHistoryStrokeIds();
    let firstVisibleBatchIndex = -1;
    let lastVisibleBatchIndex = -1;
    for (let index = 0; index < this.historyBatches.length; index += 1) {
      if (!this.historyBatches[index].stamps.some((stamp) => visibleIds.has(stamp.historyActionId))) {
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
          const allVisible = batch.stamps.every((stamp) => visibleIds.has(stamp.historyActionId));
          const replayStamps = allVisible
            ? batch.stamps
            : batch.stamps.filter((stamp) => visibleIds.has(stamp.historyActionId));
          if (replayStamps.length === 0) {
            continue;
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
      }
    } finally {
      // Ogni writeBuffer è ordinata sulla stessa GPUQueue: il ripristino arriva
      // dopo tutti i batch storici e prima di un eventuale tratto successivo.
      this.writeBrushUniforms(this.settings);
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
      for (
        let index = this.pendingStamps.length - 1;
        index >= 0 && pendingTip.length < ADAPTIVE_PREVIEW_MAX_TIP_BASE_STAMPS;
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
        .slice(-ADAPTIVE_PREVIEW_MAX_TIP_BASE_STAMPS);
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
    if (settings.blendMode !== "normal") {
      if (profile) {
        profile.adaptivePreviewUnsupportedBlendSkips += 1;
      }
      this.adaptivePreviewCandidates.length = 0;
      this.clearAdaptivePreviewCanvas();
      return;
    }

    const firstCandidate = Math.max(0, batch.length - ADAPTIVE_PREVIEW_MAX_TIP_BASE_STAMPS);
    for (let index = firstCandidate; index < batch.length; index += 1) {
      this.adaptivePreviewCandidates.push({
        serial: startSerial + index + 1,
        stamp: batch[index],
        settings,
        presented: false,
      });
    }
    this.adaptivePreviewCandidates = this.adaptivePreviewCandidates
      .filter((candidate) => candidate.serial === null
        || candidate.serial > this.adaptivePreviewConfirmedSerial)
      .slice(-ADAPTIVE_PREVIEW_MAX_TIP_BASE_STAMPS);

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
    const candidates = this.adaptivePreviewCandidates
      .filter((candidate) => candidate.serial === null
        || candidate.serial > this.adaptivePreviewConfirmedSerial)
      .slice(-ADAPTIVE_PREVIEW_MAX_TIP_BASE_STAMPS);
    if (!canvas || !visibleContext || !scratchCanvas || !context || candidates.length === 0) {
      this.recordAdaptivePreviewJsFrame(startedAt, false);
      return;
    }

    const settings = candidates[candidates.length - 1].settings;
    if (settings.blendMode !== "normal") {
      if (this.activeStrokeProfile) {
        this.activeStrokeProfile.adaptivePreviewUnsupportedBlendSkips += 1;
      }
      this.recordAdaptivePreviewJsFrame(startedAt, false);
      return;
    }
    if (settings.shape === "shape") {
      this.prepareAdaptivePreviewShapePalette(settings);
      if (this.adaptivePreviewShapePalette.length === 0) {
        this.recordAdaptivePreviewJsFrame(startedAt, false);
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
      this.recordAdaptivePreviewJsFrame(startedAt, false);
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
      const directionXRaw = Math.fround(stamp.directionX);
      const directionYRaw = Math.fround(stamp.directionY);
      const directionLength = Math.hypot(directionXRaw, directionYRaw);
      const directionX = directionLength > 0.0001 ? directionXRaw / directionLength : 1;
      const directionY = directionLength > 0.0001 ? directionYRaw / directionLength : 0;
      const baseHsl = hexToHsl(candidateSettings.color);
      const pressureInfluence = candidateSettings.pressureOpacity;
      const pressureAlpha = 1 - pressureInfluence
        + pressureInfluence * clamp(stamp.pressure, 0, 1);
      const alpha = clamp(
        candidateSettings.flow * candidateSettings.blendIntensity * pressureAlpha,
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

    if (copies.length === 0 || performance.now() - startedAt > ADAPTIVE_PREVIEW_JS_BUDGET_MS) {
      if (this.activeStrokeProfile) {
        this.activeStrokeProfile.adaptivePreviewBudgetSkips += 1;
      }
      this.recordAdaptivePreviewJsFrame(startedAt, true);
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
      this.recordAdaptivePreviewJsFrame(startedAt, false);
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
      this.recordAdaptivePreviewJsFrame(startedAt, false);
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
      this.recordAdaptivePreviewJsFrame(startedAt, true);
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

  private submitImmediate(
    stamps: readonly Stamp[],
    clearLayer: boolean,
    settings: BrushSettings = this.settings,
    present = true,
    replayBatch: HistoryRenderBatch | null = null,
  ): SubmitTiming {
    const cpuStart = performance.now();
    if (present) {
      this.ensurePresentationCacheTexture();
    }
    const encoder = this.device.createCommandEncoder({ label: "Brush frame encoder" });
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

    if (replayBatch && replayBatch.shapeMaskIdentity !== this.shapeMaskIdentity) {
      throw new Error("La Shape usata dalla cronologia non corrisponde alla risorsa corrente.");
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
        const pipeline = isShape
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
          useShapeOccupancy
            ? this.brushOccupancyBindGroups[shapeOccupancyMip!]
            : this.brushBindGroup,
        );
        brushPass.setScissorRect(dirtyRect.x, dirtyRect.y, dirtyRect.width, dirtyRect.height);
        if (isShape && shapeOccupancySelection && !replayBatch) {
          this.recordShapeSampling(shapeOccupancySelection);
        }
        brushPass.draw(STAMP_VERTICES_PER_COPY, stamps.length * settings.count, 0, 0);
      }
      brushPass.end();
      brushEncodingMs = performance.now() - brushEncodingStart;
    }

    if (!present && (clearLayer || stamps.length > 0)) {
      // Una ricostruzione Undo/Redo omette i display intermedi. La cache non
      // deve quindi essere riutilizzata finché l'ultimo batch non la ricrea.
      this.presentationCacheNeedsFullRebuild = true;
    }

    if (present) {
      const displayEncodingStart = performance.now();
      const canvasPixels = this.canvas.width * this.canvas.height;
      legacyDisplayShaderPixels = canvasPixels;
      presentationCopiedPixels = canvasPixels;

      const requiresFullRebuild = this.presentationCacheNeedsFullRebuild || clearLayer;
      const presentationDirtyRect = requiresFullRebuild
        ? { x: 0, y: 0, width: this.canvas.width, height: this.canvas.height }
        : submittedDirtyRect
          ? this.layerDirtyRectToPresentationRect(submittedDirtyRect)
          : null;

      if (presentationDirtyRect) {
        this.writeDisplayUniforms();
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
      } else if (submittedDirtyRect) {
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
    };
  }

  private packStamps(stamps: readonly Stamp[], settings: BrushSettings): DirtyRect | null {
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
      this.instanceUploadF32[base] = stamp.x;
      this.instanceUploadF32[base + 1] = stamp.y;
      this.instanceUploadF32[base + 2] = stamp.radius;
      this.instanceUploadF32[base + 3] = stamp.pressure;
      this.instanceUploadU32[base + 4] = stamp.seed;
      this.instanceUploadU32[base + 5] = 0;
      this.instanceUploadF32[base + 6] = stamp.directionX;
      this.instanceUploadF32[base + 7] = stamp.directionY;

      const packedX = this.instanceUploadF32[base];
      const packedY = this.instanceUploadF32[base + 1];
      const packedRadius = this.instanceUploadF32[base + 2];
      minimumRadius = Math.min(minimumRadius, packedRadius);
      const packedDirectionX = this.instanceUploadF32[base + 6];
      const packedDirectionY = this.instanceUploadF32[base + 7];
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

    this.packedMinimumRadius = minimumRadius;
    return width > 0 && height > 0 ? { x, y, width, height } : null;
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
      const pressureSizeFactor = 1 - settings.pressureSize
        + settings.pressureSize * Math.max(0.08, pressure);
      const radius = Math.max(0.5, settings.size * 0.5 * pressureSizeFactor);

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

    if (batchSize > 0) {
      profile.brushBatches += 1;
      profile.physicalCopies += batchSize * this.settings.count;
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
