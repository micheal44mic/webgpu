import type { BrushEngine } from "./brush-engine";
import type { BrushTool } from "./engine-types";
import type { HistoryState } from "./engine-types";
import {
  DESTRUCTIVE_GAUSSIAN_BLUR_DEFAULT_RADIUS,
  DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS,
  DESTRUCTIVE_GAUSSIAN_BLUR_RADIUS_STEP,
} from "./gaussian-blur-core";
import {
  DEFAULT_LIQUIFY_SETTINGS,
  isLiquifyMode,
  liquifyModeControls,
  normalizeLiquifySettings,
  type LiquifyMode,
  type LiquifySettings,
} from "./liquify-core";
import { MobileGaussianBlurSheetController } from "./mobile-gaussian-blur-sheet";
import { MobileGlassSheetController } from "./mobile-glass-sheet";
import { MobileLiquifySheetController } from "./mobile-liquify-sheet";
import { MobileMotionBlurSheetController } from "./mobile-motion-blur-sheet";
import { MobileNoiseSheetController } from "./mobile-noise-sheet";
import { MobileRasterToneCurvesSheetController } from "./mobile-raster-tone-curves-sheet.ts";
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
  DEFAULT_RASTER_GLASS_SETTINGS,
  normalizeRasterGlassSettings,
  rasterGlassMaxDisplacementPixels,
  rasterGlassScalePixels,
  type RasterGlassSettings,
} from "./glass-core";
import type { CanvasInputTool } from "./canvas-input-controller";
import type { DestructiveRasterAdjustmentKind } from "./raster-effects-contract.ts";
import {
  SpatialBlurController,
  type SpatialBlurPointerInput,
} from "./spatial-blur-controller";
import {
  createInitialSpatialBlurPin,
  type SpatialBlurPin,
} from "./spatial-blur-core";
import {
  DEFAULT_RASTER_TONE_CURVE_SET,
  type RasterToneCurveSet,
} from "./raster-tone-curves-core.ts";
import {
  RasterToneCurvesEditorController,
  type RasterToneCurvesEditorElements,
} from "./raster-tone-curves-editor-controller.ts";
import {
  DEFAULT_RASTER_COLOR_ADJUST_SETTINGS,
  type RasterColorAdjustSettings,
} from "./raster-color-adjust-core.ts";
import {
  RasterColorAdjustSurfaceController,
  type RasterColorAdjustSurfaceElements,
} from "./raster-color-adjust-surface-controller.ts";
import {
  DEFAULT_RASTER_COLOR_BALANCE_SETTINGS,
  type RasterColorBalanceSettings,
} from "./raster-color-balance-core.ts";
import {
  RasterColorBalanceSurfaceController,
  type RasterColorBalanceSurfaceElements,
} from "./raster-color-balance-surface-controller.ts";
import {
  RasterGradientMapSurfaceController,
  type RasterGradientMapPreset,
  type RasterGradientMapSurfaceElements,
} from "./raster-gradient-map-surface-controller.ts";
import {
  normalizeRasterGradientMapSettings,
  type RasterGradientMapSettings,
} from "./raster-gradient-map-core.ts";

export const CURVES_VECTOR_RASTERIZATION_CONFIRMATION =
  "Curves works on raster layers. Rasterize all SVG and text layers before continuing?\n\n"
  + "This converts editable content to pixels. You can undo the rasterization.";

export const GRADIENT_MAP_VECTOR_RASTERIZATION_CONFIRMATION =
  "Gradient Map works on raster layers. Rasterize the selected SVG or text layer before continuing?\n\n"
  + "This converts the selected editable layer to pixels. You can undo the rasterization.";

const RASTER_GRADIENT_MAP_PRESETS: readonly RasterGradientMapPreset[] = Object.freeze([
  {
    id: "monochrome",
    label: "Monochrome",
    settings: normalizeRasterGradientMapSettings({
      stops: [
        { position: 0, color: [0, 0, 0] },
        { position: 1, color: [1, 1, 1] },
      ],
      dither: true,
      interpolation: "perceptual",
    }),
  },
  {
    id: "cool-light",
    label: "Cool Light",
    settings: normalizeRasterGradientMapSettings({
      stops: [
        { position: 0, color: [0.063, 0.09, 0.169] },
        { position: 0.55, color: [0.196, 0.424, 0.62] },
        { position: 1, color: [0.847, 0.984, 1] },
      ],
      dither: true,
      interpolation: "perceptual",
    }),
  },
  {
    id: "warm-light",
    label: "Warm Light",
    settings: normalizeRasterGradientMapSettings({
      stops: [
        { position: 0, color: [0.106, 0.063, 0.149] },
        { position: 0.55, color: [0.78, 0.333, 0.271] },
        { position: 1, color: [1, 0.941, 0.741] },
      ],
      dither: true,
      interpolation: "perceptual",
    }),
  },
  {
    id: "sunset",
    label: "Sunset",
    settings: normalizeRasterGradientMapSettings({
      stops: [
        { position: 0, color: [0.027, 0.078, 0.165] },
        { position: 0.42, color: [0.478, 0.157, 0.435] },
        { position: 0.75, color: [0.953, 0.42, 0.212] },
        { position: 1, color: [1, 0.882, 0.396] },
      ],
      dither: true,
      interpolation: "perceptual",
    }),
  },
  {
    id: "forest",
    label: "Forest",
    settings: normalizeRasterGradientMapSettings({
      stops: [
        { position: 0, color: [0.024, 0.067, 0.059] },
        { position: 0.55, color: [0.106, 0.4, 0.322] },
        { position: 1, color: [0.831, 0.949, 0.812] },
      ],
      dither: true,
      interpolation: "perceptual",
    }),
  },
  {
    id: "ember",
    label: "Ember",
    settings: normalizeRasterGradientMapSettings({
      stops: [
        { position: 0, color: [0.039, 0.02, 0.016] },
        { position: 0.52, color: [0.616, 0.118, 0.102] },
        { position: 1, color: [1, 0.71, 0.184] },
      ],
      dither: true,
      interpolation: "perceptual",
    }),
  },
]);

export type RasterAdjustmentsEnginePort = Pick<
  BrushEngine,
  | "beginRasterGaussianBlur"
  | "beginRasterSpatialBlur"
  | "beginRasterLiquify"
  | "beginRasterMotionBlur"
  | "beginRasterNoise"
  | "beginRasterGlass"
  | "beginRasterToneCurves"
  | "beginRasterColorAdjust"
  | "beginRasterColorBalance"
  | "beginRasterGradientMap"
  | "prewarmRasterGradientMapResources"
  | "cancelRasterGaussianBlur"
  | "cancelRasterSpatialBlur"
  | "cancelRasterLiquify"
  | "cancelRasterMotionBlur"
  | "cancelRasterNoise"
  | "cancelRasterGlass"
  | "cancelRasterToneCurves"
  | "cancelRasterColorAdjust"
  | "cancelRasterColorBalance"
  | "cancelRasterGradientMap"
  | "commitRasterGaussianBlur"
  | "commitRasterSpatialBlur"
  | "commitRasterLiquify"
  | "commitRasterMotionBlur"
  | "commitRasterNoise"
  | "commitRasterGlass"
  | "commitRasterToneCurves"
  | "commitRasterColorAdjust"
  | "commitRasterColorBalance"
  | "commitRasterGradientMap"
  | "endRasterLiquifyStroke"
  | "getHistoryState"
  | "getPixelSelectionState"
  | "getStats"
  | "getVectorTextViewState"
  | "resetRasterLiquify"
  | "setRasterLiquifyAmount"
  | "updateRasterGaussianBlur"
  | "updateRasterSpatialBlur"
  | "updateRasterLiquifySettings"
  | "updateRasterMotionBlur"
  | "updateRasterNoise"
  | "updateRasterGlass"
  | "updateRasterToneCurves"
  | "updateRasterColorAdjust"
  | "updateRasterColorBalance"
  | "updateRasterGradientMap"
  | "reseedRasterGlass"
  | "toLayerPoint"
  | "documentWidth"
  | "documentHeight"
>;

export interface RasterAdjustmentsBrowser extends Window {
  readonly AbortController: typeof AbortController;
}

export interface LiquifyAdjustmentElements {
  readonly openButton: HTMLButtonElement;
  readonly sheet: HTMLElement;
  readonly sheetHandle: HTMLButtonElement;
  readonly sheetHeader: HTMLElement;
  readonly controlsRegion: HTMLElement;
  readonly modeLabel: HTMLOutputElement;
  readonly modeButtons: readonly HTMLButtonElement[];
  readonly sizeInput: HTMLInputElement;
  readonly sizeOutput: HTMLOutputElement;
  readonly pressureInput: HTMLInputElement;
  readonly pressureOutput: HTMLOutputElement;
  readonly distortionInput: HTMLInputElement;
  readonly distortionOutput: HTMLOutputElement;
  readonly momentumInput: HTMLInputElement;
  readonly momentumOutput: HTMLOutputElement;
  readonly amountInput: HTMLInputElement;
  readonly amountOutput: HTMLOutputElement;
  readonly status: HTMLParagraphElement;
  readonly resetButton: HTMLButtonElement;
  readonly cancelButton: HTMLButtonElement;
  readonly applyButton: HTMLButtonElement;
}

export interface GaussianBlurAdjustmentElements {
  readonly openButton: HTMLButtonElement;
  readonly sheet: HTMLElement;
  readonly sheetHandle: HTMLButtonElement;
  readonly sheetHeader: HTMLElement;
  readonly controlsRegion: HTMLElement;
  readonly radiusInput: HTMLInputElement;
  readonly radiusOutput: HTMLOutputElement;
  readonly status: HTMLParagraphElement;
  readonly cancelButton: HTMLButtonElement;
  readonly applyButton: HTMLButtonElement;
}

export interface SpatialBlurAdjustmentElements {
  readonly openButton: HTMLButtonElement;
  readonly overlay: HTMLElement;
  readonly pinLayer: HTMLElement;
  readonly topBar: HTMLElement;
  readonly dock: HTMLElement;
  readonly modeButtons: readonly HTMLButtonElement[];
  readonly status: HTMLOutputElement;
  readonly cancelButton: HTMLButtonElement;
  readonly applyButton: HTMLButtonElement;
}

export interface MotionBlurAdjustmentElements {
  readonly openButton: HTMLButtonElement;
  readonly sheet: HTMLElement;
  readonly sheetHandle: HTMLButtonElement;
  readonly sheetHeader: HTMLElement;
  readonly controlsRegion: HTMLElement;
  readonly distanceInput: HTMLInputElement;
  readonly distanceOutput: HTMLOutputElement;
  readonly angleInput: HTMLInputElement;
  readonly angleOutput: HTMLOutputElement;
  readonly status: HTMLParagraphElement;
  readonly cancelButton: HTMLButtonElement;
  readonly applyButton: HTMLButtonElement;
}

export interface NoiseAdjustmentElements {
  readonly openButton: HTMLButtonElement;
  readonly sheet: HTMLElement;
  readonly sheetHandle: HTMLButtonElement;
  readonly sheetHeader: HTMLElement;
  readonly controlsRegion: HTMLElement;
  readonly amountInput: HTMLInputElement;
  readonly amountOutput: HTMLOutputElement;
  readonly styleSelect: HTMLSelectElement;
  readonly scaleInput: HTMLInputElement;
  readonly scaleOutput: HTMLOutputElement;
  readonly octavesInput: HTMLInputElement;
  readonly octavesOutput: HTMLOutputElement;
  readonly turbulenceInput: HTMLInputElement;
  readonly turbulenceOutput: HTMLOutputElement;
  readonly channelsSelect: HTMLSelectElement;
  readonly additiveInput: HTMLInputElement;
  readonly status: HTMLParagraphElement;
  readonly cancelButton: HTMLButtonElement;
  readonly applyButton: HTMLButtonElement;
}

export interface GlassAdjustmentElements {
  readonly openButton: HTMLButtonElement;
  readonly sheet: HTMLElement;
  readonly sheetHandle: HTMLButtonElement;
  readonly sheetHeader: HTMLElement;
  readonly controlsRegion: HTMLElement;
  readonly distortionInput: HTMLInputElement;
  readonly distortionOutput: HTMLOutputElement;
  readonly smoothnessInput: HTMLInputElement;
  readonly smoothnessOutput: HTMLOutputElement;
  readonly scaleInput: HTMLInputElement;
  readonly scaleOutput: HTMLOutputElement;
  readonly invertInput: HTMLInputElement;
  readonly reseedButton: HTMLButtonElement;
  readonly status: HTMLParagraphElement;
  readonly cancelButton: HTMLButtonElement;
  readonly applyButton: HTMLButtonElement;
}

export interface RasterToneCurvesAdjustmentElements extends RasterToneCurvesEditorElements {
  readonly openButton: HTMLButtonElement;
  readonly sheet: HTMLElement;
  readonly sheetHandle: HTMLButtonElement;
  readonly sheetHeader: HTMLElement;
  readonly controlsRegion: HTMLElement;
  readonly status: HTMLParagraphElement;
  readonly cancelButton: HTMLButtonElement;
  readonly applyButton: HTMLButtonElement;
}

export interface RasterColorAdjustAdjustmentElements extends RasterColorAdjustSurfaceElements {
  readonly openButton: HTMLButtonElement;
  readonly status: HTMLParagraphElement;
}

export interface RasterColorBalanceAdjustmentElements extends RasterColorBalanceSurfaceElements {
  readonly openButton: HTMLButtonElement;
  readonly status: HTMLParagraphElement;
}

export interface RasterGradientMapAdjustmentElements extends RasterGradientMapSurfaceElements {
  readonly openButton: HTMLButtonElement;
  readonly status: HTMLParagraphElement;
}

export interface RasterAdjustmentsElements {
  readonly canvas: HTMLCanvasElement;
  readonly appStatus: HTMLParagraphElement;
  readonly liquify: LiquifyAdjustmentElements;
  readonly gaussianBlur: GaussianBlurAdjustmentElements;
  readonly spatialBlur: SpatialBlurAdjustmentElements;
  readonly motionBlur: MotionBlurAdjustmentElements;
  readonly noise: NoiseAdjustmentElements;
  readonly glass: GlassAdjustmentElements;
  readonly curves: RasterToneCurvesAdjustmentElements;
  readonly colorAdjust: RasterColorAdjustAdjustmentElements;
  readonly colorBalance: RasterColorBalanceAdjustmentElements;
  readonly gradientMap: RasterGradientMapAdjustmentElements;
}

export interface RasterAdjustmentsControllerOptions {
  readonly engine: RasterAdjustmentsEnginePort;
  readonly browser: RasterAdjustmentsBrowser;
  readonly elements: RasterAdjustmentsElements;
  readonly isEngineReady: () => boolean;
  readonly getHistoryState: () => HistoryState;
  readonly onHistoryState: (state: HistoryState) => void;
  readonly isInteractionLocked: () => boolean;
  readonly isSceneBusy: () => boolean;
  readonly isMultiSelectionActive: () => boolean;
  readonly getActiveCanvasTool: () => CanvasInputTool;
  readonly getActiveBrushTool: () => BrushTool;
  readonly configureCanvasTool: (
    tool: CanvasInputTool,
    restoreSnapshot: boolean,
  ) => void;
  readonly confirmCurvesVectorRasterization: (message: string) => boolean;
  readonly rasterizeVectorLayersForCurves: () => Promise<number>;
  readonly confirmGradientMapVectorRasterization: (message: string) => boolean;
  readonly rasterizeSelectedVectorLayerForGradientMap: () => Promise<{
    readonly outputKey: string;
  }>;
  readonly beforeSheetOpen: () => void;
  readonly onSheetOpenChange: (open: boolean) => void;
  readonly updateHistoryControls: () => void;
  readonly requestActiveThumbnail: (delayMs?: number) => void;
}

export interface RasterAdjustmentsDiagnostics {
  readonly rasterGaussianBlurUiBusy: boolean;
  readonly rasterSpatialBlurUiBusy: boolean;
  readonly rasterMotionBlurUiBusy: boolean;
  readonly rasterNoiseUiBusy: boolean;
  readonly rasterGlassUiBusy: boolean;
  readonly rasterCurvesUiBusy: boolean;
  readonly rasterColorAdjustUiBusy: boolean;
  readonly rasterColorBalanceUiBusy: boolean;
  readonly rasterGradientMapUiBusy: boolean;
  readonly rasterLiquifyUiBusy: boolean;
}

type AdjustmentResult = "apply" | "cancel" | "error";

interface AdjustmentTransactionState {
  surfaceOpen: boolean;
  sessionOpen: boolean;
  previewFault: boolean;
  cancelPending: boolean;
  uiBusy: boolean;
  returnFocus: HTMLElement | null;
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

function initialTransactionState(): AdjustmentTransactionState {
  return {
    surfaceOpen: false,
    sessionOpen: false,
    previewFault: false,
    cancelPending: false,
    uiBusy: false,
    returnFocus: null,
  };
}

function formatPixelMeasure(period: number): string {
  if (period >= 100) return period.toFixed(0);
  if (period >= 10) return period.toFixed(1).replace(/\.0$/, "");
  return period.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

/**
 * Owns the destructive raster-adjustment transactions and their sheets.
 * The engine remains authoritative for preview pixels and history; this class
 * owns mutual exclusion, recovery UI, focus restoration and commit/cancel.
 */
export class RasterAdjustmentsController {
  private readonly abortController: AbortController;
  private readonly liquifySheet: MobileLiquifySheetController;
  private readonly gaussianBlurSheet: MobileGaussianBlurSheetController;
  private readonly spatialBlurEditor: SpatialBlurController;
  private readonly motionBlurSheet: MobileMotionBlurSheetController;
  private readonly noiseSheet: MobileNoiseSheetController;
  private readonly glassSheet: MobileGlassSheetController;
  private readonly curvesSheet: MobileRasterToneCurvesSheetController;
  private readonly curvesEditor: RasterToneCurvesEditorController;
  private readonly colorAdjustSurface: RasterColorAdjustSurfaceController;
  private readonly colorBalanceSurface: RasterColorBalanceSurfaceController;
  private readonly gradientMapSurface: RasterGradientMapSurfaceController;
  private readonly liquify = initialTransactionState();
  private readonly gaussianBlur = initialTransactionState();
  private readonly spatialBlur = initialTransactionState();
  private readonly motionBlur = initialTransactionState();
  private readonly noise = initialTransactionState();
  private readonly glass = initialTransactionState();
  private readonly curves = initialTransactionState();
  private readonly colorAdjust = initialTransactionState();
  private readonly colorBalance = initialTransactionState();
  private readonly gradientMap = initialTransactionState();
  private engineUnavailableError: string | null = null;
  private liquifySettings: LiquifySettings = { ...DEFAULT_LIQUIFY_SETTINGS };
  private liquifyAmount = 1;
  private liquifyReturnTool: CanvasInputTool | null = null;
  private activeAutoCommitPromise: Promise<boolean> | null = null;
  private gradientMapPreparePromise: Promise<boolean> | null = null;
  private gradientMapExitIntent: "none" | "cancel" | "commit" = "none";
  private gradientMapGeneration = 0;
  private disposed = false;

  constructor(private readonly options: RasterAdjustmentsControllerOptions) {
    this.abortController = new options.browser.AbortController();
    this.liquifySheet = new MobileLiquifySheetController({
      browser: options.browser,
      document: options.browser.document,
      elements: {
        sheet: options.elements.liquify.sheet,
        handle: options.elements.liquify.sheetHandle,
        header: options.elements.liquify.sheetHeader,
        controlsRegion: options.elements.liquify.controlsRegion,
      },
      beforeOpen: options.beforeSheetOpen,
      onRequestCancel: () => void this.cancelLiquify(),
      onOpenChange: options.onSheetOpenChange,
    });
    this.gaussianBlurSheet = new MobileGaussianBlurSheetController({
      browser: options.browser,
      document: options.browser.document,
      elements: {
        sheet: options.elements.gaussianBlur.sheet,
        handle: options.elements.gaussianBlur.sheetHandle,
        header: options.elements.gaussianBlur.sheetHeader,
        controlsRegion: options.elements.gaussianBlur.controlsRegion,
      },
      beforeOpen: options.beforeSheetOpen,
      onRequestCancel: () => void this.cancelGaussianBlur(),
      onOpenChange: options.onSheetOpenChange,
    });
    this.spatialBlurEditor = new SpatialBlurController({
      browser: options.browser,
      document: options.browser.document,
      engine: options.engine,
      documentWidth: options.engine.documentWidth,
      documentHeight: options.engine.documentHeight,
      elements: {
        canvas: options.elements.canvas,
        ...options.elements.spatialBlur,
      },
      onPinsChange: (pins) => this.updateSpatialBlur(pins),
      onRequestCancel: () => void this.cancelSpatialBlur(),
      onRequestApply: () => void this.applySpatialBlur(),
    });
    this.motionBlurSheet = new MobileMotionBlurSheetController({
      browser: options.browser,
      document: options.browser.document,
      elements: {
        sheet: options.elements.motionBlur.sheet,
        handle: options.elements.motionBlur.sheetHandle,
        header: options.elements.motionBlur.sheetHeader,
        controlsRegion: options.elements.motionBlur.controlsRegion,
      },
      beforeOpen: options.beforeSheetOpen,
      onRequestCancel: () => void this.cancelMotionBlur(),
      onOpenChange: options.onSheetOpenChange,
    });
    this.noiseSheet = new MobileNoiseSheetController({
      browser: options.browser,
      document: options.browser.document,
      elements: {
        sheet: options.elements.noise.sheet,
        handle: options.elements.noise.sheetHandle,
        header: options.elements.noise.sheetHeader,
        controlsRegion: options.elements.noise.controlsRegion,
      },
      beforeOpen: options.beforeSheetOpen,
      onRequestCancel: () => void this.cancelNoise(),
      onOpenChange: options.onSheetOpenChange,
    });
    this.glassSheet = new MobileGlassSheetController({
      browser: options.browser,
      document: options.browser.document,
      elements: {
        sheet: options.elements.glass.sheet,
        handle: options.elements.glass.sheetHandle,
        header: options.elements.glass.sheetHeader,
        controlsRegion: options.elements.glass.controlsRegion,
      },
      beforeOpen: options.beforeSheetOpen,
      onRequestCancel: () => void this.cancelGlass(),
      onOpenChange: options.onSheetOpenChange,
    });
    this.curvesSheet = new MobileRasterToneCurvesSheetController({
      browser: options.browser,
      document: options.browser.document,
      elements: {
        sheet: options.elements.curves.sheet,
        handle: options.elements.curves.sheetHandle,
        header: options.elements.curves.sheetHeader,
        controlsRegion: options.elements.curves.controlsRegion,
      },
      beforeOpen: options.beforeSheetOpen,
      onRequestCancel: () => void this.cancelCurves(),
      onOpenChange: options.onSheetOpenChange,
    });
    this.curvesEditor = new RasterToneCurvesEditorController({
      browser: options.browser,
      elements: options.elements.curves,
      onChange: (curves) => this.requestCurvesUpdate(curves),
    });
    this.colorAdjustSurface = new RasterColorAdjustSurfaceController({
      browser: options.browser,
      document: options.browser.document,
      canvas: options.elements.canvas,
      elements: options.elements.colorAdjust,
      onChange: (settings) => this.requestColorAdjustUpdate(settings),
      onRequestReset: () => this.resetColorAdjust(),
      onRequestCancel: () => void this.cancelColorAdjust(),
    });
    this.colorBalanceSurface = new RasterColorBalanceSurfaceController({
      browser: options.browser,
      document: options.browser.document,
      canvas: options.elements.canvas,
      elements: options.elements.colorBalance,
      onChange: (settings) => this.requestColorBalanceUpdate(settings),
      onRequestReset: () => this.resetColorBalance(),
      onRequestCancel: () => void this.cancelColorBalance(),
    });
    this.gradientMapSurface = new RasterGradientMapSurfaceController({
      browser: options.browser,
      document: options.browser.document,
      canvas: options.elements.canvas,
      elements: options.elements.gradientMap,
      presets: RASTER_GRADIENT_MAP_PRESETS,
      onChange: (settings, presetId) => this.requestGradientMapUpdate(settings, presetId),
      onRequestReset: () => this.resetGradientMap(),
      onRequestCancel: () => void this.cancelGradientMap(),
    });
    this.configureControlRanges();
    this.syncLiquifySettings(this.liquifySettings, this.liquifyAmount);
    this.syncNoiseSettings(DEFAULT_RASTER_NOISE_SETTINGS);
    this.syncGlassSettings(DEFAULT_RASTER_GLASS_SETTINGS);
    this.bindEvents();
    this.syncUi();
  }

  get isAnySurfaceOpen(): boolean {
    return this.states().some((state) => state.surfaceOpen || state.uiBusy);
  }

  get isAnySheetOpen(): boolean {
    return this.liquifySheet.isOpen
      || this.gaussianBlurSheet.isOpen
      || this.motionBlurSheet.isOpen
      || this.noiseSheet.isOpen
      || this.glassSheet.isOpen
      || this.curvesSheet.isOpen;
  }

  isOpen(kind: DestructiveRasterAdjustmentKind): boolean {
    return this.state(kind).surfaceOpen;
  }

  openGlass(trigger: HTMLElement, returnFocus: HTMLElement = trigger): void {
    void this.beginGlass(trigger, returnFocus);
  }

  openCurves(trigger: HTMLElement, returnFocus: HTMLElement = trigger): void {
    void this.beginCurves(trigger, returnFocus);
  }

  openColorAdjust(trigger: HTMLElement, returnFocus: HTMLElement = trigger): void {
    void this.beginColorAdjust(returnFocus);
  }

  openColorBalance(trigger: HTMLElement, returnFocus: HTMLElement = trigger): void {
    void this.beginColorBalance(returnFocus);
  }

  openGradientMap(trigger: HTMLElement, returnFocus: HTMLElement = trigger): void {
    void this.beginGradientMap(returnFocus);
  }

  openSpatialBlur(trigger: HTMLElement, returnFocus: HTMLElement = trigger): void {
    void this.beginSpatialBlur(trigger, returnFocus);
  }

  isSpatialBlurEditActive(history = this.options.getHistoryState()): boolean {
    return this.spatialBlur.sessionOpen
      && history.openEdit === "spatial-blur"
      && !this.spatialBlur.uiBusy
      && !this.spatialBlur.previewFault;
  }

  beginSpatialBlurPointer(input: SpatialBlurPointerInput): boolean {
    return this.isSpatialBlurEditActive() && this.spatialBlurEditor.beginPointer(input);
  }

  updateSpatialBlurPointer(input: SpatialBlurPointerInput): void {
    this.spatialBlurEditor.updatePointer(input);
  }

  endSpatialBlurPointer(input: SpatialBlurPointerInput, commit: boolean): void {
    this.spatialBlurEditor.endPointer(input, commit);
  }

  cancelSpatialBlurPointerForNavigation(): void {
    this.spatialBlurEditor.cancelPointerGestureForNavigation();
  }

  handleViewChange(): void {
    this.spatialBlurEditor.handleViewChange();
  }

  hasActiveHistoryEdit(history = this.options.getHistoryState()): boolean {
    return history.openEdit === "liquify"
      || history.openEdit === "gaussian-blur"
      || history.openEdit === "spatial-blur"
      || history.openEdit === "motion-blur"
      || history.openEdit === "noise"
      || history.openEdit === "glass"
      || history.openEdit === "curves"
      || history.openEdit === "color-adjust"
      || history.openEdit === "color-balance"
      || history.openEdit === "gradient-map";
  }

  isLiquifyEditActive(history = this.options.getHistoryState()): boolean {
    return this.liquify.sessionOpen && history.openEdit === "liquify";
  }

  isDestructivePreviewNavigationActive(
    history = this.options.getHistoryState(),
  ): boolean {
    return (this.gaussianBlur.sessionOpen && history.openEdit === "gaussian-blur")
      || (this.spatialBlur.sessionOpen && history.openEdit === "spatial-blur")
      || (this.motionBlur.sessionOpen && history.openEdit === "motion-blur")
      || (this.noise.sessionOpen && history.openEdit === "noise")
      || (this.glass.sessionOpen && history.openEdit === "glass")
      || (this.curves.sessionOpen && history.openEdit === "curves")
      || (this.colorAdjust.sessionOpen && history.openEdit === "color-adjust")
      || (this.colorBalance.sessionOpen && history.openEdit === "color-balance")
      || (this.gradientMap.sessionOpen && history.openEdit === "gradient-map");
  }

  allowsCanvasViewOperation(history = this.options.getHistoryState()): boolean {
    if (history.inconsistent) return false;
    return (
      this.liquify.sessionOpen
        && history.openEdit === "liquify"
        && !this.liquify.uiBusy
    ) || (
      this.gaussianBlur.sessionOpen
        && history.openEdit === "gaussian-blur"
        && !this.gaussianBlur.uiBusy
    ) || (
      this.spatialBlur.sessionOpen
        && history.openEdit === "spatial-blur"
        && !this.spatialBlur.uiBusy
    ) || (
      this.motionBlur.sessionOpen
        && history.openEdit === "motion-blur"
        && !this.motionBlur.uiBusy
    ) || (
      this.noise.sessionOpen
        && history.openEdit === "noise"
        && !this.noise.uiBusy
    ) || (
      this.glass.sessionOpen
        && history.openEdit === "glass"
      && !this.glass.uiBusy
    ) || (
      this.curves.sessionOpen
        && history.openEdit === "curves"
        && !this.curves.uiBusy
    ) || (
      this.colorAdjust.sessionOpen
        && history.openEdit === "color-adjust"
        && !this.colorAdjust.uiBusy
    ) || (
      this.colorBalance.sessionOpen
        && history.openEdit === "color-balance"
        && !this.colorBalance.uiBusy
    ) || (
      this.gradientMap.surfaceOpen
        && (!this.gradientMap.sessionOpen || history.openEdit === "gradient-map")
        && !this.gradientMap.uiBusy
    );
  }

  needsAdjustmentSettlementForToolChange(
    history = this.options.getHistoryState(),
  ): boolean {
    return (
      this.colorAdjust.surfaceOpen
      && this.colorAdjust.sessionOpen
      && history.openEdit === "color-adjust"
    ) || (
      this.colorBalance.surfaceOpen
      && this.colorBalance.sessionOpen
      && history.openEdit === "color-balance"
    ) || (
      this.gradientMap.surfaceOpen
      && (
        (!this.gradientMap.sessionOpen && history.openEdit === null)
        || (this.gradientMap.sessionOpen && history.openEdit === "gradient-map")
      )
    );
  }

  isAutoCommitAdjustmentActive(history = this.options.getHistoryState()): boolean {
    return this.needsAdjustmentSettlementForToolChange(history);
  }

  isColorAdjustAutoCommitActive(history = this.options.getHistoryState()): boolean {
    return this.colorAdjust.surfaceOpen
      && this.colorAdjust.sessionOpen
      && history.openEdit === "color-adjust";
  }

  canAutoCommitActiveAdjustment(history = this.options.getHistoryState()): boolean {
    if (history.inconsistent) return false;
    if (history.openEdit === "color-adjust") {
      return this.isColorAdjustAutoCommitActive(history)
        && !this.colorAdjust.uiBusy
        && !this.colorAdjust.previewFault;
    }
    if (history.openEdit === "color-balance") {
      return this.colorBalance.surfaceOpen
        && this.colorBalance.sessionOpen
        && !this.colorBalance.uiBusy
        && !this.colorBalance.previewFault;
    }
    if (this.gradientMap.surfaceOpen) {
      if (this.gradientMap.previewFault) return false;
      if (this.gradientMap.uiBusy) return this.gradientMapPreparePromise !== null;
      return this.gradientMap.sessionOpen
        ? history.openEdit === "gradient-map"
        : history.openEdit === null;
    }
    return false;
  }

  canAutoCommitColorAdjust(history = this.options.getHistoryState()): boolean {
    return history.openEdit === "color-adjust" && this.canAutoCommitActiveAdjustment(history);
  }

  async commitActiveAdjustmentForToolChange(): Promise<boolean> {
    if (this.activeAutoCommitPromise) return this.activeAutoCommitPromise;
    if (!this.needsAdjustmentSettlementForToolChange()) return true;
    const settlement = this.settleActiveAdjustmentForToolChange();
    this.activeAutoCommitPromise = settlement;
    try {
      return await settlement;
    } finally {
      if (this.activeAutoCommitPromise === settlement) this.activeAutoCommitPromise = null;
    }
  }

  private async settleActiveAdjustmentForToolChange(): Promise<boolean> {
    if (this.gradientMap.surfaceOpen) {
      if (this.gradientMap.previewFault || this.history().inconsistent) return false;
      if (this.gradientMapPreparePromise) {
        this.gradientMapExitIntent = "commit";
        if (!await this.gradientMapPreparePromise) return false;
      }
      if (!this.gradientMap.surfaceOpen) return true;
      if (!this.gradientMap.sessionOpen) {
        this.closeGradientMap("cancel", false);
        return true;
      }
      return this.commitGradientMap(false);
    }
    if (!this.canAutoCommitActiveAdjustment()) return false;
    return this.history().openEdit === "color-balance"
      ? this.commitColorBalance(false)
      : this.commitColorAdjust(false);
  }

  commitColorAdjustForToolChange(): Promise<boolean> {
    return this.commitActiveAdjustmentForToolChange();
  }

  diagnostics(): RasterAdjustmentsDiagnostics {
    return {
      rasterGaussianBlurUiBusy: this.gaussianBlur.uiBusy,
      rasterSpatialBlurUiBusy: this.spatialBlur.uiBusy,
      rasterMotionBlurUiBusy: this.motionBlur.uiBusy,
      rasterNoiseUiBusy: this.noise.uiBusy,
      rasterGlassUiBusy: this.glass.uiBusy,
      rasterCurvesUiBusy: this.curves.uiBusy,
      rasterColorAdjustUiBusy: this.colorAdjust.uiBusy,
      rasterColorBalanceUiBusy: this.colorBalance.uiBusy,
      rasterGradientMapUiBusy: this.gradientMap.uiBusy,
      rasterLiquifyUiBusy: this.liquify.uiBusy,
    };
  }

  handleEngineStatus(message: string, kind: "working" | "ok" | "error"): void {
    if (kind === "error" && message.startsWith("WebGPU device lost:")) {
      this.engineUnavailableError = message;
      this.closeSurfacesAfterDeviceLoss(message);
      return;
    }
    if (this.gaussianBlur.sessionOpen && message.includes("Gaussian Blur")) {
      this.setGaussianBlurStatus(message);
      if (kind === "error") this.gaussianBlur.previewFault = true;
      this.syncGaussianBlurUi();
    }
    if (this.spatialBlur.sessionOpen && message.includes("Point Blur")) {
      this.spatialBlurEditor.setStatus(message);
      if (kind === "error") this.spatialBlur.previewFault = true;
      this.syncSpatialBlurUi();
    }
    if (this.motionBlur.sessionOpen && message.includes("Motion Blur")) {
      this.setMotionBlurStatus(message);
      if (kind === "error") this.motionBlur.previewFault = true;
      this.syncMotionBlurUi();
    }
    if (this.noise.sessionOpen && message.includes("Noise")) {
      this.setNoiseStatus(message);
      if (kind === "error") this.noise.previewFault = true;
      this.syncNoiseUi();
    }
    if (this.glass.sessionOpen && message.includes("Glass")) {
      this.setGlassStatus(message);
      if (kind === "error") this.glass.previewFault = true;
      this.syncGlassUi();
    }
    if (this.curves.sessionOpen && message.includes("Curves")) {
      this.setCurvesStatus(message);
      if (kind === "error") this.curves.previewFault = true;
      this.syncCurvesUi();
    }
    if (this.colorAdjust.sessionOpen && message.includes("Color Adjust")) {
      this.setColorAdjustStatus(message);
      if (kind === "error") this.colorAdjust.previewFault = true;
      this.syncColorAdjustUi();
    }
    if (this.colorBalance.sessionOpen && message.includes("Color Balance")) {
      this.setColorBalanceStatus(message);
      if (kind === "error") this.colorBalance.previewFault = true;
      this.syncColorBalanceUi();
    }
    if (this.gradientMap.sessionOpen && message.includes("Gradient Map")) {
      this.setGradientMapStatus(message);
      if (kind === "error") this.gradientMap.previewFault = true;
      this.syncGradientMapUi();
    }
    if (this.liquify.sessionOpen && message.includes("Liquify")) {
      this.setLiquifyStatus(message);
      if (kind === "error") this.liquify.previewFault = true;
      this.syncLiquifyUi();
    }
  }

  private closeSurfacesAfterDeviceLoss(message: string): void {
    const close = (
      state: AdjustmentTransactionState,
      setStatus: (status: string) => void,
      closeSurface: (result: AdjustmentResult) => void,
    ): void => {
      if (!state.surfaceOpen && !state.sessionOpen) return;
      state.sessionOpen = false;
      state.uiBusy = false;
      state.previewFault = true;
      state.cancelPending = false;
      setStatus(message);
      closeSurface("error");
    };
    close(this.liquify, (status) => this.setLiquifyStatus(status), (result) => this.closeLiquify(result));
    close(
      this.gaussianBlur,
      (status) => this.setGaussianBlurStatus(status),
      (result) => this.closeGaussianBlur(result),
    );
    close(
      this.spatialBlur,
      (status) => this.spatialBlurEditor.setStatus(status),
      (result) => this.closeSpatialBlur(result),
    );
    close(
      this.motionBlur,
      (status) => this.setMotionBlurStatus(status),
      (result) => this.closeMotionBlur(result),
    );
    close(this.noise, (status) => this.setNoiseStatus(status), (result) => this.closeNoise(result));
    close(this.glass, (status) => this.setGlassStatus(status), (result) => this.closeGlass(result));
    close(this.curves, (status) => this.setCurvesStatus(status), (result) => this.closeCurves(result));
    close(
      this.colorAdjust,
      (status) => this.setColorAdjustStatus(status),
      (result) => this.closeColorAdjust(result),
    );
    close(
      this.colorBalance,
      (status) => this.setColorBalanceStatus(status),
      (result) => this.closeColorBalance(result),
    );
    close(
      this.gradientMap,
      (status) => this.setGradientMapStatus(status),
      (result) => this.closeGradientMap(result),
    );
    this.setAppError(message);
    this.refreshHistory();
    this.syncUi();
  }

  syncUi(): void {
    this.syncLiquifyUi();
    this.syncGaussianBlurUi();
    this.syncSpatialBlurUi();
    this.syncMotionBlurUi();
    this.syncNoiseUi();
    this.syncGlassUi();
    this.syncCurvesUi();
    this.syncColorAdjustUi();
    this.syncColorBalanceUi();
    this.syncGradientMapUi();
  }

  reconfigureDocument(width: number, height: number): void {
    this.spatialBlurEditor.reconfigureDocument(width, height);
  }

  handleResize(): void {
    this.liquifySheet.handleResize();
    this.gaussianBlurSheet.handleResize();
    this.spatialBlurEditor.handleViewChange();
    this.motionBlurSheet.handleResize();
    this.noiseSheet.handleResize();
    this.glassSheet.handleResize();
    this.curvesSheet.handleResize();
    this.curvesEditor.handleResize();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortController.abort();
    this.liquifySheet.dispose();
    this.gaussianBlurSheet.dispose();
    this.spatialBlurEditor.dispose();
    this.motionBlurSheet.dispose();
    this.noiseSheet.dispose();
    this.glassSheet.dispose();
    this.curvesSheet.dispose();
    this.curvesEditor.dispose();
    this.colorAdjustSurface.dispose();
    this.colorBalanceSurface.dispose();
    this.gradientMapSurface.dispose();
    this.options.elements.canvas.classList.remove(
      "liquify-active",
      "liquify-deforming",
      "raster-curves-active",
      "raster-color-adjust-active",
      "raster-color-balance-active",
      "raster-gradient-map-active",
    );
    void this.cancelLiquify();
    void this.cancelGaussianBlur();
    void this.cancelSpatialBlur();
    void this.cancelMotionBlur();
    void this.cancelNoise();
    void this.cancelGlass();
    void this.cancelCurves();
    void this.cancelColorAdjust();
    void this.cancelColorBalance();
    void this.cancelGradientMap();
  }

  private states(): readonly AdjustmentTransactionState[] {
    return [
      this.liquify,
      this.gaussianBlur,
      this.spatialBlur,
      this.motionBlur,
      this.noise,
      this.glass,
      this.curves,
      this.colorAdjust,
      this.colorBalance,
      this.gradientMap,
    ];
  }

  private state(kind: DestructiveRasterAdjustmentKind): AdjustmentTransactionState {
    switch (kind) {
      case "liquify": return this.liquify;
      case "gaussian-blur": return this.gaussianBlur;
      case "spatial-blur": return this.spatialBlur;
      case "motion-blur": return this.motionBlur;
      case "noise": return this.noise;
      case "glass": return this.glass;
      case "curves": return this.curves;
      case "color-adjust": return this.colorAdjust;
      case "color-balance": return this.colorBalance;
      case "gradient-map": return this.gradientMap;
      default: {
        const unsupported: never = kind;
        throw new Error(`Unsupported raster adjustment: ${String(unsupported)}`);
      }
    }
  }

  private configureControlRanges(): void {
    const { gaussianBlur, motionBlur, noise, glass } = this.options.elements;
    gaussianBlur.radiusInput.min = "1";
    gaussianBlur.radiusInput.max = String(DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS);
    gaussianBlur.radiusInput.step = String(DESTRUCTIVE_GAUSSIAN_BLUR_RADIUS_STEP);
    this.setGaussianBlurRadius(DESTRUCTIVE_GAUSSIAN_BLUR_DEFAULT_RADIUS);

    motionBlur.distanceInput.min = "0";
    motionBlur.distanceInput.max = String(DESTRUCTIVE_MOTION_BLUR_MAX_DISTANCE);
    motionBlur.distanceInput.step = String(DESTRUCTIVE_MOTION_BLUR_DISTANCE_STEP);
    this.setMotionBlurDistance(DESTRUCTIVE_MOTION_BLUR_DEFAULT_DISTANCE);
    motionBlur.angleInput.min = String(DESTRUCTIVE_MOTION_BLUR_MIN_ANGLE);
    motionBlur.angleInput.max = String(DESTRUCTIVE_MOTION_BLUR_MAX_ANGLE);
    motionBlur.angleInput.step = "1";
    this.setMotionBlurAngle(DESTRUCTIVE_MOTION_BLUR_DEFAULT_ANGLE);

    noise.amountInput.min = "0";
    noise.amountInput.max = String(DESTRUCTIVE_RASTER_NOISE_MAX_AMOUNT_PERCENT);
    noise.amountInput.step = String(DESTRUCTIVE_RASTER_NOISE_AMOUNT_STEP);
    for (const input of [noise.scaleInput, noise.octavesInput, noise.turbulenceInput]) {
      input.min = "0";
      input.max = "100";
      input.step = "1";
    }
    for (const input of [
      glass.distortionInput,
      glass.smoothnessInput,
      glass.scaleInput,
    ]) {
      input.min = "0";
      input.max = "100";
      input.step = "1";
    }
  }

  private bindEvents(): void {
    const signal = this.abortController.signal;
    const { liquify, gaussianBlur, spatialBlur, motionBlur, noise, glass, curves } = this.options.elements;
    liquify.openButton.addEventListener(
      "click",
      () => void this.openLiquify(liquify.openButton),
      { signal },
    );
    for (const button of liquify.modeButtons) {
      button.addEventListener("click", () => {
        const mode = button.dataset.liquifyMode;
        if (!isLiquifyMode(mode) || button.dataset.liquifySurface !== "mobile") return;
        this.liquifySettings = { ...this.liquifySettings, mode };
        this.updateLiquifySettings();
      }, { signal });
      button.addEventListener("keydown", (event) => {
        this.handleLiquifyModeKeydown(button, event);
      }, { signal });
    }
    for (const input of [
      liquify.sizeInput,
      liquify.pressureInput,
      liquify.distortionInput,
      liquify.momentumInput,
    ]) {
      input.addEventListener("input", () => this.updateLiquifySettings(), { signal });
    }
    liquify.amountInput.addEventListener("input", () => {
      this.updateLiquifyAmount(Number(liquify.amountInput.value));
    }, { signal });
    liquify.resetButton.addEventListener(
      "click",
      () => void this.resetLiquify(),
      { signal },
    );
    liquify.cancelButton.addEventListener(
      "click",
      () => void this.cancelLiquify(),
      { signal },
    );
    liquify.applyButton.addEventListener(
      "click",
      () => void this.applyLiquify(),
      { signal },
    );

    gaussianBlur.openButton.addEventListener(
      "click",
      () => void this.openGaussianBlur(gaussianBlur.openButton),
      { signal },
    );
    gaussianBlur.radiusInput.addEventListener("input", () => {
      this.updateGaussianBlur(Number(gaussianBlur.radiusInput.value));
    }, { signal });
    gaussianBlur.cancelButton.addEventListener(
      "click",
      () => void this.cancelGaussianBlur(),
      { signal },
    );
    gaussianBlur.applyButton.addEventListener(
      "click",
      () => void this.applyGaussianBlur(),
      { signal },
    );

    spatialBlur.openButton.addEventListener(
      "click",
      () => void this.openSpatialBlur(spatialBlur.openButton),
      { signal },
    );

    motionBlur.openButton.addEventListener(
      "click",
      () => void this.openMotionBlur(motionBlur.openButton),
      { signal },
    );
    motionBlur.distanceInput.addEventListener("input", () => {
      this.updateMotionBlur(
        Number(motionBlur.distanceInput.value),
        Number(motionBlur.angleInput.value),
      );
    }, { signal });
    motionBlur.angleInput.addEventListener("input", () => {
      this.updateMotionBlur(
        Number(motionBlur.distanceInput.value),
        Number(motionBlur.angleInput.value),
      );
    }, { signal });
    motionBlur.cancelButton.addEventListener(
      "click",
      () => void this.cancelMotionBlur(),
      { signal },
    );
    motionBlur.applyButton.addEventListener(
      "click",
      () => void this.applyMotionBlur(),
      { signal },
    );

    noise.openButton.addEventListener(
      "click",
      () => void this.openNoise(noise.openButton),
      { signal },
    );
    for (const input of [
      noise.amountInput,
      noise.scaleInput,
      noise.octavesInput,
      noise.turbulenceInput,
    ]) {
      input.addEventListener("input", () => this.requestNoiseUpdate(), { signal });
    }
    for (const select of [noise.styleSelect, noise.channelsSelect]) {
      select.addEventListener("change", () => this.requestNoiseUpdate(), { signal });
    }
    noise.additiveInput.addEventListener("change", () => this.requestNoiseUpdate(), { signal });
    noise.cancelButton.addEventListener(
      "click",
      () => void this.cancelNoise(),
      { signal },
    );
    noise.applyButton.addEventListener(
      "click",
      () => void this.applyNoise(),
      { signal },
    );

    for (const input of [
      glass.distortionInput,
      glass.smoothnessInput,
      glass.scaleInput,
    ]) {
      input.addEventListener("input", () => this.requestGlassUpdate(), { signal });
    }
    glass.invertInput.addEventListener(
      "change",
      () => this.requestGlassUpdate(),
      { signal },
    );
    glass.reseedButton.addEventListener(
      "click",
      () => this.reseedGlass(),
      { signal },
    );
    glass.cancelButton.addEventListener(
      "click",
      () => void this.cancelGlass(),
      { signal },
    );
    glass.applyButton.addEventListener(
      "click",
      () => void this.applyGlass(),
      { signal },
    );
    curves.cancelButton.addEventListener(
      "click",
      () => void this.cancelCurves(),
      { signal },
    );
    curves.applyButton.addEventListener(
      "click",
      () => void this.applyCurves(),
      { signal },
    );
  }

  private handleLiquifyModeKeydown(button: HTMLButtonElement, event: KeyboardEvent): void {
    if (
      event.key !== "ArrowLeft"
      && event.key !== "ArrowRight"
      && event.key !== "ArrowUp"
      && event.key !== "ArrowDown"
      && event.key !== "Home"
      && event.key !== "End"
    ) return;
    const peers = this.options.elements.liquify.modeButtons.filter(
      (candidate) =>
        candidate.dataset.liquifySurface === button.dataset.liquifySurface
        && !candidate.disabled,
    );
    const index = peers.indexOf(button);
    if (index < 0 || peers.length === 0) return;
    event.preventDefault();
    const columns = 4;
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
    const nextButton = peers[nextIndex];
    nextButton.focus({ preventScroll: true });
    const mode = nextButton.dataset.liquifyMode;
    if (!isLiquifyMode(mode)) return;
    this.liquifySettings = { ...this.liquifySettings, mode };
    this.updateLiquifySettings();
  }

  private history(): HistoryState {
    return this.options.getHistoryState();
  }

  private refreshHistory(): HistoryState {
    const state = this.options.engine.getHistoryState();
    this.options.onHistoryState(state);
    this.options.updateHistoryControls();
    return state;
  }

  private setAppError(message: string): void {
    this.options.elements.appStatus.textContent = message;
    this.options.elements.appStatus.className = "status error";
  }

  private adjustmentEligibilityError(kind: DestructiveRasterAdjustmentKind): string | null {
    const label = kind === "gaussian-blur"
      ? "Gaussian Blur"
      : kind === "spatial-blur"
        ? "Point Blur"
      : kind === "motion-blur"
        ? "Motion Blur"
        : kind === "noise"
          ? "Noise"
          : kind === "glass"
            ? "Glass"
            : kind === "curves"
              ? "Curves"
              : kind === "color-adjust"
                ? "Color Adjust"
                : kind === "color-balance"
                  ? "Color Balance"
                  : kind === "gradient-map"
                    ? "Gradient Map"
                  : "Liquify";
    if (!this.options.isEngineReady()) {
      return `${label} will be available after initialization.`;
    }
    if (this.engineUnavailableError) return this.engineUnavailableError;
    for (const otherKind of [
      "liquify",
      "gaussian-blur",
      "spatial-blur",
      "motion-blur",
      "noise",
      "glass",
      "curves",
      "color-adjust",
      "color-balance",
      "gradient-map",
    ] as const) {
      if (otherKind === kind || !this.state(otherKind).surfaceOpen) continue;
      const otherLabel = otherKind === "gaussian-blur"
        ? "Gaussian Blur"
        : otherKind === "spatial-blur"
          ? "Point Blur"
        : otherKind === "motion-blur"
          ? "Motion Blur"
        : otherKind === "noise"
          ? "Noise"
          : otherKind === "glass"
            ? "Glass"
            : otherKind === "curves"
              ? "Curves"
              : otherKind === "color-adjust"
                ? "Color Adjust"
                : otherKind === "color-balance"
                  ? "Color Balance"
                  : otherKind === "gradient-map"
                    ? "Gradient Map"
                  : "Liquify";
      return `Apply or cancel ${otherLabel} first.`;
    }
    if (this.options.isMultiSelectionActive()) {
      return `Finish the layer multi-selection before opening ${label}.`;
    }
    if (this.options.engine.getPixelSelectionState().selectedPixels > 0) {
      if (kind === "noise") {
        return "Deselect the pixels to apply Noise to the entire layer.";
      }
      if (kind === "glass") {
        return "Deselect the pixels to apply Glass to the entire layer.";
      }
      if (kind === "curves") {
        return "Deselect the pixels to apply Curves to the entire layer.";
      }
      if (kind === "color-adjust") {
        return "Deselect the pixels to apply Color Adjust to the entire layer.";
      }
      if (kind === "color-balance") {
        return "Deselect the pixels to apply Color Balance to the entire layer.";
      }
      if (kind === "gradient-map") {
        return "Deselect the pixels to apply Gradient Map to the entire layer.";
      }
      if (kind === "liquify") {
        return "Deselect the pixels to distort the entire layer.";
      }
      return "Deselect the pixels to blur the entire layer.";
    }
    const stats = this.options.engine.getStats();
    const selected = stats.mixedScene?.items.find(
      (item) => item.key === stats.mixedScene?.selectedKey,
    );
    const curvesVectorTarget = kind === "curves"
      && (selected?.kind === "text" || selected?.kind === "svg");
    const gradientMapVectorTarget = kind === "gradient-map"
      && (selected?.kind === "text" || selected?.kind === "svg");
    if (kind === "curves" && selected?.kind === "text" && selected.textNode.text.length === 0) {
      return "The selected text layer is empty.";
    }
    if (
      kind === "gradient-map"
      && selected?.kind === "text"
      && selected.textNode.text.length === 0
    ) {
      return "The selected text layer is empty.";
    }
    const active = stats.layers.find((layer) => layer.id === stats.activeLayerId);
    if (!curvesVectorTarget && !gradientMapVectorTarget && !active?.hasContent) {
      return "The selected raster layer is empty.";
    }
    const wrongRasterTarget = kind === "liquify"
      ? selected?.kind !== "raster" || selected.rasterLayerId !== stats.activeLayerId
      : kind === "curves"
        ? selected !== undefined
          && !(
            (selected.kind === "raster" && selected.rasterLayerId === stats.activeLayerId)
            || selected.kind === "text"
            || selected.kind === "svg"
          )
      : kind === "gradient-map"
        ? selected !== undefined
          && !(
            (selected.kind === "raster" && selected.rasterLayerId === stats.activeLayerId)
            || selected.kind === "text"
            || selected.kind === "svg"
          )
      : selected !== undefined
        && (selected.kind !== "raster" || selected.rasterLayerId !== stats.activeLayerId);
    if (wrongRasterTarget) {
      return `Select a raster layer to use ${label}.`;
    }
    if (this.options.isSceneBusy() || this.options.isInteractionLocked()) {
      return `Finish the current operation before opening ${label}.`;
    }
    return null;
  }

  private restoreFocus(state: AdjustmentTransactionState): void {
    const returnFocus = state.returnFocus;
    state.returnFocus = null;
    if (!returnFocus?.isConnected || this.disposed) return;
    this.options.browser.queueMicrotask(() => returnFocus.focus({ preventScroll: true }));
  }

  private restoreCurvesRequestFocus(returnFocus: HTMLElement): void {
    if (!returnFocus.isConnected || this.disposed) return;
    this.options.browser.queueMicrotask(() => returnFocus.focus({ preventScroll: true }));
  }

  private setLiquifyStatus(message: string): void {
    this.options.elements.liquify.status.textContent = message;
  }

  private reportLiquifyError(prefix: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const fullMessage = `${prefix}: ${message}`;
    this.setLiquifyStatus(fullMessage);
    this.setAppError(fullMessage);
  }

  private liquifySettingsFromUi(): LiquifySettings {
    const elements = this.options.elements.liquify;
    return normalizeLiquifySettings({
      mode: this.liquifySettings.mode,
      size: Number(elements.sizeInput.value),
      pressure: Number(elements.pressureInput.value) / 100,
      distortion: Number(elements.distortionInput.value) / 100,
      momentum: Number(elements.momentumInput.value) / 100,
    }, this.liquifySettings);
  }

  private syncLiquifySettings(
    settings: Readonly<LiquifySettings>,
    amount = this.liquifyAmount,
  ): void {
    this.liquifySettings = normalizeLiquifySettings(settings, this.liquifySettings);
    this.liquifyAmount = Math.min(1, Math.max(0, Number.isFinite(amount) ? amount : 1));
    const elements = this.options.elements.liquify;
    const size = Math.round(this.liquifySettings.size);
    const pressure = Math.round(this.liquifySettings.pressure * 100);
    const distortion = Math.round(this.liquifySettings.distortion * 100);
    const momentum = Math.round(this.liquifySettings.momentum * 100);
    const amountPercent = Math.round(this.liquifyAmount * 100);
    elements.sizeInput.value = String(size);
    elements.sizeInput.setAttribute("aria-valuetext", `${size} pixels`);
    elements.sizeOutput.value = `${size} px`;
    elements.pressureInput.value = String(pressure);
    elements.pressureOutput.value = `${pressure}%`;
    elements.distortionInput.value = String(distortion);
    elements.distortionOutput.value = `${distortion}%`;
    elements.momentumInput.value = String(momentum);
    elements.momentumOutput.value = `${momentum}%`;
    elements.amountInput.value = String(amountPercent);
    elements.amountOutput.value = `${amountPercent}%`;
    for (const button of elements.modeButtons) {
      const selected = button.dataset.liquifyMode === this.liquifySettings.mode;
      button.setAttribute("aria-checked", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    elements.modeLabel.value = LIQUIFY_MODE_LABELS[this.liquifySettings.mode];
  }

  private syncLiquifyUi(): void {
    const state = this.liquify;
    const elements = this.options.elements.liquify;
    const eligibilityError = state.surfaceOpen || state.sessionOpen || state.uiBusy
      ? "Liquify is already open."
      : this.adjustmentEligibilityError("liquify");
    const recoveryOnly = state.previewFault || this.history().inconsistent;
    const controlsDisabled = state.uiBusy || !state.sessionOpen || recoveryOnly;
    const modeControls = liquifyModeControls(this.liquifySettings.mode);
    elements.openButton.disabled = eligibilityError !== null;
    elements.openButton.title = eligibilityError ?? "Open Liquify";
    elements.openButton.setAttribute("aria-pressed", String(state.surfaceOpen));
    for (const button of elements.modeButtons) button.disabled = controlsDisabled;
    elements.sizeInput.disabled = controlsDisabled;
    elements.pressureInput.disabled = controlsDisabled;
    elements.distortionInput.disabled = controlsDisabled || !modeControls.distortion;
    elements.momentumInput.disabled = controlsDisabled || !modeControls.momentum;
    elements.amountInput.disabled = controlsDisabled;
    elements.applyButton.disabled = controlsDisabled;
    const recoveryActionDisabled = state.uiBusy || !state.sessionOpen;
    elements.cancelButton.disabled = recoveryActionDisabled;
    elements.resetButton.disabled = recoveryActionDisabled || this.history().inconsistent;
    elements.sheet.dataset.state = state.uiBusy
      ? "busy"
      : recoveryOnly
        ? "recovery"
        : state.sessionOpen
          ? "preview"
          : "closed";
    elements.sheet.setAttribute("aria-busy", String(state.uiBusy));
    this.options.elements.canvas.classList.toggle("liquify-active", state.sessionOpen);
  }

  private restoreLiquifyTool(): void {
    const requested = this.liquifyReturnTool;
    this.liquifyReturnTool = null;
    const tool = requested && requested !== "liquify"
      ? requested
      : this.options.getActiveBrushTool();
    this.options.configureCanvasTool(tool, true);
  }

  private closeLiquify(result: AdjustmentResult): void {
    const state = this.liquify;
    state.surfaceOpen = false;
    state.cancelPending = false;
    this.options.elements.liquify.openButton.setAttribute("aria-pressed", "false");
    this.liquifySheet.close(false);
    this.options.elements.canvas.classList.remove("liquify-active", "liquify-deforming");
    this.restoreLiquifyTool();
    this.restoreFocus(state);
    if (result !== "error") this.setLiquifyStatus("Liquify ready.");
    this.syncUi();
  }

  private async openLiquify(trigger: HTMLElement): Promise<void> {
    const eligibilityError = this.adjustmentEligibilityError("liquify");
    if (eligibilityError || this.liquify.surfaceOpen) {
      if (eligibilityError) this.setAppError(eligibilityError);
      this.syncLiquifyUi();
      return;
    }
    if (!this.liquifySheet.open(trigger)) return;
    const state = this.liquify;
    state.surfaceOpen = true;
    state.returnFocus = trigger;
    this.liquifyReturnTool = this.options.getActiveCanvasTool() === "liquify"
      ? this.options.getActiveBrushTool()
      : this.options.getActiveCanvasTool();
    state.sessionOpen = false;
    state.previewFault = false;
    state.uiBusy = true;
    this.setLiquifyStatus("Preparing Liquify…");
    this.syncUi();
    try {
      const preview = await this.options.engine.beginRasterLiquify(this.liquifySettingsFromUi());
      if (!preview) throw new Error("Select a raster layer to use Liquify.");
      state.sessionOpen = true;
      this.syncLiquifySettings(preview.settings, preview.amount);
      this.options.configureCanvasTool("liquify", false);
      this.setLiquifyStatus(
        `${LIQUIFY_MODE_LABELS[preview.settings.mode]} · drag on the canvas.`,
      );
    } catch (error) {
      const history = this.options.engine.getHistoryState();
      this.options.onHistoryState(history);
      state.sessionOpen = history.openEdit === "liquify";
      state.previewFault = state.sessionOpen;
      this.reportLiquifyError("Unable to open Liquify", error);
      if (!state.sessionOpen) this.closeLiquify("error");
    } finally {
      state.uiBusy = false;
      this.refreshHistory();
      this.syncUi();
      if ((state.cancelPending || this.disposed) && state.sessionOpen) {
        state.cancelPending = false;
        void this.cancelLiquify();
      }
    }
  }

  private updateLiquifySettings(): void {
    const requested = this.liquifySettingsFromUi();
    this.syncLiquifySettings(requested, this.liquifyAmount);
    const state = this.liquify;
    if (!state.sessionOpen || state.uiBusy || state.previewFault) return;
    try {
      const preview = this.options.engine.updateRasterLiquifySettings(requested);
      this.syncLiquifySettings(preview.settings, preview.amount);
      this.setLiquifyStatus(`${LIQUIFY_MODE_LABELS[preview.settings.mode]} active.`);
    } catch (error) {
      state.previewFault = true;
      this.reportLiquifyError("Liquify preview interrupted", error);
    }
    this.syncLiquifyUi();
  }

  private updateLiquifyAmount(amountPercent: number): void {
    const normalized = Math.min(1, Math.max(0, amountPercent / 100));
    this.syncLiquifySettings(this.liquifySettings, normalized);
    const state = this.liquify;
    if (!state.sessionOpen || state.uiBusy || state.previewFault) return;
    try {
      const preview = this.options.engine.setRasterLiquifyAmount(normalized);
      this.syncLiquifySettings(preview.settings, preview.amount);
    } catch (error) {
      state.previewFault = true;
      this.reportLiquifyError("Amount adjustment interrupted", error);
    }
    this.syncLiquifyUi();
  }

  private async resetLiquify(): Promise<void> {
    const state = this.liquify;
    if (state.uiBusy || !state.sessionOpen || this.history().inconsistent) return;
    state.uiBusy = true;
    this.setLiquifyStatus("Resetting the distortion…");
    this.syncLiquifyUi();
    try {
      await this.options.engine.resetRasterLiquify();
      state.previewFault = false;
      this.setLiquifyStatus("Distortion reset; Liquify remains active.");
    } catch (error) {
      this.options.onHistoryState(this.options.engine.getHistoryState());
      state.previewFault = true;
      this.reportLiquifyError("Liquify reset failed", error);
    } finally {
      state.uiBusy = false;
      this.refreshHistory();
    }
  }

  private async cancelLiquify(): Promise<void> {
    const state = this.liquify;
    if (state.uiBusy) {
      state.cancelPending = true;
      return;
    }
    if (!state.sessionOpen) return;
    state.cancelPending = false;
    state.uiBusy = true;
    this.options.engine.endRasterLiquifyStroke(false);
    this.setLiquifyStatus("Restoring the original pixels…");
    this.syncLiquifyUi();
    try {
      await this.options.engine.cancelRasterLiquify();
      state.sessionOpen = false;
      state.previewFault = false;
      this.closeLiquify("cancel");
    } catch (error) {
      const history = this.options.engine.getHistoryState();
      this.options.onHistoryState(history);
      state.sessionOpen = history.openEdit === "liquify";
      state.previewFault = true;
      this.reportLiquifyError("Liquify cancellation failed", error);
    } finally {
      state.uiBusy = false;
      this.refreshHistory();
    }
  }

  private async applyLiquify(): Promise<void> {
    const state = this.liquify;
    if (state.uiBusy || !state.sessionOpen || state.previewFault || this.history().inconsistent) {
      return;
    }
    state.uiBusy = true;
    this.options.engine.endRasterLiquifyStroke(false);
    this.setLiquifyStatus("Applying Liquify…");
    this.syncLiquifyUi();
    try {
      await this.options.engine.commitRasterLiquify();
      state.sessionOpen = false;
      state.previewFault = false;
      this.closeLiquify("apply");
      this.options.requestActiveThumbnail();
    } catch (error) {
      const history = this.options.engine.getHistoryState();
      this.options.onHistoryState(history);
      state.sessionOpen = history.openEdit === "liquify";
      state.previewFault = state.sessionOpen;
      this.reportLiquifyError("Liquify application failed", error);
      if (!state.sessionOpen) this.closeLiquify("error");
    } finally {
      state.uiBusy = false;
      this.refreshHistory();
    }
  }

  private setGaussianBlurRadius(radius: number): void {
    const rounded = Math.round(radius);
    const { radiusInput, radiusOutput } = this.options.elements.gaussianBlur;
    radiusInput.value = String(rounded);
    radiusInput.setAttribute("aria-valuetext", `${rounded} pixels`);
    radiusOutput.value = `${rounded} px`;
  }

  private setGaussianBlurStatus(message: string): void {
    this.options.elements.gaussianBlur.status.textContent = message;
  }

  private reportGaussianBlurError(prefix: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const fullMessage = `${prefix}: ${message}`;
    this.setGaussianBlurStatus(fullMessage);
    this.setAppError(fullMessage);
  }

  private resetGaussianBlurControls(): void {
    this.setGaussianBlurRadius(DESTRUCTIVE_GAUSSIAN_BLUR_DEFAULT_RADIUS);
    this.setGaussianBlurStatus("Gaussian Blur ready.");
  }

  private syncGaussianBlurUi(): void {
    const state = this.gaussianBlur;
    const elements = this.options.elements.gaussianBlur;
    const eligibilityError = state.surfaceOpen || state.sessionOpen || state.uiBusy
      ? "Gaussian Blur is already open."
      : this.adjustmentEligibilityError("gaussian-blur");
    const recoveryOnly = state.previewFault || this.history().inconsistent;
    const controlsDisabled = state.uiBusy || !state.sessionOpen || recoveryOnly;
    elements.openButton.disabled = eligibilityError !== null;
    elements.openButton.title = eligibilityError ?? "Open Gaussian Blur";
    elements.openButton.setAttribute("aria-pressed", String(state.surfaceOpen));
    elements.radiusInput.disabled = controlsDisabled;
    elements.applyButton.disabled = controlsDisabled;
    elements.cancelButton.disabled = state.uiBusy || !state.sessionOpen;
    elements.sheet.dataset.state = state.uiBusy
      ? "busy"
      : recoveryOnly
        ? "recovery"
        : state.sessionOpen
          ? "preview"
          : "closed";
    elements.sheet.setAttribute("aria-busy", String(state.uiBusy));
  }

  private closeGaussianBlur(result: AdjustmentResult): void {
    const state = this.gaussianBlur;
    state.surfaceOpen = false;
    state.cancelPending = false;
    this.options.elements.gaussianBlur.openButton.setAttribute("aria-pressed", "false");
    this.gaussianBlurSheet.close(false);
    this.restoreFocus(state);
    if (result !== "error") this.resetGaussianBlurControls();
    this.syncUi();
  }

  private async openGaussianBlur(trigger: HTMLElement): Promise<void> {
    const eligibilityError = this.adjustmentEligibilityError("gaussian-blur");
    if (eligibilityError || this.gaussianBlur.surfaceOpen) {
      if (eligibilityError) this.setAppError(eligibilityError);
      return;
    }
    if (!this.gaussianBlurSheet.open(trigger)) return;
    const state = this.gaussianBlur;
    state.surfaceOpen = true;
    state.returnFocus = trigger;
    state.sessionOpen = false;
    state.previewFault = false;
    state.uiBusy = true;
    this.setGaussianBlurStatus("Preparing Gaussian Blur…");
    this.syncUi();
    try {
      const preview = await this.options.engine.beginRasterGaussianBlur(
        Number(this.options.elements.gaussianBlur.radiusInput.value),
      );
      if (!preview) throw new Error("Select a raster layer to use Gaussian Blur.");
      state.sessionOpen = true;
      this.setGaussianBlurRadius(preview.radius);
      this.setGaussianBlurStatus(`Radius ${preview.radius.toFixed(0)} pixels.`);
    } catch (error) {
      const history = this.options.engine.getHistoryState();
      this.options.onHistoryState(history);
      state.sessionOpen = history.openEdit === "gaussian-blur";
      state.previewFault = state.sessionOpen;
      this.reportGaussianBlurError("Unable to open Gaussian Blur", error);
      if (!state.sessionOpen) this.closeGaussianBlur("error");
    } finally {
      state.uiBusy = false;
      this.refreshHistory();
      if ((state.cancelPending || this.disposed) && state.sessionOpen) {
        state.cancelPending = false;
        void this.cancelGaussianBlur();
      }
    }
  }

  private updateGaussianBlur(requestedRadius: number): void {
    this.setGaussianBlurRadius(requestedRadius);
    const state = this.gaussianBlur;
    if (!state.sessionOpen || state.uiBusy || state.previewFault) return;
    try {
      const preview = this.options.engine.updateRasterGaussianBlur(requestedRadius);
      this.setGaussianBlurRadius(preview.radius);
      this.setGaussianBlurStatus(`Radius ${preview.radius.toFixed(0)} pixels.`);
    } catch (error) {
      state.previewFault = true;
      this.reportGaussianBlurError("Gaussian Blur preview interrupted", error);
      this.syncGaussianBlurUi();
    }
  }

  private async cancelGaussianBlur(): Promise<void> {
    const state = this.gaussianBlur;
    if (state.uiBusy) {
      state.cancelPending = true;
      return;
    }
    if (!state.sessionOpen) return;
    state.cancelPending = false;
    state.uiBusy = true;
    this.setGaussianBlurStatus("Restoring the original pixels…");
    this.syncGaussianBlurUi();
    try {
      await this.options.engine.cancelRasterGaussianBlur();
      state.sessionOpen = false;
      state.previewFault = false;
      this.closeGaussianBlur("cancel");
    } catch (error) {
      const history = this.options.engine.getHistoryState();
      this.options.onHistoryState(history);
      state.sessionOpen = history.openEdit === "gaussian-blur";
      state.previewFault = true;
      this.reportGaussianBlurError("Gaussian Blur cancellation failed", error);
    } finally {
      state.uiBusy = false;
      this.refreshHistory();
    }
  }

  private async applyGaussianBlur(): Promise<void> {
    const state = this.gaussianBlur;
    if (state.uiBusy || !state.sessionOpen || state.previewFault || this.history().inconsistent) {
      return;
    }
    state.uiBusy = true;
    this.setGaussianBlurStatus("Applying Gaussian Blur…");
    this.syncGaussianBlurUi();
    try {
      await this.options.engine.commitRasterGaussianBlur();
      state.sessionOpen = false;
      state.previewFault = false;
      this.closeGaussianBlur("apply");
      this.options.requestActiveThumbnail();
    } catch (error) {
      const history = this.options.engine.getHistoryState();
      this.options.onHistoryState(history);
      state.sessionOpen = history.openEdit === "gaussian-blur";
      state.previewFault = state.sessionOpen;
      this.reportGaussianBlurError("Gaussian Blur application failed", error);
      if (!state.sessionOpen) this.closeGaussianBlur("error");
    } finally {
      state.uiBusy = false;
      this.refreshHistory();
    }
  }

  private syncSpatialBlurUi(): void {
    const state = this.spatialBlur;
    const elements = this.options.elements.spatialBlur;
    const eligibilityError = state.surfaceOpen || state.sessionOpen || state.uiBusy
      ? "Point Blur is already open."
      : this.adjustmentEligibilityError("spatial-blur");
    const recoveryOnly = state.previewFault || this.history().inconsistent;
    elements.openButton.disabled = eligibilityError !== null;
    elements.openButton.title = eligibilityError ?? "Open Point Blur";
    elements.openButton.setAttribute("aria-pressed", String(state.surfaceOpen));
    this.spatialBlurEditor.setTransactionState(state.uiBusy, recoveryOnly);
  }

  private closeSpatialBlur(result: AdjustmentResult): void {
    const state = this.spatialBlur;
    state.surfaceOpen = false;
    state.cancelPending = false;
    this.options.elements.spatialBlur.openButton.setAttribute("aria-pressed", "false");
    this.spatialBlurEditor.close();
    this.options.onSheetOpenChange(false);
    this.options.configureCanvasTool("pan", false);
    this.restoreFocus(state);
    if (result !== "error") this.spatialBlurEditor.setStatus("Point Blur ready.");
    this.syncUi();
  }

  private async beginSpatialBlur(
    _trigger: HTMLElement,
    returnFocus: HTMLElement,
  ): Promise<void> {
    const eligibilityError = this.adjustmentEligibilityError("spatial-blur");
    if (eligibilityError || this.spatialBlur.surfaceOpen) {
      if (eligibilityError) this.setAppError(eligibilityError);
      return;
    }
    this.options.beforeSheetOpen();
    this.options.configureCanvasTool("pan", false);
    const initialPin = createInitialSpatialBlurPin(
      this.options.engine.documentWidth,
      this.options.engine.documentHeight,
    );
    if (!this.spatialBlurEditor.open([initialPin])) return;
    this.options.onSheetOpenChange(true);
    const state = this.spatialBlur;
    state.surfaceOpen = true;
    state.returnFocus = returnFocus;
    state.sessionOpen = false;
    state.previewFault = false;
    state.uiBusy = true;
    this.spatialBlurEditor.setStatus("Preparing Point Blur…");
    this.syncUi();
    try {
      const preview = await this.options.engine.beginRasterSpatialBlur([initialPin]);
      if (!preview) throw new Error("Select a raster layer to use Point Blur.");
      state.sessionOpen = true;
      this.spatialBlurEditor.replacePins(preview.pins);
      this.spatialBlurEditor.setStatus(
        `Point 1 · ${preview.pins[0]?.radius.toFixed(0) ?? "0"} px`,
      );
    } catch (error) {
      const history = this.options.engine.getHistoryState();
      this.options.onHistoryState(history);
      state.sessionOpen = history.openEdit === "spatial-blur";
      state.previewFault = state.sessionOpen;
      const message = error instanceof Error ? error.message : String(error);
      this.spatialBlurEditor.setStatus(`Unable to open Point Blur: ${message}`);
      this.setAppError(`Unable to open Point Blur: ${message}`);
      if (!state.sessionOpen) this.closeSpatialBlur("error");
    } finally {
      state.uiBusy = false;
      this.refreshHistory();
      this.syncUi();
      if ((state.cancelPending || this.disposed) && state.sessionOpen) {
        state.cancelPending = false;
        void this.cancelSpatialBlur();
      }
    }
  }

  private updateSpatialBlur(requestedPins: readonly SpatialBlurPin[]): void {
    const state = this.spatialBlur;
    if (!state.sessionOpen || state.uiBusy || state.previewFault) return;
    try {
      const preview = this.options.engine.updateRasterSpatialBlur(requestedPins);
      this.spatialBlurEditor.replacePins(preview.pins);
      this.spatialBlurEditor.setStatus(
        `Point Blur · ${preview.pins.length} point${preview.pins.length === 1 ? "" : "s"}`,
      );
    } catch (error) {
      state.previewFault = true;
      const message = error instanceof Error ? error.message : String(error);
      this.spatialBlurEditor.setStatus(`Point Blur preview interrupted: ${message}`);
      this.setAppError(`Point Blur preview interrupted: ${message}`);
      this.syncSpatialBlurUi();
    }
  }

  private async cancelSpatialBlur(): Promise<void> {
    const state = this.spatialBlur;
    if (state.uiBusy) {
      state.cancelPending = true;
      return;
    }
    if (!state.sessionOpen) {
      if (state.surfaceOpen) this.closeSpatialBlur("cancel");
      return;
    }
    state.cancelPending = false;
    state.uiBusy = true;
    this.spatialBlurEditor.setStatus("Restoring the original pixels…");
    this.syncSpatialBlurUi();
    try {
      await this.options.engine.cancelRasterSpatialBlur();
      state.sessionOpen = false;
      state.previewFault = false;
      this.closeSpatialBlur("cancel");
    } catch (error) {
      const history = this.options.engine.getHistoryState();
      this.options.onHistoryState(history);
      state.sessionOpen = history.openEdit === "spatial-blur";
      state.previewFault = true;
      const message = error instanceof Error ? error.message : String(error);
      this.spatialBlurEditor.setStatus(`Point Blur cancellation failed: ${message}`);
      this.setAppError(`Point Blur cancellation failed: ${message}`);
    } finally {
      state.uiBusy = false;
      this.refreshHistory();
      this.syncUi();
    }
  }

  private async applySpatialBlur(): Promise<void> {
    const state = this.spatialBlur;
    if (state.uiBusy || !state.sessionOpen || state.previewFault || this.history().inconsistent) {
      return;
    }
    state.uiBusy = true;
    this.spatialBlurEditor.setStatus("Applying Point Blur…");
    this.syncSpatialBlurUi();
    try {
      await this.options.engine.commitRasterSpatialBlur();
      state.sessionOpen = false;
      state.previewFault = false;
      this.closeSpatialBlur("apply");
      this.options.requestActiveThumbnail();
    } catch (error) {
      const history = this.options.engine.getHistoryState();
      this.options.onHistoryState(history);
      state.sessionOpen = history.openEdit === "spatial-blur";
      state.previewFault = state.sessionOpen;
      const message = error instanceof Error ? error.message : String(error);
      this.spatialBlurEditor.setStatus(`Point Blur application failed: ${message}`);
      this.setAppError(`Point Blur application failed: ${message}`);
      if (!state.sessionOpen) this.closeSpatialBlur("error");
    } finally {
      state.uiBusy = false;
      this.refreshHistory();
      this.syncUi();
    }
  }

  private setMotionBlurDistance(distance: number): void {
    const rounded = Math.round(distance);
    const { distanceInput, distanceOutput } = this.options.elements.motionBlur;
    distanceInput.value = String(rounded);
    distanceInput.setAttribute("aria-valuetext", `${rounded} pixels`);
    distanceOutput.value = `${rounded} px`;
  }

  private setMotionBlurAngle(angle: number): void {
    const rounded = Math.round(angle);
    const { angleInput, angleOutput } = this.options.elements.motionBlur;
    angleInput.value = String(rounded);
    angleInput.setAttribute("aria-valuetext", `${rounded} degrees`);
    angleOutput.value = `${rounded}°`;
  }

  private setMotionBlurStatus(message: string): void {
    this.options.elements.motionBlur.status.textContent = message;
  }

  private reportMotionBlurError(prefix: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const fullMessage = `${prefix}: ${message}`;
    this.setMotionBlurStatus(fullMessage);
    this.setAppError(fullMessage);
  }

  private resetMotionBlurControls(): void {
    this.setMotionBlurDistance(DESTRUCTIVE_MOTION_BLUR_DEFAULT_DISTANCE);
    this.setMotionBlurAngle(DESTRUCTIVE_MOTION_BLUR_DEFAULT_ANGLE);
    this.setMotionBlurStatus("Motion Blur ready.");
  }

  private syncMotionBlurUi(): void {
    const state = this.motionBlur;
    const elements = this.options.elements.motionBlur;
    const eligibilityError = state.surfaceOpen || state.sessionOpen || state.uiBusy
      ? "Motion Blur is already open."
      : this.adjustmentEligibilityError("motion-blur");
    const recoveryOnly = state.previewFault || this.history().inconsistent;
    const controlsDisabled = state.uiBusy || !state.sessionOpen || recoveryOnly;
    elements.openButton.disabled = eligibilityError !== null;
    elements.openButton.title = eligibilityError ?? "Open Motion Blur";
    elements.openButton.setAttribute("aria-pressed", String(state.surfaceOpen));
    elements.distanceInput.disabled = controlsDisabled;
    elements.angleInput.disabled = controlsDisabled;
    elements.applyButton.disabled = controlsDisabled;
    elements.cancelButton.disabled = state.uiBusy || !state.sessionOpen;
    elements.sheet.dataset.state = state.uiBusy
      ? "busy"
      : recoveryOnly
        ? "recovery"
        : state.sessionOpen
          ? "preview"
          : "closed";
    elements.sheet.setAttribute("aria-busy", String(state.uiBusy));
  }

  private closeMotionBlur(result: AdjustmentResult): void {
    const state = this.motionBlur;
    state.surfaceOpen = false;
    state.cancelPending = false;
    this.options.elements.motionBlur.openButton.setAttribute("aria-pressed", "false");
    this.motionBlurSheet.close(false);
    this.restoreFocus(state);
    if (result !== "error") this.resetMotionBlurControls();
    this.syncUi();
  }

  private async openMotionBlur(trigger: HTMLElement): Promise<void> {
    const eligibilityError = this.adjustmentEligibilityError("motion-blur");
    if (eligibilityError || this.motionBlur.surfaceOpen) {
      if (eligibilityError) this.setAppError(eligibilityError);
      return;
    }
    if (!this.motionBlurSheet.open(trigger)) return;
    const state = this.motionBlur;
    state.surfaceOpen = true;
    state.returnFocus = trigger;
    state.sessionOpen = false;
    state.previewFault = false;
    state.uiBusy = true;
    this.setMotionBlurStatus("Preparing Motion Blur…");
    this.syncUi();
    const elements = this.options.elements.motionBlur;
    try {
      const preview = await this.options.engine.beginRasterMotionBlur(
        Number(elements.distanceInput.value),
        Number(elements.angleInput.value),
      );
      if (!preview) throw new Error("Select a raster layer to use Motion Blur.");
      state.sessionOpen = true;
      this.setMotionBlurDistance(preview.distance);
      this.setMotionBlurAngle(preview.angle);
      this.setMotionBlurStatus(
        `Distance ${preview.distance.toFixed(0)} pixels · Angle ${preview.angle.toFixed(0)}°.`,
      );
    } catch (error) {
      const history = this.options.engine.getHistoryState();
      this.options.onHistoryState(history);
      state.sessionOpen = history.openEdit === "motion-blur";
      state.previewFault = state.sessionOpen;
      this.reportMotionBlurError("Unable to open Motion Blur", error);
      if (!state.sessionOpen) this.closeMotionBlur("error");
    } finally {
      state.uiBusy = false;
      this.refreshHistory();
      if ((state.cancelPending || this.disposed) && state.sessionOpen) {
        state.cancelPending = false;
        void this.cancelMotionBlur();
      }
    }
  }

  private updateMotionBlur(distance: number, angle: number): void {
    this.setMotionBlurDistance(distance);
    this.setMotionBlurAngle(angle);
    const state = this.motionBlur;
    if (!state.sessionOpen || state.uiBusy || state.previewFault) return;
    try {
      const preview = this.options.engine.updateRasterMotionBlur(distance, angle);
      this.setMotionBlurDistance(preview.distance);
      this.setMotionBlurAngle(preview.angle);
      this.setMotionBlurStatus(
        `Distance ${preview.distance.toFixed(0)} pixels · Angle ${preview.angle.toFixed(0)}°.`,
      );
    } catch (error) {
      state.previewFault = true;
      this.reportMotionBlurError("Motion Blur preview interrupted", error);
      this.syncMotionBlurUi();
    }
  }

  private async cancelMotionBlur(): Promise<void> {
    const state = this.motionBlur;
    if (state.uiBusy) {
      state.cancelPending = true;
      return;
    }
    if (!state.sessionOpen) return;
    state.cancelPending = false;
    state.uiBusy = true;
    this.setMotionBlurStatus("Restoring the original pixels…");
    this.syncMotionBlurUi();
    try {
      await this.options.engine.cancelRasterMotionBlur();
      state.sessionOpen = false;
      state.previewFault = false;
      this.closeMotionBlur("cancel");
    } catch (error) {
      const history = this.options.engine.getHistoryState();
      this.options.onHistoryState(history);
      state.sessionOpen = history.openEdit === "motion-blur";
      state.previewFault = true;
      this.reportMotionBlurError("Motion Blur cancellation failed", error);
    } finally {
      state.uiBusy = false;
      this.refreshHistory();
    }
  }

  private async applyMotionBlur(): Promise<void> {
    const state = this.motionBlur;
    if (state.uiBusy || !state.sessionOpen || state.previewFault || this.history().inconsistent) {
      return;
    }
    state.uiBusy = true;
    this.setMotionBlurStatus("Applying Motion Blur…");
    this.syncMotionBlurUi();
    try {
      await this.options.engine.commitRasterMotionBlur();
      state.sessionOpen = false;
      state.previewFault = false;
      this.closeMotionBlur("apply");
      this.options.requestActiveThumbnail();
    } catch (error) {
      const history = this.options.engine.getHistoryState();
      this.options.onHistoryState(history);
      state.sessionOpen = history.openEdit === "motion-blur";
      state.previewFault = state.sessionOpen;
      this.reportMotionBlurError("Motion Blur application failed", error);
      if (!state.sessionOpen) this.closeMotionBlur("error");
    } finally {
      state.uiBusy = false;
      this.refreshHistory();
    }
  }

  private noiseSettingsFromUi(): RasterNoiseSettings {
    const elements = this.options.elements.noise;
    return {
      amountPercent: Number(elements.amountInput.value),
      scalePercent: Number(elements.scaleInput.value),
      octavesPercent: Number(elements.octavesInput.value),
      turbulencePercent: Number(elements.turbulenceInput.value),
      style: elements.styleSelect.value as RasterNoiseStyle,
      channels: elements.channelsSelect.value as RasterNoiseChannels,
      additive: elements.additiveInput.checked,
    };
  }

  private syncNoiseSettings(settings: Readonly<RasterNoiseSettings>): void {
    const elements = this.options.elements.noise;
    const amount = Math.round(settings.amountPercent);
    const amountLabel = amount > 100 ? `${amount}% · Extended` : `${amount}%`;
    elements.amountInput.value = String(settings.amountPercent);
    elements.amountInput.setAttribute("aria-valuetext", amountLabel);
    elements.amountOutput.value = amountLabel;
    elements.styleSelect.value = settings.style;
    elements.scaleInput.value = String(settings.scalePercent);
    const period = rasterNoisePeriodPixels(settings.scalePercent);
    elements.scaleOutput.value = `${Math.round(settings.scalePercent)}% · ${formatPixelMeasure(period)} px`;
    elements.octavesInput.value = String(settings.octavesPercent);
    elements.octavesOutput.value = rasterNoiseOctaveCount(settings.octavesPercent).toFixed(1);
    elements.turbulenceInput.value = String(settings.turbulencePercent);
    elements.turbulenceOutput.value = `${Math.round(settings.turbulencePercent)}%`;
    elements.channelsSelect.value = settings.channels;
    elements.additiveInput.checked = settings.additive;
  }

  private setNoiseStatus(message: string): void {
    this.options.elements.noise.status.textContent = message;
  }

  private reportNoiseError(prefix: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const fullMessage = `${prefix}: ${message}`;
    this.setNoiseStatus(fullMessage);
    this.setAppError(fullMessage);
  }

  private resetNoiseControls(): void {
    this.syncNoiseSettings(DEFAULT_RASTER_NOISE_SETTINGS);
    this.setNoiseStatus("Noise ready.");
  }

  private syncNoiseUi(): void {
    const state = this.noise;
    const elements = this.options.elements.noise;
    const eligibilityError = state.surfaceOpen || state.sessionOpen || state.uiBusy
      ? "Noise is already open."
      : this.adjustmentEligibilityError("noise");
    const recoveryOnly = state.previewFault || this.history().inconsistent;
    const controlsDisabled = state.uiBusy || !state.sessionOpen || recoveryOnly;
    elements.openButton.disabled = eligibilityError !== null;
    elements.openButton.title = eligibilityError ?? "Open Noise";
    elements.openButton.setAttribute("aria-pressed", String(state.surfaceOpen));
    for (const control of [
      elements.amountInput,
      elements.styleSelect,
      elements.scaleInput,
      elements.octavesInput,
      elements.turbulenceInput,
      elements.channelsSelect,
      elements.additiveInput,
    ]) {
      control.disabled = controlsDisabled;
    }
    elements.applyButton.disabled = controlsDisabled;
    elements.cancelButton.disabled = state.uiBusy || !state.sessionOpen;
    elements.sheet.dataset.state = state.uiBusy
      ? "busy"
      : recoveryOnly
        ? "recovery"
        : state.sessionOpen
          ? "preview"
          : "closed";
    elements.sheet.setAttribute("aria-busy", String(state.uiBusy));
  }

  private closeNoise(result: AdjustmentResult): void {
    const state = this.noise;
    state.surfaceOpen = false;
    state.cancelPending = false;
    this.options.elements.noise.openButton.setAttribute("aria-pressed", "false");
    this.noiseSheet.close(false);
    this.restoreFocus(state);
    if (result !== "error") this.resetNoiseControls();
    this.syncUi();
  }

  private async openNoise(trigger: HTMLElement): Promise<void> {
    const eligibilityError = this.adjustmentEligibilityError("noise");
    if (eligibilityError || this.noise.surfaceOpen) {
      if (eligibilityError) this.setAppError(eligibilityError);
      return;
    }
    if (!this.noiseSheet.open(trigger)) return;
    const state = this.noise;
    state.surfaceOpen = true;
    state.returnFocus = trigger;
    state.sessionOpen = false;
    state.previewFault = false;
    state.uiBusy = true;
    const initial = this.noiseSettingsFromUi();
    this.syncNoiseSettings(initial);
    this.setNoiseStatus("Preparing Noise…");
    this.syncUi();
    try {
      const preview = await this.options.engine.beginRasterNoise(initial);
      if (!preview) throw new Error("Select a raster layer to use Noise.");
      state.sessionOpen = true;
      this.syncNoiseSettings(preview.settings);
      this.setNoiseStatus(
        `Amount ${preview.settings.amountPercent.toFixed(0)}% · `
        + `${preview.settings.style} · ${preview.settings.channels}.`,
      );
    } catch (error) {
      const history = this.options.engine.getHistoryState();
      this.options.onHistoryState(history);
      state.sessionOpen = history.openEdit === "noise";
      state.previewFault = state.sessionOpen;
      this.reportNoiseError("Unable to open Noise", error);
      if (!state.sessionOpen) this.closeNoise("error");
    } finally {
      state.uiBusy = false;
      this.refreshHistory();
      if ((state.cancelPending || this.disposed) && state.sessionOpen) {
        state.cancelPending = false;
        void this.cancelNoise();
      }
    }
  }

  private requestNoiseUpdate(): void {
    const settings = this.noiseSettingsFromUi();
    this.syncNoiseSettings(settings);
    this.updateNoise(settings);
  }

  private updateNoise(settings: RasterNoiseSettings): void {
    const state = this.noise;
    if (state.uiBusy || !state.sessionOpen || state.previewFault || this.history().inconsistent) {
      return;
    }
    try {
      const preview = this.options.engine.updateRasterNoise(settings);
      this.syncNoiseSettings(preview.settings);
      this.setNoiseStatus(`Noise preview ${preview.settings.amountPercent.toFixed(0)}%…`);
    } catch (error) {
      state.previewFault = true;
      this.reportNoiseError("Noise preview failed", error);
      this.syncNoiseUi();
    }
  }

  private async cancelNoise(): Promise<void> {
    const state = this.noise;
    if (state.uiBusy) {
      state.cancelPending = true;
      return;
    }
    if (!state.sessionOpen) return;
    state.cancelPending = false;
    state.uiBusy = true;
    this.setNoiseStatus("Restoring the original pixels…");
    this.syncNoiseUi();
    try {
      await this.options.engine.cancelRasterNoise();
      state.sessionOpen = false;
      state.previewFault = false;
      this.closeNoise("cancel");
    } catch (error) {
      const history = this.options.engine.getHistoryState();
      this.options.onHistoryState(history);
      state.sessionOpen = history.openEdit === "noise";
      state.previewFault = true;
      this.reportNoiseError("Noise cancellation failed", error);
    } finally {
      state.uiBusy = false;
      this.refreshHistory();
    }
  }

  private async applyNoise(): Promise<void> {
    const state = this.noise;
    if (state.uiBusy || !state.sessionOpen || state.previewFault || this.history().inconsistent) {
      return;
    }
    state.uiBusy = true;
    this.setNoiseStatus("Applying Noise…");
    this.syncNoiseUi();
    try {
      await this.options.engine.commitRasterNoise();
      state.sessionOpen = false;
      state.previewFault = false;
      this.closeNoise("apply");
      this.options.requestActiveThumbnail();
    } catch (error) {
      const history = this.options.engine.getHistoryState();
      this.options.onHistoryState(history);
      state.sessionOpen = history.openEdit === "noise";
      state.previewFault = state.sessionOpen;
      this.reportNoiseError("Noise application failed", error);
      if (!state.sessionOpen) this.closeNoise("error");
    } finally {
      state.uiBusy = false;
      this.refreshHistory();
    }
  }

  private glassSettingsFromUi(): RasterGlassSettings {
    const elements = this.options.elements.glass;
    return normalizeRasterGlassSettings({
      distortionPercent: Number(elements.distortionInput.value),
      smoothnessPercent: Number(elements.smoothnessInput.value),
      scalePercent: Number(elements.scaleInput.value),
      invert: elements.invertInput.checked,
    });
  }

  private syncGlassSettings(settingsInput: Readonly<RasterGlassSettings>): void {
    const settings = normalizeRasterGlassSettings(settingsInput);
    const elements = this.options.elements.glass;
    elements.distortionInput.value = String(settings.distortionPercent);
    elements.distortionOutput.value =
      `${Math.round(settings.distortionPercent)}% · `
      + `${formatPixelMeasure(rasterGlassMaxDisplacementPixels(settings.distortionPercent))} px`;
    elements.smoothnessInput.value = String(settings.smoothnessPercent);
    elements.smoothnessOutput.value = `${Math.round(settings.smoothnessPercent)}%`;
    elements.scaleInput.value = String(settings.scalePercent);
    elements.scaleOutput.value =
      `${Math.round(settings.scalePercent)}% · `
      + `${formatPixelMeasure(rasterGlassScalePixels(settings.scalePercent))} px`;
    elements.invertInput.checked = settings.invert;
  }

  private setGlassStatus(message: string): void {
    this.options.elements.glass.status.textContent = message;
  }

  private reportGlassError(prefix: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const fullMessage = `${prefix}: ${message}`;
    this.setGlassStatus(fullMessage);
    this.setAppError(fullMessage);
  }

  private resetGlassControls(): void {
    this.syncGlassSettings(DEFAULT_RASTER_GLASS_SETTINGS);
    this.setGlassStatus("Glass ready.");
  }

  private syncGlassUi(): void {
    const state = this.glass;
    const elements = this.options.elements.glass;
    const eligibilityError = state.surfaceOpen || state.sessionOpen || state.uiBusy
      ? "Glass is already open."
      : this.adjustmentEligibilityError("glass");
    const recoveryOnly = state.previewFault || this.history().inconsistent;
    const controlsDisabled = state.uiBusy || !state.sessionOpen || recoveryOnly;
    elements.openButton.disabled = eligibilityError !== null;
    elements.openButton.title = eligibilityError ?? "Open Glass";
    elements.openButton.setAttribute("aria-pressed", String(state.surfaceOpen));
    for (const control of [
      elements.distortionInput,
      elements.smoothnessInput,
      elements.scaleInput,
      elements.invertInput,
      elements.reseedButton,
    ]) {
      control.disabled = controlsDisabled;
    }
    elements.applyButton.disabled = controlsDisabled;
    elements.cancelButton.disabled = state.uiBusy || !state.sessionOpen;
    elements.sheet.dataset.state = state.uiBusy
      ? "busy"
      : recoveryOnly
        ? "recovery"
        : state.sessionOpen
          ? "preview"
          : "closed";
    elements.sheet.setAttribute("aria-busy", String(state.uiBusy));
  }

  private closeGlass(result: AdjustmentResult): void {
    const state = this.glass;
    state.surfaceOpen = false;
    state.cancelPending = false;
    this.options.elements.glass.openButton.setAttribute("aria-pressed", "false");
    this.glassSheet.close(false);
    this.restoreFocus(state);
    if (result !== "error") this.resetGlassControls();
    this.syncUi();
  }

  private async beginGlass(
    trigger: HTMLElement,
    returnFocus: HTMLElement,
  ): Promise<void> {
    const eligibilityError = this.adjustmentEligibilityError("glass");
    if (eligibilityError || this.glass.surfaceOpen) {
      if (eligibilityError) this.setAppError(eligibilityError);
      return;
    }
    if (!this.glassSheet.open(trigger)) return;
    const state = this.glass;
    state.surfaceOpen = true;
    state.returnFocus = returnFocus;
    state.sessionOpen = false;
    state.previewFault = false;
    state.uiBusy = true;
    const initial = this.glassSettingsFromUi();
    this.syncGlassSettings(initial);
    this.setGlassStatus("Preparing Glass…");
    this.syncUi();
    try {
      const preview = await this.options.engine.beginRasterGlass(initial);
      if (!preview) throw new Error("Select a raster layer to use Glass.");
      state.sessionOpen = true;
      this.syncGlassSettings(preview.settings);
      this.setGlassStatus(
        `Distortion ${preview.settings.distortionPercent.toFixed(0)}% · `
        + `smoothness ${preview.settings.smoothnessPercent.toFixed(0)}%.`,
      );
    } catch (error) {
      const history = this.options.engine.getHistoryState();
      this.options.onHistoryState(history);
      state.sessionOpen = history.openEdit === "glass";
      state.previewFault = state.sessionOpen;
      this.reportGlassError("Unable to open Glass", error);
      if (!state.sessionOpen) this.closeGlass("error");
    } finally {
      state.uiBusy = false;
      this.refreshHistory();
      if ((state.cancelPending || this.disposed) && state.sessionOpen) {
        state.cancelPending = false;
        void this.cancelGlass();
      }
    }
  }

  private requestGlassUpdate(): void {
    const settings = this.glassSettingsFromUi();
    this.syncGlassSettings(settings);
    const state = this.glass;
    if (state.uiBusy || !state.sessionOpen || state.previewFault || this.history().inconsistent) {
      return;
    }
    try {
      const preview = this.options.engine.updateRasterGlass(settings);
      this.syncGlassSettings(preview.settings);
      this.setGlassStatus(
        `Glass preview ${preview.settings.distortionPercent.toFixed(0)}%…`,
      );
    } catch (error) {
      state.previewFault = true;
      this.reportGlassError("Glass preview failed", error);
      this.syncGlassUi();
    }
  }

  private reseedGlass(): void {
    const state = this.glass;
    if (state.uiBusy || !state.sessionOpen || state.previewFault || this.history().inconsistent) {
      return;
    }
    try {
      const preview = this.options.engine.reseedRasterGlass();
      this.syncGlassSettings(preview.settings);
      this.setGlassStatus("Glass texture refreshed…");
    } catch (error) {
      state.previewFault = true;
      this.reportGlassError("Glass texture refresh failed", error);
      this.syncGlassUi();
    }
  }

  private async cancelGlass(): Promise<void> {
    const state = this.glass;
    if (state.uiBusy) {
      state.cancelPending = true;
      return;
    }
    if (!state.sessionOpen) return;
    state.cancelPending = false;
    state.uiBusy = true;
    this.setGlassStatus("Restoring the original pixels…");
    this.syncGlassUi();
    try {
      await this.options.engine.cancelRasterGlass();
      state.sessionOpen = false;
      state.previewFault = false;
      this.closeGlass("cancel");
    } catch (error) {
      const history = this.options.engine.getHistoryState();
      this.options.onHistoryState(history);
      state.sessionOpen = history.openEdit === "glass";
      state.previewFault = true;
      this.reportGlassError("Glass cancellation failed", error);
    } finally {
      state.uiBusy = false;
      this.refreshHistory();
    }
  }

  private async applyGlass(): Promise<void> {
    const state = this.glass;
    if (state.uiBusy || !state.sessionOpen || state.previewFault || this.history().inconsistent) {
      return;
    }
    state.uiBusy = true;
    this.setGlassStatus("Applying Glass…");
    this.syncGlassUi();
    try {
      await this.options.engine.commitRasterGlass();
      state.sessionOpen = false;
      state.previewFault = false;
      this.closeGlass("apply");
      this.options.requestActiveThumbnail();
    } catch (error) {
      const history = this.options.engine.getHistoryState();
      this.options.onHistoryState(history);
      state.sessionOpen = history.openEdit === "glass";
      state.previewFault = state.sessionOpen;
      this.reportGlassError("Glass application failed", error);
      if (!state.sessionOpen) this.closeGlass("error");
    } finally {
      state.uiBusy = false;
      this.refreshHistory();
    }
  }

  private setCurvesStatus(message: string): void {
    this.options.elements.curves.status.textContent = message;
  }

  private reportCurvesError(prefix: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const fullMessage = `${prefix}: ${message}`;
    this.setCurvesStatus(fullMessage);
    this.setAppError(fullMessage);
  }

  private resetCurvesControls(): void {
    this.curvesEditor.setState(DEFAULT_RASTER_TONE_CURVE_SET);
    this.setCurvesStatus("Curves ready.");
  }

  private syncCurvesUi(): void {
    const state = this.curves;
    const elements = this.options.elements.curves;
    const eligibilityError = state.surfaceOpen || state.sessionOpen || state.uiBusy
      ? "Curves is already open."
      : this.adjustmentEligibilityError("curves");
    const recoveryOnly = state.previewFault || this.history().inconsistent;
    const controlsDisabled = state.uiBusy || !state.sessionOpen || recoveryOnly;
    elements.openButton.disabled = eligibilityError !== null;
    elements.openButton.title = eligibilityError ?? "Open Curves";
    elements.openButton.setAttribute("aria-pressed", String(state.surfaceOpen));
    this.curvesEditor.setDisabled(controlsDisabled);
    elements.applyButton.disabled = controlsDisabled;
    elements.cancelButton.disabled = state.uiBusy || !state.sessionOpen;
    elements.sheet.dataset.state = state.uiBusy
      ? "busy"
      : recoveryOnly
        ? "recovery"
        : state.sessionOpen
          ? "preview"
          : "closed";
    elements.sheet.setAttribute("aria-busy", String(state.uiBusy));
    this.options.elements.canvas.classList.toggle("raster-curves-active", state.surfaceOpen);
  }

  private closeCurves(result: AdjustmentResult): void {
    const state = this.curves;
    state.surfaceOpen = false;
    state.cancelPending = false;
    this.options.elements.curves.openButton.setAttribute("aria-pressed", "false");
    this.curvesSheet.close(false);
    this.restoreFocus(state);
    if (result !== "error") this.resetCurvesControls();
    this.syncUi();
  }

  private async beginCurves(
    trigger: HTMLElement,
    returnFocus: HTMLElement,
  ): Promise<void> {
    if (this.curves.uiBusy) return;
    const eligibilityError = this.adjustmentEligibilityError("curves");
    if (eligibilityError || this.curves.surfaceOpen) {
      if (eligibilityError) this.setAppError(eligibilityError);
      this.restoreCurvesRequestFocus(returnFocus);
      return;
    }
    const vectorLayerCount = this.options.engine.getStats().mixedScene?.items.filter(
      (item) => item.kind === "text" || item.kind === "svg",
    ).length ?? 0;
    if (vectorLayerCount > 0) {
      if (!this.options.confirmCurvesVectorRasterization(
        CURVES_VECTOR_RASTERIZATION_CONFIRMATION,
      )) {
        this.restoreCurvesRequestFocus(returnFocus);
        return;
      }
      const state = this.curves;
      state.uiBusy = true;
      this.options.elements.appStatus.textContent = "Rasterizing SVG and text layers…";
      this.options.elements.appStatus.className = "status";
      this.syncUi();
      try {
        const rasterizedCount = await this.options.rasterizeVectorLayersForCurves();
        if (rasterizedCount !== vectorLayerCount) {
          throw new Error(
            `Expected ${vectorLayerCount} vector layers but rasterized ${rasterizedCount}.`,
          );
        }
      } catch (error) {
        this.reportCurvesError("Unable to prepare Curves", error);
        this.restoreCurvesRequestFocus(returnFocus);
        return;
      } finally {
        state.uiBusy = false;
        this.refreshHistory();
        this.syncUi();
      }
      const preparedEligibilityError = this.adjustmentEligibilityError("curves");
      if (preparedEligibilityError) {
        this.setAppError(preparedEligibilityError);
        this.restoreCurvesRequestFocus(returnFocus);
        return;
      }
    }
    if (!this.curvesSheet.open(trigger)) {
      this.restoreCurvesRequestFocus(returnFocus);
      return;
    }
    const state = this.curves;
    state.surfaceOpen = true;
    state.returnFocus = returnFocus;
    state.sessionOpen = false;
    state.previewFault = false;
    state.uiBusy = true;
    this.curvesEditor.setState(DEFAULT_RASTER_TONE_CURVE_SET);
    this.setCurvesStatus("Preparing Curves…");
    this.syncUi();
    try {
      const preview = await this.options.engine.beginRasterToneCurves(
        DEFAULT_RASTER_TONE_CURVE_SET,
      );
      if (!preview) throw new Error("Select a raster layer to use Curves.");
      state.sessionOpen = true;
      this.curvesEditor.setState(preview.curves, preview.histogram);
      this.setCurvesStatus("Curves preview ready.");
    } catch (error) {
      const history = this.options.engine.getHistoryState();
      this.options.onHistoryState(history);
      state.sessionOpen = history.openEdit === "curves";
      state.previewFault = state.sessionOpen;
      this.reportCurvesError("Unable to open Curves", error);
      if (!state.sessionOpen) this.closeCurves("error");
    } finally {
      state.uiBusy = false;
      this.refreshHistory();
      this.syncUi();
      if ((state.cancelPending || this.disposed) && state.sessionOpen) {
        state.cancelPending = false;
        void this.cancelCurves();
      }
    }
  }

  private requestCurvesUpdate(curves: Readonly<RasterToneCurveSet>): void {
    const state = this.curves;
    if (state.uiBusy || !state.sessionOpen || state.previewFault || this.history().inconsistent) {
      return;
    }
    try {
      const preview = this.options.engine.updateRasterToneCurves(curves);
      this.curvesEditor.setState(preview.curves);
      this.setCurvesStatus("Curves preview updated…");
    } catch (error) {
      state.previewFault = true;
      this.reportCurvesError("Curves preview failed", error);
      this.syncCurvesUi();
    }
  }

  private async cancelCurves(): Promise<void> {
    const state = this.curves;
    if (state.uiBusy) {
      state.cancelPending = true;
      return;
    }
    if (!state.sessionOpen) return;
    state.cancelPending = false;
    state.uiBusy = true;
    this.setCurvesStatus("Restoring the original pixels…");
    this.syncCurvesUi();
    try {
      await this.options.engine.cancelRasterToneCurves();
      state.sessionOpen = false;
      state.previewFault = false;
      this.closeCurves("cancel");
    } catch (error) {
      const history = this.options.engine.getHistoryState();
      this.options.onHistoryState(history);
      state.sessionOpen = history.openEdit === "curves";
      state.previewFault = true;
      this.reportCurvesError("Curves cancellation failed", error);
    } finally {
      state.uiBusy = false;
      this.refreshHistory();
    }
  }

  private async applyCurves(): Promise<void> {
    const state = this.curves;
    if (state.uiBusy || !state.sessionOpen || state.previewFault || this.history().inconsistent) {
      return;
    }
    state.uiBusy = true;
    this.setCurvesStatus("Applying Curves…");
    this.syncCurvesUi();
    try {
      const changed = await this.options.engine.commitRasterToneCurves();
      state.sessionOpen = false;
      state.previewFault = false;
      this.closeCurves("apply");
      if (changed) this.options.requestActiveThumbnail();
    } catch (error) {
      const history = this.options.engine.getHistoryState();
      this.options.onHistoryState(history);
      state.sessionOpen = history.openEdit === "curves";
      state.previewFault = state.sessionOpen;
      this.reportCurvesError("Curves application failed", error);
      if (!state.sessionOpen) this.closeCurves("error");
    } finally {
      state.uiBusy = false;
      this.refreshHistory();
    }
  }

  private setColorAdjustStatus(message: string): void {
    this.options.elements.colorAdjust.status.textContent = message;
  }

  private reportColorAdjustError(prefix: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const fullMessage = `${prefix}: ${message}`;
    this.setColorAdjustStatus(fullMessage);
    this.setAppError(fullMessage);
  }

  private syncColorAdjustUi(): void {
    const state = this.colorAdjust;
    const elements = this.options.elements.colorAdjust;
    const eligibilityError = state.surfaceOpen || state.sessionOpen || state.uiBusy
      ? "Color Adjust is already open."
      : this.adjustmentEligibilityError("color-adjust");
    const recoveryOnly = state.previewFault || this.history().inconsistent;
    const controlsDisabled = state.uiBusy || !state.sessionOpen || recoveryOnly;
    elements.openButton.disabled = eligibilityError !== null;
    elements.openButton.title = eligibilityError ?? "Open Color Adjust";
    elements.openButton.setAttribute("aria-pressed", String(state.surfaceOpen));
    this.colorAdjustSurface.setDisabled(controlsDisabled);
    elements.surface.dataset.state = state.uiBusy
      ? "busy"
      : recoveryOnly
        ? "recovery"
        : state.sessionOpen
          ? "preview"
          : "closed";
  }

  private closeColorAdjust(
    result: AdjustmentResult,
    restoreRequestFocus = true,
  ): void {
    const state = this.colorAdjust;
    state.surfaceOpen = false;
    state.cancelPending = false;
    this.options.elements.colorAdjust.openButton.setAttribute("aria-pressed", "false");
    this.colorAdjustSurface.close();
    if (restoreRequestFocus) this.restoreFocus(state);
    else state.returnFocus = null;
    if (result !== "error") {
      this.colorAdjustSurface.setState(DEFAULT_RASTER_COLOR_ADJUST_SETTINGS);
      this.setColorAdjustStatus("Color Adjust ready.");
    }
    this.options.onSheetOpenChange(false);
    this.syncUi();
  }

  private async beginColorAdjust(
    returnFocus: HTMLElement,
  ): Promise<void> {
    if (this.colorAdjust.uiBusy) return;
    const eligibilityError = this.adjustmentEligibilityError("color-adjust");
    if (eligibilityError || this.colorAdjust.surfaceOpen) {
      if (eligibilityError) this.setAppError(eligibilityError);
      this.restoreCurvesRequestFocus(returnFocus);
      return;
    }
    this.options.beforeSheetOpen();
    if (!this.colorAdjustSurface.open(DEFAULT_RASTER_COLOR_ADJUST_SETTINGS)) {
      this.restoreCurvesRequestFocus(returnFocus);
      return;
    }
    const state = this.colorAdjust;
    state.surfaceOpen = true;
    state.returnFocus = returnFocus;
    state.sessionOpen = false;
    state.previewFault = false;
    state.uiBusy = true;
    this.setColorAdjustStatus("Preparing Color Adjust…");
    this.options.onSheetOpenChange(true);
    this.syncUi();
    try {
      const preview = await this.options.engine.beginRasterColorAdjust(
        DEFAULT_RASTER_COLOR_ADJUST_SETTINGS,
      );
      if (!preview) throw new Error("Select a raster layer to use Color Adjust.");
      state.sessionOpen = true;
      this.colorAdjustSurface.setState(preview.settings);
      this.setColorAdjustStatus("Color Adjust preview ready.");
    } catch (error) {
      const history = this.options.engine.getHistoryState();
      this.options.onHistoryState(history);
      state.sessionOpen = history.openEdit === "color-adjust";
      state.previewFault = state.sessionOpen;
      this.reportColorAdjustError("Unable to open Color Adjust", error);
      if (!state.sessionOpen) this.closeColorAdjust("error");
    } finally {
      state.uiBusy = false;
      this.refreshHistory();
      this.syncUi();
      if ((state.cancelPending || this.disposed) && state.sessionOpen) {
        state.cancelPending = false;
        void this.cancelColorAdjust();
      }
    }
  }

  private requestColorAdjustUpdate(
    settings: Readonly<RasterColorAdjustSettings>,
  ): void {
    const state = this.colorAdjust;
    if (state.uiBusy || !state.sessionOpen || state.previewFault || this.history().inconsistent) {
      return;
    }
    try {
      const preview = this.options.engine.updateRasterColorAdjust(settings);
      this.colorAdjustSurface.setState(preview.settings);
      this.setColorAdjustStatus("Color Adjust preview updated…");
    } catch (error) {
      state.previewFault = true;
      this.reportColorAdjustError("Color Adjust preview failed", error);
      this.syncColorAdjustUi();
    }
  }

  private resetColorAdjust(): void {
    if (!this.canAutoCommitColorAdjust()) return;
    this.colorAdjustSurface.reset();
    this.requestColorAdjustUpdate(DEFAULT_RASTER_COLOR_ADJUST_SETTINGS);
    this.setColorAdjustStatus("Color Adjust reset to neutral.");
  }

  private async cancelColorAdjust(): Promise<void> {
    const state = this.colorAdjust;
    if (state.uiBusy) {
      state.cancelPending = true;
      return;
    }
    if (!state.sessionOpen) {
      if (state.surfaceOpen) this.closeColorAdjust("cancel");
      return;
    }
    state.cancelPending = false;
    state.uiBusy = true;
    this.setColorAdjustStatus("Restoring the original pixels…");
    this.syncColorAdjustUi();
    try {
      await this.options.engine.cancelRasterColorAdjust();
      state.sessionOpen = false;
      state.previewFault = false;
      this.closeColorAdjust("cancel");
    } catch (error) {
      const history = this.options.engine.getHistoryState();
      this.options.onHistoryState(history);
      state.sessionOpen = history.openEdit === "color-adjust";
      state.previewFault = true;
      this.reportColorAdjustError("Color Adjust cancellation failed", error);
    } finally {
      state.uiBusy = false;
      this.refreshHistory();
      this.syncUi();
    }
  }

  private async commitColorAdjust(restoreRequestFocus = true): Promise<boolean> {
    const state = this.colorAdjust;
    if (
      state.uiBusy
      || !state.sessionOpen
      || state.previewFault
      || this.history().inconsistent
    ) return false;
    state.uiBusy = true;
    this.setColorAdjustStatus("Applying Color Adjust…");
    this.syncColorAdjustUi();
    try {
      const changed = await this.options.engine.commitRasterColorAdjust();
      state.sessionOpen = false;
      state.previewFault = false;
      if (changed) this.options.requestActiveThumbnail(0);
      this.closeColorAdjust("apply", restoreRequestFocus);
      return true;
    } catch (error) {
      const history = this.options.engine.getHistoryState();
      this.options.onHistoryState(history);
      state.sessionOpen = history.openEdit === "color-adjust";
      state.previewFault = state.sessionOpen;
      this.reportColorAdjustError("Color Adjust application failed", error);
      if (!state.sessionOpen) this.closeColorAdjust("error", restoreRequestFocus);
      return false;
    } finally {
      state.uiBusy = false;
      this.refreshHistory();
      this.syncUi();
    }
  }

  private setColorBalanceStatus(message: string): void {
    this.options.elements.colorBalance.status.textContent = message;
  }

  private reportColorBalanceError(prefix: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const fullMessage = `${prefix}: ${message}`;
    this.setColorBalanceStatus(fullMessage);
    this.setAppError(fullMessage);
  }

  private syncColorBalanceUi(): void {
    const state = this.colorBalance;
    const elements = this.options.elements.colorBalance;
    const eligibilityError = state.surfaceOpen || state.sessionOpen || state.uiBusy
      ? "Color Balance is already open."
      : this.adjustmentEligibilityError("color-balance");
    const recoveryOnly = state.previewFault || this.history().inconsistent;
    const controlsDisabled = state.uiBusy || !state.sessionOpen || recoveryOnly;
    elements.openButton.disabled = eligibilityError !== null;
    elements.openButton.title = eligibilityError ?? "Open Color Balance";
    elements.openButton.setAttribute("aria-pressed", String(state.surfaceOpen));
    this.colorBalanceSurface.setDisabled(controlsDisabled);
    elements.surface.dataset.state = state.uiBusy
      ? "busy"
      : recoveryOnly
        ? "recovery"
        : state.sessionOpen
          ? "preview"
          : "closed";
  }

  private closeColorBalance(
    result: AdjustmentResult,
    restoreRequestFocus = true,
  ): void {
    const state = this.colorBalance;
    state.surfaceOpen = false;
    state.cancelPending = false;
    this.options.elements.colorBalance.openButton.setAttribute("aria-pressed", "false");
    this.colorBalanceSurface.close();
    if (restoreRequestFocus) this.restoreFocus(state);
    else state.returnFocus = null;
    if (result !== "error") {
      this.colorBalanceSurface.setState(DEFAULT_RASTER_COLOR_BALANCE_SETTINGS);
      this.setColorBalanceStatus("Color Balance ready.");
    }
    this.options.onSheetOpenChange(false);
    this.syncUi();
  }

  private async beginColorBalance(returnFocus: HTMLElement): Promise<void> {
    if (this.colorBalance.uiBusy) return;
    const eligibilityError = this.adjustmentEligibilityError("color-balance");
    if (eligibilityError || this.colorBalance.surfaceOpen) {
      if (eligibilityError) this.setAppError(eligibilityError);
      this.restoreCurvesRequestFocus(returnFocus);
      return;
    }
    this.options.beforeSheetOpen();
    if (!this.colorBalanceSurface.open(DEFAULT_RASTER_COLOR_BALANCE_SETTINGS)) {
      this.restoreCurvesRequestFocus(returnFocus);
      return;
    }
    const state = this.colorBalance;
    state.surfaceOpen = true;
    state.returnFocus = returnFocus;
    state.sessionOpen = false;
    state.previewFault = false;
    state.uiBusy = true;
    this.setColorBalanceStatus("Preparing Color Balance…");
    this.options.onSheetOpenChange(true);
    this.syncUi();
    try {
      const preview = await this.options.engine.beginRasterColorBalance(
        DEFAULT_RASTER_COLOR_BALANCE_SETTINGS,
      );
      if (!preview) throw new Error("Select a raster layer to use Color Balance.");
      state.sessionOpen = true;
      this.colorBalanceSurface.setState(preview.settings);
      this.setColorBalanceStatus("Color Balance preview ready.");
    } catch (error) {
      const history = this.options.engine.getHistoryState();
      this.options.onHistoryState(history);
      state.sessionOpen = history.openEdit === "color-balance";
      state.previewFault = state.sessionOpen;
      this.reportColorBalanceError("Unable to open Color Balance", error);
      if (!state.sessionOpen) this.closeColorBalance("error");
    } finally {
      state.uiBusy = false;
      this.refreshHistory();
      this.syncUi();
      if ((state.cancelPending || this.disposed) && state.sessionOpen) {
        state.cancelPending = false;
        void this.cancelColorBalance();
      }
    }
  }

  private requestColorBalanceUpdate(
    settings: Readonly<RasterColorBalanceSettings>,
  ): void {
    const state = this.colorBalance;
    if (state.uiBusy || !state.sessionOpen || state.previewFault || this.history().inconsistent) {
      return;
    }
    try {
      const preview = this.options.engine.updateRasterColorBalance(settings);
      this.colorBalanceSurface.setState(preview.settings);
      this.setColorBalanceStatus("Color Balance preview updated…");
    } catch (error) {
      state.previewFault = true;
      this.reportColorBalanceError("Color Balance preview failed", error);
      this.syncColorBalanceUi();
    }
  }

  private resetColorBalance(): void {
    if (this.history().openEdit !== "color-balance" || !this.canAutoCommitActiveAdjustment()) return;
    this.colorBalanceSurface.reset();
    this.requestColorBalanceUpdate(DEFAULT_RASTER_COLOR_BALANCE_SETTINGS);
    this.setColorBalanceStatus("Color Balance reset to neutral.");
  }

  private async cancelColorBalance(): Promise<void> {
    const state = this.colorBalance;
    if (state.uiBusy) {
      state.cancelPending = true;
      return;
    }
    if (!state.sessionOpen) {
      if (state.surfaceOpen) this.closeColorBalance("cancel");
      return;
    }
    state.cancelPending = false;
    state.uiBusy = true;
    this.setColorBalanceStatus("Restoring the original pixels…");
    this.syncColorBalanceUi();
    try {
      await this.options.engine.cancelRasterColorBalance();
      state.sessionOpen = false;
      state.previewFault = false;
      this.closeColorBalance("cancel");
    } catch (error) {
      const history = this.options.engine.getHistoryState();
      this.options.onHistoryState(history);
      state.sessionOpen = history.openEdit === "color-balance";
      state.previewFault = true;
      this.reportColorBalanceError("Color Balance cancellation failed", error);
    } finally {
      state.uiBusy = false;
      this.refreshHistory();
      this.syncUi();
    }
  }

  private async commitColorBalance(restoreRequestFocus = true): Promise<boolean> {
    const state = this.colorBalance;
    if (
      state.uiBusy
      || !state.sessionOpen
      || state.previewFault
      || this.history().inconsistent
    ) return false;
    state.uiBusy = true;
    this.setColorBalanceStatus("Applying Color Balance…");
    this.syncColorBalanceUi();
    try {
      const changed = await this.options.engine.commitRasterColorBalance();
      state.sessionOpen = false;
      state.previewFault = false;
      if (changed) this.options.requestActiveThumbnail(0);
      this.closeColorBalance("apply", restoreRequestFocus);
      return true;
    } catch (error) {
      const history = this.options.engine.getHistoryState();
      this.options.onHistoryState(history);
      state.sessionOpen = history.openEdit === "color-balance";
      state.previewFault = state.sessionOpen;
      this.reportColorBalanceError("Color Balance application failed", error);
      if (!state.sessionOpen) this.closeColorBalance("error", restoreRequestFocus);
      return false;
    } finally {
      state.uiBusy = false;
      this.refreshHistory();
      this.syncUi();
    }
  }

  private setGradientMapStatus(message: string): void {
    this.options.elements.gradientMap.status.textContent = message;
  }

  private reportGradientMapError(prefix: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const fullMessage = `${prefix}: ${message}`;
    this.setGradientMapStatus(fullMessage);
    this.setAppError(fullMessage);
  }

  private syncGradientMapUi(): void {
    const state = this.gradientMap;
    const elements = this.options.elements.gradientMap;
    const eligibilityError = state.surfaceOpen || state.sessionOpen || state.uiBusy
      ? "Gradient Map is already open."
      : this.adjustmentEligibilityError("gradient-map");
    const recoveryOnly = state.previewFault || this.history().inconsistent;
    elements.openButton.disabled = eligibilityError !== null;
    elements.openButton.title = eligibilityError ?? "Open Gradient Map";
    elements.openButton.setAttribute("aria-pressed", String(state.surfaceOpen));
    const controlsDisabled = state.uiBusy || recoveryOnly;
    const cancellationAvailable = state.surfaceOpen && (
      !state.uiBusy
      || this.gradientMapPreparePromise !== null
      || recoveryOnly
    );
    this.gradientMapSurface.setDisabled(controlsDisabled, cancellationAvailable);
    elements.surface.dataset.state = state.uiBusy
      ? "busy"
      : recoveryOnly
        ? "recovery"
        : state.sessionOpen
          ? "preview"
          : state.surfaceOpen
            ? "chooser"
            : "closed";
  }

  private closeGradientMap(
    result: AdjustmentResult,
    restoreRequestFocus = true,
  ): void {
    const state = this.gradientMap;
    this.gradientMapGeneration += 1;
    this.gradientMapExitIntent = "none";
    state.surfaceOpen = false;
    state.cancelPending = false;
    this.options.elements.gradientMap.openButton.setAttribute("aria-pressed", "false");
    this.gradientMapSurface.close();
    if (restoreRequestFocus) this.restoreFocus(state);
    else state.returnFocus = null;
    if (result !== "error") this.setGradientMapStatus("Gradient Map ready.");
    this.options.onSheetOpenChange(false);
    this.syncUi();
  }

  private async beginGradientMap(returnFocus: HTMLElement): Promise<void> {
    if (this.gradientMap.uiBusy) return;
    const eligibilityError = this.adjustmentEligibilityError("gradient-map");
    if (eligibilityError || this.gradientMap.surfaceOpen) {
      if (eligibilityError) this.setAppError(eligibilityError);
      this.restoreCurvesRequestFocus(returnFocus);
      return;
    }
    // The chooser provides enough idle time to compile the small preview
    // pipeline before the first preset is selected. This never opens history
    // or mutates layer pixels, and beginRasterGradientMap reuses the promise.
    void this.options.engine.prewarmRasterGradientMapResources().catch(() => undefined);
    this.options.beforeSheetOpen();
    if (!this.gradientMapSurface.open()) {
      this.restoreCurvesRequestFocus(returnFocus);
      return;
    }
    const state = this.gradientMap;
    state.surfaceOpen = true;
    state.returnFocus = returnFocus;
    state.sessionOpen = false;
    state.previewFault = false;
    state.cancelPending = false;
    state.uiBusy = false;
    this.gradientMapGeneration += 1;
    this.gradientMapExitIntent = "none";
    this.setGradientMapStatus("Choose a gradient to start the live preview.");
    this.options.onSheetOpenChange(true);
    this.syncUi();
  }

  private requestGradientMapUpdate(
    settings: Readonly<RasterGradientMapSettings>,
    selectedPresetId: string | null,
  ): void {
    const state = this.gradientMap;
    if (
      state.uiBusy
      || !state.surfaceOpen
      || state.previewFault
      || this.history().inconsistent
    ) return;
    if (!state.sessionOpen) {
      const stats = this.options.engine.getStats();
      const selected = stats.mixedScene?.items.find(
        (item) => item.key === stats.mixedScene?.selectedKey,
      );
      const vectorTarget = selected?.kind === "text" || selected?.kind === "svg";
      if (
        vectorTarget
        && !this.options.confirmGradientMapVectorRasterization(
          GRADIENT_MAP_VECTOR_RASTERIZATION_CONFIRMATION,
        )
      ) {
        this.gradientMapSurface.showChooser();
        this.setGradientMapStatus("Choose a gradient when you are ready.");
        return;
      }
      const generation = this.gradientMapGeneration;
      const preparation = Promise.resolve().then(() => this.beginGradientMapPreview(
        settings,
        selectedPresetId,
        vectorTarget,
        generation,
      ));
      this.gradientMapPreparePromise = preparation;
      void preparation.finally(() => {
        if (this.gradientMapPreparePromise === preparation) {
          this.gradientMapPreparePromise = null;
        }
      });
      return;
    }
    try {
      this.options.engine.updateRasterGradientMap(settings);
      this.setGradientMapStatus("Gradient Map preview updated…");
    } catch (error) {
      state.previewFault = true;
      this.reportGradientMapError("Gradient Map preview failed", error);
      this.syncGradientMapUi();
    }
  }

  private gradientMapShouldCancelPreparation(): boolean {
    return this.gradientMapExitIntent === "cancel" || this.disposed;
  }

  private async beginGradientMapPreview(
    settings: Readonly<RasterGradientMapSettings>,
    selectedPresetId: string | null,
    rasterizeSelectedVector: boolean,
    generation: number,
  ): Promise<boolean> {
    const state = this.gradientMap;
    if (state.uiBusy || state.sessionOpen || !state.surfaceOpen) return false;
    state.uiBusy = true;
    this.gradientMapExitIntent = "none";
    this.setGradientMapStatus(
      rasterizeSelectedVector
        ? "Rasterizing the selected layer…"
        : "Preparing Gradient Map…",
    );
    this.syncGradientMapUi();
    try {
      if (rasterizeSelectedVector) {
        const rasterized = await this.options.rasterizeSelectedVectorLayerForGradientMap();
        if (generation !== this.gradientMapGeneration || !state.surfaceOpen) return true;
        const preparedStats = this.options.engine.getStats();
        const preparedSelected = preparedStats.mixedScene?.items.find(
          (item) => item.key === preparedStats.mixedScene?.selectedKey,
        );
        if (
          preparedStats.mixedScene?.selectedKey !== rasterized.outputKey
          || preparedSelected?.kind !== "raster"
          || preparedSelected.rasterLayerId !== preparedStats.activeLayerId
        ) {
          throw new Error("The rasterized layer is no longer the selected raster.");
        }
      }
      if (generation !== this.gradientMapGeneration || !state.surfaceOpen) return true;
      if (this.gradientMapShouldCancelPreparation()) {
        this.closeGradientMap("cancel");
        return true;
      }
      this.setGradientMapStatus("Preparing Gradient Map…");
      const preview = await this.options.engine.beginRasterGradientMap(settings);
      if (!preview) throw new Error("Select a raster layer to use Gradient Map.");
      if (generation !== this.gradientMapGeneration || !state.surfaceOpen) {
        await this.options.engine.cancelRasterGradientMap();
        return true;
      }
      state.sessionOpen = true;
      this.gradientMapSurface.setState(preview.settings, selectedPresetId);
      this.setGradientMapStatus("Gradient Map preview ready.");
      return true;
    } catch (error) {
      if (generation !== this.gradientMapGeneration) return true;
      const history = this.options.engine.getHistoryState();
      this.options.onHistoryState(history);
      state.sessionOpen = history.openEdit === "gradient-map";
      state.previewFault = state.sessionOpen;
      this.reportGradientMapError("Unable to open Gradient Map", error);
      if (!state.sessionOpen) this.closeGradientMap("error");
      return false;
    } finally {
      state.uiBusy = false;
      this.refreshHistory();
      this.syncUi();
    }
  }

  private resetGradientMap(): void {
    if (!this.gradientMap.sessionOpen || !this.canAutoCommitActiveAdjustment()) return;
    this.gradientMapSurface.reset();
    const settings = this.gradientMapSurface.state;
    if (settings) this.requestGradientMapUpdate(settings, this.gradientMapSurface.activePresetId);
    this.setGradientMapStatus("Gradient Map reset to the chosen preset.");
  }

  private async cancelGradientMap(): Promise<void> {
    const state = this.gradientMap;
    if (this.gradientMapPreparePromise) {
      this.gradientMapExitIntent = "cancel";
      await this.gradientMapPreparePromise;
      if (!state.surfaceOpen) return;
    }
    if (state.uiBusy) {
      state.cancelPending = true;
      return;
    }
    if (!state.sessionOpen) {
      if (state.surfaceOpen) this.closeGradientMap("cancel");
      return;
    }
    state.cancelPending = false;
    state.uiBusy = true;
    this.setGradientMapStatus("Restoring the original pixels…");
    this.syncGradientMapUi();
    try {
      await this.options.engine.cancelRasterGradientMap();
      state.sessionOpen = false;
      state.previewFault = false;
      this.closeGradientMap("cancel");
    } catch (error) {
      const history = this.options.engine.getHistoryState();
      this.options.onHistoryState(history);
      state.sessionOpen = history.openEdit === "gradient-map";
      state.previewFault = true;
      this.reportGradientMapError("Gradient Map cancellation failed", error);
    } finally {
      state.uiBusy = false;
      this.refreshHistory();
      this.syncUi();
    }
  }

  private async commitGradientMap(restoreRequestFocus = true): Promise<boolean> {
    const state = this.gradientMap;
    if (
      state.uiBusy
      || !state.sessionOpen
      || state.previewFault
      || this.history().inconsistent
    ) return false;
    state.uiBusy = true;
    this.setGradientMapStatus("Applying Gradient Map…");
    this.syncGradientMapUi();
    try {
      const changed = await this.options.engine.commitRasterGradientMap();
      state.sessionOpen = false;
      state.previewFault = false;
      if (changed) this.options.requestActiveThumbnail(0);
      this.closeGradientMap("apply", restoreRequestFocus);
      return true;
    } catch (error) {
      const history = this.options.engine.getHistoryState();
      this.options.onHistoryState(history);
      state.sessionOpen = history.openEdit === "gradient-map";
      state.previewFault = state.sessionOpen;
      this.reportGradientMapError("Gradient Map application failed", error);
      if (!state.sessionOpen) this.closeGradientMap("error", restoreRequestFocus);
      return false;
    } finally {
      state.uiBusy = false;
      this.refreshHistory();
      this.syncUi();
    }
  }
}
