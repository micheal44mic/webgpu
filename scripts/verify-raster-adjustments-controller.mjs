import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "vite";

const root = new URL("../", import.meta.url);
const main = readFileSync(new URL("src/main.ts", root), "utf8");
const source = readFileSync(
  new URL("src/raster-adjustments-controller.ts", root),
  "utf8",
);

assert.match(main, /rasterAdjustmentsController = new RasterAdjustmentsController\(\{/);
assert.match(main, /rasterAdjustmentsController\?\.dispose\(\);/);
assert.doesNotMatch(
  main,
  /rasterLiquifySessionOpen|openRasterGaussianBlurWorkbench|applyRasterNoiseFromUi/,
  "main.ts must not own destructive adjustment transactions",
);
assert.match(source, /export type RasterAdjustmentsEnginePort = Pick</);
assert.match(source, /hasActiveHistoryEdit/);
assert.match(source, /allowsCanvasViewOperation/);
assert.doesNotMatch(source, /document\.getElementById|querySelector/);

const server = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: process.cwd(),
  server: { middlewareMode: true },
});
let RasterAdjustmentsController;
try {
  ({ RasterAdjustmentsController } = await server.ssrLoadModule(
    "/src/raster-adjustments-controller.ts",
  ));
} finally {
  await server.close();
}

class FakeClassList {
  values = new Set();
  add(...names) { for (const name of names) this.values.add(name); }
  remove(...names) { for (const name of names) this.values.delete(name); }
  toggle(name, enabled) {
    if (enabled) this.values.add(name);
    else this.values.delete(name);
  }
  contains(name) { return this.values.has(name); }
}

class FakeStyle {
  values = new Map();
  setProperty(name, value) { this.values.set(name, value); }
}

class FakeElement extends EventTarget {
  attributes = new Map();
  classList = new FakeClassList();
  style = new FakeStyle();
  dataset = {};
  hidden = false;
  disabled = false;
  checked = false;
  tabIndex = 0;
  value = "";
  textContent = "";
  className = "";
  offsetHeight = 400;
  isConnected = true;
  captures = new Set();
  focusCount = 0;

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  toggleAttribute(name, force) {
    if (force) this.setAttribute(name, "");
    else this.removeAttribute(name);
  }
  contains() { return false; }
  focus() { this.focusCount += 1; }
  blur() {}
  setPointerCapture(pointerId) { this.captures.add(pointerId); }
  releasePointerCapture(pointerId) { this.captures.delete(pointerId); }
  hasPointerCapture(pointerId) { return this.captures.has(pointerId); }
}

globalThis.HTMLElement = FakeElement;

class FakeDocument extends EventTarget {
  activeElement = null;
}

class FakeBrowser extends EventTarget {
  AbortController = globalThis.AbortController;
  document = new FakeDocument();
  innerHeight = 800;
  now = 0;
  performance = { now: () => this.now };
  queueMicrotask(callback) { queueMicrotask(callback); }
}

function event(type, properties = {}) {
  const value = new Event(type, { cancelable: true });
  for (const [name, property] of Object.entries(properties)) {
    Object.defineProperty(value, name, { configurable: true, value: property });
  }
  return value;
}

function createSheetElements() {
  return {
    sheet: new FakeElement(),
    sheetHandle: new FakeElement(),
    sheetHeader: new FakeElement(),
    controlsRegion: new FakeElement(),
  };
}

const liquifySheet = createSheetElements();
const gaussianSheet = createSheetElements();
const motionSheet = createSheetElements();
const noiseSheet = createSheetElements();
const elements = {
  canvas: new FakeElement(),
  appStatus: new FakeElement(),
  liquify: {
    openButton: new FakeElement(),
    ...liquifySheet,
    modeLabel: new FakeElement(),
    modeButtons: ["push", "twirl-right", "twirl-left", "pinch", "expand", "crystals", "edge", "reconstruct"]
      .map((mode) => {
        const button = new FakeElement();
        button.dataset.liquifyMode = mode;
        button.dataset.liquifySurface = "mobile";
        return button;
      }),
    sizeInput: new FakeElement(),
    sizeOutput: new FakeElement(),
    pressureInput: new FakeElement(),
    pressureOutput: new FakeElement(),
    distortionInput: new FakeElement(),
    distortionOutput: new FakeElement(),
    momentumInput: new FakeElement(),
    momentumOutput: new FakeElement(),
    amountInput: new FakeElement(),
    amountOutput: new FakeElement(),
    status: new FakeElement(),
    resetButton: new FakeElement(),
    cancelButton: new FakeElement(),
    applyButton: new FakeElement(),
  },
  gaussianBlur: {
    openButton: new FakeElement(),
    ...gaussianSheet,
    radiusInput: new FakeElement(),
    radiusOutput: new FakeElement(),
    status: new FakeElement(),
    cancelButton: new FakeElement(),
    applyButton: new FakeElement(),
  },
  motionBlur: {
    openButton: new FakeElement(),
    ...motionSheet,
    distanceInput: new FakeElement(),
    distanceOutput: new FakeElement(),
    angleInput: new FakeElement(),
    angleOutput: new FakeElement(),
    status: new FakeElement(),
    cancelButton: new FakeElement(),
    applyButton: new FakeElement(),
  },
  noise: {
    openButton: new FakeElement(),
    ...noiseSheet,
    amountInput: new FakeElement(),
    amountOutput: new FakeElement(),
    styleSelect: new FakeElement(),
    scaleInput: new FakeElement(),
    scaleOutput: new FakeElement(),
    octavesInput: new FakeElement(),
    octavesOutput: new FakeElement(),
    turbulenceInput: new FakeElement(),
    turbulenceOutput: new FakeElement(),
    channelsSelect: new FakeElement(),
    additiveInput: new FakeElement(),
    status: new FakeElement(),
    cancelButton: new FakeElement(),
    applyButton: new FakeElement(),
  },
};

let history = {
  canUndo: false,
  canRedo: false,
  busy: false,
  inconsistent: false,
  actionCount: 0,
  cursor: 0,
  storedBaseStamps: 0,
  logicalStampBytes: 0,
  undoBlockedReason: "",
  redoBlockedReason: "",
  openEdit: null,
};
const calls = [];
const engine = {
  getHistoryState: () => ({ ...history }),
  getPixelSelectionState: () => ({ selectedPixels: 0 }),
  getStats: () => ({
    activeLayerId: 1,
    layers: [{ id: 1, hasContent: true }],
    mixedScene: {
      selectedKey: "raster:1",
      items: [{ key: "raster:1", kind: "raster", rasterLayerId: 1 }],
    },
  }),
  async beginRasterGaussianBlur(radius) {
    calls.push(["begin-gaussian", radius]);
    history = { ...history, openEdit: "gaussian-blur" };
    return { radius };
  },
  updateRasterGaussianBlur(radius) {
    calls.push(["update-gaussian", radius]);
    return { radius };
  },
  async commitRasterGaussianBlur() {
    calls.push(["commit-gaussian"]);
    history = { ...history, openEdit: null, actionCount: history.actionCount + 1 };
    return true;
  },
  async cancelRasterGaussianBlur() {
    calls.push(["cancel-gaussian"]);
    history = { ...history, openEdit: null };
    return true;
  },
  async beginRasterMotionBlur(distance, angle) {
    calls.push(["begin-motion", distance, angle]);
    history = { ...history, openEdit: "motion-blur" };
    return { distance, angle };
  },
  updateRasterMotionBlur(distance, angle) {
    calls.push(["update-motion", distance, angle]);
    return { distance, angle };
  },
  async commitRasterMotionBlur() {
    calls.push(["commit-motion"]);
    history = { ...history, openEdit: null, actionCount: history.actionCount + 1 };
    return true;
  },
  async cancelRasterMotionBlur() {
    calls.push(["cancel-motion"]);
    history = { ...history, openEdit: null };
    return true;
  },
  async beginRasterNoise(settings) {
    calls.push(["begin-noise", settings]);
    history = { ...history, openEdit: "noise" };
    return { settings: { ...settings } };
  },
  updateRasterNoise(settings) {
    calls.push(["update-noise", settings]);
    return { settings: { ...settings } };
  },
  async commitRasterNoise() {
    calls.push(["commit-noise"]);
    history = { ...history, openEdit: null, actionCount: history.actionCount + 1 };
    return true;
  },
  async cancelRasterNoise() {
    calls.push(["cancel-noise"]);
    history = { ...history, openEdit: null };
    return true;
  },
  async beginRasterLiquify(settings) {
    calls.push(["begin-liquify", settings]);
    history = { ...history, openEdit: "liquify" };
    return { settings: { ...settings }, amount: 1 };
  },
  updateRasterLiquifySettings(settings) {
    calls.push(["update-liquify", settings]);
    return { settings: { ...settings }, amount: 1 };
  },
  setRasterLiquifyAmount(amount) {
    calls.push(["amount-liquify", amount]);
    return { settings: { mode: "push", size: 180, pressure: 0.5, distortion: 0, momentum: 0 }, amount };
  },
  endRasterLiquifyStroke(allowMomentum) {
    calls.push(["end-liquify-stroke", allowMomentum]);
    return true;
  },
  async resetRasterLiquify() {
    calls.push(["reset-liquify"]);
    return true;
  },
  async commitRasterLiquify() {
    calls.push(["commit-liquify"]);
    history = { ...history, openEdit: null, actionCount: history.actionCount + 1 };
    return true;
  },
  async cancelRasterLiquify() {
    calls.push(["cancel-liquify"]);
    history = { ...history, openEdit: null };
    return true;
  },
};

const browser = new FakeBrowser();
let currentTool = "paint";
const configuredTools = [];
let beforeOpenCount = 0;
let historyRefreshes = 0;
let thumbnails = 0;
const controller = new RasterAdjustmentsController({
  engine,
  browser,
  elements,
  isEngineReady: () => true,
  getHistoryState: () => history,
  onHistoryState: (next) => { history = next; },
  isInteractionLocked: () => false,
  isSceneBusy: () => false,
  getActiveCanvasTool: () => currentTool,
  getActiveBrushTool: () => "paint",
  configureCanvasTool: (tool) => {
    configuredTools.push(tool);
    currentTool = tool;
  },
  beforeSheetOpen: () => { beforeOpenCount += 1; },
  onSheetOpenChange: () => {},
  updateHistoryControls: () => { historyRefreshes += 1; },
  requestActiveThumbnail: () => { thumbnails += 1; },
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

assert.equal(elements.gaussianBlur.radiusInput.max, "500");
assert.equal(elements.motionBlur.distanceInput.max, "500");
assert.equal(elements.noise.amountInput.max, "300");
assert.equal(controller.isAnySurfaceOpen, false);

elements.gaussianBlur.openButton.dispatchEvent(event("click"));
await settle();
assert.equal(beforeOpenCount, 1);
assert.equal(controller.isOpen("gaussian-blur"), true);
assert.equal(history.openEdit, "gaussian-blur");
assert.equal(controller.allowsCanvasViewOperation(history), true);
assert.equal(elements.noise.openButton.disabled, true);
elements.noise.openButton.dispatchEvent(event("click"));
await settle();
assert.equal(calls.filter(([name]) => name === "begin-noise").length, 0);
elements.gaussianBlur.radiusInput.value = "42";
elements.gaussianBlur.radiusInput.dispatchEvent(event("input"));
assert.deepEqual(calls.at(-1), ["update-gaussian", 42]);
elements.gaussianBlur.applyButton.dispatchEvent(event("click"));
await settle();
assert.equal(history.openEdit, null);
assert.equal(controller.isAnySurfaceOpen, false);
assert.equal(thumbnails, 1);

elements.noise.openButton.dispatchEvent(event("click"));
await settle();
assert.equal(history.openEdit, "noise");
elements.noise.amountInput.value = "125";
elements.noise.amountInput.dispatchEvent(event("input"));
assert.equal(calls.at(-1)[0], "update-noise");
elements.noise.cancelButton.dispatchEvent(event("click"));
await settle();
assert.equal(history.openEdit, null);
assert.equal(calls.at(-1)[0], "cancel-noise");

elements.liquify.openButton.dispatchEvent(event("click"));
await settle();
assert.equal(history.openEdit, "liquify");
assert.equal(currentTool, "liquify");
elements.liquify.modeButtons[1].dispatchEvent(event("click"));
assert.equal(calls.at(-1)[0], "update-liquify");
elements.liquify.applyButton.dispatchEvent(event("click"));
await settle();
assert.equal(history.openEdit, null);
assert.deepEqual(calls.filter(([name]) => name === "end-liquify-stroke").at(-1), [
  "end-liquify-stroke",
  false,
]);
assert.equal(currentTool, "paint");
assert.equal(thumbnails, 2);

elements.motionBlur.openButton.dispatchEvent(event("click"));
await settle();
assert.equal(history.openEdit, "motion-blur");
controller.handleEngineStatus("Motion Blur preview failed", "error");
assert.equal(elements.motionBlur.applyButton.disabled, true);
assert.equal(elements.motionBlur.cancelButton.disabled, false);
elements.motionBlur.cancelButton.dispatchEvent(event("click"));
await settle();
assert.equal(history.openEdit, null);
assert.equal(controller.hasActiveHistoryEdit(history), false);
assert(historyRefreshes >= 4);

controller.dispose();
controller.dispose();
const beginCountAfterDispose = calls.filter(([name]) => name.startsWith("begin-")).length;
elements.gaussianBlur.openButton.dispatchEvent(event("click"));
await settle();
assert.equal(
  calls.filter(([name]) => name.startsWith("begin-")).length,
  beginCountAfterDispose,
);

console.log(
  "Raster adjustments: mutual exclusion, preview, commit, cancel, recovery and disposal verified.",
);
