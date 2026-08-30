import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "vite";

const root = new URL("../", import.meta.url);
const controllerSource = readFileSync(
  new URL("src/editor-filters-controller.ts", root),
  "utf8",
);
const htmlSource = readFileSync(new URL("index.html", root), "utf8");
const stylesSource = readFileSync(new URL("src/styles.css", root), "utf8");
const mainSource = readFileSync(new URL("src/main.ts", root), "utf8");

const filtersPanelStart = htmlSource.indexOf('id="editorFiltersPanel"');
const filtersPanelEnd = htmlSource.indexOf("</aside>", filtersPanelStart);
assert.ok(filtersPanelStart >= 0 && filtersPanelEnd > filtersPanelStart);
const filtersPanelSource = htmlSource.slice(filtersPanelStart, filtersPanelEnd);
assert.match(filtersPanelSource, /class="mobile-tools-grid editor-filters-grid"/);
assert.match(
  filtersPanelSource,
  /id="editorGlassFilter"[\s\S]*?class="mobile-tools-item editor-filter-item"/,
);
assert.match(
  filtersPanelSource,
  /class="mobile-icon-stack"[\s\S]*?mobile-icon-outline[\s\S]*?mobile-icon-face/,
);
assert.match(filtersPanelSource, /class="mobile-tools-item-label">Glass<\/span>/);
assert.match(
  filtersPanelSource,
  /id="editorCurvesFilter"[\s\S]*?class="mobile-tools-item editor-filter-item"/,
);
assert.match(
  filtersPanelSource,
  /id="editorCurvesFilter"[\s\S]{0,420}data-lucide="spline"/,
  "Curves must use an icon registered by the production icon set.",
);
assert.match(filtersPanelSource, /class="mobile-tools-item-label">Curves<\/span>/);
assert.match(
  filtersPanelSource,
  /id="editorColorAdjustFilter"[\s\S]*?data-editor-filter-kind="color-adjust"/,
);
assert.match(
  filtersPanelSource,
  /id="editorColorAdjustFilter"[\s\S]{0,520}data-lucide="palette"/,
  "Color Adjust must use an icon registered by the production icon set.",
);
assert.match(filtersPanelSource, /class="mobile-tools-item-label">Color Adjust<\/span>/);
assert.match(
  filtersPanelSource,
  /id="editorColorBalanceFilter"[\s\S]*?data-editor-filter-kind="color-balance"/,
);
assert.match(
  filtersPanelSource,
  /id="editorColorBalanceFilter"[\s\S]{0,520}data-lucide="scale"/,
  "Color Balance must use an icon registered by the production icon set.",
);
assert.match(filtersPanelSource, /class="mobile-tools-item-label">Color Balance<\/span>/);
assert.match(
  filtersPanelSource,
  /id="editorGradientMapFilter"[\s\S]*?data-editor-filter-kind="gradient-map"/,
);
assert.match(
  filtersPanelSource,
  /id="editorGradientMapFilter"[\s\S]{0,520}data-lucide="[^"]+"/,
  "Gradient Map must use an icon registered by the production icon set.",
);
assert.match(filtersPanelSource, /class="mobile-tools-item-label">Gradient Map<\/span>/);
assert.match(htmlSource, /id="gradientMapSurface"[\s\S]*?id="gradientMapChooser"/);
assert.match(htmlSource, /id="gradientMapChooser"[\s\S]*?id="gradientMapEditor"/);
assert.equal(
  (htmlSource.match(/data-gradient-map-preset-id=/g) ?? []).length,
  6,
  "Gradient Map must begin with the six project-owned preset choices.",
);
assert.doesNotMatch(htmlSource, /<h2>Choose a gradient<\/h2>/);
assert.doesNotMatch(htmlSource, /Dark tones use the left side/);
assert.match(htmlSource, /id="gradientMapColor"[\s\S]{0,220}type="color"/);
assert.match(htmlSource, /id="gradientMapActionMenu"[\s\S]*?>Reset<[\s\S]*?>Cancel</);
assert.match(
  htmlSource,
  /id="gradientMapEditor"[\s\S]*?<\/section>\s*<\/section>\s*<div\s+id="gradientMapActionMenu"/,
  "The fixed Gradient Map action menu must be a sibling of the inert surface.",
);
assert.doesNotMatch(filtersPanelSource, /Point Blur|spatial-blur/);
assert.doesNotMatch(
  filtersPanelSource,
  /editor-filter-card|editor-filter-hint|editor-filter-open|Refract pixels|>Open</,
);
assert.match(stylesSource, /\.editor-filters-grid\s*\{/);
assert.match(stylesSource, /\.editor-filter-item:focus-visible\s*\{/);
assert.match(stylesSource, /\.gradient-map-surface\s*\{/);
assert.match(
  stylesSource,
  /\.gradient-map-surface\s*\{[\s\S]*?padding:\s*18px 18px 16px;[\s\S]*?background:\s*rgba\(23, 25, 29, 0\.96\);[\s\S]*?backdrop-filter:\s*blur\(16px\);/,
  "Gradient Map must share the established color-control dock treatment.",
);
assert.match(stylesSource, /\.gradient-map-preset-grid\s*\{/);
assert.match(
  stylesSource,
  /\.gradient-map-preset-preview\s*\{[\s\S]*?border:\s*0;/,
  "Preset previews must not render a bright leading border.",
);
assert.match(
  stylesSource,
  /\.gradient-map-chooser-cancel\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?top:\s*0;[\s\S]*?right:\s*0;/,
  "The chooser close action must sit at the dock's upper-right edge.",
);
assert.match(stylesSource, /\.gradient-map-editor\s*\{/);
assert.match(
  stylesSource,
  /@media \(max-width: 1100px\)[\s\S]*?\.gradient-map-surface\s*\{[\s\S]*?right:[\s\S]*?left:[\s\S]*?width: auto/,
  "Gradient Map must span the available mobile width with safe-area insets.",
);
assert.doesNotMatch(stylesSource, /\.editor-filter-card/);
assert.match(
  mainSource,
  /editorFiltersController = new EditorFiltersController\([\s\S]*?beforeOpen: \(\) => \{[\s\S]*?rasterAdjustmentsController\?\.syncUi\(\)/,
  "Opening Filters must refresh raster eligibility after paint, import or Undo/Redo.",
);
assert.match(
  mainSource,
  /function updateHistoryControls\(\): void \{[\s\S]{0,260}rasterAdjustmentsController\?\.syncUi\(\)/,
  "History completion must refresh filter eligibility while the catalog remains open.",
);
assert.match(
  mainSource,
  /else if \(kind === "gradient-map"\) \{[\s\S]{0,180}openGradientMap\(trigger, returnFocus\)/,
  "The Gradient Map tile must route through the destructive adjustment controller.",
);

assert.doesNotMatch(
  controllerSource,
  /from "\.\/brush-engine"|getElementById|querySelectorAll/,
  "the Filters catalog must depend on injected UI ports rather than engine or global DOM state",
);
assert.match(
  controllerSource,
  /this\.setOpenState\(false\);\s*this\.options\.openFilter\(kind, button, elements\.trigger\);/,
  "the catalog must close before routing and provide its top-level trigger as final focus",
);
assert.match(
  controllerSource,
  /if \(!open && focusWasInside && trigger\.isConnected\) \{\s*trigger\.focus\([\s\S]*?\);\s*\}\s*panel\.setAttribute\("aria-hidden"/,
  "focus must leave the catalog before it becomes hidden from assistive technology",
);

const moduleServer = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: process.cwd(),
  server: { middlewareMode: true },
});

let EditorFiltersController;
let EDITOR_FILTER_KINDS;
let isEditorFilterKind;
try {
  ({ EditorFiltersController } = await moduleServer.ssrLoadModule(
    "/src/editor-filters-controller.ts",
  ));
  ({ EDITOR_FILTER_KINDS, isEditorFilterKind } = await moduleServer.ssrLoadModule(
    "/src/editor-filters-contract.ts",
  ));
} finally {
  await moduleServer.close();
}

assert.deepEqual(EDITOR_FILTER_KINDS, [
  "glass",
  "curves",
  "color-adjust",
  "color-balance",
  "gradient-map",
]);
assert.equal(isEditorFilterKind("glass"), true);
assert.equal(isEditorFilterKind("curves"), true);
assert.equal(isEditorFilterKind("color-adjust"), true);
assert.equal(isEditorFilterKind("color-balance"), true);
assert.equal(isEditorFilterKind("gradient-map"), true);
assert.equal(isEditorFilterKind("spatial-blur"), false);
assert.equal(isEditorFilterKind("unknown"), false);
assert.equal(isEditorFilterKind(undefined), false);

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
  constructor(ownerDocument, dataset = {}) {
    super();
    this.ownerDocument = ownerDocument;
    this.dataset = { ...dataset };
  }

  attributes = new Map();
  classList = new FakeClassList();
  contained = new Set();
  dataset;
  hidden = false;
  disabled = false;
  isConnected = true;
  offsetWidth = 360;
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

  click() {
    this.dispatchEvent(new Event("click"));
  }
}

function keyEvent(key) {
  const event = new Event("keydown", { cancelable: true });
  Object.defineProperty(event, "key", { configurable: true, value: key });
  return event;
}

function createHarness(initiallyCanOpen = true) {
  const document = new FakeDocument();
  const trigger = new FakeElement(document);
  const panel = new FakeElement(document);
  const closeButton = new FakeElement(document);
  const glassButton = new FakeElement(document, { editorFilterKind: "glass" });
  const curvesButton = new FakeElement(document, { editorFilterKind: "curves" });
  const colorAdjustButton = new FakeElement(document, { editorFilterKind: "color-adjust" });
  const colorBalanceButton = new FakeElement(document, { editorFilterKind: "color-balance" });
  const gradientMapButton = new FakeElement(document, { editorFilterKind: "gradient-map" });
  const unknownButton = new FakeElement(document, { editorFilterKind: "unknown" });
  panel.contained.add(closeButton);
  panel.contained.add(glassButton);
  panel.contained.add(curvesButton);
  panel.contained.add(colorAdjustButton);
  panel.contained.add(colorBalanceButton);
  panel.contained.add(gradientMapButton);
  panel.contained.add(unknownButton);
  let canOpen = initiallyCanOpen;
  const lifecycle = [];
  const routed = [];
  let controller;
  controller = new EditorFiltersController({
    browser: { AbortController },
    document,
    elements: {
      trigger,
      panel,
      closeButton,
      filterButtons: [
        glassButton,
        curvesButton,
        colorAdjustButton,
        colorBalanceButton,
        gradientMapButton,
        unknownButton,
      ],
    },
    canOpen: () => canOpen,
    beforeOpen: () => lifecycle.push("before-open"),
    onOpenChange: (open) => lifecycle.push(open ? "opened" : "closed"),
    openFilter: (kind, opener, returnFocus) => {
      routed.push({
        kind,
        opener,
        returnFocus,
        catalogOpenDuringRoute: controller.isOpen,
      });
      lifecycle.push(`filter:${kind}`);
    },
  });
  return {
    controller,
    document,
    trigger,
    panel,
    closeButton,
    glassButton,
    curvesButton,
    colorAdjustButton,
    colorBalanceButton,
    gradientMapButton,
    unknownButton,
    lifecycle,
    routed,
    setCanOpen(value) { canOpen = value; },
  };
}

// The Gradient Map card participates in the typed route without opening an
// engine transaction inside the catalog controller.
{
  const harness = createHarness();
  harness.controller.setOpen(true);
  harness.gradientMapButton.click();
  assert.equal(harness.controller.isOpen, false);
  assert.equal(harness.routed.length, 1);
  assert.equal(harness.routed[0].kind, "gradient-map");
  assert.equal(harness.routed[0].opener, harness.gradientMapButton);
  assert.equal(harness.routed[0].returnFocus, harness.trigger);
  assert.equal(harness.routed[0].catalogOpenDuringRoute, false);
  harness.controller.dispose();
}

// Initial state is inaccessible until an allowed top-level trigger opens it.
{
  const harness = createHarness(false);
  assert.equal(harness.controller.isOpen, false);
  assert.equal(harness.trigger.getAttribute("aria-expanded"), "false");
  assert.equal(harness.trigger.getAttribute("aria-label"), "Open filters");
  assert.equal(harness.panel.getAttribute("aria-hidden"), "true");
  assert.equal(harness.panel.getAttribute("inert"), "");
  assert.equal(harness.unknownButton.disabled, true);

  harness.trigger.click();
  assert.equal(harness.controller.isOpen, false);
  assert.deepEqual(harness.lifecycle, []);

  harness.setCanOpen(true);
  harness.trigger.click();
  assert.equal(harness.controller.isOpen, true);
  assert.deepEqual(harness.lifecycle, ["before-open", "opened"]);
  assert.equal(harness.trigger.getAttribute("aria-expanded"), "true");
  assert.equal(harness.trigger.getAttribute("aria-label"), "Close filters");
  assert.equal(harness.panel.getAttribute("aria-hidden"), "false");
  assert.equal(harness.panel.getAttribute("inert"), null);
  assert.equal(harness.panel.classList.contains("is-open"), true);
  assert.equal(harness.document.activeElement, harness.closeButton);

  harness.closeButton.click();
  assert.equal(harness.controller.isOpen, false);
  assert.equal(harness.trigger.focusCount, 1);
  assert.deepEqual(harness.lifecycle, ["before-open", "opened", "closed"]);
  harness.controller.dispose();
}

// Escape shares the ordinary close path and restores the top-level trigger.
{
  const harness = createHarness();
  harness.controller.setOpen(true);
  const escape = keyEvent("Escape");
  harness.document.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(harness.controller.isOpen, false);
  assert.equal(harness.trigger.focusCount, 1);
  assert.equal(harness.panel.getAttribute("aria-hidden"), "true");
  assert.equal(harness.panel.getAttribute("inert"), "");
  harness.controller.dispose();
}

// A typed card closes first, moves focus outside the hidden catalog, and
// forwards the still-visible Filters trigger for the adjustment's close path.
{
  const harness = createHarness();
  harness.controller.setOpen(true);
  harness.document.activeElement = harness.glassButton;
  harness.glassButton.click();
  assert.equal(harness.controller.isOpen, false);
  assert.deepEqual(harness.lifecycle, [
    "before-open",
    "opened",
    "closed",
    "filter:glass",
  ]);
  assert.equal(harness.routed.length, 1);
  assert.equal(harness.routed[0].kind, "glass");
  assert.equal(harness.routed[0].opener, harness.glassButton);
  assert.equal(harness.routed[0].returnFocus, harness.trigger);
  assert.equal(harness.routed[0].catalogOpenDuringRoute, false);
  assert.equal(harness.trigger.focusCount, 1);
  assert.equal(harness.panel.getAttribute("inert"), "");

  harness.controller.setOpen(true);
  harness.glassButton.disabled = true;
  harness.glassButton.click();
  harness.unknownButton.click();
  assert.equal(harness.controller.isOpen, true);
  assert.equal(harness.routed.length, 1);
  harness.controller.dispose();
}

// The tonal balance card participates in the same typed route and focus contract.
{
  const harness = createHarness();
  harness.controller.setOpen(true);
  harness.colorBalanceButton.click();
  assert.equal(harness.controller.isOpen, false);
  assert.equal(harness.routed.length, 1);
  assert.equal(harness.routed[0].kind, "color-balance");
  assert.equal(harness.routed[0].opener, harness.colorBalanceButton);
  assert.equal(harness.routed[0].returnFocus, harness.trigger);
  harness.controller.dispose();
}

// Disposal closes accessibly and removes all routes.
{
  const harness = createHarness();
  harness.controller.setOpen(true);
  harness.document.activeElement = harness.glassButton;
  harness.controller.dispose();
  assert.equal(harness.controller.isOpen, false);
  assert.equal(harness.trigger.focusCount, 1);
  assert.deepEqual(harness.lifecycle, ["before-open", "opened", "closed"]);
  harness.trigger.click();
  harness.glassButton.click();
  harness.document.dispatchEvent(keyEvent("Escape"));
  assert.equal(harness.controller.isOpen, false);
  assert.equal(harness.routed.length, 0);
}

console.log(
  "Editor Filters controller: typed routing, accessibility, focus and disposal verified.",
);
