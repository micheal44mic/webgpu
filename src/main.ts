import "./styles.css";
import {
  shouldCloseMobileToolsSheetDrag,
  type MobileToolsSheetSnap,
} from "./mobile-tools-sheet-gesture";
import {
  MOBILE_LAYER_REORDER_HOLD_MS,
  mobileLayerReorderAutoScrollVelocity,
  mobileLayerReorderDropSlot,
  mobileLayerReorderHoldReached,
  mobileLayerReorderMovementExceeded,
  type MobileLayerReorderPlan,
  type MobileLayerReorderRowGeometry,
} from "./mobile-layer-reorder-core";
import {
  buildMobileLayerMergeSelectionPlan,
  mobileLayerMergeCompletionMatches,
  type MobileLayerMergeSelectionItem,
  type MobileLayerMergeSelectionPlan,
} from "./mobile-layer-multi-selection";
import {
  TOUCH_PAINT_INTENT_HOLD_MS,
  TOUCH_PAINT_INTENT_MOVE_THRESHOLD_PX,
  TOUCH_PAINT_INTENT_STRATEGY,
  shouldHoldTouchPaintIntent,
  touchPaintIntentMovementReached,
} from "./touch-paint-intent-core";
import { MobileBrushStudioController } from "./mobile-brush-studio";
import { MobileBrushLibraryPreviewRenderer } from "./brush-library-preview";
import { AuthoritativeBrushStrokePreviewRenderer } from "./brush-stroke-preview-renderer";
import { MobileStrokeSheetController } from "./mobile-stroke-sheet";
import { MobileGaussianBlurSheetController } from "./mobile-gaussian-blur-sheet";
import { MobileMotionBlurSheetController } from "./mobile-motion-blur-sheet";
import { MobileNoiseSheetController } from "./mobile-noise-sheet";
import { MobileLiquifySheetController } from "./mobile-liquify-sheet";
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
  BRUSH_STUDIO_MAX_CUSTOM_BRUSHES,
  brushStudioAssetStorageKey,
  createBrushStudioBaseSettings,
  createBrushStudioCustomBrushId,
  deleteBrushStudioAsset,
  deleteBrushStudioSavedBrush,
  isBrushStudioCustomBrushId,
  loadBrushStudioAsset,
  loadBrushStudioLibraryState,
  loadBrushStudioSavedBrush,
  nextBrushStudioCustomBrushName,
  saveBrushStudioAsset,
  saveBrushStudioLibraryState,
  saveBrushStudioSavedBrush,
  uniqueBrushStudioCustomBrushName,
  type BrushStudioCustomBrush,
  type BrushStudioCustomBrushId,
} from "./brush-studio-storage";
import {
  BRUSH_STUDIO_TRANSFER_MAX_FILE_BYTES,
  BRUSH_STUDIO_TRANSFER_MIME_TYPE,
  brushStudioTransferFileName,
  createBrushStudioImportedAssetId,
  createBrushStudioTransferBlob,
  parseBrushStudioTransferBlob,
} from "./brush-studio-transfer";
import {
  Blend,
  Box,
  Brush,
  Check,
  ChevronDown,
  CircleDashed,
  CircleDotDashed,
  Copy,
  Download,
  Eraser,
  Eye,
  EyeOff,
  Focus,
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
  Sparkles,
  Spline,
  SquareDashed,
  SquareStack,
  Sun,
  Type as TypeIcon,
  TypeOutline,
  Undo2,
  Upload,
  Wind,
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
import type {
  EngineGpuMemoryStats,
  EngineStats,
  StrokePerformanceProfile,
} from "./engine-stats";
import {
  APP_DIAGNOSTIC_SCHEMA,
  BoundedAppDiagnosticLog,
  captureAppDiagnosticState,
  describeAppDiagnosticError,
  inspectAppDiagnosticInvariants,
  summarizeAppDiagnosticHistoryWindow,
} from "./app-diagnostics";
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
import {
  DESTRUCTIVE_GAUSSIAN_BLUR_DEFAULT_RADIUS,
  DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS,
  DESTRUCTIVE_GAUSSIAN_BLUR_RADIUS_STEP,
} from "./gaussian-blur-core";
import {
  DESTRUCTIVE_MOTION_BLUR_DEFAULT_ANGLE,
  DESTRUCTIVE_MOTION_BLUR_DEFAULT_DISTANCE,
  DESTRUCTIVE_MOTION_BLUR_DISTANCE_STEP,
  DESTRUCTIVE_MOTION_BLUR_MAX_ANGLE,
  DESTRUCTIVE_MOTION_BLUR_MAX_DISTANCE,
  DESTRUCTIVE_MOTION_BLUR_MIN_ANGLE,
} from "./motion-blur-core";
import {
  DEFAULT_RASTER_NOISE_SETTINGS,
  DESTRUCTIVE_RASTER_NOISE_AMOUNT_STEP,
  DESTRUCTIVE_RASTER_NOISE_MAX_AMOUNT_PERCENT,
  rasterNoiseOctaveCount,
  rasterNoisePeriodPixels,
  type RasterNoiseChannels,
  type RasterNoiseSettings,
  type RasterNoiseStyle,
} from "./noise-core";
import {
  DEFAULT_LIQUIFY_SETTINGS,
  LIQUIFY_MODES,
  isLiquifyMode,
  liquifyModeControls,
  normalizeLiquifySettings,
  type LiquifyMode,
  type LiquifySettings,
} from "./liquify-core";
import { layerBaseMemoryMiB } from "./engine-memory-model";
import { GPU_MEMORY_AUDIT_TOLERANCE_BYTES } from "./gpu-memory-audit";
import { GPU_MEMORY_CATEGORY_ORDER } from "./gpu-resource-registry";
import { LAYER_STACK_MAXIMUM } from "./layer-stack";
import { LAYER_THUMBNAIL_SIZE } from "./layer-thumbnail-renderer";
import { BoundedMobileRasterThumbnailCache } from "./mobile-raster-thumbnail-cache";
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
import type { MixedVectorTextController } from "./mixed-vector-text-controller";
import {
  RASTER_IMAGE_NODE_MAXIMUM,
  VECTOR_SVG_NODE_MAXIMUM,
  VECTOR_TEXT_NODE_MAXIMUM,
  type MixedSceneItem,
} from "./mixed-scene-stack";
import type { MixedMemoryBenchmarkReport } from "./mixed-memory-benchmark";
import {
  VECTOR_TEXT_ZOOM_AB_IDLE_FRAME_COUNT,
  VECTOR_TEXT_ZOOM_AB_SAMPLE_COUNT,
  VECTOR_TEXT_ZOOM_AB_START_ZOOM,
  VECTOR_TEXT_ZOOM_AB_STRATEGY,
  VECTOR_TEXT_ZOOM_C_IDLE_FRAME_COUNT,
  VECTOR_TEXT_ZOOM_C_GESTURE_DURATION_MS,
  VECTOR_TEXT_ZOOM_C_SAMPLE_LIMIT,
  VECTOR_TEXT_ZOOM_C_FALLBACK_ZOOM,
  VECTOR_TEXT_ZOOM_C_START_ZOOM,
  VECTOR_TEXT_ZOOM_C_STRATEGY,
  VECTOR_TEXT_ZOOM_C_TARGET_ZOOM,
  VECTOR_TEXT_ZOOM_STRESS_PROFILE_ORDER,
  VECTOR_TEXT_ZOOM_STRESS_SLOW_FRAME_MS,
  VECTOR_TEXT_ZOOM_STRESS_STRATEGY,
  VECTOR_TEXT_ZOOM_STRESS_TARGET_ZOOM,
  VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT,
  vectorTextZoomCoverageSeed,
  vectorTextZoomStressSeed,
  vectorTextZoomStressStepFactor,
} from "./vector-text-adaptive-zoom";
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
import {
  completeStartupDiagnostics,
  markStartupPhase,
  reportStartupFailure,
} from "./startup-diagnostics";

markStartupPhase(
  "Preparazione dell’interfaccia",
  "Il modulo principale è stato caricato e sta collegando i controlli.",
);
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
    Download,
    Eraser,
    Eye,
    EyeOff,
    Focus,
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
    Sparkles,
    Spline,
    SquareDashed,
    SquareStack,
    Sun,
    Type: TypeIcon,
    TypeOutline,
    Undo2,
    Upload,
    Wind,
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
markStartupPhase(
  "Interfaccia HTML collegata",
  "Canvas e controlli principali sono disponibili.",
);
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
const mobileLayerMultiSelectButton = element<HTMLButtonElement>(
  "mobileLayerMultiSelect",
);
const mobileLayerList = element<HTMLElement>("mobileLayerList");
const mobileLayerMultiActions = element<HTMLElement>("mobileLayerMultiActions");
const mobileLayerMergeSelectionButton = element<HTMLButtonElement>(
  "mobileLayerMergeSelection",
);
const mobileLayerContextMenu = element<HTMLElement>("mobileLayerContextMenu");
const mobileLayerClippingButton = element<HTMLButtonElement>("mobileLayerClipping");
const mobileLayerOptionsButton = element<HTMLButtonElement>("mobileLayerOptions");
const mobileLayerMergeButton = element<HTMLButtonElement>("mobileLayerMerge");
const mobileLayerMergeReason = element<HTMLParagraphElement>("mobileLayerMergeReason");
const mobileLayerMergeStatus = element<HTMLParagraphElement>("mobileLayerMergeStatus");
const mobileLayerDeleteButton = element<HTMLButtonElement>("mobileLayerDelete");
const mobileLayerReorderStatus = element<HTMLParagraphElement>(
  "mobileLayerReorderStatus",
);
const mobileBrushControls = element<HTMLElement>("mobileBrushControls");
const mobileBrushSizeTrack = element<HTMLElement>("mobileBrushSizeTrack");
const mobileBrushOpacityTrack = element<HTMLElement>("mobileBrushOpacityTrack");
const mobileBrushStretchTrack = element<HTMLElement>("mobileBrushStretchTrack");
const mobileBrushPaintTrack = element<HTMLElement>("mobileBrushPaintTrack");
const mobileBrushBlurTrack = element<HTMLElement>("mobileBrushBlurTrack");
const mobileBrushSizeControl = element<HTMLElement>("mobileBrushSizeControl");
const mobileBrushOpacityControl = element<HTMLElement>("mobileBrushOpacityControl");
const mobileBrushStretchControl = element<HTMLElement>("mobileBrushStretchControl");
const mobileBrushPaintControl = element<HTMLElement>("mobileBrushPaintControl");
const mobileBrushBlurControl = element<HTMLElement>("mobileBrushBlurControl");
const mobileBrushPreview = element<HTMLElement>("mobileBrushPreview");
const mobileBrushPreviewLabel = element<HTMLOutputElement>("mobileBrushPreviewLabel");
const mobileBrushPreviewCanvas = element<HTMLCanvasElement>("mobileBrushPreviewCanvas");
const mobileBrushLibrarySheet = element<HTMLElement>("mobileBrushLibrarySheet");
const mobileBrushLibraryHandle = element<HTMLButtonElement>("mobileBrushLibraryHandle");
const mobileBrushLibraryImportButton = element<HTMLButtonElement>("mobileBrushLibraryImport");
const mobileBrushLibraryExportButton = element<HTMLButtonElement>("mobileBrushLibraryExport");
const mobileBrushLibraryImportFile = element<HTMLInputElement>("mobileBrushLibraryImportFile");
const mobileBrushLibraryAddButton = element<HTMLButtonElement>("mobileBrushLibraryAdd");
const mobileBrushLibraryStatus = element<HTMLParagraphElement>("mobileBrushLibraryStatus");
const mobileBrushLibraryBrushes = element<HTMLElement>("mobileBrushLibraryBrushes");
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
const mobileBrushLibraryCards: HTMLButtonElement[] = Array.from(
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
const rasterLiquifySection = element<HTMLElement>("rasterLiquifySection");
const desktopLiquifyOpenInput = element<HTMLInputElement>("desktopLiquifyOpen");
const desktopLiquifyParameters = element<HTMLElement>("desktopLiquifyParameters");
const mobileLiquifyOpenButton = element<HTMLButtonElement>("mobileLiquifyOpen");
const mobileLiquifySheetElement = element<HTMLElement>("mobileLiquifySheet");
const mobileLiquifyModeLabel = element<HTMLOutputElement>("mobileLiquifyModeLabel");
const liquifyModeButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-liquify-mode]"),
);
const desktopLiquifySizeInput = element<HTMLInputElement>("desktopLiquifySize");
const mobileLiquifySizeInput = element<HTMLInputElement>("mobileLiquifySize");
const desktopLiquifySizeOutput = element<HTMLOutputElement>("desktopLiquifySizeOut");
const mobileLiquifySizeOutput = element<HTMLOutputElement>("mobileLiquifySizeOut");
const desktopLiquifyPressureInput = element<HTMLInputElement>("desktopLiquifyPressure");
const mobileLiquifyPressureInput = element<HTMLInputElement>("mobileLiquifyPressure");
const desktopLiquifyPressureOutput = element<HTMLOutputElement>(
  "desktopLiquifyPressureOut",
);
const mobileLiquifyPressureOutput = element<HTMLOutputElement>(
  "mobileLiquifyPressureOut",
);
const desktopLiquifyDistortionInput = element<HTMLInputElement>(
  "desktopLiquifyDistortion",
);
const mobileLiquifyDistortionInput = element<HTMLInputElement>("mobileLiquifyDistortion");
const desktopLiquifyDistortionOutput = element<HTMLOutputElement>(
  "desktopLiquifyDistortionOut",
);
const mobileLiquifyDistortionOutput = element<HTMLOutputElement>(
  "mobileLiquifyDistortionOut",
);
const desktopLiquifyMomentumInput = element<HTMLInputElement>("desktopLiquifyMomentum");
const mobileLiquifyMomentumInput = element<HTMLInputElement>("mobileLiquifyMomentum");
const desktopLiquifyMomentumOutput = element<HTMLOutputElement>(
  "desktopLiquifyMomentumOut",
);
const mobileLiquifyMomentumOutput = element<HTMLOutputElement>(
  "mobileLiquifyMomentumOut",
);
const desktopLiquifyAmountInput = element<HTMLInputElement>("desktopLiquifyAmount");
const mobileLiquifyAmountInput = element<HTMLInputElement>("mobileLiquifyAmount");
const desktopLiquifyAmountOutput = element<HTMLOutputElement>("desktopLiquifyAmountOut");
const mobileLiquifyAmountOutput = element<HTMLOutputElement>("mobileLiquifyAmountOut");
const desktopLiquifyStatus = element<HTMLParagraphElement>("desktopLiquifyStatus");
const mobileLiquifyStatus = element<HTMLParagraphElement>("mobileLiquifyStatus");
const desktopLiquifyResetButton = element<HTMLButtonElement>("desktopLiquifyReset");
const mobileLiquifyResetButton = element<HTMLButtonElement>("mobileLiquifyReset");
const desktopLiquifyCancelButton = element<HTMLButtonElement>("desktopLiquifyCancel");
const mobileLiquifyCancelButton = element<HTMLButtonElement>("mobileLiquifyCancel");
const desktopLiquifyApplyButton = element<HTMLButtonElement>("desktopLiquifyApply");
const mobileLiquifyApplyButton = element<HTMLButtonElement>("mobileLiquifyApply");
const rasterLiquifySizeInputs = [desktopLiquifySizeInput, mobileLiquifySizeInput] as const;
const rasterLiquifySizeOutputs = [desktopLiquifySizeOutput, mobileLiquifySizeOutput] as const;
const rasterLiquifyPressureInputs = [
  desktopLiquifyPressureInput,
  mobileLiquifyPressureInput,
] as const;
const rasterLiquifyPressureOutputs = [
  desktopLiquifyPressureOutput,
  mobileLiquifyPressureOutput,
] as const;
const rasterLiquifyDistortionInputs = [
  desktopLiquifyDistortionInput,
  mobileLiquifyDistortionInput,
] as const;
const rasterLiquifyDistortionOutputs = [
  desktopLiquifyDistortionOutput,
  mobileLiquifyDistortionOutput,
] as const;
const rasterLiquifyMomentumInputs = [
  desktopLiquifyMomentumInput,
  mobileLiquifyMomentumInput,
] as const;
const rasterLiquifyMomentumOutputs = [
  desktopLiquifyMomentumOutput,
  mobileLiquifyMomentumOutput,
] as const;
const rasterLiquifyAmountInputs = [desktopLiquifyAmountInput, mobileLiquifyAmountInput] as const;
const rasterLiquifyAmountOutputs = [desktopLiquifyAmountOutput, mobileLiquifyAmountOutput] as const;
const rasterLiquifyStatuses = [desktopLiquifyStatus, mobileLiquifyStatus] as const;
const rasterLiquifyResetButtons = [desktopLiquifyResetButton, mobileLiquifyResetButton] as const;
const rasterLiquifyCancelButtons = [desktopLiquifyCancelButton, mobileLiquifyCancelButton] as const;
const rasterLiquifyApplyButtons = [desktopLiquifyApplyButton, mobileLiquifyApplyButton] as const;
const rasterGaussianBlurSection = element<HTMLElement>("rasterGaussianBlurSection");
const desktopGaussianBlurOpenInput = element<HTMLInputElement>(
  "desktopGaussianBlurOpen",
);
const desktopGaussianBlurParameters = element<HTMLElement>(
  "desktopGaussianBlurParameters",
);
const desktopGaussianBlurRadiusInput = element<HTMLInputElement>(
  "desktopGaussianBlurRadius",
);
const desktopGaussianBlurRadiusOutput = element<HTMLOutputElement>(
  "desktopGaussianBlurRadiusOut",
);
const desktopGaussianBlurStatus = element<HTMLParagraphElement>(
  "desktopGaussianBlurStatus",
);
const desktopGaussianBlurCancelButton = element<HTMLButtonElement>(
  "desktopGaussianBlurCancel",
);
const desktopGaussianBlurApplyButton = element<HTMLButtonElement>(
  "desktopGaussianBlurApply",
);
const mobileGaussianBlurOpenButton = element<HTMLButtonElement>(
  "mobileGaussianBlurOpen",
);
const mobileGaussianBlurSheetElement = element<HTMLElement>(
  "mobileGaussianBlurSheet",
);
const mobileGaussianBlurRadiusInput = element<HTMLInputElement>(
  "mobileGaussianBlurRadius",
);
const mobileGaussianBlurRadiusOutput = element<HTMLOutputElement>(
  "mobileGaussianBlurRadiusOut",
);
const mobileGaussianBlurStatus = element<HTMLParagraphElement>(
  "mobileGaussianBlurStatus",
);
const mobileGaussianBlurCancelButton = element<HTMLButtonElement>(
  "mobileGaussianBlurCancel",
);
const mobileGaussianBlurApplyButton = element<HTMLButtonElement>(
  "mobileGaussianBlurApply",
);
const rasterGaussianBlurRadiusInputs = [
  desktopGaussianBlurRadiusInput,
  mobileGaussianBlurRadiusInput,
] as const;
const rasterGaussianBlurRadiusOutputs = [
  desktopGaussianBlurRadiusOutput,
  mobileGaussianBlurRadiusOutput,
] as const;
const rasterGaussianBlurStatuses = [
  desktopGaussianBlurStatus,
  mobileGaussianBlurStatus,
] as const;
const rasterGaussianBlurCancelButtons = [
  desktopGaussianBlurCancelButton,
  mobileGaussianBlurCancelButton,
] as const;
const rasterGaussianBlurApplyButtons = [
  desktopGaussianBlurApplyButton,
  mobileGaussianBlurApplyButton,
] as const;
const rasterMotionBlurSection = element<HTMLElement>("rasterMotionBlurSection");
const desktopMotionBlurOpenInput = element<HTMLInputElement>("desktopMotionBlurOpen");
const desktopMotionBlurParameters = element<HTMLElement>("desktopMotionBlurParameters");
const desktopMotionBlurDistanceInput = element<HTMLInputElement>("desktopMotionBlurDistance");
const desktopMotionBlurDistanceOutput = element<HTMLOutputElement>(
  "desktopMotionBlurDistanceOut",
);
const desktopMotionBlurAngleInput = element<HTMLInputElement>("desktopMotionBlurAngle");
const desktopMotionBlurAngleOutput = element<HTMLOutputElement>("desktopMotionBlurAngleOut");
const desktopMotionBlurStatus = element<HTMLParagraphElement>("desktopMotionBlurStatus");
const desktopMotionBlurCancelButton = element<HTMLButtonElement>("desktopMotionBlurCancel");
const desktopMotionBlurApplyButton = element<HTMLButtonElement>("desktopMotionBlurApply");
const mobileMotionBlurOpenButton = element<HTMLButtonElement>("mobileMotionBlurOpen");
const mobileMotionBlurSheetElement = element<HTMLElement>("mobileMotionBlurSheet");
const mobileMotionBlurDistanceInput = element<HTMLInputElement>("mobileMotionBlurDistance");
const mobileMotionBlurDistanceOutput = element<HTMLOutputElement>("mobileMotionBlurDistanceOut");
const mobileMotionBlurAngleInput = element<HTMLInputElement>("mobileMotionBlurAngle");
const mobileMotionBlurAngleOutput = element<HTMLOutputElement>("mobileMotionBlurAngleOut");
const mobileMotionBlurStatus = element<HTMLParagraphElement>("mobileMotionBlurStatus");
const mobileMotionBlurCancelButton = element<HTMLButtonElement>("mobileMotionBlurCancel");
const mobileMotionBlurApplyButton = element<HTMLButtonElement>("mobileMotionBlurApply");
const rasterMotionBlurDistanceInputs = [
  desktopMotionBlurDistanceInput,
  mobileMotionBlurDistanceInput,
] as const;
const rasterMotionBlurDistanceOutputs = [
  desktopMotionBlurDistanceOutput,
  mobileMotionBlurDistanceOutput,
] as const;
const rasterMotionBlurAngleInputs = [
  desktopMotionBlurAngleInput,
  mobileMotionBlurAngleInput,
] as const;
const rasterMotionBlurAngleOutputs = [
  desktopMotionBlurAngleOutput,
  mobileMotionBlurAngleOutput,
] as const;
const rasterMotionBlurStatuses = [
  desktopMotionBlurStatus,
  mobileMotionBlurStatus,
] as const;
const rasterMotionBlurCancelButtons = [
  desktopMotionBlurCancelButton,
  mobileMotionBlurCancelButton,
] as const;
const rasterMotionBlurApplyButtons = [
  desktopMotionBlurApplyButton,
  mobileMotionBlurApplyButton,
] as const;
const rasterNoiseSection = element<HTMLElement>("rasterNoiseSection");
const desktopNoiseOpenInput = element<HTMLInputElement>("desktopNoiseOpen");
const desktopNoiseParameters = element<HTMLElement>("desktopNoiseParameters");
const desktopNoiseAmountInput = element<HTMLInputElement>("desktopNoiseAmount");
const desktopNoiseAmountOutput = element<HTMLOutputElement>("desktopNoiseAmountOut");
const desktopNoiseStyleSelect = element<HTMLSelectElement>("desktopNoiseStyle");
const desktopNoiseScaleInput = element<HTMLInputElement>("desktopNoiseScale");
const desktopNoiseScaleOutput = element<HTMLOutputElement>("desktopNoiseScaleOut");
const desktopNoiseOctavesInput = element<HTMLInputElement>("desktopNoiseOctaves");
const desktopNoiseOctavesOutput = element<HTMLOutputElement>("desktopNoiseOctavesOut");
const desktopNoiseTurbulenceInput = element<HTMLInputElement>("desktopNoiseTurbulence");
const desktopNoiseTurbulenceOutput = element<HTMLOutputElement>(
  "desktopNoiseTurbulenceOut",
);
const desktopNoiseChannelsSelect = element<HTMLSelectElement>("desktopNoiseChannels");
const desktopNoiseAdditiveInput = element<HTMLInputElement>("desktopNoiseAdditive");
const desktopNoiseStatus = element<HTMLParagraphElement>("desktopNoiseStatus");
const desktopNoiseCancelButton = element<HTMLButtonElement>("desktopNoiseCancel");
const desktopNoiseApplyButton = element<HTMLButtonElement>("desktopNoiseApply");
const mobileNoiseOpenButton = element<HTMLButtonElement>("mobileNoiseOpen");
const mobileNoiseSheetElement = element<HTMLElement>("mobileNoiseSheet");
const mobileNoiseAmountInput = element<HTMLInputElement>("mobileNoiseAmount");
const mobileNoiseAmountOutput = element<HTMLOutputElement>("mobileNoiseAmountOut");
const mobileNoiseStyleSelect = element<HTMLSelectElement>("mobileNoiseStyle");
const mobileNoiseScaleInput = element<HTMLInputElement>("mobileNoiseScale");
const mobileNoiseScaleOutput = element<HTMLOutputElement>("mobileNoiseScaleOut");
const mobileNoiseOctavesInput = element<HTMLInputElement>("mobileNoiseOctaves");
const mobileNoiseOctavesOutput = element<HTMLOutputElement>("mobileNoiseOctavesOut");
const mobileNoiseTurbulenceInput = element<HTMLInputElement>("mobileNoiseTurbulence");
const mobileNoiseTurbulenceOutput = element<HTMLOutputElement>("mobileNoiseTurbulenceOut");
const mobileNoiseChannelsSelect = element<HTMLSelectElement>("mobileNoiseChannels");
const mobileNoiseAdditiveInput = element<HTMLInputElement>("mobileNoiseAdditive");
const mobileNoiseStatus = element<HTMLParagraphElement>("mobileNoiseStatus");
const mobileNoiseCancelButton = element<HTMLButtonElement>("mobileNoiseCancel");
const mobileNoiseApplyButton = element<HTMLButtonElement>("mobileNoiseApply");
const rasterNoiseAmountInputs = [desktopNoiseAmountInput, mobileNoiseAmountInput] as const;
const rasterNoiseAmountOutputs = [desktopNoiseAmountOutput, mobileNoiseAmountOutput] as const;
const rasterNoiseStyleSelects = [desktopNoiseStyleSelect, mobileNoiseStyleSelect] as const;
const rasterNoiseScaleInputs = [desktopNoiseScaleInput, mobileNoiseScaleInput] as const;
const rasterNoiseScaleOutputs = [desktopNoiseScaleOutput, mobileNoiseScaleOutput] as const;
const rasterNoiseOctavesInputs = [desktopNoiseOctavesInput, mobileNoiseOctavesInput] as const;
const rasterNoiseOctavesOutputs = [
  desktopNoiseOctavesOutput,
  mobileNoiseOctavesOutput,
] as const;
const rasterNoiseTurbulenceInputs = [
  desktopNoiseTurbulenceInput,
  mobileNoiseTurbulenceInput,
] as const;
const rasterNoiseTurbulenceOutputs = [
  desktopNoiseTurbulenceOutput,
  mobileNoiseTurbulenceOutput,
] as const;
const rasterNoiseChannelsSelects = [
  desktopNoiseChannelsSelect,
  mobileNoiseChannelsSelect,
] as const;
const rasterNoiseAdditiveInputs = [desktopNoiseAdditiveInput, mobileNoiseAdditiveInput] as const;
const rasterNoiseStatuses = [desktopNoiseStatus, mobileNoiseStatus] as const;
const rasterNoiseCancelButtons = [desktopNoiseCancelButton, mobileNoiseCancelButton] as const;
const rasterNoiseApplyButtons = [desktopNoiseApplyButton, mobileNoiseApplyButton] as const;
const mobileToolSettingsButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-mobile-tool-sheet]"),
);
// La superficie editor moderna e' unica su telefono, tablet e desktop. Il
// nome `mobileUiMediaQuery` resta temporaneamente per non duplicare i controller
// dei fogli esistenti, ma la query e' intenzionalmente sempre vera: solo il CSS
// decide se gli stessi controlli entrano dal basso o dal lato. La classe del
// dispositivo e la taglia 2K/4K restano invece autorevoli in `engine-limits`.
const mobileUiMediaQuery = window.matchMedia("(min-width: 0px)");
const MOBILE_DOUBLE_TAP_ZOOM_INTERVAL_MS = 350;
const MOBILE_DOUBLE_TAP_ZOOM_DISTANCE_PX = 32;
for (const input of rasterGaussianBlurRadiusInputs) {
  input.min = "1";
  input.max = String(DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS);
  input.step = String(DESTRUCTIVE_GAUSSIAN_BLUR_RADIUS_STEP);
  input.value = String(DESTRUCTIVE_GAUSSIAN_BLUR_DEFAULT_RADIUS);
}
for (const output of rasterGaussianBlurRadiusOutputs) {
  output.value = `${DESTRUCTIVE_GAUSSIAN_BLUR_DEFAULT_RADIUS} px`;
}
for (const input of rasterMotionBlurDistanceInputs) {
  input.min = "0";
  input.max = String(DESTRUCTIVE_MOTION_BLUR_MAX_DISTANCE);
  input.step = String(DESTRUCTIVE_MOTION_BLUR_DISTANCE_STEP);
  input.value = String(DESTRUCTIVE_MOTION_BLUR_DEFAULT_DISTANCE);
}
for (const output of rasterMotionBlurDistanceOutputs) {
  output.value = `${DESTRUCTIVE_MOTION_BLUR_DEFAULT_DISTANCE} px`;
}
for (const input of rasterMotionBlurAngleInputs) {
  input.min = String(DESTRUCTIVE_MOTION_BLUR_MIN_ANGLE);
  input.max = String(DESTRUCTIVE_MOTION_BLUR_MAX_ANGLE);
  input.step = "1";
  input.value = String(DESTRUCTIVE_MOTION_BLUR_DEFAULT_ANGLE);
}
for (const output of rasterMotionBlurAngleOutputs) {
  output.value = `${DESTRUCTIVE_MOTION_BLUR_DEFAULT_ANGLE}°`;
}
for (const input of rasterNoiseAmountInputs) {
  input.min = "0";
  input.max = String(DESTRUCTIVE_RASTER_NOISE_MAX_AMOUNT_PERCENT);
  input.step = String(DESTRUCTIVE_RASTER_NOISE_AMOUNT_STEP);
  input.value = String(DEFAULT_RASTER_NOISE_SETTINGS.amountPercent);
}
for (const input of [
  ...rasterNoiseScaleInputs,
  ...rasterNoiseOctavesInputs,
  ...rasterNoiseTurbulenceInputs,
]) {
  input.min = "0";
  input.max = "100";
  input.step = "1";
}
syncRasterNoiseSettings(DEFAULT_RASTER_NOISE_SETTINGS);
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
const copyAppDiagnosticsButton = element<HTMLButtonElement>("copyAppDiagnostics");
const appDiagnosticsCopyStatus = element<HTMLOutputElement>(
  "appDiagnosticsCopyStatus",
);
const appDiagnosticsDetails = element<HTMLDetailsElement>("appDiagnosticsDetails");
const appDiagnosticsReport = element<HTMLElement>("appDiagnosticsReport");
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
const layerMergeTestParameter = pageSearchParams.get("layerMergeTest");
const layerMergeTestRequested = import.meta.env.DEV
  && (
    layerMergeTestParameter === "raster"
    || layerMergeTestParameter === "clipping"
    || layerMergeTestParameter === "mixed"
    || layerMergeTestParameter === "memory"
    || layerMergeTestParameter === "reject"
  )
  ? layerMergeTestParameter
  : null;
const layerMemoryStressTestRequested =
  pageSearchParams.get("layerMemoryStressTest") === "1";
const mixedMemoryBenchmarkRequested =
  pageSearchParams.get("mixedMemoryBenchmark") === "1";
const vectorZoomStressRequested =
  pageSearchParams.get("vectorZoomStress") === "1";
const vectorZoomRefreshParameter = pageSearchParams.get("vectorZoomRefresh");
const vectorZoomCoverageRequested = vectorZoomStressRequested
  && vectorZoomRefreshParameter === "coverage";
const vectorZoomRefreshMode = vectorZoomStressRequested
  && (vectorZoomRefreshParameter === "during" || vectorZoomRefreshParameter === "release")
  ? vectorZoomRefreshParameter
  : null;
const vectorZoomAbRequested = vectorZoomRefreshMode !== null;
const vectorZoomHashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
const vectorZoomRunCodeParameter = (
  pageSearchParams.get("vectorZoomRun")
  ?? vectorZoomHashParams.get("zoomRun")
  ?? ""
).toUpperCase();
const vectorZoomRunCode = vectorZoomCoverageRequested
  ? /^[2-9A-HJ-NP-Z]{8}$/.test(vectorZoomRunCodeParameter)
    ? vectorZoomRunCodeParameter
    : makeVectorZoomRunCode()
  : null;
const mixedMemoryBenchmarkTargetMiB =
  pageSearchParams.get("mixedMemoryTargetMiB") === "600" ? 600 : 800;
const layerCompressionStudyRequested =
  pageSearchParams.get("layerCompressionTest") === "1";
const iphoneMemoryLimitTestRequested =
  pageSearchParams.get("iphoneMemoryLimitTest") === "1";
const layerMemoryFixtureRequested =
  layerMemoryStressTestRequested
  || iphoneMemoryLimitTestRequested
  || mixedMemoryBenchmarkRequested
  || vectorZoomStressRequested;
const appleMobileMemoryLifecycle =
  /iPhone|iPad|iPod/i.test(navigator.userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const layerColdCompressionMode = pageSearchParams.get("layerCompressionRuntime");
// Attiva di default: il codec segue ormai il formato del documento e il
// cancello decide da solo quando vale la pena, quindi non c'e' piu' niente da
// tenere dietro a un flag. `?layerCompressionRuntime=0` la spegne, e resta
// l'unico modo di misurare un prima/dopo sullo stesso build.
const layerColdCompressionRequested = layerColdCompressionMode !== "0";
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
} else if (vectorZoomCoverageRequested) {
  layerMemoryStressIntro.textContent =
    "Variante C isolata: 10 testi distribuiti, cache GPU nitida più copertura larga con overscan, "
    + "zoom-out rapido da 800% a 30% e nessun ridisegno vettoriale durante il gesto. "
    + `Il report verrà salvato nel progetto con codice ${vectorZoomRunCode}.`;
  layerMemoryStressButton.hidden = true;
  layerMemoryStressResult.textContent = "Preparazione automatica della variante C…";
} else if (vectorZoomAbRequested) {
  const variant = vectorZoomRefreshMode === "during" ? "A" : "B";
  layerMemoryStressIntro.textContent =
    `Variante ${variant} isolata su 10 testi semantici a 64× e 180 frame di pan. `
    + (variant === "A"
      ? "Il vettoriale esatto viene aggiornato anche durante il gesto."
      : "Durante il gesto resta soltanto la reproiezione GPU; il vettoriale esatto torna al rilascio.");
  layerMemoryStressButton.hidden = true;
  layerMemoryStressResult.textContent = `Preparazione automatica della variante ${variant}…`;
} else if (vectorZoomStressRequested) {
  layerMemoryStressIntro.textContent =
    "Stress isolato e deterministico: 10 testi semantici con Arch, Drop Shadow, "
    + "Block Shadow e Inner Shadow, zoom centrato fino a 64× e recovery vettoriale esatto.";
  layerMemoryStressButton.hidden = true;
  layerMemoryStressResult.textContent = "Preparazione automatica dello stress zoom…";
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
let vectorTextInitializationPromise: Promise<MixedVectorTextController> | null = null;
let mobileBrushStudio: MobileBrushStudioController | null = null;
let mobileStrokeSheet: MobileStrokeSheetController | null = null;
let mobileRasterEffectsSheet: MobileRasterEffectsSheetController | null = null;
let mobileToolSettingsSheet: MobileToolSettingsSheetController | null = null;
let mobileGaussianBlurSheet: MobileGaussianBlurSheetController | null = null;
let mobileMotionBlurSheet: MobileMotionBlurSheetController | null = null;
let mobileNoiseSheet: MobileNoiseSheetController | null = null;
let mobileLiquifySheet: MobileLiquifySheetController | null = null;
type RasterLiquifySurface = "desktop" | "mobile";
let rasterLiquifyUiBusy = false;
let rasterLiquifySessionOpen = false;
let rasterLiquifyPreviewFault = false;
let rasterLiquifyCancelPending = false;
let rasterLiquifySurface: RasterLiquifySurface | null = null;
let rasterLiquifyReturnFocus: HTMLElement | null = null;
let rasterLiquifyReturnTool: CanvasTool | null = null;
let rasterLiquifySettings: LiquifySettings = { ...DEFAULT_LIQUIFY_SETTINGS };
let rasterLiquifyAmount = 1;
type RasterGaussianBlurSurface = "desktop" | "mobile";
let rasterGaussianBlurUiBusy = false;
let rasterGaussianBlurSessionOpen = false;
let rasterGaussianBlurPreviewFault = false;
let rasterGaussianBlurCancelPending = false;
let rasterGaussianBlurSurface: RasterGaussianBlurSurface | null = null;
let rasterGaussianBlurReturnFocus: HTMLElement | null = null;
type RasterMotionBlurSurface = "desktop" | "mobile";
let rasterMotionBlurUiBusy = false;
let rasterMotionBlurSessionOpen = false;
let rasterMotionBlurPreviewFault = false;
let rasterMotionBlurCancelPending = false;
let rasterMotionBlurSurface: RasterMotionBlurSurface | null = null;
let rasterMotionBlurReturnFocus: HTMLElement | null = null;
type RasterNoiseSurface = "desktop" | "mobile";
let rasterNoiseUiBusy = false;
let rasterNoiseSessionOpen = false;
let rasterNoisePreviewFault = false;
let rasterNoiseCancelPending = false;
let rasterNoiseSurface: RasterNoiseSurface | null = null;
let rasterNoiseReturnFocus: HTMLElement | null = null;
const appDiagnosticLog = new BoundedAppDiagnosticLog();
let appDiagnosticHistorySignature = "";
let appDiagnosticSceneSignature = "";
let appDiagnosticsCopyBusy = false;
markStartupPhase(
  "Creazione del motore",
  "Preparazione dello stato dell’editor prima di aprire WebGPU.",
);
const engine = new BrushEngine(canvas, {
  onStatus(message, kind) {
    statusElement.textContent = message;
    statusElement.className = `status ${kind === "working" ? "" : kind}`;
    if (kind === "error") {
      appDiagnosticLog.record({
        category: "status",
        name: "engine-status-error",
        detail: message,
      });
    }
    if (rasterGaussianBlurSessionOpen && message.includes("Gaussian Blur")) {
      setRasterGaussianBlurStatus(message);
      if (kind === "error") rasterGaussianBlurPreviewFault = true;
      syncRasterGaussianBlurUi();
    }
    if (rasterMotionBlurSessionOpen && message.includes("Motion Blur")) {
      setRasterMotionBlurStatus(message);
      if (kind === "error") rasterMotionBlurPreviewFault = true;
      syncRasterMotionBlurUi();
    }
    if (rasterNoiseSessionOpen && message.includes("Noise")) {
      setRasterNoiseStatus(message);
      if (kind === "error") rasterNoisePreviewFault = true;
      syncRasterNoiseUi();
    }
    if (rasterLiquifySessionOpen && message.includes("Liquify")) {
      setRasterLiquifyStatus(message);
      if (kind === "error") rasterLiquifyPreviewFault = true;
      syncRasterLiquifyUi();
    }
  },
  onStats(stats) {
    updateStats(stats);
    if (mobileBrushControlDrag) scheduleMobileBrushPreview();
    mobileBrushStudio?.notifyEngineUpdate();
  },
  onHistoryChange(state) {
    const diagnosticSignature = [
      state.cursor,
      state.actionCount,
      state.inconsistent,
      state.openEdit ?? "none",
    ].join("|");
    if (diagnosticSignature !== appDiagnosticHistorySignature) {
      appDiagnosticHistorySignature = diagnosticSignature;
      appDiagnosticLog.record({
        category: "history",
        name: state.inconsistent ? "history-inconsistent" : "history-state",
        detail: JSON.stringify({
          cursor: state.cursor,
          actionCount: state.actionCount,
          busy: state.busy,
          inconsistent: state.inconsistent,
          openEdit: state.openEdit,
          undoBlockedReason: state.undoBlockedReason,
          redoBlockedReason: state.redoBlockedReason,
        }),
      });
    }
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
    const diagnosticSignature = `${snapshot.selectedKey}|`
      + snapshot.items.map((item) => item.key).join(",");
    if (diagnosticSignature !== appDiagnosticSceneSignature) {
      appDiagnosticSceneSignature = diagnosticSignature;
      appDiagnosticLog.record({
        category: "scene",
        name: "mixed-scene-state",
        detail: JSON.stringify({
          selectedKey: snapshot.selectedKey,
          activeRasterLayerId: snapshot.activeRasterLayerId,
          bottomUpKeys: snapshot.items.map((item) => item.key),
        }),
      });
    }
    requestMobileLayersRefresh();
    vectorTextPrototype?.syncScene(snapshot);
    mobileToolSettingsSheet?.syncOpenState();
    syncMobileToolsMenuState(snapshot);
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
  // Le notifiche restano su richiesta esplicita: ora che la compressione gira
  // sempre, annunciare ogni livello compresso sarebbe rumore, non informazione.
  // Il pannello memoria mostra comunque lo stato di ogni livello in tempo reale.
  layerColdCompressionStatusEnabled: layerColdCompressionMode === "1",
  layerColdDirectHotHydrationEnabled,
  layerColdAdjacentPrefetchEnabled,
}, rasterSelectionOverlayCanvas);
window.addEventListener("error", (event) => {
  appDiagnosticLog.record({
    category: "error",
    name: "window-error",
    detail: event.filename
      ? `${event.filename}:${event.lineno}:${event.colno}`
      : null,
    error: event.error ?? new Error(event.message || "Errore globale senza messaggio."),
  });
});
window.addEventListener("unhandledrejection", (event) => {
  appDiagnosticLog.record({
    category: "error",
    name: "unhandled-promise-rejection",
    error: event.reason,
  });
});
// BrushEngine possiede il default autorevole RGBA16F. La UI si limita a
// rifletterlo: nessun override locale (mobile o desktop) puo' divergere dal
// formato realmente usato per creare livelli, storia e compositori.
layerFormatSelect.value = engine.layerFormat;
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
let layerSwitching = false;
let rasterColorOverlayChanging = false;
let rasterStrokeChanging = false;
let historyUiBusy = false;
let rasterBevelChanging = false;
let rasterOuterShadowChanging = false;
let rasterInnerShadowChanging = false;
let engineInitialized = false;
let statsPollingTimer: number | null = null;
let statsPollingFaultReported = false;
let selectionUiBusy = false;
let controlsPanelOpen = true;
// Statistiche arrivate mentre il pannello era chiuso: il ridisegno si recupera
// alla riapertura invece di pagarlo ad ogni frame.
let controlsPanelStatsDirty = false;
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
type MobileBrushLibraryBrushId =
  | "m1m4-pencil-v1"
  | "current"
  | BrushStudioCustomBrushId;
const restoredMobileBrushLibraryState = loadBrushStudioLibraryState();
let mobileCustomBrushes: BrushStudioCustomBrush[] = [
  ...(restoredMobileBrushLibraryState?.customBrushes ?? []),
];
for (const brush of mobileCustomBrushes) ensureMobileCustomBrushCard(brush);
const restoredMobileBrushLibraryCandidate =
  restoredMobileBrushLibraryState?.activeBrushId;
const restoredMobileBrushLibraryBrushId: MobileBrushLibraryBrushId =
  restoredMobileBrushLibraryCandidate === PENCIL_BRUSH_PRESET.id
  || restoredMobileBrushLibraryCandidate === "current"
  || mobileCustomBrushes.some((brush) => brush.id === restoredMobileBrushLibraryCandidate)
    ? restoredMobileBrushLibraryCandidate as MobileBrushLibraryBrushId
    : "current";
let mobileBrushLibraryOpen = false;
let mobileBrushLibraryCategory: MobileBrushLibraryCategory =
  restoredMobileBrushLibraryBrushId === PENCIL_BRUSH_PRESET.id ? "pencil" : "painting";
let activeMobileBrushLibraryBrushId: MobileBrushLibraryBrushId =
  restoredMobileBrushLibraryBrushId;
let mobileBrushLibraryTransferBusy = false;
syncMobileBrushLibraryAddState();
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
let mobileBrushLibraryScrollTimer: number | null = null;
let mobileBrushLibraryPreviewDirty = true;
let mobileBrushLibraryPreviewRevision = 0;
const authoritativeBrushStrokePreviewRenderer =
  new AuthoritativeBrushStrokePreviewRenderer(engine);
const mobileBrushLibraryPreviewRenderer = new MobileBrushLibraryPreviewRenderer(
  authoritativeBrushStrokePreviewRenderer,
);
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
type MobileMixedSceneLayerKey = MixedSceneItem["key"];
let mobileLayerMultiSelectEnabled = false;
const mobileLayerMultiSelectedKeys = new Set<MobileMixedSceneLayerKey>();
interface MobileLayerReorderGesture {
  readonly pointerId: number;
  readonly key: MobileMixedSceneLayerKey;
  readonly name: string;
  readonly row: HTMLElement;
  readonly select: HTMLButtonElement;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly startTime: number;
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
type MobileBrushControlKind = "size" | "opacity" | "stretch" | "paint" | "blur";
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
const mobileRasterThumbnailCache =
  new BoundedMobileRasterThumbnailCache<MobileRasterThumbnailCacheEntry>();
let mobileLayerThumbnailRevision = 0;
let mobileSemanticThumbnailFontRevision = 0;
let mobileLayerThumbnailCaptureTimer: number | null = null;
let mobileLayerThumbnailCaptureRequested = false;
let mobileLayerThumbnailCaptureInFlight = false;
let mobileLayerThumbnailCaptureUnavailable = false;
let gpuMemoryPanelOpen = false;
let gpuMemoryPanelStatsDirty = false;
let previousGpuMemoryTotalMiB: number | null = null;
let gpuMemoryDeltaTimer: number | null = null;
type CanvasTool = BrushSettings["tool"] | "fill" | "selection" | "transform" | "liquify";
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
    && previousCanvasTool !== "liquify"
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
  const liquify = tool === "liquify";
  if (!selection) cancelKeyboardSelectionGesture(true);
  if (!fill && !selection && !transform && !liquify) {
    activeBrushTool = tool;
  }
  setControlValue("brushTool", tool);
  const blend = tool === "blend";
  const size = element<HTMLInputElement>("brushSize");
  const spacing = element<HTMLInputElement>("spacing");
  size.min = "1";
  size.max = "1000";
  spacing.min = blend ? "1" : "0.25";
  spacing.max = blend ? "400" : "99";
  spacing.step = blend ? "1" : "0.25";
  if (
    restoreSnapshot
    && !fill
    && !selection
    && !transform
    && !liquify
    && previousBrushTool !== tool
  ) {
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
    element<HTMLElement>(id).hidden = blend || fill || selection || transform || liquify;
  }
  for (const id of [
    "brushShapeControl",
    "brushSizeControl",
    "spacingControl",
    "flowControl",
    "grainSection",
    "renderingModeMemoryHint",
  ]) {
    element<HTMLElement>(id).hidden = fill || selection || transform || liquify;
  }
  element<HTMLElement>("hardnessControl").hidden = !blend || fill || selection || transform || liquify;
  element<HTMLElement>("brushColorControl").hidden = selection || transform || liquify;
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
    || activeCanvasTool === "liquify"
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
  if (open && controlsPanelStatsDirty) {
    controlsPanelStatsDirty = false;
    updateStats(engine.getStats());
  }
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
  if (kind === "paint") return mobileBrushPaintControl;
  return mobileBrushBlurControl;
}

function mobileBrushControlTrack(kind: MobileBrushControlKind): HTMLElement {
  if (kind === "size") return mobileBrushSizeTrack;
  if (kind === "opacity") return mobileBrushOpacityTrack;
  if (kind === "stretch") return mobileBrushStretchTrack;
  if (kind === "paint") return mobileBrushPaintTrack;
  return mobileBrushBlurTrack;
}

function mobileBrushControlInput(kind: MobileBrushControlKind): HTMLInputElement {
  return element<HTMLInputElement>(
    kind === "size"
      ? "brushSize"
      : kind === "opacity"
        ? "opacity"
        : kind === "stretch"
          ? "blendStretch"
          : kind === "paint"
            ? "blendPaint"
            : "blendBlur",
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
  if (kind === "paint") return `Paint ${Math.round(value)}%`;
  return `Blur ${Math.round(value)}%`;
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
  if (kind === "stretch" || kind === "paint" || kind === "blur") return;
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
  syncMobileBrushControlVisual("blur");
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
    [mobileBrushBlurControl, blendControlDisabled],
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
    || mobileLiquifySheet?.isOpen === true
    || mobileGaussianBlurSheet?.isOpen === true
    || mobileMotionBlurSheet?.isOpen === true
    || mobileNoiseSheet?.isOpen === true
    || mobileToolSettingsSheet?.isOpen === true
    || mobileBrushStudio?.isOpen === true;
  if (suppressed && mobileBrushControlDrag) {
    finishMobileBrushControlDrag(true);
  }
  mobileBrushControls.classList.toggle("is-suppressed", suppressed);
  mobileBrushControls.classList.toggle("is-blend", blend);
  mobileBrushControls.setAttribute(
    "aria-label",
    blend ? "Blend size, stretch, paint and blur" : "Brush size and opacity",
  );
  mobileBrushOpacityTrack.hidden = blend;
  mobileBrushStretchTrack.hidden = !blend;
  mobileBrushPaintTrack.hidden = !blend;
  mobileBrushBlurTrack.hidden = !blend;
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

function isMobileBrushLibraryBrushId(value: string): value is MobileBrushLibraryBrushId {
  return value === PENCIL_BRUSH_PRESET.id
    || value === "current"
    || (isBrushStudioCustomBrushId(value)
      && mobileCustomBrushes.some((brush) => brush.id === value));
}

function ensureMobileCustomBrushCard(
  brush: BrushStudioCustomBrush,
): HTMLButtonElement {
  const existing = mobileBrushLibraryCards.find(
    (card) => card.dataset.mobileBrushId === brush.id,
  );
  if (existing) {
    const name = existing.querySelector<HTMLElement>(".mobile-brush-card-name");
    if (name) name.textContent = brush.name;
    return existing;
  }

  const card = document.createElement("button");
  card.className = "mobile-brush-card";
  card.type = "button";
  card.dataset.mobileBrushId = brush.id;
  card.dataset.mobileBrushCategoryCard = "painting";
  card.setAttribute("aria-label", brush.name);
  card.setAttribute("aria-pressed", "false");

  const selected = document.createElement("span");
  selected.className = "mobile-brush-card-selected";
  selected.setAttribute("aria-hidden", "true");
  selected.append(createLucideElement(Check, { width: 16, height: 16 }));

  const name = document.createElement("span");
  name.className = "mobile-brush-card-name";
  name.textContent = brush.name;

  const canvas = document.createElement("canvas");
  canvas.className = "mobile-brush-card-preview";
  canvas.width = 240;
  canvas.height = 56;
  canvas.setAttribute("aria-hidden", "true");

  card.append(selected, name, canvas);
  mobileBrushLibraryCards.push(card);
  mobileBrushLibraryList.append(card);
  return card;
}

function syncMobileBrushLibraryAddState(): void {
  const full = mobileCustomBrushes.length >= BRUSH_STUDIO_MAX_CUSTOM_BRUSHES;
  const canExport = isBrushStudioCustomBrushId(activeMobileBrushLibraryBrushId)
    && loadBrushStudioSavedBrush(activeMobileBrushLibraryBrushId) !== null;
  mobileBrushLibraryAddButton.disabled = full || mobileBrushLibraryTransferBusy;
  mobileBrushLibraryImportButton.disabled = full || mobileBrushLibraryTransferBusy;
  mobileBrushLibraryExportButton.disabled = mobileBrushLibraryTransferBusy;
  mobileBrushLibraryExportButton.setAttribute(
    "aria-disabled",
    String(!canExport || mobileBrushLibraryTransferBusy),
  );
  mobileBrushLibrarySheet.setAttribute(
    "aria-busy",
    String(mobileBrushLibraryTransferBusy),
  );
  mobileBrushLibraryList.inert = mobileBrushLibraryTransferBusy;
  mobileBrushLibraryAddButton.title = full
    ? `Maximum ${BRUSH_STUDIO_MAX_CUSTOM_BRUSHES} custom brushes reached`
    : "New brush";
  mobileBrushLibraryImportButton.title = full
    ? `Maximum ${BRUSH_STUDIO_MAX_CUSTOM_BRUSHES} custom brushes reached`
    : "Import brush";
  mobileBrushLibraryExportButton.title = canExport
    ? "Export selected brush"
    : "Select a saved custom brush to export";
  if (mobileBrushLibraryTransferBusy) return;
  if (
    canExport
    && mobileBrushLibraryStatus.dataset.kind === "export-unavailable"
  ) {
    delete mobileBrushLibraryStatus.dataset.kind;
    mobileBrushLibraryStatus.textContent = "";
    mobileBrushLibraryStatus.hidden = true;
  }
  if (
    full
    && (!mobileBrushLibraryStatus.dataset.kind
      || mobileBrushLibraryStatus.dataset.kind === "capacity")
  ) {
    mobileBrushLibraryStatus.dataset.kind = "capacity";
    mobileBrushLibraryStatus.textContent =
      `Maximum ${BRUSH_STUDIO_MAX_CUSTOM_BRUSHES} custom brushes reached.`;
    mobileBrushLibraryStatus.hidden = false;
  } else if (mobileBrushLibraryStatus.dataset.kind === "capacity") {
    delete mobileBrushLibraryStatus.dataset.kind;
    mobileBrushLibraryStatus.textContent = "";
    mobileBrushLibraryStatus.hidden = true;
  }
}

function reportMobileBrushLibraryStatus(
  message: string,
  kind: "ok" | "error" | "working" | "export-unavailable",
): void {
  mobileBrushLibraryStatus.dataset.kind = kind;
  mobileBrushLibraryStatus.textContent = message;
  mobileBrushLibraryStatus.hidden = !message;
}

function mobileBrushLibraryCanvasForBrush(
  brushId: MobileBrushLibraryBrushId,
): HTMLCanvasElement {
  const card = mobileBrushLibraryCards.find(
    (candidate) => candidate.dataset.mobileBrushId === brushId,
  );
  const canvas = card?.querySelector<HTMLCanvasElement>(".mobile-brush-card-preview");
  if (!canvas) throw new Error(`Brush preview canvas unavailable for ${brushId}.`);
  return canvas;
}

function mobileBrushLibraryVisibleBrushIds(): MobileBrushLibraryBrushId[] {
  const visible = [activeMobileBrushLibraryBrushId];
  const viewport = mobileBrushLibraryBrushes.getBoundingClientRect();
  const preloadMargin = 80;
  for (const card of mobileBrushLibraryCards) {
    const brushId = card.dataset.mobileBrushId as MobileBrushLibraryBrushId | undefined;
    const bounds = card.getBoundingClientRect();
    if (
      brushId
      && brushId !== activeMobileBrushLibraryBrushId
      && card.dataset.mobileBrushCategoryCard === mobileBrushLibraryCategory
      && bounds.bottom >= viewport.top - preloadMargin
      && bounds.top <= viewport.bottom + preloadMargin
    ) {
      visible.push(brushId);
    }
  }
  return visible;
}

async function mobileBrushLibrarySettingsForBrush(
  brushId: MobileBrushLibraryBrushId,
  currentSettings: Readonly<BrushSettings>,
): Promise<BrushSettings> {
  const previewIsActive = brushId === activeMobileBrushLibraryBrushId;
  const fallbackSettings = brushId === PENCIL_BRUSH_PRESET.id
    ? resolveBrushPresetSettings(PENCIL_BRUSH_PRESET, currentSettings)
    : mobileCurrentBrushFallback(currentSettings);
  if (previewIsActive) return { ...currentSettings };
  if (!mobileBrushStudio) return fallbackSettings;
  const snapshot = mobileBrushStudio.settingsSnapshot(brushId, fallbackSettings);
  if (mobileBrushLibraryPreviewRenderer.hasCompletePreview(
    brushId,
    mobileBrushLibraryCanvasForBrush(brushId),
    snapshot,
  )) {
    return snapshot;
  }
  return mobileBrushStudio.resolveBrushSettings(brushId, fallbackSettings);
}

function renderMobileBrushLibraryPreview(): void {
  if (!mobileBrushLibraryOpen || !mobileUiMediaQuery.matches) return;
  const currentSettings = engine.getSettings();
  const previewBrushIds = mobileBrushLibraryVisibleBrushIds();
  const revision = mobileBrushLibraryPreviewRevision;
  mobileBrushLibraryPreviewDirty = false;
  void (async () => {
    for (const brushId of previewBrushIds) {
      if (
        !mobileBrushLibraryOpen
        || !mobileUiMediaQuery.matches
        || revision !== mobileBrushLibraryPreviewRevision
      ) {
        return;
      }
      let settings: BrushSettings;
      try {
        settings = await mobileBrushLibrarySettingsForBrush(
          brushId,
          currentSettings,
        );
      } catch {
        // Keep this card retryable without blocking the remaining previews.
        continue;
      }
      if (
        !mobileBrushLibraryOpen
        || !mobileUiMediaQuery.matches
        || revision !== mobileBrushLibraryPreviewRevision
      ) {
        if (brushId !== activeMobileBrushLibraryBrushId) {
          await mobileBrushStudio?.releasePreviewAssets(brushId, settings);
        }
        return;
      }
      await mobileBrushLibraryPreviewRenderer.render(
        brushId,
        mobileBrushLibraryCanvasForBrush(brushId),
        settings,
      );
      if (brushId !== activeMobileBrushLibraryBrushId) {
        await mobileBrushStudio?.releasePreviewAssets(brushId, settings);
      }
    }
  })()
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
  if (mobileBrushLibraryCategory !== category) {
    mobileBrushLibraryPreviewDirty = true;
    mobileBrushLibraryPreviewRevision += 1;
  }
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
  if (
    open
    && (
      rasterLiquifySurface === "mobile"
      || rasterGaussianBlurSurface === "mobile"
      || rasterMotionBlurSurface === "mobile"
      || rasterNoiseSurface === "mobile"
    )
  ) return;
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
  mobileBrushLibraryPreviewDirty = true;
  mobileBrushLibraryPreviewRevision += 1;
  for (const card of mobileBrushLibraryCards) {
    const preview = card.querySelector<HTMLCanvasElement>(".mobile-brush-card-preview");
    if (preview) authoritativeBrushStrokePreviewRenderer.invalidate(preview);
  }
  if (mobileBrushLibraryPreviewFrame !== null) {
    cancelAnimationFrame(mobileBrushLibraryPreviewFrame);
    mobileBrushLibraryPreviewFrame = null;
  }
  if (mobileBrushLibraryScrollTimer !== null) {
    window.clearTimeout(mobileBrushLibraryScrollTimer);
    mobileBrushLibraryScrollTimer = null;
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

function selectedMobileVectorItem(
  snapshot = engineInitialized ? engine.getMixedSceneSnapshot() : null,
) {
  const selected = snapshot?.items.find((item) => item.key === snapshot.selectedKey);
  return selected?.kind === "text" || selected?.kind === "svg" ? selected : null;
}

function selectedMobileTextNode() {
  const selected = selectedMobileVectorItem();
  return selected?.kind === "text" ? selected.textNode : null;
}

function selectedMobileSvgNode() {
  const selected = selectedMobileVectorItem();
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

function mobileLayerPrimaryKey(stats: EngineStats): MobileMixedSceneLayerKey | null {
  const sceneKey = stats.mixedScene?.selectedKey ?? null;
  if (sceneKey) return sceneKey;
  const active = stats.layers[stats.activeLayerIndex];
  return active ? `raster:${active.id}` : null;
}

function mobileLayerMergeSelectionItems(
  stats: EngineStats,
): MobileLayerMergeSelectionItem<MobileMixedSceneLayerKey>[] {
  // Engine scene/layer arrays are bottom-up. Keep that order for the merge
  // callback even though `mobileLayerViews()` reverses it for the visual list.
  const scene = stats.mixedScene;
  if (!scene) {
    return stats.layers.map((layer) => ({
      key: `raster:${layer.id}`,
      clippingParentKey: layer.clippingParentId === null
        ? null
        : `raster:${layer.clippingParentId}`,
    }));
  }
  return scene.items.map((item) => ({
    key: item.key,
    clippingParentKey: item.kind === "raster" && item.rasterClippingParentId !== null
      ? `raster:${item.rasterClippingParentId}`
      : null,
  }));
}

function currentMobileLayerMergePlan(
  stats: EngineStats = engine.getStats(),
): MobileLayerMergeSelectionPlan<MobileMixedSceneLayerKey> {
  return buildMobileLayerMergeSelectionPlan(
    mobileLayerMergeSelectionItems(stats),
    mobileLayerMultiSelectedKeys,
  );
}

function mobileLayerMergeController(): MixedVectorTextController | null {
  return vectorTextPrototype;
}

function mobileLayerMergeUnsupportedReason(
  plan: MobileLayerMergeSelectionPlan<MobileMixedSceneLayerKey>,
  stats: EngineStats = engine.getStats(),
): string | null {
  if (!plan.valid) return plan.reason;
  const scene = stats.mixedScene;
  if (
    scene
    && scene.items.some((item) => (
      plan.orderedKeys.includes(item.key) && item.kind === "image"
    ))
  ) {
    return "Questa versione non può ancora unire livelli immagine.";
  }
  return null;
}

function mobileLayerMergeUnavailableReason(
  plan: MobileLayerMergeSelectionPlan<MobileMixedSceneLayerKey>,
  controller: MixedVectorTextController | null = mobileLayerMergeController(),
): string | null {
  return mobileLayerMergeUnsupportedReason(plan)
    ?? (controller === null
      ? "Unione non disponibile: il controller dei livelli non è ancora pronto."
      : null);
}

function setMobileLayerMergeStatus(message: string | null, failed = false): void {
  mobileLayerMergeStatus.textContent = message ?? "";
  mobileLayerMergeStatus.hidden = message === null;
  mobileLayerMergeStatus.classList.toggle("is-error", failed && message !== null);
}

function reconcileMobileLayerMultiSelection(stats: EngineStats): void {
  if (!mobileLayerMultiSelectEnabled) return;
  const liveKeys = new Set(
    mobileLayerMergeSelectionItems(stats).map((item) => item.key),
  );
  for (const key of mobileLayerMultiSelectedKeys) {
    if (!liveKeys.has(key)) mobileLayerMultiSelectedKeys.delete(key);
  }
  if (mobileLayerMultiSelectedKeys.size > 0) return;
  const primaryKey = mobileLayerPrimaryKey(stats);
  if (primaryKey) mobileLayerMultiSelectedKeys.add(primaryKey);
}

function setMobileLayerMultiSelectEnabled(
  enabled: boolean,
  announce = true,
): void {
  if (enabled === mobileLayerMultiSelectEnabled) return;
  closeMobileLayerContextMenu(false);
  cancelMobileLayerReorderGesture(false, false, false);
  mobileLayerMultiSelectEnabled = enabled;
  mobileLayerMultiSelectedKeys.clear();
  if (enabled && engineInitialized) {
    const primaryKey = mobileLayerPrimaryKey(engine.getStats());
    if (primaryKey) mobileLayerMultiSelectedKeys.add(primaryKey);
  }
  mobileLayersPanel.classList.toggle("is-multi-select", enabled);
  mobileLayerMultiActions.hidden = !enabled;
  if (!enabled) mobileLayerMergeSelectionButton.disabled = true;
  mobileLayerMultiSelectButton.setAttribute("aria-pressed", String(enabled));
  mobileLayerMultiSelectButton.setAttribute(
    "aria-label",
    enabled ? "Stop selecting multiple layers" : "Select multiple layers",
  );
  mobileLayerMultiSelectButton.title = enabled
    ? "Done selecting layers"
    : "Select multiple layers";
  mobileLayersRenderSignature = "";
  setMobileLayerMergeStatus(null);
  scheduleMobileLayersRefresh();
  if (announce) {
    announceMobileLayerReorder(enabled
      ? "Multiple selection on. Select adjacent layers to merge."
      : "Multiple selection off.");
  }
}

function toggleMobileLayerMultiSelection(key: MobileMixedSceneLayerKey): void {
  if (!mobileLayerMultiSelectEnabled) return;
  if (mobileLayerMultiSelectedKeys.has(key)) {
    if (mobileLayerMultiSelectedKeys.size === 1) {
      announceMobileLayerReorder("Keep at least one layer selected.");
      return;
    }
    mobileLayerMultiSelectedKeys.delete(key);
  } else {
    mobileLayerMultiSelectedKeys.add(key);
  }
  const count = mobileLayerMultiSelectedKeys.size;
  setMobileLayerMergeStatus(null);
  announceMobileLayerReorder(`${count} ${count === 1 ? "layer" : "layers"} selected.`);
  mobileLayersRenderSignature = "";
  scheduleMobileLayersRefresh();
}

function focusFirstMobileLayerContextAction(): void {
  if (mobileLayerMultiSelectEnabled) {
    (mobileLayerMergeButton.disabled
      ? mobileLayerContextMenu
      : mobileLayerMergeButton).focus({ preventScroll: true });
    return;
  }
  (mobileLayerClippingButton.hidden || mobileLayerClippingButton.disabled
    ? mobileLayerOptionsButton
    : mobileLayerClippingButton).focus({ preventScroll: true });
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
  if (
    !properties
    || properties.locked
    || !row.matches(".is-selected, .is-multi-selected")
  ) return false;
  mobileLayerContextKey = key;
  mobileLayerContextMenu.dataset.layerKey = key;
  mobileLayerClippingButton.hidden = mobileLayerMultiSelectEnabled
    || properties.kind !== "raster";
  mobileLayerClippingButton.disabled = properties.kind !== "raster"
    || !properties.clippingAvailable;
  mobileLayerClippingButton.setAttribute(
    "aria-checked",
    String(properties.clippingEnabled),
  );
  mobileLayerClippingButton.textContent = properties.clippingEnabled
    ? "Disable Clipping Mask"
    : "Clipping Mask";
  mobileLayerOptionsButton.hidden = mobileLayerMultiSelectEnabled;
  mobileLayerOptionsButton.disabled = mobileLayerMultiSelectEnabled;
  mobileLayerDeleteButton.hidden = mobileLayerMultiSelectEnabled;
  mobileLayerMergeButton.hidden = !mobileLayerMultiSelectEnabled;
  mobileLayerMergeReason.hidden = true;
  mobileLayerMergeReason.textContent = "";
  if (mobileLayerMultiSelectEnabled) {
    const plan = currentMobileLayerMergePlan();
    const controller = mobileLayerMergeController();
    const unavailableReason = mobileLayerMergeUnavailableReason(plan, controller);
    mobileLayerMergeButton.disabled = unavailableReason !== null;
    mobileLayerMergeButton.title = unavailableReason ?? "Unisci i livelli selezionati";
    if (unavailableReason) {
      mobileLayerMergeReason.textContent = unavailableReason;
      mobileLayerMergeReason.hidden = false;
    }
  } else {
    mobileLayerMergeButton.disabled = true;
    mobileLayerMergeButton.title = "";
  }
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

function syncMobileToolsMenuState(
  sceneSnapshot = engineInitialized ? engine.getMixedSceneSnapshot() : null,
): void {
  const selectedItem = selectedMobileVectorItem(sceneSnapshot);
  const selectedText = selectedItem?.kind === "text" ? selectedItem.textNode : null;
  const selectedSvg = selectedItem?.kind === "svg" ? selectedItem.svgNode : null;
  const selectedEffectNode = selectedText ?? selectedSvg;
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
    const textEditor = kind === "text" || kind === "text-warp";
    const vectorEffectEditor = kind === "text-outline"
      || kind === "text-drop-shadow"
      || kind === "text-inner-shadow"
      || kind === "text-block-shadow";
    button.disabled = !engineInitialized
      || interactionLocked()
      || ((textEditor || vectorEffectEditor) && vectorTextPrototype === null)
      || (kind === "text-warp" && selectedText === null)
      || (vectorEffectEditor && selectedEffectNode === null)
      || (svgEditor && (vectorTextPrototype === null || selectedSvg === null));
    if (svgEditor) {
      button.setAttribute("aria-pressed", String(selectedSvg !== null));
      continue;
    }
    if (!textEditor && !vectorEffectEditor) continue;
    const pressed = kind === "text"
      ? selectedText !== null
      : kind === "text-warp"
        ? selectedText?.transformType !== undefined && selectedText.transformType !== "none"
        : kind === "text-outline"
          ? (selectedEffectNode?.outlineWidth ?? 0) > 0
          : kind === "text-drop-shadow"
            ? selectedEffectNode?.singleShadowEnabled === true
            : kind === "text-inner-shadow"
              ? selectedEffectNode?.innerShadowEnabled === true
              : selectedEffectNode?.blockShadowEnabled === true;
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
  syncRasterGaussianBlurUi();
  syncRasterMotionBlurUi();
  syncRasterNoiseUi();
  syncRasterLiquifyUi();
}

const LIQUIFY_MODE_LABELS: Readonly<Record<LiquifyMode, string>> = Object.freeze({
  push: "Push",
  "twirl-right": "Twirl Right",
  "twirl-left": "Twirl Left",
  pinch: "Pinch",
  expand: "Expand",
  crystals: "Crystals",
  edge: "Edge",
  reconstruct: "Reconstruct",
});
syncRasterLiquifySettings(rasterLiquifySettings, rasterLiquifyAmount);

function rasterLiquifyEligibilityError(): string | null {
  if (!engineInitialized) return "Liquify sarà disponibile dopo l’inizializzazione.";
  if (rasterGaussianBlurSurface !== null) return "Applica o annulla Gaussian Blur prima.";
  if (rasterMotionBlurSurface !== null) return "Applica o annulla Motion Blur prima.";
  if (rasterNoiseSurface !== null) return "Applica o annulla Noise prima.";
  if (engine.getPixelSelectionState().selectedPixels > 0) {
    return "Deseleziona i pixel per deformare l’intero livello.";
  }
  const stats = engine.getStats();
  const active = stats.layers.find((layer) => layer.id === stats.activeLayerId);
  if (!active?.hasContent) return "Il livello raster selezionato è vuoto.";
  const selected = stats.mixedScene?.items.find(
    (item) => item.key === stats.mixedScene?.selectedKey,
  );
  if (selected?.kind !== "raster" || selected.rasterLayerId !== stats.activeLayerId) {
    return "Seleziona un livello raster per usare Liquify.";
  }
  if (layerSwitching || interactionLocked()) {
    return "Termina l’operazione corrente prima di aprire Liquify.";
  }
  return null;
}

function rasterLiquifySettingsFromSurface(
  surface: RasterLiquifySurface,
): LiquifySettings {
  const mobile = surface === "mobile";
  return normalizeLiquifySettings({
    mode: rasterLiquifySettings.mode,
    size: Number((mobile ? mobileLiquifySizeInput : desktopLiquifySizeInput).value),
    pressure: Number(
      (mobile ? mobileLiquifyPressureInput : desktopLiquifyPressureInput).value,
    ) / 100,
    distortion: Number(
      (mobile ? mobileLiquifyDistortionInput : desktopLiquifyDistortionInput).value,
    ) / 100,
    momentum: Number(
      (mobile ? mobileLiquifyMomentumInput : desktopLiquifyMomentumInput).value,
    ) / 100,
  }, rasterLiquifySettings);
}

function syncRasterLiquifySettings(
  settings: Readonly<LiquifySettings>,
  amount = rasterLiquifyAmount,
): void {
  rasterLiquifySettings = normalizeLiquifySettings(settings, rasterLiquifySettings);
  rasterLiquifyAmount = Math.min(1, Math.max(0, Number.isFinite(amount) ? amount : 1));
  const size = Math.round(rasterLiquifySettings.size);
  const pressure = Math.round(rasterLiquifySettings.pressure * 100);
  const distortion = Math.round(rasterLiquifySettings.distortion * 100);
  const momentum = Math.round(rasterLiquifySettings.momentum * 100);
  const amountPercent = Math.round(rasterLiquifyAmount * 100);
  for (const input of rasterLiquifySizeInputs) {
    input.value = String(size);
    input.setAttribute("aria-valuetext", `${size} pixels`);
  }
  for (const output of rasterLiquifySizeOutputs) output.value = `${size} px`;
  for (const input of rasterLiquifyPressureInputs) input.value = String(pressure);
  for (const output of rasterLiquifyPressureOutputs) output.value = `${pressure}%`;
  for (const input of rasterLiquifyDistortionInputs) input.value = String(distortion);
  for (const output of rasterLiquifyDistortionOutputs) output.value = `${distortion}%`;
  for (const input of rasterLiquifyMomentumInputs) input.value = String(momentum);
  for (const output of rasterLiquifyMomentumOutputs) output.value = `${momentum}%`;
  for (const input of rasterLiquifyAmountInputs) input.value = String(amountPercent);
  for (const output of rasterLiquifyAmountOutputs) output.value = `${amountPercent}%`;
  for (const button of liquifyModeButtons) {
    const selected = button.dataset.liquifyMode === rasterLiquifySettings.mode;
    button.setAttribute("aria-checked", String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  mobileLiquifyModeLabel.value = LIQUIFY_MODE_LABELS[rasterLiquifySettings.mode];
}

function setRasterLiquifyStatus(message: string): void {
  for (const status of rasterLiquifyStatuses) status.textContent = message;
}

function reportRasterLiquifyError(prefix: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const fullMessage = `${prefix}: ${message}`;
  setRasterLiquifyStatus(fullMessage);
  statusElement.textContent = fullMessage;
  statusElement.className = "status error";
}

function syncRasterLiquifyUi(): void {
  const workbenchOpen = rasterLiquifySurface !== null;
  const eligibilityError = workbenchOpen || rasterLiquifySessionOpen || rasterLiquifyUiBusy
    ? "Liquify è già aperto."
    : rasterLiquifyEligibilityError();
  const recoveryOnly = rasterLiquifyPreviewFault || historyState.inconsistent;
  const controlsDisabled = rasterLiquifyUiBusy
    || !rasterLiquifySessionOpen
    || recoveryOnly;
  const modeControls = liquifyModeControls(rasterLiquifySettings.mode);

  desktopLiquifyOpenInput.checked = rasterLiquifySurface === "desktop";
  desktopLiquifyOpenInput.disabled = rasterLiquifySurface === "desktop"
    ? rasterLiquifyUiBusy
    : eligibilityError !== null;
  desktopLiquifyOpenInput.title = rasterLiquifySurface === "desktop"
    ? "Disattiva per annullare Liquify"
    : eligibilityError ?? "Apri Liquify";
  desktopLiquifyOpenInput.setAttribute(
    "aria-expanded",
    String(rasterLiquifySurface === "desktop"),
  );
  desktopLiquifyParameters.hidden = rasterLiquifySurface !== "desktop";

  mobileLiquifyOpenButton.disabled = eligibilityError !== null;
  mobileLiquifyOpenButton.title = eligibilityError ?? "Apri Liquify";
  mobileLiquifyOpenButton.setAttribute(
    "aria-pressed",
    String(rasterLiquifySurface === "mobile"),
  );
  for (const button of liquifyModeButtons) button.disabled = controlsDisabled;
  for (const input of rasterLiquifySizeInputs) input.disabled = controlsDisabled;
  for (const input of rasterLiquifyPressureInputs) input.disabled = controlsDisabled;
  for (const input of rasterLiquifyDistortionInputs) {
    input.disabled = controlsDisabled || !modeControls.distortion;
  }
  for (const input of rasterLiquifyMomentumInputs) {
    input.disabled = controlsDisabled || !modeControls.momentum;
  }
  for (const input of rasterLiquifyAmountInputs) input.disabled = controlsDisabled;
  for (const button of rasterLiquifyApplyButtons) button.disabled = controlsDisabled;
  const recoveryActionDisabled = rasterLiquifyUiBusy || !rasterLiquifySessionOpen;
  for (const button of rasterLiquifyCancelButtons) {
    button.disabled = recoveryActionDisabled;
  }
  for (const button of rasterLiquifyResetButtons) {
    button.disabled = recoveryActionDisabled || historyState.inconsistent;
  }

  const state = rasterLiquifyUiBusy
    ? "busy"
    : recoveryOnly
      ? "recovery"
      : rasterLiquifySessionOpen
        ? "preview"
        : "closed";
  rasterLiquifySection.dataset.state = state;
  rasterLiquifySection.setAttribute("aria-busy", String(rasterLiquifyUiBusy));
  mobileLiquifySheetElement.dataset.state = state;
  mobileLiquifySheetElement.setAttribute("aria-busy", String(rasterLiquifyUiBusy));
  canvas.classList.toggle("liquify-active", rasterLiquifySessionOpen);
}

function restoreRasterLiquifyTool(): void {
  const requested = rasterLiquifyReturnTool;
  rasterLiquifyReturnTool = null;
  const tool = requested && requested !== "liquify" ? requested : activeBrushTool;
  configureBrushToolUi(tool, true);
  if (tool === "paint" || tool === "blend") applyBrushControls();
  else updateControlOutputs();
}

function closeRasterLiquifyWorkbench(result: "apply" | "cancel" | "error"): void {
  const surface = rasterLiquifySurface;
  rasterLiquifySurface = null;
  rasterLiquifyCancelPending = false;
  desktopLiquifyOpenInput.checked = false;
  desktopLiquifyOpenInput.setAttribute("aria-expanded", "false");
  desktopLiquifyParameters.hidden = true;
  mobileLiquifyOpenButton.setAttribute("aria-pressed", "false");
  if (surface === "mobile") mobileLiquifySheet?.close(false);
  canvas.classList.remove("liquify-active", "liquify-deforming");
  restoreRasterLiquifyTool();
  const returnFocus = rasterLiquifyReturnFocus;
  rasterLiquifyReturnFocus = null;
  if (returnFocus?.isConnected) {
    queueMicrotask(() => returnFocus.focus({ preventScroll: true }));
  }
  if (result !== "error") setRasterLiquifyStatus("Liquify pronto.");
  syncRasterLiquifyUi();
  syncRasterGaussianBlurUi();
  syncRasterMotionBlurUi();
  syncRasterNoiseUi();
}

async function openRasterLiquifyWorkbench(
  surface: RasterLiquifySurface,
  trigger: HTMLElement,
): Promise<void> {
  const eligibilityError = rasterLiquifyEligibilityError();
  if (eligibilityError || rasterLiquifySurface !== null) {
    setControlValue("brushTool", activeCanvasTool);
    if (eligibilityError) {
      statusElement.textContent = eligibilityError;
      statusElement.className = "status error";
    }
    syncRasterLiquifyUi();
    return;
  }
  if (surface === "mobile" && !mobileLiquifySheet?.open(trigger)) return;

  rasterLiquifySurface = surface;
  rasterLiquifyReturnFocus = trigger;
  rasterLiquifyReturnTool = activeCanvasTool === "liquify"
    ? activeBrushTool
    : activeCanvasTool;
  rasterLiquifySessionOpen = false;
  rasterLiquifyPreviewFault = false;
  rasterLiquifyUiBusy = true;
  setRasterLiquifyStatus("Preparazione Liquify…");
  syncRasterLiquifyUi();
  syncRasterGaussianBlurUi();
  syncRasterMotionBlurUi();
  syncRasterNoiseUi();

  try {
    const requested = rasterLiquifySettingsFromSurface(surface);
    const preview = await engine.beginRasterLiquify(requested);
    if (!preview) throw new Error("Seleziona un livello raster per usare Liquify.");
    rasterLiquifySessionOpen = true;
    syncRasterLiquifySettings(preview.settings, preview.amount);
    configureBrushToolUi("liquify", false);
    setRasterLiquifyStatus(
      `${LIQUIFY_MODE_LABELS[preview.settings.mode]} · trascina sul canvas.`,
    );
  } catch (error) {
    historyState = engine.getHistoryState();
    rasterLiquifySessionOpen = historyState.openEdit === "liquify";
    rasterLiquifyPreviewFault = rasterLiquifySessionOpen;
    reportRasterLiquifyError("Impossibile aprire Liquify", error);
    if (!rasterLiquifySessionOpen) closeRasterLiquifyWorkbench("error");
  } finally {
    rasterLiquifyUiBusy = false;
    historyState = engine.getHistoryState();
    updateHistoryControls();
    if (rasterLiquifyCancelPending && rasterLiquifySessionOpen) {
      rasterLiquifyCancelPending = false;
      void cancelRasterLiquifyFromUi();
    }
  }
}

function updateRasterLiquifyFromUi(surface: RasterLiquifySurface): void {
  const requested = rasterLiquifySettingsFromSurface(surface);
  syncRasterLiquifySettings(requested, rasterLiquifyAmount);
  if (
    !rasterLiquifySessionOpen
    || rasterLiquifyUiBusy
    || rasterLiquifyPreviewFault
  ) return;
  try {
    const preview = engine.updateRasterLiquifySettings(requested);
    syncRasterLiquifySettings(preview.settings, preview.amount);
    setRasterLiquifyStatus(`${LIQUIFY_MODE_LABELS[preview.settings.mode]} attivo.`);
  } catch (error) {
    rasterLiquifyPreviewFault = true;
    reportRasterLiquifyError("Anteprima Liquify interrotta", error);
  }
  syncRasterLiquifyUi();
}

function updateRasterLiquifyAmountFromUi(amountPercent: number): void {
  const normalized = Math.min(1, Math.max(0, amountPercent / 100));
  syncRasterLiquifySettings(rasterLiquifySettings, normalized);
  if (
    !rasterLiquifySessionOpen
    || rasterLiquifyUiBusy
    || rasterLiquifyPreviewFault
  ) return;
  try {
    const preview = engine.setRasterLiquifyAmount(normalized);
    syncRasterLiquifySettings(preview.settings, preview.amount);
  } catch (error) {
    rasterLiquifyPreviewFault = true;
    reportRasterLiquifyError("Adjust Amount interrotto", error);
  }
  syncRasterLiquifyUi();
}

async function resetRasterLiquifyFromUi(): Promise<void> {
  if (rasterLiquifyUiBusy || !rasterLiquifySessionOpen || historyState.inconsistent) return;
  rasterLiquifyUiBusy = true;
  setRasterLiquifyStatus("Ripristino della deformazione…");
  syncRasterLiquifyUi();
  try {
    await engine.resetRasterLiquify();
    rasterLiquifyPreviewFault = false;
    setRasterLiquifyStatus("Deformazione azzerata; Liquify resta attivo.");
  } catch (error) {
    historyState = engine.getHistoryState();
    rasterLiquifyPreviewFault = true;
    reportRasterLiquifyError("Reset Liquify non riuscito", error);
  } finally {
    rasterLiquifyUiBusy = false;
    historyState = engine.getHistoryState();
    updateHistoryControls();
  }
}

async function cancelRasterLiquifyFromUi(): Promise<void> {
  if (rasterLiquifyUiBusy) {
    rasterLiquifyCancelPending = true;
    return;
  }
  if (!rasterLiquifySessionOpen) return;
  rasterLiquifyCancelPending = false;
  rasterLiquifyUiBusy = true;
  engine.endRasterLiquifyStroke(false);
  setRasterLiquifyStatus("Ripristino dei pixel originali…");
  syncRasterLiquifyUi();
  try {
    await engine.cancelRasterLiquify();
    rasterLiquifySessionOpen = false;
    rasterLiquifyPreviewFault = false;
    closeRasterLiquifyWorkbench("cancel");
  } catch (error) {
    historyState = engine.getHistoryState();
    rasterLiquifySessionOpen = historyState.openEdit === "liquify";
    rasterLiquifyPreviewFault = true;
    reportRasterLiquifyError("Annullamento Liquify non riuscito", error);
  } finally {
    rasterLiquifyUiBusy = false;
    historyState = engine.getHistoryState();
    updateHistoryControls();
  }
}

async function applyRasterLiquifyFromUi(): Promise<void> {
  if (
    rasterLiquifyUiBusy
    || !rasterLiquifySessionOpen
    || rasterLiquifyPreviewFault
    || historyState.inconsistent
  ) return;
  rasterLiquifyUiBusy = true;
  engine.endRasterLiquifyStroke(false);
  setRasterLiquifyStatus("Applicazione Liquify…");
  syncRasterLiquifyUi();
  try {
    await engine.commitRasterLiquify();
    rasterLiquifySessionOpen = false;
    rasterLiquifyPreviewFault = false;
    closeRasterLiquifyWorkbench("apply");
    requestMobileLayerThumbnailCapture();
  } catch (error) {
    historyState = engine.getHistoryState();
    rasterLiquifySessionOpen = historyState.openEdit === "liquify";
    rasterLiquifyPreviewFault = rasterLiquifySessionOpen;
    reportRasterLiquifyError("Applicazione Liquify non riuscita", error);
    if (!rasterLiquifySessionOpen) closeRasterLiquifyWorkbench("error");
  } finally {
    rasterLiquifyUiBusy = false;
    historyState = engine.getHistoryState();
    updateHistoryControls();
  }
}

function rasterGaussianBlurEligibilityError(): string | null {
  if (!engineInitialized) return "Gaussian Blur sarà disponibile dopo l’inizializzazione.";
  if (rasterLiquifySurface !== null) return "Applica o annulla Liquify prima.";
  if (rasterMotionBlurSurface !== null) return "Applica o annulla Motion Blur prima.";
  if (rasterNoiseSurface !== null) return "Applica o annulla Noise prima.";
  if (engine.getPixelSelectionState().selectedPixels > 0) {
    return "Deseleziona i pixel per sfocare l’intero livello.";
  }
  const stats = engine.getStats();
  const active = stats.layers.find((layer) => layer.id === stats.activeLayerId);
  if (!active?.hasContent) return "Il livello raster selezionato è vuoto.";
  const scene = stats.mixedScene;
  if (scene) {
    const selected = scene.items.find((item) => item.key === scene.selectedKey);
    if (selected?.kind !== "raster" || selected.rasterLayerId !== stats.activeLayerId) {
      return "Seleziona un livello raster per usare Gaussian Blur.";
    }
  }
  if (layerSwitching || interactionLocked()) {
    return "Termina l’operazione corrente prima di aprire Gaussian Blur.";
  }
  return null;
}

function syncRasterGaussianBlurUi(): void {
  const workbenchOpen = rasterGaussianBlurSurface !== null;
  const eligibilityError = workbenchOpen
    || rasterGaussianBlurSessionOpen
    || rasterGaussianBlurUiBusy
    ? "Gaussian Blur è già aperto."
    : rasterGaussianBlurEligibilityError();
  const triggerDisabled = eligibilityError !== null;
  const recoveryOnly = rasterGaussianBlurPreviewFault || historyState.inconsistent;
  const controlsDisabled = rasterGaussianBlurUiBusy
    || !rasterGaussianBlurSessionOpen
    || recoveryOnly;

  desktopGaussianBlurOpenInput.checked = rasterGaussianBlurSurface === "desktop";
  desktopGaussianBlurOpenInput.disabled = rasterGaussianBlurSurface === "desktop"
    ? rasterGaussianBlurUiBusy
    : triggerDisabled;
  desktopGaussianBlurOpenInput.title = rasterGaussianBlurSurface === "desktop"
    ? "Disattiva per annullare Gaussian Blur"
    : eligibilityError ?? "Apri Gaussian Blur";
  desktopGaussianBlurOpenInput.setAttribute(
    "aria-expanded",
    String(rasterGaussianBlurSurface === "desktop"),
  );
  desktopGaussianBlurParameters.hidden = rasterGaussianBlurSurface !== "desktop";

  mobileGaussianBlurOpenButton.disabled = triggerDisabled;
  mobileGaussianBlurOpenButton.title = eligibilityError ?? "Apri Gaussian Blur";
  mobileGaussianBlurOpenButton.setAttribute(
    "aria-pressed",
    String(rasterGaussianBlurSurface === "mobile"),
  );

  for (const input of rasterGaussianBlurRadiusInputs) input.disabled = controlsDisabled;
  for (const button of rasterGaussianBlurApplyButtons) button.disabled = controlsDisabled;
  const cancelDisabled = rasterGaussianBlurUiBusy || !rasterGaussianBlurSessionOpen;
  for (const button of rasterGaussianBlurCancelButtons) button.disabled = cancelDisabled;

  const state = rasterGaussianBlurUiBusy
    ? "busy"
    : recoveryOnly
      ? "recovery"
      : rasterGaussianBlurSessionOpen
        ? "preview"
        : "closed";
  rasterGaussianBlurSection.dataset.state = state;
  rasterGaussianBlurSection.setAttribute("aria-busy", String(rasterGaussianBlurUiBusy));
  mobileGaussianBlurSheetElement.dataset.state = state;
  mobileGaussianBlurSheetElement.setAttribute(
    "aria-busy",
    String(rasterGaussianBlurUiBusy),
  );
}

function rasterMotionBlurEligibilityError(): string | null {
  if (!engineInitialized) return "Motion Blur sarà disponibile dopo l’inizializzazione.";
  if (rasterLiquifySurface !== null) return "Applica o annulla Liquify prima.";
  if (rasterGaussianBlurSurface !== null) return "Applica o annulla Gaussian Blur prima.";
  if (rasterNoiseSurface !== null) return "Applica o annulla Noise prima.";
  if (engine.getPixelSelectionState().selectedPixels > 0) {
    return "Deseleziona i pixel per sfocare l’intero livello.";
  }
  const stats = engine.getStats();
  const active = stats.layers.find((layer) => layer.id === stats.activeLayerId);
  if (!active?.hasContent) return "Il livello raster selezionato è vuoto.";
  const scene = stats.mixedScene;
  if (scene) {
    const selected = scene.items.find((item) => item.key === scene.selectedKey);
    if (selected?.kind !== "raster" || selected.rasterLayerId !== stats.activeLayerId) {
      return "Seleziona un livello raster per usare Motion Blur.";
    }
  }
  if (layerSwitching || interactionLocked()) {
    return "Termina l’operazione corrente prima di aprire Motion Blur.";
  }
  return null;
}

function syncRasterMotionBlurUi(): void {
  const workbenchOpen = rasterMotionBlurSurface !== null;
  const eligibilityError = workbenchOpen
    || rasterMotionBlurSessionOpen
    || rasterMotionBlurUiBusy
    ? "Motion Blur è già aperto."
    : rasterMotionBlurEligibilityError();
  const triggerDisabled = eligibilityError !== null;
  const recoveryOnly = rasterMotionBlurPreviewFault || historyState.inconsistent;
  const controlsDisabled = rasterMotionBlurUiBusy
    || !rasterMotionBlurSessionOpen
    || recoveryOnly;

  desktopMotionBlurOpenInput.checked = rasterMotionBlurSurface === "desktop";
  desktopMotionBlurOpenInput.disabled = rasterMotionBlurSurface === "desktop"
    ? rasterMotionBlurUiBusy
    : triggerDisabled;
  desktopMotionBlurOpenInput.title = rasterMotionBlurSurface === "desktop"
    ? "Disattiva per annullare Motion Blur"
    : eligibilityError ?? "Apri Motion Blur";
  desktopMotionBlurOpenInput.setAttribute(
    "aria-expanded",
    String(rasterMotionBlurSurface === "desktop"),
  );
  desktopMotionBlurParameters.hidden = rasterMotionBlurSurface !== "desktop";

  mobileMotionBlurOpenButton.disabled = triggerDisabled;
  mobileMotionBlurOpenButton.title = eligibilityError ?? "Apri Motion Blur";
  mobileMotionBlurOpenButton.setAttribute(
    "aria-pressed",
    String(rasterMotionBlurSurface === "mobile"),
  );

  for (const input of [
    ...rasterMotionBlurDistanceInputs,
    ...rasterMotionBlurAngleInputs,
  ]) input.disabled = controlsDisabled;
  for (const button of rasterMotionBlurApplyButtons) button.disabled = controlsDisabled;
  const cancelDisabled = rasterMotionBlurUiBusy || !rasterMotionBlurSessionOpen;
  for (const button of rasterMotionBlurCancelButtons) button.disabled = cancelDisabled;

  const state = rasterMotionBlurUiBusy
    ? "busy"
    : recoveryOnly
      ? "recovery"
      : rasterMotionBlurSessionOpen
        ? "preview"
        : "closed";
  rasterMotionBlurSection.dataset.state = state;
  rasterMotionBlurSection.setAttribute("aria-busy", String(rasterMotionBlurUiBusy));
  mobileMotionBlurSheetElement.dataset.state = state;
  mobileMotionBlurSheetElement.setAttribute(
    "aria-busy",
    String(rasterMotionBlurUiBusy),
  );
}

function rasterNoiseEligibilityError(): string | null {
  if (!engineInitialized) return "Noise sarà disponibile dopo l'inizializzazione.";
  if (rasterLiquifySurface !== null) return "Applica o annulla Liquify prima.";
  if (rasterGaussianBlurSurface !== null) return "Applica o annulla Gaussian Blur prima.";
  if (rasterMotionBlurSurface !== null) return "Applica o annulla Motion Blur prima.";
  if (engine.getPixelSelectionState().selectedPixels > 0) {
    return "Deseleziona i pixel per applicare Noise all'intero livello.";
  }
  const stats = engine.getStats();
  const active = stats.layers.find((layer) => layer.id === stats.activeLayerId);
  if (!active?.hasContent) return "Il livello raster selezionato è vuoto.";
  const scene = stats.mixedScene;
  if (scene) {
    const selected = scene.items.find((item) => item.key === scene.selectedKey);
    if (selected?.kind !== "raster" || selected.rasterLayerId !== stats.activeLayerId) {
      return "Seleziona un livello raster per usare Noise.";
    }
  }
  if (layerSwitching || interactionLocked()) {
    return "Termina l'operazione corrente prima di aprire Noise.";
  }
  return null;
}

function rasterNoiseSettingsFromSurface(
  surface: RasterNoiseSurface,
): RasterNoiseSettings {
  const amount = surface === "mobile" ? mobileNoiseAmountInput : desktopNoiseAmountInput;
  const scale = surface === "mobile" ? mobileNoiseScaleInput : desktopNoiseScaleInput;
  const octaves = surface === "mobile" ? mobileNoiseOctavesInput : desktopNoiseOctavesInput;
  const turbulence = surface === "mobile"
    ? mobileNoiseTurbulenceInput
    : desktopNoiseTurbulenceInput;
  const style = surface === "mobile" ? mobileNoiseStyleSelect : desktopNoiseStyleSelect;
  const channels = surface === "mobile"
    ? mobileNoiseChannelsSelect
    : desktopNoiseChannelsSelect;
  const additive = surface === "mobile" ? mobileNoiseAdditiveInput : desktopNoiseAdditiveInput;
  return {
    amountPercent: Number(amount.value),
    scalePercent: Number(scale.value),
    octavesPercent: Number(octaves.value),
    turbulencePercent: Number(turbulence.value),
    style: style.value as RasterNoiseStyle,
    channels: channels.value as RasterNoiseChannels,
    additive: additive.checked,
  };
}

function formatNoisePeriod(period: number): string {
  if (period >= 100) return period.toFixed(0);
  if (period >= 10) return period.toFixed(1).replace(/\.0$/, "");
  return period.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function syncRasterNoiseSettings(settings: Readonly<RasterNoiseSettings>): void {
  const amount = Math.round(settings.amountPercent);
  const amountLabel = amount > 100 ? `${amount}% · Extended` : `${amount}%`;
  for (const input of rasterNoiseAmountInputs) {
    input.value = String(settings.amountPercent);
    input.setAttribute("aria-valuetext", amountLabel);
  }
  for (const output of rasterNoiseAmountOutputs) output.value = amountLabel;
  for (const select of rasterNoiseStyleSelects) select.value = settings.style;
  for (const input of rasterNoiseScaleInputs) input.value = String(settings.scalePercent);
  const period = rasterNoisePeriodPixels(settings.scalePercent);
  const scaleLabel = `${Math.round(settings.scalePercent)}% · ${formatNoisePeriod(period)} px`;
  for (const output of rasterNoiseScaleOutputs) output.value = scaleLabel;
  for (const input of rasterNoiseOctavesInputs) input.value = String(settings.octavesPercent);
  const octaveLabel = rasterNoiseOctaveCount(settings.octavesPercent).toFixed(1);
  for (const output of rasterNoiseOctavesOutputs) output.value = octaveLabel;
  for (const input of rasterNoiseTurbulenceInputs) {
    input.value = String(settings.turbulencePercent);
  }
  for (const output of rasterNoiseTurbulenceOutputs) {
    output.value = `${Math.round(settings.turbulencePercent)}%`;
  }
  for (const select of rasterNoiseChannelsSelects) select.value = settings.channels;
  for (const input of rasterNoiseAdditiveInputs) input.checked = settings.additive;
}

function syncRasterNoiseUi(): void {
  const workbenchOpen = rasterNoiseSurface !== null;
  const eligibilityError = workbenchOpen || rasterNoiseSessionOpen || rasterNoiseUiBusy
    ? "Noise è già aperto."
    : rasterNoiseEligibilityError();
  const triggerDisabled = eligibilityError !== null;
  const recoveryOnly = rasterNoisePreviewFault || historyState.inconsistent;
  const controlsDisabled = rasterNoiseUiBusy || !rasterNoiseSessionOpen || recoveryOnly;

  desktopNoiseOpenInput.checked = rasterNoiseSurface === "desktop";
  desktopNoiseOpenInput.disabled = rasterNoiseSurface === "desktop"
    ? rasterNoiseUiBusy
    : triggerDisabled;
  desktopNoiseOpenInput.title = rasterNoiseSurface === "desktop"
    ? "Disattiva per annullare Noise"
    : eligibilityError ?? "Apri Noise";
  desktopNoiseOpenInput.setAttribute(
    "aria-expanded",
    String(rasterNoiseSurface === "desktop"),
  );
  desktopNoiseParameters.hidden = rasterNoiseSurface !== "desktop";

  mobileNoiseOpenButton.disabled = triggerDisabled;
  mobileNoiseOpenButton.title = eligibilityError ?? "Apri Noise";
  mobileNoiseOpenButton.setAttribute(
    "aria-pressed",
    String(rasterNoiseSurface === "mobile"),
  );

  for (const control of [
    ...rasterNoiseAmountInputs,
    ...rasterNoiseStyleSelects,
    ...rasterNoiseScaleInputs,
    ...rasterNoiseOctavesInputs,
    ...rasterNoiseTurbulenceInputs,
    ...rasterNoiseChannelsSelects,
    ...rasterNoiseAdditiveInputs,
  ]) {
    control.disabled = controlsDisabled;
  }
  for (const button of rasterNoiseApplyButtons) button.disabled = controlsDisabled;
  const cancelDisabled = rasterNoiseUiBusy || !rasterNoiseSessionOpen;
  for (const button of rasterNoiseCancelButtons) button.disabled = cancelDisabled;

  const state = rasterNoiseUiBusy
    ? "busy"
    : recoveryOnly
      ? "recovery"
      : rasterNoiseSessionOpen
        ? "preview"
        : "closed";
  rasterNoiseSection.dataset.state = state;
  rasterNoiseSection.setAttribute("aria-busy", String(rasterNoiseUiBusy));
  mobileNoiseSheetElement.dataset.state = state;
  mobileNoiseSheetElement.setAttribute("aria-busy", String(rasterNoiseUiBusy));
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
    || !gesture.row.matches(".is-selected, .is-multi-selected")
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
    mobileLayerMultiSelectEnabled
      ? `${gesture.name} selection actions open.`
      : `${gesture.name} options open. Keep dragging to move the layer.`,
  );
}

function activateMobileLayerReorderGesture(): void {
  const gesture = mobileLayerReorderGesture;
  if (!gesture || gesture.phase !== "armed") return;
  if (mobileLayerMultiSelectEnabled) {
    announceMobileLayerReorder("Layer options open for the current selection.");
    return;
  }
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
    recordAppDiagnosticOperation(
      "mixed-scene-reorder-failed",
      JSON.stringify({ key, targetTopFirstSlot }),
      error,
    );
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
  const row = select?.closest<HTMLElement>(
    ".mobile-layer-row.is-selected, .mobile-layer-row.is-multi-selected",
  );
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
    startTime: performance.now(),
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
    if (mobileLayerMultiSelectEnabled) {
      event.preventDefault();
      return;
    }
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
  if (
    gesture.phase === "pending"
    && mobileLayerReorderHoldReached(gesture.startTime, performance.now())
  ) {
    if (gesture.holdTimer !== null) window.clearTimeout(gesture.holdTimer);
    gesture.holdTimer = null;
    armMobileLayerContextGesture();
  }
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
      focusFirstMobileLayerContextAction();
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
    mobileLayerMultiSelectEnabled
    && event.altKey
    && (event.key === "ArrowUp" || event.key === "ArrowDown")
  ) {
    event.preventDefault();
    return;
  }
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
  const row = select?.closest<HTMLElement>(
    ".mobile-layer-row.is-selected, .mobile-layer-row.is-multi-selected",
  );
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
  if (
    open
    && (
      rasterLiquifySurface === "mobile"
      || rasterGaussianBlurSurface === "mobile"
      || rasterMotionBlurSurface === "mobile"
      || rasterNoiseSurface === "mobile"
    )
  ) return;
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
    setMobileLayerMultiSelectEnabled(false, false);
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
  if (
    open
    && (
      rasterLiquifySurface === "mobile"
      || rasterGaussianBlurSurface === "mobile"
      || rasterMotionBlurSurface === "mobile"
      || rasterNoiseSurface === "mobile"
    )
  ) return;
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
  if (open && gpuMemoryPanelStatsDirty) {
    gpuMemoryPanelStatsDirty = false;
    updateGpuMemoryPanel(engine.getStats());
  }
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
    blendBlur: rangeValue("blendBlur") / 100,
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
  element<HTMLOutputElement>("blendBlurOut").value = `${rangeValue("blendBlur").toFixed(0)}%`;
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
  const blendBlur = Number.isFinite(benchmark.settings.blendBlur)
    ? Math.min(1, Math.max(0, benchmark.settings.blendBlur))
    : 0;
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
      blendBlur,
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
  setBrushAssetControlValue("grainSource", settings.grainAssetId, "pencil-grain");
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
  setControlValue("blendBlur", (settings.blendBlur ?? 0) * 100);
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
  previewRenderer: authoritativeBrushStrokePreviewRenderer,
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
  onCommit: (brushId, brushName, _settings) => {
    const latestCustomBrushes = [
      ...(loadBrushStudioLibraryState()?.customBrushes ?? []),
    ];
    for (const localBrush of mobileCustomBrushes) {
      if (
        latestCustomBrushes.length < BRUSH_STUDIO_MAX_CUSTOM_BRUSHES
        && !latestCustomBrushes.some((brush) => brush.id === localBrush.id)
      ) {
        latestCustomBrushes.push(localBrush);
      }
    }
    let nextCustomBrushes = latestCustomBrushes;
    if (isBrushStudioCustomBrushId(brushId)) {
      const existing = latestCustomBrushes.find((brush) => brush.id === brushId);
      if (!existing && latestCustomBrushes.length >= BRUSH_STUDIO_MAX_CUSTOM_BRUSHES) {
        throw new Error(
          `Maximum ${BRUSH_STUDIO_MAX_CUSTOM_BRUSHES} custom brushes reached.`,
        );
      }
      const now = Date.now();
      const committed: BrushStudioCustomBrush = {
        id: brushId,
        name: brushName,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      nextCustomBrushes = existing
        ? latestCustomBrushes.map((brush) => brush.id === brushId ? committed : brush)
        : [...latestCustomBrushes, committed];
    }
    const committedBrushId: MobileBrushLibraryBrushId =
      brushId === PENCIL_BRUSH_PRESET.id
      || brushId === "current"
      || isBrushStudioCustomBrushId(brushId)
        ? brushId
        : "current";
    saveBrushStudioLibraryState(committedBrushId, nextCustomBrushes);
    mobileCustomBrushes = nextCustomBrushes;
  },
  onCommitted: (brushId, _brushName, _settings) => {
    const committedBrushId: MobileBrushLibraryBrushId =
      brushId === PENCIL_BRUSH_PRESET.id
      || brushId === "current"
      || isBrushStudioCustomBrushId(brushId)
        ? brushId
        : "current";
    for (const descriptor of mobileCustomBrushes) {
      ensureMobileCustomBrushCard(descriptor);
    }
    if (isBrushStudioCustomBrushId(committedBrushId)) {
      const descriptor = mobileCustomBrushes.find(
        (brush) => brush.id === committedBrushId,
      );
      if (descriptor) ensureMobileCustomBrushCard(descriptor);
    }
    activeMobileBrushLibraryBrushId = committedBrushId;
    syncMobileBrushLibraryAddState();
    setMobileBrushLibraryCategory(
      mobileBrushLibraryCategoryForBrush(activeMobileBrushLibraryBrushId),
    );
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

mobileLiquifySheet = new MobileLiquifySheetController({
  mobileMediaQuery: mobileUiMediaQuery,
  beforeOpen: () => {
    setMobileToolsSheetOpen(false);
    setMobileLayersPanelOpen(false);
    setMobileBrushLibraryOpen(false);
    mobileBrushStudio?.cancel(false);
    mobileStrokeSheet?.close(false);
    mobileRasterEffectsSheet?.close(false);
    mobileToolSettingsSheet?.close(false);
    setControlsPanelOpen(false);
  },
  onRequestCancel: () => {
    void cancelRasterLiquifyFromUi();
  },
  onOpenChange: () => {
    syncMobileToolsMenuState();
    syncMobileBrushControlsVisibility();
  },
});

mobileGaussianBlurSheet = new MobileGaussianBlurSheetController({
  mobileMediaQuery: mobileUiMediaQuery,
  beforeOpen: () => {
    setMobileToolsSheetOpen(false);
    setMobileLayersPanelOpen(false);
    setMobileBrushLibraryOpen(false);
    mobileBrushStudio?.cancel(false);
    mobileStrokeSheet?.close(false);
    mobileRasterEffectsSheet?.close(false);
    mobileToolSettingsSheet?.close(false);
    setControlsPanelOpen(false);
  },
  onRequestCancel: () => {
    void cancelRasterGaussianBlurFromUi();
  },
  onOpenChange: () => {
    syncMobileToolsMenuState();
    syncMobileBrushControlsVisibility();
  },
});

mobileMotionBlurSheet = new MobileMotionBlurSheetController({
  mobileMediaQuery: mobileUiMediaQuery,
  beforeOpen: () => {
    setMobileToolsSheetOpen(false);
    setMobileLayersPanelOpen(false);
    setMobileBrushLibraryOpen(false);
    mobileBrushStudio?.cancel(false);
    mobileStrokeSheet?.close(false);
    mobileRasterEffectsSheet?.close(false);
    mobileToolSettingsSheet?.close(false);
    setControlsPanelOpen(false);
  },
  onRequestCancel: () => {
    void cancelRasterMotionBlurFromUi();
  },
  onOpenChange: () => {
    syncMobileToolsMenuState();
    syncMobileBrushControlsVisibility();
  },
});

mobileNoiseSheet = new MobileNoiseSheetController({
  mobileMediaQuery: mobileUiMediaQuery,
  beforeOpen: () => {
    setMobileToolsSheetOpen(false);
    setMobileLayersPanelOpen(false);
    setMobileBrushLibraryOpen(false);
    mobileBrushStudio?.cancel(false);
    mobileStrokeSheet?.close(false);
    mobileRasterEffectsSheet?.close(false);
    mobileToolSettingsSheet?.close(false);
    setControlsPanelOpen(false);
  },
  onRequestCancel: () => {
    void cancelRasterNoiseFromUi();
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
  hasSelectedVectorEffectTarget: () => selectedMobileVectorItem() !== null,
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
  onClose: (kind) => {
    void finishMobileTransformToolOnSheetClose(kind);
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
  setControlValue("grainSource", "pencil-grain");
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
  setControlValue("blendBlur", 0);
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
    blendBlur: 0,
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
    blendBlur: 0,
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
  const grainLabel = grainMode === "texturized" ? "Grain Fixed" : "Grain Off";
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

function nonHistoryOperationLocked(allowDestructiveBlurEdit = false): boolean {
  return !engineInitialized
    || layerSwitching
    || mobileBrushControlDrag !== null
    || historyState.openEdit === "transform"
    || (!allowDestructiveBlurEdit && historyState.openEdit === "liquify")
    || (!allowDestructiveBlurEdit && historyState.openEdit === "gaussian-blur")
    || (!allowDestructiveBlurEdit && historyState.openEdit === "motion-blur")
    || (!allowDestructiveBlurEdit && historyState.openEdit === "noise")
    || historyState.openEdit === "raster-property"
    || benchmarkRunning
    || rasterShadowGoldenRunning
    || rasterStrokeGoldenRunning
    || effectsWorkbenchBenchmarkRunning
    || layerHistoryTestRunning
    || layerMemoryStressTestRunning
    || layerCompressionStudyRunning
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

function operationLocked(allowDestructiveBlurEdit = false): boolean {
  return nonHistoryOperationLocked(allowDestructiveBlurEdit)
    || historyUiBusy
    || historyState.busy;
}

function interactionLocked(): boolean {
  return operationLocked() || activePointerId !== null;
}

/**
 * Pan, zoom e rotazione non modificano i pixel e restano disponibili mentre
 * un filtro mostra la sua anteprima distruttiva. Il normale lock del
 * documento continua invece a proteggere pennello, livelli e cronologia.
 */
function canvasViewOperationLocked(): boolean {
  const allowDestructiveBlurEdit = (
    rasterLiquifySessionOpen
      && historyState.openEdit === "liquify"
      && !rasterLiquifyUiBusy
  ) || (
    rasterGaussianBlurSessionOpen
      && historyState.openEdit === "gaussian-blur"
      && !rasterGaussianBlurUiBusy
  ) || (
    rasterMotionBlurSessionOpen
      && historyState.openEdit === "motion-blur"
      && !rasterMotionBlurUiBusy
  ) || (
    rasterNoiseSessionOpen
      && historyState.openEdit === "noise"
      && !rasterNoiseUiBusy
  );
  return operationLocked(allowDestructiveBlurEdit && !historyState.inconsistent);
}

/**
 * Lucchetto per la sola scorciatoia di cronologia.
 *
 * `interactionLocked()` comprende `historyUiBusy` e `historyState.busy`, cioe'
 * e' vero **mentre un annullamento sta lavorando**. Usarlo qui significherebbe
 * scartare i tasti premuti durante il passo precedente: esattamente il difetto
 * che la coda esiste per risolvere. Accodare un altro passo di cronologia
 * mentre uno e' in corso e' legittimo — sara' il turno di esecuzione a
 * verificare che sia ancora possibile.
 */
function historyRequestLocked(): boolean {
  return nonHistoryOperationLocked() || activePointerId !== null;
}

function updateHistoryControls(): void {
  const locked = interactionLocked();
  const requestLocked = historyRequestLocked();
  const replayBusy = historyUiBusy || historyState.busy;
  const undoBlocked = requestLocked || (!replayBusy && !historyState.canUndo);
  const redoBlocked = requestLocked || (!replayBusy && !historyState.canRedo);
  const undoReason = requestLocked && historyState.undoBlockedReason === null
    ? "Termina l'operazione corrente prima di annullare."
    : replayBusy ? null : historyState.undoBlockedReason;
  const redoReason = requestLocked && historyState.redoBlockedReason === null
    ? "Termina l'operazione corrente prima di ripristinare."
    : replayBusy ? null : historyState.redoBlockedReason;

  // Durante un replay i due comandi restano premibili: ogni pressione viene
  // accodata e sara' validata quando arriva il suo turno. Fuori dal replay un
  // comando semanticamente bloccato resta comunque cliccabile per mostrare il
  // motivo (per esempio il pavimento di retention), invece di sembrare perso.
  undoStrokeButton.disabled = requestLocked;
  redoStrokeButton.disabled = requestLocked;
  mobileUndoButton.disabled = false;
  mobileRedoButton.disabled = false;
  for (const [button, blocked, reason, label, availableTitle] of [
    [undoStrokeButton, undoBlocked, undoReason, "Annulla ultima azione", "Annulla (Ctrl/⌘+Z)"],
    [redoStrokeButton, redoBlocked, redoReason, "Ripristina ultima azione", "Ripristina (Ctrl/⌘+Shift+Z)"],
    [mobileUndoButton, undoBlocked, undoReason, "Undo", "Undo"],
    [mobileRedoButton, redoBlocked, redoReason, "Redo", "Redo"],
  ] as const) {
    button.setAttribute("aria-disabled", String(blocked));
    button.classList.toggle("is-disabled", blocked);
    button.title = blocked && reason ? reason : availableTitle;
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
  // Il documento e' sempre RGBA16F: il controllo resta solo come indicatore
  // leggibile, non come una via di downgrade verso RGBA8.
  layerFormatSelect.disabled = true;
  const viewLocked = canvasViewOperationLocked() || activePointerId !== null;
  fitViewButton.disabled = viewLocked;
  zoomInButton.disabled = viewLocked;
  zoomOutButton.disabled = viewLocked;
  rotateViewLeftButton.disabled = viewLocked;
  viewRotationButton.disabled = viewLocked;
  rotateViewRightButton.disabled = viewLocked;
  toggleControlsButton.disabled =
    benchmarkRunning || rasterShadowGoldenRunning || rasterStrokeGoldenRunning
    || effectsWorkbenchBenchmarkRunning || layerHistoryTestRunning
    || layerMemoryStressTestRunning
    || layerCompressionStudyRunning
    || rasterGaussianBlurSessionOpen
    || rasterGaussianBlurUiBusy
    || rasterMotionBlurSessionOpen
    || rasterMotionBlurUiBusy
    || rasterNoiseSessionOpen
    || rasterNoiseUiBusy
    || rasterLiquifySessionOpen
    || rasterLiquifyUiBusy
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

function setRasterGaussianBlurRadiusOutput(radius: number): void {
  const value = `${Math.round(radius)} px`;
  for (const output of rasterGaussianBlurRadiusOutputs) output.value = value;
  for (const input of rasterGaussianBlurRadiusInputs) {
    input.value = String(Math.round(radius));
    input.setAttribute("aria-valuetext", `${Math.round(radius)} pixels`);
  }
}

function setRasterGaussianBlurStatus(message: string): void {
  for (const status of rasterGaussianBlurStatuses) status.textContent = message;
}

function resetRasterGaussianBlurControls(): void {
  setRasterGaussianBlurRadiusOutput(DESTRUCTIVE_GAUSSIAN_BLUR_DEFAULT_RADIUS);
  setRasterGaussianBlurStatus("Gaussian Blur pronto.");
}

function reportRasterGaussianBlurError(prefix: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const fullMessage = `${prefix}: ${message}`;
  setRasterGaussianBlurStatus(fullMessage);
  statusElement.textContent = fullMessage;
  statusElement.className = "status error";
}

function closeRasterGaussianBlurWorkbench(
  result: "apply" | "cancel" | "error",
): void {
  const surface = rasterGaussianBlurSurface;
  rasterGaussianBlurSurface = null;
  rasterGaussianBlurCancelPending = false;
  desktopGaussianBlurOpenInput.checked = false;
  desktopGaussianBlurOpenInput.setAttribute("aria-expanded", "false");
  desktopGaussianBlurParameters.hidden = true;
  mobileGaussianBlurOpenButton.setAttribute("aria-pressed", "false");
  if (surface === "mobile") mobileGaussianBlurSheet?.close(false);
  const returnFocus = rasterGaussianBlurReturnFocus;
  rasterGaussianBlurReturnFocus = null;
  if (returnFocus?.isConnected) {
    queueMicrotask(() => returnFocus.focus({ preventScroll: true }));
  }
  if (result !== "error") resetRasterGaussianBlurControls();
  syncRasterGaussianBlurUi();
  syncRasterMotionBlurUi();
  syncRasterNoiseUi();
}

async function openRasterGaussianBlurWorkbench(
  surface: RasterGaussianBlurSurface,
  trigger: HTMLElement,
): Promise<void> {
  const eligibilityError = rasterGaussianBlurEligibilityError();
  if (eligibilityError || rasterGaussianBlurSurface !== null) {
    if (eligibilityError) {
      statusElement.textContent = eligibilityError;
      statusElement.className = "status error";
    }
    return;
  }

  if (surface === "mobile" && !mobileGaussianBlurSheet?.open(trigger)) return;

  rasterGaussianBlurSurface = surface;
  rasterGaussianBlurReturnFocus = trigger;
  rasterGaussianBlurSessionOpen = false;
  rasterGaussianBlurPreviewFault = false;
  rasterGaussianBlurUiBusy = true;
  setRasterGaussianBlurStatus("Preparazione Gaussian Blur…");
  syncRasterGaussianBlurUi();
  syncRasterMotionBlurUi();
  syncRasterNoiseUi();

  try {
    const radiusInput = surface === "mobile"
      ? mobileGaussianBlurRadiusInput
      : desktopGaussianBlurRadiusInput;
    const preview = await engine.beginRasterGaussianBlur(
      Number(radiusInput.value),
    );
    if (!preview) throw new Error("Seleziona un livello raster per usare Gaussian Blur.");
    rasterGaussianBlurSessionOpen = true;
    setRasterGaussianBlurRadiusOutput(preview.radius);
    setRasterGaussianBlurStatus(`Raggio ${preview.radius.toFixed(0)} pixel.`);
  } catch (error) {
    historyState = engine.getHistoryState();
    rasterGaussianBlurSessionOpen = historyState.openEdit === "gaussian-blur";
    rasterGaussianBlurPreviewFault = rasterGaussianBlurSessionOpen;
    reportRasterGaussianBlurError("Impossibile aprire Gaussian Blur", error);
    if (!rasterGaussianBlurSessionOpen) closeRasterGaussianBlurWorkbench("error");
  } finally {
    rasterGaussianBlurUiBusy = false;
    historyState = engine.getHistoryState();
    updateHistoryControls();
    if (rasterGaussianBlurCancelPending && rasterGaussianBlurSessionOpen) {
      rasterGaussianBlurCancelPending = false;
      void cancelRasterGaussianBlurFromUi();
    }
  }
}

async function cancelRasterGaussianBlurFromUi(): Promise<void> {
  if (rasterGaussianBlurUiBusy) {
    rasterGaussianBlurCancelPending = true;
    return;
  }
  if (!rasterGaussianBlurSessionOpen) return;
  rasterGaussianBlurCancelPending = false;
  rasterGaussianBlurUiBusy = true;
  setRasterGaussianBlurStatus("Ripristino dei pixel originali…");
  syncRasterGaussianBlurUi();
  try {
    await engine.cancelRasterGaussianBlur();
    rasterGaussianBlurSessionOpen = false;
    rasterGaussianBlurPreviewFault = false;
    closeRasterGaussianBlurWorkbench("cancel");
  } catch (error) {
    historyState = engine.getHistoryState();
    rasterGaussianBlurSessionOpen = historyState.openEdit === "gaussian-blur";
    rasterGaussianBlurPreviewFault = true;
    reportRasterGaussianBlurError("Annullamento Gaussian Blur non riuscito", error);
  } finally {
    rasterGaussianBlurUiBusy = false;
    historyState = engine.getHistoryState();
    updateHistoryControls();
  }
}

async function applyRasterGaussianBlurFromUi(): Promise<void> {
  if (
    rasterGaussianBlurUiBusy
    || !rasterGaussianBlurSessionOpen
    || rasterGaussianBlurPreviewFault
    || historyState.inconsistent
  ) {
    return;
  }
  rasterGaussianBlurUiBusy = true;
  setRasterGaussianBlurStatus("Applicazione Gaussian Blur…");
  syncRasterGaussianBlurUi();
  try {
    await engine.commitRasterGaussianBlur();
    rasterGaussianBlurSessionOpen = false;
    rasterGaussianBlurPreviewFault = false;
    closeRasterGaussianBlurWorkbench("apply");
  } catch (error) {
    historyState = engine.getHistoryState();
    rasterGaussianBlurSessionOpen = historyState.openEdit === "gaussian-blur";
    rasterGaussianBlurPreviewFault = rasterGaussianBlurSessionOpen;
    reportRasterGaussianBlurError("Applicazione Gaussian Blur non riuscita", error);
    if (!rasterGaussianBlurSessionOpen) closeRasterGaussianBlurWorkbench("error");
  } finally {
    rasterGaussianBlurUiBusy = false;
    historyState = engine.getHistoryState();
    updateHistoryControls();
  }
}

function setRasterMotionBlurDistanceOutput(distance: number): void {
  const rounded = Math.round(distance);
  const value = `${rounded} px`;
  for (const output of rasterMotionBlurDistanceOutputs) output.value = value;
  for (const input of rasterMotionBlurDistanceInputs) {
    input.value = String(rounded);
    input.setAttribute("aria-valuetext", `${rounded} pixels`);
  }
}

function setRasterMotionBlurAngleOutput(angle: number): void {
  const rounded = Math.round(angle);
  const value = `${rounded}°`;
  for (const output of rasterMotionBlurAngleOutputs) output.value = value;
  for (const input of rasterMotionBlurAngleInputs) {
    input.value = String(rounded);
    input.setAttribute("aria-valuetext", `${rounded} degrees`);
  }
}

function setRasterMotionBlurStatus(message: string): void {
  for (const status of rasterMotionBlurStatuses) status.textContent = message;
}

function resetRasterMotionBlurControls(): void {
  setRasterMotionBlurDistanceOutput(DESTRUCTIVE_MOTION_BLUR_DEFAULT_DISTANCE);
  setRasterMotionBlurAngleOutput(DESTRUCTIVE_MOTION_BLUR_DEFAULT_ANGLE);
  setRasterMotionBlurStatus("Motion Blur pronto.");
}

function reportRasterMotionBlurError(prefix: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const fullMessage = `${prefix}: ${message}`;
  setRasterMotionBlurStatus(fullMessage);
  statusElement.textContent = fullMessage;
  statusElement.className = "status error";
}

function closeRasterMotionBlurWorkbench(
  result: "apply" | "cancel" | "error",
): void {
  const surface = rasterMotionBlurSurface;
  rasterMotionBlurSurface = null;
  rasterMotionBlurCancelPending = false;
  desktopMotionBlurOpenInput.checked = false;
  desktopMotionBlurOpenInput.setAttribute("aria-expanded", "false");
  desktopMotionBlurParameters.hidden = true;
  mobileMotionBlurOpenButton.setAttribute("aria-pressed", "false");
  if (surface === "mobile") mobileMotionBlurSheet?.close(false);
  const returnFocus = rasterMotionBlurReturnFocus;
  rasterMotionBlurReturnFocus = null;
  if (returnFocus?.isConnected) {
    queueMicrotask(() => returnFocus.focus({ preventScroll: true }));
  }
  if (result !== "error") resetRasterMotionBlurControls();
  syncRasterMotionBlurUi();
  syncRasterGaussianBlurUi();
  syncRasterNoiseUi();
}

async function openRasterMotionBlurWorkbench(
  surface: RasterMotionBlurSurface,
  trigger: HTMLElement,
): Promise<void> {
  const eligibilityError = rasterMotionBlurEligibilityError();
  if (eligibilityError || rasterMotionBlurSurface !== null) {
    if (eligibilityError) {
      statusElement.textContent = eligibilityError;
      statusElement.className = "status error";
    }
    return;
  }

  if (surface === "mobile" && !mobileMotionBlurSheet?.open(trigger)) return;

  rasterMotionBlurSurface = surface;
  rasterMotionBlurReturnFocus = trigger;
  rasterMotionBlurSessionOpen = false;
  rasterMotionBlurPreviewFault = false;
  rasterMotionBlurUiBusy = true;
  setRasterMotionBlurStatus("Preparazione Motion Blur…");
  syncRasterMotionBlurUi();
  syncRasterGaussianBlurUi();
  syncRasterNoiseUi();

  try {
    const distanceInput = surface === "mobile"
      ? mobileMotionBlurDistanceInput
      : desktopMotionBlurDistanceInput;
    const angleInput = surface === "mobile"
      ? mobileMotionBlurAngleInput
      : desktopMotionBlurAngleInput;
    const preview = await engine.beginRasterMotionBlur(
      Number(distanceInput.value),
      Number(angleInput.value),
    );
    if (!preview) throw new Error("Seleziona un livello raster per usare Motion Blur.");
    rasterMotionBlurSessionOpen = true;
    setRasterMotionBlurDistanceOutput(preview.distance);
    setRasterMotionBlurAngleOutput(preview.angle);
    setRasterMotionBlurStatus(
      `Distanza ${preview.distance.toFixed(0)} pixel · Angolo ${preview.angle.toFixed(0)}°.`,
    );
  } catch (error) {
    historyState = engine.getHistoryState();
    rasterMotionBlurSessionOpen = historyState.openEdit === "motion-blur";
    rasterMotionBlurPreviewFault = rasterMotionBlurSessionOpen;
    reportRasterMotionBlurError("Impossibile aprire Motion Blur", error);
    if (!rasterMotionBlurSessionOpen) closeRasterMotionBlurWorkbench("error");
  } finally {
    rasterMotionBlurUiBusy = false;
    historyState = engine.getHistoryState();
    updateHistoryControls();
    if (rasterMotionBlurCancelPending && rasterMotionBlurSessionOpen) {
      rasterMotionBlurCancelPending = false;
      void cancelRasterMotionBlurFromUi();
    }
  }
}

async function cancelRasterMotionBlurFromUi(): Promise<void> {
  if (rasterMotionBlurUiBusy) {
    rasterMotionBlurCancelPending = true;
    return;
  }
  if (!rasterMotionBlurSessionOpen) return;
  rasterMotionBlurCancelPending = false;
  rasterMotionBlurUiBusy = true;
  setRasterMotionBlurStatus("Ripristino dei pixel originali…");
  syncRasterMotionBlurUi();
  try {
    await engine.cancelRasterMotionBlur();
    rasterMotionBlurSessionOpen = false;
    rasterMotionBlurPreviewFault = false;
    closeRasterMotionBlurWorkbench("cancel");
  } catch (error) {
    historyState = engine.getHistoryState();
    rasterMotionBlurSessionOpen = historyState.openEdit === "motion-blur";
    rasterMotionBlurPreviewFault = true;
    reportRasterMotionBlurError("Annullamento Motion Blur non riuscito", error);
  } finally {
    rasterMotionBlurUiBusy = false;
    historyState = engine.getHistoryState();
    updateHistoryControls();
  }
}

async function applyRasterMotionBlurFromUi(): Promise<void> {
  if (
    rasterMotionBlurUiBusy
    || !rasterMotionBlurSessionOpen
    || rasterMotionBlurPreviewFault
    || historyState.inconsistent
  ) {
    return;
  }
  rasterMotionBlurUiBusy = true;
  setRasterMotionBlurStatus("Applicazione Motion Blur…");
  syncRasterMotionBlurUi();
  try {
    await engine.commitRasterMotionBlur();
    rasterMotionBlurSessionOpen = false;
    rasterMotionBlurPreviewFault = false;
    closeRasterMotionBlurWorkbench("apply");
  } catch (error) {
    historyState = engine.getHistoryState();
    rasterMotionBlurSessionOpen = historyState.openEdit === "motion-blur";
    rasterMotionBlurPreviewFault = rasterMotionBlurSessionOpen;
    reportRasterMotionBlurError("Applicazione Motion Blur non riuscita", error);
    if (!rasterMotionBlurSessionOpen) closeRasterMotionBlurWorkbench("error");
  } finally {
    rasterMotionBlurUiBusy = false;
    historyState = engine.getHistoryState();
    updateHistoryControls();
  }
}

function setRasterNoiseStatus(message: string): void {
  for (const status of rasterNoiseStatuses) status.textContent = message;
}

function resetRasterNoiseControls(): void {
  syncRasterNoiseSettings(DEFAULT_RASTER_NOISE_SETTINGS);
  setRasterNoiseStatus("Noise pronto.");
}

function reportRasterNoiseError(prefix: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const fullMessage = `${prefix}: ${message}`;
  setRasterNoiseStatus(fullMessage);
  statusElement.textContent = fullMessage;
  statusElement.className = "status error";
}

function closeRasterNoiseWorkbench(result: "apply" | "cancel" | "error"): void {
  const surface = rasterNoiseSurface;
  rasterNoiseSurface = null;
  rasterNoiseCancelPending = false;
  desktopNoiseOpenInput.checked = false;
  desktopNoiseOpenInput.setAttribute("aria-expanded", "false");
  desktopNoiseParameters.hidden = true;
  mobileNoiseOpenButton.setAttribute("aria-pressed", "false");
  if (surface === "mobile") mobileNoiseSheet?.close(false);
  const returnFocus = rasterNoiseReturnFocus;
  rasterNoiseReturnFocus = null;
  if (returnFocus?.isConnected) {
    queueMicrotask(() => returnFocus.focus({ preventScroll: true }));
  }
  if (result !== "error") resetRasterNoiseControls();
  syncRasterNoiseUi();
  syncRasterGaussianBlurUi();
  syncRasterMotionBlurUi();
}

async function openRasterNoiseWorkbench(
  surface: RasterNoiseSurface,
  trigger: HTMLElement,
): Promise<void> {
  const eligibilityError = rasterNoiseEligibilityError();
  if (eligibilityError || rasterNoiseSurface !== null) {
    if (eligibilityError) {
      statusElement.textContent = eligibilityError;
      statusElement.className = "status error";
    }
    return;
  }
  if (surface === "mobile" && !mobileNoiseSheet?.open(trigger)) return;

  rasterNoiseSurface = surface;
  rasterNoiseReturnFocus = trigger;
  rasterNoiseSessionOpen = false;
  rasterNoisePreviewFault = false;
  rasterNoiseUiBusy = true;
  const initial = rasterNoiseSettingsFromSurface(surface);
  syncRasterNoiseSettings(initial);
  setRasterNoiseStatus("Preparazione Noise…");
  syncRasterNoiseUi();
  syncRasterGaussianBlurUi();
  syncRasterMotionBlurUi();

  try {
    const preview = await engine.beginRasterNoise(initial);
    if (!preview) throw new Error("Seleziona un livello raster per usare Noise.");
    rasterNoiseSessionOpen = true;
    syncRasterNoiseSettings(preview.settings);
    setRasterNoiseStatus(
      `Quantità ${preview.settings.amountPercent.toFixed(0)}% · `
      + `${preview.settings.style} · ${preview.settings.channels}.`,
    );
  } catch (error) {
    historyState = engine.getHistoryState();
    rasterNoiseSessionOpen = historyState.openEdit === "noise";
    rasterNoisePreviewFault = rasterNoiseSessionOpen;
    reportRasterNoiseError("Impossibile aprire Noise", error);
    if (!rasterNoiseSessionOpen) closeRasterNoiseWorkbench("error");
  } finally {
    rasterNoiseUiBusy = false;
    historyState = engine.getHistoryState();
    updateHistoryControls();
    if (rasterNoiseCancelPending && rasterNoiseSessionOpen) {
      rasterNoiseCancelPending = false;
      void cancelRasterNoiseFromUi();
    }
  }
}

function updateRasterNoiseFromUi(surface: RasterNoiseSurface): void {
  if (
    rasterNoiseUiBusy
    || !rasterNoiseSessionOpen
    || rasterNoisePreviewFault
    || historyState.inconsistent
  ) {
    return;
  }
  try {
    const preview = engine.updateRasterNoise(rasterNoiseSettingsFromSurface(surface));
    syncRasterNoiseSettings(preview.settings);
    setRasterNoiseStatus(`Anteprima Noise ${preview.settings.amountPercent.toFixed(0)}%…`);
  } catch (error) {
    rasterNoisePreviewFault = true;
    reportRasterNoiseError("Anteprima Noise non riuscita", error);
    syncRasterNoiseUi();
  }
}

async function cancelRasterNoiseFromUi(): Promise<void> {
  if (rasterNoiseUiBusy) {
    rasterNoiseCancelPending = true;
    return;
  }
  if (!rasterNoiseSessionOpen) return;
  rasterNoiseCancelPending = false;
  rasterNoiseUiBusy = true;
  setRasterNoiseStatus("Ripristino dei pixel originali…");
  syncRasterNoiseUi();
  try {
    await engine.cancelRasterNoise();
    rasterNoiseSessionOpen = false;
    rasterNoisePreviewFault = false;
    closeRasterNoiseWorkbench("cancel");
  } catch (error) {
    historyState = engine.getHistoryState();
    rasterNoiseSessionOpen = historyState.openEdit === "noise";
    rasterNoisePreviewFault = true;
    reportRasterNoiseError("Annullamento Noise non riuscito", error);
  } finally {
    rasterNoiseUiBusy = false;
    historyState = engine.getHistoryState();
    updateHistoryControls();
  }
}

async function applyRasterNoiseFromUi(): Promise<void> {
  if (
    rasterNoiseUiBusy
    || !rasterNoiseSessionOpen
    || rasterNoisePreviewFault
    || historyState.inconsistent
  ) {
    return;
  }
  rasterNoiseUiBusy = true;
  setRasterNoiseStatus("Applicazione Noise…");
  syncRasterNoiseUi();
  try {
    await engine.commitRasterNoise();
    rasterNoiseSessionOpen = false;
    rasterNoisePreviewFault = false;
    closeRasterNoiseWorkbench("apply");
  } catch (error) {
    historyState = engine.getHistoryState();
    rasterNoiseSessionOpen = historyState.openEdit === "noise";
    rasterNoisePreviewFault = rasterNoiseSessionOpen;
    reportRasterNoiseError("Applicazione Noise non riuscita", error);
    if (!rasterNoiseSessionOpen) closeRasterNoiseWorkbench("error");
  } finally {
    rasterNoiseUiBusy = false;
    historyState = engine.getHistoryState();
    updateHistoryControls();
  }
}

/**
 * Passi di cronologia richiesti mentre uno era gia' in corso.
 *
 * Un Undo che deve rigiocare da un checkpoint tiene il motore occupato a lungo,
 * e per tutta quella finestra `moveHistoryCursor` rifiutava in silenzio: chi
 * premeva cinque volte ne vedeva uno solo e concludeva, ragionevolmente, che
 * l'Undo fosse rotto. I comandi ora si accodano invece di sparire.
 *
 * Il tetto esiste perche' un tasto tenuto premuto genera eventi molto piu' in
 * fretta di quanto un replay possa consumarli: senza, la coda crescerebbe
 * all'infinito e l'utente si troverebbe a guardare passi che non ha piu'
 * chiesto. Trentadue e' abbondante per un gesto umano e resta interrompibile.
 */
const HISTORY_QUEUE_MAXIMUM = 32;
const historyOperationQueue: ("undo" | "redo")[] = [];
let historyQueueDraining = false;

function requestHistoryOperation(operation: "undo" | "redo"): void {
  if (historyOperationQueue.length >= HISTORY_QUEUE_MAXIMUM) return;
  historyOperationQueue.push(operation);
  void drainHistoryOperations();
}

async function drainHistoryOperations(): Promise<void> {
  if (historyQueueDraining) return;
  historyQueueDraining = true;
  try {
    while (historyOperationQueue.length > 0) {
      const operation = historyOperationQueue.shift();
      if (!operation) break;
      // Un passo che non si muove e' un muro, non un intoppo: insistere
      // trentadue volte ripeterebbe lo stesso messaggio d'errore e basta.
      if (!await runHistoryOperation(operation)) {
        historyOperationQueue.length = 0;
        break;
      }
    }
  } finally {
    historyQueueDraining = false;
  }
}

/**
 * Ultimo guasto di una transazione di cronologia, tenuto finche' non ne arriva
 * un altro. La barra di stato lo mostra ma il primo aggiornamento lo cancella,
 * e su telefono non c'e' console: senza questo, l'errore che conta resta
 * invisibile e in mano restano solo le righe ripetute che ne sono la
 * conseguenza. Il pannello lo rende fotografabile.
 */
let ultimoGuastoCronologia: {
  readonly operazione: "undo" | "redo";
  readonly azione: string;
  readonly cursore: number;
  readonly messaggio: string;
} | null = null;

/** Ritorna se il cursore si e' davvero mosso: la coda si ferma quando non si muove. */
async function runHistoryOperation(operation: "undo" | "redo"): Promise<boolean> {
  if (interactionLocked() || activePointerId !== null) {
    const reason = operation === "undo"
      ? historyState.undoBlockedReason
      : historyState.redoBlockedReason;
    statusElement.textContent = reason ?? "Termina l'operazione corrente e riprova.";
    statusElement.className = "status";
    return false;
  }
  if (operation === "undo" ? !historyState.canUndo : !historyState.canRedo) {
    const reason = operation === "undo"
      ? historyState.undoBlockedReason
      : historyState.redoBlockedReason;
    statusElement.textContent = reason ?? "Operazione di cronologia non disponibile.";
    statusElement.className = "status";
    return false;
  }

  historyUiBusy = true;
  updateHistoryControls();
  updateHumanStrokeControls();
  let moved = false;
  try {
    moved = operation === "undo" ? await engine.undo() : await engine.redo();
    if (!moved) {
      // Il motore rifiuta anche in silenzio: senza questo, un passo scartato
      // resterebbe indistinguibile da un passo eseguito. Il motivo va riletto
      // adesso, perche' quello in `historyState` e' anteriore al tentativo.
      const fresco = engine.getHistoryState();
      statusElement.textContent = (operation === "undo"
        ? fresco.undoBlockedReason
        : fresco.redoBlockedReason)
        ?? "Passo di cronologia non eseguibile in questo momento.";
      statusElement.className = "status";
      recordAppDiagnosticOperation(
        "history-step-refused",
        JSON.stringify({
          operation,
          cursor: fresco.cursor,
          reason: operation === "undo"
            ? fresco.undoBlockedReason
            : fresco.redoBlockedReason,
        }),
      );
    }
  } catch (error) {
    const messaggio = error instanceof Error ? error.message : String(error);
    // Il cursore non si e' mosso, quindi l'azione attraversata e' quella che
    // stava per essere annullata (Undo) o riapplicata (Redo).
    const cursore = engine.historyCursor;
    const attraversata = operation === "undo"
      ? engine.historyActions[cursore - 1]
      : engine.historyActions[cursore];
    ultimoGuastoCronologia = {
      operazione: operation,
      azione: attraversata?.kind ?? "sconosciuta",
      cursore,
      messaggio,
    };
    recordAppDiagnosticOperation(
      "history-step-failed",
      JSON.stringify({ operation, action: attraversata?.kind ?? null, cursore }),
      error,
    );
    statusElement.textContent = messaggio;
    statusElement.className = "status error";
  } finally {
    historyUiBusy = false;
    historyState = engine.getHistoryState();
    updateHistoryControls();
    updateHumanStrokeControls();
    syncActiveLayerControls();
    mobileLayersRenderSignature = "";
    requestMobileLayersRefresh();
    updateStats(engine.getStats());
    requestMobileLayerThumbnailCapture(0);
  }
  return moved;
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
  "blendBlur",
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
  const select = element<HTMLSelectElement>("brushTool");
  const selected = select.value;
  if (selected === "liquify") {
    void openRasterLiquifyWorkbench("desktop", select);
    return;
  }
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
  [mobileBrushBlurControl, "blur"],
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

mobileCopyLayerButton.addEventListener("click", () => {
  if (!mobileCopyLayerButton.disabled) void duplicateMobileSelectedLayer();
});

mobileAddMaskButton.addEventListener("click", () => {
  if (!mobileAddMaskButton.disabled) void addMobileClippingMaskLayer();
});

mobileLayerMultiSelectButton.addEventListener("click", () => {
  if (
    mobileLayerMultiSelectButton.disabled
    || layerSwitching
    || interactionLocked()
  ) return;
  setMobileLayerMultiSelectEnabled(!mobileLayerMultiSelectEnabled);
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
    ".mobile-layer-row.is-selected .mobile-layer-select, "
      + ".mobile-layer-row.is-multi-selected .mobile-layer-select",
  );
  const row = select?.closest<HTMLElement>(
    ".mobile-layer-row.is-selected, .mobile-layer-row.is-multi-selected",
  );
  const key = row?.dataset.layerKey;
  if (!select || !row || !key || !isMobileMixedSceneLayerKey(key)) return;
  event.preventDefault();
  cancelMobileLayerReorderGesture(false, false, false);
  openMobileLayerContextMenu(key, row);
  focusFirstMobileLayerContextAction();
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

async function requestMobileLayerMerge(): Promise<void> {
  if (!mobileLayerMultiSelectEnabled || interactionLocked() || layerSwitching) return;
  const plan = currentMobileLayerMergePlan();
  const controller = mobileLayerMergeController();
  const unavailableReason = mobileLayerMergeUnavailableReason(plan, controller);
  if (unavailableReason || !plan.valid || controller === null) {
    mobileLayerMergeButton.disabled = true;
    mobileLayerMergeButton.title = unavailableReason ?? "Unione non disponibile.";
    mobileLayerMergeReason.textContent = unavailableReason ?? "Unione non disponibile.";
    mobileLayerMergeReason.hidden = false;
    announceMobileLayerReorder(mobileLayerMergeReason.textContent);
    return;
  }

  const beforeSnapshot = engine.getMixedSceneSnapshot();
  const beforeKeys = beforeSnapshot?.items.map((item) => item.key) ?? [];
  closeMobileLayerContextMenu(false);
  setMobileLayerMergeStatus(null);
  layerSwitching = true;
  updateHistoryControls();
  mobileLayersRenderSignature = "";
  requestMobileLayersRefresh();
  try {
    await showLayerLoading("Unione livelli…");
    const result = await controller.mergeSceneItems(plan.orderedKeys);
    const mergedSnapshot = engine.getMixedSceneSnapshot();
    const outputKey = `raster:${result.layerId}` as MobileMixedSceneLayerKey;
    if (
      !mergedSnapshot
      || !mobileLayerMergeCompletionMatches(
        beforeKeys,
        plan.orderedKeys,
        mergedSnapshot.items.map((item) => item.key),
        outputKey,
      )
    ) {
      throw new Error(
        "Il merge è terminato, ma la scena pubblicata non contiene il rimpiazzo atteso.",
      );
    }
    await engine.waitForIdle();
    historyState = engine.getHistoryState();
    syncActiveLayerControls();
    setMobileLayerMultiSelectEnabled(false, false);
    const successMessage = `${result.itemCount} livelli uniti.`;
    layerSwitchResult.textContent = successMessage;
    setMobileLayerMergeStatus(successMessage);
    announceMobileLayerReorder(`${result.itemCount} layers merged.`);
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Unione dei livelli non riuscita.";
    recordAppDiagnosticOperation(
      "mixed-scene-merge-failed",
      JSON.stringify({ selectedKeys: plan.orderedKeys }),
      error,
    );
    layerSwitchResult.textContent = message;
    setMobileLayerMergeStatus(message, true);
    announceMobileLayerReorder(message);
  } finally {
    hideLayerLoading();
    layerSwitching = false;
    mobileLayersRenderSignature = "";
    requestMobileLayersRefresh();
    updateHistoryControls();
    updateStats(engine.getStats());
    requestMobileLayerThumbnailCapture(0);
  }
}

mobileLayerMergeButton.addEventListener("click", () => {
  if (mobileLayerMergeButton.disabled) return;
  void requestMobileLayerMerge();
});

mobileLayerMergeSelectionButton.addEventListener("click", () => {
  if (mobileLayerMergeSelectionButton.disabled) return;
  void requestMobileLayerMerge();
});

// Nessuna conferma: l`operazione e` annullabile, ed e` esattamente il motivo
// per cui l`abbiamo resa journaled. Un dialogo qui sarebbe attrito inutile.
mobileLayerDeleteButton.addEventListener("click", () => {
  const properties = mobileLayerProperties(mobileLayerContextKey);
  if (!properties || properties.kind !== "raster" || properties.rasterIndex === null) {
    return;
  }
  // Il livello bloccato usciva di qui in silenzio: il pulsante non faceva
  // niente e non diceva niente, indistinguibile da un guasto.
  if (properties.locked) {
    closeMobileLayerContextMenu(false);
    statusElement.textContent = "Livello bloccato: sbloccalo prima di eliminarlo.";
    statusElement.className = "status";
    return;
  }
  const index = properties.rasterIndex;
  closeMobileLayerContextMenu(false);
  void engine.deleteLayer(index).catch((error) => {
    console.error("Eliminazione livello non riuscita", error);
    recordAppDiagnosticOperation(
      "raster-layer-delete-failed",
      JSON.stringify({ index }),
      error,
    );
    statusElement.textContent = error instanceof Error ? error.message : String(error);
    statusElement.className = "status error";
  });
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

mobileBrushLibraryBrushes.addEventListener("scroll", () => {
  if (mobileBrushLibraryScrollTimer !== null) {
    window.clearTimeout(mobileBrushLibraryScrollTimer);
  }
  mobileBrushLibraryScrollTimer = window.setTimeout(() => {
    mobileBrushLibraryScrollTimer = null;
    if (mobileBrushLibraryOpen) markMobileBrushLibraryPreviewDirty();
  }, 90);
}, { passive: true });

function mobileBrushLibraryName(brushId: MobileBrushLibraryBrushId): string {
  const customName = mobileCustomBrushes.find((brush) => brush.id === brushId)?.name;
  if (customName) return customName;
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
    saveBrushStudioLibraryState(
      activeMobileBrushLibraryBrushId,
      mobileCustomBrushes,
    );
  } catch {
    // Settings remain authoritative in their own localStorage record. This
    // small pointer only restores which saved card is active after a refresh.
  }
}

function createMobileBrushLibraryBrush(): void {
  const studio = mobileBrushStudio;
  if (!studio || !mobileUiMediaQuery.matches) return;
  if (mobileCustomBrushes.length >= BRUSH_STUDIO_MAX_CUSTOM_BRUSHES) {
    syncMobileBrushLibraryAddState();
    return;
  }
  mobileBrushLibrarySelectionRevision += 1;
  const originalSettings = engine.getSettings();
  studio.rememberSettings(activeMobileBrushLibraryBrushId, originalSettings);
  const brushId = createBrushStudioCustomBrushId();
  const brushName = nextBrushStudioCustomBrushName(mobileCustomBrushes);
  const baseSettings = createBrushStudioBaseSettings(
    defaultBrushSettings,
    originalSettings.color,
  );
  applySettingsToControls(baseSettings);
  studio.open(brushId, brushName, baseSettings, originalSettings);
}

function latestMobileCustomBrushCatalog(): BrushStudioCustomBrush[] {
  const latest = [
    ...(loadBrushStudioLibraryState()?.customBrushes ?? []),
  ];
  for (const localBrush of mobileCustomBrushes) {
    if (
      latest.length < BRUSH_STUDIO_MAX_CUSTOM_BRUSHES
      && !latest.some((brush) => brush.id === localBrush.id)
    ) {
      latest.push(localBrush);
    }
  }
  return latest;
}

function adoptMobileCustomBrushCatalog(catalog: readonly BrushStudioCustomBrush[]): void {
  mobileCustomBrushes = [...catalog];
  for (const descriptor of mobileCustomBrushes) ensureMobileCustomBrushCard(descriptor);
}

async function storedMobileBrushTransferAsset(
  key: string | null,
  kind: "shape" | "grain",
) {
  if (!key) return null;
  const asset = await loadBrushStudioAsset(key);
  if (!asset || asset.kind !== kind) {
    throw new Error(`The saved ${kind} source is unavailable. Nothing was exported.`);
  }
  return asset;
}

async function presentMobileBrushTransfer(
  blob: Blob,
  brushName: string,
): Promise<"shared" | "downloaded" | "cancelled"> {
  const fileName = brushStudioTransferFileName(brushName);
  const file = new File([blob], fileName, { type: BRUSH_STUDIO_TRANSFER_MIME_TYPE });
  if (
    typeof navigator.share === "function"
    && typeof navigator.canShare === "function"
    && navigator.canShare({ files: [file] })
  ) {
    try {
      await navigator.share({
        files: [file],
        title: brushName,
        text: "M1M4 brush",
      });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      // Some mobile browsers advertise file sharing but reject a custom file
      // extension. The download path below still produces the same brush file.
    }
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return "downloaded";
}

async function exportActiveMobileBrush(): Promise<void> {
  if (mobileBrushLibraryTransferBusy) return;
  const brushId = activeMobileBrushLibraryBrushId;
  if (!isBrushStudioCustomBrushId(brushId)) {
    reportMobileBrushLibraryStatus(
      "Select a saved custom brush to export.",
      "export-unavailable",
    );
    return;
  }
  const savedBrush = loadBrushStudioSavedBrush(brushId);
  const descriptor = mobileCustomBrushes.find((brush) => brush.id === brushId);
  if (!savedBrush || !descriptor) {
    reportMobileBrushLibraryStatus("This custom brush has not been saved yet.", "error");
    return;
  }
  mobileBrushLibraryTransferBusy = true;
  syncMobileBrushLibraryAddState();
  reportMobileBrushLibraryStatus(`Preparing ${descriptor.name}…`, "working");
  try {
    const [shapeAsset, grainAsset] = await Promise.all([
      storedMobileBrushTransferAsset(savedBrush.shapeAssetKey, "shape"),
      storedMobileBrushTransferAsset(savedBrush.grainAssetKey, "grain"),
    ]);
    const blob = await createBrushStudioTransferBlob({
      name: descriptor.name,
      savedBrush,
      shapeAsset,
      grainAsset,
    });
    const outcome = await presentMobileBrushTransfer(blob, descriptor.name);
    if (outcome === "shared") {
      reportMobileBrushLibraryStatus(`${descriptor.name} shared.`, "ok");
    } else if (outcome === "downloaded") {
      reportMobileBrushLibraryStatus(`${descriptor.name} exported.`, "ok");
    } else {
      reportMobileBrushLibraryStatus("Export cancelled.", "ok");
    }
  } catch (error) {
    reportMobileBrushLibraryStatus(
      error instanceof Error ? error.message : String(error),
      "error",
    );
  } finally {
    mobileBrushLibraryTransferBusy = false;
    syncMobileBrushLibraryAddState();
  }
}

async function rollbackMobileBrushImport(
  brushId: BrushStudioCustomBrushId,
  assetKeys: readonly string[],
  resolvedSettings: Readonly<BrushSettings> | null,
): Promise<void> {
  if (resolvedSettings && mobileBrushStudio) {
    try {
      await mobileBrushStudio.releasePreviewAssets(brushId, resolvedSettings);
    } catch {
      // The brush was never made active. Leaving a small transient registry
      // entry is safer than turning a recoverable import error into data loss.
    }
  }
  mobileBrushStudio?.forgetSettings(brushId);
  try {
    deleteBrushStudioSavedBrush(brushId);
  } catch {
    // The unique import ID cannot shadow an existing brush.
  }
  for (const key of assetKeys) {
    try {
      await deleteBrushStudioAsset(key);
    } catch {
      // An unreachable import blob can be reclaimed by storage cleanup later.
    }
  }
}

async function importMobileBrush(file: File): Promise<void> {
  const studio = mobileBrushStudio;
  if (!studio || mobileBrushLibraryTransferBusy) return;
  if (file.size > BRUSH_STUDIO_TRANSFER_MAX_FILE_BYTES) {
    reportMobileBrushLibraryStatus("Choose an M1M4 brush file smaller than 42 MB.", "error");
    return;
  }
  const openingCatalog = latestMobileCustomBrushCatalog();
  if (openingCatalog.length >= BRUSH_STUDIO_MAX_CUSTOM_BRUSHES) {
    adoptMobileCustomBrushCatalog(openingCatalog);
    syncMobileBrushLibraryAddState();
    reportMobileBrushLibraryStatus(
      `Maximum ${BRUSH_STUDIO_MAX_CUSTOM_BRUSHES} custom brushes reached.`,
      "error",
    );
    return;
  }

  mobileBrushLibraryTransferBusy = true;
  syncMobileBrushLibraryAddState();
  reportMobileBrushLibraryStatus(`Importing ${file.name}…`, "working");
  let brushId: BrushStudioCustomBrushId | null = null;
  let resolvedSettings: BrushSettings | null = null;
  const assetKeys: string[] = [];
  let catalogCommitted = false;
  try {
    const imported = await parseBrushStudioTransferBlob(file);
    // Portable assets are already bounded PNGs. Keep their mask bytes intact;
    // resolveBrushSettings decodes and validates them before catalog commit.
    let catalog = latestMobileCustomBrushCatalog();
    if (catalog.length >= BRUSH_STUDIO_MAX_CUSTOM_BRUSHES) {
      adoptMobileCustomBrushCatalog(catalog);
      throw new Error(`Maximum ${BRUSH_STUDIO_MAX_CUSTOM_BRUSHES} custom brushes reached.`);
    }

    brushId = createBrushStudioCustomBrushId();
    const settings = { ...imported.settings };
    let shapeAssetKey: string | null = null;
    let grainAssetKey: string | null = null;
    if (imported.shapeAsset) {
      const shapeAssetId = createBrushStudioImportedAssetId(
        brushId,
        "shape",
      );
      settings.shapeAssetId = shapeAssetId;
      shapeAssetKey = brushStudioAssetStorageKey(brushId, "shape", shapeAssetId);
      assetKeys.push(shapeAssetKey);
      await saveBrushStudioAsset(
        shapeAssetKey,
        "shape",
        imported.shapeAsset.blob,
        imported.shapeAsset.name,
      );
    }
    if (imported.grainAsset) {
      const grainAssetId = createBrushStudioImportedAssetId(
        brushId,
        "grain",
      );
      settings.grainAssetId = grainAssetId;
      grainAssetKey = brushStudioAssetStorageKey(brushId, "grain", grainAssetId);
      assetKeys.push(grainAssetKey);
      await saveBrushStudioAsset(
        grainAssetKey,
        "grain",
        imported.grainAsset.blob,
        imported.grainAsset.name,
      );
    }
    saveBrushStudioSavedBrush(brushId, {
      version: 1,
      settings,
      shapeAssetKey,
      grainAssetKey,
    });

    const currentSettings = engine.getSettings();
    resolvedSettings = await studio.resolveBrushSettings(
      brushId,
      mobileCurrentBrushFallback(currentSettings),
    );

    catalog = latestMobileCustomBrushCatalog();
    if (catalog.length >= BRUSH_STUDIO_MAX_CUSTOM_BRUSHES) {
      adoptMobileCustomBrushCatalog(catalog);
      throw new Error(`Maximum ${BRUSH_STUDIO_MAX_CUSTOM_BRUSHES} custom brushes reached.`);
    }
    const now = Date.now();
    const descriptor: BrushStudioCustomBrush = {
      id: brushId,
      name: uniqueBrushStudioCustomBrushName(imported.name, catalog),
      createdAt: now,
      updatedAt: now,
    };
    const nextCatalog = [...catalog, descriptor];
    saveBrushStudioLibraryState(brushId, nextCatalog);
    catalogCommitted = true;
    adoptMobileCustomBrushCatalog(nextCatalog);
    ensureMobileCustomBrushCard(descriptor);
    await selectMobileBrushLibraryBrush(brushId);
    reportMobileBrushLibraryStatus(`${descriptor.name} imported.`, "ok");
  } catch (error) {
    if (brushId && !catalogCommitted) {
      await rollbackMobileBrushImport(brushId, assetKeys, resolvedSettings);
    }
    reportMobileBrushLibraryStatus(
      error instanceof Error ? error.message : String(error),
      "error",
    );
  } finally {
    mobileBrushLibraryTransferBusy = false;
    syncMobileBrushLibraryAddState();
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
    syncMobileBrushLibraryAddState();
    markMobileBrushLibraryPreviewDirty();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    statusElement.textContent = message;
    statusElement.className = "status error";
    reportMobileBrushLibraryStatus(message, "error");
  }
}

mobileBrushLibraryAddButton.addEventListener("click", () => {
  createMobileBrushLibraryBrush();
});

mobileBrushLibraryImportButton.addEventListener("click", () => {
  if (mobileBrushLibraryImportButton.disabled) return;
  mobileBrushLibraryImportFile.value = "";
  mobileBrushLibraryImportFile.click();
});

mobileBrushLibraryExportButton.addEventListener("click", () => {
  void exportActiveMobileBrush();
});

mobileBrushLibraryImportFile.addEventListener("change", () => {
  const file = mobileBrushLibraryImportFile.files?.[0];
  mobileBrushLibraryImportFile.value = "";
  if (file) void importMobileBrush(file);
});

mobileBrushLibraryList.addEventListener("click", (event) => {
  if (mobileBrushLibraryTransferBusy) return;
  if (!(event.target instanceof Element)) return;
  const card = event.target.closest<HTMLButtonElement>("[data-mobile-brush-id]");
  const brushId = card?.dataset.mobileBrushId;
  if (!card || !mobileBrushLibraryList.contains(card) || !brushId) return;
  if (isMobileBrushLibraryBrushId(brushId)) {
    void selectMobileBrushLibraryBrush(brushId);
  }
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

async function restoreActiveMobileBrushLibraryBrush(): Promise<void> {
  const studio = mobileBrushStudio;
  if (!studio || !mobileUiMediaQuery.matches) return;
  const revision = ++mobileBrushLibrarySelectionRevision;
  const currentSettings = engine.getSettings();
  const fallback = activeMobileBrushLibraryBrushId === PENCIL_BRUSH_PRESET.id
    ? resolveBrushPresetSettings(PENCIL_BRUSH_PRESET, currentSettings)
    : mobileCurrentBrushFallback(currentSettings);
  try {
    const restored = await studio.resolveBrushSettings(
      activeMobileBrushLibraryBrushId,
      fallback,
    );
    if (
      revision !== mobileBrushLibrarySelectionRevision
      || !mobileUiMediaQuery.matches
    ) {
      return;
    }
    applySettingsToControls(restored);
    setMobileBrushLibraryCategory(
      mobileBrushLibraryCategoryForBrush(activeMobileBrushLibraryBrushId),
    );
    syncMobileBrushLibrarySelection();
    syncMobileBrushLibraryAddState();
    markMobileBrushLibraryPreviewDirty();
  } catch (error) {
    if (revision !== mobileBrushLibrarySelectionRevision) return;
    const message = error instanceof Error ? error.message : String(error);
    activeMobileBrushLibraryBrushId = "current";
    applySettingsToControls(mobileCurrentBrushFallback(currentSettings));
    setMobileBrushLibraryCategory("painting");
    persistActiveMobileBrushLibraryBrush();
    syncMobileBrushLibrarySelection();
    reportMobileBrushLibraryStatus(`${message} Default Brush selected.`, "error");
    statusElement.textContent = message;
    statusElement.className = "status error";
  }
}

mobileUiMediaQuery.addEventListener("change", (event) => {
  if (rasterLiquifySurface !== null) {
    void cancelRasterLiquifyFromUi();
  }
  if (rasterGaussianBlurSurface !== null) {
    void cancelRasterGaussianBlurFromUi();
  }
  if (rasterMotionBlurSurface !== null) {
    void cancelRasterMotionBlurFromUi();
  }
  if (rasterNoiseSurface !== null) {
    void cancelRasterNoiseFromUi();
  }
  if (event.matches) {
    setControlsPanelOpen(false);
    syncMobileBrushControlVisuals();
    syncMobileBrushControlAvailability();
    syncMobileBrushControlsVisibility();
    if (engineInitialized) void restoreActiveMobileBrushLibraryBrush();
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
  const liquifySheetNeedsLayout = mobileLiquifySheet?.isOpen === true;
  const gaussianBlurSheetNeedsLayout = mobileGaussianBlurSheet?.isOpen === true;
  const motionBlurSheetNeedsLayout = mobileMotionBlurSheet?.isOpen === true;
  const noiseSheetNeedsLayout = mobileNoiseSheet?.isOpen === true;
  const toolSettingsSheetNeedsLayout = mobileToolSettingsSheet?.isOpen === true;
  if (
    !toolsNeedLayout
    && !brushLibraryNeedsLayout
    && !brushStudioNeedsLayout
    && !strokeSheetNeedsLayout
    && !rasterEffectsSheetNeedsLayout
    && !liquifySheetNeedsLayout
    && !gaussianBlurSheetNeedsLayout
    && !motionBlurSheetNeedsLayout
    && !noiseSheetNeedsLayout
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
    mobileLiquifySheet?.handleResize();
    mobileGaussianBlurSheet?.handleResize();
    mobileMotionBlurSheet?.handleResize();
    mobileNoiseSheet?.handleResize();
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
copyAppDiagnosticsButton.addEventListener("click", () => {
  void copyAppDiagnosticReport();
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
  requestHistoryOperation("undo");
});
redoStrokeButton.addEventListener("click", () => {
  requestHistoryOperation("redo");
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
  controller.stopSelectedTextDistortEditing();
  restoreMobileTextDistortTool();
}

function startMobileTextDistortEditing(): boolean {
  const controller = vectorTextPrototype;
  if (!controller) return false;
  if (mobileTextDistortReturnTool === null) {
    mobileTextDistortReturnTool = activeCanvasTool === "transform"
      ? activeBrushTool
      : activeCanvasTool;
  }
  if (!controller.startSelectedTextDistortEditing()) {
    mobileTextDistortReturnTool = null;
    return false;
  }
  if (selectMobileCanvasTool("transform", true)) return true;
  controller.stopSelectedTextDistortEditing();
  mobileTextDistortReturnTool = null;
  return false;
}

function toggleMobileTextDistortEditing(): boolean {
  const controller = vectorTextPrototype;
  if (!controller) return false;
  if (!controller.isSelectedTextDistortEditing()) return startMobileTextDistortEditing();
  controller.stopSelectedTextDistortEditing();
  restoreMobileTextDistortTool();
  return false;
}

function setMobileTextWarpMode(mode: MobileTextWarpMode): boolean {
  const controller = vectorTextPrototype;
  if (!controller) return false;
  const wasDistortEditing = controller.isSelectedTextDistortEditing();
  controller.setSelectedTextTransform(mode);
  if (mode === "distort") return startMobileTextDistortEditing();
  if (wasDistortEditing) restoreMobileTextDistortTool();
  return false;
}

async function finishMobileTransformToolOnSheetClose(
  kind: MobileToolSettingsKind,
): Promise<void> {
  if (kind !== "transform" && kind !== "text-warp") return;
  const controller = vectorTextPrototype;
  if (controller && !await controller.applyTransform()) return;
  if (kind === "text-warp") controller?.stopSelectedTextDistortEditing();
  mobileTextDistortReturnTool = null;
  const nextKind = mobileToolSettingsSheet?.isOpen
    ? mobileToolSettingsSheet.toolKind
    : null;
  const nextKeepsTransform = nextKind === "transform" || nextKind === "text-warp";
  if (!nextKeepsTransform) {
    const targetTool = activeCanvasTool === "transform" ? "paint" : activeCanvasTool;
    selectMobileCanvasTool(targetTool, true);
  }
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
desktopLiquifyOpenInput.addEventListener("change", () => {
  if (desktopLiquifyOpenInput.checked) {
    void openRasterLiquifyWorkbench("desktop", desktopLiquifyOpenInput);
  } else if (rasterLiquifySurface === "desktop") {
    void cancelRasterLiquifyFromUi();
  } else {
    syncRasterLiquifyUi();
  }
});
mobileLiquifyOpenButton.addEventListener("click", () => {
  void openRasterLiquifyWorkbench("mobile", mobileLiquifyOpenButton);
});
for (const button of liquifyModeButtons) {
  button.addEventListener("click", () => {
    const mode = button.dataset.liquifyMode;
    const surface = button.dataset.liquifySurface;
    if (!isLiquifyMode(mode) || (surface !== "desktop" && surface !== "mobile")) return;
    rasterLiquifySettings = { ...rasterLiquifySettings, mode };
    updateRasterLiquifyFromUi(surface);
  });
  button.addEventListener("keydown", (event) => {
    if (
      event.key !== "ArrowLeft"
      && event.key !== "ArrowRight"
      && event.key !== "ArrowUp"
      && event.key !== "ArrowDown"
      && event.key !== "Home"
      && event.key !== "End"
    ) return;
    const surface = button.dataset.liquifySurface;
    const peers = liquifyModeButtons.filter(
      (candidate) => candidate.dataset.liquifySurface === surface && !candidate.disabled,
    );
    const index = peers.indexOf(button);
    if (index < 0 || peers.length === 0) return;
    event.preventDefault();
    const columns = surface === "mobile" ? 4 : 2;
    const delta = event.key === "ArrowLeft"
      ? -1
      : event.key === "ArrowRight"
        ? 1
        : event.key === "ArrowUp"
          ? -columns
          : event.key === "ArrowDown"
            ? columns
            : 0;
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? peers.length - 1
        : (index + delta + peers.length) % peers.length;
    peers[nextIndex].focus({ preventScroll: true });
    peers[nextIndex].click();
  });
}
for (const input of [
  ...rasterLiquifySizeInputs,
  ...rasterLiquifyPressureInputs,
  ...rasterLiquifyDistortionInputs,
  ...rasterLiquifyMomentumInputs,
]) {
  input.addEventListener("input", () => {
    const surface: RasterLiquifySurface = input.id.startsWith("mobile")
      ? "mobile"
      : "desktop";
    updateRasterLiquifyFromUi(surface);
  });
}
for (const input of rasterLiquifyAmountInputs) {
  input.addEventListener("input", () => {
    updateRasterLiquifyAmountFromUi(Number(input.value));
  });
}
for (const button of rasterLiquifyResetButtons) {
  button.addEventListener("click", () => {
    void resetRasterLiquifyFromUi();
  });
}
for (const button of rasterLiquifyCancelButtons) {
  button.addEventListener("click", () => {
    void cancelRasterLiquifyFromUi();
  });
}
for (const button of rasterLiquifyApplyButtons) {
  button.addEventListener("click", () => {
    void applyRasterLiquifyFromUi();
  });
}
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || rasterLiquifySurface !== "desktop") return;
  event.preventDefault();
  void cancelRasterLiquifyFromUi();
});
desktopGaussianBlurOpenInput.addEventListener("change", () => {
  if (desktopGaussianBlurOpenInput.checked) {
    void openRasterGaussianBlurWorkbench("desktop", desktopGaussianBlurOpenInput);
  } else if (rasterGaussianBlurSurface === "desktop") {
    void cancelRasterGaussianBlurFromUi();
  } else {
    syncRasterGaussianBlurUi();
  }
});
mobileGaussianBlurOpenButton.addEventListener("click", () => {
  void openRasterGaussianBlurWorkbench("mobile", mobileGaussianBlurOpenButton);
});
for (const input of rasterGaussianBlurRadiusInputs) {
  input.addEventListener("input", () => {
    const requestedRadius = Number(input.value);
    setRasterGaussianBlurRadiusOutput(requestedRadius);
    if (
      !rasterGaussianBlurSessionOpen
      || rasterGaussianBlurUiBusy
      || rasterGaussianBlurPreviewFault
    ) {
      return;
    }
    try {
      const preview = engine.updateRasterGaussianBlur(requestedRadius);
      setRasterGaussianBlurRadiusOutput(preview.radius);
      setRasterGaussianBlurStatus(`Raggio ${preview.radius.toFixed(0)} pixel.`);
    } catch (error) {
      rasterGaussianBlurPreviewFault = true;
      reportRasterGaussianBlurError("Anteprima Gaussian Blur interrotta", error);
      syncRasterGaussianBlurUi();
    }
  });
}
for (const button of rasterGaussianBlurCancelButtons) {
  button.addEventListener("click", () => {
    void cancelRasterGaussianBlurFromUi();
  });
}
for (const button of rasterGaussianBlurApplyButtons) {
  button.addEventListener("click", () => {
    void applyRasterGaussianBlurFromUi();
  });
}
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || rasterGaussianBlurSurface !== "desktop") return;
  event.preventDefault();
  void cancelRasterGaussianBlurFromUi();
});
desktopMotionBlurOpenInput.addEventListener("change", () => {
  if (desktopMotionBlurOpenInput.checked) {
    void openRasterMotionBlurWorkbench("desktop", desktopMotionBlurOpenInput);
  } else if (rasterMotionBlurSurface === "desktop") {
    void cancelRasterMotionBlurFromUi();
  } else {
    syncRasterMotionBlurUi();
  }
});
mobileMotionBlurOpenButton.addEventListener("click", () => {
  void openRasterMotionBlurWorkbench("mobile", mobileMotionBlurOpenButton);
});
for (const input of rasterMotionBlurDistanceInputs) {
  input.addEventListener("input", () => {
    const requestedDistance = Number(input.value);
    setRasterMotionBlurDistanceOutput(requestedDistance);
    if (
      !rasterMotionBlurSessionOpen
      || rasterMotionBlurUiBusy
      || rasterMotionBlurPreviewFault
    ) return;
    try {
      const preview = engine.updateRasterMotionBlur(
        requestedDistance,
        Number(desktopMotionBlurAngleInput.value),
      );
      setRasterMotionBlurDistanceOutput(preview.distance);
      setRasterMotionBlurAngleOutput(preview.angle);
      setRasterMotionBlurStatus(
        `Distanza ${preview.distance.toFixed(0)} pixel · Angolo ${preview.angle.toFixed(0)}°.`,
      );
    } catch (error) {
      rasterMotionBlurPreviewFault = true;
      reportRasterMotionBlurError("Anteprima Motion Blur interrotta", error);
      syncRasterMotionBlurUi();
    }
  });
}
for (const input of rasterMotionBlurAngleInputs) {
  input.addEventListener("input", () => {
    const requestedAngle = Number(input.value);
    setRasterMotionBlurAngleOutput(requestedAngle);
    if (
      !rasterMotionBlurSessionOpen
      || rasterMotionBlurUiBusy
      || rasterMotionBlurPreviewFault
    ) return;
    try {
      const preview = engine.updateRasterMotionBlur(
        Number(desktopMotionBlurDistanceInput.value),
        requestedAngle,
      );
      setRasterMotionBlurDistanceOutput(preview.distance);
      setRasterMotionBlurAngleOutput(preview.angle);
      setRasterMotionBlurStatus(
        `Distanza ${preview.distance.toFixed(0)} pixel · Angolo ${preview.angle.toFixed(0)}°.`,
      );
    } catch (error) {
      rasterMotionBlurPreviewFault = true;
      reportRasterMotionBlurError("Anteprima Motion Blur interrotta", error);
      syncRasterMotionBlurUi();
    }
  });
}
for (const button of rasterMotionBlurCancelButtons) {
  button.addEventListener("click", () => {
    void cancelRasterMotionBlurFromUi();
  });
}
for (const button of rasterMotionBlurApplyButtons) {
  button.addEventListener("click", () => {
    void applyRasterMotionBlurFromUi();
  });
}
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || rasterMotionBlurSurface !== "desktop") return;
  event.preventDefault();
  void cancelRasterMotionBlurFromUi();
});
desktopNoiseOpenInput.addEventListener("change", () => {
  if (desktopNoiseOpenInput.checked) {
    void openRasterNoiseWorkbench("desktop", desktopNoiseOpenInput);
  } else if (rasterNoiseSurface === "desktop") {
    void cancelRasterNoiseFromUi();
  } else {
    syncRasterNoiseUi();
  }
});
mobileNoiseOpenButton.addEventListener("click", () => {
  void openRasterNoiseWorkbench("mobile", mobileNoiseOpenButton);
});
for (const input of [
  ...rasterNoiseAmountInputs,
  ...rasterNoiseScaleInputs,
  ...rasterNoiseOctavesInputs,
  ...rasterNoiseTurbulenceInputs,
]) {
  input.addEventListener("input", () => {
    const surface: RasterNoiseSurface = input.id.startsWith("mobile") ? "mobile" : "desktop";
    const settings = rasterNoiseSettingsFromSurface(surface);
    syncRasterNoiseSettings(settings);
    updateRasterNoiseFromUi(surface);
  });
}
for (const select of [...rasterNoiseStyleSelects, ...rasterNoiseChannelsSelects]) {
  select.addEventListener("change", () => {
    const surface: RasterNoiseSurface = select.id.startsWith("mobile") ? "mobile" : "desktop";
    const settings = rasterNoiseSettingsFromSurface(surface);
    syncRasterNoiseSettings(settings);
    updateRasterNoiseFromUi(surface);
  });
}
for (const input of rasterNoiseAdditiveInputs) {
  input.addEventListener("change", () => {
    const surface: RasterNoiseSurface = input.id.startsWith("mobile") ? "mobile" : "desktop";
    const settings = rasterNoiseSettingsFromSurface(surface);
    syncRasterNoiseSettings(settings);
    updateRasterNoiseFromUi(surface);
  });
}
for (const button of rasterNoiseCancelButtons) {
  button.addEventListener("click", () => {
    void cancelRasterNoiseFromUi();
  });
}
for (const button of rasterNoiseApplyButtons) {
  button.addEventListener("click", () => {
    void applyRasterNoiseFromUi();
  });
}
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || rasterNoiseSurface !== "desktop") return;
  event.preventDefault();
  void cancelRasterNoiseFromUi();
});
mobileUndoButton.addEventListener("click", () => {
  requestHistoryOperation("undo");
});
mobileRedoButton.addEventListener("click", () => {
  requestHistoryOperation("redo");
});
fitViewButton.addEventListener("click", () => {
  if (!canvasViewOperationLocked() && activePointerId === null) {
    engine.fitView();
  }
});
zoomInButton.addEventListener("click", () => {
  if (!canvasViewOperationLocked() && activePointerId === null) {
    engine.zoomBy(1.35);
  }
});
zoomOutButton.addEventListener("click", () => {
  if (!canvasViewOperationLocked() && activePointerId === null) {
    engine.zoomBy(1 / 1.35);
  }
});
rotateViewLeftButton.addEventListener("click", () => {
  if (!canvasViewOperationLocked() && activePointerId === null) {
    engine.rotateViewBy(-Math.PI / 12);
  }
});
viewRotationButton.addEventListener("click", () => {
  if (!canvasViewOperationLocked() && activePointerId === null) {
    engine.resetViewRotation();
  }
});
rotateViewRightButton.addEventListener("click", () => {
  if (!canvasViewOperationLocked() && activePointerId === null) {
    engine.rotateViewBy(Math.PI / 12);
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

interface VectorZoomStressReport {
  version: 1;
  strategy: typeof VECTOR_TEXT_ZOOM_STRESS_STRATEGY;
  textCount: number;
  profileOrder: readonly string[];
  profileCounts: {
    arch: number;
    dropShadow: number;
    blockShadow: number;
    innerShadow: number;
  };
  targetZoom: number;
  finalZoom: number;
  zoomSteps: number;
  gestureDurationMs: number;
  recoveryDurationMs: number;
  exactRenderDeltaDuringRecovery: number;
  effectRefinementRenderDelta: number;
  slowFrameThresholdMs: number;
  rafIntervalsMs: number[];
  slowFrameCount: number;
  rafP95Ms: number;
  rafMaximumMs: number;
  exactRenderDeltaDuringSafeGesture: number;
  fastActivationDelta: number;
  safeReprojectionDelta: number;
  clippedReprojectionDelta: number;
  unsafeExactRefreshDelta: number;
  unsafeExactCoalescedDelta: number;
  fastPresentationSubmitDelta: number;
  fastPresentationCoalescedDelta: number;
  exactRecoveryDelta: number;
  latestViewRevision: number;
  checks: {
    exactlyTenTexts: boolean;
    allProfilesCovered: boolean;
    reachedZoom64: boolean;
    fastPathActivated: boolean;
    safeGestureStayedCovered: boolean;
    safeGestureExactRendersBounded: boolean;
    exactRecoveryLatestOnly: boolean;
    finalModePrecise: boolean;
  };
  passed: boolean;
}

interface VectorZoomAbReport {
  version: 1;
  strategy: typeof VECTOR_TEXT_ZOOM_AB_STRATEGY;
  variant: "A" | "B";
  refreshMode: "during" | "release";
  refreshPolicy: "during-gesture" | "on-release";
  traceFingerprint: string;
  textCount: number;
  idleFrameCount: number;
  sampleCount: number;
  startZoom: number;
  finalZoom: number;
  environment: {
    userAgent: string;
    gpuLabel: string;
    visibilityAtStart: DocumentVisibilityState;
    visibilityAtEnd: DocumentVisibilityState;
    devicePixelRatioAtStart: number;
    devicePixelRatioAtEnd: number;
    viewportWidthAtStart: number;
    viewportHeightAtStart: number;
    viewportWidthAtEnd: number;
    viewportHeightAtEnd: number;
    canvasWidthAtStart: number;
    canvasHeightAtStart: number;
    canvasWidthAtEnd: number;
    canvasHeightAtEnd: number;
    canvasCssWidthAtStart: number;
    canvasCssHeightAtStart: number;
    canvasCssWidthAtEnd: number;
    canvasCssHeightAtEnd: number;
  };
  idleFrameIntervalsMs: number[];
  idleFrameMedianMs: number;
  gestureFrameIntervalsMs: number[];
  eventToNextFrameMs: number[];
  gestureDurationMs: number;
  frameP50Ms: number;
  frameP95Ms: number;
  frameMaximumMs: number;
  framesOver20Ms: number;
  framesOver33Ms: number;
  normalizedMissedFrameCount: number;
  eventToNextFrameP95Ms: number;
  queuePrefixAndCallbackWaitMs: number;
  recoveryDurationMs: number;
  totalMeasuredDurationMs: number;
  exactRenderDeltaDuringGesture: number;
  exactRenderDeltaDuringRecovery: number;
  safeReprojectionDelta: number;
  clippedReprojectionDelta: number;
  unsafeExactRefreshStartedDelta: number;
  unsafeExactRefreshCompletedDelta: number;
  unsafeExactCoalescedDelta: number;
  unsafeExactRefreshInFlightAtRelease: boolean;
  unsafeExactRefreshRequestPendingAtRelease: boolean;
  fastPresentationSubmitDelta: number;
  fastPresentationCoalescedDelta: number;
  exactRecoveryDelta: number;
  latestViewRevision: number;
  checks: {
    exactlyTenTexts: boolean;
    fixedTraceCompleted: boolean;
    startedAndStayedAtZoom64: boolean;
    everyGestureEventWasClipped: boolean;
    refreshBehaviorValidated: boolean;
    exactRecoveryLatestOnly: boolean;
    finalModePrecise: boolean;
    effectsStayedSettled: boolean;
    environmentStayedStable: boolean;
  };
  passed: boolean;
}

interface VectorZoomCoverageReport {
  version: 1;
  strategy: typeof VECTOR_TEXT_ZOOM_C_STRATEGY;
  variant: "C";
  runCode: string;
  traceFingerprint: string;
  initialRasterWasEmpty: boolean;
  textCount: number;
  profileOrder: readonly string[];
  idleFrameCount: number;
  sampleCount: number;
  gestureTargetDurationMs: number;
  startZoom: number;
  targetZoom: number;
  finalZoom: number;
  fallbackCaptureZoom: number;
  fallbackTextureCount: number;
  fallbackRunCount: number;
  fallbackGpuMemoryMiB: number;
  fallbackProbeAlphaPixelCounts: number[];
  rasterLayerCountAfterFallbackRebuild: number;
  selectedRasterAfterFallbackRebuild: boolean;
  automaticFallbackRebuildDelta: number;
  fastCompositeProbeAlphaPixelCounts: number[];
  witnessesOutsideStartCount: number;
  witnessesInsideTargetCount: number;
  environment: {
    userAgent: string;
    gpuLabel: string;
    visibilityAtStart: DocumentVisibilityState;
    visibilityAtEnd: DocumentVisibilityState;
    devicePixelRatioAtStart: number;
    devicePixelRatioAtEnd: number;
    viewportWidthAtStart: number;
    viewportHeightAtStart: number;
    viewportWidthAtEnd: number;
    viewportHeightAtEnd: number;
    canvasWidthAtStart: number;
    canvasHeightAtStart: number;
    canvasWidthAtEnd: number;
    canvasHeightAtEnd: number;
  };
  idleFrameIntervalsMs: number[];
  idleFrameMedianMs: number;
  gestureFrameIntervalsMs: number[];
  eventToNextFrameMs: number[];
  presentationModes: string[];
  fastSubmittedRevisionLagSamples: number[];
  fastCompletedRevisionLagSamples: number[];
  gestureDurationMs: number;
  frameP50Ms: number;
  frameP95Ms: number;
  frameMaximumMs: number;
  framesOver20Ms: number;
  framesOver33Ms: number;
  normalizedMissedFrameCount: number;
  eventToNextFrameP95Ms: number;
  queuePrefixAndCallbackWaitMs: number;
  finalFastAckDurationMs: number;
  fastCompositeProbeDurationMs: number;
  fastVerificationDurationMs: number;
  fastVerificationError: string | null;
  recoveryDurationMs: number;
  totalMeasuredDurationMs: number;
  exactRenderDeltaDuringGesture: number;
  exactRenderDeltaDuringRecovery: number;
  safeReprojectionDelta: number;
  fallbackReprojectionDelta: number;
  clippedReprojectionDelta: number;
  unsafeExactRefreshStartedDelta: number;
  unsafeExactRefreshCompletedDelta: number;
  fastPresentationSubmitDelta: number;
  fastPresentationCoalescedDelta: number;
  requiredFastPresentationSubmitCount: number;
  fastPresentationRateHz: number;
  fastPresentationMaximumInFlight: number;
  fastPresentationInFlightAtTraceEnd: number;
  fastSubmittedRevisionLagMaximum: number;
  fastCompletedRevisionLagP95: number;
  fastCompletedRevisionLagMaximum: number;
  finalFastRequestedRevision: number;
  finalFastSubmittedRevision: number;
  finalFastCompletedRevision: number;
  exactRecoveryDelta: number;
  latestViewRevision: number;
  checks: {
    exactlyTenDistributedTexts: boolean;
    fixedFastZoomOutCompleted: boolean;
    fallbackPreparedBeforeGesture: boolean;
    fallbackPixelsPresent: boolean;
    rasterLifecycleRebuiltFallback: boolean;
    finalFastFrameAcknowledged: boolean;
    fastCompositePixelsPresent: boolean;
    witnessesExerciseReveal: boolean;
    everyZoomStepCovered: boolean;
    noClippedOrExactWorkDuringGesture: boolean;
    fastPresentationFlowed: boolean;
    framePacingWithinBudget: boolean;
    recoveryWithinBudget: boolean;
    exactRecoveryLatestOnly: boolean;
    finalModePrecise: boolean;
    effectsStayedSettled: boolean;
    environmentStayedStable: boolean;
  };
  passed: boolean;
}

function makeVectorZoomRunCode(): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const random = new Uint8Array(8);
  crypto.getRandomValues(random);
  return Array.from(random, (value) => alphabet[value % alphabet.length]).join("");
}

async function saveVectorZoomCoverageReport(
  report: VectorZoomCoverageReport,
): Promise<{ saved: boolean; message: string }> {
  const hashUrl = new URL(window.location.href);
  hashUrl.hash = `zoomRun=${report.runCode}`;
  history.replaceState(history.state, "", hashUrl);
  if (import.meta.env.DEV) {
    return { saved: false, message: "Modalità locale: JSON disponibile nella pagina." };
  }

  const payload = {
    version: 1,
    kind: "vector-zoom-c",
    runCode: report.runCode,
    report,
  } as const;
  let lastError = "salvataggio non riuscito";
  for (const delayMs of [0, 450, 1200]) {
    if (delayMs > 0) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch("/api/vector-zoom-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(errorPayload?.error ?? `HTTP ${response.status}`);
      }
      return {
        saved: true,
        message: `Report salvato nel progetto · codice ${report.runCode}`,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    } finally {
      window.clearTimeout(timeout);
    }
  }
  return {
    saved: false,
    message: `Test finito, report non salvato (${lastError}). Il JSON resta visibile.`,
  };
}

async function waitForVectorTextStable(
  minimumRecoveryCount = 0,
): Promise<ReturnType<MixedVectorTextController["getDiagnostics"]>> {
  const controller = vectorTextPrototype;
  if (!controller) throw new Error("Controller testo assente nello stress zoom.");
  let consecutiveStableFrames = 0;
  for (let frame = 0; frame < 360; frame += 1) {
    await nextAnimationFrame();
    const diagnostics = controller.getDiagnostics();
    const stable = diagnostics.zoomRenderMode === "precise"
      && diagnostics.zoomExactRecoveryCount >= minimumRecoveryCount
      && diagnostics.effectWorkerPendingJobs === 0
      && diagnostics.atomicEffectPendingNodes === 0;
    consecutiveStableFrames = stable ? consecutiveStableFrames + 1 : 0;
    if (consecutiveStableFrames >= 2) {
      await engine.waitForIdle();
      return controller.getDiagnostics();
    }
  }
  throw new Error("Stress zoom: renderer vettoriale non stabilizzato entro 360 frame.");
}

function showVectorZoomAbReport(report: VectorZoomAbReport): void {
  document.getElementById("vectorZoomAbSummary")?.remove();
  const details = document.createElement("details");
  details.id = "vectorZoomAbSummary";
  details.className = `vector-zoom-ab-summary ${report.passed ? "is-ok" : "is-error"}`;
  details.open = true;
  const summary = document.createElement("summary");
  summary.textContent = report.passed
    ? `${report.variant} OK · p95 ${report.frameP95Ms.toFixed(1)} ms · `
      + `>20 ms ${report.framesOver20Ms} · persi ${report.normalizedMissedFrameCount} · `
      + `recovery ${report.recoveryDurationMs.toFixed(1)} ms`
    : `${report.variant} NON VALIDA · apri il report per vedere quale controllo è fallito`;
  const explanation = document.createElement("p");
  explanation.textContent = report.variant === "A"
    ? "A: refresh vettoriale esatto anche durante il gesto."
    : "B: sola reproiezione GPU durante il gesto; refresh esatto al rilascio.";
  const reportElement = document.createElement("pre");
  reportElement.textContent = JSON.stringify(report, null, 2);
  details.append(summary, explanation, reportElement);
  document.body.append(details);
}

function showVectorZoomCoverageReport(
  report: VectorZoomCoverageReport,
  saveMessage: string,
): void {
  document.getElementById("vectorZoomCoverageSummary")?.remove();
  const details = document.createElement("details");
  details.id = "vectorZoomCoverageSummary";
  details.className = `vector-zoom-ab-summary ${report.passed ? "is-ok" : "is-error"}`;
  details.open = true;
  const summary = document.createElement("summary");
  summary.textContent = report.passed
    ? `C OK · 800%→30% · p95 ${report.frameP95Ms.toFixed(1)} ms · `
      + `frame scoperti ${report.clippedReprojectionDelta} · codice ${report.runCode}`
    : `C NON VALIDA · codice ${report.runCode} · apri il report`;
  const explanation = document.createElement("p");
  explanation.textContent =
    "C usa la cache GPU nitida dove copre e una seconda cache GPU larga per i vettori "
    + "che entrano nell'inquadratura durante lo zoom-out. "
    + saveMessage;
  const reportElement = document.createElement("pre");
  reportElement.textContent = JSON.stringify(report, null, 2);
  details.append(summary, explanation, reportElement);
  document.body.append(details);
}

async function runRequestedVectorZoomCoverage(): Promise<void> {
  if (!vectorZoomCoverageRequested || vectorZoomRunCode === null) return;
  const controller = vectorTextPrototype;
  if (!controller) throw new Error("Controller testo non disponibile per il test C zoom.");
  const initialScene = engine.getMixedSceneSnapshot();
  const initialStats = engine.getStats();
  const initialRasterWasEmpty = initialStats.layerCount === 1
    && initialStats.layers.length === 1
    && initialStats.layers[0].hasContent === false;
  if (
    !initialScene
    || initialScene.items.some((item) => item.kind !== "raster")
    || !initialRasterWasEmpty
  ) {
    throw new Error("Il test C zoom richiede una pagina nuova con un solo raster vuoto.");
  }

  statusElement.textContent = "Preparo C: 10 testi distribuiti e copertura GPU overscan al 20%…";
  statusElement.className = "status";
  const fixtures = Array.from(
    { length: VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT },
    (_, index) => vectorTextZoomCoverageSeed(index, engine.layerSize, {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      targetZoom: VECTOR_TEXT_ZOOM_C_TARGET_ZOOM,
    }),
  );
  const beforeInsert = controller.getDiagnostics();
  await engine.addVectorTextNodesBatch(fixtures.map((fixture, index) => ({
    seed: fixture.seed,
    name: `C ${fixture.profile} ${String(index + 1).padStart(2, "0")}`,
  })));
  await waitForVectorTextRenderAfter(beforeInsert.renderCount);
  await waitForVectorTextStable();

  let fallbackCaptureZoom = 0;
  let fallbackTextureCount = 0;
  let fallbackRunCount = 0;
  let fallbackGpuMemoryMiB = 0;
  let fallbackProbeAlphaPixelCounts: number[] = [];
  let rasterLayerCountAfterFallbackRebuild = 0;
  let selectedRasterAfterFallbackRebuild = false;
  let automaticFallbackRebuildDelta = 0;
  let fallbackCompleteAfterRaster = false;
  controller.setAdaptiveZoomEnabled(false);
  try {
    let beforeCameraRender = controller.getDiagnostics();
    engine.fitView();
    await waitForVectorTextRenderAfter(beforeCameraRender.renderCount);
    await waitForVectorTextStable();

    const rectangle = canvas.getBoundingClientRect();
    const anchorX = rectangle.left + rectangle.width * 0.5;
    const anchorY = rectangle.top + rectangle.height * 0.5;
    beforeCameraRender = controller.getDiagnostics();
    engine.zoomBy(
      VECTOR_TEXT_ZOOM_C_START_ZOOM / engine.getVectorTextViewState().zoom,
      anchorX,
      anchorY,
    );
    await waitForVectorTextRenderAfter(beforeCameraRender.renderCount);
    await waitForVectorTextStable();

    const beforeRasterLifecycle = controller.getDiagnostics();
    await engine.addLayer("C raster lifecycle");
    await waitForVectorTextRenderAfter(beforeRasterLifecycle.renderCount);
    const afterRasterLifecycle = await waitForVectorTextStable();
    automaticFallbackRebuildDelta = afterRasterLifecycle.fallbackPresentationRebuildCount
      - beforeRasterLifecycle.fallbackPresentationRebuildCount;
    const fallback = engine.getVectorTextFallbackPresentationStats();
    fallbackCaptureZoom = fallback.captureView?.zoom ?? 0;
    fallbackTextureCount = fallback.textureCount;
    fallbackGpuMemoryMiB = fallback.gpuMemoryMiB;
    fallbackCompleteAfterRaster = fallback.complete;
    const postRasterScene = engine.getMixedSceneSnapshot();
    const selectedPostRasterItem = postRasterScene?.items.find(
      (item) => item.key === postRasterScene.selectedKey,
    );
    rasterLayerCountAfterFallbackRebuild = engine.getStats().layerCount;
    selectedRasterAfterFallbackRebuild = selectedPostRasterItem?.kind === "raster";
    await engine.waitForVectorTextPresentationCompletion();
    const probe = await engine.probeVectorTextFallbackAlpha(
      fixtures.map(({ seed }) => ({ x: seed.x, y: seed.y })),
    );
    fallbackRunCount = probe.runCount;
    fallbackProbeAlphaPixelCounts = probe.alphaPixelCounts;
  } finally {
    controller.setAdaptiveZoomEnabled(true);
  }
  await waitForVectorTextStable();

  const startRectangle = canvas.getBoundingClientRect();
  const environmentStart = {
    visibility: document.visibilityState,
    devicePixelRatio: window.devicePixelRatio,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
  };
  const idleFrameIntervalsMs: number[] = [];
  let idlePreviousRaf = await nextAnimationFrame();
  for (let index = 0; index < VECTOR_TEXT_ZOOM_C_IDLE_FRAME_COUNT; index += 1) {
    const timestamp = await nextAnimationFrame();
    idleFrameIntervalsMs.push(Math.max(0, timestamp - idlePreviousRaf));
    idlePreviousRaf = timestamp;
  }
  const idleFrameMedianMs = percentile(idleFrameIntervalsMs, 0.5);

  const before = controller.getDiagnostics();
  const startView = engine.getVectorTextViewState();
  const startZoom = startView.zoom;
  const gestureFrameIntervalsMs: number[] = [];
  const eventToNextFrameMs: number[] = [];
  const presentationModes: string[] = [];
  const fastSubmittedRevisionLagSamples: number[] = [];
  const fastCompletedRevisionLagSamples: number[] = [];
  const rectangle = canvas.getBoundingClientRect();
  let previousRaf = await nextAnimationFrame();
  const gestureStartedAt = performance.now();
  controller.beginViewGesture();
  for (let index = 0; index < VECTOR_TEXT_ZOOM_C_SAMPLE_LIMIT; index += 1) {
    const progress = Math.min(
      1,
      (performance.now() - gestureStartedAt) / VECTOR_TEXT_ZOOM_C_GESTURE_DURATION_MS,
    );
    const plannedZoom = VECTOR_TEXT_ZOOM_C_START_ZOOM * (
      VECTOR_TEXT_ZOOM_C_TARGET_ZOOM / VECTOR_TEXT_ZOOM_C_START_ZOOM
    ) ** progress;
    const anchorX = rectangle.left + rectangle.width * (
      0.68 + Math.sin(progress * Math.PI * 2) * 0.035
    );
    const anchorY = rectangle.top + rectangle.height * (
      0.44 + Math.cos(progress * Math.PI * 2) * 0.025
    );
    const eventStartedAt = performance.now();
    engine.zoomBy(
      plannedZoom / engine.getVectorTextViewState().zoom,
      anchorX,
      anchorY,
    );
    const timestamp = await nextAnimationFrame();
    gestureFrameIntervalsMs.push(Math.max(0, timestamp - previousRaf));
    eventToNextFrameMs.push(Math.max(0, performance.now() - eventStartedAt));
    presentationModes.push(controller.getDiagnostics().zoomFastPresentationMode);
    const fastRevisions = engine.getVectorTextFastPresentationBackpressureStats();
    fastSubmittedRevisionLagSamples.push(Math.max(
      0,
      fastRevisions.requestedRevision - fastRevisions.submittedRevision,
    ));
    fastCompletedRevisionLagSamples.push(Math.max(
      0,
      fastRevisions.requestedRevision - fastRevisions.completedRevision,
    ));
    previousRaf = timestamp;
    if (progress >= 1) break;
  }
  const duringTrace = controller.getDiagnostics();
  const duringFastBackpressure = engine.getVectorTextFastPresentationBackpressureStats();
  const gestureDurationMs = performance.now() - gestureStartedAt;
  const queuePrefixStartedAt = performance.now();
  const queuePrefixPromise = engine.waitForVectorTextPresentationCompletion()
    .then(() => performance.now() - queuePrefixStartedAt);
  const finalFastRequestedRevision = engine
    .getVectorTextFastPresentationBackpressureStats().requestedRevision;
  const fastVerificationStartedAt = performance.now();
  let fastVerificationError: string | null = null;
  let fastCompositeProbeAlphaPixelCounts: number[] = [];
  let finalFastAckDurationMs = 0;
  let fastCompositeProbeDurationMs = 0;
  try {
    const finalFastAckStartedAt = performance.now();
    await engine.waitForVectorTextFastPresentationRevision(finalFastRequestedRevision);
    finalFastAckDurationMs = performance.now() - finalFastAckStartedAt;
    const fastCompositeProbeStartedAt = performance.now();
    try {
      const fastCompositeProbe = await engine.probeVectorTextFastCompositeAlpha(
        fixtures.map(({ seed }) => ({ x: seed.x, y: seed.y })),
      );
      fastCompositeProbeAlphaPixelCounts = fastCompositeProbe.alphaPixelCounts;
    } finally {
      fastCompositeProbeDurationMs = performance.now() - fastCompositeProbeStartedAt;
    }
  } catch (error) {
    if (finalFastAckDurationMs === 0) {
      finalFastAckDurationMs = performance.now() - fastVerificationStartedAt;
    }
    fastVerificationError = error instanceof Error ? error.message : String(error);
  }
  const finalFastRevisions = engine.getVectorTextFastPresentationBackpressureStats();
  const fastVerificationDurationMs = performance.now() - fastVerificationStartedAt;
  const duringVerified = controller.getDiagnostics();
  const recoveryStartedAt = performance.now();
  controller.endViewGesture();
  const after = await waitForVectorTextStable(before.zoomExactRecoveryCount + 1);
  const recoveryDurationMs = performance.now() - recoveryStartedAt;
  const queuePrefixAndCallbackWaitMs = await queuePrefixPromise;
  const totalMeasuredDurationMs = gestureDurationMs
    + finalFastAckDurationMs
    + recoveryDurationMs;
  const finalView = engine.getVectorTextViewState();
  const finalZoom = finalView.zoom;
  const environmentEnd = {
    visibility: document.visibilityState,
    devicePixelRatio: window.devicePixelRatio,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
  };

  const exactRenderDeltaDuringGesture = duringVerified.renderCount - before.renderCount;
  const exactRenderDeltaDuringRecovery = after.renderCount - duringVerified.renderCount;
  const safeReprojectionDelta =
    duringVerified.zoomSafeReprojectionCount - before.zoomSafeReprojectionCount;
  const fallbackReprojectionDelta =
    duringVerified.zoomFallbackReprojectionCount - before.zoomFallbackReprojectionCount;
  const clippedReprojectionDelta =
    duringVerified.zoomClippedReprojectionCount - before.zoomClippedReprojectionCount;
  const unsafeExactRefreshStartedDelta =
    duringVerified.zoomUnsafeExactRefreshCount - before.zoomUnsafeExactRefreshCount;
  const unsafeExactRefreshCompletedDelta =
    duringVerified.zoomUnsafeExactRefreshCompletedCount
    - before.zoomUnsafeExactRefreshCompletedCount;
  const exactRecoveryDelta = after.zoomExactRecoveryCount - before.zoomExactRecoveryCount;
  const normalizedMissedFrameCount = idleFrameMedianMs > 0
    ? gestureFrameIntervalsMs.reduce(
      (count, duration) => count + Math.max(0, Math.round(duration / idleFrameMedianMs) - 1),
      0,
    )
    : 0;
  const profileOrder = fixtures.map((fixture) => fixture.profile);
  const sampleCount = gestureFrameIntervalsMs.length;
  const frameP95Ms = percentile(gestureFrameIntervalsMs, 0.95);
  const framesOver20Ms = gestureFrameIntervalsMs.filter((duration) => duration > 20).length;
  const framesOver33Ms = gestureFrameIntervalsMs.filter((duration) => duration > 33).length;
  const fastPresentationSubmitDelta =
    duringTrace.zoomFastPresentationSubmissionCount
    - before.zoomFastPresentationSubmissionCount;
  const fastPresentationCoalescedDelta =
    duringTrace.zoomFastPresentationCoalescedRequestCount
    - before.zoomFastPresentationCoalescedRequestCount;
  const requiredFastPresentationSubmitCount = Math.max(
    1,
    Math.ceil(Math.min(
      sampleCount,
      gestureDurationMs * 55 / 1000,
    )),
  );
  const fastPresentationRateHz = gestureDurationMs > 0
    ? fastPresentationSubmitDelta * 1000 / gestureDurationMs
    : 0;
  const fastPresentationMaximumInFlight = duringFastBackpressure.maximumInFlightCount;
  const fastPresentationInFlightAtTraceEnd = duringFastBackpressure.inFlightCount;
  const fastSubmittedRevisionLagMaximum = Math.max(
    0,
    ...fastSubmittedRevisionLagSamples,
  );
  const fastCompletedRevisionLagP95 = percentile(fastCompletedRevisionLagSamples, 0.95);
  const fastCompletedRevisionLagMaximum = Math.max(
    0,
    ...fastCompletedRevisionLagSamples,
  );
  const witnessesOutsideStartCount = fixtures.filter(({ seed }) => (
    Math.abs(seed.x - startView.centerX) * startZoom > canvas.width * 0.5
    || Math.abs(seed.y - startView.centerY) * startZoom > canvas.height * 0.5
  )).length;
  const witnessesInsideTargetCount = fixtures.filter(({ seed }) => (
    Math.abs(seed.x - finalView.centerX) * VECTOR_TEXT_ZOOM_C_TARGET_ZOOM
      < canvas.width * 0.5
    && Math.abs(seed.y - finalView.centerY) * VECTOR_TEXT_ZOOM_C_TARGET_ZOOM
      < canvas.height * 0.5
  )).length;
  const expectedFallbackGpuMemoryMiB = canvas.width * canvas.height * 4 / (1024 * 1024);
  const emptyFallbackWitnessCount = fallbackProbeAlphaPixelCounts.filter(
    (count) => count === 0,
  ).length;
  const checks = {
    exactlyTenDistributedTexts:
      initialRasterWasEmpty
      && after.textNodeCount === VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT
      && engine.getMixedSceneSnapshot()?.items.filter((item) => item.kind === "text").length
        === VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT,
    fixedFastZoomOutCompleted:
      sampleCount >= 2
      && sampleCount <= VECTOR_TEXT_ZOOM_C_SAMPLE_LIMIT
      && gestureDurationMs >= VECTOR_TEXT_ZOOM_C_GESTURE_DURATION_MS
      && Math.abs(startZoom - VECTOR_TEXT_ZOOM_C_START_ZOOM) < 1e-6
      && Math.abs(finalZoom - VECTOR_TEXT_ZOOM_C_TARGET_ZOOM) < 1e-6,
    fallbackPreparedBeforeGesture:
      fallbackTextureCount === 1
      && fallbackRunCount === fallbackTextureCount
      && Math.abs(
        fallbackGpuMemoryMiB - expectedFallbackGpuMemoryMiB,
      ) < 1e-6
      && fallbackGpuMemoryMiB <= 16
      && Math.abs(fallbackCaptureZoom - VECTOR_TEXT_ZOOM_C_FALLBACK_ZOOM) < 1e-6,
    fallbackPixelsPresent:
      fallbackProbeAlphaPixelCounts.length === VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT
      && emptyFallbackWitnessCount === 0,
    rasterLifecycleRebuiltFallback:
      rasterLayerCountAfterFallbackRebuild === 2
      && selectedRasterAfterFallbackRebuild
      && automaticFallbackRebuildDelta >= 1
      && fallbackCompleteAfterRaster
      && fallbackTextureCount === fallbackRunCount,
    finalFastFrameAcknowledged:
      finalFastRevisions.submittedRevision === finalFastRequestedRevision
      && finalFastRevisions.completedRevision === finalFastRequestedRevision,
    fastCompositePixelsPresent:
      fastCompositeProbeAlphaPixelCounts.length === VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT
      && fastCompositeProbeAlphaPixelCounts.every((count) => count > 0),
    witnessesExerciseReveal:
      witnessesOutsideStartCount >= 8
      && witnessesInsideTargetCount === VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT,
    everyZoomStepCovered:
      presentationModes.every(
        (mode) => mode === "reproject" || mode === "reproject-fallback",
      )
      && fallbackReprojectionDelta > 0
      && clippedReprojectionDelta === 0,
    noClippedOrExactWorkDuringGesture:
      clippedReprojectionDelta === 0
      && unsafeExactRefreshStartedDelta === 0
      && unsafeExactRefreshCompletedDelta === 0
      && exactRenderDeltaDuringGesture === 0
      && !duringVerified.zoomUnsafeExactRefreshInFlight
      && !duringVerified.zoomUnsafeExactRefreshRequestPending,
    fastPresentationFlowed:
      fastPresentationSubmitDelta >= requiredFastPresentationSubmitCount
      && fastPresentationCoalescedDelta <= Math.ceil(sampleCount * 0.1)
      && fastPresentationMaximumInFlight >= 1
      && fastPresentationMaximumInFlight <= 2
      && fastPresentationInFlightAtTraceEnd <= 2
      && fastSubmittedRevisionLagMaximum <= 2
      && fastCompletedRevisionLagP95 <= 2
      && fastCompletedRevisionLagMaximum <= 2,
    framePacingWithinBudget:
      frameP95Ms <= Math.max(20, idleFrameMedianMs * 1.5)
      && framesOver33Ms <= 1
      && normalizedMissedFrameCount <= 2,
    recoveryWithinBudget:
      finalFastAckDurationMs <= 250
      && queuePrefixAndCallbackWaitMs <= 250
      && recoveryDurationMs <= 1200
      && totalMeasuredDurationMs <= VECTOR_TEXT_ZOOM_C_GESTURE_DURATION_MS + 1500,
    exactRecoveryLatestOnly:
      exactRecoveryDelta === 1
      && after.zoomViewRevision === duringVerified.zoomViewRevision,
    finalModePrecise:
      after.zoomRenderMode === "precise"
      && after.zoomFastPresentationMode === "precise",
    effectsStayedSettled:
      before.effectWorkerPendingJobs === 0
      && duringTrace.effectWorkerPendingJobs === 0
      && duringVerified.effectWorkerPendingJobs === 0
      && after.effectWorkerPendingJobs === 0
      && before.atomicEffectPendingNodes === 0
      && duringTrace.atomicEffectPendingNodes === 0
      && duringVerified.atomicEffectPendingNodes === 0
      && after.atomicEffectPendingNodes === 0,
    environmentStayedStable:
      environmentStart.visibility === "visible"
      && environmentEnd.visibility === "visible"
      && environmentEnd.devicePixelRatio === environmentStart.devicePixelRatio
      && environmentEnd.viewportWidth === environmentStart.viewportWidth
      && environmentEnd.viewportHeight === environmentStart.viewportHeight
      && environmentEnd.canvasWidth === environmentStart.canvasWidth
      && environmentEnd.canvasHeight === environmentStart.canvasHeight
      && Math.abs(canvas.getBoundingClientRect().width - startRectangle.width) < 0.5
      && Math.abs(canvas.getBoundingClientRect().height - startRectangle.height) < 0.5,
  };
  const report: VectorZoomCoverageReport = {
    version: 1,
    strategy: VECTOR_TEXT_ZOOM_C_STRATEGY,
    variant: "C",
    runCode: vectorZoomRunCode,
    initialRasterWasEmpty,
    traceFingerprint:
      `texts:${VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT}|zoom:${VECTOR_TEXT_ZOOM_C_START_ZOOM}`
      + `->${VECTOR_TEXT_ZOOM_C_TARGET_ZOOM}|duration:${VECTOR_TEXT_ZOOM_C_GESTURE_DURATION_MS}`
      + `|fallback:auto-post-raster|window:2|anchor:drift|coverage:dual-gpu`,
    textCount: after.textNodeCount,
    profileOrder,
    idleFrameCount: VECTOR_TEXT_ZOOM_C_IDLE_FRAME_COUNT,
    sampleCount,
    gestureTargetDurationMs: VECTOR_TEXT_ZOOM_C_GESTURE_DURATION_MS,
    startZoom,
    targetZoom: VECTOR_TEXT_ZOOM_C_TARGET_ZOOM,
    finalZoom,
    fallbackCaptureZoom,
    fallbackTextureCount,
    fallbackRunCount,
    fallbackGpuMemoryMiB,
    fallbackProbeAlphaPixelCounts,
    rasterLayerCountAfterFallbackRebuild,
    selectedRasterAfterFallbackRebuild,
    automaticFallbackRebuildDelta,
    fastCompositeProbeAlphaPixelCounts,
    witnessesOutsideStartCount,
    witnessesInsideTargetCount,
    environment: {
      userAgent: navigator.userAgent,
      gpuLabel: engine.getBenchmarkEnvironment().gpuLabel,
      visibilityAtStart: environmentStart.visibility,
      visibilityAtEnd: environmentEnd.visibility,
      devicePixelRatioAtStart: environmentStart.devicePixelRatio,
      devicePixelRatioAtEnd: environmentEnd.devicePixelRatio,
      viewportWidthAtStart: environmentStart.viewportWidth,
      viewportHeightAtStart: environmentStart.viewportHeight,
      viewportWidthAtEnd: environmentEnd.viewportWidth,
      viewportHeightAtEnd: environmentEnd.viewportHeight,
      canvasWidthAtStart: environmentStart.canvasWidth,
      canvasHeightAtStart: environmentStart.canvasHeight,
      canvasWidthAtEnd: environmentEnd.canvasWidth,
      canvasHeightAtEnd: environmentEnd.canvasHeight,
    },
    idleFrameIntervalsMs,
    idleFrameMedianMs,
    gestureFrameIntervalsMs,
    eventToNextFrameMs,
    presentationModes,
    fastSubmittedRevisionLagSamples,
    fastCompletedRevisionLagSamples,
    gestureDurationMs,
    frameP50Ms: percentile(gestureFrameIntervalsMs, 0.5),
    frameP95Ms,
    frameMaximumMs: Math.max(0, ...gestureFrameIntervalsMs),
    framesOver20Ms,
    framesOver33Ms,
    normalizedMissedFrameCount,
    eventToNextFrameP95Ms: percentile(eventToNextFrameMs, 0.95),
    queuePrefixAndCallbackWaitMs,
    finalFastAckDurationMs,
    fastCompositeProbeDurationMs,
    fastVerificationDurationMs,
    fastVerificationError,
    recoveryDurationMs,
    totalMeasuredDurationMs,
    exactRenderDeltaDuringGesture,
    exactRenderDeltaDuringRecovery,
    safeReprojectionDelta,
    fallbackReprojectionDelta,
    clippedReprojectionDelta,
    unsafeExactRefreshStartedDelta,
    unsafeExactRefreshCompletedDelta,
    fastPresentationSubmitDelta,
    fastPresentationCoalescedDelta,
    requiredFastPresentationSubmitCount,
    fastPresentationRateHz,
    fastPresentationMaximumInFlight,
    fastPresentationInFlightAtTraceEnd,
    fastSubmittedRevisionLagMaximum,
    fastCompletedRevisionLagP95,
    fastCompletedRevisionLagMaximum,
    finalFastRequestedRevision,
    finalFastSubmittedRevision: finalFastRevisions.submittedRevision,
    finalFastCompletedRevision: finalFastRevisions.completedRevision,
    exactRecoveryDelta,
    latestViewRevision: after.zoomViewRevision,
    checks,
    passed: Object.values(checks).every(Boolean),
  };
  (
    window as Window & { __vectorZoomCoverageReport?: VectorZoomCoverageReport }
  ).__vectorZoomCoverageReport = report;
  layerMemoryStressReport.textContent = JSON.stringify(report, null, 2);
  layerMemoryStressDetails.hidden = false;
  layerMemoryStressDetails.open = true;
  layerMemoryStressResult.className = report.passed ? "result ok" : "result error";
  layerMemoryStressResult.textContent = report.passed
    ? `C OK · p95 ${report.frameP95Ms.toFixed(1)} ms · `
      + `${report.framesOver20Ms} frame oltre 20 ms · salvataggio in corso…`
    : "C NON VALIDA: report disponibile, salvataggio in corso…";
  statusElement.textContent = layerMemoryStressResult.textContent;
  statusElement.className = report.passed ? "status ok" : "status error";
  const save = await saveVectorZoomCoverageReport(report);
  layerMemoryStressResult.textContent = report.passed
    ? `C OK · p95 ${report.frameP95Ms.toFixed(1)} ms · `
      + `frame scoperti ${report.clippedReprojectionDelta} · ${save.message}`
    : `C NON VALIDA · ${save.message}`;
  statusElement.textContent = layerMemoryStressResult.textContent;
  showVectorZoomCoverageReport(report, save.message);
}

async function runRequestedVectorZoomAb(): Promise<void> {
  if (!vectorZoomAbRequested || vectorZoomRefreshMode === null) return;
  const controller = vectorTextPrototype;
  if (!controller) throw new Error("Controller testo non disponibile per il test A/B zoom.");
  const refreshMode = vectorZoomRefreshMode;
  const variant = refreshMode === "during" ? "A" : "B";
  const initialScene = engine.getMixedSceneSnapshot();
  if (!initialScene || initialScene.items.some((item) => item.kind !== "raster")) {
    throw new Error("Il test A/B zoom richiede una pagina nuova con il solo raster iniziale.");
  }

  statusElement.textContent = `Preparo la variante ${variant}: 10 testi, zoom 64×…`;
  statusElement.className = "status";
  const entries = Array.from(
    { length: VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT },
    (_, index) => {
      const fixture = vectorTextZoomStressSeed(index, engine.layerSize);
      return {
        seed: fixture.seed,
        name: `A/B ${fixture.profile} ${String(index + 1).padStart(2, "0")}`,
      };
    },
  );
  const beforeInsert = controller.getDiagnostics();
  await engine.addVectorTextNodesBatch(entries);
  await waitForVectorTextRenderAfter(beforeInsert.renderCount);
  await waitForVectorTextStable();

  controller.setAdaptiveZoomEnabled(false);
  try {
    let beforeCameraRender = controller.getDiagnostics();
    engine.fitView();
    await waitForVectorTextRenderAfter(beforeCameraRender.renderCount);
    await waitForVectorTextStable();

    const rectangle = canvas.getBoundingClientRect();
    const anchorX = rectangle.left + rectangle.width * 0.5;
    const anchorY = rectangle.top + rectangle.height * 0.5;
    beforeCameraRender = controller.getDiagnostics();
    const currentZoom = engine.getVectorTextViewState().zoom;
    engine.zoomBy(VECTOR_TEXT_ZOOM_AB_START_ZOOM / currentZoom, anchorX, anchorY);
    await waitForVectorTextRenderAfter(beforeCameraRender.renderCount);
    await waitForVectorTextStable();
  } finally {
    controller.setAdaptiveZoomEnabled(true);
  }
  await waitForVectorTextStable();

  const startRectangle = canvas.getBoundingClientRect();
  const environmentStart = {
    visibility: document.visibilityState,
    devicePixelRatio: window.devicePixelRatio,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    canvasCssWidth: startRectangle.width,
    canvasCssHeight: startRectangle.height,
  };
  const idleFrameIntervalsMs: number[] = [];
  let idlePreviousRaf = await nextAnimationFrame();
  for (let index = 0; index < VECTOR_TEXT_ZOOM_AB_IDLE_FRAME_COUNT; index += 1) {
    const timestamp = await nextAnimationFrame();
    idleFrameIntervalsMs.push(Math.max(0, timestamp - idlePreviousRaf));
    idlePreviousRaf = timestamp;
  }
  const idleFrameMedianMs = percentile(idleFrameIntervalsMs, 0.5);

  const before = controller.getDiagnostics();
  const startZoom = engine.getVectorTextViewState().zoom;
  const gestureFrameIntervalsMs: number[] = [];
  const eventToNextFrameMs: number[] = [];
  let previousRaf = await nextAnimationFrame();
  const gestureStartedAt = performance.now();
  controller.beginViewGesture();
  for (let index = 0; index < VECTOR_TEXT_ZOOM_AB_SAMPLE_COUNT; index += 1) {
    const eventStartedAt = performance.now();
    engine.panByClientDelta(1, 0);
    const timestamp = await nextAnimationFrame();
    gestureFrameIntervalsMs.push(Math.max(0, timestamp - previousRaf));
    eventToNextFrameMs.push(Math.max(0, performance.now() - eventStartedAt));
    previousRaf = timestamp;
  }
  const during = controller.getDiagnostics();
  const gestureDurationMs = performance.now() - gestureStartedAt;
  const queuePrefixStartedAt = performance.now();
  const queuePrefixPromise = engine.waitForVectorTextPresentationCompletion()
    .then(() => performance.now() - queuePrefixStartedAt);
  const recoveryStartedAt = performance.now();
  controller.endViewGesture();
  const after = await waitForVectorTextStable(before.zoomExactRecoveryCount + 1);
  const recoveryDurationMs = performance.now() - recoveryStartedAt;
  const queuePrefixAndCallbackWaitMs = await queuePrefixPromise;
  const totalMeasuredDurationMs = performance.now() - gestureStartedAt;
  const finalZoom = engine.getVectorTextViewState().zoom;
  const endRectangle = canvas.getBoundingClientRect();
  const environmentEnd = {
    visibility: document.visibilityState,
    devicePixelRatio: window.devicePixelRatio,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    canvasCssWidth: endRectangle.width,
    canvasCssHeight: endRectangle.height,
  };

  const exactRenderDeltaDuringGesture = during.renderCount - before.renderCount;
  const exactRenderDeltaDuringRecovery = after.renderCount - during.renderCount;
  const safeReprojectionDelta =
    during.zoomSafeReprojectionCount - before.zoomSafeReprojectionCount;
  const clippedReprojectionDelta =
    during.zoomClippedReprojectionCount - before.zoomClippedReprojectionCount;
  const unsafeExactRefreshStartedDelta =
    during.zoomUnsafeExactRefreshCount - before.zoomUnsafeExactRefreshCount;
  const unsafeExactRefreshCompletedDelta =
    during.zoomUnsafeExactRefreshCompletedCount
    - before.zoomUnsafeExactRefreshCompletedCount;
  const unsafeExactCoalescedDelta =
    during.zoomUnsafeExactCoalescedCount - before.zoomUnsafeExactCoalescedCount;
  const exactRecoveryDelta = after.zoomExactRecoveryCount - before.zoomExactRecoveryCount;
  const normalizedMissedFrameCount = idleFrameMedianMs > 0
    ? gestureFrameIntervalsMs.reduce(
      (count, duration) => count + Math.max(0, Math.round(duration / idleFrameMedianMs) - 1),
      0,
    )
    : 0;
  const checks = {
    exactlyTenTexts:
      after.textNodeCount === VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT
      && engine.getMixedSceneSnapshot()?.items.filter((item) => item.kind === "text").length
        === VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT,
    fixedTraceCompleted:
      gestureFrameIntervalsMs.length === VECTOR_TEXT_ZOOM_AB_SAMPLE_COUNT
      && eventToNextFrameMs.length === VECTOR_TEXT_ZOOM_AB_SAMPLE_COUNT,
    startedAndStayedAtZoom64:
      Math.abs(startZoom - VECTOR_TEXT_ZOOM_AB_START_ZOOM) < 1e-6
      && Math.abs(finalZoom - VECTOR_TEXT_ZOOM_AB_START_ZOOM) < 1e-6,
    everyGestureEventWasClipped:
      clippedReprojectionDelta >= VECTOR_TEXT_ZOOM_AB_SAMPLE_COUNT
      && safeReprojectionDelta === 0,
    refreshBehaviorValidated: refreshMode === "during"
      ? unsafeExactRefreshStartedDelta > 0 && unsafeExactRefreshCompletedDelta > 0
      : unsafeExactRefreshStartedDelta === 0
        && unsafeExactRefreshCompletedDelta === 0
        && exactRenderDeltaDuringGesture === 0
        && !during.zoomUnsafeExactRefreshInFlight
        && !during.zoomUnsafeExactRefreshRequestPending,
    exactRecoveryLatestOnly:
      exactRecoveryDelta === 1
      && after.zoomViewRevision === during.zoomViewRevision,
    finalModePrecise:
      after.zoomRenderMode === "precise"
      && after.zoomFastPresentationMode === "precise",
    effectsStayedSettled:
      before.effectWorkerPendingJobs === 0
      && during.effectWorkerPendingJobs === 0
      && after.effectWorkerPendingJobs === 0
      && before.atomicEffectPendingNodes === 0
      && during.atomicEffectPendingNodes === 0
      && after.atomicEffectPendingNodes === 0,
    environmentStayedStable:
      environmentStart.visibility === "visible"
      && environmentEnd.visibility === "visible"
      && environmentEnd.devicePixelRatio === environmentStart.devicePixelRatio
      && environmentEnd.viewportWidth === environmentStart.viewportWidth
      && environmentEnd.viewportHeight === environmentStart.viewportHeight
      && environmentEnd.canvasWidth === environmentStart.canvasWidth
      && environmentEnd.canvasHeight === environmentStart.canvasHeight
      && Math.abs(environmentEnd.canvasCssWidth - environmentStart.canvasCssWidth) < 0.5
      && Math.abs(environmentEnd.canvasCssHeight - environmentStart.canvasCssHeight) < 0.5,
  };
  const report: VectorZoomAbReport = {
    version: 1,
    strategy: VECTOR_TEXT_ZOOM_AB_STRATEGY,
    variant,
    refreshMode,
    refreshPolicy: during.zoomClippedRefreshPolicy,
    traceFingerprint:
      `texts:${VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT}|zoom:${VECTOR_TEXT_ZOOM_AB_START_ZOOM}`
      + `|pan-css-x:+1|frames:${VECTOR_TEXT_ZOOM_AB_SAMPLE_COUNT}`,
    textCount: after.textNodeCount,
    idleFrameCount: VECTOR_TEXT_ZOOM_AB_IDLE_FRAME_COUNT,
    sampleCount: VECTOR_TEXT_ZOOM_AB_SAMPLE_COUNT,
    startZoom,
    finalZoom,
    environment: {
      userAgent: navigator.userAgent,
      gpuLabel: engine.getBenchmarkEnvironment().gpuLabel,
      visibilityAtStart: environmentStart.visibility,
      visibilityAtEnd: environmentEnd.visibility,
      devicePixelRatioAtStart: environmentStart.devicePixelRatio,
      devicePixelRatioAtEnd: environmentEnd.devicePixelRatio,
      viewportWidthAtStart: environmentStart.viewportWidth,
      viewportHeightAtStart: environmentStart.viewportHeight,
      viewportWidthAtEnd: environmentEnd.viewportWidth,
      viewportHeightAtEnd: environmentEnd.viewportHeight,
      canvasWidthAtStart: environmentStart.canvasWidth,
      canvasHeightAtStart: environmentStart.canvasHeight,
      canvasWidthAtEnd: environmentEnd.canvasWidth,
      canvasHeightAtEnd: environmentEnd.canvasHeight,
      canvasCssWidthAtStart: environmentStart.canvasCssWidth,
      canvasCssHeightAtStart: environmentStart.canvasCssHeight,
      canvasCssWidthAtEnd: environmentEnd.canvasCssWidth,
      canvasCssHeightAtEnd: environmentEnd.canvasCssHeight,
    },
    idleFrameIntervalsMs,
    idleFrameMedianMs,
    gestureFrameIntervalsMs,
    eventToNextFrameMs,
    gestureDurationMs,
    frameP50Ms: percentile(gestureFrameIntervalsMs, 0.5),
    frameP95Ms: percentile(gestureFrameIntervalsMs, 0.95),
    frameMaximumMs: Math.max(0, ...gestureFrameIntervalsMs),
    framesOver20Ms: gestureFrameIntervalsMs.filter((duration) => duration > 20).length,
    framesOver33Ms: gestureFrameIntervalsMs.filter((duration) => duration > 33).length,
    normalizedMissedFrameCount,
    eventToNextFrameP95Ms: percentile(eventToNextFrameMs, 0.95),
    queuePrefixAndCallbackWaitMs,
    recoveryDurationMs,
    totalMeasuredDurationMs,
    exactRenderDeltaDuringGesture,
    exactRenderDeltaDuringRecovery,
    safeReprojectionDelta,
    clippedReprojectionDelta,
    unsafeExactRefreshStartedDelta,
    unsafeExactRefreshCompletedDelta,
    unsafeExactCoalescedDelta,
    unsafeExactRefreshInFlightAtRelease: during.zoomUnsafeExactRefreshInFlight,
    unsafeExactRefreshRequestPendingAtRelease:
      during.zoomUnsafeExactRefreshRequestPending,
    fastPresentationSubmitDelta:
      during.zoomFastPresentationSubmissionCount
      - before.zoomFastPresentationSubmissionCount,
    fastPresentationCoalescedDelta:
      during.zoomFastPresentationCoalescedRequestCount
      - before.zoomFastPresentationCoalescedRequestCount,
    exactRecoveryDelta,
    latestViewRevision: after.zoomViewRevision,
    checks,
    passed: Object.values(checks).every(Boolean),
  };
  (
    window as Window & { __vectorZoomAbReport?: VectorZoomAbReport }
  ).__vectorZoomAbReport = report;
  layerMemoryStressReport.textContent = JSON.stringify(report, null, 2);
  layerMemoryStressDetails.hidden = false;
  layerMemoryStressDetails.open = true;
  layerMemoryStressResult.className = report.passed ? "result ok" : "result error";
  layerMemoryStressResult.textContent = report.passed
    ? `${variant} OK · p95 ${report.frameP95Ms.toFixed(1)} ms · `
      + `${report.framesOver20Ms} frame oltre 20 ms · `
      + `recovery ${report.recoveryDurationMs.toFixed(1)} ms.`
    : `${variant} NON VALIDA: consulta il report.`;
  statusElement.textContent = layerMemoryStressResult.textContent;
  statusElement.className = report.passed ? "status ok" : "status error";
  showVectorZoomAbReport(report);
}

async function runRequestedVectorZoomStress(): Promise<void> {
  if (!vectorZoomStressRequested || vectorZoomAbRequested) return;
  const controller = vectorTextPrototype;
  if (!controller) throw new Error("Controller testo non disponibile per lo stress zoom.");
  const initialScene = engine.getMixedSceneSnapshot();
  if (!initialScene || initialScene.items.some((item) => item.kind !== "raster")) {
    throw new Error("Lo stress zoom richiede una pagina nuova con il solo raster iniziale.");
  }

  statusElement.textContent = "Preparo 10 testi semantici per lo stress zoom 64×…";
  statusElement.className = "status";
  const entries = Array.from(
    { length: VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT },
    (_, index) => {
      const fixture = vectorTextZoomStressSeed(index, engine.layerSize);
      return {
        seed: fixture.seed,
        name: `Zoom ${fixture.profile} ${String(index + 1).padStart(2, "0")}`,
      };
    },
  );
  const beforeInsert = controller.getDiagnostics();
  await engine.addVectorTextNodesBatch(entries);
  await waitForVectorTextRenderAfter(beforeInsert.renderCount);
  await waitForVectorTextStable();

  // Fit is setup, not part of the measured gesture. Keeping adaptive zoom off
  // here guarantees one exact capture at a known camera before the burst.
  controller.setAdaptiveZoomEnabled(false);
  const beforeFit = controller.getDiagnostics();
  engine.fitView();
  await waitForVectorTextRenderAfter(beforeFit.renderCount);
  await waitForVectorTextStable();
  controller.setAdaptiveZoomEnabled(true);

  const before = controller.getDiagnostics();
  const rectangle = canvas.getBoundingClientRect();
  const anchorX = rectangle.left + rectangle.width * 0.5;
  const anchorY = rectangle.top + rectangle.height * 0.5;
  const rafIntervalsMs: number[] = [];
  let previousRaf = await nextAnimationFrame();
  let zoomSteps = 0;
  const gestureStartedAt = performance.now();
  controller.beginViewGesture();
  while (
    engine.getVectorTextViewState().zoom < VECTOR_TEXT_ZOOM_STRESS_TARGET_ZOOM - 1e-9
    && zoomSteps < 64
  ) {
    const currentZoom = engine.getVectorTextViewState().zoom;
    const factor = vectorTextZoomStressStepFactor(currentZoom);
    engine.zoomBy(factor, anchorX, anchorY);
    const timestamp = await nextAnimationFrame();
    rafIntervalsMs.push(Math.max(0, timestamp - previousRaf));
    previousRaf = timestamp;
    zoomSteps += 1;
  }
  const during = controller.getDiagnostics();
  const gestureDurationMs = performance.now() - gestureStartedAt;
  const recoveryStartedAt = performance.now();
  controller.endViewGesture();
  const after = await waitForVectorTextStable(before.zoomExactRecoveryCount + 1);
  const recoveryDurationMs = performance.now() - recoveryStartedAt;
  const finalZoom = engine.getVectorTextViewState().zoom;
  const exactRenderDeltaDuringSafeGesture = during.renderCount - before.renderCount;
  const exactRenderDeltaDuringRecovery = after.renderCount - during.renderCount;
  const effectRefinementRenderDelta = Math.max(
    0,
    exactRenderDeltaDuringRecovery - 1,
  );
  const finalScene = engine.getMixedSceneSnapshot();
  const stressNodes = finalScene?.items.flatMap(
    (item) => item.kind === "text" ? [item.textNode] : [],
  ) ?? [];
  const profileCounts = {
    arch: stressNodes.filter((node) => node.transformType === "arch").length,
    dropShadow: stressNodes.filter((node) => node.singleShadowEnabled).length,
    blockShadow: stressNodes.filter((node) => node.blockShadowEnabled).length,
    innerShadow: stressNodes.filter((node) => node.innerShadowEnabled).length,
  };
  const checks = {
    exactlyTenTexts:
      after.textNodeCount === VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT
      && stressNodes.length === VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT,
    allProfilesCovered:
      profileCounts.arch === 3
      && profileCounts.dropShadow === 3
      && profileCounts.blockShadow === 2
      && profileCounts.innerShadow === 2,
    reachedZoom64: Math.abs(finalZoom - VECTOR_TEXT_ZOOM_STRESS_TARGET_ZOOM) < 1e-6,
    fastPathActivated: during.zoomFastActivationCount > before.zoomFastActivationCount,
    safeGestureStayedCovered:
      during.zoomSafeReprojectionCount - before.zoomSafeReprojectionCount >= zoomSteps
      && during.zoomClippedReprojectionCount === before.zoomClippedReprojectionCount,
    safeGestureExactRendersBounded: exactRenderDeltaDuringSafeGesture <= 1,
    exactRecoveryLatestOnly:
      after.zoomExactRecoveryCount - before.zoomExactRecoveryCount === 1
      && after.zoomViewRevision === during.zoomViewRevision,
    finalModePrecise:
      after.zoomRenderMode === "precise"
      && after.zoomFastPresentationMode === "precise",
  };
  const report: VectorZoomStressReport = {
    version: 1,
    strategy: VECTOR_TEXT_ZOOM_STRESS_STRATEGY,
    textCount: after.textNodeCount,
    profileOrder: [...VECTOR_TEXT_ZOOM_STRESS_PROFILE_ORDER],
    profileCounts,
    targetZoom: VECTOR_TEXT_ZOOM_STRESS_TARGET_ZOOM,
    finalZoom,
    zoomSteps,
    gestureDurationMs,
    recoveryDurationMs,
    exactRenderDeltaDuringRecovery,
    effectRefinementRenderDelta,
    slowFrameThresholdMs: VECTOR_TEXT_ZOOM_STRESS_SLOW_FRAME_MS,
    rafIntervalsMs,
    slowFrameCount: rafIntervalsMs.filter(
      (duration) => duration > VECTOR_TEXT_ZOOM_STRESS_SLOW_FRAME_MS,
    ).length,
    rafP95Ms: percentile(rafIntervalsMs, 0.95),
    rafMaximumMs: Math.max(0, ...rafIntervalsMs),
    exactRenderDeltaDuringSafeGesture,
    fastActivationDelta: during.zoomFastActivationCount - before.zoomFastActivationCount,
    safeReprojectionDelta:
      during.zoomSafeReprojectionCount - before.zoomSafeReprojectionCount,
    clippedReprojectionDelta:
      during.zoomClippedReprojectionCount - before.zoomClippedReprojectionCount,
    unsafeExactRefreshDelta:
      during.zoomUnsafeExactRefreshCount - before.zoomUnsafeExactRefreshCount,
    unsafeExactCoalescedDelta:
      during.zoomUnsafeExactCoalescedCount - before.zoomUnsafeExactCoalescedCount,
    fastPresentationSubmitDelta:
      during.zoomFastPresentationSubmissionCount
      - before.zoomFastPresentationSubmissionCount,
    fastPresentationCoalescedDelta:
      during.zoomFastPresentationCoalescedRequestCount
      - before.zoomFastPresentationCoalescedRequestCount,
    exactRecoveryDelta: after.zoomExactRecoveryCount - before.zoomExactRecoveryCount,
    latestViewRevision: after.zoomViewRevision,
    checks,
    passed: Object.values(checks).every(Boolean),
  };
  (
    window as Window & { __vectorZoomStressReport?: VectorZoomStressReport }
  ).__vectorZoomStressReport = report;
  layerMemoryStressReport.textContent = JSON.stringify(report, null, 2);
  layerMemoryStressDetails.hidden = false;
  layerMemoryStressDetails.open = true;
  layerMemoryStressResult.className = report.passed ? "result ok" : "result error";
  layerMemoryStressResult.textContent = report.passed
    ? `Stress zoom 10 testi OK · 64× · ${report.slowFrameCount} frame oltre 20 ms · `
      + `recovery esatto ${report.recoveryDurationMs.toFixed(1)} ms.`
    : "Stress zoom 10 testi NON SUPERATO: consulta il report.";
  statusElement.textContent = report.passed
    ? `Stress zoom 10 testi OK · 64× · ${report.slowFrameCount} frame oltre 20 ms.`
    : "Stress zoom 10 testi NON SUPERATO: consulta __vectorZoomStressReport.";
  statusElement.className = report.passed ? "status ok" : "status error";
  if (!report.passed) {
    throw new Error("Lo stress zoom vettoriale non ha rispettato tutti gli invarianti.");
  }
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
    const failure = { version: 11, passed: false, error: message };
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
  const locale = telemetry.localStorage;
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
    + `Eviction ${telemetry.budgetEvictions} esclusivamente da budget; pavimento `
    + `${telemetry.floorCursor}, azioni ${state.actionCount}, profondità Undo ${depth}. `
    + `Locale ${formatMemoryMiB(locale.committedBytes / (1024 * 1024))} · `
    + `${locale.backend} · ${locale.ready ? "pronto" : "avvio"}/`
    + `${locale.writable ? "scrivibile" : "sola memoria"} · ${locale.busy} · `
    + `soglia spill ${formatMemoryMiB(telemetry.spillHighWaterBytes / (1024 * 1024))} · `
    + `${locale.storedOnlyPayloads}/${locale.storedPayloads} payload `
    + `solo locali in ${locale.segments} segmenti (${locale.storedActions} azioni); `
    + `spill ${locale.spillsCommitted} committed/${locale.spillFailures} falliti, `
    + `hydrate ${locale.hydrationsCompleted}/${locale.hydrationFailures}. `
    + `Compattazioni Redo ${telemetry.redoCompactionsCompleted} complete, `
    + `${telemetry.redoCompactionsAborted} interrotte.`
    + (locale.lastError ? ` Storage: ${locale.lastError}.` : "")
    + (ultimoGuastoCronologia
      ? ` ⚠ ULTIMO GUASTO: ${ultimoGuastoCronologia.operazione} su `
        + `«${ultimoGuastoCronologia.azione}» al cursore `
        + `${ultimoGuastoCronologia.cursore} → ${ultimoGuastoCronologia.messaggio}`
      : "");
}

function captureCurrentAppDiagnosticState() {
  try {
    return captureAppDiagnosticState(engine.getStats(), engine.getHistoryState());
  } catch {
    return null;
  }
}

function recordAppDiagnosticOperation(
  name: string,
  detail: string | null = null,
  error?: unknown,
): void {
  appDiagnosticLog.record({
    category: error === undefined ? "operation" : "error",
    name,
    detail,
    error,
    state: captureCurrentAppDiagnosticState(),
  });
}

function appDiagnosticSection<Value>(read: () => Value):
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: ReturnType<typeof describeAppDiagnosticError> } {
  try {
    return { ok: true, value: read() };
  } catch (error) {
    return { ok: false, error: describeAppDiagnosticError(error) };
  }
}

/**
 * Builds the report only when requested. No text/SVG document or pixel payload
 * is serialized: the useful evidence is stable ids, ordering, locks, History
 * kinds and resource totals. This keeps Copy cheap during normal drawing.
 */
function buildAppDiagnosticReport(): string {
  const statsResult = appDiagnosticSection(() => engine.getStats());
  const historyResult = appDiagnosticSection(() => engine.getHistoryState());
  const stats = statsResult.ok ? statsResult.value : null;
  const currentHistory = historyResult.ok ? historyResult.value : historyState;
  const measuredResult = appDiagnosticSection(() => engine.measuredGpuMemory());
  const maintenanceResult = appDiagnosticSection(
    () => engine.getHistoryMaintenanceTelemetry(),
  );
  const vectorDiagnosticsResult = appDiagnosticSection(
    () => vectorTextPrototype?.getDiagnostics() ?? null,
  );
  const currentState = stats
    ? captureAppDiagnosticState(stats, currentHistory)
    : null;
  const invariants = stats
    ? inspectAppDiagnosticInvariants(stats, currentHistory)
    : { ok: false, issues: ["Stats motore non leggibili durante la cattura."] };
  const measured = measuredResult.ok ? measuredResult.value : null;
  const declaredBytes = (stats?.gpuMemory.countedTotalMiB ?? 0) * 1024 * 1024;
  const measuredBytes = measured?.currentBytes ?? 0;
  const memoryDeltaBytes = measuredBytes - declaredBytes;
  const historyWindowResult = appDiagnosticSection(() =>
    summarizeAppDiagnosticHistoryWindow(
      engine.historyActions,
      engine.historyCursor,
    )
  );
  const report = {
    schema: APP_DIAGNOSTIC_SCHEMA,
    capturedAt: new Date().toISOString(),
    privacy: "Nessun pixel, contenuto testuale o sorgente SVG incluso.",
    app: {
      mode: import.meta.env.MODE,
      documentSize: LAYER_SIZE,
      path: `${window.location.pathname}${window.location.search}`,
      visibility: document.visibilityState,
    },
    environment: {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints,
      language: navigator.language,
      viewportCss: { width: window.innerWidth, height: window.innerHeight },
      screenCss: { width: window.screen.width, height: window.screen.height },
      canvasPixels: { width: canvas.width, height: canvas.height },
      devicePixelRatio: window.devicePixelRatio,
      gpuLabel: stats?.gpuLabel ?? null,
    },
    uiLocks: {
      engineInitialized,
      layerSwitching,
      historyUiBusy,
      historyQueueDraining,
      queuedHistoryOperations: historyOperationQueue.length,
      activePointer: activePointerId !== null,
      rasterGaussianBlurUiBusy,
      rasterMotionBlurUiBusy,
      rasterNoiseUiBusy,
      rasterLiquifyUiBusy,
    },
    engineLocks: {
      initialized: engine.initialized,
      layerSwitchBusy: engine.layerSwitchBusy,
      selectionBusy: engine.selectionBusy,
      historyBusy: engine.historyBusy,
      historyStateInconsistent: engine.historyStateInconsistent,
      activeStroke: engine.activeStroke !== null,
      deviceLost: engine.deviceLostError
        ? describeAppDiagnosticError(engine.deviceLostError)
        : null,
      renderFrameError: engine.renderFrameError
        ? describeAppDiagnosticError(engine.renderFrameError)
        : null,
      firstInconsistentLatch: engine.getDocumentInconsistentDiagnostic(),
    },
    renderWork: {
      layerPresentationFrozen: engine.layerPresentationFrozen,
      displayDirty: engine.displayDirty,
      presentationCacheNeedsFullRebuild: engine.presentationCacheNeedsFullRebuild,
      frameRequestPending: engine.frameRequest !== null,
      pendingStamps: engine.pendingStamps.length,
      pendingBlendBatches: engine.pendingBlendBatches.length,
    },
    layerResidency: (() => {
      const stackIds = engine.layerStack.layers.map((layer) => layer.id);
      const gpuIds = [...engine.layerGpu.keys()];
      const stackIdSet = new Set(stackIds);
      const gpuIdSet = new Set(gpuIds);
      return {
        stackIds,
        gpuIds,
        missingGpuIds: stackIds.filter((id) => !gpuIdSet.has(id)),
        orphanGpuIds: gpuIds.filter((id) => !stackIdSet.has(id)),
        resources: gpuIds.map((id) => {
          const gpu = engine.layerGpu.get(id);
          return {
            id,
            hot: Boolean(gpu?.hot),
            cold: Boolean(gpu?.cold),
            compressed: Boolean(gpu?.compressed),
          };
        }),
      };
    })(),
    visibleMessages: {
      status: statusElement.textContent,
      layer: layerSwitchResult.textContent,
      lastHistoryFailure: ultimoGuastoCronologia,
    },
    currentState,
    invariants,
    statsReadError: statsResult.ok ? null : statsResult.error,
    historyReadError: historyResult.ok ? null : historyResult.error,
    gpuMemoryAudit: measured
      ? {
        declaredMiB: declaredBytes / (1024 * 1024),
        registeredMiB: measuredBytes / (1024 * 1024),
        deltaMiB: memoryDeltaBytes / (1024 * 1024),
        warning: Math.abs(memoryDeltaBytes) > GPU_MEMORY_AUDIT_TOLERANCE_BYTES,
        textureCount: measured.textureCount,
        bufferCount: measured.bufferCount,
        unmeasurableCount: measured.unmeasurableCount,
        categories: measured.categories.map((category) => ({
          category: category.category,
          currentMiB: category.bytes / (1024 * 1024),
          peakMiB: category.peakBytes / (1024 * 1024),
          count: category.count,
        })),
      }
      : measuredResult,
    historyMaintenance: maintenanceResult,
    vectorDiagnostics: vectorDiagnosticsResult,
    historyWindow: historyWindowResult,
    recentEvents: appDiagnosticLog.snapshot(),
  };
  return JSON.stringify(report, null, 2);
}

function copyTextWithLegacySelection(text: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.inset = "0 auto auto 0";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.opacity = "0";
  textarea.style.fontSize = "16px";
  document.body.append(textarea);
  textarea.focus({ preventScroll: true });
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } finally {
    textarea.remove();
  }
  return copied;
}

async function copyAppDiagnosticReport(): Promise<void> {
  if (appDiagnosticsCopyBusy) return;
  appDiagnosticsCopyBusy = true;
  copyAppDiagnosticsButton.disabled = true;
  copyAppDiagnosticsButton.setAttribute("aria-busy", "true");
  appDiagnosticsCopyStatus.hidden = false;
  appDiagnosticsCopyStatus.textContent = "Preparazione rapporto…";
  try {
    const serialized = buildAppDiagnosticReport();
    appDiagnosticsReport.textContent = serialized;
    appDiagnosticsDetails.hidden = false;
    (
      window as Window & { __appDiagnosticReport?: string }
    ).__appDiagnosticReport = serialized;
    let copied = false;
    try {
      await navigator.clipboard.writeText(serialized);
      copied = true;
    } catch {
      copied = copyTextWithLegacySelection(serialized);
    }
    appDiagnosticsDetails.open = !copied;
    appDiagnosticsCopyStatus.textContent = copied
      ? "Diagnosi copiata: incollala nella chat senza ricaricare la pagina."
      : "Copia automatica non consentita: il rapporto è aperto qui sotto per la selezione manuale.";
  } catch (error) {
    const diagnosticError = describeAppDiagnosticError(error);
    appDiagnosticsCopyStatus.textContent =
      `Rapporto non creato: ${diagnosticError.message}`;
    appDiagnosticsDetails.hidden = true;
    appDiagnosticLog.record({
      category: "error",
      name: "diagnostic-report-failed",
      error,
    });
  } finally {
    appDiagnosticsCopyBusy = false;
    copyAppDiagnosticsButton.disabled = false;
    copyAppDiagnosticsButton.setAttribute("aria-busy", "false");
  }
}

/**
 * Dichiarato contro reale. Il pannello e' un modello e puo' derivare: qui il
 * confronto e' automatico, cosi' una taglia di documento nuova o una risorsa
 * non contabilizzata si vedono subito invece di dover essere rimisurate.
 */
function updateGpuMemoryAudit(
  declaredMiB: number,
  misura: ReturnType<BrushEngine["measuredGpuMemory"]>,
): void {
  const output = element<HTMLElement>("gpuMemoryAudit");
  if (gpuMemoryPanel.hidden) return;
  const misuratoMiB = misura.currentBytes / (1024 * 1024);
  const piccoMiB = misura.peakBytes / (1024 * 1024);
  const scartoMiB = misuratoMiB - declaredMiB;
  const oltreTolleranza =
    Math.abs(scartoMiB) * 1024 * 1024 > GPU_MEMORY_AUDIT_TOLERANCE_BYTES;
  renderMeasuredBreakdown(misura);
  output.textContent =
    `Registrata ${formatMemoryMiB(misuratoMiB)} corrente, picco `
    + `${formatMemoryMiB(piccoMiB)}, in ${misura.textureCount} texture e `
    + `${misura.bufferCount} buffer (${misura.createdCount} create, `
    + `${misura.destroyedCount} distrutte, ${misura.collectedCount} raccolte dal GC). `
    + `Somma esatta dei descrittori, non una stima. `
    + (misura.unmeasurableCount > 0
      ? `${misura.unmeasurableCount} risorse con formato non misurabile `
        + `(${misura.unmeasurableFormats.join(", ")}) sono ESCLUSE dal totale. `
      : "")
    + `Il modello diagnostico non sommato dichiara `
    + `${formatMemoryMiB(declaredMiB)}: scarto `
    + `${scartoMiB >= 0 ? "+" : "−"}${formatMemoryMiB(Math.abs(scartoMiB))}`
    + (oltreTolleranza
      ? " · ATTENZIONE: è disallineata solo la stima memoria, non l’ordine dei layer."
      : ".");
  output.classList.toggle(
    "memory-audit-warning",
    oltreTolleranza || misura.unmeasurableCount > 0,
  );
}

const STATO_LIVELLO_ETICHETTA: Record<string, string> = {
  hot: "caldo",
  cold: "freddo",
  compressed: "compresso",
  empty: "vuoto",
};

/**
 * Peso di ogni singolo livello, in ordine di consumo.
 *
 * Le categorie sopra dicono quanto pesano *i livelli*; questa dice **quale**, ed
 * e' la domanda che ci si fa davvero quando la memoria sale. L'ordine e' per
 * peso decrescente come il resto del pannello, ma l'indice di documento resta
 * scritto in ogni riga: senza, un livello che scala posizione sembrerebbe un
 * livello diverso.
 */
function renderLayerMemoryBreakdown(
  livelli: EngineGpuMemoryStats["layers"],
  inizializzato: boolean,
): void {
  const lista = element<HTMLElement>("gpuLayerBreakdown");
  const totale = livelli.reduce((somma, livello) => somma + livello.totalMiB, 0);
  element<HTMLElement>("gpuLayerMemoryTotal").textContent = inizializzato
    ? formatMemoryMiB(totale)
    : "—";
  if (!inizializzato || livelli.length === 0) {
    lista.replaceChildren();
    return;
  }

  const ordinati = [...livelli].sort((sinistra, destra) =>
    destra.totalMiB - sinistra.totalMiB || sinistra.index - destra.index
  );
  lista.replaceChildren(...ordinati.map((livello) => {
    const riga = document.createElement("div");
    riga.dataset.memoryRow = "";
    riga.dataset.layerMemoryId = String(livello.id);
    riga.classList.add("gpu-layer-row");
    const nome = document.createElement("dt");
    const stato = STATO_LIVELLO_ETICHETTA[livello.state] ?? livello.state;
    nome.textContent = `${livello.index + 1}. ${livello.name} · ${stato}`
      + `${livello.active ? " · attivo" : ""}${livello.visible ? "" : " · nascosto"}`;
    const valore = document.createElement("dd");
    valore.textContent = formatMemoryMiB(livello.totalMiB);
    valore.title = livello.compressedCpuMiB > 0
      ? "La RAM compressa pesa sul limite di processo ma non sul totale GPU."
      : "Somma delle risorse GPU vive di questo livello.";
    riga.append(nome, valore);

    // Le componenti si mostrano solo quando esistono: una riga che elenca tre
    // zeri nasconde l'unico numero che conta. Vanno su una riga propria perche'
    // il nome del livello lo scrive l'utente e puo' essere lungo quanto vuole.
    const parti: string[] = [];
    if (livello.hotMiB > 0) parti.push(`${formatMemoryMiB(livello.hotMiB)} texture`);
    if (livello.mipMiB > 0) parti.push(`${formatMemoryMiB(livello.mipMiB)} mip`);
    if (livello.coldMiB > 0) parti.push(`${formatMemoryMiB(livello.coldMiB)} tile`);
    if (livello.compressedCpuMiB > 0) {
      const rapporto = livello.compressedRawMiB / livello.compressedCpuMiB;
      parti.push(
        `${formatMemoryMiB(livello.compressedCpuMiB)} RAM compressa`
        + (rapporto > 1 ? ` (${rapporto.toFixed(1)}:1)` : ""),
      );
    }
    if (parti.length > 0) {
      const scomposizione = document.createElement("dd");
      scomposizione.className = "gpu-layer-parts";
      scomposizione.textContent = parti.join(" + ");
      riga.append(scomposizione);
    }
    riga.classList.toggle("memory-zero", livello.totalMiB < 0.05);
    return riga;
  }));
}

/**
 * Ripartizione misurata. Le categorie **partizionano** il registro: la loro
 * somma e' il totale per costruzione, non per manutenzione. Se un giorno non lo
 * fosse piu' sarebbe un difetto del registro, non un numero da riallineare a
 * mano, quindi lo si dichiara invece di nasconderlo.
 */
function renderMeasuredBreakdown(
  misura: ReturnType<BrushEngine["measuredGpuMemory"]>,
): void {
  const lista = element<HTMLElement>("gpuMeasuredBreakdown");
  const sommaCategorie = misura.categories.reduce((totale, voce) => totale + voce.bytes, 0);
  const partizioneIntegra = sommaCategorie === misura.currentBytes;
  const misuratoMiB = misura.currentBytes / (1024 * 1024);
  element<HTMLElement>("gpuMeasuredTotal").textContent = partizioneIntegra
    ? formatMemoryMiB(misuratoMiB)
    : `${formatMemoryMiB(misuratoMiB)} · partizione incoerente`;
  element<HTMLElement>("gpuMeasuredPeak").textContent =
    formatMemoryMiB(misura.peakBytes / (1024 * 1024));

  const categoryByName = new Map(misura.categories.map((entry) => [entry.category, entry]));
  const extraCategories = misura.categories
    .map((entry) => entry.category)
    .filter((category) => !(GPU_MEMORY_CATEGORY_ORDER as readonly string[]).includes(category))
    .sort((left, right) => left.localeCompare(right));
  // Ordine per consumo, dal piu' grande al piu' piccolo, ricalcolato a ogni
  // aggiornamento: un pannello che vuole dire "cosa sta mangiando la memoria
  // adesso" deve mettere in cima cio' che la sta mangiando, non seguire un
  // elenco fisso in cui la riga che conta puo' finire settima. A parita' di
  // byte correnti decide il picco, poi il nome, cosi' le righe a zero non si
  // rimescolano fra loro a ogni frame.
  const righe = [...GPU_MEMORY_CATEGORY_ORDER, ...extraCategories]
    .map((category) =>
      categoryByName.get(category) ?? { category, bytes: 0, peakBytes: 0, count: 0 }
    )
    .sort((sinistra, destra) =>
      destra.bytes - sinistra.bytes
      || destra.peakBytes - sinistra.peakBytes
      || sinistra.category.localeCompare(destra.category)
    );
  lista.replaceChildren(...righe.map((voce) => {
    const riga = document.createElement("div");
    riga.dataset.memoryRow = "";
    riga.dataset.measuredCategory = voce.category;
    const nome = document.createElement("dt");
    nome.textContent = `${voce.category} · ${voce.count} risors${voce.count === 1 ? "a" : "e"}`;
    const valore = document.createElement("dd");
    valore.textContent = `${formatMemoryMiB(voce.bytes / (1024 * 1024))} correnti · `
      + `${formatMemoryMiB(voce.peakBytes / (1024 * 1024))} picco`;
    valore.title = "Il picco è storico per questa categoria e non va sommato ai picchi delle altre righe.";
    riga.append(nome, valore);
    riga.classList.toggle("memory-zero", voce.bytes < 0.05 * 1024 * 1024);
    return riga;
  }));
}

function updateGpuMemoryPanel(stats: EngineStats): void {
  // Stesso motivo di renderLayerList: ~46 getElementById piu la riduzione sui
  // tile dello storage study, ad ogni frame, su un pannello chiuso.
  if (!gpuMemoryPanelOpen) {
    gpuMemoryPanelStatsDirty = true;
    return;
  }
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
    ? stats.gpuMemory.registeredCurrentMiB
    : declaredMiB;
  const peakMiB = engineInitialized
    ? stats.gpuMemory.registeredPeakMiB
    : declaredMiB;
  const formattedTotal = formatMemoryMiB(totalMiB);
  element<HTMLElement>("gpuMemoryTotal").textContent = formattedTotal;
  element<HTMLElement>("gpuMemoryPeak").textContent = `picco ${formatMemoryMiB(peakMiB)}`;
  element<HTMLElement>("gpuMemoryCompact").textContent = formattedTotal;
  element<HTMLElement>("memoryStat").textContent = formattedTotal;

  renderLayerMemoryBreakdown(stats.gpuMemory.layers, engineInitialized);

  // Governor in sola osservazione: la riga esiste per calibrare il tetto, non
  // per giustificare un rifiuto. Finche' dice "osserva", nessuna allocazione e'
  // stata impedita.
  const governor = stats.gpuMemory;
  element<HTMLElement>("gpuMemoryGovernor").textContent = engineInitialized
    ? `Governor · osserva · zona ${governor.governorZone} · `
      + `${formatMemoryMiB(governor.governorUsedMiB)} su `
      + `${formatMemoryMiB(governor.governorCeilingMiB)} utilizzabili `
      + `(tetto ${formatMemoryMiB(governor.governorHardCapMiB)}) · `
      + `margine ${formatMemoryMiB(governor.governorHeadroomMiB)} · `
      + `liberabile ${formatMemoryMiB(governor.governorReclaimableMiB)} · `
      + `promesso ${formatMemoryMiB(governor.governorReservedMiB)}`
    : "Governor · in attesa del device";

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
  updateGpuMemoryAudit(declaredMiB, engine.measuredGpuMemory());
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
  readonly key: MobileMixedSceneLayerKey;
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
  const multiSelectionSignature = mobileLayerMultiSelectEnabled
    ? [...mobileLayerMultiSelectedKeys].sort().join(",")
    : "";
  return `${locked ? 1 : 0}|${mobileLayerMultiSelectEnabled ? 1 : 0}`
    + `|${multiSelectionSignature}|${views.map((view) => {
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

function syncMobileLayerToolbarState(
  stats: EngineStats,
  locked: boolean,
): void {
  const scene = stats.mixedScene;
  const selectedSceneItem = scene?.items.find((item) => item.key === scene.selectedKey);
  const fallbackRaster = scene === null ? stats.layers[stats.activeLayerIndex] : undefined;
  const selectedKind = selectedSceneItem?.kind ?? (fallbackRaster ? "raster" : undefined);
  const selectedRasterReferenceAvailable = selectedSceneItem?.kind === "raster"
    ? selectedSceneItem.rasterLayerId === scene?.activeRasterLayerId
    : fallbackRaster !== undefined;
  mobileAddLayerButton.disabled = mobileLayerMultiSelectEnabled
    || locked
    || stats.layers.length >= LAYER_STACK_MAXIMUM;
  const selectedKindCount = selectedKind === "raster"
    ? stats.layers.length
    : selectedKind && scene
      ? scene.items.reduce(
        (count, item) => count + (item.kind === selectedKind ? 1 : 0),
        0,
      )
      : Number.POSITIVE_INFINITY;
  const selectedKindMaximum = selectedKind === "raster"
    ? LAYER_STACK_MAXIMUM
    : selectedKind === "text"
      ? VECTOR_TEXT_NODE_MAXIMUM
      : selectedKind === "svg"
        ? VECTOR_SVG_NODE_MAXIMUM
        : RASTER_IMAGE_NODE_MAXIMUM;
  mobileCopyLayerButton.disabled = mobileLayerMultiSelectEnabled
    || locked
    || selectedKind === undefined
    || selectedKindCount >= selectedKindMaximum;
  mobileAddMaskButton.disabled = mobileLayerMultiSelectEnabled
    || locked
    || stats.layers.length >= LAYER_STACK_MAXIMUM
    || selectedKind !== "raster"
    || !selectedRasterReferenceAvailable;
  const layerCount = scene?.items.length ?? stats.layers.length;
  mobileLayerMultiSelectButton.disabled = locked
    || (!mobileLayerMultiSelectEnabled && layerCount < 2);
}

function renderMobileLayerList(stats: EngineStats): void {
  if (!mobileLayersPanelOpen || !mobileLayersRefreshRequested) return;
  const locked = interactionLocked() || layerSwitching;
  // Keep the cheap toolbar state authoritative even while row reconciliation,
  // thumbnail work, or history rendering is intentionally deferred.
  syncMobileLayerToolbarState(stats, locked);
  if (
    mobileLayerReorderGesture !== null
    || activePointerId !== null
    || layerSwitching
    || historyState.openEdit !== null
    || historyState.busy
  ) {
    return;
  }
  const views = mobileLayerViews(stats);
  reconcileMobileLayerMultiSelection(stats);
  // Structural history detaches the source records during Merge and reattaches
  // those same monotonic ids on Undo. Their previews therefore remain in the
  // bounded LRU until history restores them or newer previews evict them.
  mobileLayerMultiActions.hidden = !mobileLayerMultiSelectEnabled;
  if (mobileLayerMultiSelectEnabled) {
    const mergePlan = currentMobileLayerMergePlan(stats);
    const mergeReason = mobileLayerMergeUnavailableReason(mergePlan);
    mobileLayerMergeSelectionButton.disabled = locked || mergeReason !== null;
    mobileLayerMergeSelectionButton.title = mergeReason ?? "Unisci i livelli selezionati";
    if (!mobileLayerMergeStatus.classList.contains("is-error")) {
      setMobileLayerMergeStatus(mergeReason);
    }
  } else {
    mobileLayerMergeSelectionButton.disabled = true;
    mobileLayerMergeSelectionButton.title = "";
  }
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

    const selected = mobileLayerMultiSelectEnabled
      ? mobileLayerMultiSelectedKeys.has(view.key)
      : view.selected;
    row.className = `mobile-layer-row is-${view.kind}`
      + `${selected ? " is-selected" : ""}`
      + `${mobileLayerMultiSelectEnabled && selected ? " is-multi-selected" : ""}`
      + `${view.selected ? " is-active-layer" : ""}`;
    row.setAttribute("aria-posinset", String(position + 1));
    row.setAttribute("aria-setsize", String(views.length));
    select.disabled = locked;
    select.setAttribute("aria-current", String(view.selected));
    if (mobileLayerMultiSelectEnabled) {
      select.setAttribute("aria-pressed", String(selected));
    } else {
      select.removeAttribute("aria-pressed");
    }
    select.setAttribute(
      "aria-label",
      mobileLayerMultiSelectEnabled
        ? selected
          ? `${view.name}, selected. Tap to remove it from the merge selection; `
            + "hold for selection actions."
          : `Add ${view.name} to the merge selection`
        : view.selected
        ? `${view.name}. Hold for layer options, then drag to reorder; `
          + "Alt plus Arrow Up or Down also moves it."
        : `Select ${view.name}`,
    );
    if (view.selected && !mobileLayerMultiSelectEnabled) {
      select.setAttribute("aria-keyshortcuts", "Alt+ArrowUp Alt+ArrowDown");
    } else {
      select.removeAttribute("aria-keyshortcuts");
    }
    select.title = view.name;
    name.textContent = view.name;
    updateMobileLayerThumbnail(thumbnail, view);

    reference.hidden = view.kind !== "raster";
    reference.disabled = locked
      || mobileLayerMultiSelectEnabled
      || !view.referenceAvailable;
    reference.setAttribute("aria-pressed", String(view.reference));
    reference.setAttribute(
      "aria-label",
      `${view.reference ? "Disable" : "Set"} Reference for ${view.name}`,
    );
    reference.title = view.reference ? "Reference on" : "Set as Reference";

    visibility.disabled = locked || mobileLayerMultiSelectEnabled;
    visibility.setAttribute("aria-pressed", String(view.visible));
    visibility.setAttribute(
      "aria-label",
      `${view.visible ? "Hide" : "Show"} ${view.name}`,
    );
    visibility.title = view.visible ? "Hide layer" : "Show layer";
    visibility.replaceChildren(createMobileLucideIconStack(view.visible ? Eye : EyeOff));
  });

  mobileLayersRenderSignature = signature;
  mobileLayersRefreshRequested = false;
}

function runMobileLayerAction(action: string, key: string): void {
  if (interactionLocked() || layerSwitching) return;
  if (
    action === "select"
    && mobileLayerMultiSelectEnabled
    && isMobileMixedSceneLayerKey(key)
  ) {
    toggleMobileLayerMultiSelection(key);
    return;
  }
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

async function runRequestedLayerMergeTest(
  testCase: "raster" | "clipping" | "mixed" | "memory" | "reject",
): Promise<void> {
  layerHistoryTestSection.hidden = false;
  layerHistoryTestDetails.hidden = true;
  layerHistoryTestResult.className = "result";
  layerHistoryTestResult.textContent = `Test GPU merge livelli · ${testCase}…`;
  try {
    if (!vectorTextPrototype) {
      throw new Error("Controller della scena mista non disponibile.");
    }
    const { runLayerMergeGpuTest } = await import("./layer-merge-gpu-test");
    const report = await runLayerMergeGpuTest(engine, vectorTextPrototype, testCase);
    layerHistoryTestReport.textContent = JSON.stringify(report, null, 2);
    layerHistoryTestDetails.hidden = false;
    layerHistoryTestDetails.open = true;
    (
      window as Window & { __layerMergeGpuTestReport?: typeof report }
    ).__layerMergeGpuTestReport = report;
    layerHistoryTestResult.className = report.passed ? "result ok" : "result error";
    layerHistoryTestResult.textContent = report.passed
      ? `Merge GPU ${testCase} OK · pixel, struttura e cronologia verificati.`
      : `Merge GPU ${testCase} ERRORE · consulta il report JSON.`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failure = { version: 1, testCase, passed: false, error: message } as const;
    layerHistoryTestReport.textContent = JSON.stringify(failure, null, 2);
    layerHistoryTestDetails.hidden = false;
    layerHistoryTestDetails.open = true;
    (
      window as Window & { __layerMergeGpuTestReport?: typeof failure }
    ).__layerMergeGpuTestReport = failure;
    layerHistoryTestResult.className = "result error";
    layerHistoryTestResult.textContent = `Merge GPU ${testCase} ERRORE · ${message}`;
  } finally {
    layerHistoryTestRunning = false;
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
  // Il motore pubblica le statistiche alla fine di ogni frame, e ogni modifica
  // di un controllo del pennello ne provoca uno. Ridisegnare la lista layer a
  // pannello chiuso costava ~144 querySelector e altrettanti setAttribute per
  // frame senza che nulla fosse visibile.
  if (!controlsPanelOpen) {
    controlsPanelStatsDirty = true;
    return;
  }
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
    recordAppDiagnosticOperation(
      "mixed-scene-selection-failed",
      JSON.stringify({ key, kind: item.kind }),
      error,
    );
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
    recordAppDiagnosticOperation(
      "raster-layer-selection-failed",
      JSON.stringify({ index }),
      error,
    );
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
    recordAppDiagnosticOperation(
      "raster-clipping-mask-add-failed",
      null,
      error,
    );
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

async function duplicateMobileSelectedLayer(): Promise<void> {
  if (
    mobileCopyLayerButton.disabled
    || mobileLayerMultiSelectEnabled
    || layerSwitching
    || interactionLocked()
  ) {
    return;
  }

  const beforeStats = engine.getStats();
  const sourceView = mobileLayerViews(beforeStats).find((view) => view.selected);
  if (!sourceView) {
    const message = "Nessun livello selezionato da duplicare.";
    layerSwitchResult.textContent = message;
    announceMobileLayerReorder(message);
    return;
  }
  const sourceThumbnail = sourceView.rasterLayerId === null
    ? null
    : mobileRasterThumbnailCache.get(sourceView.rasterLayerId) ?? null;
  let duplicatedRaster = false;
  const restoreToolbarFocus = document.activeElement === mobileCopyLayerButton;

  setMobileLayerMergeStatus(null);
  layerSwitching = true;
  updateHistoryControls();
  mobileLayersRenderSignature = "";
  requestMobileLayersRefresh();
  renderMobileLayerList(beforeStats);
  try {
    await showLayerLoading("Duplicazione livello…");
    const result = await engine.duplicateSelectedLayer();
    duplicatedRaster = result.kind === "raster";
    await engine.waitForIdle();
    historyState = engine.getHistoryState();

    if (result.kind === "raster") {
      syncActiveLayerControls();
      const afterStats = engine.getStats();
      const sourceLayer = result.sourceRasterLayerId === null
        ? undefined
        : afterStats.layers.find((layer) => layer.id === result.sourceRasterLayerId);
      const duplicateLayer = result.duplicateRasterLayerId === null
        ? undefined
        : afterStats.layers.find((layer) => layer.id === result.duplicateRasterLayerId);
      const selectedKey = afterStats.mixedScene?.selectedKey
        ?? (afterStats.layers[afterStats.activeLayerIndex]
          ? `raster:${afterStats.layers[afterStats.activeLayerIndex].id}`
          : null);
      if (
        sourceThumbnail
        && sourceView.key === result.sourceKey
        && sourceView.rasterLayerId === result.sourceRasterLayerId
        && sourceLayer
        && duplicateLayer
        && sourceLayer.hasContent === duplicateLayer.hasContent
        && selectedKey === result.duplicateKey
        && result.duplicateRasterLayerId !== null
      ) {
        // Captures replace cache entries and canvas rendering only reads ImageData,
        // so both identical layers can share these pixels without another 64² copy.
        mobileRasterThumbnailCache.set(result.duplicateRasterLayerId, sourceThumbnail);
      }
    }

    const message = `${mobileLayerDisplayName(result.name)} duplicato in `
      + `${result.totalMs.toFixed(0)} ms.`;
    layerSwitchResult.textContent = message;
    setMobileLayerMergeStatus(message);
    announceMobileLayerReorder(message);
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Duplicazione del livello non riuscita.";
    recordAppDiagnosticOperation(
      "mixed-scene-duplicate-failed",
      JSON.stringify({ sourceKey: sourceView.key, kind: sourceView.kind }),
      error,
    );
    layerSwitchResult.textContent = message;
    setMobileLayerMergeStatus(message, true);
    announceMobileLayerReorder(message);
  } finally {
    hideLayerLoading();
    layerSwitching = false;
    historyState = engine.getHistoryState();
    mobileLayersRenderSignature = "";
    requestMobileLayersRefresh();
    updateHistoryControls();
    const finalStats = engine.getStats();
    updateStats(finalStats);
    renderMobileLayerList(finalStats);
    if (duplicatedRaster) requestMobileLayerThumbnailCapture(0);
    if (restoreToolbarFocus) {
      requestAnimationFrame(() => {
        if (!mobileLayersPanelOpen) return;
        const target = !mobileCopyLayerButton.disabled
          ? mobileCopyLayerButton
          : mobileLayerList.querySelector<HTMLButtonElement>(
            ".mobile-layer-row.is-active-layer .mobile-layer-select",
          );
        target?.focus({ preventScroll: true });
      });
    }
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
    recordAppDiagnosticOperation(
      "raster-layer-add-failed",
      null,
      error,
    );
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
  if (!controlsPanelOpen) {
    controlsPanelStatsDirty = true;
    return;
  }
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
          ? "r16float-coverage"
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
  | "liquify"
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
  contactCount: number;
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
  if (contacts.length === 0) {
    return null;
  }
  if (contacts.length === 1) {
    return {
      contactCount: 1,
      centerX: contacts[0].clientX,
      centerY: contacts[0].clientY,
      distance: 1,
      angle: 0,
    };
  }
  const first = contacts[0];
  const second = contacts[1];
  return {
    contactCount: contacts.length,
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
    } else if (pointerMode === "liquify") {
      engine.endRasterLiquifyStroke(false);
      canvas.classList.remove("liquify-deforming");
    } else if (pointerMode === "fill") {
      fillPointerMoved = true;
    } else if (pointerMode === "selection-tap") {
      selectionPointerMoved = true;
    } else if (pointerMode === "selection-lasso") {
      clearLassoGesture();
    }
    vectorTextPrototype?.beginViewGesture();
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
    && !canvasViewOperationLocked()
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
        : activeCanvasTool === "liquify"
          ? "liquify"
        : activeCanvasTool === "selection"
          ? selectedSelectionMethod() === "lasso"
            ? "selection-lasso"
            : "selection-tap"
        : activeCanvasTool === "transform"
          ? "transform"
        : "paint";
  const viewNavigationRequested = requestedPointerMode === "pan"
    || requestedPointerMode === "rotate";
  const liquifyEditRequested = requestedPointerMode === "liquify"
    && rasterLiquifySessionOpen
    && historyState.openEdit === "liquify";
  const blurTouchNavigationRequested = event.pointerType === "touch"
    && (
      (rasterGaussianBlurSessionOpen && historyState.openEdit === "gaussian-blur")
      || (rasterMotionBlurSessionOpen && historyState.openEdit === "motion-blur")
      || (rasterNoiseSessionOpen && historyState.openEdit === "noise")
    );
  if (
    (viewNavigationRequested || blurTouchNavigationRequested)
      ? canvasViewOperationLocked()
      : operationLocked(liquifyEditRequested)
  ) {
    if (historyState.openEdit === "raster-property") {
      statusElement.textContent = "Completo la modifica dell'effetto prima del tratto…";
      statusElement.className = "status";
    }
    return;
  }

  if (blurTouchNavigationRequested) {
    event.preventDefault();
    activePointerId = event.pointerId;
    activeTouchContacts.set(event.pointerId, {
      clientX: event.clientX,
      clientY: event.clientY,
    });
    canvas.setPointerCapture(event.pointerId);
    enterTouchNavigation();
    return;
  }

  const paintSample = requestedPointerMode === "paint" ? toPointerSample(event) : null;
  const liquifyPoint = requestedPointerMode === "liquify"
    ? engine.toLayerPoint({
      ...toPointerSample(event),
      pressure: event.pointerType === "pen" ? normalizedPressure(event) : 1,
    })
    : null;
  if (liquifyPoint && !engine.beginRasterLiquifyStroke(liquifyPoint)) {
    historyState = engine.getHistoryState();
    updateHistoryControls();
    return;
  }
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
    vectorTextPrototype?.beginViewGesture();
    engine.beginViewRotationGesture();
    canvas.classList.add("rotating");
    lastRotateClientX = event.clientX;
  } else if (pointerMode === "pan") {
    vectorTextPrototype?.beginViewGesture();
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
  } else if (pointerMode === "liquify") {
    canvas.classList.add("liquify-deforming");
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

        if (nextGesture.contactCount >= 2 && previousGesture.contactCount >= 2) {
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
  if (pointerMode === "liquify") {
    engine.extendRasterLiquifyStroke(sourceEvents.map((source) => engine.toLayerPoint({
      ...toPointerSample(source),
      pressure: source.pointerType === "pen" ? normalizedPressure(source) : 1,
    })));
    return;
  }
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
      vectorTextPrototype?.endViewGesture();
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
  } else if (pointerMode === "liquify") {
    engine.endRasterLiquifyStroke(event.type === "pointerup");
  } else if (pointerMode === "rotate") {
    engine.endViewRotationGesture();
  }
  if (pointerMode === "rotate" || pointerMode === "pan") {
    vectorTextPrototype?.endViewGesture();
  }
  canvas.classList.remove("panning", "rotating", "liquify-deforming");
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

const textSelectionEditableSelector = [
  "input:not([type])",
  'input[type="text"]',
  'input[type="search"]',
  'input[type="email"]',
  'input[type="url"]',
  'input[type="tel"]',
  'input[type="password"]',
  'input[type="number"]',
  "textarea",
  '[contenteditable]:not([contenteditable="false"])',
  ".allow-text-selection",
].join(", ");

document.addEventListener("selectstart", (event) => {
  const elementTarget = event.target instanceof Element ? event.target : null;
  if (!elementTarget?.closest(textSelectionEditableSelector)) {
    event.preventDefault();
  }
}, { capture: true });

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

// `event.repeat` non viene piu' scartato: era il motivo per cui tenere premuto
// Ctrl+Z produceva **esattamente un** annullamento e mai una sequenza. Scartarlo
// serviva a non lanciare replay sovrapposti, ma quel compito ora spetta alla
// coda, che serializza e ha un tetto suo. Filtrare qui significava buttare via
// l'intenzione dell'utente invece di metterla in fila.
window.addEventListener("keydown", (event) => {
  if (
    event.defaultPrevented
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
  event.preventDefault();
  if (historyRequestLocked()) {
    const reason = operation === "undo"
      ? historyState.undoBlockedReason
      : historyState.redoBlockedReason;
    statusElement.textContent = reason ?? "Termina l'operazione corrente e riprova.";
    statusElement.className = "status";
    return;
  }

  // Non filtrare su canUndo/canRedo qui: durante il replay sono falsi perche'
  // il motore e' occupato, ma la richiesta deve entrare in coda. Se invece il
  // cursore e' davvero al limite, runHistoryOperation mostrera' il motivo.
  requestHistoryOperation(operation);
});

canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    if (canvasViewOperationLocked() || activePointerId !== null) {
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

function refreshRuntimeStats(): void {
  if (!engineInitialized || document.hidden) return;
  try {
    updateStats(engine.getStats());
  } catch (error) {
    if (statsPollingFaultReported) return;
    statsPollingFaultReported = true;
    appDiagnosticLog.record({
      category: "error",
      name: "runtime-stats-poll",
      error,
    });
    console.error("Runtime stats polling failed.", error);
  }
}

function startRuntimeStatsPolling(): void {
  if (statsPollingTimer !== null) return;
  statsPollingTimer = window.setInterval(refreshRuntimeStats, 1_000);
}

function scheduleDeferredStartupTask(
  name: string,
  task: () => Promise<void>,
  timeout: number,
): void {
  const run = (): void => {
    void task().catch((error) => {
      appDiagnosticLog.record({ category: "error", name, error });
      console.error(`Deferred startup task ${name} failed.`, error);
    });
  };
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(run, { timeout });
    return;
  }
  window.setTimeout(run, 0);
}

async function initializeVectorTextPrototype(): Promise<MixedVectorTextController> {
  if (vectorTextPrototype) return vectorTextPrototype;
  if (vectorTextInitializationPromise) return vectorTextInitializationPromise;

  const initialization = (async (): Promise<MixedVectorTextController> => {
    await engine.ensureOptionalEditorResources();
    const { MixedVectorTextController } = await import("./mixed-vector-text-controller");
    const controller = new MixedVectorTextController(engine, {
      clippedRefreshPolicy:
        vectorZoomRefreshMode === "release" || vectorZoomCoverageRequested
          ? "on-release"
          : "during-gesture",
    });
    await controller.initialize();
    vectorTextPrototype = controller;
    const snapshot = engine.getMixedSceneSnapshot();
    if (snapshot) controller.syncScene(snapshot);
    syncMobileToolsMenuState(snapshot);
    requestMobileLayersRefresh();
    mobileToolSettingsSheet?.syncOpenState();
    if (import.meta.env.DEV) {
      (window as Window & {
        __vectorTextPrototype?: MixedVectorTextController;
      }).__vectorTextPrototype = vectorTextPrototype;
    }
    return controller;
  })();
  vectorTextInitializationPromise = initialization;
  try {
    return await initialization;
  } catch (error) {
    if (vectorTextInitializationPromise === initialization) {
      vectorTextInitializationPromise = null;
    }
    throw error;
  }
}

markStartupPhase(
  "Avvio del motore WebGPU",
  "Inizio della negoziazione con Chrome e con la GPU.",
);
void engine.initialize()
  .then(async () => {
    markStartupPhase(
      "Motore WebGPU inizializzato",
      "La GPU essenziale è pronta; l’editor può essere mostrato.",
    );
    engineInitialized = true;
    markStartupPhase(
      "Finalizzazione dell’interfaccia",
      "Sincronizzazione dei controlli essenziali.",
    );
    syncMobileToolsMenuState();
    historyState = engine.getHistoryState();
    requestMobileLayerThumbnailCapture(0);
    layerHistoryTestRunning = layerHistoryTestRequested
      || layerBlendTestRequested
      || layerMergeTestRequested !== null;
    layerMemoryStressTestRunning = iphoneMemoryLimitTestRequested;
    updateHistoryControls();
    updateHumanStrokeControls();
    completeStartupDiagnostics();
    startRuntimeStatsPolling();

    scheduleDeferredStartupTask(
      "deferred-gpu-pipelines",
      () => engine.ensureOptionalEditorResources(),
      500,
    );
    scheduleDeferredStartupTask(
      "deferred-canonical-stroke",
      loadCanonicalHumanStroke,
      2_000,
    );
    if (mobileBrushStudio && mobileUiMediaQuery.matches) {
      scheduleDeferredStartupTask(
        "deferred-brush-restore",
        restoreActiveMobileBrushLibraryBrush,
        250,
      );
    }

    const vectorTextRequiredByStartupProbe = vectorZoomCoverageRequested
      || vectorZoomAbRequested
      || vectorZoomStressRequested
      || layerMergeTestRequested !== null;
    if (vectorTextEditorEnabled && vectorTextRequiredByStartupProbe) {
      await initializeVectorTextPrototype();
    } else if (vectorTextEditorEnabled) {
      scheduleDeferredStartupTask(
        "deferred-vector-text",
        async () => {
          await initializeVectorTextPrototype();
        },
        1_500,
      );
    }

    if (vectorZoomCoverageRequested) {
      await runRequestedVectorZoomCoverage();
    } else if (vectorZoomAbRequested) {
      await runRequestedVectorZoomAb();
    } else if (vectorZoomStressRequested) {
      await runRequestedVectorZoomStress();
    }
    if (iphoneMemoryLimitTestRequested) {
      await recoverRequestedIphoneMemoryLimitTest();
      layerMemoryStressTestRunning = false;
      updateHistoryControls();
      updateHumanStrokeControls();
    }
    if (layerMergeTestRequested) {
      await runRequestedLayerMergeTest(layerMergeTestRequested);
    } else if (layerBlendTestRequested) {
      await runRequestedLayerBlendTest();
    } else if (clippingGroupTestRequested) {
      layerHistoryTestRunning = true;
      await runRequestedClippingGroupTest();
    } else if (layerHistoryTestRequested) {
      await runRequestedLayerHistoryTest();
    }
  })
  .catch((error) => {
    reportStartupFailure(error);
    const message = error instanceof Error ? error.message : String(error);
    const secureContextHint = !window.isSecureContext
      ? " WebGPU richiede HTTPS oppure localhost; un indirizzo LAN in HTTP non è sufficiente."
      : "";
    statusElement.textContent = `${message}${secureContextHint}`;
    statusElement.className = "status error";
    benchmarkButton.disabled = true;
    if (layerMergeTestRequested) {
      const failure = {
        version: 1,
        testCase: layerMergeTestRequested,
        passed: false,
        error: `${message}${secureContextHint}`,
      } as const;
      layerHistoryTestSection.hidden = false;
      layerHistoryTestResult.className = "result error";
      layerHistoryTestResult.textContent = `Merge GPU ERRORE · ${message}`;
      layerHistoryTestReport.textContent = JSON.stringify(failure, null, 2);
      layerHistoryTestDetails.hidden = false;
      layerHistoryTestDetails.open = true;
      (
        window as Window & { __layerMergeGpuTestReport?: typeof failure }
      ).__layerMergeGpuTestReport = failure;
    } else if (layerBlendTestRequested) {
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
