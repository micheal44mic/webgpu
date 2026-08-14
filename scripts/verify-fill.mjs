import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FILL_BLOCK_COUNT,
  FILL_BLOCK_GRID_HEIGHT,
  FILL_BLOCK_GRID_SIZE,
  FILL_BLOCK_GRID_WIDTH,
  FILL_BLOCK_SIZE,
  FILL_HISTORY_MASK_BYTES,
  FILL_HISTORY_MASK_WORDS,
  FILL_HISTORY_WORDS_PER_ROW,
  FILL_LABEL_BUFFER_BYTES,
  FILL_LAYER_HEIGHT,
  FILL_LAYER_SIZE,
  FILL_LAYER_WIDTH,
  FILL_MAX_COLOR_DISTANCE,
  FILL_MAX_COMPONENTS_PER_BLOCK,
  FILL_REFERENCE_LAYER_STRATEGY,
  FILL_RENDER_MASK_STRATEGY,
  FILL_RENDER_MASK_BYTES,
  FILL_RENDER_MASK_PIXELS_PER_WORD,
  FILL_RENDER_MASK_WORDS,
  FILL_RENDER_MASK_WORDS_PER_ROW,
  FILL_RESIDENT_SCRATCH_BYTES,
  FILL_TILE_HEIGHT,
  FILL_TILE_MASK_WORDS,
  FILL_TILE_WIDTH,
  FILL_WORKGROUP_STORAGE_BYTES,
  GPU_FILL_STRATEGY,
  countFillTiles,
  fillRenderMaskTargetWord,
  fillColorsMatch,
  hexToLinearFillColor,
  normalizeFillTolerance,
  srgbChannelToLinear,
} from "../src/fill-core.ts";
import {
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
  "webgpu-hierarchical-ccl-4-connected-color-family-contrast-capped-history1-render8-v4",
);
assert.equal(
  FILL_REFERENCE_LAYER_STRATEGY,
  "single-raster-reference-full-resident-gpu-source-separate-active-target-no-fallback-v1",
);
assert.equal(
  FILL_RENDER_MASK_STRATEGY,
  "history-1bit-compute-expanded-row-stride-low8-reused-label-buffer-v2",
);
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
assert.equal(FILL_TILE_WIDTH, DOCUMENT_TILE_WIDTH);
assert.equal(FILL_TILE_HEIGHT, DOCUMENT_TILE_HEIGHT);
assert.equal(FILL_WORKGROUP_STORAGE_BYTES, 9_232);
assert(FILL_RESIDENT_SCRATCH_BYTES > 50 * 1024 * 1024);
assert(FILL_RESIDENT_SCRATCH_BYTES < 51 * 1024 * 1024);

assert.equal(normalizeFillTolerance(-1), 0);
assert.equal(normalizeFillTolerance(10), 0.1);
assert.equal(normalizeFillTolerance(100), FILL_MAX_COLOR_DISTANCE);
assert(Math.abs(normalizeFillTolerance(50) - 0.16666666666666669) < 1e-12);
assert.equal(countFillTiles(Uint32Array.from([0, 1, 0x80000001])), 3);
assert.throws(() => normalizeFillTolerance(Number.NaN));
assert.deepEqual(hexToLinearFillColor("#000000"), [0, 0, 0, 1]);
assert.deepEqual(hexToLinearFillColor("ffffff"), [1, 1, 1, 1]);
assert.throws(() => hexToLinearFillColor("#fff"));

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
    [1, 0, 0, 1],
    0,
    32,
  );
  assert.equal(rendered.selectedButDifferentPixels, 1);
  assert.equal(rendered.selectedButDifferentByXModulo32[31], 1);
  assert.equal(classifyFillDiagnostic(mask, rendered), "render-commit-loss");
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
assert(shader.includes("fn probeBit31()"));
assert(shader.includes("atomicOr(&results[1], 0x80000000u)"));
assert(shader.includes("atomicOr(&selectedMask[word], fillBitMask(pixel.x))"));
assert(shader.includes("fillMaskContains(atomicLoad(&selectedMask[word]), safePixel.x)"));
assert(shader.includes("if (targetWordX + 3u < TARGET_WORDS_PER_ROW)"));
assert(shader.includes("packedLabels[targetWord + 3u] = (source >> 24u) & 0xffu"));
assert(shader.includes("fillRenderMaskContains(renderMask[word], pixel.x)"));
assert(shader.includes("pixel.x / 8u"));
assert(!shader.includes("fillMaskContains(selectedMask[word], pixel.x)"));
assert(!shader.includes("1u << (pixel.x & 31u)"));
assert(!shader.includes("1u << (coldTile & 31u)"));
assert(shader.includes("fn fragmentMain(@builtin(position) position: vec4<f32>)"));
assert(!shader.includes("@location(0) pixel: vec2<f32>"));
assert(shader.includes("let sourceRow = global.x / SOURCE_WORDS_PER_ROW;"));
assert(shader.includes("let targetWord = sourceRow * TARGET_WORDS_PER_ROW + targetWordX;"));
assert(!shader.includes("let targetWord = global.x * 4u;"));
assert(!shader.includes("let target = global.x * 4u;"), "target e' riservata in WGSL");
assert(!renderer.includes("dispatchWorkgroupsIndirect"));
assert.equal(
  renderer.match(/dispatchWorkgroups\(FILL_BLOCK_GRID_WIDTH, FILL_BLOCK_GRID_HEIGHT\)/g)?.length,
  5,
  "classify, boundary, select e i due rebuild devono dispatchare entrambi gli assi della griglia",
);
assert.doesNotMatch(renderer, /\bFILL_BLOCK_GRID_SIZE\b/);
assert(renderer.includes("pass.drawIndirect"));
assert(renderer.includes("this.expandRenderMaskPipeline"));
assert(renderer.includes("buffer: packedLabels, size: FILL_RENDER_MASK_BYTES"));
assert.equal(
  renderer.match(/dispatchWorkgroups\(Math\.ceil\(FILL_HISTORY_MASK_WORDS \/ 256\)\)/g)?.length,
  3,
  "intersezione Selezione e commit live/replay devono coprire tutte le word della mask",
);
assert(renderer.includes("async captureDiagnostics()"));
assert(renderer.includes("Diagnosi Fill: timeout readback mask dopo 10 s."));
assert(renderer.includes("allHighBitPathsCorrect"));
assert(renderer.includes("encoder.copyBufferToBuffer(\n      scratch.selectedMask"));
assert(renderer.includes("historySlice.buffer"));
assert(renderer.includes("private sourceSamplingView: GPUTextureView"));
assert(renderer.includes("setSourceSamplingView(view: GPUTextureView)"));
assert(renderer.includes("if (view === this.sourceSamplingView)"));
assert(renderer.includes("{ binding: 1, resource: this.sourceSamplingView }"));
assert(!renderer.includes("copyTextureToTexture"));
assert(runtime.includes("engine.canPaintSelectedSceneItem()"));
assert(runtime.includes("export async function captureFillDiagnostics"));
assert(runtime.includes("summarizeFillMaskWords"));
assert(runtime.includes("summarizeFillRenderedRow"));
assert(runtime.includes("renderMaskStrategy: FILL_RENDER_MASK_STRATEGY"));
assert(runtime.includes("renderer.encodeLiveCommit"));
assert(runtime.includes("renderer.encodeLiveCommit(encoder, engine.layerView, historySlice)"));
assert(runtime.includes("kind: \"fill\""));
assert(runtime.includes("const source = resolveFillSource(engine)"));
assert(runtime.includes("sourceLayerId: source.record.id"));
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
assert(runtimeStats.includes("riferimento hot"));
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
assert.match(main, /setFillColor: \(color\) => \{[\s\S]*?brushSettingsController\.update\(\{ color \}\)/);
assert(!main.includes("getBrushColor:"));
assert(!main.includes('rangeValue("fillTolerance")'));
assert(html.includes('id="gpuMemoryFill"'));

console.log("GPU Fill contract verification passed.");
