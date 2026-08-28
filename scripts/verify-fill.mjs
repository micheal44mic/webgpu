import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FILL_BLOCK_COUNT,
  FILL_BLOCK_GRID_HEIGHT,
  FILL_BLOCK_GRID_SIZE,
  FILL_BLOCK_GRID_WIDTH,
  FILL_BLOCK_SIZE,
  FILL_COMPOSITE_MODE_CODE,
  FILL_HISTORY_MASK_BYTES,
  FILL_HISTORY_MASK_WORDS,
  FILL_HISTORY_WORDS_PER_ROW,
  FILL_LABEL_BUFFER_BYTES,
  FILL_LAYER_HEIGHT,
  FILL_LAYER_SIZE,
  FILL_LAYER_WIDTH,
  FILL_MAX_COLOR_DISTANCE,
  FILL_MAX_COMPONENTS_PER_BLOCK,
  FILL_METADATA_BYTES,
  FILL_METADATA_WORDS,
  FILL_META_SOURCE_SEED_COLOR_START,
  FILL_META_TILE_MASK_START,
  FILL_REFERENCE_LAYER_STRATEGY,
  FILL_RENDER_MASK_STRATEGY,
  FILL_RENDER_MASK_BYTES,
  FILL_RENDER_MASK_PIXELS_PER_WORD,
  FILL_RENDER_MASK_WORDS,
  FILL_RENDER_MASK_WORDS_PER_ROW,
  FILL_RESIDENT_SCRATCH_BYTES,
  FILL_RESIDUAL_FRINGE_MAX_RADIUS,
  FILL_TILE_HEIGHT,
  FILL_TILE_MASK_WORDS,
  FILL_TILE_WIDTH,
  FILL_UNIFORM_BYTES,
  FILL_WORKGROUP_STORAGE_BYTES,
  GPU_FILL_STRATEGY,
  compositeFillAsSolidUnderlay,
  countFillTiles,
  fillRenderMaskTargetWord,
  fillColorsMatch,
  fillResidualFringeRadius,
  hexToLinearFillColor,
  normalizeFillTolerance,
  recolorFillPreservingCoverage,
  resolveFillCompositeMode,
  sameLayerColoredFillColorsMatch,
  srgbChannelToLinear,
  transparentFillAlphaMatches,
} from "../src/fill-core.ts";
import {
  FILL_DIAGNOSTIC_SCHEMA,
  classifyFillDiagnostic,
  summarizeFillMaskWords,
  summarizeFillRenderedRow,
} from "../src/fill-diagnostics.ts";
import {
  DOCUMENT_HEIGHT,
  DOCUMENT_TILE_HEIGHT,
  DOCUMENT_TILE_WIDTH,
  DOCUMENT_WIDTH,
  LAYER_SIZE,
} from "../src/engine-limits.ts";
import { colorMatchShaderHelpers } from "../src/color-match-core.ts";
import { fillComputeShader as resolvedFillComputeShader } from "../src/fill-shaders.ts";
import { readEngineSource } from "./engine-source.mjs";

assert.equal(
  GPU_FILL_STRATEGY,
  "webgpu-hierarchical-ccl-4-connected-transparent-underlay-base-residual-fringe3-recolor-reference-replace-live-preview-history1-render8-v12",
);
assert.equal(
  FILL_REFERENCE_LAYER_STRATEGY,
  "single-raster-reference-full-resident-gpu-source-separate-active-target-no-fallback-v1",
);
assert.equal(
  FILL_RENDER_MASK_STRATEGY,
  "history-1bit-compute-expanded-row-stride-selected8-reused-label-buffer-v4",
);
assert.equal(FILL_DIAGNOSTIC_SCHEMA, "webgpu-brush-fill-mask-render-probe-v3");
assert.equal(FILL_BLOCK_SIZE, 16);
assert.equal(FILL_LAYER_SIZE, LAYER_SIZE);
assert.equal(FILL_LAYER_WIDTH, DOCUMENT_WIDTH);
assert.equal(FILL_LAYER_HEIGHT, DOCUMENT_HEIGHT);
assert.equal(FILL_LAYER_SIZE, Math.max(FILL_LAYER_WIDTH, FILL_LAYER_HEIGHT));
assert.equal(FILL_BLOCK_GRID_WIDTH, Math.ceil(FILL_LAYER_WIDTH / FILL_BLOCK_SIZE));
assert.equal(FILL_BLOCK_GRID_HEIGHT, Math.ceil(FILL_LAYER_HEIGHT / FILL_BLOCK_SIZE));
assert.equal(FILL_BLOCK_GRID_SIZE, Math.max(FILL_BLOCK_GRID_WIDTH, FILL_BLOCK_GRID_HEIGHT));
assert.equal(FILL_BLOCK_GRID_SIZE, 256);
assert.equal(FILL_BLOCK_COUNT, FILL_BLOCK_GRID_WIDTH * FILL_BLOCK_GRID_HEIGHT);
assert.equal(FILL_BLOCK_COUNT, 65_536);
assert.equal(FILL_MAX_COMPONENTS_PER_BLOCK, 128);
assert.equal(FILL_HISTORY_WORDS_PER_ROW, Math.ceil(FILL_LAYER_WIDTH / 32));
assert.equal(FILL_HISTORY_MASK_WORDS, FILL_HISTORY_WORDS_PER_ROW * FILL_LAYER_HEIGHT);
assert.equal(FILL_HISTORY_MASK_BYTES, FILL_HISTORY_MASK_WORDS * 4);
assert.equal(FILL_HISTORY_MASK_BYTES, 2 * 1024 * 1024);
assert.equal(FILL_HISTORY_MASK_WORDS, FILL_HISTORY_MASK_BYTES / 4);
assert.equal(FILL_RENDER_MASK_PIXELS_PER_WORD, 8);
assert.equal(
  FILL_RENDER_MASK_WORDS_PER_ROW,
  Math.ceil(FILL_LAYER_WIDTH / FILL_RENDER_MASK_PIXELS_PER_WORD),
);
assert.equal(FILL_RENDER_MASK_WORDS, FILL_RENDER_MASK_WORDS_PER_ROW * FILL_LAYER_HEIGHT);
assert.equal(FILL_RENDER_MASK_BYTES, FILL_RENDER_MASK_WORDS * 4);
assert.equal(FILL_RENDER_MASK_BYTES, FILL_HISTORY_MASK_BYTES * 4);
assert(FILL_RENDER_MASK_BYTES <= FILL_LABEL_BUFFER_BYTES);
const lastHistoryWordInFirstRow = FILL_HISTORY_WORDS_PER_ROW - 1;
assert.deepEqual(
  [0, 1, 2, 3].map((byte) => fillRenderMaskTargetWord(lastHistoryWordInFirstRow, byte)),
  [
    FILL_RENDER_MASK_WORDS_PER_ROW - 4,
    FILL_RENDER_MASK_WORDS_PER_ROW - 3,
    FILL_RENDER_MASK_WORDS_PER_ROW - 2,
    FILL_RENDER_MASK_WORDS_PER_ROW - 1,
  ],
);
assert.equal(
  fillRenderMaskTargetWord(FILL_HISTORY_WORDS_PER_ROW, 0),
  FILL_RENDER_MASK_WORDS_PER_ROW,
);
assert.equal(FILL_TILE_MASK_WORDS, 8);
assert.equal(FILL_UNIFORM_BYTES, 80);
assert.equal(FILL_METADATA_WORDS, 20);
assert.equal(FILL_METADATA_BYTES, 80);
assert.equal(FILL_META_SOURCE_SEED_COLOR_START, 8);
assert.equal(FILL_META_TILE_MASK_START, 12);
assert.equal(FILL_TILE_WIDTH, DOCUMENT_TILE_WIDTH);
assert.equal(FILL_TILE_HEIGHT, DOCUMENT_TILE_HEIGHT);
assert.equal(FILL_WORKGROUP_STORAGE_BYTES, 9_232);
assert(FILL_RESIDENT_SCRATCH_BYTES > 50 * 1024 * 1024);
assert(FILL_RESIDENT_SCRATCH_BYTES < 51 * 1024 * 1024);

assert.equal(normalizeFillTolerance(-1), 0);
assert.equal(normalizeFillTolerance(10), 0.1);
assert.equal(normalizeFillTolerance(100), FILL_MAX_COLOR_DISTANCE);
assert(Math.abs(normalizeFillTolerance(50) - 0.16666666666666669) < 1e-12);
assert.equal(FILL_RESIDUAL_FRINGE_MAX_RADIUS, 3);
assert.equal(fillResidualFringeRadius(0), 0);
assert.equal(fillResidualFringeRadius(10), 0);
assert.equal(fillResidualFringeRadius(10.1), 1);
assert.equal(fillResidualFringeRadius(40), 1);
assert.equal(fillResidualFringeRadius(40.1), 2);
assert.equal(fillResidualFringeRadius(70), 2);
assert.equal(fillResidualFringeRadius(70.1), 3);
assert.equal(fillResidualFringeRadius(100), 3);
assert.equal(fillResidualFringeRadius(1_000), 3);
assert.throws(() => fillResidualFringeRadius(Number.NaN));
assert.equal(countFillTiles(Uint32Array.from([0, 1, 0x80000001])), 3);
assert.throws(() => normalizeFillTolerance(Number.NaN));
assert.deepEqual(hexToLinearFillColor("#000000"), [0, 0, 0, 1]);
assert.deepEqual(hexToLinearFillColor("ffffff"), [1, 1, 1, 1]);
assert.equal(
  hexToLinearFillColor("#800180018001")[0],
  srgbChannelToLinear(0x8001 / 65_535),
);
assert.throws(() => hexToLinearFillColor("#fff"));
assert.deepEqual(FILL_COMPOSITE_MODE_CODE, {
  "solid-underlay": 0,
  "preserve-coverage-recolor": 1,
  "solid-replace": 2,
});
assert.equal(resolveFillCompositeMode(true, true), "solid-underlay");
assert.equal(resolveFillCompositeMode(true, false), "preserve-coverage-recolor");
assert.equal(resolveFillCompositeMode(false, true), "solid-replace");
assert.equal(resolveFillCompositeMode(false, false), "solid-replace");
const underlayFill = [0.2, 0.4, 0.6, 0.25];
// Same-layer underlay Fill is one opaque color placed behind the existing
// premultiplied pixel. Alpha is coverage, never an instruction to flatten the
// existing RGB. These four values pin empty, two AA coverages and opaque ink.
for (const destinationAlpha of [0, 0.25, 0.7, 1]) {
  const destination = [
    0.91 * destinationAlpha,
    0.17 * destinationAlpha,
    0.73 * destinationAlpha,
    destinationAlpha,
  ];
  const fillContribution = 1 - destinationAlpha;
  assert.deepEqual(
    compositeFillAsSolidUnderlay(destination, underlayFill),
    [
      destination[0] + underlayFill[0] * fillContribution,
      destination[1] + underlayFill[1] * fillContribution,
      destination[2] + underlayFill[2] * fillContribution,
      1,
    ],
  );
}
assert.deepEqual(
  compositeFillAsSolidUnderlay(
    [0, 0, 0, 0],
    underlayFill,
  ),
  [0.2, 0.4, 0.6, 1],
);
assert.deepEqual(
  compositeFillAsSolidUnderlay([0.4, 0.1, 0.2, 0.4], underlayFill),
  [0.52, 0.1 + 0.4 * 0.6, 0.56, 1],
);
const opaqueDestination = [0.7, 0.1, 0.3, 1];
assert.deepEqual(
  compositeFillAsSolidUnderlay(opaqueDestination, underlayFill),
  opaqueDestination,
);
const assertPixelNear = (actual, expected, epsilon = 1e-12) => {
  assert.equal(actual.length, expected.length);
  for (let channel = 0; channel < actual.length; channel += 1) {
    assert(
      Math.abs(actual[channel] - expected[channel]) <= epsilon,
      `channel ${channel}: ${actual[channel]} != ${expected[channel]}`,
    );
  }
};

// Same-layer opaque imports have their antialiasing baked into RGB. Recoloring
// replaces only the removable base contribution and leaves every residual
// line/shading component intact, even though alpha is one everywhere.
{
  const base = [0.5, 0.5, 0.5, 1];
  const fill = [0.8, 0.2, 0.1, 1];
  for (const [destination, expected] of [
    [[0.5, 0.5, 0.5, 1], [0.8, 0.2, 0.1, 1]],
    [[0.35, 0.35, 0.35, 1], [0.56, 0.14, 0.07, 1]],
    [[0.625, 0.625, 0.625, 1], [0.85, 0.4, 0.325, 1]],
    [[0, 0, 0, 1], [0, 0, 0, 1]],
    [[0.35, 0.35, 0.65, 1], [0.56, 0.14, 0.37, 1]],
    [[0.21, 0.21, 0.21, 0.6], [0.336, 0.084, 0.042, 0.6]],
  ]) {
    const actual = recolorFillPreservingCoverage(destination, fill, base);
    assertPixelNear(actual, expected);
    assert.equal(actual[3], destination[3], "same-layer Fill must preserve alpha");
    assert(actual.slice(0, 3).every((channel) => channel >= 0 && channel <= actual[3]));
  }
  for (const destination of [
    [0.5, 0.5, 0.5, 1],
    [0.35, 0.35, 0.65, 1],
    [0.21, 0.21, 0.21, 0.6],
  ]) {
    assertPixelNear(
      recolorFillPreservingCoverage(destination, base, base),
      destination,
    );
  }
}

// CPU mirror of the three render-only fringe passes. It may walk from the CCL
// core toward a darker contour, but the zero-contribution core stops it and a
// later increasing value on the far side can never be reached.
{
  const contributions = [1, 0.8, 0.6, 0.3, 0, 0.3, 0.6, 0.8, 1];
  let mask = Uint8Array.from([1, 1, 1, 0, 0, 0, 0, 0, 0]);
  for (let pass = 0; pass < FILL_RESIDUAL_FRINGE_MAX_RADIUS; pass += 1) {
    const next = mask.slice();
    for (let index = 0; index < mask.length; index += 1) {
      if (mask[index] || contributions[index] <= 0.024) continue;
      for (const neighbor of [index - 1, index + 1]) {
        if (
          neighbor >= 0
          && neighbor < mask.length
          && mask[neighbor]
          && contributions[index] <= contributions[neighbor] + 0.002
        ) {
          next[index] = 1;
        }
      }
    }
    mask = next;
  }
  assert.deepEqual([...mask], [1, 1, 1, 1, 0, 0, 0, 0, 0]);
  assertPixelNear(
    recolorFillPreservingCoverage([0.15, 0.15, 0.15, 1], [0.8, 0.2, 0.1, 1], [0.5, 0.5, 0.5, 1]),
    [0.24, 0.06, 0.03, 1],
  );
}
assert.equal(transparentFillAlphaMatches(0, 0), true);
assert.equal(transparentFillAlphaMatches(2 ** -24, 0), false);
assert.equal(transparentFillAlphaMatches(1 / 255, 0), false);
assert.equal(transparentFillAlphaMatches(0.899, 90), true);
assert.equal(transparentFillAlphaMatches(0.9, 90), false);
assert.equal(transparentFillAlphaMatches(0.901, 90), false);
assert.equal(transparentFillAlphaMatches(0.999, 100), true);
assert.equal(transparentFillAlphaMatches(Math.fround(1 - 2 ** -24), 100), true);
assert.equal(transparentFillAlphaMatches(1, 100), false);
assert.throws(() => transparentFillAlphaMatches(Number.NaN, 100));

const floodTransparentAlpha = (
  alphaValues,
  width,
  height,
  seedIndex,
  tolerancePercent,
) => {
  const selected = new Uint8Array(alphaValues.length);
  const queue = [seedIndex];
  selected[seedIndex] = 1;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor];
    const x = index % width;
    const y = Math.floor(index / width);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nextX = x + dx;
      const nextY = y + dy;
      if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue;
      const next = nextY * width + nextX;
      if (
        selected[next]
        || !transparentFillAlphaMatches(alphaValues[next], tolerancePercent)
      ) continue;
      selected[next] = 1;
      queue.push(next);
    }
  }
  return selected;
};
assert.deepEqual(
  [...floodTransparentAlpha([0, 0, 1 / 255], 3, 1, 0, 0)],
  [1, 1, 0],
);
assert.deepEqual(
  [...floodTransparentAlpha([0, 0.05, 0.4, 0.899, 0.9, 0], 6, 1, 0, 90)],
  [1, 1, 1, 1, 0, 0],
);
assert.deepEqual(
  [...floodTransparentAlpha([0, 1 / 255, 0.05, 0.4, 0.99, 1, 0], 7, 1, 0, 100)],
  [1, 1, 1, 1, 1, 0, 0],
);

// At maximum transparent-seed tolerance the AA fringe is reached and receives
// an underlay, while fully opaque contour ink remains a hard barrier.
{
  const alphas = [0, 0.25, 0.7, 1, 0];
  const selected = floodTransparentAlpha(alphas, alphas.length, 1, 0, 100);
  assert.deepEqual([...selected], [1, 1, 1, 0, 0]);
  const blackPremultiplied = alphas.map((alpha) => [0, 0, 0, alpha]);
  const composited = blackPremultiplied.map((pixel, index) =>
    selected[index] ? compositeFillAsSolidUnderlay(pixel, underlayFill) : pixel);
  assert.deepEqual(composited[0], [0.2, 0.4, 0.6, 1]);
  assert.deepEqual(composited[1], [
    underlayFill[0] * 0.75,
    underlayFill[1] * 0.75,
    underlayFill[2] * 0.75,
    1,
  ]);
  assert.deepEqual(composited[2], [
    underlayFill[0] * (1 - 0.7),
    underlayFill[1] * (1 - 0.7),
    underlayFill[2] * (1 - 0.7),
    1,
  ]);
  assert.deepEqual(composited[3], [0, 0, 0, 1]);
  assert.deepEqual(composited[4], [0, 0, 0, 0]);
}

// Regressione Android: il bit 31 deve restare u32 e una word piena non deve
// lasciare la sottile striscia verticale osservata ogni 32 pixel.
const fillBitMasks = Array.from({ length: 32 }, (_, bit) => (2 ** bit) >>> 0);
assert.equal(fillBitMasks[0], 0x00000001);
assert.equal(fillBitMasks[30], 0x40000000);
assert.equal(fillBitMasks[31], 0x80000000);
assert.equal(fillBitMasks.reduce((word, mask) => (word | mask) >>> 0, 0), 0xffffffff);

// Workaround render: ogni word History viene divisa in quattro byte bassi.
// Anche il pixel 31 diventa il bit 7 (0x80) e il fragment non vede mai bit 31.
for (const source of [0x80000000, 0xffffffff, 0xa55a3cc3]) {
  const renderWords = [
    source & 0xff,
    (source >>> 8) & 0xff,
    (source >>> 16) & 0xff,
    (source >>> 24) & 0xff,
  ];
  assert(renderWords.every((word) => (word & 0xffffff00) === 0));
  for (let bit = 0; bit < 32; bit += 1) {
    const historySelected = (source & (2 ** bit)) !== 0;
    const renderSelected = (renderWords[Math.floor(bit / 8)] & (2 ** (bit % 8))) !== 0;
    assert.equal(renderSelected, historySelected, `bit ${bit} perso nell'espansione render`);
  }
}

// La diagnosi deve separare una mask che perde davvero il bit alto da una
// mask corretta il cui colore non arriva al target nel commit render.
{
  const words = Uint32Array.from({ length: 16 }, () => 0x7fffffff);
  const summary = summarizeFillMaskWords(words, 16 * 32, 0, 0, 32);
  assert.equal(summary.readbackSelectedPixels, 16 * 31);
  assert.equal(summary.selectedPixelDelta, -16);
  assert.equal(summary.low31FullHighBitClearWords, 16);
  assert.equal(summary.bit31LikelyMissing, true);
}
{
  const words = Uint32Array.of(0xffffffff);
  const mask = summarizeFillMaskWords(words, 32, 0, 0, 32);
  const row = new Uint8Array(32 * 4);
  for (let x = 0; x < 32; x += 1) {
    row.set([255, 0, 0, 255], x * 4);
  }
  row.set([0, 0, 0, 0], 31 * 4);
  const rendered = summarizeFillRenderedRow(
    row,
    "rgba8unorm",
    words,
    0,
    32,
  );
  assert.equal(rendered.selectedButDifferentPixels, 1);
  assert.equal(rendered.selectedButDifferentByXModulo32[31], 1);
  assert.equal(classifyFillDiagnostic(mask, rendered), "render-commit-loss");
}
{
  const opaqueEmptyCommit = summarizeFillRenderedRow(
    Uint8Array.of(0, 0, 255, 255),
    "rgba8unorm",
    Uint32Array.of(1),
    0,
    1,
    { compositeMode: "solid-underlay", fillColor: [0, 0, 1, 1] },
  );
  assert.equal(opaqueEmptyCommit.compositeMode, "solid-underlay");
  assert.equal(opaqueEmptyCommit.matchingFillPixels, 1);
  const invalidPartialAlpha = summarizeFillRenderedRow(
    Uint8Array.of(0, 0, 128, 128),
    "rgba8unorm",
    Uint32Array.of(1),
    0,
    1,
    { compositeMode: "solid-underlay", fillColor: [0, 0, 1, 1] },
  );
  assert.equal(invalidPartialAlpha.selectedButDifferentPixels, 1);
  const opaqueCompositeRgb = summarizeFillRenderedRow(
    Uint8Array.of(32, 96, 224, 255),
    "rgba8unorm",
    Uint32Array.of(1),
    0,
    1,
    { compositeMode: "solid-underlay", fillColor: [0.2, 0.4, 0.6, 1] },
  );
  assert.equal(opaqueCompositeRgb.matchingFillPixels, 1);
}
{
  const preserveExpectation = {
    compositeMode: "preserve-coverage-recolor",
    fillColor: [0, 0, 1, 1],
  };
  const preservedCoverage = summarizeFillRenderedRow(
    Uint8Array.of(0, 0, 128, 128),
    "rgba8unorm",
    Uint32Array.of(1),
    0,
    1,
    preserveExpectation,
  );
  assert.equal(preservedCoverage.compositeMode, "preserve-coverage-recolor");
  assert.equal(preservedCoverage.matchingFillPixels, 1);
  const invalidUnpremultipliedRecolor = summarizeFillRenderedRow(
    Uint8Array.of(0, 0, 255, 128),
    "rgba8unorm",
    Uint32Array.of(1),
    0,
    1,
    preserveExpectation,
  );
  assert.equal(invalidUnpremultipliedRecolor.selectedButDifferentPixels, 1);

  const solidReplace = summarizeFillRenderedRow(
    Uint8Array.of(51, 102, 153, 255),
    "rgba8unorm",
    Uint32Array.of(1),
    0,
    1,
    { compositeMode: "solid-replace", fillColor: [0.2, 0.4, 0.6, 1] },
  );
  assert.equal(solidReplace.matchingFillPixels, 1);
  const wrongSolidReplaceHue = summarizeFillRenderedRow(
    Uint8Array.of(51, 103, 180, 255),
    "rgba8unorm",
    Uint32Array.of(1),
    0,
    1,
    { compositeMode: "solid-replace", fillColor: [0.2, 0.4, 0.6, 1] },
  );
  assert.equal(wrongSolidReplaceHue.selectedButDifferentPixels, 1);
}

// Il confronto avviene dopo l'unpremultiply: lo stesso rosso straight con due
// alpha diverse differisce soltanto nel canale alpha, non nei canali colore.
assert.equal(
  fillColorsMatch([0.25, 0, 0, 0.25], [0.5, 0, 0, 0.5], 99.9),
  false,
);
assert.equal(
  fillColorsMatch([0.25, 0, 0, 0.25], [0.5, 0, 0, 0.5], 100),
  true,
);
assert.equal(
  sameLayerColoredFillColorsMatch([0.25, 0, 0, 0.25], [0.5, 0, 0, 0.5], 0),
  true,
);
assert.equal(
  sameLayerColoredFillColorsMatch([0.25, 0, 0, 0.25], [1, 0, 0, 1], 0),
  true,
);
assert.equal(
  sameLayerColoredFillColorsMatch([0, 0, 0, 0], [0.5, 0, 0, 0.5], 100),
  false,
);
assert.equal(
  sameLayerColoredFillColorsMatch([1e-8, 0, 0, 1e-8], [0.5, 0, 0, 0.5], 100),
  false,
);
assert.equal(
  sameLayerColoredFillColorsMatch([0, 0.25, 0, 0.25], [0.5, 0, 0, 0.5], 100),
  false,
);
{
  const coloredSeed = [0.5, 0, 0, 0.5];
  const row = [
    coloredSeed,
    [1, 0, 0, 1],
    [0, 0, 0, 1],
    [1, 0, 0, 1],
  ];
  const eligible = row.map((pixel) =>
    sameLayerColoredFillColorsMatch(pixel, coloredSeed, 100));
  assert.deepEqual(eligible, [true, true, false, true]);
  const reached = new Uint8Array(row.length);
  for (let x = 0; x < row.length && eligible[x]; x += 1) reached[x] = 1;
  assert.deepEqual([...reached], [1, 1, 0, 0]);
  // The contrasting opaque contour and the matching island behind it are not
  // part of the 4-connected component, hence neither can be recolored.
  assert.deepEqual(row[2], [0, 0, 0, 1]);
  assert.deepEqual(row[3], [1, 0, 0, 1]);
}

const opaqueStraightSrgb = (red, green, blue) => [
  srgbChannelToLinear(red),
  srgbChannelToLinear(green),
  srgbChannelToLinear(blue),
  1,
];
const white = opaqueStraightSrgb(1, 1, 1);
const black = opaqueStraightSrgb(0, 0, 0);
const middleGray = opaqueStraightSrgb(0.5, 0.5, 0.5);
const darkGray = opaqueStraightSrgb(0.2, 0.2, 0.2);
const nearBlack = opaqueStraightSrgb(0.05, 0.05, 0.05);
const lightGray = opaqueStraightSrgb(0.8, 0.8, 0.8);
const green = opaqueStraightSrgb(0, 1, 0);
const darkGreen = opaqueStraightSrgb(0, 0.2, 0);
assert.equal(fillColorsMatch(green, black, 100), false);
assert.equal(fillColorsMatch(darkGreen, black, 100), false);
assert.equal(fillColorsMatch(white, black, 100), false);
assert.equal(fillColorsMatch(white, middleGray, 100), false);
assert.equal(fillColorsMatch(white, lightGray, 100), true);
assert.equal(fillColorsMatch(darkGray, black, 100), false);
assert.equal(fillColorsMatch(nearBlack, black, 100), true);

// A contrasting one-pixel vertical divider stays ineligible at maximum, and
// the existing 4-connected traversal therefore cannot reach the far half.
for (const dividerX of [15, 16, 31, 32]) {
  const width = 48;
  const height = 3;
  const pixels = Array.from({ length: width * height }, (_, index) =>
    index % width === dividerX ? black : white);
  const reached = new Uint8Array(width * height);
  const queue = [0];
  reached[0] = 1;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor];
    const x = index % width;
    const y = Math.floor(index / width);
    for (const [nextX, nextY] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue;
      const next = nextY * width + nextX;
      if (reached[next] || !fillColorsMatch(pixels[next], white, 100)) continue;
      reached[next] = 1;
      queue.push(next);
    }
  }
  assert.equal(
    reached.reduce((sum, value) => sum + value, 0),
    dividerX * height,
    `divider x=${dividerX} must stop the maximum-tolerance component`,
  );
  assert.equal(
    reached.some((value, index) => value !== 0 && index % width >= dividerX),
    false,
  );
}

// Golden logica minimale: 4-connected non attraversa una diagonale.
{
  const width = 3;
  const matching = Uint8Array.from([
    1, 0, 0,
    0, 1, 0,
    0, 0, 1,
  ]);
  const selected = new Uint8Array(matching.length);
  const queue = [0];
  selected[0] = 1;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor];
    const x = index % width;
    const y = Math.floor(index / width);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nextX = x + dx;
      const nextY = y + dy;
      if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= width) continue;
      const next = nextY * width + nextX;
      if (matching[next] && !selected[next]) {
        selected[next] = 1;
        queue.push(next);
      }
    }
  }
  assert.deepEqual([...selected], [1, 0, 0, 0, 0, 0, 0, 0, 0]);
}

const engine = readEngineSource();
const brushEngine = readFileSync(new URL("../src/brush-engine.ts", import.meta.url), "utf8");
const renderer = readFileSync(new URL("../src/fill-renderer.ts", import.meta.url), "utf8");
const shader = readFileSync(new URL("../src/fill-shaders.ts", import.meta.url), "utf8");
const runtime = readFileSync(new URL("../src/engine-fill-runtime.ts", import.meta.url), "utf8");
const selectionRuntime = readFileSync(
  new URL("../src/engine-selection-runtime.ts", import.meta.url),
  "utf8",
);
const layerRuntime = readFileSync(
  new URL("../src/engine-layer-runtime.ts", import.meta.url),
  "utf8",
);
const historyRuntime = readFileSync(
  new URL("../src/engine-history-runtime.ts", import.meta.url),
  "utf8",
);
const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const runtimeStats = readFileSync(
  new URL("../src/runtime-stats-controller.ts", import.meta.url),
  "utf8",
);
const gpuMemoryPanel = readFileSync(
  new URL("../src/gpu-memory-panel-controller.ts", import.meta.url),
  "utf8",
);
const canvasTool = readFileSync(
  new URL("../src/canvas-tool-controller.ts", import.meta.url),
  "utf8",
);
const canvasInput = readFileSync(
  new URL("../src/canvas-input-controller.ts", import.meta.url),
  "utf8",
);
const layerPanel = readFileSync(
  new URL("../src/layer-panel-controller.ts", import.meta.url),
  "utf8",
);
const sceneEditor = readFileSync(
  new URL("../src/scene-editor-controller.ts", import.meta.url),
  "utf8",
);
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

for (const entryPoint of [
  "classifyLocal",
  "unionBoundaries",
  "compressComponents",
  "selectSeedComponent",
  "rebuildSelection",
  "expandResidualFringe1",
  "expandResidualFringe2",
  "expandResidualFringe3",
  "recordResidualFringeBlocks",
  "expandRenderMask",
]) {
  assert(shader.includes(`fn ${entryPoint}`), `entry point WGSL mancante: ${entryPoint}`);
}
assert(shader.includes("atomicCompareExchangeWeak"));
assert(shader.includes("@compute @workgroup_size(16, 1, 1)\nfn unionBoundaries"));
assert(shader.includes("0x40000000u, 0x80000000u"));
assert(shader.includes("fn fillBitMask(bitIndex: u32) -> u32"));
assert(shader.includes("fn fillMaskContains(word: u32, bitIndex: u32) -> bool"));
assert(colorMatchShaderHelpers.includes("fn connectedStraightSrgbColorsMatch("));
assert(shader.includes("${colorMatchShaderHelpers}"));
assert(resolvedFillComputeShader.includes("fn connectedStraightSrgbColorsMatch("));
assert(!resolvedFillComputeShader.includes("${colorMatchShaderHelpers}"));
assert(shader.includes("return connectedStraightSrgbColorsMatch("));
assert(shader.includes("uniforms.transparentSeedAlphaThreshold >= 0.0"));
assert(shader.includes("seedColor.a == 0.0"));
assert(shader.includes("threshold == 0.0"));
assert(shader.includes("return alpha == 0.0"));
assert(shader.includes("uniforms.sourceIsTarget != 0u"));
assert(shader.includes("seedColor.a > COLOR_MATCH_EPSILON"));
assert(shader.includes("value.a <= COLOR_MATCH_EPSILON"));
assert(shader.includes("vec4<f32>(straightValue.rgb, 1.0)"));
assert(shader.includes("vec4<f32>(straightSeed.rgb, 1.0)"));
assert(shader.includes("uniforms.compositeMode == COMPOSITE_SOLID_REPLACE"));
assert(shader.includes("uniforms.compositeMode == COMPOSITE_PRESERVE_COVERAGE_RECOLOR"));
assert(shader.includes("const COMPOSITE_SOLID_UNDERLAY: u32"));
assert(shader.includes("uniforms.compositeMode == COMPOSITE_SOLID_UNDERLAY"));
assert(shader.includes("seedColor.a == 0.0"));
assert(!shader.includes("let threshold = max("));
assert(shader.includes("fn probeBit31()"));
assert(shader.includes("atomicOr(&results[1], 0x80000000u)"));
assert(shader.includes("atomicOr(&selectedMask[word], fillBitMask(pixel.x))"));
assert(shader.includes("fillMaskContains(atomicLoad(&selectedMask[word]), safePixel.x)"));
assert(shader.includes("if (targetWordX + 3u < TARGET_WORDS_PER_ROW)"));
assert(shader.includes("expandedRenderMaskByte(source, 3u)"));
assert(!shader.includes("occupiedByte"));
assert(shader.includes("fillRenderMaskContains(renderMask[word], pixel.x)"));
assert(!shader.includes("fillRenderMaskOccupied"));
assert(shader.includes("pixel.x / 8u"));
assert(!shader.includes("fillMaskContains(selectedMask[word], pixel.x)"));
assert(!shader.includes("1u << (pixel.x & 31u)"));
assert(!shader.includes("1u << (coldTile & 31u)"));
assert(shader.includes("fn fragmentMain(@builtin(position) position: vec4<f32>)"));
assert(shader.includes(
  "@group(0) @binding(3) var destinationSnapshot: texture_2d<f32>",
));
assert(shader.includes("textureLoad(destinationSnapshot, vec2<i32>(pixel), 0)"));
assert(shader.includes("return vec4<f32>(uniforms.fillColor.rgb, 1.0)"));
assert(shader.includes("destination.rgb + uniforms.fillColor.rgb * (1.0 - destinationAlpha)"));
assert(!shader.includes("if (destinationAlpha <= 0.0)"));
assert(!shader.includes("uniforms.fillColor.a"));
assert(shader.includes("return destination;"));
assert(shader.includes("fn maximumBaseContribution("));
assert(shader.includes("uniforms.sourceSeedColor.rgb / sourceAlpha"));
assert(shader.includes("destination.rgb + contribution *"));
assert(shader.includes("const RESIDUAL_BASE_MIN_CONTRIBUTION: f32 = 0.024"));
assert(shader.includes("contribution <= neighborContribution + RESIDUAL_MONOTONIC_EPSILON"));
assert(shader.includes("let source = atomicLoad(&globalParents[global.x])"));
assert(shader.includes("destinationAlpha = clamp(destination.a, 0.0, 1.0)"));
assert(!shader.includes("fn fragmentEmpty"));
assert(!shader.includes("fn fragmentOccupied"));
assert(!shader.includes("@location(0) pixel: vec2<f32>"));
assert(shader.includes("let sourceRow = global.x / SOURCE_WORDS_PER_ROW;"));
assert(shader.includes("let targetWord = sourceRow * TARGET_WORDS_PER_ROW + targetWordX;"));
assert(!shader.includes("let targetWord = global.x * 4u;"));
assert(!shader.includes("let target = global.x * 4u;"), "target e' riservata in WGSL");
assert(!renderer.includes("dispatchWorkgroupsIndirect"));
assert(renderer.includes("this.renderPipeline"));
assert(!renderer.includes("emptyRenderPipeline"));
assert(!renderer.includes("preserveAlphaRenderPipeline"));
assert(!renderer.includes('srcFactor: "dst-alpha"'));
assert(!renderer.includes('dstFactor: "zero"'));
assert(!renderer.includes("this.setSourceSamplingView(targetSamplingView)"));
assert(renderer.includes("destinationSnapshotTexture"));
assert(renderer.includes("GPUTextureUsage.COPY_SRC"));
assert(renderer.includes("GPUTextureUsage.COPY_DST"));
assert(renderer.includes("GPUTextureUsage.TEXTURE_BINDING"));
assert(renderer.includes("encoder.copyTextureToTexture("));
assert(renderer.includes("FILL_LAYER_WIDTH * FILL_LAYER_HEIGHT * bytesPerPixel"));
assert.equal(
  renderer.match(/dispatchWorkgroups\(FILL_BLOCK_GRID_WIDTH, FILL_BLOCK_GRID_HEIGHT\)/g)?.length,
  6,
  "classify, boundary, select, rebuild e registrazione fringe devono dispatchare entrambi gli assi",
);
assert.doesNotMatch(renderer, /\bFILL_BLOCK_GRID_SIZE\b/);
assert(renderer.includes("pass.drawIndirect"));
assert(renderer.includes("this.expandRenderMaskPipeline"));
assert(renderer.includes("buffer: scratch.packedLabels, size: FILL_RENDER_MASK_BYTES"));
assert(renderer.includes("async prewarmComposite(): Promise<void>"));
assert(renderer.includes("Fill composite scratch is not resident."));
assert(renderer.includes("this.scratch?.composite"));
assert.match(
  renderer,
  /async prewarm\(\): Promise<void>[\s\S]*?composite: null,[\s\S]*?async prewarmComposite\(\): Promise<void>/,
);
assert.equal(
  renderer.match(/dispatchWorkgroups\(Math\.ceil\(FILL_HISTORY_MASK_WORDS \/ 256\)\)/g)?.length,
  1,
  "l’intersezione Selezione deve coprire tutte le word della mask",
);
assert(renderer.includes("const wordWorkgroups = Math.ceil(FILL_HISTORY_MASK_WORDS / 256)"));
assert.equal(
  renderer.match(/pass\.dispatchWorkgroups\(wordWorkgroups\)/g)?.length,
  2,
  "ogni compositing deve espandere la fringe e la mask render su tutte le word",
);
assert(renderer.includes("async captureDiagnostics()"));
assert(renderer.includes("Fill diagnostics: mask readback timed out after 10 s."));
assert(renderer.includes("allHighBitPathsCorrect"));
assert(renderer.includes("encoder.copyBufferToBuffer(\n      scratch.selectedMask"));
assert(renderer.includes("historySlice.buffer"));
assert(renderer.includes("private configuredSourceSamplingView: GPUTextureView"));
assert(renderer.includes("setSourceSamplingView(view: GPUTextureView)"));
assert(renderer.includes("if (view === this.configuredSourceSamplingView)"));
assert(renderer.includes("? this.requireCompositeScratch(scratch).destinationSnapshotView"));
assert(renderer.includes("{ binding: 1, resource: sourceSamplingView }"));
assert(renderer.includes("copyTextureToTexture"));
assert(renderer.includes("beginLiveSession("));
assert(renderer.includes("encodeLiveSnapshotRestore("));
assert(renderer.includes("encodeLivePreview("));
assert(renderer.includes("encodeFinalMaskCapture("));
assert(renderer.includes("endLiveSession()"));
assert.match(
  renderer,
  /this\.uploadLiveCompositeUniforms\([\s\S]{0,180}sourceSeedColorLinear,[\s\S]{0,80}residualFringeRadius/,
);
assert(renderer.includes("FILL_COMPOSITE_MODE_CODE[compositeMode]"));
assert(!renderer.includes("replaceSelectedColor"));
const beginLiveSessionSource = renderer.slice(
  renderer.indexOf("  beginLiveSession("),
  renderer.indexOf("  /** Restores normal source sampling"),
);
assert(beginLiveSessionSource.includes("this.encodeDestinationSnapshotCopy("));
const livePreviewSource = renderer.slice(
  renderer.indexOf("  encodeLivePreview("),
  renderer.indexOf("  /** Copies only the final authoritative"),
);
assert(!livePreviewSource.includes("encodeDestinationSnapshotCopy"));
assert(!livePreviewSource.includes("historySlice"));
const finalMaskCaptureSource = renderer.slice(
  renderer.indexOf("  encodeFinalMaskCapture("),
  renderer.indexOf("  encodeReplayCommit("),
);
assert(finalMaskCaptureSource.includes("copyBufferToBuffer"));
assert(!finalMaskCaptureSource.includes("encodeRender"));
assert(runtime.includes("engine.canPaintSelectedSceneItem()"));
assert(runtime.includes("export async function captureFillDiagnostics"));
assert(runtime.includes("summarizeFillMaskWords"));
assert(runtime.includes("summarizeFillRenderedRow"));
assert(runtime.includes("renderMaskStrategy: FILL_RENDER_MASK_STRATEGY"));
assert(runtime.includes("renderer.beginLiveSession"));
assert(runtime.includes("renderer.encodeLiveSnapshotRestore"));
assert(runtime.includes("renderer.encodeLivePreview"));
assert(runtime.includes("renderer.encodeFinalMaskCapture"));
assert(runtime.includes("endLiveSession()"));
assert(runtime.includes("requestedSerial"));
assert(runtime.includes("encodedSerial"));
assert(runtime.includes("previewInFlight"));
assert(runtime.includes("requestAnimationFrame"));
assert(runtime.includes("export function updateFillPreview("));
assert(runtime.includes("export function getFillPreviewState("));
assert(runtime.includes("engine.activeFillPreviewSession !== null"));
assert(runtime.includes("engine.fillPreviewFinalizationPromise !== null"));
assert.equal(
  runtime.match(/await renderer\.prewarmComposite\(\);/g)?.length,
  3,
  "Fill select, live preview e History replay devono richiedere la snapshot RGBA on demand",
);
assert.match(
  selectionRuntime,
  /if \(method === "magic-wand"\)[\s\S]{0,220}await fillRenderer\.prewarm\(\);/,
  "Magic Wand deve allocare soltanto lo scratch CCL, non la snapshot RGBA Fill",
);
assert(runtime.includes("FILL_SCRATCH_IDLE_RELEASE_MS = 0"));
assert(runtime.includes("FILL_SCRATCH_BUSY_RETRY_MS = 50"));
assert(runtime.includes("allocate-on-demand-release-immediately-after-close-or-replay"));
assert(renderer.includes("if (!this.resident) return 0"));
assert(renderer.includes("scratch.uniformBuffer.destroy()"));
assert.match(
  renderer,
  /resources\.computeBindGroup = this\.createComputeBindGroup\([\s\S]{0,220}catch \(error\) \{[\s\S]{0,100}this\.destroyScratchResources\(resources\)/,
);
const fillRendererClassHeader = renderer.slice(
  renderer.indexOf("export class FillRenderer"),
  renderer.indexOf("  private constructor("),
);
assert(!fillRendererClassHeader.includes("readonly uniformBuffer: GPUBuffer;"));
const fillTapSource = runtime.slice(
  runtime.indexOf("export async function fillAtClientPoint("),
  runtime.indexOf("async function finalizeFillPreview("),
);
assert(!fillTapSource.includes("commitHistoryActionAtomically("));
assert(!fillTapSource.includes("historyGpuStorage.allocate("));
const fillFinalizeSource = runtime.slice(
  runtime.indexOf("async function finalizeFillPreview("),
  runtime.indexOf("export async function submitFillHistoryBatch("),
);
assert(
  fillFinalizeSource.indexOf("renderer.encodeFinalMaskCapture(")
    < fillFinalizeSource.indexOf("commitHistoryActionAtomically("),
  "History Fill deve catturare e pubblicare solo la mask finale alla chiusura.",
);
assert(fillFinalizeSource.includes("await flushFillPreview(engine, session);"));
assert(fillFinalizeSource.includes("if (engine.historyStateInconsistent) throw error;"));
assert(runtime.includes("session.analyzedTolerancePercent !== tolerancePercent"));
assert(runtime.includes("serial !== session.requestedSerial"));
const updateFillPreviewSource = runtime.slice(
  runtime.indexOf("export function updateFillPreview("),
  runtime.indexOf("export async function setFillToolSelected("),
);
assert(!updateFillPreviewSource.includes("color: string"));
assert(updateFillPreviewSource.includes("pendingClick.tolerancePercent = normalizedTolerance"));
assert(updateFillPreviewSource.includes("session.tolerancePercent = normalizedTolerance"));
assert(!updateFillPreviewSource.includes("linearColor ="));
assert(!updateFillPreviewSource.includes("session.color ="));
assert.match(
  runtime,
  /renderer\.encodeLivePreview\([\s\S]{0,220}engine\.layerTexture[\s\S]{0,100}engine\.layerView/,
);
assert.match(
  runtime,
  /renderer\.encodeReplayCommit\([\s\S]{0,180}engine\.layerTexture[\s\S]{0,80}engine\.layerView/,
);
assert(runtime.includes("compositeMode"));
assert(runtime.includes("sourceSeedColorLinear: [...analysis.sourceSeedColorLinear]"));
assert(runtime.includes("residualFringeRadius: analysis.residualFringeRadius"));
assert(runtime.includes("batch.sourceSeedColorLinear"));
assert(runtime.includes("batch.residualFringeRadius"));
assert(runtime.includes("kind: \"fill\""));
assert.match(
  runtime,
  /Fill is unavailable:[\s\S]{0,160}scheduleFillScratchRelease\(engine\);/,
);
const fillReplaySource = runtime.slice(
  runtime.indexOf("export async function submitFillHistoryBatch("),
);
assert(fillReplaySource.includes("finally"));
assert(fillReplaySource.includes("if (!engine.fillToolSelected) scheduleFillScratchRelease(engine);"));
assert(runtime.includes("const source = resolveFillSource(engine)"));
assert(runtime.includes("sourceLayerId: source.record.id"));
assert(runtime.includes("resolveFillCompositeMode("));
assert(!runtime.includes("fillCommitReplacesSelectedColor("));
assert(!runtime.includes("replaceSelectedColor"));
assert(runtime.includes("record.storageTileMask[index] |= analysis.tileMask[index]"));
assert(runtime.includes("seedX >= engine.documentWidth"));
assert(runtime.includes("seedY >= engine.documentHeight"));
assert.doesNotMatch(runtime, /engine\.layerSize|\bFILL_LAYER_SIZE\b|\bFILL_TILE_SIZE\b/);
assert.match(shader, /const LAYER_EXTENT: vec2<u32> = vec2<u32>\(\$\{FILL_LAYER_WIDTH\}u, \$\{FILL_LAYER_HEIGHT\}u\);/);
assert.match(shader, /const BLOCK_GRID: vec2<u32> = vec2<u32>\(\$\{FILL_BLOCK_GRID_WIDTH\}u, \$\{FILL_BLOCK_GRID_HEIGHT\}u\);/);
assert.match(
  shader,
  /reduceMinX\[0\] \/ \$\{FILL_TILE_WIDTH\}u, reduceMinY\[0\] \/ \$\{FILL_TILE_HEIGHT\}u/,
);
assert.match(
  shader,
  /\(reduceMaxX\[0\] - 1u\) \/ \$\{FILL_TILE_WIDTH\}u,[\s\S]*?\(reduceMaxY\[0\] - 1u\) \/ \$\{FILL_TILE_HEIGHT\}u/,
  "Un blocco CCL deve accendere tutte le tile rettangolari toccate dai pixel selezionati.",
);
assert.doesNotMatch(shader, /\bFILL_LAYER_SIZE\b|\bFILL_BLOCK_GRID_SIZE\b|\bFILL_TILE_SIZE\b/);
assert(layerRuntime.includes(
  "const record = reference === null ? engine.layerStack.active : reference",
));
assert(layerRuntime.includes("requireLayerHot(engine, record.id).samplingView"));
assert(layerRuntime.includes("Neither invariant violation may degrade"));
assert(layerRuntime.includes("there is deliberately no slower fallback"));
assert(layerRuntime.includes("createReferenceLayerDemotion"));
assert(layerRuntime.includes("destroyLayerHot(demotion.hot)"));
assert(layerRuntime.includes("previousRecord.id === engine.layerStack.referenceLayerId"));
assert(brushEngine.includes("this.layerStack.active.id === this.layerStack.referenceLayerId"));
assert(brushEngine.includes("retargetFillRendererSource(this)"));
assert(historyRuntime.includes("await engine.submitFillHistoryBatch"));
assert(historyRuntime.includes("batch.tileMask[index]"));
assert(engine.includes("fillRendererMiB"));

const hotPathStart = brushEngine.indexOf("  submitImmediate(");
const hotPathEnd = brushEngine.indexOf("  private packThicknessTailStamps(");
assert(hotPathStart >= 0, "Marcatore iniziale del percorso caldo Paint mancante.");
assert(hotPathEnd > hotPathStart, "Sezione del percorso caldo Paint disallineata.");
const hotPath = brushEngine.slice(hotPathStart, hotPathEnd);
assert(hotPath.length > 1_000);
assert(hotPath.length < 250_000, "Sezione del percorso caldo Paint troppo ampia.");
assert(!hotPath.includes("fillRenderer"), "Il percorso caldo Paint non deve diramare su Fill.");
assert(!hotPath.includes("FillHistoryRenderBatch"));

assert(canvasTool.includes('this.activeCanvasTool === "fill"'));
assert(canvasInput.includes('pointerMode === "fill"'));
assert(canvasInput.includes("engine.fillAtClientPoint("));
assert(layerPanel.includes('reference.className = "mobile-layer-reference"'));
assert(layerPanel.includes("this.options.setRasterReference(key, !layer.reference)"));
assert(sceneEditor.includes("this.options.engine.setLayerReference("));
assert(runtimeStats.includes("hot reference"));
assert(gpuMemoryPanel.includes("coldEligibleLayers = inactiveLayers.filter((layer) => !layer.reference)"));
assert(runtimeStats.includes("stats.referenceLayerId !== null"));
assert(styles.includes('.mobile-layer-reference[aria-pressed="true"]'));
assert(html.includes('data-mobile-tool-sheet="fill"'));
assert(html.includes('id="mobileFillTolerance"'));
assert(html.includes('id="mobileFillColor"'));
assert.match(
  main,
  /getFillSettings: \(\) => \(\{[\s\S]*?\.\.\.canvasToolSettingsController\.fillSnapshot\(\)/,
);
assert.match(
  main,
  /getFillSettings: \(\) => \(\{[\s\S]*?color: brushSettingsController\.snapshot\(\)\.color/,
);
assert.match(
  main,
  /setFillColor: \(color\) => \{[\s\S]*?canonicalBrushColorForFormat\(color, current\.shapeMaskFormat\)/,
);
const setFillColorSource = main.slice(
  main.indexOf("  setFillColor: (color) => {"),
  main.indexOf("  onClose:", main.indexOf("  setFillColor: (color) => {")),
);
assert(!setFillColorSource.includes("engine.updateFillPreview("));
assert(!main.includes("getBrushColor:"));
assert(!main.includes('rangeValue("fillTolerance")'));
assert(!main.includes("fillHoodProbe"));
assert(!main.includes("__fill_hood_probe"));
assert(html.includes('id="gpuMemoryFill"'));

console.log("GPU Fill contract verification passed.");
