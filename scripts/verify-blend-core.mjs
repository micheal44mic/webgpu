import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DEFAULT_DRY_BLEND_CONTROLS,
  DRY_BLEND_CORE_BUILD,
  DRY_BLEND_DEFAULT_DOCUMENT_SIZE,
  DRY_BLEND_DEFAULT_SCRATCH_SIZE,
  DRY_BLEND_SCRATCH_LIFECYCLE_STRATEGY,
  blendPaintCoefficient,
  blendStretchCoefficient,
  createDryBlendPlanner,
  dryBlendReferenceStep,
  normalizeDryBlendControls,
  quantizeDryBlendSample,
  resampleDryBlendStroke,
} from "../src/blend-core.ts";
import {
  DRY_BLEND_PICKUP_BORDER_STRATEGY,
  blendPickupShader,
} from "../src/blend-shaders.ts";

const approx = (actual, expected, epsilon = 1e-6) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
};

assert.equal(DRY_BLEND_DEFAULT_DOCUMENT_SIZE, 4096);
assert.equal(DRY_BLEND_DEFAULT_SCRATCH_SIZE, 1664);
assert.deepEqual(normalizeDryBlendControls(), DEFAULT_DRY_BLEND_CONTROLS);
assert.equal(Object.isFrozen(normalizeDryBlendControls()), true);
assert.equal(normalizeDryBlendControls({ size: 5000 }).size, 1024);
assert.equal(normalizeDryBlendControls({ spacing: 10 }).spacing, 4);
assert.equal(normalizeDryBlendControls({ aspect: 0.001 }).aspect, 0.05);
assert.throws(() => normalizeDryBlendControls({ stretch: 1.01 }), /stretch/);
assert.throws(() => normalizeDryBlendControls({ paint: -0.01 }), /paint/);
assert.throws(() => normalizeDryBlendControls({ strength: 2 }), /strength/);
assert.throws(() => normalizeDryBlendControls({ flow: -1 }), /flow/);

approx(blendStretchCoefficient(0.18), Math.sqrt(0.18));
approx(blendPaintCoefficient(0.14), 0.0196);
assert.equal(blendStretchCoefficient(0), 0);
assert.equal(blendStretchCoefficient(1), 1);
assert.equal(blendPaintCoefficient(0), 0);
assert.equal(blendPaintCoefficient(1), 1);

assert.equal(
  DRY_BLEND_PICKUP_BORDER_STRATEGY,
  "exclude-outside-document-preserve-carrier",
);
assert.match(
  blendPickupShader,
  /all\(documentPosition >= vec2<f32>\(0\.0\)\)/,
);
assert.match(
  blendPickupShader,
  /all\(documentPosition < blend\.documentAndRoi\.xy\)/,
);
assert.match(blendPickupShader, /let sampleDocumentPosition = clamp\(/);
assert.match(blendPickupShader, /var pigment = sum \/ max\(total, 0\.000001\)/);
assert.match(blendPickupShader, /else \{\s*\/\/ A completely off-canvas step[\s\S]*?pigment = previous;/);

const brushEngineSource = await readFile(
  new URL("../src/brush-engine.ts", import.meta.url),
  "utf8",
);
assert.match(
  brushEngineSource,
  /const DRY_BLEND_FRAME_PIXEL_BUDGET = 24_000_000;/,
);
assert.match(
  brushEngineSource,
  /const DRY_BLEND_MAX_BATCHES_PER_FRAME = 256;/,
);
assert.match(
  brushEngineSource,
  /const batchCost = readRect\.width \* readRect\.height \* 2;/,
);
assert.match(
  brushEngineSource,
  /start \+= renderer\.maximumBatchesPerSubmit/,
);

assert.equal(
  DRY_BLEND_SCRATCH_LIFECYCLE_STRATEGY,
  "allocate-on-tool-select-release-when-idle-deselected",
);
assert.match(brushEngineSource, /this\.blendRenderer\?\.prewarmScratch\(\);/);
assert.match(brushEngineSource, /private maybeReleaseIdleBlendScratch\(\): void/);
assert.match(
  brushEngineSource,
  /\|\| this\.pendingBlendBatches\.length > 0\s*\n\s*\) \{\s*\n\s*return;/,
);
assert.match(
  brushEngineSource,
  /dryBlendScratchLifecycleStrategy: DRY_BLEND_SCRATCH_LIFECYCLE_STRATEGY,/,
);
const blendRendererSource = await readFile(
  new URL("../src/blend-renderer.ts", import.meta.url),
  "utf8",
);
assert.match(blendRendererSource, /prewarmScratch\(\): boolean/);
assert.match(blendRendererSource, /releaseScratch\(\): boolean/);
assert.match(
  blendRendererSource,
  /this\.scratch = null;\s*\n\s*this\.carrierValid = false;/,
);

assert.deepEqual(
  quantizeDryBlendSample({ x: 10.0004, y: 20.0004, pressure: 0, timeMs: 10.2 }),
  quantizeDryBlendSample({ x: 10.0005, y: 20.0005, pressure: 1, timeMs: 10.3 }),
);
assert.equal(
  quantizeDryBlendSample({ x: 1, y: 2, pressure: 0.37, timeMs: 4 }).pressure,
  1,
);

assert.equal(dryBlendReferenceStep(1), 2.5);
assert.equal(dryBlendReferenceStep(64), 3.84);
assert.equal(dryBlendReferenceStep(1024), 48);

const point = (x, y, timeMs, pressure = 1) => ({ x, y, timeMs, pressure });
const controls = { size: 256, spacing: 0.15, strength: 0.7, seed: 77 };
const samples = [
  point(100, 100, 0, 0.1),
  point(112, 104, 7, 0.9),
  point(128, 109, 19, 0.2),
  point(146, 125, 31, 0.8),
  point(200, 126, 44, 0.4),
];

const allAtOnce = createDryBlendPlanner(controls);
allAtOnce.reset(samples[0]);
assert.equal(allAtOnce.pushSamples(samples.slice(1)).accepted, true);
assert.equal(allAtOnce.finish().accepted, true);

const partitioned = createDryBlendPlanner(controls);
partitioned.reset(samples[0]);
assert.equal(partitioned.pushSamples(samples.slice(1, 2)).accepted, true);
assert.equal(partitioned.pushSamples(samples.slice(2, 4)).accepted, true);
assert.equal(partitioned.pushSamples(samples.slice(4)).accepted, true);
partitioned.finish();
assert.deepEqual(partitioned.snapshotSteps(), allAtOnce.snapshotSteps());

const lowPressure = resampleDryBlendStroke(
  samples.map((sample) => ({ ...sample, pressure: 0 })),
  controls,
);
const highPressure = resampleDryBlendStroke(
  samples.map((sample) => ({ ...sample, pressure: 1 })),
  controls,
);
assert.deepEqual(lowPressure.steps, highPressure.steps);
assert(lowPressure.samples.every((sample) => sample.pressure === 1));

const ratioPlanner = createDryBlendPlanner(
  { size: 256, spacing: 0.01, strength: 0.7 },
  { maxSteps: 64 },
);
ratioPlanner.reset(point(100, 100, 0));
const ratioResult = ratioPlanner.pushSample(point(200, 100, 10));
assert.equal(ratioResult.accepted, true);
assert.equal(ratioResult.steps, 7);
const ratioSteps = ratioPlanner.snapshotSteps();
approx(ratioSteps.reduce((sum, step) => sum + step.distance, 0), 100, 1e-4);
approx(ratioSteps.at(-1).toX, 200, 1e-4);
assert(ratioSteps.every((step) => step.warpStrength === Math.fround(0.7)));

const rotatedMaximum = createDryBlendPlanner(
  {
    size: 1024,
    spacing: 0.01,
    strength: 1,
    angle: Math.PI / 4,
    orientToStroke: false,
  },
  {
    documentWidth: 4096,
    documentHeight: 4096,
    tileSize: 256,
    scratchSize: 1664,
    maxSteps: 128,
  },
);
rotatedMaximum.reset(point(2000, 2000, 0));
assert.equal(rotatedMaximum.pushSample(point(2064, 2000, 16)).accepted, true);
let batchCount = 0;
let batch;
while ((batch = rotatedMaximum.buildNextBatch())) {
  assert.equal(batch.build, DRY_BLEND_CORE_BUILD);
  assert.equal(batch.stepCount, 1);
  assert(batch.readRect.width <= 1664 && batch.readRect.height <= 1664);
  assert(batch.readRect.width > 1280);
  assert.equal(batch.dirtyRect, batch.writeRect);
  assert(batch.readTileCount >= batch.writeTileCount);
  batchCount += 1;
}
assert.equal(batchCount, 2);

const edgePlanner = createDryBlendPlanner(
  { size: 64, strength: 1 },
  { documentWidth: 4096, documentHeight: 4096, scratchSize: 1664 },
);
edgePlanner.reset(point(0, 10, 0));
edgePlanner.pushSample(point(10, 10, 10));
const edgeBatch = edgePlanner.buildNextBatch();
assert(edgeBatch);
assert(edgeBatch.readRect.x < 0);
assert.equal(edgeBatch.clippedReadRect.x, 0);
assert(edgeBatch.readTiles
  .slice(0, edgeBatch.readTileCount)
  .every((key) => key < 16 * 16));

const capacityPlanner = createDryBlendPlanner({ size: 1 }, { maxSteps: 2 });
capacityPlanner.reset(point(0, 0, 0));
const rejected = capacityPlanner.pushSample(point(10, 0, 10));
assert.equal(rejected.accepted, false);
assert.equal(rejected.reason, "capacity");
assert.deepEqual(capacityPlanner.capacity(), { steps: 0, stepFree: 2 });
assert.equal(capacityPlanner.lastSample().x, 0);

const tapPlanner = createDryBlendPlanner();
tapPlanner.reset(point(200, 300, 0, 0));
assert.equal(tapPlanner.pushSample(point(200.001, 300.001, 20, 1)).stationary, true);
assert.equal(tapPlanner.finish().stationary, true);
assert.equal(tapPlanner.buildNextBatch(), null);

// Blend only ever wets the active layer, so switching layers retargets one
// instance instead of paying for one per layer — the shape EffectsWorkbench
// already uses.
assert.match(
  blendRendererSource,
  /retarget\(view: GPUTextureView, samplingView: GPUTextureView\): void/,
);
const blendRetargetStart = blendRendererSource.indexOf("retarget(view: GPUTextureView");
const blendRetargetBody = blendRendererSource.slice(blendRetargetStart, blendRetargetStart + 1_600);
// The carrier holds pigment picked up from the OUTGOING layer. Seeding the first
// step of a stroke on the incoming layer with it would bleed one layer's colour
// into another, and no pixel test on a single layer would ever show it.
assert.match(
  blendRetargetBody,
  /this\.carrierValid = false/,
  "il retarget deve invalidare il carrier del layer uscente",
);
assert.match(
  blendRetargetBody,
  /this\.scratch\.gatherBindGroup = this\.device\.createBindGroup/,
  "layerSamplingView è incorporata nel gather bind group e va ricostruita",
);
assert.doesNotMatch(
  blendRendererSource,
  /private readonly layerView: GPUTextureView/,
  "layerView non può restare readonly se il renderer è retargettabile",
);

console.log("Dry Blend core verification passed.");
