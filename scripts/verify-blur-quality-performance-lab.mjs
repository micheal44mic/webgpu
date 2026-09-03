import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BLUR_QUALITY_PERFORMANCE_FIXTURE_REVISION,
  BLUR_QUALITY_PERFORMANCE_LAB_ID,
  BLUR_QUALITY_PERFORMANCE_RADII,
  BLUR_QUALITY_PERFORMANCE_REPORT_VERSION,
  BLUR_QUALITY_PERFORMANCE_STRATEGY,
  blurCaseSpeedup,
  blurFixtureHash,
  blurQualityGuardrail,
  blurQualityPerformanceConfigFromSearch,
  computeBlurQualityMetrics,
  createBlurQualityPerformanceFixture,
  createBlurQualityPerformanceChecks,
  createBlurQualityPerformanceConfig,
  serializeBlurQualityPerformanceReport,
  summarizeBlurTimings,
} from "../src/labs/blur/blur-quality-performance-model.ts";

function closeTo(actual, expected, tolerance, message) {
  assert(
    Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}, received ${actual}`,
  );
}

assert.equal(BLUR_QUALITY_PERFORMANCE_LAB_ID, "blur-quality-performance");
assert.equal(BLUR_QUALITY_PERFORMANCE_REPORT_VERSION, 1);
assert.equal(
  BLUR_QUALITY_PERFORMANCE_FIXTURE_REVISION,
  "high-contrast-brush-circle-v2",
);
assert.equal(
  BLUR_QUALITY_PERFORMANCE_STRATEGY,
  "exact-gaussian-vs-continuous-scale-tent-v1",
);
assert.deepEqual(BLUR_QUALITY_PERFORMANCE_RADII, [4, 16, 64, 128, 256]);
assert(Object.isFrozen(BLUR_QUALITY_PERFORMANCE_RADII));
assert(
  BLUR_QUALITY_PERFORMANCE_RADII.some((radius) => radius > 64),
  "the comparison must exercise the multiscale path",
);

assert.throws(() => createBlurQualityPerformanceFixture(0), /positive integer/);
assert.throws(() => createBlurQualityPerformanceFixture(12.5), /positive integer/);
const fixture128 = createBlurQualityPerformanceFixture(128);
const repeatedFixture128 = createBlurQualityPerformanceFixture(128);
assert.equal(fixture128.byteLength, 128 * 128 * 4);
assert.deepEqual(fixture128, repeatedFixture128, "fixture bytes must be deterministic");
assert.equal(blurFixtureHash(fixture128), "fnv1a32-afb41737");
assert.equal(blurFixtureHash(repeatedFixture128), blurFixtureHash(fixture128));
let transparentPixels = 0;
let translucentPixels = 0;
let maximumAlpha = 0;
for (let offset = 0; offset < fixture128.length; offset += 4) {
  const alpha = fixture128[offset + 3];
  transparentPixels += Number(alpha === 0);
  translucentPixels += Number(alpha > 0 && alpha < 255);
  maximumAlpha = Math.max(maximumAlpha, alpha);
  assert(fixture128[offset] <= alpha);
  assert(fixture128[offset + 1] <= alpha);
  assert(fixture128[offset + 2] <= alpha);
}
assert(transparentPixels > 0, "fixture needs transparent pixels");
assert(translucentPixels > 0, "fixture needs translucent pixels");
assert(maximumAlpha >= 224, "fixture needs high-alpha detail");

function fixturePixel(x, y) {
  const offset = (y * 128 + x) * 4;
  return fixture128.slice(offset, offset + 4);
}

const circleCenter = fixturePixel(Math.floor(128 * 0.68), Math.floor(128 * 0.32));
assert(circleCenter[3] >= 240, "the circle must be clearly visible");
assert(
  circleCenter[0] > circleCenter[1] * 2,
  "the circle needs a high-contrast warm fill",
);
for (const [x, y] of [[0.22, 0.59], [0.52, 0.76], [0.84, 0.67]]) {
  const strokePixel = fixturePixel(Math.floor(128 * x), Math.floor(128 * y));
  assert(strokePixel[3] >= 224, "the brush mark must remain bold along its path");
  assert(
    strokePixel[2] > strokePixel[0] * 2,
    "the brush mark needs a high-contrast cool color",
  );
}
assert.deepEqual(
  fixturePixel(2, 2),
  new Uint8Array([0, 0, 0, 0]),
  "the fixture must retain transparent background around the subjects",
);

const serializationProbe = {
  version: BLUR_QUALITY_PERFORMANCE_REPORT_VERSION,
  lab: BLUR_QUALITY_PERFORMANCE_LAB_ID,
  fixture: {
    revision: BLUR_QUALITY_PERFORMANCE_FIXTURE_REVISION,
    hash: blurFixtureHash(fixture128),
  },
  cases: BLUR_QUALITY_PERFORMANCE_RADII.map((radius) => ({ radius })),
};
const serializedProbe = serializeBlurQualityPerformanceReport(serializationProbe);
assert.equal(
  serializeBlurQualityPerformanceReport(serializationProbe),
  serializedProbe,
  "report serialization must be stable",
);
assert.deepEqual(JSON.parse(serializedProbe), serializationProbe);
assert.match(serializedProbe, /\n  "lab": "blur-quality-performance"/);

const defaultConfig = createBlurQualityPerformanceConfig();
assert.deepEqual(defaultConfig, {
  size: 256,
  runs: 3,
  warmupRuns: 1,
  radii: BLUR_QUALITY_PERFORMANCE_RADII,
});
assert(Object.isFrozen(defaultConfig));
assert.deepEqual(createBlurQualityPerformanceConfig(), defaultConfig);
assert.deepEqual(
  createBlurQualityPerformanceConfig({ size: 161, runs: -4, warmupRuns: 99 }),
  { size: 192, runs: 1, warmupRuns: 3, radii: BLUR_QUALITY_PERFORMANCE_RADII },
);
assert.deepEqual(
  createBlurQualityPerformanceConfig({ size: 9_999, runs: 99, warmupRuns: -1 }),
  { size: 512, runs: 10, warmupRuns: 0, radii: BLUR_QUALITY_PERFORMANCE_RADII },
);
assert.deepEqual(
  blurQualityPerformanceConfigFromSearch(
    new URLSearchParams("size=320&runs=5&warmup=2"),
  ),
  { size: 320, runs: 5, warmupRuns: 2, radii: BLUR_QUALITY_PERFORMANCE_RADII },
);

const timings = summarizeBlurTimings([3, Number.NaN, -1, 1, 2, 4]);
assert.deepEqual(timings.samplesMs, [3, 1, 2, 4]);
assert(Object.isFrozen(timings.samplesMs));
closeTo(timings.medianMs, 2.5, 1e-12, "median");
closeTo(timings.p95Ms, 3.85, 1e-12, "p95");
assert.equal(timings.minimumMs, 1);
assert.equal(timings.maximumMs, 4);
assert.deepEqual(summarizeBlurTimings([]), {
  samplesMs: [],
  medianMs: 0,
  p95Ms: 0,
  minimumMs: 0,
  maximumMs: 0,
});
assert.deepEqual(
  summarizeBlurTimings([3, Number.NaN, -1, 1, 2, 4]),
  timings,
  "timing aggregation must be deterministic for a captured sample set",
);

const equalPixels = new Uint8Array([
  0, 64, 255, 0,
  255, 128, 32, 255,
]);
assert.deepEqual(computeBlurQualityMetrics(equalPixels, equalPixels), {
  meanAbsoluteError: 0,
  rootMeanSquareError: 0,
  peakSignalToNoiseRatioDb: null,
  maximumAbsoluteError: 0,
  alphaMeanAbsoluteError: 0,
  alphaEnergyRatio: 1,
});

const baselinePixel = new Uint8Array([0, 0, 0, 255]);
const optimizedPixel = new Uint8Array([255, 0, 0, 128]);
const knownMetrics = computeBlurQualityMetrics(baselinePixel, optimizedPixel);
const alphaDelta = 127 / 255;
closeTo(knownMetrics.meanAbsoluteError, (1 + alphaDelta) / 4, 1e-12, "MAE");
closeTo(
  knownMetrics.rootMeanSquareError,
  Math.sqrt((1 + alphaDelta ** 2) / 4),
  1e-12,
  "RMSE",
);
closeTo(
  knownMetrics.peakSignalToNoiseRatioDb,
  20 * Math.log10(1 / knownMetrics.rootMeanSquareError),
  1e-12,
  "PSNR",
);
assert.equal(knownMetrics.maximumAbsoluteError, 1);
closeTo(knownMetrics.alphaMeanAbsoluteError, alphaDelta, 1e-12, "alpha MAE");
closeTo(knownMetrics.alphaEnergyRatio, 128 / 255, 1e-12, "alpha energy ratio");
assert.throws(
  () => computeBlurQualityMetrics(new Uint8Array(4), new Uint8Array(8)),
  /matching RGBA dimensions/,
);
assert.throws(
  () => computeBlurQualityMetrics(new Uint8Array(3), new Uint8Array(3)),
  /matching RGBA dimensions/,
);
assert.throws(
  () => computeBlurQualityMetrics(new Uint8Array(), new Uint8Array()),
  /must not be empty/,
);

const passingQuality = {
  meanAbsoluteError: 0.01,
  rootMeanSquareError: 0.02,
  peakSignalToNoiseRatioDb: 34,
  maximumAbsoluteError: 0.1,
  alphaMeanAbsoluteError: 0.01,
  alphaEnergyRatio: 1,
};
assert.equal(blurQualityGuardrail(passingQuality), true);
assert.equal(blurQualityGuardrail({
  ...passingQuality,
  peakSignalToNoiseRatioDb: 19.99,
}), false);
assert.equal(blurQualityGuardrail({
  ...passingQuality,
  alphaEnergyRatio: 1.151,
}), false);
assert.equal(blurCaseSpeedup(20, 5), 4);
assert.equal(blurCaseSpeedup(20, 0), 0);

function syntheticCase(radius) {
  return {
    radius,
    baseline: summarizeBlurTimings([8, 10, 9]),
    optimized: summarizeBlurTimings([2, 3, 2.5]),
    speedup: blurCaseSpeedup(9, 2.5),
    work: {
      rawCount: radius,
      count: Math.min(radius, 64),
      downsample: Math.max(1, radius / 64),
      workScale: Math.min(1, 64 / radius),
      prefilterSampleAxis: radius <= 64
        ? 1
        : Math.min(4, Math.ceil(radius / 64)),
      prefilterWidth: Math.max(0, radius / 64 - 1),
      width: 256,
      height: 256,
    },
    quality: passingQuality,
  };
}

const deterministicCases = BLUR_QUALITY_PERFORMANCE_RADII.map(syntheticCase);
const passingChecks = createBlurQualityPerformanceChecks(deterministicCases);
assert.deepEqual(passingChecks, {
  allScenariosCompleted: true,
  timingsAreFinite: true,
  qualityMetricsAreFinite: true,
  outputsRetainAlphaEnergy: true,
});
assert(Object.isFrozen(passingChecks));
assert.deepEqual(
  createBlurQualityPerformanceChecks(deterministicCases),
  passingChecks,
  "report checks must be deterministic for captured cases",
);
assert.equal(
  createBlurQualityPerformanceChecks(deterministicCases.slice(1)).allScenariosCompleted,
  false,
);
assert.equal(
  createBlurQualityPerformanceChecks([
    { ...deterministicCases[0], speedup: Number.NaN },
    ...deterministicCases.slice(1),
  ]).timingsAreFinite,
  false,
);

const lab = readFileSync(
  new URL("../src/labs/blur/blur-quality-performance-lab.ts", import.meta.url),
  "utf8",
);
const registry = readFileSync(
  new URL("../src/labs/editor-labs.ts", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../src/labs/styles.css", import.meta.url),
  "utf8",
);
const packageJson = JSON.parse(readFileSync(
  new URL("../package.json", import.meta.url),
  "utf8",
));

assert.match(lab, /export async function runBlurQualityPerformanceLab/);
assert.match(lab, /destructiveGaussianBlurKernel\(radius\)/);
assert.match(lab, /destructiveTentBlurPlan\(radius, 1\)/);
assert.match(lab, /const WORKING_TEXTURE_FORMAT: GPUTextureFormat = "rgba16float"/);
assert.match(lab, /texture_storage_2d<rgba16float, write>/);
assert.match(lab, /textureSampleLevel\(/);
assert.match(lab, /let combinedOffset\s*=\s*[\s\S]{0,160}combinedWeight/);
assert.match(lab, /first < \$\{DESTRUCTIVE_TENT_BLUR_MAX_WORK_RADIUS\}\.0/);
assert.match(lab, /device\.queue\.onSubmittedWorkDone\(\)/);
assert.match(
  lab,
  /const started = performance\.now\(\);\s*device\.queue\.submit\(\[commands\]\);\s*await withQueueFenceTimeout\(device\);/,
  "timings must include completion of submitted GPU work",
);
assert.match(lab, /for \(let warmup = 0; warmup < config\.warmupRuns; warmup \+= 1\)/);
assert.match(lab, /\(caseIndex \+ warmup\) % 2 === 0/);
assert.match(lab, /\(caseIndex \+ run\) % 2 === 0/);
assert.match(
  lab,
  /const baselineSamples: number\[\] = \[\];\s*const optimizedSamples: number\[\] = \[\];/,
);
assert.match(lab, /computeBlurQualityMetrics\(baselinePixels, optimizedPixels\)/);
assert.match(lab, /rgba16FloatRowsToRgba8Unorm/);
assert.match(lab, /timingMethod: "queue-fence"/);
assert.match(lab, /scope: "isolated-algorithm-benchmark"/);
assert.match(lab, /command-submit-to-queue-idle; excludes setup, readback, editor composition/);
assert.match(lab, /comparisonProfile: \{/);
assert.match(lab, /sourceFormat: "rgba8unorm"/);
assert.match(lab, /workingFormat: "rgba16float"/);
assert.match(lab, /alpha: "premultiplied"/);
assert.match(lab, /baselineColorProcessing: "encoded-to-linear-to-encoded"/);
assert.match(lab, /optimizedColorProcessing: "stored-value averaging"/);
assert.match(lab, /prefilterSampleAxis: plan\.prefilterSampleAxis/);
assert.match(lab, /prefilterWidth: plan\.prefilterWidth/);
assert.match(lab, /timestampQueryAvailable: engine\.device\.features\.has\("timestamp-query"\)/);
assert.match(lab, /userAgent: navigator\.userAgent/);
assert.match(lab, /hardwareConcurrency: navigator\.hardwareConcurrency \|\| null/);
assert.match(lab, /deviceMemoryGiB:/);
assert.match(lab, /devicePixelRatio: window\.devicePixelRatio/);
assert.match(lab, /hash: blurFixtureHash\(fixture\)/);
assert.match(lab, /cases\.push\(report\)/);
assert.match(lab, /window\.__editorLabReport = report/);
assert.match(
  lab,
  /passed:\s*checks\.allScenariosCompleted[\s\S]{0,160}checks\.timingsAreFinite[\s\S]{0,160}checks\.qualityMetricsAreFinite/,
  "a valid measurement must not be reported as an infrastructure error when quality differs",
);
assert.match(lab, /Soglia qualità[\s\S]{0,180}differenza visibile/);

for (const selector of [
  "root",
  "progress",
  "status",
  "table",
  "preview-select",
  "preview-original",
  "preview-baseline",
  "preview-optimized",
  "copy",
  "download",
  "rerun",
  "close",
]) {
  assert.match(lab, new RegExp(`data-blur-lab-${selector}`));
}
assert.match(lab, /canvasForCapture\(originalCanvas, fixture, config\.size\)/);
assert.match(lab, /navigator\.clipboard\?\.writeText/);
assert.match(lab, /document\.execCommand\("copy"\)/);
assert.match(lab, /new Blob\(\[serializeBlurQualityPerformanceReport\(report\)\]/);
assert.match(lab, /type: "application\/json"/);
assert.match(lab, /link\.download = `blur-quality-performance-/);
assert.match(lab, /aria-live="polite"/);

assert.match(registry, /\["blur-quality-performance", "A\/B blur · qualità e prestazioni"\]/);
assert.match(registry, /HOSTED_LAB_IDS[\s\S]{0,500}"blur-quality-performance"/);
assert.match(registry, /case "blur-quality-performance"/);
assert.match(registry, /import\(\s*"\.\/blur\/blur-quality-performance-lab"\s*\)/);
assert.match(registry, /runBlurQualityPerformanceLab\(engine, \{/);
assert.match(registry, /onProgress: \(progress\) => \{/);

assert.match(styles, /\.blur-quality-performance-lab button,[\s\S]{0,120}min-height: 44px/);
assert.match(
  styles,
  /\.blur-lab-preview-grid\s*\{[\s\S]{0,120}grid-template-columns: repeat\(3,/,
);
assert.match(styles, /@media \(max-width: 760px\)[\s\S]{0,800}\.blur-quality-performance-lab/);
assert.match(styles, /@media \(max-width: 430px\)[\s\S]{0,600}\.blur-lab-summary/);
assert.doesNotMatch(
  styles.slice(styles.indexOf(".blur-quality-performance-lab")),
  /:hover/,
  "the mobile comparison must not hide an interaction behind hover",
);

assert.equal(
  packageJson.scripts["blur-quality-performance-lab:verify"],
  "node scripts/verify-blur-quality-performance-lab.mjs",
);
assert.match(packageJson.scripts["gaussian-blur:verify"], /blur-quality-performance-lab:verify/);

console.log("Blur quality/performance Lab model verification passed.");
