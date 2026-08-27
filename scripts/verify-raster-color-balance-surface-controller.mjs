import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: process.cwd(),
  server: { middlewareMode: true },
});
let RasterColorBalanceSurfaceController;
try {
  ({ RasterColorBalanceSurfaceController } = await server.ssrLoadModule(
    "/src/raster-color-balance-surface-controller.ts",
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
  tabIndex = 0;
  focusCount = 0;
  children = [];
  firstButton = null;
  rect = { left: 0, top: 600, right: 220, bottom: 660, width: 220, height: 60 };
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  toggleAttribute(name, force) {
    if (force) this.attributes.set(name, "");
    else this.attributes.delete(name);
  }
  contains(node) { return node === this || this.children.includes(node); }
  querySelector(selector) {
    if (selector.includes("menuitemradio")) {
      return this.children.find((child) => child.getAttribute("aria-checked") === "true") ?? null;
    }
    return this.firstButton;
  }
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

function toneButton(tone) {
  const button = new FakeElement();
  button.dataset.colorBalanceTone = tone;
  button.setAttribute("role", "menuitemradio");
  return button;
}

const browser = new FakeBrowser();
const canvas = new FakeElement();
canvas.tabIndex = -1;
canvas.setAttribute("aria-keyshortcuts", "Space");
const toneButtons = ["shadows", "midtones", "highlights"].map(toneButton);
const resetButton = new FakeElement();
const cancelButton = new FakeElement();
const settingsMenu = new FakeElement();
settingsMenu.children = toneButtons;
const actionMenu = new FakeElement();
actionMenu.firstButton = resetButton;
actionMenu.children = [resetButton, cancelButton];
actionMenu.rect = { left: 0, top: 0, right: 220, bottom: 60, width: 220, height: 60 };
settingsMenu.hidden = true;
actionMenu.hidden = true;
const elements = {
  surface: new FakeElement(),
  cyanRedInput: new FakeElement(),
  cyanRedOutput: new FakeElement(),
  magentaGreenInput: new FakeElement(),
  magentaGreenOutput: new FakeElement(),
  yellowBlueInput: new FakeElement(),
  yellowBlueOutput: new FakeElement(),
  toneButton: new FakeElement(),
  toneButtonLabel: new FakeElement(),
  settingsMenu,
  toneButtons,
  preserveLuminosityButton: new FakeElement(),
  actionMenu,
  resetButton,
  cancelButton,
};
elements.surface.rect = { left: 9, top: 730, right: 381, bottom: 835, width: 372, height: 105 };
const updates = [];
let resets = 0;
let cancels = 0;
const controller = new RasterColorBalanceSurfaceController({
  browser,
  document: browser.document,
  canvas,
  elements,
  onChange: (settings) => updates.push(settings),
  onRequestReset: () => { resets += 1; },
  onRequestCancel: () => { cancels += 1; },
});

assert.equal(elements.surface.hidden, true);
for (const input of [
  elements.cyanRedInput,
  elements.magentaGreenInput,
  elements.yellowBlueInput,
]) {
  assert.equal(input.min, "-100");
  assert.equal(input.max, "100");
  assert.equal(input.step, "1");
}

controller.open({
  shadows: { cyanRedPercent: 11, magentaGreenPercent: -12, yellowBluePercent: 13 },
  midtones: { cyanRedPercent: -21, magentaGreenPercent: 22, yellowBluePercent: -23 },
  highlights: { cyanRedPercent: 31, magentaGreenPercent: -32, yellowBluePercent: 33 },
  preserveLuminosity: true,
});
assert.equal(elements.surface.hidden, false);
assert.equal(elements.toneButtonLabel.textContent, "Midtones");
assert.equal(elements.toneButton.getAttribute("aria-label"), "Tone range: Midtones");
assert.equal(elements.cyanRedInput.value, "-21");
assert.equal(elements.magentaGreenOutput.value, "+22%");
assert.equal(elements.yellowBlueOutput.value, "-23%");
assert.equal(elements.cyanRedInput.getAttribute("aria-valuetext"), "21 percent toward cyan");
assert.equal(elements.magentaGreenInput.getAttribute("aria-valuetext"), "22 percent toward green");
assert.equal(elements.yellowBlueInput.getAttribute("aria-valuetext"), "23 percent toward yellow");
assert.equal(elements.preserveLuminosityButton.getAttribute("aria-checked"), "true");
assert.equal(elements.preserveLuminosityButton.classList.contains("is-enabled"), true);
assert.equal(canvas.tabIndex, 0);
assert.equal(canvas.getAttribute("aria-keyshortcuts"), "Shift+F10 Escape");
assert.equal(canvas.classList.contains("raster-color-balance-active"), true);

const openWithKeyboard = event("keydown", { key: "ArrowDown" });
elements.toneButton.dispatchEvent(openWithKeyboard);
assert.equal(openWithKeyboard.defaultPrevented, true);
assert.equal(settingsMenu.hidden, false);
assert.equal(toneButtons[0].focusCount, 1);
const endInMenu = event("keydown", { key: "End" });
settingsMenu.dispatchEvent(endInMenu);
assert.equal(endInMenu.defaultPrevented, true);
assert.equal(elements.preserveLuminosityButton.focusCount, 1);
const escapeFromMenu = event("keydown", { key: "Escape" });
settingsMenu.dispatchEvent(escapeFromMenu);
assert.equal(escapeFromMenu.defaultPrevented, true);
assert.equal(settingsMenu.hidden, true);
assert.equal(elements.toneButton.focusCount, 1);

elements.toneButton.dispatchEvent(event("click"));
const tabFromMenu = event("keydown", { key: "Tab" });
settingsMenu.dispatchEvent(tabFromMenu);
assert.equal(tabFromMenu.defaultPrevented, false);
assert.equal(settingsMenu.hidden, true);

const midtoneFocusBefore = toneButtons[1].focusCount;
elements.toneButton.dispatchEvent(event("click"));
assert.equal(settingsMenu.hidden, false);
assert.equal(elements.toneButton.getAttribute("aria-expanded"), "true");
assert.equal(toneButtons[1].focusCount, midtoneFocusBefore + 1);
const updateCountBeforeToneSwitch = updates.length;
toneButtons[0].dispatchEvent(event("click"));
assert.equal(settingsMenu.hidden, true);
assert.equal(elements.toneButtonLabel.textContent, "Shadows");
assert.equal(elements.cyanRedInput.value, "11");
assert.equal(elements.magentaGreenInput.value, "-12");
assert.equal(updates.length, updateCountBeforeToneSwitch);

elements.cyanRedInput.value = "44";
elements.magentaGreenInput.value = "-55";
elements.yellowBlueInput.value = "66";
elements.yellowBlueInput.dispatchEvent(event("input"));
assert.deepEqual(updates.at(-1), {
  shadows: { cyanRedPercent: 44, magentaGreenPercent: -55, yellowBluePercent: 66 },
  midtones: { cyanRedPercent: -21, magentaGreenPercent: 22, yellowBluePercent: -23 },
  highlights: { cyanRedPercent: 31, magentaGreenPercent: -32, yellowBluePercent: 33 },
  preserveLuminosity: true,
});

elements.toneButton.dispatchEvent(event("click"));
elements.preserveLuminosityButton.dispatchEvent(event("click"));
assert.equal(settingsMenu.hidden, true);
assert.equal(updates.at(-1).preserveLuminosity, false);
assert.equal(elements.preserveLuminosityButton.getAttribute("aria-checked"), "false");
assert.equal(elements.preserveLuminosityButton.classList.contains("is-enabled"), false);

elements.toneButton.dispatchEvent(event("click"));
controller.setDisabled(true);
assert.equal(settingsMenu.hidden, true);
assert.equal(elements.surface.getAttribute("aria-busy"), "true");
assert.equal(elements.toneButton.disabled, true);
assert.equal(elements.cyanRedInput.disabled, true);
assert.equal(elements.resetButton.disabled, true);
controller.setDisabled(false);

canvas.dispatchEvent(event("pointerdown", {
  pointerId: 1,
  button: 0,
  clientX: 370,
  clientY: 680,
}));
browser.fireTimers();
assert.equal(actionMenu.hidden, false);
assert.equal(resetButton.focusCount, 1);
assert.equal(actionMenu.style.left, "158px", "menu must stay inside the right edge");
assert.equal(actionMenu.style.top, "606px", "lower touches must place the menu above the finger");
assert.equal(actionMenu.dataset.placement, "above");
resetButton.dispatchEvent(event("click"));
cancelButton.dispatchEvent(event("click"));
assert.equal(resets, 1);
assert.equal(cancels, 1);

actionMenu.hidden = true;
canvas.dispatchEvent(event("pointerup", { pointerId: 1 }));
canvas.dispatchEvent(event("pointerdown", {
  pointerId: 2,
  button: 0,
  clientX: 20,
  clientY: 150,
}));
browser.fireTimers();
assert.equal(actionMenu.style.left, "12px", "left-edge touches must open toward the right");
assert.equal(actionMenu.style.top, "164px");
assert.equal(actionMenu.dataset.placement, "below");

actionMenu.hidden = true;
canvas.dispatchEvent(event("pointerup", { pointerId: 2 }));
canvas.dispatchEvent(event("pointerdown", {
  pointerId: 3,
  button: 0,
  clientX: 100,
  clientY: 100,
}));
canvas.dispatchEvent(event("pointermove", {
  pointerId: 3,
  clientX: 112,
  clientY: 100,
}));
browser.fireTimers();
assert.equal(actionMenu.hidden, true, "movement beyond the threshold must cancel long press");

elements.toneButton.dispatchEvent(event("click"));
const escape = event("keydown", { key: "Escape", shiftKey: false });
canvas.dispatchEvent(escape);
assert.equal(escape.defaultPrevented, true);
assert.equal(settingsMenu.hidden, true);

controller.close();
assert.equal(elements.surface.hidden, true);
assert.equal(canvas.classList.contains("raster-color-balance-active"), false);
assert.equal(canvas.tabIndex, -1);
assert.equal(canvas.getAttribute("aria-keyshortcuts"), "Space");
controller.dispose();

console.log("Raster Color Balance tonal controls, settings and long-press actions verified.");
