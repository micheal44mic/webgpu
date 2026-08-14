/**
 * Explicit MSAA4 resolve used only when semantic vector content becomes
 * authoritative raster pixels. Fixed-function WebGPU resolve always averages
 * decoded linear values; this pass keeps coverage linear while resolving the
 * bounded SDR color through the shared perceptual contract.
 */
import { perceptualRasterResamplingShader } from "./perceptual-raster-resampling.ts";

export const VECTOR_RASTER_RESOLVE_STRATEGY =
  "explicit-msaa4-perceptual-srgb-color-linear-coverage-v1" as const;

export const vectorRasterPerceptualResolveShader = /* wgsl */ `
${perceptualRasterResamplingShader}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var sourceTexture: texture_multisampled_2d<f32>;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0)
  );
  var output: VertexOutput;
  output.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  return output;
}

@fragment
fn fragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>
) -> @location(0) vec4<f32> {
  let dimensions = vec2<i32>(textureDimensions(sourceTexture));
  let coordinate = clamp(
    vec2<i32>(fragmentPosition.xy),
    vec2<i32>(0),
    dimensions - vec2<i32>(1)
  );
  return perceptualReduceFour(
    textureLoad(sourceTexture, coordinate, 0),
    textureLoad(sourceTexture, coordinate, 1),
    textureLoad(sourceTexture, coordinate, 2),
    textureLoad(sourceTexture, coordinate, 3)
  );
}
`;
