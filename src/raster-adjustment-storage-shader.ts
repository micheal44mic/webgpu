/**
 * Shared storage/color-space contract for destructive per-pixel adjustments.
 *
 * The authoritative RGBA8 document stores encoded-sRGB premultiplied bytes.
 * Adjustment math still runs in f32 and enters the straight encoded domain
 * expected by the controls. Only the final store is quantized back to adjacent
 * 8-bit codes. The legacy linear RGBA16F profile keeps its original behavior.
 */

import type {
  DocumentStorageColorSpace,
  LayerFormat,
} from "./engine-types.ts";
import { rgba8HighFrequencyQuantizationShader } from "./rgba8-high-frequency-quantization.ts";

export interface RasterAdjustmentStorageProfile {
  readonly layerFormat: LayerFormat;
  readonly colorSpace: DocumentStorageColorSpace;
}

export function rasterAdjustmentStorageProfileKey(
  profile: RasterAdjustmentStorageProfile,
): string {
  return `${profile.layerFormat}:${profile.colorSpace}`;
}

export function rasterAdjustmentBytesPerPixel(format: LayerFormat): number {
  return format === "rgba8unorm" ? 4 : 8;
}

export function rasterAdjustmentStorageTextureFormat(
  profile: RasterAdjustmentStorageProfile,
): LayerFormat {
  return profile.layerFormat;
}

/** WGSL helpers used by Curves, Color Adjust, Color Balance and Gradient Map. */
export function rasterAdjustmentStorageShader(
  profile: RasterAdjustmentStorageProfile,
): string {
  const storedEncodedSrgb = profile.colorSpace === "encoded-srgb-premultiplied";
  const rgba8 = profile.layerFormat === "rgba8unorm";
  return /* wgsl */ `
const RASTER_ADJUSTMENT_ALPHA_EPSILON: f32 = 0.0000001;

fn rasterAdjustmentLinearToEncoded(value: vec3<f32>) -> vec3<f32> {
  let linear = clamp(value, vec3<f32>(0.0), vec3<f32>(1.0));
  let lower = linear * 12.92;
  let upper = 1.055 * pow(linear, vec3<f32>(1.0 / 2.4)) - vec3<f32>(0.055);
  return select(upper, lower, linear <= vec3<f32>(0.0031308));
}

fn rasterAdjustmentEncodedToLinear(value: vec3<f32>) -> vec3<f32> {
  let encoded = clamp(value, vec3<f32>(0.0), vec3<f32>(1.0));
  let lower = encoded / 12.92;
  let upper = pow(
    (encoded + vec3<f32>(0.055)) / 1.055,
    vec3<f32>(2.4)
  );
  return select(upper, lower, encoded <= vec3<f32>(0.04045));
}

fn rasterAdjustmentStoredToStraightEncoded(source: vec4<f32>) -> vec3<f32> {
  let alpha = clamp(source.a, 0.0, 1.0);
  if (alpha <= RASTER_ADJUSTMENT_ALPHA_EPSILON) {
    return vec3<f32>(0.0);
  }
  let straightStored = clamp(
    source.rgb / alpha,
    vec3<f32>(0.0),
    vec3<f32>(1.0)
  );
  return ${storedEncodedSrgb
    ? "straightStored"
    : "rasterAdjustmentLinearToEncoded(straightStored)"};
}

fn rasterAdjustmentStraightEncodedToStored(
  encoded: vec3<f32>,
  alphaInput: f32
) -> vec4<f32> {
  let alpha = clamp(alphaInput, 0.0, 1.0);
  if (alpha <= RASTER_ADJUSTMENT_ALPHA_EPSILON) {
    return vec4<f32>(0.0);
  }
  let bounded = clamp(encoded, vec3<f32>(0.0), vec3<f32>(1.0));
  let straightStored = ${storedEncodedSrgb
    ? "bounded"
    : "rasterAdjustmentEncodedToLinear(bounded)"};
  return vec4<f32>(straightStored * alpha, alpha);
}

${rgba8 ? rgba8HighFrequencyQuantizationShader : ""}

fn rasterAdjustmentFinalizeStored(
  value: vec4<f32>,
  documentCoordinate: vec2<u32>,
  seed: u32
) -> vec4<f32> {
  return ${rgba8
    ? "quantizeRgba8HighFrequencyAdjacent(value, documentCoordinate, seed)"
    : "value"};
}
`;
}
