import { readEditorHtml, readEditorStyleSource } from "../../ui-shell-source.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readEngineSource } from "../../engine-source.mjs";
import {
  RASTER_STROKE_COMPACT_SCRATCH_EXTENT,
  RASTER_STROKE_FULL_SCRATCH_EXTENT,
} from "../../../src/stroke-core.ts";

const engineSource = readEngineSource();
const gpuMemoryPanelSource = readFileSync(new URL("../../../src/gpu-memory-panel-controller.ts", import.meta.url), "utf8");
const htmlSource = readEditorHtml();
const stylesSource = readEditorStyleSource();

assert.match(engineSource, /rasterStrokeScratchExtentForWidth\(normalized\.width\)/);
assert.match(gpuMemoryPanelSource, /gpuMemoryEffectsScratchLabel/);
assert.match(htmlSource, /gpuMemoryEffectsScratchPeak/);
assert.match(engineSource, /effectsScratchPoolMiB/);
assert.match(
  engineSource,
  /export function getGpuMemoryStats\(engine: BrushEngine\): EngineGpuMemoryStats/,
);
assert.match(engineSource, /countedTotalMiB/);
assert.match(gpuMemoryPanelSource, /const GPU_MEMORY_ROWS:/);
assert.match(gpuMemoryPanelSource, /this\.delta\.textContent/);
assert.match(htmlSource, /id="gpuMemoryMonitor"/);
assert.match(stylesSource, /\.gpu-memory-panel/);

const traceControlBytes = 2_048 * 256 + 96 * 3 + 4 + 2_048 * 12 + 4;
let traceStyledPixels = 0;
for (let mipLevel = 1; mipLevel < 13; mipLevel += 1) {
  traceStyledPixels += Math.max(1, 4_096 >> mipLevel) ** 2;
}
const tracePersistentRgba16fMiB = (
  traceStyledPixels * 8
  + Math.ceil(4_096 * 4_096 / 2) * 4
  + Math.ceil(4_096 / 32) * 4_096 * 4
  + traceControlBytes
) / (1024 * 1024);
const traceCompactRgba16fMiB = tracePersistentRgba16fMiB
  + RASTER_STROKE_COMPACT_SCRATCH_EXTENT ** 2 * 8 * 2 / (1024 * 1024);
const traceFullRgba16fMiB = tracePersistentRgba16fMiB
  + RASTER_STROKE_FULL_SCRATCH_EXTENT ** 2 * 8 * 2 / (1024 * 1024);
assert.equal(Number(tracePersistentRgba16fMiB.toFixed(1)), 77.2);
assert.equal(Number(traceCompactRgba16fMiB.toFixed(1)), 93.2);
assert.equal(Number(traceFullRgba16fMiB.toFixed(1)), 141.2);

console.log("Raster Stroke core verification passed.");
