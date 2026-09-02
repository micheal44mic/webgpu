/**
 * Contratti del testo vettoriale: piazzamento, stato della vista e forme dei
 * draw GPU che il motore riceve dal controller. Solo tipi, nessuna logica.
 */
import {
  VECTOR_TEXT_PRESENTATION_STRATEGY,
} from "./vector-text-shader";
import type { VectorTextGpuMeshData } from "./vector-text-effect-geometry";
import type { VectorTextSlugData } from "./vector-text-slug";

export type VectorTextPlacement =
  | "below-active"
  | "above-active"
  | `text-run:${string}`;

/** Exact settled-vector raster policy. Gesture presentation remains mip based. */
export type VectorRasterQualityMode = "baseline" | "coverage";

export interface VectorTextViewState {
  canvasWidth: number;
  canvasHeight: number;
  cssWidth: number;
  cssHeight: number;
  centerX: number;
  centerY: number;
  zoom: number;
  rotationRadians: number;
  rotationCos: number;
  rotationSin: number;
}

export interface VectorTextGpuPresentationStats {
  strategy: typeof VECTOR_TEXT_PRESENTATION_STRATEGY;
  width: number;
  height: number;
  gpuMemoryMiB: number;
  placement: VectorTextPlacement;
  blurGpuMemoryMiB: number;
  blurCacheEntries: number;
}

export interface VectorTextGpuGradientStop {
  readonly offset: number;
  /** Unpremultiplied sRGB channels; interpolation follows SVG's default sRGB space. */
  readonly color: readonly [number, number, number];
  readonly opacity: number;
}

export interface VectorTextGpuGradient {
  readonly kind: "linear" | "radial";
  readonly spread: "pad" | "reflect" | "repeat";
  /** Forward affine map from gradient coordinates to centered local coordinates. */
  readonly transform: readonly [number, number, number, number, number, number];
  readonly geometry: readonly [number, number, number, number];
  readonly focal: readonly [number, number];
  readonly stops: readonly VectorTextGpuGradientStop[];
}

interface VectorTextGpuDrawBase {
  readonly meshKey: string;
  readonly x: number;
  readonly y: number;
  /** Horizontal compatibility alias used by existing draw producers. */
  readonly scale: number;
  readonly scaleX?: number;
  readonly scaleY?: number;
  readonly rotation: number;
  readonly localOffsetX: number;
  readonly localOffsetY: number;
  readonly color: readonly [number, number, number];
  readonly opacity: number;
  readonly gradient?: VectorTextGpuGradient;
}

export interface VectorTextGpuMeshDraw extends VectorTextGpuDrawBase {
  readonly mode: "mesh-direct";
  readonly mesh: VectorTextGpuMeshData;
}

export interface VectorTextGpuMeshBlurDraw extends VectorTextGpuDrawBase {
  readonly mode: "mesh-blur";
  readonly mesh: VectorTextGpuMeshData;
  readonly blurKey: string;
  readonly blurBounds: readonly [number, number, number, number];
  readonly blurWidth: number;
  readonly blurHeight: number;
  readonly blurScale: number;
  readonly blurSigmaPixels: number;
  readonly blurRadius: number;
}

export interface VectorTextGpuMeshInnerShadowBlurDraw extends VectorTextGpuDrawBase {
  readonly mode: "mesh-inner-shadow-blur";
  readonly mesh: VectorTextGpuMeshData;
  readonly blurKey: string;
  readonly blurBounds: readonly [number, number, number, number];
  readonly blurWidth: number;
  readonly blurHeight: number;
  readonly blurScale: number;
  readonly blurSigmaPixels: number;
  readonly blurRadius: number;
  readonly sampleOffsetX: number;
  readonly sampleOffsetY: number;
}
export interface VectorTextGpuSlugDraw extends VectorTextGpuDrawBase {
  readonly mode: "slug-direct";
  readonly slug: VectorTextSlugData;
}

export interface VectorTextGpuSlugBlurDraw extends VectorTextGpuDrawBase {
  readonly mode: "slug-blur";
  readonly slug: VectorTextSlugData;
  readonly blurKey: string;
  readonly blurBounds: readonly [number, number, number, number];
  readonly blurWidth: number;
  readonly blurHeight: number;
  readonly blurScale: number;
  readonly blurSigmaPixels: number;
  readonly blurRadius: number;
}

export interface VectorTextGpuSlugInnerShadowDirectDraw
  extends VectorTextGpuDrawBase {
  readonly mode: "slug-inner-shadow-direct";
  readonly slug: VectorTextSlugData;
  readonly sampleOffsetX: number;
  readonly sampleOffsetY: number;
}

export interface VectorTextGpuSlugInnerShadowBlurDraw
  extends VectorTextGpuDrawBase {
  readonly mode: "slug-inner-shadow-blur";
  readonly slug: VectorTextSlugData;
  readonly blurKey: string;
  readonly blurBounds: readonly [number, number, number, number];
  readonly blurWidth: number;
  readonly blurHeight: number;
  readonly blurScale: number;
  readonly blurSigmaPixels: number;
  readonly blurRadius: number;
  readonly sampleOffsetX: number;
  readonly sampleOffsetY: number;
}

export type VectorTextGpuBlurSourceDraw =
  | VectorTextGpuMeshBlurDraw
  | VectorTextGpuMeshInnerShadowBlurDraw
  | VectorTextGpuSlugBlurDraw
  | VectorTextGpuSlugInnerShadowBlurDraw;

export type VectorTextGpuDraw =
  | VectorTextGpuMeshDraw
  | VectorTextGpuMeshBlurDraw
  | VectorTextGpuMeshInnerShadowBlurDraw
  | VectorTextGpuSlugDraw
  | VectorTextGpuSlugBlurDraw
  | VectorTextGpuSlugInnerShadowDirectDraw
  | VectorTextGpuSlugInnerShadowBlurDraw;
