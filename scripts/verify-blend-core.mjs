import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readEngineSource } from "./engine-source.mjs";
import {
  DEFAULT_DRY_BLEND_CONTROLS,
  DRY_BLEND_CORE_BUILD,
  DRY_BLEND_DEFAULT_DOCUMENT_SIZE,
  DRY_BLEND_DEFAULT_SCRATCH_SIZE,
  DRY_BLEND_BLUR_MAX_SUPPORT_PX,
  DRY_BLEND_SCRATCH_LIFECYCLE_STRATEGY,
  blendPaintCoefficient,
  blendBlurSupportRadius,
  blendStretchCoefficient,
  createDryBlendPlanner,
  dryBlendReferenceStep,
  normalizeDryBlendControls,
  quantizeDryBlendSample,
  resampleDryBlendStroke,
} from "../src/blend-core.ts";
import {
  DRY_BLEND_PICKUP_BORDER_STRATEGY,
  blendBlurHorizontalShader,
  blendBlurVerticalShader,
  blendDepositShader,
  blendPickupShader,
} from "../src/blend-shaders.ts";
import { destructiveGaussianBlurKernel } from "../src/gaussian-blur-core.ts";

const approx = (actual, expected, epsilon = 1e-6) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
};

const legacySweepBounds = (step) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let index = 0; index < 5; index += 1) {
    const ratio = index * 0.25;
    const centerX = step.fromX + (step.toX - step.fromX) * ratio;
    const centerY = step.fromY + (step.toY - step.fromY) * ratio;
    const halfWidth = step.fromHalfWidth
      + (step.toHalfWidth - step.fromHalfWidth) * ratio;
    const halfHeight = step.fromHalfHeight
      + (step.toHalfHeight - step.fromHalfHeight) * ratio;
    const angle = step.fromAngle + (step.toAngle - step.fromAngle) * ratio;
    const cosine = Math.abs(Math.cos(angle));
    const sine = Math.abs(Math.sin(angle));
    const extentX = cosine * halfWidth + sine * halfHeight + 2;
    const extentY = sine * halfWidth + cosine * halfHeight + 2;
    minX = Math.min(minX, Math.floor(centerX - extentX));
    minY = Math.min(minY, Math.floor(centerY - extentY));
    maxX = Math.max(maxX, Math.ceil(centerX + extentX));
    maxY = Math.max(maxY, Math.ceil(centerY + extentY));
  }
  return { minX, minY, maxX, maxY };
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
assert.throws(() => normalizeDryBlendControls({ blur: 1.01 }), /blur/);
assert.throws(() => normalizeDryBlendControls({ strength: 2 }), /strength/);
assert.throws(() => normalizeDryBlendControls({ flow: -1 }), /flow/);

approx(blendStretchCoefficient(0.18), Math.sqrt(0.18));
approx(blendPaintCoefficient(0.14), 0.0196);
assert.equal(blendStretchCoefficient(0), 0);
assert.equal(blendStretchCoefficient(1), 1);
assert.equal(blendPaintCoefficient(0), 0);
assert.equal(blendPaintCoefficient(1), 1);
assert.equal(blendBlurSupportRadius(0, 96), 0);
assert.equal(blendBlurSupportRadius(0.5, 96), 12);
assert.equal(blendBlurSupportRadius(1, 96), 24);
assert.equal(blendBlurSupportRadius(1, 1000), DRY_BLEND_BLUR_MAX_SUPPORT_PX);
assert.deepEqual(
  destructiveGaussianBlurKernel(blendBlurSupportRadius(1, 96)),
  destructiveGaussianBlurKernel(24),
  "Blend Blur deve usare lo stesso kernel normalizzato del Gaussian Blur layer",
);

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

const brushEngineSource = readEngineSource();
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
assert.match(
  brushEngineSource,
  /export function maybeReleaseIdleBlendScratch\(engine: BrushEngine\): void/,
);
assert.match(
  brushEngineSource,
  /\|\| engine\.pendingBlendBatches\.length > 0\s*\n\s*\) \{\s*\n\s*return;/,
);
assert.match(
  brushEngineSource,
  /dryBlendScratchLifecycleStrategy: DRY_BLEND_SCRATCH_LIFECYCLE_STRATEGY,/,
);
const blendRendererSource = await readFile(
  new URL("../src/blend-renderer.ts", import.meta.url),
  "utf8",
);
const blendCoreSource = await readFile(
  new URL("../src/blend-core.ts", import.meta.url),
  "utf8",
);
assert.doesNotMatch(
  blendCoreSource,
  /Object\.assign\(target,\s*emptyStep\(\)/,
  "emitStep deve riusare lo slot senza allocare un nuovo emptyStep",
);
assert.match(blendDepositShader, /override blendCustomShape: bool = false/);
assert.match(blendDepositShader, /override blendGrainEnabled: bool = false/);
assert.match(blendBlurHorizontalShader, /pack2x16float/);
assert.match(blendBlurHorizontalShader, /documentClampedState/);
assert.match(blendBlurVerticalShader, /mix\(original, result, clamp\(blend\.grainAffineAndPhase\.w/);
assert.match(
  blendDepositShader,
  /finalCoverage \* blend\.transportControls\.z \* \(1\.0 - blurAmount\)/,
  "Blur 100% deve lasciare visibile il Gaussian anche sotto una Shape custom opaca",
);
assert.match(blendRendererSource, /blurAmount > 0 && groups\.length > 0/);
assert.match(blendRendererSource, /floats\[31\] = clamp\(settings\.blendBlur, 0, 1\)/);
assert.match(blendRendererSource, /size: this\.scratchSize \* this\.scratchSize \* 8/);
assert.match(
  blendDepositShader,
  /let constantCosine = cos\(constantAngle\);[\s\S]*?customAt\([\s\S]*?constantCosine/,
  "la base Shape costante deve essere calcolata una volta fuori dalla scansione",
);
assert.match(blendRendererSource, /private depositPipelines!:/);
assert.match(blendRendererSource, /blendCustomShape: shape === "shape" \? 1 : 0/);
assert.match(blendRendererSource, /blendGrainEnabled: grain === "on" \? 1 : 0/);
assert.match(blendRendererSource, /encode\(\s*encoder: GPUCommandEncoder,/);
const blendEncodeMatch = blendRendererSource.match(
  /(?:^|\r?\n)  encode\(\s*encoder: GPUCommandEncoder,[\s\S]*?(?=\r?\n  memoryMiB\(\): number)/,
);
assert.ok(blendEncodeMatch, "DryBlendRenderer.encode method missing");
assert.doesNotMatch(
  blendEncodeMatch[0],
  /queue\.submit/,
  "encode deve lasciare il submit al command buffer proprietario",
);
assert.match(blendRendererSource, /private readonly uniformFloatViews:/);
assert.match(blendRendererSource, /private readonly uniformUnsignedViews:/);
assert.doesNotMatch(
  blendRendererSource.slice(
    blendRendererSource.indexOf("  private populateUniforms("),
    blendRendererSource.indexOf("  private createDepositBindGroups("),
  ),
  /new (?:Float32Array|Uint32Array)/,
  "populateUniforms non deve allocare typed-array view per segmento",
);
assert.match(
  brushEngineSource,
  /const sharedEncoder = batches\.length <= renderer\.maximumBatchesPerSubmit/,
);
assert.match(
  brushEngineSource,
  /clearLayer,\s*sharedEncoder,\s*\);/,
  "presentazione e Blend interattivo devono condividere lo stesso encoder",
);
assert.match(brushEngineSource, /private reusableBlendPlanner: DryBlendPlanner \| null = null/);
assert.match(brushEngineSource, /this\.reusableBlendPlanner \?\?= createDryBlendPlanner/);
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

// BrushEngine keeps one planner ring across gestures. A fully drained planner
// configured for a new stroke must be indistinguishable from a fresh one.
const reusablePlanner = createDryBlendPlanner(controls, { maxSteps: 128 });
reusablePlanner.reset(samples[0]);
assert.equal(reusablePlanner.pushSamples(samples.slice(1)).accepted, true);
while (reusablePlanner.buildNextBatch()) {
  // Drain the first gesture exactly as the render queue does.
}
const secondControls = { ...controls, size: 96, strength: 0.35, seed: 991 };
const secondSamples = [point(300, 410, 100), point(355, 433, 116), point(401, 390, 132)];
reusablePlanner.configure(secondControls);
reusablePlanner.reset(secondSamples[0]);
assert.equal(reusablePlanner.pushSamples(secondSamples.slice(1)).accepted, true);

const freshSecondPlanner = createDryBlendPlanner(secondControls, { maxSteps: 128 });
freshSecondPlanner.reset(secondSamples[0]);
assert.equal(freshSecondPlanner.pushSamples(secondSamples.slice(1)).accepted, true);
assert.deepEqual(reusablePlanner.snapshotSteps(), freshSecondPlanner.snapshotSteps());

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

// Constant size/aspect/angle makes the two-endpoint fast path exact. Compare
// its output with the original five-sample implementation across different
// orientations, aspect ratios, and subpixel coordinates.
for (const fastPathCase of [
  {
    controls: { size: 64, aspect: 1, angle: 0, orientToStroke: true },
    samples: [point(10.125, 20.25, 0), point(97.75, 31.5, 17), point(44.5, 109.125, 31)],
  },
  {
    controls: {
      size: 257,
      aspect: 0.17,
      angle: Math.PI / 4,
      orientToStroke: false,
    },
    samples: [point(900.25, 801.125, 0), point(731.5, 999.875, 24)],
  },
  {
    controls: {
      size: 1024,
      aspect: 3.75,
      angle: -Math.PI / 7,
      orientToStroke: false,
    },
    samples: [point(2000, 2000, 0), point(2051.375, 1942.625, 9)],
  },
]) {
  const fastPathPlanner = createDryBlendPlanner(fastPathCase.controls, { maxSteps: 256 });
  fastPathPlanner.reset(fastPathCase.samples[0]);
  assert.equal(fastPathPlanner.pushSamples(fastPathCase.samples.slice(1)).accepted, true);
  for (const step of fastPathPlanner.snapshotSteps()) {
    assert.equal(step.fromHalfWidth, step.toHalfWidth);
    assert.equal(step.fromHalfHeight, step.toHalfHeight);
    assert.equal(step.fromAngle, step.toAngle);
    assert.deepEqual(
      { minX: step.minX, minY: step.minY, maxX: step.maxX, maxY: step.maxY },
      legacySweepBounds(step),
    );
  }
}

const blurFixtureSamples = [point(1000, 1000, 0), point(1080, 1030, 16)];
const noBlurPlanner = createDryBlendPlanner({ size: 96, blur: 0 });
noBlurPlanner.reset(blurFixtureSamples[0]);
assert.equal(noBlurPlanner.pushSample(blurFixtureSamples[1]).accepted, true);
const noBlurBatch = structuredClone(noBlurPlanner.buildNextBatch());
const fullBlurPlanner = createDryBlendPlanner({ size: 96, blur: 1 });
fullBlurPlanner.reset(blurFixtureSamples[0]);
assert.equal(fullBlurPlanner.pushSample(blurFixtureSamples[1]).accepted, true);
const fullBlurBatch = structuredClone(fullBlurPlanner.buildNextBatch());
assert.deepEqual(fullBlurBatch.writeRect, noBlurBatch.writeRect);
assert.equal(fullBlurBatch.maxHalo - noBlurBatch.maxHalo, 24);
assert.equal(fullBlurBatch.readRect.x, noBlurBatch.readRect.x - 24);
assert.equal(fullBlurBatch.readRect.y, noBlurBatch.readRect.y - 24);
assert.equal(fullBlurBatch.readRect.width, noBlurBatch.readRect.width + 48);
assert.equal(fullBlurBatch.readRect.height, noBlurBatch.readRect.height + 48);

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

// Blend only ever affects the active layer, so switching layers retargets one
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
