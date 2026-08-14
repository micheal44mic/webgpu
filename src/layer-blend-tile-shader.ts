import { rasterPixelViewShaderHelpers } from "./raster-pixel-view";
import { perceptualRasterShaderSource } from "./perceptual-raster-resampling.ts";

/**
 * Fixed working-set extent for the document-space layer-blend compositor.
 * Three native-format textures are enough for backdrop ping-pong plus the
 * active/clipping operand: 12 MiB in RGBA8 or 24 MiB in RGBA16F.
 */
export const LAYER_BLEND_TILE_EXTENT = 1024 as const;
export const LAYER_BLEND_TILE_PRESENT_UNIFORM_BYTES = 32 as const;
export const LAYER_BLEND_TILE_MIP_UNIFORM_BYTES = 16 as const;
export const LAYER_BLEND_TILE_STRATEGY =
  "document-space-1024-tile-native-format-blend-before-perceptual-filter-and-sample-v4" as const;

const fullscreenVertex = /* wgsl */ `
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

const displayUniforms = /* wgsl */ `
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

/**
 * Replaces the owned pixels of one completed mip-0 tile in the screen-space
 * linear cache. Pixels outside the transformed core are discarded: a rotated
 * core has an axis-aligned screen scissor whose corner pixels belong to the
 * unchanged cache and must never be cleared or overwritten.
 * `textureOrigin` includes the one-pixel apron while `coreOrigin/coreSize`
 * form a half-open ownership rectangle, so adjacent tiles never double blend.
 */
export const LAYER_BLEND_TILE_PRESENT_WGSL = /* wgsl */ `
${displayUniforms}
struct TilePresentUniforms {
  textureOrigin: vec2<f32>,
  coreOrigin: vec2<f32>,
  coreSize: vec2<f32>,
  textureSize: vec2<f32>,
};

@group(0) @binding(0) var<uniform> display: DisplayUniforms;
@group(0) @binding(1) var<uniform> tile: TilePresentUniforms;
@group(0) @binding(2) var tileTexture: texture_2d<f32>;

${rasterPixelViewShaderHelpers}
${fullscreenVertex}
${perceptualRasterShaderSource({ interpolate: true })}

fn loadTile(pixel: vec2<i32>) -> vec4<f32> {
  let maximum = vec2<i32>(textureDimensions(tileTexture, 0)) - vec2<i32>(1);
  return textureLoad(tileTexture, clamp(pixel, vec2<i32>(0), maximum), 0);
}

@fragment
fn fragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>
) -> @location(0) vec4<f32> {
  let layerPosition = layerPositionAt(fragmentPosition.xy);
  let coreMaximum = tile.coreOrigin + tile.coreSize;
  let inside = all(layerPosition >= tile.coreOrigin)
    && all(layerPosition < coreMaximum);
  if (!inside) {
    discard;
  }

  let localPosition = layerPosition - tile.textureOrigin;
  if (rasterPixelViewEnabled(1.0)) {
    return loadTile(vec2<i32>(floor(localPosition)));
  }
  let texelPosition = localPosition - vec2<f32>(0.5);
  let lower = vec2<i32>(floor(texelPosition));
  let interpolation = fract(texelPosition);
  let p00 = loadTile(lower);
  let p10 = loadTile(lower + vec2<i32>(1, 0));
  let p01 = loadTile(lower + vec2<i32>(0, 1));
  let p11 = loadTile(lower + vec2<i32>(1, 1));
  if (display.zoom < 0.999999) {
    return perceptualInterpolateFour(p00, p10, p01, p11, interpolation);
  }
  return mix(mix(p00, p10, interpolation.x), mix(p01, p11, interpolation.x), interpolation.y);
}
`;

/** Exact 2x2 box reduction from one completed document tile into full mip 1. */
export const LAYER_BLEND_TILE_MIP_ONE_WGSL = /* wgsl */ `
struct TileMipUniforms {
  textureOrigin: vec2<u32>,
  documentSize: vec2<u32>,
};

@group(0) @binding(0) var tileTexture: texture_2d<f32>;
@group(0) @binding(1) var<uniform> tile: TileMipUniforms;

${fullscreenVertex}
${perceptualRasterShaderSource({ reduceFour: true })}

fn loadTileDocumentPixel(documentPixel: vec2<u32>) -> vec4<f32> {
  let clampedDocument = min(documentPixel, tile.documentSize - vec2<u32>(1u));
  let local = vec2<i32>(clampedDocument) - vec2<i32>(tile.textureOrigin);
  let maximum = vec2<i32>(textureDimensions(tileTexture, 0)) - vec2<i32>(1);
  return textureLoad(tileTexture, clamp(local, vec2<i32>(0), maximum), 0);
}

@fragment
fn fragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>
) -> @location(0) vec4<f32> {
  let sourceOrigin = vec2<u32>(fragmentPosition.xy) * 2u;
  return perceptualReduceFour(
    loadTileDocumentPixel(sourceOrigin),
    loadTileDocumentPixel(sourceOrigin + vec2<u32>(1u, 0u)),
    loadTileDocumentPixel(sourceOrigin + vec2<u32>(0u, 1u)),
    loadTileDocumentPixel(sourceOrigin + vec2<u32>(1u, 1u))
  );
}
`;

/** Presents the already-composited full raster pyramid for zoom below 100%. */
export const LAYER_BLEND_PYRAMID_PRESENT_WGSL = /* wgsl */ `
${displayUniforms}
@group(0) @binding(0) var<uniform> display: DisplayUniforms;
@group(0) @binding(1) var finalPyramid: texture_2d<f32>;

${fullscreenVertex}
${perceptualRasterShaderSource({ sampling: true })}

@fragment
fn fragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>
) -> @location(0) vec4<f32> {
  let layerPosition = layerPositionAt(fragmentPosition.xy);
  let documentSize = vec2<f32>(textureDimensions(finalPyramid, 0)) * 2.0;
  let inside = all(layerPosition >= vec2<f32>(0.0))
    && all(layerPosition < documentSize);
  if (!inside) {
    return vec4<f32>(0.0);
  }
  let uv = clamp(
    layerPosition / documentSize,
    vec2<f32>(0.0),
    vec2<f32>(1.0)
  );
  let maximumLod = f32(max(1u, textureNumLevels(finalPyramid)) - 1u);
  let lod = clamp(display.selectedMipLevel - 1.0, 0.0, maximumLod);
  return perceptualSampleTrilinear(finalPyramid, uv, lod, true);
}
`;
