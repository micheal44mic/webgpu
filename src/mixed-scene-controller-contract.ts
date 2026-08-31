import type {
  LayerFormat,
  MixedSceneSnapshot,
  PointerSample,
  RasterTransformSnapshot,
} from "./engine-types";
import type { PixelSelectionState } from "./selection-core";
import type { MergeMixedSceneItemsRequest } from "./layer-merge-core";
import type { LayerMergeResult } from "./engine-layer-merge-runtime";
import { MIXED_SCENE_STACK_STRATEGY, type MixedSceneItem } from "./mixed-scene-stack";
import {
  VECTOR_TEXT_BLOCK_SHADOW_STRATEGY,
  VECTOR_TEXT_INNER_SHADOW_STRATEGY,
  VECTOR_TEXT_OUTLINE_STRATEGY,
  VECTOR_TEXT_SINGLE_SHADOW_STRATEGY,
} from "./scene-vector-effects";
import type { RasterImageNode } from "./scene-image-model";
import type { VectorSvgNode, VectorSvgNodeSeed } from "./scene-svg-model";
import type { VectorTextNode, VectorTextNodeSeed } from "./scene-text-model";
import { VECTOR_TEXT_PRESENTATION_STRATEGY } from "./vector-text-shader";
import type {
  VectorTextGpuDraw,
  VectorTextGpuPresentationStats,
  VectorTextPlacement,
  VectorTextViewState,
} from "./vector-text-types";
import type { VectorGeometryGpuDiagnostics } from "./engine-vector-text-resources";
import { VECTOR_TEXT_GPU_GEOMETRY_STRATEGY } from "./vector-text-effect-geometry";
import { VECTOR_TEXT_SLUG_GPU_RENDER_STRATEGY } from "./vector-text-slug-gpu-shader";
import { VECTOR_TEXT_SINGLE_SHADOW_BLUR_STRATEGY } from "./vector-text-single-shadow";
import {
  VECTOR_TEXT_ADAPTIVE_ZOOM_STRATEGY,
  type VectorTextFastPresentationMode,
} from "./vector-text-adaptive-zoom";
import { VECTOR_TEXT_TRANSFORM_STRATEGY } from "./vector-text-transform.ts";
import type { EditorGuidePreferences } from "./editor-settings-storage";
import type { SceneSnapMatch } from "./scene-transform-snap";
import type { RasterTransformMode } from "./raster-deform-math";
import type { MixedSceneRasterTransformPreview } from "./mixed-scene-raster-transform-preview";

export interface VectorRasterizationResult {
  readonly layerId: number;
  readonly chunkCount: number;
  readonly tileCount: number;
  readonly format: LayerFormat;
  readonly seedFormat: LayerFormat;
}

export interface VectorRasterHistoryGpuProbe {
  readonly sourceKind: "text" | "svg";
  readonly format: LayerFormat;
  readonly seedFormat: LayerFormat;
  readonly rawByteLength: number;
  readonly rawBytesPerPixel: number;
  readonly nonZeroAlphaPixels: number;
  readonly undoReturned: boolean;
  readonly undoRestoredVector: boolean;
  readonly undoPreservedBackgroundBytes: boolean;
  readonly redoReturned: boolean;
  readonly redoRestoredRaster: boolean;
  readonly redoRestoredRawBytesExactly: boolean;
}

export interface VectorRasterHistoryGpuTestReport {
  readonly passed: boolean;
  readonly probes: readonly VectorRasterHistoryGpuProbe[];
}

export type VectorTextClippedRefreshPolicy = "during-gesture" | "on-release";

export interface MixedSceneGroupTransformUpdate {
  readonly key: MixedSceneItem["key"];
  readonly x: number;
  readonly y: number;
  /** Compatibility alias for callers that still read one uniform scale. */
  readonly scale: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly rotation: number;
}

export interface MixedSceneControllerOptions {
  readonly root: ParentNode;
  readonly browser: Window;
  readonly clippedRefreshPolicy?: VectorTextClippedRefreshPolicy;
  readonly onEditorStateChange?: () => void;
  readonly runWithLoading?: <Result>(
    label: string,
    operation: () => Promise<Result>,
    options?: MixedSceneLoadingOptions,
  ) => Promise<Result>;
  readonly canvasGuides?: {
    readonly getPreferences: () => Readonly<EditorGuidePreferences>;
    readonly setSmartGuides: (guides: readonly SceneSnapMatch[]) => void;
  };
}

export interface MixedSceneLoadingOptions {
  readonly revealImmediately?: boolean;
  readonly waitForPaint?: boolean;
}

/** Narrow engine-facing port required by the mixed-scene editor. */
export interface MixedSceneHost {
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly vectorGpuResourceSharingEnabled: boolean;
  /** Compatibility maximum edge for legacy callers and scalar stress limits. */
  readonly layerSize: number;
  getVectorTextViewState(): VectorTextViewState;
  getMixedSceneSnapshot(): MixedSceneSnapshot | null;
  /** Trusted runtime view that may share immutable vector documents. */
  getMixedSceneRuntimeSnapshot?(): MixedSceneSnapshot | null;
  getHistoryState(): { actionCount: number; cursor: number };
  ensureMixedSceneEditorResources(): Promise<void>;
  readLayerPixels(
    rect?: { x: number; y: number; width: number; height: number },
    layerIndex?: number,
  ): Promise<Uint8Array>;
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  waitForIdle(): Promise<void>;
  getPixelSelectionState(): PixelSelectionState;
  toLayerPoint(sample: PointerSample): { x: number; y: number };
  updateVectorTextGpuPresentation(
    placement: VectorTextPlacement,
    draws: readonly VectorTextGpuDraw[],
  ): VectorTextGpuPresentationStats;
  rebuildVectorTextGpuFallbackPresentation(
    view: Readonly<VectorTextViewState>,
    runs: readonly {
      placement: VectorTextPlacement;
      draws: readonly VectorTextGpuDraw[];
    }[],
  ): { textureCount: number; gpuMemoryMiB: number };
  isPaintStrokeActive(): boolean;
  clearVectorTextPresentation(placement?: VectorTextPlacement): void;
  clearVectorTextFallbackPresentation(): void;
  setVectorTextFastPresentationEnabled(enabled: boolean): void;
  getVectorTextFastPresentationMode(): VectorTextFastPresentationMode;
  getVectorTextFastPresentationBackpressureStats(): {
    submissionCount: number;
    coalescedRequestCount: number;
  };
  waitForVectorTextPresentationCompletion(): Promise<void>;
  getVectorGeometryGpuDiagnostics(): VectorGeometryGpuDiagnostics;
  pruneVectorTextGpuMeshes(activeResourceKeys: ReadonlySet<string>): void;
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
  ): Promise<VectorRasterizationResult>;
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
  ): Promise<VectorRasterizationResult>;
  mergeMixedSceneItems(request: MergeMixedSceneItemsRequest): Promise<LayerMergeResult>;
  importRasterImageFile(file: File): Promise<{
    layerId: number;
    name: string;
    sourceName: string;
    mimeType: string;
    sourceWidth: number;
    sourceHeight: number;
    sourceBytes: number;
    tileCount: number;
  }>;
  updateRasterImageNode(
    id: number,
    update: Partial<Omit<RasterImageNode, "id" | "kind" | "document" | "visible" | "opacity">>,
  ): Readonly<RasterImageNode>;
  moveRasterImageNode(id: number, delta: -1 | 1): Promise<boolean>;
  deleteRasterImageNode(id: number): Promise<Readonly<RasterImageNode>>;
  beginRasterLayerTransform(mode?: RasterTransformMode): Promise<RasterTransformSnapshot | null>;
  prewarmRasterTransformPrograms(mode?: RasterTransformMode): Promise<void>;
  updateRasterLayerTransform(
    update: Partial<Pick<
      RasterTransformSnapshot,
      | "x"
      | "y"
      | "scale"
      | "scaleX"
      | "scaleY"
      | "rotation"
      | "mode"
      | "gridSize"
      | "controlPoints"
      | "bezierHandles"
    >>,
  ): RasterTransformSnapshot;
  nudgeRasterLayerTransform(deltaX: number, deltaY: number): RasterTransformSnapshot;
  commitRasterLayerTransform(): Promise<boolean>;
  cancelRasterLayerTransform(): Promise<boolean>;
  setMixedSceneRasterTransformPreview(
    transforms: readonly MixedSceneRasterTransformPreview[],
  ): Promise<void>;
  updateMixedSceneRasterTransformPreview(
    transforms: readonly MixedSceneRasterTransformPreview[],
  ): void;
  clearMixedSceneRasterTransformPreview(): Promise<void>;
  beginMixedSceneGroupTransform(
    orderedKeys: readonly MixedSceneItem["key"][],
  ): Promise<boolean>;
  updateMixedSceneGroupTransform(
    updates: readonly MixedSceneGroupTransformUpdate[],
  ): void;
  commitMixedSceneGroupTransform(): Promise<boolean>;
  cancelMixedSceneGroupTransform(): Promise<boolean>;
  zoomBy(factor: number, clientX?: number, clientY?: number): void;
  panByClientDelta(deltaClientX: number, deltaClientY: number): void;
  beginViewRotationGesture(): void;
  rotateViewBy(deltaRadians: number, clientX?: number, clientY?: number): void;
  endViewRotationGesture(): void;
}

export interface MixedSceneDiagnostics {
  readonly sceneStrategy: typeof MIXED_SCENE_STACK_STRATEGY;
  readonly livePresentationStrategy: typeof VECTOR_TEXT_PRESENTATION_STRATEGY;
  readonly outlineStrategy: typeof VECTOR_TEXT_OUTLINE_STRATEGY;
  readonly blockShadowStrategy: typeof VECTOR_TEXT_BLOCK_SHADOW_STRATEGY;
  readonly singleShadowStrategy: typeof VECTOR_TEXT_SINGLE_SHADOW_STRATEGY;
  readonly innerShadowStrategy: typeof VECTOR_TEXT_INNER_SHADOW_STRATEGY;
  readonly singleShadowBlurStrategy: typeof VECTOR_TEXT_SINGLE_SHADOW_BLUR_STRATEGY;
  readonly adaptiveZoomStrategy: typeof VECTOR_TEXT_ADAPTIVE_ZOOM_STRATEGY;
  readonly transformStrategy: typeof VECTOR_TEXT_TRANSFORM_STRATEGY;
  readonly adaptiveZoomEnabled: boolean;
  readonly zoomRenderMode: "precise" | "fast";
  readonly zoomFastPresentationMode: VectorTextFastPresentationMode;
  readonly zoomFastModeArmed: boolean;
  readonly zoomClippedRefreshPolicy: VectorTextClippedRefreshPolicy;
  readonly zoomSlowFrameStreak: number;
  readonly zoomFastActivationCount: number;
  readonly zoomExactRecoveryCount: number;
  readonly lastViewRenderEndToEndMs: number;
  readonly lastAdaptiveZoomTriggerRenderMs: number;
  readonly lastAdaptiveZoomTriggerEndToEndMs: number;
  readonly zoomViewRevision: number;
  readonly zoomViewEventCount: number;
  readonly zoomSafeReprojectionCount: number;
  readonly zoomFallbackReprojectionCount: number;
  readonly zoomClippedReprojectionCount: number;
  readonly zoomUnsafeExactRefreshCount: number;
  readonly zoomUnsafeExactRefreshCompletedCount: number;
  readonly zoomUnsafeExactCoalescedCount: number;
  readonly zoomUnsafeExactRefreshInFlight: boolean;
  readonly zoomUnsafeExactRefreshRequestPending: boolean;
  readonly zoomFastPresentationSubmissionCount: number;
  readonly zoomFastPresentationCoalescedRequestCount: number;
  readonly fallbackPresentationReady: boolean;
  readonly fallbackPresentationRebuildCount: number;
  readonly selectedKey: MixedSceneItem["key"] | null;
  readonly textNodeCount: number;
  readonly renderCount: number;
  readonly lastRenderMs: number;
  readonly renderP95Ms: number;
  readonly liveGpuMemoryMiB: number;
  readonly viewportTextureCount: number;
  readonly viewportCanvasLogicalMiB: number;
  readonly vectorFontLogicalMiB: number;
  readonly svgStrokeLodCacheLogicalMiB: number;
  readonly svgStrokeLodCacheEntries: number;
  readonly svgStrokeLodFallbackCount: number;
  readonly blockShadowPathLogicalMiB: number;
  readonly singleShadowBrowserLogicalMiB: number;
  readonly singleShadowCacheLogicalMiB: number;
  readonly singleShadowScratchLogicalMiB: number;
  readonly singleShadowGpuLogicalMiB: number;
  readonly singleShadowCacheEntries: number;
  readonly gpuGeometryStrategy: typeof VECTOR_TEXT_GPU_GEOMETRY_STRATEGY;
  readonly gpuRenderStrategy: typeof VECTOR_TEXT_SLUG_GPU_RENDER_STRATEGY;
  readonly vectorGpuResourceSharingEnabled: boolean;
  readonly vectorGeometryGpu: VectorGeometryGpuDiagnostics;
  readonly effectWorkerPendingJobs: number;
  readonly effectWorkerFailedJobs: number;
  readonly effectWorkerLastError: string | null;
  readonly atomicEffectHoldCount: number;
  readonly atomicEffectPendingNodes: number;
}
