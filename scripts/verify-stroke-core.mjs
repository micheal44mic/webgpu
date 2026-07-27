import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  DEFAULT_RASTER_STROKE_STYLE,
  RASTER_STROKE_ALPHA_THRESHOLD,
  RASTER_STROKE_DISTANCE_SCALE,
  RASTER_STROKE_JFA_TIE_ORDER,
  RASTER_STROKE_MAX_DISTANCE,
  RASTER_STROKE_COMPOSITOR_ONLY_SCRATCH_EXTENT,
  RASTER_STROKE_COMPACT_SCRATCH_EXTENT,
  RASTER_STROKE_COMPACT_SCRATCH_MAX_WIDTH,
  RASTER_STROKE_FULL_SCRATCH_EXTENT,
  RASTER_STROKE_SCRATCH_STRATEGY,
  RASTER_STROKE_MAX_WIDTH,
  compositeRasterStrokePixel,
  copyRasterStrokeStyle,
  dilateRasterStrokeTileKeys,
  jfaScheduleForExtent,
  nextRasterStrokeMipValidThroughLevel,
  normalizeRasterStrokeStyle,
  packRasterStrokeDistanceQ10_6,
  partitionRasterStrokeBuildKeys,
  quantizeRasterStrokeCoverage,
  quantizeRasterStrokeDistance,
  rasterStrokeBuildRegion,
  rasterStrokeCoverageFromFixedDistance,
  rasterStrokeCoverageFromSignedDistance,
  rasterStrokeJfaCandidateWins,
  rasterStrokeJfaScheduleForRegion,
  rasterStrokeJfaSeedTieLess,
  rasterStrokeScratchExtentForRenderer,
  rasterStrokeScratchExtentForWidth,
  rasterStrokeSignedDistance,
  rasterStrokeStylesEqual,
  rasterStrokeTileHalo,
  unpackRasterStrokeDistanceQ10_6,
  unpackRasterStrokeFixedDistanceFromUnorm,
} from "../src/stroke-core.ts";

const approx = (actual, expected, epsilon = 1e-12) => {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${actual} != ${expected}`,
  );
};

// Style normalization is copied from raster-stroke-style-gpu.js.
assert.deepEqual(normalizeRasterStrokeStyle(), {
  enabled: false,
  width: 14,
  position: "outside",
  color: [1, 0.643, 0.282, 1],
});
assert.equal(Object.isFrozen(DEFAULT_RASTER_STROKE_STYLE), true);
assert.equal(Object.isFrozen(DEFAULT_RASTER_STROKE_STYLE.color), true);
assert.deepEqual(
  normalizeRasterStrokeStyle({
    enabled: "false",
    width: -20,
    position: "CENTER",
    color: [2, -1, Number.NaN, 0.25],
  }),
  {
    enabled: true,
    width: 0,
    position: "center",
    color: [1, 0, 0.282, 0.25],
  },
);
assert.equal(normalizeRasterStrokeStyle({ width: 900 }).width, RASTER_STROKE_MAX_WIDTH);
assert.equal(normalizeRasterStrokeStyle({ width: Number.NaN }).width, 14);
assert.equal(normalizeRasterStrokeStyle({ position: "diagonal" }).position, "outside");
assert.deepEqual(normalizeRasterStrokeStyle({ color: [0.1] }).color, [
  0.1,
  0.643,
  0.282,
  1,
]);
const copiedStyle = copyRasterStrokeStyle(DEFAULT_RASTER_STROKE_STYLE);
assert.notEqual(copiedStyle.color, DEFAULT_RASTER_STROKE_STYLE.color);
assert.equal(rasterStrokeStylesEqual(copiedStyle, DEFAULT_RASTER_STROKE_STYLE), true);
assert.equal(rasterStrokeStylesEqual(copiedStyle, { ...copiedStyle, width: 15 }), false);

assert.equal(
  RASTER_STROKE_SCRATCH_STRATEGY,
  "compositor-only-8-otherwise-width-tiered-1024-through-128-or-2048",
);
assert.equal(
  rasterStrokeScratchExtentForRenderer(false, 14),
  RASTER_STROKE_COMPOSITOR_ONLY_SCRATCH_EXTENT,
);
assert.equal(
  rasterStrokeScratchExtentForRenderer(true, 0),
  RASTER_STROKE_COMPOSITOR_ONLY_SCRATCH_EXTENT,
);
assert.equal(
  rasterStrokeScratchExtentForRenderer(true, 14),
  RASTER_STROKE_COMPACT_SCRATCH_EXTENT,
);
assert.equal(rasterStrokeScratchExtentForWidth(14), RASTER_STROKE_COMPACT_SCRATCH_EXTENT);
assert.equal(
  rasterStrokeScratchExtentForWidth(RASTER_STROKE_COMPACT_SCRATCH_MAX_WIDTH),
  RASTER_STROKE_COMPACT_SCRATCH_EXTENT,
);
assert.equal(
  rasterStrokeScratchExtentForWidth(RASTER_STROKE_COMPACT_SCRATCH_MAX_WIDTH + 1),
  RASTER_STROKE_FULL_SCRATCH_EXTENT,
);
assert.equal(rasterStrokeScratchExtentForWidth(512), RASTER_STROKE_FULL_SCRATCH_EXTENT);
const compactTargetExtent = RASTER_STROKE_COMPACT_SCRATCH_EXTENT
  - 2 * Math.ceil(RASTER_STROKE_COMPACT_SCRATCH_MAX_WIDTH + 2);
const compactFullDocumentJobs = Math.ceil(4_096 / compactTargetExtent) ** 2;
const compactParameters = compactFullDocumentJobs
  * (jfaScheduleForExtent(RASTER_STROKE_COMPACT_SCRATCH_EXTENT, { plusOne: true }).length + 2);
assert.ok(compactParameters < 2_048);

// A mip-0 change makes every coarser level not rebuilt in the same frame
// stale. Zooming out later must rebuild it instead of reusing old pixels.
assert.equal(nextRasterStrokeMipValidThroughLevel(4, 0, true), 0);
assert.equal(nextRasterStrokeMipValidThroughLevel(4, 1, true), 1);
assert.equal(nextRasterStrokeMipValidThroughLevel(1, 4, false), 4);
assert.equal(nextRasterStrokeMipValidThroughLevel(4, 1, false), 4);

// The distance-validity halo is ceil((width + 1.5) / tileSize), minimum one.
assert.equal(rasterStrokeTileHalo(256, 0), 1);
assert.equal(rasterStrokeTileHalo(256, 14), 1);
assert.equal(rasterStrokeTileHalo(256, 254.5), 1);
assert.equal(rasterStrokeTileHalo(256, 255), 2);
assert.equal(rasterStrokeTileHalo(256, 512), 3);
assert.equal(rasterStrokeTileHalo(256, 900), 3);
assert.deepEqual(
  dilateRasterStrokeTileKeys([5], 4, 4, 256, 14),
  [0, 1, 2, 4, 5, 6, 8, 9, 10],
);
const tileMask = new Uint8Array(16);
tileMask[0] = 1;
assert.deepEqual(
  dilateRasterStrokeTileKeys(tileMask, 4, 4, 256, 14),
  [0, 1, 4, 5],
);

// Build regions retain the old width + 2 apron and the [-1, document + 1]
// virtual border. The first vector is an interior 256 px tile.
const interiorRegion = rasterStrokeBuildRegion([5], 1024, 1024, 256, 14);
assert.deepEqual(interiorRegion, {
  x0: 240,
  y0: 240,
  x1: 528,
  y1: 528,
  w: 288,
  h: 288,
  halo: 16,
});
assert.deepEqual(rasterStrokeBuildRegion([0], 1024, 1024, 256, 14), {
  x0: -1,
  y0: -1,
  x1: 272,
  y1: 272,
  w: 273,
  h: 273,
  halo: 16,
});
assert.equal(rasterStrokeBuildRegion([], 1024, 1024, 256, 14), null);
assert.deepEqual(
  partitionRasterStrokeBuildKeys(
    [15, 0, 12, 3, 15, -1, 99],
    1024,
    1024,
    256,
    600,
    14,
  ),
  [[0], [12], [3], [15]],
);
assert.throws(
  () => partitionRasterStrokeBuildKeys([5], 1024, 1024, 256, 200, 14),
  /non partizionabile/,
);

// Stroke uses the REGION EXTENT, plus the historical extra step 1.
assert.deepEqual(jfaScheduleForExtent(1), [1, 1]);
assert.deepEqual(jfaScheduleForExtent(2), [1, 1]);
assert.deepEqual(jfaScheduleForExtent(3), [2, 1, 1]);
assert.deepEqual(jfaScheduleForExtent(288), [
  256,
  128,
  64,
  32,
  16,
  8,
  4,
  2,
  1,
  1,
]);
assert.deepEqual(jfaScheduleForExtent(288, { plusOne: false }), [
  256,
  128,
  64,
  32,
  16,
  8,
  4,
  2,
  1,
]);
assert.deepEqual(rasterStrokeJfaScheduleForRegion(interiorRegion), [
  256,
  128,
  64,
  32,
  16,
  8,
  4,
  2,
  1,
  1,
]);
assert.equal(RASTER_STROKE_JFA_TIE_ORDER, "yx");
assert.equal(
  rasterStrokeJfaSeedTieLess({ x: 2, y: 1 }, { x: 1, y: 2 }),
  true,
);
assert.equal(
  rasterStrokeJfaSeedTieLess({ x: 1, y: 2 }, { x: 2, y: 1 }),
  false,
);
assert.equal(
  rasterStrokeJfaSeedTieLess({ x: 1, y: 1 }, { x: 2, y: 1 }),
  true,
);
assert.equal(
  rasterStrokeJfaCandidateWins(
    { x: 0, y: 0 },
    { x: 2, y: 1 },
    { x: 1, y: 2 },
  ),
  true,
);

// DISTANCE_FRAGMENT: Q10.6, half-up, capped at 1023 px, packed low/high.
assert.equal(RASTER_STROKE_DISTANCE_SCALE, 64);
assert.equal(RASTER_STROKE_MAX_DISTANCE, 1023);
assert.equal(quantizeRasterStrokeDistance(0), 0);
assert.equal(quantizeRasterStrokeDistance(1 / 128), 1);
assert.equal(quantizeRasterStrokeDistance(1), 64);
assert.equal(quantizeRasterStrokeDistance(4.5), 288);
assert.equal(quantizeRasterStrokeDistance(1023), 65472);
assert.equal(quantizeRasterStrokeDistance(2000), 65472);
assert.deepEqual(packRasterStrokeDistanceQ10_6(4.5), [32, 1]);
assert.deepEqual(packRasterStrokeDistanceQ10_6(1023), [192, 255]);
assert.equal(
  unpackRasterStrokeFixedDistanceFromUnorm(32 / 255, 1 / 255),
  288,
);
assert.equal(unpackRasterStrokeDistanceQ10_6(32 / 255, 1 / 255), 4.5);

// NODE_FRAGMENT signed-distance correction around the alpha=0.5 isoline.
assert.equal(RASTER_STROKE_ALPHA_THRESHOLD, 0.5);
assert.equal(rasterStrokeSignedDistance(0.5, 1), 0);
assert.equal(rasterStrokeSignedDistance(1, 1), -0.5);
assert.equal(rasterStrokeSignedDistance(0, 1), 0.5);
approx(
  rasterStrokeSignedDistance(127 / 255, 1),
  1 / 510,
);
approx(
  rasterStrokeSignedDistance(128 / 255, 1),
  -1 / 510,
);

// rampAt/coverage equations, including the shader's R8 half-up quantization.
assert.equal(quantizeRasterStrokeCoverage(0.5), 128 / 255);
assert.equal(
  rasterStrokeCoverageFromSignedDistance(0, 2, "outside"),
  128 / 255,
);
assert.equal(
  rasterStrokeCoverageFromSignedDistance(0, 2, "inside"),
  128 / 255,
);
assert.equal(
  rasterStrokeCoverageFromSignedDistance(0, 2, "center"),
  1,
);
assert.equal(
  rasterStrokeCoverageFromFixedDistance(1, 64, 2, "inside"),
  1,
);
assert.equal(
  rasterStrokeCoverageFromFixedDistance(1, 64, 2, "outside"),
  0,
);
assert.equal(
  rasterStrokeCoverageFromFixedDistance(0, 64, 2, "outside"),
  1,
);
assert.equal(
  rasterStrokeCoverageFromFixedDistance(0.5, 64, 2, "outside"),
  128 / 255,
);
assert.equal(
  rasterStrokeCoverageFromFixedDistance(0.5, 0, 512, "center"),
  0,
);

// NODE_FRAGMENT/COVERAGE_NODE_FRAGMENT compositing vectors. `base` is
// premultiplied, while the stroke color is straight RGBA.
const shaderStyle = {
  enabled: true,
  width: 2,
  position: "outside",
  color: [1, 0.25, 0, 0.8],
};
const outsidePixel = compositeRasterStrokePixel(
  [0.2, 0.1, 0.05, 0.5],
  0.5,
  shaderStyle,
  0.5,
);
approx(outsidePixel[0], 0.3);
approx(outsidePixel[1], 0.1);
approx(outsidePixel[2], 0.025);
approx(outsidePixel[3], 0.45);

const insidePixel = compositeRasterStrokePixel(
  [0.2, 0.1, 0.05, 0.5],
  0.5,
  { ...shaderStyle, position: "inside" },
);
approx(insidePixel[0], 0.44);
approx(insidePixel[1], 0.12);
approx(insidePixel[2], 0.01);
approx(insidePixel[3], 0.5);

const transparentBase = compositeRasterStrokePixel(
  [0, 0, 0, 0],
  1,
  shaderStyle,
);
approx(transparentBase[0], 0.8);
approx(transparentBase[1], 0.2);
approx(transparentBase[2], 0);
approx(transparentBase[3], 0.8);

const rendererSource = readFileSync(
  new URL("../src/stroke-renderer.ts", import.meta.url),
  "utf8",
);
const engineSource = readFileSync(
  new URL("../src/brush-engine.ts", import.meta.url),
  "utf8",
);
const workbenchSource = readFileSync(
  new URL("../src/effects-workbench.ts", import.meta.url),
  "utf8",
);
const effectsBenchmarkSource = readFileSync(
  new URL("../src/effects-benchmark.ts", import.meta.url),
  "utf8",
);
const mainSource = readFileSync(
  new URL("../src/main.ts", import.meta.url),
  "utf8",
);
const htmlSource = readFileSync(
  new URL("../index.html", import.meta.url),
  "utf8",
);
const stylesSource = readFileSync(
  new URL("../src/styles.css", import.meta.url),
  "utf8",
);
const goldenSource = readFileSync(
  new URL("../src/stroke-golden.ts", import.meta.url),
  "utf8",
);
const goldenBaseline = JSON.parse(readFileSync(
  new URL("../goldens/raster-stroke-rgba8-v1.json", import.meta.url),
  "utf8",
));
const goldenMipBaseline = JSON.parse(readFileSync(
  new URL("../goldens/raster-stroke-rgba8-mips-v1.json", import.meta.url),
  "utf8",
));
assert.match(
  rendererSource,
  /style-stack-webgpu-v14-lazy-stroke-geometry-independent-outer-inner-shadows-three-surface-layer-composite-transient-bake-bbox-bevel-field-shared-effects-scratch-retargetable-layer-heightfield-v2-then-stroke-direct-lod0-coarse-mips-fwidth-display-native-unorm-round-even/,
);
assert.ok(
  rendererSource.indexOf("bevelNode(base, position)")
    < rendererSource.indexOf("combinedStrokeNode(base.a, node, coverage)"),
  "The style stack must compose bevel before stroke.",
);
assert.match(rendererSource, /style\.enabled && style\.width > 0 \? 1 : 0/);
assert.match(rendererSource, /let dt = 0\.5 \* fwidth\(t\)/);
assert.match(rendererSource, /persistent alpha-threshold bit mask/);
assert.match(rendererSource, /persistent packed R8 coverage/);
assert.match(rendererSource, /direct-lod0-plus-derived-mips-1-through-12/);
assert.match(rendererSource, /fn directStyledSample/);
assert.match(rendererSource, /native-unorm-round-even/);
assert.match(
  rendererSource,
  /round\(clamp\(value, vec4<f32>\(0\.0\), vec4<f32>\(1\.0\)\) \* 255\.0\) \/ 255\.0/,
);
assert.match(rendererSource, /fn storedM1Coverage/);
assert.match(rendererSource, /pack2x16float\(vec2<f32>\(coverage, 0\.0\)\)/);
assert.match(rendererSource, /Traccia styled derived mip 1\+/);
assert.match(engineSource, /rasterStrokeDisplayPipeline/);
assert.match(engineSource, /presentationCacheLod0FullRebuildTraceEnabledCpuEncodingMs/);
assert.match(engineSource, /presentationCacheLod0FullRebuildTraceDisabledCpuEncodingMs/);
assert.match(rendererSource, /threshold changes or existing coverage overlap/);
assert.doesNotMatch(rendererSource, /distanceBuffer/);
assert.match(rendererSource, /array<atomic<u32>>/);
assert.ok(
  rendererSource.match(/dispatchWorkgroupsIndirect/g)?.length >= 3,
  "The threshold gate must cover seed/JFA, resolve and conditional compose.",
);
assert.match(engineSource, /changeDetectionRect = mutationRect;/);
assert.match(
  engineSource,
  /composeRect = this\.mergeDirtyRects\(composeRect, mutationRect\);/,
);
assert.match(engineSource, /conditionalComposeRect = rebuildRect;/);
assert.match(rendererSource, /allocate-on-stroke-enable-release-when-idle-disabled/);
assert.match(rendererSource, /strokeGeometryEnabled\?: boolean/);
assert.match(rendererSource, /options\.strokeGeometryEnabled !== false/);
assert.match(rendererSource, /private async allocateStrokeGeometryResources\(\): Promise<boolean>/);
assert.match(rendererSource, /runGpuAllocationTransaction\(/);
assert.match(rendererSource, /private releaseStrokeGeometryResources\(\): boolean/);
assert.match(rendererSource, /async setStrokeGeometryEnabled\(enabled: boolean\): Promise<boolean>/);
assert.match(rendererSource, /return this\.strokeCoverageBuffer \?\? this\.coveragePlaceholderBuffer/);
assert.match(rendererSource, /return this\.strokeThresholdMaskBuffer \?\? this\.thresholdMaskPlaceholderBuffer/);
assert.match(
  rendererSource,
  /this\.strokeGeometryResourcesAllocated \? this\.fullCoverageMemoryBytes : 0/,
);
assert.match(
  rendererSource,
  /this\.strokeGeometryResourcesAllocated \? this\.fullThresholdMaskMemoryBytes : 0/,
);
assert.match(rendererSource, /this\.rebuildIndirectGateBindGroup\(\)/);
assert.match(rendererSource, /Encode Traccia rifiutato: le risorse geometriche non sono allocate/);
assert.match(engineSource, /strokeGeometryEnabled: strokeGeometryActive/);
assert.match(engineSource, /await this\.rasterStrokeRenderer\.setStrokeGeometryEnabled/);
assert.match(engineSource, /setStrokeGeometryEnabled\(false\)/);
assert.match(engineSource, /rasterStrokeGeometryResident/);
assert.match(rendererSource, /parameters\.scratchExtent/);
assert.match(rendererSource, /resizeScratch\(requestedExtent: number\)/);
assert.match(rendererSource, /readbackEnabled\?: boolean/);
assert.match(rendererSource, /async readStyledPixels\(/);
assert.match(rendererSource, /encodeBake\(options: RasterStrokeBakeOptions\)/);
assert.match(rendererSource, /Style stack layer bake analytic mip 0/);
assert.match(
  rendererSource,
  /const readbackComposeModule = this\.device\.createShaderModule\(/,
  "il compositore analitico mip 0 deve esistere anche fuori dal golden",
);
assert.doesNotMatch(
  rendererSource,
  /const readbackComposeModule = this\.readbackEnabled/,
  "readbackEnabled può controllare la texture golden, non la pipeline bake runtime",
);
assert.match(rendererSource, /retarget\(\s*layerView: GPUTextureView,/);
assert.ok(
  (rendererSource.match(/this\.rebuildSourceBindGroups\([012]\)/g) ?? []).length >= 3,
  "Retarget Traccia deve ricostruire i bind group di tutte le source mode.",
);
assert.match(workbenchSource, /single-retargetable-active-layer-source/);
assert.match(workbenchSource, /this\._bevelRenderer\?\.retarget\(source\.view\)/);
assert.match(workbenchSource, /this\._strokeRenderer\?\.retarget\(source\.view, source\.format\)/);
assert.match(engineSource, /async retargetEffectsWorkingSet\(/);
assert.match(engineSource, /this\.rebuildRasterStrokeDisplayBindGroups\(\)/);
assert.match(engineSource, /fullDocumentRect,\s*fullDocumentRect,\s*true/);
assert.match(effectsBenchmarkSource, /destroy-recreate/);
assert.match(effectsBenchmarkSource, /onSubmittedWorkDone\(\)/);
assert.match(effectsBenchmarkSource, /4096|documentWidth/);
assert.match(rendererSource, /async readChangeStateFlags\(/);
assert.match(rendererSource, /updateDisplayParameters\(/);
assert.match(rendererSource, /displayParameterBuffers: Record<SourceModeCode, GPUBuffer>/);
assert.match(rendererSource, /GPUTextureUsage\.COPY_SRC/);
assert.match(goldenSource, /opaque-interior-paint-no-new-edge/);
assert.match(goldenSource, /threshold-island-new-edge/);
assert.match(goldenSource, /gate-deep-interior-skips-rebuild/);
assert.match(goldenSource, /gate-subthreshold-alpha-near-outer-coverage/);
assert.match(goldenSource, /light-glaze-source-over-opacity-0\.43/);
assert.match(goldenSource, /light-glaze-m1-r8-max-coverage-opacity-0\.37/);
assert.match(goldenSource, /thickness-tail-source-over/);
assert.match(goldenSource, /analytic-layer-bake-matches-golden-mip0/);
assert.match(goldenSource, /renderer!\.encodeBake\(/);
assert.match(goldenSource, /encoded\.pixels === RASTER_STROKE_GOLDEN_WIDTH \* RASTER_STROKE_GOLDEN_HEIGHT/);
assert.match(goldenSource, /diagnosticsMatch/);
assert.match(goldenSource, /differingBytes/);
assert.match(goldenSource, /RASTER_STROKE_GOLDEN_DIAGNOSTICS_VERSION = 8/);
// Il pool sostituisce il buffer fisico quando cresce e distrugge il vecchio: se
// i renderer non rileggessero il lease, i loro bind group punterebbero a un
// buffer distrutto. Nessun altro caso raggiunge quello stato.
assert.match(goldenSource, /stroke-bevel-pool-growth-resync/);
assert.match(goldenSource, /declareEffect\("golden-growth-probe"/);
assert.match(goldenSource, /releaseRequirement\("golden-growth-probe"\)/);
assert.match(
  goldenSource,
  /const poolBufferWasReplaced = generationAfterGrowth > generationBeforeGrowth/,
);
assert.ok(
  /passed:\s*\n\s*resyncDifferingBytes === 0[\s\S]{0,320}&& poolBufferWasReplaced\s*\n\s*&& sourceContentDistinct,/
    .test(goldenSource),
  "Il caso di crescita del pool deve fallire se il buffer non è stato davvero sostituito.",
);
// Il retarget ricostruisce i bind group da solo: se avvenisse DOPO la crescita
// del pool riparerebbe le bindings stantie dello Smusso e maschererebbe il
// difetto. L'ordine è parte dell'invariante, non uno stile.
assert.ok(
  goldenSource.indexOf('label: "Traccia/Smusso pool growth resync view"')
    < goldenSource.indexOf('declareEffect("golden-growth-probe"'),
  "Il retarget deve precedere la crescita del pool, altrimenti il caso non prova nulla.",
);
assert.match(goldenSource, /stroke-bevel-same-view-retarget/);
// Il caso same-view passerebbe anche con un retarget inerte: il caso
// cross-texture e la sua guardia anti-tautologia sono ciò che lo dimostra.
assert.match(goldenSource, /stroke-bevel-cross-texture-retarget/);
assert.match(goldenSource, /createRetargetSourceFixture\(\)/);
assert.match(goldenSource, /const sourceContentDistinct = afterMip0Sha256 !== crossReferenceMip0Sha256/);
assert.ok(
  /passed:\s*\n\s*crossDifferingBytes === 0[\s\S]{0,240}&& sourceContentDistinct,/.test(goldenSource),
  "Il caso cross-texture deve fallire se le due sorgenti non sono distinguibili.",
);
assert.ok(
  (goldenSource.match(/await encodeRetargetStyleStack\(/g) ?? []).length >= 4,
  "Retarget e riferimento nativo devono usare lo stesso stack di encode.",
);
assert.match(goldenSource, /referenceStrokeRenderer = await RasterStrokeRenderer\.create/);
assert.match(goldenSource, /referenceWorkbench\?\.destroy\(\)/);
assert.match(goldenSource, /maxByteDelta/);
assert.match(goldenSource, /firstDifference/);
assert.match(goldenSource, /combinedSha256/);
assert.equal(
  goldenBaseline.combinedSha256,
  "8d5a75a6abb9f47cdf4a794d560b5795aa4b4c85520db2dd1466833157f6dcb0",
);
assert.equal(goldenBaseline.cases.length, 7);
assert.equal(goldenBaseline.cases[2].sha256, goldenBaseline.cases[4].sha256);
assert.equal(goldenMipBaseline.cases.length, 7);
assert.ok(goldenMipBaseline.cases.every((goldenCase) => goldenCase.mips.length === 9));
const goldenMipIdentity = Buffer.from(JSON.stringify({
  mipChainVersion: goldenMipBaseline.mipChainVersion,
  format: goldenMipBaseline.format,
  width: goldenMipBaseline.width,
  height: goldenMipBaseline.height,
  fixtureSha256: goldenMipBaseline.fixtureSha256,
  cases: goldenMipBaseline.cases.map(({ id, mips }) => ({
    id,
    mips: mips.map(({ level, width, height, sha256 }) => ({
      level,
      width,
      height,
      sha256,
    })),
  })),
}));
assert.equal(
  createHash("sha256").update(goldenMipIdentity).digest("hex"),
  "f7f534721e4ca863fb9cecf379d2efa05e6e5f9840f92aa667c032a1fcdd441f",
);
assert.match(goldenSource, /mipCombinedSha256/);
assert.match(engineSource, /async runRasterStrokeGolden\(\)/);
assert.match(mainSource, /rasterStrokeGoldenSection/);
assert.match(htmlSource, /id="runRasterStrokeGolden"/);
assert.match(engineSource, /rasterStrokeScratchExtentForWidth\(normalized\.width\)/);
assert.match(mainSource, /gpuMemoryEffectsScratchLabel/);
assert.match(htmlSource, /gpuMemoryEffectsScratchPeak/);
assert.match(engineSource, /effectsScratchPoolMiB/);
assert.match(engineSource, /private getGpuMemoryStats\(\): EngineGpuMemoryStats/);
assert.match(engineSource, /countedTotalMiB/);
assert.match(mainSource, /const gpuMemoryRows:/);
assert.match(mainSource, /gpuMemoryDelta\.textContent/);
assert.match(htmlSource, /id="gpuMemoryMonitor"/);
assert.match(stylesSource, /\.gpu-memory-panel/);

const traceControlBytes = 2_048 * 256 + 80 * 3 + 4 + 2_048 * 12 + 4;
let traceStyledPixels = 0;
for (let mipLevel = 1; mipLevel < 13; mipLevel += 1) {
  traceStyledPixels += Math.max(1, 4_096 >> mipLevel) ** 2;
}
const tracePersistentRgba8MiB = (
  traceStyledPixels * 4
  + Math.ceil(4_096 * 4_096 / 4) * 4
  + Math.ceil(4_096 / 32) * 4_096 * 4
  + traceControlBytes
) / (1024 * 1024);
const traceCompactRgba8MiB = tracePersistentRgba8MiB
  + RASTER_STROKE_COMPACT_SCRATCH_EXTENT ** 2 * 8 * 2 / (1024 * 1024);
const traceFullRgba8MiB = tracePersistentRgba8MiB
  + RASTER_STROKE_FULL_SCRATCH_EXTENT ** 2 * 8 * 2 / (1024 * 1024);
assert.equal(Number(traceCompactRgba8MiB.toFixed(1)), 55.9);
assert.equal(Number(traceFullRgba8MiB.toFixed(1)), 103.9);

console.log("Raster Stroke core verification passed.");
