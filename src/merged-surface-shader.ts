import { rasterPixelViewShaderHelpers } from "./raster-pixel-view.ts";

/**
 * Samples a cropped merged surface in document coordinates. At zoom above
 * 100%, mip 0 can contain multiple texels per document pixel; the shader maps
 * document coordinates into that density and selects the matching display LOD.
 */
export const mergedSurfaceSamplingShader = /* wgsl */ `
${rasterPixelViewShaderHelpers}
fn mergedSrgbToLinearChannel(value: f32) -> f32 {
  if (value <= 0.04045) { return value / 12.92; }
  return pow((value + 0.055) / 1.055, 2.4);
}

fn mergedLinearToSrgbChannel(value: f32) -> f32 {
  let clamped = clamp(value, 0.0, 1.0);
  if (clamped <= 0.0031308) { return clamped * 12.92; }
  return 1.055 * pow(clamped, 1.0 / 2.4) - 0.055;
}

fn preserveMergedDarkCoverage(value: vec4<f32>, lod: f32) -> vec4<f32> {
  let alpha = clamp(value.a, 0.0, 1.0);
  if (alpha <= 0.000001 || alpha >= 0.999999 || lod <= 0.0) {
    return value;
  }
  let straightLinear = clamp(value.rgb / alpha, vec3<f32>(0.0), vec3<f32>(1.0));
  let straightSrgb = vec3<f32>(
    mergedLinearToSrgbChannel(straightLinear.r),
    mergedLinearToSrgbChannel(straightLinear.g),
    mergedLinearToSrgbChannel(straightLinear.b)
  );
  let darkness = 1.0 - dot(straightSrgb, vec3<f32>(0.2126, 0.7152, 0.0722));
  let encodedCoverage = 1.0 - mergedSrgbToLinearChannel(1.0 - alpha);
  let displayAlpha = mix(
    alpha,
    encodedCoverage,
    clamp(darkness, 0.0, 1.0) * clamp(lod, 0.0, 1.0)
  );
  return vec4<f32>(straightLinear * displayAlpha, displayAlpha);
}

fn mergedSamplingLod(resolutionScale: f32, maximumLod: f32) -> f32 {
  return clamp(
    max(0.0, log2(max(resolutionScale, 1.0) / max(display.zoom, 0.000001))),
    0.0,
    maximumLod
  );
}

fn sampleMergedBelow(layerPosition: vec2<f32>) -> vec4<f32> {
  let dimensions = vec2<f32>(textureDimensions(mergedBelowTexture, 0));
  let resolutionScale = max(display.hasMergedBelow, 1.0);
  let localPosition = (layerPosition - display.mergedBelowOrigin) * resolutionScale;
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
  let lod = mergedSamplingLod(
    resolutionScale,
    f32(max(1u, textureNumLevels(mergedBelowTexture)) - 1u)
  );
  if (rasterPixelViewEnabled(resolutionScale)) {
    return textureLoad(
      mergedBelowTexture,
      rasterPixelViewTexel(
        uv,
        vec2<i32>(textureDimensions(mergedBelowTexture, 0))
      ),
      0
    );
  }
  return preserveMergedDarkCoverage(
    textureSampleLevel(mergedBelowTexture, layerSampler, uv, lod),
    lod
  );
}

fn sampleMergedAbove(layerPosition: vec2<f32>) -> vec4<f32> {
  let dimensions = vec2<f32>(textureDimensions(mergedAboveTexture, 0));
  let resolutionScale = max(display.hasMergedAbove, 1.0);
  let localPosition = (layerPosition - display.mergedAboveOrigin) * resolutionScale;
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
  let lod = mergedSamplingLod(
    resolutionScale,
    f32(max(1u, textureNumLevels(mergedAboveTexture)) - 1u)
  );
  if (rasterPixelViewEnabled(resolutionScale)) {
    return textureLoad(
      mergedAboveTexture,
      rasterPixelViewTexel(
        uv,
        vec2<i32>(textureDimensions(mergedAboveTexture, 0))
      ),
      0
    );
  }
  return preserveMergedDarkCoverage(
    textureSampleLevel(mergedAboveTexture, layerSampler, uv, lod),
    lod
  );
}
`;
