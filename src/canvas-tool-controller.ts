import type { BrushEngine } from "./brush-engine";
import type { BrushSettings } from "./engine-types";
import type { MobileTextWarpMode, MobileToolSettingsKind } from "./mobile-tool-settings-sheet";
import type { SelectionCombineMode, SelectionMethod } from "./selection-core";
import type { CanvasInputTool } from "./canvas-input-controller";

export type CanvasToolEnginePort = Pick<
  BrushEngine,
  "fillToolSelected" | "setFillToolSelected" | "setSelectionToolSelected"
>;

export interface CanvasToolBrushSettingsPort {
  snapshot(): BrushSettings;
  selectTool(tool: BrushSettings["tool"], restoreSnapshot: boolean): BrushSettings;
}

export interface CanvasToolSelectionSettingsPort {
  selectionSnapshot(): { readonly method: SelectionMethod };
  setSelectionMethod(method: SelectionMethod): unknown;
  setSelectionCombineMode(mode: SelectionCombineMode): unknown;
}

export interface CanvasToolVectorPort {
  setTransformToolActive(active: boolean): void;
  isSelectedTextDistortEditing(): boolean;
  startSelectedTextDistortEditing(): boolean;
  stopSelectedTextDistortEditing(): void;
  setSelectedTextTransform(mode: MobileTextWarpMode): void;
  applyTransform(): Promise<boolean>;
  resetSelectedText(): void;
  deleteSelectedText(): void;
  rasterizeSelectedTextNode(): void;
}

export interface CanvasToolControllerOptions {
  readonly engine: CanvasToolEnginePort;
  readonly browser: Window & { readonly AbortController: typeof AbortController };
  readonly elements: {
    readonly canvas: HTMLCanvasElement;
    readonly paintButton: HTMLButtonElement;
    readonly eraserButton: HTMLButtonElement;
    readonly blendButton: HTMLButtonElement;
    readonly panButton: HTMLButtonElement;
  };
  readonly brushSettings: CanvasToolBrushSettingsPort;
  readonly selectionSettings: CanvasToolSelectionSettingsPort;
  readonly isEngineReady: () => boolean;
  readonly isInteractionLocked: () => boolean;
  readonly closeBrushStudioForTool: (tool: CanvasInputTool) => void;
  readonly closeToolSettingsForTool: (
    tool: CanvasInputTool,
    preserveToolSettings: boolean,
  ) => void;
  readonly closeBrushLibraryForTool: (tool: CanvasInputTool) => void;
  readonly syncBrushLibraryButton: () => void;
  readonly toggleBrushLibrary: () => void;
  readonly cancelKeyboardSelectionGesture: (hideCursor: boolean) => void;
  readonly getVectorController: () => CanvasToolVectorPort | null;
  readonly getOpenToolSettingsKind: () => MobileToolSettingsKind | null;
  readonly syncMenuState: () => void;
  readonly syncBrushSettings: (settings: BrushSettings) => void;
  readonly syncQuickControls: () => void;
  readonly syncToolSettings: () => void;
  readonly updateHistoryControls: () => void;
}

/** Owns active canvas/brush tool state and all transitions between tools. */
export class CanvasToolController {
  private readonly abortController: AbortController;
  private activeCanvasTool: CanvasInputTool = "paint";
  private activeBrushTool: BrushSettings["tool"] = "paint";
  private textDistortReturnTool: CanvasInputTool | null = null;
  private configurationRevision = 0;
  private disposed = false;

  constructor(private readonly options: CanvasToolControllerOptions) {
    this.abortController = new options.browser.AbortController();
    const signal = this.abortController.signal;
    options.elements.paintButton.addEventListener("click", () => {
      if (this.activeCanvasTool === "paint") {
        options.toggleBrushLibrary();
        return;
      }
      this.select("paint");
    }, { signal });
    options.elements.eraserButton.addEventListener("click", () => {
      this.select("erase");
    }, { signal });
    options.elements.blendButton.addEventListener("click", () => {
      this.select("blend");
    }, { signal });
    options.elements.panButton.addEventListener("click", () => {
      this.select("pan");
    }, { signal });
  }

  get activeTool(): CanvasInputTool {
    return this.activeCanvasTool;
  }

  get activeBrush(): BrushSettings["tool"] {
    return this.activeBrushTool;
  }

  get selectionMethod(): SelectionMethod {
    return this.options.selectionSettings.selectionSnapshot().method;
  }

  setSelectionCombineMode(mode: SelectionCombineMode): void {
    this.options.selectionSettings.setSelectionCombineMode(mode);
    this.options.syncToolSettings();
  }

  setSelectionMethod(method: SelectionMethod): void {
    this.options.cancelKeyboardSelectionGesture(false);
    this.options.selectionSettings.setSelectionMethod(method);
    this.syncSelectionKeyboardUi();
    if (this.activeCanvasTool === "selection" && this.options.isEngineReady()) {
      this.configure("selection", false, true);
    }
  }

  select(tool: CanvasInputTool, preserveToolSettings = false): boolean {
    if (this.disposed || this.options.isInteractionLocked()) return false;
    this.configure(tool, true, preserveToolSettings);
    this.options.updateHistoryControls();
    return true;
  }

  configure(
    tool: CanvasInputTool,
    restoreSnapshot: boolean,
    preserveToolSettings = false,
  ): void {
    if (this.disposed) return;
    const configurationRevision = ++this.configurationRevision;
    const previousBrushTool = this.activeBrushTool;
    this.options.closeBrushStudioForTool(tool);
    this.options.closeToolSettingsForTool(tool, preserveToolSettings);
    this.activeCanvasTool = tool;
    this.options.closeBrushLibraryForTool(tool);
    this.options.elements.paintButton.setAttribute("aria-pressed", String(tool === "paint"));
    this.options.elements.eraserButton.setAttribute("aria-pressed", String(tool === "erase"));
    this.options.elements.blendButton.setAttribute("aria-pressed", String(tool === "blend"));
    this.options.elements.panButton.setAttribute("aria-pressed", String(tool === "pan"));
    this.options.elements.canvas.setAttribute("data-active-canvas-tool", tool);
    this.options.syncBrushLibraryButton();
    this.options.syncMenuState();
    const fill = tool === "fill";
    const pan = tool === "pan";
    const selection = tool === "selection";
    const transform = tool === "transform";
    const liquify = tool === "liquify";
    if (!selection) this.options.cancelKeyboardSelectionGesture(true);
    if (!fill && !pan && !selection && !transform && !liquify) {
      this.activeBrushTool = tool;
      this.options.brushSettings.selectTool(
        tool,
        restoreSnapshot && previousBrushTool !== tool,
      );
    }
    this.syncSelectionKeyboardUi();
    this.options.getVectorController()?.setTransformToolActive(transform);
    this.options.syncBrushSettings(this.options.brushSettings.snapshot());
    this.options.syncQuickControls();
    if (!this.options.isEngineReady()) return;
    const method = this.selectionMethod;
    void this.configureEngineToolSelection(
      tool,
      fill,
      selection,
      method,
      configurationRevision,
    );
  }

  toggleTextDistortEditing(): boolean {
    const controller = this.options.getVectorController();
    if (!controller) return false;
    if (!controller.isSelectedTextDistortEditing()) return this.startTextDistortEditing();
    controller.stopSelectedTextDistortEditing();
    this.restoreTextDistortTool();
    return false;
  }

  setTextWarpMode(mode: MobileTextWarpMode): boolean {
    const controller = this.options.getVectorController();
    if (!controller) return false;
    const wasDistortEditing = controller.isSelectedTextDistortEditing();
    controller.setSelectedTextTransform(mode);
    if (mode === "distort") return this.startTextDistortEditing();
    if (wasDistortEditing) this.restoreTextDistortTool();
    return false;
  }

  async finishTransformToolOnSheetClose(kind: MobileToolSettingsKind): Promise<void> {
    if (kind !== "transform" && kind !== "text-warp") return;
    const controller = this.options.getVectorController();
    if (controller && !await controller.applyTransform()) return;
    if (kind === "text-warp") controller?.stopSelectedTextDistortEditing();
    this.textDistortReturnTool = null;
    const nextKind = this.options.getOpenToolSettingsKind();
    const nextKeepsTransform = nextKind === "transform" || nextKind === "text-warp";
    if (nextKeepsTransform) return;
    const targetTool = this.activeCanvasTool === "transform" ? "paint" : this.activeCanvasTool;
    this.select(targetTool, true);
  }

  resetSelectedText(): void {
    this.stopTextDistortEditing();
    this.options.getVectorController()?.resetSelectedText();
  }

  deleteSelectedText(): void {
    this.stopTextDistortEditing();
    this.options.getVectorController()?.deleteSelectedText();
  }

  rasterizeSelectedText(): void {
    this.stopTextDistortEditing();
    this.options.getVectorController()?.rasterizeSelectedTextNode();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.configurationRevision += 1;
    this.abortController.abort();
  }

  private syncSelectionKeyboardUi(): void {
    const colorRange = this.selectionMethod === "color-range";
    const canvasKeyboardEnabled = this.activeCanvasTool === "selection" && !colorRange;
    const { canvas } = this.options.elements;
    canvas.tabIndex = canvasKeyboardEnabled ? 0 : -1;
    if (canvasKeyboardEnabled) {
      canvas.setAttribute(
        "aria-keyshortcuts",
        "ArrowUp ArrowDown ArrowLeft ArrowRight Enter Space Escape",
      );
    } else {
      canvas.removeAttribute("aria-keyshortcuts");
    }
  }

  private async configureEngineToolSelection(
    tool: CanvasInputTool,
    fill: boolean,
    selection: boolean,
    method: SelectionMethod,
    configurationRevision: number,
  ): Promise<void> {
    const fillReady = await this.options.engine.setFillToolSelected(fill);
    if (
      this.disposed
      || configurationRevision !== this.configurationRevision
      || this.activeCanvasTool !== tool
    ) return;
    const selectionReady = await this.options.engine.setSelectionToolSelected(selection, method);
    if (
      this.disposed
      || configurationRevision !== this.configurationRevision
      || this.activeCanvasTool !== tool
      || (selection && this.selectionMethod !== method)
    ) return;
    if (
      (!fillReady && this.activeCanvasTool === "fill" && !this.options.engine.fillToolSelected)
      || (!selectionReady && this.activeCanvasTool === "selection")
    ) {
      this.configure(this.activeBrushTool, false);
    }
  }

  private startTextDistortEditing(): boolean {
    const controller = this.options.getVectorController();
    if (!controller) return false;
    if (this.textDistortReturnTool === null) {
      this.textDistortReturnTool = this.activeCanvasTool === "transform"
        ? this.activeBrushTool
        : this.activeCanvasTool;
    }
    if (!controller.startSelectedTextDistortEditing()) {
      this.textDistortReturnTool = null;
      return false;
    }
    if (this.select("transform", true)) return true;
    controller.stopSelectedTextDistortEditing();
    this.textDistortReturnTool = null;
    return false;
  }

  private stopTextDistortEditing(): void {
    const controller = this.options.getVectorController();
    if (!controller?.isSelectedTextDistortEditing()) return;
    controller.stopSelectedTextDistortEditing();
    this.restoreTextDistortTool();
  }

  private restoreTextDistortTool(): void {
    const returnTool = this.textDistortReturnTool;
    this.textDistortReturnTool = null;
    if (returnTool && this.activeCanvasTool === "transform") {
      this.select(returnTool, true);
    }
  }
}
