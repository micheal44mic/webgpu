export const VECTOR_TEXT_GPU_RENDER_STRATEGY =
  "webgpu-indexed-vector-tagged-rgba16float-msaa4-adaptive-tiled-coverage-svg-gradients-v5" as const;

export const VECTOR_TEXT_GPU_TARGET_FORMAT: GPUTextureFormat = "rgba16float";
export const VECTOR_TEXT_GPU_TARGET_BYTES_PER_PIXEL = 8;
export const VECTOR_TEXT_GPU_SAMPLE_COUNT = 4;
export const VECTOR_TEXT_GPU_QUALITY_TILE_SIZE = 256;
export const VECTOR_TEXT_GPU_QUALITY_SCALE = 4;
export const VECTOR_TEXT_GPU_QUALITY_MAX_SCALE = 32;
export const VECTOR_TEXT_GPU_UNIFORM_FLOATS = 60;
export const VECTOR_TEXT_GPU_UNIFORM_BYTES = VECTOR_TEXT_GPU_UNIFORM_FLOATS * 4;
export const VECTOR_TEXT_GPU_UNIFORM_STRIDE = 256;
export const VECTOR_TEXT_GPU_BLUR_FORMAT: GPUTextureFormat = "r16float";
export const VECTOR_TEXT_GPU_BLUR_BYTES_PER_PIXEL = 2;
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
  gradientMeta: vec4<u32>,
  gradientTransform0: vec4<f32>,
  gradientTransform1: vec4<f32>,
  gradientGeometry: vec4<f32>,
  gradientFocal: vec4<f32>,
  gradientStopOffsets: vec4<f32>,
  gradientStopColors: vec4<u32>,
};

struct VertexInput {
  @location(0) localPosition: vec2<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) absoluteLocalPosition: vec2<f32>,
};

@group(0) @binding(0) var<uniform> text: TextUniforms;

fn stableRasterCanvasPosition(position: vec2<f32>) -> vec2<f32> {
  // Render-target crops and document chunks may translate the same geometry by
  // whole pixels. Centering vertices in a fine subpixel bin before NDC
  // conversion keeps MSAA edge coverage invariant across those target sizes.
  let subpixelGrid = 64.0;
  return (floor(position * subpixelGrid) + vec2<f32>(0.5)) / subpixelGrid;
}

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
  ) * text.scaleAndLocalOffset.xw;
  let layerPosition = nodePosition + vec2<f32>(
    nodeRotation.x * local.x - nodeRotation.y * local.y,
    nodeRotation.y * local.x + nodeRotation.x * local.y
  );
  let layerDelta = layerPosition - viewCenter;
  let canvasPosition = canvasSize * 0.5 + zoom * vec2<f32>(
    viewRotation.x * layerDelta.x - viewRotation.y * layerDelta.y,
    viewRotation.y * layerDelta.x + viewRotation.x * layerDelta.y
  );
  let targetPosition = stableRasterCanvasPosition(canvasPosition) - targetOrigin;
  let clip = vec2<f32>(
    targetPosition.x / targetSize.x * 2.0 - 1.0,
    1.0 - targetPosition.y / targetSize.y * 2.0
  );
  var output: VertexOutput;
  output.position = vec4<f32>(clip, 0.0, 1.0);
  output.absoluteLocalPosition = input.localPosition + text.scaleAndLocalOffset.yz;
  return output;
}

fn srgbChannelToLinear(value: f32) -> f32 {
  if (value <= 0.04045) {
    return value / 12.92;
  }
  return pow((value + 0.055) / 1.055, 2.4);
}

fn linearChannelToSrgb(value: f32) -> f32 {
  let clamped = clamp(value, 0.0, 1.0);
  if (clamped <= 0.0031308) {
    return clamped * 12.92;
  }
  return 1.055 * pow(clamped, 1.0 / 2.4) - 0.055;
}

fn presentationPremultipliedColor(
  straightLinear: vec3<f32>,
  alphaInput: f32
) -> vec4<f32> {
  let alpha = clamp(alphaInput, 0.0, 1.0);
  if (text.viewCenterAndZoom.w > 0.5) {
    let encoded = vec3<f32>(
      linearChannelToSrgb(straightLinear.r),
      linearChannelToSrgb(straightLinear.g),
      linearChannelToSrgb(straightLinear.b)
    );
    return vec4<f32>(encoded * alpha, alpha);
  }
  return vec4<f32>(straightLinear * alpha, alpha);
}

fn unpackGradientStop(packed: u32) -> vec4<f32> {
  return vec4<f32>(
    f32(packed & 255u),
    f32((packed >> 8u) & 255u),
    f32((packed >> 16u) & 255u),
    f32((packed >> 24u) & 255u)
  ) / 255.0;
}

fn spreadGradientParameter(value: f32, spread: u32) -> f32 {
  if (spread == 1u) {
    let repeated = value - floor(value * 0.5) * 2.0;
    return select(2.0 - repeated, repeated, repeated <= 1.0);
  }
  if (spread == 2u) {
    return value - floor(value);
  }
  return clamp(value, 0.0, 1.0);
}

fn gradientCoordinate(localPosition: vec2<f32>) -> vec2<f32> {
  let affine = text.gradientTransform0;
  let translation = text.gradientTransform1.xy;
  let determinant = affine.x * affine.w - affine.y * affine.z;
  if (abs(determinant) <= 1.0e-12) {
    return vec2<f32>(0.0);
  }
  let delta = localPosition - translation;
  return vec2<f32>(
    affine.w * delta.x - affine.z * delta.y,
    -affine.y * delta.x + affine.x * delta.y
  ) / determinant;
}

fn linearGradientParameter(position: vec2<f32>) -> f32 {
  let start = text.gradientGeometry.xy;
  let direction = text.gradientGeometry.zw - start;
  return dot(position - start, direction) / max(dot(direction, direction), 1.0e-12);
}

fn radialGradientParameter(position: vec2<f32>) -> f32 {
  let center = text.gradientGeometry.xy;
  let radius = max(text.gradientGeometry.z, 1.0e-8);
  let focalRadius = clamp(text.gradientGeometry.w, 0.0, radius);
  let focal = text.gradientFocal.xy;
  let ray = position - focal;
  let focalFromCenter = focal - center;
  let a = max(dot(ray, ray), 1.0e-12);
  let b = 2.0 * dot(focalFromCenter, ray);
  let c = dot(focalFromCenter, focalFromCenter) - radius * radius;
  let discriminant = max(0.0, b * b - 4.0 * a * c);
  let intersection = max((-b + sqrt(discriminant)) / (2.0 * a), 1.0e-8);
  let outerParameter = 1.0 / intersection;
  return (outerParameter * radius - focalRadius) / max(radius - focalRadius, 1.0e-8);
}

fn gradientColor(localPosition: vec2<f32>) -> vec4<f32> {
  let gradientPosition = gradientCoordinate(localPosition);
  let rawParameter = select(
    radialGradientParameter(gradientPosition),
    linearGradientParameter(gradientPosition),
    text.gradientMeta.x == 1u
  );
  let parameter = spreadGradientParameter(rawParameter, text.gradientMeta.y);
  let stopCount = clamp(text.gradientMeta.z, 1u, 4u);
  var leftIndex = 0u;
  var rightIndex = stopCount - 1u;
  for (var index = 1u; index < 4u; index += 1u) {
    if (index >= stopCount) {
      break;
    }
    if (parameter >= text.gradientStopOffsets[index]) {
      leftIndex = index;
    }
    if (parameter <= text.gradientStopOffsets[index]) {
      rightIndex = index;
      break;
    }
  }
  if (rightIndex < leftIndex) {
    rightIndex = leftIndex;
  }
  let leftOffset = text.gradientStopOffsets[leftIndex];
  let rightOffset = text.gradientStopOffsets[rightIndex];
  let ratio = select(
    clamp((parameter - leftOffset) / (rightOffset - leftOffset), 0.0, 1.0),
    0.0,
    abs(rightOffset - leftOffset) <= 1.0e-8
  );
  let left = unpackGradientStop(text.gradientStopColors[leftIndex]);
  let right = unpackGradientStop(text.gradientStopColors[rightIndex]);
  let srgb = mix(left.rgb, right.rgb, ratio);
  return vec4<f32>(
    srgbChannelToLinear(srgb.r),
    srgbChannelToLinear(srgb.g),
    srgbChannelToLinear(srgb.b),
    mix(left.a, right.a, ratio)
  );
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  if (text.gradientMeta.x != 0u) {
    let gradient = gradientColor(input.absoluteLocalPosition);
    let alpha = gradient.a * text.color.a;
    return presentationPremultipliedColor(gradient.rgb, alpha);
  }
  return presentationPremultipliedColor(text.color.rgb, text.color.a);
}

@vertex
fn blurMaskVertexMain(input: VertexInput) -> VertexOutput {
  let absoluteLocal = input.localPosition + text.scaleAndLocalOffset.yz;
  let span = max(text.shapeBounds.zw - text.shapeBounds.xy, vec2<f32>(1.0e-8));
  let uv = (absoluteLocal - text.shapeBounds.xy) / span;
  var output: VertexOutput;
  output.position = vec4<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0);
  output.absoluteLocalPosition = absoluteLocal;
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
  let local = absoluteLocal * text.scaleAndLocalOffset.xw;
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
  let targetPosition = stableRasterCanvasPosition(canvasPosition)
    - text.targetOriginAndSize.xy;
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
  return presentationPremultipliedColor(text.color.rgb, alpha);
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

fn compositeLinearChannelToSrgb(value: f32) -> f32 {
  let clamped = clamp(value, 0.0, 1.0);
  if (clamped <= 0.0031308) {
    return clamped * 12.92;
  }
  return 1.055 * pow(clamped, 1.0 / 2.4) - 0.055;
}

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
  let scaled = localPosition * composite.scaleAndLocalOffset.xw;
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
  let straightLinear = clamp(composite.color.rgb, vec3<f32>(0.0), vec3<f32>(1.0));
  if (composite.viewCenterAndZoom.w > 0.5) {
    let encoded = vec3<f32>(
      compositeLinearChannelToSrgb(straightLinear.r),
      compositeLinearChannelToSrgb(straightLinear.g),
      compositeLinearChannelToSrgb(straightLinear.b)
    );
    return vec4<f32>(encoded * alpha, alpha);
  }
  return vec4<f32>(straightLinear * alpha, alpha);
}
`;
