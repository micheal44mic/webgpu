import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "vite";

const root = new URL("../", import.meta.url);
const main = readFileSync(new URL("src/main.ts", root), "utf8");
const source = readFileSync(
  new URL("src/brush-quick-controls-controller.ts", root),
  "utf8",
);

assert.match(main, /brushQuickControlsController = new BrushQuickControlsController\(\{/);
assert.match(main, /brushQuickControlsController\?\.dispose\(\);/);
assert.doesNotMatch(
  main,
  /mobileBrushControlDrag|function startMobileBrushControlDrag|function syncMobileBrushControlVisual/,
  "main.ts must not own quick-control gestures or rendering",
);
assert.match(source, /export interface BrushQuickControlsSettingsPort/);
assert.match(source, /private drag: BrushControlDrag \| null/);
assert.match(source, /this\.options\.settings\.setQuickControl/);
assert.doesNotMatch(source, /document\.getElementById|querySelector/);

const server = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: process.cwd(),
  server: { middlewareMode: true },
});
let BrushQuickControlsController;
try {
  ({ BrushQuickControlsController } = await server.ssrLoadModule(
    "/src/brush-quick-controls-controller.ts",
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
  tabIndex = 0;
  value = "";
  captures = new Set();
  trackHeight = 200;

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  getBoundingClientRect() { return { height: this.trackHeight }; }
  setPointerCapture(pointerId) { this.captures.add(pointerId); }
  releasePointerCapture(pointerId) { this.captures.delete(pointerId); }
  hasPointerCapture(pointerId) { return this.captures.has(pointerId); }
}

class FakeBrowser extends EventTarget {
  AbortController = globalThis.AbortController;
  nextFrame = 1;
  frames = new Map();

  requestAnimationFrame(callback) {
    const id = this.nextFrame++;
    this.frames.set(id, callback);
    return id;
  }

  cancelAnimationFrame(id) {
    this.frames.delete(id);
  }

  flushFrames() {
    const frames = [...this.frames.values()];
    this.frames.clear();
    for (const callback of frames) callback(0);
  }
}

function event(type, properties = {}) {
  const value = new Event(type, { cancelable: true });
  for (const [name, property] of Object.entries(properties)) {
    Object.defineProperty(value, name, { configurable: true, value: property });
  }
  return value;
}

const kinds = ["size", "opacity", "stretch", "paint", "blur"];
const browser = new FakeBrowser();
const elements = {
  colorLabel: new FakeElement(),
  colorInput: new FakeElement(),
  colorSwatch: new FakeElement(),
  controls: new FakeElement(),
  tracks: Object.fromEntries(kinds.map((kind) => [kind, new FakeElement()])),
  controlsByKind: Object.fromEntries(kinds.map((kind) => [kind, new FakeElement()])),
  preview: new FakeElement(),
  previewLabel: new FakeElement(),
  previewCanvas: new FakeElement(),
};
let state = {
  tool: "paint",
  color: "#ff0000",
  size: 100,
  opacity: 0.5,
  blendStretch: 0.2,
  blendPaint: 0.3,
  blendBlur: 0.4,
};
const settingsCalls = [];
const settings = {
  snapshot: () => ({ ...state }),
  update(patch) {
    state = { ...state, ...patch };
    settingsCalls.push(["update", patch]);
    return { ...state };
  },
  quickControl(kind) {
    const minimum = kind === "size" ? 1 : 0;
    const maximum = kind === "size" ? 1000 : 100;
    const value = kind === "size"
      ? state.size
      : kind === "opacity"
        ? state.opacity * 100
        : kind === "stretch"
          ? state.blendStretch * 100
          : kind === "paint"
            ? state.blendPaint * 100
            : state.blendBlur * 100;
    return { minimum, maximum, value, percent: (value - minimum) / (maximum - minimum) * 100 };
  },
  setQuickControl(kind, requested) {
    settingsCalls.push(["quick", kind, requested]);
    if (kind === "size") state = { ...state, size: Math.round(requested) };
    else if (kind === "opacity") state = { ...state, opacity: requested / 100 };
    else if (kind === "stretch") state = { ...state, blendStretch: requested / 100 };
    else if (kind === "paint") state = { ...state, blendPaint: requested / 100 };
    else state = { ...state, blendBlur: requested / 100 };
    return { ...state };
  },
};
let activeTool = "paint";
let locked = false;
let surfaceSuppressed = false;
let paintSelections = 0;
let previewDirty = 0;
let historyRefreshes = 0;
const renderCalls = [];
const controller = new BrushQuickControlsController({
  browser,
  engine: { renderBrushTipPreview: (...args) => renderCalls.push(args) },
  settings,
  elements,
  getActiveTool: () => activeTool,
  isInteractionLocked: () => locked,
  isSuppressedBySurface: () => surfaceSuppressed,
  selectPaintTool: () => {
    paintSelections += 1;
    activeTool = "paint";
  },
  markLibraryPreviewDirty: () => { previewDirty += 1; },
  updateHistoryControls: () => { historyRefreshes += 1; },
});

assert.equal(elements.colorInput.value, "#ff0000");
assert.equal(elements.colorSwatch.style.backgroundColor, "#ff0000");
assert.equal(elements.controlsByKind.size.getAttribute("aria-valuenow"), "100");
assert.equal(elements.controlsByKind.opacity.getAttribute("aria-valuetext"), "Opacity 50%");

activeTool = "blend";
elements.colorInput.value = "#00ff00";
elements.colorInput.dispatchEvent(event("input"));
assert.equal(paintSelections, 1);
assert.equal(state.color, "#00ff00");
assert.equal(historyRefreshes, 1);

activeTool = "blend";
controller.syncAvailability(false);
assert.equal(elements.controlsByKind.size.getAttribute("aria-disabled"), "false");
assert.equal(elements.controlsByKind.opacity.getAttribute("aria-disabled"), "true");
assert.equal(elements.controlsByKind.stretch.getAttribute("aria-disabled"), "false");
controller.setLocked(true);
assert.equal(elements.colorInput.disabled, true);
assert.equal(elements.colorLabel.classList.contains("is-disabled"), true);
assert.equal(elements.controlsByKind.size.tabIndex, -1);
locked = false;
controller.setLocked(false);

// Keyboard commits immediately through the settings port.
activeTool = "paint";
controller.syncAvailability(false);
const key = event("keydown", { key: "ArrowUp", shiftKey: true, altKey: false, ctrlKey: false, metaKey: false });
elements.controlsByKind.size.dispatchEvent(key);
assert.equal(key.defaultPrevented, true);
assert.equal(state.size, 110);

// A drag previews continuously but commits exactly once at pointer-up.
const down = event("pointerdown", { button: 0, pointerId: 7, clientY: 100 });
elements.controlsByKind.opacity.dispatchEvent(down);
assert.equal(controller.isDragging, true);
assert.equal(elements.preview.getAttribute("aria-hidden"), "false");
elements.controlsByKind.opacity.dispatchEvent(event("pointermove", {
  pointerId: 7,
  clientY: 50,
}));
browser.flushFrames();
assert.equal(renderCalls.length, 1);
assert.equal(renderCalls[0][3], 0.75);
const quickCallsBeforeCommit = settingsCalls.filter((entry) => entry[0] === "quick").length;
elements.controlsByKind.opacity.dispatchEvent(event("pointerup", { pointerId: 7 }));
assert.equal(controller.isDragging, false);
assert.equal(
  settingsCalls.filter((entry) => entry[0] === "quick").length,
  quickCallsBeforeCommit + 1,
);
assert.equal(state.opacity, 0.75);

activeTool = "blend";
controller.syncVisibility();
assert.equal(elements.tracks.opacity.hidden, true);
assert.equal(elements.tracks.stretch.hidden, false);
surfaceSuppressed = true;
controller.syncVisibility();
assert.equal(elements.controls.classList.contains("is-suppressed"), true);
assert.equal(elements.controls.getAttribute("aria-hidden"), "true");

controller.dispose();
controller.dispose();
const callCountAfterDispose = settingsCalls.length;
elements.colorInput.value = "#0000ff";
elements.colorInput.dispatchEvent(event("input"));
assert.equal(settingsCalls.length, callCountAfterDispose);

console.log("Brush quick controls: color, keyboard, drag preview, commit, locks and disposal verified.");
