import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: process.cwd(),
  server: { middlewareMode: true },
});

let core;
let shaders;
try {
  core = await server.ssrLoadModule("/src/raster-color-adjust-core.ts");
  shaders = await server.ssrLoadModule("/src/raster-color-adjust-shaders.ts");
} finally {
  await server.close();
}

const {
  DEFAULT_RASTER_COLOR_ADJUST_SETTINGS,
  applyRasterColorAdjustToPremultipliedLinearRgba,
  isRasterColorAdjustIdentity,
  normalizeRasterColorAdjustSettings,
  rasterColorAdjustSettingsEqual,
} = core;
const {
  createRasterColorAdjustShader,
  rasterColorAdjustDispatchSize,
  rasterColorAdjustShader,
} = shaders;

function approx(actual, expected, tolerance = 1e-6) {
  assert.equal(Number.isFinite(actual), true);
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

assert.deepEqual(DEFAULT_RASTER_COLOR_ADJUST_SETTINGS, {
  hueDegrees: 0,
  saturationPercent: 0,
  brightnessPercent: 0,
});
assert.equal(isRasterColorAdjustIdentity(DEFAULT_RASTER_COLOR_ADJUST_SETTINGS), true);
assert.deepEqual(normalizeRasterColorAdjustSettings({
  hueDegrees: 900,
  saturationPercent: -400,
  brightnessPercent: Number.NaN,
}), {
  hueDegrees: 180,
  saturationPercent: -100,
  brightnessPercent: 0,
});
assert.equal(rasterColorAdjustSettingsEqual(
  DEFAULT_RASTER_COLOR_ADJUST_SETTINGS,
  normalizeRasterColorAdjustSettings({}),
), true);

const identitySource = [0.31, 0.11, 0.025, 0.5];
const identity = applyRasterColorAdjustToPremultipliedLinearRgba(
  identitySource,
  DEFAULT_RASTER_COLOR_ADJUST_SETTINGS,
);
identity.forEach((value, index) => approx(value, identitySource[index], 1e-7));

const green = applyRasterColorAdjustToPremultipliedLinearRgba(
  [1, 0, 0, 1],
  { hueDegrees: 120, saturationPercent: 0, brightnessPercent: 0 },
);
approx(green[0], 0);
approx(green[1], 1);
approx(green[2], 0);
approx(green[3], 1);

const blueHalfAlpha = applyRasterColorAdjustToPremultipliedLinearRgba(
  [0.5, 0, 0, 0.5],
  { hueDegrees: -120, saturationPercent: 0, brightnessPercent: 0 },
);
approx(blueHalfAlpha[0], 0);
approx(blueHalfAlpha[1], 0);
approx(blueHalfAlpha[2], 0.5);
approx(blueHalfAlpha[3], 0.5);

const noSaturation = applyRasterColorAdjustToPremultipliedLinearRgba(
  [1, 0, 0, 1],
  { hueDegrees: 0, saturationPercent: -100, brightnessPercent: 0 },
);
approx(noSaturation[0], 1);
approx(noSaturation[1], 1);
approx(noSaturation[2], 1);

const dark = applyRasterColorAdjustToPremultipliedLinearRgba(
  [0.4, 0.2, 0.1, 1],
  { hueDegrees: 0, saturationPercent: 0, brightnessPercent: -100 },
);
dark.slice(0, 3).forEach((value) => approx(value, 0));

const bright = applyRasterColorAdjustToPremultipliedLinearRgba(
  [0, 0, 0, 1],
  { hueDegrees: 0, saturationPercent: 0, brightnessPercent: 100 },
);
bright.slice(0, 3).forEach((value) => approx(value, 1));

assert.deepEqual(
  applyRasterColorAdjustToPremultipliedLinearRgba(
    [0.4, 0.3, 0.2, 0],
    { hueDegrees: 180, saturationPercent: 100, brightnessPercent: 100 },
  ),
  [0, 0, 0, 0],
);

assert.deepEqual(rasterColorAdjustDispatchSize(2048, 2048), { x: 256, y: 256 });
assert.deepEqual(rasterColorAdjustDispatchSize(17, 9), { x: 3, y: 2 });
assert.match(rasterColorAdjustShader, /texture_storage_2d<rgba16float, write>/);
assert.match(rasterColorAdjustShader, /source\.rgb \/ alpha/);
assert.match(
  rasterColorAdjustShader,
  /rasterAdjustmentStraightEncodedToStored\(adjustedEncoded, alpha\)/,
);
assert.match(
  rasterColorAdjustShader,
  /outputOrigin:\s*vec2<u32>[\s\S]*quantizationSeed:\s*u32[\s\S]*adjustments:\s*vec4<f32>/,
  "the uniform ABI must remain two 16-byte rows",
);

const rgba8Shader = createRasterColorAdjustShader({
  layerFormat: "rgba8unorm",
  colorSpace: "encoded-srgb-premultiplied",
});
assert.match(rgba8Shader, /texture_storage_2d<rgba8unorm, write>/);
assert.match(rgba8Shader, /return straightStored;/);
assert.match(rgba8Shader, /quantizeRgba8HighFrequencyAdjacent/);
assert.match(rgba8Shader, /parameters\.quantizationSeed/);

console.log("Raster Color Adjust core math and dual-storage shader contract verified.");
