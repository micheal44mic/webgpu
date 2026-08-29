import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const runtime = read("src/engine-raster-color-balance-runtime.ts");
const engine = read("src/brush-engine.ts");
const history = read("src/engine-history-types.ts");
const main = read("src/main.ts");
const actionMatrix = read("src/history-action-matrix.ts");
const engineSource = read("scripts/engine-source.mjs");

assert.match(runtime, /format: "rgba16float"/);
assert.match(runtime, /RASTER_COLOR_BALANCE_PARAMETER_BYTE_SIZE = 80/);
for (const offset of [16, 32, 48]) {
  assert.match(runtime, new RegExp(`writeTone\\(${offset}, settings\\.`));
}
assert.match(runtime, /setFloat32\(64, settings\.preserveLuminosity \? 1 : 0, true\)/);
assert.match(runtime, /sourceBounds\.width \* sourceBounds\.height \* BYTES_PER_RGBA16F_PIXEL/);
assert.match(runtime, /requestAnimationFrame/);
assert.match(runtime, /previewInFlight/);
assert.match(runtime, /requestedSerial/);
assert.match(runtime, /encodedSerial/);
assert.match(runtime, /await flushPreview\(engine, session\)/);
assert.match(runtime, /filter: "color-balance"/);
assert.match(runtime, /settings: copySettings\(session\.settings\)/);
assert.match(runtime, /precision: DESTRUCTIVE_RASTER_COLOR_BALANCE_PRECISION/);
assert.match(runtime, /createLayerColdStorageCandidate/);
assert.match(runtime, /commitHistoryActionAtomically/);
assert.match(runtime, /selected\?\.kind !== "raster"/);
assert.match(runtime, /selected\.rasterLayerId !== record\.id/);
assert.match(runtime, /pixelSelectionState\.selectedPixels > 0/);
assert.match(runtime, /layerFormat !== "rgba16float"/);
assert.match(runtime, /isRasterColorBalanceIdentity\(session\.settings\)/);
assert.doesNotMatch(runtime, /histogram|MAP_READ|copyBufferToBuffer|curveLut/i);

assert.match(history, /filter: "color-balance"/);
assert.match(history, /settings: RasterColorBalanceSettings/);
assert.match(engine, /activeRasterColorBalanceSession: ActiveRasterColorBalanceSession \| null/);
assert.match(engine, /abandonRasterColorBalanceSession\(this\)/);
assert.match(engine, /if \(this\.activeRasterColorBalanceSession\) return "color-balance"/);
assert.match(engine, /prewarmRasterColorBalanceResources/);
assert.doesNotMatch(main, /prewarmRasterColorBalanceResources\(\)/);
assert.match(
  runtime,
  /export async function beginRasterColorBalance[\s\S]{0,6000}const shared = await requireSharedResources\(engine\.device\)/,
  "opening Color Balance must compile its shared resources on demand",
);
assert.match(engineSource, /engine-raster-color-balance-runtime\.ts/);

const gateFiles = [
  "src/brush-engine.ts",
  "src/engine-history-runtime.ts",
  "src/engine-history-storage-host.ts",
  "src/engine-mixed-scene-group-transform-runtime.ts",
  "src/engine-reports.ts",
  "src/history-maintenance-engine-adapter.ts",
  "src/history-maintenance-runtime.ts",
];
for (const path of gateFiles) {
  const source = read(path);
  assert.match(source, /activeRasterToneCurvesSession/, `${path} must gate Curves sessions`);
  assert.match(source, /activeRasterColorAdjustSession/, `${path} must gate Color Adjust sessions`);
  assert.match(
    source,
    /activeRasterColorBalanceSession/,
    `${path} must gate Color Balance sessions`,
  );
}

for (const method of [
  "beginRasterColorBalance",
  "updateRasterColorBalance",
  "commitRasterColorBalance",
  "cancelRasterColorBalance",
]) {
  assert.match(actionMatrix, new RegExp(`"${method}"`));
}
console.log("Raster Color Balance transaction, history, target and engine gates verified.");
