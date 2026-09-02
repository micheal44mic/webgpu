/** WebGPU kernel for a selected raster's live Gradient Map preview. */

import { RASTER_GRADIENT_MAP_LUT_SIZE } from "./raster-gradient-map-core.ts";
import type { RasterAdjustmentStorageProfile } from "./raster-adjustment-storage-shader.ts";
import { rasterAdjustmentStorageShader } from "./raster-adjustment-storage-shader.ts";

export const RASTER_GRADIENT_MAP_WORKGROUP_WIDTH = 8;
export const RASTER_GRADIENT_MAP_WORKGROUP_HEIGHT = 8;

export interface RasterGradientMapDispatchSize {
  readonly x: number;
  readonly y: number;
}

export function rasterGradientMapDispatchSize(
  width: number,
  height: number,
): RasterGradientMapDispatchSize {
  const safeWidth = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
  const safeHeight = Number.isFinite(height) ? Math.max(0, Math.floor(height)) : 0;
  return {
    x: Math.ceil(safeWidth / RASTER_GRADIENT_MAP_WORKGROUP_WIDTH),
    y: Math.ceil(safeHeight / RASTER_GRADIENT_MAP_WORKGROUP_HEIGHT),
  };
}

export function createRasterGradientMapShader(
  profile: RasterAdjustmentStorageProfile,
): string {
  return /* wgsl */ `
struct RasterGradientMapParameters {
  outputOrigin: vec2<u32>,
  quantizationSeed: u32,
  _originPadding: u32,
  options: vec4<u32>,
}

struct RasterGradientMapLut {
  colors: array<vec4<f32>, ${RASTER_GRADIENT_MAP_LUT_SIZE}>,
}

@group(0) @binding(0) var immutableSource: texture_2d<f32>;
@group(0) @binding(1) var mappedOutput:
  texture_storage_2d<${profile.layerFormat}, write>;
@group(0) @binding(2) var<uniform> parameters: RasterGradientMapParameters;
@group(0) @binding(3) var<storage, read> gradientLut: RasterGradientMapLut;

const DITHER_RANGE: f32 = 1.0 / 255.0;
const LUT_LAST_INDEX: u32 = ${RASTER_GRADIENT_MAP_LUT_SIZE - 1}u;
const LUMINANCE_WEIGHTS: vec3<f32> = vec3<f32>(0.2126, 0.7152, 0.0722);

${rasterAdjustmentStorageShader(profile)}

fn coordinateHash(coordinate: vec2<u32>, seed: u32) -> u32 {
  var value = (coordinate.x * 0x9e3779b9u)
    ^ (coordinate.y * 0x85ebca6bu)
    ^ (seed * 0x27d4eb2du)
    ^ 0xc2b2ae35u;
  value = value ^ (value >> 16u);
  value = value * 0x7feb352du;
  value = value ^ (value >> 15u);
  value = value * 0x846ca68bu;
  return value ^ (value >> 16u);
}

fn ditherOffset(coordinate: vec2<u32>, seed: u32) -> f32 {
  let normalized = f32(coordinateHash(coordinate, seed) & 0xffffu) / 65535.0;
  return (normalized - 0.5) * DITHER_RANGE;
}

fn sampleGradientLut(position: f32) -> vec3<f32> {
  let coordinate = clamp(position, 0.0, 1.0) * f32(LUT_LAST_INDEX);
  let leftIndex = u32(floor(coordinate));
  let rightIndex = min(leftIndex + 1u, LUT_LAST_INDEX);
  let amount = fract(coordinate);
  return mix(
    gradientLut.colors[leftIndex].rgb,
    gradientLut.colors[rightIndex].rgb,
    amount
  );
}

@compute @workgroup_size(
  ${RASTER_GRADIENT_MAP_WORKGROUP_WIDTH},
  ${RASTER_GRADIENT_MAP_WORKGROUP_HEIGHT}
)
fn mapRasterGradient(@builtin(global_invocation_id) gid: vec3<u32>) {
  let size = textureDimensions(immutableSource);
  if (gid.x >= size.x || gid.y >= size.y) { return; }
  let source = textureLoad(immutableSource, vec2<i32>(gid.xy), 0);
  let alpha = clamp(source.a, 0.0, 1.0);
  let outputPixel = gid.xy + parameters.outputOrigin;
  if (alpha <= RASTER_ADJUSTMENT_ALPHA_EPSILON) {
    textureStore(mappedOutput, vec2<i32>(outputPixel), vec4<f32>(0.0, 0.0, 0.0, alpha));
    return;
  }
  let encoded = rasterAdjustmentStoredToStraightEncoded(source);
  var position = dot(encoded, LUMINANCE_WEIGHTS);
  if (parameters.options.x != 0u) {
    position = position + ditherOffset(outputPixel, parameters.quantizationSeed);
  }
  let mappedEncoded = sampleGradientLut(position);
  let stored = rasterAdjustmentStraightEncodedToStored(mappedEncoded, alpha);
  textureStore(
    mappedOutput,
    vec2<i32>(outputPixel),
    rasterAdjustmentFinalizeStored(
      stored,
      outputPixel,
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
export const rasterGradientMapShader =
  createRasterGradientMapShader(LEGACY_RASTER_ADJUSTMENT_PROFILE);
