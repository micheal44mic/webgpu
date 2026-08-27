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
  children = [];

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  toggleAttribute(name, force) {
    if (force) this.setAttribute(name, "");
    else this.removeAttribute(name);
  }
  contains() { return false; }
  querySelector() { return null; }
  focus() { this.focusCount += 1; }
  blur() {}
  setPointerCapture(pointerId) { this.captures.add(pointerId); }
  releasePointerCapture(pointerId) { this.captures.delete(pointerId); }
  hasPointerCapture(pointerId) { return this.captures.has(pointerId); }
  replaceChildren(...children) { this.children = children; }
  get lastElementChild() { return this.children.at(-1) ?? null; }
  getBoundingClientRect() {
    return { left: 0, top: 0, right: 512, bottom: 512, width: 512, height: 512 };
  }
}

globalThis.HTMLElement = FakeElement;

class FakeDocument extends EventTarget {
  activeElement = null;
  createElement() { return new FakeElement(); }
}

class FakeBrowser extends EventTarget {
  AbortController = globalThis.AbortController;
  document = new FakeDocument();
  innerHeight = 800;
  innerWidth = 1200;
  now = 0;
  performance = { now: () => this.now };
  nextAnimationFrameId = 1;
  animationFrames = new Map();
  confirmations = [];
  confirmResult = true;
  queueMicrotask(callback) { queueMicrotask(callback); }
  confirm(message) {
    this.confirmations.push(message);
    return this.confirmResult;
  }
  requestAnimationFrame(callback) {
    const id = this.nextAnimationFrameId++;
    this.animationFrames.set(id, callback);
    return id;
  }
  cancelAnimationFrame(id) { this.animationFrames.delete(id); }
  setTimeout(callback, delay) { return globalThis.setTimeout(callback, delay); }
  clearTimeout(id) { globalThis.clearTimeout(id); }
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
const glassSheet = createSheetElements();
const curvesSheet = createSheetElements();
const spatialBlurModeButtons = ["add", "adjust", "remove"].map((mode) => {
  const button = new FakeElement();
  button.dataset.spatialBlurMode = mode;
  return button;
});
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
  spatialBlur: {
    openButton: new FakeElement(),
    overlay: new FakeElement(),
    pinLayer: new FakeElement(),
    topBar: new FakeElement(),
    dock: new FakeElement(),
    modeButtons: spatialBlurModeButtons,
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
  glass: {
    openButton: new FakeElement(),
    ...glassSheet,
    distortionInput: new FakeElement(),
    distortionOutput: new FakeElement(),
    smoothnessInput: new FakeElement(),
    smoothnessOutput: new FakeElement(),
    scaleInput: new FakeElement(),
    scaleOutput: new FakeElement(),
    invertInput: new FakeElement(),
    reseedButton: new FakeElement(),
    status: new FakeElement(),
    cancelButton: new FakeElement(),
    applyButton: new FakeElement(),
  },
  curves: {
    openButton: new FakeElement(),
    ...curvesSheet,
    canvas: new FakeElement(),
    channelSelect: new FakeElement(),
    inputValue: new FakeElement(),
    outputValue: new FakeElement(),
    autoButton: new FakeElement(),
    resetButton: new FakeElement(),
    deleteButton: new FakeElement(),
    status: new FakeElement(),
    cancelButton: new FakeElement(),
    applyButton: new FakeElement(),
  },
  colorAdjust: {
    openButton: new FakeElement(),
    surface: new FakeElement(),
    hueInput: new FakeElement(),
    hueOutput: new FakeElement(),
    saturationInput: new FakeElement(),
    saturationOutput: new FakeElement(),
    brightnessInput: new FakeElement(),
    brightnessOutput: new FakeElement(),
    status: new FakeElement(),
    menu: new FakeElement(),
    resetButton: new FakeElement(),
    cancelButton: new FakeElement(),
  },
  colorBalance: {
    openButton: new FakeElement(),
    surface: new FakeElement(),
    cyanRedInput: new FakeElement(),
    cyanRedOutput: new FakeElement(),
    magentaGreenInput: new FakeElement(),
    magentaGreenOutput: new FakeElement(),
    yellowBlueInput: new FakeElement(),
    yellowBlueOutput: new FakeElement(),
    toneButton: new FakeElement(),
    toneButtonLabel: new FakeElement(),
    settingsMenu: new FakeElement(),
    toneButtons: ["shadows", "midtones", "highlights"].map((tone) => {
      const button = new FakeElement();
      button.dataset.colorBalanceTone = tone;
      return button;
    }),
    preserveLuminosityButton: new FakeElement(),
    status: new FakeElement(),
    actionMenu: new FakeElement(),
    resetButton: new FakeElement(),
    cancelButton: new FakeElement(),
  },
};
elements.colorBalance.settingsMenu.hidden = true;
elements.colorBalance.actionMenu.hidden = true;

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
let glassSettings = null;
let selectedItem = { key: "raster:1", kind: "raster", rasterLayerId: 1 };
let additionalSceneItems = [];
let multiSelectionActive = false;
let curvesCommitChanged = true;
let curvesRasterizationPromise = null;
let colorAdjustSettings = null;
let colorBalanceSettings = null;
const engine = {
  documentWidth: 512,
  documentHeight: 512,
  getVectorTextViewState: () => ({
    canvasWidth: 512,
    canvasHeight: 512,
    centerX: 256,
    centerY: 256,
    zoom: 1,
    rotationCos: 1,
    rotationSin: 0,
  }),
  toLayerPoint: ({ clientX, clientY, pressure, timeMs }) => ({
    x: clientX,
    y: clientY,
    pressure,
    timeMs,
  }),
  getHistoryState: () => ({ ...history }),
  getPixelSelectionState: () => ({ selectedPixels: 0 }),
  getStats: () => ({
    activeLayerId: 1,
    layers: [{ id: 1, hasContent: true }],
    mixedScene: {
      selectedKey: selectedItem.key,
      items: [selectedItem, ...additionalSceneItems],
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
  async beginRasterSpatialBlur(pins) {
    calls.push(["begin-spatial-blur", pins]);
    history = { ...history, openEdit: "spatial-blur" };
    return { pins: pins.map((pin) => ({ ...pin })) };
  },
  updateRasterSpatialBlur(pins) {
    calls.push(["update-spatial-blur", pins]);
    return { pins: pins.map((pin) => ({ ...pin })) };
  },
  async commitRasterSpatialBlur() {
    calls.push(["commit-spatial-blur"]);
    history = { ...history, openEdit: null, actionCount: history.actionCount + 1 };
    return true;
  },
  async cancelRasterSpatialBlur() {
    calls.push(["cancel-spatial-blur"]);
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
  async beginRasterGlass(settings) {
    calls.push(["begin-glass", settings]);
    glassSettings = { ...settings };
    history = { ...history, openEdit: "glass" };
    return { settings: { ...glassSettings }, seed: { low: 1, high: 2 } };
  },
  updateRasterGlass(settings) {
    calls.push(["update-glass", settings]);
    glassSettings = { ...settings };
    return { settings: { ...glassSettings }, seed: { low: 1, high: 2 } };
  },
  reseedRasterGlass() {
    calls.push(["reseed-glass"]);
    return { settings: { ...glassSettings }, seed: { low: 3, high: 4 } };
  },
  async commitRasterGlass() {
    calls.push(["commit-glass"]);
    history = { ...history, openEdit: null, actionCount: history.actionCount + 1 };
    return true;
  },
  async cancelRasterGlass() {
    calls.push(["cancel-glass"]);
    history = { ...history, openEdit: null };
    return true;
  },
  async beginRasterToneCurves(curves) {
    calls.push(["begin-curves", curves]);
    history = { ...history, openEdit: "curves" };
    return {
      curves,
      histogram: new Uint32Array(1024),
      sourceBounds: { x: 0, y: 0, width: 512, height: 512 },
    };
  },
  updateRasterToneCurves(curves) {
    calls.push(["update-curves", curves]);
    return {
      curves,
      histogram: new Uint32Array(1024),
      sourceBounds: { x: 0, y: 0, width: 512, height: 512 },
    };
  },
  async commitRasterToneCurves() {
    calls.push(["commit-curves"]);
    history = {
      ...history,
      openEdit: null,
      actionCount: history.actionCount + (curvesCommitChanged ? 1 : 0),
    };
    return curvesCommitChanged;
  },
  async cancelRasterToneCurves() {
    calls.push(["cancel-curves"]);
    history = { ...history, openEdit: null };
    return true;
  },
  async beginRasterColorAdjust(settings) {
    calls.push(["begin-color-adjust", settings]);
    colorAdjustSettings = { ...settings };
    history = { ...history, openEdit: "color-adjust" };
    return {
      settings: { ...colorAdjustSettings },
      sourceBounds: { x: 0, y: 0, width: 512, height: 512 },
    };
  },
  updateRasterColorAdjust(settings) {
    calls.push(["update-color-adjust", settings]);
    colorAdjustSettings = { ...settings };
    return {
      settings: { ...colorAdjustSettings },
      sourceBounds: { x: 0, y: 0, width: 512, height: 512 },
    };
  },
  async commitRasterColorAdjust() {
    calls.push(["commit-color-adjust"]);
    history = { ...history, openEdit: null, actionCount: history.actionCount + 1 };
    return true;
  },
  async cancelRasterColorAdjust() {
    calls.push(["cancel-color-adjust"]);
    history = { ...history, openEdit: null };
    return true;
  },
  async beginRasterColorBalance(settings) {
    calls.push(["begin-color-balance", settings]);
    colorBalanceSettings = structuredClone(settings);
    history = { ...history, openEdit: "color-balance" };
    return {
      settings: structuredClone(colorBalanceSettings),
      sourceBounds: { x: 0, y: 0, width: 512, height: 512 },
    };
  },
  updateRasterColorBalance(settings) {
    calls.push(["update-color-balance", settings]);
    colorBalanceSettings = structuredClone(settings);
    return {
      settings: structuredClone(colorBalanceSettings),
      sourceBounds: { x: 0, y: 0, width: 512, height: 512 },
    };
  },
  async commitRasterColorBalance() {
    calls.push(["commit-color-balance"]);
    history = { ...history, openEdit: null, actionCount: history.actionCount + 1 };
    return true;
  },
  async cancelRasterColorBalance() {
    calls.push(["cancel-color-balance"]);
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
  isMultiSelectionActive: () => multiSelectionActive,
  getActiveCanvasTool: () => currentTool,
  getActiveBrushTool: () => "paint",
  configureCanvasTool: (tool) => {
    configuredTools.push(tool);
    currentTool = tool;
  },
  confirmCurvesVectorRasterization: (message) => browser.confirm(message),
  rasterizeVectorLayersForCurves: async () => {
    const vectorCount = [selectedItem, ...additionalSceneItems].filter(
      (item) => item.kind === "text" || item.kind === "svg",
    ).length;
    calls.push(["rasterize-curves-vectors", vectorCount]);
    if (curvesRasterizationPromise) await curvesRasterizationPromise;
    if (selectedItem.kind === "text" || selectedItem.kind === "svg") {
      selectedItem = { key: "raster:1", kind: "raster", rasterLayerId: 1 };
    }
    additionalSceneItems = [];
    return vectorCount;
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
assert.equal(elements.glass.scaleInput.min, "0");
assert.equal(elements.glass.scaleInput.max, "100");
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

elements.spatialBlur.openButton.dispatchEvent(event("click"));
await settle();
assert.equal(history.openEdit, "spatial-blur");
assert.equal(controller.isOpen("spatial-blur"), true);
assert.equal(currentTool, "pan", "Point Blur must switch the canvas to Move");
assert.equal(configuredTools.at(-1), "pan");
assert.equal(elements.spatialBlur.overlay.hidden, false);
assert.equal(elements.spatialBlur.pinLayer.children.length, 1);
assert.equal(spatialBlurModeButtons[0].getAttribute("aria-checked"), "true");

assert.equal(controller.beginSpatialBlurPointer({
  pointerId: 41,
  pointerType: "mouse",
  clientX: 100,
  clientY: 100,
}), true);
controller.endSpatialBlurPointer({
  pointerId: 41,
  pointerType: "mouse",
  clientX: 100,
  clientY: 100,
}, true);
assert.equal(calls.at(-1)[0], "update-spatial-blur");
assert.equal(calls.at(-1)[1].length, 2);

spatialBlurModeButtons[1].dispatchEvent(event("click"));
assert.equal(spatialBlurModeButtons[1].getAttribute("aria-checked"), "true");
controller.beginSpatialBlurPointer({
  pointerId: 42,
  pointerType: "mouse",
  clientX: 100,
  clientY: 100,
});
controller.updateSpatialBlurPointer({
  pointerId: 42,
  pointerType: "mouse",
  clientX: 100,
  clientY: 90,
});
controller.endSpatialBlurPointer({
  pointerId: 42,
  pointerType: "mouse",
  clientX: 100,
  clientY: 90,
}, true);
assert.equal(calls.at(-1)[0], "update-spatial-blur");
assert.equal(calls.at(-1)[1][1].radius, 25);

spatialBlurModeButtons[2].dispatchEvent(event("click"));
controller.beginSpatialBlurPointer({
  pointerId: 43,
  pointerType: "mouse",
  clientX: 100,
  clientY: 100,
});
controller.endSpatialBlurPointer({
  pointerId: 43,
  pointerType: "mouse",
  clientX: 100,
  clientY: 100,
}, true);
assert.equal(calls.at(-1)[0], "update-spatial-blur");
assert.equal(calls.at(-1)[1].length, 1);

elements.spatialBlur.applyButton.dispatchEvent(event("click"));
await settle();
assert.equal(history.openEdit, null);
assert.equal(calls.at(-1)[0], "commit-spatial-blur");
assert.equal(elements.spatialBlur.overlay.hidden, true);
assert.equal(currentTool, "pan", "Apply must leave Move selected");
assert.equal(configuredTools.at(-1), "pan");
assert.equal(elements.spatialBlur.openButton.focusCount, 1);
assert.equal(thumbnails, 2);

currentTool = "paint";
elements.spatialBlur.openButton.dispatchEvent(event("click"));
await settle();
assert.equal(currentTool, "pan");
elements.spatialBlur.cancelButton.dispatchEvent(event("click"));
await settle();
assert.equal(history.openEdit, null);
assert.equal(calls.at(-1)[0], "cancel-spatial-blur");
assert.equal(currentTool, "pan", "Cancel must leave Move selected");
assert.equal(configuredTools.at(-1), "pan");
assert.equal(elements.spatialBlur.openButton.focusCount, 2);
assert.equal(thumbnails, 2, "Cancel must not capture a committed thumbnail");

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

const filtersTrigger = new FakeElement();
controller.openGlass(elements.glass.openButton, filtersTrigger);
await settle();
assert.equal(history.openEdit, "glass");
assert.equal(controller.isOpen("glass"), true);
assert.equal(elements.glass.distortionInput.value, "30");
elements.glass.distortionInput.value = "72";
elements.glass.distortionInput.dispatchEvent(event("input"));
assert.equal(calls.at(-1)[0], "update-glass");
assert.equal(calls.at(-1)[1].distortionPercent, 72);
elements.glass.reseedButton.dispatchEvent(event("click"));
assert.equal(calls.at(-1)[0], "reseed-glass");
elements.glass.applyButton.dispatchEvent(event("click"));
await settle();
assert.equal(history.openEdit, null);
assert.equal(thumbnails, 3);
assert.equal(filtersTrigger.focusCount, 1);

controller.openGlass(elements.glass.openButton, filtersTrigger);
await settle();
elements.glass.cancelButton.dispatchEvent(event("click"));
await settle();
assert.equal(history.openEdit, null);
assert.equal(calls.at(-1)[0], "cancel-glass");
assert.equal(filtersTrigger.focusCount, 2);

controller.openCurves(elements.curves.openButton, filtersTrigger);
await settle();
assert.equal(history.openEdit, "curves");
assert.equal(controller.isOpen("curves"), true);
assert.equal(elements.canvas.classList.contains("raster-curves-active"), true);
assert.equal(elements.curves.channelSelect.value, "composite");
elements.curves.outputValue.value = "144";
elements.curves.outputValue.dispatchEvent(event("input"));
assert.equal(calls.at(-1)[0], "update-curves");
elements.curves.applyButton.dispatchEvent(event("click"));
await settle();
assert.equal(history.openEdit, null);
assert.equal(calls.at(-1)[0], "commit-curves");
assert.equal(thumbnails, 4);
assert.equal(filtersTrigger.focusCount, 3);
assert.equal(elements.canvas.classList.contains("raster-curves-active"), false);

// Applying an identity curve closes the transaction without inventing an
// Undo entry or recapturing an identical thumbnail.
const actionsBeforeIdentityCurves = history.actionCount;
const thumbnailsBeforeIdentityCurves = thumbnails;
curvesCommitChanged = false;
controller.openCurves(elements.curves.openButton, filtersTrigger);
await settle();
elements.curves.applyButton.dispatchEvent(event("click"));
await settle();
assert.equal(history.openEdit, null);
assert.equal(history.actionCount, actionsBeforeIdentityCurves);
assert.equal(thumbnails, thumbnailsBeforeIdentityCurves);
curvesCommitChanged = true;

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
assert.equal(
  currentTool,
  "pan",
  "later temporary tools must preserve the Move state left by Point Blur",
);
assert.equal(thumbnails, 5);

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

// Canceling the English rasterization warning leaves vectors, History and the
// Curves engine transaction untouched, then restores focus outside the closed catalog.
selectedItem = { key: "raster:1", kind: "raster", rasterLayerId: 1 };
additionalSceneItems = [{
  key: "text:9",
  kind: "text",
  textNode: { id: 9, name: "Caption", text: "Editable" },
}];
browser.confirmResult = false;
controller.syncUi();
const beginCurvesBeforeRejectedRasterization = calls.filter(
  ([name]) => name === "begin-curves",
).length;
const rejectedFocusBefore = filtersTrigger.focusCount;
controller.openCurves(elements.curves.openButton, filtersTrigger);
await settle();
assert.match(
  browser.confirmations.at(-1),
  /Rasterize all SVG and text layers before continuing\?[\s\S]*You can undo the rasterization\./,
);
assert.equal(
  calls.filter(([name]) => name === "rasterize-curves-vectors").length,
  0,
);
assert.equal(
  calls.filter(([name]) => name === "begin-curves").length,
  beginCurvesBeforeRejectedRasterization,
);
assert.equal(filtersTrigger.focusCount, rejectedFocusBefore + 1);

// A second tap while the confirmed conversion is in flight cannot open a
// second warning or launch another batch.
selectedItem = { key: "raster:1", kind: "raster", rasterLayerId: 1 };
additionalSceneItems = [{
  key: "svg:12",
  kind: "svg",
  svgNode: { id: 12, name: "Badge" },
}];
browser.confirmResult = true;
let releaseCurvesRasterization;
curvesRasterizationPromise = new Promise((resolve) => {
  releaseCurvesRasterization = resolve;
});
const confirmationCountBeforeDoubleTap = browser.confirmations.length;
const batchCountBeforeDoubleTap = calls.filter(
  ([name]) => name === "rasterize-curves-vectors",
).length;
controller.openCurves(elements.curves.openButton, filtersTrigger);
controller.openCurves(elements.curves.openButton, filtersTrigger);
await settle();
assert.equal(controller.isAnySurfaceOpen, true);
assert.equal(browser.confirmations.length, confirmationCountBeforeDoubleTap + 1);
assert.equal(
  calls.filter(([name]) => name === "rasterize-curves-vectors").length,
  batchCountBeforeDoubleTap + 1,
);
releaseCurvesRasterization();
curvesRasterizationPromise = null;
await settle();
assert.equal(controller.isOpen("curves"), true);
elements.curves.cancelButton.dispatchEvent(event("click"));
await settle();

// Confirmation rasterizes every text/SVG item first and then starts Curves on
// the raster replacing the originally selected vector layer.
selectedItem = {
  key: "text:10",
  kind: "text",
  textNode: { id: 10, name: "Heading", text: "Curves" },
};
additionalSceneItems = [{
  key: "svg:11",
  kind: "svg",
  svgNode: { id: 11, name: "Shape" },
}];
browser.confirmResult = true;
controller.syncUi();
assert.equal(elements.curves.openButton.disabled, false);
controller.openCurves(elements.curves.openButton, filtersTrigger);
await settle();
assert.deepEqual(
  calls.filter(([name]) => name === "rasterize-curves-vectors").at(-1),
  ["rasterize-curves-vectors", 2],
);
assert.equal(controller.isOpen("curves"), true);
assert.equal(history.openEdit, "curves");
elements.curves.cancelButton.dispatchEvent(event("click"));
await settle();

// Imported image nodes are outside this conversion path.
selectedItem = { key: "image:9", kind: "image" };
additionalSceneItems = [];
controller.syncUi();
const confirmationCountBeforeImage = browser.confirmations.length;
controller.openCurves(elements.curves.openButton, filtersTrigger);
await settle();
assert.equal(elements.curves.openButton.disabled, true);
assert.equal(browser.confirmations.length, confirmationCountBeforeImage);

selectedItem = { key: "raster:1", kind: "raster", rasterLayerId: 1 };
multiSelectionActive = true;
controller.syncUi();
const beginCurvesBeforeMulti = calls.filter(([name]) => name === "begin-curves").length;
controller.openCurves(elements.curves.openButton, filtersTrigger);
await settle();
assert.equal(elements.curves.openButton.disabled, true);
assert.equal(calls.filter(([name]) => name === "begin-curves").length, beginCurvesBeforeMulti);
multiSelectionActive = false;

// Color Adjust targets only the selected raster, previews every slider input,
// and commits exactly once before a requested canvas-tool transition.
selectedItem = { key: "image:9", kind: "image" };
controller.syncUi();
assert.equal(elements.colorAdjust.openButton.disabled, true);
selectedItem = { key: "raster:1", kind: "raster", rasterLayerId: 1 };
controller.syncUi();
const colorThumbnailCount = thumbnails;
controller.openColorAdjust(elements.colorAdjust.openButton, filtersTrigger);
await settle();
await settle();
assert.equal(history.openEdit, "color-adjust");
assert.equal(controller.isOpen("color-adjust"), true);
assert.equal(elements.colorAdjust.surface.hidden, false);
assert.equal(controller.canAutoCommitColorAdjust(history), true);
elements.colorAdjust.hueInput.value = "75";
elements.colorAdjust.saturationInput.value = "60";
elements.colorAdjust.brightnessInput.value = "40";
elements.colorAdjust.brightnessInput.dispatchEvent(event("input"));
assert.deepEqual(calls.at(-1), [
  "update-color-adjust",
  { hueDegrees: 90, saturationPercent: 20, brightnessPercent: -20 },
]);
assert.equal(await controller.commitColorAdjustForToolChange(), true);
assert.equal(history.openEdit, null);
assert.equal(controller.isOpen("color-adjust"), false);
assert.equal(elements.colorAdjust.surface.hidden, true);
assert.equal(calls.at(-1)[0], "commit-color-adjust");
assert.equal(thumbnails, colorThumbnailCount + 1);

controller.openColorAdjust(elements.colorAdjust.openButton, filtersTrigger);
await settle();
elements.colorAdjust.hueInput.value = "90";
elements.colorAdjust.hueInput.dispatchEvent(event("input"));
elements.colorAdjust.resetButton.dispatchEvent(event("click"));
assert.deepEqual(calls.at(-1), [
  "update-color-adjust",
  { hueDegrees: 0, saturationPercent: 0, brightnessPercent: 0 },
]);
elements.colorAdjust.cancelButton.dispatchEvent(event("click"));
await settle();
assert.equal(history.openEdit, null);
assert.equal(calls.at(-1)[0], "cancel-color-adjust");

// Color Balance keeps separate tonal values, remains native-raster-only and
// shares the generic exactly-once auto-commit path used by tool changes and persistence.
selectedItem = { key: "image:9", kind: "image" };
controller.syncUi();
assert.equal(elements.colorBalance.openButton.disabled, true);
selectedItem = { key: "raster:1", kind: "raster", rasterLayerId: 1 };
controller.syncUi();
const balanceThumbnailCount = thumbnails;
controller.openColorBalance(elements.colorBalance.openButton, filtersTrigger);
await settle();
await settle();
assert.equal(history.openEdit, "color-balance");
assert.equal(controller.isOpen("color-balance"), true);
assert.equal(elements.colorBalance.surface.hidden, false);
assert.equal(controller.isAutoCommitAdjustmentActive(history), true);
assert.equal(controller.canAutoCommitActiveAdjustment(history), true);
elements.colorBalance.toneButton.dispatchEvent(event("click"));
elements.colorBalance.toneButtons[2].dispatchEvent(event("click"));
assert.equal(elements.colorBalance.toneButtonLabel.textContent, "Highlights");
elements.colorBalance.cyanRedInput.value = "25";
elements.colorBalance.magentaGreenInput.value = "-35";
elements.colorBalance.yellowBlueInput.value = "45";
elements.colorBalance.yellowBlueInput.dispatchEvent(event("input"));
assert.deepEqual(calls.at(-1), [
  "update-color-balance",
  {
    shadows: { cyanRedPercent: 0, magentaGreenPercent: 0, yellowBluePercent: 0 },
    midtones: { cyanRedPercent: 0, magentaGreenPercent: 0, yellowBluePercent: 0 },
    highlights: { cyanRedPercent: 25, magentaGreenPercent: -35, yellowBluePercent: 45 },
    preserveLuminosity: true,
  },
]);
const balanceCommitsBefore = calls.filter(([name]) => name === "commit-color-balance").length;
assert.deepEqual(
  await Promise.all([
    controller.commitActiveAdjustmentForToolChange(),
    controller.commitActiveAdjustmentForToolChange(),
  ]),
  [true, true],
);
assert.equal(
  calls.filter(([name]) => name === "commit-color-balance").length,
  balanceCommitsBefore + 1,
  "concurrent settlement requests must share one Color Balance commit",
);
assert.equal(history.openEdit, null);
assert.equal(controller.isOpen("color-balance"), false);
assert.equal(elements.colorBalance.surface.hidden, true);
assert.equal(thumbnails, balanceThumbnailCount + 1);

controller.openColorBalance(elements.colorBalance.openButton, filtersTrigger);
await settle();
elements.colorBalance.cyanRedInput.value = "70";
elements.colorBalance.cyanRedInput.dispatchEvent(event("input"));
elements.colorBalance.resetButton.dispatchEvent(event("click"));
assert.deepEqual(calls.at(-1), [
  "update-color-balance",
  {
    shadows: { cyanRedPercent: 0, magentaGreenPercent: 0, yellowBluePercent: 0 },
    midtones: { cyanRedPercent: 0, magentaGreenPercent: 0, yellowBluePercent: 0 },
    highlights: { cyanRedPercent: 0, magentaGreenPercent: 0, yellowBluePercent: 0 },
    preserveLuminosity: true,
  },
]);
elements.colorBalance.cancelButton.dispatchEvent(event("click"));
await settle();
assert.equal(history.openEdit, null);
assert.equal(calls.at(-1)[0], "cancel-color-balance");

// Device loss abandons the engine session without a GPU rollback. The UI must
// close immediately, restore focus and avoid issuing a stale Cancel command.
selectedItem = { key: "raster:1", kind: "raster", rasterLayerId: 1 };
controller.openCurves(elements.curves.openButton, filtersTrigger);
await settle();
assert.equal(controller.isOpen("curves"), true);
const cancelCurvesBeforeDeviceLoss = calls.filter(([name]) => name === "cancel-curves").length;
history = { ...history, openEdit: null };
controller.handleEngineStatus("WebGPU device lost: injected test", "error");
await settle();
assert.equal(controller.isOpen("curves"), false);
assert.equal(
  calls.filter(([name]) => name === "cancel-curves").length,
  cancelCurvesBeforeDeviceLoss,
);
assert.equal(elements.curves.status.textContent, "WebGPU device lost: injected test");
for (const adjustment of Object.values(elements)) {
  if (adjustment?.openButton) {
    assert.equal(adjustment.openButton.disabled, true);
    assert.equal(adjustment.openButton.title, "WebGPU device lost: injected test");
  }
}

assert.match(
  main,
  /onMultiSelectionChange: \(\{ enabled, orderedKeys \}\) => \{\s*rasterAdjustmentsController\?\.syncUi\(\)/,
  "Changing layer multi-selection must refresh filter eligibility immediately.",
);

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
