import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "vite";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("index.html", root), "utf8");
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
assert.match(source, /syncVectorControllerState/);
assert.doesNotMatch(source, /document\.getElementById|querySelector/);
assert.match(
  main,
  /function selectCanvasToolWithMixedScene[\s\S]*?initializeMixedSceneController\(\)/,
  "selecting Transform, Warp, or Perspective must initialize the deferred editor on demand",
);
assert.match(
  main,
  /mixedSceneController = controller;[\s\S]{0,160}canvasToolController\?\.syncVectorControllerState\(\)/,
  "the selected transform mode must be replayed when deferred initialization finishes",
);
assert.match(
  html,
  /id="mobilePan"[\s\S]*?title="Move"[\s\S]*?data-lucide="hand"/,
);
assert.match(
  html,
  /data-mobile-canvas-tool="pan"[\s\S]*?data-lucide="hand"[\s\S]*?>Move</,
);
assert.match(main, /const mobilePanButton = element<HTMLButtonElement>\("mobilePan"\)/);
assert.match(main, /panButton: mobilePanButton/);
assert.match(
  main,
  /onClose: \(kind\) => \{[\s\S]*?finishFillToolOnSheetClose\(kind\)/,
  "closing the Fill settings sheet must use the controller's non-blocked Hand transition",
);

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
const eraserButton = new FakeElement();
const blendButton = new FakeElement();
const panButton = new FakeElement();
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
let closeToolSettingsHook = null;
let distortEditing = false;
let transformApplyResult = true;
let transformSessionActive = false;
let vectorReady = true;
let multiSelectionActive = false;
let canFinishMultiSelection = true;
let finishMultiSelectionResult = true;
let finishMultiSelectionGate = null;
let finishMultiSelectionCalls = 0;
let clearLockOnMultiSelectionFinish = true;
let adjustmentActive = false;
let finishAdjustmentGate = null;
let finishAdjustmentCalls = 0;
let finishAdjustmentResult = true;
const vectorCalls = [];
const vector = {
  setTransformToolActive: (active, mode) => vectorCalls.push(["transform-active", active, mode]),
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
    if (transformApplyResult) transformSessionActive = false;
    return transformApplyResult;
  },
  getTransformActionSnapshot: () => ({
    active: transformSessionActive,
    preparing: false,
    canApply: transformSessionActive,
    canCancel: transformSessionActive,
  }),
  resetSelectedText: () => vectorCalls.push(["reset-text"]),
  deleteSelectedText: () => vectorCalls.push(["delete-text"]),
  rasterizeSelectedTextNode: () => vectorCalls.push(["rasterize-text"]),
};

const controller = new CanvasToolController({
  engine,
  browser: { AbortController: globalThis.AbortController },
  elements: { canvas, paintButton, eraserButton, blendButton, panButton },
  brushSettings,
  selectionSettings,
  isEngineReady: () => engineReady,
  isInteractionLocked: () => locked,
  isMultiSelectionActive: () => multiSelectionActive,
  canFinishMultiSelectionForToolChange: () => canFinishMultiSelection,
  finishMultiSelectionForToolChange: async () => {
    finishMultiSelectionCalls += 1;
    const finished = finishMultiSelectionGate
      ? await finishMultiSelectionGate
      : finishMultiSelectionResult;
    if (finished) {
      multiSelectionActive = false;
      if (clearLockOnMultiSelectionFinish) locked = false;
    }
    return finished;
  },
  shouldPrepareActiveAdjustmentForToolChange: () => adjustmentActive,
  prepareActiveAdjustmentForToolChange: async () => {
    finishAdjustmentCalls += 1;
    const finished = finishAdjustmentGate
      ? await finishAdjustmentGate
      : finishAdjustmentResult;
    if (finished) adjustmentActive = false;
    return finished;
  },
  closeBrushStudioForTool: (tool) => closedStudios.push(tool),
  closeToolSettingsForTool: (tool, preserve) => {
    closedToolSettings.push([tool, preserve]);
    closeToolSettingsHook?.();
  },
  closeBrushLibraryForTool: (tool) => closedLibraries.push(tool),
  syncBrushLibraryButton: () => {},
  toggleBrushLibrary: () => { libraryToggles += 1; },
  cancelKeyboardSelectionGesture: (hideCursor) => canceledKeyboard.push(hideCursor),
  getVectorController: () => vectorReady ? vector : null,
  getOpenToolSettingsKind: () => toolSettingsKind,
  syncMenuState: () => { menuSyncs += 1; },
  syncBrushSettings: (settings) => syncedBrushSettings.push(settings),
  syncQuickControls: () => {},
  syncToolSettings: () => {},
  updateHistoryControls: () => { historyRefreshes += 1; },
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

vectorReady = false;
controller.configure("perspective", false);
await settle();
vectorReady = true;
controller.syncVectorControllerState();
assert.deepEqual(
  vectorCalls.at(-1),
  ["transform-active", true, "perspective"],
  "Perspective must be replayed with its exact mode after deferred editor startup",
);

controller.configure("paint", false);
await settle();
assert.equal(controller.activeTool, "paint");
assert.equal(controller.activeBrush, "paint");
assert.equal(paintButton.getAttribute("aria-pressed"), "true");
assert.equal(eraserButton.getAttribute("aria-pressed"), "false");
assert.equal(blendButton.getAttribute("aria-pressed"), "false");
assert.equal(panButton.getAttribute("aria-pressed"), "false");
assert.equal(canvas.getAttribute("data-active-canvas-tool"), "paint");
assert.equal(canvas.tabIndex, -1);

paintButton.dispatchEvent(new Event("click"));
assert.equal(libraryToggles, 1);
eraserButton.dispatchEvent(new Event("click"));
await settle();
assert.equal(controller.activeTool, "erase");
assert.equal(controller.activeBrush, "erase");
assert.equal(eraserButton.getAttribute("aria-pressed"), "true");
assert.deepEqual(brushSelections.at(-1), ["erase", true]);
blendButton.dispatchEvent(new Event("click"));
await settle();
assert.equal(controller.activeTool, "blend");
assert.equal(controller.activeBrush, "blend");
assert.equal(historyRefreshes, 2);
assert.deepEqual(brushSelections.at(-1), ["blend", true]);

locked = true;
assert.equal(controller.select("paint"), false);
assert.equal(controller.activeTool, "blend");
locked = false;

controller.configure("paint", false);
await settle();
adjustmentActive = true;
locked = true;
let releaseAdjustment;
finishAdjustmentGate = new Promise((resolve) => {
  releaseAdjustment = resolve;
});
const adjustmentCallsBeforeRace = finishAdjustmentCalls;
paintButton.dispatchEvent(new Event("click"));
eraserButton.dispatchEvent(new Event("click"));
panButton.dispatchEvent(new Event("click"));
assert.equal(controller.activeTool, "paint");
assert.equal(finishAdjustmentCalls, adjustmentCallsBeforeRace + 1);
assert.equal(libraryToggles, 1, "the active Paint button must commit instead of opening brushes");
releaseAdjustment(true);
await settle();
await settle();
assert.equal(controller.activeTool, "pan", "the latest tool request must win after auto-commit");
assert.equal(finishAdjustmentCalls, adjustmentCallsBeforeRace + 1);
assert.equal(locked, true, "the settled adjustment owns the post-lock transition");
finishAdjustmentGate = null;
locked = false;

controller.configure("transform", false);
await settle();
multiSelectionActive = true;
locked = true;
clearLockOnMultiSelectionFinish = false;
let releaseMultiSelection;
finishMultiSelectionGate = new Promise((resolve) => {
  releaseMultiSelection = resolve;
});
const finishCallsBeforeRace = finishMultiSelectionCalls;
paintButton.dispatchEvent(new Event("click"));
eraserButton.dispatchEvent(new Event("click"));
panButton.dispatchEvent(new Event("click"));
assert.equal(
  controller.activeTool,
  "transform",
  "the group must remain in Transform until its atomic Apply finishes",
);
assert.equal(finishMultiSelectionCalls, finishCallsBeforeRace + 1);
releaseMultiSelection(true);
await settle();
await settle();
assert.equal(
  controller.activeTool,
  "pan",
  "the latest requested tool must win even while the unlocked notification is stale",
);
assert.equal(multiSelectionActive, false);
assert.equal(
  locked,
  true,
  "the successful post-selection transition must not depend on the generic lock clearing first",
);
assert.equal(
  finishMultiSelectionCalls,
  finishCallsBeforeRace + 1,
  "concurrent tool requests must share one group completion",
);
finishMultiSelectionGate = null;
clearLockOnMultiSelectionFinish = true;
locked = false;

controller.configure("transform", false);
await settle();
multiSelectionActive = true;
locked = true;
canFinishMultiSelection = false;
const callsBeforeBlockedGroupExit = finishMultiSelectionCalls;
assert.equal(controller.select("paint"), false);
assert.equal(finishMultiSelectionCalls, callsBeforeBlockedGroupExit);
assert.equal(controller.activeTool, "transform");
canFinishMultiSelection = true;

finishMultiSelectionResult = false;
assert.equal(controller.select("paint"), true);
await settle();
await settle();
assert.equal(controller.activeTool, "transform");
assert.equal(multiSelectionActive, true);

finishMultiSelectionGate = Promise.reject(new Error("group Apply failed"));
assert.equal(controller.select("erase"), true);
await settle();
await settle();
assert.equal(
  controller.activeTool,
  "transform",
  "an unexpected completion failure must preserve the current Transform tool",
);
assert.equal(multiSelectionActive, true);
finishMultiSelectionGate = null;

finishMultiSelectionResult = true;
assert.equal(controller.select("pan"), true);
await settle();
await settle();
assert.equal(controller.activeTool, "pan", "a failed Apply must remain retryable");
assert.equal(multiSelectionActive, false);

const brushBeforePan = controller.activeBrush;
const brushSelectionCountBeforePan = brushSelections.length;
panButton.dispatchEvent(new Event("click"));
await settle();
assert.equal(controller.activeTool, "pan");
assert.equal(controller.activeBrush, brushBeforePan);
assert.equal(panButton.getAttribute("aria-pressed"), "true");
assert.equal(blendButton.getAttribute("aria-pressed"), "false");
assert.equal(canvas.getAttribute("data-active-canvas-tool"), "pan");
assert.equal(
  brushSelections.length,
  brushSelectionCountBeforePan,
  "selecting Move must not rewrite the active brush settings",
);

controller.configure("fill", false);
await settle();
assert.equal(controller.activeTool, "fill");
locked = true;
const fillDeselectsBeforeClose = engineCalls.filter(
  ([kind, selected]) => kind === "fill" && selected === false,
).length;
closeToolSettingsHook = () => {
  closeToolSettingsHook = null;
  controller.finishFillToolOnSheetClose("fill");
};
controller.configure("paint", false);
assert.equal(
  controller.activeTool,
  "pan",
  "the Fill close callback must synchronously override an in-flight tool transition with Hand",
);
assert.equal(panButton.getAttribute("aria-pressed"), "true");
await settle();
assert.equal(
  engineCalls.filter(([kind, selected]) => kind === "fill" && selected === false).length,
  fillDeselectsBeforeClose + 1,
  "a re-entrant Fill close must finalize through one engine deselection",
);
assert.equal(
  controller.select("paint"),
  false,
  "ordinary competing tool selection must remain locked during Fill finalization",
);
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
transformSessionActive = true;
await controller.finishTransformToolOnSheetClose("transform");
assert.equal(controller.activeTool, "paint");
transformApplyResult = false;
controller.configure("transform", false);
await settle();
transformSessionActive = true;
await controller.finishTransformToolOnSheetClose("transform");
assert.equal(controller.activeTool, "transform");
transformApplyResult = true;
transformSessionActive = false;
const applyCallsBeforeCanceledClose = vectorCalls.filter(([name]) => name === "apply-transform").length;
await controller.finishTransformToolOnSheetClose("transform");
assert.equal(controller.activeTool, "paint");
assert.equal(
  vectorCalls.filter(([name]) => name === "apply-transform").length,
  applyCallsBeforeCanceledClose,
  "closing after Cancel must leave Transform without trying to apply a missing session",
);

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
