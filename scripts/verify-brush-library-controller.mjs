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

// Precision normalization belongs to the Studio port. The Library must apply
// its resolved object verbatim instead of rebuilding it from a legacy fallback.
// This models a global 16-bit preference resolving a legacy 8-bit brush.
{
  const legacyFallback = {
    name: "legacy-8-bit",
    shapeMaskFormat: "r8unorm",
  };
  const studioResolved = {
    name: "studio-normalized-16-bit",
    shapeMaskFormat: "r16float",
  };
  const applied = [];
  const resolveCalls = [];
  let currentSettings = {
    name: "current",
    shapeMaskFormat: "r16float",
  };
  const controller = controllerShell({
    engine: {
      getSettings: () => ({ ...currentSettings }),
      ensureCurrentBrushResources: async () => {},
    },
    studio: {
      isOpen: false,
      rememberSettings() {},
      resolveBrushSettings: async (id, fallback) => {
        resolveCalls.push({ id, fallback });
        return studioResolved;
      },
      releasePreviewAssets: async () => {},
      open() {},
    },
    applySettings: (settings) => {
      applied.push(settings);
      currentSettings = { ...settings };
    },
    fallbackFor: () => legacyFallback,
    categoryFor: () => "painting",
  });

  await controller.selectBrush("legacy-brush");
  assert.equal(resolveCalls.length, 1, "selection bypassed Studio resolution");
  assert.strictEqual(resolveCalls[0].fallback, legacyFallback);
  assert.strictEqual(
    applied[0],
    studioResolved,
    "selection rebuilt settings instead of applying the Studio result",
  );
  assert.equal(currentSettings.shapeMaskFormat, "r16float");
}

// The restore path has the same port contract in the opposite direction: a
// global 8-bit preference must survive restoration of a legacy 16-bit brush.
{
  const legacyFallback = {
    name: "legacy-16-bit",
    shapeMaskFormat: "r16float",
  };
  const studioResolved = {
    name: "studio-normalized-8-bit",
    shapeMaskFormat: "r8unorm",
  };
  const applied = [];
  const controller = controllerShell({
    activeBrushId: "legacy-brush",
    engine: {
      getSettings: () => ({ name: "current", shapeMaskFormat: "r8unorm" }),
      ensureCurrentBrushResources: async () => {},
    },
    studio: {
      resolveBrushSettings: async (id, fallback) => {
        assert.equal(id, "legacy-brush");
        assert.strictEqual(fallback, legacyFallback);
        return studioResolved;
      },
    },
    applySettings: (settings) => applied.push(settings),
    fallbackFor: () => legacyFallback,
    categoryFor: () => "painting",
  });

  await controller.restoreActiveBrush();
  assert.strictEqual(
    applied[0],
    studioResolved,
    "restore rebuilt settings instead of applying the Studio result",
  );
  assert.equal(applied[0].shapeMaskFormat, "r8unorm");
}

// A new brush candidate is sent to both the global apply boundary and Studio.
// Studio owns draft normalization; the Library must not open a different copy.
{
  const current = {
    color: "#111122223333",
    shapeMaskFormat: "r8unorm",
  };
  const remembered = [];
  const applied = [];
  const opened = [];
  const controller = controllerShell({
    engine: { getSettings: () => current },
    studio: {
      rememberSettings: (id, settings) => remembered.push({ id, settings }),
      open: (id, name, settings, original) => opened.push({ id, name, settings, original }),
    },
    applySettings: (settings) => applied.push(settings),
  });

  await controller.createBrush();
  assert.deepEqual(remembered, [{ id: "current", settings: current }]);
  assert.equal(applied.length, 1, "new brush skipped the global apply boundary");
  assert.equal(opened.length, 1, "new brush skipped the Studio normalization boundary");
  assert.strictEqual(opened[0].settings, applied[0]);
  assert.strictEqual(opened[0].original, current);
}

// Import must resolve stored settings through Studio before catalog adoption,
// then enter the already-covered selection transaction that applies its result.
{
  const importSource = BrushLibraryController.prototype.importBrush.toString();
  const resolveIndex = importSource.indexOf("studio.resolveBrushSettings");
  const selectIndex = importSource.indexOf("this.selectBrush(brushId)");
  assert.ok(resolveIndex >= 0, "import bypassed Studio settings resolution");
  assert.ok(selectIndex > resolveIndex, "import selected before Studio resolution completed");
}

console.info("Brush Library controller transaction verification passed.");
