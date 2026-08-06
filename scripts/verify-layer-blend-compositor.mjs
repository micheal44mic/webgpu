import assert from "node:assert/strict";
import {
  LAYER_BLEND_MODE_ORDER,
  blendLayerPremultipliedLinear,
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

assert.equal(
  LAYER_BLEND_COMPOSITOR_STRATEGY,
  "fullscreen-triangle-textureload-dynamic-mode-w3c-over-matte-preserving-clipping-atop-v2",
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
assert.match(LAYER_BLEND_COMPOSITOR_WGSL, /@builtin\(vertex_index\) vertexIndex: u32/);
assert.match(LAYER_BLEND_COMPOSITOR_WGSL, /vec2<f32>\(3\.0, -1\.0\)/);
assert.match(LAYER_BLEND_COMPOSITOR_WGSL, /vec2<f32>\(-1\.0, 3\.0\)/);
assert.match(LAYER_BLEND_COMPOSITOR_WGSL, /vec2<i32>\(floor\(fragmentPosition\.xy\)\)/);
assert.match(LAYER_BLEND_COMPOSITOR_WGSL, /textureLoad\(source, pixel, 0\)/);
assert.doesNotMatch(LAYER_BLEND_COMPOSITOR_WGSL, /textureSample/);
assert.match(LAYER_BLEND_COMPOSITOR_WGSL, /layerBlendCompositor\.blendMode/);
assert.match(LAYER_BLEND_COMPOSITOR_WGSL, /layerBlendCompositor\.compositeOperator/);
assert.match(LAYER_BLEND_COMPOSITOR_WGSL, /return LAYER_BLEND_NORMAL/);
assert.match(LAYER_BLEND_COMPOSITOR_WGSL, /return layerBlendPremultipliedLinearSourceOver\(backdrop, source, mode\)/);
assert.match(LAYER_BLEND_COMPOSITOR_WGSL, /return layerBlendPremultipliedLinearSourceAtop\(backdrop, source, mode\)/);

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

assert.equal(
  LAYER_BLEND_FOLD_STRATEGY,
  "cropped-document-1024-tile-ping-pong-source-map-w3c-over-matte-preserving-clipping-atop-v3",
);
assert.equal(LAYER_BLEND_FOLD_TILE_EXTENT, 1024);
assert.equal(LAYER_BLEND_FOLD_UNIFORM_BYTES, 48);
assert.match(LAYER_BLEND_FOLD_WGSL, /struct LayerBlendFoldUniforms\s*{[\s\S]*?blendMode: u32,[\s\S]*?compositeOperator: u32,/);
assert.match(LAYER_BLEND_FOLD_WGSL, /@binding\(0\) var backdropTexture: texture_2d<f32>/);
assert.match(LAYER_BLEND_FOLD_WGSL, /@binding\(1\) var sourceTexture: texture_2d<f32>/);
assert.match(LAYER_BLEND_FOLD_WGSL, /textureLoad\(backdropTexture, pixel, 0\)/);
assert.match(LAYER_BLEND_FOLD_WGSL, /return layerBlendPremultipliedLinearSourceOver\(backdrop, source, layer\.blendMode\)/);
assert.match(LAYER_BLEND_FOLD_WGSL, /return layerBlendFoldSourceAtop\(backdrop, source, layer\.blendMode\)/);
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

console.log("Layer blend compositor verification passed for source-over/source-atop and 27 modes.");
