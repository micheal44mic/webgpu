import assert from "node:assert/strict";
import { readEngineSource } from "../../engine-source.mjs";
import {
  buildVectorTextSlugData,
  vectorTextPathRevision,
} from "../../../src/vector-text-slug.ts";
import {
  VECTOR_TEXT_SINGLE_SHADOW_BLUR_MAXIMUM,
  VECTOR_TEXT_SINGLE_SHADOW_MAX_KERNEL_RADIUS,
  VECTOR_TEXT_SINGLE_SHADOW_MAX_PIXELS,
  planVectorTextSingleShadowBlur,
  vectorTextSingleShadowBlurSupport,
} from "../../../src/vector-text-single-shadow.ts";
import { polygonPath, reverseRing } from "./geometry-fixtures.mjs";
import { readRepositorySource } from "../source-contract.mjs";

const engineSource = readEngineSource();
const controllerSource = readRepositorySource("src/mixed-scene-controller.ts");
const curveSource = readRepositorySource("src/vector-text-curve-utils.ts");
const slugSource = readRepositorySource("src/vector-text-slug.ts");
const slugShaderSource = readRepositorySource("src/vector-text-slug-gpu-shader.ts");
const gpuShaderSource = readRepositorySource("src/vector-text-gpu-shader.ts");
const innerShadowShaderSource = readRepositorySource("src/vector-text-inner-shadow-gpu-shader.ts");
const singleShadowSource = readRepositorySource("src/vector-text-single-shadow.ts");
const outer = [[0, 0], [120, 0], [120, 100], [0, 100]];
const inner = [[30, 30], [90, 30], [90, 70], [30, 70]];

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
  appendDrawsSource.indexOf("planMixedSceneSlugInnerShadowDraw")
    > appendDrawsSource.lastIndexOf("draws.push(planMixedSceneSlugDraw("),
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
