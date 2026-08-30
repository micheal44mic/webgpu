import {
  cloneBeginSourceDrag,
  cloneBeginSourcePick,
  cloneBeginStroke,
  cloneCurrentStrokeSample,
  cloneClearHoverTarget,
  cloneDocumentPointToClient,
  cloneEndGesture,
  cloneHoverTarget,
  cloneSetAngle,
  cloneSetAligned,
  cloneSetSampleMode,
  cloneSetSourcePickArmed,
  cloneSetSourcePoint,
  cloneUpdateGesture,
  createCloneInteractionState,
  hitTestCloneSourceMarker,
  isCloneSampleMode,
  type CloneCanvasView,
  type CloneInteractionState,
  type ClonePoint,
  type CloneSampleMode,
  type CloneStrokeSample,
} from "./clone-interaction-core";

export interface CloneToolBrowser {
  readonly AbortController: typeof AbortController;
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(handle: number): void;
}

export interface CloneToolElements {
  readonly canvas: HTMLCanvasElement;
  readonly overlay: HTMLElement;
  readonly marker: HTMLElement;
  readonly previewCanvas: HTMLCanvasElement;
  readonly dock: HTMLElement;
  readonly setSourceButton: HTMLButtonElement;
  readonly sampleModeButtons: readonly HTMLButtonElement[];
  readonly alignedButton: HTMLButtonElement;
  readonly angleInput: HTMLInputElement;
  readonly angleValue: HTMLOutputElement;
  readonly angleResetButton: HTMLButtonElement;
  readonly status: HTMLOutputElement;
}

export interface CloneToolPreviewRequest {
  readonly sourcePoint: ClonePoint;
  readonly destinationPoint: ClonePoint;
  readonly angleDegrees: number;
  readonly sampleMode: CloneSampleMode;
  readonly diameterCssPixels: number;
}

export interface CloneToolPointerInput {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly clientX: number;
  readonly clientY: number;
}

export interface CloneToolControllerOptions {
  readonly browser: CloneToolBrowser;
  readonly document: Document;
  readonly elements: CloneToolElements;
  readonly toDocumentPoint: (clientX: number, clientY: number) => ClonePoint;
  readonly getView: () => CloneCanvasView;
  readonly getBrushDiameterCssPixels: () => number;
  readonly isInteractionLocked: () => boolean;
  readonly onConfigurationChange?: (
    state: Readonly<CloneInteractionState>,
    reason: "source" | "sample-mode" | "aligned" | "angle",
  ) => void;
  readonly onPreviewChange?: (
    request: Readonly<CloneToolPreviewRequest> | null,
  ) => boolean | void;
}

export type CloneToolPointerAction =
  | { readonly kind: "ignored" }
  | { readonly kind: "needs-source" }
  | { readonly kind: "preparing" }
  | {
      readonly kind: "source-pick-begin" | "source-drag-begin" | "source-preview";
      readonly sourcePoint: ClonePoint;
    }
  | {
      readonly kind: "source-end";
      readonly commit: boolean;
      readonly sourcePoint: ClonePoint | null;
    }
  | {
      readonly kind: "stroke-begin" | "stroke-update";
      readonly sample: CloneStrokeSample;
      readonly sampleMode: CloneSampleMode;
    }
  | {
      readonly kind: "stroke-end";
      readonly commit: boolean;
      readonly sample: CloneStrokeSample;
      readonly sampleMode: CloneSampleMode;
    };

const SAMPLE_MODE_LABELS: Readonly<Record<CloneSampleMode, string>> = {
  current: "Current",
  "current-and-below": "Current & Below",
  "all-visible": "All Visible",
};

function clonePointFromClient(
  options: CloneToolControllerOptions,
  input: Readonly<CloneToolPointerInput>,
): ClonePoint {
  return options.toDocumentPoint(input.clientX, input.clientY);
}

/** Owns Clone's transient source state, compact controls and source marker. */
export class CloneToolController {
  private readonly abortController: AbortController;
  private state: CloneInteractionState = createCloneInteractionState();
  private active = false;
  private sourcePreparing = false;
  private gesturePointerId: number | null = null;
  private frame: number | null = null;
  private disposed = false;

  constructor(private readonly options: CloneToolControllerOptions) {
    this.abortController = new options.browser.AbortController();
    this.bindControls();
    this.syncSurface();
  }

  get isActive(): boolean {
    return this.active;
  }

  get isSettingSource(): boolean {
    return this.state.sourcePickArmed
      || this.state.gesture?.kind === "source-pick";
  }

  get hasSource(): boolean {
    return this.state.sourcePoint !== null;
  }

  snapshot(): Readonly<CloneInteractionState> {
    return this.state;
  }

  setActive(active: boolean): void {
    if (this.disposed || this.active === active) return;
    if (!active && this.state.gesture) {
      this.state = cloneEndGesture(this.state, false);
      this.gesturePointerId = null;
    }
    if (!active) this.state = cloneClearHoverTarget(this.state);
    this.active = active;
    if (!active) {
      this.options.elements.previewCanvas.hidden = true;
      this.options.onPreviewChange?.(null);
    }
    this.syncSurface();
    this.scheduleMarkerRender();
  }

  setSourcePreparing(preparing: boolean): void {
    if (this.disposed || this.sourcePreparing === preparing) return;
    this.sourcePreparing = preparing;
    this.syncSurface();
    this.scheduleMarkerRender();
  }

  setSourcePoint(point: Readonly<ClonePoint> | null): void {
    if (this.disposed || this.state.gesture) return;
    this.state = cloneSetSourcePoint(this.state, point);
    this.emitConfigurationChange("source");
    this.syncSurface();
    this.scheduleMarkerRender();
  }

  armSourcePick(armed = true): void {
    if (this.disposed || this.state.gesture) return;
    this.state = cloneSetSourcePickArmed(this.state, armed);
    this.syncSurface();
  }

  setSampleMode(sampleMode: CloneSampleMode): void {
    if (this.disposed || this.state.gesture) return;
    const previous = this.state.sampleMode;
    this.state = cloneSetSampleMode(this.state, sampleMode);
    if (this.state.sampleMode !== previous) this.emitConfigurationChange("sample-mode");
    this.syncSurface();
  }

  setAligned(aligned: boolean): void {
    if (this.disposed || this.state.gesture) return;
    const previous = this.state.aligned;
    this.state = cloneSetAligned(this.state, aligned);
    if (this.state.aligned !== previous) this.emitConfigurationChange("aligned");
    this.syncSurface();
    this.scheduleMarkerRender();
  }

  setAngleDegrees(angleDegrees: number): void {
    if (this.disposed || this.state.gesture) return;
    const previous = this.state.angleDegrees;
    this.state = cloneSetAngle(this.state, angleDegrees);
    if (this.state.angleDegrees !== previous) this.emitConfigurationChange("angle");
    this.syncControls();
    this.scheduleMarkerRender();
  }

  notifyViewChange(): void {
    this.scheduleMarkerRender();
  }

  notifyBrushChange(): void {
    this.scheduleMarkerRender();
  }

  notifyInteractionState(): void {
    this.syncControls();
  }

  handleHover(input: Readonly<CloneToolPointerInput>): void {
    if (
      this.disposed
      || !this.active
      || this.gesturePointerId !== null
      || !this.state.sourcePoint
    ) return;
    this.state = cloneHoverTarget(this.state, clonePointFromClient(this.options, input));
    this.scheduleMarkerRender();
  }

  beginPointer(
    input: Readonly<CloneToolPointerInput>,
    setSourceModifier = false,
  ): CloneToolPointerAction {
    if (
      this.disposed
      || !this.active
      || this.gesturePointerId !== null
      || this.options.isInteractionLocked()
    ) return { kind: "ignored" };

    const documentPoint = clonePointFromClient(this.options, input);
    if (setSourceModifier || this.state.sourcePickArmed) {
      this.state = cloneBeginSourcePick(this.state, documentPoint);
      this.gesturePointerId = input.pointerId;
      this.syncSurface();
      this.scheduleMarkerRender();
      return { kind: "source-pick-begin", sourcePoint: documentPoint };
    }

    if (hitTestCloneSourceMarker(
      this.currentMarkerClientPoint(),
      { x: input.clientX, y: input.clientY },
      input.pointerType,
    )) {
      this.state = cloneBeginSourceDrag(this.state, documentPoint);
      this.gesturePointerId = input.pointerId;
      this.syncSurface();
      this.scheduleMarkerRender();
      return { kind: "source-drag-begin", sourcePoint: documentPoint };
    }

    if (!this.state.sourcePoint) {
      this.setStatus("Choose SET SOURCE, then tap the canvas.");
      return { kind: "needs-source" };
    }
    if (this.sourcePreparing) {
      this.setStatus("Preparing the raster source…");
      return { kind: "preparing" };
    }

    this.state = cloneBeginStroke(this.state, documentPoint);
    const sample = cloneCurrentStrokeSample(this.state);
    if (!sample) return { kind: "ignored" };
    this.gesturePointerId = input.pointerId;
    this.syncSurface();
    this.scheduleMarkerRender();
    return {
      kind: "stroke-begin",
      sample,
      sampleMode: this.state.sampleMode,
    };
  }

  updatePointer(input: Readonly<CloneToolPointerInput>): CloneToolPointerAction {
    if (
      this.disposed
      || input.pointerId !== this.gesturePointerId
      || !this.state.gesture
    ) return { kind: "ignored" };
    const documentPoint = clonePointFromClient(this.options, input);
    this.state = cloneUpdateGesture(this.state, documentPoint);
    this.scheduleMarkerRender();
    const gesture = this.state.gesture;
    if (gesture?.kind === "clone-stroke") {
      return {
        kind: "stroke-update",
        sample: cloneCurrentStrokeSample(this.state)!,
        sampleMode: this.state.sampleMode,
      };
    }
    return { kind: "source-preview", sourcePoint: documentPoint };
  }

  endPointer(
    input: Readonly<CloneToolPointerInput>,
    commit: boolean,
  ): CloneToolPointerAction {
    if (
      this.disposed
      || input.pointerId !== this.gesturePointerId
      || !this.state.gesture
    ) return { kind: "ignored" };
    this.state = cloneUpdateGesture(
      this.state,
      clonePointFromClient(this.options, input),
    );
    const gesture = this.state.gesture;
    if (!gesture) return { kind: "ignored" };
    const sampleMode = this.state.sampleMode;
    const sample = cloneCurrentStrokeSample(this.state);
    this.state = cloneEndGesture(this.state, commit);
    this.gesturePointerId = null;
    if (gesture.kind === "source-pick" || gesture.kind === "source-drag") {
      if (commit) this.emitConfigurationChange("source");
      this.syncSurface();
      this.scheduleMarkerRender();
      return {
        kind: "source-end",
        commit,
        sourcePoint: this.state.sourcePoint,
      };
    }
    this.syncSurface();
    this.scheduleMarkerRender();
    return {
      kind: "stroke-end",
      commit,
      sample: sample!,
      sampleMode,
    };
  }

  cancelPointerForNavigation(): CloneToolPointerAction {
    if (this.gesturePointerId === null || !this.state.gesture) return { kind: "ignored" };
    const gesture = this.state.gesture;
    const sample = cloneCurrentStrokeSample(this.state);
    const sampleMode = this.state.sampleMode;
    this.state = cloneEndGesture(this.state, false);
    this.gesturePointerId = null;
    this.syncSurface();
    this.scheduleMarkerRender();
    if (gesture.kind === "clone-stroke") {
      return {
        kind: "stroke-end",
        commit: false,
        sample: sample!,
        sampleMode,
      };
    }
    return {
      kind: "source-end",
      commit: false,
      sourcePoint: this.state.sourcePoint,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortController.abort();
    if (this.frame !== null) {
      this.options.browser.cancelAnimationFrame(this.frame);
      this.frame = null;
    }
    this.gesturePointerId = null;
    this.active = false;
    this.options.elements.overlay.hidden = true;
    this.options.elements.previewCanvas.hidden = true;
    this.options.onPreviewChange?.(null);
    this.options.elements.dock.hidden = true;
    this.options.elements.dock.setAttribute("inert", "");
    this.options.elements.canvas.classList.remove(
      "clone-tool-active",
      "clone-source-ready",
      "clone-source-picking",
    );
  }

  private bindControls(): void {
    const signal = this.abortController.signal;
    this.options.elements.setSourceButton.addEventListener("click", () => {
      if (!this.active || this.options.isInteractionLocked()) return;
      this.armSourcePick(!this.state.sourcePickArmed);
    }, { signal });
    for (const button of this.options.elements.sampleModeButtons) {
      button.addEventListener("click", () => {
        const mode = button.dataset.cloneSampleMode;
        if (isCloneSampleMode(mode)) this.setSampleMode(mode);
      }, { signal });
    }
    this.options.elements.alignedButton.addEventListener("click", () => {
      if (!this.active || this.options.isInteractionLocked()) return;
      this.setAligned(!this.state.aligned);
    }, { signal });
    this.options.elements.angleInput.addEventListener("input", () => {
      if (!this.active || this.options.isInteractionLocked()) return;
      this.setAngleDegrees(Number(this.options.elements.angleInput.value));
    }, { signal });
    this.options.elements.angleResetButton.addEventListener("click", () => {
      if (!this.active || this.options.isInteractionLocked()) return;
      this.setAngleDegrees(0);
    }, { signal });
    this.options.document.addEventListener("keydown", (event) => {
      if (
        !this.active
        || event.key !== "Escape"
        || !this.state.sourcePickArmed
        || this.state.gesture
      ) return;
      event.preventDefault();
      this.armSourcePick(false);
    }, { signal });
  }

  private emitConfigurationChange(
    reason: "source" | "sample-mode" | "aligned" | "angle",
  ): void {
    this.options.onConfigurationChange?.(this.state, reason);
  }

  private syncSurface(): void {
    const { canvas, dock, overlay, previewCanvas } = this.options.elements;
    dock.hidden = !this.active;
    if (!this.active) overlay.hidden = true;
    if (this.active) dock.removeAttribute("inert");
    else dock.setAttribute("inert", "");
    canvas.classList.toggle("clone-tool-active", this.active);
    canvas.classList.toggle(
      "clone-source-ready",
      this.active && this.state.sourcePoint !== null,
    );
    canvas.classList.toggle(
      "clone-source-picking",
      this.active && this.isSettingSource,
    );
    if (
      !this.active
      || this.sourcePreparing
      || this.state.sourcePickArmed
      || this.state.gesture !== null
    ) {
      previewCanvas.hidden = true;
      this.options.onPreviewChange?.(null);
    }
    this.syncControls();
    this.setStatus(this.statusMessage());
  }

  private syncControls(): void {
    const locked = !this.active
      || this.options.isInteractionLocked()
      || this.state.gesture !== null;
    const {
      setSourceButton,
      sampleModeButtons,
      alignedButton,
      angleInput,
      angleValue,
      angleResetButton,
    } = this.options.elements;
    setSourceButton.disabled = locked;
    setSourceButton.setAttribute("aria-pressed", String(this.state.sourcePickArmed));
    for (const button of sampleModeButtons) {
      const selected = button.dataset.cloneSampleMode === this.state.sampleMode;
      button.disabled = locked;
      button.setAttribute("aria-checked", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    alignedButton.disabled = locked;
    alignedButton.setAttribute("aria-pressed", String(this.state.aligned));
    angleInput.disabled = locked;
    angleInput.value = String(this.state.angleDegrees);
    angleValue.value = `${Math.round(this.state.angleDegrees)}°`;
    angleValue.textContent = angleValue.value;
    angleResetButton.disabled = locked || this.state.angleDegrees === 0;
  }

  private statusMessage(): string {
    if (!this.active) return "Clone inactive.";
    const gestureKind = this.state.gesture?.kind;
    if (gestureKind === "source-pick") return "Release to set the raster source point.";
    if (gestureKind === "source-drag") return "Release to move the raster source point.";
    if (gestureKind === "clone-stroke") return "Cloning the raster source…";
    if (this.state.sourcePickArmed) return "Tap the canvas to choose a raster source point.";
    if (!this.state.sourcePoint) return "Choose SET SOURCE, then tap the canvas.";
    if (this.sourcePreparing) return "Preparing the raster source…";
    return `${SAMPLE_MODE_LABELS[this.state.sampleMode]} · Visible raster layers only.`;
  }

  private setStatus(message: string): void {
    this.options.elements.status.value = message;
    this.options.elements.status.textContent = message;
  }

  private currentMarkerClientPoint(): ClonePoint | null {
    if (!this.active || !this.state.markerPoint) return null;
    const rectangle = this.options.elements.canvas.getBoundingClientRect();
    return cloneDocumentPointToClient(
      this.state.markerPoint,
      this.options.getView(),
      rectangle,
    );
  }

  private scheduleMarkerRender(): void {
    if (this.disposed || this.frame !== null) return;
    this.frame = this.options.browser.requestAnimationFrame(() => {
      this.frame = null;
      this.renderMarker();
    });
  }

  private renderMarker(): void {
    const { overlay, marker, previewCanvas } = this.options.elements;
    const clientPoint = this.currentMarkerClientPoint();
    if (!clientPoint) {
      previewCanvas.hidden = true;
      this.options.onPreviewChange?.(null);
      overlay.hidden = true;
      return;
    }
    const overlayRectangle = overlay.getBoundingClientRect();
    const requestedDiameter = this.options.getBrushDiameterCssPixels();
    const diameter = Number.isFinite(requestedDiameter)
      ? Math.max(1, requestedDiameter)
      : 1;
    marker.style.setProperty(
      "--clone-source-x",
      `${clientPoint.x - overlayRectangle.left}px`,
    );
    marker.style.setProperty(
      "--clone-source-y",
      `${clientPoint.y - overlayRectangle.top}px`,
    );
    marker.style.setProperty("--clone-source-diameter", `${diameter}px`);
    marker.dataset.gesture = this.state.gesture?.kind ?? "idle";
    const previewDocumentPoint = this.state.gesture === null
      && !this.state.sourcePickArmed
      && !this.sourcePreparing
      && this.state.sourcePoint
      ? this.state.hoverTargetPoint ?? this.state.sourcePoint
      : null;
    const previewSourcePoint = this.state.hoverTargetPoint
      ? this.state.markerPoint
      : this.state.sourcePoint;
    const previewTarget = previewDocumentPoint
      ? cloneDocumentPointToClient(
        previewDocumentPoint,
        this.options.getView(),
        this.options.elements.canvas.getBoundingClientRect(),
      )
      : null;
    if (previewTarget && previewSourcePoint && previewDocumentPoint) {
      previewCanvas.style.setProperty(
        "--clone-preview-x",
        `${previewTarget.x - overlayRectangle.left}px`,
      );
      previewCanvas.style.setProperty(
        "--clone-preview-y",
        `${previewTarget.y - overlayRectangle.top}px`,
      );
      previewCanvas.style.setProperty("--clone-preview-diameter", `${diameter}px`);
      const rendered = this.options.onPreviewChange?.({
        sourcePoint: copyClonePoint(previewSourcePoint),
        destinationPoint: copyClonePoint(previewDocumentPoint),
        angleDegrees: this.state.angleDegrees,
        sampleMode: this.state.sampleMode,
        diameterCssPixels: diameter,
      });
      previewCanvas.hidden = rendered === false;
    } else {
      previewCanvas.hidden = true;
      this.options.onPreviewChange?.(null);
    }
    overlay.hidden = false;
  }
}

function copyClonePoint(point: Readonly<ClonePoint>): ClonePoint {
  return { x: point.x, y: point.y };
}
