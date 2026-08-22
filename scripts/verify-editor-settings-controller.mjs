import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "vite";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("index.html", root), "utf8");

assert.match(
  html,
  /id="mobileToolsMenu"[\s\S]*?<\/button>\s*<button\s+id="editorSettingsMenu"/,
  "Settings must be the header action immediately after Tools",
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

for (const [id, hint] of [
  ["editorRulersEnabled", "editorRulersHint"],
  ["editorGridEnabled", "editorGridHint"],
  ["editorSnappingEnabled", "editorSnappingHint"],
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
let saveEditorGuidePreferences;
try {
  ({
    DEFAULT_EDITOR_GUIDE_PREFERENCES,
    EDITOR_SETTINGS_STORAGE_KEY,
    loadEditorGuidePreferences,
    saveEditorGuidePreferences,
  } = await moduleServer.ssrLoadModule("/src/editor-settings-storage.ts"));
  ({ EditorSettingsController } = await moduleServer.ssrLoadModule(
    "/src/editor-settings-controller.ts",
  ));
} finally {
  await moduleServer.close();
}

const defaults = { rulers: true, grid: false, snapping: true };
assert.deepEqual(DEFAULT_EDITOR_GUIDE_PREFERENCES, defaults);
assert.equal(EDITOR_SETTINGS_STORAGE_KEY, "m1m4.editor-settings.v1");

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
  JSON.stringify({ version: 2, preferences: { rulers: false, grid: true, snapping: false } }),
  JSON.stringify({ version: 1 }),
]) {
  assert.deepEqual(
    loadEditorGuidePreferences(new FakeStorage(serialized)),
    defaults,
    `invalid persisted settings must be rejected: ${serialized}`,
  );
}

assert.deepEqual(
  loadEditorGuidePreferences(new FakeStorage(JSON.stringify({
    version: 1,
    preferences: {
      rulers: "false",
      grid: true,
      snapping: false,
      unknown: true,
    },
  }))),
  { rulers: true, grid: true, snapping: false },
  "only literal booleans from a current-version payload may override defaults",
);

const roundTripStorage = new FakeStorage();
assert.equal(
  saveEditorGuidePreferences(roundTripStorage, {
    rulers: false,
    grid: true,
    snapping: false,
  }),
  true,
);
assert.deepEqual(roundTripStorage.writes, [[
  EDITOR_SETTINGS_STORAGE_KEY,
  JSON.stringify({
    version: 1,
    preferences: { rulers: false, grid: true, snapping: false },
  }),
]]);
assert.deepEqual(
  loadEditorGuidePreferences(roundTripStorage),
  { rulers: false, grid: true, snapping: false },
  "a saved snapshot must survive a cold load",
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
});
assert.deepEqual(JSON.parse(normalizedSaveStorage.serialized).preferences, {
  rulers: true,
  grid: true,
  snapping: true,
}, "save must not serialize non-boolean runtime input");

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
  isConnected = true;
  offsetWidth = 320;
  focusCount = 0;

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  toggleAttribute(name, force) {
    const present = force === undefined ? !this.attributes.has(name) : Boolean(force);
    if (present) this.attributes.set(name, "");
    else this.attributes.delete(name);
    return present;
  }

  contains(node) {
    return node === this || this.contained.has(node);
  }

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
} = {}) {
  const document = new FakeDocument();
  const trigger = new FakeElement(document);
  const panel = new FakeElement(document);
  const closeButton = new FakeElement(document);
  const rulersInput = new FakeElement(document);
  const gridInput = new FakeElement(document);
  const snappingInput = new FakeElement(document);
  for (const element of [closeButton, rulersInput, gridInput, snappingInput]) {
    panel.contained.add(element);
  }
  const elements = {
    trigger,
    panel,
    closeButton,
    rulersInput,
    gridInput,
    snappingInput,
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

// Construction restores persisted values without treating startup as a user change.
{
  const storage = new FakeStorage(JSON.stringify({
    version: 1,
    preferences: { rulers: false, grid: true, snapping: false },
  }));
  const harness = createHarness({ storage });
  assert.deepEqual(harness.controller.preferences, {
    rulers: false,
    grid: true,
    snapping: false,
  });
  assert.equal(harness.elements.rulersInput.checked, false);
  assert.equal(harness.elements.gridInput.checked, true);
  assert.equal(harness.elements.snappingInput.checked, false);
  assert.deepEqual(harness.preferenceChanges, []);
  assert.equal(harness.controller.isOpen, false);
  assert.equal(harness.elements.trigger.getAttribute("aria-expanded"), "false");
  assert.equal(harness.elements.trigger.getAttribute("aria-label"), "Open settings");
  assert.equal(harness.elements.panel.getAttribute("aria-hidden"), "true");
  assert.equal(harness.elements.panel.getAttribute("inert"), "");

  const snapshot = harness.controller.preferences;
  snapshot.grid = false;
  assert.equal(
    harness.controller.preferences.grid,
    true,
    "the public preferences snapshot must not mutate controller state",
  );
  harness.controller.dispose();
}

// Open policy, accessibility state, close button and Escape share one lifecycle.
{
  const harness = createHarness({ initiallyCanOpen: false });
  harness.elements.trigger.dispatchEvent(new Event("click"));
  assert.equal(harness.controller.isOpen, false);
  assert.deepEqual(harness.lifecycle, []);

  harness.setCanOpen(true);
  harness.elements.trigger.dispatchEvent(new Event("click"));
  assert.equal(harness.controller.isOpen, true);
  assert.deepEqual(harness.lifecycle, ["before-open", "opened"]);
  assert.equal(harness.elements.trigger.getAttribute("aria-expanded"), "true");
  assert.equal(harness.elements.trigger.getAttribute("aria-label"), "Close settings");
  assert.equal(harness.elements.panel.getAttribute("aria-hidden"), "false");
  assert.equal(harness.elements.panel.getAttribute("inert"), null);
  assert.equal(harness.elements.panel.classList.contains("is-open"), true);
  assert.equal(harness.document.activeElement, harness.elements.closeButton);

  harness.document.activeElement = harness.elements.closeButton;
  harness.elements.closeButton.dispatchEvent(new Event("click"));
  assert.equal(harness.controller.isOpen, false);
  assert.equal(harness.elements.trigger.focusCount, 1);
  assert.equal(harness.elements.panel.getAttribute("aria-hidden"), "true");
  assert.equal(harness.elements.panel.getAttribute("inert"), "");
  assert.deepEqual(harness.lifecycle, ["before-open", "opened", "closed"]);

  harness.controller.setOpen(true);
  harness.document.activeElement = harness.elements.gridInput;
  const escape = keyEvent("Escape");
  harness.document.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(harness.controller.isOpen, false);
  assert.equal(harness.elements.trigger.focusCount, 2);
  assert.equal(harness.elements.trigger.getAttribute("aria-expanded"), "false");
  assert.equal(harness.elements.trigger.getAttribute("aria-label"), "Open settings");
  harness.controller.dispose();
}

// A checkbox change applies live first, then persists exactly one canonical snapshot.
{
  const order = [];
  const storage = new FakeStorage(null, {
    onSet: () => order.push("persist"),
  });
  const harness = createHarness({
    storage,
    preferenceEvent: () => {
      const precedingLiveCallbacks = order.filter((event) => event === "live").length;
      assert.equal(
        storage.writes.length,
        precedingLiveCallbacks,
        "persistence ran before the live callback",
      );
      order.push("live");
    },
  });
  harness.elements.rulersInput.checked = false;
  harness.elements.gridInput.checked = true;
  harness.elements.snappingInput.checked = false;
  harness.elements.gridInput.dispatchEvent(new Event("change"));
  assert.deepEqual(order, ["live", "persist"]);
  assert.deepEqual(harness.preferenceChanges, [{
    rulers: false,
    grid: true,
    snapping: false,
  }]);
  assert.equal(storage.writes.length, 1);
  assert.deepEqual(JSON.parse(storage.writes[0][1]), {
    version: 1,
    preferences: { rulers: false, grid: true, snapping: false },
  });

  harness.elements.rulersInput.checked = true;
  harness.elements.rulersInput.dispatchEvent(new Event("change"));
  harness.elements.snappingInput.checked = true;
  harness.elements.snappingInput.dispatchEvent(new Event("change"));
  assert.deepEqual(order, ["live", "persist", "live", "persist", "live", "persist"]);
  assert.equal(
    harness.preferenceChanges.length,
    3,
    "all three native checkboxes must publish live changes",
  );
  assert.equal(storage.writes.length, 3);

  const writesBeforeDispose = storage.writes.length;
  const changesBeforeDispose = harness.preferenceChanges.length;
  harness.controller.setOpen(true);
  harness.controller.dispose();
  assert.equal(harness.controller.isOpen, false);
  harness.elements.rulersInput.checked = true;
  harness.elements.rulersInput.dispatchEvent(new Event("change"));
  harness.elements.trigger.dispatchEvent(new Event("click"));
  harness.document.dispatchEvent(keyEvent("Escape"));
  assert.equal(storage.writes.length, writesBeforeDispose);
  assert.equal(harness.preferenceChanges.length, changesBeforeDispose);
  assert.equal(harness.controller.isOpen, false, "disposed listeners must remain inert");
}

// Persistence failure must not roll back or suppress the live preference callback.
{
  const storage = new FakeStorage(null, { throwOnSet: true });
  const harness = createHarness({ storage });
  harness.elements.gridInput.checked = true;
  harness.elements.gridInput.dispatchEvent(new Event("change"));
  assert.deepEqual(harness.controller.preferences, {
    rulers: true,
    grid: true,
    snapping: true,
  });
  assert.deepEqual(harness.preferenceChanges, [{
    rulers: true,
    grid: true,
    snapping: true,
  }]);
  harness.controller.dispose();
}

console.log(
  "editor-settings: storage, live callbacks, accessibility lifecycle, disposal and native markup verified.",
);
