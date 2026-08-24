import "./styles.css";
import { EditorToolsController } from "./editor-tools-controller";
import type { EditorRasterEffectKind } from "./editor-tools-contract";
import { MobileBrushStudioController } from "./mobile-brush-studio";
import { MobileBrushLibraryPreviewRenderer } from "./brush-library-preview";
import { AuthoritativeBrushStrokePreviewRenderer } from "./brush-stroke-preview-renderer";
import { BrushLibraryController } from "./brush-library-controller";
import {
  BrushSettingsController,
} from "./brush-settings-controller";
import { BrushQuickControlsController } from "./brush-quick-controls-controller";
import { CanvasToolSettingsController } from "./canvas-tool-settings-controller";
import { CanvasInputController, type CanvasInputTool } from "./canvas-input-controller";
import { CanvasToolController } from "./canvas-tool-controller";
import { BrushOutlineController } from "./brush-outline-controller";
import { PixelSelectionController } from "./pixel-selection-controller";
import { AppDiagnosticsController } from "./app-diagnostics-controller";
import { GpuMemoryPanelController } from "./gpu-memory-panel-controller";
import { RuntimeStatsController } from "./runtime-stats-controller";
import { HistoryControlsController } from "./history-controls-controller";
import { MemoryLimitDialogController } from "./memory-limit-dialog-controller";
import { MobileStrokeSheetController } from "./mobile-stroke-sheet";
import { RasterAdjustmentsController } from "./raster-adjustments-controller";
import { RasterStyleController } from "./raster-style-controller";
import { MobileToolSettingsSheetController } from "./mobile-tool-settings-sheet";
import {
  MobileRasterEffectsSheetController,
  type MobileRasterEffectKind,
} from "./mobile-raster-effects-sheet";
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
  Grid3X3,
  Hand,
  House,
  Image as ImageIcon,
  Layers3,
  MoveDiagonal2,
  PaintBucket,
  Palette,
  Pencil,
  Plus,
  Redo2,
  Save,
  Scaling,
  Scan,
  Search,
  Settings,
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
  X,
  createIcons,
} from "lucide";
import { BrushEngine } from "./brush-engine";
import type { EngineStats } from "./engine-stats";
import type { EditorExtension, EditorExtensionHost } from "./editor-extension-contract";
import {
  type BrushSettings,
  type HistoryState,
} from "./engine-types";
import { DOCUMENT_HEIGHT, DOCUMENT_MAX_EDGE, DOCUMENT_WIDTH } from "./engine-limits";
import { LayerThumbnailController } from "./layer-thumbnail-controller";
import { LayerPanelController } from "./layer-panel-controller";
import {
  sceneLayerDisplayName,
  selectedSceneLayerProperties,
} from "./scene-layer-read-model";
import { SceneEditorController } from "./scene-editor-controller";
import { DocumentInteractionController } from "./document-interaction-controller";
import { CanvasGuidesController } from "./canvas-guides-controller";
import { EditorSettingsController } from "./editor-settings-controller";
import {
  DEFAULT_EDITOR_GUIDE_PREFERENCES,
  type EditorSettingsStoragePort,
} from "./editor-settings-storage";

import type { MixedSceneController } from "./mixed-scene-controller";
import { createProjectStorage } from "./project-storage";
import type { ProjectEditorBootstrap } from "./project-shell-contract";
import { ProjectSessionController } from "./project-session-controller";
import { resolveMixedSceneEnabled } from "./compat/mixed-scene-options";

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
    Grid3X3,
    Hand,
    House,
    Image: ImageIcon,
    Layers3,
    MoveDiagonal2,
    PaintBucket,
    Palette,
    Pencil,
    Plus,
    Redo2,
    Save,
    Scaling,
    Scan,
    Search,
    Settings,
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
    X,
  },
});

function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) {
    throw new Error(`Element #${id} not found.`);
  }
  return result as T;
}

document.title = `WebGPU Brush Engine ${DOCUMENT_WIDTH}×${DOCUMENT_HEIGHT}`;
const canvas = element<HTMLCanvasElement>("gpuCanvas");
const brushOutlineCanvas = element<HTMLCanvasElement>("brushOutlineCanvas");
const canvasGuidesOverlayCanvas = element<HTMLCanvasElement>("canvasGuidesOverlayCanvas");
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
  throw new Error("Temporary 2D lasso canvas is unavailable.");
}
const rasterSelectionGestureContext: CanvasRenderingContext2D =
  rasterSelectionGestureContextCandidate;
const appElement = element<HTMLElement>("app");
const editorStage = element<HTMLElement>("editorStage");
const memoryLimitDialogController = new MemoryLimitDialogController({
  root: element<HTMLDialogElement>("memoryLimitDialog"),
  cancelButton: element<HTMLButtonElement>("memoryLimitDialogCancel"),
  proceedButton: element<HTMLButtonElement>("memoryLimitDialogProceed"),
});
const editorTopbar = element<HTMLElement>("editorTopbar");
const mobileToolRail = element<HTMLElement>("mobileToolRail");
const projectHomeButton = element<HTMLButtonElement>("projectHomeButton");
const saveProjectButton = element<HTMLButtonElement>("saveProjectButton");
const statusElement = element<HTMLParagraphElement>("status");
const layerSwitchResult = element<HTMLParagraphElement>("layerSwitchResult");
const layerLoadingOverlay = element<HTMLElement>("layerLoadingOverlay");
const layerLoadingLabel = element<HTMLParagraphElement>("layerLoadingLabel");
// Questa riga descrive la memoria dei tre renderer nell'editor normale.
// Non appartiene ai laboratori anche se condivideva la vecchia sezione benchmark.
const renderingModeMemoryHint = element<HTMLParagraphElement>("renderingModeMemoryHint");
const mobileBrushColorLabel = element<HTMLLabelElement>("mobileBrushColor");
const mobileBrushColorInput = element<HTMLInputElement>("mobileBrushColorInput");
const mobileBrushColorSwatch = element<HTMLElement>("mobileBrushColorSwatch");
const mobilePaintButton = element<HTMLButtonElement>("mobilePaint");
const mobileEraserButton = element<HTMLButtonElement>("mobileEraser");
const mobileBlendButton = element<HTMLButtonElement>("mobileBlend");
const mobilePanButton = element<HTMLButtonElement>("mobilePan");
const mobileUndoButton = element<HTMLButtonElement>("mobileUndo");
const mobileRedoButton = element<HTMLButtonElement>("mobileRedo");
const mobileToolsMenuButton = element<HTMLButtonElement>("mobileToolsMenu");
const mobileToolsSheet = element<HTMLElement>("mobileToolsSheet");
const mobileToolsSheetHandle = element<HTMLButtonElement>("mobileToolsSheetHandle");
const mobileToolsSheetContent = element<HTMLElement>("mobileToolsSheetContent");
const mobileToolsSearchField = element<HTMLLabelElement>("mobileToolsSearchField");
const mobileToolsSearchInput = element<HTMLInputElement>("mobileToolsSearch");
const mobileToolsEmpty = element<HTMLParagraphElement>("mobileToolsEmpty");
const editorSettingsMenuButton = element<HTMLButtonElement>("editorSettingsMenu");
const editorSettingsPanel = element<HTMLElement>("editorSettingsPanel");
const editorSettingsCloseButton = element<HTMLButtonElement>("editorSettingsClose");
const editorRulersEnabledInput = element<HTMLInputElement>("editorRulersEnabled");
const editorGridEnabledInput = element<HTMLInputElement>("editorGridEnabled");
const editorSnappingEnabledInput = element<HTMLInputElement>("editorSnappingEnabled");
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
const mobileLayerRasterizeButton = element<HTMLButtonElement>("mobileLayerRasterize");
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
const mobileToolsVectorCommandButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-mobile-vector-command]"),
);
const mobileToolsEffectButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-mobile-effect-kind]"),
);
const mobileLiquifyOpenButton = element<HTMLButtonElement>("mobileLiquifyOpen");
const mobileLiquifySheetElement = element<HTMLElement>("mobileLiquifySheet");
const mobileLiquifySheetHandle = element<HTMLButtonElement>("mobileLiquifyHandle");
const mobileLiquifySheetHeader = element<HTMLElement>("mobileLiquifyHeader");
const mobileLiquifyControlsRegion = element<HTMLElement>("mobileLiquifyControlsRegion");
const mobileLiquifyModeLabel = element<HTMLOutputElement>("mobileLiquifyModeLabel");
const liquifyModeButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-liquify-mode]"),
);
const mobileLiquifySizeInput = element<HTMLInputElement>("mobileLiquifySize");
const mobileLiquifySizeOutput = element<HTMLOutputElement>("mobileLiquifySizeOut");
const mobileLiquifyPressureInput = element<HTMLInputElement>("mobileLiquifyPressure");
const mobileLiquifyPressureOutput = element<HTMLOutputElement>(
  "mobileLiquifyPressureOut",
);
const mobileLiquifyDistortionInput = element<HTMLInputElement>("mobileLiquifyDistortion");
const mobileLiquifyDistortionOutput = element<HTMLOutputElement>(
  "mobileLiquifyDistortionOut",
);
const mobileLiquifyMomentumInput = element<HTMLInputElement>("mobileLiquifyMomentum");
const mobileLiquifyMomentumOutput = element<HTMLOutputElement>(
  "mobileLiquifyMomentumOut",
);
const mobileLiquifyAmountInput = element<HTMLInputElement>("mobileLiquifyAmount");
const mobileLiquifyAmountOutput = element<HTMLOutputElement>("mobileLiquifyAmountOut");
const mobileLiquifyStatus = element<HTMLParagraphElement>("mobileLiquifyStatus");
const mobileLiquifyResetButton = element<HTMLButtonElement>("mobileLiquifyReset");
const mobileLiquifyCancelButton = element<HTMLButtonElement>("mobileLiquifyCancel");
const mobileLiquifyApplyButton = element<HTMLButtonElement>("mobileLiquifyApply");
const mobileGaussianBlurOpenButton = element<HTMLButtonElement>(
  "mobileGaussianBlurOpen",
);
const mobileGaussianBlurSheetElement = element<HTMLElement>(
  "mobileGaussianBlurSheet",
);
const mobileGaussianBlurSheetHandle = element<HTMLButtonElement>(
  "mobileGaussianBlurHandle",
);
const mobileGaussianBlurSheetHeader = element<HTMLElement>("mobileGaussianBlurHeader");
const mobileGaussianBlurControlsRegion = element<HTMLElement>(
  "mobileGaussianBlurControlsRegion",
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
const mobileMotionBlurOpenButton = element<HTMLButtonElement>("mobileMotionBlurOpen");
const mobileMotionBlurSheetElement = element<HTMLElement>("mobileMotionBlurSheet");
const mobileMotionBlurSheetHandle = element<HTMLButtonElement>("mobileMotionBlurHandle");
const mobileMotionBlurSheetHeader = element<HTMLElement>("mobileMotionBlurHeader");
const mobileMotionBlurControlsRegion = element<HTMLElement>(
  "mobileMotionBlurControlsRegion",
);
const mobileMotionBlurDistanceInput = element<HTMLInputElement>("mobileMotionBlurDistance");
const mobileMotionBlurDistanceOutput = element<HTMLOutputElement>("mobileMotionBlurDistanceOut");
const mobileMotionBlurAngleInput = element<HTMLInputElement>("mobileMotionBlurAngle");
const mobileMotionBlurAngleOutput = element<HTMLOutputElement>("mobileMotionBlurAngleOut");
const mobileMotionBlurStatus = element<HTMLParagraphElement>("mobileMotionBlurStatus");
const mobileMotionBlurCancelButton = element<HTMLButtonElement>("mobileMotionBlurCancel");
const mobileMotionBlurApplyButton = element<HTMLButtonElement>("mobileMotionBlurApply");
const mobileNoiseOpenButton = element<HTMLButtonElement>("mobileNoiseOpen");
const mobileNoiseSheetElement = element<HTMLElement>("mobileNoiseSheet");
const mobileNoiseSheetHandle = element<HTMLButtonElement>("mobileNoiseHandle");
const mobileNoiseSheetHeader = element<HTMLElement>("mobileNoiseHeader");
const mobileNoiseControlsRegion = element<HTMLElement>("mobileNoiseControlsRegion");
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
const mobileToolSettingsButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-mobile-tool-sheet]"),
);
const gpuMemoryMonitor = element<HTMLElement>("gpuMemoryMonitor");
const memoryStat = element<HTMLElement>("memoryStat");
const copyAppDiagnosticsButton = element<HTMLButtonElement>("copyAppDiagnostics");
const appDiagnosticsCopyStatus = element<HTMLOutputElement>(
  "appDiagnosticsCopyStatus",
);
const appDiagnosticsDetails = element<HTMLDetailsElement>("appDiagnosticsDetails");
const appDiagnosticsReport = element<HTMLElement>("appDiagnosticsReport");

let historyState: HistoryState = {
  canUndo: false,
  canRedo: false,
  busy: false,
  inconsistent: false,
  actionCount: 0,
  cursor: 0,
  storedBaseStamps: 0,
  logicalStampBytes: 0,
  undoBlockedReason: "There are no actions to undo.",
  redoBlockedReason: "There are no actions to redo.",
  openEdit: null,
};

const pageSearchParams = new URLSearchParams(window.location.search);
const touchPaintIntentHoldEnabled = pageSearchParams.get("touchPaintIntentHold") !== "0";

const bevelBoundingFieldEnabled = pageSearchParams.get("bevelField") === "bbox";
// Same-build A/B escape hatch: ROI is production-default, `vectorTextRoi=0`
// restores the previous full-viewport run textures for local measurements.
const vectorTextRoiCacheEnabled = pageSearchParams.get("vectorTextRoi") !== "0";
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
const layerColdTileCompositeEnabled =
  pageSearchParams.get("layerColdTileComposite") !== "0";
const layerColdAdjacentPrefetchMode =
  pageSearchParams.get("layerAdjacentPrefetch");
const layerColdAdjacentPrefetchEnabled =
  layerColdAdjacentPrefetchMode === "1"
  || (!appleMobileMemoryLifecycle && layerColdAdjacentPrefetchMode !== "0");
element<HTMLElement>("gpuMemoryVectorTextRow").hidden = false;
element<HTMLElement>("gpuMemoryRasterImageRow").hidden = false;
let mixedSceneController: MixedSceneController | null = null;
let layerPanelController: LayerPanelController | null = null;
let sceneEditorController: SceneEditorController | null = null;
let canvasInputController: CanvasInputController | null = null;
let documentInteractionController: DocumentInteractionController | null = null;
let brushQuickControlsController: BrushQuickControlsController | null = null;
let canvasToolController: CanvasToolController | null = null;
let brushOutlineController: BrushOutlineController | null = null;
let mixedSceneInitializationPromise: Promise<MixedSceneController> | null = null;
let editorToolsController: EditorToolsController;
let editorSettingsController: EditorSettingsController | null = null;
let canvasGuidesController: CanvasGuidesController | null = null;
let mobileBrushStudio: MobileBrushStudioController | null = null;
let mobileStrokeSheet: MobileStrokeSheetController | null = null;
let mobileRasterEffectsSheet: MobileRasterEffectsSheetController | null = null;
let mobileToolSettingsSheet: MobileToolSettingsSheetController | null = null;
let rasterAdjustmentsController: RasterAdjustmentsController | null = null;
let appDiagnosticsController: AppDiagnosticsController | null = null;
let gpuMemoryPanelController: GpuMemoryPanelController | null = null;
let pixelSelectionController: PixelSelectionController | null = null;
let runtimeStatsController: RuntimeStatsController | null = null;
const editorExtensionBootstrap = window.__editorExtensionBootstrap;
const projectEditorBootstrap: ProjectEditorBootstrap | undefined =
  window.__projectEditorBootstrap;
const editorExtensionEngineOptions = editorExtensionBootstrap?.engineOptions ?? {};
let editorExtension: EditorExtension | null = null;
let projectSessionController: ProjectSessionController | null = null;

function selectCanvasToolWithMixedScene(tool: CanvasInputTool): boolean {
  const selected = canvasToolController?.select(tool) ?? false;
  if (
    selected
    && engineInitialized
    && engine.mixedSceneEnabled
    && (tool === "transform" || tool === "warp" || tool === "perspective")
    && !mixedSceneController
  ) {
    void initializeMixedSceneController().catch((error) => {
      appDiagnosticsController?.recordOperation("initialize-transform-editor", tool, error);
      console.error(`Could not initialize the ${tool} editor.`, error);
    });
  }
  return selected;
}
const engine = new BrushEngine(canvas, {
  onStatus(message, kind) {
    statusElement.textContent = message;
    statusElement.className = `status ${kind === "working" ? "" : kind}`;
    if (kind === "error") {
      appDiagnosticsController?.recordStatusError(message);
    }
    rasterAdjustmentsController?.handleEngineStatus(message, kind);
  },
  onMemoryAdmissionWarning() {
    return memoryLimitDialogController.confirm();
  },
  onStats(stats) {
    runtimeStatsController?.update(stats);
    brushQuickControlsController?.notifyEngineUpdate();
    mobileBrushStudio?.notifyEngineUpdate();
    brushOutlineController?.notifyEngineUpdate();
  },
  onHistoryChange(state) {
    projectSessionController?.noteHistoryState(state);
    appDiagnosticsController?.recordHistoryState(state);
    historyState = state;
    if (state.busy || state.openEdit !== null || state.inconsistent) {
      layerPanelController?.cancelTransientInteractions();
    }
    layerPanelController?.syncInteractionState();
    requestMobileLayersRefresh();
    if (!state.busy && state.openEdit === null) {
      scheduleMobileLayersRefresh();
      layerPanelController?.resumeThumbnailCapture();
    }
    updateHistoryControls();
    mobileToolSettingsSheet?.syncOpenState();
  },
  onViewChange() {
    mixedSceneController?.scheduleViewSync();
    canvasGuidesController?.scheduleRender();
    projectSessionController?.markDirty();
    brushOutlineController?.notifyEngineUpdate();
  },
  onPixelSelectionChange() {
    mobileToolSettingsSheet?.syncOpenState();
    syncMobileToolsMenuState();
  },
  onMixedSceneChange(snapshot) {
    projectSessionController?.noteSceneSnapshot(snapshot);
    appDiagnosticsController?.recordSceneSnapshot(snapshot);
    requestMobileLayersRefresh();
    mixedSceneController?.syncScene(snapshot);
    mobileToolSettingsSheet?.syncOpenState();
    syncMobileToolsMenuState(snapshot);
    const selectedItem = snapshot.items.find(
      (item) => item.key === snapshot.selectedKey,
    );
    layerSwitchResult.textContent = selectedItem?.kind === "text"
      ? "Text selected: brush suspended; the working raster stays resident."
      : selectedItem?.kind === "svg"
        ? "SVG selected: brush suspended; the working raster stays resident."
        : selectedItem?.kind === "image"
          ? "Image selected: brush suspended; use Transform, then Apply or Cancel."
          : "Raster selected: brush active.";
  },
  onActiveLayerChange(activeIndex) {
    // A global undo can move the active layer on its own. Without resyncing, the
    // panel would keep highlighting the layer the user left and the raster effect
    // controls would show that layer's styles while the brush paints on
    // another one.
    syncActiveLayerControls();
    requestMobileLayersRefresh();
    layerPanelController?.ensureActiveThumbnail();
    const mixedSnapshot = engine.getMixedSceneSnapshot();
    if (mixedSnapshot) {
      mixedSceneController?.syncScene(mixedSnapshot);
    }
    layerSwitchResult.textContent =
      `Undo/Redo selected layer ${activeIndex + 1}.`;
    projectSessionController?.markDirty();
  },
}, tipPreviewCanvas, {
  bevelBoundingFieldEnabled:
    editorExtensionEngineOptions.bevelBoundingFieldEnabled ?? bevelBoundingFieldEnabled,
  layerMemoryStressTestEnabled:
    editorExtensionEngineOptions.layerMemoryStressTestEnabled ?? false,
  layerCompressionTestEnabled:
    editorExtensionEngineOptions.layerCompressionTestEnabled ?? false,
  mixedSceneEnabled: resolveMixedSceneEnabled(editorExtensionEngineOptions, true),
  vectorTextRoiCacheEnabled:
    editorExtensionEngineOptions.vectorTextRoiCacheEnabled ?? vectorTextRoiCacheEnabled,
  layerColdCompressionEnabled: layerColdCompressionRequested,
  // Le notifiche restano su richiesta esplicita: ora che la compressione gira
  // sempre, annunciare ogni livello compresso sarebbe rumore, non informazione.
  // Il pannello memoria mostra comunque lo stato di ogni livello in tempo reale.
  layerColdCompressionStatusEnabled: layerColdCompressionMode === "1",
  layerColdDirectHotHydrationEnabled,
  layerColdTileCompositeEnabled,
  layerColdAdjacentPrefetchEnabled,
}, rasterSelectionOverlayCanvas);
const brushSettingsController = new BrushSettingsController(engine);
const canvasToolSettingsController = new CanvasToolSettingsController();
projectSessionController = new ProjectSessionController({
  engine: {
    captureDocument: () => engine.captureProjectDocument(),
    captureThumbnailPixels: () => engine.captureProjectThumbnailPixels(),
    restoreDocument: (project) => engine.restoreProjectDocument(project),
    historyState: () => engine.getHistoryState(),
    sceneSnapshot: () => engine.getMixedSceneSnapshot(),
    setInitialLayerName: (name) => {
      engine.layerStack.active.name = name;
    },
  },
  storage: projectEditorBootstrap?.storage ?? createProjectStorage(),
  storageReady: projectEditorBootstrap?.storageReady,
  preloadedProjectId: projectEditorBootstrap?.preloadedProjectId,
  preloadedProject: projectEditorBootstrap?.preloadedProject,
  settleTransientEdits: settleTransientProjectEdits,
  onReturnHome: projectEditorBootstrap?.returnHome,
  browser: window,
  document,
  searchParams: pageSearchParams,
  documentWidth: DOCUMENT_WIDTH,
  documentHeight: DOCUMENT_HEIGHT,
  saveButton: saveProjectButton,
  homeButton: projectHomeButton,
  status: statusElement,
});
appDiagnosticsController = new AppDiagnosticsController({
  engine,
  browser: window,
  document,
  navigator,
  canvas,
  elements: {
    copyButton: copyAppDiagnosticsButton,
    copyStatus: appDiagnosticsCopyStatus,
    details: appDiagnosticsDetails,
    report: appDiagnosticsReport,
    appStatus: statusElement,
    layerStatus: layerSwitchResult,
  },
  appMode: import.meta.env.MODE,
  documentSize: DOCUMENT_MAX_EDGE,
  documentWidth: DOCUMENT_WIDTH,
  documentHeight: DOCUMENT_HEIGHT,
  getUiSnapshot: () => ({
    engineInitialized,
    layerSwitching: sceneEditorController?.isBusy === true,
    historyUiBusy: historyControlsController.uiBusy,
    historyQueueDraining: historyControlsController.isQueueDraining,
    queuedHistoryOperations: historyControlsController.queuedOperationCount,
    activePointer: canvasInputController?.isPointerActive === true,
    currentHistory: historyState,
    lastHistoryFailure: historyControlsController.lastFailure,
    rasterAdjustmentLocks: rasterAdjustmentsController?.diagnostics() ?? {
      rasterGaussianBlurUiBusy: false,
      rasterMotionBlurUiBusy: false,
      rasterNoiseUiBusy: false,
      rasterLiquifyUiBusy: false,
    },
  }),
  getVectorDiagnostics: () => mixedSceneController?.getDiagnostics() ?? null,
});
const historyControlsController = new HistoryControlsController({
  engine: {
    state: () => engine.getHistoryState(),
    undo: () => engine.undo(),
    redo: () => engine.redo(),
    crossedAction: (operation) => {
      const cursor = engine.historyCursor;
      const action = operation === "undo"
        ? engine.historyActions[cursor - 1]
        : engine.historyActions[cursor];
      return { action: action?.kind ?? null, cursor };
    },
  },
  browser: window,
  undoButton: mobileUndoButton,
  redoButton: mobileRedoButton,
  initialState: historyState,
  interactionLocked,
  requestLocked: historyRequestLocked,
  onStateChange: (state) => {
    historyState = state;
    mobileBrushStudio?.retryPendingAssetRelease();
  },
  onControlsLockChange: (locked) => {
    brushQuickControlsController?.setLocked(locked);
    mobilePaintButton.disabled = locked;
    mobileEraserButton.disabled = locked;
    mobileBlendButton.disabled = locked;
    mobilePanButton.disabled = locked;
    mobileToolSettingsSheet?.syncOpenState();
    syncMobileToolsMenuState();
    brushQuickControlsController?.syncVisibility();
    editorExtension?.syncControls(locked);
  },
  onReplayComplete: () => {
    syncActiveLayerControls();
    requestMobileLayersRefresh();
    runtimeStatsController?.update(engine.getStats());
    requestMobileLayerThumbnailCapture(0);
  },
  setStatus: (message, kind = "working") => {
    statusElement.textContent = message;
    statusElement.className = `status ${kind === "working" ? "" : kind}`;
  },
  recordDiagnostic: (name, detail, error) => {
    appDiagnosticsController?.recordOperation(name, detail, error);
  },
});
gpuMemoryPanelController = new GpuMemoryPanelController({
  engine,
  browser: window,
  root: gpuMemoryMonitor,
  memoryStat,
  documentWidth: DOCUMENT_WIDTH,
  documentHeight: DOCUMENT_HEIGHT,
  isEngineReady: () => engineInitialized,
  getLastHistoryFailure: () => historyControlsController.lastFailure,
});
runtimeStatsController = new RuntimeStatsController({
  engine: { getStats: () => engine.getStats() },
  browser: window,
  document,
  elements: {
    renderingModeMemoryHint,
    fps: element<HTMLElement>("fpsStat"),
    cpu: element<HTMLElement>("cpuStat"),
    stamps: element<HTMLElement>("stampStat"),
    avoidedDraws: element<HTMLElement>("avoidedStat"),
    gpu: element<HTMLElement>("gpuStat"),
  },
  isEngineReady: () => engineInitialized,
  getActiveCanvasTool: () => canvasToolController?.activeTool ?? "paint",
  getActiveBrushTool: () => canvasToolController?.activeBrush ?? "paint",
  getBrushBlendMode: () => brushSettingsController.snapshot().blendMode,
  renderLayers: renderMobileLayerList,
  updateGpuMemory: (stats) => gpuMemoryPanelController?.update(stats),
  recordDiagnostic: (name, detail, error) => {
    appDiagnosticsController?.recordOperation(name, detail, error);
  },
  onPollingError: (error) => console.error("Runtime stats polling failed.", error),
});
if (editorExtensionBootstrap) {
  const host: EditorExtensionHost = {
    engine,
    canvas,
    ensureMixedSceneController: initializeMixedSceneController,
    applyBrushSettings,
    collectInputDiagnostics() {
      const inputDiagnostics = canvasInputController?.diagnostics()
        ?? CanvasInputController.initialDiagnostics(touchPaintIntentHoldEnabled);
      return {
        viewRotationDegrees: Number(engine.getViewRotationDegrees().toFixed(3)),
        controlsLayoutStrategy: "full-stage-overlay-drawer",
        ...inputDiagnostics,
      };
    },
    refreshControls: updateHistoryControls,
    refreshStats(stats = engine.getStats()) {
      runtimeStatsController?.update(stats);
    },
    setStatus(message, kind = "working") {
      statusElement.textContent = message;
      statusElement.className = `status ${kind === "working" ? "" : kind}`;
    },
  };
  editorExtension = editorExtensionBootstrap.create(host);
}
if (import.meta.env.DEV) {
  (window as Window & { __brushEngine?: BrushEngine }).__brushEngine = engine;
}

let engineInitialized = false;
let mobileSheetLayoutFrame: number | null = null;
const authoritativeBrushStrokePreviewRenderer =
  new AuthoritativeBrushStrokePreviewRenderer(engine);
const mobileBrushLibraryPreviewRenderer = new MobileBrushLibraryPreviewRenderer(
  authoritativeBrushStrokePreviewRenderer,
);
const rasterStyleController = new RasterStyleController({
  engine,
  isEngineReady: () => engineInitialized,
  isPointerActive: () => canvasInputController?.isPointerActive === true,
  onBusyChange: updateHistoryControls,
});
let brushLibraryController: BrushLibraryController;
if (import.meta.env.DEV) {
  (window as Window & {
    __mobileBrushLibraryPreviewStats?: () => ReturnType<
      MobileBrushLibraryPreviewRenderer["stats"]
    >;
  }).__mobileBrushLibraryPreviewStats = () => mobileBrushLibraryPreviewRenderer.stats();
}
const layerThumbnailController = new LayerThumbnailController({
  browser: window,
  getStats: () => engineInitialized ? engine.getStats() : null,
  captureRasterLayerThumbnail: (layerId) => engine.captureRasterLayerThumbnail(layerId),
  canScheduleCapture: () => engineInitialized && layerPanelController?.isReordering !== true,
  captureBusy: () => canvasInputController?.isPointerActive === true
    || sceneEditorController?.isBusy === true
    || historyState.openEdit !== null
    || historyState.busy,
  onDirty: () => {
    layerPanelController?.scheduleRefresh();
  },
  onWarning: (message, error) => console.warn(message, error),
});
sceneEditorController = new SceneEditorController({
  engine,
  browser: window,
  elements: {
    app: appElement,
    loadingOverlay: layerLoadingOverlay,
    loadingLabel: layerLoadingLabel,
    result: layerSwitchResult,
  },
  getVectorController: () => mixedSceneController,
  isInteractionLocked: interactionLocked,
  onBusyChange: () => {
    updateHistoryControls();
    layerPanelController?.syncInteractionState();
  },
  onHistoryState: (state) => {
    historyState = state;
  },
  requestLayersRefresh: requestMobileLayersRefresh,
  renderLayers: renderMobileLayerList,
  syncActiveRasterControls: syncActiveLayerControls,
  syncToolSettings: () => mobileToolSettingsSheet?.syncOpenState(),
  onStats: (stats) => runtimeStatsController?.update(stats),
  recordDiagnostic: (name, detail, error) => {
    appDiagnosticsController?.recordOperation(name, detail, error);
  },
});
brushLibraryController = new BrushLibraryController({
  engine: {
    getSettings: () => engine.getSettings(),
    ensureCurrentBrushResources: () => engine.ensureCurrentBrushResources(),
  },
  browser: window,
  document,
  elements: {
    sheet: mobileBrushLibrarySheet,
    handle: mobileBrushLibraryHandle,
    importButton: mobileBrushLibraryImportButton,
    exportButton: mobileBrushLibraryExportButton,
    importFile: mobileBrushLibraryImportFile,
    addButton: mobileBrushLibraryAddButton,
    status: mobileBrushLibraryStatus,
    viewport: mobileBrushLibraryBrushes,
    list: mobileBrushLibraryList,
    empty: mobileBrushLibraryEmpty,
    categoryButtons: mobileBrushLibraryCategoryButtons,
    cards: mobileBrushLibraryCards,
    paintButton: mobilePaintButton,
  },
  previewRenderer: mobileBrushLibraryPreviewRenderer,
  strokePreviewRenderer: authoritativeBrushStrokePreviewRenderer,
  applySettings: applyBrushSettings,
  canOpen: () => (canvasToolController?.activeTool ?? "paint") === "paint"
    && rasterAdjustmentsController?.isAnySurfaceOpen !== true,
  beforeOpen: () => {
    if (mobileStrokeSheet?.isOpen) mobileStrokeSheet.close(false);
    if (mobileRasterEffectsSheet?.isOpen) mobileRasterEffectsSheet.close(false);
    if (mobileToolSettingsSheet?.isOpen) mobileToolSettingsSheet.close(false);
    if (editorSettingsController?.isOpen) editorSettingsController.setOpen(false);
    if (editorToolsController?.isOpen) editorToolsController.setOpen(false);
    if (layerPanelController?.isOpen) layerPanelController.setOpen(false);
  },
  beforeStudioOpen: () => {
    if (mobileStrokeSheet?.isOpen) mobileStrokeSheet.close(false);
    if (mobileRasterEffectsSheet?.isOpen) mobileRasterEffectsSheet.close(false);
    if (mobileToolSettingsSheet?.isOpen) mobileToolSettingsSheet.close(false);
    if (editorSettingsController?.isOpen) editorSettingsController.setOpen(false);
  },
  isPaintSelected: () => (canvasToolController?.activeTool ?? "paint") === "paint",
  onVisibilityChange: () => {
    brushQuickControlsController?.syncVisibility();
    syncMobileToolsMenuState();
    updateHistoryControls();
  },
  onStatus: (message, kind) => {
    statusElement.textContent = message;
    statusElement.className = `status ${kind === "working" ? "" : kind}`;
  },
});

let editorSettingsStorage: EditorSettingsStoragePort | null = null;
try {
  editorSettingsStorage = window.localStorage;
} catch {
  editorSettingsStorage = null;
}
editorSettingsController = new EditorSettingsController({
  browser: window,
  document,
  storage: editorSettingsStorage,
  elements: {
    trigger: editorSettingsMenuButton,
    panel: editorSettingsPanel,
    closeButton: editorSettingsCloseButton,
    rulersInput: editorRulersEnabledInput,
    gridInput: editorGridEnabledInput,
    snappingInput: editorSnappingEnabledInput,
  },
  canOpen: () => mobileBrushStudio?.isBusy !== true
    && rasterAdjustmentsController?.isAnySurfaceOpen !== true,
  beforeOpen: () => {
    if (mobileBrushStudio?.isOpen) mobileBrushStudio.cancel(false);
    if (mobileStrokeSheet?.isOpen) mobileStrokeSheet.close(false);
    if (mobileRasterEffectsSheet?.isOpen) mobileRasterEffectsSheet.close(false);
    if (mobileToolSettingsSheet?.isOpen) mobileToolSettingsSheet.close(false);
    if (editorToolsController?.isOpen) editorToolsController.setOpen(false);
    if (layerPanelController?.isOpen) layerPanelController.setOpen(false);
    if (brushLibraryController.isOpen) brushLibraryController.setOpen(false);
  },
  onOpenChange: () => brushQuickControlsController?.syncVisibility(),
  onPreferencesChange: () => canvasGuidesController?.preferencesChanged(),
});
canvasGuidesController = new CanvasGuidesController({
  browser: window,
  canvas: canvasGuidesOverlayCanvas,
  getDocumentSize: () => ({
    width: engine.documentWidth,
    height: engine.documentHeight,
  }),
  getViewportInsets: () => {
    const stageBounds = editorStage.getBoundingClientRect();
    const topbarBounds = editorTopbar.getBoundingClientRect();
    const railBounds = mobileToolRail.getBoundingClientRect();
    return {
      top: Math.max(0, topbarBounds.bottom - stageBounds.top),
      left: Math.max(0, railBounds.right - stageBounds.left),
    };
  },
  getView: () => engine.getVectorTextViewState(),
  getPreferences: () => editorSettingsController?.preferences
    ?? DEFAULT_EDITOR_GUIDE_PREFERENCES,
});
canvasGuidesController.scheduleRender();

brushQuickControlsController = new BrushQuickControlsController({
  browser: window,
  engine,
  settings: brushSettingsController,
  elements: {
    colorLabel: mobileBrushColorLabel,
    colorInput: mobileBrushColorInput,
    colorSwatch: mobileBrushColorSwatch,
    controls: mobileBrushControls,
    tracks: {
      size: mobileBrushSizeTrack,
      opacity: mobileBrushOpacityTrack,
      stretch: mobileBrushStretchTrack,
      paint: mobileBrushPaintTrack,
      blur: mobileBrushBlurTrack,
    },
    controlsByKind: {
      size: mobileBrushSizeControl,
      opacity: mobileBrushOpacityControl,
      stretch: mobileBrushStretchControl,
      paint: mobileBrushPaintControl,
      blur: mobileBrushBlurControl,
    },
    preview: mobileBrushPreview,
    previewLabel: mobileBrushPreviewLabel,
    previewCanvas: mobileBrushPreviewCanvas,
  },
  getActiveTool: () => canvasToolController?.activeTool ?? "paint",
  isInteractionLocked: interactionLocked,
  isSuppressedBySurface: () =>
    layerPanelController?.isOpen === true
    || editorToolsController?.isOpen === true
    || editorSettingsController?.isOpen === true
    || brushLibraryController.isOpen
    || mobileStrokeSheet?.isOpen === true
    || mobileRasterEffectsSheet?.isOpen === true
    || rasterAdjustmentsController?.isAnySheetOpen === true
    || mobileToolSettingsSheet?.isOpen === true
    || mobileBrushStudio?.isOpen === true,
  selectPaintTool: () => {
    canvasToolController?.select("paint");
  },
  markLibraryPreviewDirty: () => brushLibraryController.markPreviewDirty(),
  updateHistoryControls,
});

canvasToolController = new CanvasToolController({
  engine,
  browser: window,
  elements: {
    canvas,
    paintButton: mobilePaintButton,
    eraserButton: mobileEraserButton,
    blendButton: mobileBlendButton,
    panButton: mobilePanButton,
  },
  brushSettings: brushSettingsController,
  selectionSettings: canvasToolSettingsController,
  isEngineReady: () => engineInitialized,
  isInteractionLocked: interactionLocked,
  closeBrushStudioForTool: (tool) => {
    if (tool !== "paint" && mobileBrushStudio?.isOpen) {
      mobileBrushStudio.cancel(false);
    }
  },
  closeToolSettingsForTool: (tool, preserveToolSettings) => {
    if (
      !preserveToolSettings
      && mobileToolSettingsSheet?.isOpen
      && mobileToolSettingsSheet.toolKind !== tool
    ) {
      mobileToolSettingsSheet.close(false);
    }
  },
  closeBrushLibraryForTool: (tool) => {
    if (tool !== "paint" && brushLibraryController.isOpen) {
      brushLibraryController.setOpen(false);
    }
  },
  syncBrushLibraryButton: () => brushLibraryController.syncButtonState(),
  toggleBrushLibrary: () => brushLibraryController.toggle(),
  cancelKeyboardSelectionGesture: (hideCursor) => {
    canvasInputController?.cancelKeyboardSelectionGesture(hideCursor);
  },
  getVectorController: () => mixedSceneController,
  getOpenToolSettingsKind: () => mobileToolSettingsSheet?.isOpen
    ? mobileToolSettingsSheet.toolKind
    : null,
  syncMenuState: syncMobileToolsMenuState,
  syncBrushSettings: (settings) => {
    brushQuickControlsController?.syncSettings(settings);
  },
  syncQuickControls: () => {
    brushQuickControlsController?.syncVisibility();
    brushQuickControlsController?.syncAvailability();
  },
  syncToolSettings: () => mobileToolSettingsSheet?.syncOpenState(),
  updateHistoryControls,
});

pixelSelectionController = new PixelSelectionController({
  engine: {
    selectPixelsByColor: (color, tolerance, combineMode) =>
      engine.selectPixelsByColor(color, tolerance, combineMode),
    previewPixelsByColor: (color, tolerance, combineMode) =>
      engine.previewPixelsByColor(color, tolerance, combineMode),
    finishColorRangeSelectionPreview: () => engine.finishColorRangeSelectionPreview(),
    invertPixelSelection: () => engine.invertPixelSelection(),
    clearPixelSelection: () => engine.clearPixelSelection(),
  },
  isEngineReady: () => engineInitialized,
  getActiveTool: () => canvasToolController?.activeTool ?? "paint",
  getSelectionSettings: () => canvasToolSettingsController.selectionSnapshot(),
  onBusyChange: updateHistoryControls,
  onSettled: () => mobileToolSettingsSheet?.syncOpenState(),
  onError: (error) => console.error("WebGPU pixel selection failed", error),
});

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

function selectedMobileLayerProperties() {
  if (!engineInitialized) return null;
  return selectedSceneLayerProperties(
    engine.getStats(),
    interactionLocked() || sceneEditorController?.isBusy === true,
  );
}

function rasterEffectMenuEnabled(kind: EditorRasterEffectKind): boolean {
  return rasterStyleController.effectEnabled(kind);
}

function syncMobileToolsMenuState(
  sceneSnapshot = engineInitialized ? engine.getMixedSceneSnapshot() : null,
): void {
  const selectedSceneItem = sceneSnapshot?.items.find(
    (item) => item.key === sceneSnapshot.selectedKey,
  );
  const selectedItem = selectedMobileVectorItem(sceneSnapshot);
  const selectedText = selectedItem?.kind === "text" ? selectedItem.textNode : null;
  const selectedSvg = selectedItem?.kind === "svg" ? selectedItem.svgNode : null;
  const selectedEffectNode = selectedText ?? selectedSvg;
  const effectsEnabled = engineInitialized
    ? {
        "color-overlay": rasterEffectMenuEnabled("color-overlay"),
        stroke: rasterEffectMenuEnabled("stroke"),
        "outer-shadow": rasterEffectMenuEnabled("outer-shadow"),
        "inner-shadow": rasterEffectMenuEnabled("inner-shadow"),
        bevel: rasterEffectMenuEnabled("bevel"),
      }
    : {
        "color-overlay": false,
        stroke: false,
        "outer-shadow": false,
        "inner-shadow": false,
        bevel: false,
      };
  editorToolsController?.renderMenuState({
    activeCanvasTool: canvasToolController?.activeTool ?? "paint",
    engineReady: engineInitialized,
    interactionLocked: interactionLocked(),
    vectorEditorReady: mixedSceneController !== null,
    vectorEditorLocked: mixedSceneController?.getTextEditorSnapshot().locked ?? true,
    textSelected: selectedText !== null,
    svgSelected: selectedSvg !== null,
    textTransformActive: selectedText?.transformType !== undefined
      && selectedText.transformType !== "none",
    vectorOutlineEnabled: (selectedEffectNode?.outlineWidth ?? 0) > 0,
    vectorDropShadowEnabled: selectedEffectNode?.singleShadowEnabled === true,
    vectorInnerShadowEnabled: selectedEffectNode?.innerShadowEnabled === true,
    vectorBlockShadowEnabled: selectedEffectNode?.blockShadowEnabled === true,
    rasterColorOverlayTargetSelected: engineInitialized
      && rasterStyleController.colorOverlayTargetIsSelected(),
    rasterDeformTargetSelected: selectedSceneItem?.kind === "raster"
      && selectedSceneItem.rasterHasContent
      && engine.getPixelSelectionState().selectedPixels === 0,
    rasterEffectsEnabled: effectsEnabled,
  });
  rasterAdjustmentsController?.syncUi();
}





function requestMobileLayersRefresh(): void {
  layerPanelController?.requestRefresh();
}

function scheduleMobileLayersRefresh(): void {
  layerPanelController?.scheduleRefresh();
}

function requestMobileLayerThumbnailCapture(delayMs = 120): void {
  layerPanelController?.requestActiveThumbnail(delayMs);
}

function renderMobileLayerList(stats: EngineStats): void {
  layerPanelController?.render(stats);
}

function setMobileLayersPanelOpen(open: boolean): void {
  layerPanelController?.setOpen(open);
}

function applyBrushSettings(settings: Readonly<BrushSettings>): void {
  const applied = brushSettingsController.replace(settings);
  canvasToolController?.configure(applied.tool, false);
}

const brushStudioIntegration = brushLibraryController.studioIntegration();
mobileBrushStudio = new MobileBrushStudioController({
  settings: { getSettings: () => engine.getSettings() },
  assets: {
    registerCustomShapeAsset: (source, requestedId) =>
      engine.registerCustomShapeAsset(source, requestedId),
    registerCustomGrainAsset: (source, requestedId) =>
      engine.registerCustomGrainAsset(source, requestedId),
    getCustomBrushAsset: (id) => engine.getCustomBrushAsset(id),
    hasCustomBrushAsset: (id) => engine.hasCustomBrushAsset(id),
    removeCustomBrushAsset: (id) => engine.removeCustomBrushAsset(id),
  },
  runtime: { waitForIdle: () => engine.waitForIdle() },
  previewRenderer: authoritativeBrushStrokePreviewRenderer,
  root: element<HTMLElement>("mobileBrushStudioSheet"),
  appRoot: appElement,
  browser: window,
  applySettings: applyBrushSettings,
  ...brushStudioIntegration,
});
brushLibraryController.attachStudio(mobileBrushStudio);

mobileStrokeSheet = new MobileStrokeSheetController({
  root: element<HTMLElement>("mobileStrokeSheet"),
  browser: window,
  document,
  getStyle: () => rasterStyleController.getStrokeStyle(),
  applyStyle: (style) => rasterStyleController.applyStrokeStyle(style),
  beginHistoryEdit: () => engine.beginRasterLayerMetadataHistoryEdit("stroke"),
  commitHistoryEdit: (token) => engine.commitRasterLayerMetadataHistoryEdit(token),
  cancelHistoryEdit: (token) => engine.cancelRasterLayerMetadataHistoryEdit(token),
  beforeOpen: () => {
    editorToolsController?.setOpen(false);
    editorSettingsController?.setOpen(false);
    setMobileLayersPanelOpen(false);
    brushLibraryController.setOpen(false);
    mobileBrushStudio?.cancel(false);
    mobileRasterEffectsSheet?.close(false);
    mobileToolSettingsSheet?.close(false);
  },
  onOpenChange: () => {
    syncMobileToolsMenuState();
    brushQuickControlsController?.syncVisibility();
  },
});

mobileRasterEffectsSheet = new MobileRasterEffectsSheetController({
  root: element<HTMLElement>("mobileRasterEffectSheet"),
  browser: window,
  document,
  getColorOverlayStyle: () => rasterStyleController.getColorOverlayStyle(),
  applyColorOverlayStyle: (style) => rasterStyleController.applyColorOverlayStyle(style),
  getOuterShadowStyle: () => rasterStyleController.getOuterShadowStyle(),
  applyOuterShadowStyle: (style) => rasterStyleController.applyOuterShadowStyle(style),
  getInnerShadowStyle: () => rasterStyleController.getInnerShadowStyle(),
  applyInnerShadowStyle: (style) => rasterStyleController.applyInnerShadowStyle(style),
  getBevelStyle: () => rasterStyleController.getBevelStyle(),
  applyBevelStyle: (style) => rasterStyleController.applyBevelStyle(style),
  beginHistoryEdit: (kind: MobileRasterEffectKind) => {
    return engine.beginRasterLayerMetadataHistoryEdit(kind);
  },
  commitHistoryEdit: (token) => engine.commitRasterLayerMetadataHistoryEdit(token),
  cancelHistoryEdit: (token) => engine.cancelRasterLayerMetadataHistoryEdit(token),
  beforeOpen: () => {
    editorToolsController?.setOpen(false);
    editorSettingsController?.setOpen(false);
    setMobileLayersPanelOpen(false);
    brushLibraryController.setOpen(false);
    mobileBrushStudio?.cancel(false);
    mobileStrokeSheet?.close(false);
    mobileToolSettingsSheet?.close(false);
  },
  onOpenChange: () => {
    syncMobileToolsMenuState();
    brushQuickControlsController?.syncVisibility();
  },
});

rasterAdjustmentsController = new RasterAdjustmentsController({
  engine,
  browser: window,
  elements: {
    canvas,
    appStatus: statusElement,
    liquify: {
      openButton: mobileLiquifyOpenButton,
      sheet: mobileLiquifySheetElement,
      sheetHandle: mobileLiquifySheetHandle,
      sheetHeader: mobileLiquifySheetHeader,
      controlsRegion: mobileLiquifyControlsRegion,
      modeLabel: mobileLiquifyModeLabel,
      modeButtons: liquifyModeButtons,
      sizeInput: mobileLiquifySizeInput,
      sizeOutput: mobileLiquifySizeOutput,
      pressureInput: mobileLiquifyPressureInput,
      pressureOutput: mobileLiquifyPressureOutput,
      distortionInput: mobileLiquifyDistortionInput,
      distortionOutput: mobileLiquifyDistortionOutput,
      momentumInput: mobileLiquifyMomentumInput,
      momentumOutput: mobileLiquifyMomentumOutput,
      amountInput: mobileLiquifyAmountInput,
      amountOutput: mobileLiquifyAmountOutput,
      status: mobileLiquifyStatus,
      resetButton: mobileLiquifyResetButton,
      cancelButton: mobileLiquifyCancelButton,
      applyButton: mobileLiquifyApplyButton,
    },
    gaussianBlur: {
      openButton: mobileGaussianBlurOpenButton,
      sheet: mobileGaussianBlurSheetElement,
      sheetHandle: mobileGaussianBlurSheetHandle,
      sheetHeader: mobileGaussianBlurSheetHeader,
      controlsRegion: mobileGaussianBlurControlsRegion,
      radiusInput: mobileGaussianBlurRadiusInput,
      radiusOutput: mobileGaussianBlurRadiusOutput,
      status: mobileGaussianBlurStatus,
      cancelButton: mobileGaussianBlurCancelButton,
      applyButton: mobileGaussianBlurApplyButton,
    },
    motionBlur: {
      openButton: mobileMotionBlurOpenButton,
      sheet: mobileMotionBlurSheetElement,
      sheetHandle: mobileMotionBlurSheetHandle,
      sheetHeader: mobileMotionBlurSheetHeader,
      controlsRegion: mobileMotionBlurControlsRegion,
      distanceInput: mobileMotionBlurDistanceInput,
      distanceOutput: mobileMotionBlurDistanceOutput,
      angleInput: mobileMotionBlurAngleInput,
      angleOutput: mobileMotionBlurAngleOutput,
      status: mobileMotionBlurStatus,
      cancelButton: mobileMotionBlurCancelButton,
      applyButton: mobileMotionBlurApplyButton,
    },
    noise: {
      openButton: mobileNoiseOpenButton,
      sheet: mobileNoiseSheetElement,
      sheetHandle: mobileNoiseSheetHandle,
      sheetHeader: mobileNoiseSheetHeader,
      controlsRegion: mobileNoiseControlsRegion,
      amountInput: mobileNoiseAmountInput,
      amountOutput: mobileNoiseAmountOutput,
      styleSelect: mobileNoiseStyleSelect,
      scaleInput: mobileNoiseScaleInput,
      scaleOutput: mobileNoiseScaleOutput,
      octavesInput: mobileNoiseOctavesInput,
      octavesOutput: mobileNoiseOctavesOutput,
      turbulenceInput: mobileNoiseTurbulenceInput,
      turbulenceOutput: mobileNoiseTurbulenceOutput,
      channelsSelect: mobileNoiseChannelsSelect,
      additiveInput: mobileNoiseAdditiveInput,
      status: mobileNoiseStatus,
      cancelButton: mobileNoiseCancelButton,
      applyButton: mobileNoiseApplyButton,
    },
  },
  isEngineReady: () => engineInitialized,
  getHistoryState: () => historyState,
  onHistoryState: (state) => {
    historyState = state;
  },
  isInteractionLocked: interactionLocked,
  isSceneBusy: () => sceneEditorController?.isBusy === true,
  getActiveCanvasTool: () => canvasToolController?.activeTool ?? "paint",
  getActiveBrushTool: () => canvasToolController?.activeBrush ?? "paint",
  configureCanvasTool: (tool, restoreSnapshot) => {
    canvasToolController?.configure(tool, restoreSnapshot);
  },
  beforeSheetOpen: () => {
    editorToolsController?.setOpen(false);
    editorSettingsController?.setOpen(false);
    setMobileLayersPanelOpen(false);
    brushLibraryController.setOpen(false);
    mobileBrushStudio?.cancel(false);
    mobileStrokeSheet?.close(false);
    mobileRasterEffectsSheet?.close(false);
    mobileToolSettingsSheet?.close(false);
  },
  onSheetOpenChange: () => {
    syncMobileToolsMenuState();
    brushQuickControlsController?.syncVisibility();
  },
  updateHistoryControls,
  requestActiveThumbnail: requestMobileLayerThumbnailCapture,
});

mobileToolSettingsSheet = new MobileToolSettingsSheetController({
  root: element<HTMLElement>("mobileToolSettingsSheet"),
  browser: window,
  document,
  selectCanvasTool: selectCanvasToolWithMixedScene,
  getFillSettings: () => {
    const previewState = engine.getFillPreviewState();
    const adjustingPreview = historyState.openEdit === "fill"
      && previewState.active
      && !previewState.terminal;
    return {
      ...canvasToolSettingsController.fillSnapshot(),
      color: brushSettingsController.snapshot().color,
      locked: previewState.terminal || (interactionLocked() && !adjustingPreview),
    };
  },
  setFillTolerance: (tolerance) => {
    const fill = canvasToolSettingsController.setFillTolerance(tolerance);
    if (engineInitialized) {
      engine.updateFillPreview(fill.tolerance);
    }
  },
  setFillColor: (color) => {
    const settings = brushSettingsController.update({ color });
    brushQuickControlsController?.syncSettings(settings);
    updateHistoryControls();
  },
  getSelectionSettings: () => {
    const selection = canvasToolSettingsController.selectionSnapshot();
    const state = engine.getPixelSelectionState();
    const previewing = pixelSelectionController?.isColorRangePreviewBusy === true;
    const locked = interactionLocked() && !previewing;
    const bounds = state.bounds
      ? ` · ${state.bounds.width.toLocaleString("en-US")}×`
        + state.bounds.height.toLocaleString("en-US")
      : "";
    return {
      ...selection,
      locked,
      previewing,
      canInvert: !locked && !previewing && state.selectedPixels > 0,
      canClear: !locked && !previewing && state.selectedPixels > 0,
      status: state.selectedPixels === 0
        ? "No pixels selected."
        : `${state.selectedPixels.toLocaleString("en-US")} pixels selected`
          + ` · ${state.activeTiles} tiles${bounds}`,
    };
  },
  setSelectionMethod: (method) => {
    canvasToolController?.setSelectionMethod(method);
  },
  setSelectionTolerance: (tolerance) => {
    canvasToolSettingsController.setSelectionTolerance(tolerance);
  },
  setSelectionColor: (color) => {
    canvasToolSettingsController.setSelectionColor(color);
  },
  previewSelectionColor: () => {
    pixelSelectionController?.requestColorRangePreview();
  },
  finishSelectionColorPreview: () => {
    void pixelSelectionController?.finishColorRangePreview();
  },
  hasSelectedText: () => selectedMobileTextNode() !== null,
  hasSelectedVectorEffectTarget: () => selectedMobileVectorItem() !== null,
  setSelectionCombineMode: (mode) => canvasToolController?.setSelectionCombineMode(mode),
  invertSelection: () => { void pixelSelectionController?.invert(); },
  clearSelection: () => { void pixelSelectionController?.clear(); },
  applyTransform: () => mixedSceneController?.applyTransform(),
  cancelTransform: () => mixedSceneController?.cancelTransform(),
  getSelectedLayerOptions: () => {
    const properties = selectedMobileLayerProperties();
    return properties && {
      key: properties.key,
      name: properties.name,
      opacity: properties.opacity,
      blendMode: properties.blendMode,
      locked: properties.locked,
    };
  },
  setSelectedLayerOpacity: (opacity) => {
    const properties = selectedMobileLayerProperties();
    if (!properties || properties.locked) return;
    sceneEditorController?.setLayerOpacity(properties.key, opacity);
  },
  setSelectedLayerBlendMode: (blendMode) => {
    const properties = selectedMobileLayerProperties();
    if (
      !properties
      || properties.locked
      || properties.kind !== "raster"
    ) {
      return;
    }
    sceneEditorController?.setRasterBlendMode(properties.key, blendMode);
  },
  getSelectedSvgStyle: () => {
    const node = selectedMobileSvgNode();
    return node && {
      id: node.id,
      name: sceneLayerDisplayName(node.name),
      paintColors: node.paintColors,
      locked: interactionLocked() || sceneEditorController?.isBusy === true,
    };
  },
  setSelectedSvgPaintColor: (index, color) => {
    mixedSceneController?.setSelectedSvgPaintColor(index, color);
  },
  beginSvgPaintEdit: () => {
    return engine.beginVectorHistoryEdit();
  },
  commitSvgPaintEdit: () => {
    return engine.commitVectorHistoryEdit();
  },
  rasterizeSelectedSvg: () => mixedSceneController?.rasterizeSelectedSvgNode(),
  getTextCreationColor: () => brushSettingsController.snapshot().color,
  getTextEditorSnapshot: () => {
    const controller = mixedSceneController;
    if (controller) return controller.getTextEditorSnapshot();
    const node = selectedMobileTextNode();
    const locked = interactionLocked();
    return {
      selected: node !== null,
      locked,
      canCreate: engineInitialized && !locked,
      canReset: node !== null && !locked,
      canDelete: node !== null && !locked,
      canRasterize: node !== null && node.text.length > 0 && !locked,
      text: node?.text ?? "WebGPU",
      fontFamily: node?.fontFamily ?? "Anton",
      fontSize: node?.fontSize ?? 180,
      color: node?.color ?? brushSettingsController.snapshot().color,
      transformType: node?.transformType ?? "none",
      transformCurve: node?.transformCurve ?? 0,
      circleRadiusPercent: node?.circleRadiusPercent ?? 100,
      circleInverted: node?.circleInverted ?? false,
      distortEditing: false,
    };
  },
  getVectorEffectEditorSnapshot: () => {
    const controller = mixedSceneController;
    if (controller) return controller.getVectorEffectEditorSnapshot();
    const selected = selectedMobileVectorItem();
    if (!selected) return null;
    const node = selected.kind === "text" ? selected.textNode : selected.svgNode;
    return {
      locked: interactionLocked(),
      outlineWidth: node.outlineWidth,
      outlineColor: node.outlineColor,
      outlineJoin: node.outlineJoin,
      singleShadowEnabled: node.singleShadowEnabled,
      singleShadowColor: node.singleShadowColor,
      singleShadowOpacity: node.singleShadowOpacity,
      singleShadowOffset: node.singleShadowOffset,
      singleShadowAngle: node.singleShadowAngle,
      singleShadowBlur: node.singleShadowBlur,
      innerShadowEnabled: node.innerShadowEnabled,
      innerShadowColor: node.innerShadowColor,
      innerShadowOpacity: node.innerShadowOpacity,
      innerShadowOffset: node.innerShadowOffset,
      innerShadowAngle: node.innerShadowAngle,
      innerShadowBlur: node.innerShadowBlur,
      blockShadowEnabled: node.blockShadowEnabled,
      blockShadowColor: node.blockShadowColor,
      blockShadowOpacity: node.blockShadowOpacity,
      blockShadowOffset: node.blockShadowOffset,
      blockShadowAngle: node.blockShadowAngle,
      blockShadowOutlineWidth: node.blockShadowOutlineWidth,
    };
  },
  getTransformActionSnapshot: () => mixedSceneController?.getTransformActionSnapshot() ?? {
    active: false,
    preparing: false,
    canApply: false,
    canCancel: false,
  },
  updateSelectedTextProperties: (patch) =>
    mixedSceneController?.updateSelectedTextProperties(patch) ?? false,
  updateSelectedVectorEffectProperties: (patch) =>
    mixedSceneController?.updateSelectedVectorEffectProperties(patch) ?? false,
  setSelectedVectorShadowEnabled: (kind, enabled) =>
    mixedSceneController?.setSelectedVectorShadowEnabled(kind, enabled) ?? false,
  beginSelectedVectorPropertyEdit: () =>
    mixedSceneController?.beginSelectedVectorPropertyEdit() ?? false,
  commitSelectedVectorPropertyEdit: () =>
    mixedSceneController?.commitSelectedVectorPropertyEdit() ?? false,
  createText: (color) => mixedSceneController?.createText(color),
  resetText: () => canvasToolController?.resetSelectedText(),
  deleteText: () => canvasToolController?.deleteSelectedText(),
  rasterizeText: () => canvasToolController?.rasterizeSelectedText(),
  setTextWarpMode: (mode) => canvasToolController?.setTextWarpMode(mode) ?? false,
  resetTextDistort: () => mixedSceneController?.resetSelectedTextDistort(),
  toggleTextDistortEditing: () => canvasToolController?.toggleTextDistortEditing() ?? false,
  beforeOpen: () => {
    editorToolsController?.setOpen(false);
    editorSettingsController?.setOpen(false);
    setMobileLayersPanelOpen(false);
    brushLibraryController.setOpen(false);
    mobileBrushStudio?.cancel(false);
    mobileStrokeSheet?.close(false);
    mobileRasterEffectsSheet?.close(false);
  },
  onOpenChange: () => {
    syncMobileToolsMenuState();
    brushQuickControlsController?.syncVisibility();
  },
  onClose: (kind) => {
    if (kind === "selection") void pixelSelectionController?.finishColorRangePreview();
    canvasToolController?.finishFillToolOnSheetClose(kind);
    void canvasToolController?.finishTransformToolOnSheetClose(kind);
  },
});

editorToolsController = new EditorToolsController({
  browser: window,
  elements: {
    trigger: mobileToolsMenuButton,
    sheet: mobileToolsSheet,
    handle: mobileToolsSheetHandle,
    content: mobileToolsSheetContent,
    searchField: mobileToolsSearchField,
    searchInput: mobileToolsSearchInput,
    empty: mobileToolsEmpty,
    categories: mobileToolsCategories,
    canvasButtons: mobileToolsCanvasButtons,
    toolSettingsButtons: mobileToolSettingsButtons,
    vectorCommandButtons: mobileToolsVectorCommandButtons,
    effectButtons: mobileToolsEffectButtons,
  },
  canOpen: () => mobileBrushStudio?.isBusy !== true
    && rasterAdjustmentsController?.isAnySurfaceOpen !== true,
  beforeOpen: () => {
    if (mobileBrushStudio?.isOpen) mobileBrushStudio.cancel(false);
    if (mobileStrokeSheet?.isOpen) mobileStrokeSheet.close(false);
    if (mobileRasterEffectsSheet?.isOpen) mobileRasterEffectsSheet.close(false);
    if (mobileToolSettingsSheet?.isOpen) mobileToolSettingsSheet.close(false);
    if (editorSettingsController?.isOpen) editorSettingsController.setOpen(false);
    if (layerPanelController?.isOpen) layerPanelController.setOpen(false);
    if (brushLibraryController.isOpen) brushLibraryController.setOpen(false);
  },
  onOpenChange: () => brushQuickControlsController?.syncVisibility(),
  syncMenuState: syncMobileToolsMenuState,
  selectCanvasTool: selectCanvasToolWithMixedScene,
  openToolSettings: (kind, trigger) => {
    mobileToolSettingsSheet?.open(kind, trigger);
  },
  runVectorCommand: (command) => {
    if (interactionLocked()) return;
    const controller = mixedSceneController;
    if (!controller) return;
    if (command === "import-svg") controller.requestSvgImport();
    else controller.requestRasterImageImport();
  },
  openRasterEffect: (kind, trigger) => {
    if (!engineInitialized) return;
    if (kind === "stroke") mobileStrokeSheet?.open(trigger);
    else mobileRasterEffectsSheet?.open(kind, trigger);
  },
});

layerPanelController = new LayerPanelController({
  browser: window,
  document,
  elements: {
    trigger: mobileLayersMenuButton,
    panel: mobileLayersPanel,
    addButton: mobileAddLayerButton,
    copyButton: mobileCopyLayerButton,
    addMaskButton: mobileAddMaskButton,
    multiSelectButton: mobileLayerMultiSelectButton,
    list: mobileLayerList,
    multiActions: mobileLayerMultiActions,
    mergeSelectionButton: mobileLayerMergeSelectionButton,
    contextMenu: mobileLayerContextMenu,
    clippingButton: mobileLayerClippingButton,
    optionsButton: mobileLayerOptionsButton,
    rasterizeButton: mobileLayerRasterizeButton,
    mergeButton: mobileLayerMergeButton,
    mergeReason: mobileLayerMergeReason,
    mergeStatus: mobileLayerMergeStatus,
    deleteButton: mobileLayerDeleteButton,
    reorderStatus: mobileLayerReorderStatus,
  },
  thumbnails: layerThumbnailController,
  getStats: () => engineInitialized ? engine.getStats() : null,
  isInteractionLocked: () => interactionLocked() || sceneEditorController?.isBusy === true,
  isRenderDeferred: () => canvasInputController?.isPointerActive === true
    || sceneEditorController?.isBusy === true
    || historyState.openEdit !== null
    || historyState.busy,
  canOpen: () => mobileBrushStudio?.isBusy !== true
    && rasterAdjustmentsController?.isAnySurfaceOpen !== true,
  beforeOpen: () => {
    if (mobileBrushStudio?.isOpen) mobileBrushStudio.cancel(false);
    if (mobileStrokeSheet?.isOpen) mobileStrokeSheet.close(false);
    if (mobileRasterEffectsSheet?.isOpen) mobileRasterEffectsSheet.close(false);
    if (mobileToolSettingsSheet?.isOpen) mobileToolSettingsSheet.close(false);
    if (editorSettingsController?.isOpen) editorSettingsController.setOpen(false);
    if (editorToolsController.isOpen) editorToolsController.setOpen(false);
    if (brushLibraryController.isOpen) brushLibraryController.setOpen(false);
  },
  onOpenChange: () => brushQuickControlsController?.syncVisibility(),
  getReorderTargets: (key) => sceneEditorController!.getReorderTargets(key),
  moveLayer: (key, targetTopFirstSlot) =>
    sceneEditorController!.moveLayer(key, targetTopFirstSlot),
  mergeCapabilityError: (keys, stats) =>
    sceneEditorController!.mergeCapabilityError(keys, stats),
  mergeLayers: (keys) => sceneEditorController!.mergeLayers(keys),
  rasterizeLayer: (key) => sceneEditorController!.rasterizeLayer(key),
  addRasterLayer: () => sceneEditorController?.addRasterLayer(),
  duplicateSelectedLayer: () => sceneEditorController!.duplicateSelectedLayer(),
  addClippingMaskLayer: () => sceneEditorController?.addClippingMaskLayer(),
  selectLayer: (key) => sceneEditorController?.selectLayer(key),
  setLayerVisibility: (key, visible) =>
    sceneEditorController?.setLayerVisibility(key, visible),
  setRasterReference: (key, enabled) =>
    sceneEditorController?.setRasterReference(key, enabled),
  setDocumentBackgroundVisibility: (visible) => {
    const changed = engine.setDocumentBackgroundVisibility(visible);
    if (changed) {
      projectSessionController?.markDirty();
      scheduleMobileLayersRefresh();
    }
    return changed;
  },
  setDocumentBackgroundColor: (color) => {
    const changed = engine.setDocumentBackgroundColor(color);
    if (changed) {
      projectSessionController?.markDirty();
      scheduleMobileLayersRefresh();
    }
    return changed;
  },
  setRasterClipping: (key, enabled) =>
    sceneEditorController?.setRasterClipping(key, enabled),
  deleteLayer: (key) => sceneEditorController!.deleteLayer(key),
  openLayerOptions: (trigger) => {
    mobileToolSettingsSheet?.open("layer-options", trigger);
  },
  onLayerResult: (message) => {
    layerSwitchResult.textContent = message;
  },
  onStatus: (message, failed) => {
    statusElement.textContent = message;
    statusElement.className = `status${failed ? " error" : ""}`;
  },
  recordDiagnostic: (name, detail, error) => {
    appDiagnosticsController?.recordOperation(name, detail, error);
  },
});

canvasInputController = new CanvasInputController({
  engine,
  browser: window,
  elements: {
    canvas,
    selectionGestureCanvas: rasterSelectionGestureCanvas,
    selectionGestureContext: rasterSelectionGestureContext,
    status: statusElement,
  },
  touchPaintIntentHoldEnabled,
  getActiveTool: () => canvasToolController?.activeTool ?? "paint",
  getSelectionMethod: () => canvasToolController?.selectionMethod ?? "automatic",
  getFillSettings: () => ({
    ...canvasToolSettingsController.fillSnapshot(),
    color: brushSettingsController.snapshot().color,
  }),
  getSelectionSettings: () => canvasToolSettingsController.selectionSnapshot(),
  getHistoryState: () => historyState,
  onHistoryState: (state) => {
    historyState = state;
  },
  operationLocked,
  viewOperationLocked: canvasViewOperationLocked,
  isPaintReadinessPending: () => engine.isPaintReadinessPending(),
  isLiquifyEditActive: () =>
    rasterAdjustmentsController?.isLiquifyEditActive(historyState) === true,
  isDestructivePreviewNavigationActive: () =>
    rasterAdjustmentsController?.isDestructivePreviewNavigationActive(historyState) === true
    || fillPreviewAllowsCanvasNavigation(),
  getVectorController: () => mixedSceneController,
  getEditorExtension: () => editorExtension,
  updateHistoryControls,
  runPixelSelectionOperation: (operation) => {
    void pixelSelectionController?.run(operation);
  },
  scheduleLayersRefresh: scheduleMobileLayersRefresh,
  invalidateActiveThumbnail: requestMobileLayerThumbnailCapture,
});

brushOutlineController = new BrushOutlineController({
  engine,
  browser: window,
  canvas,
  overlay: brushOutlineCanvas,
  getActiveTool: () => canvasToolController?.activeTool ?? "paint",
});

documentInteractionController = new DocumentInteractionController({
  browser: window,
  document,
  engine,
  cancelTransientInteraction: () => layerPanelController?.cancelActiveGesture(),
});

async function settleTransientProjectEdits(): Promise<void> {
  if (!engineInitialized) return;
  const fillPreviewActive = engine.getFillPreviewState().active;
  const fillToolActive = engine.fillToolSelected
    || canvasToolController?.activeTool === "fill";
  if (!fillPreviewActive && !fillToolActive) return;
  if (canvasToolController) {
    canvasToolController.finishFillToolOnSheetClose("fill");
  }
  await engine.setFillToolSelected(false);
  if (engine.getFillPreviewState().active) {
    throw new Error("Fill could not finish safely.");
  }
}

window.addEventListener("pagehide", () => {
  // Last-resort only. Home and Save await this same gate before navigating or
  // capturing; pagehide covers browser-level departures where waiting is not
  // available.
  void settleTransientProjectEdits();
  appDiagnosticsController?.dispose();
  gpuMemoryPanelController?.dispose();
  canvasGuidesController?.dispose();
  editorSettingsController?.dispose();
  layerPanelController?.dispose();
  canvasInputController?.dispose();
  brushOutlineController?.dispose();
  documentInteractionController?.dispose();
  rasterAdjustmentsController?.dispose();
  canvasToolController?.dispose();
  brushQuickControlsController?.dispose();
  sceneEditorController?.dispose();
  editorToolsController.dispose();
  layerThumbnailController.dispose();
  void mobileBrushStudio?.dispose();
  brushLibraryController.dispose();
  historyControlsController.dispose();
  runtimeStatsController?.dispose();
  pixelSelectionController?.dispose();
}, { once: true });

function fillPreviewAllowsCanvasNavigation(): boolean {
  if (!engineInitialized || historyState.openEdit !== "fill") return false;
  const previewState = engine.getFillPreviewState();
  return previewState.active && !previewState.terminal;
}

function nonHistoryOperationLocked(allowDestructivePreviewEdit = false): boolean {
  return !engineInitialized
    || sceneEditorController?.isBusy === true
    || mixedSceneController?.isBusy === true
    || brushQuickControlsController?.isDragging === true
    || mobileBrushStudio?.isOpen === true
    || historyState.openEdit === "transform"
    || (
      !allowDestructivePreviewEdit
      && (
        rasterAdjustmentsController?.hasActiveHistoryEdit(historyState) === true
        || historyState.openEdit === "fill"
      )
    )
    || historyState.openEdit === "raster-property"
    || rasterStyleController.isBusy
    || pixelSelectionController?.isBusy === true
    || editorExtension?.isBusy() === true;
}

function operationLocked(allowDestructivePreviewEdit = false): boolean {
  return nonHistoryOperationLocked(allowDestructivePreviewEdit)
    || historyControlsController.uiBusy
    || historyState.busy;
}

function interactionLocked(): boolean {
  return operationLocked() || canvasInputController?.isPointerActive === true;
}

/**
 * Pan, zoom e rotazione non modificano i pixel e restano disponibili mentre
 * un filtro o Fill mostrano la loro anteprima distruttiva. Il normale lock del
 * documento continua invece a proteggere pennello, livelli e cronologia.
 */
function canvasViewOperationLocked(): boolean {
  return operationLocked(
    rasterAdjustmentsController?.allowsCanvasViewOperation(historyState) === true
      || fillPreviewAllowsCanvasNavigation(),
  );
}

/**
 * Lucchetto per la sola scorciatoia di cronologia.
 *
 * `interactionLocked()` comprende il replay UI e `historyState.busy`, cioe'
 * e' vero **mentre un annullamento sta lavorando**. Usarlo qui significherebbe
 * scartare i tasti premuti durante il passo precedente: esattamente il difetto
 * che la coda esiste per risolvere. Accodare un altro passo di cronologia
 * mentre uno e' in corso e' legittimo — sara' il turno di esecuzione a
 * verificare che sia ancora possibile.
 */
function historyRequestLocked(): boolean {
  return nonHistoryOperationLocked() || canvasInputController?.isPointerActive === true;
}

function updateHistoryControls(): void {
  historyControlsController.acceptState(historyState);
  if (editorToolsController?.isOpen) syncMobileToolsMenuState();
  brushOutlineController?.notifyEngineUpdate();
}


window.addEventListener("resize", () => {
  const toolsNeedLayout = editorToolsController.isOpen && !editorToolsController.isDragging;
  const brushLibraryNeedsLayout = brushLibraryController.isOpen
    && !brushLibraryController.isDragging;
  const brushStudioNeedsLayout = mobileBrushStudio?.isOpen === true;
  const strokeSheetNeedsLayout = mobileStrokeSheet?.isOpen === true;
  const rasterEffectsSheetNeedsLayout = mobileRasterEffectsSheet?.isOpen === true;
  const rasterAdjustmentNeedsLayout = rasterAdjustmentsController?.isAnySheetOpen === true;
  const toolSettingsSheetNeedsLayout = mobileToolSettingsSheet?.isOpen === true;
  if (
    !toolsNeedLayout
    && !brushLibraryNeedsLayout
    && !brushStudioNeedsLayout
    && !strokeSheetNeedsLayout
    && !rasterEffectsSheetNeedsLayout
    && !rasterAdjustmentNeedsLayout
    && !toolSettingsSheetNeedsLayout
  ) return;
  if (mobileSheetLayoutFrame !== null) {
    cancelAnimationFrame(mobileSheetLayoutFrame);
  }
  mobileSheetLayoutFrame = requestAnimationFrame(() => {
    mobileSheetLayoutFrame = null;
    editorToolsController.handleResize();
    brushLibraryController.handleResize();
    mobileBrushStudio?.handleResize();
    mobileStrokeSheet?.handleResize();
    mobileRasterEffectsSheet?.handleResize();
    rasterAdjustmentsController?.handleResize();
    mobileToolSettingsSheet?.handleResize();
  });
});

/**
 * After a switch all non-destructive effect controls must be re-read from the
 * engine, because the styles belong to the layer record now. Leaving them alone
 * would show the outgoing layer's settings while painting on the incoming one.
 */
function syncActiveLayerControls(): void {
  mobileStrokeSheet?.sync(rasterStyleController.getStrokeStyle());
  mobileRasterEffectsSheet?.syncOpenStyle();
  mobileToolSettingsSheet?.syncOpenState();
  syncMobileToolsMenuState();
}

editorToolsController.setOpen(false);
brushLibraryController.setOpen(false);
mobileStrokeSheet?.close(false);
mobileRasterEffectsSheet?.close(false);
mobileToolSettingsSheet?.close(false);
canvasToolController?.setSelectionCombineMode("replace");
canvasToolController?.configure("paint", false);
updateHistoryControls();

function scheduleDeferredStartupTask(
  name: string,
  task: () => Promise<void>,
  timeout: number,
): void {
  const run = (): void => {
    void task().catch((error) => {
      appDiagnosticsController?.recordOperation(name, null, error);
      console.error(`Deferred startup task ${name} failed.`, error);
    });
  };
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(run, { timeout });
    return;
  }
  window.setTimeout(run, 0);
}

async function initializeMixedSceneController(): Promise<MixedSceneController> {
  if (mixedSceneController) return mixedSceneController;
  if (mixedSceneInitializationPromise) return mixedSceneInitializationPromise;

  const initialization = (async (): Promise<MixedSceneController> => {
    await engine.ensureOptionalEditorResources();
    const { MixedSceneController } = await import("./mixed-scene-controller");
    const controller = new MixedSceneController(engine, {
      root: appElement,
      browser: window,
      clippedRefreshPolicy:
        editorExtensionBootstrap?.vectorTextClippedRefreshPolicy ?? "during-gesture",
      onEditorStateChange: () => mobileToolSettingsSheet?.syncOpenState(),
      canvasGuides: {
        getPreferences: () => editorSettingsController?.preferences
          ?? DEFAULT_EDITOR_GUIDE_PREFERENCES,
        setSmartGuides: (guides) => canvasGuidesController?.setSmartGuides(guides),
      },
    });
    await controller.initialize();
    mixedSceneController = controller;
    canvasToolController?.syncVectorControllerState();
    const snapshot = engine.getMixedSceneSnapshot();
    if (snapshot) controller.syncScene(snapshot);
    syncMobileToolsMenuState(snapshot);
    requestMobileLayersRefresh();
    mobileToolSettingsSheet?.syncOpenState();
    if (import.meta.env.DEV) {
      (window as Window & {
        __mixedSceneController?: MixedSceneController;
      }).__mixedSceneController = mixedSceneController;
    }
    return controller;
  })();
  mixedSceneInitializationPromise = initialization;
  try {
    return await initialization;
  } catch (error) {
    if (mixedSceneInitializationPromise === initialization) {
      mixedSceneInitializationPromise = null;
    }
    throw error;
  }
}

void engine.initialize()
  .then(async () => {
    engineInitialized = true;
    brushOutlineController?.prepareGpuResources();
    if (!projectSessionController) {
      throw new Error("Project session controller is unavailable.");
    }
    if (
      mobileBrushStudio
      && (editorExtensionBootstrap?.restorePersistedBrushOnStartup ?? true)
    ) {
      await brushLibraryController.restoreActiveBrush();
    }
    await projectSessionController.initialize();
    syncMobileToolsMenuState();
    historyState = engine.getHistoryState();
    layerPanelController?.ensureActiveThumbnail(0);
    updateHistoryControls();
    runtimeStatsController?.start();
    await editorExtension?.afterEngineInitialized();

    scheduleDeferredStartupTask(
      "deferred-gpu-pipelines",
      () => engine.ensureOptionalEditorResources(),
      500,
    );
    if (engine.mixedSceneEnabled) {
      scheduleDeferredStartupTask(
        "deferred-mixed-scene",
        async () => {
          await initializeMixedSceneController();
        },
        1_500,
      );
    }
  })
  .catch((error) => {
    editorExtension?.handleEngineInitializationError(error);
    const message = error instanceof Error ? error.message : String(error);
    const secureContextHint = !window.isSecureContext
      ? " WebGPU requires HTTPS or localhost; an HTTP address on your local network is not sufficient."
      : "";
    statusElement.textContent = `${message}${secureContextHint}`;
    statusElement.className = "status error";
    updateHistoryControls();
  });
