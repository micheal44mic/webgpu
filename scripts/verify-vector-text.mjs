import assert from "node:assert/strict";
import fs from "node:fs";
import { area } from "clipper2-ts";

import {
  VECTOR_TEXT_BLOCK_SHADOW_STRATEGY,
  VECTOR_TEXT_OUTLINE_MITER_LIMIT,
  VECTOR_TEXT_OUTLINE_STRATEGY,
  VECTOR_TEXT_OUTLINE_WIDTH_MAXIMUM,
  VECTOR_TEXT_SINGLE_SHADOW_STRATEGY,
  VECTOR_TEXT_INNER_SHADOW_STRATEGY,
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
} from "../src/mixed-scene-stack.ts";
import {
  VECTOR_TEXT_FONT_GEOMETRY_STRATEGY,
  VECTOR_TEXT_FONT_MANIFEST,
} from "../src/vector-text-font-geometry.ts";
import {
  vectorPathToQuadraticContours,
} from "../src/vector-text-curve-utils.ts";
import {
  VECTOR_TEXT_GPU_GEOMETRY_STRATEGY,
  VECTOR_TEXT_OUTLINE_INNER_OVERLAP_PIXELS,
  buildOutsideVectorTextOutline,
  buildVectorTextBlockSet,
  canonicalizeVectorTextPath,
  compileVectorTextEffect,
  triangulateCanonicalVectorTextSet,
} from "../src/vector-text-effect-geometry.ts";
import {
  VECTOR_TEXT_GEOMETRY_COMPILER_VERSION,
  VECTOR_TEXT_MAXIMUM_VECTOR_ZOOM,
  vectorTextLodForSigma,
  vectorTextMaximumLod,
} from "../src/vector-text-lod.ts";
import {
  VECTOR_TEXT_SLUG_COMPILER_VERSION,
  buildVectorTextSlugData,
  vectorTextPathRevision,
} from "../src/vector-text-slug.ts";
import {
  VECTOR_TEXT_SINGLE_SHADOW_BLUR_MAXIMUM,
  VECTOR_TEXT_SINGLE_SHADOW_BLUR_STRATEGY,
  VECTOR_TEXT_SINGLE_SHADOW_MAX_KERNEL_RADIUS,
  VECTOR_TEXT_SINGLE_SHADOW_MAX_PIXELS,
  planVectorTextSingleShadowBlur,
  vectorTextSingleShadowBlurSupport,
} from "../src/vector-text-single-shadow.ts";
import {
  VECTOR_TEXT_GPU_BLUR_FORMAT,
  VECTOR_TEXT_GPU_RENDER_STRATEGY,
  VECTOR_TEXT_GPU_SAMPLE_COUNT,
} from "../src/vector-text-gpu-shader.ts";
import {
  VECTOR_TEXT_SLUG_GPU_RENDER_STRATEGY,
} from "../src/vector-text-slug-gpu-shader.ts";
import {
  VECTOR_TEXT_PRESENTATION_STRATEGY,
} from "../src/vector-text-shader.ts";
import {
  VECTOR_TEXT_ADAPTIVE_ZOOM_STRATEGY,
} from "../src/vector-text-adaptive-zoom.ts";
import {
  VECTOR_TEXT_TRANSFORM_STRATEGY,
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
} from "../src/vector-text-transform.ts";
import {
  MIXED_SCENE_COMPOSITOR_STRATEGY,
  MIXED_SCENE_LINEAR_FORMAT,
} from "../src/mixed-scene-compositor-shader.ts";

const read = (relativePath) =>
  fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const engineSource = read("src/brush-engine.ts");
const controllerSource = read("src/mixed-vector-text-controller.ts");
const clientSource = read("src/vector-text-effect-client.ts");
const workerSource = read("src/vector-text-effect-worker.ts");
const workerProtocolSource = read("src/vector-text-effect-worker-protocol.ts");
const geometrySource = read("src/vector-text-effect-geometry.ts");
const curveSource = read("src/vector-text-curve-utils.ts");
const slugSource = read("src/vector-text-slug.ts");
const slugShaderSource = read("src/vector-text-slug-gpu-shader.ts");
const gpuShaderSource = read("src/vector-text-gpu-shader.ts");
const innerShadowShaderSource = read("src/vector-text-inner-shadow-gpu-shader.ts");
const gpuResourcesSource = read("src/vector-text-gpu-resources.ts");
const singleShadowSource = read("src/vector-text-single-shadow.ts");
const fontGeometrySource = read("src/vector-text-font-geometry.ts");
const transformSource = read("src/vector-text-transform.ts");
const adaptiveSource = read("src/vector-text-adaptive-zoom.ts");
const mainSource = read("src/main.ts");
const htmlSource = read("index.html");
const packageJson = JSON.parse(read("package.json"));

function polygonPath(rings, fillRule = 0) {
  const verbs = [];
  const coords = [];
  const contourOffsets = [];
  for (const ring of rings) {
    assert.ok(ring.length >= 3);
    contourOffsets.push(verbs.length);
    verbs.push(0);
    coords.push(ring[0][0], ring[0][1]);
    for (let index = 1; index < ring.length; index += 1) {
      verbs.push(1);
      coords.push(ring[index][0], ring[index][1]);
    }
    verbs.push(4);
  }
  return {
    verbs: new Uint8Array(verbs),
    coords: new Float64Array(coords),
    contourOffsets: new Uint32Array(contourOffsets),
    fillRule,
  };
}

function reverseRing(ring) {
  return [...ring].reverse();
}

function assertCanonical(set, label) {
  for (const group of set.groups) {
    assert.ok(area(group.outer) > 0, `${label}: outer non positivo`);
    for (const hole of group.holes) {
      assert.ok(area(hole) < 0, `${label}: hole non negativo`);
    }
  }
  for (const ring of set.paths) {
    assert.ok(ring.length >= 3, `${label}: ring corto`);
    for (let index = 0; index < ring.length; index += 1) {
      const current = ring[index];
      const next = ring[(index + 1) % ring.length];
      assert.notDeepEqual(current, next, `${label}: punti consecutivi duplicati`);
      assert.ok(Number.isSafeInteger(current.x), `${label}: x non safe integer`);
      assert.ok(Number.isSafeInteger(current.y), `${label}: y non safe integer`);
    }
  }
}

function canonicalArea(set, integerScale) {
  return set.paths.reduce((total, ring) => total + area(ring), 0)
    / (integerScale * integerScale);
}

function meshTriangleArea(mesh) {
  let total = 0;
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const ia = mesh.indices[index] * 2;
    const ib = mesh.indices[index + 1] * 2;
    const ic = mesh.indices[index + 2] * 2;
    assert.ok(ic + 1 < mesh.vertices.length, "indice Earcut fuori range");
    const ax = mesh.vertices[ia];
    const ay = mesh.vertices[ia + 1];
    const bx = mesh.vertices[ib];
    const by = mesh.vertices[ib + 1];
    const cx = mesh.vertices[ic];
    const cy = mesh.vertices[ic + 1];
    const twice = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    assert.ok(Math.abs(twice) > 1e-10, "triangolo Earcut degenere");
    total += Math.abs(twice) * 0.5;
  }
  return total;
}

function assertTriangulation(set, lod, label) {
  const mesh = triangulateCanonicalVectorTextSet(
    set,
    lod.integerScale,
    `verify:${label}`,
    lod.bucket,
  );
  assert.equal(mesh.indices.length % 3, 0);
  const expected = canonicalArea(set, lod.integerScale);
  const actual = meshTriangleArea(mesh);
  const tolerance = Math.max(1e-5, Math.abs(expected) * 2e-6);
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: area mesh ${actual} != area canonica ${expected}`,
  );
  return mesh;
}

function canonicalKey(set) {
  return JSON.stringify(set.groups.map((group) => ({
    outer: group.outer.map(({ x, y }) => [x, y]),
    holes: group.holes.map((ring) => ring.map(({ x, y }) => [x, y])),
  })));
}

function absoluteMeshBounds(mesh) {
  return {
    left: mesh.left + mesh.originX,
    top: mesh.top + mesh.originY,
    right: mesh.right + mesh.originX,
    bottom: mesh.bottom + mesh.originY,
  };
}

// Coordinate view/node: gli effetti non devono alterare il modello semantico.
const viewport = {
  width: 1420,
  height: 860,
  centerX: 2048,
  centerY: 2048,
  zoom: 0.197,
  rotation: 0.37,
};
const object = { x: 2110, y: 1960, scale: 1.42, rotation: -0.18 };
function localToLayer(point) {
  const x = point.x * object.scale;
  const y = point.y * object.scale;
  const cosine = Math.cos(object.rotation);
  const sine = Math.sin(object.rotation);
  return {
    x: object.x + cosine * x - sine * y,
    y: object.y + sine * x + cosine * y,
  };
}
function layerToCanvas(point) {
  const dx = point.x - viewport.centerX;
  const dy = point.y - viewport.centerY;
  const cosine = Math.cos(viewport.rotation);
  const sine = Math.sin(viewport.rotation);
  return {
    x: viewport.width * 0.5 + (cosine * dx - sine * dy) * viewport.zoom,
    y: viewport.height * 0.5 + (sine * dx + cosine * dy) * viewport.zoom,
  };
}
function canvasToLayer(point) {
  const x = (point.x - viewport.width * 0.5) / viewport.zoom;
  const y = (point.y - viewport.height * 0.5) / viewport.zoom;
  const cosine = Math.cos(viewport.rotation);
  const sine = Math.sin(viewport.rotation);
  return {
    x: viewport.centerX + cosine * x + sine * y,
    y: viewport.centerY - sine * x + cosine * y,
  };
}
for (const point of [
  { x: -900, y: -280 },
  { x: 900, y: -280 },
  { x: 900, y: 280 },
  { x: -900, y: 280 },
  { x: 0, y: 0 },
]) {
  const layer = localToLayer(point);
  const roundTrip = canvasToLayer(layerToCanvas(layer));
  assert.ok(Math.abs(roundTrip.x - layer.x) < 1e-9);
  assert.ok(Math.abs(roundTrip.y - layer.y) < 1e-9);
}

// Strategie: nessun fallback bitmap, source Slug, effetti Clipper/Worker.
assert.equal(
  VECTOR_TEXT_PRESENTATION_STRATEGY,
  "semantic-vector-gpu-runs-slug-clipper-msaa4-rgba16f-v6",
);
assert.equal(
  VECTOR_TEXT_ADAPTIVE_ZOOM_STRATEGY,
  "disabled-vector-lod-worker-node-atomic-latest-only-v3",
);
assert.equal(
  VECTOR_TEXT_OUTLINE_STRATEGY,
  "webgpu-clipper64-worker-outside-offset-aa-overlap1px-same-color-fused-round-bevel-miter4-v6",
);
assert.equal(
  VECTOR_TEXT_BLOCK_SHADOW_STRATEGY,
  "webgpu-clipper64-worker-canonical-swept-union-mesh-v4",
);
assert.equal(
  VECTOR_TEXT_SINGLE_SHADOW_STRATEGY,
  "webgpu-slug-zero-blur-or-r8-separable-gaussian-v2",
);
assert.equal(
  VECTOR_TEXT_INNER_SHADOW_STRATEGY,
  "webgpu-slug-analytic-fill-clip-zero-blur-or-r8-separable-gaussian-v1",
);
assert.equal(
  VECTOR_TEXT_SINGLE_SHADOW_BLUR_STRATEGY,
  "webgpu-slug-r8-mask-separable-gaussian-roi-cache-v2",
);
assert.equal(
  VECTOR_TEXT_GPU_GEOMETRY_STRATEGY,
  "clipper64-nonzero-worker-native-round-bevel-exact-miter-aa-overlap-same-color-union-earcut-v6",
);
assert.equal(VECTOR_TEXT_GEOMETRY_COMPILER_VERSION, "clipper64-nonzero-lod-worker-v6");
assert.equal(
  VECTOR_TEXT_SLUG_GPU_RENDER_STRATEGY,
  "webgpu-slug-source-clipper-effect-mesh-msaa4-stable-lines-absolute-f32-scale-v5",
);
assert.equal(
  VECTOR_TEXT_SLUG_COMPILER_VERSION,
  "three-text-slug-0.6.5-whole-node-compact-bands-inclusive-v2",
);
assert.equal(VECTOR_TEXT_GPU_RENDER_STRATEGY, "webgpu-indexed-vector-msaa4-exact-camera-redraw-v1");
assert.equal(VECTOR_TEXT_GPU_SAMPLE_COUNT, 4);
assert.equal(VECTOR_TEXT_GPU_BLUR_FORMAT, "r8unorm");
assert.equal(MIXED_SCENE_LINEAR_FORMAT, "rgba16float");
assert.equal(
  MIXED_SCENE_COMPOSITOR_STRATEGY,
  "ordered-raster-vector-gpu-runs-rgba16f-viewport-source-over-v3",
);
assert.equal(
  VECTOR_TEXT_FONT_GEOMETRY_STRATEGY,
  "local-opentype-outline-kittl-transform-v4-distort",
);
assert.equal(
  VECTOR_TEXT_TRANSFORM_STRATEGY,
  "kittl-compatible-centered-arch-wave-distort-six-vertex-four-handle-cubic-distance-warp-circle-rigid-glyph-v3",
);
assert.equal(packageJson.dependencies["clipper2-ts"], "2.0.1-18");
assert.equal(packageJson.dependencies.earcut, "^3.0.2");
assert.ok(!fs.existsSync(new URL("../src/vector-path-gpu-geometry.ts", import.meta.url)));

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
assert.equal(
  compileVectorTextEffect(
    sourceRectangle,
    lod,
    { kind: "source-outline", width: 0, join: "round" },
    "width-zero",
  ),
  null,
);
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
const blockMesh = compileVectorTextEffect(
  sourceRectangle,
  lod,
  { kind: "block", vectorX: 23, vectorY: 17 },
  "block",
);
assert.ok(blockMesh);
const blockBounds = absoluteMeshBounds(blockMesh);
assert.ok(blockBounds.right >= 142.99);
assert.ok(blockBounds.bottom >= 116.99);
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

// Slug: un'intera shape, texture compatte/allineate e winding analitico.
const slugPath = polygonPath([outer, reverseRing(inner)]);
const slug = buildVectorTextSlugData(slugPath);
assert.equal(slug.revision, vectorTextPathRevision(slugPath));
assert.equal(slug.curveCount, 8);
for (const texture of [slug.curveTexture, slug.bandTexture]) {
  assert.ok(texture.width >= 16);
  assert.equal(texture.width & (texture.width - 1), 0);
  assert.equal((texture.width * 16) % 256, 0);
  assert.ok(texture.height >= 1 && texture.height <= 8192);
}
assert.ok(slug.horizontalBandCount >= 16 && slug.horizontalBandCount <= 255);
assert.ok(slug.verticalBandCount >= 16 && slug.verticalBandCount <= 255);
assert.ok(slug.maximumHorizontalCandidates <= 64);
assert.ok(slug.maximumVerticalCandidates <= 64);
assert.throws(
  () => buildVectorTextSlugData({ ...slugPath, fillRule: 1 }),
  /EvenOdd/,
);
assert.match(slugSource, /const sourceCurves = contours\.flatMap/);
assert.match(slugSource, /Math\.ceil\(\(minimum - boundsMinimum\)[\s\S]*- 1/);
assert.match(slugShaderSource, /length\(vec2<f32>\([\s\S]*dpdx/);
assert.match(slugShaderSource, /let alpha = coverage \* slug\.color\.a/);
assert.match(slugShaderSource, /vec4<f32>\(slug\.color\.rgb \* alpha, alpha\)/);
assert.match(slugShaderSource, /abs\(a\.y\) <= linearScale \/ 1048576\.0/);
assert.equal(
  slugShaderSource.match(/sourceCoordinateScale: f32/g)?.length,
  2,
);
assert.match(
  slugShaderSource,
  /max\(abs\(source12\.y\), max\(abs\(source12\.w\), abs\(source3\.y\)\)\)/,
);
assert.match(
  slugShaderSource,
  /max\(abs\(source12\.x\), max\(abs\(source12\.z\), abs\(source3\.x\)\)\)/,
);
const f32LineStart = Math.fround(300.00003);
const f32LineMiddle = Math.fround(300.01503);
const f32LineEnd = Math.fround(300.03003);
const f32LineSecondDifference = Math.abs(
  f32LineStart - f32LineMiddle * 2 + f32LineEnd,
);
const f32LineSpanScale = Math.max(
  1,
  Math.abs(f32LineStart - f32LineMiddle),
  Math.abs(f32LineMiddle - f32LineEnd),
  Math.abs(f32LineStart - f32LineEnd),
);
const f32LineAbsoluteScale = Math.max(
  1,
  Math.abs(f32LineStart),
  Math.abs(f32LineMiddle),
  Math.abs(f32LineEnd),
);
assert.ok(f32LineSecondDifference > f32LineSpanScale / 1048576);
assert.ok(f32LineSecondDifference <= f32LineAbsoluteScale / 1048576);
assert.doesNotMatch(slugSource, /perGlyph|glyphQuads|one quad per glyph/i);
assert.match(curveSource, /throw new Error\([\s\S]*depth/i);

// Blur singolo: mask Slug R8, Gaussian separabile, ROI e kernel bounded.
assert.equal(VECTOR_TEXT_SINGLE_SHADOW_BLUR_MAXIMUM, 300);
assert.equal(vectorTextSingleShadowBlurSupport(0), 0);
assert.equal(vectorTextSingleShadowBlurSupport(6), 19);
assert.equal(VECTOR_TEXT_SINGLE_SHADOW_MAX_PIXELS, 4 * 1024 * 1024);
assert.equal(VECTOR_TEXT_SINGLE_SHADOW_MAX_KERNEL_RADIUS, 24);
const blurPlan = planVectorTextSingleShadowBlur(
  { left: 0, top: 0, right: 100, bottom: 40 },
  6,
  1,
);
assert.deepEqual([...blurPlan.bounds], [-19, -19, 119, 59]);
assert.equal(blurPlan.width, 138);
assert.equal(blurPlan.height, 78);
assert.equal(blurPlan.sigmaPixels, 6);
assert.equal(blurPlan.radius, 18);
const cappedBlurPlan = planVectorTextSingleShadowBlur(
  { left: 0, top: 0, right: 100, bottom: 40 },
  6,
  10,
);
assert.ok(Math.abs(cappedBlurPlan.sigmaPixels - 8) < 1e-9);
assert.equal(cappedBlurPlan.radius, 24);
assert.ok(cappedBlurPlan.width * cappedBlurPlan.height <= VECTOR_TEXT_SINGLE_SHADOW_MAX_PIXELS);
assert.doesNotMatch(singleShadowSource, /Canvas|createElement|getContext|filter\s*=/);
assert.match(gpuShaderSource, /sourceTexture: texture_2d<f32>/);
assert.match(gpuShaderSource, /horizontalMain/);
assert.match(gpuShaderSource, /verticalMain/);
assert.match(gpuShaderSource, /textureSample\(blurredMask, blurredSampler, input\.uv\)\.r/);
assert.match(innerShadowShaderSource, /innerShadowDirectFragmentMain/);
assert.match(innerShadowShaderSource, /innerShadowBlurFragmentMain/);
assert.match(
  innerShadowShaderSource,
  /fillCoverage \* \(1\.0 - shiftedFillCoverage\)/,
);
assert.match(
  innerShadowShaderSource,
  /fillCoverage \* \(1\.0 - clamp\(shiftedBlurredFill/,
);
assert.match(innerShadowShaderSource, /slug\.effectSampleOffset\.xy/);
assert.match(innerShadowShaderSource, /textureSampleLevel\(/);
assert.doesNotMatch(innerShadowShaderSource, /Canvas|createElement|getContext/);

const appendDrawsStart = controllerSource.indexOf("  private appendGpuDrawsForNode(");
const appendDrawsEnd = controllerSource.indexOf(
  "  private blockShadowPathLogicalMiB(",
  appendDrawsStart,
);
const appendDrawsSource = controllerSource.slice(appendDrawsStart, appendDrawsEnd);
assert.ok(appendDrawsStart >= 0 && appendDrawsEnd > appendDrawsStart);
assert.ok(
  appendDrawsSource.indexOf("this.slugInnerShadowDraw")
    > appendDrawsSource.lastIndexOf("draws.push(this.slugDraw("),
  "l’ombra interna deve essere composta dopo il riempimento",
);
const runBoundsStart = engineSource.indexOf("  private vectorTextGpuRunBounds(");
const runBoundsEnd = engineSource.indexOf(
  "  private vectorTextGpuClearBounds(",
  runBoundsStart,
);
const runBoundsSource = engineSource.slice(runBoundsStart, runBoundsEnd);
assert.doesNotMatch(runBoundsSource, /slug-inner-shadow/);
assert.match(engineSource, /Vector text inner shadow direct Slug MSAA4/);
assert.match(engineSource, /Vector text inner shadow blurred Slug clip MSAA4/);

// Controller/Worker: sempre GPU, scambio atomico, coda coalescente e bbox semantica.
assert.match(controllerSource, /updateVectorTextGpuPresentation\(/);
assert.doesNotMatch(controllerSource, /updateVectorTextPresentation\(/);
assert.equal((controllerSource.match(/getContext\("2d"/g) ?? []).length, 1);
assert.match(controllerSource, /this\.interactionCanvas\.getContext\("2d"/);
assert.match(controllerSource, /this\.presentationCanvas\.width = 1/);
assert.match(controllerSource, /this\.presentationCanvas\.hidden = true/);
assert.doesNotMatch(controllerSource, /VectorTextAdaptiveZoomDetector|enterFastZoomMode|finishFastZoomMode|scheduleFastInteractionOverlay/);
assert.match(controllerSource, /setAdaptiveZoomEnabled\(_enabled: boolean\): void \{[\s\S]*updateAdaptiveZoomIndicator\(\)/);
assert.match(adaptiveSource, /disabled-vector-lod-worker-node-atomic-latest-only-v3/);
assert.doesNotMatch(adaptiveSource, /shouldArmFastMode|frozen-viewport/);
assert.match(controllerSource, /if \(node\.outlineWidth > 0\) \{[\s\S]*kind: "source-outline"/);
assert.match(controllerSource, /if \(node\.blockShadowOutlineWidth > 0\) \{[\s\S]*kind: "block-outline"/);
assert.match(controllerSource, /node\.singleShadowBlur > 0[\s\S]*this\.slugBlurDraw/);
assert.match(controllerSource, /else \{[\s\S]*this\.slugDraw\(/);
assert.match(controllerSource, /Slug vettoriale WebGPU, nessuna bitmap/);
assert.doesNotMatch(fontGeometrySource, /Path2D|canvasPath|buildShadow3dPath/);
assert.match(clientSource, /private activeRequestId: number \| null = null/);
assert.match(clientSource, /private readonly queuedBySlot = new Map/);
assert.match(clientSource, /this\.queuedBySlot\.set\(slotKey, queued\)/);
assert.match(clientSource, /desiredKeyBySlot\.values\(\)[\s\S]*desiredKey === response\.cacheKey/);
assert.match(clientSource, /currentAlreadyFiner[\s\S]*current\.lodBucket >= lod\.bucket/);
assert.match(clientSource, /if \(!currentAlreadyFiner\) \{[\s\S]*this\.requestEffect/);
assert.match(clientSource, /matchesRequestedIdentity: current\?\.effectIdentity === identity/);
assert.doesNotMatch(clientSource, /displayed\.sourceRevision !== sourceRevision/);
assert.match(clientSource, /MAXIMUM_READY_EFFECT_CACHE_ENTRIES = 48/);
assert.match(clientSource, /MAXIMUM_REGISTERED_PATHS = 128/);
assert.match(clientSource, /protectedRevisions/);
assert.match(clientSource, /type: "release-path"/);
assert.match(workerProtocolSource, /ReleaseVectorTextPathMessage/);
assert.match(workerSource, /message\.type === "release-path"[\s\S]*paths\.delete/);
assert.match(controllerSource, /displayedDrawsByNodeId/);
assert.match(controllerSource, /allEffectsReady \|\| !displayedDraws/);
assert.match(controllerSource, /retargetDisplayedDraws\(displayedDraws, node\)/);
assert.match(controllerSource, /dataset\.atomicEffectPendingNodes/);
assert.match(workerSource, /postMessage\([\s\S]*mesh\.vertices\.buffer[\s\S]*mesh\.indices\.buffer/);
assert.match(geometrySource, /const MITER_LIMIT = 4/);
assert.match(geometrySource, /Il contratto richiede bevel, non square/);
assert.match(geometrySource, /exactCrossSign\(vectorX, vectorY, edgeX, edgeY\) <= 0/);
assert.match(geometrySource, /canonicalSetFromPaths\(pieces\)/);
assert.match(geometrySource, /ClipType\.Difference/);
assert.match(geometrySource, /triangulationDeviation > 1e-8/);
assert.match(geometrySource, /if \(quantized\.length >= 3\)/);

const textCornersStart = controllerSource.indexOf("  private textCorners(");
const textCornersEnd = controllerSource.indexOf("  private rotationHandle(", textCornersStart);
assert.ok(textCornersStart >= 0 && textCornersEnd > textCornersStart);
const textCornersSource = controllerSource.slice(textCornersStart, textCornersEnd);
assert.doesNotMatch(textCornersSource, /blockShadow|singleShadow|outlineWidth|blur/);
assert.match(controllerSource, /effectLodForNode[\s\S]*Math\.abs\(node\.scale \* view\.zoom\)/);
assert.match(controllerSource, /!this\.host\.isPaintStrokeActive\(\)/);

// WebGPU resources: MSAA4 senza vecchio stencil, premultiplied source-over e destroy esplicito.
assert.doesNotMatch(engineSource, /vectorTextGpuDepthStencil|VECTOR_TEXT_GPU_DEPTH_STENCIL_FORMAT/);
assert.doesNotMatch(engineSource, /Vector text outline stencil union/);
assert.match(engineSource, /VECTOR_TEXT_GPU_SAMPLE_COUNT \+ 1/);
assert.match(engineSource, /srcFactor: "one"[\s\S]*dstFactor: "one-minus-src-alpha"/);
assert.match(engineSource, /Vector text analytic Slug mask for GPU blur/);
assert.match(engineSource, /Vector text GPU Gaussian horizontal/);
assert.match(engineSource, /Vector text GPU Gaussian vertical/);
assert.match(gpuResourcesSource, /resources\.curveTexture\.destroy\(\)[\s\S]*resources\.bandTexture\.destroy\(\)/);
assert.match(gpuResourcesSource, /resources\.vertexBuffer\.destroy\(\)[\s\S]*resources\.indexBuffer\.destroy\(\)/);
assert.match(engineSource, /resources\.texture\.destroy\(\)[\s\S]*vectorTextGpuBlurCaches\.delete/);
assert.match(engineSource, /if \(activeBlurCacheCount === 0\) \{[\s\S]*releaseVectorTextGpuBlurScratch/);
assert.doesNotMatch(controllerSource, /document\.createElement\("canvas"\)/);
assert.doesNotMatch(controllerSource, /strokeText\(|fillText\(|canvasPath/);

// UI e font locali.
assert.equal(VECTOR_TEXT_FONT_MANIFEST.length, 3);
const fontLogicalBytes = VECTOR_TEXT_FONT_MANIFEST.reduce(
  (total, entry) => total + fs.statSync(entry.fileUrl).size,
  0,
);
assert.equal(fontLogicalBytes, 392_528);
for (const id of [
  "vectorTextPrototypeSection",
  "vectorTextValue",
  "vectorTextFontFamily",
  "vectorTextFontSize",
  "vectorTextColor",
  "vectorTextTransformNone",
  "vectorTextTransformArch",
  "vectorTextTransformCircle",
  "vectorTextTransformWave",
  "vectorTextTransformCurveParameters",
  "vectorTextTransformCurve",
  "vectorTextTransformCurveOut",
  "vectorTextTransformCircleParameters",
  "vectorTextCircleRadius",
  "vectorTextCircleRadiusOut",
  "vectorTextCircleInverted",
  "vectorTextOutlineWidth",
  "vectorTextOutlineColor",
  "vectorTextOutlineJoin",
  "vectorTextBlockShadowEnabled",
  "vectorTextBlockShadowColor",
  "vectorTextBlockShadowOpacity",
  "vectorTextBlockShadowOffset",
  "vectorTextBlockShadowAngle",
  "vectorTextBlockShadowOutlineWidth",
  "vectorTextSingleShadowEnabled",
  "vectorTextSingleShadowColor",
  "vectorTextSingleShadowOpacity",
  "vectorTextSingleShadowOffset",
  "vectorTextSingleShadowAngle",
  "vectorTextSingleShadowBlur",
  "vectorTextInnerShadowEnabled",
  "vectorTextInnerShadowParameters",
  "vectorTextInnerShadowColor",
  "vectorTextInnerShadowOpacity",
  "vectorTextInnerShadowOffset",
  "vectorTextInnerShadowAngle",
  "vectorTextInnerShadowBlur",
  "vectorTextSingleShadowOutlineWidth",
  "addVectorText",
  "deleteVectorText",
  "vectorTextReset",
  "vectorTextStatus",
  "vectorTextZoomMode",
  "vectorTextPresentationCanvas",
  "vectorTextInteractionCanvas",
]) {
  assert.match(htmlSource, new RegExp(`id="${id}"`), `elemento #${id} mancante`);
}
assert.match(
  htmlSource,
  /id="vectorTextSingleShadowOutlineWidth"[\s\S]*?value="0"[\s\S]*?disabled/,
);
assert.match(mainSource, /const vectorTextEditorEnabled = true/);
assert.match(mainSource, /vectorTextPrototypeEnabled: vectorTextEditorEnabled/);
assert.match(mainSource, /if \(vectorTextEditorEnabled\)/);
assert.doesNotMatch(mainSource, /pageSearchParams\.get\("vectorTextTest"\)/);
assert.doesNotMatch(mainSource, /innerShadowTest/);
assert.match(mainSource, /__vectorTextPrototype = vectorTextPrototype/);
assert.equal(packageJson.scripts["vector-text:verify"], "node scripts/verify-vector-text.mjs");

console.log(
  "Testo vettoriale verificato: Distort/Arch/Circle/Wave Kittl, Slug analitico, Clipper64/Worker, outline fused senza seam, 0 no-op, "
  + "Block Shadow canonica, blur Gaussian R8 GPU, swap di nodo atomici, coda latest-only e nessun fallback bitmap.",
);
