import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PERCEPTUAL_RASTER_RESAMPLING_STRATEGY,
  linearPremultipliedSourceOver,
  linearCompositeOverSrgbBackground,
  perceptualInterpolateFour,
  perceptualLinearToSrgbChannel,
  perceptualInterpolate,
  perceptualRasterResamplingShader,
  perceptualRasterSamplingShader,
  perceptualReduceFour,
  perceptualResolveWeightedSamples,
  rasterPresentationCompositeOverSrgbBackground,
  perceptualSrgbToLinearChannel,
} from "../src/perceptual-raster-resampling.ts";

assert.equal(
  PERCEPTUAL_RASTER_RESAMPLING_STRATEGY,
  "bounded-sdr-encoded-srgb-filter-linear-alpha-source-over-extended-residual-v2",
);

const close = (actual, expected, tolerance = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} non è entro ${tolerance} da ${expected}`,
  );
const closeRgba = (actual, expected, tolerance = 1e-9) => {
  assert.equal(actual.length, 4);
  for (let channel = 0; channel < 4; channel += 1) {
    close(actual[channel], expected[channel], tolerance);
  }
};

for (const value of [0, 0.0031308, 0.18, 0.5, 1]) {
  close(
    perceptualSrgbToLinearChannel(perceptualLinearToSrgbChannel(value)),
    value,
    2e-7,
  );
}

const black = [0, 0, 0, 1];
const white = [1, 1, 1, 1];
const opaqueReduction = perceptualReduceFour(black, white, white, white);
const expectedLinear = perceptualSrgbToLinearChannel(0.75);
close(opaqueReduction[0], expectedLinear);
close(perceptualLinearToSrgbChannel(opaqueReduction[0]), 0.75);
assert.ok(opaqueReduction[0] < 0.75, "la riduzione non deve ricadere nella media lineare");
close(opaqueReduction[3], 1);

const transparent = [0, 0, 0, 0];
const alphaReduction = perceptualReduceFour(black, transparent, transparent, transparent);
assert.deepEqual(alphaReduction, [0, 0, 0, 0.25]);
const legacyOverWhite = linearCompositeOverSrgbBackground(alphaReduction, [1, 1, 1]);
assert.deepEqual(
  rasterPresentationCompositeOverSrgbBackground(alphaReduction, [1, 1, 1]),
  legacyOverWhite,
);

const compositedEdge = linearPremultipliedSourceOver([0, 0, 0, 0.25], white);
closeRgba(compositedEdge, [0.75, 0.75, 0.75, 1]);
closeRgba(perceptualInterpolate(black, white, 0.75), opaqueReduction);
closeRgba(
  perceptualInterpolateFour(black, white, white, white, [0.5, 0.5]),
  opaqueReduction,
);

const translucentTeal = [0.04, 0.2, 0.28, 0.4];
closeRgba(
  perceptualReduceFour(
    translucentTeal,
    translucentTeal,
    translucentTeal,
    translucentTeal,
  ),
  translucentTeal,
);
const translucentOverWhite = rasterPresentationCompositeOverSrgbBackground(
  translucentTeal,
  [1, 1, 1],
);
closeRgba(
  [...translucentOverWhite, 1],
  [...linearCompositeOverSrgbBackground(translucentTeal, [1, 1, 1]), 1],
);

// A fill and an outline can be spatially complementary while living on two
// layers. Reducing them independently first makes both half-transparent and
// lets the checker/background leak through. Composing every document texel
// before the 2x2 reduction preserves complete coverage.
const cyan = [0, 1, 1, 1];
const fillSamples = [cyan, cyan, transparent, transparent];
const outlineSamples = [transparent, transparent, black, black];
const composedBeforeReduction = perceptualReduceFour(
  ...fillSamples.map((fill, index) => (
    linearPremultipliedSourceOver(outlineSamples[index], fill)
  )),
);
const reducedSeparately = linearPremultipliedSourceOver(
  perceptualReduceFour(...outlineSamples),
  perceptualReduceFour(...fillSamples),
);
close(composedBeforeReduction[3], 1);
close(reducedSeparately[3], 0.75);
assert.ok(
  composedBeforeReduction[3] >= reducedSeparately[3] + 0.249999,
  "il composito finale deve precedere il filtro sui bordi complementari",
);

const hdr = [2.5, 1.5, 1.25, 1];
const signed = [-0.75, 0.25, -0.125, 1];
closeRgba(perceptualReduceFour(hdr, hdr, hdr, hdr), hdr);
closeRgba(perceptualReduceFour(signed, signed, signed, signed), signed);
closeRgba(
  perceptualReduceFour([0.25, -0.5, 0.75, 0], transparent, transparent, transparent),
  [0.0625, -0.125, 0.1875, 0],
);

assert.throws(
  () => perceptualResolveWeightedSamples([], []),
  /non vuoti e allineati/,
);
assert.throws(
  () => perceptualResolveWeightedSamples([black], [0]),
  /positiva e finita/,
);

assert.match(perceptualRasterResamplingShader, /fn perceptualReduceFour\s*\(/);
assert.match(perceptualRasterResamplingShader, /extendedResidual/);
assert.match(perceptualRasterResamplingShader, /fn rasterPresentationCompositeOverSrgbBackground\s*\(/);
assert.match(perceptualRasterResamplingShader, /fn linearPremultipliedSourceOver\s*\(/);
assert.doesNotMatch(perceptualRasterResamplingShader, /fn perceptualSourceOver\s*\(/);
assert.doesNotMatch(perceptualRasterResamplingShader, /fn perceptualCompositeOverSrgbBackground\s*\(/);
assert.match(perceptualRasterResamplingShader, /fn perceptualInterpolateFour\s*\(/);
assert.doesNotMatch(perceptualRasterResamplingShader, /texture(?:Load|Sample)/);
assert.match(perceptualRasterSamplingShader, /fn perceptualSampleBilinear\s*\(/);
assert.match(perceptualRasterSamplingShader, /fn perceptualSampleTrilinear\s*\(/);
assert.match(perceptualRasterSamplingShader, /textureLoad\(/);

const consumerFiles = [
  "src/shaders.ts",
  "src/layer-blend-tile-shader.ts",
  "src/raster-transform-shader.ts",
  "src/raster-image-layer-import-shader.ts",
  "src/vector-raster-resolve-shader.ts",
  "src/stroke-renderer.ts",
  "src/mixed-scene-compositor-shader.ts",
  "src/vector-text-shader.ts",
  "src/merged-surface-shader.ts",
];
const consumers = Object.fromEntries(consumerFiles.map((file) => [
  file,
  readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
]));
for (const source of Object.values(consumers)) {
  assert.doesNotMatch(
    source,
    /fn perceptual(?:SrgbToLinear|LinearToSrgb|PrepareSample|ResolveSample|ReduceFour)/,
    "i consumer devono interpolare il contratto condiviso, non duplicarlo",
  );
}

const shaderSource = consumers["src/shaders.ts"];
const tileSource = consumers["src/layer-blend-tile-shader.ts"];
const importSource = consumers["src/raster-image-layer-import-shader.ts"];
const vectorResolveSource = consumers["src/vector-raster-resolve-shader.ts"];
const strokeSource = consumers["src/stroke-renderer.ts"];
const mixedSceneSource = consumers["src/mixed-scene-compositor-shader.ts"];
const vectorTextSource = consumers["src/vector-text-shader.ts"];
assert.match(shaderSource, /paintMipDownsampleShader[\s\S]*perceptualReduceFour\(p00, p10, p01, p11\)/);
assert.match(
  shaderSource,
  /paintStackCompositeMipShader[\s\S]*let p00 = compositedDocumentTexel\(sourceOrigin\)[\s\S]*perceptualReduceFour\(p00, p10, p01, p11\)/,
);
assert.match(shaderSource, /lightGlazeCompositeMipShader[\s\S]*perceptualReduceFour\(/);
assert.match(tileSource, /LAYER_BLEND_TILE_MIP_ONE_WGSL[\s\S]*perceptualReduceFour\(/);
assert.match(importSource, /rasterImageLayerUploadShader[\s\S]*perceptualPrepareSample\(textureLoad\(/);
assert.match(importSource, /rasterImageLayerBlitShader[\s\S]*perceptualSampleTrilinear\(/);
assert.match(vectorResolveSource, /vectorRasterPerceptualResolveShader[\s\S]*perceptualReduceFour\(/);
assert.match(strokeSource, /coarseComposeShader[\s\S]*perceptualReduceFour\(p00, p10, p01, p11\)/);
for (const source of [shaderSource, strokeSource, mixedSceneSource, vectorTextSource]) {
  assert.match(
    source,
    /rasterPresentationCompositeOverSrgbBackground\(\s*paint,\s*backgroundSrgb\s*\)/,
  );
  assert.doesNotMatch(source, /perceptualSourceOver\(/);
  assert.doesNotMatch(
    source,
    /backgroundLinear\s*=\s*srgbToLinear\(backgroundSrgb\)[\s\S]{0,160}paint\.rgb\s*\+\s*backgroundLinear/,
  );
}

const labsSource = readFileSync(
  new URL("../src/labs/editor-labs.ts", import.meta.url),
  "utf8",
);
const importTransformLabSource = readFileSync(
  new URL("../src/labs/gpu/raster-import-transform-gpu-test.ts", import.meta.url),
  "utf8",
);
assert.match(labsSource, /\["raster-import-transform", "GPU test Import \+ Trasforma"\]/);
assert.match(labsSource, /\["vector-raster-history", "GPU test Rasterizza vettori"\]/);
assert.match(importTransformLabSource, /integerShiftDifferingBytes !== 0/);
assert.match(importTransformLabSource, /cancelRestoredExactly/);
assert.match(importTransformLabSource, /transformScratchAfterBytes !== 0/);

const brushEngineSource = readFileSync(
  new URL("../src/brush-engine.ts", import.meta.url),
  "utf8",
);
assert.match(
  brushEngineSource,
  /requestFinalRasterStackMip\s*=\s*displayRequiredMipLevel\s*>\s*0/,
  "lo zoom-out raster semplice deve costruire la piramide dal composito finale",
);
assert.match(
  brushEngineSource,
  /requestFinalRasterStackMip\s*\?\s*"final-raster-stack"\s*:\s*"active-only"/,
  "la richiesta del composito finale deve selezionare il contenuto della piramide",
);

console.log("Perceptual raster resampling core verified.");
