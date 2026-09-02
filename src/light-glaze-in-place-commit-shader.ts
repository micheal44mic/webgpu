import { type LayerFormat } from "./engine-types";
import { rgba8SpatialQuantizationShader } from "./rgba8-spatial-quantization";

/**
 * Exact Uniformed/Intense commit without a render-target scratch tile.
 *
 * The permanent layer is a resident storage texture. On implementations that
 * expose read-write storage textures for the active layer format, one compute
 * dispatch can load and update each dirty pixel in place. The engine retains
 * the render/copy tile resolver as a capability fallback.
 */
export function lightGlazeInPlaceCommitShader(format: LayerFormat): string {
  return /* wgsl */ `
requires readonly_and_readwrite_storage_textures;

struct LightGlazeUniforms {
  opacity: f32,
  formatCode: u32,
  accumulationMode: u32,
  ditherSeed: u32,
  tintLinear: vec4<f32>,
};

struct CommitRectUniforms {
  origin: vec2<u32>,
  size: vec2<u32>,
};

@group(0) @binding(0)
var permanentTexture: texture_storage_2d<${format}, read_write>;
@group(0) @binding(1) var strokeTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> lightGlaze: LightGlazeUniforms;
@group(0) @binding(3) var<uniform> commitRect: CommitRectUniforms;

${rgba8SpatialQuantizationShader}

fn quantizeLayer(value: vec4<f32>) -> vec4<f32> {
  let redGreen = unpack2x16float(pack2x16float(value.rg));
  let blueAlpha = unpack2x16float(pack2x16float(value.ba));
  return vec4<f32>(redGreen, blueAlpha);
}

fn storedLightCoverage(value: f32) -> f32 {
  return clamp(value, 0.0, 1.0);
}

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

fn linearPremultipliedToEncodedSrgb(value: vec4<f32>) -> vec4<f32> {
  let alpha = clamp(value.a, 0.0, 1.0);
  if (alpha <= 0.0) {
    return vec4<f32>(0.0);
  }
  let straightLinear = clamp(value.rgb / alpha, vec3<f32>(0.0), vec3<f32>(1.0));
  return vec4<f32>(linearToSrgb(straightLinear) * alpha, alpha);
}

fn encodedSrgbPremultipliedToLinear(value: vec4<f32>) -> vec4<f32> {
  let alpha = clamp(value.a, 0.0, 1.0);
  if (alpha <= 0.0) {
    return vec4<f32>(0.0);
  }
  let straightSrgb = clamp(value.rgb / alpha, vec3<f32>(0.0), vec3<f32>(1.0));
  return vec4<f32>(srgbToLinear(straightSrgb) * alpha, alpha);
}

fn resolvedStrokePaint(accumulatedStroke: vec4<f32>) -> vec4<f32> {
  let opacity = clamp(lightGlaze.opacity, 0.0, 1.0);
  if (lightGlaze.accumulationMode == 1u) {
    let coverage = storedLightCoverage(accumulatedStroke.r);
    return vec4<f32>(lightGlaze.tintLinear.rgb * coverage, coverage) * opacity;
  }
  if (lightGlaze.accumulationMode == 3u) {
    let coverage = clamp(
      1.0 - exp2(-max(accumulatedStroke.r, 0.0)),
      0.0,
      1.0
    );
    return vec4<f32>(lightGlaze.tintLinear.rgb * coverage, coverage) * opacity;
  }
  return accumulatedStroke * opacity;
}

fn compositeLightGlazeOverPermanent(
  permanentPaint: vec4<f32>,
  strokePaint: vec4<f32>,
  coordinate: vec2<u32>
) -> vec4<f32> {
  if (lightGlaze.accumulationMode == 3u) {
    let compositedEncoded = strokePaint + permanentPaint * (1.0 - strokePaint.a);
    return quantizeRgba8SpatialAdjacent(
      compositedEncoded,
      coordinate,
      lightGlaze.ditherSeed
    );
  }
  if (lightGlaze.accumulationMode == 2u) {
    let permanentAlpha = clamp(permanentPaint.a, 0.0, 1.0);
    var boundedPermanentRgb = vec3<f32>(0.0);
    if (permanentAlpha > 0.0) {
      boundedPermanentRgb = clamp(
        permanentPaint.rgb / permanentAlpha,
        vec3<f32>(0.0),
        vec3<f32>(1.0)
      ) * permanentAlpha;
    }
    let extendedResidual = permanentPaint.rgb - boundedPermanentRgb;
    let permanentEncoded = linearPremultipliedToEncodedSrgb(
      vec4<f32>(boundedPermanentRgb, permanentAlpha)
    );
    let compositedEncoded = strokePaint + permanentEncoded * (1.0 - strokePaint.a);
    let boundedResult = encodedSrgbPremultipliedToLinear(compositedEncoded);
    let extendedResult = vec4<f32>(
      clamp(
        boundedResult.rgb + extendedResidual * (1.0 - strokePaint.a),
        vec3<f32>(-65504.0),
        vec3<f32>(65504.0)
      ),
      boundedResult.a
    );
    return quantizeLayer(extendedResult);
  }
  return quantizeLayer(strokePaint + permanentPaint * (1.0 - strokePaint.a));
}

@compute @workgroup_size(8, 8)
fn computeMain(@builtin(global_invocation_id) invocation: vec3<u32>) {
  if (invocation.x >= commitRect.size.x || invocation.y >= commitRect.size.y) {
    return;
  }
  let sourcePosition = vec2<i32>(commitRect.origin + invocation.xy);
  let strokePaint = resolvedStrokePaint(textureLoad(strokeTexture, sourcePosition, 0));
  // Empty pixels are an exact identity operation. Skipping the storage write
  // also avoids touching most pixels inside a sparse stroke bounding box.
  if (strokePaint.a <= 0.0) {
    return;
  }
  let permanentPaint = textureLoad(permanentTexture, sourcePosition);
  textureStore(
    permanentTexture,
    sourcePosition,
    compositeLightGlazeOverPermanent(
      permanentPaint,
      strokePaint,
      vec2<u32>(sourcePosition)
    )
  );
}
`;
}
