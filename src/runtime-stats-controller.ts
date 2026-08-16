import type { EngineStats } from "./engine-stats.ts";
import type { BrushSettings } from "./engine-types.ts";
import { formatInteger, formatMemoryMiB } from "./ui-number-format.ts";

export interface RuntimeStatsEnginePort {
  getStats(): EngineStats;
}

export interface RuntimeStatsElements {
  readonly renderingModeMemoryHint: HTMLElement;
  readonly fps: HTMLElement;
  readonly cpu: HTMLElement;
  readonly stamps: HTMLElement;
  readonly avoidedDraws: HTMLElement;
  readonly gpu: HTMLElement;
}

export interface RuntimeStatsControllerOptions {
  readonly engine: RuntimeStatsEnginePort;
  readonly browser: Window;
  readonly document: Document;
  readonly elements: RuntimeStatsElements;
  readonly isEngineReady: () => boolean;
  readonly getActiveCanvasTool: () => string;
  readonly getActiveBrushTool: () => string;
  readonly getBrushBlendMode: () => BrushSettings["blendMode"];
  readonly renderLayers: (stats: EngineStats) => void;
  readonly updateGpuMemory: (stats: EngineStats) => void;
  readonly recordDiagnostic: (name: string, detail: string | null, error: unknown) => void;
  readonly onPollingError: (error: unknown) => void;
}

/** Owns the visible runtime telemetry and its low-frequency polling lifecycle. */
export class RuntimeStatsController {
  private readonly options: RuntimeStatsControllerOptions;
  private pollingTimer: number | null = null;
  private pollingFaultReported = false;

  constructor(options: RuntimeStatsControllerOptions) {
    this.options = options;
  }

  update(stats: EngineStats): void {
    this.options.renderLayers(stats);
    this.updateRenderingModeMemoryHint(stats);
    const { elements } = this.options;
    elements.fps.textContent = String(stats.fps);
    elements.cpu.textContent = `${stats.lastCpuFrameMs.toFixed(2)} ms`;
    elements.stamps.textContent = formatInteger(stats.totalBaseStamps);
    elements.avoidedDraws.textContent = formatInteger(stats.avoidedLogicalDraws);
    this.options.updateGpuMemory(stats);
    elements.gpu.textContent = stats.gpuLabel;
  }

  start(): void {
    if (this.pollingTimer !== null) return;
    this.pollingTimer = this.options.browser.setInterval(() => this.refresh(), 1_000);
  }

  dispose(): void {
    if (this.pollingTimer === null) return;
    this.options.browser.clearInterval(this.pollingTimer);
    this.pollingTimer = null;
  }

  private refresh(): void {
    if (!this.options.isEngineReady() || this.options.document.hidden) return;
    try {
      this.update(this.options.engine.getStats());
    } catch (error) {
      if (this.pollingFaultReported) return;
      this.pollingFaultReported = true;
      this.options.recordDiagnostic("runtime-stats-poll", null, error);
      this.options.onPollingError(error);
    }
  }

  private updateRenderingModeMemoryHint(stats: EngineStats): void {
    const hint = this.options.elements.renderingModeMemoryHint;
    if (this.options.getActiveCanvasTool() === "fill") {
      const referenceMemory = stats.fillReferenceLayerMiB > 0
        ? ` · riferimento hot ${formatMemoryMiB(stats.fillReferenceLayerMiB)}`
        : stats.referenceLayerId !== null
          ? " · riferimento sul raster attivo"
          : " · sorgente raster attivo";
      hint.textContent =
        `Riempimento · scratch residente ${formatMemoryMiB(stats.gpuMemory.fillRendererMiB)}`
        + referenceMemory;
      return;
    }
    if (this.options.getActiveBrushTool() === "blend") {
      hint.textContent =
        `Blend dry · scratch residente ${formatMemoryMiB(stats.gpuMemory.blendRendererMiB)}`;
      return;
    }
    if (this.options.getActiveBrushTool() === "erase") {
      hint.textContent =
        `Gomma · tip Brush Studio · totale motore ${formatMemoryMiB(stats.gpuMemory.countedTotalMiB)}`;
      return;
    }
    const mode = this.options.getBrushBlendMode();
    const label = mode === "uniformed-glaze"
      ? "Uniformed Glaze"
      : mode === "intense-blending"
        ? "Intense Blending"
        : "Light Glaze";
    const modelHint = mode === "intense-blending"
      ? " · stamp fisici source-over"
      : "";
    hint.textContent =
      `${label} · memoria GPU dedicata residente ${formatMemoryMiB(stats.gpuMemory.lightGlazeMiB)}`
      + ` · totale motore ${formatMemoryMiB(stats.gpuMemory.countedTotalMiB)}`
      + modelHint;
  }
}
