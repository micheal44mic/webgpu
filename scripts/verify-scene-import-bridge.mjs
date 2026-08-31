import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SceneImportBridge } from "../src/scene-import-bridge.ts";

const editorLabsSource = readFileSync(
  new URL("../src/labs/editor-labs.ts", import.meta.url),
  "utf8",
);
const emptyImportGpuTestSource = readFileSync(
  new URL("../src/labs/gpu/empty-document-import-gpu-test.ts", import.meta.url),
  "utf8",
);
const mainSource = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const mixedSceneControllerSource = readFileSync(
  new URL("../src/mixed-scene-controller.ts", import.meta.url),
  "utf8",
);

assert.match(editorLabsSource, /\["empty-import-svg",/);
assert.match(editorLabsSource, /\["empty-import-image",/);
assert.match(editorLabsSource, /runEmptyDocumentImportGpuTest/);
assert.match(emptyImportGpuTestSource, /new DataTransfer\(\)/);
assert.match(emptyImportGpuTestSource, /input\.dispatchEvent\(new Event\("change"/);
assert.match(emptyImportGpuTestSource, /readPresentationPixelAtLayer/);
assert.match(emptyImportGpuTestSource, /await engine\.undo\(\)/);
assert.match(emptyImportGpuTestSource, /pushErrorScope\("validation"\)/);
assert.match(
  mainSource,
  /new SceneImportBridge\(\{[\s\S]{0,420}beforeAccept: async \(\) => \{[\s\S]{0,360}needsAdjustmentSettlementForToolChange[\s\S]{0,220}commitActiveAdjustmentForToolChange\(\)/,
  "the import bridge must settle a live adjustment only after the native picker returns",
);
assert.match(
  mainSource,
  /new SceneImportBridge\(\{[\s\S]*?runWithLoading: \(label, operation\) =>[\s\S]*?canvasStartupOverlay\.runRuntimeOperation\(label, operation\)/,
  "accepted scene imports must use the shared loading overlay",
);
assert.match(
  mixedSceneControllerSource,
  /private async importSvgSource[\s\S]{0,900}catch \(error\) \{[\s\S]{0,240}setSvgImportStatus[\s\S]{0,180}throw error;/,
  "SVG import failures must propagate to the bridge instead of reporting success",
);

class FakeFileInput extends EventTarget {
  files = null;
  value = "";
  clickCount = 0;

  click() {
    this.clickCount += 1;
  }

  choose(file) {
    this.files = [file];
    this.value = `C:\\fakepath\\${file.name}`;
    this.dispatchEvent(new Event("change"));
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

const svgInput = new FakeFileInput();
const imageInput = new FakeFileInput();
const readiness = deferred();
const queued = [];
const importing = [];
const completed = [];
const failures = [];
const imported = [];
const loadingEvents = [];
let currentController = null;
let ensureCount = 0;
let imagePrewarmCount = 0;
let completeImport;
const importCompleted = new Promise((resolve) => {
  completeImport = resolve;
});
const controller = {
  async importSvgFile(file) {
    imported.push(["svg", file.name]);
    completeImport();
  },
  async importRasterImageFile(file) {
    imported.push(["image", file.name]);
    completeImport();
  },
};
const bridge = new SceneImportBridge({
  svgInput,
  imageInput,
  currentController: () => currentController,
  ensureController: () => {
    ensureCount += 1;
    return readiness.promise;
  },
  onQueued: (kind, file) => queued.push([kind, file.name]),
  onImporting: (kind, file) => importing.push([kind, file.name]),
  onComplete: (kind, file) => completed.push([kind, file.name]),
  prewarmImageImport: async () => {
    imagePrewarmCount += 1;
  },
  onFailure: (kind, error) => failures.push([kind, String(error)]),
  runWithLoading: async (label, operation) => {
    loadingEvents.push(["start", label]);
    try {
      return await operation();
    } finally {
      loadingEvents.push(["finish", label]);
    }
  },
});

// The native picker is opened synchronously even though controller readiness
// is prepared immediately afterwards. The selected File reuses that Promise.
bridge.request("import-svg");
assert.equal(svgInput.clickCount, 1);
assert.equal(ensureCount, 1);
assert.equal(imagePrewarmCount, 0, "SVG must not compile native image programs");
svgInput.choose({ name: "cold-start.svg" });
assert.equal(svgInput.value, "");
assert.equal(ensureCount, 1, "the selected file must reuse picker-time preparation");
assert.deepEqual(queued, [["svg", "cold-start.svg"]]);
await Promise.resolve();
assert.equal(ensureCount, 1);
assert.deepEqual(imported, []);
currentController = controller;
readiness.resolve(controller);
await importCompleted;
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(imported, [["svg", "cold-start.svg"]]);
assert.deepEqual(importing, [["svg", "cold-start.svg"]]);
assert.deepEqual(completed, [["svg", "cold-start.svg"]]);
assert.deepEqual(failures, []);
assert.deepEqual(loadingEvents, [
  ["start", "Importing SVG"],
  ["finish", "Importing SVG"],
]);

// Once ready, image import stays synchronous at the picker boundary and does
// not repeat controller initialization.
let completeImage;
const imageCompleted = new Promise((resolve) => {
  completeImage = resolve;
});
controller.importRasterImageFile = async (file) => {
  imported.push(["image", file.name]);
  completeImage();
};
bridge.request("import-image");
assert.equal(imageInput.clickCount, 1);
assert.equal(imagePrewarmCount, 1, "image programs must warm while the picker is open");
imageInput.choose({ name: "ready.png" });
await imageCompleted;
await new Promise((resolve) => setImmediate(resolve));
assert.equal(ensureCount, 1);
assert.deepEqual(imported.at(-1), ["image", "ready.png"]);
assert.deepEqual(completed.at(-1), ["image", "ready.png"]);
assert.deepEqual(loadingEvents.slice(-2), [
  ["start", "Importing image"],
  ["finish", "Importing image"],
]);

// The picker still opens under the original click activation. Settlement only
// begins after a File is chosen, and the captured File survives the await.
const gatedInput = new FakeFileInput();
const gatedSettlement = deferred();
const gatedImports = [];
let beforeAcceptCount = 0;
let completeGatedImport;
const gatedImportCompleted = new Promise((resolve) => {
  completeGatedImport = resolve;
});
const gatedBridge = new SceneImportBridge({
  svgInput: new FakeFileInput(),
  imageInput: gatedInput,
  currentController: () => ({
    async importSvgFile() {},
    async importRasterImageFile(file) {
      gatedImports.push(file.name);
      completeGatedImport();
    },
  }),
  ensureController: async () => {
    throw new Error("A ready controller must not warm again.");
  },
  beforeAccept: () => {
    beforeAcceptCount += 1;
    return gatedSettlement.promise;
  },
});
gatedBridge.request("import-image");
assert.equal(gatedInput.clickCount, 1, "settlement must not delay the native picker");
assert.equal(beforeAcceptCount, 0, "settlement must wait until the picker returns a File");
gatedInput.choose({ name: "after-adjustment.png" });
assert.equal(gatedInput.value, "");
assert.equal(beforeAcceptCount, 1);
await Promise.resolve();
assert.deepEqual(gatedImports, [], "import must wait for the active adjustment");
gatedSettlement.resolve(true);
await gatedImportCompleted;
assert.deepEqual(gatedImports, ["after-adjustment.png"]);
gatedBridge.dispose();

const rejectedInput = new FakeFileInput();
let rejectedImportCalled = false;
let completeRejectedImport;
const rejectedImportObserved = new Promise((resolve) => {
  completeRejectedImport = resolve;
});
const rejectedBridge = new SceneImportBridge({
  svgInput: rejectedInput,
  imageInput: new FakeFileInput(),
  currentController: () => ({
    async importSvgFile() { rejectedImportCalled = true; },
    async importRasterImageFile() { rejectedImportCalled = true; },
  }),
  ensureController: async () => {
    throw new Error("Rejected settlement must not initialize imports.");
  },
  beforeAccept: async () => false,
  onFailure: (_kind, error) => {
    failures.push(["settlement", String(error)]);
    completeRejectedImport();
  },
});
rejectedBridge.request("import-svg");
assert.equal(rejectedInput.clickCount, 1);
rejectedInput.choose({ name: "rejected.svg" });
await rejectedImportObserved;
assert.equal(rejectedImportCalled, false);
assert.match(failures.at(-1)[1], /active raster adjustment could not finish before import/);
rejectedBridge.dispose();

bridge.dispose();
bridge.request("import-svg");
svgInput.choose({ name: "disposed.svg" });
await Promise.resolve();
assert.equal(svgInput.clickCount, 1);
assert.equal(imported.some((entry) => entry[1] === "disposed.svg"), false);

// Initialization failures are observable instead of becoming unhandled
// rejections or silent no-ops.
const failingInput = new FakeFileInput();
let observedFailure;
const failureObserved = new Promise((resolve) => {
  observedFailure = resolve;
});
const failingBridge = new SceneImportBridge({
  svgInput: failingInput,
  imageInput: new FakeFileInput(),
  currentController: () => null,
  ensureController: async () => {
    throw new Error("optional warm-up failed");
  },
  onFailure: (kind, error) => {
    failures.push([kind, String(error)]);
    observedFailure();
  },
});
failingBridge.request("import-svg");
failingInput.choose({ name: "failure.svg" });
await failureObserved;
assert.match(failures.at(-1)[1], /optional warm-up failed/);
failingBridge.dispose();

// A picker opened for document A cannot import a file after the composition
// root advances to document B, even if the native picker returns afterwards.
{
  const stalePickerInput = new FakeFileInput();
  const stalePickerImports = [];
  const stalePickerFailures = [];
  const stalePickerQueued = [];
  let stalePickerSettlementCount = 0;
  const stalePickerBridge = new SceneImportBridge({
    svgInput: stalePickerInput,
    imageInput: new FakeFileInput(),
    currentController: () => ({
      async importSvgFile(file) { stalePickerImports.push(file.name); },
      async importRasterImageFile(file) { stalePickerImports.push(file.name); },
    }),
    ensureController: async () => {
      throw new Error("A stale picker must not initialize the controller.");
    },
    beforeAccept: async () => {
      stalePickerSettlementCount += 1;
      return true;
    },
    onQueued: (_kind, file) => stalePickerQueued.push(file.name),
    onFailure: (_kind, error) => stalePickerFailures.push(String(error)),
  });
  stalePickerBridge.request("import-svg");
  assert.equal(stalePickerInput.clickCount, 1);
  assert.equal(await stalePickerBridge.resetForDocument(), 1);
  stalePickerInput.choose({ name: "document-a.svg" });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(stalePickerImports, []);
  assert.deepEqual(stalePickerFailures, []);
  assert.deepEqual(stalePickerQueued, []);
  assert.equal(stalePickerSettlementCount, 0);
  stalePickerBridge.dispose();
}

// Controller warm-up queued by document A may resolve during document B, but
// its retained File must never be sent to the replacement controller.
{
  const queuedInput = new FakeFileInput();
  const queuedReadiness = deferred();
  const queuedImports = [];
  let queuedEnsureCount = 0;
  const queuedBridge = new SceneImportBridge({
    svgInput: queuedInput,
    imageInput: new FakeFileInput(),
    currentController: () => null,
    ensureController: () => {
      queuedEnsureCount += 1;
      return queuedReadiness.promise;
    },
  });
  queuedBridge.request("import-svg");
  queuedInput.choose({ name: "queued-a.svg" });
  await Promise.resolve();
  assert.equal(queuedEnsureCount, 1);
  let queuedResetSettled = false;
  const queuedReset = queuedBridge.resetForDocument().then((generation) => {
    queuedResetSettled = true;
    return generation;
  });
  await Promise.resolve();
  assert.equal(
    queuedResetSettled,
    false,
    "document reset must include picker-time controller preparation once a file was selected",
  );
  queuedReadiness.resolve({
    async importSvgFile(file) { queuedImports.push(file.name); },
    async importRasterImageFile(file) { queuedImports.push(file.name); },
  });
  assert.equal(await queuedReset, 1);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(queuedImports, []);
  queuedBridge.dispose();
}

// Once an import has entered a document-owned controller it is allowed to
// settle on that document. resetForDocument waits for it, so callers cannot
// replace engine state while that asynchronous publication is still possible.
{
  const activeInput = new FakeFileInput();
  const activeImport = deferred();
  const activeStarted = deferred();
  const activeController = {
    async importSvgFile() {
      activeStarted.resolve();
      await activeImport.promise;
    },
    async importRasterImageFile() {},
  };
  const activeBridge = new SceneImportBridge({
    svgInput: activeInput,
    imageInput: new FakeFileInput(),
    currentController: () => activeController,
    ensureController: async () => activeController,
  });
  activeBridge.request("import-svg");
  activeInput.choose({ name: "active-a.svg" });
  await activeStarted.promise;
  assert.equal(activeBridge.isImportInFlight, true);
  let resetSettled = false;
  const reset = activeBridge.resetForDocument().then((generation) => {
    resetSettled = true;
    return generation;
  });
  await Promise.resolve();
  assert.equal(resetSettled, false, "document reset must wait for an active import");
  activeImport.resolve();
  assert.equal(await reset, 1);
  assert.equal(activeBridge.isImportInFlight, false);
  activeBridge.dispose();
}

console.log("Scene import bridge: picker activation, document generations, settlement, failure, and disposal verified.");
