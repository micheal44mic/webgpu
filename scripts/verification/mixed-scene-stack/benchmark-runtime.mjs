import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readEngineSource } from "../../engine-source.mjs";
import { VECTOR_TEXT_NODE_MAXIMUM } from "../../../src/mixed-scene-stack.ts";
import {
  MIXED_MEMORY_BENCHMARK_INTERLEAVED_TEXT_RUNS,
  MIXED_MEMORY_BENCHMARK_STAGED_INTERLEAVED_TILE_COUNT,
  MIXED_MEMORY_BENCHMARK_STAGED_STRATEGY,
  MIXED_MEMORY_BENCHMARK_STAGED_TARGET_MIB,
  MIXED_MEMORY_BENCHMARK_STAGED_TEXT_BATCH_SIZE,
  MIXED_MEMORY_BENCHMARK_STRATEGY,
  MIXED_MEMORY_BENCHMARK_TARGET_MIB,
  mixedMemoryBenchmarkStrategy,
  mixedMemoryBenchmarkTextSeed,
} from "../../../src/labs/memory/mixed-memory-benchmark-model.ts";

{
  assert.equal(
    MIXED_MEMORY_BENCHMARK_STRATEGY,
    "mixed-raster-vector-64-text-nine-runs-counted-gpu-800mib-v1",
  );
  assert.equal(MIXED_MEMORY_BENCHMARK_TARGET_MIB, 800);
  assert.equal(
    MIXED_MEMORY_BENCHMARK_STAGED_STRATEGY,
    "mixed-raster-vector-64-text-nine-runs-counted-gpu-600mib-staged-v1",
  );
  assert.equal(MIXED_MEMORY_BENCHMARK_STAGED_TARGET_MIB, 600);
  assert.equal(MIXED_MEMORY_BENCHMARK_STAGED_INTERLEAVED_TILE_COUNT, 128);
  assert.equal(MIXED_MEMORY_BENCHMARK_STAGED_TEXT_BATCH_SIZE, 8);
  assert.equal(
    mixedMemoryBenchmarkStrategy(800),
    MIXED_MEMORY_BENCHMARK_STRATEGY,
  );
  assert.equal(
    mixedMemoryBenchmarkStrategy(600),
    MIXED_MEMORY_BENCHMARK_STAGED_STRATEGY,
  );
  assert.equal(MIXED_MEMORY_BENCHMARK_INTERLEAVED_TEXT_RUNS, 8);
  const stressSeeds = Array.from(
    { length: VECTOR_TEXT_NODE_MAXIMUM },
    (_, index) => mixedMemoryBenchmarkTextSeed(index, 4096),
  );
  assert.equal(stressSeeds.filter((entry) => entry.blockShadowEnabled).length, 32);
  assert.equal(stressSeeds.filter((entry) => entry.singleShadowEnabled).length, 32);
  assert(stressSeeds.every((entry) => entry.outlineWidth === 0));
  assert(stressSeeds.every((entry) => entry.blockShadowOutlineWidth === 0));
  assert(stressSeeds.every((entry) => entry.x > 0 && entry.x < 4096));
  assert(stressSeeds.every((entry) => entry.y > 0 && entry.y < 4096));

  const mainSource = readFileSync(new URL("../../../src/main.ts", import.meta.url), "utf8");
  const engineSource = readEngineSource();
  const mixedMemorySource = readFileSync(
    new URL("../../../src/labs/memory/mixed-memory-benchmark.ts", import.meta.url),
    "utf8",
  );
  const editorLabsSource = readFileSync(
    new URL("../../../src/labs/editor-labs.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(mainSource, /mixedMemoryBenchmark|runMixedMemoryBenchmark/);
  assert.match(editorLabsSource, /\["mixed-memory", "Benchmark memoria mista"\]/);
  assert.match(editorLabsSource, /runMixedMemoryBenchmarkStudy/);
  assert.match(mixedMemorySource, /export async function runMixedMemoryBenchmarkStudy/);
  assert.match(mixedMemorySource, /knownLogicalWorkingSetMiB/);
  assert.match(engineSource, /async addVectorTextNodesBatch\(/);
  assert.match(
    engineSource,
    /if \(legacyBindingsChanged && !deferDisplayInvalidation\)/,
    "il clear transazionale non deve creare bind group contro texture evitte",
  );
  assert.match(
    engineSource,
    /if \(changed && this\.initialized && !deferDisplayInvalidation\)/,
    "il clear transazionale non deve schedulare frame mentre la scena è congelata",
  );
  assert(
    (engineSource.match(/reuseUnchangedRasterRuns: true/g) ?? []).length >= 4,
    "mutazioni e Undo/Redo vettoriali devono riusare i raster-run anche nel rollback",
  );
  assert.match(
    engineSource,
    /this\.mixedSceneRasterSegments = survivingPreviousSegments;/,
    "un rebuild fallito deve lasciare raggiungibili i raster-run riutilizzabili",
  );
  assert.match(
    engineSource,
    /if \(!reusedCandidateSegments\.has\(segment\)\)/,
    "il rollback non deve distruggere risorse raster riusate",
  );
  assert.match(
    engineSource,
    /if \(this\.layerPresentationFrozen\) \{[\s\S]*?Presentazione congelata con lavoro render pendente/,
    "waitForIdle deve fallire subito invece di attendere il watchdog per 10 secondi",
  );
  assert.match(
    engineSource,
    /async rebuildMergedLayerSurfaces\([\s\S]*?if \(hasPendingRenderWork\(this\)\) \{[\s\S]*?il render deve essere fermo prima del freeze/,
    "la transazione deve rifiutare lavoro render pendente prima di evacuare risorse",
  );
  const rasterSelection = engineSource.slice(
    engineSource.indexOf("async setActiveMixedSceneItem"),
    engineSource.indexOf("  updateVectorTextNode("),
  );
  const rasterSelectionDrain = rasterSelection.indexOf("await this.waitForIdle();");
  const rasterSelectionClear = rasterSelection.indexOf(
    "clearVectorTextPresentationForTransaction(this);",
  );
  assert(
    rasterSelectionDrain >= 0 && rasterSelectionClear > rasterSelectionDrain,
    "la selezione raster deve drenare il frame prima del clear transazionale",
  );
}

console.log("Mixed raster/vector scene stack verification passed.");
