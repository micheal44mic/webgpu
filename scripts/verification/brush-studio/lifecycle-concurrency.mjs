import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../../../", import.meta.url));

const moduleServer = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root,
  server: { middlewareMode: true },
});
let MobileBrushStudioController;
try {
  ({ MobileBrushStudioController } = await moduleServer.ssrLoadModule(
    "/src/mobile-brush-studio.ts",
  ));
} finally {
  await moduleServer.close();
}

// Teardown is an idempotent ownership boundary: the draft is restored once,
// listeners are aborted once, in-flight persistence settles, and failed asset
// ids remain queued for a later History/resource retry.
{
  let closeCount = 0;
  let abortCount = 0;
  let releaseCount = 0;
  const applied = [];
  let finishCommit;
  let finishImport;
  const commitPromise = new Promise((resolve) => { finishCommit = resolve; });
  const importPromise = new Promise((resolve) => { finishImport = resolve; });
  const controller = Object.assign(
    Object.create(MobileBrushStudioController.prototype),
    {
      disposed: false,
      disposePromise: null,
      openState: true,
      originalSettings: { tool: "paint", color: "#123456" },
      importRevision: 4,
      sourcePreviewRevision: 8,
      commitPromise,
      importPromise,
      options: { applySettings: (settings) => applied.push(settings) },
      eventAbortController: { abort: () => { abortCount += 1; } },
      closeSheet() {
        closeCount += 1;
        this.openState = false;
      },
      cancelScheduledWork() {
        assert.fail("open teardown must close through the shared sheet lifecycle");
      },
      async requestTransientAssetRelease() {
        releaseCount += 1;
      },
      settingsCache: new Map([["brush", {}]]),
      importedAssets: new Map([["asset", {}]]),
      transientAssetIds: new Set(["asset"]),
      imagePromises: new Map([["image", Promise.resolve({})]]),
      sourceCanvases: new Map([["canvas", {}]]),
      resolvedSources: new Map([["source", {}]]),
    },
  );
  const firstDispose = controller.dispose();
  const secondDispose = controller.dispose();
  assert.equal(firstDispose, secondDispose);
  assert.equal(controller.disposed, true);
  assert.equal(controller.settingsCache.size, 1, "cleanup ran before persistence settled");
  finishCommit();
  await Promise.resolve();
  assert.equal(releaseCount, 0, "asset sweep ran before import settled");
  finishImport();
  await firstDispose;
  assert.equal(closeCount, 1);
  assert.equal(abortCount, 1);
  assert.equal(releaseCount, 1);
  assert.equal(applied.length, 1);
  assert.equal(controller.importRevision, 5);
  assert.equal(controller.sourcePreviewRevision, 9);
  assert.equal(controller.settingsCache.size, 0);
  assert.equal(controller.importedAssets.size, 0);
  assert.equal(controller.transientAssetIds.size, 1);
  assert.equal(controller.imagePromises.size, 0);
  assert.equal(controller.sourceCanvases.size, 0);
  assert.equal(controller.resolvedSources.size, 0);
}

// Cancel cannot race an import/catalog commit and restore stale settings while
// the durable operation is still running.
{
  const controller = Object.assign(
    Object.create(MobileBrushStudioController.prototype),
    {
      openState: true,
      busy: true,
      importRevision: 3,
      cancelScheduledWork: () => assert.fail("busy Cancel must be ignored"),
      closeSheet: () => assert.fail("busy Cancel must not close the Studio"),
      options: {
        applySettings: () => assert.fail("busy Cancel must not restore settings"),
        setBrushLibraryOpen: () => assert.fail("busy Cancel must not reopen Library"),
      },
    },
  );
  controller.cancel(true);
  assert.equal(controller.openState, true);
  assert.equal(controller.importRevision, 3);
}

// Registry removal failures caused by active GPU/History references stay in a
// serialized retry queue and disappear only after the engine accepts removal.
{
  let attempts = 0;
  const controller = Object.assign(
    Object.create(MobileBrushStudioController.prototype),
    {
      transientAssetIds: new Set(["custom-shape:retry"]),
      assetReleaseRequested: false,
      assetReleasePromise: null,
      importedAssets: new Map([["custom-shape:retry", {}]]),
      sourceCanvases: new Map([["custom-shape:retry", {}]]),
      resolvedSources: new Map([["custom-shape:retry", {}]]),
      options: {
        runtime: {
          waitForIdle: async () => {},
        },
        settings: {
          getSettings: () => ({
            shapeAssetId: "legacy-shape",
            grainAssetId: "pencil-grain",
          }),
        },
        assets: {
          removeCustomBrushAsset: () => {
            attempts += 1;
            if (attempts === 1) throw new Error("retained by History");
            return true;
          },
        },
      },
    },
  );
  await controller.requestTransientAssetRelease();
  assert.equal(controller.transientAssetIds.has("custom-shape:retry"), true);
  await controller.requestTransientAssetRelease();
  assert.equal(controller.transientAssetIds.size, 0);
  assert.equal(attempts, 2);
}

// Preview requests collapse to one active render and at most one dirty rerun.
{
  const frames = [];
  const renders = [];
  let finishRender;
  const controller = Object.assign(
    Object.create(MobileBrushStudioController.prototype),
    {
      disposed: false,
      openState: true,
      previewFrame: null,
      previewInFlight: false,
      previewDirty: false,
      browser: {
        requestAnimationFrame: (callback) => {
          frames.push(callback);
          return frames.length;
        },
      },
      renderPreview() {
        renders.push(renders.length + 1);
        return new Promise((resolve) => { finishRender = resolve; });
      },
    },
  );
  controller.schedulePreview();
  controller.schedulePreview();
  assert.equal(frames.length, 1);
  frames.shift()(0);
  assert.equal(renders.length, 1);
  controller.schedulePreview();
  assert.equal(frames.length, 0);
  finishRender();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(frames.length, 1);
}

console.log("Brush Studio verification passed.");
