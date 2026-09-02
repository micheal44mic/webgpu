/** WebGPU kernel for the selected raster's live color adjustment. */

import type { RasterAdjustmentStorageProfile } from "./raster-adjustment-storage-shader.ts";
import { rasterAdjustmentStorageShader } from "./raster-adjustment-storage-shader.ts";

export const RASTER_COLOR_ADJUST_WORKGROUP_WIDTH = 8;
export const RASTER_COLOR_ADJUST_WORKGROUP_HEIGHT = 8;

export interface RasterColorAdjustDispatchSize {
  readonly x: number;
  readonly y: number;
}

export function rasterColorAdjustDispatchSize(
  width: number,
  height: number,
): RasterColorAdjustDispatchSize {
  const safeWidth = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
  const safeHeight = Number.isFinite(height) ? Math.max(0, Math.floor(height)) : 0;
  return {
    x: Math.ceil(safeWidth / RASTER_COLOR_ADJUST_WORKGROUP_WIDTH),
    y: Math.ceil(safeHeight / RASTER_COLOR_ADJUST_WORKGROUP_HEIGHT),
  };
}

export function createRasterColorAdjustShader(
  profile: RasterAdjustmentStorageProfile,
): string {
  return /* wgsl */ `
struct RasterColorAdjustParameters {
  outputOrigin: vec2<u32>,
  quantizationSeed: u32,
  _originPadding: u32,
  adjustments: vec4<f32>,
}

@group(0) @binding(0) var immutableSource: texture_2d<f32>;
@group(0) @binding(1) var adjustedOutput:
  texture_storage_2d<${profile.layerFormat}, write>;
@group(0) @binding(2) var<uniform> parameters: RasterColorAdjustParameters;

${rasterAdjustmentStorageShader(profile)}

fn encodedRgbToHsv(rgb: vec3<f32>) -> vec3<f32> {
  let maximum = max(rgb.r, max(rgb.g, rgb.b));
  let minimum = min(rgb.r, min(rgb.g, rgb.b));
  let delta = maximum - minimum;
  var hue = 0.0;
  if (delta > RASTER_ADJUSTMENT_ALPHA_EPSILON) {
    if (maximum == rgb.r) {
      hue = (rgb.g - rgb.b) / delta;
    } else if (maximum == rgb.g) {
      hue = (rgb.b - rgb.r) / delta + 2.0;
    } else {
      hue = (rgb.r - rgb.g) / delta + 4.0;
    }
    hue = fract(hue / 6.0 + 1.0);
  }
  let saturation = select(
    0.0,
    delta / maximum,
    maximum > RASTER_ADJUSTMENT_ALPHA_EPSILON
  );
  return vec3<f32>(hue, saturation, maximum);
}

fn hsvToEncodedRgb(hsv: vec3<f32>) -> vec3<f32> {
  let hue = fract(hsv.x + 1.0) * 6.0;
  let saturation = clamp(hsv.y, 0.0, 1.0);
  let brightness = clamp(hsv.z, 0.0, 1.0);
  let chroma = brightness * saturation;
  let intermediate = chroma * (1.0 - abs(fract(hue * 0.5) * 2.0 - 1.0));
  var rgb = vec3<f32>(0.0);
  if (hue < 1.0) {
    rgb = vec3<f32>(chroma, intermediate, 0.0);
  } else if (hue < 2.0) {
    rgb = vec3<f32>(intermediate, chroma, 0.0);
  } else if (hue < 3.0) {
    rgb = vec3<f32>(0.0, chroma, intermediate);
  } else if (hue < 4.0) {
    rgb = vec3<f32>(0.0, intermediate, chroma);
  } else if (hue < 5.0) {
    rgb = vec3<f32>(intermediate, 0.0, chroma);
  } else {
    rgb = vec3<f32>(chroma, 0.0, intermediate);
  }
  return rgb + vec3<f32>(brightness - chroma);
}

fn adjustUnitComponent(value: f32, amount: f32) -> f32 {
  let safeAmount = clamp(amount, -1.0, 1.0);
  return select(
    value + (1.0 - value) * safeAmount,
    value * (1.0 + safeAmount),
    safeAmount < 0.0
  );
}

@compute @workgroup_size(
  ${RASTER_COLOR_ADJUST_WORKGROUP_WIDTH},
  ${RASTER_COLOR_ADJUST_WORKGROUP_HEIGHT}
)
fn adjustRasterColor(@builtin(global_invocation_id) gid: vec3<u32>) {
  let size = textureDimensions(immutableSource);
  if (gid.x >= size.x || gid.y >= size.y) { return; }
  let source = textureLoad(immutableSource, vec2<i32>(gid.xy), 0);
  let alpha = clamp(source.a, 0.0, 1.0);
  let outputPixel = vec2<i32>(gid.xy + parameters.outputOrigin);
  if (alpha <= RASTER_ADJUSTMENT_ALPHA_EPSILON) {
    textureStore(adjustedOutput, outputPixel, vec4<f32>(0.0, 0.0, 0.0, alpha));
    return;
  }
  let encoded = rasterAdjustmentStoredToStraightEncoded(source);
  let hsv = encodedRgbToHsv(encoded);
  let adjustedHsv = vec3<f32>(
    hsv.x + parameters.adjustments.x,
    adjustUnitComponent(hsv.y, parameters.adjustments.y),
    adjustUnitComponent(hsv.z, parameters.adjustments.z)
  );
  let adjustedEncoded = hsvToEncodedRgb(adjustedHsv);
  let stored = rasterAdjustmentStraightEncodedToStored(adjustedEncoded, alpha);
  textureStore(
    adjustedOutput,
    outputPixel,
    rasterAdjustmentFinalizeStored(
      stored,
      gid.xy + parameters.outputOrigin,
      parameters.quantizationSeed
    )
  );
}
`;
}

const LEGACY_RASTER_ADJUSTMENT_PROFILE: RasterAdjustmentStorageProfile = {
  layerFormat: "rgba16float",
  colorSpace: "linear-premultiplied",
};

/** Legacy shader export retained for tests and standalone consumers. */
export const rasterColorAdjustShader =
  createRasterColorAdjustShader(LEGACY_RASTER_ADJUSTMENT_PROFILE);
