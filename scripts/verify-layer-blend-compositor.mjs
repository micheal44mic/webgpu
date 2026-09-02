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
  blendLayerPremultipliedEncodedSrgbSourceAtop,
  blendLayerPremultipliedLinearSourceAtop,
  compositeLayerPremultipliedEncodedSrgb,
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
  documentBackgroundEncodedSrgbPremultiplied,
  documentBackgroundLinearPremultiplied,
  normalizeDocumentBackground,
} from "../src/document-background.ts";
import {
  LAYER_COLD_TILE_COMPOSITE_BATCH_TILES,
  LAYER_COLD_TILE_COMPOSITE_UNIFORM_BYTES,
  LAYER_COLD_TILE_COMPOSITE_WGSL,
} from "../src/layer-cold-tile-composite-shader.ts";
import {
  DERIVED_RGBA8_SURFACE_QUANTIZATION_SEED,
  RGBA8_SURFACE_FINALIZE_WGSL,
} from "../src/rgba8-surface-finalizer.ts";
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
assert.deepEqual(
  documentBackgroundEncodedSrgbPremultiplied({ visible: true, color: "#808080" }),
  [128 / 255, 128 / 255, 128 / 255, 1],
);
assert.deepEqual(
  documentBackgroundEncodedSrgbPremultiplied({ visible: false, color: "#808080" }),
  [0, 0, 0, 0],
);
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
const engineResourceSetupSource = readFileSync(
  new URL("../src/engine-resource-setup.ts", import.meta.url),
  "utf8",
);
const engineVectorTextRuntimeSource = readFileSync(
  new URL("../src/engine-vector-text-runtime.ts", import.meta.url),
  "utf8",
);

assert.match(
  engineVectorTextRuntimeSource,
  /const needsDeepFloor = engine\.layerStack\.layers\.some\([\s\S]*?cutoutMode === "document"/,
  "the viewport-sized Deep floor must be requested only when a Deep cutout exists",
);
assert.match(
  engineVectorTextRuntimeSource,
  /if \(needsDeepFloor\) \{[\s\S]*?deepFloorTexture = engine\.device\.createTexture/,
  "Shallow-only documents must not allocate a viewport-sized Deep floor texture",
);
assert.match(
  engineVectorTextRuntimeSource,
  /\{ binding: 7, resource: deepFloorView \?\? engine\.transparentLayerView \}/,
  "the fold pass must use the shared transparent texture when no Deep floor is needed",
);

assert.equal(LAYER_COLD_TILE_COMPOSITE_UNIFORM_BYTES, 32);
assert.equal(LAYER_COLD_TILE_COMPOSITE_BATCH_TILES, 16);
assert.match(LAYER_COLD_TILE_COMPOSITE_WGSL, /texture_2d_array<f32>/);
assert.match(LAYER_COLD_TILE_COMPOSITE_WGSL, /textureLoad\(/);
assert.match(LAYER_COLD_TILE_COMPOSITE_WGSL, /@builtin\(instance_index\)/);
assert.doesNotMatch(LAYER_COLD_TILE_COMPOSITE_WGSL, /textureSample/);
assert.match(LAYER_COLD_TILE_COMPOSITE_WGSL, /tileDimensions: vec2<u32>/);
assert.match(LAYER_COLD_TILE_COMPOSITE_WGSL, /let tileSize = vec2<i32>\(fold\.tileDimensions\)/);
assert.doesNotMatch(LAYER_COLD_TILE_COMPOSITE_WGSL, /const TILE_SIZE/);
assert.match(
  layerRuntimeSource,
  /pass\.draw\(6, range\.instanceCount, 0, range\.firstInstance\)/,
  "the direct cold path must draw only tile-array ranges intersecting the bounded target",
);
assert.match(
  layerRuntimeSource,
  /u32\[6\] = Math\.ceil\(engine\.documentWidth \/ DOCUMENT_TILE_GRID_SIZE\);[\s\S]*?u32\[7\] = Math\.ceil\(engine\.documentHeight \/ DOCUMENT_TILE_GRID_SIZE\);/,
  "la pipeline cold residente deve ricevere l'estensione tile del documento corrente",
);
assert.match(layerRuntimeSource, /await engine\.waitForGpuCapped\(label\)/);
assert.match(layerRuntimeSource, /destination\.resolutionScale !== 1/);
assert.match(layerRuntimeSource, /requirements\.needsStrokeRenderer/);
assert.match(
  layerRuntimeSource,
  /chunk\.rawBytes <= LAYER_COLD_TILE_COMPOSITE_BATCH_TILES \* tileBytes/,
  "un chunk futuro troppo grande deve ricadere sul fallback senza superare lo scratch dichiarato",
);
assert.equal(DERIVED_RGBA8_SURFACE_QUANTIZATION_SEED, 0x51f15e0d);
assert.match(RGBA8_SURFACE_FINALIZE_WGSL, /finalize\.outputOrigin \+ outputPixel/);
assert.match(RGBA8_SURFACE_FINALIZE_WGSL, /quantizeRgba8SpatialAdjacent\(/);
assert.match(
  layerRuntimeSource,
  /for \(let y = output\.bounds\.y; y < bottom; y \+= LAYER_BLEND_FOLD_TILE_EXTENT\)/,
  "encoded RGBA8 aggregate working memory must be bounded by the fold tile extent",
);
assert.match(
  layerRuntimeSource,
  /allocateMergedSurface\([\s\S]*?engine,[\s\S]*?"rgba16float",[\s\S]*?tileBounds,[\s\S]*?false,/,
  "multi-operand encoded RGBA8 aggregates must fold through a mip0-only RGBA16F tile",
);
assert.match(
  layerRuntimeSource,
  /await finalizeRgba8SurfaceTile\([\s\S]*?working,[\s\S]*?output,/,
  "each high-precision working tile must cross one explicit RGBA8 finalization boundary",
);
assert.match(
  layerRuntimeSource,
  /units\.length !== 1 \|\| units\[0\]\.length !== 1[\s\S]*?record\.opacity !== 1 \|\| layerNeedsBackdropComposition\(record\)/,
  "only a mathematically boundary-free singleton may retain the direct RGBA8 fold",
);

assert.equal(
  LAYER_BLEND_COMPOSITOR_STRATEGY,
  "viewport-textureload-dual-storage-rgba16f-transient-tonal-gate-residual-cutout-source-opacity-w3c-over-clipping-atop-document-anchored-dissolve-v8",
);
assert.equal(LAYER_BLEND_COMPOSITOR_UNIFORM_BYTE_SIZE, 64);
assert.equal(LAYER_BLEND_COMPOSITOR_UNIFORM_BYTE_STRIDE, 64);
assert.equal(LAYER_BLEND_COMPOSITOR_UNIFORM_U32_STRIDE, 16);
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

const uniforms = new Uint32Array(20).fill(0xffffffff);
assert.equal(
  writeLayerBlendCompositorUniforms(uniforms, "color-burn", "source-atop", 3),
  uniforms,
);
assert.deepEqual([...uniforms.slice(3, 7)], [3, 1, 0, 0x3f800000]);
assert.deepEqual(
  [...new Float32Array(uniforms.buffer).slice(7, 15)],
  [0, 0, 1, 1, 0, 0, 1, 1],
);
assert.equal(uniforms[2], 0xffffffff);
assert.equal(uniforms[15], 0);
assert.equal(new Float32Array(uniforms.buffer)[16], 1);
assert.equal(uniforms[17], 0);
assert.equal(uniforms[18], 0);
assert.equal(uniforms[19], 0xffffffff);
const encodedUniforms = new Uint32Array(LAYER_BLEND_COMPOSITOR_UNIFORM_U32_STRIDE);
writeLayerBlendCompositorUniforms(
  encodedUniforms,
  "normal",
  "source-over",
  0,
  null,
  1,
  "direct",
  1,
  true,
);
assert.equal(encodedUniforms[14], 1);
assert.equal(encodedUniforms[15], 0);
assert.throws(
  () => writeLayerBlendCompositorUniforms(new Uint32Array(15)),
  /smaller than 64 bytes/,
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

// The mixed-scene CPU oracle follows the same rule as the viewport shader:
// encoded-sRGB equations stay high precision between operations. A 0.1%
// deposit is below half an RGBA8 code, so an accidental boundary after every
// operation would discard the complete sequence.
const subtleEncodedSource = [0.00072, 0.00041, 0.00019, 0.001];
let highPrecisionEncoded = [0, 0, 0, 0];
let prematurelyQuantizedEncoded = [0, 0, 0, 0];
for (let pass = 0; pass < 1024; pass += 1) {
  highPrecisionEncoded = compositeLayerPremultipliedEncodedSrgb(
    highPrecisionEncoded,
    subtleEncodedSource,
    "normal",
  );
  prematurelyQuantizedEncoded = compositeLayerPremultipliedEncodedSrgb(
    prematurelyQuantizedEncoded,
    subtleEncodedSource,
    "normal",
  ).map(quantizeUnorm8);
}
const accumulatedAlpha = 1 - (1 - subtleEncodedSource[3]) ** 1024;
close(highPrecisionEncoded[3], accumulatedAlpha, 2e-14, "encoded transient alpha");
close(
  highPrecisionEncoded[0],
  0.72 * accumulatedAlpha,
  2e-14,
  "encoded transient color",
);
assert.deepEqual(
  prematurelyQuantizedEncoded,
  [0, 0, 0, 0],
  "an RGBA8 boundary per operation must reproduce the low-flow plateau",
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
    const encodedAtop = blendLayerPremultipliedEncodedSrgbSourceAtop(
      fixtureBackdrop,
      fixtureSource,
      mode,
    );
    close(encodedAtop[3], clamp(fixtureBackdrop[3]), 2e-15, `${mode} encoded alpha invariant`);
    assert.ok(
      encodedAtop.slice(0, 3).every(
        (channel) => channel >= 0 && channel <= encodedAtop[3] + 1e-12,
      ),
      `${mode} encoded atop remains premultiplied`,
    );
    closeArray(
      compositeLayerPremultipliedEncodedSrgb(
        fixtureBackdrop,
        fixtureSource,
        mode,
        "source-atop",
      ),
      encodedAtop,
      2e-15,
      `${mode} encoded source-atop routing`,
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
assert.match(LAYER_BLEND_COMPOSITOR_WGSL, /struct LayerBlendCompositorUniforms\s*{\s*blendMode: u32,\s*compositeOperator: u32,\s*cutoutMode: u32,\s*sourceOpacity: f32,\s*currentRange: vec4<f32>,\s*underlyingRange: vec4<f32>,/s);
assert.match(
  LAYER_BLEND_COMPOSITOR_WGSL,
  /unfilteredSource \* tonalMask \* layerBlendCompositor\.sourceOpacity/,
);
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
assert.match(LAYER_BLEND_COMPOSITOR_WGSL, /storageColorSpace: u32/);
assert.match(
  LAYER_BLEND_COMPOSITOR_WGSL,
  /storageColorSpace[\s\S]*?LAYER_STORAGE_ENCODED_SRGB_PREMULTIPLIED[\s\S]*?layerBlendPremultipliedEncodedSrgbSourceOver/,
);
assert.doesNotMatch(
  LAYER_BLEND_COMPOSITOR_WGSL,
  /layerBlendCompositorQuantizeEncodedStorage|round\([^\n]*255\.0/,
  "transient encoded raster folds must not introduce an RGBA8 boundary",
);
assert.match(
  LAYER_BLEND_COMPOSITOR_WGSL,
  /return layerBlendCompositorEncodedStorageToLinear\(encodedComposited\);/,
  "the high-precision encoded result must return to the linear viewport working domain",
);
assert.match(LAYER_BLEND_COMPOSITOR_WGSL, /@binding\(4\) var layerBlendCutoutTexture/);
assert.match(LAYER_BLEND_COMPOSITOR_WGSL, /@binding\(5\) var layerBlendClippingBaseTexture/);
assert.match(LAYER_BLEND_COMPOSITOR_WGSL, /@binding\(6\) var layerBlendDocumentMaskTexture/);
assert.match(LAYER_BLEND_COMPOSITOR_WGSL, /@binding\(7\) var layerBlendDeepFloorTexture/);
assert.match(LAYER_BLEND_COMPOSITOR_WGSL, /fn layerBlendDocumentMaskFragmentMain/);
assert.match(
  LAYER_BLEND_COMPOSITOR_WGSL,
  /documentMask\.a[\s\S]*?clippingBase\.a[\s\S]*?documentMaskOpacity/,
);
assert.match(LAYER_BLEND_COMPOSITOR_WGSL, /let rawMatte = layerBlendCompositorLoadOrTransparent/);
assert.match(LAYER_BLEND_COMPOSITOR_WGSL, /return LAYER_BLEND_NORMAL/);
assert.match(
  LAYER_BLEND_COMPOSITOR_WGSL,
  /composited = layerBlendPremultipliedLinearSourceOver\([\s\S]*?compositionBackdrop,[\s\S]*?source,[\s\S]*?mode,[\s\S]*?documentPixel/,
);
assert.match(
  LAYER_BLEND_COMPOSITOR_WGSL,
  /composited = layerBlendPremultipliedLinearSourceAtop\([\s\S]*?compositionBackdrop,[\s\S]*?source,[\s\S]*?clippingBase\.a,[\s\S]*?mode,[\s\S]*?documentPixel/,
);
assert.match(
  LAYER_BLEND_COMPOSITOR_WGSL,
  /return clamp\(coverage - clamp\(source\.a, 0\.0, 1\.0\), 0\.0, 1\.0\)[\s\S]*?knocked = composited - backdrop \* residual/,
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
assert.match(atopShader, /sourcePremultiplied \* clippingAlpha/);
assert.match(atopShader, /blendedLinear \* \(sourceAlpha \* clippingAlpha\)/);
assert.match(atopShader, /backdropPremultiplied \* \(1\.0 - sourceAlpha\)/);
assert.match(atopShader, /outputAlpha,\s*\);/s);
assert.match(atopShader, /mode == LAYER_BLEND_DISSOLVE/);
assert.match(atopShader, /layerBlendDissolveSource\([\s\S]*?documentPixel/);

assert.equal(
  LAYER_BLEND_FOLD_STRATEGY,
  "cropped-document-1024-tile-ping-pong-dual-storage-tonal-gate-residual-cutout-w3c-over-clipping-atop-dissolve-v7",
);
assert.equal(LAYER_BLEND_FOLD_TILE_EXTENT, 1024);
assert.equal(LAYER_BLEND_FOLD_UNIFORM_BYTES, 160);
assert.match(LAYER_BLEND_FOLD_WGSL, /struct LayerBlendFoldUniforms\s*{[\s\S]*?blendMode: u32,[\s\S]*?compositeOperator: u32,/);
assert.match(LAYER_BLEND_FOLD_WGSL, /@binding\(0\) var backdropTexture: texture_2d<f32>/);
assert.match(LAYER_BLEND_FOLD_WGSL, /@binding\(1\) var sourceTexture: texture_2d<f32>/);
assert.match(LAYER_BLEND_FOLD_WGSL, /@binding\(3\) var cutoutTexture: texture_2d<f32>/);
assert.match(LAYER_BLEND_FOLD_WGSL, /@binding\(4\) var clippingBaseTexture: texture_2d<f32>/);
assert.match(LAYER_BLEND_FOLD_WGSL, /@binding\(5\) var documentMaskTexture: texture_2d<f32>/);
assert.match(LAYER_BLEND_FOLD_WGSL, /@binding\(6\) var deepFloorTexture: texture_2d<f32>/);
assert.match(LAYER_BLEND_FOLD_WGSL, /backdrop = mix\(backdrop, deepFloor,/);
assert.match(LAYER_BLEND_FOLD_WGSL, /knocked \+= deepFloor \* residual/);
assert.match(
  engineResourceSetupSource,
  /label: "Advanced layer blend fold bind group layout"[\s\S]*?binding: 6,[\s\S]*?texture: \{ sampleType: "unfilterable-float" \}/,
  "the general fold layout must expose the Deep-floor texture",
);
assert.match(
  layerRuntimeSource,
  /label: `\$\{label\} · advanced tile backdrop\/source`[\s\S]*?binding: 6, resource: engine\.transparentLayerView/,
  "isolated static folds must bind a transparent local Deep floor",
);
assert.match(LAYER_BLEND_FOLD_WGSL, /cutoutOrigin: vec2<f32>/);
assert.match(LAYER_BLEND_FOLD_WGSL, /cutoutDimensions: vec2<u32>/);
assert.match(LAYER_BLEND_FOLD_WGSL, /documentMaskOrigin: vec2<f32>/);
assert.match(LAYER_BLEND_FOLD_WGSL, /documentMaskDimensions: vec2<u32>/);
assert.match(LAYER_BLEND_FOLD_WGSL, /fn documentMaskContributionFragmentMain/);
assert.match(LAYER_BLEND_FOLD_WGSL, /sourcePosition >= dimensions/);
assert.match(LAYER_BLEND_FOLD_WGSL, /textureLoad\(backdropTexture, pixel, 0\)/);
assert.match(LAYER_BLEND_FOLD_WGSL, /fn foldDocumentPosition\(fragmentPosition: vec2<f32>\)/);
assert.match(LAYER_BLEND_FOLD_WGSL, /vec2<i32>\(floor\(documentPosition\)\)/);
assert.match(
  LAYER_BLEND_FOLD_WGSL,
  /composited = layerBlendPremultipliedLinearSourceOver\([\s\S]*?layer\.blendMode,[\s\S]*?documentPixel/,
);
assert.match(
  LAYER_BLEND_FOLD_WGSL,
  /composited = layerBlendFoldSourceAtop\([\s\S]*?layer\.blendMode,[\s\S]*?documentPixel/,
);
assert.match(
  LAYER_BLEND_FOLD_WGSL,
  /return clamp\(coverage - clamp\(source\.a, 0\.0, 1\.0\), 0\.0, 1\.0\)[\s\S]*?knocked = composited - backdrop \* residual/,
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
assert.match(foldAtopShader, /blendedStored \* \(sourceAlpha \* clippingAlpha\)/);
assert.match(foldAtopShader, /backdropPremultiplied \* \(1\.0 - sourceAlpha\)/);
assert.match(foldAtopShader, /mode == LAYER_BLEND_DISSOLVE/);
assert.match(foldAtopShader, /layer\.storageColorSpace[\s\S]*?blendedSrgb/);
assert.match(
  LAYER_BLEND_FOLD_WGSL,
  /layer\.storageColorSpace == LAYER_STORAGE_ENCODED_SRGB_PREMULTIPLIED[\s\S]*?layerBlendPremultipliedEncodedSrgbSourceOver/,
);
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
assert.match(
  atopShader,
  /clippingAlphaInput: f32[\s\S]*?outputAlpha = sourceAlpha \* clippingAlpha/,
  "clipping children must use the immutable-base matte after a scoped hole",
);
assert.match(
  engineVectorTextRuntimeSource,
  /writeLayerBlendCompositorUniforms\([\s\S]*?engine\.documentStorageColorSpace === "encoded-srgb-premultiplied"/,
  "ordered dynamic folds must select the document storage contract",
);
assert.match(
  engineRuntimeMiscSource,
  /writeLayerBlendCompositorUniforms\([\s\S]*?engine\.documentStorageColorSpace === "encoded-srgb-premultiplied"/,
  "prepopulated compositor records must select the document storage contract",
);

// A completed document tile owns the final cache value. Partial updates must
// replace those pixels and discard the corners of the rotated core's
// axis-aligned screen scissor. Clearing that whole scissor first is the exact
// regression that exposed checkerboard rectangles while painting.
assert.match(
  tileShaderSource,
  /LAYER_BLEND_TILE_STRATEGY\s*=\s*\n\s*"document-space-1024-tile-rgba16f-fold-single-rgba8-boundary-blend-before-filter-linear-present-replace-cache-v4"/,
);
assert.match(
  tileCompositorSource,
  /const scratchFormat = "rgba16float" as const;/,
  "the bounded layer fold must always accumulate in RGBA16F",
);
for (const resource of [
  "documentMaskTexture",
  "clippingBaseTexture",
  "deepFloorTexture",
]) {
  assert.match(
    tileCompositorSource,
    new RegExp(`const ${resource} = engine\\.device\\.createTexture\\(\\{[\\s\\S]*?format: scratchFormat`),
    `${resource} must share the high-precision clipping working domain`,
  );
}
assert.match(
  tileCompositorSource,
  /const textures = Array\.from\([\s\S]*?width: LAYER_BLEND_TILE_EXTENT,[\s\S]*?height: LAYER_BLEND_TILE_EXTENT,[\s\S]*?format: scratchFormat/,
  "accumulation textures must remain bounded independently of document dimensions",
);
assert.match(
  tileCompositorSource,
  /const bakeTexture = engine\.device\.createTexture\([\s\S]*?format: engine\.layerFormat/,
  "the style baker needs a native-format source distinct from RGBA16F accumulation",
);
assert.match(
  tileRuntimeSource,
  /renderer\.encodeBake\(\{[\s\S]*?targetView: compositor\.bakeView/,
  "live styled content must write to the native bake source",
);
assert.match(
  tileCompositorSource,
  /"Layer blend tile advanced fold"[\s\S]*?scratchFormat/,
  "advanced blend equations must target the RGBA16F accumulator",
);
assert.match(
  tileCompositorSource,
  /"Layer blend tile exact mip 1"[\s\S]*?engine\.layerFormat/,
  "mip 1 is the single persistent native-format boundary",
);
assert.match(
  layerRuntimeSource,
  /allocateActiveLayerDisplayPyramid\([\s\S]*?format,[\s\S]*?rebuildActiveLayerPyramidBindings[\s\S]*?paintMipViews = \[engine\.layerView, \.\.\.engine\.activeLayerDisplayPyramid\.mipViews\]/,
  "authoritative mip 0 and the resident pyramid must retain the document format",
);
assert.match(
  tileShaderSource,
  /rgba8HighFrequencyQuantizationShader[\s\S]*?quantizeToRgba8[\s\S]*?quantizeRgba8HighFrequencyAdjacent\([\s\S]*?fragmentPosition\.xy[\s\S]*?tile\.quantizationSeed/,
  "the RGBA16F to RGBA8 mip boundary must use stable high-frequency adjacent-code quantization",
);
assert.match(
  tileCompositorSource,
  /mipUniformU32\[word \+ 4\] = this\.engine\.layerFormat === "rgba8unorm" \? 1 : 0;[\s\S]*?mipUniformU32\[word \+ 5\] = LAYER_BLEND_TILE_QUANTIZATION_SEED;/,
  "RGBA8 mip dithering must use a fixed composition seed rather than camera state",
);
assert.match(
  layerRuntimeSource,
  /const blendSignature = items[\s\S]*?record\.blendMode[\s\S]*?@unit-modes=\$\{blendSignature\}/,
  "cached raster runs must invalidate when an inactive clipping-child mode changes",
);
assert.match(tileShaderSource, /fn layerBlendTileSourceForLinearPresentation/);
assert.match(tileShaderSource, /display\.compositingColorSpace < 1\.5/);
assert.match(tileCompositorSource, /entryPoint: "storageBackgroundFragmentMain"/);
assert.match(
  tileCompositorSource,
  /foldUniformU32\[word \+ 38\] = this\.engine\.documentStorageColorSpace[\s\S]*?encoded-srgb-premultiplied" \? 1 : 0/,
);
assert.match(
  tileShaderSource,
  /if \(!inside\) \{\s*discard;\s*\}/s,
);
const tilePresentPipelineCall = tileCompositorSource.match(
  /pipeline\(\s*"Layer blend tile to linear presentation",([\s\S]*?)\n\s*\),/,
)?.[1] ?? "";
const pyramidPresentPipelineCall = tileCompositorSource.match(
  /pipeline\(\s*"Layer blend final pyramid to linear presentation",([\s\S]*?)\n\s*\),/,
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
  tileRuntimeSource,
  /activeRecord\.contentOpacity <= 0[\s\S]*?!activeHasVisibleEffects[\s\S]*?renderer\.encodeAuthoredMatteBake/,
  "Fill 0 live knockout must bake only the authored matte when no visible effect needs a styled source",
);
assert.match(
  tileRuntimeSource,
  /cutoutView: activeNeedsLiveMatte \? compositor\.authoredMatteView : engine\.layerView/,
  "live tile cutout must read the transient authored matte",
);
assert.match(
  tileRuntimeSource,
  /parent\?\.visible[\s\S]*?parent\.opacity > 0[\s\S]*?parent\.hasContent/,
  "the hidden-Background Deep floor must ignore invisible, zero-opacity, and empty raster layers",
);
assert.match(
  layerRuntimeSource,
  /Deep cutout protects the bottom-most visible contribution[\s\S]*?parent\.visible && parent\.opacity > 0 && parent\.hasContent/,
  "the ordered program must preserve a boundary after the lowest contributing layer",
);
assert.match(
  tileRuntimeSource,
  /withClippingScope\(/,
  "tile clipping children must use the immutable base and accumulate document masks",
);
assert.doesNotMatch(
  tileRuntimeSource,
  /The active clipping child has no immutable base/,
  "an empty clipping parent must remain a valid transparent sparse base",
);
assert.match(
  tileRuntimeSource,
  /if \(activeGroup\.base\)[\s\S]*?clear empty clipping-child immutable base[\s\S]*?view: compositor\.clippingBaseView/,
  "an active clipping child over an empty parent must use a cleared transparent base",
);
assert.match(tileRuntimeSource, /source\.clipping\?\.context === "clipping-child"/);
assert.match(tileRuntimeSource, /encodeDocumentMaskContribution\(/);
assert.match(
  tileCompositorSource,
  /documentMaskContributionFragmentMain[\s\S]*?sourceOverBlend/,
  "tile document-mask contributions must accumulate with normalized source-over union",
);
assert.match(
  engineVectorTextRuntimeSource,
  /layerBlendViewportDocumentMaskPipeline/,
  "viewport active clipping must accumulate then propagate the document mask",
);
assert.match(
  engineVectorTextRuntimeSource,
  /mixedSceneRasterSegmentUniformValues\(auxiliary, 1\)[\s\S]*?\{ binding: 1, resource: \{ buffer: auxiliaryUniformBuffer \} \}/,
  "viewport companion surfaces must sample with their own crop origin and scale",
);
assert.match(
  engineVectorTextRuntimeSource,
  /documentCutoutBaseUniformBuffer\?\.destroy\(\)[\s\S]*?documentCutoutMaskUniformBuffer\?\.destroy\(\)/,
  "viewport companion sampling uniforms must be released with their segment",
);
assert.match(engineVectorTextRuntimeSource, /"clipping-child"/);
assert.match(engineVectorTextRuntimeSource, /"clipping-outer"/);
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
