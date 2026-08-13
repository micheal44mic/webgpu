import type { BrushEngine } from "../../brush-engine";
import type { EngineGpuMemoryStats } from "../../engine-stats";
import type { LayerSwitchResult } from "../../engine-types";
import type { MixedVectorTextController } from "../../mixed-vector-text-controller";
import {
  VECTOR_TEXT_NODE_MAXIMUM,
  type VectorTextNode,
} from "../../mixed-scene-stack";
import { LAYER_STACK_MAXIMUM } from "../../layer-stack";
import {
  LAYER_STORAGE_TILE_COUNT,
  layerStorageTileMemoryMiB,
} from "../../layer-storage-study";
import {
  MIXED_MEMORY_BENCHMARK_INTERLEAVED_TEXT_RUNS,
  MIXED_MEMORY_BENCHMARK_REPORT_VERSION,
  MIXED_MEMORY_BENCHMARK_STAGED_INTERLEAVED_TILE_COUNT,
  MIXED_MEMORY_BENCHMARK_STAGED_TARGET_MIB,
  MIXED_MEMORY_BENCHMARK_STAGED_TEXT_BATCH_SIZE,
  MIXED_MEMORY_BENCHMARK_TARGET_MIB,
  mixedMemoryBenchmarkStrategy,
  type MixedMemoryBenchmarkStrategy,
  mixedMemoryBenchmarkTextSeed,
} from "./mixed-memory-benchmark-model";
import { seedActiveLayerMemoryStress } from "../engine-lab-operations";
export {
  MIXED_MEMORY_BENCHMARK_INTERLEAVED_TEXT_RUNS,
  MIXED_MEMORY_BENCHMARK_REPORT_VERSION,
  MIXED_MEMORY_BENCHMARK_STAGED_INTERLEAVED_TILE_COUNT,
  MIXED_MEMORY_BENCHMARK_STAGED_STRATEGY,
  MIXED_MEMORY_BENCHMARK_STAGED_TARGET_MIB,
  MIXED_MEMORY_BENCHMARK_STAGED_TEXT_BATCH_SIZE,
  MIXED_MEMORY_BENCHMARK_STRATEGY,
  MIXED_MEMORY_BENCHMARK_TARGET_MIB,
  mixedMemoryBenchmarkStrategy,
  mixedMemoryBenchmarkTextSeed,
} from "./mixed-memory-benchmark-model";

export interface MixedMemoryBenchmarkProgress {
  readonly phase: "text" | "raster" | "settle" | "complete";
  readonly rasterLayerCount: number;
  readonly textNodeCount: number;
  readonly countedTotalMiB: number;
  readonly peakCountedTotalMiB: number;
  readonly targetMiB: number;
}

export interface MixedMemoryBenchmarkSwitchSample {
  readonly fromIndex: number;
  readonly toIndex: number;
  readonly totalMs: number;
  readonly effectsMs: number;
  readonly compositeMs: number;
}

export interface MixedMemoryBenchmarkReport {
  readonly version: typeof MIXED_MEMORY_BENCHMARK_REPORT_VERSION;
  readonly passed: true;
  readonly strategy: MixedMemoryBenchmarkStrategy;
  readonly targetMiB: number;
  readonly rasterLayerMaximum: typeof LAYER_STACK_MAXIMUM;
  readonly textNodeMaximum: typeof VECTOR_TEXT_NODE_MAXIMUM;
  readonly rasterLayerCount: number;
  readonly textNodeCount: number;
  readonly textRunCount: number;
  readonly blockShadowTextCount: number;
  readonly singleShadowTextCount: number;
  readonly activeLayerIndex: number;
  readonly activeLayerId: number;
  readonly activeLayerBlank: true;
  readonly countedTotalMiB: number;
  readonly peakCountedTotalMiB: number;
  readonly elapsedMs: number;
  readonly gpuMemory: EngineGpuMemoryStats;
  readonly storageTileCounts: readonly number[];
  readonly setupSwitches: readonly MixedMemoryBenchmarkSwitchSample[];
  readonly canonicalReplayReady: true;
}

export interface MixedMemoryZoomProbe {
  readonly version: 1;
  readonly factors: readonly number[];
  readonly vectorRenderMs: readonly number[];
  readonly endToEndMs: readonly number[];
  readonly vectorRenderP50Ms: number;
  readonly vectorRenderP95Ms: number;
  readonly vectorRenderMaxMs: number;
  readonly endToEndP50Ms: number;
  readonly endToEndP95Ms: number;
  readonly endToEndMaxMs: number;
}

export interface MixedMemoryBenchmarkStudyReport extends MixedMemoryBenchmarkReport {
  readonly browserCanvasLogicalMiB: number;
  readonly vectorCpuKnownLogicalMiB: number;
  readonly knownLogicalWorkingSetMiB: number;
  readonly baselineZoomProbe: MixedMemoryZoomProbe;
  readonly zoomProbe: MixedMemoryZoomProbe;
  readonly zoomVectorP95SlowdownRatio: number;
  readonly zoomEndToEndP95SlowdownRatio: number;
}

function nextVisibleFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
}

async function waitForVectorRender(
  controller: MixedVectorTextController,
  previousRenderCount: number,
): Promise<ReturnType<MixedVectorTextController["getDiagnostics"]>> {
  for (let frame = 0; frame < 24; frame += 1) {
    await nextVisibleFrame();
    const diagnostics = controller.getDiagnostics();
    if (diagnostics.renderCount > previousRenderCount) return diagnostics;
  }
  throw new Error("Il testo non ha completato il ridisegno dello zoom.");
}

async function measureZoomProbe(
  engine: BrushEngine,
  controller: MixedVectorTextController,
): Promise<MixedMemoryZoomProbe> {
  controller.setAdaptiveZoomEnabled(false);
  try {
    const factors = [1.15, 1.15, 1.15, 1 / 1.15, 1 / 1.15, 1 / 1.15, 1.35, 1 / 1.35];
    const vectorRenderMs: number[] = [];
    const endToEndMs: number[] = [];
    engine.fitView();
    await settleVisibleScene(engine);
    for (const factor of factors) {
      const before = controller.getDiagnostics();
      const startedAt = performance.now();
      engine.zoomBy(factor);
      const rendered = await waitForVectorRender(controller, before.renderCount);
      await engine.waitForIdle();
      vectorRenderMs.push(rendered.lastRenderMs);
      endToEndMs.push(performance.now() - startedAt);
    }
    engine.fitView();
    await settleVisibleScene(engine);
    return {
      version: 1,
      factors,
      vectorRenderMs,
      endToEndMs,
      vectorRenderP50Ms: percentile(vectorRenderMs, 0.5),
      vectorRenderP95Ms: percentile(vectorRenderMs, 0.95),
      vectorRenderMaxMs: Math.max(...vectorRenderMs),
      endToEndP50Ms: percentile(endToEndMs, 0.5),
      endToEndP95Ms: percentile(endToEndMs, 0.95),
      endToEndMaxMs: Math.max(...endToEndMs),
    };
  } finally {
    controller.setAdaptiveZoomEnabled(true);
  }
}

export async function runMixedMemoryBenchmarkStudy(
  engine: BrushEngine,
  controller: MixedVectorTextController,
  targetMiB = MIXED_MEMORY_BENCHMARK_TARGET_MIB,
  onProgress?: (progress: MixedMemoryBenchmarkProgress) => void,
): Promise<MixedMemoryBenchmarkStudyReport> {
  const baselineZoomProbe = await measureZoomProbe(engine, controller);
  const setup = await runMixedMemoryBenchmark(engine, targetMiB, onProgress);
  const zoomProbe = await measureZoomProbe(engine, controller);
  const diagnostics = controller.getDiagnostics();
  const browserCanvasLogicalMiB =
    diagnostics.viewportCanvasLogicalMiB + diagnostics.singleShadowBrowserLogicalMiB;
  const vectorCpuKnownLogicalMiB =
    diagnostics.vectorFontLogicalMiB + diagnostics.blockShadowPathLogicalMiB;
  return {
    ...setup,
    browserCanvasLogicalMiB,
    vectorCpuKnownLogicalMiB,
    knownLogicalWorkingSetMiB:
      setup.countedTotalMiB + browserCanvasLogicalMiB + vectorCpuKnownLogicalMiB,
    baselineZoomProbe,
    zoomProbe,
    zoomVectorP95SlowdownRatio: baselineZoomProbe.vectorRenderP95Ms > 0
      ? zoomProbe.vectorRenderP95Ms / baselineZoomProbe.vectorRenderP95Ms
      : 0,
    zoomEndToEndP95SlowdownRatio: baselineZoomProbe.endToEndP95Ms > 0
      ? zoomProbe.endToEndP95Ms / baselineZoomProbe.endToEndP95Ms
      : 0,
  };
}

async function settleVisibleScene(engine: BrushEngine): Promise<void> {
  await nextVisibleFrame();
  await nextVisibleFrame();
  await engine.waitForIdle();
}

function compactSwitch(sample: LayerSwitchResult): MixedMemoryBenchmarkSwitchSample {
  return {
    fromIndex: sample.fromIndex,
    toIndex: sample.toIndex,
    totalMs: sample.totalMs,
    effectsMs: sample.effectsMs,
    compositeMs: sample.compositeMs,
  };
}

function textRunCount(items: NonNullable<ReturnType<BrushEngine["getMixedSceneSnapshot"]>>["items"]):
number {
  let count = 0;
  let insideTextRun = false;
  for (const item of items) {
    if (item.kind === "text") {
      if (!insideTextRun) {
        count += 1;
        insideTextRun = true;
      }
    } else {
      insideTextRun = false;
    }
  }
  return count;
}

function styleCounts(nodes: readonly Readonly<VectorTextNode>[]): {
  blockShadowTextCount: number;
  singleShadowTextCount: number;
} {
  return {
    blockShadowTextCount: nodes.filter((node) => node.blockShadowEnabled).length,
    singleShadowTextCount: nodes.filter((node) => node.singleShadowEnabled).length,
  };
}

export async function runMixedMemoryBenchmark(
  engine: BrushEngine,
  targetMiB = MIXED_MEMORY_BENCHMARK_TARGET_MIB,
  onProgress?: (progress: MixedMemoryBenchmarkProgress) => void,
): Promise<MixedMemoryBenchmarkReport> {
  if (
    targetMiB !== MIXED_MEMORY_BENCHMARK_TARGET_MIB
    && targetMiB !== MIXED_MEMORY_BENCHMARK_STAGED_TARGET_MIB
  ) {
    throw new Error(
      `Target scenario misto non supportato: ${targetMiB} MiB.`,
    );
  }
  const stagedProfile =
    targetMiB === MIXED_MEMORY_BENCHMARK_STAGED_TARGET_MIB;
  const interleavedStorageTileCount = stagedProfile
    ? MIXED_MEMORY_BENCHMARK_STAGED_INTERLEAVED_TILE_COUNT
    : LAYER_STORAGE_TILE_COUNT;
  const rgba16fColdTileMiB = layerStorageTileMemoryMiB(1, 8);
  const initial = engine.getStats();
  const initialScene = engine.getMixedSceneSnapshot();
  if (
    initial.layerFormat !== "rgba16float"
    || initial.layerCount !== 1
    || initial.activeLayerIndex !== 0
    || initial.layers[0]?.hasContent
    || !initialScene
    || initialScene.items.filter((item) => item.kind === "text").length !== 1
  ) {
    throw new Error(
      "Lo scenario misto richiede una pagina nuova RGBA16F con un raster vuoto e il testo iniziale.",
    );
  }
  if (engine.getHistoryState().busy) {
    throw new Error("La cronologia è occupata: ricarica la pagina e riprova.");
  }

  const startedAt = performance.now();
  const setupSwitches: MixedMemoryBenchmarkSwitchSample[] = [];
  const storageTileCounts: number[] = [];
  let peakCountedTotalMiB = initial.gpuMemory.countedTotalMiB;
  const sampleMemory = () => {
    peakCountedTotalMiB = Math.max(
      peakCountedTotalMiB,
      engine.getStats().gpuMemory.countedTotalMiB,
    );
  };
  const publishProgress = (phase: MixedMemoryBenchmarkProgress["phase"]) => {
    const stats = engine.getStats();
    const scene = engine.getMixedSceneSnapshot();
    onProgress?.({
      phase,
      rasterLayerCount: stats.layerCount,
      textNodeCount: scene?.items.filter((item) => item.kind === "text").length ?? 0,
      countedTotalMiB: stats.gpuMemory.countedTotalMiB,
      peakCountedTotalMiB,
      targetMiB,
    });
  };
  const sampler = window.setInterval(sampleMemory, 5);

  try {
    const firstText = initialScene.items.find((item) => item.kind === "text");
    if (!firstText || firstText.kind !== "text") {
      throw new Error("Testo iniziale dello scenario misto non trovato.");
    }
    engine.updateVectorTextNode(firstText.textNode.id, {
      ...mixedMemoryBenchmarkTextSeed(0, engine.layerSize),
      name: "Stress testo 01",
    });
    await settleVisibleScene(engine);

    // Otto testi separati da raster producono otto cache viewport distinte.
    // Il profilo canonico conserva 256 tile per raster; quello staged da
    // 600 MiB ne usa 128 per non superare il budget prima che testi e ombre
    // siano completamente residenti.
    for (
      let textIndex = 1;
      textIndex < MIXED_MEMORY_BENCHMARK_INTERLEAVED_TEXT_RUNS;
      textIndex += 1
    ) {
      publishProgress("raster");
      await seedActiveLayerMemoryStress(
        engine,
        textIndex - 1,
        interleavedStorageTileCount,
      );
      storageTileCounts.push(interleavedStorageTileCount);
      const switchResult = await engine.addLayer(`Stress raster ${textIndex + 1}`);
      setupSwitches.push(compactSwitch(switchResult));
      await engine.addVectorTextNode(
        mixedMemoryBenchmarkTextSeed(textIndex, engine.layerSize),
        `Stress testo ${String(textIndex + 1).padStart(2, "0")}`,
      );
      await settleVisibleScene(engine);
      sampleMemory();
      publishProgress("text");
    }

    // Porta anche l'ottavo raster in cold storage e lascia un nono raster
    // vuoto e attivo, pronto a ricevere la traccia canonica.
    await seedActiveLayerMemoryStress(
      engine,
      MIXED_MEMORY_BENCHMARK_INTERLEAVED_TEXT_RUNS - 1,
      interleavedStorageTileCount,
    );
    storageTileCounts.push(interleavedStorageTileCount);
    const blankSwitch = await engine.addLayer(
      `Stress raster ${MIXED_MEMORY_BENCHMARK_INTERLEAVED_TEXT_RUNS + 1}`,
    );
    setupSwitches.push(compactSwitch(blankSwitch));
    await settleVisibleScene(engine);
    sampleMemory();

    const remainingTextSeeds = Array.from(
      {
        length:
          VECTOR_TEXT_NODE_MAXIMUM - MIXED_MEMORY_BENCHMARK_INTERLEAVED_TEXT_RUNS,
      },
      (_, offset) => {
        const index = offset + MIXED_MEMORY_BENCHMARK_INTERLEAVED_TEXT_RUNS;
        return {
          seed: mixedMemoryBenchmarkTextSeed(index, engine.layerSize),
          name: `Stress testo ${String(index + 1).padStart(2, "0")}`,
        };
      },
    );
    const remainingTextBatches = stagedProfile
      ? Array.from(
        {
          length: Math.ceil(
            remainingTextSeeds.length
            / MIXED_MEMORY_BENCHMARK_STAGED_TEXT_BATCH_SIZE,
          ),
        },
        (_, batchIndex) => remainingTextSeeds.slice(
          batchIndex * MIXED_MEMORY_BENCHMARK_STAGED_TEXT_BATCH_SIZE,
          (batchIndex + 1) * MIXED_MEMORY_BENCHMARK_STAGED_TEXT_BATCH_SIZE,
        ),
      )
      : [remainingTextSeeds];
    for (const batch of remainingTextBatches) {
      await engine.addVectorTextNodesBatch(batch);
      await settleVisibleScene(engine);
      sampleMemory();
      publishProgress("text");
    }

    // La batch seleziona l'ultimo testo; riattiva il raster vuoto affinché il
    // pennello e il replay umano restino disponibili.
    let stats = engine.getStats();
    await engine.setActiveMixedSceneItem(`raster:${stats.activeLayerId}`);
    await settleVisibleScene(engine);

    // I tile cold RGBA16F valgono 0,5 MiB a 4096² e 0,125 MiB a 2048².
    // L'ultimo raster usa solo i tile necessari per avvicinarsi al target, poi
    // un nuovo raster vuoto diventa il target del replay. L'eventuale overshoot
    // resta limitato alle piccole superfici derivate del marker e alle cache
    // viewport già conteggiate.
    while ((stats = engine.getStats()).gpuMemory.countedTotalMiB < targetMiB) {
      if (stats.layerCount >= LAYER_STACK_MAXIMUM) {
        throw new Error(
          `Raggiunto il limite di ${LAYER_STACK_MAXIMUM} raster a `
          + `${stats.gpuMemory.countedTotalMiB.toFixed(1)} MiB.`,
        );
      }
      const remainingMiB = targetMiB - stats.gpuMemory.countedTotalMiB;
      const storageTileCount = Math.max(
        1,
        Math.min(
          LAYER_STORAGE_TILE_COUNT,
          Math.ceil(remainingMiB / rgba16fColdTileMiB),
        ),
      );
      publishProgress("raster");
      await seedActiveLayerMemoryStress(
        engine,
        storageTileCounts.length,
        storageTileCount,
      );
      storageTileCounts.push(storageTileCount);
      const switchResult = await engine.addLayer(
        `Stress raster ${stats.layerCount + 1}`,
      );
      setupSwitches.push(compactSwitch(switchResult));
      await settleVisibleScene(engine);
      sampleMemory();
    }

    await engine.waitForIdle();
    sampleMemory();
    const final = engine.getStats();
    const finalScene = engine.getMixedSceneSnapshot();
    if (!finalScene) {
      throw new Error("Scena mista assente dopo la preparazione.");
    }
    const textNodes = finalScene.items
      .filter((item) => item.kind === "text")
      .map((item) => item.textNode);
    const activeLayer = final.layers[final.activeLayerIndex];
    if (
      textNodes.length !== VECTOR_TEXT_NODE_MAXIMUM
      || activeLayer?.hasContent
      || finalScene.selectedKey !== `raster:${final.activeLayerId}`
      || final.gpuMemory.countedTotalMiB < targetMiB
    ) {
      throw new Error("Lo scenario finale non rispetta il contratto 64 testi / raster vuoto.");
    }
    const history = engine.getHistoryState();
    if (history.busy || history.inconsistent) {
      throw new Error("Il motore non è rimasto modificabile dopo la preparazione.");
    }
    const counts = styleCounts(textNodes);
    publishProgress("complete");
    return {
      version: MIXED_MEMORY_BENCHMARK_REPORT_VERSION,
      passed: true,
      strategy: mixedMemoryBenchmarkStrategy(targetMiB),
      targetMiB,
      rasterLayerMaximum: LAYER_STACK_MAXIMUM,
      textNodeMaximum: VECTOR_TEXT_NODE_MAXIMUM,
      rasterLayerCount: final.layerCount,
      textNodeCount: textNodes.length,
      textRunCount: textRunCount(finalScene.items),
      ...counts,
      activeLayerIndex: final.activeLayerIndex,
      activeLayerId: final.activeLayerId,
      activeLayerBlank: true,
      countedTotalMiB: final.gpuMemory.countedTotalMiB,
      peakCountedTotalMiB,
      elapsedMs: performance.now() - startedAt,
      gpuMemory: final.gpuMemory,
      storageTileCounts,
      setupSwitches,
      canonicalReplayReady: true,
    };
  } finally {
    window.clearInterval(sampler);
  }
}
