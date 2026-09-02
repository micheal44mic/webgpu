import { LAYER_BLEND_MODE_WGSL } from "./layer-blend-modes.ts";

/** Shared premultiplied source-atop math for every active raster presenter. */
export const activeClippingGroupTexelShader = /* wgsl */ `
${LAYER_BLEND_MODE_WGSL}

fn clippingSourceAtop(source: vec4<f32>, destination: vec4<f32>) -> vec4<f32> {
  let sourceAlpha = clamp(source.a, 0.0, 1.0);
  let matte = clamp(destination.a, 0.0, 1.0);
  return vec4<f32>(
    source.rgb * matte + destination.rgb * (1.0 - sourceAlpha),
    matte
  );
}

fn clippingBlendSourceAtop(
  sourceInput: vec4<f32>,
  destinationInput: vec4<f32>,
  mode: u32,
  documentPixel: vec2<i32>,
) -> vec4<f32> {
  let matte = clamp(destinationInput.a, 0.0, 1.0);
  var sourceAlpha = clamp(sourceInput.a, 0.0, 1.0);
  let destinationPremultiplied = clamp(
    destinationInput.rgb,
    vec3<f32>(0.0),
    vec3<f32>(matte),
  );
  var sourcePremultiplied = clamp(
    sourceInput.rgb,
    vec3<f32>(0.0),
    vec3<f32>(sourceAlpha),
  );
  if (mode == LAYER_BLEND_DISSOLVE) {
    let dissolved = layerBlendDissolveSource(
      sourcePremultiplied,
      sourceAlpha,
      documentPixel,
    );
    sourcePremultiplied = dissolved.rgb;
    sourceAlpha = dissolved.a;
  }
  if (mode == LAYER_BLEND_NORMAL || mode == LAYER_BLEND_DISSOLVE) {
    return vec4<f32>(
      sourcePremultiplied * matte
        + destinationPremultiplied * (1.0 - sourceAlpha),
      matte,
    );
  }
  var destinationStored = vec3<f32>(0.0);
  var sourceStored = vec3<f32>(0.0);
  if (matte > 0.0) { destinationStored = destinationPremultiplied / matte; }
  if (sourceAlpha > 0.0) { sourceStored = sourcePremultiplied / sourceAlpha; }
  let encodedStorage = display.compositingColorSpace > 1.5;
  let blendedSrgb = layerBlendSrgb(
    select(layerBlendLinearToSrgb(destinationStored), destinationStored, encodedStorage),
    select(layerBlendLinearToSrgb(sourceStored), sourceStored, encodedStorage),
    min(mode, LAYER_BLEND_LUMINOSITY),
  );
  let blendedStored = select(
    layerBlendSrgbToLinear(blendedSrgb),
    blendedSrgb,
    encodedStorage,
  );
  return vec4<f32>(
    clamp(
      blendedStored * (sourceAlpha * matte)
        + destinationPremultiplied * (1.0 - sourceAlpha),
      vec3<f32>(0.0),
      vec3<f32>(matte),
    ),
    matte,
  );
}

fn activeClippingChildBlendMode() -> u32 {
  if (display.clippingMode < 2.0) {
    return LAYER_BLEND_NORMAL;
  }
  return min(
    LAYER_BLEND_LUMINOSITY,
    u32(round((display.clippingMode - 2.0) * 64.0)),
  );
}

fn loadActiveClippingSurfaceTexel(
  source: texture_2d<f32>,
  documentPixel: vec2<i32>,
  documentOrigin: vec2<f32>,
  resolutionScale: f32
) -> vec4<f32> {
  if (resolutionScale < 0.5) {
    return vec4<f32>(0.0);
  }
  let local = vec2<i32>(floor(
    (vec2<f32>(documentPixel) - documentOrigin) * resolutionScale
  ));
  let dimensions = vec2<i32>(textureDimensions(source, 0));
  if (any(local < vec2<i32>(0)) || any(local >= dimensions)) {
    return vec4<f32>(0.0);
  }
  return textureLoad(source, local, 0);
}

fn composeActiveClippingGroupTexel(
  activePaint: vec4<f32>,
  documentPixel: vec2<i32>
) -> vec4<f32> {
  if (display.clippingMode < 0.5) {
    return activePaint * display.activeLayerAlpha;
  }
  let suffix = loadActiveClippingSurfaceTexel(
    activeClippingSuffix,
    documentPixel,
    display.clippingSuffixOrigin,
    display.clippingSuffixScale
  );
  if (display.clippingMode < 1.5) {
    // The active parent is the live matte. Its opacity belongs to the isolated
    // group, not to each child, and is therefore applied once at the end.
    var group = vec4<f32>(activePaint.rgb, activePaint.a);
    group = clippingSourceAtop(suffix, group);
    return group * display.clippingParentOpacity;
  }
  var group = loadActiveClippingSurfaceTexel(
    activeClippingPrefix,
    documentPixel,
    display.clippingPrefixOrigin,
    display.clippingPrefixScale
  );
  group = clippingBlendSourceAtop(
    activePaint * display.activeLayerAlpha,
    group,
    activeClippingChildBlendMode(),
    documentPixel,
  );
  group = clippingSourceAtop(suffix, group);
  return group * display.clippingParentOpacity;
}
`;
