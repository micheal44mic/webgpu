import { DOCUMENT_HEIGHT, DOCUMENT_WIDTH } from "./engine-limits.ts";
import { rasterPixelViewShaderHelpers } from "./raster-pixel-view.ts";

export const MIXED_SCENE_COMPOSITOR_STRATEGY =
  "ordered-raster-vector-gpu-runs-rgba16f-roi-source-over-raster-nearest-at-581pct-v5" as const;

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
  clippingMode: f32,
  clippingParentOpacity: f32,
  clippingPrefixScale: f32,
  clippingSuffixScale: f32,
  clippingPrefixOrigin: vec2<f32>,
  clippingSuffixOrigin: vec2<f32>,
  backgroundColor: vec4<f32>,
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
  inverseRowX: vec4<f32>,
  inverseRowY: vec4<f32>,
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
  let sourceLayerPosition = vec2<f32>(
    dot(segment.inverseRowX.xy, layerPosition) + segment.inverseRowX.z,
    dot(segment.inverseRowY.xy, layerPosition) + segment.inverseRowY.z
  );
  let dimensions = vec2<f32>(textureDimensions(sourceTexture, 0));
  let resolutionScale = max(segment.resolutionScale, 1.0);
  let localPosition = (sourceLayerPosition - segment.origin) * resolutionScale;
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
  let inverseFootprint = max(segment.inverseRowX.w, 0.000001);
  let effectiveResolutionScale = resolutionScale * inverseFootprint;
  let lod = clamp(
    max(0.0, log2(effectiveResolutionScale / max(display.zoom, 0.000001))),
    0.0,
    maximumLod
  );
  if (rasterPixelViewEnabled(effectiveResolutionScale)) {
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

struct TextCacheUniforms {
  primaryOrigin: vec2<f32>,
  fallbackOrigin: vec2<f32>,
};

@group(0) @binding(0) var<uniform> display: DisplayUniforms;
@group(0) @binding(1) var<uniform> capture: TextCaptureUniforms;
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var sourceSampler: sampler;
@group(0) @binding(4) var<uniform> fallbackCapture: TextCaptureUniforms;
@group(0) @binding(5) var fallbackTexture: texture_2d<f32>;
@group(0) @binding(6) var<uniform> cache: TextCacheUniforms;


${fullscreenVertexShader}

@fragment
fn fragmentMain(@builtin(position) fragmentPosition: vec4<f32>) -> @location(0) vec4<f32> {
  let dimensions = vec2<i32>(textureDimensions(sourceTexture, 0));
  let pixel = vec2<i32>(fragmentPosition.xy) - vec2<i32>(cache.primaryOrigin);
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
  let sourceCapturePixel = capture.canvasSize * 0.5 + capture.zoom * vec2<f32>(
    capture.viewRotation.x * layerDelta.x - capture.viewRotation.y * layerDelta.y,
    capture.viewRotation.y * layerDelta.x + capture.viewRotation.x * layerDelta.y
  );
  let sourcePixel = sourceCapturePixel - cache.primaryOrigin;
  let sourceDimensions = vec2<f32>(dimensions);
  let insideSource = all(sourcePixel >= vec2<f32>(0.0))
    && all(sourcePixel < sourceDimensions);
  var sourceColor = vec4<f32>(0.0);
  if (insideSource) {
    sourceColor = textureSampleLevel(
      sourceTexture,
      sourceSampler,
      sourcePixel / sourceDimensions,
      0.0
    );
  }
  if (capture.fastMode < 2.5) {
    return sourceColor;
  }

  let fallbackDimensions = vec2<f32>(textureDimensions(fallbackTexture, 0));
  let fallbackDelta = layerPosition - fallbackCapture.viewCenter;
  let fallbackCapturePixel = fallbackCapture.canvasSize * 0.5
    + fallbackCapture.zoom * vec2<f32>(
    fallbackCapture.viewRotation.x * fallbackDelta.x
      - fallbackCapture.viewRotation.y * fallbackDelta.y,
    fallbackCapture.viewRotation.y * fallbackDelta.x
      + fallbackCapture.viewRotation.x * fallbackDelta.y
  );
  let fallbackPixel = fallbackCapturePixel - cache.fallbackOrigin;
  let insideFallback = all(fallbackPixel >= vec2<f32>(0.0))
    && all(fallbackPixel < fallbackDimensions);
  if (!insideFallback) {
    return sourceColor;
  }
  let fallbackColor = textureSampleLevel(
    fallbackTexture,
    sourceSampler,
    fallbackPixel / fallbackDimensions,
    0.0
  );
  if (!insideSource) {
    return fallbackColor;
  }

  // Blend only within four source pixels of the sharp-cache edge. Both colors
  // are premultiplied, so this removes a rectangular resolution seam without
  // changing alpha compositing or detaching the vector from the camera.
  let sourceEdgeDistance = min(
    min(sourceCapturePixel.x, sourceCapturePixel.y),
    min(
      capture.canvasSize.x - sourceCapturePixel.x,
      capture.canvasSize.y - sourceCapturePixel.y
    )
  );
  return mix(fallbackColor, sourceColor, smoothstep(0.0, 4.0, sourceEdgeDistance));
}
`;

/**
 * Draws the live parametric shape directly into the ordered scene. The
 * geometry stays in document space, so view changes need no geometry upload.
 */
export const mixedSceneShapePreviewShader = /* wgsl */ `
${displayUniformsShader}
struct ShapePreviewUniforms {
  frame: vec4<f32>,
  color: vec4<f32>,
  controls: vec4<f32>,
};

@group(0) @binding(0) var<uniform> display: DisplayUniforms;
@group(0) @binding(1) var<uniform> preview: ShapePreviewUniforms;

${fullscreenVertexShader}

fn segmentDistance(point: vec2<f32>, first: vec2<f32>, second: vec2<f32>) -> f32 {
  let edge = second - first;
  let amount = clamp(
    dot(point - first, edge) / max(dot(edge, edge), 0.000001),
    0.0,
    1.0
  );
  return length(point - (first + edge * amount));
}

fn starPoint(index: u32) -> vec2<f32> {
  let angle = -1.57079632679 + f32(index) * 0.62831853072;
  let radius = select(0.5, 1.0, (index & 1u) == 0u);
  let raw = vec2<f32>(cos(angle), sin(angle)) * radius;
  return vec2<f32>(
    (raw.x + 0.95105651630) / 1.90211303259,
    (raw.y + 1.0) / 1.80901699437
  );
}

fn starSignedDistance(point: vec2<f32>, frame: vec4<f32>) -> f32 {
  var inside = false;
  var minimumDistance = 1000000000.0;
  for (var index = 0u; index < 10u; index += 1u) {
    let firstUnit = starPoint(index);
    let secondUnit = starPoint((index + 1u) % 10u);
    let first = frame.xy + firstUnit * frame.zw;
    let second = frame.xy + secondUnit * frame.zw;
    minimumDistance = min(minimumDistance, segmentDistance(point, first, second));
    let crosses = (first.y > point.y) != (second.y > point.y);
    let crossingX = (second.x - first.x) * (point.y - first.y)
      / max(abs(second.y - first.y), 0.000001)
      * select(-1.0, 1.0, second.y >= first.y)
      + first.x;
    if (crosses && point.x < crossingX) {
      inside = !inside;
    }
  }
  return select(minimumDistance, -minimumDistance, inside);
}

@fragment
fn fragmentMain(@builtin(position) fragmentPosition: vec4<f32>) -> @location(0) vec4<f32> {
  if (preview.controls.y < 0.5 || any(preview.frame.zw <= vec2<f32>(0.0))) {
    return vec4<f32>(0.0);
  }
  let point = layerPositionAt(fragmentPosition.xy);
  let center = preview.frame.xy + preview.frame.zw * 0.5;
  let halfSize = preview.frame.zw * 0.5;
  let kind = preview.controls.x;
  var signedDistance = 0.0;
  if (kind < 0.5) {
    let distanceVector = abs(point - center) - halfSize;
    signedDistance = length(max(distanceVector, vec2<f32>(0.0)))
      + min(max(distanceVector.x, distanceVector.y), 0.0);
  } else if (kind < 1.5) {
    let normalized = (point - center) / max(halfSize, vec2<f32>(0.000001));
    signedDistance = (length(normalized) - 1.0) * min(halfSize.x, halfSize.y);
  } else {
    signedDistance = starSignedDistance(point, preview.frame);
  }
  let documentUnitsPerPixel = max(
    max(fwidth(point.x), fwidth(point.y)),
    0.000001
  );
  let coverage = 1.0 - smoothstep(
    -documentUnitsPerPixel * 0.5,
    documentUnitsPerPixel * 0.5,
    signedDistance
  );
  let alpha = preview.color.a * coverage;
  return vec4<f32>(preview.color.rgb * alpha, alpha);
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
fn backgroundFragmentMain() -> @location(0) vec4<f32> {
  let alpha = select(0.0, 1.0, display.backgroundColor.a > 0.5);
  return vec4<f32>(srgbToLinear(display.backgroundColor.rgb) * alpha, alpha);
}

@fragment
fn sourceFragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>
) -> @location(0) vec4<f32> {
  let dimensions = vec2<i32>(textureDimensions(sceneTexture, 0));
  let pixel = vec2<i32>(fragmentPosition.xy);
  if (any(pixel < vec2<i32>(0)) || any(pixel >= dimensions)) {
    return vec4<f32>(0.0);
  }
  return textureLoad(sceneTexture, pixel, 0);
}

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
  let checkerSrgb = select(vec3<f32>(0.82), vec3<f32>(0.91), checkerParity == 0);
  let backgroundSrgb = select(
    checkerSrgb,
    display.backgroundColor.rgb,
    display.backgroundColor.a > 0.5
  );
  let backgroundLinear = srgbToLinear(backgroundSrgb);
  let compositedLinear = paint.rgb + backgroundLinear * (1.0 - paint.a);
  return vec4<f32>(linearToSrgb(compositedLinear), 1.0);
}
`;
