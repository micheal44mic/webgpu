import { LAYER_SIZE } from "./engine-limits.ts";
import { rasterPixelViewShaderHelpers } from "./raster-pixel-view.ts";

export const MIXED_SCENE_COMPOSITOR_STRATEGY =
  "ordered-raster-vector-gpu-runs-rgba16f-viewport-source-over-raster-nearest-at-581pct-v4" as const;

export const MIXED_SCENE_LINEAR_FORMAT = "rgba16float" as const;

const fullscreenVertexShader = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

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
`;

const displayUniformsShader = /* wgsl */ `
struct DisplayUniforms {
  canvasSize: vec2<f32>,
  viewRotation: vec2<f32>,
  viewCenter: vec2<f32>,
  zoom: f32,
  checkerSize: f32,
  selectedMipLevel: f32,
  hasMergedBelow: f32,
  hasMergedAbove: f32,
  activeLayerAlpha: f32,
  mergedBelowOrigin: vec2<f32>,
  mergedAboveOrigin: vec2<f32>,
};

fn layerPositionAt(fragmentPosition: vec2<f32>) -> vec2<f32> {
  let displayOffset = (fragmentPosition - display.canvasSize * 0.5) / display.zoom;
  let layerOffset = vec2<f32>(
    display.viewRotation.x * displayOffset.x + display.viewRotation.y * displayOffset.y,
    -display.viewRotation.y * displayOffset.x + display.viewRotation.x * displayOffset.y
  );
  return display.viewCenter + layerOffset;
}
`;

export const mixedSceneRasterSegmentShader = /* wgsl */ `
${displayUniformsShader}
struct SegmentUniforms {
  origin: vec2<f32>,
  resolutionScale: f32,
  opacity: f32,
};

@group(0) @binding(0) var<uniform> display: DisplayUniforms;
@group(0) @binding(1) var<uniform> segment: SegmentUniforms;
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var sourceSampler: sampler;

${rasterPixelViewShaderHelpers}
${fullscreenVertexShader}

@fragment
fn fragmentMain(@builtin(position) fragmentPosition: vec4<f32>) -> @location(0) vec4<f32> {
  let layerPosition = layerPositionAt(fragmentPosition.xy);
  let dimensions = vec2<f32>(textureDimensions(sourceTexture, 0));
  let resolutionScale = max(segment.resolutionScale, 1.0);
  let localPosition = (layerPosition - segment.origin) * resolutionScale;
  let inside = all(localPosition >= vec2<f32>(0.0))
    && all(localPosition < dimensions);
  if (!inside) {
    return vec4<f32>(0.0);
  }
  let uv = clamp(
    (localPosition + vec2<f32>(0.5)) / dimensions,
    vec2<f32>(0.0),
    vec2<f32>(1.0)
  );
  let maximumLod = f32(max(1u, textureNumLevels(sourceTexture)) - 1u);
  let lod = clamp(
    max(0.0, log2(resolutionScale / max(display.zoom, 0.000001))),
    0.0,
    maximumLod
  );
  if (rasterPixelViewEnabled(resolutionScale)) {
    return textureLoad(
      sourceTexture,
      rasterPixelViewTexel(
        uv,
        vec2<i32>(textureDimensions(sourceTexture, 0))
      ),
      0
    ) * segment.opacity;
  }
  return textureSampleLevel(sourceTexture, sourceSampler, uv, lod) * segment.opacity;
}
`;

export const mixedSceneTextSegmentShader = /* wgsl */ `
${displayUniformsShader}
struct TextCaptureUniforms {
  canvasSize: vec2<f32>,
  viewRotation: vec2<f32>,
  viewCenter: vec2<f32>,
  zoom: f32,
  fastMode: f32,
};

@group(0) @binding(0) var<uniform> display: DisplayUniforms;
@group(0) @binding(1) var<uniform> capture: TextCaptureUniforms;
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var sourceSampler: sampler;


${fullscreenVertexShader}

@fragment
fn fragmentMain(@builtin(position) fragmentPosition: vec4<f32>) -> @location(0) vec4<f32> {
  let dimensions = vec2<i32>(textureDimensions(sourceTexture, 0));
  let pixel = vec2<i32>(fragmentPosition.xy);
  if (capture.fastMode < 0.5) {
    let inside = all(pixel >= vec2<i32>(0)) && all(pixel < dimensions);
    if (!inside) {
      return vec4<f32>(0.0);
    }
    return textureLoad(sourceTexture, pixel, 0);
  }

  // Coverage is decided once on the CPU for the complete viewport.  An
  // unsafe pan/zoom-out keeps the whole last exact vector frame in screen
  // space until the bounded latest-only exact refresh arrives; it must never
  // combine a moved interior with transparent uncovered strips.
  if (capture.fastMode > 1.5) {
    let inside = all(pixel >= vec2<i32>(0)) && all(pixel < dimensions);
    if (!inside) {
      return vec4<f32>(0.0);
    }
    return textureLoad(sourceTexture, pixel, 0);
  }

  let layerPosition = layerPositionAt(fragmentPosition.xy);
  let layerDelta = layerPosition - capture.viewCenter;
  let sourcePixel = capture.canvasSize * 0.5 + capture.zoom * vec2<f32>(
    capture.viewRotation.x * layerDelta.x - capture.viewRotation.y * layerDelta.y,
    capture.viewRotation.y * layerDelta.x + capture.viewRotation.x * layerDelta.y
  );
  let sourceDimensions = vec2<f32>(dimensions);
  let insideSource = all(sourcePixel >= vec2<f32>(0.0))
    && all(sourcePixel < sourceDimensions);
  if (!insideSource) {
    // Defensive round-off fallback. The four-corner coverage guard makes
    // this unreachable for a correctly sized capture, but a stale floating
    // point edge must still show the complete frozen frame, never a hole.
    let insideFrozen = all(pixel >= vec2<i32>(0)) && all(pixel < dimensions);
    if (!insideFrozen) {
      return vec4<f32>(0.0);
    }
    return textureLoad(sourceTexture, pixel, 0);
  }
  return textureSampleLevel(
    sourceTexture,
    sourceSampler,
    sourcePixel / sourceDimensions,
    0.0
  );
}
`;

export const mixedSceneClearShader = /* wgsl */ `
${fullscreenVertexShader}

@fragment
fn fragmentMain() -> @location(0) vec4<f32> {
  return vec4<f32>(0.0);
}
`;

export const mixedScenePresentShader = /* wgsl */ `
${displayUniformsShader}
@group(0) @binding(0) var<uniform> display: DisplayUniforms;
@group(0) @binding(1) var sceneTexture: texture_2d<f32>;

fn srgbToLinearChannel(value: f32) -> f32 {
  if (value <= 0.04045) {
    return value / 12.92;
  }
  return pow((value + 0.055) / 1.055, 2.4);
}

fn srgbToLinear(value: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    srgbToLinearChannel(value.r),
    srgbToLinearChannel(value.g),
    srgbToLinearChannel(value.b)
  );
}

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

${fullscreenVertexShader}

@fragment
fn fragmentMain(@builtin(position) fragmentPosition: vec4<f32>) -> @location(0) vec4<f32> {
  let layerPosition = layerPositionAt(fragmentPosition.xy);
  let insideLayer = all(layerPosition >= vec2<f32>(0.0))
    && all(layerPosition < vec2<f32>(${LAYER_SIZE}.0));
  if (!insideLayer) {
    return vec4<f32>(vec3<f32>(0.055), 1.0);
  }

  let dimensions = vec2<i32>(textureDimensions(sceneTexture, 0));
  let pixel = clamp(
    vec2<i32>(fragmentPosition.xy),
    vec2<i32>(0),
    dimensions - vec2<i32>(1)
  );
  let paint = textureLoad(sceneTexture, pixel, 0);
  let checkerCell = vec2<i32>(floor(layerPosition / display.checkerSize));
  let checkerParity = (checkerCell.x + checkerCell.y) & 1;
  let backgroundSrgb = select(vec3<f32>(0.82), vec3<f32>(0.91), checkerParity == 0);
  let backgroundLinear = srgbToLinear(backgroundSrgb);
  let compositedLinear = paint.rgb + backgroundLinear * (1.0 - paint.a);
  return vec4<f32>(linearToSrgb(compositedLinear), 1.0);
}
`;
