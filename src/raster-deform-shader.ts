/** Mesh shader shared by raster Warp and four-corner Perspective. */
import { DOCUMENT_HEIGHT, DOCUMENT_WIDTH } from "./engine-limits.ts";

export const RASTER_DEFORM_SHADER_STRATEGY =
  "mesh-grid-perspective-correct-transparent-border-mip-v1" as const;

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

fn srgbToLinearChannel(value: f32) -> f32 {
  if (value <= 0.04045) { return value / 12.92; }
  return pow((value + 0.055) / 1.055, 2.4);
}

fn linearToSrgbChannel(value: f32) -> f32 {
  let clamped = clamp(value, 0.0, 1.0);
  if (clamped <= 0.0031308) { return clamped * 12.92; }
  return 1.055 * pow(clamped, 1.0 / 2.4) - 0.055;
}

fn preserveDarkCoverage(value: vec4<f32>, lod: f32) -> vec4<f32> {
  let alpha = clamp(value.a, 0.0, 1.0);
  if (alpha <= 0.000001 || alpha >= 0.999999 || lod < 1.0) { return value; }
  let straightLinear = clamp(value.rgb / alpha, vec3<f32>(0.0), vec3<f32>(1.0));
  let straightSrgb = vec3<f32>(
    linearToSrgbChannel(straightLinear.r),
    linearToSrgbChannel(straightLinear.g),
    linearToSrgbChannel(straightLinear.b)
  );
  let darkness = 1.0 - dot(straightSrgb, vec3<f32>(0.2126, 0.7152, 0.0722));
  let encodedCoverage = 1.0 - srgbToLinearChannel(1.0 - alpha);
  let displayAlpha = mix(alpha, encodedCoverage, clamp(darkness, 0.0, 1.0));
  return vec4<f32>(straightLinear * displayAlpha, displayAlpha);
}

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
  let ndc = vec2<f32>(
    destination.x * (2.0 / ${DOCUMENT_WIDTH}.0) - 1.0,
    1.0 - destination.y * (2.0 / ${DOCUMENT_HEIGHT}.0)
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
  let lod = floor(clamp(log2(max(footprint, 1.0)), 0.0, f32(maximumLevel)));
  return preserveDarkCoverage(
    sampleTransparentLevel(input.sourceUv, u32(lod)),
    lod
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
