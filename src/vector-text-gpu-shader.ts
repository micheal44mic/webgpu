export const VECTOR_TEXT_GPU_RENDER_STRATEGY =
  "webgpu-indexed-vector-msaa4-exact-camera-redraw-v1" as const;

export const VECTOR_TEXT_GPU_TARGET_FORMAT: GPUTextureFormat = "rgba8unorm-srgb";
export const VECTOR_TEXT_GPU_SAMPLE_COUNT = 4;
export const VECTOR_TEXT_GPU_UNIFORM_FLOATS = 32;
export const VECTOR_TEXT_GPU_UNIFORM_BYTES = VECTOR_TEXT_GPU_UNIFORM_FLOATS * 4;
export const VECTOR_TEXT_GPU_UNIFORM_STRIDE = 256;
export const VECTOR_TEXT_GPU_BLUR_FORMAT: GPUTextureFormat = "r8unorm";
export const VECTOR_TEXT_GPU_BLUR_FILTER_UNIFORM_BYTES = 128;
export const VECTOR_TEXT_GPU_BLUR_COMPOSITE_UNIFORM_BYTES = 112;

export const vectorTextGpuShader = /* wgsl */ `
struct TextUniforms {
  canvasAndViewRotation: vec4<f32>,
  viewCenterAndZoom: vec4<f32>,
  nodePositionAndRotation: vec4<f32>,
  scaleAndLocalOffset: vec4<f32>,
  color: vec4<f32>,
  targetOriginAndSize: vec4<f32>,
  shapeBounds: vec4<f32>,
  effectSampleOffset: vec4<f32>,
};

struct VertexInput {
  @location(0) localPosition: vec2<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var<uniform> text: TextUniforms;

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  let canvasSize = text.canvasAndViewRotation.xy;
  let viewRotation = text.canvasAndViewRotation.zw;
  let viewCenter = text.viewCenterAndZoom.xy;
  let zoom = text.viewCenterAndZoom.z;
  let nodePosition = text.nodePositionAndRotation.xy;
  let targetOrigin = text.targetOriginAndSize.xy;
  let targetSize = text.targetOriginAndSize.zw;
  let nodeRotation = text.nodePositionAndRotation.zw;
  let local = (
    input.localPosition + text.scaleAndLocalOffset.yz
  ) * text.scaleAndLocalOffset.x;
  let layerPosition = nodePosition + vec2<f32>(
    nodeRotation.x * local.x - nodeRotation.y * local.y,
    nodeRotation.y * local.x + nodeRotation.x * local.y
  );
  let layerDelta = layerPosition - viewCenter;
  let canvasPosition = canvasSize * 0.5 + zoom * vec2<f32>(
    viewRotation.x * layerDelta.x - viewRotation.y * layerDelta.y,
    viewRotation.y * layerDelta.x + viewRotation.x * layerDelta.y
  );
  let targetPosition = canvasPosition - targetOrigin;
  let clip = vec2<f32>(
    targetPosition.x / targetSize.x * 2.0 - 1.0,
    1.0 - targetPosition.y / targetSize.y * 2.0
  );
  var output: VertexOutput;
  output.position = vec4<f32>(clip, 0.0, 1.0);
  return output;
}

@fragment
fn fragmentMain() -> @location(0) vec4<f32> {
  return vec4<f32>(text.color.rgb * text.color.a, text.color.a);
}

@vertex
fn blurMaskVertexMain(input: VertexInput) -> VertexOutput {
  let absoluteLocal = input.localPosition + text.scaleAndLocalOffset.yz;
  let span = max(text.shapeBounds.zw - text.shapeBounds.xy, vec2<f32>(1.0e-8));
  let uv = (absoluteLocal - text.shapeBounds.xy) / span;
  var output: VertexOutput;
  output.position = vec4<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0);
  return output;
}

@fragment
fn blurMaskFragmentMain() -> @location(0) vec4<f32> {
  return vec4<f32>(1.0);
}

struct MeshInnerShadowVertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) absoluteLocalPosition: vec2<f32>,
};

@vertex
fn meshInnerShadowVertexMain(input: VertexInput) -> MeshInnerShadowVertexOutput {
  let canvasSize = text.canvasAndViewRotation.xy;
  let viewRotation = text.canvasAndViewRotation.zw;
  let viewCenter = text.viewCenterAndZoom.xy;
  let zoom = text.viewCenterAndZoom.z;
  let absoluteLocal = input.localPosition + text.scaleAndLocalOffset.yz;
  let local = absoluteLocal * text.scaleAndLocalOffset.x;
  let nodeRotation = text.nodePositionAndRotation.zw;
  let layerPosition = text.nodePositionAndRotation.xy + vec2<f32>(
    nodeRotation.x * local.x - nodeRotation.y * local.y,
    nodeRotation.y * local.x + nodeRotation.x * local.y
  );
  let layerDelta = layerPosition - viewCenter;
  let canvasPosition = canvasSize * 0.5 + zoom * vec2<f32>(
    viewRotation.x * layerDelta.x - viewRotation.y * layerDelta.y,
    viewRotation.y * layerDelta.x + viewRotation.x * layerDelta.y
  );
  let targetPosition = canvasPosition - text.targetOriginAndSize.xy;
  let targetSize = text.targetOriginAndSize.zw;
  var output: MeshInnerShadowVertexOutput;
  output.position = vec4<f32>(
    targetPosition.x / targetSize.x * 2.0 - 1.0,
    1.0 - targetPosition.y / targetSize.y * 2.0,
    0.0,
    1.0
  );
  output.absoluteLocalPosition = absoluteLocal;
  return output;
}

@group(1) @binding(0) var meshInnerBlurredMask: texture_2d<f32>;
@group(1) @binding(1) var meshInnerBlurredSampler: sampler;

@fragment
fn meshInnerShadowFragmentMain(
  input: MeshInnerShadowVertexOutput
) -> @location(0) vec4<f32> {
  let shiftedPosition = input.absoluteLocalPosition - text.effectSampleOffset.xy;
  let span = max(text.shapeBounds.zw - text.shapeBounds.xy, vec2<f32>(1.0e-8));
  let uv = (shiftedPosition - text.shapeBounds.xy) / span;
  var shiftedMask = 0.0;
  if (all(uv >= vec2<f32>(0.0)) && all(uv <= vec2<f32>(1.0))) {
    shiftedMask = textureSampleLevel(
      meshInnerBlurredMask,
      meshInnerBlurredSampler,
      uv,
      0.0
    ).r;
  }
  let alpha = (1.0 - clamp(shiftedMask, 0.0, 1.0)) * text.color.a;
  return vec4<f32>(text.color.rgb * alpha, alpha);
}
`;

export const vectorTextGpuGaussianBlurShader = /* wgsl */ `
struct BlurUniforms {
  sizeAndRadius: vec4<u32>,
  weights: array<vec4<f32>, 7>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var<uniform> blur: BlurUniforms;
@group(0) @binding(1) var sourceTexture: texture_2d<f32>;

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

fn kernelWeight(index: u32) -> f32 {
  return blur.weights[index / 4u][index % 4u];
}

fn blurPixel(
  fragmentPosition: vec4<f32>,
  direction: vec2<i32>
) -> vec4<f32> {
  let size = vec2<i32>(blur.sizeAndRadius.xy);
  let center = vec2<i32>(fragmentPosition.xy);
  let radius = i32(blur.sizeAndRadius.z);
  var result = vec4<f32>(0.0);
  for (var offset = -24; offset <= 24; offset += 1) {
    if (abs(offset) > radius) {
      continue;
    }
    let samplePosition = center + direction * offset;
    if (
      all(samplePosition >= vec2<i32>(0))
      && all(samplePosition < size)
    ) {
      result += textureLoad(sourceTexture, samplePosition, 0)
        * kernelWeight(u32(abs(offset)));
    }
  }
  return result;
}

@fragment
fn horizontalMain(
  @builtin(position) fragmentPosition: vec4<f32>
) -> @location(0) vec4<f32> {
  return blurPixel(fragmentPosition, vec2<i32>(1, 0));
}

@fragment
fn verticalMain(
  @builtin(position) fragmentPosition: vec4<f32>
) -> @location(0) vec4<f32> {
  return blurPixel(fragmentPosition, vec2<i32>(0, 1));
}
`;

export const vectorTextGpuBlurCompositeShader = /* wgsl */ `
struct CompositeUniforms {
  canvasAndViewRotation: vec4<f32>,
  viewCenterAndZoom: vec4<f32>,
  nodePositionAndRotation: vec4<f32>,
  scaleAndLocalOffset: vec4<f32>,
  color: vec4<f32>,
  targetOriginAndSize: vec4<f32>,
  shapeBounds: vec4<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@group(0) @binding(0) var<uniform> composite: CompositeUniforms;
@group(0) @binding(1) var blurredMask: texture_2d<f32>;
@group(0) @binding(2) var blurredSampler: sampler;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let corners = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 0.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(0.0, 1.0)
  );
  let corner = corners[vertexIndex];
  let localPosition = mix(
    composite.shapeBounds.xy,
    composite.shapeBounds.zw,
    corner
  ) + composite.scaleAndLocalOffset.yz;
  let scaled = localPosition * composite.scaleAndLocalOffset.x;
  let nodeRotation = composite.nodePositionAndRotation.zw;
  let layerPosition = composite.nodePositionAndRotation.xy + vec2<f32>(
    nodeRotation.x * scaled.x - nodeRotation.y * scaled.y,
    nodeRotation.y * scaled.x + nodeRotation.x * scaled.y
  );
  let layerDelta = layerPosition - composite.viewCenterAndZoom.xy;
  let viewRotation = composite.canvasAndViewRotation.zw;
  let canvasPosition = composite.canvasAndViewRotation.xy * 0.5
    + composite.viewCenterAndZoom.z * vec2<f32>(
      viewRotation.x * layerDelta.x - viewRotation.y * layerDelta.y,
      viewRotation.y * layerDelta.x + viewRotation.x * layerDelta.y
    );
  let targetPosition = canvasPosition - composite.targetOriginAndSize.xy;
  let targetSize = composite.targetOriginAndSize.zw;
  var output: VertexOutput;
  output.position = vec4<f32>(
    targetPosition.x / targetSize.x * 2.0 - 1.0,
    1.0 - targetPosition.y / targetSize.y * 2.0,
    0.0,
    1.0
  );
  output.uv = corner;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let mask = textureSample(blurredMask, blurredSampler, input.uv).r;
  let alpha = mask * composite.color.a;
  return vec4<f32>(composite.color.rgb * alpha, alpha);
}
`;
