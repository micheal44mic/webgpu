import assert from "node:assert/strict";
import { area, difference, FillRule } from "clipper2-ts";
import { vectorTextBlockShadowLocalVector } from "../../../src/mixed-scene-stack.ts";
import { vectorPathToQuadraticContours } from "../../../src/vector-text-curve-utils.ts";
import {
  VECTOR_TEXT_BLOCK_INNER_OVERLAP_PIXELS,
  VECTOR_TEXT_OUTLINE_INNER_OVERLAP_PIXELS,
  buildOutsideVectorTextOutline,
  buildVectorTextBlockSet,
  buildVisibleVectorTextBlockSet,
  canonicalizeVectorTextPath,
  compileVectorTextEffect,
} from "../../../src/vector-text-effect-geometry.ts";
import {
  VECTOR_TEXT_MAXIMUM_VECTOR_ZOOM,
  vectorTextLodForSigma,
  vectorTextMaximumLod,
} from "../../../src/vector-text-lod.ts";
import {
  absoluteMeshBounds,
  assertCanonical,
  assertTriangulation,
  canonicalArea,
  canonicalKey,
  meshTriangleArea,
  polygonPath,
  reverseRing,
} from "./geometry-fixtures.mjs";

// LOD: errore in pixel monotono e bound sotto 0,1 px fino a 64×.
assert.equal(VECTOR_TEXT_MAXIMUM_VECTOR_ZOOM, 64);
const lodSamples = [0.02, 0.197, 1, 8, 32, 64].map(vectorTextLodForSigma);
for (let index = 1; index < lodSamples.length; index += 1) {
  assert.ok(lodSamples[index].bucket >= lodSamples[index - 1].bucket);
  assert.ok(lodSamples[index].integerScale >= lodSamples[index - 1].integerScale);
}
const maxLod = vectorTextMaximumLod();
assert.equal(maxLod.bucketScale, 64);
assert.ok(maxLod.cubicToQuadraticTolerance * 64 <= 0.015625 + 1e-12);
assert.ok(maxLod.polygonFlattenTolerance * 64 <= 0.03125 + 1e-12);
assert.ok(maxLod.roundArcSagittaTolerance * 64 <= 0.03125 + 1e-12);
assert.ok(Math.SQRT2 * 0.5 / maxLod.integerScale * 64 < 0.006);

// Topologia Clipper NonZero: holes, overlap, auto-intersezioni e degenerazioni.
const lod = vectorTextLodForSigma(1);
const outer = [[0, 0], [120, 0], [120, 100], [0, 100]];
const inner = [[30, 30], [90, 30], [90, 70], [30, 70]];
const sourceRectangle = polygonPath([outer]);
const rectangleSet = canonicalizeVectorTextPath(sourceRectangle, lod);
assertCanonical(rectangleSet, "rectangle");
assert.equal(rectangleSet.groups.length, 1);
assert.equal(rectangleSet.groups[0].holes.length, 0);
assertTriangulation(rectangleSet, lod, "rectangle");

const sameNested = canonicalizeVectorTextPath(polygonPath([outer, inner]), lod);
assertCanonical(sameNested, "same-oriented nested");
assert.equal(sameNested.groups.length, 1);
assert.equal(sameNested.groups[0].holes.length, 0);

const oppositeNested = canonicalizeVectorTextPath(
  polygonPath([outer, reverseRing(inner)]),
  lod,
);
assertCanonical(oppositeNested, "opposite nested");
assert.equal(oppositeNested.groups.length, 1);
assert.equal(oppositeNested.groups[0].holes.length, 1);
assertTriangulation(oppositeNested, lod, "opposite nested");

const island = [[45, 40], [75, 40], [75, 60], [45, 60]];
const threeLevels = canonicalizeVectorTextPath(
  polygonPath([outer, reverseRing(inner), island]),
  lod,
);
assertCanonical(threeLevels, "three levels");
assert.equal(threeLevels.groups.length, 2);
assertTriangulation(threeLevels, lod, "three levels");

const overlapA = [[0, 0], [80, 0], [80, 80], [0, 80]];
const overlapB = [[50, 20], [130, 20], [130, 100], [50, 100]];
const overlapping = canonicalizeVectorTextPath(polygonPath([overlapA, overlapB]), lod);
const overlappingPermuted = canonicalizeVectorTextPath(
  polygonPath([overlapB, overlapA]),
  lod,
);
assertCanonical(overlapping, "overlap");
assert.equal(canonicalKey(overlapping), canonicalKey(overlappingPermuted));
assertTriangulation(overlapping, lod, "overlap");

const bowTie = canonicalizeVectorTextPath(
  polygonPath([[[0, 0], [100, 100], [0, 100], [100, 0]]]),
  lod,
);
assertCanonical(bowTie, "bow-tie");
assert.ok(bowTie.groups.length > 0, "bow-tie non deve essere scartato per area netta zero");
assertTriangulation(bowTie, lod, "bow-tie");

const duplicateAndZeroLength = canonicalizeVectorTextPath(
  polygonPath([[[0, 0], [100, 0], [100, 0], [100, 0.000001], [100, 80], [0, 80]]]),
  lod,
);
assertCanonical(duplicateAndZeroLength, "duplicate/near-collinear");
assert.ok(duplicateAndZeroLength.groups.length > 0);

const explicitZeroLengthCurves = vectorPathToQuadraticContours({
  verbs: new Uint8Array([0, 2, 3, 1, 1, 1, 4]),
  coords: new Float64Array([
    0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0, 0, 0,
    80, 0,
    80, 60,
    0, 60,
  ]),
  contourOffsets: new Uint32Array([0]),
  fillRule: 0,
}, lod.cubicToQuadraticTolerance);
assert.equal(explicitZeroLengthCurves.length, 1);
assert.equal(explicitZeroLengthCurves[0].curves.length, 4);
for (const curve of explicitZeroLengthCurves[0].curves) {
  assert.ok(
    curve.p0.x !== curve.p2.x || curve.p0.y !== curve.p2.y,
    "le curve completamente degeneri devono essere rimosse",
  );
}

const tangentContours = canonicalizeVectorTextPath(
  polygonPath([
    [[0, 0], [50, 0], [50, 50], [0, 50]],
    [[50, 50], [100, 50], [100, 100], [50, 100]],
  ]),
  lod,
);
assertCanonical(tangentContours, "tangent contours");
assertTriangulation(tangentContours, lod, "tangent contours");

// Outline: zero è un vero no-op; round/bevel e miter producono regioni canoniche.
// La mesh runtime sovrappone 1 px sotto il fill analitico senza cambiare il bordo esterno.
assert.equal(VECTOR_TEXT_OUTLINE_INNER_OVERLAP_PIXELS, 1);
assert.equal(VECTOR_TEXT_BLOCK_INNER_OVERLAP_PIXELS, 2);
assert.equal(
  compileVectorTextEffect(
    sourceRectangle,
    lod,
    { kind: "source-outline", width: 0, join: "round" },
    "width-zero",
  ),
  null,
);
const sourceFillMesh = compileVectorTextEffect(
  sourceRectangle,
  lod,
  { kind: "source-fill" },
  "source-fill",
);
assert.ok(sourceFillMesh);
assert.deepEqual(absoluteMeshBounds(sourceFillMesh), {
  left: 0,
  top: 0,
  right: 120,
  bottom: 100,
});
for (const join of ["round", "bevel", "miter"]) {
  const outlineSet = buildOutsideVectorTextOutline(
    rectangleSet,
    10 * lod.integerScale,
    join,
    Math.max(1, Math.round(lod.roundArcSagittaTolerance * lod.integerScale)),
  );
  assert.ok(outlineSet);
  assertCanonical(outlineSet, `outline-${join}`);
  assert.ok(canonicalArea(outlineSet, lod.integerScale) > 0);
  const outlineMesh = assertTriangulation(outlineSet, lod, `outline-${join}`);
  const seamSafeOutlineSet = buildOutsideVectorTextOutline(
    rectangleSet,
    10 * lod.integerScale,
    join,
    Math.max(1, Math.round(lod.roundArcSagittaTolerance * lod.integerScale)),
    VECTOR_TEXT_OUTLINE_INNER_OVERLAP_PIXELS * lod.integerScale,
  );
  assert.ok(seamSafeOutlineSet);
  assertCanonical(seamSafeOutlineSet, `outline-seam-safe-${join}`);
  assert.ok(
    canonicalArea(seamSafeOutlineSet, lod.integerScale)
      > canonicalArea(outlineSet, lod.integerScale),
    "l'overlap interno deve chiudere la fessura AA",
  );
  const bounds = absoluteMeshBounds(outlineMesh);
  assert.ok(bounds.left <= -9.99);
  assert.ok(bounds.right >= 129.99);
  const compiled = compileVectorTextEffect(
    sourceRectangle,
    lod,
    { kind: "source-outline", width: 10, join },
    `compiled-${join}`,
  );
  assert.ok(compiled);
  assert.equal(compiled.lodBucket, lod.bucket);
  assert.ok(
    meshTriangleArea(compiled) > meshTriangleArea(outlineMesh),
    "la mesh compilata deve includere l'overlap nascosto sotto il fill",
  );
  const fused = compileVectorTextEffect(
    sourceRectangle,
    lod,
    { kind: "source-outline", width: 10, join, includeFill: true },
    `fused-${join}`,
  );
  assert.ok(fused);
  assert.ok(
    meshTriangleArea(fused) > meshTriangleArea(compiled),
    "fill e outline dello stesso colore devono diventare una sola unione",
  );
  assert.deepEqual(absoluteMeshBounds(fused), absoluteMeshBounds(compiled));
}

// Block Shadow: F, F+v e le side wall appartengono a una sola unione.
assert.equal(buildVectorTextBlockSet(rectangleSet, 0, 0), rectangleSet);
const vectorX = 23 * lod.integerScale;
const vectorY = 17 * lod.integerScale;
const blockSet = buildVectorTextBlockSet(rectangleSet, vectorX, vectorY);
assertCanonical(blockSet, "block shadow");
assert.ok(canonicalArea(blockSet, lod.integerScale) >= canonicalArea(rectangleSet, lod.integerScale));
assert.ok(blockSet.left <= rectangleSet.left);
assert.ok(blockSet.top <= rectangleSet.top);
assert.ok(blockSet.right >= rectangleSet.right + vectorX);
assert.ok(blockSet.bottom >= rectangleSet.bottom + vectorY);
assertTriangulation(blockSet, lod, "block shadow");
const visibleBlockWithoutOverlap = buildVisibleVectorTextBlockSet(
  rectangleSet,
  vectorX,
  vectorY,
);
const blockInnerOverlap = Math.max(
  1,
  Math.round(
    VECTOR_TEXT_BLOCK_INNER_OVERLAP_PIXELS
      / lod.bucketScale
      * lod.integerScale,
  ),
);
const visibleBlockSet = buildVisibleVectorTextBlockSet(
  rectangleSet,
  vectorX,
  vectorY,
  blockInnerOverlap,
);
assertCanonical(visibleBlockSet, "visible block shadow overlap");
assertTriangulation(visibleBlockSet, lod, "visible block shadow overlap");
assert.ok(
  canonicalArea(visibleBlockSet, lod.integerScale)
    > canonicalArea(visibleBlockWithoutOverlap, lod.integerScale),
  "le pareti devono sovrapporsi al fill nella sola zona nascosta",
);
assert.ok(
  canonicalArea(visibleBlockSet, lod.integerScale)
    < canonicalArea(blockSet, lod.integerScale),
  "la faccia sorgente nascosta non deve restare nel fill della Block Shadow",
);
assert.deepEqual(
  {
    left: visibleBlockSet.left,
    top: visibleBlockSet.top,
    right: visibleBlockSet.right,
    bottom: visibleBlockSet.bottom,
  },
  {
    left: visibleBlockWithoutOverlap.left,
    top: visibleBlockWithoutOverlap.top,
    right: visibleBlockWithoutOverlap.right,
    bottom: visibleBlockWithoutOverlap.bottom,
  },
  "l'overlap nascosto non deve cambiare la bbox della mesh visibile",
);
assert.deepEqual(
  {
    left: visibleBlockSet.left,
    top: visibleBlockSet.top,
    right: visibleBlockSet.right,
    bottom: visibleBlockSet.bottom,
  },
  {
    left: blockSet.left,
    top: blockSet.top,
    right: blockSet.right,
    bottom: blockSet.bottom,
  },
  "rimuovere la faccia sorgente non deve cambiare la bbox dell'effetto",
);
const blockMesh = compileVectorTextEffect(
  sourceRectangle,
  lod,
  { kind: "block", vectorX: 23, vectorY: 17 },
  "block",
);
assert.ok(blockMesh);
assert.equal(
  compileVectorTextEffect(
    sourceRectangle,
    lod,
    { kind: "block", vectorX: 0, vectorY: 0 },
    "block-zero",
  ),
  null,
  "offset zero non deve generare una faccia nascosta",
);
assert.ok(
  Math.abs(
    meshTriangleArea(blockMesh)
      - canonicalArea(visibleBlockSet, lod.integerScale),
  ) <= 1e-5,
  "la mesh Block Shadow deve usare faccia traslata e pareti esposte",
);
const blockBounds = absoluteMeshBounds(blockMesh);
assert.ok(blockBounds.right >= 142.99);
assert.ok(blockBounds.bottom >= 116.99);
const longSeventyDegreeVector = vectorTextBlockShadowLocalVector(0, 100, 70);
for (const [directionX, directionY] of [
  [23, 0],
  [-23, 0],
  [0, 17],
  [0, -17],
  [23, 17],
  [-23, 17],
  [23, -17],
  [-23, -17],
  [longSeventyDegreeVector.x, longSeventyDegreeVector.y],
]) {
  const quantizedX = Math.round(directionX * lod.integerScale);
  const quantizedY = Math.round(directionY * lod.integerScale);
  const fullDirectionBlock = buildVectorTextBlockSet(
    oppositeNested,
    quantizedX,
    quantizedY,
  );
  const visibleDirectionBlock = buildVisibleVectorTextBlockSet(
    oppositeNested,
    quantizedX,
    quantizedY,
  );
  const overlappedDirectionBlock = buildVisibleVectorTextBlockSet(
    oppositeNested,
    quantizedX,
    quantizedY,
    blockInnerOverlap,
  );
  assertCanonical(overlappedDirectionBlock, `block overlap ${directionX},${directionY}`);
  assertTriangulation(
    overlappedDirectionBlock,
    lod,
    `block overlap ${directionX},${directionY}`,
  );
  assert.equal(
    difference(visibleDirectionBlock.paths, overlappedDirectionBlock.paths, FillRule.NonZero).length,
    0,
    `l'overlap sottrae triangoli visibili per ${directionX},${directionY}`,
  );
  assert.equal(
    difference(overlappedDirectionBlock.paths, fullDirectionBlock.paths, FillRule.NonZero).length,
    0,
    `l'overlap esce dallo sweep completo per ${directionX},${directionY}`,
  );

  assert.ok(
    canonicalArea(overlappedDirectionBlock, lod.integerScale)
      >= canonicalArea(visibleDirectionBlock, lod.integerScale),
    `overlap nascosto mancante per ${directionX},${directionY}`,
  );
  assert.ok(
    canonicalArea(overlappedDirectionBlock, lod.integerScale)
      < canonicalArea(fullDirectionBlock, lod.integerScale),
    `la faccia sorgente è rientrata per ${directionX},${directionY}`,
  );
  assert.deepEqual(
    {
      left: overlappedDirectionBlock.left,
      top: overlappedDirectionBlock.top,
      right: overlappedDirectionBlock.right,
      bottom: overlappedDirectionBlock.bottom,
    },
    {
      left: visibleDirectionBlock.left,
      top: visibleDirectionBlock.top,
      right: visibleDirectionBlock.right,
      bottom: visibleDirectionBlock.bottom,
    },
    `l'overlap cambia bbox per ${directionX},${directionY}`,
  );
}
const blockOutlineMesh = compileVectorTextEffect(
  sourceRectangle,
  lod,
  {
    kind: "block-outline",
    vectorX: 23,
    vectorY: 17,
    width: 8,
    join: "miter",
  },
  "block-outline",
);
assert.ok(blockOutlineMesh);
assert.ok(meshTriangleArea(blockOutlineMesh) > 0);
