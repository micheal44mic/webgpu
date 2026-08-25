import {
  DEFAULT_RASTER_BEVEL_STYLE,
  copyRasterBevelStyle,
  type RasterBevelStyle,
} from "./bevel-core";
import {
  DEFAULT_RASTER_COLOR_OVERLAY_STYLE,
  copyRasterColorOverlayStyle,
  rasterColorOverlayIsActive,
  type RasterColorOverlayStyle,
} from "./raster-color-overlay-core";
import {
  DEFAULT_RASTER_INNER_SHADOW_STYLE,
  DEFAULT_RASTER_OUTER_SHADOW_STYLE,
  copyRasterInnerShadowStyle,
  copyRasterOuterShadowStyle,
  type RasterInnerShadowStyle,
  type RasterOuterShadowStyle,
} from "./shadow-core";
import {
  DEFAULT_RASTER_STROKE_STYLE,
  copyRasterStrokeStyle,
  type RasterStrokeStyle,
} from "./stroke-core";
import {
  DEFAULT_LAYER_CONTENT_OPACITY,
  normalizeLayerContentOpacity,
} from "./layer-composition.ts";

export const RASTERIZE_LAYER_EFFECTS_STRATEGY =
  "bake-content-and-style-stack-into-authoritative-pixels-preserve-opacity-blend-and-clipping-v2" as const;

export interface RasterLayerEffectsSnapshot {
  readonly contentOpacity: number;
  readonly strokeStyle: RasterStrokeStyle;
  readonly bevelStyle: RasterBevelStyle;
  readonly outerShadowStyle: RasterOuterShadowStyle;
  readonly innerShadowStyle: RasterInnerShadowStyle;
  readonly colorOverlayStyle: RasterColorOverlayStyle;
}

export interface RasterLayerEffectsOwner {
  contentOpacity: number;
  strokeStyle: RasterStrokeStyle;
  bevelStyle: RasterBevelStyle;
  outerShadowStyle: RasterOuterShadowStyle;
  innerShadowStyle: RasterInnerShadowStyle;
  colorOverlayStyle: RasterColorOverlayStyle;
}

export function copyRasterLayerEffects(
  source: RasterLayerEffectsOwner | RasterLayerEffectsSnapshot,
): RasterLayerEffectsSnapshot {
  return {
    contentOpacity: normalizeLayerContentOpacity(source.contentOpacity),
    strokeStyle: copyRasterStrokeStyle(source.strokeStyle),
    bevelStyle: copyRasterBevelStyle(source.bevelStyle),
    outerShadowStyle: copyRasterOuterShadowStyle(source.outerShadowStyle),
    innerShadowStyle: copyRasterInnerShadowStyle(source.innerShadowStyle),
    colorOverlayStyle: copyRasterColorOverlayStyle(source.colorOverlayStyle),
  };
}

export function defaultRasterLayerEffects(): RasterLayerEffectsSnapshot {
  return {
    contentOpacity: DEFAULT_LAYER_CONTENT_OPACITY,
    strokeStyle: copyRasterStrokeStyle(DEFAULT_RASTER_STROKE_STYLE),
    bevelStyle: copyRasterBevelStyle(DEFAULT_RASTER_BEVEL_STYLE),
    outerShadowStyle: copyRasterOuterShadowStyle(DEFAULT_RASTER_OUTER_SHADOW_STYLE),
    innerShadowStyle: copyRasterInnerShadowStyle(DEFAULT_RASTER_INNER_SHADOW_STYLE),
    colorOverlayStyle: copyRasterColorOverlayStyle(DEFAULT_RASTER_COLOR_OVERLAY_STYLE),
  };
}

export function applyRasterLayerEffects(
  target: RasterLayerEffectsOwner,
  source: RasterLayerEffectsSnapshot,
): void {
  const copy = copyRasterLayerEffects(source);
  target.contentOpacity = copy.contentOpacity;
  target.strokeStyle = copy.strokeStyle;
  target.bevelStyle = copy.bevelStyle;
  target.outerShadowStyle = copy.outerShadowStyle;
  target.innerShadowStyle = copy.innerShadowStyle;
  target.colorOverlayStyle = copy.colorOverlayStyle;
}

export function rasterLayerEffectsNeedBake(
  source: RasterLayerEffectsOwner | RasterLayerEffectsSnapshot,
): boolean {
  return normalizeLayerContentOpacity(source.contentOpacity) !== DEFAULT_LAYER_CONTENT_OPACITY
    || (source.strokeStyle.enabled && source.strokeStyle.width > 0)
    || source.bevelStyle.enabled
    || source.outerShadowStyle.enabled
    || source.innerShadowStyle.enabled
    || rasterColorOverlayIsActive(source.colorOverlayStyle);
}

export function rasterLayerEffectsAreConfigured(
  source: RasterLayerEffectsOwner | RasterLayerEffectsSnapshot,
): boolean {
  return normalizeLayerContentOpacity(source.contentOpacity) !== DEFAULT_LAYER_CONTENT_OPACITY
    || source.strokeStyle.enabled
    || source.bevelStyle.enabled
    || source.outerShadowStyle.enabled
    || source.innerShadowStyle.enabled
    || source.colorOverlayStyle.enabled;
}
