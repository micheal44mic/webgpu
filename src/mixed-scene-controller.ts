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
  vectorTextSingleShadowLocalVector,
  type VectorTextOutlineJoin,
} from "./scene-vector-effects";
import {
  cloneVectorTextNode,
  type VectorTextNode,
} from "./scene-text-model";
import {
  cloneVectorSvgNode,
  type VectorSvgNode,
} from "./scene-svg-model";
import type { RasterImageNode } from "./scene-image-model";

import {
  VECTOR_TEXT_PRESENTATION_STRATEGY,
} from "./vector-text-shader";
import type {
  VectorTextGpuDraw,
  VectorTextPlacement,
  VectorTextViewState,
} from "./vector-text-types";
import {
  VectorTextFontGeometryRegistry,
} from "./vector-text-font-geometry";
import {
  VECTOR_TEXT_GPU_GEOMETRY_STRATEGY,
} from "./vector-text-effect-geometry";
import {
  VectorTextEffectCompilerClient,
  type VectorTextEffectMeshResult,
} from "./vector-text-effect-client";
import {
  buildVectorTextSlugData,
  vectorTextPathRevision,
} from "./vector-text-slug";
import {
  vectorTextLodForSigma,
} from "./vector-text-lod";
import {
  VECTOR_TEXT_SLUG_GPU_RENDER_STRATEGY,
} from "./vector-text-slug-gpu-shader";
import {
  VECTOR_TEXT_SINGLE_SHADOW_BLUR_STRATEGY,
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
  scenePointDistance,
  type ScenePoint,
  type SceneTransformHandle,
} from "./scene-transform-geometry";
import {
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
  sceneOverlayCorners,
} from "./scene-interaction-overlay";
import { resolveMixedSceneDom } from "./mixed-scene-dom";
import {
  currentMixedSceneTouchGesture,
  hitsMixedSceneTransformBody,
  mixedSceneDistortPoint,
  mixedSceneEventCanvasPoint,
  mixedSceneTransformHandle,
  mixedSceneTransformUpdate,
  movedMixedSceneDistortPoints,
  type MixedSceneActiveInteraction as ActiveInteraction,
  type MixedSceneInteractionMode as InteractionMode,
  type MixedSceneTouchNavigationGesture as TouchNavigationGesture,
} from "./mixed-scene-interaction-runtime";
import {
  planMixedSceneMeshDraw,
  planMixedSceneSlugBlurDraw,
  planMixedSceneSlugDraw,
  planMixedSceneSlugInnerShadowDraw,
  planMixedSceneSvgBlurDraw,
  retargetMixedSceneDraws,
  type MixedSceneTextGeometry as CachedTextGeometry,
} from "./mixed-scene-render-planner";
import { runMixedSceneVectorRasterHistoryProbe } from "./mixed-scene-history-probe";
import {
  beginMixedSceneVectorTransformHistory,
  createMixedSceneDefaultSvgSeed,
  createMixedSceneDefaultTextSeed,
  runMixedSceneTransformHistoryAction,
} from "./mixed-scene-command-history-runtime";
import type {
  MixedSceneControllerOptions,
  MixedSceneDiagnostics,
  MixedSceneHost,
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

const MEBIBYTE_BYTES = 1024 * 1024;
const FRAME_SAMPLE_LIMIT = 180;
const OUTLINE_JOIN_LABELS: Readonly<Record<VectorTextOutlineJoin, string>> = {
  bevel: "squadrata",
  miter: "a punta",
  round: "tonda",
};

function vectorRasterFormatLabel(format: LayerFormat): string {
  return format === "rgba16float" ? "RGBA16F lineare" : "RGBA8 lineare";
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
    const dom = resolveMixedSceneDom(options.root);
    this.presentationCanvas = dom.presentationCanvas;
    this.interactionCanvas = dom.interactionCanvas;
    this.interactionContext = dom.interactionContext;
    this.textRasterStatus = dom.textRasterStatus;
    this.svgFileInput = dom.svgFileInput;
    this.svgImportStatus = dom.svgImportStatus;
    this.imageFileInput = dom.imageFileInput;
    this.imageImportStatus = dom.imageImportStatus;
    this.transformCommitBar = dom.transformCommitBar;
    this.transformCommitLabel = dom.transformCommitLabel;
    this.transformApplyButton = dom.transformApplyButton;
    this.transformCancelButton = dom.transformCancelButton;
    this.status = dom.status;
    this.clippedRefreshPolicy = options.clippedRefreshPolicy ?? "during-gesture";
    this.onEditorStateChange = options.onEditorStateChange;
    this.effectCompiler = new VectorTextEffectCompilerClient(() => {
      this.handleEffectResourceReady();
    });
  }

  async initialize(): Promise<void> {
    await this.fontGeometry.preload();
    this.presentationCanvas.width = 1;
    this.presentationCanvas.height = 1;
    this.presentationCanvas.hidden = true;
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
    if (active) void this.prepareSelectedRasterTransform();
  }

  private updateTransformCommitUi(): void {
    const node = this.selectedTransformNode();
    const movesPixelSelection = Boolean(
      this.transformToolActive
      && node
      && isRasterLayerTransformNode(node)
      && node.scope === "selection",
    );
    this.transformCommitBar.hidden = !this.transformSessionOpen;
    this.transformCommitLabel.textContent = movesPixelSelection
      ? "Sposta selezione"
      : "Trasforma";
    this.transformCommitBar.setAttribute(
      "aria-label",
      movesPixelSelection ? "Conferma spostamento selezione" : "Conferma trasformazione",
    );
    this.interactionCanvas.tabIndex = movesPixelSelection ? 0 : -1;
    this.interactionCanvas.classList.toggle("is-pixel-selection", movesPixelSelection);
    this.interactionCanvas.setAttribute(
      "aria-label",
      movesPixelSelection
        ? "Sposta selezione pixel"
        : "Selezione e trasformazione degli elementi",
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
      await runMixedSceneTransformHistoryAction(
        this.host,
        rasterSession ? "raster" : "vector",
        "apply",
      );
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
        ? `Applicazione Trasforma non riuscita: ${error.message}`
        : "Applicazione Trasforma non riuscita.";
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
      await runMixedSceneTransformHistoryAction(
        this.host,
        rasterSession ? "raster" : "vector",
        "cancel",
      );
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
        ? `Annullamento Trasforma non riuscito: ${error.message}`
        : "Annullamento Trasforma non riuscito.";
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
      this.interactionCanvas.classList.remove(
        "is-move",
        "is-scale",
        "is-rotate",
        "is-pan",
        "is-distort",
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
        createMixedSceneDefaultTextSeed(
          this.host.documentWidth,
          this.host.documentHeight,
          textCount,
          color,
        ),
        `Testo ${textCount + 1}`,
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
    this.updateSelectedNode(createMixedSceneDefaultTextSeed(
      this.host.documentWidth,
      this.host.documentHeight,
      Math.max(0, node.id - 1),
      node.color,
    ));
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
      throw new Error("Concludi prima l’operazione vettoriale corrente.");
    }
    return await runMixedSceneVectorRasterHistoryProbe({
      host: this.host,
      syncScene: (snapshot) => this.syncScene(snapshot),
      defaultTextSeed: (index, color) => createMixedSceneDefaultTextSeed(
        this.host.documentWidth,
        this.host.documentHeight,
        index,
        color,
      ),
      defaultSvgSeed: (documentValue) => createMixedSceneDefaultSvgSeed(
        this.host.documentWidth,
        this.host.documentHeight,
        documentValue,
      ),
      rasterizeSelectedText: () => this.rasterizeSelectedText(),
      rasterizeSelectedSvg: () => this.rasterizeSelectedSvg(),
    });
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
    const defaults = node ?? createMixedSceneDefaultTextSeed(
      this.host.documentWidth,
      this.host.documentHeight,
      0,
    );
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
        createMixedSceneDefaultSvgSeed(
          this.host.documentWidth,
          this.host.documentHeight,
          documentValue,
        ),
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
      const imported = await this.host.importRasterImageFile(file);
      const sourceMiB = imported.sourceBytes / MEBIBYTE_BYTES;
      this.setImageImportStatus(
        `${imported.name} importata subito come raster · `
        + `${imported.sourceWidth}×${imported.sourceHeight} px · ${imported.tileCount} tile · `
        + `${sourceMiB.toFixed(2)} MiB file. Pennello, Riempimento ed effetti già attivi.`,
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
        x: transform?.scope === "selection" ? transform.x : centerX,
        y: transform?.scope === "selection" ? transform.y : centerY,
        scale: 1,
        rotation: 0,
        sourceBounds: { ...bounds },
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
      x: transform?.x ?? centerX,
      y: transform?.y ?? centerY,
      scale: transform?.scale ?? 1,
      rotation: transform?.rotation ?? 0,
      sourceBounds: { ...bounds },
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
    this.status.textContent = `Preparo Trasforma GPU per ${node.name}…`;
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
      this.transformSessionOpen = true;
      this.transformSessionKind = "raster";
      this.rasterTransformRecoveryOnly = false;
      this.updateTransformCommitUi();
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
        : "Trasforma raster WebGPU non disponibile.";
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
      throw new Error("Un'altra operazione sulla scena è ancora in corso.");
    }
    this.sceneOperationBusy = true;
    this.syncControlsFromSelection(this.selectedVectorNode());
    const rasterSlots = new Set<string>();
    try {
      const view = this.vectorRasterView();
      for (;;) {
        const revision = this.effectCompiler.resourceRevisionValue();
        const snapshot = this.host.getMixedSceneSnapshot();
        if (!snapshot) throw new Error("Scena mista non disponibile.");
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
            "Gli elementi da unire sono cambiati o non sono più consecutivi.",
          );
        }

        let allEffectsReady = true;
        const vectorDraws: MergeMixedSceneItemsRequest["vectorDraws"][number][] = [];
        for (const key of keys) {
          const item = snapshot.items.find((candidate) => candidate.key === key);
          if (!item) throw new Error(`Elemento ${key} assente durante il merge.`);
          if (item.kind === "raster") continue;
          if (item.kind === "image") {
            throw new Error("La v1 del merge non supporta ancora i nodi immagine.");
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
          throw new Error(`Preparazione vettori per merge fallita: ${diagnostics.lastError}`);
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
              current.name + " rasterizzato in "
              + vectorRasterFormatLabel(result.format) + " · MSAA 4× · "
              + result.chunkCount + " blocchi 512 px · "
              + result.tileCount + " tile 256 px.";
            this.setTextRasterStatus(message);
            this.status.textContent = message;
            return result;
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
    return rasterized ?? null;
  }

  private async rasterizeSelectedSvg(): Promise<VectorRasterizationResult | null> {
    const selected = this.selectedSvgNode();
    if (!selected) return null;
    const svgId = selected.id;
    const rasterized = await this.runSceneOperation(async () => {
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
              `${current.name} rasterizzato in ${vectorRasterFormatLabel(result.format)} · MSAA 4× · `
              + `${result.chunkCount} blocchi 512 px · ${result.tileCount} tile 256 px.`,
            );
            return result;
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
      const pixelSelectionMove = Boolean(
        node
        && isRasterLayerTransformNode(node)
        && node.scope === "selection"
        && this.transformSessionKind === "raster"
      );
      if (
        arrow
        && pixelSelectionMove
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
            : "Spostamento della Selezione pixel non riuscito.";
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
        : "Modifica della scena testo/raster non riuscita.";
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
    update: Partial<Pick<RasterTransformSnapshot, "x" | "y" | "scale" | "rotation">>,
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
        draws.push(planMixedSceneSvgBlurDraw(node, silhouetteMesh, view, "outer"));
      } else {
        const vector = vectorTextSingleShadowLocalVector(
          node.singleShadowOffset,
          node.singleShadowAngle,
        );
        draws.push(planMixedSceneMeshDraw(
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
          draws.push(planMixedSceneMeshDraw(
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
          draws.push(planMixedSceneMeshDraw(
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
        draws.push(planMixedSceneMeshDraw(
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
          draws.push(planMixedSceneMeshDraw(
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
      draws.push(planMixedSceneSvgBlurDraw(node, silhouetteMesh, view, "inner"));
    }
    return allEffectsReady;
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
        draws.push(planMixedSceneSlugBlurDraw(node, geometry, view));
      } else {
        const vector = vectorTextSingleShadowLocalVector(
          node.singleShadowOffset,
          node.singleShadowAngle,
        );
        draws.push(planMixedSceneSlugDraw(
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
          draws.push(planMixedSceneMeshDraw(
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
          draws.push(planMixedSceneMeshDraw(
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
        draws.push(planMixedSceneMeshDraw(
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
      draws.push(planMixedSceneSlugDraw(
        node,
        `text:${node.id}:slug`,
        geometry.slug,
        node.color,
        node.opacity,
      ));
    }
    if (node.innerShadowEnabled && node.innerShadowOpacity > 0) {
      draws.push(planMixedSceneSlugInnerShadowDraw(node, geometry, view));
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
            const retargeted = retargetMixedSceneDraws(displayedDraws, node);
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
        const centerX = source.x + source.width * 0.5;
        const centerY = source.y + source.height * 0.5;
        this.metrics = {
          left: source.x - centerX,
          top: source.y - centerY,
          right: source.x + source.width - centerX,
          bottom: source.y + source.height - centerY,
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

  private eventCanvasPoint(event: PointerEvent): ScenePoint {
    return mixedSceneEventCanvasPoint(event, this.interactionCanvas);
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
    return mixedSceneTransformHandle(point, corners, view, node);
  }

  private hitsTransformBody(
    point: ScenePoint,
    corners: readonly ScenePoint[],
    view: VectorTextViewState,
    node: Readonly<TransformSceneNode>,
  ): boolean {
    return hitsMixedSceneTransformBody(point, corners, view, node);
  }

  private hitDistortPoint(
    point: ScenePoint,
    view: VectorTextViewState,
    node: Readonly<VectorTextNode>,
  ): number | null {
    return mixedSceneDistortPoint(point, view, node);
  }

  private currentTouchNavigationGesture(): TouchNavigationGesture | null {
    return currentMixedSceneTouchGesture(this.touchContacts);
  }

  private restoreInteractionStart(interaction: ActiveInteraction): void {
    if (interaction.mode === "distort" && isTextNode(interaction.startModel)) {
      this.updateSelectedNode({ distortPoints: interaction.startModel.distortPoints });
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
    );
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
    const corners = isDistortEditing
      ? []
      : sceneOverlayCorners(this.metrics, node, view);
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
        if (!beginMixedSceneVectorTransformHistory(this.host)) {
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
    this.activeInteraction = {
      pointerId: event.pointerId,
      mode,
      startClient: { x: event.clientX, y: event.clientY },
      startLayer: layerPoint,
      startModel: copyTransformNode(node),
      startDistance: Math.max(1e-6, scenePointDistance(layerPoint, center)),
      startAngle: Math.atan2(layerPoint.y - center.y, layerPoint.x - center.x),
      distortPointIndex,
      openedTransformSession,
    };
    if (mode === "pan") this.beginViewGesture();
    this.interactionCanvas.classList.add(`is-${mode}`);
  }
  private movedDistortPoints(
    interaction: ActiveInteraction,
    layerPoint: ScenePoint,
    lockAxis: boolean,
  ) {
    return movedMixedSceneDistortPoints(interaction, layerPoint, lockAxis);
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
        && node.scope === "selection"
        && this.transformToolActive
      ) {
        const view = this.host.getVectorTextViewState();
        const point = this.eventCanvasPoint(event);
        this.interactionCanvas.style.cursor = this.hitsTransformBody(
          point,
          sceneOverlayCorners(this.metrics, node, view),
          view,
          node,
        ) ? "move" : "default";
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
    const update = mixedSceneTransformUpdate(interaction, layerPoint);
    if (update) this.updateTransformNode(interaction.startModel, update);
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
