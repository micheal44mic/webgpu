import { mergedSurfaceSamplingShader } from "./merged-surface-shader.ts";
import { activeClippingGroupTexelShader } from "./clipping-group-shader.ts";

/**
 * Presentazione ordinata raster/testo interamente GPU.
 *
 * Ogni run testo viene ridisegnato dal sorgente Slug analitico e dalle mesh
 * Clipper al LOD corrente in una cache lineare RGBA16F ritagliata; il compositore RGBA16F
 * conserva l'ordine dei livelli. Non esiste un fallback bitmap durante lo zoom.
 */
export const VECTOR_TEXT_PRESENTATION_STRATEGY =
  "semantic-vector-gpu-runs-slug-clipper-msaa4-rgba16f-roi-v7" as const;

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
  clippingMode: f32,
  clippingParentOpacity: f32,
  clippingPrefixScale: f32,
  clippingSuffixScale: f32,
  clippingPrefixOrigin: vec2<f32>,
  clippingSuffixOrigin: vec2<f32>,
  backgroundColor: vec4<f32>,
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
@group(0) @binding(8) var activeClippingPrefix: texture_2d<f32>;
@group(0) @binding(9) var activeClippingSuffix: texture_2d<f32>;

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

${activeClippingGroupTexelShader}

fn sampleActiveLayer(uv: vec2<f32>) -> vec4<f32> {
  if (display.selectedMipLevel < 0.5) {
    if (rasterPixelViewEnabled(1.0)) {
      let pixel = rasterPixelViewTexel(
        uv,
        vec2<i32>(textureDimensions(activeLayerBase, 0))
      );
      let activeTexel = textureLoad(activeLayerBase, pixel, 0);
      if (display.clippingMode < 0.5) {
        return activeTexel;
      }
      return composeActiveClippingGroupTexel(activeTexel, pixel);
    }
    return textureSampleLevel(activeLayerBase, layerSampler, uv, 0.0);
  }
  return textureSampleLevel(
    activeLayerPyramid,
    layerSampler,
    uv,
    display.selectedMipLevel - 1.0
  );
}

fn sampleActiveClippingGroupLinear(layerPosition: vec2<f32>) -> vec4<f32> {
  let texelPosition = layerPosition - vec2<f32>(0.5);
  let lower = vec2<i32>(floor(texelPosition));
  let interpolation = fract(texelPosition);
  let maximum = vec2<i32>(textureDimensions(activeLayerBase, 0)) - vec2<i32>(1);
  let p00i = clamp(lower, vec2<i32>(0), maximum);
  let p10i = clamp(lower + vec2<i32>(1, 0), vec2<i32>(0), maximum);
  let p01i = clamp(lower + vec2<i32>(0, 1), vec2<i32>(0), maximum);
  let p11i = clamp(lower + vec2<i32>(1, 1), vec2<i32>(0), maximum);
  let p00 = composeActiveClippingGroupTexel(textureLoad(activeLayerBase, p00i, 0), p00i);
  let p10 = composeActiveClippingGroupTexel(textureLoad(activeLayerBase, p10i, 0), p10i);
  let p01 = composeActiveClippingGroupTexel(textureLoad(activeLayerBase, p01i, 0), p01i);
  let p11 = composeActiveClippingGroupTexel(textureLoad(activeLayerBase, p11i, 0), p11i);
  return mix(mix(p00, p10, interpolation.x), mix(p01, p11, interpolation.x), interpolation.y);
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
    layerPosition / layerSize,
    vec2<f32>(0.0),
    vec2<f32>(1.0)
  );
  var activePaint = sampleActiveLayer(uv);
  if (
    display.clippingMode > 0.5
    && display.selectedMipLevel < 0.5
    && !rasterPixelViewEnabled(1.0)
  ) {
    activePaint = sampleActiveClippingGroupLinear(layerPosition);
  }
  let vectorBelow = sampleViewportTexture(vectorTextBelowTexture, fragmentPosition.xy);
  let vectorAbove = sampleViewportTexture(vectorTextAboveTexture, fragmentPosition.xy);

  var paint = vec4<f32>(0.0);
  if (display.hasMergedBelow > 0.5) {
    paint = sampleMergedBelow(layerPosition);
  }
  paint = sourceOver(vectorBelow, paint);
  let activeContribution = select(
    activePaint,
    activePaint * display.activeLayerAlpha,
    display.clippingMode < 0.5
  );
  paint = sourceOver(activeContribution, paint);
  paint = sourceOver(vectorAbove, paint);
  if (display.hasMergedAbove > 0.5) {
    paint = sourceOver(sampleMergedAbove(layerPosition), paint);
  }

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
