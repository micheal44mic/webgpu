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
const failures = [];
const imported = [];
let currentController = null;
let ensureCount = 0;
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
  onFailure: (kind, error) => failures.push([kind, String(error)]),
});

// The native picker is opened synchronously even though controller readiness
// is still pending. The selected File is retained and imported afterwards.
bridge.request("import-svg");
assert.equal(svgInput.clickCount, 1);
assert.equal(ensureCount, 0);
svgInput.choose({ name: "cold-start.svg" });
assert.equal(svgInput.value, "");
assert.equal(ensureCount, 0, "acceptance work must leave the picker change stack first");
assert.deepEqual(queued, []);
await Promise.resolve();
assert.equal(ensureCount, 1);
assert.deepEqual(queued, [["svg", "cold-start.svg"]]);
assert.deepEqual(imported, []);
currentController = controller;
readiness.resolve(controller);
await importCompleted;
assert.deepEqual(imported, [["svg", "cold-start.svg"]]);
assert.deepEqual(failures, []);

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
imageInput.choose({ name: "ready.png" });
await imageCompleted;
assert.equal(ensureCount, 1);
assert.deepEqual(imported.at(-1), ["image", "ready.png"]);

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

console.log("Scene import bridge: immediate picker, queued cold start, failure, and disposal verified.");
