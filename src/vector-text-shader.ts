import { mergedSurfaceSamplingShader } from "./merged-surface-shader";

/**
 * Kittl/Fabric-style semantic text presentation.
 *
 * Text remains an ordered semantic object on the CPU. Exact view and text
 * changes rasterize each contiguous text run into a viewport-sized sRGB
 * cache. Under measured frame pressure, continuous view changes temporarily
 * reproject the frozen caches on the GPU; idle recovery rasterizes the exact
 * final view. A separate RGBA16F compositor preserves raster/text ordering,
 * while selection stays in an independent interaction canvas.
 */
export const VECTOR_TEXT_PRESENTATION_STRATEGY =
  "semantic-text-run-viewport-rgba8-srgb-segmented-rgba16f-adaptive-zoom-v5" as const;

export const vectorTextDisplayShader = /* wgsl */ `
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

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var<uniform> display: DisplayUniforms;
@group(0) @binding(1) var activeLayerBase: texture_2d<f32>;
@group(0) @binding(2) var activeLayerPyramid: texture_2d<f32>;
@group(0) @binding(3) var mergedBelowTexture: texture_2d<f32>;
@group(0) @binding(4) var mergedAboveTexture: texture_2d<f32>;
@group(0) @binding(5) var layerSampler: sampler;
@group(0) @binding(6) var vectorTextBelowTexture: texture_2d<f32>;
@group(0) @binding(7) var vectorTextAboveTexture: texture_2d<f32>;

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

fn sourceOver(source: vec4<f32>, destination: vec4<f32>) -> vec4<f32> {
  return source + destination * (1.0 - source.a);
}

fn sampleActiveLayer(uv: vec2<f32>) -> vec4<f32> {
  if (display.selectedMipLevel < 0.5) {
    return textureSampleLevel(activeLayerBase, layerSampler, uv, 0.0);
  }
  return textureSampleLevel(
    activeLayerPyramid,
    layerSampler,
    uv,
    display.selectedMipLevel - 1.0
  );
}

fn sampleViewportTexture(
  source: texture_2d<f32>,
  fragmentPosition: vec2<f32>
) -> vec4<f32> {
  let dimensions = vec2<i32>(textureDimensions(source, 0));
  let pixel = clamp(vec2<i32>(fragmentPosition), vec2<i32>(0), dimensions - vec2<i32>(1));
  return textureLoad(source, pixel, 0);
}

${mergedSurfaceSamplingShader}

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
  let displayOffset = (fragmentPosition.xy - display.canvasSize * 0.5) / display.zoom;
  let layerOffset = vec2<f32>(
    display.viewRotation.x * displayOffset.x + display.viewRotation.y * displayOffset.y,
    -display.viewRotation.y * displayOffset.x + display.viewRotation.x * displayOffset.y
  );
  let layerPosition = display.viewCenter + layerOffset;
  let layerSize = vec2<f32>(textureDimensions(activeLayerBase, 0));

  let insideLayer = all(layerPosition >= vec2<f32>(0.0))
    && all(layerPosition < layerSize);
  if (!insideLayer) {
    return vec4<f32>(vec3<f32>(0.055), 1.0);
  }

  let uv = clamp(
    (layerPosition + vec2<f32>(0.5)) / layerSize,
    vec2<f32>(0.0),
    vec2<f32>(1.0)
  );
  let activePaint = sampleActiveLayer(uv);
  let vectorBelow = sampleViewportTexture(vectorTextBelowTexture, fragmentPosition.xy);
  let vectorAbove = sampleViewportTexture(vectorTextAboveTexture, fragmentPosition.xy);

  var paint = vec4<f32>(0.0);
  if (display.hasMergedBelow > 0.5) {
    paint = sampleMergedBelow(layerPosition);
  }
  paint = sourceOver(vectorBelow, paint);
  paint = sourceOver(activePaint * display.activeLayerAlpha, paint);
  paint = sourceOver(vectorAbove, paint);
  if (display.hasMergedAbove > 0.5) {
    paint = sourceOver(sampleMergedAbove(layerPosition), paint);
  }

  let checkerCell = vec2<i32>(floor(layerPosition / display.checkerSize));
  let checkerParity = (checkerCell.x + checkerCell.y) & 1;
  let backgroundSrgb = select(vec3<f32>(0.82), vec3<f32>(0.91), checkerParity == 0);
  let backgroundLinear = srgbToLinear(backgroundSrgb);
  let compositedLinear = paint.rgb + backgroundLinear * (1.0 - paint.a);
  return vec4<f32>(linearToSrgb(compositedLinear), 1.0);
}
`;