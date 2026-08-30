import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "vite";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("index.html", root), "utf8");
const mainSource = readFileSync(new URL("src/main.ts", root), "utf8");

assert.match(
  html,
  /id="mobileToolsMenu"[\s\S]*?<\/button>\s*<button\s+id="editorFiltersMenu"[\s\S]*?<\/button>\s*<button\s+id="editorSettingsMenu"/,
  "Filters must sit between the Tools and Settings header actions",
);
assert.match(
  html,
  /<button\b[^>]*id="editorSettingsMenu"[^>]*aria-controls="editorSettingsPanel"[^>]*aria-expanded="false"[^>]*>/,
  "the Settings trigger must expose its controlled panel and initial state",
);
assert.match(
  html,
  /<aside\b[^>]*id="editorSettingsPanel"[^>]*aria-label="Settings"[^>]*aria-hidden="true"[^>]*\binert\b[^>]*>/,
  "the initially closed Settings panel must be labelled, hidden and inert",
);
assert.match(
  html,
  /<div\b[^>]*id="editorBrushPrecision"[^>]*role="radiogroup"[^>]*aria-label="Brush precision"[^>]*aria-describedby="editorBrushPrecisionHint"[^>]*>/,
  "Brush precision must be exposed as a labelled radio group with explanatory text",
);
for (const [precision, checked, label] of [
  ["r8unorm", false, "8-bit"],
  ["r16float", true, "16-bit"],
]) {
  assert.match(
    html,
    new RegExp(`<button\\b[^>]*role="radio"[^>]*aria-checked="${checked}"[^>]*data-editor-brush-precision="${precision}"[^>]*>\\s*${label}\\s*<\\/button>`),
    `${label} must remain an accessible Brush precision choice`,
  );
}
assert.doesNotMatch(
  html,
  /data-mobile-brush-shape-mask-format/,
  "Brush Studio must not retain a competing per-brush precision selector",
);

for (const [id, hint] of [
  ["editorRulersEnabled", "editorRulersHint"],
  ["editorGridEnabled", "editorGridHint"],
  ["editorPixelGridEnabled", "editorPixelGridHint"],
  ["editorSnappingEnabled", "editorSnappingHint"],
  ["editorSymmetryEnabled", "editorSymmetryHint"],
]) {
  assert.match(
    html,
    new RegExp(`<label[^>]*for="${id}"[\\s\\S]*?<\\/label>`),
    `#${id} must have a visible associated label`,
  );
  assert.match(
    html,
    new RegExp(`<input\\b[^>]*id="${id}"[^>]*type="checkbox"[^>]*>`),
    `#${id} must remain a native checkbox`,
  );
  assert.match(
    html,
    new RegExp(`<input\\b[^>]*id="${id}"[^>]*aria-describedby="${hint}"[^>]*>`),
    `#${id} must reference its explanatory text`,
  );
}
assert.match(
  html,
  /<button\b[^>]*id="editorSymmetryOptionsButton"[^>]*aria-controls="editorSymmetryOptions"[^>]*aria-expanded="false"[^>]*>/,
  "the Symmetry options button must expose its controlled disclosure state",
);
assert.match(
  html,
  /<fieldset\b[^>]*id="editorSymmetryOptions"[^>]*aria-hidden="true"[^>]*\bhidden\b[^>]*>/,
  "the Symmetry options must start hidden from every user",
);
for (const [angle, pressed, label] of [
  [90, true, "Vertical"],
  [0, false, "Horizontal"],
]) {
  assert.match(
    html,
    new RegExp(`<button\\b[^>]*data-editor-symmetry-angle="${angle}"[^>]*aria-pressed="${pressed}"[^>]*>[\\s\\S]*?${label}[\\s\\S]*?<\\/button>`),
    `${label} must remain an accessible angle preset`,
  );
}
for (const [id, type] of [
  ["editorSymmetryAngle", "range"],
  ["editorSymmetryAngleValue", "number"],
]) {
  assert.match(
    html,
    new RegExp(`<input\\b[^>]*id="${id}"[^>]*type="${type}"[^>]*min="0"[^>]*max="179"[^>]*step="1"[^>]*value="90"[^>]*>`),
    `#${id} must expose the complete half-turn angle range`,
  );
}

const initialBrushPrecisionApplication = mainSource.indexOf(
  "applyGlobalBrushPrecision(editorSettingsController.preferences.brushPrecision);",
);
const engineInitialization = mainSource.indexOf("void engine.initialize()");
assert.ok(
  initialBrushPrecisionApplication >= 0
    && engineInitialization >= 0
    && initialBrushPrecisionApplication < engineInitialization,
  "the persisted Brush precision must be applied before engine initialization",
);
assert.match(
  mainSource,
  /function applyBrushSettings\(\s*settings: Readonly<BrushSettings>,\s*options: Readonly<\{ preserveCanvasTool\?: boolean \}> = \{\},\s*\): void \{[\s\S]*?brushSettingsController\.replace\(\{[\s\S]*?shapeMaskFormat:\s*editorSettingsController\?\.preferences\.brushPrecision\s*\?\?\s*DEFAULT_EDITOR_GUIDE_PREFERENCES\.brushPrecision,[\s\S]*?\}\);/,
  "every applied brush must be forced through the global Brush precision preference",
);
assert.match(
  mainSource,
  /new MobileBrushStudioController\(\{[\s\S]*?getBrushPrecision:\s*\(\)\s*=>\s*editorSettingsController\?\.preferences\.brushPrecision\s*\?\?\s*DEFAULT_EDITOR_GUIDE_PREFERENCES\.brushPrecision,[\s\S]*?applySettings:\s*applyBrushSettings,/,
  "Brush Studio must read the global Brush precision instead of owning one",
);
assert.match(
  mainSource,
  /new EditorSettingsController\(\{[\s\S]*?canOpen:\s*\(\)\s*=>\s*!interactionLocked\(\)[\s\S]*?mobileBrushStudio\?\.isBusy !== true/,
  "Settings must remain closed while editor interaction is locked",
);
assert.match(
  mainSource,
  /pixelGridInput:\s*editorPixelGridEnabledInput/,
  "the persisted Pixel grid toggle must be wired into Settings",
);
assert.match(
  html,
  /id="editorPixelGridHint"[\s\S]{0,120}1000% zoom and above/,
  "the Pixel grid hint must match its dedicated activation threshold",
);

const moduleServer = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: process.cwd(),
  server: { middlewareMode: true },
});

let EditorSettingsController;
let DEFAULT_EDITOR_GUIDE_PREFERENCES;
let EDITOR_SETTINGS_STORAGE_KEY;
let loadEditorGuidePreferences;
let normalizeBrushPrecision;
let normalizeSymmetryAngleDegrees;
let saveEditorGuidePreferences;
try {
  ({
    DEFAULT_EDITOR_GUIDE_PREFERENCES,
    EDITOR_SETTINGS_STORAGE_KEY,
    loadEditorGuidePreferences,
    normalizeBrushPrecision,
    normalizeSymmetryAngleDegrees,
    saveEditorGuidePreferences,
  } = await moduleServer.ssrLoadModule("/src/editor-settings-storage.ts"));
  ({ EditorSettingsController } = await moduleServer.ssrLoadModule(
    "/src/editor-settings-controller.ts",
  ));
} finally {
  await moduleServer.close();
}

const defaults = {
  rulers: false,
  grid: false,
  pixelGrid: true,
  snapping: true,
  symmetryEnabled: false,
  symmetryAngleDegrees: 90,
  brushPrecision: "r16float",
};
assert.deepEqual(DEFAULT_EDITOR_GUIDE_PREFERENCES, defaults);
assert.equal(EDITOR_SETTINGS_STORAGE_KEY, "m1m4.editor-settings.v1");
assert.equal(normalizeSymmetryAngleDegrees(-1), 179);
assert.equal(normalizeSymmetryAngleDegrees(180), 0);
assert.equal(normalizeSymmetryAngleDegrees(541), 1);
assert.equal(normalizeSymmetryAngleDegrees(37.6), 38);
assert.equal(normalizeSymmetryAngleDegrees("45", 90), 90);
assert.equal(normalizeBrushPrecision("r8unorm"), "r8unorm");
assert.equal(normalizeBrushPrecision("r16float"), "r16float");
for (const malformed of [undefined, null, "rgba8unorm", "R16F", 8, {}]) {
  assert.equal(
    normalizeBrushPrecision(malformed),
    "r16float",
    `malformed Brush precision must fall back to 16-bit: ${String(malformed)}`,
  );
}

class FakeStorage {
  constructor(serialized = null, options = {}) {
    this.serialized = serialized;
    this.throwOnGet = options.throwOnGet === true;
    this.throwOnSet = options.throwOnSet === true;
    this.onSet = options.onSet ?? (() => {});
  }

  reads = [];
  writes = [];

  getItem(key) {
    this.reads.push(key);
    if (this.throwOnGet) throw new Error("storage read blocked");
    return this.serialized;
  }

  setItem(key, value) {
    if (this.throwOnSet) throw new Error("storage write blocked");
    this.onSet(key, value);
    this.writes.push([key, value]);
    this.serialized = value;
  }
}

assert.deepEqual(loadEditorGuidePreferences(null), defaults);
assert.deepEqual(loadEditorGuidePreferences(new FakeStorage()), defaults);
assert.deepEqual(
  loadEditorGuidePreferences(new FakeStorage(null, { throwOnGet: true })),
  defaults,
  "a blocked storage read must fall back to defaults",
);
for (const serialized of [
  "{broken",
  "null",
  "[]",
  JSON.stringify({ version: 2, preferences: { grid: true } }),
  JSON.stringify({ version: 1 }),
]) {
  assert.deepEqual(
    loadEditorGuidePreferences(new FakeStorage(serialized)),
    defaults,
    `invalid persisted settings must be rejected: ${serialized}`,
  );
}

for (const brushPrecision of [undefined, null, "rgba8unorm", "R16F", 8, {}]) {
  const preferences = {
    rulers: true,
    grid: true,
    pixelGrid: false,
    snapping: false,
    symmetryEnabled: true,
    symmetryAngleDegrees: 23,
    brushPrecision,
  };
  assert.deepEqual(
    loadEditorGuidePreferences(new FakeStorage(JSON.stringify({
      version: 1,
      preferences,
    }))),
    {
      ...preferences,
      brushPrecision: "r16float",
    },
    `missing or malformed persisted Brush precision must migrate to 16-bit: ${String(brushPrecision)}`,
  );
}

for (const [legacyAxis, expectedAngle] of [
  ["horizontal", 0],
  ["vertical", 90],
]) {
  assert.deepEqual(
    loadEditorGuidePreferences(new FakeStorage(JSON.stringify({
      version: 1,
      preferences: {
        rulers: true,
        grid: false,
        snapping: true,
        symmetryEnabled: false,
        symmetryAxis: legacyAxis,
      },
    }))),
    {
      rulers: true,
      grid: false,
      pixelGrid: true,
      snapping: true,
      symmetryEnabled: false,
      symmetryAngleDegrees: expectedAngle,
      brushPrecision: "r16float",
    },
    `legacy ${legacyAxis} settings must migrate to an angle`,
  );
}

const roundTripStorage = new FakeStorage();
const customPreferences = {
  rulers: false,
  grid: true,
  pixelGrid: false,
  snapping: false,
  symmetryEnabled: true,
  symmetryAngleDegrees: 37,
  brushPrecision: "r8unorm",
};
assert.equal(saveEditorGuidePreferences(roundTripStorage, customPreferences), true);
assert.deepEqual(JSON.parse(roundTripStorage.serialized), {
  version: 1,
  preferences: customPreferences,
});
assert.deepEqual(
  loadEditorGuidePreferences(roundTripStorage),
  customPreferences,
  "a custom angle must survive a cold load",
);
assert.equal(saveEditorGuidePreferences(null, defaults), false);
assert.equal(
  saveEditorGuidePreferences(new FakeStorage(null, { throwOnSet: true }), defaults),
  false,
  "a blocked storage write must not escape the persistence boundary",
);
const normalizedSaveStorage = new FakeStorage();
saveEditorGuidePreferences(normalizedSaveStorage, {
  rulers: 0,
  grid: true,
  snapping: null,
  symmetryEnabled: "true",
  symmetryAngleDegrees: 181,
  brushPrecision: "rgba8unorm",
});
assert.deepEqual(JSON.parse(normalizedSaveStorage.serialized).preferences, {
  rulers: false,
  grid: true,
  pixelGrid: true,
  snapping: true,
  symmetryEnabled: false,
  symmetryAngleDegrees: 1,
  brushPrecision: "r16float",
}, "save must serialize canonical angle and Brush precision values");

class FakeClassList {
  values = new Set();
  add(...names) { for (const name of names) this.values.add(name); }
  remove(...names) { for (const name of names) this.values.delete(name); }
  contains(name) { return this.values.has(name); }
}

class FakeDocument extends EventTarget {
  activeElement = null;
}

class FakeElement extends EventTarget {
  constructor(ownerDocument) {
    super();
    this.ownerDocument = ownerDocument;
  }

  attributes = new Map();
  classList = new FakeClassList();
  contained = new Set();
  hidden = false;
  checked = false;
  value = "";
  tabIndex = 0;
  isConnected = true;
  offsetWidth = 320;
  focusCount = 0;

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  toggleAttribute(name, force) {
    const present = force === undefined ? !this.attributes.has(name) : Boolean(force);
    if (present) this.attributes.set(name, "");
    else this.attributes.delete(name);
    return present;
  }
  contains(node) { return node === this || this.contained.has(node); }
  focus() {
    this.focusCount += 1;
    this.ownerDocument.activeElement = this;
  }
}

function keyEvent(key) {
  const event = new Event("keydown", { cancelable: true });
  Object.defineProperty(event, "key", { value: key });
  return event;
}

function createHarness({
  storage = new FakeStorage(),
  initiallyCanOpen = true,
  preferenceEvent = () => {},
  brushPrecisionValues = ["r8unorm", "r16float"],
} = {}) {
  const document = new FakeDocument();
  const trigger = new FakeElement(document);
  const panel = new FakeElement(document);
  const closeButton = new FakeElement(document);
  const brushPrecisionButtons = brushPrecisionValues.map((precision) => {
    const button = new FakeElement(document);
    button.setAttribute("data-editor-brush-precision", precision);
    return button;
  });
  const rulersInput = new FakeElement(document);
  const gridInput = new FakeElement(document);
  const pixelGridInput = new FakeElement(document);
  const snappingInput = new FakeElement(document);
  const symmetryEnabledInput = new FakeElement(document);
  const symmetryOptionsButton = new FakeElement(document);
  const symmetryOptionsPanel = new FakeElement(document);
  const verticalPreset = new FakeElement(document);
  verticalPreset.setAttribute("data-editor-symmetry-angle", "90");
  const horizontalPreset = new FakeElement(document);
  horizontalPreset.setAttribute("data-editor-symmetry-angle", "0");
  const symmetryPresetButtons = [verticalPreset, horizontalPreset];
  const symmetryAngleInput = new FakeElement(document);
  const symmetryAngleValueInput = new FakeElement(document);
  for (const element of [
    closeButton,
    ...brushPrecisionButtons,
    rulersInput,
    gridInput,
    pixelGridInput,
    snappingInput,
    symmetryEnabledInput,
    symmetryOptionsButton,
    symmetryOptionsPanel,
    ...symmetryPresetButtons,
    symmetryAngleInput,
    symmetryAngleValueInput,
  ]) panel.contained.add(element);
  const elements = {
    trigger,
    panel,
    closeButton,
    brushPrecisionButtons,
    rulersInput,
    gridInput,
    pixelGridInput,
    snappingInput,
    symmetryEnabledInput,
    symmetryOptionsButton,
    symmetryOptionsPanel,
    symmetryPresetButtons,
    symmetryAngleInput,
    symmetryAngleValueInput,
  };
  let canOpen = initiallyCanOpen;
  const lifecycle = [];
  const preferenceChanges = [];
  const controller = new EditorSettingsController({
    browser: { AbortController },
    document,
    storage,
    elements,
    canOpen: () => canOpen,
    beforeOpen: () => lifecycle.push("before-open"),
    onOpenChange: (open) => lifecycle.push(open ? "opened" : "closed"),
    onPreferencesChange: (preferences) => {
      preferenceChanges.push({ ...preferences });
      preferenceEvent(preferences);
    },
  });
  return {
    controller,
    document,
    elements,
    lifecycle,
    preferenceChanges,
    storage,
    setCanOpen(value) { canOpen = value; },
  };
}

for (const brushPrecisionValues of [
  [],
  ["r8unorm"],
  ["r16float"],
  ["r8unorm", "r8unorm"],
  ["r16float", "r16float"],
  ["r8unorm", "rgba8unorm"],
]) {
  assert.throws(
    () => createHarness({ brushPrecisionValues }),
    /Brush precision controls are incomplete/,
    `controller must reject incomplete precision controls: ${brushPrecisionValues.join(",")}`,
  );
}

// Construction restores a custom angle without treating startup as a user change.
{
  const storage = new FakeStorage(JSON.stringify({
    version: 1,
    preferences: customPreferences,
  }));
  const harness = createHarness({ storage });
  assert.deepEqual(harness.controller.preferences, customPreferences);
  assert.equal(harness.elements.gridInput.checked, true);
  assert.equal(harness.elements.pixelGridInput.checked, false);
  assert.equal(harness.elements.snappingInput.checked, false);
  assert.equal(harness.elements.symmetryEnabledInput.checked, true);
  assert.equal(harness.elements.symmetryAngleInput.value, "37");
  assert.equal(harness.elements.symmetryAngleValueInput.value, "37");
  assert.equal(harness.elements.brushPrecisionButtons[0].getAttribute("aria-checked"), "true");
  assert.equal(harness.elements.brushPrecisionButtons[0].tabIndex, 0);
  assert.equal(harness.elements.brushPrecisionButtons[1].getAttribute("aria-checked"), "false");
  assert.equal(harness.elements.brushPrecisionButtons[1].tabIndex, -1);
  assert.equal(harness.elements.symmetryPresetButtons[0].getAttribute("aria-pressed"), "false");
  assert.equal(harness.elements.symmetryPresetButtons[1].getAttribute("aria-pressed"), "false");
  assert.equal(harness.elements.symmetryOptionsPanel.hidden, true);
  assert.equal(harness.elements.symmetryOptionsButton.getAttribute("aria-expanded"), "false");
  assert.deepEqual(harness.preferenceChanges, []);
  const snapshot = harness.controller.preferences;
  snapshot.grid = false;
  assert.equal(harness.controller.preferences.grid, true);
  harness.controller.dispose();
}

// Pixel grid is a persisted visual preference independent from adaptive-grid snapping.
{
  const storage = new FakeStorage();
  const harness = createHarness({ storage });
  harness.elements.pixelGridInput.checked = false;
  harness.elements.pixelGridInput.dispatchEvent(new Event("change"));
  assert.equal(harness.controller.preferences.pixelGrid, false);
  assert.equal(harness.controller.preferences.grid, false);
  assert.equal(harness.controller.preferences.snapping, true);
  assert.equal(
    JSON.parse(storage.writes.at(-1)[1]).preferences.pixelGrid,
    false,
  );
  harness.controller.dispose();
}

// Precision changes publish and persist exactly once, with roving radio focus.
{
  const order = [];
  const storage = new FakeStorage(null, { onSet: () => order.push("persist") });
  const harness = createHarness({
    storage,
    preferenceEvent: () => order.push("live"),
  });
  const [eightBitButton, sixteenBitButton] = harness.elements.brushPrecisionButtons;

  eightBitButton.dispatchEvent(new Event("click"));
  assert.equal(harness.controller.preferences.brushPrecision, "r8unorm");
  assert.deepEqual(order, ["live", "persist"]);
  assert.equal(harness.preferenceChanges.length, 1);
  assert.equal(storage.writes.length, 1);
  assert.equal(eightBitButton.getAttribute("aria-checked"), "true");
  assert.equal(eightBitButton.tabIndex, 0);
  assert.equal(sixteenBitButton.getAttribute("aria-checked"), "false");
  assert.equal(sixteenBitButton.tabIndex, -1);

  eightBitButton.dispatchEvent(new Event("click"));
  assert.equal(harness.preferenceChanges.length, 1, "clicking the active choice must be inert");
  assert.equal(storage.writes.length, 1, "clicking the active choice must not persist again");

  const right = keyEvent("ArrowRight");
  eightBitButton.dispatchEvent(right);
  assert.equal(right.defaultPrevented, true);
  assert.equal(harness.controller.preferences.brushPrecision, "r16float");
  assert.equal(harness.preferenceChanges.length, 2);
  assert.equal(storage.writes.length, 2);
  assert.equal(sixteenBitButton.focusCount, 1);
  assert.equal(sixteenBitButton.getAttribute("aria-checked"), "true");
  assert.equal(sixteenBitButton.tabIndex, 0);

  const left = keyEvent("ArrowLeft");
  sixteenBitButton.dispatchEvent(left);
  assert.equal(left.defaultPrevented, true);
  assert.equal(harness.controller.preferences.brushPrecision, "r8unorm");
  assert.equal(harness.preferenceChanges.length, 3);
  assert.equal(storage.writes.length, 3);
  assert.equal(eightBitButton.focusCount, 1);

  const end = keyEvent("End");
  eightBitButton.dispatchEvent(end);
  assert.equal(harness.controller.preferences.brushPrecision, "r16float");
  assert.equal(harness.preferenceChanges.length, 4);
  assert.equal(storage.writes.length, 4);
  assert.equal(sixteenBitButton.focusCount, 2);
  harness.controller.dispose();
}

// A failed live application rolls the selected radio and preference back atomically.
{
  const storage = new FakeStorage();
  const harness = createHarness({
    storage,
    preferenceEvent: () => {
      throw new Error("precision apply failed");
    },
  });
  const [eightBitButton, sixteenBitButton] = harness.elements.brushPrecisionButtons;
  assert.throws(
    () => harness.controller.applyBrushPrecision("r8unorm"),
    /precision apply failed/,
  );
  assert.equal(harness.controller.preferences.brushPrecision, "r16float");
  assert.equal(eightBitButton.getAttribute("aria-checked"), "false");
  assert.equal(eightBitButton.tabIndex, -1);
  assert.equal(sixteenBitButton.getAttribute("aria-checked"), "true");
  assert.equal(sixteenBitButton.tabIndex, 0);
  assert.equal(harness.preferenceChanges.length, 1);
  assert.equal(storage.writes.length, 0, "a failed live application must not persist");
  harness.controller.dispose();
}

// Open policy, disclosure state, close button and Escape share one lifecycle.
{
  const harness = createHarness({ initiallyCanOpen: false });
  harness.elements.trigger.dispatchEvent(new Event("click"));
  assert.equal(harness.controller.isOpen, false);
  harness.setCanOpen(true);
  harness.elements.trigger.dispatchEvent(new Event("click"));
  assert.equal(harness.controller.isOpen, true);
  assert.deepEqual(harness.lifecycle, ["before-open", "opened"]);
  assert.equal(harness.elements.panel.getAttribute("inert"), null);
  harness.elements.symmetryOptionsButton.dispatchEvent(new Event("click"));
  assert.equal(harness.elements.symmetryOptionsPanel.hidden, false);
  assert.equal(harness.elements.symmetryOptionsButton.getAttribute("aria-expanded"), "true");
  harness.document.activeElement = harness.elements.closeButton;
  harness.elements.closeButton.dispatchEvent(new Event("click"));
  assert.equal(harness.controller.isOpen, false);
  assert.equal(harness.elements.symmetryOptionsPanel.hidden, true);
  harness.controller.setOpen(true);
  harness.document.activeElement = harness.elements.gridInput;
  const escape = keyEvent("Escape");
  harness.document.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(harness.controller.isOpen, false);
  harness.controller.dispose();
}

// Presets and custom inputs publish live, while drag persistence happens on commit.
{
  const order = [];
  const storage = new FakeStorage(null, { onSet: () => order.push("persist") });
  const harness = createHarness({
    storage,
    preferenceEvent: () => order.push("live"),
  });
  harness.elements.gridInput.checked = true;
  harness.elements.gridInput.dispatchEvent(new Event("change"));
  assert.deepEqual(order, ["live", "persist"]);

  const writesBeforePreset = storage.writes.length;
  harness.elements.symmetryPresetButtons[1].dispatchEvent(new Event("click"));
  assert.equal(harness.controller.preferences.symmetryAngleDegrees, 0);
  assert.equal(storage.writes.length, writesBeforePreset + 1);
  assert.equal(harness.elements.symmetryPresetButtons[1].getAttribute("aria-pressed"), "true");

  const writesBeforeDrag = storage.writes.length;
  const changesBeforeDrag = harness.preferenceChanges.length;
  harness.elements.symmetryAngleInput.value = "37";
  harness.elements.symmetryAngleInput.dispatchEvent(new Event("input"));
  assert.equal(harness.controller.preferences.symmetryAngleDegrees, 37);
  assert.equal(harness.elements.symmetryAngleValueInput.value, "37");
  assert.equal(storage.writes.length, writesBeforeDrag, "range input must stay live-only");
  assert.equal(harness.preferenceChanges.length, changesBeforeDrag + 1);
  harness.elements.symmetryAngleInput.dispatchEvent(new Event("change"));
  assert.equal(storage.writes.length, writesBeforeDrag + 1, "range change must persist once");

  const writesBeforeNumber = storage.writes.length;
  harness.elements.symmetryAngleValueInput.value = "145";
  harness.elements.symmetryAngleValueInput.dispatchEvent(new Event("input"));
  assert.equal(harness.controller.preferences.symmetryAngleDegrees, 145);
  assert.equal(harness.elements.symmetryAngleInput.value, "145");
  assert.equal(storage.writes.length, writesBeforeNumber);
  harness.elements.symmetryAngleValueInput.dispatchEvent(new Event("change"));
  assert.equal(storage.writes.length, writesBeforeNumber + 1);

  harness.elements.symmetryEnabledInput.checked = true;
  harness.elements.symmetryEnabledInput.dispatchEvent(new Event("change"));
  harness.elements.symmetryEnabledInput.checked = false;
  harness.elements.symmetryEnabledInput.dispatchEvent(new Event("change"));
  assert.equal(
    harness.controller.preferences.symmetryAngleDegrees,
    145,
    "turning Symmetry off must preserve the custom angle",
  );
  assert.equal(JSON.parse(storage.writes.at(-1)[1]).preferences.symmetryAngleDegrees, 145);

  const writesBeforeDispose = storage.writes.length;
  const changesBeforeDispose = harness.preferenceChanges.length;
  const precisionBeforeDispose = harness.controller.preferences.brushPrecision;
  harness.controller.dispose();
  harness.elements.symmetryAngleInput.value = "22";
  harness.elements.symmetryAngleInput.dispatchEvent(new Event("input"));
  harness.elements.brushPrecisionButtons[0].dispatchEvent(new Event("click"));
  harness.elements.brushPrecisionButtons[1].dispatchEvent(keyEvent("ArrowLeft"));
  assert.equal(storage.writes.length, writesBeforeDispose);
  assert.equal(harness.preferenceChanges.length, changesBeforeDispose);
  assert.equal(harness.controller.preferences.brushPrecision, precisionBeforeDispose);
}

// Persistence failure must not roll back or suppress the live callback.
{
  const storage = new FakeStorage(null, { throwOnSet: true });
  const harness = createHarness({ storage });
  harness.elements.symmetryPresetButtons[1].dispatchEvent(new Event("click"));
  assert.equal(harness.controller.preferences.symmetryAngleDegrees, 0);
  assert.equal(harness.preferenceChanges.length, 1);
  harness.controller.dispose();
}

console.log(
  "editor-settings: global Brush precision, symmetry, storage and accessibility verified.",
);
