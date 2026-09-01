import "./styles.css";
import { canonicalBrushColorForFormat } from "./brush-color.ts";
import {
  getCanvasStartupOverlayController,
  type CanvasRuntimeLoadingOperation,
} from "./canvas-startup-overlay-controller";
import { EditorToolsController } from "./editor-tools-controller";
import type {
  EditorRasterEffectKind,
  EditorToolSettingsKind,
} from "./editor-tools-contract";
import { SceneImportBridge } from "./scene-import-bridge";
import { EditorFiltersController } from "./editor-filters-controller";
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
import { CloneToolController } from "./clone-tool-controller";
import type { CloneSampleMode } from "./clone-interaction-core";
import { ShapeToolController } from "./shape-tool-controller";
import { PixelSelectionController } from "./pixel-selection-controller";
import { AppDiagnosticsController } from "./app-diagnostics-controller";
import { GpuMemoryPanelController } from "./gpu-memory-panel-controller";
import { RuntimeStatsController } from "./runtime-stats-controller";
import { HistoryControlsController } from "./history-controls-controller";
import { MobileStrokeSheetController } from "./mobile-stroke-sheet";
import {
  RasterAdjustmentsController,
  type RasterAdjustmentsEnginePort,
} from "./raster-adjustments-controller";
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
  Circle,
  CircleDashed,
  CircleDotDashed,
  Copy,
  Download,
  Eraser,
  Eye,
  EyeOff,
  Filter,
  Focus,
  Grid3X3,
  Hand,
  House,
  Image as ImageIcon,
  Layers3,
  LensConvex,
  MoveDiagonal2,
  PaintBucket,
  Palette,
  Pencil,
  Plus,
  Redo2,
  Save,
  Scale,
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
  Square,
  SquareStack,
  Star,
  Sun,
  Type as TypeIcon,
  TypeOutline,
  Undo2,
  Upload,
  Wind,
  X,
  createIcons,
  type IconNode,
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
import {
  LayerPanelController,
  type LayerPanelMultiSelectionSnapshot,
} from "./layer-panel-controller";
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
import type { VectorTransformActionSnapshot } from "./vector-editor-contract";
import { createProjectStorage } from "./project-storage";
import type {
  ProjectEditorBootstrap,
  ProjectSessionSwitchResult,
  ProjectSessionSwitchStage,
} from "./project-shell-contract";
import { ProjectSessionController } from "./project-session-controller";
import { resolveMixedSceneEnabled } from "./compat/mixed-scene-options";

const pointBlurIcon: IconNode = [
  ["circle", { cx: "12", cy: "12", r: "2", fill: "currentColor", stroke: "none" }],
  ["circle", { cx: "12", cy: "12", r: "5", opacity: "0.72" }],
  ["circle", { cx: "12", cy: "12", r: "9", opacity: "0.36" }],
];

createIcons({
  icons: {
    Blend,
    Box,
    Brush,
    Check,
    ChevronDown,
    Circle,
    CircleDashed,
    CircleDotDashed,
    Copy,
    Download,
    Eraser,
    Eye,
    EyeOff,
    Filter,
    Focus,
    Grid3X3,
    Hand,
    House,
    Image: ImageIcon,
    Layers3,
    LensConvex,
    MoveDiagonal2,
    PaintBucket,
    Palette,
    Pencil,
    Plus,
    PointBlur: pointBlurIcon,
    Redo2,
    Save,
    Scale,
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
    Square,
    SquareStack,
    Star,
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
const cloneSourceOverlay = element<HTMLElement>("cloneSourceOverlay");
const cloneSourceMarker = element<HTMLElement>("cloneSourceMarker");
const cloneSamplePreview = element<HTMLCanvasElement>("cloneSamplePreview");
const cloneToolDock = element<HTMLElement>("cloneToolDock");
const cloneSetSourceButton = element<HTMLButtonElement>("cloneSetSource");
const cloneSampleModeButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-clone-sample-mode]"),
);
const cloneAlignedButton = element<HTMLButtonElement>("cloneAligned");
const cloneAngleInput = element<HTMLInputElement>("cloneAngle");
const cloneAngleValue = element<HTMLOutputElement>("cloneAngleValue");
const cloneAngleResetButton = element<HTMLButtonElement>("cloneAngleReset");
const cloneToolStatus = element<HTMLOutputElement>("cloneToolStatus");
const shapeToolDock = element<HTMLElement>("shapeToolDock");
const shapeKindButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-shape-kind]"),
);
const shapeFillColor = element<HTMLInputElement>("shapeFillColor");
const shapeToolStatus = element<HTMLOutputElement>("shapeToolStatus");
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
const editorTopbar = element<HTMLElement>("editorTopbar");
const mobileToolRail = element<HTMLElement>("mobileToolRail");
const projectHomeButton = element<HTMLButtonElement>("projectHomeButton");
const saveProjectButton = element<HTMLButtonElement>("saveProjectButton");
const statusElement = element<HTMLParagraphElement>("status");
const vectorSvgFileInput = element<HTMLInputElement>("vectorSvgFileInput");
const rasterImageFileInput = element<HTMLInputElement>("rasterImageFileInput");
const layerSwitchResult = element<HTMLParagraphElement>("layerSwitchResult");
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
const editorFiltersMenuButton = element<HTMLButtonElement>("editorFiltersMenu");
const editorFiltersPanel = element<HTMLElement>("editorFiltersPanel");
const editorFiltersCloseButton = element<HTMLButtonElement>("editorFiltersClose");
const editorFilterButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-editor-filter-kind]"),
);
const editorSettingsMenuButton = element<HTMLButtonElement>("editorSettingsMenu");
const editorSettingsPanel = element<HTMLElement>("editorSettingsPanel");
const editorSettingsCloseButton = element<HTMLButtonElement>("editorSettingsClose");
const editorBrushPrecisionButtons = Array.from(
  editorSettingsPanel.querySelectorAll<HTMLButtonElement>(
    "[data-editor-brush-precision]",
  ),
);
const editorRulersEnabledInput = element<HTMLInputElement>("editorRulersEnabled");
const editorGridEnabledInput = element<HTMLInputElement>("editorGridEnabled");
const editorPixelGridEnabledInput = element<HTMLInputElement>("editorPixelGridEnabled");
const editorSnappingEnabledInput = element<HTMLInputElement>("editorSnappingEnabled");
const editorSymmetryEnabledInput = element<HTMLInputElement>("editorSymmetryEnabled");
const editorSymmetryOptionsButton = element<HTMLButtonElement>("editorSymmetryOptionsButton");
const editorSymmetryOptionsPanel = element<HTMLElement>("editorSymmetryOptions");
const editorSymmetryPresetButtons = Array.from(
  editorSymmetryOptionsPanel.querySelectorAll<HTMLButtonElement>(
    "[data-editor-symmetry-angle]",
  ),
);
const editorSymmetryAngleInput = element<HTMLInputElement>("editorSymmetryAngle");
const editorSymmetryAngleValueInput = element<HTMLInputElement>("editorSymmetryAngleValue");
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
const spatialBlurOpenButton = element<HTMLButtonElement>("mobileSpatialBlurOpen");
const spatialBlurOverlay = element<HTMLElement>("spatialBlurOverlay");
const spatialBlurPinLayer = element<HTMLElement>("spatialBlurPinLayer");
const spatialBlurTopBar = element<HTMLElement>("spatialBlurTopBar");
const spatialBlurDock = element<HTMLElement>("spatialBlurDock");
const spatialBlurModeButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-spatial-blur-mode]"),
);
const spatialBlurStatus = element<HTMLOutputElement>("spatialBlurStatus");
const spatialBlurCancelButton = element<HTMLButtonElement>("spatialBlurCancel");
const spatialBlurApplyButton = element<HTMLButtonElement>("spatialBlurApply");
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
const mobileGlassOpenButton = element<HTMLButtonElement>("editorGlassFilter");
const mobileGlassSheetElement = element<HTMLElement>("mobileGlassSheet");
const mobileGlassSheetHandle = element<HTMLButtonElement>("mobileGlassHandle");
const mobileGlassSheetHeader = element<HTMLElement>("mobileGlassHeader");
const mobileGlassControlsRegion = element<HTMLElement>("mobileGlassControlsRegion");
const mobileGlassDistortionInput = element<HTMLInputElement>("mobileGlassDistortion");
const mobileGlassDistortionOutput = element<HTMLOutputElement>("mobileGlassDistortionOut");
const mobileGlassSmoothnessInput = element<HTMLInputElement>("mobileGlassSmoothness");
const mobileGlassSmoothnessOutput = element<HTMLOutputElement>("mobileGlassSmoothnessOut");
const mobileGlassScaleInput = element<HTMLInputElement>("mobileGlassScale");
const mobileGlassScaleOutput = element<HTMLOutputElement>("mobileGlassScaleOut");
const mobileGlassInvertInput = element<HTMLInputElement>("mobileGlassInvert");
const mobileGlassReseedButton = element<HTMLButtonElement>("mobileGlassReseed");
const mobileGlassStatus = element<HTMLParagraphElement>("mobileGlassStatus");
const mobileGlassCancelButton = element<HTMLButtonElement>("mobileGlassCancel");
const mobileGlassApplyButton = element<HTMLButtonElement>("mobileGlassApply");
const mobileCurvesOpenButton = element<HTMLButtonElement>("editorCurvesFilter");
const mobileCurvesSheetElement = element<HTMLElement>("mobileCurvesSheet");
const mobileCurvesSheetHandle = element<HTMLButtonElement>("mobileCurvesHandle");
const mobileCurvesSheetHeader = element<HTMLElement>("mobileCurvesHeader");
const mobileCurvesControlsRegion = element<HTMLElement>("mobileCurvesControlsRegion");
const mobileCurvesGraph = element<HTMLCanvasElement>("mobileCurvesGraph");
const mobileCurvesChannelSelect = element<HTMLSelectElement>("mobileCurvesChannel");
const mobileCurvesInputValue = element<HTMLInputElement>("mobileCurvesInputValue");
const mobileCurvesOutputValue = element<HTMLInputElement>("mobileCurvesOutputValue");
const mobileCurvesAutoButton = element<HTMLButtonElement>("mobileCurvesAuto");
const mobileCurvesResetButton = element<HTMLButtonElement>("mobileCurvesReset");
const mobileCurvesDeletePointButton = element<HTMLButtonElement>("mobileCurvesDeletePoint");
const mobileCurvesStatus = element<HTMLParagraphElement>("mobileCurvesStatus");
const mobileCurvesCancelButton = element<HTMLButtonElement>("mobileCurvesCancel");
const mobileCurvesApplyButton = element<HTMLButtonElement>("mobileCurvesApply");
const colorAdjustOpenButton = element<HTMLButtonElement>("editorColorAdjustFilter");
const colorAdjustSurface = element<HTMLElement>("colorAdjustSurface");
const colorAdjustHueInput = element<HTMLInputElement>("colorAdjustHue");
const colorAdjustHueOutput = element<HTMLOutputElement>("colorAdjustHueOut");
const colorAdjustSaturationInput = element<HTMLInputElement>("colorAdjustSaturation");
const colorAdjustSaturationOutput = element<HTMLOutputElement>("colorAdjustSaturationOut");
const colorAdjustBrightnessInput = element<HTMLInputElement>("colorAdjustBrightness");
const colorAdjustBrightnessOutput = element<HTMLOutputElement>("colorAdjustBrightnessOut");
const colorAdjustStatus = element<HTMLParagraphElement>("colorAdjustStatus");
const colorAdjustMenu = element<HTMLElement>("colorAdjustMenu");
const colorAdjustResetButton = element<HTMLButtonElement>("colorAdjustReset");
const colorAdjustCancelButton = element<HTMLButtonElement>("colorAdjustCancel");
const colorBalanceOpenButton = element<HTMLButtonElement>("editorColorBalanceFilter");
const colorBalanceSurface = element<HTMLElement>("colorBalanceSurface");
const colorBalanceCyanRedInput = element<HTMLInputElement>("colorBalanceCyanRed");
const colorBalanceCyanRedOutput = element<HTMLOutputElement>("colorBalanceCyanRedOut");
const colorBalanceMagentaGreenInput = element<HTMLInputElement>("colorBalanceMagentaGreen");
const colorBalanceMagentaGreenOutput = element<HTMLOutputElement>("colorBalanceMagentaGreenOut");
const colorBalanceYellowBlueInput = element<HTMLInputElement>("colorBalanceYellowBlue");
const colorBalanceYellowBlueOutput = element<HTMLOutputElement>("colorBalanceYellowBlueOut");
const colorBalanceToneButton = element<HTMLButtonElement>("colorBalanceToneButton");
const colorBalanceToneButtonLabel = element<HTMLElement>("colorBalanceToneButtonLabel");
const colorBalanceSettingsMenu = element<HTMLElement>("colorBalanceSettingsMenu");
const colorBalanceToneButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-color-balance-tone]"),
);
const colorBalancePreserveLuminosityButton = element<HTMLButtonElement>(
  "colorBalancePreserveLuminosity",
);
const colorBalanceStatus = element<HTMLParagraphElement>("colorBalanceStatus");
const colorBalanceActionMenu = element<HTMLElement>("colorBalanceActionMenu");
const colorBalanceResetButton = element<HTMLButtonElement>("colorBalanceReset");
const colorBalanceCancelButton = element<HTMLButtonElement>("colorBalanceCancel");
const gradientMapOpenButton = element<HTMLButtonElement>("editorGradientMapFilter");
const gradientMapSurface = element<HTMLElement>("gradientMapSurface");
const gradientMapChooser = element<HTMLElement>("gradientMapChooser");
const gradientMapPresetButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-gradient-map-preset-id]"),
);
const gradientMapChooserCancelButton = element<HTMLButtonElement>(
  "gradientMapChooserCancel",
);
const gradientMapEditor = element<HTMLElement>("gradientMapEditor");
const gradientMapPresetsButton = element<HTMLButtonElement>("gradientMapPresets");
const gradientMapTrack = element<HTMLElement>("gradientMapTrack");
const gradientMapPreview = element<HTMLElement>("gradientMapPreview");
const gradientMapStopLayer = element<HTMLElement>("gradientMapStopLayer");
const gradientMapColorInput = element<HTMLInputElement>("gradientMapColor");
const gradientMapSettingsButton = element<HTMLButtonElement>("gradientMapSettingsButton");
const gradientMapSettingsMenu = element<HTMLElement>("gradientMapSettingsMenu");
const gradientMapReverseButton = element<HTMLButtonElement>("gradientMapReverse");
const gradientMapDitherButton = element<HTMLButtonElement>("gradientMapDither");
const gradientMapInterpolationButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-gradient-map-interpolation]"),
);
const gradientMapActionMenu = element<HTMLElement>("gradientMapActionMenu");
const gradientMapResetButton = element<HTMLButtonElement>("gradientMapReset");
const gradientMapCancelButton = element<HTMLButtonElement>("gradientMapCancel");
const gradientMapStatus = element<HTMLParagraphElement>("gradientMapStatus");
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

let projectEditorBootstrap: ProjectEditorBootstrap | undefined =
  window.__projectEditorBootstrap;
const pageSearchParams = new URLSearchParams(window.location.search);
const vectorStressTestEnabled = pageSearchParams.get("vectorStressTest") === "1";
const touchPaintIntentHoldEnabled = pageSearchParams.get("touchPaintIntentHold") !== "0";
// Local A/B probe. Production keeps the established completion presentation
// unless a measured rollout deliberately promotes the shorter policy.
const layerLoadingImmediateCompletionEnabled = import.meta.env.DEV
  && pageSearchParams.get("layerLoadingFinish") === "immediate";

const bevelBoundingFieldEnabled = pageSearchParams.get("bevelField") === "bbox";
// Same-build A/B escape hatch: ROI is production-default, `vectorTextRoi=0`
// restores the previous full-viewport run textures for local measurements.
const vectorTextRoiCacheEnabled = pageSearchParams.get("vectorTextRoi") !== "0";
// Same-build A/B escape hatch: immutable geometry sharing is production-default;
// `vectorGpuResourceSharing=0` restores the legacy per-node GPU resources.
const vectorGpuResourceSharingEnabled =
  pageSearchParams.get("vectorGpuResourceSharing") !== "0";
const layerColdCompressionMode = pageSearchParams.get("layerCompressionRuntime");
// Compression trades interaction latency for a smaller inactive working set.
// Keep the speed-first path as the default and expose compression for explicit
// memory-constrained sessions only.
const layerColdCompressionRequested = layerColdCompressionMode === "1";
const layerColdDirectHotHydrationEnabled =
  pageSearchParams.get("layerDirectHotHydration") !== "0";
const layerColdTileCompositeEnabled =
  pageSearchParams.get("layerColdTileComposite") !== "0";
const layerColdAdjacentPrefetchMode =
  pageSearchParams.get("layerAdjacentPrefetch");
const layerColdAdjacentPrefetchEnabled = layerColdAdjacentPrefetchMode === "1";
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
let cloneToolController: CloneToolController | null = null;
let shapeToolController: ShapeToolController | null = null;
let cloneSourcePreparationToken = 0;
let mixedSceneInitializationPromise: Promise<MixedSceneController> | null = null;
let layerMultiTransformSelectionRevision = 0;
let layerMultiSelectionFinishPromise: Promise<boolean> | null = null;
let editorToolsController: EditorToolsController;
let editorFiltersController: EditorFiltersController | null = null;
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
const editorExtensionEngineOptions = editorExtensionBootstrap?.engineOptions ?? {};
let editorExtension: EditorExtension | null = null;
let projectSessionController: ProjectSessionController | null = null;
let documentSwitchInProgress = false;
let documentSwitchSourcesInvalidated = false;
let documentSwitchStartedAt = 0;
let documentSwitchGeneration = 0;
let toolSettingsOpenRequestSequence = 0;

const DOCUMENT_SWITCH_STAGE_LABELS: Readonly<Record<ProjectSessionSwitchStage, string>> = {
  availability: "Checking the current editor session",
  "preload-target": "Loading the selected project",
  start: "Preparing the document switch",
  "settle-source": "Finishing edits in the current project",
  "save-source": "Saving the current project",
  "verify-source": "Verifying the saved project",
  "preflight-engine": "Preparing reusable GPU resources",
  "reset-engine": "Resetting document resources",
  "restore-target": "Restoring the selected project",
  "commit-target": "Connecting project controls",
  "first-frame": "Waiting for the first project frame",
  "save-target": "Saving the new project",
  "publish-target": "Opening the project",
};

function reportQueuedSceneImportFailure(kind: "SVG" | "image", error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  statusElement.textContent = `${kind} import failed: ${message}`;
  statusElement.className = "status app-status error";
  appDiagnosticsController?.recordOperation(
    "queued-scene-import",
    kind.toLocaleLowerCase("en-US"),
    error,
  );
}

const sceneImportBridge = new SceneImportBridge({
  svgInput: vectorSvgFileInput,
  imageInput: rasterImageFileInput,
  currentController: () => mixedSceneController,
  ensureController: (kind) => initializeMixedSceneController(
    kind === "image" ? "raster-import" : "vector-shape",
  ),
  prewarmImageImport: () => engine.prewarmRasterImageImportResources(),
  beforeAccept: async () => {
    if (rasterAdjustmentsController?.needsAdjustmentSettlementForToolChange(historyState) !== true) {
      return true;
    }
    return rasterAdjustmentsController.commitActiveAdjustmentForToolChange();
  },
  onQueued: (kind, file) => {
    const label = kind === "svg" ? "SVG" : "image";
    statusElement.textContent = `Preparing ${label} import for ${file.name}…`;
    statusElement.className = "status app-status";
  },
  onImporting: (kind, file) => {
    const label = kind === "svg" ? "SVG" : "image";
    statusElement.textContent = `Importing ${label} ${file.name}…`;
    statusElement.className = "status app-status";
  },
  onComplete: (kind, file) => {
    const label = kind === "svg" ? "SVG" : "Image";
    statusElement.textContent = `${label} ${file.name} imported.`;
    statusElement.className = "status app-status ok";
  },
  onFailure: (kind, error) => {
    reportQueuedSceneImportFailure(kind === "svg" ? "SVG" : "image", error);
  },
  runWithLoading: (label, operation) =>
    canvasStartupOverlay.runRuntimeOperation(label, operation),
});

function selectCanvasToolWithMixedScene(tool: CanvasInputTool): boolean {
  const selected = canvasToolController?.select(tool) ?? false;
  if (
    selected
    && engineInitialized
    && engine.mixedSceneEnabled
    && (
      tool === "shapes"
      || tool === "transform"
      || tool === "warp"
      || tool === "perspective"
    )
  ) {
    const initializationScope = tool === "shapes"
      ? "shape-preview"
      : "raster-transform";
    const label = tool === "shapes"
      ? "Preparing Shapes"
      : tool === "warp"
        ? "Preparing Warp"
        : tool === "perspective"
          ? "Preparing Perspective"
          : "Preparing Transform";
    void canvasStartupOverlay.runRuntimeOperation(
      label,
      async () => {
        const preparations: Promise<unknown>[] = [];
        if (initializationScope === "raster-transform") {
          const mode = tool === "warp"
            ? "warp"
            : tool === "perspective"
              ? "perspective"
              : "affine";
          preparations.push(engine.prewarmRasterTransformPrograms(mode).catch((error) => {
            appDiagnosticsController?.recordOperation("prewarm-raster-transform", tool, error);
            console.warn(`Could not prewarm the ${tool} GPU programs.`, error);
            throw error;
          }));
        }
        preparations.push(initializeMixedSceneController(initializationScope).catch((error) => {
          appDiagnosticsController?.recordOperation("initialize-transform-editor", tool, error);
          console.error(`Could not initialize the ${tool} editor.`, error);
          throw error;
        }));
        await Promise.all(preparations);
      },
    ).catch(() => undefined);
  }
  return selected;
}

const inactiveTransformAction = (): VectorTransformActionSnapshot => ({
  toolActive: false,
  active: false,
  preparing: false,
  sessionKind: null,
  selectionKeys: [],
  canApply: false,
  canCancel: false,
});

function transformActionSnapshot(): VectorTransformActionSnapshot {
  return mixedSceneController?.getTransformActionSnapshot() ?? inactiveTransformAction();
}

function layerMultiSelectionSnapshot(): LayerPanelMultiSelectionSnapshot {
  return layerPanelController?.getMultiSelectionSnapshot() ?? {
    enabled: false,
    orderedKeys: [],
  };
}

function sameOrderedKeys(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length
    && left.every((key, index) => key === right[index]);
}

function transformActionBelongsToLayerMultiSelection(
  action: Readonly<VectorTransformActionSnapshot>,
  selection = layerMultiSelectionSnapshot(),
): boolean {
  if (!selection.enabled || selection.orderedKeys.length < 2) return false;
  if (sameOrderedKeys(action.selectionKeys, selection.orderedKeys)) return true;
  // Recovery for older split state: a multiple selection could accidentally
  // open a single-item Transform transaction. It is safe to cancel, never
  // apply, that transaction while the selection-owned tool is still active.
  return canvasToolController?.activeTool === "transform"
    && (action.active || action.preparing);
}

function exactGroupTransformRequested(
  action: Readonly<VectorTransformActionSnapshot>,
  selection = layerMultiSelectionSnapshot(),
): boolean {
  return selection.enabled
    && selection.orderedKeys.length >= 2
    && sameOrderedKeys(action.selectionKeys, selection.orderedKeys);
}

function canSettleLayerMultiSelectionTransform(requireApply: boolean): boolean {
  const selection = layerMultiSelectionSnapshot();
  if (!selection.enabled) return true;
  const action = transformActionSnapshot();
  if (!action.active && !action.preparing) return !interactionLocked();
  if (!transformActionBelongsToLayerMultiSelection(action, selection)) return false;
  if (action.preparing) return true;
  const exactGroup = exactGroupTransformRequested(action, selection)
    && action.sessionKind === "group";
  if (exactGroup) {
    return requireApply ? action.canApply : action.canApply || action.canCancel;
  }
  return action.canCancel;
}

async function settleLayerMultiSelectionTransform(): Promise<boolean> {
  const selection = layerMultiSelectionSnapshot();
  if (!selection.enabled) return true;
  const controller = mixedSceneController;
  if (!controller) return !interactionLocked();
  const action = controller.getTransformActionSnapshot();
  if (!action.active && !action.preparing) return !interactionLocked();
  if (!transformActionBelongsToLayerMultiSelection(action, selection)) return false;

  const exactGroup = exactGroupTransformRequested(action, selection);
  if (exactGroup && (action.preparing || action.sessionKind === "group")) {
    if (!await controller.applyTransform()) {
      const recovery = controller.getTransformActionSnapshot();
      if (!recovery.active || !recovery.canCancel || !await controller.cancelTransform()) {
        return false;
      }
    }
  } else if (!await controller.cancelTransform()) {
    // Never commit a single-item fallback or a stale group on behalf of a
    // different layer selection.
    return false;
  }

  const settled = controller.getTransformActionSnapshot();
  return !settled.active && !settled.preparing;
}

function leaveLayerMultiSelectionTransformTool(): boolean {
  const controller = mixedSceneController;
  controller?.setTransformSelection([]);
  if (canvasToolController?.activeTool === "transform") {
    // This is called only after the owned transaction is verified as settled,
    // so it intentionally bypasses the one-tick-late generic history lock.
    canvasToolController.configure("pan", true);
  } else if (controller?.getTransformActionSnapshot().toolActive) {
    controller.setTransformToolActive(false);
  }
  const action = controller?.getTransformActionSnapshot();
  return canvasToolController?.activeTool !== "transform"
    && action?.toolActive !== true
    && action?.active !== true
    && action?.preparing !== true;
}

function canFinishLayerMultiSelection(): boolean {
  if (layerPanelController?.isMultiSelect !== true) return true;
  return canSettleLayerMultiSelectionTransform(false);
}

async function runLayerMultiSelectionFinish(): Promise<boolean> {
  const panel = layerPanelController;
  if (!panel?.isMultiSelect) return true;
  if (!await settleLayerMultiSelectionTransform()) return false;
  if (!leaveLayerMultiSelectionTransformTool()) return false;
  panel.finishMultiSelection();
  return !panel.isMultiSelect;
}

function canMergeLayerMultiSelection(): boolean {
  if (layerPanelController?.isMultiSelect !== true) return false;
  return canSettleLayerMultiSelectionTransform(true);
}

async function prepareLayerMultiSelectionMerge(): Promise<boolean> {
  return settleLayerMultiSelectionTransform();
}

function finishLayerMultiSelectionForToolChange(): Promise<boolean> {
  if (layerMultiSelectionFinishPromise) return layerMultiSelectionFinishPromise;
  const pending = runLayerMultiSelectionFinish();
  layerMultiSelectionFinishPromise = pending;
  void pending.finally(() => {
    if (layerMultiSelectionFinishPromise === pending) {
      layerMultiSelectionFinishPromise = null;
    }
  });
  return pending;
}
const canvasStartupOverlay = getCanvasStartupOverlayController();
const canvasStartupProgressObserved =
  canvasStartupOverlay.isVisible() || editorExtensionBootstrap?.startupProgressEnabled === true;
const engine = new BrushEngine(canvas, {
  onStatus(message, kind) {
    statusElement.textContent = message;
    statusElement.className = `status app-status ${kind === "working" ? "" : kind}`;
    if (kind === "error") {
      appDiagnosticsController?.recordStatusError(message);
    }
    rasterAdjustmentsController?.handleEngineStatus(message, kind);
  },
  onStartupProgress: canvasStartupProgressObserved
    ? (progress) => {
      canvasStartupOverlay.report(progress);
      if (progress.state === "failed") {
        const detailMessage = progress.detail?.message;
        const message = typeof detailMessage === "string" && detailMessage.length > 0
          ? detailMessage
          : `${progress.label} failed.`;
        statusElement.textContent = message;
        statusElement.className = "status app-status error";
        appDiagnosticsController?.recordStatusError(message);
      }
      if (editorExtensionBootstrap?.startupProgressEnabled) {
        editorExtension?.handleEngineStartupProgress?.(progress);
      }
    }
    : undefined,
  onStats(stats) {
    runtimeStatsController?.update(stats);
    brushQuickControlsController?.notifyEngineUpdate();
    mobileBrushStudio?.notifyEngineUpdate();
    brushOutlineController?.notifyEngineUpdate();
    cloneToolController?.notifyBrushChange();
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
    if (
      cloneToolController?.isActive
      && !state.busy
      && state.openEdit === null
      && !state.inconsistent
      && canvasInputController?.isPointerActive !== true
    ) {
      prepareActiveCloneSource(cloneToolController.snapshot().sampleMode);
    }
  },
  onViewChange(_state, documentViewChanged) {
    mixedSceneController?.scheduleViewSync();
    canvasGuidesController?.scheduleRender();
    if (documentViewChanged) projectSessionController?.markDirty("view state");
    brushOutlineController?.notifyEngineUpdate();
    cloneToolController?.notifyViewChange();
    shapeToolController?.notifyViewChange();
    rasterAdjustmentsController?.handleViewChange();
  },
  onPixelSelectionChange() {
    mobileToolSettingsSheet?.syncOpenState();
    syncMobileToolsMenuState();
  },
  onMixedSceneRuntimeChange(snapshot) {
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
    const mixedSnapshot = engine.getMixedSceneRuntimeSnapshot();
    if (mixedSnapshot) {
      mixedSceneController?.syncScene(mixedSnapshot);
    }
    layerSwitchResult.textContent =
      `Undo/Redo selected layer ${activeIndex + 1}.`;
    projectSessionController?.markDirty("active layer");
    if (cloneToolController?.isActive && canvasInputController?.isPointerActive !== true) {
      prepareActiveCloneSource(cloneToolController.snapshot().sampleMode);
    }
  },
}, tipPreviewCanvas, {
  prewarmedGpuSession: projectEditorBootstrap?.prewarmedGpuSession,
  bevelBoundingFieldEnabled:
    editorExtensionEngineOptions.bevelBoundingFieldEnabled ?? bevelBoundingFieldEnabled,
  startupProgressPresentationYieldEnabled: canvasStartupProgressObserved,
  documentPipelineCompilationConcurrency:
    editorExtensionEngineOptions.documentPipelineCompilationConcurrency,
  documentPipelineCompilationScope:
    editorExtensionEngineOptions.documentPipelineCompilationScope,
  deferSelectedBrushPreparation: true,
  layerMemoryStressTestEnabled:
    editorExtensionEngineOptions.layerMemoryStressTestEnabled ?? vectorStressTestEnabled,
  layerCompressionTestEnabled:
    editorExtensionEngineOptions.layerCompressionTestEnabled ?? false,
  mixedSceneEnabled: resolveMixedSceneEnabled(editorExtensionEngineOptions, true),
  vectorTextRoiCacheEnabled:
    editorExtensionEngineOptions.vectorTextRoiCacheEnabled ?? vectorTextRoiCacheEnabled,
  vectorGpuResourceSharingEnabled:
    editorExtensionEngineOptions.vectorGpuResourceSharingEnabled
    ?? vectorGpuResourceSharingEnabled,
  layerColdCompressionEnabled: layerColdCompressionRequested,
  // Le notifiche restano su richiesta esplicita: ora che la compressione gira
  // sempre, annunciare ogni livello compresso sarebbe rumore, non informazione.
  // Il pannello memoria mostra comunque lo stato di ogni livello in tempo reale.
  layerColdCompressionStatusEnabled: layerColdCompressionMode === "1",
  layerColdDirectHotHydrationEnabled,
  layerColdTileCompositeEnabled,
  layerColdAdjacentPrefetchEnabled,
}, rasterSelectionOverlayCanvas);
let selectedBrushColdStartLoadingPromise: Promise<void> | null = null;
let selectedBrushPreparationRequestSuppressed = false;
const brushSettingsController = new BrushSettingsController({
  getSettings: () => engine.getSettings(),
  setBrushSettings: (next) => {
    engine.setBrushSettings(next);
    if (!selectedBrushPreparationRequestSuppressed) {
      requestSelectedBrushColdStartLoading();
    }
  },
});
const canvasToolSettingsController = new CanvasToolSettingsController();
projectSessionController = new ProjectSessionController({
  engine: {
    captureDocument: () => engine.captureProjectDocument(),
    captureThumbnailPixels: () => engine.captureProjectThumbnailPixels(),
    restoreDocument: (project) => engine.restoreProjectDocument(project),
    historyState: () => engine.getHistoryState(),
    sceneSnapshot: () => engine.getMixedSceneRuntimeSnapshot(),
    setInitialLayerName: (name) => {
      engine.layerStack.active.name = name;
    },
    preflightDocumentSwitch: async (target) => {
      const maximumTextureEdge = Number(engine.device.limits.maxTextureDimension2D);
      if (
        target.documentWidth > maximumTextureEdge
        || target.documentHeight > maximumTextureEdge
      ) {
        throw new Error("The selected canvas exceeds this GPU device's texture limit.");
      }
      await engine.waitForIdle();
    },
    resetDocumentForSwitch: async (target) => {
      await engine.resetForDocumentSwitch(target.documentWidth, target.documentHeight);
    },
    waitForDocumentFirstFrame: async () => {
      await prepareCurrentProjectPresentation();
    },
  },
  storage: projectEditorBootstrap?.storage ?? createProjectStorage(),
  storageReady: projectEditorBootstrap?.storageReady,
  preloadedProjectId: projectEditorBootstrap?.preloadedProjectId,
  preloadedProject: projectEditorBootstrap?.preloadedProject,
  prepareProjectPresentation: async (project) => {
    if (!project.manifest.snapshot.mixedScene.items.some((item) => item.kind !== "raster")) {
      return;
    }
    await initializeMixedSceneController("semantic-scene");
  },
  settleTransientEdits: settleTransientProjectEdits,
  runWithLoading: (label, operation) =>
    canvasStartupOverlay.runRuntimeOperation(label, operation),
  onReturnHome: projectEditorBootstrap?.returnHome,
  onDocumentSwitchStart: async () => {
    if (!canvasStartupOverlay.isVisible()) canvasStartupOverlay.reset();
    documentSwitchGeneration += 1;
    documentSwitchInProgress = true;
    documentSwitchSourcesInvalidated = false;
  },
  onDocumentSwitchStage: (stage) => {
    reportDocumentSwitchStage(stage);
  },
  onDocumentSwitchPreReset: async () => {
    await prepareEditorForDocumentReset();
  },
  onDocumentSwitchCommit: async () => {
    rebaseEditorAfterDocumentSwitch();
  },
  onDocumentSwitchFinish: async (result) => {
    await finishEditorDocumentSwitch(result);
  },
  browser: window,
  document,
  searchParams: pageSearchParams,
  documentWidth: DOCUMENT_WIDTH,
  documentHeight: DOCUMENT_HEIGHT,
  saveButton: saveProjectButton,
  homeButton: projectHomeButton,
  status: statusElement,
  persistenceMode: vectorStressTestEnabled ? "ephemeral" : "durable",
});
// The session controller consumed every bootstrap dependency. Releasing this
// handoff prevents its resolved preload from retaining a second full project.
projectEditorBootstrap = undefined;
window.__projectEditorBootstrap = undefined;
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
      rasterSpatialBlurUiBusy: false,
      rasterMotionBlurUiBusy: false,
      rasterNoiseUiBusy: false,
      rasterGlassUiBusy: false,
      rasterCurvesUiBusy: false,
      rasterColorAdjustUiBusy: false,
      rasterColorBalanceUiBusy: false,
      rasterGradientMapUiBusy: false,
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
  prepareOperation: async () => {
    if (layerPanelController?.isMultiSelect !== true) return true;
    return finishLayerMultiSelectionForToolChange();
  },
  onStateChange: (state) => {
    historyState = state;
    mobileBrushStudio?.retryPendingAssetRelease();
  },
  onControlsLockChange: (locked) => {
    brushQuickControlsController?.setLocked(locked);
    cloneToolController?.notifyInteractionState();
    const toolSelectionLocked = canvasToolSelectionLocked();
    for (const button of [
      mobilePaintButton,
      mobileEraserButton,
      mobileBlendButton,
      mobilePanButton,
    ]) {
      button.disabled = toolSelectionLocked;
      button.classList.toggle("is-transiently-locked", toolSelectionLocked);
    }
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
    statusElement.className = `status app-status ${kind === "working" ? "" : kind}`;
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
  getActiveCanvasTool: () => canvasToolController?.activeTool ?? "pan",
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
      statusElement.className = `status app-status ${kind === "working" ? "" : kind}`;
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
  runWithLoading: (label, operation) =>
    canvasStartupOverlay.runRuntimeOperation(label, operation),
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
let sceneEditorLoadingOperation: CanvasRuntimeLoadingOperation | null = null;
sceneEditorController = new SceneEditorController({
  engine,
  browser: window,
  elements: {
    app: appElement,
    result: layerSwitchResult,
  },
  getVectorController: () => mixedSceneController,
  isInteractionLocked: interactionLocked,
  isAdjustmentRasterizationLocked: adjustmentRasterizationLocked,
  layerCreationLoadingOptions: layerLoadingImmediateCompletionEnabled
    ? { completionPresentation: "immediate" }
    : undefined,
  onBusyChange: () => {
    updateHistoryControls();
    layerPanelController?.syncInteractionState();
  },
  onLoadingChange: (loading, message, options) => {
    if (loading) {
      sceneEditorLoadingOperation?.complete();
      sceneEditorLoadingOperation = options
        ? canvasStartupOverlay.beginRuntimeOperation(message, options)
        : canvasStartupOverlay.beginRuntimeOperation(message);
      return;
    }
    sceneEditorLoadingOperation?.complete();
    sceneEditorLoadingOperation = null;
  },
  onHistoryState: (state) => {
    historyState = state;
  },
  requestLayersRefresh: requestMobileLayersRefresh,
  renderLayers: renderMobileLayerList,
  syncActiveRasterControls: syncActiveLayerControls,
  syncToolSettings: () => mobileToolSettingsSheet?.syncOpenState(),
  onLayerOptionsUpdateError: () => {
    mobileToolSettingsSheet?.discardLayerOptionsDraft();
  },
  onStats: (stats) => runtimeStatsController?.update(stats),
  recordDiagnostic: (name, detail, error) => {
    appDiagnosticsController?.recordOperation(name, detail, error);
  },
});
brushLibraryController = new BrushLibraryController({
  engine: {
    getSettings: () => engine.getSettings(),
    ensureCurrentBrushResources: () => ensureSelectedBrushColdStartWithLoading(),
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
  canOpen: () => (canvasToolController?.activeTool ?? "pan") === "paint"
    && rasterAdjustmentsController?.isAnySurfaceOpen !== true,
  beforeOpen: () => {
    if (mobileStrokeSheet?.isOpen) mobileStrokeSheet.close(false);
    if (mobileRasterEffectsSheet?.isOpen) mobileRasterEffectsSheet.close(false);
    if (mobileToolSettingsSheet?.isOpen) mobileToolSettingsSheet.close(false);
    if (editorFiltersController?.isOpen) editorFiltersController.setOpen(false);
    if (editorSettingsController?.isOpen) editorSettingsController.setOpen(false);
    if (editorToolsController?.isOpen) editorToolsController.setOpen(false);
    if (layerPanelController?.isOpen) layerPanelController.setOpen(false);
  },
  beforeStudioOpen: () => {
    if (mobileStrokeSheet?.isOpen) mobileStrokeSheet.close(false);
    if (mobileRasterEffectsSheet?.isOpen) mobileRasterEffectsSheet.close(false);
    if (mobileToolSettingsSheet?.isOpen) mobileToolSettingsSheet.close(false);
    if (editorFiltersController?.isOpen) editorFiltersController.setOpen(false);
    if (editorSettingsController?.isOpen) editorSettingsController.setOpen(false);
  },
  isPaintSelected: () => (canvasToolController?.activeTool ?? "pan") === "paint",
  runWithLoading: (label, operation) =>
    canvasStartupOverlay.runRuntimeOperation(label, operation),
  onVisibilityChange: () => {
    brushQuickControlsController?.syncVisibility();
    syncMobileToolsMenuState();
    updateHistoryControls();
  },
  onStatus: (message, kind) => {
    statusElement.textContent = message;
    statusElement.className = `status app-status ${kind === "working" ? "" : kind}`;
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
    brushPrecisionButtons: editorBrushPrecisionButtons,
    rulersInput: editorRulersEnabledInput,
    gridInput: editorGridEnabledInput,
    pixelGridInput: editorPixelGridEnabledInput,
    snappingInput: editorSnappingEnabledInput,
    symmetryEnabledInput: editorSymmetryEnabledInput,
    symmetryOptionsButton: editorSymmetryOptionsButton,
    symmetryOptionsPanel: editorSymmetryOptionsPanel,
    symmetryPresetButtons: editorSymmetryPresetButtons,
    symmetryAngleInput: editorSymmetryAngleInput,
    symmetryAngleValueInput: editorSymmetryAngleValueInput,
  },
  canOpen: () => !interactionLocked()
    && mobileBrushStudio?.isBusy !== true
    && rasterAdjustmentsController?.isAnySurfaceOpen !== true,
  beforeOpen: () => {
    if (mobileBrushStudio?.isOpen) mobileBrushStudio.cancel(false);
    if (mobileStrokeSheet?.isOpen) mobileStrokeSheet.close(false);
    if (mobileRasterEffectsSheet?.isOpen) mobileRasterEffectsSheet.close(false);
    if (mobileToolSettingsSheet?.isOpen) mobileToolSettingsSheet.close(false);
    if (editorFiltersController?.isOpen) editorFiltersController.setOpen(false);
    if (editorToolsController?.isOpen) editorToolsController.setOpen(false);
    if (layerPanelController?.isOpen) layerPanelController.setOpen(false);
    if (brushLibraryController.isOpen) brushLibraryController.setOpen(false);
  },
  onOpenChange: () => brushQuickControlsController?.syncVisibility(),
  onPreferencesChange: (preferences) => {
    engine.setStrokeSymmetry(
      preferences.symmetryEnabled,
      preferences.symmetryAngleDegrees,
    );
    applyGlobalBrushPrecision(preferences.brushPrecision);
    canvasGuidesController?.preferencesChanged();
  },
});
engine.setStrokeSymmetry(
  editorSettingsController.preferences.symmetryEnabled,
  editorSettingsController.preferences.symmetryAngleDegrees,
);
applyGlobalBrushPrecision(editorSettingsController.preferences.brushPrecision);
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
  getActiveTool: () => canvasToolController?.activeTool ?? "pan",
  isInteractionLocked: interactionLocked,
  isSuppressedBySurface: () =>
    layerPanelController?.isOpen === true
    || editorToolsController?.isOpen === true
    || editorFiltersController?.isOpen === true
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

cloneToolController = new CloneToolController({
  browser: window,
  document,
  elements: {
    canvas,
    overlay: cloneSourceOverlay,
    marker: cloneSourceMarker,
    previewCanvas: cloneSamplePreview,
    dock: cloneToolDock,
    setSourceButton: cloneSetSourceButton,
    sampleModeButtons: cloneSampleModeButtons,
    alignedButton: cloneAlignedButton,
    angleInput: cloneAngleInput,
    angleValue: cloneAngleValue,
    angleResetButton: cloneAngleResetButton,
    status: cloneToolStatus,
  },
  toDocumentPoint: (clientX, clientY) => {
    const point = engine.toLayerPoint({
      clientX,
      clientY,
      pressure: 1,
      timeMs: performance.now(),
    });
    return { x: point.x, y: point.y };
  },
  getView: () => engine.getVectorTextViewState(),
  getBrushDiameterCssPixels: () => engine.getBrushOutlineSnapshot().diameterCssPixels,
  isInteractionLocked: interactionLocked,
  onConfigurationChange: (state, reason) => {
    if (reason !== "angle") updateHistoryControls();
    if (reason === "sample-mode") prepareActiveCloneSource(state.sampleMode);
  },
  onPreviewChange: (request) => {
    if (!request || !engineInitialized) return false;
    return engine.renderCloneToolPreview(cloneSamplePreview, {
      sourceX: request.sourcePoint.x,
      sourceY: request.sourcePoint.y,
      angleDegrees: request.angleDegrees,
      sampleMode: request.sampleMode,
      diameterCssPixels: request.diameterCssPixels,
    });
  },
});

let shapeLoadingOperation: CanvasRuntimeLoadingOperation | null = null;
shapeToolController = new ShapeToolController({
  browser: window,
  engine,
  elements: {
    dock: shapeToolDock,
    kindButtons: shapeKindButtons,
    fillColor: shapeFillColor,
    status: shapeToolStatus,
  },
  initialColor: brushSettingsController.snapshot().color,
  onBusyChange: (busy) => {
    if (busy) {
      shapeLoadingOperation ??= canvasStartupOverlay.beginRuntimeOperation("Creating shape");
    } else {
      shapeLoadingOperation?.complete();
      shapeLoadingOperation = null;
    }
    updateHistoryControls();
    layerPanelController?.syncInteractionState();
  },
  onCreated: () => {
    requestMobileLayersRefresh();
    scheduleMobileLayersRefresh();
    updateHistoryControls();
  },
  onError: (error) => {
    appDiagnosticsController?.recordOperation("shape-create", "vector", error);
  },
});

function prepareActiveCloneSource(sampleMode: CloneSampleMode): void {
  if (!engineInitialized || !cloneToolController?.isActive) return;
  const token = ++cloneSourcePreparationToken;
  cloneToolController.setSourcePreparing(true);
  void canvasStartupOverlay.runRuntimeOperation(
    "Preparing Clone",
    () => engine.prepareCloneTool(sampleMode),
  ).catch((error) => {
    if (token !== cloneSourcePreparationToken) return;
    const message = error instanceof Error ? error.message : String(error);
    statusElement.textContent = `Clone preparation failed: ${message}`;
    statusElement.className = "status app-status error";
  }).finally(() => {
    if (token === cloneSourcePreparationToken) {
      cloneToolController?.setSourcePreparing(false);
    }
  });
}

function selectedBrushLoadingLabel(): string {
  const tool = engine.getSettings().tool;
  return tool === "erase"
    ? "Preparing Eraser"
    : tool === "blend"
      ? "Preparing Blend"
      : "Preparing Brush";
}

function ensureSelectedBrushColdStartWithLoading(): Promise<void> {
  if (!engine.initialized || engine.currentBrushResourcesReady()) {
    return Promise.resolve();
  }
  if (selectedBrushColdStartLoadingPromise) {
    return selectedBrushColdStartLoadingPromise;
  }
  const operation = canvasStartupOverlay.runRuntimeOperation(
    selectedBrushLoadingLabel(),
    async () => {
      await engine.ensureCurrentBrushResources();
      await engine.waitForIdle();
      if (!engine.currentBrushResourcesReady()) {
        throw new Error("The selected brush did not finish its GPU preparation.");
      }
    },
  );
  selectedBrushColdStartLoadingPromise = operation;
  void operation.then(
    () => {
      if (selectedBrushColdStartLoadingPromise === operation) {
        selectedBrushColdStartLoadingPromise = null;
      }
    },
    () => {
      if (selectedBrushColdStartLoadingPromise === operation) {
        selectedBrushColdStartLoadingPromise = null;
      }
    },
  );
  return operation;
}

function requestSelectedBrushColdStartLoading(): void {
  void ensureSelectedBrushColdStartWithLoading().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    appDiagnosticsController?.recordOperation("prepare-selected-brush", "settings", error);
    statusElement.textContent = `Selected brush preparation failed: ${message}`;
    statusElement.className = "status app-status error";
  });
}

canvasToolController = new CanvasToolController({
  engine: {
    get fillToolSelected() {
      return engine.fillToolSelected;
    },
    prepareSelectedBrushForInteraction: async () => {
      try {
        await ensureSelectedBrushColdStartWithLoading();
        return true;
      } catch {
        return false;
      }
    },
    setFillToolSelected: (selected) => canvasStartupOverlay.runRuntimeOperation(
      selected ? "Preparing Fill" : "Finishing Fill",
      () => engine.setFillToolSelected(selected),
    ),
    setSelectionToolSelected: (selected, method) => canvasStartupOverlay.runRuntimeOperation(
      selected ? "Preparing Selection" : "Finishing Selection",
      () => engine.setSelectionToolSelected(selected, method),
    ),
  },
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
  isInteractionLocked: canvasToolSelectionLocked,
  isMultiSelectionActive: () => layerPanelController?.isMultiSelect === true,
  canFinishMultiSelectionForToolChange: canFinishLayerMultiSelection,
  finishMultiSelectionForToolChange: finishLayerMultiSelectionForToolChange,
  shouldPrepareActiveAdjustmentForToolChange: () =>
    rasterAdjustmentsController?.needsAdjustmentSettlementForToolChange(historyState) === true,
  prepareActiveAdjustmentForToolChange: () =>
    rasterAdjustmentsController?.commitActiveAdjustmentForToolChange() ?? Promise.resolve(true),
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
  onToolChange: (tool) => {
    cloneToolController?.setActive(tool === "clone");
    shapeToolController?.setActive(tool === "shapes");
    if (tool === "clone" && engineInitialized) {
      prepareActiveCloneSource(cloneToolController.snapshot().sampleMode);
    } else if (engineInitialized) {
      cloneSourcePreparationToken += 1;
      cloneToolController?.setSourcePreparing(false);
      engine.releaseCloneToolSource();
    }
  },
});

let selectionLoadingOperation: CanvasRuntimeLoadingOperation | null = null;
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
  getActiveTool: () => canvasToolController?.activeTool ?? "pan",
  getSelectionSettings: () => canvasToolSettingsController.selectionSnapshot(),
  onBusyChange: () => {
    if (pixelSelectionController?.isBusy === true) {
      selectionLoadingOperation ??=
        canvasStartupOverlay.beginRuntimeOperation("Updating selection");
    } else {
      selectionLoadingOperation?.complete();
      selectionLoadingOperation = null;
    }
    updateHistoryControls();
  },
  onSettled: () => mobileToolSettingsSheet?.syncOpenState(),
  onError: (error) => console.error("WebGPU pixel selection failed", error),
});

function selectedMobileVectorItem(
  snapshot = engineInitialized ? engine.getMixedSceneRuntimeSnapshot() : null,
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
  const layerOptionsPreview = historyState.openEdit === "layer-options";
  return selectedSceneLayerProperties(
    engine.getStats(),
    interactionLocked() && !layerOptionsPreview
      || sceneEditorController?.isBusy === true,
  );
}

function rasterEffectMenuEnabled(kind: EditorRasterEffectKind): boolean {
  return rasterStyleController.effectEnabled(kind);
}

function toolSettingsRequireMixedScene(kind: EditorToolSettingsKind): boolean {
  return kind === "svg-style" || kind.startsWith("text");
}

function syncMobileToolsMenuState(
  sceneSnapshot = engineInitialized ? engine.getMixedSceneRuntimeSnapshot() : null,
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
    activeCanvasTool: canvasToolController?.activeTool ?? "pan",
    engineReady: engineInitialized,
    interactionLocked: interactionLocked(),
    adjustmentSettlementAvailable:
      rasterAdjustmentsController?.needsAdjustmentSettlementForToolChange(historyState) === true,
    canvasToolSelectionLocked: canvasToolSelectionLocked(),
    toolSettingsSelectionLocked: interactionLocked()
      && rasterAdjustmentsController?.needsAdjustmentSettlementForToolChange(historyState) !== true,
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

function applyBrushSettings(
  settings: Readonly<BrushSettings>,
  options: Readonly<{ preserveCanvasTool?: boolean }> = {},
): void {
  const applied = brushSettingsController.replace({
    ...settings,
    shapeMaskFormat: editorSettingsController?.preferences.brushPrecision
      ?? DEFAULT_EDITOR_GUIDE_PREFERENCES.brushPrecision,
  });
  if (!options.preserveCanvasTool) {
    canvasToolController?.configure(applied.tool, false);
  }
}

function applyGlobalBrushPrecision(
  brushPrecision: BrushSettings["shapeMaskFormat"],
): void {
  if (brushSettingsController.snapshot().shapeMaskFormat === brushPrecision) return;
  brushSettingsController.update({ shapeMaskFormat: brushPrecision });
  brushLibraryController.markPreviewDirty();
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
  getBrushPrecision: () => editorSettingsController?.preferences.brushPrecision
    ?? DEFAULT_EDITOR_GUIDE_PREFERENCES.brushPrecision,
  runWithLoading: (label, operation) =>
    canvasStartupOverlay.runRuntimeOperation(label, operation),
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
    editorFiltersController?.setOpen(false);
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
    editorFiltersController?.setOpen(false);
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

const rasterAdjustmentLoadingLabels = Object.freeze({
  beginRasterGaussianBlur: "Preparing Gaussian Blur",
  beginRasterSpatialBlur: "Preparing Spatial Blur",
  beginRasterLiquify: "Preparing Liquify",
  beginRasterMotionBlur: "Preparing Motion Blur",
  beginRasterNoise: "Preparing Noise",
  beginRasterGlass: "Preparing Glass",
  beginRasterToneCurves: "Preparing Curves",
  beginRasterColorAdjust: "Preparing Color Adjustment",
  beginRasterColorBalance: "Preparing Color Balance",
  beginRasterGradientMap: "Preparing Gradient Map",
  prewarmRasterGradientMapResources: "Preparing Gradient Map",
  cancelRasterGaussianBlur: "Cancelling Gaussian Blur",
  cancelRasterSpatialBlur: "Cancelling Spatial Blur",
  cancelRasterLiquify: "Cancelling Liquify",
  cancelRasterMotionBlur: "Cancelling Motion Blur",
  cancelRasterNoise: "Cancelling Noise",
  cancelRasterGlass: "Cancelling Glass",
  cancelRasterToneCurves: "Cancelling Curves",
  cancelRasterColorAdjust: "Cancelling Color Adjustment",
  cancelRasterColorBalance: "Cancelling Color Balance",
  cancelRasterGradientMap: "Cancelling Gradient Map",
  commitRasterGaussianBlur: "Applying Gaussian Blur",
  commitRasterSpatialBlur: "Applying Spatial Blur",
  commitRasterLiquify: "Applying Liquify",
  commitRasterMotionBlur: "Applying Motion Blur",
  commitRasterNoise: "Applying Noise",
  commitRasterGlass: "Applying Glass",
  commitRasterToneCurves: "Applying Curves",
  commitRasterColorAdjust: "Applying Color Adjustment",
  commitRasterColorBalance: "Applying Color Balance",
  commitRasterGradientMap: "Applying Gradient Map",
} satisfies Partial<Record<keyof RasterAdjustmentsEnginePort, string>>);

function createRasterAdjustmentsLoadingPort(
  source: RasterAdjustmentsEnginePort,
): RasterAdjustmentsEnginePort {
  return new Proxy(source, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown;
      if (typeof value !== "function") return value;
      const label = typeof property === "string"
        ? rasterAdjustmentLoadingLabels[
          property as keyof typeof rasterAdjustmentLoadingLabels
        ]
        : undefined;
      if (!label) return value.bind(target) as unknown;
      return ((...args: unknown[]) => canvasStartupOverlay.runRuntimeOperation(
        label,
        async () => await Reflect.apply(value, target, args) as unknown,
      )) as unknown;
    },
  });
}

rasterAdjustmentsController = new RasterAdjustmentsController({
  engine: createRasterAdjustmentsLoadingPort(engine),
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
    spatialBlur: {
      openButton: spatialBlurOpenButton,
      overlay: spatialBlurOverlay,
      pinLayer: spatialBlurPinLayer,
      topBar: spatialBlurTopBar,
      dock: spatialBlurDock,
      modeButtons: spatialBlurModeButtons,
      status: spatialBlurStatus,
      cancelButton: spatialBlurCancelButton,
      applyButton: spatialBlurApplyButton,
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
    glass: {
      openButton: mobileGlassOpenButton,
      sheet: mobileGlassSheetElement,
      sheetHandle: mobileGlassSheetHandle,
      sheetHeader: mobileGlassSheetHeader,
      controlsRegion: mobileGlassControlsRegion,
      distortionInput: mobileGlassDistortionInput,
      distortionOutput: mobileGlassDistortionOutput,
      smoothnessInput: mobileGlassSmoothnessInput,
      smoothnessOutput: mobileGlassSmoothnessOutput,
      scaleInput: mobileGlassScaleInput,
      scaleOutput: mobileGlassScaleOutput,
      invertInput: mobileGlassInvertInput,
      reseedButton: mobileGlassReseedButton,
      status: mobileGlassStatus,
      cancelButton: mobileGlassCancelButton,
      applyButton: mobileGlassApplyButton,
    },
    curves: {
      openButton: mobileCurvesOpenButton,
      sheet: mobileCurvesSheetElement,
      sheetHandle: mobileCurvesSheetHandle,
      sheetHeader: mobileCurvesSheetHeader,
      controlsRegion: mobileCurvesControlsRegion,
      canvas: mobileCurvesGraph,
      channelSelect: mobileCurvesChannelSelect,
      inputValue: mobileCurvesInputValue,
      outputValue: mobileCurvesOutputValue,
      autoButton: mobileCurvesAutoButton,
      resetButton: mobileCurvesResetButton,
      deleteButton: mobileCurvesDeletePointButton,
      status: mobileCurvesStatus,
      cancelButton: mobileCurvesCancelButton,
      applyButton: mobileCurvesApplyButton,
    },
    colorAdjust: {
      openButton: colorAdjustOpenButton,
      surface: colorAdjustSurface,
      hueInput: colorAdjustHueInput,
      hueOutput: colorAdjustHueOutput,
      saturationInput: colorAdjustSaturationInput,
      saturationOutput: colorAdjustSaturationOutput,
      brightnessInput: colorAdjustBrightnessInput,
      brightnessOutput: colorAdjustBrightnessOutput,
      status: colorAdjustStatus,
      menu: colorAdjustMenu,
      resetButton: colorAdjustResetButton,
      cancelButton: colorAdjustCancelButton,
    },
    colorBalance: {
      openButton: colorBalanceOpenButton,
      surface: colorBalanceSurface,
      cyanRedInput: colorBalanceCyanRedInput,
      cyanRedOutput: colorBalanceCyanRedOutput,
      magentaGreenInput: colorBalanceMagentaGreenInput,
      magentaGreenOutput: colorBalanceMagentaGreenOutput,
      yellowBlueInput: colorBalanceYellowBlueInput,
      yellowBlueOutput: colorBalanceYellowBlueOutput,
      toneButton: colorBalanceToneButton,
      toneButtonLabel: colorBalanceToneButtonLabel,
      settingsMenu: colorBalanceSettingsMenu,
      toneButtons: colorBalanceToneButtons,
      preserveLuminosityButton: colorBalancePreserveLuminosityButton,
      status: colorBalanceStatus,
      actionMenu: colorBalanceActionMenu,
      resetButton: colorBalanceResetButton,
      cancelButton: colorBalanceCancelButton,
    },
    gradientMap: {
      openButton: gradientMapOpenButton,
      surface: gradientMapSurface,
      chooser: gradientMapChooser,
      presetButtons: gradientMapPresetButtons,
      chooserCancelButton: gradientMapChooserCancelButton,
      editor: gradientMapEditor,
      presetsButton: gradientMapPresetsButton,
      gradientTrack: gradientMapTrack,
      gradientPreview: gradientMapPreview,
      stopLayer: gradientMapStopLayer,
      colorInput: gradientMapColorInput,
      settingsButton: gradientMapSettingsButton,
      settingsMenu: gradientMapSettingsMenu,
      reverseButton: gradientMapReverseButton,
      ditherButton: gradientMapDitherButton,
      interpolationButtons: gradientMapInterpolationButtons,
      actionMenu: gradientMapActionMenu,
      resetButton: gradientMapResetButton,
      cancelButton: gradientMapCancelButton,
      status: gradientMapStatus,
    },
  },
  isEngineReady: () => engineInitialized,
  getHistoryState: () => historyState,
  onHistoryState: (state) => {
    historyState = state;
  },
  isInteractionLocked: interactionLocked,
  isSceneBusy: () => sceneEditorController?.isBusy === true,
  isMultiSelectionActive: () => layerPanelController?.isMultiSelect === true,
  getActiveCanvasTool: () => canvasToolController?.activeTool ?? "pan",
  getActiveBrushTool: () => canvasToolController?.activeBrush ?? "paint",
  configureCanvasTool: (tool, restoreSnapshot) => {
    canvasToolController?.configure(tool, restoreSnapshot);
  },
  confirmCurvesVectorRasterization: (message) => window.confirm(message),
  rasterizeVectorLayersForCurves: async () => {
    await initializeMixedSceneController();
    const result = await sceneEditorController!.rasterizeVectorLayersForCurves();
    return result.rasterizedCount;
  },
  confirmGradientMapVectorRasterization: (message) => window.confirm(message),
  rasterizeSelectedVectorLayerForGradientMap: async () => {
    await initializeMixedSceneController();
    return sceneEditorController!.rasterizeSelectedVectorLayer();
  },
  beforeSheetOpen: () => {
    editorToolsController?.setOpen(false);
    editorFiltersController?.setOpen(false);
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

editorFiltersController = new EditorFiltersController({
  browser: window,
  document,
  elements: {
    trigger: editorFiltersMenuButton,
    panel: editorFiltersPanel,
    closeButton: editorFiltersCloseButton,
    filterButtons: editorFilterButtons,
  },
  canOpen: () => mobileBrushStudio?.isBusy !== true
    && rasterAdjustmentsController?.isAnySurfaceOpen !== true,
  beforeOpen: () => {
    if (mobileBrushStudio?.isOpen) mobileBrushStudio.cancel(false);
    if (mobileStrokeSheet?.isOpen) mobileStrokeSheet.close(false);
    if (mobileRasterEffectsSheet?.isOpen) mobileRasterEffectsSheet.close(false);
    if (mobileToolSettingsSheet?.isOpen) mobileToolSettingsSheet.close(false);
    if (editorToolsController?.isOpen) editorToolsController.setOpen(false);
    if (editorSettingsController?.isOpen) editorSettingsController.setOpen(false);
    if (layerPanelController?.isOpen) layerPanelController.setOpen(false);
    if (brushLibraryController.isOpen) brushLibraryController.setOpen(false);
    rasterAdjustmentsController?.syncUi();
  },
  onOpenChange: () => brushQuickControlsController?.syncVisibility(),
  openFilter: (kind, trigger, returnFocus) => {
    if (kind === "glass") {
      rasterAdjustmentsController?.openGlass(trigger, returnFocus);
    } else if (kind === "curves") {
      rasterAdjustmentsController?.openCurves(trigger, returnFocus);
    } else if (kind === "color-adjust") {
      rasterAdjustmentsController?.openColorAdjust(trigger, returnFocus);
    } else if (kind === "color-balance") {
      rasterAdjustmentsController?.openColorBalance(trigger, returnFocus);
    } else if (kind === "gradient-map") {
      rasterAdjustmentsController?.openGradientMap(trigger, returnFocus);
    }
  },
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
    const current = brushSettingsController.snapshot();
    const settings = brushSettingsController.update({
      color: canonicalBrushColorForFormat(color, current.shapeMaskFormat),
    });
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
      contentOpacity: properties.contentOpacity,
      cutoutMode: properties.cutoutMode,
      tonalBlend: properties.tonalBlend,
      locked: properties.locked,
    };
  },
  beginSelectedLayerOptionsEdit: () => {
    const properties = selectedMobileLayerProperties();
    return properties !== null
      && !properties.locked
      && sceneEditorController?.beginLayerOptionsEdit(properties.key) === true;
  },
  finishSelectedLayerOptionsEdit: () => canvasStartupOverlay.runRuntimeOperation(
    "Finishing Layer Options",
    async () => {
      const committed = await (sceneEditorController?.finishLayerOptionsEdit() ?? false);
      await engine.waitForIdle();
      return committed;
    },
  ),
  setSelectedLayerOpacity: (key, opacity) => {
    return sceneEditorController?.setLayerOpacity(key, opacity);
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
    return canvasStartupOverlay.runRuntimeOperation(
      "Applying layer blend mode",
      async () => {
        await sceneEditorController?.setRasterBlendMode(properties.key, blendMode);
        await engine.waitForIdle();
      },
    );
  },
  setSelectedLayerContentOpacity: (key, contentOpacity) => {
    return sceneEditorController?.setRasterContentOpacity(key, contentOpacity);
  },
  setSelectedLayerCutoutMode: (cutoutMode) => {
    const properties = selectedMobileLayerProperties();
    if (
      !properties
      || properties.locked
      || properties.kind !== "raster"
    ) {
      return;
    }
    return canvasStartupOverlay.runRuntimeOperation(
      "Applying layer knockout",
      async () => {
        await sceneEditorController?.setRasterCutoutMode(properties.key, cutoutMode);
        await engine.waitForIdle();
      },
    );
  },
  setSelectedLayerTonalBlend: (tonalBlend) => {
    const properties = selectedMobileLayerProperties();
    if (
      !properties
      || properties.locked
      || properties.kind !== "raster"
    ) {
      return;
    }
    return canvasStartupOverlay.runRuntimeOperation(
      "Applying tonal blend",
      async () => {
        await sceneEditorController?.setRasterTonalBlend(properties.key, tonalBlend);
        await engine.waitForIdle();
      },
    );
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
    toolActive: false,
    active: false,
    preparing: false,
    sessionKind: null,
    selectionKeys: [],
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
    editorFiltersController?.setOpen(false);
    editorSettingsController?.setOpen(false);
    setMobileLayersPanelOpen(false);
    brushLibraryController.setOpen(false);
    mobileBrushStudio?.cancel(false);
    mobileStrokeSheet?.close(false);
    mobileRasterEffectsSheet?.close(false);
  },
  onOpenChange: (open) => {
    canvas.classList.toggle(
      "layer-options-active",
      open && mobileToolSettingsSheet?.toolKind === "layer-options",
    );
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
    && (
      rasterAdjustmentsController?.isAnySurfaceOpen !== true
      || rasterAdjustmentsController?.needsAdjustmentSettlementForToolChange(historyState) === true
    ),
  beforeOpen: () => {
    if (mobileBrushStudio?.isOpen) mobileBrushStudio.cancel(false);
    if (mobileStrokeSheet?.isOpen) mobileStrokeSheet.close(false);
    if (mobileRasterEffectsSheet?.isOpen) mobileRasterEffectsSheet.close(false);
    if (mobileToolSettingsSheet?.isOpen) mobileToolSettingsSheet.close(false);
    if (editorFiltersController?.isOpen) editorFiltersController.setOpen(false);
    if (editorSettingsController?.isOpen) editorSettingsController.setOpen(false);
    if (layerPanelController?.isOpen) layerPanelController.setOpen(false);
    if (brushLibraryController.isOpen) brushLibraryController.setOpen(false);
  },
  onOpenChange: () => brushQuickControlsController?.syncVisibility(),
  syncMenuState: syncMobileToolsMenuState,
  selectCanvasTool: selectCanvasToolWithMixedScene,
  openToolSettings: (kind, trigger) => {
    const requestSequence = ++toolSettingsOpenRequestSequence;
    const requestedDocumentSwitchGeneration = documentSwitchGeneration;
    const requestIsCurrent = (): boolean => (
      !documentSwitchInProgress
      && requestSequence === toolSettingsOpenRequestSequence
      && requestedDocumentSwitchGeneration === documentSwitchGeneration
    );
    const openRequestedSettings = (requestedKind: EditorToolSettingsKind): void => {
      void (async () => {
        if (!requestIsCurrent()) return;
        let requestedController: MixedSceneController | null = null;
        if (toolSettingsRequireMixedScene(requestedKind)) {
          const scope: MixedSceneInitializationScope = requestedKind === "text"
            ? "controller-only"
            : "semantic-scene";
          const initialize = () => initializeMixedSceneController(scope);
          if (requestedKind === "text" && mixedSceneController === null) {
            requestedController = await canvasStartupOverlay.runRuntimeOperation(
              "Preparing Text",
              initialize,
              { revealImmediately: true, waitForPaint: true },
            );
          } else {
            requestedController = await initialize();
          }
        }
        if (!requestIsCurrent()) return;
        mobileToolSettingsSheet?.open(requestedKind, trigger);
        if (requestedKind === "text" && requestedController) {
          scheduleTextCreationWarmupAfterPanelPaint(requestedController, requestIsCurrent);
        }
      })().catch((error) => {
        appDiagnosticsController?.recordOperation(
          "initialize-tool-settings",
          requestedKind,
          error,
        );
        const message = error instanceof Error ? error.message : String(error);
        statusElement.textContent = requestedKind === "text"
          ? `Could not open Text: ${message}`
          : `Could not open ${requestedKind}: ${message}`;
        statusElement.className = "status app-status error";
        console.error(`Could not initialize the ${requestedKind} settings.`, error);
      });
    };
    if (rasterAdjustmentsController?.needsAdjustmentSettlementForToolChange(historyState) !== true) {
      openRequestedSettings(kind);
      return;
    }
    const requestedKind = kind;
    void rasterAdjustmentsController.commitActiveAdjustmentForToolChange().then((committed) => {
      if (committed && requestIsCurrent()) openRequestedSettings(requestedKind);
    });
  },
  runVectorCommand: (command) => {
    const canSettleAdjustment =
      rasterAdjustmentsController?.needsAdjustmentSettlementForToolChange(historyState) === true;
    if (interactionLocked() && !canSettleAdjustment) return;
    // Preserve transient user activation: opening the native picker after
    // awaiting the optional GPU warm-up would be rejected by browsers.
    sceneImportBridge.request(command);
  },
  openRasterEffect: (kind, trigger) => {
    const openEffect = (): void => {
      if (!engineInitialized || interactionLocked()) return;
      if (kind === "stroke") mobileStrokeSheet?.open(trigger);
      else mobileRasterEffectsSheet?.open(kind, trigger);
    };
    if (rasterAdjustmentsController?.needsAdjustmentSettlementForToolChange(historyState) !== true) {
      openEffect();
      return;
    }
    void rasterAdjustmentsController.commitActiveAdjustmentForToolChange().then((committed) => {
      if (committed) openEffect();
    });
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
  getInteractionLockMessage: () => layerPanelInteractionLockMessage(),
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
    if (editorFiltersController?.isOpen) editorFiltersController.setOpen(false);
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
  onMultiSelectionChange: ({ enabled, orderedKeys }) => {
    rasterAdjustmentsController?.syncUi();
    const revision = ++layerMultiTransformSelectionRevision;
    const transformKeys = enabled && orderedKeys.length >= 2 ? orderedKeys : [];
    if (transformKeys.length === 0) {
      const wasLayerGroupTool = transformActionSnapshot().selectionKeys.length >= 2
        || (
          layerPanelController?.isMultiSelect !== true
          && canvasToolController?.activeTool === "transform"
        );
      mixedSceneController?.setTransformSelection([]);
      if (wasLayerGroupTool) leaveLayerMultiSelectionTransformTool();
      return;
    }
    void canvasStartupOverlay.runRuntimeOperation(
      "Preparing layer selection",
      () => initializeMixedSceneController(),
    ).then((controller) => {
      if (revision !== layerMultiTransformSelectionRevision) return;
      controller.setTransformSelection(transformKeys);
      if (!selectCanvasToolWithMixedScene("transform")) {
        controller.setTransformSelection([]);
      }
    }).catch((error) => {
      appDiagnosticsController?.recordOperation(
        "initialize-group-transform",
        transformKeys.join(","),
        error,
      );
    });
  },
  canChangeMultiSelection: () => canSettleLayerMultiSelectionTransform(false),
  prepareMultiSelectionChange: settleLayerMultiSelectionTransform,
  canMergeMultiSelection: canMergeLayerMultiSelection,
  prepareMultiSelectionMerge: prepareLayerMultiSelectionMerge,
  onMultiSelectionMergeStart: async () => leaveLayerMultiSelectionTransformTool(),
  canFinishMultiSelection: canFinishLayerMultiSelection,
  requestFinishMultiSelection: finishLayerMultiSelectionForToolChange,
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
      projectSessionController?.markDirty("document background visibility");
      scheduleMobileLayersRefresh();
    }
    return changed;
  },
  setDocumentBackgroundColor: (color) => {
    const changed = engine.setDocumentBackgroundColor(color);
    if (changed) {
      projectSessionController?.markDirty("document background color");
      scheduleMobileLayersRefresh();
    }
    return changed;
  },
  setLayerClipping: (key, enabled) =>
    sceneEditorController?.setLayerClipping(key, enabled),
  deleteLayer: (key) => sceneEditorController!.deleteLayer(key),
  openLayerOptions: (trigger) => {
    void canvasStartupOverlay.runRuntimeOperation(
      "Preparing Layer Options",
      async () => {
        await engine.ensureLayerBlendEditorResources();
        await engine.waitForIdle();
      },
    ).then(
      () => mobileToolSettingsSheet?.open("layer-options", trigger),
      (error) => {
        appDiagnosticsController?.recordOperation("prepare-layer-options", null, error);
        console.error("Layer Options preparation failed.", error);
      },
    );
  },
  onLayerResult: (message) => {
    layerSwitchResult.textContent = message;
  },
  onStatus: (message, failed) => {
    if (failed) return;
    statusElement.textContent = message;
    statusElement.className = "status app-status";
  },
  recordDiagnostic: (name, detail, error) => {
    appDiagnosticsController?.recordOperation(name, detail, error);
    console.error(`Layer operation failed (${name}).`, { detail, error });
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
  getActiveTool: () => canvasToolController?.activeTool ?? "pan",
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
  prepareCloneSource: (sampleMode) => prepareActiveCloneSource(sampleMode),
  isLiquifyEditActive: () =>
    rasterAdjustmentsController?.isLiquifyEditActive(historyState) === true,
  isDestructivePreviewNavigationActive: () =>
    rasterAdjustmentsController?.isDestructivePreviewNavigationActive(historyState) === true
    || fillPreviewAllowsCanvasNavigation(),
  getSpatialBlurController: () => rasterAdjustmentsController,
  getCloneController: () => cloneToolController,
  getShapeController: () => shapeToolController,
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
  getActiveTool: () => canvasToolController?.activeTool ?? "pan",
});

documentInteractionController = new DocumentInteractionController({
  browser: window,
  document,
  engine,
  cancelTransientInteraction: () => layerPanelController?.cancelActiveGesture(),
});

function reportDocumentSwitchStage(stage: ProjectSessionSwitchStage): void {
  const now = performance.now();
  if (stage === "availability" || documentSwitchStartedAt <= 0) {
    documentSwitchStartedAt = now;
  }
  canvasStartupOverlay.report({
    phase: `document-switch-${stage}`,
    label: DOCUMENT_SWITCH_STAGE_LABELS[stage],
    state: "completed",
    totalElapsedMs: Math.max(0, now - documentSwitchStartedAt),
    phaseElapsedMs: 0,
    detail: null,
  });
}

async function waitForOutgoingHistoryControls(): Promise<void> {
  historyControlsController.discardPendingOperations();
  const startedAt = performance.now();
  while (
    historyControlsController.uiBusy
    || historyControlsController.isQueueDraining
    || historyControlsController.queuedOperationCount > 0
    || historyState.busy
  ) {
    if (performance.now() - startedAt > 65_000) {
      throw new Error("History did not finish before the project switch.");
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }
}

async function settleDocumentSwitchSources(): Promise<void> {
  if (!documentSwitchInProgress || documentSwitchSourcesInvalidated) return;
  if (canvasInputController?.isPointerActive === true) {
    throw new Error("Finish the active pointer gesture before opening another project.");
  }

  await waitForOutgoingHistoryControls();
  await sceneImportBridge.resetForDocument();
  await mobileStrokeSheet?.settleDocumentEdits();
  await mobileRasterEffectsSheet?.settleDocumentEdits();
  await mobileToolSettingsSheet?.settleDocumentEdits();
  await pixelSelectionController?.finishColorRangePreview();
  documentSwitchSourcesInvalidated = true;
}

async function waitForDocumentSwitchControllersIdle(): Promise<void> {
  const startedAt = performance.now();
  for (;;) {
    if (canvasInputController?.isPointerActive === true) {
      throw new Error("A pointer gesture is still active.");
    }
    const busy = historyControlsController.uiBusy
      || historyControlsController.isQueueDraining
      || historyControlsController.queuedOperationCount > 0
      || historyState.busy
      || sceneEditorController?.isBusy === true
      || mixedSceneController?.isBusy === true
      || shapeToolController?.isBusy === true
      || pixelSelectionController?.isBusy === true
      || rasterStyleController.isBusy
      || layerThumbnailController.isCaptureInFlight
      || brushQuickControlsController?.isDragging === true
      || editorExtension?.isBusy() === true;
    if (!busy) return;
    if (performance.now() - startedAt > 65_000) {
      throw new Error("The current project did not become idle in time.");
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }
}

async function prepareEditorForDocumentReset(): Promise<void> {
  if (!documentSwitchInProgress) {
    throw new Error("The document-switch boundary is not active.");
  }
  await waitForDocumentSwitchControllersIdle();
  if (historyState.openEdit !== null) {
    throw new Error("The current project still has an open edit.");
  }

  layerPanelController?.cancelTransientInteractions();
  layerPanelController?.finishMultiSelection(false);
  layerPanelController?.setOpen(false);
  await canvasToolController?.resetForDocument();
  await shapeToolController?.setActive(false);
  cloneSourcePreparationToken += 1;
  cloneToolController?.setSourcePreparing(false);
  cloneToolController?.setActive(false);
  cloneToolController?.setSourcePoint(null);
  engine.releaseCloneToolSource();
  canvasInputController?.cancelKeyboardSelectionGesture(true);

  editorToolsController.setOpen(false);
  editorFiltersController?.setOpen(false);
  editorSettingsController?.setOpen(false);
  brushLibraryController.setOpen(false);
  mobileBrushStudio?.cancel(false);
  mobileStrokeSheet?.close(false);
  mobileRasterEffectsSheet?.close(false);
  mobileToolSettingsSheet?.close(false);
  layerThumbnailController.resetForDocument();
  await mixedSceneController?.resetForDocument();
  canvasGuidesController?.setSmartGuides([]);

  await engine.waitForIdle();
  await waitForDocumentSwitchControllersIdle();
}

function rebaseEditorAfterDocumentSwitch(): void {
  appDiagnosticsController?.setDocumentDimensions(
    engine.documentWidth,
    engine.documentHeight,
  );
  gpuMemoryPanelController?.setDocumentDimensions(
    engine.documentWidth,
    engine.documentHeight,
  );
  rasterAdjustmentsController?.reconfigureDocument(
    engine.documentWidth,
    engine.documentHeight,
  );
  document.title = `M1M4.COM — ${engine.documentWidth}×${engine.documentHeight}`;
  historyState = engine.getHistoryState();
  historyControlsController.resetForDocument(historyState);
  const snapshot = engine.getMixedSceneRuntimeSnapshot();
  if (snapshot) mixedSceneController?.syncScene(snapshot);
  layerPanelController?.cancelTransientInteractions();
  requestMobileLayersRefresh();
  layerPanelController?.ensureActiveThumbnail(0);
  syncActiveLayerControls();
  rasterAdjustmentsController?.syncUi();
  syncMobileToolsMenuState(snapshot);
  mobileToolSettingsSheet?.syncOpenState();
  canvasGuidesController?.setSmartGuides([]);
  canvasGuidesController?.scheduleRender();
  brushOutlineController?.notifyEngineUpdate();
  cloneToolController?.notifyViewChange();
  runtimeStatsController?.update(engine.getStats());
  updateHistoryControls();
}

async function finishEditorDocumentSwitch(
  result: ProjectSessionSwitchResult,
): Promise<void> {
  try {
    if (result.status === "committed") {
      const elapsed = Math.max(0, performance.now() - documentSwitchStartedAt);
      canvasStartupOverlay.report({
        phase: "first-frame-gpu",
        label: "Waiting for the first project frame",
        state: "completed",
        totalElapsedMs: elapsed,
        phaseElapsedMs: 0,
        detail: null,
      });
      canvasStartupOverlay.report({
        phase: "editor-ready",
        label: "Project ready",
        state: "completed",
        totalElapsedMs: elapsed,
        phaseElapsedMs: 0,
        detail: null,
      });
      return;
    }
    if (result.status === "failed" && !result.destructive) {
      rebaseEditorAfterDocumentSwitch();
    }
    canvasStartupOverlay.fail();
  } finally {
    documentSwitchInProgress = false;
    documentSwitchSourcesInvalidated = false;
    documentSwitchStartedAt = 0;
    if (
      result.status === "committed"
      || (result.status === "failed" && !result.destructive)
    ) {
      updateHistoryControls();
    }
  }
}

async function settleTransientProjectEdits(): Promise<void> {
  if (!engineInitialized) return;
  await settleDocumentSwitchSources();
  if (rasterAdjustmentsController?.needsAdjustmentSettlementForToolChange(historyState) === true) {
    if (!await rasterAdjustmentsController.commitActiveAdjustmentForToolChange()) {
      throw new Error("The active raster adjustment could not finish safely.");
    }
    if (rasterAdjustmentsController.needsAdjustmentSettlementForToolChange(historyState)) {
      throw new Error("The active raster adjustment is still open.");
    }
  }
  if (
    layerPanelController?.isMultiSelect === true
    && !await finishLayerMultiSelectionForToolChange()
  ) {
    throw new Error("The multiple-layer edit could not finish safely.");
  }
  const transformAction = mixedSceneController?.getTransformActionSnapshot();
  if (transformAction?.active || transformAction?.preparing) {
    if (!await mixedSceneController!.applyTransform()) {
      throw new Error("Transform could not finish safely.");
    }
    const settledTransform = mixedSceneController!.getTransformActionSnapshot();
    if (settledTransform.active || settledTransform.preparing) {
      throw new Error("Transform is still active.");
    }
  }
  if (
    mobileToolSettingsSheet?.isOpen === true
    && mobileToolSettingsSheet.toolKind === "layer-options"
  ) {
    mobileToolSettingsSheet.close(false);
  }
  await sceneEditorController?.finishLayerOptionsEdit();
  const fillPreviewActive = engine.getFillPreviewState().active;
  const fillToolActive = engine.fillToolSelected
    || canvasToolController?.activeTool === "fill";
  if (fillPreviewActive || fillToolActive) {
    if (canvasToolController) {
      canvasToolController.finishFillToolOnSheetClose("fill");
    }
    await engine.setFillToolSelected(false);
    if (engine.getFillPreviewState().active) {
      throw new Error("Fill could not finish safely.");
    }
  }

  if (documentSwitchInProgress) {
    if (
      rasterAdjustmentsController?.isAnySurfaceOpen === true
      || rasterAdjustmentsController?.hasActiveHistoryEdit(historyState) === true
    ) {
      throw new Error("Apply or cancel the open raster adjustment before switching projects.");
    }
    await waitForDocumentSwitchControllersIdle();
    if (historyState.openEdit !== null) {
      throw new Error("Finish the open document edit before switching projects.");
    }
  }
}

window.addEventListener("pagehide", () => {
  // Last-resort only. Home and Save await this same gate before navigating or
  // capturing; pagehide covers browser-level departures where waiting is not
  // available.
  void settleTransientProjectEdits().catch((error) => {
    console.error("Could not finish the active edit during page hide.", error);
  });
  appDiagnosticsController?.dispose();
  gpuMemoryPanelController?.dispose();
  canvasGuidesController?.dispose();
  editorFiltersController?.dispose();
  editorSettingsController?.dispose();
  layerPanelController?.dispose();
  canvasInputController?.dispose();
  cloneToolController?.dispose();
  shapeToolController?.dispose();
  brushOutlineController?.dispose();
  documentInteractionController?.dispose();
  rasterAdjustmentsController?.dispose();
  canvasToolController?.dispose();
  brushQuickControlsController?.dispose();
  sceneEditorController?.dispose();
  sceneImportBridge.dispose();
  editorToolsController.dispose();
  layerThumbnailController.dispose();
  void mobileBrushStudio?.dispose();
  brushLibraryController.dispose();
  historyControlsController.dispose();
  projectSessionController?.dispose();
  runtimeStatsController?.dispose();
  pixelSelectionController?.dispose();
}, { once: true });

function fillPreviewAllowsCanvasNavigation(): boolean {
  if (!engineInitialized || historyState.openEdit !== "fill") return false;
  const previewState = engine.getFillPreviewState();
  return previewState.active && !previewState.terminal;
}

function layerPanelInteractionLockMessage(): string | null {
  switch (historyState.openEdit) {
    case "fill":
      return "Apply or cancel Fill before moving layers.";
    case "transform":
      return "Apply or cancel Transform before moving layers.";
    case "property":
      return "Finish the current vector edit before moving layers.";
    case "raster-property":
      return "Finish the current layer edit before moving layers.";
    case "layer-options":
      return "Close Layer Options before moving layers.";
    case "gaussian-blur":
    case "spatial-blur":
    case "motion-blur":
    case "noise":
    case "glass":
    case "curves":
    case "color-adjust":
    case "color-balance":
    case "gradient-map":
    case "liquify":
      return "Apply or cancel the open effect before moving layers.";
    case null:
      return interactionLocked() || sceneEditorController?.isBusy === true
        ? "Finish the current operation before moving layers."
        : null;
  }
}

function nonHistoryOperationLocked(
  allowDestructivePreviewEdit = false,
  allowShapePresentationPreparation = false,
  allowLayerMultiTransformEdit = false,
  allowRasterAdjustmentSurface = false,
): boolean {
  return documentSwitchInProgress
    || !engineInitialized
    || sceneEditorController?.isBusy === true
    || mixedSceneController?.isBusy === true
    || (
      shapeToolController?.isBusy === true
      && !(
        allowShapePresentationPreparation
        && shapeToolController.isPresentationPreparing
      )
    )
    || brushQuickControlsController?.isDragging === true
    || mobileBrushStudio?.isOpen === true
    || (historyState.openEdit === "transform" && !allowLayerMultiTransformEdit)
    || (
      !allowDestructivePreviewEdit
      && (
        rasterAdjustmentsController?.hasActiveHistoryEdit(historyState) === true
        || historyState.openEdit === "fill"
      )
    )
    || historyState.openEdit === "raster-property"
    || (
      !allowDestructivePreviewEdit
      && !allowRasterAdjustmentSurface
      && rasterAdjustmentsController?.isAnySurfaceOpen === true
    )
    || historyState.openEdit === "layer-options"
    || rasterStyleController.isBusy
    || pixelSelectionController?.isBusy === true
    || editorExtension?.isBusy() === true;
}

function adjustmentRasterizationLocked(): boolean {
  return nonHistoryOperationLocked(false, false, false, true)
    || historyControlsController.uiBusy
    || historyState.busy
    || canvasInputController?.isPointerActive === true;
}

function operationLocked(
  allowDestructivePreviewEdit = false,
  allowShapePresentationPreparation = false,
): boolean {
  return nonHistoryOperationLocked(
    allowDestructivePreviewEdit,
    allowShapePresentationPreparation,
  )
    || historyControlsController.uiBusy
    || historyState.busy;
}

function interactionLocked(): boolean {
  return operationLocked() || canvasInputController?.isPointerActive === true;
}

function canvasToolSelectionLocked(): boolean {
  if (!interactionLocked()) return false;
  if (rasterAdjustmentsController?.needsAdjustmentSettlementForToolChange(historyState) === true) {
    return false;
  }
  const action = mixedSceneController?.getTransformActionSnapshot();
  return !(
    layerPanelController?.isMultiSelect === true
    && canvasToolController?.activeTool === "transform"
    && (action?.active === true || action?.preparing === true)
  );
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
  const selection = layerMultiSelectionSnapshot();
  const action = transformActionSnapshot();
  const canPrepareLayerMultiTransform = transformActionBelongsToLayerMultiSelection(
    action,
    selection,
  ) && canSettleLayerMultiSelectionTransform(false);
  return nonHistoryOperationLocked(false, false, canPrepareLayerMultiTransform)
    || canvasInputController?.isPointerActive === true;
}

function updateHistoryControls(): void {
  historyControlsController.acceptState(historyState);
  if (editorToolsController?.isOpen) syncMobileToolsMenuState();
  else rasterAdjustmentsController?.syncUi();
  brushOutlineController?.notifyEngineUpdate();
  cloneToolController?.notifyInteractionState();
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
editorFiltersController?.setOpen(false);
brushLibraryController.setOpen(false);
mobileStrokeSheet?.close(false);
mobileRasterEffectsSheet?.close(false);
mobileToolSettingsSheet?.close(false);
canvasToolController?.setSelectionCombineMode("replace");
canvasToolController?.configure("pan", false);
updateHistoryControls();

type MixedSceneInitializationScope =
  | "controller-only"
  | "semantic-scene"
  | "shape-preview"
  | "vector-shape"
  | "raster-import"
  | "raster-transform";

function scheduleTextCreationWarmupAfterPanelPaint(
  controller: MixedSceneController,
  requestIsCurrent: () => boolean,
): void {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      if (
        !requestIsCurrent()
        || mobileToolSettingsSheet?.isOpen !== true
        || mobileToolSettingsSheet.toolKind !== "text"
      ) return;
      void controller.prepareTextCreationResources().catch((error) => {
        appDiagnosticsController?.recordOperation(
          "prepare-text-creation",
          "background-warmup",
          error,
        );
        const message = error instanceof Error ? error.message : String(error);
        statusElement.textContent = `Could not prepare Text: ${message}`;
        statusElement.className = "status app-status error";
        console.error("Could not prepare Text creation resources.", error);
      });
    });
  });
}

async function initializeMixedSceneController(
  scope: MixedSceneInitializationScope = "semantic-scene",
): Promise<MixedSceneController> {
  // Start code loading beside the capability-specific GPU gate. This keeps the
  // controller chunk out of the critical path without resolving the caller
  // before the requested resources are ready.
  if (!mixedSceneController && !mixedSceneInitializationPromise) {
    const initialization = (async (): Promise<MixedSceneController> => {
      const { MixedSceneController } = await import("./mixed-scene-controller");
      const controller = new MixedSceneController(engine, {
        root: appElement,
        browser: window,
        clippedRefreshPolicy:
          editorExtensionBootstrap?.vectorTextClippedRefreshPolicy ?? "during-gesture",
        onEditorStateChange: () => {
          mobileToolSettingsSheet?.syncOpenState();
          updateHistoryControls();
        },
        runWithLoading: (label, operation, options) =>
          canvasStartupOverlay.runRuntimeOperation(label, operation, options),
        canvasGuides: {
          getPreferences: () => editorSettingsController?.preferences
            ?? DEFAULT_EDITOR_GUIDE_PREFERENCES,
          setSmartGuides: (guides) => canvasGuidesController?.setSmartGuides(guides),
        },
      });
      await controller.initialize();
      mixedSceneController = controller;
      canvasToolController?.syncVectorControllerState();
      const snapshot = engine.getMixedSceneRuntimeSnapshot();
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
    void initialization.catch(() => {
      if (!mixedSceneController && mixedSceneInitializationPromise === initialization) {
        mixedSceneInitializationPromise = null;
      }
    });
  }

  const resourcePreparation = scope === "controller-only"
    ? Promise.resolve()
    : scope === "semantic-scene"
      ? engine.ensureMixedSceneEditorResources()
      : scope === "shape-preview"
        ? Promise.all([
          engine.ensureShapePreviewEditorResources(),
          engine.ensureVectorShapeEditorResources(),
        ]).then(() => undefined)
        : scope === "vector-shape"
          ? engine.ensureVectorShapeEditorResources()
          : Promise.resolve();
  const initialization = mixedSceneController
    ? Promise.resolve(mixedSceneController)
    : mixedSceneInitializationPromise!;
  const [controller] = await Promise.all([initialization, resourcePreparation]);
  return controller;
}

async function prepareCurrentProjectPresentation(): Promise<void> {
  const snapshot = engine.getMixedSceneRuntimeSnapshot();
  const containsSemanticItems = snapshot?.items.some((item) => item.kind !== "raster") === true;
  if (containsSemanticItems) {
    const controller = await initializeMixedSceneController("semantic-scene");
    const latestSnapshot = engine.getMixedSceneRuntimeSnapshot();
    if (latestSnapshot) controller.syncScene(latestSnapshot);
    await controller.prepareCurrentScenePresentation();
  }
  // The semantic controller submits its textures before this final canvas
  // frame. Raster-only projects take the same authoritative GPU boundary.
  engine.requestRender();
  await engine.waitForIdle();
  if (containsSemanticItems) {
    await engine.waitForVectorTextPresentationCompletion();
  }
}

async function startConfiguredVectorDeviceStressTest(): Promise<void> {
  const controller = await initializeMixedSceneController("semantic-scene");
  const { startVectorDeviceStressTest } = await import(
    "./vector-stress/vector-device-stress-test"
  );
  await startVectorDeviceStressTest({
    engine,
    controller,
    browser: window,
    document,
    canvas,
  });
}

void engine.initialize()
  .then(async () => {
    engineInitialized = true;
    if (!projectSessionController) {
      throw new Error("Project session controller is unavailable.");
    }
    await engine.runStartupPhase("restore-active-brush", "Restoring the saved brush", async () => {
      if (
        mobileBrushStudio
        && (editorExtensionBootstrap?.restorePersistedBrushOnStartup ?? true)
      ) {
        selectedBrushPreparationRequestSuppressed = true;
        try {
          await brushLibraryController.restoreActiveBrush({ prepareResources: false });
        } finally {
          selectedBrushPreparationRequestSuppressed = false;
        }
      }
    });
    await engine.runStartupPhase(
      "project-session",
      "Opening the project session",
      () => projectSessionController.initialize(),
    );
    await engine.runStartupPhase("editor-ready", "Connecting the editor controls", async () => {
      syncMobileToolsMenuState();
      historyState = engine.getHistoryState();
      layerPanelController?.ensureActiveThumbnail(0);
      updateHistoryControls();
      runtimeStatsController?.start();
      await editorExtension?.afterEngineInitialized();
    });
    if (vectorStressTestEnabled) await startConfiguredVectorDeviceStressTest();
  })
  .catch((error) => {
    canvasStartupOverlay.fail();
    editorExtension?.handleEngineInitializationError(error);
    const message = error instanceof Error ? error.message : String(error);
    const secureContextHint = !window.isSecureContext
      ? " WebGPU requires HTTPS or localhost; an HTTP address on your local network is not sufficient."
      : "";
    statusElement.textContent = `${message}${secureContextHint}`;
    statusElement.className = "status app-status error";
    updateHistoryControls();
  });
