import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = new URL("../", import.meta.url);
const workspaceRoot = fileURLToPath(root);
const source = readFileSync(new URL("src/mixed-scene-controller.ts", root), "utf8");

function section(text, start, end) {
  const startIndex = text.indexOf(start);
  assert.ok(startIndex >= 0, `Missing section start: ${start}`);
  const endIndex = text.indexOf(end, startIndex + start.length);
  assert.ok(endIndex > startIndex, `Missing section end after ${start}: ${end}`);
  return text.slice(startIndex, endIndex);
}

const resetSource = section(
  source,
  "  resetForDocument(): number {",
  "  setTransformToolActive(",
);
assert.match(
  resetSource,
  /sceneOperationBusy[\s\S]*transformCommitBusy[\s\S]*transformSessionOpen[\s\S]*groupTransformPreparation[\s\S]*rasterTransformPreparation[\s\S]*throw new Error/,
  "The document boundary must fail closed while scene or transform work is unsettled.",
);
assert.match(resetSource, /geometryByNodeId\.clear\(\)/);
assert.match(resetSource, /displayedDrawsByNodeKey\.clear\(\)/);
assert.match(resetSource, /displayedMetricsByNodeKey\.clear\(\)/);
assert.match(resetSource, /renderedTextRunKeys\.clear\(\)/);
assert.match(resetSource, /effectCompiler\.resetForDocument\(\)/);
assert.match(resetSource, /clearVectorTextFallbackPresentation\(\)/);
assert.match(resetSource, /clearVectorTextPresentation\(\)/);
assert.match(resetSource, /pruneVectorTextGpuMeshes\(new Set<string>\(\)\)/);
assert.doesNotMatch(resetSource, /fontGeometry\.(?:clear|dispose|destroy)/);
assert.doesNotMatch(resetSource, /effectCompiler\.(?:dispose|destroy|terminate)/);
assert.match(
  source,
  /const generation = this\.documentGeneration;[\s\S]{0,260}generation !== this\.documentGeneration[\s\S]{0,180}this\.renderRequest !== request/,
  "A stale animation callback must not clear or run a target-document render request.",
);

const moduleServer = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: workspaceRoot,
  server: { middlewareMode: true },
});
let MixedSceneController;
try {
  ({ MixedSceneController } = await moduleServer.ssrLoadModule(
    "/src/mixed-scene-controller.ts",
  ));
} finally {
  await moduleServer.close();
}

function deferred() {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function waitUntil(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for the semantic presentation checkpoint.");
}

function classList(initial = []) {
  const values = new Set(initial);
  return {
    values,
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    toggle(name, enabled) {
      if (enabled) values.add(name);
      else values.delete(name);
    },
    contains: (name) => values.has(name),
  };
}

function createBrowser() {
  let nextRequest = 1;
  const animationCallbacks = new Map();
  const timerCallbacks = new Map();
  const cancelledAnimationFrames = [];
  const clearedTimers = [];
  return {
    browser: {
      performance: { now: () => 100 },
      requestAnimationFrame(callback) {
        const id = nextRequest++;
        animationCallbacks.set(id, callback);
        return id;
      },
      cancelAnimationFrame(id) {
        cancelledAnimationFrames.push(id);
      },
      setTimeout(callback) {
        const id = nextRequest++;
        timerCallbacks.set(id, callback);
        return id;
      },
      clearTimeout(id) {
        clearedTimers.push(id);
      },
    },
    animationCallbacks,
    timerCallbacks,
    cancelledAnimationFrames,
    clearedTimers,
  };
}

function createHarness(options = {}) {
  const browserState = createBrowser();
  const calls = {
    clearPresentation: 0,
    clearFallback: 0,
    disableFast: 0,
    endRotation: 0,
    pruneMeshes: [],
    releasedPointers: [],
    retainedSlots: [],
    guides: [],
    overlayClears: 0,
    editorChanges: 0,
  };
  const canvasClasses = classList([
    "is-move",
    "is-scale",
    "is-rotate",
    "is-pan",
    "is-distort",
    "is-raster-control",
    "is-editing",
    "is-distort-editing",
    "is-pixel-selection",
  ]);
  const capturedPointers = new Set([11, 12, 13, 14]);
  const attributes = new Map();
  const interactionCanvas = {
    width: 900,
    height: 700,
    hidden: false,
    tabIndex: 0,
    classList: canvasClasses,
    style: { removeProperty() {} },
    hasPointerCapture: (pointerId) => capturedPointers.has(pointerId),
    releasePointerCapture(pointerId) {
      capturedPointers.delete(pointerId);
      calls.releasedPointers.push(pointerId);
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
  };
  const interactionContext = {
    save() {},
    setTransform() {},
    clearRect() {
      calls.overlayClears += 1;
    },
    restore() {},
  };
  const completion = options.completion ?? deferred();
  const host = {
    clearVectorTextPresentation() {
      calls.clearPresentation += 1;
    },
    clearVectorTextFallbackPresentation() {
      calls.clearFallback += 1;
    },
    setVectorTextFastPresentationEnabled(enabled) {
      if (!enabled) calls.disableFast += 1;
    },
    pruneVectorTextGpuMeshes(keys) {
      calls.pruneMeshes.push([...keys]);
    },
    endViewRotationGesture() {
      calls.endRotation += 1;
    },
    getVectorTextViewState() {
      return {
        canvasWidth: 900,
        canvasHeight: 700,
        cssWidth: 900,
        cssHeight: 700,
        centerX: 450,
        centerY: 350,
        zoom: 1,
        rotationRadians: 0,
        rotationCos: 1,
        rotationSin: 0,
      };
    },
    getVectorTextFastPresentationMode: () => "reproject-clipped",
    waitForVectorTextPresentationCompletion: () => completion.promise,
  };
  const fontGeometry = { global: "font-registry" };
  const effectCompiler = {
    resetForDocument() {
      calls.retainedSlots.push([]);
    },
  };
  const effectReadyIdleTimer = browserState.browser.setTimeout(() => {});
  const viewIdleTimer = browserState.browser.setTimeout(() => {});
  const exactRecoveryRequest = browserState.browser.requestAnimationFrame(() => {});
  const unsafeExactRefreshRequest = browserState.browser.requestAnimationFrame(() => {});
  const fastOverlayRequest = browserState.browser.requestAnimationFrame(() => {});
  const renderRequest = browserState.browser.requestAnimationFrame(() => {});
  const shell = Object.create(MixedSceneController.prototype);
  Object.assign(shell, {
    host,
    browser: browserState.browser,
    interactionCanvas,
    interactionContext,
    status: { textContent: "outgoing", dataset: {} },
    svgImportStatus: { textContent: "outgoing" },
    imageImportStatus: { textContent: "outgoing" },
    textRasterStatus: { textContent: "outgoing" },
    rasterTransformGridControls: [{ hidden: false }],
    rasterTransformGridButtons: [{
      disabled: false,
      dataset: { rasterTransformGrid: "3" },
      setAttribute() {},
    }],
    onEditorStateChange: () => {
      calls.editorChanges += 1;
    },
    canvasGuides: {
      setSmartGuides(guides) {
        calls.guides.push([...guides]);
      },
    },
    fontGeometry,
    effectCompiler,
    documentGeneration: 5,
    snapshot: {
      selectedKey: "text:7",
      activeRasterLayerId: 1,
      items: [{ key: "text:7", kind: "text", textNode: { id: 7 } }],
    },
    metrics: { left: 40, top: 50, right: 60, bottom: 70, baseline: 55 },
    geometryByNodeId: new Map([[7, { owner: "outgoing" }]]),
    svgStrokePathsBySemantic: new Map([["outgoing", [{ logicalBytes: 64 }]]]),
    svgStrokeFailedLodsBySemantic: new Map([["outgoing", new Set([2])]]),
    svgStrokePathCacheLogicalBytes: 64,
    svgStrokePathCacheAccessSequence: 3,
    svgStrokePathFallbackCount: 1,
    displayedDrawsByNodeKey: new Map([["text:7", [{ owner: "outgoing" }]]]),
    displayedMetricsByNodeKey: new Map([["text:7", { owner: "outgoing" }]]),
    renderedTextRunKeys: new Set(["text-run:raster:1|text:7"]),
    effectReadyIdleTimer,
    effectReadyRenderPending: true,
    activeInteraction: { pointerId: 11, mode: "pan" },
    renderRequest,
    renderCount: 9,
    lastRenderMs: 21,
    renderSamples: [18, 21],
    liveGpuMemoryMiB: 17,
    singleShadowGpuMemoryMiB: 5,
    singleShadowGpuCacheEntries: 3,
    viewportTextureCount: 4,
    sceneOperationBusy: false,
    sceneOperationRenderDeferred: true,
    pendingViewRender: true,
    pendingViewRenderStartedAt: 20,
    lastViewRenderEndToEndMs: 22,
    adaptiveZoomEnabled: true,
    zoomRenderMode: "fast",
    viewGestureActive: true,
    viewRevision: 19,
    viewIdleTimer,
    exactRecoveryRequest,
    pendingExactRecoveryRevision: 19,
    unsafeExactRefreshRequest,
    fastOverlayRequest,
    unsafeExactRefreshInFlight: true,
    unsafeExactRefreshRevision: 19,
    exitFastAfterScheduledRender: true,
    zoomFastActivationCount: 8,
    zoomExactRecoveryCount: 7,
    zoomViewEventCount: 6,
    zoomSafeReprojectionCount: 5,
    zoomFallbackReprojectionCount: 4,
    zoomClippedReprojectionCount: 3,
    zoomUnsafeExactRefreshCount: 2,
    zoomUnsafeExactRefreshCompletedCount: 2,
    zoomUnsafeExactCoalescedCount: 1,
    lastExactCanvasWidth: 900,
    lastExactCanvasHeight: 700,
    fallbackPresentationDirty: false,
    fallbackPresentationGpuMemoryMiB: 8,
    fallbackPresentationRebuildCount: 4,
    atomicEffectHoldCount: 3,
    atomicEffectPendingNodes: 2,
    distortEditingNodeId: 7,
    transformToolActive: true,
    transformToolDeactivationPending: true,
    rasterTransformToolMode: "warp",
    transformSessionOpen: false,
    transformSessionKind: null,
    requestedGroupTransformKeys: ["raster:1", "text:7"],
    groupTransformSelection: { owner: "outgoing" },
    groupTransformPreparation: null,
    rasterTransformPreparation: null,
    rasterTransformRecoveryOnly: true,
    transformCommitBusy: false,
    pendingRasterPointerId: 12,
    pendingRasterPointerMove: { pointerId: 12 },
    pendingRasterPointerGeneration: 4,
    cancelledPendingRasterPointerGeneration: 4,
    touchContacts: new Map([[14, { x: 1, y: 2 }]]),
    touchTransformModifierPointerId: 13,
    touchNavigationGesture: { centerX: 1, centerY: 2, distance: 3, angle: 4 },
    touchNavigationActive: true,
  });
  return {
    shell,
    host,
    fontGeometry,
    effectCompiler,
    calls,
    attributes,
    canvasClasses,
    capturedPointers,
    completion,
    ...browserState,
    scheduled: {
      effectReadyIdleTimer,
      viewIdleTimer,
      exactRecoveryRequest,
      unsafeExactRefreshRequest,
      fastOverlayRequest,
      renderRequest,
    },
  };
}

const harness = createHarness();
const originalFontRegistry = harness.shell.fontGeometry;
const originalEffectCompiler = harness.shell.effectCompiler;
assert.equal(harness.shell.resetForDocument(), 6);
assert.equal(harness.shell.documentGeneration, 6);
assert.equal(harness.shell.fontGeometry, originalFontRegistry);
assert.equal(harness.shell.effectCompiler, originalEffectCompiler);
assert.equal(harness.shell.snapshot, null);
assert.deepEqual(harness.shell.metrics, {
  left: -1,
  top: -1,
  right: 1,
  bottom: 1,
  baseline: 0,
});
assert.equal(harness.shell.geometryByNodeId.size, 0);
assert.equal(harness.shell.svgStrokePathsBySemantic.size, 0);
assert.equal(harness.shell.svgStrokeFailedLodsBySemantic.size, 0);
assert.equal(harness.shell.svgStrokePathCacheLogicalBytes, 0);
assert.equal(harness.shell.svgStrokePathCacheAccessSequence, 0);
assert.equal(harness.shell.svgStrokePathFallbackCount, 0);
assert.ok(harness.shell.svgStrokeSemanticKeysByPaint instanceof WeakMap);
assert.ok(harness.shell.svgSilhouetteSemanticKeysByDocument instanceof WeakMap);
assert.ok(harness.shell.svgStrokeFailedLodsByPaint instanceof WeakMap);
assert.equal(harness.shell.displayedDrawsByNodeKey.size, 0);
assert.equal(harness.shell.displayedMetricsByNodeKey.size, 0);
assert.equal(harness.shell.renderedTextRunKeys.size, 0);
assert.deepEqual(harness.calls.retainedSlots, [[]]);
assert.deepEqual(harness.calls.pruneMeshes, [[]]);
assert.equal(harness.calls.clearPresentation, 1);
assert.equal(harness.calls.clearFallback, 1);
assert.equal(harness.calls.disableFast, 1);
assert.equal(harness.calls.endRotation, 1);
assert.deepEqual(harness.calls.releasedPointers.sort((a, b) => a - b), [11, 12, 13, 14]);
assert.equal(harness.capturedPointers.size, 0);
assert.equal(harness.calls.overlayClears, 1);
assert.deepEqual(harness.calls.guides.at(-1), []);
assert.equal(harness.shell.transformToolActive, true);
assert.equal(harness.shell.rasterTransformToolMode, "warp");
assert.equal(harness.shell.transformSessionOpen, false);
assert.equal(harness.shell.transformSessionKind, null);
assert.deepEqual(harness.shell.requestedGroupTransformKeys, []);
assert.equal(harness.shell.groupTransformSelection, null);
assert.equal(harness.shell.activeInteraction, null);
assert.equal(harness.shell.pendingRasterPointerId, null);
assert.equal(harness.shell.pendingRasterPointerGeneration, 5);
assert.equal(harness.shell.touchContacts.size, 0);
assert.equal(harness.shell.touchNavigationActive, false);
assert.equal(harness.shell.renderRequest, null);
assert.equal(harness.shell.effectReadyIdleTimer, null);
assert.equal(harness.shell.viewIdleTimer, null);
assert.equal(harness.shell.exactRecoveryRequest, null);
assert.equal(harness.shell.unsafeExactRefreshRequest, null);
assert.equal(harness.shell.fastOverlayRequest, null);
assert.equal(harness.shell.fallbackPresentationDirty, true);
assert.equal(harness.shell.fallbackPresentationGpuMemoryMiB, 0);
assert.equal(harness.shell.renderCount, 0);
assert.deepEqual(harness.shell.renderSamples, []);
assert.equal(harness.shell.liveGpuMemoryMiB, 0);
assert.equal(harness.shell.zoomRenderMode, "precise");
assert.equal(harness.shell.adaptiveZoomEnabled, true);
assert.equal(harness.shell.interactionCanvas.hidden, true);
assert.equal(harness.attributes.get("aria-hidden"), "true");
assert.equal(harness.canvasClasses.values.size, 0);
assert.equal(harness.shell.status.dataset.atomicEffectPendingNodes, "0");
assert.equal(harness.shell.status.dataset.atomicEffectHoldCount, "0");

const expectedAnimationCancellations = [
  harness.scheduled.exactRecoveryRequest,
  harness.scheduled.unsafeExactRefreshRequest,
  harness.scheduled.fastOverlayRequest,
  harness.scheduled.renderRequest,
].sort((a, b) => a - b);
assert.deepEqual(
  [...harness.cancelledAnimationFrames].sort((a, b) => a - b),
  expectedAnimationCancellations,
);
assert.deepEqual(
  [...harness.clearedTimers].sort((a, b) => a - b),
  [harness.scheduled.effectReadyIdleTimer, harness.scheduled.viewIdleTimer]
    .sort((a, b) => a - b),
);

// Reusing the exact key and id in the incoming document must start from an
// empty controller cache rather than retargeting an outgoing draw.
harness.shell.geometryByNodeId.set(7, { owner: "incoming" });
harness.shell.displayedDrawsByNodeKey.set("text:7", [{ owner: "incoming" }]);
assert.equal(harness.shell.geometryByNodeId.get(7).owner, "incoming");
assert.equal(harness.shell.displayedDrawsByNodeKey.get("text:7")[0].owner, "incoming");

for (const unsettled of [
  { sceneOperationBusy: true },
  { transformCommitBusy: true },
  { transformSessionOpen: true },
  { groupTransformPreparation: Promise.resolve() },
  { rasterTransformPreparation: Promise.resolve() },
]) {
  const blocked = createHarness();
  Object.assign(blocked.shell, unsettled);
  assert.throws(
    () => blocked.shell.resetForDocument(),
    /must be idle with no open transform/,
  );
  assert.equal(blocked.shell.documentGeneration, 5);
  assert.equal(blocked.calls.clearPresentation, 0);
  assert.equal(blocked.calls.retainedSlots.length, 0);
}

// Even if a cancelled callback is delivered, it cannot clear or execute the
// animation request scheduled by the incoming document.
let renderedDocuments = 0;
harness.shell.renderNow = () => {
  renderedDocuments += 1;
  return true;
};
harness.shell.scheduleRender();
const outgoingRenderRequest = harness.shell.renderRequest;
const outgoingRenderCallback = harness.animationCallbacks.get(outgoingRenderRequest);
assert.equal(typeof outgoingRenderCallback, "function");
assert.equal(harness.shell.resetForDocument(), 7);
harness.shell.scheduleRender();
const incomingRenderRequest = harness.shell.renderRequest;
assert.notEqual(incomingRenderRequest, outgoingRenderRequest);
outgoingRenderCallback();
assert.equal(harness.shell.renderRequest, incomingRenderRequest);
assert.equal(renderedDocuments, 0);
harness.animationCallbacks.get(incomingRenderRequest)();
assert.equal(renderedDocuments, 1);

// A presentation fence from the outgoing document must not mutate the target
// counters or release a target fence that happened to start in the meantime.
const staleFence = createHarness();
staleFence.shell.resetForDocument();
staleFence.shell.zoomRenderMode = "fast";
staleFence.shell.viewRevision = 4;
staleFence.shell.renderNow = () => true;
staleFence.shell.requestUnsafeExactRefresh(4);
const fenceRequest = staleFence.shell.unsafeExactRefreshRequest;
staleFence.animationCallbacks.get(fenceRequest)();
assert.equal(staleFence.shell.unsafeExactRefreshInFlight, true);
staleFence.shell.resetForDocument();
staleFence.shell.unsafeExactRefreshInFlight = true;
staleFence.completion.resolve();
await Promise.resolve();
await Promise.resolve();
assert.equal(staleFence.shell.zoomUnsafeExactRefreshCompletedCount, 0);
assert.equal(staleFence.shell.unsafeExactRefreshInFlight, true);

// Startup readiness must cross font preparation, two exact stable samples,
// the final compositor idle point, and the explicit vector presentation fence.
const fontReady = deferred();
const compositorReady = deferred();
const vectorFenceReady = deferred();
const readinessCheckpoints = [];
const readinessCalls = [];
const readinessShell = Object.create(MixedSceneController.prototype);
Object.assign(readinessShell, {
  browser: {
    performance,
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: (timer) => clearTimeout(timer),
  },
  host: {
    waitForIdle: async () => {
      readinessCalls.push("compositor-wait");
      await compositorReady.promise;
      readinessCalls.push("compositor-ready");
    },
    waitForVectorTextPresentationCompletion: async () => {
      readinessCalls.push("vector-fence-wait");
      await vectorFenceReady.promise;
      readinessCalls.push("vector-fence-ready");
    },
  },
  documentGeneration: 3,
  renderCount: 0,
  runtimeSceneSnapshot: () => ({
    selectedKey: "svg:1",
    activeRasterLayerId: 1,
    items: [{ key: "svg:1", kind: "svg", svgNode: { id: 1 } }],
  }),
  prepareFontGeometry: async () => {
    readinessCalls.push("font-wait");
    await fontReady.promise;
    readinessCalls.push("font-ready");
  },
  syncScene: () => readinessCalls.push("scene-sync"),
  scheduleRender: () => readinessCalls.push("render-request"),
  waitForPresentationCheckpoint: () => {
    const checkpoint = deferred();
    readinessCheckpoints.push(checkpoint);
    return checkpoint.promise;
  },
  getDiagnostics: () => ({
    renderCount: 1,
    zoomRenderMode: "precise",
    zoomFastPresentationMode: "precise",
    effectWorkerPendingJobs: 0,
    effectWorkerFailedJobs: 0,
    effectWorkerLastError: null,
    atomicEffectPendingNodes: 0,
    zoomUnsafeExactRefreshInFlight: false,
    zoomUnsafeExactRefreshRequestPending: false,
  }),
});
let readinessSettled = false;
const readiness = readinessShell.prepareCurrentScenePresentation().then((value) => {
  readinessSettled = true;
  return value;
});
await waitUntil(() => readinessCalls.includes("font-wait"));
assert.equal(readinessSettled, false);
assert.equal(readinessCheckpoints.length, 0, "render sampling cannot precede font readiness");
fontReady.resolve();
await waitUntil(() => readinessCheckpoints.length === 1);
assert.deepEqual(readinessCalls.slice(0, 4), [
  "font-wait",
  "font-ready",
  "scene-sync",
  "render-request",
]);
readinessCheckpoints[0].resolve();
await waitUntil(() => readinessCheckpoints.length === 2);
assert.equal(readinessCalls.includes("compositor-wait"), false, "one stable sample is insufficient");
readinessCheckpoints[1].resolve();
await waitUntil(() => readinessCalls.includes("compositor-wait"));
assert.equal(readinessSettled, false);
compositorReady.resolve();
await waitUntil(() => readinessCalls.includes("vector-fence-wait"));
assert.equal(readinessSettled, false);
vectorFenceReady.resolve();
const readinessDiagnostics = await readiness;
assert.equal(readinessSettled, true);
assert.equal(readinessDiagnostics.renderCount, 1);
assert.deepEqual(readinessCalls.slice(-4), [
  "compositor-wait",
  "compositor-ready",
  "vector-fence-wait",
  "vector-fence-ready",
]);

const changedDocumentShell = Object.create(MixedSceneController.prototype);
const changedDocumentFont = deferred();
Object.assign(changedDocumentShell, {
  browser: readinessShell.browser,
  host: readinessShell.host,
  documentGeneration: 8,
  renderCount: 0,
  runtimeSceneSnapshot: readinessShell.runtimeSceneSnapshot,
  prepareFontGeometry: () => changedDocumentFont.promise,
});
const changedDocumentReadiness = changedDocumentShell.prepareCurrentScenePresentation();
changedDocumentShell.documentGeneration = 9;
changedDocumentFont.resolve();
await assert.rejects(changedDocumentReadiness, /project changed/i);

console.log("Mixed-scene document reset verification passed.");
