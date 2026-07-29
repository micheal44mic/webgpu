import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MIXED_SCENE_STACK_STRATEGY,
  MixedSceneStack,
  VECTOR_TEXT_NODE_MAXIMUM,
} from "../src/mixed-scene-stack.ts";
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
} from "../src/mixed-memory-benchmark-model.ts";

const seed = (text = "STREETWEAR") => ({
  text,
  fontFamily: "Impact, sans-serif",
  fontSize: 360,
  color: "#f4c95d",
  outlineWidth: 0,
  outlineColor: "#111111",
  outlineJoin: "round",
  blockShadowEnabled: true,
  blockShadowColor: "#727272",
  blockShadowOpacity: 1,
  blockShadowOffset: 23,
  blockShadowAngle: -104,
  blockShadowOutlineWidth: 0,
  singleShadowEnabled: false,
  singleShadowColor: "#727272",
  singleShadowOpacity: 1,
  singleShadowOffset: 54,
  singleShadowAngle: -180,
  singleShadowBlur: 6,
  innerShadowEnabled: false,
  innerShadowColor: "#000000",
  innerShadowOpacity: 0.65,
  innerShadowOffset: 12,
  innerShadowAngle: -135,
  innerShadowBlur: 12,
  x: 2048,
  y: 2048,
  scale: 1,
  rotation: 0,
});
const flattenedCompositionKeys = (segments) => segments.flatMap((segment) => {
  if (segment.kind === "active-raster") {
    return [segment.item.key];
  }
  return segment.items.map((item) => item.key);
});

const assertCompositionPreservesDocumentOrder = (stack, activeRasterLayerId) => {
  const segments = stack.compositionSegments(activeRasterLayerId);
  assert.deepEqual(
    flattenedCompositionKeys(segments),
    stack.items.map((item) => item.key),
    `la composizione con raster ${activeRasterLayerId} attivo non deve cambiare gerarchia`,
  );
  assert.equal(
    segments.filter((segment) => segment.kind === "active-raster").length,
    1,
  );
  for (let index = 1; index < segments.length; index += 1) {
    assert.notEqual(
      segments[index - 1].kind,
      segments[index].kind,
      "due run adiacenti dello stesso tipo devono essere fusi",
    );
  }
  return segments;
};

assert.equal(
  MIXED_SCENE_STACK_STRATEGY,
  "heterogeneous-bottom-up-raster-text-segmented-composition-selected-insertion-v3",
);

{
  const stack = new MixedSceneStack([1]);
  assert.deepEqual(stack.items.map((item) => item.key), ["raster:1"]);
  assert.equal(stack.selected.key, "raster:1");
  assert.equal(stack.textCount, 0);

  const first = stack.addTextAboveSelection(seed("FIRST"));
  const second = stack.addTextAboveSelection(seed("SECOND"));
  assert.equal(first.id, 1);
  assert.equal(second.id, 2);
  assert.equal(first.transformType, "none");
  assert.equal(first.transformCurve, 80);
  assert.equal(first.circleRadiusPercent, 50);
  assert.equal(first.circleInverted, false);
  assert.equal(first.distortPoints, null);
  assert.deepEqual(
    stack.items.map((item) => item.key),
    ["raster:1", "text:1", "text:2"],
  );
  assert.equal(stack.selected.key, "text:2");

  stack.select("text:1");
  stack.addRasterAboveSelection(2);
  assert.deepEqual(
    stack.items.map((item) => item.key),
    ["raster:1", "text:1", "raster:2", "text:2"],
  );
  assert.equal(stack.selected.key, "raster:2");

  const captured = stack.captureState();
  stack.select("text:2");
  stack.updateText(2, { text: "TEMPORARY" });
  stack.deleteText(1, 2);
  stack.restoreState(captured);
  assert.equal(stack.selected.key, "raster:2");
  assert.equal(stack.textById(2).text, "SECOND");
  assert.deepEqual(
    stack.items.map((item) => item.key),
    ["raster:1", "text:1", "raster:2", "text:2"],
  );

  stack.select("text:1");
  assert.equal(stack.moveText(1, -1), true);
  assert.deepEqual(
    stack.items.map((item) => item.key),
    ["text:1", "raster:1", "raster:2", "text:2"],
  );
  assert.deepEqual(
    stack.partitionAroundRaster(2).below.map((item) => item.key),
    ["text:1", "raster:1"],
  );
  assert.deepEqual(
    stack.partitionAroundRaster(2).above.map((item) => item.key),
    ["text:2"],
  );
  const activeOneSegments = assertCompositionPreservesDocumentOrder(stack, 1);
  assert.deepEqual(
    activeOneSegments.map((segment) => segment.key),
    ["text-run:1", "active-raster:1", "raster-run:2", "text-run:2"],
  );
  const activeTwoSegments = assertCompositionPreservesDocumentOrder(stack, 2);
  assert.deepEqual(
    activeTwoSegments.map((segment) => segment.key),
    ["text-run:1", "raster-run:1", "active-raster:2", "text-run:2"],
  );

  stack.updateText(1, {
    text: "UPDATED",
    x: 100,
    y: 200,
    opacity: 2,
    transformType: "wave",
    transformCurve: 999,
    circleRadiusPercent: 1,
    circleInverted: true,
    outlineWidth: 999,
    outlineColor: "#123456",
    outlineJoin: "bevel",
    blockShadowOpacity: 2,
    blockShadowOffset: 999,
    blockShadowAngle: -999,
    blockShadowOutlineWidth: 999,
    singleShadowEnabled: true,
    singleShadowColor: "#654321",
    singleShadowOpacity: 2,
    singleShadowOffset: 999,
    singleShadowAngle: 999,
    singleShadowBlur: 999,
    innerShadowEnabled: true,
    innerShadowColor: "#abcdef",
    innerShadowOpacity: 2,
    innerShadowOffset: 999,
    innerShadowAngle: -999,
    innerShadowBlur: 999,
  });
  assert.equal(stack.textById(1).text, "UPDATED");
  assert.equal(stack.textById(1).x, 100);
  assert.equal(stack.textById(1).y, 200);
  assert.equal(stack.textById(1).opacity, 1);
  assert.equal(stack.textById(1).transformType, "wave");
  assert.equal(stack.textById(1).transformCurve, 100);
  assert.equal(stack.textById(1).circleRadiusPercent, 16);
  assert.equal(stack.textById(1).circleInverted, true);
  assert.equal(stack.textById(1).outlineWidth, 100);
  assert.equal(stack.textById(1).outlineColor, "#123456");
  assert.equal(stack.textById(1).outlineJoin, "bevel");
  assert.equal(stack.textById(1).blockShadowOpacity, 1);
  assert.equal(stack.textById(1).blockShadowOffset, 100);
  assert.equal(stack.textById(1).blockShadowAngle, -180);
  assert.equal(stack.textById(1).blockShadowOutlineWidth, 100);
  assert.equal(stack.textById(1).singleShadowEnabled, true);
  assert.equal(stack.textById(1).singleShadowColor, "#654321");
  assert.equal(stack.textById(1).singleShadowOpacity, 1);
  assert.equal(stack.textById(1).singleShadowOffset, 100);
  assert.equal(stack.textById(1).singleShadowAngle, 180);
  assert.equal(stack.textById(1).singleShadowBlur, 300);
  assert.equal(stack.textById(1).innerShadowEnabled, true);
  assert.equal(stack.textById(1).innerShadowColor, "#abcdef");
  assert.equal(stack.textById(1).innerShadowOpacity, 1);
  assert.equal(stack.textById(1).innerShadowOffset, 100);
  assert.equal(stack.textById(1).innerShadowAngle, -180);
  assert.equal(stack.textById(1).innerShadowBlur, 300);

  const distortPoints = [
    { x: -500, y: -200 },
    { x: 0, y: -240 },
    { x: 500, y: -200 },
    { x: 500, y: 200 },
    { x: 0, y: 240 },
    { x: -500, y: 200 },
    { x: -250, y: -240 },
    { x: 250, y: -240 },
    { x: -250, y: 240 },
    { x: 250, y: 240 },
  ];
  stack.updateText(1, { transformType: "distort", distortPoints });
  assert.equal(stack.textById(1).transformType, "distort");
  assert.deepEqual(stack.textById(1).distortPoints, distortPoints);
  assert.notEqual(stack.textById(1).distortPoints, distortPoints);
  const distortState = stack.captureState();
  stack.updateText(1, {
    distortPoints: distortPoints.map((point) => ({ x: point.x + 99, y: point.y })),
  });
  stack.restoreState(distortState);
  assert.deepEqual(stack.textById(1).distortPoints, distortPoints);
  assert.notEqual(stack.textById(1).distortPoints, distortState.textNodes[0].distortPoints);

  assert.equal(stack.setTextOpacity(1, -4), true);
  assert.equal(stack.textById(1).opacity, 0);
  assert.equal(stack.setTextVisibility(1, false), true);
  assert.equal(stack.setTextVisibility(1, false), false);

  stack.select("text:1");
  const deleted = stack.deleteText(1, 2);
  assert.equal(deleted.id, 1);
  assert.equal(stack.selected.key, "raster:2");
  assert.deepEqual(
    stack.items.map((item) => item.key),
    ["raster:1", "raster:2", "text:2"],
  );

  stack.removeRaster(2, 1);
  assert.deepEqual(
    stack.items.map((item) => item.key),
    ["raster:1", "text:2"],
  );
}

{
  assert.throws(() => new MixedSceneStack([]), /almeno un livello raster/);
  assert.throws(() => new MixedSceneStack([1, 1]), /univoci/);
  const stack = new MixedSceneStack([1]);
  assert.throws(() => stack.select("text:99"), /inesistente/);
  assert.throws(() => stack.partitionAroundRaster(99), /assente/);
  assert.throws(() => stack.compositionSegments(99), /inesistente|assente/);
  stack.addRasterAboveSelection(2);
  assert.throws(() => stack.addRasterAboveSelection(2), /già presente/);
}

{
  const stack = new MixedSceneStack([1, 2]);
  stack.addTextAboveSelection(seed("BETWEEN"));
  stack.select("raster:2");
  stack.addTextAboveSelection(seed("TOP"));

  stack.select("text:1");
  stack.addRasterAboveSelection(3);
  assert.deepEqual(
    stack.items.map((item) => item.key),
    ["raster:1", "text:1", "raster:3", "raster:2", "text:2"],
    "un raster aggiunto con un testo selezionato deve nascere subito sopra quel testo",
  );

  stack.select("raster:2");
  stack.addRasterAboveSelection(4);
  assert.deepEqual(
    stack.items.map((item) => item.key),
    ["raster:1", "text:1", "raster:3", "raster:2", "raster:4", "text:2"],
    "la regola resta identica quando la selezione è raster",
  );
}

{
  const stack = new MixedSceneStack([1]);
  for (let index = 0; index < VECTOR_TEXT_NODE_MAXIMUM; index += 1) {
    stack.addTextAboveSelection(seed(`T${index}`));
  }
  assert.equal(stack.textCount, VECTOR_TEXT_NODE_MAXIMUM);
  assert.throws(() => stack.addTextAboveSelection(seed("overflow")), /Massimo/);
}

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

  const mainSource = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  const engineSource = readFileSync(
    new URL("../src/brush-engine.ts", import.meta.url),
    "utf8",
  );
  assert.match(mainSource, /pageSearchParams\.get\("mixedMemoryBenchmark"\) === "1"/);
  assert.match(mainSource, /pageSearchParams\.get\("mixedMemoryTargetMiB"\) === "600"/);
  assert.match(mainSource, /runRequestedMixedMemoryBenchmark/);
  assert.match(mainSource, /runMixedMemoryZoomProbe/);
  assert.match(mainSource, /resetActiveLayerForMemoryBenchmark/);
  assert.match(mainSource, /mixedMemoryBenchmarkKnownLogicalWorkingSetMiB/);
  assert.match(engineSource, /async addVectorTextNodesBatch\(/);
  assert.match(engineSource, /resetActiveLayerForMemoryBenchmark\(\)/);
}

console.log("Mixed raster/text scene stack verification passed.");
