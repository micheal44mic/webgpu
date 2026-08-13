import assert from "node:assert/strict";
import {
  VECTOR_TEXT_OUTLINE_MITER_LIMIT,
  VECTOR_TEXT_OUTLINE_WIDTH_MAXIMUM,
  normalizeVectorTextBlockShadowAngle,
  normalizeVectorTextBlockShadowOffset,
  normalizeVectorTextBlockShadowOpacity,
  normalizeVectorTextOutlineJoin,
  normalizeVectorTextOutlineWidth,
  normalizeVectorTextSingleShadowAngle,
  normalizeVectorTextSingleShadowBlur,
  normalizeVectorTextSingleShadowOffset,
  normalizeVectorTextSingleShadowOpacity,
  normalizeVectorTextInnerShadowAngle,
  normalizeVectorTextInnerShadowBlur,
  normalizeVectorTextInnerShadowOffset,
  normalizeVectorTextInnerShadowOpacity,
  vectorTextBlockShadowLocalReach,
  vectorTextBlockShadowLocalVector,
  vectorTextOutlineLocalReach,
  vectorTextSingleShadowLocalVector,
  vectorTextInnerShadowLocalVector,
} from "../../../src/mixed-scene-stack.ts";
import { buildVectorTextSlugData } from "../../../src/vector-text-slug.ts";
import { planVectorTextSingleShadowBlur } from "../../../src/vector-text-single-shadow.ts";
import {
  buildVectorTextCurveGuide,
  defaultVectorTextDistortPoints,
  moveVectorTextDistortPoint,
  normalizeVectorTextCircleRadiusPercent,
  normalizeVectorTextDistortPoints,
  normalizeVectorTextTransformCurve,
  normalizeVectorTextTransformParameters,
  transformVectorTextPathAffine,
  vectorTextCircleAffine,
  vectorTextCirclePlacement,
  vectorTextDistortBounds,
  warpVectorTextPathAlongCurve,
  warpVectorTextPathFreeForm,
  warpVectorTextPointFreeForm,
} from "../../../src/vector-text-transform.ts";
import { readRepositorySource } from "../source-contract.mjs";

const controllerSource = readRepositorySource("src/mixed-scene-controller.ts");
const clientSource = readRepositorySource("src/vector-text-effect-client.ts");
const fontGeometrySource = readRepositorySource("src/vector-text-font-geometry.ts");
const transformSource = readRepositorySource("src/vector-text-transform.ts");

// Normalizzazione UI e convenzione +Y verso il basso.
assert.equal(VECTOR_TEXT_OUTLINE_WIDTH_MAXIMUM, 100);
assert.equal(VECTOR_TEXT_OUTLINE_MITER_LIMIT, 4);
assert.equal(normalizeVectorTextOutlineWidth(-5), 0);
assert.equal(normalizeVectorTextOutlineWidth(999), 100);
assert.equal(normalizeVectorTextOutlineJoin("invalid"), "round");
assert.equal(vectorTextOutlineLocalReach(25, "round"), 25);
assert.equal(vectorTextOutlineLocalReach(25, "bevel"), 25);
assert.equal(vectorTextOutlineLocalReach(25, "miter"), 100);
assert.equal(normalizeVectorTextBlockShadowOpacity(-1), 0);
assert.equal(normalizeVectorTextBlockShadowOpacity(2), 1);
assert.equal(normalizeVectorTextBlockShadowOffset(-1), 0);
assert.equal(normalizeVectorTextBlockShadowOffset(200), 100);
assert.equal(normalizeVectorTextBlockShadowAngle(-999), -180);
assert.equal(normalizeVectorTextBlockShadowAngle(999), 180);
assert.equal(vectorTextBlockShadowLocalReach(360, 23), 23);
const blockVector = vectorTextBlockShadowLocalVector(360, 23, -104);
assert.ok(Math.abs(blockVector.x + 5.564204) < 1e-6);
assert.ok(Math.abs(blockVector.y - 22.316802) < 1e-6);
assert.equal(normalizeVectorTextSingleShadowOpacity(-1), 0);
assert.equal(normalizeVectorTextSingleShadowOpacity(2), 1);
assert.equal(normalizeVectorTextSingleShadowOffset(-1), 0);
assert.equal(normalizeVectorTextSingleShadowOffset(999), 100);
assert.equal(normalizeVectorTextSingleShadowAngle(-999), -180);
assert.equal(normalizeVectorTextSingleShadowAngle(999), 180);
assert.equal(normalizeVectorTextSingleShadowBlur(-1), 0);
assert.equal(normalizeVectorTextSingleShadowBlur(999), 300);
const sharpShadow = vectorTextSingleShadowLocalVector(54, -180);
assert.ok(Math.abs(sharpShadow.x + 54) < 1e-9);
assert.equal(normalizeVectorTextInnerShadowOpacity(-1), 0);
assert.equal(normalizeVectorTextInnerShadowOpacity(2), 1);
assert.equal(normalizeVectorTextInnerShadowOffset(-1), 0);
assert.equal(normalizeVectorTextInnerShadowOffset(999), 100);
assert.equal(normalizeVectorTextInnerShadowAngle(-999), -180);
assert.equal(normalizeVectorTextInnerShadowAngle(999), 180);
assert.equal(normalizeVectorTextInnerShadowBlur(-1), 0);
assert.equal(normalizeVectorTextInnerShadowBlur(999), 300);
const innerShadowVector = vectorTextInnerShadowLocalVector(12, -135);
assert.ok(Math.abs(innerShadowVector.x + 8.485281) < 1e-6);
assert.ok(Math.abs(innerShadowVector.y - 8.485281) < 1e-6);
assert.ok(Math.abs(sharpShadow.y) < 1e-9);

// Trasformazioni: stessi preset/contratti osservati nel bundle Kittl.
assert.equal(normalizeVectorTextTransformCurve(-999), -100);
assert.equal(normalizeVectorTextTransformCurve(999), 100);
assert.equal(normalizeVectorTextCircleRadiusPercent(1), 16);
assert.equal(normalizeVectorTextCircleRadiusPercent(999), 200);
assert.deepEqual(normalizeVectorTextTransformParameters(undefined), {
  type: "none",
  curve: 80,
  circleRadiusPercent: 50,
  circleInverted: false,
  distortPoints: null,
});
const distortSourceBounds = { left: 0, top: 0, right: 1000, bottom: 400 };
const defaultDistort = defaultVectorTextDistortPoints(distortSourceBounds);
assert.equal(defaultDistort.length, 10);
assert.deepEqual(defaultDistort[0], { x: 0, y: 0 });
assert.deepEqual(defaultDistort[1], { x: 500, y: 0 });
assert.deepEqual(defaultDistort[2], { x: 1000, y: 0 });
assert.deepEqual(defaultDistort[3], { x: 1000, y: 400 });
assert.deepEqual(defaultDistort[4], { x: 500, y: 400 });
assert.deepEqual(defaultDistort[5], { x: 0, y: 400 });
assert.equal(normalizeVectorTextDistortPoints(defaultDistort)?.length, 10);
assert.equal(normalizeVectorTextDistortPoints(defaultDistort.slice(0, 9)), null);
assert.equal(normalizeVectorTextTransformParameters({ type: "distort" }).type, "distort");
for (const point of [
  { x: 0, y: 0 },
  { x: 500, y: 0 },
  { x: 1000, y: 0 },
  { x: 0, y: 400 },
  { x: 500, y: 400 },
  { x: 1000, y: 400 },
  { x: 250, y: 200 },
  { x: 750, y: 200 },
]) {
  const mapped = warpVectorTextPointFreeForm(
    point,
    distortSourceBounds,
    defaultDistort,
  );
  assert.ok(Math.abs(mapped.x - point.x) < 1e-8);
  assert.ok(Math.abs(mapped.y - point.y) < 1e-8);
}
assert.deepEqual(vectorTextDistortBounds(defaultDistort), distortSourceBounds);

const raisedTopMiddle = moveVectorTextDistortPoint(
  defaultDistort,
  1,
  { x: 500, y: -120 },
);
assert.deepEqual(raisedTopMiddle[1], { x: 500, y: -120 });
assert.deepEqual(raisedTopMiddle[6], { x: 250, y: -120 });
assert.deepEqual(raisedTopMiddle[7], { x: 750, y: -120 });
assert.deepEqual(defaultDistort[1], { x: 500, y: 0 });

const bentTopHandle = moveVectorTextDistortPoint(
  defaultDistort,
  6,
  { x: 400, y: 100 },
);
const movedHandleVector = {
  x: bentTopHandle[6].x - bentTopHandle[1].x,
  y: bentTopHandle[6].y - bentTopHandle[1].y,
};
const mirroredHandleVector = {
  x: bentTopHandle[7].x - bentTopHandle[1].x,
  y: bentTopHandle[7].y - bentTopHandle[1].y,
};
assert.ok(Math.abs(
  movedHandleVector.x * mirroredHandleVector.y
    - movedHandleVector.y * mirroredHandleVector.x,
) < 1e-8);
assert.ok(
  movedHandleVector.x * mirroredHandleVector.x
    + movedHandleVector.y * mirroredHandleVector.y < 0,
);
assert.ok(Math.abs(Math.hypot(
  mirroredHandleVector.x,
  mirroredHandleVector.y,
) - 250) < 1e-8, "la maniglia opposta conserva la propria lunghezza");

const shortTextCenter = warpVectorTextPointFreeForm(
  { x: 100, y: 50 },
  { left: 0, top: 0, right: 200, bottom: 100 },
  raisedTopMiddle,
);
const longTextCenter = warpVectorTextPointFreeForm(
  { x: 700, y: 250 },
  { left: 0, top: 0, right: 1400, bottom: 500 },
  raisedTopMiddle,
);
assert.ok(Math.abs(shortTextCenter.x - longTextCenter.x) < 1e-8);
assert.ok(Math.abs(shortTextCenter.y - longTextCenter.y) < 1e-8);

const distortControlPath = {
  verbs: new Uint8Array([0, 3, 4]),
  coords: new Float64Array([0, 0, 250, 100, 750, 300, 1000, 400]),
  contourOffsets: new Uint32Array([0]),
  fillRule: 0,
};
const distortedControlPath = warpVectorTextPathFreeForm(
  distortControlPath,
  distortSourceBounds,
  raisedTopMiddle,
);
assert.deepEqual([...distortedControlPath.verbs], [...distortControlPath.verbs]);
assert.deepEqual(
  [...distortedControlPath.contourOffsets],
  [...distortControlPath.contourOffsets],
);
assert.equal(distortedControlPath.coords.length, distortControlPath.coords.length);
assert.ok(
  [...distortedControlPath.coords].some(
    (value, index) => Math.abs(value - distortControlPath.coords[index]) > 1e-6,
  ),
);

// Regressione Distort + blur: abbassare e decentrare il punto inferiore
// produce uno Slug con origine non nulla. La ROI della mask dovra' quindi
// essere convertita in coordinate Slug, mentre la ROI di compositing resta
// nelle coordinate locali assolute del nodo.
const loweredBottomMiddle = moveVectorTextDistortPoint(
  defaultDistort,
  4,
  { x: 620, y: 680 },
);
assert.deepEqual(loweredBottomMiddle[4], { x: 620, y: 680 });
assert.deepEqual(loweredBottomMiddle[8], { x: 370, y: 680 });
assert.deepEqual(loweredBottomMiddle[9], { x: 870, y: 680 });
const distortBlurPath = {
  verbs: new Uint8Array([0, 3, 3, 3, 4]),
  coords: new Float64Array([
    100, 100,
    300, 20, 700, 20, 900, 100,
    900, 340, 650, 400, 500, 400,
    350, 400, 100, 340, 100, 100,
  ]),
  contourOffsets: new Uint32Array([0]),
  fillRule: 0,
};
const loweredDistortBlurPath = warpVectorTextPathFreeForm(
  distortBlurPath,
  distortSourceBounds,
  loweredBottomMiddle,
);
const loweredDistortBlurSlug = buildVectorTextSlugData(loweredDistortBlurPath);
const loweredDistortBlurAbsoluteBounds = {
  left: loweredDistortBlurSlug.left + loweredDistortBlurSlug.originX,
  top: loweredDistortBlurSlug.top + loweredDistortBlurSlug.originY,
  right: loweredDistortBlurSlug.right + loweredDistortBlurSlug.originX,
  bottom: loweredDistortBlurSlug.bottom + loweredDistortBlurSlug.originY,
};
const loweredDistortBlurPlan = planVectorTextSingleShadowBlur(
  loweredDistortBlurAbsoluteBounds,
  20,
  1,
);
assert.ok(
  Math.abs(loweredDistortBlurSlug.originX) > 1
    && loweredDistortBlurSlug.originY > 1,
  "la fixture deve esercitare la doppia origine su entrambi gli assi",
);
assert.ok(
  loweredDistortBlurPlan.bounds[3] + loweredDistortBlurSlug.originY
    > loweredDistortBlurPlan.bounds[3],
  "i bounds assoluti usati come bounds Slug oltrepasserebbero la ROI inferiore",
);
for (let index = 0; index < loweredDistortBlurPlan.bounds.length; index += 1) {
  const origin = index % 2 === 0
    ? loweredDistortBlurSlug.originX
    : loweredDistortBlurSlug.originY;
  const sourceBound = loweredDistortBlurPlan.bounds[index] - origin;
  assert.ok(
    Math.abs(sourceBound + origin - loweredDistortBlurPlan.bounds[index]) < 1e-8,
    "la ROI source relativa deve ricostruire esattamente la ROI assoluta",
  );
}

const archGuide = buildVectorTextCurveGuide("arch", 1000, 400, 80);
const archStart = archGuide.pointAtDistance(0);
const archMiddle = archGuide.pointAtDistance(500);
assert.ok(archMiddle.y < archStart.y, "Arch positivo deve sollevare il centro");
const centeredArchOffset = (archGuide.length - 1000) * 0.5;
const centeredArchLeft = archGuide.pointAtDistance(centeredArchOffset);
const centeredArchMiddle = archGuide.pointAtDistance(centeredArchOffset + 500);
const centeredArchRight = archGuide.pointAtDistance(centeredArchOffset + 1000);
assert.ok(
  Math.abs(centeredArchLeft.x + centeredArchRight.x) < 1e-7,
  "Arch centrato deve avere estremi X speculari",
);
assert.ok(
  Math.abs(centeredArchLeft.y - centeredArchRight.y) < 1e-7,
  "Arch centrato deve avere estremi alla stessa altezza",
);
assert.ok(
  Math.abs(centeredArchMiddle.x) < 1e-7,
  "Il centro del testo deve cadere sull'apice dell'Arch",
);
for (const curve of [-100, -47, 0, 47, 100]) {
  const symmetricGuide = buildVectorTextCurveGuide("arch", 1000, 400, curve);
  const symmetricOffset = (symmetricGuide.length - 1000) * 0.5;
  const leftPoint = symmetricGuide.pointAtDistance(symmetricOffset);
  const middlePoint = symmetricGuide.pointAtDistance(symmetricOffset + 500);
  const rightPoint = symmetricGuide.pointAtDistance(symmetricOffset + 1000);
  assert.ok(Math.abs(leftPoint.x + rightPoint.x) < 1e-7);
  assert.ok(Math.abs(leftPoint.y - rightPoint.y) < 1e-7);
  assert.ok(Math.abs(middlePoint.x) < 1e-7);
}
const invertedArchGuide = buildVectorTextCurveGuide("arch", 1000, 400, -80);
assert.ok(
  invertedArchGuide.pointAtDistance(500).y
    > invertedArchGuide.pointAtDistance(0).y,
  "Arch negativo deve invertire la curva",
);
const waveGuide = buildVectorTextCurveGuide("wave", 1000, 400, 80);
assert.notEqual(
  Math.round(waveGuide.pointAtDistance(0).y),
  Math.round(waveGuide.pointAtDistance(900).y),
);
const controlPath = {
  verbs: new Uint8Array([0, 3, 4]),
  coords: new Float64Array([0, 10, 250, 20, 750, 30, 1000, 40]),
  contourOffsets: new Uint32Array([0]),
  fillRule: 0,
};
const warpedControlPath = warpVectorTextPathAlongCurve(
  controlPath,
  archGuide,
  0,
);
assert.deepEqual([...warpedControlPath.verbs], [...controlPath.verbs]);
assert.deepEqual(
  [...warpedControlPath.contourOffsets],
  [...controlPath.contourOffsets],
);
assert.equal(warpedControlPath.coords.length, controlPath.coords.length);
for (let index = 0; index < controlPath.coords.length; index += 2) {
  const guidePoint = archGuide.pointAtDistance(controlPath.coords[index]);
  assert.ok(Math.abs(warpedControlPath.coords[index] - guidePoint.x) < 1e-8);
  assert.ok(
    Math.abs(
      warpedControlPath.coords[index + 1]
        - (guidePoint.y + controlPath.coords[index + 1]),
    ) < 1e-8,
  );
}
const centeredControlPath = warpVectorTextPathAlongCurve(
  {
    verbs: new Uint8Array([0, 1, 1]),
    coords: new Float64Array([0, 0, 500, 0, 1000, 0]),
    contourOffsets: new Uint32Array([0]),
    fillRule: 0,
  },
  archGuide,
  0,
  0,
  centeredArchOffset,
);
assert.ok(
  Math.abs(centeredControlPath.coords[0] + centeredControlPath.coords[4]) < 1e-7,
  "Il warp centrato deve conservare la simmetria X",
);
assert.ok(
  Math.abs(centeredControlPath.coords[1] - centeredControlPath.coords[5]) < 1e-7,
  "Il warp centrato deve conservare la simmetria Y",
);
const circleStart = vectorTextCirclePlacement(0, 0, 100, false);
assert.ok(Math.abs(circleStart.targetX) < 1e-9);
assert.ok(Math.abs(circleStart.targetY + 100) < 1e-9);
assert.ok(Math.abs(circleStart.rotation) < 1e-9);
const circleQuarter = vectorTextCirclePlacement(Math.PI * 50, 0, 100, false);
assert.ok(Math.abs(circleQuarter.targetX - 100) < 1e-9);
assert.ok(Math.abs(circleQuarter.targetY) < 1e-9);
assert.ok(Math.abs(circleQuarter.rotation - Math.PI / 2) < 1e-9);
const invertedCircleStart = vectorTextCirclePlacement(0, 0, 100, true);
assert.ok(Math.abs(invertedCircleStart.targetX) < 1e-9);
assert.ok(Math.abs(invertedCircleStart.targetY - 100) < 1e-9);
assert.ok(Math.abs(invertedCircleStart.rotation) < 1e-9);
const circlePivotPath = {
  verbs: new Uint8Array([0]),
  coords: new Float64Array([50, -20]),
  contourOffsets: new Uint32Array([0]),
  fillRule: 0,
};
const circlePivotPlacement = vectorTextCirclePlacement(50, 0, 100, false);
const mappedCirclePivot = transformVectorTextPathAffine(
  circlePivotPath,
  vectorTextCircleAffine(50, -20, 0, 100, false),
);
assert.ok(
  Math.abs(mappedCirclePivot.coords[0] - circlePivotPlacement.targetX) < 1e-9,
);
assert.ok(
  Math.abs(mappedCirclePivot.coords[1] - circlePivotPlacement.targetY) < 1e-9,
);
assert.match(transformSource, /arch:[\s\S]*x: 0\.5, y: 0\.65/);
assert.match(transformSource, /wave:[\s\S]*x: 0\.8, y: 0\.5/);
assert.match(transformSource, /verbs: path\.verbs\.slice\(\)/);
assert.doesNotMatch(transformSource, /flatten|polygon/i);
assert.match(fontGeometrySource, /font\.getPaths\(/);
assert.match(controllerSource, /node\.transformType/);
assert.match(controllerSource, /includeFill: fuseOutlineAndFill/);
assert.match(controllerSource, /if \(!sourceFillCoveredByOutline\)/);
assert.match(clientSource, /include-fill/);
assert.match(controllerSource, /rotation: 0,/);
assert.doesNotMatch(controllerSource, /rotation: index === 0/);
