import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: process.cwd(),
  server: { middlewareMode: true },
});
let RasterGradientMapSurfaceController;
try {
  ({ RasterGradientMapSurfaceController } = await server.ssrLoadModule(
    "/src/raster-gradient-map-surface-controller.ts",
  ));
} finally {
  await server.close();
}

class FakeStyle {
  setProperty(name, value) { this[name] = value; }
}

class FakeClassList {
  values = new Set();
  toggle(name, force) {
    if (force) this.values.add(name);
    else this.values.delete(name);
  }
  contains(name) { return this.values.has(name); }
}

class FakeElement extends EventTarget {
  constructor(ownerDocument = null, tagName = "div") {
    super();
    this.ownerDocument = ownerDocument;
    this.tagName = tagName.toUpperCase();
  }
  attributes = new Map();
  classList = new FakeClassList();
  dataset = {};
  style = new FakeStyle();
  value = "";
  textContent = "";
  hidden = false;
  disabled = false;
  tabIndex = 0;
  focusCount = 0;
  clickCount = 0;
  children = [];
  parentNode = null;
  isConnected = true;
  type = "";
  className = "";
  rect = { left: 0, top: 0, right: 300, bottom: 44, width: 300, height: 44 };
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  toggleAttribute(name, force) {
    if (force) this.attributes.set(name, "");
    else this.attributes.delete(name);
  }
  append(...nodes) {
    for (const node of nodes) {
      node.parentNode = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this.append(...nodes);
  }
  contains(node) {
    return node === this || this.children.some((child) => child.contains(node));
  }
  closest(selector) {
    let current = this;
    while (current) {
      if (matchesSelector(current, selector)) return current;
      current = current.parentNode;
    }
    return null;
  }
  querySelectorAll(selector) {
    const result = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (matchesSelector(child, selector)) result.push(child);
        visit(child);
      }
    };
    visit(this);
    return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  focus() {
    this.focusCount += 1;
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }
  click() {
    this.clickCount += 1;
    this.dispatchEvent(event("click", { target: this }));
  }
  setPointerCapture() {}
  getBoundingClientRect() { return this.rect; }
}

function matchesSelector(element, selector) {
  if (selector === "[data-gradient-map-stop-id]") {
    return element.dataset.gradientMapStopId !== undefined;
  }
  const stopMatch = /^\[data-gradient-map-stop-id="(.+)"\]$/.exec(selector);
  if (stopMatch) return element.dataset.gradientMapStopId === stopMatch[1];
  if (selector === "button:not(:disabled)") {
    return element.tagName === "BUTTON" && !element.disabled;
  }
  return false;
}

class FakeDocument extends EventTarget {
  activeElement = null;
  createElement(tagName) { return new FakeElement(this, tagName); }
}

class FakeBrowser extends EventTarget {
  AbortController = globalThis.AbortController;
  innerWidth = 390;
  innerHeight = 844;
  timers = new Map();
  nextTimer = 1;
  setTimeout(callback) {
    const id = this.nextTimer++;
    this.timers.set(id, callback);
    return id;
  }
  clearTimeout(id) { this.timers.delete(id); }
  fireTimers() {
    const callbacks = [...this.timers.values()];
    this.timers.clear();
    callbacks.forEach((callback) => callback());
  }
}

function event(type, properties = {}) {
  const value = new Event(type, { cancelable: true, bubbles: true });
  for (const [name, property] of Object.entries(properties)) {
    Object.defineProperty(value, name, { configurable: true, value: property });
  }
  return value;
}

const document = new FakeDocument();
const browser = new FakeBrowser();
const element = (tag = "div") => new FakeElement(document, tag);
const presetButton = (id) => {
  const button = element("button");
  button.dataset.gradientMapPresetId = id;
  return button;
};
const interpolationButton = (id) => {
  const button = element("button");
  button.dataset.gradientMapInterpolation = id;
  return button;
};

const previousFocus = element("button");
document.activeElement = previousFocus;
const canvas = element("canvas");
canvas.tabIndex = -1;
canvas.setAttribute("aria-keyshortcuts", "Space");
const presetButtons = [presetButton("mono"), presetButton("sunset")];
const chooserCancelButton = element("button");
const chooser = element();
chooser.append(...presetButtons, chooserCancelButton);
const editor = element();
const presetsButton = element("button");
const gradientTrack = element();
gradientTrack.rect = { left: 50, top: 700, right: 350, bottom: 744, width: 300, height: 44 };
const gradientPreview = element();
const stopLayer = element();
gradientTrack.append(gradientPreview, stopLayer);
const settingsButton = element("button");
const reverseButton = element("button");
const ditherButton = element("button");
const interpolationButtons = [
  interpolationButton("perceptual"),
  interpolationButton("linear-light"),
  interpolationButton("encoded-rgb"),
];
const settingsMenu = element();
settingsMenu.append(reverseButton, ditherButton, ...interpolationButtons);
settingsMenu.hidden = true;
const resetButton = element("button");
const cancelButton = element("button");
const actionMenu = element();
actionMenu.append(resetButton, cancelButton);
actionMenu.hidden = true;
actionMenu.rect = { left: 0, top: 0, right: 220, bottom: 60, width: 220, height: 60 };
const surface = element();
surface.rect = { left: 9, top: 730, right: 381, bottom: 835, width: 372, height: 105 };
const colorInput = element("input");
colorInput.showPickerCount = 0;
colorInput.showPicker = () => { colorInput.showPickerCount += 1; };
const elements = {
  surface,
  chooser,
  presetButtons,
  chooserCancelButton,
  editor,
  presetsButton,
  gradientTrack,
  gradientPreview,
  stopLayer,
  colorInput,
  settingsButton,
  settingsMenu,
  reverseButton,
  ditherButton,
  interpolationButtons,
  actionMenu,
  resetButton,
  cancelButton,
};

const presets = [
  {
    id: "mono",
    label: "Monochrome",
    settings: {
      stops: [
        { position: 0, color: [0, 0, 0] },
        { position: 1, color: [1, 1, 1] },
      ],
      reverse: false,
      dither: false,
      interpolation: "perceptual",
    },
  },
  {
    id: "sunset",
    label: "Sunset",
    settings: {
      stops: [
        { position: 0, color: [0.1, 0, 0.25] },
        { position: 0.5, color: [0.95, 0.2, 0.25] },
        { position: 1, color: [1, 0.8, 0.2] },
      ],
      reverse: false,
      dither: true,
      interpolation: "encoded-rgb",
    },
  },
];
const changes = [];
const colorRequests = [];
let resets = 0;
let cancels = 0;
const controller = new RasterGradientMapSurfaceController({
  browser,
  document,
  canvas,
  elements,
  presets,
  onChange: (settings, selectedPresetId) => changes.push({ settings, selectedPresetId }),
  onRequestColor: (stop) => colorRequests.push(stop),
  onRequestReset: () => { resets += 1; },
  onRequestCancel: () => { cancels += 1; },
});

assert.equal(surface.hidden, true);
assert.equal(colorInput.type, "color");
assert.equal(gradientTrack.style.minHeight, "44px");
for (const button of [
  ...presetButtons,
  chooserCancelButton,
  presetsButton,
  settingsButton,
  reverseButton,
  ditherButton,
  ...interpolationButtons,
  resetButton,
  cancelButton,
]) {
  assert.equal(button.style.minWidth, "44px");
  assert.equal(button.style.minHeight, "44px");
}

assert.equal(controller.open(), true);
assert.equal(surface.hidden, false);
assert.equal(chooser.hidden, false);
assert.equal(editor.hidden, true);
assert.equal(surface.classList.contains("is-chooser"), true);
assert.equal(controller.isEditing, false);
assert.equal(controller.state, null);
assert.equal(changes.length, 0, "opening the chooser must not start an effect");
assert.equal(presetButtons[0].focusCount, 1);
assert.equal(canvas.classList.contains("raster-gradient-map-active"), true);
assert.equal(canvas.tabIndex, 0);
assert.equal(canvas.getAttribute("aria-keyshortcuts"), "Shift+F10 Escape");

chooserCancelButton.click();
assert.equal(cancels, 1, "the chooser must provide a visible close action");
const chooserEscape = event("keydown", { key: "Escape", target: presetButtons[0] });
chooser.dispatchEvent(chooserEscape);
assert.equal(chooserEscape.defaultPrevented, true);
assert.equal(cancels, 2, "Escape in the chooser must cancel");

const chooserEnd = event("keydown", { key: "End", target: presetButtons[0] });
chooser.dispatchEvent(chooserEnd);
assert.equal(chooserEnd.defaultPrevented, true);
assert.equal(presetButtons[1].focusCount, 1);

presetButtons[1].click();
assert.equal(controller.isEditing, true);
assert.equal(controller.activePresetId, "sunset");
assert.equal(chooser.hidden, true);
assert.equal(editor.hidden, false);
assert.equal(surface.classList.contains("is-chooser"), false);
assert.equal(changes.length, 1);
assert.equal(changes[0].selectedPresetId, "sunset");
assert.equal(changes[0].settings.stops.length, 3);
assert.equal(presetButtons[1].getAttribute("aria-pressed"), "true");
assert.match(gradientPreview.style.background, /^linear-gradient\(to right,/);
assert.equal(stopLayer.children.length, 3);
for (const handle of stopLayer.children) {
  assert.equal(handle.style.width, "44px");
  assert.equal(handle.style.height, "44px");
  assert.equal(handle.style.touchAction, "none");
}
const beforePresetReturn = changes.length;
presetsButton.click();
assert.equal(chooser.hidden, false);
assert.equal(surface.classList.contains("is-chooser"), true);
assert.equal(presetButtons[1].getAttribute("aria-pressed"), "true", "the chosen preset must stay selected");
presetButtons[1].click();
assert.equal(changes.length, beforePresetReturn + 1);

let handles = stopLayer.children;
const firstHandle = handles[0];
firstHandle.rect = { left: 50, top: 760, right: 94, bottom: 804, width: 44, height: 44 };
firstHandle.dispatchEvent(event("pointerdown", {
  pointerId: 1,
  button: 0,
  clientX: 50,
  target: firstHandle,
}));
firstHandle.dispatchEvent(event("pointerup", {
  pointerId: 1,
  clientX: 50,
  target: firstHandle,
}));
assert.equal(colorRequests.length, 1);
assert.equal(colorInput.showPickerCount, 1, "the native picker must open from its stop anchor");
assert.equal(colorInput.clickCount, 0, "showPicker avoids a second synthetic click");
assert.equal(colorInput.style.left, "63.00px", "the picker anchor must align to the stop center");
assert.equal(colorInput.style.top, "35.50px", "the picker anchor must sit above the color swatch");
const beforeColorChange = changes.length;
const handlesBeforeLiveColor = [...stopLayer.children];
const handleFocusBeforeLiveColor = firstHandle.focusCount;
document.activeElement = colorInput;
colorInput.value = "#336699";
colorInput.dispatchEvent(event("input", { target: colorInput }));
assert.equal(changes.length, beforeColorChange + 1, "live color input must update once");
assert.equal(
  stopLayer.children.length === handlesBeforeLiveColor.length
    && stopLayer.children.every((handle, index) => handle === handlesBeforeLiveColor[index]),
  true,
  "live color input must preserve the existing stop-handle elements",
);
assert.equal(
  document.activeElement,
  colorInput,
  "live color input must not steal focus from the open native picker",
);
assert.equal(firstHandle.focusCount, handleFocusBeforeLiveColor);
colorInput.dispatchEvent(event("change", { target: colorInput }));
assert.equal(changes.length, beforeColorChange + 1, "input/change must not emit twice");
assert.equal(document.activeElement, firstHandle, "final color change must restore the stop focus");
assert.equal(firstHandle.focusCount, handleFocusBeforeLiveColor + 1);
assert.equal(changes.at(-1).selectedPresetId, null, "editing a preset creates a custom map");
assert.deepEqual(
  changes.at(-1).settings.stops[0].color.map((channel) => Number(channel.toFixed(3))),
  [0.2, 0.4, 0.6],
);

const cancelsBeforeEditorEscape = cancels;
const handleEscape = event("keydown", { key: "Escape", target: firstHandle });
surface.dispatchEvent(handleEscape);
assert.equal(handleEscape.defaultPrevented, true);
assert.equal(cancels, cancelsBeforeEditorEscape + 1, "Escape from a stop handle must cancel");
const dockEscape = event("keydown", { key: "Escape", target: gradientTrack });
surface.dispatchEvent(dockEscape);
assert.equal(dockEscape.defaultPrevented, true);
assert.equal(cancels, cancelsBeforeEditorEscape + 2, "Escape from the editor dock must cancel");

const beforeAdd = changes.length;
gradientTrack.dispatchEvent(event("pointerdown", {
  pointerId: 2,
  button: 0,
  clientX: 125,
  target: gradientTrack,
}));
assert.equal(changes.length, beforeAdd + 1);
assert.equal(controller.state.stops.length, 4);
assert.equal(colorRequests.length, 2, "a new stop must immediately request its color");

handles = stopLayer.children;
const addedHandle = handles.find((handle) => handle.getAttribute("aria-pressed") === "true");
const beforeDragColorRequests = colorRequests.length;
addedHandle.dispatchEvent(event("pointerdown", {
  pointerId: 3,
  button: 0,
  clientX: 125,
  target: addedHandle,
}));
addedHandle.dispatchEvent(event("pointermove", {
  pointerId: 3,
  clientX: 275,
  target: addedHandle,
}));
addedHandle.dispatchEvent(event("pointerup", {
  pointerId: 3,
  clientX: 275,
  target: addedHandle,
}));
assert.equal(colorRequests.length, beforeDragColorRequests, "dragging must not open the color input");
assert.ok(controller.state.stops.some((stop) => Math.abs(stop.position - 0.75) < 1e-8));

const selectedAfterDrag = stopLayer.children.find(
  (handle) => handle.getAttribute("aria-pressed") === "true",
);
const positionBeforeKeyboard = Number(selectedAfterDrag.getAttribute("aria-valuenow"));
selectedAfterDrag.dispatchEvent(event("keydown", {
  key: "ArrowLeft",
  shiftKey: true,
  target: selectedAfterDrag,
}));
const selectedAfterKeyboard = stopLayer.children.find(
  (handle) => handle.getAttribute("aria-pressed") === "true",
);
assert.equal(
  Number(selectedAfterKeyboard.getAttribute("aria-valuenow")),
  positionBeforeKeyboard - 5,
  "Shift+Arrow must move a stop by five percent",
);

selectedAfterKeyboard.dispatchEvent(event("keydown", {
  key: "Delete",
  target: selectedAfterKeyboard,
}));
assert.equal(controller.state.stops.length, 3);
const nextSelected = stopLayer.children.find(
  (handle) => handle.getAttribute("aria-pressed") === "true",
);
nextSelected.dispatchEvent(event("keydown", { key: "Delete", target: nextSelected }));
assert.equal(controller.state.stops.length, 3, "endpoint stops must not be deletable");

gradientTrack.dispatchEvent(event("pointerdown", {
  pointerId: 4,
  button: 0,
  clientX: 200,
  target: gradientTrack,
}));
const longPressHandle = stopLayer.children.find(
  (handle) => handle.getAttribute("aria-pressed") === "true",
);
longPressHandle.dispatchEvent(event("pointerdown", {
  pointerId: 5,
  button: 0,
  clientX: 200,
  target: longPressHandle,
}));
browser.fireTimers();
assert.equal(controller.state.stops.length, 3, "long-pressing a non-endpoint stop must delete it");

for (let index = 0; index < 14; index += 1) {
  gradientTrack.dispatchEvent(event("pointerdown", {
    pointerId: 20 + index,
    button: 0,
    clientX: 60 + index * 16,
    target: gradientTrack,
  }));
}
assert.equal(controller.state.stops.length, 12, "the editor must cap maps at twelve stops");

settingsButton.click();
assert.equal(settingsMenu.hidden, false);
assert.equal(settingsButton.getAttribute("aria-expanded"), "true");
reverseButton.click();
assert.equal(controller.state.reverse, true);
assert.equal(reverseButton.getAttribute("aria-checked"), "true");
ditherButton.click();
assert.equal(controller.state.dither, false);
interpolationButtons[1].click();
assert.equal(controller.state.interpolation, "linear-light");
assert.equal(settingsMenu.hidden, true);
assert.equal(settingsButton.focusCount, 1);

const openSettingsWithKeyboard = event("keydown", { key: "ArrowUp", target: settingsButton });
settingsButton.dispatchEvent(openSettingsWithKeyboard);
assert.equal(openSettingsWithKeyboard.defaultPrevented, true);
assert.equal(interpolationButtons[2].focusCount, 1);
const settingsHome = event("keydown", { key: "Home", target: interpolationButtons[2] });
settingsMenu.dispatchEvent(settingsHome);
assert.equal(reverseButton.focusCount, 1);
const settingsEscape = event("keydown", { key: "Escape", target: reverseButton });
settingsMenu.dispatchEvent(settingsEscape);
assert.equal(settingsMenu.hidden, true);
assert.equal(settingsButton.focusCount, 2);

settingsButton.click();
document.dispatchEvent(event("pointerdown", { target: canvas }));
assert.equal(settingsMenu.hidden, true, "outside pointer input must dismiss settings");
settingsButton.click();
document.dispatchEvent(event("focusin", { target: canvas }));
assert.equal(settingsMenu.hidden, true, "focus leaving settings must dismiss it");

const cancelsBeforeBusyPrepare = cancels;
controller.setDisabled(true, true);
assert.equal(surface.getAttribute("aria-busy"), "true");
assert.equal(settingsButton.disabled, true);
assert.equal(stopLayer.children.every((handle) => handle.disabled), true);
assert.equal(chooserCancelButton.disabled, false);
assert.equal(cancelButton.disabled, false, "Cancel must stay enabled while prepare can be aborted");
const busyPrepareEscape = event("keydown", { key: "Escape", target: gradientTrack });
surface.dispatchEvent(busyPrepareEscape);
assert.equal(busyPrepareEscape.defaultPrevented, true);
assert.equal(cancels, cancelsBeforeBusyPrepare + 1);

controller.setDisabled(true, false);
assert.equal(chooserCancelButton.disabled, true);
assert.equal(cancelButton.disabled, true, "Cancel must lock while a commit is terminal");
const busyCommitEscape = event("keydown", { key: "Escape", target: gradientTrack });
surface.dispatchEvent(busyCommitEscape);
assert.equal(busyCommitEscape.defaultPrevented, false);
assert.equal(cancels, cancelsBeforeBusyPrepare + 1);
cancelButton.click();
assert.equal(cancels, cancelsBeforeBusyPrepare + 1);
controller.setDisabled(false);

canvas.dispatchEvent(event("pointerdown", {
  pointerId: 70,
  button: 0,
  clientX: 370,
  clientY: 680,
  target: canvas,
}));
browser.fireTimers();
assert.equal(actionMenu.hidden, false);
assert.equal(actionMenu.style.left, "158px");
assert.equal(actionMenu.style.top, "606px");
assert.equal(actionMenu.dataset.placement, "above");
assert.equal(resetButton.focusCount, 1);
const siblingActionEscape = event("keydown", { key: "Escape", target: resetButton });
actionMenu.dispatchEvent(siblingActionEscape);
assert.equal(siblingActionEscape.defaultPrevented, true);
assert.equal(actionMenu.hidden, true, "Escape must close the sibling action menu");
assert.equal(gradientTrack.focusCount, 1);
canvas.dispatchEvent(event("contextmenu", {
  clientX: 370,
  clientY: 680,
  target: canvas,
}));
assert.equal(actionMenu.hidden, false);
const cancelsBeforeActionMenu = cancels;
resetButton.click();
cancelButton.click();
assert.equal(resets, 1);
assert.equal(cancels, cancelsBeforeActionMenu + 1);

controller.setState({
  stops: [
    { position: 0, color: [0, 0, 0] },
    { position: 1, color: [1, 1, 1] },
  ],
  reverse: false,
  dither: true,
  interpolation: "linear-light",
});
gradientTrack.dispatchEvent(event("pointerdown", {
  pointerId: 90,
  button: 0,
  clientX: 200,
  target: gradientTrack,
}));
const sampledMiddle = controller.state.stops.find(
  (stop) => Math.abs(stop.position - 0.5) < 1e-8,
);
assert.ok(sampledMiddle.color[0] > 0.7, "new stops must use the selected interpolation sampler");
reverseButton.click();
assert.equal(controller.state.reverse, true);
const reversedSelected = stopLayer.children.find(
  (handle) => handle.getAttribute("aria-pressed") === "true",
);
assert.equal(reversedSelected.getAttribute("aria-valuenow"), "50");
reversedSelected.dispatchEvent(event("keydown", {
  key: "ArrowLeft",
  shiftKey: true,
  target: reversedSelected,
}));
const reversedSelectedAfterKey = stopLayer.children.find(
  (handle) => handle.getAttribute("aria-pressed") === "true",
);
assert.equal(
  reversedSelectedAfterKey.getAttribute("aria-valuenow"),
  "45",
  "ArrowLeft must always move left visually while Reverse is enabled",
);
assert.ok(
  controller.state.stops.some((stop) => Math.abs(stop.position - 0.55) < 1e-8),
  "visual left movement under Reverse must increase the logical stop position",
);
controller.reset();
assert.equal(controller.activePresetId, "sunset", "Reset must retain the initial preset baseline");
assert.equal(controller.state.stops.length, 3);
assert.equal(controller.state.dither, true);
const beforeChooser = changes.length;
presetsButton.click();
assert.equal(controller.isEditing, false);
assert.equal(controller.state, null);
assert.equal(changes.length, beforeChooser, "returning to the chooser must not emit a map");

controller.close();
assert.equal(surface.hidden, true);
assert.equal(canvas.classList.contains("raster-gradient-map-active"), false);
assert.equal(canvas.tabIndex, -1);
assert.equal(canvas.getAttribute("aria-keyshortcuts"), "Space");
assert.equal(previousFocus.focusCount, 1, "closing must restore the previous focus target");
controller.dispose();

assert.throws(
  () => new RasterGradientMapSurfaceController({
    browser,
    document,
    canvas,
    elements,
    presets: [presets[0], presets[0]],
    onChange() {},
    onRequestReset() {},
    onRequestCancel() {},
  }),
  /unique and non-empty/,
);

console.log("Gradient Map preset, stop, settings, touch and keyboard controls verified.");
