import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "vite";

const root = new URL("../", import.meta.url);
const mainSource = readFileSync(new URL("src/main.ts", root), "utf8");
const controllerSource = readFileSync(
  new URL("src/canvas-input-controller.ts", root),
  "utf8",
);

assert.match(mainSource, /canvasInputController = new CanvasInputController\(\{/);
assert.match(mainSource, /canvasInputController\?\.dispose\(\);/);
assert.doesNotMatch(
  mainSource,
  /let activePointerId|let pointerMode|canvas\.addEventListener\("pointer(?:down|move|up)/,
  "main.ts must remain a composition root, not a second canvas-input owner",
);
assert.match(controllerSource, /export type CanvasInputEnginePort = Pick</);
assert.match(controllerSource, /private readonly runtime: CanvasInputRuntime/);
assert.match(controllerSource, /new browser\.AbortController\(\)/);
assert.match(mainSource, /mixedSceneController\?\.isBusy === true/);
assert.match(mainSource, /isPaintReadinessPending: \(\) => engine\.isPaintReadinessPending\(\)/);
assert.doesNotMatch(controllerSource, /document\.getElementById|element<|mobileBrush/);

const moduleServer = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: process.cwd(),
  server: { middlewareMode: true },
});
let CanvasInputController;
try {
  ({ CanvasInputController } = await moduleServer.ssrLoadModule(
    "/src/canvas-input-controller.ts",
  ));
} finally {
  await moduleServer.close();
}

class FakeClassList {
  values = new Set();

  add(...names) {
    for (const name of names) this.values.add(name);
  }

  remove(...names) {
    for (const name of names) this.values.delete(name);
  }

  contains(name) {
    return this.values.has(name);
  }
}

class FakeElement extends EventTarget {
  classList = new FakeClassList();
  hidden = false;
  textContent = "";
  className = "";

  closest() {
    return null;
  }
}

class FakeCanvas extends FakeElement {
  width = 1000;
  height = 800;
  captures = new Set();

  getBoundingClientRect() {
    return {
      left: 0,
      top: 0,
      right: 500,
      bottom: 400,
      width: 500,
      height: 400,
    };
  }

  setPointerCapture(pointerId) {
    this.captures.add(pointerId);
  }

  releasePointerCapture(pointerId) {
    this.captures.delete(pointerId);
  }

  hasPointerCapture(pointerId) {
    return this.captures.has(pointerId);
  }
}

class FakeSelectionContext {
  clearCount = 0;
  lineCap = "butt";
  lineJoin = "miter";
  lineWidth = 1;
  strokeStyle = "";
  lineDashOffset = 0;

  clearRect() { this.clearCount += 1; }
  save() {}
  restore() {}
  beginPath() {}
  moveTo() {}
  lineTo() {}
  setLineDash() {}
  stroke() {}
  arc() {}
}

class FakeResizeObserver {
  static instances = [];
  disconnected = false;
  observed = null;

  constructor(callback) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }

  observe(element) {
    this.observed = element;
  }

  disconnect() {
    this.disconnected = true;
  }

  trigger() {
    this.callback([]);
  }
}

class FakeBrowser extends EventTarget {
  AbortController = globalThis.AbortController;
  Element = FakeElement;
  ResizeObserver = FakeResizeObserver;
  now = 100;
  nextTimerId = 1;
  timers = new Map();
  performance = { now: () => this.now };

  requestAnimationFrame(callback) {
    callback(this.now);
    return 1;
  }

  setTimeout(callback) {
    const id = this.nextTimerId;
    this.nextTimerId += 1;
    this.timers.set(id, callback);
    return id;
  }

  clearTimeout(id) {
    this.timers.delete(id);
  }

  runTimers() {
    const pending = [...this.timers.values()];
    this.timers.clear();
    for (const callback of pending) callback();
  }
}

function makeEvent(type, overrides = {}) {
  const defaults = {
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    clientX: 10,
    clientY: 20,
    pressure: 0,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    isComposing: false,
    key: "",
    code: "",
    deltaY: 0,
    timeStamp: 10,
  };
  const event = new Event(type, { cancelable: true });
  for (const [name, value] of Object.entries({ ...defaults, ...overrides })) {
    Object.defineProperty(event, name, { configurable: true, value });
  }
  return event;
}

const historyState = () => ({
  canUndo: true,
  canRedo: false,
  busy: false,
  inconsistent: false,
  actionCount: 1,
  cursor: 1,
  storedBaseStamps: 0,
  logicalStampBytes: 0,
  undoBlockedReason: null,
  redoBlockedReason: "none",
  openEdit: null,
});

function createHarness({ holdEnabled = true } = {}) {
  FakeResizeObserver.instances.length = 0;
  const browser = new FakeBrowser();
  const canvas = new FakeCanvas();
  const selectionGestureCanvas = new FakeCanvas();
  selectionGestureCanvas.width = 0;
  selectionGestureCanvas.height = 0;
  selectionGestureCanvas.hidden = true;
  const selectionGestureContext = new FakeSelectionContext();
  const status = new FakeElement();
  const calls = {
    beginStroke: [],
    extendStroke: [],
    endStroke: [],
    cancelStroke: 0,
    beginLiquify: [],
    extendLiquify: [],
    endLiquify: [],
    beginView: 0,
    endView: 0,
    pan: [],
    rotate: [],
    zoom: [],
    fill: [],
    magic: [],
    lasso: [],
    resize: 0,
    vectorBegin: 0,
    vectorEnd: 0,
    historyPublished: 0,
    historyControls: 0,
    layersRefresh: 0,
    thumbnails: 0,
    recordingBegin: 0,
    recordingCapture: 0,
    recordingFinish: [],
    recordingCancel: 0,
  };
  let activeTool = "paint";
  let selectionMethod = "magic-wand";
  let operationIsLocked = false;
  let paintReadinessPending = false;
  let viewIsLocked = false;
  let liquifyEditActive = false;
  let destructivePreviewNavigationActive = false;
  let beginStrokeAllowed = true;
  let cancelStrokeBeforeRender = false;
  let extension = null;
  const selectionPromises = [];
  const engine = {
    beginStroke(sample) {
      calls.beginStroke.push(sample);
      return beginStrokeAllowed;
    },
    extendStroke(samples) { calls.extendStroke.push(samples); },
    endStroke(timeMs) { calls.endStroke.push(timeMs); },
    cancelStrokeBeforeRender() {
      calls.cancelStroke += 1;
      return cancelStrokeBeforeRender;
    },
    beginRasterLiquifyStroke(point) {
      calls.beginLiquify.push(point);
      return true;
    },
    extendRasterLiquifyStroke(points) { calls.extendLiquify.push(points); },
    endRasterLiquifyStroke(committed) { calls.endLiquify.push(committed); },
    beginViewRotationGesture() { calls.beginView += 1; },
    endViewRotationGesture() { calls.endView += 1; },
    panByClientDelta(...args) { calls.pan.push(args); },
    rotateViewBy(...args) { calls.rotate.push(args); },
    zoomBy(...args) { calls.zoom.push(args); },
    fillAtClientPoint(...args) {
      calls.fill.push(args);
      return Promise.resolve(true);
    },
    selectConnectedAtClientPoint(...args) {
      calls.magic.push(args);
      return Promise.resolve(true);
    },
    selectPixelsByClientLasso(...args) {
      calls.lasso.push(args);
      return Promise.resolve(true);
    },
    toLayerPoint(sample) {
      return { x: sample.clientX, y: sample.clientY, pressure: sample.pressure };
    },
    getHistoryState: historyState,
    resizeCanvas() { calls.resize += 1; },
  };
  const vector = {
    beginViewGesture() { calls.vectorBegin += 1; },
    endViewGesture() { calls.vectorEnd += 1; },
  };
  const controller = new CanvasInputController({
    engine,
    browser,
    elements: { canvas, selectionGestureCanvas, selectionGestureContext, status },
    touchPaintIntentHoldEnabled: holdEnabled,
    getActiveTool: () => activeTool,
    getSelectionMethod: () => selectionMethod,
    getFillSettings: () => ({ tolerance: 17, color: "#123456" }),
    getSelectionSettings: () => ({ tolerance: 23, combineMode: "add" }),
    getHistoryState: historyState,
    onHistoryState: () => { calls.historyPublished += 1; },
    operationLocked: () => operationIsLocked,
    viewOperationLocked: () => viewIsLocked,
    isPaintReadinessPending: () => paintReadinessPending,
    isLiquifyEditActive: () => liquifyEditActive,
    isDestructivePreviewNavigationActive: () => destructivePreviewNavigationActive,
    getVectorController: () => vector,
    getEditorExtension: () => extension,
    updateHistoryControls: () => { calls.historyControls += 1; },
    runPixelSelectionOperation(operation) {
      selectionPromises.push(operation());
    },
    scheduleLayersRefresh: () => { calls.layersRefresh += 1; },
    invalidateActiveThumbnail: () => { calls.thumbnails += 1; },
  });
  return {
    browser,
    calls,
    canvas,
    controller,
    selectionGestureCanvas,
    selectionPromises,
    setActiveTool(value) { activeTool = value; },
    setSelectionMethod(value) { selectionMethod = value; },
    setOperationLocked(value) { operationIsLocked = value; },
    setPaintReadinessPending(value) { paintReadinessPending = value; },
    setViewLocked(value) { viewIsLocked = value; },
    setLiquifyEditActive(value) { liquifyEditActive = value; },
    setDestructivePreviewNavigationActive(value) {
      destructivePreviewNavigationActive = value;
    },
    setBeginStrokeAllowed(value) { beginStrokeAllowed = value; },
    setCancelStrokeBeforeRender(value) { cancelStrokeBeforeRender = value; },
    enableRecording() {
      extension = {
        wantsPaintRecording: () => true,
        beginPaintRecording: () => { calls.recordingBegin += 1; },
        capturePaintRecording: () => { calls.recordingCapture += 1; },
        finishPaintRecording: (committed) => calls.recordingFinish.push(committed),
        cancelPaintRecording: () => { calls.recordingCancel += 1; },
      };
    },
  };
}

// Mouse paint acknowledges begin before pointer capture, preserves coalesced
// sample order, and ends one gesture once.
{
  const harness = createHarness();
  harness.enableRecording();
  const down = makeEvent("pointerdown", { clientX: 5, clientY: 7, timeStamp: 11 });
  harness.canvas.dispatchEvent(down);
  assert.equal(down.defaultPrevented, true);
  assert.equal(harness.controller.isPointerActive, true);
  assert.equal(harness.controller.pointerMode, "paint");
  assert.deepEqual(harness.calls.beginStroke, [{
    clientX: 5,
    clientY: 7,
    pressure: 1,
    timeMs: 11,
  }]);
  assert.equal(harness.calls.recordingBegin, 1);

  const samples = [
    { clientX: 8, clientY: 10, pressure: 0, pointerType: "mouse", timeStamp: 12 },
    { clientX: 9, clientY: 11, pressure: 0, pointerType: "mouse", timeStamp: 13 },
  ];
  harness.canvas.dispatchEvent(makeEvent("pointermove", {
    getCoalescedEvents: () => samples,
  }));
  assert.deepEqual(
    harness.calls.extendStroke[0].map(({ clientX, clientY, timeMs }) => ({
      clientX,
      clientY,
      timeMs,
    })),
    [
      { clientX: 8, clientY: 10, timeMs: 12 },
      { clientX: 9, clientY: 11, timeMs: 13 },
    ],
  );
  assert.equal(harness.calls.recordingCapture, 1);

  harness.canvas.dispatchEvent(makeEvent("pointerup", { timeStamp: 14 }));
  assert.deepEqual(harness.calls.endStroke, [14]);
  assert.deepEqual(harness.calls.recordingFinish, [true]);
  assert.equal(harness.calls.layersRefresh, 1);
  assert.equal(harness.calls.thumbnails, 1);
  assert.equal(harness.controller.isPointerActive, false);
  harness.controller.dispose();
}

// A rejected begin never claims the pointer and Transform never routes to Paint.
{
  const harness = createHarness();
  harness.setBeginStrokeAllowed(false);
  harness.canvas.dispatchEvent(makeEvent("pointerdown"));
  assert.equal(harness.controller.isPointerActive, false);
  assert.equal(harness.canvas.captures.size, 0);
  harness.setBeginStrokeAllowed(true);
  harness.setActiveTool("transform");
  harness.canvas.dispatchEvent(makeEvent("pointerdown", { pointerId: 2 }));
  assert.equal(harness.controller.pointerMode, "transform");
  assert.equal(harness.calls.beginStroke.length, 1);
  harness.canvas.dispatchEvent(makeEvent("pointerup", { pointerId: 2 }));
  assert.equal(harness.calls.endStroke.length, 0);
  harness.controller.dispose();
}

// A Pencil contact landing during a short layer/import barrier is retained.
// Its coalesced samples start exactly once when readiness and the UI lock clear.
{
  const harness = createHarness();
  harness.enableRecording();
  harness.setPaintReadinessPending(true);
  harness.setOperationLocked(true);
  harness.setBeginStrokeAllowed(false);
  const down = makeEvent("pointerdown", {
    pointerId: 31,
    pointerType: "pen",
    clientX: 40,
    clientY: 50,
    pressure: 0.7,
    timeStamp: 30,
  });
  harness.canvas.dispatchEvent(down);
  assert.equal(down.defaultPrevented, true);
  assert.equal(harness.controller.isPointerActive, true);
  assert.equal(harness.calls.beginStroke.length, 1,
    "il primo tentativo rileva la barriera senza aprire uno stroke engine");
  harness.canvas.dispatchEvent(makeEvent("pointermove", {
    pointerId: 31,
    pointerType: "pen",
    clientX: 48,
    clientY: 57,
    pressure: 0.8,
    timeStamp: 31,
  }));
  assert.equal(harness.calls.extendStroke.length, 0);
  harness.setPaintReadinessPending(false);
  harness.setOperationLocked(false);
  harness.setBeginStrokeAllowed(true);
  harness.browser.runTimers();
  assert.equal(harness.calls.beginStroke.length, 2,
    "dopo la barriera deve esserci un solo retry riuscito");
  assert.equal(harness.calls.extendStroke.length, 1);
  assert.deepEqual(harness.calls.extendStroke[0].map(({ clientX, clientY }) => ({
    clientX,
    clientY,
  })), [{ clientX: 48, clientY: 57 }]);
  harness.canvas.dispatchEvent(makeEvent("pointerup", {
    pointerId: 31,
    pointerType: "pen",
    clientX: 48,
    clientY: 57,
    timeStamp: 32,
  }));
  assert.deepEqual(harness.calls.endStroke, [32]);
  assert.deepEqual(harness.calls.recordingFinish, [true]);
  harness.controller.dispose();
}

// Lifting before readiness cancels the retained gesture: no latent paint later.
{
  const harness = createHarness();
  harness.enableRecording();
  harness.setPaintReadinessPending(true);
  harness.setBeginStrokeAllowed(false);
  harness.canvas.dispatchEvent(makeEvent("pointerdown", {
    pointerId: 32,
    pointerType: "pen",
  }));
  harness.canvas.dispatchEvent(makeEvent("pointerup", {
    pointerId: 32,
    pointerType: "pen",
  }));
  harness.setPaintReadinessPending(false);
  harness.browser.runTimers();
  assert.equal(harness.calls.beginStroke.length, 1,
    "il tentativo rifiutato non deve essere ripetuto dopo il pointerup");
  assert.equal(harness.calls.endStroke.length, 0);
  assert.equal(harness.calls.recordingCancel, 1);
  harness.controller.dispose();
}

// A long import cannot grow an unbounded Pencil queue or replay a giant burst.
{
  const harness = createHarness();
  harness.setPaintReadinessPending(true);
  harness.setBeginStrokeAllowed(false);
  harness.canvas.dispatchEvent(makeEvent("pointerdown", {
    pointerId: 33,
    pointerType: "pen",
  }));
  const coalesced = Array.from({ length: 2_000 }, (_, index) => ({
    clientX: index,
    clientY: index * 0.5,
    pointerType: "pen",
    pressure: 0.6,
    timeStamp: 100 + index,
  }));
  harness.canvas.dispatchEvent(makeEvent("pointermove", {
    pointerId: 33,
    pointerType: "pen",
    getCoalescedEvents: () => coalesced,
  }));
  harness.setPaintReadinessPending(false);
  harness.setBeginStrokeAllowed(true);
  harness.browser.runTimers();
  assert.equal(harness.calls.extendStroke.length, 1);
  assert.ok(harness.calls.extendStroke[0].length <= 256,
    "il replay Pencil deve restare limitato anche con molti campioni coalescenti");
  assert.equal(harness.calls.extendStroke[0].at(-1).clientX, 1_999,
    "il ricampionamento limitato deve preservare l'ultimo punto");
  harness.canvas.dispatchEvent(makeEvent("pointerup", {
    pointerId: 33,
    pointerType: "pen",
  }));
  harness.controller.dispose();
}

// An import that remains blocked too long releases the Pencil safely.
{
  const harness = createHarness();
  harness.enableRecording();
  harness.setPaintReadinessPending(true);
  harness.setBeginStrokeAllowed(false);
  harness.canvas.dispatchEvent(makeEvent("pointerdown", {
    pointerId: 34,
    pointerType: "pen",
  }));
  harness.browser.now += 3_000;
  harness.browser.runTimers();
  assert.equal(harness.controller.isPointerActive, false);
  assert.equal(harness.canvas.captures.size, 0);
  assert.equal(harness.calls.recordingCancel, 1);
  harness.setPaintReadinessPending(false);
  harness.setBeginStrokeAllowed(true);
  harness.browser.runTimers();
  assert.equal(harness.calls.beginStroke.length, 1,
    "dopo la scadenza non deve comparire un retry tardivo");
  harness.controller.dispose();
}

// The explicit Hand/Move tool pans with the primary mouse button or one touch,
// without opening a Paint transaction.
{
  const harness = createHarness();
  harness.setActiveTool("pan");
  harness.canvas.dispatchEvent(makeEvent("pointerdown", {
    pointerId: 21,
    pointerType: "touch",
    clientX: 30,
    clientY: 40,
  }));
  assert.equal(harness.controller.pointerMode, "pan");
  assert.equal(harness.canvas.classList.contains("panning"), true);
  assert.equal(harness.calls.beginStroke.length, 0);
  assert.equal(harness.calls.vectorBegin, 1);
  harness.canvas.dispatchEvent(makeEvent("pointermove", {
    pointerId: 21,
    pointerType: "touch",
    clientX: 42,
    clientY: 65,
  }));
  assert.deepEqual(harness.calls.pan, [[12, 25]]);
  harness.canvas.dispatchEvent(makeEvent("pointerup", {
    pointerId: 21,
    pointerType: "touch",
    clientX: 42,
    clientY: 65,
  }));
  assert.equal(harness.calls.vectorEnd, 1);
  assert.equal(harness.canvas.classList.contains("panning"), false);
  assert.equal(harness.controller.isPointerActive, false);

  harness.canvas.dispatchEvent(makeEvent("pointerdown", {
    pointerId: 22,
    pointerType: "touch",
    clientX: 20,
    clientY: 20,
  }));
  harness.canvas.dispatchEvent(makeEvent("pointerdown", {
    pointerId: 23,
    pointerType: "touch",
    clientX: 60,
    clientY: 20,
  }));
  assert.equal(harness.controller.pointerMode, "touch-navigation");
  assert.equal(harness.calls.vectorBegin, 2, "il secondo dito non riapre la gesture Pan");
  harness.canvas.dispatchEvent(makeEvent("pointerup", {
    pointerId: 23,
    pointerType: "touch",
  }));
  harness.canvas.dispatchEvent(makeEvent("pointerup", {
    pointerId: 22,
    pointerType: "touch",
  }));
  assert.equal(harness.calls.vectorEnd, 2);
  harness.controller.dispose();
}

// Fill is a short release gesture; dragging cancels it.
{
  const harness = createHarness();
  harness.setActiveTool("fill");
  harness.canvas.dispatchEvent(makeEvent("pointerdown", { pointerId: 3, clientX: 40 }));
  harness.canvas.dispatchEvent(makeEvent("pointerup", {
    pointerId: 3,
    clientX: 44,
    clientY: 20,
  }));
  await Promise.resolve();
  assert.deepEqual(harness.calls.fill, [[44, 20, 17, "#123456"]]);

  harness.canvas.dispatchEvent(makeEvent("pointerdown", { pointerId: 4, clientX: 40 }));
  harness.canvas.dispatchEvent(makeEvent("pointermove", { pointerId: 4, clientX: 60 }));
  harness.canvas.dispatchEvent(makeEvent("pointerup", { pointerId: 4, clientX: 60 }));
  assert.equal(harness.calls.fill.length, 1);
  harness.controller.dispose();
}

// Magic Wand and Lasso share the injected selection transaction boundary.
{
  const harness = createHarness();
  harness.setActiveTool("selection");
  harness.canvas.dispatchEvent(makeEvent("pointerdown", { pointerId: 5, clientX: 12 }));
  harness.canvas.dispatchEvent(makeEvent("pointerup", { pointerId: 5, clientX: 12 }));
  await Promise.all(harness.selectionPromises);
  assert.deepEqual(harness.calls.magic, [[12, 20, 23, "add"]]);

  harness.setSelectionMethod("lasso");
  harness.canvas.dispatchEvent(makeEvent("pointerdown", {
    pointerId: 6,
    clientX: 10,
    clientY: 10,
  }));
  harness.canvas.dispatchEvent(makeEvent("pointermove", {
    pointerId: 6,
    getCoalescedEvents: () => [{ clientX: 20, clientY: 20 }],
  }));
  harness.canvas.dispatchEvent(makeEvent("pointerup", {
    pointerId: 6,
    clientX: 30,
    clientY: 30,
  }));
  await Promise.all(harness.selectionPromises);
  assert.deepEqual(harness.calls.lasso[0], [
    [{ x: 10, y: 10 }, { x: 20, y: 20 }, { x: 30, y: 30 }],
    "add",
  ]);
  harness.controller.dispose();
}

// Touch Paint remains cancellable until movement proves drawing intent.
{
  const harness = createHarness();
  harness.canvas.dispatchEvent(makeEvent("pointerdown", {
    pointerId: 7,
    pointerType: "touch",
    clientX: 100,
    clientY: 100,
    timeStamp: 20,
  }));
  assert.equal(harness.calls.beginStroke.length, 0);
  assert.equal(harness.browser.timers.size, 1);
  harness.canvas.dispatchEvent(makeEvent("pointermove", {
    pointerId: 7,
    pointerType: "touch",
    clientX: 103,
    clientY: 100,
    timeStamp: 21,
  }));
  assert.equal(harness.calls.beginStroke.length, 1);
  assert.equal(harness.calls.extendStroke.length, 1);
  assert.equal(harness.browser.timers.size, 0);
  harness.canvas.dispatchEvent(makeEvent("pointerup", {
    pointerId: 7,
    pointerType: "touch",
    clientX: 103,
    clientY: 100,
    timeStamp: 22,
  }));
  const diagnostics = harness.controller.diagnostics();
  assert.equal(diagnostics.touchPaintIntentStarts, 1);
  assert.equal(diagnostics.touchPaintIntentReleasedByMovement, 1);
  assert.equal(diagnostics.touchPaintIntentMaximumBufferedSamples, 1);
  harness.controller.dispose();
}

// A second finger cancels held Paint before the engine sees a stroke, then one
// view gesture spans the entire multi-touch sequence.
{
  const harness = createHarness();
  harness.canvas.dispatchEvent(makeEvent("pointerdown", {
    pointerId: 8,
    pointerType: "touch",
    clientX: 100,
    clientY: 100,
  }));
  harness.canvas.dispatchEvent(makeEvent("pointerdown", {
    pointerId: 9,
    pointerType: "touch",
    clientX: 140,
    clientY: 100,
  }));
  assert.equal(harness.calls.beginStroke.length, 0);
  assert.equal(harness.calls.cancelStroke, 0);
  assert.equal(harness.controller.pointerMode, "touch-navigation");
  assert.equal(harness.calls.beginView, 1);
  assert.equal(harness.calls.vectorBegin, 1);
  assert.equal(harness.controller.diagnostics().touchPaintIntentCanceledForNavigation, 1);
  harness.canvas.dispatchEvent(makeEvent("pointerup", {
    pointerId: 9,
    pointerType: "touch",
  }));
  assert.equal(harness.calls.endView, 0);
  harness.canvas.dispatchEvent(makeEvent("pointerup", {
    pointerId: 8,
    pointerType: "touch",
  }));
  assert.equal(harness.calls.endView, 1);
  assert.equal(harness.calls.vectorEnd, 1);
  harness.controller.dispose();
}

// If Touch Paint has already rendered, switching to two-finger navigation
// commits that stroke and refreshes its layer preview just like pointer-up.
{
  const harness = createHarness();
  harness.canvas.dispatchEvent(makeEvent("pointerdown", {
    pointerId: 10,
    pointerType: "touch",
    clientX: 100,
    clientY: 100,
  }));
  harness.canvas.dispatchEvent(makeEvent("pointermove", {
    pointerId: 10,
    pointerType: "touch",
    clientX: 110,
    clientY: 100,
  }));
  assert.equal(harness.calls.beginStroke.length, 1);
  harness.canvas.dispatchEvent(makeEvent("pointerdown", {
    pointerId: 11,
    pointerType: "touch",
    clientX: 150,
    clientY: 100,
  }));
  assert.equal(harness.controller.pointerMode, "touch-navigation");
  assert.equal(harness.calls.cancelStroke, 1);
  assert.deepEqual(harness.calls.endStroke, [undefined]);
  assert.equal(harness.calls.layersRefresh, 1);
  assert.equal(harness.calls.thumbnails, 1);
  harness.canvas.dispatchEvent(makeEvent("pointerup", {
    pointerId: 11,
    pointerType: "touch",
  }));
  harness.canvas.dispatchEvent(makeEvent("pointerup", {
    pointerId: 10,
    pointerType: "touch",
  }));
  harness.controller.dispose();
}

// Wheel and R-drag navigation obey their own view lock and vector lifecycle.
{
  const harness = createHarness();
  harness.canvas.dispatchEvent(makeEvent("wheel", { deltaY: 100, clientX: 40 }));
  assert.equal(harness.calls.zoom.length, 1);
  harness.setViewLocked(true);
  harness.canvas.dispatchEvent(makeEvent("wheel", { deltaY: 100 }));
  assert.equal(harness.calls.zoom.length, 1);
  harness.setViewLocked(false);

  harness.browser.dispatchEvent(makeEvent("keydown", { key: "r" }));
  assert.equal(harness.canvas.classList.contains("rotation-ready"), true);
  harness.canvas.dispatchEvent(makeEvent("pointerdown", { pointerId: 10, clientX: 20 }));
  harness.canvas.dispatchEvent(makeEvent("pointermove", { pointerId: 10, clientX: 92 }));
  assert.equal(harness.controller.pointerMode, "rotate");
  assert.equal(harness.calls.rotate.at(-1)[0], Math.PI / 10);
  harness.canvas.dispatchEvent(makeEvent("pointerup", { pointerId: 10 }));
  assert.equal(harness.calls.vectorBegin, 1);
  assert.equal(harness.calls.vectorEnd, 1);
  harness.browser.dispatchEvent(makeEvent("keyup", { key: "r" }));
  assert.equal(harness.canvas.classList.contains("rotation-ready"), false);
  harness.controller.dispose();
}

// Resize and disposal are owned, idempotent and leave no engine transaction or
// delayed touch callback alive (important for pagehide/BFCache).
{
  const harness = createHarness();
  const resizeObserver = FakeResizeObserver.instances.at(-1);
  assert.equal(resizeObserver.observed, harness.canvas);
  resizeObserver.trigger();
  assert.equal(harness.calls.resize, 1);
  assert.equal(harness.selectionGestureCanvas.width, harness.canvas.width);

  harness.enableRecording();
  harness.canvas.dispatchEvent(makeEvent("pointerdown", { pointerId: 11 }));
  assert.equal(harness.controller.isPointerActive, true);
  harness.controller.dispose();
  harness.controller.dispose();
  assert.equal(resizeObserver.disconnected, true);
  assert.equal(harness.controller.isPointerActive, false);
  assert.equal(harness.calls.cancelStroke, 1);
  assert.equal(harness.calls.endStroke.length, 1);
  assert.deepEqual(harness.calls.recordingFinish, [false]);
  const beginCount = harness.calls.beginStroke.length;
  harness.canvas.dispatchEvent(makeEvent("pointerdown", { pointerId: 12 }));
  harness.browser.runTimers();
  assert.equal(harness.calls.beginStroke.length, beginCount);
}

{
  const harness = createHarness();
  harness.canvas.dispatchEvent(makeEvent("pointerdown", {
    pointerId: 13,
    pointerType: "touch",
  }));
  assert.equal(harness.browser.timers.size, 1);
  harness.controller.dispose();
  assert.equal(harness.browser.timers.size, 0);
  harness.browser.runTimers();
  assert.equal(harness.calls.beginStroke.length, 0);
}

console.log(
  "Canvas input controller: paint, touch arbitration, fill, selection, navigation and disposal verified.",
);
