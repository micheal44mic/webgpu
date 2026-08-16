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
import { MobileLiquifySheetController } from "./mobile-liquify-sheet";
import { MobileMotionBlurSheetController } from "./mobile-motion-blur-sheet";
import { MobileNoiseSheetController } from "./mobile-noise-sheet";
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
import type { CanvasInputTool } from "./canvas-input-controller";
import type { DestructiveRasterAdjustmentKind } from "./raster-effects-contract.ts";

export type RasterAdjustmentsEnginePort = Pick<
  BrushEngine,
  | "beginRasterGaussianBlur"
  | "beginRasterLiquify"
  | "beginRasterMotionBlur"
  | "beginRasterNoise"
  | "cancelRasterGaussianBlur"
  | "cancelRasterLiquify"
  | "cancelRasterMotionBlur"
  | "cancelRasterNoise"
  | "commitRasterGaussianBlur"
  | "commitRasterLiquify"
  | "commitRasterMotionBlur"
  | "commitRasterNoise"
  | "endRasterLiquifyStroke"
  | "getHistoryState"
  | "getPixelSelectionState"
  | "getStats"
  | "resetRasterLiquify"
  | "setRasterLiquifyAmount"
  | "updateRasterGaussianBlur"
  | "updateRasterLiquifySettings"
  | "updateRasterMotionBlur"
  | "updateRasterNoise"
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

export interface RasterAdjustmentsElements {
  readonly canvas: HTMLCanvasElement;
  readonly appStatus: HTMLParagraphElement;
  readonly liquify: LiquifyAdjustmentElements;
  readonly gaussianBlur: GaussianBlurAdjustmentElements;
  readonly motionBlur: MotionBlurAdjustmentElements;
  readonly noise: NoiseAdjustmentElements;
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
  readonly getActiveCanvasTool: () => CanvasInputTool;
  readonly getActiveBrushTool: () => BrushTool;
  readonly configureCanvasTool: (
    tool: CanvasInputTool,
    restoreSnapshot: boolean,
  ) => void;
  readonly beforeSheetOpen: () => void;
  readonly onSheetOpenChange: (open: boolean) => void;
  readonly updateHistoryControls: () => void;
  readonly requestActiveThumbnail: (delayMs?: number) => void;
}

export interface RasterAdjustmentsDiagnostics {
  readonly rasterGaussianBlurUiBusy: boolean;
  readonly rasterMotionBlurUiBusy: boolean;
  readonly rasterNoiseUiBusy: boolean;
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

function formatNoisePeriod(period: number): string {
  if (period >= 100) return period.toFixed(0);
  if (period >= 10) return period.toFixed(1).replace(/\.0$/, "");
  return period.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

/**
 * Owns the four destructive raster-adjustment transactions and their sheets.
 * The engine remains authoritative for preview pixels and history; this class
 * owns mutual exclusion, recovery UI, focus restoration and commit/cancel.
 */
export class RasterAdjustmentsController {
  private readonly abortController: AbortController;
  private readonly liquifySheet: MobileLiquifySheetController;
  private readonly gaussianBlurSheet: MobileGaussianBlurSheetController;
  private readonly motionBlurSheet: MobileMotionBlurSheetController;
  private readonly noiseSheet: MobileNoiseSheetController;
  private readonly liquify = initialTransactionState();
  private readonly gaussianBlur = initialTransactionState();
  private readonly motionBlur = initialTransactionState();
  private readonly noise = initialTransactionState();
  private liquifySettings: LiquifySettings = { ...DEFAULT_LIQUIFY_SETTINGS };
  private liquifyAmount = 1;
  private liquifyReturnTool: CanvasInputTool | null = null;
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
    this.configureControlRanges();
    this.syncLiquifySettings(this.liquifySettings, this.liquifyAmount);
    this.syncNoiseSettings(DEFAULT_RASTER_NOISE_SETTINGS);
    this.bindEvents();
    this.syncUi();
  }

  get isAnySurfaceOpen(): boolean {
    return this.states().some((state) => state.surfaceOpen);
  }

  get isAnySheetOpen(): boolean {
    return this.liquifySheet.isOpen
      || this.gaussianBlurSheet.isOpen
      || this.motionBlurSheet.isOpen
      || this.noiseSheet.isOpen;
  }

  isOpen(kind: DestructiveRasterAdjustmentKind): boolean {
    return this.state(kind).surfaceOpen;
  }

  hasActiveHistoryEdit(history = this.options.getHistoryState()): boolean {
    return history.openEdit === "liquify"
      || history.openEdit === "gaussian-blur"
      || history.openEdit === "motion-blur"
      || history.openEdit === "noise";
  }

  isLiquifyEditActive(history = this.options.getHistoryState()): boolean {
    return this.liquify.sessionOpen && history.openEdit === "liquify";
  }

  isDestructivePreviewNavigationActive(
    history = this.options.getHistoryState(),
  ): boolean {
    return (this.gaussianBlur.sessionOpen && history.openEdit === "gaussian-blur")
      || (this.motionBlur.sessionOpen && history.openEdit === "motion-blur")
      || (this.noise.sessionOpen && history.openEdit === "noise");
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
      this.motionBlur.sessionOpen
        && history.openEdit === "motion-blur"
        && !this.motionBlur.uiBusy
    ) || (
      this.noise.sessionOpen
        && history.openEdit === "noise"
        && !this.noise.uiBusy
    );
  }

  diagnostics(): RasterAdjustmentsDiagnostics {
    return {
      rasterGaussianBlurUiBusy: this.gaussianBlur.uiBusy,
      rasterMotionBlurUiBusy: this.motionBlur.uiBusy,
      rasterNoiseUiBusy: this.noise.uiBusy,
      rasterLiquifyUiBusy: this.liquify.uiBusy,
    };
  }

  handleEngineStatus(message: string, kind: "working" | "ok" | "error"): void {
    if (this.gaussianBlur.sessionOpen && message.includes("Gaussian Blur")) {
      this.setGaussianBlurStatus(message);
      if (kind === "error") this.gaussianBlur.previewFault = true;
      this.syncGaussianBlurUi();
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
    if (this.liquify.sessionOpen && message.includes("Liquify")) {
      this.setLiquifyStatus(message);
      if (kind === "error") this.liquify.previewFault = true;
      this.syncLiquifyUi();
    }
  }

  syncUi(): void {
    this.syncLiquifyUi();
    this.syncGaussianBlurUi();
    this.syncMotionBlurUi();
    this.syncNoiseUi();
  }

  handleResize(): void {
    this.liquifySheet.handleResize();
    this.gaussianBlurSheet.handleResize();
    this.motionBlurSheet.handleResize();
    this.noiseSheet.handleResize();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortController.abort();
    this.liquifySheet.dispose();
    this.gaussianBlurSheet.dispose();
    this.motionBlurSheet.dispose();
    this.noiseSheet.dispose();
    this.options.elements.canvas.classList.remove("liquify-active", "liquify-deforming");
    void this.cancelLiquify();
    void this.cancelGaussianBlur();
    void this.cancelMotionBlur();
    void this.cancelNoise();
  }

  private states(): readonly AdjustmentTransactionState[] {
    return [this.liquify, this.gaussianBlur, this.motionBlur, this.noise];
  }

  private state(kind: DestructiveRasterAdjustmentKind): AdjustmentTransactionState {
    if (kind === "liquify") return this.liquify;
    if (kind === "gaussian-blur") return this.gaussianBlur;
    if (kind === "motion-blur") return this.motionBlur;
    return this.noise;
  }

  private configureControlRanges(): void {
    const { gaussianBlur, motionBlur, noise } = this.options.elements;
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
  }

  private bindEvents(): void {
    const signal = this.abortController.signal;
    const { liquify, gaussianBlur, motionBlur, noise } = this.options.elements;
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
      : kind === "motion-blur"
        ? "Motion Blur"
        : kind === "noise"
          ? "Noise"
          : "Liquify";
    if (!this.options.isEngineReady()) {
      return `${label} sarà disponibile dopo l’inizializzazione.`;
    }
    for (const otherKind of [
      "liquify",
      "gaussian-blur",
      "motion-blur",
      "noise",
    ] as const) {
      if (otherKind === kind || !this.state(otherKind).surfaceOpen) continue;
      const otherLabel = otherKind === "gaussian-blur"
        ? "Gaussian Blur"
        : otherKind === "motion-blur"
          ? "Motion Blur"
          : otherKind === "noise"
            ? "Noise"
            : "Liquify";
      return `Applica o annulla ${otherLabel} prima.`;
    }
    if (this.options.engine.getPixelSelectionState().selectedPixels > 0) {
      if (kind === "noise") {
        return "Deseleziona i pixel per applicare Noise all'intero livello.";
      }
      if (kind === "liquify") {
        return "Deseleziona i pixel per deformare l’intero livello.";
      }
      return "Deseleziona i pixel per sfocare l’intero livello.";
    }
    const stats = this.options.engine.getStats();
    const active = stats.layers.find((layer) => layer.id === stats.activeLayerId);
    if (!active?.hasContent) return "Il livello raster selezionato è vuoto.";
    const selected = stats.mixedScene?.items.find(
      (item) => item.key === stats.mixedScene?.selectedKey,
    );
    const wrongRasterTarget = kind === "liquify"
      ? selected?.kind !== "raster" || selected.rasterLayerId !== stats.activeLayerId
      : selected !== undefined
        && (selected.kind !== "raster" || selected.rasterLayerId !== stats.activeLayerId);
    if (wrongRasterTarget) {
      return `Seleziona un livello raster per usare ${label}.`;
    }
    if (this.options.isSceneBusy() || this.options.isInteractionLocked()) {
      return `Termina l’operazione corrente prima di aprire ${label}.`;
    }
    return null;
  }

  private restoreFocus(state: AdjustmentTransactionState): void {
    const returnFocus = state.returnFocus;
    state.returnFocus = null;
    if (!returnFocus?.isConnected || this.disposed) return;
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
      ? "Liquify è già aperto."
      : this.adjustmentEligibilityError("liquify");
    const recoveryOnly = state.previewFault || this.history().inconsistent;
    const controlsDisabled = state.uiBusy || !state.sessionOpen || recoveryOnly;
    const modeControls = liquifyModeControls(this.liquifySettings.mode);
    elements.openButton.disabled = eligibilityError !== null;
    elements.openButton.title = eligibilityError ?? "Apri Liquify";
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
    if (result !== "error") this.setLiquifyStatus("Liquify pronto.");
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
    this.setLiquifyStatus("Preparazione Liquify…");
    this.syncUi();
    try {
      const preview = await this.options.engine.beginRasterLiquify(this.liquifySettingsFromUi());
      if (!preview) throw new Error("Seleziona un livello raster per usare Liquify.");
      state.sessionOpen = true;
      this.syncLiquifySettings(preview.settings, preview.amount);
      this.options.configureCanvasTool("liquify", false);
      this.setLiquifyStatus(
        `${LIQUIFY_MODE_LABELS[preview.settings.mode]} · trascina sul canvas.`,
      );
    } catch (error) {
      const history = this.options.engine.getHistoryState();
      this.options.onHistoryState(history);
      state.sessionOpen = history.openEdit === "liquify";
      state.previewFault = state.sessionOpen;
      this.reportLiquifyError("Impossibile aprire Liquify", error);
      if (!state.sessionOpen) this.closeLiquify("error");
    } finally {
      state.uiBusy = false;
      this.refreshHistory();
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
      this.setLiquifyStatus(`${LIQUIFY_MODE_LABELS[preview.settings.mode]} attivo.`);
    } catch (error) {
      state.previewFault = true;
      this.reportLiquifyError("Anteprima Liquify interrotta", error);
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
      this.reportLiquifyError("Adjust Amount interrotto", error);
    }
    this.syncLiquifyUi();
  }

  private async resetLiquify(): Promise<void> {
    const state = this.liquify;
    if (state.uiBusy || !state.sessionOpen || this.history().inconsistent) return;
    state.uiBusy = true;
    this.setLiquifyStatus("Ripristino della deformazione…");
    this.syncLiquifyUi();
    try {
      await this.options.engine.resetRasterLiquify();
      state.previewFault = false;
      this.setLiquifyStatus("Deformazione azzerata; Liquify resta attivo.");
    } catch (error) {
      this.options.onHistoryState(this.options.engine.getHistoryState());
      state.previewFault = true;
      this.reportLiquifyError("Reset Liquify non riuscito", error);
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
    this.setLiquifyStatus("Ripristino dei pixel originali…");
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
      this.reportLiquifyError("Annullamento Liquify non riuscito", error);
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
    this.setLiquifyStatus("Applicazione Liquify…");
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
      this.reportLiquifyError("Applicazione Liquify non riuscita", error);
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
    this.setGaussianBlurStatus("Gaussian Blur pronto.");
  }

  private syncGaussianBlurUi(): void {
    const state = this.gaussianBlur;
    const elements = this.options.elements.gaussianBlur;
    const eligibilityError = state.surfaceOpen || state.sessionOpen || state.uiBusy
      ? "Gaussian Blur è già aperto."
      : this.adjustmentEligibilityError("gaussian-blur");
    const recoveryOnly = state.previewFault || this.history().inconsistent;
    const controlsDisabled = state.uiBusy || !state.sessionOpen || recoveryOnly;
    elements.openButton.disabled = eligibilityError !== null;
    elements.openButton.title = eligibilityError ?? "Apri Gaussian Blur";
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
    this.setGaussianBlurStatus("Preparazione Gaussian Blur…");
    this.syncUi();
    try {
      const preview = await this.options.engine.beginRasterGaussianBlur(
        Number(this.options.elements.gaussianBlur.radiusInput.value),
      );
      if (!preview) throw new Error("Seleziona un livello raster per usare Gaussian Blur.");
      state.sessionOpen = true;
      this.setGaussianBlurRadius(preview.radius);
      this.setGaussianBlurStatus(`Raggio ${preview.radius.toFixed(0)} pixel.`);
    } catch (error) {
      const history = this.options.engine.getHistoryState();
      this.options.onHistoryState(history);
      state.sessionOpen = history.openEdit === "gaussian-blur";
      state.previewFault = state.sessionOpen;
      this.reportGaussianBlurError("Impossibile aprire Gaussian Blur", error);
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
      this.setGaussianBlurStatus(`Raggio ${preview.radius.toFixed(0)} pixel.`);
    } catch (error) {
      state.previewFault = true;
      this.reportGaussianBlurError("Anteprima Gaussian Blur interrotta", error);
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
    this.setGaussianBlurStatus("Ripristino dei pixel originali…");
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
      this.reportGaussianBlurError("Annullamento Gaussian Blur non riuscito", error);
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
    this.setGaussianBlurStatus("Applicazione Gaussian Blur…");
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
      this.reportGaussianBlurError("Applicazione Gaussian Blur non riuscita", error);
      if (!state.sessionOpen) this.closeGaussianBlur("error");
    } finally {
      state.uiBusy = false;
      this.refreshHistory();
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
    this.setMotionBlurStatus("Motion Blur pronto.");
  }

  private syncMotionBlurUi(): void {
    const state = this.motionBlur;
    const elements = this.options.elements.motionBlur;
    const eligibilityError = state.surfaceOpen || state.sessionOpen || state.uiBusy
      ? "Motion Blur è già aperto."
      : this.adjustmentEligibilityError("motion-blur");
    const recoveryOnly = state.previewFault || this.history().inconsistent;
    const controlsDisabled = state.uiBusy || !state.sessionOpen || recoveryOnly;
    elements.openButton.disabled = eligibilityError !== null;
    elements.openButton.title = eligibilityError ?? "Apri Motion Blur";
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
    this.setMotionBlurStatus("Preparazione Motion Blur…");
    this.syncUi();
    const elements = this.options.elements.motionBlur;
    try {
      const preview = await this.options.engine.beginRasterMotionBlur(
        Number(elements.distanceInput.value),
        Number(elements.angleInput.value),
      );
      if (!preview) throw new Error("Seleziona un livello raster per usare Motion Blur.");
      state.sessionOpen = true;
      this.setMotionBlurDistance(preview.distance);
      this.setMotionBlurAngle(preview.angle);
      this.setMotionBlurStatus(
        `Distanza ${preview.distance.toFixed(0)} pixel · Angolo ${preview.angle.toFixed(0)}°.`,
      );
    } catch (error) {
      const history = this.options.engine.getHistoryState();
      this.options.onHistoryState(history);
      state.sessionOpen = history.openEdit === "motion-blur";
      state.previewFault = state.sessionOpen;
      this.reportMotionBlurError("Impossibile aprire Motion Blur", error);
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
        `Distanza ${preview.distance.toFixed(0)} pixel · Angolo ${preview.angle.toFixed(0)}°.`,
      );
    } catch (error) {
      state.previewFault = true;
      this.reportMotionBlurError("Anteprima Motion Blur interrotta", error);
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
    this.setMotionBlurStatus("Ripristino dei pixel originali…");
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
      this.reportMotionBlurError("Annullamento Motion Blur non riuscito", error);
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
    this.setMotionBlurStatus("Applicazione Motion Blur…");
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
      this.reportMotionBlurError("Applicazione Motion Blur non riuscita", error);
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
    elements.scaleOutput.value = `${Math.round(settings.scalePercent)}% · ${formatNoisePeriod(period)} px`;
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
    this.setNoiseStatus("Noise pronto.");
  }

  private syncNoiseUi(): void {
    const state = this.noise;
    const elements = this.options.elements.noise;
    const eligibilityError = state.surfaceOpen || state.sessionOpen || state.uiBusy
      ? "Noise è già aperto."
      : this.adjustmentEligibilityError("noise");
    const recoveryOnly = state.previewFault || this.history().inconsistent;
    const controlsDisabled = state.uiBusy || !state.sessionOpen || recoveryOnly;
    elements.openButton.disabled = eligibilityError !== null;
    elements.openButton.title = eligibilityError ?? "Apri Noise";
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
    this.setNoiseStatus("Preparazione Noise…");
    this.syncUi();
    try {
      const preview = await this.options.engine.beginRasterNoise(initial);
      if (!preview) throw new Error("Seleziona un livello raster per usare Noise.");
      state.sessionOpen = true;
      this.syncNoiseSettings(preview.settings);
      this.setNoiseStatus(
        `Quantità ${preview.settings.amountPercent.toFixed(0)}% · `
        + `${preview.settings.style} · ${preview.settings.channels}.`,
      );
    } catch (error) {
      const history = this.options.engine.getHistoryState();
      this.options.onHistoryState(history);
      state.sessionOpen = history.openEdit === "noise";
      state.previewFault = state.sessionOpen;
      this.reportNoiseError("Impossibile aprire Noise", error);
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
      this.setNoiseStatus(`Anteprima Noise ${preview.settings.amountPercent.toFixed(0)}%…`);
    } catch (error) {
      state.previewFault = true;
      this.reportNoiseError("Anteprima Noise non riuscita", error);
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
    this.setNoiseStatus("Ripristino dei pixel originali…");
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
      this.reportNoiseError("Annullamento Noise non riuscito", error);
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
    this.setNoiseStatus("Applicazione Noise…");
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
      this.reportNoiseError("Applicazione Noise non riuscita", error);
      if (!state.sessionOpen) this.closeNoise("error");
    } finally {
      state.uiBusy = false;
      this.refreshHistory();
    }
  }
}
