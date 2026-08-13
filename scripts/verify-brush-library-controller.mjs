import assert from "node:assert/strict";
import { createServer } from "vite";

const storageWrites = [];
globalThis.window = {
  localStorage: {
    getItem: () => null,
    setItem: (key, value) => storageWrites.push({ key, value }),
    removeItem: () => {},
  },
};

const moduleServer = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: process.cwd(),
  server: { middlewareMode: true },
});
let BrushLibraryController;
try {
  ({ BrushLibraryController } = await moduleServer.ssrLoadModule(
    "/src/brush-library-controller.ts",
  ));
} finally {
  await moduleServer.close();
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function waitFor(predicate, label) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - started > 1_000) {
        reject(new Error(`Timed out waiting for ${label}`));
        return;
      }
      setTimeout(poll, 0);
    };
    poll();
  });
}

function controllerShell(overrides = {}) {
  return Object.assign(Object.create(BrushLibraryController.prototype), {
    selectionQueue: Promise.resolve(),
    selectionBusy: false,
    transferBusy: false,
    customBrushes: [],
    activeBrushId: "current",
    category: "painting",
    syncAddState() {},
    setCategory() {},
    syncSelection() {},
    markPreviewDirty() {},
    persistActiveBrush() {},
    reportStatus() {},
    onStatus() {},
    ...overrides,
  });
}

// A catalog is not durable until the engine proves the selected brush can be
// consumed. A readiness failure must leave localStorage untouched.
{
  storageWrites.length = 0;
  const readiness = deferred();
  const controller = controllerShell({
    engine: {
      ensureCurrentBrushResources: () => readiness.promise,
    },
    latestCatalog: () => [],
    normalizedBrushId: () => "current",
  });
  const commit = controller.commitStudioBrush("current", "Default Brush");
  await Promise.resolve();
  assert.equal(storageWrites.length, 0, "catalog published before resource readiness");
  readiness.reject(new Error("GPU readiness fault"));
  await assert.rejects(commit, /GPU readiness fault/);
  assert.equal(storageWrites.length, 0, "failed readiness published a catalog");

  controller.engine.ensureCurrentBrushResources = async () => {};
  await controller.commitStudioBrush("current", "Default Brush");
  assert.equal(storageWrites.length, 1, "ready brush did not publish its catalog");
}

// Preview-owned custom assets must be released even when the shared renderer
// rejects. This is the memory safety boundary for repeatedly opening Library.
{
  let released = 0;
  const controller = controllerShell({
    openState: true,
    previewDirty: true,
    previewRevision: 0,
    activeBrushId: "current",
    engine: { getSettings: () => ({ tool: "paint" }) },
    studio: {
      releasePreviewAssets: async () => {
        released += 1;
      },
    },
    previewRenderer: {
      render: async () => {
        throw new Error("preview fault");
      },
    },
    visibleBrushIds: () => ["custom-brush:test"],
    settingsForPreview: async () => ({ tool: "paint" }),
    previewCanvas: () => ({}),
  });
  controller.renderPreview();
  await waitFor(() => released === 1, "preview asset release after render fault");
}

// Two rapid selections are serialized. The second transaction must remember
// the settings produced by the first under the first brush id, never under the
// stale id that was active before readiness completed.
{
  const firstReady = deferred();
  const secondReady = deferred();
  const readiness = [firstReady, secondReady];
  const remembered = [];
  const released = [];
  const ensureCalls = [];
  let currentSettings = { name: "original" };
  const controller = controllerShell({
    engine: {
      getSettings: () => ({ ...currentSettings }),
      ensureCurrentBrushResources: () => {
        const index = ensureCalls.length;
        ensureCalls.push(index);
        return readiness[index].promise;
      },
    },
    studio: {
      isOpen: false,
      rememberSettings: (id, settings) => remembered.push({ id, name: settings.name }),
      resolveBrushSettings: async (id) => ({ name: id }),
      releasePreviewAssets: async (id, settings) => {
        released.push({ id, name: settings.name });
      },
      open() {},
    },
    applySettings: (settings) => {
      currentSettings = { ...settings };
    },
    fallbackFor: () => ({ name: "fallback" }),
    categoryFor: () => "painting",
  });

  const selectFirst = controller.selectBrush("brush-a");
  const selectSecond = controller.selectBrush("brush-b");
  await waitFor(() => ensureCalls.length === 1, "first brush readiness");
  assert.equal(controller.activeBrushId, "current");
  firstReady.resolve();
  await waitFor(() => ensureCalls.length === 2, "second brush readiness");
  assert.equal(controller.activeBrushId, "brush-a");
  secondReady.resolve();
  await Promise.all([selectFirst, selectSecond]);
  assert.equal(controller.activeBrushId, "brush-b");
  assert.deepEqual(remembered, [
    { id: "current", name: "original" },
    { id: "brush-a", name: "brush-a" },
  ]);
  assert.deepEqual(released, [
    { id: "current", name: "original" },
    { id: "brush-a", name: "brush-a" },
  ]);
}

// A failed selection restores both settings and identity before another
// selection can begin.
{
  let currentSettings = { name: "original" };
  let readinessCalls = 0;
  const controller = controllerShell({
    engine: {
      getSettings: () => ({ ...currentSettings }),
      ensureCurrentBrushResources: async () => {
        readinessCalls += 1;
        if (readinessCalls === 1) throw new Error("shape upload failed");
      },
    },
    studio: {
      rememberSettings() {},
      resolveBrushSettings: async () => ({ name: "broken-brush" }),
      releasePreviewAssets: async () => {},
      open() {},
    },
    applySettings: (settings) => {
      currentSettings = { ...settings };
    },
    fallbackFor: () => ({ name: "fallback" }),
    categoryFor: () => "painting",
  });
  await controller.selectBrush("broken");
  assert.equal(controller.activeBrushId, "current");
  assert.deepEqual(currentSettings, { name: "original" });
  assert.equal(readinessCalls, 2, "previous brush readiness was not restored");
}

console.info("Brush Library controller transaction verification passed.");
