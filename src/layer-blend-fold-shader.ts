import { LAYER_BLEND_MODE_WGSL } from "./layer-blend-modes.ts";

/**
 * Backdrop-sampling variant of the cropped merged-surface fold. The caller
 * renders into a distinct scratch attachment and copies the completed dirty
 * rectangle back, so WebGPU never samples and attaches the same subresource.
 */
export const LAYER_BLEND_FOLD_STRATEGY =
  "cropped-document-1024-tile-ping-pong-source-map-w3c-over-matte-preserving-clipping-atop-v3" as const;

export const LAYER_BLEND_FOLD_TILE_EXTENT = 1024 as const;

/** Matches LayerBlendFoldUniforms and the legacy Normal fold ABI. */
export const LAYER_BLEND_FOLD_UNIFORM_BYTES = 48 as const;

export const LAYER_BLEND_FOLD_WGSL = /* wgsl */ `
${LAYER_BLEND_MODE_WGSL}

const LAYER_BLEND_FOLD_SOURCE_OVER: u32 = 0u;
const LAYER_BLEND_FOLD_SOURCE_ATOP: u32 = 1u;

struct LayerBlendFoldUniforms {
  destinationOrigin: vec2<f32>,
  destinationScale: f32,
  opacity: f32,
  sourceOrigin: vec2<f32>,
  sourceScale: f32,
  _pad0: f32,
  sourceDimensions: vec2<u32>,
  blendMode: u32,
  compositeOperator: u32,
};

@group(0) @binding(0) var backdropTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> layer: LayerBlendFoldUniforms;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
  var position = vec2<f32>(-1.0, -1.0);
  if (vertexIndex == 1u) {
    position = vec2<f32>(3.0, -1.0);
  } else if (vertexIndex == 2u) {
    position = vec2<f32>(-1.0, 3.0);
  }
  return vec4<f32>(position, 0.0, 1.0);
}

fn loadFoldSource(pixel: vec2<i32>) -> vec4<f32> {
  let maximum = vec2<i32>(layer.sourceDimensions) - vec2<i32>(1);
  return textureLoad(sourceTexture, clamp(pixel, vec2<i32>(0), maximum), 0);
}

fn sampleFoldSource(fragmentPosition: vec2<f32>) -> vec4<f32> {
  let destinationScale = max(layer.destinationScale, 1.0);
  let sourceScale = max(layer.sourceScale, 1.0);
  let targetPixel = fragmentPosition - vec2<f32>(0.5);
  let documentPosition = layer.destinationOrigin + targetPixel / destinationScale;
  let sourcePosition = (documentPosition - layer.sourceOrigin) * sourceScale;
  let sourceFloor = floor(sourcePosition);
  let fraction = sourcePosition - sourceFloor;
  let origin = vec2<i32>(sourceFloor);
  let top = mix(
    loadFoldSource(origin),
    loadFoldSource(origin + vec2<i32>(1, 0)),
    fraction.x,
  );
  let bottom = mix(
    loadFoldSource(origin + vec2<i32>(0, 1)),
    loadFoldSource(origin + vec2<i32>(1, 1)),
    fraction.x,
  );
  return mix(top, bottom, fraction.y) * clamp(layer.opacity, 0.0, 1.0);
}

fn layerBlendFoldSourceAtop(
  backdropInput: vec4<f32>,
  sourceInput: vec4<f32>,
  mode: u32,
) -> vec4<f32> {
  // Clipping children recolor the parent's straight RGB while preserving its
  // alpha matte; this is intentionally not general W3C blend+source-atop.
  let backdropAlpha = clamp(backdropInput.a, 0.0, 1.0);
  let sourceAlpha = clamp(sourceInput.a, 0.0, 1.0);
  let backdropPremultiplied = clamp(
    backdropInput.rgb,
    vec3<f32>(0.0),
    vec3<f32>(backdropAlpha),
  );
  let sourcePremultiplied = clamp(
    sourceInput.rgb,
    vec3<f32>(0.0),
    vec3<f32>(sourceAlpha),
  );
  if (mode == LAYER_BLEND_NORMAL) {
    return vec4<f32>(
      sourcePremultiplied * backdropAlpha
        + backdropPremultiplied * (1.0 - sourceAlpha),
      backdropAlpha,
    );
  }
  var backdropLinear = vec3<f32>(0.0);
  var sourceLinear = vec3<f32>(0.0);
  if (backdropAlpha > 0.0) { backdropLinear = backdropPremultiplied / backdropAlpha; }
  if (sourceAlpha > 0.0) { sourceLinear = sourcePremultiplied / sourceAlpha; }
  let blendedLinear = layerBlendSrgbToLinear(layerBlendSrgb(
    layerBlendLinearToSrgb(backdropLinear),
    layerBlendLinearToSrgb(sourceLinear),
    mode,
  ));
  return vec4<f32>(
    clamp(
      blendedLinear * (sourceAlpha * backdropAlpha)
        + backdropPremultiplied * (1.0 - sourceAlpha),
      vec3<f32>(0.0),
      vec3<f32>(backdropAlpha),
    ),
    backdropAlpha,
  );
}

@fragment
fn fragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>,
) -> @location(0) vec4<f32> {
  let pixel = vec2<i32>(fragmentPosition.xy);
  let backdrop = textureLoad(backdropTexture, pixel, 0);
  let source = sampleFoldSource(fragmentPosition.xy);
  if (layer.compositeOperator == LAYER_BLEND_FOLD_SOURCE_ATOP) {
    return layerBlendFoldSourceAtop(backdrop, source, layer.blendMode);
  }
  return layerBlendPremultipliedLinearSourceOver(backdrop, source, layer.blendMode);
}
`;
