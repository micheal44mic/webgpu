import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "vite";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("index.html", root), "utf8");
const css = readFileSync(new URL("src/styles.css", root), "utf8");
const source = readFileSync(new URL("src/clone-tool-controller.ts", root), "utf8");

const cloneCardIndex = html.indexOf('data-mobile-canvas-tool="clone"');
assert.ok(cloneCardIndex > html.indexOf('data-mobile-canvas-tool="blend"'));
assert.ok(cloneCardIndex < html.indexOf('data-mobile-canvas-tool="fill"'));
assert.match(html, /data-mobile-canvas-tool="clone"[\s\S]*?data-lucide="copy"[\s\S]*?>Clone</);
assert.match(html, /id="cloneSetSource"[\s\S]*?>SET SOURCE</);
assert.match(
  html,
  /data-clone-sample-mode="current-and-below"[\s\S]*?aria-checked="true"/,
);
assert.match(html, /id="cloneAligned"[\s\S]*?aria-pressed="false"[\s\S]*?>ALIGNED</);
assert.match(html, /id="cloneAngle"[\s\S]*?min="-180"[\s\S]*?max="180"[\s\S]*?value="0"/);
assert.match(html, /id="cloneAngleValue"[\s\S]*?>0°</);
assert.match(html, /id="cloneAngleReset"[\s\S]*?>RESET</);
assert.match(html, /id="cloneSamplePreview"[\s\S]*?class="clone-sample-preview"/);
assert.match(
  html,
  /Visible raster layers only\. Vector and semantic objects are ignored until rasterized\./,
);
assert.match(css, /\.clone-source-overlay[\s\S]*?pointer-events:\s*none/);
assert.match(css, /\.clone-source-marker[\s\S]*?--clone-source-diameter/);
assert.match(css, /\.clone-sample-preview[\s\S]*?--clone-preview-diameter/);
assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.clone-sample-modes/);
assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.clone-angle-control/);
assert.match(source, /requestAnimationFrame/);
assert.doesNotMatch(source, /canvas\.addEventListener\("pointer/,
  "the central canvas-input owner must remain responsible for pointer routing");

const server = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: process.cwd(),
  server: { middlewareMode: true },
});
let CloneToolController;
try {
  ({ CloneToolController } = await server.ssrLoadModule("/src/clone-tool-controller.ts"));
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
  setProperty(name, value) { this.values.set(name, String(value)); }
  getPropertyValue(name) { return this.values.get(name) ?? ""; }
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
  textContent = "";
  rectangle = { left: 0, top: 0, right: 500, bottom: 400, width: 500, height: 400 };

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  getBoundingClientRect() { return { ...this.rectangle }; }
}

class FakeBrowser {
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
    const pending = [...this.frames.values()];
    this.frames.clear();
    for (const callback of pending) callback(0);
  }
}

class FakeDocument extends EventTarget {}

const event = (type, properties = {}) => {
  const result = new Event(type, { cancelable: true });
  for (const [name, value] of Object.entries(properties)) {
    Object.defineProperty(result, name, { configurable: true, value });
  }
  return result;
};

const browser = new FakeBrowser();
const document = new FakeDocument();
const canvas = new FakeElement();
const overlay = new FakeElement();
const marker = new FakeElement();
const previewCanvas = new FakeElement();
const dock = new FakeElement();
const setSourceButton = new FakeElement();
const alignedButton = new FakeElement();
const angleInput = new FakeElement();
angleInput.value = "0";
const angleValue = new FakeElement();
const angleResetButton = new FakeElement();
const status = new FakeElement();
const currentButton = new FakeElement();
currentButton.dataset.cloneSampleMode = "current";
const currentBelowButton = new FakeElement();
currentBelowButton.dataset.cloneSampleMode = "current-and-below";
const allVisibleButton = new FakeElement();
allVisibleButton.dataset.cloneSampleMode = "all-visible";
const sampleModeButtons = [currentButton, currentBelowButton, allVisibleButton];
const configurationChanges = [];
const previewChanges = [];
let locked = false;
let brushDiameter = 96;

const controller = new CloneToolController({
  browser,
  document,
  elements: {
    canvas,
    overlay,
    marker,
    previewCanvas,
    dock,
    setSourceButton,
    sampleModeButtons,
    alignedButton,
    angleInput,
    angleValue,
    angleResetButton,
    status,
  },
  toDocumentPoint: (clientX, clientY) => ({ x: clientX * 2, y: clientY * 2 }),
  getView: () => ({
    canvasWidth: 1000,
    canvasHeight: 800,
    centerX: 500,
    centerY: 400,
    zoom: 1,
    rotationCos: 1,
    rotationSin: 0,
  }),
  getBrushDiameterCssPixels: () => brushDiameter,
  isInteractionLocked: () => locked,
  onConfigurationChange: (state, reason) => configurationChanges.push({ state, reason }),
  onPreviewChange: (request) => previewChanges.push(request),
});

assert.equal(controller.isActive, false);
assert.equal(dock.hidden, true);
controller.setActive(true);
browser.flushFrames();
assert.equal(dock.hidden, false);
assert.equal(currentBelowButton.getAttribute("aria-checked"), "true");
assert.equal(alignedButton.getAttribute("aria-pressed"), "false");
assert.equal(angleValue.textContent, "0°");
assert.equal(angleResetButton.disabled, true);
assert.equal(overlay.hidden, true);

setSourceButton.dispatchEvent(event("click"));
assert.equal(controller.isSettingSource, true);
assert.equal(setSourceButton.getAttribute("aria-pressed"), "true");
let action = controller.beginPointer({
  pointerId: 7,
  pointerType: "touch",
  clientX: 100,
  clientY: 150,
});
assert.equal(action.kind, "source-pick-begin");
action = controller.updatePointer({
  pointerId: 7,
  pointerType: "touch",
  clientX: 110,
  clientY: 160,
});
assert.equal(action.kind, "source-preview");
action = controller.endPointer({
  pointerId: 7,
  pointerType: "touch",
  clientX: 110,
  clientY: 160,
}, true);
assert.deepEqual(action, {
  kind: "source-end",
  commit: true,
  sourcePoint: { x: 220, y: 320 },
});
assert.equal(controller.hasSource, true);
assert.equal(controller.isSettingSource, false);
assert.equal(configurationChanges.at(-1).reason, "source");
browser.flushFrames();
assert.equal(overlay.hidden, false);
assert.equal(marker.style.getPropertyValue("--clone-source-x"), "110px");
assert.equal(marker.style.getPropertyValue("--clone-source-y"), "160px");
assert.equal(marker.style.getPropertyValue("--clone-source-diameter"), "96px");
assert.equal(previewCanvas.hidden, false,
  "without hover, the first sample must remain visible at the persistent source anchor");
assert.equal(previewCanvas.style.getPropertyValue("--clone-preview-x"), "110px");
assert.equal(previewCanvas.style.getPropertyValue("--clone-preview-y"), "160px");
assert.deepEqual(previewChanges.at(-1), {
  sourcePoint: { x: 220, y: 320 },
  destinationPoint: { x: 220, y: 320 },
  angleDegrees: 0,
  sampleMode: "current-and-below",
  diameterCssPixels: 96,
});

controller.setSourcePreparing(true);
assert.equal(status.textContent, "Preparing the raster source…");
assert.equal(setSourceButton.disabled, false,
  "source controls must remain usable while the immutable raster source is prepared");
assert.equal(overlay.hidden, false, "the source marker must stay visible during preparation");
assert.equal(previewCanvas.hidden, true, "an invalidated source preview must hide immediately");
controller.setSourcePreparing(false);
assert.match(status.textContent, /Current & Below/);

// Clone samples and the visible marker advance with the same document delta.
action = controller.beginPointer({
  pointerId: 9,
  pointerType: "pen",
  clientX: 300,
  clientY: 300,
});
assert.equal(action.kind, "stroke-begin");
assert.deepEqual(action.sample.samplePoint, { x: 220, y: 320 });
assert.equal(action.sampleMode, "current-and-below");
action = controller.updatePointer({
  pointerId: 9,
  pointerType: "pen",
  clientX: 320,
  clientY: 330,
});
assert.equal(action.kind, "stroke-update");
assert.deepEqual(action.sample.samplePoint, { x: 260, y: 380 });
action = controller.endPointer({
  pointerId: 9,
  pointerType: "pen",
  clientX: 320,
  clientY: 330,
}, true);
assert.equal(action.kind, "stroke-end");
assert.equal(action.commit, true);

controller.handleHover({
  pointerId: 0,
  pointerType: "mouse",
  clientX: 330,
  clientY: 340,
});
browser.flushFrames();
assert.equal(marker.style.getPropertyValue("--clone-source-x"), "110px");
assert.equal(marker.style.getPropertyValue("--clone-source-y"), "160px");
assert.equal(previewCanvas.hidden, false);
assert.equal(previewCanvas.style.getPropertyValue("--clone-preview-x"), "330px");
assert.equal(previewCanvas.style.getPropertyValue("--clone-preview-y"), "340px");
assert.deepEqual(previewChanges.at(-1), {
  sourcePoint: { x: 220, y: 320 },
  destinationPoint: { x: 660, y: 680 },
  angleDegrees: 0,
  sampleMode: "current-and-below",
  diameterCssPixels: 96,
});

// Direct marker manipulation is isolated from clone strokes and is reversible.
action = controller.beginPointer({
  pointerId: 10,
  pointerType: "mouse",
  clientX: 110,
  clientY: 160,
});
assert.equal(action.kind, "source-drag-begin");
controller.updatePointer({
  pointerId: 10,
  pointerType: "mouse",
  clientX: 150,
  clientY: 210,
});
action = controller.cancelPointerForNavigation();
assert.equal(action.kind, "source-end");
assert.equal(action.commit, false);
assert.deepEqual(controller.snapshot().sourcePoint, { x: 220, y: 320 });

action = controller.beginPointer({
  pointerId: 11,
  pointerType: "mouse",
  clientX: 110,
  clientY: 160,
});
assert.equal(action.kind, "source-drag-begin");
action = controller.endPointer({
  pointerId: 11,
  pointerType: "mouse",
  clientX: 150,
  clientY: 210,
}, true);
assert.deepEqual(action.sourcePoint, { x: 300, y: 420 });
assert.deepEqual(controller.snapshot().sourcePoint, { x: 300, y: 420 });

currentButton.dispatchEvent(event("click"));
assert.equal(controller.snapshot().sampleMode, "current");
assert.equal(currentButton.getAttribute("aria-checked"), "true");
assert.equal(configurationChanges.at(-1).reason, "sample-mode");
alignedButton.dispatchEvent(event("click"));
assert.equal(controller.snapshot().aligned, true);
assert.equal(alignedButton.getAttribute("aria-pressed"), "true");
assert.equal(configurationChanges.at(-1).reason, "aligned");

angleInput.value = "90";
angleInput.dispatchEvent(event("input"));
assert.equal(controller.snapshot().angleDegrees, 90);
assert.equal(angleValue.textContent, "90°");
assert.equal(angleResetButton.disabled, false);
assert.equal(configurationChanges.at(-1).reason, "angle");
angleResetButton.dispatchEvent(event("click"));
assert.equal(controller.snapshot().angleDegrees, 0);
assert.equal(angleValue.textContent, "0°");
assert.equal(angleResetButton.disabled, true);
assert.equal(configurationChanges.at(-1).reason, "angle");

// The explicit modifier shares the same one-shot source path without arming the button.
controller.setSourcePoint(null);
action = controller.beginPointer({
  pointerId: 12,
  pointerType: "mouse",
  clientX: 200,
  clientY: 200,
});
assert.equal(action.kind, "needs-source");
action = controller.beginPointer({
  pointerId: 13,
  pointerType: "mouse",
  clientX: 40,
  clientY: 50,
}, true);
assert.equal(action.kind, "source-pick-begin");
action = controller.endPointer({
  pointerId: 13,
  pointerType: "mouse",
  clientX: 40,
  clientY: 50,
}, true);
assert.deepEqual(action.sourcePoint, { x: 80, y: 100 });

setSourceButton.dispatchEvent(event("click"));
assert.equal(controller.isSettingSource, true);
const escape = event("keydown", { key: "Escape" });
document.dispatchEvent(escape);
assert.equal(escape.defaultPrevented, true);
assert.equal(controller.isSettingSource, false);

// Marker notifications coalesce to one visual update per animation frame.
brushDiameter = 144;
controller.notifyBrushChange();
controller.notifyViewChange();
controller.notifyBrushChange();
assert.equal(browser.frames.size, 1);
browser.flushFrames();
assert.equal(marker.style.getPropertyValue("--clone-source-diameter"), "144px");

locked = true;
controller.notifyInteractionState();
assert.equal(setSourceButton.disabled, true);
assert.equal(alignedButton.disabled, true);
assert.equal(angleInput.disabled, true);
assert.equal(angleResetButton.disabled, true);
locked = false;
controller.notifyInteractionState();
assert.equal(setSourceButton.disabled, false);

controller.setActive(false);
assert.equal(dock.hidden, true);
assert.equal(overlay.hidden, true);
assert.equal(canvas.classList.contains("clone-tool-active"), false);
controller.dispose();
controller.dispose();

console.log("Clone tool controller: angle, preview, persistent source, marker, drag and rAF updates verified.");
