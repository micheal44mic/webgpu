import type {
  MixedSceneSnapshot,
  PointerSample,
} from "./brush-engine";
import {
  MIXED_SCENE_STACK_STRATEGY,
  VECTOR_TEXT_OUTLINE_MITER_LIMIT,
  VECTOR_TEXT_OUTLINE_STRATEGY,
  vectorTextOutlineCanvasLineWidth,
  type MixedSceneItem,
  type VectorTextNode,
  type VectorTextNodeSeed,
  type VectorTextOutlineJoin,
} from "./mixed-scene-stack";

import {
  VECTOR_TEXT_PRESENTATION_STRATEGY,
} from "./vector-text-shader";
import type {
  VectorTextGpuPresentationStats,
  VectorTextPlacement,
  VectorTextViewState,
} from "./vector-text-prototype";


export interface MixedVectorTextHost {
  readonly layerSize: number;
  getVectorTextViewState(): VectorTextViewState;
  getMixedSceneSnapshot(): MixedSceneSnapshot | null;
  toLayerPoint(sample: PointerSample): { x: number; y: number };
  updateVectorTextPresentation(
    source: HTMLCanvasElement,
    placement: VectorTextPlacement,
  ): VectorTextGpuPresentationStats;
  clearVectorTextPresentation(placement?: VectorTextPlacement): void;
  addVectorTextNode(
    seed: VectorTextNodeSeed,
    name?: string,
  ): Promise<Readonly<VectorTextNode>>;
  updateVectorTextNode(
    id: number,
    update: Partial<Omit<VectorTextNode, "id" | "visible" | "opacity">>,
  ): Readonly<VectorTextNode>;
  moveVectorTextNode(id: number, delta: -1 | 1): Promise<boolean>;
  deleteVectorTextNode(id: number): Promise<Readonly<VectorTextNode>>;
  zoomBy(factor: number, clientX?: number, clientY?: number): void;
  panByClientDelta(deltaClientX: number, deltaClientY: number): void;
}

export interface MixedVectorTextDiagnostics {
  sceneStrategy: typeof MIXED_SCENE_STACK_STRATEGY;
  livePresentationStrategy: typeof VECTOR_TEXT_PRESENTATION_STRATEGY;
  outlineStrategy: typeof VECTOR_TEXT_OUTLINE_STRATEGY;
  selectedKey: MixedSceneItem["key"] | null;
  textNodeCount: number;
  renderCount: number;
  lastRenderMs: number;
  renderP95Ms: number;
  liveGpuMemoryMiB: number;
  viewportTextureCount: number;
  viewportCanvasLogicalMiB: number;
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
  startModel: VectorTextNode;
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
const OUTLINE_JOIN_LABELS: Readonly<Record<VectorTextOutlineJoin, string>> = {
  bevel: "squadrata",
  miter: "a punta",
  round: "tonda",
};

function requiredElement<ElementType extends HTMLElement>(id: string): ElementType {
  const found = document.getElementById(id);
  if (!found) {
    throw new Error(`Elemento #${id} mancante per la scena testo/raster.`);
  }
  return found as ElementType;
}

function copyNode(node: Readonly<VectorTextNode>): VectorTextNode {
  return { ...node };
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

export class MixedVectorTextController {
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
  private readonly outlineWidthInput = requiredElement<HTMLInputElement>(
    "vectorTextOutlineWidth",
  );
  private readonly outlineWidthOutput = requiredElement<HTMLOutputElement>(
    "vectorTextOutlineWidthOut",
  );
  private readonly outlineColorInput = requiredElement<HTMLInputElement>(
    "vectorTextOutlineColor",
  );
  private readonly outlineJoinSelect = requiredElement<HTMLSelectElement>(
    "vectorTextOutlineJoin",
  );
  private readonly addButton = requiredElement<HTMLButtonElement>("addVectorText");
  private readonly deleteButton = requiredElement<HTMLButtonElement>("deleteVectorText");
  private readonly moveUpButton = requiredElement<HTMLButtonElement>("moveVectorTextUp");
  private readonly moveDownButton = requiredElement<HTMLButtonElement>("moveVectorTextDown");
  private readonly resetButton = requiredElement<HTMLButtonElement>("vectorTextReset");
  private readonly status = requiredElement<HTMLElement>("vectorTextStatus");

  private readonly presentationContext: CanvasRenderingContext2D;
  private readonly interactionContext: CanvasRenderingContext2D;

  private snapshot: MixedSceneSnapshot | null = null;
  private metrics: TextMetricsBox = {
    left: -1,
    top: -1,
    right: 1,
    bottom: 1,
    baseline: 0,
  };
  private activeInteraction: ActiveInteraction | null = null;
  private renderRequest: number | null = null;
  private renderCount = 0;
  private lastRenderMs = 0;
  private renderSamples: number[] = [];
  private liveGpuMemoryMiB = 0;
  private viewportTextureCount = 0;
  private sceneOperationBusy = false;

  constructor(private readonly host: MixedVectorTextHost) {
    const presentationContext = this.presentationCanvas.getContext("2d", {
      alpha: true,
      desynchronized: true,
    });
    const interactionContext = this.interactionCanvas.getContext("2d", {
      alpha: true,
      desynchronized: true,
    });
    if (!presentationContext || !interactionContext) {
      throw new Error("Canvas2D non disponibile per la scena testo/raster.");
    }
    this.presentationContext = presentationContext;
    this.interactionContext = interactionContext;
  }

  async initialize(): Promise<void> {
    this.section.hidden = false;
    this.presentationCanvas.hidden = false;
    this.bindControls();
    const initialSnapshot = this.host.getMixedSceneSnapshot();
    if (!initialSnapshot) {
      throw new Error("Il motore non ha creato la scena mista.");
    }
    this.syncScene(initialSnapshot);
    if (!initialSnapshot.items.some((item) => item.kind === "text")) {
      await this.host.addVectorTextNode(this.defaultSeed(0), "Testo 1");
    }
  }

  syncScene(snapshot: MixedSceneSnapshot): void {
    const interaction = this.activeInteraction;
    const interactionStillTargetsSelection =
      interaction !== null
      && snapshot.selectedKey === `text:${interaction.startModel.id}`;
    this.snapshot = snapshot;
    // Pointer-driven model updates publish a fresh scene snapshot on every
    // move. Cancelling unconditionally here used to terminate resize/move/
    // rotate after the first tiny delta. Preserve the gesture while its exact
    // text node remains selected; structural changes and selection changes
    // still cancel it immediately.
    if (!interactionStillTargetsSelection) {
      this.activeInteraction = null;
      this.interactionCanvas.classList.remove(
        "is-move",
        "is-scale",
        "is-rotate",
        "is-pan",
      );
    }
    const node = this.selectedTextNode();
    const textSelected = node !== null;
    this.interactionCanvas.hidden = !textSelected;
    this.interactionCanvas.classList.toggle("is-editing", textSelected);
    this.interactionCanvas.setAttribute("aria-hidden", String(!textSelected));
    this.syncControlsFromSelection(node);
    this.scheduleRender();
  }

  scheduleViewSync(): void {
    if (this.snapshot?.items.some((item) => item.kind === "text")) {
      this.scheduleRender();
    }
  }

  getDiagnostics(): MixedVectorTextDiagnostics {
    const view = this.host.getVectorTextViewState();
    return {
      sceneStrategy: MIXED_SCENE_STACK_STRATEGY,
      livePresentationStrategy: VECTOR_TEXT_PRESENTATION_STRATEGY,
      outlineStrategy: VECTOR_TEXT_OUTLINE_STRATEGY,
      selectedKey: this.snapshot?.selectedKey ?? null,
      textNodeCount: this.snapshot?.items.filter((item) => item.kind === "text").length ?? 0,
      renderCount: this.renderCount,
      lastRenderMs: this.lastRenderMs,
      renderP95Ms: percentile(this.renderSamples, 0.95),
      liveGpuMemoryMiB: this.liveGpuMemoryMiB,
      viewportTextureCount: this.viewportTextureCount,
      viewportCanvasLogicalMiB:
        view.canvasWidth * view.canvasHeight * 4 * 2 / MEBIBYTE_BYTES,
    };
  }

  private defaultSeed(index: number): VectorTextNodeSeed {
    return {
      text: index === 0 ? "STREETWEAR" : `TESTO ${index + 1}`,
      fontFamily: "Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif",
      fontSize: 360,
      color: index % 2 === 0 ? "#f4c95d" : "#f47c5d",
      outlineWidth: 0,
      outlineColor: "#111111",
      outlineJoin: "round",
      x: this.host.layerSize * 0.5 + index * 90,
      y: this.host.layerSize * 0.5 + index * 110,
      scale: 1,
      rotation: index === 0 ? -4 * Math.PI / 180 : 0,
    };
  }

  private selectedTextNode(): Readonly<VectorTextNode> | null {
    const snapshot = this.snapshot;
    if (!snapshot) {
      return null;
    }
    const selected = snapshot.items.find((item) => item.key === snapshot.selectedKey);
    return selected?.kind === "text" ? selected.textNode : null;
  }


  private bindControls(): void {
    this.textInput.addEventListener("input", () => {
      this.updateSelectedNode({ text: this.textInput.value || " " });
    });
    this.fontFamilySelect.addEventListener("change", () => {
      this.updateSelectedNode({ fontFamily: this.fontFamilySelect.value });
    });
    this.fontSizeInput.addEventListener("input", () => {
      const fontSize = Number(this.fontSizeInput.value);
      this.fontSizeOutput.value = `${Math.round(fontSize)} px`;
      this.updateSelectedNode({ fontSize });
    });
    this.colorInput.addEventListener("input", () => {
      this.updateSelectedNode({ color: this.colorInput.value });
    });
    this.outlineWidthInput.addEventListener("input", () => {
      const outlineWidth = Number(this.outlineWidthInput.value);
      this.outlineWidthOutput.value = `${Math.round(outlineWidth)} px`;
      this.updateSelectedNode({ outlineWidth });
    });
    this.outlineColorInput.addEventListener("input", () => {
      this.updateSelectedNode({ outlineColor: this.outlineColorInput.value });
    });
    this.outlineJoinSelect.addEventListener("change", () => {
      this.updateSelectedNode({
        outlineJoin: this.outlineJoinSelect.value as VectorTextOutlineJoin,
      });
    });
    this.addButton.addEventListener("click", () => {
      void this.runSceneOperation(async () => {
        const textCount =
          this.snapshot?.items.filter((item) => item.kind === "text").length ?? 0;
        await this.host.addVectorTextNode(
          this.defaultSeed(textCount),
          `Testo ${textCount + 1}`,
        );
      });
    });
    this.deleteButton.addEventListener("click", () => {
      const node = this.selectedTextNode();
      if (node) {
        void this.runSceneOperation(async () => {
          await this.host.deleteVectorTextNode(node.id);
        });
      }
    });
    this.moveUpButton.addEventListener("click", () => {
      const node = this.selectedTextNode();
      if (node) {
        void this.runSceneOperation(async () => {
          await this.host.moveVectorTextNode(node.id, 1);
        });
      }
    });
    this.moveDownButton.addEventListener("click", () => {
      const node = this.selectedTextNode();
      if (node) {
        void this.runSceneOperation(async () => {
          await this.host.moveVectorTextNode(node.id, -1);
        });
      }
    });
    this.resetButton.addEventListener("click", () => {
      const node = this.selectedTextNode();
      if (!node) {
        return;
      }
      const seed = this.defaultSeed(Math.max(0, node.id - 1));
      this.updateSelectedNode(seed);
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
  }

  private async runSceneOperation(operation: () => Promise<void>): Promise<void> {
    if (this.sceneOperationBusy) {
      return;
    }
    this.sceneOperationBusy = true;
    this.syncControlsFromSelection(this.selectedTextNode());
    try {
      await operation();
    } catch (error) {
      this.status.textContent = error instanceof Error
        ? error.message
        : "Modifica della scena testo/raster non riuscita.";
    } finally {
      this.sceneOperationBusy = false;
      this.syncControlsFromSelection(this.selectedTextNode());
    }
  }

  private updateSelectedNode(
    update: Partial<Omit<VectorTextNode, "id" | "visible" | "opacity">>,
  ): void {
    const node = this.selectedTextNode();
    if (!node || this.sceneOperationBusy) {
      return;
    }
    this.host.updateVectorTextNode(node.id, update);
  }

  private syncControlsFromSelection(node: Readonly<VectorTextNode> | null): void {
    const disabled = !node || this.sceneOperationBusy;
    this.textInput.disabled = disabled;
    this.fontFamilySelect.disabled = disabled;
    this.fontSizeInput.disabled = disabled;
    this.colorInput.disabled = disabled;
    this.outlineWidthInput.disabled = disabled;
    this.outlineColorInput.disabled = disabled;
    this.outlineJoinSelect.disabled = disabled;
    this.resetButton.disabled = disabled;
    this.deleteButton.disabled = disabled;
    this.moveUpButton.disabled = disabled;
    this.moveDownButton.disabled = disabled;
    this.addButton.disabled = this.sceneOperationBusy;
    if (!node) {
      this.status.textContent =
        "Raster selezionato: il pennello è attivo. «Aggiungi testo» crea un livello separato.";
      return;
    }
    this.textInput.value = node.text;
    this.fontFamilySelect.value = node.fontFamily;
    this.fontSizeInput.value = String(node.fontSize);
    this.fontSizeOutput.value = `${Math.round(node.fontSize)} px`;
    this.colorInput.value = node.color;
    this.outlineWidthInput.value = String(node.outlineWidth);
    this.outlineWidthOutput.value = `${Math.round(node.outlineWidth)} px`;
    this.outlineColorInput.value = node.outlineColor;
    this.outlineJoinSelect.value = node.outlineJoin;
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

  private configureTextContext(
    context: CanvasRenderingContext2D,
    node: Readonly<VectorTextNode>,
  ): void {
    context.font = `900 ${node.fontSize}px ${node.fontFamily}`;
    context.textAlign = "center";
    context.textBaseline = "alphabetic";
    context.lineJoin = node.outlineJoin;
    context.lineCap = "butt";
    context.lineWidth = Math.max(
      0.0001,
      vectorTextOutlineCanvasLineWidth(node.outlineWidth),
    );
    context.miterLimit = VECTOR_TEXT_OUTLINE_MITER_LIMIT;
  }

  private drawText(
    context: CanvasRenderingContext2D,
    node: Readonly<VectorTextNode>,
    baseline: number,
    opacity: number,
  ): void {
    this.configureTextContext(context, node);
    context.globalAlpha = opacity;
    if (node.outlineWidth > 0) {
      context.strokeStyle = node.outlineColor;
      context.strokeText(node.text, 0, baseline);
    }
    context.fillStyle = node.color;
    context.fillText(node.text, 0, baseline);
  }

  private measureText(node: Readonly<VectorTextNode>): TextMetricsBox {
    const context = this.presentationContext;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    this.configureTextContext(context, node);
    const measurement = context.measureText(node.text);
    const ascent = Math.max(
      1,
      measurement.actualBoundingBoxAscent || node.fontSize * 0.78,
    );
    const descent = Math.max(
      1,
      measurement.actualBoundingBoxDescent || node.fontSize * 0.22,
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
    const snapshot = this.snapshot;
    const selectedNode = this.selectedTextNode();

    let gpuMemoryMiB = 0;
    let textureCount = 0;
    if (!snapshot) {
      this.host.clearVectorTextPresentation();
    } else {
      const activeRasterIndex = snapshot.items.findIndex(
        (item) => item.kind === "raster"
          && item.rasterLayerId === snapshot.activeRasterLayerId,
      );
      if (activeRasterIndex < 0) {
        throw new Error("Raster attivo assente dalla scena testo/raster.");
      }
      const groups: readonly {
        placement: VectorTextPlacement;
        items: typeof snapshot.items;
      }[] = [
        { placement: "below-active", items: snapshot.items.slice(0, activeRasterIndex) },
        { placement: "above-active", items: snapshot.items.slice(activeRasterIndex + 1) },
      ];

      for (const group of groups) {
        const nodes = group.items
          .filter((item) => item.kind === "text")
          .map((item) => item.textNode)
          .filter((node) => node.visible && node.opacity > 0 && node.text.length > 0);
        if (nodes.length === 0) {
          this.host.clearVectorTextPresentation(group.placement);
          continue;
        }

        const context = this.presentationContext;
        context.save();
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, view.canvasWidth, view.canvasHeight);
        this.setViewTransform(context, view);
        for (const node of nodes) {
          const metrics = this.measureText(node);
          context.save();
          context.translate(node.x, node.y);
          context.rotate(node.rotation);
          context.scale(node.scale, node.scale);
          this.drawText(context, node, metrics.baseline, node.opacity);
          context.restore();
        }
        context.restore();

        const stats = this.host.updateVectorTextPresentation(
          this.presentationCanvas,
          group.placement,
        );
        gpuMemoryMiB += stats.gpuMemoryMiB;
        textureCount += 1;
      }
    }

    this.liveGpuMemoryMiB = gpuMemoryMiB;
    this.viewportTextureCount = textureCount;
    if (selectedNode) {
      this.metrics = this.measureText(selectedNode);
      this.renderInteractionOverlay(view, selectedNode);
    } else {
      this.clearInteractionOverlay(view);
    }

    this.lastRenderMs = performance.now() - startedAt;
    this.renderSamples.push(this.lastRenderMs);
    if (this.renderSamples.length > FRAME_SAMPLE_LIMIT) {
      this.renderSamples.splice(0, this.renderSamples.length - FRAME_SAMPLE_LIMIT);
    }
    this.renderCount += 1;
    this.updateStatus(view, selectedNode);
  }

  private updateStatus(
    view: VectorTextViewState,
    node: Readonly<VectorTextNode> | null,
  ): void {
    const viewportCanvasLogicalMiB =
      view.canvasWidth * view.canvasHeight * 4 * 2 / MEBIBYTE_BYTES;
    const cacheLabel = `${this.viewportTextureCount} cache GPU viewport`;
    const timing = `render ${this.lastRenderMs.toFixed(2)} ms `
      + `(p95 ${percentile(this.renderSamples, 0.95).toFixed(2)} ms)`;
    if (!node) {
      this.status.textContent =
        `Raster selezionato · testi semantici nel canvas di viewport · ${cacheLabel} `
        + `${this.liveGpuMemoryMiB.toFixed(2)} MiB · 2 canvas browser `
        + `${viewportCanvasLogicalMiB.toFixed(2)} MiB · ${timing}.`;
      return;
    }

    const snapshot = this.snapshot!;
    const textIndex = snapshot.items.findIndex((item) => item.key === `text:${node.id}`);
    const rasterIndex = snapshot.items.findIndex(
      (item) => item.kind === "raster"
        && item.rasterLayerId === snapshot.activeRasterLayerId,
    );
    const placement = textIndex < rasterIndex
      ? "sotto il raster attivo"
      : "sopra il raster attivo";
    const outline = node.outlineWidth > 0
      ? `traccia ${Math.round(node.outlineWidth)} px ${OUTLINE_JOIN_LABELS[node.outlineJoin]}`
      : "traccia off";
    this.status.textContent =
      `${node.name} · oggetto testo ${placement} · ${cacheLabel} `
      + `${this.liveGpuMemoryMiB.toFixed(2)} MiB · 2 canvas browser `
      + `${viewportCanvasLogicalMiB.toFixed(2)} MiB · ${outline} · ${timing}.`;
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

  private localToLayer(point: Point, node: Readonly<VectorTextNode>): Point {
    const scaledX = point.x * node.scale;
    const scaledY = point.y * node.scale;
    const cosine = Math.cos(node.rotation);
    const sine = Math.sin(node.rotation);
    return {
      x: node.x + cosine * scaledX - sine * scaledY,
      y: node.y + sine * scaledX + cosine * scaledY,
    };
  }

  private textCorners(
    view: VectorTextViewState,
    node: Readonly<VectorTextNode>,
  ): readonly Point[] {
    const localCorners: readonly Point[] = [
      { x: this.metrics.left, y: this.metrics.top },
      { x: this.metrics.right, y: this.metrics.top },
      { x: this.metrics.right, y: this.metrics.bottom },
      { x: this.metrics.left, y: this.metrics.bottom },
    ];
    return localCorners.map(
      (point) => this.layerToCanvas(this.localToLayer(point, node), view),
    );
  }

  private rotationHandle(
    corners: readonly Point[],
    view: VectorTextViewState,
    node: Readonly<VectorTextNode>,
  ): Point {
    const topCenter = {
      x: (corners[0].x + corners[1].x) * 0.5,
      y: (corners[0].y + corners[1].y) * 0.5,
    };
    const center = this.layerToCanvas({ x: node.x, y: node.y }, view);
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

  private clearInteractionOverlay(view: VectorTextViewState): void {
    const context = this.interactionContext;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, view.canvasWidth, view.canvasHeight);
    context.restore();
  }

  private renderInteractionOverlay(
    view: VectorTextViewState,
    node: Readonly<VectorTextNode>,
  ): void {
    this.clearInteractionOverlay(view);
    const context = this.interactionContext;
    const corners = this.textCorners(view, node);
    const rotationHandle = this.rotationHandle(corners, view, node);
    const topCenter = {
      x: (corners[0].x + corners[1].x) * 0.5,
      y: (corners[0].y + corners[1].y) * 0.5,
    };
    const backingPerCssPixel = view.canvasWidth / Math.max(1, view.cssWidth);
    const lineWidth = Math.max(1, 1.25 * backingPerCssPixel);
    const handleRadius = HANDLE_RADIUS_CSS_PX * backingPerCssPixel;

    context.save();
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
    node: Readonly<VectorTextNode>,
  ): TransformHandle | "rotate" | null {
    const backingPerCssPixel = view.canvasWidth / Math.max(1, view.cssWidth);
    const hitRadius = HANDLE_HIT_RADIUS_CSS_PX * backingPerCssPixel;
    const rotationHandle = this.rotationHandle(corners, view, node);
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
    const node = this.selectedTextNode();
    if (!node || this.activeInteraction) {
      return;
    }
    const view = this.host.getVectorTextViewState();
    const canvasPoint = this.eventCanvasPoint(event);
    const layerPoint = this.eventLayerPoint(event);
    const corners = this.textCorners(view, node);
    const handle = this.hitHandle(canvasPoint, corners, view, node);
    const shouldPan = event.shiftKey || event.button === 1 || event.button === 2;
    const mode: InteractionMode | null = shouldPan
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
    const center = { x: node.x, y: node.y };
    this.activeInteraction = {
      pointerId: event.pointerId,
      mode,
      startClient: { x: event.clientX, y: event.clientY },
      startLayer: layerPoint,
      startModel: copyNode(node),
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
      this.updateSelectedNode({
        x: interaction.startModel.x + layerPoint.x - interaction.startLayer.x,
        y: interaction.startModel.y + layerPoint.y - interaction.startLayer.y,
      });
    } else if (interaction.mode === "scale") {
      const distance = pointDistance(layerPoint, {
        x: interaction.startModel.x,
        y: interaction.startModel.y,
      });
      this.updateSelectedNode({
        scale: Math.min(
          MAXIMUM_SCALE,
          Math.max(
            MINIMUM_SCALE,
            interaction.startModel.scale * distance / interaction.startDistance,
          ),
        ),
      });
    } else if (interaction.mode === "rotate") {
      const angle = Math.atan2(
        layerPoint.y - interaction.startModel.y,
        layerPoint.x - interaction.startModel.x,
      );
      this.updateSelectedNode({
        rotation: interaction.startModel.rotation + angle - interaction.startAngle,
      });
    }
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
