import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "vite";
import {
  RASTER_DEFORM_MAX_VERTICES,
  RASTER_DEFORM_VERTEX_FLOATS,
  RASTER_WARP_RENDER_SUBDIVISIONS,
  isRasterWarpGridSize,
  moveRasterWarpBezierHandle,
  moveRasterWarpControlPoints,
  normalizeRasterWarpBezierHandles,
  normalizeRasterDeformPoints,
  packRasterDeformVertices,
  rasterDeformBoundaryIndices,
  rasterDeformBounds,
  rasterDeformCenter,
  rasterDeformInitialPoints,
  rasterDeformIsIdentity,
  rasterDeformRenderedBounds,
  rasterPerspectiveWeights,
  rasterWarpBezierHandleAnchorIndex,
  rasterWarpClosestSurfaceParameter,
  rasterWarpCornerIndices,
  rasterWarpDefaultBezierHandles,
  remapRasterWarpBezierHandles,
  resampleRasterDeformGrid,
  sampleRasterWarpSurface,
  translateRasterDeformPoints,
} from "../src/raster-deform-math.ts";
import {
  RASTER_DEFORM_SHADER_STRATEGY,
  rasterDeformStoredEncodedShader,
  rasterDeformShader,
} from "../src/raster-deform-shader.ts";

const bounds = { x: 20, y: 30, width: 120, height: 80 };
const textureRect = { x: 0, y: 0, width: 160, height: 144 };

assert.equal(isRasterWarpGridSize(3), true);
assert.equal(isRasterWarpGridSize(4), true);
assert.equal(isRasterWarpGridSize(5), true);
assert.equal(isRasterWarpGridSize(2), false);
assert.equal(RASTER_DEFORM_MAX_VERTICES, 24576);

for (const gridSize of [3, 4, 5]) {
  const points = rasterDeformInitialPoints(bounds, "warp", gridSize);
  assert.equal(points.length, gridSize * gridSize);
  assert.deepEqual(points[0], { x: 20, y: 30 });
  assert.deepEqual(points.at(-1), { x: 140, y: 110 });
  assert.equal(rasterDeformIsIdentity(points, bounds, "warp", gridSize), true);
  const packed = packRasterDeformVertices(
    points,
    bounds,
    textureRect,
    "warp",
    gridSize,
  );
  assert.equal(
    packed.vertexCount,
    ((gridSize - 1) * RASTER_WARP_RENDER_SUBDIVISIONS) ** 2 * 6,
  );
  assert.equal(packed.data.length, packed.vertexCount * RASTER_DEFORM_VERTEX_FLOATS);
  for (let index = 4; index < packed.data.length; index += RASTER_DEFORM_VERTEX_FLOATS) {
    assert.equal(packed.data[index], 1, "Warp must use affine mesh weights");
  }
}

const identityFive = rasterDeformInitialPoints(bounds, "warp", 5);
const smoothIdentitySample = sampleRasterWarpSurface(identityFive, 5, 0.1375, 0.8125);
assert.ok(Math.abs(smoothIdentitySample.x - (bounds.x + bounds.width * 0.1375)) < 1e-9);
assert.ok(Math.abs(smoothIdentitySample.y - (bounds.y + bounds.height * 0.8125)) < 1e-9);

const bezierSource = rasterDeformInitialPoints(bounds, "warp", 4);
const defaultBezierHandles = rasterWarpDefaultBezierHandles(bezierSource, 4);
assert.equal(defaultBezierHandles.length, 8);
assert.ok(Math.abs(
  defaultBezierHandles[0].x
    - (bezierSource[0].x + (bezierSource[1].x - bezierSource[0].x) / 3),
) < 1e-9);
assert.ok(Math.abs(defaultBezierHandles[0].y - bezierSource[0].y) < 1e-9);
assert.equal(rasterWarpBezierHandleAnchorIndex(4, 0), 0);
assert.equal(rasterWarpBezierHandleAnchorIndex(4, 7), 15);
const curvedTopHandles = moveRasterWarpBezierHandle(
  defaultBezierHandles,
  bezierSource,
  4,
  0,
  {
    x: defaultBezierHandles[0].x,
    y: defaultBezierHandles[0].y - 30,
  },
);
const straightTopMiddle = sampleRasterWarpSurface(bezierSource, 4, 1 / 6, 0);
const curvedTopMiddle = sampleRasterWarpSurface(
  bezierSource,
  4,
  1 / 6,
  0,
  curvedTopHandles,
);
assert.ok(curvedTopMiddle.y < straightTopMiddle.y - 10);
assert.deepEqual(
  sampleRasterWarpSurface(bezierSource, 4, 0, 0, curvedTopHandles),
  bezierSource[0],
  "A Bézier tangent must curve the edge without moving its corner anchor",
);
assert.deepEqual(
  sampleRasterWarpSurface(bezierSource, 4, 1 / 3, 0, curvedTopHandles),
  bezierSource[1],
  "A Bézier tangent must preserve the adjacent Warp grid intersection",
);
assert.equal(
  rasterDeformIsIdentity(bezierSource, bounds, "warp", 4, 1e-6, curvedTopHandles),
  false,
);
const curvedLeftHandles = moveRasterWarpBezierHandle(
  defaultBezierHandles,
  bezierSource,
  4,
  1,
  {
    x: defaultBezierHandles[1].x - 30,
    y: defaultBezierHandles[1].y,
  },
);
assert.ok(
  sampleRasterWarpSurface(bezierSource, 4, 0, 1 / 6, curvedLeftHandles).x
    < sampleRasterWarpSurface(bezierSource, 4, 0, 1 / 6).x - 10,
);
assert.throws(
  () => normalizeRasterWarpBezierHandles(defaultBezierHandles.slice(1), bezierSource, 4),
  /eight corner Bézier handles/,
);
const authoredThreeSource = rasterDeformInitialPoints(bounds, "warp", 3);
const authoredThreeHandles = moveRasterWarpBezierHandle(
  rasterWarpDefaultBezierHandles(authoredThreeSource, 3),
  authoredThreeSource,
  3,
  0,
  authoredThreeSource[0],
);
const authoredFiveSource = resampleRasterDeformGrid(authoredThreeSource, 3, 5);
const authoredFiveHandles = remapRasterWarpBezierHandles(
  authoredThreeSource,
  3,
  authoredFiveSource,
  5,
  authoredThreeHandles,
);
assert.deepEqual(
  authoredFiveHandles[0],
  authoredFiveSource[0],
  "A custom zero-length tangent must remain on its corner after changing grid size",
);

assert.deepEqual(rasterWarpCornerIndices(3), [0, 2, 6, 8]);
const smoothGesture = moveRasterWarpControlPoints(
  rasterDeformInitialPoints(bounds, "warp", 3),
  3,
  { x: 80, y: 70 },
  24,
  -12,
);
for (const cornerIndex of rasterWarpCornerIndices(3)) {
  assert.deepEqual(
    smoothGesture[cornerIndex],
    rasterDeformInitialPoints(bounds, "warp", 3)[cornerIndex],
    "An interior Warp gesture must pin all four extreme corners",
  );
}
for (const index of [1, 3, 4, 5, 7]) {
  assert.ok(smoothGesture[index].x > rasterDeformInitialPoints(bounds, "warp", 3)[index].x);
  assert.ok(smoothGesture[index].y < rasterDeformInitialPoints(bounds, "warp", 3)[index].y);
}
const isolatedCorner = moveRasterWarpControlPoints(
  smoothGesture,
  3,
  smoothGesture[0],
  -8,
  6,
  0,
);
assert.deepEqual(isolatedCorner[0], {
  x: smoothGesture[0].x - 8,
  y: smoothGesture[0].y + 6,
});
assert.deepEqual(isolatedCorner.slice(1), smoothGesture.slice(1));
const remappedCornerHandles = remapRasterWarpBezierHandles(
  smoothGesture,
  3,
  isolatedCorner,
  3,
  rasterWarpDefaultBezierHandles(smoothGesture, 3),
  0,
);
for (const handleIndex of [0, 1]) {
  const previous = rasterWarpDefaultBezierHandles(smoothGesture, 3)[handleIndex];
  assert.ok(Math.abs(remappedCornerHandles[handleIndex].x - (previous.x - 8)) < 1e-9);
  assert.ok(Math.abs(remappedCornerHandles[handleIndex].y - (previous.y + 6)) < 1e-9);
}
assert.throws(
  () => moveRasterWarpControlPoints(smoothGesture, 3, smoothGesture[4], 1, 1, 4),
  /four Warp corners/,
);
const localSource = rasterDeformInitialPoints(bounds, "warp", 5);
const localGesture = moveRasterWarpControlPoints(
  localSource,
  5,
  {
    x: bounds.x + bounds.width * 0.375,
    y: bounds.y + bounds.height * 0.375,
  },
  100,
  0,
);
const nearDisplacement = localGesture[6].x - localSource[6].x;
const farDisplacement = localGesture[18].x - localSource[18].x;
assert.ok(nearDisplacement > farDisplacement * 8);
assert.ok(farDisplacement > 0, "Distant cells should follow smoothly without a hard cutoff");

const anchorSource = rasterDeformInitialPoints(bounds, "warp", 4);
const anchorParameter = { u: 0.5, v: 0.5 };
const anchorPoint = sampleRasterWarpSurface(
  anchorSource,
  4,
  anchorParameter.u,
  anchorParameter.v,
);
const foundAnchorParameter = rasterWarpClosestSurfaceParameter(
  anchorSource,
  4,
  anchorPoint,
);
assert.ok(Math.abs(foundAnchorParameter.u - anchorParameter.u) < 1e-6);
assert.ok(Math.abs(foundAnchorParameter.v - anchorParameter.v) < 1e-6);
const anchorGesture = moveRasterWarpControlPoints(
  anchorSource,
  4,
  anchorPoint,
  100,
  -40,
  null,
  foundAnchorParameter,
);
const movedAnchorPoint = sampleRasterWarpSurface(
  anchorGesture,
  4,
  anchorParameter.u,
  anchorParameter.v,
);
assert.ok(Math.abs(movedAnchorPoint.x - anchorPoint.x - 100) < 1e-6);
assert.ok(Math.abs(movedAnchorPoint.y - anchorPoint.y + 40) < 1e-6);
const escapedGesture = moveRasterWarpControlPoints(
  rasterDeformInitialPoints(bounds, "warp", 4),
  4,
  { x: 80, y: 70 },
  180,
  -140,
);
const escapedCorners = new Set(rasterWarpCornerIndices(4));
assert.ok(
  escapedGesture.some((point, index) =>
    !escapedCorners.has(index)
    && (point.x > bounds.x + bounds.width || point.y < bounds.y)),
  "An interior Warp gesture must be free to pull the mesh outside its original frame",
);

const movedThree = rasterDeformInitialPoints(bounds, "warp", 3);
movedThree[4] = { x: 91, y: 63 };
const movedFive = resampleRasterDeformGrid(movedThree, 3, 5);
assert.equal(movedFive.length, 25);
assert.deepEqual(movedFive[0], movedThree[0]);
assert.deepEqual(movedFive[4], movedThree[2]);
assert.deepEqual(movedFive[12], movedThree[4]);
assert.deepEqual(movedFive[20], movedThree[6]);
assert.deepEqual(movedFive[24], movedThree[8]);
assert.equal(rasterDeformIsIdentity(movedFive, bounds, "warp", 5), false);

assert.deepEqual(rasterDeformBoundaryIndices(3), [0, 1, 2, 5, 8, 7, 6, 3]);
const translated = translateRasterDeformPoints(movedFive, 10, -5);
assert.deepEqual(rasterDeformCenter(translated), {
  x: rasterDeformCenter(movedFive).x + 10,
  y: rasterDeformCenter(movedFive).y - 5,
});
assert.throws(
  () => normalizeRasterDeformPoints(translated.slice(1), "warp", 5),
  /expected 25/,
);

const perspective = [
  { x: 5, y: 10 },
  { x: 135, y: 24 },
  { x: 18, y: 118 },
  { x: 122, y: 98 },
];
const weights = rasterPerspectiveWeights(perspective);
assert.equal(weights.length, 4);
assert.ok(weights.every((weight) => Number.isFinite(weight) && weight > 0));
assert.notDeepEqual(weights, [1, 1, 1, 1]);
const perspectiveVertices = packRasterDeformVertices(
  perspective,
  bounds,
  textureRect,
  "perspective",
  3,
);
assert.equal(perspectiveVertices.vertexCount, 6);
const packedWeights = [4, 9, 14, 19, 24, 29]
  .map((index) => perspectiveVertices.data[index]);
const expectedPackedWeights = [weights[0], weights[1], weights[3], weights[0], weights[3], weights[2]];
assert.ok(packedWeights.every(
  (weight, index) => Math.abs(weight - expectedPackedWeights[index]) < 1e-6,
));
assert.deepEqual(
  rasterPerspectiveWeights([
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 0, y: 100 },
    { x: 100, y: 100 },
  ]),
  [1, 1, 1, 1],
);
assert.ok(rasterDeformRenderedBounds(
  smoothGesture,
  200,
  200,
  "warp",
  3,
));

assert.deepEqual(
  rasterDeformBounds([
    { x: -10, y: -20 },
    { x: 110, y: 0 },
    { x: 0, y: 120 },
    { x: 100, y: 100 },
  ], 100, 100),
  { x: 0, y: 0, width: 100, height: 100 },
);

assert.equal(
  RASTER_DEFORM_SHADER_STRATEGY,
  "mesh-grid-linear-f32-rgba8-adjacent-output-continuous-mip-v3",
);
assert.match(rasterDeformShader, /projectiveWeight/);
assert.match(rasterDeformShader, /output\.position = vec4<f32>\(ndc \* safeWeight/);
assert.match(rasterDeformShader, /transform\.documentExtent/);
assert.doesNotMatch(rasterDeformShader, /DOCUMENT_(?:WIDTH|HEIGHT)|engine-limits/);
assert.match(rasterDeformShader, /dpdx\(input\.sourceUv\)/);
assert.match(rasterDeformShader, /textureSampleLevel/);
assert.match(rasterDeformShader, /transparentBorderWeight/);
assert.match(rasterDeformShader, /let continuousLod = clamp\(/);
assert.match(rasterDeformShader, /let lowerLevel = u32\(floor\(continuousLod\)\)/);
assert.match(rasterDeformShader, /let upperLevel = min\(lowerLevel \+ 1u, maximumLevel\)/);
assert.match(
  rasterDeformShader,
  /sampleTransparentLevel\(input\.sourceUv, lowerLevel\)/,
);
assert.match(
  rasterDeformShader,
  /sampleTransparentLevel\(input\.sourceUv, upperLevel\)/,
);
assert.match(rasterDeformShader, /let lodBlend = fract\(continuousLod\)/);
assert.match(rasterDeformShader, /return mix\(lower, upper, lodBlend\)/);
assert.doesNotMatch(
  rasterDeformShader,
  /preserveDarkCoverage|encodedCoverage|displayAlpha/,
);
assert.match(rasterDeformShader, /clearFragmentMain/);
assert.match(rasterDeformStoredEncodedShader, /projectiveWeight/);
assert.match(rasterDeformStoredEncodedShader, /dpdx\(input\.sourceUv\)/);
assert.match(rasterDeformStoredEncodedShader, /loadLinearSource/);
assert.match(
  rasterDeformStoredEncodedShader,
  /rasterTransformEncodedPremultipliedToLinear\([\s\S]*?textureLoad/,
  "RGBA8 Warp and Perspective must decode individual texels before filtering",
);
assert.doesNotMatch(
  rasterDeformStoredEncodedShader,
  /textureSampleLevel\s*\(/,
  "RGBA8 Warp and Perspective must not filter encoded sRGB directly",
);
assert.match(rasterDeformStoredEncodedShader, /rasterTransformFinalizeRgba8\(/);
assert.match(rasterDeformStoredEncodedShader, /quantizeRgba8HighFrequencyAdjacent\(/);
assert.match(
  rasterDeformStoredEncodedShader,
  /vec2<u32>\(input\.position\.xy\)[\s\S]*?transform\.quantizationAndReserved\.x/,
  "RGBA8 Warp and Perspective output must be document-anchored and replay-seeded",
);
assert.match(rasterDeformStoredEncodedShader, /clearFragmentMain/);

const runtime = readFileSync(
  new URL("../src/engine-raster-transform-runtime.ts", import.meta.url),
  "utf8",
);
const controller = readFileSync(
  new URL("../src/mixed-scene-controller.ts", import.meta.url),
  "utf8",
);
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.match(runtime, /transactional-raster-warp-perspective-rgba8-linear-f32-grid-v2/);
assert.match(runtime, /rasterDeformStoredEncodedShader/);
assert.match(runtime, /session\.shared\.clearPipeline/);
assert.match(runtime, /session\.shared\.deformPipeline/);
assert.match(runtime, /pass\.setVertexBuffer\(0, session\.deformVertexBuffer\)/);
assert.match(runtime, /session\.mode !== "affine"[\s\S]{0,700}record\.rasterSource = null/);
assert.match(controller, /type InteractionMode =[\s\S]{0,180}"raster-control"/);
assert.match(controller, /updateRasterLayerTransform\(\{[\s\S]{0,180}controlPoints/);
assert.match(controller, /hitRasterBezierHandle/);
assert.match(controller, /bezierHandles: nextBezierHandles/);
assert.match(controller, /moveRasterWarpControlPoints\(/);
assert.match(
  controller,
  /beginRasterLayerTransform\(requestedMode\)/,
  "Perspective must begin atomically in the requested mode",
);
assert.match(
  controller,
  /pendingRasterPointerId[\s\S]*?resumeRasterPointerAfterPreparation[\s\S]*?await this\.prepareSelectedRasterTransform\(\)[\s\S]*?this\.onPointerDown\(event, true\)/,
  "a mouse or touch drag started during GPU preparation must resume without discarding a touch modifier",
);
assert.match(
  controller,
  /pointerType === "touch"[\s\S]{0,80}\? 24[\s\S]{0,120}closestSceneControlPoint/,
  "Perspective corners must expose a touch-sized hit target on iOS",
);
assert.match(
  runtime,
  /transitionRasterTransformMode\(created, requestedMode, created\.gridSize\);[\s\S]{0,100}writeSessionUniforms\(engine, created\)/,
  "the four Perspective corners must exist before the first mixed-scene publication",
);
assert.equal((html.match(/data-raster-transform-mode=/g) ?? []).length, 0);
assert.equal((html.match(/data-mobile-canvas-tool="warp"/g) ?? []).length, 1);
assert.equal((html.match(/data-mobile-canvas-tool="perspective"/g) ?? []).length, 1);
for (const size of [3, 4, 5]) {
  assert.equal((html.match(new RegExp(`data-raster-transform-grid="${size}"`, "g")) ?? []).length, 1);
}
assert.doesNotMatch(html, /transformCommitBar|transformCommitLabel|id="transformApply"|id="transformCancel"/);

const server = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: process.cwd(),
  server: { middlewareMode: true },
});
let MixedSceneController;
try {
  ({ MixedSceneController } = await server.ssrLoadModule("/src/mixed-scene-controller.ts"));
} finally {
  await server.close();
}

const perspectiveNode = {
  kind: "raster-layer",
  id: 7,
  layerId: 7,
  name: "Perspective QA",
  scope: "layer",
  mode: "perspective",
  gridSize: 3,
  controlPoints: rasterDeformInitialPoints(bounds, "perspective", 3),
  bezierHandles: [],
  x: 80,
  y: 70,
  scale: 1,
  rotation: 0,
  sourceBounds: bounds,
  sourcePivot: { x: 80, y: 70 },
  resultBounds: bounds,
};
let releasePreparation;
const preparationGate = new Promise((resolve) => { releasePreparation = resolve; });
const beginModes = [];
const preparationShell = Object.create(MixedSceneController.prototype);
Object.assign(preparationShell, {
  transformToolActive: true,
  transformSessionOpen: false,
  transformSessionKind: null,
  rasterTransformPreparation: null,
  rasterTransformToolMode: "perspective",
  rasterTransformRecoveryOnly: false,
  transformCommitBusy: false,
  activeInteraction: null,
  status: { textContent: "" },
  host: {
    beginRasterLayerTransform: async (mode) => {
      beginModes.push(mode);
      await preparationGate;
      return { layerId: 7, scope: "layer", mode };
    },
    cancelRasterLayerTransform: async () => true,
  },
  selectedTransformNode: () => perspectiveNode,
  updateTransformUi: () => {},
  scheduleRender: () => {},
  rasterTransformSessionStillOpen: () => false,
});
const firstPreparation = preparationShell.prepareSelectedRasterTransform();
const repeatedPreparation = preparationShell.prepareSelectedRasterTransform();
assert.strictEqual(
  repeatedPreparation,
  firstPreparation,
  "desktop and touch callers must await the same in-flight GPU preparation",
);
assert.deepEqual(beginModes, ["perspective"]);
releasePreparation();
await firstPreparation;
assert.equal(preparationShell.transformSessionOpen, true);
assert.equal(preparationShell.transformSessionKind, "raster");

for (const pointerType of ["mouse", "touch"]) {
  let releasePointerPreparation;
  const pointerPreparationGate = new Promise((resolve) => {
    releasePointerPreparation = resolve;
  });
  const pointerShell = Object.create(MixedSceneController.prototype);
  const pointerDown = { pointerId: pointerType === "mouse" ? 21 : 22, pointerType };
  const pointerMove = { ...pointerDown, clientX: 44, clientY: 55 };
  const resumed = [];
  Object.assign(pointerShell, {
    pendingRasterPointerId: pointerDown.pointerId,
    pendingRasterPointerMove: pointerMove,
    transformSessionOpen: false,
    transformSessionKind: null,
    activeInteraction: null,
    prepareSelectedRasterTransform: async () => {
      await pointerPreparationGate;
      pointerShell.transformSessionOpen = true;
      pointerShell.transformSessionKind = "raster";
    },
    onPointerDown: (event) => {
      resumed.push(["down", event.pointerType]);
      pointerShell.activeInteraction = { pointerId: event.pointerId };
    },
    onPointerMove: (event) => resumed.push(["move", event.clientX, event.clientY]),
  });
  const resume = pointerShell.resumeRasterPointerAfterPreparation(pointerDown);
  releasePointerPreparation();
  await resume;
  assert.deepEqual(
    resumed,
    [["down", pointerType], ["move", 44, 55]],
    `the first ${pointerType} Perspective drag must resume after GPU preparation`,
  );
}

const perspectiveUpdates = [];
const perspectiveDragShell = Object.create(MixedSceneController.prototype);
Object.assign(perspectiveDragShell, {
  activeInteraction: {
    pointerId: 31,
    mode: "raster-control",
    startLayer: { x: 20, y: 20 },
    startModel: perspectiveNode,
    rasterControlPointIndex: 0,
    rasterBezierHandleIndex: null,
  },
  pendingRasterPointerId: null,
  touchContacts: new Map(),
  touchNavigationActive: false,
  eventLayerPoint: () => ({ x: 35, y: 42 }),
  host: {
    updateRasterLayerTransform: (update) => perspectiveUpdates.push(update),
  },
});
perspectiveDragShell.onPointerMove({
  pointerId: 31,
  pointerType: "mouse",
  shiftKey: false,
  preventDefault() {},
});
assert.equal(perspectiveUpdates.length, 1);
assert.equal(
  Object.hasOwn(perspectiveUpdates[0], "bezierHandles"),
  false,
  "Perspective corner drags must not send Warp-only Bézier handles",
);
assert.deepEqual(perspectiveUpdates[0].controlPoints[0], { x: 35, y: 52 });

// A cold mode change in an already-open raster session remains pending until
// asynchronous GPU preparation finishes. The synchronous update is only the
// final publication step and never starts compilation itself.
{
  let releaseModePrograms;
  const modeProgramsReady = new Promise((resolve) => {
    releaseModePrograms = resolve;
  });
  const modeEvents = [];
  const modeSwitchShell = Object.create(MixedSceneController.prototype);
  Object.assign(modeSwitchShell, {
    rasterTransformModeSwitchGeneration: 7,
    rasterTransformPreparation: null,
    rasterTransformToolMode: "warp",
    transformToolActive: true,
    transformSessionOpen: true,
    transformSessionKind: "raster",
    host: {
      prewarmRasterTransformPrograms: async (mode) => {
        modeEvents.push(["prepare", mode]);
        await modeProgramsReady;
      },
      updateRasterLayerTransform: (update) => modeEvents.push(["publish", update.mode]),
    },
    status: { textContent: "" },
    updateTransformUi() {},
    scheduleRender: () => modeEvents.push(["render"]),
  });
  modeSwitchShell.prepareOpenRasterTransformMode("warp", "affine", "Raster layer", 7);
  const modeSwitch = modeSwitchShell.rasterTransformPreparation;
  await Promise.resolve();
  assert.deepEqual(modeEvents, [["prepare", "warp"]]);
  assert.match(modeSwitchShell.status.textContent, /Preparing Warp/);
  releaseModePrograms();
  await modeSwitch;
  assert.deepEqual(modeEvents, [
    ["prepare", "warp"],
    ["publish", "warp"],
    ["render"],
  ]);
}

// Failure never exposes the old affine session through Warp controls. It
// remains cancel-only until the user explicitly returns to the published mode.
{
  const failedShell = Object.create(MixedSceneController.prototype);
  Object.assign(failedShell, {
    activeInteraction: null,
    groupTransformPreparation: null,
    rasterTransformModeSwitchGeneration: 4,
    rasterTransformPreparation: null,
    rasterTransformRecoveryOnly: false,
    rasterTransformToolMode: "warp",
    transformCommitBusy: false,
    transformToolActive: true,
    transformSessionOpen: true,
    transformSessionKind: "raster",
    host: {
      prewarmRasterTransformPrograms: async () => {
        throw new Error("compile failed");
      },
      updateRasterLayerTransform: () => {
        throw new Error("failed programs must not publish");
      },
    },
    status: { textContent: "" },
    updateTransformUi() {},
    scheduleRender() {},
  });
  failedShell.prepareOpenRasterTransformMode("warp", "affine", "Raster layer", 4);
  await failedShell.rasterTransformPreparation;
  assert.equal(failedShell.rasterTransformRecoveryOnly, true);
  assert.match(failedShell.status.textContent, /Transform remains unchanged/);
  const action = failedShell.getTransformActionSnapshot();
  assert.equal(action.canApply, false);
  assert.equal(action.canCancel, true);

  const retryEvents = [];
  failedShell.host.prewarmRasterTransformPrograms = async (mode) => {
    retryEvents.push(["prepare", mode]);
  };
  failedShell.host.updateRasterLayerTransform = (update) => {
    retryEvents.push(["publish", update.mode]);
  };
  failedShell.prepareOpenRasterTransformMode("warp", "affine", "Raster layer", 4);
  await failedShell.rasterTransformPreparation;
  assert.deepEqual(retryEvents, [["prepare", "warp"], ["publish", "warp"]]);
  assert.equal(
    failedShell.rasterTransformRecoveryOnly,
    false,
    "a successful retry must restore Apply and pointer input",
  );
}

// Returning to the already-published mode also exits recovery immediately,
// even after the failed preparation promise has already settled.
{
  const fallbackNode = { ...perspectiveNode, mode: "affine", scope: "layer", name: "Raster layer" };
  const fallbackShell = Object.create(MixedSceneController.prototype);
  Object.assign(fallbackShell, {
    rasterTransformModeSwitchGeneration: 8,
    rasterTransformPreparation: null,
    rasterTransformRecoveryOnly: true,
    rasterTransformToolMode: "warp",
    transformToolActive: true,
    transformSessionOpen: true,
    transformSessionKind: "raster",
    transformToolDeactivationPending: false,
    activeInteraction: null,
    groupTransformPreparation: null,
    transformCommitBusy: false,
    host: { getMixedSceneSnapshot: () => null },
    selectedTransformNode: () => fallbackNode,
    interactionCanvas: {
      hidden: false,
      classList: { toggle() {} },
      setAttribute() {},
    },
    status: { textContent: "" },
    updateTransformUi() {},
    scheduleRender() {},
    canvasGuides: null,
  });
  assert.equal(fallbackShell.setTransformToolActive(true, "affine"), true);
  assert.equal(fallbackShell.rasterTransformRecoveryOnly, false);
  assert.match(fallbackShell.status.textContent, /ready: Apply or Cancel/);
}

// An initial session that finishes after the requested mode changed is rolled
// back instead of publishing a stale tool/session pair.
{
  let releaseInitialMode;
  const initialModeReady = new Promise((resolve) => {
    releaseInitialMode = resolve;
  });
  const events = [];
  const initialShell = Object.create(MixedSceneController.prototype);
  const rasterNode = { ...perspectiveNode, mode: "affine", name: "Raster layer" };
  Object.assign(initialShell, {
    rasterTransformModeSwitchGeneration: 11,
    rasterTransformRecoveryOnly: false,
    rasterTransformToolMode: "affine",
    transformToolActive: true,
    transformSessionOpen: false,
    transformSessionKind: null,
    selectedTransformNode: () => rasterNode,
    host: {
      beginRasterLayerTransform: async (mode) => {
        events.push(["begin", mode]);
        await initialModeReady;
        return { layerId: rasterNode.layerId };
      },
      cancelRasterLayerTransform: async () => {
        events.push(["cancel"]);
        return true;
      },
    },
    status: { textContent: "" },
    updateTransformUi() {},
    scheduleRender: () => events.push(["render"]),
  });
  const preparation = initialShell.runRasterTransformPreparation("affine", 11);
  initialShell.rasterTransformModeSwitchGeneration = 12;
  initialShell.rasterTransformToolMode = "warp";
  releaseInitialMode();
  await preparation;
  assert.deepEqual(events, [["begin", "affine"], ["cancel"]]);
  assert.equal(initialShell.transformSessionOpen, false);
  assert.doesNotMatch(initialShell.status.textContent, /GPU ready/);
}

console.log("Raster Warp/Perspective verification passed.");
