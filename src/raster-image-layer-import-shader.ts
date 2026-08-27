import { DOCUMENT_HEIGHT, DOCUMENT_WIDTH } from "./engine-limits.ts";

/**
 * Transient WebGPU shaders used while importing a decoded bitmap into an
 * authoritative paint layer.
 *
 * The browser decoder exposes straight-alpha sRGB pixels. The retained source
 * pyramid stores encoded-sRGB premultiplied samples so every exact 2x reduction
 * preserves dark line weight. A rebuild decodes the selected source level into
 * the document's authoritative linear-premultiplied RGBA16F raster cache.
 */

export const RASTER_IMAGE_LAYER_IMPORT_STRATEGY =
  "decoded-rgba8-srgb-to-gamma-premultiplied-rgba16float-exact-npot-mips-immutable-master-v4" as const;

export const rasterImageLayerUploadShader = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;

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
fn fragmentPremultiplyMain(
  @builtin(position) fragmentPosition: vec4<f32>
) -> @location(0) vec4<f32> {
  let dimensions = vec2<i32>(textureDimensions(sourceTexture, 0));
  let coordinate = clamp(
    vec2<i32>(fragmentPosition.xy),
    vec2<i32>(0),
    dimensions - vec2<i32>(1)
  );
  let straightLinear = textureLoad(sourceTexture, coordinate, 0);
  // The immutable source pyramid deliberately stores encoded-sRGB,
  // premultiplied values. Exact-area reductions therefore preserve dense dark
  // line weight instead of averaging ink in photometric linear light.
  return vec4<f32>(
    linearToSrgb(straightLinear.rgb) * straightLinear.a,
    straightLinear.a
  );
}

fn texelOverlap(start: f32, end: f32, coordinate: i32) -> f32 {
  let texelStart = f32(coordinate);
  return max(0.0, min(end, texelStart + 1.0) - max(start, texelStart));
}

@fragment
fn fragmentMipmapMain(
  @builtin(position) fragmentPosition: vec4<f32>
) -> @location(0) vec4<f32> {
  let sourceDimensions = vec2<i32>(textureDimensions(sourceTexture, 0));
  let destinationDimensions = max(sourceDimensions / vec2<i32>(2), vec2<i32>(1));
  let destinationCoordinate = vec2<i32>(fragmentPosition.xy);
  let sourceScale = vec2<f32>(sourceDimensions) / vec2<f32>(destinationDimensions);
  let sourceStart = vec2<f32>(destinationCoordinate) * sourceScale;
  let sourceEnd = vec2<f32>(destinationCoordinate + vec2<i32>(1)) * sourceScale;
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
          let weight = weightY * texelOverlap(sourceStart.x, sourceEnd.x, sourceX);
          accumulated += textureLoad(
            sourceTexture,
            vec2<i32>(sourceX, sourceY),
            0
          ) * weight;
          accumulatedWeight += weight;
        }
      }
    }
  }
  return accumulated / max(accumulatedWeight, 0.000001);
}
`;

export const rasterImageLayerBlitShader = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;

fn srgbToLinearChannel(value: f32) -> f32 {
  let clamped = clamp(value, 0.0, 1.0);
  if (clamped <= 0.04045) {
    return clamped / 12.92;
  }
  return pow((clamped + 0.055) / 1.055, 2.4);
}

fn srgbToLinear(value: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    srgbToLinearChannel(value.r),
    srgbToLinearChannel(value.g),
    srgbToLinearChannel(value.b)
  );
}

fn sourceLod(uvDx: vec2<f32>, uvDy: vec2<f32>) -> f32 {
  let dimensions = vec2<f32>(textureDimensions(sourceTexture, 0));
  let footprint = max(length(uvDx * dimensions), length(uvDy * dimensions));
  return clamp(
    log2(max(footprint, 1.0)),
    0.0,
    f32(textureNumLevels(sourceTexture) - 1u)
  );
}

fn decodedSource(sampled: vec4<f32>, lod: f32) -> vec4<f32> {
  let alpha = clamp(sampled.a, 0.0, 1.0);
  if (alpha <= 0.000001) {
    return vec4<f32>(0.0);
  }
  let straightSrgb = clamp(sampled.rgb / alpha, vec3<f32>(0.0), vec3<f32>(1.0));
  let straightLinear = srgbToLinear(straightSrgb);

  // An sRGB compositor makes a 50/50 black/transparent footprint read as 127,
  // while a linear compositor would make it read as 188 over white. Encode the
  // equivalent display coverage only for dark, minified texels. Alpha 0 and 1
  // are fixed points and mip 0 keeps the exact imported transparency.
  let encodedCoverage = 1.0 - srgbToLinearChannel(1.0 - alpha);
  let darkness = 1.0 - dot(straightSrgb, vec3<f32>(0.2126, 0.7152, 0.0722));
  let minified = clamp(lod, 0.0, 1.0);
  let displayAlpha = mix(
    alpha,
    encodedCoverage,
    clamp(darkness, 0.0, 1.0) * minified
  );
  return vec4<f32>(straightLinear * displayAlpha, displayAlpha);
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let positions = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0,  1.0)
  );
  // Clip-space Y grows upward, while decoded image V grows downward. Pair the
  // bottom clip vertices with V=1 and the top vertices with V=0 so the bitmap
  // enters the document without a vertical reflection.
  let texcoords = array<vec2<f32>, 4>(
    vec2<f32>(0.0, 1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 0.0)
  );
  var output: VertexOutput;
  output.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  output.uv = texcoords[vertexIndex];
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  // One discrete level keeps roughly 1–2 source texels per destination pixel.
  // Every level was derived directly through exact 2× area steps in gamma
  // space; there is no single-pass >2:1 drawImage-style loss of one-pixel ink.
  let uvDx = dpdx(input.uv);
  let uvDy = dpdy(input.uv);
  let continuousLod = sourceLod(uvDx, uvDy);
  let lod = floor(continuousLod);
  let sampled = textureSampleLevel(
    sourceTexture,
    sourceSampler,
    input.uv,
    lod
  );
  return decodedSource(sampled, continuousLod);
}
`;

/** Rebuilds a document-sized native raster cache from the immutable master. */
export const rasterImageLayerRebuildShader = /* wgsl */ `
struct RasterSourceUniforms {
  center: vec2<f32>,
  halfSize: vec2<f32>,
  rotation: vec2<f32>,
  _padding: vec2<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@group(0) @binding(0) var<uniform> sourceTransform: RasterSourceUniforms;
@group(0) @binding(1) var sourceTexture: texture_2d<f32>;
@group(0) @binding(2) var sourceSampler: sampler;

fn srgbToLinearChannel(value: f32) -> f32 {
  let clamped = clamp(value, 0.0, 1.0);
  if (clamped <= 0.04045) {
    return clamped / 12.92;
  }
  return pow((clamped + 0.055) / 1.055, 2.4);
}

fn srgbToLinear(value: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    srgbToLinearChannel(value.r),
    srgbToLinearChannel(value.g),
    srgbToLinearChannel(value.b)
  );
}

fn rotateYDown(value: vec2<f32>, rotation: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(
    rotation.x * value.x - rotation.y * value.y,
    rotation.y * value.x + rotation.x * value.y
  );
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let corners = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0,  1.0)
  );
  let texcoords = array<vec2<f32>, 4>(
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 0.0),
    vec2<f32>(0.0, 1.0),
    vec2<f32>(1.0, 1.0)
  );
  let documentPosition = sourceTransform.center + rotateYDown(
    corners[vertexIndex] * sourceTransform.halfSize,
    sourceTransform.rotation
  );
  var output: VertexOutput;
  output.position = vec4<f32>(
    documentPosition.x / ${DOCUMENT_WIDTH}.0 * 2.0 - 1.0,
    1.0 - documentPosition.y / ${DOCUMENT_HEIGHT}.0 * 2.0,
    0.0,
    1.0
  );
  output.uv = texcoords[vertexIndex];
  return output;
}

fn sourceLod(uvDx: vec2<f32>, uvDy: vec2<f32>) -> f32 {
  let dimensions = vec2<f32>(textureDimensions(sourceTexture, 0));
  let footprint = max(length(uvDx * dimensions), length(uvDy * dimensions));
  return clamp(
    log2(max(footprint, 1.0)),
    0.0,
    f32(textureNumLevels(sourceTexture) - 1u)
  );
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let continuousLod = sourceLod(dpdx(input.uv), dpdy(input.uv));
  let lod = floor(continuousLod);
  let sampled = textureSampleLevel(sourceTexture, sourceSampler, input.uv, lod);
  let alpha = clamp(sampled.a, 0.0, 1.0);
  if (alpha <= 0.000001) {
    return vec4<f32>(0.0);
  }
  let straightSrgb = clamp(sampled.rgb / alpha, vec3<f32>(0.0), vec3<f32>(1.0));
  let straightLinear = srgbToLinear(straightSrgb);
  let encodedCoverage = 1.0 - srgbToLinearChannel(1.0 - alpha);
  let darkness = 1.0 - dot(straightSrgb, vec3<f32>(0.2126, 0.7152, 0.0722));
  let minified = clamp(continuousLod, 0.0, 1.0);
  let displayAlpha = mix(
    alpha,
    encodedCoverage,
    clamp(darkness, 0.0, 1.0) * minified
  );
  return vec4<f32>(straightLinear * displayAlpha, displayAlpha);
}
`;
