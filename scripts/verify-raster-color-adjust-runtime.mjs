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

assert.match(runtime, /format: "rgba16float"/);
assert.match(runtime, /RASTER_COLOR_ADJUST_PARAMETER_BYTE_SIZE = 32/);
assert.match(runtime, /setFloat32\(16, settings\.hueDegrees \/ 360, true\)/);
assert.match(runtime, /setFloat32\(20, settings\.saturationPercent \/ 100, true\)/);
assert.match(runtime, /setFloat32\(24, settings\.brightnessPercent \/ 100, true\)/);
assert.match(runtime, /sourceBounds\.width \* sourceBounds\.height \* BYTES_PER_RGBA16F_PIXEL/);
assert.match(runtime, /requestAnimationFrame/);
assert.match(runtime, /previewInFlight/);
assert.match(runtime, /requestedSerial/);
assert.match(runtime, /encodedSerial/);
assert.match(runtime, /await flushPreview\(engine, session\)/);
assert.match(runtime, /filter: "color-adjust"/);
assert.match(runtime, /precision: DESTRUCTIVE_RASTER_COLOR_ADJUST_PRECISION/);
assert.match(runtime, /createLayerColdStorageCandidate/);
assert.match(runtime, /commitHistoryActionAtomically/);
assert.match(runtime, /selected\?\.kind !== "raster"/);
assert.match(runtime, /selected\.rasterLayerId !== record\.id/);
assert.match(runtime, /pixelSelectionState\.selectedPixels > 0/);
assert.match(runtime, /layerFormat !== "rgba16float"/);
assert.doesNotMatch(runtime, /histogram|MAP_READ|copyBufferToBuffer|curveLut/i);

assert.match(history, /filter: "color-adjust"/);
assert.match(history, /settings: RasterColorAdjustSettings/);
assert.match(engine, /activeRasterColorAdjustSession: ActiveRasterColorAdjustSession \| null/);
assert.match(engine, /abandonRasterColorAdjustSession\(this\)/);
assert.match(engine, /if \(this\.activeRasterColorAdjustSession\) return "color-adjust"/);
assert.match(engine, /prewarmRasterColorAdjustResources/);
assert.match(main, /await engine\.prewarmRasterToneCurvesResources\(\);\s*await engine\.prewarmRasterColorAdjustResources\(\);/);

const curveGateCount = (engine.match(/activeRasterToneCurvesSession/g) ?? []).length;
const colorGateCount = (engine.match(/activeRasterColorAdjustSession/g) ?? []).length;
assert.ok(colorGateCount >= curveGateCount, "Color Adjust must be present in every Curves engine gate.");

console.log("Raster Color Adjust transaction, history, target and engine gates verified.");
