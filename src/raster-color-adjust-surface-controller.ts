import {
  DEFAULT_RASTER_COLOR_ADJUST_SETTINGS,
  normalizeRasterColorAdjustSettings,
  type RasterColorAdjustSettings,
} from "./raster-color-adjust-core.ts";

export interface RasterColorAdjustSurfaceElements {
  readonly surface: HTMLElement;
  readonly hueInput: HTMLInputElement;
  readonly hueOutput: HTMLOutputElement;
  readonly saturationInput: HTMLInputElement;
  readonly saturationOutput: HTMLOutputElement;
  readonly brightnessInput: HTMLInputElement;
  readonly brightnessOutput: HTMLOutputElement;
  readonly menu: HTMLElement;
  readonly resetButton: HTMLButtonElement;
  readonly cancelButton: HTMLButtonElement;
}

export interface RasterColorAdjustSurfaceBrowser extends Window {
  readonly AbortController: typeof AbortController;
}

export interface RasterColorAdjustSurfaceControllerOptions {
  readonly browser: RasterColorAdjustSurfaceBrowser;
  readonly document: Document;
  readonly canvas: HTMLCanvasElement;
  readonly elements: RasterColorAdjustSurfaceElements;
  readonly onChange: (settings: Readonly<RasterColorAdjustSettings>) => void;
  readonly onRequestReset: () => void;
  readonly onRequestCancel: () => void;
}

const LONG_PRESS_DELAY_MS = 480;
const LONG_PRESS_MOVEMENT_PX = 10;
const MENU_VIEWPORT_MARGIN_PX = 12;
const MENU_TOUCH_GAP_PX = 14;

function sliderToSettings(
  hue: number,
  saturation: number,
  brightness: number,
): RasterColorAdjustSettings {
  return normalizeRasterColorAdjustSettings({
    hueDegrees: (hue - 50) * 3.6,
    saturationPercent: (saturation - 50) * 2,
    brightnessPercent: (brightness - 50) * 2,
  });
}

function settingsToSliderValues(
  settings: Readonly<RasterColorAdjustSettings>,
): readonly [number, number, number] {
  const normalized = normalizeRasterColorAdjustSettings(settings);
  return [
    normalized.hueDegrees / 3.6 + 50,
    normalized.saturationPercent / 2 + 50,
    normalized.brightnessPercent / 2 + 50,
  ];
}

function signedPercent(value: number): string {
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

/** Owns the floating controls and the canvas long-press recovery menu. */
export class RasterColorAdjustSurfaceController {
  private readonly abortController: AbortController;
  private openState = false;
  private disabled = false;
  private pointerId: number | null = null;
  private pointerStartX = 0;
  private pointerStartY = 0;
  private longPressTimer: number | null = null;
  private previousCanvasTabIndex: number | null = null;
  private previousCanvasShortcuts: string | null = null;
  private disposed = false;

  constructor(private readonly options: RasterColorAdjustSurfaceControllerOptions) {
    this.abortController = new options.browser.AbortController();
    this.configureInputs();
    this.bindEvents();
    this.setState(DEFAULT_RASTER_COLOR_ADJUST_SETTINGS);
    this.syncOpenState();
  }

  get isOpen(): boolean {
    return this.openState;
  }

  open(settings: Readonly<RasterColorAdjustSettings>): boolean {
    if (this.disposed) return false;
    this.setState(settings);
    if (this.openState) return true;
    this.openState = true;
    this.previousCanvasTabIndex = this.options.canvas.tabIndex;
    this.previousCanvasShortcuts = this.options.canvas.getAttribute("aria-keyshortcuts");
    this.options.canvas.tabIndex = 0;
    this.options.canvas.setAttribute("aria-keyshortcuts", "Shift+F10 Escape");
    this.syncOpenState();
    return true;
  }

  close(): void {
    if (!this.openState) return;
    this.openState = false;
    this.cancelLongPress();
    this.hideMenu();
    if (this.previousCanvasTabIndex !== null) {
      this.options.canvas.tabIndex = this.previousCanvasTabIndex;
      this.previousCanvasTabIndex = null;
    }
    if (this.previousCanvasShortcuts === null) {
      this.options.canvas.removeAttribute("aria-keyshortcuts");
    } else {
      this.options.canvas.setAttribute("aria-keyshortcuts", this.previousCanvasShortcuts);
    }
    this.previousCanvasShortcuts = null;
    this.syncOpenState();
  }

  setDisabled(disabled: boolean): void {
    this.disabled = disabled;
    for (const input of this.inputs()) input.disabled = disabled;
    this.options.elements.resetButton.disabled = disabled;
    this.options.elements.cancelButton.disabled = disabled;
    this.options.elements.surface.setAttribute("aria-busy", String(disabled));
  }

  setState(settings: Readonly<RasterColorAdjustSettings>): void {
    const [hue, saturation, brightness] = settingsToSliderValues(settings);
    const { elements } = this.options;
    elements.hueInput.value = String(hue);
    elements.saturationInput.value = String(saturation);
    elements.brightnessInput.value = String(brightness);
    this.syncOutputs();
  }

  reset(): void {
    this.setState(DEFAULT_RASTER_COLOR_ADJUST_SETTINGS);
    this.hideMenu();
  }

  hideMenu(): void {
    const { menu } = this.options.elements;
    menu.hidden = true;
    menu.setAttribute("aria-hidden", "true");
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelLongPress();
    this.abortController.abort();
    this.close();
  }

  private inputs(): readonly HTMLInputElement[] {
    const { elements } = this.options;
    return [elements.hueInput, elements.saturationInput, elements.brightnessInput];
  }

  private configureInputs(): void {
    for (const input of this.inputs()) {
      input.min = "0";
      input.max = "100";
      input.step = "0.5";
      input.value = "50";
    }
  }

  private settingsFromInputs(): RasterColorAdjustSettings {
    const { elements } = this.options;
    return sliderToSettings(
      Number(elements.hueInput.value),
      Number(elements.saturationInput.value),
      Number(elements.brightnessInput.value),
    );
  }

  private syncOutputs(): void {
    const settings = this.settingsFromInputs();
    const { elements } = this.options;
    elements.hueOutput.value = `${Math.round(settings.hueDegrees)}°`;
    elements.hueOutput.textContent = elements.hueOutput.value;
    elements.saturationOutput.value = signedPercent(settings.saturationPercent);
    elements.saturationOutput.textContent = elements.saturationOutput.value;
    elements.brightnessOutput.value = signedPercent(settings.brightnessPercent);
    elements.brightnessOutput.textContent = elements.brightnessOutput.value;
  }

  private requestUpdate(): void {
    if (!this.openState || this.disabled) return;
    this.syncOutputs();
    this.options.onChange(this.settingsFromInputs());
  }

  private bindEvents(): void {
    const signal = this.abortController.signal;
    const { canvas, document, elements } = this.options;
    for (const input of this.inputs()) {
      input.addEventListener("input", () => this.requestUpdate(), { signal });
    }
    elements.resetButton.addEventListener("click", () => {
      if (!this.openState || this.disabled) return;
      this.options.onRequestReset();
    }, { signal });
    elements.cancelButton.addEventListener("click", () => {
      if (!this.openState || this.disabled) return;
      this.hideMenu();
      this.options.onRequestCancel();
    }, { signal });

    canvas.addEventListener("pointerdown", (event) => {
      if (!this.openState || this.disabled || event.button !== 0) return;
      if (this.pointerId !== null) {
        this.cancelLongPress();
        this.hideMenu();
        return;
      }
      this.pointerId = event.pointerId;
      this.pointerStartX = event.clientX;
      this.pointerStartY = event.clientY;
      this.longPressTimer = this.options.browser.setTimeout(() => {
        this.longPressTimer = null;
        if (this.pointerId !== event.pointerId || !this.openState || this.disabled) return;
        this.showMenuAt(this.pointerStartX, this.pointerStartY);
      }, LONG_PRESS_DELAY_MS);
    }, { signal, capture: true });
    canvas.addEventListener("pointermove", (event) => {
      if (event.pointerId !== this.pointerId) return;
      const distance = Math.hypot(
        event.clientX - this.pointerStartX,
        event.clientY - this.pointerStartY,
      );
      if (distance > LONG_PRESS_MOVEMENT_PX) {
        this.cancelLongPressTimer();
        this.hideMenu();
      }
    }, { signal, capture: true });
    canvas.addEventListener("pointerup", (event) => {
      if (event.pointerId === this.pointerId) this.cancelLongPress();
    }, { signal, capture: true });
    for (const type of ["pointercancel", "lostpointercapture"] as const) {
      canvas.addEventListener(type, (event) => {
        if (event.pointerId !== this.pointerId) return;
        this.cancelLongPress();
        this.hideMenu();
      }, { signal, capture: true });
    }
    canvas.addEventListener("contextmenu", (event) => {
      if (!this.openState || this.disabled) return;
      event.preventDefault();
      this.showMenuAt(event.clientX, event.clientY);
    }, { signal });
    canvas.addEventListener("keydown", (event) => {
      if (!this.openState) return;
      if (event.key === "F10" && event.shiftKey) {
        event.preventDefault();
        const rect = canvas.getBoundingClientRect();
        this.showMenuAt(rect.left + rect.width / 2, rect.top + rect.height / 2);
      } else if (event.key === "Escape" && !elements.menu.hidden) {
        event.preventDefault();
        this.hideMenu();
      }
    }, { signal });
    document.addEventListener("pointerdown", (event) => {
      if (elements.menu.hidden || elements.menu.contains(event.target as Node)) return;
      this.hideMenu();
    }, { signal, capture: true });
    this.options.browser.addEventListener("blur", () => {
      this.cancelLongPress();
      this.hideMenu();
    }, { signal });
  }

  private cancelLongPressTimer(): void {
    if (this.longPressTimer === null) return;
    this.options.browser.clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
  }

  private cancelLongPress(): void {
    this.cancelLongPressTimer();
    this.pointerId = null;
  }

  private showMenuAt(clientX: number, clientY: number): void {
    const { menu, surface } = this.options.elements;
    menu.hidden = false;
    menu.setAttribute("aria-hidden", "false");
    menu.style.left = "0px";
    menu.style.top = "0px";
    const rect = menu.getBoundingClientRect();
    const surfaceTop = surface.getBoundingClientRect().top;
    const minLeft = MENU_VIEWPORT_MARGIN_PX;
    const maxLeft = Math.max(
      minLeft,
      this.options.browser.innerWidth - rect.width - MENU_VIEWPORT_MARGIN_PX,
    );
    const safeTop = MENU_VIEWPORT_MARGIN_PX;
    const safeBottom = Math.max(
      safeTop + rect.height,
      Math.min(
        this.options.browser.innerHeight - MENU_VIEWPORT_MARGIN_PX,
        surfaceTop - MENU_VIEWPORT_MARGIN_PX,
      ),
    );
    const maxTop = Math.max(
      safeTop,
      safeBottom - rect.height,
    );
    const aboveTop = clientY - MENU_TOUCH_GAP_PX - rect.height;
    const belowTop = clientY + MENU_TOUCH_GAP_PX;
    const fitsAbove = aboveTop >= safeTop;
    const fitsBelow = belowTop <= maxTop;
    const spaceAbove = clientY - MENU_TOUCH_GAP_PX - safeTop;
    const spaceBelow = safeBottom - clientY - MENU_TOUCH_GAP_PX;
    const placeBelow = fitsBelow && (!fitsAbove || spaceBelow >= spaceAbove);
    const desiredTop = placeBelow ? belowTop : aboveTop;

    menu.dataset.placement = placeBelow ? "below" : "above";
    menu.style.left = `${Math.min(maxLeft, Math.max(minLeft, clientX - rect.width / 2))}px`;
    menu.style.top = `${Math.min(maxTop, Math.max(safeTop, desiredTop))}px`;
    elementsFocus(menu);
  }

  private syncOpenState(): void {
    const { surface } = this.options.elements;
    surface.hidden = !this.openState;
    surface.setAttribute("aria-hidden", String(!this.openState));
    surface.toggleAttribute("inert", !this.openState);
    surface.classList.toggle("is-open", this.openState);
    this.options.canvas.classList.toggle("raster-color-adjust-active", this.openState);
  }
}

function elementsFocus(menu: HTMLElement): void {
  menu.querySelector<HTMLButtonElement>("button:not(:disabled)")
    ?.focus({ preventScroll: true });
}
