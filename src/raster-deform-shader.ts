import { rasterTransformRgba8ColorShader } from "./raster-transform-rgba8-shader.ts";

/** Mesh shader shared by raster Warp and four-corner Perspective. */

export const RASTER_DEFORM_SHADER_STRATEGY =
  "mesh-grid-linear-f32-rgba8-adjacent-output-continuous-mip-v3" as const;

export const rasterDeformShader = /* wgsl */ `
struct RasterTransformUniforms {
  sourceOrigin: vec2<f32>,
  sourceExtent: vec2<f32>,
  sourceContentMinimum: vec2<f32>,
  sourceContentMaximum: vec2<f32>,
  sourcePivot: vec2<f32>,
  destinationPivot: vec2<f32>,
  inverseRow0: vec2<f32>,
  inverseRow1: vec2<f32>,
  documentExtent: vec2<f32>,
  quantizationAndReserved: vec2<u32>,
};

struct DeformVertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) sourceUv: vec2<f32>,
};

struct FullscreenVertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var<uniform> transform: RasterTransformUniforms;
@group(0) @binding(1) var sourceTexture: texture_2d<f32>;
@group(0) @binding(2) var sourceSampler: sampler;

fn transparentBorderWeight(uv: vec2<f32>, mipLevel: u32) -> f32 {
  let dimensions = vec2<f32>(textureDimensions(sourceTexture, mipLevel));
  let texelPosition = uv * dimensions - vec2<f32>(0.5);
  let axisWeight = clamp(
    min(texelPosition + vec2<f32>(1.0), dimensions - texelPosition),
    vec2<f32>(0.0),
    vec2<f32>(1.0)
  );
  return axisWeight.x * axisWeight.y;
}

fn sampleTransparentLevel(uv: vec2<f32>, mipLevel: u32) -> vec4<f32> {
  return textureSampleLevel(sourceTexture, sourceSampler, uv, f32(mipLevel))
    * transparentBorderWeight(uv, mipLevel);
}

@vertex
fn deformVertexMain(
  @location(0) packed: vec4<f32>,
  @location(1) projectiveWeight: f32,
) -> DeformVertexOutput {
  let destination = packed.xy;
  let documentExtent = max(transform.documentExtent, vec2<f32>(1.0));
  let ndc = vec2<f32>(
    destination.x * (2.0 / documentExtent.x) - 1.0,
    1.0 - destination.y * (2.0 / documentExtent.y)
  );
  let safeWeight = max(projectiveWeight, 0.0001);
  var output: DeformVertexOutput;
  output.position = vec4<f32>(ndc * safeWeight, 0.0, safeWeight);
  output.sourceUv = packed.zw;
  return output;
}

@fragment
fn deformFragmentMain(input: DeformVertexOutput) -> @location(0) vec4<f32> {
  let dimensions = vec2<f32>(textureDimensions(sourceTexture, 0));
  let uvDx = dpdx(input.sourceUv);
  let uvDy = dpdy(input.sourceUv);
  let footprint = max(length(uvDx * dimensions), length(uvDy * dimensions));
  let maximumLevel = textureNumLevels(sourceTexture) - 1u;
  let continuousLod = clamp(
    log2(max(footprint, 1.0)),
    0.0,
    f32(maximumLevel)
  );
  let lowerLevel = u32(floor(continuousLod));
  let upperLevel = min(lowerLevel + 1u, maximumLevel);
  let lower = sampleTransparentLevel(input.sourceUv, lowerLevel);
  if (upperLevel == lowerLevel) { return lower; }
  let upper = sampleTransparentLevel(input.sourceUv, upperLevel);
  let lodBlend = fract(continuousLod);
  // Keep the complete native premultiplied sample continuous across mip
  // boundaries. Coverage is geometry, not a function of source luminance.
  return mix(lower, upper, lodBlend);
}

@vertex
fn clearVertexMain(@builtin(vertex_index) vertexIndex: u32) -> FullscreenVertexOutput {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0)
  );
  var output: FullscreenVertexOutput;
  output.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  return output;
}

@fragment
fn clearFragmentMain() -> @location(0) vec4<f32> {
  return vec4<f32>(0.0);
}
`;

/**
 * Encoded-sRGB RGBA8 variant. Manual per-level filtering decodes source texels
 * before f32 interpolation and quantizes only at the document write boundary.
 */
export const rasterDeformStoredEncodedShader = /* wgsl */ `
struct RasterTransformUniforms {
  sourceOrigin: vec2<f32>,
  sourceExtent: vec2<f32>,
  sourceContentMinimum: vec2<f32>,
  sourceContentMaximum: vec2<f32>,
  sourcePivot: vec2<f32>,
  destinationPivot: vec2<f32>,
  inverseRow0: vec2<f32>,
  inverseRow1: vec2<f32>,
  documentExtent: vec2<f32>,
  quantizationAndReserved: vec2<u32>,
};

struct DeformVertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) sourceUv: vec2<f32>,
};

struct FullscreenVertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var<uniform> transform: RasterTransformUniforms;
@group(0) @binding(1) var sourceTexture: texture_2d<f32>;
@group(0) @binding(2) var sourceSampler: sampler;

${rasterTransformRgba8ColorShader}

fn transparentBorderWeight(uv: vec2<f32>, mipLevel: u32) -> f32 {
  let dimensions = vec2<f32>(textureDimensions(sourceTexture, mipLevel));
  let texelPosition = uv * dimensions - vec2<f32>(0.5);
  let axisWeight = clamp(
    min(texelPosition + vec2<f32>(1.0), dimensions - texelPosition),
    vec2<f32>(0.0),
    vec2<f32>(1.0)
  );
  return axisWeight.x * axisWeight.y;
}

fn loadLinearSource(coordinate: vec2<i32>, mipLevel: u32) -> vec4<f32> {
  let dimensions = vec2<i32>(textureDimensions(sourceTexture, mipLevel));
  let bounded = clamp(coordinate, vec2<i32>(0), dimensions - vec2<i32>(1));
  return rasterTransformEncodedPremultipliedToLinear(
    textureLoad(sourceTexture, bounded, i32(mipLevel))
  );
}

fn sampleTransparentLevel(uv: vec2<f32>, mipLevel: u32) -> vec4<f32> {
  let dimensions = vec2<f32>(textureDimensions(sourceTexture, mipLevel));
  let texelPosition = uv * dimensions - vec2<f32>(0.5);
  let base = vec2<i32>(floor(texelPosition));
  let fraction = fract(texelPosition);
  let top = mix(
    loadLinearSource(base, mipLevel),
    loadLinearSource(base + vec2<i32>(1, 0), mipLevel),
    fraction.x
  );
  let bottom = mix(
    loadLinearSource(base + vec2<i32>(0, 1), mipLevel),
    loadLinearSource(base + vec2<i32>(1, 1), mipLevel),
    fraction.x
  );
  return mix(top, bottom, fraction.y) * transparentBorderWeight(uv, mipLevel);
}

@vertex
fn deformVertexMain(
  @location(0) packed: vec4<f32>,
  @location(1) projectiveWeight: f32,
) -> DeformVertexOutput {
  let destination = packed.xy;
  let documentExtent = max(transform.documentExtent, vec2<f32>(1.0));
  let ndc = vec2<f32>(
    destination.x * (2.0 / documentExtent.x) - 1.0,
    1.0 - destination.y * (2.0 / documentExtent.y)
  );
  let safeWeight = max(projectiveWeight, 0.0001);
  var output: DeformVertexOutput;
  output.position = vec4<f32>(ndc * safeWeight, 0.0, safeWeight);
  output.sourceUv = packed.zw;
  return output;
}

@fragment
fn deformFragmentMain(input: DeformVertexOutput) -> @location(0) vec4<f32> {
  let dimensions = vec2<f32>(textureDimensions(sourceTexture, 0));
  let uvDx = dpdx(input.sourceUv);
  let uvDy = dpdy(input.sourceUv);
  let footprint = max(length(uvDx * dimensions), length(uvDy * dimensions));
  let maximumLevel = textureNumLevels(sourceTexture) - 1u;
  let continuousLod = clamp(log2(max(footprint, 1.0)), 0.0, f32(maximumLevel));
  let lowerLevel = u32(floor(continuousLod));
  let upperLevel = min(lowerLevel + 1u, maximumLevel);
  let lower = sampleTransparentLevel(input.sourceUv, lowerLevel);
  var filtered = lower;
  if (upperLevel != lowerLevel) {
    let upper = sampleTransparentLevel(input.sourceUv, upperLevel);
    filtered = mix(lower, upper, fract(continuousLod));
  }
  return rasterTransformFinalizeRgba8(
    filtered,
    vec2<u32>(input.position.xy),
    transform.quantizationAndReserved.x
  );
}

@vertex
fn clearVertexMain(@builtin(vertex_index) vertexIndex: u32) -> FullscreenVertexOutput {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0)
  );
  var output: FullscreenVertexOutput;
  output.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  return output;
}

@fragment
fn clearFragmentMain() -> @location(0) vec4<f32> {
  return vec4<f32>(0.0);
}
`;
