import type { PointerSample } from "./engine-types";
import type { VectorSvgNode, VectorSvgNodeSeed } from "./scene-svg-model";
import { sceneLayerToCanvas } from "./scene-transform-geometry";
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
import {
  createVectorShapeDraft,
  VECTOR_SHAPE_DEFAULT_STAR_INNER_RATIO,
  VECTOR_SHAPE_DEFAULT_STAR_POINTS,
} from "./vector-shape-core";
import type { VectorTextViewState } from "./vector-text-types";

const MINIMUM_SHAPE_CSS_PIXELS = 3;

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
}

export interface ShapeToolElements {
  readonly overlay: HTMLCanvasElement;
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
  return /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().toLowerCase() : fallback;
}

function shapeName(draft: Readonly<ShapeCreationDraft>): string {
  if (draft.kind === "star") return "Star";
  if (draft.kind === "rectangle") return draft.aspectConstrained ? "Square" : "Rectangle";
  return draft.aspectConstrained ? "Circle" : "Ellipse";
}

function starPoints(draft: Readonly<ShapeCreationDraft>): readonly { x: number; y: number }[] {
  const raw: { x: number; y: number }[] = [];
  for (let index = 0; index < VECTOR_SHAPE_DEFAULT_STAR_POINTS * 2; index += 1) {
    const angle = -Math.PI * 0.5 + index * Math.PI / VECTOR_SHAPE_DEFAULT_STAR_POINTS;
    const radius = index % 2 === 0 ? 1 : VECTOR_SHAPE_DEFAULT_STAR_INNER_RATIO;
    raw.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  }
  const left = Math.min(...raw.map((point) => point.x));
  const right = Math.max(...raw.map((point) => point.x));
  const top = Math.min(...raw.map((point) => point.y));
  const bottom = Math.max(...raw.map((point) => point.y));
  return raw.map((point) => ({
    x: draft.frame.x + (point.x - left) / Math.max(Number.EPSILON, right - left)
      * draft.frame.width,
    y: draft.frame.y + (point.y - top) / Math.max(Number.EPSILON, bottom - top)
      * draft.frame.height,
  }));
}

/** Owns the live vector-shape draft, compact controls and one release-time history commit. */
export class ShapeToolController {
  private readonly abortController: AbortController;
  private readonly context: CanvasRenderingContext2D;
  private active = false;
  private busy = false;
  private kind: ShapeCreationKind = "rectangle";
  private gesture: ShapeCreationGesture | null = null;
  private disposed = false;

  constructor(private readonly options: ShapeToolControllerOptions) {
    this.abortController = new options.browser.AbortController();
    const context = options.elements.overlay.getContext("2d", {
      alpha: true,
      desynchronized: true,
    });
    if (!context) throw new Error("Canvas2D is unavailable for the shape preview.");
    this.context = context;
    options.elements.fillColor.value = normalizedColor(options.initialColor);
    this.bind();
    this.syncUi();
  }

  get isActive(): boolean {
    return this.active;
  }

  get isBusy(): boolean {
    return this.busy;
  }

  get hasGesture(): boolean {
    return this.gesture !== null;
  }

  setActive(active: boolean): void {
    if (this.disposed || this.active === active) return;
    this.active = active;
    if (!active) this.gesture = null;
    this.syncUi();
    this.render();
  }

  beginPointer(input: Readonly<ShapeToolPointerInput>): boolean {
    if (!this.active || this.busy || this.gesture || this.disposed) return false;
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
    this.render();
    if (!ended.primaryEnded) {
      this.options.elements.status.value = this.creationStatus();
      return false;
    }
    const draft = ended.completedDraft;
    if (!draft || !this.draftLargeEnough(draft)) {
      this.options.elements.status.value = draft
        ? "Drag farther to create a shape."
        : "Shape creation canceled.";
      return false;
    }
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
    this.active = false;
    this.syncUi();
    this.render();
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
    const { dock, overlay, kindButtons, fillColor } = this.options.elements;
    dock.hidden = !this.active;
    overlay.hidden = !this.active;
    if (this.active) dock.removeAttribute("inert");
    else dock.setAttribute("inert", "");
    for (const button of kindButtons) {
      const selected = button.dataset.shapeKind === this.kind;
      button.setAttribute("aria-checked", String(selected));
      button.tabIndex = selected ? 0 : -1;
      button.disabled = this.busy;
    }
    fillColor.disabled = this.busy;
  }

  private creationStatus(): string {
    const gesture = this.gesture;
    if (!gesture) return "Drag from the center. Shift or a second finger locks 1:1.";
    const draft = currentShapeCreationDraft(gesture);
    const size = `${Math.round(draft.frame.width)} × ${Math.round(draft.frame.height)}`;
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
    return draft.frame.width >= minimumLayerPixels && draft.frame.height >= minimumLayerPixels;
  }

  private async commitDraft(draft: Readonly<ShapeCreationDraft>): Promise<boolean> {
    this.busy = true;
    this.syncUi();
    this.options.onBusyChange?.(true);
    try {
      const color = normalizedColor(this.options.elements.fillColor.value);
      const created = createVectorShapeDraft(
        draft.kind,
        {
          left: draft.frame.x,
          top: draft.frame.y,
          right: draft.frame.x + draft.frame.width,
          bottom: draft.frame.y + draft.frame.height,
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
      this.busy = false;
      this.syncUi();
      this.options.onBusyChange?.(false);
    }
  }

  private render(): void {
    const { overlay } = this.options.elements;
    const view = this.options.engine.getVectorTextViewState();
    if (overlay.width !== view.canvasWidth) overlay.width = view.canvasWidth;
    if (overlay.height !== view.canvasHeight) overlay.height = view.canvasHeight;
    this.context.clearRect(0, 0, overlay.width, overlay.height);
    if (!this.active || !this.gesture) return;

    const draft = currentShapeCreationDraft(this.gesture);
    const color = normalizedColor(this.options.elements.fillColor.value);
    const context = this.context;
    context.save();
    context.beginPath();
    if (draft.kind === "rectangle") {
      const corners = [
        { x: draft.frame.x, y: draft.frame.y },
        { x: draft.frame.x + draft.frame.width, y: draft.frame.y },
        { x: draft.frame.x + draft.frame.width, y: draft.frame.y + draft.frame.height },
        { x: draft.frame.x, y: draft.frame.y + draft.frame.height },
      ].map((point) => sceneLayerToCanvas(point, view));
      context.moveTo(corners[0].x, corners[0].y);
      for (let index = 1; index < corners.length; index += 1) {
        context.lineTo(corners[index].x, corners[index].y);
      }
      context.closePath();
    } else if (draft.kind === "ellipse") {
      const center = sceneLayerToCanvas({
        x: draft.frame.x + draft.frame.width * 0.5,
        y: draft.frame.y + draft.frame.height * 0.5,
      }, view);
      context.ellipse(
        center.x,
        center.y,
        draft.frame.width * view.zoom * 0.5,
        draft.frame.height * view.zoom * 0.5,
        view.rotationRadians,
        0,
        Math.PI * 2,
      );
    } else {
      const points = starPoints(draft).map((point) => sceneLayerToCanvas(point, view));
      context.moveTo(points[0].x, points[0].y);
      for (let index = 1; index < points.length; index += 1) {
        context.lineTo(points[index].x, points[index].y);
      }
      context.closePath();
    }
    context.globalAlpha = 1;
    context.fillStyle = color;
    context.fill();
    context.restore();
  }
}
