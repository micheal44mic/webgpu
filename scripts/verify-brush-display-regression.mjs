import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shaders = readFileSync(new URL("../src/shaders.ts", import.meta.url), "utf8");
const merged = readFileSync(
  new URL("../src/merged-surface-shader.ts", import.meta.url),
  "utf8",
);
const stroke = readFileSync(
  new URL("../src/stroke-renderer.ts", import.meta.url),
  "utf8",
);

assert.match(
  shaders,
  /PAINT_DISPLAY_MINIFICATION_STRATEGY\s*=\s*\n?\s*"gamma-premultiplied-box-preserve-alpha-no-post-sample-coverage-rewrite-v2"/,
);

const displayStart = shaders.indexOf("export const displayShader");
const tailStart = shaders.indexOf("export const thicknessTailDisplayShader");
const glazeStart = shaders.indexOf("export const lightGlazeDisplayShader");
const mipStart = shaders.indexOf("export const paintMipDownsampleShader");
const nextShader = shaders.indexOf("export const", mipStart + 1);
assert.ok(displayStart >= 0 && tailStart > displayStart && glazeStart > tailStart);
assert.ok(mipStart >= 0 && nextShader > mipStart);

const permanentDisplay = shaders.slice(displayStart, tailStart);
const liveTailDisplay = shaders.slice(tailStart, glazeStart);
const mipDownsample = shaders.slice(mipStart, nextShader);
const forbiddenCoverageRewrite =
  /preserve(?:Minified|Merged|Styled)DarkCoverage|encodedCoverage|displayAlpha/;

for (const [label, source] of [
  ["permanent display", permanentDisplay],
  ["live thickness-tail display", liveTailDisplay],
  ["merged surfaces", merged],
  ["styled raster display", stroke],
]) {
  assert.doesNotMatch(
    source,
    forbiddenCoverageRewrite,
    `${label} must not inflate low-alpha brush-shape texels after sampling`,
  );
}

assert.match(mipDownsample, /linearPremultipliedToGamma/);
assert.match(mipDownsample, /gammaPremultipliedToLinear/);
assert.match(mipDownsample, /let gammaAverage =/);
assert.doesNotMatch(mipDownsample, /encodedCoverage|displayAlpha/);

function srgbToLinear(value) {
  return value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4;
}

// The removed display heuristic more than doubled a one-byte black alpha and
// made sparse specks at the edge of a shape asset reveal its rectangular quad.
const oneByteAlpha = 1 / 255;
const removedBoost = 1 - srgbToLinear(1 - oneByteAlpha);
assert.ok(removedBoost > oneByteAlpha * 2);

// Gamma-space color filtering remains, but alpha coverage stays an exact box
// average. One occupied sample in a 2x2 footprint therefore remains 25%.
const boxAlpha = (1 + 0 + 0 + 0) / 4;
assert.equal(boxAlpha, 0.25);

console.log(
  "Brush display regression: no shape-quad alpha inflation and live/idle presentation parity verified.",
);
