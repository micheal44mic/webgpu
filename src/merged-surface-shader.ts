import { rasterPixelViewShaderHelpers } from "./raster-pixel-view.ts";

/**
 * Samples a cropped merged surface in document coordinates. At zoom above
 * 100%, mip 0 can contain multiple texels per document pixel; the shader maps
 * document coordinates into that density and selects the matching display LOD.
 */
export const mergedSurfaceSamplingShader = /* wgsl */ `
${rasterPixelViewShaderHelpers}
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
  return textureSampleLevel(mergedBelowTexture, layerSampler, uv, lod);
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
  return textureSampleLevel(mergedAboveTexture, layerSampler, uv, lod);
}
`;
