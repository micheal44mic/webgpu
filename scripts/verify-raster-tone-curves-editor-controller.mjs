import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "vite";

const editorSource = readFileSync(
  new URL("../src/raster-tone-curves-editor-controller.ts", import.meta.url),
  "utf8",
);
const adjustmentSource = readFileSync(
  new URL("../src/raster-adjustments-controller.ts", import.meta.url),
  "utf8",
);
const stylesSource = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
assert.match(editorSource, /POINTER_HIT_RADIUS_TOUCH = 24/);
assert.match(editorSource, /addEventListener\("lostpointercapture"/);
assert.match(
  editorSource,
  /const compiledCurve = compileRasterToneCurve\(points\)[\s\S]{0,700}evaluateCompiledRasterToneCurve\(compiledCurve, x\)/,
  "The graph must compile its curve once per frame rather than once per pixel.",
);
assert.match(
  adjustmentSource,
  /classList\.toggle\("raster-curves-active", state\.surfaceOpen\)/,
  "The Curves transaction must expose its active state to mobile presentation chrome.",
);
assert.match(
  stylesSource,
  /#gpuCanvas\.raster-curves-active ~ \.gpu-memory-monitor\s*\{[\s\S]*?pointer-events:\s*none;/,
  "The diagnostic badge must not intercept Curves actions.",
);
assert.match(
  stylesSource,
  /\.mobile-curves-sheet\s*\{[\s\S]*?--mobile-curves-handle-height:\s*44px;/,
  "The Curves sheet handle must reserve a 44px touch target.",
);
assert.match(
  stylesSource,
  /\.mobile-curves-sheet \.mobile-tools-sheet-handle\s*\{[\s\S]*?min-height:\s*44px;[\s\S]*?flex-basis:\s*44px;/,
);

const server = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: process.cwd(),
  server: { middlewareMode: true },
});

let RasterToneCurvesEditorController;
let DEFAULT_RASTER_TONE_CURVE_SET;
try {
  ({ RasterToneCurvesEditorController } = await server.ssrLoadModule(
    "/src/raster-tone-curves-editor-controller.ts",
  ));
  ({ DEFAULT_RASTER_TONE_CURVE_SET } = await server.ssrLoadModule(
    "/src/raster-tone-curves-core.ts",
  ));
} finally {
  await server.close();
}

class FakeElement extends EventTarget {
  attributes = new Map();
  disabled = false;
  value = "";
  width = 300;
  height = 300;
  captures = new Set();

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  toggleAttribute(name, enabled) {
    if (enabled) this.setAttribute(name, "");
    else this.removeAttribute(name);
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, right: 300, bottom: 300, width: 300, height: 300 };
  }
  setPointerCapture(pointerId) { this.captures.add(pointerId); }
  releasePointerCapture(pointerId) { this.captures.delete(pointerId); }
  hasPointerCapture(pointerId) { return this.captures.has(pointerId); }
  getContext() { return null; }
}

class FakeBrowser {
  AbortController = globalThis.AbortController;
  devicePixelRatio = 2;
  nextFrame = 1;
  frames = new Map();
  requestAnimationFrame = (callback) => {
    const id = this.nextFrame++;
    this.frames.set(id, callback);
    return id;
  };
  cancelAnimationFrame = (id) => { this.frames.delete(id); };
  flushFrames() {
    const entries = [...this.frames.entries()];
    this.frames.clear();
    for (const [, callback] of entries) callback(0);
  }
}

function uiEvent(type, properties = {}) {
  const value = new Event(type, { cancelable: true });
  for (const [name, property] of Object.entries(properties)) {
    Object.defineProperty(value, name, { configurable: true, value: property });
  }
  return value;
}

function pointerEvent(type, properties = {}) {
  return uiEvent(type, {
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    clientX: 150,
    clientY: 150,
    ...properties,
  });
}

const browser = new FakeBrowser();
const elements = {
  canvas: new FakeElement(),
  channelSelect: new FakeElement(),
  inputValue: new FakeElement(),
  outputValue: new FakeElement(),
  autoButton: new FakeElement(),
  resetButton: new FakeElement(),
  deleteButton: new FakeElement(),
};
const changes = [];
const editor = new RasterToneCurvesEditorController({
  browser,
  elements,
  onChange: (curves) => changes.push(curves),
});
browser.flushFrames();

assert.equal(elements.channelSelect.value, "composite");
assert.equal(elements.canvas.getAttribute("aria-disabled"), "true");
editor.setDisabled(false);
assert.equal(elements.canvas.getAttribute("aria-disabled"), "false");

// Mouse and touch share Pointer Events: a blank-graph tap creates a selected point,
// continuous movement publishes live updates, and release clears pointer capture.
elements.canvas.dispatchEvent(pointerEvent("pointerdown"));
assert.equal(editor.snapshot().composite.length, 3);
assert.equal(elements.canvas.hasPointerCapture(1), true);
elements.canvas.dispatchEvent(pointerEvent("pointermove", { clientX: 190, clientY: 112 }));
elements.canvas.dispatchEvent(pointerEvent("pointerup", { clientX: 190, clientY: 112 }));
assert.equal(elements.canvas.hasPointerCapture(1), false);
assert.ok(changes.length >= 2);
const movedPoint = editor.snapshot().composite[1];
assert.ok(movedPoint.x > 0.5 && movedPoint.y > 0.5);

// Numeric Input/Output values alter the selected point and permit endpoint
// input clipping instead of silently forcing the domain back to 0..1.
elements.outputValue.value = "200";
elements.outputValue.dispatchEvent(uiEvent("input"));
assert.equal(Math.round(editor.snapshot().composite[1].y * 255), 200);
elements.canvas.dispatchEvent(pointerEvent("pointerdown", { clientX: 12, clientY: 288 }));
elements.canvas.dispatchEvent(pointerEvent("pointerup", { clientX: 12, clientY: 288 }));
elements.inputValue.value = "24";
elements.inputValue.dispatchEvent(uiEvent("input"));
assert.equal(Math.round(editor.snapshot().composite[0].x * 255), 24);

// Channel state is independent. Reset affects only the selected channel.
elements.channelSelect.value = "red";
elements.channelSelect.dispatchEvent(uiEvent("change"));
elements.canvas.dispatchEvent(pointerEvent("pointerdown", { pointerId: 2, pointerType: "touch" }));
elements.canvas.dispatchEvent(pointerEvent("pointercancel", { pointerId: 2, pointerType: "touch" }));
assert.equal(elements.canvas.hasPointerCapture(2), false);
assert.equal(editor.snapshot().red.length, 3);
assert.equal(editor.snapshot().composite.length, 3);
elements.resetButton.dispatchEvent(uiEvent("click"));
assert.deepEqual(editor.snapshot().red, DEFAULT_RASTER_TONE_CURVE_SET.red);
assert.equal(editor.snapshot().composite.length, 3);

// Keyboard-only editing can create a point, traverse the point list and then
// remove the selected internal point without relying on a pointer.
elements.canvas.dispatchEvent(uiEvent("keydown", { key: "Enter", shiftKey: false }));
assert.equal(editor.snapshot().red.length, 3);
elements.canvas.dispatchEvent(uiEvent("keydown", { key: "End", shiftKey: false }));
assert.equal(elements.inputValue.value, "255");
elements.canvas.dispatchEvent(uiEvent("keydown", { key: "PageUp", shiftKey: false }));
assert.equal(elements.inputValue.value, "128");
elements.canvas.dispatchEvent(uiEvent("keydown", { key: "Delete", shiftKey: false }));
assert.deepEqual(editor.snapshot().red, DEFAULT_RASTER_TONE_CURVE_SET.red);

// Losing browser pointer capture must release the gesture owner so the next
// mouse or touch interaction is accepted immediately.
elements.canvas.dispatchEvent(pointerEvent("pointerdown", { pointerId: 3, pointerType: "touch" }));
assert.equal(elements.canvas.hasPointerCapture(3), true);
elements.canvas.dispatchEvent(pointerEvent("lostpointercapture", { pointerId: 3, pointerType: "touch" }));
assert.equal(elements.canvas.hasPointerCapture(3), false);
elements.canvas.dispatchEvent(pointerEvent("pointerdown", { pointerId: 4 }));
assert.equal(elements.canvas.hasPointerCapture(4), true);
elements.canvas.dispatchEvent(pointerEvent("pointerup", { pointerId: 4 }));
elements.resetButton.dispatchEvent(uiEvent("click"));

// Auto uses the selected channel's histogram only and produces stable clipping
// points. Delete removes an internal point while preserving both endpoints.
const histogram = new Uint32Array(1024);
for (let bin = 40; bin <= 200; bin += 1) histogram[256 + bin] = 100;
editor.setHistogram(histogram);
elements.autoButton.dispatchEvent(uiEvent("click"));
assert.equal(editor.snapshot().red.length, 4);
assert.equal(Math.round(editor.snapshot().red[1].x * 255), 40);
elements.canvas.dispatchEvent(uiEvent("keydown", { key: "Delete", shiftKey: false }));
assert.equal(editor.snapshot().red.length, 3);

// Disabled state is a hard input gate, not merely visual styling.
elements.canvas.dispatchEvent(pointerEvent("pointerdown", { pointerId: 8, pointerType: "touch" }));
assert.equal(elements.canvas.hasPointerCapture(8), true);
const beforeDisabled = changes.length;
editor.setDisabled(true);
assert.equal(
  elements.canvas.hasPointerCapture(8),
  false,
  "Closing the editor must not leave a stale pointer capture that blocks the next session.",
);
elements.canvas.dispatchEvent(pointerEvent("pointerdown", { pointerId: 9 }));
elements.outputValue.value = "10";
elements.outputValue.dispatchEvent(uiEvent("input"));
assert.equal(changes.length, beforeDisabled);

editor.dispose();
editor.dispose();
assert.equal(browser.frames.size, 0);

console.log("Raster tone curves editor pointer, touch, keyboard and channel state verified.");
