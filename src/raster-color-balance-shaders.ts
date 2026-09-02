/** WebGPU kernel for the selected raster's live tonal color balance. */

import type { RasterAdjustmentStorageProfile } from "./raster-adjustment-storage-shader.ts";
import { rasterAdjustmentStorageShader } from "./raster-adjustment-storage-shader.ts";

export const RASTER_COLOR_BALANCE_WORKGROUP_WIDTH = 8;
export const RASTER_COLOR_BALANCE_WORKGROUP_HEIGHT = 8;

export interface RasterColorBalanceDispatchSize {
  readonly x: number;
  readonly y: number;
}

export function rasterColorBalanceDispatchSize(
  width: number,
  height: number,
): RasterColorBalanceDispatchSize {
  const safeWidth = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
  const safeHeight = Number.isFinite(height) ? Math.max(0, Math.floor(height)) : 0;
  return {
    x: Math.ceil(safeWidth / RASTER_COLOR_BALANCE_WORKGROUP_WIDTH),
    y: Math.ceil(safeHeight / RASTER_COLOR_BALANCE_WORKGROUP_HEIGHT),
  };
}

export function createRasterColorBalanceShader(
  profile: RasterAdjustmentStorageProfile,
): string {
  return /* wgsl */ `
struct RasterColorBalanceParameters {
  outputOrigin: vec2<u32>,
  quantizationSeed: u32,
  _originPadding: u32,
  shadows: vec4<f32>,
  midtones: vec4<f32>,
  highlights: vec4<f32>,
  options: vec4<f32>,
}

@group(0) @binding(0) var immutableSource: texture_2d<f32>;
@group(0) @binding(1) var balancedOutput:
  texture_storage_2d<${profile.layerFormat}, write>;
@group(0) @binding(2) var<uniform> parameters: RasterColorBalanceParameters;

const LUMINANCE_WEIGHTS: vec3<f32> = vec3<f32>(0.2126, 0.7152, 0.0722);

${rasterAdjustmentStorageShader(profile)}

fn tonalWeights(luminance: f32) -> vec3<f32> {
  let safeLuminance = clamp(luminance, 0.0, 1.0);
  if (safeLuminance <= 0.5) {
    let midtoneWeight = smoothstep(0.0, 0.5, safeLuminance);
    return vec3<f32>(1.0 - midtoneWeight, midtoneWeight, 0.0);
  }
  let highlightWeight = smoothstep(0.5, 1.0, safeLuminance);
  return vec3<f32>(0.0, 1.0 - highlightWeight, highlightWeight);
}

fn adjustUnitComponent(value: f32, amount: f32) -> f32 {
  let safeAmount = clamp(amount, -1.0, 1.0);
  return select(
    value + (1.0 - value) * safeAmount,
    value * (1.0 + safeAmount),
    safeAmount < 0.0
  );
}

fn matchLuminance(rgb: vec3<f32>, targetLuminance: f32) -> vec3<f32> {
  var result = rgb + vec3<f32>(targetLuminance - dot(rgb, LUMINANCE_WEIGHTS));
  let luminance = dot(result, LUMINANCE_WEIGHTS);
  let minimum = min(result.r, min(result.g, result.b));
  let maximum = max(result.r, max(result.g, result.b));
  if (minimum < 0.0) {
    let denominator = luminance - minimum;
    result = select(
      vec3<f32>(0.0),
      vec3<f32>(luminance)
        + (result - vec3<f32>(luminance)) * luminance / denominator,
      denominator > RASTER_ADJUSTMENT_ALPHA_EPSILON
    );
  }
  if (maximum > 1.0) {
    let denominator = maximum - luminance;
    result = select(
      vec3<f32>(1.0),
      vec3<f32>(luminance)
        + (result - vec3<f32>(luminance)) * (1.0 - luminance) / denominator,
      denominator > RASTER_ADJUSTMENT_ALPHA_EPSILON
    );
  }
  return clamp(result, vec3<f32>(0.0), vec3<f32>(1.0));
}

@compute @workgroup_size(
  ${RASTER_COLOR_BALANCE_WORKGROUP_WIDTH},
  ${RASTER_COLOR_BALANCE_WORKGROUP_HEIGHT}
)
fn balanceRasterColor(@builtin(global_invocation_id) gid: vec3<u32>) {
  let size = textureDimensions(immutableSource);
  if (gid.x >= size.x || gid.y >= size.y) { return; }
  let source = textureLoad(immutableSource, vec2<i32>(gid.xy), 0);
  let alpha = clamp(source.a, 0.0, 1.0);
  let outputPixel = vec2<i32>(gid.xy + parameters.outputOrigin);
  if (alpha <= RASTER_ADJUSTMENT_ALPHA_EPSILON) {
    textureStore(balancedOutput, outputPixel, vec4<f32>(0.0, 0.0, 0.0, alpha));
    return;
  }
  let encoded = rasterAdjustmentStoredToStraightEncoded(source);
  let sourceLuminance = dot(encoded, LUMINANCE_WEIGHTS);
  let weights = tonalWeights(sourceLuminance);
  let adjustment = parameters.shadows.xyz * weights.x
    + parameters.midtones.xyz * weights.y
    + parameters.highlights.xyz * weights.z;
  var balanced = vec3<f32>(
    adjustUnitComponent(encoded.r, adjustment.x),
    adjustUnitComponent(encoded.g, adjustment.y),
    adjustUnitComponent(encoded.b, adjustment.z)
  );
  if (parameters.options.x > 0.5) {
    balanced = matchLuminance(balanced, sourceLuminance);
  }
  let stored = rasterAdjustmentStraightEncodedToStored(
    clamp(balanced, vec3<f32>(0.0), vec3<f32>(1.0)),
    alpha
  );
  textureStore(
    balancedOutput,
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
export const rasterColorBalanceShader =
  createRasterColorBalanceShader(LEGACY_RASTER_ADJUSTMENT_PROFILE);
