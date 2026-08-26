import assert from "node:assert/strict";
import { createServer } from "vite";

const moduleServer = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: process.cwd(),
  server: { middlewareMode: true },
});

let shapeCore;
let mixedSceneModule;
try {
  shapeCore = await moduleServer.ssrLoadModule("/src/vector-shape-core.ts");
  mixedSceneModule = await moduleServer.ssrLoadModule("/src/mixed-scene-stack.ts");
} finally {
  await moduleServer.close();
}

const {
  VECTOR_SHAPE_DEFAULT_STAR_INNER_RATIO,
  VECTOR_SHAPE_DEFAULT_STAR_POINTS,
  VECTOR_SHAPE_KINDS,
  VECTOR_SHAPE_MAXIMUM_STAR_POINTS,
  cloneVectorShapeDefinition,
  createVectorShapeDefinition,
  createVectorShapeDocument,
  createVectorShapeDraft,
  normalizeVectorShapeBounds,
  normalizeVectorShapeDefinition,
} = shapeCore;
const { MixedSceneStack } = mixedSceneModule;

const rounded = (value) => Number(value.toFixed(9));
const coordinateExtents = (path) => {
  const x = [];
  const y = [];
  let offset = 0;
  for (const verb of path.verbs) {
    const coordinateCount = verb === 0 || verb === 1
      ? 2
      : verb === 2
        ? 4
        : verb === 3
          ? 6
          : 0;
    for (let index = 0; index < coordinateCount; index += 2) {
      x.push(path.coords[offset + index]);
      y.push(path.coords[offset + index + 1]);
    }
    offset += coordinateCount;
  }
  return {
    left: rounded(Math.min(...x)),
    top: rounded(Math.min(...y)),
    right: rounded(Math.max(...x)),
    bottom: rounded(Math.max(...y)),
  };
};

assert.deepEqual(VECTOR_SHAPE_KINDS, ["rectangle", "ellipse", "star"]);
assert.deepEqual(
  normalizeVectorShapeBounds({ left: 110, top: 90, right: 10, bottom: 30 }),
  { left: 10, top: 30, right: 110, bottom: 90 },
);
assert.throws(
  () => normalizeVectorShapeBounds({ left: 1, top: 1, right: 1, bottom: 2 }),
  /width.*greater than zero/i,
);
assert.throws(
  () => normalizeVectorShapeBounds({ left: Number.NaN, top: 1, right: 2, bottom: 3 }),
  /left.*finite/i,
);

// Rectangle and square share one semantic kind. Aspect locking belongs to the
// gesture that supplies bounds, never to a second geometry implementation.
const rectangle = createVectorShapeDraft(
  "rectangle",
  { left: 110, top: 90, right: 10, bottom: 30 },
  { fillColor: "#336699" },
);
assert.equal(rectangle.shapeDefinition.kind, "rectangle");
assert.equal(rectangle.shapeDefinition.width, 100);
assert.equal(rectangle.shapeDefinition.height, 60);
assert.deepEqual({ x: rectangle.x, y: rectangle.y }, { x: 60, y: 60 });
assert.deepEqual([...rectangle.document.paints[0].path.verbs], [0, 1, 1, 1, 4]);
assert.deepEqual(coordinateExtents(rectangle.document.paints[0].path), {
  left: -50,
  top: -30,
  right: 50,
  bottom: 30,
});
assert.equal(rectangle.document.paints[0].color, "#336699");
assert.equal(rectangle.document.width, 100);
assert.equal(rectangle.document.height, 60);

const square = createVectorShapeDraft(
  "rectangle",
  { left: 20, top: 40, right: 100, bottom: 120 },
);
assert.equal(square.shapeDefinition.kind, "rectangle");
assert.equal(square.shapeDefinition.width, square.shapeDefinition.height);

const roundedRectangle = createVectorShapeDefinition(
  "rectangle",
  120,
  40,
  { cornerRadius: 999 },
);
assert.equal(roundedRectangle.cornerRadius, 20);
assert.deepEqual(
  [...createVectorShapeDocument(roundedRectangle).paints[0].path.verbs],
  [0, 1, 3, 1, 3, 1, 3, 1, 3, 4],
);

// Ellipse and circle likewise share one free-aspect definition.
const ellipse = createVectorShapeDraft(
  "ellipse",
  { left: 0, top: 20, right: 120, bottom: 80 },
);
assert.equal(ellipse.shapeDefinition.kind, "ellipse");
assert.deepEqual([...ellipse.document.paints[0].path.verbs], [0, 3, 3, 3, 3, 4]);
assert.deepEqual(coordinateExtents(ellipse.document.paints[0].path), {
  left: -60,
  top: -30,
  right: 60,
  bottom: 30,
});
const circle = createVectorShapeDefinition("ellipse", 64, 64);
assert.equal(circle.kind, "ellipse");
assert.equal(circle.width, circle.height);

// Stars are normalized to the requested free bounds, including odd point
// counts whose raw polar vertices do not have symmetric horizontal extrema.
const star = createVectorShapeDraft(
  "star",
  { left: 10, top: 20, right: 210, bottom: 120 },
);
assert.equal(star.shapeDefinition.points, VECTOR_SHAPE_DEFAULT_STAR_POINTS);
assert.equal(
  star.shapeDefinition.innerRadiusRatio,
  VECTOR_SHAPE_DEFAULT_STAR_INNER_RATIO,
);
assert.equal(star.document.commandCount, 11);
assert.deepEqual(coordinateExtents(star.document.paints[0].path), {
  left: -100,
  top: -50,
  right: 100,
  bottom: 50,
});
const normalizedStar = normalizeVectorShapeDefinition({
  version: 1,
  kind: "star",
  width: 70,
  height: 30,
  points: 999,
  innerRadiusRatio: -2,
});
assert.equal(normalizedStar.points, VECTOR_SHAPE_MAXIMUM_STAR_POINTS);
assert.equal(normalizedStar.innerRadiusRatio, 0);

// Revisions are deterministic, geometry-sensitive and keep paint/silhouette
// storage independent so later mutation cannot alias the renderer's paths.
const firstDocument = createVectorShapeDocument(star.shapeDefinition);
const repeatedDocument = createVectorShapeDocument(star.shapeDefinition);
const changedDocument = createVectorShapeDocument(
  createVectorShapeDefinition("star", 201, 100),
);
assert.equal(firstDocument.sourceHash, repeatedDocument.sourceHash);
assert.equal(firstDocument.sourceRevision, repeatedDocument.sourceRevision);
assert.notEqual(firstDocument.sourceHash, changedDocument.sourceHash);
assert.notEqual(firstDocument.paints[0].path, firstDocument.silhouettePath);
assert.notEqual(
  firstDocument.paints[0].path.coords.buffer,
  firstDocument.silhouettePath.coords.buffer,
);

const definitionClone = cloneVectorShapeDefinition(star.shapeDefinition);
assert.deepEqual(definitionClone, star.shapeDefinition);
assert.notEqual(definitionClone, star.shapeDefinition);

// The existing semantic renderer remains the only rendering path. Parametric
// metadata survives scene cloning, history capture and duplication on its node.
const stack = new MixedSceneStack([1]);
const node = stack.addSvgAboveSelection({
  document: rectangle.document,
  shapeDefinition: rectangle.shapeDefinition,
  x: rectangle.x,
  y: rectangle.y,
  scale: rectangle.scale,
  rotation: rectangle.rotation,
});
assert.deepEqual(node.shapeDefinition, rectangle.shapeDefinition);
assert.notEqual(node.shapeDefinition, rectangle.shapeDefinition);
const captured = stack.captureState();
assert.deepEqual(captured.svgNodes[0].shapeDefinition, rectangle.shapeDefinition);
assert.notEqual(captured.svgNodes[0].shapeDefinition, node.shapeDefinition);
const history = stack.captureVectorHistoryState(`svg:${node.id}`);
assert.deepEqual(history.node.shapeDefinition, rectangle.shapeDefinition);
const duplicate = stack.duplicateSelectedSemanticAboveSelection();
assert.equal(duplicate.kind, "svg");
assert.deepEqual(duplicate.shapeDefinition, rectangle.shapeDefinition);
assert.notEqual(duplicate.shapeDefinition, node.shapeDefinition);

const importedStyleNode = stack.addSvgAboveSelection({
  document: ellipse.document,
  x: ellipse.x,
  y: ellipse.y,
  scale: 1,
  rotation: 0,
});
assert.equal(importedStyleNode.shapeDefinition, undefined);

console.log(
  "Vector shapes: parametric rectangle, ellipse and star geometry, stable documents and scene retention verified.",
);
