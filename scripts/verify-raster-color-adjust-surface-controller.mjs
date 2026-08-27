import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: process.cwd(),
  server: { middlewareMode: true },
});
let RasterColorAdjustSurfaceController;
try {
  ({ RasterColorAdjustSurfaceController } = await server.ssrLoadModule(
    "/src/raster-color-adjust-surface-controller.ts",
  ));
} finally {
  await server.close();
}

class FakeClassList {
  values = new Set();
  toggle(name, force) { if (force) this.values.add(name); else this.values.delete(name); }
  contains(name) { return this.values.has(name); }
}

class FakeElement extends EventTarget {
  attributes = new Map();
  classList = new FakeClassList();
  dataset = {};
  style = {};
  value = "";
  textContent = "";
  hidden = false;
  disabled = false;
  focusCount = 0;
  firstButton = null;
  rect = { left: 0, top: 600, right: 220, bottom: 660, width: 220, height: 60 };
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  toggleAttribute(name, force) {
    if (force) this.attributes.set(name, "");
    else this.attributes.delete(name);
  }
  contains(node) { return node === this || node === this.firstButton; }
  querySelector() { return this.firstButton; }
  focus() { this.focusCount += 1; }
  getBoundingClientRect() { return this.rect; }
}

class FakeDocument extends EventTarget {}

class FakeBrowser extends EventTarget {
  AbortController = globalThis.AbortController;
  document = new FakeDocument();
  innerWidth = 390;
  innerHeight = 844;
  timers = new Map();
  nextTimer = 1;
  setTimeout(callback) { const id = this.nextTimer++; this.timers.set(id, callback); return id; }
  clearTimeout(id) { this.timers.delete(id); }
  fireTimers() {
    const callbacks = [...this.timers.values()];
    this.timers.clear();
    callbacks.forEach((callback) => callback());
  }
}

function event(type, properties = {}) {
  const value = new Event(type, { cancelable: true });
  for (const [name, property] of Object.entries(properties)) {
    Object.defineProperty(value, name, { configurable: true, value: property });
  }
  return value;
}

const browser = new FakeBrowser();
const canvas = new FakeElement();
const resetButton = new FakeElement();
const cancelButton = new FakeElement();
const menu = new FakeElement();
menu.firstButton = resetButton;
menu.rect = { left: 0, top: 0, right: 220, bottom: 60, width: 220, height: 60 };
const elements = {
  surface: new FakeElement(),
  hueInput: new FakeElement(),
  hueOutput: new FakeElement(),
  saturationInput: new FakeElement(),
  saturationOutput: new FakeElement(),
  brightnessInput: new FakeElement(),
  brightnessOutput: new FakeElement(),
  menu,
  resetButton,
  cancelButton,
};
elements.surface.rect = { left: 9, top: 730, right: 381, bottom: 835, width: 372, height: 105 };
const updates = [];
let resets = 0;
let cancels = 0;
const controller = new RasterColorAdjustSurfaceController({
  browser,
  document: browser.document,
  canvas,
  elements,
  onChange: (settings) => updates.push(settings),
  onRequestReset: () => { resets += 1; },
  onRequestCancel: () => { cancels += 1; },
});

assert.equal(elements.surface.hidden, true);
controller.open({ hueDegrees: 0, saturationPercent: 0, brightnessPercent: 0 });
assert.equal(elements.surface.hidden, false);
assert.equal(elements.hueInput.value, "50");
assert.equal(elements.hueOutput.value, "0°");

elements.hueInput.value = "75";
elements.saturationInput.value = "60";
elements.brightnessInput.value = "40";
elements.brightnessInput.dispatchEvent(event("input"));
assert.deepEqual(updates.at(-1), {
  hueDegrees: 90,
  saturationPercent: 20,
  brightnessPercent: -20,
});
assert.equal(elements.hueOutput.value, "90°");
assert.equal(elements.saturationOutput.value, "+20%");
assert.equal(elements.brightnessOutput.value, "-20%");

canvas.dispatchEvent(event("pointerdown", {
  pointerId: 1,
  button: 0,
  clientX: 370,
  clientY: 680,
}));
browser.fireTimers();
assert.equal(menu.hidden, false);
assert.equal(resetButton.focusCount, 1);
assert.equal(menu.style.left, "158px", "menu must stay inside the right edge");
assert.equal(menu.style.top, "606px", "lower touches must place the menu just above the finger");
assert.equal(menu.dataset.placement, "above");

resetButton.dispatchEvent(event("click"));
cancelButton.dispatchEvent(event("click"));
assert.equal(resets, 1);
assert.equal(cancels, 1);

menu.hidden = true;
canvas.dispatchEvent(event("pointerup", { pointerId: 1 }));
canvas.dispatchEvent(event("pointerdown", {
  pointerId: 2,
  button: 0,
  clientX: 195,
  clientY: 150,
}));
browser.fireTimers();
assert.equal(menu.hidden, false);
assert.equal(menu.style.left, "85px", "menu must be horizontally centered on the touch");
assert.equal(menu.style.top, "164px", "upper touches must place the menu just below the finger");
assert.equal(menu.dataset.placement, "below");

menu.hidden = true;
canvas.dispatchEvent(event("pointerup", { pointerId: 2 }));
canvas.dispatchEvent(event("pointerdown", {
  pointerId: 3,
  button: 0,
  clientX: 20,
  clientY: 300,
}));
browser.fireTimers();
assert.equal(menu.hidden, false);
assert.equal(menu.style.left, "12px", "left-edge touches must open the menu toward the right");
assert.equal(menu.style.top, "314px");

menu.hidden = true;
canvas.dispatchEvent(event("pointerup", { pointerId: 3 }));
canvas.dispatchEvent(event("pointerdown", {
  pointerId: 4,
  button: 0,
  clientX: 100,
  clientY: 100,
}));
canvas.dispatchEvent(event("pointermove", {
  pointerId: 4,
  clientX: 112,
  clientY: 100,
}));
browser.fireTimers();
assert.equal(menu.hidden, true, "movement beyond the threshold must cancel long press");

controller.close();
assert.equal(elements.surface.hidden, true);
assert.equal(canvas.classList.contains("raster-color-adjust-active"), false);
controller.dispose();

console.log("Raster Color Adjust surface, sliders and long-press actions verified.");
