import assert from "node:assert/strict";
import fs from "node:fs";
import {
  VECTOR_TEXT_BLOCK_SHADOW_STRATEGY,
  VECTOR_TEXT_OUTLINE_STRATEGY,
  VECTOR_TEXT_SINGLE_SHADOW_STRATEGY,
  VECTOR_TEXT_INNER_SHADOW_STRATEGY,
} from "../../../src/mixed-scene-stack.ts";
import { VECTOR_TEXT_FONT_GEOMETRY_STRATEGY } from "../../../src/vector-text-font-geometry.ts";
import { VECTOR_TEXT_GPU_GEOMETRY_STRATEGY } from "../../../src/vector-text-effect-geometry.ts";
import {
  VECTOR_TEXT_GEOMETRY_COMPILER_VERSION,
} from "../../../src/vector-text-lod.ts";
import {
  VECTOR_TEXT_SLUG_COMPILER_VERSION,
} from "../../../src/vector-text-slug.ts";
import {
  VECTOR_TEXT_SINGLE_SHADOW_BLUR_STRATEGY,
} from "../../../src/vector-text-single-shadow.ts";
import {
  VECTOR_TEXT_GPU_BLUR_FORMAT,
  VECTOR_TEXT_GPU_BLUR_BYTES_PER_PIXEL,
  VECTOR_TEXT_GPU_RENDER_STRATEGY,
  VECTOR_TEXT_GPU_SAMPLE_COUNT,
  VECTOR_TEXT_GPU_TARGET_BYTES_PER_PIXEL,
  VECTOR_TEXT_GPU_TARGET_FORMAT,
  VECTOR_TEXT_GPU_UNIFORM_BYTES,
  VECTOR_TEXT_GPU_UNIFORM_FLOATS,
} from "../../../src/vector-text-gpu-shader.ts";
import {
  VECTOR_TEXT_SLUG_GPU_RENDER_STRATEGY,
} from "../../../src/vector-text-slug-gpu-shader.ts";
import {
  VECTOR_TEXT_PRESENTATION_STRATEGY,
} from "../../../src/vector-text-shader.ts";
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
} from "../../../src/vector-text-adaptive-zoom.ts";
import {
  VECTOR_TEXT_TRANSFORM_STRATEGY,
} from "../../../src/vector-text-transform.ts";
import {
  MIXED_SCENE_COMPOSITOR_STRATEGY,
  MIXED_SCENE_LINEAR_FORMAT,
} from "../../../src/mixed-scene-compositor-shader.ts";
import { readRepositorySource } from "../source-contract.mjs";

const packageJson = JSON.parse(readRepositorySource("package.json"));

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
assert.throws(() => vectorTextZoomStressSeed(10, 4096), /fuori range/);
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
  "local-opentype-outline-kittl-transform-v4-distort",
);
assert.equal(
  VECTOR_TEXT_TRANSFORM_STRATEGY,
  "kittl-compatible-centered-arch-wave-distort-six-vertex-four-handle-cubic-distance-warp-circle-rigid-glyph-v3",
);
assert.equal(packageJson.dependencies["clipper2-ts"], "2.0.1-18");
assert.equal(packageJson.dependencies.earcut, "^3.0.2");
assert.ok(!fs.existsSync(new URL("../../../src/vector-path-gpu-geometry.ts", import.meta.url)));

// Normalizzazione UI e convenzione +Y verso il basso.
