import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const vite = await createServer({
  root: fileURLToPath(new URL("../", import.meta.url)),
  configFile: false,
  logLevel: "silent",
  server: { middlewareMode: true },
  appType: "custom",
});
const {
  PROJECT_DOCUMENT_SCHEMA_VERSION,
  PROJECT_STORAGE_TILE_GRID_SIZE,
  ProjectStorage,
} = await vite.ssrLoadModule("/src/project-storage.ts");
const { ProjectSessionController } = await vite.ssrLoadModule(
  "/src/project-session-controller.ts",
);

const VERSION = PROJECT_DOCUMENT_SCHEMA_VERSION;
const WIDTH = 64;
const HEIGHT = 64;

function blankCapture(name) {
  return {
    snapshot: {
      schemaVersion: VERSION,
      document: {
        schemaVersion: VERSION,
        width: WIDTH,
        height: HEIGHT,
        layerFormat: "rgba16float",
        tileGridSize: PROJECT_STORAGE_TILE_GRID_SIZE,
        colorSpace: "linear-premultiplied",
      },
      layers: [{
        schemaVersion: VERSION,
        id: 1,
        name: "Layer 1",
        visible: true,
        opacity: 1,
        blendMode: "normal",
        clippingParentId: null,
        contentBounds: null,
        storageTileMask: new Uint32Array(8),
        hasContent: false,
        noiseMipSmoothing: false,
        strokeStyle: {
          enabled: false,
          width: 14,
          position: "outside",
          color: [1, 0.5, 0.25, 1],
        },
        bevelStyle: { enabled: false },
        outerShadowStyle: { enabled: false },
        innerShadowStyle: { enabled: false },
        colorOverlayStyle: { enabled: false, color: [0, 0, 0], opacity: 100 },
        pixels: null,
      }],
      activeRasterLayerId: 1,
      referenceRasterLayerId: null,
      mixedScene: {
        schemaVersion: VERSION,
        items: [{ key: "raster:1", kind: "raster", rasterLayerId: 1 }],
        textNodes: [],
        svgNodes: [],
        imageNodes: [],
        selectedKey: "raster:1",
        nextTextNodeId: 1,
        nextSvgNodeId: 1,
        nextImageNodeId: 1,
      },
      view: {
        schemaVersion: VERSION,
        centerX: WIDTH / 2,
        centerY: HEIGHT / 2,
        zoom: 1,
        rotationRadians: 0,
      },
      background: {
        schemaVersion: VERSION,
        visible: true,
        color: "#ffffff",
      },
      brushSettings: { color: "#111111", size: 12 },
    },
    chunks: [],
    name,
  };
}

class FakeClassList {
  values = new Set();

  toggle(name, force) {
    if (force) this.values.add(name);
    else this.values.delete(name);
  }
}

class FakeEventTarget {
  listeners = new Map();

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  listenerCount(type) {
    return this.listeners.get(type)?.size ?? 0;
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

class FakeButton extends FakeEventTarget {
  disabled = false;
  title = "";
  classList = new FakeClassList();
  attributes = new Map();

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
}

class FakeCanvas {
  width = 0;
  height = 0;

  getContext() {
    return {
      fillStyle: "",
      fillRect() {},
      drawImage() {},
      putImageData() {},
    };
  }

  toBlob(callback, type) {
    callback(new Blob([Uint8Array.of(1)], { type }));
  }
}

class FakeWindow extends FakeEventTarget {
  constructor(url) {
    super();
    this.location = {
      href: url,
      assign: (next) => {
        this.location.href = String(next);
      },
      replace: (next) => {
        this.location.href = String(next);
        this.locationReplacements.push(String(next));
      },
    };
    this.pushes = [];
    this.replacements = [];
    this.locationReplacements = [];
    this.history = {
      pushState: (_state, _title, next) => {
        this.location.href = String(next);
        this.pushes.push(String(next));
      },
      replaceState: (_state, _title, next) => {
        this.location.href = String(next);
        this.replacements.push(String(next));
      },
    };
  }

  confirm() {
    return false;
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, resolve, reject };
}

async function waitUntil(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for lifecycle checkpoint.");
}

if (typeof globalThis.ImageData === "undefined") {
  globalThis.ImageData = class ImageData {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.data = new Uint8ClampedArray(width * height * 4);
    }
  };
}

const backingStorage = new ProjectStorage({
  forceMemory: true,
  databaseName: `project-session-lifecycle-${Date.now()}`,
});
await backingStorage.initialize();
const projectA = blankCapture("Project A");
const projectB = blankCapture("Project B");
const summaryA = await backingStorage.saveProject({
  schemaVersion: VERSION,
  name: projectA.name,
  snapshot: projectA.snapshot,
  chunks: projectA.chunks,
  thumbnail: null,
});
const summaryB = await backingStorage.saveProject({
  schemaVersion: VERSION,
  name: projectB.name,
  snapshot: projectB.snapshot,
  chunks: projectB.chunks,
  thumbnail: null,
});

let saveCount = 0;
const storage = {
  backend: "indexeddb",
  initialize: () => backingStorage.initialize(),
  loadProject: (projectId) => backingStorage.loadProject(projectId),
  saveProject: async (request) => {
    saveCount += 1;
    return await backingStorage.saveProject(request);
  },
};
const browser = new FakeWindow(
  `https://example.test/?project=${summaryA.id}&documentWidth=${WIDTH}&documentHeight=${HEIGHT}`,
);
const document = {
  title: "",
  createElement: () => new FakeCanvas(),
};
const saveButton = new FakeButton();
const homeButton = new FakeButton();
const status = { textContent: "", className: "" };
const order = [];
const progressWarnings = [];
const reportedErrors = [];
const originalWarn = console.warn;
const originalError = console.error;
console.warn = (...values) => progressWarnings.push(values);
console.error = (...values) => reportedErrors.push(values);
let currentCapture = projectA;
let historyCursor = 0;
let firstFrame = deferred();
let failNextPreReset = false;
let dirtyNextPreReset = false;
let rewriteTargetNextPreReset = false;
let rewriteTargetAfterFirstFrame = false;
let activeSwitchTarget = null;
let failNextReturnHome = false;
let controller;

async function rewriteStoredHead(projectId) {
  const loaded = await backingStorage.loadProject(projectId);
  assert.ok(loaded, "head to rewrite exists");
  return await backingStorage.saveProject({
    schemaVersion: VERSION,
    projectId,
    name: loaded.summary.name,
    snapshot: structuredClone(loaded.manifest.snapshot),
    chunks: [],
  });
}

const engine = {
  captureDocument: async () => {
    order.push("capture");
    return structuredClone(currentCapture);
  },
  captureThumbnailPixels: async () => ({
    width: 1,
    height: 1,
    rgba: new Uint8ClampedArray([0, 0, 0, 255]),
  }),
  restoreDocument: async (project) => {
    order.push(`restore:${project.summary.id}`);
    currentCapture = {
      snapshot: structuredClone(project.manifest.snapshot),
      chunks: project.chunks.map((chunk) => ({
        schemaVersion: chunk.schemaVersion,
        layerId: chunk.layerId,
        chunkIndex: chunk.chunkIndex,
        storage: chunk.storage,
        rawBytes: chunk.rawBytes,
        storedBytes: chunk.storedBytes,
        sourceHash: chunk.sourceHash,
        bytes: chunk.bytes,
      })),
      name: project.summary.name,
    };
  },
  historyState: () => ({ cursor: historyCursor, actionCount: historyCursor }),
  sceneSnapshot: () => currentCapture.snapshot.mixedScene,
  setInitialLayerName: (name) => {
    currentCapture.snapshot.layers[0].name = name;
  },
  preflightDocumentSwitch: async (target) => {
    order.push(`preflight:${target.kind}`);
    activeSwitchTarget = target;
  },
  resetDocumentForSwitch: async (target) => {
    order.push(`reset:${target.kind}`);
    historyCursor = 0;
    currentCapture = blankCapture(target.name);
    controller.noteHistoryState({ cursor: 999, actionCount: 999 });
  },
  waitForDocumentFirstFrame: async () => {
    order.push("first-frame-wait");
    await firstFrame.promise;
    if (rewriteTargetAfterFirstFrame && activeSwitchTarget?.kind === "existing") {
      rewriteTargetAfterFirstFrame = false;
      await rewriteStoredHead(activeSwitchTarget.project.summary.id);
      order.push("target-head-rewritten-after-frame");
    }
    order.push("first-frame-ready");
  },
};

controller = new ProjectSessionController({
  engine,
  storage,
  browser,
  document,
  searchParams: new URL(browser.location.href).searchParams,
  documentWidth: WIDTH,
  documentHeight: HEIGHT,
  saveButton,
  homeButton,
  status,
  settleTransientEdits: async () => order.push("settle"),
  onReturnHome: async (pushHistory) => {
    order.push(`home:${pushHistory}`);
    if (failNextReturnHome) {
      failNextReturnHome = false;
      throw new Error("synthetic Home failure");
    }
  },
  onDocumentSwitchStart: async () => order.push("start"),
  onDocumentSwitchStage: async (stage) => {
    order.push(`stage:${stage}`);
    if (stage === "commit-target") throw new Error("synthetic progress failure");
  },
  onDocumentSwitchPreReset: async (target) => {
    order.push(`pre-reset:${target.kind}`);
    if (failNextPreReset) {
      failNextPreReset = false;
      throw new Error("synthetic pre-reset failure");
    }
    if (dirtyNextPreReset) {
      dirtyNextPreReset = false;
      controller.markDirty();
    }
    if (rewriteTargetNextPreReset && target.kind === "existing") {
      rewriteTargetNextPreReset = false;
      await rewriteStoredHead(target.project.summary.id);
      order.push("target-head-rewritten-before-reset");
    }
  },
  onDocumentSwitchCommit: async () => order.push("commit"),
  onDocumentSwitchFinish: async (result) => order.push(`finish:${result.status}`),
});
await controller.initialize();
order.length = 0;

assert.equal(browser.__projectEditorSessionLifecycle, controller, "stable shell endpoint");
assert.equal(saveButton.listenerCount("click"), 1, "one save listener");
assert.equal(homeButton.listenerCount("click"), 1, "one Home listener");
assert.equal(browser.listenerCount("keydown"), 1, "one shortcut listener");
assert.equal(browser.listenerCount("beforeunload"), 1, "one unload listener");

const renamedA = await backingStorage.renameProject(summaryA.id, "Project A Renamed");
assert.equal(
  controller.refreshCurrentProjectSummary(renamedA),
  true,
  "same durable head can refresh the current project title",
);
assert.match(document.title, /^Project A Renamed/);
const refreshedTitle = document.title;
assert.equal(
  controller.refreshCurrentProjectSummary({
    ...renamedA,
    headGenerationId: `${renamedA.headGenerationId}-changed`,
  }),
  false,
  "a different durable head cannot refresh current identity",
);
assert.equal(document.title, refreshedTitle, "rejected summary leaves identity unchanged");

order.length = 0;
failNextReturnHome = true;
homeButton.dispatch("click");
await waitUntil(() => status.textContent.includes("Could not return to projects"));
assert.ok(order.includes("home:true"), "Home button requests a pushed Home route");
assert.equal(reportedErrors.length, 1, "Home click rejection is caught and reported");
order.length = 0;
await controller.returnHome("none");
assert.ok(order.includes("home:false"), "popstate Home settlement does not push history");

browser.location.href = "https://example.test/?home=1";
order.length = 0;

controller.markDirty();
const switchToB = controller.switchProject({
  kind: "existing",
  projectId: summaryB.id,
  preloadedProject: backingStorage.loadProject(summaryB.id),
});
const sameTargetSwitch = controller.switchProject({
  kind: "existing",
  projectId: summaryB.id,
  preloadedProject: backingStorage.loadProject(summaryB.id),
});
assert.equal(switchToB, sameTargetSwitch, "duplicate target requests share one flight");
const differentTargetSwitch = controller.switchProject({
  kind: "new",
  name: "Ignored concurrent request",
  documentWidth: WIDTH,
  documentHeight: HEIGHT,
});
assert.notEqual(
  switchToB,
  differentTargetSwitch,
  "a different target never receives the active target's promise",
);
const differentTargetResult = await differentTargetSwitch;
assert.equal(differentTargetResult.status, "failed");
assert.equal(differentTargetResult.stage, "availability");
assert.equal(differentTargetResult.destructive, false);
assert.equal(differentTargetResult.fallback.action, "none");
await waitUntil(() => order.includes("first-frame-wait"));
assert.equal(
  new URL(browser.location.href).searchParams.get("project"),
  null,
  "the internal source save does not replace the Home route",
);
assert.equal(
  new URL(browser.location.href).searchParams.get("home"),
  "1",
  "the Home route remains stable before target publication",
);
assert.equal(saveCount, 1, "dirty A is durably saved before reset");
assert.ok(order.indexOf("settle") < order.indexOf("capture"), "edits settle before source capture");
assert.ok(order.indexOf("capture") < order.indexOf("pre-reset:existing"), "A saves before pre-reset");
assert.ok(
  order.indexOf("preflight:existing") < order.indexOf("pre-reset:existing")
    && order.indexOf("pre-reset:existing") < order.indexOf("reset:existing"),
  "composition invalidation runs after preflight and before reset",
);
firstFrame.resolve();
const resultB = await switchToB;
assert.equal(resultB.status, "committed");
assert.equal(resultB.targetProjectId, summaryB.id);
assert.equal(resultB.targetKind, "existing");
assert.equal(resultB.fallback.action, "none");
assert.equal(
  new URL(browser.location.href).searchParams.get("project"),
  summaryB.id,
  "identity publishes B after first frame",
);
assert.equal(browser.pushes.length, 1, "successful switch creates one history entry");
assert.ok(order.includes("finish:committed"), "composition lock is released");
assert.ok(order.includes("stage:publish-target"), "all terminal progress is observable");
assert.equal(progressWarnings.length, 1, "progress callback failures are best-effort");

order.length = 0;
firstFrame = deferred();
const newSwitch = controller.switchProject({
  kind: "new",
  name: "Fresh Canvas",
  documentWidth: WIDTH,
  documentHeight: HEIGHT,
});
await waitUntil(() => order.includes("first-frame-wait"));
assert.equal(
  new URL(browser.location.href).searchParams.get("project"),
  summaryB.id,
  "new project stays unpublished before its first frame",
);
firstFrame.resolve();
const newResult = await newSwitch;
assert.equal(newResult.status, "committed");
assert.equal(newResult.targetKind, "new");
assert.notEqual(newResult.targetProjectId, summaryB.id);
assert.equal(saveCount, 2, "new target receives a verified durable head");
assert.equal((await backingStorage.loadProject(newResult.targetProjectId)).summary.name, "Fresh Canvas");

const incompatible = await controller.switchProject({
  kind: "new",
  name: "Different size",
  documentWidth: WIDTH * 2,
  documentHeight: HEIGHT,
});
assert.equal(incompatible.status, "failed");
assert.equal(incompatible.stage, "preload-target");
assert.equal(incompatible.destructive, false);
assert.equal(incompatible.fallback.action, "stay-current");

order.length = 0;
failNextPreReset = true;
const failedPreReset = await controller.switchProject({
  kind: "existing",
  projectId: summaryA.id,
  preloadedProject: backingStorage.loadProject(summaryA.id),
});
assert.equal(failedPreReset.status, "failed");
assert.equal(failedPreReset.stage, "preflight-engine");
assert.equal(failedPreReset.destructive, false);
assert.equal(failedPreReset.fallback.action, "stay-current");
assert.ok(order.includes("pre-reset:existing"), "pre-reset callback was reached");
assert.equal(order.includes("reset:existing"), false, "failed pre-reset never mutates the engine");
assert.equal(
  new URL(browser.location.href).searchParams.get("project"),
  newResult.targetProjectId,
  "failed pre-reset leaves the current project identity intact",
);

order.length = 0;
dirtyNextPreReset = true;
const dirtyDuringPreReset = await controller.switchProject({
  kind: "existing",
  projectId: summaryA.id,
  preloadedProject: backingStorage.loadProject(summaryA.id),
});
assert.equal(dirtyDuringPreReset.status, "failed");
assert.equal(dirtyDuringPreReset.stage, "preflight-engine");
assert.equal(dirtyDuringPreReset.destructive, false);
assert.equal(dirtyDuringPreReset.fallback.action, "stay-current");
assert.ok(order.includes("pre-reset:existing"), "dirty pre-reset callback was reached");
assert.equal(
  order.includes("reset:existing"),
  false,
  "a source mutation during pre-reset cannot cross the destructive boundary",
);

order.length = 0;
rewriteTargetNextPreReset = true;
const changedBeforeReset = await controller.switchProject({
  kind: "existing",
  projectId: summaryA.id,
  preloadedProject: backingStorage.loadProject(summaryA.id),
});
assert.equal(changedBeforeReset.status, "failed");
assert.equal(changedBeforeReset.stage, "preflight-engine");
assert.equal(changedBeforeReset.destructive, false);
assert.equal(changedBeforeReset.fallback.action, "stay-current");
assert.ok(
  order.includes("target-head-rewritten-before-reset"),
  "test changed the target head at the final pre-reset boundary",
);
assert.equal(
  order.includes("reset:existing"),
  false,
  "a changed target head cannot cross the destructive boundary",
);

order.length = 0;
firstFrame = deferred();
rewriteTargetAfterFirstFrame = true;
const changedAfterFrame = controller.switchProject({
  kind: "existing",
  projectId: summaryA.id,
  preloadedProject: backingStorage.loadProject(summaryA.id),
});
await waitUntil(() => order.includes("first-frame-wait"));
firstFrame.resolve();
const changedAfterFrameResult = await changedAfterFrame;
assert.equal(changedAfterFrameResult.status, "failed");
assert.equal(changedAfterFrameResult.stage, "publish-target");
assert.equal(changedAfterFrameResult.destructive, true);
assert.equal(changedAfterFrameResult.fallback.action, "reload-source");
assert.equal(changedAfterFrameResult.fallback.projectId, newResult.targetProjectId);
assert.equal(
  new URL(changedAfterFrameResult.fallback.url).searchParams.get("project"),
  newResult.targetProjectId,
  "fallback points to the verified source head",
);
assert.equal(
  new URL(changedAfterFrameResult.fallback.url).searchParams.get("projectSwitch"),
  "reload",
  "destructive fallback explicitly disables in-place switching for recovery",
);
assert.equal(
  new URL(changedAfterFrameResult.fallback.url).searchParams.has("home"),
  false,
  "recovery fallback cannot reopen the Home surface",
);
assert.equal(saveButton.disabled, true, "editing remains locked after destructive failure");

controller.dispose();
controller.dispose();
assert.equal(browser.__projectEditorSessionLifecycle, undefined, "disposed shell endpoint removed");
assert.equal(saveButton.listenerCount("click"), 0, "save listener removed");
assert.equal(homeButton.listenerCount("click"), 0, "Home listener removed");
assert.equal(browser.listenerCount("keydown"), 0, "shortcut listener removed");
assert.equal(browser.listenerCount("beforeunload"), 0, "unload listener removed");

backingStorage.close();
await vite.close();
console.warn = originalWarn;
console.error = originalError;
console.info("Project session lifecycle verification passed.");
