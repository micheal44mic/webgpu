import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const runtime = read("src/engine-raster-gradient-map-runtime.ts");
const core = read("src/raster-gradient-map-core.ts");
const shader = read("src/raster-gradient-map-shaders.ts");

assert.match(
  runtime,
  /beginRasterGradientMap\(\s*engine: RasterGradientMapEngineHost,\s*initial: RasterGradientMapSettings,/,
  "begin requires a chosen gradient and must not apply a hidden default map",
);
assert.doesNotMatch(
  runtime,
  /initial: RasterGradientMapSettings\s*=/,
  "the chooser must provide settings explicitly",
);
assert.match(runtime, /initial\.stops\.length < RASTER_GRADIENT_MAP_MIN_STOPS/);
assert.match(runtime, /Choose a gradient with at least two color stops first/);
assert.match(runtime, /format: engine\.layerFormat/);
assert.match(runtime, /format: profile\.layerFormat/);
assert.match(runtime, /RASTER_GRADIENT_MAP_PARAMETER_BYTE_SIZE = 32/);
assert.match(runtime, /RASTER_GRADIENT_MAP_LUT_SIZE[\s\S]*RASTER_GRADIENT_MAP_LUT_COMPONENTS/);
assert.match(runtime, /type: "read-only-storage"/);
assert.match(runtime, /generateRasterGradientMapLut\(settings\)/);
assert.match(runtime, /setUint32\(16, settings\.dither \? 1 : 0, true\)/);
assert.match(runtime, /rasterAdjustmentBytesPerPixel\(engine\.layerFormat\)/);

assert.match(runtime, /requestAnimationFrame/);
assert.match(runtime, /previewInFlight/);
assert.match(runtime, /requestedSerial/);
assert.match(runtime, /encodedSerial/);
assert.match(runtime, /await flushPreview\(engine, session\)/);
assert.match(runtime, /rasterGradientMapSettingsEqual\(settings, session\.settings\)/);

assert.match(runtime, /filter: "gradient-map"/);
assert.match(runtime, /settings: copySettings\(session\.settings\)/);
assert.match(runtime, /lutSize: RASTER_GRADIENT_MAP_LUT_SIZE/);
assert.match(runtime, /DESTRUCTIVE_RASTER_GRADIENT_MAP_RGBA8_PRECISION/);
assert.match(runtime, /engine\.layerFormat === "rgba8unorm"/);
assert.match(runtime, /createLayerColdStorageCandidate/);
assert.match(runtime, /commitHistoryActionAtomically\(engine, action\)/);
assert.match(
  runtime,
  /atomic history boundary records source provenance before detaching/,
  "the imported-source invalidation boundary must remain explicit",
);

assert.match(runtime, /selected\?\.kind !== "raster"/);
assert.match(runtime, /selected\.rasterLayerId !== record\.id/);
assert.match(runtime, /pixelSelectionState\.selectedPixels > 0/);
assert.doesNotMatch(runtime, /requires an RGBA16F document/);
assert.match(runtime, /const quantizationSeed = engine\.nextHistoryActionId >>> 0/);
assert.match(runtime, /record\.storageTileMask\.slice\(\)/);
assert.match(runtime, /copyTextureToTexture\(\s*\{ texture: session\.sourceTexture \}/);
assert.match(runtime, /Gradient Map canceled: the original pixels were restored/);
assert.match(runtime, /Gradient Map applied to the pixels: one Undo step/);

assert.doesNotMatch(runtime, /MAP_READ|copyBufferToBuffer|histogram/i);
assert.doesNotMatch(shader, /sampler|textureSample/i);
assert.match(core, /RASTER_GRADIENT_MAP_MAX_STOPS = 12/);
assert.match(core, /RASTER_GRADIENT_MAP_LUT_SIZE = 1024/);

console.log("Raster Gradient Map transaction, history shape, target and recovery verified.");
