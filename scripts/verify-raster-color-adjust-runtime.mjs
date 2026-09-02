import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const runtime = readFileSync(
  new URL("src/engine-raster-color-adjust-runtime.ts", root),
  "utf8",
);
const engine = readFileSync(new URL("src/brush-engine.ts", root), "utf8");
const history = readFileSync(new URL("src/engine-history-types.ts", root), "utf8");
const main = readFileSync(new URL("src/main.ts", root), "utf8");

assert.match(runtime, /format: engine\.layerFormat/);
assert.match(runtime, /format: profile\.layerFormat/);
assert.match(runtime, /RASTER_COLOR_ADJUST_PARAMETER_BYTE_SIZE = 32/);
assert.match(runtime, /setFloat32\(16, settings\.hueDegrees \/ 360, true\)/);
assert.match(runtime, /setFloat32\(20, settings\.saturationPercent \/ 100, true\)/);
assert.match(runtime, /setFloat32\(24, settings\.brightnessPercent \/ 100, true\)/);
assert.match(runtime, /rasterAdjustmentBytesPerPixel\(engine\.layerFormat\)/);
assert.match(runtime, /requestAnimationFrame/);
assert.match(runtime, /previewInFlight/);
assert.match(runtime, /requestedSerial/);
assert.match(runtime, /encodedSerial/);
assert.match(runtime, /await flushPreview\(engine, session\)/);
assert.match(runtime, /filter: "color-adjust"/);
assert.match(runtime, /DESTRUCTIVE_RASTER_COLOR_ADJUST_RGBA8_PRECISION/);
assert.match(runtime, /engine\.layerFormat === "rgba8unorm"/);
assert.match(runtime, /createLayerColdStorageCandidate/);
assert.match(runtime, /commitHistoryActionAtomically/);
assert.match(runtime, /selected\?\.kind !== "raster"/);
assert.match(runtime, /selected\.rasterLayerId !== record\.id/);
assert.match(runtime, /pixelSelectionState\.selectedPixels > 0/);
assert.doesNotMatch(runtime, /requires an RGBA16F document/);
assert.match(runtime, /const quantizationSeed = engine\.nextHistoryActionId >>> 0/);
assert.doesNotMatch(runtime, /histogram|MAP_READ|copyBufferToBuffer|curveLut/i);

assert.match(history, /filter: "color-adjust"/);
assert.match(history, /settings: RasterColorAdjustSettings/);
assert.match(engine, /activeRasterColorAdjustSession: ActiveRasterColorAdjustSession \| null/);
assert.match(engine, /abandonRasterColorAdjustSession\(this\)/);
assert.match(engine, /if \(this\.activeRasterColorAdjustSession\) return "color-adjust"/);
assert.match(engine, /prewarmRasterColorAdjustResources/);
assert.doesNotMatch(main, /prewarmRasterColorAdjustResources\(\)/);
assert.match(
  runtime,
  /export async function beginRasterColorAdjust[\s\S]{0,6000}const shared = await requireSharedResources\(engine\.device, \{[\s\S]{0,180}documentStorageColorSpace/,
  "opening Color Adjust must compile its shared resources on demand",
);

const curveGateCount = (engine.match(/activeRasterToneCurvesSession/g) ?? []).length;
const colorGateCount = (engine.match(/activeRasterColorAdjustSession/g) ?? []).length;
assert.ok(colorGateCount >= curveGateCount, "Color Adjust must be present in every Curves engine gate.");

console.log("Raster Color Adjust transaction, history, target and engine gates verified.");
