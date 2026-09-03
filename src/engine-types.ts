/**
 * Tipi pubblici del motore: quello che l'interfaccia utente, i benchmark e gli
 * strumenti DEV consumano davvero. Nessuna dipendenza da WebGPU o dal DOM.
 */
import type { RasterBevelEncodeResult } from "./bevel-renderer";
import { EFFECTS_WORKING_SET_STRATEGY } from "./effects-workbench";
import type { EngineStats } from "./engine-stats";
import type { DirtyRect } from "./engine-stroke-types";
import {
  MIXED_SCENE_STACK_STRATEGY,
  type MixedSceneItem,
} from "./mixed-scene-stack";
import type { VectorTextNode } from "./scene-text-model";
import type { VectorSvgNode } from "./scene-svg-model";
import type { RasterImageNode } from "./scene-image-model";
import type { RasterShadowEncodeResult } from "./shadow-renderer";
import type { RasterStrokeEncodeResult } from "./stroke-renderer";
import type { PixelSelectionState } from "./selection-core";
import type { VectorTextViewState } from "./vector-text-types";
import { DEFAULT_BRUSH_DEFINITION_SETTINGS } from "./brush-definition.ts";
import type { BrushShapeSequenceMode } from "./brush-shape-sequence-core.ts";
import type {
  RasterTransformControlPoint,
  RasterTransformMode,
  RasterWarpGridSize,
} from "./raster-deform-math";

/**
 * The UI exposes only the three measured rendering modes. The legacy values
 * remain accepted so old history/benchmark payloads can still be replayed:
 * `m1-glaze` is the old internal name for Light Glaze MAX coverage, while
 * `normal`/`additive` are retained for deterministic internal/background work.
 */
export type BlendMode =
  | "light-glaze"
  | "uniformed-glaze"
  | "intense-blending"
  | "normal"
  | "additive"
  | "m1-glaze";

export type BrushTool = "paint" | "erase" | "blend";

export type LayerFormat = "rgba8unorm" | "rgba16float";

/** Color-domain contract of the authoritative premultiplied document bytes. */
export type DocumentStorageColorSpace =
  | "linear-premultiplied"
  | "encoded-srgb-premultiplied";

export type PaintDabProfile =
  | "default"
  | "direct-deposit-pressure-size"
  | "encoded-srgb-rgba8";

/** CPU implementation selected once when a gesture begins. */
export type StrokeGeometryBackendPreference =
  | "auto"
  | "javascript"
  | "wasm"
  | "wasm-packed-required";

export type DisplayCompositingColorSpace =
  | "linear-light"
  | "encoded-srgb"
  | "stored-encoded-srgb";

export type BrushShape = "circle" | "shape";

/** Analytic radial falloff used by round tips; sampled Shape assets ignore it. */
export type BrushTipFalloff = "standard" | "gaussian";

export type CustomBrushShapeAssetId = `custom-shape:${string}`;

export type BrushShapeAssetId = "legacy-shape" | "pencil-shape" | CustomBrushShapeAssetId;

export type BrushShapeRotation = "fixed" | "follow-stroke";

export type { BrushShapeSequenceMode };

/** Runtime brush-signal precision; both modes stay resident in R16F on the GPU. */
export type BrushShapeMaskFormat = "r8unorm" | "r16float";

export type GrainMode = "off" | "texturized" | "moving";

export type CustomBrushGrainAssetId = `custom-grain:${string}`;

export type BrushGrainAssetId = "pencil-grain" | CustomBrushGrainAssetId;

export type GrainFiltering = "no" | "classic" | "improved";

export type GrainBlendMode = "multiply";

export type AdaptiveSpacingTriggerReason = "probe-timeout" | "slow-completion";

export interface BrushSettings {
  tool: BrushTool;
  shape: BrushShape;
  /** Optional for compatibility with brush definitions written before this field. */
  tipFalloff?: BrushTipFalloff;
  /** Stable source identity; old settings without it normalize to legacy-shape. */
  shapeAssetId: BrushShapeAssetId;
  /**
   * Ordered Shape sources. Successive base stamps select these layers
   * cyclically; legacy settings omit the field and use `shapeAssetId` only.
   */
  shapeAssetIds?: readonly BrushShapeAssetId[];
  /** Selects Shape layers in authored order or with deterministic randomization. */
  shapeSequenceMode: BrushShapeSequenceMode;
  /** User polarity applied after the source asset's authored polarity. */
  shapeInvert: boolean;
  /** Diagnostic 8-bit quantization or the unmodified high-precision source. */
  shapeMaskFormat: BrushShapeMaskFormat;
  shapeRotation: BrushShapeRotation;
  shapeScatter: number;
  grainMode: GrainMode;
  /** Stable source identity; old or removed sources normalize to pencil-grain. */
  grainAssetId: BrushGrainAssetId;
  grainScale: number;
  /** Moving-grain roller amount: 0 drags with the stamp, 1 approaches Texturized. */
  grainMovement: number;
  grainDepth: number;
  grainBrightness: number;
  grainContrast: number;
  grainInvert: boolean;
  grainFiltering: GrainFiltering;
  grainBlendMode: GrainBlendMode;
  /** Encoded-sRGB #RRGGBB or native #RRRRGGGGBBBB brush color. */
  color: string;
  size: number;
  spacingPercent: number;
  /** Geometric stroke stabilization amount, normalized to 0..1. */
  stabilization: number;
  startThickness: number;
  endThickness: number;
  count: number;
  flow: number;
  opacity: number;
  hardness: number;
  blendIntensity: number;
  blendMode: BlendMode;
  blendStretch: number;
  blendPaint: number;
  /** Local Gaussian blur mixed into the layer content under the Blend mask. */
  blendBlur: number;
  // Retained only for history/settings ABI compatibility; always normalized to 1.
  jitterMaster: number;
  hueJitterDegrees: number;
  saturationJitter: number;
  lightnessJitter: number;
  darknessJitter: number;
  jitterPerCopy: boolean;
  positionJitterLateral: number;
  positionJitterLinear: number;
}

export interface AdaptiveSpacingEvent {
  offsetMs: number;
  reason: AdaptiveSpacingTriggerReason;
  spacingPercent: number;
  extraPercentPoints: number;
  backlogBaseStamps: number;
  generatedBaseStamps: number;
}

export interface PointerSample {
  clientX: number;
  clientY: number;
  pressure: number;
  timeMs: number;
}

/** Compact document-space geometry for the live raster Transform overlay. */
export interface RasterTransformSnapshot {
  layerId: number;
  scope: "layer" | "selection";
  /** Affine keeps the classic box; Warp and Perspective expose movable points. */
  mode: RasterTransformMode;
  /** Remembered Warp density. Perspective always renders a 2×2 corner grid. */
  gridSize: RasterWarpGridSize;
  /** Row-major destination points; empty while mode is affine. */
  controlPoints: readonly RasterTransformControlPoint[];
  /** Eight independent corner tangents while mode is Warp; empty otherwise. */
  bezierHandles: readonly RasterTransformControlPoint[];
  x: number;
  y: number;
  /** @deprecated Compatibility alias for `scaleX`. */
  scale: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  sourceBounds: DirtyRect;
  /** Exact affine pivot used by the raster runtime; older snapshots may omit it. */
  sourcePivot?: { x: number; y: number };
  resultBounds: DirtyRect | null;
}

export interface MixedSceneSnapshot {
  strategy: typeof MIXED_SCENE_STACK_STRATEGY;
  selectedKey: MixedSceneItem["key"];
  activeRasterLayerId: number;
  previewTextNodeId: number | null;
  /** Structural break used only while the shape tool owns a live GPU preview. */
  shapePreviewAfterKey: MixedSceneItem["key"] | null;
  items: readonly (
    | {
      key: `raster:${number}`;
      kind: "raster";
      rasterLayerId: number;
      rasterLayerIndex: number;
      rasterLayerName: string;
      rasterVisible: boolean;
      rasterOpacity: number;
      /** Null for a base raster; otherwise this ordinary raster is clipped by the parent alpha. */
      rasterClippingParentId: number | null;
      rasterHasContent: boolean;
      rasterContentBounds: DirtyRect | null;
      rasterTransform: RasterTransformSnapshot | null;
      /** Generic scene relation; may target a raster, editable text, or SVG base. */
      clippingParentKey: MixedSceneItem["key"] | null;
    }
    | {
      key: `text:${number}`;
      kind: "text";
      textNode: Readonly<VectorTextNode>;
      clippingParentKey: MixedSceneItem["key"] | null;
    }
    | {
      key: `svg:${number}`;
      kind: "svg";
      svgNode: Readonly<VectorSvgNode>;
      clippingParentKey: MixedSceneItem["key"] | null;
    }
    | {
      key: `image:${number}`;
      kind: "image";
      imageNode: Readonly<RasterImageNode>;
      clippingParentKey: null;
    }
  )[];
}

export interface ShapePreviewState {
  readonly kind: "rectangle" | "ellipse" | "star";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly color: string;
}

export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  busy: boolean;
  /** A rollback failed; editing stays locked until the page is reloaded. */
  inconsistent: boolean;
  actionCount: number;
  cursor: number;
  storedBaseStamps: number;
  logicalStampBytes: number;
  /** Null only when the corresponding operation can start immediately. */
  undoBlockedReason: string | null;
  redoBlockedReason: string | null;
  /** Proprietà continue o operazioni raster transazionali aperte. */
  openEdit:
    | "property"
    | "raster-property"
    | "layer-options"
    | "fill"
    | "transform"
    | "gaussian-blur"
    | "spatial-blur"
    | "motion-blur"
    | "noise"
    | "glass"
    | "curves"
    | "color-adjust"
    | "color-balance"
    | "gradient-map"
    | "liquify"
    | null;
}

export interface BenchmarkResult {
  baseStamps: number;
  logicalCopies: number;
  cpuSubmitMs: number;
  gpuCompletionMs: number;
  estimatedCoveredFragments: number;
  strategy: string;
}

export interface EffectsWorkbenchRetargetResult {
  strategy: typeof EFFECTS_WORKING_SET_STRATEGY;
  generation: number;
  layerFormat: LayerFormat;
  contentBounds: DirtyRect | null;
  contentPixels: number;
  fullDocumentPixels: number;
  cpuRetargetAndEncodeMs: number;
  queueCompletionMs: number;
  totalMs: number;
  stroke: RasterStrokeEncodeResult | null;
  bevel: RasterBevelEncodeResult | null;
  outerShadow: RasterShadowEncodeResult | null;
  innerShadow: RasterShadowEncodeResult | null;
}

export type EngineStartupProgressState = "started" | "completed" | "failed";

export interface EngineStartupProgress {
  readonly phase: string;
  readonly label: string;
  readonly state: EngineStartupProgressState;
  readonly totalElapsedMs: number;
  readonly phaseElapsedMs: number;
  readonly detail: Readonly<Record<string, unknown>> | null;
}

export interface EngineCallbacks {
  onStatus?: (message: string, kind: "working" | "ok" | "error") => void;
  onStartupProgress?: (progress: EngineStartupProgress) => void;
  onStats?: (stats: EngineStats) => void;
  onHistoryChange?: (state: HistoryState) => void;
  onViewRotationChange?: (degrees: number, snappedToZero: boolean) => void;
  onViewChange?: (
    state: VectorTextViewState,
    documentViewChanged: boolean,
  ) => void;
  onMixedSceneChange?: (snapshot: MixedSceneSnapshot) => void;
  onPixelSelectionChange?: (state: PixelSelectionState) => void;
  /**
   * A global undo can move the active layer, so the UI has to be told: without
   * this the layer panel would keep highlighting the layer the user left.
   */
  onActiveLayerChange?: (activeIndex: number) => void;
}

export interface BrushEngineOptions {
  bevelBoundingFieldEnabled?: boolean;
  /** Authoritative hot/cold raster pixel format. Defaults to RGBA16F. */
  layerFormat?: LayerFormat;
  /** WebGPU presentation texture format. Defaults to RGBA16F. */
  presentationFormat?: LayerFormat;
  /** Optional rendering contract for Paint dab accumulation and geometry. */
  paintDabProfile?: PaintDabProfile;
  /** Development override for the CPU stroke-geometry implementation. */
  strokeGeometryBackend?: StrokeGeometryBackendPreference;
  /** Optional deterministic benchmark override; zero disables spacing escalation. */
  adaptiveSpacingMaxExtraPercentPoints?: number;
  /**
   * Selects the color-domain contract shared by presentation, live/canonical
   * composition, commit visibility, and display-mip generation.
   */
  displayCompositingColorSpace?: DisplayCompositingColorSpace;
  /**
   * Gives the browser a presentation turn after a startup phase is announced.
   * Leave disabled for observers that only record the timeline.
   */
  startupProgressPresentationYieldEnabled?: boolean;
  /**
   * Compiles the fixed document render-pipeline set through the native async
   * WebGPU API with a bounded number of concurrent jobs. Omit this option to
   * preserve the synchronous startup path.
   */
  documentPipelineCompilationConcurrency?: number;
  /**
   * Restricts document render-pipeline creation to the pipeline required by
   * the first empty frame. This is an isolated startup diagnostic: editor
   * interaction must remain disabled because excluded pipeline slots contain
   * a first-frame-only sentinel in this mode.
   */
  documentPipelineCompilationScope?: "complete" | "first-frame-diagnostic";
  /**
   * Leaves the selected brush's first-use resources cold until the editor
   * explicitly prepares a brush interaction. Core canvas rendering remains
   * available so navigation can be the initial interaction on slower devices.
   */
  deferSelectedBrushPreparation?: boolean;
  /**
   * Enables the destructive, query-gated layer memory stress fixture. Normal
   * application sessions never need to reserve deliberately pessimistic cold
   * tile capacity, so the public helper remains unavailable unless the page
   * opted into that fixture before constructing the engine.
   */
  layerMemoryStressTestEnabled?: boolean;
  /**
   * Enables the query-gated, measurement-only lossless compression study.
   * Normal sessions never read cold textures back to JavaScript.
   */
  layerCompressionTestEnabled?: boolean;
  /**
   * Legacy RGBA8-only worker codec switch. Permanent RGBA16F documents keep it
   * disabled: their cold tiles remain byte-exact GPU storage and are never
   * quantized or sent through this four-byte-per-pixel codec.
   */
  layerColdCompressionEnabled?: boolean;
  /** Emits worker lifecycle messages into the user-facing status channel. */
  layerColdCompressionStatusEnabled?: boolean;
  /**
   * Allows an activation to upload authoritative compressed chunks straight
   * into the hot texture. Disable only to reproduce the v4 cold→hot baseline.
   */
  layerColdDirectHotHydrationEnabled?: boolean;
  /**
   * Folds exact inactive cold tiles directly into merged mip 0 when the layer
   * has no raster effects. Disable only for same-build A/B measurements.
   */
  layerColdTileCompositeEnabled?: boolean;
  /**
   * Restores compressed neighbours to GPU cold tiles after a layer switch.
   * Desktop keeps this latency-oriented prefetch by default; memory-constrained
   * callers can disable it because activation can hydrate compressed bytes
   * directly into the authoritative hot texture.
   */
  layerColdAdjacentPrefetchEnabled?: boolean;
  /** Enables the integrated raster/vector/image scene and its viewport pipelines. */
  mixedSceneEnabled?: boolean;
  /**
   * Stores each segmented vector-text run in a guarded ROI texture instead of
   * a full-viewport texture. Disable only for same-build performance A/B tests.
   */
  vectorTextRoiCacheEnabled?: boolean;
  /**
   * Shares immutable vector geometry GPU resources across draws with the same
   * runtime geometry identity. Enabled by default; disable only for the legacy
   * per-node cache and same-build performance comparisons.
   */
  vectorGpuResourceSharingEnabled?: boolean;
  /**
   * @deprecated Compatibility-only alias for integrations created before the
   * mixed scene graduated from its prototype name. Use `mixedSceneEnabled`.
   */
  vectorTextPrototypeEnabled?: boolean;
}

export interface LayerPoint {
  x: number;
  y: number;
  pressure: number;
  timeMs: number;
}

export type HistoryReplayFaultPoint =
  | "during-switch-activation"
  | "after-first-replay-submit";

export type LayerBakeFaultPoint = "after-candidate-submit";

export type LayerCompositeFaultPoint = "after-candidate-submit";

export type LayerColdStorageFaultPoint =
  | "after-pack-submit"
  | "after-hydrate-submit";

export interface LayerSwitchResult {
  fromIndex: number;
  toIndex: number;
  layerId: number;
  /** Wall clock across the whole switch, including the field rebuild. */
  totalMs: number;
  /** The dominant incoming-layer term: retarget plus effect-field rebuild. */
  effectsMs: number;
  /** Rebuild and transactional publication of mergedBelow/mergedAbove. */
  compositeMs: number;
  /**
   * Generation of the effects working set after the retarget. Deliberately not a
   * "pyramid rebuilt through level" figure: the switch only invalidates the
   * pyramid, and the next frame is what rebuilds it up to the selected level.
   */
  effectsGeneration: number;
  contentBoundsRestored: boolean;
}

export const defaultBrushSettings: BrushSettings = {
  tool: "paint",
  color: "#ff805b803580",
  ...DEFAULT_BRUSH_DEFINITION_SETTINGS,
};
