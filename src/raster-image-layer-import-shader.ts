/**
 * Transient WebGPU shaders used while importing a decoded bitmap into an
 * authoritative paint layer.
 *
 * The browser decoder exposes straight-alpha sRGB pixels. Paint layers store
 * linear-premultiplied values, so copying the external image directly into the
 * layer would produce incorrect blending and dark transparent edges. The first
 * pass performs that conversion into a temporary linear RGBA16F mip chain; the
 * last pass samples the chain into the document's authoritative RGBA16F layer.
 */

export const RASTER_IMAGE_LAYER_IMPORT_STRATEGY =
  "decoded-rgba8-srgb-to-linear-premultiplied-rgba16float-exact-npot-mips-native-layer-v3" as const;

export const rasterImageLayerUploadShader = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;

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
fn fragmentPremultiplyMain(
  @builtin(position) fragmentPosition: vec4<f32>
) -> @location(0) vec4<f32> {
  let dimensions = vec2<i32>(textureDimensions(sourceTexture, 0));
  let coordinate = clamp(
    vec2<i32>(fragmentPosition.xy),
    vec2<i32>(0),
    dimensions - vec2<i32>(1)
  );
  let straightLinear = textureLoad(sourceTexture, coordinate, 0);
  return vec4<f32>(straightLinear.rgb * straightLinear.a, straightLinear.a);
}

fn texelOverlap(start: f32, end: f32, coordinate: i32) -> f32 {
  let texelStart = f32(coordinate);
  return max(0.0, min(end, texelStart + 1.0) - max(start, texelStart));
}

@fragment
fn fragmentMipmapMain(
  @builtin(position) fragmentPosition: vec4<f32>
) -> @location(0) vec4<f32> {
  let sourceDimensions = vec2<i32>(textureDimensions(sourceTexture, 0));
  let destinationDimensions = max(sourceDimensions / vec2<i32>(2), vec2<i32>(1));
  let destinationCoordinate = vec2<i32>(fragmentPosition.xy);
  let sourceScale = vec2<f32>(sourceDimensions) / vec2<f32>(destinationDimensions);
  let sourceStart = vec2<f32>(destinationCoordinate) * sourceScale;
  let sourceEnd = vec2<f32>(destinationCoordinate + vec2<i32>(1)) * sourceScale;
  let firstSourceCoordinate = vec2<i32>(floor(sourceStart));

  var accumulated = vec4<f32>(0.0);
  var accumulatedWeight = 0.0;
  for (var y = 0; y < 3; y = y + 1) {
    let sourceY = firstSourceCoordinate.y + y;
    if (sourceY >= 0 && sourceY < sourceDimensions.y) {
      let weightY = texelOverlap(sourceStart.y, sourceEnd.y, sourceY);
      for (var x = 0; x < 3; x = x + 1) {
        let sourceX = firstSourceCoordinate.x + x;
        if (sourceX >= 0 && sourceX < sourceDimensions.x) {
          let weight = weightY * texelOverlap(sourceStart.x, sourceEnd.x, sourceX);
          accumulated += textureLoad(
            sourceTexture,
            vec2<i32>(sourceX, sourceY),
            0
          ) * weight;
          accumulatedWeight += weight;
        }
      }
    }
  }
  return accumulated / max(accumulatedWeight, 0.000001);
}
`;

export const rasterImageLayerBlitShader = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let positions = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0,  1.0)
  );
  // Clip-space Y grows upward, while decoded image V grows downward. Pair the
  // bottom clip vertices with V=1 and the top vertices with V=0 so the bitmap
  // enters the document without a vertical reflection.
  let texcoords = array<vec2<f32>, 4>(
    vec2<f32>(0.0, 1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 0.0)
  );
  var output: VertexOutput;
  output.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  output.uv = texcoords[vertexIndex];
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  // Explicit gradients select the transient exact-area mip chain when the
  // source is reduced. At 1:1, destination pixel centres coincide with source
  // texel centres and the linear sample remains byte-faithful modulo the
  // required sRGB-to-linear and premultiplication conversion.
  return textureSampleGrad(
    sourceTexture,
    sourceSampler,
    input.uv,
    dpdx(input.uv),
    dpdy(input.uv)
  );
}
`;
