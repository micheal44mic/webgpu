import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { readEngineSource } from "./engine-source.mjs";
import {
  DEFAULT_RASTER_BEVEL_STYLE,
  RASTER_BEVEL_HEIGHTFIELD_CALIBRATION,
  RASTER_BEVEL_MAX_RADIUS,
  RASTER_BEVEL_MAX_WORK_SIDE,
  RASTER_BEVEL_PROFILE_SIZE,
  RASTER_BEVEL_CONTOURS,
  RASTER_BEVEL_FIELD_IDLE_SHRINK_DELAY_MS,
  RASTER_BEVEL_FIELD_MINIMUM_SHRINK_BYTES,
  RASTER_BEVEL_MODES,
  RASTER_BEVEL_TECHNIQUES,
  classifyRasterBevelStyleChange,
  copyRasterBevelStyle,
  deriveRasterBevelHeightfield,
  makeRasterBevelSplineContourLut,
  normalizeRasterBevelStyle,
  planRasterBevelFieldTransition,
  rasterBevelAlignedFieldBounds,
  rasterBevelFieldMemoryBytes,
  rasterBevelFieldShrinkIsWorthwhile,
  rasterBevelGeometryKey,
  rasterBevelLightVector,
  rasterBevelOutsideFieldHeight,
  rasterBevelRadiusBucket,
  rasterBevelStylesEqual,
  rasterBevelVisualBounds,
} from "../src/bevel-core.ts";

const approx = (actual, expected, epsilon = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
};

assert.deepEqual(normalizeRasterBevelStyle(), DEFAULT_RASTER_BEVEL_STYLE);
assert.equal(Object.isFrozen(DEFAULT_RASTER_BEVEL_STYLE), true);
assert.deepEqual(RASTER_BEVEL_HEIGHTFIELD_CALIBRATION, {
  smoothSigmaScale: 0.5,
  chiselSoftSigmaScale: 0.15,
  softenSigmaScale: 1,
  smoothAmplitudeScale: 0.31,
  rangeHypothesis: "A",
  adaptiveIso: false,
  blurKernel: "gaussian",
  defaultEffectOpacity: { highlight: 0.75, shadow: 0.75 },
});

const normalized = normalizeRasterBevelStyle({
  enabled: 1,
  mode: "outer",
  technique: "chiselSoft",
  direction: "down",
  size: 999,
  soften: -1,
  depth: 2_000,
  angle: -45,
  altitude: 100,
  highlight: "#804020",
  shadow: [2, -1, Number.NaN],
  highlightOpacity: -10,
  shadowOpacity: 120,
  gloss: "ring",
  contourAA: false,
  bevelContourEnabled: true,
  bevelContour: "cone",
  bevelRange: 0,
  fill: 150,
});
assert.deepEqual(normalized, {
  enabled: true,
  mode: "outer",
  technique: "chiselSoft",
  direction: "down",
  gloss: "ring",
  contourAA: false,
  bevelContourEnabled: true,
  bevelContour: "cone",
  size: 250,
  soften: 0,
  bevelRange: 1,
  fill: 100,
  depth: 1_000,
  angle: 315,
  altitude: 90,
  highlightColor: [128 / 255, 64 / 255, 32 / 255],
  highlightOpacity: 0,
  shadowColor: [1, 0, 0.035],
  shadowOpacity: 100,
});

const copy = copyRasterBevelStyle(DEFAULT_RASTER_BEVEL_STYLE);
assert.notEqual(copy.highlightColor, DEFAULT_RASTER_BEVEL_STYLE.highlightColor);
assert.notEqual(copy.shadowColor, DEFAULT_RASTER_BEVEL_STYLE.shadowColor);
assert.equal(rasterBevelStylesEqual(copy, DEFAULT_RASTER_BEVEL_STYLE), true);

const defaultDerived = deriveRasterBevelHeightfield(DEFAULT_RASTER_BEVEL_STYLE);
assert.equal(defaultDerived.sigma1, 16);
assert.equal(defaultDerived.sigmaTech, 0);
assert.equal(defaultDerived.sigmaSoften, 4);
approx(defaultDerived.sigmaB, Math.hypot(0.5, 4));
assert.equal(defaultDerived.bandWidth, 32);
approx(defaultDerived.amplitudeScale, 9.92);
assert.equal(defaultDerived.apron, 63);

for (const technique of RASTER_BEVEL_TECHNIQUES) {
  for (const mode of ["inner", "outer", "emboss", "pillow"]) {
    const derived = deriveRasterBevelHeightfield({
      ...DEFAULT_RASTER_BEVEL_STYLE,
      technique,
      mode,
      size: 250,
      soften: 64,
    });
    assert.ok(derived.apron <= RASTER_BEVEL_MAX_RADIUS);
    assert.ok(256 + derived.apron * 2 <= RASTER_BEVEL_MAX_WORK_SIDE);
  }
}

const geometryStyle = { ...DEFAULT_RASTER_BEVEL_STYLE, enabled: true };
assert.equal(
  classifyRasterBevelStyleChange(
    geometryStyle,
    { ...geometryStyle, depth: 180 },
    rasterBevelRadiusBucket(geometryStyle),
  ).geometryRebuild,
  false,
);
assert.equal(
  classifyRasterBevelStyleChange(
    geometryStyle,
    { ...geometryStyle, size: 64 },
  ).geometryRebuild,
  true,
);
assert.notEqual(
  rasterBevelGeometryKey(geometryStyle),
  rasterBevelGeometryKey({ ...geometryStyle, bevelRange: 80 }),
);
assert.ok(rasterBevelRadiusBucket({ ...geometryStyle, size: 250, soften: 64 })
  <= RASTER_BEVEL_MAX_RADIUS);

assert.deepEqual(
  rasterBevelVisualBounds(
    { x: 100, y: 100, width: 20, height: 30 },
    { ...geometryStyle, mode: "inner" },
    512,
    512,
  ),
  { x: 100, y: 100, width: 20, height: 30 },
);
const outerBounds = rasterBevelVisualBounds(
  { x: 100, y: 100, width: 20, height: 30 },
  { ...geometryStyle, mode: "outer" },
  512,
  512,
);
assert.ok(outerBounds.x < 100 && outerBounds.y < 100);
assert.ok(outerBounds.width > 20 && outerBounds.height > 30);

const east = rasterBevelLightVector(0, 0);
approx(east[0], 1);
approx(east[1], 0);
approx(east[2], 0);
const zenith = rasterBevelLightVector(90, 90);
approx(zenith[0], 0);
approx(zenith[1], 0);
approx(zenith[2], 1);

for (const kind of ["linear", "soft", "gaussian", "cone", "ring"]) {
  const lut = makeRasterBevelSplineContourLut(kind, RASTER_BEVEL_PROFILE_SIZE);
  assert.equal(lut.length, RASTER_BEVEL_PROFILE_SIZE);
  assert.ok(lut.every((value) => value >= 0 && value <= 1));
}
assert.deepEqual(
  makeRasterBevelSplineContourLut("soft", 32),
  makeRasterBevelSplineContourLut("gaussian", 32),
);

assert.deepEqual(
  rasterBevelAlignedFieldBounds(
    { x: 300, y: 500, width: 400, height: 300 },
    4096,
    4096,
  ),
  { x: 256, y: 256, width: 512, height: 768 },
);
assert.deepEqual(
  rasterBevelAlignedFieldBounds(
    { x: 900, y: 700, width: 100, height: 100 },
    1000,
    800,
  ),
  { x: 768, y: 512, width: 232, height: 288 },
);
assert.equal(rasterBevelAlignedFieldBounds(null), null);

const smallField = { x: 0, y: 0, width: 1024, height: 1024 };
const grownField = { x: 0, y: 0, width: 1280, height: 1024 };
const innerField = { x: 256, y: 256, width: 512, height: 512 };
assert.deepEqual(
  planRasterBevelFieldTransition(null, smallField),
  {
    kind: "grow",
    allocationBounds: smallField,
    validBounds: smallField,
    reallocated: true,
    fullRebuild: true,
  },
  "first allocation must rebuild the entire target bbox",
);
assert.deepEqual(
  planRasterBevelFieldTransition(smallField, innerField),
  {
    kind: "retain",
    allocationBounds: smallField,
    validBounds: innerField,
    reallocated: false,
    fullRebuild: false,
  },
  "an in-capacity ROI update must preserve the allocation and stay incremental",
);
assert.deepEqual(
  planRasterBevelFieldTransition(smallField, grownField),
  {
    kind: "grow",
    allocationBounds: grownField,
    validBounds: grownField,
    reallocated: true,
    fullRebuild: true,
  },
  "growth must rebuild the whole new bbox, never only its crown",
);
const fullField = { x: 0, y: 0, width: 4096, height: 4096 };
assert.equal(RASTER_BEVEL_FIELD_IDLE_SHRINK_DELAY_MS, 1_500);
assert.equal(RASTER_BEVEL_FIELD_MINIMUM_SHRINK_BYTES, 8 * 1024 * 1024);
assert.equal(
  rasterBevelFieldMemoryBytes(fullField),
  4098 * 4098 * 4,
  "full path accounting must remain exactly 4098² R32F",
);
assert.equal(rasterBevelFieldShrinkIsWorthwhile(fullField, smallField), true);
assert.equal(
  planRasterBevelFieldTransition(fullField, smallField, false).kind,
  "retain",
  "shrink must remain deferred without the idle permission",
);
const idleShrink = planRasterBevelFieldTransition(fullField, smallField, true);
assert.equal(idleShrink.kind, "shrink");
assert.equal(idleShrink.fullRebuild, true);
assert.deepEqual(idleShrink.allocationBounds, smallField);

const profileSample = (kind, rangePercent, input) => {
  const values = makeRasterBevelSplineContourLut(kind, RASTER_BEVEL_PROFILE_SIZE);
  const normalized = Math.min(input / Math.max(rangePercent / 100, 1e-3), 1);
  const q = normalized * (RASTER_BEVEL_PROFILE_SIZE - 1);
  const first = Math.floor(q);
  const second = Math.min(RASTER_BEVEL_PROFILE_SIZE - 1, first + 1);
  return values[first] * (1 - (q - first)) + values[second] * (q - first);
};
for (const mode of RASTER_BEVEL_MODES) {
  for (const technique of RASTER_BEVEL_TECHNIQUES) {
    const plain = rasterBevelOutsideFieldHeight({
      ...DEFAULT_RASTER_BEVEL_STYLE,
      mode,
      technique,
      bevelContourEnabled: false,
    });
    assert.equal(plain, mode === "pillow" ? 1 : 0);
    for (const bevelContour of RASTER_BEVEL_CONTOURS) {
      const range = 37;
      const contoured = rasterBevelOutsideFieldHeight({
        ...DEFAULT_RASTER_BEVEL_STYLE,
        mode,
        technique,
        bevelContourEnabled: true,
        bevelContour,
        bevelRange: range,
      });
      approx(
        contoured,
        profileSample(bevelContour, range, mode === "pillow" ? 1 : 0),
      );
    }
  }
}
// Required mutation oracle: forcing the outside constant to zero is invisible
// for inner/outer, but is observably wrong for pillow.
assert.equal(rasterBevelOutsideFieldHeight({ mode: "inner" }), 0);
assert.equal(rasterBevelOutsideFieldHeight({ mode: "outer" }), 0);
assert.notEqual(rasterBevelOutsideFieldHeight({ mode: "pillow" }), 0);

const coreSource = readFileSync(new URL("../src/bevel-core.ts", import.meta.url), "utf8");
const importMutatedCore = async (needle, replacement, label) => {
  const occurrences = coreSource.split(needle).length - 1;
  assert.equal(occurrences, 1, `${label}: mutation anchor must be unique`);
  const mutatedSource = coreSource.replace(needle, replacement);
  const runtimeSource = stripTypeScriptTypes(mutatedSource, { mode: "transform" });
  const moduleUrl = `data:text/javascript;base64,${
    Buffer.from(runtimeSource).toString("base64")
  }#${encodeURIComponent(label)}`;
  return import(moduleUrl);
};

const zeroOutsideMutation = await importMutatedCore(
  'const neutralProfileInput = style.mode === "pillow" ? 1 : 0;',
  "const neutralProfileInput = 0;",
  "outside-height-forced-zero",
);
assert.equal(zeroOutsideMutation.rasterBevelOutsideFieldHeight({ mode: "inner" }), 0);
assert.equal(zeroOutsideMutation.rasterBevelOutsideFieldHeight({ mode: "outer" }), 0);
assert.throws(
  () => assert.notEqual(
    zeroOutsideMutation.rasterBevelOutsideFieldHeight({ mode: "pillow" }),
    0,
  ),
  "the forced-zero mutation must be detected by pillow while inner/outer stay valid",
);

const crownOnlyMutation = await importMutatedCore(
  "fullRebuild: targetBounds !== null,",
  "fullRebuild: false,",
  "growth-rebuilds-only-crown",
);
assert.throws(
  () => assert.equal(
    crownOnlyMutation.planRasterBevelFieldTransition(
      smallField,
      grownField,
    ).fullRebuild,
    true,
  ),
  "the growth mutation must be rejected because a new texture needs the whole bbox",
);

const workbenchSource = readFileSync(new URL("../src/effects-workbench.ts", import.meta.url), "utf8");
const benchmarkSource = readFileSync(new URL("../src/labs/benchmarks/effects-benchmark.ts", import.meta.url), "utf8");
const rendererSource = readFileSync(new URL("../src/bevel-renderer.ts", import.meta.url), "utf8");
const styleStackSource = readFileSync(new URL("../src/stroke-renderer.ts", import.meta.url), "utf8");
const bboxGoldenSource = readFileSync(
  new URL("../src/labs/goldens/bevel-bbox-golden.ts", import.meta.url),
  "utf8",
);
assert(rendererSource.includes("raster-bevel-webgpu-v5-bbox-field-shared-effects-scratch-retargetable-layer"));
assert(rendererSource.includes("shared-effects-pool-roi-split-common-segment-arenas-grow-until-idle-shrink"));
const engineSource = readEngineSource();
assert(rendererSource.includes("texture_storage_2d<r32float, write>"));
assert(rendererSource.includes("Bevel continuous F32 coverage WGSL"));
assert.match(rendererSource, /commonCursor \+= alignedWords\(pixels\)/);
assert.match(
  rendererSource,
  /storeFloat\(parameters\.outputOffsetWords, vec2<u32>\(x, globalId\.y\), alpha\)/,
);
assert.match(rendererSource, /if \(alpha >= 0\.5\)/);
assert.match(rendererSource, /if \(alpha > 0\.0 && alpha < 1\.0\)/);
assert.doesNotMatch(rendererSource, /alphaByte|coverage R8 packed|alpha to packed R8/);
assert(rendererSource.includes("marching"));
assert(rendererSource.includes("segmentDistance"));
assert(rendererSource.includes("jfaScheduleForExtent"));
assert(rendererSource.includes("beginComputePass"));
assert(!rendererSource.includes("mapAsync"));
assert(styleStackSource.includes("bevelNode(base, position)"));
assert(styleStackSource.indexOf("bevelNode(base, position)")
  < styleStackSource.indexOf("combinedStrokeNode(base.a, node, coverage)"));
assert(!styleStackSource.includes("random24(documentPosition, 4660u)"));
assert.doesNotMatch(styleStackSource, /0\.75 \/ 255\.0/);
assert(engineSource.includes("sourceMode: RasterStrokeSourceMode"));
assert.match(rendererSource, /retarget\(layerView: GPUTextureView\)/);
assert.match(rendererSource, /this\.sourceViews\[0\] = layerView/);
assert.match(rendererSource, /this\.sourceViews\[1\] = this\.lightGlazeView \?\? layerView/);
assert.match(rendererSource, /this\.sourceViews\[2\] = this\.thicknessTailView \?\? layerView/);
assert.match(rendererSource, /this\.rebuildBindGroups\(\)/);
assert(workbenchSource.includes("single-retargetable-active-layer-source"));
assert(benchmarkSource.includes("clearHeight: true"));
assert(benchmarkSource.includes("clearStyled: true"));
assert(engineSource.includes("engine.rasterBevelRenderer?.workspaceMemoryBytes"));
assert.match(
  engineSource,
  /retargetEffectsWorkingSet\([\s\S]*contentBounds: DirtyRect \| null \| undefined/,
  "retarget must transport known source content bounds",
);
assert.match(
  engineSource,
  /bevelContentBounds: DirtyRect \| null = virtualContentBounds/,
  "only the bevel field may receive a smaller retarget domain in PR3",
);
assert.match(engineSource, /bevelFieldShrinkOnNextEncode/);
assert.match(engineSource, /RASTER_BEVEL_FIELD_IDLE_SHRINK_DELAY_MS/);
assert.match(engineSource, /bevelFieldBlocksScratchShrink/);
assert.equal(
  rendererSource.includes("copyTextureToTexture"),
  false,
  "bbox growth must rebuild the new domain without a preservation copy",
);
const bevelEncodeStart = rendererSource.indexOf(
  "  encode(options: RasterBevelEncodeOptions): RasterBevelEncodeResult {",
);
const bevelEncodeEnd = rendererSource.indexOf("\n  destroy(): void {", bevelEncodeStart);
assert.notEqual(bevelEncodeStart, -1);
assert.notEqual(bevelEncodeEnd, -1);
const bevelEncodeSource = rendererSource.slice(bevelEncodeStart, bevelEncodeEnd);
const fieldPreparationIndex = bevelEncodeSource.indexOf(
  "const fieldPreparation = this.prepareHeightField(",
);
const encoderCommandIndexes = [
  "options.encoder.clearBuffer(",
  "options.encoder.beginComputePass(",
  "options.encoder.beginRenderPass(",
].map((needle) => bevelEncodeSource.indexOf(needle)).filter((index) => index >= 0);
assert.notEqual(fieldPreparationIndex, -1);
assert.ok(encoderCommandIndexes.length > 0);
assert.ok(
  encoderCommandIndexes.every((index) => fieldPreparationIndex < index),
  "field replacement must precede every encoder command that can use the field",
);
assert.match(bboxGoldenSource, /for \(const mode of RASTER_BEVEL_MODES\)/);
assert.match(bboxGoldenSource, /for \(const technique of RASTER_BEVEL_TECHNIQUES\)/);
assert.match(bboxGoldenSource, /for \(const contour of \["off", "linear"\] as const\)/);
assert.match(bboxGoldenSource, /RASTER_BEVEL_BBOX_GOLDEN_VERSION = 2/);
assert.match(
  bboxGoldenSource,
  /RASTER_BEVEL_BBOX_GOLDEN_FORMAT = "rgba16float"/,
);
assert.match(bboxGoldenSource, /packRgba8FixtureAsRgba16FloatBytes/);
assert.match(bboxGoldenSource, /GOLDEN_RGBA16F_BYTES_PER_PIXEL = 8/);
assert.match(bboxGoldenSource, /lightGlazeUniforms\[1\] = 1/);
assert.match(bboxGoldenSource, /format: RASTER_BEVEL_BBOX_GOLDEN_FORMAT/);
assert.doesNotMatch(bboxGoldenSource, /format: "rgba8unorm"/);
assert.doesNotMatch(bboxGoldenSource, /layerFormat: "rgba8unorm"/);
assert.match(bboxGoldenSource, /matrixComplete/);
assert.match(bboxGoldenSource, /fullPair\.workbench !== bboxPair\.workbench/);
assert.match(bboxGoldenSource, /zero-outside/);
assert.match(bboxGoldenSource, /zeroMutationExpectedToMatch = mode !== "pillow"/);
assert.match(bboxGoldenSource, /omit-origin/);
assert.match(
  bboxGoldenSource,
  /bbox\.bevel\.resolvedPixels\s*=== fieldBounds\.width \* fieldBounds\.height/,
  "the bbox golden must prove realloc work is bounded to the new bbox",
);
assert.doesNotMatch(
  bboxGoldenSource,
  /previous(Image|Pixels|Output)/i,
  "the bbox golden must not compare against a previous image",
);
assert.match(styleStackSource, /Golden-only compile mutation/);
assert.match(styleStackSource, /bevelBoundingFieldTestMutation \?\? "none"/);

console.log("Raster bevel Heightfield V2 verification passed.");
