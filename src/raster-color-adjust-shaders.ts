/** WebGPU kernel for the selected raster's live color adjustment. */

export const RASTER_COLOR_ADJUST_WORKGROUP_WIDTH = 8;
export const RASTER_COLOR_ADJUST_WORKGROUP_HEIGHT = 8;

export interface RasterColorAdjustDispatchSize {
  readonly x: number;
  readonly y: number;
}

export function rasterColorAdjustDispatchSize(
  width: number,
  height: number,
): RasterColorAdjustDispatchSize {
  const safeWidth = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
  const safeHeight = Number.isFinite(height) ? Math.max(0, Math.floor(height)) : 0;
  return {
    x: Math.ceil(safeWidth / RASTER_COLOR_ADJUST_WORKGROUP_WIDTH),
    y: Math.ceil(safeHeight / RASTER_COLOR_ADJUST_WORKGROUP_HEIGHT),
  };
}

export const rasterColorAdjustShader = /* wgsl */ `
struct RasterColorAdjustParameters {
  outputOrigin: vec2<u32>,
  _originPadding: vec2<u32>,
  adjustments: vec4<f32>,
}

@group(0) @binding(0) var immutableSource: texture_2d<f32>;
@group(0) @binding(1) var adjustedOutput:
  texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> parameters: RasterColorAdjustParameters;

const COLOR_EPSILON: f32 = 0.0000001;

fn linearRgbToEncodedRgb(value: vec3<f32>) -> vec3<f32> {
  let linear = clamp(value, vec3<f32>(0.0), vec3<f32>(1.0));
  let lower = linear * 12.92;
  let upper = 1.055 * pow(linear, vec3<f32>(1.0 / 2.4)) - vec3<f32>(0.055);
  return select(upper, lower, linear <= vec3<f32>(0.0031308));
}

fn encodedRgbToLinearRgb(value: vec3<f32>) -> vec3<f32> {
  let encoded = clamp(value, vec3<f32>(0.0), vec3<f32>(1.0));
  let lower = encoded / 12.92;
  let upper = pow(
    (encoded + vec3<f32>(0.055)) / 1.055,
    vec3<f32>(2.4)
  );
  return select(upper, lower, encoded <= vec3<f32>(0.04045));
}

fn encodedRgbToHsv(rgb: vec3<f32>) -> vec3<f32> {
  let maximum = max(rgb.r, max(rgb.g, rgb.b));
  let minimum = min(rgb.r, min(rgb.g, rgb.b));
  let delta = maximum - minimum;
  var hue = 0.0;
  if (delta > COLOR_EPSILON) {
    if (maximum == rgb.r) {
      hue = (rgb.g - rgb.b) / delta;
    } else if (maximum == rgb.g) {
      hue = (rgb.b - rgb.r) / delta + 2.0;
    } else {
      hue = (rgb.r - rgb.g) / delta + 4.0;
    }
    hue = fract(hue / 6.0 + 1.0);
  }
  let saturation = select(0.0, delta / maximum, maximum > COLOR_EPSILON);
  return vec3<f32>(hue, saturation, maximum);
}

fn hsvToEncodedRgb(hsv: vec3<f32>) -> vec3<f32> {
  let hue = fract(hsv.x + 1.0) * 6.0;
  let saturation = clamp(hsv.y, 0.0, 1.0);
  let brightness = clamp(hsv.z, 0.0, 1.0);
  let chroma = brightness * saturation;
  let intermediate = chroma * (1.0 - abs(fract(hue * 0.5) * 2.0 - 1.0));
  var rgb = vec3<f32>(0.0);
  if (hue < 1.0) {
    rgb = vec3<f32>(chroma, intermediate, 0.0);
  } else if (hue < 2.0) {
    rgb = vec3<f32>(intermediate, chroma, 0.0);
  } else if (hue < 3.0) {
    rgb = vec3<f32>(0.0, chroma, intermediate);
  } else if (hue < 4.0) {
    rgb = vec3<f32>(0.0, intermediate, chroma);
  } else if (hue < 5.0) {
    rgb = vec3<f32>(intermediate, 0.0, chroma);
  } else {
    rgb = vec3<f32>(chroma, 0.0, intermediate);
  }
  return rgb + vec3<f32>(brightness - chroma);
}

fn adjustUnitComponent(value: f32, amount: f32) -> f32 {
  let safeAmount = clamp(amount, -1.0, 1.0);
  return select(
    value + (1.0 - value) * safeAmount,
    value * (1.0 + safeAmount),
    safeAmount < 0.0
  );
}

@compute @workgroup_size(
  ${RASTER_COLOR_ADJUST_WORKGROUP_WIDTH},
  ${RASTER_COLOR_ADJUST_WORKGROUP_HEIGHT}
)
fn adjustRasterColor(@builtin(global_invocation_id) gid: vec3<u32>) {
  let size = textureDimensions(immutableSource);
  if (gid.x >= size.x || gid.y >= size.y) { return; }
  let source = textureLoad(immutableSource, vec2<i32>(gid.xy), 0);
  let alpha = clamp(source.a, 0.0, 1.0);
  let outputPixel = vec2<i32>(gid.xy + parameters.outputOrigin);
  if (alpha <= COLOR_EPSILON) {
    textureStore(adjustedOutput, outputPixel, vec4<f32>(0.0, 0.0, 0.0, alpha));
    return;
  }
  let straightLinear = clamp(source.rgb / alpha, vec3<f32>(0.0), vec3<f32>(1.0));
  let encoded = linearRgbToEncodedRgb(straightLinear);
  let hsv = encodedRgbToHsv(encoded);
  let adjustedHsv = vec3<f32>(
    hsv.x + parameters.adjustments.x,
    adjustUnitComponent(hsv.y, parameters.adjustments.y),
    adjustUnitComponent(hsv.z, parameters.adjustments.z)
  );
  let adjustedLinear = encodedRgbToLinearRgb(hsvToEncodedRgb(adjustedHsv));
  textureStore(
    adjustedOutput,
    outputPixel,
    vec4<f32>(adjustedLinear * alpha, alpha)
  );
}
`;
