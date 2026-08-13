import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "vite";

const source = readFileSync(
  new URL("../src/layer-thumbnail-controller.ts", import.meta.url),
  "utf8",
);
assert.match(source, /dirtyGenerationByLayerId/);
assert.match(source, /invalidateActive\(delayMs = 120\)/);
assert.match(source, /ensureActive\(delayMs = 0\)/);
assert.match(source, /resumeCapture\(delayMs = 0\)/);
assert.match(source, /this\.dirtyGenerationByLayerId\.size > this\.cache\.maximum/);
assert.match(
  source,
  /!== requestedGeneration[\s\S]*?this\.pendingLayerIds\.add\(layerId\);[\s\S]*?return;/,
  "stale in-flight pixels must be discarded and recaptured",
);

const moduleServer = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: process.cwd(),
  server: { middlewareMode: true },
});
let LayerThumbnailController;
try {
  ({ LayerThumbnailController } = await moduleServer.ssrLoadModule(
    "/src/layer-thumbnail-controller.ts",
  ));
} finally {
  await moduleServer.close();
}

class FakeImageData {
  constructor(data, width, height) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

class FakeBrowser {
  ImageData = FakeImageData;
  nextTimerId = 1;
  timers = new Map();

  setTimeout(callback) {
    const id = this.nextTimerId;
    this.nextTimerId += 1;
    this.timers.set(id, callback);
    return id;
  }

  clearTimeout(id) {
    this.timers.delete(id);
  }

  runNextTimer() {
    const next = this.timers.entries().next();
    assert.equal(next.done, false, "expected a queued thumbnail timer");
    const [id, callback] = next.value;
    this.timers.delete(id);
    callback();
  }
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

const settle = () => new Promise((resolve) => setImmediate(resolve));
const capture = (layerId, value = layerId) => ({
  layerId,
  width: 1,
  height: 1,
  rgba: new Uint8Array([value, value, value, 255]),
});

function createHarness(initialStats) {
  const browser = new FakeBrowser();
  const captureCalls = [];
  const pendingCaptures = [];
  const dirtyNotifications = [];
  let stats = initialStats;
  let canSchedule = true;
  const controller = new LayerThumbnailController({
    browser,
    getStats: () => stats,
    captureRasterLayerThumbnail: (layerId) => {
      captureCalls.push(layerId);
      const result = deferred();
      pendingCaptures.push(result);
      return result.promise;
    },
    canScheduleCapture: () => canSchedule,
    captureBusy: () => false,
    onDirty: () => dirtyNotifications.push(true),
  });
  return {
    browser,
    controller,
    captureCalls,
    pendingCaptures,
    dirtyNotifications,
    setStats(value) { stats = value; },
    setCanSchedule(value) { canSchedule = value; },
  };
}

// Ensure never dirties a clean cache; invalidation does. A temporarily blocked
// queue performs no polling and resumes only after an explicit lifecycle wake.
{
  const harness = createHarness({
    activeLayerIndex: 0,
    layers: [{ id: 3, hasContent: true }],
  });
  harness.controller.setPanelOpen(true);
  harness.browser.runNextTimer();
  harness.pendingCaptures.shift().resolve(capture(3));
  await settle();
  assert.ok(harness.controller.rasterRevision(3) > 0);
  assert.equal(harness.browser.timers.size, 0);

  harness.controller.ensureActive();
  assert.equal(harness.browser.timers.size, 0, "ensure must reuse a clean cached preview");
  harness.controller.invalidateActive();
  assert.equal(harness.browser.timers.size, 1, "invalidate must schedule a new readback");
  harness.browser.runNextTimer();
  harness.pendingCaptures.shift().resolve(capture(3, 4));
  await settle();

  harness.setCanSchedule(false);
  harness.controller.invalidateActive();
  assert.equal(harness.browser.timers.size, 0);
  harness.setCanSchedule(true);
  harness.controller.resumeCapture();
  assert.equal(harness.browser.timers.size, 1);
  harness.browser.runNextTimer();
  harness.pendingCaptures.shift().resolve(capture(3, 5));
  await settle();
  harness.controller.dispose();
}

// Active-first drain is serialized, and duplicate previews share the immutable
// ImageData entry instead of allocating another 64² CPU copy.
{
  const harness = createHarness({
    activeLayerIndex: 1,
    layers: [
      { id: 1, hasContent: true },
      { id: 2, hasContent: true },
    ],
  });
  harness.controller.setPanelOpen(true);
  harness.browser.runNextTimer();
  assert.deepEqual(harness.captureCalls, [2]);
  harness.pendingCaptures.shift().resolve(capture(2));
  await settle();
  harness.browser.runNextTimer();
  assert.deepEqual(harness.captureCalls, [2, 1]);
  harness.pendingCaptures.shift().resolve(capture(1));
  await settle();
  const sourceRevision = harness.controller.rasterRevision(2);
  assert.ok(sourceRevision > 0);
  assert.equal(harness.controller.copyRasterEntry(2, 9), true);
  assert.equal(harness.controller.rasterRevision(9), sourceRevision);
  harness.controller.dispose();
}

// A duplicate must not inherit stale pixels while its source has a newer
// generation waiting for capture. The active duplicate gets its own readback.
{
  const harness = createHarness({
    activeLayerIndex: 0,
    layers: [{ id: 2, hasContent: true }],
  });
  harness.controller.setPanelOpen(true);
  harness.browser.runNextTimer();
  harness.pendingCaptures.shift().resolve(capture(2));
  await settle();
  harness.controller.invalidateActive(0);
  assert.equal(harness.controller.copyRasterEntry(2, 9), false);
  harness.setStats({
    activeLayerIndex: 1,
    layers: [
      { id: 2, hasContent: true },
      { id: 9, hasContent: true },
    ],
  });
  harness.controller.ensureActive(0);
  harness.browser.runNextTimer();
  assert.deepEqual(harness.captureCalls, [2, 9]);
  harness.pendingCaptures.shift().resolve(capture(9));
  await settle();
  assert.ok(harness.controller.rasterRevision(9) > 0);
  harness.controller.dispose();
}

// A newer invalidation while the first capture is still in flight makes those
// pixels stale even while the panel stays open.
{
  const harness = createHarness({
    activeLayerIndex: 0,
    layers: [{ id: 7, hasContent: true }],
  });
  harness.controller.setPanelOpen(true);
  harness.browser.runNextTimer();
  assert.deepEqual(harness.captureCalls, [7]);
  harness.controller.invalidateActive(0);
  harness.pendingCaptures.shift().resolve(capture(7, 10));
  await settle();
  assert.equal(harness.controller.rasterRevision(7), 0);
  harness.browser.runNextTimer();
  assert.deepEqual(harness.captureCalls, [7, 7]);
  harness.pendingCaptures.shift().resolve(capture(7, 20));
  await settle();
  assert.ok(harness.controller.rasterRevision(7) > 0);
  harness.controller.dispose();
}

// Dirty work requested while closed survives the pause and drains on reopen.
{
  const harness = createHarness({
    activeLayerIndex: 0,
    layers: [{ id: 8, hasContent: true }],
  });
  harness.controller.setPanelOpen(true);
  harness.controller.setPanelOpen(false);
  harness.controller.invalidateActive(0);
  assert.equal(harness.browser.timers.size, 0);
  harness.controller.setPanelOpen(true);
  harness.browser.runNextTimer();
  harness.pendingCaptures.shift().resolve(capture(8));
  await settle();
  assert.ok(harness.controller.rasterRevision(8) > 0);
  harness.controller.dispose();
}

// A layer that temporarily leaves the live scene (for example across Undo)
// keeps its bounded cached preview, while stale pending work is discarded.
{
  const layer12Stats = {
    activeLayerIndex: 0,
    layers: [{ id: 12, hasContent: true }],
  };
  const harness = createHarness(layer12Stats);
  harness.controller.setPanelOpen(true);
  harness.browser.runNextTimer();
  harness.pendingCaptures.shift().resolve(capture(12));
  await settle();
  const retainedRevision = harness.controller.rasterRevision(12);
  assert.ok(retainedRevision > 0);

  harness.controller.setPanelOpen(false);
  harness.setStats({
    activeLayerIndex: 0,
    layers: [{ id: 13, hasContent: true }],
  });
  harness.controller.invalidate(12, 0);
  harness.setStats(layer12Stats);
  harness.controller.ensureActive();
  assert.equal(harness.controller.rasterRevision(12), retainedRevision);
  assert.equal(harness.browser.timers.size, 0);
  harness.controller.dispose();
}

// Disposal invalidates an outstanding completion and frees timers/cache.
{
  const harness = createHarness({
    activeLayerIndex: 0,
    layers: [{ id: 11, hasContent: true }],
  });
  harness.controller.setPanelOpen(true);
  harness.browser.runNextTimer();
  harness.controller.dispose();
  harness.pendingCaptures.shift().resolve(capture(11));
  await settle();
  assert.equal(harness.controller.rasterRevision(11), 0);
  assert.equal(harness.browser.timers.size, 0);
}

console.log("Layer thumbnail controller: serialization, generations, pause and disposal verified.");
