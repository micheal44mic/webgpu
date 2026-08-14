import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  NOISE_MIP_SMOOTHING_STRATEGY,
  noiseMipSmoothingAfterHistory,
  planPaintDisplayMips,
} from "../src/noise-mip-smoothing-core.ts";

assert.equal(
  NOISE_MIP_SMOOTHING_STRATEGY,
  "active-noise-layer-existing-pyramid-continuous-lod-explicit-adjacent-blend",
);

const legacy51 = planPaintDisplayMips(0.51, 13, false);
const legacy49 = planPaintDisplayMips(0.49, 13, false);
assert.deepEqual(legacy51, {
  legacyMipLevel: 0,
  requiredMipLevel: 0,
  sampleLod: 0,
  smoothingActive: false,
});
assert.deepEqual(legacy49, {
  legacyMipLevel: 1,
  requiredMipLevel: 1,
  sampleLod: 1,
  smoothingActive: false,
});

const smooth51 = planPaintDisplayMips(0.51, 13, true);
const smooth49 = planPaintDisplayMips(0.49, 13, true);
assert.equal(smooth51.legacyMipLevel, 0);
assert.equal(smooth51.requiredMipLevel, 1);
assert(Math.abs(smooth51.sampleLod - Math.log2(1 / 0.51)) < 1e-12);
assert.equal(smooth49.legacyMipLevel, 1);
assert.equal(smooth49.requiredMipLevel, 2);
assert(Math.abs(smooth49.sampleLod - Math.log2(1 / 0.49)) < 1e-12);

for (const [zoom, level] of [[1, 0], [0.5, 1], [0.25, 2], [0.125, 3]]) {
  const exact = planPaintDisplayMips(zoom, 13, true);
  assert.equal(exact.sampleLod, level);
  assert.equal(exact.legacyMipLevel, level);
  assert.equal(exact.requiredMipLevel, level);
}
assert.deepEqual(planPaintDisplayMips(Number.NaN, 3, true), {
  legacyMipLevel: 0,
  requiredMipLevel: 0,
  sampleLod: 0,
  smoothingActive: true,
});
assert.equal(planPaintDisplayMips(Number.POSITIVE_INFINITY, 13, false).sampleLod, 0);
assert.equal(planPaintDisplayMips(Number.NEGATIVE_INFINITY, 13, false).sampleLod, 0);
assert.equal(planPaintDisplayMips(2, 13, true).sampleLod, 0);

const history = [
  { id: 1, kind: "stroke", layerId: 7 },
  { id: 2, kind: "raster-filter", layerId: 7, filter: "noise", baseBounds: {} },
  { id: 3, kind: "stroke", layerId: 7 },
  { id: 4, kind: "raster-filter", layerId: 7, filter: "gaussian-blur", baseBounds: {} },
  { id: 5, kind: "clear", layerId: 7 },
  { id: 6, kind: "raster-filter", layerId: 8, filter: "noise", baseBounds: {} },
];
assert.equal(noiseMipSmoothingAfterHistory(history, 1, 7), false);
assert.equal(noiseMipSmoothingAfterHistory(history, 2, 7), true);
assert.equal(noiseMipSmoothingAfterHistory(history, 4, 7), true);
assert.equal(noiseMipSmoothingAfterHistory(history, 5, 7), false);
assert.equal(noiseMipSmoothingAfterHistory(history, 6, 8), true);
assert.equal(noiseMipSmoothingAfterHistory(history, 6, 7), false);

const root = new URL("../", import.meta.url);
const layerStack = readFileSync(new URL("src/layer-stack.ts", root), "utf8");
const engine = readFileSync(new URL("src/brush-engine.ts", root), "utf8");
const noiseRuntime = readFileSync(new URL("src/engine-noise-runtime.ts", root), "utf8");
const historyRuntime = readFileSync(new URL("src/engine-history-runtime.ts", root), "utf8");
const policy = readFileSync(new URL("src/noise-mip-smoothing-core.ts", root), "utf8");
const shaders = readFileSync(new URL("src/shaders.ts", root), "utf8");

assert.match(layerStack, /noiseMipSmoothing: boolean/);
assert.match(layerStack, /noiseMipSmoothing: false/);
assert.match(noiseRuntime, /record\.noiseMipSmoothing = true/);
assert.match(historyRuntime, /noiseMipSmoothingAfterHistory\(/);
assert.match(engine, /this\.layerStack\.active\.noiseMipSmoothing = false/);
assert.match(engine, /displayRequiredMipLevel = displayMipPlan\.requiredMipLevel/);
assert.match(engine, /displaySampleLod = displayMipPlan\.sampleLod/);
assert.match(engine, /writeDisplayUniforms\(displaySampleLod\)/);
assert.match(engine, /encodePaintDisplayPyramid\([\s\S]{0,180}displayRequiredMipLevel/);
assert.match(engine, /!this\.usesLayerBlendTilePresentation\(\)/);
assert.match(engine, /!this\.styleStackActive\(\)/);
assert.match(engine, /this\.activeRasterNoiseSession !== null/);
assert.doesNotMatch(policy, /createTexture|GPUTexture|rgba16float|rgba32float/);
assert.match(shaders, /fn sampleActiveLayerLogicalMip\(/);
assert.match(shaders, /fn sampleCompositedActiveLogicalMip\(/);
assert.match(shaders, /let lowerMip = floor\(lod\)/);
assert.match(shaders, /let upperMip = ceil\(lod\)/);
assert.match(shaders, /paint = perceptualInterpolate\(mipZero, mipOne, lod\)/);
assert.doesNotMatch(
  shaders,
  /display\.selectedMipLevel\s*(?:<|>=)\s*0\.5/,
  "fractional Noise LOD must never fall back to the legacy half-level switch",
);

console.log("Noise mip smoothing verification passed.");
