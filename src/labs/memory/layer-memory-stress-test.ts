import type { BrushEngine } from "../../brush-engine";
import type { EngineGpuMemoryStats } from "../../engine-stats";
import type { LayerSwitchResult } from "../../engine-types";
import { LAYER_STACK_MAXIMUM } from "../../layer-stack";
import { seedActiveLayerMemoryStress } from "../engine-lab-operations";

export const LAYER_MEMORY_STRESS_TARGET_MIB = 1000;
export const LAYER_MEMORY_STRESS_REPORT_VERSION = 1;

export interface LayerMemoryStressProgress {
  phase: "seed" | "add" | "complete";
  layerCount: number;
  countedTotalMiB: number;
  peakCountedTotalMiB: number;
  targetMiB: number;
}

export interface LayerMemoryStressSwitchSample {
  fromIndex: number;
  toIndex: number;
  totalMs: number;
  effectsMs: number;
  compositeMs: number;
}

export interface LayerMemoryStressReport {
  version: typeof LAYER_MEMORY_STRESS_REPORT_VERSION;
  passed: true;
  targetMiB: number;
  layerMaximum: typeof LAYER_STACK_MAXIMUM;
  layerCount: number;
  activeLayerIndex: number;
  countedTotalMiB: number;
  peakCountedTotalMiB: number;
  elapsedMs: number;
  gpuMemory: EngineGpuMemoryStats;
  coldTileCounts: number[];
  conservativeTileCounts: number[];
  setupSwitches: LayerMemoryStressSwitchSample[];
  manualSwitchReady: true;
}

function nextVisibleFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function compactSwitch(sample: LayerSwitchResult): LayerMemoryStressSwitchSample {
  return {
    fromIndex: sample.fromIndex,
    toIndex: sample.toIndex,
    totalMs: sample.totalMs,
    effectsMs: sample.effectsMs,
    compositeMs: sample.compositeMs,
  };
}

export async function runLayerMemoryStressTest(
  engine: BrushEngine,
  targetMiB = LAYER_MEMORY_STRESS_TARGET_MIB,
  onProgress?: (progress: LayerMemoryStressProgress) => void,
): Promise<LayerMemoryStressReport> {
  const initial = engine.getStats();
  if (
    initial.layerFormat !== "rgba16float"
    || initial.layerCount !== 1
    || initial.activeLayerIndex !== 0
    || initial.layers[0]?.hasContent
  ) {
    throw new Error(
      "Lo stress memoria richiede una pagina nuova in RGBA16F con un solo livello vuoto.",
    );
  }
  if (engine.getHistoryState().busy) {
    throw new Error("La cronologia è occupata: ricarica la pagina e riprova.");
  }

  const startedAt = performance.now();
  const setupSwitches: LayerMemoryStressSwitchSample[] = [];
  let peakCountedTotalMiB = initial.gpuMemory.countedTotalMiB;
  const sampleMemory = () => {
    peakCountedTotalMiB = Math.max(
      peakCountedTotalMiB,
      engine.getStats().gpuMemory.countedTotalMiB,
    );
  };
  const sampler = window.setInterval(sampleMemory, 5);

  try {
    while (true) {
      let stats = engine.getStats();
      onProgress?.({
        phase: "seed",
        layerCount: stats.layerCount,
        countedTotalMiB: stats.gpuMemory.countedTotalMiB,
        peakCountedTotalMiB,
        targetMiB,
      });
      await seedActiveLayerMemoryStress(engine, stats.layerCount - 1);
      sampleMemory();
      await nextVisibleFrame();

      stats = engine.getStats();
      if (stats.gpuMemory.countedTotalMiB >= targetMiB) {
        break;
      }
      if (stats.layerCount >= LAYER_STACK_MAXIMUM) {
        throw new Error(
          `Raggiunto il limite di ${LAYER_STACK_MAXIMUM} livelli a `
          + `${stats.gpuMemory.countedTotalMiB.toFixed(1)} MiB, sotto il target.`,
        );
      }

      onProgress?.({
        phase: "add",
        layerCount: stats.layerCount,
        countedTotalMiB: stats.gpuMemory.countedTotalMiB,
        peakCountedTotalMiB,
        targetMiB,
      });
      const switchResult = await engine.addLayer(`Stress ${stats.layerCount + 1}`);
      setupSwitches.push(compactSwitch(switchResult));
      sampleMemory();
      await nextVisibleFrame();
    }

    await engine.waitForIdle();
    sampleMemory();
    const final = engine.getStats();
    const inactiveLayers = final.layers.filter((_, index) => index !== final.activeLayerIndex);
    const invalidInactiveLayer = inactiveLayers.find(
      (layer) => layer.coldTileCount !== 256 || layer.conservativeTileCount !== 256,
    );
    if (invalidInactiveLayer) {
      throw new Error(
        `Il livello ${invalidInactiveLayer.id} non conserva tutti i 256 tile reali.`,
      );
    }
    if (final.layers[final.activeLayerIndex]?.conservativeTileCount !== 256) {
      throw new Error("Il livello attivo non è pronto per il successivo cambio manuale.");
    }
    if (final.gpuMemory.countedTotalMiB < targetMiB) {
      throw new Error(
        `Target non raggiunto: ${final.gpuMemory.countedTotalMiB.toFixed(1)} MiB.`,
      );
    }
    const history = engine.getHistoryState();
    if (history.busy || history.inconsistent) {
      throw new Error("Il motore non è rimasto modificabile dopo la preparazione.");
    }

    onProgress?.({
      phase: "complete",
      layerCount: final.layerCount,
      countedTotalMiB: final.gpuMemory.countedTotalMiB,
      peakCountedTotalMiB,
      targetMiB,
    });
    return {
      version: LAYER_MEMORY_STRESS_REPORT_VERSION,
      passed: true,
      targetMiB,
      layerMaximum: LAYER_STACK_MAXIMUM,
      layerCount: final.layerCount,
      activeLayerIndex: final.activeLayerIndex,
      countedTotalMiB: final.gpuMemory.countedTotalMiB,
      peakCountedTotalMiB,
      elapsedMs: performance.now() - startedAt,
      gpuMemory: final.gpuMemory,
      coldTileCounts: final.layers.map((layer) => layer.coldTileCount),
      conservativeTileCounts: final.layers.map((layer) => layer.conservativeTileCount),
      setupSwitches,
      manualSwitchReady: true,
    };
  } finally {
    window.clearInterval(sampler);
  }
}
