import "./styles.css";
import {
  BrushEngine,
  type BrushSettings,
  type EngineStats,
  type HistoryState,
  type LayerPoint,
  type LayerFormat,
  type PointerSample,
  type FragmentCoverageStrategy,
  type GrainMode,
  type ShapeMaskDecodeStrategy,
  type ShapeOccupancyFallbackReason,
  type ShapeSamplingStrategy,
  type StampGeometry,
  type StrokePerformanceProfile,
  type RasterStrokeStyle,
  type RasterBevelStyle,
} from "./brush-engine";

function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) {
    throw new Error(`Elemento #${id} non trovato.`);
  }
  return result as T;
}

function rangeValue(id: string): number {
  return Number(element<HTMLInputElement>(id).value);
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 }).format(value);
}

const memoryNumberFormatter = new Intl.NumberFormat("it-IT", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function formatMemoryMiB(value: number): string {
  if (value === 0) {
    return "0 MiB";
  }
  if (value > 0 && value < 0.05) {
    return "<0,1 MiB";
  }
  return `${memoryNumberFormatter.format(value)} MiB`;
}

const canvas = element<HTMLCanvasElement>("gpuCanvas");
const tipPreviewCanvas = element<HTMLCanvasElement>("tipPreviewCanvas");
const controlsPanel = element<HTMLElement>("controlsPanel");
const toggleControlsButton = element<HTMLButtonElement>("toggleControls");
const statusElement = element<HTMLParagraphElement>("status");
const benchmarkButton = element<HTMLButtonElement>("runBenchmark");
const benchmarkResult = element<HTMLParagraphElement>("benchmarkResult");
const rasterStrokeGoldenSection = element<HTMLElement>("rasterStrokeGoldenSection");
const rasterStrokeGoldenButton = element<HTMLButtonElement>("runRasterStrokeGolden");
const rasterStrokeGoldenResult = element<HTMLParagraphElement>("rasterStrokeGoldenResult");
const rasterStrokeGoldenDetails = element<HTMLDetailsElement>("rasterStrokeGoldenDetails");
const rasterStrokeGoldenReport = element<HTMLElement>("rasterStrokeGoldenReport");
const effectsWorkbenchBenchmarkButton = element<HTMLButtonElement>("runEffectsWorkbenchBenchmark");
const effectsWorkbenchBenchmarkResult = element<HTMLParagraphElement>("effectsWorkbenchBenchmarkResult");
const effectsWorkbenchBenchmarkDetails = element<HTMLDetailsElement>("effectsWorkbenchBenchmarkDetails");
const effectsWorkbenchBenchmarkReport = element<HTMLElement>("effectsWorkbenchBenchmarkReport");
const recordHumanStrokeButton = element<HTMLButtonElement>("recordHumanStroke");
const playHumanStrokeButton = element<HTMLButtonElement>("playHumanStroke");
const playBlendHumanStrokeButton = element<HTMLButtonElement>("playBlendHumanStroke");
const humanStrokeResult = element<HTMLParagraphElement>("humanStrokeResult");
const humanStrokeTestVariantSelect = element<HTMLSelectElement>("humanStrokeTestVariant");
const humanStrokeTestBlendModeSelect = element<HTMLSelectElement>("humanStrokeTestBlendMode");
const humanStrokeTestGrainModeSelect = element<HTMLSelectElement>("humanStrokeTestGrainMode");
const layerFormatSelect = element<HTMLSelectElement>("layerFormat");
const clearLayerButton = element<HTMLButtonElement>("clearLayer");
const undoStrokeButton = element<HTMLButtonElement>("undoStroke");
const redoStrokeButton = element<HTMLButtonElement>("redoStroke");
const fitViewButton = element<HTMLButtonElement>("fitView");
const zoomInButton = element<HTMLButtonElement>("zoomIn");
const zoomOutButton = element<HTMLButtonElement>("zoomOut");
const benchmarkStampsInput = element<HTMLInputElement>("benchmarkStamps");
const gpuMemoryPanel = element<HTMLElement>("gpuMemoryPanel");
const gpuMemoryToggle = element<HTMLButtonElement>("gpuMemoryToggle");
const gpuMemoryClose = element<HTMLButtonElement>("gpuMemoryClose");
const gpuMemoryChevron = element<HTMLElement>("gpuMemoryChevron");
const gpuMemoryDelta = element<HTMLElement>("gpuMemoryDelta");

type HumanStrokeTestVariant = "base" | "fur" | "blend";
type HumanStrokeTestBlendMode = "normal" | "m1-glaze";
type HumanStrokeTestGrainMode = Extract<GrainMode, "off" | "texturized">;
type HumanStrokeBackgroundStrategy = "transparent" | "multicolor-horizontal-stripes-v1";
type BlendScratchState = "not-applicable" | "cold" | "warm";

interface HumanStrokePoint extends LayerPoint {
  timeMs: number;
}

interface HumanStrokeBenchmark {
  version: 1;
  capturedAt: string;
  settings: BrushSettings;
  points: HumanStrokePoint[];
}

interface HumanStrokeRecording {
  settings: BrushSettings;
  startTimestamp: number;
  points: HumanStrokePoint[];
}

const LEGACY_HUMAN_STROKE_STORAGE_KEY = "webgpu-brush-engine.human-stroke.v1";
const HUMAN_STROKE_API_URL = "/api/human-stroke";
const BENCHMARK_RUNS_API_URL = "/api/benchmark-runs";

interface BenchmarkRun {
  version: 1;
  recordedAt: string;
  benchmark: {
    capturedAt: string;
    traceFingerprint: string;
    pointCount: number;
    traceDurationMs: number;
    pathLengthPx: number;
    averageSpeedPxPerSecond: number;
    peakSpeedPxPerSecond: number;
    sampleGapP95Ms: number;
    sampleGapMaxMs: number;
    inputGapsOver33Ms: number;
    testVariant: HumanStrokeTestVariant;
    testTool: BrushSettings["tool"];
    testBlendMode: HumanStrokeTestBlendMode;
    testGrainMode: HumanStrokeTestGrainMode;
    backgroundStrategy: HumanStrokeBackgroundStrategy;
    blendScratchStateBeforeReplay: BlendScratchState;
    blendScratchMemoryMiBBeforeReplay: number;
    blendScratchMemoryMiBAfterReplay: number;
    settings: BrushSettings;
  };
  playback: {
    inputDeliveryMs: number;
    inputDelayP50Ms: number;
    inputDelayP95Ms: number;
    inputDelayMaxMs: number;
    layerInputDispatchTotalMs: number;
    layerInputDispatchP50Ms: number;
    layerInputDispatchP95Ms: number;
    layerInputDispatchMaxMs: number;
    inputDeliveryPath: "preconverted-layer-points";
    pointerPipelineMeasured: false;
    inputToGpuCompletionMs: number;
    endToPresentedMs: number;
  };
  performance: StrokePerformanceProfile;
  environment: {
    userAgent: string;
    platform: string;
    language: string;
    maxTouchPoints: number;
    devicePixelRatio: number;
    screenWidth: number;
    screenHeight: number;
    viewportWidth: number;
    viewportHeight: number;
    hardwareConcurrency: number | null;
    deviceMemoryGiB: number | null;
    connection: string | null;
    canvasWidth: number;
    canvasHeight: number;
    layerSize: number;
    layerFormat: LayerFormat;
    effectsWorkingSetStrategy: string;
    effectsWorkingSetGeneration: number;
    effectsWorkingSetSourceFormat: LayerFormat;
    effectsScratchPoolStrategy: string;
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
    rasterStrokeCoverageStrategy: string;
    rasterStrokeStyledStorageStrategy: string;
    rasterStrokeDistanceStorageStrategy: string;
    rasterStrokeMutationGateStrategy: string;
    rasterStrokeScratchStrategy: string;
    rasterStrokeScratchExtent: number;
    rasterStrokeScratchCompactMaxWidth: number;
    rasterBevelRendererBuild: string | null;
    rasterBevelStyle: RasterBevelStyle;
    rasterBevelHeightMemoryMiB: number;
    rasterBevelScratchMemoryMiB: number;
    rasterBevelScratchExtent: number;
    rasterBevelFieldStrategy: string;
    rasterBevelBoundingFieldEnabled: boolean;
    rasterBevelFieldAllocationBounds: Readonly<{ x: number; y: number; width: number; height: number }> | null;
    rasterBevelFieldValidBounds: Readonly<{ x: number; y: number; width: number; height: number }> | null;
    rasterBevelFieldTextureWidth: number;
    rasterBevelFieldTextureHeight: number;
    rasterBevelFieldGeneration: number;
    rasterBevelFieldAllocationCount: number;
    rasterBevelFieldShrinkCount: number;
    rasterBevelDistanceStrategy: string;
    rasterBevelWorkspaceStrategy: string;
    rasterBevelHeightSourceMode: string | null;
    dryBlendScratchLifecycleStrategy: string;
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
    shapeMaskResident: boolean;
    shapeStorageLifecycleStrategy: string;
    colorSeedStrategy: "reuse-position-copy-seed";
    dirtyRectStrategy: "directional-jitter-bounds";
    thicknessDynamicsStrategy: StrokePerformanceProfile["thicknessDynamicsStrategy"];
    thicknessDynamicsTaperWindowMs: number;
    thicknessDynamicsPreviewStrategy:
      StrokePerformanceProfile["thicknessDynamicsPreviewStrategy"];
    thicknessDynamicsPreviewTextureQuantum: number;
    thicknessDynamicsPreviewMaximumTextureDimension: number;
    presentationCacheStrategy: StrokePerformanceProfile["presentationCacheStrategy"];
    presentationTransferStrategy: StrokePerformanceProfile["presentationTransferStrategy"];
    paintDisplayPyramidStrategy: StrokePerformanceProfile["paintDisplayPyramidStrategy"];
    paintDisplayLodSelectionStrategy: StrokePerformanceProfile["paintDisplayLodSelectionStrategy"];
    paintDisplayMipLevelCount: number;
    paintDisplaySelectedMipLevel: number;
    paintDisplayPyramidAdditionalMemoryMiB: number;
    brushOpacityStrategy: StrokePerformanceProfile["brushOpacityStrategy"];
    grainStrategy: StrokePerformanceProfile["grainStrategy"];
    grainCoordinateStrategy: StrokePerformanceProfile["grainCoordinateStrategy"];
    grainSamplingStrategy: StrokePerformanceProfile["grainSamplingStrategy"];
    grainMipStrategy: StrokePerformanceProfile["grainMipStrategy"];
    grainTextureFormat: StrokePerformanceProfile["grainTextureFormat"];
    grainTextureWidth: number;
    grainTextureHeight: number;
    grainTextureMipLevelCount: number;
    grainTextureMemoryMiB: number;
    grainTextureIdentity: number;
    grainPipelineStrategy: StrokePerformanceProfile["grainPipelineStrategy"];
    grainCoverageStrategy: StrokePerformanceProfile["grainCoverageStrategy"];
    grainAdaptivePreviewStrategy: StrokePerformanceProfile["grainAdaptivePreviewStrategy"];
    grainTextureResident: boolean;
    grainStorageLifecycleStrategy: string;
    grainStartupDecodeMs: number;
    grainStartupMipBuildMs: number;
    grainStartupUploadMs: number;
    lightGlazeStrategy: StrokePerformanceProfile["lightGlazeStrategy"];
    lightGlazeAdaptivePreviewStrategy:
      StrokePerformanceProfile["lightGlazeAdaptivePreviewStrategy"];
    lightGlazeStorageAllocated: boolean;
    lightGlazeStorageMode: StrokePerformanceProfile["lightGlazeStorageMode"];
    lightGlazeStorageLifecycleStrategy: string;
    lightGlazeAdditionalMemoryMiB: number;
    adaptivePreviewStrategy: StrokePerformanceProfile["adaptivePreviewStrategy"];
    adaptivePreviewTriggerStrategy: StrokePerformanceProfile["adaptivePreviewTriggerStrategy"];
    adaptivePreviewStaleFrameStrategy:
      StrokePerformanceProfile["adaptivePreviewStaleFrameStrategy"];
    adaptivePreviewVisibleCanvasStrategy: StrokePerformanceProfile["adaptivePreviewVisibleCanvasStrategy"];
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
    adaptiveSpacingStrategy: StrokePerformanceProfile["adaptiveSpacingStrategy"];
    adaptiveSpacingStepPercentPoints: number;
    adaptiveSpacingMaxExtraPercentPoints: number;
    historyStorageStrategy: StrokePerformanceProfile["historyStorageStrategy"];
    historyReplayStrategy: StrokePerformanceProfile["historyReplayStrategy"];
    historyStampRetentionStrategy: StrokePerformanceProfile["historyStampRetentionStrategy"];
    controlsLayoutStrategy: "full-stage-overlay-drawer";
    touchNavigationStrategy: "two-finger-pan-pinch";
    performanceTelemetryRevision: 43;
  };
}

let historyState: HistoryState = {
  canUndo: false,
  canRedo: false,
  busy: false,
  actionCount: 0,
  cursor: 0,
  storedBaseStamps: 0,
  logicalStampBytes: 0,
};

const bevelBoundingFieldEnabled =
  new URLSearchParams(window.location.search).get("bevelField") === "bbox";
const engine = new BrushEngine(canvas, {
  onStatus(message, kind) {
    statusElement.textContent = message;
    statusElement.className = `status ${kind === "working" ? "" : kind}`;
  },
  onStats(stats) {
    updateStats(stats);
  },
  onHistoryChange(state) {
    historyState = state;
    updateHistoryControls();
    updateHumanStrokeControls();
  },
}, tipPreviewCanvas, { bevelBoundingFieldEnabled });
if (import.meta.env.DEV) {
  (window as Window & { __brushEngine?: BrushEngine }).__brushEngine = engine;
}

let humanStrokeBenchmark: HumanStrokeBenchmark | null = null;
let humanStrokeRecording: HumanStrokeRecording | null = null;
let humanStrokeRecordingArmed = false;
let humanStrokeReplayFrame: number | null = null;
let humanStrokeReplaying = false;
let humanStrokeLoading = true;
let humanStrokeSaving = false;
let benchmarkRunning = false;
let rasterStrokeGoldenRunning = false;
let effectsWorkbenchBenchmarkRunning = false;
let layerFormatChanging = false;
let rasterStrokeChanging = false;
let historyUiBusy = false;
let rasterBevelChanging = false;
let engineInitialized = false;
let controlsPanelOpen = true;
let gpuMemoryPanelOpen = false;
let previousGpuMemoryTotalMiB: number | null = null;
let gpuMemoryDeltaTimer: number | null = null;
let activeBrushTool: BrushSettings["tool"] = "paint";

type NumericKeyOf<T> = {
  [Key in keyof T]-?: T[Key] extends number ? Key : never;
}[keyof T];

const gpuMemoryRows: ReadonlyArray<
  readonly [string, NumericKeyOf<EngineStats["gpuMemory"]>]
> = [
  ["gpuMemoryLayerBase", "layerBaseMiB"],
  ["gpuMemoryLayerMips", "layerMipChainMiB"],
  ["gpuMemoryGrain", "grainTextureMiB"],
  ["gpuMemoryShape", "shapeTextureMiB"],
  ["gpuMemoryPaintBuffers", "paintBuffersMiB"],
  ["gpuMemoryPresentation", "presentationCacheMiB"],
  ["gpuMemoryStrokeStyled", "rasterStrokeStyledMiB"],
  ["gpuMemoryStrokeCoverage", "rasterStrokeCoverageMiB"],
  ["gpuMemoryStrokeControl", "rasterStrokeMaskAndControlMiB"],
  ["gpuMemoryEffectsScratch", "effectsScratchPoolMiB"],
  ["gpuMemoryEffectsScratchPeak", "effectsScratchPoolPeakMiB"],
  ["gpuMemoryBevelHeight", "rasterBevelHeightMiB"],
  ["gpuMemoryBevelControl", "rasterBevelLutAndControlMiB"],
  ["gpuMemoryBlend", "blendRendererMiB"],
  ["gpuMemoryLightGlaze", "lightGlazeMiB"],
  ["gpuMemoryThicknessTail", "thicknessTailMiB"],
  ["gpuMemoryHistory", "historyCpuMiB"],
];

const toolControlSnapshots: Record<
  BrushSettings["tool"],
  { size: number; spacing: number; flow: number; hardness: number }
> = {
  paint: { size: 96, spacing: 1, flow: 7, hardness: 88 },
  blend: { size: 100, spacing: 10, flow: 45, hardness: 8 },
};

function captureActiveToolControls(): void {
  toolControlSnapshots[activeBrushTool] = {
    size: rangeValue("brushSize"),
    spacing: rangeValue("spacing"),
    flow: rangeValue("flow"),
    hardness: rangeValue("hardness"),
  };
}

function configureBrushToolUi(
  tool: BrushSettings["tool"],
  restoreSnapshot: boolean,
): void {
  const previousTool = activeBrushTool;
  if (restoreSnapshot && previousTool !== tool) {
    captureActiveToolControls();
  }
  activeBrushTool = tool;
  setControlValue("brushTool", tool);
  const blend = tool === "blend";
  const size = element<HTMLInputElement>("brushSize");
  const spacing = element<HTMLInputElement>("spacing");
  size.min = blend ? "1" : "4";
  size.max = blend ? "1024" : "1500";
  spacing.min = blend ? "1" : "0.25";
  spacing.max = blend ? "400" : "25";
  spacing.step = blend ? "1" : "0.25";
  if (restoreSnapshot && previousTool !== tool) {
    const snapshot = toolControlSnapshots[tool];
    setControlValue("brushSize", snapshot.size);
    setControlValue("spacing", snapshot.spacing);
    setControlValue("flow", snapshot.flow);
    setControlValue("hardness", snapshot.hardness);
  }
  for (const id of [
    "shapeScatterControl",
    "countControl",
    "opacityControl",
    "paintBlendIntensityControl",
    "paintBlendModeControl",
    "thicknessSection",
    "colorJitterSection",
    "positionJitterSection",
  ]) {
    element<HTMLElement>(id).hidden = blend;
  }
  element<HTMLElement>("blendControls").hidden = !blend;
}

function setControlsPanelOpen(open: boolean): void {
  controlsPanelOpen = open;
  controlsPanel.hidden = !open;
  toggleControlsButton.setAttribute("aria-expanded", String(open));
  toggleControlsButton.setAttribute("aria-label", open ? "Nascondi pannelli" : "Mostra pannelli");
  toggleControlsButton.title = open ? "Nascondi pannelli" : "Mostra pannelli";
}

function setGpuMemoryPanelOpen(open: boolean): void {
  gpuMemoryPanelOpen = open;
  gpuMemoryPanel.hidden = !open;
  gpuMemoryToggle.setAttribute("aria-expanded", String(open));
  gpuMemoryToggle.title = open
    ? "Chiudi dettaglio memoria GPU"
    : "Apri dettaglio memoria GPU";
  gpuMemoryChevron.textContent = open ? "▾" : "▴";
}

function readBrushSettings(): BrushSettings {
  return {
    tool: element<HTMLSelectElement>("brushTool").value === "blend" ? "blend" : "paint",
    shape: element<HTMLSelectElement>("brushShape").value as BrushSettings["shape"],
    shapeScatter: rangeValue("shapeScatter") / 100,
    grainMode: element<HTMLSelectElement>("grainMode").value as BrushSettings["grainMode"],
    grainScale: rangeValue("grainScale") / 100,
    grainDepth: rangeValue("grainDepth") / 100,
    grainBrightness: rangeValue("grainBrightness") / 100,
    grainContrast: rangeValue("grainContrast") / 100,
    grainInvert: element<HTMLInputElement>("grainInvert").checked,
    grainFiltering:
      element<HTMLSelectElement>("grainFiltering").value as BrushSettings["grainFiltering"],
    grainBlendMode:
      element<HTMLSelectElement>("grainBlendMode").value as BrushSettings["grainBlendMode"],
    color: element<HTMLInputElement>("brushColor").value,
    size: rangeValue("brushSize"),
    spacingPercent: rangeValue("spacing"),
    startThickness: rangeValue("startThickness") / 100,
    endThickness: rangeValue("endThickness") / 100,
    count: rangeValue("count"),
    flow: rangeValue("flow") / 100,
    opacity: rangeValue("opacity") / 100,
    hardness: rangeValue("hardness") / 100,
    blendIntensity: rangeValue("blendIntensity"),
    blendMode: element<HTMLSelectElement>("blendMode").value as BrushSettings["blendMode"],
    blendStretch: rangeValue("blendStretch") / 100,
    blendPaint: rangeValue("blendPaint") / 100,
    jitterMaster: rangeValue("jitterMaster") / 100,
    hueJitterDegrees: rangeValue("hueJitter"),
    saturationJitter: rangeValue("saturationJitter") / 100,
    lightnessJitter: rangeValue("lightnessJitter") / 100,
    darknessJitter: rangeValue("darknessJitter") / 100,
    jitterPerCopy: element<HTMLInputElement>("jitterPerCopy").checked,
    positionJitterLateral: rangeValue("positionJitterLateral") / 100,
    positionJitterLinear: rangeValue("positionJitterLinear") / 100,
  };
}

function updateControlOutputs(): void {
  element<HTMLOutputElement>("shapeScatterOut").value = `${rangeValue("shapeScatter").toFixed(0)}%`;
  element<HTMLOutputElement>("grainScaleOut").value = `${rangeValue("grainScale").toFixed(0)}%`;
  element<HTMLOutputElement>("grainDepthOut").value = `${rangeValue("grainDepth").toFixed(0)}%`;
  const grainBrightness = rangeValue("grainBrightness");
  element<HTMLOutputElement>("grainBrightnessOut").value =
    `${grainBrightness > 0 ? "+" : ""}${grainBrightness.toFixed(0)}%`;
  const grainContrast = rangeValue("grainContrast");
  element<HTMLOutputElement>("grainContrastOut").value =
    `${grainContrast > 0 ? "+" : ""}${grainContrast.toFixed(0)}%`;
  element<HTMLOutputElement>("brushSizeOut").value = `${rangeValue("brushSize").toFixed(0)} px`;
  element<HTMLOutputElement>("spacingOut").value = `${rangeValue("spacing").toFixed(2)}%`;
  element<HTMLOutputElement>("startThicknessOut").value = `${rangeValue("startThickness").toFixed(0)}%`;
  element<HTMLOutputElement>("endThicknessOut").value = `${rangeValue("endThickness").toFixed(0)}%`;
  element<HTMLOutputElement>("countOut").value = rangeValue("count").toFixed(0);
  element<HTMLOutputElement>("flowOut").value = `${rangeValue("flow").toFixed(1).replace(".0", "")}%`;
  element<HTMLOutputElement>("opacityOut").value = `${rangeValue("opacity").toFixed(1).replace(".0", "")}%`;
  element<HTMLOutputElement>("hardnessOut").value = `${rangeValue("hardness").toFixed(0)}%`;
  element<HTMLOutputElement>("blendIntensityOut").value = `${rangeValue("blendIntensity").toFixed(2)}×`;
  element<HTMLOutputElement>("blendStretchOut").value = `${rangeValue("blendStretch").toFixed(0)}%`;
  element<HTMLOutputElement>("blendPaintOut").value = `${rangeValue("blendPaint").toFixed(0)}%`;
  element<HTMLOutputElement>("jitterMasterOut").value = `${rangeValue("jitterMaster").toFixed(0)}%`;
  element<HTMLOutputElement>("hueJitterOut").value = `${rangeValue("hueJitter").toFixed(0)}°`;
  element<HTMLOutputElement>("saturationJitterOut").value = `${rangeValue("saturationJitter").toFixed(0)}%`;
  element<HTMLOutputElement>("lightnessJitterOut").value = `${rangeValue("lightnessJitter").toFixed(0)}%`;
  element<HTMLOutputElement>("darknessJitterOut").value = `${rangeValue("darknessJitter").toFixed(0)}%`;
  element<HTMLOutputElement>("positionJitterLateralOut").value = `${rangeValue("positionJitterLateral").toFixed(0)}%`;
  element<HTMLOutputElement>("rasterStrokeWidthOut").value =
    `${rangeValue("rasterStrokeWidth").toFixed(0)} px`;
  element<HTMLOutputElement>("rasterBevelSizeOut").value =
    `${rangeValue("rasterBevelSize").toFixed(1).replace(".0", "")} px`;
  element<HTMLOutputElement>("rasterBevelSoftenOut").value =
    `${rangeValue("rasterBevelSoften").toFixed(1).replace(".0", "")} px`;
  element<HTMLOutputElement>("rasterBevelDepthOut").value =
    `${rangeValue("rasterBevelDepth").toFixed(0)}%`;
  element<HTMLOutputElement>("rasterBevelAngleOut").value =
    `${rangeValue("rasterBevelAngle").toFixed(0)}°`;
  element<HTMLOutputElement>("rasterBevelAltitudeOut").value =
    `${rangeValue("rasterBevelAltitude").toFixed(0)}°`;
  element<HTMLOutputElement>("rasterBevelRangeOut").value =
    `${rangeValue("rasterBevelRange").toFixed(0)}%`;
  element<HTMLOutputElement>("rasterBevelFillOut").value =
    `${rangeValue("rasterBevelFill").toFixed(0)}%`;
  element<HTMLOutputElement>("rasterBevelHighlightOpacityOut").value =
    `${rangeValue("rasterBevelHighlightOpacity").toFixed(0)}%`;
  element<HTMLOutputElement>("rasterBevelShadowOpacityOut").value =
    `${rangeValue("rasterBevelShadowOpacity").toFixed(0)}%`;
  element<HTMLOutputElement>("positionJitterLinearOut").value = `${rangeValue("positionJitterLinear").toFixed(0)}%`;
  element<HTMLOutputElement>("benchmarkStampsOut").value = formatInteger(rangeValue("benchmarkStamps"));
}

function applyBrushControls(): void {
  captureActiveToolControls();
  updateControlOutputs();
  updateGrainControlAvailability();
  engine.setBrushSettings(readBrushSettings());
}

function formatDuration(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(2)} s`;
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
}

function nextAnimationFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function fingerprintHumanStroke(points: readonly HumanStrokePoint[]): string {
  let hash = 0x811c9dc5;
  for (const point of points) {
    for (const value of [
      Math.round(point.x * 10),
      Math.round(point.y * 10),
      Math.round(point.pressure * 1_000),
      Math.round(point.timeMs * 10),
    ]) {
      hash = Math.imul(hash ^ value, 0x01000193) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, "0");
}

function summarizeHumanStrokeMotion(points: readonly HumanStrokePoint[]): {
  pathLengthPx: number;
  averageSpeedPxPerSecond: number;
  peakSpeedPxPerSecond: number;
  sampleGapP95Ms: number;
  sampleGapMaxMs: number;
  inputGapsOver33Ms: number;
} {
  let pathLengthPx = 0;
  let peakSpeedPxPerSecond = 0;
  const sampleGaps: number[] = [];

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const gapMs = Math.max(0, current.timeMs - previous.timeMs);
    const distance = Math.hypot(current.x - previous.x, current.y - previous.y);
    pathLengthPx += distance;
    sampleGaps.push(gapMs);
    if (gapMs > 0) {
      peakSpeedPxPerSecond = Math.max(peakSpeedPxPerSecond, (distance / gapMs) * 1_000);
    }
  }

  const traceDurationMs = points.at(-1)?.timeMs ?? 0;
  return {
    pathLengthPx,
    averageSpeedPxPerSecond: traceDurationMs > 0 ? (pathLengthPx / traceDurationMs) * 1_000 : 0,
    peakSpeedPxPerSecond,
    sampleGapP95Ms: percentile(sampleGaps, 0.95),
    sampleGapMaxMs: sampleGaps.length === 0 ? 0 : Math.max(...sampleGaps),
    inputGapsOver33Ms: sampleGaps.filter((gapMs) => gapMs > 33).length,
  };
}

function collectBenchmarkEnvironment(): BenchmarkRun["environment"] {
  const navigatorWithMetrics = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { effectiveType?: string; type?: string };
  };
  const engineEnvironment = engine.getBenchmarkEnvironment();
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    maxTouchPoints: navigator.maxTouchPoints,
    devicePixelRatio: window.devicePixelRatio || 1,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    hardwareConcurrency: navigator.hardwareConcurrency || null,
    deviceMemoryGiB: navigatorWithMetrics.deviceMemory ?? null,
    connection: navigatorWithMetrics.connection?.effectiveType ?? navigatorWithMetrics.connection?.type ?? null,
    controlsLayoutStrategy: "full-stage-overlay-drawer",
    touchNavigationStrategy: "two-finger-pan-pinch",
    performanceTelemetryRevision: 43,
    ...engineEnvironment,
  };
}

async function saveBenchmarkRun(run: BenchmarkRun): Promise<number> {
  const response = await fetch(BENCHMARK_RUNS_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(run),
  });
  if (!response.ok) {
    throw new Error("Il risultato è visibile, ma non è stato possibile aggiungerlo al registro.");
  }
  const payload = await response.json() as { id?: unknown };
  return typeof payload.id === "number" ? payload.id : 0;
}

function parseHumanStrokeBenchmark(value: unknown): HumanStrokeBenchmark | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const parsed = value as Partial<HumanStrokeBenchmark>;
  if (parsed.version !== 1 || !parsed.settings || !Array.isArray(parsed.points) || parsed.points.length === 0) {
    return null;
  }
  const benchmark = parsed as HumanStrokeBenchmark;
  const opacity = Number.isFinite(benchmark.settings.opacity)
    ? Math.min(1, Math.max(0, benchmark.settings.opacity))
    : 1;
  const blendMode = benchmark.settings.blendMode === "additive"
    || benchmark.settings.blendMode === "light-glaze"
    || benchmark.settings.blendMode === "m1-glaze"
    ? benchmark.settings.blendMode
    : "normal";
  const grainMode = benchmark.settings.grainMode === "texturized"
    || benchmark.settings.grainMode === "moving"
    ? benchmark.settings.grainMode
    : "off";
  const grainScale = Number.isFinite(benchmark.settings.grainScale)
    ? Math.min(4, Math.max(0.1, benchmark.settings.grainScale))
    : 1.4;
  const grainDepth = Number.isFinite(benchmark.settings.grainDepth)
    ? Math.min(1, Math.max(0, benchmark.settings.grainDepth))
    : 1;
  const grainBrightness = Number.isFinite(benchmark.settings.grainBrightness)
    ? Math.min(1, Math.max(-1, benchmark.settings.grainBrightness))
    : 0;
  const grainContrast = Number.isFinite(benchmark.settings.grainContrast)
    ? Math.min(1, Math.max(-1, benchmark.settings.grainContrast))
    : 0;
  const grainInvert = benchmark.settings.grainInvert === true;
  const grainFiltering = benchmark.settings.grainFiltering === "no"
    || benchmark.settings.grainFiltering === "classic"
    ? benchmark.settings.grainFiltering
    : "improved";
  const startThickness = Number.isFinite(benchmark.settings.startThickness)
    ? Math.min(2, Math.max(0, benchmark.settings.startThickness))
    : 1;
  const endThickness = Number.isFinite(benchmark.settings.endThickness)
    ? Math.min(2, Math.max(0, benchmark.settings.endThickness))
    : 1;
  const blendStretch = Number.isFinite(benchmark.settings.blendStretch)
    ? Math.min(1, Math.max(0, benchmark.settings.blendStretch))
    : 0.18;
  const blendPaint = Number.isFinite(benchmark.settings.blendPaint)
    ? Math.min(1, Math.max(0, benchmark.settings.blendPaint))
    : 0.14;
  const settingsWithoutLegacyDynamics = {
    ...benchmark.settings,
  } as BrushSettings & {
    speedThickness?: unknown;
    pressureSize?: unknown;
    pressureOpacity?: unknown;
  };
  delete settingsWithoutLegacyDynamics.speedThickness;
  delete settingsWithoutLegacyDynamics.pressureSize;
  delete settingsWithoutLegacyDynamics.pressureOpacity;
  return {
    ...benchmark,
    settings: {
      ...settingsWithoutLegacyDynamics,
      tool: "paint",
      shape: benchmark.settings.shape === "shape" ? "shape" : "circle",
      shapeScatter: Number.isFinite(benchmark.settings.shapeScatter)
        ? Math.min(1, Math.max(0, benchmark.settings.shapeScatter))
        : 0,
      grainMode,
      grainScale,
      grainDepth,
      grainBrightness,
      grainContrast,
      grainInvert,
      grainFiltering,
      grainBlendMode: "multiply",
      startThickness,
      endThickness,
      opacity,
      blendMode,
      blendStretch,
      blendPaint,
    },
  };
}

function loadLegacyHumanStrokeBenchmark(): HumanStrokeBenchmark | null {
  try {
    const stored = window.localStorage.getItem(LEGACY_HUMAN_STROKE_STORAGE_KEY);
    if (!stored) {
      return null;
    }
    return parseHumanStrokeBenchmark(JSON.parse(stored));
  } catch {
    return null;
  }
}

function clearLegacyHumanStrokeBenchmark(): void {
  try {
    window.localStorage.removeItem(LEGACY_HUMAN_STROKE_STORAGE_KEY);
  } catch {}
}

async function requestCanonicalHumanStroke(): Promise<HumanStrokeBenchmark | null> {
  const response = await fetch(HUMAN_STROKE_API_URL, { cache: "no-store" });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error("Impossibile caricare il tratto umano di riferimento.");
  }
  return parseHumanStrokeBenchmark(await response.json());
}

async function saveCanonicalHumanStroke(benchmark: HumanStrokeBenchmark): Promise<HumanStrokeBenchmark> {
  const response = await fetch(HUMAN_STROKE_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(benchmark),
  });

  if (response.status === 409) {
    const existing = parseHumanStrokeBenchmark(await response.json());
    if (existing) {
      return existing;
    }
  }
  if (!response.ok) {
    throw new Error("Impossibile fissare il tratto umano di riferimento.");
  }
  const saved = parseHumanStrokeBenchmark(await response.json());
  if (!saved) {
    throw new Error("Il tratto umano salvato non è valido.");
  }
  return saved;
}

async function loadCanonicalHumanStroke(): Promise<void> {
  humanStrokeLoading = true;
  updateHumanStrokeControls();
  try {
    const canonical = await requestCanonicalHumanStroke();
    if (canonical) {
      humanStrokeBenchmark = canonical;
      clearLegacyHumanStrokeBenchmark();
      humanStrokeResult.textContent = describeHumanStrokeBenchmark(canonical);
      return;
    }

    const legacy = loadLegacyHumanStrokeBenchmark();
    if (legacy) {
      humanStrokeResult.textContent = "Fissaggio del tratto che avevi già registrato…";
      humanStrokeBenchmark = await saveCanonicalHumanStroke(legacy);
      clearLegacyHumanStrokeBenchmark();
      humanStrokeResult.textContent = describeHumanStrokeBenchmark(humanStrokeBenchmark);
      return;
    }

    humanStrokeResult.textContent = "Nessun tratto di riferimento: registralo una sola volta.";
  } catch (error) {
    humanStrokeResult.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    humanStrokeLoading = false;
    updateHumanStrokeControls();
  }
}

function setControlValue(id: string, value: string | number): void {
  element<HTMLInputElement | HTMLSelectElement>(id).value = String(value);
}

function rasterStrokeColorFromHex(value: string): RasterStrokeStyle["color"] {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (!match) {
    return [1, 0.643, 0.282, 1];
  }
  const packed = Number.parseInt(match[1], 16);
  return [
    ((packed >>> 16) & 0xff) / 255,
    ((packed >>> 8) & 0xff) / 255,
    (packed & 0xff) / 255,
    1,
  ];
}

function rasterStrokeColorToHex(color: RasterStrokeStyle["color"]): string {
  const channel = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${channel(color[0])}${channel(color[1])}${channel(color[2])}`;
}

function readRasterStrokeStyle(): RasterStrokeStyle {
  return {
    enabled: element<HTMLInputElement>("rasterStrokeEnabled").checked,
    width: rangeValue("rasterStrokeWidth"),
    position: element<HTMLSelectElement>("rasterStrokePosition")
      .value as RasterStrokeStyle["position"],
    color: rasterStrokeColorFromHex(element<HTMLInputElement>("rasterStrokeColor").value),
  };
}

function syncRasterStrokeControls(style: RasterStrokeStyle): void {
  element<HTMLInputElement>("rasterStrokeEnabled").checked = style.enabled;
  setControlValue("rasterStrokeWidth", style.width);
  setControlValue("rasterStrokePosition", style.position);
  setControlValue("rasterStrokeColor", rasterStrokeColorToHex(style.color));
  element<HTMLOutputElement>("rasterStrokeWidthOut").value = `${style.width.toFixed(0)} px`;
  element<HTMLElement>("rasterStrokeParameters").hidden = !style.enabled;
}

const rasterStrokeControlIds = [
  "rasterStrokeEnabled",
  "rasterStrokeWidth",
  "rasterStrokePosition",
  "rasterStrokeColor",
] as const;

function updateRasterStrokeControlAvailability(locked = interactionLocked()): void {
  const enabled = element<HTMLInputElement>("rasterStrokeEnabled").checked;
  element<HTMLElement>("rasterStrokeParameters").hidden = !enabled;
  for (const id of rasterStrokeControlIds) {
    element<HTMLInputElement | HTMLSelectElement>(id).disabled =
      locked || rasterStrokeChanging || (id !== "rasterStrokeEnabled" && !enabled);
  }
}

async function applyRasterStrokeControls(): Promise<void> {
  if (!engineInitialized || rasterStrokeChanging || activePointerId !== null) {
    syncRasterStrokeControls(engine.getRasterStrokeStyle());
    updateRasterStrokeControlAvailability();
    return;
  }
  rasterStrokeChanging = true;
  updateHistoryControls();
  updateHumanStrokeControls();
  try {
    const accepted = await engine.setRasterStrokeStyle(readRasterStrokeStyle());
    if (!accepted) {
      syncRasterStrokeControls(engine.getRasterStrokeStyle());
    }
  } catch {
    syncRasterStrokeControls(engine.getRasterStrokeStyle());
  } finally {
    rasterStrokeChanging = false;
    updateHistoryControls();
    updateHumanStrokeControls();
  }
}

function rasterBevelColorFromHex(
  value: string,
  fallback: RasterBevelStyle["highlightColor"],
): RasterBevelStyle["highlightColor"] {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (!match) {
    return [...fallback] as [number, number, number];
  }
  const packed = Number.parseInt(match[1], 16);
  return [
    ((packed >>> 16) & 0xff) / 255,
    ((packed >>> 8) & 0xff) / 255,
    (packed & 0xff) / 255,
  ];
}

function rasterBevelColorToHex(color: RasterBevelStyle["highlightColor"]): string {
  const channel = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${channel(color[0])}${channel(color[1])}${channel(color[2])}`;
}

function readRasterBevelStyle(): RasterBevelStyle {
  return {
    enabled: element<HTMLInputElement>("rasterBevelEnabled").checked,
    mode: element<HTMLSelectElement>("rasterBevelMode").value as RasterBevelStyle["mode"],
    technique: element<HTMLSelectElement>("rasterBevelTechnique")
      .value as RasterBevelStyle["technique"],
    direction: element<HTMLSelectElement>("rasterBevelDirection")
      .value as RasterBevelStyle["direction"],
    size: rangeValue("rasterBevelSize"),
    soften: rangeValue("rasterBevelSoften"),
    depth: rangeValue("rasterBevelDepth"),
    angle: rangeValue("rasterBevelAngle"),
    altitude: rangeValue("rasterBevelAltitude"),
    highlightColor: rasterBevelColorFromHex(
      element<HTMLInputElement>("rasterBevelHighlightColor").value,
      [1, 0.957, 0.875],
    ),
    highlightOpacity: rangeValue("rasterBevelHighlightOpacity"),
    shadowColor: rasterBevelColorFromHex(
      element<HTMLInputElement>("rasterBevelShadowColor").value,
      [0.141, 0.078, 0.035],
    ),
    shadowOpacity: rangeValue("rasterBevelShadowOpacity"),
    gloss: element<HTMLSelectElement>("rasterBevelGloss")
      .value as RasterBevelStyle["gloss"],
    contourAA: element<HTMLInputElement>("rasterBevelContourAA").checked,
    bevelContourEnabled: element<HTMLInputElement>("rasterBevelContourEnabled").checked,
    bevelContour: element<HTMLSelectElement>("rasterBevelContour")
      .value as RasterBevelStyle["bevelContour"],
    bevelRange: rangeValue("rasterBevelRange"),
    fill: rangeValue("rasterBevelFill"),
  };
}

function updateRasterBevelOutputs(): void {
  element<HTMLOutputElement>("rasterBevelSizeOut").value =
    `${rangeValue("rasterBevelSize").toFixed(1).replace(".0", "")} px`;
  element<HTMLOutputElement>("rasterBevelSoftenOut").value =
    `${rangeValue("rasterBevelSoften").toFixed(1).replace(".0", "")} px`;
  for (const id of ["Depth", "Range", "Fill", "HighlightOpacity", "ShadowOpacity"] as const) {
    element<HTMLOutputElement>(`rasterBevel${id}Out`).value =
      `${rangeValue(`rasterBevel${id}`).toFixed(0)}%`;
  }
  element<HTMLOutputElement>("rasterBevelAngleOut").value =
    `${rangeValue("rasterBevelAngle").toFixed(0)}°`;
  element<HTMLOutputElement>("rasterBevelAltitudeOut").value =
    `${rangeValue("rasterBevelAltitude").toFixed(0)}°`;
}

function syncRasterBevelControls(style: RasterBevelStyle): void {
  element<HTMLInputElement>("rasterBevelEnabled").checked = style.enabled;
  setControlValue("rasterBevelMode", style.mode);
  setControlValue("rasterBevelTechnique", style.technique);
  setControlValue("rasterBevelDirection", style.direction);
  setControlValue("rasterBevelSize", style.size);
  setControlValue("rasterBevelSoften", style.soften);
  setControlValue("rasterBevelDepth", style.depth);
  setControlValue("rasterBevelAngle", style.angle);
  setControlValue("rasterBevelAltitude", style.altitude);
  setControlValue("rasterBevelHighlightColor", rasterBevelColorToHex(style.highlightColor));
  setControlValue("rasterBevelHighlightOpacity", style.highlightOpacity);
  setControlValue("rasterBevelShadowColor", rasterBevelColorToHex(style.shadowColor));
  setControlValue("rasterBevelShadowOpacity", style.shadowOpacity);
  setControlValue("rasterBevelGloss", style.gloss);
  element<HTMLInputElement>("rasterBevelContourAA").checked = style.contourAA;
  element<HTMLInputElement>("rasterBevelContourEnabled").checked = style.bevelContourEnabled;
  setControlValue("rasterBevelContour", style.bevelContour);
  setControlValue("rasterBevelRange", style.bevelRange);
  setControlValue("rasterBevelFill", style.fill);
  element<HTMLElement>("rasterBevelParameters").hidden = !style.enabled;
  updateRasterBevelOutputs();
}

const rasterBevelControlIds = [
  "rasterBevelEnabled",
  "rasterBevelMode",
  "rasterBevelTechnique",
  "rasterBevelDirection",
  "rasterBevelSize",
  "rasterBevelSoften",
  "rasterBevelDepth",
  "rasterBevelAngle",
  "rasterBevelAltitude",
  "rasterBevelGloss",
  "rasterBevelContourAA",
  "rasterBevelContourEnabled",
  "rasterBevelContour",
  "rasterBevelRange",
  "rasterBevelFill",
  "rasterBevelHighlightColor",
  "rasterBevelHighlightOpacity",
  "rasterBevelShadowColor",
  "rasterBevelShadowOpacity",
] as const;

function updateRasterBevelControlAvailability(locked = interactionLocked()): void {
  const enabled = element<HTMLInputElement>("rasterBevelEnabled").checked;
  const contourEnabled = element<HTMLInputElement>("rasterBevelContourEnabled").checked;
  element<HTMLElement>("rasterBevelParameters").hidden = !enabled;
  for (const id of rasterBevelControlIds) {
    const contourControl = id === "rasterBevelContour" || id === "rasterBevelRange";
    element<HTMLInputElement | HTMLSelectElement>(id).disabled =
      locked
      || rasterBevelChanging
      || (id !== "rasterBevelEnabled" && !enabled)
      || (contourControl && !contourEnabled);
  }
}

async function applyRasterBevelControls(): Promise<void> {
  if (!engineInitialized || rasterBevelChanging || activePointerId !== null) {
    syncRasterBevelControls(engine.getRasterBevelStyle());
    updateRasterBevelControlAvailability();
    return;
  }
  rasterBevelChanging = true;
  updateHistoryControls();
  updateHumanStrokeControls();
  try {
    const accepted = await engine.setRasterBevelStyle(readRasterBevelStyle());
    if (!accepted) {
      syncRasterBevelControls(engine.getRasterBevelStyle());
    }
  } catch {
    syncRasterBevelControls(engine.getRasterBevelStyle());
  } finally {
    rasterBevelChanging = false;
    updateHistoryControls();
    updateHumanStrokeControls();
  }
}

function applySettingsToControls(settings: BrushSettings): void {
  const tool = settings.tool === "blend" ? "blend" : "paint";
  configureBrushToolUi(tool, false);
  setControlValue("brushShape", settings.shape === "shape" ? "shape" : "circle");
  setControlValue("shapeScatter", (settings.shapeScatter ?? 0) * 100);
  setControlValue(
    "grainMode",
    settings.grainMode === "texturized" || settings.grainMode === "moving"
      ? settings.grainMode
      : "off",
  );
  setControlValue("grainScale", (settings.grainScale ?? 1.4) * 100);
  setControlValue("grainDepth", (settings.grainDepth ?? 1) * 100);
  setControlValue("grainBrightness", (settings.grainBrightness ?? 0) * 100);
  setControlValue("grainContrast", (settings.grainContrast ?? 0) * 100);
  element<HTMLInputElement>("grainInvert").checked = settings.grainInvert === true;
  setControlValue(
    "grainFiltering",
    settings.grainFiltering === "no" || settings.grainFiltering === "classic"
      ? settings.grainFiltering
      : "improved",
  );
  setControlValue("grainBlendMode", "multiply");
  setControlValue("brushColor", settings.color);
  setControlValue("brushSize", settings.size);
  setControlValue("spacing", settings.spacingPercent);
  setControlValue("startThickness", (settings.startThickness ?? 1) * 100);
  setControlValue("endThickness", (settings.endThickness ?? 1) * 100);
  setControlValue("count", settings.count);
  setControlValue("flow", settings.flow * 100);
  setControlValue("opacity", (settings.opacity ?? 1) * 100);
  setControlValue("hardness", settings.hardness * 100);
  setControlValue("blendIntensity", settings.blendIntensity);
  setControlValue("blendMode", settings.blendMode);
  setControlValue("blendStretch", (settings.blendStretch ?? 0.18) * 100);
  setControlValue("blendPaint", (settings.blendPaint ?? 0.14) * 100);
  setControlValue("jitterMaster", settings.jitterMaster * 100);
  setControlValue("hueJitter", settings.hueJitterDegrees);
  setControlValue("saturationJitter", settings.saturationJitter * 100);
  setControlValue("lightnessJitter", settings.lightnessJitter * 100);
  setControlValue("darknessJitter", settings.darknessJitter * 100);
  element<HTMLInputElement>("jitterPerCopy").checked = settings.jitterPerCopy;
  setControlValue("positionJitterLateral", settings.positionJitterLateral * 100);
  setControlValue("positionJitterLinear", settings.positionJitterLinear * 100);
  applyBrushControls();
}

function applyHumanStrokePreset(): BrushSettings {
  configureBrushToolUi("paint", false);
  setControlValue("brushShape", "circle");
  setControlValue("shapeScatter", 0);
  setControlValue("grainMode", "off");
  setControlValue("grainScale", 140);
  setControlValue("grainDepth", 100);
  setControlValue("grainBrightness", 0);
  setControlValue("grainContrast", 0);
  element<HTMLInputElement>("grainInvert").checked = false;
  setControlValue("grainFiltering", "improved");
  setControlValue("grainBlendMode", "multiply");
  setControlValue("brushSize", 750);
  setControlValue("spacing", 1);
  setControlValue("startThickness", 100);
  setControlValue("endThickness", 100);
  setControlValue("count", 16);
  setControlValue("flow", 100);
  setControlValue("opacity", 100);
  setControlValue("hardness", 100);
  setControlValue("blendIntensity", 4);
  setControlValue("blendMode", "normal");
  setControlValue("blendStretch", 18);
  setControlValue("blendPaint", 14);
  setControlValue("jitterMaster", 100);
  setControlValue("hueJitter", 180);
  setControlValue("saturationJitter", 100);
  element<HTMLInputElement>("jitterPerCopy").checked = true;
  setControlValue("positionJitterLateral", 100);
  setControlValue("positionJitterLinear", 100);
  applyBrushControls();
  return readBrushSettings();
}

function selectedHumanStrokeTestVariant(): HumanStrokeTestVariant {
  return humanStrokeTestVariantSelect.value === "fur" ? "fur" : "base";
}

function selectedHumanStrokeTestBlendMode(): HumanStrokeTestBlendMode {
  return humanStrokeTestBlendModeSelect.value === "m1-glaze" ? "m1-glaze" : "normal";
}

function selectedHumanStrokeTestGrainMode(): HumanStrokeTestGrainMode {
  return humanStrokeTestGrainModeSelect.value === "texturized" ? "texturized" : "off";
}

function humanStrokeTestSettings(
  benchmark: HumanStrokeBenchmark,
  variant: HumanStrokeTestVariant,
  blendMode: HumanStrokeTestBlendMode,
  grainMode: HumanStrokeTestGrainMode,
): BrushSettings {
  const baseSettings: BrushSettings = {
    ...benchmark.settings,
    tool: "paint",
    opacity: 1,
    blendIntensity: blendMode === "m1-glaze" ? 1 : 4,
    blendMode,
    blendStretch: 0.18,
    blendPaint: 0.14,
    grainMode,
    grainScale: 1.4,
    grainDepth: 1,
    grainBrightness: 0,
    grainContrast: 0,
    grainInvert: false,
    grainFiltering: "improved",
    grainBlendMode: "multiply",
    shape: "circle",
    shapeScatter: 0,
    startThickness: 1,
    endThickness: 1,
    positionJitterLateral: 1,
    positionJitterLinear: 1,
  };

  if (variant === "fur") {
    return {
      ...baseSettings,
      shape: "shape",
      shapeScatter: 1,
      positionJitterLateral: 0,
      positionJitterLinear: 0,
    };
  }

  return baseSettings;
}

function humanStrokeBlendTestSettings(benchmark: HumanStrokeBenchmark): BrushSettings {
  return {
    ...benchmark.settings,
    tool: "blend",
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
    size: benchmark.settings.size,
    spacingPercent: 1,
    startThickness: 1,
    endThickness: 1,
    count: 1,
    flow: 1,
    opacity: 1,
    hardness: 1,
    blendIntensity: 1,
    blendMode: "normal",
    blendStretch: 0.2,
    blendPaint: 0,
    jitterMaster: 0,
    hueJitterDegrees: 0,
    saturationJitter: 0,
    lightnessJitter: 0,
    darknessJitter: 0,
    jitterPerCopy: false,
    positionJitterLateral: 0,
    positionJitterLinear: 0,
  };
}

function humanStrokeTestLabel(
  variant: HumanStrokeTestVariant,
  blendMode: HumanStrokeTestBlendMode,
  grainMode: HumanStrokeTestGrainMode,
): string {
  const variantLabel = variant === "fur" ? "Fur" : "Base";
  const blendLabel = blendMode === "m1-glaze"
    ? "M1 Glaze non accumulativo · 1×"
    : "Normal accumulativo · 4×";
  const grainLabel = grainMode === "texturized" ? "Grain Fixed M1" : "Grain Off";
  return `${variantLabel} · ${blendLabel} · ${grainLabel}`;
}

const BLEND_REPLAY_LABEL =
  "Blend dry · sfondo multicolore · spacing 1% · flow 100% · hardness 100% · Paint 0% · Stretch 20%";

async function prepareBlendBenchmarkBackground(replaySettings: BrushSettings): Promise<void> {
  const palette = [
    "#ff334f",
    "#ff9f1c",
    "#f4e04d",
    "#20c997",
    "#2d7ff9",
    "#8b5cf6",
  ] as const;
  const backgroundSettings: BrushSettings = {
    ...replaySettings,
    tool: "paint",
    shape: "circle",
    shapeScatter: 0,
    grainMode: "off",
    size: 1500,
    spacingPercent: 15,
    startThickness: 1,
    endThickness: 1,
    count: 1,
    flow: 1,
    opacity: 1,
    hardness: 1,
    blendIntensity: 1,
    blendMode: "normal",
    jitterMaster: 0,
    hueJitterDegrees: 0,
    saturationJitter: 0,
    lightnessJitter: 0,
    darknessJitter: 0,
    jitterPerCopy: false,
    positionJitterLateral: 0,
    positionJitterLinear: 0,
  };

  try {
    for (let index = 0; index < palette.length; index += 1) {
      const y = engine.layerSize * index / (palette.length - 1);
      const timeMs = index * 10;
      engine.setBrushSettings({ ...backgroundSettings, color: palette[index] });
      engine.beginStrokeAtLayer({ x: 0, y, pressure: 1, timeMs });
      engine.extendStrokeAtLayer([
        { x: engine.layerSize, y, pressure: 1, timeMs: timeMs + 1 },
      ]);
      engine.endStroke(timeMs + 1);
      await engine.waitForIdle();
    }
  } finally {
    engine.setBrushSettings(replaySettings);
    await engine.waitForIdle();
  }
}

function updateHumanStrokeControls(): void {
  const operationLocked = !engineInitialized
    || historyUiBusy
    || historyState.busy
    || benchmarkRunning
    || rasterStrokeGoldenRunning
    || effectsWorkbenchBenchmarkRunning
    || layerFormatChanging
    || rasterStrokeChanging
    || rasterBevelChanging;
  recordHumanStrokeButton.disabled = operationLocked
    || humanStrokeLoading
    || humanStrokeSaving
    || humanStrokeReplaying
    || Boolean(humanStrokeBenchmark);
  recordHumanStrokeButton.textContent = humanStrokeRecordingArmed
    ? "Annulla registrazione tratto"
    : humanStrokeBenchmark
      ? "Tratto umano fissato"
      : "Registra tratto umano";
  playHumanStrokeButton.disabled = operationLocked
    || !humanStrokeBenchmark
    || humanStrokeLoading
    || humanStrokeSaving
    || humanStrokeReplaying;
  playBlendHumanStrokeButton.disabled = operationLocked
    || !humanStrokeBenchmark
    || humanStrokeLoading
    || humanStrokeSaving
    || humanStrokeReplaying;
  humanStrokeTestVariantSelect.disabled = operationLocked
    || humanStrokeLoading
    || humanStrokeSaving
    || humanStrokeReplaying
    || humanStrokeRecordingArmed
    || Boolean(humanStrokeRecording);
  humanStrokeTestBlendModeSelect.disabled = operationLocked
    || humanStrokeLoading
    || humanStrokeSaving
    || humanStrokeReplaying
    || humanStrokeRecordingArmed
    || Boolean(humanStrokeRecording);
  humanStrokeTestGrainModeSelect.disabled = operationLocked
    || humanStrokeLoading
    || humanStrokeSaving
    || humanStrokeReplaying
    || humanStrokeRecordingArmed
    || Boolean(humanStrokeRecording);
}

function operationLocked(): boolean {
  return !engineInitialized
    || historyUiBusy
    || historyState.busy
    || benchmarkRunning
    || rasterStrokeGoldenRunning
    || effectsWorkbenchBenchmarkRunning
    || layerFormatChanging
    || rasterStrokeChanging
    || rasterBevelChanging
    || humanStrokeReplaying
    || humanStrokeSaving;
}

function interactionLocked(): boolean {
  return operationLocked() || activePointerId !== null;
}

function updateHistoryControls(): void {
  const locked = interactionLocked();
  undoStrokeButton.disabled = locked || !historyState.canUndo;
  redoStrokeButton.disabled = locked || !historyState.canRedo;
  clearLayerButton.disabled = locked;
  const blendToolActive = activeBrushTool === "blend";
  benchmarkButton.disabled = locked || blendToolActive;
  benchmarkStampsInput.disabled = locked || blendToolActive;
  rasterStrokeGoldenButton.disabled = locked;
  effectsWorkbenchBenchmarkButton.disabled = locked;
  layerFormatSelect.disabled = locked;
  fitViewButton.disabled = locked;
  zoomInButton.disabled = locked;
  zoomOutButton.disabled = locked;
  toggleControlsButton.disabled =
    benchmarkRunning || rasterStrokeGoldenRunning
    || effectsWorkbenchBenchmarkRunning || humanStrokeReplaying;
  for (const id of brushControlIds) {
    element<HTMLInputElement | HTMLSelectElement>(id).disabled = locked;
  }
  updateGrainControlAvailability(locked);
  updateRasterStrokeControlAvailability(locked);
  updateRasterBevelControlAvailability(locked);
}

async function runHistoryOperation(operation: "undo" | "redo"): Promise<void> {
  if (interactionLocked() || activePointerId !== null) {
    return;
  }
  if (operation === "undo" ? !historyState.canUndo : !historyState.canRedo) {
    return;
  }

  historyUiBusy = true;
  updateHistoryControls();
  updateHumanStrokeControls();
  try {
    if (operation === "undo") {
      await engine.undo();
    } else {
      await engine.redo();
    }
  } catch (error) {
    statusElement.textContent = error instanceof Error ? error.message : String(error);
    statusElement.className = "status error";
  } finally {
    historyUiBusy = false;
    historyState = engine.getHistoryState();
    updateHistoryControls();
    updateHumanStrokeControls();
  }
}

async function clearLayerWithHistory(): Promise<void> {
  if (interactionLocked() || activePointerId !== null) {
    return;
  }

  historyUiBusy = true;
  updateHistoryControls();
  updateHumanStrokeControls();
  try {
    await engine.clear();
  } catch (error) {
    statusElement.textContent = error instanceof Error ? error.message : String(error);
    statusElement.className = "status error";
  } finally {
    historyUiBusy = false;
    historyState = engine.getHistoryState();
    updateHistoryControls();
    updateHumanStrokeControls();
  }
}

function describeHumanStrokeBenchmark(benchmark: HumanStrokeBenchmark): string {
  const duration = benchmark.points.at(-1)?.timeMs ?? 0;
  return [
    `Tratto salvato: ${formatInteger(benchmark.points.length)} campioni`,
    `durata ${formatDuration(duration)}`,
    `size ${benchmark.settings.size.toFixed(0)} px`,
    `Count ${benchmark.settings.count}`,
  ].join(" · ");
}

const grainParameterControlIds = [
  "grainScale",
  "grainDepth",
  "grainBrightness",
  "grainContrast",
  "grainInvert",
  "grainFiltering",
  "grainBlendMode",
] as const;

function updateGrainControlAvailability(locked = interactionLocked()): void {
  const grainMode = element<HTMLSelectElement>("grainMode").value;
  const active = grainMode === "texturized" || grainMode === "moving";
  element<HTMLElement>("grainParameters").hidden = !active;
  for (const id of grainParameterControlIds) {
    element<HTMLInputElement | HTMLSelectElement>(id).disabled =
      locked || !active || (id === "grainScale" && grainMode === "moving");
  }
}

const brushControlIds = [
  "brushTool",
  "brushShape",
  "shapeScatter",
  "grainMode",
  ...grainParameterControlIds,
  "brushColor",
  "brushSize",
  "spacing",
  "startThickness",
  "endThickness",
  "count",
  "flow",
  "opacity",
  "hardness",
  "blendIntensity",
  "blendMode",
  "blendStretch",
  "blendPaint",
  "jitterMaster",
  "hueJitter",
  "saturationJitter",
  "lightnessJitter",
  "darknessJitter",
  "jitterPerCopy",
  "positionJitterLateral",
  "positionJitterLinear",
] as const;

for (const id of brushControlIds) {
  if (id === "brushTool") {
    continue;
  }
  element<HTMLInputElement | HTMLSelectElement>(id).addEventListener("input", applyBrushControls);
  element<HTMLInputElement | HTMLSelectElement>(id).addEventListener("change", applyBrushControls);
}

element<HTMLInputElement>("rasterStrokeEnabled").addEventListener("change", () => {
  updateRasterStrokeControlAvailability();
  void applyRasterStrokeControls();
});
element<HTMLInputElement>("rasterStrokeWidth").addEventListener("input", () => {
  element<HTMLOutputElement>("rasterStrokeWidthOut").value =
    `${rangeValue("rasterStrokeWidth").toFixed(0)} px`;
});
element<HTMLInputElement>("rasterStrokeWidth").addEventListener("change", () => {
  void applyRasterStrokeControls();
});
element<HTMLSelectElement>("rasterStrokePosition").addEventListener("change", () => {
  void applyRasterStrokeControls();
});
element<HTMLInputElement>("rasterStrokeColor").addEventListener("change", () => {
  void applyRasterStrokeControls();
});

element<HTMLInputElement>("rasterBevelEnabled").addEventListener("change", () => {
  updateRasterBevelControlAvailability();
  void applyRasterBevelControls();
});
element<HTMLInputElement>("rasterBevelContourEnabled").addEventListener("change", () => {
  updateRasterBevelControlAvailability();
  void applyRasterBevelControls();
});

const rasterBevelRangeIds = [
  "rasterBevelSize",
  "rasterBevelSoften",
  "rasterBevelDepth",
  "rasterBevelAngle",
  "rasterBevelAltitude",
  "rasterBevelRange",
  "rasterBevelFill",
  "rasterBevelHighlightOpacity",
  "rasterBevelShadowOpacity",
] as const;
for (const id of rasterBevelRangeIds) {
  element<HTMLInputElement>(id).addEventListener("input", updateRasterBevelOutputs);
  element<HTMLInputElement>(id).addEventListener("change", () => {
    void applyRasterBevelControls();
  });
}

const rasterBevelChangeControlIds = [
  "rasterBevelMode",
  "rasterBevelTechnique",
  "rasterBevelDirection",
  "rasterBevelGloss",
  "rasterBevelContourAA",
  "rasterBevelContour",
  "rasterBevelHighlightColor",
  "rasterBevelShadowColor",
] as const;
for (const id of rasterBevelChangeControlIds) {
  element<HTMLInputElement | HTMLSelectElement>(id).addEventListener("change", () => {
    void applyRasterBevelControls();
  });
}

element<HTMLSelectElement>("brushTool").addEventListener("change", () => {
  const tool = element<HTMLSelectElement>("brushTool").value === "blend" ? "blend" : "paint";
  configureBrushToolUi(tool, true);
  applyBrushControls();
  updateHistoryControls();
});

benchmarkStampsInput.addEventListener("input", updateControlOutputs);

toggleControlsButton.addEventListener("click", () => {
  if (!toggleControlsButton.disabled) {
    setControlsPanelOpen(!controlsPanelOpen);
  }
});
gpuMemoryToggle.addEventListener("click", () => {
  setGpuMemoryPanelOpen(!gpuMemoryPanelOpen);
});
gpuMemoryClose.addEventListener("click", () => {
  setGpuMemoryPanelOpen(false);
  gpuMemoryToggle.focus();
});
clearLayerButton.addEventListener("click", () => {
  void clearLayerWithHistory();
});
undoStrokeButton.addEventListener("click", () => {
  void runHistoryOperation("undo");
});
redoStrokeButton.addEventListener("click", () => {
  void runHistoryOperation("redo");
});
fitViewButton.addEventListener("click", () => {
  if (!interactionLocked() && activePointerId === null) {
    engine.fitView();
  }
});
zoomInButton.addEventListener("click", () => {
  if (!interactionLocked() && activePointerId === null) {
    engine.zoomBy(1.35);
  }
});
zoomOutButton.addEventListener("click", () => {
  if (!interactionLocked() && activePointerId === null) {
    engine.zoomBy(1 / 1.35);
  }
});

layerFormatSelect.addEventListener("change", async () => {
  if (interactionLocked() || activePointerId !== null) {
    layerFormatSelect.value = engine.getStats().layerFormat;
    return;
  }
  const requested = layerFormatSelect.value as LayerFormat;
  layerFormatChanging = true;
  layerFormatSelect.disabled = true;
  updateHistoryControls();
  updateHumanStrokeControls();
  try {
    const changed = await engine.setLayerFormat(requested);
    if (!changed) {
      layerFormatSelect.value = engine.getStats().layerFormat;
    }
  } catch {
    layerFormatSelect.value = engine.getStats().layerFormat;
  } finally {
    layerFormatChanging = false;
    syncRasterStrokeControls(engine.getRasterStrokeStyle());
    syncRasterBevelControls(engine.getRasterBevelStyle());
    historyState = engine.getHistoryState();
    updateHistoryControls();
    updateHumanStrokeControls();
  }
});

benchmarkButton.addEventListener("click", async () => {
  if (interactionLocked()) {
    return;
  }
  setControlsPanelOpen(false);
  benchmarkRunning = true;
  benchmarkButton.disabled = true;
  updateHistoryControls();
  updateHumanStrokeControls();
  benchmarkResult.textContent = "Benchmark in esecuzione sulla GPU…";
  try {
    const result = await engine.runBenchmark(rangeValue("benchmarkStamps"));
    benchmarkResult.textContent = [
      `${formatInteger(result.baseStamps)} base stamps`,
      `${formatInteger(result.logicalCopies)} copie logiche`,
      `CPU submit ${result.cpuSubmitMs.toFixed(2)} ms`,
      `GPU completion ${result.gpuCompletionMs.toFixed(2)} ms`,
      `copertura teorica ${(result.estimatedCoveredFragments / 1_000_000).toFixed(1)} Mpx`,
      result.strategy,
    ].join(" · ");
  } catch (error) {
    benchmarkResult.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    benchmarkRunning = false;
    benchmarkButton.disabled = false;
    historyState = engine.getHistoryState();
    updateHistoryControls();
    updateHumanStrokeControls();
  }
});

{
  rasterStrokeGoldenSection.hidden = false;
  rasterStrokeGoldenButton.addEventListener("click", async () => {
    if (interactionLocked()) {
      return;
    }
    rasterStrokeGoldenRunning = true;
    rasterStrokeGoldenDetails.hidden = true;
    rasterStrokeGoldenButton.disabled = true;
    rasterStrokeGoldenResult.textContent = "Cattura golden pixel sulla GPU…";
    updateHistoryControls();
    updateHumanStrokeControls();
    try {
      const report = await engine.runRasterStrokeGolden();
      const serialized = JSON.stringify(report, null, 2);
      rasterStrokeGoldenReport.textContent = serialized;
      rasterStrokeGoldenDetails.hidden = false;
      let copied = false;
      try {
        await navigator.clipboard.writeText(serialized);
        copied = true;
      } catch {
        // Il report resta visibile e disponibile sull'oggetto window di sviluppo.
      }
      (
        window as Window & { __rasterStrokeGoldenReport?: typeof report }
      ).__rasterStrokeGoldenReport = report;
      rasterStrokeGoldenResult.textContent =
        (report.baselineMatches ? "Golden identico" : "Golden diverso")
        + " · v" + report.version + " · " + report.combinedSha256
        + " · " + report.cases.length + " casi"
        + " · diagnostica " + (report.diagnosticsMatch ? "OK" : "fallita")
        + " (" + report.diagnostics.length + ")"
        + (report.baselineMatches
          ? ""
          : " · differenze: " + report.baselineMismatches.join(", "))
        + (copied ? " · report copiato" : "");
    } catch (error) {
      rasterStrokeGoldenResult.textContent =
        error instanceof Error ? error.message : String(error);
    } finally {
      rasterStrokeGoldenRunning = false;
      updateHistoryControls();
      updateHumanStrokeControls();
    }
  });
}

if (import.meta.env.DEV) {
  effectsWorkbenchBenchmarkButton.hidden = false;
  effectsWorkbenchBenchmarkResult.hidden = false;
  effectsWorkbenchBenchmarkResult.textContent =
    "Benchmark dev isolato: Traccia e Smusso devono essere disattivati.";
  effectsWorkbenchBenchmarkButton.addEventListener("click", async () => {
    if (interactionLocked()) {
      return;
    }
    effectsWorkbenchBenchmarkRunning = true;
    effectsWorkbenchBenchmarkDetails.hidden = true;
    effectsWorkbenchBenchmarkResult.textContent =
      "Misuro retarget e destroy+recreate sul documento 4096²…";
    updateHistoryControls();
    updateHumanStrokeControls();
    try {
      const report = await engine.benchmarkEffectsWorkingSet(5);
      const serialized = JSON.stringify(report, null, 2);
      effectsWorkbenchBenchmarkReport.textContent = serialized;
      effectsWorkbenchBenchmarkDetails.hidden = false;
      (
        window as Window & { __effectsWorkbenchBenchmarkReport?: typeof report }
      ).__effectsWorkbenchBenchmarkReport = report;
      const smallOff = report.scenarios.find((scenario) =>
        scenario.contentId === "small-1000x800" && !scenario.boundingFieldEnabled
      );
      const smallOn = report.scenarios.find((scenario) =>
        scenario.contentId === "small-1000x800" && scenario.boundingFieldEnabled
      );
      if (!smallOff || !smallOn) {
        throw new Error("Il benchmark non ha prodotto la coppia small OFF/ON.");
      }
      effectsWorkbenchBenchmarkResult.textContent =
        `Small retarget OFF ${smallOff.retarget.totalMedianMs.toFixed(2)} ms`
        + ` · ON ${smallOn.retarget.totalMedianMs.toFixed(2)} ms`
        + ` · ${report.scenarios.length} scenari × ${report.sampleCount} campioni`;
    } catch (error) {
      effectsWorkbenchBenchmarkResult.textContent =
        error instanceof Error ? error.message : String(error);
    } finally {
      effectsWorkbenchBenchmarkRunning = false;
      updateHistoryControls();
      updateHumanStrokeControls();
    }
  });
}

recordHumanStrokeButton.addEventListener("click", () => {
  if (
    interactionLocked()
    || humanStrokeLoading
    || humanStrokeSaving
    || humanStrokeReplaying
    || humanStrokeRecording
    || humanStrokeBenchmark
  ) {
    return;
  }

  humanStrokeRecordingArmed = !humanStrokeRecordingArmed;
  if (humanStrokeRecordingArmed) {
    applyHumanStrokePreset();
    setControlsPanelOpen(false);
    humanStrokeResult.textContent = "Preset umano applicato. Disegna ora una sola pennellata sul canvas.";
  } else {
    humanStrokeResult.textContent = humanStrokeBenchmark
      ? describeHumanStrokeBenchmark(humanStrokeBenchmark)
      : "Registrazione annullata.";
  }
  updateHumanStrokeControls();
});

playHumanStrokeButton.addEventListener("click", () => {
  void replayHumanStroke();
});

playBlendHumanStrokeButton.addEventListener("click", () => {
  void replayHumanStroke("blend");
});

function updateGpuMemoryPanel(stats: EngineStats): void {
  for (const [id, key] of gpuMemoryRows) {
    const output = element<HTMLElement>(id);
    const value = stats.gpuMemory[key];
    output.textContent = formatMemoryMiB(value);
    output.parentElement?.classList.toggle("memory-zero", value < 0.05);
  }

  const scratchExtents: string[] = [];
  if (stats.gpuMemory.effectsScratchStrokeExtent > 0) {
    scratchExtents.push(`Traccia ${stats.gpuMemory.effectsScratchStrokeExtent}²`);
  }
  if (stats.gpuMemory.effectsScratchBevelExtent > 0) {
    scratchExtents.push(`Smusso ${stats.gpuMemory.effectsScratchBevelExtent}²`);
  }
  element<HTMLElement>("gpuMemoryEffectsScratchLabel").textContent = scratchExtents.length > 0
    ? `Effetti · pool scratch · ${scratchExtents.join(" / ")}`
    : "Effetti · pool scratch";

  const fieldBoundsLabel = (
    bounds: Readonly<{ x: number; y: number; width: number; height: number }>,
  ): string => `${bounds.width}×${bounds.height} @ ${bounds.x},${bounds.y}`;
  const allocation = stats.gpuMemory.rasterBevelFieldAllocationBounds;
  const valid = stats.gpuMemory.rasterBevelFieldValidBounds;
  let bevelHeightLabel = "Smusso · heightfield R32F · documento 4096×4096";
  if (stats.gpuMemory.rasterBevelFieldBounded) {
    if (!valid) {
      bevelHeightLabel = allocation
        ? `Smusso · heightfield R32F · vuoto · alloc ${fieldBoundsLabel(allocation)}`
        : "Smusso · heightfield R32F · vuoto";
    } else if (
      allocation
      && allocation.x === valid.x
      && allocation.y === valid.y
      && allocation.width === valid.width
      && allocation.height === valid.height
    ) {
      bevelHeightLabel = `Smusso · heightfield R32F · bbox ${fieldBoundsLabel(valid)}`;
    } else {
      bevelHeightLabel = `Smusso · heightfield R32F · valido ${fieldBoundsLabel(valid)}`
        + (allocation ? ` · alloc ${fieldBoundsLabel(allocation)}` : "");
    }
  }
  element<HTMLElement>("gpuMemoryBevelHeightLabel").textContent = bevelHeightLabel;

  const totalMiB = stats.gpuMemory.countedTotalMiB;
  const formattedTotal = formatMemoryMiB(totalMiB);
  element<HTMLElement>("gpuMemoryTotal").textContent = formattedTotal;
  element<HTMLElement>("gpuMemoryCompact").textContent = formattedTotal;
  element<HTMLElement>("memoryStat").textContent = formattedTotal;

  if (!engineInitialized) {
    previousGpuMemoryTotalMiB = null;
    gpuMemoryDelta.hidden = true;
    return;
  }

  if (previousGpuMemoryTotalMiB !== null) {
    const deltaMiB = totalMiB - previousGpuMemoryTotalMiB;
    if (Math.abs(deltaMiB) >= 0.05) {
      gpuMemoryDelta.textContent = (deltaMiB > 0 ? "+" : "−")
        + memoryNumberFormatter.format(Math.abs(deltaMiB))
        + " MiB";
      gpuMemoryDelta.classList.toggle("decrease", deltaMiB < 0);
      gpuMemoryDelta.hidden = false;
      if (gpuMemoryDeltaTimer !== null) {
        window.clearTimeout(gpuMemoryDeltaTimer);
      }
      gpuMemoryDeltaTimer = window.setTimeout(() => {
        gpuMemoryDelta.hidden = true;
        gpuMemoryDeltaTimer = null;
      }, 3500);
    }
  }
  previousGpuMemoryTotalMiB = totalMiB;
}

function updateStats(stats: EngineStats): void {
  element<HTMLElement>("fpsStat").textContent = String(stats.fps);
  element<HTMLElement>("cpuStat").textContent = stats.lastCpuFrameMs.toFixed(2) + " ms";
  element<HTMLElement>("stampStat").textContent = formatInteger(stats.totalBaseStamps);
  element<HTMLElement>("avoidedStat").textContent = formatInteger(stats.avoidedLogicalDraws);
  updateGpuMemoryPanel(stats);
  element<HTMLElement>("gpuStat").textContent = stats.gpuLabel;
}

function startHumanStrokeRecording(event: PointerEvent, sample: PointerSample): void {
  const settings = applyHumanStrokePreset();
  const point = engine.toLayerPoint(sample);
  humanStrokeRecording = {
    settings,
    startTimestamp: event.timeStamp,
    points: [{ ...point, timeMs: 0 }],
  };
  humanStrokeResult.textContent = "Registrazione in corso…";
}

function captureHumanStrokeSamples(events: readonly PointerEvent[], samples: readonly PointerSample[]): void {
  const recording = humanStrokeRecording;
  if (!recording) {
    return;
  }

  for (let index = 0; index < samples.length; index += 1) {
    const previousTime = recording.points[recording.points.length - 1]?.timeMs ?? 0;
    const elapsed = Math.max(previousTime, events[index].timeStamp - recording.startTimestamp, 0);
    recording.points.push({
      ...engine.toLayerPoint(samples[index]),
      timeMs: elapsed,
    });
  }
}

async function finishHumanStrokeRecording(shouldSave: boolean): Promise<void> {
  const recording = humanStrokeRecording;
  humanStrokeRecording = null;
  humanStrokeRecordingArmed = false;

  if (recording && shouldSave && recording.points.length > 1) {
    const benchmark: HumanStrokeBenchmark = {
      version: 1,
      capturedAt: new Date().toISOString(),
      settings: recording.settings,
      points: recording.points,
    };
    humanStrokeSaving = true;
    humanStrokeResult.textContent = "Fissaggio permanente del tratto di riferimento…";
    updateHumanStrokeControls();
    try {
      humanStrokeBenchmark = await saveCanonicalHumanStroke(benchmark);
      clearLegacyHumanStrokeBenchmark();
      humanStrokeResult.textContent = describeHumanStrokeBenchmark(humanStrokeBenchmark);
    } catch (error) {
      humanStrokeResult.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      humanStrokeSaving = false;
    }
  } else if (recording) {
    humanStrokeResult.textContent = "Tratto troppo breve: registra una pennellata con almeno un movimento.";
  }

  updateHumanStrokeControls();
}

async function replayHumanStroke(replayTool: BrushSettings["tool"] = "paint"): Promise<void> {
  const benchmark = humanStrokeBenchmark;
  if (!benchmark || humanStrokeReplaying || interactionLocked()) {
    return;
  }

  const testVariant: HumanStrokeTestVariant = replayTool === "blend"
    ? "blend"
    : selectedHumanStrokeTestVariant();
  const testBlendMode = replayTool === "blend" ? "normal" : selectedHumanStrokeTestBlendMode();
  const testGrainMode = replayTool === "blend" ? "off" : selectedHumanStrokeTestGrainMode();
  const replaySettings = replayTool === "blend"
    ? humanStrokeBlendTestSettings(benchmark)
    : humanStrokeTestSettings(benchmark, testVariant, testBlendMode, testGrainMode);
  const testLabel = replayTool === "blend"
    ? BLEND_REPLAY_LABEL
    : humanStrokeTestLabel(testVariant, testBlendMode, testGrainMode);
  const backgroundStrategy: HumanStrokeBackgroundStrategy = replayTool === "blend"
    ? "multicolor-horizontal-stripes-v1"
    : "transparent";

  setControlsPanelOpen(false);
  humanStrokeReplaying = true;
  benchmarkButton.disabled = true;
  updateHumanStrokeControls();
  updateHistoryControls();
  applySettingsToControls(replaySettings);
  humanStrokeResult.textContent = `Riproduzione test ${testLabel} in corso…`;

  try {
    await engine.waitForIdle();
    engine.resetStrokeRandomSeed();
    if (!engine.resetDocument()) {
      throw new Error("Il documento è occupato da un'operazione Undo/Redo.");
    }
    await engine.waitForIdle();
    if (replayTool === "blend") {
      humanStrokeResult.textContent = "Preparazione dello sfondo multicolore Blend…";
      await prepareBlendBenchmarkBackground(replaySettings);
      engine.resetStrokeRandomSeed();
      humanStrokeResult.textContent = `Riproduzione test ${testLabel} in corso…`;
    }

    const blendRuntimeBeforeReplay = engine.getBlendRuntimeState();
    const blendScratchStateBeforeReplay: BlendScratchState = replayTool === "blend"
      ? blendRuntimeBeforeReplay.scratchAllocated ? "warm" : "cold"
      : "not-applicable";

    const before = engine.getStats();
    const replayStart = performance.now();
    const lastPoint = benchmark.points[benchmark.points.length - 1];
    const inputDelays: number[] = [];
    const layerInputDispatchMs: number[] = [];
    let nextPointIndex = 1;

    engine.startStrokePerformanceProfile();
    const initialDispatchStart = performance.now();
    engine.beginStrokeAtLayer(benchmark.points[0]);
    layerInputDispatchMs.push(performance.now() - initialDispatchStart);

    await new Promise<void>((resolve) => {
      const step = (timestamp: number) => {
        const elapsed = timestamp - replayStart;
        const duePoints: HumanStrokePoint[] = [];

        while (
          nextPointIndex < benchmark.points.length &&
          benchmark.points[nextPointIndex].timeMs <= elapsed
        ) {
          inputDelays.push(Math.max(0, elapsed - benchmark.points[nextPointIndex].timeMs));
          duePoints.push(benchmark.points[nextPointIndex]);
          nextPointIndex += 1;
        }

        if (duePoints.length > 0) {
          const dispatchStart = performance.now();
          engine.extendStrokeAtLayer(duePoints);
          layerInputDispatchMs.push(performance.now() - dispatchStart);
        }

        if (nextPointIndex < benchmark.points.length) {
          humanStrokeReplayFrame = requestAnimationFrame(step);
          return;
        }

        engine.endStroke(lastPoint.timeMs);
        humanStrokeReplayFrame = null;
        resolve();
      };

      humanStrokeReplayFrame = requestAnimationFrame(step);
    });

    const inputFinishedAt = performance.now();
    await engine.waitForIdle();
    const gpuCompletedAt = performance.now();
    await nextAnimationFrame();
    const presentedAt = performance.now();
    const performanceProfile = engine.finishStrokePerformanceProfile();
    if (!performanceProfile) {
      throw new Error("Profilo del tratto non disponibile.");
    }
    const after = engine.getStats();
    const blendRuntimeAfterReplay = engine.getBlendRuntimeState();
    const baseStamps = Math.max(0, after.totalBaseStamps - before.totalBaseStamps);
    const physicalOperations = replayTool === "blend"
      ? baseStamps
      : baseStamps * replaySettings.count;
    const playback = {
      inputDeliveryMs: inputFinishedAt - replayStart,
      inputDelayP50Ms: percentile(inputDelays, 0.5),
      inputDelayP95Ms: percentile(inputDelays, 0.95),
      inputDelayMaxMs: inputDelays.length === 0 ? 0 : Math.max(...inputDelays),
      layerInputDispatchTotalMs: layerInputDispatchMs.reduce((sum, duration) => sum + duration, 0),
      layerInputDispatchP50Ms: percentile(layerInputDispatchMs, 0.5),
      layerInputDispatchP95Ms: percentile(layerInputDispatchMs, 0.95),
      layerInputDispatchMaxMs: layerInputDispatchMs.length === 0 ? 0 : Math.max(...layerInputDispatchMs),
      inputDeliveryPath: "preconverted-layer-points" as const,
      pointerPipelineMeasured: false as const,
      inputToGpuCompletionMs: Math.max(0, gpuCompletedAt - inputFinishedAt),
      endToPresentedMs: Math.max(0, presentedAt - replayStart),
    };
    const run: BenchmarkRun = {
      version: 1,
      recordedAt: new Date().toISOString(),
      benchmark: {
        capturedAt: benchmark.capturedAt,
        traceFingerprint: fingerprintHumanStroke(benchmark.points),
        pointCount: benchmark.points.length,
        traceDurationMs: lastPoint.timeMs,
        ...summarizeHumanStrokeMotion(benchmark.points),
        testVariant,
        testTool: replayTool,
        testBlendMode,
        testGrainMode,
        backgroundStrategy,
        blendScratchStateBeforeReplay,
        blendScratchMemoryMiBBeforeReplay: blendRuntimeBeforeReplay.scratchMemoryMiB,
        blendScratchMemoryMiBAfterReplay: blendRuntimeAfterReplay.scratchMemoryMiB,
        settings: replaySettings,
      },
      playback,
      performance: performanceProfile,
      environment: collectBenchmarkEnvironment(),
    };
    const runId = await saveBenchmarkRun(run);

    humanStrokeResult.textContent = [
      `Test ${testLabel}`,
      `Tratto ${formatDuration(lastPoint.timeMs)}`,
      `${formatInteger(benchmark.points.length)} campioni`,
      replayTool === "blend"
        ? `${formatInteger(baseStamps)} segmenti Blend dry`
        : `${formatInteger(baseStamps)} stamps base`,
      replayTool === "blend"
        ? `scratch ${blendScratchStateBeforeReplay} → ${blendRuntimeAfterReplay.scratchMemoryMiB.toFixed(1)} MiB`
        : `${formatInteger(physicalOperations)} copie fisiche`,
      `coda GPU ${playback.inputToGpuCompletionMs.toFixed(2)} ms`,
      `CPU frame p95 ${performanceProfile.renderFrameTotalP95Ms.toFixed(2)} ms`,
      `submit p95 ${performanceProfile.submitImmediateP95Ms.toFixed(2)} ms`,
      `display mip ${performanceProfile.paintDisplaySelectedMipLevel} / ${formatInteger(performanceProfile.paintDisplayPyramidPasses)} pass`,
      replayTool === "blend"
        ? "preview tip n/a Blend"
        : performanceProfile.adaptivePreviewActivations > 0
        ? `preview tip ${formatInteger(performanceProfile.adaptivePreviewBaseStampsDrawn)} stamp / ${performanceProfile.adaptivePreviewJsTotalMs.toFixed(2)} ms JS`
        : "preview tip non attivata",
      replayTool === "blend"
        ? `spacing Blend ${replaySettings.spacingPercent.toFixed(2)}%`
        : `spacing adattivo ${performanceProfile.adaptiveSpacingInitialPercent.toFixed(2)}→${performanceProfile.adaptiveSpacingFinalPercent.toFixed(2)}% / ${performanceProfile.adaptiveSpacingIncreaseCount} step`,
      `history CPU ${formatInteger(performanceProfile.historyCapturedBaseStamps)} stamp / ${formatInteger(performanceProfile.historyCapturedBatches)} batch`,
      `FPS medi ${performanceProfile.averageRenderFps.toFixed(1)}`,
      `${formatInteger(performanceProfile.delayedRenderFrames)} frame >20 ms`,
      `presentazione ${playback.endToPresentedMs.toFixed(2)} ms`,
      runId > 0 ? `run #${runId} salvata` : "run salvata",
    ].join(" · ");
  } catch (error) {
    engine.finishStrokePerformanceProfile();
    humanStrokeResult.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    humanStrokeReplaying = false;
    benchmarkButton.disabled = false;
    updateHumanStrokeControls();
    historyState = engine.getHistoryState();
    updateHistoryControls();
  }
}

function normalizedPressure(event: PointerEvent): number {
  if (event.pointerType === "mouse") {
    return 1;
  }
  if (event.pressure > 0) {
    return event.pressure;
  }
  return event.pointerType === "pen" ? 0.5 : 0.65;
}

function toPointerSample(event: PointerEvent): PointerSample {
  return {
    clientX: event.clientX,
    clientY: event.clientY,
    pressure: normalizedPressure(event),
    timeMs: event.timeStamp,
  };
}

let activePointerId: number | null = null;
let pointerMode: "paint" | "pan" | "touch-navigation" | null = null;
let lastPanClientX = 0;
let lastPanClientY = 0;

interface TouchContact {
  clientX: number;
  clientY: number;
}

interface TouchNavigationGesture {
  centerX: number;
  centerY: number;
  distance: number;
}

const activeTouchContacts = new Map<number, TouchContact>();
let touchNavigationGesture: TouchNavigationGesture | null = null;

function currentTouchNavigationGesture(): TouchNavigationGesture | null {
  const contacts = [...activeTouchContacts.values()];
  if (contacts.length < 2) {
    return null;
  }
  const first = contacts[0];
  const second = contacts[1];
  return {
    centerX: (first.clientX + second.clientX) * 0.5,
    centerY: (first.clientY + second.clientY) * 0.5,
    distance: Math.max(1, Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY)),
  };
}

function cancelHumanStrokeRecordingForNavigation(): void {
  if (!humanStrokeRecording) {
    return;
  }
  humanStrokeRecording = null;
  humanStrokeRecordingArmed = false;
  humanStrokeResult.textContent = "Registrazione annullata dal gesto a due dita.";
  updateHumanStrokeControls();
}

function enterTouchNavigation(): void {
  if (pointerMode !== "touch-navigation") {
    if (pointerMode === "paint") {
      if (!engine.cancelStrokeBeforeRender()) {
        engine.endStroke();
      }
      cancelHumanStrokeRecordingForNavigation();
    }
    pointerMode = "touch-navigation";
    canvas.classList.add("panning");
  }
  touchNavigationGesture = currentTouchNavigationGesture();
}

canvas.addEventListener("pointerdown", (event) => {
  if (
    event.pointerType === "touch"
    && activePointerId !== null
    && activeTouchContacts.size > 0
    && !operationLocked()
  ) {
    event.preventDefault();
    activeTouchContacts.set(event.pointerId, {
      clientX: event.clientX,
      clientY: event.clientY,
    });
    canvas.setPointerCapture(event.pointerId);
    if (activeTouchContacts.size >= 2) {
      enterTouchNavigation();
    }
    return;
  }

  if (activePointerId !== null || operationLocked()) {
    return;
  }

  event.preventDefault();
  activePointerId = event.pointerId;
  if (event.pointerType === "touch") {
    activeTouchContacts.set(event.pointerId, {
      clientX: event.clientX,
      clientY: event.clientY,
    });
  }
  const shouldPan = event.shiftKey || event.button === 1 || event.button === 2;
  pointerMode = shouldPan ? "pan" : "paint";
  canvas.setPointerCapture(event.pointerId);

  if (pointerMode === "pan") {
    canvas.classList.add("panning");
    lastPanClientX = event.clientX;
    lastPanClientY = event.clientY;
  } else {
    const sample = toPointerSample(event);
    if (humanStrokeRecordingArmed) {
      startHumanStrokeRecording(event, sample);
    }
    engine.beginStroke(sample);
  }

  // requestRender() è già stato accodato da beginStroke(): questo callback
  // viene dopo il primo render e tiene il lavoro DOM fuori dalla sua strada.
  requestAnimationFrame(() => {
    if (activePointerId === event.pointerId) {
      updateHistoryControls();
      updateHumanStrokeControls();
    }
  });
});

canvas.addEventListener("pointermove", (event) => {
  if (event.pointerType === "touch" && activeTouchContacts.has(event.pointerId)) {
    activeTouchContacts.set(event.pointerId, {
      clientX: event.clientX,
      clientY: event.clientY,
    });

    if (pointerMode === "touch-navigation") {
      event.preventDefault();
      const nextGesture = currentTouchNavigationGesture();
      const previousGesture = touchNavigationGesture;
      if (nextGesture && previousGesture) {
        const deltaX = nextGesture.centerX - previousGesture.centerX;
        const deltaY = nextGesture.centerY - previousGesture.centerY;
        if (Math.abs(deltaX) > 0.01 || Math.abs(deltaY) > 0.01) {
          engine.panByClientDelta(deltaX, deltaY);
        }

        const zoomFactor = nextGesture.distance / previousGesture.distance;
        if (Number.isFinite(zoomFactor) && Math.abs(zoomFactor - 1) > 0.0001) {
          engine.zoomBy(
            Math.min(2, Math.max(0.5, zoomFactor)),
            nextGesture.centerX,
            nextGesture.centerY,
          );
        }
      }
      touchNavigationGesture = nextGesture;
      return;
    }
  }

  if (event.pointerId !== activePointerId || pointerMode === null) {
    return;
  }

  event.preventDefault();
  if (pointerMode === "pan") {
    engine.panByClientDelta(event.clientX - lastPanClientX, event.clientY - lastPanClientY);
    lastPanClientX = event.clientX;
    lastPanClientY = event.clientY;
    return;
  }

  const eventWithCoalescing = event as PointerEvent & {
    getCoalescedEvents?: () => PointerEvent[];
  };
  const coalesced = eventWithCoalescing.getCoalescedEvents?.() ?? [];
  const sourceEvents = coalesced.length > 0 ? coalesced : [event];
  const samples = sourceEvents.map(toPointerSample);
  captureHumanStrokeSamples(sourceEvents, samples);
  engine.extendStroke(samples);
});

function finishPointer(event: PointerEvent): void {
  if (event.pointerType === "touch") {
    activeTouchContacts.delete(event.pointerId);
  }

  if (pointerMode === "touch-navigation") {
    event.preventDefault();
    const remainingPointerId = activeTouchContacts.keys().next().value;
    activePointerId = typeof remainingPointerId === "number" ? remainingPointerId : null;
    touchNavigationGesture = currentTouchNavigationGesture();

    if (activeTouchContacts.size === 0) {
      canvas.classList.remove("panning");
      pointerMode = null;
      historyState = engine.getHistoryState();
      updateHistoryControls();
      updateHumanStrokeControls();
    }
    return;
  }

  if (event.pointerId !== activePointerId) {
    return;
  }

  if (pointerMode === "paint") {
    engine.endStroke(event.timeStamp);
    void finishHumanStrokeRecording(event.type === "pointerup");
  }
  canvas.classList.remove("panning");
  pointerMode = null;
  activePointerId = null;
  touchNavigationGesture = null;
  historyState = engine.getHistoryState();
  updateHistoryControls();
  updateHumanStrokeControls();
}

canvas.addEventListener("pointerup", finishPointer);
canvas.addEventListener("pointercancel", finishPointer);
canvas.addEventListener("lostpointercapture", finishPointer);
canvas.addEventListener("contextmenu", (event) => event.preventDefault());

window.addEventListener("keydown", (event) => {
  if (
    event.defaultPrevented
    || event.repeat
    || event.isComposing
    || event.altKey
    || (!event.ctrlKey && !event.metaKey)
    || event.key.toLowerCase() !== "z"
  ) {
    return;
  }

  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("input, textarea, select, [contenteditable]")) {
    return;
  }

  const operation = event.shiftKey ? "redo" : "undo";
  const available = operation === "undo" ? historyState.canUndo : historyState.canRedo;
  if (!available || interactionLocked() || activePointerId !== null) {
    return;
  }

  event.preventDefault();
  void runHistoryOperation(operation);
});

canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    if (interactionLocked() || activePointerId !== null) {
      return;
    }
    const factor = Math.exp(-event.deltaY * 0.0015);
    engine.zoomBy(Math.min(2, Math.max(0.5, factor)), event.clientX, event.clientY);
  },
  { passive: false },
);

const resizeObserver = new ResizeObserver(() => engine.resizeCanvas());
resizeObserver.observe(canvas);

syncRasterStrokeControls(engine.getRasterStrokeStyle());
syncRasterBevelControls(engine.getRasterBevelStyle());
setGpuMemoryPanelOpen(false);
setControlsPanelOpen(true);
configureBrushToolUi("paint", false);
updateControlOutputs();
engine.setBrushSettings(readBrushSettings());
updateHumanStrokeControls();
updateHistoryControls();
void loadCanonicalHumanStroke();

void engine.initialize()
  .then(() => {
    engineInitialized = true;
    historyState = engine.getHistoryState();
    updateHistoryControls();
    updateHumanStrokeControls();
  })
  .catch((error) => {
    const secureContextHint = !window.isSecureContext
      ? " WebGPU richiede HTTPS oppure localhost; un indirizzo LAN in HTTP non è sufficiente."
      : "";
    statusElement.textContent = `${error instanceof Error ? error.message : String(error)}${secureContextHint}`;
    statusElement.className = "status error";
    benchmarkButton.disabled = true;
    updateHistoryControls();
  });

window.setInterval(() => updateStats(engine.getStats()), 500);
