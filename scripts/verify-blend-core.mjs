import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer as createViteServer } from "vite";
import { readEngineSource } from "./engine-source.mjs";
import {
  DEFAULT_DRY_BLEND_CONTROLS,
  DRY_BLEND_CORE_BUILD,
  DRY_BLEND_DEFAULT_DOCUMENT_SIZE,
  DRY_BLEND_DEFAULT_SCRATCH_SIZE,
  DRY_BLEND_BLUR_MAX_SUPPORT_PX,
  DRY_BLEND_BLUR_REDUCED_MAX_SUPPORT_PX,
  DRY_BLEND_SCRATCH_LIFECYCLE_STRATEGY,
  blendPaintCoefficient,
  blendPigmentDepositScale,
  blendBlurReadSupportRadius,
  blendBlurSamplingScale,
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
  blendBlurDownsampleShader,
  blendBlurHorizontalShader,
  blendBlurReducedHorizontalShader,
  blendBlurReducedVerticalShader,
  blendBlurUpsampleShader,
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
assert.equal(blendPigmentDepositScale(0, 0, 0), 1);
assert.equal(blendPigmentDepositScale(0.5, 0, 0), 0);
assert.equal(blendPigmentDepositScale(0.5, 0.01, 0), 0.5);
assert.equal(blendPigmentDepositScale(0.5, 0, 0.01), 0.5);
assert.equal(blendPigmentDepositScale(1, 1, 1), 0);
assert.equal(blendBlurSupportRadius(0, 96), 0);
assert.equal(blendBlurSupportRadius(0.5, 96), 12);
assert.equal(blendBlurSupportRadius(1, 96), 24);
assert.equal(blendBlurSupportRadius(1, 1000), DRY_BLEND_BLUR_MAX_SUPPORT_PX);
assert.equal(DRY_BLEND_BLUR_REDUCED_MAX_SUPPORT_PX, 12);
assert.equal(blendBlurSamplingScale(1, 48), 1);
assert.equal(blendBlurSamplingScale(1, 52), 2);
assert.equal(blendBlurSamplingScale(1, 96), 2);
assert.equal(blendBlurSamplingScale(1, 1000), 6);
assert.equal(blendBlurReadSupportRadius(1, 48), 12);
assert.equal(blendBlurReadSupportRadius(1, 96), 28);
assert.equal(blendBlurReadSupportRadius(1, 1000), 78);
const reduced96Scale = blendBlurSamplingScale(1, 96);
assert.deepEqual(
  destructiveGaussianBlurKernel(
    Math.ceil(blendBlurSupportRadius(1, 96) / reduced96Scale),
  ),
  destructiveGaussianBlurKernel(DRY_BLEND_BLUR_REDUCED_MAX_SUPPORT_PX),
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
  /strength: renderSettings\.opacity,[\s\S]*?orientToStroke: renderSettings\.shapeRotation === "follow-stroke"/,
  "Blend must inherit Brush Studio opacity and Fixed/Follow Stroke orientation",
);
assert.doesNotMatch(
  brushEngineSource,
  /orientToStroke: true,[\s\S]*?seed: historyActionId/,
  "Blend must not force Follow Stroke",
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
  /\|\| engine\.pendingBlendBatches\.length > 0\s*\n\s*\|\| engine\.blendSubmissionInFlight !== null\s*\n\s*\|\| engine\.brushGpuWarmupPromise !== null\s*\n\s*\) \{\s*\n\s*return;/,
);
assert.match(
  brushEngineSource,
  /private trackBlendSubmissionCompletion\(\): void \{[\s\S]*?queue\.onSubmittedWorkDone\(\)[\s\S]*?this\.blendSubmissionInFlight = completion;[\s\S]*?this\.blendSubmissionInFlight = null;[\s\S]*?this\.requestRender\(\)/,
  "Blend must wait for the current GPU submission before scheduling the next one",
);
assert.match(
  brushEngineSource,
  /this\.blendSubmissionInFlight !== null\s*\n\s*&& this\.pendingBlendBatches\.length > 0\s*\n\s*&& !this\.forceSynchronousBlendDrain[\s\S]*?return;/,
  "interactive Blend rendering must apply GPU backpressure",
);
assert.match(
  brushEngineSource,
  /const deferResourcesForQueuedBlend = this\.initialized[\s\S]*?this\.brushSettingsResourcesDeferredForBlend = true;[\s\S]*?this\.requestRender\(\);[\s\S]*?return;/,
  "changing brush controls must not synchronously drain queued Blend work",
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
assert.match(blendRendererSource, /async prewarmSelectedVariant\(/);
assert.match(
  blendRendererSource,
  /dispatchWorkgroups\(1, 1, 1\)[\s\S]*scatterPass\.draw\(3, 1, 0, 0\)[\s\S]*queue\.onSubmittedWorkDone\(\)/,
  "Il warm-up Blend deve eseguire il bundle reale su scratch e attendere la GPU.",
);
assert.match(
  blendRendererSource,
  /Selected Blend warm-up scatter target[\s\S]*usage: GPUTextureUsage\.RENDER_ATTACHMENT/,
  "Lo scatter di warm-up Blend non deve puntare al layer canonico.",
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
assert.match(blendBlurDownsampleShader, /positiveModulo\(roiOrigin\(\)\.x, scale\)/);
assert.match(blendBlurDownsampleShader, /result \/= f32\(scale \* scale\)/);
assert.match(blendBlurReducedHorizontalShader, /DRY_BLEND_BLUR_REDUCED_MAX_SUPPORT_PX|offset <= 12u/);
assert.match(blendBlurReducedVerticalShader, /reducedOutput\[reducedIndex\(pixel\)\]/);
assert.match(blendBlurUpsampleShader, /mix\([\s\S]*?original,[\s\S]*?blurred/);
assert.match(
  blendDepositShader,
  /blurAmount > 0\.0[\s\S]*?stretchAmount <= 0\.0[\s\S]*?paintAmount <= 0\.0[\s\S]*?pigmentDepositScale = 0\.0/,
  "Paint 0 + Stretch 0 deve disattivare il deposito e lasciare soltanto il Gaussian",
);
assert.match(
  blendDepositShader,
  /coverageBuffer\[index\] = max\(coverageBuffer\[index\], finalCoverage\);[\s\S]*?if \(depositCoverage <= 0\.0\)/,
  "il Blur puro deve conservare la coverage necessaria allo scatter",
);
assert.match(
  blendDepositShader,
  /finalCoverage \* blend\.transportControls\.z \* pigmentDepositScale/,
  "il deposito normale deve restare attenuato dalla quantita di Blur",
);
assert.match(blendRendererSource, /blurAmount > 0 && groups\.length > 0/);
assert.match(blendRendererSource, /floats\[31\] = clamp\(settings\.blendBlur, 0, 1\)/);
assert.match(blendRendererSource, /const blurBufferBytes = this\.scratchSize \* this\.scratchSize \* 8/);
assert.match(blendRendererSource, /destructiveGaussianBlurKernel\(Math\.ceil\(radius \/ scale\)\)/);
assert.match(blendRendererSource, /this\.blurKernelUnsigned\[1\] = scale/);
const reducedBlurStorageSource = blendRendererSource.slice(
  blendRendererSource.indexOf("  private ensureBlurScratchResources("),
  blendRendererSource.indexOf("  private ensureScratchResources("),
);
assert.match(reducedBlurStorageSource, /reducedBuffer = this\.device\.createBuffer/);
assert.match(
  reducedBlurStorageSource,
  /reducedHorizontalBindGroup[\s\S]*?packedRegion\(1, blurBuffer, reducedBufferBytes\)[\s\S]*?packedRegion\(2, reducedBuffer, reducedBufferBytes\)/,
  "reduced horizontal Blur must ping-pong into a distinct GPU allocation",
);
assert.match(
  reducedBlurStorageSource,
  /reducedVerticalBindGroup[\s\S]*?packedRegion\(1, reducedBuffer, reducedBufferBytes\)[\s\S]*?packedRegion\(2, blurBuffer, reducedBufferBytes\)/,
  "reduced vertical Blur must ping-pong back from the distinct allocation",
);
assert.doesNotMatch(
  reducedBlurStorageSource,
  /secondRegionOffset/,
  "two byte ranges of one GPUBuffer are not a safe reduced Blur ping-pong",
);
assert.match(blendRendererSource, /this\.scratch\.blur\?\.reducedBuffer\.destroy\(\);/);
assert.match(
  blendDepositShader,
  /let constantCosine = cos\(constantAngle\);[\s\S]*?customAt\([\s\S]*?constantCosine/,
  "la base Shape costante deve essere calcolata una volta fuori dalla scansione",
);
assert.match(blendRendererSource, /private depositPipelines: Record</);
assert.match(
  blendRendererSource,
  /circle: \{ off: null, on: null \},\s*shape: \{ off: null, on: null \}/,
  "le varianti deposit devono partire non compilate",
);
assert.match(blendRendererSource, /blendCustomShape: shape === "shape" \? 1 : 0/);
assert.match(blendRendererSource, /blendGrainEnabled: grain === "on" \? 1 : 0/);
assert.match(blendRendererSource, /async ensureVariantPipelines\(settings: DryBlendRenderSettings\)/);
assert.match(blendRendererSource, /selectedVariantPipelinesReady\(settings: DryBlendRenderSettings\)/);
assert.match(blendRendererSource, /await this\.ensureVariantPipelines\(settings\)/);
assert.match(blendRendererSource, /createComputePipelineAsync\(this\.device/);
assert.match(blendRendererSource, /createRenderPipelineAsync\(this\.device/);
assert.match(
  brushEngineSource,
  /async ensureBlendRendererResources\(settings: BrushSettings = this\.settings\)/,
  "Blend deve avere un gate separato dalle risorse editor avanzate",
);
const currentBrushResourcesStart = brushEngineSource.indexOf(
  "  async ensureCurrentBrushResources(): Promise<void>",
);
const blendResourcesStart = brushEngineSource.indexOf(
  "  async ensureBlendRendererResources(",
  currentBrushResourcesStart,
);
assert.ok(currentBrushResourcesStart >= 0 && blendResourcesStart > currentBrushResourcesStart);
const currentBrushResourcesBody = brushEngineSource.slice(
  currentBrushResourcesStart,
  blendResourcesStart,
);
const currentBrushGrainIndex = currentBrushResourcesBody.indexOf(
  "await this.ensureGrainResources",
);
const currentBrushShapeIndex = currentBrushResourcesBody.indexOf(
  "await this.ensureShapeResources",
);
const currentBrushBlendIndex = currentBrushResourcesBody.indexOf(
  "await this.ensureBlendRendererResources(settings)",
);
assert.ok(
  currentBrushGrainIndex >= 0 && currentBrushGrainIndex < currentBrushBlendIndex,
  "Grain allocation scopes must finish before Blend pipeline scopes open",
);
assert.ok(
  currentBrushShapeIndex >= 0 && currentBrushShapeIndex < currentBrushBlendIndex,
  "Shape allocation scopes must finish before Blend pipeline scopes open",
);
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
  const fastPathPlanner = createDryBlendPlanner(fastPathCase.controls, {
    maxSteps: 256,
    scratchSize: 8192,
  });
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
assert.equal(fullBlurBatch.maxHalo - noBlurBatch.maxHalo, 28);
assert.equal(fullBlurBatch.readRect.x, noBlurBatch.readRect.x - 28);
assert.equal(fullBlurBatch.readRect.y, noBlurBatch.readRect.y - 28);
assert.equal(fullBlurBatch.readRect.width, noBlurBatch.readRect.width + 56);
assert.equal(fullBlurBatch.readRect.height, noBlurBatch.readRect.height + 56);

// Regression: the public maximum tip/Blur combination used to produce a
// 1665-pixel ROI at this angle and permanently lock pointer interaction.
const maximumBlurPlanner = createDryBlendPlanner(
  {
    size: 1000,
    blur: 1,
    strength: 1,
    angle: 0,
    orientToStroke: true,
  },
  { documentWidth: 2048, documentHeight: 2048, scratchSize: 1664 },
);
maximumBlurPlanner.reset(point(1024, 1024, 0));
const maximumBlurDistance = 47.9;
const maximumBlurAngle = 35 * Math.PI / 180;
assert.equal(maximumBlurPlanner.pushSample(point(
  1024 + Math.cos(maximumBlurAngle) * maximumBlurDistance,
  1024 + Math.sin(maximumBlurAngle) * maximumBlurDistance,
  16,
)).accepted, true);
let maximumBlurBatchCount = 0;
let maximumBlurBatch;
while ((maximumBlurBatch = maximumBlurPlanner.buildNextBatch())) {
  assert(maximumBlurBatch.readRect.width <= 1664);
  assert(maximumBlurBatch.readRect.height <= 1664);
  maximumBlurBatchCount += 1;
}
assert(maximumBlurBatchCount >= 2, "the oversized sweep must be subdivided");

const impossibleTipPlanner = createDryBlendPlanner(
  { size: 1024, aspect: 3.75, angle: -Math.PI / 7, orientToStroke: false },
  { scratchSize: 1664 },
);
impossibleTipPlanner.reset(point(2000, 2000, 0));
assert.throws(
  () => impossibleTipPlanner.pushSample(point(2051.375, 1942.625, 9)),
  /cannot fit inside scratch/,
  "an unsplittable tip must fail before mutating the planner ring",
);

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

class FakeBlendPipelineDevice {
  pipelineDescriptors = [];
  shaderModuleDescriptors = [];
  errorScopes = [];
  limits = { minUniformBufferOffsetAlignment: 256 };

  createBuffer(descriptor) {
    return {
      descriptor,
      destroyed: false,
      destroy() { this.destroyed = true; },
    };
  }

  createBindGroupLayout(descriptor) {
    return { descriptor };
  }

  createShaderModule(descriptor) {
    this.shaderModuleDescriptors.push(descriptor);
    return {
      descriptor,
      getCompilationInfo: async () => ({ messages: [] }),
    };
  }

  createPipelineLayout(descriptor) {
    return { descriptor };
  }

  async createComputePipelineAsync(descriptor) {
    const pipeline = { kind: "compute", descriptor };
    this.pipelineDescriptors.push(pipeline);
    return pipeline;
  }

  async createRenderPipelineAsync(descriptor) {
    const pipeline = { kind: "render", descriptor };
    this.pipelineDescriptors.push(pipeline);
    return pipeline;
  }

  pushErrorScope(filter) {
    this.errorScopes.push(filter);
  }

  async popErrorScope() {
    assert.notEqual(this.errorScopes.pop(), undefined);
    return null;
  }
}

const blendVariantSettings = (overrides = {}) => ({
  size: 48,
  shape: "circle",
  grainMode: "off",
  grainScale: 1,
  grainMovement: 0,
  grainDepth: 1,
  grainBrightness: 0,
  grainContrast: 0,
  grainInvert: false,
  grainFiltering: "improved",
  color: "#ffffffffffff",
  shapeMaskFormat: "r16float",
  hardness: 1,
  blendStretch: 0.18,
  blendPaint: 0.14,
  blendBlur: 0,
  ...overrides,
});

const fakeGrainSamplers = () => ({
  fixed: { no: {}, classic: {}, improved: {} },
  moving: { no: {}, classic: {}, improved: {} },
});

const createFakeBlendRenderer = async (DryBlendRenderer) => {
  const device = new FakeBlendPipelineDevice();
  const view = {};
  const renderer = await DryBlendRenderer.create({
    device,
    documentWidth: 64,
    documentHeight: 64,
    layerFormat: "rgba16float",
    layerView: view,
    layerSamplingView: view,
    shapeMaskView: view,
    shapeMaskSampler: {},
    grainTextureView: view,
    grainTextureWidth: 1,
    grainTextureMipLevelCount: 1,
    grainSamplers: fakeGrainSamplers(),
    scratchSize: 64,
  });
  return { device, renderer };
};

const previousGpuBufferUsage = globalThis.GPUBufferUsage;
const previousGpuShaderStage = globalThis.GPUShaderStage;
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_SRC: 2, COPY_DST: 4 };
globalThis.GPUShaderStage = { COMPUTE: 1, FRAGMENT: 2 };

const vite = await createViteServer({
  configFile: false,
  root: process.cwd(),
  logLevel: "silent",
  appType: "custom",
  server: { middlewareMode: true },
});
try {
  const { DryBlendRenderer } = await vite.ssrLoadModule("/src/blend-renderer.ts");
  const { device, renderer } = await createFakeBlendRenderer(DryBlendRenderer);
  const defaultVariant = blendVariantSettings();

  assert.deepEqual(
    device.pipelineDescriptors.map(({ descriptor }) => descriptor.label),
    [
      "Blend dry gather ROI",
      "Blend dry 8x8 weighted pigment pickup",
      "Blend dry scatter to canonical layer",
    ],
    "creating the Blend renderer must compile only its three common pipelines",
  );
  assert.equal(renderer.selectedVariantPipelinesReady(defaultVariant), false);

  await renderer.ensureVariantPipelines(defaultVariant);
  assert.equal(device.pipelineDescriptors.length, 4);
  assert.equal(renderer.selectedVariantPipelinesReady(defaultVariant), true);
  assert.equal(
    device.pipelineDescriptors.at(-1).descriptor.label,
    "Blend dry circle off fused sweep and pigment deposit",
  );
  assert.deepEqual(
    device.pipelineDescriptors.at(-1).descriptor.compute.constants,
    { blendCustomShape: 0, blendGrainEnabled: 0 },
  );
  await renderer.ensureVariantPipelines(defaultVariant);
  assert.equal(device.pipelineDescriptors.length, 4, "the default variant must be deduplicated");

  const shapeVariant = blendVariantSettings({ shape: "shape" });
  await renderer.ensureVariantPipelines(shapeVariant);
  assert.equal(device.pipelineDescriptors.length, 5);
  assert.deepEqual(
    device.pipelineDescriptors.at(-1).descriptor.compute.constants,
    { blendCustomShape: 1, blendGrainEnabled: 0 },
  );

  const grainVariant = blendVariantSettings({ grainMode: "texturized" });
  await renderer.ensureVariantPipelines(grainVariant);
  assert.equal(device.pipelineDescriptors.length, 6);
  assert.deepEqual(
    device.pipelineDescriptors.at(-1).descriptor.compute.constants,
    { blendCustomShape: 0, blendGrainEnabled: 1 },
  );

  const shapeGrainVariant = blendVariantSettings({
    shape: "shape",
    grainMode: "moving",
  });
  await renderer.ensureVariantPipelines(shapeGrainVariant);
  assert.equal(device.pipelineDescriptors.length, 7);
  assert.deepEqual(
    device.pipelineDescriptors.at(-1).descriptor.compute.constants,
    { blendCustomShape: 1, blendGrainEnabled: 1 },
  );

  const directBlurVariant = blendVariantSettings({ blendBlur: 1, size: 48 });
  await renderer.ensureVariantPipelines(directBlurVariant);
  assert.equal(renderer.selectedVariantPipelinesReady(directBlurVariant), true);
  assert.deepEqual(
    device.pipelineDescriptors.slice(7).map(({ descriptor }) => descriptor.label),
    ["Blend local Gaussian horizontal", "Blend local Gaussian vertical"],
    "small Blur must compile only the direct two-pass bundle",
  );

  const reducedBlurVariant = blendVariantSettings({ blendBlur: 1, size: 96 });
  await renderer.ensureVariantPipelines(reducedBlurVariant);
  assert.equal(renderer.selectedVariantPipelinesReady(reducedBlurVariant), true);
  assert.deepEqual(
    device.pipelineDescriptors.slice(9).map(({ descriptor }) => descriptor.label),
    [
      "Blend local Gaussian reduced-grid downsample",
      "Blend local Gaussian reduced-grid horizontal",
      "Blend local Gaussian reduced-grid vertical",
      "Blend local Gaussian reduced-grid restore",
    ],
    "large Blur must compile only the reduced-grid four-pass bundle",
  );
  assert.equal(device.pipelineDescriptors.length, 13);
  renderer.destroy();

  const concurrent = await createFakeBlendRenderer(DryBlendRenderer);
  await Promise.all([
    concurrent.renderer.ensureVariantPipelines(shapeGrainVariant),
    concurrent.renderer.ensureVariantPipelines(shapeGrainVariant),
  ]);
  assert.equal(
    concurrent.device.pipelineDescriptors.filter(({ descriptor }) =>
      descriptor.label === "Blend dry shape on fused sweep and pigment deposit"
    ).length,
    1,
    "concurrent requests for one Blend variant must share one compilation",
  );
  assert.equal(concurrent.device.pipelineDescriptors.length, 4);
  concurrent.renderer.destroy();
} finally {
  await vite.close();
  if (previousGpuBufferUsage === undefined) delete globalThis.GPUBufferUsage;
  else globalThis.GPUBufferUsage = previousGpuBufferUsage;
  if (previousGpuShaderStage === undefined) delete globalThis.GPUShaderStage;
  else globalThis.GPUShaderStage = previousGpuShaderStage;
}

console.log("Dry Blend core verification passed.");
