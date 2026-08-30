import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const workspaceUrl = new URL("../", import.meta.url);
const workspaceRoot = fileURLToPath(workspaceUrl);
const readSource = (path) => readFileSync(new URL(path, workspaceUrl), "utf8");

const controllerSource = readSource("src/mixed-scene-controller.ts");
const engineTypesSource = readSource("src/engine-types.ts");
const brushEngineSource = readSource("src/brush-engine.ts");
const rasterRuntimeSource = readSource("src/engine-raster-transform-runtime.ts");
const mixedNodeSource = readSource("src/mixed-scene-node.ts");
const rendererSource = readSource("src/canvas-guides-renderer.ts");

const moduleServer = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: workspaceRoot,
  server: { middlewareMode: true },
});

let resolveSceneTranslationSnap;
let resolveSceneScaleSnap;
let resolveSceneRotationSnap;
let sceneBoundsSnapTargets;
let sceneIndexedSnapTargets;
let sceneDocumentSnapTargets;
let scenePointCloudBounds;
let sceneQuantizeAbsoluteRotation;
let sceneTransformedAxisAlignedBounds;
let sceneWrappedAngleDelta;
let adaptiveCanvasGridStep;
let renderCanvasGuides;
try {
  ({
    resolveSceneTranslationSnap,
    resolveSceneScaleSnap,
    resolveSceneRotationSnap,
    sceneBoundsSnapTargets,
    sceneIndexedSnapTargets,
    sceneDocumentSnapTargets,
    scenePointCloudBounds,
    sceneQuantizeAbsoluteRotation,
    sceneTransformedAxisAlignedBounds,
    sceneWrappedAngleDelta,
  } = await moduleServer.ssrLoadModule("/src/scene-transform-snap.ts"));
  ({
    adaptiveCanvasGridStep,
    renderCanvasGuides,
  } = await moduleServer.ssrLoadModule("/src/canvas-guides-renderer.ts"));
} finally {
  await moduleServer.close();
}

function view(overrides = {}) {
  const rotationRadians = overrides.rotationRadians ?? 0;
  return {
    canvasWidth: 1000,
    canvasHeight: 800,
    cssWidth: 1000,
    cssHeight: 800,
    centerX: 0,
    centerY: 0,
    zoom: 1,
    rotationRadians,
    rotationCos: Math.cos(rotationRadians),
    rotationSin: Math.sin(rotationRadians),
    ...overrides,
  };
}

function closeTo(actual, expected, message, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${message}: expected ${expected}, received ${actual}`,
  );
}

function axisMatch(result, axis) {
  return result.matches.find((match) => match.axis === axis) ?? null;
}

const identityView = view();

// Document guides: the moving left edge enters the six-CSS-pixel magnet.
const documentSnap = resolveSceneTranslationSnap({
  startBounds: { left: 10, top: 22, right: 30, bottom: 30 },
  rawDelta: { x: -5.5, y: 0.2 },
  targets: sceneDocumentSnapTargets(100, 80),
  view: identityView,
});
assert.deepEqual(documentSnap.delta, { x: -10, y: 0.2 });
assert.deepEqual(axisMatch(documentSnap, "x"), {
  axis: "x",
  position: 0,
  kind: "document",
  anchor: "start",
  key: undefined,
});

// Layer guides include edge-to-edge adjacency and retain the target identity.
const layerSnap = resolveSceneTranslationSnap({
  startBounds: { left: 10, top: 22, right: 30, bottom: 30 },
  rawDelta: { x: 65.5, y: 0 },
  targets: sceneBoundsSnapTargets({
    left: 100,
    top: 200,
    right: 120,
    bottom: 220,
  }, "raster:7"),
  view: identityView,
});
assert.equal(layerSnap.delta.x, 70);
assert.deepEqual(axisMatch(layerSnap, "x"), {
  axis: "x",
  position: 100,
  kind: "layer",
  anchor: "end",
  key: "raster:7",
});

// Grid snapping must preserve fractional document coordinates.
const gridSnap = resolveSceneTranslationSnap({
  startBounds: { left: 0.25, top: 0.25, right: 2.25, bottom: 2.25 },
  rawDelta: { x: 1.999, y: 0.125 },
  targets: [],
  gridStep: 2.5,
  view: identityView,
});
closeTo(gridSnap.delta.x, 2.25, "fractional grid delta");
assert.deepEqual(axisMatch(gridSnap, "x"), {
  axis: "x",
  position: 2.5,
  kind: "grid",
  anchor: "start",
});
const translationGridLatchDisabled = resolveSceneTranslationSnap({
  startBounds: { left: 0.25, top: 0.25, right: 2.25, bottom: 2.25 },
  rawDelta: { x: 1.999, y: 0.125 },
  targets: [],
  gridStep: null,
  view: identityView,
  previous: gridSnap.latch,
});
assert.deepEqual(
  translationGridLatchDisabled.delta,
  { x: 1.999, y: 0.125 },
  "disabled grid must clear a translation latch",
);
assert.deepEqual(translationGridLatchDisabled.matches, []);

const fractionalSnap = resolveSceneTranslationSnap({
  startBounds: { left: 1.125, top: 40, right: 3.125, bottom: 44 },
  rawDelta: { x: 12.1, y: -0.375 },
  targets: [{ axis: "x", position: 13.375, kind: "layer", key: "text:4" }],
  view: identityView,
});
closeTo(fractionalSnap.delta.x, 12.25, "fractional layer delta");
closeTo(fractionalSnap.delta.y, -0.375, "unmatched fractional axis");
closeTo(axisMatch(fractionalSnap, "x").position, 13.375, "fractional guide");

// Alt is wired to `disabled`: it must clear both matches and hysteresis state.
const bypassed = resolveSceneTranslationSnap({
  startBounds: { left: 1.125, top: 40, right: 3.125, bottom: 44 },
  rawDelta: { x: 12.1, y: -0.375 },
  targets: [{ axis: "x", position: 13.375, kind: "layer" }],
  view: identityView,
  previous: fractionalSnap.latch,
  disabled: true,
});
assert.deepEqual(bypassed.delta, { x: 12.1, y: -0.375 });
assert.deepEqual(bypassed.matches, []);
assert.deepEqual(bypassed.latch, { x: null, y: null });

// Default hysteresis is exactly enter <= 6 CSS px and release <= 10 CSS px.
const hysteresisInput = {
  startBounds: { left: 0, top: 20, right: 10, bottom: 30 },
  targets: [{ axis: "x", position: 100, kind: "layer", key: "raster:8" }],
  view: identityView,
};
const acquired = resolveSceneTranslationSnap({
  ...hysteresisInput,
  rawDelta: { x: 84, y: 0 },
});
assert.equal(acquired.delta.x, 90, "six CSS pixels must acquire");
assert.equal(axisMatch(acquired, "x")?.anchor, "end");

const notAcquiredWithoutLatch = resolveSceneTranslationSnap({
  ...hysteresisInput,
  rawDelta: { x: 80, y: 0 },
});
assert.equal(notAcquiredWithoutLatch.delta.x, 80);
assert.equal(axisMatch(notAcquiredWithoutLatch, "x"), null);

const held = resolveSceneTranslationSnap({
  ...hysteresisInput,
  rawDelta: { x: 80, y: 0 },
  previous: acquired.latch,
});
assert.equal(held.delta.x, 90, "ten CSS pixels must retain the latch");
assert.equal(axisMatch(held, "x")?.key, "raster:8");

const released = resolveSceneTranslationSnap({
  ...hysteresisInput,
  rawDelta: { x: 79.999, y: 0 },
  previous: acquired.latch,
});
assert.equal(released.delta.x, 79.999, "more than ten CSS pixels must release");
assert.equal(axisMatch(released, "x"), null);

// One combined case proves that threshold distance uses zoom, camera rotation,
// and the independent horizontal/vertical backing ratios. At 90 degrees an X
// correction lands entirely on the Y backing scale: 11 layer px become 5.5 CSS px.
const rotatedNonUniformView = view({
  canvasWidth: 2000,
  canvasHeight: 1200,
  cssWidth: 1000,
  cssHeight: 300,
  zoom: 2,
  rotationRadians: Math.PI * 0.5,
});
const rotatedInside = resolveSceneTranslationSnap({
  startBounds: { left: 0, top: 0, right: 10, bottom: 10 },
  rawDelta: { x: 79, y: 30 },
  targets: [{ axis: "x", position: 100, kind: "document" }],
  view: rotatedNonUniformView,
});
assert.equal(rotatedInside.delta.x, 90);
assert.equal(axisMatch(rotatedInside, "x")?.kind, "document");

const rotatedOutside = resolveSceneTranslationSnap({
  startBounds: { left: 0, top: 0, right: 10, bottom: 10 },
  rawDelta: { x: 77, y: 30 },
  targets: [{ axis: "x", position: 100, kind: "document" }],
  view: rotatedNonUniformView,
});
assert.equal(rotatedOutside.delta.x, 77);
assert.equal(axisMatch(rotatedOutside, "x"), null);

// A one-pixel selection cannot realize a half-pixel target. It may quantize the
// raw move, but it must not publish a false smart guide.
const impossibleSelectionGuide = resolveSceneTranslationSnap({
  startBounds: { left: 0, top: 20, right: 2, bottom: 22 },
  rawDelta: { x: 9.8, y: 0 },
  targets: [{ axis: "x", position: 10.5, kind: "layer", key: "raster:9" }],
  view: identityView,
  quantizeStep: 1,
});
assert.equal(impossibleSelectionGuide.delta.x, 10);
assert.equal(axisMatch(impossibleSelectionGuide, "x"), null);
assert.deepEqual(impossibleSelectionGuide.matches, []);

const realizableSelectionGuide = resolveSceneTranslationSnap({
  startBounds: { left: 0, top: 20, right: 2, bottom: 22 },
  rawDelta: { x: 9.8, y: 0 },
  targets: [{ axis: "x", position: 11, kind: "layer", key: "raster:9" }],
  view: identityView,
  quantizeStep: 1,
});
assert.equal(realizableSelectionGuide.delta.x, 10);
assert.equal(axisMatch(realizableSelectionGuide, "x")?.anchor, "center");

const indexedTargets = sceneIndexedSnapTargets([
  { axis: "x", position: 20, kind: "layer", key: "later" },
  { axis: "x", position: 20, kind: "document" },
  { axis: "x", position: 10, kind: "layer", key: "first" },
  { axis: "y", position: 5, kind: "layer", key: "vertical" },
  { axis: "y", position: 5, kind: "layer", key: "duplicate" },
]);
assert.deepEqual(indexedTargets, {
  x: [
    { axis: "x", position: 10, kind: "layer", key: "first" },
    { axis: "x", position: 20, kind: "document" },
  ],
  y: [{ axis: "y", position: 5, kind: "layer", key: "vertical" }],
});

let indexedTargetReads = 0;
const denseAxisTargets = Array.from({ length: 4096 }, (_, index) => ({
  axis: "x",
  position: index * 10,
  kind: "layer",
  key: `dense:${index}`,
}));
const observedDenseTargets = new Proxy(denseAxisTargets, {
  get(target, property, receiver) {
    if (typeof property === "string" && /^\d+$/.test(property)) indexedTargetReads += 1;
    return Reflect.get(target, property, receiver);
  },
});
const indexedTranslation = resolveSceneTranslationSnap({
  startBounds: { left: 0, top: 0, right: 10, bottom: 10 },
  rawDelta: { x: 139, y: 0 },
  targets: { x: observedDenseTargets, y: [] },
  view: identityView,
});
assert.equal(indexedTranslation.delta.x, 140);
assert.ok(
  indexedTargetReads < 100,
  `indexed live lookup must stay logarithmic; observed ${indexedTargetReads} reads`,
);

// Uniform resize snaps the corner being dragged, without moving the pivot or
// pretending that the stationary center is a grid contact.
const rawFortyTwoDegrees = 42 * Math.PI / 180;
const scaleSnapInput = {
  transform: { x: 100, y: 100, scale: 1, rotation: 0 },
  localBounds: { left: -16, top: -10, right: 20, bottom: 10 },
  handle: "south-east",
  targets: [],
  gridStep: 50,
  view: identityView,
};
const scaleGridSnap = resolveSceneScaleSnap({
  ...scaleSnapInput,
  rawScale: 2.45,
});
closeTo(scaleGridSnap.scale, 2.5, "resize grid scale");
assert.deepEqual(scaleGridSnap.matches, [{
  axis: "x",
  position: 150,
  kind: "grid",
  anchor: "end",
}]);
assert.equal(
  100 + scaleGridSnap.scale * scaleSnapInput.localBounds.right,
  150,
  "the dragged corner must land exactly on the grid",
);

const rotatedScaleGridSnap = resolveSceneScaleSnap({
  ...scaleSnapInput,
  transform: { ...scaleSnapInput.transform, rotation: Math.PI * 0.5 },
  rawScale: 2.45,
});
closeTo(rotatedScaleGridSnap.scale, 2.5, "rotated resize grid scale");
assert.deepEqual(rotatedScaleGridSnap.matches, [{
  axis: "y",
  position: 150,
  kind: "grid",
  anchor: "end",
}]);

const northSideScaleGridSnap = resolveSceneScaleSnap({
  ...scaleSnapInput,
  handle: "north",
  rawScale: 4.9,
});
closeTo(northSideScaleGridSnap.scale, 5, "north side resize grid scale");
assert.deepEqual(northSideScaleGridSnap.matches, [{
  axis: "y",
  position: 50,
  kind: "grid",
  anchor: "start",
}]);

const scaleLayerSnap = resolveSceneScaleSnap({
  ...scaleSnapInput,
  rawScale: 2.45,
  gridStep: null,
  targets: [{ axis: "x", position: 150, kind: "layer", key: "text:4" }],
});
closeTo(scaleLayerSnap.scale, 2.5, "resize layer scale");
assert.equal(scaleLayerSnap.matches[0]?.key, "text:4");

const scaleBypassed = resolveSceneScaleSnap({
  ...scaleSnapInput,
  rawScale: 2.45,
  previous: scaleGridSnap.latch,
  disabled: true,
});
closeTo(scaleBypassed.scale, 2.45, "Alt resize bypass");
assert.deepEqual(scaleBypassed.matches, []);
assert.equal(scaleBypassed.latch, null);

const scaleHeld = resolveSceneScaleSnap({
  ...scaleSnapInput,
  rawScale: 2.06,
  previous: scaleGridSnap.latch,
});
closeTo(scaleHeld.scale, 2.5, "resize release hysteresis");
const scaleReleased = resolveSceneScaleSnap({
  ...scaleSnapInput,
  rawScale: 2,
  previous: scaleGridSnap.latch,
});
closeTo(scaleReleased.scale, 2, "resize latch release");

const scaleOutsideVisualThreshold = resolveSceneScaleSnap({
  ...scaleSnapInput,
  rawScale: 2.2,
});
closeTo(scaleOutsideVisualThreshold.scale, 2.2, "resize visual threshold outside");
const scaleInsideAtHalfZoom = resolveSceneScaleSnap({
  ...scaleSnapInput,
  rawScale: 2.2,
  view: view({ zoom: 0.5 }),
});
closeTo(scaleInsideAtHalfZoom.scale, 2.5, "resize visual threshold at half zoom");

const scaleInteriorCorner = resolveSceneScaleSnap({
  transform: { x: 100, y: 100, scale: 1, rotation: rawFortyTwoDegrees },
  localBounds: { left: -10, top: -10, right: 10, bottom: 10 },
  handle: "south-east",
  rawScale: 1.8,
  targets: [{ axis: "x", position: 101.5, kind: "layer", key: "inside" }],
  view: identityView,
});
closeTo(scaleInteriorCorner.scale, 1.8, "resize interior corner rejection");
assert.deepEqual(scaleInteriorCorner.matches, []);

const scaleGridLatchDisabled = resolveSceneScaleSnap({
  ...scaleSnapInput,
  rawScale: 2.45,
  gridStep: null,
  previous: scaleGridSnap.latch,
});
closeTo(scaleGridLatchDisabled.scale, 2.45, "disabled grid clears resize latch");
assert.equal(scaleGridLatchDisabled.latch, null);

// Rotation snaps a true outside support corner to a grid line. A corner lying
// inside the rotated AABB is deliberately rejected because that line would cut
// through the object instead of touching it.
const rotationGridSnap = resolveSceneRotationSnap({
  transform: { x: 100, y: 100, scale: 1, rotation: 0 },
  localBounds: { left: -10, top: -10, right: 10, bottom: 10 },
  rawRotation: rawFortyTwoDegrees,
  handleRadius: 50,
  handleAngle: rawFortyTwoDegrees,
  targets: [],
  gridStep: 2,
  view: identityView,
});
closeTo(
  rotationGridSnap.rotation,
  Math.atan2(0.6, 0.8),
  "rotation support contact",
);
assert.equal(rotationGridSnap.matches[0]?.kind, "grid");
assert.equal(rotationGridSnap.matches[0]?.axis, "x");
assert.equal(rotationGridSnap.matches[0]?.position, 114);
assert.equal(rotationGridSnap.matches[0]?.anchor, "end");

const falseInteriorContact = resolveSceneRotationSnap({
  transform: { x: 100, y: 100, scale: 1, rotation: 0 },
  localBounds: { left: -10, top: -10, right: 10, bottom: 10 },
  rawRotation: rawFortyTwoDegrees,
  handleRadius: 50,
  handleAngle: rawFortyTwoDegrees,
  targets: [{ axis: "x", position: 100, kind: "layer", key: "inside" }],
  view: identityView,
});
closeTo(falseInteriorContact.rotation, rawFortyTwoDegrees, "interior guide rejection");
assert.deepEqual(falseInteriorContact.matches, []);

const rotationFarHandleNoSnap = resolveSceneRotationSnap({
  transform: { x: 100, y: 100, scale: 1, rotation: 0 },
  localBounds: { left: -10, top: -10, right: 10, bottom: 10 },
  rawRotation: rawFortyTwoDegrees,
  handleRadius: 100,
  handleAngle: rawFortyTwoDegrees,
  targets: [],
  gridStep: 2,
  view: identityView,
});
closeTo(
  rotationFarHandleNoSnap.rotation,
  rawFortyTwoDegrees,
  "rotation threshold follows the dragged handle",
);

const wideRawRotation = 45 * Math.PI / 180;
const wideContactRotation = 42 * Math.PI / 180;
const wideContactTarget = 2000 * Math.cos(wideContactRotation)
  + 50 * Math.sin(wideContactRotation);
const wideRotationContact = resolveSceneRotationSnap({
  transform: { x: 0, y: 0, scale: 1, rotation: 0 },
  localBounds: { left: -2000, top: -50, right: 2000, bottom: 50 },
  rawRotation: wideRawRotation,
  handleRadius: 88,
  handleAngle: wideRawRotation,
  targets: [{ axis: "x", position: wideContactTarget, kind: "layer", key: "wide" }],
  view: identityView,
});
closeTo(
  wideRotationContact.rotation,
  wideContactRotation,
  "wide rotation contact must use the handle threshold",
);

const nonUniformContactRotation = 42 * Math.PI / 180;
const nonUniformRotationContact = resolveSceneRotationSnap({
  transform: {
    x: 0,
    y: 0,
    scale: 1,
    scaleX: 2,
    scaleY: 0.5,
    rotation: 0,
  },
  localBounds: { left: -10, top: -10, right: 10, bottom: 10 },
  rawRotation: wideRawRotation,
  handleRadius: 50,
  handleAngle: wideRawRotation,
  targets: [{
    axis: "x",
    position: 20 * Math.cos(nonUniformContactRotation)
      + 5 * Math.sin(nonUniformContactRotation),
    kind: "layer",
    key: "non-uniform",
  }],
  view: identityView,
});
closeTo(
  nonUniformRotationContact.rotation,
  nonUniformContactRotation,
  "rotation contact respects independent axis scales",
);

const rotationLayerInput = {
  transform: { x: 100, y: 100, scale: 1, rotation: 0 },
  localBounds: { left: -10, top: -10, right: 10, bottom: 10 },
  targets: [{ axis: "x", position: 114, kind: "layer", key: "text:4" }],
  handleRadius: 50,
  view: identityView,
};
const rotationLayerSnap = resolveSceneRotationSnap({
  ...rotationLayerInput,
  rawRotation: rawFortyTwoDegrees,
  handleAngle: rawFortyTwoDegrees,
});
closeTo(
  rotationLayerSnap.rotation,
  Math.atan2(0.6, 0.8),
  "rotation layer contact",
);
const rawFortyFourDegrees = 44 * Math.PI / 180;
const rotationLayerNotAcquired = resolveSceneRotationSnap({
  ...rotationLayerInput,
  rawRotation: rawFortyFourDegrees,
  handleAngle: rawFortyFourDegrees,
});
closeTo(rotationLayerNotAcquired.rotation, rawFortyFourDegrees, "rotation enter threshold");
const rotationLayerHeld = resolveSceneRotationSnap({
  ...rotationLayerInput,
  rawRotation: rawFortyFourDegrees,
  handleAngle: rawFortyFourDegrees,
  previous: rotationLayerSnap.latch,
});
closeTo(
  rotationLayerHeld.rotation,
  rotationLayerSnap.rotation,
  "rotation release hysteresis",
);
const rawFortyNineDegrees = 49 * Math.PI / 180;
const rotationLayerReleased = resolveSceneRotationSnap({
  ...rotationLayerInput,
  rawRotation: rawFortyNineDegrees,
  handleAngle: rawFortyNineDegrees,
  previous: rotationLayerSnap.latch,
});
assert.notEqual(
  rotationLayerReleased.rotation,
  rotationLayerSnap.rotation,
  "rotation must release the old contact after ten CSS pixels",
);

const rotationGridLatchDisabled = resolveSceneRotationSnap({
  transform: { x: 100, y: 100, scale: 1, rotation: 0 },
  localBounds: { left: -10, top: -10, right: 10, bottom: 10 },
  rawRotation: rawFortyTwoDegrees,
  handleRadius: 50,
  handleAngle: rawFortyTwoDegrees,
  targets: [],
  gridStep: null,
  view: identityView,
  previous: rotationGridSnap.latch,
});
closeTo(
  rotationGridLatchDisabled.rotation,
  rawFortyTwoDegrees,
  "disabled grid clears rotation latch",
);
assert.equal(rotationGridLatchDisabled.latch, null);

closeTo(
  sceneWrappedAngleDelta(-179 * Math.PI / 180, 179 * Math.PI / 180),
  2 * Math.PI / 180,
  "rotation pointer wrap",
);
let accumulatedTurn = 0;
let previousPointerAngle = 170 * Math.PI / 180;
for (const degrees of [-170, -10, 170, -170]) {
  const nextPointerAngle = degrees * Math.PI / 180;
  accumulatedTurn += sceneWrappedAngleDelta(nextPointerAngle, previousPointerAngle);
  previousPointerAngle = nextPointerAngle;
}
closeTo(accumulatedTurn, 380 * Math.PI / 180, "rotation multi-turn accumulation");

for (const [degrees, expected] of [
  [0, 0],
  [22, 0],
  [23, 45],
  [44, 45],
  [67, 45],
  [68, 90],
  [-47, -45],
  [401, 405],
]) {
  closeTo(
    sceneQuantizeAbsoluteRotation(degrees * Math.PI / 180),
    expected * Math.PI / 180,
    `absolute 45 degree rotation constraint for ${degrees}`,
  );
}
assert.throws(
  () => sceneQuantizeAbsoluteRotation(1, 0),
  /positive step/,
  "rotation constraint rejects a zero step",
);
assert.throws(
  () => sceneQuantizeAbsoluteRotation(Number.NaN),
  /finite/,
  "rotation constraint rejects a non-finite angle",
);

const rotationBypassed = resolveSceneRotationSnap({
  transform: { x: 100, y: 100, scale: 1, rotation: 0 },
  localBounds: { left: -10, top: -10, right: 10, bottom: 10 },
  rawRotation: rawFortyTwoDegrees,
  handleRadius: 50,
  handleAngle: rawFortyTwoDegrees,
  targets: [],
  gridStep: 2,
  view: identityView,
  previous: rotationGridSnap.latch,
  disabled: true,
});
closeTo(rotationBypassed.rotation, rawFortyTwoDegrees, "Alt rotation bypass");
assert.equal(rotationBypassed.latch, null);

// Geometry helpers retain subpixels and produce the raw, un-clipped AABB used
// by both raster and semantic Transform interactions.
assert.deepEqual(scenePointCloudBounds([
  { x: -1.25, y: 8.5 },
  { x: 4.75, y: -3.125 },
]), { left: -1.25, top: -3.125, right: 4.75, bottom: 8.5 });
const rotatedBounds = sceneTransformedAxisAlignedBounds(
  { left: -1, top: -2, right: 1, bottom: 2 },
  { x: 10, y: 20, scale: 2, rotation: Math.PI * 0.5 },
);
closeTo(rotatedBounds.left, 6, "rotated bounds left");
closeTo(rotatedBounds.top, 18, "rotated bounds top");
closeTo(rotatedBounds.right, 14, "rotated bounds right");
closeTo(rotatedBounds.bottom, 22, "rotated bounds bottom");

// Adaptive grid spacing stays screen-readable at every zoom and backing ratio.
assert.equal(adaptiveCanvasGridStep(identityView), 100);
assert.equal(adaptiveCanvasGridStep(view({ zoom: 2 })), 50);
assert.equal(adaptiveCanvasGridStep(view({ zoom: 0.25 })), 500);
assert.equal(adaptiveCanvasGridStep(rotatedNonUniformView), 200);

class RecordingCanvasContext {
  strokeCount = 0;
  clipCount = 0;
  clearCount = 0;
  points = [];
  transforms = [];
  fills = [];

  save() {}
  restore() {}
  setTransform(...values) { this.transforms.push(values); }
  beginPath() {}
  closePath() {}
  clip() { this.clipCount += 1; }
  setLineDash() {}
  fillRect(...values) { this.fills.push(values); }
  strokeRect() {}
  fillText() {}
  moveTo(x, y) { this.points.push([x, y]); }
  lineTo(x, y) { this.points.push([x, y]); }
  stroke() { this.strokeCount += 1; }
  clearRect() { this.clearCount += 1; }
}

const pixelGridPreferences = {
  rulers: false,
  grid: false,
  pixelGrid: true,
  snapping: true,
  symmetryEnabled: false,
  symmetryAngleDegrees: 90,
};

// The document-pixel grid shares the exact 581% raster pixel-view threshold.
const belowPixelGridCanvas = { width: 800, height: 600, hidden: false };
const belowPixelGridContext = new RecordingCanvasContext();
renderCanvasGuides({
  canvas: belowPixelGridCanvas,
  context: belowPixelGridContext,
  view: view({ zoom: 5.8099 }),
  documentWidth: 8,
  documentHeight: 6,
  preferences: pixelGridPreferences,
});
assert.equal(belowPixelGridCanvas.hidden, true);
assert.equal(belowPixelGridCanvas.width, 1);
assert.equal(belowPixelGridCanvas.height, 1);
assert.equal(belowPixelGridContext.strokeCount, 0);

const exactPixelGridView = view({
  canvasWidth: 100,
  canvasHeight: 80,
  cssWidth: 100,
  cssHeight: 80,
  centerX: 4,
  centerY: 3,
  zoom: 5.81,
  rotationRadians: Math.PI / 8,
});
const exactPixelGridCanvas = { width: 1, height: 1, hidden: true };
const exactPixelGridContext = new RecordingCanvasContext();
renderCanvasGuides({
  canvas: exactPixelGridCanvas,
  context: exactPixelGridContext,
  view: exactPixelGridView,
  documentWidth: 8,
  documentHeight: 6,
  preferences: pixelGridPreferences,
});
assert.equal(exactPixelGridCanvas.hidden, false);
assert.equal(exactPixelGridCanvas.width, 100);
assert.equal(exactPixelGridCanvas.height, 80);
assert.equal(exactPixelGridContext.strokeCount, 1, "pixel lines must share one stroke");
assert.equal(exactPixelGridContext.clipCount, 1);
assert.equal(exactPixelGridContext.strokeStyle, "rgba(132, 136, 144, 0.46)");
assert.equal(exactPixelGridContext.points.length, 36);
assertPointClose(
  exactPixelGridContext.points[4],
  projectedDocumentPoint({ x: 0, y: 0 }, exactPixelGridView),
  "rotated pixel grid first line start",
);
assertPointClose(
  exactPixelGridContext.points[5],
  projectedDocumentPoint({ x: 0, y: 6 }, exactPixelGridView),
  "rotated pixel grid first line end",
);

const disabledPixelGridCanvas = { width: 800, height: 600, hidden: false };
const disabledPixelGridContext = new RecordingCanvasContext();
renderCanvasGuides({
  canvas: disabledPixelGridCanvas,
  context: disabledPixelGridContext,
  view: exactPixelGridView,
  documentWidth: 8,
  documentHeight: 6,
  preferences: { ...pixelGridPreferences, pixelGrid: false },
});
assert.equal(disabledPixelGridCanvas.hidden, true);
assert.equal(disabledPixelGridContext.strokeCount, 0);

const cappedPixelGridCanvas = { width: 1, height: 1, hidden: true };
const cappedPixelGridContext = new RecordingCanvasContext();
renderCanvasGuides({
  canvas: cappedPixelGridCanvas,
  context: cappedPixelGridContext,
  view: view({
    canvasWidth: 1_000_000_000,
    canvasHeight: 1_000_000_000,
    cssWidth: 1000,
    cssHeight: 1000,
    centerX: 500_000_000,
    centerY: 500_000_000,
    zoom: 5.81,
  }),
  documentWidth: 1_000_000_000,
  documentHeight: 1_000_000_000,
  preferences: pixelGridPreferences,
});
assert.equal(cappedPixelGridCanvas.hidden, false);
assert.equal(cappedPixelGridContext.strokeCount, 0, "oversized pixel grids must be skipped");
assert.match(rendererSource, /preferences\.pixelGrid\s*&&\s*rasterPixelViewEnabled\(view\.zoom\)/);
assert.match(rendererSource, /const MAX_PIXEL_GRID_LINES_PER_AXIS = 4096/);

// Even an adversarial billion-CSS-pixel viewport is capped to 512 lines/axis.
const hugeCanvas = { width: 1_000_000_000, height: 1_000_000_000, hidden: true };
const hugeContext = new RecordingCanvasContext();
renderCanvasGuides({
  canvas: hugeCanvas,
  context: hugeContext,
  view: view({
    canvasWidth: 1_000_000_000,
    canvasHeight: 1_000_000_000,
    cssWidth: 1_000_000_000,
    cssHeight: 1_000_000_000,
    centerX: 500_000_000,
    centerY: 500_000_000,
  }),
  documentWidth: 1_000_000_000,
  documentHeight: 1_000_000_000,
  preferences: { rulers: false, grid: true, pixelGrid: false, snapping: true },
});
assert.equal(hugeCanvas.hidden, false);
assert.equal(hugeContext.strokeCount, 1024, "grid must draw at most 512 lines per axis");

// Smart guides remain independently visible when rulers and grid are disabled.
const guideCanvas = { width: 1000, height: 800, hidden: true };
const guideContext = new RecordingCanvasContext();
renderCanvasGuides({
  canvas: guideCanvas,
  context: guideContext,
  view: identityView,
  documentWidth: 100,
  documentHeight: 80,
  preferences: { rulers: false, grid: false, pixelGrid: false, snapping: true },
  smartGuides: [{
    axis: "x",
    position: 13.375,
    kind: "layer",
    anchor: "start",
    key: "text:4",
  }],
});
assert.equal(guideCanvas.hidden, false);
assert.equal(guideContext.strokeCount, 1);
assert.ok(guideContext.points.flat().every(Number.isFinite));

function projectedDocumentPoint(point, targetView) {
  const deltaX = point.x - targetView.centerX;
  const deltaY = point.y - targetView.centerY;
  return {
    x: targetView.canvasWidth * 0.5 + targetView.zoom * (
      targetView.rotationCos * deltaX - targetView.rotationSin * deltaY
    ),
    y: targetView.canvasHeight * 0.5 + targetView.zoom * (
      targetView.rotationSin * deltaX + targetView.rotationCos * deltaY
    ),
  };
}

function assertPointClose(actual, expected, label) {
  closeTo(actual[0], expected.x, `${label} x`);
  closeTo(actual[1], expected.y, `${label} y`);
}

// Symmetry alone keeps the overlay alive. Its axis is authored in document
// space, so zoom, pan and view rotation affect the two clipped endpoints.
const verticalSymmetryView = view({
  canvasWidth: 1600,
  canvasHeight: 1000,
  cssWidth: 800,
  cssHeight: 500,
  centerX: 430,
  centerY: 315,
  zoom: 1.75,
  rotationRadians: Math.PI / 6,
});
const verticalSymmetryCanvas = { width: 1, height: 1, hidden: true };
const verticalSymmetryContext = new RecordingCanvasContext();
renderCanvasGuides({
  canvas: verticalSymmetryCanvas,
  context: verticalSymmetryContext,
  view: verticalSymmetryView,
  documentWidth: 1201,
  documentHeight: 801,
  preferences: {
    rulers: false,
    grid: false,
    pixelGrid: false,
    snapping: false,
    symmetryEnabled: true,
    symmetryAngleDegrees: 90,
  },
});
assert.equal(verticalSymmetryCanvas.hidden, false);
assert.equal(verticalSymmetryCanvas.width, 800);
assert.equal(verticalSymmetryCanvas.height, 500);
assert.equal(verticalSymmetryContext.strokeCount, 1);
assert.equal(verticalSymmetryContext.clipCount, 1);
assert.equal(verticalSymmetryContext.strokeStyle, "#dd5c35");
assertPointClose(
  verticalSymmetryContext.points.at(-2),
  projectedDocumentPoint({ x: 600.5, y: 0 }, verticalSymmetryView),
  "vertical symmetry start",
);
assertPointClose(
  verticalSymmetryContext.points.at(-1),
  projectedDocumentPoint({ x: 600.5, y: 801 }, verticalSymmetryView),
  "vertical symmetry end",
);

const horizontalSymmetryView = view({
  canvasWidth: 900,
  canvasHeight: 1400,
  cssWidth: 600,
  cssHeight: 700,
  centerX: 710,
  centerY: 180,
  zoom: 0.42,
  rotationRadians: -Math.PI / 3,
});
const horizontalSymmetryCanvas = { width: 1, height: 1, hidden: true };
const horizontalSymmetryContext = new RecordingCanvasContext();
renderCanvasGuides({
  canvas: horizontalSymmetryCanvas,
  context: horizontalSymmetryContext,
  view: horizontalSymmetryView,
  documentWidth: 1501,
  documentHeight: 901,
  preferences: {
    rulers: false,
    grid: false,
    pixelGrid: false,
    snapping: false,
    symmetryEnabled: true,
    symmetryAngleDegrees: 0,
  },
});
assert.equal(horizontalSymmetryCanvas.hidden, false);
assert.equal(horizontalSymmetryContext.strokeCount, 1);
assert.equal(horizontalSymmetryContext.clipCount, 1);
assertPointClose(
  horizontalSymmetryContext.points.at(-2),
  projectedDocumentPoint({ x: 0, y: 450.5 }, horizontalSymmetryView),
  "horizontal symmetry start",
);
assertPointClose(
  horizontalSymmetryContext.points.at(-1),
  projectedDocumentPoint({ x: 1501, y: 450.5 }, horizontalSymmetryView),
  "horizontal symmetry end",
);

const angledSymmetryCanvas = { width: 1, height: 1, hidden: true };
const angledSymmetryContext = new RecordingCanvasContext();
renderCanvasGuides({
  canvas: angledSymmetryCanvas,
  context: angledSymmetryContext,
  view: verticalSymmetryView,
  documentWidth: 1200,
  documentHeight: 800,
  preferences: {
    rulers: false,
    grid: false,
    pixelGrid: false,
    snapping: false,
    symmetryEnabled: true,
    symmetryAngleDegrees: 45,
  },
});
assert.equal(angledSymmetryContext.strokeCount, 1);
assert.equal(angledSymmetryContext.clipCount, 1);
assert.equal(angledSymmetryContext.strokeStyle, "#dd5c35");
assertPointClose(
  angledSymmetryContext.points.at(-2),
  projectedDocumentPoint({ x: 200, y: 0 }, verticalSymmetryView),
  "angled symmetry start",
);
assertPointClose(
  angledSymmetryContext.points.at(-1),
  projectedDocumentPoint({ x: 1000, y: 800 }, verticalSymmetryView),
  "angled symmetry end",
);

// Turning every guide off releases the viewport-sized Canvas2D backing store.
renderCanvasGuides({
  canvas: guideCanvas,
  context: guideContext,
  view: identityView,
  documentWidth: 100,
  documentHeight: 80,
  preferences: {
    rulers: false,
    grid: false,
    pixelGrid: false,
    snapping: false,
    symmetryEnabled: false,
    symmetryAngleDegrees: 90,
  },
});
assert.equal(guideCanvas.hidden, true);
assert.equal(guideCanvas.width, 1);
assert.equal(guideCanvas.height, 1);

// The overlay uses one backing pixel per CSS pixel and offsets rulers beyond
// the topbar/tool rail instead of allocating a full Retina viewport underneath.
const retinaCanvas = { width: 1, height: 1, hidden: true };
const retinaContext = new RecordingCanvasContext();
renderCanvasGuides({
  canvas: retinaCanvas,
  context: retinaContext,
  view: view({
    canvasWidth: 2000,
    canvasHeight: 1600,
    cssWidth: 1000,
    cssHeight: 800,
    zoom: 2,
  }),
  documentWidth: 100,
  documentHeight: 80,
  preferences: { rulers: true, grid: false, pixelGrid: false, snapping: true },
  viewportInsetsCss: { top: 52, left: 64 },
});
assert.equal(retinaCanvas.width, 1000);
assert.equal(retinaCanvas.height, 800);
assert.deepEqual(retinaContext.transforms.at(-1), [0.5, 0, 0, 0.5, 0, 0]);
assert.deepEqual(retinaContext.fills[0]?.slice(0, 2), [128, 104]);

// Static integration guards: targets and adaptive grid step are frozen once at
// pointerdown, while pointermove consumes only the interaction-owned snapshot.
const snapContextStart = controllerSource.indexOf("  private snapContextForInteraction(");
const eventCanvasPointStart = controllerSource.indexOf("  private eventCanvasPoint(", snapContextStart);
assert.ok(snapContextStart >= 0 && eventCanvasPointStart > snapContextStart);
const snapContextSource = controllerSource.slice(snapContextStart, eventCanvasPointStart);
assert.match(
  snapContextSource,
  /mode !== "move" && mode !== "scale" && mode !== "rotate"/,
);
assert.match(snapContextSource, /const localBounds = this\.localBoundsForTransformNode\(node\)/);
assert.match(snapContextSource, /startBounds: this\.transformNodeBounds\(node, localBounds\)/);
assert.match(snapContextSource, /localBounds,/);
assert.match(
  snapContextSource,
  /targets: sceneIndexedSnapTargets\(this\.snapTargetsForNode\(node\)\)/,
);
assert.match(snapContextSource, /gridStep: adaptiveCanvasGridStep\(view\)/);

const pointerDownStart = controllerSource.indexOf("  private onPointerDown(");
const movedDistortStart = controllerSource.indexOf("  private movedDistortPoints(", pointerDownStart);
assert.ok(pointerDownStart >= 0 && movedDistortStart > pointerDownStart);
const pointerDownSource = controllerSource.slice(pointerDownStart, movedDistortStart);
assert.match(pointerDownSource, /snap: this\.snapContextForInteraction\(mode, node, view, handle\)/);
assert.match(
  pointerDownSource,
  /rasterControlPointIndex === null[\s\S]*?&& handle === null[\s\S]*?&& event\.shiftKey/,
  "Shift-pan must not steal rotation or resize handles.",
);
assert.match(
  pointerDownSource,
  /this\.touchTransformModifierPointerId \?\?= event\.pointerId/,
  "A second touch must be captured as an explicit transform modifier.",
);
assert.match(
  pointerDownSource,
  /if \(!this\.touchConstraintApplies\(this\.activeInteraction\)\) \{[\s\S]*?this\.enterTouchNavigation\(\)/,
  "Two-touch view navigation must remain the fallback for unsupported transform interactions.",
);

const pointerMoveStart = controllerSource.indexOf("  private onPointerMove(");
const finishPointerStart = controllerSource.indexOf("  private finishPointer(", pointerMoveStart);
assert.ok(pointerMoveStart >= 0 && finishPointerStart > pointerMoveStart);
const pointerMoveSource = controllerSource.slice(pointerMoveStart, finishPointerStart);
assert.match(pointerMoveSource, /targets: interaction\.snap\.targets/);
assert.match(pointerMoveSource, /gridStep: preferences\?\.grid \? interaction\.snap\.gridStep : null/);
assert.match(pointerMoveSource, /disabled: preferences\?\.snapping !== true \|\| event\.altKey/);
assert.match(pointerMoveSource, /resolveSceneScaleSnap\(/);
assert.match(pointerMoveSource, /resolveSceneRotationSnap\(/);
assert.match(
  pointerMoveSource,
  /const constrained = event\.shiftKey \|\| this\.touchConstraintApplies\(interaction\)/,
  "Shift and the touch modifier must share the same transform constraint.",
);
assert.match(
  pointerMoveSource,
  /const angleIncrement = sceneWrappedAngleDelta\(angle, interaction\.lastAngle\)/,
);
assert.match(pointerMoveSource, /interaction\.accumulatedRotation \+= angleIncrement/);
assert.match(pointerMoveSource, /interaction\.lastAngle = angle/);
assert.match(pointerMoveSource, /handleRadius: interaction\.startDistance/);
assert.match(
  pointerMoveSource,
  /handleAngle: interaction\.startAngle \+ interaction\.accumulatedRotation/,
);
const moveSnapSource = pointerMoveSource.slice(
  pointerMoveSource.indexOf('if (interaction.mode === "move")'),
  pointerMoveSource.indexOf('} else if (interaction.mode === "scale")'),
);
const scaleSnapSource = pointerMoveSource.slice(
  pointerMoveSource.indexOf('} else if (interaction.mode === "scale")'),
  pointerMoveSource.indexOf('} else if (interaction.mode === "rotate")'),
);
const rotationSnapSource = pointerMoveSource.slice(
  pointerMoveSource.indexOf('} else if (interaction.mode === "rotate")'),
);
assert.match(
  rotationSnapSource,
  /constrained[\s\S]*?sceneQuantizeAbsoluteRotation\(rawRotation\)[\s\S]*?matches: \[\][\s\S]*?latch: null[\s\S]*?: interaction\.snap/,
  "The absolute angle constraint must override magnetic rotation snapping and clear its latch.",
);
for (const [name, source] of [
  ["move", moveSnapSource],
  ["scale", scaleSnapSource],
  ["rotation", rotationSnapSource],
]) {
  assert.match(
    source,
    /disabled: preferences\?\.snapping !== true \|\| event\.altKey/,
    `${name} must bypass snapping while Alt is held`,
  );
}
assert.doesNotMatch(pointerMoveSource, /this\.snapTargetsForNode\(|adaptiveCanvasGridStep\(/,
  "pointermove must not rescan scene geometry or recompute adaptive spacing");

// Native raster target visibility follows the public snapshot and every
// clipping ancestor; hidden/transparent parents cannot create magnetic lines.
assert.match(engineTypesSource, /rasterVisible: boolean;\s*rasterOpacity: number;/);
assert.match(brushEngineSource, /rasterVisible: record\.visible,\s*rasterOpacity: record\.opacity,/);
const rasterVisibilityStart = controllerSource.indexOf("  private rasterSnapTargetVisible(");
const snapTargetsStart = controllerSource.indexOf("  private snapTargetsForNode(", rasterVisibilityStart);
assert.ok(rasterVisibilityStart >= 0 && snapTargetsStart > rasterVisibilityStart);
const rasterVisibilitySource = controllerSource.slice(rasterVisibilityStart, snapTargetsStart);
assert.match(rasterVisibilitySource, /!item\.rasterVisible \|\| item\.rasterOpacity <= 0/);
assert.match(rasterVisibilitySource, /let parentId = item\.rasterClippingParentId/);
assert.match(rasterVisibilitySource, /while \(parentId !== null\)/);
assert.match(rasterVisibilitySource, /rasterItems\.get\(parentId\)/);
assert.match(rasterVisibilitySource, /!parent\.rasterVisible \|\| parent\.rasterOpacity <= 0/);
assert.match(controllerSource, /private rasterSnapTargetBounds\(/);
assert.match(controllerSource, /left: Math\.max\(bounds\.left, parentContent\.x\)/);
assert.match(controllerSource, /right: Math\.min\(bounds\.right, parentContent\.x \+ parentContent\.width\)/);

// The exact runtime pivot must survive every public/copy boundary and drive
// local raster bounds instead of silently recentering a clipped imported image.
assert.match(engineTypesSource, /sourcePivot\?: \{ x: number; y: number \};/);
const runtimeSnapshotStart = rasterRuntimeSource.indexOf("function transformSnapshot(");
const runtimeSnapshotEnd = rasterRuntimeSource.indexOf("async function createSharedResources(", runtimeSnapshotStart);
assert.ok(runtimeSnapshotStart >= 0 && runtimeSnapshotEnd > runtimeSnapshotStart);
assert.match(
  rasterRuntimeSource.slice(runtimeSnapshotStart, runtimeSnapshotEnd),
  /sourcePivot: \{ \.\.\.session\.sourcePivot \}/,
  "begin/update Raster Transform snapshots must expose the exact source pivot",
);
assert.match(brushEngineSource, /sourcePivot: \{ \.\.\.this\.activeRasterTransformSession\.sourcePivot \}/);
assert.match(mixedNodeSource, /sourcePivot: node\.sourcePivot \? \{ \.\.\.node\.sourcePivot \} : undefined/);
const selectedTransformStart = controllerSource.indexOf("  private selectedTransformNode(");
const prepareRasterStart = controllerSource.indexOf("  private prepareSelectedRasterTransform(", selectedTransformStart);
assert.ok(selectedTransformStart >= 0 && prepareRasterStart > selectedTransformStart);
assert.match(
  controllerSource.slice(selectedTransformStart, prepareRasterStart),
  /sourcePivot: transform\?\.sourcePivot\s*\? \{ \.\.\.transform\.sourcePivot \}/,
  "selected raster nodes must retain the runtime source pivot",
);
assert.match(controllerSource, /left: source\.x - pivot\.x,\s*top: source\.y - pivot\.y,/);

// Smart lines cannot outlive their gesture, selection or Transform tool.
const clearGuideCalls = controllerSource.match(
  /this\.canvasGuides\?\.setSmartGuides\(\[\]\)/g,
) ?? [];
assert.ok(clearGuideCalls.length >= 4, "all Transform terminal paths must clear smart guides");
assert.match(controllerSource, /if \(!active\) \{\s*this\.canvasGuides\?\.setSmartGuides\(\[\]\)/);
assert.match(controllerSource, /if \(!interactionStillTargetsSelection\) \{[\s\S]*?setSmartGuides\(\[\]\)/);
const clearInteractionStart = controllerSource.indexOf("  private clearActiveInteraction(");
const closeNoopStart = controllerSource.indexOf("  private closeNewNoopTransformSession(", clearInteractionStart);
assert.ok(clearInteractionStart >= 0 && closeNoopStart > clearInteractionStart);
assert.match(
  controllerSource.slice(clearInteractionStart, closeNoopStart),
  /this\.canvasGuides\?\.setSmartGuides\(\[\]\)/,
);

assert.match(rendererSource, /const MAX_GRID_LINES_PER_AXIS = 512/);
assert.match(rendererSource, /Math\.min\(MAX_GRID_LINES_PER_AXIS/);
