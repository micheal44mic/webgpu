/**
 * Final presentation for authoritative brush previews.
 *
 * The engine's own Light Glaze commit-tile pipeline has already resolved the
 * gesture into the current layer format. This shader therefore does only the
 * same linear-premultiplied to encoded-sRGB conversion required by a visible
 * canvas, while preserving transparency around the sample stroke.
 */
export const brushStrokePreviewPresentShader = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var resolvedTexture: texture_2d<f32>;

fn linearToSrgbChannel(value: f32) -> f32 {
  let clamped = clamp(value, 0.0, 1.0);
  if (clamped <= 0.0031308) {
    return clamped * 12.92;
  }
  return 1.055 * pow(clamped, 1.0 / 2.4) - 0.055;
}

fn linearToSrgb(value: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    linearToSrgbChannel(value.r),
    linearToSrgbChannel(value.g),
    linearToSrgbChannel(value.b)
  );
}

fn linearPremultipliedToEncodedSrgb(value: vec4<f32>) -> vec4<f32> {
  let alpha = clamp(value.a, 0.0, 1.0);
  if (alpha <= 0.0) {
    return vec4<f32>(0.0);
  }
  let straightLinear = clamp(value.rgb / alpha, vec3<f32>(0.0), vec3<f32>(1.0));
  return vec4<f32>(linearToSrgb(straightLinear) * alpha, alpha);
}

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
fn fragmentMain(@builtin(position) fragmentPosition: vec4<f32>) -> @location(0) vec4<f32> {
  let dimensions = vec2<i32>(textureDimensions(resolvedTexture, 0));
  let pixel = clamp(vec2<i32>(fragmentPosition.xy), vec2<i32>(0), dimensions - vec2<i32>(1));
  return linearPremultipliedToEncodedSrgb(textureLoad(resolvedTexture, pixel, 0));
}
`;
