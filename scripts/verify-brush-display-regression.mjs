import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const readSource = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const shaders = readSource("../src/shaders.ts");
const merged = readSource("../src/merged-surface-shader.ts");
const stroke = readSource("../src/stroke-renderer.ts");
const rasterTransform = readSource("../src/raster-transform-shader.ts");
const rasterDeform = readSource("../src/raster-deform-shader.ts");
const engine = readSource("../src/brush-engine.ts");
const runtime = readSource("../src/engine-runtime-misc.ts");
const resources = readSource("../src/engine-resource-setup.ts");
const layerRuntime = readSource("../src/engine-layer-runtime.ts");
const reports = readSource("../src/engine-reports.ts");

assert.match(
  shaders,
  /PAINT_DISPLAY_MINIFICATION_STRATEGY\s*=\s*\n?\s*"gamma-premultiplied-box-preserve-alpha-no-post-sample-coverage-rewrite-v2"/,
);

const singleRasterStart = shaders.indexOf(
  "export const singleRasterRgba16FloatDisplayShader",
);
const displayStart = shaders.indexOf("export const displayShader");
const tailStart = shaders.indexOf("export const thicknessTailDisplayShader");
const glazeStart = shaders.indexOf("export const lightGlazeDisplayShader");
const mipStart = shaders.indexOf("export const paintMipDownsampleShader");
const nextShader = shaders.indexOf("export const", mipStart + 1);
const storedEncodedMipStart = shaders.indexOf(
  "export const storedEncodedPaintMipDownsampleShader",
);
const storedEncodedMipEnd = shaders.indexOf("export const", storedEncodedMipStart + 1);
assert.ok(singleRasterStart >= 0 && displayStart > singleRasterStart);
assert.ok(displayStart >= 0 && tailStart > displayStart && glazeStart > tailStart);
assert.ok(mipStart >= 0 && nextShader > mipStart);
assert.ok(storedEncodedMipStart >= 0 && storedEncodedMipEnd > storedEncodedMipStart);

const singleRasterDisplay = shaders.slice(singleRasterStart, displayStart);
const permanentDisplay = shaders.slice(displayStart, tailStart);
const liveTailDisplay = shaders.slice(tailStart, glazeStart);
const mipDownsample = shaders.slice(mipStart, nextShader);
const storedEncodedMipDownsample = shaders.slice(storedEncodedMipStart, storedEncodedMipEnd);
const stackMipStart = shaders.indexOf("export const paintStackCompositeMipShader");
const nextStackShader = shaders.indexOf("export const", stackMipStart + 1);
const stackMipEnd = nextStackShader >= 0 ? nextStackShader : shaders.length;
assert.ok(stackMipStart >= 0 && stackMipEnd > stackMipStart);
const stackMipDownsample = shaders.slice(stackMipStart, stackMipEnd);
const forbiddenCoverageRewrite =
  /preserve(?:Minified|Merged|Styled)?DarkCoverage|encodedCoverage|displayAlpha/;

assert.match(singleRasterDisplay, /documentSize:\s*vec2<f32>/);
assert.match(singleRasterDisplay, /compositingColorSpace:\s*f32/);
assert.match(
  singleRasterDisplay,
  /if \(display\.compositingColorSpace > 1\.5\) \{[\s\S]*?return paint\.rgb \+ backgroundSrgb \* \(1\.0 - alpha\);[\s\S]*?\}/,
  "the single-raster presenter must not encode stored-sRGB paint a second time",
);
assert.match(
  singleRasterDisplay,
  /if \(display\.compositingColorSpace > 0\.5\) \{[\s\S]*?singleRasterLinearToSrgb\(straightLinear\) \* alpha/,
  "the single-raster presenter must preserve encoded-premultiplied legacy composition",
);
assert.match(
  singleRasterDisplay,
  /let backgroundLinear = singleRasterSrgbToLinear\(backgroundSrgb\);[\s\S]*?paint\.rgb \+ backgroundLinear \* \(1\.0 - alpha\)/,
  "the single-raster presenter must preserve linear-light legacy composition",
);

for (const [label, source] of [
  ["permanent display", permanentDisplay],
  ["live thickness-tail display", liveTailDisplay],
  ["merged surfaces", merged],
  ["styled raster display", stroke],
  ["raster Transform", rasterTransform],
  ["raster Warp and Perspective", rasterDeform],
]) {
  assert.doesNotMatch(
    source,
    forbiddenCoverageRewrite,
    `${label} must not inflate low-alpha brush-shape texels after sampling`,
  );
}

for (const [label, source] of [
  ["raster Transform", rasterTransform],
  ["raster Warp and Perspective", rasterDeform],
]) {
  assert.match(source, /transparentBorderWeight/);
  assert.match(source, /let lowerLevel = u32\(floor\(continuousLod\)\)/);
  assert.match(source, /let upperLevel = min\(lowerLevel \+ 1u, maximumLevel\)/);
  assert.match(source, /let lodBlend = fract\(continuousLod\)/);
  assert.match(
    source,
    /return mix\(lower, upper, lodBlend\)/,
    `${label} must interpolate complete premultiplied RGBA across mip thresholds`,
  );
}

assert.match(mipDownsample, /linearPremultipliedToGamma/);
assert.match(mipDownsample, /gammaPremultipliedToLinear/);
assert.match(mipDownsample, /let gammaAverage =/);
assert.doesNotMatch(mipDownsample, /encodedCoverage|displayAlpha/);
assert.equal((storedEncodedMipDownsample.match(/textureLoad\(/g) ?? []).length, 4);
assert.match(
  storedEncodedMipDownsample,
  /let averaged = \(p00 \+ p10 \+ p01 \+ p11\) \* 0\.25;/,
);
assert.match(storedEncodedMipDownsample, /quantizeRgba8HighFrequencyAdjacent\(/);
assert.match(storedEncodedMipDownsample, /targetCoordinate/);
assert.doesNotMatch(
  storedEncodedMipDownsample,
  /srgbToLinear|linearToSrgb|linearPremultipliedToGamma|gammaPremultipliedToLinear/,
  "already-encoded premultiplied mips must not apply another color transfer",
);
assert.match(
  runtime,
  /displayCompositingColorSpace === "stored-encoded-srgb"[\s\S]*?storedEncodedPaintMipDownsampleShader[\s\S]*?: paintMipDownsampleShader/,
  "stored encoded layers must select the direct encoded-domain mip shader",
);
const desiredMipPlanStart = engine.indexOf("private desiredPaintDisplayMipPlan()");
const desiredMipPlanEnd = engine.indexOf("downsampleDirtyRect(", desiredMipPlanStart);
const desiredMipPlan = engine.slice(desiredMipPlanStart, desiredMipPlanEnd);
assert.match(desiredMipPlan, /return planPaintDisplayMips\(/);
assert.doesNotMatch(
  desiredMipPlan,
  /stored-encoded-srgb|legacyMipLevel:\s*0/,
  "stored encoded layers must use the normal zoom-dependent mip plan",
);
assert.match(stackMipDownsample, /compositingColorSpace:\s*f32/);
assert.match(
  stackMipDownsample,
  /if \(display\.compositingColorSpace > 1\.5\) \{[\s\S]*?quantizeRgba8HighFrequencyAdjacent\([\s\S]*?\(p00 \+ p10 \+ p01 \+ p11\) \* 0\.25/,
  "the first multi-layer mip must stay in the stored encoded domain",
);
assert.match(
  stackMipDownsample,
  /let gammaAverage =[\s\S]*?return gammaPremultipliedToLinear\(gammaAverage\);/,
  "legacy compositing modes must retain their established mip filter",
);
assert.match(
  stackMipDownsample,
  /return downsampleCompositedPaint\([\s\S]*?vec2<u32>\(fragmentPosition\.xy\)/,
);

// The cropped live patch stays mip-0-only. Its minification is resolved in
// the existing document-space active-layer pyramid, never on the ROI grid.
const tailSamplerStart = liveTailDisplay.indexOf("fn sampleTailLayer(");
const tailSamplerEnd = liveTailDisplay.indexOf("fn tailActiveTexel(", tailSamplerStart);
assert.ok(tailSamplerStart >= 0 && tailSamplerEnd > tailSamplerStart);
const tailSampler = liveTailDisplay.slice(tailSamplerStart, tailSamplerEnd);
assert.match(
  tailSampler,
  /textureSampleLevel\(tailTexture,\s*layerSampler,\s*uv,\s*0\.0\)/,
);
assert.doesNotMatch(tailSampler, /lowerMip|upperMip|maximumMipLevel/);
assert.match(liveTailDisplay, /documentMipMode:\s*u32/);

const activeMipStart = liveTailDisplay.indexOf("fn activeMipFragmentMain(");
const clippingMipStart = liveTailDisplay.indexOf(
  "fn activeClippingGroupMipFragmentMain(",
);
const finalStackMipStart = liveTailDisplay.indexOf("fn finalStackMipFragmentMain(");
assert.ok(activeMipStart >= 0 && clippingMipStart > activeMipStart);
assert.ok(finalStackMipStart > clippingMipStart);
const activeMip = liveTailDisplay.slice(activeMipStart, clippingMipStart);
const clippingMip = liveTailDisplay.slice(clippingMipStart, finalStackMipStart);
assert.match(activeMip, /vec2<i32>\(fragmentPosition\.xy\) \* 2/);
assert.equal((activeMip.match(/tailActiveTexel\(/g) ?? []).length, 4);
assert.match(activeMip, /linearPremultipliedToGamma/);
assert.match(activeMip, /gammaPremultipliedToLinear/);
assert.equal((clippingMip.match(/tailActiveTexel\(/g) ?? []).length, 4);
assert.match(
  clippingMip,
  /composeActiveClippingGroupTexel\(tailActiveTexel\(sourceOrigin\), sourceOrigin\)/,
  "clipping must be composed per document texel before its 2x2 box filter",
);

for (const functionName of ["fragmentMain", "activeFragmentMain"]) {
  const start = liveTailDisplay.indexOf(`fn ${functionName}(`);
  const end = liveTailDisplay.indexOf("\n}", start) + 2;
  const fragment = liveTailDisplay.slice(start, end);
  assert.match(fragment, /sampleTailDisplayActive\(layerPosition, layerUv\)/);
  assert.match(fragment, /sampleTailDisplayClippingGroup\(layerPosition, layerUv\)/);
}
assert.match(
  liveTailDisplay,
  /tail\.documentMipMode == 0u[\s\S]*?samplePermanentLogicalMip\(layerUv, 1\.0\)/,
  "fractional LOD 0-to-1 must blend the exact live mip 0 with document mip 1",
);

const ensureStart = resources.indexOf("export function ensureThicknessTailOverlayResources");
const ensureEnd = resources.indexOf("export async function ensureRasterStrokeRenderer", ensureStart);
const ensureTail = resources.slice(ensureStart, ensureEnd);
assert.ok(ensureStart >= 0 && ensureEnd > ensureStart);
assert.doesNotMatch(ensureTail, /mipLevelCount|MipViews|MipDownsample/);
assert.match(ensureTail, /binding: 3, resource: view/);
assert.doesNotMatch(engine, /thicknessTailSamplingView|thicknessTailMipViews/);
assert.match(
  reports,
  /thicknessTailTextureWidth \* engine\.thicknessTailTextureHeight\s*\n\s*\* bytesPerPixel/,
  "the live memory HUD must count one cropped mip-0 texture, not a second pyramid",
);

assert.match(layerRuntime, /entryPoint: "activeMipFragmentMain"/);
assert.match(layerRuntime, /entryPoint: "activeClippingGroupMipFragmentMain"/);
assert.match(layerRuntime, /entryPoint: "finalStackMipFragmentMain"/);
assert.match(liveTailDisplay, /tailFinalStackDocumentTexel/);
assert.match(liveTailDisplay, /tail\.documentMipMode == 2u/);
const mipLayoutStart = resources.indexOf("engine.thicknessTailMipBindGroupLayout =");
const mipLayoutEnd = resources.indexOf("const grainLayoutEntries", mipLayoutStart);
const mipLayout = resources.slice(mipLayoutStart, mipLayoutEnd);
assert.ok(mipLayoutStart >= 0 && mipLayoutEnd > mipLayoutStart);
assert.match(mipLayout, /binding: 6/);
assert.match(mipLayout, /binding: 7/);
const mipGroupStart = ensureTail.indexOf("const mipBindGroup");
const mipGroupEnd = ensureTail.indexOf("const oldTexture", mipGroupStart);
const mipGroup = ensureTail.slice(mipGroupStart, mipGroupEnd);
assert.ok(mipGroupStart >= 0 && mipGroupEnd > mipGroupStart);
assert.match(mipGroup, /binding: 6, resource: engine\.mergedBelowView\(\)/);
assert.match(mipGroup, /binding: 7, resource: engine\.mergedAboveView\(\)/);
assert.doesNotMatch(
  mipGroup,
  /binding: 5/,
  "the live mip seed must not bind the pyramid currently used as its render target",
);
assert.match(engine, /const incrementalPreview = this\.straightLineAdjustment === null/);
assert.match(
  engine,
  /const pyramidBaseDirtyRect = mergeDirtyRects\(\s*baseDirtyRect,\s*pyramidTransientDirtyRect/,
);
assert.match(
  engine,
  /paintTailUsesDocumentPyramid \? thicknessTailFrame : null/,
  "only live Paint—not Erase—may seed the shared document pyramid",
);
assert.match(
  engine,
  /\(!thicknessTailFrame \|\| paintTailUsesDocumentPyramid\)/,
  "a live Paint preview must retain final-stack pyramid content instead of forcing a full rebuild",
);
const encodePyramidStart = engine.indexOf("private encodePaintDisplayPyramid(");
const encodePyramidEnd = engine.indexOf("private writeDisplayUniforms(", encodePyramidStart);
assert.ok(encodePyramidStart >= 0 && encodePyramidEnd > encodePyramidStart);
const encodePyramid = engine.slice(encodePyramidStart, encodePyramidEnd);
assert.match(
  encodePyramid,
  /requestedContent === "final-raster-stack"[\s\S]*?finalRasterStackMipAvailable\(true\)/,
  "idle and live Paint must reserve the same final-stack content mode",
);
assert.doesNotMatch(
  encodePyramid,
  /finalRasterStackMipAvailable\(thicknessTailFrame\?\.settings\.tool === "paint"\)/,
);
assert.match(engine, /paintTailDocumentMipMode:[\s\S]*?\? 2[\s\S]*?: 1/);
assert.match(
  engine,
  /this\.thicknessTailDocumentMipPresented[\s\S]*?paintDisplayMipValidThroughLevel = 0/,
);

// The production loop propagates these document-space rectangles one level at
// a time. The result is intentionally independent of a cropped tail origin.
function downsampleDirtyRect(rect) {
  const x = Math.floor(rect.x / 2);
  const y = Math.floor(rect.y / 2);
  const right = Math.ceil((rect.x + rect.width) / 2);
  const bottom = Math.ceil((rect.y + rect.height) / 2);
  return { x, y, width: right - x, height: bottom - y };
}
const documentDirty = { x: 31, y: 63, width: 17, height: 9 };
const mip1Dirty = downsampleDirtyRect(documentDirty);
const mip2Dirty = downsampleDirtyRect(mip1Dirty);
assert.deepEqual(mip1Dirty, { x: 15, y: 31, width: 9, height: 5 });
assert.deepEqual(mip2Dirty, { x: 7, y: 15, width: 5, height: 3 });
assert.equal(mip1Dirty.width * mip1Dirty.height + mip2Dirty.width * mip2Dirty.height, 60);

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
assert.equal((1 + 0 + 0 + 0) / 4, 0.25);

console.log(
  "Brush display regression: Shape alpha, document-aligned live Paint mips, clipping, and ROI memory verified.",
);
