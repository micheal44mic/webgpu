import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "vite";

const root = new URL("../", import.meta.url);
const mainSource = readFileSync(new URL("src/main.ts", root), "utf8");
const controllerSource = readFileSync(
  new URL("src/layer-panel-controller.ts", root),
  "utf8",
);
const sceneEditorSource = readFileSync(
  new URL("src/scene-editor-controller.ts", root),
  "utf8",
);
const stylesSource = readFileSync(new URL("src/styles.css", root), "utf8");
const html = readFileSync(new URL("index.html", root), "utf8");

assert.match(mainSource, /layerPanelController = new LayerPanelController\(\{/);
assert.match(mainSource, /layerPanelController\?\.dispose\(\);/);
assert.doesNotMatch(
  mainSource,
  /mobileLayersPanelOpen|mobileLayerReorderGesture|mobileLayerMultiSelectEnabled|mobileLayersRenderSignature|mobileLayerContextKey/,
  "main.ts must not regain ownership of Layers UI state",
);
assert.doesNotMatch(
  controllerSource,
  /from "\.\/brush-engine"|document\.getElementById|\bengine\./,
  "the panel must depend only on injected scene-operation ports and scoped elements",
);
assert.match(controllerSource, /private readonly abortController: AbortController/);
assert.match(controllerSource, /this\.abortController\.abort\(\)/);
assert.match(controllerSource, /list\.setAttribute\("inert", ""\)/);
assert.match(controllerSource, /contextOrderSignature/);
assert.match(controllerSource, /sceneOrderSignature/);
assert.match(controllerSource, /this\.options\.deleteLayer\(key\)/);
assert.match(
  mainSource,
  /deleteLayer: \(key\) => sceneEditorController!\.deleteLayer\(key\)/,
);
assert.match(
  mainSource,
  /rasterizeLayer: \(key\) => sceneEditorController!\.rasterizeLayer\(key\)/,
);
assert.match(html, /id="mobileLayerRasterize"[\s\S]*?>\s*Rasterize\s*<\/button>/);
const layersPanelStart = html.indexOf('id="mobileLayersPanel"');
const layersPanelEnd = html.indexOf("</aside>", layersPanelStart);
const resultLiveRegion = html.indexOf('id="layerSwitchResult"');
assert.ok(
  layersPanelStart >= 0 && layersPanelEnd > layersPanelStart && resultLiveRegion > layersPanelEnd,
  "the global layer result live region must remain outside the inert Layers panel",
);
assert.match(controllerSource, /setRasterReference: \(key: LayerPanelKey/);
assert.match(controllerSource, /setRasterClipping: \(key: LayerPanelKey/);
assert.match(controllerSource, /DOCUMENT_BACKGROUND_ROW_KEY = "background"/);
assert.match(controllerSource, /name: "Sfondo"/);
assert.match(controllerSource, /mobile-layer-background-color/);
assert.match(controllerSource, /CornerRightDown/);
assert.match(controllerSource, /mobile-layer-clipping-indicator/);
assert.match(controllerSource, /clippingParent: this\.clippingParentView\(stats, layer\.clippingParentId\)/);
assert.match(controllerSource, /clippingParent: this\.clippingParentView\(stats, item\.rasterClippingParentId\)/);
assert.match(controllerSource, /is-clipping-child/);
assert.match(controllerSource, /view\.clippingParent\?\.key \?\? ""/);
assert.match(controllerSource, /Ritagliato su \$\{view\.clippingParent\.name\}/);
assert.match(controllerSource, /\$\{view\.name\}\$\{clippingLabel\}, selected/);
assert.match(
  stylesSource,
  /\.mobile-layer-row\.is-clipping-child \.mobile-layer-select[\s\S]*?grid-template-columns: 16px 52px minmax\(0, 1fr\)/,
);
assert.match(
  stylesSource,
  /\.mobile-layer-clipping-indicator \{[\s\S]*?--mobile-icon-face: #dd5c35/,
);
assert.match(controllerSource, /views\.push\(this\.backgroundView\(stats\)\)/);
assert.match(controllerSource, /candidate !== undefined && isLayerPanelKey\(candidate\)/);
assert.match(controllerSource, /this\.listen\(elements\.list, "change", \(raw\) => this\.handleBackgroundColorInput\(raw\)\)/);
assert.match(controllerSource, /select\.disabled = locked \|\| background/);
assert.match(controllerSource, /this\.options\.setRasterReference\(key,/);
assert.match(controllerSource, /this\.options\.setRasterClipping\(properties\.key,/);
const panelCompositionStart = mainSource.indexOf("layerPanelController = new LayerPanelController({");
const panelCompositionEnd = mainSource.indexOf("window.addEventListener(\"pagehide\"", panelCompositionStart);
const panelComposition = mainSource.slice(panelCompositionStart, panelCompositionEnd);
assert.match(
  panelComposition,
  /setDocumentBackgroundVisibility:[\s\S]*?projectSessionController\?\.markDirty\(\)/,
);
assert.match(
  panelComposition,
  /setDocumentBackgroundColor:[\s\S]*?projectSessionController\?\.markDirty\(\)/,
);
assert.match(
  panelComposition,
  /setRasterReference: \(key, enabled\) =>\s*sceneEditorController\?\.setRasterReference\(key, enabled\)/,
);
assert.match(
  panelComposition,
  /setRasterClipping: \(key, enabled\) =>\s*sceneEditorController\?\.setRasterClipping\(key, enabled\)/,
);
assert.match(sceneEditorSource, /rasterIndexForSceneLayerKey\(stats, key\)/);
assert.match(mainSource, /onHistoryChange\(state\)[\s\S]*?cancelTransientInteractions\(\)/);
assert.match(controllerSource, /cancelTransientInteractions\(\)[\s\S]*?this\.closeContextMenu\(false\)/);

const moduleServer = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: process.cwd(),
  server: { middlewareMode: true },
});
let LayerPanelController;
try {
  ({ LayerPanelController } = await moduleServer.ssrLoadModule(
    "/src/layer-panel-controller.ts",
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

  toggle(name, enabled) {
    if (enabled) this.values.add(name);
    else this.values.delete(name);
  }

  contains(name) {
    return this.values.has(name);
  }
}

class FakeStyle {
  setProperty() {}
  removeProperty() {}
}

class FakeElement extends EventTarget {
  attributes = new Map();
  classList = new FakeClassList();
  dataset = {};
  style = new FakeStyle();
  hidden = false;
  disabled = false;
  textContent = "";
  title = "";
  offsetWidth = 320;
  offsetHeight = 48;
  clientHeight = 320;
  scrollHeight = 320;
  scrollTop = 0;
  focusCount = 0;
  children = [];

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  contains(target) {
    return target === this || this.children.some((child) => child.contains?.(target));
  }

  focus() {
    this.focusCount += 1;
  }

  blur() {}
  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = [...children];
  }

  get childElementCount() {
    return this.children.length;
  }

  querySelector(selector) {
    if (selector.includes(".mobile-layer-select")) {
      return this.children.find((child) => child.className === "mobile-layer-select")
        ?? this.children.flatMap((child) => child.children ?? [])
          .find((child) => child.className === "mobile-layer-select")
        ?? null;
    }
    return null;
  }

  querySelectorAll() {
    return this.children;
  }

  getBoundingClientRect() {
    return { top: 0, right: 320, bottom: 48, left: 0, width: 320, height: 48 };
  }
  matches(selector) {
    return selector.includes("is-selected") || selector.includes("is-multi-selected");
  }
  closest() { return null; }
}

class FakeBrowser extends EventTarget {
  AbortController = AbortController;
  CSS = { escape: (value) => value };
  Element = FakeElement;
  HTMLElement = FakeElement;
  Node = FakeElement;
  performance = { now: () => 0 };
  requestAnimationFrame = () => 1;
  cancelAnimationFrame() {}
  setTimeout = () => 1;
  clearTimeout() {}
}

class FakeDocument extends EventTarget {
  activeElement = null;

  createElement() {
    return new FakeElement();
  }
}

function createElements() {
  return {
    trigger: new FakeElement(),
    panel: new FakeElement(),
    addButton: new FakeElement(),
    copyButton: new FakeElement(),
    addMaskButton: new FakeElement(),
    multiSelectButton: new FakeElement(),
    list: new FakeElement(),
    multiActions: new FakeElement(),
    mergeSelectionButton: new FakeElement(),
    contextMenu: new FakeElement(),
    clippingButton: new FakeElement(),
    optionsButton: new FakeElement(),
    rasterizeButton: new FakeElement(),
    mergeButton: new FakeElement(),
    mergeReason: new FakeElement(),
    mergeStatus: new FakeElement(),
    deleteButton: new FakeElement(),
    reorderStatus: new FakeElement(),
  };
}

const browser = new FakeBrowser();
const document = new FakeDocument();
const elements = createElements();
const thumbnailOpenStates = [];
let stats = null;
let interactionLocked = false;
const referenceCalls = [];
const clippingCalls = [];
const rasterizeCalls = [];
const layerResults = [];
const controller = new LayerPanelController({
  browser,
  document,
  elements,
  thumbnails: {
    setPanelOpen: (open) => thumbnailOpenStates.push(open),
    queueMissing() {},
    invalidateActive() {},
    ensureActive() {},
    resumeCapture() {},
    rasterRevision: () => 0,
    semanticFontRevision: () => "",
    render() {},
    copyRasterEntry: () => false,
  },
  getStats: () => stats,
  isInteractionLocked: () => interactionLocked,
  isRenderDeferred: () => false,
  canOpen: () => true,
  beforeOpen() {},
  onOpenChange() {},
  getReorderTargets: () => ({
    movingKeys: [],
    topFirstKeysWithoutMoving: [],
    validTargetTopFirstSlots: [],
  }),
  moveLayer: async () => false,
  mergeCapabilityError: () => null,
  mergeLayers: async () => ({ itemCount: 2 }),
  rasterizeLayer: async (key) => {
    rasterizeCalls.push(key);
    return { kind: "raster", name: "Layer 2", changed: true, outputKey: key };
  },
  addRasterLayer() {},
  duplicateSelectedLayer: async () => {
    throw new Error("not used");
  },
  addClippingMaskLayer() {},
  selectLayer() {},
  setLayerVisibility() {},
  setRasterReference: (key, enabled) => referenceCalls.push({ key, enabled }),
  setDocumentBackgroundVisibility: () => true,
  setDocumentBackgroundColor: () => true,
  setRasterClipping: (key, enabled) => clippingCalls.push({ key, enabled }),
  deleteLayer: async () => {},
  openLayerOptions() {},
  onLayerResult: (message) => layerResults.push(message),
  onStatus() {},
  recordDiagnostic() {},
});

assert.equal(elements.panel.getAttribute("inert"), "");
controller.setOpen(true);
assert.equal(controller.isOpen, true);
assert.equal(elements.panel.getAttribute("inert"), null);
assert.equal(elements.trigger.getAttribute("aria-expanded"), "true");
document.activeElement = elements.panel;
controller.setOpen(false);
assert.equal(elements.trigger.focusCount, 1, "normal close must return focus to the trigger");
assert.equal(elements.panel.getAttribute("inert"), "");
assert.deepEqual(thumbnailOpenStates, [true, false]);

stats = {
  documentBackground: { visible: true, color: "#ffffff" },
  activeLayerIndex: 0,
  activeLayerId: 7,
  mixedScene: null,
  layers: [{
    id: 7,
    name: "Livello 1",
    visible: true,
    opacity: 0.75,
    blendMode: "normal",
    reference: false,
    clippingParentId: null,
    hasContent: false,
  }],
};
assert.deepEqual(controller.selectedLayerProperties(), {
  key: "raster:7",
  name: "Layer 1",
  kind: "raster",
  opacity: 0.75,
  blendMode: "normal",
  rasterIndex: 0,
  semanticId: null,
  clippingEnabled: false,
  clippingAvailable: false,
  locked: false,
});

// The two index-sensitive raster actions must route stable identities through
// the panel boundary; main resolves the current index at mutation time.
stats = {
  documentBackground: { visible: true, color: "#ffffff" },
  activeLayerIndex: 1,
  activeLayerId: 8,
  mixedScene: null,
  layers: [
    {
      id: 7,
      name: "Livello 1",
      visible: true,
      opacity: 1,
      blendMode: "normal",
      reference: false,
      clippingParentId: null,
      hasContent: true,
    },
    {
      id: 8,
      name: "Livello 2",
      visible: true,
      opacity: 1,
      blendMode: "normal",
      reference: false,
      clippingParentId: null,
      hasContent: true,
    },
  ],
};
const clippedViews = controller.views({
  ...stats,
  layers: stats.layers.map((layer) => (
    layer.id === 8 ? { ...layer, clippingParentId: 7 } : layer
  )),
});
assert.deepEqual(
  clippedViews.find((view) => view.key === "raster:8")?.clippingParent,
  { key: "raster:7", name: "Layer 1" },
  "a clipping row must point to its real base layer, even when rendered top-first",
);
controller.setOpen(true);
const clippingRequest = controller.requestClippingToggle.bind(controller);
controller.contextKey = "raster:8";
clippingRequest();
assert.deepEqual(clippingCalls, [{ key: "raster:8", enabled: true }]);
const row = new FakeElement();
row.dataset.layerKey = "raster:8";
const actionButton = new FakeElement();
actionButton.dataset.mobileLayerAction = "reference";
actionButton.closest = () => row;
const actionTarget = new FakeElement();
actionTarget.closest = () => actionButton;
controller.handleListClick({
  target: actionTarget,
});
assert.deepEqual(referenceCalls, [{ key: "raster:8", enabled: true }]);
const contextRow = new FakeElement();
assert.equal(controller.openContextMenu("raster:8", contextRow), true);
assert.equal(elements.contextMenu.hidden, false);
assert.equal(elements.contextMenu.getAttribute("inert"), null);
assert.equal(elements.rasterizeButton.hidden, false);
assert.equal(elements.rasterizeButton.disabled, false);
await controller.requestRasterize();
assert.deepEqual(rasterizeCalls, ["raster:8"]);
assert.equal(layerResults.at(-1), "Layer 2 rasterized.");
assert.equal(elements.contextMenu.hidden, true);
assert.equal(controller.openContextMenu("raster:8", contextRow), true);
controller.cancelTransientInteractions();
assert.equal(elements.contextMenu.hidden, true);
assert.equal(elements.contextMenu.getAttribute("inert"), "");
assert.equal(controller.contextKey, null);
assert.equal(controller.openContextMenu("raster:8", contextRow), true);
interactionLocked = true;
controller.syncInteractionState();
assert.equal(elements.contextMenu.hidden, true);
assert.equal(elements.contextMenu.getAttribute("inert"), "");
assert.equal(controller.contextKey, null);
assert.equal(elements.list.getAttribute("inert"), "");
assert.equal(elements.list.getAttribute("aria-disabled"), "true");
interactionLocked = false;
controller.syncInteractionState();
assert.equal(elements.list.getAttribute("inert"), null);
controller.setOpen(false);

stats = null;
controller.setOpen(true);
document.activeElement = elements.panel;
const focusBeforeDispose = elements.trigger.focusCount;
controller.dispose();
assert.equal(controller.isOpen, false);
assert.equal(
  elements.trigger.focusCount,
  focusBeforeDispose,
  "pagehide disposal must not move focus while the document is leaving",
);
elements.trigger.dispatchEvent(new Event("click"));
assert.equal(controller.isOpen, false, "dispose must abort every installed listener");

console.log("Layer panel controller: ownership, lifecycle, stable ports and live regions verified.");
