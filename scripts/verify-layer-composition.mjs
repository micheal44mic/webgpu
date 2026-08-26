import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_LAYER_TONAL_BLEND,
  applyLayerOptionsState,
  captureLayerOptionsState,
  cloneLayerTonalBlend,
  layerCompositionIsDefault,
  layerOptionsStatesEqual,
  layerTonalBlendIsDefault,
  layerTonalBlendMask,
  normalizeLayerContentOpacity,
  normalizeLayerCutoutMode,
  normalizeLayerTonalBlend,
  normalizeLayerTonalRange,
} from "../src/layer-composition.ts";
import {
  accumulateDocumentCutoutCoverage,
  applyClippingChildResidualCutout,
  applyDocumentCutoutToBackdrop,
  compositeLayerPremultipliedLinear,
  layerResidualCutoutCoverage,
} from "../src/layer-blend-compositor.ts";
import { blendLayerPremultipliedLinear } from "../src/layer-blend-modes.ts";

assert.equal(normalizeLayerContentOpacity(-2), 0);
assert.equal(normalizeLayerContentOpacity(0.375), 0.375);
assert.equal(normalizeLayerContentOpacity(4), 1);
assert.equal(normalizeLayerContentOpacity(Number.NaN), 1);
assert.equal(normalizeLayerCutoutMode("group"), "group");
assert.equal(normalizeLayerCutoutMode("document"), "document");
assert.equal(normalizeLayerCutoutMode("invalid"), "off");

assert.deepEqual(normalizeLayerTonalRange([-8, 97.4, 42, 999]), [0, 97, 97, 255]);
assert.deepEqual(normalizeLayerTonalRange(null), [0, 0, 255, 255]);
assert.deepEqual(normalizeLayerTonalBlend({
  current: [12, 32, 196, 230],
  underlying: [1, 2, 253, 254],
}), {
  current: [12, 32, 196, 230],
  underlying: [1, 2, 253, 254],
});
assert.equal(layerTonalBlendIsDefault(DEFAULT_LAYER_TONAL_BLEND), true);
assert.equal(layerCompositionIsDefault({
  contentOpacity: 1,
  cutoutMode: "off",
  tonalBlend: DEFAULT_LAYER_TONAL_BLEND,
}), true);

const cloned = cloneLayerTonalBlend(DEFAULT_LAYER_TONAL_BLEND);
assert.notEqual(cloned.current, DEFAULT_LAYER_TONAL_BLEND.current);
assert.notEqual(cloned.underlying, DEFAULT_LAYER_TONAL_BLEND.underlying);

const black = [0, 0, 0, 1];
const white = [1, 1, 1, 1];
assert.equal(layerTonalBlendMask(black, white, DEFAULT_LAYER_TONAL_BLEND), 1);
assert.equal(layerTonalBlendMask(white, black, DEFAULT_LAYER_TONAL_BLEND), 1);
assert.equal(layerTonalBlendMask(black, white, {
  current: [1, 64, 255, 255],
  underlying: [0, 0, 255, 255],
}), 0);
assert.equal(layerTonalBlendMask(white, black, {
  current: [0, 0, 255, 255],
  underlying: [0, 0, 128, 254],
}), 1);
assert.equal(layerTonalBlendMask(white, white, {
  current: [0, 0, 255, 255],
  underlying: [0, 0, 128, 254],
}), 0);

const backdrop = [0.1, 0.2, 0.3, 0.8];
const source = [0.3, 0.1, 0.05, 0.5];
assert.deepEqual(
  compositeLayerPremultipliedLinear(backdrop, source),
  blendLayerPremultipliedLinear(backdrop, source),
  "identity controls must preserve the established compositor oracle",
);
assert.deepEqual(
  compositeLayerPremultipliedLinear(
    backdrop,
    [0, 0, 0, 0],
    "normal",
    "source-over",
    [0, 0],
    {
      cutoutMode: "document",
      tonalBlend: DEFAULT_LAYER_TONAL_BLEND,
      cutoutAlpha: 1,
    },
  ),
  [0, 0, 0, 0],
  "a raw matte must still cut the backdrop when visible content is fully transparent",
);
const protectedDeepFloor = [0.05, 0.1, 0.15, 0.4];
assert.deepEqual(
  compositeLayerPremultipliedLinear(
    backdrop,
    [0, 0, 0, 0],
    "normal",
    "source-over",
    [0, 0],
    {
      cutoutMode: "document",
      tonalBlend: DEFAULT_LAYER_TONAL_BLEND,
      cutoutAlpha: 1,
      deepFloor: protectedDeepFloor,
    },
  ),
  protectedDeepFloor,
  "Deep Fill 0 must reveal the immutable lowest visible contribution",
);
assert.deepEqual(
  compositeLayerPremultipliedLinear(
    backdrop,
    [0, 0, 0, 0],
    "normal",
    "source-over",
    [0, 0],
    {
      cutoutMode: "group",
      tonalBlend: DEFAULT_LAYER_TONAL_BLEND,
      cutoutAlpha: 1,
      deepFloor: protectedDeepFloor,
    },
  ),
  [0, 0, 0, 0],
  "Shallow must not consume the document Deep floor",
);

const opaqueBackdrop = [0.2, 0.3, 0.4, 1];
const antialiasedFullFill = [0.5, 0, 0, 0.5];
assert.deepEqual(
  compositeLayerPremultipliedLinear(
    opaqueBackdrop,
    antialiasedFullFill,
    "normal",
    "source-over",
    [0, 0],
    {
      cutoutMode: "document",
      tonalBlend: DEFAULT_LAYER_TONAL_BLEND,
      cutoutAlpha: 0.5,
    },
  ),
  blendLayerPremultipliedLinear(opaqueBackdrop, antialiasedFullFill),
  "100% Fill must not punch the antialiased edge twice",
);
assert.deepEqual(
  compositeLayerPremultipliedLinear(
    opaqueBackdrop,
    [0, 0, 0, 0],
    "normal",
    "source-over",
    [0, 0],
    {
      cutoutMode: "document",
      tonalBlend: DEFAULT_LAYER_TONAL_BLEND,
      cutoutAlpha: 0.5,
    },
  ),
  [0.1, 0.15, 0.2, 0.5],
  "0% Fill must expose the entire authored knockout coverage",
);
const partialFillKnockout = compositeLayerPremultipliedLinear(
  opaqueBackdrop,
  [0.25, 0, 0, 0.25],
  "normal",
  "source-over",
  [0, 0],
  {
    cutoutMode: "document",
    tonalBlend: DEFAULT_LAYER_TONAL_BLEND,
    cutoutAlpha: 0.5,
  },
);
assert.ok(
  partialFillKnockout.every(
    (channel, index) => Math.abs(channel - [0.35, 0.15, 0.2, 0.75][index]) < 1e-12,
  ),
  "partial Fill must remove only raw coverage left uncovered by visible source",
);

assert.equal(
  layerResidualCutoutCoverage(0.5, 0.5),
  0,
  "fully visible antialiasing must not be subtracted twice",
);
assert.equal(
  layerResidualCutoutCoverage(0.5, 0.25),
  0.25,
  "only authored matte left uncovered by Fill becomes residual cutout",
);

const immutableClippingBase = [0.25, 0, 0, 0.25];
const currentClippingGroup = [0, 0.25, 0, 0.25];
assert.deepEqual(
  applyClippingChildResidualCutout(
    currentClippingGroup,
    immutableClippingBase,
    0.5,
    "group",
  ),
  [0.125, 0.125, 0, 0.25],
  "group-scoped cutout must restore the immutable clipping base",
);
assert.deepEqual(
  applyClippingChildResidualCutout(
    currentClippingGroup,
    immutableClippingBase,
    0.5,
    "document",
  ),
  [0, 0.125, 0, 0.125],
  "document-scoped cutout must leave a local hole instead of restoring the base",
);

const twoDocumentCutouts = accumulateDocumentCutoutCoverage(
  accumulateDocumentCutoutCoverage(0, 0.5),
  0.5,
);
assert.equal(
  twoDocumentCutouts,
  0.75,
  "successive document cutouts must use normalized source-over union",
);
const externalBackdrop = [0, 0, 0.25, 0.25];
assert.deepEqual(
  applyDocumentCutoutToBackdrop(externalBackdrop, 0.25, twoDocumentCutouts, 1),
  [0, 0, 0.203125, 0.203125],
  "a 0.75 mask through a 0.25 base must remove exactly 0.1875 of the outer backdrop",
);
assert.deepEqual(
  applyDocumentCutoutToBackdrop(externalBackdrop, 0.25, twoDocumentCutouts, 0),
  externalBackdrop,
  "zero group opacity must propagate no document cutout",
);
assert.deepEqual(
  applyDocumentCutoutToBackdrop(externalBackdrop, 0.25, twoDocumentCutouts, 0.5),
  [0, 0, 0.2265625, 0.2265625],
  "group opacity must scale the propagated document cutout once",
);
assert.deepEqual(
  applyDocumentCutoutToBackdrop(
    externalBackdrop,
    0.25,
    twoDocumentCutouts,
    1,
    [0.1, 0, 0, 0.1],
  ),
  [0.018750000000000003, 0, 0.203125, 0.221875],
  "a propagated Deep mask must restore the protected floor instead of transparency",
);

const deepHoleAlpha = 0.25 * (1 - 0.5);
const laterChildAlpha = 0.5;
const refillAgainstImmutableBase = laterChildAlpha * 0.25
  + deepHoleAlpha * (1 - laterChildAlpha);
const refillAgainstMutatedBackdrop = laterChildAlpha * deepHoleAlpha
  + deepHoleAlpha * (1 - laterChildAlpha);
assert.equal(refillAgainstImmutableBase, 0.1875);
assert.equal(refillAgainstMutatedBackdrop, 0.125);
assert.ok(
  refillAgainstImmutableBase > refillAgainstMutatedBackdrop,
  "later clipping children must be bounded by the immutable base, not by a prior document hole",
);

const layerOptionsBefore = captureLayerOptionsState({
  opacity: 0.82,
  blendMode: "multiply",
  contentOpacity: 0.65,
  cutoutMode: "group",
  tonalBlend: {
    current: [12, 28, 216, 244],
    underlying: [4, 40, 208, 252],
  },
});
const layerOptionsAfter = captureLayerOptionsState({
  opacity: 0.37,
  blendMode: "screen",
  contentOpacity: 0.44,
  cutoutMode: "document",
  tonalBlend: {
    current: [20, 52, 180, 230],
    underlying: [8, 64, 196, 240],
  },
});
assert.equal(layerOptionsStatesEqual(layerOptionsBefore, layerOptionsAfter), false);
const replayTarget = { ...layerOptionsAfter };
applyLayerOptionsState(replayTarget, layerOptionsBefore);
assert.equal(layerOptionsStatesEqual(replayTarget, layerOptionsBefore), true);
applyLayerOptionsState(replayTarget, layerOptionsAfter);
assert.equal(layerOptionsStatesEqual(replayTarget, layerOptionsAfter), true);
assert.notEqual(
  layerOptionsBefore.tonalBlend.current,
  layerOptionsAfter.tonalBlend.current,
  "the single history snapshot must own detached tonal arrays",
);

const historyTypesSource = readFileSync(
  new URL("../src/engine-history-types.ts", import.meta.url),
  "utf8",
);
const historyRuntimeSource = readFileSync(
  new URL("../src/engine-history-runtime.ts", import.meta.url),
  "utf8",
);
const engineSource = readFileSync(
  new URL("../src/brush-engine.ts", import.meta.url),
  "utf8",
);
const mixedPresentationSource = readFileSync(
  new URL("../src/engine-vector-text-runtime.ts", import.meta.url),
  "utf8",
);
const runtimeSetupSource = readFileSync(
  new URL("../src/engine-runtime-misc.ts", import.meta.url),
  "utf8",
);
const mixedControllerSource = readFileSync(
  new URL("../src/mixed-scene-controller.ts", import.meta.url),
  "utf8",
);
assert.match(
  historyTypesSource,
  /readonly "layer-options": LayerOptionsState;/,
  "one compact history value must own every raster Layer Options field",
);
assert.match(
  historyRuntimeSource,
  /property === "layer-options"[\s\S]*?captureLayerOptionsState\(record\)/,
  "the panel transaction must capture a detached before-state for all fields",
);
assert.match(
  engineSource,
  /activeRasterLayerMetadataHistoryEdit\?\.property === "layer-options"[\s\S]*?\? "layer-options"/,
  "an open Layer Options edit must explicitly block Undo and Redo",
);
assert.match(
  engineSource,
  /if \(!layerOptionsEdit\) \{[\s\S]*?kind: "layer-blend-mode"/,
  "live blend-mode previews must be absorbed instead of publishing per-input history",
);
assert.match(
  mixedPresentationSource,
  /encodeSimpleHeterogeneousClippingProgram[\s\S]*?"source-atop"/,
  "the common raster/vector clipping path must stay on one fixed-function GPU pass",
);
assert.match(
  mixedPresentationSource,
  /encodeAdvancedHeterogeneousClippingProgram/,
  "advanced raster composition inside a raster/vector group must retain its exact path",
);
assert.match(
  mixedPresentationSource,
  /const needsScratch = engine\.mixedSceneStack\?\.hasHeterogeneousClipping === true/,
  "the extra full-size clipping surface must exist only while a heterogeneous group needs it",
);
assert.match(
  runtimeSetupSource,
  /const mixedSceneSourceAtopBlend[\s\S]*?color: \{[\s\S]*?srcFactor: "dst-alpha"[\s\S]*?dstFactor: "one-minus-src-alpha"[\s\S]*?alpha: \{[\s\S]*?srcFactor: "zero"[\s\S]*?dstFactor: "one"/,
  "the fixed-function source-atop operator must preserve clipping-base alpha without cumulative rounding",
);
assert.doesNotMatch(
  mixedPresentationSource,
  /getImageData|putImageData|CanvasRenderingContext2D/,
  "heterogeneous clipping must not introduce a CPU pixel-composition path",
);
assert.match(
  mixedControllerSource,
  /return kind === "text" \|\| kind === "svg";/,
  "editable text and SVG clipping members must both receive isolated vector run keys",
);
assert.match(
  mixedPresentationSource,
  /scene\.clippingParentKey\(structuralKey\) !== null[\s\S]*?scene\.clippingGroupRequiresSegmentedComposition\(structuralKey\)[\s\S]*?vectorTextRunTextures\.get\(segment\.key\)\?\.initialized === true/,
  "Deep floor selection must ignore segmented clipping children and uninitialized vector bases",
);

console.log("Layer composition verification passed.");
