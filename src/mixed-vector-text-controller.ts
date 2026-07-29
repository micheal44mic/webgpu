import type {
  MixedSceneSnapshot,
  PointerSample,
} from "./brush-engine";
import {
  MIXED_SCENE_STACK_STRATEGY,
  VECTOR_TEXT_BLOCK_SHADOW_STRATEGY,
  VECTOR_TEXT_OUTLINE_STRATEGY,
  VECTOR_TEXT_SINGLE_SHADOW_STRATEGY,
  vectorTextBlockShadowLocalVector,
  vectorTextSingleShadowLocalVector,
  type MixedSceneItem,
  type VectorTextNode,
  type VectorTextNodeSeed,
  type VectorTextOutlineJoin,
} from "./mixed-scene-stack";

import {
  VECTOR_TEXT_PRESENTATION_STRATEGY,
} from "./vector-text-shader";
import type {
  VectorTextGpuDraw,
  VectorTextGpuPresentationStats,
  VectorTextPlacement,
  VectorTextViewState,
} from "./vector-text-prototype";
import {
  VectorTextFontGeometryRegistry,
  type VectorTextOutlineGeometry,
} from "./vector-text-font-geometry";
import {
  VECTOR_TEXT_GPU_GEOMETRY_STRATEGY,
  type VectorTextGpuMeshData,
} from "./vector-text-effect-geometry";
import { VectorTextEffectCompilerClient } from "./vector-text-effect-client";
import {
  buildVectorTextSlugData,
  vectorTextPathRevision,
  type VectorTextSlugData,
} from "./vector-text-slug";
import {
  vectorTextLodForSigma,
} from "./vector-text-lod";
import {
  VECTOR_TEXT_SLUG_GPU_RENDER_STRATEGY,
} from "./vector-text-slug-gpu-shader";
import {
  VECTOR_TEXT_SINGLE_SHADOW_BLUR_STRATEGY,
  planVectorTextSingleShadowBlur,
} from "./vector-text-single-shadow";
import { VECTOR_TEXT_ADAPTIVE_ZOOM_STRATEGY } from "./vector-text-adaptive-zoom";




export interface MixedVectorTextHost {
  readonly layerSize: number;
  getVectorTextViewState(): VectorTextViewState;
  getMixedSceneSnapshot(): MixedSceneSnapshot | null;
  toLayerPoint(sample: PointerSample): { x: number; y: number };
  updateVectorTextGpuPresentation(
    placement: VectorTextPlacement,
    draws: readonly VectorTextGpuDraw[],
  ): VectorTextGpuPresentationStats;
  isPaintStrokeActive(): boolean;
  clearVectorTextPresentation(placement?: VectorTextPlacement): void;
  pruneVectorTextGpuMeshes(activeMeshKeys: ReadonlySet<string>): void;
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
  blockShadowStrategy: typeof VECTOR_TEXT_BLOCK_SHADOW_STRATEGY;
  singleShadowStrategy: typeof VECTOR_TEXT_SINGLE_SHADOW_STRATEGY;
  singleShadowBlurStrategy: typeof VECTOR_TEXT_SINGLE_SHADOW_BLUR_STRATEGY;
  adaptiveZoomStrategy: typeof VECTOR_TEXT_ADAPTIVE_ZOOM_STRATEGY;
  adaptiveZoomEnabled: boolean;
  zoomRenderMode: "precise";
  zoomFastModeArmed: boolean;
  zoomSlowFrameStreak: number;
  zoomFastActivationCount: number;
  zoomExactRecoveryCount: number;
  lastViewRenderEndToEndMs: number;
  lastAdaptiveZoomTriggerRenderMs: number;
  lastAdaptiveZoomTriggerEndToEndMs: number;
  selectedKey: MixedSceneItem["key"] | null;
  textNodeCount: number;
  renderCount: number;
  lastRenderMs: number;
  renderP95Ms: number;
  liveGpuMemoryMiB: number;
  viewportTextureCount: number;
  viewportCanvasLogicalMiB: number;
  vectorFontLogicalMiB: number;
  blockShadowPathLogicalMiB: number;
  singleShadowBrowserLogicalMiB: number;
  singleShadowCacheLogicalMiB: number;
  singleShadowScratchLogicalMiB: number;
  singleShadowGpuLogicalMiB: number;
  singleShadowCacheEntries: number;
  gpuGeometryStrategy: typeof VECTOR_TEXT_GPU_GEOMETRY_STRATEGY;
  gpuRenderStrategy: typeof VECTOR_TEXT_SLUG_GPU_RENDER_STRATEGY;
  effectWorkerPendingJobs: number;
  effectWorkerFailedJobs: number;
  effectWorkerLastError: string | null;
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

interface CachedTextGeometry {
  outlineKey: string;
  outline: VectorTextOutlineGeometry;
  sourceRevision: string;
  slug: VectorTextSlugData;
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

function srgbChannelToLinear(value: number): number {
  const normalized = Math.min(1, Math.max(0, value));
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function gpuLinearColor(color: string): readonly [number, number, number] {
  const normalized = /^#[0-9a-f]{6}$/i.test(color) ? color.slice(1) : "000000";
  return [
    srgbChannelToLinear(Number.parseInt(normalized.slice(0, 2), 16) / 255),
    srgbChannelToLinear(Number.parseInt(normalized.slice(2, 4), 16) / 255),
    srgbChannelToLinear(Number.parseInt(normalized.slice(4, 6), 16) / 255),
  ];
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
  private readonly blockShadowEnabledInput = requiredElement<HTMLInputElement>(
    "vectorTextBlockShadowEnabled",
  );
  private readonly blockShadowParameters = requiredElement<HTMLElement>(
    "vectorTextBlockShadowParameters",
  );
  private readonly blockShadowColorInput = requiredElement<HTMLInputElement>(
    "vectorTextBlockShadowColor",
  );
  private readonly blockShadowOpacityInput = requiredElement<HTMLInputElement>(
    "vectorTextBlockShadowOpacity",
  );
  private readonly blockShadowOpacityOutput = requiredElement<HTMLOutputElement>(
    "vectorTextBlockShadowOpacityOut",
  );
  private readonly blockShadowOffsetInput = requiredElement<HTMLInputElement>(
    "vectorTextBlockShadowOffset",
  );
  private readonly blockShadowOffsetOutput = requiredElement<HTMLOutputElement>(
    "vectorTextBlockShadowOffsetOut",
  );
  private readonly blockShadowAngleInput = requiredElement<HTMLInputElement>(
    "vectorTextBlockShadowAngle",
  );
  private readonly blockShadowAngleOutput = requiredElement<HTMLOutputElement>(
    "vectorTextBlockShadowAngleOut",
  );
  private readonly blockShadowOutlineWidthInput = requiredElement<HTMLInputElement>(
    "vectorTextBlockShadowOutlineWidth",
  );
  private readonly blockShadowOutlineWidthOutput = requiredElement<HTMLOutputElement>(
    "vectorTextBlockShadowOutlineWidthOut",
  );
  private readonly singleShadowEnabledInput = requiredElement<HTMLInputElement>(
    "vectorTextSingleShadowEnabled",
  );
  private readonly singleShadowParameters = requiredElement<HTMLElement>(
    "vectorTextSingleShadowParameters",
  );
  private readonly singleShadowColorInput = requiredElement<HTMLInputElement>(
    "vectorTextSingleShadowColor",
  );
  private readonly singleShadowOpacityInput = requiredElement<HTMLInputElement>(
    "vectorTextSingleShadowOpacity",
  );
  private readonly singleShadowOpacityOutput = requiredElement<HTMLOutputElement>(
    "vectorTextSingleShadowOpacityOut",
  );
  private readonly singleShadowOffsetInput = requiredElement<HTMLInputElement>(
    "vectorTextSingleShadowOffset",
  );
  private readonly singleShadowOffsetOutput = requiredElement<HTMLOutputElement>(
    "vectorTextSingleShadowOffsetOut",
  );
  private readonly singleShadowAngleInput = requiredElement<HTMLInputElement>(
    "vectorTextSingleShadowAngle",
  );
  private readonly singleShadowAngleOutput = requiredElement<HTMLOutputElement>(
    "vectorTextSingleShadowAngleOut",
  );
  private readonly singleShadowBlurInput = requiredElement<HTMLInputElement>(
    "vectorTextSingleShadowBlur",
  );
  private readonly singleShadowBlurOutput = requiredElement<HTMLOutputElement>(
    "vectorTextSingleShadowBlurOut",
  );
  private readonly singleShadowOutlineWidthInput = requiredElement<HTMLInputElement>(
    "vectorTextSingleShadowOutlineWidth",
  );
  private readonly singleShadowOutlineWidthOutput = requiredElement<HTMLOutputElement>(
    "vectorTextSingleShadowOutlineWidthOut",
  );
  private readonly addButton = requiredElement<HTMLButtonElement>("addVectorText");
  private readonly deleteButton = requiredElement<HTMLButtonElement>("deleteVectorText");
  private readonly moveUpButton = requiredElement<HTMLButtonElement>("moveVectorTextUp");
  private readonly moveDownButton = requiredElement<HTMLButtonElement>("moveVectorTextDown");
  private readonly resetButton = requiredElement<HTMLButtonElement>("vectorTextReset");
  private readonly status = requiredElement<HTMLElement>("vectorTextStatus");
  private readonly zoomModeIndicator = requiredElement<HTMLElement>("vectorTextZoomMode");

  private readonly interactionContext: CanvasRenderingContext2D;
  private readonly fontGeometry = new VectorTextFontGeometryRegistry();
  private readonly geometryByNodeId = new Map<number, CachedTextGeometry>();
  private readonly effectCompiler: VectorTextEffectCompilerClient;
  private effectReadyIdleTimer: number | null = null;
  private effectReadyRenderPending = false;

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
  private singleShadowGpuMemoryMiB = 0;
  private singleShadowGpuCacheEntries = 0;
  private viewportTextureCount = 0;
  private renderedTextRunKeys = new Set<VectorTextPlacement>();
  private sceneOperationBusy = false;
  private pendingViewRender = false;
  private pendingViewRenderStartedAt = 0;
  private lastViewRenderEndToEndMs = 0;

  constructor(private readonly host: MixedVectorTextHost) {
    const interactionContext = this.interactionCanvas.getContext("2d", {
      alpha: true,
      desynchronized: true,
    });
    if (!interactionContext) {
      throw new Error("Canvas2D non disponibile per l'overlay di interazione testo.");
    }
    this.interactionContext = interactionContext;
    this.effectCompiler = new VectorTextEffectCompilerClient(() => {
      this.handleEffectResourceReady();
    });
  }

  async initialize(): Promise<void> {
    await this.fontGeometry.preload();
    this.section.hidden = false;
    this.presentationCanvas.width = 1;
    this.presentationCanvas.height = 1;
    this.presentationCanvas.hidden = true;
    this.zoomModeIndicator.hidden = false;
    this.updateAdaptiveZoomIndicator();
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
    const liveTextNodeIds = new Set(
      snapshot.items
        .filter((item) => item.kind === "text")
        .map((item) => item.textNode.id),
    );
    for (const id of this.geometryByNodeId.keys()) {
      if (!liveTextNodeIds.has(id)) {
        this.geometryByNodeId.delete(id);
      }
    }

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
    if (!this.snapshot?.items.some((item) => item.kind === "text")) {
      return;
    }
    this.markPendingViewRender();
    this.scheduleRender();
  }

  setAdaptiveZoomEnabled(_enabled: boolean): void {
    this.updateAdaptiveZoomIndicator();
  }
  getDiagnostics(): MixedVectorTextDiagnostics {
    const view = this.host.getVectorTextViewState();
    const effectDiagnostics = this.effectCompiler.diagnostics();
    return {
      sceneStrategy: MIXED_SCENE_STACK_STRATEGY,
      livePresentationStrategy: VECTOR_TEXT_PRESENTATION_STRATEGY,
      outlineStrategy: VECTOR_TEXT_OUTLINE_STRATEGY,
      blockShadowStrategy: VECTOR_TEXT_BLOCK_SHADOW_STRATEGY,
      singleShadowStrategy: VECTOR_TEXT_SINGLE_SHADOW_STRATEGY,
      singleShadowBlurStrategy: VECTOR_TEXT_SINGLE_SHADOW_BLUR_STRATEGY,
      adaptiveZoomStrategy: VECTOR_TEXT_ADAPTIVE_ZOOM_STRATEGY,
      adaptiveZoomEnabled: false,
      zoomRenderMode: "precise",
      zoomFastModeArmed: false,
      zoomSlowFrameStreak: 0,
      zoomFastActivationCount: 0,
      zoomExactRecoveryCount: 0,
      lastViewRenderEndToEndMs: this.lastViewRenderEndToEndMs,
      lastAdaptiveZoomTriggerRenderMs: 0,
      lastAdaptiveZoomTriggerEndToEndMs: 0,
      selectedKey: this.snapshot?.selectedKey ?? null,
      textNodeCount: this.snapshot?.items.filter((item) => item.kind === "text").length ?? 0,
      renderCount: this.renderCount,
      lastRenderMs: this.lastRenderMs,
      renderP95Ms: percentile(this.renderSamples, 0.95),
      liveGpuMemoryMiB: this.liveGpuMemoryMiB,
      viewportTextureCount: this.viewportTextureCount,
      viewportCanvasLogicalMiB:
        view.canvasWidth * view.canvasHeight * 4 / MEBIBYTE_BYTES,
      vectorFontLogicalMiB: this.fontGeometry.logicalFontBytes / MEBIBYTE_BYTES,
      blockShadowPathLogicalMiB: this.blockShadowPathLogicalMiB(),
      singleShadowBrowserLogicalMiB: 0,
      singleShadowCacheLogicalMiB: 0,
      singleShadowScratchLogicalMiB: 0,
      singleShadowGpuLogicalMiB: this.singleShadowGpuMemoryMiB,
      singleShadowCacheEntries: this.singleShadowGpuCacheEntries,
      gpuGeometryStrategy: VECTOR_TEXT_GPU_GEOMETRY_STRATEGY,
      gpuRenderStrategy: VECTOR_TEXT_SLUG_GPU_RENDER_STRATEGY,
      effectWorkerPendingJobs: effectDiagnostics.pendingJobs,
      effectWorkerFailedJobs: effectDiagnostics.failedJobs,
      effectWorkerLastError: effectDiagnostics.lastError,
    };
  }

  private defaultSeed(index: number): VectorTextNodeSeed {
    return {
      text: index === 0 ? "STREETWEAR" : `TESTO ${index + 1}`,
      fontFamily: "Anton",
      fontSize: 360,
      color: index === 0 ? "#111111" : "#f47c5d",
      outlineWidth: 0,
      outlineColor: "#111111",
      outlineJoin: "round",
      blockShadowEnabled: index === 0,
      blockShadowColor: "#727272",
      blockShadowOpacity: 1,
      blockShadowOffset: 23,
      blockShadowAngle: -104,
      blockShadowOutlineWidth: 0,
      singleShadowEnabled: false,
      singleShadowColor: "#727272",
      singleShadowOpacity: 1,
      singleShadowOffset: 54,
      singleShadowAngle: -180,
      singleShadowBlur: 6,
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
    this.blockShadowEnabledInput.addEventListener("change", () => {
      const enabled = this.blockShadowEnabledInput.checked;
      this.blockShadowParameters.hidden = !enabled;
      this.updateSelectedNode(enabled
        ? { blockShadowEnabled: true, singleShadowEnabled: false }
        : { blockShadowEnabled: false });
    });
    this.blockShadowColorInput.addEventListener("input", () => {
      this.updateSelectedNode({ blockShadowColor: this.blockShadowColorInput.value });
    });
    this.blockShadowOpacityInput.addEventListener("input", () => {
      const opacityPercent = Number(this.blockShadowOpacityInput.value);
      this.blockShadowOpacityOutput.value = `${Math.round(opacityPercent)}%`;
      this.updateSelectedNode({ blockShadowOpacity: opacityPercent / 100 });
    });
    this.blockShadowOffsetInput.addEventListener("input", () => {
      const offset = Number(this.blockShadowOffsetInput.value);
      this.blockShadowOffsetOutput.value = String(Math.round(offset));
      this.updateSelectedNode({ blockShadowOffset: offset });
    });
    this.blockShadowAngleInput.addEventListener("input", () => {
      const angle = Number(this.blockShadowAngleInput.value);
      this.blockShadowAngleOutput.value = `${Math.round(angle)}°`;
      this.updateSelectedNode({ blockShadowAngle: angle });
    });
    this.blockShadowOutlineWidthInput.addEventListener("input", () => {
      const outlineWidth = Number(this.blockShadowOutlineWidthInput.value);
      this.blockShadowOutlineWidthOutput.value = `${Math.round(outlineWidth)} px`;
      this.updateSelectedNode({ blockShadowOutlineWidth: outlineWidth });
    });
    this.singleShadowEnabledInput.addEventListener("change", () => {
      const enabled = this.singleShadowEnabledInput.checked;
      this.singleShadowParameters.hidden = !enabled;
      this.updateSelectedNode(enabled
        ? { singleShadowEnabled: true, blockShadowEnabled: false }
        : { singleShadowEnabled: false });
    });
    this.singleShadowColorInput.addEventListener("input", () => {
      this.updateSelectedNode({ singleShadowColor: this.singleShadowColorInput.value });
    });
    this.singleShadowOpacityInput.addEventListener("input", () => {
      const opacityPercent = Number(this.singleShadowOpacityInput.value);
      this.singleShadowOpacityOutput.value = `${Math.round(opacityPercent)}%`;
      this.updateSelectedNode({ singleShadowOpacity: opacityPercent / 100 });
    });
    this.singleShadowOffsetInput.addEventListener("input", () => {
      const offset = Number(this.singleShadowOffsetInput.value);
      this.singleShadowOffsetOutput.value = String(Math.round(offset));
      this.updateSelectedNode({ singleShadowOffset: offset });
    });
    this.singleShadowAngleInput.addEventListener("input", () => {
      const angle = Number(this.singleShadowAngleInput.value);
      this.singleShadowAngleOutput.value = `${Math.round(angle)}°`;
      this.updateSelectedNode({ singleShadowAngle: angle });
    });
    this.singleShadowBlurInput.addEventListener("input", () => {
      const blur = Number(this.singleShadowBlurInput.value);
      this.singleShadowBlurOutput.value = String(Math.round(blur));
      this.updateSelectedNode({ singleShadowBlur: blur });
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
    this.blockShadowEnabledInput.disabled = disabled;
    this.blockShadowColorInput.disabled = disabled;
    this.blockShadowOpacityInput.disabled = disabled;
    this.blockShadowOffsetInput.disabled = disabled;
    this.blockShadowAngleInput.disabled = disabled;
    this.blockShadowOutlineWidthInput.disabled = disabled;
    this.singleShadowEnabledInput.disabled = disabled;
    this.singleShadowColorInput.disabled = disabled;
    this.singleShadowOpacityInput.disabled = disabled;
    this.singleShadowOffsetInput.disabled = disabled;
    this.singleShadowAngleInput.disabled = disabled;
    this.singleShadowBlurInput.disabled = disabled;
    this.singleShadowOutlineWidthInput.disabled = true;
    this.resetButton.disabled = disabled;
    this.deleteButton.disabled = disabled;
    this.moveUpButton.disabled = disabled;
    this.moveDownButton.disabled = disabled;
    this.addButton.disabled = this.sceneOperationBusy;
    if (!node) {
      this.blockShadowParameters.hidden = true;
      this.singleShadowParameters.hidden = true;
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
    this.blockShadowEnabledInput.checked = node.blockShadowEnabled;
    this.blockShadowParameters.hidden = !node.blockShadowEnabled;
    this.blockShadowColorInput.value = node.blockShadowColor;
    this.blockShadowOpacityInput.value = String(node.blockShadowOpacity * 100);
    this.blockShadowOpacityOutput.value = `${Math.round(node.blockShadowOpacity * 100)}%`;
    this.blockShadowOffsetInput.value = String(node.blockShadowOffset);
    this.blockShadowOffsetOutput.value = String(Math.round(node.blockShadowOffset));
    this.blockShadowAngleInput.value = String(node.blockShadowAngle);
    this.blockShadowAngleOutput.value = `${Math.round(node.blockShadowAngle)}°`;
    this.blockShadowOutlineWidthInput.value = String(node.blockShadowOutlineWidth);
    this.blockShadowOutlineWidthOutput.value =
      `${Math.round(node.blockShadowOutlineWidth)} px`;
    this.singleShadowEnabledInput.checked = node.singleShadowEnabled;
    this.singleShadowParameters.hidden = !node.singleShadowEnabled;
    this.singleShadowColorInput.value = node.singleShadowColor;
    this.singleShadowOpacityInput.value = String(node.singleShadowOpacity * 100);
    this.singleShadowOpacityOutput.value =
      `${Math.round(node.singleShadowOpacity * 100)}%`;
    this.singleShadowOffsetInput.value = String(node.singleShadowOffset);
    this.singleShadowOffsetOutput.value = String(Math.round(node.singleShadowOffset));
    this.singleShadowAngleInput.value = String(node.singleShadowAngle);
    this.singleShadowAngleOutput.value = `${Math.round(node.singleShadowAngle)}°`;
    this.singleShadowBlurInput.value = String(node.singleShadowBlur);
    this.singleShadowBlurOutput.value = String(Math.round(node.singleShadowBlur));
    this.singleShadowOutlineWidthInput.value = "0";
    this.singleShadowOutlineWidthOutput.value = "0 px";
  }

  private handleEffectResourceReady(): void {
    if (this.host.isPaintStrokeActive()) {
      this.effectReadyRenderPending = true;
      this.armEffectReadyIdleCheck();
      return;
    }
    this.effectReadyRenderPending = false;
    this.scheduleRender();
  }

  private armEffectReadyIdleCheck(): void {
    if (this.effectReadyIdleTimer !== null) {
      return;
    }
    this.effectReadyIdleTimer = window.setTimeout(() => {
      this.effectReadyIdleTimer = null;
      if (!this.effectReadyRenderPending) {
        return;
      }
      if (this.host.isPaintStrokeActive()) {
        this.armEffectReadyIdleCheck();
      } else {
        this.effectReadyRenderPending = false;
        this.scheduleRender();
      }
    }, 32);
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

  private markPendingViewRender(): void {
    if (!this.pendingViewRender) {
      this.pendingViewRenderStartedAt = performance.now();
    }
    this.pendingViewRender = true;
  }

  private updateAdaptiveZoomIndicator(): void {
    this.zoomModeIndicator.dataset.mode = "precise";
    this.zoomModeIndicator.dataset.enabled = "false";
    this.zoomModeIndicator.dataset.activations = "0";
    this.zoomModeIndicator.dataset.triggerMs = "0.00";
    this.zoomModeIndicator.textContent = "Zoom testo · vettoriale GPU";
    this.zoomModeIndicator.title =
      "I contorni OpenType restano Slug/mesh WebGPU durante ogni zoom; nessuna cache bitmap viene ingrandita.";
  }
  private syncCanvasSizes(view: VectorTextViewState): void {
    if (
      this.interactionCanvas.width !== view.canvasWidth
      || this.interactionCanvas.height !== view.canvasHeight
    ) {
      this.interactionCanvas.width = view.canvasWidth;
      this.interactionCanvas.height = view.canvasHeight;
    }
  }

  private geometryForNode(
    node: Readonly<VectorTextNode>,
  ): CachedTextGeometry {
    const outlineKey = `${node.fontFamily}\u0000${node.fontSize}\u0000${node.text}`;
    const cached = this.geometryByNodeId.get(node.id);
    if (cached?.outlineKey === outlineKey) {
      return cached;
    }
    const outline = this.fontGeometry.outline(
      node.fontFamily,
      node.text,
      node.fontSize,
    );
    const sourceRevision = vectorTextPathRevision(outline.pathData);
    const created: CachedTextGeometry = {
      outlineKey,
      outline,
      sourceRevision,
      slug: buildVectorTextSlugData(outline.pathData, sourceRevision),
    };
    this.geometryByNodeId.set(node.id, created);
    return created;
  }

  private effectLodForNode(
    node: Readonly<VectorTextNode>,
    view: VectorTextViewState,
  ) {
    return vectorTextLodForSigma(Math.abs(node.scale * view.zoom));
  }

  private effectMeshForNode(
    node: Readonly<VectorTextNode>,
    geometry: CachedTextGeometry,
    view: VectorTextViewState,
    slotName: string,
    effect: Parameters<VectorTextEffectCompilerClient["meshForSlot"]>[4],
    liveSlots: Set<string>,
  ): VectorTextGpuMeshData | null {
    const slotKey = `text:${node.id}:${slotName}`;
    liveSlots.add(slotKey);
    return this.effectCompiler.meshForSlot(
      slotKey,
      geometry.sourceRevision,
      geometry.outline.pathData,
      this.effectLodForNode(node, view),
      effect,
      !this.host.isPaintStrokeActive(),
    );
  }

  private slugDraw(
    node: Readonly<VectorTextNode>,
    meshKey: string,
    slug: VectorTextSlugData,
    color: string,
    opacity: number,
    localOffsetX = 0,
    localOffsetY = 0,
  ): VectorTextGpuDraw {
    return {
      mode: "slug-direct",
      meshKey,
      slug,
      x: node.x,
      y: node.y,
      scale: node.scale,
      rotation: node.rotation,
      localOffsetX: slug.originX + localOffsetX,
      localOffsetY: slug.originY + localOffsetY,
      color: gpuLinearColor(color),
      opacity: Math.min(1, Math.max(0, opacity)),
    };
  }

  private meshDraw(
    node: Readonly<VectorTextNode>,
    meshKey: string,
    mesh: VectorTextGpuMeshData,
    color: string,
    opacity: number,
  ): VectorTextGpuDraw {
    return {
      mode: "mesh-direct",
      meshKey,
      mesh,
      x: node.x,
      y: node.y,
      scale: node.scale,
      rotation: node.rotation,
      localOffsetX: mesh.originX,
      localOffsetY: mesh.originY,
      color: gpuLinearColor(color),
      opacity: Math.min(1, Math.max(0, opacity)),
    };
  }

  private slugBlurDraw(
    node: Readonly<VectorTextNode>,
    geometry: CachedTextGeometry,
    view: VectorTextViewState,
  ): VectorTextGpuDraw {
    const requestedPixelScale = Math.max(
      1 / 32,
      Math.abs(view.zoom * node.scale),
    );
    const bucketScale = 2 ** Math.ceil(Math.log2(requestedPixelScale));
    const plan = planVectorTextSingleShadowBlur(
      {
        left: geometry.outline.inkLeft,
        top: geometry.outline.inkTop,
        right: geometry.outline.inkRight,
        bottom: geometry.outline.inkBottom,
      },
      node.singleShadowBlur,
      bucketScale,
    );
    const vector = vectorTextSingleShadowLocalVector(
      node.singleShadowOffset,
      node.singleShadowAngle,
    );
    const blurKey = [
      "vector-text-gpu-blur-v1",
      node.id,
      geometry.sourceRevision,
      node.singleShadowBlur.toFixed(4),
      plan.width,
      plan.height,
      plan.scale.toFixed(8),
      plan.sigmaPixels.toFixed(8),
      plan.radius,
    ].join(":");
    return {
      mode: "slug-blur",
      meshKey: `text:${node.id}:slug`,
      slug: geometry.slug,
      blurKey,
      blurBounds: [
        plan.bounds[0],
        plan.bounds[1],
        plan.bounds[2],
        plan.bounds[3],
      ],
      blurWidth: plan.width,
      blurHeight: plan.height,
      blurScale: plan.scale,
      blurSigmaPixels: plan.sigmaPixels,
      blurRadius: plan.radius,
      x: node.x,
      y: node.y,
      scale: node.scale,
      rotation: node.rotation,
      localOffsetX: vector.x,
      localOffsetY: vector.y,
      color: gpuLinearColor(node.singleShadowColor),
      opacity: Math.min(
        1,
        Math.max(0, node.opacity * node.singleShadowOpacity),
      ),
    };
  }
  private appendGpuDrawsForNode(
    draws: VectorTextGpuDraw[],
    node: Readonly<VectorTextNode>,
    geometry: CachedTextGeometry,
    view: VectorTextViewState,
    liveSlots: Set<string>,
  ): void {
    if (node.singleShadowEnabled && node.singleShadowOpacity > 0) {
      if (node.singleShadowBlur > 0) {
        draws.push(this.slugBlurDraw(node, geometry, view));
      } else {
        const vector = vectorTextSingleShadowLocalVector(
          node.singleShadowOffset,
          node.singleShadowAngle,
        );
        draws.push(this.slugDraw(
          node,
          `text:${node.id}:slug`,
          geometry.slug,
          node.singleShadowColor,
          node.opacity * node.singleShadowOpacity,
          vector.x,
          vector.y,
        ));
      }
    }

    if (node.blockShadowEnabled && node.blockShadowOpacity > 0) {
      const vector = vectorTextBlockShadowLocalVector(
        node.fontSize,
        node.blockShadowOffset,
        node.blockShadowAngle,
      );
      if (node.blockShadowOutlineWidth > 0) {
        const mesh = this.effectMeshForNode(
          node,
          geometry,
          view,
          "block-outline",
          {
            kind: "block-outline",
            vectorX: vector.x,
            vectorY: vector.y,
            width: node.blockShadowOutlineWidth,
            join: node.outlineJoin,
          },
          liveSlots,
        );
        if (mesh) {
          draws.push(this.meshDraw(
            node,
            `text:${node.id}:block-outline`,
            mesh,
            node.blockShadowColor,
            node.opacity * node.blockShadowOpacity,
          ));
        }
      }
      if (Math.hypot(vector.x, vector.y) <= Number.EPSILON) {
        draws.push(this.slugDraw(
          node,
          `text:${node.id}:slug`,
          geometry.slug,
          node.blockShadowColor,
          node.opacity * node.blockShadowOpacity,
        ));
      } else {
        const mesh = this.effectMeshForNode(
          node,
          geometry,
          view,
          "block",
          {
            kind: "block",
            vectorX: vector.x,
            vectorY: vector.y,
          },
          liveSlots,
        );
        if (mesh) {
          draws.push(this.meshDraw(
            node,
            `text:${node.id}:block`,
            mesh,
            node.blockShadowColor,
            node.opacity * node.blockShadowOpacity,
          ));
        }
      }
    }

    if (node.outlineWidth > 0) {
      const mesh = this.effectMeshForNode(
        node,
        geometry,
        view,
        "outline",
        {
          kind: "source-outline",
          width: node.outlineWidth,
          join: node.outlineJoin,
        },
        liveSlots,
      );
      if (mesh) {
        draws.push(this.meshDraw(
          node,
          `text:${node.id}:outline`,
          mesh,
          node.outlineColor,
          node.opacity,
        ));
      }
    }
    draws.push(this.slugDraw(
      node,
      `text:${node.id}:slug`,
      geometry.slug,
      node.color,
      node.opacity,
    ));
  }

  private blockShadowPathLogicalMiB(): number {
    return 0;
  }
  private measureText(node: Readonly<VectorTextNode>): TextMetricsBox {
    const outline = this.geometryForNode(node).outline;
    return {
      left: outline.left,
      top: outline.top,
      right: outline.right,
      bottom: outline.bottom,
      baseline: outline.baseline,
    };
  }

  private renderNow(): void {
    const wasViewRender = this.pendingViewRender;
    const viewRenderStartedAt = this.pendingViewRenderStartedAt;
    this.pendingViewRender = false;
    this.pendingViewRenderStartedAt = 0;
    const startedAt = performance.now();
    const view = this.host.getVectorTextViewState();
    this.syncCanvasSizes(view);
    const snapshot = this.snapshot;
    const selectedNode = this.selectedTextNode();

    let gpuMemoryMiB = 0;
    let blurGpuMemoryMiB = 0;
    let blurGpuCacheEntries = 0;
    let textureCount = 0;
    const activeMeshKeys = new Set<string>();
    const liveEffectSlots = new Set<string>();
    if (!snapshot) {
      this.host.clearVectorTextPresentation();
      this.renderedTextRunKeys.clear();
    } else {
      const groups: {
        placement: VectorTextPlacement;
        nodes: Readonly<VectorTextNode>[];
      }[] = [];
      let pendingNodes: Readonly<VectorTextNode>[] = [];
      const flushTextRun = () => {
        if (pendingNodes.length === 0) {
          return;
        }
        const nodes = pendingNodes;
        pendingNodes = [];
        groups.push({
          placement: `text-run:${nodes.map((node) => node.id).join(",")}`,
          nodes,
        });
      };
      for (const item of snapshot.items) {
        if (item.kind === "text") {
          pendingNodes.push(item.textNode);
        } else {
          flushTextRun();
        }
      }
      flushTextRun();

      const nextRunKeys = new Set(groups.map((group) => group.placement));
      for (const previousKey of this.renderedTextRunKeys) {
        if (!nextRunKeys.has(previousKey)) {
          this.host.clearVectorTextPresentation(previousKey);
        }
      }
      this.renderedTextRunKeys = nextRunKeys;

      for (const group of groups) {
        const nodes = group.nodes.filter(
          (node) => node.visible && node.opacity > 0 && node.text.length > 0,
        );
        if (nodes.length === 0) {
          this.host.clearVectorTextPresentation(group.placement);
          continue;
        }

        const draws: VectorTextGpuDraw[] = [];
        for (const node of nodes) {
          const geometry = this.geometryForNode(node);
          this.appendGpuDrawsForNode(
            draws,
            node,
            geometry,
            view,
            liveEffectSlots,
          );
        }

        for (const draw of draws) {
          activeMeshKeys.add(draw.meshKey);
          if (draw.mode === "slug-blur") {
            activeMeshKeys.add(draw.blurKey);
          }
        }
        const stats = this.host.updateVectorTextGpuPresentation(
          group.placement,
          draws,
        );
        gpuMemoryMiB += stats.gpuMemoryMiB;
        blurGpuMemoryMiB = Math.max(
          blurGpuMemoryMiB,
          stats.blurGpuMemoryMiB,
        );
        blurGpuCacheEntries = Math.max(
          blurGpuCacheEntries,
          stats.blurCacheEntries,
        );
        textureCount += 1;
      }
    }
    this.effectCompiler.retainSlots(liveEffectSlots);
    this.host.pruneVectorTextGpuMeshes(activeMeshKeys);
    gpuMemoryMiB += blurGpuMemoryMiB;
    this.singleShadowGpuMemoryMiB = blurGpuMemoryMiB;
    this.singleShadowGpuCacheEntries = blurGpuCacheEntries;

    if (snapshot?.items.some((item) => item.kind === "text")) {
      // The exact heterogeneous order is accumulated once in a linear
      // RGBA16F viewport target before the checkerboard presentation pass.
      gpuMemoryMiB += view.canvasWidth * view.canvasHeight * 8 / MEBIBYTE_BYTES;
      textureCount += 1;
    }
    this.liveGpuMemoryMiB = gpuMemoryMiB;
    this.viewportTextureCount = textureCount;
    if (selectedNode) {
      this.metrics = this.measureText(selectedNode);
      this.renderInteractionOverlay(view, selectedNode);
    } else {
      this.clearInteractionOverlay(view);
    }

    const finishedAt = performance.now();
    this.lastRenderMs = finishedAt - startedAt;
    this.renderSamples.push(this.lastRenderMs);
    if (this.renderSamples.length > FRAME_SAMPLE_LIMIT) {
      this.renderSamples.splice(0, this.renderSamples.length - FRAME_SAMPLE_LIMIT);
    }
    this.renderCount += 1;
    if (wasViewRender) {
      this.lastViewRenderEndToEndMs = Math.max(
        this.lastRenderMs,
        finishedAt - (viewRenderStartedAt || startedAt),
      );
    }    this.updateAdaptiveZoomIndicator();
    this.updateStatus(view, selectedNode);
  }

  private updateStatus(
    view: VectorTextViewState,
    node: Readonly<VectorTextNode> | null,
  ): void {
    const viewportCanvasLogicalMiB =
      view.canvasWidth * view.canvasHeight * 4 / MEBIBYTE_BYTES;
    const vectorFontLogicalMiB = this.fontGeometry.logicalFontBytes / MEBIBYTE_BYTES;
    const effectDiagnostics = this.effectCompiler.diagnostics();
    const browserCanvasLogicalMiB = viewportCanvasLogicalMiB;
    const cacheLabel = `${this.viewportTextureCount} cache GPU viewport`;
    const timing = `render ${this.lastRenderMs.toFixed(2)} ms `
      + `(p95 ${percentile(this.renderSamples, 0.95).toFixed(2)} ms)`;
    const effectLabel = `Worker effetti ${effectDiagnostics.pendingJobs} in attesa · `
      + `${effectDiagnostics.readyJobs} pronti · ${effectDiagnostics.failedJobs} errori`
      + (effectDiagnostics.lastError ? ` · ${effectDiagnostics.lastError}` : "");
    if (!node) {
      this.status.textContent =
        `Raster selezionato · testi semantici nel canvas di viewport · ${cacheLabel} `
        + `${this.liveGpuMemoryMiB.toFixed(2)} MiB · canvas browser `
        + `${browserCanvasLogicalMiB.toFixed(2)} MiB · ${effectLabel} · ${timing}.`;
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
    const blockShadow = node.blockShadowEnabled
      ? `Block Shadow vettoriale ${Math.round(node.blockShadowOffset)} @ `
        + `${Math.round(node.blockShadowAngle)}° · mesh Worker + WebGPU`
      : "Block Shadow off";
    const singleShadow = node.singleShadowEnabled
      ? `Ombra singola ${Math.round(node.singleShadowOffset)} @ `
        + `${Math.round(node.singleShadowAngle)}° · blur `
        + `${Math.round(node.singleShadowBlur)} · `
        + (node.singleShadowBlur > 0
          ? `Gaussian WebGPU ${this.singleShadowGpuMemoryMiB.toFixed(2)} MiB `
            + `(${this.singleShadowGpuCacheEntries} matte + scratch GPU)`
          : "Slug vettoriale WebGPU, nessuna bitmap")
      : "Ombra singola off";
    this.status.textContent =
      `${node.name} · oggetto testo ${placement} · ${cacheLabel} `
      + `${this.liveGpuMemoryMiB.toFixed(2)} MiB · canvas browser `
      + `${browserCanvasLogicalMiB.toFixed(2)} MiB · font vettoriali `
      + `${vectorFontLogicalMiB.toFixed(2)} MiB · ${outline} · ${blockShadow} · `
      + `${singleShadow} · ${effectLabel} · ${timing}.`;
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
