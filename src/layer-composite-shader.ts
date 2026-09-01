// Folds one premultiplied layer into a merged surface. The fixed-function
// source-over blend owns the destination term, so the pass never samples and
// renders the same texture subresource.
export const layerCompositeShader = /* wgsl */ `
struct LayerCompositeUniforms {
  destinationOrigin: vec2<f32>,
  destinationScale: f32,
  opacity: f32,
  sourceOrigin: vec2<f32>,
  sourceScale: f32,
  _pad0: f32,
  sourceDimensions: vec2<u32>,
  _pad1: vec2<u32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var<uniform> layer: LayerCompositeUniforms;

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

fn loadSource(pixel: vec2<i32>) -> vec4<f32> {
  let maximum = vec2<i32>(layer.sourceDimensions) - vec2<i32>(1);
  return textureLoad(sourceTexture, clamp(pixel, vec2<i32>(0), maximum), 0);
}

@fragment
fn fragmentMain(@builtin(position) fragmentPosition: vec4<f32>) -> @location(0) vec4<f32> {
  let destinationScale = max(layer.destinationScale, 1.0);
  let sourceScale = max(layer.sourceScale, 1.0);
  let targetPixel = fragmentPosition.xy - vec2<f32>(0.5);
  let documentPosition = layer.destinationOrigin + targetPixel / destinationScale;
  let sourcePosition = (documentPosition - layer.sourceOrigin) * sourceScale;
  let sourceFloor = floor(sourcePosition);
  let fraction = sourcePosition - sourceFloor;
  let origin = vec2<i32>(sourceFloor);
  let top = mix(loadSource(origin), loadSource(origin + vec2<i32>(1, 0)), fraction.x);
  let bottom = mix(
    loadSource(origin + vec2<i32>(0, 1)),
    loadSource(origin + vec2<i32>(1, 1)),
    fraction.x
  );
  return mix(top, bottom, fraction.y) * clamp(layer.opacity, 0.0, 1.0);
}
`;
