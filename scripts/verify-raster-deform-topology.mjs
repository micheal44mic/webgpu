import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "vite";
import {
  moveRasterWarpBezierHandle,
  rasterDeformInitialPoints,
  rasterDeformTopologyOrientation,
  rasterPerspectiveWeights,
  rasterWarpDefaultBezierHandles,
} from "../src/raster-deform-math.ts";

const bounds = { x: 20, y: 30, width: 120, height: 80 };

for (const gridSize of [3, 4, 5]) {
  const identity = rasterDeformInitialPoints(bounds, "warp", gridSize);
  assert.equal(
    rasterDeformTopologyOrientation(identity, "warp", gridSize),
    1,
    `${gridSize}x${gridSize} identity Warp must keep its winding`,
  );

  const moderate = identity.map((point) => ({ ...point }));
  const middle = Math.floor(gridSize / 2) * gridSize + Math.floor(gridSize / 2);
  moderate[middle] = {
    x: moderate[middle].x + 8,
    y: moderate[middle].y - 4,
  };
  assert.equal(
    rasterDeformTopologyOrientation(moderate, "warp", gridSize),
    1,
    `${gridSize}x${gridSize} Warp must preserve ordinary local edits`,
  );

  const folded = identity.map((point) => ({ ...point }));
  folded[middle] = { x: -1_000, y: -1_000 };
  assert.equal(
    rasterDeformTopologyOrientation(folded, "warp", gridSize),
    0,
    `${gridSize}x${gridSize} Warp must detect a rendered fold-over`,
  );
}

const handlePoints = rasterDeformInitialPoints(bounds, "warp", 4);
const defaultHandles = rasterWarpDefaultBezierHandles(handlePoints, 4);
const moderateHandles = moveRasterWarpBezierHandle(
  defaultHandles,
  handlePoints,
  4,
  0,
  { x: defaultHandles[0].x, y: defaultHandles[0].y - 20 },
);
assert.equal(
  rasterDeformTopologyOrientation(handlePoints, "warp", 4, moderateHandles),
  1,
  "an ordinary boundary curve must remain valid",
);
const foldedHandles = moveRasterWarpBezierHandle(
  defaultHandles,
  handlePoints,
  4,
  0,
  { x: -1_000, y: -1_000 },
);
assert.equal(
  rasterDeformTopologyOrientation(handlePoints, "warp", 4, foldedHandles),
  0,
  "an extreme boundary tangent must not fold rendered triangles",
);

const perspective = [
  { x: 5, y: 10 },
  { x: 135, y: 24 },
  { x: 18, y: 118 },
  { x: 122, y: 98 },
];
assert.equal(rasterDeformTopologyOrientation(perspective, "perspective", 3), 1);
assert.ok(rasterPerspectiveWeights(perspective).every(Number.isFinite));

const mirroredPerspective = [
  { x: 135, y: 10 },
  { x: 5, y: 24 },
  { x: 122, y: 118 },
  { x: 18, y: 98 },
];
assert.equal(
  rasterDeformTopologyOrientation(mirroredPerspective, "perspective", 3),
  -1,
  "a pre-existing global mirror is simple but has the opposite winding",
);

const invalidPerspectiveCases = [
  [
    { x: 0, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
    { x: 100, y: 0 },
  ],
  [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 0, y: 100 },
    { x: 20, y: 20 },
  ],
  [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 0, y: 100 },
    { x: 100, y: 0 },
  ],
];
for (const points of invalidPerspectiveCases) {
  assert.equal(rasterDeformTopologyOrientation(points, "perspective", 3), 0);
  assert.throws(
    () => rasterPerspectiveWeights(points),
    /simple, non-degenerate quadrilateral/,
  );
}

const runtimeSource = readFileSync(
  new URL("../src/engine-raster-transform-runtime.ts", import.meta.url),
  "utf8",
);
assert.match(runtimeSource, /const previousOrientation = session\.deformOrientation/);
assert.match(runtimeSource, /const nextOrientation = rasterDeformTopologyOrientation/);
assert.match(
  runtimeSource,
  /nextOrientation === 0[\s\S]{0,180}nextOrientation !== previousOrientation[\s\S]{0,120}return transformSnapshot\(session\)/,
  "an invalid or reversed candidate must leave the active session unchanged",
);
assert.match(
  runtimeSource,
  /return transformSnapshot\(session\);[\s\S]{0,120}session\.controlPoints = nextPoints/,
  "the topology guard must run before publishing candidate geometry",
);

const server = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: process.cwd(),
  server: { middlewareMode: true },
});
let updateRasterLayerTransform;
try {
  ({ updateRasterLayerTransform } = await server.ssrLoadModule(
    "/src/engine-raster-transform-runtime.ts",
  ));
} finally {
  await server.close();
}

function guardedSession(mode, gridSize, controlPoints, bezierHandles = []) {
  return {
    layerId: 7,
    scope: "layer",
    mode,
    gridSize,
    controlPoints,
    bezierHandles,
    deformOrientation: rasterDeformTopologyOrientation(
      controlPoints,
      mode,
      gridSize,
      bezierHandles,
    ),
    terminal: false,
    transform: {
      translationX: 0,
      translationY: 0,
      scale: 1,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
    },
    sourceBounds: { ...bounds },
    sourcePivot: {
      x: bounds.x + bounds.width * 0.5,
      y: bounds.y + bounds.height * 0.5,
    },
    resultBounds: { ...bounds },
  };
}

const perspectiveSession = guardedSession("perspective", 3, perspective);
const perspectiveEngine = {
  activeRasterTransformSession: perspectiveSession,
  historyStateInconsistent: false,
};
const perspectivePointsBefore = perspectiveSession.controlPoints;
const reversedCandidate = mirroredPerspective;
const rejectedPerspective = updateRasterLayerTransform(perspectiveEngine, {
  controlPoints: reversedCandidate,
});
assert.strictEqual(perspectiveSession.controlPoints, perspectivePointsBefore);
assert.deepEqual(rejectedPerspective.controlPoints, perspective);

const warpPoints = rasterDeformInitialPoints(bounds, "warp", 3);
const warpHandles = [...rasterWarpDefaultBezierHandles(warpPoints, 3)];
const warpSession = guardedSession("warp", 3, warpPoints, warpHandles);
const warpEngine = {
  activeRasterTransformSession: warpSession,
  historyStateInconsistent: false,
};
const foldedWarpCandidate = warpPoints.map((point) => ({ ...point }));
foldedWarpCandidate[4] = { x: -1_000, y: -1_000 };
const warpPointsBefore = warpSession.controlPoints;
const warpHandlesBefore = warpSession.bezierHandles;
const rejectedWarp = updateRasterLayerTransform(warpEngine, {
  controlPoints: foldedWarpCandidate,
});
assert.strictEqual(warpSession.controlPoints, warpPointsBefore);
assert.strictEqual(warpSession.bezierHandles, warpHandlesBefore);
assert.deepEqual(rejectedWarp.controlPoints, warpPoints);

console.log("Raster deformation topology invariants verified.");
