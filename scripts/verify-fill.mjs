import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FILL_BLOCK_COUNT,
  FILL_BLOCK_GRID_SIZE,
  FILL_BLOCK_SIZE,
  FILL_HISTORY_MASK_BYTES,
  FILL_LAYER_SIZE,
  FILL_MAX_COMPONENTS_PER_BLOCK,
  FILL_REFERENCE_LAYER_STRATEGY,
  FILL_RESIDENT_SCRATCH_BYTES,
  FILL_TILE_MASK_WORDS,
  FILL_WORKGROUP_STORAGE_BYTES,
  GPU_FILL_STRATEGY,
  countFillTiles,
  fillColorsMatch,
  hexToLinearFillColor,
  normalizeFillTolerance,
} from "../src/fill-core.ts";
import { LAYER_SIZE } from "../src/engine-limits.ts";
import { readEngineSource } from "./engine-source.mjs";

assert.equal(
  GPU_FILL_STRATEGY,
  "webgpu-hierarchical-ccl-4-connected-straight-srgb-alpha-bitmask-v2",
);
assert.equal(
  FILL_REFERENCE_LAYER_STRATEGY,
  "single-raster-reference-full-resident-gpu-source-separate-active-target-no-fallback-v1",
);
assert.equal(FILL_BLOCK_SIZE, 16);
assert.equal(FILL_LAYER_SIZE, LAYER_SIZE);
assert.equal(FILL_BLOCK_GRID_SIZE, 256);
assert.equal(FILL_BLOCK_COUNT, 65_536);
assert.equal(FILL_MAX_COMPONENTS_PER_BLOCK, 128);
assert.equal(FILL_HISTORY_MASK_BYTES, LAYER_SIZE * LAYER_SIZE / 8);
assert.equal(FILL_HISTORY_MASK_BYTES, 2 * 1024 * 1024);
assert.equal(FILL_TILE_MASK_WORDS, 8);
assert.equal(FILL_WORKGROUP_STORAGE_BYTES, 9_232);
assert(FILL_RESIDENT_SCRATCH_BYTES > 50 * 1024 * 1024);
assert(FILL_RESIDENT_SCRATCH_BYTES < 51 * 1024 * 1024);

assert.equal(normalizeFillTolerance(-1), 0);
assert.equal(normalizeFillTolerance(10), 0.1);
assert.equal(normalizeFillTolerance(100), 0.976);
assert.equal(countFillTiles(Uint32Array.from([0, 1, 0x80000001])), 3);
assert.throws(() => normalizeFillTolerance(Number.NaN));
assert.deepEqual(hexToLinearFillColor("#000000"), [0, 0, 0, 1]);
assert.deepEqual(hexToLinearFillColor("ffffff"), [1, 1, 1, 1]);
assert.throws(() => hexToLinearFillColor("#fff"));

// Il confronto avviene dopo l'unpremultiply: lo stesso rosso straight con due
// alpha diverse differisce soltanto nel canale alpha, non nei canali colore.
assert.equal(
  fillColorsMatch([0.25, 0, 0, 0.25], [0.5, 0, 0, 0.5], 24.9),
  false,
);
assert.equal(
  fillColorsMatch([0.25, 0, 0, 0.25], [0.5, 0, 0, 0.5], 25),
  true,
);

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
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

for (const entryPoint of [
  "classifyLocal",
  "unionBoundaries",
  "compressComponents",
  "selectSeedComponent",
  "rebuildSelection",
]) {
  assert(shader.includes(`fn ${entryPoint}`), `entry point WGSL mancante: ${entryPoint}`);
}
assert(shader.includes("atomicCompareExchangeWeak"));
assert(shader.includes("@compute @workgroup_size(16, 1, 1)\nfn unionBoundaries"));
assert(!renderer.includes("dispatchWorkgroupsIndirect"));
assert(renderer.includes("selectionPass.dispatchWorkgroups(FILL_BLOCK_GRID_SIZE)"));
assert(renderer.includes("pass.drawIndirect"));
assert(renderer.includes("encoder.copyBufferToBuffer(\n      scratch.selectedMask"));
assert(renderer.includes("historySlice.buffer"));
assert(renderer.includes("private sourceSamplingView: GPUTextureView"));
assert(renderer.includes("setSourceSamplingView(view: GPUTextureView)"));
assert(renderer.includes("if (view === this.sourceSamplingView)"));
assert(renderer.includes("{ binding: 1, resource: this.sourceSamplingView }"));
assert(!renderer.includes("copyTextureToTexture"));
assert(runtime.includes("engine.canPaintSelectedSceneItem()"));
assert(runtime.includes("renderer.encodeLiveCommit"));
assert(runtime.includes("renderer.encodeLiveCommit(encoder, engine.layerView, historySlice)"));
assert(runtime.includes("kind: \"fill\""));
assert(runtime.includes("const source = resolveFillSource(engine)"));
assert(runtime.includes("sourceLayerId: source.record.id"));
assert(runtime.includes("record.storageTileMask[index] |= analysis.tileMask[index]"));
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

assert(main.includes('activeCanvasTool === "fill"'));
assert(main.includes('pointerMode === "fill"'));
assert(main.includes("engine.fillAtClientPoint("));
assert(main.includes('reference.className = "layer-reference"'));
assert(main.includes("engine.setLayerReference(index, enabled)"));
assert(main.includes("riferimento hot"));
assert(main.includes("layer.reference && layer.hotAllocated"));
assert(main.includes("coldEligibleLayers = inactiveLayers.filter((layer) => !layer.reference)"));
assert(styles.includes('.layer-reference[aria-pressed="true"]'));
assert(html.includes('<option value="fill">Riempimento</option>'));
assert(html.includes('id="fillTolerance"'));
assert(html.includes('id="gpuMemoryFill"'));

console.log("GPU Fill contract verification passed.");
