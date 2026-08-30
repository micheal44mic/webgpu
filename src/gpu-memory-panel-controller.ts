import type { BrushEngine } from "./brush-engine";
import type { EngineGpuMemoryStats, EngineStats } from "./engine-stats";
import { GPU_MEMORY_AUDIT_TOLERANCE_BYTES } from "./gpu-memory-audit.ts";
import { GPU_MEMORY_CATEGORY_ORDER } from "./gpu-resource-registry.ts";
import type { HistoryFailure } from "./history-controls-controller";
import { formatMemoryMiB, memoryNumberFormatter } from "./ui-number-format.ts";

type GpuMemoryEnginePort = Pick<
  BrushEngine,
  | "getStats"
  | "getHistoryMaintenanceTelemetry"
  | "getHistoryState"
  | "measuredGpuMemory"
>;

type NumericKeyOf<T> = {
  [Key in keyof T]-?: T[Key] extends number ? Key : never;
}[keyof T];

const GPU_MEMORY_ROWS: ReadonlyArray<
  readonly [string, NumericKeyOf<EngineStats["gpuMemory"]>]
> = [
  ["gpuMemoryLayerBase", "layerBaseMiB"],
  ["gpuMemoryLayerCold", "layerColdMiB"],
  ["gpuMemoryActiveClippingMask", "activeClippingMaskMiB"],
  ["gpuMemoryLayerCompressed", "layerCompressedCpuMiB"],
  ["gpuMemoryCountedWithCompressedCpu", "countedGpuPlusCompressedCpuMiB"],
  ["gpuMemoryLayerHydration", "layerHydrationMiB"],
  ["gpuMemoryLayerMips", "layerMipChainMiB"],
  ["gpuMemoryLayerBakes", "layerBakeMiB"],
  ["gpuMemoryLayerComposite", "layerCompositeMiB"],
  ["gpuMemoryGrain", "grainTextureMiB"],
  ["gpuMemoryShape", "shapeTextureMiB"],
  ["gpuMemoryPaintBuffers", "paintBuffersMiB"],
  ["gpuMemoryVectorText", "vectorTextPresentationMiB"],
  ["gpuMemoryRasterImage", "rasterImageMiB"],
  ["gpuMemoryPresentation", "presentationCacheMiB"],
  ["gpuMemoryLayerThumbnail", "layerThumbnailMiB"],
  ["gpuMemoryStrokeStyled", "rasterStrokeStyledMiB"],
  ["gpuMemoryStrokeCoverage", "rasterStrokeCoverageMiB"],
  ["gpuMemoryStrokeControl", "rasterStrokeMaskAndControlMiB"],
  ["gpuMemoryEffectsScratch", "effectsScratchPoolMiB"],
  ["gpuMemoryEffectsScratchPeak", "effectsScratchPoolPeakMiB"],
  ["gpuMemoryOuterShadowMatte", "rasterOuterShadowMatteMiB"],
  ["gpuMemoryOuterShadowControl", "rasterOuterShadowControlMiB"],
  ["gpuMemoryInnerShadowMatte", "rasterInnerShadowMatteMiB"],
  ["gpuMemoryInnerShadowControl", "rasterInnerShadowControlMiB"],
  ["gpuMemoryBevelHeight", "rasterBevelHeightMiB"],
  ["gpuMemoryBevelControl", "rasterBevelLutAndControlMiB"],
  ["gpuMemoryBlend", "blendRendererMiB"],
  ["gpuMemoryFill", "fillRendererMiB"],
  ["gpuMemorySelection", "selectionRendererMiB"],
  ["gpuMemoryLightGlaze", "lightGlazeMiB"],
  ["gpuMemoryStabilizationTail", "stabilizationTailMiB"],
  ["gpuMemoryThicknessTail", "thicknessTailMiB"],
  ["gpuMemoryHistory", "historyGpuMiB"],
];

const LAYER_STATE_LABEL: Record<string, string> = {
  hot: "hot",
  cold: "cold",
  compressed: "compressed",
  empty: "empty",
};

export interface GpuMemoryPanelControllerOptions {
  readonly engine: GpuMemoryEnginePort;
  readonly browser: Window & { readonly AbortController: typeof AbortController };
  readonly root: HTMLElement;
  readonly memoryStat: HTMLElement;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly isEngineReady: () => boolean;
  readonly getLastHistoryFailure: () => HistoryFailure | null;
}

/** Owns GPU-memory panel state, rendering, history telemetry and cleanup. */
export class GpuMemoryPanelController {
  private readonly options: GpuMemoryPanelControllerOptions;
  private readonly abortController: AbortController;
  private readonly panel: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly chevron: HTMLElement;
  private readonly delta: HTMLElement;
  private panelOpen = false;
  private statsDirty = false;
  private previousTotalMiB: number | null = null;
  private deltaTimer: number | null = null;
  private documentWidth: number;
  private documentHeight: number;

  constructor(options: GpuMemoryPanelControllerOptions) {
    this.options = options;
    this.documentWidth = options.documentWidth;
    this.documentHeight = options.documentHeight;
    this.abortController = new options.browser.AbortController();
    this.panel = this.element("gpuMemoryPanel");
    this.toggle = this.element("gpuMemoryToggle");
    this.closeButton = this.element("gpuMemoryClose");
    this.chevron = this.element("gpuMemoryChevron");
    this.delta = this.element("gpuMemoryDelta");
    const signal = this.abortController.signal;
    this.toggle.addEventListener("click", () => this.setOpen(!this.panelOpen), { signal });
    this.closeButton.addEventListener("click", () => {
      this.setOpen(false);
      this.toggle.focus();
    }, { signal });
    this.setOpen(false);
  }

  get isOpen(): boolean {
    return this.panelOpen;
  }

  setDocumentDimensions(width: number, height: number): void {
    this.documentWidth = width;
    this.documentHeight = height;
  }

  setOpen(open: boolean): void {
    this.panelOpen = open;
    this.options.root.dataset.panelState = open ? "expanded" : "collapsed";
    this.panel.hidden = !open;
    this.toggle.setAttribute("aria-expanded", String(open));
    this.toggle.title = open
      ? "Close GPU memory details"
      : "Open GPU memory details";
    this.chevron.textContent = open ? "▾" : "▴";
    if (open && this.statsDirty) {
      this.statsDirty = false;
      this.update(this.options.engine.getStats());
    }
  }

  private updateHistoryDiagnostics(): void {
    const output = this.element<HTMLElement>("gpuMemoryHistoryDiagnostics");
    if (this.panel.hidden) return;
    const telemetry = this.options.engine.getHistoryMaintenanceTelemetry();
    const state = this.options.engine.getHistoryState();
    const locale = telemetry.localStorage;
    const lastFailure = this.options.getLastHistoryFailure();
    const depth = state.cursor - telemetry.floorCursor;
    const causa = telemetry.budgetCheckpointBlocked
      ? "BLOCKED: no full checkpoint is available for consolidation"
      : telemetry.totalBytes > telemetry.budgetBytes
        ? "over budget; eviction is waiting for idle maintenance"
        : "within budget";
    output.textContent =
      `History ${formatMemoryMiB(telemetry.totalBytes / (1024 * 1024))} of `
      + `${formatMemoryMiB(telemetry.budgetBytes / (1024 * 1024))} `
      + `(base ${formatMemoryMiB(telemetry.baseBudgetBytes / (1024 * 1024))} − effects `
      + `${formatMemoryMiB(telemetry.effectsWorkingSetBytes / (1024 * 1024))}) · ${causa}. `
      + `Checkpoint ${telemetry.checkpointCount} (${telemetry.fullCheckpointCount} full, `
      + `${telemetry.deltaCheckpointCount} delta) using `
      + `${formatMemoryMiB(telemetry.checkpointBytes / (1024 * 1024))}; captures `
      + `${telemetry.capturesCommitted}/${telemetry.capturesStarted} committed, `
      + `${telemetry.capturesFailed} failed, ${telemetry.capturesDiscardedStale} stale, `
      + `${telemetry.capturesRefusedForBudget} refused for budget; `
      + `${telemetry.checkpointCacheEvictions} checkpoint cache entries released. `
      + `Evictions ${telemetry.budgetEvictions}, all budget-driven; floor `
      + `${telemetry.floorCursor}, ${state.actionCount} actions, Undo depth ${depth}. `
      + `Local ${formatMemoryMiB(locale.committedBytes / (1024 * 1024))} · `
      + `${locale.backend} · ${locale.ready ? "ready" : "starting"}/`
      + `${locale.writable ? "writable" : "memory only"} · ${locale.busy} · `
      + `spill threshold ${formatMemoryMiB(telemetry.spillHighWaterBytes / (1024 * 1024))} · `
      + `${locale.storedOnlyPayloads}/${locale.storedPayloads} payload `
      + `stored only locally in ${locale.segments} segments (${locale.storedActions} actions); `
      + `spill ${locale.spillsCommitted} committed/${locale.spillFailures} failed, `
      + `hydrate ${locale.hydrationsCompleted}/${locale.hydrationFailures}. `
      + `Redo compactions ${telemetry.redoCompactionsCompleted} completed, `
      + `${telemetry.redoCompactionsAborted} aborted.`
      + (locale.lastError ? ` Storage: ${locale.lastError}.` : "")
      + (lastFailure
        ? ` ⚠ LAST FAILURE: ${lastFailure.operation} on `
          + `“${lastFailure.action}” at cursor `
          + `${lastFailure.cursor} → ${lastFailure.message}`
        : "");
  }
  
  /**
   * Dichiarato contro reale. Il pannello e' un modello e puo' derivare: qui il
   * confronto e' automatico, cosi' una taglia di documento nuova o una risorsa
   * non contabilizzata si vedono subito invece di dover essere rimisurate.
   */
  private updateGpuMemoryAudit(
    declaredMiB: number,
    misura: ReturnType<BrushEngine["measuredGpuMemory"]>,
  ): void {
    const output = this.element<HTMLElement>("gpuMemoryAudit");
    if (this.panel.hidden) return;
    const misuratoMiB = misura.currentBytes / (1024 * 1024);
    const piccoMiB = misura.peakBytes / (1024 * 1024);
    const scartoMiB = misuratoMiB - declaredMiB;
    const oltreTolleranza =
      Math.abs(scartoMiB) * 1024 * 1024 > GPU_MEMORY_AUDIT_TOLERANCE_BYTES;
    this.renderMeasuredBreakdown(misura);
    output.textContent =
      `Registered ${formatMemoryMiB(misuratoMiB)} current, `
      + `${formatMemoryMiB(piccoMiB)} peak, across ${misura.textureCount} textures and `
      + `${misura.bufferCount} buffers (${misura.createdCount} created, `
      + `${misura.destroyedCount} destroyed, ${misura.collectedCount} collected by GC). `
      + `Exact descriptor sum, not an estimate. `
      + (misura.unmeasurableCount > 0
        ? `${misura.unmeasurableCount} resources with an unmeasurable format `
          + `(${misura.unmeasurableFormats.join(", ")}) are EXCLUDED from the total. `
        : "")
      + `The separate diagnostic model reports `
      + `${formatMemoryMiB(declaredMiB)}: delta `
      + `${scartoMiB >= 0 ? "+" : "−"}${formatMemoryMiB(Math.abs(scartoMiB))}`
      + (oltreTolleranza
        ? " · WARNING: only the memory estimate is out of sync, not the layer order."
        : ".");
    output.classList.toggle(
      "memory-audit-warning",
      oltreTolleranza || misura.unmeasurableCount > 0,
    );
  }
  
  /**
   * Peso di ogni singolo livello, in ordine di consumo.
   *
   * Le categorie sopra dicono quanto pesano *i livelli*; questa dice **quale**, ed
   * e' la domanda che ci si fa davvero quando la memoria sale. L'ordine e' per
   * peso decrescente come il resto del pannello, ma l'indice di documento resta
   * scritto in ogni riga: senza, un livello che scala posizione sembrerebbe un
   * livello diverso.
   */
  private renderLayerMemoryBreakdown(
    livelli: EngineGpuMemoryStats["layers"],
    inizializzato: boolean,
  ): void {
    const lista = this.element<HTMLElement>("gpuLayerBreakdown");
    const totale = livelli.reduce((somma, livello) => somma + livello.totalMiB, 0);
    this.element<HTMLElement>("gpuLayerMemoryTotal").textContent = inizializzato
      ? formatMemoryMiB(totale)
      : "—";
    if (!inizializzato || livelli.length === 0) {
      lista.replaceChildren();
      return;
    }
  
    const ordinati = [...livelli].sort((sinistra, destra) =>
      destra.totalMiB - sinistra.totalMiB || sinistra.index - destra.index
    );
    lista.replaceChildren(...ordinati.map((livello) => {
      const riga = this.document.createElement("div");
      riga.dataset.memoryRow = "";
      riga.dataset.layerMemoryId = String(livello.id);
      riga.classList.add("gpu-layer-row");
      const nome = this.document.createElement("dt");
      const stato = LAYER_STATE_LABEL[livello.state] ?? livello.state;
      nome.textContent = `${livello.index + 1}. ${livello.name} · ${stato}`
        + `${livello.active ? " · active" : ""}${livello.visible ? "" : " · hidden"}`;
      const valore = this.document.createElement("dd");
      valore.textContent = formatMemoryMiB(livello.totalMiB);
      valore.title = livello.compressedCpuMiB > 0
        ? "Compressed RAM counts toward the process limit, but not the GPU total."
        : "Sum of this layer's live GPU resources.";
      riga.append(nome, valore);
  
      // Le componenti si mostrano solo quando esistono: una riga che elenca tre
      // zeri nasconde l'unico numero che conta. Vanno su una riga propria perche'
      // il nome del livello lo scrive l'utente e puo' essere lungo quanto vuole.
      const parti: string[] = [];
      if (livello.hotMiB > 0) parti.push(`${formatMemoryMiB(livello.hotMiB)} texture`);
      if (livello.mipMiB > 0) parti.push(`${formatMemoryMiB(livello.mipMiB)} mip`);
      if (livello.coldMiB > 0) parti.push(`${formatMemoryMiB(livello.coldMiB)} tile`);
      if (livello.compressedCpuMiB > 0) {
        const rapporto = livello.compressedRawMiB / livello.compressedCpuMiB;
        parti.push(
          `${formatMemoryMiB(livello.compressedCpuMiB)} compressed RAM`
          + (rapporto > 1 ? ` (${rapporto.toFixed(1)}:1)` : ""),
        );
      }
      if (parti.length > 0) {
        const scomposizione = this.document.createElement("dd");
        scomposizione.className = "gpu-layer-parts";
        scomposizione.textContent = parti.join(" + ");
        riga.append(scomposizione);
      }
      riga.classList.toggle("memory-zero", livello.totalMiB < 0.05);
      return riga;
    }));
  }
  
  /**
   * Ripartizione misurata. Le categorie **partizionano** il registro: la loro
   * somma e' il totale per costruzione, non per manutenzione. Se un giorno non lo
   * fosse piu' sarebbe un difetto del registro, non un numero da riallineare a
   * mano, quindi lo si dichiara invece di nasconderlo.
   */
  private renderMeasuredBreakdown(
    misura: ReturnType<BrushEngine["measuredGpuMemory"]>,
  ): void {
    const lista = this.element<HTMLElement>("gpuMeasuredBreakdown");
    const sommaCategorie = misura.categories.reduce((totale, voce) => totale + voce.bytes, 0);
    const partizioneIntegra = sommaCategorie === misura.currentBytes;
    const misuratoMiB = misura.currentBytes / (1024 * 1024);
    this.element<HTMLElement>("gpuMeasuredTotal").textContent = partizioneIntegra
      ? formatMemoryMiB(misuratoMiB)
      : `${formatMemoryMiB(misuratoMiB)} · inconsistent partition`;
    this.element<HTMLElement>("gpuMeasuredPeak").textContent =
      formatMemoryMiB(misura.peakBytes / (1024 * 1024));
  
    const categoryByName = new Map(misura.categories.map((entry) => [entry.category, entry]));
    const extraCategories = misura.categories
      .map((entry) => entry.category)
      .filter((category) => !(GPU_MEMORY_CATEGORY_ORDER as readonly string[]).includes(category))
      .sort((left, right) => left.localeCompare(right));
    // Ordine per consumo, dal piu' grande al piu' piccolo, ricalcolato a ogni
    // aggiornamento: un pannello che vuole dire "cosa sta mangiando la memoria
    // adesso" deve mettere in cima cio' che la sta mangiando, non seguire un
    // elenco fisso in cui la riga che conta puo' finire settima. A parita' di
    // byte correnti decide il picco, poi il nome, cosi' le righe a zero non si
    // rimescolano fra loro a ogni frame.
    const righe = [...GPU_MEMORY_CATEGORY_ORDER, ...extraCategories]
      .map((category) =>
        categoryByName.get(category) ?? { category, bytes: 0, peakBytes: 0, count: 0 }
      )
      .sort((sinistra, destra) =>
        destra.bytes - sinistra.bytes
        || destra.peakBytes - sinistra.peakBytes
        || sinistra.category.localeCompare(destra.category)
      );
    lista.replaceChildren(...righe.map((voce) => {
      const riga = this.document.createElement("div");
      riga.dataset.memoryRow = "";
      riga.dataset.measuredCategory = voce.category;
      const nome = this.document.createElement("dt");
      nome.textContent = `${voce.category} · ${voce.count} resource${voce.count === 1 ? "" : "s"}`;
      const valore = this.document.createElement("dd");
      valore.textContent = `${formatMemoryMiB(voce.bytes / (1024 * 1024))} current · `
        + `${formatMemoryMiB(voce.peakBytes / (1024 * 1024))} peak`;
      valore.title = "The peak is historical for this category and must not be added to peaks in other rows.";
      riga.append(nome, valore);
      riga.classList.toggle("memory-zero", voce.bytes < 0.05 * 1024 * 1024);
      return riga;
    }));
  }
  
  update(stats: EngineStats): void {
    // Keep the collapsed monitor live without paying for the detailed panel.
    // `update` already receives the engine's regular stats notifications (and
    // the existing one-second fallback poll), so no extra timer is needed.
    const declaredMiB = stats.gpuMemory.countedTotalMiB;
    const engineReady = this.options.isEngineReady();
    const totalMiB = engineReady
      ? stats.gpuMemory.registeredCurrentMiB
      : declaredMiB;
    const peakMiB = engineReady
      ? stats.gpuMemory.registeredPeakMiB
      : declaredMiB;
    const formattedTotal = formatMemoryMiB(totalMiB);
    this.element<HTMLElement>("gpuMemoryTotal").textContent = formattedTotal;
    this.element<HTMLElement>("gpuMemoryPeak").textContent = `peak ${formatMemoryMiB(peakMiB)}`;
    this.element<HTMLElement>("gpuMemoryCompact").textContent = formattedTotal;

    if (!engineReady) {
      this.previousTotalMiB = null;
      this.delta.hidden = true;
    } else {
      if (this.previousTotalMiB !== null) {
        const deltaMiB = totalMiB - this.previousTotalMiB;
        if (Math.abs(deltaMiB) >= 0.05) {
          this.delta.textContent = (deltaMiB > 0 ? "+" : "−")
            + memoryNumberFormatter.format(Math.abs(deltaMiB))
            + " MiB";
          this.delta.classList.toggle("decrease", deltaMiB < 0);
          this.delta.hidden = false;
          if (this.deltaTimer !== null) {
            this.options.browser.clearTimeout(this.deltaTimer);
          }
          this.deltaTimer = this.options.browser.setTimeout(() => {
            this.delta.hidden = true;
            this.deltaTimer = null;
          }, 3500);
        }
      }
      this.previousTotalMiB = totalMiB;
    }

    // Stesso motivo di renderLayerList: ~46 getElementById piu la riduzione sui
    // tile dello storage study, ad ogni frame, su un pannello chiuso.
    if (!this.panelOpen) {
      this.statsDirty = true;
      return;
    }
    for (const [id, key] of GPU_MEMORY_ROWS) {
      const output = this.element<HTMLElement>(id);
      const value = stats.gpuMemory[key];
      output.textContent = formatMemoryMiB(value);
      output.parentElement?.classList.toggle("memory-zero", value < 0.05);
    }
    const historyPageCount = stats.gpuMemory.historyGpuPageCount;
    const historyLabel = this.element<HTMLElement>("gpuMemoryHistoryLabel");
    historyLabel.textContent = `Raster history · GPU · ${historyPageCount} `
      + `${historyPageCount === 1 ? "page" : "pages"} · `
      + `${formatMemoryMiB(stats.gpuMemory.historyGpuUsedMiB)} used`;
    historyLabel.title =
      "The value on the right is the GPU memory actually reserved in pages; "
      + "“used” is the logical payload currently resident in those pages.";
    this.updateHistoryDiagnostics();
  
    const storageStudy = stats.layerStorageStudy;
    const inactiveLayers = storageStudy.layers.filter((layer) => !layer.active);
    const coldEligibleLayers = inactiveLayers.filter((layer) => !layer.reference);
    const coldTileCount = storageStudy.layers.reduce(
      (total, layer) => total + layer.coldTileCount,
      0,
    );
    const compressedLayerCount = storageStudy.layers.filter(
      (layer) => layer.compressed,
    ).length;
    const compressedRawMiB = storageStudy.layers.reduce(
      (total, layer) => total + layer.compressedRawMiB,
      0,
    );
    const inactiveBboxTileCount = coldEligibleLayers.reduce(
      (total, layer) => total + layer.alignedBboxTileCount,
      0,
    );
    const inactiveTileCapacity = coldEligibleLayers.length * storageStudy.tileCount;
    const hotLayerCount = storageStudy.layers.filter((layer) => layer.hotAllocated).length;
    const actualSavingsMiB = Math.max(
      0,
      storageStudy.eagerFullRawMiB - storageStudy.actualRawMiB,
    );
    const formatStudy = (projectedMiB: number, savingsMiB: number) =>
      `${formatMemoryMiB(projectedMiB)} · −${formatMemoryMiB(savingsMiB)}`;
    const tileOutput = this.element<HTMLElement>("gpuMemoryLayerStudyTiles");
    const bboxOutput = this.element<HTMLElement>("gpuMemoryLayerStudyBbox");
    this.element<HTMLElement>("gpuMemoryLayerStudyTilesLabel").textContent =
      `Raw layers · actual · ${hotLayerCount} hot + `
      + `${coldTileCount}/${inactiveTileCapacity} tile cold`
      + (compressedLayerCount > 0
        ? ` + ${compressedLayerCount} compressed (${formatMemoryMiB(compressedRawMiB)} raw)`
        : "");
    this.element<HTMLElement>("gpuMemoryLayerStudyBboxLabel").textContent =
      `Comparison · bbox ${storageStudy.tileSizePx} · `
      + `${inactiveBboxTileCount}/${inactiveTileCapacity} cold layers`;
    tileOutput.textContent = formatStudy(storageStudy.actualRawMiB, actualSavingsMiB);
    bboxOutput.textContent = formatStudy(
      storageStudy.projectedAlignedBboxRawMiB,
      storageStudy.alignedBboxSavingsMiB,
    );
    tileOutput.title =
      "Logical WebGPU memory actually allocated for hot and cold raw textures; "
      + "compressed layers use separate CPU RAM and are excluded from the GPU total. "
      + "Savings are measured against one full canvas per layer.";
    bboxOutput.title =
      "Theoretical comparison: full-canvas active and Reference layers, plus an aligned "
      + "bounding box for the other inactive layers; this is not allocated memory.";
  
    const scratchExtents: string[] = [];
    if (stats.gpuMemory.effectsScratchStrokeExtent > 0) {
      const strokeScratchOwner =
        stats.rasterStrokeStyle.enabled && stats.rasterStrokeStyle.width > 0
          ? "Stroke"
          : "Compositor";
      scratchExtents.push(
        `${strokeScratchOwner} ${stats.gpuMemory.effectsScratchStrokeExtent}²`,
      );
    }
    if (stats.gpuMemory.effectsScratchBevelExtent > 0) {
      scratchExtents.push(`Bevel ${stats.gpuMemory.effectsScratchBevelExtent}²`);
    }
    if (stats.gpuMemory.effectsScratchOuterShadowExtent > 0) {
      scratchExtents.push(
        `Outer Shadow ${stats.gpuMemory.effectsScratchOuterShadowExtent}²`,
      );
    }
    if (stats.gpuMemory.effectsScratchInnerShadowExtent > 0) {
      scratchExtents.push(
        `Inner Shadow ${stats.gpuMemory.effectsScratchInnerShadowExtent}²`,
      );
    }
    this.element<HTMLElement>("gpuMemoryEffectsScratchLabel").textContent = scratchExtents.length > 0
      ? `Effects · scratch pool · ${scratchExtents.join(" / ")}`
      : "Effects · scratch pool";
  
    const fieldBoundsLabel = (
      bounds: Readonly<{ x: number; y: number; width: number; height: number }>,
    ): string => `${bounds.width}×${bounds.height} @ ${bounds.x},${bounds.y}`;
    const allocation = stats.gpuMemory.rasterBevelFieldAllocationBounds;
    const valid = stats.gpuMemory.rasterBevelFieldValidBounds;
    let bevelHeightLabel =
      `Bevel · R32F heightfield · document ${this.documentWidth}×${this.documentHeight}`;
    if (stats.gpuMemory.rasterBevelFieldBounded) {
      if (!valid) {
        bevelHeightLabel = allocation
          ? `Bevel · R32F heightfield · empty · alloc ${fieldBoundsLabel(allocation)}`
          : "Bevel · R32F heightfield · empty";
      } else if (
        allocation
        && allocation.x === valid.x
        && allocation.y === valid.y
        && allocation.width === valid.width
        && allocation.height === valid.height
      ) {
        bevelHeightLabel = `Bevel · R32F heightfield · bbox ${fieldBoundsLabel(valid)}`;
      } else {
        bevelHeightLabel = `Bevel · R32F heightfield · valid ${fieldBoundsLabel(valid)}`
          + (allocation ? ` · alloc ${fieldBoundsLabel(allocation)}` : "");
      }
    }
    this.element<HTMLElement>("gpuMemoryBevelHeightLabel").textContent = bevelHeightLabel;
  
    // Il numero che l'utente legge e' quello **misurato**: la somma esatta dei
    // descrittori di ogni texture e buffer vivi. Il modello dichiarato resta
    // sotto, come ripartizione semantica, ma non e' piu' la fonte del totale:
    // era il punto in cui la stima poteva mentire senza che si vedesse.
    this.options.memoryStat.textContent = formattedTotal;
  
    this.renderLayerMemoryBreakdown(stats.gpuMemory.layers, this.options.isEngineReady());
  
    // Governor in sola osservazione: la riga esiste per calibrare il tetto, non
    // per giustificare un rifiuto. Finche' dice "osserva", nessuna allocazione e'
    // stata impedita.
    const governor = stats.gpuMemory;
    this.element<HTMLElement>("gpuMemoryGovernor").textContent = this.options.isEngineReady()
      ? `Governor · observe · zone ${governor.governorZone} · `
        + `${formatMemoryMiB(governor.governorUsedMiB)} of `
        + `${formatMemoryMiB(governor.governorCeilingMiB)} usable `
        + `(cap ${formatMemoryMiB(governor.governorHardCapMiB)}) · `
        + `headroom ${formatMemoryMiB(governor.governorHeadroomMiB)} · `
        + `reclaimable ${formatMemoryMiB(governor.governorReclaimableMiB)} · `
        + `reserved ${formatMemoryMiB(governor.governorReservedMiB)}`
      : "Governor · waiting for device";
  
    if (!engineReady) {
      return;
    }
    this.updateGpuMemoryAudit(declaredMiB, this.options.engine.measuredGpuMemory());
  }

  dispose(): void {
    this.abortController.abort();
    if (this.deltaTimer !== null) {
      this.options.browser.clearTimeout(this.deltaTimer);
      this.deltaTimer = null;
    }
  }

  private get document(): Document {
    return this.options.root.ownerDocument;
  }

  private element<T extends HTMLElement>(id: string): T {
    const result = this.options.root.querySelector<HTMLElement>(`#${id}`);
    if (!result) throw new Error(`Memory element #${id} was not found.`);
    return result as T;
  }
}
