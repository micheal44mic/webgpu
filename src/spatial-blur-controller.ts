import type { BrushEngine } from "./brush-engine";
import {
  SPATIAL_BLUR_DEFAULT_RADIUS,
  SPATIAL_BLUR_MAX_PIN_COUNT,
  SPATIAL_BLUR_MAX_RADIUS,
  normalizeSpatialBlurPins,
  spatialBlurRadiusAt,
  type SpatialBlurPin,
} from "./spatial-blur-core";
import {
  hitTestSpatialBlurPins,
  isSpatialBlurMode,
  spatialBlurAdjustedRadius,
  spatialBlurPinFillPercent,
  spatialBlurPointerMoved,
  type SpatialBlurMode,
  type SpatialBlurScreenPin,
} from "./spatial-blur-interaction-core";

type SpatialBlurViewEnginePort = Pick<
  BrushEngine,
  "getVectorTextViewState" | "toLayerPoint"
>;

export interface SpatialBlurControllerBrowser extends Window {
  readonly AbortController: typeof AbortController;
}

export interface SpatialBlurControllerElements {
  readonly canvas: HTMLCanvasElement;
  readonly overlay: HTMLElement;
  readonly pinLayer: HTMLElement;
  readonly topBar: HTMLElement;
  readonly dock: HTMLElement;
  readonly modeButtons: readonly HTMLButtonElement[];
  readonly status: HTMLOutputElement;
  readonly cancelButton: HTMLButtonElement;
  readonly applyButton: HTMLButtonElement;
}

export interface SpatialBlurPointerInput {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly clientX: number;
  readonly clientY: number;
}

export interface SpatialBlurControllerOptions {
  readonly browser: SpatialBlurControllerBrowser;
  readonly document: Document;
  readonly engine: SpatialBlurViewEnginePort;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly elements: SpatialBlurControllerElements;
  readonly onPinsChange: (pins: readonly SpatialBlurPin[]) => void;
  readonly onRequestCancel: () => void;
  readonly onRequestApply: () => void;
}

interface UiSpatialBlurPin extends SpatialBlurPin {
  readonly id: number;
}

type PointerGestureKind = "pending-add" | "move" | "adjust" | "pending-remove" | "none";

interface SpatialBlurPointerGesture {
  readonly pointerId: number;
  readonly kind: PointerGestureKind;
  readonly pinId: number | null;
  readonly initialClientX: number;
  readonly initialClientY: number;
  readonly initialPins: readonly UiSpatialBlurPin[];
  readonly initialRadius: number;
  moved: boolean;
}

function copyUiPins(pins: readonly Readonly<UiSpatialBlurPin>[]): UiSpatialBlurPin[] {
  return pins.map((pin) => ({ ...pin }));
}

function copyEnginePins(pins: readonly Readonly<UiSpatialBlurPin>[]): SpatialBlurPin[] {
  return pins.map(({ x, y, radius }) => ({ x, y, radius }));
}

/** Owns the persistent Point Blur bars, pin overlay and edit gestures. */
export class SpatialBlurController {
  private readonly abortController: AbortController;
  private pins: UiSpatialBlurPin[] = [];
  private nextPinId = 1;
  private selectedPinId: number | null = null;
  private mode: SpatialBlurMode = "add";
  private gesture: SpatialBlurPointerGesture | null = null;
  private previewFrame: number | null = null;
  private previewPending = false;
  private openState = false;
  private busy = false;
  private recoveryOnly = false;
  private disposed = false;

  constructor(private readonly options: SpatialBlurControllerOptions) {
    this.abortController = new options.browser.AbortController();
    this.bindControls();
    this.syncSurface();
  }

  get isOpen(): boolean {
    return this.openState;
  }

  get activeMode(): SpatialBlurMode {
    return this.mode;
  }

  get currentPins(): readonly SpatialBlurPin[] {
    return copyEnginePins(this.pins);
  }

  open(pins: readonly Readonly<SpatialBlurPin>[]): boolean {
    if (this.disposed || this.openState) return false;
    this.openState = true;
    this.mode = "add";
    this.replacePins(pins);
    this.selectedPinId = this.pins[0]?.id ?? null;
    this.setStatus(this.selectedPinId === null
      ? "ADD · Tap the canvas to add a point."
      : `Point 1 · ${this.pins[0].radius.toFixed(0)} px`);
    this.syncSurface();
    this.renderPins();
    return true;
  }

  close(): void {
    if (!this.openState) return;
    this.cancelPointerGestureForNavigation();
    this.openState = false;
    this.busy = false;
    this.recoveryOnly = false;
    this.cancelScheduledPreview();
    this.pins = [];
    this.selectedPinId = null;
    this.syncSurface();
    this.options.elements.pinLayer.replaceChildren();
  }

  setTransactionState(busy: boolean, recoveryOnly: boolean): void {
    this.busy = busy;
    this.recoveryOnly = recoveryOnly;
    this.syncSurface();
  }

  replacePins(pins: readonly Readonly<SpatialBlurPin>[]): void {
    const normalized = normalizeSpatialBlurPins(
      pins,
      this.options.documentWidth,
      this.options.documentHeight,
    );
    const previousIds = this.pins.map((pin) => pin.id);
    this.pins = normalized.map((pin, index) => ({
      ...pin,
      id: previousIds[index] ?? this.nextPinId++,
    }));
    if (!this.pins.some((pin) => pin.id === this.selectedPinId)) {
      this.selectedPinId = this.pins[0]?.id ?? null;
    }
    if (this.openState) this.renderPins();
  }

  setStatus(message: string): void {
    this.options.elements.status.value = message;
    this.options.elements.status.textContent = message;
  }

  setMode(mode: SpatialBlurMode): void {
    if (this.busy || this.recoveryOnly || mode === this.mode) return;
    this.cancelPointerGestureForNavigation();
    this.mode = mode;
    this.setStatus(`${mode.toUpperCase()} · ${this.modeInstruction(mode)}`);
    this.syncModeButtons();
    this.renderPins();
  }

  beginPointer(input: SpatialBlurPointerInput): boolean {
    if (!this.openState || this.busy || this.recoveryOnly || this.gesture) return false;
    const screenPins = this.screenPins();
    const hitId = hitTestSpatialBlurPins(
      screenPins,
      input.clientX,
      input.clientY,
      input.pointerType,
    );
    const hit = hitId === null ? null : this.pins.find((pin) => pin.id === hitId) ?? null;
    if (hit) this.selectedPinId = hit.id;
    const kind: PointerGestureKind = this.mode === "add"
      ? hit ? "move" : "pending-add"
      : this.mode === "adjust"
        ? hit ? "adjust" : "none"
        : hit ? "pending-remove" : "none";
    this.gesture = {
      pointerId: input.pointerId,
      kind,
      pinId: hit?.id ?? null,
      initialClientX: input.clientX,
      initialClientY: input.clientY,
      initialPins: copyUiPins(this.pins),
      initialRadius: hit?.radius ?? 0,
      moved: false,
    };
    this.renderPins();
    return true;
  }

  updatePointer(input: SpatialBlurPointerInput): void {
    const gesture = this.gesture;
    if (!gesture || gesture.pointerId !== input.pointerId) return;
    gesture.moved ||= spatialBlurPointerMoved(
      gesture.initialClientX,
      gesture.initialClientY,
      input.clientX,
      input.clientY,
    );
    if (gesture.kind === "move" && gesture.pinId !== null) {
      const point = this.documentPoint(input.clientX, input.clientY);
      this.updatePin(gesture.pinId, { x: point.x, y: point.y });
      this.schedulePinsChange();
    } else if (gesture.kind === "adjust" && gesture.pinId !== null) {
      const radius = spatialBlurAdjustedRadius(
        gesture.initialRadius,
        gesture.initialClientY,
        input.clientY,
      );
      this.updatePin(gesture.pinId, { radius });
      this.setStatus(`Point ${this.pinNumber(gesture.pinId)} · ${radius.toFixed(0)} px`);
      this.schedulePinsChange();
    }
  }

  endPointer(input: SpatialBlurPointerInput, commit: boolean): void {
    const gesture = this.gesture;
    if (!gesture || gesture.pointerId !== input.pointerId) return;
    this.gesture = null;
    if (!commit) {
      this.restoreGesturePins(gesture);
      return;
    }
    if (gesture.kind === "pending-add" && !gesture.moved) {
      this.addPinAtClientPoint(input.clientX, input.clientY);
    } else if (gesture.kind === "pending-remove" && !gesture.moved && gesture.pinId !== null) {
      this.removePin(gesture.pinId);
    }
    this.flushPinsChange();
    this.renderPins();
    const selected = this.pins.find((pin) => pin.id === this.selectedPinId);
    if (selected) {
      this.setStatus(`Point ${this.pinNumber(selected.id)} · ${selected.radius.toFixed(0)} px`);
    } else {
      this.setStatus(`${this.mode.toUpperCase()} · ${this.modeInstruction(this.mode)}`);
    }
  }

  cancelPointerGestureForNavigation(): void {
    const gesture = this.gesture;
    if (!gesture) return;
    this.gesture = null;
    this.restoreGesturePins(gesture);
  }

  handleViewChange(): void {
    if (this.openState) this.renderPins();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortController.abort();
    this.close();
  }

  private bindControls(): void {
    const signal = this.abortController.signal;
    for (const button of this.options.elements.modeButtons) {
      button.addEventListener("click", () => {
        const mode = button.dataset.spatialBlurMode;
        if (isSpatialBlurMode(mode)) this.setMode(mode);
      }, { signal });
      button.addEventListener("keydown", (event) => {
        this.handleModeKeydown(button, event);
      }, { signal });
    }
    this.options.elements.cancelButton.addEventListener(
      "click",
      () => this.options.onRequestCancel(),
      { signal },
    );
    this.options.elements.applyButton.addEventListener(
      "click",
      () => this.options.onRequestApply(),
      { signal },
    );
    this.options.document.addEventListener("keydown", (event) => {
      if (!this.openState || event.key !== "Escape") return;
      event.preventDefault();
      this.options.onRequestCancel();
    }, { signal });
  }

  private syncSurface(): void {
    const { canvas, overlay, topBar, dock, cancelButton, applyButton } = this.options.elements;
    for (const element of [overlay, topBar, dock]) {
      element.hidden = !this.openState;
      element.setAttribute("aria-hidden", String(!this.openState));
      element.toggleAttribute("inert", !this.openState);
    }
    overlay.classList.toggle("is-busy", this.busy);
    overlay.classList.toggle("is-recovery", this.recoveryOnly);
    overlay.dataset.mode = this.mode;
    canvas.classList.toggle("spatial-blur-active", this.openState);
    if (this.openState) canvas.dataset.spatialBlurMode = this.mode;
    else delete canvas.dataset.spatialBlurMode;
    cancelButton.disabled = this.busy;
    applyButton.disabled = this.busy || this.recoveryOnly;
    this.syncModeButtons();
  }

  private syncModeButtons(): void {
    this.options.elements.overlay.dataset.mode = this.mode;
    if (this.openState) this.options.elements.canvas.dataset.spatialBlurMode = this.mode;
    for (const button of this.options.elements.modeButtons) {
      const selected = button.dataset.spatialBlurMode === this.mode;
      button.setAttribute("aria-checked", String(selected));
      button.tabIndex = selected ? 0 : -1;
      button.disabled = !this.openState || this.busy || this.recoveryOnly;
    }
  }

  private handleModeKeydown(button: HTMLButtonElement, event: KeyboardEvent): void {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      return;
    }
    const buttons = this.options.elements.modeButtons;
    const index = buttons.indexOf(button);
    if (index < 0) return;
    event.preventDefault();
    const delta = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : (index + delta + buttons.length) % buttons.length;
    const next = buttons[nextIndex];
    next.focus({ preventScroll: true });
    const mode = next.dataset.spatialBlurMode;
    if (isSpatialBlurMode(mode)) this.setMode(mode);
  }

  private modeInstruction(mode: SpatialBlurMode): string {
    if (mode === "add") return "Tap to add; drag a point to move it.";
    if (mode === "adjust") return "Drag a point up or down.";
    return "Tap a point to remove it.";
  }

  private documentPoint(clientX: number, clientY: number): { x: number; y: number } {
    const point = this.options.engine.toLayerPoint({
      clientX,
      clientY,
      pressure: 1,
      timeMs: this.options.browser.performance.now(),
    });
    return {
      x: Math.max(0, Math.min(this.options.documentWidth, point.x)),
      y: Math.max(0, Math.min(this.options.documentHeight, point.y)),
    };
  }

  private screenPins(): SpatialBlurScreenPin[] {
    const view = this.options.engine.getVectorTextViewState();
    const rect = this.options.elements.canvas.getBoundingClientRect();
    const scaleX = rect.width / Math.max(1, view.canvasWidth);
    const scaleY = rect.height / Math.max(1, view.canvasHeight);
    return this.pins.map((pin) => {
      const dx = pin.x - view.centerX;
      const dy = pin.y - view.centerY;
      const canvasX = view.canvasWidth * 0.5
        + (view.rotationCos * dx - view.rotationSin * dy) * view.zoom;
      const canvasY = view.canvasHeight * 0.5
        + (view.rotationSin * dx + view.rotationCos * dy) * view.zoom;
      return {
        ...pin,
        clientX: rect.left + canvasX * scaleX,
        clientY: rect.top + canvasY * scaleY,
      };
    });
  }

  private renderPins(): void {
    if (!this.openState) return;
    const overlayRect = this.options.elements.overlay.getBoundingClientRect();
    const screenPins = this.screenPins();
    const children = screenPins.map((pin, index) => {
      const button = this.options.document.createElement("button");
      button.type = "button";
      button.className = "spatial-blur-pin";
      button.dataset.spatialBlurPinId = String(pin.id);
      button.style.left = `${pin.clientX - overlayRect.left}px`;
      button.style.top = `${pin.clientY - overlayRect.top}px`;
      button.style.setProperty(
        "--spatial-blur-pin-fill",
        `${spatialBlurPinFillPercent(pin.radius)}%`,
      );
      button.setAttribute("aria-label", `Blur point ${index + 1}, ${pin.radius.toFixed(0)} pixels`);
      button.setAttribute("aria-pressed", String(pin.id === this.selectedPinId));
      const fill = this.options.document.createElement("span");
      fill.setAttribute("aria-hidden", "true");
      const output = this.options.document.createElement("output");
      output.setAttribute("aria-hidden", "true");
      output.value = `${pin.radius.toFixed(0)} px`;
      output.textContent = output.value;
      button.replaceChildren(fill, output);
      button.addEventListener("focus", () => {
        this.selectedPinId = pin.id;
        this.syncPinSelection();
      });
      button.addEventListener("keydown", (event) => this.handlePinKeydown(pin.id, event));
      return button;
    });
    this.options.elements.pinLayer.replaceChildren(...children);
  }

  private syncPinSelection(): void {
    for (const child of this.options.elements.pinLayer.children) {
      const element = child as HTMLElement;
      const id = Number(element.dataset.spatialBlurPinId);
      element.setAttribute("aria-pressed", String(id === this.selectedPinId));
    }
  }

  private handlePinKeydown(pinId: number, event: KeyboardEvent): void {
    if (this.busy || this.recoveryOnly) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      this.removePin(pinId);
      this.flushPinsChange();
      this.renderPins();
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    const pin = this.pins.find((candidate) => candidate.id === pinId);
    if (!pin) return;
    if (this.mode === "adjust") {
      const direction = event.key === "ArrowUp" || event.key === "ArrowRight" ? 1 : -1;
      this.updatePin(pinId, { radius: pin.radius + direction * step });
    } else {
      const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      this.updatePin(pinId, { x: pin.x + dx, y: pin.y + dy });
    }
    this.flushPinsChange();
    this.renderPins();
  }

  private updatePin(pinId: number, update: Partial<SpatialBlurPin>): void {
    this.pins = this.pins.map((pin) => pin.id === pinId
      ? {
        ...pin,
        ...update,
        x: Math.max(0, Math.min(this.options.documentWidth, update.x ?? pin.x)),
        y: Math.max(0, Math.min(this.options.documentHeight, update.y ?? pin.y)),
        radius: Math.max(0, Math.min(SPATIAL_BLUR_MAX_RADIUS, update.radius ?? pin.radius)),
      }
      : pin);
    this.selectedPinId = pinId;
    this.renderPins();
  }

  private addPinAtClientPoint(clientX: number, clientY: number): void {
    if (this.pins.length >= SPATIAL_BLUR_MAX_PIN_COUNT) {
      this.setStatus(`Maximum ${SPATIAL_BLUR_MAX_PIN_COUNT} points reached.`);
      return;
    }
    const point = this.documentPoint(clientX, clientY);
    const radius = this.pins.length > 0
      ? spatialBlurRadiusAt(
        this.pins,
        point.x,
        point.y,
        this.options.documentWidth,
        this.options.documentHeight,
      )
      : SPATIAL_BLUR_DEFAULT_RADIUS;
    const pin: UiSpatialBlurPin = { id: this.nextPinId++, ...point, radius };
    this.pins = [...this.pins, pin];
    this.selectedPinId = pin.id;
    this.previewPending = true;
  }

  private removePin(pinId: number): void {
    const index = this.pins.findIndex((pin) => pin.id === pinId);
    if (index < 0) return;
    this.pins = this.pins.filter((pin) => pin.id !== pinId);
    this.selectedPinId = this.pins[Math.min(index, this.pins.length - 1)]?.id ?? null;
    this.previewPending = true;
  }

  private pinNumber(pinId: number): number {
    const index = this.pins.findIndex((pin) => pin.id === pinId);
    return index < 0 ? 0 : index + 1;
  }

  private restoreGesturePins(gesture: SpatialBlurPointerGesture): void {
    const changed = JSON.stringify(this.pins) !== JSON.stringify(gesture.initialPins);
    this.pins = copyUiPins(gesture.initialPins);
    this.selectedPinId = gesture.pinId ?? this.selectedPinId;
    if (changed) {
      this.previewPending = true;
      this.flushPinsChange();
    }
    this.renderPins();
  }

  private schedulePinsChange(): void {
    this.previewPending = true;
    if (this.previewFrame !== null) return;
    this.previewFrame = this.options.browser.requestAnimationFrame(() => {
      this.previewFrame = null;
      this.emitPinsChange();
    });
  }

  private flushPinsChange(): void {
    if (this.previewFrame !== null) {
      this.options.browser.cancelAnimationFrame(this.previewFrame);
      this.previewFrame = null;
    }
    this.emitPinsChange();
  }

  private emitPinsChange(): void {
    if (!this.previewPending || !this.openState || this.busy || this.recoveryOnly) return;
    this.previewPending = false;
    this.options.onPinsChange(copyEnginePins(this.pins));
  }

  private cancelScheduledPreview(): void {
    if (this.previewFrame !== null) {
      this.options.browser.cancelAnimationFrame(this.previewFrame);
      this.previewFrame = null;
    }
    this.previewPending = false;
  }
}
