export const RASTER_PIXEL_VIEW_PERCENT_THRESHOLD = 581 as const;
export const RASTER_PIXEL_VIEW_ZOOM_THRESHOLD =
  RASTER_PIXEL_VIEW_PERCENT_THRESHOLD / 100;
export const RASTER_PIXEL_VIEW_STRATEGY =
  "display-only-nearest-raster-at-581-percent-v1" as const;

export function rasterPixelViewEnabled(zoom: number): boolean {
  return Number.isFinite(zoom) && zoom >= RASTER_PIXEL_VIEW_ZOOM_THRESHOLD;
}

export const rasterPixelViewShaderHelpers = /* wgsl */ `
const RASTER_PIXEL_VIEW_ZOOM_THRESHOLD: f32 = ${RASTER_PIXEL_VIEW_ZOOM_THRESHOLD.toFixed(2)};

fn rasterPixelViewEnabled(resolutionScale: f32) -> bool {
  return display.zoom >= RASTER_PIXEL_VIEW_ZOOM_THRESHOLD
    && resolutionScale <= 1.0001;
}

fn rasterPixelViewTexel(
  uv: vec2<f32>,
  dimensions: vec2<i32>
) -> vec2<i32> {
  return clamp(
    vec2<i32>(floor(uv * vec2<f32>(dimensions))),
    vec2<i32>(0),
    dimensions - vec2<i32>(1)
  );
}
`;
