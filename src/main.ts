import "./styles.css";
import {
  shouldCloseMobileToolsSheetDrag,
  type MobileToolsSheetSnap,
} from "./mobile-tools-sheet-gesture";
import {
  MOBILE_LAYER_REORDER_HOLD_MS,
  mobileLayerReorderAutoScrollVelocity,
  mobileLayerReorderDropSlot,
  mobileLayerReorderMovementExceeded,
  type MobileLayerReorderPlan,
  type MobileLayerReorderRowGeometry,
} from "./mobile-layer-reorder-core";
import {
  TOUCH_PAINT_INTENT_HOLD_MS,
  TOUCH_PAINT_INTENT_MOVE_THRESHOLD_PX,
  TOUCH_PAINT_INTENT_STRATEGY,
  shouldHoldTouchPaintIntent,
  touchPaintIntentMovementReached,
} from "./touch-paint-intent-core";
import { MobileBrushStudioController } from "./mobile-brush-studio";
import { MobileBrushLibraryPreviewRenderer } from "./brush-library-preview";
import { MobileStrokeSheetController } from "./mobile-stroke-sheet";
import {
  MobileToolSettingsSheetController,
  type MobileTextWarpMode,
  type MobileToolSettingsKind,
} from "./mobile-tool-settings-sheet";
import {
  MOBILE_RASTER_EFFECT_KIND_BY_CONTROL_ID,
  MobileRasterEffectsSheetController,
  type MobileRasterEffectKind,
} from "./mobile-raster-effects-sheet";
import {
  loadBrushStudioLibraryState,
  saveBrushStudioLibraryState,
} from "./brush-studio-storage";
import {
  Blend,
  Box,
  Brush,
  Check,
  ChevronDown,
  CircleDashed,
  CircleDotDashed,
  Copy,
  Eraser,
  Eye,
  EyeOff,
  House,
  Image as ImageIcon,
  Layers3,
  PaintBucket,
  Palette,
  Pencil,
  Plus,
  Redo2,
  Save,
  Scaling,
  Scan,
  Search,
  Shapes,
  SlidersHorizontal,
  SprayCan,
  Spline,
  SquareDashed,
  SquareStack,
  Sun,
  Type as TypeIcon,
  TypeOutline,
  Undo2,
  createElement as createLucideElement,
  createIcons,
  type IconNode,
} from "lucide";
import {
  BrushEngine,
  type RasterBevelStyle,
  type RasterInnerShadowStyle,
  type RasterOuterShadowStyle,
  type RasterStrokeStyle,
} from "./brush-engine";
import {
  PENCIL_BRUSH_PRESET,
  resolveBrushPresetSettings,
} from "./brush-presets";
import type { EngineStats, StrokePerformanceProfile } from "./engine-stats";
import type {
  FragmentCoverageStrategy,
  ShapeMaskDecodeStrategy,
  ShapeSamplingStrategy,
  StampGeometry,
} from "./engine-strategies";
import {
  defaultBrushSettings,
  type BrushSettings,
  type GrainMode,
  type HistoryState,
  type LayerFormat,
  type LayerPoint,
  type PointerSample,
} from "./engine-types";
import { LAYER_SIZE } from "./engine-limits";
import { layerBaseMemoryMiB } from "./engine-memory-model";
import { GPU_MEMORY_AUDIT_TOLERANCE_BYTES } from "./gpu-memory-audit";
import { LAYER_THUMBNAIL_SIZE } from "./layer-thumbnail-renderer";
import {
  mobileSemanticLayerThumbnailSignature,
  renderMobileSemanticLayerThumbnail,
  requestMobileTextThumbnailFont,
  type MobileSemanticLayerThumbnailSource,
} from "./mobile-semantic-layer-thumbnail";
import type { ShapeOccupancyFallbackReason } from "./shape-occupancy";
import type {
  IphoneMemoryLimitEvent,
  IphoneMemoryLimitProgress,
  IphoneMemoryLimitRun,
} from "./iphone-memory-limit-test";
import type { LayerCompressionStudyReport } from "./layer-compression-study";
import { MixedVectorTextController } from "./mixed-vector-text-controller";
import type { MixedMemoryBenchmarkReport } from "./mixed-memory-benchmark";
import {
  rasterColorOverlayColorFromHex,
  rasterColorOverlayColorToHex,
  type RasterColorOverlayStyle,
} from "./raster-color-overlay-core";
import {
  LAYER_BLEND_MODE_CATEGORIES,
  LAYER_BLEND_MODE_LABELS,
  type LayerBlendMode,
} from "./layer-blend-modes";
import type {
  PixelSelectionState,
  SelectionCombineMode,
  SelectionMethod,
  SelectionPoint,
} from "./selection-core";

createIcons({
  icons: {
    Blend,
    Box,
    Brush,
    Check,
    ChevronDown,
    CircleDashed,
    CircleDotDashed,
    Copy,
    Eraser,
    Eye,
    EyeOff,
    House,
    Image: ImageIcon,
    Layers3,
    PaintBucket,
    Palette,
    Pencil,
    Plus,
    Redo2,
    Save,
    Scaling,
    Scan,
    Search,
    Shapes,
    SlidersHorizontal,
    SprayCan,
    Spline,
    SquareDashed,
    SquareStack,
    Sun,
    Type: TypeIcon,
    TypeOutline,
    Undo2,
  },
});

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

// La taglia del documento la decide `LAYER_SIZE` al boot, quindi titolo,
// intestazione e ogni etichetta che cita documento o costo di un livello non
// possono essere statiche in `index.html`. Deve stare dopo `formatMemoryMiB`:
// piu' in alto finirebbe nella TDZ di `memoryNumberFormatter` e l'intero modulo
// non verrebbe eseguito.
document.title = `WebGPU Brush Engine ${LAYER_SIZE}²`;
element("document-size-label").textContent = `${LAYER_SIZE} × ${LAYER_SIZE}`;
for (const node of document.querySelectorAll<HTMLElement>("[data-document-size-square]")) {
  node.textContent = `${LAYER_SIZE}²`;
}
for (
  const option of document.querySelectorAll<HTMLOptionElement>("[data-layer-format-label]")
) {
  option.textContent = `${option.dataset.layerFormatLabel} — `
    + formatMemoryMiB(layerBaseMemoryMiB(option.value as LayerFormat));
}

const canvas = element<HTMLCanvasElement>("gpuCanvas");
const tipPreviewCanvas = element<HTMLCanvasElement>("tipPreviewCanvas");
const rasterSelectionOverlayCanvas = element<HTMLCanvasElement>(
  "rasterSelectionOverlayCanvas",
);
const rasterSelectionGestureCanvas = element<HTMLCanvasElement>(
  "rasterSelectionGestureCanvas",
);
const rasterSelectionGestureContextCandidate = rasterSelectionGestureCanvas.getContext("2d", {
  alpha: true,
});
if (!rasterSelectionGestureContextCandidate) {
  throw new Error("Canvas 2D provvisorio del lazo non disponibile.");
}
const rasterSelectionGestureContext: CanvasRenderingContext2D =
  rasterSelectionGestureContextCandidate;
const appElement = element<HTMLElement>("app");
const controlsPanel = element<HTMLElement>("controlsPanel");
const toggleControlsButton = element<HTMLButtonElement>("toggleControls");
const statusElement = element<HTMLParagraphElement>("status");
const benchmarkButton = element<HTMLButtonElement>("runBenchmark");
const benchmarkResult = element<HTMLParagraphElement>("benchmarkResult");
const layerList = element<HTMLElement>("layerList");
const addLayerButton = element<HTMLButtonElement>("addLayer");
const layerSwitchResult = element<HTMLParagraphElement>("layerSwitchResult");
const layerLoadingOverlay = element<HTMLElement>("layerLoadingOverlay");
const layerLoadingLabel = element<HTMLParagraphElement>("layerLoadingLabel");
const layerMemoryStressSection = element<HTMLElement>("layerMemoryStressSection");
const layerMemoryStressIntro = element<HTMLParagraphElement>("layerMemoryStressIntro");
const iphoneMemoryDeviceControl = element<HTMLElement>("iphoneMemoryDeviceControl");
const iphoneMemoryDeviceLabel = element<HTMLInputElement>("iphoneMemoryDeviceLabel");
const layerMemoryStressButton = element<HTMLButtonElement>("runLayerMemoryStress");
const layerMemoryStressResult = element<HTMLParagraphElement>("layerMemoryStressResult");
const layerMemoryStressDetails = element<HTMLDetailsElement>("layerMemoryStressDetails");
const layerMemoryStressReport = element<HTMLElement>("layerMemoryStressReport");
const layerCompressionStudySection = element<HTMLElement>("layerCompressionStudySection");
const layerCompressionStudyButton = element<HTMLButtonElement>("runLayerCompressionStudy");
const layerCompressionStudyResult = element<HTMLParagraphElement>("layerCompressionStudyResult");
const layerCompressionStudyDetails = element<HTMLDetailsElement>("layerCompressionStudyDetails");
const layerCompressionStudyReport = element<HTMLElement>("layerCompressionStudyReport");
const rasterStrokeGoldenSection = element<HTMLElement>("rasterStrokeGoldenSection");
const rasterShadowGoldenButton = element<HTMLButtonElement>("runRasterShadowGolden");
const rasterShadowGoldenResult = element<HTMLParagraphElement>("rasterShadowGoldenResult");
const rasterShadowGoldenDetails = element<HTMLDetailsElement>("rasterShadowGoldenDetails");
const rasterShadowGoldenReport = element<HTMLElement>("rasterShadowGoldenReport");
const rasterStrokeGoldenButton = element<HTMLButtonElement>("runRasterStrokeGolden");
const rasterStrokeGoldenResult = element<HTMLParagraphElement>("rasterStrokeGoldenResult");
const rasterStrokeGoldenDetails = element<HTMLDetailsElement>("rasterStrokeGoldenDetails");
const rasterStrokeGoldenReport = element<HTMLElement>("rasterStrokeGoldenReport");
const effectsWorkbenchBenchmarkButton = element<HTMLButtonElement>("runEffectsWorkbenchBenchmark");
const effectsWorkbenchBenchmarkResult = element<HTMLParagraphElement>("effectsWorkbenchBenchmarkResult");
const effectsWorkbenchBenchmarkDetails = element<HTMLDetailsElement>("effectsWorkbenchBenchmarkDetails");
const effectsWorkbenchBenchmarkReport = element<HTMLElement>("effectsWorkbenchBenchmarkReport");
const layerHistoryTestSection = element<HTMLElement>("layerHistoryTestSection");
const layerHistoryTestResult = element<HTMLParagraphElement>("layerHistoryTestResult");
const layerHistoryTestDetails = element<HTMLDetailsElement>("layerHistoryTestDetails");
const layerHistoryTestReport = element<HTMLElement>("layerHistoryTestReport");
const recordHumanStrokeButton = element<HTMLButtonElement>("recordHumanStroke");
const playHumanStrokeButton = element<HTMLButtonElement>("playHumanStroke");
const playBlendHumanStrokeButton = element<HTMLButtonElement>("playBlendHumanStroke");
const runRenderingModeSuiteButton = element<HTMLButtonElement>("runRenderingModeSuite");
const humanStrokeResult = element<HTMLParagraphElement>("humanStrokeResult");
const renderingModeSuiteResult = element<HTMLParagraphElement>("renderingModeSuiteResult");
const renderingModeSuiteDetails = element<HTMLDetailsElement>("renderingModeSuiteDetails");
const renderingModeSuiteReport = element<HTMLElement>("renderingModeSuiteReport");
const renderingModeSuiteProgress = element<HTMLOutputElement>("renderingModeSuiteProgress");
const renderingModeMemoryHint = element<HTMLParagraphElement>("renderingModeMemoryHint");
const humanStrokeTestVariantSelect = element<HTMLSelectElement>("humanStrokeTestVariant");
const humanStrokeTestBlendModeSelect = element<HTMLSelectElement>("humanStrokeTestBlendMode");
const humanStrokeTestGrainModeSelect = element<HTMLSelectElement>("humanStrokeTestGrainMode");
const layerFormatSelect = element<HTMLSelectElement>("layerFormat");
const clearLayerButton = element<HTMLButtonElement>("clearLayer");
const undoStrokeButton = element<HTMLButtonElement>("undoStroke");
const redoStrokeButton = element<HTMLButtonElement>("redoStroke");
const brushColorInput = element<HTMLInputElement>("brushColor");
const mobileBrushColorLabel = element<HTMLLabelElement>("mobileBrushColor");
const mobileBrushColorInput = element<HTMLInputElement>("mobileBrushColorInput");
const mobileBrushColorSwatch = element<HTMLElement>("mobileBrushColorSwatch");
const mobilePaintButton = element<HTMLButtonElement>("mobilePaint");
const mobileBlendButton = element<HTMLButtonElement>("mobileBlend");
const mobileUndoButton = element<HTMLButtonElement>("mobileUndo");
const mobileRedoButton = element<HTMLButtonElement>("mobileRedo");
const mobileToolsMenuButton = element<HTMLButtonElement>("mobileToolsMenu");
const mobileToolsSheet = element<HTMLElement>("mobileToolsSheet");
const mobileToolsSheetHandle = element<HTMLButtonElement>("mobileToolsSheetHandle");
const mobileToolsSheetContent = element<HTMLElement>("mobileToolsSheetContent");
const mobileToolsSearchField = element<HTMLLabelElement>("mobileToolsSearchField");
const mobileToolsSearchInput = element<HTMLInputElement>("mobileToolsSearch");
const mobileToolsEmpty = element<HTMLParagraphElement>("mobileToolsEmpty");
const mobileLayersMenuButton = element<HTMLButtonElement>("mobileLayersMenu");
const mobileLayersPanel = element<HTMLElement>("mobileLayersPanel");
const mobileAddLayerButton = element<HTMLButtonElement>("mobileAddLayer");
const mobileCopyLayerButton = element<HTMLButtonElement>("mobileCopyLayer");
const mobileAddMaskButton = element<HTMLButtonElement>("mobileAddMask");
const mobileLayerList = element<HTMLElement>("mobileLayerList");
const mobileLayerContextMenu = element<HTMLElement>("mobileLayerContextMenu");
const mobileLayerClippingButton = element<HTMLButtonElement>("mobileLayerClipping");
const mobileLayerOptionsButton = element<HTMLButtonElement>("mobileLayerOptions");
const mobileLayerReorderStatus = element<HTMLParagraphElement>(
  "mobileLayerReorderStatus",
);
const mobileBrushControls = element<HTMLElement>("mobileBrushControls");
const mobileBrushSizeTrack = element<HTMLElement>("mobileBrushSizeTrack");
const mobileBrushOpacityTrack = element<HTMLElement>("mobileBrushOpacityTrack");
const mobileBrushStretchTrack = element<HTMLElement>("mobileBrushStretchTrack");
const mobileBrushPaintTrack = element<HTMLElement>("mobileBrushPaintTrack");
const mobileBrushSizeControl = element<HTMLElement>("mobileBrushSizeControl");
const mobileBrushOpacityControl = element<HTMLElement>("mobileBrushOpacityControl");
const mobileBrushStretchControl = element<HTMLElement>("mobileBrushStretchControl");
const mobileBrushPaintControl = element<HTMLElement>("mobileBrushPaintControl");
const mobileBrushPreview = element<HTMLElement>("mobileBrushPreview");
const mobileBrushPreviewLabel = element<HTMLOutputElement>("mobileBrushPreviewLabel");
const mobileBrushPreviewCanvas = element<HTMLCanvasElement>("mobileBrushPreviewCanvas");
const mobileBrushLibrarySheet = element<HTMLElement>("mobileBrushLibrarySheet");
const mobileBrushLibraryHandle = element<HTMLButtonElement>("mobileBrushLibraryHandle");
const mobileBrushLibraryList = element<HTMLElement>("mobileBrushLibraryList");
const mobileBrushLibraryEmpty = element<HTMLParagraphElement>("mobileBrushLibraryEmpty");
const mobilePencilBrushCard = element<HTMLButtonElement>("mobilePencilBrushCard");
const mobilePencilBrushPreviewCanvas = element<HTMLCanvasElement>(
  "mobilePencilBrushPreviewCanvas",
);
const mobileCurrentBrushCard = element<HTMLButtonElement>("mobileCurrentBrushCard");
const mobileBrushLibraryPreviewCanvas = element<HTMLCanvasElement>(
  "mobileBrushLibraryPreviewCanvas",
);
const mobileBrushLibraryCategoryButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-mobile-brush-category]"),
);
const mobileBrushLibraryCards = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-mobile-brush-id]"),
);
const mobileToolsCategories = Array.from(
  document.querySelectorAll<HTMLElement>("[data-mobile-tools-category]"),
);
const mobileToolsCanvasButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-mobile-canvas-tool]"),
);
const mobileToolsProxyButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-mobile-proxy-button]"),
);
const mobileToolsEffectButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-mobile-effect-control]"),
);
const mobileToolSettingsButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-mobile-tool-sheet]"),
);
const mobileUiMediaQuery = window.matchMedia("(max-width: 699px)");
const MOBILE_DOUBLE_TAP_ZOOM_INTERVAL_MS = 350;
const MOBILE_DOUBLE_TAP_ZOOM_DISTANCE_PX = 32;
let previousMobileTouchEndTime = Number.NEGATIVE_INFINITY;
let previousMobileTouchEndX = Number.NEGATIVE_INFINITY;
let previousMobileTouchEndY = Number.NEGATIVE_INFINITY;

function resetMobileDoubleTapZoomGuard(): void {
  previousMobileTouchEndTime = Number.NEGATIVE_INFINITY;
  previousMobileTouchEndX = Number.NEGATIVE_INFINITY;
  previousMobileTouchEndY = Number.NEGATIVE_INFINITY;
}

document.addEventListener("touchstart", (event) => {
  if (event.touches.length > 1) {
    resetMobileDoubleTapZoomGuard();
  }
}, { capture: true, passive: true });

document.addEventListener("touchcancel", resetMobileDoubleTapZoomGuard, {
  capture: true,
  passive: true,
});

document.addEventListener("touchend", (event) => {
  if (
    !mobileUiMediaQuery.matches
    || event.touches.length !== 0
    || event.changedTouches.length !== 1
  ) {
    resetMobileDoubleTapZoomGuard();
    return;
  }
  const touch = event.changedTouches[0];
  const elapsed = event.timeStamp - previousMobileTouchEndTime;
  const distance = Math.hypot(
    touch.clientX - previousMobileTouchEndX,
    touch.clientY - previousMobileTouchEndY,
  );
  if (
    elapsed > 0
    && elapsed <= MOBILE_DOUBLE_TAP_ZOOM_INTERVAL_MS
    && distance <= MOBILE_DOUBLE_TAP_ZOOM_DISTANCE_PX
  ) {
    event.preventDefault();
    resetMobileDoubleTapZoomGuard();
    return;
  }
  previousMobileTouchEndTime = event.timeStamp;
  previousMobileTouchEndX = touch.clientX;
  previousMobileTouchEndY = touch.clientY;
}, { capture: true, passive: false });

document.addEventListener("dblclick", (event) => {
  if (mobileUiMediaQuery.matches) {
    event.preventDefault();
  }
}, { capture: true, passive: false });
const fitViewButton = element<HTMLButtonElement>("fitView");
const zoomInButton = element<HTMLButtonElement>("zoomIn");
const zoomOutButton = element<HTMLButtonElement>("zoomOut");
const rotateViewLeftButton = element<HTMLButtonElement>("rotateViewLeft");
const viewRotationButton = element<HTMLButtonElement>("viewRotation");
const rotateViewRightButton = element<HTMLButtonElement>("rotateViewRight");
const benchmarkStampsInput = element<HTMLInputElement>("benchmarkStamps");
const gpuMemoryPanel = element<HTMLElement>("gpuMemoryPanel");
const gpuMemoryToggle = element<HTMLButtonElement>("gpuMemoryToggle");
const gpuMemoryClose = element<HTMLButtonElement>("gpuMemoryClose");
const gpuMemoryChevron = element<HTMLElement>("gpuMemoryChevron");
const gpuMemoryDelta = element<HTMLElement>("gpuMemoryDelta");

function syncMobileBrushColor(value = brushColorInput.value): void {
  mobileBrushColorInput.value = value;
  mobileBrushColorSwatch.style.backgroundColor = value;
}

syncMobileBrushColor();

type HumanStrokeTestVariant = "base" | "fur" | "blend";
type HumanStrokeTestBlendMode = "light-glaze" | "uniformed-glaze" | "intense-blending";
type HumanStrokeTestGrainMode = Extract<GrainMode, "off" | "texturized">;
type HumanStrokeBackgroundStrategy = "transparent" | "multicolor-horizontal-stripes-v1";
type BlendScratchState = "not-applicable" | "cold" | "warm";
type BenchmarkBlendMode = HumanStrokeTestBlendMode | "not-applicable";

interface RenderingModeMemorySnapshot {
  countedTotalMiB: number;
  countedTotalTransitionPeakMiB: number;
  renderingStorageMiB: number;
  lightGlazeMiB: number;
  intenseBlendingMiB: number;
  blendRendererMiB: number;
  grainTextureMiB: number;
  shapeTextureMiB: number;
  layerFormat: LayerFormat;
}

interface HumanStrokeReplayOptions {
  replayTool?: BrushSettings["tool"];
  testVariant?: HumanStrokeTestVariant;
  testBlendMode?: HumanStrokeTestBlendMode;
  testGrainMode?: HumanStrokeTestGrainMode;
  settingsOverride?: Partial<BrushSettings>;
  suiteRevision?: 1 | 2 | 3 | 4 | null;
  suiteCaseId?: string | null;
  suiteCaseLabel?: string | null;
}

interface HumanStrokeReplayResult {
  run: BenchmarkRun;
  runId: number;
  saveError: string | null;
  label: string;
  memoryBefore: RenderingModeMemorySnapshot;
  memoryAfter: RenderingModeMemorySnapshot;
}

interface RenderingModeSuiteCase {
  id: string;
  label: string;
  blendMode: HumanStrokeTestBlendMode;
  variant: Exclude<HumanStrokeTestVariant, "blend">;
  grainMode: HumanStrokeTestGrainMode;
  overrides: Partial<BrushSettings>;
}

interface MixedMemoryZoomProbe {
  readonly version: 1;
  readonly factors: readonly number[];
  readonly vectorRenderMs: readonly number[];
  readonly endToEndMs: readonly number[];
  readonly vectorRenderP50Ms: number;
  readonly vectorRenderP95Ms: number;
  readonly vectorRenderMaxMs: number;
  readonly endToEndP50Ms: number;
  readonly endToEndP95Ms: number;
  readonly endToEndMaxMs: number;
}

interface MixedMemoryBenchmarkSessionReport extends MixedMemoryBenchmarkReport {
  readonly browserCanvasLogicalMiB: number;
  readonly vectorCpuKnownLogicalMiB: number;
  readonly knownLogicalWorkingSetMiB: number;
  readonly baselineZoomProbe: MixedMemoryZoomProbe;
  readonly zoomProbe: MixedMemoryZoomProbe;
  readonly zoomVectorP95SlowdownRatio: number;
  readonly zoomEndToEndP95SlowdownRatio: number;
}

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
const CANONICAL_HUMAN_STROKE_FINGERPRINT = "18982412";
const CANONICAL_HUMAN_STROKE_POINT_COUNT = 1_583;
const BENCHMARK_RUNS_API_URL = "/api/benchmark-runs";
const LAYER_COMPRESSION_RUNS_API_URL = "/api/layer-compression-runs";

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
    testBlendMode: BenchmarkBlendMode;
    testGrainMode: HumanStrokeTestGrainMode;
    renderingSuiteRevision: 1 | 2 | 3 | 4 | null;
    renderingSuiteCaseId: string | null;
    renderingSuiteCaseLabel: string | null;
    renderingMemoryBeforeReplay: RenderingModeMemorySnapshot;
    renderingMemoryAfterReplay: RenderingModeMemorySnapshot;
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
    viewRotationDegrees: number;
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
    rasterColorOverlayStyle: RasterColorOverlayStyle;
    rasterColorOverlayStrategy: string;
    rasterColorOverlayScratchMemoryMiB: 0;
    rasterStrokeRendererBuild: string | null;
    rasterStrokeStyle: RasterStrokeStyle;
    rasterStrokePersistentMemoryMiB: number;
    rasterStrokeCoverageMemoryMiB: number;
    rasterStrokeScratchMemoryMiB: number;
    rasterStrokeCoverageStrategy: string;
    rasterStrokeGeometryStorageStrategy: string;
    rasterStrokeGeometryResident: boolean;
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
    rasterOuterShadowRendererBuild: string | null;
    rasterOuterShadowStyle: RasterOuterShadowStyle;
    rasterOuterShadowMatteMemoryMiB: number;
    rasterOuterShadowControlMemoryMiB: number;
    rasterOuterShadowScratchMemoryMiB: number;
    rasterOuterShadowScratchExtent: number;
    rasterOuterShadowStorageStrategy: string;
    rasterOuterShadowWorkspaceStrategy: string;
    rasterOuterShadowSourceMode: string | null;
    rasterInnerShadowRendererBuild: string | null;
    rasterInnerShadowStyle: RasterInnerShadowStyle;
    rasterInnerShadowMatteMemoryMiB: number;
    rasterInnerShadowControlMemoryMiB: number;
    rasterInnerShadowScratchMemoryMiB: number;
    rasterInnerShadowScratchExtent: number;
    rasterInnerShadowStorageStrategy: string;
    rasterInnerShadowWorkspaceStrategy: string;
    rasterInnerShadowSourceMode: string | null;
    dryBlendScratchLifecycleStrategy: string;
    layerMemoryMiB: number;
    layerCount: number;
    activeLayerId: number;
    referenceLayerId: number | null;
    fillReferenceLayerStrategy: string;
    fillReferenceLayerMiB: number;
    countedGpuMemoryMiB: number;
    vectorTextPresentationMiB: number;
    vectorTextAdaptiveZoomStrategy: string | null;
    vectorTextAdaptiveZoomEnabled: boolean;
    vectorTextZoomRenderMode: string | null;
    vectorTextZoomFastModeArmed: boolean;
    vectorTextZoomFastActivationCount: number;
    vectorTextZoomExactRecoveryCount: number;
    vectorTextZoomLastTriggerRenderMs: number;
    vectorTextZoomLastTriggerEndToEndMs: number;
    mixedSceneStrategy: string | null;
    mixedSceneItemCount: number;
    mixedSceneTextNodeCount: number;
    mixedMemoryBenchmarkStrategy: string;
    mixedMemoryBenchmarkReady: boolean;
    mixedMemoryBenchmarkTargetMiB: number;
    mixedMemoryBenchmarkRasterLayerCount: number;
    mixedMemoryBenchmarkTextNodeCount: number;
    mixedMemoryBenchmarkTextRunCount: number;
    mixedMemoryBenchmarkBlockShadowTextCount: number;
    mixedMemoryBenchmarkSingleShadowTextCount: number;
    mixedMemoryBenchmarkBrowserCanvasLogicalMiB: number;
    mixedMemoryBenchmarkVectorCpuKnownLogicalMiB: number;
    mixedMemoryBenchmarkKnownLogicalWorkingSetMiB: number;
    mixedMemoryBenchmarkBaselineZoomVectorRenderP95Ms: number;
    mixedMemoryBenchmarkBaselineZoomEndToEndP95Ms: number;
    mixedMemoryBenchmarkZoomVectorRenderP95Ms: number;
    mixedMemoryBenchmarkZoomEndToEndP95Ms: number;
    mixedMemoryBenchmarkZoomVectorP95SlowdownRatio: number;
    mixedMemoryBenchmarkZoomEndToEndP95SlowdownRatio: number;
    layerBakeStrategy: string;
    layerCompositeStrategy: string;
    layerStorageStudy: EngineStats["layerStorageStudy"];
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
    strokeCurveStrategy: StrokePerformanceProfile["strokeCurveStrategy"];
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
    touchNavigationStrategy: "two-finger-pan-pinch-rotate-zero-magnet";
    touchPaintIntentStrategy: typeof TOUCH_PAINT_INTENT_STRATEGY;
    touchPaintIntentHoldEnabled: boolean;
    touchPaintIntentHoldMs: number;
    touchPaintIntentMoveThresholdPx: number;
    touchPaintIntentStarts: number;
    touchPaintIntentReleasedByMovement: number;
    touchPaintIntentReleasedByTimeout: number;
    touchPaintIntentReleasedByPointerUp: number;
    touchPaintIntentCanceledForNavigation: number;
    touchPaintIntentCanceledForPointerEnd: number;
    touchPaintIntentMaximumBufferedSamples: number;
    touchPaintIntentLastHoldDurationMs: number;
    performanceTelemetryRevision: 64;
  };
}

let historyState: HistoryState = {
  canUndo: false,
  canRedo: false,
  busy: false,
  inconsistent: false,
  actionCount: 0,
  cursor: 0,
  storedBaseStamps: 0,
  logicalStampBytes: 0,
  undoBlockedReason: "Non ci sono azioni da annullare.",
  redoBlockedReason: "Non ci sono azioni da ripristinare.",
  openEdit: null,
};

const pageSearchParams = new URLSearchParams(window.location.search);
const bevelBoundingFieldEnabled = pageSearchParams.get("bevelField") === "bbox";
const layerHistoryTestRequested = import.meta.env.DEV
  && pageSearchParams.get("layerHistoryTest") === "1";
const clippingGroupTestRequested = import.meta.env.DEV
  && pageSearchParams.get("clippingGroupTest") === "1";
const layerBlendTestRequested = import.meta.env.DEV
  && pageSearchParams.get("layerBlendTest") === "1";
const layerMemoryStressTestRequested =
  pageSearchParams.get("layerMemoryStressTest") === "1";
const mixedMemoryBenchmarkRequested =
  pageSearchParams.get("mixedMemoryBenchmark") === "1";
const mixedMemoryBenchmarkTargetMiB =
  pageSearchParams.get("mixedMemoryTargetMiB") === "600" ? 600 : 800;
const layerCompressionStudyRequested =
  pageSearchParams.get("layerCompressionTest") === "1";
const iphoneMemoryLimitTestRequested =
  pageSearchParams.get("iphoneMemoryLimitTest") === "1";
const layerMemoryFixtureRequested =
  layerMemoryStressTestRequested
  || iphoneMemoryLimitTestRequested
  || mixedMemoryBenchmarkRequested;
const appleMobileMemoryLifecycle =
  /iPhone|iPad|iPod/i.test(navigator.userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const layerColdCompressionMode = pageSearchParams.get("layerCompressionRuntime");
const layerColdCompressionRequested =
  layerColdCompressionMode === "1";
const layerColdDirectHotHydrationEnabled =
  pageSearchParams.get("layerDirectHotHydration") !== "0";
const layerColdAdjacentPrefetchMode =
  pageSearchParams.get("layerAdjacentPrefetch");
const layerColdAdjacentPrefetchEnabled =
  layerColdAdjacentPrefetchMode === "1"
  || (!appleMobileMemoryLifecycle && layerColdAdjacentPrefetchMode !== "0");
const vectorTextEditorEnabled = true;
element<HTMLElement>("gpuMemoryVectorTextRow").hidden = false;
element<HTMLElement>("gpuMemoryRasterImageRow").hidden = false;
const iphoneMemoryLimitServerRequired = !(
  import.meta.env.DEV
  && pageSearchParams.get("memoryLimitLocalOnly") === "1"
);
layerMemoryStressSection.hidden = !layerMemoryFixtureRequested;
layerCompressionStudySection.hidden = !layerCompressionStudyRequested;
iphoneMemoryDeviceControl.hidden = !iphoneMemoryLimitTestRequested;
if (mixedMemoryBenchmarkRequested) {
  layerMemoryStressIntro.textContent =
    "Scenario ripetibile: 64 testi visibili (32 Block Shadow e 32 ombre blur), "
    + "nove gruppi testo separati dai raster e risorse reali fino a circa "
    + `${mixedMemoryBenchmarkTargetMiB} MiB GPU conteggiati. `
    + (mixedMemoryBenchmarkTargetMiB === 600
      ? "Creazione staged in piccoli gruppi per limitare il picco su iPhone. "
      : "")
    + "Al termine misura lo zoom e sblocca la stessa "
    + "traccia umana canonica.";
  layerMemoryStressButton.textContent =
    `Prepara scenario misto ~${mixedMemoryBenchmarkTargetMiB} MiB`;
  layerMemoryStressResult.textContent =
    "Pronto. La preparazione è distruttiva e va eseguita una sola volta su pagina nuova.";
} else if (iphoneMemoryLimitTestRequested) {
  layerMemoryStressIntro.textContent =
    "Ricerca distruttiva del limite di questo iPhone: sale a gradini reali e "
    + "salva nel progetto un checkpoint prima e dopo ogni operazione. Se Safari "
    + "chiude la pagina, non devi copiare nulla.";
  layerMemoryStressButton.textContent = "Trova e salva il limite di questo iPhone";
  layerMemoryStressResult.textContent =
    "Pronto. Tieni questa pagina in primo piano finché termina o Safari la chiude.";
}
let vectorTextPrototype: MixedVectorTextController | null = null;
let mobileBrushStudio: MobileBrushStudioController | null = null;
let mobileStrokeSheet: MobileStrokeSheetController | null = null;
let mobileRasterEffectsSheet: MobileRasterEffectsSheetController | null = null;
let mobileToolSettingsSheet: MobileToolSettingsSheetController | null = null;
const engine = new BrushEngine(canvas, {
  onStatus(message, kind) {
    statusElement.textContent = message;
    statusElement.className = `status ${kind === "working" ? "" : kind}`;
  },
  onStats(stats) {
    updateStats(stats);
    if (mobileBrushControlDrag) scheduleMobileBrushPreview();
    mobileBrushStudio?.notifyEngineUpdate();
  },
  onHistoryChange(state) {
    if (state.busy || state.openEdit !== null || state.inconsistent) {
      cancelMobileLayerReorderGesture();
    }
    historyState = state;
    requestMobileLayersRefresh();
    if (!state.busy && state.openEdit === null) {
      scheduleMobileLayersRefresh();
      requestMobileLayerThumbnailCapture();
    }
    updateHistoryControls();
    updateHumanStrokeControls();
  },
  onViewRotationChange(degrees, snappedToZero) {
    updateViewRotationControl(degrees, snappedToZero);
  },
  onViewChange() {
    vectorTextPrototype?.scheduleViewSync();
  },
  onPixelSelectionChange(state) {
    updatePixelSelectionResult(state);
    mobileToolSettingsSheet?.syncOpenState();
  },
  onMixedSceneChange(snapshot) {
    requestMobileLayersRefresh();
    vectorTextPrototype?.syncScene(snapshot);
    mobileToolSettingsSheet?.syncOpenState();
    syncMobileToolsMenuState();
    updateRasterColorOverlayControlAvailability();
    const selectedItem = snapshot.items.find(
      (item) => item.key === snapshot.selectedKey,
    );
    layerSwitchResult.textContent = selectedItem?.kind === "text"
      ? "Testo selezionato: pennello sospeso; il raster di lavoro resta caldo."
      : selectedItem?.kind === "svg"
        ? "SVG selezionato: pennello sospeso; il raster di lavoro resta caldo."
        : selectedItem?.kind === "image"
          ? "Immagine selezionata: pennello sospeso; usa Trasforma e poi Applica o Annulla."
          : "Raster selezionato: pennello attivo.";
  },
  onActiveLayerChange(activeIndex) {
    // A global undo can move the active layer on its own. Without resyncing, the
    // panel would keep highlighting the layer the user left and the raster effect
    // controls would show that layer's styles while the brush paints on
    // another one.
    syncActiveLayerControls();
    requestMobileLayersRefresh();
    requestMobileLayerThumbnailCapture();
    const mixedSnapshot = engine.getMixedSceneSnapshot();
    if (mixedSnapshot) {
      vectorTextPrototype?.syncScene(mixedSnapshot);
    }
    layerSwitchResult.textContent =
      `Undo/Redo ha selezionato il livello ${activeIndex + 1}.`;
  },
}, tipPreviewCanvas, {
  bevelBoundingFieldEnabled,
  layerMemoryStressTestEnabled: layerMemoryFixtureRequested,
  layerCompressionTestEnabled: layerCompressionStudyRequested,
  vectorTextPrototypeEnabled: vectorTextEditorEnabled,
  layerColdCompressionEnabled: layerColdCompressionRequested,
  layerColdCompressionStatusEnabled: layerColdCompressionMode === "1",
  layerColdDirectHotHydrationEnabled,
  layerColdAdjacentPrefetchEnabled,
}, rasterSelectionOverlayCanvas);
if (import.meta.env.DEV) {
  (window as Window & { __brushEngine?: BrushEngine }).__brushEngine = engine;
}

let humanStrokeBenchmark: HumanStrokeBenchmark | null = null;
let humanStrokeRecording: HumanStrokeRecording | null = null;
let humanStrokeRecordingArmed = false;
let humanStrokeReplayFrame: number | null = null;
let humanStrokeReplaying = false;
let renderingModeSuiteRunning = false;
let humanStrokeLoading = true;
let humanStrokeSaving = false;
let benchmarkRunning = false;
let rasterShadowGoldenRunning = false;
let rasterStrokeGoldenRunning = false;
let effectsWorkbenchBenchmarkRunning = false;
let layerHistoryTestRunning = false;
let layerMemoryStressTestRunning = false;
let layerMemoryStressTestCompleted = false;
let mixedMemoryBenchmarkReport: MixedMemoryBenchmarkSessionReport | null = null;
let layerCompressionStudyRunning = false;
let layerCompressionStudyCompleted = false;
let layerFormatChanging = false;
let layerSwitching = false;
let rasterColorOverlayChanging = false;
let rasterStrokeChanging = false;
let historyUiBusy = false;
let rasterBevelChanging = false;
let rasterOuterShadowChanging = false;
let rasterInnerShadowChanging = false;
let engineInitialized = false;
let selectionUiBusy = false;
let controlsPanelOpen = true;
let mobileToolsSheetOpen = false;
let mobileToolsSheetSnap: MobileToolsSheetSnap = "peek";
let mobileToolsSheetOffsetPx = 0;
let mobileToolsSheetDragPointerId: number | null = null;
let mobileToolsSheetDragStartY = 0;
let mobileToolsSheetDragStartOffsetPx = 0;
let mobileToolsSheetDragStartSnap: MobileToolsSheetSnap = "peek";
let mobileToolsSheetDragLastY = 0;
let mobileToolsSheetDragLastTime = 0;
let mobileToolsSheetDragVelocityY = 0;
let mobileToolsSheetDragMoved = false;
let mobileToolsSheetResizeFrame: number | null = null;
type MobileBrushLibraryCategory = "pencil" | "painting" | "spray-paint";
type MobileBrushLibraryBrushId = "m1m4-pencil-v1" | "current";
const restoredMobileBrushLibraryState = loadBrushStudioLibraryState();
const restoredMobileBrushLibraryBrushId: MobileBrushLibraryBrushId =
  restoredMobileBrushLibraryState?.activeBrushId === PENCIL_BRUSH_PRESET.id
    ? PENCIL_BRUSH_PRESET.id
    : "current";
let mobileBrushLibraryOpen = false;
let mobileBrushLibraryCategory: MobileBrushLibraryCategory =
  restoredMobileBrushLibraryBrushId === PENCIL_BRUSH_PRESET.id ? "pencil" : "painting";
let activeMobileBrushLibraryBrushId: MobileBrushLibraryBrushId =
  restoredMobileBrushLibraryBrushId;
let mobileBrushLibrarySelectionRevision = 0;
let mobileBrushLibraryOffsetPx = 0;
let mobileBrushLibraryDragPointerId: number | null = null;
let mobileBrushLibraryDragStartY = 0;
let mobileBrushLibraryDragStartOffsetPx = 0;
let mobileBrushLibraryDragLastY = 0;
let mobileBrushLibraryDragLastTime = 0;
let mobileBrushLibraryDragVelocityY = 0;
let mobileBrushLibraryDragMoved = false;
let mobileBrushLibraryPreviewFrame: number | null = null;
let mobileBrushLibraryPreviewDirty = true;
let mobileBrushLibraryPreviewRevision = 0;
const mobileBrushLibraryPreviewRenderer = new MobileBrushLibraryPreviewRenderer();
if (import.meta.env.DEV) {
  (window as Window & {
    __mobileBrushLibraryPreviewStats?: () => ReturnType<
      MobileBrushLibraryPreviewRenderer["stats"]
    >;
  }).__mobileBrushLibraryPreviewStats = () => mobileBrushLibraryPreviewRenderer.stats();
}
let mobileLayersPanelOpen = false;
let mobileLayersRenderSignature = "";
let mobileLayersRefreshRequested = true;
let mobileLayersRefreshFrame: number | null = null;
type MobileMixedSceneLayerKey = NonNullable<EngineStats["mixedScene"]>["selectedKey"];
interface MobileLayerReorderGesture {
  readonly pointerId: number;
  readonly key: MobileMixedSceneLayerKey;
  readonly name: string;
  readonly row: HTMLElement;
  readonly select: HTMLButtonElement;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly startScrollTop: number;
  readonly restoreFocus: boolean;
  holdTimer: number | null;
  phase: "pending" | "armed" | "dragging";
  plan: MobileLayerReorderPlan | null;
  currentSlot: number;
  clientY: number;
  frame: number | null;
  lastFrameTime: number;
}
let mobileLayerReorderGesture: MobileLayerReorderGesture | null = null;
let mobileLayerContextKey: MobileMixedSceneLayerKey | null = null;
let mobileLayerReorderSuppressClickKey: string | null = null;
let mobileLayerReorderSuppressClickUntil = 0;
type MobileBrushControlKind = "size" | "opacity" | "stretch" | "paint";
interface MobileBrushControlDrag {
  readonly kind: MobileBrushControlKind;
  readonly pointerId: number;
  readonly startClientY: number;
  readonly startPercent: number;
  readonly startInputValue: string;
  readonly travelPixels: number;
}
let mobileBrushControlDrag: MobileBrushControlDrag | null = null;
let mobileBrushPreviewFrame: number | null = null;
interface MobileRasterThumbnailCacheEntry {
  readonly imageData: ImageData;
  readonly revision: number;
}
const mobileRasterThumbnailCache = new Map<number, MobileRasterThumbnailCacheEntry>();
let mobileLayerThumbnailRevision = 0;
let mobileSemanticThumbnailFontRevision = 0;
let mobileLayerThumbnailCaptureTimer: number | null = null;
let mobileLayerThumbnailCaptureRequested = false;
let mobileLayerThumbnailCaptureInFlight = false;
let mobileLayerThumbnailCaptureUnavailable = false;
let gpuMemoryPanelOpen = false;
let previousGpuMemoryTotalMiB: number | null = null;
let gpuMemoryDeltaTimer: number | null = null;
type CanvasTool = BrushSettings["tool"] | "fill" | "selection" | "transform";
let activeBrushTool: BrushSettings["tool"] = "paint";
let activeCanvasTool: CanvasTool = "paint";
let mobileTextDistortReturnTool: CanvasTool | null = null;
let activeShapeInvert = false;
let selectionCombineMode: SelectionCombineMode = "replace";
let toolConfigurationRevision = 0;

type NumericKeyOf<T> = {
  [Key in keyof T]-?: T[Key] extends number ? Key : never;
}[keyof T];

const gpuMemoryRows: ReadonlyArray<
  readonly [string, NumericKeyOf<EngineStats["gpuMemory"]>]
> = [
  ["gpuMemoryLayerBase", "layerBaseMiB"],
  ["gpuMemoryLayerCold", "layerColdMiB"],
  ["gpuMemoryActiveClippingMask", "activeClippingMaskMiB"],
  ["gpuMemoryLayerCompressed", "layerCompressedCpuMiB"],
  ["gpuMemoryCountedWithCompressedCpu", "countedGpuPlusCompressedCpuMiB"],
  ["gpuMemoryLayerHydration", "layerHydrationMiB"],
  ["gpuMemoryLayerMips", "layerMipChainMiB"],
  ["gpuMemoryLayerBakes", "layerBakeMiB"],
  ["gpuMemoryLayerComposite", "layerCompositeMiB"],
  ["gpuMemoryGrain", "grainTextureMiB"],
  ["gpuMemoryShape", "shapeTextureMiB"],
  ["gpuMemoryPaintBuffers", "paintBuffersMiB"],
  ["gpuMemoryVectorText", "vectorTextPresentationMiB"],
  ["gpuMemoryRasterImage", "rasterImageMiB"],
  ["gpuMemoryPresentation", "presentationCacheMiB"],
  ["gpuMemoryLayerThumbnail", "layerThumbnailMiB"],
  ["gpuMemoryStrokeStyled", "rasterStrokeStyledMiB"],
  ["gpuMemoryStrokeCoverage", "rasterStrokeCoverageMiB"],
  ["gpuMemoryStrokeControl", "rasterStrokeMaskAndControlMiB"],
  ["gpuMemoryEffectsScratch", "effectsScratchPoolMiB"],
  ["gpuMemoryEffectsScratchPeak", "effectsScratchPoolPeakMiB"],
  ["gpuMemoryOuterShadowMatte", "rasterOuterShadowMatteMiB"],
  ["gpuMemoryOuterShadowControl", "rasterOuterShadowControlMiB"],
  ["gpuMemoryInnerShadowMatte", "rasterInnerShadowMatteMiB"],
  ["gpuMemoryInnerShadowControl", "rasterInnerShadowControlMiB"],
  ["gpuMemoryBevelHeight", "rasterBevelHeightMiB"],
  ["gpuMemoryBevelControl", "rasterBevelLutAndControlMiB"],
  ["gpuMemoryBlend", "blendRendererMiB"],
  ["gpuMemoryFill", "fillRendererMiB"],
  ["gpuMemorySelection", "selectionRendererMiB"],
  ["gpuMemoryLightGlaze", "lightGlazeMiB"],
  ["gpuMemoryStabilizationTail", "stabilizationTailMiB"],
  ["gpuMemoryThicknessTail", "thicknessTailMiB"],
  ["gpuMemoryHistory", "historyGpuMiB"],
];

const toolControlSnapshots: Record<
  BrushSettings["tool"],
  { size: number; spacing: number; flow: number; hardness: number }
> = {
  paint: { size: 96, spacing: 1, flow: 7, hardness: 100 },
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

function selectedSelectionMethod(): SelectionMethod {
  const value = element<HTMLSelectElement>("selectionMethod").value;
  return value === "lasso" || value === "color-range" ? value : "magic-wand";
}

function setSelectionCombineMode(mode: SelectionCombineMode): void {
  selectionCombineMode = mode;
  for (const [id, candidate] of [
    ["selectionReplace", "replace"],
    ["selectionAdd", "add"],
    ["selectionSubtract", "subtract"],
  ] as const) {
    element<HTMLButtonElement>(id).setAttribute(
      "aria-pressed",
      String(mode === candidate),
    );
  }
}

function updateSelectionMethodUi(): void {
  const method = selectedSelectionMethod();
  const colorRange = method === "color-range";
  element<HTMLElement>("selectionToleranceControl").hidden = method === "lasso";
  element<HTMLElement>("selectionColorControl").hidden = !colorRange;
  element<HTMLButtonElement>("selectionColorApply").hidden = !colorRange;
  element<HTMLElement>("selectionKeyboardHelp").hidden = colorRange;
  const canvasKeyboardEnabled = activeCanvasTool === "selection" && !colorRange;
  canvas.tabIndex = canvasKeyboardEnabled ? 0 : -1;
  if (canvasKeyboardEnabled) {
    canvas.setAttribute("aria-describedby", "selectionKeyboardHelp");
    canvas.setAttribute(
      "aria-keyshortcuts",
      "ArrowUp ArrowDown ArrowLeft ArrowRight Enter Space Escape",
    );
  } else {
    canvas.removeAttribute("aria-describedby");
    canvas.removeAttribute("aria-keyshortcuts");
  }
}

function updatePixelSelectionResult(state: PixelSelectionState): void {
  const result = element<HTMLParagraphElement>("selectionResult");
  if (state.selectedPixels === 0) {
    result.textContent = "Nessun pixel selezionato.";
    return;
  }
  const bounds = state.bounds
    ? ` · area ${state.bounds.width.toLocaleString("it-IT")}×`
      + state.bounds.height.toLocaleString("it-IT")
    : "";
  result.textContent = `${state.selectedPixels.toLocaleString("it-IT")} pixel selezionati`
    + ` · ${state.activeTiles} tile${bounds}.`;
}

function configureBrushToolUi(
  tool: CanvasTool,
  restoreSnapshot: boolean,
  preserveMobileToolSettingsSheet = false,
): void {
  const configurationRevision = ++toolConfigurationRevision;
  const previousCanvasTool = activeCanvasTool;
  const previousBrushTool = activeBrushTool;
  if (
    restoreSnapshot
    && previousCanvasTool !== tool
    && previousCanvasTool !== "fill"
    && previousCanvasTool !== "selection"
    && previousCanvasTool !== "transform"
  ) {
    captureActiveToolControls();
  }
  if (tool !== "paint" && mobileBrushStudio?.isOpen) {
    mobileBrushStudio.cancel(false);
  }
  if (
    !preserveMobileToolSettingsSheet
    && mobileToolSettingsSheet?.isOpen
    && mobileToolSettingsSheet.toolKind !== tool
  ) {
    mobileToolSettingsSheet.close(false);
  }
  activeCanvasTool = tool;
  if (tool !== "paint" && mobileBrushLibraryOpen) {
    setMobileBrushLibraryOpen(false);
  }
  mobilePaintButton.setAttribute("aria-pressed", String(tool === "paint"));
  mobileBlendButton.setAttribute("aria-pressed", String(tool === "blend"));
  syncMobileBrushLibraryButtonState();
  syncMobileToolsMenuState();
  const fill = tool === "fill";
  const selection = tool === "selection";
  const transform = tool === "transform";
  if (!selection) cancelKeyboardSelectionGesture(true);
  if (!fill && !selection && !transform) {
    activeBrushTool = tool;
  }
  setControlValue("brushTool", tool);
  const blend = tool === "blend";
  const size = element<HTMLInputElement>("brushSize");
  const spacing = element<HTMLInputElement>("spacing");
  size.min = "1";
  size.max = "1000";
  spacing.min = blend ? "1" : "0.25";
  spacing.max = blend ? "400" : "25";
  spacing.step = blend ? "1" : "0.25";
  if (restoreSnapshot && !fill && !selection && !transform && previousBrushTool !== tool) {
    const snapshot = toolControlSnapshots[tool];
    setControlValue("brushSize", snapshot.size);
    setControlValue("spacing", snapshot.spacing);
    setControlValue("flow", snapshot.flow);
    setControlValue("hardness", snapshot.hardness);
  }
  for (const id of [
    "shapeScatterControl",
    "shapeSourceControl",
    "shapeRotationControl",
    "stabilizationControl",
    "countControl",
    "opacityControl",
    "paintBlendModeControl",
    "thicknessSection",
    "colorJitterSection",
    "positionJitterSection",
  ]) {
    element<HTMLElement>(id).hidden = blend || fill || selection || transform;
  }
  for (const id of [
    "brushShapeControl",
    "brushSizeControl",
    "spacingControl",
    "flowControl",
    "grainSection",
    "renderingModeMemoryHint",
  ]) {
    element<HTMLElement>(id).hidden = fill || selection || transform;
  }
  element<HTMLElement>("hardnessControl").hidden = !blend || fill || selection || transform;
  element<HTMLElement>("brushColorControl").hidden = selection || transform;
  element<HTMLElement>("fillToleranceControl").hidden = !fill;
  element<HTMLElement>("selectionControls").hidden = !selection;
  element<HTMLElement>("blendControls").hidden = !blend;
  updateSelectionMethodUi();
  vectorTextPrototype?.setTransformToolActive(transform);
  updateRenderingModeControlAvailability();
  syncMobileBrushControlVisuals();
  syncMobileBrushControlsVisibility();
  syncMobileBrushControlAvailability();
  if (engineInitialized) {
    const method = selectedSelectionMethod();
    void (async () => {
      const fillReady = await engine.setFillToolSelected(fill);
      if (
        configurationRevision !== toolConfigurationRevision
        || activeCanvasTool !== tool
      ) {
        return;
      }
      const selectionReady = await engine.setSelectionToolSelected(selection, method);
      if (
        configurationRevision !== toolConfigurationRevision
        || activeCanvasTool !== tool
        || (selection && selectedSelectionMethod() !== method)
      ) {
        return;
      }
      if (
        (!fillReady && activeCanvasTool === "fill" && engine.fillToolSelected === false)
        || (!selectionReady && activeCanvasTool === "selection")
      ) {
        configureBrushToolUi(activeBrushTool, false);
        applyBrushControls();
      }
    })();
  }
}

function updateRenderingModeControlAvailability(): void {
  if (
    activeCanvasTool === "fill"
    || activeCanvasTool === "selection"
    || activeCanvasTool === "transform"
  ) return;
  const size = element<HTMLInputElement>("brushSize");
  size.min = "1";
  size.max = "1000";
  if (rangeValue("brushSize") > Number(size.max)) {
    setControlValue("brushSize", Number(size.max));
  }
}

function updateViewRotationControl(degrees: number, snappedToZero: boolean): void {
  const rounded = Math.abs(degrees) < 0.05 ? 0 : Math.round(degrees * 10) / 10;
  const formatted = (Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1))
    .replace(".", ",");
  viewRotationButton.textContent = `${formatted}°`;
  viewRotationButton.classList.toggle("snapped", snappedToZero && rounded === 0);
  viewRotationButton.setAttribute(
    "aria-label",
    `Rotazione vista ${formatted} gradi; premi per azzerare`,
  );
  viewRotationButton.title = snappedToZero && rounded === 0
    ? "Rotazione agganciata a 0°"
    : `Rotazione vista ${formatted}° · premi per azzerare`;
}

function setControlsPanelOpen(open: boolean): void {
  controlsPanelOpen = open;
  controlsPanel.hidden = !open;
  toggleControlsButton.setAttribute("aria-expanded", String(open));
  toggleControlsButton.setAttribute("aria-label", open ? "Nascondi pannelli" : "Mostra pannelli");
  toggleControlsButton.title = open ? "Nascondi pannelli" : "Mostra pannelli";
}

const MOBILE_BRUSH_PREVIEW_CSS_SIZE = 124;
const MOBILE_BRUSH_PREVIEW_MAX_TIP_CSS_PIXELS = 92;
const MOBILE_BRUSH_CONTROL_INDICATOR_MAX_CSS_PIXELS = 41;

function clampMobileBrushPercent(value: number, minimum: number): number {
  return Math.min(100, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}

function mobileBrushControlElement(kind: MobileBrushControlKind): HTMLElement {
  if (kind === "size") return mobileBrushSizeControl;
  if (kind === "opacity") return mobileBrushOpacityControl;
  if (kind === "stretch") return mobileBrushStretchControl;
  return mobileBrushPaintControl;
}

function mobileBrushControlTrack(kind: MobileBrushControlKind): HTMLElement {
  if (kind === "size") return mobileBrushSizeTrack;
  if (kind === "opacity") return mobileBrushOpacityTrack;
  if (kind === "stretch") return mobileBrushStretchTrack;
  return mobileBrushPaintTrack;
}

function mobileBrushControlInput(kind: MobileBrushControlKind): HTMLInputElement {
  return element<HTMLInputElement>(
    kind === "size"
      ? "brushSize"
      : kind === "opacity"
        ? "opacity"
        : kind === "stretch"
          ? "blendStretch"
          : "blendPaint",
  );
}

function mobileBrushControlPercent(kind: MobileBrushControlKind): number {
  const input = mobileBrushControlInput(kind);
  const value = Number(input.value);
  if (kind !== "size") {
    return clampMobileBrushPercent(value, 0);
  }
  const minimum = Number(input.min);
  const maximum = Number(input.max);
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum <= minimum) {
    return 0;
  }
  const normalized = Math.min(1, Math.max(0, (value - minimum) / (maximum - minimum)));
  return normalized * 100;
}

function setMobileBrushControlPercent(kind: MobileBrushControlKind, requested: number): void {
  const input = mobileBrushControlInput(kind);
  if (kind !== "size") {
    const percent = clampMobileBrushPercent(requested, 0);
    input.value = (Math.round(percent * 10) / 10).toString();
  } else {
    const percent = clampMobileBrushPercent(requested, 0);
    const minimum = Number(input.min);
    const maximum = Number(input.max);
    input.value = Math.round(minimum + percent / 100 * (maximum - minimum)).toString();
  }
  syncMobileBrushControlVisuals();
}

function mobileBrushControlLabel(kind: MobileBrushControlKind): string {
  const value = Number(mobileBrushControlInput(kind).value);
  if (kind === "size") return `Size ${Math.round(value)} px`;
  if (kind === "opacity") return `Opacity ${Math.round(value)}%`;
  if (kind === "stretch") return `Stretch ${Math.round(value)}%`;
  return `Paint ${Math.round(value)}%`;
}

function syncMobileBrushControlVisual(kind: MobileBrushControlKind): void {
  const control = mobileBrushControlElement(kind);
  const input = mobileBrushControlInput(kind);
  const percent = mobileBrushControlPercent(kind);
  const roundedPercent = Math.round(percent);
  const value = Number(input.value);
  const label = mobileBrushControlLabel(kind);
  control.style.setProperty(
    "--mobile-brush-control-position",
    `${(100 - percent).toFixed(3)}%`,
  );
  control.setAttribute("aria-valuemin", input.min);
  control.setAttribute("aria-valuemax", input.max);
  control.setAttribute(
    "aria-valuenow",
    String(kind === "size" ? Math.round(value) : roundedPercent),
  );
  control.setAttribute("aria-valuetext", label);
  if (kind === "size") {
    const indicatorDiameter = Math.max(
      1,
      MOBILE_BRUSH_CONTROL_INDICATOR_MAX_CSS_PIXELS * percent / 100,
    );
    control.style.setProperty(
      "--mobile-brush-size-indicator",
      `${indicatorDiameter.toFixed(2)}px`,
    );
  } else {
    const indicatorDiameter = MOBILE_BRUSH_CONTROL_INDICATOR_MAX_CSS_PIXELS * percent / 100;
    control.style.setProperty(
      "--mobile-brush-opacity-indicator",
      `${indicatorDiameter.toFixed(2)}px`,
    );
  }
}

function renderMobileBrushPreview(): void {
  if (!mobileBrushControlDrag || !mobileUiMediaQuery.matches) return;
  const kind = mobileBrushControlDrag.kind;
  if (kind === "stretch" || kind === "paint") return;
  const percent = mobileBrushControlPercent(kind);
  const diameter = kind === "size"
    ? MOBILE_BRUSH_PREVIEW_MAX_TIP_CSS_PIXELS * percent / 100
    : MOBILE_BRUSH_PREVIEW_MAX_TIP_CSS_PIXELS * 0.72;
  const alpha = kind === "opacity" ? percent / 100 : 1;
  engine.renderBrushTipPreview(
    mobileBrushPreviewCanvas,
    MOBILE_BRUSH_PREVIEW_CSS_SIZE,
    diameter,
    alpha,
  );
}

function scheduleMobileBrushPreview(): void {
  if (mobileBrushPreviewFrame !== null || !mobileBrushControlDrag) return;
  mobileBrushPreviewFrame = requestAnimationFrame(() => {
    mobileBrushPreviewFrame = null;
    renderMobileBrushPreview();
  });
}

function syncMobileBrushControlVisuals(): void {
  syncMobileBrushControlVisual("size");
  syncMobileBrushControlVisual("opacity");
  syncMobileBrushControlVisual("stretch");
  syncMobileBrushControlVisual("paint");
  if (mobileBrushControlDrag) {
    const kind = mobileBrushControlDrag.kind;
    mobileBrushPreviewLabel.value = mobileBrushControlLabel(kind);
    scheduleMobileBrushPreview();
  }
}

function syncMobileBrushControlAvailability(locked = interactionLocked()): void {
  const brushContext = activeCanvasTool === "paint" || activeCanvasTool === "blend";
  const sizeDisabled = locked || !brushContext;
  const opacityDisabled = locked || activeCanvasTool !== "paint";
  const blendControlDisabled = locked || activeCanvasTool !== "blend";
  for (const [control, disabled] of [
    [mobileBrushSizeControl, sizeDisabled],
    [mobileBrushOpacityControl, opacityDisabled],
    [mobileBrushStretchControl, blendControlDisabled],
    [mobileBrushPaintControl, blendControlDisabled],
  ] as const) {
    control.setAttribute("aria-disabled", String(disabled));
    control.tabIndex = disabled ? -1 : 0;
  }
}

function syncMobileBrushControlsVisibility(): void {
  const brushContext = activeCanvasTool === "paint" || activeCanvasTool === "blend";
  const blend = activeCanvasTool === "blend";
  const suppressed = !mobileUiMediaQuery.matches
    || !brushContext
    || mobileLayersPanelOpen
    || mobileToolsSheetOpen
    || mobileBrushLibraryOpen
    || mobileStrokeSheet?.isOpen === true
    || mobileRasterEffectsSheet?.isOpen === true
    || mobileToolSettingsSheet?.isOpen === true
    || mobileBrushStudio?.isOpen === true;
  if (suppressed && mobileBrushControlDrag) {
    finishMobileBrushControlDrag(true);
  }
  mobileBrushControls.classList.toggle("is-suppressed", suppressed);
  mobileBrushControls.classList.toggle("is-blend", blend);
  mobileBrushControls.setAttribute(
    "aria-label",
    blend ? "Blend size, stretch and paint" : "Brush size and opacity",
  );
  mobileBrushOpacityTrack.hidden = blend;
  mobileBrushStretchTrack.hidden = !blend;
  mobileBrushPaintTrack.hidden = !blend;
  mobileBrushControls.setAttribute("aria-hidden", String(suppressed));
}

function finishMobileBrushControlDrag(commit: boolean): void {
  const drag = mobileBrushControlDrag;
  if (!drag) return;
  const control = mobileBrushControlElement(drag.kind);
  mobileBrushControlDrag = null;
  if (control.hasPointerCapture(drag.pointerId)) {
    control.releasePointerCapture(drag.pointerId);
  }
  if (mobileBrushPreviewFrame !== null) {
    cancelAnimationFrame(mobileBrushPreviewFrame);
    mobileBrushPreviewFrame = null;
  }
  control.classList.remove("is-active");
  mobileBrushControls.classList.remove("is-adjusting");
  mobileBrushControls.removeAttribute("data-active");
  mobileBrushPreview.setAttribute("aria-hidden", "true");
  if (!commit) {
    mobileBrushControlInput(drag.kind).value = drag.startInputValue;
  }
  if (mobileBrushControlInput(drag.kind).value !== drag.startInputValue) {
    applyBrushControls();
  } else {
    syncMobileBrushControlVisuals();
  }
  updateHistoryControls();
}

function syncMobileBrushLibraryButtonState(): void {
  const paintSelected = activeCanvasTool === "paint";
  const studioOpen = mobileBrushStudio?.isOpen === true;
  const expanded = paintSelected && (mobileBrushLibraryOpen || studioOpen);
  mobilePaintButton.setAttribute("aria-expanded", String(expanded));
  mobilePaintButton.setAttribute(
    "aria-label",
    paintSelected
      ? expanded
        ? studioOpen
          ? "Brush Studio open"
          : "Close brush library"
        : "Open brush library"
      : "Select Brush",
  );
}

function mobileBrushLibraryClosedOffset(): number {
  return Math.max(0, Math.round(mobileBrushLibrarySheet.offsetHeight));
}

function setMobileBrushLibraryOffset(offsetPx: number): void {
  mobileBrushLibraryOffsetPx = Math.min(
    mobileBrushLibraryClosedOffset(),
    Math.max(0, offsetPx),
  );
  mobileBrushLibrarySheet.style.setProperty(
    "--mobile-tools-sheet-offset",
    `${Math.round(mobileBrushLibraryOffsetPx)}px`,
  );
}

function markMobileBrushLibraryPreviewDirty(): void {
  mobileBrushLibraryPreviewDirty = true;
  mobileBrushLibraryPreviewRevision += 1;
  if (mobileBrushLibraryOpen) {
    scheduleMobileBrushLibraryPreview();
  }
}

function mobileCurrentBrushFallback(
  current: Readonly<BrushSettings>,
): BrushSettings {
  return {
    ...defaultBrushSettings,
    color: current.color,
    tool: "paint",
    hardness: 1,
  };
}

function mobileBrushLibraryCanvasForBrush(
  brushId: MobileBrushLibraryBrushId,
): HTMLCanvasElement {
  return brushId === PENCIL_BRUSH_PRESET.id
    ? mobilePencilBrushPreviewCanvas
    : mobileBrushLibraryPreviewCanvas;
}

function mobileBrushLibraryVisibleBrushIds(): MobileBrushLibraryBrushId[] {
  const visible = [activeMobileBrushLibraryBrushId];
  for (const card of mobileBrushLibraryCards) {
    const brushId = card.dataset.mobileBrushId as MobileBrushLibraryBrushId | undefined;
    if (
      brushId
      && brushId !== activeMobileBrushLibraryBrushId
      && card.dataset.mobileBrushCategoryCard === mobileBrushLibraryCategory
    ) {
      visible.push(brushId);
    }
  }
  return visible;
}

function mobileBrushLibrarySettingsForBrush(
  brushId: MobileBrushLibraryBrushId,
  currentSettings: Readonly<BrushSettings>,
): BrushSettings {
  const previewIsActive = brushId === activeMobileBrushLibraryBrushId;
  const fallbackSettings = brushId === PENCIL_BRUSH_PRESET.id
    ? resolveBrushPresetSettings(PENCIL_BRUSH_PRESET, currentSettings)
    : mobileCurrentBrushFallback(currentSettings);
  return previewIsActive
    ? currentSettings
    : mobileBrushStudio?.settingsSnapshot(brushId, fallbackSettings)
      ?? fallbackSettings;
}

function renderMobileBrushLibraryPreview(): void {
  if (!mobileBrushLibraryOpen || !mobileUiMediaQuery.matches) return;
  const currentSettings = engine.getSettings();
  const previewBrushIds = mobileBrushLibraryVisibleBrushIds();
  const revision = mobileBrushLibraryPreviewRevision;
  mobileBrushLibraryPreviewDirty = false;
  void Promise.all(previewBrushIds.map((brushId) => (
    mobileBrushLibraryPreviewRenderer.render(
      brushId,
      mobileBrushLibraryCanvasForBrush(brushId),
      mobileBrushLibrarySettingsForBrush(brushId, currentSettings),
    )
  )))
    .then(() => {
      if (
        mobileBrushLibraryOpen
        && mobileBrushLibraryPreviewDirty
        && revision !== mobileBrushLibraryPreviewRevision
      ) {
        scheduleMobileBrushLibraryPreview();
      }
    })
    .catch(() => {
      // Keep the last compact bitmap; a later open retries missing CPU assets.
    });
}

function scheduleMobileBrushLibraryPreview(): void {
  if (mobileBrushLibraryPreviewFrame !== null) return;
  mobileBrushLibraryPreviewFrame = requestAnimationFrame(() => {
    mobileBrushLibraryPreviewFrame = null;
    renderMobileBrushLibraryPreview();
  });
}

function setMobileBrushLibraryCategory(category: MobileBrushLibraryCategory): void {
  mobileBrushLibraryCategory = category;
  for (const button of mobileBrushLibraryCategoryButtons) {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.mobileBrushCategory === category),
    );
  }
  const orderedVisibleCards = mobileBrushLibraryCards.filter((card) => (
    card.dataset.mobileBrushId === activeMobileBrushLibraryBrushId
  ));
  orderedVisibleCards.push(...mobileBrushLibraryCards.filter((card) => (
    card.dataset.mobileBrushId !== activeMobileBrushLibraryBrushId
    && card.dataset.mobileBrushCategoryCard === category
  )));
  for (const card of mobileBrushLibraryCards) {
    const visible = orderedVisibleCards.includes(card);
    card.hidden = !visible;
  }
  for (const card of orderedVisibleCards) mobileBrushLibraryList.append(card);
  for (const card of mobileBrushLibraryCards) {
    if (!orderedVisibleCards.includes(card)) mobileBrushLibraryList.append(card);
  }
  const visibleCards = orderedVisibleCards.length;
  mobileBrushLibraryList.hidden = visibleCards === 0;
  mobileBrushLibraryEmpty.hidden = visibleCards !== 0;
  if (visibleCards > 0) {
    const needsPreview = mobileBrushLibraryPreviewDirty
      || mobileBrushLibraryVisibleBrushIds().some((brushId) => {
        const canvas = mobileBrushLibraryCanvasForBrush(brushId);
        return !canvas.dataset.previewFingerprint
          || canvas.dataset.previewSourceComplete !== "true";
      });
    if (needsPreview) {
      scheduleMobileBrushLibraryPreview();
    }
  }
}

function syncMobileBrushLibrarySelection(): void {
  for (const card of mobileBrushLibraryCards) {
    const selected = card.dataset.mobileBrushId === activeMobileBrushLibraryBrushId;
    card.classList.toggle("is-selected", selected);
    card.setAttribute("aria-pressed", String(selected));
    const name = card.querySelector<HTMLElement>(".mobile-brush-card-name")?.textContent
      ?.trim() || "Brush";
    card.setAttribute("aria-label", selected ? `${name}, selected` : name);
  }
}

function setMobileBrushLibraryOpen(open: boolean): void {
  if (open && (!mobileUiMediaQuery.matches || activeCanvasTool !== "paint")) return;
  if (open && mobileBrushStudio?.isOpen) mobileBrushStudio.cancel(false);
  if (open && mobileStrokeSheet?.isOpen) mobileStrokeSheet.close(false);
  if (open && mobileRasterEffectsSheet?.isOpen) mobileRasterEffectsSheet.close(false);
  if (open && mobileToolSettingsSheet?.isOpen) mobileToolSettingsSheet.close(false);
  if (open && mobileToolsSheetOpen) setMobileToolsSheetOpen(false);
  if (open && mobileLayersPanelOpen) setMobileLayersPanelOpen(false);

  mobileBrushLibraryOpen = open;
  mobileBrushLibrarySheet.setAttribute("aria-hidden", String(!open));
  syncMobileBrushLibraryButtonState();
  if (open) {
    setControlsPanelOpen(false);
    setMobileBrushLibraryCategory(mobileBrushLibraryCategory);
    setMobileBrushLibraryOffset(0);
    void mobileBrushLibrarySheet.offsetHeight;
    mobileBrushLibrarySheet.classList.add("is-open");
    const needsPreview = mobileBrushLibraryPreviewDirty
      || mobileBrushLibraryVisibleBrushIds().some((brushId) => {
        const canvas = mobileBrushLibraryCanvasForBrush(brushId);
        return !canvas.dataset.previewFingerprint
          || canvas.dataset.previewSourceComplete !== "true";
      });
    if (needsPreview) {
      scheduleMobileBrushLibraryPreview();
    }
    syncMobileBrushControlsVisibility();
    return;
  }

  mobileBrushLibrarySheet.classList.remove("is-open", "is-dragging");
  if (
    mobileBrushLibraryDragPointerId !== null
    && mobileBrushLibraryHandle.hasPointerCapture(mobileBrushLibraryDragPointerId)
  ) {
    mobileBrushLibraryHandle.releasePointerCapture(mobileBrushLibraryDragPointerId);
  }
  mobileBrushLibraryDragPointerId = null;
  mobileBrushLibraryDragMoved = false;
  if (mobileBrushLibraryPreviewFrame !== null) {
    cancelAnimationFrame(mobileBrushLibraryPreviewFrame);
    mobileBrushLibraryPreviewFrame = null;
  }
  syncMobileBrushControlsVisibility();
}

function recordMobileBrushLibraryDragMotion(clientY: number): void {
  const sampleTime = performance.now();
  const elapsedMs = sampleTime - mobileBrushLibraryDragLastTime;
  if (elapsedMs > 0 && elapsedMs <= 120) {
    const immediateVelocity = (clientY - mobileBrushLibraryDragLastY) / elapsedMs;
    mobileBrushLibraryDragVelocityY = mobileBrushLibraryDragVelocityY === 0
      ? immediateVelocity
      : mobileBrushLibraryDragVelocityY * 0.35 + immediateVelocity * 0.65;
  } else if (elapsedMs > 120) {
    mobileBrushLibraryDragVelocityY = 0;
  }
  mobileBrushLibraryDragLastY = clientY;
  mobileBrushLibraryDragLastTime = sampleTime;
}

function finishMobileBrushLibraryDrag(event: PointerEvent, cancelled = false): void {
  if (event.pointerId !== mobileBrushLibraryDragPointerId) return;
  if (mobileBrushLibraryHandle.hasPointerCapture(event.pointerId)) {
    mobileBrushLibraryHandle.releasePointerCapture(event.pointerId);
  }
  mobileBrushLibrarySheet.classList.remove("is-dragging");
  const deltaY = event.clientY - mobileBrushLibraryDragStartY;
  const closedOffset = mobileBrushLibraryClosedOffset();
  const releaseMotionAgeMs = performance.now() - mobileBrushLibraryDragLastTime;
  const releaseVelocityY = releaseMotionAgeMs <= 100
    ? mobileBrushLibraryDragVelocityY
    : 0;
  const shouldClose = shouldCloseMobileToolsSheetDrag({
    startSnap: "expanded",
    deltaY,
    releaseVelocityY,
    offsetPx: mobileBrushLibraryOffsetPx,
    peekOffsetPx: Math.min(closedOffset, Math.max(96, closedOffset * 0.22)),
    closedOffsetPx: closedOffset,
  });
  mobileBrushLibraryDragPointerId = null;
  if (cancelled) {
    setMobileBrushLibraryOffset(0);
    mobileBrushLibraryDragMoved = false;
    return;
  }
  if (mobileBrushLibraryDragMoved && shouldClose) {
    setMobileBrushLibraryOpen(false);
    return;
  }
  if (mobileBrushLibraryDragMoved) setMobileBrushLibraryOffset(0);
}

function mobileToolsSheetPeekOffset(): number {
  const peekHeight = Math.min(240, Math.max(160, window.innerHeight * 0.26));
  return Math.max(0, Math.round(mobileToolsSheet.offsetHeight - peekHeight));
}

function mobileToolsSheetClosedOffset(): number {
  return Math.max(0, Math.round(mobileToolsSheet.offsetHeight));
}

function normalizeMobileToolsSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("it-IT")
    .trim();
}

function filterMobileTools(): void {
  const query = normalizeMobileToolsSearch(mobileToolsSearchInput.value);
  let visibleToolCount = 0;
  for (const category of mobileToolsCategories) {
    let visibleInCategory = 0;
    const tools = category.querySelectorAll<HTMLButtonElement>("[data-mobile-tool]");
    for (const tool of tools) {
      const searchText = normalizeMobileToolsSearch(
        `${tool.textContent ?? ""} ${tool.dataset.mobileToolSearch ?? ""}`,
      );
      const visible = query.length === 0 || searchText.includes(query);
      tool.hidden = !visible;
      if (visible) visibleInCategory += 1;
    }
    category.hidden = visibleInCategory === 0;
    visibleToolCount += visibleInCategory;
  }
  mobileToolsEmpty.hidden = visibleToolCount !== 0;
}

function selectedMobileTextNode() {
  if (!engineInitialized) return null;
  const snapshot = engine.getMixedSceneSnapshot();
  const selected = snapshot?.items.find((item) => item.key === snapshot.selectedKey);
  return selected?.kind === "text" ? selected.textNode : null;
}

function selectedMobileSvgNode() {
  if (!engineInitialized) return null;
  const snapshot = engine.getMixedSceneSnapshot();
  const selected = snapshot?.items.find((item) => item.key === snapshot.selectedKey);
  return selected?.kind === "svg" ? selected.svgNode : null;
}

interface MobileLayerProperties {
  readonly key: MobileMixedSceneLayerKey;
  readonly name: string;
  readonly kind: MobileLayerKind;
  readonly opacity: number;
  readonly blendMode: LayerBlendMode | null;
  readonly rasterIndex: number | null;
  readonly semanticId: number | null;
  readonly clippingEnabled: boolean;
  readonly clippingAvailable: boolean;
  readonly locked: boolean;
}

function mobileLayerProperties(
  requestedKey: string | null = null,
): MobileLayerProperties | null {
  if (!engineInitialized) return null;
  const stats = engine.getStats();
  const locked = interactionLocked() || layerSwitching;
  const scene = stats.mixedScene;
  if (!scene) {
    const active = stats.layers[stats.activeLayerIndex];
    const key = requestedKey ?? (active ? `raster:${active.id}` : null);
    if (!key || !isMobileMixedSceneLayerKey(key)) return null;
    const rasterIndex = stats.layers.findIndex((layer) => `raster:${layer.id}` === key);
    const layer = stats.layers[rasterIndex];
    if (!layer) return null;
    const clippingEnabled = layer.clippingParentId !== null;
    return {
      key,
      name: mobileLayerDisplayName(layer.name),
      kind: "raster",
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      rasterIndex,
      semanticId: null,
      clippingEnabled,
      clippingAvailable: clippingEnabled || rasterIndex > 0,
      locked,
    };
  }

  const key = requestedKey ?? scene.selectedKey;
  if (!isMobileMixedSceneLayerKey(key)) return null;
  const sceneIndex = scene.items.findIndex((item) => item.key === key);
  const item = scene.items[sceneIndex];
  if (!item) return null;
  if (item.kind === "raster") {
    const layer = stats.layers[item.rasterLayerIndex];
    if (!layer) return null;
    const clippingEnabled = item.rasterClippingParentId !== null;
    const hasAdjacentRasterBelow = sceneIndex > 0
      && scene.items[sceneIndex - 1]?.kind === "raster";
    return {
      key,
      name: mobileLayerDisplayName(layer.name),
      kind: "raster",
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      rasterIndex: item.rasterLayerIndex,
      semanticId: null,
      clippingEnabled,
      clippingAvailable: clippingEnabled || hasAdjacentRasterBelow,
      locked,
    };
  }
  const node = item.kind === "text"
    ? item.textNode
    : item.kind === "svg"
      ? item.svgNode
      : item.imageNode;
  return {
    key,
    name: mobileLayerDisplayName(node.name),
    kind: item.kind,
    opacity: node.opacity,
    blendMode: null,
    rasterIndex: null,
    semanticId: node.id,
    clippingEnabled: false,
    clippingAvailable: false,
    locked,
  };
}

function closeMobileLayerContextMenu(restoreFocus = false): void {
  const key = mobileLayerContextKey;
  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLElement && mobileLayerContextMenu.contains(activeElement)) {
    if (restoreFocus && key) {
      mobileLayerList.querySelector<HTMLButtonElement>(
        `[data-layer-key="${CSS.escape(key)}"] .mobile-layer-select`,
      )?.focus({ preventScroll: true });
    } else {
      activeElement.blur();
    }
  }
  mobileLayerContextKey = null;
  mobileLayerContextMenu.hidden = true;
  mobileLayerContextMenu.setAttribute("inert", "");
  delete mobileLayerContextMenu.dataset.layerKey;
}

function openMobileLayerContextMenu(
  key: MobileMixedSceneLayerKey,
  row: HTMLElement,
): boolean {
  const properties = mobileLayerProperties(key);
  if (!properties || properties.locked || !row.classList.contains("is-selected")) return false;
  mobileLayerContextKey = key;
  mobileLayerContextMenu.dataset.layerKey = key;
  mobileLayerClippingButton.hidden = properties.kind !== "raster";
  mobileLayerClippingButton.disabled = properties.kind !== "raster"
    || !properties.clippingAvailable;
  mobileLayerClippingButton.setAttribute(
    "aria-checked",
    String(properties.clippingEnabled),
  );
  mobileLayerClippingButton.textContent = properties.clippingEnabled
    ? "Disable Clipping Mask"
    : "Clipping Mask";
  mobileLayerOptionsButton.disabled = false;
  mobileLayerContextMenu.hidden = false;
  mobileLayerContextMenu.removeAttribute("inert");
  const panelRect = mobileLayersPanel.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const menuHeight = mobileLayerContextMenu.offsetHeight;
  const preferredBelow = rowRect.bottom - panelRect.top + 4;
  const preferredAbove = rowRect.top - panelRect.top - menuHeight - 4;
  const maximumTop = Math.max(8, panelRect.height - menuHeight - 8);
  const top = preferredBelow + menuHeight <= panelRect.height - 8
    ? preferredBelow
    : preferredAbove;
  mobileLayerContextMenu.style.setProperty(
    "--mobile-layer-context-top",
    `${Math.round(Math.min(maximumTop, Math.max(8, top)))}px`,
  );
  return true;
}

function syncMobileToolsMenuState(): void {
  const selectedText = selectedMobileTextNode();
  const selectedSvg = selectedMobileSvgNode();
  for (const button of mobileToolsCanvasButtons) {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.mobileCanvasTool === activeCanvasTool),
    );
  }
  for (const button of mobileToolsProxyButtons) {
    const targetId = button.dataset.mobileProxyButton;
    const target = targetId
      ? document.getElementById(targetId) as HTMLButtonElement | null
      : null;
    button.disabled = target === null || target.disabled || vectorTextPrototype === null;
  }
  for (const button of mobileToolSettingsButtons) {
    const kind = button.dataset.mobileToolSheet;
    const svgEditor = kind === "svg-style";
    const textEditor = kind === "text"
      || kind === "text-warp"
      || kind === "text-outline"
      || kind === "text-drop-shadow"
      || kind === "text-inner-shadow"
      || kind === "text-block-shadow";
    const textEffect = textEditor && kind !== "text";
    button.disabled = !engineInitialized
      || interactionLocked()
      || (textEditor && vectorTextPrototype === null)
      || (textEffect && selectedText === null)
      || (svgEditor && (vectorTextPrototype === null || selectedSvg === null));
    if (svgEditor) {
      button.setAttribute("aria-pressed", String(selectedSvg !== null));
      continue;
    }
    if (!textEditor) continue;
    const pressed = kind === "text"
      ? selectedText !== null
      : kind === "text-warp"
        ? selectedText?.transformType !== undefined && selectedText.transformType !== "none"
        : kind === "text-outline"
          ? (selectedText?.outlineWidth ?? 0) > 0
          : kind === "text-drop-shadow"
            ? selectedText?.singleShadowEnabled === true
            : kind === "text-inner-shadow"
              ? selectedText?.innerShadowEnabled === true
              : selectedText?.blockShadowEnabled === true;
    button.setAttribute("aria-pressed", String(pressed));
  }
  for (const button of mobileToolsEffectButtons) {
    const controlId = button.dataset.mobileEffectControl;
    const control = controlId
      ? document.getElementById(controlId) as HTMLInputElement | null
      : null;
    button.disabled = control === null || control.disabled || !engineInitialized;
    button.setAttribute("aria-pressed", String(control?.checked === true));
  }
}

function setMobileToolsSheetOffset(offsetPx: number, allowClose = false): void {
  const maximumOffset = allowClose
    ? mobileToolsSheetClosedOffset()
    : mobileToolsSheetPeekOffset();
  mobileToolsSheetOffsetPx = Math.min(maximumOffset, Math.max(0, offsetPx));
  mobileToolsSheet.style.setProperty(
    "--mobile-tools-sheet-offset",
    `${Math.round(mobileToolsSheetOffsetPx)}px`,
  );
}

function snapMobileToolsSheet(snap: MobileToolsSheetSnap): void {
  mobileToolsSheetSnap = snap;
  mobileToolsSheet.dataset.snap = snap;
  mobileToolsSheetHandle.setAttribute("aria-expanded", String(snap === "expanded"));
  mobileToolsSheetHandle.setAttribute(
    "aria-label",
    snap === "expanded" ? "Collapse tools menu" : "Expand tools menu",
  );
  setMobileToolsSheetOffset(snap === "expanded" ? 0 : mobileToolsSheetPeekOffset());
}

function recordMobileToolsSheetDragMotion(clientY: number): void {
  const sampleTime = performance.now();
  const elapsedMs = sampleTime - mobileToolsSheetDragLastTime;
  if (elapsedMs > 0 && elapsedMs <= 120) {
    const immediateVelocity = (clientY - mobileToolsSheetDragLastY) / elapsedMs;
    mobileToolsSheetDragVelocityY = mobileToolsSheetDragVelocityY === 0
      ? immediateVelocity
      : mobileToolsSheetDragVelocityY * 0.35 + immediateVelocity * 0.65;
  } else if (elapsedMs > 120) {
    mobileToolsSheetDragVelocityY = 0;
  }
  mobileToolsSheetDragLastY = clientY;
  mobileToolsSheetDragLastTime = sampleTime;
}

function expandMobileToolsSheetForSearchFocus(): void {
  if (!mobileToolsSheetOpen || mobileToolsSheetSnap === "expanded") return;
  mobileToolsSheet.classList.add("is-search-focus-snap");
  snapMobileToolsSheet("expanded");
  void mobileToolsSearchInput.getBoundingClientRect();
  requestAnimationFrame(() => {
    mobileToolsSheet.classList.remove("is-search-focus-snap");
  });
}

function requestMobileLayersRefresh(): void {
  mobileLayersRefreshRequested = true;
}

function scheduleMobileLayersRefresh(): void {
  requestMobileLayersRefresh();
  if (!mobileLayersPanelOpen || mobileLayersRefreshFrame !== null) return;
  mobileLayersRefreshFrame = requestAnimationFrame(() => {
    mobileLayersRefreshFrame = null;
    renderMobileLayerList(engine.getStats());
  });
}

function cancelMobileLayerThumbnailCaptureTimer(): void {
  if (mobileLayerThumbnailCaptureTimer === null) return;
  window.clearTimeout(mobileLayerThumbnailCaptureTimer);
  mobileLayerThumbnailCaptureTimer = null;
}

function requestMobileLayerThumbnailCapture(delayMs = 120): void {
  if (
    !mobileLayersPanelOpen
    || !engineInitialized
    || mobileLayerReorderGesture !== null
    || mobileLayerThumbnailCaptureUnavailable
  ) {
    return;
  }
  mobileLayerThumbnailCaptureRequested = true;
  if (
    mobileLayerThumbnailCaptureInFlight
    || mobileLayerThumbnailCaptureTimer !== null
  ) {
    return;
  }
  mobileLayerThumbnailCaptureTimer = window.setTimeout(() => {
    mobileLayerThumbnailCaptureTimer = null;
    void captureRequestedMobileLayerThumbnail();
  }, Math.max(0, delayMs));
}

async function captureRequestedMobileLayerThumbnail(): Promise<void> {
  if (
    !mobileLayerThumbnailCaptureRequested
    || !mobileLayersPanelOpen
    || !engineInitialized
    || mobileLayerReorderGesture !== null
    || mobileLayerThumbnailCaptureUnavailable
  ) {
    return;
  }
  if (
    activePointerId !== null
    || layerSwitching
    || historyState.openEdit !== null
    || historyState.busy
  ) {
    requestMobileLayerThumbnailCapture(160);
    return;
  }

  const stats = engine.getStats();
  const activeLayer = stats.layers[stats.activeLayerIndex];
  if (!activeLayer) return;
  mobileLayerThumbnailCaptureRequested = false;
  if (!activeLayer.hasContent) {
    if (mobileRasterThumbnailCache.delete(activeLayer.id)) {
      mobileLayersRenderSignature = "";
      scheduleMobileLayersRefresh();
    }
    return;
  }

  mobileLayerThumbnailCaptureInFlight = true;
  try {
    const capture = await engine.captureActiveLayerThumbnail();
    if (!engine.getStats().layers.some((layer) => layer.id === capture.layerId)) {
      return;
    }
    mobileLayerThumbnailRevision += 1;
    const imageBytes = new Uint8ClampedArray(capture.rgba.length);
    imageBytes.set(capture.rgba);
    mobileRasterThumbnailCache.set(capture.layerId, {
      imageData: new ImageData(imageBytes, capture.width, capture.height),
      revision: mobileLayerThumbnailRevision,
    });
    mobileLayersRenderSignature = "";
    scheduleMobileLayersRefresh();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("rimandata") && mobileLayersPanelOpen) {
      mobileLayerThumbnailCaptureRequested = true;
    } else {
      mobileLayerThumbnailCaptureUnavailable = true;
      console.warn("Miniature raster GPU non disponibili; resta il fallback strutturale.", error);
    }
  } finally {
    mobileLayerThumbnailCaptureInFlight = false;
    if (mobileLayerThumbnailCaptureRequested) {
      requestMobileLayerThumbnailCapture(160);
    }
  }
}

function announceMobileLayerReorder(message: string): void {
  mobileLayerReorderStatus.textContent = "";
  requestAnimationFrame(() => {
    mobileLayerReorderStatus.textContent = message;
  });
}

function mobileLayerRows(): HTMLElement[] {
  return Array.from(
    mobileLayerList.querySelectorAll<HTMLElement>(":scope > [data-layer-key]"),
  );
}

function mobileLayerReorderOriginalSlot(
  orderedKeys: readonly string[],
  movingKeys: readonly string[],
): number {
  const moving = new Set(movingKeys);
  const firstMovingIndex = orderedKeys.findIndex((key) => moving.has(key));
  if (firstMovingIndex < 0) return 0;
  return orderedKeys
    .slice(0, firstMovingIndex)
    .filter((key) => !moving.has(key)).length;
}

function isMobileMixedSceneLayerKey(key: string): key is MobileMixedSceneLayerKey {
  return /^(?:raster|text|svg|image):\d+$/.test(key);
}

function mobileLayerReorderPlanFromEngine(
  key: MobileMixedSceneLayerKey,
): MobileLayerReorderPlan | null {
  try {
    const targets = engine.getMixedSceneReorderTargets(key);
    const orderedKeys = mobileLayerRows()
      .map((row) => row.dataset.layerKey)
      .filter((candidate): candidate is string => candidate !== undefined);
    return {
      selectedKey: key,
      draggedKeys: [...targets.movingKeys],
      remainingKeys: [...targets.topFirstKeysWithoutMoving],
      validSlots: [...targets.validTargetTopFirstSlots],
      originalSlot: mobileLayerReorderOriginalSlot(orderedKeys, targets.movingKeys),
    };
  } catch (error) {
    console.warn("Riordino livello mobile non disponibile.", error);
    return null;
  }
}

function clearMobileLayerReorderIndicators(): void {
  for (const row of mobileLayerRows()) {
    row.classList.remove(
      "is-reordering",
      "is-reorder-companion",
      "is-drop-before",
      "is-drop-after",
    );
    row.style.removeProperty("--mobile-layer-reorder-y");
  }
  mobileLayerList.classList.remove("is-reordering");
}

function setMobileLayerReorderDropIndicator(
  plan: MobileLayerReorderPlan,
  slot: number,
): void {
  const rowByKey = new Map(
    mobileLayerRows().map((row) => [row.dataset.layerKey ?? "", row] as const),
  );
  for (const row of rowByKey.values()) {
    row.classList.remove("is-drop-before", "is-drop-after");
  }
  if (plan.remainingKeys.length === 0) return;
  if (slot === plan.remainingKeys.length) {
    rowByKey.get(plan.remainingKeys[plan.remainingKeys.length - 1])
      ?.classList.add("is-drop-after");
    return;
  }
  rowByKey.get(plan.remainingKeys[slot])?.classList.add("is-drop-before");
}

function mobileLayerReorderSlotAnnouncement(
  plan: MobileLayerReorderPlan,
  slot: number,
): string {
  if (slot === 0) return "Move to top.";
  if (slot === plan.remainingKeys.length) return "Move to bottom.";
  const key = plan.remainingKeys[slot];
  const row = mobileLayerList.querySelector<HTMLElement>(
    `[data-layer-key="${CSS.escape(key)}"]`,
  );
  const name = row?.querySelector<HTMLElement>(".mobile-layer-name")?.textContent?.trim();
  return name ? `Move before ${name}.` : `Move to position ${slot + 1}.`;
}

function scheduleMobileLayerReorderFrame(): void {
  const gesture = mobileLayerReorderGesture;
  if (!gesture || gesture.phase !== "dragging" || gesture.frame !== null) return;
  gesture.frame = requestAnimationFrame(runMobileLayerReorderFrame);
}

function runMobileLayerReorderFrame(frameTime: number): void {
  const gesture = mobileLayerReorderGesture;
  if (!gesture || gesture.phase !== "dragging" || !gesture.plan) return;
  gesture.frame = null;
  const plan = gesture.plan;
  const elapsedSeconds = Math.min(0.05, Math.max(0, frameTime - gesture.lastFrameTime) / 1000);
  gesture.lastFrameTime = frameTime;
  const listRect = mobileLayerList.getBoundingClientRect();
  const velocity = mobileLayerReorderAutoScrollVelocity(
    gesture.clientY,
    listRect.top,
    listRect.bottom,
  );
  let autoScrolled = false;
  if (velocity !== 0 && elapsedSeconds > 0) {
    const previousScrollTop = mobileLayerList.scrollTop;
    mobileLayerList.scrollTop += velocity * elapsedSeconds;
    autoScrolled = mobileLayerList.scrollTop !== previousScrollTop;
  }

  const offsetY = gesture.clientY - gesture.startClientY
    + (mobileLayerList.scrollTop - gesture.startScrollTop);
  gesture.row.style.setProperty("--mobile-layer-reorder-y", `${offsetY.toFixed(2)}px`);
  const rowGeometry: MobileLayerReorderRowGeometry[] = mobileLayerRows().map((row) => {
    const rect = row.getBoundingClientRect();
    return {
      key: row.dataset.layerKey ?? "",
      top: rect.top,
      bottom: rect.bottom,
    };
  });
  const slot = mobileLayerReorderDropSlot(gesture.clientY, plan, rowGeometry);
  if (slot !== gesture.currentSlot) {
    gesture.currentSlot = slot;
    setMobileLayerReorderDropIndicator(plan, slot);
    announceMobileLayerReorder(mobileLayerReorderSlotAnnouncement(plan, slot));
  }
  if (autoScrolled) scheduleMobileLayerReorderFrame();
}

function armMobileLayerContextGesture(): void {
  const gesture = mobileLayerReorderGesture;
  if (!gesture || gesture.phase !== "pending") return;
  gesture.holdTimer = null;
  if (
    !mobileLayersPanelOpen
    || interactionLocked()
    || !gesture.row.classList.contains("is-selected")
  ) {
    cancelMobileLayerReorderGesture(false);
    return;
  }
  if (!openMobileLayerContextMenu(gesture.key, gesture.row)) {
    cancelMobileLayerReorderGesture(false);
    return;
  }
  gesture.phase = "armed";
  announceMobileLayerReorder(
    `${gesture.name} options open. Keep dragging to move the layer.`,
  );
}

function activateMobileLayerReorderGesture(): void {
  const gesture = mobileLayerReorderGesture;
  if (!gesture || gesture.phase !== "armed") return;
  closeMobileLayerContextMenu(false);
  const plan = mobileLayerReorderPlanFromEngine(gesture.key);
  if (!plan || plan.validSlots.length <= 1) {
    cancelMobileLayerReorderGesture(false);
    return;
  }
  gesture.phase = "dragging";
  gesture.plan = plan;
  gesture.currentSlot = plan.originalSlot;
  gesture.lastFrameTime = performance.now();
  mobileLayerList.classList.add("is-reordering");
  const moving = new Set(plan.draggedKeys);
  for (const row of mobileLayerRows()) {
    const rowKey = row.dataset.layerKey ?? "";
    if (rowKey === gesture.key) row.classList.add("is-reordering");
    else if (moving.has(rowKey)) row.classList.add("is-reorder-companion");
  }
  setMobileLayerReorderDropIndicator(plan, plan.originalSlot);
  announceMobileLayerReorder(
    `Moving ${gesture.name}. Drag up or down, then release.`,
  );
  scheduleMobileLayerReorderFrame();
}

function cancelMobileLayerReorderGesture(
  announce = true,
  restoreScroll = true,
  restoreFocus = true,
): void {
  const gesture = mobileLayerReorderGesture;
  if (!gesture) return;
  mobileLayerReorderGesture = null;
  if (gesture.holdTimer !== null) window.clearTimeout(gesture.holdTimer);
  if (gesture.frame !== null) cancelAnimationFrame(gesture.frame);
  clearMobileLayerReorderIndicators();
  if (restoreScroll) mobileLayerList.scrollTop = gesture.startScrollTop;
  if (gesture.select.hasPointerCapture(gesture.pointerId)) {
    gesture.select.releasePointerCapture(gesture.pointerId);
  }
  if (restoreFocus && gesture.restoreFocus && gesture.select.isConnected) {
    gesture.select.focus({ preventScroll: true });
  }
  if (announce && gesture.phase === "dragging") {
    announceMobileLayerReorder("Layer move canceled.");
  }
  if (gesture.phase === "armed") closeMobileLayerContextMenu(false);
  if (mobileLayersPanelOpen) {
    scheduleMobileLayersRefresh();
    requestMobileLayerThumbnailCapture();
  }
}

async function commitMobileLayerReorder(
  key: MobileMixedSceneLayerKey,
  name: string,
  targetTopFirstSlot: number,
  restoreScrollTop: number,
): Promise<void> {
  if (interactionLocked() || layerSwitching) {
    announceMobileLayerReorder("Layer move canceled.");
    return;
  }
  layerSwitching = true;
  updateHistoryControls();
  try {
    const changed = await engine.moveMixedSceneItem(key, targetTopFirstSlot);
    historyState = engine.getHistoryState();
    layerSwitchResult.textContent = changed
      ? `${name} moved.`
      : `${name} is already in that position.`;
    announceMobileLayerReorder(
      changed ? `${name} moved.` : `${name} is already in that position.`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Layer move failed.";
    layerSwitchResult.textContent = message;
    announceMobileLayerReorder(message);
  } finally {
    layerSwitching = false;
    mobileLayersRenderSignature = "";
    requestMobileLayersRefresh();
    updateHistoryControls();
    updateStats(engine.getStats());
    if (mobileLayersPanelOpen) {
      renderMobileLayerList(engine.getStats());
      mobileLayerList.scrollTop = Math.min(
        restoreScrollTop,
        Math.max(0, mobileLayerList.scrollHeight - mobileLayerList.clientHeight),
      );
      const row = mobileLayerList.querySelector<HTMLElement>(
        `[data-layer-key="${CSS.escape(key)}"]`,
      );
      row?.querySelector<HTMLButtonElement>(".mobile-layer-select")
        ?.focus({ preventScroll: true });
      requestMobileLayerThumbnailCapture();
    }
  }
}

function handleMobileLayerReorderPointerDown(event: PointerEvent): void {
  if (mobileLayerReorderGesture && mobileLayerReorderGesture.pointerId !== event.pointerId) {
    cancelMobileLayerReorderGesture();
    return;
  }
  if (
    mobileLayerReorderGesture
    || !event.isPrimary
    || (event.pointerType === "mouse" && event.button !== 0)
    || interactionLocked()
    || layerSwitching
  ) {
    return;
  }
  const target = event.target instanceof Element ? event.target : null;
  const select = target?.closest<HTMLButtonElement>(".mobile-layer-select");
  const row = select?.closest<HTMLElement>(".mobile-layer-row.is-selected");
  const key = row?.dataset.layerKey;
  if (!select || select.disabled || !row || !key || !isMobileMixedSceneLayerKey(key)) return;
  const name = row.querySelector<HTMLElement>(".mobile-layer-name")?.textContent?.trim()
    || "Layer";
  select.setPointerCapture(event.pointerId);
  const gesture: MobileLayerReorderGesture = {
    pointerId: event.pointerId,
    key,
    name,
    row,
    select,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startScrollTop: mobileLayerList.scrollTop,
    restoreFocus: document.activeElement === select,
    holdTimer: null,
    phase: "pending",
    plan: null,
    currentSlot: 0,
    clientY: event.clientY,
    frame: null,
    lastFrameTime: performance.now(),
  };
  gesture.holdTimer = window.setTimeout(
    armMobileLayerContextGesture,
    MOBILE_LAYER_REORDER_HOLD_MS,
  );
  mobileLayerReorderGesture = gesture;
}

function handleMobileLayerReorderPointerMove(event: PointerEvent): void {
  const gesture = mobileLayerReorderGesture;
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  if (gesture.phase === "pending") {
    if (mobileLayerReorderMovementExceeded(
      gesture.startClientX,
      gesture.startClientY,
      event.clientX,
      event.clientY,
    )) {
      cancelMobileLayerReorderGesture(false);
    }
    return;
  }
  if (gesture.phase === "armed") {
    if (!mobileLayerReorderMovementExceeded(
      gesture.startClientX,
      gesture.startClientY,
      event.clientX,
      event.clientY,
    )) {
      return;
    }
    event.preventDefault();
    gesture.clientY = event.clientY;
    activateMobileLayerReorderGesture();
    return;
  }
  event.preventDefault();
  gesture.clientY = event.clientY;
  scheduleMobileLayerReorderFrame();
}

function handleMobileLayerReorderPointerUp(event: PointerEvent): void {
  const gesture = mobileLayerReorderGesture;
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  if (gesture.phase === "armed") {
    event.preventDefault();
    mobileLayerReorderSuppressClickKey = gesture.key;
    mobileLayerReorderSuppressClickUntil = performance.now() + 500;
    mobileLayerReorderGesture = null;
    if (gesture.holdTimer !== null) window.clearTimeout(gesture.holdTimer);
    if (gesture.select.hasPointerCapture(gesture.pointerId)) {
      gesture.select.releasePointerCapture(gesture.pointerId);
    }
    requestAnimationFrame(() => {
      if (mobileLayerContextKey !== gesture.key) return;
      (mobileLayerClippingButton.hidden || mobileLayerClippingButton.disabled
        ? mobileLayerOptionsButton
        : mobileLayerClippingButton).focus({ preventScroll: true });
    });
    return;
  }
  if (gesture.phase !== "dragging" || !gesture.plan) {
    cancelMobileLayerReorderGesture(false);
    return;
  }
  event.preventDefault();
  gesture.clientY = event.clientY;
  if (gesture.frame !== null) {
    cancelAnimationFrame(gesture.frame);
    gesture.frame = null;
  }
  runMobileLayerReorderFrame(performance.now());
  const { key, name, currentSlot } = gesture;
  const finalScrollTop = mobileLayerList.scrollTop;
  mobileLayerReorderSuppressClickKey = key;
  mobileLayerReorderSuppressClickUntil = performance.now() + 500;
  mobileLayerReorderGesture = null;
  if (gesture.holdTimer !== null) window.clearTimeout(gesture.holdTimer);
  if (gesture.frame !== null) cancelAnimationFrame(gesture.frame);
  clearMobileLayerReorderIndicators();
  if (gesture.select.hasPointerCapture(gesture.pointerId)) {
    gesture.select.releasePointerCapture(gesture.pointerId);
  }
  void commitMobileLayerReorder(key, name, currentSlot, finalScrollTop);
}

function handleMobileLayerReorderPointerEnd(event: PointerEvent): void {
  const gesture = mobileLayerReorderGesture;
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  cancelMobileLayerReorderGesture();
}

function mobileLayerKeyboardTargetSlot(
  plan: MobileLayerReorderPlan,
  direction: -1 | 1,
): number | null {
  const candidates = plan.validSlots.filter((slot) =>
    direction < 0 ? slot < plan.originalSlot : slot > plan.originalSlot);
  if (candidates.length === 0) return null;
  return direction < 0 ? Math.max(...candidates) : Math.min(...candidates);
}

function handleMobileLayerReorderKeydown(event: KeyboardEvent): void {
  if (
    mobileLayerReorderGesture !== null
    && event.altKey
    && (event.key === "ArrowUp" || event.key === "ArrowDown")
  ) {
    event.preventDefault();
    return;
  }
  if (
    !event.altKey
    || event.ctrlKey
    || event.metaKey
    || (event.key !== "ArrowUp" && event.key !== "ArrowDown")
    || interactionLocked()
    || layerSwitching
  ) {
    return;
  }
  const target = event.target instanceof Element ? event.target : null;
  const select = target?.closest<HTMLButtonElement>(".mobile-layer-select");
  const row = select?.closest<HTMLElement>(".mobile-layer-row.is-selected");
  const key = row?.dataset.layerKey;
  if (!select || !row || !key || !isMobileMixedSceneLayerKey(key)) return;
  const plan = mobileLayerReorderPlanFromEngine(key);
  if (!plan) return;
  const targetSlot = mobileLayerKeyboardTargetSlot(
    plan,
    event.key === "ArrowUp" ? -1 : 1,
  );
  event.preventDefault();
  if (targetSlot === null) {
    announceMobileLayerReorder(
      event.key === "ArrowUp" ? "Layer is already at the top." : "Layer is already at the bottom.",
    );
    return;
  }
  const name = row.querySelector<HTMLElement>(".mobile-layer-name")?.textContent?.trim()
    || "Layer";
  void commitMobileLayerReorder(key, name, targetSlot, mobileLayerList.scrollTop);
}

function setMobileLayersPanelOpen(open: boolean): void {
  if (open && !mobileUiMediaQuery.matches) return;
  if (open && mobileBrushStudio?.isOpen) mobileBrushStudio.cancel(false);
  if (open && mobileStrokeSheet?.isOpen) mobileStrokeSheet.close(false);
  if (open && mobileRasterEffectsSheet?.isOpen) mobileRasterEffectsSheet.close(false);
  if (open && mobileToolSettingsSheet?.isOpen) mobileToolSettingsSheet.close(false);
  if (open && mobileToolsSheetOpen) {
    setMobileToolsSheetOpen(false);
  }
  if (open && mobileBrushLibraryOpen) {
    setMobileBrushLibraryOpen(false);
  }
  if (!open) {
    const focusWasInside = mobileLayersPanel.contains(document.activeElement)
      || mobileLayerReorderGesture !== null;
    closeMobileLayerContextMenu(false);
    cancelMobileLayerReorderGesture(false, true, false);
    if (focusWasInside) {
      mobileLayersMenuButton.focus({ preventScroll: true });
    }
  }
  mobileLayersPanelOpen = open;
  mobileLayersMenuButton.setAttribute("aria-expanded", String(open));
  mobileLayersMenuButton.setAttribute(
    "aria-label",
    open ? "Close layers menu" : "Open layers menu",
  );
  if (open) {
    mobileLayersPanel.removeAttribute("inert");
  } else {
    mobileLayersPanel.setAttribute("inert", "");
  }
  mobileLayersPanel.setAttribute("aria-hidden", String(!open));
  if (open) {
    setControlsPanelOpen(false);
    mobileLayersRenderSignature = "";
    requestMobileLayersRefresh();
    if (engineInitialized) {
      renderMobileLayerList(engine.getStats());
    }
    void mobileLayersPanel.offsetWidth;
    mobileLayersPanel.classList.add("is-open");
    requestMobileLayerThumbnailCapture(0);
    syncMobileBrushControlsVisibility();
    return;
  }
  mobileLayersPanel.classList.remove("is-open");
  mobileLayerThumbnailCaptureRequested = false;
  cancelMobileLayerThumbnailCaptureTimer();
  if (mobileLayersRefreshFrame !== null) {
    cancelAnimationFrame(mobileLayersRefreshFrame);
    mobileLayersRefreshFrame = null;
  }
  syncMobileBrushControlsVisibility();
}

function setMobileToolsSheetOpen(open: boolean): void {
  if (open && !mobileUiMediaQuery.matches) return;
  if (open && mobileBrushStudio?.isOpen) mobileBrushStudio.cancel(false);
  if (open && mobileStrokeSheet?.isOpen) mobileStrokeSheet.close(false);
  if (open && mobileRasterEffectsSheet?.isOpen) mobileRasterEffectsSheet.close(false);
  if (open && mobileToolSettingsSheet?.isOpen) mobileToolSettingsSheet.close(false);
  if (open && mobileLayersPanelOpen) {
    setMobileLayersPanelOpen(false);
  }
  if (open && mobileBrushLibraryOpen) {
    setMobileBrushLibraryOpen(false);
  }
  mobileToolsSheetOpen = open;
  mobileToolsMenuButton.setAttribute("aria-expanded", String(open));
  mobileToolsMenuButton.setAttribute(
    "aria-label",
    open ? "Close tools menu" : "Open tools menu",
  );
  mobileToolsSheet.setAttribute("aria-hidden", String(!open));
  if (open) {
    setControlsPanelOpen(false);
    syncMobileToolsMenuState();
    filterMobileTools();
    snapMobileToolsSheet("peek");
    void mobileToolsSheet.offsetHeight;
    mobileToolsSheet.classList.add("is-open");
    syncMobileBrushControlsVisibility();
    return;
  }
  mobileToolsSheet.classList.remove("is-open", "is-dragging", "is-search-focus-snap");
  mobileToolsSearchInput.blur();
  if (mobileToolsSearchInput.value.length > 0) {
    mobileToolsSearchInput.value = "";
    filterMobileTools();
  }
  mobileToolsSheetDragPointerId = null;
  syncMobileBrushControlsVisibility();
}

function finishMobileToolsSheetDrag(
  event: PointerEvent,
  cancelled = false,
): void {
  if (event.pointerId !== mobileToolsSheetDragPointerId) return;
  if (mobileToolsSheetHandle.hasPointerCapture(event.pointerId)) {
    mobileToolsSheetHandle.releasePointerCapture(event.pointerId);
  }
  mobileToolsSheet.classList.remove("is-dragging");
  const deltaY = event.clientY - mobileToolsSheetDragStartY;
  const peekOffset = mobileToolsSheetPeekOffset();
  const closedOffset = mobileToolsSheetClosedOffset();
  const releaseMotionAgeMs = performance.now() - mobileToolsSheetDragLastTime;
  const releaseVelocityY = releaseMotionAgeMs <= 100
    ? mobileToolsSheetDragVelocityY
    : 0;
  const shouldClose = shouldCloseMobileToolsSheetDrag({
    startSnap: mobileToolsSheetDragStartSnap,
    deltaY,
    releaseVelocityY,
    offsetPx: mobileToolsSheetOffsetPx,
    peekOffsetPx: peekOffset,
    closedOffsetPx: closedOffset,
  });
  mobileToolsSheetDragPointerId = null;
  if (cancelled) {
    if (mobileToolsSheetDragMoved) {
      snapMobileToolsSheet(mobileToolsSheetDragStartSnap);
    }
    return;
  }
  if (
    mobileToolsSheetDragMoved
    && shouldClose
  ) {
    setMobileToolsSheetOpen(false);
    mobileToolsSheetDragMoved = false;
    return;
  }
  const target = deltaY <= -36
    ? "expanded"
    : deltaY >= 36
      ? "peek"
      : mobileToolsSheetOffsetPx <= peekOffset / 2
        ? "expanded"
        : "peek";
  if (mobileToolsSheetDragMoved) {
    snapMobileToolsSheet(target);
  }
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
    tool: activeBrushTool,
    shape: element<HTMLSelectElement>("brushShape").value as BrushSettings["shape"],
    shapeAssetId:
      element<HTMLSelectElement>("shapeSource").value as BrushSettings["shapeAssetId"],
    shapeInvert: activeShapeInvert,
    shapeRotation:
      element<HTMLSelectElement>("shapeRotation").value as BrushSettings["shapeRotation"],
    shapeScatter: rangeValue("shapeScatter") / 100,
    grainMode: element<HTMLSelectElement>("grainMode").value as BrushSettings["grainMode"],
    grainAssetId:
      element<HTMLSelectElement>("grainSource").value as BrushSettings["grainAssetId"],
    grainScale: rangeValue("grainScale") / 100,
    grainMovement: rangeValue("grainMovement") / 100,
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
    stabilization: rangeValue("stabilization") / 100,
    startThickness: rangeValue("startThickness") / 100,
    endThickness: rangeValue("endThickness") / 100,
    count: rangeValue("count"),
    flow: rangeValue("flow") / 100,
    opacity: rangeValue("opacity") / 100,
    hardness: activeBrushTool === "paint" ? 1 : rangeValue("hardness") / 100,
    // Kept fixed in the engine/history ABI; Flow is the only deposit control.
    blendIntensity: 1,
    blendMode: element<HTMLSelectElement>("blendMode").value as BrushSettings["blendMode"],
    blendStretch: rangeValue("blendStretch") / 100,
    blendPaint: rangeValue("blendPaint") / 100,
    // Legacy history ABI field. Individual Color Dynamics controls are direct.
    jitterMaster: 1,
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
  element<HTMLOutputElement>("fillToleranceOut").value =
    `${rangeValue("fillTolerance").toFixed(1).replace(".", ",")}%`;
  element<HTMLOutputElement>("selectionToleranceOut").value =
    `${rangeValue("selectionTolerance").toFixed(0)}/255`;
  element<HTMLOutputElement>("shapeScatterOut").value = `${rangeValue("shapeScatter").toFixed(0)}%`;
  element<HTMLOutputElement>("grainScaleOut").value = `${rangeValue("grainScale").toFixed(0)}%`;
  element<HTMLOutputElement>("grainMovementOut").value =
    `${rangeValue("grainMovement").toFixed(0)}%`;
  element<HTMLOutputElement>("grainDepthOut").value = `${rangeValue("grainDepth").toFixed(0)}%`;
  const grainBrightness = rangeValue("grainBrightness");
  element<HTMLOutputElement>("grainBrightnessOut").value =
    `${grainBrightness > 0 ? "+" : ""}${grainBrightness.toFixed(0)}%`;
  const grainContrast = rangeValue("grainContrast");
  element<HTMLOutputElement>("grainContrastOut").value =
    `${grainContrast > 0 ? "+" : ""}${grainContrast.toFixed(0)}%`;
  element<HTMLOutputElement>("brushSizeOut").value = `${rangeValue("brushSize").toFixed(0)} px`;
  element<HTMLOutputElement>("spacingOut").value = `${rangeValue("spacing").toFixed(2)}%`;
  element<HTMLOutputElement>("stabilizationOut").value =
    `${rangeValue("stabilization").toFixed(0)}%`;
  element<HTMLOutputElement>("startThicknessOut").value = `${rangeValue("startThickness").toFixed(0)}%`;
  element<HTMLOutputElement>("endThicknessOut").value = `${rangeValue("endThickness").toFixed(0)}%`;
  element<HTMLOutputElement>("countOut").value = rangeValue("count").toFixed(0);
  element<HTMLOutputElement>("flowOut").value = `${rangeValue("flow").toFixed(1).replace(".0", "")}%`;
  element<HTMLOutputElement>("opacityOut").value = `${rangeValue("opacity").toFixed(1).replace(".0", "")}%`;
  element<HTMLOutputElement>("hardnessOut").value = `${rangeValue("hardness").toFixed(0)}%`;
  element<HTMLOutputElement>("blendStretchOut").value = `${rangeValue("blendStretch").toFixed(0)}%`;
  element<HTMLOutputElement>("blendPaintOut").value = `${rangeValue("blendPaint").toFixed(0)}%`;
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
  updateRasterOuterShadowOutputs();
  updateRasterInnerShadowOutputs();
  element<HTMLOutputElement>("benchmarkStampsOut").value = formatInteger(rangeValue("benchmarkStamps"));
  syncMobileBrushControlVisuals();
}

function applyBrushControls(): void {
  captureActiveToolControls();
  updateRenderingModeControlAvailability();
  updateControlOutputs();
  updateGrainControlAvailability();
  engine.setBrushSettings(readBrushSettings());
  markMobileBrushLibraryPreviewDirty();
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

function humanStrokeMatchesCanonical(benchmark: HumanStrokeBenchmark | null): boolean {
  return benchmark !== null
    && benchmark.points.length === CANONICAL_HUMAN_STROKE_POINT_COUNT
    && fingerprintHumanStroke(benchmark.points) === CANONICAL_HUMAN_STROKE_FINGERPRINT;
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
  const stats = engine.getStats();
  const scene = stats.mixedScene;
  const session = mixedMemoryBenchmarkReport;
  const vectorTextDiagnostics = vectorTextPrototype?.getDiagnostics() ?? null;
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
    viewRotationDegrees: Number(engine.getViewRotationDegrees().toFixed(3)),
    controlsLayoutStrategy: "full-stage-overlay-drawer",
    touchNavigationStrategy: "two-finger-pan-pinch-rotate-zero-magnet",
    touchPaintIntentStrategy: TOUCH_PAINT_INTENT_STRATEGY,
    touchPaintIntentHoldEnabled,
    touchPaintIntentHoldMs: TOUCH_PAINT_INTENT_HOLD_MS,
    touchPaintIntentMoveThresholdPx: TOUCH_PAINT_INTENT_MOVE_THRESHOLD_PX,
    touchPaintIntentStarts: touchPaintIntentDiagnostics.starts,
    touchPaintIntentReleasedByMovement: touchPaintIntentDiagnostics.releasedByMovement,
    touchPaintIntentReleasedByTimeout: touchPaintIntentDiagnostics.releasedByTimeout,
    touchPaintIntentReleasedByPointerUp: touchPaintIntentDiagnostics.releasedByPointerUp,
    touchPaintIntentCanceledForNavigation: touchPaintIntentDiagnostics.canceledForNavigation,
    touchPaintIntentCanceledForPointerEnd: touchPaintIntentDiagnostics.canceledForPointerEnd,
    touchPaintIntentMaximumBufferedSamples: touchPaintIntentDiagnostics.maximumBufferedSamples,
    touchPaintIntentLastHoldDurationMs: Number(
      touchPaintIntentDiagnostics.lastHoldDurationMs.toFixed(3),
    ),
    performanceTelemetryRevision: 64,
    countedGpuMemoryMiB: stats.gpuMemory.countedTotalMiB,
    vectorTextPresentationMiB: stats.gpuMemory.vectorTextPresentationMiB,
    vectorTextAdaptiveZoomStrategy: vectorTextDiagnostics?.adaptiveZoomStrategy ?? null,
    vectorTextAdaptiveZoomEnabled: vectorTextDiagnostics?.adaptiveZoomEnabled ?? false,
    vectorTextZoomRenderMode: vectorTextDiagnostics?.zoomRenderMode ?? null,
    vectorTextZoomFastModeArmed: vectorTextDiagnostics?.zoomFastModeArmed ?? false,
    vectorTextZoomFastActivationCount:
      vectorTextDiagnostics?.zoomFastActivationCount ?? 0,
    vectorTextZoomExactRecoveryCount:
      vectorTextDiagnostics?.zoomExactRecoveryCount ?? 0,
    vectorTextZoomLastTriggerRenderMs:
      vectorTextDiagnostics?.lastAdaptiveZoomTriggerRenderMs ?? 0,
    vectorTextZoomLastTriggerEndToEndMs:
      vectorTextDiagnostics?.lastAdaptiveZoomTriggerEndToEndMs ?? 0,
    mixedSceneStrategy: scene?.strategy ?? null,
    mixedSceneItemCount: scene?.items.length ?? 0,
    mixedSceneTextNodeCount:
      scene?.items.filter((item) => item.kind === "text").length ?? 0,
    mixedMemoryBenchmarkStrategy: session?.strategy ?? "off",
    mixedMemoryBenchmarkReady: session !== null,
    mixedMemoryBenchmarkTargetMiB: session?.targetMiB ?? 0,
    mixedMemoryBenchmarkRasterLayerCount: session?.rasterLayerCount ?? 0,
    mixedMemoryBenchmarkTextNodeCount: session?.textNodeCount ?? 0,
    mixedMemoryBenchmarkTextRunCount: session?.textRunCount ?? 0,
    mixedMemoryBenchmarkBlockShadowTextCount:
      session?.blockShadowTextCount ?? 0,
    mixedMemoryBenchmarkSingleShadowTextCount:
      session?.singleShadowTextCount ?? 0,
    mixedMemoryBenchmarkBrowserCanvasLogicalMiB:
      session?.browserCanvasLogicalMiB ?? 0,
    mixedMemoryBenchmarkVectorCpuKnownLogicalMiB:
      session?.vectorCpuKnownLogicalMiB ?? 0,
    mixedMemoryBenchmarkKnownLogicalWorkingSetMiB:
      session?.knownLogicalWorkingSetMiB ?? stats.gpuMemory.countedTotalMiB,
    mixedMemoryBenchmarkBaselineZoomVectorRenderP95Ms:
      session?.baselineZoomProbe.vectorRenderP95Ms ?? 0,
    mixedMemoryBenchmarkBaselineZoomEndToEndP95Ms:
      session?.baselineZoomProbe.endToEndP95Ms ?? 0,
    mixedMemoryBenchmarkZoomVectorRenderP95Ms:
      session?.zoomProbe.vectorRenderP95Ms ?? 0,
    mixedMemoryBenchmarkZoomEndToEndP95Ms:
      session?.zoomProbe.endToEndP95Ms ?? 0,
    mixedMemoryBenchmarkZoomVectorP95SlowdownRatio:
      session?.zoomVectorP95SlowdownRatio ?? 0,
    mixedMemoryBenchmarkZoomEndToEndP95SlowdownRatio:
      session?.zoomEndToEndP95SlowdownRatio ?? 0,
    ...engineEnvironment,
  };
}

async function saveBenchmarkRun(run: BenchmarkRun): Promise<number> {
  if (import.meta.env.DEV) {
    return 0;
  }
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

async function saveLayerCompressionRun(
  report: LayerCompressionStudyReport,
): Promise<number> {
  if (import.meta.env.DEV) {
    return 0;
  }
  const response = await fetch(LAYER_COMPRESSION_RUNS_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(report),
  });
  if (!response.ok) {
    throw new Error(
      "Misura completata, ma il report non è stato salvato nel progetto.",
    );
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
  const blendMode = benchmark.settings.blendMode === "uniformed-glaze"
    || benchmark.settings.blendMode === "intense-blending"
    || benchmark.settings.blendMode === "light-glaze"
    || benchmark.settings.blendMode === "m1-glaze"
    || benchmark.settings.blendMode === "additive"
    ? benchmark.settings.blendMode
    : "light-glaze";
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
  const stabilization = Number.isFinite(benchmark.settings.stabilization)
    ? Math.min(1, Math.max(0, benchmark.settings.stabilization))
    : 0;
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
      stabilization,
      startThickness,
      endThickness,
      opacity,
      blendIntensity: 1,
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

function responseHasJsonContent(response: Response): boolean {
  return response.headers.get("content-type")?.toLowerCase().includes("application/json")
    ?? false;
}

async function requestCanonicalHumanStroke(): Promise<HumanStrokeBenchmark | null> {
  const response = await fetch(HUMAN_STROKE_API_URL, { cache: "no-store" });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error("Impossibile caricare il tratto umano di riferimento.");
  }
  // The plain Vite development server falls back to index.html for unknown
  // GET routes. Treat that 200 HTML response as an absent optional fixture,
  // rather than surfacing its JSON parser error in the benchmark panel.
  if (!responseHasJsonContent(response)) {
    return null;
  }
  return parseHumanStrokeBenchmark(await response.json());
}

async function saveCanonicalHumanStroke(benchmark: HumanStrokeBenchmark): Promise<HumanStrokeBenchmark> {
  if (import.meta.env.DEV) {
    window.localStorage.setItem(LEGACY_HUMAN_STROKE_STORAGE_KEY, JSON.stringify(benchmark));
    return benchmark;
  }
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
  if (!response.ok || !responseHasJsonContent(response)) {
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
      if (import.meta.env.DEV) {
        humanStrokeBenchmark = legacy;
        humanStrokeResult.textContent = describeHumanStrokeBenchmark(legacy);
        return;
      }
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
  if (id === "brushColor") {
    syncMobileBrushColor(String(value));
  }
}

function readRasterColorOverlayStyle(): RasterColorOverlayStyle {
  return {
    enabled: element<HTMLInputElement>("rasterColorOverlayEnabled").checked,
    color: rasterColorOverlayColorFromHex(
      element<HTMLInputElement>("rasterColorOverlayColor").value,
    ),
    opacity: rangeValue("rasterColorOverlayOpacity"),
  };
}

function updateRasterColorOverlayOutput(): void {
  element<HTMLOutputElement>("rasterColorOverlayOpacityOut").value =
    `${rangeValue("rasterColorOverlayOpacity").toFixed(0)}%`;
}

function rasterColorOverlayTargetIsSelected(): boolean {
  return engine.getMixedSceneSnapshot() === null
    || engine.canPaintSelectedSceneItem();
}

function syncRasterColorOverlayControls(style: RasterColorOverlayStyle): void {
  const enabledControl = element<HTMLInputElement>("rasterColorOverlayEnabled");
  enabledControl.checked = style.enabled;
  enabledControl.setAttribute("aria-expanded", String(style.enabled));
  setControlValue(
    "rasterColorOverlayColor",
    rasterColorOverlayColorToHex(style.color),
  );
  setControlValue("rasterColorOverlayOpacity", style.opacity);
  element<HTMLElement>("rasterColorOverlayParameters").hidden = !style.enabled;
  updateRasterColorOverlayOutput();
}

const rasterColorOverlayControlIds = [
  "rasterColorOverlayEnabled",
  "rasterColorOverlayColor",
  "rasterColorOverlayOpacity",
] as const;

function updateRasterColorOverlayControlAvailability(
  locked = interactionLocked(),
): void {
  const enabled = element<HTMLInputElement>("rasterColorOverlayEnabled").checked;
  const rasterTargetSelected = rasterColorOverlayTargetIsSelected();
  element<HTMLInputElement>("rasterColorOverlayEnabled").setAttribute(
    "aria-expanded",
    String(enabled),
  );
  element<HTMLElement>("rasterColorOverlayParameters").hidden = !enabled;
  for (const id of rasterColorOverlayControlIds) {
    element<HTMLInputElement>(id).disabled =
      locked
      || rasterColorOverlayChanging
      || !rasterTargetSelected
      || (id !== "rasterColorOverlayEnabled" && !enabled);
  }
}

async function applyRasterColorOverlayStyle(
  style: RasterColorOverlayStyle,
): Promise<boolean> {
  if (
    !engineInitialized
    || rasterColorOverlayChanging
    || activePointerId !== null
    || !rasterColorOverlayTargetIsSelected()
  ) {
    syncRasterColorOverlayControls(engine.getRasterColorOverlayStyle());
    updateRasterColorOverlayControlAvailability();
    return false;
  }
  rasterColorOverlayChanging = true;
  syncRasterColorOverlayControls(style);
  updateRasterColorOverlayControlAvailability();
  syncMobileToolsMenuState();
  updateHistoryControls();
  updateHumanStrokeControls();
  let accepted = false;
  try {
    accepted = await engine.setRasterColorOverlayStyle(style);
    if (!accepted) {
      syncRasterColorOverlayControls(engine.getRasterColorOverlayStyle());
    }
  } catch {
    syncRasterColorOverlayControls(engine.getRasterColorOverlayStyle());
  } finally {
    rasterColorOverlayChanging = false;
    updateRasterColorOverlayControlAvailability();
    syncMobileToolsMenuState();
    updateHistoryControls();
    updateHumanStrokeControls();
  }
  return accepted;
}

async function applyRasterColorOverlayControls(): Promise<void> {
  await applyRasterColorOverlayStyle(readRasterColorOverlayStyle());
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

async function applyRasterStrokeStyle(style: RasterStrokeStyle): Promise<boolean> {
  if (!engineInitialized || rasterStrokeChanging || activePointerId !== null) {
    syncRasterStrokeControls(engine.getRasterStrokeStyle());
    updateRasterStrokeControlAvailability();
    return false;
  }
  rasterStrokeChanging = true;
  syncRasterStrokeControls(style);
  updateRasterStrokeControlAvailability();
  syncMobileToolsMenuState();
  updateHistoryControls();
  updateHumanStrokeControls();
  let accepted = false;
  try {
    accepted = await engine.setRasterStrokeStyle(style);
    if (!accepted) {
      syncRasterStrokeControls(engine.getRasterStrokeStyle());
    }
  } catch {
    syncRasterStrokeControls(engine.getRasterStrokeStyle());
  } finally {
    rasterStrokeChanging = false;
    updateRasterStrokeControlAvailability();
    syncMobileToolsMenuState();
    updateHistoryControls();
    updateHumanStrokeControls();
  }
  return accepted;
}

async function applyRasterStrokeControls(): Promise<void> {
  await applyRasterStrokeStyle(readRasterStrokeStyle());
}

function rasterShadowColorFromHex(value: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (!match) {
    return [0, 0, 0];
  }
  const packed = Number.parseInt(match[1], 16);
  return [
    ((packed >>> 16) & 0xff) / 255,
    ((packed >>> 8) & 0xff) / 255,
    (packed & 0xff) / 255,
  ];
}

function rasterShadowColorToHex(color: readonly number[]): string {
  const channel = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${channel(color[0])}${channel(color[1])}${channel(color[2])}`;
}

function readRasterOuterShadowStyle(): RasterOuterShadowStyle {
  const blendMode = element<HTMLSelectElement>("rasterOuterShadowBlendMode")
    .value as RasterOuterShadowStyle["blendMode"];
  return {
    enabled: element<HTMLInputElement>("rasterOuterShadowEnabled").checked,
    blendMode,
    color: blendMode === "multiply"
      ? [0, 0, 0]
      : rasterShadowColorFromHex(element<HTMLInputElement>("rasterOuterShadowColor").value),
    opacity: rangeValue("rasterOuterShadowOpacity"),
    angle: rangeValue("rasterOuterShadowAngle"),
    useGlobalLight: engine.getRasterOuterShadowStyle().useGlobalLight,
    distance: rangeValue("rasterOuterShadowDistance"),
    spread: rangeValue("rasterOuterShadowSpread"),
    size: rangeValue("rasterOuterShadowSize"),
    contour: element<HTMLSelectElement>("rasterOuterShadowContour")
      .value as RasterOuterShadowStyle["contour"],
    contourAA: element<HTMLInputElement>("rasterOuterShadowContourAA").checked,
    noise: rangeValue("rasterOuterShadowNoise"),
    layerKnocksOut: element<HTMLInputElement>("rasterOuterShadowLayerKnocksOut").checked,
  };
}

function updateRasterOuterShadowOutputs(): void {
  for (const id of ["Opacity", "Spread", "Noise"] as const) {
    element<HTMLOutputElement>(`rasterOuterShadow${id}Out`).value =
      `${rangeValue(`rasterOuterShadow${id}`).toFixed(0)}%`;
  }
  element<HTMLOutputElement>("rasterOuterShadowAngleOut").value =
    `${rangeValue("rasterOuterShadowAngle").toFixed(0)}°`;
  element<HTMLOutputElement>("rasterOuterShadowDistanceOut").value =
    `${rangeValue("rasterOuterShadowDistance").toFixed(0)} px`;
  element<HTMLOutputElement>("rasterOuterShadowSizeOut").value =
    `${rangeValue("rasterOuterShadowSize").toFixed(0)} px`;
}

function syncRasterOuterShadowControls(style: RasterOuterShadowStyle): void {
  element<HTMLInputElement>("rasterOuterShadowEnabled").checked = style.enabled;
  setControlValue("rasterOuterShadowBlendMode", style.blendMode);
  setControlValue("rasterOuterShadowColor", rasterShadowColorToHex(style.color));
  setControlValue("rasterOuterShadowOpacity", style.opacity);
  setControlValue("rasterOuterShadowAngle", style.angle);
  setControlValue("rasterOuterShadowDistance", style.distance);
  setControlValue("rasterOuterShadowSpread", style.spread);
  setControlValue("rasterOuterShadowSize", style.size);
  setControlValue("rasterOuterShadowContour", style.contour);
  element<HTMLInputElement>("rasterOuterShadowContourAA").checked = style.contourAA;
  setControlValue("rasterOuterShadowNoise", style.noise);
  element<HTMLInputElement>("rasterOuterShadowLayerKnocksOut").checked = style.layerKnocksOut;
  element<HTMLElement>("rasterOuterShadowParameters").hidden = !style.enabled;
  updateRasterOuterShadowOutputs();
}

const rasterOuterShadowControlIds = [
  "rasterOuterShadowEnabled",
  "rasterOuterShadowBlendMode",
  "rasterOuterShadowColor",
  "rasterOuterShadowOpacity",
  "rasterOuterShadowAngle",
  "rasterOuterShadowDistance",
  "rasterOuterShadowSpread",
  "rasterOuterShadowSize",
  "rasterOuterShadowContour",
  "rasterOuterShadowContourAA",
  "rasterOuterShadowNoise",
  "rasterOuterShadowLayerKnocksOut",
] as const;

function updateRasterOuterShadowControlAvailability(locked = interactionLocked()): void {
  const enabled = element<HTMLInputElement>("rasterOuterShadowEnabled").checked;
  const multiply = element<HTMLSelectElement>("rasterOuterShadowBlendMode").value === "multiply";
  element<HTMLElement>("rasterOuterShadowParameters").hidden = !enabled;
  for (const id of rasterOuterShadowControlIds) {
    element<HTMLInputElement | HTMLSelectElement>(id).disabled =
      locked
      || rasterOuterShadowChanging
      || (id !== "rasterOuterShadowEnabled" && !enabled)
      || (id === "rasterOuterShadowColor" && multiply);
  }
}

async function applyRasterOuterShadowStyle(
  style: RasterOuterShadowStyle,
): Promise<boolean> {
  if (!engineInitialized || rasterOuterShadowChanging || activePointerId !== null) {
    syncRasterOuterShadowControls(engine.getRasterOuterShadowStyle());
    updateRasterOuterShadowControlAvailability();
    return false;
  }
  rasterOuterShadowChanging = true;
  syncRasterOuterShadowControls(style);
  updateRasterOuterShadowControlAvailability();
  syncMobileToolsMenuState();
  updateHistoryControls();
  updateHumanStrokeControls();
  let accepted = false;
  try {
    accepted = await engine.setRasterOuterShadowStyle(style);
    if (!accepted) {
      syncRasterOuterShadowControls(engine.getRasterOuterShadowStyle());
    }
  } catch {
    syncRasterOuterShadowControls(engine.getRasterOuterShadowStyle());
  } finally {
    rasterOuterShadowChanging = false;
    updateRasterOuterShadowControlAvailability();
    syncMobileToolsMenuState();
    updateHistoryControls();
    updateHumanStrokeControls();
  }
  return accepted;
}

async function applyRasterOuterShadowControls(): Promise<void> {
  await applyRasterOuterShadowStyle(readRasterOuterShadowStyle());
}

function readRasterInnerShadowStyle(): RasterInnerShadowStyle {
  return {
    enabled: element<HTMLInputElement>("rasterInnerShadowEnabled").checked,
    blendMode: element<HTMLSelectElement>("rasterInnerShadowBlendMode")
      .value as RasterInnerShadowStyle["blendMode"],
    color: rasterShadowColorFromHex(element<HTMLInputElement>("rasterInnerShadowColor").value),
    opacity: rangeValue("rasterInnerShadowOpacity"),
    angle: rangeValue("rasterInnerShadowAngle"),
    useGlobalLight: engine.getRasterInnerShadowStyle().useGlobalLight,
    distance: rangeValue("rasterInnerShadowDistance"),
    choke: rangeValue("rasterInnerShadowChoke"),
    size: rangeValue("rasterInnerShadowSize"),
    contour: element<HTMLSelectElement>("rasterInnerShadowContour")
      .value as RasterInnerShadowStyle["contour"],
    contourAA: element<HTMLInputElement>("rasterInnerShadowContourAA").checked,
    noise: rangeValue("rasterInnerShadowNoise"),
  };
}

function updateRasterInnerShadowOutputs(): void {
  for (const id of ["Opacity", "Choke", "Noise"] as const) {
    element<HTMLOutputElement>(`rasterInnerShadow${id}Out`).value =
      `${rangeValue(`rasterInnerShadow${id}`).toFixed(0)}%`;
  }
  element<HTMLOutputElement>("rasterInnerShadowAngleOut").value =
    `${rangeValue("rasterInnerShadowAngle").toFixed(0)}°`;
  element<HTMLOutputElement>("rasterInnerShadowDistanceOut").value =
    `${rangeValue("rasterInnerShadowDistance").toFixed(0)} px`;
  element<HTMLOutputElement>("rasterInnerShadowSizeOut").value =
    `${rangeValue("rasterInnerShadowSize").toFixed(0)} px`;
}

function syncRasterInnerShadowControls(style: RasterInnerShadowStyle): void {
  element<HTMLInputElement>("rasterInnerShadowEnabled").checked = style.enabled;
  setControlValue("rasterInnerShadowBlendMode", style.blendMode);
  setControlValue("rasterInnerShadowColor", rasterShadowColorToHex(style.color));
  setControlValue("rasterInnerShadowOpacity", style.opacity);
  setControlValue("rasterInnerShadowAngle", style.angle);
  setControlValue("rasterInnerShadowDistance", style.distance);
  setControlValue("rasterInnerShadowChoke", style.choke);
  setControlValue("rasterInnerShadowSize", style.size);
  setControlValue("rasterInnerShadowContour", style.contour);
  element<HTMLInputElement>("rasterInnerShadowContourAA").checked = style.contourAA;
  setControlValue("rasterInnerShadowNoise", style.noise);
  element<HTMLElement>("rasterInnerShadowParameters").hidden = !style.enabled;
  updateRasterInnerShadowOutputs();
}

const rasterInnerShadowControlIds = [
  "rasterInnerShadowEnabled",
  "rasterInnerShadowBlendMode",
  "rasterInnerShadowColor",
  "rasterInnerShadowOpacity",
  "rasterInnerShadowAngle",
  "rasterInnerShadowDistance",
  "rasterInnerShadowChoke",
  "rasterInnerShadowSize",
  "rasterInnerShadowContour",
  "rasterInnerShadowContourAA",
  "rasterInnerShadowNoise",
] as const;

function updateRasterInnerShadowControlAvailability(locked = interactionLocked()): void {
  const enabled = element<HTMLInputElement>("rasterInnerShadowEnabled").checked;
  element<HTMLElement>("rasterInnerShadowParameters").hidden = !enabled;
  for (const id of rasterInnerShadowControlIds) {
    element<HTMLInputElement | HTMLSelectElement>(id).disabled =
      locked
      || rasterInnerShadowChanging
      || (id !== "rasterInnerShadowEnabled" && !enabled);
  }
}

async function applyRasterInnerShadowStyle(
  style: RasterInnerShadowStyle,
): Promise<boolean> {
  if (!engineInitialized || rasterInnerShadowChanging || activePointerId !== null) {
    syncRasterInnerShadowControls(engine.getRasterInnerShadowStyle());
    updateRasterInnerShadowControlAvailability();
    return false;
  }
  rasterInnerShadowChanging = true;
  syncRasterInnerShadowControls(style);
  updateRasterInnerShadowControlAvailability();
  syncMobileToolsMenuState();
  updateHistoryControls();
  updateHumanStrokeControls();
  let accepted = false;
  try {
    accepted = await engine.setRasterInnerShadowStyle(style);
    if (!accepted) {
      syncRasterInnerShadowControls(engine.getRasterInnerShadowStyle());
    }
  } catch {
    syncRasterInnerShadowControls(engine.getRasterInnerShadowStyle());
  } finally {
    rasterInnerShadowChanging = false;
    updateRasterInnerShadowControlAvailability();
    syncMobileToolsMenuState();
    updateHistoryControls();
    updateHumanStrokeControls();
  }
  return accepted;
}

async function applyRasterInnerShadowControls(): Promise<void> {
  await applyRasterInnerShadowStyle(readRasterInnerShadowStyle());
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

async function applyRasterBevelStyle(style: RasterBevelStyle): Promise<boolean> {
  if (!engineInitialized || rasterBevelChanging || activePointerId !== null) {
    syncRasterBevelControls(engine.getRasterBevelStyle());
    updateRasterBevelControlAvailability();
    return false;
  }
  rasterBevelChanging = true;
  syncRasterBevelControls(style);
  updateRasterBevelControlAvailability();
  syncMobileToolsMenuState();
  updateHistoryControls();
  updateHumanStrokeControls();
  let accepted = false;
  try {
    accepted = await engine.setRasterBevelStyle(style);
    if (!accepted) {
      syncRasterBevelControls(engine.getRasterBevelStyle());
    }
  } catch {
    syncRasterBevelControls(engine.getRasterBevelStyle());
  } finally {
    rasterBevelChanging = false;
    updateRasterBevelControlAvailability();
    syncMobileToolsMenuState();
    updateHistoryControls();
    updateHumanStrokeControls();
  }
  return accepted;
}

async function applyRasterBevelControls(): Promise<void> {
  await applyRasterBevelStyle(readRasterBevelStyle());
}

function setBrushAssetControlValue(
  controlId: "shapeSource" | "grainSource",
  value: string,
  fallback: string,
): void {
  const select = element<HTMLSelectElement>(controlId);
  const normalized = value.startsWith("custom-") ? value : value || fallback;
  if (!Array.from(select.options).some((option) => option.value === normalized)) {
    const option = document.createElement("option");
    option.value = normalized;
    option.textContent = normalized.startsWith("custom-shape:")
      ? "Custom Shape"
      : normalized.startsWith("custom-grain:")
        ? "Custom Grain"
        : normalized;
    select.append(option);
  }
  setControlValue(controlId, normalized);
}

function applySettingsToControls(settings: BrushSettings): void {
  const tool = settings.tool === "blend" ? "blend" : "paint";
  configureBrushToolUi(tool, false);
  setControlValue("brushShape", settings.shape === "shape" ? "shape" : "circle");
  setBrushAssetControlValue("shapeSource", settings.shapeAssetId, "legacy-shape");
  activeShapeInvert = settings.shapeInvert === true;
  setControlValue(
    "shapeRotation",
    settings.shapeRotation === "follow-stroke" ? "follow-stroke" : "fixed",
  );
  setControlValue("shapeScatter", (settings.shapeScatter ?? 0) * 100);
  setControlValue(
    "grainMode",
    settings.grainMode === "texturized" || settings.grainMode === "moving"
      ? settings.grainMode
      : "off",
  );
  setBrushAssetControlValue("grainSource", settings.grainAssetId, "legacy-grain");
  setControlValue("grainScale", (settings.grainScale ?? 1.4) * 100);
  setControlValue("grainMovement", (settings.grainMovement ?? 0) * 100);
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
  setControlValue("stabilization", (settings.stabilization ?? 0) * 100);
  setControlValue("startThickness", (settings.startThickness ?? 1) * 100);
  setControlValue("endThickness", (settings.endThickness ?? 1) * 100);
  setControlValue("count", settings.count);
  setControlValue("flow", settings.flow * 100);
  setControlValue("opacity", (settings.opacity ?? 1) * 100);
  setControlValue("hardness", tool === "paint" ? 100 : settings.hardness * 100);
  const renderingMode = settings.blendMode === "uniformed-glaze"
    || settings.blendMode === "intense-blending"
    ? settings.blendMode
    : "light-glaze";
  setControlValue("blendMode", renderingMode);
  setControlValue("blendStretch", (settings.blendStretch ?? 0.18) * 100);
  setControlValue("blendPaint", (settings.blendPaint ?? 0.14) * 100);
  setControlValue("hueJitter", settings.hueJitterDegrees);
  setControlValue("saturationJitter", settings.saturationJitter * 100);
  setControlValue("lightnessJitter", settings.lightnessJitter * 100);
  setControlValue("darknessJitter", settings.darknessJitter * 100);
  element<HTMLInputElement>("jitterPerCopy").checked = settings.jitterPerCopy;
  setControlValue("positionJitterLateral", settings.positionJitterLateral * 100);
  setControlValue("positionJitterLinear", settings.positionJitterLinear * 100);
  applyBrushControls();
}

mobileBrushStudio = new MobileBrushStudioController({
  engine,
  mobileMediaQuery: mobileUiMediaQuery,
  applySettings: applySettingsToControls,
  setBrushLibraryOpen: setMobileBrushLibraryOpen,
  onOpenChange: (open) => {
    if (open && mobileStrokeSheet?.isOpen) mobileStrokeSheet.close(false);
    if (open && mobileRasterEffectsSheet?.isOpen) mobileRasterEffectsSheet.close(false);
    if (open && mobileToolSettingsSheet?.isOpen) mobileToolSettingsSheet.close(false);
    syncMobileBrushLibraryButtonState();
    syncMobileBrushControlsVisibility();
  },
  onCommit: (brushId, _settings) => {
    activeMobileBrushLibraryBrushId = brushId === PENCIL_BRUSH_PRESET.id
      ? PENCIL_BRUSH_PRESET.id
      : "current";
    setMobileBrushLibraryCategory(
      mobileBrushLibraryCategoryForBrush(activeMobileBrushLibraryBrushId),
    );
    persistActiveMobileBrushLibraryBrush();
    syncMobileBrushLibrarySelection();
    markMobileBrushLibraryPreviewDirty();
  },
  onStatus: (message, kind) => {
    statusElement.textContent = message;
    statusElement.className = `status ${kind === "working" ? "" : kind}`;
  },
});

mobileStrokeSheet = new MobileStrokeSheetController({
  mobileMediaQuery: mobileUiMediaQuery,
  getStyle: () => engine.getRasterStrokeStyle(),
  applyStyle: applyRasterStrokeStyle,
  beginHistoryEdit: () => engine.beginRasterLayerMetadataHistoryEdit("stroke"),
  commitHistoryEdit: (token) => engine.commitRasterLayerMetadataHistoryEdit(token),
  cancelHistoryEdit: (token) => engine.cancelRasterLayerMetadataHistoryEdit(token),
  beforeOpen: () => {
    setMobileToolsSheetOpen(false);
    setMobileLayersPanelOpen(false);
    setMobileBrushLibraryOpen(false);
    mobileBrushStudio?.cancel(false);
    mobileRasterEffectsSheet?.close(false);
    mobileToolSettingsSheet?.close(false);
    setControlsPanelOpen(false);
  },
  onOpenChange: () => {
    syncMobileToolsMenuState();
    syncMobileBrushControlsVisibility();
  },
});

mobileRasterEffectsSheet = new MobileRasterEffectsSheetController({
  mobileMediaQuery: mobileUiMediaQuery,
  getColorOverlayStyle: () => engine.getRasterColorOverlayStyle(),
  applyColorOverlayStyle: applyRasterColorOverlayStyle,
  getOuterShadowStyle: () => engine.getRasterOuterShadowStyle(),
  applyOuterShadowStyle: applyRasterOuterShadowStyle,
  getInnerShadowStyle: () => engine.getRasterInnerShadowStyle(),
  applyInnerShadowStyle: applyRasterInnerShadowStyle,
  getBevelStyle: () => engine.getRasterBevelStyle(),
  applyBevelStyle: applyRasterBevelStyle,
  beginHistoryEdit: (kind: MobileRasterEffectKind) => {
    const property = kind === "color-overlay"
      ? "color-overlay"
      : kind === "outer-shadow"
        ? "outer-shadow"
        : kind === "inner-shadow"
          ? "inner-shadow"
          : "bevel";
    return engine.beginRasterLayerMetadataHistoryEdit(property);
  },
  commitHistoryEdit: (token) => engine.commitRasterLayerMetadataHistoryEdit(token),
  cancelHistoryEdit: (token) => engine.cancelRasterLayerMetadataHistoryEdit(token),
  beforeOpen: () => {
    setMobileToolsSheetOpen(false);
    setMobileLayersPanelOpen(false);
    setMobileBrushLibraryOpen(false);
    mobileBrushStudio?.cancel(false);
    mobileStrokeSheet?.close(false);
    mobileToolSettingsSheet?.close(false);
    setControlsPanelOpen(false);
  },
  onOpenChange: () => {
    syncMobileToolsMenuState();
    syncMobileBrushControlsVisibility();
  },
});

mobileToolSettingsSheet = new MobileToolSettingsSheetController({
  mobileMediaQuery: mobileUiMediaQuery,
  selectCanvasTool: selectMobileCanvasTool,
  hasSelectedText: () => selectedMobileTextNode() !== null,
  setSelectionCombineMode,
  applySelectionColor: applySelectionColorRange,
  clearSelection: clearPixelSelection,
  applyTransform: () => vectorTextPrototype?.applyTransform(),
  cancelTransform: () => vectorTextPrototype?.cancelTransform(),
  getSelectedLayerOptions: () => {
    const properties = mobileLayerProperties();
    return properties && {
      key: properties.key,
      name: properties.name,
      opacity: properties.opacity,
      blendMode: properties.blendMode,
      locked: properties.locked,
    };
  },
  setSelectedLayerOpacity: (opacity) => {
    const properties = mobileLayerProperties();
    if (!properties || properties.locked) return;
    if (properties.kind === "raster" && properties.rasterIndex !== null) {
      void changeLayerOpacity(properties.rasterIndex, opacity);
    } else if (properties.kind === "text" && properties.semanticId !== null) {
      void changeVectorTextOpacity(properties.semanticId, opacity);
    } else if (properties.kind === "svg" && properties.semanticId !== null) {
      void changeVectorSvgOpacity(properties.semanticId, opacity);
    } else if (properties.kind === "image" && properties.semanticId !== null) {
      void changeRasterImageOpacity(properties.semanticId, opacity);
    }
  },
  setSelectedLayerBlendMode: (blendMode) => {
    const properties = mobileLayerProperties();
    if (
      !properties
      || properties.locked
      || properties.kind !== "raster"
      || properties.rasterIndex === null
    ) {
      return;
    }
    void changeLayerBlendMode(properties.rasterIndex, blendMode);
  },
  getSelectedSvgStyle: () => {
    const node = selectedMobileSvgNode();
    return node && {
      id: node.id,
      name: mobileLayerDisplayName(node.name),
      paintColors: node.paintColors,
      locked: interactionLocked() || layerSwitching,
    };
  },
  setSelectedSvgPaintColor: (index, color) => {
    vectorTextPrototype?.setSelectedSvgPaintColor(index, color);
  },
  beginSvgPaintEdit: () => {
    return engine.beginVectorHistoryEdit();
  },
  commitSvgPaintEdit: () => {
    return engine.commitVectorHistoryEdit();
  },
  rasterizeSelectedSvg: () => vectorTextPrototype?.rasterizeSelectedSvgNode(),
  getTextCreationColor: () => brushColorInput.value,
  createText: (color) => vectorTextPrototype?.createText(color),
  resetText: resetMobileText,
  deleteText: deleteMobileText,
  rasterizeText: rasterizeMobileText,
  setTextWarpMode: setMobileTextWarpMode,
  resetTextDistort: () => vectorTextPrototype?.resetSelectedTextDistort(),
  toggleTextDistortEditing: toggleMobileTextDistortEditing,
  getSelectionStatus: () => {
    const state = engine.getPixelSelectionState();
    if (state.selectedPixels === 0) return "No pixels selected.";
    const bounds = state.bounds
      ? ` · ${state.bounds.width.toLocaleString("en-US")}×`
        + state.bounds.height.toLocaleString("en-US")
      : "";
    return `${state.selectedPixels.toLocaleString("en-US")} pixels selected`
      + ` · ${state.activeTiles} tiles${bounds}`;
  },
  beforeOpen: () => {
    setMobileToolsSheetOpen(false);
    setMobileLayersPanelOpen(false);
    setMobileBrushLibraryOpen(false);
    mobileBrushStudio?.cancel(false);
    mobileStrokeSheet?.close(false);
    mobileRasterEffectsSheet?.close(false);
    setControlsPanelOpen(false);
  },
  onOpenChange: () => {
    syncMobileToolsMenuState();
    syncMobileBrushControlsVisibility();
  },
});

function applyHumanStrokePreset(): BrushSettings {
  configureBrushToolUi("paint", false);
  setControlValue("brushShape", "circle");
  setControlValue("shapeSource", "legacy-shape");
  activeShapeInvert = false;
  setControlValue("shapeRotation", "fixed");
  setControlValue("shapeScatter", 0);
  setControlValue("grainMode", "off");
  setControlValue("grainSource", "legacy-grain");
  setControlValue("grainScale", 140);
  setControlValue("grainMovement", 0);
  setControlValue("grainDepth", 100);
  setControlValue("grainBrightness", 0);
  setControlValue("grainContrast", 0);
  element<HTMLInputElement>("grainInvert").checked = false;
  setControlValue("grainFiltering", "improved");
  setControlValue("grainBlendMode", "multiply");
  setControlValue("brushSize", 750);
  setControlValue("spacing", 1);
  setControlValue("stabilization", 0);
  setControlValue("startThickness", 100);
  setControlValue("endThickness", 100);
  setControlValue("count", 16);
  setControlValue("flow", 100);
  setControlValue("opacity", 100);
  setControlValue("hardness", 100);
  setControlValue("blendMode", "light-glaze");
  setControlValue("blendStretch", 18);
  setControlValue("blendPaint", 14);
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
  const value = humanStrokeTestBlendModeSelect.value;
  return value === "uniformed-glaze" || value === "intense-blending"
    ? value
    : "light-glaze";
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
    blendIntensity: 1,
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
    stabilization: 0,
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
    stabilization: 0,
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
    jitterMaster: 1,
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
  const blendLabel = blendMode === "uniformed-glaze"
    ? "Uniformed Glaze"
    : blendMode === "intense-blending"
      ? "Intense Blending"
      : "Light Glaze";
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
    stabilization: 0,
    startThickness: 1,
    endThickness: 1,
    count: 1,
    flow: 1,
    opacity: 1,
    hardness: 1,
    blendIntensity: 1,
    blendMode: "normal",
    jitterMaster: 1,
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
    || rasterShadowGoldenRunning
    || rasterStrokeGoldenRunning
    || effectsWorkbenchBenchmarkRunning
    || layerHistoryTestRunning
    || layerMemoryStressTestRunning
    || layerCompressionStudyRunning
    || layerFormatChanging
    || rasterColorOverlayChanging
    || rasterStrokeChanging
    || rasterOuterShadowChanging
    || rasterInnerShadowChanging
    || rasterBevelChanging
    || selectionUiBusy
    || renderingModeSuiteRunning;
  const mixedMemoryBenchmarkNotReady =
    mixedMemoryBenchmarkRequested && mixedMemoryBenchmarkReport === null;
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
    || humanStrokeReplaying
    || mixedMemoryBenchmarkNotReady;
  playBlendHumanStrokeButton.disabled = operationLocked
    || !humanStrokeBenchmark
    || humanStrokeLoading
    || humanStrokeSaving
    || humanStrokeReplaying
    || mixedMemoryBenchmarkNotReady;
  runRenderingModeSuiteButton.disabled = operationLocked
    || !humanStrokeMatchesCanonical(humanStrokeBenchmark)
    || humanStrokeLoading
    || humanStrokeSaving
    || humanStrokeReplaying
    || mixedMemoryBenchmarkNotReady;
  runRenderingModeSuiteButton.textContent = renderingModeSuiteRunning
    ? "Suite rendering in corso…"
    : "Confronta 3 rendering · Base 1% · 1 tap";
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
    || layerSwitching
    || mobileBrushControlDrag !== null
    || historyState.openEdit === "transform"
    || historyState.openEdit === "raster-property"
    || historyUiBusy
    || historyState.busy
    || benchmarkRunning
    || rasterShadowGoldenRunning
    || rasterStrokeGoldenRunning
    || effectsWorkbenchBenchmarkRunning
    || layerHistoryTestRunning
    || layerMemoryStressTestRunning
    || layerCompressionStudyRunning
    || layerFormatChanging
    || rasterColorOverlayChanging
    || rasterStrokeChanging
    || rasterOuterShadowChanging
    || rasterInnerShadowChanging
    || rasterBevelChanging
    || selectionUiBusy
    || renderingModeSuiteRunning
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
  const undoReason = locked && historyState.undoBlockedReason === null
    ? "Termina l'operazione corrente prima di annullare."
    : historyState.undoBlockedReason;
  const redoReason = locked && historyState.redoBlockedReason === null
    ? "Termina l'operazione corrente prima di ripristinare."
    : historyState.redoBlockedReason;
  for (const [button, blocked, reason, label] of [
    [mobileUndoButton, locked || !historyState.canUndo, undoReason, "Undo"],
    [mobileRedoButton, locked || !historyState.canRedo, redoReason, "Redo"],
  ] as const) {
    // Keep mobile controls tappable while semantically disabled so a blocked
    // operation can explain itself instead of looking like a lost touch.
    button.disabled = false;
    button.setAttribute("aria-disabled", String(blocked));
    button.classList.toggle("is-disabled", blocked);
    button.title = blocked && reason ? reason : label;
    button.setAttribute("aria-label", blocked && reason ? `${label}: ${reason}` : label);
  }
  mobileBrushColorInput.disabled = locked;
  mobileBrushColorLabel.classList.toggle("is-disabled", locked);
  mobilePaintButton.disabled = locked;
  mobileBlendButton.disabled = locked;
  clearLayerButton.disabled = locked;
  element<HTMLSelectElement>("brushTool").disabled = locked;
  const paintToolInactive = activeCanvasTool !== "paint";
  benchmarkButton.disabled = locked || paintToolInactive;
  benchmarkStampsInput.disabled = locked || paintToolInactive;
  rasterShadowGoldenButton.disabled = locked;
  rasterStrokeGoldenButton.disabled = locked;
  effectsWorkbenchBenchmarkButton.disabled = locked;
  layerMemoryStressButton.disabled =
    !layerMemoryFixtureRequested
    || !engineInitialized
    || layerMemoryStressTestRunning
    || layerCompressionStudyRunning
    || layerMemoryStressTestCompleted
    || locked;
  layerCompressionStudyButton.disabled =
    !layerCompressionStudyRequested
    || !engineInitialized
    || layerCompressionStudyRunning
    || layerCompressionStudyCompleted
    || locked;
  iphoneMemoryDeviceLabel.disabled = locked || layerMemoryStressTestCompleted;
  layerFormatSelect.disabled = locked;
  fitViewButton.disabled = locked;
  zoomInButton.disabled = locked;
  zoomOutButton.disabled = locked;
  rotateViewLeftButton.disabled = locked;
  viewRotationButton.disabled = locked;
  rotateViewRightButton.disabled = locked;
  toggleControlsButton.disabled =
    benchmarkRunning || rasterShadowGoldenRunning || rasterStrokeGoldenRunning
    || effectsWorkbenchBenchmarkRunning || layerHistoryTestRunning
    || layerMemoryStressTestRunning
    || layerCompressionStudyRunning
    || renderingModeSuiteRunning
    || humanStrokeReplaying;
  for (const id of brushControlIds) {
    element<HTMLInputElement | HTMLSelectElement>(id).disabled = locked;
  }
  for (const id of ["selectionMethod", "selectionTolerance", "selectionColor"] as const) {
    element<HTMLInputElement | HTMLSelectElement>(id).disabled = locked;
  }
  for (const id of [
    "selectionReplace",
    "selectionAdd",
    "selectionSubtract",
    "selectionColorApply",
    "selectionClear",
  ] as const) {
    element<HTMLButtonElement>(id).disabled = locked;
  }
  updateGrainControlAvailability(locked);
  updateRasterColorOverlayControlAvailability(locked);
  updateRasterStrokeControlAvailability(locked);
  updateRasterOuterShadowControlAvailability(locked);
  updateRasterInnerShadowControlAvailability(locked);
  updateRasterBevelControlAvailability(locked);
  syncMobileBrushControlAvailability(locked);
  mobileToolSettingsSheet?.syncOpenState();
  syncMobileToolsMenuState();
  syncMobileBrushControlsVisibility();
}

async function runHistoryOperation(operation: "undo" | "redo"): Promise<void> {
  if (interactionLocked() || activePointerId !== null) {
    const reason = operation === "undo"
      ? historyState.undoBlockedReason
      : historyState.redoBlockedReason;
    statusElement.textContent = reason ?? "Termina l'operazione corrente e riprova.";
    statusElement.className = "status";
    return;
  }
  if (operation === "undo" ? !historyState.canUndo : !historyState.canRedo) {
    const reason = operation === "undo"
      ? historyState.undoBlockedReason
      : historyState.redoBlockedReason;
    statusElement.textContent = reason ?? "Operazione di cronologia non disponibile.";
    statusElement.className = "status";
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
  "grainMovement",
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
  element<HTMLElement>("grainMovementControl").hidden = grainMode !== "moving";
  for (const id of grainParameterControlIds) {
    element<HTMLInputElement | HTMLSelectElement>(id).disabled =
      locked || !active || (id === "grainMovement" && grainMode !== "moving");
  }
}

const brushControlIds = [
  "brushTool",
  "brushShape",
  "shapeRotation",
  "shapeScatter",
  "grainMode",
  ...grainParameterControlIds,
  "brushColor",
  "fillTolerance",
  "brushSize",
  "spacing",
  "stabilization",
  "startThickness",
  "endThickness",
  "count",
  "flow",
  "opacity",
  "hardness",
  "blendMode",
  "blendStretch",
  "blendPaint",
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

brushColorInput.addEventListener("input", () => syncMobileBrushColor());
brushColorInput.addEventListener("change", () => syncMobileBrushColor());

function applyMobileBrushColor(): void {
  if (mobileBrushColorInput.disabled) return;
  if (activeCanvasTool !== "paint") {
    configureBrushToolUi("paint", true);
  }
  brushColorInput.value = mobileBrushColorInput.value;
  syncMobileBrushColor();
  applyBrushControls();
  updateHistoryControls();
}

mobileBrushColorInput.addEventListener("input", applyMobileBrushColor);
mobileBrushColorInput.addEventListener("change", applyMobileBrushColor);

element<HTMLInputElement>("rasterColorOverlayEnabled").addEventListener("change", () => {
  updateRasterColorOverlayControlAvailability();
  void applyRasterColorOverlayControls();
});
element<HTMLInputElement>("rasterColorOverlayColor").addEventListener("change", () => {
  void applyRasterColorOverlayControls();
});
element<HTMLInputElement>("rasterColorOverlayOpacity").addEventListener("input", () => {
  updateRasterColorOverlayOutput();
});
element<HTMLInputElement>("rasterColorOverlayOpacity").addEventListener("change", () => {
  void applyRasterColorOverlayControls();
});

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

element<HTMLInputElement>("rasterOuterShadowEnabled").addEventListener("change", () => {
  updateRasterOuterShadowControlAvailability();
  void applyRasterOuterShadowControls();
});
element<HTMLSelectElement>("rasterOuterShadowBlendMode").addEventListener("change", () => {
  if (element<HTMLSelectElement>("rasterOuterShadowBlendMode").value === "multiply") {
    setControlValue("rasterOuterShadowColor", "#000000");
  }
  updateRasterOuterShadowControlAvailability();
  void applyRasterOuterShadowControls();
});
const rasterOuterShadowRangeIds = [
  "rasterOuterShadowOpacity",
  "rasterOuterShadowAngle",
  "rasterOuterShadowDistance",
  "rasterOuterShadowSpread",
  "rasterOuterShadowSize",
  "rasterOuterShadowNoise",
] as const;
for (const id of rasterOuterShadowRangeIds) {
  element<HTMLInputElement>(id).addEventListener("input", updateRasterOuterShadowOutputs);
  element<HTMLInputElement>(id).addEventListener("change", () => {
    void applyRasterOuterShadowControls();
  });
}
for (const id of [
  "rasterOuterShadowColor",
  "rasterOuterShadowContour",
  "rasterOuterShadowContourAA",
  "rasterOuterShadowLayerKnocksOut",
] as const) {
  element<HTMLInputElement | HTMLSelectElement>(id).addEventListener("change", () => {
    void applyRasterOuterShadowControls();
  });
}

element<HTMLInputElement>("rasterInnerShadowEnabled").addEventListener("change", () => {
  updateRasterInnerShadowControlAvailability();
  void applyRasterInnerShadowControls();
});
const rasterInnerShadowRangeIds = [
  "rasterInnerShadowOpacity",
  "rasterInnerShadowAngle",
  "rasterInnerShadowDistance",
  "rasterInnerShadowChoke",
  "rasterInnerShadowSize",
  "rasterInnerShadowNoise",
] as const;
for (const id of rasterInnerShadowRangeIds) {
  element<HTMLInputElement>(id).addEventListener("input", updateRasterInnerShadowOutputs);
  element<HTMLInputElement>(id).addEventListener("change", () => {
    void applyRasterInnerShadowControls();
  });
}
for (const id of [
  "rasterInnerShadowBlendMode",
  "rasterInnerShadowColor",
  "rasterInnerShadowContour",
  "rasterInnerShadowContourAA",
] as const) {
  element<HTMLInputElement | HTMLSelectElement>(id).addEventListener("change", () => {
    void applyRasterInnerShadowControls();
  });
}

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
  const selected = element<HTMLSelectElement>("brushTool").value;
  const tool: CanvasTool = selected === "blend"
    ? "blend"
    : selected === "fill"
      ? "fill"
      : selected === "selection"
        ? "selection"
      : selected === "transform"
        ? "transform"
      : "paint";
  configureBrushToolUi(tool, true);
  if (tool === "paint" || tool === "blend") {
    applyBrushControls();
  } else {
    updateControlOutputs();
  }
  updateHistoryControls();
});

element<HTMLSelectElement>("selectionMethod").addEventListener("change", () => {
  cancelKeyboardSelectionGesture(false);
  updateSelectionMethodUi();
  if (activeCanvasTool === "selection" && engineInitialized) {
    configureBrushToolUi("selection", false);
  }
});
element<HTMLInputElement>("selectionTolerance").addEventListener(
  "input",
  updateControlOutputs,
);
element<HTMLButtonElement>("selectionReplace").addEventListener("click", () => {
  setSelectionCombineMode("replace");
});
element<HTMLButtonElement>("selectionAdd").addEventListener("click", () => {
  setSelectionCombineMode("add");
});
element<HTMLButtonElement>("selectionSubtract").addEventListener("click", () => {
  setSelectionCombineMode("subtract");
});
function applySelectionColorRange(): void {
  if (activeCanvasTool !== "selection" || selectedSelectionMethod() !== "color-range") return;
  void runPixelSelectionOperation(() => engine.selectPixelsByColor(
    element<HTMLInputElement>("selectionColor").value,
    rangeValue("selectionTolerance"),
    selectionCombineMode,
  ));
}

function clearPixelSelection(): void {
  void runPixelSelectionOperation(() => engine.clearPixelSelection());
}

element<HTMLButtonElement>("selectionColorApply").addEventListener(
  "click",
  applySelectionColorRange,
);
element<HTMLButtonElement>("selectionClear").addEventListener("click", clearPixelSelection);

benchmarkStampsInput.addEventListener("input", updateControlOutputs);

function startMobileBrushControlDrag(
  kind: MobileBrushControlKind,
  event: PointerEvent,
): void {
  const control = mobileBrushControlElement(kind);
  if (
    event.button !== 0
    || mobileBrushControlDrag !== null
    || interactionLocked()
    || control.getAttribute("aria-disabled") === "true"
  ) {
    return;
  }
  event.preventDefault();
  const travelPixels = mobileBrushControlTrack(kind).getBoundingClientRect().height;
  if (!Number.isFinite(travelPixels) || travelPixels <= 0) return;
  mobileBrushControlDrag = {
    kind,
    pointerId: event.pointerId,
    startClientY: event.clientY,
    startPercent: mobileBrushControlPercent(kind),
    startInputValue: mobileBrushControlInput(kind).value,
    travelPixels,
  };
  mobileBrushControls.dataset.active = kind;
  mobileBrushControls.classList.add("is-adjusting");
  mobileBrushPreview.setAttribute("aria-hidden", "false");
  control.classList.add("is-active");
  control.setPointerCapture(event.pointerId);
  syncMobileBrushControlVisuals();
}

function moveMobileBrushControlDrag(event: PointerEvent): void {
  const drag = mobileBrushControlDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  event.preventDefault();
  const deltaPercent = (event.clientY - drag.startClientY) / drag.travelPixels * 100;
  setMobileBrushControlPercent(drag.kind, drag.startPercent - deltaPercent);
}

function finishMobileBrushControlPointer(event: PointerEvent): void {
  if (!mobileBrushControlDrag || event.pointerId !== mobileBrushControlDrag.pointerId) return;
  event.preventDefault();
  finishMobileBrushControlDrag(true);
}

function handleMobileBrushControlKeydown(
  kind: MobileBrushControlKind,
  event: KeyboardEvent,
): void {
  const control = mobileBrushControlElement(kind);
  if (
    interactionLocked()
    || control.getAttribute("aria-disabled") === "true"
    || event.altKey
    || event.ctrlKey
    || event.metaKey
  ) {
    return;
  }
  const input = mobileBrushControlInput(kind);
  const step = event.shiftKey ? 10 : 1;
  const current = Number(input.value);
  const minimum = Number(input.min);
  const maximum = Number(input.max);
  let next: number | null = null;
  if (event.key === "ArrowUp" || event.key === "ArrowRight") next = current + step;
  else if (event.key === "ArrowDown" || event.key === "ArrowLeft") next = current - step;
  else if (event.key === "Home") next = maximum;
  else if (event.key === "End") next = minimum;
  if (next === null) return;
  event.preventDefault();
  input.value = Math.min(maximum, Math.max(minimum, next)).toString();
  syncMobileBrushControlVisuals();
  applyBrushControls();
}

for (const [control, kind] of [
  [mobileBrushSizeControl, "size"],
  [mobileBrushOpacityControl, "opacity"],
  [mobileBrushStretchControl, "stretch"],
  [mobileBrushPaintControl, "paint"],
] as const) {
  control.addEventListener("pointerdown", (event) => {
    startMobileBrushControlDrag(kind, event);
  });
  control.addEventListener("pointermove", moveMobileBrushControlDrag);
  control.addEventListener("pointerup", finishMobileBrushControlPointer);
  control.addEventListener("pointercancel", finishMobileBrushControlPointer);
  control.addEventListener("lostpointercapture", finishMobileBrushControlPointer);
  control.addEventListener("keydown", (event) => {
    handleMobileBrushControlKeydown(kind, event);
  });
}

mobileToolsMenuButton.addEventListener("click", () => {
  setMobileToolsSheetOpen(!mobileToolsSheetOpen);
});

mobileLayersMenuButton.addEventListener("click", () => {
  setMobileLayersPanelOpen(!mobileLayersPanelOpen);
});

mobileAddLayerButton.addEventListener("click", () => {
  if (!mobileAddLayerButton.disabled) addLayerButton.click();
});

mobileAddMaskButton.addEventListener("click", () => {
  if (!mobileAddMaskButton.disabled) void addMobileClippingMaskLayer();
});

mobileLayerList.addEventListener("pointerdown", handleMobileLayerReorderPointerDown);
mobileLayerList.addEventListener("pointermove", handleMobileLayerReorderPointerMove);
mobileLayerList.addEventListener("pointerup", handleMobileLayerReorderPointerUp);
mobileLayerList.addEventListener("pointercancel", handleMobileLayerReorderPointerEnd);
mobileLayerList.addEventListener("lostpointercapture", handleMobileLayerReorderPointerEnd);
mobileLayerList.addEventListener("keydown", handleMobileLayerReorderKeydown);
mobileLayerList.addEventListener("contextmenu", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const select = target?.closest<HTMLButtonElement>(
    ".mobile-layer-row.is-selected .mobile-layer-select",
  );
  const row = select?.closest<HTMLElement>(".mobile-layer-row.is-selected");
  const key = row?.dataset.layerKey;
  if (!select || !row || !key || !isMobileMixedSceneLayerKey(key)) return;
  event.preventDefault();
  cancelMobileLayerReorderGesture(false, false, false);
  openMobileLayerContextMenu(key, row);
  (mobileLayerClippingButton.hidden || mobileLayerClippingButton.disabled
    ? mobileLayerOptionsButton
    : mobileLayerClippingButton).focus({ preventScroll: true });
});

mobileLayerClippingButton.addEventListener("click", () => {
  const properties = mobileLayerProperties(mobileLayerContextKey);
  if (
    !properties
    || properties.kind !== "raster"
    || properties.rasterIndex === null
    || properties.locked
    || !properties.clippingAvailable
  ) {
    return;
  }
  closeMobileLayerContextMenu(false);
  void changeLayerClipping(properties.rasterIndex, !properties.clippingEnabled);
});

mobileLayerOptionsButton.addEventListener("click", () => {
  const properties = mobileLayerProperties(mobileLayerContextKey);
  if (!properties || properties.locked) return;
  closeMobileLayerContextMenu(false);
  mobileToolSettingsSheet?.open("layer-options", mobileLayersMenuButton);
});

document.addEventListener("pointerdown", (event) => {
  if (mobileLayerContextKey === null || !(event.target instanceof Node)) return;
  if (mobileLayerContextMenu.contains(event.target)) return;
  const activeRow = mobileLayerList.querySelector<HTMLElement>(
    `[data-layer-key="${CSS.escape(mobileLayerContextKey)}"]`,
  );
  if (activeRow?.contains(event.target)) return;
  closeMobileLayerContextMenu(false);
}, { capture: true });

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || mobileLayerContextKey === null) return;
  event.preventDefault();
  closeMobileLayerContextMenu(true);
});

mobileLayerList.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const actionButton = event.target.closest<HTMLButtonElement>(
    "[data-mobile-layer-action]",
  );
  const row = actionButton?.closest<HTMLElement>("[data-layer-key]");
  const action = actionButton?.dataset.mobileLayerAction;
  const key = row?.dataset.layerKey;
  if (!actionButton || actionButton.disabled || !action || !key) return;
  if (
    action === "select"
    && key === mobileLayerReorderSuppressClickKey
    && performance.now() <= mobileLayerReorderSuppressClickUntil
  ) {
    event.preventDefault();
    mobileLayerReorderSuppressClickKey = null;
    mobileLayerReorderSuppressClickUntil = 0;
    return;
  }
  runMobileLayerAction(action, key);
});

for (const button of mobileBrushLibraryCategoryButtons) {
  button.addEventListener("click", () => {
    const category = button.dataset.mobileBrushCategory;
    if (
      category === "pencil"
      || category === "painting"
      || category === "spray-paint"
    ) {
      setMobileBrushLibraryCategory(category);
    }
  });
}

function mobileBrushLibraryName(brushId: MobileBrushLibraryBrushId): string {
  const card = mobileBrushLibraryCards.find(
    (candidate) => candidate.dataset.mobileBrushId === brushId,
  );
  return card?.querySelector<HTMLElement>(".mobile-brush-card-name")?.textContent?.trim()
    || (brushId === PENCIL_BRUSH_PRESET.id ? PENCIL_BRUSH_PRESET.name : "Default Brush");
}

function mobileBrushLibraryCategoryForBrush(
  brushId: MobileBrushLibraryBrushId,
): MobileBrushLibraryCategory {
  return brushId === PENCIL_BRUSH_PRESET.id ? "pencil" : "painting";
}

function persistActiveMobileBrushLibraryBrush(): void {
  try {
    saveBrushStudioLibraryState(activeMobileBrushLibraryBrushId);
  } catch {
    // Settings remain authoritative in their own localStorage record. This
    // small pointer only restores which saved card is active after a refresh.
  }
}

async function selectMobileBrushLibraryBrush(
  brushId: MobileBrushLibraryBrushId,
): Promise<void> {
  const studio = mobileBrushStudio;
  if (!studio) return;
  if (brushId === activeMobileBrushLibraryBrushId) {
    studio.open(brushId, mobileBrushLibraryName(brushId), engine.getSettings());
    return;
  }

  const revision = ++mobileBrushLibrarySelectionRevision;
  const currentSettings = engine.getSettings();
  studio.rememberSettings(activeMobileBrushLibraryBrushId, currentSettings);
  const fallback = brushId === PENCIL_BRUSH_PRESET.id
    ? resolveBrushPresetSettings(PENCIL_BRUSH_PRESET, currentSettings)
    : mobileCurrentBrushFallback(currentSettings);
  try {
    const settings = await studio.resolveBrushSettings(brushId, fallback);
    if (revision !== mobileBrushLibrarySelectionRevision) return;
    applySettingsToControls(settings);
    activeMobileBrushLibraryBrushId = brushId;
    setMobileBrushLibraryCategory(mobileBrushLibraryCategoryForBrush(brushId));
    persistActiveMobileBrushLibraryBrush();
    syncMobileBrushLibrarySelection();
    markMobileBrushLibraryPreviewDirty();
  } catch (error) {
    statusElement.textContent = error instanceof Error ? error.message : String(error);
    statusElement.className = "status error";
  }
}

mobileCurrentBrushCard.addEventListener("click", () => {
  void selectMobileBrushLibraryBrush("current");
});

mobilePencilBrushCard.addEventListener("click", () => {
  void selectMobileBrushLibraryBrush(PENCIL_BRUSH_PRESET.id);
});

mobileBrushLibraryHandle.addEventListener("pointerdown", (event) => {
  if (!mobileBrushLibraryOpen || event.button !== 0) return;
  mobileBrushLibraryDragPointerId = event.pointerId;
  mobileBrushLibraryDragStartY = event.clientY;
  mobileBrushLibraryDragStartOffsetPx = mobileBrushLibraryOffsetPx;
  mobileBrushLibraryDragLastY = event.clientY;
  mobileBrushLibraryDragLastTime = performance.now();
  mobileBrushLibraryDragVelocityY = 0;
  mobileBrushLibraryDragMoved = false;
  mobileBrushLibrarySheet.classList.add("is-dragging");
  mobileBrushLibraryHandle.setPointerCapture(event.pointerId);
});

mobileBrushLibraryHandle.addEventListener("pointermove", (event) => {
  if (event.pointerId !== mobileBrushLibraryDragPointerId) return;
  const deltaY = event.clientY - mobileBrushLibraryDragStartY;
  recordMobileBrushLibraryDragMotion(event.clientY);
  if (Math.abs(deltaY) >= 4) mobileBrushLibraryDragMoved = true;
  setMobileBrushLibraryOffset(mobileBrushLibraryDragStartOffsetPx + deltaY);
});

mobileBrushLibraryHandle.addEventListener("pointerup", (event) => {
  finishMobileBrushLibraryDrag(event);
});

mobileBrushLibraryHandle.addEventListener("pointercancel", (event) => {
  finishMobileBrushLibraryDrag(event, true);
});

mobileBrushLibraryHandle.addEventListener("click", () => {
  if (!mobileBrushLibraryOpen) return;
  if (mobileBrushLibraryDragMoved) {
    mobileBrushLibraryDragMoved = false;
    return;
  }
  setMobileBrushLibraryOpen(false);
  mobilePaintButton.focus({ preventScroll: true });
});

mobileToolsSheetHandle.addEventListener("pointerdown", (event) => {
  if (!mobileToolsSheetOpen || event.button !== 0) return;
  mobileToolsSheetDragPointerId = event.pointerId;
  mobileToolsSheetDragStartY = event.clientY;
  mobileToolsSheetDragStartOffsetPx = mobileToolsSheetOffsetPx;
  mobileToolsSheetDragStartSnap = mobileToolsSheetSnap;
  mobileToolsSheetDragLastY = event.clientY;
  mobileToolsSheetDragLastTime = performance.now();
  mobileToolsSheetDragVelocityY = 0;
  mobileToolsSheetDragMoved = false;
  mobileToolsSheet.classList.add("is-dragging");
  mobileToolsSheetHandle.setPointerCapture(event.pointerId);
});

mobileToolsSheetHandle.addEventListener("pointermove", (event) => {
  if (event.pointerId !== mobileToolsSheetDragPointerId) return;
  const deltaY = event.clientY - mobileToolsSheetDragStartY;
  recordMobileToolsSheetDragMotion(event.clientY);
  if (Math.abs(deltaY) >= 4) {
    mobileToolsSheetDragMoved = true;
  }
  setMobileToolsSheetOffset(mobileToolsSheetDragStartOffsetPx + deltaY, true);
});

mobileToolsSheetHandle.addEventListener("pointerup", (event) => {
  finishMobileToolsSheetDrag(event);
});

mobileToolsSheetHandle.addEventListener("pointercancel", (event) => {
  finishMobileToolsSheetDrag(event, true);
});

mobileToolsSheetHandle.addEventListener("click", () => {
  if (!mobileToolsSheetOpen) return;
  if (mobileToolsSheetDragMoved) {
    mobileToolsSheetDragMoved = false;
    return;
  }
  snapMobileToolsSheet(mobileToolsSheetSnap === "peek" ? "expanded" : "peek");
});

mobileToolsSearchField.addEventListener("pointerdown", (event) => {
  if (
    !mobileToolsSheetOpen
    || mobileToolsSheetSnap === "expanded"
    || event.button !== 0
  ) {
    return;
  }
  event.preventDefault();
  expandMobileToolsSheetForSearchFocus();
  mobileToolsSearchInput.focus({ preventScroll: true });
});

mobileToolsSearchInput.addEventListener("focus", () => {
  expandMobileToolsSheetForSearchFocus();
});

function updateMobileToolsSearchResults(): void {
  filterMobileTools();
  mobileToolsSheetContent.scrollTop = 0;
}

mobileToolsSearchInput.addEventListener("input", updateMobileToolsSearchResults);
mobileToolsSearchInput.addEventListener("search", updateMobileToolsSearchResults);

mobileUiMediaQuery.addEventListener("change", (event) => {
  if (event.matches) {
    setControlsPanelOpen(false);
    syncMobileBrushControlVisuals();
    syncMobileBrushControlAvailability();
    syncMobileBrushControlsVisibility();
    return;
  }
  setMobileToolsSheetOpen(false);
  setMobileLayersPanelOpen(false);
  setMobileBrushLibraryOpen(false);
  mobileStrokeSheet?.close(false);
  mobileRasterEffectsSheet?.close(false);
  mobileToolSettingsSheet?.close(false);
  mobileBrushStudio?.cancel(false);
  setControlsPanelOpen(true);
  syncMobileBrushControlsVisibility();
});

window.addEventListener("resize", () => {
  cancelMobileLayerReorderGesture();
  const toolsNeedLayout = mobileToolsSheetOpen && mobileToolsSheetDragPointerId === null;
  const brushLibraryNeedsLayout = mobileBrushLibraryOpen
    && mobileBrushLibraryDragPointerId === null;
  const brushStudioNeedsLayout = mobileBrushStudio?.isOpen === true;
  const strokeSheetNeedsLayout = mobileStrokeSheet?.isOpen === true;
  const rasterEffectsSheetNeedsLayout = mobileRasterEffectsSheet?.isOpen === true;
  const toolSettingsSheetNeedsLayout = mobileToolSettingsSheet?.isOpen === true;
  if (
    !toolsNeedLayout
    && !brushLibraryNeedsLayout
    && !brushStudioNeedsLayout
    && !strokeSheetNeedsLayout
    && !rasterEffectsSheetNeedsLayout
    && !toolSettingsSheetNeedsLayout
  ) return;
  if (mobileToolsSheetResizeFrame !== null) {
    cancelAnimationFrame(mobileToolsSheetResizeFrame);
  }
  mobileToolsSheetResizeFrame = requestAnimationFrame(() => {
    mobileToolsSheetResizeFrame = null;
    if (mobileToolsSheetOpen && mobileToolsSheetDragPointerId === null) {
      snapMobileToolsSheet(mobileToolsSheetSnap);
    }
    if (mobileBrushLibraryOpen && mobileBrushLibraryDragPointerId === null) {
      setMobileBrushLibraryOffset(0);
    }
    mobileBrushStudio?.handleResize();
    mobileStrokeSheet?.handleResize();
    mobileRasterEffectsSheet?.handleResize();
    mobileToolSettingsSheet?.handleResize();
  });
});

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
layerMemoryStressButton.addEventListener("click", () => {
  if (mixedMemoryBenchmarkRequested) {
    void runRequestedMixedMemoryBenchmark();
  } else if (iphoneMemoryLimitTestRequested) {
    void runRequestedIphoneMemoryLimitTest();
  } else {
    void runRequestedLayerMemoryStressTest();
  }
});
layerCompressionStudyButton.addEventListener("click", () => {
  void runRequestedLayerCompressionStudy();
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

function selectMobileCanvasTool(
  tool: CanvasTool,
  preserveMobileToolSettingsSheet = false,
): boolean {
  if (interactionLocked()) return false;
  const brushToolSelect = element<HTMLSelectElement>("brushTool");
  brushToolSelect.value = tool;
  if (preserveMobileToolSettingsSheet) {
    configureBrushToolUi(tool, true, true);
    if (tool === "paint" || tool === "blend") applyBrushControls();
    else updateControlOutputs();
    updateHistoryControls();
  } else {
    brushToolSelect.dispatchEvent(new Event("change", { bubbles: true }));
  }
  return true;
}

function restoreMobileTextDistortTool(): void {
  const returnTool = mobileTextDistortReturnTool;
  mobileTextDistortReturnTool = null;
  if (returnTool && activeCanvasTool === "transform") {
    selectMobileCanvasTool(returnTool, true);
  }
}

function stopMobileTextDistortEditing(): void {
  const controller = vectorTextPrototype;
  if (!controller?.isSelectedTextDistortEditing()) return;
  controller.toggleSelectedTextDistortEditing();
  restoreMobileTextDistortTool();
}

function toggleMobileTextDistortEditing(): boolean {
  const controller = vectorTextPrototype;
  if (!controller) return false;
  if (controller.isSelectedTextDistortEditing()) {
    controller.toggleSelectedTextDistortEditing();
    restoreMobileTextDistortTool();
    return false;
  }
  mobileTextDistortReturnTool = activeCanvasTool === "transform"
    ? activeBrushTool
    : activeCanvasTool;
  if (!controller.toggleSelectedTextDistortEditing()) {
    mobileTextDistortReturnTool = null;
    return false;
  }
  if (selectMobileCanvasTool("transform", true)) return true;
  controller.toggleSelectedTextDistortEditing();
  mobileTextDistortReturnTool = null;
  return false;
}

function setMobileTextWarpMode(mode: MobileTextWarpMode): void {
  const controller = vectorTextPrototype;
  if (!controller) return;
  const wasDistortEditing = controller.isSelectedTextDistortEditing();
  controller.setSelectedTextTransform(mode);
  if (wasDistortEditing && mode !== "distort") restoreMobileTextDistortTool();
}

function resetMobileText(): void {
  stopMobileTextDistortEditing();
  vectorTextPrototype?.resetSelectedText();
}

function deleteMobileText(): void {
  stopMobileTextDistortEditing();
  vectorTextPrototype?.deleteSelectedText();
}

function rasterizeMobileText(): void {
  stopMobileTextDistortEditing();
  vectorTextPrototype?.rasterizeSelectedTextNode();
}

mobilePaintButton.addEventListener("click", () => {
  if (activeCanvasTool === "paint") {
    setMobileBrushLibraryOpen(!mobileBrushLibraryOpen);
    return;
  }
  selectMobileCanvasTool("paint");
});
mobileBlendButton.addEventListener("click", () => {
  selectMobileCanvasTool("blend");
});
for (const button of mobileToolsCanvasButtons) {
  button.addEventListener("click", () => {
    if (button.dataset.mobileToolSheet) return;
    const tool = button.dataset.mobileCanvasTool;
    if (
      tool !== "paint"
      && tool !== "blend"
      && tool !== "fill"
      && tool !== "selection"
      && tool !== "transform"
    ) {
      return;
    }
    if (selectMobileCanvasTool(tool)) {
      setMobileToolsSheetOpen(false);
    }
  });
}
for (const button of mobileToolSettingsButtons) {
  button.addEventListener("click", () => {
    const kind = button.dataset.mobileToolSheet;
    if (
      kind !== "fill"
      && kind !== "selection"
      && kind !== "transform"
      && kind !== "svg-style"
      && kind !== "text"
      && kind !== "text-warp"
      && kind !== "text-outline"
      && kind !== "text-drop-shadow"
      && kind !== "text-inner-shadow"
      && kind !== "text-block-shadow"
    ) {
      return;
    }
    mobileToolSettingsSheet?.open(kind as MobileToolSettingsKind, button);
  });
}
for (const button of mobileToolsProxyButtons) {
  button.addEventListener("click", () => {
    const targetId = button.dataset.mobileProxyButton;
    const controller = vectorTextPrototype;
    if (!controller) return;
    setMobileToolsSheetOpen(false);
    if (targetId === "vectorSvgImportButton") controller.requestSvgImport();
    else if (targetId === "rasterImageImportButton") controller.requestRasterImageImport();
  });
}
for (const button of mobileToolsEffectButtons) {
  button.addEventListener("click", () => {
    const controlId = button.dataset.mobileEffectControl;
    const control = controlId
      ? document.getElementById(controlId) as HTMLInputElement | null
      : null;
    if (!control || control.disabled || !engineInitialized) return;
    if (controlId === "rasterStrokeEnabled" && mobileStrokeSheet) {
      mobileStrokeSheet.open(button);
      return;
    }
    const effectKind = controlId
      ? MOBILE_RASTER_EFFECT_KIND_BY_CONTROL_ID[
        controlId as keyof typeof MOBILE_RASTER_EFFECT_KIND_BY_CONTROL_ID
      ]
      : undefined;
    if (effectKind && mobileRasterEffectsSheet) {
      mobileRasterEffectsSheet.open(effectKind, button);
      return;
    }
    control.click();
    syncMobileToolsMenuState();
  });
}
mobileUndoButton.addEventListener("click", () => {
  void runHistoryOperation("undo");
});
mobileRedoButton.addEventListener("click", () => {
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
rotateViewLeftButton.addEventListener("click", () => {
  if (!interactionLocked() && activePointerId === null) {
    engine.rotateViewBy(-Math.PI / 12);
  }
});
viewRotationButton.addEventListener("click", () => {
  if (!interactionLocked() && activePointerId === null) {
    engine.resetViewRotation();
  }
});
rotateViewRightButton.addEventListener("click", () => {
  if (!interactionLocked() && activePointerId === null) {
    engine.rotateViewBy(Math.PI / 12);
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
    syncRasterColorOverlayControls(engine.getRasterColorOverlayStyle());
    syncRasterStrokeControls(engine.getRasterStrokeStyle());
    syncRasterOuterShadowControls(engine.getRasterOuterShadowStyle());
    syncRasterInnerShadowControls(engine.getRasterInnerShadowStyle());
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
  rasterShadowGoldenButton.addEventListener("click", async () => {
    if (interactionLocked()) {
      return;
    }
    rasterShadowGoldenRunning = true;
    rasterShadowGoldenDetails.hidden = true;
    rasterShadowGoldenButton.disabled = true;
    rasterShadowGoldenResult.textContent = "Cattura Golden Ombre sulla GPU…";
    updateHistoryControls();
    updateHumanStrokeControls();
    try {
      const report = await engine.runRasterShadowGolden();
      const serialized = JSON.stringify(report, null, 2);
      rasterShadowGoldenReport.textContent = serialized;
      rasterShadowGoldenDetails.hidden = false;
      let copied = false;
      try {
        await navigator.clipboard.writeText(serialized);
        copied = true;
      } catch {
        // Il report resta visibile e disponibile sull'oggetto window.
      }
      (
        window as Window & { __rasterShadowGoldenReport?: typeof report }
      ).__rasterShadowGoldenReport = report;
      rasterShadowGoldenResult.textContent =
        (report.baselineMatches ? "Golden Ombre identico" : "Golden Ombre da fissare")
        + " · v" + report.version + " · " + report.combinedSha256
        + " · mip " + report.mipCombinedSha256
        + " · " + report.cases.length + " casi"
        + " · ripetizione " + (report.repeatMatches ? "OK" : "fallita")
        + (report.baselineMatches
          ? ""
          : " · differenze: " + report.baselineMismatches.join(", "))
        + (copied ? " · report copiato" : "");
    } catch (error) {
      rasterShadowGoldenResult.textContent =
        error instanceof Error ? error.message : String(error);
    } finally {
      rasterShadowGoldenRunning = false;
      updateHistoryControls();
      updateHumanStrokeControls();
    }
  });

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
    "Benchmark dev isolato: tutti gli effetti del livello devono essere disattivati.";
  effectsWorkbenchBenchmarkButton.addEventListener("click", async () => {
    if (interactionLocked()) {
      return;
    }
    effectsWorkbenchBenchmarkRunning = true;
    effectsWorkbenchBenchmarkDetails.hidden = true;
    effectsWorkbenchBenchmarkResult.textContent =
      `Misuro retarget e destroy+recreate sul documento ${LAYER_SIZE}²…`;
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

function iphoneMemoryOperationLabel(event: IphoneMemoryLimitEvent): string {
  switch (event.operation) {
    case "add-layer":
      return `aggiunta livello ${event.targetLayerCount ?? "?"}`
        + (event.storageMiB === undefined ? "" : ` (+${formatMemoryMiB(event.storageMiB)} raw)`);
    case "arm-final-layer":
      return "preparazione del livello finale";
    case "switch-middle":
      return `cambio al livello centrale ${(event.targetLayerIndex ?? 0) + 1}`;
    case "switch-top":
      return `ritorno al livello superiore ${(event.targetLayerIndex ?? 0) + 1}`;
  }
}

function showIphoneMemoryLimitRun(
  run: IphoneMemoryLimitRun,
  openDetails = false,
): void {
  layerMemoryStressReport.textContent = JSON.stringify(run, null, 2);
  layerMemoryStressDetails.hidden = false;
  layerMemoryStressDetails.open = openDetails;
  (
    window as Window & { __iphoneMemoryLimitRun?: IphoneMemoryLimitRun }
  ).__iphoneMemoryLimitRun = run;
}

function updateIphoneMemoryLimitProgress(progress: IphoneMemoryLimitProgress): void {
  const { run, event, completedOperations, totalOperations } = progress;
  showIphoneMemoryLimitRun(run);
  updateStats(engine.getStats());
  const operation = iphoneMemoryOperationLabel(event);
  if (event.kind === "attempt") {
    layerMemoryStressResult.className = "result";
    layerMemoryStressResult.textContent =
      `Checkpoint salvato nel progetto · provo ${operation} · `
      + `ultimo sicuro ${formatMemoryMiB(run.lastSafeMiB)} · `
      + `${completedOperations}/${totalOperations}`;
    return;
  }
  if (event.kind === "completed") {
    layerMemoryStressResult.className = "result ok";
    layerMemoryStressResult.textContent =
      `${operation} riuscita e salvata · sicuro ${formatMemoryMiB(run.lastSafeMiB)}`
      + ` · picco ${formatMemoryMiB(run.highestObservedPeakMiB)}`
      + ` · ${completedOperations}/${totalOperations}`;
    return;
  }
  layerMemoryStressResult.className = "result error";
  layerMemoryStressResult.textContent =
    `${operation} interrotta · ultimo sicuro ${formatMemoryMiB(run.lastSafeMiB)}`
    + " · risultato già salvato nel progetto.";
}

async function recoverRequestedIphoneMemoryLimitTest(): Promise<void> {
  if (!iphoneMemoryLimitTestRequested) {
    return;
  }
  try {
    const { recoverInterruptedIphoneMemoryLimitRun } = await import(
      "./iphone-memory-limit-test"
    );
    const run = await recoverInterruptedIphoneMemoryLimitRun(
      iphoneMemoryLimitServerRequired,
    );
    if (!run) {
      return;
    }
    showIphoneMemoryLimitRun(run, true);
    const latestEvent = run.events.at(-1);
    const operation = latestEvent
      ? iphoneMemoryOperationLabel(latestEvent)
      : "operazione sconosciuta";
    if (run.status === "completed") {
      layerMemoryStressResult.className = "result ok";
      layerMemoryStressResult.textContent =
        `Test precedente completato e salvato · ${formatMemoryMiB(run.lastSafeMiB)} sicuri`
        + ` · picco ${formatMemoryMiB(run.highestObservedPeakMiB)}.`;
    } else if (run.status === "interrupted") {
      layerMemoryStressResult.className = "result error";
      layerMemoryStressResult.textContent =
        `Chiusura precedente rilevata durante ${operation} · ultimo checkpoint sicuro `
        + `${formatMemoryMiB(run.lastSafeMiB)}. È già tutto salvato nel progetto.`;
    } else {
      layerMemoryStressResult.className = "result error";
      layerMemoryStressResult.textContent =
        `Test precedente ${run.status} durante ${operation} · ultimo sicuro `
        + `${formatMemoryMiB(run.lastSafeMiB)}. Il report è salvato.`;
    }
    layerMemoryStressButton.textContent = "Avvia un nuovo test del limite";
  } catch (error) {
    layerMemoryStressResult.className = "result error";
    layerMemoryStressResult.textContent =
      `Impossibile rileggere il checkpoint salvato · ${
        error instanceof Error ? error.message : String(error)
      }`;
  }
}

async function waitForVectorTextRenderAfter(
  previousRenderCount: number,
): Promise<ReturnType<MixedVectorTextController["getDiagnostics"]>> {
  const controller = vectorTextPrototype;
  if (!controller) {
    throw new Error("Controller testo non disponibile per il probe zoom.");
  }
  for (let frame = 0; frame < 24; frame += 1) {
    await nextAnimationFrame();
    const diagnostics = controller.getDiagnostics();
    if (diagnostics.renderCount > previousRenderCount) {
      return diagnostics;
    }
  }
  throw new Error("Il testo non ha completato il ridisegno dello zoom.");
}

async function runMixedMemoryZoomProbe(): Promise<MixedMemoryZoomProbe> {
  const controller = vectorTextPrototype;
  if (!controller) {
    throw new Error("Controller testo non disponibile per il probe zoom.");
  }
  controller.setAdaptiveZoomEnabled(false);
  try {
    const factors =
      [1.15, 1.15, 1.15, 1 / 1.15, 1 / 1.15, 1 / 1.15, 1.35, 1 / 1.35];
    const vectorRenderMs: number[] = [];
    const endToEndMs: number[] = [];

    engine.fitView();
    await nextAnimationFrame();
    await nextAnimationFrame();
    await engine.waitForIdle();

    for (const factor of factors) {
      const before = controller.getDiagnostics();
      const startedAt = performance.now();
      engine.zoomBy(factor);
      const rendered = await waitForVectorTextRenderAfter(before.renderCount);
      await engine.waitForIdle();
      vectorRenderMs.push(rendered.lastRenderMs);
      endToEndMs.push(performance.now() - startedAt);
    }

    engine.fitView();
    await nextAnimationFrame();
    await nextAnimationFrame();
    await engine.waitForIdle();

    return {
      version: 1,
      factors,
      vectorRenderMs,
      endToEndMs,
      vectorRenderP50Ms: percentile(vectorRenderMs, 0.5),
      vectorRenderP95Ms: percentile(vectorRenderMs, 0.95),
      vectorRenderMaxMs: Math.max(...vectorRenderMs),
      endToEndP50Ms: percentile(endToEndMs, 0.5),
      endToEndP95Ms: percentile(endToEndMs, 0.95),
      endToEndMaxMs: Math.max(...endToEndMs),
    };
  } finally {
    controller.setAdaptiveZoomEnabled(true);
  }
}

async function runRequestedMixedMemoryBenchmark(): Promise<void> {
  if (
    !mixedMemoryBenchmarkRequested
    || interactionLocked()
    || layerMemoryStressTestCompleted
  ) {
    return;
  }

  layerMemoryStressTestRunning = true;
  layerMemoryStressDetails.hidden = true;
  layerMemoryStressResult.className = "result";
  layerMemoryStressResult.textContent =
    `Creo 64 testi e i raster reali fino a circa `
    + `${mixedMemoryBenchmarkTargetMiB} MiB… non cambiare scheda.`;
  layerMemoryStressButton.textContent = "Scenario misto in preparazione…";
  setGpuMemoryPanelOpen(true);
  updateHistoryControls();
  updateHumanStrokeControls();

  try {
    layerMemoryStressResult.textContent =
      "Misuro prima lo stesso zoom con un raster e un testo…";
    const baselineZoomProbe = await runMixedMemoryZoomProbe();
    layerMemoryStressResult.textContent =
      "Baseline zoom acquisita. Creo 64 testi e i raster reali…";
    const { runMixedMemoryBenchmark } =
      await import("./mixed-memory-benchmark");
    const setup = await runMixedMemoryBenchmark(
      engine,
      mixedMemoryBenchmarkTargetMiB,
      (progress) => {
        updateStats(engine.getStats());
        const action = progress.phase === "text"
          ? "Preparo testi e ombre"
          : progress.phase === "raster"
            ? "Alloco i raster"
            : progress.phase === "complete"
              ? "Working set pronto"
              : "Stabilizzo la scena";
        layerMemoryStressResult.textContent =
          `${action} · ${progress.textNodeCount}/64 testi · `
          + `${progress.rasterLayerCount} raster · `
          + `${formatMemoryMiB(progress.countedTotalMiB)} / `
          + `${formatMemoryMiB(progress.targetMiB)} · picco `
          + formatMemoryMiB(progress.peakCountedTotalMiB);
      },
    );

    layerMemoryStressResult.textContent =
      "Working set pronto. Misuro otto cambi zoom con tutti i testi visibili…";
    const zoomProbe = await runMixedMemoryZoomProbe();
    const diagnostics = vectorTextPrototype?.getDiagnostics();
    if (!diagnostics) {
      throw new Error("Diagnostica testo non disponibile dopo la preparazione.");
    }
    const browserCanvasLogicalMiB =
      diagnostics.viewportCanvasLogicalMiB
      + diagnostics.singleShadowBrowserLogicalMiB;
    const vectorCpuKnownLogicalMiB =
      diagnostics.vectorFontLogicalMiB
      + diagnostics.blockShadowPathLogicalMiB;
    const zoomVectorP95SlowdownRatio = baselineZoomProbe.vectorRenderP95Ms > 0
      ? zoomProbe.vectorRenderP95Ms / baselineZoomProbe.vectorRenderP95Ms
      : 0;
    const zoomEndToEndP95SlowdownRatio = baselineZoomProbe.endToEndP95Ms > 0
      ? zoomProbe.endToEndP95Ms / baselineZoomProbe.endToEndP95Ms
      : 0;
    const report: MixedMemoryBenchmarkSessionReport = {
      ...setup,
      browserCanvasLogicalMiB,
      vectorCpuKnownLogicalMiB,
      knownLogicalWorkingSetMiB:
        setup.countedTotalMiB
        + browserCanvasLogicalMiB
        + vectorCpuKnownLogicalMiB,
      baselineZoomProbe,
      zoomProbe,
      zoomVectorP95SlowdownRatio,
      zoomEndToEndP95SlowdownRatio,
    };
    mixedMemoryBenchmarkReport = report;
    layerMemoryStressReport.textContent = JSON.stringify(report, null, 2);
    layerMemoryStressDetails.hidden = false;
    layerMemoryStressDetails.open = true;
    (
      window as Window & {
        __mixedMemoryBenchmarkReport?: MixedMemoryBenchmarkSessionReport;
      }
    ).__mixedMemoryBenchmarkReport = report;
    layerMemoryStressResult.className = "result ok";
    layerMemoryStressResult.textContent =
      `Scenario pronto · ${formatMemoryMiB(report.countedTotalMiB)} GPU conteggiati`
      + ` · ${formatMemoryMiB(report.browserCanvasLogicalMiB)} canvas browser`
      + ` · ${report.textNodeCount} testi / ${report.textRunCount} gruppi`
      + ` · zoom testo p95 ${report.baselineZoomProbe.vectorRenderP95Ms.toFixed(1)}`
      + `→${report.zoomProbe.vectorRenderP95Ms.toFixed(1)} ms`
      + ` (${report.zoomVectorP95SlowdownRatio.toFixed(1)}×)`
      + ` · zoom end-to-end p95 ${report.baselineZoomProbe.endToEndP95Ms.toFixed(1)}`
      + `→${report.zoomProbe.endToEndP95Ms.toFixed(1)} ms`
      + ` (${report.zoomEndToEndP95SlowdownRatio.toFixed(1)}×)`
      + " · ora premi Play tratto registrato.";
    layerMemoryStressButton.textContent = "Scenario misto pronto";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stats = engine.getStats();
    const failure = {
      version: 1,
      passed: false,
      error: message,
      layerCount: stats.layerCount,
      textNodeCount:
        stats.mixedScene?.items.filter((item) => item.kind === "text").length ?? 0,
      gpuMemory: stats.gpuMemory,
    };
    layerMemoryStressReport.textContent = JSON.stringify(failure, null, 2);
    layerMemoryStressDetails.hidden = false;
    layerMemoryStressDetails.open = true;
    layerMemoryStressResult.className = "result error";
    layerMemoryStressResult.textContent = `Scenario misto interrotto · ${message}`;
    layerMemoryStressButton.textContent = "Scenario interrotto — ricarica per riprovare";
  } finally {
    layerMemoryStressTestRunning = false;
    layerMemoryStressTestCompleted = true;
    historyState = engine.getHistoryState();
    syncActiveLayerControls();
    updateHistoryControls();
    updateHumanStrokeControls();
    updateStats(engine.getStats());
  }
}

async function runRequestedIphoneMemoryLimitTest(): Promise<void> {
  if (
    !iphoneMemoryLimitTestRequested
    || interactionLocked()
    || layerMemoryStressTestCompleted
  ) {
    return;
  }

  layerMemoryStressTestRunning = true;
  layerMemoryStressDetails.hidden = true;
  layerMemoryStressResult.className = "result";
  layerMemoryStressResult.textContent =
    "Creo il test e salvo il primo checkpoint nel progetto…";
  layerMemoryStressButton.textContent = "Ricerca limite in corso…";
  setGpuMemoryPanelOpen(true);
  updateHistoryControls();
  updateHumanStrokeControls();
  let latestRun: IphoneMemoryLimitRun | null = null;

  try {
    const { runIphoneMemoryLimitTest } = await import("./iphone-memory-limit-test");
    const report = await runIphoneMemoryLimitTest(engine, {
      deviceLabel: iphoneMemoryDeviceLabel.value,
      serverRequired: iphoneMemoryLimitServerRequired,
      onProgress(progress) {
        latestRun = progress.run;
        updateIphoneMemoryLimitProgress(progress);
      },
    });
    latestRun = report;
    showIphoneMemoryLimitRun(report, true);
    layerMemoryStressResult.className = "result ok";
    layerMemoryStressResult.textContent =
      `Test completo e salvato nel progetto · ${formatMemoryMiB(report.lastSafeMiB)} sicuri`
      + ` · picco ${formatMemoryMiB(report.highestObservedPeakMiB)}`
      + " · cambi centro/sopra riusciti.";
    layerMemoryStressButton.textContent = "Test completato e salvato";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (latestRun) {
      showIphoneMemoryLimitRun(latestRun, true);
    }
    layerMemoryStressResult.className = "result error";
    layerMemoryStressResult.textContent =
      `Test interrotto · ${message}`
      + (latestRun
        ? ` · ultimo sicuro ${formatMemoryMiB(latestRun.lastSafeMiB)}; report salvato.`
        : "");
    layerMemoryStressButton.textContent = "Test interrotto — ricarica per riprovare";
  } finally {
    layerMemoryStressTestRunning = false;
    layerMemoryStressTestCompleted = true;
    historyState = engine.getHistoryState();
    syncActiveLayerControls();
    updateHistoryControls();
    updateHumanStrokeControls();
    updateStats(engine.getStats());
  }
}

async function runRequestedLayerMemoryStressTest(): Promise<void> {
  if (
    !layerMemoryStressTestRequested
    || interactionLocked()
    || layerMemoryStressTestCompleted
  ) {
    return;
  }

  layerMemoryStressTestRunning = true;
  layerMemoryStressDetails.hidden = true;
  layerMemoryStressResult.className = "result";
  layerMemoryStressResult.textContent =
    "Preparazione memoria reale dei livelli… non chiudere questa pagina.";
  layerMemoryStressButton.textContent = "Stress memoria in corso…";
  setGpuMemoryPanelOpen(true);
  updateHistoryControls();
  updateHumanStrokeControls();

  try {
    const {
      LAYER_MEMORY_STRESS_TARGET_MIB,
      runLayerMemoryStressTest,
    } = await import("./layer-memory-stress-test");
    const report = await runLayerMemoryStressTest(
      engine,
      LAYER_MEMORY_STRESS_TARGET_MIB,
      (progress) => {
        updateStats(engine.getStats());
        const action = progress.phase === "add"
          ? "Aggiungo il prossimo livello"
          : progress.phase === "seed"
            ? "Preparo il livello attivo"
            : "Preparazione completata";
        layerMemoryStressResult.textContent =
          `${action} · ${progress.layerCount} livelli · `
          + `${formatMemoryMiB(progress.countedTotalMiB)} / `
          + `${formatMemoryMiB(progress.targetMiB)} · `
          + `picco osservato ${formatMemoryMiB(progress.peakCountedTotalMiB)}`;
      },
    );
    layerMemoryStressReport.textContent = JSON.stringify(report, null, 2);
    layerMemoryStressDetails.hidden = false;
    layerMemoryStressDetails.open = true;
    (
      window as Window & { __layerMemoryStressTestReport?: typeof report }
    ).__layerMemoryStressTestReport = report;
    layerMemoryStressResult.className = "result ok";
    layerMemoryStressResult.textContent =
      `Stress pronto · ${formatMemoryMiB(report.countedTotalMiB)} su `
      + `${report.layerCount} livelli. Ora seleziona livelli in alto, in basso `
      + "e al centro: l'interfaccia è di nuovo sbloccata.";
    layerMemoryStressButton.textContent = "Stress completato — cambia i livelli";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stats = engine.getStats();
    const currentHistory = engine.getHistoryState();
    const failure = {
      version: 1,
      passed: false,
      error: message,
      layerCount: stats.layerCount,
      activeLayerIndex: stats.activeLayerIndex,
      gpuMemory: stats.gpuMemory,
      manualSwitchReady: !currentHistory.busy && !currentHistory.inconsistent,
    };
    layerMemoryStressReport.textContent = JSON.stringify(failure, null, 2);
    layerMemoryStressDetails.hidden = false;
    layerMemoryStressDetails.open = true;
    (
      window as Window & { __layerMemoryStressTestReport?: typeof failure }
    ).__layerMemoryStressTestReport = failure;
    layerMemoryStressResult.className = "result error";
    layerMemoryStressResult.textContent = `Stress memoria interrotto · ${message}`;
    layerMemoryStressButton.textContent = "Stress interrotto — ricarica per riprovare";
  } finally {
    layerMemoryStressTestRunning = false;
    layerMemoryStressTestCompleted = true;
    historyState = engine.getHistoryState();
    syncActiveLayerControls();
    updateHistoryControls();
    updateHumanStrokeControls();
    updateStats(engine.getStats());
  }
}

async function runRequestedLayerCompressionStudy(): Promise<void> {
  if (
    !layerCompressionStudyRequested
    || interactionLocked()
    || layerCompressionStudyCompleted
  ) {
    return;
  }

  layerCompressionStudyRunning = true;
  layerCompressionStudyDetails.hidden = true;
  layerCompressionStudyResult.className = "result";
  layerCompressionStudyResult.textContent =
    "Leggo e comprimo i tile a blocchi da 1 MiB senza eliminare risorse…";
  layerCompressionStudyButton.textContent = "Compressione in corso…";
  setGpuMemoryPanelOpen(true);
  updateHistoryControls();
  updateHumanStrokeControls();
  let completed = false;

  try {
    const report = await engine.measureLayerColdCompressionStudy((progress) => {
      const percent = progress.totalTiles === 0
        ? 0
        : progress.completedTiles / progress.totalTiles * 100;
      layerCompressionStudyResult.textContent =
        `Livello ${progress.layerNumber}/${progress.layerCount} · `
        + `${progress.layerName} · ${percent.toFixed(0)}% · `
        + `${formatMemoryMiB(progress.rawMiB)} raw → `
        + `${formatMemoryMiB(progress.adaptiveStoredMiB)} · `
        + `risparmio ${progress.savingsPercent.toFixed(1)}%.`;
    });
    completed = true;
    layerCompressionStudyReport.textContent = JSON.stringify(report, null, 2);
    layerCompressionStudyDetails.hidden = false;
    layerCompressionStudyDetails.open = true;
    (
      window as Window & {
        __layerCompressionStudyReport?: LayerCompressionStudyReport;
      }
    ).__layerCompressionStudyReport = report;

    let savedRunId = 0;
    let saveFailure: string | null = null;
    try {
      savedRunId = await saveLayerCompressionRun(report);
    } catch (error) {
      saveFailure = error instanceof Error ? error.message : String(error);
    }
    const syntheticWarning = report.zeroTileCount > report.tileCount * 0.5
      ? " Attenzione: oltre metà dei tile è vuota; lo stress sintetico non rappresenta un dipinto pieno."
      : "";
    const savedLabel = import.meta.env.DEV
      ? " Report locale."
      : saveFailure
        ? ` ${saveFailure}`
        : ` Report salvato nel progetto${savedRunId ? ` #${savedRunId}` : ""}.`;
    layerCompressionStudyResult.className = saveFailure ? "result error" : "result ok";
    layerCompressionStudyResult.textContent =
      `Round-trip identico · ${formatMemoryMiB(report.rawMiB)} raw → `
      + `${formatMemoryMiB(report.adaptiveStoredMiB)} · `
      + `risparmio ${report.adaptiveSavingsPercent.toFixed(1)}% · `
      + `encode ${(report.encodeMs / 1000).toFixed(2)} s · `
      + `decode ${(report.decodeMs / 1000).toFixed(2)} s.`
      + syntheticWarning
      + savedLabel;
    layerCompressionStudyButton.textContent = "Misura completata";
  } catch (error) {
    layerCompressionStudyResult.className = "result error";
    layerCompressionStudyResult.textContent =
      `Compressione non eseguita · ${
        error instanceof Error ? error.message : String(error)
      }`;
    layerCompressionStudyButton.textContent = "Riprova misura compressione";
  } finally {
    layerCompressionStudyRunning = false;
    layerCompressionStudyCompleted = completed;
    updateHistoryControls();
    updateHumanStrokeControls();
    updateStats(engine.getStats());
  }
}

async function runRequestedLayerHistoryTest(): Promise<void> {
  let timeoutId = 0;
  let timedOut = false;
  layerHistoryTestSection.hidden = false;
  layerHistoryTestDetails.hidden = true;
  layerHistoryTestResult.className = "result";
  layerHistoryTestResult.textContent = "Test GPU cronologia e compositing livelli…";
  try {
    const { runLayerHistoryGpuTest } = await import("./layer-history-gpu-test");
    // The harness awaits waitForIdle(), which needs the frame loop to be pumping.
    // Started from the init chain in a window whose frames are not being rendered
    // — a hidden or backgrounded tab — it waited forever and reported nothing,
    // which reads as "still running" instead of "broken". A test that hangs is
    // worse than one that fails, so cap it and say so.
    const report = await Promise.race([
      runLayerHistoryGpuTest(engine),
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          timedOut = true;
          reject(new Error(
            "Test livelli scaduto dopo 180 s: ricarica la pagina dev prima di continuare.",
          ));
        }, 180_000);
      }),
    ]);
    layerHistoryTestReport.textContent = JSON.stringify(report, null, 2);
    layerHistoryTestDetails.hidden = false;
    layerHistoryTestDetails.open = true;
    (
      window as Window & { __layerHistoryGpuTestReport?: typeof report }
    ).__layerHistoryGpuTestReport = report;
    layerHistoryTestResult.className = report.passed ? "result ok" : "result error";
    layerHistoryTestResult.textContent = report.passed
      ? "Livelli GPU OK · cronologia, fusione, mip e rollback verificati."
      : "Cronologia livelli GPU ERRORE · consulta il report JSON.";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failure = { version: 10, passed: false, error: message };
    layerHistoryTestReport.textContent = JSON.stringify(failure, null, 2);
    layerHistoryTestDetails.hidden = false;
    layerHistoryTestDetails.open = true;
    (
      window as Window & { __layerHistoryGpuTestReport?: typeof failure }
    ).__layerHistoryGpuTestReport = failure;
    layerHistoryTestResult.className = "result error";
    layerHistoryTestResult.textContent = `Cronologia livelli GPU ERRORE · ${message}`;
  } finally {
    if (timeoutId !== 0) {
      window.clearTimeout(timeoutId);
    }
    // Promise.race cannot cancel the underlying GPU harness. Keep this dedicated
    // page locked after a timeout so late work cannot race user input.
    layerHistoryTestRunning = timedOut;
    historyState = engine.getHistoryState();
    syncActiveLayerControls();
    updateHistoryControls();
    updateHumanStrokeControls();
    updateStats(engine.getStats());
  }
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
  void replayHumanStroke({ replayTool: "blend" });
});

runRenderingModeSuiteButton.addEventListener("click", () => {
  void runRenderingModeSuite();
});

/**
 * Perche' la Cronologia sta a quel numero. Senza console su telefono era
 * impossibile distinguere "il budget non scatta" da "non c'e' nulla da
 * liberare": il 6 agosto 2026 una schermata mostrava `191,2 MiB` di payload
 * contro un budget da `96` e non c'era modo di sapere quale dei due fosse.
 *
 * Si legge solo a pannello aperto: la telemetria sincronizza la contabilita'
 * History e non deve pesare su ogni frame quando nessuno la guarda.
 */
function updateHistoryDiagnostics(): void {
  const output = element<HTMLElement>("gpuMemoryHistoryDiagnostics");
  if (gpuMemoryPanel.hidden) return;
  const telemetry = engine.getHistoryMaintenanceTelemetry();
  const state = engine.getHistoryState();
  const depth = state.cursor - telemetry.floorCursor;
  const causa = telemetry.budgetCheckpointBlocked
    ? "BLOCCATO: nessun checkpoint full su cui consolidare"
    : telemetry.totalBytes > telemetry.budgetBytes
      ? "sopra budget, eviction in attesa di manutenzione idle"
      : "entro budget";
  output.textContent =
    `History ${formatMemoryMiB(telemetry.totalBytes / (1024 * 1024))} su budget `
    + `${formatMemoryMiB(telemetry.budgetBytes / (1024 * 1024))} `
    + `(base ${formatMemoryMiB(telemetry.baseBudgetBytes / (1024 * 1024))} − effetti `
    + `${formatMemoryMiB(telemetry.effectsWorkingSetBytes / (1024 * 1024))}) · ${causa}. `
    + `Checkpoint ${telemetry.checkpointCount} (${telemetry.fullCheckpointCount} full, `
    + `${telemetry.deltaCheckpointCount} delta) per `
    + `${formatMemoryMiB(telemetry.checkpointBytes / (1024 * 1024))}; catture `
    + `${telemetry.capturesCommitted}/${telemetry.capturesStarted} committed, `
    + `${telemetry.capturesFailed} fallite, ${telemetry.capturesDiscardedStale} stale. `
    + `Eviction ${telemetry.budgetEvictions} da budget e ${telemetry.depthEvictions} da `
    + `profondità (tetto ${telemetry.maximumUndoDepth}); pavimento `
    + `${telemetry.floorCursor}, azioni ${state.actionCount}, profondità Undo ${depth}. `
    + `Compattazioni Redo ${telemetry.redoCompactionsCompleted} complete, `
    + `${telemetry.redoCompactionsAborted} interrotte.`;
}

/**
 * Dichiarato contro reale. Il pannello e' un modello e puo' derivare: qui il
 * confronto e' automatico, cosi' una taglia di documento nuova o una risorsa
 * non contabilizzata si vedono subito invece di dover essere rimisurate.
 */
function updateGpuMemoryAudit(declaredMiB: number): void {
  const output = element<HTMLElement>("gpuMemoryAudit");
  if (gpuMemoryPanel.hidden) return;
  const misura = engine.measuredGpuMemory();
  const misuratoMiB = misura.totalBytes / (1024 * 1024);
  const scartoMiB = misuratoMiB - declaredMiB;
  const oltreTolleranza =
    Math.abs(scartoMiB) * 1024 * 1024 > GPU_MEMORY_AUDIT_TOLERANCE_BYTES;
  renderMeasuredBreakdown(misura, misuratoMiB);
  output.textContent =
    `Misurata ${formatMemoryMiB(misuratoMiB)} in ${misura.textureCount} texture e `
    + `${misura.bufferCount} buffer (${misura.createdCount} create, `
    + `${misura.destroyedCount} distrutte, ${misura.collectedCount} raccolte dal GC). `
    + `Somma esatta dei descrittori, non una stima. `
    + (misura.unmeasurableCount > 0
      ? `${misura.unmeasurableCount} risorse con formato non misurabile `
        + `(${misura.unmeasurableFormats.join(", ")}) sono ESCLUSE dal totale. `
      : "")
    + `Le righe qui sopra sono il modello dichiarato, che somma a `
    + `${formatMemoryMiB(declaredMiB)}: scarto `
    + `${scartoMiB >= 0 ? "+" : "−"}${formatMemoryMiB(Math.abs(scartoMiB))}`
    + (oltreTolleranza ? " · ATTENZIONE: il modello è disallineato." : ".");
  output.classList.toggle(
    "memory-audit-warning",
    oltreTolleranza || misura.unmeasurableCount > 0,
  );
}

/**
 * Ripartizione misurata. Le categorie **partizionano** il registro: la loro
 * somma e' il totale per costruzione, non per manutenzione. Se un giorno non lo
 * fosse piu' sarebbe un difetto del registro, non un numero da riallineare a
 * mano, quindi lo si dichiara invece di nasconderlo.
 */
function renderMeasuredBreakdown(
  misura: ReturnType<BrushEngine["measuredGpuMemory"]>,
  misuratoMiB: number,
): void {
  const lista = element<HTMLElement>("gpuMeasuredBreakdown");
  const sommaCategorie = misura.categories.reduce((totale, voce) => totale + voce.bytes, 0);
  const partizioneIntegra = sommaCategorie === misura.totalBytes;
  element<HTMLElement>("gpuMeasuredTotal").textContent = partizioneIntegra
    ? formatMemoryMiB(misuratoMiB)
    : `${formatMemoryMiB(misuratoMiB)} · partizione incoerente`;

  const righe = misura.categories.filter((voce) => voce.bytes > 0 || voce.count > 0);
  lista.replaceChildren(...righe.map((voce) => {
    const riga = document.createElement("div");
    riga.dataset.memoryRow = "";
    riga.dataset.measuredCategory = voce.category;
    const nome = document.createElement("dt");
    nome.textContent = `${voce.category} · ${voce.count} risors${voce.count === 1 ? "a" : "e"}`;
    const valore = document.createElement("dd");
    valore.textContent = formatMemoryMiB(voce.bytes / (1024 * 1024));
    riga.append(nome, valore);
    riga.classList.toggle("memory-zero", voce.bytes < 0.05 * 1024 * 1024);
    return riga;
  }));
}

function updateGpuMemoryPanel(stats: EngineStats): void {
  for (const [id, key] of gpuMemoryRows) {
    const output = element<HTMLElement>(id);
    const value = stats.gpuMemory[key];
    output.textContent = formatMemoryMiB(value);
    output.parentElement?.classList.toggle("memory-zero", value < 0.05);
  }
  const historyPageCount = stats.gpuMemory.historyGpuPageCount;
  const historyLabel = element<HTMLElement>("gpuMemoryHistoryLabel");
  historyLabel.textContent = `Cronologia raster · GPU · ${historyPageCount} `
    + `${historyPageCount === 1 ? "pagina" : "pagine"} · `
    + `usati ${formatMemoryMiB(stats.gpuMemory.historyGpuUsedMiB)}`;
  historyLabel.title =
    "La cifra a destra è la memoria GPU realmente riservata in pagine; "
    + "«usati» è il payload logico attualmente residente nelle pagine.";
  updateHistoryDiagnostics();

  const storageStudy = stats.layerStorageStudy;
  const inactiveLayers = storageStudy.layers.filter((layer) => !layer.active);
  const coldEligibleLayers = inactiveLayers.filter((layer) => !layer.reference);
  const coldTileCount = storageStudy.layers.reduce(
    (total, layer) => total + layer.coldTileCount,
    0,
  );
  const compressedLayerCount = storageStudy.layers.filter(
    (layer) => layer.compressed,
  ).length;
  const compressedRawMiB = storageStudy.layers.reduce(
    (total, layer) => total + layer.compressedRawMiB,
    0,
  );
  const inactiveBboxTileCount = coldEligibleLayers.reduce(
    (total, layer) => total + layer.alignedBboxTileCount,
    0,
  );
  const inactiveTileCapacity = coldEligibleLayers.length * storageStudy.tileCount;
  const hotLayerCount = storageStudy.layers.filter((layer) => layer.hotAllocated).length;
  const actualSavingsMiB = Math.max(
    0,
    storageStudy.eagerFullRawMiB - storageStudy.actualRawMiB,
  );
  const formatStudy = (projectedMiB: number, savingsMiB: number) =>
    `${formatMemoryMiB(projectedMiB)} · −${formatMemoryMiB(savingsMiB)}`;
  const tileOutput = element<HTMLElement>("gpuMemoryLayerStudyTiles");
  const bboxOutput = element<HTMLElement>("gpuMemoryLayerStudyBbox");
  element<HTMLElement>("gpuMemoryLayerStudyTilesLabel").textContent =
    `Raw livelli · effettivo · ${hotLayerCount} hot + `
    + `${coldTileCount}/${inactiveTileCapacity} tile cold`
    + (compressedLayerCount > 0
      ? ` + ${compressedLayerCount} compresso (${formatMemoryMiB(compressedRawMiB)} raw)`
      : "");
  element<HTMLElement>("gpuMemoryLayerStudyBboxLabel").textContent =
    `Confronto · bbox ${storageStudy.tileSizePx} · `
    + `${inactiveBboxTileCount}/${inactiveTileCapacity} livelli cold`;
  tileOutput.textContent = formatStudy(storageStudy.actualRawMiB, actualSavingsMiB);
  bboxOutput.textContent = formatStudy(
    storageStudy.projectedAlignedBboxRawMiB,
    storageStudy.alignedBboxSavingsMiB,
  );
  tileOutput.title =
    "Memoria logica WebGPU realmente allocata per texture raw hot e cold; "
    + "i livelli compressi sono RAM CPU separata ed esclusa dal totale GPU. "
    + "Il risparmio è rispetto a un full-canvas per ogni livello.";
  bboxOutput.title =
    "Confronto teorico: attivo e Riferimento full-canvas, più bbox allineato "
    + "degli altri livelli inattivi; non è memoria allocata.";

  const scratchExtents: string[] = [];
  if (stats.gpuMemory.effectsScratchStrokeExtent > 0) {
    const strokeScratchOwner =
      stats.rasterStrokeStyle.enabled && stats.rasterStrokeStyle.width > 0
        ? "Traccia"
        : "Compositore";
    scratchExtents.push(
      `${strokeScratchOwner} ${stats.gpuMemory.effectsScratchStrokeExtent}²`,
    );
  }
  if (stats.gpuMemory.effectsScratchBevelExtent > 0) {
    scratchExtents.push(`Smusso ${stats.gpuMemory.effectsScratchBevelExtent}²`);
  }
  if (stats.gpuMemory.effectsScratchOuterShadowExtent > 0) {
    scratchExtents.push(
      `Ombra esterna ${stats.gpuMemory.effectsScratchOuterShadowExtent}²`,
    );
  }
  if (stats.gpuMemory.effectsScratchInnerShadowExtent > 0) {
    scratchExtents.push(
      `Ombra interna ${stats.gpuMemory.effectsScratchInnerShadowExtent}²`,
    );
  }
  element<HTMLElement>("gpuMemoryEffectsScratchLabel").textContent = scratchExtents.length > 0
    ? `Effetti · pool scratch · ${scratchExtents.join(" / ")}`
    : "Effetti · pool scratch";

  const fieldBoundsLabel = (
    bounds: Readonly<{ x: number; y: number; width: number; height: number }>,
  ): string => `${bounds.width}×${bounds.height} @ ${bounds.x},${bounds.y}`;
  const allocation = stats.gpuMemory.rasterBevelFieldAllocationBounds;
  const valid = stats.gpuMemory.rasterBevelFieldValidBounds;
  let bevelHeightLabel =
    `Smusso · heightfield R32F · documento ${LAYER_SIZE}×${LAYER_SIZE}`;
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

  // Il numero che l'utente legge e' quello **misurato**: la somma esatta dei
  // descrittori di ogni texture e buffer vivi. Il modello dichiarato resta
  // sotto, come ripartizione semantica, ma non e' piu' la fonte del totale:
  // era il punto in cui la stima poteva mentire senza che si vedesse.
  const declaredMiB = stats.gpuMemory.countedTotalMiB;
  const totalMiB = engineInitialized
    ? engine.measuredGpuMemory().totalBytes / (1024 * 1024)
    : declaredMiB;
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
  updateGpuMemoryAudit(declaredMiB);
  previousGpuMemoryTotalMiB = totalMiB;
}

/**
 * After a switch all non-destructive effect controls must be re-read from the
 * engine, because the styles belong to the layer record now. Leaving them alone
 * would show the outgoing layer's settings while painting on the incoming one.
 */
function syncActiveLayerControls(): void {
  syncRasterColorOverlayControls(engine.getRasterColorOverlayStyle());
  syncRasterStrokeControls(engine.getRasterStrokeStyle());
  mobileStrokeSheet?.sync(engine.getRasterStrokeStyle());
  syncRasterOuterShadowControls(engine.getRasterOuterShadowStyle());
  syncRasterInnerShadowControls(engine.getRasterInnerShadowStyle());
  syncRasterBevelControls(engine.getRasterBevelStyle());
  mobileRasterEffectsSheet?.syncOpenStyle();
  mobileToolSettingsSheet?.syncOpenState();
  updateRasterColorOverlayControlAvailability();
  updateRasterStrokeControlAvailability();
  updateRasterOuterShadowControlAvailability();
  updateRasterInnerShadowControlAvailability();
  updateRasterBevelControlAvailability();
}

async function showLayerLoading(message: string): Promise<void> {
  layerLoadingLabel.textContent = message;
  layerLoadingOverlay.hidden = false;
  appElement.setAttribute("aria-busy", "true");
  // The second callback starts only after the browser had a chance to paint
  // the overlay. One requestAnimationFrame alone resumes before that paint.
  await nextAnimationFrame();
  await nextAnimationFrame();
}

function hideLayerLoading(): void {
  layerLoadingOverlay.hidden = true;
  appElement.removeAttribute("aria-busy");
}

function createLayerRow(): HTMLDivElement {
  const row = document.createElement("div");
  const visibility = document.createElement("button");
  visibility.type = "button";
  visibility.className = "layer-visibility";
  const reference = document.createElement("button");
  reference.type = "button";
  reference.className = "layer-reference";
  reference.textContent = "R";
  const clipping = document.createElement("button");
  clipping.type = "button";
  clipping.className = "layer-clipping";
  clipping.textContent = "M";
  const select = document.createElement("button");
  select.type = "button";
  select.className = "layer-select";
  const name = document.createElement("span");
  name.className = "layer-name";
  const hint = document.createElement("span");
  hint.className = "layer-hint";
  // updateStats runs every 500 ms. Keep the descendants under the pointer
  // attached so a refresh between pointerdown and pointerup cannot cancel click.
  select.append(name, hint);
  const blendMode = document.createElement("select");
  blendMode.className = "layer-blend-mode";
  blendMode.title = "Modalità fusione raster · compositing live WebGPU";
  for (const category of LAYER_BLEND_MODE_CATEGORIES) {
    const group = document.createElement("optgroup");
    group.label = category.label;
    for (const mode of category.modes) {
      const option = document.createElement("option");
      option.value = mode;
      option.textContent = LAYER_BLEND_MODE_LABELS[mode];
      group.append(option);
    }
    blendMode.append(group);
  }
  const opacity = document.createElement("label");
  opacity.className = "layer-opacity";
  const range = document.createElement("input");
  range.type = "range";
  range.min = "0";
  range.max = "100";
  range.step = "1";
  const output = document.createElement("output");
  opacity.append(range, output);
  row.append(visibility, reference, clipping, select, blendMode, opacity);
  return row;
}

type MobileLayerKind = "raster" | "text" | "svg" | "image";

interface MobileLayerView {
  readonly key: string;
  readonly kind: MobileLayerKind;
  readonly name: string;
  readonly visible: boolean;
  readonly selected: boolean;
  readonly rasterIndex: number | null;
  readonly rasterLayerId: number | null;
  readonly reference: boolean;
  readonly referenceAvailable: boolean;
  readonly hasContent: boolean;
  readonly contentBounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  } | null;
  readonly thumbnailGlyph: string;
  readonly thumbnailColor: string | null;
  readonly semanticThumbnail: MobileSemanticLayerThumbnailSource | null;
  readonly semanticThumbnailSignature: string;
}

function mobileLayerDisplayName(name: string): string {
  return name
    .replace(/^Livello (?=\d+$)/, "Layer ")
    .replace(/^Maschera ritaglio (?=\d+$)/, "Clipping Mask ")
    .replace(/^Testo (?=\d+$)/, "Text ")
    .replace(/^Immagine (?=\d+$)/, "Image ")
    .replace(/^Immagine raster$/, "Raster Image");
}

function createMobileLucideIconStack(icon: IconNode): HTMLSpanElement {
  const stack = document.createElement("span");
  stack.className = "mobile-icon-stack";
  stack.setAttribute("aria-hidden", "true");
  stack.append(
    createLucideElement(icon, {
      class: "mobile-icon-layer mobile-icon-outline",
      width: 20,
      height: 20,
    }),
    createLucideElement(icon, {
      class: "mobile-icon-layer mobile-icon-face",
      width: 20,
      height: 20,
    }),
  );
  return stack;
}

function createMobileLayerRow(key: string): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "mobile-layer-row";
  row.setAttribute("role", "listitem");
  row.dataset.layerKey = key;

  const select = document.createElement("button");
  select.type = "button";
  select.className = "mobile-layer-select";
  select.dataset.mobileLayerAction = "select";

  const thumbnail = document.createElement("span");
  thumbnail.className = "mobile-layer-thumbnail";
  thumbnail.setAttribute("aria-hidden", "true");
  const thumbnailCanvas = document.createElement("canvas");
  thumbnailCanvas.className = "mobile-layer-thumbnail-canvas";
  thumbnailCanvas.width = LAYER_THUMBNAIL_SIZE;
  thumbnailCanvas.height = LAYER_THUMBNAIL_SIZE;
  thumbnailCanvas.hidden = true;
  const thumbnailContent = document.createElement("span");
  thumbnailContent.className = "mobile-layer-thumbnail-content";
  thumbnailContent.hidden = true;
  const thumbnailGlyph = document.createElement("span");
  thumbnailGlyph.className = "mobile-layer-thumbnail-glyph";
  thumbnail.append(thumbnailCanvas, thumbnailContent, thumbnailGlyph);

  const name = document.createElement("span");
  name.className = "mobile-layer-name";
  select.append(thumbnail, name);

  const reference = document.createElement("button");
  reference.type = "button";
  reference.className = "mobile-layer-reference";
  reference.dataset.mobileLayerAction = "reference";
  reference.textContent = "R";

  const visibility = document.createElement("button");
  visibility.type = "button";
  visibility.className = "mobile-layer-visibility";
  visibility.dataset.mobileLayerAction = "visibility";

  row.append(select, reference, visibility);
  return row;
}

function mobileLayerViews(stats: EngineStats): MobileLayerView[] {
  const scene = stats.mixedScene;
  const views: MobileLayerView[] = [];
  if (!scene) {
    for (let index = stats.layers.length - 1; index >= 0; index -= 1) {
      const layer = stats.layers[index];
      views.push({
        key: `raster:${layer.id}`,
        kind: "raster",
        name: mobileLayerDisplayName(layer.name),
        visible: layer.visible,
        selected: index === stats.activeLayerIndex,
        rasterIndex: index,
        rasterLayerId: layer.id,
        reference: layer.reference,
        referenceAvailable: index === stats.activeLayerIndex,
        hasContent: layer.hasContent,
        contentBounds: null,
        thumbnailGlyph: "",
        thumbnailColor: null,
        semanticThumbnail: null,
        semanticThumbnailSignature: "",
      });
    }
    return views;
  }

  for (let sceneIndex = scene.items.length - 1; sceneIndex >= 0; sceneIndex -= 1) {
    const item = scene.items[sceneIndex];
    const selected = item.key === scene.selectedKey;
    if (item.kind === "raster") {
      const layer = stats.layers[item.rasterLayerIndex];
      if (!layer) continue;
      views.push({
        key: item.key,
        kind: "raster",
        name: mobileLayerDisplayName(layer.name),
        visible: layer.visible,
        selected,
        rasterIndex: item.rasterLayerIndex,
        rasterLayerId: item.rasterLayerId,
        reference: layer.reference,
        referenceAvailable: selected && item.rasterLayerId === scene.activeRasterLayerId,
        hasContent: item.rasterHasContent,
        contentBounds: item.rasterContentBounds,
        thumbnailGlyph: "",
        thumbnailColor: null,
        semanticThumbnail: null,
        semanticThumbnailSignature: "",
      });
      continue;
    }
    if (item.kind === "text") {
      const node = item.textNode;
      const firstCharacter = Array.from(node.text.trim())[0] ?? "T";
      const semanticThumbnail = {
        kind: "text",
        node,
      } as const satisfies MobileSemanticLayerThumbnailSource;
      views.push({
        key: item.key,
        kind: "text",
        name: mobileLayerDisplayName(node.name),
        visible: node.visible,
        selected,
        rasterIndex: null,
        rasterLayerId: null,
        reference: false,
        referenceAvailable: false,
        hasContent: node.text.trim().length > 0,
        contentBounds: null,
        thumbnailGlyph: firstCharacter.toLocaleUpperCase("en-US"),
        thumbnailColor: node.color,
        semanticThumbnail,
        semanticThumbnailSignature: mobileSemanticLayerThumbnailSignature(
          semanticThumbnail,
        ),
      });
      continue;
    }
    if (item.kind === "svg") {
      const node = item.svgNode;
      const semanticThumbnail = {
        kind: "svg",
        node,
      } as const satisfies MobileSemanticLayerThumbnailSource;
      views.push({
        key: item.key,
        kind: "svg",
        name: mobileLayerDisplayName(node.name),
        visible: node.visible,
        selected,
        rasterIndex: null,
        rasterLayerId: null,
        reference: false,
        referenceAvailable: false,
        hasContent: true,
        contentBounds: null,
        thumbnailGlyph: "S",
        thumbnailColor: node.paintColors[0] ?? node.outlineColor,
        semanticThumbnail,
        semanticThumbnailSignature: mobileSemanticLayerThumbnailSignature(
          semanticThumbnail,
        ),
      });
      continue;
    }
    const node = item.imageNode;
    views.push({
      key: item.key,
      kind: "image",
      name: mobileLayerDisplayName(node.name),
      visible: node.visible,
      selected,
      rasterIndex: null,
      rasterLayerId: null,
      reference: false,
      referenceAvailable: false,
      hasContent: true,
      contentBounds: null,
      thumbnailGlyph: "I",
      thumbnailColor: null,
      semanticThumbnail: null,
      semanticThumbnailSignature: "",
    });
  }
  return views;
}

function mobileLayerListSignature(
  views: readonly MobileLayerView[],
  locked: boolean,
): string {
  return `${locked ? 1 : 0}|${views.map((view) => {
    const bounds = view.contentBounds;
    return [
      view.key,
      view.kind,
      view.name,
      view.visible ? 1 : 0,
      view.selected ? 1 : 0,
      view.reference ? 1 : 0,
      view.referenceAvailable ? 1 : 0,
      view.hasContent ? 1 : 0,
      view.rasterLayerId === null
        ? ""
        : mobileRasterThumbnailCache.get(view.rasterLayerId)?.revision ?? 0,
      bounds?.x ?? "",
      bounds?.y ?? "",
      bounds?.width ?? "",
      bounds?.height ?? "",
      view.thumbnailGlyph,
      view.thumbnailColor ?? "",
      view.semanticThumbnailSignature,
      view.kind === "text" ? mobileSemanticThumbnailFontRevision : "",
    ].join(":");
  }).join("|")}`;
}

function updateMobileLayerThumbnail(
  thumbnail: HTMLSpanElement,
  view: MobileLayerView,
): void {
  const bounds = view.contentBounds;
  const cached = view.rasterLayerId === null
    ? null
    : mobileRasterThumbnailCache.get(view.rasterLayerId) ?? null;
  const signature = [
    view.kind,
    view.hasContent ? 1 : 0,
    bounds?.x ?? "",
    bounds?.y ?? "",
    bounds?.width ?? "",
    bounds?.height ?? "",
    view.thumbnailGlyph,
    view.thumbnailColor ?? "",
    view.semanticThumbnailSignature,
    view.kind === "text" ? mobileSemanticThumbnailFontRevision : "",
    cached?.revision ?? 0,
  ].join(":");
  if (thumbnail.dataset.thumbnailSignature === signature) return;
  thumbnail.dataset.thumbnailSignature = signature;
  thumbnail.dataset.kind = view.kind;

  const content = thumbnail.querySelector<HTMLSpanElement>(
    ".mobile-layer-thumbnail-content",
  )!;
  const canvas = thumbnail.querySelector<HTMLCanvasElement>(
    ".mobile-layer-thumbnail-canvas",
  )!;
  const glyph = thumbnail.querySelector<HTMLSpanElement>(
    ".mobile-layer-thumbnail-glyph",
  )!;
  glyph.textContent = view.thumbnailGlyph;
  if (view.thumbnailColor) {
    thumbnail.style.setProperty("--mobile-layer-thumbnail-color", view.thumbnailColor);
  } else {
    thumbnail.style.removeProperty("--mobile-layer-thumbnail-color");
  }

  let canvasRendered = false;
  const context = canvas.getContext("2d", { alpha: true });
  if (cached) {
    if (context) {
      context.putImageData(cached.imageData, 0, 0);
      canvasRendered = true;
    }
  } else if (view.semanticThumbnail && context) {
    if (view.semanticThumbnail.kind === "text") {
      requestMobileTextThumbnailFont(
        view.semanticThumbnail.node.fontFamily,
        () => {
          mobileSemanticThumbnailFontRevision += 1;
          mobileLayersRenderSignature = "";
          scheduleMobileLayersRefresh();
        },
      );
    }
    canvasRendered = renderMobileSemanticLayerThumbnail(
      context,
      view.semanticThumbnail,
    );
  }
  canvas.hidden = !canvasRendered;
  glyph.hidden = canvasRendered;

  content.hidden = canvasRendered || view.kind !== "raster" || !view.hasContent;
  if (content.hidden) return;
  if (!bounds) {
    content.style.left = "26%";
    content.style.top = "32%";
    content.style.width = "48%";
    content.style.height = "36%";
    return;
  }
  const left = Math.max(0, Math.min(1, bounds.x / LAYER_SIZE));
  const top = Math.max(0, Math.min(1, bounds.y / LAYER_SIZE));
  const right = Math.max(left, Math.min(1, (bounds.x + bounds.width) / LAYER_SIZE));
  const bottom = Math.max(top, Math.min(1, (bounds.y + bounds.height) / LAYER_SIZE));
  content.style.left = `${(left * 100).toFixed(2)}%`;
  content.style.top = `${(top * 100).toFixed(2)}%`;
  content.style.width = `${((right - left) * 100).toFixed(2)}%`;
  content.style.height = `${((bottom - top) * 100).toFixed(2)}%`;
}

function renderMobileLayerList(stats: EngineStats): void {
  if (!mobileLayersPanelOpen || !mobileLayersRefreshRequested) return;
  if (
    mobileLayerReorderGesture !== null
    || activePointerId !== null
    || layerSwitching
    || historyState.openEdit !== null
    || historyState.busy
  ) {
    return;
  }
  const liveRasterIds = new Set(stats.layers.map((layer) => layer.id));
  for (const cachedLayerId of mobileRasterThumbnailCache.keys()) {
    if (!liveRasterIds.has(cachedLayerId)) {
      mobileRasterThumbnailCache.delete(cachedLayerId);
    }
  }
  const locked = interactionLocked() || layerSwitching;
  const views = mobileLayerViews(stats);
  const signature = mobileLayerListSignature(views, locked);
  if (signature === mobileLayersRenderSignature) {
    mobileLayersRefreshRequested = false;
    return;
  }

  const rowsMatch = mobileLayerList.childElementCount === views.length
    && views.every(
      (view, position) =>
        (mobileLayerList.children[position] as HTMLElement | undefined)?.dataset.layerKey
          === view.key,
    );
  if (!rowsMatch) {
    mobileLayerList.replaceChildren(...views.map((view) => createMobileLayerRow(view.key)));
  }

  views.forEach((view, position) => {
    const row = mobileLayerList.children[position] as HTMLDivElement;
    const select = row.querySelector<HTMLButtonElement>(".mobile-layer-select")!;
    const thumbnail = row.querySelector<HTMLSpanElement>(".mobile-layer-thumbnail")!;
    const name = row.querySelector<HTMLSpanElement>(".mobile-layer-name")!;
    const reference = row.querySelector<HTMLButtonElement>(".mobile-layer-reference")!;
    const visibility = row.querySelector<HTMLButtonElement>(".mobile-layer-visibility")!;

    row.className = `mobile-layer-row is-${view.kind}${view.selected ? " is-selected" : ""}`;
    row.setAttribute("aria-posinset", String(position + 1));
    row.setAttribute("aria-setsize", String(views.length));
    select.disabled = locked;
    select.setAttribute("aria-current", String(view.selected));
    select.setAttribute(
      "aria-label",
      view.selected
        ? `${view.name}. Hold for layer options, then drag to reorder; `
          + "Alt plus Arrow Up or Down also moves it."
        : `Select ${view.name}`,
    );
    if (view.selected) {
      select.setAttribute("aria-keyshortcuts", "Alt+ArrowUp Alt+ArrowDown");
    } else {
      select.removeAttribute("aria-keyshortcuts");
    }
    select.title = view.name;
    name.textContent = view.name;
    updateMobileLayerThumbnail(thumbnail, view);

    reference.hidden = view.kind !== "raster";
    reference.disabled = locked || !view.referenceAvailable;
    reference.setAttribute("aria-pressed", String(view.reference));
    reference.setAttribute(
      "aria-label",
      `${view.reference ? "Disable" : "Set"} Reference for ${view.name}`,
    );
    reference.title = view.reference ? "Reference on" : "Set as Reference";

    visibility.disabled = locked;
    visibility.setAttribute("aria-pressed", String(view.visible));
    visibility.setAttribute(
      "aria-label",
      `${view.visible ? "Hide" : "Show"} ${view.name}`,
    );
    visibility.title = view.visible ? "Hide layer" : "Show layer";
    visibility.replaceChildren(createMobileLucideIconStack(view.visible ? Eye : EyeOff));
  });

  const selectedView = views.find((view) => view.selected);
  mobileAddLayerButton.disabled = locked || stats.layers.length >= 16;
  mobileCopyLayerButton.disabled = true;
  mobileAddMaskButton.disabled = locked
    || stats.layers.length >= 16
    || selectedView?.kind !== "raster"
    || !selectedView.referenceAvailable;
  mobileLayersRenderSignature = signature;
  mobileLayersRefreshRequested = false;
}

function runMobileLayerAction(action: string, key: string): void {
  if (interactionLocked() || layerSwitching) return;
  const stats = engine.getStats();
  const scene = stats.mixedScene;
  if (!scene) {
    const index = stats.layers.findIndex((layer) => `raster:${layer.id}` === key);
    const layer = stats.layers[index];
    if (index < 0 || !layer) return;
    if (action === "select") void selectLayer(index);
    if (action === "visibility") void changeLayerVisibility(index, !layer.visible);
    if (action === "reference") void changeLayerReference(index, !layer.reference);
    return;
  }

  const item = scene.items.find((candidate) => candidate.key === key);
  if (!item) return;
  if (action === "select") {
    void selectMixedSceneItem(item.key);
    return;
  }
  if (item.kind === "raster") {
    const layer = stats.layers[item.rasterLayerIndex];
    if (!layer) return;
    if (action === "visibility") {
      void changeLayerVisibility(item.rasterLayerIndex, !layer.visible);
    } else if (action === "reference") {
      void changeLayerReference(item.rasterLayerIndex, !layer.reference);
    }
    return;
  }
  if (action !== "visibility") return;
  if (item.kind === "text") {
    void changeVectorTextVisibility(item.textNode.id, !item.textNode.visible);
  } else if (item.kind === "svg") {
    void changeVectorSvgVisibility(item.svgNode.id, !item.svgNode.visible);
  } else {
    void changeRasterImageVisibility(item.imageNode.id, !item.imageNode.visible);
  }
}

async function runRequestedClippingGroupTest(): Promise<void> {
  layerHistoryTestSection.hidden = false;
  layerHistoryTestDetails.hidden = true;
  layerHistoryTestResult.className = "result";
  layerHistoryTestResult.textContent = "Test GPU gruppo di ritaglio live…";
  try {
    const { runClippingGroupGpuTest } = await import("./clipping-group-gpu-test");
    const report = await runClippingGroupGpuTest(engine);
    layerHistoryTestReport.textContent = JSON.stringify(report, null, 2);
    layerHistoryTestDetails.hidden = false;
    layerHistoryTestDetails.open = true;
    (
      window as Window & { __clippingGroupGpuTestReport?: typeof report }
    ).__clippingGroupGpuTestReport = report;
    layerHistoryTestResult.className = report.passed ? "result ok" : "result error";
    layerHistoryTestResult.textContent = report.passed
      ? "Gruppo ritaglio GPU OK · alpha morbido e parent live verificati."
      : "Gruppo ritaglio GPU ERRORE · consulta il report JSON.";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failure = { version: 1, passed: false, error: message };
    layerHistoryTestReport.textContent = JSON.stringify(failure, null, 2);
    layerHistoryTestDetails.hidden = false;
    layerHistoryTestDetails.open = true;
    layerHistoryTestResult.className = "result error";
    layerHistoryTestResult.textContent = `Gruppo ritaglio GPU ERRORE · ${message}`;
  } finally {
    layerHistoryTestRunning = false;
    historyState = engine.getHistoryState();
    syncActiveLayerControls();
    updateHistoryControls();
    updateHumanStrokeControls();
    updateStats(engine.getStats());
  }
}

async function runPixelSelectionOperation(
  operation: () => Promise<unknown>,
): Promise<void> {
  if (!engineInitialized || selectionUiBusy) return;
  selectionUiBusy = true;
  updateHistoryControls();
  updateHumanStrokeControls();
  try {
    await operation();
  } catch (error) {
    console.error("Selezione pixel WebGPU non riuscita", error);
  } finally {
    selectionUiBusy = false;
    updatePixelSelectionResult(engine.getPixelSelectionState());
    updateHistoryControls();
    updateHumanStrokeControls();
  }
}

async function runRequestedLayerBlendTest(): Promise<void> {
  let timeoutId = 0;
  let timedOut = false;
  layerHistoryTestSection.hidden = false;
  layerHistoryTestDetails.hidden = true;
  layerHistoryTestResult.className = "result";
  layerHistoryTestResult.textContent = "Test GPU modalità fusione livello…";
  try {
    const { runLayerBlendGpuTest } = await import("./layer-blend-gpu-test");
    const report = await Promise.race([
      runLayerBlendGpuTest(engine),
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          timedOut = true;
          reject(new Error(
            "Test fusioni scaduto dopo 180 s: ricarica la pagina dev prima di continuare.",
          ));
        }, 180_000);
      }),
    ]);
    layerHistoryTestReport.textContent = JSON.stringify(report, null, 2);
    layerHistoryTestDetails.hidden = false;
    layerHistoryTestDetails.open = true;
    (
      window as Window & { __layerBlendGpuTestReport?: typeof report }
    ).__layerBlendGpuTestReport = report;
    layerHistoryTestResult.className = report.passed ? "result ok" : "result error";
    layerHistoryTestResult.textContent = report.passed
      ? "Fusioni livello GPU OK · oracle, live, cronologia e clipping verificati."
      : "Fusioni livello GPU ERRORE · consulta il report JSON.";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failure = { version: 1, passed: false, error: message };
    layerHistoryTestReport.textContent = JSON.stringify(failure, null, 2);
    layerHistoryTestDetails.hidden = false;
    layerHistoryTestDetails.open = true;
    (
      window as Window & { __layerBlendGpuTestReport?: typeof failure }
    ).__layerBlendGpuTestReport = failure;
    layerHistoryTestResult.className = "result error";
    layerHistoryTestResult.textContent = `Fusioni livello GPU ERRORE · ${message}`;
  } finally {
    if (timeoutId !== 0) {
      window.clearTimeout(timeoutId);
    }
    layerHistoryTestRunning = timedOut;
    historyState = engine.getHistoryState();
    syncActiveLayerControls();
    updateHistoryControls();
    updateHumanStrokeControls();
    updateStats(engine.getStats());
  }
}

function renderMixedSceneList(
  stats: EngineStats,
  scene: NonNullable<EngineStats["mixedScene"]>,
): void {
  const locked = interactionLocked() || layerSwitching;
  addLayerButton.disabled = locked || stats.layers.length >= 16;
  const selectedItem = scene.items.find((item) => item.key === scene.selectedKey);
  const vectorSelected = selectedItem !== undefined && selectedItem.kind !== "raster";
  const ordered = [...scene.items].reverse();
  const rowsMatch = layerList.childElementCount === ordered.length
    && ordered.every(
      (item, position) =>
        (layerList.children[position] as HTMLElement | undefined)?.dataset.sceneKey
        === item.key,
    );
  if (!rowsMatch) {
    layerList.replaceChildren(...ordered.map((item) => {
      const row = createLayerRow();
      row.dataset.sceneKey = item.key;
      return row;
    }));
  }

  ordered.forEach((item, position) => {
    const row = layerList.children[position] as HTMLDivElement;
    const visibility = row.querySelector<HTMLButtonElement>(".layer-visibility")!;
    const reference = row.querySelector<HTMLButtonElement>(".layer-reference")!;
    const clipping = row.querySelector<HTMLButtonElement>(".layer-clipping")!;
    const select = row.querySelector<HTMLButtonElement>(".layer-select")!;
    const name = row.querySelector<HTMLSpanElement>(".layer-name")!;
    const hint = row.querySelector<HTMLSpanElement>(".layer-hint")!;
    const blendMode = row.querySelector<HTMLSelectElement>(".layer-blend-mode")!;
    const range = row.querySelector<HTMLInputElement>("input[type=range]")!;
    const output = row.querySelector<HTMLOutputElement>("output")!;
    const selected = item.key === scene.selectedKey;

    row.className = `layer-row ${item.kind === "raster"
      ? item.rasterClippingParentId === null
        ? "is-raster-node"
        : "is-raster-node is-clipping-mask"
      : item.kind === "image"
        ? "is-image-node"
        : "is-text-node"}`;
    reference.hidden = item.kind !== "raster";
    reference.onclick = null;
    clipping.hidden = item.kind !== "raster";
    clipping.onclick = null;
    blendMode.hidden = item.kind !== "raster";
    blendMode.oninput = null;
    select.disabled = locked;
    select.setAttribute("aria-current", String(selected));

    if (item.kind === "raster") {
      const layer = stats.layers[item.rasterLayerIndex];
      if (!layer) {
        throw new Error(`Raster ${item.rasterLayerId} senza statistiche.`);
      }
      visibility.disabled = locked;
      visibility.textContent = layer.visible ? "●" : "○";
      visibility.setAttribute("aria-pressed", String(layer.visible));
      visibility.setAttribute(
        "aria-label",
        `${layer.visible ? "Nascondi" : "Mostra"} ${layer.name}`,
      );
      visibility.onclick = () => {
        void changeLayerVisibility(item.rasterLayerIndex, !layer.visible);
      };

      name.textContent = layer.name;
      const isActiveRaster = layer.id === scene.activeRasterLayerId;
      const clippingEnabled = item.rasterClippingParentId !== null;
      const sceneIndex = scene.items.findIndex((candidate) => candidate.key === item.key);
      const hasAdjacentRasterBelow = sceneIndex > 0
        && scene.items[sceneIndex - 1]?.kind === "raster";
      const clippingHint = item.rasterClippingParentId === null
        ? ""
        : `↳ ritaglio su Livello ${item.rasterClippingParentId} · `;
      clipping.disabled = locked || (!clippingEnabled && !hasAdjacentRasterBelow);
      clipping.setAttribute("aria-pressed", String(clippingEnabled));
      clipping.setAttribute(
        "aria-label",
        `${clippingEnabled ? "Disattiva" : "Attiva"} maschera per ${layer.name}`,
      );
      clipping.title = clippingEnabled
        ? "Scollega questo raster dalla base. Le eventuali maschere sopra resteranno "
          + "collegate a questo livello, che diventerà la loro nuova base."
        : hasAdjacentRasterBelow
          ? "Ritaglia questo raster sul livello raster immediatamente sotto. Più M "
            + "consecutive condividono automaticamente la stessa base."
          : "Serve un livello raster immediatamente sotto; un vettore non può fare da base.";
      clipping.onclick = () => {
        void changeLayerClipping(item.rasterLayerIndex, !clippingEnabled);
      };
      reference.disabled = locked || !selected || !isActiveRaster;
      reference.setAttribute("aria-pressed", String(layer.reference));
      reference.setAttribute(
        "aria-label",
        `${layer.reference ? "Disattiva" : "Imposta"} Riferimento per ${layer.name}`,
      );
      reference.title = layer.reference
        ? "Riferimento attivo: il Riempimento legge i confini da questo raster."
        : isActiveRaster && selected
          ? "Usa questo raster come sorgente full-residente del Riempimento."
          : "Seleziona prima il raster per impostarlo come Riferimento.";
      reference.onclick = () => {
        void changeLayerReference(item.rasterLayerIndex, !layer.reference);
      };
      const compressionProgress = stats.layerColdCompressionProgress?.layerId === layer.id
        ? stats.layerColdCompressionProgress
        : null;
      const residencyHint = isActiveRaster
        ? vectorSelected
          ? `raster di lavoro · ${formatMemoryMiB(layer.actualRawMiB)}`
          : `raster attivo · ${formatMemoryMiB(layer.actualRawMiB)}`
        : layer.reference && layer.hotAllocated
          ? `raster full-residente · ${formatMemoryMiB(layer.actualRawMiB)}`
        : compressionProgress
          ? `raster · compressione ${compressionProgress.completedTileCount}/`
            + `${compressionProgress.totalTileCount}`
          : layer.compressed
            ? `raster compresso · ${formatMemoryMiB(layer.compressedCpuMiB)} RAM`
            : layer.hasContent
              ? `raster cold · ${layer.coldTileCount} tile · `
                + formatMemoryMiB(layer.actualRawMiB)
              : "raster cold · 0 MiB";
      hint.textContent =
        `${clippingHint}${layer.reference ? "riferimento · " : ""}${residencyHint}`;
      select.title = isActiveRaster
        ? vectorSelected
          ? "Raster di lavoro: resta full-canvas per mostrare i pixel e riprendere "
            + "il pennello senza reidratazione; la selezione resta sul testo."
          : "Livello raster attivo: il pennello scrive soltanto qui."
        : layer.reference && layer.hotAllocated
          ? "Raster Riferimento full-residente: il Riempimento legge qui i confini "
            + "senza reidratazione o copie."
        : "Livello raster separato: selezionalo per attivare il pennello.";
      select.onclick = () => {
        void selectMixedSceneItem(item.key);
      };

      blendMode.disabled = locked;
      blendMode.value = layer.blendMode;
      blendMode.setAttribute("aria-label", `Fusione ${layer.name}`);
      blendMode.title = layer.blendMode === "shade"
        ? "Shade: formula provvisoria in attesa di calibrazione Procreate."
        : `Fusione ${LAYER_BLEND_MODE_LABELS[layer.blendMode]} · live WebGPU`;
      blendMode.oninput = () => {
        void changeLayerBlendMode(
          item.rasterLayerIndex,
          blendMode.value as LayerBlendMode,
        );
      };

      range.disabled = locked;
      range.value = String(Math.round(layer.opacity * 100));
      range.setAttribute("aria-label", `Opacità ${layer.name}`);
      output.value = `${range.value}%`;
      range.oninput = () => { output.value = `${range.value}%`; };
      range.onchange = () => {
        void changeLayerOpacity(item.rasterLayerIndex, Number(range.value) / 100);
      };
    } else if (item.kind === "text") {
      const node = item.textNode;
      visibility.disabled = locked;
      visibility.textContent = node.visible ? "◆" : "◇";
      visibility.setAttribute("aria-pressed", String(node.visible));
      visibility.setAttribute(
        "aria-label",
        `${node.visible ? "Nascondi" : "Mostra"} ${node.name}`,
      );
      visibility.onclick = () => {
        void changeVectorTextVisibility(node.id, !node.visible);
      };

      name.textContent = node.name;
      const outlineHint = node.outlineWidth > 0
        ? ` · traccia ${Math.round(node.outlineWidth)} px`
        : "";
      const blockShadowHint = node.blockShadowEnabled
        ? ` · Block Shadow ${Math.round(node.blockShadowOffset)}`
        : "";
      const singleShadowHint = node.singleShadowEnabled
        ? ` · Ombra singola ${Math.round(node.singleShadowOffset)} / blur `
          + `${Math.round(node.singleShadowBlur)}`
        : "";
      const innerShadowHint = node.innerShadowEnabled
        ? ` · Ombra interna ${Math.round(node.innerShadowOffset)} / blur `
          + `${Math.round(node.innerShadowBlur)}`
        : "";
      hint.textContent =
        `testo vettoriale · ${Math.round(node.fontSize)} px · oggetto separato`
        + `${outlineHint}${blockShadowHint}${singleShadowHint}${innerShadowHint}`;
      select.title =
        "Nodo testo semantico: selezionandolo il pennello non può modificare i suoi pixel.";
      select.onclick = () => {
        void selectMixedSceneItem(item.key);
      };

      range.disabled = locked;
      range.value = String(Math.round(node.opacity * 100));
      range.setAttribute("aria-label", `Opacità ${node.name}`);
      output.value = `${range.value}%`;
      range.oninput = () => { output.value = `${range.value}%`; };
      range.onchange = () => {
        void changeVectorTextOpacity(node.id, Number(range.value) / 100);
      };
    } else if (item.kind === "svg") {
      const node = item.svgNode;
      visibility.disabled = locked;
      visibility.textContent = node.visible ? "◆" : "◇";
      visibility.setAttribute("aria-pressed", String(node.visible));
      visibility.setAttribute(
        "aria-label",
        `${node.visible ? "Nascondi" : "Mostra"} ${node.name}`,
      );
      visibility.onclick = () => {
        void changeVectorSvgVisibility(node.id, !node.visible);
      };

      name.textContent = node.name;
      const sourceMiB = node.document.sourceBytes / (1024 * 1024);
      const outlineHint = node.outlineWidth > 0
        ? ` · traccia ${Math.round(node.outlineWidth)} px`
        : "";
      const blockShadowHint = node.blockShadowEnabled
        ? ` · Block Shadow ${Math.round(node.blockShadowOffset)}`
        : "";
      const singleShadowHint = node.singleShadowEnabled
        ? ` · ombra ${Math.round(node.singleShadowBlur)}`
        : "";
      const innerShadowHint = node.innerShadowEnabled
        ? ` · ombra interna ${Math.round(node.innerShadowBlur)}`
        : "";
      hint.textContent = `SVG vettoriale · ${node.document.paints.length} colori · `
        + `${sourceMiB.toFixed(3)} MiB sorgente`
        + `${outlineHint}${blockShadowHint}${singleShadowHint}${innerShadowHint}`;
      select.title = "Nodo SVG semantico GPU: colori ed effetti restano modificabili.";
      select.onclick = () => {
        void selectMixedSceneItem(item.key);
      };

      range.disabled = locked;
      range.value = String(Math.round(node.opacity * 100));
      range.setAttribute("aria-label", `Opacità ${node.name}`);
      output.value = `${range.value}%`;
      range.oninput = () => { output.value = `${range.value}%`; };
      range.onchange = () => {
        void changeVectorSvgOpacity(node.id, Number(range.value) / 100);
      };
    } else {
      const node = item.imageNode;
      visibility.disabled = locked;
      visibility.textContent = node.visible ? "▣" : "□";
      visibility.setAttribute("aria-pressed", String(node.visible));
      visibility.setAttribute(
        "aria-label",
        `${node.visible ? "Nascondi" : "Mostra"} ${node.name}`,
      );
      visibility.onclick = () => {
        void changeRasterImageVisibility(node.id, !node.visible);
      };

      name.textContent = node.name;
      const sourceMiB = node.document.sourceBytes / (1024 * 1024);
      hint.textContent = `immagine · ${node.document.width}×${node.document.height} px · `
        + `${sourceMiB.toFixed(2)} MiB · mipmap WebGPU`;
      select.title =
        "Immagine non distruttiva: seleziona Trasforma, poi Applica o Annulla.";
      select.onclick = () => {
        void selectMixedSceneItem(item.key);
      };

      range.disabled = locked;
      range.value = String(Math.round(node.opacity * 100));
      range.setAttribute("aria-label", `Opacità ${node.name}`);
      output.value = `${range.value}%`;
      range.oninput = () => { output.value = `${range.value}%`; };
      range.onchange = () => {
        void changeRasterImageOpacity(node.id, Number(range.value) / 100);
      };
    }
  });
}

async function changeVectorTextVisibility(id: number, visible: boolean): Promise<void> {
  if (layerSwitching || interactionLocked()) {
    return;
  }
  layerSwitching = true;
  updateHistoryControls();
  try {
    await engine.setVectorTextNodeVisibility(id, visible);
    layerSwitchResult.textContent = visible ? "Testo mostrato." : "Testo nascosto.";
  } catch (error) {
    layerSwitchResult.textContent = error instanceof Error
      ? error.message
      : "Visibilità del testo non aggiornata.";
  } finally {
    layerSwitching = false;
    updateHistoryControls();
    updateStats(engine.getStats());
    mobileToolSettingsSheet?.syncOpenState();
  }
}

async function changeVectorTextOpacity(id: number, opacity: number): Promise<void> {
  if (layerSwitching || interactionLocked()) {
    return;
  }
  layerSwitching = true;
  updateHistoryControls();
  try {
    await engine.setVectorTextNodeOpacity(id, opacity);
    layerSwitchResult.textContent = `Opacità testo ${Math.round(opacity * 100)}%.`;
  } catch (error) {
    layerSwitchResult.textContent = error instanceof Error
      ? error.message
      : "Opacità del testo non aggiornata.";
  } finally {
    layerSwitching = false;
    updateHistoryControls();
    updateStats(engine.getStats());
    mobileToolSettingsSheet?.syncOpenState();
  }
}

async function changeVectorSvgVisibility(id: number, visible: boolean): Promise<void> {
  if (layerSwitching || interactionLocked()) return;
  layerSwitching = true;
  updateHistoryControls();
  try {
    await engine.setVectorSvgNodeVisibility(id, visible);
    layerSwitchResult.textContent = visible ? "SVG mostrato." : "SVG nascosto.";
  } catch (error) {
    layerSwitchResult.textContent = error instanceof Error
      ? error.message
      : "Visibilità SVG non aggiornata.";
  } finally {
    layerSwitching = false;
    updateHistoryControls();
    updateStats(engine.getStats());
    mobileToolSettingsSheet?.syncOpenState();
  }
}

async function changeVectorSvgOpacity(id: number, opacity: number): Promise<void> {
  if (layerSwitching || interactionLocked()) return;
  layerSwitching = true;
  updateHistoryControls();
  try {
    await engine.setVectorSvgNodeOpacity(id, opacity);
    layerSwitchResult.textContent = `Opacità SVG ${Math.round(opacity * 100)}%.`;
  } catch (error) {
    layerSwitchResult.textContent = error instanceof Error
      ? error.message
      : "Opacità SVG non aggiornata.";
  } finally {
    layerSwitching = false;
    updateHistoryControls();
    updateStats(engine.getStats());
    mobileToolSettingsSheet?.syncOpenState();
  }
}
function renderLayerList(stats: EngineStats): void {
  if (stats.mixedScene) {
    renderMixedSceneList(stats, stats.mixedScene);
    return;
  }
  const locked = interactionLocked() || layerSwitching;
  addLayerButton.disabled = locked || stats.layers.length >= 16;
  if (layerList.childElementCount !== stats.layers.length) {
    layerList.replaceChildren(...stats.layers.map(() => {
      const row = createLayerRow();
      row.className = "layer-row";
      return row;
    }));
  }

  // Top layer first, the way every editor shows a stack.
  const ordered = [...stats.layers].reverse();
  ordered.forEach((layer, position) => {
    const index = stats.layers.length - 1 - position;
    const row = layerList.children[position] as HTMLDivElement;
    const visibility = row.querySelector<HTMLButtonElement>(".layer-visibility")!;
    const reference = row.querySelector<HTMLButtonElement>(".layer-reference")!;
    const clipping = row.querySelector<HTMLButtonElement>(".layer-clipping")!;
    const select = row.querySelector<HTMLButtonElement>(".layer-select")!;
    const name = row.querySelector<HTMLSpanElement>(".layer-name")!;
    const hint = row.querySelector<HTMLSpanElement>(".layer-hint")!;
    const blendMode = row.querySelector<HTMLSelectElement>(".layer-blend-mode")!;
    const range = row.querySelector<HTMLInputElement>("input[type=range]")!;
    const output = row.querySelector<HTMLOutputElement>("output")!;

    row.className = `layer-row is-raster-node${
      layer.clippingParentId === null ? "" : " is-clipping-mask"
    }`;

    visibility.disabled = locked;
    visibility.textContent = layer.visible ? "●" : "○";
    visibility.setAttribute("aria-pressed", String(layer.visible));
    visibility.setAttribute(
      "aria-label",
      `${layer.visible ? "Nascondi" : "Mostra"} ${layer.name}`,
    );
    visibility.onclick = () => {
      void changeLayerVisibility(index, !layer.visible);
    };

    select.disabled = locked;
    select.setAttribute("aria-current", index === stats.activeLayerIndex ? "true" : "false");
    name.textContent = layer.name;
    const isActive = layer.id === stats.activeLayerId;
    const clippingEnabled = layer.clippingParentId !== null;
    const hasRasterBelow = index > 0;
    clipping.hidden = false;
    clipping.disabled = locked || (!clippingEnabled && !hasRasterBelow);
    clipping.setAttribute("aria-pressed", String(clippingEnabled));
    clipping.setAttribute(
      "aria-label",
      `${clippingEnabled ? "Disattiva" : "Attiva"} maschera per ${layer.name}`,
    );
    clipping.title = clippingEnabled
      ? "Scollega questo raster dalla base. Le eventuali maschere sopra resteranno "
        + "collegate a questo livello, che diventerà la loro nuova base."
      : hasRasterBelow
        ? "Ritaglia questo raster sul livello immediatamente sotto. Più M consecutive "
          + "condividono automaticamente la stessa base."
        : "Serve un livello raster immediatamente sotto.";
    clipping.onclick = () => {
      void changeLayerClipping(index, !clippingEnabled);
    };
    reference.hidden = false;
    reference.disabled = locked || !isActive;
    reference.setAttribute("aria-pressed", String(layer.reference));
    reference.setAttribute(
      "aria-label",
      `${layer.reference ? "Disattiva" : "Imposta"} Riferimento per ${layer.name}`,
    );
    reference.title = layer.reference
      ? "Riferimento attivo: il Riempimento legge i confini da questo raster."
      : isActive
        ? "Usa questo raster come sorgente full-residente del Riempimento."
        : "Seleziona prima il raster per impostarlo come Riferimento.";
    reference.onclick = () => {
      void changeLayerReference(index, !layer.reference);
    };
    const compressionProgress = stats.layerColdCompressionProgress?.layerId === layer.id
      ? stats.layerColdCompressionProgress
      : null;
    const residencyHint = isActive
      ? `attivo · ${formatMemoryMiB(layer.actualRawMiB)} full`
      : layer.reference && layer.hotAllocated
        ? `full-residente · ${formatMemoryMiB(layer.actualRawMiB)} full`
      : layer.hotAllocated
        ? `hot di sicurezza · ${formatMemoryMiB(layer.actualRawMiB)} full`
        : compressionProgress
          ? `compressione · ${compressionProgress.completedTileCount}/`
            + `${compressionProgress.totalTileCount} tile verificati`
            + (compressionProgress.pausedByStroke ? " · pausa tratto" : "")
        : layer.compressed
          ? `compresso · raw ${formatMemoryMiB(layer.compressedRawMiB)} → `
            + `${formatMemoryMiB(layer.compressedCpuMiB)} RAM`
        : layer.hasContent
            ? `cold · ${layer.coldTileCount}/${stats.layerStorageStudy.tileCount} tile · `
              + formatMemoryMiB(layer.actualRawMiB)
            : "cold · 0 MiB";
    const clippingHint = layer.clippingParentId === null
      ? ""
      : `↳ ritaglio su Livello ${layer.clippingParentId} · `;
    hint.textContent = `${clippingHint}${layer.reference ? "riferimento · " : ""}${residencyHint}`;
    select.title = isActive
      ? `Livello attivo: texture full-canvas ${LAYER_SIZE}² pronta per disegnare senza paging.`
      : layer.reference && layer.hotAllocated
        ? `Livello Riferimento: texture full-canvas ${LAYER_SIZE}² sempre residente; il `
          + "Riempimento legge qui i confini senza reidratazione o copie."
      : layer.hotAllocated
        ? "Livello inattivo trattenuto full-canvas per preservare i pixel dopo un errore; "
          + "un nuovo switch è bloccato finché il documento non torna coerente."
        : compressionProgress
          ? "Compressione lossless in background: i chunk verificati restano in RAM e "
            + "il cold GPU rimane autorevole fino al completamento atomico."
        : layer.compressed
          ? "Livello lontano compresso senza perdita nel Web Worker; i tile GPU sono stati "
            + "liberati e saranno verificati e ripristinati prima dell'uso."
          : layer.hasContent
            ? `Livello inattivo: ${layer.coldTileCount} tile GPU realmente allocati; `
              + `bbox teorico ${layer.alignedBboxMiB.toFixed(2)} MiB.`
            : "Livello inattivo vuoto: nessuna texture raw allocata.";
    select.onclick = () => { void selectLayer(index); };

    blendMode.hidden = false;
    blendMode.disabled = locked;
    blendMode.value = layer.blendMode;
    blendMode.setAttribute("aria-label", `Fusione ${layer.name}`);
    blendMode.title = layer.blendMode === "shade"
      ? "Shade: formula provvisoria in attesa di calibrazione Procreate."
      : `Fusione ${LAYER_BLEND_MODE_LABELS[layer.blendMode]} · live WebGPU`;
    blendMode.oninput = () => {
      void changeLayerBlendMode(index, blendMode.value as LayerBlendMode);
    };

    range.disabled = locked;
    range.value = String(Math.round(layer.opacity * 100));
    range.setAttribute("aria-label", `Opacità ${layer.name}`);
    output.value = `${range.value}%`;
    range.oninput = () => { output.value = `${range.value}%`; };
    range.onchange = () => {
      void changeLayerOpacity(index, Number(range.value) / 100);
    };
  });
}

async function changeLayerVisibility(index: number, visible: boolean): Promise<void> {
  if (layerSwitching || interactionLocked()) {
    return;
  }
  layerSwitching = true;
  updateHistoryControls();
  try {
    await engine.setLayerVisibility(index, visible);
    layerSwitchResult.textContent = visible ? "Livello mostrato." : "Livello nascosto.";
  } catch (error) {
    layerSwitchResult.textContent = error instanceof Error
      ? error.message
      : "Visibilità del livello non aggiornata.";
  } finally {
    layerSwitching = false;
    updateHistoryControls();
    requestMobileLayersRefresh();
    updateStats(engine.getStats());
  }
}

async function changeLayerOpacity(index: number, opacity: number): Promise<void> {
  if (layerSwitching || interactionLocked()) {
    return;
  }
  layerSwitching = true;
  updateHistoryControls();
  try {
    await engine.setLayerOpacity(index, opacity);
    layerSwitchResult.textContent = `Opacità livello ${Math.round(opacity * 100)}%.`;
  } catch (error) {
    layerSwitchResult.textContent = error instanceof Error
      ? error.message
      : "Opacità del livello non aggiornata.";
  } finally {
    layerSwitching = false;
    updateHistoryControls();
    updateStats(engine.getStats());
    mobileToolSettingsSheet?.syncOpenState();
  }
}

async function changeLayerBlendMode(
  index: number,
  blendMode: LayerBlendMode,
): Promise<void> {
  if (layerSwitching || interactionLocked()) {
    updateStats(engine.getStats());
    return;
  }
  layerSwitching = true;
  updateHistoryControls();
  try {
    const changed = await engine.setLayerBlendMode(index, blendMode);
    layerSwitchResult.textContent = changed
      ? `Fusione livello: ${LAYER_BLEND_MODE_LABELS[blendMode]}.`
      : "Fusione livello già attiva.";
  } catch (error) {
    layerSwitchResult.textContent = error instanceof Error
      ? error.message
      : "Fusione del livello non aggiornata.";
  } finally {
    layerSwitching = false;
    historyState = engine.getHistoryState();
    updateHistoryControls();
    updateStats(engine.getStats());
    mobileToolSettingsSheet?.syncOpenState();
  }
}

async function changeLayerClipping(index: number, enabled: boolean): Promise<void> {
  if (layerSwitching || interactionLocked()) {
    return;
  }
  const before = engine.getStats().layers[index];
  layerSwitching = true;
  updateHistoryControls();
  try {
    await showLayerLoading(
      enabled ? "Collego la maschera di ritaglio…" : "Scollego la maschera di ritaglio…",
    );
    const changed = await engine.setLayerClipping(index, enabled);
    const stats = engine.getStats();
    const layer = stats.layers[index];
    const parent = layer?.clippingParentId === null || layer?.clippingParentId === undefined
      ? null
      : stats.layers.find((candidate) => candidate.id === layer.clippingParentId) ?? null;
    layerSwitchResult.textContent = changed
      ? enabled
        ? `${layer?.name ?? before?.name ?? "Livello"} ora è una maschera su `
          + `${parent?.name ?? "il raster sotto"}. Altre M consecutive useranno la stessa base.`
        : `${layer?.name ?? before?.name ?? "Livello"} ora è una base indipendente. `
          + "Le eventuali maschere sopra restano collegate a questa nuova base."
      : "Impostazione maschera già attiva.";
  } catch (error) {
    layerSwitchResult.textContent = error instanceof Error
      ? error.message
      : "Maschera di ritaglio non aggiornata.";
  } finally {
    hideLayerLoading();
    layerSwitching = false;
    updateHistoryControls();
    updateStats(engine.getStats());
  }
}

async function changeRasterImageVisibility(id: number, visible: boolean): Promise<void> {
  if (layerSwitching || interactionLocked()) return;
  layerSwitching = true;
  updateHistoryControls();
  try {
    await engine.setRasterImageNodeVisibility(id, visible);
    layerSwitchResult.textContent = visible ? "Immagine mostrata." : "Immagine nascosta.";
  } catch (error) {
    layerSwitchResult.textContent = error instanceof Error
      ? error.message
      : "Visibilità immagine non aggiornata.";
  } finally {
    layerSwitching = false;
    updateHistoryControls();
    requestMobileLayersRefresh();
    updateStats(engine.getStats());
    mobileToolSettingsSheet?.syncOpenState();
  }
}

async function changeRasterImageOpacity(id: number, opacity: number): Promise<void> {
  if (layerSwitching || interactionLocked()) return;
  layerSwitching = true;
  updateHistoryControls();
  try {
    await engine.setRasterImageNodeOpacity(id, opacity);
    layerSwitchResult.textContent = `Opacità immagine ${Math.round(opacity * 100)}%.`;
  } catch (error) {
    layerSwitchResult.textContent = error instanceof Error
      ? error.message
      : "Opacità immagine non aggiornata.";
  } finally {
    layerSwitching = false;
    updateHistoryControls();
    requestMobileLayersRefresh();
    updateStats(engine.getStats());
    mobileToolSettingsSheet?.syncOpenState();
  }
}

async function changeLayerReference(index: number, enabled: boolean): Promise<void> {
  if (layerSwitching || interactionLocked()) {
    return;
  }
  if (index !== engine.getStats().activeLayerIndex) {
    layerSwitchResult.textContent =
      "Seleziona prima il livello raster da impostare come Riferimento.";
    return;
  }
  layerSwitching = true;
  updateHistoryControls();
  try {
    await showLayerLoading(
      enabled ? "Preparo il Riferimento GPU…" : "Rilascio il Riferimento GPU…",
    );
    const changed = await engine.setLayerReference(index, enabled);
    const layer = engine.getStats().layers[index];
    layerSwitchResult.textContent = changed
      ? enabled
        ? `${layer?.name ?? "Livello"} è ora il Riferimento del Riempimento.`
        : "Riferimento disattivato: il Riempimento usa il livello selezionato."
      : "Impostazione Riferimento già attiva.";
  } catch (error) {
    layerSwitchResult.textContent = error instanceof Error
      ? error.message
      : "Riferimento GPU non aggiornato.";
  } finally {
    hideLayerLoading();
    layerSwitching = false;
    updateHistoryControls();
    requestMobileLayersRefresh();
    updateStats(engine.getStats());
  }
}

async function selectMixedSceneItem(
  key: NonNullable<EngineStats["mixedScene"]>["selectedKey"],
): Promise<void> {
  if (layerSwitching || interactionLocked()) {
    return;
  }
  const scene = engine.getStats().mixedScene;
  if (!scene) {
    return;
  }
  if (scene.selectedKey === key) {
    layerSwitchResult.textContent = "Livello già selezionato.";
    return;
  }
  const item = scene.items.find((candidate) => candidate.key === key);
  if (!item) {
    layerSwitchResult.textContent = "Livello non trovato.";
    return;
  }

  layerSwitching = true;
  updateHistoryControls();
  try {
    await showLayerLoading(
      item.kind === "raster"
        ? "Caricamento raster…"
        : item.kind === "image"
          ? "Preparazione immagine WebGPU…"
          : "Preparazione vettore…",
    );
    const result = await engine.setActiveMixedSceneItem(key);
    if (item.kind === "raster") {
      syncActiveLayerControls();
    }
    await engine.waitForIdle();
    const snapshot = engine.getMixedSceneSnapshot();
    if (snapshot) {
      vectorTextPrototype?.syncScene(snapshot);
    }
    layerSwitchResult.textContent = item.kind === "text"
      ? "Testo selezionato: pennello sospeso; il raster di lavoro resta caldo."
      : item.kind === "svg"
        ? "SVG selezionato: usa Trasforma oppure modifica colori ed effetti."
        : item.kind === "image"
          ? "Immagine selezionata: scegli Trasforma, poi Applica o Annulla."
          : result
            ? `Raster ${result.toIndex + 1} attivo in ${result.totalMs.toFixed(0)} ms.`
            : "Raster selezionato: pennello attivo.";
  } catch (error) {
    layerSwitchResult.textContent = error instanceof Error
      ? error.message
      : "Selezione del livello non riuscita.";
  } finally {
    hideLayerLoading();
    layerSwitching = false;
    updateHistoryControls();
    updateStats(engine.getStats());
  }
}

async function selectLayer(index: number): Promise<void> {
  if (layerSwitching || interactionLocked()) {
    return;
  }
  if (index === engine.getStats().activeLayerIndex) {
    layerSwitchResult.textContent = "Livello già attivo.";
    return;
  }
  let stressPeakMiB: number | null = null;
  let stressSampler = 0;
  let stressSwitchSummary: string | null = null;
  if (layerMemoryFixtureRequested && layerMemoryStressTestCompleted) {
    stressPeakMiB = engine.getStats().gpuMemory.countedTotalMiB;
    stressSampler = window.setInterval(() => {
      stressPeakMiB = Math.max(
        stressPeakMiB ?? 0,
        engine.getStats().gpuMemory.countedTotalMiB,
      );
    }, 5);
  }
  layerSwitching = true;
  updateHistoryControls();
  try {
    await showLayerLoading("Caricamento livello…");
    const result = await engine.setActiveLayer(index);
    syncActiveLayerControls();
    // activateLayer has restored textures, composites and effects at this
    // point; waitForIdle also presents the resulting frame before uncovering it.
    await engine.waitForIdle();
    layerSwitchResult.textContent = result
      ? `Livello ${result.toIndex + 1} attivo in ${result.totalMs.toFixed(0)} ms`
        + ` (campi effetti ${result.effectsMs.toFixed(0)} ms).`
      : "Livello già attivo.";
    stressSwitchSummary = result
      ? `Cambio manuale ${result.fromIndex + 1}→${result.toIndex + 1}`
        + ` in ${result.totalMs.toFixed(0)} ms`
      : "Livello già attivo";
  } catch (error) {
    layerSwitchResult.textContent = error instanceof Error
      ? error.message
      : "Cambio livello non riuscito.";
    stressSwitchSummary = "Cambio manuale interrotto";
  } finally {
    if (stressSampler !== 0) {
      window.clearInterval(stressSampler);
      stressPeakMiB = Math.max(
        stressPeakMiB ?? 0,
        engine.getStats().gpuMemory.countedTotalMiB,
      );
    }
    hideLayerLoading();
    layerSwitching = false;
    updateHistoryControls();
    updateStats(engine.getStats());
    if (stressPeakMiB !== null && stressSwitchSummary) {
      const finalMiB = engine.getStats().gpuMemory.countedTotalMiB;
      layerMemoryStressResult.className = "result ok";
      layerMemoryStressResult.textContent =
        `${stressSwitchSummary} · picco osservato ${formatMemoryMiB(stressPeakMiB)}`
        + ` · finale ${formatMemoryMiB(finalMiB)}. Continua con alto, basso e centro.`;
    }
  }
}

async function addMobileClippingMaskLayer(): Promise<void> {
  if (layerSwitching || interactionLocked()) return;
  layerSwitching = true;
  updateHistoryControls();
  mobileLayersRenderSignature = "";
  requestMobileLayersRefresh();
  renderMobileLayerList(engine.getStats());
  try {
    await showLayerLoading("Creazione maschera…");
    const result = await engine.addClippingMaskLayer();
    syncActiveLayerControls();
    await engine.waitForIdle();
    layerSwitchResult.textContent =
      `Clipping Mask ${result.toIndex + 1} creata e selezionata in `
      + `${result.totalMs.toFixed(0)} ms.`;
  } catch (error) {
    layerSwitchResult.textContent = error instanceof Error
      ? error.message
      : "Creazione della maschera non riuscita.";
  } finally {
    hideLayerLoading();
    layerSwitching = false;
    updateHistoryControls();
    mobileLayersRenderSignature = "";
    requestMobileLayersRefresh();
    updateStats(engine.getStats());
  }
}

addLayerButton.addEventListener("click", async () => {
  if (layerSwitching || interactionLocked()) {
    return;
  }
  layerSwitching = true;
  updateHistoryControls();
  try {
    await showLayerLoading("Creazione livello…");
    const result = await engine.addLayer();
    syncActiveLayerControls();
    await engine.waitForIdle();
    layerSwitchResult.textContent =
      `Livello ${result.toIndex + 1} creato e attivo in ${result.totalMs.toFixed(0)} ms.`;
  } catch (error) {
    layerSwitchResult.textContent = error instanceof Error
      ? error.message
      : "Creazione livello non riuscita.";
  } finally {
    hideLayerLoading();
    layerSwitching = false;
    updateHistoryControls();
    mobileLayersRenderSignature = "";
    requestMobileLayersRefresh();
    updateStats(engine.getStats());
  }
});

function updateRenderingModeMemoryHint(stats: EngineStats): void {
  if (activeCanvasTool === "fill") {
    const referenceMemory = stats.fillReferenceLayerMiB > 0
      ? ` · riferimento hot ${formatMemoryMiB(stats.fillReferenceLayerMiB)}`
      : stats.referenceLayerId !== null
        ? " · riferimento sul raster attivo"
        : " · sorgente raster attivo";
    renderingModeMemoryHint.textContent =
      `Riempimento · scratch residente ${formatMemoryMiB(stats.gpuMemory.fillRendererMiB)}`
      + referenceMemory;
    return;
  }
  if (activeBrushTool !== "paint") {
    renderingModeMemoryHint.textContent =
      `Blend dry · scratch residente ${formatMemoryMiB(stats.gpuMemory.blendRendererMiB)}`;
    return;
  }
  const mode = element<HTMLSelectElement>("blendMode").value;
  const label = mode === "uniformed-glaze"
    ? "Uniformed Glaze"
    : mode === "intense-blending"
      ? "Intense Blending"
      : "Light Glaze";
  const modelHint = mode === "intense-blending"
    ? " · stamp fisici source-over"
    : "";
  renderingModeMemoryHint.textContent =
    `${label} · memoria GPU dedicata residente ${formatMemoryMiB(stats.gpuMemory.lightGlazeMiB)}`
    + ` · totale motore ${formatMemoryMiB(stats.gpuMemory.countedTotalMiB)}`
    + modelHint;
}

function updateStats(stats: EngineStats): void {
  renderLayerList(stats);
  renderMobileLayerList(stats);
  updateRenderingModeMemoryHint(stats);
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

const RENDERING_MODE_SUITE_REVISION = 4 as const;
const RENDERING_SUITE_CANONICAL_OVERRIDES: Partial<BrushSettings> = {
  size: 750,
  spacingPercent: 1,
  stabilization: 0,
  count: 16,
  flow: 1,
  opacity: 1,
  hardness: 1,
  blendIntensity: 1,
};

const renderingModeSuiteCases: readonly RenderingModeSuiteCase[] = [
  {
    id: "light-base-grain-off",
    label: "Light Glaze · Base · Grain Off · spacing 1%",
    blendMode: "light-glaze",
    variant: "base",
    grainMode: "off",
    overrides: { ...RENDERING_SUITE_CANONICAL_OVERRIDES },
  },
  {
    id: "uniformed-base-grain-off",
    label: "Uniformed Glaze · Base · Grain Off · spacing 1%",
    blendMode: "uniformed-glaze",
    variant: "base",
    grainMode: "off",
    overrides: { ...RENDERING_SUITE_CANONICAL_OVERRIDES },
  },
  {
    id: "intense-base-grain-off",
    label: "Intense Blending · Base · Grain Off · spacing 1%",
    blendMode: "intense-blending",
    variant: "base",
    grainMode: "off",
    overrides: { ...RENDERING_SUITE_CANONICAL_OVERRIDES },
  },
];
function captureRenderingModeMemory(
  blendMode: BenchmarkBlendMode,
): RenderingModeMemorySnapshot {
  const stats = engine.getStats();
  const renderingStorageMiB = blendMode === "light-glaze"
    || blendMode === "uniformed-glaze"
    || blendMode === "intense-blending"
    ? stats.gpuMemory.lightGlazeMiB
    : 0;
  return {
    countedTotalMiB: stats.gpuMemory.countedTotalMiB,
    countedTotalTransitionPeakMiB: Math.max(
      stats.gpuMemory.countedTotalMiB,
      stats.gpuMemory.lightGlazeTransitionPeakMiB,
    ),
    renderingStorageMiB,
    lightGlazeMiB: stats.gpuMemory.lightGlazeMiB,
    intenseBlendingMiB: blendMode === "intense-blending"
      ? stats.gpuMemory.lightGlazeMiB
      : 0,
    blendRendererMiB: stats.gpuMemory.blendRendererMiB,
    grainTextureMiB: stats.gpuMemory.grainTextureMiB,
    shapeTextureMiB: stats.gpuMemory.shapeTextureMiB,
    layerFormat: stats.layerFormat,
  };
}

async function replayHumanStroke(
  options: HumanStrokeReplayOptions = {},
): Promise<HumanStrokeReplayResult | null> {
  const benchmark = humanStrokeBenchmark;
  const replayTool = options.replayTool ?? "paint";
  const suiteInternal = renderingModeSuiteRunning
    && options.suiteRevision === RENDERING_MODE_SUITE_REVISION
    && typeof options.suiteCaseId === "string";
  if (!benchmark || humanStrokeReplaying || (!suiteInternal && interactionLocked())) {
    return null;
  }
  if (engine.getPixelSelectionState().selectedPixels > 0) {
    throw new Error("Deseleziona i pixel prima di riprodurre il tratto canonico.");
  }

  const testVariant: HumanStrokeTestVariant = replayTool === "blend"
    ? "blend"
    : options.testVariant ?? selectedHumanStrokeTestVariant();
  const testBlendMode: BenchmarkBlendMode = replayTool === "blend"
    ? "not-applicable"
    : options.testBlendMode ?? selectedHumanStrokeTestBlendMode();
  const testGrainMode = replayTool === "blend"
    ? "off"
    : options.testGrainMode ?? selectedHumanStrokeTestGrainMode();
  const paintBlendMode = testBlendMode === "not-applicable"
    ? "light-glaze"
    : testBlendMode;
  const paintVariant = testVariant === "fur" ? "fur" : "base";
  const baseReplaySettings = replayTool === "blend"
    ? humanStrokeBlendTestSettings(benchmark)
    : humanStrokeTestSettings(benchmark, paintVariant, paintBlendMode, testGrainMode);
  const replaySettings: BrushSettings = {
    ...baseReplaySettings,
    ...options.settingsOverride,
    tool: replayTool,
    blendMode: replayTool === "blend" ? baseReplaySettings.blendMode : paintBlendMode,
    blendIntensity: 1,
  };
  const testLabel = options.suiteCaseLabel
    ?? (replayTool === "blend"
      ? BLEND_REPLAY_LABEL
      : humanStrokeTestLabel(paintVariant, paintBlendMode, testGrainMode));
  const carrierReplay = replayTool === "blend";
  const backgroundStrategy: HumanStrokeBackgroundStrategy = carrierReplay
    ? "multicolor-horizontal-stripes-v1"
    : "transparent";

  setControlsPanelOpen(false);
  humanStrokeReplaying = true;
  benchmarkButton.disabled = true;
  updateHumanStrokeControls();
  updateHistoryControls();
  humanStrokeResult.textContent = `Riproduzione test ${testLabel} in corso…`;

  try {
    await engine.waitForIdle();
    engine.resetLightGlazeTransitionPeak();
    applySettingsToControls(replaySettings);
    await engine.waitForIdle();
    engine.resetStrokeRandomSeed();
    const resetSucceeded = mixedMemoryBenchmarkRequested
      ? mixedMemoryBenchmarkReport !== null
        && engine.resetActiveLayerForMemoryBenchmark()
      : engine.resetDocument();
    if (!resetSucceeded) {
      throw new Error("Il documento è occupato da un'operazione Undo/Redo.");
    }
    await engine.waitForIdle();
    if (carrierReplay) {
      humanStrokeResult.textContent = `Preparazione sfondo multicolore · ${testLabel}…`;
      await prepareBlendBenchmarkBackground(replaySettings);
      engine.resetStrokeRandomSeed();
      humanStrokeResult.textContent = `Riproduzione test ${testLabel} in corso…`;
    }

    await engine.waitForIdle();
    const memoryBefore = captureRenderingModeMemory(testBlendMode);
    const blendRuntimeBeforeReplay = engine.getBlendRuntimeState();
    const blendScratchStateBeforeReplay: BlendScratchState = carrierReplay
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
          nextPointIndex < benchmark.points.length
          && benchmark.points[nextPointIndex].timeMs <= elapsed
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
    const memoryAfter = captureRenderingModeMemory(testBlendMode);
    const blendRuntimeAfterReplay = engine.getBlendRuntimeState();
    const baseStamps = Math.max(0, after.totalBaseStamps - before.totalBaseStamps);
    const physicalOperations = carrierReplay
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
        testTool: replaySettings.tool,
        testBlendMode,
        testGrainMode,
        renderingSuiteRevision: options.suiteRevision ?? null,
        renderingSuiteCaseId: options.suiteCaseId ?? null,
        renderingSuiteCaseLabel: options.suiteCaseLabel ?? null,
        renderingMemoryBeforeReplay: memoryBefore,
        renderingMemoryAfterReplay: memoryAfter,
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
    let runId = 0;
    let saveError: string | null = null;
    try {
      runId = await saveBenchmarkRun(run);
    } catch (error) {
      saveError = error instanceof Error ? error.message : String(error);
    }

    humanStrokeResult.textContent = [
      `Test ${testLabel}`,
      `Tratto ${formatDuration(lastPoint.timeMs)}`,
      `${formatInteger(benchmark.points.length)} campioni`,
      carrierReplay
        ? `${formatInteger(baseStamps)} segmenti carrier GPU`
        : `${formatInteger(baseStamps)} stamps base`,
      carrierReplay
        ? `scratch ${blendScratchStateBeforeReplay} → ${blendRuntimeAfterReplay.scratchMemoryMiB.toFixed(1)} MiB`
        : `${formatInteger(physicalOperations)} copie fisiche`,
      carrierReplay
        ? `memoria Blend ${blendRuntimeAfterReplay.scratchMemoryMiB.toFixed(1)} MiB`
        : `memoria rendering ${memoryAfter.renderingStorageMiB.toFixed(1)} MiB`,
      `coda GPU ${playback.inputToGpuCompletionMs.toFixed(2)} ms`,
      `CPU frame p95 ${performanceProfile.renderFrameTotalP95Ms.toFixed(2)} ms`,
      `submit p95 ${performanceProfile.submitImmediateP95Ms.toFixed(2)} ms`,
      `display mip ${performanceProfile.paintDisplaySelectedMipLevel} / ${formatInteger(performanceProfile.paintDisplayPyramidPasses)} pass`,
      carrierReplay
        ? "preview tip n/a carrier compute"
        : performanceProfile.adaptivePreviewActivations > 0
          ? `preview tip ${formatInteger(performanceProfile.adaptivePreviewBaseStampsDrawn)} stamp / ${performanceProfile.adaptivePreviewJsTotalMs.toFixed(2)} ms JS`
          : "preview tip non attivata",
      carrierReplay
        ? `spacing carrier ${replaySettings.spacingPercent.toFixed(2)}%`
        : `spacing adattivo ${performanceProfile.adaptiveSpacingInitialPercent.toFixed(2)}→${performanceProfile.adaptiveSpacingFinalPercent.toFixed(2)}% / ${performanceProfile.adaptiveSpacingIncreaseCount} step`,
      `history GPU ${formatInteger(performanceProfile.historyCapturedBaseStamps)} stamp / ${formatInteger(performanceProfile.historyCapturedBatches)} batch`,
      `FPS medi ${performanceProfile.averageRenderFps.toFixed(1)}`,
      `${formatInteger(performanceProfile.delayedRenderFrames)} frame >20 ms`,
      `presentazione ${playback.endToPresentedMs.toFixed(2)} ms`,
      saveError
        ? `misura valida · registro non salvato: ${saveError}`
        : runId > 0 ? `run #${runId} salvata` : "run locale completata",
    ].join(" · ");

    return {
      run,
      runId,
      saveError,
      label: testLabel,
      memoryBefore,
      memoryAfter,
    };
  } catch (error) {
    engine.finishStrokePerformanceProfile();
    humanStrokeResult.textContent = error instanceof Error ? error.message : String(error);
    if (suiteInternal) {
      throw error;
    }
    return null;
  } finally {
    humanStrokeReplaying = false;
    benchmarkButton.disabled = false;
    updateHumanStrokeControls();
    historyState = engine.getHistoryState();
    updateHistoryControls();
  }
}

function renderingSuiteModeSummary(
  results: readonly HumanStrokeReplayResult[],
  blendMode: HumanStrokeTestBlendMode,
): {
  blendMode: HumanStrokeTestBlendMode;
  caseCount: number;
  renderingStorageMiB: number;
  countedTotalSteadyMiB: number;
  countedTotalTransitionPeakMiB: number;
  cpuFrameP95WorstMs: number;
  gpuQueueTailWorstMs: number;
  endToPresentedWorstMs: number;
} {
  const selected = results.filter(
    (result) => result.run.benchmark.testBlendMode === blendMode,
  );
  return {
    blendMode,
    caseCount: selected.length,
    renderingStorageMiB: Math.max(
      0,
      ...selected.map((result) => result.memoryAfter.renderingStorageMiB),
    ),
    countedTotalSteadyMiB: Math.max(
      0,
      ...selected.map((result) => result.memoryAfter.countedTotalMiB),
    ),
    countedTotalTransitionPeakMiB: Math.max(
      0,
      ...selected.map((result) => result.memoryAfter.countedTotalTransitionPeakMiB),
    ),
    cpuFrameP95WorstMs: Math.max(
      0,
      ...selected.map((result) => result.run.performance.renderFrameTotalP95Ms),
    ),
    gpuQueueTailWorstMs: Math.max(
      0,
      ...selected.map((result) => result.run.playback.inputToGpuCompletionMs),
    ),
    endToPresentedWorstMs: Math.max(
      0,
      ...selected.map((result) => result.run.playback.endToPresentedMs),
    ),
  };
}

async function runRenderingModeSuite(): Promise<void> {
  if (
    !humanStrokeBenchmark
    || renderingModeSuiteRunning
    || humanStrokeReplaying
    || interactionLocked()
  ) {
    return;
  }

  const benchmark = humanStrokeBenchmark;
  const traceFingerprint = fingerprintHumanStroke(benchmark.points);
  const tracePointCount = benchmark.points.length;
  const traceMatchesCanonical = traceFingerprint === CANONICAL_HUMAN_STROKE_FINGERPRINT
    && tracePointCount === CANONICAL_HUMAN_STROKE_POINT_COUNT;

  renderingModeSuiteRunning = true;
  renderingModeSuiteDetails.hidden = true;
  renderingModeSuiteReport.textContent = "";
  renderingModeSuiteResult.className = "result";
  renderingModeSuiteProgress.hidden = false;
  renderingModeSuiteProgress.dataset.state = "running";
  renderingModeSuiteProgress.textContent =
    `Suite rendering · 0/${renderingModeSuiteCases.length} · preparazione…`;
  setControlsPanelOpen(false);
  updateHumanStrokeControls();
  updateHistoryControls();
  const startedAt = performance.now();
  const results: HumanStrokeReplayResult[] = [];

  try {
    if (!traceMatchesCanonical) {
      throw new Error(
        `Traccia non canonica: attesa ${CANONICAL_HUMAN_STROKE_FINGERPRINT}`
        + `/${CANONICAL_HUMAN_STROKE_POINT_COUNT}, ricevuta ${traceFingerprint}/${tracePointCount}.`,
      );
    }
    for (let index = 0; index < renderingModeSuiteCases.length; index += 1) {
      const suiteCase = renderingModeSuiteCases[index];
      const progressText = [
        `Suite rendering ${index + 1}/${renderingModeSuiteCases.length}`,
        suiteCase.label,
        "non chiudere la pagina",
      ].join(" · ");
      renderingModeSuiteResult.textContent = progressText;
      renderingModeSuiteProgress.textContent = progressText;
      await nextAnimationFrame();
      const result = await replayHumanStroke({
        replayTool: "paint",
        testVariant: suiteCase.variant,
        testBlendMode: suiteCase.blendMode,
        testGrainMode: suiteCase.grainMode,
        settingsOverride: suiteCase.overrides,
        suiteRevision: RENDERING_MODE_SUITE_REVISION,
        suiteCaseId: suiteCase.id,
        suiteCaseLabel: suiteCase.label,
      });
      if (!result) {
        throw new Error(`La suite non ha prodotto il caso ${suiteCase.id}.`);
      }
      const expectedPhysicalCopies = result.run.performance.baseStamps
        * result.run.benchmark.settings.count;
      if (result.run.performance.physicalCopies !== expectedPhysicalCopies) {
        throw new Error(
          `${suiteCase.id}: copie fisiche ${result.run.performance.physicalCopies}`
          + `, attese ${expectedPhysicalCopies}.`,
        );
      }
      // L'uniform buffer del renderer Blend (0,0625 MiB) esiste dalla
      // costruzione del motore: il guard deve scattare solo se Intense
      // neutro alloca davvero lo scratch (>= 52,9 MiB).
      if (
        suiteCase.blendMode === "intense-blending"
        && result.memoryAfter.blendRendererMiB > 1
      ) {
        throw new Error(
          `Intense ha allocato ${result.memoryAfter.blendRendererMiB.toFixed(3)} MiB`
          + " dello scratch Blend dry.",
        );
      }
      results.push(result);
    }

    const modeSummaries = [
      renderingSuiteModeSummary(results, "light-glaze"),
      renderingSuiteModeSummary(results, "uniformed-glaze"),
      renderingSuiteModeSummary(results, "intense-blending"),
    ];
    const report = {
      version: RENDERING_MODE_SUITE_REVISION,
      passed: traceMatchesCanonical
        && results.length === renderingModeSuiteCases.length
        && results
          .filter((result) => result.run.benchmark.testBlendMode === "intense-blending")
          .every((result) => result.memoryAfter.blendRendererMiB <= 1),
      strategy: "canonical-human-stroke-base-spacing-1-three-renderings-one-tap-v4",
      execution: {
        order: renderingModeSuiteCases.map((suiteCase) => suiteCase.blendMode),
        prewarmedBeforeEachReplay: true,
        rgbaStorageReusedFromUniformedToIntense: true,
        rankingCaveat: "single ordered pass; compare signatures and pacing, not an absolute ranking",
      },
      semantics: {
        flowAndOpacityAtOneMakeUniformedAndIntensePixelsEquivalent: true,
        behaviorRegression: "separate Flow/Opacity-below-1 overlap fixture",
      },
      completedAt: new Date().toISOString(),
      durationMs: performance.now() - startedAt,
      trace: {
        fingerprint: traceFingerprint,
        expectedFingerprint: CANONICAL_HUMAN_STROKE_FINGERPRINT,
        pointCount: tracePointCount,
        expectedPointCount: CANONICAL_HUMAN_STROKE_POINT_COUNT,
        matchesCanonical: traceMatchesCanonical,
        durationMs: benchmark.points.at(-1)?.timeMs ?? 0,
      },
      caseCount: results.length,
      expectedCaseCount: renderingModeSuiteCases.length,
      allRunsSaved: results.every((result) => result.saveError === null),
      memoryByRendering: modeSummaries,
      cases: results.map((result, index) => ({
        id: result.run.benchmark.renderingSuiteCaseId,
        label: result.label,
        runId: result.runId,
        saveError: result.saveError,
        blendMode: result.run.benchmark.testBlendMode,
        variant: result.run.benchmark.testVariant,
        grainMode: result.run.benchmark.testGrainMode,
        executionIndex: index,
        storageClass: result.run.benchmark.testBlendMode === "light-glaze"
          ? "r8-coverage"
          : "rgba16float-stroke",
        storageReusedFromPreviousCase: index === 2,
        settings: {
          flow: result.run.benchmark.settings.flow,
          opacity: result.run.benchmark.settings.opacity,
          spacingPercent: result.run.benchmark.settings.spacingPercent,
          count: result.run.benchmark.settings.count,
          positionJitterLateral: result.run.benchmark.settings.positionJitterLateral,
          positionJitterLinear: result.run.benchmark.settings.positionJitterLinear,
          shapeScatter: result.run.benchmark.settings.shapeScatter,
        },
        memoryBefore: result.memoryBefore,
        memoryAfter: result.memoryAfter,
        performance: {
          baseStamps: result.run.performance.baseStamps,
          physicalCopies: result.run.performance.physicalCopies,
          adaptiveSpacingInitialPercent:
            result.run.performance.adaptiveSpacingInitialPercent,
          adaptiveSpacingFinalPercent:
            result.run.performance.adaptiveSpacingFinalPercent,
          adaptiveSpacingIncreaseCount:
            result.run.performance.adaptiveSpacingIncreaseCount,
          adaptiveSpacingEvents: result.run.performance.adaptiveSpacingEvents,
          cpuFrameP95Ms: result.run.performance.renderFrameTotalP95Ms,
          submitP95Ms: result.run.performance.submitImmediateP95Ms,
          gpuQueueTailMs: result.run.playback.inputToGpuCompletionMs,
          endToPresentedMs: result.run.playback.endToPresentedMs,
          averageRenderFps: result.run.performance.averageRenderFps,
          delayedRenderFrames: result.run.performance.delayedRenderFrames,
        },
      })),
    };
    renderingModeSuiteReport.textContent = JSON.stringify(report, null, 2);
    renderingModeSuiteDetails.hidden = false;
    renderingModeSuiteDetails.open = true;
    (
      window as Window & { __renderingModeSuiteReport?: typeof report }
    ).__renderingModeSuiteReport = report;
    renderingModeSuiteResult.className = "result ok";
    renderingModeSuiteResult.textContent = [
      `Suite completa · ${results.length}/${renderingModeSuiteCases.length} casi`,
      ...modeSummaries.map((summary) =>
        `${summary.blendMode} ${summary.renderingStorageMiB.toFixed(1)} MiB dedicati`
        + ` / ${summary.countedTotalSteadyMiB.toFixed(1)} MiB stabili`
        + ` / ${summary.countedTotalTransitionPeakMiB.toFixed(1)} MiB picco transizione`),
      `durata ${formatDuration(report.durationMs)}`,
    ].join(" · ");
    renderingModeSuiteProgress.dataset.state = "complete";
    renderingModeSuiteProgress.textContent = renderingModeSuiteResult.textContent;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failure = {
      version: RENDERING_MODE_SUITE_REVISION,
      passed: false,
      strategy: "canonical-human-stroke-base-spacing-1-three-renderings-one-tap-v4",
      trace: {
        fingerprint: traceFingerprint,
        expectedFingerprint: CANONICAL_HUMAN_STROKE_FINGERPRINT,
        pointCount: tracePointCount,
        expectedPointCount: CANONICAL_HUMAN_STROKE_POINT_COUNT,
        matchesCanonical: traceMatchesCanonical,
      },
      completedCases: results.length,
      expectedCaseCount: renderingModeSuiteCases.length,
      error: message,
    };
    renderingModeSuiteReport.textContent = JSON.stringify(failure, null, 2);
    renderingModeSuiteDetails.hidden = false;
    renderingModeSuiteDetails.open = true;
    renderingModeSuiteResult.className = "result error";
    renderingModeSuiteResult.textContent =
      `Suite interrotta dopo ${results.length}/${renderingModeSuiteCases.length} casi · ${message}`;
    renderingModeSuiteProgress.dataset.state = "error";
    renderingModeSuiteProgress.textContent = renderingModeSuiteResult.textContent;
  } finally {
    renderingModeSuiteRunning = false;
    historyState = engine.getHistoryState();
    updateHistoryControls();
    updateHumanStrokeControls();
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
type PointerMode =
  | "paint"
  | "fill"
  | "selection-tap"
  | "selection-lasso"
  | "transform"
  | "pan"
  | "rotate"
  | "touch-navigation";
let pointerMode: PointerMode | null = null;
let lastPanClientX = 0;
let lastPanClientY = 0;

let lastRotateClientX = 0;
let rotateShortcutHeld = false;
let fillPointerStartX = 0;
let fillPointerStartY = 0;
let fillPointerMoved = false;
let selectionPointerStartX = 0;
let selectionPointerStartY = 0;
let selectionPointerMoved = false;
let selectionTapMethod: SelectionMethod = "magic-wand";
let lassoClientPoints: SelectionPoint[] = [];
let lassoCombineMode: SelectionCombineMode = "replace";
let selectionKeyboardCursorClientX = Number.NaN;
let selectionKeyboardCursorClientY = Number.NaN;
let selectionKeyboardCursorVisible = false;
let selectionKeyboardLassoActive = false;

function syncSelectionGestureCanvasSize(): void {
  if (rasterSelectionGestureCanvas.width !== canvas.width) {
    rasterSelectionGestureCanvas.width = canvas.width;
  }
  if (rasterSelectionGestureCanvas.height !== canvas.height) {
    rasterSelectionGestureCanvas.height = canvas.height;
  }
}

function clientPointToSelectionCanvas(point: SelectionPoint): SelectionPoint {
  const rectangle = canvas.getBoundingClientRect();
  return {
    x: (point.x - rectangle.left) * canvas.width / Math.max(1, rectangle.width),
    y: (point.y - rectangle.top) * canvas.height / Math.max(1, rectangle.height),
  };
}

function ensureSelectionKeyboardCursor(): void {
  const rectangle = canvas.getBoundingClientRect();
  const minimumX = rectangle.left + 1;
  const maximumX = Math.max(minimumX, rectangle.right - 1);
  const minimumY = rectangle.top + 1;
  const maximumY = Math.max(minimumY, rectangle.bottom - 1);
  if (
    !Number.isFinite(selectionKeyboardCursorClientX)
    || !Number.isFinite(selectionKeyboardCursorClientY)
  ) {
    selectionKeyboardCursorClientX = rectangle.left + rectangle.width * 0.5;
    selectionKeyboardCursorClientY = rectangle.top + rectangle.height * 0.5;
  }
  selectionKeyboardCursorClientX = Math.min(
    maximumX,
    Math.max(minimumX, selectionKeyboardCursorClientX),
  );
  selectionKeyboardCursorClientY = Math.min(
    maximumY,
    Math.max(minimumY, selectionKeyboardCursorClientY),
  );
}

function drawLassoGesture(): void {
  syncSelectionGestureCanvasSize();
  rasterSelectionGestureContext.clearRect(
    0,
    0,
    rasterSelectionGestureCanvas.width,
    rasterSelectionGestureCanvas.height,
  );
  if (lassoClientPoints.length === 0 && !selectionKeyboardCursorVisible) {
    rasterSelectionGestureCanvas.hidden = true;
    return;
  }
  rasterSelectionGestureCanvas.hidden = false;
  rasterSelectionGestureContext.save();
  rasterSelectionGestureContext.lineCap = "round";
  rasterSelectionGestureContext.lineJoin = "round";
  const scale = canvas.width / Math.max(1, canvas.getBoundingClientRect().width);
  if (lassoClientPoints.length > 0) {
    rasterSelectionGestureContext.beginPath();
    const first = clientPointToSelectionCanvas(lassoClientPoints[0]);
    rasterSelectionGestureContext.moveTo(first.x, first.y);
    for (let index = 1; index < lassoClientPoints.length; index += 1) {
      const point = clientPointToSelectionCanvas(lassoClientPoints[index]);
      rasterSelectionGestureContext.lineTo(point.x, point.y);
    }
    rasterSelectionGestureContext.setLineDash([5 * scale, 4 * scale]);
    rasterSelectionGestureContext.lineWidth = 3 * scale;
    rasterSelectionGestureContext.strokeStyle = "rgba(0, 0, 0, 0.9)";
    rasterSelectionGestureContext.stroke();
    rasterSelectionGestureContext.lineDashOffset = -4 * scale;
    rasterSelectionGestureContext.lineWidth = 1.4 * scale;
    rasterSelectionGestureContext.strokeStyle = "rgba(255, 255, 255, 0.96)";
    rasterSelectionGestureContext.stroke();
  }
  if (selectionKeyboardCursorVisible) {
    ensureSelectionKeyboardCursor();
    const cursor = clientPointToSelectionCanvas({
      x: selectionKeyboardCursorClientX,
      y: selectionKeyboardCursorClientY,
    });
    const radius = 8 * scale;
    rasterSelectionGestureContext.setLineDash([]);
    rasterSelectionGestureContext.beginPath();
    rasterSelectionGestureContext.arc(cursor.x, cursor.y, radius, 0, Math.PI * 2);
    rasterSelectionGestureContext.moveTo(cursor.x - radius * 1.5, cursor.y);
    rasterSelectionGestureContext.lineTo(cursor.x + radius * 1.5, cursor.y);
    rasterSelectionGestureContext.moveTo(cursor.x, cursor.y - radius * 1.5);
    rasterSelectionGestureContext.lineTo(cursor.x, cursor.y + radius * 1.5);
    rasterSelectionGestureContext.lineWidth = 3 * scale;
    rasterSelectionGestureContext.strokeStyle = "rgba(0, 0, 0, 0.92)";
    rasterSelectionGestureContext.stroke();
    rasterSelectionGestureContext.lineWidth = 1.25 * scale;
    rasterSelectionGestureContext.strokeStyle = "rgba(255, 255, 255, 0.98)";
    rasterSelectionGestureContext.stroke();
  }
  rasterSelectionGestureContext.restore();
}

function appendLassoClientPoint(clientX: number, clientY: number): void {
  const previous = lassoClientPoints[lassoClientPoints.length - 1];
  if (previous && Math.hypot(clientX - previous.x, clientY - previous.y) < 0.5) return;
  lassoClientPoints.push({ x: clientX, y: clientY });
}

function clearLassoGesture(): void {
  lassoClientPoints = [];
  rasterSelectionGestureContext.clearRect(
    0,
    0,
    rasterSelectionGestureCanvas.width,
    rasterSelectionGestureCanvas.height,
  );
  if (selectionKeyboardCursorVisible) drawLassoGesture();
  else rasterSelectionGestureCanvas.hidden = true;
}

function cancelKeyboardSelectionGesture(hideCursor: boolean): void {
  selectionKeyboardLassoActive = false;
  if (hideCursor) selectionKeyboardCursorVisible = false;
  clearLassoGesture();
}

interface TouchContact {
  clientX: number;
  clientY: number;
}

interface TouchNavigationGesture {
  centerX: number;
  centerY: number;
  distance: number;
  angle: number;
}

type TouchPaintIntentReleaseReason = "movement" | "timeout" | "pointer-up";

interface TouchPaintIntentHold {
  pointerId: number;
  initialSample: PointerSample;
  bufferedSamples: PointerSample[];
  startedAtPerformanceMs: number;
  timeoutId: number;
}

const activeTouchContacts = new Map<number, TouchContact>();
let touchNavigationGesture: TouchNavigationGesture | null = null;
const touchPaintIntentHoldEnabled = pageSearchParams.get("touchPaintIntentHold") !== "0";
const touchPaintIntentDiagnostics = {
  starts: 0,
  releasedByMovement: 0,
  releasedByTimeout: 0,
  releasedByPointerUp: 0,
  canceledForNavigation: 0,
  canceledForPointerEnd: 0,
  maximumBufferedSamples: 0,
  lastHoldDurationMs: 0,
};
let touchPaintIntentHold: TouchPaintIntentHold | null = null;

function clearTouchPaintIntentTimer(hold: TouchPaintIntentHold): void {
  window.clearTimeout(hold.timeoutId);
}

function startTouchPaintIntentHold(pointerId: number, initialSample: PointerSample): void {
  if (touchPaintIntentHold) {
    clearTouchPaintIntentTimer(touchPaintIntentHold);
  }
  const hold: TouchPaintIntentHold = {
    pointerId,
    initialSample,
    bufferedSamples: [],
    startedAtPerformanceMs: performance.now(),
    timeoutId: 0,
  };
  touchPaintIntentHold = hold;
  touchPaintIntentDiagnostics.starts += 1;
  hold.timeoutId = window.setTimeout(() => {
    if (touchPaintIntentHold !== hold) return;
    releaseTouchPaintIntentHold("timeout");
  }, TOUCH_PAINT_INTENT_HOLD_MS);
}

function releaseTouchPaintIntentHold(reason: TouchPaintIntentReleaseReason): boolean {
  const hold = touchPaintIntentHold;
  if (!hold) return false;
  clearTouchPaintIntentTimer(hold);
  touchPaintIntentHold = null;
  if (activePointerId !== hold.pointerId || pointerMode !== "paint") {
    touchPaintIntentDiagnostics.canceledForPointerEnd += 1;
    return false;
  }

  touchPaintIntentDiagnostics.lastHoldDurationMs = Math.max(
    0,
    performance.now() - hold.startedAtPerformanceMs,
  );
  if (reason === "movement") touchPaintIntentDiagnostics.releasedByMovement += 1;
  else if (reason === "timeout") touchPaintIntentDiagnostics.releasedByTimeout += 1;
  else touchPaintIntentDiagnostics.releasedByPointerUp += 1;

  // The engine receives the original timestamped samples in their original
  // order. Only the wall-clock moment of the first GPU request is deferred.
  if (!engine.beginStroke(hold.initialSample)) {
    activeTouchContacts.delete(hold.pointerId);
    activePointerId = null;
    pointerMode = null;
    if (canvas.hasPointerCapture(hold.pointerId)) {
      canvas.releasePointerCapture(hold.pointerId);
    }
    humanStrokeRecording = null;
    historyState = engine.getHistoryState();
    updateHistoryControls();
    updateHumanStrokeControls();
    return false;
  }
  if (hold.bufferedSamples.length > 0) {
    engine.extendStroke(hold.bufferedSamples);
  }
  return true;
}

function cancelTouchPaintIntentHold(
  reason: "navigation" | "pointer-end",
): boolean {
  const hold = touchPaintIntentHold;
  if (!hold) return false;
  clearTouchPaintIntentTimer(hold);
  touchPaintIntentHold = null;
  touchPaintIntentDiagnostics.lastHoldDurationMs = Math.max(
    0,
    performance.now() - hold.startedAtPerformanceMs,
  );
  if (reason === "navigation") touchPaintIntentDiagnostics.canceledForNavigation += 1;
  else touchPaintIntentDiagnostics.canceledForPointerEnd += 1;
  return true;
}

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
    angle: Math.atan2(second.clientY - first.clientY, second.clientX - first.clientX),
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
      const canceledHeldIntent = cancelTouchPaintIntentHold("navigation");
      if (!canceledHeldIntent && !engine.cancelStrokeBeforeRender()) {
        engine.endStroke();
      }
      cancelHumanStrokeRecordingForNavigation();
    } else if (pointerMode === "fill") {
      fillPointerMoved = true;
    } else if (pointerMode === "selection-tap") {
      selectionPointerMoved = true;
    } else if (pointerMode === "selection-lasso") {
      clearLassoGesture();
    }
    engine.beginViewRotationGesture();
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

  if (activePointerId !== null) {
    return;
  }
  if (operationLocked()) {
    if (historyState.openEdit === "raster-property") {
      statusElement.textContent = "Completo la modifica dell'effetto prima del tratto…";
      statusElement.className = "status";
    }
    return;
  }

  const shouldRotate = event.pointerType === "mouse"
    && event.button === 0
    && rotateShortcutHeld;
  const shouldPan = event.shiftKey || event.button === 1 || event.button === 2;
  const requestedPointerMode: PointerMode = shouldRotate
    ? "rotate"
    : shouldPan
      ? "pan"
      : activeCanvasTool === "fill"
        ? "fill"
        : activeCanvasTool === "selection"
          ? selectedSelectionMethod() === "lasso"
            ? "selection-lasso"
            : "selection-tap"
        : activeCanvasTool === "transform"
          ? "transform"
        : "paint";
  const paintSample = requestedPointerMode === "paint" ? toPointerSample(event) : null;
  const holdPaintIntent = paintSample !== null && shouldHoldTouchPaintIntent(
    touchPaintIntentHoldEnabled,
    event.pointerType,
    activeCanvasTool,
  );
  if (paintSample && !holdPaintIntent) {
    const recordingStarted = humanStrokeRecordingArmed;
    if (recordingStarted) startHumanStrokeRecording(event, paintSample);
    if (!engine.beginStroke(paintSample)) {
      if (recordingStarted) humanStrokeRecording = null;
      historyState = engine.getHistoryState();
      updateHistoryControls();
      updateHumanStrokeControls();
      return;
    }
  }

  event.preventDefault();
  if (activeCanvasTool === "selection") {
    cancelKeyboardSelectionGesture(true);
  }
  activePointerId = event.pointerId;
  if (event.pointerType === "touch") {
    activeTouchContacts.set(event.pointerId, {
      clientX: event.clientX,
      clientY: event.clientY,
    });
  }
  pointerMode = requestedPointerMode;
  canvas.setPointerCapture(event.pointerId);

  if (pointerMode === "rotate") {
    engine.beginViewRotationGesture();
    canvas.classList.add("rotating");
    lastRotateClientX = event.clientX;
  } else if (pointerMode === "pan") {
    canvas.classList.add("panning");
    lastPanClientX = event.clientX;
    lastPanClientY = event.clientY;
  } else if (pointerMode === "fill") {
    fillPointerStartX = event.clientX;
    fillPointerStartY = event.clientY;
    fillPointerMoved = false;
  } else if (pointerMode === "selection-tap") {
    selectionPointerStartX = event.clientX;
    selectionPointerStartY = event.clientY;
    selectionPointerMoved = false;
    selectionTapMethod = selectedSelectionMethod();
  } else if (pointerMode === "selection-lasso") {
    lassoClientPoints = [];
    lassoCombineMode = selectionCombineMode;
    appendLassoClientPoint(event.clientX, event.clientY);
    drawLassoGesture();
  } else if (pointerMode === "transform") {
    // Le maniglie semantiche vivono sull’overlay; sul raster sottostante il
    // tool Trasforma non deve mai avviare una pennellata.
  } else {
    if (paintSample && holdPaintIntent) {
      if (humanStrokeRecordingArmed) startHumanStrokeRecording(event, paintSample);
      startTouchPaintIntentHold(event.pointerId, paintSample);
    }
  }

  // Sul percorso immediato questo callback segue il primo render; sul gate
  // touch resta comunque separato dall'arbitraggio e dal percorso input.
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
        const rawRotationDelta = nextGesture.angle - previousGesture.angle;
        const rotationDelta = Math.atan2(Math.sin(rawRotationDelta), Math.cos(rawRotationDelta));
        if (Math.abs(rotationDelta) > 0.0001) {
          engine.rotateViewBy(rotationDelta, nextGesture.centerX, nextGesture.centerY);
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
  if (pointerMode === "rotate") {
    const deltaRadians = (event.clientX - lastRotateClientX) * Math.PI / 720;
    engine.rotateViewBy(deltaRadians);
    lastRotateClientX = event.clientX;
    return;
  }
  if (pointerMode === "pan") {
    engine.panByClientDelta(event.clientX - lastPanClientX, event.clientY - lastPanClientY);
    lastPanClientX = event.clientX;
    lastPanClientY = event.clientY;
    return;
  }
  if (pointerMode === "fill") {
    if (Math.hypot(
      event.clientX - fillPointerStartX,
      event.clientY - fillPointerStartY,
    ) > 8) {
      fillPointerMoved = true;
    }
    return;
  }
  if (pointerMode === "selection-tap") {
    if (Math.hypot(
      event.clientX - selectionPointerStartX,
      event.clientY - selectionPointerStartY,
    ) > 8) {
      selectionPointerMoved = true;
    }
    return;
  }
  if (pointerMode === "selection-lasso") {
    const coalesced = (
      event as PointerEvent & { getCoalescedEvents?: () => PointerEvent[] }
    ).getCoalescedEvents?.() ?? [];
    for (const source of coalesced.length > 0 ? coalesced : [event]) {
      appendLassoClientPoint(source.clientX, source.clientY);
    }
    drawLassoGesture();
    return;
  }
  if (pointerMode === "transform") {
    return;
  }

  const eventWithCoalescing = event as PointerEvent & {
    getCoalescedEvents?: () => PointerEvent[];
  };
  const coalesced = eventWithCoalescing.getCoalescedEvents?.() ?? [];
  const sourceEvents = coalesced.length > 0 ? coalesced : [event];
  const samples = sourceEvents.map(toPointerSample);
  captureHumanStrokeSamples(sourceEvents, samples);
  const heldIntent = touchPaintIntentHold;
  if (heldIntent?.pointerId === event.pointerId) {
    heldIntent.bufferedSamples.push(...samples);
    touchPaintIntentDiagnostics.maximumBufferedSamples = Math.max(
      touchPaintIntentDiagnostics.maximumBufferedSamples,
      heldIntent.bufferedSamples.length,
    );
    if (touchPaintIntentMovementReached(heldIntent.initialSample, samples)) {
      releaseTouchPaintIntentHold("movement");
    }
    return;
  }
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
      engine.endViewRotationGesture();
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

  if (pointerMode === "paint" && touchPaintIntentHold?.pointerId === event.pointerId) {
    if (event.type === "pointerup") {
      releaseTouchPaintIntentHold("pointer-up");
    } else {
      cancelTouchPaintIntentHold("pointer-end");
    }
  }

  const fillRequest = pointerMode === "fill"
    && event.type === "pointerup"
    && !fillPointerMoved
    ? {
      clientX: event.clientX,
      clientY: event.clientY,
      tolerance: rangeValue("fillTolerance"),
      color: element<HTMLInputElement>("brushColor").value,
    }
    : null;
  const selectionTapRequest = pointerMode === "selection-tap"
    && selectionTapMethod === "magic-wand"
    && event.type === "pointerup"
    && !selectionPointerMoved
    ? {
      clientX: event.clientX,
      clientY: event.clientY,
      tolerance: rangeValue("selectionTolerance"),
      combineMode: selectionCombineMode,
    }
    : null;
  if (pointerMode === "selection-lasso" && event.type === "pointerup") {
    appendLassoClientPoint(event.clientX, event.clientY);
  }
  const lassoRequest = pointerMode === "selection-lasso"
    && event.type === "pointerup"
    ? {
      points: lassoClientPoints.slice(),
      combineMode: lassoCombineMode,
    }
    : null;

  const completedPointerMode = pointerMode;
  if (pointerMode === "paint") {
    engine.endStroke(event.timeStamp);
    void finishHumanStrokeRecording(event.type === "pointerup");
  } else if (pointerMode === "rotate") {
    engine.endViewRotationGesture();
  }
  canvas.classList.remove("panning", "rotating");
  pointerMode = null;
  activePointerId = null;
  scheduleMobileLayersRefresh();
  if (completedPointerMode === "paint") {
    requestMobileLayerThumbnailCapture();
  }
  touchNavigationGesture = null;
  fillPointerMoved = false;
  selectionPointerMoved = false;
  clearLassoGesture();
  historyState = engine.getHistoryState();
  updateHistoryControls();
  updateHumanStrokeControls();
  if (fillRequest) {
    void engine.fillAtClientPoint(
      fillRequest.clientX,
      fillRequest.clientY,
      fillRequest.tolerance,
      fillRequest.color,
    ).catch((error) => {
      console.error("Riempimento WebGPU non riuscito", error);
    }).finally(() => {
      historyState = engine.getHistoryState();
      updateHistoryControls();
      updateHumanStrokeControls();
      requestMobileLayerThumbnailCapture();
    });
  }
  if (selectionTapRequest) {
    void runPixelSelectionOperation(() => engine.selectConnectedAtClientPoint(
      selectionTapRequest.clientX,
      selectionTapRequest.clientY,
      selectionTapRequest.tolerance,
      selectionTapRequest.combineMode,
    ));
  } else if (lassoRequest) {
    void runPixelSelectionOperation(() => engine.selectPixelsByClientLasso(
      lassoRequest.points,
      lassoRequest.combineMode,
    ));
  }
}

canvas.addEventListener("pointerup", finishPointer);
canvas.addEventListener("pointercancel", finishPointer);
canvas.addEventListener("lostpointercapture", finishPointer);
canvas.addEventListener("contextmenu", (event) => event.preventDefault());

canvas.addEventListener("focus", () => {
  if (
    activeCanvasTool !== "selection"
    || selectedSelectionMethod() === "color-range"
    || activePointerId !== null
  ) {
    return;
  }
  selectionKeyboardCursorVisible = true;
  ensureSelectionKeyboardCursor();
  drawLassoGesture();
});

canvas.addEventListener("blur", () => {
  cancelKeyboardSelectionGesture(true);
});

canvas.addEventListener("keydown", (event) => {
  if (
    activeCanvasTool !== "selection"
    || selectedSelectionMethod() === "color-range"
    || activePointerId !== null
    || operationLocked()
    || event.isComposing
    || event.altKey
    || event.ctrlKey
    || event.metaKey
  ) {
    return;
  }
  const method = selectedSelectionMethod();
  selectionKeyboardCursorVisible = true;
  ensureSelectionKeyboardCursor();
  const step = event.shiftKey ? 32 : 8;
  let moved = true;
  if (event.key === "ArrowLeft") selectionKeyboardCursorClientX -= step;
  else if (event.key === "ArrowRight") selectionKeyboardCursorClientX += step;
  else if (event.key === "ArrowUp") selectionKeyboardCursorClientY -= step;
  else if (event.key === "ArrowDown") selectionKeyboardCursorClientY += step;
  else moved = false;
  if (moved) {
    event.preventDefault();
    ensureSelectionKeyboardCursor();
    if (method === "lasso" && selectionKeyboardLassoActive) {
      appendLassoClientPoint(
        selectionKeyboardCursorClientX,
        selectionKeyboardCursorClientY,
      );
    }
    drawLassoGesture();
    return;
  }

  if (event.key === "Escape" && method === "lasso" && selectionKeyboardLassoActive) {
    event.preventDefault();
    cancelKeyboardSelectionGesture(false);
    statusElement.textContent = "Lazo da tastiera annullato.";
    statusElement.className = "status";
    return;
  }

  const activates = event.key === "Enter" || event.code === "Space";
  if (!activates) return;
  event.preventDefault();
  if (method === "magic-wand") {
    void runPixelSelectionOperation(() => engine.selectConnectedAtClientPoint(
      selectionKeyboardCursorClientX,
      selectionKeyboardCursorClientY,
      rangeValue("selectionTolerance"),
      selectionCombineMode,
    ));
    return;
  }

  if (event.code === "Space") {
    if (!selectionKeyboardLassoActive) {
      lassoClientPoints = [];
      lassoCombineMode = selectionCombineMode;
      selectionKeyboardLassoActive = true;
      statusElement.textContent =
        "Lazo da tastiera attivo: usa le frecce, Invio per chiudere, Esc per annullare.";
      statusElement.className = "status";
    }
    appendLassoClientPoint(
      selectionKeyboardCursorClientX,
      selectionKeyboardCursorClientY,
    );
    drawLassoGesture();
    return;
  }

  if (event.key === "Enter" && selectionKeyboardLassoActive) {
    appendLassoClientPoint(
      selectionKeyboardCursorClientX,
      selectionKeyboardCursorClientY,
    );
    const points = lassoClientPoints.slice();
    const combineMode = lassoCombineMode;
    selectionKeyboardLassoActive = false;
    clearLassoGesture();
    void runPixelSelectionOperation(() => engine.selectPixelsByClientLasso(
      points,
      combineMode,
    ));
  }
});

function keyboardEventTargetsEditable(target: EventTarget | null): boolean {
  const elementTarget = target instanceof Element ? target : null;
  return Boolean(elementTarget?.closest("input, textarea, select, [contenteditable]"));
}

window.addEventListener("keydown", (event) => {
  if (
    event.defaultPrevented
    || event.isComposing
    || event.altKey
    || event.ctrlKey
    || event.metaKey
    || event.key.toLowerCase() !== "r"
    || keyboardEventTargetsEditable(event.target)
  ) {
    return;
  }
  rotateShortcutHeld = true;
  canvas.classList.add("rotation-ready");
  event.preventDefault();
});

window.addEventListener("keyup", (event) => {
  if (event.key.toLowerCase() !== "r") {
    return;
  }
  rotateShortcutHeld = false;
  canvas.classList.remove("rotation-ready");
});

const layerCompressionInteractionPointers = new Set<number>();
window.addEventListener("blur", () => {
  cancelMobileLayerReorderGesture();
  if (engine.layerColdCompressionEnabled) {
    layerCompressionInteractionPointers.clear();
    engine.pauseLayerColdCompressionForInteraction();
  }
  rotateShortcutHeld = false;
  canvas.classList.remove("rotation-ready");
});

window.addEventListener("focus", () => {
  if (
    engine.layerColdCompressionEnabled
    && document.visibilityState === "visible"
    && layerCompressionInteractionPointers.size === 0
  ) {
    engine.resumeLayerColdCompressionAfterInteraction();
  }
});

window.addEventListener("pointerdown", (event) => {
  if (engine.layerColdCompressionEnabled) {
    layerCompressionInteractionPointers.add(event.pointerId);
    engine.pauseLayerColdCompressionForInteraction();
  }
  engine.interruptHistoryMaintenance();
  if (
    mobileLayerReorderGesture
    && event.pointerId !== mobileLayerReorderGesture.pointerId
  ) {
    cancelMobileLayerReorderGesture();
  }
}, { capture: true });

function finishLayerCompressionPointerInteraction(event: PointerEvent): void {
  if (!engine.layerColdCompressionEnabled) {
    return;
  }
  layerCompressionInteractionPointers.delete(event.pointerId);
  if (
    layerCompressionInteractionPointers.size === 0
    && document.visibilityState === "visible"
    && document.hasFocus()
  ) {
    engine.resumeLayerColdCompressionAfterInteraction();
  }
}

window.addEventListener("pointerup", (event) => {
  finishLayerCompressionPointerInteraction(event);
  engine.resumeDiscardedHistoryMaintenance();
}, { capture: true });

window.addEventListener("pointercancel", (event) => {
  finishLayerCompressionPointerInteraction(event);
  engine.resumeDiscardedHistoryMaintenance();
}, { capture: true });

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") {
    cancelMobileLayerReorderGesture();
    if (engine.layerColdCompressionEnabled) {
      layerCompressionInteractionPointers.clear();
      engine.pauseLayerColdCompressionForInteraction();
    }
  } else if (
    engine.layerColdCompressionEnabled
    && layerCompressionInteractionPointers.size === 0
    && document.hasFocus()
  ) {
    engine.resumeLayerColdCompressionAfterInteraction();
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && mobileLayerReorderGesture) {
    event.preventDefault();
    cancelMobileLayerReorderGesture();
  }
});

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

const resizeObserver = new ResizeObserver(() => {
  engine.resizeCanvas();
  syncSelectionGestureCanvasSize();
  if (pointerMode === "selection-lasso" || selectionKeyboardCursorVisible) {
    drawLassoGesture();
  }
});
resizeObserver.observe(canvas);

syncRasterColorOverlayControls(engine.getRasterColorOverlayStyle());
syncRasterStrokeControls(engine.getRasterStrokeStyle());
syncRasterOuterShadowControls(engine.getRasterOuterShadowStyle());
syncRasterInnerShadowControls(engine.getRasterInnerShadowStyle());
syncRasterBevelControls(engine.getRasterBevelStyle());
setGpuMemoryPanelOpen(false);
setControlsPanelOpen(!mobileUiMediaQuery.matches);
setMobileToolsSheetOpen(false);
setMobileBrushLibraryOpen(false);
mobileStrokeSheet?.close(false);
mobileRasterEffectsSheet?.close(false);
mobileToolSettingsSheet?.close(false);
setSelectionCombineMode("replace");
updatePixelSelectionResult(engine.getPixelSelectionState());
configureBrushToolUi("paint", false);
updateControlOutputs();
engine.setBrushSettings(readBrushSettings());
updateHumanStrokeControls();
updateHistoryControls();
void loadCanonicalHumanStroke();

void engine.initialize()
  .then(async () => {
    engineInitialized = true;
    if (mobileBrushStudio) {
      if (mobileUiMediaQuery.matches) {
        const fallback = activeMobileBrushLibraryBrushId === PENCIL_BRUSH_PRESET.id
          ? resolveBrushPresetSettings(PENCIL_BRUSH_PRESET, engine.getSettings())
          : mobileCurrentBrushFallback(engine.getSettings());
        const restored = await mobileBrushStudio.resolveBrushSettings(
          activeMobileBrushLibraryBrushId,
          fallback,
        );
        applySettingsToControls(restored);
        setMobileBrushLibraryCategory(
          mobileBrushLibraryCategoryForBrush(activeMobileBrushLibraryBrushId),
        );
        syncMobileBrushLibrarySelection();
      } else {
        mobileBrushStudio.rememberSettings("current", engine.getSettings());
      }
    }
    if (vectorTextEditorEnabled) {
      vectorTextPrototype = new MixedVectorTextController(engine);
      await vectorTextPrototype.initialize();
      if (import.meta.env.DEV) {
        (window as Window & {
          __vectorTextPrototype?: MixedVectorTextController;
        }).__vectorTextPrototype = vectorTextPrototype;
      }
    }
    syncMobileToolsMenuState();
    historyState = engine.getHistoryState();
    requestMobileLayerThumbnailCapture(0);
    layerHistoryTestRunning = layerHistoryTestRequested || layerBlendTestRequested;
    layerMemoryStressTestRunning = iphoneMemoryLimitTestRequested;
    updateHistoryControls();
    updateHumanStrokeControls();
    if (iphoneMemoryLimitTestRequested) {
      await recoverRequestedIphoneMemoryLimitTest();
      layerMemoryStressTestRunning = false;
      updateHistoryControls();
      updateHumanStrokeControls();
    }
    if (layerBlendTestRequested) {
      await runRequestedLayerBlendTest();
    } else if (clippingGroupTestRequested) {
      layerHistoryTestRunning = true;
      await runRequestedClippingGroupTest();
    } else if (layerHistoryTestRequested) {
      await runRequestedLayerHistoryTest();
    }
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    const secureContextHint = !window.isSecureContext
      ? " WebGPU richiede HTTPS oppure localhost; un indirizzo LAN in HTTP non è sufficiente."
      : "";
    statusElement.textContent = `${message}${secureContextHint}`;
    statusElement.className = "status error";
    benchmarkButton.disabled = true;
    if (layerBlendTestRequested) {
      const failure = {
        version: 1,
        passed: false,
        checks: { runtimeShaderCompilationGatePassed: false },
        error: `${message}${secureContextHint}`,
      } as const;
      layerHistoryTestSection.hidden = false;
      layerHistoryTestResult.className = "result error";
      layerHistoryTestResult.textContent = `Fusioni livello GPU ERRORE · ${message}`;
      layerHistoryTestReport.textContent = JSON.stringify(failure, null, 2);
      layerHistoryTestDetails.hidden = false;
      layerHistoryTestDetails.open = true;
      (
        window as Window & { __layerBlendGpuTestReport?: typeof failure }
      ).__layerBlendGpuTestReport = failure;
    }
    updateHistoryControls();
  });

window.setInterval(() => updateStats(engine.getStats()), 500);
