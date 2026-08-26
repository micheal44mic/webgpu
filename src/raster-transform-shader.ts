/**
 * Format-agnostic WGSL for transforming a premultiplied linear raster layer.
 * The render pipeline may target either `rgba8unorm` or `rgba16float`.
 */
import {
  SELECTION_LAYER_HEIGHT,
  SELECTION_LAYER_WIDTH,
  SELECTION_WORDS_PER_ROW,
} from "./selection-core.ts";

export const RASTER_TRANSFORM_SHADER_STRATEGY =
  "gamma-box-mips-transparent-border-inverse-affine-discrete-oversampling-v4" as const;

/**
 * Bindings:
 *   0 - 64-byte `RasterTransformUniforms`
 *   1 - immutable tile-bbox scratch with a complete mip chain
 *   2 - clamp-to-edge linear sampler; transparent border and trilinear LOD are
 *       reconstructed explicitly because WebGPU has no clamp-to-border mode
 *
 * The destination pass must use no blending: every pixel in the dirty union is
 * replaced by either the transformed immutable source or transparent black.
 */
export const rasterTransformShader = /* wgsl */ `
struct RasterTransformUniforms {
  sourceOrigin: vec2<f32>,
  sourceExtent: vec2<f32>,
  sourceContentMinimum: vec2<f32>,
  sourceContentMaximum: vec2<f32>,
  sourcePivot: vec2<f32>,
  destinationPivot: vec2<f32>,
  inverseRow0: vec2<f32>,
  inverseRow1: vec2<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var<uniform> transform: RasterTransformUniforms;
@group(0) @binding(1) var sourceTexture: texture_2d<f32>;
@group(0) @binding(2) var sourceSampler: sampler;

fn srgbToLinearChannel(value: f32) -> f32 {
  if (value <= 0.04045) { return value / 12.92; }
  return pow((value + 0.055) / 1.055, 2.4);
}

fn linearToSrgbChannel(value: f32) -> f32 {
  let clamped = clamp(value, 0.0, 1.0);
  if (clamped <= 0.0031308) { return clamped * 12.92; }
  return 1.055 * pow(clamped, 1.0 / 2.4) - 0.055;
}

fn preserveDarkCoverage(value: vec4<f32>, lod: f32) -> vec4<f32> {
  let alpha = clamp(value.a, 0.0, 1.0);
  if (alpha <= 0.000001 || alpha >= 0.999999 || lod < 1.0) { return value; }
  let straightLinear = clamp(value.rgb / alpha, vec3<f32>(0.0), vec3<f32>(1.0));
  let straightSrgb = vec3<f32>(
    linearToSrgbChannel(straightLinear.r),
    linearToSrgbChannel(straightLinear.g),
    linearToSrgbChannel(straightLinear.b)
  );
  let darkness = 1.0 - dot(straightSrgb, vec3<f32>(0.2126, 0.7152, 0.0722));
  let encodedCoverage = 1.0 - srgbToLinearChannel(1.0 - alpha);
  let displayAlpha = mix(alpha, encodedCoverage, clamp(darkness, 0.0, 1.0));
  return vec4<f32>(straightLinear * displayAlpha, displayAlpha);
}

fn transparentBorderWeight(uv: vec2<f32>, mipLevel: u32) -> f32 {
  let dimensions = vec2<f32>(textureDimensions(sourceTexture, mipLevel));
  let texelPosition = uv * dimensions - vec2<f32>(0.5);
  let axisWeight = clamp(
    min(texelPosition + vec2<f32>(1.0), dimensions - texelPosition),
    vec2<f32>(0.0),
    vec2<f32>(1.0)
  );
  return axisWeight.x * axisWeight.y;
}

fn sampleTransparentLevel(uv: vec2<f32>, mipLevel: u32) -> vec4<f32> {
  // The sampler can stay on the fastest native clamp-to-edge path. Multiplying
  // by the exact in-bounds bilinear weight turns the replicated edge texel into
  // a transparent-border sample, including after the base guard collapses in
  // deep mip levels.
  return textureSampleLevel(
    sourceTexture,
    sourceSampler,
    uv,
    f32(mipLevel)
  ) * transparentBorderWeight(uv, mipLevel);
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
fn fragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>
) -> @location(0) vec4<f32> {
  let destinationDelta = fragmentPosition.xy - transform.destinationPivot;
  let sourceDocument = transform.sourcePivot + vec2<f32>(
    dot(transform.inverseRow0, destinationDelta),
    dot(transform.inverseRow1, destinationDelta)
  );

  let sourceUv = (sourceDocument - transform.sourceOrigin)
    / transform.sourceExtent;
  // Explicit gradients are uniform affine derivatives. They select the right
  // mip under rotation/minification without dpdx/fwidth control-flow hazards.
  let sourceUvDx = vec2<f32>(
    transform.inverseRow0.x / transform.sourceExtent.x,
    transform.inverseRow1.x / transform.sourceExtent.y
  );
  let sourceUvDy = vec2<f32>(
    transform.inverseRow0.y / transform.sourceExtent.x,
    transform.inverseRow1.y / transform.sourceExtent.y
  );
  // The inverse rows carry the complete affine footprint, including independent
  // axis scales. Selecting its dominant mip explicitly keeps both levels on a
  // real transparent border instead of clamp-to-edge color replication.
  let baseDimensions = vec2<f32>(textureDimensions(sourceTexture, 0));
  let footprint = max(
    length(sourceUvDx * baseDimensions),
    length(sourceUvDy * baseDimensions)
  );
  let maximumLevel = textureNumLevels(sourceTexture) - 1u;
  let lod = floor(clamp(
    log2(max(footprint, 1.0)),
    0.0,
    f32(maximumLevel)
  ));
  return preserveDarkCoverage(sampleTransparentLevel(sourceUv, u32(lod)), lod);
}
`;

export const RASTER_SELECTION_TRANSLATE_SHADER_STRATEGY =
  "integer-cut-selection-mask-immutable-source-over-destination-v1" as const;

/** Translation-only cut/move for selected pixels. The immutable source is the
 * complete original layer, so overlapping moves never read pixels already
 * written by an earlier preview frame. */
export const rasterSelectionTranslateShader = /* wgsl */ `
const DOCUMENT_EXTENT: vec2<i32> = vec2<i32>(${SELECTION_LAYER_WIDTH}, ${SELECTION_LAYER_HEIGHT});
const WORDS_PER_ROW: u32 = ${SELECTION_WORDS_PER_ROW}u;

struct RasterTransformUniforms {
  sourceOrigin: vec2<f32>,
  sourceExtent: vec2<f32>,
  sourceContentMinimum: vec2<f32>,
  sourceContentMaximum: vec2<f32>,
  sourcePivot: vec2<f32>,
  destinationPivot: vec2<f32>,
  inverseRow0: vec2<f32>,
  inverseRow1: vec2<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var<uniform> transform: RasterTransformUniforms;
@group(0) @binding(1) var sourceTexture: texture_2d<f32>;
@group(0) @binding(2) var sourceSampler: sampler;
@group(1) @binding(0) var<storage, read> selectionMask: array<u32>;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0),
  );
  var output: VertexOutput;
  output.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  return output;
}

fn selectedAt(pixel: vec2<i32>) -> bool {
  if (any(pixel < vec2<i32>(0)) || any(pixel >= DOCUMENT_EXTENT)) {
    return false;
  }
  let unsignedPixel = vec2<u32>(pixel);
  let word = unsignedPixel.y * WORDS_PER_ROW + unsignedPixel.x / 32u;
  return (selectionMask[word] & (1u << (unsignedPixel.x & 31u))) != 0u;
}

fn loadOriginal(pixel: vec2<i32>) -> vec4<f32> {
  let local = pixel - vec2<i32>(round(transform.sourceOrigin));
  let dimensions = vec2<i32>(textureDimensions(sourceTexture, 0));
  if (any(local < vec2<i32>(0)) || any(local >= dimensions)) {
    return vec4<f32>(0.0);
  }
  return textureLoad(sourceTexture, local, 0);
}

@fragment
fn fragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>
) -> @location(0) vec4<f32> {
  let destination = vec2<i32>(fragmentPosition.xy);
  let delta = vec2<i32>(round(transform.destinationPivot - transform.sourcePivot));
  let source = destination - delta;
  var base = loadOriginal(destination);
  if (selectedAt(destination)) { base = vec4<f32>(0.0); }
  var moved = vec4<f32>(0.0);
  if (selectedAt(source)) { moved = loadOriginal(source); }
  return moved + base * (1.0 - moved.a);
}
`;

/**
 * Exact area reduction for the possibly-NPOT tile-bbox scratch. Reading and
 * writing use the layer's native linear-premultiplied representation, so the
 * same WGSL is valid for rgba8unorm and rgba16float render targets.
 */
export const rasterTransformMipmapShader = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;

fn srgbToLinearChannel(value: f32) -> f32 {
  if (value <= 0.04045) { return value / 12.92; }
  return pow((value + 0.055) / 1.055, 2.4);
}

fn linearToSrgbChannel(value: f32) -> f32 {
  let clamped = clamp(value, 0.0, 1.0);
  if (clamped <= 0.0031308) { return clamped * 12.92; }
  return 1.055 * pow(clamped, 1.0 / 2.4) - 0.055;
}

fn linearPremultipliedToGamma(value: vec4<f32>) -> vec4<f32> {
  let alpha = clamp(value.a, 0.0, 1.0);
  if (alpha <= 0.000001) { return vec4<f32>(0.0); }
  let straight = clamp(value.rgb / alpha, vec3<f32>(0.0), vec3<f32>(1.0));
  let encoded = vec3<f32>(
    linearToSrgbChannel(straight.r),
    linearToSrgbChannel(straight.g),
    linearToSrgbChannel(straight.b)
  );
  return vec4<f32>(encoded * alpha, alpha);
}

fn gammaPremultipliedToLinear(value: vec4<f32>) -> vec4<f32> {
  let alpha = clamp(value.a, 0.0, 1.0);
  if (alpha <= 0.000001) { return vec4<f32>(0.0); }
  let straight = clamp(value.rgb / alpha, vec3<f32>(0.0), vec3<f32>(1.0));
  let linear = vec3<f32>(
    srgbToLinearChannel(straight.r),
    srgbToLinearChannel(straight.g),
    srgbToLinearChannel(straight.b)
  );
  return vec4<f32>(linear * alpha, alpha);
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

fn texelOverlap(start: f32, end: f32, coordinate: i32) -> f32 {
  let texelStart = f32(coordinate);
  return max(0.0, min(end, texelStart + 1.0) - max(start, texelStart));
}

@fragment
fn fragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>
) -> @location(0) vec4<f32> {
  let sourceDimensions = vec2<i32>(textureDimensions(sourceTexture, 0));
  let destinationDimensions = max(sourceDimensions / vec2<i32>(2), vec2<i32>(1));
  let destinationCoordinate = vec2<i32>(fragmentPosition.xy);
  let sourceScale = vec2<f32>(sourceDimensions)
    / vec2<f32>(destinationDimensions);
  let sourceStart = vec2<f32>(destinationCoordinate) * sourceScale;
  let sourceEnd = vec2<f32>(destinationCoordinate + vec2<i32>(1))
    * sourceScale;
  let firstSourceCoordinate = vec2<i32>(floor(sourceStart));

  var accumulated = vec4<f32>(0.0);
  var accumulatedWeight = 0.0;
  for (var y = 0; y < 3; y = y + 1) {
    let sourceY = firstSourceCoordinate.y + y;
    if (sourceY >= 0 && sourceY < sourceDimensions.y) {
      let weightY = texelOverlap(sourceStart.y, sourceEnd.y, sourceY);
      for (var x = 0; x < 3; x = x + 1) {
        let sourceX = firstSourceCoordinate.x + x;
        if (sourceX >= 0 && sourceX < sourceDimensions.x) {
          let weight = weightY * texelOverlap(
            sourceStart.x,
            sourceEnd.x,
            sourceX
          );
          accumulated += linearPremultipliedToGamma(textureLoad(
            sourceTexture,
            vec2<i32>(sourceX, sourceY),
            0
          )) * weight;
          accumulatedWeight += weight;
        }
      }
    }
  }
  return gammaPremultipliedToLinear(
    accumulated / max(accumulatedWeight, 0.000001)
  );
}
`;
