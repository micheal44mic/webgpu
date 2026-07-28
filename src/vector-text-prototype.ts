import type { PointerSample } from "./brush-engine";
import {
  VECTOR_TEXT_PRESENTATION_STRATEGY,
} from "./vector-text-shader";

export type VectorTextPlacement = "below-active" | "above-active";

export interface VectorTextViewState {
  canvasWidth: number;
  canvasHeight: number;
  cssWidth: number;
  cssHeight: number;
  centerX: number;
  centerY: number;
  zoom: number;
  rotationRadians: number;
  rotationCos: number;
  rotationSin: number;
}

export interface VectorTextGpuPresentationStats {
  strategy: typeof VECTOR_TEXT_PRESENTATION_STRATEGY;
  width: number;
  height: number;
  gpuMemoryMiB: number;
  placement: VectorTextPlacement;
}

export interface VectorTextPrototypeHost {
  readonly layerSize: number;
  getVectorTextViewState(): VectorTextViewState;
  toLayerPoint(sample: PointerSample): { x: number; y: number };
  updateVectorTextPresentation(
    source: HTMLCanvasElement,
    placement: VectorTextPlacement,
  ): VectorTextGpuPresentationStats;
  clearVectorTextPresentation(placement?: VectorTextPlacement): void;
  zoomBy(factor: number, clientX?: number, clientY?: number): void;
  panByClientDelta(deltaClientX: number, deltaClientY: number): void;
}

export interface VectorTextModel {
  text: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  placement: VectorTextPlacement;
}

export interface VectorTextPrototypeDiagnostics {
  strategy: typeof VECTOR_TEXT_PRESENTATION_STRATEGY;
  model: Readonly<VectorTextModel>;
  editing: boolean;
  renderCount: number;
  lastRenderMs: number;
  renderP95Ms: number;
  gpuMemoryMiB: number;
  browserCanvasLogicalMiB: number;
  canvasWidth: number;
  canvasHeight: number;
}

interface Point {
  x: number;
  y: number;
}

interface TextMetricsBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
  baseline: number;
}

type TransformHandle = "north-west" | "north-east" | "south-east" | "south-west";
type InteractionMode = "move" | "scale" | "rotate" | "pan";

interface ActiveInteraction {
  pointerId: number;
  mode: InteractionMode;
  startClient: Point;
  startLayer: Point;
  startModel: VectorTextModel;
  startDistance: number;
  startAngle: number;
}

const MEBIBYTE_BYTES = 1024 * 1024;
const HANDLE_RADIUS_CSS_PX = 7;
const HANDLE_HIT_RADIUS_CSS_PX = 13;
const ROTATION_HANDLE_OFFSET_CSS_PX = 38;
const MINIMUM_SCALE = 0.05;
const MAXIMUM_SCALE = 20;
const FRAME_SAMPLE_LIMIT = 180;

function requiredElement<ElementType extends HTMLElement>(id: string): ElementType {
  const found = document.getElementById(id);
  if (!found) {
    throw new Error(`Elemento #${id} mancante per il prototipo testo vettoriale.`);
  }
  return found as ElementType;
}

function copyModel(model: VectorTextModel): VectorTextModel {
  return { ...model };
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) {
    return 0;
  }
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.floor((ordered.length - 1) * ratio))];
}

function pointDistance(first: Point, second: Point): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function pointInConvexPolygon(point: Point, polygon: readonly Point[]): boolean {
  let sign = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    const cross = (next.x - current.x) * (point.y - current.y)
      - (next.y - current.y) * (point.x - current.x);
    if (Math.abs(cross) < 1e-6) {
      continue;
    }
    const nextSign = Math.sign(cross);
    if (sign !== 0 && nextSign !== sign) {
      return false;
    }
    sign = nextSign;
  }
  return true;
}

export class VectorTextPrototype {
  private readonly presentationCanvas = requiredElement<HTMLCanvasElement>(
    "vectorTextPresentationCanvas",
  );
  private readonly interactionCanvas = requiredElement<HTMLCanvasElement>(
    "vectorTextInteractionCanvas",
  );
  private readonly section = requiredElement<HTMLElement>("vectorTextPrototypeSection");
  private readonly textInput = requiredElement<HTMLInputElement>("vectorTextValue");
  private readonly fontFamilySelect = requiredElement<HTMLSelectElement>("vectorTextFontFamily");
  private readonly fontSizeInput = requiredElement<HTMLInputElement>("vectorTextFontSize");
  private readonly fontSizeOutput = requiredElement<HTMLOutputElement>("vectorTextFontSizeOut");
  private readonly colorInput = requiredElement<HTMLInputElement>("vectorTextColor");
  private readonly placementSelect = requiredElement<HTMLSelectElement>("vectorTextPlacement");
  private readonly editToggle = requiredElement<HTMLButtonElement>("vectorTextEditToggle");
  private readonly resetButton = requiredElement<HTMLButtonElement>("vectorTextReset");
  private readonly status = requiredElement<HTMLElement>("vectorTextStatus");

  private readonly presentationContext: CanvasRenderingContext2D;
  private readonly interactionContext: CanvasRenderingContext2D;
  private model: VectorTextModel;
  private metrics: TextMetricsBox = {
    left: -1,
    top: -1,
    right: 1,
    bottom: 1,
    baseline: 0,
  };
  private activeInteraction: ActiveInteraction | null = null;
  private editing = true;
  private renderRequest: number | null = null;
  private renderCount = 0;
  private lastRenderMs = 0;
  private renderSamples: number[] = [];
  private gpuStats: VectorTextGpuPresentationStats | null = null;

  constructor(private readonly host: VectorTextPrototypeHost) {
    const presentationContext = this.presentationCanvas.getContext("2d", {
      alpha: true,
      desynchronized: true,
    });
    const interactionContext = this.interactionCanvas.getContext("2d", {
      alpha: true,
      desynchronized: true,
    });
    if (!presentationContext || !interactionContext) {
      throw new Error("Canvas2D non disponibile per il prototipo testo vettoriale.");
    }
    this.presentationContext = presentationContext;
    this.interactionContext = interactionContext;
    this.model = this.defaultModel();
  }

  initialize(): void {
    this.section.hidden = false;
    this.presentationCanvas.hidden = false;
    this.interactionCanvas.hidden = false;
    this.syncControlsFromModel();
    this.bindControls();
    this.setEditing(true);
    this.renderNow();
  }

  scheduleViewSync(): void {
    this.scheduleRender();
  }

  getDiagnostics(): VectorTextPrototypeDiagnostics {
    const view = this.host.getVectorTextViewState();
    return {
      strategy: VECTOR_TEXT_PRESENTATION_STRATEGY,
      model: copyModel(this.model),
      editing: this.editing,
      renderCount: this.renderCount,
      lastRenderMs: this.lastRenderMs,
      renderP95Ms: percentile(this.renderSamples, 0.95),
      gpuMemoryMiB: this.gpuStats?.gpuMemoryMiB ?? 0,
      browserCanvasLogicalMiB:
        view.canvasWidth * view.canvasHeight * 4 * 2 / MEBIBYTE_BYTES,
      canvasWidth: view.canvasWidth,
      canvasHeight: view.canvasHeight,
    };
  }

  private defaultModel(): VectorTextModel {
    return {
      text: "STREETWEAR",
      fontFamily: "Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif",
      fontSize: 360,
      color: "#f4c95d",
      x: this.host.layerSize * 0.5,
      y: this.host.layerSize * 0.5,
      scale: 1,
      rotation: -4 * Math.PI / 180,
      placement: "below-active",
    };
  }

  private bindControls(): void {
    this.textInput.addEventListener("input", () => {
      this.model.text = this.textInput.value || " ";
      this.scheduleRender();
    });
    this.fontFamilySelect.addEventListener("change", () => {
      this.model.fontFamily = this.fontFamilySelect.value;
      this.scheduleRender();
    });
    this.fontSizeInput.addEventListener("input", () => {
      this.model.fontSize = Number(this.fontSizeInput.value);
      this.fontSizeOutput.value = `${Math.round(this.model.fontSize)} px`;
      this.scheduleRender();
    });
    this.colorInput.addEventListener("input", () => {
      this.model.color = this.colorInput.value;
      this.scheduleRender();
    });
    this.placementSelect.addEventListener("change", () => {
      this.model.placement = this.placementSelect.value as VectorTextPlacement;
      this.scheduleRender();
    });
    this.editToggle.addEventListener("click", () => {
      this.setEditing(!this.editing);
    });
    this.resetButton.addEventListener("click", () => {
      this.model = this.defaultModel();
      this.syncControlsFromModel();
      this.setEditing(true);
      this.scheduleRender();
    });

    this.interactionCanvas.addEventListener("pointerdown", (event) => {
      this.onPointerDown(event);
    });
    this.interactionCanvas.addEventListener("pointermove", (event) => {
      this.onPointerMove(event);
    });
    this.interactionCanvas.addEventListener("pointerup", (event) => {
      this.finishPointer(event);
    });
    this.interactionCanvas.addEventListener("pointercancel", (event) => {
      this.finishPointer(event);
    });
    this.interactionCanvas.addEventListener("lostpointercapture", (event) => {
      this.finishPointer(event);
    });
    this.interactionCanvas.addEventListener("contextmenu", (event) => {
      event.preventDefault();
    });
    this.interactionCanvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const factor = Math.exp(-event.deltaY * 0.0015);
        this.host.zoomBy(
          Math.min(2, Math.max(0.5, factor)),
          event.clientX,
          event.clientY,
        );
      },
      { passive: false },
    );
    window.addEventListener("keydown", (event) => {
      if (
        event.key === "Escape"
        && this.editing
        && !(event.target instanceof Element
          && event.target.closest("input, textarea, select, [contenteditable]"))
      ) {
        this.setEditing(false);
      }
    });
  }

  private syncControlsFromModel(): void {
    this.textInput.value = this.model.text;
    this.fontFamilySelect.value = this.model.fontFamily;
    this.fontSizeInput.value = String(this.model.fontSize);
    this.fontSizeOutput.value = `${Math.round(this.model.fontSize)} px`;
    this.colorInput.value = this.model.color;
    this.placementSelect.value = this.model.placement;
  }

  private setEditing(editing: boolean): void {
    this.editing = editing;
    this.activeInteraction = null;
    this.interactionCanvas.classList.toggle("is-editing", editing);
    this.interactionCanvas.setAttribute("aria-hidden", String(!editing));
    this.editToggle.setAttribute("aria-pressed", String(editing));
    this.editToggle.textContent = editing ? "Passa al pennello" : "Modifica testo";
    this.scheduleRender();
  }

  private scheduleRender(): void {
    if (this.renderRequest !== null) {
      return;
    }
    this.renderRequest = requestAnimationFrame(() => {
      this.renderRequest = null;
      this.renderNow();
    });
  }

  private syncCanvasSizes(view: VectorTextViewState): void {
    for (const canvas of [this.presentationCanvas, this.interactionCanvas]) {
      if (canvas.width !== view.canvasWidth || canvas.height !== view.canvasHeight) {
        canvas.width = view.canvasWidth;
        canvas.height = view.canvasHeight;
      }
    }
  }

  private configureTextContext(context: CanvasRenderingContext2D): void {
    context.font = `900 ${this.model.fontSize}px ${this.model.fontFamily}`;
    context.textAlign = "center";
    context.textBaseline = "alphabetic";
    context.lineJoin = "round";
  }

  private measureText(): TextMetricsBox {
    const context = this.presentationContext;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    this.configureTextContext(context);
    const measurement = context.measureText(this.model.text);
    const ascent = Math.max(
      1,
      measurement.actualBoundingBoxAscent || this.model.fontSize * 0.78,
    );
    const descent = Math.max(
      1,
      measurement.actualBoundingBoxDescent || this.model.fontSize * 0.22,
    );
    const width = Math.max(
      1,
      measurement.actualBoundingBoxLeft + measurement.actualBoundingBoxRight
        || measurement.width,
    );
    const baseline = (ascent - descent) * 0.5;
    context.restore();
    return {
      left: -width * 0.5,
      top: -(ascent + descent) * 0.5,
      right: width * 0.5,
      bottom: (ascent + descent) * 0.5,
      baseline,
    };
  }

  private setViewTransform(
    context: CanvasRenderingContext2D,
    view: VectorTextViewState,
  ): void {
    const a = view.rotationCos * view.zoom;
    const b = view.rotationSin * view.zoom;
    const c = -view.rotationSin * view.zoom;
    const d = view.rotationCos * view.zoom;
    const e = view.canvasWidth * 0.5 - a * view.centerX - c * view.centerY;
    const f = view.canvasHeight * 0.5 - b * view.centerX - d * view.centerY;
    context.setTransform(a, b, c, d, e, f);
  }

  private renderNow(): void {
    const startedAt = performance.now();
    const view = this.host.getVectorTextViewState();
    this.syncCanvasSizes(view);
    this.metrics = this.measureText();

    const context = this.presentationContext;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, view.canvasWidth, view.canvasHeight);
    this.setViewTransform(context, view);
    context.translate(this.model.x, this.model.y);
    context.rotate(this.model.rotation);
    context.scale(this.model.scale, this.model.scale);
    this.configureTextContext(context);
    context.fillStyle = this.model.color;
    context.fillText(this.model.text, 0, this.metrics.baseline);
    context.restore();

    const oppositePlacement: VectorTextPlacement = this.model.placement === "below-active"
      ? "above-active"
      : "below-active";
    this.host.clearVectorTextPresentation(oppositePlacement);
    this.gpuStats = this.host.updateVectorTextPresentation(
      this.presentationCanvas,
      this.model.placement,
    );
    this.renderInteractionOverlay(view);

    this.lastRenderMs = performance.now() - startedAt;
    this.renderSamples.push(this.lastRenderMs);
    if (this.renderSamples.length > FRAME_SAMPLE_LIMIT) {
      this.renderSamples.splice(0, this.renderSamples.length - FRAME_SAMPLE_LIMIT);
    }
    this.renderCount += 1;
    this.updateStatus(view);
  }

  private updateStatus(view: VectorTextViewState): void {
    const gpuMemoryMiB = this.gpuStats?.gpuMemoryMiB ?? 0;
    const browserCanvasLogicalMiB =
      view.canvasWidth * view.canvasHeight * 4 * 2 / MEBIBYTE_BYTES;
    const placement = this.model.placement === "below-active"
      ? "sotto il raster attivo"
      : "sopra il raster attivo";
    const interaction = this.editing
      ? "trascina testo, angoli e maniglia tonda · Shift+trascina sposta la vista"
      : "pennello attivo · premi «Modifica testo» per riselezionarlo";
    this.status.textContent =
      `${placement} · GPU ${gpuMemoryMiB.toFixed(2)} MiB · `
      + `2 canvas logici ${browserCanvasLogicalMiB.toFixed(2)} MiB · `
      + `render ${this.lastRenderMs.toFixed(2)} ms (p95 `
      + `${percentile(this.renderSamples, 0.95).toFixed(2)} ms) · ${interaction}`;
  }

  private layerToCanvas(point: Point, view: VectorTextViewState): Point {
    const deltaX = point.x - view.centerX;
    const deltaY = point.y - view.centerY;
    return {
      x: view.canvasWidth * 0.5
        + (view.rotationCos * deltaX - view.rotationSin * deltaY) * view.zoom,
      y: view.canvasHeight * 0.5
        + (view.rotationSin * deltaX + view.rotationCos * deltaY) * view.zoom,
    };
  }

  private localToLayer(point: Point): Point {
    const scaledX = point.x * this.model.scale;
    const scaledY = point.y * this.model.scale;
    const cosine = Math.cos(this.model.rotation);
    const sine = Math.sin(this.model.rotation);
    return {
      x: this.model.x + cosine * scaledX - sine * scaledY,
      y: this.model.y + sine * scaledX + cosine * scaledY,
    };
  }

  private textCorners(view: VectorTextViewState): readonly Point[] {
    const localCorners: readonly Point[] = [
      { x: this.metrics.left, y: this.metrics.top },
      { x: this.metrics.right, y: this.metrics.top },
      { x: this.metrics.right, y: this.metrics.bottom },
      { x: this.metrics.left, y: this.metrics.bottom },
    ];
    return localCorners.map((point) => this.layerToCanvas(this.localToLayer(point), view));
  }

  private rotationHandle(corners: readonly Point[], view: VectorTextViewState): Point {
    const topCenter = {
      x: (corners[0].x + corners[1].x) * 0.5,
      y: (corners[0].y + corners[1].y) * 0.5,
    };
    const center = this.layerToCanvas({ x: this.model.x, y: this.model.y }, view);
    const directionX = topCenter.x - center.x;
    const directionY = topCenter.y - center.y;
    const length = Math.max(1, Math.hypot(directionX, directionY));
    const backingPerCssPixel = view.canvasWidth / Math.max(1, view.cssWidth);
    const offset = ROTATION_HANDLE_OFFSET_CSS_PX * backingPerCssPixel;
    return {
      x: topCenter.x + directionX / length * offset,
      y: topCenter.y + directionY / length * offset,
    };
  }

  private renderInteractionOverlay(view: VectorTextViewState): void {
    const context = this.interactionContext;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, view.canvasWidth, view.canvasHeight);
    if (!this.editing) {
      context.restore();
      return;
    }

    const corners = this.textCorners(view);
    const rotationHandle = this.rotationHandle(corners, view);
    const topCenter = {
      x: (corners[0].x + corners[1].x) * 0.5,
      y: (corners[0].y + corners[1].y) * 0.5,
    };
    const backingPerCssPixel = view.canvasWidth / Math.max(1, view.cssWidth);
    const lineWidth = Math.max(1, 1.25 * backingPerCssPixel);
    const handleRadius = HANDLE_RADIUS_CSS_PX * backingPerCssPixel;

    context.strokeStyle = "#8d9aff";
    context.fillStyle = "#f7f8ff";
    context.lineWidth = lineWidth;
    context.setLineDash([]);
    context.beginPath();
    context.moveTo(corners[0].x, corners[0].y);
    for (let index = 1; index < corners.length; index += 1) {
      context.lineTo(corners[index].x, corners[index].y);
    }
    context.closePath();
    context.stroke();

    context.beginPath();
    context.moveTo(topCenter.x, topCenter.y);
    context.lineTo(rotationHandle.x, rotationHandle.y);
    context.stroke();

    for (const corner of corners) {
      context.beginPath();
      context.rect(
        corner.x - handleRadius,
        corner.y - handleRadius,
        handleRadius * 2,
        handleRadius * 2,
      );
      context.fill();
      context.stroke();
    }
    context.beginPath();
    context.arc(rotationHandle.x, rotationHandle.y, handleRadius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.restore();
  }

  private eventCanvasPoint(event: PointerEvent): Point {
    const rectangle = this.interactionCanvas.getBoundingClientRect();
    return {
      x: (event.clientX - rectangle.left)
        / Math.max(1, rectangle.width) * this.interactionCanvas.width,
      y: (event.clientY - rectangle.top)
        / Math.max(1, rectangle.height) * this.interactionCanvas.height,
    };
  }

  private eventLayerPoint(event: PointerEvent): Point {
    return this.host.toLayerPoint({
      clientX: event.clientX,
      clientY: event.clientY,
      pressure: event.pressure || 0.5,
      timeMs: event.timeStamp,
    });
  }

  private hitHandle(
    point: Point,
    corners: readonly Point[],
    view: VectorTextViewState,
  ): TransformHandle | "rotate" | null {
    const backingPerCssPixel = view.canvasWidth / Math.max(1, view.cssWidth);
    const hitRadius = HANDLE_HIT_RADIUS_CSS_PX * backingPerCssPixel;
    const rotationHandle = this.rotationHandle(corners, view);
    if (pointDistance(point, rotationHandle) <= hitRadius) {
      return "rotate";
    }
    const handles: readonly TransformHandle[] = [
      "north-west",
      "north-east",
      "south-east",
      "south-west",
    ];
    const index = corners.findIndex((corner) => pointDistance(point, corner) <= hitRadius);
    return index >= 0 ? handles[index] : null;
  }

  private onPointerDown(event: PointerEvent): void {
    if (!this.editing || this.activeInteraction) {
      return;
    }
    const view = this.host.getVectorTextViewState();
    const canvasPoint = this.eventCanvasPoint(event);
    const layerPoint = this.eventLayerPoint(event);
    const corners = this.textCorners(view);
    const handle = this.hitHandle(canvasPoint, corners, view);
    const shouldPan = event.shiftKey || event.button === 1 || event.button === 2;
    let mode: InteractionMode | null = shouldPan
      ? "pan"
      : handle === "rotate"
        ? "rotate"
        : handle
          ? "scale"
          : pointInConvexPolygon(canvasPoint, corners)
            ? "move"
            : null;
    if (!mode) {
      return;
    }

    event.preventDefault();
    this.interactionCanvas.setPointerCapture(event.pointerId);
    const center = { x: this.model.x, y: this.model.y };
    this.activeInteraction = {
      pointerId: event.pointerId,
      mode,
      startClient: { x: event.clientX, y: event.clientY },
      startLayer: layerPoint,
      startModel: copyModel(this.model),
      startDistance: Math.max(1e-6, pointDistance(layerPoint, center)),
      startAngle: Math.atan2(layerPoint.y - center.y, layerPoint.x - center.x),
    };
    this.interactionCanvas.classList.add(`is-${mode}`);
  }

  private onPointerMove(event: PointerEvent): void {
    const interaction = this.activeInteraction;
    if (!interaction || event.pointerId !== interaction.pointerId) {
      return;
    }
    event.preventDefault();
    if (interaction.mode === "pan") {
      const deltaX = event.clientX - interaction.startClient.x;
      const deltaY = event.clientY - interaction.startClient.y;
      interaction.startClient = { x: event.clientX, y: event.clientY };
      this.host.panByClientDelta(deltaX, deltaY);
      return;
    }

    const layerPoint = this.eventLayerPoint(event);
    if (interaction.mode === "move") {
      this.model.x = interaction.startModel.x + layerPoint.x - interaction.startLayer.x;
      this.model.y = interaction.startModel.y + layerPoint.y - interaction.startLayer.y;
    } else if (interaction.mode === "scale") {
      const distance = pointDistance(layerPoint, {
        x: interaction.startModel.x,
        y: interaction.startModel.y,
      });
      this.model.scale = Math.min(
        MAXIMUM_SCALE,
        Math.max(
          MINIMUM_SCALE,
          interaction.startModel.scale * distance / interaction.startDistance,
        ),
      );
    } else if (interaction.mode === "rotate") {
      const angle = Math.atan2(
        layerPoint.y - interaction.startModel.y,
        layerPoint.x - interaction.startModel.x,
      );
      this.model.rotation = interaction.startModel.rotation
        + angle - interaction.startAngle;
    }
    this.scheduleRender();
  }

  private finishPointer(event: PointerEvent): void {
    const interaction = this.activeInteraction;
    if (!interaction || event.pointerId !== interaction.pointerId) {
      return;
    }
    this.interactionCanvas.classList.remove(
      "is-move",
      "is-scale",
      "is-rotate",
      "is-pan",
    );
    this.activeInteraction = null;
    this.scheduleRender();
  }
}
