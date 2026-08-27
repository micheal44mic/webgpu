/** Isolated WebGPU kernels for destructive raster curves and their histogram. */

import {
  RASTER_TONE_CURVE_LUT_SIZE,
  RASTER_TONE_HISTOGRAM_VALUE_COUNT,
} from "./raster-tone-curves-core.ts";

export const RASTER_TONE_CURVES_ADJUST_WORKGROUP_WIDTH = 8;
export const RASTER_TONE_CURVES_ADJUST_WORKGROUP_HEIGHT = 8;
export const RASTER_TONE_CURVES_HISTOGRAM_WORKGROUP_WIDTH = 16;
export const RASTER_TONE_CURVES_HISTOGRAM_WORKGROUP_HEIGHT = 16;

export interface RasterToneCurvesDispatchSize {
  readonly x: number;
  readonly y: number;
}

function dispatchSize(
  width: number,
  height: number,
  workgroupWidth: number,
  workgroupHeight: number,
): RasterToneCurvesDispatchSize {
  const safeWidth = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
  const safeHeight = Number.isFinite(height) ? Math.max(0, Math.floor(height)) : 0;
  return {
    x: Math.ceil(safeWidth / workgroupWidth),
    y: Math.ceil(safeHeight / workgroupHeight),
  };
}

export function rasterToneCurvesAdjustmentDispatchSize(
  width: number,
  height: number,
): RasterToneCurvesDispatchSize {
  return dispatchSize(
    width,
    height,
    RASTER_TONE_CURVES_ADJUST_WORKGROUP_WIDTH,
    RASTER_TONE_CURVES_ADJUST_WORKGROUP_HEIGHT,
  );
}

export function rasterToneCurvesHistogramDispatchSize(
  width: number,
  height: number,
): RasterToneCurvesDispatchSize {
  return dispatchSize(
    width,
    height,
    RASTER_TONE_CURVES_HISTOGRAM_WORKGROUP_WIDTH,
    RASTER_TONE_CURVES_HISTOGRAM_WORKGROUP_HEIGHT,
  );
}

const encodedRgbHelpers = /* wgsl */ `
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
`;

/**
 * The source is an immutable cropped rgba16float snapshot. The output is the
 * authoritative full-layer rgba16float storage texture; outputOrigin places
 * the cropped dispatch without allocating a second result texture. LUT entries
 * are packed as composite/red/green/blue. Source and output remain distinct, so
 * live previews never introduce a feedback hazard.
 */
export const rasterToneCurvesAdjustmentShader = /* wgsl */ `
struct RasterToneCurvesParameters {
  outputOrigin: vec2<u32>,
  _padding: vec2<u32>,
}

@group(0) @binding(0) var immutableSource: texture_2d<f32>;
@group(0) @binding(1) var adjustedOutput:
  texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<storage, read> curveLut:
  array<vec4<f32>, ${RASTER_TONE_CURVE_LUT_SIZE}>;
@group(0) @binding(3) var<uniform> parameters: RasterToneCurvesParameters;

${encodedRgbHelpers}

fn sampleCurveLut(input: f32) -> vec4<f32> {
  let position = clamp(input, 0.0, 1.0)
    * f32(${RASTER_TONE_CURVE_LUT_SIZE - 1});
  let lower = u32(floor(position));
  let upper = min(${RASTER_TONE_CURVE_LUT_SIZE - 1}u, lower + 1u);
  return mix(curveLut[lower], curveLut[upper], fract(position));
}

@compute @workgroup_size(
  ${RASTER_TONE_CURVES_ADJUST_WORKGROUP_WIDTH},
  ${RASTER_TONE_CURVES_ADJUST_WORKGROUP_HEIGHT}
)
fn adjustRasterTone(@builtin(global_invocation_id) gid: vec3<u32>) {
  let size = textureDimensions(immutableSource);
  if (gid.x >= size.x || gid.y >= size.y) { return; }
  let pixel = vec2<i32>(gid.xy);
  let outputPixel = vec2<i32>(gid.xy + parameters.outputOrigin);
  let source = textureLoad(immutableSource, pixel, 0);
  let alpha = clamp(source.a, 0.0, 1.0);
  if (alpha <= COLOR_EPSILON) {
    textureStore(adjustedOutput, outputPixel, vec4<f32>(0.0, 0.0, 0.0, alpha));
    return;
  }

  let straightLinear = clamp(
    source.rgb / alpha,
    vec3<f32>(0.0),
    vec3<f32>(1.0)
  );
  let encoded = linearRgbToEncodedRgb(straightLinear);
  let componentAdjusted = vec3<f32>(
    sampleCurveLut(encoded.r).y,
    sampleCurveLut(encoded.g).z,
    sampleCurveLut(encoded.b).w
  );
  let compositeAdjusted = vec3<f32>(
    sampleCurveLut(componentAdjusted.r).x,
    sampleCurveLut(componentAdjusted.g).x,
    sampleCurveLut(componentAdjusted.b).x
  );
  let result = encodedRgbToLinearRgb(compositeAdjusted) * alpha;
  textureStore(adjustedOutput, outputPixel, vec4<f32>(result, alpha));
}
`;

/**
 * One dispatch computes all four 256-bin views. Transparent pixels are
 * ignored. The composite range is the aggregate distribution of R, G and B,
 * while the remaining ranges hold each component separately. A workgroup
 * histogram reduces global atomic contention on large layers.
 */
export const rasterToneCurvesHistogramShader = /* wgsl */ `
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> globalHistogram:
  array<atomic<u32>, ${RASTER_TONE_HISTOGRAM_VALUE_COUNT}>;

${encodedRgbHelpers}

const BIN_COUNT = 256u;
const LOCAL_VALUE_COUNT = ${RASTER_TONE_HISTOGRAM_VALUE_COUNT}u;
var<workgroup> localHistogram:
  array<atomic<u32>, ${RASTER_TONE_HISTOGRAM_VALUE_COUNT}>;

fn histogramBin(value: f32) -> u32 {
  return min(BIN_COUNT - 1u, u32(clamp(value, 0.0, 1.0) * f32(BIN_COUNT)));
}

@compute @workgroup_size(
  ${RASTER_TONE_CURVES_HISTOGRAM_WORKGROUP_WIDTH},
  ${RASTER_TONE_CURVES_HISTOGRAM_WORKGROUP_HEIGHT}
)
fn buildRasterToneHistogram(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(local_invocation_index) localIndex: u32,
) {
  for (
    var index = localIndex;
    index < LOCAL_VALUE_COUNT;
    index += ${
      RASTER_TONE_CURVES_HISTOGRAM_WORKGROUP_WIDTH
      * RASTER_TONE_CURVES_HISTOGRAM_WORKGROUP_HEIGHT
    }u
  ) {
    atomicStore(&localHistogram[index], 0u);
  }
  workgroupBarrier();

  let size = textureDimensions(sourceTexture);
  if (gid.x < size.x && gid.y < size.y) {
    let source = textureLoad(sourceTexture, vec2<i32>(gid.xy), 0);
    let alpha = clamp(source.a, 0.0, 1.0);
    if (alpha > COLOR_EPSILON) {
      let encoded = linearRgbToEncodedRgb(clamp(
        source.rgb / alpha,
        vec3<f32>(0.0),
        vec3<f32>(1.0)
      ));
      let redBin = histogramBin(encoded.r);
      let greenBin = histogramBin(encoded.g);
      let blueBin = histogramBin(encoded.b);
      atomicAdd(&localHistogram[redBin], 1u);
      atomicAdd(&localHistogram[greenBin], 1u);
      atomicAdd(&localHistogram[blueBin], 1u);
      atomicAdd(&localHistogram[BIN_COUNT + redBin], 1u);
      atomicAdd(&localHistogram[2u * BIN_COUNT + greenBin], 1u);
      atomicAdd(&localHistogram[3u * BIN_COUNT + blueBin], 1u);
    }
  }
  workgroupBarrier();

  for (
    var index = localIndex;
    index < LOCAL_VALUE_COUNT;
    index += ${
      RASTER_TONE_CURVES_HISTOGRAM_WORKGROUP_WIDTH
      * RASTER_TONE_CURVES_HISTOGRAM_WORKGROUP_HEIGHT
    }u
  ) {
    let count = atomicLoad(&localHistogram[index]);
    if (count > 0u) {
      atomicAdd(&globalHistogram[index], count);
    }
  }
}
`;
