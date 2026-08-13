import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "vite";

const root = new URL("../", import.meta.url);
const main = readFileSync(new URL("src/main.ts", root), "utf8");
const source = readFileSync(new URL("src/canvas-tool-controller.ts", root), "utf8");

assert.match(main, /canvasToolController = new CanvasToolController\(\{/);
assert.match(main, /canvasToolController\?\.dispose\(\);/);
assert.doesNotMatch(
  main,
  /let activeCanvasTool|let activeBrushTool|let toolConfigurationRevision|function startMobileTextDistortEditing/,
  "main.ts must not own active-tool or vector-tool transition state",
);
assert.match(source, /export type CanvasToolEnginePort = Pick</);
assert.match(source, /configurationRevision/);
assert.match(source, /startTextDistortEditing/);
assert.doesNotMatch(source, /document\.getElementById|querySelector/);

const server = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: process.cwd(),
  server: { middlewareMode: true },
});
let CanvasToolController;
try {
  ({ CanvasToolController } = await server.ssrLoadModule("/src/canvas-tool-controller.ts"));
} finally {
  await server.close();
}

class FakeElement extends EventTarget {
  attributes = new Map();
  tabIndex = 0;
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
}

const canvas = new FakeElement();
const paintButton = new FakeElement();
const blendButton = new FakeElement();
let selectedBrush = "paint";
const brushSelections = [];
const brushSettings = {
  snapshot: () => ({ tool: selectedBrush, color: "#000000" }),
  selectTool(tool, restoreSnapshot) {
    selectedBrush = tool;
    brushSelections.push([tool, restoreSnapshot]);
    return this.snapshot();
  },
};
let selection = { method: "automatic", combineMode: "replace" };
const selectionSettings = {
  selectionSnapshot: () => ({ ...selection }),
  setSelectionMethod: (method) => { selection = { ...selection, method }; },
  setSelectionCombineMode: (combineMode) => { selection = { ...selection, combineMode }; },
};
const engineCalls = [];
const engine = {
  fillToolSelected: false,
  async setFillToolSelected(selected) {
    engineCalls.push(["fill", selected]);
    this.fillToolSelected = selected;
    return true;
  },
  async setSelectionToolSelected(selected, method) {
    engineCalls.push(["selection", selected, method]);
    return true;
  },
};
let locked = false;
let engineReady = true;
let libraryToggles = 0;
let menuSyncs = 0;
let historyRefreshes = 0;
let toolSettingsKind = null;
const closedStudios = [];
const closedToolSettings = [];
const closedLibraries = [];
const canceledKeyboard = [];
const syncedBrushSettings = [];
let distortEditing = false;
let transformApplyResult = true;
const vectorCalls = [];
const vector = {
  setTransformToolActive: (active) => vectorCalls.push(["transform-active", active]),
  isSelectedTextDistortEditing: () => distortEditing,
  startSelectedTextDistortEditing: () => {
    vectorCalls.push(["distort-start"]);
    distortEditing = true;
    return true;
  },
  stopSelectedTextDistortEditing: () => {
    vectorCalls.push(["distort-stop"]);
    distortEditing = false;
  },
  setSelectedTextTransform: (mode) => vectorCalls.push(["warp", mode]),
  applyTransform: async () => {
    vectorCalls.push(["apply-transform"]);
    return transformApplyResult;
  },
  resetSelectedText: () => vectorCalls.push(["reset-text"]),
  deleteSelectedText: () => vectorCalls.push(["delete-text"]),
  rasterizeSelectedTextNode: () => vectorCalls.push(["rasterize-text"]),
};

const controller = new CanvasToolController({
  engine,
  browser: { AbortController: globalThis.AbortController },
  elements: { canvas, paintButton, blendButton },
  brushSettings,
  selectionSettings,
  isEngineReady: () => engineReady,
  isInteractionLocked: () => locked,
  closeBrushStudioForTool: (tool) => closedStudios.push(tool),
  closeToolSettingsForTool: (tool, preserve) => closedToolSettings.push([tool, preserve]),
  closeBrushLibraryForTool: (tool) => closedLibraries.push(tool),
  syncBrushLibraryButton: () => {},
  toggleBrushLibrary: () => { libraryToggles += 1; },
  cancelKeyboardSelectionGesture: (hideCursor) => canceledKeyboard.push(hideCursor),
  getVectorController: () => vector,
  getOpenToolSettingsKind: () => toolSettingsKind,
  syncMenuState: () => { menuSyncs += 1; },
  syncBrushSettings: (settings) => syncedBrushSettings.push(settings),
  syncQuickControls: () => {},
  syncToolSettings: () => {},
  updateHistoryControls: () => { historyRefreshes += 1; },
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

controller.configure("paint", false);
await settle();
assert.equal(controller.activeTool, "paint");
assert.equal(controller.activeBrush, "paint");
assert.equal(paintButton.getAttribute("aria-pressed"), "true");
assert.equal(blendButton.getAttribute("aria-pressed"), "false");
assert.equal(canvas.tabIndex, -1);

paintButton.dispatchEvent(new Event("click"));
assert.equal(libraryToggles, 1);
blendButton.dispatchEvent(new Event("click"));
await settle();
assert.equal(controller.activeTool, "blend");
assert.equal(controller.activeBrush, "blend");
assert.equal(historyRefreshes, 1);
assert.deepEqual(brushSelections.at(-1), ["blend", true]);

locked = true;
assert.equal(controller.select("paint"), false);
assert.equal(controller.activeTool, "blend");
locked = false;

controller.configure("selection", false);
await settle();
assert.equal(canvas.tabIndex, 0);
assert.match(canvas.getAttribute("aria-keyshortcuts"), /ArrowUp/);
controller.setSelectionMethod("color-range");
await settle();
assert.equal(controller.selectionMethod, "color-range");
assert.equal(canvas.tabIndex, -1);
assert.equal(canvas.getAttribute("aria-keyshortcuts"), null);
assert(engineCalls.some(([kind, selected, method]) =>
  kind === "selection" && selected === true && method === "color-range"));

controller.setSelectionCombineMode("add");
assert.equal(selection.combineMode, "add");

controller.configure("paint", false);
await settle();
assert.equal(controller.toggleTextDistortEditing(), true);
await settle();
assert.equal(controller.activeTool, "transform");
assert.equal(distortEditing, true);
assert.equal(controller.toggleTextDistortEditing(), false);
await settle();
assert.equal(controller.activeTool, "paint");
assert.equal(distortEditing, false);

controller.setTextWarpMode("arch");
assert.deepEqual(vectorCalls.at(-1), ["warp", "arch"]);
controller.resetSelectedText();
controller.deleteSelectedText();
controller.rasterizeSelectedText();
assert(vectorCalls.some(([name]) => name === "reset-text"));
assert(vectorCalls.some(([name]) => name === "delete-text"));
assert(vectorCalls.some(([name]) => name === "rasterize-text"));

controller.configure("transform", false);
await settle();
toolSettingsKind = null;
await controller.finishTransformToolOnSheetClose("transform");
assert.equal(controller.activeTool, "paint");
transformApplyResult = false;
controller.configure("transform", false);
await settle();
await controller.finishTransformToolOnSheetClose("transform");
assert.equal(controller.activeTool, "transform");

assert(menuSyncs > 0);
assert(closedStudios.length > 0);
assert(closedToolSettings.length > 0);
assert(closedLibraries.length > 0);
assert(canceledKeyboard.length > 0);
assert(syncedBrushSettings.length > 0);

controller.dispose();
controller.dispose();
const toolAfterDispose = controller.activeTool;
blendButton.dispatchEvent(new Event("click"));
assert.equal(controller.activeTool, toolAfterDispose);

console.log(
  "Canvas tool controller: state, async selection, keyboard, vector distort and disposal verified.",
);
