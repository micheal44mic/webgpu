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
  type RasterImageNode,
  type VectorSvgNode,
  type VectorTextNode,
} from "./mixed-scene-stack";
import type { RasterShadowEncodeResult } from "./shadow-renderer";
import type { RasterStrokeEncodeResult } from "./stroke-renderer";
import type { PixelSelectionState } from "./selection-core";
import type { VectorTextViewState } from "./vector-text-types";

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

export type BrushTool = "paint" | "blend";

export type LayerFormat = "rgba8unorm" | "rgba16float";

export type BrushShape = "circle" | "shape";

export type CustomBrushShapeAssetId = `custom-shape:${string}`;

export type BrushShapeAssetId = "legacy-shape" | "pencil-shape" | CustomBrushShapeAssetId;

export type BrushShapeRotation = "fixed" | "follow-stroke";

export type GrainMode = "off" | "texturized" | "moving";

export type CustomBrushGrainAssetId = `custom-grain:${string}`;

export type BrushGrainAssetId = "legacy-grain" | "pencil-grain" | CustomBrushGrainAssetId;

export type GrainFiltering = "no" | "classic" | "improved";

export type GrainBlendMode = "multiply";

export type AdaptiveSpacingTriggerReason = "probe-timeout" | "slow-completion";

export interface BrushSettings {
  tool: BrushTool;
  shape: BrushShape;
  /** Stable source identity; old settings without it normalize to legacy-shape. */
  shapeAssetId: BrushShapeAssetId;
  /** User polarity applied after the source asset's authored polarity. */
  shapeInvert: boolean;
  shapeRotation: BrushShapeRotation;
  shapeScatter: number;
  grainMode: GrainMode;
  /** Stable source identity; old settings without it normalize to legacy-grain. */
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
  x: number;
  y: number;
  scale: number;
  rotation: number;
  sourceBounds: DirtyRect;
  resultBounds: DirtyRect | null;
}

export interface MixedSceneSnapshot {
  strategy: typeof MIXED_SCENE_STACK_STRATEGY;
  selectedKey: MixedSceneItem["key"];
  activeRasterLayerId: number;
  previewTextNodeId: number | null;
  items: readonly (
    | {
      key: `raster:${number}`;
      kind: "raster";
      rasterLayerId: number;
      rasterLayerIndex: number;
      rasterLayerName: string;
      /** Null for a base raster; otherwise this ordinary raster is clipped by the parent alpha. */
      rasterClippingParentId: number | null;
      rasterHasContent: boolean;
      rasterContentBounds: DirtyRect | null;
      rasterTransform: RasterTransformSnapshot | null;
    }
    | {
      key: `text:${number}`;
      kind: "text";
      textNode: Readonly<VectorTextNode>;
    }
    | {
      key: `svg:${number}`;
      kind: "svg";
      svgNode: Readonly<VectorSvgNode>;
    }
    | {
      key: `image:${number}`;
      kind: "image";
      imageNode: Readonly<RasterImageNode>;
    }
  )[];
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
  /** Proprietà continue o Trasforma aperti: Undo/Redo restano bloccati. */
  openEdit: "property" | "transform" | null;
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

export interface EngineCallbacks {
  onStatus?: (message: string, kind: "working" | "ok" | "error") => void;
  onStats?: (stats: EngineStats) => void;
  onHistoryChange?: (state: HistoryState) => void;
  onViewRotationChange?: (degrees: number, snappedToZero: boolean) => void;
  onViewChange?: (state: VectorTextViewState) => void;
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
   * Enables the query-gated runtime experiment: one distant inactive RGBA8
   * cold store may move from GPU tiles to lossless CPU bytes in a worker.
   */
  layerColdCompressionEnabled?: boolean;
  /**
   * Enables the integrated mixed raster/vector text editor and its viewport
   * pipelines. Callers may still disable it in isolated engine tests.
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
  shape: "circle",
  shapeAssetId: "legacy-shape",
  shapeInvert: false,
  shapeRotation: "fixed",
  shapeScatter: 0,
  grainMode: "off",
  grainAssetId: "legacy-grain",
  grainScale: 1.4,
  grainMovement: 0,
  grainDepth: 1,
  grainBrightness: 0,
  grainContrast: 0,
  grainInvert: false,
  grainFiltering: "improved",
  grainBlendMode: "multiply",
  color: "#ff5b35",
  size: 96,
  spacingPercent: 1,
  stabilization: 0,
  startThickness: 1,
  endThickness: 1,
  count: 24,
  flow: 0.07,
  opacity: 1,
  hardness: 1,
  blendIntensity: 1,
  blendMode: "light-glaze",
  blendStretch: 0.18,
  blendPaint: 0.14,
  jitterMaster: 1,
  hueJitterDegrees: 12,
  saturationJitter: 0.18,
  lightnessJitter: 0.12,
  darknessJitter: 0.18,
  jitterPerCopy: false,
  positionJitterLateral: 1,
  positionJitterLinear: 1,
};
