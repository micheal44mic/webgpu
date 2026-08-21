import assert from "node:assert/strict";
import fs from "node:fs";
import { area, difference, FillRule } from "clipper2-ts";
import { readEngineSource } from "./engine-source.mjs";

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
  VECTOR_TEXT_BLOCK_INNER_OVERLAP_PIXELS,
  VECTOR_TEXT_OUTLINE_INNER_OVERLAP_PIXELS,
  buildOutsideVectorTextOutline,
  buildVectorTextBlockSet,
  buildVisibleVectorTextBlockSet,
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
  VECTOR_TEXT_GPU_BLUR_BYTES_PER_PIXEL,
  VECTOR_TEXT_GPU_RENDER_STRATEGY,
  VECTOR_TEXT_GPU_SAMPLE_COUNT,
  VECTOR_TEXT_GPU_TARGET_BYTES_PER_PIXEL,
  VECTOR_TEXT_GPU_TARGET_FORMAT,
  VECTOR_TEXT_GPU_UNIFORM_BYTES,
  VECTOR_TEXT_GPU_UNIFORM_FLOATS,
} from "../src/vector-text-gpu-shader.ts";
import {
  VECTOR_TEXT_SLUG_GPU_RENDER_STRATEGY,
} from "../src/vector-text-slug-gpu-shader.ts";
import {
  VECTOR_TEXT_PRESENTATION_STRATEGY,
} from "../src/vector-text-shader.ts";
import {
  VECTOR_TEXT_ADAPTIVE_ZOOM_SETTLE_MS,
  VECTOR_TEXT_ADAPTIVE_ZOOM_STRATEGY,
  VECTOR_TEXT_FAST_PRESENTATION_FILTER_GUARD_PX,
  VECTOR_TEXT_FAST_PRESENTATION_MAX_IN_FLIGHT,
  VECTOR_TEXT_WIDE_FALLBACK_MAX_ZOOM,
  VECTOR_TEXT_ZOOM_AB_IDLE_FRAME_COUNT,
  VECTOR_TEXT_ZOOM_AB_SAMPLE_COUNT,
  VECTOR_TEXT_ZOOM_AB_START_ZOOM,
  VECTOR_TEXT_ZOOM_AB_STRATEGY,
  VECTOR_TEXT_ZOOM_C_IDLE_FRAME_COUNT,
  VECTOR_TEXT_ZOOM_C_GESTURE_DURATION_MS,
  VECTOR_TEXT_ZOOM_C_SAMPLE_LIMIT,
  VECTOR_TEXT_ZOOM_C_FALLBACK_ZOOM,
  VECTOR_TEXT_ZOOM_C_START_ZOOM,
  VECTOR_TEXT_ZOOM_C_STRATEGY,
  VECTOR_TEXT_ZOOM_C_TARGET_ZOOM,
  VECTOR_TEXT_ZOOM_STRESS_PROFILE_ORDER,
  VECTOR_TEXT_ZOOM_STRESS_SEED,
  VECTOR_TEXT_ZOOM_STRESS_STRATEGY,
  VECTOR_TEXT_ZOOM_STRESS_TARGET_ZOOM,
  VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT,
  vectorTextExactRecoveryIsCurrent,
  vectorTextCaptureCoversDocument,
  vectorTextFastPresentationMode,
  vectorTextWideFallbackView,
  vectorTextZoomCoverageSeed,
  vectorTextZoomStressSeed,
  vectorTextZoomStressStepFactor,
} from "../src/vector-text-adaptive-zoom.ts";
import {
  VECTOR_SVG_IMPORT_STRATEGY,
  VECTOR_SVG_MAXIMUM_COMMANDS,
  VECTOR_SVG_MAXIMUM_GRADIENT_STOPS,
  VECTOR_SVG_MAXIMUM_SOURCE_BYTES,
} from "../src/vector-svg-import.ts";
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

const engineSource = readEngineSource();
const controllerSource = read("src/mixed-scene-controller.ts");
const controllerContractSource = read("src/mixed-scene-controller-contract.ts");

// Hidden semantic nodes are omitted by MixedSceneStack when it names a
// compositor run. The live controller must omit them from the texture key too;
// otherwise hiding one text/SVG makes every still-visible vector in that run
// disappear because the compositor cannot find the differently named texture.
const liveRunGroupingStart = controllerSource.indexOf("      const appendVectorToRun = (");
const liveRunGroupingEnd = controllerSource.indexOf(
  "      const nextRunKeys = ",
  liveRunGroupingStart,
);
assert.notEqual(liveRunGroupingStart, -1);
assert.notEqual(liveRunGroupingEnd, -1);
const liveRunGroupingSource = controllerSource.slice(
  liveRunGroupingStart,
  liveRunGroupingEnd,
);
assert.match(
  liveRunGroupingSource,
  /if \(!node\.visible \|\| node\.opacity <= 0\)[\s\S]*?return;[\s\S]*?pendingNodes\.push\(node\)/,
);
assert.match(
  liveRunGroupingSource,
  /item\.kind === "text"\) appendVectorToRun\(item\.textNode\)[\s\S]*?item\.kind === "svg"\) appendVectorToRun\(item\.svgNode\)/,
);
assert.doesNotMatch(
  liveRunGroupingSource,
  /pendingNodes\.push\(item\.(?:textNode|svgNode)\)/,
);
const interactionOverlaySource = read("src/scene-interaction-overlay.ts");
const mobileToolSettingsSource = read("src/mobile-tool-settings-sheet.ts");
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
const mixedCompositorSource = read("src/mixed-scene-compositor-shader.ts");
const svgSource = read("src/vector-svg-import.ts");
const svgGradientStrokeFixture = read("scripts/fixtures/svg-gradient-stroke.svg");
const vectorRasterSource = read("src/engine-vector-raster-runtime.ts");
const mainSource = read("src/main.ts");
const canvasInputSource = read("src/canvas-input-controller.ts");
const editorLabsSource = read("src/labs/editor-labs.ts");
const labsStartupSource = read("src/labs/startup.ts");
const vectorZoomLabSource = read("src/labs/vector/vector-zoom-labs.ts");
const sitesBuildSource = read("scripts/prepare-sites-build.mjs");
const vectorZoomMigrationSource = read(".openai/drizzle/0005_vector_zoom_runs.sql");
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
  "gesture-window2-dual-gpu-auto-fallback-exact-settle-v7",
);
assert.equal(VECTOR_TEXT_ADAPTIVE_ZOOM_SETTLE_MS, 140);
assert.equal(VECTOR_TEXT_FAST_PRESENTATION_FILTER_GUARD_PX, 0.5);
assert.equal(VECTOR_TEXT_FAST_PRESENTATION_MAX_IN_FLIGHT, 2);
assert.equal(VECTOR_TEXT_WIDE_FALLBACK_MAX_ZOOM, 0.2);
assert.equal(
  VECTOR_TEXT_ZOOM_STRESS_STRATEGY,
  "ten-semantic-text-seeded-arch-drop-block-inner-center-zoom64-v1",
);
assert.equal(VECTOR_TEXT_ZOOM_STRESS_SEED, 0x5a17c0de);
assert.equal(VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT, 10);
assert.equal(VECTOR_TEXT_ZOOM_STRESS_TARGET_ZOOM, 64);
assert.equal(
  VECTOR_TEXT_ZOOM_AB_STRATEGY,
  "ten-semantic-text-pan180-refresh-during-vs-release-v1",
);
assert.equal(VECTOR_TEXT_ZOOM_AB_IDLE_FRAME_COUNT, 30);
assert.equal(VECTOR_TEXT_ZOOM_AB_SAMPLE_COUNT, 180);
assert.equal(VECTOR_TEXT_ZOOM_AB_START_ZOOM, 64);
assert.match(VECTOR_TEXT_ZOOM_C_STRATEGY, /dual-gpu-fallback/);
assert.equal(VECTOR_TEXT_ZOOM_C_IDLE_FRAME_COUNT, 30);
assert.equal(VECTOR_TEXT_ZOOM_C_SAMPLE_LIMIT, 120);
assert.equal(VECTOR_TEXT_ZOOM_C_GESTURE_DURATION_MS, 650);
assert.equal(VECTOR_TEXT_ZOOM_C_START_ZOOM, 8);
assert.equal(VECTOR_TEXT_ZOOM_C_TARGET_ZOOM, 0.3);
assert.equal(VECTOR_TEXT_ZOOM_C_FALLBACK_ZOOM, 0.2);
assert.equal(VECTOR_TEXT_ZOOM_STRESS_PROFILE_ORDER.length, 10);
assert.deepEqual(
  Object.fromEntries(
    ["arch", "drop-shadow", "block-shadow", "inner-shadow"].map((profile) => [
      profile,
      VECTOR_TEXT_ZOOM_STRESS_PROFILE_ORDER.filter((candidate) => candidate === profile).length,
    ]),
  ),
  { arch: 3, "drop-shadow": 3, "block-shadow": 2, "inner-shadow": 2 },
);
const stressSeedsA = Array.from(
  { length: VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT },
  (_, index) => vectorTextZoomStressSeed(index, 4096),
);
const stressSeedsB = Array.from(
  { length: VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT },
  (_, index) => vectorTextZoomStressSeed(index, 4096),
);
assert.deepEqual(stressSeedsA, stressSeedsB, "la fixture deve essere byte-deterministica");
assert.equal(stressSeedsA.filter(({ seed }) => seed.transformType === "arch").length, 3);
assert.equal(stressSeedsA.filter(({ seed }) => seed.singleShadowEnabled).length, 3);
assert.equal(stressSeedsA.filter(({ seed }) => seed.blockShadowEnabled).length, 2);
assert.equal(stressSeedsA.filter(({ seed }) => seed.innerShadowEnabled).length, 2);
assert.throws(() => vectorTextZoomStressSeed(10, 4096), /out of range/);
const portraitStressSeed = vectorTextZoomStressSeed(0, 1080, 1920).seed;
assert.ok(Math.abs(portraitStressSeed.x - 540) < 0.04);
assert.ok(Math.abs(portraitStressSeed.y - 960) < 0.04);
const coverageSeeds = Array.from(
  { length: VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT },
  (_, index) => vectorTextZoomCoverageSeed(index, 4096, {
    canvasWidth: 390,
    canvasHeight: 844,
    targetZoom: VECTOR_TEXT_ZOOM_C_TARGET_ZOOM,
  }),
);
assert.equal(new Set(coverageSeeds.map(({ seed }) => `${seed.x}:${seed.y}`)).size, 10);
assert.ok(coverageSeeds.every(({ seed }) => (
  Math.abs(seed.x - 2048) * VECTOR_TEXT_ZOOM_C_TARGET_ZOOM < 390 * 0.5
  && Math.abs(seed.y - 2048) * VECTOR_TEXT_ZOOM_C_TARGET_ZOOM < 844 * 0.5
)));
assert.deepEqual(
  coverageSeeds.map(({ profile }) => profile),
  [...VECTOR_TEXT_ZOOM_STRESS_PROFILE_ORDER],
  "C deve cambiare soltanto la distribuzione, non il mix deterministico degli effetti",
);
const portraitCoverageSeeds = Array.from(
  { length: VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT },
  (_, index) => vectorTextZoomCoverageSeed(index, 1080, 1920, {
    canvasWidth: 390,
    canvasHeight: 844,
    targetZoom: VECTOR_TEXT_ZOOM_C_TARGET_ZOOM,
  }),
);
assert.ok(portraitCoverageSeeds.every(({ seed }) => (
  seed.x >= 0 && seed.x <= 1080 && seed.y >= 0 && seed.y <= 1920
)));
assert.equal(portraitCoverageSeeds[0].seed.x, 540);
assert.equal(portraitCoverageSeeds[0].seed.y, 960);
let plannedZoom = 0.2;
let plannedZoomSteps = 0;
while (plannedZoom < VECTOR_TEXT_ZOOM_STRESS_TARGET_ZOOM && plannedZoomSteps < 64) {
  plannedZoom *= vectorTextZoomStressStepFactor(plannedZoom);
  plannedZoomSteps += 1;
}
assert.ok(Math.abs(plannedZoom - 64) < 1e-9);
assert.ok(plannedZoomSteps > 1 && plannedZoomSteps < 64);
const capturedView = {
  canvasWidth: 390,
  canvasHeight: 844,
  cssWidth: 390,
  cssHeight: 844,
  centerX: 2048,
  centerY: 2048,
  zoom: 1,
  rotationRadians: 0,
  rotationCos: 1,
  rotationSin: 0,
};
assert.equal(vectorTextFastPresentationMode(capturedView, capturedView), "reproject");
assert.equal(
  vectorTextFastPresentationMode(capturedView, { ...capturedView, zoom: 64 }),
  "reproject",
  "lo zoom-in fino a 64× resta interamente coperto dalla capture",
);
assert.equal(
  vectorTextFastPresentationMode(capturedView, { ...capturedView, zoom: 0.5 }),
  "reproject-clipped",
  "lo zoom-out deve seguire la camera e richiedere il refresh delle zone scoperte",
);
const wideCapture = { ...capturedView, zoom: VECTOR_TEXT_ZOOM_C_FALLBACK_ZOOM };
assert.equal(
  vectorTextFastPresentationMode(
    { ...capturedView, zoom: VECTOR_TEXT_ZOOM_C_START_ZOOM },
    {
      ...capturedView,
      centerX: capturedView.centerX + 180,
      centerY: capturedView.centerY + 50,
      zoom: VECTOR_TEXT_ZOOM_C_TARGET_ZOOM,
    },
    wideCapture,
  ),
  "reproject-fallback",
  "C deve coprire lo zoom-out con la seconda capture senza dichiararlo clipped",
);
const mobilePhysicalView = {
  ...capturedView,
  canvasWidth: 828,
  canvasHeight: 1500,
  cssWidth: 414,
  cssHeight: 750,
  centerX: 1024,
  centerY: 1024,
};
const automaticWideCapture = vectorTextWideFallbackView(mobilePhysicalView, 2048);
assert.equal(automaticWideCapture.zoom, VECTOR_TEXT_ZOOM_C_FALLBACK_ZOOM);
assert.equal(vectorTextCaptureCoversDocument(automaticWideCapture, 2048), true);
assert.equal(
  vectorTextFastPresentationMode(
    { ...mobilePhysicalView, zoom: VECTOR_TEXT_ZOOM_C_START_ZOOM },
    {
      ...mobilePhysicalView,
      centerX: 1400,
      centerY: 700,
      zoom: 0.02,
    },
    automaticWideCapture,
    2048,
  ),
  "reproject-fallback",
  "la fallback production copre i pixel documento anche a zoom-out estremo",
);
assert.equal(
  vectorTextCaptureCoversDocument({ ...automaticWideCapture, zoom: 0.5 }, 2048),
  false,
  "una cache larga che non contiene l'intero documento non deve essere pubblicabile",
);
const rectangularViewport = {
  ...capturedView,
  canvasWidth: 300,
  canvasHeight: 100,
  cssWidth: 300,
  cssHeight: 100,
  centerX: 12,
  centerY: 34,
};
const portraitWideCapture = vectorTextWideFallbackView(
  rectangularViewport,
  1080,
  1920,
);
assert.equal(portraitWideCapture.centerX, 540);
assert.equal(portraitWideCapture.centerY, 960);
assert.equal(
  portraitWideCapture.zoom,
  Math.min(300 / 1080, 100 / 1920) * 0.94,
);
assert.equal(vectorTextCaptureCoversDocument(portraitWideCapture, 1080, 1920), true);
assert.equal(
  vectorTextCaptureCoversDocument(portraitWideCapture, 1080, 3000),
  false,
  "la copertura deve verificare l'altezza reale, non il solo asse massimo",
);
assert.equal(
  vectorTextFastPresentationMode(
    { ...rectangularViewport, zoom: 8 },
    { ...rectangularViewport, zoom: 0.02 },
    portraitWideCapture,
    1080,
    1920,
  ),
  "reproject-fallback",
);

function simulateFastPresentationWindow(capacity, frameCount) {
  const completions = [];
  let inFlight = 0;
  let peakInFlight = 0;
  let submissionCount = 0;
  let coalescedCount = 0;
  for (let tick = 0; tick < frameCount; tick += 1) {
    for (let index = completions.length - 1; index >= 0; index -= 1) {
      if (completions[index] <= tick) {
        completions.splice(index, 1);
        inFlight -= 1;
      }
    }
    if (inFlight >= capacity) {
      coalescedCount += 1;
      continue;
    }
    submissionCount += 1;
    inFlight += 1;
    peakInFlight = Math.max(peakInFlight, inFlight);
    const callbackDelayTicks = submissionCount % 2 === 1 ? 1 : 2;
    completions.push(tick + callbackDelayTicks);
  }
  return { submissionCount, coalescedCount, peakInFlight };
}

const singleSlotTrace = simulateFastPresentationWindow(1, 40);
assert.equal(singleSlotTrace.submissionCount, 27);
assert.equal(singleSlotTrace.coalescedCount, 13);
const twoSlotTrace = simulateFastPresentationWindow(
  VECTOR_TEXT_FAST_PRESENTATION_MAX_IN_FLIGHT,
  40,
);
assert.equal(twoSlotTrace.submissionCount, 40);
assert.equal(twoSlotTrace.coalescedCount, 0);
assert.equal(twoSlotTrace.peakInFlight, 2);

const schedulerState = {
  inFlight: 0,
  latest: null,
  submitted: [],
  peak: 0,
};
const requestSchedulerRevision = (revision) => {
  if (schedulerState.inFlight >= VECTOR_TEXT_FAST_PRESENTATION_MAX_IN_FLIGHT) {
    schedulerState.latest = revision;
    return;
  }
  schedulerState.submitted.push(revision);
  schedulerState.inFlight += 1;
  schedulerState.peak = Math.max(schedulerState.peak, schedulerState.inFlight);
};
const completeSchedulerRevision = () => {
  schedulerState.inFlight -= 1;
  if (schedulerState.latest !== null) {
    const latest = schedulerState.latest;
    schedulerState.latest = null;
    requestSchedulerRevision(latest);
  }
};
requestSchedulerRevision(1);
requestSchedulerRevision(2);
for (let revision = 3; revision <= 20; revision += 1) {
  requestSchedulerRevision(revision);
}
completeSchedulerRevision();
completeSchedulerRevision();
completeSchedulerRevision();
assert.deepEqual(schedulerState.submitted, [1, 2, 20]);
assert.equal(schedulerState.peak, 2);
assert.equal(schedulerState.inFlight, 0);
assert.equal(schedulerState.latest, null);
assert.equal(
  vectorTextFastPresentationMode(capturedView, { ...capturedView, centerX: 2500 }),
  "reproject-clipped",
  "un pan oltre la capture deve restare agganciato e usare il refresh esatto bounded",
);
assert.equal(
  vectorTextFastPresentationMode(capturedView, { ...capturedView, canvasWidth: 430 }),
  "reproject-clipped",
  "un resize non è coperto dalla cache viewport precedente",
);
const capturedZoom64View = { ...capturedView, zoom: VECTOR_TEXT_ZOOM_AB_START_ZOOM };
assert.equal(
  vectorTextFastPresentationMode(capturedZoom64View, {
    ...capturedZoom64View,
    centerX: capturedZoom64View.centerX + 1 / VECTOR_TEXT_ZOOM_AB_START_ZOOM,
  }),
  "reproject-clipped",
  "un pan di un pixel a 64× deve esercitare il ramo clipped del test A/B",
);
assert.equal(vectorTextExactRecoveryIsCurrent(100, 100, false), true);
assert.equal(vectorTextExactRecoveryIsCurrent(99, 100, false), false);
assert.equal(vectorTextExactRecoveryIsCurrent(100, 100, true), false);
let runnableRecoveries = 0;
for (let revision = 1; revision <= 100; revision += 1) {
  if (vectorTextExactRecoveryIsCurrent(revision, 100, false)) runnableRecoveries += 1;
}
assert.equal(
  runnableRecoveries,
  1,
  "una raffica di 100 campioni conserva una sola recovery, quella latest",
);
assert.equal(
  VECTOR_TEXT_OUTLINE_STRATEGY,
  "webgpu-clipper64-worker-outside-offset-aa-overlap1px-same-color-fused-round-bevel-miter4-v6",
);
assert.equal(
  VECTOR_TEXT_BLOCK_SHADOW_STRATEGY,
  "webgpu-clipper64-worker-visible-swept-union-separate-clipped-overlap2px-mesh-v8",
);
assert.equal(
  VECTOR_TEXT_SINGLE_SHADOW_STRATEGY,
  "webgpu-slug-zero-blur-or-r16float-separable-gaussian-v3",
);
assert.equal(
  VECTOR_TEXT_INNER_SHADOW_STRATEGY,
  "webgpu-slug-analytic-fill-clip-zero-blur-or-r16float-separable-gaussian-v2",
);
assert.equal(
  VECTOR_TEXT_SINGLE_SHADOW_BLUR_STRATEGY,
  "webgpu-slug-r16float-mask-separable-gaussian-roi-cache-v3",
);
assert.equal(
  VECTOR_TEXT_GPU_GEOMETRY_STRATEGY,
  "clipper64-nonzero-worker-native-round-bevel-exact-miter-aa-overlap-same-color-union-visible-block-separate-clipped-overlap2px-earcut-v10",
);
assert.equal(VECTOR_TEXT_GEOMETRY_COMPILER_VERSION, "clipper64-nonzero-lod-worker-v10");
assert.equal(
  VECTOR_TEXT_SLUG_GPU_RENDER_STRATEGY,
  "webgpu-slug-source-clipper-effect-mesh-msaa4-stable-lines-absolute-f32-scale-v5",
);
assert.equal(
  VECTOR_TEXT_SLUG_COMPILER_VERSION,
  "three-text-slug-0.6.5-whole-node-compact-bands-inclusive-v2",
);
assert.equal(
  VECTOR_TEXT_GPU_RENDER_STRATEGY,
  "webgpu-indexed-vector-linear-rgba16float-msaa4-svg-gradients-v3",
);
assert.equal(VECTOR_TEXT_GPU_UNIFORM_FLOATS, 60);
assert.equal(VECTOR_TEXT_GPU_UNIFORM_BYTES, 240);
assert.equal(VECTOR_TEXT_GPU_TARGET_FORMAT, "rgba16float");
assert.equal(VECTOR_TEXT_GPU_TARGET_BYTES_PER_PIXEL, 8);
assert.equal(VECTOR_TEXT_GPU_SAMPLE_COUNT, 4);
assert.equal(VECTOR_TEXT_GPU_BLUR_FORMAT, "r16float");
assert.equal(VECTOR_TEXT_GPU_BLUR_BYTES_PER_PIXEL, 2);
assert.equal(MIXED_SCENE_LINEAR_FORMAT, "rgba16float");
assert.equal(
  MIXED_SCENE_COMPOSITOR_STRATEGY,
  "ordered-raster-vector-gpu-runs-rgba16f-viewport-source-over-raster-nearest-at-581pct-v4",
);
assert.equal(
  VECTOR_TEXT_FONT_GEOMETRY_STRATEGY,
  "local-opentype-outline-transform-v4-distort",
);
assert.equal(
  VECTOR_TEXT_TRANSFORM_STRATEGY,
  "centered-arch-wave-distort-six-vertex-four-handle-cubic-distance-warp-circle-rigid-glyph-v3",
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

// Transformations: preserve the calibrated preset contracts.
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

// Blur singolo: mask Slug R16F, Gaussian separabile, ROI e kernel bounded.
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
const blurSourceUniformStart = engineSource.indexOf(
  "export function writeVectorTextGpuBlurSourceUniform(",
);
const blurSourceUniformEnd = engineSource.indexOf(
  "\nexport function ",
  blurSourceUniformStart + 1,
);
assert.ok(
  blurSourceUniformStart >= 0 && blurSourceUniformEnd > blurSourceUniformStart,
  "uniform source della mask blur GPU non trovato",
);
const blurSourceUniformSource = engineSource.slice(
  blurSourceUniformStart,
  blurSourceUniformEnd,
);
assert.match(
  blurSourceUniformSource,
  /const sourceBounds = usesMesh\s*\?\s*draw\.blurBounds\s*:\s*\[\s*draw\.blurBounds\[0\] - draw\.slug\.originX,\s*draw\.blurBounds\[1\] - draw\.slug\.originY,\s*draw\.blurBounds\[2\] - draw\.slug\.originX,\s*draw\.blurBounds\[3\] - draw\.slug\.originY,/,
  "outer/inner Slug devono usare la ROI relativa, le mesh la ROI assoluta",
);
assert.match(
  engineSource,
  /function vectorTextGpuDrawUsesBlur\([\s\S]*draw\.mode === "slug-blur"[\s\S]*draw\.mode === "slug-inner-shadow-blur"[\s\S]*draw\.mode === "mesh-blur"[\s\S]*draw\.mode === "mesh-inner-shadow-blur"/,
  "la conversione source deve coprire outer/inner blur sia Slug sia mesh",
);
assert.match(
  blurSourceUniformSource,
  /upload\[base \+ 4\] = \(draw\.blurBounds\[0\] \+ draw\.blurBounds\[2\]\) \* 0\.5;\s*upload\[base \+ 5\] = \(draw\.blurBounds\[1\] \+ draw\.blurBounds\[3\]\) \* 0\.5;/,
  "il centro della texture blur deve restare nella ROI assoluta",
);
assert.match(
  blurSourceUniformSource,
  /upload\[base \+ 24\] = sourceBounds\[0\];\s*upload\[base \+ 25\] = sourceBounds\[1\];\s*upload\[base \+ 26\] = sourceBounds\[2\];\s*upload\[base \+ 27\] = sourceBounds\[3\];/,
  "solo i bounds letti dallo shader source devono diventare origin-relative",
);
const drawUniformStart = engineSource.indexOf(
  "export function writeVectorTextGpuDrawUniform(",
);
const drawUniformEnd = engineSource.indexOf(
  "\ntype MixedSceneBlendScratchCandidate",
  drawUniformStart,
);
assert.ok(
  drawUniformStart >= 0 && drawUniformEnd > drawUniformStart,
  "uniform del compositing testo GPU non trovato",
);
const drawUniformSource = engineSource.slice(drawUniformStart, drawUniformEnd);
assert.match(
  drawUniformSource,
  /const shapeBounds = vectorTextGpuDrawUsesBlur\(draw\)\s*\? draw\.blurBounds\s*:/,
  "il compositing del blur deve conservare la ROI assoluta",
);
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
assert.match(controllerContractSource, /root: ParentNode;[\s\S]*?browser: Window;/);
assert.match(controllerSource, /root\.querySelector<HTMLElement>\(`/);
assert.doesNotMatch(controllerSource, /document\.getElementById|\bwindow\./);
assert.match(
  mainSource,
  /new MixedSceneController\(engine, \{[\s\S]*?root: appElement,[\s\S]*?browser: window,/,
  "il controller vettoriale deve ricevere root e runtime browser dal bootstrap",
);
const controllerInitializeStart = controllerSource.indexOf("  async initialize(): Promise<void> {");
const controllerInitializeEnd = controllerSource.indexOf(
  "\n  syncScene(",
  controllerInitializeStart,
);
assert.ok(
  controllerInitializeStart >= 0 && controllerInitializeEnd > controllerInitializeStart,
);
const controllerInitializeSource = controllerSource.slice(
  controllerInitializeStart,
  controllerInitializeEnd,
);
assert.doesNotMatch(
  controllerInitializeSource,
  /addVectorTextNode|defaultSeed/,
  "l'avvio non deve creare automaticamente un livello testo",
);
assert.match(
  mobileToolSettingsSource,
  /private bindVectorHistoryControl\(control: HTMLElement\)/,
);
assert.match(
  mobileToolSettingsSource,
  /control\.type === "range"[\s\S]*pointerup[\s\S]*pointercancel[\s\S]*keyup[\s\S]*blur/,
);
assert.match(controllerSource, /beginSelectedVectorPropertyEdit\(\): boolean/);
assert.match(controllerSource, /commitSelectedVectorPropertyEdit\(\): boolean/);
assert.doesNotMatch(mobileToolSettingsSource, /sourceControl|dispatchMirrored|dispatchEvent/);
assert.match(
  controllerSource,
  /this\.host\.beginVectorHistoryEdit\("transform"\)/,
);
assert.match(
  controllerSource,
  /private async applyTransformSession\(\)[\s\S]*this\.host\.commitVectorHistoryEdit\(\)/,
);
assert.match(
  controllerSource,
  /private async cancelTransformSession\(\)[\s\S]*this\.host\.cancelVectorHistoryEdit\(\)/,
);
assert.doesNotMatch(
  controllerSource.slice(
    controllerSource.indexOf("  private finishPointer(event: PointerEvent): void {"),
  ),
  /this\.host\.commitVectorHistoryEdit\(\)/,
  "pointerup non deve creare una voce Undo prima di Applica",
);
assert.match(engineSource, /beginVectorHistoryEdit\(scope: "property" \| "transform" = "property"\): boolean/);
assert.match(engineSource, /commitVectorHistoryEdit\(\): boolean/);
assert.match(engineSource, /async cancelVectorHistoryEdit\(\): Promise<boolean>/);
assert.match(engineSource, /kind: "vector"[\s\S]*delta: MixedSceneVectorHistoryDelta/);
// Non un'asserzione di ordine sulla concatenazione (che codificherebbe solo la
// posizione dei moduli): due presenze distinte, con il ripristino vincolato a
// stare dentro la funzione che applica lo stato vettoriale.
assert.match(engineSource, /action\.kind === "vector"/);
const applyVectorStart = engineSource.indexOf("export async function applyVectorHistoryState(");
const applyVectorEnd = engineSource.indexOf("\nexport ", applyVectorStart + 1);
assert.ok(
  applyVectorStart >= 0 && applyVectorEnd > applyVectorStart,
  "applyVectorHistoryState non delimitabile",
);
assert.match(
  engineSource.slice(applyVectorStart, applyVectorEnd),
  /restoreVectorHistoryState\(/,
  "l'applicazione dello stato vettoriale deve ripristinare la scena",
);
assert.match(controllerSource, /scheduleViewSync\(\): void \{[\s\S]*this\.enterFastZoomMode\(\)/);
assert.match(
  controllerSource,
  /!this\.hasVectorPresentationNodes\(\) \|\| !this\.adaptiveZoomEnabled[\s\S]{0,300}this\.exitFastAfterScheduledRender = true/,
);
assert.match(controllerSource, /beginViewGesture\(\): void/);
assert.match(controllerSource, /endViewGesture\(\): void/);
assert.match(controllerSource, /requestExactRecovery\(revision: number\): void/);
assert.match(controllerSource, /requestUnsafeExactRefresh\(revision: number\): void/);
assert.match(controllerSource, /this\.unsafeExactRefreshInFlight[\s\S]*zoomUnsafeExactCoalescedCount/);
assert.match(controllerSource, /waitForVectorTextPresentationCompletion\(\)\.then/);
assert.match(
  controllerContractSource,
  /export type VectorTextClippedRefreshPolicy = "during-gesture" \| "on-release"/,
);
assert.match(
  controllerSource,
  /private readonly clippedRefreshPolicy: VectorTextClippedRefreshPolicy/,
  "la variante A/B deve essere immutabile per l'intera vita del controller",
);
assert.match(
  controllerSource,
  /if \(this\.clippedRefreshPolicy === "during-gesture"\) \{\s*this\.requestUnsafeExactRefresh/,
);
assert.doesNotMatch(controllerSource, /setExactRefreshDuringViewGestureEnabled/);
assert.match(
  controllerSource,
  /waitForVectorTextPresentationCompletion\(\)\.then\(\(\) => \{\s*this\.zoomUnsafeExactRefreshCompletedCount \+= 1/,
  "un refresh iniziato non basta: il report deve sapere se è stato completato prima del rilascio",
);
assert.match(controllerSource, /zoomUnsafeExactRefreshInFlight: this\.unsafeExactRefreshInFlight/);
assert.match(
  controllerSource,
  /zoomUnsafeExactRefreshRequestPending: this\.unsafeExactRefreshRequest !== null/,
);
assert.match(controllerSource, /vectorTextExactRecoveryIsCurrent\(/);
assert.match(controllerSource, /setAdaptiveZoomEnabled\(enabled: boolean\): void/);
assert.match(
  controllerSource,
  /if \(!enabled && this\.zoomRenderMode === "fast"\)[\s\S]{0,700}this\.viewGestureActive = false[\s\S]{0,700}this\.exitFastAfterScheduledRender = true/,
  "disabilitare il fast path durante un gesto deve forzare un redraw preciso senza attendere pointer-up",
);
assert.match(vectorZoomLabSource, /effectRefinementRenderDelta = Math\.max\([\s\S]{0,150}exactRenderDeltaDuringRecovery - 1/);
assert.doesNotMatch(
  vectorZoomLabSource,
  /exactRecoveryLatestOnly:[\s\S]{0,300}exactRenderDeltaDuringRecovery === 1/,
  "gli swap atomici LOD degli effetti possono raffinare la singola recovery senza creare altre recovery zoom",
);
assert.match(editorLabsSource, /this\.#report\.textContent = serialize\(report\)/);
assert.match(labsStartupSource, /search\.get\("lab"\) === "vector-zoom-release" \? "on-release" : "during-gesture"/);
assert.match(vectorZoomLabSource, /refreshMode === "during" \? "A" : "B"/);
assert.match(vectorZoomLabSource, /engine\.panByClientDelta\(1, 0\)/);
assert.match(vectorZoomLabSource, /VECTOR_TEXT_ZOOM_AB_IDLE_FRAME_COUNT/);
assert.match(vectorZoomLabSource, /VECTOR_TEXT_ZOOM_AB_SAMPLE_COUNT/);
assert.match(vectorZoomLabSource, /__vectorZoomAbReport/);
assert.match(vectorZoomLabSource, /unsafeExactRefreshCompletedDelta > 0/);
assert.match(
  vectorZoomLabSource,
  /unsafeExactRefreshStartedDelta === 0[\s\S]{0,220}exactRenderDeltaDuringGesture === 0/,
);
assert.ok(
  (canvasInputSource.match(/getVectorController\(\)\?\.beginViewGesture\(\)/g) ?? []).length >= 2,
  "pinch e pan/rotate devono armare il fast mode prima del primo movimento",
);
assert.ok(
  (canvasInputSource.match(/getVectorController\(\)\?\.endViewGesture\(\)/g) ?? []).length >= 2,
  "pointer-up deve richiedere il recovery preciso senza attendere il debounce",
);
assert.doesNotMatch(controllerSource, /zoomModeIndicator|updateAdaptiveZoomIndicator|Zoom vettori · GPU/);
assert.match(adaptiveSource, /gesture-window2-dual-gpu-auto-fallback-exact-settle-v7/);
assert.match(adaptiveSource, /for \(const \[x, y\] of \[/);
assert.match(engineSource, /vectorTextFastPresentationInFlightCount/);
assert.match(engineSource, /VECTOR_TEXT_FAST_PRESENTATION_MAX_IN_FLIGHT/);
assert.match(engineSource, /vectorTextFastPresentationLatestRequested/);
assert.match(engineSource, /vectorTextFastPresentationCoalescedRequestCount \+= 1/);
assert.match(engineSource, /vectorTextFastRequestedRevision \+= 1/);
assert.match(engineSource, /vectorTextFastSubmittedRevision = Math\.max/);
assert.match(engineSource, /vectorTextFastCompletedRevision = Math\.max/);
assert.match(engineSource, /waitForVectorTextFastPresentationRevision/);
assert.match(
  engineSource,
  /vectorTextFastPresentationInFlightCount[\s\S]{0,120}>= VECTOR_TEXT_FAST_PRESENTATION_MAX_IN_FLIGHT[\s\S]{0,120}vectorTextFastPresentationLatestRequested = true/,
  "solo il terzo frame fast deve entrare nel singolo slot latest-only",
);
assert.match(
  engineSource,
  /if \(this\.vectorTextFastPresentationEnabled\) \{\s*this\.trackVectorTextFastPresentationSubmission\(\)/,
  "anche un submit autoritativo concorrente deve consumare e ackare la camera più recente",
);
assert.match(engineSource, /device\.queue\.onSubmittedWorkDone\(\)\.then/);
assert.match(
  engineSource,
  /function writeCaptureViewUniform[\s\S]*if \(changed\) \{[\s\S]*queue\.writeBuffer/,
);
assert.doesNotMatch(
  mixedCompositorSource,
  /if \(capture\.fastMode > 1\.5\)/,
  "nessun fast mode deve bypassare la camera con un frame screen-space",
);
assert.match(mixedCompositorSource, /@group\(0\) @binding\(5\) var fallbackTexture/);
assert.match(mixedCompositorSource, /return mix\(fallbackColor, sourceColor, smoothstep/);
assert.match(engineSource, /captureVectorTextFallbackPresentation/);
assert.match(engineSource, /rebuildVectorTextGpuFallbackPresentation/);
assert.match(engineSource, /vectorTextFallbackPresentationComplete/);
assert.match(engineSource, /probeVectorTextFallbackAlpha/);
assert.match(engineSource, /probeVectorTextFastCompositeAlpha/);
assert.match(engineSource, /const texture = engine\.mixedSceneLinearTexture/);
assert.match(engineSource, /x \* bytesPerPixel \+ 6/);
assert.match(engineSource, /GPUTextureUsage\.COPY_SRC/);
assert.match(
  engineSource,
  /vectorTextFallbackCaptureView = null;\s*writeVectorTextFallbackCaptureUniforms\(engine\);\s*writeVectorTextCaptureUniforms\(engine\)/,
  "invalidare la fallback deve riclassificare subito il fast mode prima del frame successivo",
);
assert.match(controllerSource, /zoomFallbackReprojectionCount/);
assert.match(controllerContractSource, /readonly documentWidth: number;/);
assert.match(controllerContractSource, /readonly documentHeight: number;/);
assert.match(
  controllerSource,
  /vectorTextWideFallbackView\(\s*view,\s*this\.host\.documentWidth,\s*this\.host\.documentHeight,\s*\)/,
);
assert.match(
  controllerSource,
  /canvasWidth: this\.host\.documentWidth,[\s\S]{0,180}canvasHeight: this\.host\.documentHeight/,
);
assert.match(
  vectorRasterSource,
  /canvasWidth: engine\.documentWidth,[\s\S]{0,180}canvasHeight: engine\.documentHeight/,
);
assert.match(controllerSource, /fallbackPresentationDirty/);
assert.match(vectorZoomLabSource, /VECTOR_TEXT_ZOOM_C_START_ZOOM/);
assert.match(vectorZoomLabSource, /VECTOR_TEXT_ZOOM_C_TARGET_ZOOM/);
assert.match(vectorZoomLabSource, /__vectorZoomCoverageReport/);
assert.match(vectorZoomLabSource, /fallbackProbeAlphaPixelCounts/);
assert.match(vectorZoomLabSource, /fastCompositeProbeAlphaPixelCounts/);
assert.match(vectorZoomLabSource, /finalFastFrameAcknowledged/);
assert.match(vectorZoomLabSource, /initialRasterWasEmpty/);
const coverageFunctionStart = vectorZoomLabSource.indexOf("async function runVectorZoomCoverage");
const coverageFunctionEnd = vectorZoomLabSource.indexOf("async function runVectorZoomAb", coverageFunctionStart);
assert.ok(coverageFunctionStart >= 0 && coverageFunctionEnd > coverageFunctionStart);
const coverageFunctionSource = vectorZoomLabSource.slice(coverageFunctionStart, coverageFunctionEnd);
const rasterLifecycleIndex = coverageFunctionSource.indexOf('engine.addLayer("C raster lifecycle")');
const beginCoverageGestureIndex = coverageFunctionSource.indexOf("controller.beginViewGesture()");
assert.ok(rasterLifecycleIndex >= 0 && beginCoverageGestureIndex > rasterLifecycleIndex);
assert.doesNotMatch(
  coverageFunctionSource.slice(rasterLifecycleIndex, beginCoverageGestureIndex),
  /captureVectorTextFallbackPresentation/,
  "C deve provare il rebuild production dopo addLayer senza autoripararsi manualmente",
);
assert.match(coverageFunctionSource, /automaticFallbackRebuildDelta/);
assert.match(coverageFunctionSource, /rasterLifecycleRebuiltFallback/);
assert.match(vectorZoomLabSource, /const duringTrace = controller\.getDiagnostics\(\)/);
assert.match(
  vectorZoomLabSource,
  /fastPresentationSubmitDelta =\s*duringTrace\.zoomFastPresentationSubmissionCount/,
  "il drain di verifica non deve migliorare retroattivamente la metrica dei 650 ms",
);
assert.match(vectorZoomLabSource, /fastSubmittedRevisionLagMaximum <= 2/);
assert.match(vectorZoomLabSource, /fastPresentationMaximumInFlight >= 1/);
assert.match(vectorZoomLabSource, /fastPresentationMaximumInFlight <= 2/);
assert.match(vectorZoomLabSource, /fastPresentationCoalescedDelta <= Math\.ceil\(sampleCount \* 0\.1\)/);
assert.match(vectorZoomLabSource, /finalFastAckDurationMs <= 250/);
assert.match(vectorZoomLabSource, /VECTOR_TEXT_ZOOM_C_GESTURE_DURATION_MS/);
assert.match(vectorZoomLabSource, /\/api\/vector-zoom-runs/);
assert.match(vectorZoomLabSource, /runCode: report\.runCode/);
assert.match(editorLabsSource, /import\("\.\/vector\/vector-zoom-labs"\)/);
assert.doesNotMatch(mainSource, /__vectorZoom(?:Ab|Coverage|Stress)Report|\/api\/vector-zoom-runs/);
assert.match(sitesBuildSource, /handleVectorZoomRuns/);
assert.match(sitesBuildSource, /\/api\/vector-zoom-runs/);
assert.match(sitesBuildSource, /report\.passed !== VECTOR_ZOOM_CHECK_NAMES\.every/);
assert.doesNotMatch(
  sitesBuildSource,
  /report\.fallbackTextureCount !== 1|report\.exactRecoveryDelta !== 1/,
  "il backend deve salvare anche i report C falliti, non soltanto gli esiti verdi",
);
assert.match(vectorZoomMigrationSource, /CREATE TABLE IF NOT EXISTS vector_zoom_runs/);
assert.equal(
  (mixedCompositorSource.match(/return textureLoad\(sourceTexture, pixel, 0\);/g) ?? []).length,
  1,
  "il campionamento screen-space diretto deve esistere soltanto nel modo preciso",
);
assert.match(controllerSource, /if \(node\.outlineWidth > 0\) \{[\s\S]*kind: "source-outline"/);
assert.match(controllerSource, /if \(node\.blockShadowOutlineWidth > 0\) \{[\s\S]*kind: "block-outline"/);
assert.equal(
  (controllerSource.match(/Math\.hypot\(vector\.x, vector\.y\) > Number\.EPSILON/g) ?? []).length,
  2,
  "testo e SVG devono saltare la faccia Block Shadow completamente nascosta a offset zero",
);
assert.doesNotMatch(
  controllerSource,
  /Math\.hypot\(vector\.x, vector\.y\) <= Number\.EPSILON/,
);
assert.match(controllerSource, /node\.singleShadowBlur > 0[\s\S]*this\.slugBlurDraw/);
assert.match(controllerSource, /else \{[\s\S]*this\.slugDraw\(/);
assert.doesNotMatch(fontGeometrySource, /Path2D|canvasPath|buildShadow3dPath/);
assert.match(clientSource, /private activeRequestId: number \| null = null/);
assert.match(clientSource, /private readonly queuedBySlot = new Map/);
assert.match(clientSource, /this\.queuedBySlot\.set\(slotKey, queued\)/);
assert.match(clientSource, /desiredKeyBySlot\.values\(\)[\s\S]*desiredKey === response\.cacheKey/);
assert.match(clientSource, /requiresExactEffectLod[\s\S]*effect\.kind === "block"[\s\S]*effect\.kind === "block-outline"/);
assert.match(clientSource, /currentAlreadySuitable[\s\S]*current\.lodBucket === lod\.bucket[\s\S]*current\.lodBucket >= lod\.bucket/);
assert.match(clientSource, /if \(!currentAlreadySuitable\) \{[\s\S]*this\.requestEffect/);
assert.match(clientSource, /\|\| exactLod[\s\S]*ready\.lodBucket >= current\.lodBucket/);
assert.match(clientSource, /matchesRequestedIdentity: current\?\.effectIdentity === identity/);
assert.match(clientSource, /matchesRequestedLod: currentAlreadySuitable/);
assert.match(controllerSource, /!requireRequestedLod \|\| result\.matchesRequestedLod/);
assert.match(clientSource, /private readonly pinnedSlots = new Set<string>\(\)/);
assert.match(clientSource, /!liveSlots\.has\(slot\) && !this\.pinnedSlots\.has\(slot\)/);
assert.match(controllerSource, /slotNamespace = pinForRasterization \? "svg-raster" : "svg"/);
assert.match(controllerSource, /this\.effectCompiler\.pinSlot\(slotKey\)/);
assert.match(controllerSource, /finally \{[\s\S]*releasePinnedSlot\(slot\)/);
assert.doesNotMatch(clientSource, /displayed\.sourceRevision !== sourceRevision/);
assert.match(clientSource, /MAXIMUM_READY_EFFECT_CACHE_ENTRIES = 48/);
assert.match(clientSource, /MAXIMUM_REGISTERED_PATHS = 128/);
assert.match(clientSource, /protectedRevisions/);
assert.match(clientSource, /type: "release-path"/);
assert.match(workerProtocolSource, /ReleaseVectorTextPathMessage/);
assert.match(workerSource, /message\.type === "release-path"[\s\S]*paths\.delete/);
assert.match(controllerSource, /displayedDrawsByNodeKey/);
assert.match(controllerSource, /if \(allEffectsReady\) \{[\s\S]*else if \(displayedDraws\)/);
assert.match(controllerSource, /retargetDisplayedDraws\(displayedDraws, node\)/);
assert.match(controllerSource, /dataset\.atomicEffectPendingNodes/);
assert.match(workerSource, /postMessage\([\s\S]*mesh\.vertices\.buffer[\s\S]*mesh\.indices\.buffer/);
assert.match(geometrySource, /const MITER_LIMIT = 4/);
assert.match(geometrySource, /Il contratto richiede bevel, non square/);
assert.match(geometrySource, /exactCrossSign\(vectorX, vectorY, edgeX, edgeY\) <= 0/);
assert.match(geometrySource, /canonicalSetFromPaths\(pieces\)/);
assert.match(geometrySource, /ClipType\.Difference/);
assert.match(geometrySource, /ClipType\.Intersection/);
assert.match(geometrySource, /overlapPieces/);
assert.match(geometrySource, /triangulationDeviation > 1e-8/);
assert.match(geometrySource, /if \(quantized\.length >= 3\)/);

const textCornersStart = interactionOverlaySource.indexOf("export function sceneOverlayCorners(");
const textCornersEnd = interactionOverlaySource.indexOf(
  "export function sceneOverlayRotationHandle(",
  textCornersStart,
);
assert.ok(textCornersStart >= 0 && textCornersEnd > textCornersStart);
const textCornersSource = interactionOverlaySource.slice(textCornersStart, textCornersEnd);
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

// SVG: parser semantico sicuro, palette modificabile e gli stessi effetti mesh GPU.
assert.equal(VECTOR_SVG_IMPORT_STRATEGY, "sanitized-semantic-svg-gradients-retained-strokes-worker-lod-mesh-webgpu-v2");
assert.equal(VECTOR_SVG_MAXIMUM_SOURCE_BYTES, 5 * 1024 * 1024);
assert.equal(VECTOR_SVG_MAXIMUM_COMMANDS, 500_000);
assert.equal(VECTOR_SVG_MAXIMUM_GRADIENT_STOPS, 4);
assert.match(svgSource, /const SAFE_ELEMENTS = new Set/);
assert.match(svgSource, /"path", "rect", "circle", "ellipse", "line", "polyline", "polygon"/);
assert.match(svgSource, /Unsupported or unsafe SVG element/);
assert.match(svgSource, /SVG event handler is not allowed/);
assert.match(svgSource, /local href references between SVG gradients/);
assert.match(svgSource, /hasOnlyLocalPaintUrls/);
assert.match(svgSource, /parseGradientDefinitions/);
assert.match(svgSource, /expandedStrokePath/);
assert.match(svgSource, /sourcePath: clonePath\(localPath\)/);
assert.match(svgSource, /strokePercentageReference/);
assert.match(svgSource, /normalized\.endsWith\("%"\)\) return fallback/);
assert.match(svgGradientStrokeFixture, /<linearGradient id="base-colors"/);
assert.match(svgGradientStrokeFixture, /<radialGradient id="glow"/);
assert.match(svgGradientStrokeFixture, /href="#base-colors"/);
assert.match(svgGradientStrokeFixture, /stroke-dasharray="36 14"/);
assert.match(svgGradientStrokeFixture, /<line x1="455" y1="285" x2="455" y2="285"/);
assert.match(gpuShaderSource, /gradientMeta: vec4<u32>/);
assert.match(gpuShaderSource, /fn linearGradientParameter/);
assert.match(gpuShaderSource, /fn radialGradientParameter/);
assert.match(gpuShaderSource, /fn unpackGradientStop/);
assert.match(engineSource, /unsigned\[base \+ 32\] = gradient\.kind === "linear" \? 1 : 2/);
assert.match(controllerSource, /svgGradientGpuData\(paint\.gradient\)/);
assert.doesNotMatch(svgSource, /innerHTML|insertAdjacentHTML|eval\(/);
assert.match(controllerSource, /parseVectorSvg\(source, sourceName\)/);
assert.match(controllerSource, /this\.svgFileInput\.files\?\.\[0\]/);
assert.match(controllerSource, /kind: "source-fill"/);
assert.match(controllerSource, /this\.svgBlurDraw/);
assert.match(controllerSource, /kind === "outer"[\s\S]*mode: "mesh-blur"[\s\S]*mode: "mesh-inner-shadow-blur"/);
assert.match(gpuShaderSource, /fn blurMaskVertexMain/);
assert.match(gpuShaderSource, /fn meshInnerShadowFragmentMain/);

// Rasterizzazione vettoriale autorevole: SVG mesh e testo Slug usano target
// RGBA16F lineare, MSAA 4x, blocchi allineati ai tile e seed tiled Undo/Redo.
assert.match(
  vectorRasterSource,
  /semantic-vector-slug-mesh-webgpu-linear-layer-format-msaa4-512-tile-chunks-history-seed-v3/,
);
assert.match(vectorRasterSource, /VECTOR_RASTER_FORMAT = "rgba16float"/);
assert.match(vectorRasterSource, /VECTOR_RASTER_CHUNK_SIZE = LAYER_STORAGE_TILE_SIZE \* 2/);
assert.match(
  vectorRasterSource,
  /WeakMap<[\s\S]{0,120}Map<LayerFormat, Promise<VectorRasterPipelines>>/,
  "le pipeline raster vettoriali devono essere separate per formato documento",
);
assert.match(vectorRasterSource, /targets: \[\{ format, blend \}\]/);
assert.match(vectorRasterSource, /const format = destination\.format/);
assert.match(vectorRasterSource, /destination\.format !== engine\.layerFormat/);
assert.match(vectorRasterSource, /createVectorRasterScratch\(engine, format\)/);
assert.match(vectorRasterSource, /format,\s*usage: GPUTextureUsage\.RENDER_ATTACHMENT/);
assert.match(vectorRasterSource, /sampleCount: VECTOR_TEXT_GPU_SAMPLE_COUNT/);
assert.match(vectorRasterSource, /entryPoint: "fragmentMain"/);
assert.match(vectorRasterSource, /slugInnerShadowDirect/);
assert.match(vectorRasterSource, /slugInnerShadowBlur/);
assert.match(vectorRasterSource, /meshInnerShadowBlur/);
assert.match(vectorRasterSource, /createLayerColdStorageCandidate\(/);
assert.match(vectorRasterSource, /encodeLayerColdHydration\(/);
assert.match(vectorRasterSource, /analyzeRasterTextureOccupancy\(/);
assert.match(vectorRasterSource, /record\.storageTileMask\.set\(occupancy\.tileMask\)/);
assert.doesNotMatch(vectorRasterSource, /markLayerStorageRect\(record\.storageTileMask/);
assert.match(vectorRasterSource, /replaceVectorWithRaster\(/);
assert.match(vectorRasterSource, /replaceRasterWithVector\(/);
assert.match(vectorRasterSource, /action\.seed\.format !== engine\.layerFormat/);
assert.match(vectorRasterSource, /allocateLayerGpuResources\([\s\S]{0,100}action\.seed\.format/);
assert.match(vectorRasterSource, /runGpuAllocationTransaction\(/);
assert.match(vectorRasterSource, /No RGBA8 fallback is allowed/);
assert.doesNotMatch(vectorRasterSource, /format:\s*"rgba8unorm"/);
assert.doesNotMatch(
  vectorRasterSource,
  /CanvasRenderingContext2D|copyExternalImageToTexture|drawImage\(/,
  "la rasterizzazione non deve introdurre un fallback bitmap/Canvas2D",
);
assert.match(
  controllerSource,
  /async rasterizeSelectedSvg\(\s*propagateError = false,\s*\)/,
);
assert.match(controllerSource, /await this\.host\.rasterizeVectorSvgNode\(svgId, draws\)/);
assert.match(controllerSource, /async rasterizeSelectedText\(\)/);
assert.match(controllerSource, /await this\.host\.rasterizeVectorTextNode\(textId, draws\)/);
assert.match(controllerSource, /vectorRasterFormatLabel\(result\.format\)/);
assert.doesNotMatch(controllerSource, /rasterizzato in RGBA8/);
assert.match(controllerSource, /slotNamespace = pinForRasterization \? "text-raster" : "text"/);
assert.match(controllerSource, /!requireRequestedLod \|\| result\.matchesRequestedLod/);
assert.match(controllerSource, /resourceRevisionValue\(\)/);
assert.match(controllerSource, /private sceneOperationRenderDeferred = false/);
assert.match(
  controllerSource,
  /private renderNow\([\s\S]{0,220}\): boolean \{[\s\S]*this\.sceneOperationBusy[\s\S]*this\.sceneOperationRenderDeferred = true/,
);
assert.match(
  controllerSource,
  /if \(this\.sceneOperationRenderDeferred\) \{[\s\S]*this\.scheduleRender\(\)/,
);
assert.match(clientSource, /waitForResourceReady\(/);
assert.match(engineSource, /kind: "vector-rasterize"/);
assert.match(engineSource, /seedFormat: converted\.history\.seed\.format/);
assert.match(engineSource, /destroyVectorRasterHistorySeed\(/);
assert.match(engineSource, /this\.vectorTextGpuPendingRuns\.length = 0/);
assert.match(engineSource, /this\.vectorTextGpuPendingRuns\.splice\(index, 1\)/);
assert.match(vectorRasterSource, /activateLayer\([^;]*"structural-history"\)/);
assert.match(
  engineSource,
  /caller === "history-replay" \|\| caller === "structural-history"/,
);
const redoVectorStart = vectorRasterSource.indexOf("async function redoVectorRasterization(");
const redoVectorBody = vectorRasterSource.slice(redoVectorStart, redoVectorStart + 4_500);
const redoVectorTry = redoVectorBody.indexOf("try {");
const redoVectorHydration = redoVectorBody.indexOf("gpu = await hydrateHistorySeed");
assert.ok(
  redoVectorStart >= 0 && redoVectorTry >= 0 && redoVectorHydration > redoVectorTry,
  "l'OOM di reidratazione Redo deve attraversare il rollback strutturale",
);
assert.match(
  redoVectorBody,
  /discardVectorRasterCandidateAndRestoreOriginalActive\([\s\S]{0,180}action\.layerId,[\s\S]{0,80}gpu/,
  "il rollback Redo deve ritirare anche una candidata fallita prima dell'attach",
);

// Harness WebGPU reale: su una pagina dev nuova crea entrambe le sorgenti,
// legge i byte RGBA16F, attraversa Undo/Redo e richiede identità Uint8Array.
assert.match(controllerSource, /async runVectorRasterHistoryGpuTest\(\)/);
assert.match(controllerSource, /await runProbe\("text"\), await runProbe\("svg"\)/);
assert.match(controllerSource, /parseVectorSvg\([\s\S]{0,500}regression-rgba16f\.svg/);
assert.match(controllerSource, /rawBeforeUndo = await this\.host\.readLayerPixels/);
assert.match(controllerSource, /undoReturned = await this\.host\.undo\(\)/);
assert.match(controllerSource, /redoReturned = await this\.host\.redo\(\)/);
assert.match(controllerSource, /uint8ArraysEqual\(before, after\)/);
assert.match(controllerSource, /uint8ArraysEqual\(rawBeforeUndo, rawAfterRedo\)/);
assert.match(controllerSource, /probe\.seedFormat === "rgba16float"/);
assert.match(controllerSource, /probe\.rawBytesPerPixel === 8/);
assert.match(controllerSource, /probe\.nonZeroAlphaPixels > 0/);

assert.match(htmlSource, /id="mobileSvgStyleRasterize"/);
assert.match(htmlSource, /id="mobileTextRasterize"/);
assert.match(htmlSource, /id="vectorTextRasterStatus"/);

// UI e font locali.
assert.equal(VECTOR_TEXT_FONT_MANIFEST.length, 3);
const fontLogicalBytes = VECTOR_TEXT_FONT_MANIFEST.reduce(
  (total, entry) => total + fs.statSync(entry.fileUrl).size,
  0,
);
assert.equal(fontLogicalBytes, 392_528);
for (const id of [
  "vectorSvgFileInput",
  "vectorSvgImportStatus",
  "rasterImageFileInput",
  "rasterImageImportStatus",
  "mobileSvgStyleRasterize",
  "mobileTextRasterize",
  "vectorTextRasterStatus",
  "mobileTextValue",
  "mobileTextFontFamily",
  "mobileTextFontSize",
  "mobileTextColor",
  "mobileTextWarpNone",
  "mobileTextWarpDistort",
  "mobileTextWarpArch",
  "mobileTextWarpCircle",
  "mobileTextWarpWave",
  "mobileTextOutlineWidth",
  "mobileTextOutlineColor",
  "mobileTextOutlineJoin",
  "mobileTextBlockShadowEnabled",
  "mobileTextDropShadowEnabled",
  "mobileTextInnerShadowEnabled",
  "vectorTextStatus",
  "vectorTextPresentationCanvas",
  "vectorTextInteractionCanvas",
]) {
  assert.match(htmlSource, new RegExp(`id="${id}"`), `elemento #${id} mancante`);
}
assert.doesNotMatch(htmlSource, /id="vectorTextSingleShadowOutlineWidth"/);
assert.doesNotMatch(htmlSource, /id="vectorTextPrototypeSection"/);
assert.doesNotMatch(mainSource, /vectorTextEditorEnabled/);
assert.match(
  mainSource,
  /mixedSceneEnabled:\s*resolveMixedSceneEnabled\(editorExtensionEngineOptions, true\)/,
);
assert.match(mainSource, /if \(engine\.mixedSceneEnabled\)[\s\S]*?"deferred-mixed-scene"/);
assert.doesNotMatch(mainSource, /pageSearchParams\.get\("vectorTextTest"\)/);
assert.doesNotMatch(mainSource, /innerShadowTest/);
assert.doesNotMatch(htmlSource, /id="vectorTextZoomMode"/);
assert.match(mainSource, /__mixedSceneController = mixedSceneController/);
assert.doesNotMatch(mainSource, /vectorTextPrototype|MixedVectorText/);
assert.equal(packageJson.scripts["vector-text:verify"], "node scripts/verify-vector-text.mjs");

console.log(
  "Vector text verified: Distort/Arch/Circle/Wave, analytic slug, Clipper64/Worker, fused seamless outline, 0 no-op, "
  + "canonical Block Shadow, sanitized semantic SVG with GPU palette/effects, GPU R16F Gaussian blur, byte-exact RGBA16F text/SVG rasterization, atomic node swaps, latest-only queue, and no bitmap fallback.",
);

// --- Rollback: ownership candidata ritirata prima della reidratazione ----------
// Un fault compositing tardivo lascia il candidato hot e i cache transienti
// ancora vivi. Provare prima ad attivare l'originale ricrea il picco che ha
// causato il fault. Il rollback deve congelare, staccare e distruggere il
// candidato, quindi riattivare l'originale usando il suo indice ricalcolato.
{
  const vectorRaster = fs.readFileSync(
    new URL("../src/engine-vector-raster-runtime.ts", import.meta.url),
    "utf8",
  );
  const helper = vectorRaster.slice(
    vectorRaster.indexOf("async function discardVectorRasterCandidateAndRestoreOriginalActive("),
    vectorRaster.indexOf("export async function rasterizeVectorNodeToLayer("),
  );
  const freeze = helper.indexOf("engine.layerPresentationFrozen = true;");
  const selectOriginal = helper.indexOf("engine.layerStack.setActiveIndex(originalIndexBeforeDetach);");
  const detach = helper.indexOf("engine.layerStack.remove(candidateIndex);");
  const unregister = helper.indexOf("engine.layerGpu.delete(candidateLayerId)");
  const destroy = helper.indexOf("destroyLayerGpuResources(engine, registeredGpu)");
  const reactivate = helper.indexOf("await engine.activateLayer(originalIndex, caller);");
  assert.ok(
    freeze >= 0
      && selectOriginal > freeze
      && detach > selectOriginal
      && unregister > detach
      && destroy > unregister
      && reactivate > destroy,
    "freeze/stacco/destroy devono precedere la riattivazione dell'originale",
  );
  assert.doesNotMatch(
    helper,
    /activateLayer\([\s\S]{0,80}candidateIndex/,
    "un indice candidato rimosso non deve raggiungere commitActiveLayerResidency",
  );
  const freezeHelper = helper.slice(
    helper.indexOf("async function freezeVectorRasterPresentationForRollback("),
  );
  assert.match(
    freezeHelper,
    /try \{[\s\S]{0,500}await engine\.waitForIdle\(\);[\s\S]{0,120}\} finally \{[\s\S]{0,500}engine\.layerPresentationFrozen = true;/,
    "anche un drain fallito deve congelare la presentazione in fail-closed",
  );

  const conversion = vectorRaster.slice(
    vectorRaster.indexOf("export async function rasterizeVectorNodeToLayer("),
    vectorRaster.indexOf("export async function rollbackUnpublishedVectorRasterization("),
  );
  const conversionActivation = conversion.indexOf(
    'await engine.activateLayer(previousIndexAfterInsertion, "layer-switch");',
  );
  const conversionSeed = conversion.indexOf("seed = await createLayerColdStorageCandidate(");
  assert.ok(
    conversionActivation >= 0 && conversionSeed > conversionActivation,
    "il seed Undo va catturato dopo il picco transitorio dell'activation",
  );
  assert.ok(
    conversion.indexOf("await freezeVectorRasterPresentationForRollback(engine);") >= 0
      && conversion.indexOf("await freezeVectorRasterPresentationForRollback(engine);")
        < conversion.indexOf("scene.restoreState(originalSceneState);"),
    "un fault post-activation deve drenare il frame valido prima di mutare la scena",
  );
  assert.ok(
    conversion.indexOf("destroyLayerColdStorage(seed);")
      < conversion.indexOf("await discardVectorRasterCandidateAndRestoreOriginalActive("),
    "il seed fallito va liberato prima di reidratare l'originale",
  );

  const unpublished = vectorRaster.slice(
    vectorRaster.indexOf("export async function rollbackUnpublishedVectorRasterization("),
    vectorRaster.indexOf("async function switchActiveForStructuralHistory("),
  );
  assert.ok(
    unpublished.indexOf("await freezeVectorRasterPresentationForRollback(engine);") >= 0
      && unpublished.indexOf("await freezeVectorRasterPresentationForRollback(engine);")
        < unpublished.indexOf("scene.replaceRasterWithVector(action.layerId, action.vectorState);"),
    "un commit History rifiutato deve drenare il frame candidato prima del rollback",
  );
  assert.ok(
    unpublished.indexOf("destroyLayerColdStorage(action.seed);")
      < unpublished.indexOf("await discardVectorRasterCandidateAndRestoreOriginalActive("),
    "un commit History rifiutato deve ritirare il seed prima del rebuild",
  );
  const wrapper = engineSource.slice(
    engineSource.indexOf("  private async rasterizeVectorNode("),
    engineSource.indexOf("  async rasterizeVectorTextNode("),
  );
  assert.match(wrapper, /await rollbackUnpublishedVectorRasterization\(this, action\)/);
  assert.match(
    wrapper,
    /const combined = new Error\([\s\S]{0,300}latchDocumentStateInconsistent\([\s\S]{0,180}combined/,
    "il diagnostico fatale deve conservare errore iniziale e causa del rollback",
  );
}

console.log("Vector rasterize candidate-first rollback verified.");

// --- Race freeze + invalidazione derivata ------------------------------------
// Il completamento asincrono del preview vettoriale puo' accodare un RAF dopo
// prepareActiveLayerForSwitch(). Il drain strutturale puo' coalescere soltanto
// quel ridisegno derivato; qualunque mutazione raster reale resta fail-closed.
{
  const discardStart = engineSource.indexOf(
    "  private discardFrozenDerivedPresentationWork(): boolean {",
  );
  const idleStart = engineSource.indexOf("  async waitForIdle(", discardStart);
  const idleEnd = engineSource.indexOf("\n  resetStrokeRandomSeed()", idleStart);
  assert.ok(
    discardStart >= 0 && idleStart > discardStart && idleEnd > idleStart,
    "drain freeze-aware non delimitabile",
  );
  const discard = engineSource.slice(discardStart, idleStart);
  const idle = engineSource.slice(idleStart, idleEnd);
  for (const authoritativeWork of [
    "pendingStamps.length > 0",
    "pendingBlendBatches.length > 0",
    "clearRequested",
    "lightGlazeSession?.commitRequested",
    "lightGlazeSession?.endRequested",
    "thicknessTailPreviewEligible()",
    "thicknessTailPresentedRect !== null",
  ]) {
    assert.ok(
      discard.includes(authoritativeWork),
      `il drain congelato non protegge ${authoritativeWork}`,
    );
  }
  assert.match(
    discard,
    /cancelAnimationFrame\(this\.frameRequest\);[\s\S]*this\.frameRequest = null;[\s\S]*this\.displayDirty = false;[\s\S]*this\.presentationCacheNeedsFullRebuild = true;/,
    "il solo frame derivato va coalesciuto nella ricostruzione finale",
  );
  assert.match(
    idle,
    /options\.allowFrozenDerivedPresentation === true[\s\S]*discardFrozenDerivedPresentationWork\(\)[\s\S]*continue;[\s\S]*Presentation is frozen with pending render work/,
    "l'opt-in deve precedere senza sostituire il fail-closed standard",
  );
  const retargetStart = engineSource.indexOf(
    "export async function retargetEffectsWorkingSetInternal(",
  );
  const retargetEnd = engineSource.indexOf(
    "export async function benchmarkEffectsWorkingSet(",
    retargetStart,
  );
  const retarget = engineSource.slice(retargetStart, retargetEnd);
  assert.match(
    retarget,
    /retargetEffectsWorkingSetInternal[\s\S]*allowFrozenDerivedPresentation: caller !== "public"/,
    "il retarget strutturale deve drenare le invalidazioni tardive e quello pubblico no",
  );
  const rebuildStart = engineSource.indexOf("  async rebuildMergedLayerSurfaces(");
  const rebuildEnd = engineSource.indexOf(
    "\n  recordVectorHistoryAction(",
    rebuildStart,
  );
  const rebuild = engineSource.slice(rebuildStart, rebuildEnd);
  assert.match(
    rebuild,
    /rebuildMergedLayerSurfaces\([\s\S]{0,900}layerPresentationFrozen[\s\S]{0,200}caller !== "public"[\s\S]{0,200}waitForIdle\(\{ allowFrozenDerivedPresentation: true \}\)/,
    "anche il gate del compositing deve ricontrollare la race dopo il retarget GPU",
  );
}

console.log("Vector rasterize frozen derived-frame drain verified.");

// --- Nessun frame fra mutazione della scena e ricostruzione -------------------
// `mutateMixedScenePresentation` e' il percorso di **ogni** aggiunta, rimozione
// e modifica vettoriale (testo, SVG, immagine). Muta la scena a presentazione
// viva e la ricostruisce subito dopo: i segmenti di composizione restano stale
// in mezzo, e citano per id livelli e nodi che il frame risolve con lookup che
// lanciano. Oggi regge solo perche' fra le due cose non c'e' nessun `await`,
// quindi il controllo non torna mai al loop di rendering. Basta inserirne uno
// e si riapre esattamente il bug "Livello N assente dallo stack" — con la
// differenza che colpirebbe tutti i vettori, non il solo layer-add.
{
  const vectorText = fs.readFileSync(
    new URL("../src/engine-vector-text-runtime.ts", import.meta.url),
    "utf8",
  );
  const corpo = vectorText.slice(
    vectorText.indexOf("export async function mutateMixedScenePresentation<Result>"),
  );
  const mutazione = corpo.indexOf("const result = mutate(scene);");
  const ricostruzione = corpo.indexOf("await engine.rebuildMergedLayerSurfaces(");
  assert.ok(
    mutazione >= 0 && ricostruzione > mutazione,
    "mutazione o ricostruzione della scena mista non individuate",
  );
  const inMezzo = corpo.slice(mutazione, ricostruzione);
  assert.ok(
    !/\bawait\b/.test(inMezzo),
    "nessun await fra la mutazione della scena e la ricostruzione dei segmenti: "
      + "cederebbe il controllo al loop di rendering con i segmenti stale",
  );
}

console.log("Mixed scene mutation atomicity verified.");

// --- Undo rasterizzazione: identita' stabile e preview testo -----------------
// La posizione del vettore nella scena non dice quale raster fosse attivo: con
// tre raster l'adiacente puo' essere diverso da quello su cui si stava
// dipingendo. L'azione deve conservare l'ID e ripristinare anche l'esclusione
// del testo appena tornato selezionato.
{
  const vectorRaster = fs.readFileSync(
    new URL("../src/engine-vector-raster-runtime.ts", import.meta.url),
    "utf8",
  );
  const historyTypes = fs.readFileSync(
    new URL("../src/engine-history-types.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    historyTypes,
    /interface VectorRasterizeHistoryAction[\s\S]*activeRasterLayerIdBefore: number;/,
    "l'azione deve ricordare il raster attivo prima della conversione",
  );
  assert.match(
    vectorRaster,
    /vectorState,[\s\S]{0,120}activeRasterLayerIdBefore: originalActiveId,/,
    "la conversione deve registrare l'identita' attiva osservata",
  );
  const undo = vectorRaster.slice(
    vectorRaster.indexOf("async function undoVectorRasterization("),
    vectorRaster.indexOf("async function redoVectorRasterization("),
  );
  assert.match(
    undo,
    /const fallbackIndex = engine\.layerStack\.indexOfId\(action\.activeRasterLayerIdBefore\);/,
    "Undo deve cercare il raster originario per ID, non scegliere un adiacente",
  );
  assert.doesNotMatch(
    undo,
    /activeTargetIndex > 0[\s\S]*activeTargetIndex - 1/,
    "la geometria dello stack non e' uno snapshot dello stato attivo",
  );
  assert.match(
    undo,
    /const restoredSelection = scene\.selected;[\s\S]*restoredSelection\.kind === "text"[\s\S]*restoredSelection\.textNodeId/,
    "il testo ripristinato e selezionato deve tornare escluso dalla preview statica",
  );

  // Modello del caso non adiacente riprodotto: il testo sta fra raster 1 e 2,
  // ma prima della conversione era attivo il raster 3.
  const stackDuringRasterization = [1, 4, 2, 3];
  const targetIndex = stackDuringRasterization.indexOf(4);
  const adjacentFallback = stackDuringRasterization[targetIndex - 1];
  const stableFallback = stackDuringRasterization.findIndex((id) => id === 3);
  assert.equal(adjacentFallback, 1, "il modello deve distinguere davvero le due scelte");
  assert.equal(stackDuringRasterization[stableFallback], 3);
}

console.log("Vector rasterize exact active/preview restoration verified.");
