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
assert.match(controllerSource, /setLayerClipping: \(key: LayerPanelKey/);
assert.match(controllerSource, /DOCUMENT_BACKGROUND_ROW_KEY = "background"/);
assert.match(controllerSource, /name: "Background"/);
assert.match(controllerSource, /mobile-layer-background-color/);
assert.match(controllerSource, /CornerRightDown/);
assert.match(controllerSource, /mobile-layer-clipping-indicator/);
assert.match(controllerSource, /layer\.clippingParentId === null \? null : `raster:\$\{layer\.clippingParentId\}`/);
assert.match(controllerSource, /clippingParent: this\.clippingParentView\(stats, item\.clippingParentKey\)/);
assert.match(controllerSource, /is-clipping-child/);
assert.match(controllerSource, /view\.clippingParent\?\.key \?\? ""/);
assert.match(controllerSource, /Clipped to \$\{view\.clippingParent\.name\}/);
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
assert.match(
  controllerSource,
  /select\.disabled = background[\s\S]*?this\.multiSelectEnabled \? !multiSelectionAvailable : locked/,
);
assert.match(controllerSource, /this\.options\.setRasterReference\(key,/);
assert.match(controllerSource, /this\.options\.setLayerClipping\(properties\.key,/);
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
  /setLayerClipping: \(key, enabled\) =>\s*sceneEditorController\?\.setLayerClipping\(key, enabled\)/,
);
assert.match(sceneEditorSource, /setSceneLayerClipping\(key, enabled\)/);
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
const mergeCalls = [];
const layerResults = [];
const multiSelectionUpdates = [];
const thumbnailInvalidations = [];
const thumbnailEnsures = [];
let multiSelectionFinishAllowed = true;
let multiSelectionFinishRequests = 0;
let multiSelectionMergeAllowed = false;
let mergePreparationAllowed = true;
let multiSelectionChangeAllowed = false;
let selectionPreparationAllowed = true;
let mergeExitAllowed = true;
let mergeShouldFail = false;
const mergeSequence = [];
const selectionSequence = [];
const mergeExitSelectionStates = [];
const controller = new LayerPanelController({
  browser,
  document,
  elements,
  thumbnails: {
    setPanelOpen: (open) => thumbnailOpenStates.push(open),
    queueMissing() {},
    invalidateActive: (delayMs) => thumbnailInvalidations.push(delayMs),
    ensureActive: (delayMs) => thumbnailEnsures.push(delayMs),
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
  mergeLayers: async (keys) => {
    mergeSequence.push("merge");
    mergeCalls.push([...keys]);
    if (mergeShouldFail) throw new Error("Injected merge failure.");
    return { itemCount: 2 };
  },
  canChangeMultiSelection: () => multiSelectionChangeAllowed,
  prepareMultiSelectionChange: async () => {
    selectionSequence.push("prepare");
    return selectionPreparationAllowed;
  },
  canMergeMultiSelection: () => multiSelectionMergeAllowed,
  prepareMultiSelectionMerge: async () => {
    mergeSequence.push("prepare");
    return mergePreparationAllowed;
  },
  onMultiSelectionMergeStart: async () => {
    mergeSequence.push("start");
    mergeExitSelectionStates.push(controller.isMultiSelect);
    return mergeExitAllowed;
  },
  onMultiSelectionChange: ({ enabled, orderedKeys }) => {
    multiSelectionUpdates.push({ enabled, orderedKeys: [...orderedKeys] });
  },
  canFinishMultiSelection: () => multiSelectionFinishAllowed,
  requestFinishMultiSelection: async () => {
    multiSelectionFinishRequests += 1;
    controller.finishMultiSelection();
    return true;
  },
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
  setLayerClipping: (key, enabled) => clippingCalls.push({ key, enabled }),
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
  contentOpacity: 1,
  cutoutMode: "off",
  tonalBlend: {
    current: [0, 0, 255, 255],
    underlying: [0, 0, 255, 255],
  },
  rasterIndex: 0,
  semanticId: null,
  clippingEnabled: false,
  clippingAvailable: false,
  clippingParentKey: null,
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
controller.setMultiSelect(true);
assert.equal(controller.isMultiSelect, true);
assert.deepEqual(multiSelectionUpdates.at(-1), {
  enabled: true,
  orderedKeys: ["raster:8"],
});
await controller.requestMultiSelectionToggle("raster:7");
assert.deepEqual(
  multiSelectionUpdates.at(-1),
  {
    enabled: true,
    orderedKeys: ["raster:7", "raster:8"],
  },
  "multi-selection notifications must follow bottom-to-top scene order",
);
const notificationsBeforePanelClose = multiSelectionUpdates.length;
controller.setOpen(false);
assert.equal(
  controller.isMultiSelect,
  true,
  "closing the panel must preserve the current multiple selection",
);
assert.equal(
  multiSelectionUpdates.length,
  notificationsBeforePanelClose,
  "closing the panel must not publish a false selection reset",
);
const completeStats = stats;
stats = {
  ...stats,
  activeLayerIndex: 0,
  activeLayerId: 8,
  layers: [stats.layers[1]],
};
controller.requestRefresh();
assert.deepEqual(
  multiSelectionUpdates.at(-1),
  {
    enabled: true,
    orderedKeys: ["raster:8"],
  },
  "closed-panel reconciliation must remove stale keys and publish the survivor",
);
assert.deepEqual(controller.getMultiSelectionSnapshot(), {
  enabled: true,
  orderedKeys: ["raster:8"],
});
stats = completeStats;
controller.requestRefresh();
controller.setOpen(true);
assert.equal(controller.isMultiSelect, true);
const mergeCallsBeforeFinish = mergeCalls.length;
assert.equal(controller.finishMultiSelection(), true);
assert.deepEqual(multiSelectionUpdates.at(-1), {
  enabled: false,
  orderedKeys: [],
});
assert.equal(controller.isMultiSelect, false);
assert.equal(mergeCalls.length, mergeCallsBeforeFinish);
assert.equal(
  controller.finishMultiSelection(),
  false,
  "finishing an inactive multiple selection must be a no-op",
);

// A transform opened by this same selection is a merge prerequisite, not an
// unrelated document lock. Merge settles it once, then forwards stable keys.
controller.setMultiSelect(true);
await controller.requestMultiSelectionToggle("raster:7");
interactionLocked = true;
multiSelectionChangeAllowed = true;
multiSelectionMergeAllowed = true;
controller.syncInteractionState();
assert.equal(
  elements.list.getAttribute("inert"),
  null,
  "the layer list must remain actionable for its own Transform lock",
);
controller.render(stats);
assert.equal(elements.mergeSelectionButton.disabled, false);

// A failed verified tool exit must leave the exact selection available for a
// retry and must never enter the structural mutation.
mergeExitAllowed = false;
await controller.requestMerge();
assert.deepEqual(mergeSequence, ["prepare", "start"]);
assert.equal(
  mergeExitSelectionStates.at(-1),
  false,
  "the tool exits only after the exact panel selection has been captured",
);
assert.deepEqual(controller.getMultiSelectionSnapshot(), {
  enabled: true,
  orderedKeys: ["raster:7", "raster:8"],
});
assert.equal(mergeCalls.length, mergeCallsBeforeFinish);

mergeSequence.length = 0;
mergeExitAllowed = true;
const firstMerge = controller.requestMerge();
const duplicateMerge = controller.requestMerge();
await Promise.all([firstMerge, duplicateMerge]);
assert.deepEqual(mergeSequence, ["prepare", "start", "merge"]);
assert.deepEqual(mergeCalls.at(-1), ["raster:7", "raster:8"]);
assert.equal(controller.isMultiSelect, false);

// A lock owned by any other operation must still block Merge and preserve the
// selection so the user can retry after that operation completes.
mergeSequence.length = 0;
controller.setMultiSelect(true);
await controller.requestMultiSelectionToggle("raster:7");
multiSelectionChangeAllowed = false;
multiSelectionMergeAllowed = false;
await controller.requestMerge();
assert.deepEqual(mergeSequence, []);
assert.equal(controller.isMultiSelect, true);
await controller.requestMultiSelectionToggle("raster:7");
assert.deepEqual(
  controller.getMultiSelectionSnapshot().orderedKeys,
  ["raster:7", "raster:8"],
  "an unrelated lock must also block selected-key mutations",
);
controller.finishMultiSelection();
interactionLocked = false;
multiSelectionChangeAllowed = false;
mergePreparationAllowed = true;
thumbnailEnsures.length = 0;

// Selection changes are serialized behind the owned Transform settlement.
// Rapid clicks cannot race two independently prepared key sets.
controller.setMultiSelect(true);
interactionLocked = true;
multiSelectionChangeAllowed = true;
let releaseFirstSelectionPreparation;
const firstSelectionPreparation = new Promise((resolve) => {
  releaseFirstSelectionPreparation = resolve;
});
let selectionPreparationCount = 0;
controller.options.prepareMultiSelectionChange = async () => {
  selectionSequence.push(`prepare-${selectionPreparationCount + 1}`);
  selectionPreparationCount += 1;
  if (selectionPreparationCount === 1) await firstSelectionPreparation;
  return true;
};
const rapidAdd = controller.requestMultiSelectionToggle("raster:7");
const rapidRemove = controller.requestMultiSelectionToggle("raster:7");
for (let turn = 0; turn < 8 && selectionPreparationCount === 0; turn += 1) {
  await Promise.resolve();
}
assert.deepEqual(selectionSequence.slice(-1), ["prepare-1"]);
releaseFirstSelectionPreparation();
await Promise.all([rapidAdd, rapidRemove]);
assert.deepEqual(selectionSequence.slice(-2), ["prepare-1", "prepare-2"]);
assert.deepEqual(controller.getMultiSelectionSnapshot(), {
  enabled: true,
  orderedKeys: ["raster:8"],
});
controller.finishMultiSelection();
interactionLocked = false;
multiSelectionChangeAllowed = false;

// If the structural operation itself fails atomically, all still-live keys are
// restored instead of leaving the user in a dead-end mode.
controller.options.prepareMultiSelectionChange = async () => true;
controller.setMultiSelect(true);
await controller.requestMultiSelectionToggle("raster:7");
interactionLocked = true;
multiSelectionMergeAllowed = true;
mergeShouldFail = true;
mergeSequence.length = 0;
await controller.requestMerge();
assert.deepEqual(mergeSequence, ["prepare", "start", "merge"]);
assert.deepEqual(controller.getMultiSelectionSnapshot(), {
  enabled: true,
  orderedKeys: ["raster:7", "raster:8"],
});
mergeShouldFail = false;
controller.finishMultiSelection();
interactionLocked = false;
multiSelectionMergeAllowed = false;
thumbnailEnsures.length = 0;

// An open group transform owns the generic interaction lock. Its Done button
// remains the escape route and delegates to the shared async coordinator.
controller.setMultiSelect(true);
interactionLocked = true;
controller.syncToolbar(stats, true);
assert.equal(elements.multiSelectButton.disabled, false);
elements.multiSelectButton.dispatchEvent(new Event("click"));
await Promise.resolve();
assert.equal(multiSelectionFinishRequests, 1);
assert.equal(controller.isMultiSelect, false);
interactionLocked = false;

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

// A raster directly above editable text can use that text as its clipping base.
stats = {
  documentBackground: { visible: true, color: "#ffffff" },
  activeLayerIndex: 0,
  activeLayerId: 8,
  layers: [{ ...stats.layers[1], id: 8, name: "Image paint" }],
  mixedScene: {
    selectedKey: "raster:8",
    activeRasterLayerId: 8,
    items: [
      {
        key: "text:5",
        kind: "text",
        clippingParentKey: null,
        textNode: {
          id: 5,
          name: "Editable text",
          visible: true,
          opacity: 1,
          text: "Editable",
          color: "#ffffff",
        },
      },
      {
        key: "raster:8",
        kind: "raster",
        rasterLayerId: 8,
        rasterLayerIndex: 0,
        rasterClippingParentId: null,
        clippingParentKey: null,
      },
    ],
  },
};
assert.equal(controller.selectedLayerProperties("raster:8")?.clippingAvailable, true);
assert.equal(controller.openContextMenu("raster:8", contextRow), true);
assert.equal(elements.clippingButton.hidden, false);
assert.equal(elements.clippingButton.disabled, false);
controller.contextKey = "raster:8";
clippingRequest();
assert.deepEqual(clippingCalls.at(-1), { key: "raster:8", enabled: true });
stats.mixedScene.items[1].clippingParentKey = "text:5";
assert.deepEqual(
  controller.views(stats).find((view) => view.key === "raster:8")?.clippingParent,
  { key: "text:5", name: "Editable text" },
  "a raster clipped to editable text must name its real text base",
);
assert.equal(controller.selectedLayerProperties("raster:8")?.clippingEnabled, true);
controller.contextKey = "raster:8";
clippingRequest();
assert.deepEqual(clippingCalls.at(-1), { key: "raster:8", enabled: false });

// The quick Add mask control must also be available when editable text is the
// selected base. The created child is still a normal paintable raster layer.
stats.mixedScene.selectedKey = "text:5";
controller.syncToolbar(stats, false);
assert.equal(
  elements.addMaskButton.disabled,
  false,
  "editable text must be able to anchor a newly created raster clipping layer",
);
stats.mixedScene.selectedKey = "raster:8";
assert.deepEqual(thumbnailInvalidations, [0]);
assert.deepEqual(thumbnailEnsures, []);
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

// A busy desktop frame may postpone the hold timer. The first mouse movement
// after the real hold deadline must arm and enter reorder instead of being
// rejected by the pre-hold movement tolerance.
const delayedMouseGesture = {
  pointerId: 41,
  key: "raster:8",
  name: "Layer 2",
  row: new FakeElement(),
  select: new FakeElement(),
  startClientX: 10,
  startClientY: 10,
  startTime: 0,
  startScrollTop: 0,
  restoreFocus: false,
  sceneOrderSignature: "test-order",
  holdTimer: 73,
  phase: "pending",
  plan: null,
  currentSlot: 0,
  clientY: 10,
  frame: null,
  lastFrameTime: 0,
};
const originalNow = browser.performance.now;
const originalClearTimeout = browser.clearTimeout;
const originalArmContextGesture = controller.armContextGesture;
const originalActivateReorder = controller.activateReorder;
let clearedHoldTimer = null;
let armedMouseReorder = 0;
let activatedMouseReorder = 0;
let preventedMouseMove = 0;
browser.performance.now = () => 321;
browser.clearTimeout = (timer) => { clearedHoldTimer = timer; };
controller.reorderGesture = delayedMouseGesture;
controller.armContextGesture = () => {
  armedMouseReorder += 1;
  delayedMouseGesture.phase = "armed";
};
controller.activateReorder = () => {
  activatedMouseReorder += 1;
  delayedMouseGesture.phase = "dragging";
};
controller.handleReorderPointerMove({
  pointerId: 41,
  clientX: 10,
  clientY: 30,
  preventDefault: () => { preventedMouseMove += 1; },
});
assert.equal(clearedHoldTimer, 73);
assert.equal(armedMouseReorder, 1);
assert.equal(activatedMouseReorder, 1);
assert.equal(preventedMouseMove, 1);
assert.equal(delayedMouseGesture.phase, "dragging");
controller.reorderGesture = null;
browser.performance.now = originalNow;
browser.clearTimeout = originalClearTimeout;
controller.armContextGesture = originalArmContextGesture;
controller.activateReorder = originalActivateReorder;

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
