import { DOCUMENT_HEIGHT, DOCUMENT_WIDTH } from "./engine-limits.ts";
import {
  perceptualRasterResamplingShader,
  perceptualRasterSamplingShader,
} from "./perceptual-raster-resampling.ts";
import { rasterPixelViewShaderHelpers } from "./raster-pixel-view.ts";

export const MIXED_SCENE_COMPOSITOR_STRATEGY =
  "ordered-raster-vector-gpu-runs-rgba16f-perceptual-raster-minification-source-over-v5" as const;

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
${perceptualRasterSamplingShader}

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
    localPosition / dimensions,
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
  if (display.zoom < 0.999999) {
    return perceptualSampleTrilinear(sourceTexture, uv, lod, true) * segment.opacity;
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
@group(0) @binding(4) var<uniform> fallbackCapture: TextCaptureUniforms;
@group(0) @binding(5) var fallbackTexture: texture_2d<f32>;


${fullscreenVertexShader}
${perceptualRasterSamplingShader}

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

  // Every fast mode follows the current camera. Mode 1 is fully covered by
  // the sharp capture. Mode 2 clips uncovered pixels. Mode 3 keeps the sharp
  // sample wherever it exists and fills newly revealed pixels from a second,
  // wider GPU capture prepared before the gesture.
  let layerPosition = layerPositionAt(fragmentPosition.xy);
  let layerDelta = layerPosition - capture.viewCenter;
  let sourcePixel = capture.canvasSize * 0.5 + capture.zoom * vec2<f32>(
    capture.viewRotation.x * layerDelta.x - capture.viewRotation.y * layerDelta.y,
    capture.viewRotation.y * layerDelta.x + capture.viewRotation.x * layerDelta.y
  );
  let sourceDimensions = vec2<f32>(dimensions);
  let insideSource = all(sourcePixel >= vec2<f32>(0.0))
    && all(sourcePixel < sourceDimensions);
  let sourceColor = select(
    vec4<f32>(0.0),
    perceptualSampleBilinear(
      sourceTexture,
      sourcePixel / sourceDimensions,
      0u,
      true
    ),
    insideSource
  );
  if (capture.fastMode < 2.5) {
    return sourceColor;
  }

  let fallbackDimensions = vec2<f32>(textureDimensions(fallbackTexture, 0));
  let fallbackDelta = layerPosition - fallbackCapture.viewCenter;
  let fallbackPixel = fallbackCapture.canvasSize * 0.5 + fallbackCapture.zoom * vec2<f32>(
    fallbackCapture.viewRotation.x * fallbackDelta.x
      - fallbackCapture.viewRotation.y * fallbackDelta.y,
    fallbackCapture.viewRotation.y * fallbackDelta.x
      + fallbackCapture.viewRotation.x * fallbackDelta.y
  );
  let insideFallback = all(fallbackPixel >= vec2<f32>(0.0))
    && all(fallbackPixel < fallbackDimensions);
  if (!insideFallback) {
    return sourceColor;
  }
  let fallbackColor = perceptualSampleBilinear(
    fallbackTexture,
    fallbackPixel / fallbackDimensions,
    0u,
    true
  );
  if (!insideSource) {
    return fallbackColor;
  }

  // Blend only within four source pixels of the sharp-cache edge. Both colors
  // are premultiplied, so this removes a rectangular resolution seam without
  // changing alpha compositing or detaching the vector from the camera.
  let sourceEdgeDistance = min(
    min(sourcePixel.x, sourcePixel.y),
    min(sourceDimensions.x - sourcePixel.x, sourceDimensions.y - sourcePixel.y)
  );
  return mix(fallbackColor, sourceColor, smoothstep(0.0, 4.0, sourceEdgeDistance));
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

${perceptualRasterResamplingShader}

${fullscreenVertexShader}

@fragment
fn fragmentMain(@builtin(position) fragmentPosition: vec4<f32>) -> @location(0) vec4<f32> {
  let layerPosition = layerPositionAt(fragmentPosition.xy);
  let insideLayer = all(layerPosition >= vec2<f32>(0.0))
    && all(layerPosition < vec2<f32>(${DOCUMENT_WIDTH}.0, ${DOCUMENT_HEIGHT}.0));
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
  return vec4<f32>(rasterPresentationCompositeOverSrgbBackground(
    paint,
    backgroundSrgb
  ), 1.0);
}
`;
