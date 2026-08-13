import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GpuMemoryPanelController } from "../src/gpu-memory-panel-controller.ts";

class FakeClassList {
  values = new Set();
  add(value) { this.values.add(value); }
  toggle(value, force) {
    if (force) this.values.add(value);
    else this.values.delete(value);
  }
}

class FakeElement extends EventTarget {
  constructor(ownerDocument) {
    super();
    this.ownerDocument = ownerDocument;
  }
  hidden = false;
  disabled = false;
  textContent = "";
  title = "";
  dataset = {};
  style = {};
  classList = new FakeClassList();
  parentElement = null;
  attributes = new Map();
  focused = false;
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  replaceChildren(...children) { this.children = children; }
  append(...children) { this.children = [...(this.children ?? []), ...children]; }
  focus() { this.focused = true; }
}

const document = {
  createElement() { return new FakeElement(document); },
};
const elements = new Map();
const root = new FakeElement(document);
root.querySelector = (selector) => {
  const id = selector.startsWith("#") ? selector.slice(1) : selector;
  if (!elements.has(id)) elements.set(id, new FakeElement(document));
  return elements.get(id);
};
const memoryStat = new FakeElement(document);

const gpuMemory = new Proxy({
  countedTotalMiB: 64,
  registeredCurrentMiB: 64,
  registeredPeakMiB: 70,
  historyGpuPageCount: 2,
  historyGpuUsedMiB: 3,
  layers: [],
  rasterBevelFieldAllocationBounds: null,
  rasterBevelFieldValidBounds: null,
  rasterBevelFieldBounded: false,
  governorZone: "green",
  governorUsedMiB: 64,
  governorCeilingMiB: 512,
  governorHardCapMiB: 640,
  governorHeadroomMiB: 448,
  governorReclaimableMiB: 0,
  governorReservedMiB: 0,
}, {
  get(target, key) { return key in target ? target[key] : 0; },
});
const stats = {
  gpuMemory,
  rasterStrokeStyle: { enabled: false, width: 0 },
  layerStorageStudy: {
    layers: [],
    tileCount: 16,
    tileSizePx: 256,
    eagerFullRawMiB: 0,
    actualRawMiB: 0,
    projectedAlignedBboxRawMiB: 0,
    alignedBboxSavingsMiB: 0,
  },
};
const telemetry = new Proxy({
  localStorage: new Proxy({
    committedBytes: 0,
    backend: "memory",
    ready: true,
    writable: true,
    busy: "idle",
    storedOnlyPayloads: 0,
    storedPayloads: 0,
    segments: 0,
    storedActions: 0,
    spillsCommitted: 0,
    spillFailures: 0,
    hydrationsCompleted: 0,
    hydrationFailures: 0,
    lastError: null,
  }, { get(target, key) { return key in target ? target[key] : 0; } }),
  floorCursor: 0,
  budgetCheckpointBlocked: false,
  totalBytes: 0,
  budgetBytes: 96 * 1024 * 1024,
  baseBudgetBytes: 96 * 1024 * 1024,
  effectsWorkingSetBytes: 0,
}, { get(target, key) { return key in target ? target[key] : 0; } });
let statsReads = 0;
const engine = {
  getStats() { statsReads += 1; return stats; },
  getHistoryMaintenanceTelemetry: () => telemetry,
  getHistoryState: () => ({ cursor: 0, actionCount: 0 }),
  measuredGpuMemory: () => ({
    currentBytes: 64 * 1024 * 1024,
    peakBytes: 70 * 1024 * 1024,
    textureCount: 1,
    bufferCount: 1,
    createdCount: 2,
    destroyedCount: 0,
    collectedCount: 0,
    unmeasurableCount: 0,
    unmeasurableFormats: [],
    categories: [],
  }),
};
const browser = {
  AbortController,
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
};
const controller = new GpuMemoryPanelController({
  engine,
  browser,
  root,
  memoryStat,
  documentWidth: 4096,
  documentHeight: 4096,
  isEngineReady: () => true,
  getLastHistoryFailure: () => null,
});

const panel = root.querySelector("#gpuMemoryPanel");
const toggle = root.querySelector("#gpuMemoryToggle");
const close = root.querySelector("#gpuMemoryClose");
assert.equal(panel.hidden, true);
assert.equal(toggle.getAttribute("aria-expanded"), "false");
controller.update(stats);
assert.equal(statsReads, 0, "a closed panel must defer its expensive rendering");
toggle.dispatchEvent(new Event("click"));
assert.equal(panel.hidden, false);
assert.equal(statsReads, 1, "opening a dirty panel must render the latest engine snapshot");
assert.match(memoryStat.textContent, /64,0 MiB/);
assert.match(root.querySelector("#gpuMemoryHistoryDiagnostics").textContent, /History/);

gpuMemory.registeredCurrentMiB = 66;
controller.update(stats);
assert.equal(root.querySelector("#gpuMemoryDelta").hidden, false);
assert.match(root.querySelector("#gpuMemoryDelta").textContent, /\+2,0 MiB/);
close.dispatchEvent(new Event("click"));
assert.equal(panel.hidden, true);
assert.equal(toggle.focused, true);

controller.dispose();
toggle.dispatchEvent(new Event("click"));
assert.equal(panel.hidden, true, "dispose must remove panel listeners");

const source = readFileSync(
  new URL("../src/gpu-memory-panel-controller.ts", import.meta.url),
  "utf8",
);
const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
assert.doesNotMatch(source, /document\.getElementById|window\./);
assert.match(source, /this\.options\.root\.querySelector/);
assert.match(main, /new GpuMemoryPanelController\(\{/);
assert.doesNotMatch(main, /function updateGpuMemoryPanel|gpuMemoryPanelOpen/);

console.log("GPU memory panel: deferred rendering, telemetry, delta, focus and disposal verified.");
