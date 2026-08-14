import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "vite";

const source = readFileSync(
  new URL("../src/scene-editor-controller.ts", import.meta.url),
  "utf8",
);
const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");

assert.match(main, /sceneEditorController = new SceneEditorController\(\{/);
assert.match(main, /sceneEditorController\?\.dispose\(\)/);
assert.doesNotMatch(
  main,
  /let layerSwitching|async function (?:changeLayer|changeVector|changeRasterImage|selectMixedSceneItem|selectLayer|addRasterLayer|performMobileLayer)/,
  "main.ts must not regain ownership of complete scene mutations",
);
assert.match(source, /export type SceneEditorEnginePort = Pick</);
assert.match(source, /selectedSceneLayerProperties\([\s\S]*?key/);
assert.match(source, /rasterIndexForSceneLayerKey\(stats, key\)/);
assert.doesNotMatch(source, /document\.getElementById|\belement<|window\./);

const moduleServer = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: process.cwd(),
  server: { middlewareMode: true },
});
let SceneEditorController;
try {
  ({ SceneEditorController } = await moduleServer.ssrLoadModule(
    "/src/scene-editor-controller.ts",
  ));
} finally {
  await moduleServer.close();
}

class FakeElement {
  hidden = true;
  textContent = "";
  attributes = new Map();

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const raster7 = {
  id: 7,
  name: "Livello 1",
  visible: true,
  opacity: 1,
  blendMode: "normal",
  reference: false,
  clippingParentId: null,
  hasContent: true,
};
const raster8 = {
  id: 8,
  name: "Livello 2",
  visible: true,
  opacity: 1,
  blendMode: "normal",
  reference: false,
  clippingParentId: null,
  hasContent: true,
};
const textNode = { id: 5, name: "Testo 5", visible: true, opacity: 1 };
const imageNode = { id: 9, name: "Immagine 9", visible: true, opacity: 1 };
let stats = {
  activeLayerIndex: 1,
  activeLayerId: 7,
  layers: [raster8, raster7],
  mixedScene: {
    selectedKey: "raster:7",
    activeRasterLayerId: 7,
    items: [
      {
        key: "raster:8",
        kind: "raster",
        rasterLayerId: 8,
        rasterLayerIndex: 0,
        rasterClippingParentId: null,
      },
      {
        key: "raster:7",
        kind: "raster",
        rasterLayerId: 7,
        rasterLayerIndex: 1,
        rasterClippingParentId: null,
      },
      { key: "text:5", kind: "text", textNode },
      { key: "image:9", kind: "image", imageNode },
    ],
  },
};
const calls = [];
let pendingMove = null;
const engine = {
  getStats: () => stats,
  getHistoryState: () => ({
    cursor: 0,
    actionCount: 0,
    busy: false,
    inconsistent: false,
    openEdit: null,
  }),
  getMixedSceneSnapshot: () => stats.mixedScene,
  getMixedSceneReorderTargets: (key) => ({ key }),
  moveMixedSceneItem: (key, slot) => {
    calls.push(["move", key, slot]);
    pendingMove = deferred();
    return pendingMove.promise;
  },
  setLayerReference: async (index, enabled) => {
    calls.push(["reference", index, enabled]);
    return true;
  },
  setLayerClipping: async (index, enabled) => {
    calls.push(["clipping", index, enabled]);
    return true;
  },
  setLayerOpacity: async (index, opacity) => calls.push(["raster-opacity", index, opacity]),
  setLayerVisibility: async (index, visible) => calls.push(["raster-visible", index, visible]),
  setLayerBlendMode: async (index, mode) => {
    calls.push(["blend", index, mode]);
    return true;
  },
  setVectorTextNodeOpacity: async (id, opacity) => calls.push(["text-opacity", id, opacity]),
  setVectorTextNodeVisibility: async (id, visible) => calls.push(["text-visible", id, visible]),
  setVectorSvgNodeOpacity: async () => {},
  setVectorSvgNodeVisibility: async () => {},
  setRasterImageNodeOpacity: async (id, opacity) => calls.push(["image-opacity", id, opacity]),
  setRasterImageNodeVisibility: async (id, visible) => calls.push(["image-visible", id, visible]),
  deleteLayer: async (index) => calls.push(["delete-raster", index]),
  deleteVectorTextNode: async (id) => calls.push(["delete-text", id]),
  deleteVectorSvgNode: async (id) => calls.push(["delete-svg", id]),
  deleteRasterImageNode: async (id) => calls.push(["delete-image", id]),
  duplicateSelectedLayer: async () => ({
    kind: "raster",
    sourceKey: "raster:7",
    duplicateKey: "raster:10",
    name: "Livello 3",
    sourceRasterLayerId: 7,
    duplicateRasterLayerId: 10,
    totalMs: 1,
  }),
  rasterizeActiveRasterLayer: async () => {
    calls.push(["rasterize", 7]);
    return {
      layerId: 7,
      name: "Livello 1",
      bakedEffects: true,
      detachedSource: false,
      preservedBlendMode: true,
      preservedOpacity: true,
      bounds: { x: 0, y: 0, width: 32, height: 32 },
    };
  },
  setActiveLayer: async () => null,
  setActiveMixedSceneItem: async () => null,
  addClippingMaskLayer: async () => ({ toIndex: 2, totalMs: 1 }),
  addLayer: async () => ({ toIndex: 2, totalMs: 1 }),
  waitForIdle: async () => {},
};
const elements = {
  app: new FakeElement(),
  loadingOverlay: new FakeElement(),
  loadingLabel: new FakeElement(),
  result: new FakeElement(),
};
const busyChanges = [];
let interactionLocked = false;
const controller = new SceneEditorController({
  engine,
  browser: {
    requestAnimationFrame(callback) {
      callback(0);
      return 1;
    },
  },
  elements,
  getVectorController: () => null,
  isInteractionLocked: () => interactionLocked,
  onBusyChange: (busy) => busyChanges.push(busy),
  onHistoryState() {},
  requestLayersRefresh() {},
  renderLayers() {},
  syncActiveRasterControls() {},
  syncToolSettings() {},
  onStats() {},
  recordDiagnostic() {},
});

// The key is resolved against the latest scene immediately before mutation.
controller.setRasterReference("raster:7", true);
assert.equal(controller.isBusy, true);
assert.equal(elements.loadingOverlay.hidden, false);
assert.equal(elements.app.getAttribute("aria-busy"), "true");
await settle();
assert.deepEqual(calls.at(-1), ["reference", 1, true]);
assert.equal(controller.isBusy, false);
assert.equal(elements.loadingOverlay.hidden, true);
assert.equal(elements.app.getAttribute("aria-busy"), null);

controller.setLayerOpacity("text:5", 0.4);
await settle();
assert.deepEqual(calls.at(-1), ["text-opacity", 5, 0.4]);
controller.setLayerVisibility("image:9", false);
await settle();
assert.deepEqual(calls.at(-1), ["image-visible", 9, false]);
await controller.deleteLayer("text:5");
assert.deepEqual(calls.at(-1), ["delete-text", 5]);

const rasterizeResult = await controller.rasterizeLayer("raster:7");
assert.deepEqual(calls.at(-1), ["rasterize", 7]);
assert.deepEqual(rasterizeResult, {
  kind: "raster",
  name: "Layer 1",
  changed: true,
  outputKey: "raster:7",
});
assert.match(elements.result.textContent, /blend mode e opacità preservati/);

const moving = controller.moveLayer("raster:7", 0);
assert.equal(controller.isBusy, true);
await assert.rejects(
  controller.moveLayer("raster:8", 1),
  /Layer move canceled/,
);
pendingMove.resolve(true);
assert.equal(await moving, true);
assert.equal(controller.isBusy, false);

interactionLocked = true;
await assert.rejects(
  controller.deleteLayer("image:9"),
  /Eliminazione non disponibile/,
);
interactionLocked = false;
assert.deepEqual(
  busyChanges,
  [true, false, true, false, true, false, true, false, true, false, true, false],
);

controller.dispose();
assert.equal(controller.isBusy, false);
assert.equal(elements.loadingOverlay.hidden, true);

// Disposal while the two-frame loader is waiting must prevent a new engine
// mutation from starting after pagehide.
{
  const queuedFrames = [];
  let addCalls = 0;
  const lifecycleElements = {
    app: new FakeElement(),
    loadingOverlay: new FakeElement(),
    loadingLabel: new FakeElement(),
    result: new FakeElement(),
  };
  const lifecycleController = new SceneEditorController({
    engine: {
      ...engine,
      async addLayer() {
        addCalls += 1;
        return { toIndex: 2, totalMs: 1 };
      },
    },
    browser: {
      requestAnimationFrame(callback) {
        queuedFrames.push(callback);
        return queuedFrames.length;
      },
    },
    elements: lifecycleElements,
    getVectorController: () => null,
    isInteractionLocked: () => false,
    onBusyChange() {},
    onHistoryState() {},
    requestLayersRefresh() {},
    renderLayers() {},
    syncActiveRasterControls() {},
    syncToolSettings() {},
    onStats() {},
    recordDiagnostic() {},
  });
  lifecycleController.addRasterLayer();
  assert.equal(lifecycleController.isBusy, true);
  assert.equal(queuedFrames.length, 1);
  lifecycleController.dispose();
  queuedFrames.shift()(0);
  await settle();
  assert.equal(addCalls, 0);
  assert.equal(lifecycleController.isBusy, false);
  assert.equal(lifecycleElements.loadingOverlay.hidden, true);
}

console.log("Scene editor controller: stable keys, transactions, locks and lifecycle verified.");
