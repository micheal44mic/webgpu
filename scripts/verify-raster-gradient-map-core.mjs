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
try {
  core = await server.ssrLoadModule("/src/raster-gradient-map-core.ts");
} finally {
  await server.close();
}

const {
  DEFAULT_RASTER_GRADIENT_MAP_SETTINGS,
  RASTER_GRADIENT_MAP_LUT_COMPONENTS,
  RASTER_GRADIENT_MAP_LUT_SIZE,
  RASTER_GRADIENT_MAP_MAX_STOPS,
  applyRasterGradientMapToPremultipliedLinearRgba,
  generateRasterGradientMapLut,
  normalizeRasterGradientMapSettings,
  rasterGradientMapDitherOffset,
  rasterGradientMapSettingsEqual,
  sampleRasterGradientMapLut,
  sampleRasterGradientMapStops,
} = core;

function approx(actual, expected, tolerance = 1e-6) {
  assert.equal(Number.isFinite(actual), true);
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

assert.deepEqual(DEFAULT_RASTER_GRADIENT_MAP_SETTINGS, {
  stops: [
    { position: 0, color: [0, 0, 0] },
    { position: 1, color: [1, 1, 1] },
  ],
  reverse: false,
  dither: true,
  interpolation: "perceptual",
});
assert.equal(Object.isFrozen(DEFAULT_RASTER_GRADIENT_MAP_SETTINGS), true);
assert.equal(Object.isFrozen(DEFAULT_RASTER_GRADIENT_MAP_SETTINGS.stops), true);

const normalized = normalizeRasterGradientMapSettings({
  stops: [
    { position: 1.4, color: [2, Number.NaN, -1] },
    { position: 0.5, color: [0.1, 0.2, 0.3] },
    { position: -2, color: [0.6, 0.7, 0.8] },
  ],
  reverse: true,
  dither: false,
  interpolation: "linear-light",
});
assert.deepEqual(normalized, {
  stops: [
    { position: 0, color: [0.6, 0.7, 0.8] },
    { position: 0.5, color: [0.1, 0.2, 0.3] },
    { position: 1, color: [1, 0, 0] },
  ],
  reverse: true,
  dither: false,
  interpolation: "linear-light",
});
assert.equal(Object.isFrozen(normalized.stops[0].color), true);

const tooManyStops = Array.from({ length: 20 }, (_, index) => ({
  position: (19 - index) / 19,
  color: [index / 19, 0, 0],
}));
const limited = normalizeRasterGradientMapSettings({ stops: tooManyStops });
assert.equal(limited.stops.length, RASTER_GRADIENT_MAP_MAX_STOPS);
for (let index = 1; index < limited.stops.length; index += 1) {
  assert.ok(limited.stops[index - 1].position <= limited.stops[index].position);
}
assert.deepEqual(
  normalizeRasterGradientMapSettings({ stops: [{ position: 0.5, color: [1, 0, 0] }] }),
  DEFAULT_RASTER_GRADIENT_MAP_SETTINGS,
  "fewer than two stops must fall back to the previous valid map",
);

const coincident = normalizeRasterGradientMapSettings({
  stops: [
    { position: 0, color: [0, 0, 0] },
    { position: 0.5, color: [1, 0, 0] },
    { position: 0.5, color: [0, 0, 1] },
    { position: 1, color: [1, 1, 1] },
  ],
  interpolation: "encoded-rgb",
});
assert.deepEqual(
  sampleRasterGradientMapStops(coincident.stops, 0.5, "encoded-rgb"),
  [0, 0, 1],
  "coincident stops must form a deterministic right-continuous boundary",
);

const black = [0, 0, 0];
const white = [1, 1, 1];
assert.deepEqual(
  sampleRasterGradientMapStops(DEFAULT_RASTER_GRADIENT_MAP_SETTINGS.stops, 0, "perceptual"),
  black,
);
assert.deepEqual(
  sampleRasterGradientMapStops(DEFAULT_RASTER_GRADIENT_MAP_SETTINGS.stops, 1, "perceptual"),
  white,
);
const encodedMiddle = sampleRasterGradientMapStops(
  DEFAULT_RASTER_GRADIENT_MAP_SETTINGS.stops,
  0.5,
  "encoded-rgb",
);
const linearMiddle = sampleRasterGradientMapStops(
  DEFAULT_RASTER_GRADIENT_MAP_SETTINGS.stops,
  0.5,
  "linear-light",
);
const perceptualMiddle = sampleRasterGradientMapStops(
  DEFAULT_RASTER_GRADIENT_MAP_SETTINGS.stops,
  0.5,
  "perceptual",
);
approx(encodedMiddle[0], 0.5);
assert.ok(linearMiddle[0] > encodedMiddle[0]);
assert.ok(perceptualMiddle[0] < encodedMiddle[0]);

const lut = generateRasterGradientMapLut(DEFAULT_RASTER_GRADIENT_MAP_SETTINGS);
const repeatedLut = generateRasterGradientMapLut(DEFAULT_RASTER_GRADIENT_MAP_SETTINGS);
assert.equal(
  lut.length,
  RASTER_GRADIENT_MAP_LUT_SIZE * RASTER_GRADIENT_MAP_LUT_COMPONENTS,
);
assert.deepEqual(lut, repeatedLut, "LUT generation must be deterministic");
for (let index = 3; index < lut.length; index += RASTER_GRADIENT_MAP_LUT_COMPONENTS) {
  assert.equal(lut[index], 1, "the aligned fourth LUT component is fixed");
}
assert.deepEqual(sampleRasterGradientMapLut(lut, 0), black);
assert.deepEqual(sampleRasterGradientMapLut(lut, 1), white);

const redBlue = normalizeRasterGradientMapSettings({
  stops: [
    { position: 0, color: [1, 0, 0] },
    { position: 1, color: [0, 0, 1] },
  ],
  reverse: false,
  dither: false,
  interpolation: "encoded-rgb",
});
const reversedRedBlue = normalizeRasterGradientMapSettings({
  ...redBlue,
  reverse: true,
});
assert.deepEqual(sampleRasterGradientMapLut(generateRasterGradientMapLut(redBlue), 0), [1, 0, 0]);
assert.deepEqual(
  sampleRasterGradientMapLut(generateRasterGradientMapLut(reversedRedBlue), 0),
  [0, 0, 1],
);
assert.equal(rasterGradientMapSettingsEqual(redBlue, normalizeRasterGradientMapSettings(redBlue)), true);
assert.equal(rasterGradientMapSettingsEqual(redBlue, reversedRedBlue), false);

const transparent = applyRasterGradientMapToPremultipliedLinearRgba(
  [0.8, 0.4, 0.2, 0],
  redBlue,
);
assert.deepEqual(transparent, [0, 0, 0, 0]);
const partialAlpha = applyRasterGradientMapToPremultipliedLinearRgba(
  [0.15, 0.1, 0.05, 0.5],
  redBlue,
  7,
  11,
);
assert.equal(partialAlpha[3], 0.5, "alpha must be preserved exactly");
partialAlpha.slice(0, 3).forEach((channel) => {
  assert.ok(channel >= 0 && channel <= 0.5, "output remains premultiplied");
});

const offset = rasterGradientMapDitherOffset(7, 11);
assert.equal(offset, rasterGradientMapDitherOffset(7, 11));
assert.notEqual(offset, rasterGradientMapDitherOffset(8, 11));
assert.ok(Math.abs(offset) <= (1 / 255) * 0.5);
const noDither = normalizeRasterGradientMapSettings({ ...redBlue, dither: false });
const withDither = normalizeRasterGradientMapSettings({ ...redBlue, dither: true });
const ditherSource = [0.18, 0.18, 0.18, 1];
const exact = applyRasterGradientMapToPremultipliedLinearRgba(ditherSource, noDither, 7, 11);
const varied = applyRasterGradientMapToPremultipliedLinearRgba(ditherSource, withDither, 7, 11);
assert.notDeepEqual(exact.slice(0, 3), varied.slice(0, 3));
assert.equal(varied[3], 1);

let randomState = 0x4d415000;
const randomUnit = () => {
  randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
  return randomState / 0x1_0000_0000;
};
for (const interpolation of ["perceptual", "linear-light", "encoded-rgb"]) {
  for (let fixture = 0; fixture < 24; fixture += 1) {
    const stopCount = 2 + Math.floor(randomUnit() * 11);
    const settings = normalizeRasterGradientMapSettings({
      stops: Array.from({ length: stopCount }, () => ({
        position: randomUnit(),
        color: [randomUnit(), randomUnit(), randomUnit()],
      })),
      reverse: randomUnit() > 0.5,
      dither: randomUnit() > 0.5,
      interpolation,
    });
    const prepared = generateRasterGradientMapLut(settings);
    for (let sample = 0; sample < 8; sample += 1) {
      const alpha = randomUnit();
      const result = applyRasterGradientMapToPremultipliedLinearRgba(
        [randomUnit() * alpha, randomUnit() * alpha, randomUnit() * alpha, alpha],
        settings,
        fixture * 8 + sample,
        sample * 13,
        prepared,
      );
      result.forEach((value) => assert.equal(Number.isFinite(value), true));
      assert.equal(result[3], alpha);
      result.slice(0, 3).forEach((channel) => {
        assert.ok(channel >= 0 && channel <= alpha + 1e-7);
      });
    }
  }
}

console.log("Raster Gradient Map normalization, interpolation, LUT and alpha contract verified.");
