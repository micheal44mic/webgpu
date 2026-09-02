import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_RASTER_GLASS_SETTINGS,
  DESTRUCTIVE_RASTER_GLASS_ALGORITHM,
  DESTRUCTIVE_RASTER_GLASS_ALGORITHM_VERSION,
  DESTRUCTIVE_RASTER_GLASS_CORE_BUILD,
  DESTRUCTIVE_RASTER_GLASS_MAX_DISPLACEMENT_PIXELS,
  evaluateRasterGlassDisplacement,
  evaluateRasterGlassGradientNoise,
  normalizeRasterGlassSeed,
  normalizeRasterGlassSettings,
  rasterGlassBounds,
  rasterGlassMaxDisplacementPixels,
  rasterGlassMaximumBounds,
  rasterGlassPcgHash32,
  rasterGlassResultBounds,
  rasterGlassScalePixels,
  rasterGlassSmoothness,
  unionRasterGlassRects,
} from "../src/glass-core.ts";
import { quantizeUnorm8HighFrequencyAdjacent } from "../src/rgba8-high-frequency-quantization.ts";

assert.equal(
  DESTRUCTIVE_RASTER_GLASS_CORE_BUILD,
  "destructive-raster-glass-core-v1-analytic-gradient-refraction",
);
assert.equal(DESTRUCTIVE_RASTER_GLASS_ALGORITHM, "analytic-gradient-refraction-v1");
assert.equal(DESTRUCTIVE_RASTER_GLASS_ALGORITHM_VERSION, 1);
assert.equal(DESTRUCTIVE_RASTER_GLASS_MAX_DISPLACEMENT_PIXELS, 128);
assert.deepEqual(normalizeRasterGlassSettings(), DEFAULT_RASTER_GLASS_SETTINGS);
assert.deepEqual(
  normalizeRasterGlassSettings({
    distortionPercent: -1,
    smoothnessPercent: 101,
    scalePercent: Number.NaN,
    invert: true,
  }),
  {
    distortionPercent: 0,
    smoothnessPercent: 100,
    scalePercent: DEFAULT_RASTER_GLASS_SETTINGS.scalePercent,
    invert: true,
  },
);
assert.deepEqual(
  normalizeRasterGlassSettings({
    distortionPercent: Number.POSITIVE_INFINITY,
    smoothnessPercent: Number.NEGATIVE_INFINITY,
    scalePercent: 999,
  }),
  {
    distortionPercent: DEFAULT_RASTER_GLASS_SETTINGS.distortionPercent,
    smoothnessPercent: DEFAULT_RASTER_GLASS_SETTINGS.smoothnessPercent,
    scalePercent: 100,
    invert: DEFAULT_RASTER_GLASS_SETTINGS.invert,
  },
);
assert.deepEqual(normalizeRasterGlassSeed({ low: -1, high: 0x1_0000_0001 }), {
  low: 0xffff_ffff,
  high: 1,
});
assert.equal(rasterGlassScalePixels(0), 8);
assert(Math.abs(rasterGlassScalePixels(50) - Math.sqrt(8 * 256)) < 1e-12);
assert.equal(rasterGlassScalePixels(100), 256);
assert.equal(rasterGlassMaxDisplacementPixels(0), 0);
assert.equal(rasterGlassMaxDisplacementPixels(50), 64);
assert.equal(rasterGlassMaxDisplacementPixels(100), 128);
assert.equal(rasterGlassSmoothness(0), 0);
assert.equal(rasterGlassSmoothness(100), 1);
assert.equal(rasterGlassPcgHash32(0), 0x07bb2fe2);
assert.equal(rasterGlassPcgHash32(0x12345678), 0x995312e1);

assert.deepEqual(
  rasterGlassBounds({ x: 20, y: 30, width: 40, height: 50 }, 5, 100, 100),
  { x: 15, y: 25, width: 50, height: 60 },
);
assert.deepEqual(
  rasterGlassBounds({ x: 90, y: 50, width: 10, height: 10 }, 5, 100, 60),
  { x: 85, y: 45, width: 15, height: 15 },
  "Glass deve ritagliare i due assi del documento in modo indipendente.",
);
assert.deepEqual(
  rasterGlassResultBounds(
    { x: 20, y: 30, width: 40, height: 50 },
    { distortionPercent: 50 },
    200,
    200,
  ),
  { x: 0, y: 0, width: 124, height: 144 },
);
assert.deepEqual(
  rasterGlassMaximumBounds({ x: 150, y: 160, width: 20, height: 30 }, 300, 400),
  { x: 22, y: 32, width: 276, height: 286 },
);
assert.deepEqual(
  unionRasterGlassRects(
    { x: 4, y: 8, width: 10, height: 12 },
    { x: 1, y: 9, width: 8, height: 20 },
  ),
  { x: 1, y: 8, width: 13, height: 21 },
);

const deterministicSeed = { low: 0x12345678, high: 0x9abcdef0 };
const deterministicSettings = {
  distortionPercent: 100,
  smoothnessPercent: 20,
  scalePercent: 50,
  invert: false,
};
const firstDisplacement = evaluateRasterGlassDisplacement(
  123.5,
  456.5,
  deterministicSettings,
  deterministicSeed,
);
const repeatedDisplacement = evaluateRasterGlassDisplacement(
  123.5,
  456.5,
  deterministicSettings,
  deterministicSeed,
);
const invertedDisplacement = evaluateRasterGlassDisplacement(
  123.5,
  456.5,
  { ...deterministicSettings, invert: true },
  deterministicSeed,
);
assert.deepEqual(firstDisplacement, repeatedDisplacement);
assert.equal(invertedDisplacement.x, -firstDisplacement.x);
assert.equal(invertedDisplacement.y, -firstDisplacement.y);
assert(
  Math.hypot(firstDisplacement.x, firstDisplacement.y)
    < DESTRUCTIVE_RASTER_GLASS_MAX_DISPLACEMENT_PIXELS,
  "Il campo procedurale deve rispettare il supporto dichiarato.",
);
assert.deepEqual(
  evaluateRasterGlassDisplacement(
    123.5,
    456.5,
    { ...deterministicSettings, distortionPercent: 0 },
    deterministicSeed,
  ),
  { x: 0, y: 0 },
);

function srgbToLinearChannel(value) {
  return value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4;
}

function linearToSrgbChannel(value) {
  const bounded = Math.max(0, Math.min(1, value));
  return bounded <= 0.0031308
    ? bounded * 12.92
    : 1.055 * bounded ** (1 / 2.4) - 0.055;
}

function encodedPremultipliedToLinear(value) {
  const alpha = Math.max(0, Math.min(1, value[3]));
  if (alpha <= 1e-6) return [0, 0, 0, 0];
  return [
    srgbToLinearChannel(value[0] / alpha) * alpha,
    srgbToLinearChannel(value[1] / alpha) * alpha,
    srgbToLinearChannel(value[2] / alpha) * alpha,
    alpha,
  ];
}

function linearPremultipliedToEncoded(value) {
  const alpha = Math.max(0, Math.min(1, value[3]));
  if (alpha <= 1e-6) return [0, 0, 0, 0];
  return [
    linearToSrgbChannel(value[0] / alpha) * alpha,
    linearToSrgbChannel(value[1] / alpha) * alpha,
    linearToSrgbChannel(value[2] / alpha) * alpha,
    alpha,
  ];
}

function mixVector(left, right, amount) {
  return left.map((value, index) => value + (right[index] - value) * amount);
}

function encodedLinearBilinear(left, right, amount) {
  return linearPremultipliedToEncoded(mixVector(
    encodedPremultipliedToLinear(left),
    encodedPremultipliedToLinear(right),
    amount,
  ));
}

for (const alpha of [0.01, 0.2, 0.75, 1]) {
  for (const straight of [0, 1 / 255, 7 / 255, 0.125, 0.5, 1]) {
    const stored = [straight * alpha, straight * alpha, straight * alpha, alpha];
    const roundTrip = linearPremultipliedToEncoded(
      encodedPremultipliedToLinear(stored),
    );
    roundTrip.forEach((channel, index) => assert(
      Math.abs(channel - stored[index]) < 1e-12,
      "encoded premultiplication must survive the linear working conversion",
    ));
  }
}

const darkLeft = [1 / 255, 1 / 255, 1 / 255, 1];
const darkRight = [33 / 255, 33 / 255, 33 / 255, 1];
const darkLinearMidpoint = encodedLinearBilinear(darkLeft, darkRight, 0.5)[0];
const darkEncodedMidpoint = (darkLeft[0] + darkRight[0]) * 0.5;
assert(
  darkLinearMidpoint > darkEncodedMidpoint + 3 / 255,
  "dark RGBA8 interpolation must happen in linear light, not between encoded codes",
);
const darkContinuousCode = darkLinearMidpoint * 255;
const darkLower = Math.floor(darkContinuousCode);
const darkUpper = Math.min(255, darkLower + 1);
let darkCodeTotal = 0;
for (let y = 0; y < 16; y += 1) {
  for (let x = 0; x < 16; x += 1) {
    const code = quantizeUnorm8HighFrequencyAdjacent(
      darkLinearMidpoint,
      x + 64,
      y + 96,
      0x12345678,
    );
    assert(code === darkLower || code === darkUpper);
    darkCodeTotal += code;
  }
}
assert(
  Math.abs(darkCodeTotal / 256 - darkContinuousCode) <= 1 / 256,
  "adjacent-code output must retain the dark linear interpolation mean",
);

const opaqueBlack = [0, 0, 0, 1];
const translucentWhite = [0.1, 0.1, 0.1, 0.1];
const alphaAwareMidpoint = encodedLinearBilinear(opaqueBlack, translucentWhite, 0.5);
const encodedSpaceMidpoint = mixVector(opaqueBlack, translucentWhite, 0.5);
assert(Math.abs(alphaAwareMidpoint[3] - 0.55) < 1e-12);
assert(
  alphaAwareMidpoint[0] > encodedSpaceMidpoint[0] + 0.1,
  "linear premultiplied interpolation must not create a dark alpha fringe",
);
assert(alphaAwareMidpoint.slice(0, 3).every((channel) => channel <= alphaAwareMidpoint[3]));

// The analytic derivative is part of the CPU oracle and must track the same
// surface value. Points avoid integer lattice boundaries for a stable check.
const derivativeStep = 1e-5;
for (const [x, y, octave] of [
  [1.25, -2.75, 0],
  [37.125, 91.625, 2],
  [-14.4, 8.2, 4],
]) {
  const sample = evaluateRasterGlassGradientNoise(x, y, deterministicSeed, octave);
  const left = evaluateRasterGlassGradientNoise(
    x - derivativeStep,
    y,
    deterministicSeed,
    octave,
  ).value;
  const right = evaluateRasterGlassGradientNoise(
    x + derivativeStep,
    y,
    deterministicSeed,
    octave,
  ).value;
  const top = evaluateRasterGlassGradientNoise(
    x,
    y - derivativeStep,
    deterministicSeed,
    octave,
  ).value;
  const bottom = evaluateRasterGlassGradientNoise(
    x,
    y + derivativeStep,
    deterministicSeed,
    octave,
  ).value;
  assert(Math.abs(sample.dx - (right - left) / (2 * derivativeStep)) < 1e-7);
  assert(Math.abs(sample.dy - (bottom - top) / (2 * derivativeStep)) < 1e-7);
}

const runtime = readFileSync(
  new URL("../src/engine-glass-runtime.ts", import.meta.url),
  "utf8",
);
const engine = readFileSync(new URL("../src/brush-engine.ts", import.meta.url), "utf8");
const history = readFileSync(
  new URL("../src/engine-history-types.ts", import.meta.url),
  "utf8",
);
const controller = readFileSync(
  new URL("../src/raster-adjustments-controller.ts", import.meta.url),
  "utf8",
);
const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const filtersController = readFileSync(
  new URL("../src/editor-filters-controller.ts", import.meta.url),
  "utf8",
);
const sheet = readFileSync(new URL("../src/mobile-glass-sheet.ts", import.meta.url), "utf8");
const historyRuntime = readFileSync(
  new URL("../src/engine-history-runtime.ts", import.meta.url),
  "utf8",
);
const historyStorageHost = readFileSync(
  new URL("../src/engine-history-storage-host.ts", import.meta.url),
  "utf8",
);
const historyMaintenanceAdapter = readFileSync(
  new URL("../src/history-maintenance-engine-adapter.ts", import.meta.url),
  "utf8",
);
const historyMaintenance = readFileSync(
  new URL("../src/history-maintenance-runtime.ts", import.meta.url),
  "utf8",
);
const reports = readFileSync(new URL("../src/engine-reports.ts", import.meta.url), "utf8");

assert.match(runtime, /const PARAMETER_BYTES = 64;/);
assert.match(
  runtime,
  /destructive-raster-glass-webgpu-v2-storage-color-space-aware-linear-bilinear/,
);
assert.match(runtime, /const WORKGROUP_WIDTH = 8;/);
assert.match(runtime, /const WORKGROUP_HEIGHT = 8;/);
assert.match(runtime, /sourceOriginAndSize: vec4<i32>/);
assert.match(runtime, /dispatchOriginAndSize: vec4<i32>/);
assert.match(runtime, /distortionSmoothnessScaleSign: vec4<f32>/);
assert.match(runtime, /seedAndDocument: vec4<u32>/);
assert.match(runtime, /@binding\(1\) var immutableSource: texture_2d<f32>/);
assert.match(runtime, /texture_storage_2d<\$\{layerFormat\}, write>/);
assert.match(runtime, /fn sampleSourceBilinear/);
assert.match(runtime, /glassEncodedPremultipliedToLinear/);
assert.match(runtime, /glassLinearPremultipliedToEncoded/);
assert.match(runtime, /glassSrgbToLinearChannel/);
assert.match(runtime, /glassLinearToSrgbChannel/);
assert.match(runtime, /return \$\{storedEncodedSrgb \? "glassEncodedPremultipliedToLinear\(stored\)" : "stored"\}/);
assert.match(runtime, /let storedColor = \$\{storedEncodedSrgb/);
assert.match(runtime, /documentPosition = vec2<f32>\(documentPixel\) \+ vec2<f32>\(0\.5\)/);
assert.match(runtime, /return slope \/ \(1\.0 \+ length\(slope\)\)/);
assert.match(runtime, /u32\[14\] = DOCUMENT_WIDTH/);
assert.match(runtime, /u32\[15\] = DOCUMENT_HEIGHT/);
assert.doesNotMatch(runtime, /rgba32float|pack4x8|unpack4x8/i);
assert.doesNotMatch(runtime, /intermediateTexture|displacementTexture|fieldTexture/);
assert.match(runtime, /rgba8HighFrequencyQuantizationShader/);
assert.match(runtime, /quantizeRgba8HighFrequencyAdjacent/);
assert.match(runtime, /format: engine\.layerFormat/);
assert.match(runtime, /type RasterGlassPipelineProfile = `\$\{LayerFormat\}:\$\{DocumentStorageColorSpace\}`/);
assert.match(runtime, /glassShader\(layerFormat, documentStorageColorSpace\)/);
assert.match(
  runtime,
  /createSharedResources\([\s\S]{0,180}engine\.documentStorageColorSpace/,
);
assert.match(runtime, /export async function warmRasterGlassPipelines/);
assert.doesNotMatch(runtime, /Destructive Glass requires an RGBA16F document/);
assert.match(runtime, /globalThis\.crypto\.getRandomValues/);
assert.match(runtime, /export function abandonRasterGlassSession/);

const preview = runtime.slice(
  runtime.indexOf("function encodeRequestedPreview("),
  runtime.indexOf("function startPreviewSubmission("),
);
assert.match(preview, /serial !== session\.requestedSerial/);
assert.match(preview, /texture: session\.sourceTexture/);
assert(preview.indexOf("copyTextureToTexture") < preview.indexOf("beginComputePass"));
assert.match(preview, /texture: session\.targetTexture/);

const previewSubmission = runtime.slice(
  runtime.indexOf("function startPreviewSubmission("),
  runtime.indexOf("function schedulePreview("),
);
assert.match(previewSubmission, /if \(session\.previewInFlight\) return session\.previewInFlight/);
assert.match(previewSubmission, /session\.encodedSerial !== session\.requestedSerial/);

const restore = runtime.slice(
  runtime.indexOf("async function restoreOriginalPixels("),
  runtime.indexOf("function sessionMemoryRequest("),
);
assert(restore.indexOf("await session.previewInFlight") < restore.indexOf("copyTextureToTexture"));
assert.match(restore, /texture: session\.sourceTexture/);
assert.doesNotMatch(restore, /flushPreview/);

const commit = runtime.slice(runtime.indexOf("export async function commitRasterGlass("));
assert.match(commit, /const action: RasterFilterHistoryAction/);
assert.match(commit, /filter: "glass"/);
assert.match(commit, /algorithm: DESTRUCTIVE_RASTER_GLASS_ALGORITHM/);
assert.match(commit, /DESTRUCTIVE_RASTER_GLASS_RGBA8_PRECISION/);
assert.match(commit, /precision: engine\.layerFormat === "rgba8unorm"/);
assert.match(commit, /edgeMode: DESTRUCTIVE_RASTER_GLASS_EDGE_MODE/);
assert.match(commit, /coordinateSpace: DESTRUCTIVE_RASTER_GLASS_COORDINATE_SPACE/);
assert.match(commit, /commitHistoryActionAtomically\(engine, action\)/);
assert.match(commit, /createLayerColdStorageCandidate\([\s\S]{0,300}"history"/);
assert.match(commit, /session\.settings\.distortionPercent === 0/);
assert.doesNotMatch(commit, /as unknown as RasterFilterHistoryAction/);

assert.match(history, /filter: "glass"/);
assert.match(history, /algorithm: "analytic-gradient-refraction-v1"/);
assert.match(history, /rgba16float-source-and-output-f32-field-and-bilinear/);
assert.match(history, /rgba8unorm-source-encoded-f32-field-bilinear-high-frequency-output/);
assert.match(history, /coordinateSpace: "document-pixel-centers"/);
assert.match(engine, /activeRasterGlassSession/);
assert.match(engine, /device\.lost[\s\S]{0,260}abandonRasterGlassSession\(this\)/);
assert.match(engine, /beginRasterGlassRuntime\(this, initial, initialSeed\)/);
assert.match(engine, /reseedRasterGlassRuntime\(this, seed\)/);
assert.match(controller, /engine\.beginRasterGlass/);
assert.match(controller, /engine\.updateRasterGlass/);
assert.match(controller, /engine\.reseedRasterGlass/);
assert.match(controller, /engine\.commitRasterGlass/);
assert.match(controller, /engine\.cancelRasterGlass/);
assert.match(controller, /history\.openEdit === "glass"/);
assert.match(filtersController, /this\.options\.openFilter\(kind, button, elements\.trigger\)/);
assert.match(main, /if \(kind === "glass"\)[\s\S]{0,120}openGlass\(trigger, returnFocus\)/);
assert.match(sheet, /export class MobileGlassSheetController/);
assert.match(
  sheet,
  /sheetState\.open\(opener\)[\s\S]{0,180}elements\.handle\.focus\(\{ preventScroll: true \}\)/,
  "Glass must move focus out of the inert catalog when its sheet opens.",
);
assert.match(
  historyRuntime,
  /activeRasterGlassSession[\s\S]{0,140}Apply or cancel Glass before using history/,
);
assert.match(
  historyStorageHost,
  /openEdit: Boolean\([\s\S]{0,520}activeRasterGlassSession/,
);
const historyMaintenanceGuard = historyStorageHost.match(
  /canMaintain: \(\) =>([\s\S]*?)\n\s*waitForIdle:/,
)?.[1] ?? "";
assert.match(historyMaintenanceGuard, /activeRasterGlassSession === null/);
assert.match(historyMaintenanceAdapter, /\| "activeRasterGlassSession"/);
assert.match(
  historyMaintenance,
  /historyStorageMaintenanceEngineIdle[\s\S]{0,900}!engine\.activeRasterGlassSession/,
  "Automatic checkpoints must stay paused for the entire Glass preview.",
);
assert.match(reports, /activeRasterGlassSession\?\.memoryBytes/);

for (const id of [
  "editorFiltersMenu",
  "editorFiltersPanel",
  "editorGlassFilter",
  "mobileGlassSheet",
  "mobileGlassHandle",
  "mobileGlassDistortion",
  "mobileGlassDistortionOut",
  "mobileGlassSmoothness",
  "mobileGlassSmoothnessOut",
  "mobileGlassScale",
  "mobileGlassScaleOut",
  "mobileGlassInvert",
  "mobileGlassReseed",
  "mobileGlassStatus",
  "mobileGlassCancel",
  "mobileGlassApply",
]) {
  assert.match(html, new RegExp(`id="${id}"`), `Manca #${id}.`);
}
assert.match(html, /id="mobileGlassDistortion"[\s\S]{0,180}min="0"[\s\S]{0,80}max="100"/);
assert.match(html, /id="mobileGlassSmoothness"[\s\S]{0,180}min="0"[\s\S]{0,80}max="100"/);
assert.match(html, /id="mobileGlassScale"[\s\S]{0,180}min="0"[\s\S]{0,80}max="100"/);

console.log("Procedural RGBA8/legacy Glass verification passed.");
