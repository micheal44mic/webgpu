import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LAYER_BLEND_MODE_ORDER,
  LAYER_BLEND_MODE_WGSL,
  blendLayerPremultipliedLinear,
  layerBlendDissolveRandom,
} from "../src/layer-blend-modes.ts";
import {
  LAYER_BLEND_COMPOSITOR_MODE_BYTE_OFFSET,
  LAYER_BLEND_COMPOSITOR_OPERATOR_BYTE_OFFSET,
  LAYER_BLEND_COMPOSITOR_OPERATOR_CODES,
  LAYER_BLEND_COMPOSITOR_STRATEGY,
  LAYER_BLEND_COMPOSITOR_UNIFORM_BYTE_SIZE,
  LAYER_BLEND_COMPOSITOR_UNIFORM_BYTE_STRIDE,
  LAYER_BLEND_COMPOSITOR_UNIFORM_U32_STRIDE,
  LAYER_BLEND_COMPOSITOR_WGSL,
  blendLayerPremultipliedLinearSourceAtop,
  compositeLayerPremultipliedLinear,
  writeLayerBlendCompositorUniforms,
} from "../src/layer-blend-compositor.ts";
import {
  LAYER_BLEND_FOLD_STRATEGY,
  LAYER_BLEND_FOLD_TILE_EXTENT,
  LAYER_BLEND_FOLD_UNIFORM_BYTES,
  LAYER_BLEND_FOLD_WGSL,
} from "../src/layer-blend-fold-shader.ts";
import {
  DEFAULT_DOCUMENT_BACKGROUND,
  documentBackgroundLinearPremultiplied,
  normalizeDocumentBackground,
} from "../src/document-background.ts";
import {
  LAYER_COLD_TILE_COMPOSITE_BATCH_TILES,
  LAYER_COLD_TILE_COMPOSITE_UNIFORM_BYTES,
  LAYER_COLD_TILE_COMPOSITE_WGSL,
} from "../src/layer-cold-tile-composite-shader.ts";
const tileShaderSource = readFileSync(
  new URL("../src/layer-blend-tile-shader.ts", import.meta.url),
  "utf8",
);
const clippingShaderSource = readFileSync(
  new URL("../src/clipping-group-shader.ts", import.meta.url),
  "utf8",
);

assert.deepEqual(normalizeDocumentBackground(undefined), DEFAULT_DOCUMENT_BACKGROUND);
assert.deepEqual(
  documentBackgroundLinearPremultiplied({ visible: false, color: "#ff0000" }),
  [0, 0, 0, 0],
);
const middleGray = documentBackgroundLinearPremultiplied({
  visible: true,
  color: "#808080",
});
assert.ok(Math.abs(middleGray[0] - 0.21586) < 0.0001);
assert.equal(middleGray[0], middleGray[1]);
assert.equal(middleGray[1], middleGray[2]);
assert.equal(middleGray[3], 1);
const tileCompositorSource = readFileSync(
  new URL("../src/layer-blend-tile-compositor.ts", import.meta.url),
  "utf8",
);
const tileRuntimeSource = readFileSync(
  new URL("../src/engine-layer-blend-tile-runtime.ts", import.meta.url),
  "utf8",
);
const layerRuntimeSource = readFileSync(
  new URL("../src/engine-layer-runtime.ts", import.meta.url),
  "utf8",
);
const brushEngineSource = readFileSync(
  new URL("../src/brush-engine.ts", import.meta.url),
  "utf8",
);
const engineRuntimeMiscSource = readFileSync(
  new URL("../src/engine-runtime-misc.ts", import.meta.url),
  "utf8",
);
const engineVectorTextRuntimeSource = readFileSync(
  new URL("../src/engine-vector-text-runtime.ts", import.meta.url),
  "utf8",
);

assert.equal(LAYER_COLD_TILE_COMPOSITE_UNIFORM_BYTES, 32);
assert.equal(LAYER_COLD_TILE_COMPOSITE_BATCH_TILES, 16);
assert.match(LAYER_COLD_TILE_COMPOSITE_WGSL, /texture_2d_array<f32>/);
assert.match(LAYER_COLD_TILE_COMPOSITE_WGSL, /textureLoad\(/);
assert.match(LAYER_COLD_TILE_COMPOSITE_WGSL, /@builtin\(instance_index\)/);
assert.doesNotMatch(LAYER_COLD_TILE_COMPOSITE_WGSL, /textureSample/);
assert.match(layerRuntimeSource, /pass\.draw\(6, tileIndices\.length, 0, 0\)/);
assert.match(layerRuntimeSource, /await engine\.waitForGpuCapped\(label\)/);
assert.match(layerRuntimeSource, /destination\.resolutionScale !== 1/);
assert.match(layerRuntimeSource, /requirements\.needsStrokeRenderer/);
assert.match(
  layerRuntimeSource,
  /chunk\.rawBytes <= LAYER_COLD_TILE_COMPOSITE_BATCH_TILES \* tileBytes/,
  "un chunk futuro troppo grande deve ricadere sul fallback senza superare lo scratch dichiarato",
);

assert.equal(
  LAYER_BLEND_COMPOSITOR_STRATEGY,
  "viewport-textureload-w3c-over-clipping-atop-document-anchored-dissolve-v3",
);
assert.equal(LAYER_BLEND_COMPOSITOR_UNIFORM_BYTE_SIZE, 16);
assert.equal(LAYER_BLEND_COMPOSITOR_UNIFORM_BYTE_STRIDE, 16);
assert.equal(LAYER_BLEND_COMPOSITOR_UNIFORM_U32_STRIDE, 4);
assert.equal(LAYER_BLEND_COMPOSITOR_MODE_BYTE_OFFSET, 0);
assert.equal(LAYER_BLEND_COMPOSITOR_OPERATOR_BYTE_OFFSET, 4);
assert.deepEqual(LAYER_BLEND_COMPOSITOR_OPERATOR_CODES, {
  "source-over": 0,
  "source-atop": 1,
});
assert.match(
  engineRuntimeMiscSource,
  /binding: 3,[\s\S]*?visibility: GPUShaderStage\.FRAGMENT,[\s\S]*?buffer: \{ type: "uniform" \}/,
);
assert.match(
  engineVectorTextRuntimeSource,
  /\{ binding: 3, resource: \{ buffer: engine\.displayUniformBuffer \} \}/,
);
assert.match(
  engineRuntimeMiscSource,
  /LAYER_BLEND_MODE_CODES\[mode\][\s\S]*?blendUniformWordStride/,
  "uniform records must be stored by stable numeric code, not menu position",
);

const uniforms = new Uint32Array(10).fill(0xffffffff);
assert.equal(
  writeLayerBlendCompositorUniforms(uniforms, "color-burn", "source-atop", 3),
  uniforms,
);
assert.deepEqual([...uniforms.slice(3, 7)], [3, 1, 0, 0]);
assert.equal(uniforms[2], 0xffffffff);
assert.equal(uniforms[7], 0xffffffff);
assert.throws(
  () => writeLayerBlendCompositorUniforms(new Uint32Array(3)),
  /smaller than 16 bytes/,
);
assert.throws(
  () => writeLayerBlendCompositorUniforms(new Uint32Array(4), "normal", "source-over", -1),
  /non-negative integer/,
);

const close = (actual, expected, epsilon = 3e-12, label = "") => {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${label}: ${actual} != ${expected} (epsilon ${epsilon})`,
  );
};
const closeArray = (actual, expected, epsilon = 3e-12, label = "") => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => close(value, expected[index], epsilon, `${label}[${index}]`));
};

// Normal is exact premultiplied source-atop and preserves backdrop alpha.
closeArray(
  blendLayerPremultipliedLinearSourceAtop(
    [0.12, 0.28, 0.42, 0.7],
    [0.18, 0.06, 0.12, 0.3],
    "normal",
  ),
  [0.21, 0.238, 0.378, 0.7],
  2e-15,
  "normal source-atop",
);

const clamp = (value) => Math.min(1, Math.max(0, value));
const linearToSrgb = (value) => {
  const channel = clamp(value);
  return channel <= 0.0031308
    ? channel * 12.92
    : 1.055 * channel ** (1 / 2.4) - 0.055;
};
const srgbToLinear = (value) => {
  const channel = clamp(value);
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
};

// Regression: repeated low-opacity #333 deposits must not stall on an R8
// storage plateau. Model the render-target rounding after every source-over
// pass, as opposed to quantizing only the final display conversion.
const quantizeUnorm8 = (value) => Math.round(clamp(value) * 255) / 255;
const quantizeFloat16 = (value) => {
  const clamped = clamp(value);
  if (clamped === 0) return 0;
  const step = clamped < 2 ** -14
    ? 2 ** -24
    : 2 ** (Math.floor(Math.log2(clamped)) - 10);
  return clamp(Math.round(clamped / step) * step);
};
const darkLinear = srgbToLinear(0x33 / 0xff);
const passAlpha = 0.01;
let storedRgba8 = [0, 0, 0, 0];
let storedRgba16 = [0, 0, 0, 0];
const rgba8DarkLevels = new Set();
const rgba16DarkLevels = new Set();
for (let pass = 0; pass < 1024; pass += 1) {
  storedRgba8 = storedRgba8.map((destination, channel) => quantizeUnorm8(
    (channel === 3 ? passAlpha : darkLinear * passAlpha)
      + destination * (1 - passAlpha),
  ));
  storedRgba16 = storedRgba16.map((destination, channel) => quantizeFloat16(
    (channel === 3 ? passAlpha : darkLinear * passAlpha)
      + destination * (1 - passAlpha),
  ));
  rgba8DarkLevels.add(storedRgba8[0]);
  rgba16DarkLevels.add(storedRgba16[0]);
}
assert.equal(storedRgba8[0], 0, "R8 oracle must reproduce the dark-color plateau.");
assert.ok(
  rgba16DarkLevels.size > 300,
  `RGBA16F should preserve a continuous dark ramp, got ${rgba16DarkLevels.size} levels.`,
);
assert.ok(
  storedRgba16[0] > darkLinear * 0.95,
  "RGBA16F repeated #333 deposits must converge without an R8 color stall.",
);

// Independent encoded-sRGB Multiply oracle for the non-Normal atop equation.
const backdrop = [0.16, 0.32, 0.08, 0.8];
const source = [0.3, 0.12, 0.42, 0.6];
const expectedMultiplyAtop = [0, 1, 2].map((channel) => {
  const backdropStraight = backdrop[channel] / backdrop[3];
  const sourceStraight = source[channel] / source[3];
  const blendLinear = srgbToLinear(
    linearToSrgb(backdropStraight) * linearToSrgb(sourceStraight),
  );
  return blendLinear * backdrop[3] * source[3]
    + backdrop[channel] * (1 - source[3]);
});
closeArray(
  blendLayerPremultipliedLinearSourceAtop(backdrop, source, "multiply"),
  [...expectedMultiplyAtop, backdrop[3]],
  3e-12,
  "multiply source-atop",
);

const dissolveAtopSource = [0.08, 0.16, 0.24, 0.4];
let dissolveAcceptedPixel = null;
let dissolveRejectedPixel = null;
for (let x = 0; x < 64 && (!dissolveAcceptedPixel || !dissolveRejectedPixel); x += 1) {
  const pixel = [x, 23];
  if (layerBlendDissolveRandom(pixel) < dissolveAtopSource[3]) {
    dissolveAcceptedPixel ??= pixel;
  } else {
    dissolveRejectedPixel ??= pixel;
  }
}
assert.ok(dissolveAcceptedPixel && dissolveRejectedPixel);
closeArray(
  blendLayerPremultipliedLinearSourceAtop(
    backdrop,
    dissolveAtopSource,
    "dissolve",
    dissolveAcceptedPixel,
  ),
  [0.16, 0.32, 0.48, 0.8],
  3e-12,
  "accepted dissolve source-atop",
);
closeArray(
  blendLayerPremultipliedLinearSourceAtop(
    backdrop,
    dissolveAtopSource,
    "dissolve",
    dissolveRejectedPixel,
  ),
  backdrop,
  3e-12,
  "rejected dissolve source-atop",
);

// A clipping child recolors the parent's matte. General W3C blend+source-atop
// would leak a source-only white term into this half-alpha black edge.
closeArray(
  blendLayerPremultipliedLinearSourceAtop(
    [0, 0, 0, 0.5],
    [1, 1, 1, 1],
    "multiply",
  ),
  [0, 0, 0, 0.5],
  2e-15,
  "matte-preserving clipping edge",
);

const fixtures = [
  [[0.12, 0.36, 0.63, 0.7], [0.48, 0.09, 0.03, 0.6]],
  [[0, 0, 0, 0], [0.3, 0.2, 0.1, 0.5]],
  [[0.7, 0.4, 0.2, 1], [0.08, 0.32, 0.16, 0.4]],
  [[0.1, 0.2, 0.05, 0.25], [0, 0, 0, 0]],
];
for (const mode of LAYER_BLEND_MODE_ORDER) {
  for (const [fixtureBackdrop, fixtureSource] of fixtures) {
    const atop = blendLayerPremultipliedLinearSourceAtop(
      fixtureBackdrop,
      fixtureSource,
      mode,
    );
    close(atop[3], clamp(fixtureBackdrop[3]), 2e-15, `${mode} alpha invariant`);
    assert.ok(
      atop.slice(0, 3).every((channel) => channel >= 0 && channel <= atop[3] + 1e-12),
      `${mode} remains premultiplied`,
    );

    closeArray(
      compositeLayerPremultipliedLinear(fixtureBackdrop, fixtureSource, mode, "source-over"),
      blendLayerPremultipliedLinear(fixtureBackdrop, fixtureSource, mode),
      2e-15,
      `${mode} source-over routing`,
    );
    closeArray(
      compositeLayerPremultipliedLinear(fixtureBackdrop, fixtureSource, mode, "source-atop"),
      atop,
      2e-15,
      `${mode} source-atop routing`,
    );
  }

  // With an opaque backdrop, source-atop and source-over are identical.
  const opaqueBackdrop = [0.3, 0.5, 0.1, 1];
  const partialSource = [0.12, 0.24, 0.3, 0.6];
  closeArray(
    blendLayerPremultipliedLinearSourceAtop(opaqueBackdrop, partialSource, mode),
    blendLayerPremultipliedLinear(opaqueBackdrop, partialSource, mode),
    3e-12,
    `${mode} opaque equivalence`,
  );
  closeArray(
    blendLayerPremultipliedLinearSourceAtop([0, 0, 0, 0], partialSource, mode),
    [0, 0, 0, 0],
    2e-15,
    `${mode} transparent matte`,
  );
}

// Static shader contract: framebuffer-exact loads, no filtering, stable ABI,
// dynamic mode/operator routing, and the conversion-free Normal atop path.
assert.match(LAYER_BLEND_COMPOSITOR_WGSL, /struct LayerBlendCompositorUniforms\s*{\s*blendMode: u32,\s*compositeOperator: u32,\s*reserved0: u32,\s*reserved1: u32,/s);
assert.match(LAYER_BLEND_COMPOSITOR_WGSL, /@binding\(0\) var layerBlendBackdropTexture: texture_2d<f32>/);
assert.match(LAYER_BLEND_COMPOSITOR_WGSL, /@binding\(1\) var layerBlendSourceTexture: texture_2d<f32>/);
assert.match(LAYER_BLEND_COMPOSITOR_WGSL, /@binding\(2\) var<uniform> layerBlendCompositor/);
assert.match(LAYER_BLEND_COMPOSITOR_WGSL, /@binding\(3\) var<uniform> layerBlendViewport/);
assert.match(LAYER_BLEND_COMPOSITOR_WGSL, /fn layerBlendDocumentPixel\(fragmentPosition: vec2<f32>\)/);
assert.match(LAYER_BLEND_COMPOSITOR_WGSL, /layerBlendViewport\.viewCenter \+ documentOffset/);
assert.match(LAYER_BLEND_COMPOSITOR_WGSL, /@builtin\(vertex_index\) vertexIndex: u32/);
assert.match(LAYER_BLEND_COMPOSITOR_WGSL, /vec2<f32>\(3\.0, -1\.0\)/);
assert.match(LAYER_BLEND_COMPOSITOR_WGSL, /vec2<f32>\(-1\.0, 3\.0\)/);
assert.match(LAYER_BLEND_COMPOSITOR_WGSL, /vec2<i32>\(floor\(fragmentPosition\.xy\)\)/);
assert.match(LAYER_BLEND_COMPOSITOR_WGSL, /textureLoad\(source, pixel, 0\)/);
assert.doesNotMatch(LAYER_BLEND_COMPOSITOR_WGSL, /textureSample/);
assert.match(LAYER_BLEND_COMPOSITOR_WGSL, /layerBlendCompositor\.blendMode/);
assert.match(LAYER_BLEND_COMPOSITOR_WGSL, /layerBlendCompositor\.compositeOperator/);
assert.match(LAYER_BLEND_COMPOSITOR_WGSL, /return LAYER_BLEND_NORMAL/);
assert.match(
  LAYER_BLEND_COMPOSITOR_WGSL,
  /return layerBlendPremultipliedLinearSourceOver\([\s\S]*?backdrop,[\s\S]*?source,[\s\S]*?mode,[\s\S]*?documentPixel/,
);
assert.match(
  LAYER_BLEND_COMPOSITOR_WGSL,
  /return layerBlendPremultipliedLinearSourceAtop\([\s\S]*?backdrop,[\s\S]*?source,[\s\S]*?mode,[\s\S]*?documentPixel/,
);

const atopShader = LAYER_BLEND_COMPOSITOR_WGSL.slice(
  LAYER_BLEND_COMPOSITOR_WGSL.indexOf("fn layerBlendPremultipliedLinearSourceAtop"),
  LAYER_BLEND_COMPOSITOR_WGSL.indexOf("fn layerBlendCompositorValidatedMode"),
);
assert.ok(
  atopShader.indexOf("if (mode == LAYER_BLEND_NORMAL)")
    < atopShader.indexOf("layerBlendLinearToSrgb("),
  "Normal source-atop must bypass transfer conversion",
);
assert.match(atopShader, /sourcePremultiplied \* backdropAlpha/);
assert.match(atopShader, /blendedLinear \* \(sourceAlpha \* backdropAlpha\)/);
assert.match(atopShader, /backdropPremultiplied \* \(1\.0 - sourceAlpha\)/);
assert.match(atopShader, /backdropAlpha,\s*\);/s);
assert.match(atopShader, /mode == LAYER_BLEND_DISSOLVE/);
assert.match(atopShader, /layerBlendDissolveSource\([\s\S]*?documentPixel/);

assert.equal(
  LAYER_BLEND_FOLD_STRATEGY,
  "cropped-document-1024-tile-ping-pong-w3c-over-clipping-atop-dissolve-v4",
);
assert.equal(LAYER_BLEND_FOLD_TILE_EXTENT, 1024);
assert.equal(LAYER_BLEND_FOLD_UNIFORM_BYTES, 48);
assert.match(LAYER_BLEND_FOLD_WGSL, /struct LayerBlendFoldUniforms\s*{[\s\S]*?blendMode: u32,[\s\S]*?compositeOperator: u32,/);
assert.match(LAYER_BLEND_FOLD_WGSL, /@binding\(0\) var backdropTexture: texture_2d<f32>/);
assert.match(LAYER_BLEND_FOLD_WGSL, /@binding\(1\) var sourceTexture: texture_2d<f32>/);
assert.match(LAYER_BLEND_FOLD_WGSL, /textureLoad\(backdropTexture, pixel, 0\)/);
assert.match(LAYER_BLEND_FOLD_WGSL, /fn foldDocumentPosition\(fragmentPosition: vec2<f32>\)/);
assert.match(LAYER_BLEND_FOLD_WGSL, /vec2<i32>\(floor\(documentPosition\)\)/);
assert.match(
  LAYER_BLEND_FOLD_WGSL,
  /return layerBlendPremultipliedLinearSourceOver\([\s\S]*?layer\.blendMode,[\s\S]*?documentPixel/,
);
assert.match(
  LAYER_BLEND_FOLD_WGSL,
  /return layerBlendFoldSourceAtop\([\s\S]*?layer\.blendMode,[\s\S]*?documentPixel/,
);
const foldAtopShader = LAYER_BLEND_FOLD_WGSL.slice(
  LAYER_BLEND_FOLD_WGSL.indexOf("fn layerBlendFoldSourceAtop"),
  LAYER_BLEND_FOLD_WGSL.indexOf("@fragment"),
);
assert.ok(
  foldAtopShader.indexOf("if (mode == LAYER_BLEND_NORMAL)")
    < foldAtopShader.indexOf("layerBlendLinearToSrgb("),
  "Normal fold source-atop must bypass transfer conversion",
);
assert.match(foldAtopShader, /blendedLinear \* \(sourceAlpha \* backdropAlpha\)/);
assert.match(foldAtopShader, /backdropPremultiplied \* \(1\.0 - sourceAlpha\)/);
assert.match(foldAtopShader, /mode == LAYER_BLEND_DISSOLVE/);
assert.match(
  clippingShaderSource,
  /fn clippingBlendSourceAtop\([\s\S]*?documentPixel: vec2<i32>/,
);
assert.match(
  clippingShaderSource,
  /mode == LAYER_BLEND_DISSOLVE[\s\S]*?layerBlendDissolveSource\([\s\S]*?documentPixel/,
);
assert.match(
  clippingShaderSource,
  /clippingBlendSourceAtop\([\s\S]*?activeClippingChildBlendMode\(\),[\s\S]*?documentPixel/,
);

// Sparse advanced blends bypass transfer functions when either operand is
// exactly transparent. This is pixel-identical source-over/source-atop math,
// but avoids the expensive pow/switch path over empty brush coverage.
const sourceOverShader = LAYER_BLEND_MODE_WGSL.slice(
  LAYER_BLEND_MODE_WGSL.indexOf("fn layerBlendPremultipliedLinearSourceOver"),
);
assert.ok(
  sourceOverShader.indexOf("if (sourceAlpha <= 0.0)")
    < sourceOverShader.indexOf("layerBlendLinearToSrgb(backdropLinear)"),
  "transparent source-over fast path must precede transfer conversion",
);
assert.ok(
  sourceOverShader.indexOf("if (backdropAlpha <= 0.0)")
    < sourceOverShader.indexOf("layerBlendLinearToSrgb(backdropLinear)"),
  "transparent backdrop source-over fast path must precede transfer conversion",
);
assert.ok(
  foldAtopShader.indexOf("if (sourceAlpha <= 0.0)")
    < foldAtopShader.indexOf("layerBlendLinearToSrgb("),
  "transparent source-atop fast path must precede transfer conversion",
);
assert.ok(
  atopShader.indexOf("if (backdropAlpha <= 0.0)")
    < atopShader.indexOf("layerBlendLinearToSrgb("),
  "viewport source-atop transparent fast path must precede transfer conversion",
);

// A completed document tile owns the final cache value. Partial updates must
// replace those pixels and discard the corners of the rotated core's
// axis-aligned screen scissor. Clearing that whole scissor first is the exact
// regression that exposed checkerboard rectangles while painting.
assert.match(
  tileShaderSource,
  /LAYER_BLEND_TILE_STRATEGY\s*=\s*\n\s*"document-space-1024-tile-native-format-blend-before-filter-replace-cache-v2"/,
);
assert.match(
  tileShaderSource,
  /if \(!inside\) \{\s*discard;\s*\}/s,
);
const tilePresentPipelineCall = tileCompositorSource.match(
  /const tilePresentPipeline = pipeline\(([\s\S]*?)\n\s*\);/,
)?.[1] ?? "";
const pyramidPresentPipelineCall = tileCompositorSource.match(
  /const pyramidPresentPipeline = pipeline\(([\s\S]*?)\n\s*\);/,
)?.[1] ?? "";
assert.ok(tilePresentPipelineCall.length > 0, "tile present pipeline call not found");
assert.ok(pyramidPresentPipelineCall.length > 0, "pyramid present pipeline call not found");
assert.doesNotMatch(tilePresentPipelineCall, /sourceOverBlend/);
assert.doesNotMatch(pyramidPresentPipelineCall, /sourceOverBlend/);
assert.match(
  tileRuntimeSource,
  /if \(requiresFullRebuild\) \{[\s\S]*?loadOp: "clear"/,
);
assert.doesNotMatch(tileRuntimeSource, /clearLinearPass\.setScissorRect/);
assert.doesNotMatch(tileRuntimeSource, /mixedSceneClearPipeline/);

// Small live dirty rects clear only their bounded scratch footprint. Full
// 1024² rebuild tiles retain the attachment-clear fast path.
assert.match(
  tileCompositorSource,
  /loadOp: clearsWholeTile \? "clear" : "load"/,
);
assert.match(
  tileCompositorSource,
  /pass\.setScissorRect\(0, 0, boundedWidth, boundedHeight\)/,
);
assert.match(
  tileRuntimeSource,
  /seed document background tile`,\s*textureRect\.width,\s*textureRect\.height,/s,
);
assert.match(
  brushEngineSource,
  /invalidateDocumentBackgroundPresentation\(\)[\s\S]*?paintDisplayMipValidThroughLevel = 0;/,
  "changing the backdrop must invalidate the final raster mip pyramid",
);
assert.match(
  tileCompositorSource,
  /seedTileWithDocumentBackground\([\s\S]*?loadOp: clearsWholeTile \? "clear" : "load"[\s\S]*?setPipeline\(this\.tileBackgroundPipeline\)[\s\S]*?setScissorRect\(0, 0, boundedWidth, boundedHeight\)/,
  "the selected backdrop must retain the bounded partial-tile fast path",
);

console.log("Layer blend compositor verification passed for source-over/source-atop and 27 modes.");
