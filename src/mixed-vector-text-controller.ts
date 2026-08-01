import type { MixedSceneSnapshot, PointerSample } from "./engine-types";
import {
  MIXED_SCENE_STACK_STRATEGY,
  VECTOR_TEXT_BLOCK_SHADOW_STRATEGY,
  VECTOR_TEXT_INNER_SHADOW_STRATEGY,
  VECTOR_TEXT_OUTLINE_STRATEGY,
  VECTOR_TEXT_SINGLE_SHADOW_STRATEGY,
  cloneVectorSvgNode,
  cloneVectorTextNode,
  vectorTextBlockShadowLocalVector,
  vectorTextInnerShadowLocalVector,
  vectorTextSingleShadowLocalVector,
  type MixedSceneItem,
  type RasterImageNode,
  type VectorSvgNode,
  type VectorSvgNodeSeed,
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
} from "./vector-text-types";
import {
  VectorTextFontGeometryRegistry,
  type VectorTextOutlineGeometry,
} from "./vector-text-font-geometry";
import {
  VECTOR_TEXT_GPU_GEOMETRY_STRATEGY,
  type VectorTextGpuMeshData,
} from "./vector-text-effect-geometry";
import {
  VectorTextEffectCompilerClient,
  type VectorTextEffectMeshResult,
} from "./vector-text-effect-client";
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
import {
  VECTOR_SVG_IMPORT_STRATEGY,
  parseVectorSvg,
} from "./vector-svg-import.ts";
import {
  VECTOR_TEXT_TRANSFORM_STRATEGY,
  defaultVectorTextDistortPoints,
  moveVectorTextDistortPoint,
  type VectorTextDistortPoints,
  type VectorTextTransformType,
} from "./vector-text-transform.ts";

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
  beginVectorHistoryEdit(scope?: "property" | "transform"): boolean;
  commitVectorHistoryEdit(): boolean;
  cancelVectorHistoryEdit(): Promise<boolean>;
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
  rasterizeVectorTextNode(
    id: number,
    draws: readonly VectorTextGpuDraw[],
  ): Promise<{ layerId: number; chunkCount: number; tileCount: number }>;
  addVectorSvgNode(
    seed: VectorSvgNodeSeed,
    name?: string,
  ): Promise<Readonly<VectorSvgNode>>;
  updateVectorSvgNode(
    id: number,
    update: Partial<Omit<VectorSvgNode, "id" | "document" | "visible" | "opacity">>,
  ): Readonly<VectorSvgNode>;
  moveVectorSvgNode(id: number, delta: -1 | 1): Promise<boolean>;
  deleteVectorSvgNode(id: number): Promise<Readonly<VectorSvgNode>>;
  rasterizeVectorSvgNode(
    id: number,
    draws: readonly VectorTextGpuDraw[],
  ): Promise<{ layerId: number; chunkCount: number; tileCount: number }>;
  importRasterImageFile(file: File): Promise<Readonly<RasterImageNode>>;
  updateRasterImageNode(
    id: number,
    update: Partial<Omit<RasterImageNode, "id" | "kind" | "document" | "visible" | "opacity">>,
  ): Readonly<RasterImageNode>;
  moveRasterImageNode(id: number, delta: -1 | 1): Promise<boolean>;
  deleteRasterImageNode(id: number): Promise<Readonly<RasterImageNode>>;
  zoomBy(factor: number, clientX?: number, clientY?: number): void;
  panByClientDelta(deltaClientX: number, deltaClientY: number): void;
  beginViewRotationGesture(): void;
  rotateViewBy(deltaRadians: number, clientX?: number, clientY?: number): void;
  endViewRotationGesture(): void;
}

export interface MixedVectorTextDiagnostics {
  sceneStrategy: typeof MIXED_SCENE_STACK_STRATEGY;
  livePresentationStrategy: typeof VECTOR_TEXT_PRESENTATION_STRATEGY;
  outlineStrategy: typeof VECTOR_TEXT_OUTLINE_STRATEGY;
  blockShadowStrategy: typeof VECTOR_TEXT_BLOCK_SHADOW_STRATEGY;
  singleShadowStrategy: typeof VECTOR_TEXT_SINGLE_SHADOW_STRATEGY;
  innerShadowStrategy: typeof VECTOR_TEXT_INNER_SHADOW_STRATEGY;
  singleShadowBlurStrategy: typeof VECTOR_TEXT_SINGLE_SHADOW_BLUR_STRATEGY;
  adaptiveZoomStrategy: typeof VECTOR_TEXT_ADAPTIVE_ZOOM_STRATEGY;
  transformStrategy: typeof VECTOR_TEXT_TRANSFORM_STRATEGY;
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
  atomicEffectHoldCount: number;
  atomicEffectPendingNodes: number;
}

interface Point {
  x: number;
  y: number;
}

type VectorDrawableNode = VectorTextNode | VectorSvgNode;
type VectorSceneNode = VectorDrawableNode | RasterImageNode;
type VectorSceneNodeUpdate =
  | Partial<Omit<VectorTextNode, "id" | "visible" | "opacity">>
  | Partial<Omit<VectorSvgNode, "id" | "document" | "visible" | "opacity">>
  | Partial<Omit<RasterImageNode, "id" | "kind" | "document" | "visible" | "opacity">>;

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
type InteractionMode = "move" | "scale" | "rotate" | "pan" | "distort";

interface ActiveInteraction {
  pointerId: number;
  mode: InteractionMode;
  startClient: Point;
  startLayer: Point;
  startModel: VectorSceneNode;
  startDistance: number;
  startAngle: number;
  distortPointIndex: number | null;
  openedTransformSession: boolean;
}

interface TouchNavigationGesture {
  centerX: number;
  centerY: number;
  distance: number;
  angle: number;
}

const MEBIBYTE_BYTES = 1024 * 1024;
const VECTOR_SVG_EXAMPLE_URL = new URL(
  "../assets/vector-svg-example.svg",
  import.meta.url,
).href;
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

function isTextNode(node: Readonly<VectorSceneNode>): node is Readonly<VectorTextNode> {
  return node.kind === "text";
}

function isSvgNode(node: Readonly<VectorSceneNode>): node is Readonly<VectorSvgNode> {
  return node.kind === "svg";
}

function isImageNode(node: Readonly<VectorSceneNode>): node is Readonly<RasterImageNode> {
  return node.kind === "image";
}

function vectorNodeKey(
  node: Readonly<VectorSceneNode>,
): `text:${number}` | `svg:${number}` | `image:${number}` {
  return node.kind === "text"
    ? `text:${node.id}`
    : node.kind === "svg"
      ? `svg:${node.id}`
      : `image:${node.id}`;
}

function copyNode(node: Readonly<VectorSceneNode>): VectorSceneNode {
  return isTextNode(node)
    ? cloneVectorTextNode(node)
    : isSvgNode(node)
      ? cloneVectorSvgNode(node)
      : { ...node, document: { ...node.document } };
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

function sameGpuLinearColor(first: string, second: string): boolean {
  const firstLinear = gpuLinearColor(first);
  const secondLinear = gpuLinearColor(second);
  return firstLinear[0] === secondLinear[0]
    && firstLinear[1] === secondLinear[1]
    && firstLinear[2] === secondLinear[2];
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
  private readonly textSpecificControls = requiredElement<HTMLElement>(
    "vectorTextSpecificControls",
  );
  private readonly textRasterizeButton = requiredElement<HTMLButtonElement>(
    "vectorTextRasterize",
  );
  private readonly textRasterStatus = requiredElement<HTMLElement>(
    "vectorTextRasterStatus",
  );
  private readonly svgSelectedControls = requiredElement<HTMLElement>(
    "vectorSvgSelectedControls",
  );
  private readonly svgSourceSummary = requiredElement<HTMLElement>(
    "vectorSvgSourceSummary",
  );
  private readonly svgPalette = requiredElement<HTMLElement>("vectorSvgPalette");
  private readonly svgRasterizeButton = requiredElement<HTMLButtonElement>(
    "vectorSvgRasterize",
  );
  private readonly svgLoadExampleButton = requiredElement<HTMLButtonElement>(
    "vectorSvgLoadExample",
  );
  private readonly svgImportButton = requiredElement<HTMLButtonElement>(
    "vectorSvgImportButton",
  );
  private readonly svgFileInput = requiredElement<HTMLInputElement>(
    "vectorSvgFileInput",
  );
  private readonly svgImportStatus = requiredElement<HTMLElement>(
    "vectorSvgImportStatus",
  );
  private readonly imageImportButton = requiredElement<HTMLButtonElement>(
    "rasterImageImportButton",
  );
  private readonly imageFileInput = requiredElement<HTMLInputElement>(
    "rasterImageFileInput",
  );
  private readonly imageImportStatus = requiredElement<HTMLElement>(
    "rasterImageImportStatus",
  );
  private readonly imageSelectedControls = requiredElement<HTMLElement>(
    "rasterImageSelectedControls",
  );
  private readonly imageSourceSummary = requiredElement<HTMLElement>(
    "rasterImageSourceSummary",
  );
  private readonly transformCommitBar = requiredElement<HTMLElement>(
    "transformCommitBar",
  );
  private readonly transformApplyButton = requiredElement<HTMLButtonElement>(
    "transformApply",
  );
  private readonly transformCancelButton = requiredElement<HTMLButtonElement>(
    "transformCancel",
  );
  private readonly textInput = requiredElement<HTMLInputElement>("vectorTextValue");
  private readonly fontFamilySelect = requiredElement<HTMLSelectElement>("vectorTextFontFamily");
  private readonly fontSizeInput = requiredElement<HTMLInputElement>("vectorTextFontSize");
  private readonly fontSizeOutput = requiredElement<HTMLOutputElement>("vectorTextFontSizeOut");
  private readonly colorInput = requiredElement<HTMLInputElement>("vectorTextColor");
  private readonly transformNoneButton = requiredElement<HTMLButtonElement>(
    "vectorTextTransformNone",
  );
  private readonly transformDistortButton = requiredElement<HTMLButtonElement>(
    "vectorTextTransformDistort",
  );
  private readonly transformArchButton = requiredElement<HTMLButtonElement>(
    "vectorTextTransformArch",
  );
  private readonly transformCircleButton = requiredElement<HTMLButtonElement>(
    "vectorTextTransformCircle",
  );
  private readonly transformWaveButton = requiredElement<HTMLButtonElement>(
    "vectorTextTransformWave",
  );
  private readonly transformDistortParameters = requiredElement<HTMLElement>(
    "vectorTextTransformDistortParameters",
  );
  private readonly distortResetButton = requiredElement<HTMLButtonElement>(
    "vectorTextDistortReset",
  );
  private readonly distortEditButton = requiredElement<HTMLButtonElement>(
    "vectorTextDistortEdit",
  );
  private readonly transformCurveParameters = requiredElement<HTMLElement>(
    "vectorTextTransformCurveParameters",
  );
  private readonly transformCurveInput = requiredElement<HTMLInputElement>(
    "vectorTextTransformCurve",
  );
  private readonly transformCurveOutput = requiredElement<HTMLOutputElement>(
    "vectorTextTransformCurveOut",
  );
  private readonly transformCircleParameters = requiredElement<HTMLElement>(
    "vectorTextTransformCircleParameters",
  );
  private readonly circleRadiusInput = requiredElement<HTMLInputElement>(
    "vectorTextCircleRadius",
  );
  private readonly circleRadiusOutput = requiredElement<HTMLOutputElement>(
    "vectorTextCircleRadiusOut",
  );
  private readonly circleInvertedInput = requiredElement<HTMLInputElement>(
    "vectorTextCircleInverted",
  );
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
  private readonly innerShadowEnabledInput = requiredElement<HTMLInputElement>(
    "vectorTextInnerShadowEnabled",
  );
  private readonly innerShadowParameters = requiredElement<HTMLElement>(
    "vectorTextInnerShadowParameters",
  );
  private readonly innerShadowColorInput = requiredElement<HTMLInputElement>(
    "vectorTextInnerShadowColor",
  );
  private readonly innerShadowOpacityInput = requiredElement<HTMLInputElement>(
    "vectorTextInnerShadowOpacity",
  );
  private readonly innerShadowOpacityOutput = requiredElement<HTMLOutputElement>(
    "vectorTextInnerShadowOpacityOut",
  );
  private readonly innerShadowOffsetInput = requiredElement<HTMLInputElement>(
    "vectorTextInnerShadowOffset",
  );
  private readonly innerShadowOffsetOutput = requiredElement<HTMLOutputElement>(
    "vectorTextInnerShadowOffsetOut",
  );
  private readonly innerShadowAngleInput = requiredElement<HTMLInputElement>(
    "vectorTextInnerShadowAngle",
  );
  private readonly innerShadowAngleOutput = requiredElement<HTMLOutputElement>(
    "vectorTextInnerShadowAngleOut",
  );
  private readonly innerShadowBlurInput = requiredElement<HTMLInputElement>(
    "vectorTextInnerShadowBlur",
  );
  private readonly innerShadowBlurOutput = requiredElement<HTMLOutputElement>(
    "vectorTextInnerShadowBlurOut",
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
  private readonly displayedDrawsByNodeKey = new Map<
    string,
    readonly VectorTextGpuDraw[]
  >();
  private readonly displayedMetricsByNodeKey = new Map<string, TextMetricsBox>();
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
  private sceneOperationRenderDeferred = false;
  private pendingViewRender = false;
  private pendingViewRenderStartedAt = 0;
  private lastViewRenderEndToEndMs = 0;
  private atomicEffectHoldCount = 0;
  private atomicEffectPendingNodes = 0;
  private distortEditingNodeId: number | null = null;
  private transformToolActive = false;
  private transformSessionOpen = false;
  private transformCommitBusy = false;
  private readonly touchContacts = new Map<number, Point>();
  private touchNavigationGesture: TouchNavigationGesture | null = null;
  private touchNavigationActive = false;

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
  }

  setTransformToolActive(active: boolean): void {
    if (!active && this.transformSessionOpen) {
      return;
    }
    this.transformToolActive = active;
    const hasSelection = this.selectedVectorNode() !== null;
    this.interactionCanvas.hidden = !active || !hasSelection;
    this.interactionCanvas.classList.toggle("is-editing", active && hasSelection);
    this.interactionCanvas.setAttribute(
      "aria-hidden",
      String(!active || !hasSelection),
    );
    this.updateTransformCommitUi();
    this.scheduleRender();
  }

  private updateTransformCommitUi(): void {
    this.transformCommitBar.hidden = !this.transformSessionOpen;
    this.transformApplyButton.disabled = this.transformCommitBusy;
    this.transformCancelButton.disabled = this.transformCommitBusy;
  }

  private async applyTransformSession(): Promise<void> {
    if (!this.transformSessionOpen || this.transformCommitBusy || this.activeInteraction) return;
    this.transformCommitBusy = true;
    this.updateTransformCommitUi();
    try {
      this.host.commitVectorHistoryEdit();
      this.transformSessionOpen = false;
    } finally {
      this.transformCommitBusy = false;
      this.updateTransformCommitUi();
      this.syncControlsFromSelection(this.selectedVectorNode());
      this.scheduleRender();
    }
  }

  private async cancelTransformSession(): Promise<void> {
    if (!this.transformSessionOpen || this.transformCommitBusy || this.activeInteraction) return;
    this.transformCommitBusy = true;
    this.updateTransformCommitUi();
    try {
      const cancelled = await this.host.cancelVectorHistoryEdit();
      if (!cancelled) {
        throw new Error("Nessuna trasformazione aperta da annullare.");
      }
      this.transformSessionOpen = false;
    } catch (error) {
      this.status.textContent = error instanceof Error
        ? `Annullamento Trasforma non riuscito: ${error.message}`
        : "Annullamento Trasforma non riuscito.";
    } finally {
      this.transformCommitBusy = false;
      this.updateTransformCommitUi();
      this.syncControlsFromSelection(this.selectedVectorNode());
      this.scheduleRender();
    }
  }

  private abortActiveTransformInteraction(): void {
    const interaction = this.activeInteraction;
    if (!interaction) return;
    if (interaction.mode !== "pan") {
      this.restoreInteractionStart(interaction);
    }
    this.clearActiveInteraction(interaction);
    if (this.interactionCanvas.hasPointerCapture(interaction.pointerId)) {
      this.interactionCanvas.releasePointerCapture(interaction.pointerId);
    }
    this.scheduleRender();
  }

  syncScene(snapshot: MixedSceneSnapshot): void {
    const previousSnapshot = this.snapshot;
    const previousSelected = previousSnapshot?.items.find(
      (item) => item.key === previousSnapshot.selectedKey,
    );
    const nextSelected = snapshot.items.find((item) => item.key === snapshot.selectedKey);
    const imageTransformOnly = Boolean(
      this.transformSessionOpen
      && previousSelected?.kind === "image"
      && nextSelected?.kind === "image"
      && previousSelected.imageNode.id === nextSelected.imageNode.id
      && previousSnapshot?.items.length === snapshot.items.length
      && previousSnapshot.items.every((item, index) => item.key === snapshot.items[index]?.key),
    );
    const interaction = this.activeInteraction;
    const interactionStillTargetsSelection =
      interaction !== null
      && snapshot.selectedKey === vectorNodeKey(interaction.startModel);
    this.snapshot = snapshot;
    const liveTextNodeIds = new Set(
      snapshot.items
        .filter((item) => item.kind === "text")
        .map((item) => item.textNode.id),
    );
    const liveVectorKeys = new Set<string>(
      snapshot.items
        .filter((item) => item.kind !== "raster")
        .map((item) => item.key),
    );
    for (const id of this.geometryByNodeId.keys()) {
      if (!liveTextNodeIds.has(id)) this.geometryByNodeId.delete(id);
    }
    for (const key of this.displayedDrawsByNodeKey.keys()) {
      if (!liveVectorKeys.has(key)) {
        this.displayedDrawsByNodeKey.delete(key);
        this.displayedMetricsByNodeKey.delete(key);
      }
    }

    if (!interactionStillTargetsSelection) {
      this.activeInteraction = null;
      this.interactionCanvas.classList.remove(
        "is-move",
        "is-scale",
        "is-rotate",
        "is-pan",
        "is-distort",
      );
    }
    const node = this.selectedVectorNode();
    const textNode = node && isTextNode(node) ? node : null;
    const vectorSelected = node !== null;
    if (
      !textNode
      || textNode.id !== this.distortEditingNodeId
      || textNode.transformType !== "distort"
      || !textNode.distortPoints
    ) {
      this.distortEditingNodeId = null;
    }
    this.interactionCanvas.hidden = !this.transformToolActive || !vectorSelected;
    this.interactionCanvas.classList.toggle(
      "is-editing",
      this.transformToolActive && vectorSelected,
    );
    this.interactionCanvas.classList.toggle(
      "is-distort-editing",
      this.distortEditingNodeId !== null,
    );
    this.interactionCanvas.setAttribute(
      "aria-hidden",
      String(!this.transformToolActive || !vectorSelected),
    );
    this.syncControlsFromSelection(node);
    if (imageTransformOnly && node && isImageNode(node)) {
      const view = this.host.getVectorTextViewState();
      this.syncCanvasSizes(view);
      this.metrics = {
        left: -node.document.width * 0.5,
        top: -node.document.height * 0.5,
        right: node.document.width * 0.5,
        bottom: node.document.height * 0.5,
        baseline: 0,
      };
      if (this.transformToolActive) this.renderInteractionOverlay(view, node);
      else this.clearInteractionOverlay(view);
      this.updateStatus(view, node);
    } else {
      this.scheduleRender();
    }
  }
  scheduleViewSync(): void {
    if (!this.snapshot?.items.some((item) => item.kind !== "raster")) {
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
      innerShadowStrategy: VECTOR_TEXT_INNER_SHADOW_STRATEGY,
      singleShadowBlurStrategy: VECTOR_TEXT_SINGLE_SHADOW_BLUR_STRATEGY,
      adaptiveZoomStrategy: VECTOR_TEXT_ADAPTIVE_ZOOM_STRATEGY,
      transformStrategy: VECTOR_TEXT_TRANSFORM_STRATEGY,
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
      atomicEffectHoldCount: this.atomicEffectHoldCount,
      atomicEffectPendingNodes: this.atomicEffectPendingNodes,
    };
  }

  private defaultSeed(index: number): VectorTextNodeSeed {
    return {
      text: index === 0 ? "STREETWEAR" : `TESTO ${index + 1}`,
      fontFamily: "Anton",
      fontSize: 360,
      color: index === 0 ? "#111111" : "#f47c5d",
      transformType: "none",
      transformCurve: 80,
      circleRadiusPercent: 50,
      circleInverted: false,
      distortPoints: null,
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
      innerShadowEnabled: false,
      innerShadowColor: "#000000",
      innerShadowOpacity: 0.65,
      innerShadowOffset: 12,
      innerShadowAngle: -135,
      innerShadowBlur: 12,
      x: this.host.layerSize * 0.5 + index * 90,
      y: this.host.layerSize * 0.5 + index * 110,
      scale: 1,
      rotation: 0,
    };
  }

  private defaultSvgSeed(documentValue: ReturnType<typeof parseVectorSvg>): VectorSvgNodeSeed {
    const longestSide = Math.max(1, documentValue.width, documentValue.height);
    return {
      document: documentValue,
      paintColors: documentValue.paints.map((paint) => paint.color),
      outlineWidth: 0,
      outlineColor: "#111111",
      outlineJoin: "round",
      blockShadowEnabled: false,
      blockShadowColor: "#727272",
      blockShadowOpacity: 1,
      blockShadowOffset: 23,
      blockShadowAngle: -104,
      blockShadowOutlineWidth: 0,
      singleShadowEnabled: false,
      singleShadowColor: "#000000",
      singleShadowOpacity: 0.55,
      singleShadowOffset: 24,
      singleShadowAngle: -135,
      singleShadowBlur: 12,
      innerShadowEnabled: false,
      innerShadowColor: "#000000",
      innerShadowOpacity: 0.55,
      innerShadowOffset: 12,
      innerShadowAngle: -135,
      innerShadowBlur: 12,
      x: this.host.layerSize * 0.5,
      y: this.host.layerSize * 0.5,
      scale: Math.min(2, 1200 / longestSide),
      rotation: 0,
    };
  }

  private setSvgImportStatus(message: string, failed = false): void {
    this.svgImportStatus.textContent = message;
    this.svgImportStatus.classList.toggle("error", failed);
    this.svgImportStatus.classList.toggle("ok", !failed);
  }

  private async importSvgSource(source: string, sourceName: string): Promise<void> {
    if (this.sceneOperationBusy) return;
    this.setSvgImportStatus(`Analisi sicura di ${sourceName}…`);
    let documentValue: ReturnType<typeof parseVectorSvg>;
    try {
      documentValue = parseVectorSvg(source, sourceName);
    } catch (error) {
      this.setSvgImportStatus(
        error instanceof Error ? error.message : "SVG non valido.",
        true,
      );
      return;
    }
    this.sceneOperationBusy = true;
    this.syncControlsFromSelection(this.selectedVectorNode());
    try {
      await this.host.addVectorSvgNode(
        this.defaultSvgSeed(documentValue),
        documentValue.sourceName,
      );
      const sourceMiB = documentValue.sourceBytes / MEBIBYTE_BYTES;
      const vectorMiB = documentValue.logicalVectorBytes / MEBIBYTE_BYTES;
      this.setSvgImportStatus(
        `${documentValue.sourceName} importato · ${documentValue.paints.length} colori · `
        + `${documentValue.contourCount} contorni · ${sourceMiB.toFixed(3)} MiB file · `
        + `${vectorMiB.toFixed(3)} MiB dati vettoriali CPU.`,
      );
    } catch (error) {
      this.setSvgImportStatus(
        error instanceof Error ? error.message : "Importazione SVG non riuscita.",
        true,
      );
    } finally {
      this.sceneOperationBusy = false;
      this.syncControlsFromSelection(this.selectedVectorNode());
      if (this.sceneOperationRenderDeferred) {
        this.sceneOperationRenderDeferred = false;
        this.scheduleRender();
      }
    }
  }

  private setImageImportStatus(message: string, failed = false): void {
    this.imageImportStatus.textContent = message;
    this.imageImportStatus.classList.toggle("error", failed);
    this.imageImportStatus.classList.toggle("ok", !failed);
  }

  private async importImageFile(file: File): Promise<void> {
    if (this.sceneOperationBusy || this.transformSessionOpen) return;
    this.sceneOperationBusy = true;
    this.setImageImportStatus(`Decodifica di ${file.name}…`);
    this.syncControlsFromSelection(this.selectedVectorNode());
    try {
      const node = await this.host.importRasterImageFile(file);
      const sourceMiB = node.document.sourceBytes / MEBIBYTE_BYTES;
      this.setImageImportStatus(
        `${node.name} importata · ${node.document.width}×${node.document.height} px · `
        + `${sourceMiB.toFixed(2)} MiB file · mipmap WebGPU pronta.`,
      );
    } catch (error) {
      this.setImageImportStatus(
        error instanceof Error ? error.message : "Importazione immagine non riuscita.",
        true,
      );
    } finally {
      this.sceneOperationBusy = false;
      this.syncControlsFromSelection(this.selectedVectorNode());
      if (this.sceneOperationRenderDeferred) {
        this.sceneOperationRenderDeferred = false;
        this.scheduleRender();
      }
    }
  }

  private bindVectorHistoryControl(control: HTMLElement): void {
    const begin = () => { this.host.beginVectorHistoryEdit(); };
    const commit = () => { this.host.commitVectorHistoryEdit(); };
    control.addEventListener("focus", begin);
    control.addEventListener("pointerdown", begin);
    if (control instanceof HTMLInputElement && control.type === "range") {
      control.addEventListener("pointerup", commit);
      control.addEventListener("pointercancel", commit);
      control.addEventListener("keydown", begin);
      control.addEventListener("keyup", commit);
      control.addEventListener("blur", commit);
      return;
    }
    control.addEventListener("change", commit);
    control.addEventListener("blur", commit);
  }

  private renderSvgPalette(node: Readonly<VectorSvgNode> | null): void {
    if (!node) {
      this.svgPalette.replaceChildren();
      delete this.svgPalette.dataset.signature;
      return;
    }
    const paletteLocked = this.sceneOperationBusy || this.transformSessionOpen;
    const signature = `${node.id}:${node.document.paints.length}:${paletteLocked}`;
    if (this.svgPalette.dataset.signature === signature) {
      const colorInputs = this.svgPalette.querySelectorAll<HTMLInputElement>(
        'input[type="color"]',
      );
      const hexInputs = this.svgPalette.querySelectorAll<HTMLInputElement>(
        'input[type="text"]',
      );
      node.document.paints.forEach((paint, index) => {
        const colorInput = colorInputs[index];
        const hexInput = hexInputs[index];
        const color = (node.paintColors[index] ?? paint.color).toLowerCase();
        if (colorInput) {
          colorInput.disabled = paletteLocked;
          if (document.activeElement !== colorInput) colorInput.value = color;
        }
        if (hexInput) {
          hexInput.disabled = paletteLocked;
          if (document.activeElement !== hexInput) {
            hexInput.value = color.toUpperCase();
            hexInput.removeAttribute("aria-invalid");
          }
        }
      });
      return;
    }
    this.svgPalette.dataset.signature = signature;
    const controls = node.document.paints.map((paint, index) => {
      const label = document.createElement("label");
      label.className = "control color-control vector-svg-color-row";
      const title = document.createElement("span");
      title.className = "vector-svg-color-title";
      title.textContent = `Colore ${index + 1}`;
      title.title = `Originale ${paint.color} · opacità ${Math.round(paint.opacity * 100)}%`;
      const input = document.createElement("input");
      input.type = "color";
      input.value = node.paintColors[index] ?? paint.color;
      input.setAttribute("aria-label", `Colore SVG ${index + 1}`);
      input.disabled = paletteLocked;
      const hexInput = document.createElement("input");
      hexInput.type = "text";
      hexInput.inputMode = "text";
      hexInput.maxLength = 7;
      hexInput.value = input.value.toUpperCase();
      hexInput.spellcheck = false;
      hexInput.setAttribute("aria-label", `HEX colore SVG ${index + 1}`);
      hexInput.disabled = paletteLocked;
      const commitColor = (color: string) => {
        if (this.sceneOperationBusy || this.transformSessionOpen) return;
        if (!/^#[0-9a-f]{6}$/i.test(color)) return;
        const current = this.selectedSvgNode();
        if (!current || current.id !== node.id) return;
        const normalizedColor = color.toLowerCase();
        if (current.paintColors[index]?.toLowerCase() === normalizedColor) return;
        const paintColors = [...current.paintColors];
        paintColors[index] = normalizedColor;
        this.updateSelectedNode({ paintColors });
      };
      const commitPickerColor = () => {
        hexInput.value = input.value.toUpperCase();
        hexInput.removeAttribute("aria-invalid");
        commitColor(input.value);
      };
      input.addEventListener("input", commitPickerColor);
      input.addEventListener("change", commitPickerColor);
      hexInput.addEventListener("input", () => {
        const candidate = hexInput.value.trim();
        hexInput.setAttribute("aria-invalid", String(!/^#[0-9a-f]{6}$/i.test(candidate)));
      });
      hexInput.addEventListener("change", () => commitColor(hexInput.value.trim()));
      hexInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") hexInput.blur();
      });
      hexInput.addEventListener("blur", () => {
        const candidate = hexInput.value.trim();
        if (/^#[0-9a-f]{6}$/i.test(candidate)) {
          commitColor(candidate);
          return;
        }
        const current = this.selectedSvgNode();
        hexInput.value = (current?.paintColors[index] ?? input.value).toUpperCase();
        hexInput.removeAttribute("aria-invalid");
      });
      this.bindVectorHistoryControl(input);
      this.bindVectorHistoryControl(hexInput);
      const picker = document.createElement("span");
      picker.className = "vector-svg-color-picker";
      picker.append(input, hexInput);
      label.append(title, picker);
      return label;
    });
    this.svgPalette.replaceChildren(...controls);
  }
  private selectedVectorNode(): Readonly<VectorSceneNode> | null {
    const snapshot = this.snapshot;
    if (!snapshot) return null;
    const selected = snapshot.items.find((item) => item.key === snapshot.selectedKey);
    if (selected?.kind === "text") return selected.textNode;
    if (selected?.kind === "svg") return selected.svgNode;
    if (selected?.kind === "image") return selected.imageNode;
    return null;
  }

  private selectedTextNode(): Readonly<VectorTextNode> | null {
    const node = this.selectedVectorNode();
    return node && isTextNode(node) ? node : null;
  }

  private selectedSvgNode(): Readonly<VectorSvgNode> | null {
    const node = this.selectedVectorNode();
    return node && isSvgNode(node) ? node : null;
  }

  private selectedImageNode(): Readonly<RasterImageNode> | null {
    const node = this.selectedVectorNode();
    return node && isImageNode(node) ? node : null;
  }

  private vectorRasterView(): VectorTextViewState {
    return {
      canvasWidth: this.host.layerSize,
      canvasHeight: this.host.layerSize,
      cssWidth: this.host.layerSize,
      cssHeight: this.host.layerSize,
      centerX: this.host.layerSize * 0.5,
      centerY: this.host.layerSize * 0.5,
      zoom: 1,
      rotationRadians: 0,
      rotationCos: 1,
      rotationSin: 0,
    };
  }

  private setTextRasterStatus(message: string, failed = false): void {
    this.textRasterStatus.textContent = message;
    this.textRasterStatus.classList.toggle("error", failed);
    this.textRasterStatus.classList.toggle("ok", !failed);
  }

  private async rasterizeSelectedText(): Promise<void> {
    const selected = this.selectedTextNode();
    if (!selected || selected.text.length === 0) return;
    const textId = selected.id;
    await this.runSceneOperation(async () => {
      this.setTextRasterStatus(
        "Preparazione del testo alla risoluzione documento…",
      );
      const view = this.vectorRasterView();
      const rasterSlots = new Set<string>();
      try {
        for (;;) {
          const revision = this.effectCompiler.resourceRevisionValue();
          const current = this.selectedTextNode();
          if (!current || current.id !== textId) {
            throw new Error(
              "Il testo selezionato è cambiato durante la rasterizzazione.",
            );
          }
          if (current.text.length === 0) {
            throw new Error("Il testo vuoto non contiene pixel da rasterizzare.");
          }
          const rasterNode = cloneVectorTextNode(current);
          rasterNode.opacity = 1;
          const geometry = this.geometryForNode(rasterNode);
          const draws: VectorTextGpuDraw[] = [];
          const allEffectsReady = this.appendGpuDrawsForNode(
            draws,
            rasterNode,
            geometry,
            view,
            rasterSlots,
            true,
          );
          if (allEffectsReady) {
            this.setTextRasterStatus(
              "Rasterizzazione WebGPU di " + current.name + "…",
            );
            const result = await this.host.rasterizeVectorTextNode(textId, draws);
            const message =
              current.name + " rasterizzato in RGBA8 · MSAA 4× · "
              + result.chunkCount + " blocchi 512 px · "
              + result.tileCount + " tile 256 px.";
            this.setTextRasterStatus(message);
            this.status.textContent = message;
            return;
          }
          const diagnostics = this.effectCompiler.diagnostics();
          if (diagnostics.pendingJobs === 0 && diagnostics.lastError) {
            throw new Error(
              "Preparazione mesh testo fallita: " + diagnostics.lastError,
            );
          }
          await this.effectCompiler.waitForResourceReady(revision);
        }
      } catch (error) {
        this.setTextRasterStatus(
          error instanceof Error
            ? error.message
            : "Rasterizzazione testo non riuscita.",
          true,
        );
        throw error;
      } finally {
        for (const slot of rasterSlots) {
          this.effectCompiler.releasePinnedSlot(slot);
        }
      }
    });
  }

  private async rasterizeSelectedSvg(): Promise<void> {
    const selected = this.selectedSvgNode();
    if (!selected) return;
    const svgId = selected.id;
    await this.runSceneOperation(async () => {
      this.setSvgImportStatus("Preparazione delle mesh SVG alla risoluzione documento…");
      const view = this.vectorRasterView();
      const rasterSlots = new Set<string>();
      try {
        for (;;) {
          const revision = this.effectCompiler.resourceRevisionValue();
          const current = this.selectedSvgNode();
          if (!current || current.id !== svgId) {
            throw new Error("L’SVG selezionato è cambiato durante la rasterizzazione.");
          }
          const rasterNode = cloneVectorSvgNode(current);
          rasterNode.opacity = 1;
          const draws: VectorTextGpuDraw[] = [];
          const allEffectsReady = this.appendGpuDrawsForSvgNode(
            draws,
            rasterNode,
            view,
            rasterSlots,
            true,
          );
          if (allEffectsReady) {
            this.setSvgImportStatus(
              `Rasterizzazione WebGPU di ${current.name}…`,
            );
            const result = await this.host.rasterizeVectorSvgNode(svgId, draws);
            this.setSvgImportStatus(
              `${current.name} rasterizzato in RGBA8 · MSAA 4× · `
              + `${result.chunkCount} blocchi 512 px · ${result.tileCount} tile 256 px.`,
            );
            return;
          }
          const diagnostics = this.effectCompiler.diagnostics();
          if (diagnostics.pendingJobs === 0 && diagnostics.lastError) {
            throw new Error(
              `Preparazione mesh SVG fallita: ${diagnostics.lastError}`,
            );
          }
          await this.effectCompiler.waitForResourceReady(revision);
        }
      } catch (error) {
        this.setSvgImportStatus(
          error instanceof Error ? error.message : "Rasterizzazione SVG non riuscita.",
          true,
        );
        throw error;
      } finally {
        for (const slot of rasterSlots) {
          this.effectCompiler.releasePinnedSlot(slot);
        }
      }
    });
  }

  private defaultDistortPointsForNode(
    node: Readonly<VectorTextNode>,
  ): VectorTextDistortPoints {
    const outline = this.geometryForNode(node).outline;
    return defaultVectorTextDistortPoints({
      left: outline.inkLeft,
      top: outline.inkTop,
      right: outline.inkRight,
      bottom: outline.inkBottom,
    });
  }

  private activateTransform(transformType: VectorTextTransformType): void {
    const node = this.selectedTextNode();
    if (!node) {
      return;
    }
    if (transformType === "distort") {
      if (node.transformType === "distort" && node.distortPoints) {
        return;
      }
      this.distortEditingNodeId = null;
      this.updateSelectedNode({
        transformType,
        distortPoints: this.defaultDistortPointsForNode(node),
      });
      return;
    }
    this.distortEditingNodeId = null;
    this.updateSelectedNode({ transformType, distortPoints: null });
  }

  private resetDistort(): void {
    const node = this.selectedTextNode();
    if (!node || node.transformType !== "distort") {
      return;
    }
    this.updateSelectedNode({
      distortPoints: this.defaultDistortPointsForNode(node),
    });
  }

  private toggleDistortEditing(): void {
    const node = this.selectedTextNode();
    if (!node || node.transformType !== "distort" || !node.distortPoints) {
      return;
    }
    this.distortEditingNodeId = this.distortEditingNodeId === node.id
      ? null
      : node.id;
    this.syncControlsFromSelection(node);
    this.interactionCanvas.classList.toggle(
      "is-distort-editing",
      this.distortEditingNodeId !== null,
    );
    this.scheduleRender();
  }

  private bindControls(): void {
    this.imageImportButton.addEventListener("click", () => this.imageFileInput.click());
    this.imageFileInput.addEventListener("change", () => {
      const file = this.imageFileInput.files?.[0];
      this.imageFileInput.value = "";
      if (file) void this.importImageFile(file);
    });
    this.transformApplyButton.addEventListener("click", () => {
      void this.applyTransformSession();
    });
    this.transformCancelButton.addEventListener("click", () => {
      void this.cancelTransformSession();
    });
    window.addEventListener("keydown", (event) => {
      if (!this.transformSessionOpen || event.defaultPrevented || event.isComposing) return;
      const target = event.target instanceof Element ? event.target : null;
      const editable = Boolean(target?.closest("input, textarea, select, [contenteditable]"));
      if (event.key === "Escape") {
        event.preventDefault();
        this.abortActiveTransformInteraction();
        void this.cancelTransformSession();
      } else if (event.key === "Enter" && !editable && !this.activeInteraction) {
        event.preventDefault();
        void this.applyTransformSession();
      }
    });
    this.svgLoadExampleButton.addEventListener("click", () => {
      void (async () => {
        try {
          const response = await fetch(VECTOR_SVG_EXAMPLE_URL, { cache: "no-store" });
          if (!response.ok) throw new Error(`SVG di esempio non disponibile (${response.status}).`);
          await this.importSvgSource(await response.text(), "image (5) copiaasd.svg");
        } catch (error) {
          this.setSvgImportStatus(error instanceof Error ? error.message : String(error), true);
        }
      })();
    });
    this.svgImportButton.addEventListener("click", () => this.svgFileInput.click());
    this.textRasterizeButton.addEventListener("click", () => {
      void this.rasterizeSelectedText();
    });
    this.svgRasterizeButton.addEventListener("click", () => {
      void this.rasterizeSelectedSvg();
    });
    this.svgFileInput.addEventListener("change", () => {
      const file = this.svgFileInput.files?.[0];
      this.svgFileInput.value = "";
      if (!file) return;
      void (async () => {
        try {
          await this.importSvgSource(await file.text(), file.name);
        } catch (error) {
          this.setSvgImportStatus(error instanceof Error ? error.message : String(error), true);
        }
      })();
    });
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
    const transformButtons: readonly [
      VectorTextTransformType,
      HTMLButtonElement,
    ][] = [
      ["none", this.transformNoneButton],
      ["distort", this.transformDistortButton],
      ["arch", this.transformArchButton],
      ["circle", this.transformCircleButton],
      ["wave", this.transformWaveButton],
    ];
    for (const [transformType, button] of transformButtons) {
      button.addEventListener("click", () => {
        this.activateTransform(transformType);
      });
    }
    this.distortResetButton.addEventListener("click", () => {
      this.resetDistort();
    });
    this.distortEditButton.addEventListener("click", () => {
      this.toggleDistortEditing();
    });
    this.transformCurveInput.addEventListener("input", () => {
      const transformCurve = Number(this.transformCurveInput.value);
      this.transformCurveOutput.value = transformCurve.toFixed(0) + "%";
      this.updateSelectedNode({ transformCurve });
    });
    this.circleRadiusInput.addEventListener("input", () => {
      const circleRadiusPercent = Number(this.circleRadiusInput.value);
      this.circleRadiusOutput.value = circleRadiusPercent.toFixed(0) + "%";
      this.updateSelectedNode({ circleRadiusPercent });
    });
    this.circleInvertedInput.addEventListener("change", () => {
      this.updateSelectedNode({
        circleInverted: this.circleInvertedInput.checked,
      });
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
    this.innerShadowEnabledInput.addEventListener("change", () => {
      const enabled = this.innerShadowEnabledInput.checked;
      this.innerShadowParameters.hidden = !enabled;
      this.updateSelectedNode({ innerShadowEnabled: enabled });
    });
    this.innerShadowColorInput.addEventListener("input", () => {
      this.updateSelectedNode({ innerShadowColor: this.innerShadowColorInput.value });
    });
    this.innerShadowOpacityInput.addEventListener("input", () => {
      const opacityPercent = Number(this.innerShadowOpacityInput.value);
      this.innerShadowOpacityOutput.value = `${Math.round(opacityPercent)}%`;
      this.updateSelectedNode({ innerShadowOpacity: opacityPercent / 100 });
    });
    this.innerShadowOffsetInput.addEventListener("input", () => {
      const offset = Number(this.innerShadowOffsetInput.value);
      this.innerShadowOffsetOutput.value = String(Math.round(offset));
      this.updateSelectedNode({ innerShadowOffset: offset });
    });
    this.innerShadowAngleInput.addEventListener("input", () => {
      const angle = Number(this.innerShadowAngleInput.value);
      this.innerShadowAngleOutput.value = `${Math.round(angle)}°`;
      this.updateSelectedNode({ innerShadowAngle: angle });
    });
    this.innerShadowBlurInput.addEventListener("input", () => {
      const blur = Number(this.innerShadowBlurInput.value);
      this.innerShadowBlurOutput.value = String(Math.round(blur));
      this.updateSelectedNode({ innerShadowBlur: blur });
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
      const node = this.selectedVectorNode();
      if (!node) return;
      void this.runSceneOperation(async () => {
        if (isTextNode(node)) await this.host.deleteVectorTextNode(node.id);
        else if (isSvgNode(node)) await this.host.deleteVectorSvgNode(node.id);
        else await this.host.deleteRasterImageNode(node.id);
      });
    });
    this.moveUpButton.addEventListener("click", () => {
      const node = this.selectedVectorNode();
      if (!node) return;
      void this.runSceneOperation(async () => {
        if (isTextNode(node)) await this.host.moveVectorTextNode(node.id, 1);
        else if (isSvgNode(node)) await this.host.moveVectorSvgNode(node.id, 1);
        else await this.host.moveRasterImageNode(node.id, 1);
      });
    });
    this.moveDownButton.addEventListener("click", () => {
      const node = this.selectedVectorNode();
      if (!node) return;
      void this.runSceneOperation(async () => {
        if (isTextNode(node)) await this.host.moveVectorTextNode(node.id, -1);
        else if (isSvgNode(node)) await this.host.moveVectorSvgNode(node.id, -1);
        else await this.host.moveRasterImageNode(node.id, -1);
      });
    });
    this.resetButton.addEventListener("click", () => {
      const node = this.selectedVectorNode();
      if (!node) return;
      if (isTextNode(node)) {
        this.updateSelectedNode(this.defaultSeed(Math.max(0, node.id - 1)));
      } else if (isSvgNode(node)) {
        const defaults = this.defaultSvgSeed(node.document);
        this.updateSelectedNode({
          outlineWidth: defaults.outlineWidth,
          outlineColor: defaults.outlineColor,
          outlineJoin: defaults.outlineJoin,
          blockShadowEnabled: defaults.blockShadowEnabled,
          blockShadowColor: defaults.blockShadowColor,
          blockShadowOpacity: defaults.blockShadowOpacity,
          blockShadowOffset: defaults.blockShadowOffset,
          blockShadowAngle: defaults.blockShadowAngle,
          blockShadowOutlineWidth: defaults.blockShadowOutlineWidth,
          singleShadowEnabled: defaults.singleShadowEnabled,
          singleShadowColor: defaults.singleShadowColor,
          singleShadowOpacity: defaults.singleShadowOpacity,
          singleShadowOffset: defaults.singleShadowOffset,
          singleShadowAngle: defaults.singleShadowAngle,
          singleShadowBlur: defaults.singleShadowBlur,
          innerShadowEnabled: defaults.innerShadowEnabled,
          innerShadowColor: defaults.innerShadowColor,
          innerShadowOpacity: defaults.innerShadowOpacity,
          innerShadowOffset: defaults.innerShadowOffset,
          innerShadowAngle: defaults.innerShadowAngle,
          innerShadowBlur: defaults.innerShadowBlur,
          x: defaults.x,
          y: defaults.y,
          scale: defaults.scale,
          rotation: defaults.rotation,
        });
      } else {
        const fitScale = Math.min(
          1,
          this.host.layerSize * 0.8
            / Math.max(node.document.width, node.document.height),
        );
        this.updateSelectedNode({
          x: this.host.layerSize * 0.5,
          y: this.host.layerSize * 0.5,
          scale: fitScale,
          rotation: 0,
        });
      }
    });

    const historyControls: readonly HTMLElement[] = [
      this.textInput, this.fontFamilySelect, this.fontSizeInput, this.colorInput,
      this.transformCurveInput, this.circleRadiusInput, this.circleInvertedInput,
      this.outlineWidthInput, this.outlineColorInput, this.outlineJoinSelect,
      this.blockShadowEnabledInput, this.blockShadowColorInput, this.blockShadowOpacityInput,
      this.blockShadowOffsetInput, this.blockShadowAngleInput, this.blockShadowOutlineWidthInput,
      this.singleShadowEnabledInput, this.singleShadowColorInput, this.singleShadowOpacityInput,
      this.singleShadowOffsetInput, this.singleShadowAngleInput, this.singleShadowBlurInput,
      this.innerShadowEnabledInput, this.innerShadowColorInput, this.innerShadowOpacityInput,
      this.innerShadowOffsetInput, this.innerShadowAngleInput, this.innerShadowBlurInput,
    ];
    for (const control of historyControls) this.bindVectorHistoryControl(control);

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
    this.syncControlsFromSelection(this.selectedVectorNode());
    try {
      await operation();
    } catch (error) {
      this.status.textContent = error instanceof Error
        ? error.message
        : "Modifica della scena testo/raster non riuscita.";
    } finally {
      this.sceneOperationBusy = false;
      this.syncControlsFromSelection(this.selectedVectorNode());
      if (this.sceneOperationRenderDeferred) {
        this.sceneOperationRenderDeferred = false;
        this.scheduleRender();
      }
    }
  }

  private updateSelectedNode(update: VectorSceneNodeUpdate): void {
    const node = this.selectedVectorNode();
    if (!node || this.sceneOperationBusy) return;
    if (isTextNode(node)) {
      this.host.updateVectorTextNode(
        node.id,
        update as Partial<Omit<VectorTextNode, "id" | "visible" | "opacity">>,
      );
    } else if (isSvgNode(node)) {
      this.host.updateVectorSvgNode(
        node.id,
        update as Partial<Omit<VectorSvgNode, "id" | "document" | "visible" | "opacity">>,
      );
    } else {
      this.host.updateRasterImageNode(
        node.id,
        update as Partial<
          Omit<RasterImageNode, "id" | "kind" | "document" | "visible" | "opacity">
        >,
      );
    }
  }

  private syncControlsFromSelection(node: Readonly<VectorSceneNode> | null): void {
    const interactionLocked = this.sceneOperationBusy || this.transformSessionOpen;
    const textNode = node && isTextNode(node) ? node : null;
    const svgNode = node && isSvgNode(node) ? node : null;
    const imageNode = node && isImageNode(node) ? node : null;
    const vectorDisabled = (!textNode && !svgNode) || interactionLocked;
    const actionDisabled = !node || interactionLocked;
    const textDisabled = !textNode || interactionLocked;

    this.textSpecificControls.hidden = !textNode;
    this.svgSelectedControls.hidden = !svgNode;
    this.imageSelectedControls.hidden = !imageNode;
    this.svgLoadExampleButton.disabled = interactionLocked;
    this.svgImportButton.disabled = interactionLocked;
    this.imageImportButton.disabled = interactionLocked;
    this.svgRasterizeButton.disabled = !svgNode || interactionLocked;
    this.textRasterizeButton.disabled =
      !textNode || textNode.text.length === 0 || interactionLocked;
    this.textInput.disabled = textDisabled;
    this.fontFamilySelect.disabled = textDisabled;
    this.fontSizeInput.disabled = textDisabled;
    this.colorInput.disabled = textDisabled;
    this.transformNoneButton.disabled = textDisabled;
    this.transformDistortButton.disabled = textDisabled;
    this.transformArchButton.disabled = textDisabled;
    this.transformCircleButton.disabled = textDisabled;
    this.transformWaveButton.disabled = textDisabled;
    this.distortResetButton.disabled = textDisabled;
    this.distortEditButton.disabled = textDisabled;
    this.transformCurveInput.disabled = textDisabled;
    this.circleRadiusInput.disabled = textDisabled;
    this.circleInvertedInput.disabled = textDisabled;
    this.outlineWidthInput.disabled = vectorDisabled;
    this.outlineColorInput.disabled = vectorDisabled;
    this.outlineJoinSelect.disabled = vectorDisabled;
    this.blockShadowEnabledInput.disabled = vectorDisabled;
    this.blockShadowColorInput.disabled = vectorDisabled;
    this.blockShadowOpacityInput.disabled = vectorDisabled;
    this.blockShadowOffsetInput.disabled = vectorDisabled;
    this.blockShadowAngleInput.disabled = vectorDisabled;
    this.blockShadowOutlineWidthInput.disabled = vectorDisabled;
    this.singleShadowEnabledInput.disabled = vectorDisabled;
    this.singleShadowColorInput.disabled = vectorDisabled;
    this.singleShadowOpacityInput.disabled = vectorDisabled;
    this.singleShadowOffsetInput.disabled = vectorDisabled;
    this.singleShadowAngleInput.disabled = vectorDisabled;
    this.singleShadowBlurInput.disabled = vectorDisabled;
    this.innerShadowEnabledInput.disabled = vectorDisabled;
    this.innerShadowColorInput.disabled = vectorDisabled;
    this.innerShadowOpacityInput.disabled = vectorDisabled;
    this.innerShadowOffsetInput.disabled = vectorDisabled;
    this.innerShadowAngleInput.disabled = vectorDisabled;
    this.innerShadowBlurInput.disabled = vectorDisabled;
    this.singleShadowOutlineWidthInput.disabled = true;
    this.resetButton.disabled = actionDisabled;
    this.deleteButton.disabled = actionDisabled;
    this.moveUpButton.disabled = actionDisabled;
    this.moveDownButton.disabled = actionDisabled;
    this.addButton.disabled = interactionLocked;
    this.deleteButton.textContent = imageNode
      ? "Elimina immagine"
      : svgNode
        ? "Elimina SVG"
        : "Elimina testo";
    this.resetButton.textContent = imageNode
      ? "Reimposta immagine"
      : svgNode
        ? "Reimposta SVG"
        : "Reimposta";

    if (!node) {
      this.transformDistortParameters.hidden = true;
      this.transformCurveParameters.hidden = true;
      this.transformCircleParameters.hidden = true;
      this.blockShadowParameters.hidden = true;
      this.singleShadowParameters.hidden = true;
      this.innerShadowParameters.hidden = true;
      this.renderSvgPalette(null);
      this.status.textContent =
        "Raster selezionato: il pennello è attivo. Puoi aggiungere testo, SVG o immagini.";
      return;
    }

    if (textNode) {
      this.textInput.value = textNode.text;
      this.fontFamilySelect.value = textNode.fontFamily;
      this.fontSizeInput.value = String(textNode.fontSize);
      this.fontSizeOutput.value = `${Math.round(textNode.fontSize)} px`;
      this.colorInput.value = textNode.color;
      const transformButtons: readonly [VectorTextTransformType, HTMLButtonElement][] = [
        ["none", this.transformNoneButton],
        ["distort", this.transformDistortButton],
        ["arch", this.transformArchButton],
        ["circle", this.transformCircleButton],
        ["wave", this.transformWaveButton],
      ];
      for (const [transformType, button] of transformButtons) {
        const selected = textNode.transformType === transformType;
        button.classList.toggle("is-selected", selected);
        button.setAttribute("aria-pressed", String(selected));
      }
      this.transformDistortParameters.hidden = textNode.transformType !== "distort";
      const distortEditing = textNode.id === this.distortEditingNodeId;
      this.distortEditButton.textContent = distortEditing ? "Conferma" : "Modifica";
      this.distortEditButton.setAttribute("aria-pressed", String(distortEditing));
      this.transformCurveParameters.hidden =
        textNode.transformType !== "arch" && textNode.transformType !== "wave";
      this.transformCircleParameters.hidden = textNode.transformType !== "circle";
      this.transformCurveInput.value = String(textNode.transformCurve);
      this.transformCurveOutput.value = Math.round(textNode.transformCurve) + "%";
      this.circleRadiusInput.value = String(textNode.circleRadiusPercent);
      this.circleRadiusOutput.value = Math.round(textNode.circleRadiusPercent) + "%";
      this.circleInvertedInput.checked = textNode.circleInverted;
      this.renderSvgPalette(null);
    } else if (svgNode) {
      this.transformDistortParameters.hidden = true;
      this.transformCurveParameters.hidden = true;
      this.transformCircleParameters.hidden = true;
      const sourceMiB = svgNode.document.sourceBytes / MEBIBYTE_BYTES;
      const vectorMiB = svgNode.document.logicalVectorBytes / MEBIBYTE_BYTES;
      this.svgSourceSummary.textContent =
        `${svgNode.document.sourceName} · ${svgNode.document.width.toFixed(1)}×`
        + `${svgNode.document.height.toFixed(1)} · ${svgNode.document.paints.length} colori · `
        + `${svgNode.document.contourCount} contorni · ${svgNode.document.commandCount} comandi · `
        + `${sourceMiB.toFixed(3)} MiB file · ${vectorMiB.toFixed(3)} MiB vettori CPU.`;
      this.renderSvgPalette(svgNode);
    } else if (imageNode) {
      this.transformDistortParameters.hidden = true;
      this.transformCurveParameters.hidden = true;
      this.transformCircleParameters.hidden = true;
      this.blockShadowParameters.hidden = true;
      this.singleShadowParameters.hidden = true;
      this.innerShadowParameters.hidden = true;
      this.renderSvgPalette(null);
      const sourceMiB = imageNode.document.sourceBytes / MEBIBYTE_BYTES;
      this.imageSourceSummary.textContent =
        `${imageNode.document.sourceName} · ${imageNode.document.width}×`
        + `${imageNode.document.height} px · ${sourceMiB.toFixed(2)} MiB · `
        + `${imageNode.document.mimeType.replace("image/", "").toUpperCase()} · mipmap GPU.`;
      return;
    }

    if (isImageNode(node)) return;

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
    this.blockShadowOutlineWidthOutput.value = `${Math.round(node.blockShadowOutlineWidth)} px`;
    this.singleShadowEnabledInput.checked = node.singleShadowEnabled;
    this.singleShadowParameters.hidden = !node.singleShadowEnabled;
    this.singleShadowColorInput.value = node.singleShadowColor;
    this.singleShadowOpacityInput.value = String(node.singleShadowOpacity * 100);
    this.singleShadowOpacityOutput.value = `${Math.round(node.singleShadowOpacity * 100)}%`;
    this.singleShadowOffsetInput.value = String(node.singleShadowOffset);
    this.singleShadowOffsetOutput.value = String(Math.round(node.singleShadowOffset));
    this.singleShadowAngleInput.value = String(node.singleShadowAngle);
    this.singleShadowAngleOutput.value = `${Math.round(node.singleShadowAngle)}°`;
    this.singleShadowBlurInput.value = String(node.singleShadowBlur);
    this.singleShadowBlurOutput.value = String(Math.round(node.singleShadowBlur));
    this.singleShadowOutlineWidthInput.value = "0";
    this.singleShadowOutlineWidthOutput.value = "0 px";
    this.innerShadowEnabledInput.checked = node.innerShadowEnabled;
    this.innerShadowParameters.hidden = !node.innerShadowEnabled;
    this.innerShadowColorInput.value = node.innerShadowColor;
    this.innerShadowOpacityInput.value = String(node.innerShadowOpacity * 100);
    this.innerShadowOpacityOutput.value = `${Math.round(node.innerShadowOpacity * 100)}%`;
    this.innerShadowOffsetInput.value = String(node.innerShadowOffset);
    this.innerShadowOffsetOutput.value = String(Math.round(node.innerShadowOffset));
    this.innerShadowAngleInput.value = String(node.innerShadowAngle);
    this.innerShadowAngleOutput.value = `${Math.round(node.innerShadowAngle)}°`;
    this.innerShadowBlurInput.value = String(node.innerShadowBlur);
    this.innerShadowBlurOutput.value = String(Math.round(node.innerShadowBlur));
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
    this.zoomModeIndicator.textContent = "Zoom vettori · GPU";
    this.zoomModeIndicator.title =
      "Testi OpenType e SVG restano Slug/mesh WebGPU durante ogni zoom; nessuna cache bitmap viene ingrandita.";
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
    const outlineKey = [
      node.fontFamily,
      node.fontSize,
      node.text,
      node.transformType,
      node.transformCurve,
      node.circleRadiusPercent,
      node.circleInverted ? 1 : 0,
      node.distortPoints
        ? node.distortPoints.flatMap((point) => [point.x, point.y]).join(",")
        : "-",
    ].join("\u0000");
    const cached = this.geometryByNodeId.get(node.id);
    if (cached?.outlineKey === outlineKey) {
      return cached;
    }
    const outline = this.fontGeometry.outline(
      node.fontFamily,
      node.text,
      node.fontSize,
      {
        type: node.transformType,
        curve: node.transformCurve,
        circleRadiusPercent: node.circleRadiusPercent,
        circleInverted: node.circleInverted,
        distortPoints: node.distortPoints,
      },
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
    node: Readonly<VectorSceneNode>,
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
    pinForRasterization = false,
  ): VectorTextEffectMeshResult {
    const slotNamespace = pinForRasterization ? "text-raster" : "text";
    const slotKey = slotNamespace + ":" + node.id + ":" + slotName;
    liveSlots.add(slotKey);
    if (pinForRasterization) this.effectCompiler.pinSlot(slotKey);
    return this.effectCompiler.meshForSlot(
      slotKey,
      geometry.sourceRevision,
      geometry.outline.pathData,
      this.effectLodForNode(node, view),
      effect,
      !this.host.isPaintStrokeActive(),
    );
  }

  private effectMeshForSvgPath(
    node: Readonly<VectorSvgNode>,
    sourceRevision: string,
    path: VectorSvgNode["document"]["silhouettePath"],
    view: VectorTextViewState,
    slotName: string,
    effect: Parameters<VectorTextEffectCompilerClient["meshForSlot"]>[4],
    liveSlots: Set<string>,
    pinForRasterization = false,
  ): VectorTextEffectMeshResult {
    const slotNamespace = pinForRasterization ? "svg-raster" : "svg";
    const slotKey = `${slotNamespace}:${node.id}:${slotName}`;
    liveSlots.add(slotKey);
    if (pinForRasterization) this.effectCompiler.pinSlot(slotKey);
    return this.effectCompiler.meshForSlot(
      slotKey,
      sourceRevision,
      path,
      this.effectLodForNode(node, view),
      effect,
      !this.host.isPaintStrokeActive(),
    );
  }

  private svgBlurDraw(
    node: Readonly<VectorSvgNode>,
    sourceMesh: VectorTextGpuMeshData,
    view: VectorTextViewState,
    kind: "outer" | "inner",
  ): VectorTextGpuDraw {
    const blur = kind === "outer" ? node.singleShadowBlur : node.innerShadowBlur;
    const requestedPixelScale = Math.max(1 / 32, Math.abs(view.zoom * node.scale));
    const bucketScale = 2 ** Math.ceil(Math.log2(requestedPixelScale));
    const plan = planVectorTextSingleShadowBlur(node.document.bounds, blur, bucketScale);
    const vector = kind === "outer"
      ? vectorTextSingleShadowLocalVector(node.singleShadowOffset, node.singleShadowAngle)
      : vectorTextInnerShadowLocalVector(node.innerShadowOffset, node.innerShadowAngle);
    const blurKey = [
      "vector-svg-gpu-blur-v1",
      node.id,
      sourceMesh.revision,
      blur.toFixed(4),
      plan.width,
      plan.height,
      plan.scale.toFixed(8),
      plan.sigmaPixels.toFixed(8),
      plan.radius,
    ].join(":");
    const common = {
      meshKey: `svg:${node.id}:silhouette-fill`,
      mesh: sourceMesh,
      blurKey,
      blurBounds: [
        plan.bounds[0],
        plan.bounds[1],
        plan.bounds[2],
        plan.bounds[3],
      ] as const,
      blurWidth: plan.width,
      blurHeight: plan.height,
      blurScale: plan.scale,
      blurSigmaPixels: plan.sigmaPixels,
      blurRadius: plan.radius,
      x: node.x,
      y: node.y,
      scale: node.scale,
      rotation: node.rotation,
    } as const;
    if (kind === "outer") {
      return {
        mode: "mesh-blur",
        ...common,
        localOffsetX: vector.x,
        localOffsetY: vector.y,
        color: gpuLinearColor(node.singleShadowColor),
        opacity: Math.min(1, Math.max(0, node.opacity * node.singleShadowOpacity)),
      };
    }
    return {
      mode: "mesh-inner-shadow-blur",
      ...common,
      localOffsetX: sourceMesh.originX,
      localOffsetY: sourceMesh.originY,
      sampleOffsetX: vector.x,
      sampleOffsetY: vector.y,
      color: gpuLinearColor(node.innerShadowColor),
      opacity: Math.min(1, Math.max(0, node.opacity * node.innerShadowOpacity)),
    };
  }

  private appendGpuDrawsForSvgNode(
    draws: VectorTextGpuDraw[],
    node: Readonly<VectorSvgNode>,
    view: VectorTextViewState,
    liveSlots: Set<string>,
    requireRequestedLod = false,
  ): boolean {
    let allEffectsReady = true;
    const effectIsReady = (result: VectorTextEffectMeshResult): boolean =>
      result.matchesRequestedIdentity
      && (!requireRequestedLod || result.matchesRequestedLod);
    const silhouetteResult = this.effectMeshForSvgPath(
      node,
      node.document.silhouetteRevision,
      node.document.silhouettePath,
      view,
      "silhouette-fill",
      { kind: "source-fill" },
      liveSlots,
      requireRequestedLod,
    );
    allEffectsReady = allEffectsReady && effectIsReady(silhouetteResult);
    const silhouetteMesh = silhouetteResult.mesh;

    if (node.singleShadowEnabled && node.singleShadowOpacity > 0 && silhouetteMesh) {
      if (node.singleShadowBlur > 0) {
        draws.push(this.svgBlurDraw(node, silhouetteMesh, view, "outer"));
      } else {
        const vector = vectorTextSingleShadowLocalVector(
          node.singleShadowOffset,
          node.singleShadowAngle,
        );
        draws.push(this.meshDraw(
          node,
          `svg:${node.id}:silhouette-fill`,
          silhouetteMesh,
          node.singleShadowColor,
          node.opacity * node.singleShadowOpacity,
          vector.x,
          vector.y,
        ));
      }
    }

    if (node.blockShadowEnabled && node.blockShadowOpacity > 0) {
      const vector = vectorTextBlockShadowLocalVector(
        0,
        node.blockShadowOffset,
        node.blockShadowAngle,
      );
      if (node.blockShadowOutlineWidth > 0) {
        const result = this.effectMeshForSvgPath(
          node,
          node.document.silhouetteRevision,
          node.document.silhouettePath,
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
          requireRequestedLod,
        );
        allEffectsReady = allEffectsReady && effectIsReady(result);
        if (result.mesh) {
          draws.push(this.meshDraw(
            node,
            `svg:${node.id}:block-outline`,
            result.mesh,
            node.blockShadowColor,
            node.opacity * node.blockShadowOpacity,
          ));
        }
      }
      if (Math.hypot(vector.x, vector.y) > Number.EPSILON) {
        const result = this.effectMeshForSvgPath(
          node,
          node.document.silhouetteRevision,
          node.document.silhouettePath,
          view,
          "block",
          { kind: "block", vectorX: vector.x, vectorY: vector.y },
          liveSlots,
          requireRequestedLod,
        );
        allEffectsReady = allEffectsReady && effectIsReady(result);
        if (result.mesh) {
          draws.push(this.meshDraw(
            node,
            `svg:${node.id}:block`,
            result.mesh,
            node.blockShadowColor,
            node.opacity * node.blockShadowOpacity,
          ));
        }
      }
    }

    const oneOpaquePaint = node.document.paints.length === 1
      && node.document.paints[0].opacity >= 1;
    const fuseOutlineAndFill = node.outlineWidth > 0
      && oneOpaquePaint
      && sameGpuLinearColor(node.paintColors[0], node.outlineColor);
    if (node.outlineWidth > 0) {
      const slot = fuseOutlineAndFill ? "outline-fill" : "outline";
      const result = this.effectMeshForSvgPath(
        node,
        node.document.silhouetteRevision,
        node.document.silhouettePath,
        view,
        slot,
        {
          kind: "source-outline",
          width: node.outlineWidth,
          join: node.outlineJoin,
          includeFill: fuseOutlineAndFill,
        },
        liveSlots,
        requireRequestedLod,
      );
      allEffectsReady = allEffectsReady && effectIsReady(result);
      if (result.mesh) {
        draws.push(this.meshDraw(
          node,
          `svg:${node.id}:${slot}`,
          result.mesh,
          node.outlineColor,
          node.opacity,
        ));
      }
    }

    if (!fuseOutlineAndFill) {
      for (let index = 0; index < node.document.paints.length; index += 1) {
        const paint = node.document.paints[index];
        const result = this.effectMeshForSvgPath(
          node,
          paint.revision,
          paint.path,
          view,
          `paint:${index}:fill`,
          { kind: "source-fill" },
          liveSlots,
          requireRequestedLod,
        );
        allEffectsReady = allEffectsReady && effectIsReady(result);
        if (result.mesh) {
          draws.push(this.meshDraw(
            node,
            `svg:${node.id}:paint:${index}:fill`,
            result.mesh,
            node.paintColors[index] ?? paint.color,
            node.opacity * paint.opacity,
          ));
        }
      }
    }

    if (node.innerShadowEnabled && node.innerShadowOpacity > 0 && silhouetteMesh) {
      draws.push(this.svgBlurDraw(node, silhouetteMesh, view, "inner"));
    }
    return allEffectsReady;
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
    node: Readonly<VectorSceneNode>,
    meshKey: string,
    mesh: VectorTextGpuMeshData,
    color: string,
    opacity: number,
    visualOffsetX = 0,
    visualOffsetY = 0,
  ): VectorTextGpuDraw {
    return {
      mode: "mesh-direct",
      meshKey,
      mesh,
      x: node.x,
      y: node.y,
      scale: node.scale,
      rotation: node.rotation,
      localOffsetX: mesh.originX + visualOffsetX,
      localOffsetY: mesh.originY + visualOffsetY,
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
  private slugInnerShadowDraw(
    node: Readonly<VectorTextNode>,
    geometry: CachedTextGeometry,
    view: VectorTextViewState,
  ): VectorTextGpuDraw {
    const vector = vectorTextInnerShadowLocalVector(
      node.innerShadowOffset,
      node.innerShadowAngle,
    );
    const common = {
      meshKey: `text:${node.id}:slug`,
      slug: geometry.slug,
      x: node.x,
      y: node.y,
      scale: node.scale,
      rotation: node.rotation,
      // The inner-shadow shader keeps the quad on the source glyph. This is
      // the Slug packing origin, not a visual offset and therefore not bbox.
      localOffsetX: geometry.slug.originX,
      localOffsetY: geometry.slug.originY,
      sampleOffsetX: vector.x,
      sampleOffsetY: vector.y,
      color: gpuLinearColor(node.innerShadowColor),
      opacity: Math.min(
        1,
        Math.max(0, node.opacity * node.innerShadowOpacity),
      ),
    } as const;
    if (node.innerShadowBlur <= 0) {
      return {
        mode: "slug-inner-shadow-direct",
        ...common,
      };
    }

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
      node.innerShadowBlur,
      bucketScale,
    );
    // The cache contains only G(fill). It is deliberately shareable with an
    // outer shadow using the same source, sigma and LOD; color and direction
    // are applied later and never duplicate the R8 matte.
    const blurKey = [
      "vector-text-gpu-blur-v1",
      node.id,
      geometry.sourceRevision,
      node.innerShadowBlur.toFixed(4),
      plan.width,
      plan.height,
      plan.scale.toFixed(8),
      plan.sigmaPixels.toFixed(8),
      plan.radius,
    ].join(":");
    return {
      mode: "slug-inner-shadow-blur",
      ...common,
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
    };
  }
  private retargetDisplayedDraws(
    draws: readonly VectorTextGpuDraw[],
    node: Readonly<VectorSceneNode>,
  ): VectorTextGpuDraw[] {
    return draws.map((draw): VectorTextGpuDraw => ({
      ...draw,
      x: node.x,
      y: node.y,
      scale: node.scale,
      rotation: node.rotation,
    }));
  }

  private appendGpuDrawsForNode(
    draws: VectorTextGpuDraw[],
    node: Readonly<VectorTextNode>,
    geometry: CachedTextGeometry,
    view: VectorTextViewState,
    liveSlots: Set<string>,
    requireRequestedLod = false,
  ): boolean {
    let allEffectsReady = true;
    const effectIsReady = (result: VectorTextEffectMeshResult): boolean =>
      result.matchesRequestedIdentity
      && (!requireRequestedLod || result.matchesRequestedLod);
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
        const meshResult = this.effectMeshForNode(
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
          requireRequestedLod,
        );
        allEffectsReady =
          allEffectsReady && effectIsReady(meshResult);
        if (meshResult.mesh) {
          draws.push(this.meshDraw(
            node,
            `text:${node.id}:block-outline`,
            meshResult.mesh,
            node.blockShadowColor,
            node.opacity * node.blockShadowOpacity,
          ));
        }
      }
      if (Math.hypot(vector.x, vector.y) > Number.EPSILON) {
        const meshResult = this.effectMeshForNode(
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
          requireRequestedLod,
        );
        allEffectsReady =
          allEffectsReady && effectIsReady(meshResult);
        if (meshResult.mesh) {
          draws.push(this.meshDraw(
            node,
            `text:${node.id}:block`,
            meshResult.mesh,
            node.blockShadowColor,
            node.opacity * node.blockShadowOpacity,
          ));
        }
      }
    }

    // Equal linear colors are rendered as one expanded union: there is no
    // second fill pass, hence no internal AA/compositing boundary to reveal.
    let sourceFillCoveredByOutline = false;
    if (node.outlineWidth > 0) {
      const fuseOutlineAndFill = sameGpuLinearColor(
        node.color,
        node.outlineColor,
      );
      const outlineSlot = fuseOutlineAndFill ? "outline-fill" : "outline";
      const meshResult = this.effectMeshForNode(
        node,
        geometry,
        view,
        outlineSlot,
        {
          kind: "source-outline",
          width: node.outlineWidth,
          join: node.outlineJoin,
          includeFill: fuseOutlineAndFill,
        },
        liveSlots,
        requireRequestedLod,
      );
      allEffectsReady =
        allEffectsReady && effectIsReady(meshResult);
      if (meshResult.mesh) {
        draws.push(this.meshDraw(
          node,
          `text:${node.id}:${outlineSlot}`,
          meshResult.mesh,
          node.outlineColor,
          node.opacity,
        ));
        sourceFillCoveredByOutline = fuseOutlineAndFill;
      }
    }
    if (!sourceFillCoveredByOutline) {
      draws.push(this.slugDraw(
        node,
        `text:${node.id}:slug`,
        geometry.slug,
        node.color,
        node.opacity,
      ));
    }
    if (node.innerShadowEnabled && node.innerShadowOpacity > 0) {
      draws.push(this.slugInnerShadowDraw(node, geometry, view));
    }
    return allEffectsReady;
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
    if (this.sceneOperationBusy) {
      this.sceneOperationRenderDeferred = true;
      return;
    }
    const wasViewRender = this.pendingViewRender;
    const viewRenderStartedAt = this.pendingViewRenderStartedAt;
    this.pendingViewRender = false;
    this.pendingViewRenderStartedAt = 0;
    const startedAt = performance.now();
    const view = this.host.getVectorTextViewState();
    this.syncCanvasSizes(view);
    const snapshot = this.snapshot;
    const selectedNode = this.selectedVectorNode();

    let gpuMemoryMiB = 0;
    let blurGpuMemoryMiB = 0;
    let blurGpuCacheEntries = 0;
    let textureCount = 0;
    const activeMeshKeys = new Set<string>();
    const liveEffectSlots = new Set<string>();
    let atomicEffectPendingNodes = 0;
    if (!snapshot) {
      this.host.clearVectorTextPresentation();
      this.renderedTextRunKeys.clear();
    } else {
      const groups: {
        placement: VectorTextPlacement;
        nodes: Readonly<VectorDrawableNode>[];
      }[] = [];
      let pendingNodes: Readonly<VectorDrawableNode>[] = [];
      const flushVectorRun = () => {
        if (pendingNodes.length === 0) return;
        const nodes = pendingNodes;
        pendingNodes = [];
        groups.push({
          placement: `text-run:${nodes.map(vectorNodeKey).join(",")}`,
          nodes,
        });
      };
      for (const item of snapshot.items) {
        if (item.kind === "text") pendingNodes.push(item.textNode);
        else if (item.kind === "svg") pendingNodes.push(item.svgNode);
        else if (item.kind === "image") {
          if (item.imageNode.visible && item.imageNode.opacity > 0) flushVectorRun();
        } else flushVectorRun();
      }
      flushVectorRun();

      const nextRunKeys = new Set(groups.map((group) => group.placement));
      for (const previousKey of this.renderedTextRunKeys) {
        if (!nextRunKeys.has(previousKey)) this.host.clearVectorTextPresentation(previousKey);
      }
      this.renderedTextRunKeys = nextRunKeys;

      for (const group of groups) {
        const nodes = group.nodes.filter((node) =>
          node.visible
          && node.opacity > 0
          && (!isTextNode(node) || node.text.length > 0)
        );
        for (const node of group.nodes) {
          if (!node.visible || node.opacity <= 0 || (isTextNode(node) && node.text.length === 0)) {
            const key = vectorNodeKey(node);
            this.displayedDrawsByNodeKey.delete(key);
            this.displayedMetricsByNodeKey.delete(key);
          }
        }
        if (nodes.length === 0) {
          this.host.clearVectorTextPresentation(group.placement);
          continue;
        }

        const draws: VectorTextGpuDraw[] = [];
        for (const node of nodes) {
          const key = vectorNodeKey(node);
          const candidateDraws: VectorTextGpuDraw[] = [];
          let metrics: TextMetricsBox;
          let allEffectsReady: boolean;
          if (isTextNode(node)) {
            const geometry = this.geometryForNode(node);
            allEffectsReady = this.appendGpuDrawsForNode(
              candidateDraws,
              node,
              geometry,
              view,
              liveEffectSlots,
            );
            metrics = {
              left: geometry.outline.left,
              top: geometry.outline.top,
              right: geometry.outline.right,
              bottom: geometry.outline.bottom,
              baseline: geometry.outline.baseline,
            };
          } else if (isSvgNode(node)) {
            allEffectsReady = this.appendGpuDrawsForSvgNode(
              candidateDraws,
              node,
              view,
              liveEffectSlots,
            );
            metrics = {
              left: node.document.bounds.left,
              top: node.document.bounds.top,
              right: node.document.bounds.right,
              bottom: node.document.bounds.bottom,
              baseline: 0,
            };
          } else {
            continue;
          }
          const displayedDraws = this.displayedDrawsByNodeKey.get(key);
          if (allEffectsReady) {
            this.displayedDrawsByNodeKey.set(key, candidateDraws);
            this.displayedMetricsByNodeKey.set(key, metrics);
            draws.push(...candidateDraws);
          } else if (displayedDraws) {
            atomicEffectPendingNodes += 1;
            this.atomicEffectHoldCount += 1;
            const retargeted = this.retargetDisplayedDraws(displayedDraws, node);
            this.displayedDrawsByNodeKey.set(key, retargeted);
            draws.push(...retargeted);
          } else {
            atomicEffectPendingNodes += 1;
          }
        }

        for (const draw of draws) {
          activeMeshKeys.add(draw.meshKey);
          if (
            draw.mode === "slug-blur"
            || draw.mode === "slug-inner-shadow-blur"
            || draw.mode === "mesh-blur"
            || draw.mode === "mesh-inner-shadow-blur"
          ) activeMeshKeys.add(draw.blurKey);
        }
        const stats = this.host.updateVectorTextGpuPresentation(group.placement, draws);
        gpuMemoryMiB += stats.gpuMemoryMiB;
        blurGpuMemoryMiB = Math.max(blurGpuMemoryMiB, stats.blurGpuMemoryMiB);
        blurGpuCacheEntries = Math.max(blurGpuCacheEntries, stats.blurCacheEntries);
        textureCount += 1;
      }
    }
    this.atomicEffectPendingNodes = atomicEffectPendingNodes;
    this.status.dataset.atomicEffectPendingNodes = String(atomicEffectPendingNodes);
    this.status.dataset.atomicEffectHoldCount = String(this.atomicEffectHoldCount);
    this.effectCompiler.retainSlots(liveEffectSlots);
    this.host.pruneVectorTextGpuMeshes(activeMeshKeys);
    gpuMemoryMiB += blurGpuMemoryMiB;
    this.singleShadowGpuMemoryMiB = blurGpuMemoryMiB;
    this.singleShadowGpuCacheEntries = blurGpuCacheEntries;

    if (snapshot?.items.some((item) => item.kind !== "raster")) {
      gpuMemoryMiB += view.canvasWidth * view.canvasHeight * 8 / MEBIBYTE_BYTES;
      textureCount += 1;
    }
    this.liveGpuMemoryMiB = gpuMemoryMiB;
    this.viewportTextureCount = textureCount;
    if (selectedNode) {
      const key = vectorNodeKey(selectedNode);
      this.metrics = this.displayedMetricsByNodeKey.get(key)
        ?? (isTextNode(selectedNode)
          ? this.measureText(selectedNode)
          : isSvgNode(selectedNode)
            ? {
            left: selectedNode.document.bounds.left,
            top: selectedNode.document.bounds.top,
            right: selectedNode.document.bounds.right,
            bottom: selectedNode.document.bounds.bottom,
            baseline: 0,
          }
            : {
              left: -selectedNode.document.width * 0.5,
              top: -selectedNode.document.height * 0.5,
              right: selectedNode.document.width * 0.5,
              bottom: selectedNode.document.height * 0.5,
              baseline: 0,
            });
      if (this.transformToolActive) {
        this.renderInteractionOverlay(view, selectedNode);
      } else {
        this.clearInteractionOverlay(view);
      }
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
    }
    this.updateAdaptiveZoomIndicator();
    this.updateStatus(view, selectedNode);
  }
  private updateStatus(
    view: VectorTextViewState,
    node: Readonly<VectorSceneNode> | null,
  ): void {
    const viewportCanvasLogicalMiB =
      view.canvasWidth * view.canvasHeight * 4 / MEBIBYTE_BYTES;
    const vectorFontLogicalMiB = this.fontGeometry.logicalFontBytes / MEBIBYTE_BYTES;
    const effectDiagnostics = this.effectCompiler.diagnostics();
    this.status.dataset.effectRegisteredPaths = String(effectDiagnostics.registeredPaths);
    this.status.dataset.effectReadyJobs = String(effectDiagnostics.readyJobs);
    const cacheLabel = `${this.viewportTextureCount} cache GPU viewport`;
    const timing = `render ${this.lastRenderMs.toFixed(2)} ms `
      + `(p95 ${percentile(this.renderSamples, 0.95).toFixed(2)} ms)`;
    const effectLabel = `Worker effetti ${effectDiagnostics.pendingJobs} in attesa · `
      + `${effectDiagnostics.readyJobs} pronti · ${effectDiagnostics.failedJobs} errori`
      + (effectDiagnostics.lastError ? ` · ${effectDiagnostics.lastError}` : "");
    if (!node) {
      this.status.textContent =
        `Raster selezionato · vettori semantici nel canvas di viewport · ${cacheLabel} `
        + `${this.liveGpuMemoryMiB.toFixed(2)} MiB · canvas browser `
        + `${viewportCanvasLogicalMiB.toFixed(2)} MiB · ${effectLabel} · ${timing}.`;
      return;
    }

    const snapshot = this.snapshot!;
    const vectorIndex = snapshot.items.findIndex((item) => item.key === vectorNodeKey(node));
    const rasterIndex = snapshot.items.findIndex(
      (item) => item.kind === "raster" && item.rasterLayerId === snapshot.activeRasterLayerId,
    );
    const placement = vectorIndex < rasterIndex ? "sotto il raster attivo" : "sopra il raster attivo";
    if (isImageNode(node)) {
      const sourceMiB = node.document.sourceBytes / MEBIBYTE_BYTES;
      this.status.textContent =
        `${node.name} · immagine ${placement} · ${node.document.width}×`
        + `${node.document.height} px · file ${sourceMiB.toFixed(2)} MiB · `
        + `texture/mipmap WebGPU · scala ${(node.scale * 100).toFixed(1)}% · `
        + `rotazione ${(node.rotation * 180 / Math.PI).toFixed(1)}° · ${timing}.`;
      return;
    }
    const outline = node.outlineWidth > 0
      ? `traccia ${Math.round(node.outlineWidth)} px ${OUTLINE_JOIN_LABELS[node.outlineJoin]}`
      : "traccia off";
    const blockShadow = node.blockShadowEnabled
      ? `Block Shadow GPU ${Math.round(node.blockShadowOffset)} @ ${Math.round(node.blockShadowAngle)}°`
      : "Block Shadow off";
    const singleShadow = node.singleShadowEnabled
      ? `ombra esterna ${Math.round(node.singleShadowOffset)} @ `
        + `${Math.round(node.singleShadowAngle)}° · blur ${Math.round(node.singleShadowBlur)}`
      : "ombra esterna off";
    const innerShadow = node.innerShadowEnabled
      ? `ombra interna ${Math.round(node.innerShadowOffset)} @ `
        + `${Math.round(node.innerShadowAngle)}° · blur ${Math.round(node.innerShadowBlur)}`
      : "ombra interna off";

    if (isSvgNode(node)) {
      const sourceMiB = node.document.sourceBytes / MEBIBYTE_BYTES;
      const cpuVectorMiB = node.document.logicalVectorBytes / MEBIBYTE_BYTES;
      this.status.textContent =
        `${node.name} · SVG semantico ${placement} · ${node.document.paints.length} colori · `
        + `${node.document.contourCount} contorni / ${node.document.commandCount} comandi · `
        + `file ${sourceMiB.toFixed(3)} MiB · vettori CPU ${cpuVectorMiB.toFixed(3)} MiB · `
        + `GPU attuale ${this.liveGpuMemoryMiB.toFixed(2)} MiB (${cacheLabel}; geometria, `
        + `matte blur e viewport conteggiati) · canvas browser `
        + `${viewportCanvasLogicalMiB.toFixed(2)} MiB · ${outline} · ${blockShadow} · `
        + `${singleShadow} · ${innerShadow} · ${VECTOR_SVG_IMPORT_STRATEGY} · `
        + `${effectLabel} · ${timing}.`;
      return;
    }

    const transformLabel = node.transformType === "none"
      ? "trasformazione off"
      : node.transformType === "distort"
        ? "Distort Kittl · 6 vertici + 4 maniglie"
        : node.transformType === "circle"
          ? `Circle Kittl ${Math.round(node.circleRadiusPercent)}%`
            + (node.circleInverted ? " invertito" : "")
          : `${node.transformType === "arch" ? "Arch" : "Wave"} Kittl `
            + `${Math.round(node.transformCurve)}%`;
    this.status.textContent =
      `${node.name} · testo semantico ${placement} · ${cacheLabel} `
      + `${this.liveGpuMemoryMiB.toFixed(2)} MiB · canvas browser `
      + `${viewportCanvasLogicalMiB.toFixed(2)} MiB · font vettoriali `
      + `${vectorFontLogicalMiB.toFixed(2)} MiB · ${transformLabel} · ${outline} · `
      + `${blockShadow} · ${singleShadow} · ${innerShadow} · ${effectLabel} · ${timing}.`;
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

  private localToLayer(point: Point, node: Readonly<VectorSceneNode>): Point {
    const scaledX = point.x * node.scale;
    const scaledY = point.y * node.scale;
    const cosine = Math.cos(node.rotation);
    const sine = Math.sin(node.rotation);
    return {
      x: node.x + cosine * scaledX - sine * scaledY,
      y: node.y + sine * scaledX + cosine * scaledY,
    };
  }

  private layerToLocal(point: Point, node: Readonly<VectorSceneNode>): Point {
    const deltaX = point.x - node.x;
    const deltaY = point.y - node.y;
    const cosine = Math.cos(node.rotation);
    const sine = Math.sin(node.rotation);
    const safeScale = Math.max(Number.EPSILON, Math.abs(node.scale));
    return {
      x: (cosine * deltaX + sine * deltaY) / safeScale,
      y: (-sine * deltaX + cosine * deltaY) / safeScale,
    };
  }

  private textCorners(
    view: VectorTextViewState,
    node: Readonly<VectorSceneNode>,
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
    node: Readonly<VectorSceneNode>,
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

  private renderTransformGuide(
    context: CanvasRenderingContext2D,
    view: VectorTextViewState,
    node: Readonly<VectorTextNode>,
  ): void {
    const guide = this.geometryForNode(node).outline.guide;
    if (!guide) {
      return;
    }
    const backingPerCssPixel = view.canvasWidth / Math.max(1, view.cssWidth);
    const lineWidth = Math.max(1, 1.25 * backingPerCssPixel);
    const markerRadius = Math.max(2, 3 * backingPerCssPixel);
    context.save();
    context.strokeStyle = "rgba(103, 126, 255, 0.92)";
    context.fillStyle = "#6f83ff";
    context.lineWidth = lineWidth;
    context.setLineDash([5 * backingPerCssPixel, 4 * backingPerCssPixel]);
    if (guide.kind === "curve") {
      const points = guide.points.map((point) =>
        this.layerToCanvas(this.localToLayer(point, node), view));
      context.beginPath();
      context.moveTo(points[0].x, points[0].y);
      for (let index = 1; index < points.length; index += 1) {
        context.lineTo(points[index].x, points[index].y);
      }
      context.stroke();
      context.setLineDash([]);
      for (const index of [0, 16, 32, 48, 64]) {
        const point = points[index];
        context.beginPath();
        context.arc(point.x, point.y, markerRadius, 0, Math.PI * 2);
        context.fill();
      }
    } else {
      const center = this.layerToCanvas(
        this.localToLayer({ x: guide.centerX, y: guide.centerY }, node),
        view,
      );
      const edge = this.layerToCanvas(
        this.localToLayer({
          x: guide.centerX + guide.radius,
          y: guide.centerY,
        }, node),
        view,
      );
      const radius = pointDistance(center, edge);
      context.beginPath();
      context.arc(center.x, center.y, radius, 0, Math.PI * 2);
      context.stroke();
      context.setLineDash([]);
      context.beginPath();
      context.arc(center.x, center.y, markerRadius, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  private distortCanvasPoints(
    view: VectorTextViewState,
    node: Readonly<VectorTextNode>,
  ): readonly Point[] {
    if (!node.distortPoints) {
      return [];
    }
    return node.distortPoints.map((point) =>
      this.layerToCanvas(this.localToLayer(point, node), view));
  }

  private renderDistortEditingOverlay(
    context: CanvasRenderingContext2D,
    view: VectorTextViewState,
    node: Readonly<VectorTextNode>,
  ): void {
    const points = this.distortCanvasPoints(view, node);
    if (points.length !== 10) {
      return;
    }
    const backingPerCssPixel = view.canvasWidth / Math.max(1, view.cssWidth);
    const lineWidth = Math.max(1, 1.25 * backingPerCssPixel);
    const anchorRadius = HANDLE_RADIUS_CSS_PX * backingPerCssPixel;
    const bezierRadius = Math.max(3, 5 * backingPerCssPixel);
    context.save();
    context.lineWidth = lineWidth;
    context.setLineDash([]);

    context.strokeStyle = "rgba(141, 154, 255, 0.7)";
    context.beginPath();
    context.moveTo(points[1].x, points[1].y);
    context.lineTo(points[6].x, points[6].y);
    context.moveTo(points[1].x, points[1].y);
    context.lineTo(points[7].x, points[7].y);
    context.moveTo(points[4].x, points[4].y);
    context.lineTo(points[8].x, points[8].y);
    context.moveTo(points[4].x, points[4].y);
    context.lineTo(points[9].x, points[9].y);
    context.stroke();

    context.strokeStyle = "#8d9aff";
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    context.bezierCurveTo(
      points[0].x,
      points[0].y,
      points[6].x,
      points[6].y,
      points[1].x,
      points[1].y,
    );
    context.bezierCurveTo(
      points[7].x,
      points[7].y,
      points[2].x,
      points[2].y,
      points[2].x,
      points[2].y,
    );
    context.lineTo(points[3].x, points[3].y);
    context.bezierCurveTo(
      points[3].x,
      points[3].y,
      points[9].x,
      points[9].y,
      points[4].x,
      points[4].y,
    );
    context.bezierCurveTo(
      points[8].x,
      points[8].y,
      points[5].x,
      points[5].y,
      points[5].x,
      points[5].y,
    );
    context.closePath();
    context.stroke();

    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      const radius = index < 6 ? anchorRadius : bezierRadius;
      context.fillStyle = index < 6 ? "#f7f8ff" : "#9aa6ff";
      context.beginPath();
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
    context.restore();
  }

  private renderInteractionOverlay(
    view: VectorTextViewState,
    node: Readonly<VectorSceneNode>,
  ): void {
    this.clearInteractionOverlay(view);
    const context = this.interactionContext;
    if (
      isTextNode(node)
      && node.transformType === "distort"
      && node.distortPoints
      && this.distortEditingNodeId === node.id
    ) {
      this.renderDistortEditingOverlay(context, view, node);
      return;
    }
    const corners = this.textCorners(view, node);
    const rotationHandle = this.rotationHandle(corners, view, node);
    const topCenter = {
      x: (corners[0].x + corners[1].x) * 0.5,
      y: (corners[0].y + corners[1].y) * 0.5,
    };
    const backingPerCssPixel = view.canvasWidth / Math.max(1, view.cssWidth);
    const lineWidth = Math.max(1, 1.25 * backingPerCssPixel);
    const handleRadius = HANDLE_RADIUS_CSS_PX * backingPerCssPixel;

    if (isTextNode(node)) this.renderTransformGuide(context, view, node);
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
    node: Readonly<VectorSceneNode>,
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

  private hitDistortPoint(
    point: Point,
    view: VectorTextViewState,
    node: Readonly<VectorTextNode>,
  ): number | null {
    const backingPerCssPixel = view.canvasWidth / Math.max(1, view.cssWidth);
    const hitRadius = HANDLE_HIT_RADIUS_CSS_PX * backingPerCssPixel;
    const controls = this.distortCanvasPoints(view, node);
    let closestIndex: number | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < controls.length; index += 1) {
      const distance = pointDistance(point, controls[index]);
      if (distance <= hitRadius && distance < closestDistance) {
        closestIndex = index;
        closestDistance = distance;
      }
    }
    return closestIndex;
  }

  private currentTouchNavigationGesture(): TouchNavigationGesture | null {
    if (this.touchContacts.size < 2) return null;
    const [first, second] = [...this.touchContacts.values()];
    const deltaX = second.x - first.x;
    const deltaY = second.y - first.y;
    return {
      centerX: (first.x + second.x) * 0.5,
      centerY: (first.y + second.y) * 0.5,
      distance: Math.max(1e-6, Math.hypot(deltaX, deltaY)),
      angle: Math.atan2(deltaY, deltaX),
    };
  }

  private restoreInteractionStart(interaction: ActiveInteraction): void {
    if (interaction.mode === "distort" && isTextNode(interaction.startModel)) {
      this.updateSelectedNode({ distortPoints: interaction.startModel.distortPoints });
      return;
    }
    if (interaction.mode !== "pan") {
      this.updateSelectedNode({
        x: interaction.startModel.x,
        y: interaction.startModel.y,
        scale: interaction.startModel.scale,
        rotation: interaction.startModel.rotation,
      });
    }
  }

  private clearActiveInteraction(interaction: ActiveInteraction): void {
    this.interactionCanvas.classList.remove(
      "is-move",
      "is-scale",
      "is-rotate",
      "is-pan",
      "is-distort",
    );
    if (this.activeInteraction === interaction) this.activeInteraction = null;
  }

  private closeNewNoopTransformSession(interaction: ActiveInteraction): void {
    if (!interaction.openedTransformSession || !this.transformSessionOpen) return;
    this.host.commitVectorHistoryEdit();
    this.transformSessionOpen = false;
    this.updateTransformCommitUi();
    this.syncControlsFromSelection(this.selectedVectorNode());
  }

  private enterTouchNavigation(): void {
    const interaction = this.activeInteraction;
    if (interaction) {
      this.restoreInteractionStart(interaction);
      this.clearActiveInteraction(interaction);
      this.closeNewNoopTransformSession(interaction);
    }
    if (!this.touchNavigationActive) {
      this.touchNavigationActive = true;
      this.host.beginViewRotationGesture();
    }
    this.touchNavigationGesture = this.currentTouchNavigationGesture();
  }

  private updateTouchNavigation(): void {
    const nextGesture = this.currentTouchNavigationGesture();
    const previousGesture = this.touchNavigationGesture;
    if (!nextGesture || !previousGesture) {
      this.touchNavigationGesture = nextGesture;
      return;
    }
    const deltaX = nextGesture.centerX - previousGesture.centerX;
    const deltaY = nextGesture.centerY - previousGesture.centerY;
    if (Math.abs(deltaX) > 0.01 || Math.abs(deltaY) > 0.01) {
      this.host.panByClientDelta(deltaX, deltaY);
    }
    const zoomFactor = nextGesture.distance / previousGesture.distance;
    if (Number.isFinite(zoomFactor) && Math.abs(zoomFactor - 1) > 0.0001) {
      this.host.zoomBy(
        Math.min(2, Math.max(0.5, zoomFactor)),
        nextGesture.centerX,
        nextGesture.centerY,
      );
    }
    const rawRotationDelta = nextGesture.angle - previousGesture.angle;
    const rotationDelta = Math.atan2(
      Math.sin(rawRotationDelta),
      Math.cos(rawRotationDelta),
    );
    if (Math.abs(rotationDelta) > 0.0001) {
      this.host.rotateViewBy(
        rotationDelta,
        nextGesture.centerX,
        nextGesture.centerY,
      );
    }
    this.touchNavigationGesture = nextGesture;
  }

  private onPointerDown(event: PointerEvent): void {
    const node = this.selectedVectorNode();
    if (!this.transformToolActive || !node) return;
    if (event.pointerType === "touch") {
      event.preventDefault();
      this.touchContacts.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this.interactionCanvas.setPointerCapture(event.pointerId);
      if (this.touchContacts.size >= 2) {
        this.enterTouchNavigation();
        return;
      }
    }
    if (this.touchNavigationActive) return;
    if (this.activeInteraction) return;
    const view = this.host.getVectorTextViewState();
    const canvasPoint = this.eventCanvasPoint(event);
    const layerPoint = this.eventLayerPoint(event);
    const textNode = isTextNode(node) ? node : null;
    const isDistortEditing = Boolean(
      textNode
      && textNode.transformType === "distort"
      && textNode.distortPoints !== null
      && this.distortEditingNodeId === textNode.id,
    );
    const corners = isDistortEditing ? [] : this.textCorners(view, node);
    const handle = isDistortEditing
      ? null
      : this.hitHandle(canvasPoint, corners, view, node);
    const distortPointIndex = isDistortEditing && textNode
      ? this.hitDistortPoint(canvasPoint, view, textNode)
      : null;
    const shouldPan = event.button === 1
      || event.button === 2
      || (!isDistortEditing && event.shiftKey);
    const mode: InteractionMode | null = shouldPan
      ? "pan"
      : isDistortEditing
        ? distortPointIndex === null ? null : "distort"
        : handle === "rotate"
          ? "rotate"
          : handle
            ? "scale"
            : pointInConvexPolygon(canvasPoint, corners)
              ? "move"
              : null;
    if (!mode) return;
    let openedTransformSession = false;
    if (mode !== "pan") {
      openedTransformSession = !this.transformSessionOpen;
      if (!this.host.beginVectorHistoryEdit("transform")) {
        return;
      }
      if (!this.transformSessionOpen) {
        this.transformSessionOpen = true;
        this.updateTransformCommitUi();
        this.syncControlsFromSelection(node);
      }
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
      distortPointIndex,
      openedTransformSession,
    };
    this.interactionCanvas.classList.add(`is-${mode}`);
  }
  private movedDistortPoints(
    interaction: ActiveInteraction,
    layerPoint: Point,
    lockAxis: boolean,
  ): VectorTextDistortPoints | null {
    if (!isTextNode(interaction.startModel)) return null;
    const startPoints = interaction.startModel.distortPoints;
    const pointIndex = interaction.distortPointIndex;
    if (!startPoints || pointIndex === null) {
      return null;
    }
    const startLocal = this.layerToLocal(
      interaction.startLayer,
      interaction.startModel,
    );
    const currentLocal = this.layerToLocal(layerPoint, interaction.startModel);
    let deltaX = currentLocal.x - startLocal.x;
    let deltaY = currentLocal.y - startLocal.y;
    if (lockAxis) {
      if (Math.abs(deltaX) >= Math.abs(deltaY)) {
        deltaY = 0;
      } else {
        deltaX = 0;
      }
    }
    return moveVectorTextDistortPoint(
      startPoints,
      pointIndex,
      {
        x: startPoints[pointIndex].x + deltaX,
        y: startPoints[pointIndex].y + deltaY,
      },
    );
  }

  private onPointerMove(event: PointerEvent): void {
    if (event.pointerType === "touch" && this.touchContacts.has(event.pointerId)) {
      this.touchContacts.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.touchNavigationActive) {
        event.preventDefault();
        this.updateTouchNavigation();
        return;
      }
    }
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
    if (interaction.mode === "distort") {
      const distortPoints = this.movedDistortPoints(
        interaction,
        layerPoint,
        event.shiftKey,
      );
      if (distortPoints && isTextNode(interaction.startModel)) {
        this.host.updateVectorTextNode(interaction.startModel.id, { distortPoints });
      }
      return;
    }
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
    const hadTouchContact = event.pointerType === "touch"
      && this.touchContacts.delete(event.pointerId);
    if (hadTouchContact && this.touchNavigationActive) {
      event.preventDefault();
      if (this.touchContacts.size < 2) {
        this.touchNavigationActive = false;
        this.touchNavigationGesture = null;
        this.host.endViewRotationGesture();
      } else {
        this.touchNavigationGesture = this.currentTouchNavigationGesture();
      }
      return;
    }
    const interaction = this.activeInteraction;
    if (!interaction || event.pointerId !== interaction.pointerId) {
      return;
    }
    this.clearActiveInteraction(interaction);
    if (
      interaction.mode !== "pan"
      && (event.type === "pointercancel" || event.type === "lostpointercapture")
    ) {
      this.restoreInteractionStart(interaction);
      this.closeNewNoopTransformSession(interaction);
    }
    this.scheduleRender();
  }
}
