import {
  DEFAULT_RASTER_COLOR_BALANCE_SETTINGS,
  RASTER_COLOR_BALANCE_TONES,
  normalizeRasterColorBalanceSettings,
  type RasterColorBalanceSettings,
  type RasterColorBalanceTone,
  type RasterColorBalanceToneAdjustment,
} from "./raster-color-balance-core.ts";

export interface RasterColorBalanceSurfaceElements {
  readonly surface: HTMLElement;
  readonly cyanRedInput: HTMLInputElement;
  readonly cyanRedOutput: HTMLOutputElement;
  readonly magentaGreenInput: HTMLInputElement;
  readonly magentaGreenOutput: HTMLOutputElement;
  readonly yellowBlueInput: HTMLInputElement;
  readonly yellowBlueOutput: HTMLOutputElement;
  readonly toneButton: HTMLButtonElement;
  readonly toneButtonLabel: HTMLElement;
  readonly settingsMenu: HTMLElement;
  readonly toneButtons: readonly HTMLButtonElement[];
  readonly preserveLuminosityButton: HTMLButtonElement;
  readonly actionMenu: HTMLElement;
  readonly resetButton: HTMLButtonElement;
  readonly cancelButton: HTMLButtonElement;
}

export interface RasterColorBalanceSurfaceBrowser extends Window {
  readonly AbortController: typeof AbortController;
}

export interface RasterColorBalanceSurfaceControllerOptions {
  readonly browser: RasterColorBalanceSurfaceBrowser;
  readonly document: Document;
  readonly canvas: HTMLCanvasElement;
  readonly elements: RasterColorBalanceSurfaceElements;
  readonly onChange: (settings: Readonly<RasterColorBalanceSettings>) => void;
  readonly onRequestReset: () => void;
  readonly onRequestCancel: () => void;
}

const LONG_PRESS_DELAY_MS = 480;
const LONG_PRESS_MOVEMENT_PX = 10;
const MENU_VIEWPORT_MARGIN_PX = 12;
const MENU_TOUCH_GAP_PX = 14;

const TONE_LABELS: Readonly<Record<RasterColorBalanceTone, string>> = Object.freeze({
  shadows: "Shadows",
  midtones: "Midtones",
  highlights: "Highlights",
});

function signedPercent(value: number): string {
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

function directionalPercent(value: number, negative: string, positive: string): string {
  const rounded = Math.round(value);
  if (rounded === 0) return "neutral";
  return `${Math.abs(rounded)} percent toward ${rounded < 0 ? negative : positive}`;
}

function isTone(value: string | undefined): value is RasterColorBalanceTone {
  return value !== undefined
    && (RASTER_COLOR_BALANCE_TONES as readonly string[]).includes(value);
}

/** Owns the live dock, tonal settings menu and long-press recovery actions. */
export class RasterColorBalanceSurfaceController {
  private readonly abortController: AbortController;
  private settings = normalizeRasterColorBalanceSettings(
    DEFAULT_RASTER_COLOR_BALANCE_SETTINGS,
  );
  private activeTone: RasterColorBalanceTone = "midtones";
  private openState = false;
  private disabled = false;
  private pointerId: number | null = null;
  private pointerStartX = 0;
  private pointerStartY = 0;
  private longPressTimer: number | null = null;
  private previousCanvasTabIndex: number | null = null;
  private previousCanvasShortcuts: string | null = null;
  private disposed = false;

  constructor(private readonly options: RasterColorBalanceSurfaceControllerOptions) {
    this.abortController = new options.browser.AbortController();
    this.configureInputs();
    this.bindEvents();
    this.setState(DEFAULT_RASTER_COLOR_BALANCE_SETTINGS);
    this.syncOpenState();
  }

  get isOpen(): boolean {
    return this.openState;
  }

  open(settings: Readonly<RasterColorBalanceSettings>): boolean {
    if (this.disposed) return false;
    this.activeTone = "midtones";
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
    this.hideMenus();
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
    const { elements } = this.options;
    elements.toneButton.disabled = disabled;
    for (const button of elements.toneButtons) button.disabled = disabled;
    elements.preserveLuminosityButton.disabled = disabled;
    elements.resetButton.disabled = disabled;
    elements.cancelButton.disabled = disabled;
    elements.surface.setAttribute("aria-busy", String(disabled));
    if (disabled) this.hideMenus();
  }

  setState(settings: Readonly<RasterColorBalanceSettings>): void {
    this.settings = normalizeRasterColorBalanceSettings(settings);
    this.syncControls();
  }

  reset(): void {
    this.activeTone = "midtones";
    this.setState(DEFAULT_RASTER_COLOR_BALANCE_SETTINGS);
    this.hideMenus();
  }

  hideMenus(): void {
    this.hideSettingsMenu();
    this.hideActionMenu();
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
    return [elements.cyanRedInput, elements.magentaGreenInput, elements.yellowBlueInput];
  }

  private configureInputs(): void {
    for (const input of this.inputs()) {
      input.min = "-100";
      input.max = "100";
      input.step = "1";
      input.value = "0";
    }
  }

  private activeAdjustment(): Readonly<RasterColorBalanceToneAdjustment> {
    return this.settings[this.activeTone];
  }

  private syncControls(): void {
    const { elements } = this.options;
    const adjustment = this.activeAdjustment();
    elements.cyanRedInput.value = String(adjustment.cyanRedPercent);
    elements.magentaGreenInput.value = String(adjustment.magentaGreenPercent);
    elements.yellowBlueInput.value = String(adjustment.yellowBluePercent);
    elements.cyanRedOutput.value = signedPercent(adjustment.cyanRedPercent);
    elements.magentaGreenOutput.value = signedPercent(adjustment.magentaGreenPercent);
    elements.yellowBlueOutput.value = signedPercent(adjustment.yellowBluePercent);
    elements.cyanRedOutput.textContent = elements.cyanRedOutput.value;
    elements.magentaGreenOutput.textContent = elements.magentaGreenOutput.value;
    elements.yellowBlueOutput.textContent = elements.yellowBlueOutput.value;
    elements.toneButtonLabel.textContent = TONE_LABELS[this.activeTone];
    elements.toneButton.setAttribute(
      "aria-label",
      `Tone range: ${TONE_LABELS[this.activeTone]}`,
    );
    elements.cyanRedInput.setAttribute(
      "aria-valuetext",
      directionalPercent(adjustment.cyanRedPercent, "cyan", "red"),
    );
    elements.magentaGreenInput.setAttribute(
      "aria-valuetext",
      directionalPercent(adjustment.magentaGreenPercent, "magenta", "green"),
    );
    elements.yellowBlueInput.setAttribute(
      "aria-valuetext",
      directionalPercent(adjustment.yellowBluePercent, "yellow", "blue"),
    );
    for (const button of elements.toneButtons) {
      const selected = button.dataset.colorBalanceTone === this.activeTone;
      button.setAttribute("aria-checked", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    elements.preserveLuminosityButton.setAttribute(
      "aria-checked",
      String(this.settings.preserveLuminosity),
    );
    elements.preserveLuminosityButton.classList.toggle(
      "is-enabled",
      this.settings.preserveLuminosity,
    );
  }

  private settingsFromInputs(): RasterColorBalanceSettings {
    const { elements } = this.options;
    return normalizeRasterColorBalanceSettings({
      [this.activeTone]: {
        cyanRedPercent: Number(elements.cyanRedInput.value),
        magentaGreenPercent: Number(elements.magentaGreenInput.value),
        yellowBluePercent: Number(elements.yellowBlueInput.value),
      },
    }, this.settings);
  }

  private requestSliderUpdate(): void {
    if (!this.openState || this.disabled) return;
    this.settings = this.settingsFromInputs();
    this.syncControls();
    this.options.onChange(this.settings);
  }

  private selectTone(tone: RasterColorBalanceTone): void {
    this.activeTone = tone;
    this.hideSettingsMenu();
    this.syncControls();
    this.options.elements.toneButton.focus({ preventScroll: true });
  }

  private togglePreserveLuminosity(): void {
    if (!this.openState || this.disabled) return;
    this.settings = normalizeRasterColorBalanceSettings({
      preserveLuminosity: !this.settings.preserveLuminosity,
    }, this.settings);
    this.hideSettingsMenu();
    this.syncControls();
    this.options.onChange(this.settings);
    this.options.elements.toneButton.focus({ preventScroll: true });
  }

  private bindEvents(): void {
    const signal = this.abortController.signal;
    const { canvas, document, elements } = this.options;
    for (const input of this.inputs()) {
      input.addEventListener("input", () => this.requestSliderUpdate(), { signal });
    }
    elements.toneButton.addEventListener("click", () => {
      if (!this.openState || this.disabled) return;
      if (elements.settingsMenu.hidden) this.showSettingsMenu();
      else this.hideSettingsMenu();
    }, { signal });
    elements.toneButton.addEventListener("keydown", (event) => {
      if (!this.openState || this.disabled) return;
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      this.showSettingsMenu();
      const items = this.settingsMenuItems();
      (event.key === "ArrowUp" ? items.at(-1) : items[0])
        ?.focus({ preventScroll: true });
    }, { signal });
    for (const button of elements.toneButtons) {
      button.addEventListener("click", () => {
        const tone = button.dataset.colorBalanceTone;
        if (!isTone(tone) || button.disabled) return;
        this.selectTone(tone);
      }, { signal });
    }
    elements.preserveLuminosityButton.addEventListener(
      "click",
      () => this.togglePreserveLuminosity(),
      { signal },
    );
    elements.settingsMenu.addEventListener("keydown", (event) => {
      if (elements.settingsMenu.hidden) return;
      if (event.key === "Escape") {
        event.preventDefault();
        this.hideSettingsMenu();
        elements.toneButton.focus({ preventScroll: true });
        return;
      }
      if (event.key === "Tab") {
        this.hideSettingsMenu();
        return;
      }
      if (
        event.key !== "ArrowDown"
        && event.key !== "ArrowUp"
        && event.key !== "Home"
        && event.key !== "End"
      ) return;
      const items = this.settingsMenuItems();
      if (items.length === 0) return;
      event.preventDefault();
      const currentIndex = items.indexOf(event.target as HTMLButtonElement);
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowUp"
            ? (Math.max(0, currentIndex) - 1 + items.length) % items.length
            : (Math.max(-1, currentIndex) + 1) % items.length;
      items[nextIndex]?.focus({ preventScroll: true });
    }, { signal });
    elements.resetButton.addEventListener("click", () => {
      if (!this.openState || this.disabled) return;
      this.options.onRequestReset();
    }, { signal });
    elements.cancelButton.addEventListener("click", () => {
      if (!this.openState || this.disabled) return;
      this.hideActionMenu();
      this.options.onRequestCancel();
    }, { signal });

    canvas.addEventListener("pointerdown", (event) => {
      if (!this.openState || this.disabled || event.button !== 0) return;
      if (this.pointerId !== null) {
        this.cancelLongPress();
        this.hideActionMenu();
        return;
      }
      this.pointerId = event.pointerId;
      this.pointerStartX = event.clientX;
      this.pointerStartY = event.clientY;
      this.longPressTimer = this.options.browser.setTimeout(() => {
        this.longPressTimer = null;
        if (this.pointerId !== event.pointerId || !this.openState || this.disabled) return;
        this.showActionMenuAt(this.pointerStartX, this.pointerStartY);
      }, LONG_PRESS_DELAY_MS);
    }, { signal, capture: true });
    canvas.addEventListener("pointermove", (event) => {
      if (event.pointerId !== this.pointerId) return;
      if (Math.hypot(
        event.clientX - this.pointerStartX,
        event.clientY - this.pointerStartY,
      ) > LONG_PRESS_MOVEMENT_PX) {
        this.cancelLongPressTimer();
        this.hideActionMenu();
      }
    }, { signal, capture: true });
    canvas.addEventListener("pointerup", (event) => {
      if (event.pointerId === this.pointerId) this.cancelLongPress();
    }, { signal, capture: true });
    for (const type of ["pointercancel", "lostpointercapture"] as const) {
      canvas.addEventListener(type, (event) => {
        if (event.pointerId !== this.pointerId) return;
        this.cancelLongPress();
        this.hideActionMenu();
      }, { signal, capture: true });
    }
    canvas.addEventListener("contextmenu", (event) => {
      if (!this.openState || this.disabled) return;
      event.preventDefault();
      this.showActionMenuAt(event.clientX, event.clientY);
    }, { signal });
    canvas.addEventListener("keydown", (event) => {
      if (!this.openState) return;
      if (event.key === "F10" && event.shiftKey) {
        event.preventDefault();
        const rect = canvas.getBoundingClientRect();
        this.showActionMenuAt(rect.left + rect.width / 2, rect.top + rect.height / 2);
      } else if (event.key === "Escape") {
        if (!elements.actionMenu.hidden || !elements.settingsMenu.hidden) {
          event.preventDefault();
          this.hideMenus();
        }
      }
    }, { signal });
    document.addEventListener("pointerdown", (event) => {
      const target = event.target as Node;
      if (
        !elements.settingsMenu.hidden
        && !elements.settingsMenu.contains(target)
        && !elements.toneButton.contains(target)
      ) this.hideSettingsMenu();
      if (!elements.actionMenu.hidden && !elements.actionMenu.contains(target)) {
        this.hideActionMenu();
      }
    }, { signal, capture: true });
    this.options.browser.addEventListener("blur", () => {
      this.cancelLongPress();
      this.hideMenus();
    }, { signal });
  }

  private showSettingsMenu(): void {
    const { settingsMenu, toneButton } = this.options.elements;
    this.hideActionMenu();
    settingsMenu.hidden = false;
    settingsMenu.setAttribute("aria-hidden", "false");
    toneButton.setAttribute("aria-expanded", "true");
    settingsMenu.querySelector<HTMLButtonElement>(
      '[role="menuitemradio"][aria-checked="true"]',
    )?.focus({ preventScroll: true });
  }

  private settingsMenuItems(): HTMLButtonElement[] {
    return [
      ...this.options.elements.toneButtons,
      this.options.elements.preserveLuminosityButton,
    ].filter((button) => !button.disabled);
  }

  private hideSettingsMenu(): void {
    const { settingsMenu, toneButton } = this.options.elements;
    settingsMenu.hidden = true;
    settingsMenu.setAttribute("aria-hidden", "true");
    toneButton.setAttribute("aria-expanded", "false");
  }

  private hideActionMenu(): void {
    const { actionMenu } = this.options.elements;
    actionMenu.hidden = true;
    actionMenu.setAttribute("aria-hidden", "true");
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

  private showActionMenuAt(clientX: number, clientY: number): void {
    const { actionMenu, surface } = this.options.elements;
    this.hideSettingsMenu();
    actionMenu.hidden = false;
    actionMenu.setAttribute("aria-hidden", "false");
    actionMenu.style.left = "0px";
    actionMenu.style.top = "0px";
    const rect = actionMenu.getBoundingClientRect();
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
    const maxTop = Math.max(safeTop, safeBottom - rect.height);
    const aboveTop = clientY - MENU_TOUCH_GAP_PX - rect.height;
    const belowTop = clientY + MENU_TOUCH_GAP_PX;
    const fitsAbove = aboveTop >= safeTop;
    const fitsBelow = belowTop <= maxTop;
    const spaceAbove = clientY - MENU_TOUCH_GAP_PX - safeTop;
    const spaceBelow = safeBottom - clientY - MENU_TOUCH_GAP_PX;
    const placeBelow = fitsBelow && (!fitsAbove || spaceBelow >= spaceAbove);
    const desiredTop = placeBelow ? belowTop : aboveTop;
    actionMenu.dataset.placement = placeBelow ? "below" : "above";
    actionMenu.style.left = `${Math.min(
      maxLeft,
      Math.max(minLeft, clientX - rect.width / 2),
    )}px`;
    actionMenu.style.top = `${Math.min(maxTop, Math.max(safeTop, desiredTop))}px`;
    actionMenu.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus({ preventScroll: true });
  }

  private syncOpenState(): void {
    const { surface } = this.options.elements;
    surface.hidden = !this.openState;
    surface.setAttribute("aria-hidden", String(!this.openState));
    surface.toggleAttribute("inert", !this.openState);
    surface.classList.toggle("is-open", this.openState);
    this.options.canvas.classList.toggle("raster-color-balance-active", this.openState);
  }
}
