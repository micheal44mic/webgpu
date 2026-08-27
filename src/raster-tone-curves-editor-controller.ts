import {
  DEFAULT_RASTER_TONE_CURVE_SET,
  RASTER_TONE_CURVE_MAX_POINTS,
  RASTER_TONE_HISTOGRAM_BIN_COUNT,
  compileRasterToneCurve,
  evaluateCompiledRasterToneCurve,
  normalizeRasterToneCurveSet,
  rasterToneHistogramOffset,
  type RasterToneCurveChannel,
  type RasterToneCurvePoint,
  type RasterToneCurveSet,
} from "./raster-tone-curves-core.ts";

const MINIMUM_INPUT_GAP = 1 / 255;
const POINTER_HIT_RADIUS_MOUSE = 11;
const POINTER_HIT_RADIUS_TOUCH = 24;
const GRAPH_INSET = 12;
const AUTO_CLIP_FRACTION = 0.005;

export interface RasterToneCurvesEditorElements {
  readonly canvas: HTMLCanvasElement;
  readonly channelSelect: HTMLSelectElement;
  readonly inputValue: HTMLInputElement;
  readonly outputValue: HTMLInputElement;
  readonly autoButton: HTMLButtonElement;
  readonly resetButton: HTMLButtonElement;
  readonly deleteButton: HTMLButtonElement;
}

export interface RasterToneCurvesEditorOptions {
  readonly browser: {
    readonly AbortController: typeof AbortController;
    readonly devicePixelRatio: number;
    readonly requestAnimationFrame: Window["requestAnimationFrame"];
    readonly cancelAnimationFrame: Window["cancelAnimationFrame"];
  };
  readonly elements: RasterToneCurvesEditorElements;
  readonly onChange: (curves: Readonly<RasterToneCurveSet>) => void;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function clonePoints(points: readonly RasterToneCurvePoint[]): RasterToneCurvePoint[] {
  return points.map((point) => ({ ...point }));
}

function cloneSet(curves: Readonly<RasterToneCurveSet>): RasterToneCurveSet {
  return {
    composite: clonePoints(curves.composite),
    red: clonePoints(curves.red),
    green: clonePoints(curves.green),
    blue: clonePoints(curves.blue),
  };
}

function isChannel(value: string): value is RasterToneCurveChannel {
  return value === "composite" || value === "red" || value === "green" || value === "blue";
}

function pointValue(value: string): number {
  const number = Number(value);
  return clamp(Number.isFinite(number) ? number : 0, 0, 255) / 255;
}

function percentileBin(
  histogram: Uint32Array,
  offset: number,
  fraction: number,
): number {
  let total = 0;
  for (let index = 0; index < RASTER_TONE_HISTOGRAM_BIN_COUNT; index += 1) {
    total += histogram[offset + index] ?? 0;
  }
  if (total <= 0) return fraction < 0.5 ? 0 : 255;
  const target = total * fraction;
  let cumulative = 0;
  for (let index = 0; index < RASTER_TONE_HISTOGRAM_BIN_COUNT; index += 1) {
    cumulative += histogram[offset + index] ?? 0;
    if (cumulative >= target) return index;
  }
  return 255;
}

/** Owns curve points, accessible controls, pointer gestures and graph drawing. */
export class RasterToneCurvesEditorController {
  private readonly abortController: AbortController;
  private curves = cloneSet(DEFAULT_RASTER_TONE_CURVE_SET);
  private histogram = new Uint32Array(4 * RASTER_TONE_HISTOGRAM_BIN_COUNT);
  private channel: RasterToneCurveChannel = "composite";
  private selectedPointIndex = 0;
  private pointerId: number | null = null;
  private drawFrame: number | null = null;
  private disabled = true;
  private disposed = false;

  constructor(private readonly options: RasterToneCurvesEditorOptions) {
    this.abortController = new options.browser.AbortController();
    this.bindEvents();
    this.setDisabled(true);
    this.requestDraw();
  }

  snapshot(): RasterToneCurveSet {
    return cloneSet(this.curves);
  }

  setState(
    curves: Readonly<RasterToneCurveSet>,
    histogram?: Uint32Array,
  ): void {
    this.curves = cloneSet(normalizeRasterToneCurveSet(curves));
    if (histogram) this.histogram = histogram.slice();
    this.selectedPointIndex = clamp(
      this.selectedPointIndex,
      0,
      this.activePoints().length - 1,
    );
    this.syncControls();
    this.requestDraw();
  }

  setHistogram(histogram: Uint32Array): void {
    this.histogram = histogram.slice();
    this.requestDraw();
  }

  setDisabled(disabled: boolean): void {
    if (disabled) this.releaseActivePointer();
    this.disabled = disabled;
    const { elements } = this.options;
    elements.canvas.toggleAttribute("inert", disabled);
    elements.canvas.setAttribute("aria-disabled", String(disabled));
    elements.channelSelect.disabled = disabled;
    elements.inputValue.disabled = disabled;
    elements.outputValue.disabled = disabled;
    elements.autoButton.disabled = disabled;
    elements.resetButton.disabled = disabled;
    this.syncControls();
  }

  handleResize(): void {
    this.requestDraw();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseActivePointer();
    this.abortController.abort();
    if (this.drawFrame !== null) {
      this.options.browser.cancelAnimationFrame(this.drawFrame);
      this.drawFrame = null;
    }
  }

  private bindEvents(): void {
    const { elements } = this.options;
    const signal = this.abortController.signal;
    elements.channelSelect.addEventListener("change", () => {
      const channel = elements.channelSelect.value;
      if (!isChannel(channel)) return;
      this.channel = channel;
      this.selectedPointIndex = 0;
      this.syncControls();
      this.requestDraw();
    }, { signal });
    elements.inputValue.addEventListener("input", () => this.updateSelectedFromInputs(), { signal });
    elements.outputValue.addEventListener("input", () => this.updateSelectedFromInputs(), { signal });
    elements.deleteButton.addEventListener("click", () => this.deleteSelectedPoint(), { signal });
    elements.resetButton.addEventListener("click", () => this.resetActiveCurve(), { signal });
    elements.autoButton.addEventListener("click", () => this.autoAdjustActiveCurve(), { signal });
    elements.canvas.addEventListener("pointerdown", (event) => this.beginPointer(event), { signal });
    elements.canvas.addEventListener("pointermove", (event) => this.movePointer(event), { signal });
    elements.canvas.addEventListener("pointerup", (event) => this.endPointer(event), { signal });
    elements.canvas.addEventListener("pointercancel", (event) => this.endPointer(event), { signal });
    elements.canvas.addEventListener("lostpointercapture", (event) => this.endPointer(event), { signal });
    elements.canvas.addEventListener("keydown", (event) => this.handleKey(event), { signal });
  }

  private activePoints(): RasterToneCurvePoint[] {
    return this.curves[this.channel] as RasterToneCurvePoint[];
  }

  private replaceActivePoints(points: readonly RasterToneCurvePoint[], notify = true): void {
    this.curves = {
      ...this.curves,
      [this.channel]: clonePoints(points),
    };
    this.syncControls();
    this.requestDraw();
    if (notify) this.options.onChange(this.snapshot());
  }

  private updateSelectedFromInputs(): void {
    if (this.disabled) return;
    const points = clonePoints(this.activePoints());
    const index = this.selectedPointIndex;
    const point = points[index];
    if (!point) return;
    const minimumX = index === 0 ? 0 : points[index - 1].x + MINIMUM_INPUT_GAP;
    const maximumX = index === points.length - 1 ? 1 : points[index + 1].x - MINIMUM_INPUT_GAP;
    points[index] = {
      x: clamp(
        pointValue(this.options.elements.inputValue.value),
        minimumX,
        maximumX,
      ),
      y: pointValue(this.options.elements.outputValue.value),
    };
    this.replaceActivePoints(points);
  }

  private deleteSelectedPoint(): void {
    if (this.disabled) return;
    const points = clonePoints(this.activePoints());
    if (this.selectedPointIndex <= 0 || this.selectedPointIndex >= points.length - 1) return;
    points.splice(this.selectedPointIndex, 1);
    this.selectedPointIndex = Math.max(0, this.selectedPointIndex - 1);
    this.replaceActivePoints(points);
  }

  private resetActiveCurve(): void {
    if (this.disabled) return;
    this.selectedPointIndex = 0;
    this.replaceActivePoints(DEFAULT_RASTER_TONE_CURVE_SET[this.channel]);
  }

  private autoAdjustActiveCurve(): void {
    if (this.disabled) return;
    const offset = rasterToneHistogramOffset(this.channel);
    const low = percentileBin(this.histogram, offset, AUTO_CLIP_FRACTION);
    const high = percentileBin(this.histogram, offset, 1 - AUTO_CLIP_FRACTION);
    if (high <= low + 1) return;
    const points = normalizeRasterToneCurveSet({
      [this.channel]: [
        { x: 0, y: 0 },
        { x: low / 255, y: 0 },
        { x: high / 255, y: 1 },
        { x: 1, y: 1 },
      ],
    })[this.channel];
    this.selectedPointIndex = Math.min(1, points.length - 1);
    this.replaceActivePoints(points);
  }

  private graphGeometry(): { left: number; top: number; size: number } {
    const rect = this.options.elements.canvas.getBoundingClientRect();
    return {
      left: GRAPH_INSET,
      top: GRAPH_INSET,
      size: Math.max(1, Math.min(rect.width, rect.height) - 2 * GRAPH_INSET),
    };
  }

  private pointerValue(event: PointerEvent): RasterToneCurvePoint {
    const rect = this.options.elements.canvas.getBoundingClientRect();
    const graph = this.graphGeometry();
    return {
      x: clamp((event.clientX - rect.left - graph.left) / graph.size, 0, 1),
      y: clamp(1 - (event.clientY - rect.top - graph.top) / graph.size, 0, 1),
    };
  }

  private nearestPointIndex(event: PointerEvent): number {
    const rect = this.options.elements.canvas.getBoundingClientRect();
    const graph = this.graphGeometry();
    const radius = event.pointerType === "touch"
      ? POINTER_HIT_RADIUS_TOUCH
      : POINTER_HIT_RADIUS_MOUSE;
    let nearest = -1;
    let nearestDistance = radius * radius;
    for (const [index, point] of this.activePoints().entries()) {
      const x = rect.left + graph.left + point.x * graph.size;
      const y = rect.top + graph.top + (1 - point.y) * graph.size;
      const distance = (event.clientX - x) ** 2 + (event.clientY - y) ** 2;
      if (distance <= nearestDistance) {
        nearest = index;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  private beginPointer(event: PointerEvent): void {
    if (this.disabled || event.button !== 0 || this.pointerId !== null) return;
    event.preventDefault();
    const points = clonePoints(this.activePoints());
    let index = this.nearestPointIndex(event);
    if (index < 0) {
      if (points.length >= RASTER_TONE_CURVE_MAX_POINTS) return;
      const point = this.pointerValue(event);
      index = points.findIndex((candidate) => candidate.x > point.x);
      if (index < 0) index = points.length;
      index = clamp(index, 1, points.length - 1);
      const minimumX = points[index - 1].x + MINIMUM_INPUT_GAP;
      const maximumX = points[index].x - MINIMUM_INPUT_GAP;
      points.splice(index, 0, { x: clamp(point.x, minimumX, maximumX), y: point.y });
      this.replaceActivePoints(points);
    }
    this.selectedPointIndex = index;
    this.pointerId = event.pointerId;
    this.options.elements.canvas.setPointerCapture(event.pointerId);
    this.syncControls();
    this.requestDraw();
  }

  private movePointer(event: PointerEvent): void {
    if (event.pointerId !== this.pointerId) return;
    event.preventDefault();
    const points = clonePoints(this.activePoints());
    const index = this.selectedPointIndex;
    const value = this.pointerValue(event);
    const minimumX = index === 0 ? 0 : points[index - 1].x + MINIMUM_INPUT_GAP;
    const maximumX = index === points.length - 1 ? 1 : points[index + 1].x - MINIMUM_INPUT_GAP;
    points[index] = {
      x: clamp(value.x, minimumX, maximumX),
      y: value.y,
    };
    this.replaceActivePoints(points);
  }

  private endPointer(event: PointerEvent): void {
    if (event.pointerId !== this.pointerId) return;
    this.releaseActivePointer();
  }

  private releaseActivePointer(): void {
    const pointerId = this.pointerId;
    if (pointerId === null) return;
    this.pointerId = null;
    if (this.options.elements.canvas.hasPointerCapture(pointerId)) {
      this.options.elements.canvas.releasePointerCapture(pointerId);
    }
  }

  private selectPoint(index: number): void {
    this.selectedPointIndex = clamp(index, 0, this.activePoints().length - 1);
    this.syncControls();
    this.requestDraw();
  }

  private addKeyboardPoint(): void {
    if (this.disabled) return;
    const points = clonePoints(this.activePoints());
    if (points.length >= RASTER_TONE_CURVE_MAX_POINTS) return;
    const lastIndex = points.length - 1;
    let leftIndex = this.selectedPointIndex < lastIndex
      ? this.selectedPointIndex
      : lastIndex - 1;
    if (points[leftIndex + 1].x - points[leftIndex].x < 2 * MINIMUM_INPUT_GAP) {
      let widest = 0;
      for (let index = 0; index < lastIndex; index += 1) {
        const width = points[index + 1].x - points[index].x;
        if (width > widest) {
          widest = width;
          leftIndex = index;
        }
      }
      if (widest < 2 * MINIMUM_INPUT_GAP) return;
    }
    const compiled = compileRasterToneCurve(points);
    const x = (points[leftIndex].x + points[leftIndex + 1].x) * 0.5;
    const y = evaluateCompiledRasterToneCurve(compiled, x);
    const insertionIndex = leftIndex + 1;
    points.splice(insertionIndex, 0, { x, y });
    this.selectedPointIndex = insertionIndex;
    this.replaceActivePoints(points);
  }

  private handleKey(event: KeyboardEvent): void {
    if (this.disabled) return;
    if (event.key === "Enter" || event.key === "+") {
      event.preventDefault();
      this.addKeyboardPoint();
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      this.deleteSelectedPoint();
      return;
    }
    const pointCount = this.activePoints().length;
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      this.selectPoint(event.key === "Home" ? 0 : pointCount - 1);
      return;
    }
    if (
      event.key === "PageUp"
      || event.key === "PageDown"
      || event.key === "["
      || event.key === "]"
    ) {
      event.preventDefault();
      const delta = event.key === "PageUp" || event.key === "[" ? -1 : 1;
      this.selectPoint(this.selectedPointIndex + delta);
      return;
    }
    const delta = event.shiftKey ? 10 / 255 : 1 / 255;
    const points = clonePoints(this.activePoints());
    const point = points[this.selectedPointIndex];
    if (!point) return;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const index = this.selectedPointIndex;
    const minimumX = index === 0 ? 0 : points[index - 1].x + MINIMUM_INPUT_GAP;
    const maximumX = index === points.length - 1 ? 1 : points[index + 1].x - MINIMUM_INPUT_GAP;
    points[index] = {
      x: clamp(
        point.x + (event.key === "ArrowLeft" ? -delta : event.key === "ArrowRight" ? delta : 0),
        minimumX,
        maximumX,
      ),
      y: clamp(point.y + (event.key === "ArrowDown" ? -delta : event.key === "ArrowUp" ? delta : 0), 0, 1),
    };
    this.replaceActivePoints(points);
  }

  private syncControls(): void {
    const points = this.activePoints();
    this.selectedPointIndex = clamp(this.selectedPointIndex, 0, points.length - 1);
    const point = points[this.selectedPointIndex];
    this.options.elements.channelSelect.value = this.channel;
    this.options.elements.inputValue.value = String(Math.round(point.x * 255));
    this.options.elements.outputValue.value = String(Math.round(point.y * 255));
    const endpoint = this.selectedPointIndex === 0 || this.selectedPointIndex === points.length - 1;
    this.options.elements.inputValue.disabled = this.disabled;
    this.options.elements.outputValue.disabled = this.disabled;
    this.options.elements.deleteButton.disabled = this.disabled || endpoint;
    this.options.elements.canvas.setAttribute(
      "aria-label",
      `${this.channel} curve, point ${this.selectedPointIndex + 1} of ${points.length}, `
      + `input ${Math.round(point.x * 255)}, output ${Math.round(point.y * 255)}`,
    );
  }

  private requestDraw(): void {
    if (this.drawFrame !== null || this.disposed) return;
    this.drawFrame = this.options.browser.requestAnimationFrame(() => {
      this.drawFrame = null;
      this.draw();
    });
  }

  private draw(): void {
    const canvas = this.options.elements.canvas;
    const context = canvas.getContext?.("2d");
    if (!context) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(1, this.options.browser.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);
    const graph = this.graphGeometry();
    context.fillStyle = "#11141a";
    context.fillRect(graph.left, graph.top, graph.size, graph.size);
    context.strokeStyle = "#313743";
    context.lineWidth = 1;
    for (let index = 0; index <= 4; index += 1) {
      const offset = graph.size * index / 4;
      context.beginPath();
      context.moveTo(graph.left + offset, graph.top);
      context.lineTo(graph.left + offset, graph.top + graph.size);
      context.moveTo(graph.left, graph.top + offset);
      context.lineTo(graph.left + graph.size, graph.top + offset);
      context.stroke();
    }

    const histogramOffset = rasterToneHistogramOffset(this.channel);
    let maximum = 0;
    for (let index = 0; index < 256; index += 1) {
      maximum = Math.max(maximum, this.histogram[histogramOffset + index] ?? 0);
    }
    if (maximum > 0) {
      context.fillStyle = this.channel === "red"
        ? "rgb(244 91 91 / 34%)"
        : this.channel === "green"
          ? "rgb(88 210 126 / 34%)"
          : this.channel === "blue"
            ? "rgb(91 143 244 / 38%)"
            : "rgb(215 220 230 / 28%)";
      context.beginPath();
      context.moveTo(graph.left, graph.top + graph.size);
      for (let index = 0; index < 256; index += 1) {
        const value = this.histogram[histogramOffset + index] ?? 0;
        const normalized = Math.log1p(value) / Math.log1p(maximum);
        context.lineTo(
          graph.left + graph.size * index / 255,
          graph.top + graph.size * (1 - normalized),
        );
      }
      context.lineTo(graph.left + graph.size, graph.top + graph.size);
      context.closePath();
      context.fill();
    }

    const points = this.activePoints();
    const compiledCurve = compileRasterToneCurve(points);
    context.strokeStyle = this.channel === "red"
      ? "#ff6d6d"
      : this.channel === "green"
        ? "#63db86"
        : this.channel === "blue"
          ? "#6f9dff"
          : "#f4f6fb";
    context.lineWidth = 2;
    context.beginPath();
    for (let index = 0; index <= 255; index += 1) {
      const x = index / 255;
      const y = evaluateCompiledRasterToneCurve(compiledCurve, x);
      const px = graph.left + x * graph.size;
      const py = graph.top + (1 - y) * graph.size;
      if (index === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    }
    context.stroke();

    for (const [index, point] of points.entries()) {
      const x = graph.left + point.x * graph.size;
      const y = graph.top + (1 - point.y) * graph.size;
      context.beginPath();
      context.arc(x, y, index === this.selectedPointIndex ? 5 : 4, 0, Math.PI * 2);
      context.fillStyle = index === this.selectedPointIndex ? "#ff8059" : "#12151b";
      context.fill();
      context.strokeStyle = "#f4f6fb";
      context.lineWidth = 1.5;
      context.stroke();
    }
  }
}
