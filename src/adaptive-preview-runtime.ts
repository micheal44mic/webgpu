/**
 * Anteprima adattiva: soglie, taglie delle patch e sonde d'ambiente. Legge la
 * piattaforma (userAgent, attributi del contesto 2D) e non tocca la GPU.
 */
import type { MutableStrokePerformanceProfile } from "./engine-stats";
import type { Stamp } from "./engine-stroke-types";
import type { BrushSettings } from "./engine-types";
import { brushColorHsl } from "./brush-color.ts";
import { clamp } from "./color";
import { previewHslToSrgb, previewRandom01 } from "./engine-math";

export type AdaptivePreviewConcreteActivationReason =
  | "probe-timeout"
  | "consecutive-slow"
  | "diagnostic-force";

export type AdaptivePreviewActivationReason =
  | "none"
  | AdaptivePreviewConcreteActivationReason
  | "mixed";

export interface AdaptivePreviewCandidate {
  serial: number | null;
  stamp: Stamp;
  settings: BrushSettings;
  presented: boolean;
}

export interface AdaptivePreviewProbe {
  generation: number;
  startedAt: number;
  prefixSerial: number;
  timeout: number;
  spacingIncreaseApplied: boolean;
  telemetryProfile: MutableStrokePerformanceProfile | null;
}

export interface AdaptivePreviewCopy {
  x: number;
  y: number;
  radius: number;
  rotation: number;
  alpha: number;
  candidateIndex: number;
  red: number;
  green: number;
  blue: number;
  color: string;
}

export interface AdaptivePreviewShapePaletteEntry {
  red: number;
  green: number;
  blue: number;
  sprite: HTMLCanvasElement;
}

export const ADAPTIVE_PREVIEW_EXACT_LINEAR_SCALE = 0.5;

export const ADAPTIVE_PREVIEW_JS_BUDGET_MS = 1.25;

export const ADAPTIVE_PREVIEW_COMMIT_BUDGET_RESERVE_MS = 0.2;

export const ADAPTIVE_PREVIEW_MAX_TIP_BASE_STAMPS = 2;

export const ADAPTIVE_PREVIEW_MAX_PATCH_CSS_PIXELS = 384;

export const ADAPTIVE_PREVIEW_MIN_PATCH_CSS_PIXELS = 32;

export const ADAPTIVE_PREVIEW_PATCH_QUANTUM_CSS_PIXELS = 32;

export const ADAPTIVE_PREVIEW_PATCH_MARGIN_CSS_PIXELS = 3;

export const ADAPTIVE_PREVIEW_ALPHA_SCALE = 0.86;

export const ADAPTIVE_PREVIEW_SHAPE_PALETTE_SIZE = 12;

export const ADAPTIVE_PREVIEW_PROBE_INTERVAL_SUBMISSIONS = 4;

export const ADAPTIVE_PREVIEW_TRIGGER_THRESHOLD_MS = 60;

export const ADAPTIVE_PREVIEW_SLOW_COMPLETION_THRESHOLD_MS = 58;

export const ADAPTIVE_PREVIEW_TRIGGER_CONSECUTIVE_PROBES = 2;

export const ADAPTIVE_PREVIEW_PROBE_NEAR_MISS_MINIMUM_MS = 45;

export const ADAPTIVE_SPACING_STEP_PERCENT_POINTS = 0.25;

export const ADAPTIVE_SPACING_MAX_EXTRA_PERCENT_POINTS = 1.5;

export const ADAPTIVE_SPACING_ANDROID_MAX_EXTRA_PERCENT_POINTS = 4;

const adaptivePreviewQueryMode = typeof window === "undefined"
  ? null
  : new URLSearchParams(window.location.search).get("adaptivePreview");

/**
 * Labs-only proxy mode. It deliberately permits a short-lived visual tip for
 * brush features that Canvas2D cannot reproduce exactly; authoritative pixels
 * and history continue to come exclusively from WebGPU.
 */
export const ADAPTIVE_PREVIEW_APPROXIMATE_FORCE = import.meta.env.MODE === "labs"
  && adaptivePreviewQueryMode === "force-approximate";

export const ADAPTIVE_PREVIEW_FORCE = (
  import.meta.env.DEV
  && adaptivePreviewQueryMode === "force"
) || ADAPTIVE_PREVIEW_APPROXIMATE_FORCE;

export interface AdaptivePreviewContextAttributes {
  alpha: boolean | null;
  desynchronized: boolean | null;
  colorSpace: string | null;
}

export function readAdaptivePreviewContextAttributes(
  context: CanvasRenderingContext2D | null,
): AdaptivePreviewContextAttributes {
  if (!context || typeof context.getContextAttributes !== "function") {
    return { alpha: null, desynchronized: null, colorSpace: null };
  }
  const attributes = context.getContextAttributes();
  return {
    alpha: typeof attributes.alpha === "boolean" ? attributes.alpha : null,
    desynchronized: typeof attributes.desynchronized === "boolean"
      ? attributes.desynchronized
      : null,
    colorSpace: typeof attributes.colorSpace === "string" ? attributes.colorSpace : null,
  };
}

export function shouldDesynchronizeAdaptivePreviewVisibleCanvas(): boolean {
  return navigator.platform === "iPhone" || /\biPhone\b/.test(navigator.userAgent);
}

export function adaptiveSpacingMaxExtraPercentPointsForPlatform(): number {
  return /\bAndroid\b/i.test(navigator.userAgent)
    ? ADAPTIVE_SPACING_ANDROID_MAX_EXTRA_PERCENT_POINTS
    : ADAPTIVE_SPACING_MAX_EXTRA_PERCENT_POINTS;
}

export function adaptivePreviewRgb(
  colorSeed: number,
  settings: BrushSettings,
  baseHsl: readonly [number, number, number] = brushColorHsl(settings),
): [number, number, number] {
  const [red, green, blue] = adaptivePreviewSrgb(colorSeed, settings, baseHsl);
  return [red * 255, green * 255, blue * 255];
}

/** Float encoded-sRGB used by authoritative GPU preview and glaze tinting. */
export function adaptivePreviewSrgb(
  colorSeed: number,
  settings: BrushSettings,
  baseHsl: readonly [number, number, number] = brushColorHsl(settings),
): [number, number, number] {
  const hueDelta = (previewRandom01(colorSeed, 1) - 0.5)
    * 2
    * (settings.hueJitterDegrees / 360);
  const saturationDelta = (previewRandom01(colorSeed, 2) - 0.5)
    * 2
    * settings.saturationJitter;
  const lightnessDelta = (previewRandom01(colorSeed, 3) - 0.5)
    * 2
    * settings.lightnessJitter;
  const darkness = previewRandom01(colorSeed, 4) * settings.darknessJitter;
  const lightnessBeforeDarkness = clamp(baseHsl[2] + lightnessDelta, 0, 1);
  return previewHslToSrgb(
    baseHsl[0] + hueDelta,
    baseHsl[1] + saturationDelta,
    lightnessBeforeDarkness * (1 - darkness),
  );
}
