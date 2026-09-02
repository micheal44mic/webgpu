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
  core = await server.ssrLoadModule("/src/raster-color-balance-core.ts");
  shaders = await server.ssrLoadModule("/src/raster-color-balance-shaders.ts");
} finally {
  await server.close();
}

const {
  DEFAULT_RASTER_COLOR_BALANCE_SETTINGS,
  RASTER_COLOR_BALANCE_TONES,
  applyRasterColorBalanceToPremultipliedLinearRgba,
  isRasterColorBalanceIdentity,
  normalizeRasterColorBalanceSettings,
  rasterColorBalanceSettingsEqual,
  rasterColorBalanceToneWeights,
} = core;
const {
  createRasterColorBalanceShader,
  rasterColorBalanceDispatchSize,
  rasterColorBalanceShader,
} = shaders;

function approx(actual, expected, tolerance = 1e-6) {
  assert.equal(Number.isFinite(actual), true);
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

function linearToEncoded(value) {
  const safe = Math.min(1, Math.max(0, value));
  return safe <= 0.0031308
    ? safe * 12.92
    : 1.055 * Math.pow(safe, 1 / 2.4) - 0.055;
}

function encodedLuminance(rgba) {
  const alpha = rgba[3];
  if (alpha <= 1e-7) return 0;
  return linearToEncoded(rgba[0] / alpha) * 0.2126
    + linearToEncoded(rgba[1] / alpha) * 0.7152
    + linearToEncoded(rgba[2] / alpha) * 0.0722;
}

const neutralTone = {
  cyanRedPercent: 0,
  magentaGreenPercent: 0,
  yellowBluePercent: 0,
};
assert.deepEqual(RASTER_COLOR_BALANCE_TONES, ["shadows", "midtones", "highlights"]);
assert.deepEqual(DEFAULT_RASTER_COLOR_BALANCE_SETTINGS, {
  shadows: neutralTone,
  midtones: neutralTone,
  highlights: neutralTone,
  preserveLuminosity: true,
});
assert.equal(isRasterColorBalanceIdentity(DEFAULT_RASTER_COLOR_BALANCE_SETTINGS), true);
assert.equal(isRasterColorBalanceIdentity(normalizeRasterColorBalanceSettings({
  preserveLuminosity: false,
})), true, "the preservation toggle alone must not create a pixel edit");

const normalized = normalizeRasterColorBalanceSettings({
  shadows: {
    cyanRedPercent: 250,
    magentaGreenPercent: Number.NaN,
    yellowBluePercent: -250,
  },
  midtones: { cyanRedPercent: 12.5 },
  preserveLuminosity: false,
});
assert.deepEqual(normalized, {
  shadows: {
    cyanRedPercent: 100,
    magentaGreenPercent: 0,
    yellowBluePercent: -100,
  },
  midtones: {
    cyanRedPercent: 12.5,
    magentaGreenPercent: 0,
    yellowBluePercent: 0,
  },
  highlights: neutralTone,
  preserveLuminosity: false,
});
assert.equal(isRasterColorBalanceIdentity(normalized), false);
assert.equal(rasterColorBalanceSettingsEqual(
  DEFAULT_RASTER_COLOR_BALANCE_SETTINGS,
  normalizeRasterColorBalanceSettings({}),
), true);
assert.equal(rasterColorBalanceSettingsEqual(
  DEFAULT_RASTER_COLOR_BALANCE_SETTINGS,
  normalizeRasterColorBalanceSettings({ preserveLuminosity: false }),
), false);

assert.deepEqual(rasterColorBalanceToneWeights(0), [1, 0, 0]);
assert.deepEqual(rasterColorBalanceToneWeights(0.5), [0, 1, 0]);
assert.deepEqual(rasterColorBalanceToneWeights(1), [0, 0, 1]);
assert.deepEqual(rasterColorBalanceToneWeights(Number.NaN), [1, 0, 0]);
for (let step = 0; step <= 100; step += 1) {
  const weights = rasterColorBalanceToneWeights(step / 100);
  weights.forEach((weight) => assert.ok(weight >= 0 && weight <= 1));
  approx(weights[0] + weights[1] + weights[2], 1, 1e-12);
}

const identitySource = [0.31, 0.11, 0.025, 0.5];
const identity = applyRasterColorBalanceToPremultipliedLinearRgba(
  identitySource,
  DEFAULT_RASTER_COLOR_BALANCE_SETTINGS,
);
identity.forEach((value, index) => approx(value, identitySource[index], 1e-7));
assert.deepEqual(applyRasterColorBalanceToPremultipliedLinearRgba(
  [0.4, 0.3, 0.2, 0],
  normalizeRasterColorBalanceSettings({
    shadows: { cyanRedPercent: 100 },
  }),
), [0, 0, 0, 0]);

const allTonesRed = normalizeRasterColorBalanceSettings({
  shadows: { cyanRedPercent: 60 },
  midtones: { cyanRedPercent: 60 },
  highlights: { cyanRedPercent: 60 },
  preserveLuminosity: false,
});
const redShift = applyRasterColorBalanceToPremultipliedLinearRgba(
  [0.3, 0.2, 0.1, 0.75],
  allTonesRed,
);
assert.ok(redShift[0] > 0.3);
approx(redShift[1], 0.2, 1e-6);
approx(redShift[2], 0.1, 1e-6);
approx(redShift[3], 0.75);

const source = [0.4, 0.16, 0.04, 1];
const channelShift = {
  shadows: { cyanRedPercent: 80, magentaGreenPercent: -45, yellowBluePercent: 35 },
  midtones: { cyanRedPercent: 80, magentaGreenPercent: -45, yellowBluePercent: 35 },
  highlights: { cyanRedPercent: 80, magentaGreenPercent: -45, yellowBluePercent: 35 },
};
const withoutPreservation = applyRasterColorBalanceToPremultipliedLinearRgba(
  source,
  normalizeRasterColorBalanceSettings({ ...channelShift, preserveLuminosity: false }),
);
const withPreservation = applyRasterColorBalanceToPremultipliedLinearRgba(
  source,
  normalizeRasterColorBalanceSettings({ ...channelShift, preserveLuminosity: true }),
);
const sourceLuminance = encodedLuminance(source);
assert.ok(
  Math.abs(encodedLuminance(withPreservation) - sourceLuminance)
    < Math.abs(encodedLuminance(withoutPreservation) - sourceLuminance),
  "luminosity preservation must reduce luminance drift",
);
approx(encodedLuminance(withPreservation), sourceLuminance, 2e-6);

assert.deepEqual(rasterColorBalanceDispatchSize(2048, 2048), { x: 256, y: 256 });
assert.deepEqual(rasterColorBalanceDispatchSize(17, 9), { x: 3, y: 2 });
assert.deepEqual(rasterColorBalanceDispatchSize(Number.NaN, -4), { x: 0, y: 0 });
assert.match(rasterColorBalanceShader, /texture_storage_2d<rgba16float, write>/);
assert.match(rasterColorBalanceShader, /source\.rgb \/ alpha/);
assert.match(rasterColorBalanceShader, /parameters\.shadows\.xyz \* weights\.x/);
assert.match(rasterColorBalanceShader, /parameters\.options\.x > 0\.5/);
assert.match(
  rasterColorBalanceShader,
  /fn matchLuminance\(rgb: vec3<f32>, targetLuminance: f32\)/,
  "WGSL parameters must avoid reserved shader-language keywords",
);
assert.match(rasterColorBalanceShader, /rasterAdjustmentStraightEncodedToStored/);
assert.match(
  rasterColorBalanceShader,
  /outputOrigin:\s*vec2<u32>[\s\S]*shadows:\s*vec4<f32>[\s\S]*midtones:\s*vec4<f32>[\s\S]*highlights:\s*vec4<f32>[\s\S]*options:\s*vec4<f32>/,
  "the uniform ABI must remain five 16-byte rows",
);

const rgba8Shader = createRasterColorBalanceShader({
  layerFormat: "rgba8unorm",
  colorSpace: "encoded-srgb-premultiplied",
});
assert.match(rgba8Shader, /texture_storage_2d<rgba8unorm, write>/);
assert.match(rgba8Shader, /return straightStored;/);
assert.match(rgba8Shader, /quantizeRgba8HighFrequencyAdjacent/);
assert.match(rgba8Shader, /parameters\.quantizationSeed/);

console.log("Raster Color Balance core math and dual-storage shader contract verified.");
