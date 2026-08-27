/** WebGPU kernel for a selected raster's live Gradient Map preview. */

import { RASTER_GRADIENT_MAP_LUT_SIZE } from "./raster-gradient-map-core.ts";

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

export const rasterGradientMapShader = /* wgsl */ `
struct RasterGradientMapParameters {
  outputOrigin: vec2<u32>,
  _originPadding: vec2<u32>,
  options: vec4<u32>,
}

struct RasterGradientMapLut {
  colors: array<vec4<f32>, ${RASTER_GRADIENT_MAP_LUT_SIZE}>,
}

@group(0) @binding(0) var immutableSource: texture_2d<f32>;
@group(0) @binding(1) var mappedOutput:
  texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> parameters: RasterGradientMapParameters;
@group(0) @binding(3) var<storage, read> gradientLut: RasterGradientMapLut;

const ALPHA_EPSILON: f32 = 0.0000001;
const DITHER_RANGE: f32 = 1.0 / 255.0;
const LUT_LAST_INDEX: u32 = ${RASTER_GRADIENT_MAP_LUT_SIZE - 1}u;
const LUMINANCE_WEIGHTS: vec3<f32> = vec3<f32>(0.2126, 0.7152, 0.0722);

fn linearRgbToEncodedRgb(value: vec3<f32>) -> vec3<f32> {
  let linear = clamp(value, vec3<f32>(0.0), vec3<f32>(1.0));
  let lower = linear * 12.92;
  let upper = 1.055 * pow(linear, vec3<f32>(1.0 / 2.4)) - vec3<f32>(0.055);
  return select(upper, lower, linear <= vec3<f32>(0.0031308));
}

fn encodedRgbToLinearRgb(value: vec3<f32>) -> vec3<f32> {
  let encoded = clamp(value, vec3<f32>(0.0), vec3<f32>(1.0));
  let lower = encoded / 12.92;
  let upper = pow(
    (encoded + vec3<f32>(0.055)) / 1.055,
    vec3<f32>(2.4)
  );
  return select(upper, lower, encoded <= vec3<f32>(0.04045));
}

fn coordinateHash(coordinate: vec2<u32>) -> u32 {
  var value = (coordinate.x * 0x9e3779b9u)
    ^ (coordinate.y * 0x85ebca6bu)
    ^ 0xc2b2ae35u;
  value = value ^ (value >> 16u);
  value = value * 0x7feb352du;
  value = value ^ (value >> 15u);
  value = value * 0x846ca68bu;
  return value ^ (value >> 16u);
}

fn ditherOffset(coordinate: vec2<u32>) -> f32 {
  let normalized = f32(coordinateHash(coordinate) & 0xffffu) / 65535.0;
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
  if (alpha <= ALPHA_EPSILON) {
    textureStore(mappedOutput, vec2<i32>(outputPixel), vec4<f32>(0.0, 0.0, 0.0, alpha));
    return;
  }
  let straightLinear = clamp(source.rgb / alpha, vec3<f32>(0.0), vec3<f32>(1.0));
  let encoded = linearRgbToEncodedRgb(straightLinear);
  var position = dot(encoded, LUMINANCE_WEIGHTS);
  if (parameters.options.x != 0u) {
    position = position + ditherOffset(outputPixel);
  }
  let mappedEncoded = sampleGradientLut(position);
  let mappedLinear = encodedRgbToLinearRgb(mappedEncoded);
  textureStore(
    mappedOutput,
    vec2<i32>(outputPixel),
    vec4<f32>(mappedLinear * alpha, alpha)
  );
}
`;
