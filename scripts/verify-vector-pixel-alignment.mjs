import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "vite";
import {
  sceneDocumentPixelAlignedPosition,
  sceneDocumentPixelAlignedSideScaleUpdate,
  sceneDocumentPixelAlignedTranslation,
  sceneDocumentPixelAlignedUniformScale,
  sceneDocumentPixelCenteredFrame,
  sceneDocumentPixelExpandedBounds,
  sceneDocumentPixelIsCardinalRotation,
} from "../src/scene-document-pixel-alignment.ts";
import { sceneLocalToLayer } from "../src/scene-transform-geometry.ts";

const root = new URL("../", import.meta.url);
const readSource = (path) => readFileSync(new URL(path, root), "utf8");
const moduleServer = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: process.cwd(),
  server: { middlewareMode: true },
});
let resolveSceneScaleSnap;
try {
  ({ resolveSceneScaleSnap } = await moduleServer.ssrLoadModule(
    "/src/scene-transform-snap.ts",
  ));
} finally {
  await moduleServer.close();
}
const closeTo = (actual, expected, message, epsilon = 1e-7) => {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${message}: expected ${expected}, received ${actual}`,
  );
};
const isWhole = (value) => Math.abs(value - Math.round(value)) <= 1e-7;
const transformedBounds = (bounds, transform) => {
  const points = [
    { x: bounds.left, y: bounds.top },
    { x: bounds.right, y: bounds.top },
    { x: bounds.right, y: bounds.bottom },
    { x: bounds.left, y: bounds.bottom },
  ].map((point) => sceneLocalToLayer(point, transform));
  return {
    left: Math.min(...points.map((point) => point.x)),
    top: Math.min(...points.map((point) => point.y)),
    right: Math.max(...points.map((point) => point.x)),
    bottom: Math.max(...points.map((point) => point.y)),
  };
};

// Center-drawn fill frames retain integer outer edges for both parities.
const evenFrame = sceneDocumentPixelCenteredFrame({
  x: 5.2,
  y: 17.15,
  width: 9.6,
  height: 6.3,
});
assert.deepEqual(evenFrame, { x: 5, y: 17, width: 10, height: 6 });
const oddFrame = sceneDocumentPixelCenteredFrame({
  x: 6.2,
  y: 17.15,
  width: 8.6,
  height: 6.7,
});
assert.deepEqual(oddFrame, { x: 6, y: 17, width: 9, height: 7 });
assert.equal(oddFrame.x + oddFrame.width * 0.5, 10.5);
const squareFrame = sceneDocumentPixelCenteredFrame({
  x: 4.8,
  y: 8.4,
  width: 10.4,
  height: 7.1,
}, true);
assert.deepEqual(squareFrame, { x: 5, y: 7, width: 10, height: 10 });

// Custom even and odd document centers align frames by painted bounds, not by
// forcing every valid object pivot to be an integer.
const centeredBounds = { left: -5.5, top: -3.5, right: 5.5, bottom: 3.5 };
for (const [width, height] of [
  [64, 64],
  [65, 97],
  [3073, 2111],
  [4096, 4096],
]) {
  const transform = {
    x: width * 0.5,
    y: height * 0.5,
    scale: 1,
    rotation: 0,
  };
  const position = sceneDocumentPixelAlignedPosition(centeredBounds, transform);
  const aligned = transformedBounds(centeredBounds, { ...transform, ...position });
  assert.ok(isWhole(aligned.left) && isWhole(aligned.top));
  assert.ok(isWhole(aligned.right) && isWhole(aligned.bottom));
}

for (const rotation of [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5]) {
  assert.equal(sceneDocumentPixelIsCardinalRotation(rotation), true);
  const fractionalBounds = { left: -5.15, top: -3.85, right: 5.15, bottom: 3.85 };
  const transform = {
    x: 50.3,
    y: 70.2,
    scale: 1.23,
    scaleX: 1.23,
    scaleY: 0.77,
    rotation,
  };
  const position = sceneDocumentPixelAlignedPosition(fractionalBounds, transform);
  const alignedTransform = { ...transform, ...position };
  const original = transformedBounds(fractionalBounds, transform);
  const aligned = transformedBounds(fractionalBounds, alignedTransform);
  assert.ok(isWhole(aligned.left) && isWhole(aligned.top));
  closeTo(aligned.right - aligned.left, original.right - original.left,
    "cardinal alignment preserves painted width");
  closeTo(aligned.bottom - aligned.top, original.bottom - original.top,
    "cardinal alignment preserves painted height");
  closeTo(alignedTransform.scaleX, transform.scaleX,
    "cardinal alignment preserves horizontal scale");
  closeTo(alignedTransform.scaleY, transform.scaleY,
    "cardinal alignment preserves vertical scale");
}
assert.equal(sceneDocumentPixelIsCardinalRotation(Math.PI * 0.25), false);

// Move alignment is absolute, idempotent and independent of zoom, DPR and the
// visibility or magnetic state of editor guides.
const startBounds = { left: 1.25, top: 2.75, right: 12.25, bottom: 9.75 };
const firstMove = sceneDocumentPixelAlignedTranslation(startBounds, {
  x: 7.61,
  y: -1.12,
});
assert.deepEqual(firstMove, { x: 7.75, y: -0.75 });
const movedBounds = {
  left: startBounds.left + firstMove.x,
  top: startBounds.top + firstMove.y,
  right: startBounds.right + firstMove.x,
  bottom: startBounds.bottom + firstMove.y,
};
assert.ok(Object.values(movedBounds).every(isWhole));
assert.deepEqual(
  sceneDocumentPixelAlignedTranslation(movedBounds, { x: 0, y: 0 }),
  { x: 0, y: 0 },
);

// All four side handles keep the opposite side fixed and align the dragged
// painted side. Together with the four corner cases below this covers all
// eight transform handles.
const sideBounds = { left: -5.5, top: -4, right: 5.5, bottom: 4 };
const sideStart = {
  x: 10.5,
  y: 20,
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
};
const sideCases = [
  ["north", { x: 10.5, y: 13.4 }, "top", 13, "bottom", 24],
  ["east", { x: 18.3, y: 20 }, "right", 18, "left", 5],
  ["south", { x: 10.5, y: 27.6 }, "bottom", 28, "top", 16],
  ["west", { x: 2.2, y: 20 }, "left", 2, "right", 16],
];
for (const [handle, pointer, movingKey, moving, fixedKey, fixed] of sideCases) {
  const update = sceneDocumentPixelAlignedSideScaleUpdate({
    start: sideStart,
    bounds: sideBounds,
    handle,
    pointer,
    minimumScale: 0.01,
    maximumScale: 100,
    centered: false,
  });
  assert.ok(update);
  const bounds = transformedBounds(sideBounds, update);
  closeTo(bounds[movingKey], moving, `${handle} moving edge`);
  closeTo(bounds[fixedKey], fixed, `${handle} fixed edge`);
}

const cornerBounds = { left: -10, top: -10, right: 10, bottom: 10 };
const cornerTransform = {
  x: 0.25,
  y: 0.5,
  scale: 1,
  scaleX: 2,
  scaleY: 0.5,
  rotation: 0,
};
const cornerPoints = {
  "north-west": { x: -10, y: -10 },
  "north-east": { x: 10, y: -10 },
  "south-east": { x: 10, y: 10 },
  "south-west": { x: -10, y: 10 },
};
for (const handle of Object.keys(cornerPoints)) {
  const scale = sceneDocumentPixelAlignedUniformScale({
    transform: cornerTransform,
    localBounds: cornerBounds,
    handle,
    rawScale: 2.53,
    minimumScale: 0.01,
    maximumScale: 100,
  });
  const ratio = scale / cornerTransform.scale;
  const uniformResult = {
    ...cornerTransform,
    scale,
    scaleX: cornerTransform.scaleX * ratio,
    scaleY: cornerTransform.scaleY * ratio,
  };
  const point = sceneLocalToLayer(cornerPoints[handle], uniformResult);
  assert.ok(
    isWhole(point.x) || isWhole(point.y),
    `${handle} must reach a document-pixel line without changing aspect ratio`,
  );
  closeTo(
    uniformResult.scaleX / uniformResult.scaleY,
    cornerTransform.scaleX / cornerTransform.scaleY,
    `${handle} preserves the existing axis ratio`,
  );
  closeTo(uniformResult.x, cornerTransform.x, `${handle} preserves center x`);
  closeTo(uniformResult.y, cornerTransform.y, `${handle} preserves center y`);
}

// Regression: magnetic scale contacts account for pre-existing independent
// axis scales and never publish an unreachable guide.
const identityView = {
  canvasWidth: 1000,
  canvasHeight: 1000,
  cssWidth: 1000,
  cssHeight: 1000,
  centerX: 0,
  centerY: 0,
  zoom: 1,
  rotationRadians: 0,
  rotationCos: 1,
  rotationSin: 0,
};
const nonUniformSnap = resolveSceneScaleSnap({
  transform: { x: 0, y: 0, scale: 1, scaleX: 2, scaleY: 0.5, rotation: 0 },
  localBounds: cornerBounds,
  handle: "south-east",
  rawScale: 2.4,
  targets: [],
  gridStep: 25,
  minScale: 0.01,
  maxScale: 100,
  view: identityView,
});
assert.equal(nonUniformSnap.matches.length, 1);
const snapRatio = nonUniformSnap.scale;
const reachedPoint = sceneLocalToLayer({ x: 10, y: 10 }, {
  x: 0,
  y: 0,
  scale: nonUniformSnap.scale,
  scaleX: 2 * snapRatio,
  scaleY: 0.5 * snapRatio,
  rotation: 0,
});
const match = nonUniformSnap.matches[0];
closeTo(reachedPoint[match.axis], match.position, "reachable non-uniform guide");

// Imported strokes are already included in SVG silhouette bounds. Project
// outlines extend those painted bounds, while source paths remain untouched.
const outlinedBounds = sceneDocumentPixelExpandedBounds(
  { left: -5, top: -3, right: 5, bottom: 3 },
  2,
);
assert.deepEqual(outlinedBounds, { left: -7, top: -5, right: 7, bottom: 5 });
const outlinedPosition = sceneDocumentPixelAlignedPosition(outlinedBounds, {
  x: 10.3,
  y: 20.4,
  scale: 1,
  rotation: 0,
});
assert.deepEqual(outlinedPosition, { x: 10, y: 20 });

const controllerSource = readSource("src/mixed-scene-controller.ts");
const shapeControllerSource = readSource("src/shape-tool-controller.ts");
const svgImportSource = readSource("src/vector-svg-import.ts");
const rasterRuntimeSource = readSource("src/engine-vector-raster-runtime.ts");
const engineRuntimeSource = readSource("src/engine-runtime-misc.ts");
const html = readSource("index.html");
assert.match(controllerSource, /sceneDocumentPixelAlignedTranslation\(/);
assert.match(controllerSource, /sceneDocumentPixelAlignedSideScaleUpdate\(/);
assert.match(controllerSource, /sceneDocumentPixelAlignedUniformScale\(/);
assert.match(controllerSource, /sceneDocumentPixelAlignedPosition\(documentValue\.bounds, seed\)/);
assert.match(controllerSource, /vectorTextOutlineLocalReach\(/);
assert.match(controllerSource, /const hasInk = outline\.inkRight - outline\.inkLeft/);
assert.match(
  controllerSource,
  /const affectsGeometry = Object\.keys\(normalized\)\.some\(\(key\) => key !== "color"\);[\s\S]*?this\.updateTextGeometryNode\(node, normalized\)/,
  "text geometry edits must re-align their painted bounds",
);
assert.match(
  controllerSource,
  /const affectsOutlineBounds = patch\.outlineWidth !== undefined[\s\S]*?patch\.outlineJoin !== undefined;[\s\S]*?this\.documentPixelTransformForNode\(next\)/,
  "outline edits must re-align text and SVG painted bounds",
);
assert.doesNotMatch(
  controllerSource,
  /const rawUpdate = \{\s*\.\.\.interaction\.startModel,\s*rotation:/,
  "rotation updates must not leak non-transform node fields into transform history",
);
assert.match(shapeControllerSource, /sceneDocumentPixelCenteredFrame\(/);
assert.match(
  svgImportSource,
  /mergedSilhouette = mergeVectorTextPaths\(rawPaints\.map\(\(paint\) => paint\.path\)\)[\s\S]{0,160}rawSilhouette = \{[\s\S]{0,100}\.\.\.mergedSilhouette/,
);
assert.doesNotMatch(rasterRuntimeSource, /scene-document-pixel-alignment/,
  "raster conversion must receive aligned scene geometry without shader-time snapping");
assert.match(
  engineRuntimeSource,
  /"scale",\s*"scaleX",\s*"scaleY",\s*"rotation"/,
  "vector transform history must accept independent-axis resize updates",
);
assert.match(html, /id="mobileTextOutlineWidth"[^>]*step="1"/);
assert.match(html, /id="mobileTextBlockShadowOutlineWidth"[^>]*step="1"/);

console.log(
  "Vector document-pixel alignment verified: creation parity, custom canvases, permanent move, eight non-distorting resize handles, cardinal placement, SVG/text outline bounds, history and raster handoff.",
);
