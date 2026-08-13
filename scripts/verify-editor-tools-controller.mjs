import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "vite";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("index.html", root), "utf8");
const mainSource = readFileSync(new URL("src/main.ts", root), "utf8");
const controllerSource = readFileSync(
  new URL("src/editor-tools-controller.ts", root),
  "utf8",
);
const contractSource = readFileSync(
  new URL("src/editor-tools-contract.ts", root),
  "utf8",
);

assert.match(mainSource, /editorToolsController = new EditorToolsController\(\{/);
assert.match(mainSource, /editorToolsController\.dispose\(\);/);
assert.match(
  html,
  /id="mobileToolsSheet"[\s\S]*?aria-hidden="true"[\s\S]*?inert[\s\S]*?data-snap="peek"/,
  "the initially hidden Tools sheet must be inert before JavaScript starts",
);
assert.match(
  mainSource,
  /runVectorCommand: \(command\) => \{\s*if \(interactionLocked\(\)\) return;/,
  "the composition root must reject stale import clicks while Undo/Redo owns the engine",
);
assert.match(
  mainSource,
  /function updateHistoryControls\(\): void \{[\s\S]*?editorToolsController\?\.isOpen[\s\S]*?syncMobileToolsMenuState\(\)/,
  "history transitions must refresh an open Tools menu",
);
assert.match(
  contractSource,
  /EDITOR_TOOL_SETTINGS_KINDS[\s\S]*?EDITOR_RASTER_EFFECT_KINDS/,
  "tool and effect datasets must share one canonical typed contract",
);
assert.doesNotMatch(
  mainSource,
  /mobileToolsSheet(?:Open|DragPointerId|DragStartY|DragStartOffsetPx|DragStartSnap|DragLastY|DragLastTime|DragVelocityY|DragMoved|Snap|OffsetPx)/,
  "main.ts must not retain the Tools sheet state machine",
);
assert.doesNotMatch(
  controllerSource,
  /from "\.\/brush-engine"|(?:^|\n)\s*document\.|getElementById|querySelectorAll<HTMLButtonElement>\("\[data-mobile-(?:canvas|effect|vector)/,
  "the Tools controller must depend on injected ports and scoped elements",
);
assert.match(
  controllerSource,
  /private readonly abortController: AbortController;[\s\S]*?this\.abortController\.abort\(\)/,
  "the controller must own and abort its listener lifecycle",
);

const moduleServer = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: process.cwd(),
  server: { middlewareMode: true },
});
let EditorToolsController;
try {
  ({ EditorToolsController } = await moduleServer.ssrLoadModule(
    "/src/editor-tools-controller.ts",
  ));
} finally {
  await moduleServer.close();
}

class FakeClassList {
  values = new Set();

  add(...names) {
    for (const name of names) this.values.add(name);
  }

  remove(...names) {
    for (const name of names) this.values.delete(name);
  }

  contains(name) {
    return this.values.has(name);
  }
}

class FakeStyle {
  values = new Map();

  setProperty(name, value) {
    this.values.set(name, value);
  }

  getPropertyValue(name) {
    return this.values.get(name) ?? "";
  }
}

class FakeElement extends EventTarget {
  attributes = new Map();
  classList = new FakeClassList();
  dataset = {};
  style = new FakeStyle();
  queryResults = [];
  pointerCaptures = new Set();
  hidden = false;
  disabled = false;
  textContent = "";
  value = "";
  offsetHeight = 800;
  scrollTop = 0;
  focusCount = 0;
  blurCount = 0;

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  querySelectorAll() {
    return this.queryResults;
  }

  focus() {
    this.focusCount += 1;
  }

  blur() {
    this.blurCount += 1;
  }

  getBoundingClientRect() {
    return { top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0 };
  }

  contains(target) {
    return target === this;
  }

  setPointerCapture(pointerId) {
    this.pointerCaptures.add(pointerId);
  }

  hasPointerCapture(pointerId) {
    return this.pointerCaptures.has(pointerId);
  }

  releasePointerCapture(pointerId) {
    this.pointerCaptures.delete(pointerId);
  }

  click() {
    this.dispatchEvent(new Event("click"));
  }
}

function pointerEvent(type, properties) {
  const event = new Event(type, { cancelable: true });
  for (const [name, value] of Object.entries(properties)) {
    Object.defineProperty(event, name, { configurable: true, value });
  }
  return event;
}

function button(dataset = {}, textContent = "") {
  const result = new FakeElement();
  result.dataset = { ...dataset };
  result.textContent = textContent;
  return result;
}

function createHarness() {
  let canOpen = true;
  let now = 0;
  let nextFrame = 1;
  const frames = new Map();
  const cancelledFrames = [];
  const beforeOpenCalls = [];
  const openChanges = [];
  const selectedTools = [];
  const toolSettings = [];
  const vectorCommands = [];
  const rasterEffects = [];

  const trigger = new FakeElement();
  const sheet = new FakeElement();
  const handle = new FakeElement();
  const content = new FakeElement();
  const searchField = new FakeElement();
  const searchInput = new FakeElement();
  const empty = new FakeElement();
  const blurTool = button({ mobileToolSearch: "blur effect" }, "Sfocàtura");
  const brushTool = button({}, "Pennello");
  const category = new FakeElement();
  category.queryResults = [blurTool, brushTool];
  const paintButton = button({ mobileCanvasTool: "paint" });
  const invalidCanvasButton = button({ mobileCanvasTool: "unknown" });
  const textButton = button({ mobileToolSheet: "text" });
  const textWarpButton = button({ mobileToolSheet: "text-warp" });
  const svgStyleButton = button({ mobileToolSheet: "svg-style" });
  const outlineButton = button({ mobileToolSheet: "text-outline" });
  const invalidSettingsButton = button({ mobileToolSheet: "unknown" });
  const importSvgButton = button({ mobileVectorCommand: "import-svg" });
  const invalidVectorButton = button({ mobileVectorCommand: "unknown" });
  const colorOverlayButton = button({ mobileEffectKind: "color-overlay" });
  const strokeButton = button({ mobileEffectKind: "stroke" });
  const invalidEffectButton = button({ mobileEffectKind: "unknown" });

  const browser = {
    AbortController,
    innerHeight: 800,
    performance: { now: () => now },
    document: { activeElement: null },
    requestAnimationFrame(callback) {
      const id = nextFrame;
      nextFrame += 1;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      cancelledFrames.push(id);
      frames.delete(id);
    },
  };
  const elements = {
    trigger,
    sheet,
    handle,
    content,
    searchField,
    searchInput,
    empty,
    categories: [category],
    canvasButtons: [paintButton, invalidCanvasButton],
    toolSettingsButtons: [
      textButton,
      textWarpButton,
      svgStyleButton,
      outlineButton,
      invalidSettingsButton,
    ],
    vectorCommandButtons: [importSvgButton, invalidVectorButton],
    effectButtons: [colorOverlayButton, strokeButton, invalidEffectButton],
  };
  const controller = new EditorToolsController({
    browser,
    elements,
    canOpen: () => canOpen,
    beforeOpen: () => beforeOpenCalls.push(true),
    onOpenChange: (open) => openChanges.push(open),
    syncMenuState: () => {},
    selectCanvasTool: (tool) => {
      selectedTools.push(tool);
      return true;
    },
    openToolSettings: (kind, opener) => toolSettings.push({ kind, opener }),
    runVectorCommand: (command) => vectorCommands.push(command),
    openRasterEffect: (kind, opener) => rasterEffects.push({ kind, opener }),
  });

  return {
    controller,
    elements,
    browser,
    blurTool,
    brushTool,
    category,
    paintButton,
    invalidCanvasButton,
    textButton,
    textWarpButton,
    svgStyleButton,
    outlineButton,
    invalidSettingsButton,
    importSvgButton,
    invalidVectorButton,
    colorOverlayButton,
    strokeButton,
    invalidEffectButton,
    beforeOpenCalls,
    openChanges,
    selectedTools,
    toolSettings,
    vectorCommands,
    rasterEffects,
    frames,
    cancelledFrames,
    setCanOpen(value) { canOpen = value; },
    setNow(value) { now = value; },
  };
}

// Policy stays outside the sheet. A denied open must not mutate UI state.
{
  const harness = createHarness();
  harness.setCanOpen(false);
  harness.elements.trigger.click();
  assert.equal(harness.controller.isOpen, false);
  assert.equal(harness.beforeOpenCalls.length, 0);
  assert.equal(harness.elements.sheet.getAttribute("aria-hidden"), "true");
  assert.equal(harness.elements.sheet.getAttribute("inert"), "");

  harness.setCanOpen(true);
  harness.elements.trigger.click();
  assert.equal(harness.controller.isOpen, true);
  assert.equal(harness.beforeOpenCalls.length, 1);
  assert.deepEqual(harness.openChanges, [true]);
  assert.equal(harness.elements.trigger.getAttribute("aria-expanded"), "true");
  assert.equal(harness.elements.sheet.classList.contains("is-open"), true);
  assert.equal(harness.elements.sheet.getAttribute("inert"), null);
  assert.equal(
    harness.elements.sheet.style.getPropertyValue("--mobile-tools-sheet-offset"),
    "592px",
  );

  harness.elements.searchInput.value = "sfocatura";
  harness.elements.searchInput.dispatchEvent(new Event("input"));
  assert.equal(harness.blurTool.hidden, false, "accent-insensitive search lost its match");
  assert.equal(harness.brushTool.hidden, true);
  assert.equal(harness.category.hidden, false);
  assert.equal(harness.elements.empty.hidden, true);
  assert.equal(harness.elements.content.scrollTop, 0);

  harness.elements.searchInput.value = "nessun-risultato";
  harness.elements.searchInput.dispatchEvent(new Event("search"));
  assert.equal(harness.category.hidden, true);
  assert.equal(harness.elements.empty.hidden, false);

  harness.elements.searchInput.dispatchEvent(new Event("focus"));
  assert.equal(harness.frames.size, 1, "search focus must schedule class cleanup");
  harness.browser.document.activeElement = harness.elements.sheet;
  harness.controller.dispose();
  assert.equal(harness.controller.isOpen, false);
  assert.equal(harness.cancelledFrames.length, 1);
  assert.deepEqual(harness.openChanges, [true, false]);
  assert.equal(harness.elements.sheet.getAttribute("inert"), "");
  assert.equal(harness.elements.trigger.focusCount, 1);
  harness.elements.trigger.click();
  assert.equal(harness.controller.isOpen, false, "disposed listeners remained active");
}

// Typed datasets are the only routing boundary; disabled/unknown commands are inert.
{
  const harness = createHarness();
  harness.controller.setOpen(true);
  harness.invalidCanvasButton.click();
  assert.deepEqual(harness.selectedTools, []);
  harness.paintButton.click();
  assert.deepEqual(harness.selectedTools, ["paint"]);
  assert.equal(harness.controller.isOpen, false);

  harness.controller.setOpen(true);
  harness.textButton.click();
  assert.deepEqual(harness.toolSettings, [{ kind: "text", opener: harness.textButton }]);
  harness.invalidSettingsButton.click();
  assert.equal(harness.toolSettings.length, 1);

  harness.importSvgButton.disabled = true;
  harness.importSvgButton.click();
  harness.invalidVectorButton.click();
  assert.deepEqual(harness.vectorCommands, []);
  harness.importSvgButton.disabled = false;
  harness.importSvgButton.click();
  assert.deepEqual(harness.vectorCommands, ["import-svg"]);
  assert.equal(harness.controller.isOpen, false);

  harness.controller.setOpen(true);
  harness.strokeButton.disabled = true;
  harness.strokeButton.click();
  harness.invalidEffectButton.click();
  assert.deepEqual(harness.rasterEffects, []);
  harness.strokeButton.disabled = false;
  harness.strokeButton.click();
  assert.deepEqual(harness.rasterEffects, [{ kind: "stroke", opener: harness.strokeButton }]);
  harness.controller.dispose();
}

// Menu rendering preserves availability and pressed state without reading engine DOM.
{
  const harness = createHarness();
  harness.controller.renderMenuState({
    activeCanvasTool: "paint",
    engineReady: true,
    interactionLocked: false,
    vectorEditorReady: true,
    vectorEditorLocked: false,
    textSelected: true,
    svgSelected: false,
    textTransformActive: true,
    vectorOutlineEnabled: true,
    vectorDropShadowEnabled: false,
    vectorInnerShadowEnabled: false,
    vectorBlockShadowEnabled: false,
    rasterColorOverlayTargetSelected: false,
    rasterEffectsEnabled: {
      "color-overlay": true,
      stroke: true,
      "outer-shadow": false,
      "inner-shadow": false,
      bevel: false,
    },
  });
  assert.equal(harness.paintButton.getAttribute("aria-pressed"), "true");
  assert.equal(harness.importSvgButton.disabled, false);
  assert.equal(harness.textButton.disabled, false);
  assert.equal(harness.textButton.getAttribute("aria-pressed"), "true");
  assert.equal(harness.textWarpButton.getAttribute("aria-pressed"), "true");
  assert.equal(harness.svgStyleButton.disabled, true);
  assert.equal(harness.outlineButton.disabled, false);
  assert.equal(harness.outlineButton.getAttribute("aria-pressed"), "true");
  assert.equal(harness.invalidSettingsButton.disabled, true);
  assert.equal(harness.colorOverlayButton.disabled, true);
  assert.equal(harness.colorOverlayButton.getAttribute("aria-pressed"), "true");
  assert.equal(harness.strokeButton.disabled, false);
  assert.equal(harness.strokeButton.getAttribute("aria-pressed"), "true");
  assert.equal(harness.invalidEffectButton.disabled, true);
  assert.equal(harness.invalidEffectButton.getAttribute("aria-pressed"), "false");

  harness.controller.renderMenuState({
    activeCanvasTool: "paint",
    engineReady: true,
    interactionLocked: true,
    vectorEditorReady: true,
    vectorEditorLocked: false,
    textSelected: true,
    svgSelected: true,
    textTransformActive: false,
    vectorOutlineEnabled: false,
    vectorDropShadowEnabled: false,
    vectorInnerShadowEnabled: false,
    vectorBlockShadowEnabled: false,
    rasterColorOverlayTargetSelected: true,
    rasterEffectsEnabled: {
      "color-overlay": false,
      stroke: false,
      "outer-shadow": false,
      "inner-shadow": false,
      bevel: false,
    },
  });
  assert.equal(
    harness.importSvgButton.disabled,
    true,
    "vector imports must lock while Undo/Redo or another interaction owns the engine",
  );
  harness.controller.dispose();
}

// Pointer cancellation restores the starting detent; a committed downward drag closes.
{
  const harness = createHarness();
  harness.controller.setOpen(true);
  harness.elements.handle.dispatchEvent(pointerEvent("pointerdown", {
    pointerId: 1,
    clientY: 500,
    button: 0,
  }));
  harness.setNow(16);
  harness.elements.handle.dispatchEvent(pointerEvent("pointermove", {
    pointerId: 1,
    clientY: 420,
    button: 0,
  }));
  harness.setNow(20);
  harness.elements.handle.dispatchEvent(pointerEvent("pointercancel", {
    pointerId: 1,
    clientY: 420,
    button: 0,
  }));
  assert.equal(harness.controller.isOpen, true);
  assert.equal(harness.elements.sheet.dataset.snap, "peek");
  assert.equal(harness.elements.handle.hasPointerCapture(1), false);

  harness.elements.handle.dispatchEvent(pointerEvent("pointerdown", {
    pointerId: 2,
    clientY: 300,
    button: 0,
  }));
  harness.setNow(36);
  harness.elements.handle.dispatchEvent(pointerEvent("pointermove", {
    pointerId: 2,
    clientY: 760,
    button: 0,
  }));
  harness.setNow(40);
  harness.elements.handle.dispatchEvent(pointerEvent("pointerup", {
    pointerId: 2,
    clientY: 780,
    button: 0,
  }));
  assert.equal(harness.controller.isOpen, false);
  assert.equal(harness.elements.handle.hasPointerCapture(2), false);
  harness.controller.dispose();
}

console.log("Editor Tools controller: lifecycle, search, routing, state and gestures verified.");
