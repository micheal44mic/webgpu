import {
  RASTER_GRADIENT_MAP_MAX_STOPS,
  RASTER_GRADIENT_MAP_MIN_STOPS,
  normalizeRasterGradientMapSettings,
  sampleRasterGradientMapStops,
  type RasterGradientMapInterpolation,
  type RasterGradientMapSettings,
  type RasterGradientMapSettingsInput,
  type RasterGradientMapStop,
} from "./raster-gradient-map-core.ts";

const RASTER_GRADIENT_MAP_INTERPOLATIONS = Object.freeze([
  "perceptual",
  "linear-light",
  "encoded-rgb",
] as const);

export type {
  RasterGradientMapInterpolation,
  RasterGradientMapSettings,
  RasterGradientMapSettingsInput,
  RasterGradientMapStop,
};

export interface RasterGradientMapPreset {
  readonly id: string;
  readonly label: string;
  readonly settings: Readonly<RasterGradientMapSettings>;
}

export interface RasterGradientMapSurfaceElements {
  readonly surface: HTMLElement;
  readonly chooser: HTMLElement;
  readonly presetButtons: readonly HTMLButtonElement[];
  readonly chooserCancelButton: HTMLButtonElement;
  readonly editor: HTMLElement;
  readonly presetsButton: HTMLButtonElement;
  readonly gradientTrack: HTMLElement;
  readonly gradientPreview: HTMLElement;
  readonly stopLayer: HTMLElement;
  readonly colorInput: HTMLInputElement;
  readonly settingsButton: HTMLButtonElement;
  readonly settingsMenu: HTMLElement;
  readonly reverseButton: HTMLButtonElement;
  readonly ditherButton: HTMLButtonElement;
  readonly interpolationButtons: readonly HTMLButtonElement[];
  readonly actionMenu: HTMLElement;
  readonly resetButton: HTMLButtonElement;
  readonly cancelButton: HTMLButtonElement;
}

export interface RasterGradientMapSurfaceBrowser extends Window {
  readonly AbortController: typeof AbortController;
}

export interface RasterGradientMapSurfaceControllerOptions {
  readonly browser: RasterGradientMapSurfaceBrowser;
  readonly document: Document;
  readonly canvas: HTMLCanvasElement;
  readonly elements: RasterGradientMapSurfaceElements;
  readonly presets: readonly RasterGradientMapPreset[];
  readonly onChange: (
    settings: Readonly<RasterGradientMapSettings>,
    selectedPresetId: string | null,
  ) => void;
  readonly onRequestColor?: (stop: Readonly<RasterGradientMapStop>) => void;
  readonly onRequestReset: () => void;
  readonly onRequestCancel: () => void;
}

interface UiStop {
  readonly id: number;
  readonly position: number;
  readonly color: readonly [number, number, number];
  readonly endpoint: boolean;
}

const TOUCH_TARGET_PX = 44;
const STOP_SWATCH_HEIGHT_PX = 25;
const LONG_PRESS_DELAY_MS = 480;
const LONG_PRESS_MOVEMENT_PX = 10;
const DRAG_THRESHOLD_PX = 4;
const MENU_VIEWPORT_MARGIN_PX = 12;
const MENU_TOUCH_GAP_PX = 14;
const POSITION_KEYBOARD_STEP = 0.01;
const POSITION_KEYBOARD_LARGE_STEP = 0.05;

const INTERPOLATION_LABELS: Readonly<Record<RasterGradientMapInterpolation, string>> =
  Object.freeze({
    perceptual: "Perceptual",
    "linear-light": "Linear Light",
    "encoded-rgb": "Encoded RGB",
  });

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function normalizedColor(
  color: readonly [number, number, number],
): readonly [number, number, number] {
  return Object.freeze([clamp01(color[0]), clamp01(color[1]), clamp01(color[2])]);
}

function interpolationFrom(value: string | undefined): RasterGradientMapInterpolation | null {
  return value !== undefined
    && (RASTER_GRADIENT_MAP_INTERPOLATIONS as readonly string[]).includes(value)
    ? value as RasterGradientMapInterpolation
    : null;
}

function channelToHex(channel: number): string {
  return Math.round(clamp01(channel) * 255).toString(16).padStart(2, "0");
}

function colorToHex(color: readonly [number, number, number]): string {
  return `#${channelToHex(color[0])}${channelToHex(color[1])}${channelToHex(color[2])}`;
}

function colorFromHex(value: string): readonly [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const packed = match[1];
  return Object.freeze([
    Number.parseInt(packed.slice(0, 2), 16) / 255,
    Number.parseInt(packed.slice(2, 4), 16) / 255,
    Number.parseInt(packed.slice(4, 6), 16) / 255,
  ]);
}

function colorToCss(color: readonly [number, number, number]): string {
  return `rgb(${Math.round(clamp01(color[0]) * 255)} ${Math.round(clamp01(color[1]) * 255)} ${Math.round(clamp01(color[2]) * 255)})`;
}

function cloneSettings(settings: RasterGradientMapSettingsInput): RasterGradientMapSettings {
  return normalizeRasterGradientMapSettings(settings);
}

function setTouchTarget(element: HTMLElement): void {
  element.style.minWidth = `${TOUCH_TARGET_PX}px`;
  element.style.minHeight = `${TOUCH_TARGET_PX}px`;
}

/** Owns preset selection, stop editing, settings and recovery actions for Gradient Map. */
export class RasterGradientMapSurfaceController {
  private readonly abortController: AbortController;
  private stopHandlesAbortController: AbortController | null = null;
  private readonly presetsById = new Map<string, RasterGradientMapPreset>();
  private stops: UiStop[] = [];
  private reverse = false;
  private dither = false;
  private interpolation: RasterGradientMapInterpolation = "perceptual";
  private selectedPresetId: string | null = null;
  private baselinePresetId: string | null = null;
  private baselineSettings: Readonly<RasterGradientMapSettings> | null = null;
  private selectedStopId: number | null = null;
  private nextStopId = 1;
  private openState = false;
  private editorState = false;
  private disabled = false;
  private cancellationAvailable = true;
  private pointerId: number | null = null;
  private pointerStartX = 0;
  private pointerStartY = 0;
  private longPressTimer: number | null = null;
  private draggedStopId: number | null = null;
  private dragPointerId: number | null = null;
  private dragStartX = 0;
  private dragMoved = false;
  private stopLongPressTimer: number | null = null;
  private stopLongPressTriggered = false;
  private lastColorInputValue = "";
  private previousCanvasTabIndex: number | null = null;
  private previousCanvasShortcuts: string | null = null;
  private previousFocus: HTMLElement | null = null;
  private disposed = false;

  constructor(private readonly options: RasterGradientMapSurfaceControllerOptions) {
    this.abortController = new options.browser.AbortController();
    for (const preset of options.presets) {
      if (!preset.id || this.presetsById.has(preset.id)) {
        throw new Error("Gradient map preset identifiers must be unique and non-empty.");
      }
      this.presetsById.set(preset.id, Object.freeze({
        id: preset.id,
        label: preset.label,
        settings: cloneSettings(preset.settings),
      }));
    }
    this.configureElements();
    this.bindEvents();
    this.syncOpenState();
  }

  get isOpen(): boolean {
    return this.openState;
  }

  get isEditing(): boolean {
    return this.editorState;
  }

  get activePresetId(): string | null {
    return this.selectedPresetId;
  }

  get state(): Readonly<RasterGradientMapSettings> | null {
    return this.editorState ? this.publicSettings() : null;
  }

  open(): boolean {
    if (this.disposed) return false;
    if (this.openState) {
      this.showChooser();
      return true;
    }
    this.openState = true;
    this.editorState = false;
    this.selectedPresetId = null;
    this.baselinePresetId = null;
    this.baselineSettings = null;
    this.selectedStopId = null;
    this.stops = [];
    const activeElement = this.options.document.activeElement as HTMLElement | null;
    this.previousFocus = activeElement && typeof activeElement.focus === "function"
      ? activeElement
      : null;
    this.previousCanvasTabIndex = this.options.canvas.tabIndex;
    this.previousCanvasShortcuts = this.options.canvas.getAttribute("aria-keyshortcuts");
    this.options.canvas.tabIndex = 0;
    this.options.canvas.setAttribute("aria-keyshortcuts", "Shift+F10 Escape");
    this.syncOpenState();
    this.options.elements.presetButtons[0]?.focus({ preventScroll: true });
    return true;
  }

  close(): void {
    if (!this.openState) return;
    this.openState = false;
    this.editorState = false;
    this.cancelLongPress();
    this.endStopDrag();
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
    const focusTarget = this.previousFocus;
    this.previousFocus = null;
    if (focusTarget?.isConnected !== false) focusTarget?.focus({ preventScroll: true });
  }

  setDisabled(disabled: boolean, cancellationAvailable = true): void {
    this.disabled = disabled;
    this.cancellationAvailable = cancellationAvailable;
    const { elements } = this.options;
    for (const button of this.allStaticButtons()) {
      const cancellationControl = button === elements.chooserCancelButton
        || button === elements.cancelButton;
      button.disabled = disabled && (!cancellationControl || !cancellationAvailable);
    }
    for (const handle of this.stopHandles()) handle.disabled = disabled;
    elements.colorInput.disabled = disabled;
    elements.surface.setAttribute("aria-busy", String(disabled));
    if (disabled) {
      this.cancelLongPress();
      this.endStopDrag();
      this.hideMenus();
    }
  }

  setState(
    settings: Readonly<RasterGradientMapSettings>,
    selectedPresetId: string | null = null,
  ): void {
    const normalized = cloneSettings(settings);
    this.stops = normalized.stops.map((stop, index, stops) => ({
      ...stop,
      id: this.nextStopId++,
      endpoint: index === 0 || index === stops.length - 1,
    }));
    this.reverse = normalized.reverse;
    this.dither = normalized.dither;
    this.interpolation = normalized.interpolation;
    this.selectedPresetId = selectedPresetId && this.presetsById.has(selectedPresetId)
      ? selectedPresetId
      : null;
    if (this.selectedPresetId) {
      this.baselinePresetId = this.selectedPresetId;
      this.baselineSettings = normalized;
    }
    this.selectedStopId = this.stops[0]?.id ?? null;
    this.editorState = true;
    this.hideMenus();
    this.syncPhase();
    this.syncEditor();
  }

  showChooser(): void {
    if (!this.openState) return;
    this.cancelLongPress();
    this.endStopDrag();
    this.editorState = false;
    this.hideMenus();
    this.syncPhase();
    this.syncPresetSelection();
    this.options.elements.presetButtons[0]?.focus({ preventScroll: true });
  }

  reset(): void {
    if (!this.editorState || !this.baselineSettings || !this.baselinePresetId) return;
    this.setState(this.baselineSettings, this.baselinePresetId);
  }

  hideMenus(): void {
    this.hideSettingsMenu();
    this.hideActionMenu();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.close();
    this.abortController.abort();
    this.clearStopHandles();
  }

  private allStaticButtons(): readonly HTMLButtonElement[] {
    const { elements } = this.options;
    return [
      ...elements.presetButtons,
      elements.chooserCancelButton,
      elements.presetsButton,
      elements.settingsButton,
      elements.reverseButton,
      elements.ditherButton,
      ...elements.interpolationButtons,
      elements.resetButton,
      elements.cancelButton,
    ];
  }

  private configureElements(): void {
    const { elements } = this.options;
    elements.colorInput.type = "color";
    setTouchTarget(elements.gradientTrack);
    for (const button of this.allStaticButtons()) setTouchTarget(button);
    for (const button of elements.presetButtons) {
      const id = button.dataset.gradientMapPresetId;
      const preset = id ? this.presetsById.get(id) : null;
      if (preset && !button.getAttribute("aria-label")) {
        button.setAttribute("aria-label", preset.label);
      }
      button.setAttribute("aria-pressed", "false");
    }
    elements.settingsButton.setAttribute("aria-haspopup", "menu");
    elements.settingsButton.setAttribute("aria-expanded", "false");
    elements.presetsButton.setAttribute("aria-label", "Choose another gradient preset");
    elements.chooserCancelButton.setAttribute("aria-label", "Close Gradient Map");
    elements.reverseButton.setAttribute("role", "menuitemcheckbox");
    elements.ditherButton.setAttribute("role", "menuitemcheckbox");
    elements.gradientTrack.setAttribute("role", "group");
    elements.gradientTrack.setAttribute("aria-label", "Gradient color stops");
    elements.gradientTrack.tabIndex = 0;
    this.syncPhase();
  }

  private bindEvents(): void {
    const signal = this.abortController.signal;
    const { browser, canvas, document, elements } = this.options;

    for (const button of elements.presetButtons) {
      button.addEventListener("click", () => {
        if (!this.openState || this.disabled) return;
        const id = button.dataset.gradientMapPresetId;
        const preset = id ? this.presetsById.get(id) : null;
        if (!preset) return;
        this.setState(preset.settings, preset.id);
        this.emitChange();
        this.focusSelectedStop();
      }, { signal });
    }
    elements.chooserCancelButton.addEventListener("click", () => {
      if (!this.openState || !this.cancellationAvailable) return;
      this.options.onRequestCancel();
    }, { signal });
    elements.chooser.addEventListener("keydown", (event) => {
      if (!this.openState || this.editorState) return;
      if (event.key === "Escape") {
        if (!this.cancellationAvailable) return;
        event.preventDefault();
        this.options.onRequestCancel();
        return;
      }
      if (this.disabled) return;
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
        return;
      }
      const buttons = elements.presetButtons.filter((button) => !button.disabled);
      if (buttons.length === 0) return;
      event.preventDefault();
      const currentIndex = buttons.indexOf(event.target as HTMLButtonElement);
      const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (Math.max(0, currentIndex) + direction + buttons.length) % buttons.length;
      buttons[nextIndex]?.focus({ preventScroll: true });
    }, { signal });

    elements.presetsButton.addEventListener("click", () => {
      if (!this.canEdit()) return;
      this.showChooser();
    }, { signal });

    elements.gradientTrack.addEventListener("pointerdown", (event) => {
      if (!this.canEdit() || event.button !== 0) return;
      const target = event.target as HTMLElement;
      if (target.closest?.("[data-gradient-map-stop-id]")) return;
      event.preventDefault();
      const stop = this.addStopAt(this.logicalPositionFromClientX(event.clientX));
      if (!stop) return;
      this.selectedStopId = stop.id;
      this.markCustom();
      this.syncEditor();
      this.emitChange();
      this.requestSelectedColor();
    }, { signal });
    elements.gradientTrack.addEventListener("keydown", (event) => {
      if (!this.canEdit() || event.target !== elements.gradientTrack) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      const stop = this.addStopAt(this.largestGapMidpoint());
      if (!stop) return;
      this.selectedStopId = stop.id;
      this.markCustom();
      this.syncEditor();
      this.emitChange();
      this.requestSelectedColor();
    }, { signal });

    elements.colorInput.addEventListener("input", () => this.applyColorInput(false), { signal });
    elements.colorInput.addEventListener("change", () => this.applyColorInput(true), { signal });

    elements.settingsButton.addEventListener("click", () => {
      if (!this.canEdit()) return;
      if (elements.settingsMenu.hidden) this.showSettingsMenu();
      else this.hideSettingsMenu();
    }, { signal });
    elements.settingsButton.addEventListener("keydown", (event) => {
      if (!this.canEdit() || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
      event.preventDefault();
      this.showSettingsMenu();
      const items = this.settingsMenuItems();
      (event.key === "ArrowUp" ? items.at(-1) : items[0])
        ?.focus({ preventScroll: true });
    }, { signal });
    elements.reverseButton.addEventListener("click", () => {
      if (!this.canEdit()) return;
      this.reverse = !this.reverse;
      this.markCustom();
      this.syncEditor();
      this.emitChange();
    }, { signal });
    elements.ditherButton.addEventListener("click", () => {
      if (!this.canEdit()) return;
      this.dither = !this.dither;
      this.markCustom();
      this.syncEditor();
      this.emitChange();
    }, { signal });
    for (const button of elements.interpolationButtons) {
      button.addEventListener("click", () => {
        if (!this.canEdit()) return;
        const interpolation = interpolationFrom(button.dataset.gradientMapInterpolation);
        if (!interpolation) return;
        this.interpolation = interpolation;
        this.markCustom();
        this.syncEditor();
        this.emitChange();
        this.hideSettingsMenu();
        elements.settingsButton.focus({ preventScroll: true });
      }, { signal });
    }
    elements.settingsMenu.addEventListener("keydown", (event) => {
      if (elements.settingsMenu.hidden) return;
      if (event.key === "Escape") {
        event.preventDefault();
        this.hideSettingsMenu();
        elements.settingsButton.focus({ preventScroll: true });
        return;
      }
      if (event.key === "Tab") {
        this.hideSettingsMenu();
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
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
      this.hideActionMenu();
      this.options.onRequestReset();
    }, { signal });
    elements.cancelButton.addEventListener("click", () => {
      if (!this.openState || !this.cancellationAvailable) return;
      this.hideActionMenu();
      this.options.onRequestCancel();
    }, { signal });

    canvas.addEventListener("pointerdown", (event) => {
      if (!this.canOpenActionMenu() || event.button !== 0) return;
      if (this.pointerId !== null) {
        this.cancelLongPress();
        this.hideActionMenu();
        return;
      }
      this.pointerId = event.pointerId;
      this.pointerStartX = event.clientX;
      this.pointerStartY = event.clientY;
      this.longPressTimer = browser.setTimeout(() => {
        this.longPressTimer = null;
        if (
          this.pointerId !== event.pointerId
          || !this.canOpenActionMenu()
        ) return;
        this.showActionMenuAt(this.pointerStartX, this.pointerStartY);
      }, LONG_PRESS_DELAY_MS);
    }, { signal, capture: true });
    canvas.addEventListener("pointermove", (event) => {
      if (event.pointerId !== this.pointerId) return;
      if (Math.hypot(event.clientX - this.pointerStartX, event.clientY - this.pointerStartY)
        > LONG_PRESS_MOVEMENT_PX) {
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
      if (!this.canOpenActionMenu()) return;
      event.preventDefault();
      this.showActionMenuAt(event.clientX, event.clientY);
    }, { signal });
    canvas.addEventListener("keydown", (event) => {
      if (!this.openState || !this.editorState) return;
      if (event.key === "F10" && event.shiftKey) {
        if (!this.canOpenActionMenu()) return;
        event.preventDefault();
        const rect = canvas.getBoundingClientRect();
        this.showActionMenuAt(rect.left + rect.width / 2, rect.top + rect.height / 2);
      } else if (event.key === "Escape" && (!elements.actionMenu.hidden || !elements.settingsMenu.hidden)) {
        event.preventDefault();
        this.hideMenus();
      } else if (event.key === "Escape") {
        if (!this.cancellationAvailable) return;
        event.preventDefault();
        this.options.onRequestCancel();
      }
    }, { signal });

    const handleSurfaceKeydown = (event: KeyboardEvent): void => {
      if (!this.openState || event.defaultPrevented) return;
      if (event.key === "F10" && event.shiftKey && this.canOpenActionMenu()) {
        event.preventDefault();
        const rect = canvas.getBoundingClientRect();
        this.showActionMenuAt(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return;
      }
      if (event.key !== "Escape") return;
      if (!elements.actionMenu.hidden) {
        event.preventDefault();
        this.hideActionMenu();
        elements.gradientTrack.focus({ preventScroll: true });
        return;
      }
      if (!this.editorState || !this.cancellationAvailable) return;
      event.preventDefault();
      this.options.onRequestCancel();
    };
    elements.surface.addEventListener("keydown", handleSurfaceKeydown, { signal });
    elements.actionMenu.addEventListener("keydown", handleSurfaceKeydown, { signal });

    document.addEventListener("pointerdown", (event) => {
      const target = event.target as Node;
      if (!elements.settingsMenu.hidden
        && !elements.settingsMenu.contains(target)
        && !elements.settingsButton.contains(target)) {
        this.hideSettingsMenu();
      }
      if (!elements.actionMenu.hidden && !elements.actionMenu.contains(target)) {
        this.hideActionMenu();
      }
    }, { signal, capture: true });
    document.addEventListener("focusin", (event) => {
      const target = event.target as Node;
      if (!elements.settingsMenu.hidden
        && !elements.settingsMenu.contains(target)
        && target !== elements.settingsButton) {
        this.hideSettingsMenu();
      }
      if (!elements.actionMenu.hidden && !elements.actionMenu.contains(target)) {
        this.hideActionMenu();
      }
    }, { signal });
    browser.addEventListener("blur", () => {
      this.cancelLongPress();
      this.endStopDrag();
      this.hideMenus();
    }, { signal });
  }

  private canEdit(): boolean {
    return this.openState && this.editorState && !this.disabled;
  }

  private canOpenActionMenu(): boolean {
    return this.openState
      && this.editorState
      && (!this.disabled || this.cancellationAvailable);
  }

  private publicSettings(): Readonly<RasterGradientMapSettings> {
    return Object.freeze({
      stops: Object.freeze(this.sortedStops().map((stop) => Object.freeze({
        position: stop.position,
        color: normalizedColor(stop.color),
      }))),
      reverse: this.reverse,
      dither: this.dither,
      interpolation: this.interpolation,
    });
  }

  private emitChange(): void {
    if (!this.canEdit()) return;
    this.options.onChange(this.publicSettings(), this.selectedPresetId);
  }

  private sortedStops(): UiStop[] {
    return [...this.stops].sort((left, right) => left.position - right.position || left.id - right.id);
  }

  private selectedStop(): UiStop | null {
    return this.stops.find((stop) => stop.id === this.selectedStopId) ?? null;
  }

  private markCustom(): void {
    this.selectedPresetId = null;
    this.syncPresetSelection();
  }

  private syncOpenState(): void {
    const { surface } = this.options.elements;
    surface.hidden = !this.openState;
    surface.setAttribute("aria-hidden", String(!this.openState));
    surface.toggleAttribute("inert", !this.openState);
    surface.classList.toggle("is-open", this.openState);
    this.options.canvas.classList.toggle("raster-gradient-map-active", this.openState);
    this.syncPhase();
  }

  private syncPhase(): void {
    const { surface, chooser, editor } = this.options.elements;
    chooser.hidden = !this.openState || this.editorState;
    editor.hidden = !this.openState || !this.editorState;
    chooser.setAttribute("aria-hidden", String(chooser.hidden));
    editor.setAttribute("aria-hidden", String(editor.hidden));
    chooser.toggleAttribute("inert", chooser.hidden);
    editor.toggleAttribute("inert", editor.hidden);
    surface.classList.toggle("is-chooser", this.openState && !this.editorState);
  }

  private syncEditor(): void {
    if (!this.editorState) return;
    this.syncPresetSelection();
    this.syncGradientPreview();
    this.renderStopHandles();
    const { elements } = this.options;
    elements.reverseButton.setAttribute("aria-checked", String(this.reverse));
    elements.reverseButton.classList.toggle("is-enabled", this.reverse);
    elements.ditherButton.setAttribute("aria-checked", String(this.dither));
    elements.ditherButton.classList.toggle("is-enabled", this.dither);
    for (const button of elements.interpolationButtons) {
      const selected = button.dataset.gradientMapInterpolation === this.interpolation;
      button.setAttribute("aria-checked", String(selected));
      button.classList.toggle("is-selected", selected);
      if (selected && !button.getAttribute("aria-label")) {
        button.setAttribute("aria-label", INTERPOLATION_LABELS[this.interpolation]);
      }
    }
  }

  private syncPresetSelection(): void {
    for (const button of this.options.elements.presetButtons) {
      const selected = button.dataset.gradientMapPresetId === this.selectedPresetId;
      button.setAttribute("aria-pressed", String(selected));
      button.classList.toggle("is-selected", selected);
    }
  }

  private visualPosition(position: number): number {
    return this.reverse ? 1 - position : position;
  }

  private logicalPosition(visualPosition: number): number {
    return this.reverse ? 1 - visualPosition : visualPosition;
  }

  private syncGradientPreview(): void {
    const cssStops = this.sortedStops()
      .map((stop) => ({ stop, visual: this.visualPosition(stop.position) }))
      .sort((left, right) => left.visual - right.visual)
      .map(({ stop, visual }) => `${colorToCss(stop.color)} ${(visual * 100).toFixed(3)}%`)
      .join(", ");
    this.options.elements.gradientPreview.style.background = `linear-gradient(to right, ${cssStops})`;
  }

  private clearStopHandles(): void {
    this.stopHandlesAbortController?.abort();
    this.stopHandlesAbortController = null;
    this.options.elements.stopLayer.replaceChildren();
  }

  private stopHandles(): HTMLButtonElement[] {
    return Array.from(this.options.elements.stopLayer.querySelectorAll<HTMLButtonElement>(
      "[data-gradient-map-stop-id]",
    ));
  }

  private renderStopHandles(): void {
    const { document, elements } = this.options;
    this.clearStopHandles();
    this.stopHandlesAbortController = new this.options.browser.AbortController();
    const signal = this.stopHandlesAbortController.signal;
    for (const stop of this.sortedStops()) {
      const handle = document.createElement("button");
      const visualPosition = this.visualPosition(stop.position);
      handle.type = "button";
      handle.className = "gradient-map-stop";
      handle.dataset.gradientMapStopId = String(stop.id);
      handle.style.left = `${(visualPosition * 100).toFixed(3)}%`;
      handle.style.setProperty("--gradient-map-stop-color", colorToCss(stop.color));
      handle.style.width = `${TOUCH_TARGET_PX}px`;
      handle.style.height = `${TOUCH_TARGET_PX}px`;
      handle.style.touchAction = "none";
      handle.disabled = this.disabled;
      handle.setAttribute(
        "aria-label",
        `${stop.endpoint ? "Endpoint" : "Color"} stop at ${Math.round(visualPosition * 100)} percent`,
      );
      handle.setAttribute("aria-valuemin", "0");
      handle.setAttribute("aria-valuemax", "100");
      handle.setAttribute("aria-valuenow", String(Math.round(visualPosition * 100)));
      handle.setAttribute("aria-pressed", String(stop.id === this.selectedStopId));
      handle.classList.toggle("is-selected", stop.id === this.selectedStopId);
      this.bindStopHandle(handle, stop.id, signal);
      elements.stopLayer.append(handle);
    }
  }

  private bindStopHandle(
    handle: HTMLButtonElement,
    stopId: number,
    signal: AbortSignal,
  ): void {
    handle.addEventListener("pointerdown", (event) => {
      if (!this.canEdit() || event.button !== 0) return;
      event.preventDefault();
      this.selectedStopId = stopId;
      this.draggedStopId = stopId;
      this.dragPointerId = event.pointerId;
      this.dragStartX = event.clientX;
      this.dragMoved = false;
      this.stopLongPressTriggered = false;
      this.cancelStopLongPressTimer();
      this.stopLongPressTimer = this.options.browser.setTimeout(() => {
        this.stopLongPressTimer = null;
        if (this.dragPointerId !== event.pointerId || this.draggedStopId !== stopId) return;
        this.stopLongPressTriggered = true;
        this.selectedStopId = stopId;
        this.deleteSelectedStop();
        this.endStopDrag();
      }, LONG_PRESS_DELAY_MS);
      handle.setPointerCapture?.(event.pointerId);
      this.syncStopSelection();
    }, { signal });
    handle.addEventListener("pointermove", (event) => {
      if (event.pointerId !== this.dragPointerId || this.draggedStopId !== stopId) return;
      if (Math.abs(event.clientX - this.dragStartX) >= DRAG_THRESHOLD_PX) {
        this.dragMoved = true;
        this.cancelStopLongPressTimer();
      }
      if (!this.dragMoved) return;
      this.moveStop(stopId, this.logicalPositionFromClientX(event.clientX), true);
    }, { signal });
    handle.addEventListener("pointerup", (event) => {
      if (event.pointerId !== this.dragPointerId || this.draggedStopId !== stopId) return;
      const moved = this.dragMoved;
      const longPressed = this.stopLongPressTriggered;
      this.endStopDrag();
      if (!moved && !longPressed) this.requestSelectedColor();
    }, { signal });
    handle.addEventListener("pointercancel", () => this.endStopDrag(), { signal });
    handle.addEventListener("lostpointercapture", () => this.endStopDrag(), { signal });
    handle.addEventListener("contextmenu", (event) => {
      if (!this.canEdit()) return;
      event.preventDefault();
      this.selectedStopId = stopId;
      this.deleteSelectedStop();
    }, { signal });
    handle.addEventListener("keydown", (event) => {
      if (!this.canEdit()) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.selectedStopId = stopId;
        this.requestSelectedColor();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        this.selectedStopId = stopId;
        this.deleteSelectedStop();
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight"
        && event.key !== "Home" && event.key !== "End") return;
      event.preventDefault();
      const stop = this.stops.find((candidate) => candidate.id === stopId);
      if (!stop) return;
      const delta = event.shiftKey ? POSITION_KEYBOARD_LARGE_STEP : POSITION_KEYBOARD_STEP;
      const visualPosition = this.visualPosition(stop.position);
      const nextVisualPosition = event.key === "Home"
        ? 0
        : event.key === "End"
          ? 1
          : visualPosition + (event.key === "ArrowLeft" ? -delta : delta);
      this.moveStop(stopId, this.logicalPosition(clamp01(nextVisualPosition)));
      this.focusStop(stopId);
    }, { signal });
  }

  private syncStopSelection(): void {
    this.syncStopHandleState();
  }

  private syncStopHandleState(): void {
    for (const handle of this.stopHandles()) {
      const stopId = Number(handle.dataset.gradientMapStopId);
      const stop = this.stops.find((candidate) => candidate.id === stopId);
      if (!stop) continue;
      const selected = stopId === this.selectedStopId;
      const visualPosition = this.visualPosition(stop.position);
      handle.style.left = `${(visualPosition * 100).toFixed(3)}%`;
      handle.style.setProperty("--gradient-map-stop-color", colorToCss(stop.color));
      handle.setAttribute(
        "aria-label",
        `${stop.endpoint ? "Endpoint" : "Color"} stop at ${Math.round(visualPosition * 100)} percent`,
      );
      handle.setAttribute("aria-valuenow", String(Math.round(visualPosition * 100)));
      handle.setAttribute("aria-pressed", String(selected));
      handle.classList.toggle("is-selected", selected);
    }
  }

  private focusStop(stopId: number): void {
    this.options.elements.stopLayer.querySelector<HTMLButtonElement>(
      `[data-gradient-map-stop-id="${stopId}"]`,
    )?.focus({ preventScroll: true });
  }

  private focusSelectedStop(): void {
    if (this.selectedStopId !== null) this.focusStop(this.selectedStopId);
  }

  private logicalPositionFromClientX(clientX: number): number {
    const rect = this.options.elements.gradientTrack.getBoundingClientRect();
    const visual = rect.width > 0 ? clamp01((clientX - rect.left) / rect.width) : 0.5;
    return this.logicalPosition(visual);
  }

  private largestGapMidpoint(): number {
    const positions = this.sortedStops().map((stop) => stop.position);
    let bestStart = 0;
    let bestEnd = positions[0] ?? 1;
    for (let index = 1; index < positions.length; index += 1) {
      if (positions[index] - positions[index - 1] > bestEnd - bestStart) {
        bestStart = positions[index - 1];
        bestEnd = positions[index];
      }
    }
    if (1 - (positions.at(-1) ?? 0) > bestEnd - bestStart) {
      bestStart = positions.at(-1) ?? 0;
      bestEnd = 1;
    }
    return (bestStart + bestEnd) / 2;
  }

  private interpolatedColor(position: number): readonly [number, number, number] {
    return normalizedColor(sampleRasterGradientMapStops(
      this.publicSettings().stops,
      position,
      this.interpolation,
    ));
  }

  private addStopAt(position: number): UiStop | null {
    if (this.stops.length >= RASTER_GRADIENT_MAP_MAX_STOPS) return null;
    const stop: UiStop = {
      id: this.nextStopId++,
      position: clamp01(position),
      color: this.interpolatedColor(position),
      endpoint: false,
    };
    this.stops.push(stop);
    return stop;
  }

  private moveStop(stopId: number, position: number, preserveHandles = false): void {
    const index = this.stops.findIndex((stop) => stop.id === stopId);
    if (index < 0) return;
    const nextPosition = clamp01(position);
    if (this.stops[index].position === nextPosition) return;
    this.stops[index] = { ...this.stops[index], position: nextPosition };
    this.selectedStopId = stopId;
    this.markCustom();
    if (preserveHandles) {
      this.syncGradientPreview();
      this.syncStopHandleState();
    } else {
      this.syncEditor();
    }
    this.emitChange();
  }

  private deleteSelectedStop(): void {
    if (this.stops.length <= RASTER_GRADIENT_MAP_MIN_STOPS || this.selectedStopId === null) return;
    const sorted = this.sortedStops();
    const removedIndex = sorted.findIndex((stop) => stop.id === this.selectedStopId);
    if (removedIndex < 0) return;
    if (sorted[removedIndex].endpoint) return;
    const removedId = this.selectedStopId;
    this.stops = this.stops.filter((stop) => stop.id !== removedId);
    const remaining = this.sortedStops();
    this.selectedStopId = remaining[Math.min(removedIndex, remaining.length - 1)]?.id ?? null;
    this.markCustom();
    this.syncEditor();
    this.emitChange();
    this.focusSelectedStop();
  }

  private requestSelectedColor(): void {
    const stop = this.selectedStop();
    if (!stop || !this.canEdit()) return;
    this.options.onRequestColor?.(Object.freeze({
      position: stop.position,
      color: normalizedColor(stop.color),
    }));
    const value = colorToHex(stop.color);
    this.lastColorInputValue = value;
    const input = this.options.elements.colorInput;
    input.value = value;
    this.positionColorInputAboveSelectedStop();
    try {
      if (typeof input.showPicker === "function") {
        input.showPicker();
        return;
      }
    } catch {
      // A browser can reject showPicker even during a pointer gesture. The
      // regular click path keeps the same anchored input as a fallback.
    }
    input.click();
  }

  private positionColorInputAboveSelectedStop(): void {
    if (this.selectedStopId === null) return;
    const { elements } = this.options;
    const handle = elements.stopLayer.querySelector<HTMLButtonElement>(
      `[data-gradient-map-stop-id="${this.selectedStopId}"]`,
    );
    if (!handle) return;
    const surfaceRect = elements.surface.getBoundingClientRect();
    const handleRect = handle.getBoundingClientRect();
    const anchorX = Math.min(
      Math.max(16, handleRect.left + handleRect.width / 2 - surfaceRect.left),
      Math.max(16, surfaceRect.width - 16),
    );
    const swatchTop = handleRect.top + (handleRect.height - STOP_SWATCH_HEIGHT_PX) / 2;
    const anchorY = Math.max(8, swatchTop - surfaceRect.top - 4);
    elements.colorInput.style.left = `${anchorX.toFixed(2)}px`;
    elements.colorInput.style.top = `${anchorY.toFixed(2)}px`;
  }

  private applyColorInput(finalize: boolean): void {
    if (!this.canEdit() || this.selectedStopId === null) return;
    const value = this.options.elements.colorInput.value.toLowerCase();
    if (value !== this.lastColorInputValue) {
      const color = colorFromHex(value);
      if (!color) return;
      this.lastColorInputValue = value;
      const index = this.stops.findIndex((stop) => stop.id === this.selectedStopId);
      if (index >= 0 && colorToHex(this.stops[index].color) !== value) {
        this.stops[index] = { ...this.stops[index], color };
        this.markCustom();
        this.syncGradientPreview();
        this.syncStopHandleState();
        this.emitChange();
      }
    }
    if (finalize) this.focusSelectedStop();
  }

  private endStopDrag(): void {
    this.cancelStopLongPressTimer();
    this.draggedStopId = null;
    this.dragPointerId = null;
    this.dragMoved = false;
    this.stopLongPressTriggered = false;
  }

  private cancelStopLongPressTimer(): void {
    if (this.stopLongPressTimer === null) return;
    this.options.browser.clearTimeout(this.stopLongPressTimer);
    this.stopLongPressTimer = null;
  }

  private settingsMenuItems(): HTMLButtonElement[] {
    return [
      this.options.elements.reverseButton,
      this.options.elements.ditherButton,
      ...this.options.elements.interpolationButtons,
    ].filter((button) => !button.disabled);
  }

  private showSettingsMenu(): void {
    const { settingsMenu, settingsButton } = this.options.elements;
    this.hideActionMenu();
    settingsMenu.hidden = false;
    settingsMenu.setAttribute("aria-hidden", "false");
    settingsButton.setAttribute("aria-expanded", "true");
  }

  private hideSettingsMenu(): void {
    const { settingsMenu, settingsButton } = this.options.elements;
    settingsMenu.hidden = true;
    settingsMenu.setAttribute("aria-hidden", "true");
    settingsButton.setAttribute("aria-expanded", "false");
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
    actionMenu.dataset.placement = placeBelow ? "below" : "above";
    actionMenu.style.left = `${Math.min(
      maxLeft,
      Math.max(minLeft, clientX - rect.width / 2),
    )}px`;
    actionMenu.style.top = `${Math.min(
      maxTop,
      Math.max(safeTop, placeBelow ? belowTop : aboveTop),
    )}px`;
    actionMenu.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus({ preventScroll: true });
  }
}
