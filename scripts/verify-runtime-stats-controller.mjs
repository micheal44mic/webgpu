import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RuntimeStatsController } from "../src/runtime-stats-controller.ts";

const makeElement = () => ({ textContent: "" });
const elements = {
  renderingModeMemoryHint: makeElement(),
  fps: makeElement(),
  cpu: makeElement(),
  stamps: makeElement(),
  avoidedDraws: makeElement(),
  gpu: makeElement(),
};
const stats = {
  fps: 60,
  lastCpuFrameMs: 2.5,
  totalBaseStamps: 1234,
  avoidedLogicalDraws: 56,
  gpuLabel: "GPU ready",
  fillReferenceLayerMiB: 8,
  referenceLayerId: 2,
  gpuMemory: {
    fillRendererMiB: 4,
    blendRendererMiB: 5,
    lightGlazeMiB: 6,
    countedTotalMiB: 64,
  },
};
let activeCanvasTool = "paint";
let activeBrushTool = "paint";
let blendMode = "light-glaze";
let engineReady = true;
let engineReads = 0;
let pollingThrows = false;
let intervalCallback = null;
let intervalStarts = 0;
let clearedTimer = null;
let layerUpdates = 0;
let gpuUpdates = 0;
const diagnostics = [];
const pollingErrors = [];
const browser = {
  setInterval(callback) {
    intervalStarts += 1;
    intervalCallback = callback;
    return 17;
  },
  clearInterval(timer) { clearedTimer = timer; },
};
const document = { hidden: false };

const controller = new RuntimeStatsController({
  engine: {
    getStats() {
      engineReads += 1;
      if (pollingThrows) throw new Error("stats failed");
      return stats;
    },
  },
  browser,
  document,
  elements,
  isEngineReady: () => engineReady,
  getActiveCanvasTool: () => activeCanvasTool,
  getActiveBrushTool: () => activeBrushTool,
  getBrushBlendMode: () => blendMode,
  renderLayers: () => { layerUpdates += 1; },
  updateGpuMemory: () => { gpuUpdates += 1; },
  recordDiagnostic: (...args) => diagnostics.push(args),
  onPollingError: (error) => pollingErrors.push(error),
});

controller.update(stats);
assert.equal(elements.fps.textContent, "60");
assert.equal(elements.cpu.textContent, "2.50 ms");
assert.equal(elements.stamps.textContent, "1234");
assert.equal(elements.gpu.textContent, "GPU ready");
assert.match(elements.renderingModeMemoryHint.textContent, /Light Glaze/);
assert.equal(layerUpdates, 1);
assert.equal(gpuUpdates, 1);

activeCanvasTool = "fill";
controller.update(stats);
assert.match(elements.renderingModeMemoryHint.textContent, /Riempimento.*riferimento hot/);
activeCanvasTool = "paint";
activeBrushTool = "blend";
controller.update(stats);
assert.match(elements.renderingModeMemoryHint.textContent, /Blend dry/);
activeCanvasTool = "eraser";
activeBrushTool = "paint";
controller.update(stats);
assert.match(elements.renderingModeMemoryHint.textContent, /Gomma destination-out.*64[,.]0 MiB/);
activeCanvasTool = "paint";
activeBrushTool = "paint";
blendMode = "intense-blending";
controller.update(stats);
assert.match(elements.renderingModeMemoryHint.textContent, /Intense Blending.*stamp fisici source-over/);

controller.start();
controller.start();
assert.equal(intervalStarts, 1, "Polling must be idempotent.");
document.hidden = true;
intervalCallback();
assert.equal(engineReads, 0, "Hidden documents must not poll GPU stats.");
document.hidden = false;
engineReady = false;
intervalCallback();
assert.equal(engineReads, 0, "The engine readiness gate must be explicit.");
engineReady = true;
pollingThrows = true;
intervalCallback();
intervalCallback();
assert.equal(diagnostics.length, 1, "A repeated polling fault must be reported once.");
assert.equal(pollingErrors.length, 1);
controller.dispose();
assert.equal(clearedTimer, 17);

const source = readFileSync(new URL("../src/runtime-stats-controller.ts", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
assert.doesNotMatch(source, /document\.getElementById|\bwindow\./);
assert.match(main, /new RuntimeStatsController\(\{/);
assert.doesNotMatch(main, /function updateStats|function refreshRuntimeStats|statsPollingTimer/);

console.log("Runtime stats controller: rendering, polling, diagnostics and disposal verified.");
