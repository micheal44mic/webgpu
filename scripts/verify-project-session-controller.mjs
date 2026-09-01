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
const { ProjectSessionController } = await vite.ssrLoadModule(
  "/src/project-session-controller.ts",
);

class FakeClassList {
  values = new Set();

  toggle(name, force) {
    if (force) this.values.add(name);
    else this.values.delete(name);
  }

  contains(name) {
    return this.values.has(name);
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
      },
    };
    this.history = {
      pushState: (_state, _title, next) => {
        this.location.href = String(next);
      },
      replaceState: (_state, _title, next) => {
        this.location.href = String(next);
      },
    };
  }

  confirm() {
    return false;
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((resolveValue) => {
    resolve = resolveValue;
  });
  return { promise, resolve };
}

async function waitUntil(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for the project-session checkpoint.");
}

const WIDTH = 64;
const HEIGHT = 64;
const initialSummary = {
  schemaVersion: 1,
  id: "project-a",
  name: "Project A",
  createdAt: 1,
  updatedAt: 1,
  headGenerationId: "generation-1",
  documentWidth: WIDTH,
  documentHeight: HEIGHT,
  layerCount: 1,
  storedBytes: 0,
  thumbnail: null,
};
const loadedProject = {
  summary: initialSummary,
  manifest: { snapshot: {} },
  chunks: [],
};

let generation = 1;
let captureCount = 0;
let captureGate = null;
const opaqueSceneSnapshot = {};
opaqueSceneSnapshot.self = opaqueSceneSnapshot;
const capturedDocument = { snapshot: {}, chunks: [] };

const engine = {
  captureDocument: async () => {
    captureCount += 1;
    if (captureGate) return await captureGate.promise;
    return capturedDocument;
  },
  captureThumbnailPixels: async () => ({
    width: 1,
    height: 1,
    rgba: new Uint8ClampedArray([0, 0, 0, 255]),
  }),
  restoreDocument: async () => {},
  historyState: () => ({ cursor: 0, actionCount: 0 }),
  sceneSnapshot: () => opaqueSceneSnapshot,
  setInitialLayerName: () => {},
};

const storage = {
  initialize: async () => {},
  loadProject: async (projectId) => projectId === initialSummary.id ? loadedProject : null,
  saveProject: async () => {
    generation += 1;
    return {
      ...initialSummary,
      updatedAt: generation,
      headGenerationId: `generation-${generation}`,
    };
  },
};

const browser = new FakeWindow(
  `https://example.test/?project=${initialSummary.id}&documentWidth=${WIDTH}&documentHeight=${HEIGHT}`,
);
const saveButton = new FakeButton();
const homeButton = new FakeButton();
const status = { textContent: "", className: "" };
const controller = new ProjectSessionController({
  engine,
  storage,
  browser,
  document: { title: "" },
  searchParams: new URL(browser.location.href).searchParams,
  documentWidth: WIDTH,
  documentHeight: HEIGHT,
  saveButton,
  homeButton,
  status,
});

await controller.initialize();
assert.equal(
  saveButton.classList.contains("is-dirty"),
  false,
  "the initialization scene notification establishes a clean baseline",
);

assert.doesNotThrow(
  () => controller.noteSceneSnapshot(opaqueSceneSnapshot),
  "scene notifications do not serialize the supplied snapshot",
);
assert.equal(
  saveButton.classList.contains("is-dirty"),
  true,
  "the first post-initialization scene notification marks the project dirty",
);

await controller.save({ captureThumbnail: false });
assert.equal(
  saveButton.classList.contains("is-dirty"),
  false,
  "a successful save acknowledges scene notifications captured by that save",
);

controller.noteSceneSnapshot(opaqueSceneSnapshot);
assert.equal(
  saveButton.classList.contains("is-dirty"),
  true,
  "an identical payload still represents a new semantic scene notification",
);
await controller.save({ captureThumbnail: false });
assert.equal(saveButton.classList.contains("is-dirty"), false);

controller.trackingSuspended = true;
controller.noteSceneSnapshot(opaqueSceneSnapshot);
controller.trackingSuspended = false;
assert.equal(
  saveButton.classList.contains("is-dirty"),
  false,
  "scene notifications emitted while tracking is suspended are ignored",
);

captureGate = deferred();
const capturesBeforeConcurrentSave = captureCount;
const concurrentSave = controller.save({ captureThumbnail: false });
await waitUntil(() => captureCount > capturesBeforeConcurrentSave);
controller.noteSceneSnapshot(opaqueSceneSnapshot);
captureGate.resolve(capturedDocument);
await concurrentSave;
captureGate = null;
assert.equal(
  saveButton.classList.contains("is-dirty"),
  true,
  "a scene notification that lands during save remains unsaved",
);

await controller.save({ captureThumbnail: false });
assert.equal(
  saveButton.classList.contains("is-dirty"),
  false,
  "a later successful save resets the notification baseline",
);

controller.dispose();

const restoreGate = deferred();
const preparationGate = deferred();
const presentationGate = deferred();
const readinessOrder = [];
const readinessBrowser = new FakeWindow(
  `https://example.test/?project=${initialSummary.id}&documentWidth=${WIDTH}&documentHeight=${HEIGHT}`,
);
const readinessSaveButton = new FakeButton();
const readinessHomeButton = new FakeButton();
const readinessStatus = { textContent: "", className: "" };
const readinessController = new ProjectSessionController({
  engine: {
    ...engine,
    restoreDocument: async () => {
      readinessOrder.push("restore-start");
      await restoreGate.promise;
      readinessOrder.push("restore-ready");
    },
    waitForDocumentFirstFrame: async () => {
      readinessOrder.push("presentation-start");
      await presentationGate.promise;
      readinessOrder.push("presentation-ready");
    },
  },
  storage,
  browser: readinessBrowser,
  document: { title: "" },
  searchParams: new URL(readinessBrowser.location.href).searchParams,
  documentWidth: WIDTH,
  documentHeight: HEIGHT,
  saveButton: readinessSaveButton,
  homeButton: readinessHomeButton,
  status: readinessStatus,
  preloadedProjectId: initialSummary.id,
  preloadedProject: Promise.resolve(loadedProject),
  prepareProjectPresentation: async () => {
    readinessOrder.push("preparation-start");
    await preparationGate.promise;
    readinessOrder.push("preparation-ready");
  },
});
const readinessInitialization = readinessController.initialize();
await waitUntil(() => readinessOrder.includes("preparation-start"));
assert.equal(readinessController.editorReady, false, "editor stays unavailable during restore");
assert.equal(readinessHomeButton.disabled, true, "Home stays disabled during restore");
assert.equal(readinessSaveButton.disabled, true, "Save stays disabled during restore");
assert.equal(readinessStatus.textContent, "Opening project…");

preparationGate.resolve();
await waitUntil(() => readinessOrder.includes("preparation-ready"));
assert.equal(
  readinessOrder.includes("presentation-start"),
  false,
  "the final presentation gate cannot run against the pre-restore scene",
);
restoreGate.resolve();
await waitUntil(() => readinessOrder.includes("presentation-start"));
assert.equal(readinessController.editorReady, false, "editor stays unavailable during GPU presentation");
assert.equal(readinessStatus.textContent, "Preparing project…");
presentationGate.resolve();
await readinessInitialization;
assert.equal(readinessController.editorReady, true, "editor unlocks after the restored presentation");
assert.equal(readinessHomeButton.disabled, false, "Home unlocks with the complete project");
assert.equal(readinessStatus.textContent, "Project ready.");
assert.match(readinessStatus.className, /\bok\b/);
assert.equal(readinessController.preloadedProject, null, "resolved preload payload is released");
assert.equal(readinessController.preloadedProjectId, null, "resolved preload identity is released");
readinessController.dispose();

const initialCommitGate = deferred();
let initialCommitCaptures = 0;
let initialCommitSaves = 0;
const newProjectBrowser = new FakeWindow(
  `https://example.test/?project=temporary&newProject=1&projectName=Fresh&documentWidth=${WIDTH}&documentHeight=${HEIGHT}`,
);
const newProjectSaveButton = new FakeButton();
const newProjectHomeButton = new FakeButton();
const newProjectController = new ProjectSessionController({
  engine: {
    ...engine,
    captureDocument: async () => {
      initialCommitCaptures += 1;
      await initialCommitGate.promise;
      return capturedDocument;
    },
  },
  storage: {
    ...storage,
    saveProject: async () => {
      initialCommitSaves += 1;
      return { ...initialSummary, name: "Fresh" };
    },
  },
  browser: newProjectBrowser,
  document: { title: "" },
  searchParams: new URL(newProjectBrowser.location.href).searchParams,
  documentWidth: WIDTH,
  documentHeight: HEIGHT,
  saveButton: newProjectSaveButton,
  homeButton: newProjectHomeButton,
  status: { textContent: "", className: "" },
});
const newProjectInitialization = newProjectController.initialize();
await waitUntil(() => initialCommitCaptures === 1);
assert.equal(newProjectController.editorReady, false, "new project stays locked during initial commit");
assert.equal(newProjectSaveButton.disabled, true);
assert.equal(newProjectHomeButton.disabled, true);
await assert.rejects(() => newProjectController.save(), /still starting/i);
assert.equal(initialCommitCaptures, 1, "public Save cannot duplicate the startup capture");
initialCommitGate.resolve();
await newProjectInitialization;
assert.equal(initialCommitSaves, 1, "startup performs one internal initial commit");
assert.equal(newProjectController.editorReady, true);
assert.equal(newProjectHomeButton.disabled, false);
assert.equal(
  new URL(newProjectBrowser.location.href).searchParams.get("project"),
  initialSummary.id,
  "the durable project id replaces the temporary route token",
);
newProjectController.dispose();

let ephemeralStorageInitializations = 0;
let ephemeralCaptures = 0;
const ephemeralBrowser = new FakeWindow(
  `https://example.test/?vectorStressTest=1&documentWidth=${WIDTH}&documentHeight=${HEIGHT}`,
);
const ephemeralSaveButton = new FakeButton();
const ephemeralHomeButton = new FakeButton();
const ephemeralDocument = { title: "" };
const ephemeralController = new ProjectSessionController({
  engine: {
    ...engine,
    captureDocument: async () => {
      ephemeralCaptures += 1;
      return capturedDocument;
    },
  },
  storage: {
    ...storage,
    initialize: async () => {
      ephemeralStorageInitializations += 1;
    },
  },
  browser: ephemeralBrowser,
  document: ephemeralDocument,
  searchParams: new URL(ephemeralBrowser.location.href).searchParams,
  documentWidth: WIDTH,
  documentHeight: HEIGHT,
  saveButton: ephemeralSaveButton,
  homeButton: ephemeralHomeButton,
  status: { textContent: "", className: "" },
  persistenceMode: "ephemeral",
});
await ephemeralController.initialize();
assert.equal(ephemeralStorageInitializations, 0, "ephemeral initialization never opens storage");
assert.equal(ephemeralSaveButton.disabled, true, "ephemeral save remains disabled");
assert.match(ephemeralDocument.title, /Vector Device Stress Test/);
ephemeralController.noteSceneSnapshot(opaqueSceneSnapshot);
assert.equal(
  ephemeralSaveButton.classList.contains("is-dirty"),
  false,
  "ephemeral scene changes never become persistable",
);
assert.equal(ephemeralBrowser.listeners.get("keydown")?.size ?? 0, 0);
assert.equal(ephemeralBrowser.listeners.get("beforeunload")?.size ?? 0, 0);
await assert.rejects(() => ephemeralController.save(), /temporary device test/i);
assert.equal(ephemeralCaptures, 0, "ephemeral save cannot capture the document");
ephemeralController.dispose();

await vite.close();
console.info("Project session controller verification passed.");
