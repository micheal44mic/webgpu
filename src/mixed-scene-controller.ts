import type {
  LayerFormat,
  MixedSceneSnapshot,
  RasterTransformSnapshot,
} from "./engine-types";
import type { MergeMixedSceneItemsRequest } from "./layer-merge-core";
import type { LayerMergeResult } from "./engine-layer-merge-runtime";
import {
  MIXED_SCENE_STACK_STRATEGY,
  type MixedSceneItem,
} from "./mixed-scene-stack";
import {
  VECTOR_TEXT_BLOCK_SHADOW_STRATEGY,
  VECTOR_TEXT_INNER_SHADOW_STRATEGY,
  VECTOR_TEXT_OUTLINE_STRATEGY,
  VECTOR_TEXT_SINGLE_SHADOW_STRATEGY,
  vectorTextBlockShadowLocalVector,
  vectorTextInnerShadowLocalVector,
  vectorTextSingleShadowLocalVector,
  type VectorTextOutlineJoin,
} from "./scene-vector-effects";
import {
  cloneVectorTextNode,
  type VectorTextNode,
  type VectorTextNodeSeed,
} from "./scene-text-model";
import {
  cloneVectorSvgNode,
  type VectorSvgNode,
  type VectorSvgNodeSeed,
} from "./scene-svg-model";
import type { RasterImageNode } from "./scene-image-model";

import {
  VECTOR_TEXT_PRESENTATION_STRATEGY,
} from "./vector-text-shader";
import type {
  VectorTextGpuDraw,
  VectorTextGpuGradient,
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
import {
  VECTOR_TEXT_ADAPTIVE_ZOOM_SETTLE_MS,
  VECTOR_TEXT_ADAPTIVE_ZOOM_STRATEGY,
  vectorTextExactRecoveryIsCurrent,
  vectorTextWideFallbackView,
} from "./vector-text-adaptive-zoom";
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
import type {
  VectorEffectEditorPatch,
  VectorEffectEditorSnapshot,
  VectorShadowKind,
  VectorTextEditorPatch,
  VectorTextEditorSnapshot,
  VectorTransformActionSnapshot,
} from "./vector-editor-contract";
import {
  closestSceneControlPoint,
  hitSceneTransformHandle,
  hitsSceneTransformBody,
  sceneLayerToLocal,
  scenePointDistance,
  scenePointInPolygon,
  scenePointToSegmentDistance,
  type SceneLocalBounds,
  type ScenePoint,
  type SceneTransformHandle,
} from "./scene-transform-geometry";
import { adaptiveCanvasGridStep } from "./canvas-guides-renderer";
import {
  resolveSceneRotationSnap,
  resolveSceneScaleSnap,
  resolveSceneTranslationSnap,
  sceneIndexedSnapTargets,
  sceneBoundsSnapTargets,
  sceneDocumentSnapTargets,
  scenePointCloudBounds,
  sceneTransformedAxisAlignedBounds,
  sceneWrappedAngleDelta,
  type SceneAxisAlignedBounds,
  type SceneRotationSnapLatch,
  type SceneScaleSnapLatch,
  type SceneSnapLatch,
  type SceneSnapTarget,
  type SceneSnapTargetIndex,
} from "./scene-transform-snap";
import {
  gpuLinearColor,
  sameGpuLinearColor,
  svgGradientGpuData,
} from "./scene-gpu-paint";
import {
  copyTransformNode,
  isImageNode,
  isRasterLayerTransformNode,
  isSvgNode,
  isTextNode,
  transformNodeKey,
  vectorNodeKey,
  type TransformSceneNode,
  type VectorDrawableNode,
  type VectorSceneNode,
  type VectorSceneNodeUpdate,
} from "./mixed-scene-node";
import {
  clearSceneInteractionOverlay,
  renderSceneInteractionOverlay,
  sceneDistortCanvasPoints,
  sceneOverlayCorners,
  sceneOverlayRotationHandle,
  sceneRasterDeformBoundaryCanvasPoints,
  sceneRasterDeformCanvasPoints,
  sceneRasterWarpBezierCanvasHandles,
  SCENE_TRANSFORM_CORNER_HIT_RADIUS_CSS_PX,
  SCENE_TRANSFORM_HIT_RADIUS_CSS_PX,
} from "./scene-interaction-overlay";
import {
  isRasterWarpGridSize,
  moveRasterWarpBezierHandle,
  moveRasterWarpControlPoints,
  rasterDeformGridSize,
  rasterWarpClosestSurfaceParameter,
  rasterWarpCornerIndices,
  remapRasterWarpBezierHandles,
  type RasterTransformControlPoint,
  type RasterTransformMode,
  type RasterWarpSurfaceParameter,
} from "./raster-deform-math";
import type {
  MixedSceneControllerOptions,
  MixedSceneDiagnostics,
  MixedSceneHost,
  VectorRasterHistoryGpuProbe,
  VectorRasterHistoryGpuTestReport,
  VectorRasterizationResult,
  VectorTextClippedRefreshPolicy,
} from "./mixed-scene-controller-contract";

export type {
  MixedSceneControllerOptions,
  MixedSceneDiagnostics,
  MixedSceneHost,
  VectorRasterHistoryGpuProbe,
  VectorRasterHistoryGpuTestReport,
  VectorRasterizationResult,
  VectorTextClippedRefreshPolicy,
} from "./mixed-scene-controller-contract";

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

type InteractionMode =
  | "move"
  | "scale"
  | "rotate"
  | "pan"
  | "distort"
  | "raster-control";

interface ActiveSnapContext {
  readonly startBounds: SceneAxisAlignedBounds;
  readonly localBounds: SceneLocalBounds;
  readonly targets: SceneSnapTargetIndex;
  readonly gridStep: number | null;
  readonly handle: SceneTransformHandle | null;
  translationLatch: SceneSnapLatch;
  scaleLatch: SceneScaleSnapLatch | null;
  rotationLatch: SceneRotationSnapLatch | null;
}

interface ActiveInteraction {
  pointerId: number;
  mode: InteractionMode;
  startClient: ScenePoint;
  startLayer: ScenePoint;
  startModel: TransformSceneNode;
  startDistance: number;
  startAngle: number;
  lastAngle: number;
  accumulatedRotation: number;
  distortPointIndex: number | null;
  rasterControlPointIndex: number | null;
  rasterBezierHandleIndex: number | null;
  rasterWarpAnchorParameter: RasterWarpSurfaceParameter | null;
  openedTransformSession: boolean;
  snap: ActiveSnapContext | null;
}

interface TouchNavigationGesture {
  centerX: number;
  centerY: number;
  distance: number;
  angle: number;
}

const MEBIBYTE_BYTES = 1024 * 1024;
const MINIMUM_SCALE = 0.05;
const MAXIMUM_SCALE = 20;
const FRAME_SAMPLE_LIMIT = 180;
const OUTLINE_JOIN_LABELS: Readonly<Record<VectorTextOutlineJoin, string>> = {
  bevel: "bevel",
  miter: "miter",
  round: "round",
};

function requiredElement<ElementType extends HTMLElement>(
  root: ParentNode,
  id: string,
): ElementType {
  const rootElement = root as ParentNode & Partial<HTMLElement>;
  const found = rootElement.id === id
    ? rootElement as HTMLElement
    : root.querySelector<HTMLElement>(`#${id}`);
  if (!found) {
    throw new Error(`Element #${id} is missing from the text/raster scene.`);
  }
  return found as ElementType;
}

function vectorRasterFormatLabel(format: LayerFormat): string {
  return format === "rgba16float" ? "linear RGBA16F" : "linear RGBA8";
}

function uint8ArraysEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function countNonZeroRgba16fAlpha(pixels: Uint8Array): number {
  if (pixels.byteLength % 8 !== 0) return 0;
  let count = 0;
  for (let offset = 6; offset < pixels.byteLength; offset += 8) {
    const alphaBits = pixels[offset] | (pixels[offset + 1] << 8);
    count += Number((alphaBits & 0x7fff) !== 0);
  }
  return count;
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) {
    return 0;
  }
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.floor((ordered.length - 1) * ratio))];
}

export class MixedSceneController {
  private readonly host: MixedSceneHost;
  private readonly browser: Window;
  private readonly presentationCanvas: HTMLCanvasElement;
  private readonly interactionCanvas: HTMLCanvasElement;
  private readonly textRasterStatus: HTMLElement;
  private readonly svgFileInput: HTMLInputElement;
  private readonly svgImportStatus: HTMLElement;
  private readonly imageFileInput: HTMLInputElement;
  private readonly imageImportStatus: HTMLElement;
  private readonly transformCommitBar: HTMLElement;
  private readonly transformCommitLabel: HTMLElement;
  private readonly transformApplyButton: HTMLButtonElement;
  private readonly transformCancelButton: HTMLButtonElement;
  private readonly rasterTransformGridControls: HTMLElement[];
  private readonly rasterTransformGridButtons: HTMLButtonElement[];
  private readonly status: HTMLElement;

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
  private adaptiveZoomEnabled = true;
  private readonly clippedRefreshPolicy: VectorTextClippedRefreshPolicy;
  private readonly onEditorStateChange: (() => void) | undefined;
  private readonly canvasGuides: MixedSceneControllerOptions["canvasGuides"];
  private zoomRenderMode: "precise" | "fast" = "precise";
  private viewGestureActive = false;
  private viewRevision = 0;
  private viewIdleTimer: number | null = null;
  private exactRecoveryRequest: number | null = null;
  private pendingExactRecoveryRevision: number | null = null;
  private unsafeExactRefreshRequest: number | null = null;
  private fastOverlayRequest: number | null = null;
  private unsafeExactRefreshInFlight = false;
  private unsafeExactRefreshRevision = 0;
  private exitFastAfterScheduledRender = false;
  private zoomFastActivationCount = 0;
  private zoomExactRecoveryCount = 0;
  private zoomViewEventCount = 0;
  private zoomSafeReprojectionCount = 0;
  private zoomFallbackReprojectionCount = 0;
  private zoomClippedReprojectionCount = 0;
  private zoomUnsafeExactRefreshCount = 0;
  private zoomUnsafeExactRefreshCompletedCount = 0;
  private zoomUnsafeExactCoalescedCount = 0;
  private lastExactCanvasWidth = 0;
  private lastExactCanvasHeight = 0;
  private fallbackPresentationDirty = true;
  private fallbackPresentationGpuMemoryMiB = 0;
  private fallbackPresentationRebuildCount = 0;
  private atomicEffectHoldCount = 0;
  private atomicEffectPendingNodes = 0;
  private distortEditingNodeId: number | null = null;
  private transformToolActive = false;
  private rasterTransformToolMode: RasterTransformMode = "affine";
  private transformSessionOpen = false;
  private transformSessionKind: "vector" | "raster" | null = null;
  private rasterTransformPreparing = false;
  private rasterTransformRecoveryOnly = false;
  private transformCommitBusy = false;
  private readonly touchContacts = new Map<number, ScenePoint>();
  private touchNavigationGesture: TouchNavigationGesture | null = null;
  private touchNavigationActive = false;

  constructor(
    host: MixedSceneHost,
    options: MixedSceneControllerOptions,
  ) {
    this.host = host;
    this.browser = options.browser;
    this.presentationCanvas = requiredElement<HTMLCanvasElement>(
      options.root,
      "vectorTextPresentationCanvas",
    );
    this.interactionCanvas = requiredElement<HTMLCanvasElement>(
      options.root,
      "vectorTextInteractionCanvas",
    );
    this.textRasterStatus = requiredElement<HTMLElement>(
      options.root,
      "vectorTextRasterStatus",
    );
    this.svgFileInput = requiredElement<HTMLInputElement>(options.root, "vectorSvgFileInput");
    this.svgImportStatus = requiredElement<HTMLElement>(options.root, "vectorSvgImportStatus");
    this.imageFileInput = requiredElement<HTMLInputElement>(options.root, "rasterImageFileInput");
    this.imageImportStatus = requiredElement<HTMLElement>(options.root, "rasterImageImportStatus");
    this.transformCommitBar = requiredElement<HTMLElement>(options.root, "transformCommitBar");
    this.transformCommitLabel = requiredElement<HTMLElement>(options.root, "transformCommitLabel");
    this.transformApplyButton = requiredElement<HTMLButtonElement>(options.root, "transformApply");
    this.transformCancelButton = requiredElement<HTMLButtonElement>(options.root, "transformCancel");
    this.rasterTransformGridControls = [
      ...options.root.querySelectorAll<HTMLElement>("[data-raster-transform-grid-controls]"),
    ];
    this.rasterTransformGridButtons = [
      ...options.root.querySelectorAll<HTMLButtonElement>("[data-raster-transform-grid]"),
    ];
    this.status = requiredElement<HTMLElement>(options.root, "vectorTextStatus");
    this.clippedRefreshPolicy = options.clippedRefreshPolicy ?? "during-gesture";
    this.onEditorStateChange = options.onEditorStateChange;
    this.canvasGuides = options.canvasGuides;
    const interactionContext = this.interactionCanvas.getContext("2d", {
      alpha: true,
      desynchronized: true,
    });
    if (!interactionContext) {
      throw new Error("Canvas2D is unavailable for the text interaction overlay.");
    }
    this.interactionContext = interactionContext;
    this.effectCompiler = new VectorTextEffectCompilerClient(() => {
      this.handleEffectResourceReady();
    });
  }

  get isBusy(): boolean {
    return this.sceneOperationBusy;
  }

  async initialize(): Promise<void> {
    await this.fontGeometry.preload();
    this.presentationCanvas.width = 1;
    this.presentationCanvas.height = 1;
    this.presentationCanvas.hidden = true;
    this.bindControls();
    const initialSnapshot = this.host.getMixedSceneSnapshot();
    if (!initialSnapshot) {
      throw new Error("The engine did not create the mixed scene.");
    }
    this.syncScene(initialSnapshot);
  }

  setTransformToolActive(
    active: boolean,
    mode: RasterTransformMode = "affine",
  ): void {
    if (!active && this.transformSessionOpen) {
      return;
    }
    this.rasterTransformToolMode = mode;
    if (active) {
      const latestSnapshot = this.host.getMixedSceneSnapshot();
      if (latestSnapshot) this.syncScene(latestSnapshot);
    }
    this.transformToolActive = active;
    const hasSelection = this.selectedTransformNode() !== null;
    this.interactionCanvas.hidden = !active || !hasSelection;
    this.interactionCanvas.classList.toggle("is-editing", active && hasSelection);
    this.interactionCanvas.setAttribute(
      "aria-hidden",
      String(!active || !hasSelection),
    );
    this.updateTransformCommitUi();
    this.scheduleRender();
    if (!active) {
      this.canvasGuides?.setSmartGuides([]);
      return;
    }
    const node = this.selectedTransformNode();
    if (
      this.transformSessionOpen
      && this.transformSessionKind === "raster"
      && node
      && isRasterLayerTransformNode(node)
      && node.scope === "layer"
      && node.mode !== mode
    ) {
      try {
        this.host.updateRasterLayerTransform({ mode });
        this.scheduleRender();
      } catch (error) {
        this.status.textContent = error instanceof Error ? error.message : String(error);
      }
      return;
    }
    void this.prepareSelectedRasterTransform();
  }

  private updateTransformCommitUi(): void {
    const node = this.selectedTransformNode();
    const rasterNode = node && isRasterLayerTransformNode(node) && node.scope === "layer"
      ? node
      : null;
    const movesPixelSelection = Boolean(
      this.transformToolActive
      && node
      && isRasterLayerTransformNode(node)
      && node.scope === "selection",
    );
    this.transformCommitBar.hidden = !this.transformSessionOpen;
    const toolLabel = this.rasterTransformToolMode === "warp"
      ? "Warp"
      : this.rasterTransformToolMode === "perspective"
        ? "Perspective"
        : "Transform";
    this.transformCommitLabel.textContent = movesPixelSelection
      ? "Move selection"
      : toolLabel;
    this.transformCommitBar.setAttribute(
      "aria-label",
      movesPixelSelection
        ? "Confirm selection move"
        : `Confirm ${toolLabel}`,
    );
    this.interactionCanvas.tabIndex = movesPixelSelection ? 0 : -1;
    this.interactionCanvas.classList.toggle("is-pixel-selection", movesPixelSelection);
    this.interactionCanvas.setAttribute(
      "aria-label",
      movesPixelSelection
        ? "Move pixel selection"
        : "Select and transform elements",
    );
    if (movesPixelSelection) {
      this.interactionCanvas.setAttribute("aria-describedby", "pixelSelectionMoveHelp");
    } else {
      this.interactionCanvas.removeAttribute("aria-describedby");
      this.interactionCanvas.style.removeProperty("cursor");
    }
    this.transformApplyButton.disabled =
      this.transformCommitBusy || this.rasterTransformRecoveryOnly;
    this.transformCancelButton.disabled = this.transformCommitBusy;
    const rasterControlsVisible = Boolean(
      this.transformToolActive
      && rasterNode
      && this.rasterTransformToolMode === "warp",
    );
    const rasterControlsDisabled = !rasterControlsVisible
      || !this.transformSessionOpen
      || this.transformSessionKind !== "raster"
      || this.transformCommitBusy
      || this.rasterTransformRecoveryOnly;
    for (const controls of this.rasterTransformGridControls) {
      controls.hidden = !rasterControlsVisible;
    }
    for (const button of this.rasterTransformGridButtons) {
      button.disabled = rasterControlsDisabled || rasterNode?.mode !== "warp";
      button.setAttribute(
        "aria-pressed",
        String(Number(button.dataset.rasterTransformGrid) === (rasterNode?.gridSize ?? 3)),
      );
    }
    this.onEditorStateChange?.();
  }

  private rasterTransformSessionStillOpen(): boolean {
    const snapshot = this.host.getMixedSceneSnapshot();
    if (!snapshot) return false;
    const selected = snapshot.items.find((item) => item.key === snapshot.selectedKey);
    return selected?.kind === "raster" && selected.rasterTransform !== null;
  }

  private async applyTransformSession(): Promise<boolean> {
    if (
      !this.transformSessionOpen
      || this.transformCommitBusy
      || this.activeInteraction
      || this.rasterTransformRecoveryOnly
    ) return false;
    const rasterSession = this.transformSessionKind === "raster";
    let applied = false;
    this.transformCommitBusy = true;
    this.updateTransformCommitUi();
    try {
      if (rasterSession) {
        await this.host.commitRasterLayerTransform();
      } else {
        this.host.commitVectorHistoryEdit();
      }
      this.transformSessionOpen = false;
      this.transformSessionKind = null;
      this.rasterTransformRecoveryOnly = false;
      applied = true;
    } catch (error) {
      // A successful rollback closes the GPU transaction; a failed rollback
      // deliberately retains the immutable scratch for a recovery-only Cancel.
      if (rasterSession) {
        const retained = this.rasterTransformSessionStillOpen();
        this.transformSessionOpen = retained;
        this.transformSessionKind = retained ? "raster" : null;
        this.rasterTransformRecoveryOnly = retained;
      }
      this.status.textContent = error instanceof Error
        ? `Could not apply Transform: ${error.message}`
        : "Could not apply Transform.";
    } finally {
      this.transformCommitBusy = false;
      this.updateTransformCommitUi();
      this.syncControlsFromSelection(this.selectedVectorNode());
      this.scheduleRender();
    }
    return applied;
  }

  private async cancelTransformSession(): Promise<boolean> {
    if (!this.transformSessionOpen || this.transformCommitBusy || this.activeInteraction) {
      return false;
    }
    const rasterSession = this.transformSessionKind === "raster";
    let cancelledSuccessfully = false;
    this.transformCommitBusy = true;
    this.updateTransformCommitUi();
    try {
      const cancelled = rasterSession
        ? await this.host.cancelRasterLayerTransform()
        : await this.host.cancelVectorHistoryEdit();
      if (!cancelled) {
        throw new Error("There is no open transform to cancel.");
      }
      this.transformSessionOpen = false;
      this.transformSessionKind = null;
      this.rasterTransformRecoveryOnly = false;
      cancelledSuccessfully = true;
    } catch (error) {
      if (rasterSession) {
        const retained = this.rasterTransformSessionStillOpen();
        this.transformSessionOpen = retained;
        this.transformSessionKind = retained ? "raster" : null;
        this.rasterTransformRecoveryOnly = retained;
      }
      this.status.textContent = error instanceof Error
        ? `Could not cancel Transform: ${error.message}`
        : "Could not cancel Transform.";
    } finally {
      this.transformCommitBusy = false;
      this.updateTransformCommitUi();
      this.syncControlsFromSelection(this.selectedVectorNode());
      this.scheduleRender();
    }
    return cancelledSuccessfully;
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
    if (!imageTransformOnly) {
      this.host.clearVectorTextFallbackPresentation();
      this.fallbackPresentationDirty = true;
      this.fallbackPresentationGpuMemoryMiB = 0;
      this.viewRevision += 1;
      this.cancelAdaptiveZoomTimers();
      if (this.unsafeExactRefreshRequest !== null) {
        this.browser.cancelAnimationFrame(this.unsafeExactRefreshRequest);
        this.unsafeExactRefreshRequest = null;
      }
      if (this.zoomRenderMode === "fast") {
        // Keep sampling the captured camera until this semantic exact render
        // has submitted all run textures. renderNow disables fast only after
        // pruneVectorTextGpuMeshes() flushes that authoritative batch.
        this.exitFastAfterScheduledRender = true;
      }
    }
    const interaction = this.activeInteraction;
    const interactionStillTargetsSelection =
      interaction !== null
      && snapshot.selectedKey === transformNodeKey(interaction.startModel);
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
      this.canvasGuides?.setSmartGuides([]);
      this.interactionCanvas.classList.remove(
        "is-move",
        "is-scale",
        "is-rotate",
        "is-pan",
        "is-distort",
        "is-raster-control",
      );
    }
    const node = this.selectedVectorNode();
    const transformNode = this.selectedTransformNode();
    const textNode = node && isTextNode(node) ? node : null;
    const transformSelected = transformNode !== null;
    if (
      !textNode
      || textNode.id !== this.distortEditingNodeId
      || textNode.transformType !== "distort"
      || !textNode.distortPoints
    ) {
      this.distortEditingNodeId = null;
    }
    this.interactionCanvas.hidden = !this.transformToolActive || !transformSelected;
    this.interactionCanvas.classList.toggle(
      "is-editing",
      this.transformToolActive && transformSelected,
    );
    this.interactionCanvas.classList.toggle(
      "is-distort-editing",
      this.distortEditingNodeId !== null,
    );
    this.interactionCanvas.setAttribute(
      "aria-hidden",
      String(!this.transformToolActive || !transformSelected),
    );
    this.updateTransformCommitUi();
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
      else clearSceneInteractionOverlay(this.interactionContext, view);
      this.updateStatus(view, node);
    } else {
      this.scheduleRender();
    }
    if (this.transformToolActive) void this.prepareSelectedRasterTransform();
  }
  scheduleViewSync(): void {
    this.viewRevision += 1;
    this.zoomViewEventCount += 1;
    if (!this.hasVectorPresentationNodes() || !this.adaptiveZoomEnabled) {
      this.cancelAdaptiveZoomTimers();
      if (this.zoomRenderMode === "fast") {
        this.exitFastAfterScheduledRender = true;
      }
      this.markPendingViewRender();
      this.scheduleRender();
      return;
    }

    const view = this.host.getVectorTextViewState();
    const canvasSizeChanged = this.lastExactCanvasWidth > 0
      && (
        view.canvasWidth !== this.lastExactCanvasWidth
        || view.canvasHeight !== this.lastExactCanvasHeight
      );
    if (canvasSizeChanged) {
      // A viewport-sized capture cannot cover a resized target. Keep resize on
      // the precise path; view gestures themselves never allocate a new cache.
      this.cancelAdaptiveZoomTimers();
      if (this.zoomRenderMode === "fast") {
        this.exitFastAfterScheduledRender = true;
      }
      this.markPendingViewRender();
      this.scheduleRender();
      return;
    }

    if (!this.enterFastZoomMode()) {
      this.markPendingViewRender();
      this.scheduleRender();
      return;
    }
    const presentationMode = this.host.getVectorTextFastPresentationMode();
    if (presentationMode === "reproject") {
      this.zoomSafeReprojectionCount += 1;
    } else if (presentationMode === "reproject-fallback") {
      this.zoomFallbackReprojectionCount += 1;
    } else if (presentationMode === "reproject-clipped") {
      this.zoomClippedReprojectionCount += 1;
      if (this.clippedRefreshPolicy === "during-gesture") {
        this.requestUnsafeExactRefresh(this.viewRevision);
      }
    }
    this.scheduleFastInteractionOverlay();
    if (!this.viewGestureActive) {
      this.armViewIdleTimer(this.viewRevision);
    }
  }

  beginViewGesture(): void {
    this.viewGestureActive = true;
    this.viewRevision += 1;
    this.cancelAdaptiveZoomTimers();
    if (this.adaptiveZoomEnabled && this.hasVectorPresentationNodes()) {
      this.enterFastZoomMode();
    }
  }

  endViewGesture(): void {
    if (!this.viewGestureActive) return;
    this.viewGestureActive = false;
    if (this.zoomRenderMode === "fast") {
      this.requestExactRecovery(this.viewRevision);
    }
  }

  private hasVectorPresentationNodes(): boolean {
    return this.snapshot?.items.some(
      (item) => item.kind === "text" || item.kind === "svg",
    ) ?? false;
  }

  private clearViewIdleTimer(): void {
    if (this.viewIdleTimer !== null) {
      this.browser.clearTimeout(this.viewIdleTimer);
      this.viewIdleTimer = null;
    }
  }

  private cancelExactRecovery(): void {
    if (this.exactRecoveryRequest !== null) {
      this.browser.cancelAnimationFrame(this.exactRecoveryRequest);
      this.exactRecoveryRequest = null;
    }
    this.pendingExactRecoveryRevision = null;
  }

  private cancelAdaptiveZoomTimers(): void {
    this.clearViewIdleTimer();
    this.cancelExactRecovery();
  }

  private armViewIdleTimer(revision: number): void {
    this.clearViewIdleTimer();
    this.viewIdleTimer = this.browser.setTimeout(() => {
      this.viewIdleTimer = null;
      if (vectorTextExactRecoveryIsCurrent(
        revision,
        this.viewRevision,
        this.viewGestureActive,
      )) {
        this.requestExactRecovery(revision);
      }
    }, VECTOR_TEXT_ADAPTIVE_ZOOM_SETTLE_MS);
  }

  private enterFastZoomMode(): boolean {
    this.cancelExactRecovery();
    if (this.zoomRenderMode === "fast") return true;
    this.host.setVectorTextFastPresentationEnabled(true);
    if (this.host.getVectorTextFastPresentationMode() === "precise") {
      return false;
    }
    this.zoomRenderMode = "fast";
    this.zoomFastActivationCount += 1;
    return true;
  }

  private finishFastZoomMode(): void {
    if (this.zoomRenderMode !== "fast") return;
    this.zoomRenderMode = "precise";
    this.zoomExactRecoveryCount += 1;
    this.cancelAdaptiveZoomTimers();
    this.host.setVectorTextFastPresentationEnabled(false);
    this.effectReadyRenderPending = false;
  }

  private requestExactRecovery(revision: number): void {
    this.cancelExactRecovery();
    if (this.unsafeExactRefreshInFlight) {
      this.pendingExactRecoveryRevision = revision;
      return;
    }
    if (this.unsafeExactRefreshRequest !== null) {
      this.browser.cancelAnimationFrame(this.unsafeExactRefreshRequest);
      this.unsafeExactRefreshRequest = null;
    }
    this.exactRecoveryRequest = this.browser.requestAnimationFrame(() => {
      this.exactRecoveryRequest = null;
      if (
        this.zoomRenderMode !== "fast"
        || !vectorTextExactRecoveryIsCurrent(
          revision,
          this.viewRevision,
          this.viewGestureActive,
        )
      ) {
        return;
      }
      this.markPendingViewRender();
      if (!this.renderNow("recovery", revision)) {
        this.exitFastAfterScheduledRender = true;
      }
    });
  }

  private requestUnsafeExactRefresh(revision: number): void {
    this.unsafeExactRefreshRevision = Math.max(
      this.unsafeExactRefreshRevision,
      revision,
    );
    if (this.unsafeExactRefreshInFlight || this.unsafeExactRefreshRequest !== null) {
      this.zoomUnsafeExactCoalescedCount += 1;
      return;
    }
    this.unsafeExactRefreshRequest = this.browser.requestAnimationFrame(() => {
      this.unsafeExactRefreshRequest = null;
      const targetRevision = this.unsafeExactRefreshRevision;
      if (
        this.zoomRenderMode !== "fast"
        || targetRevision !== this.viewRevision
        || this.host.getVectorTextFastPresentationMode() !== "reproject-clipped"
      ) {
        return;
      }
      this.unsafeExactRefreshInFlight = true;
      this.zoomUnsafeExactRefreshCount += 1;
      this.markPendingViewRender();
      const rendered = this.renderNow("unsafe-refresh", targetRevision);
      if (!rendered) {
        this.unsafeExactRefreshInFlight = false;
        this.requestUnsafeExactRefresh(this.viewRevision);
        return;
      }
      void this.host.waitForVectorTextPresentationCompletion().then(() => {
        this.zoomUnsafeExactRefreshCompletedCount += 1;
        this.unsafeExactRefreshInFlight = false;
        const pendingRecovery = this.pendingExactRecoveryRevision;
        this.pendingExactRecoveryRevision = null;
        if (
          pendingRecovery !== null
          && vectorTextExactRecoveryIsCurrent(
            pendingRecovery,
            this.viewRevision,
            this.viewGestureActive,
          )
        ) {
          this.requestExactRecovery(pendingRecovery);
          return;
        }
        if (
          this.zoomRenderMode === "fast"
          && this.host.getVectorTextFastPresentationMode() === "reproject-clipped"
        ) {
          this.requestUnsafeExactRefresh(this.viewRevision);
        }
      }).catch(() => {
        // Device loss is reported by the engine. This completion signal is a
        // backpressure gate only, never GPU-duration telemetry.
        this.unsafeExactRefreshInFlight = false;
      });
    });
  }

  private scheduleFastInteractionOverlay(): void {
    if (this.fastOverlayRequest !== null) return;
    this.fastOverlayRequest = this.browser.requestAnimationFrame(() => {
      this.fastOverlayRequest = null;
      if (this.zoomRenderMode !== "fast") return;
      const view = this.host.getVectorTextViewState();
      this.syncCanvasSizes(view);
      const selectedNode = this.selectedTransformNode();
      if (selectedNode) {
        if (isTextNode(selectedNode)) this.metrics = this.measureText(selectedNode);
        else if (isSvgNode(selectedNode)) {
          this.metrics = {
            left: selectedNode.document.bounds.left,
            top: selectedNode.document.bounds.top,
            right: selectedNode.document.bounds.right,
            bottom: selectedNode.document.bounds.bottom,
            baseline: 0,
          };
        }
        if (this.transformToolActive) this.renderInteractionOverlay(view, selectedNode);
      } else {
        clearSceneInteractionOverlay(this.interactionContext, view);
      }
    });
  }

  requestSvgImport(): void {
    if (this.sceneOperationBusy || this.transformSessionOpen) return;
    this.svgFileInput.click();
  }

  requestRasterImageImport(): void {
    if (this.sceneOperationBusy || this.transformSessionOpen) return;
    this.imageFileInput.click();
  }

  applyTransform(): Promise<boolean> {
    if (!this.transformSessionOpen) return Promise.resolve(true);
    return this.applyTransformSession();
  }

  cancelTransform(): Promise<boolean> {
    if (!this.transformSessionOpen) return Promise.resolve(true);
    return this.cancelTransformSession();
  }

  createText(color?: string): void {
    if (this.sceneOperationBusy || this.transformSessionOpen) return;
    void this.runSceneOperation(async () => {
      const textCount =
        this.snapshot?.items.filter((item) => item.kind === "text").length ?? 0;
      await this.host.addVectorTextNode(
        this.defaultSeed(textCount, color),
        `Text ${textCount + 1}`,
      );
    });
  }

  deleteSelectedText(): void {
    const node = this.selectedTextNode();
    if (!node || this.sceneOperationBusy || this.transformSessionOpen) return;
    void this.runSceneOperation(async () => {
      await this.host.deleteVectorTextNode(node.id);
    });
  }

  resetSelectedText(): void {
    const node = this.selectedTextNode();
    if (!node || this.sceneOperationBusy || this.transformSessionOpen) return;
    this.updateSelectedNode(this.defaultSeed(Math.max(0, node.id - 1), node.color));
  }

  setSelectedSvgPaintColor(index: number, color: string): void {
    if (this.sceneOperationBusy || this.transformSessionOpen) return;
    if (!Number.isInteger(index) || !/^#[0-9a-f]{6}$/i.test(color)) return;
    const node = this.selectedSvgNode();
    if (!node || index < 0 || index >= node.paintColors.length) return;
    const normalizedColor = color.toLowerCase();
    if (node.paintColors[index]?.toLowerCase() === normalizedColor) return;
    const paintColors = [...node.paintColors];
    paintColors[index] = normalizedColor;
    this.updateSelectedNode({ paintColors });
  }

  rasterizeSelectedSvgNode(): void {
    if (!this.selectedSvgNode() || this.sceneOperationBusy || this.transformSessionOpen) return;
    void this.rasterizeSelectedSvg();
  }

  async rasterizeSelectedSvgLayer(): Promise<VectorRasterizationResult | null> {
    if (this.transformSessionOpen) {
      throw new Error("Apply or cancel the SVG transform before rasterizing.");
    }
    if (!this.selectedSvgNode()) {
      throw new Error("Select an SVG layer before rasterizing.");
    }
    if (this.sceneOperationBusy) {
      throw new Error("Another vector operation is still in progress.");
    }
    return this.rasterizeSelectedSvg(true);
  }

  rasterizeSelectedTextNode(): void {
    const node = this.selectedTextNode();
    if (
      !node
      || node.text.length === 0
      || this.sceneOperationBusy
      || this.transformSessionOpen
    ) return;
    void this.rasterizeSelectedText();
  }

  /**
   * Destructive dev-only WebGPU regression for a fresh document. It exercises
   * both semantic source kinds through their real mesh compiler, tiled RGBA16F
   * History seed, Undo removal and Redo hydration. Call from the dev console as
   * `await __mixedSceneController.runVectorRasterHistoryGpuTest()`.
   */
  async runVectorRasterHistoryGpuTest(): Promise<VectorRasterHistoryGpuTestReport> {
    if (this.sceneOperationBusy || this.transformSessionOpen) {
      throw new Error("Finish the current vector operation first.");
    }
    const initialScene = this.host.getMixedSceneSnapshot();
    const initialHistory = this.host.getHistoryState();
    const initialRasters = initialScene?.items.filter((item) => item.kind === "raster") ?? [];
    if (
      !initialScene
      || initialRasters.length !== 1
      || initialRasters[0].rasterHasContent
      || initialHistory.actionCount !== 0
      || initialHistory.cursor !== 0
    ) {
      throw new Error(
        "The vector-raster test requires a fresh dev page with one empty raster.",
      );
    }

    const auditWidth = Math.min(1536, this.host.documentWidth);
    const auditHeight = Math.min(1024, this.host.documentHeight);
    const auditRect = {
      x: Math.floor((this.host.documentWidth - auditWidth) * 0.5),
      y: Math.floor((this.host.documentHeight - auditHeight) * 0.5),
      width: auditWidth,
      height: auditHeight,
    };
    const refreshScene = (): MixedSceneSnapshot => {
      const snapshot = this.host.getMixedSceneSnapshot();
      if (!snapshot) throw new Error("The mixed scene is unavailable during the test.");
      this.syncScene(snapshot);
      return snapshot;
    };
    const readBackground = async (
      snapshot: MixedSceneSnapshot,
    ): Promise<Map<number, Uint8Array>> => {
      const result = new Map<number, Uint8Array>();
      for (const item of snapshot.items) {
        if (item.kind !== "raster") continue;
        result.set(
          item.rasterLayerId,
          await this.host.readLayerPixels(auditRect, item.rasterLayerIndex),
        );
      }
      return result;
    };

    const runProbe = async (
      sourceKind: "text" | "svg",
    ): Promise<VectorRasterHistoryGpuProbe> => {
      let vectorKey: `text:${number}` | `svg:${number}`;
      if (sourceKind === "text") {
        const seed = {
          ...this.defaultSeed(0, "#334455"),
          text: "RGBA16F",
          fontSize: 280,
          x: this.host.documentWidth * 0.5,
          y: this.host.documentHeight * 0.5,
        };
        const node = await this.host.addVectorTextNode(seed, "RGBA16F text test");
        vectorKey = `text:${node.id}`;
      } else {
        const documentValue = parseVectorSvg(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
          + '<path fill="#4466aa" d="M32 64H480V448H32Z"/>'
          + '<circle fill="#dd8844" cx="256" cy="256" r="112"/>'
          + "</svg>",
          "regression-rgba16f.svg",
        );
        const node = await this.host.addVectorSvgNode(
          this.defaultSvgSeed(documentValue),
          "Test RGBA16F SVG",
        );
        vectorKey = `svg:${node.id}`;
      }

      const beforeRasterization = refreshScene();
      const backgroundBefore = await readBackground(beforeRasterization);
      const result = sourceKind === "text"
        ? await this.rasterizeSelectedText()
        : await this.rasterizeSelectedSvg();
      if (!result) {
        throw new Error(`The WebGPU test did not complete ${sourceKind} rasterization.`);
      }
      await this.host.waitForIdle();
      const rasterizedScene = refreshScene();
      const generated = rasterizedScene.items.find(
        (item) => item.kind === "raster" && item.rasterLayerId === result.layerId,
      );
      if (!generated || generated.kind !== "raster" || !generated.rasterContentBounds) {
        throw new Error(`Generated ${sourceKind} raster has no authoritative bounds.`);
      }
      const rawRect = generated.rasterContentBounds;
      const rawBeforeUndo = await this.host.readLayerPixels(
        rawRect,
        generated.rasterLayerIndex,
      );
      const rawPixels = rawRect.width * rawRect.height;
      const rawBytesPerPixel = rawPixels > 0 ? rawBeforeUndo.byteLength / rawPixels : 0;

      const undoReturned = await this.host.undo();
      await this.host.waitForIdle();
      const undoScene = refreshScene();
      const undoRestoredVector = undoScene.items.some((item) => item.key === vectorKey)
        && !undoScene.items.some(
          (item) => item.kind === "raster" && item.rasterLayerId === result.layerId,
        );
      let undoPreservedBackgroundBytes = true;
      for (const [layerId, before] of backgroundBefore) {
        const item = undoScene.items.find(
          (candidate) => candidate.kind === "raster" && candidate.rasterLayerId === layerId,
        );
        if (!item || item.kind !== "raster") {
          undoPreservedBackgroundBytes = false;
          break;
        }
        const after = await this.host.readLayerPixels(auditRect, item.rasterLayerIndex);
        if (!uint8ArraysEqual(before, after)) {
          undoPreservedBackgroundBytes = false;
          break;
        }
      }

      const redoReturned = await this.host.redo();
      await this.host.waitForIdle();
      const redoScene = refreshScene();
      const redone = redoScene.items.find(
        (item) => item.kind === "raster" && item.rasterLayerId === result.layerId,
      );
      const redoRestoredRaster = Boolean(redone && redone.kind === "raster");
      const rawAfterRedo = redone && redone.kind === "raster"
        ? await this.host.readLayerPixels(rawRect, redone.rasterLayerIndex)
        : new Uint8Array();

      return {
        sourceKind,
        format: result.format,
        seedFormat: result.seedFormat,
        rawByteLength: rawBeforeUndo.byteLength,
        rawBytesPerPixel,
        nonZeroAlphaPixels: countNonZeroRgba16fAlpha(rawBeforeUndo),
        undoReturned,
        undoRestoredVector,
        undoPreservedBackgroundBytes,
        redoReturned,
        redoRestoredRaster,
        redoRestoredRawBytesExactly: uint8ArraysEqual(rawBeforeUndo, rawAfterRedo),
      };
    };

    const probes = [await runProbe("text"), await runProbe("svg")];
    return {
      probes,
      passed: probes.every((probe) =>
        probe.format === "rgba16float"
        && probe.seedFormat === "rgba16float"
        && probe.rawByteLength > 0
        && probe.rawBytesPerPixel === 8
        && probe.nonZeroAlphaPixels > 0
        && probe.undoReturned
        && probe.undoRestoredVector
        && probe.undoPreservedBackgroundBytes
        && probe.redoReturned
        && probe.redoRestoredRaster
        && probe.redoRestoredRawBytesExactly
      ),
    };
  }

  setSelectedTextTransform(transformType: VectorTextTransformType): void {
    if (!this.selectedTextNode() || this.sceneOperationBusy || this.transformSessionOpen) return;
    this.activateTransform(transformType);
  }

  resetSelectedTextDistort(): void {
    if (!this.selectedTextNode() || this.sceneOperationBusy || this.transformSessionOpen) return;
    this.resetDistort();
  }

  toggleSelectedTextDistortEditing(): boolean {
    if (!this.selectedTextNode() || this.sceneOperationBusy || this.transformSessionOpen) {
      return this.isSelectedTextDistortEditing();
    }
    this.toggleDistortEditing();
    return this.isSelectedTextDistortEditing();
  }

  startSelectedTextDistortEditing(): boolean {
    if (!this.selectedTextNode() || this.sceneOperationBusy || this.transformSessionOpen) {
      return this.isSelectedTextDistortEditing();
    }
    let node = this.selectedTextNode();
    if (!node) return false;
    if (node.transformType !== "distort" || !node.distortPoints) {
      this.activateTransform("distort");
      node = this.selectedTextNode();
    }
    if (!node || node.transformType !== "distort" || !node.distortPoints) return false;
    if (this.distortEditingNodeId !== node.id) {
      this.distortEditingNodeId = node.id;
      this.syncControlsFromSelection(node);
      this.interactionCanvas.classList.add("is-distort-editing");
      this.scheduleRender();
    }
    return true;
  }

  stopSelectedTextDistortEditing(): boolean {
    if (!this.isSelectedTextDistortEditing()) return false;
    this.distortEditingNodeId = null;
    this.syncControlsFromSelection(this.selectedTextNode());
    this.interactionCanvas.classList.remove("is-distort-editing");
    this.scheduleRender();
    return true;
  }

  isSelectedTextDistortEditing(): boolean {
    const node = this.selectedTextNode();
    return Boolean(node && node.id === this.distortEditingNodeId);
  }

  getTextEditorSnapshot(): VectorTextEditorSnapshot {
    const node = this.selectedTextNode();
    const defaults = node ?? this.defaultSeed(0);
    const locked = this.sceneOperationBusy || this.transformSessionOpen;
    return {
      selected: node !== null,
      locked,
      canCreate: !locked,
      canReset: node !== null && !locked,
      canDelete: node !== null && !locked,
      canRasterize: node !== null && node.text.length > 0 && !locked,
      text: defaults.text,
      fontFamily: defaults.fontFamily,
      fontSize: defaults.fontSize,
      color: defaults.color,
      transformType: defaults.transformType ?? "none",
      transformCurve: defaults.transformCurve ?? 0,
      circleRadiusPercent: defaults.circleRadiusPercent ?? 100,
      circleInverted: defaults.circleInverted ?? false,
      distortEditing: Boolean(node && node.id === this.distortEditingNodeId),
    };
  }

  getVectorEffectEditorSnapshot(): VectorEffectEditorSnapshot | null {
    const node = this.selectedVectorNode();
    if (!node || isImageNode(node)) return null;
    return {
      locked: this.sceneOperationBusy || this.transformSessionOpen,
      outlineWidth: node.outlineWidth,
      outlineColor: node.outlineColor,
      outlineJoin: node.outlineJoin,
      singleShadowEnabled: node.singleShadowEnabled,
      singleShadowColor: node.singleShadowColor,
      singleShadowOpacity: node.singleShadowOpacity,
      singleShadowOffset: node.singleShadowOffset,
      singleShadowAngle: node.singleShadowAngle,
      singleShadowBlur: node.singleShadowBlur,
      innerShadowEnabled: node.innerShadowEnabled,
      innerShadowColor: node.innerShadowColor,
      innerShadowOpacity: node.innerShadowOpacity,
      innerShadowOffset: node.innerShadowOffset,
      innerShadowAngle: node.innerShadowAngle,
      innerShadowBlur: node.innerShadowBlur,
      blockShadowEnabled: node.blockShadowEnabled,
      blockShadowColor: node.blockShadowColor,
      blockShadowOpacity: node.blockShadowOpacity,
      blockShadowOffset: node.blockShadowOffset,
      blockShadowAngle: node.blockShadowAngle,
      blockShadowOutlineWidth: node.blockShadowOutlineWidth,
    };
  }

  getTransformActionSnapshot(): VectorTransformActionSnapshot {
    const active = this.transformSessionOpen;
    return {
      active,
      canApply: active
        && !this.transformCommitBusy
        && !this.activeInteraction
        && !this.rasterTransformRecoveryOnly,
      canCancel: active && !this.transformCommitBusy && !this.activeInteraction,
    };
  }

  updateSelectedTextProperties(patch: VectorTextEditorPatch): boolean {
    const node = this.selectedTextNode();
    if (!node || this.sceneOperationBusy || this.transformSessionOpen) return false;
    const normalized = patch.text === undefined
      ? patch
      : { ...patch, text: patch.text || " " };
    this.host.updateVectorTextNode(node.id, normalized);
    return true;
  }

  updateSelectedVectorEffectProperties(patch: VectorEffectEditorPatch): boolean {
    const node = this.selectedVectorNode();
    if (
      !node
      || isImageNode(node)
      || this.sceneOperationBusy
      || this.transformSessionOpen
    ) return false;
    this.updateSelectedNode(patch as VectorSceneNodeUpdate);
    return true;
  }

  setSelectedVectorShadowEnabled(kind: VectorShadowKind, enabled: boolean): boolean {
    const node = this.selectedVectorNode();
    if (
      !node
      || isImageNode(node)
      || this.sceneOperationBusy
      || this.transformSessionOpen
    ) return false;
    if (kind === "single") {
      this.updateSelectedNode(enabled
        ? { singleShadowEnabled: true, blockShadowEnabled: false }
        : { singleShadowEnabled: false });
    } else if (kind === "block") {
      this.updateSelectedNode(enabled
        ? { blockShadowEnabled: true, singleShadowEnabled: false }
        : { blockShadowEnabled: false });
    } else {
      this.updateSelectedNode({ innerShadowEnabled: enabled });
    }
    return true;
  }

  beginSelectedVectorPropertyEdit(): boolean {
    const node = this.selectedVectorNode();
    if (
      !node
      || isImageNode(node)
      || this.sceneOperationBusy
      || this.transformSessionOpen
    ) return false;
    return this.host.beginVectorHistoryEdit("property");
  }

  commitSelectedVectorPropertyEdit(): boolean {
    return this.host.commitVectorHistoryEdit();
  }

  setAdaptiveZoomEnabled(enabled: boolean): void {
    if (this.adaptiveZoomEnabled === enabled) return;
    this.adaptiveZoomEnabled = enabled;
    this.viewRevision += 1;
    this.cancelAdaptiveZoomTimers();
    if (!enabled && this.zoomRenderMode === "fast") {
      // Disabling the optimization is an explicit request for the precise
      // path. Do not leave recovery waiting for a pointer-up that a benchmark
      // or lifecycle transition may never deliver.
      this.viewGestureActive = false;
      if (this.unsafeExactRefreshRequest !== null) {
        this.browser.cancelAnimationFrame(this.unsafeExactRefreshRequest);
        this.unsafeExactRefreshRequest = null;
      }
      this.pendingExactRecoveryRevision = null;
      this.exitFastAfterScheduledRender = true;
      this.markPendingViewRender();
      this.scheduleRender();
    }
  }

  getDiagnostics(): MixedSceneDiagnostics {
    const view = this.host.getVectorTextViewState();
    const effectDiagnostics = this.effectCompiler.diagnostics();
    const backpressure = this.host.getVectorTextFastPresentationBackpressureStats();
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
      adaptiveZoomEnabled: this.adaptiveZoomEnabled,
      zoomRenderMode: this.zoomRenderMode,
      zoomFastPresentationMode: this.host.getVectorTextFastPresentationMode(),
      zoomFastModeArmed: this.zoomRenderMode === "fast",
      zoomClippedRefreshPolicy: this.clippedRefreshPolicy,
      zoomSlowFrameStreak: 0,
      zoomFastActivationCount: this.zoomFastActivationCount,
      zoomExactRecoveryCount: this.zoomExactRecoveryCount,
      lastViewRenderEndToEndMs: this.lastViewRenderEndToEndMs,
      lastAdaptiveZoomTriggerRenderMs: 0,
      lastAdaptiveZoomTriggerEndToEndMs: 0,
      zoomViewRevision: this.viewRevision,
      zoomViewEventCount: this.zoomViewEventCount,
      zoomSafeReprojectionCount: this.zoomSafeReprojectionCount,
      zoomFallbackReprojectionCount: this.zoomFallbackReprojectionCount,
      zoomClippedReprojectionCount: this.zoomClippedReprojectionCount,
      zoomUnsafeExactRefreshCount: this.zoomUnsafeExactRefreshCount,
      zoomUnsafeExactRefreshCompletedCount: this.zoomUnsafeExactRefreshCompletedCount,
      zoomUnsafeExactCoalescedCount: this.zoomUnsafeExactCoalescedCount,
      zoomUnsafeExactRefreshInFlight: this.unsafeExactRefreshInFlight,
      zoomUnsafeExactRefreshRequestPending: this.unsafeExactRefreshRequest !== null,
      zoomFastPresentationSubmissionCount: backpressure.submissionCount,
      zoomFastPresentationCoalescedRequestCount: backpressure.coalescedRequestCount,
      fallbackPresentationReady:
        !this.fallbackPresentationDirty && this.fallbackPresentationGpuMemoryMiB > 0,
      fallbackPresentationRebuildCount: this.fallbackPresentationRebuildCount,
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

  private defaultSeed(index: number, colorOverride?: string): VectorTextNodeSeed {
    const color = colorOverride && /^#[0-9a-f]{6}$/i.test(colorOverride)
      ? colorOverride.toLowerCase()
      : index === 0
        ? "#111111"
        : "#f47c5d";
    return {
      text: index === 0 ? "STREETWEAR" : `TEXT ${index + 1}`,
      fontFamily: "Anton",
      fontSize: 360,
      color,
      transformType: "none",
      transformCurve: 80,
      circleRadiusPercent: 50,
      circleInverted: false,
      distortPoints: null,
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
      x: this.host.documentWidth * 0.5 + index * 90,
      y: this.host.documentHeight * 0.5 + index * 110,
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
      x: this.host.documentWidth * 0.5,
      y: this.host.documentHeight * 0.5,
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
    this.setSvgImportStatus(`Safely analyzing ${sourceName}…`);
    let documentValue: ReturnType<typeof parseVectorSvg>;
    try {
      documentValue = parseVectorSvg(source, sourceName);
    } catch (error) {
      this.setSvgImportStatus(
        error instanceof Error ? error.message : "Invalid SVG.",
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
        `${documentValue.sourceName} imported · ${documentValue.paints.length} colors · `
        + `${documentValue.contourCount} contours · ${sourceMiB.toFixed(3)} MiB file · `
        + `${vectorMiB.toFixed(3)} MiB CPU vector data.`,
      );
    } catch (error) {
      this.setSvgImportStatus(
        error instanceof Error ? error.message : "SVG import failed.",
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
    this.setImageImportStatus(`Decoding ${file.name}…`);
    this.syncControlsFromSelection(this.selectedVectorNode());
    try {
      const imported = await this.host.importRasterImageFile(file);
      // Keep the import operation locked until uploads, mip generation and the
      // first presentation are drained. Otherwise the first Pencil down can
      // land behind that queued GPU work and look as if the stroke started late.
      await this.host.waitForIdle();
      const sourceMiB = imported.sourceBytes / MEBIBYTE_BYTES;
      this.setImageImportStatus(
        `${imported.name} imported directly as a raster · `
        + `${imported.sourceWidth}×${imported.sourceHeight} px · ${imported.tileCount} tiles · `
        + `${sourceMiB.toFixed(2)} MiB file. Brush, Fill, and effects are already active.`,
      );
    } catch (error) {
      this.setImageImportStatus(
        error instanceof Error ? error.message : "Image import failed.",
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

  private selectedVectorNode(): Readonly<VectorSceneNode> | null {
    const snapshot = this.snapshot;
    if (!snapshot) return null;
    const selected = snapshot.items.find((item) => item.key === snapshot.selectedKey);
    if (selected?.kind === "text") return selected.textNode;
    if (selected?.kind === "svg") return selected.svgNode;
    if (selected?.kind === "image") return selected.imageNode;
    return null;
  }

  private selectedTransformNode(): Readonly<TransformSceneNode> | null {
    const snapshot = this.snapshot;
    if (!snapshot) return null;
    const selected = snapshot.items.find((item) => item.key === snapshot.selectedKey);
    const pixelSelection = this.host.getPixelSelectionState();
    if (
      selected?.kind === "raster"
      && selected.rasterHasContent
      && pixelSelection.selectedPixels > 0
      && pixelSelection.bounds
    ) {
      const transform = selected.rasterTransform;
      const bounds = transform?.scope === "selection"
        ? transform.sourceBounds
        : pixelSelection.bounds;
      const centerX = bounds.x + bounds.width * 0.5;
      const centerY = bounds.y + bounds.height * 0.5;
      return {
        kind: "raster-layer",
        id: selected.rasterLayerId,
        layerId: selected.rasterLayerId,
        name: selected.rasterLayerName,
        scope: "selection",
        mode: "affine",
        gridSize: 3,
        controlPoints: [],
        bezierHandles: [],
        x: transform?.scope === "selection" ? transform.x : centerX,
        y: transform?.scope === "selection" ? transform.y : centerY,
        scale: 1,
        rotation: 0,
        sourceBounds: { ...bounds },
        sourcePivot: transform?.scope === "selection" && transform.sourcePivot
          ? { ...transform.sourcePivot }
          : { x: centerX, y: centerY },
        resultBounds: transform?.scope === "selection" && transform.resultBounds
          ? { ...transform.resultBounds }
          : { ...bounds },
      };
    }
    const vector = this.selectedVectorNode();
    if (vector) return vector;
    if (selected?.kind !== "raster" || !selected.rasterHasContent) return null;
    const transform = selected.rasterTransform;
    const bounds = transform?.sourceBounds ?? selected.rasterContentBounds;
    if (!bounds) return null;
    const centerX = bounds.x + bounds.width * 0.5;
    const centerY = bounds.y + bounds.height * 0.5;
    return {
      kind: "raster-layer",
      id: selected.rasterLayerId,
      layerId: selected.rasterLayerId,
      name: selected.rasterLayerName,
      scope: transform?.scope ?? "layer",
      mode: transform?.mode ?? "affine",
      gridSize: transform?.gridSize ?? 3,
      controlPoints: transform?.controlPoints.map((point) => ({ ...point })) ?? [],
      bezierHandles: transform?.bezierHandles.map((point) => ({ ...point })) ?? [],
      x: transform?.x ?? centerX,
      y: transform?.y ?? centerY,
      scale: transform?.scale ?? 1,
      rotation: transform?.rotation ?? 0,
      sourceBounds: { ...bounds },
      sourcePivot: transform?.sourcePivot
        ? { ...transform.sourcePivot }
        : { x: centerX, y: centerY },
      resultBounds: transform?.resultBounds
        ? { ...transform.resultBounds }
        : { ...bounds },
    };
  }

  private async prepareSelectedRasterTransform(): Promise<void> {
    const node = this.selectedTransformNode();
    if (
      !this.transformToolActive
      || !node
      || !isRasterLayerTransformNode(node)
      || this.transformSessionOpen
      || this.rasterTransformPreparing
    ) {
      return;
    }
    this.rasterTransformPreparing = true;
    const operation = this.rasterTransformToolMode === "warp"
      ? "Warp"
      : this.rasterTransformToolMode === "perspective"
        ? "Perspective"
        : "Transform";
    this.status.textContent = `Preparing ${operation} on the GPU for ${node.name}…`;
    try {
      const state = await this.host.beginRasterLayerTransform();
      if (!state) return;
      const current = this.selectedTransformNode();
      if (
        !this.transformToolActive
        || !current
        || !isRasterLayerTransformNode(current)
        || current.layerId !== state.layerId
      ) {
        await this.host.cancelRasterLayerTransform();
        return;
      }
      if (state.scope === "layer" && state.mode !== this.rasterTransformToolMode) {
        this.host.updateRasterLayerTransform({ mode: this.rasterTransformToolMode });
      }
      this.transformSessionOpen = true;
      this.transformSessionKind = "raster";
      this.rasterTransformRecoveryOnly = false;
      this.updateTransformCommitUi();
      this.status.textContent = `${operation} GPU ready for ${current.name}: Apply or Cancel.`;
      this.scheduleRender();
    } catch (error) {
      const retained = this.rasterTransformSessionStillOpen();
      if (retained) {
        this.transformSessionOpen = true;
        this.transformSessionKind = "raster";
        this.rasterTransformRecoveryOnly = true;
        this.updateTransformCommitUi();
      }
      this.status.textContent = error instanceof Error
        ? error.message
        : "WebGPU Raster Transform is unavailable.";
    } finally {
      this.rasterTransformPreparing = false;
    }
  }

  private selectedTextNode(): Readonly<VectorTextNode> | null {
    const node = this.selectedVectorNode();
    return node && isTextNode(node) ? node : null;
  }

  private selectedSvgNode(): Readonly<VectorSvgNode> | null {
    const node = this.selectedVectorNode();
    return node && isSvgNode(node) ? node : null;
  }

  private vectorRasterView(): VectorTextViewState {
    return {
      canvasWidth: this.host.documentWidth,
      canvasHeight: this.host.documentHeight,
      cssWidth: this.host.documentWidth,
      cssHeight: this.host.documentHeight,
      centerX: this.host.documentWidth * 0.5,
      centerY: this.host.documentHeight * 0.5,
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

  /**
   * Core-facing merge API used by layer UIs. Keys are bottom-up and must be a
   * contiguous scene interval. Text/SVG draw programs are prepared here, where
   * font/SVG geometry lives, then consumed transiently by the engine.
   */
  async mergeSceneItems(
    keys: readonly MixedSceneItem["key"][],
  ): Promise<LayerMergeResult> {
    if (this.sceneOperationBusy) {
      throw new Error("Another scene operation is still in progress.");
    }
    this.sceneOperationBusy = true;
    this.syncControlsFromSelection(this.selectedVectorNode());
    const rasterSlots = new Set<string>();
    try {
      const view = this.vectorRasterView();
      for (;;) {
        const revision = this.effectCompiler.resourceRevisionValue();
        const snapshot = this.host.getMixedSceneSnapshot();
        if (!snapshot) throw new Error("The mixed scene is unavailable.");
        const firstIndex = snapshot.items.findIndex((item) => item.key === keys[0]);
        const liveKeys = firstIndex >= 0
          ? snapshot.items.slice(firstIndex, firstIndex + keys.length).map((item) => item.key)
          : [];
        if (
          keys.length < 2
          || liveKeys.length !== keys.length
          || liveKeys.some((key, index) => key !== keys[index])
        ) {
          throw new Error(
            "The items to merge changed or are no longer consecutive.",
          );
        }

        let allEffectsReady = true;
        const vectorDraws: MergeMixedSceneItemsRequest["vectorDraws"][number][] = [];
        for (const key of keys) {
          const item = snapshot.items.find((candidate) => candidate.key === key);
          if (!item) throw new Error(`Item ${key} is missing during merge.`);
          if (item.kind === "raster") continue;
          if (item.kind === "image") {
            throw new Error("Merge v1 does not support image nodes yet.");
          }
          const draws: VectorTextGpuDraw[] = [];
          if (item.kind === "text") {
            const node = item.textNode;
            if (node.visible && node.opacity > 0 && node.text.length > 0) {
              allEffectsReady = this.appendGpuDrawsForNode(
                draws,
                node,
                this.geometryForNode(node),
                view,
                rasterSlots,
                true,
              ) && allEffectsReady;
            }
          } else {
            const node = item.svgNode;
            if (node.visible && node.opacity > 0) {
              allEffectsReady = this.appendGpuDrawsForSvgNode(
                draws,
                node,
                view,
                rasterSlots,
                true,
              ) && allEffectsReady;
            }
          }
          vectorDraws.push({ key: item.key, draws });
        }
        if (allEffectsReady) {
          return await this.host.mergeMixedSceneItems({ keys: [...keys], vectorDraws });
        }
        const diagnostics = this.effectCompiler.diagnostics();
        if (diagnostics.pendingJobs === 0 && diagnostics.lastError) {
          throw new Error(`Could not prepare vectors for merge: ${diagnostics.lastError}`);
        }
        await this.effectCompiler.waitForResourceReady(revision);
      }
    } finally {
      for (const slot of rasterSlots) this.effectCompiler.releasePinnedSlot(slot);
      this.sceneOperationBusy = false;
      this.syncControlsFromSelection(this.selectedVectorNode());
      if (this.sceneOperationRenderDeferred) {
        this.sceneOperationRenderDeferred = false;
        this.scheduleRender();
      }
    }
  }

  private async rasterizeSelectedText(): Promise<VectorRasterizationResult | null> {
    const selected = this.selectedTextNode();
    if (!selected || selected.text.length === 0) return null;
    const textId = selected.id;
    const rasterized = await this.runSceneOperation(async () => {
      this.setTextRasterStatus(
        "Preparing text at document resolution…",
      );
      const view = this.vectorRasterView();
      const rasterSlots = new Set<string>();
      try {
        for (;;) {
          const revision = this.effectCompiler.resourceRevisionValue();
          const current = this.selectedTextNode();
          if (!current || current.id !== textId) {
            throw new Error(
              "The selected text changed during rasterization.",
            );
          }
          if (current.text.length === 0) {
            throw new Error("Empty text contains no pixels to rasterize.");
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
              "WebGPU rasterization of " + current.name + "…",
            );
            const result = await this.host.rasterizeVectorTextNode(textId, draws);
            const message =
              current.name + " rasterized to "
              + vectorRasterFormatLabel(result.format) + " · MSAA 4× · "
              + result.chunkCount + " 512 px blocks · "
              + result.tileCount + " 256 px tiles.";
            this.setTextRasterStatus(message);
            this.status.textContent = message;
            return result;
          }
          const diagnostics = this.effectCompiler.diagnostics();
          if (diagnostics.pendingJobs === 0 && diagnostics.lastError) {
            throw new Error(
              "Text mesh preparation failed: " + diagnostics.lastError,
            );
          }
          await this.effectCompiler.waitForResourceReady(revision);
        }
      } catch (error) {
        this.setTextRasterStatus(
          error instanceof Error
            ? error.message
            : "Text rasterization failed.",
          true,
        );
        throw error;
      } finally {
        for (const slot of rasterSlots) {
          this.effectCompiler.releasePinnedSlot(slot);
        }
      }
    });
    return rasterized ?? null;
  }

  private async rasterizeSelectedSvg(
    propagateError = false,
  ): Promise<VectorRasterizationResult | null> {
    const selected = this.selectedSvgNode();
    if (!selected) return null;
    const svgId = selected.id;
    const rasterized = await this.runSceneOperation(async () => {
      this.setSvgImportStatus("Preparing SVG meshes at document resolution…");
      const view = this.vectorRasterView();
      const rasterSlots = new Set<string>();
      try {
        for (;;) {
          const revision = this.effectCompiler.resourceRevisionValue();
          const current = this.selectedSvgNode();
          if (!current || current.id !== svgId) {
            throw new Error("The selected SVG changed during rasterization.");
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
              `WebGPU rasterization of ${current.name}…`,
            );
            const result = await this.host.rasterizeVectorSvgNode(svgId, draws);
            this.setSvgImportStatus(
              `${current.name} rasterized to ${vectorRasterFormatLabel(result.format)} · MSAA 4× · `
              + `${result.chunkCount} 512 px blocks · ${result.tileCount} 256 px tiles.`,
            );
            return result;
          }
          const diagnostics = this.effectCompiler.diagnostics();
          if (diagnostics.pendingJobs === 0 && diagnostics.lastError) {
            throw new Error(
              `SVG mesh preparation failed: ${diagnostics.lastError}`,
            );
          }
          await this.effectCompiler.waitForResourceReady(revision);
        }
      } catch (error) {
        this.setSvgImportStatus(
          error instanceof Error ? error.message : "SVG rasterization failed.",
          true,
        );
        throw error;
      } finally {
        for (const slot of rasterSlots) {
          this.effectCompiler.releasePinnedSlot(slot);
        }
      }
    }, propagateError);
    return rasterized ?? null;
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
    this.imageFileInput.addEventListener("change", () => {
      const file = this.imageFileInput.files?.[0];
      this.imageFileInput.value = "";
      if (file) void this.importImageFile(file);
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
    this.transformApplyButton.addEventListener("click", () => this.applyTransform());
    this.transformCancelButton.addEventListener("click", () => this.cancelTransform());
    for (const button of this.rasterTransformGridButtons) {
      button.addEventListener("click", () => {
        const gridSize = Number(button.dataset.rasterTransformGrid);
        if (!isRasterWarpGridSize(gridSize)) return;
        if (
          this.activeInteraction
          || this.transformCommitBusy
          || this.rasterTransformRecoveryOnly
          || this.transformSessionKind !== "raster"
        ) return;
        const node = this.selectedTransformNode();
        if (
          !node
          || !isRasterLayerTransformNode(node)
          || node.scope !== "layer"
          || node.mode !== "warp"
        ) return;
        try {
          this.host.updateRasterLayerTransform({ gridSize });
          this.scheduleRender();
        } catch (error) {
          this.status.textContent = error instanceof Error ? error.message : String(error);
        }
      });
    }
    this.browser.addEventListener("keydown", (event) => {
      if (!this.transformSessionOpen || event.defaultPrevented || event.isComposing) return;
      const target = event.target instanceof Element ? event.target : null;
      const editable = Boolean(target?.closest("input, textarea, select, [contenteditable]"));
      const arrow = event.key === "ArrowLeft"
        ? { x: -1, y: 0 }
        : event.key === "ArrowRight"
          ? { x: 1, y: 0 }
          : event.key === "ArrowUp"
            ? { x: 0, y: -1 }
            : event.key === "ArrowDown"
              ? { x: 0, y: 1 }
              : null;
      const node = this.selectedTransformNode();
      const rasterKeyboardMove = Boolean(
        node
        && isRasterLayerTransformNode(node)
        && this.transformSessionKind === "raster"
      );
      if (
        arrow
        && rasterKeyboardMove
        && !editable
        && !this.activeInteraction
        && !this.transformCommitBusy
        && !this.rasterTransformRecoveryOnly
      ) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        try {
          this.host.nudgeRasterLayerTransform(arrow.x * step, arrow.y * step);
          this.scheduleRender();
        } catch (error) {
          this.status.textContent = error instanceof Error
            ? error.message
            : "Could not move the raster.";
        }
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.abortActiveTransformInteraction();
        void this.cancelTransformSession();
      } else if (event.key === "Enter" && !editable && !this.activeInteraction) {
        event.preventDefault();
        void this.applyTransformSession();
      }
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
  private async runSceneOperation<Result>(
    operation: () => Promise<Result>,
    propagateError = false,
  ): Promise<Result | undefined> {
    if (this.sceneOperationBusy) {
      return undefined;
    }
    this.sceneOperationBusy = true;
    this.syncControlsFromSelection(this.selectedVectorNode());
    try {
      return await operation();
    } catch (error) {
      this.status.textContent = error instanceof Error
        ? error.message
        : "Could not edit the text/raster scene.";
      if (propagateError) throw error;
      return undefined;
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

  private updateTransformNode(
    node: Readonly<TransformSceneNode>,
    update: Partial<Pick<
      RasterTransformSnapshot,
      "x" | "y" | "scale" | "rotation" | "mode" | "gridSize" | "controlPoints" | "bezierHandles"
    >>,
  ): void {
    if (isRasterLayerTransformNode(node)) {
      this.host.updateRasterLayerTransform(update);
      return;
    }
    this.updateSelectedNode(update as VectorSceneNodeUpdate);
  }

  private syncControlsFromSelection(_node: Readonly<VectorSceneNode> | null): void {
    this.onEditorStateChange?.();
  }
  private handleEffectResourceReady(): void {
    this.fallbackPresentationDirty = true;
    if (this.zoomRenderMode === "fast") {
      this.effectReadyRenderPending = true;
      return;
    }
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
    this.effectReadyIdleTimer = this.browser.setTimeout(() => {
      this.effectReadyIdleTimer = null;
      if (!this.effectReadyRenderPending) {
        return;
      }
      if (this.zoomRenderMode === "fast") {
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
    this.renderRequest = this.browser.requestAnimationFrame(() => {
      this.renderRequest = null;
      this.renderNow();
    });
  }

  private markPendingViewRender(): void {
    if (!this.pendingViewRender) {
      this.pendingViewRenderStartedAt = this.browser.performance.now();
    }
    this.pendingViewRender = true;
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
    const firstPaintUsesGradient = Boolean(
      node.document.paints[0]?.gradient
      && (node.paintColors[0] ?? node.document.paints[0].color).toLowerCase()
        === node.document.paints[0].color.toLowerCase()
    );
    const fuseOutlineAndFill = node.outlineWidth > 0
      && oneOpaquePaint
      && !firstPaintUsesGradient
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
          const color = node.paintColors[index] ?? paint.color;
          const gradient = paint.gradient && color.toLowerCase() === paint.color.toLowerCase()
            ? svgGradientGpuData(paint.gradient)
            : undefined;
          draws.push(this.meshDraw(
            node,
            `svg:${node.id}:paint:${index}:fill`,
            result.mesh,
            color,
            node.opacity * paint.opacity,
            0,
            0,
            gradient,
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
    gradient?: VectorTextGpuGradient,
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
      gradient,
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
    // are applied later and never duplicate the R16F matte.
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

  private renderNow(
    origin: "scheduled" | "recovery" | "unsafe-refresh" = "scheduled",
    recoveryRevision = this.viewRevision,
  ): boolean {
    if (this.sceneOperationBusy) {
      this.sceneOperationRenderDeferred = true;
      return false;
    }
    if (
      origin === "recovery"
      && !vectorTextExactRecoveryIsCurrent(
        recoveryRevision,
        this.viewRevision,
        this.viewGestureActive,
      )
    ) {
      return false;
    }
    const shouldExitFastAfterRender = origin === "recovery"
      || this.exitFastAfterScheduledRender;
    this.exitFastAfterScheduledRender = false;
    const wasViewRender = this.pendingViewRender;
    const viewRenderStartedAt = this.pendingViewRenderStartedAt;
    this.pendingViewRender = false;
    this.pendingViewRenderStartedAt = 0;
    const startedAt = this.browser.performance.now();
    const view = this.host.getVectorTextViewState();
    if (
      this.lastExactCanvasWidth > 0
      && (
        view.canvasWidth !== this.lastExactCanvasWidth
        || view.canvasHeight !== this.lastExactCanvasHeight
      )
    ) {
      this.fallbackPresentationDirty = true;
      this.fallbackPresentationGpuMemoryMiB = 0;
    }
    this.syncCanvasSizes(view);
    const snapshot = this.snapshot;
    const selectedNode = this.selectedVectorNode();
    const selectedTransformNode = this.selectedTransformNode();

    let gpuMemoryMiB = 0;
    let blurGpuMemoryMiB = 0;
    let blurGpuCacheEntries = 0;
    let textureCount = 0;
    const activeMeshKeys = new Set<string>();
    const liveEffectSlots = new Set<string>();
    const fallbackRuns: {
      placement: VectorTextPlacement;
      draws: readonly VectorTextGpuDraw[];
    }[] = [];
    let atomicEffectPendingNodes = 0;
    if (!snapshot) {
      this.host.clearVectorTextPresentation();
      this.renderedTextRunKeys.clear();
      this.fallbackPresentationDirty = false;
      this.fallbackPresentationGpuMemoryMiB = 0;
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
      const appendVectorToRun = (node: Readonly<VectorDrawableNode>) => {
        // MixedSceneStack.compositionSegments() omits hidden/transparent
        // vectors before it builds the run key. Mirror that rule here: if the
        // live texture kept the hidden node in its key, the compositor would
        // look up a different texture and the other visible vectors in the
        // same run would disappear too.
        if (!node.visible || node.opacity <= 0) {
          const key = vectorNodeKey(node);
          this.displayedDrawsByNodeKey.delete(key);
          this.displayedMetricsByNodeKey.delete(key);
          return;
        }
        pendingNodes.push(node);
      };
      for (const item of snapshot.items) {
        if (item.kind === "text") appendVectorToRun(item.textNode);
        else if (item.kind === "svg") appendVectorToRun(item.svgNode);
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
        fallbackRuns.push({ placement: group.placement, draws });
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
    if (
      this.fallbackPresentationDirty
      && atomicEffectPendingNodes === 0
      && fallbackRuns.length > 0
    ) {
      const fallback = this.host.rebuildVectorTextGpuFallbackPresentation(
        vectorTextWideFallbackView(
          view,
          this.host.documentWidth,
          this.host.documentHeight,
        ),
        fallbackRuns,
      );
      this.fallbackPresentationGpuMemoryMiB = fallback.gpuMemoryMiB;
      this.fallbackPresentationDirty = false;
      this.fallbackPresentationRebuildCount += 1;
    } else if (fallbackRuns.length === 0) {
      this.fallbackPresentationGpuMemoryMiB = 0;
      this.fallbackPresentationDirty = false;
    }
    gpuMemoryMiB += this.fallbackPresentationGpuMemoryMiB;
    gpuMemoryMiB += blurGpuMemoryMiB;
    this.singleShadowGpuMemoryMiB = blurGpuMemoryMiB;
    this.singleShadowGpuCacheEntries = blurGpuCacheEntries;

    if (snapshot?.items.some((item) => item.kind !== "raster")) {
      gpuMemoryMiB += view.canvasWidth * view.canvasHeight * 8 / MEBIBYTE_BYTES;
      textureCount += 1;
    }
    this.liveGpuMemoryMiB = gpuMemoryMiB;
    this.viewportTextureCount = textureCount;
    if (selectedTransformNode) {
      if (isRasterLayerTransformNode(selectedTransformNode)) {
        const source = selectedTransformNode.sourceBounds;
        const pivot = selectedTransformNode.sourcePivot ?? {
          x: source.x + source.width * 0.5,
          y: source.y + source.height * 0.5,
        };
        this.metrics = {
          left: source.x - pivot.x,
          top: source.y - pivot.y,
          right: source.x + source.width - pivot.x,
          bottom: source.y + source.height - pivot.y,
          baseline: 0,
        };
      } else {
        const key = vectorNodeKey(selectedTransformNode);
        this.metrics = this.displayedMetricsByNodeKey.get(key)
        ?? (isTextNode(selectedTransformNode)
          ? this.measureText(selectedTransformNode)
          : isSvgNode(selectedTransformNode)
            ? {
            left: selectedTransformNode.document.bounds.left,
            top: selectedTransformNode.document.bounds.top,
            right: selectedTransformNode.document.bounds.right,
            bottom: selectedTransformNode.document.bounds.bottom,
            baseline: 0,
          }
            : {
              left: -selectedTransformNode.document.width * 0.5,
              top: -selectedTransformNode.document.height * 0.5,
              right: selectedTransformNode.document.width * 0.5,
              bottom: selectedTransformNode.document.height * 0.5,
              baseline: 0,
            });
      }
      if (this.transformToolActive) {
        this.renderInteractionOverlay(view, selectedTransformNode);
      } else {
        clearSceneInteractionOverlay(this.interactionContext, view);
      }
    } else {
      clearSceneInteractionOverlay(this.interactionContext, view);
    }

    const finishedAt = this.browser.performance.now();
    this.lastRenderMs = finishedAt - startedAt;
    this.renderSamples.push(this.lastRenderMs);
    if (this.renderSamples.length > FRAME_SAMPLE_LIMIT) {
      this.renderSamples.splice(0, this.renderSamples.length - FRAME_SAMPLE_LIMIT);
    }
    this.renderCount += 1;
    this.lastExactCanvasWidth = view.canvasWidth;
    this.lastExactCanvasHeight = view.canvasHeight;
    if (wasViewRender) {
      this.lastViewRenderEndToEndMs = Math.max(
        this.lastRenderMs,
        finishedAt - (viewRenderStartedAt || startedAt),
      );
    }
    if (shouldExitFastAfterRender && this.zoomRenderMode === "fast") {
      // updateVectorTextGpuPresentation queued every run and prune flushed the
      // exact batch before this toggle. Queue ordering therefore publishes the
      // new texture before the precise sampling uniform can be presented.
      this.finishFastZoomMode();
    }
    this.updateStatus(view, selectedNode);
    return true;
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
    const cacheLabel = `${this.viewportTextureCount} vector GPU cache entries`;
    const timing = `render ${this.lastRenderMs.toFixed(2)} ms `
      + `(p95 ${percentile(this.renderSamples, 0.95).toFixed(2)} ms)`;
    const effectLabel = `Effects worker ${effectDiagnostics.pendingJobs} pending · `
      + `${effectDiagnostics.readyJobs} ready · ${effectDiagnostics.failedJobs} errors`
      + (effectDiagnostics.lastError ? ` · ${effectDiagnostics.lastError}` : "");
    if (!node) {
      this.status.textContent =
        `Raster selected · semantic vectors in the viewport canvas · ${cacheLabel} `
        + `${this.liveGpuMemoryMiB.toFixed(2)} MiB · browser canvas `
        + `${viewportCanvasLogicalMiB.toFixed(2)} MiB · ${effectLabel} · ${timing}.`;
      return;
    }

    const snapshot = this.snapshot!;
    const vectorIndex = snapshot.items.findIndex((item) => item.key === vectorNodeKey(node));
    const rasterIndex = snapshot.items.findIndex(
      (item) => item.kind === "raster" && item.rasterLayerId === snapshot.activeRasterLayerId,
    );
    const placement = vectorIndex < rasterIndex ? "below the active raster" : "above the active raster";
    if (isImageNode(node)) {
      const sourceMiB = node.document.sourceBytes / MEBIBYTE_BYTES;
      this.status.textContent =
        `${node.name} · image ${placement} · ${node.document.width}×`
        + `${node.document.height} px · file ${sourceMiB.toFixed(2)} MiB · `
        + `WebGPU texture/mipmap · scale ${(node.scale * 100).toFixed(1)}% · `
        + `rotation ${(node.rotation * 180 / Math.PI).toFixed(1)}° · ${timing}.`;
      return;
    }
    const outline = node.outlineWidth > 0
      ? `outline ${Math.round(node.outlineWidth)} px ${OUTLINE_JOIN_LABELS[node.outlineJoin]}`
      : "outline off";
    const blockShadow = node.blockShadowEnabled
      ? `Block Shadow GPU ${Math.round(node.blockShadowOffset)} @ ${Math.round(node.blockShadowAngle)}°`
      : "Block Shadow off";
    const singleShadow = node.singleShadowEnabled
      ? `drop shadow ${Math.round(node.singleShadowOffset)} @ `
        + `${Math.round(node.singleShadowAngle)}° · blur ${Math.round(node.singleShadowBlur)}`
      : "drop shadow off";
    const innerShadow = node.innerShadowEnabled
      ? `inner shadow ${Math.round(node.innerShadowOffset)} @ `
        + `${Math.round(node.innerShadowAngle)}° · blur ${Math.round(node.innerShadowBlur)}`
      : "inner shadow off";

    if (isSvgNode(node)) {
      const sourceMiB = node.document.sourceBytes / MEBIBYTE_BYTES;
      const cpuVectorMiB = node.document.logicalVectorBytes / MEBIBYTE_BYTES;
      this.status.textContent =
        `${node.name} · semantic SVG ${placement} · ${node.document.paints.length} colors · `
        + `${node.document.contourCount} contours / ${node.document.commandCount} commands · `
        + `file ${sourceMiB.toFixed(3)} MiB · CPU vectors ${cpuVectorMiB.toFixed(3)} MiB · `
        + `current GPU ${this.liveGpuMemoryMiB.toFixed(2)} MiB (${cacheLabel}; geometry, `
        + `blur mattes, and viewport included) · browser canvas `
        + `${viewportCanvasLogicalMiB.toFixed(2)} MiB · ${outline} · ${blockShadow} · `
        + `${singleShadow} · ${innerShadow} · ${VECTOR_SVG_IMPORT_STRATEGY} · `
        + `${effectLabel} · ${timing}.`;
      return;
    }

    const transformLabel = node.transformType === "none"
      ? "transform off"
      : node.transformType === "distort"
        ? "Distort · 6 vertices + 4 handles"
        : node.transformType === "circle"
          ? `Circle ${Math.round(node.circleRadiusPercent)}%`
            + (node.circleInverted ? " inverted" : "")
          : `${node.transformType === "arch" ? "Arch" : "Wave"} `
            + `${Math.round(node.transformCurve)}%`;
    this.status.textContent =
      `${node.name} · semantic text ${placement} · ${cacheLabel} `
      + `${this.liveGpuMemoryMiB.toFixed(2)} MiB · browser canvas `
      + `${viewportCanvasLogicalMiB.toFixed(2)} MiB · vector fonts `
      + `${vectorFontLogicalMiB.toFixed(2)} MiB · ${transformLabel} · ${outline} · `
      + `${blockShadow} · ${singleShadow} · ${innerShadow} · ${effectLabel} · ${timing}.`;
  }
  private renderInteractionOverlay(
    view: VectorTextViewState,
    node: Readonly<TransformSceneNode>,
  ): void {
    renderSceneInteractionOverlay({
      context: this.interactionContext,
      view,
      node,
      bounds: this.metrics,
      distortEditingNodeId: this.distortEditingNodeId,
      transformGuide: isTextNode(node)
        ? this.geometryForNode(node).outline.guide
        : null,
    });
  }

  private localBoundsForTransformNode(
    node: Readonly<TransformSceneNode>,
  ): SceneAxisAlignedBounds {
    if (isRasterLayerTransformNode(node)) {
      const source = node.sourceBounds;
      const pivot = node.sourcePivot ?? {
        x: source.x + source.width * 0.5,
        y: source.y + source.height * 0.5,
      };
      return {
        left: source.x - pivot.x,
        top: source.y - pivot.y,
        right: source.x + source.width - pivot.x,
        bottom: source.y + source.height - pivot.y,
      };
    }
    if (isTextNode(node)) {
      const outline = this.measureText(node);
      return {
        left: outline.left,
        top: outline.top,
        right: outline.right,
        bottom: outline.bottom,
      };
    }
    if (isSvgNode(node)) return { ...node.document.bounds };
    return {
      left: -node.document.width * 0.5,
      top: -node.document.height * 0.5,
      right: node.document.width * 0.5,
      bottom: node.document.height * 0.5,
    };
  }

  private transformNodeBounds(
    node: Readonly<TransformSceneNode>,
    localBounds = this.localBoundsForTransformNode(node),
  ): SceneAxisAlignedBounds {
    if (
      isRasterLayerTransformNode(node)
      && node.mode !== "affine"
      && node.controlPoints.length > 0
    ) return scenePointCloudBounds(node.controlPoints);
    return sceneTransformedAxisAlignedBounds(
      localBounds,
      node,
    );
  }

  private rasterSnapTargetVisible(
    item: Extract<MixedSceneSnapshot["items"][number], { kind: "raster" }>,
    rasterItems: ReadonlyMap<
      number,
      Extract<MixedSceneSnapshot["items"][number], { kind: "raster" }>
    >,
  ): boolean {
    if (!item.rasterVisible || item.rasterOpacity <= 0) return false;
    const visited = new Set<number>([item.rasterLayerId]);
    let parentId = item.rasterClippingParentId;
    while (parentId !== null) {
      if (visited.has(parentId)) return false;
      visited.add(parentId);
      const parent = rasterItems.get(parentId);
      if (!parent || !parent.rasterVisible || parent.rasterOpacity <= 0) return false;
      parentId = parent.rasterClippingParentId;
    }
    return true;
  }

  private rasterSnapTargetBounds(
    item: Extract<MixedSceneSnapshot["items"][number], { kind: "raster" }>,
    rasterItems: ReadonlyMap<
      number,
      Extract<MixedSceneSnapshot["items"][number], { kind: "raster" }>
    >,
  ): SceneAxisAlignedBounds | null {
    const content = item.rasterContentBounds;
    if (!content) return null;
    let bounds: SceneAxisAlignedBounds = {
      left: content.x,
      top: content.y,
      right: content.x + content.width,
      bottom: content.y + content.height,
    };
    let parentId = item.rasterClippingParentId;
    while (parentId !== null) {
      const parent = rasterItems.get(parentId);
      const parentContent = parent?.rasterContentBounds;
      if (!parent || !parentContent) return null;
      bounds = {
        left: Math.max(bounds.left, parentContent.x),
        top: Math.max(bounds.top, parentContent.y),
        right: Math.min(bounds.right, parentContent.x + parentContent.width),
        bottom: Math.min(bounds.bottom, parentContent.y + parentContent.height),
      };
      if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) return null;
      parentId = parent.rasterClippingParentId;
    }
    return bounds;
  }

  private snapTargetsForNode(
    node: Readonly<TransformSceneNode>,
  ): readonly SceneSnapTarget[] {
    const snapshot = this.snapshot;
    if (!snapshot) {
      return sceneDocumentSnapTargets(this.host.documentWidth, this.host.documentHeight);
    }
    const selectedKey = transformNodeKey(node);
    const rasterItems = new Map(
      snapshot.items
        .filter((item) => item.kind === "raster")
        .map((item) => [item.rasterLayerId, item] as const),
    );
    const targets: SceneSnapTarget[] = [
      ...sceneDocumentSnapTargets(this.host.documentWidth, this.host.documentHeight),
    ];
    for (const item of snapshot.items) {
      if (item.key === selectedKey) continue;
      if (item.kind === "raster") {
        if (
          !item.rasterHasContent
          || !this.rasterSnapTargetVisible(item, rasterItems)
        ) continue;
        const bounds = this.rasterSnapTargetBounds(item, rasterItems);
        if (!bounds) continue;
        targets.push(...sceneBoundsSnapTargets(bounds, item.key));
        continue;
      }
      const targetNode = item.kind === "text"
        ? item.textNode
        : item.kind === "svg"
          ? item.svgNode
          : item.imageNode;
      if (!targetNode.visible || targetNode.opacity <= 0) continue;
      targets.push(...sceneBoundsSnapTargets(
        this.transformNodeBounds(targetNode),
        item.key,
      ));
    }
    return targets;
  }

  private snapContextForInteraction(
    mode: InteractionMode,
    node: Readonly<TransformSceneNode>,
    view: Readonly<VectorTextViewState>,
    handle: SceneTransformHandle | "rotate" | null,
  ): ActiveSnapContext | null {
    if (
      !this.canvasGuides
      || (mode !== "move" && mode !== "scale" && mode !== "rotate")
      || (mode === "scale" && (handle === null || handle === "rotate"))
    ) return null;
    const localBounds = this.localBoundsForTransformNode(node);
    return {
      startBounds: this.transformNodeBounds(node, localBounds),
      localBounds,
      targets: sceneIndexedSnapTargets(this.snapTargetsForNode(node)),
      gridStep: adaptiveCanvasGridStep(view),
      handle: handle === "rotate" ? null : handle,
      translationLatch: { x: null, y: null },
      scaleLatch: null,
      rotationLatch: null,
    };
  }

  private eventCanvasPoint(event: PointerEvent): ScenePoint {
    const rectangle = this.interactionCanvas.getBoundingClientRect();
    return {
      x: (event.clientX - rectangle.left)
        / Math.max(1, rectangle.width) * this.interactionCanvas.width,
      y: (event.clientY - rectangle.top)
        / Math.max(1, rectangle.height) * this.interactionCanvas.height,
    };
  }

  private eventLayerPoint(event: PointerEvent): ScenePoint {
    return this.host.toLayerPoint({
      clientX: event.clientX,
      clientY: event.clientY,
      pressure: event.pressure || 0.5,
      timeMs: event.timeStamp,
    });
  }

  private hitHandle(
    point: ScenePoint,
    corners: readonly ScenePoint[],
    view: VectorTextViewState,
    node: Readonly<TransformSceneNode>,
  ): SceneTransformHandle | "rotate" | null {
    if (isRasterLayerTransformNode(node) && node.scope === "selection") return null;
    const backingPerCssPixel = view.canvasWidth / Math.max(1, view.cssWidth);
    const hitRadius = SCENE_TRANSFORM_HIT_RADIUS_CSS_PX * backingPerCssPixel;
    const rotationHandle = sceneOverlayRotationHandle(corners, node, view);
    return hitSceneTransformHandle(point, corners, rotationHandle, hitRadius);
  }

  private hitsTransformBody(
    point: ScenePoint,
    corners: readonly ScenePoint[],
    view: VectorTextViewState,
    node: Readonly<TransformSceneNode>,
  ): boolean {
    if (
      isRasterLayerTransformNode(node)
      && node.scope === "layer"
      && node.mode !== "affine"
    ) {
      const boundary = sceneRasterDeformBoundaryCanvasPoints(view, node);
      if (scenePointInPolygon(point, boundary)) return true;
      const backingPerCssPixel = view.canvasWidth / Math.max(1, view.cssWidth);
      const edgeReach = 8 * backingPerCssPixel;
      return boundary.some((start, index) =>
        scenePointToSegmentDistance(
          point,
          start,
          boundary[(index + 1) % boundary.length],
        ) <= edgeReach);
    }
    const includeSelectionEdgeReach = isRasterLayerTransformNode(node)
      && node.scope === "selection";
    const backingPerCssPixel = view.canvasWidth / Math.max(1, view.cssWidth);
    return hitsSceneTransformBody(
      point,
      corners,
      includeSelectionEdgeReach ? 22 * backingPerCssPixel : 0,
    );
  }

  private hitDistortPoint(
    point: ScenePoint,
    view: VectorTextViewState,
    node: Readonly<VectorTextNode>,
  ): number | null {
    const backingPerCssPixel = view.canvasWidth / Math.max(1, view.cssWidth);
    const hitRadius = SCENE_TRANSFORM_HIT_RADIUS_CSS_PX * backingPerCssPixel;
    return closestSceneControlPoint(
      point,
      sceneDistortCanvasPoints(view, node),
      hitRadius,
    );
  }

  private hitRasterDeformPoint(
    point: ScenePoint,
    view: VectorTextViewState,
    node: Readonly<TransformSceneNode>,
  ): number | null {
    if (
      !isRasterLayerTransformNode(node)
      || node.scope !== "layer"
      || node.mode === "affine"
    ) return null;
    const backingPerCssPixel = view.canvasWidth / Math.max(1, view.cssWidth);
    const points = sceneRasterDeformCanvasPoints(view, node);
    if (node.mode === "perspective") {
      return closestSceneControlPoint(
        point,
        points,
        SCENE_TRANSFORM_CORNER_HIT_RADIUS_CSS_PX * backingPerCssPixel,
      );
    }
    const size = rasterDeformGridSize(node.mode, node.gridSize);
    const cornerIndices = rasterWarpCornerIndices(size);
    const cornerOffset = closestSceneControlPoint(
      point,
      cornerIndices.map((index) => points[index]),
      SCENE_TRANSFORM_CORNER_HIT_RADIUS_CSS_PX * backingPerCssPixel,
    );
    return cornerOffset === null ? null : cornerIndices[cornerOffset];
  }

  private hitRasterBezierHandle(
    point: ScenePoint,
    view: VectorTextViewState,
    node: Readonly<TransformSceneNode>,
  ): number | null {
    if (
      !isRasterLayerTransformNode(node)
      || node.scope !== "layer"
      || node.mode !== "warp"
    ) return null;
    const backingPerCssPixel = view.canvasWidth / Math.max(1, view.cssWidth);
    return closestSceneControlPoint(
      point,
      sceneRasterWarpBezierCanvasHandles(view, node),
      SCENE_TRANSFORM_HIT_RADIUS_CSS_PX * backingPerCssPixel,
    );
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
    if (
      interaction.mode === "raster-control"
      && isRasterLayerTransformNode(interaction.startModel)
    ) {
      this.updateTransformNode(interaction.startModel, {
        controlPoints: interaction.startModel.controlPoints,
        bezierHandles: interaction.startModel.bezierHandles,
      });
      return;
    }
    if (interaction.mode !== "pan") {
      this.updateTransformNode(interaction.startModel, {
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
      "is-raster-control",
    );
    this.canvasGuides?.setSmartGuides([]);
    if (this.activeInteraction === interaction) this.activeInteraction = null;
  }

  private closeNewNoopTransformSession(interaction: ActiveInteraction): void {
    if (!interaction.openedTransformSession || !this.transformSessionOpen) return;
    this.host.commitVectorHistoryEdit();
    this.transformSessionOpen = false;
    this.transformSessionKind = null;
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
      this.beginViewGesture();
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
    if (this.transformCommitBusy || this.rasterTransformRecoveryOnly) return;
    const node = this.selectedTransformNode();
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
    const isRasterDeformEditing = isRasterLayerTransformNode(node)
      && node.scope === "layer"
      && node.mode !== "affine";
    const corners = isDistortEditing || isRasterDeformEditing
      ? []
      : sceneOverlayCorners(this.metrics, node, view);
    const handle = isDistortEditing || isRasterDeformEditing
      ? null
      : this.hitHandle(canvasPoint, corners, view, node);
    const distortPointIndex = isDistortEditing && textNode
      ? this.hitDistortPoint(canvasPoint, view, textNode)
      : null;
    let rasterControlPointIndex = isRasterDeformEditing
      ? this.hitRasterDeformPoint(canvasPoint, view, node)
      : null;
    let rasterBezierHandleIndex = isRasterDeformEditing
      ? this.hitRasterBezierHandle(canvasPoint, view, node)
      : null;
    if (
      isRasterDeformEditing
      && node.mode === "warp"
      && rasterControlPointIndex !== null
      && rasterBezierHandleIndex !== null
    ) {
      const controlPoint = sceneRasterDeformCanvasPoints(
        view,
        node,
      )[rasterControlPointIndex];
      const bezierPoint = sceneRasterWarpBezierCanvasHandles(
        view,
        node,
      )[rasterBezierHandleIndex];
      if (
        controlPoint
        && bezierPoint
        && scenePointDistance(canvasPoint, controlPoint)
          <= scenePointDistance(canvasPoint, bezierPoint)
      ) {
        rasterBezierHandleIndex = null;
      } else {
        rasterControlPointIndex = null;
      }
    }
    const shouldPan = event.button === 1
      || event.button === 2
      || (
        !isDistortEditing
        && !isRasterDeformEditing
        && rasterControlPointIndex === null
        && event.shiftKey
      );
    const mode: InteractionMode | null = shouldPan
      ? "pan"
      : isDistortEditing
        ? distortPointIndex === null ? null : "distort"
        : isRasterDeformEditing
          ? node.mode === "warp"
            ? rasterBezierHandleIndex !== null
              || rasterControlPointIndex !== null
              || this.hitsTransformBody(canvasPoint, corners, view, node)
              ? "raster-control"
              : null
            : rasterControlPointIndex !== null
              ? "raster-control"
              : this.hitsTransformBody(canvasPoint, corners, view, node)
                ? "move"
                : null
        : handle === "rotate"
          ? "rotate"
          : handle
            ? "scale"
            : this.hitsTransformBody(canvasPoint, corners, view, node)
              ? "move"
              : null;
    if (!mode) return;
    let openedTransformSession = false;
    if (mode !== "pan") {
      if (isRasterLayerTransformNode(node)) {
        if (!this.transformSessionOpen || this.transformSessionKind !== "raster") {
          void this.prepareSelectedRasterTransform();
          return;
        }
      } else {
        openedTransformSession = !this.transformSessionOpen;
        if (!this.host.beginVectorHistoryEdit("transform")) {
          return;
        }
        if (!this.transformSessionOpen) {
          this.transformSessionOpen = true;
          this.transformSessionKind = "vector";
          this.updateTransformCommitUi();
          this.syncControlsFromSelection(node);
        }
      }
    }

    event.preventDefault();
    if (isRasterLayerTransformNode(node) && node.scope === "selection") {
      this.interactionCanvas.focus({ preventScroll: true });
    }
    this.interactionCanvas.setPointerCapture(event.pointerId);
    const center = { x: node.x, y: node.y };
    const rasterWarpAnchorParameter = isRasterDeformEditing
      && node.mode === "warp"
      && rasterControlPointIndex === null
      && rasterBezierHandleIndex === null
      ? rasterWarpClosestSurfaceParameter(
        node.controlPoints,
        node.gridSize,
        layerPoint,
        node.bezierHandles,
      )
      : null;
    this.canvasGuides?.setSmartGuides([]);
    const startAngle = Math.atan2(layerPoint.y - center.y, layerPoint.x - center.x);
    this.activeInteraction = {
      pointerId: event.pointerId,
      mode,
      startClient: { x: event.clientX, y: event.clientY },
      startLayer: layerPoint,
      startModel: copyTransformNode(node),
      startDistance: Math.max(1e-6, scenePointDistance(layerPoint, center)),
      startAngle,
      lastAngle: startAngle,
      accumulatedRotation: 0,
      distortPointIndex,
      rasterControlPointIndex,
      rasterBezierHandleIndex,
      rasterWarpAnchorParameter,
      openedTransformSession,
      snap: this.snapContextForInteraction(mode, node, view, handle),
    };
    if (mode === "pan") this.beginViewGesture();
    this.interactionCanvas.classList.add(`is-${mode}`);
  }
  private movedDistortPoints(
    interaction: ActiveInteraction,
    layerPoint: ScenePoint,
    lockAxis: boolean,
  ): VectorTextDistortPoints | null {
    if (!isTextNode(interaction.startModel)) return null;
    const startPoints = interaction.startModel.distortPoints;
    const pointIndex = interaction.distortPointIndex;
    if (!startPoints || pointIndex === null) {
      return null;
    }
    const startLocal = sceneLayerToLocal(
      interaction.startLayer,
      interaction.startModel,
    );
    const currentLocal = sceneLayerToLocal(layerPoint, interaction.startModel);
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

  private movedRasterControlPoints(
    interaction: ActiveInteraction,
    layerPoint: ScenePoint,
    lockAxis: boolean,
  ): RasterTransformControlPoint[] | null {
    if (!isRasterLayerTransformNode(interaction.startModel)) return null;
    const pointIndex = interaction.rasterControlPointIndex;
    if (interaction.startModel.mode === "affine") return null;
    let deltaX = layerPoint.x - interaction.startLayer.x;
    let deltaY = layerPoint.y - interaction.startLayer.y;
    if (lockAxis) {
      if (Math.abs(deltaX) >= Math.abs(deltaY)) deltaY = 0;
      else deltaX = 0;
    }
    if (interaction.startModel.mode === "warp") {
      return moveRasterWarpControlPoints(
        interaction.startModel.controlPoints,
        interaction.startModel.gridSize,
        interaction.startLayer,
        deltaX,
        deltaY,
        pointIndex,
        interaction.rasterWarpAnchorParameter,
      );
    }
    if (pointIndex === null) return null;
    return interaction.startModel.controlPoints.map((point, index) =>
      index === pointIndex
        ? { x: point.x + deltaX, y: point.y + deltaY }
        : { ...point });
  }

  private movedRasterBezierHandles(
    interaction: ActiveInteraction,
    layerPoint: ScenePoint,
    lockAxis: boolean,
  ): RasterTransformControlPoint[] | null {
    if (
      !isRasterLayerTransformNode(interaction.startModel)
      || interaction.startModel.mode !== "warp"
      || interaction.rasterBezierHandleIndex === null
    ) return null;
    let deltaX = layerPoint.x - interaction.startLayer.x;
    let deltaY = layerPoint.y - interaction.startLayer.y;
    if (lockAxis) {
      if (Math.abs(deltaX) >= Math.abs(deltaY)) deltaY = 0;
      else deltaX = 0;
    }
    const index = interaction.rasterBezierHandleIndex;
    const start = interaction.startModel.bezierHandles[index];
    if (!start) return null;
    return [...moveRasterWarpBezierHandle(
      interaction.startModel.bezierHandles,
      interaction.startModel.controlPoints,
      interaction.startModel.gridSize,
      index,
      { x: start.x + deltaX, y: start.y + deltaY },
    )];
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
      const node = this.selectedTransformNode();
      if (
        node
        && isRasterLayerTransformNode(node)
        && this.transformToolActive
      ) {
        const view = this.host.getVectorTextViewState();
        const point = this.eventCanvasPoint(event);
        if (node.scope === "layer" && node.mode !== "affine") {
          const overControl = this.hitRasterDeformPoint(point, view, node) !== null;
          const overBezier = this.hitRasterBezierHandle(point, view, node) !== null;
          const overBody = this.hitsTransformBody(point, [], view, node);
          this.interactionCanvas.style.cursor = node.mode === "warp"
            ? overBezier || overControl || overBody ? "grab" : "default"
            : overControl ? "grab" : overBody ? "move" : "default";
        } else if (node.scope === "selection") {
          this.interactionCanvas.style.cursor = this.hitsTransformBody(
            point,
            sceneOverlayCorners(this.metrics, node, view),
            view,
            node,
          ) ? "move" : "default";
        }
      }
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
    if (interaction.mode === "raster-control") {
      const bezierHandles = this.movedRasterBezierHandles(
        interaction,
        layerPoint,
        event.shiftKey,
      );
      if (bezierHandles && isRasterLayerTransformNode(interaction.startModel)) {
        this.host.updateRasterLayerTransform({ bezierHandles });
        return;
      }
      const controlPoints = this.movedRasterControlPoints(
        interaction,
        layerPoint,
        event.shiftKey,
      );
      if (controlPoints && isRasterLayerTransformNode(interaction.startModel)) {
        const nextBezierHandles = interaction.startModel.mode === "warp"
          ? remapRasterWarpBezierHandles(
            interaction.startModel.controlPoints,
            interaction.startModel.gridSize,
            controlPoints,
            interaction.startModel.gridSize,
            interaction.startModel.bezierHandles,
            interaction.rasterControlPointIndex,
          )
          : [];
        this.host.updateRasterLayerTransform({
          controlPoints,
          bezierHandles: nextBezierHandles,
        });
      }
      return;
    }
    if (interaction.mode === "move") {
      const rawDelta = {
        x: layerPoint.x - interaction.startLayer.x,
        y: layerPoint.y - interaction.startLayer.y,
      };
      const preferences = this.canvasGuides?.getPreferences();
      const snapped = interaction.snap
        ? resolveSceneTranslationSnap({
          startBounds: interaction.snap.startBounds,
          rawDelta,
          targets: interaction.snap.targets,
          view: this.host.getVectorTextViewState(),
          gridStep: preferences?.grid ? interaction.snap.gridStep : null,
          previous: interaction.snap.translationLatch,
          quantizeStep: isRasterLayerTransformNode(interaction.startModel)
            && interaction.startModel.scope === "selection"
            ? 1
            : null,
          disabled: preferences?.snapping !== true || event.altKey,
        })
        : {
          delta: rawDelta,
          matches: [],
          latch: { x: null, y: null },
        };
      if (interaction.snap) interaction.snap.translationLatch = snapped.latch;
      this.canvasGuides?.setSmartGuides(snapped.matches);
      this.updateTransformNode(interaction.startModel, {
        x: interaction.startModel.x + snapped.delta.x,
        y: interaction.startModel.y + snapped.delta.y,
      });
    } else if (interaction.mode === "scale") {
      const distance = scenePointDistance(layerPoint, {
        x: interaction.startModel.x,
        y: interaction.startModel.y,
      });
      const rawScale = Math.min(
        MAXIMUM_SCALE,
        Math.max(
          MINIMUM_SCALE,
          interaction.startModel.scale * distance / interaction.startDistance,
        ),
      );
      const preferences = this.canvasGuides?.getPreferences();
      const snapped = interaction.snap?.handle
        ? resolveSceneScaleSnap({
          transform: interaction.startModel,
          localBounds: interaction.snap.localBounds,
          handle: interaction.snap.handle,
          rawScale,
          targets: interaction.snap.targets,
          view: this.host.getVectorTextViewState(),
          gridStep: preferences?.grid ? interaction.snap.gridStep : null,
          minScale: MINIMUM_SCALE,
          maxScale: MAXIMUM_SCALE,
          previous: interaction.snap.scaleLatch,
          disabled: preferences?.snapping !== true || event.altKey,
        })
        : { scale: rawScale, matches: [], latch: null };
      if (interaction.snap) interaction.snap.scaleLatch = snapped.latch;
      this.canvasGuides?.setSmartGuides(snapped.matches);
      this.updateTransformNode(interaction.startModel, {
        scale: snapped.scale,
      });
    } else if (interaction.mode === "rotate") {
      const angle = Math.atan2(
        layerPoint.y - interaction.startModel.y,
        layerPoint.x - interaction.startModel.x,
      );
      const angleIncrement = sceneWrappedAngleDelta(angle, interaction.lastAngle);
      interaction.accumulatedRotation += angleIncrement;
      interaction.lastAngle = angle;
      const rawRotation = interaction.startModel.rotation
        + interaction.accumulatedRotation;
      const preferences = this.canvasGuides?.getPreferences();
      const snapped = interaction.snap
        ? resolveSceneRotationSnap({
          transform: interaction.startModel,
          localBounds: interaction.snap.localBounds,
          rawRotation,
          handleRadius: interaction.startDistance,
          handleAngle: interaction.startAngle + interaction.accumulatedRotation,
          targets: interaction.snap.targets,
          view: this.host.getVectorTextViewState(),
          gridStep: preferences?.grid ? interaction.snap.gridStep : null,
          previous: interaction.snap.rotationLatch,
          disabled: preferences?.snapping !== true || event.altKey,
        })
        : { rotation: rawRotation, matches: [], latch: null };
      if (interaction.snap) interaction.snap.rotationLatch = snapped.latch;
      this.canvasGuides?.setSmartGuides(snapped.matches);
      this.updateTransformNode(interaction.startModel, {
        rotation: snapped.rotation,
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
        this.endViewGesture();
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
    if (interaction.mode === "pan") this.endViewGesture();
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
