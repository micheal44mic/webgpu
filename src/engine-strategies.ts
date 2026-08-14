/**
 * Registro delle strategie dichiarate dal motore. Ogni costante qui e' una firma
 * di telemetria: compare nei report, nei benchmark e nelle suite `*:verify`.
 * Cambiare uno di questi valori significa dichiarare una variante diversa del
 * motore, non fare un refactoring.
 */
import type { BlendMode, BrushSettings } from "./engine-types";
import { GPU_HISTORY_STORAGE_STRATEGY } from "./gpu-history-storage";

export type StampGeometry = "quad" | "oriented-support-quads";

export type FragmentCoverageStrategy = "generic-smoothstep" | "shape-alpha-mask-2k";

export type ShapeSamplingStrategy =
  | "none"
  | "legacy-full-mask"
  | "coarse-occupancy-bitmask"
  | "mixed";

export type ShapeMaskDecodeStrategy = "png-gray8-direct" | "canvas-fallback";

export type HistoryStorageStrategy = typeof GPU_HISTORY_STORAGE_STRATEGY;

export type HistoryReplayStrategy = "clear-and-gpu-buffer-copy-replay";

export type HistoryStampRetentionStrategy = "gpu-only-packed-payload-no-cpu-stamp-arrays";

export type PresentationCacheStrategy = "persistent-full-resolution-screen-cache";

export type PresentationTransferStrategy = "copy-texture-to-current-texture";

export type PaintDisplayPyramidStrategy =
  "live-dirty-perceptual-srgb-filter-and-manual-minification-linear-alpha-extended-residual-mip-chain";

export type PaintDisplayLodSelectionStrategy = "largest-power-of-two-without-upscaling";

export type AdaptivePreviewStrategy =
  "queue-lag-canvas2d-tip-patch";

export type AdaptivePreviewTriggerStrategy = "single-sampled-queue-prefix-latency";

export type AdaptivePreviewStaleFrameStrategy =
  "hide-confirmed-stale-bitmap-and-single-raf-retry";

export type AdaptivePreviewVisibleCanvasStrategy =
  "iphone-desynchronized-others-synchronized-canvas2d";

export type AdaptiveSpacingStrategy = "queue-lag-step-up-per-stroke";

export type BrushOpacityStrategy = "per-stamp-uniform-alpha-multiplier";

export type GrainStrategy =
  | "disabled-standard-pipeline"
  | "r16float-dynamic-fixed-coverage-multiply"
  | "r16float-dynamic-moving-scaled-drag-to-roller-coverage-multiply";

export type GrainCoordinateStrategy =
  | "none"
  | "authoritative-layer-position"
  | "stamp-local-scaled-position"
  | "stamp-local-scaled-to-layer-roller-interpolation";

export type GrainSamplingStrategy =
  | "none"
  | "repeat-nearest"
  | "repeat-linear-mip-nearest"
  | "repeat-linear-trilinear"
  | "clamp-nearest"
  | "clamp-linear-mip-nearest"
  | "clamp-linear-trilinear";

export type GrainMipStrategy = "webgpu-wgsl-linear-full-chain";

export type GrainPipelineStrategy = "separate-opt-in-pipelines";

export type GrainCoverageStrategy =
  | "none"
  | "post-tip-coverage-pre-alpha-multiply";

export type GrainAdaptivePreviewStrategy =
  | "legacy"
  | "disabled-semantic-mismatch-probe-spacing-active";

export type LightGlazeStrategy =
  | "uniformed-linear-rgba16float-live-composite-mips-single-commit"
  | "light-r16float-max-per-gesture-source-over-between-gestures"
  | "m1-r16float-max-coverage-plus-composited-mips-single-commit"
  | "intense-physical-stamps-source-over-srgb-rgba16float-live-single-commit";

export type LightGlazeAdaptivePreviewStrategy = "disabled-semantic-mismatch";

export type LightGlazeStorageMode =
  | "none"
  | "rgba16float-stroke"
  | "r16float-coverage";

export type ThicknessDynamicsPreviewStrategy = "predictive-webgpu-tail-overlay";

export const STAMP_GEOMETRY = "quad" as const;

export const CIRCLE_FRAGMENT_COVERAGE_STRATEGY = "generic-smoothstep" as const;

export const SHAPE_FRAGMENT_COVERAGE_STRATEGY = "shape-alpha-mask-2k" as const;

export const SHAPE_OCCUPANCY_STRATEGY = "coarse-occupancy-bitmask" as const;

export const SHAPE_LEGACY_STRATEGY = "legacy-full-mask" as const;

export const SHAPE_DIRECT_DECODE_STRATEGY = "png-gray8-direct" as const;

export const SHAPE_CANVAS_DECODE_STRATEGY = "canvas-fallback" as const;

export const COLOR_SEED_STRATEGY = "reuse-position-copy-seed" as const;

export const DIRTY_RECT_STRATEGY = "directional-jitter-bounds" as const;

export const PRESENTATION_CACHE_STRATEGY = "persistent-full-resolution-screen-cache" as const;

export const PRESENTATION_TRANSFER_STRATEGY = "copy-texture-to-current-texture" as const;

export const PAINT_DISPLAY_PYRAMID_STRATEGY =
  "live-dirty-perceptual-srgb-filter-and-manual-minification-linear-alpha-extended-residual-mip-chain" as const;

export const LAYER_BAKE_STRATEGY =
  "transient-analytic-bounded-visual-rect-no-handoff-residency-mip0-fused-into-two-merged-surfaces" as const;

export const LAYER_COMPOSITE_STRATEGY =
  "merged-above-over-isolated-active-clipping-group-over-merged-below-source-atop-live-prefix-suffix-compose-before-filter-parent-opacity-once-direct-authoritative-cold-tiles-normal-no-effects-deferred-to-fold-fence-bounded-visual-rect" as const;

export const PAINT_DISPLAY_LOD_SELECTION_STRATEGY =
  "largest-power-of-two-without-upscaling" as const;

export const BRUSH_OPACITY_STRATEGY = "per-stamp-uniform-alpha-multiplier" as const;

export const GRAIN_DISABLED_STRATEGY = "disabled-standard-pipeline" as const;

export const GRAIN_FIXED_STRATEGY = "r16float-dynamic-fixed-coverage-multiply" as const;

export const GRAIN_MOVING_STRATEGY =
  "r16float-dynamic-moving-scaled-drag-to-roller-coverage-multiply" as const;

export const GRAIN_FIXED_COORDINATE_STRATEGY = "authoritative-layer-position" as const;

export const GRAIN_MOVING_COORDINATE_STRATEGY = "stamp-local-scaled-position" as const;

export const GRAIN_MOVING_ROLLER_COORDINATE_STRATEGY =
  "stamp-local-scaled-to-layer-roller-interpolation" as const;

export const GRAIN_MIP_STRATEGY = "webgpu-wgsl-linear-full-chain" as const;

export const GRAIN_PIPELINE_STRATEGY = "separate-opt-in-pipelines" as const;

export const GRAIN_COVERAGE_STRATEGY = "post-tip-coverage-pre-alpha-multiply" as const;

export const GRAIN_ADAPTIVE_PREVIEW_STRATEGY =
  "disabled-semantic-mismatch-probe-spacing-active" as const;

export const UNIFORMED_GLAZE_STRATEGY =
  "uniformed-linear-rgba16float-live-composite-mips-single-commit" as const;

export const LIGHT_GLAZE_STRATEGY =
  "light-r16float-max-per-gesture-source-over-between-gestures" as const;

export const M1_GLAZE_STRATEGY =
  "m1-r16float-max-coverage-plus-composited-mips-single-commit" as const;

export const INTENSE_BLENDING_STAMP_STRATEGY =
  "intense-physical-stamps-source-over-srgb-rgba16float-live-single-commit" as const;

export const LIGHT_GLAZE_ADAPTIVE_PREVIEW_STRATEGY = "disabled-semantic-mismatch" as const;

export const LIGHT_GLAZE_STORAGE_LIFECYCLE_STRATEGY =
  "allocate-on-glaze-select-release-when-idle-deselected" as const;

export const GRAIN_STORAGE_LIFECYCLE_STRATEGY =
  "allocate-on-grain-select-release-when-idle-unused" as const;

export const SHAPE_STORAGE_LIFECYCLE_STRATEGY =
  "allocate-on-shape-select-release-when-idle-unused" as const;

export const ADAPTIVE_PREVIEW_STRATEGY =
  "queue-lag-canvas2d-tip-patch" as const;

export const THICKNESS_DYNAMICS_PREVIEW_STRATEGY =
  "predictive-webgpu-tail-overlay" as const;

export const ADAPTIVE_PREVIEW_TRIGGER_STRATEGY = "single-sampled-queue-prefix-latency" as const;

export const ADAPTIVE_PREVIEW_STALE_FRAME_STRATEGY =
  "hide-confirmed-stale-bitmap-and-single-raf-retry" as const;

export const ADAPTIVE_PREVIEW_VISIBLE_CANVAS_STRATEGY =
  "iphone-desynchronized-others-synchronized-canvas2d" as const;

export const ADAPTIVE_SPACING_STRATEGY = "queue-lag-step-up-per-stroke" as const;

export const HISTORY_STORAGE_STRATEGY = GPU_HISTORY_STORAGE_STRATEGY;

export const HISTORY_REPLAY_STRATEGY = "clear-and-gpu-buffer-copy-replay" as const;

export const HISTORY_STAMP_RETENTION_STRATEGY =
  "gpu-only-packed-payload-no-cpu-stamp-arrays" as const;

export function isStrokeGlazeBlendMode(mode: BlendMode): boolean {
  return mode === "light-glaze"
    || mode === "uniformed-glaze"
    || mode === "intense-blending"
    || mode === "m1-glaze";
}

export function lightGlazeStrategyForBlendMode(mode: BlendMode): LightGlazeStrategy {
  if (mode === "intense-blending") {
    return INTENSE_BLENDING_STAMP_STRATEGY;
  }
  if (mode === "light-glaze") {
    return LIGHT_GLAZE_STRATEGY;
  }
  return mode === "m1-glaze"
    ? M1_GLAZE_STRATEGY
    : UNIFORMED_GLAZE_STRATEGY;
}

export function usesStrokeGlazeRenderer(settings: BrushSettings): boolean {
  return settings.tool === "paint"
    && isStrokeGlazeBlendMode(settings.blendMode);
}

export function usesBlendRenderer(settings: BrushSettings): boolean {
  return settings.tool === "blend";
}

export function lightGlazeStorageModeFor(blendMode: BlendMode): LightGlazeStorageMode {
  return blendMode === "light-glaze" || blendMode === "m1-glaze"
    ? "r16float-coverage"
    : "rgba16float-stroke";
}

export function isTexturizedGrainActive(settings: BrushSettings): boolean {
  return (settings.grainMode === "texturized" || settings.grainMode === "moving")
    && settings.grainBlendMode === "multiply"
    && settings.grainDepth > 0;
}

export function grainCoordinateMode(_settings: BrushSettings): "fixed" | "moving" {
  // Scale can make even a fully dragged Moving patch cross a tile boundary.
  // All active Grain mappings therefore require the repeat sampler. The
  // historical `moving` sampler remains allocated only for ABI/resource-layout
  // stability and is no longer selected by the corrected coordinate model.
  return "fixed";
}
