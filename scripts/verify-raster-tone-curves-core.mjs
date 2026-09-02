import assert from "node:assert/strict";
import {
  DEFAULT_RASTER_TONE_CURVE_SET,
  RASTER_TONE_CURVE_LUT_BYTE_SIZE,
  RASTER_TONE_CURVE_LUT_SIZE,
  RASTER_TONE_CURVE_MAX_POINTS,
  RASTER_TONE_CURVES_CORE_BUILD,
  RASTER_TONE_HISTOGRAM_BIN_COUNT,
  RASTER_TONE_HISTOGRAM_BYTE_SIZE,
  RASTER_TONE_HISTOGRAM_VALUE_COUNT,
  applyPackedRasterToneCurveLut,
  compileRasterToneCurve,
  createEmptyRasterToneHistogram,
  createPackedRasterToneCurveLut,
  encodedRgbToLinearRgb,
  evaluateCompiledRasterToneCurve,
  evaluateRasterToneCurve,
  isRasterToneCurveSetIdentity,
  linearRgbToEncodedRgb,
  normalizeRasterToneCurve,
  normalizeRasterToneCurveSet,
  rasterToneHistogramBin,
  rasterToneHistogramOffset,
} from "../src/raster-tone-curves-core.ts";
import {
  createRasterToneCurvesAdjustmentShader,
  createRasterToneCurvesHistogramShader,
  rasterToneCurvesAdjustmentDispatchSize,
  rasterToneCurvesAdjustmentShader,
  rasterToneCurvesHistogramDispatchSize,
  rasterToneCurvesHistogramShader,
} from "../src/raster-tone-curves-shaders.ts";
import {
  rasterAdjustmentBytesPerPixel,
  rasterAdjustmentStorageProfileKey,
} from "../src/raster-adjustment-storage-shader.ts";
import { quantizeUnorm8HighFrequencyAdjacent } from "../src/rgba8-high-frequency-quantization.ts";

const close = (left, right, epsilon = 1e-6) => {
  assert.ok(
    Math.abs(left - right) <= epsilon,
    `${left} must be within ${epsilon} of ${right}`,
  );
};

assert.equal(
  RASTER_TONE_CURVES_CORE_BUILD,
  "raster-tone-curves-core-v1-shape-preserving-rgb-lut",
);
assert.equal(RASTER_TONE_CURVE_LUT_SIZE, 256);
assert.equal(RASTER_TONE_CURVE_LUT_BYTE_SIZE, 4096);
assert.equal(RASTER_TONE_CURVE_MAX_POINTS, 16);
assert.equal(RASTER_TONE_HISTOGRAM_BIN_COUNT, 256);
assert.equal(RASTER_TONE_HISTOGRAM_VALUE_COUNT, 1024);
assert.equal(RASTER_TONE_HISTOGRAM_BYTE_SIZE, 4096);

assert.deepEqual(normalizeRasterToneCurve(), DEFAULT_RASTER_TONE_CURVE_SET.composite);
assert.deepEqual(
  normalizeRasterToneCurve([
    { x: 0.8, y: 0.6 },
    { x: Number.NaN, y: 1 },
    { x: 0.2, y: 0.3 },
    { x: 0.2, y: 0.4 },
    { x: -5, y: 2 },
  ]),
  [
    { x: 0, y: 1 },
    { x: 0.2, y: 0.4 },
    { x: 0.8, y: 0.6 },
  ],
  "Normalization must sort, clamp and let the latest colliding point win.",
);
assert.throws(
  () => normalizeRasterToneCurve(
    Array.from({ length: 17 }, (_, index) => ({ x: index / 16, y: index / 16 })),
  ),
  /at most 16 points/i,
);

const clippedInput = compileRasterToneCurve([
  { x: 0.2, y: 0.1 },
  { x: 0.8, y: 0.9 },
]);
assert.deepEqual(clippedInput.points, [
  { x: 0.2, y: 0.1 },
  { x: 0.8, y: 0.9 },
]);
assert.equal(evaluateCompiledRasterToneCurve(clippedInput, 0), 0.1);
assert.equal(evaluateCompiledRasterToneCurve(clippedInput, 0.2), 0.1);
assert.equal(evaluateCompiledRasterToneCurve(clippedInput, 0.8), 0.9);
assert.equal(evaluateCompiledRasterToneCurve(clippedInput, 1), 0.9);
assert.equal(isRasterToneCurveSetIdentity(DEFAULT_RASTER_TONE_CURVE_SET), true);
assert.equal(isRasterToneCurveSetIdentity({
  composite: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }],
}), true);
assert.equal(isRasterToneCurveSetIdentity({
  composite: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }],
}), false, "Clipped input endpoints are not identity even when their points lie on y=x.");
assert.deepEqual(
  normalizeRasterToneCurveSet({ red: [{ x: 0.5, y: 0.25 }] }),
  {
    composite: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    red: [{ x: 0, y: 0 }, { x: 0.5, y: 0.25 }, { x: 1, y: 1 }],
    green: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    blue: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  },
);

const shapedPoints = normalizeRasterToneCurve([
  { x: 0, y: 0.15 },
  { x: 0.2, y: 0.7 },
  { x: 0.5, y: 0.35 },
  { x: 0.75, y: 0.85 },
  { x: 1, y: 0.65 },
]);
const shaped = compileRasterToneCurve(shapedPoints);
for (const point of shapedPoints) {
  close(evaluateCompiledRasterToneCurve(shaped, point.x), point.y, 1e-12);
}
for (let segment = 0; segment < shapedPoints.length - 1; segment += 1) {
  const left = shapedPoints[segment];
  const right = shapedPoints[segment + 1];
  const minimum = Math.min(left.y, right.y);
  const maximum = Math.max(left.y, right.y);
  for (let step = 0; step <= 100; step += 1) {
    const x = left.x + (right.x - left.x) * step / 100;
    const value = evaluateCompiledRasterToneCurve(shaped, x);
    assert.ok(value >= minimum - 1e-12 && value <= maximum + 1e-12);
  }
}

const monotone = compileRasterToneCurve([
  { x: 0, y: 0 },
  { x: 0.12, y: 0.03 },
  { x: 0.55, y: 0.8 },
  { x: 1, y: 1 },
]);
let previous = -1;
for (let index = 0; index <= 4096; index += 1) {
  const value = evaluateCompiledRasterToneCurve(monotone, index / 4096);
  assert.ok(value + 1e-12 >= previous, "A monotone point set must remain monotone.");
  previous = value;
}
close(evaluateRasterToneCurve([{ x: 0, y: 1 }, { x: 1, y: 0 }], 0.25), 0.75);
assert.equal(evaluateCompiledRasterToneCurve(monotone, Number.NaN), 0);

const identityLut = createPackedRasterToneCurveLut(DEFAULT_RASTER_TONE_CURVE_SET);
assert.equal(identityLut.length, RASTER_TONE_CURVE_LUT_SIZE * 4);
for (let index = 0; index < RASTER_TONE_CURVE_LUT_SIZE; index += 1) {
  const expected = index / (RASTER_TONE_CURVE_LUT_SIZE - 1);
  for (let channel = 0; channel < 4; channel += 1) {
    close(identityLut[index * 4 + channel], expected, 3e-8);
  }
}

for (const linear of [0, 0.0005, 0.0031308, 0.1, 0.5, 1]) {
  close(encodedRgbToLinearRgb(linearRgbToEncodedRgb(linear)), linear, 1e-12);
}
const source = [0.15, 0.3, 0.45, 0.6];
const identityResult = applyPackedRasterToneCurveLut(source, identityLut);
for (let channel = 0; channel < 4; channel += 1) {
  close(identityResult[channel], source[channel], 2e-5);
}
assert.deepEqual(
  applyPackedRasterToneCurveLut([0.4, 0.2, 0.1, 0], identityLut),
  [0, 0, 0, 0],
);

const adjustedLut = createPackedRasterToneCurveLut({
  composite: [{ x: 0, y: 0 }, { x: 1, y: 0.8 }],
  red: [{ x: 0, y: 0 }, { x: 1, y: 0.5 }],
});
const adjusted = applyPackedRasterToneCurveLut([0.25, 0.25, 0.25, 0.5], adjustedLut);
assert.equal(adjusted[3], 0.5, "Alpha must be preserved exactly.");
assert.ok(adjusted[0] < adjusted[1] && adjusted[1] === adjusted[2]);
assert.ok(adjusted[0] <= adjusted[3] && adjusted[1] <= adjusted[3]);

assert.equal(rasterToneHistogramOffset("composite"), 0);
assert.equal(rasterToneHistogramOffset("red"), 256);
assert.equal(rasterToneHistogramOffset("green"), 512);
assert.equal(rasterToneHistogramOffset("blue"), 768);
assert.equal(rasterToneHistogramBin(-1), 0);
assert.equal(rasterToneHistogramBin(0.5), 128);
assert.equal(rasterToneHistogramBin(1), 255);
assert.equal(createEmptyRasterToneHistogram().byteLength, 4096);

assert.deepEqual(rasterToneCurvesAdjustmentDispatchSize(17, 9), { x: 3, y: 2 });
assert.deepEqual(rasterToneCurvesHistogramDispatchSize(17, 33), { x: 2, y: 3 });
assert.deepEqual(rasterToneCurvesAdjustmentDispatchSize(-1, Number.NaN), { x: 0, y: 0 });

assert.match(rasterToneCurvesAdjustmentShader, /immutableSource: texture_2d<f32>/);
assert.match(rasterToneCurvesAdjustmentShader, /texture_storage_2d<rgba16float, write>/);
assert.match(rasterToneCurvesAdjustmentShader, /outputOrigin: vec2<u32>/);
assert.match(
  rasterToneCurvesAdjustmentShader,
  /let outputPixel = vec2<i32>\(gid\.xy \+ parameters\.outputOrigin\)/,
);
assert.equal(
  (rasterToneCurvesAdjustmentShader.match(/textureStore\(adjustedOutput, outputPixel/g) ?? []).length,
  2,
  "Both transparent and adjusted pixels must use the authoritative texture origin.",
);
assert.match(rasterToneCurvesAdjustmentShader, /source\.rgb \/ alpha/);
assert.match(
  rasterToneCurvesAdjustmentShader,
  /rasterAdjustmentStraightEncodedToStored\(compositeAdjusted, alpha\)/,
);
assert.match(rasterToneCurvesAdjustmentShader, /sampleCurveLut\(encoded\.r\)\.y/);
assert.match(rasterToneCurvesAdjustmentShader, /sampleCurveLut\(componentAdjusted\.r\)\.x/);
assert.doesNotMatch(rasterToneCurvesAdjustmentShader, /rgba8|unorm8|rgba32float/i);

assert.match(rasterToneCurvesHistogramShader, /array<atomic<u32>, 1024>/);
assert.match(rasterToneCurvesHistogramShader, /var<workgroup> localHistogram/);
assert.match(rasterToneCurvesHistogramShader, /workgroupBarrier\(\)/);
assert.match(
  rasterToneCurvesHistogramShader,
  /if \(alpha > RASTER_ADJUSTMENT_ALPHA_EPSILON\)/,
);
assert.match(rasterToneCurvesHistogramShader, /atomicAdd\(&globalHistogram\[index\], count\)/);
assert.equal((rasterToneCurvesHistogramShader.match(/workgroupBarrier\(\)/g) ?? []).length, 2);

const rgba8Profile = {
  layerFormat: "rgba8unorm",
  colorSpace: "encoded-srgb-premultiplied",
};
const rgba8AdjustmentShader = createRasterToneCurvesAdjustmentShader(rgba8Profile);
const rgba8HistogramShader = createRasterToneCurvesHistogramShader(rgba8Profile);
assert.match(rgba8AdjustmentShader, /texture_storage_2d<rgba8unorm, write>/);
assert.match(rgba8AdjustmentShader, /return straightStored;/);
assert.match(rgba8AdjustmentShader, /quantizeRgba8HighFrequencyAdjacent/);
assert.match(rgba8AdjustmentShader, /parameters\.quantizationSeed/);
assert.match(rgba8HistogramShader, /return straightStored;/);
assert.doesNotMatch(
  rgba8HistogramShader,
  /return rasterAdjustmentLinearToEncoded\(straightStored\)/,
);
assert.equal(rasterAdjustmentBytesPerPixel("rgba8unorm"), 4);
assert.equal(rasterAdjustmentBytesPerPixel("rgba16float"), 8);
assert.equal(
  rasterAdjustmentStorageProfileKey(rgba8Profile),
  "rgba8unorm:encoded-srgb-premultiplied",
);
const quarterCode = (42 + 0.25) / 255;
const quantizedCodes = [];
for (let y = 0; y < 16; y += 1) {
  for (let x = 0; x < 16; x += 1) {
    quantizedCodes.push(quantizeUnorm8HighFrequencyAdjacent(quarterCode, x, y, 17));
  }
}
assert.deepEqual([...new Set(quantizedCodes)].sort((a, b) => a - b), [42, 43]);
assert.equal(
  quantizedCodes.filter((code) => code === 43).length,
  64,
  "A quarter-code value must distribute exactly one quarter of the 16x16 cell upward.",
);

console.log("Raster tone curves core verification passed.");
