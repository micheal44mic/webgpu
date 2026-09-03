import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const vectorRasterRuntime = readFileSync(
  new URL("src/engine-vector-raster-runtime.ts", root),
  "utf8",
);
const vectorTextRuntime = readFileSync(
  new URL("src/engine-vector-text-runtime.ts", root),
  "utf8",
);

function functionBody(source, declaration, nextDeclaration) {
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `Missing declaration: ${declaration}`);
  const end = source.indexOf(nextDeclaration, start + declaration.length);
  assert.notEqual(end, -1, `Missing declaration following ${declaration}`);
  return source.slice(start, end);
}

const uniformWriter = functionBody(
  vectorTextRuntime,
  "export function writeVectorTextGpuDrawUniform",
  "type MixedSceneBlendScratchCandidate",
);
const textureRasterizer = functionBody(
  vectorRasterRuntime,
  "export async function renderVectorDrawsToTexture",
  "async function renderVectorDrawsToLayer",
);
const encodedFinalizer = functionBody(
  vectorRasterRuntime,
  "const ENCODED_VECTOR_RASTER_FINALIZE_WGSL",
  "function synchronizeRasterClippingProjection",
);

// The same uniform writer serves live document presentation and offscreen
// raster output. Its color domain therefore has to be a call-site decision;
// deriving it only from the document would encode a requested linear surface.
assert.match(
  uniformWriter,
  /outputColorDomain:\s*"document-storage"\s*\|\s*"linear-premultiplied"\s*=\s*"document-storage"/,
  "the vector draw uniform writer must accept an explicit output color domain",
);
assert.match(
  uniformWriter,
  /outputColorDomain\s*===\s*"document-storage"\s*&&\s*vectorTextRunUsesEncodedSrgb\(engine\)\s*\?\s*1\s*:\s*0/,
  "a linear output override must disable encoded-sRGB shader output",
);
assert.doesNotMatch(
  uniformWriter,
  /upload\[base\s*\+\s*7\]\s*=\s*vectorTextRunUsesEncodedSrgb\(engine\)\s*\?\s*1\s*:\s*0\s*;/,
  "the output flag must not depend on document state alone",
);
assert.match(
  textureRasterizer,
  /writeVectorTextGpuDrawUniform\([\s\S]*?width,\s*height,\s*storedEncodedSrgb\s*\?\s*"document-storage"\s*:\s*"linear-premultiplied",\s*\);/,
  "permanent encoded output must blend draws in the same domain as live presentation",
);
assert.match(
  textureRasterizer,
  /const renderFormat:\s*LayerFormat\s*=\s*storedEncodedSrgb\s*\?\s*"rgba16float"\s*:\s*format/,
  "encoded document output must retain high-precision draw values through MSAA resolve",
);
assert.match(
  textureRasterizer,
  /storedEncodedSrgb[\s\S]*?ensureEncodedVectorRasterFinalizePipeline\(engine\)/,
  "encoded document output must use the deterministic RGBA8 finalizer",
);
assert.match(
  encodedFinalizer,
  /quantizeRgba8SpatialAdjacent\(\s*textureLoad\(encodedTexture, local, 0\)/,
  "the finalizer must quantize the already encoded premultiplied draw result directly",
);
assert.doesNotMatch(
  encodedFinalizer,
  /linearToSrgb|linearPremultipliedToEncoded/,
  "the finalizer must not apply a second color transfer",
);

function srgbToLinearChannel(encoded) {
  const bounded = Math.min(1, Math.max(0, encoded));
  return bounded <= 0.04045
    ? bounded / 12.92
    : ((bounded + 0.055) / 1.055) ** 2.4;
}

function linearToSrgbChannel(linear) {
  const bounded = Math.min(1, Math.max(0, linear));
  return bounded <= 0.0031308
    ? bounded * 12.92
    : 1.055 * bounded ** (1 / 2.4) - 0.055;
}

function byte(value) {
  return Math.round(Math.min(1, Math.max(0, value)) * 255);
}

const sourceBytes = [1, 13, 24, 32, 68, 102, 128, 170, 221];
const oracle = sourceBytes.map((sourceByte) => {
  const authoredLinear = srgbToLinearChannel(sourceByte / 255);
  const encodedOnce = linearToSrgbChannel(authoredLinear);
  const encodedTwice = linearToSrgbChannel(encodedOnce);
  return {
    sourceByte,
    encodedOnceByte: byte(encodedOnce),
    encodedTwiceByte: byte(encodedTwice),
  };
});

for (const sample of oracle) {
  assert.equal(
    sample.encodedOnceByte,
    sample.sourceByte,
    `one transfer must round-trip sRGB byte ${sample.sourceByte}`,
  );
}

const nearBlack = oracle.find((sample) => sample.sourceByte === 24);
assert.deepEqual(
  nearBlack,
  { sourceByte: 24, encodedOnceByte: 24, encodedTwiceByte: 86 },
  "the near-black sentinel must expose a second transfer as a visible gray shift",
);
assert(
  oracle.every((sample) => sample.sourceByte === 1
    ? sample.encodedTwiceByte > sample.sourceByte
    : sample.encodedTwiceByte - sample.sourceByte >= 12),
  "the oracle samples must clearly distinguish one transfer from two",
);

function sourceOver(source, destination) {
  return source.map((value, index) => index === 3
    ? value + destination[index] * (1 - source[3])
    : value + destination[index] * (1 - source[3]));
}

function premultiply(rgb, alpha) {
  return [...rgb.map((channel) => channel * alpha), alpha];
}

function encodedFromLinearPremultiplied(value) {
  const alpha = value[3];
  if (alpha <= 0) return [0, 0, 0, 0];
  return [
    linearToSrgbChannel(value[0] / alpha) * alpha,
    linearToSrgbChannel(value[1] / alpha) * alpha,
    linearToSrgbChannel(value[2] / alpha) * alpha,
    alpha,
  ];
}

const bottomSrgb = [0.2, 0.4, 0.8];
const topSrgb = [0.9, 0.1, 0.2];
const bottomAlpha = 0.6;
const topAlpha = 0.4;
const liveEncodedOverlap = sourceOver(
  premultiply(topSrgb, topAlpha),
  premultiply(bottomSrgb, bottomAlpha),
);
const permanentEncodedOverlap = sourceOver(
  premultiply(topSrgb, topAlpha),
  premultiply(bottomSrgb, bottomAlpha),
);
const oldLinearOverlap = encodedFromLinearPremultiplied(sourceOver(
  premultiply(topSrgb.map(srgbToLinearChannel), topAlpha),
  premultiply(bottomSrgb.map(srgbToLinearChannel), bottomAlpha),
));
assert.deepEqual(
  permanentEncodedOverlap,
  liveEncodedOverlap,
  "overlapping translucent draws must use the live encoded-premultiplied source-over contract",
);
assert.ok(
  liveEncodedOverlap.slice(0, 3).some(
    (channel, index) => Math.abs(channel - oldLinearOverlap[index]) > 0.04,
  ),
  "the overlap oracle must detect the former linear intra-layer blend mismatch",
);

console.log(
  "Vector raster color-domain contract verified: live/raster overlap parity and no duplicate transfer.",
);
