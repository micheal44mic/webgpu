import { rgba8HighFrequencyQuantizationShader } from "./rgba8-high-frequency-quantization.ts";

/**
 * Shared color boundary for raster transforms on encoded-sRGB RGBA8 storage.
 * Texture loads are decoded before filtering, all interpolation remains f32,
 * and the only 8-bit decision is the document-anchored final write.
 */
export const rasterTransformRgba8ColorShader = /* wgsl */ `
${rgba8HighFrequencyQuantizationShader}

fn rasterTransformSrgbToLinearChannel(value: f32) -> f32 {
  let bounded = clamp(value, 0.0, 1.0);
  if (bounded <= 0.04045) { return bounded / 12.92; }
  return pow((bounded + 0.055) / 1.055, 2.4);
}

fn rasterTransformLinearToSrgbChannel(value: f32) -> f32 {
  let bounded = clamp(value, 0.0, 1.0);
  if (bounded <= 0.0031308) { return bounded * 12.92; }
  return 1.055 * pow(bounded, 1.0 / 2.4) - 0.055;
}

fn rasterTransformEncodedPremultipliedToLinear(value: vec4<f32>) -> vec4<f32> {
  let alpha = clamp(value.a, 0.0, 1.0);
  if (alpha <= 0.000001) { return vec4<f32>(0.0); }
  let straight = clamp(value.rgb / alpha, vec3<f32>(0.0), vec3<f32>(1.0));
  let linear = vec3<f32>(
    rasterTransformSrgbToLinearChannel(straight.r),
    rasterTransformSrgbToLinearChannel(straight.g),
    rasterTransformSrgbToLinearChannel(straight.b)
  );
  return vec4<f32>(linear * alpha, alpha);
}

fn rasterTransformLinearPremultipliedToEncoded(value: vec4<f32>) -> vec4<f32> {
  let alpha = clamp(value.a, 0.0, 1.0);
  if (alpha <= 0.000001) { return vec4<f32>(0.0); }
  let straight = clamp(value.rgb / alpha, vec3<f32>(0.0), vec3<f32>(1.0));
  let encoded = vec3<f32>(
    rasterTransformLinearToSrgbChannel(straight.r),
    rasterTransformLinearToSrgbChannel(straight.g),
    rasterTransformLinearToSrgbChannel(straight.b)
  );
  return vec4<f32>(encoded * alpha, alpha);
}

fn rasterTransformFinalizeRgba8(
  linearPremultiplied: vec4<f32>,
  documentCoordinate: vec2<u32>,
  seed: u32
) -> vec4<f32> {
  return quantizeRgba8HighFrequencyAdjacent(
    rasterTransformLinearPremultipliedToEncoded(linearPremultiplied),
    documentCoordinate,
    seed
  );
}
`;
