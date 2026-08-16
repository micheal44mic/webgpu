import type { BrushQuickControlKind, BrushQuickControlSnapshot } from "./brush-settings-controller";
import type { BrushSettings } from "./engine-types";
import type { CanvasInputTool } from "./canvas-input-controller";

const PREVIEW_CSS_SIZE = 124;
const PREVIEW_MAX_TIP_CSS_PIXELS = 92;
const CONTROL_INDICATOR_MAX_CSS_PIXELS = 41;

export interface BrushQuickControlsSettingsPort {
  snapshot(): BrushSettings;
  update(patch: Partial<BrushSettings>): BrushSettings;
  quickControl(kind: BrushQuickControlKind): BrushQuickControlSnapshot;
  setQuickControl(kind: BrushQuickControlKind, requested: number): BrushSettings;
}

export interface BrushQuickControlsEnginePort {
  renderBrushTipPreview(
    canvas: HTMLCanvasElement,
    cssSize: number,
    diameter: number,
    alpha: number,
  ): void;
}

export interface BrushQuickControlsElements {
  readonly colorLabel: HTMLLabelElement;
  readonly colorInput: HTMLInputElement;
  readonly colorSwatch: HTMLElement;
  readonly controls: HTMLElement;
  readonly tracks: Readonly<Record<BrushQuickControlKind, HTMLElement>>;
  readonly controlsByKind: Readonly<Record<BrushQuickControlKind, HTMLElement>>;
  readonly preview: HTMLElement;
  readonly previewLabel: HTMLOutputElement;
  readonly previewCanvas: HTMLCanvasElement;
}

export interface BrushQuickControlsBrowser extends Window {
  readonly AbortController: typeof AbortController;
}

export interface BrushQuickControlsControllerOptions {
  readonly browser: BrushQuickControlsBrowser;
  readonly engine: BrushQuickControlsEnginePort;
  readonly settings: BrushQuickControlsSettingsPort;
  readonly elements: BrushQuickControlsElements;
  readonly getActiveTool: () => CanvasInputTool;
  readonly isInteractionLocked: () => boolean;
  readonly isSuppressedBySurface: () => boolean;
  readonly selectPaintTool: () => void;
  readonly markLibraryPreviewDirty: () => void;
  readonly updateHistoryControls: () => void;
}

interface BrushControlDrag {
  readonly kind: BrushQuickControlKind;
  readonly pointerId: number;
  readonly startClientY: number;
  readonly startPercent: number;
  readonly startValue: number;
  readonly travelPixels: number;
  currentValue: number;
}

/** Owns the visible brush color and five vertical quick controls. */
export class BrushQuickControlsController {
  private readonly abortController: AbortController;
  private drag: BrushControlDrag | null = null;
  private previewFrame: number | null = null;
  private disposed = false;

  constructor(private readonly options: BrushQuickControlsControllerOptions) {
    this.abortController = new options.browser.AbortController();
    this.bind();
    this.syncSettings();
    this.syncAvailability();
    this.syncVisibility();
  }

  get isDragging(): boolean {
    return this.drag !== null;
  }

  notifyEngineUpdate(): void {
    if (this.drag) this.schedulePreview();
  }

  syncSettings(settings = this.options.settings.snapshot()): void {
    this.options.elements.colorInput.value = settings.color;
    this.options.elements.colorSwatch.style.backgroundColor = settings.color;
    this.syncVisuals();
    this.options.markLibraryPreviewDirty();
  }

  setLocked(locked: boolean): void {
    this.syncAvailability(locked);
  }

  syncAvailability(locked = this.options.isInteractionLocked()): void {
    const tool = this.options.getActiveTool();
    const brushContext = tool === "paint" || tool === "erase" || tool === "blend";
    const colorDisabled = locked || !brushContext || tool === "erase";
    this.options.elements.colorInput.disabled = colorDisabled;
    this.options.elements.colorLabel.classList.toggle("is-disabled", colorDisabled);
    const disabledByKind: Readonly<Record<BrushQuickControlKind, boolean>> = {
      size: locked || !brushContext,
      opacity: locked || !brushContext,
      stretch: locked || tool !== "blend",
      paint: locked || tool !== "blend",
      blur: locked || tool !== "blend",
    };
    for (const kind of this.kinds()) {
      const control = this.control(kind);
      const disabled = disabledByKind[kind];
      control.setAttribute("aria-disabled", String(disabled));
      control.tabIndex = disabled ? -1 : 0;
    }
  }

  syncVisibility(): void {
    const tool = this.options.getActiveTool();
    const brushContext = tool === "paint" || tool === "erase" || tool === "blend";
    const blend = tool === "blend";
    const suppressed = !brushContext || this.options.isSuppressedBySurface();
    if (suppressed && this.drag) this.finishDrag(true);
    const { controls, tracks } = this.options.elements;
    controls.classList.toggle("is-suppressed", suppressed);
    controls.classList.toggle("is-blend", blend);
    controls.setAttribute(
      "aria-label",
      blend
        ? "Blend size, opacity, stretch, paint and blur"
        : tool === "erase"
          ? "Eraser size and opacity"
          : "Brush size and opacity",
    );
    tracks.opacity.hidden = false;
    tracks.stretch.hidden = !blend;
    tracks.paint.hidden = !blend;
    tracks.blur.hidden = !blend;
    controls.setAttribute("aria-hidden", String(suppressed));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortController.abort();
    this.finishDrag(false);
    if (this.previewFrame !== null) {
      this.options.browser.cancelAnimationFrame(this.previewFrame);
      this.previewFrame = null;
    }
  }

  private bind(): void {
    const signal = this.abortController.signal;
    const { colorInput } = this.options.elements;
    const applyColor = (): void => this.applyColor();
    colorInput.addEventListener("input", applyColor, { signal });
    colorInput.addEventListener("change", applyColor, { signal });
    for (const kind of this.kinds()) {
      const control = this.control(kind);
      control.addEventListener("pointerdown", (event) => {
        this.startDrag(kind, event);
      }, { signal });
      control.addEventListener("pointermove", (event) => {
        this.moveDrag(event);
      }, { signal });
      for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
        control.addEventListener(type, (event) => {
          this.finishPointer(event as PointerEvent);
        }, { signal });
      }
      control.addEventListener("keydown", (event) => {
        this.handleKeydown(kind, event);
      }, { signal });
    }
  }

  private applyColor(): void {
    const { colorInput } = this.options.elements;
    if (colorInput.disabled) return;
    const activeTool = this.options.getActiveTool();
    if (activeTool !== "paint" && activeTool !== "blend") {
      this.options.selectPaintTool();
    }
    const settings = this.options.settings.update({ color: colorInput.value });
    this.syncSettings(settings);
    this.options.updateHistoryControls();
  }

  private startDrag(kind: BrushQuickControlKind, event: PointerEvent): void {
    const control = this.control(kind);
    if (
      event.button !== 0
      || this.drag !== null
      || this.options.isInteractionLocked()
      || control.getAttribute("aria-disabled") === "true"
    ) return;
    event.preventDefault();
    const travelPixels = this.track(kind).getBoundingClientRect().height;
    if (!Number.isFinite(travelPixels) || travelPixels <= 0) return;
    const startValue = this.controlValue(kind);
    this.drag = {
      kind,
      pointerId: event.pointerId,
      startClientY: event.clientY,
      startPercent: this.controlPercent(kind),
      startValue,
      currentValue: startValue,
      travelPixels,
    };
    const { controls, preview } = this.options.elements;
    controls.dataset.active = kind;
    controls.classList.add("is-adjusting");
    preview.setAttribute("aria-hidden", "false");
    control.classList.add("is-active");
    control.setPointerCapture(event.pointerId);
    this.syncVisuals();
  }

  private moveDrag(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    const deltaPercent = (event.clientY - drag.startClientY) / drag.travelPixels * 100;
    this.setControlPercent(drag.kind, drag.startPercent - deltaPercent);
  }

  private finishPointer(event: PointerEvent): void {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    event.preventDefault();
    this.finishDrag(true);
  }

  private finishDrag(commit: boolean): void {
    const drag = this.drag;
    if (!drag) return;
    const control = this.control(drag.kind);
    this.drag = null;
    try {
      if (control.hasPointerCapture(drag.pointerId)) {
        control.releasePointerCapture(drag.pointerId);
      }
    } catch {
      // The control can already be detached during pagehide.
    }
    if (this.previewFrame !== null) {
      this.options.browser.cancelAnimationFrame(this.previewFrame);
      this.previewFrame = null;
    }
    const { controls, preview } = this.options.elements;
    control.classList.remove("is-active");
    controls.classList.remove("is-adjusting");
    controls.removeAttribute("data-active");
    preview.setAttribute("aria-hidden", "true");
    if (commit && drag.currentValue !== drag.startValue) {
      this.options.settings.setQuickControl(drag.kind, drag.currentValue);
      this.options.markLibraryPreviewDirty();
    }
    this.syncVisuals();
    this.options.updateHistoryControls();
  }

  private handleKeydown(kind: BrushQuickControlKind, event: KeyboardEvent): void {
    const control = this.control(kind);
    if (
      this.options.isInteractionLocked()
      || control.getAttribute("aria-disabled") === "true"
      || event.altKey
      || event.ctrlKey
      || event.metaKey
    ) return;
    const snapshot = this.options.settings.quickControl(kind);
    const step = event.shiftKey ? 10 : 1;
    let next: number | null = null;
    if (event.key === "ArrowUp" || event.key === "ArrowRight") next = snapshot.value + step;
    else if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
      next = snapshot.value - step;
    } else if (event.key === "Home") next = snapshot.maximum;
    else if (event.key === "End") next = snapshot.minimum;
    if (next === null) return;
    event.preventDefault();
    this.options.settings.setQuickControl(
      kind,
      Math.min(snapshot.maximum, Math.max(snapshot.minimum, next)),
    );
    this.options.markLibraryPreviewDirty();
    this.syncVisuals();
  }

  private setControlPercent(kind: BrushQuickControlKind, requested: number): void {
    const drag = this.drag;
    if (!drag || drag.kind !== kind) return;
    const percent = Math.min(100, Math.max(0, Number.isFinite(requested) ? requested : 0));
    const { minimum, maximum } = this.options.settings.quickControl(kind);
    const value = minimum + percent / 100 * (maximum - minimum);
    drag.currentValue = kind === "size" ? Math.round(value) : Math.round(value * 10) / 10;
    this.syncVisuals();
  }

  private controlValue(kind: BrushQuickControlKind): number {
    if (this.drag?.kind === kind) return this.drag.currentValue;
    return this.options.settings.quickControl(kind).value;
  }

  private controlPercent(kind: BrushQuickControlKind): number {
    const { minimum, maximum } = this.options.settings.quickControl(kind);
    return (this.controlValue(kind) - minimum) / (maximum - minimum) * 100;
  }

  private controlLabel(kind: BrushQuickControlKind): string {
    const value = this.controlValue(kind);
    if (kind === "size") return `Size ${Math.round(value)} px`;
    if (kind === "opacity") return `Opacity ${Math.round(value)}%`;
    if (kind === "stretch") return `Stretch ${Math.round(value)}%`;
    if (kind === "paint") return `Paint ${Math.round(value)}%`;
    return `Blur ${Math.round(value)}%`;
  }

  private syncVisuals(): void {
    for (const kind of this.kinds()) this.syncVisual(kind);
    if (this.drag) {
      this.options.elements.previewLabel.value = this.controlLabel(this.drag.kind);
      this.schedulePreview();
    }
  }

  private syncVisual(kind: BrushQuickControlKind): void {
    const control = this.control(kind);
    const { minimum, maximum } = this.options.settings.quickControl(kind);
    const percent = this.controlPercent(kind);
    const roundedPercent = Math.round(percent);
    const value = this.controlValue(kind);
    control.style.setProperty(
      "--mobile-brush-control-position",
      `${(100 - percent).toFixed(3)}%`,
    );
    control.setAttribute("aria-valuemin", String(minimum));
    control.setAttribute("aria-valuemax", String(maximum));
    control.setAttribute(
      "aria-valuenow",
      String(kind === "size" ? Math.round(value) : roundedPercent),
    );
    control.setAttribute("aria-valuetext", this.controlLabel(kind));
    const diameter = kind === "size"
      ? Math.max(1, CONTROL_INDICATOR_MAX_CSS_PIXELS * percent / 100)
      : CONTROL_INDICATOR_MAX_CSS_PIXELS * percent / 100;
    control.style.setProperty(
      kind === "size"
        ? "--mobile-brush-size-indicator"
        : "--mobile-brush-opacity-indicator",
      `${diameter.toFixed(2)}px`,
    );
  }

  private schedulePreview(): void {
    if (this.previewFrame !== null || !this.drag) return;
    this.previewFrame = this.options.browser.requestAnimationFrame(() => {
      this.previewFrame = null;
      this.renderPreview();
    });
  }

  private renderPreview(): void {
    const drag = this.drag;
    if (!drag || drag.kind === "stretch" || drag.kind === "paint" || drag.kind === "blur") {
      return;
    }
    const percent = this.controlPercent(drag.kind);
    const diameter = drag.kind === "size"
      ? PREVIEW_MAX_TIP_CSS_PIXELS * percent / 100
      : PREVIEW_MAX_TIP_CSS_PIXELS * 0.72;
    this.options.engine.renderBrushTipPreview(
      this.options.elements.previewCanvas,
      PREVIEW_CSS_SIZE,
      diameter,
      drag.kind === "opacity" ? percent / 100 : 1,
    );
  }

  private control(kind: BrushQuickControlKind): HTMLElement {
    return this.options.elements.controlsByKind[kind];
  }

  private track(kind: BrushQuickControlKind): HTMLElement {
    return this.options.elements.tracks[kind];
  }

  private kinds(): readonly BrushQuickControlKind[] {
    return ["size", "opacity", "stretch", "paint", "blur"];
  }
}
