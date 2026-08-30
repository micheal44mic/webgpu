import type { PointerSample, ShapePreviewState } from "./engine-types";
import type { VectorSvgNode, VectorSvgNodeSeed } from "./scene-svg-model";
import {
  addShapeCreationPointer,
  beginShapeCreation,
  currentShapeCreationDraft,
  endShapeCreationPointer,
  setShapeCreationConstraintRequested,
  updateShapeCreationPointer,
  type ShapeCreationDraft,
  type ShapeCreationGesture,
  type ShapeCreationKind,
} from "./shape-creation-interaction-core";
import { createVectorShapeDraft } from "./vector-shape-core";
import type { VectorTextViewState } from "./vector-text-types";
import { brushColorCssHex } from "./brush-color.ts";
import { sceneDocumentPixelCenteredFrame } from "./scene-document-pixel-alignment.ts";

const MINIMUM_SHAPE_CSS_PIXELS = 3;
const SHAPE_PREVIEW_PREPARING_STATUS = "Preparing shape preview…";

export interface ShapeToolPointerInput {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly clientX: number;
  readonly clientY: number;
  readonly constrainAspect?: boolean;
}

export interface ShapeToolEnginePort {
  getVectorTextViewState(): VectorTextViewState;
  toLayerPoint(sample: PointerSample): { x: number; y: number };
  addVectorSvgNode(
    seed: VectorSvgNodeSeed,
    name?: string,
  ): Promise<Readonly<VectorSvgNode>>;
  prepareShapePreviewPresentation(): Promise<void>;
  releaseShapePreviewPresentation(): Promise<void>;
  updateShapePreview(preview: Readonly<ShapePreviewState> | null): boolean;
}

export interface ShapeToolElements {
  readonly dock: HTMLElement;
  readonly kindButtons: readonly HTMLButtonElement[];
  readonly fillColor: HTMLInputElement;
  readonly status: HTMLOutputElement;
}

export interface ShapeToolControllerOptions {
  readonly browser: Window & { readonly AbortController: typeof AbortController };
  readonly engine: ShapeToolEnginePort;
  readonly elements: ShapeToolElements;
  readonly initialColor: string;
  readonly onBusyChange?: (busy: boolean) => void;
  readonly onCreated?: (node: Readonly<VectorSvgNode>) => void;
  readonly onError?: (error: unknown) => void;
}

function normalizedColor(value: string, fallback = "#111111"): string {
  try {
    return brushColorCssHex(value);
  } catch {
    return fallback;
  }
}

function shapeName(draft: Readonly<ShapeCreationDraft>): string {
  if (draft.kind === "star") return "Star";
  if (draft.kind === "rectangle") return draft.aspectConstrained ? "Square" : "Rectangle";
  return draft.aspectConstrained ? "Circle" : "Ellipse";
}

/** Owns the live vector-shape draft, compact controls and one release-time history commit. */
export class ShapeToolController {
  private readonly abortController: AbortController;
  private active = false;
  private busyCount = 0;
  private previewReady = false;
  private previewLifecycle: Promise<void> = Promise.resolve();
  private previewRequest = 0;
  private kind: ShapeCreationKind = "rectangle";
  private gesture: ShapeCreationGesture | null = null;
  private committingDraft: ShapeCreationDraft | null = null;
  private disposed = false;

  constructor(private readonly options: ShapeToolControllerOptions) {
    this.abortController = new options.browser.AbortController();
    options.elements.fillColor.value = normalizedColor(options.initialColor);
    this.bind();
    this.syncUi();
  }

  get isActive(): boolean {
    return this.active;
  }

  get isBusy(): boolean {
    return this.busyCount > 0;
  }

  /** The ordered preview is being prepared, so creation input remains blocked. */
  get isPresentationPreparing(): boolean {
    return this.active
      && !this.previewReady
      && this.committingDraft === null
      && this.busyCount > 0
      && !this.disposed;
  }

  get hasGesture(): boolean {
    return this.gesture !== null;
  }

  setActive(active: boolean): Promise<void> {
    if (this.disposed || this.active === active) return this.previewLifecycle;
    this.active = active;
    this.previewReady = false;
    if (!active) {
      this.gesture = null;
      this.committingDraft = null;
    }
    this.syncUi();
    if (active) this.options.elements.status.value = SHAPE_PREVIEW_PREPARING_STATUS;
    this.render();
    return this.queuePreviewPlacement(active);
  }

  beginPointer(input: Readonly<ShapeToolPointerInput>): boolean {
    if (!this.active || this.disposed) return false;
    if (!this.previewReady) {
      if (this.isPresentationPreparing) {
        this.options.elements.status.value = SHAPE_PREVIEW_PREPARING_STATUS;
      }
      return false;
    }
    if (
      this.committingDraft !== null
      || this.isBusy
      || this.gesture
    ) {
      return false;
    }
    this.gesture = beginShapeCreation(this.kind, {
      pointerId: input.pointerId,
      pointerType: input.pointerType,
      point: this.layerPoint(input),
      constrainAspect: input.constrainAspect,
    });
    this.options.elements.status.value = this.creationStatus();
    this.render();
    return true;
  }

  addPointer(input: Readonly<ShapeToolPointerInput>): boolean {
    const gesture = this.gesture;
    if (!gesture || !this.active || this.disposed) return false;
    const next = addShapeCreationPointer(gesture, {
      pointerId: input.pointerId,
      pointerType: input.pointerType,
      point: this.layerPoint(input),
    });
    this.gesture = next;
    this.options.elements.status.value = this.creationStatus();
    this.render();
    return next !== gesture;
  }

  updatePointer(input: Readonly<ShapeToolPointerInput>): void {
    const gesture = this.gesture;
    if (!gesture || this.disposed) return;
    this.gesture = updateShapeCreationPointer(gesture, {
      pointerId: input.pointerId,
      pointerType: input.pointerType,
      point: this.layerPoint(input),
      constrainAspect: input.constrainAspect,
    });
    this.options.elements.status.value = this.creationStatus();
    this.render();
  }

  setConstraintRequested(requested: boolean): void {
    if (!this.gesture || this.disposed) return;
    this.gesture = setShapeCreationConstraintRequested(this.gesture, requested);
    this.options.elements.status.value = this.creationStatus();
    this.render();
  }

  async endPointer(
    input: Readonly<ShapeToolPointerInput>,
    commit: boolean,
  ): Promise<boolean> {
    let gesture = this.gesture;
    if (!gesture || this.disposed) return false;
    gesture = updateShapeCreationPointer(gesture, {
      pointerId: input.pointerId,
      pointerType: input.pointerType,
      point: this.layerPoint(input),
      constrainAspect: input.constrainAspect,
    });
    const ended = endShapeCreationPointer(gesture, input.pointerId, commit);
    this.gesture = ended.gesture;
    if (!ended.primaryEnded) {
      this.render();
      this.options.elements.status.value = this.creationStatus();
      return false;
    }
    const draft = ended.completedDraft;
    if (!draft || !this.draftLargeEnough(draft)) {
      this.options.elements.status.value = draft
        ? "Drag farther to create a shape."
        : "Shape creation canceled.";
      this.render();
      return false;
    }
    this.committingDraft = draft;
    this.render();
    return this.commitDraft(draft);
  }

  cancelGesture(): void {
    if (!this.gesture) return;
    this.gesture = null;
    this.options.elements.status.value = "Shape creation canceled.";
    this.render();
  }

  notifyViewChange(): void {
    if (this.active) this.render();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortController.abort();
    this.gesture = null;
    this.committingDraft = null;
    this.active = false;
    this.previewReady = false;
    this.syncUi();
    this.render();
    void this.queuePreviewPlacement(false);
  }

  private bind(): void {
    const signal = this.abortController.signal;
    for (const button of this.options.elements.kindButtons) {
      button.addEventListener("click", () => {
        const kind = button.dataset.shapeKind;
        if (kind !== "rectangle" && kind !== "ellipse" && kind !== "star") return;
        this.kind = kind;
        this.gesture = null;
        this.options.elements.status.value = "Drag from the center. Shift or a second finger locks 1:1.";
        this.syncUi();
        this.render();
      }, { signal });
    }
    this.options.elements.fillColor.addEventListener("input", () => {
      this.options.elements.fillColor.value = normalizedColor(
        this.options.elements.fillColor.value,
      );
      this.render();
    }, { signal });
  }

  private layerPoint(input: Readonly<ShapeToolPointerInput>): { x: number; y: number } {
    return this.options.engine.toLayerPoint({
      clientX: input.clientX,
      clientY: input.clientY,
      pressure: 1,
      timeMs: this.options.browser.performance.now(),
    });
  }

  private syncUi(): void {
    const { dock, kindButtons, fillColor } = this.options.elements;
    dock.hidden = !this.active;
    if (this.active) dock.removeAttribute("inert");
    else dock.setAttribute("inert", "");
    dock.setAttribute("aria-busy", String(this.isPresentationPreparing));
    for (const button of kindButtons) {
      const selected = button.dataset.shapeKind === this.kind;
      button.setAttribute("aria-checked", String(selected));
      button.tabIndex = selected ? 0 : -1;
      button.disabled = this.isBusy;
    }
    fillColor.disabled = this.isBusy;
  }

  private creationStatus(): string {
    const gesture = this.gesture;
    if (!gesture) return "Drag from the center. Shift or a second finger locks 1:1.";
    const draft = currentShapeCreationDraft(gesture);
    const frame = this.documentPixelFrame(draft);
    const size = `${frame.width} × ${frame.height}`;
    if (draft.constraintSource === "multi-touch") {
      return `${size} · centered · 1:1 by second finger`;
    }
    if (draft.constraintSource === "requested") return `${size} · centered · 1:1`;
    if (draft.constraintSource === "shape") return `${size} · centered · proportional`;
    return `${size} · centered · free`;
  }

  private draftLargeEnough(draft: Readonly<ShapeCreationDraft>): boolean {
    const view = this.options.engine.getVectorTextViewState();
    const minimumLayerPixels = MINIMUM_SHAPE_CSS_PIXELS
      * view.canvasWidth / Math.max(1, view.cssWidth)
      / Math.max(Number.EPSILON, view.zoom);
    const frame = this.documentPixelFrame(draft);
    return frame.width >= minimumLayerPixels && frame.height >= minimumLayerPixels;
  }

  private documentPixelFrame(
    draft: Readonly<ShapeCreationDraft>,
  ): ReturnType<typeof sceneDocumentPixelCenteredFrame> {
    return sceneDocumentPixelCenteredFrame(
      draft.frame,
      draft.aspectConstrained,
    );
  }

  private async commitDraft(draft: Readonly<ShapeCreationDraft>): Promise<boolean> {
    this.beginBusy();
    try {
      // Keep the one release-time commit serialized with the ordered preview
      // lifecycle in case tool deactivation was requested in the same turn.
      await this.previewLifecycle;
      if (this.disposed || !this.active || !this.previewReady) return false;
      const color = normalizedColor(this.options.elements.fillColor.value);
      const frame = this.documentPixelFrame(draft);
      const created = createVectorShapeDraft(
        draft.kind,
        {
          left: frame.x,
          top: frame.y,
          right: frame.x + frame.width,
          bottom: frame.y + frame.height,
        },
        { fillColor: color, name: shapeName(draft) },
      );
      const node = await this.options.engine.addVectorSvgNode({
        document: created.document,
        shapeDefinition: created.shapeDefinition,
        paintColors: [color],
        x: created.x,
        y: created.y,
        scale: created.scale,
        rotation: created.rotation,
      }, shapeName(draft));
      await new Promise<void>((resolve) => {
        this.options.browser.requestAnimationFrame(() => resolve());
      });
      this.options.elements.status.value = `${shapeName(draft)} created.`;
      this.options.onCreated?.(node);
      return true;
    } catch (error) {
      this.options.elements.status.value = error instanceof Error
        ? error.message
        : "Could not create the shape.";
      this.options.onError?.(error);
      return false;
    } finally {
      this.committingDraft = null;
      this.render();
      this.endBusy();
    }
  }

  private render(): void {
    const draft = this.committingDraft
      ?? (this.gesture ? currentShapeCreationDraft(this.gesture) : null);
    const frame = draft ? this.documentPixelFrame(draft) : null;
    if (
      !this.active
      || !this.previewReady
      || !draft
      || !frame
      || frame.width <= 0
      || frame.height <= 0
    ) {
      this.options.engine.updateShapePreview(null);
      return;
    }
    this.options.engine.updateShapePreview({
      kind: draft.kind,
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      color: normalizedColor(this.options.elements.fillColor.value),
    });
  }

  private queuePreviewPlacement(prepare: boolean): Promise<void> {
    const request = ++this.previewRequest;
    this.beginBusy();
    const next = this.previewLifecycle
      .catch(() => undefined)
      .then(async () => {
        if (prepare && this.active && !this.disposed) {
          await this.options.engine.prepareShapePreviewPresentation();
          if (request === this.previewRequest && this.active && !this.disposed) {
            this.previewReady = true;
            this.options.elements.status.value = this.creationStatus();
            this.render();
          }
        } else {
          await this.options.engine.releaseShapePreviewPresentation();
          this.previewReady = false;
        }
      })
      .catch((error) => {
        this.previewReady = false;
        this.options.elements.status.value = error instanceof Error
          ? error.message
          : "Could not prepare the shape preview.";
        this.options.onError?.(error);
      })
      .finally(() => {
        this.endBusy();
      });
    this.previewLifecycle = next;
    return next;
  }

  private beginBusy(): void {
    const wasBusy = this.isBusy;
    this.busyCount += 1;
    if (!wasBusy) {
      this.syncUi();
      this.options.onBusyChange?.(true);
    }
  }

  private endBusy(): void {
    if (this.busyCount <= 0) return;
    this.busyCount -= 1;
    if (!this.isBusy) {
      this.syncUi();
      this.options.onBusyChange?.(false);
    }
  }
}
