import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "vite";

const root = new URL("../", import.meta.url);
const mainSource = readFileSync(new URL("src/main.ts", root), "utf8");
const controllerSource = readFileSync(
  new URL("src/canvas-input-controller.ts", root),
  "utf8",
);
const engineSource = readFileSync(new URL("src/brush-engine.ts", root), "utf8");
const shaderSource = readFileSync(new URL("src/shaders.ts", root), "utf8");

assert.match(mainSource, /canvasInputController = new CanvasInputController\(\{/);
assert.match(mainSource, /canvasInputController\?\.dispose\(\);/);
assert.doesNotMatch(
  mainSource,
  /let activePointerId|let pointerMode|canvas\.addEventListener\("pointer(?:down|move|up)/,
  "main.ts must remain a composition root, not a second canvas-input owner",
);
assert.match(controllerSource, /export type CanvasInputEnginePort = Pick</);
assert.match(controllerSource, /\| "prepareStraightLineAdjustment"/);
assert.match(controllerSource, /\| "commitStraightLineAdjustment"/);
assert.match(controllerSource, /\| "cancelStraightLineAdjustment"/);
assert.match(controllerSource, /\| "updateStraightLineAdjustment"/);
assert.doesNotMatch(controllerSource, /engine\.beginDeferredStroke\(/,
  "ordinary pointer input must never start on the deferred Quick Line path");
assert.match(controllerSource, /const beganStroke = engine\.beginStroke\(paintSample\);/,
  "mouse and Pencil freehand must start authoritatively");
assert.match(engineSource, /async prepareStraightLineAdjustment\(/);
assert.match(engineSource, /async commitStraightLineAdjustment\(/);
assert.match(engineSource, /async cancelStraightLineAdjustment\(/);
assert.match(engineSource, /await this\.waitForIdle\(\)/);
assert.match(engineSource, /beginDeferredStroke\(/);
assert.match(engineSource, /prepareDeferredStrokePreviewFrame\(/);
assert.match(engineSource, /compositionMode: 0 \| 1 \| 2/);
assert.match(shaderSource, /tail\.compositionMode == 2u/);
const quickLineEngine = engineSource.slice(
  engineSource.indexOf("  private async redoStraightLineSourceAction("),
  engineSource.indexOf("  cancelStrokeBeforeRender(): boolean"),
);
assert.match(quickLineEngine, /this\.endStroke\([\s\S]*await this\.waitForIdle\(\)[\s\S]*await this\.undo\(\)[\s\S]*this\.beginDeferredStroke\(/,
  "only an activated Quick Line may pivot completed freehand into a deferred replacement");
assert.match(quickLineEngine, /cancelStrokeBeforeRender\(\)[\s\S]*redoStraightLineSourceAction/,
  "canceling Quick Line must discard its temporary stroke and restore freehand");
assert.match(quickLineEngine, /endingStroke\.deferredPreview = false;[\s\S]*this\.pendingStamps\.push/,
  "the deferred geometry must become authoritative only from endStroke");
assert.match(engineSource, /this\.activeStroke\?\.deferredPreview[\s\S]*this\.historyGpuStorage\.release\(capturedSlice\);[\s\S]*return;/,
  "live Glaze preview batches must release, rather than record, their history payload");
assert.doesNotMatch(mainSource, /straightLinePreviewCanvas/);
assert.doesNotMatch(controllerSource, /straightLinePreviewCanvas|#58dcff/);
assert.match(controllerSource, /private readonly runtime: CanvasInputRuntime/);
assert.match(controllerSource, /new browser\.AbortController\(\)/);
assert.match(mainSource, /mixedSceneController\?\.isBusy === true/);
assert.match(mainSource, /isPaintReadinessPending: \(\) => engine\.isPaintReadinessPending\(\)/);
assert.match(
  mainSource,
  /function fillPreviewAllowsCanvasNavigation\(\)[\s\S]*?historyState\.openEdit !== "fill"[\s\S]*?previewState\.active && !previewState\.terminal/,
  "an active non-terminal Fill preview must explicitly opt into view-only navigation",
);
assert.match(
  mainSource,
  /isDestructivePreviewNavigationActive:[\s\S]*?fillPreviewAllowsCanvasNavigation\(\)/,
  "Fill touch input must reuse the destructive-preview navigation path",
);
assert.match(controllerSource, /destructivePreviewTouchNavigationRequested/);
assert.doesNotMatch(controllerSource, /document\.getElementById|element<|mobileBrush/);
const finishPointerSource = controllerSource.slice(
  controllerSource.indexOf("  const finishPointer ="),
  controllerSource.indexOf("  const handleCanvasKeydown ="),
);
assert.match(
  finishPointerSource,
  /try \{[\s\S]*?engine\.endStroke\(event\.timeStamp\);[\s\S]*?\} finally \{[\s\S]*?pointerMode = null;[\s\S]*?activePointerId = null;/,
  "pointer ownership must be released even if stroke finalization fails",
);
const blendEndStrokeSource = engineSource.slice(
  engineSource.indexOf('if (endingStroke?.tool === "blend")'),
  engineSource.indexOf("const hadPredictiveThicknessTail"),
);
assert.match(
  blendEndStrokeSource,
  /catch \(error\) \{[\s\S]*?discardPending\(\);[\s\S]*?throw error;[\s\S]*?\} finally \{[\s\S]*?this\.activeStroke = null;[\s\S]*?this\.settleDeferredBrushSettingsAfterBlend\(\);/,
  "Blend finalization must release engine stroke ownership after an error",
);

const moduleServer = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: process.cwd(),
  server: { middlewareMode: true },
});
let CanvasInputController;
let analyzeStrokeStraightness;
let straightenPointerSamples;
try {
  ({ CanvasInputController } = await moduleServer.ssrLoadModule(
    "/src/canvas-input-controller.ts",
  ));
  ({ analyzeStrokeStraightness, straightenPointerSamples } = await moduleServer.ssrLoadModule(
    "/src/stroke-straightening-core.ts",
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
  strokeCount = 0;
  strokes = [];
  lineCap = "butt";
  lineJoin = "miter";
  lineWidth = 1;
  strokeStyle = "";
  lineDashOffset = 0;
  globalAlpha = 1;

  clearRect() { this.clearCount += 1; }
  save() {}
  restore() {}
  beginPath() {}
  moveTo() {}
  lineTo() {}
  setLineDash() {}
  stroke() {
    this.strokeCount += 1;
    this.strokes.push({
      lineWidth: this.lineWidth,
      strokeStyle: this.strokeStyle,
      globalAlpha: this.globalAlpha,
    });
  }
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
  nextAnimationFrameId = 1;
  timers = new Map();
  animationFrames = new Map();
  performance = { now: () => this.now };

  requestAnimationFrame(callback) {
    const id = this.nextAnimationFrameId;
    this.nextAnimationFrameId += 1;
    this.animationFrames.set(id, callback);
    return id;
  }

  cancelAnimationFrame(id) {
    this.animationFrames.delete(id);
  }

  runAnimationFrames() {
    const pending = [...this.animationFrames.values()];
    this.animationFrames.clear();
    for (const callback of pending) callback(this.now);
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
    beginDeferredStroke: [],
    extendStroke: [],
    prepareStraightLine: [],
    updateStraightLine: [],
    commitStraightLine: [],
    cancelStraightLine: 0,
    endStroke: [],
    cancelStroke: 0,
    beginLiquify: [],
    extendLiquify: [],
    endLiquify: [],
    beginSpatialBlur: [],
    updateSpatialBlur: [],
    endSpatialBlur: [],
    cancelSpatialBlurForNavigation: 0,
    beginShape: [],
    addShapePointer: [],
    updateShape: [],
    endShape: [],
    cancelShape: 0,
    shapeConstraint: [],
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
  let spatialBlurEditActive = false;
  let shapeToolActive = true;
  let shapeToolBusy = false;
  let shapePresentationPreparing = false;
  let destructivePreviewNavigationActive = false;
  let openHistoryEdit = null;
  let beginStrokeAllowed = true;
  let prepareStraightLineAllowed = true;
  let commitStraightLineAllowed = true;
  let cancelStrokeBeforeRender = false;
  let endStrokeError = null;
  let extension = null;
  const selectionPromises = [];
  const engine = {
    beginStroke(sample) {
      calls.beginStroke.push(sample);
      return beginStrokeAllowed;
    },
    beginDeferredStroke(sample) {
      calls.beginDeferredStroke.push(sample);
      return beginStrokeAllowed;
    },
    extendStroke(samples) { calls.extendStroke.push(samples); },
    prepareStraightLineAdjustment(samples, signal) {
      calls.prepareStraightLine.push({ samples, signal });
      return Promise.resolve(prepareStraightLineAllowed && !signal?.aborted);
    },
    updateStraightLineAdjustment(samples) {
      calls.updateStraightLine.push(samples);
      return true;
    },
    commitStraightLineAdjustment(samples) {
      calls.commitStraightLine.push(samples);
      return Promise.resolve(commitStraightLineAllowed);
    },
    cancelStraightLineAdjustment() {
      calls.cancelStraightLine += 1;
      return Promise.resolve(true);
    },
    endStroke(timeMs) {
      calls.endStroke.push(timeMs);
      if (endStrokeError) throw endStrokeError;
    },
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
      return {
        x: sample.clientX,
        y: sample.clientY,
        pressure: sample.pressure,
        timeMs: sample.timeMs,
      };
    },
    getHistoryState: () => ({ ...historyState(), openEdit: openHistoryEdit }),
    resizeCanvas() { calls.resize += 1; },
  };
  const vector = {
    beginViewGesture() { calls.vectorBegin += 1; },
    endViewGesture() { calls.vectorEnd += 1; },
  };
  const spatialBlur = {
    isSpatialBlurEditActive: () => spatialBlurEditActive,
    beginSpatialBlurPointer(input) {
      calls.beginSpatialBlur.push(input);
      return true;
    },
    updateSpatialBlurPointer(input) { calls.updateSpatialBlur.push(input); },
    endSpatialBlurPointer(input, commit) {
      calls.endSpatialBlur.push({ input, commit });
    },
    cancelSpatialBlurPointerForNavigation() {
      calls.cancelSpatialBlurForNavigation += 1;
    },
  };
  const shape = {
    get isActive() { return shapeToolActive; },
    get isBusy() { return shapeToolBusy; },
    get isPresentationPreparing() { return shapePresentationPreparing; },
    beginPointer(input) {
      calls.beginShape.push(input);
      return true;
    },
    addPointer(input) {
      calls.addShapePointer.push(input);
      return true;
    },
    updatePointer(input) { calls.updateShape.push(input); },
    endPointer(input, commit) {
      calls.endShape.push({ input, commit });
      return Promise.resolve(commit);
    },
    cancelGesture() { calls.cancelShape += 1; },
    setConstraintRequested(requested) { calls.shapeConstraint.push(requested); },
  };
  const controller = new CanvasInputController({
    engine,
    browser,
    elements: {
      canvas,
      selectionGestureCanvas,
      selectionGestureContext,
      status,
    },
    touchPaintIntentHoldEnabled: holdEnabled,
    getActiveTool: () => activeTool,
    getSelectionMethod: () => selectionMethod,
    getFillSettings: () => ({ tolerance: 17, color: "#123456" }),
    getSelectionSettings: () => ({ tolerance: 23, combineMode: "add" }),
    getHistoryState: () => ({ ...historyState(), openEdit: openHistoryEdit }),
    onHistoryState: () => { calls.historyPublished += 1; },
    operationLocked: (
      allowDestructivePreviewEdit = false,
      allowShapePresentationPreparation = false,
    ) => (
      operationIsLocked
      && !allowDestructivePreviewEdit
      && !(allowShapePresentationPreparation && shapePresentationPreparing)
    ),
    viewOperationLocked: () => viewIsLocked,
    isPaintReadinessPending: () => paintReadinessPending,
    isLiquifyEditActive: () => liquifyEditActive,
    isDestructivePreviewNavigationActive: () => destructivePreviewNavigationActive,
    getSpatialBlurController: () => spatialBlur,
    getShapeController: () => shape,
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
    setSpatialBlurEditActive(value) { spatialBlurEditActive = value; },
    setShapeToolActive(value) { shapeToolActive = value; },
    setShapeToolBusy(value) { shapeToolBusy = value; },
    setShapePresentationPreparing(value) { shapePresentationPreparing = value; },
    setOpenHistoryEdit(value) { openHistoryEdit = value; },
    setDestructivePreviewNavigationActive(value) {
      destructivePreviewNavigationActive = value;
    },
    setBeginStrokeAllowed(value) { beginStrokeAllowed = value; },
    setPrepareStraightLineAllowed(value) { prepareStraightLineAllowed = value; },
    setCommitStraightLineAllowed(value) { commitStraightLineAllowed = value; },
    setCancelStrokeBeforeRender(value) { cancelStrokeBeforeRender = value; },
    setEndStrokeError(value) { endStrokeError = value; },
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

async function flushMicrotasks() {
  for (let index = 0; index < 4; index += 1) await Promise.resolve();
}

// Quick Line accepts restrained hand wobble, rejects a bow and preserves the
// authored pressure/timing while projecting every center onto one chord.
{
  const almostStraight = [
    { clientX: 0, clientY: 0, pressure: 0.2, timeMs: 1 },
    { clientX: 40, clientY: 2, pressure: 0.4, timeMs: 2 },
    { clientX: 80, clientY: -1, pressure: 0.7, timeMs: 3 },
    { clientX: 120, clientY: 1, pressure: 0.9, timeMs: 4 },
  ];
  assert.equal(analyzeStrokeStraightness(almostStraight).eligible, true);
  assert.equal(analyzeStrokeStraightness([
    almostStraight[0],
    { clientX: 60, clientY: 30, pressure: 0.5, timeMs: 2 },
    almostStraight.at(-1),
  ]).eligible, false);
  assert.equal(analyzeStrokeStraightness([
    almostStraight[0],
    { clientX: 10, clientY: 0, pressure: 0.5, timeMs: 2 },
  ]).eligible, false);

  const straightened = straightenPointerSamples(almostStraight);
  const first = straightened[0];
  const last = straightened.at(-1);
  for (const sample of straightened) {
    const cross = (sample.clientX - first.clientX) * (last.clientY - first.clientY)
      - (sample.clientY - first.clientY) * (last.clientX - first.clientX);
    assert.ok(Math.abs(cross) < 1e-8, "ogni centro Quick Line deve essere collineare");
  }
  assert.deepEqual(
    straightened.map(({ pressure, timeMs }) => ({ pressure, timeMs })),
    almostStraight.map(({ pressure, timeMs }) => ({ pressure, timeMs })),
  );
}

// A nearly straight mouse gesture becomes an adjustable preview after the
// hold. The fixed origin and latest endpoint are committed as one exact chord.
{
  const harness = createHarness();
  harness.canvas.dispatchEvent(makeEvent("pointerdown", {
    pointerId: 90,
    clientX: 20,
    clientY: 40,
    timeStamp: 100,
  }));
  harness.canvas.dispatchEvent(makeEvent("pointermove", {
    pointerId: 90,
    getCoalescedEvents: () => [
      makeEvent("pointermove", { pointerId: 90, clientX: 60, clientY: 42, timeStamp: 110 }),
      makeEvent("pointermove", { pointerId: 90, clientX: 100, clientY: 39, timeStamp: 120 }),
      makeEvent("pointermove", { pointerId: 90, clientX: 140, clientY: 41, timeStamp: 130 }),
    ],
  }));
  assert.equal(harness.calls.extendStroke.length, 1);
  assert.equal(harness.calls.beginStroke.length, 1);
  assert.equal(harness.calls.beginDeferredStroke.length, 0,
    "Quick Line must not allocate its deferred path before the hold fires");
  assert.equal(harness.browser.timers.size, 1);
  harness.browser.runTimers();
  await flushMicrotasks();
  assert.equal(harness.calls.prepareStraightLine.length, 1);
  assert.ok(harness.calls.updateStraightLine.length >= 1,
    "la preview reale deve essere aggiornata dal renderer WebGPU");
  assert.equal(harness.calls.endStroke.length, 0,
    "the controller delegates the authoritative-to-deferred pivot to the engine");
  assert.equal(harness.calls.commitStraightLine.length, 0,
    "Quick Line deve restare una preview finché il puntatore è premuto");
  harness.canvas.dispatchEvent(makeEvent("pointermove", {
    pointerId: 90,
    clientX: 160,
    clientY: 90,
    timeStamp: 140,
  }));
  harness.canvas.dispatchEvent(makeEvent("pointermove", {
    pointerId: 90,
    clientX: 170,
    clientY: 92,
    timeStamp: 141,
  }));
  harness.canvas.dispatchEvent(makeEvent("pointermove", {
    pointerId: 90,
    clientX: 180,
    clientY: 94,
    timeStamp: 142,
  }));
  assert.equal(harness.calls.extendStroke.length, 1,
    "durante la regolazione nessuna coda curva deve raggiungere il motore");
  const updatesBeforeFrame = harness.calls.updateStraightLine.length;
  assert.equal(updatesBeforeFrame, 1,
    "gli eventi endpoint nello stesso frame non devono ricostruire subito la linea");
  harness.browser.runAnimationFrames();
  assert.equal(harness.calls.updateStraightLine.length, updatesBeforeFrame + 1,
    "un burst endpoint deve produrre una sola preview latest-only per frame");
  assert.deepEqual(
    {
      clientX: harness.calls.updateStraightLine.at(-1).at(-1).clientX,
      clientY: harness.calls.updateStraightLine.at(-1).at(-1).clientY,
    },
    { clientX: 180, clientY: 94 },
    "la punta deve aggiornare direttamente la geometria GPU reale",
  );
  assert.equal(harness.calls.endStroke.length, 0,
    "anche dopo aver spostato la punta il tratto deve restare non committato");
  assert.equal(harness.calls.commitStraightLine.length, 0);
  harness.canvas.dispatchEvent(makeEvent("pointerup", {
    pointerId: 90,
    clientX: 185,
    clientY: 96,
    timeStamp: 150,
  }));
  await flushMicrotasks();
  assert.equal(harness.controller.isPointerActive, false);
  assert.equal(harness.calls.commitStraightLine.length, 1);
  const committedSamples = harness.calls.commitStraightLine[0];
  const committedFirst = committedSamples[0];
  const committedLast = committedSamples.at(-1);
  assert.deepEqual(
    { clientX: committedFirst.clientX, clientY: committedFirst.clientY },
    { clientX: 20, clientY: 40 },
  );
  assert.deepEqual(
    { clientX: committedLast.clientX, clientY: committedLast.clientY },
    { clientX: 185, clientY: 96 },
    "la punta rilasciata deve controllare lunghezza e angolo finali",
  );
  for (const sample of committedSamples) {
    const cross = (sample.clientX - committedFirst.clientX)
      * (committedLast.clientY - committedFirst.clientY)
      - (sample.clientY - committedFirst.clientY)
      * (committedLast.clientX - committedFirst.clientX);
    assert.ok(Math.abs(cross) < 1e-8);
  }
  harness.controller.dispose();
}

// Erase uses the same adjustable geometry through the real GPU preview; no
// artificial Canvas2D guide is involved.
{
  const harness = createHarness();
  harness.setActiveTool("erase");
  harness.canvas.dispatchEvent(makeEvent("pointerdown", {
    pointerId: 94,
    clientX: 30,
    clientY: 30,
    timeStamp: 200,
  }));
  harness.canvas.dispatchEvent(makeEvent("pointermove", {
    pointerId: 94,
    clientX: 150,
    clientY: 32,
    timeStamp: 210,
  }));
  harness.browser.runTimers();
  await flushMicrotasks();
  assert.equal(harness.calls.prepareStraightLine.length, 1);
  assert.ok(harness.calls.updateStraightLine.length >= 1);
  harness.canvas.dispatchEvent(makeEvent("pointermove", {
    pointerId: 94,
    clientX: 90,
    clientY: 150,
    timeStamp: 220,
  }));
  harness.canvas.dispatchEvent(makeEvent("pointerup", {
    pointerId: 94,
    clientX: 90,
    clientY: 150,
    timeStamp: 230,
  }));
  await flushMicrotasks();
  assert.equal(harness.calls.commitStraightLine.length, 1);
  assert.deepEqual(
    {
      clientX: harness.calls.commitStraightLine[0].at(-1).clientX,
      clientY: harness.calls.commitStraightLine[0].at(-1).clientY,
    },
    { clientX: 90, clientY: 150 },
  );
  harness.controller.dispose();
}

// Releasing while the engine is still preparing queues the final endpoint;
// canceling an already prepared line restores the original source stroke.
{
  const releasedDuringPrepare = createHarness();
  releasedDuringPrepare.canvas.dispatchEvent(makeEvent("pointerdown", {
    pointerId: 95,
    clientX: 15,
    clientY: 25,
    timeStamp: 300,
  }));
  releasedDuringPrepare.canvas.dispatchEvent(makeEvent("pointermove", {
    pointerId: 95,
    clientX: 135,
    clientY: 26,
    timeStamp: 310,
  }));
  releasedDuringPrepare.browser.runTimers();
  releasedDuringPrepare.canvas.dispatchEvent(makeEvent("pointerup", {
    pointerId: 95,
    clientX: 190,
    clientY: 75,
    timeStamp: 320,
  }));
  assert.equal(releasedDuringPrepare.calls.commitStraightLine.length, 0);
  await flushMicrotasks();
  assert.equal(releasedDuringPrepare.calls.commitStraightLine.length, 1);
  assert.deepEqual(
    {
      clientX: releasedDuringPrepare.calls.commitStraightLine[0].at(-1).clientX,
      clientY: releasedDuringPrepare.calls.commitStraightLine[0].at(-1).clientY,
    },
    { clientX: 190, clientY: 75 },
  );
  releasedDuringPrepare.controller.dispose();

  const rejectedAfterRelease = createHarness();
  rejectedAfterRelease.setPrepareStraightLineAllowed(false);
  rejectedAfterRelease.canvas.dispatchEvent(makeEvent("pointerdown", {
    pointerId: 97,
    clientX: 20,
    clientY: 30,
    timeStamp: 330,
  }));
  rejectedAfterRelease.canvas.dispatchEvent(makeEvent("pointermove", {
    pointerId: 97,
    clientX: 150,
    clientY: 31,
    timeStamp: 340,
  }));
  rejectedAfterRelease.browser.runTimers();
  rejectedAfterRelease.canvas.dispatchEvent(makeEvent("pointerup", {
    pointerId: 97,
    clientX: 150,
    clientY: 31,
    timeStamp: 350,
  }));
  await flushMicrotasks();
  assert.deepEqual(rejectedAfterRelease.calls.endStroke, [350],
    "a failed preparation after lift must still commit the original deferred stroke");
  rejectedAfterRelease.controller.dispose();

  const canceled = createHarness();
  canceled.canvas.dispatchEvent(makeEvent("pointerdown", {
    pointerId: 96,
    clientX: 20,
    clientY: 20,
  }));
  canceled.canvas.dispatchEvent(makeEvent("pointermove", {
    pointerId: 96,
    clientX: 150,
    clientY: 20,
  }));
  canceled.browser.runTimers();
  await flushMicrotasks();
  canceled.canvas.dispatchEvent(makeEvent("pointercancel", {
    pointerId: 96,
    clientX: 155,
    clientY: 25,
  }));
  await flushMicrotasks();
  assert.equal(canceled.calls.cancelStraightLine, 1);
  assert.equal(canceled.calls.commitStraightLine.length, 0);
  canceled.controller.dispose();
}

// Curved, short, Blend and early-lift gestures remain ordinary strokes.
{
  const curved = createHarness();
  curved.canvas.dispatchEvent(makeEvent("pointerdown", {
    pointerId: 91,
    clientX: 10,
    clientY: 10,
  }));
  curved.canvas.dispatchEvent(makeEvent("pointermove", {
    pointerId: 91,
    getCoalescedEvents: () => [
      makeEvent("pointermove", { pointerId: 91, clientX: 70, clientY: 45 }),
      makeEvent("pointermove", { pointerId: 91, clientX: 130, clientY: 10 }),
    ],
  }));
  assert.equal(curved.browser.timers.size, 0);
  curved.canvas.dispatchEvent(makeEvent("pointerup", { pointerId: 91 }));
  assert.equal(curved.calls.prepareStraightLine.length, 0);
  curved.controller.dispose();

  const earlyLift = createHarness();
  earlyLift.canvas.dispatchEvent(makeEvent("pointerdown", {
    pointerId: 92,
    clientX: 10,
    clientY: 10,
  }));
  earlyLift.canvas.dispatchEvent(makeEvent("pointermove", {
    pointerId: 92,
    clientX: 130,
    clientY: 10,
  }));
  assert.equal(earlyLift.browser.timers.size, 1);
  earlyLift.canvas.dispatchEvent(makeEvent("pointerup", { pointerId: 92 }));
  earlyLift.browser.runTimers();
  await flushMicrotasks();
  assert.equal(earlyLift.calls.prepareStraightLine.length, 0);
  assert.deepEqual(earlyLift.calls.endStroke, [10],
    "lifting before the hold must finish the ordinary stroke exactly once");
  assert.equal(earlyLift.calls.beginDeferredStroke.length, 0);
  earlyLift.controller.dispose();

  const blend = createHarness();
  blend.setActiveTool("blend");
  blend.canvas.dispatchEvent(makeEvent("pointerdown", { pointerId: 93 }));
  blend.canvas.dispatchEvent(makeEvent("pointermove", {
    pointerId: 93,
    clientX: 150,
    clientY: 20,
  }));
  assert.equal(blend.browser.timers.size, 0);
  blend.canvas.dispatchEvent(makeEvent("pointerup", { pointerId: 93 }));
  blend.controller.dispose();
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
  assert.deepEqual(harness.calls.beginDeferredStroke, [],
    "un rilascio freehand normale non deve mai armare la superficie Quick Line");
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

// A failed engine finalization is reported by the host EventTarget, but it
// must never retain pointer ownership or skip recording/UI cleanup.
{
  const harness = createHarness();
  harness.enableRecording();
  const expectedError = new Error("simulated Blend finalization failure");
  harness.setEndStrokeError(expectedError);
  const reportedError = new Promise((resolve) => {
    process.once("uncaughtException", resolve);
  });
  harness.canvas.dispatchEvent(makeEvent("pointerdown", { pointerId: 109 }));
  harness.canvas.dispatchEvent(makeEvent("pointerup", { pointerId: 109 }));
  assert.equal(harness.controller.isPointerActive, false);
  assert.equal(harness.controller.pointerMode, null);
  assert.deepEqual(harness.calls.recordingFinish, [true]);
  assert.equal(await reportedError, expectedError);
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

// Shapes keep the first touch as the drawing pointer. A second touch is sent
// to the 1:1 modifier and never enters pan, pinch or rotation.
{
  const harness = createHarness();
  harness.setActiveTool("shapes");
  harness.canvas.dispatchEvent(makeEvent("pointerdown", {
    pointerId: 201,
    pointerType: "touch",
    clientX: 20,
    clientY: 30,
  }));
  assert.equal(harness.controller.pointerMode, "shape");
  assert.equal(harness.calls.beginShape.length, 1);
  harness.canvas.dispatchEvent(makeEvent("pointermove", {
    pointerId: 201,
    pointerType: "touch",
    clientX: 100,
    clientY: 70,
  }));
  assert.equal(harness.calls.updateShape.length, 1);

  harness.canvas.dispatchEvent(makeEvent("pointerdown", {
    pointerId: 202,
    pointerType: "touch",
    clientX: 480,
    clientY: 390,
  }));
  assert.equal(harness.calls.addShapePointer.length, 1);
  assert.equal(harness.calls.beginView, 0);
  assert.equal(harness.calls.vectorBegin, 0);
  assert.equal(harness.controller.pointerMode, "shape");

  harness.canvas.dispatchEvent(makeEvent("pointerup", {
    pointerId: 202,
    pointerType: "touch",
    clientX: 480,
    clientY: 390,
  }));
  assert.equal(harness.calls.endShape.length, 1);
  assert.equal(harness.calls.endShape[0].input.pointerId, 202);
  assert.equal(harness.controller.isPointerActive, true);
  harness.canvas.dispatchEvent(makeEvent("pointerup", {
    pointerId: 201,
    pointerType: "touch",
    clientX: 100,
    clientY: 70,
  }));
  assert.equal(harness.calls.endShape.length, 2);
  assert.equal(harness.calls.endShape[1].input.pointerId, 201);
  assert.equal(harness.calls.endShape[1].commit, true);
  assert.equal(harness.calls.beginView, 0);
  assert.equal(harness.calls.pan.length, 0);
  assert.equal(harness.calls.zoom.length, 0);
  assert.equal(harness.calls.rotate.length, 0);
  assert.equal(harness.controller.isPointerActive, false);
  harness.controller.dispose();
}

// On slower mobile GPUs the first touch can arrive while ordered shape
// presentation is still preparing. That one preparation lock is bypassed for
// Shapes only, while the pointer is captured normally.
{
  const harness = createHarness();
  harness.setActiveTool("shapes");
  harness.setShapeToolBusy(true);
  harness.setShapePresentationPreparing(true);
  harness.setOperationLocked(true);
  harness.canvas.dispatchEvent(makeEvent("pointerdown", {
    pointerId: 205,
    pointerType: "touch",
    clientX: 30,
    clientY: 40,
  }));
  assert.equal(harness.controller.pointerMode, "shape");
  assert.equal(harness.calls.beginShape.length, 1);
  assert.equal(harness.canvas.captures.has(205), true);
  harness.canvas.dispatchEvent(makeEvent("pointerup", {
    pointerId: 205,
    pointerType: "touch",
    clientX: 30,
    clientY: 40,
  }));
  harness.controller.dispose();
}

// If the drawing touch lifts first, remaining modifier captures are cleared so
// they cannot keep the canvas in a half-owned gesture.
{
  const harness = createHarness();
  harness.setActiveTool("shapes");
  harness.canvas.dispatchEvent(makeEvent("pointerdown", {
    pointerId: 211,
    pointerType: "touch",
  }));
  harness.canvas.dispatchEvent(makeEvent("pointerdown", {
    pointerId: 212,
    pointerType: "touch",
  }));
  assert.equal(harness.canvas.captures.size, 2);
  harness.canvas.dispatchEvent(makeEvent("pointerup", {
    pointerId: 211,
    pointerType: "touch",
  }));
  assert.equal(harness.canvas.captures.size, 0);
  assert.equal(harness.controller.pointerMode, null);
  harness.controller.dispose();
}

// Shift belongs to the regular-shape constraint while Shapes is active. It
// must work even when already held on pointerdown and must never divert that
// gesture into canvas panning.
{
  const harness = createHarness();
  harness.setActiveTool("shapes");
  harness.canvas.dispatchEvent(makeEvent("pointerdown", {
    pointerId: 221,
    pointerType: "mouse",
    clientX: 40,
    clientY: 50,
    shiftKey: true,
  }));
  assert.equal(harness.controller.pointerMode, "shape");
  assert.equal(harness.calls.beginShape.length, 1);
  assert.equal(harness.calls.beginShape[0].constrainAspect, true);
  assert.equal(harness.calls.pan.length, 0);
  assert.equal(harness.calls.vectorBegin, 0);

  harness.canvas.dispatchEvent(makeEvent("pointermove", {
    pointerId: 221,
    pointerType: "mouse",
    clientX: 80,
    clientY: 70,
    shiftKey: true,
  }));
  assert.equal(harness.calls.updateShape.length, 1);
  assert.equal(harness.calls.updateShape[0].constrainAspect, true);
  assert.equal(harness.calls.pan.length, 0);

  harness.browser.dispatchEvent(makeEvent("keyup", { key: "Shift" }));
  harness.browser.dispatchEvent(makeEvent("keydown", { key: "Shift", shiftKey: true }));
  harness.browser.dispatchEvent(makeEvent("blur"));
  assert.deepEqual(harness.calls.shapeConstraint, [false, true, false]);

  harness.canvas.dispatchEvent(makeEvent("pointerup", {
    pointerId: 221,
    pointerType: "mouse",
    clientX: 100,
    clientY: 90,
    shiftKey: true,
  }));
  assert.equal(harness.calls.endShape.length, 1);
  assert.equal(harness.calls.endShape[0].input.constrainAspect, true);
  assert.equal(harness.controller.isPointerActive, false);
  harness.controller.dispose();
}

// Shift remains the canvas-pan shortcut for tools that do not own it as a
// shape constraint.
{
  const harness = createHarness();
  harness.canvas.dispatchEvent(makeEvent("pointerdown", {
    pointerId: 222,
    pointerType: "mouse",
    shiftKey: true,
  }));
  assert.equal(harness.controller.pointerMode, "pan");
  assert.equal(harness.calls.beginShape.length, 0);
  assert.equal(harness.calls.vectorBegin, 1);
  harness.canvas.dispatchEvent(makeEvent("pointerup", {
    pointerId: 222,
    pointerType: "mouse",
    shiftKey: true,
  }));
  assert.equal(harness.controller.isPointerActive, false);
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

// Once Fill owns a live preview, more short Fill taps stay available while all
// other mutations remain locked. One finger fills; two fingers, Hand/rotate
// shortcuts and wheel zoom keep using the view-only path.
{
  const harness = createHarness();
  harness.setActiveTool("fill");
  harness.setOperationLocked(true);
  harness.setViewLocked(false);
  harness.setDestructivePreviewNavigationActive(true);
  harness.setOpenHistoryEdit("fill");

  harness.canvas.dispatchEvent(makeEvent("pointerdown", {
    pointerId: 40,
    pointerType: "mouse",
    button: 0,
    clientX: 30,
    clientY: 40,
  }));
  harness.canvas.dispatchEvent(makeEvent("pointerup", {
    pointerId: 40,
    pointerType: "mouse",
    button: 0,
    clientX: 32,
    clientY: 42,
  }));
  await Promise.resolve();
  assert.deepEqual(harness.calls.fill, [[32, 42, 17, "#123456"]],
    "a second mouse click must enqueue another Fill in the open session");

  harness.canvas.dispatchEvent(makeEvent("pointerdown", {
    pointerId: 41,
    pointerType: "touch",
    clientX: 30,
    clientY: 40,
  }));
  assert.equal(harness.controller.pointerMode, "fill");
  harness.canvas.dispatchEvent(makeEvent("pointerup", {
    pointerId: 41,
    pointerType: "touch",
    clientX: 32,
    clientY: 42,
  }));
  await Promise.resolve();
  assert.deepEqual(harness.calls.fill.at(-1), [32, 42, 17, "#123456"],
    "a one-finger tap must add a Fill while its panel remains open");

  harness.canvas.dispatchEvent(makeEvent("pointerdown", {
    pointerId: 44,
    pointerType: "touch",
    clientX: 20,
    clientY: 20,
  }));
  harness.canvas.dispatchEvent(makeEvent("pointerdown", {
    pointerId: 45,
    pointerType: "touch",
    clientX: 60,
    clientY: 20,
  }));
  assert.equal(harness.controller.pointerMode, "touch-navigation");
  harness.canvas.dispatchEvent(makeEvent("pointerup", {
    pointerId: 45,
    pointerType: "touch",
  }));
  harness.canvas.dispatchEvent(makeEvent("pointerup", {
    pointerId: 44,
    pointerType: "touch",
  }));
  await Promise.resolve();
  assert.equal(harness.calls.fill.length, 2,
    "promoting a Fill touch to two-finger navigation must cancel that Fill");

  harness.setActiveTool("paint");
  harness.canvas.dispatchEvent(makeEvent("pointerdown", { pointerId: 46 }));
  assert.equal(harness.controller.isPointerActive, false,
    "the Fill-session exception must not unlock another mutating tool");
  harness.setActiveTool("fill");

  harness.canvas.dispatchEvent(makeEvent("wheel", {
    deltaY: 100,
    clientX: 40,
    clientY: 50,
  }));
  assert.equal(harness.calls.zoom.length, 1);

  harness.canvas.dispatchEvent(makeEvent("pointerdown", {
    pointerId: 42,
    pointerType: "mouse",
    button: 1,
    clientX: 20,
    clientY: 20,
  }));
  harness.canvas.dispatchEvent(makeEvent("pointermove", {
    pointerId: 42,
    pointerType: "mouse",
    button: 1,
    clientX: 35,
    clientY: 32,
  }));
  assert.deepEqual(harness.calls.pan.at(-1), [15, 12]);
  harness.canvas.dispatchEvent(makeEvent("pointerup", {
    pointerId: 42,
    pointerType: "mouse",
    button: 1,
  }));

  harness.browser.dispatchEvent(makeEvent("keydown", { key: "r" }));
  harness.canvas.dispatchEvent(makeEvent("pointerdown", {
    pointerId: 43,
    pointerType: "mouse",
    button: 0,
    clientX: 20,
  }));
  harness.canvas.dispatchEvent(makeEvent("pointermove", {
    pointerId: 43,
    pointerType: "mouse",
    button: 0,
    clientX: 92,
  }));
  assert.equal(harness.calls.rotate.at(-1)[0], Math.PI / 10);
  harness.canvas.dispatchEvent(makeEvent("pointerup", {
    pointerId: 43,
    pointerType: "mouse",
    button: 0,
  }));
  harness.browser.dispatchEvent(makeEvent("keyup", { key: "r" }));
  assert.equal(harness.calls.fill.length, 2,
    "view-only shortcuts must not add another Fill");
  harness.controller.dispose();
}

// Point Blur owns one-finger point gestures while its transaction is open.
// A second finger rolls the provisional point gesture back before handing the
// contacts to the established pan/pinch/rotate path.
{
  const harness = createHarness();
  harness.setOperationLocked(true);
  harness.setViewLocked(false);
  harness.setSpatialBlurEditActive(true);
  harness.setDestructivePreviewNavigationActive(true);
  harness.setOpenHistoryEdit("spatial-blur");

  harness.canvas.dispatchEvent(makeEvent("pointerdown", {
    pointerId: 70,
    pointerType: "mouse",
    clientX: 80,
    clientY: 90,
  }));
  assert.equal(harness.controller.pointerMode, "spatial-blur");
  assert.equal(harness.calls.beginStroke.length, 0);
  harness.canvas.dispatchEvent(makeEvent("pointermove", {
    pointerId: 70,
    pointerType: "mouse",
    clientX: 80,
    clientY: 70,
  }));
  harness.canvas.dispatchEvent(makeEvent("pointerup", {
    pointerId: 70,
    pointerType: "mouse",
    clientX: 80,
    clientY: 70,
  }));
  assert.equal(harness.calls.beginSpatialBlur.length, 1);
  assert.equal(harness.calls.updateSpatialBlur.length, 1);
  assert.deepEqual(harness.calls.endSpatialBlur.map(({ commit }) => commit), [true]);

  harness.canvas.dispatchEvent(makeEvent("pointerdown", {
    pointerId: 71,
    pointerType: "touch",
    clientX: 40,
    clientY: 40,
  }));
  harness.canvas.dispatchEvent(makeEvent("pointermove", {
    pointerId: 71,
    pointerType: "touch",
    clientX: 40,
    clientY: 25,
  }));
  harness.canvas.dispatchEvent(makeEvent("pointerdown", {
    pointerId: 72,
    pointerType: "touch",
    clientX: 90,
    clientY: 40,
  }));
  assert.equal(harness.controller.pointerMode, "touch-navigation");
  assert.equal(harness.calls.cancelSpatialBlurForNavigation, 1);
  assert.equal(harness.calls.vectorBegin, 1);
  harness.canvas.dispatchEvent(makeEvent("pointerup", {
    pointerId: 72,
    pointerType: "touch",
  }));
  harness.canvas.dispatchEvent(makeEvent("pointerup", {
    pointerId: 71,
    pointerType: "touch",
  }));
  assert.equal(harness.calls.endSpatialBlur.length, 1,
    "navigation promotion must not commit the provisional point gesture");
  assert.equal(harness.calls.vectorEnd, 1);
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
