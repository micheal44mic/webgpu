/** Shared premultiplied source-atop math for every active raster presenter. */
export const activeClippingGroupTexelShader = /* wgsl */ `
fn clippingSourceAtop(source: vec4<f32>, destination: vec4<f32>) -> vec4<f32> {
  let sourceAlpha = clamp(source.a, 0.0, 1.0);
  let matte = clamp(destination.a, 0.0, 1.0);
  return vec4<f32>(
    source.rgb * matte + destination.rgb * (1.0 - sourceAlpha),
    matte
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
  group = clippingSourceAtop(activePaint * display.activeLayerAlpha, group);
  group = clippingSourceAtop(suffix, group);
  return group * display.clippingParentOpacity;
}
`;
