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
  hot: "caldo",
  cold: "freddo",
  compressed: "compresso",
  empty: "vuoto",
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

  constructor(options: GpuMemoryPanelControllerOptions) {
    this.options = options;
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

  setOpen(open: boolean): void {
    this.panelOpen = open;
    this.panel.hidden = !open;
    this.toggle.setAttribute("aria-expanded", String(open));
    this.toggle.title = open
      ? "Chiudi dettaglio memoria GPU"
      : "Apri dettaglio memoria GPU";
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
      ? "BLOCCATO: nessun checkpoint full su cui consolidare"
      : telemetry.totalBytes > telemetry.budgetBytes
        ? "sopra budget, eviction in attesa di manutenzione idle"
        : "entro budget";
    output.textContent =
      `History ${formatMemoryMiB(telemetry.totalBytes / (1024 * 1024))} su budget `
      + `${formatMemoryMiB(telemetry.budgetBytes / (1024 * 1024))} `
      + `(base ${formatMemoryMiB(telemetry.baseBudgetBytes / (1024 * 1024))} − effetti `
      + `${formatMemoryMiB(telemetry.effectsWorkingSetBytes / (1024 * 1024))}) · ${causa}. `
      + `Checkpoint ${telemetry.checkpointCount} (${telemetry.fullCheckpointCount} full, `
      + `${telemetry.deltaCheckpointCount} delta) per `
      + `${formatMemoryMiB(telemetry.checkpointBytes / (1024 * 1024))}; catture `
      + `${telemetry.capturesCommitted}/${telemetry.capturesStarted} committed, `
      + `${telemetry.capturesFailed} fallite, ${telemetry.capturesDiscardedStale} stale, `
      + `${telemetry.capturesRefusedForBudget} rifiutate per budget; `
      + `${telemetry.checkpointCacheEvictions} checkpoint cache liberati. `
      + `Eviction ${telemetry.budgetEvictions} esclusivamente da budget; pavimento `
      + `${telemetry.floorCursor}, azioni ${state.actionCount}, profondità Undo ${depth}. `
      + `Locale ${formatMemoryMiB(locale.committedBytes / (1024 * 1024))} · `
      + `${locale.backend} · ${locale.ready ? "pronto" : "avvio"}/`
      + `${locale.writable ? "scrivibile" : "sola memoria"} · ${locale.busy} · `
      + `soglia spill ${formatMemoryMiB(telemetry.spillHighWaterBytes / (1024 * 1024))} · `
      + `${locale.storedOnlyPayloads}/${locale.storedPayloads} payload `
      + `solo locali in ${locale.segments} segmenti (${locale.storedActions} azioni); `
      + `spill ${locale.spillsCommitted} committed/${locale.spillFailures} falliti, `
      + `hydrate ${locale.hydrationsCompleted}/${locale.hydrationFailures}. `
      + `Compattazioni Redo ${telemetry.redoCompactionsCompleted} complete, `
      + `${telemetry.redoCompactionsAborted} interrotte.`
      + (locale.lastError ? ` Storage: ${locale.lastError}.` : "")
      + (lastFailure
        ? ` ⚠ ULTIMO GUASTO: ${lastFailure.operation} su `
          + `«${lastFailure.action}» al cursore `
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
      `Registrata ${formatMemoryMiB(misuratoMiB)} corrente, picco `
      + `${formatMemoryMiB(piccoMiB)}, in ${misura.textureCount} texture e `
      + `${misura.bufferCount} buffer (${misura.createdCount} create, `
      + `${misura.destroyedCount} distrutte, ${misura.collectedCount} raccolte dal GC). `
      + `Somma esatta dei descrittori, non una stima. `
      + (misura.unmeasurableCount > 0
        ? `${misura.unmeasurableCount} risorse con formato non misurabile `
          + `(${misura.unmeasurableFormats.join(", ")}) sono ESCLUSE dal totale. `
        : "")
      + `Il modello diagnostico non sommato dichiara `
      + `${formatMemoryMiB(declaredMiB)}: scarto `
      + `${scartoMiB >= 0 ? "+" : "−"}${formatMemoryMiB(Math.abs(scartoMiB))}`
      + (oltreTolleranza
        ? " · ATTENZIONE: è disallineata solo la stima memoria, non l’ordine dei layer."
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
        + `${livello.active ? " · attivo" : ""}${livello.visible ? "" : " · nascosto"}`;
      const valore = this.document.createElement("dd");
      valore.textContent = formatMemoryMiB(livello.totalMiB);
      valore.title = livello.compressedCpuMiB > 0
        ? "La RAM compressa pesa sul limite di processo ma non sul totale GPU."
        : "Somma delle risorse GPU vive di questo livello.";
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
          `${formatMemoryMiB(livello.compressedCpuMiB)} RAM compressa`
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
      : `${formatMemoryMiB(misuratoMiB)} · partizione incoerente`;
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
      nome.textContent = `${voce.category} · ${voce.count} risors${voce.count === 1 ? "a" : "e"}`;
      const valore = this.document.createElement("dd");
      valore.textContent = `${formatMemoryMiB(voce.bytes / (1024 * 1024))} correnti · `
        + `${formatMemoryMiB(voce.peakBytes / (1024 * 1024))} picco`;
      valore.title = "Il picco è storico per questa categoria e non va sommato ai picchi delle altre righe.";
      riga.append(nome, valore);
      riga.classList.toggle("memory-zero", voce.bytes < 0.05 * 1024 * 1024);
      return riga;
    }));
  }
  
  update(stats: EngineStats): void {
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
    historyLabel.textContent = `Cronologia raster · GPU · ${historyPageCount} `
      + `${historyPageCount === 1 ? "pagina" : "pagine"} · `
      + `usati ${formatMemoryMiB(stats.gpuMemory.historyGpuUsedMiB)}`;
    historyLabel.title =
      "La cifra a destra è la memoria GPU realmente riservata in pagine; "
      + "«usati» è il payload logico attualmente residente nelle pagine.";
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
      `Raw livelli · effettivo · ${hotLayerCount} hot + `
      + `${coldTileCount}/${inactiveTileCapacity} tile cold`
      + (compressedLayerCount > 0
        ? ` + ${compressedLayerCount} compresso (${formatMemoryMiB(compressedRawMiB)} raw)`
        : "");
    this.element<HTMLElement>("gpuMemoryLayerStudyBboxLabel").textContent =
      `Confronto · bbox ${storageStudy.tileSizePx} · `
      + `${inactiveBboxTileCount}/${inactiveTileCapacity} livelli cold`;
    tileOutput.textContent = formatStudy(storageStudy.actualRawMiB, actualSavingsMiB);
    bboxOutput.textContent = formatStudy(
      storageStudy.projectedAlignedBboxRawMiB,
      storageStudy.alignedBboxSavingsMiB,
    );
    tileOutput.title =
      "Memoria logica WebGPU realmente allocata per texture raw hot e cold; "
      + "i livelli compressi sono RAM CPU separata ed esclusa dal totale GPU. "
      + "Il risparmio è rispetto a un full-canvas per ogni livello.";
    bboxOutput.title =
      "Confronto teorico: attivo e Riferimento full-canvas, più bbox allineato "
      + "degli altri livelli inattivi; non è memoria allocata.";
  
    const scratchExtents: string[] = [];
    if (stats.gpuMemory.effectsScratchStrokeExtent > 0) {
      const strokeScratchOwner =
        stats.rasterStrokeStyle.enabled && stats.rasterStrokeStyle.width > 0
          ? "Traccia"
          : "Compositore";
      scratchExtents.push(
        `${strokeScratchOwner} ${stats.gpuMemory.effectsScratchStrokeExtent}²`,
      );
    }
    if (stats.gpuMemory.effectsScratchBevelExtent > 0) {
      scratchExtents.push(`Smusso ${stats.gpuMemory.effectsScratchBevelExtent}²`);
    }
    if (stats.gpuMemory.effectsScratchOuterShadowExtent > 0) {
      scratchExtents.push(
        `Ombra esterna ${stats.gpuMemory.effectsScratchOuterShadowExtent}²`,
      );
    }
    if (stats.gpuMemory.effectsScratchInnerShadowExtent > 0) {
      scratchExtents.push(
        `Ombra interna ${stats.gpuMemory.effectsScratchInnerShadowExtent}²`,
      );
    }
    this.element<HTMLElement>("gpuMemoryEffectsScratchLabel").textContent = scratchExtents.length > 0
      ? `Effetti · pool scratch · ${scratchExtents.join(" / ")}`
      : "Effetti · pool scratch";
  
    const fieldBoundsLabel = (
      bounds: Readonly<{ x: number; y: number; width: number; height: number }>,
    ): string => `${bounds.width}×${bounds.height} @ ${bounds.x},${bounds.y}`;
    const allocation = stats.gpuMemory.rasterBevelFieldAllocationBounds;
    const valid = stats.gpuMemory.rasterBevelFieldValidBounds;
    let bevelHeightLabel =
      `Smusso · heightfield R32F · documento ${this.options.documentWidth}×${this.options.documentHeight}`;
    if (stats.gpuMemory.rasterBevelFieldBounded) {
      if (!valid) {
        bevelHeightLabel = allocation
          ? `Smusso · heightfield R32F · vuoto · alloc ${fieldBoundsLabel(allocation)}`
          : "Smusso · heightfield R32F · vuoto";
      } else if (
        allocation
        && allocation.x === valid.x
        && allocation.y === valid.y
        && allocation.width === valid.width
        && allocation.height === valid.height
      ) {
        bevelHeightLabel = `Smusso · heightfield R32F · bbox ${fieldBoundsLabel(valid)}`;
      } else {
        bevelHeightLabel = `Smusso · heightfield R32F · valido ${fieldBoundsLabel(valid)}`
          + (allocation ? ` · alloc ${fieldBoundsLabel(allocation)}` : "");
      }
    }
    this.element<HTMLElement>("gpuMemoryBevelHeightLabel").textContent = bevelHeightLabel;
  
    // Il numero che l'utente legge e' quello **misurato**: la somma esatta dei
    // descrittori di ogni texture e buffer vivi. Il modello dichiarato resta
    // sotto, come ripartizione semantica, ma non e' piu' la fonte del totale:
    // era il punto in cui la stima poteva mentire senza che si vedesse.
    const declaredMiB = stats.gpuMemory.countedTotalMiB;
    const totalMiB = this.options.isEngineReady()
      ? stats.gpuMemory.registeredCurrentMiB
      : declaredMiB;
    const peakMiB = this.options.isEngineReady()
      ? stats.gpuMemory.registeredPeakMiB
      : declaredMiB;
    const formattedTotal = formatMemoryMiB(totalMiB);
    this.element<HTMLElement>("gpuMemoryTotal").textContent = formattedTotal;
    this.element<HTMLElement>("gpuMemoryPeak").textContent = `picco ${formatMemoryMiB(peakMiB)}`;
    this.element<HTMLElement>("gpuMemoryCompact").textContent = formattedTotal;
    this.options.memoryStat.textContent = formattedTotal;
  
    this.renderLayerMemoryBreakdown(stats.gpuMemory.layers, this.options.isEngineReady());
  
    // Governor in sola osservazione: la riga esiste per calibrare il tetto, non
    // per giustificare un rifiuto. Finche' dice "osserva", nessuna allocazione e'
    // stata impedita.
    const governor = stats.gpuMemory;
    this.element<HTMLElement>("gpuMemoryGovernor").textContent = this.options.isEngineReady()
      ? `Governor · osserva · zona ${governor.governorZone} · `
        + `${formatMemoryMiB(governor.governorUsedMiB)} su `
        + `${formatMemoryMiB(governor.governorCeilingMiB)} utilizzabili `
        + `(tetto ${formatMemoryMiB(governor.governorHardCapMiB)}) · `
        + `margine ${formatMemoryMiB(governor.governorHeadroomMiB)} · `
        + `liberabile ${formatMemoryMiB(governor.governorReclaimableMiB)} · `
        + `promesso ${formatMemoryMiB(governor.governorReservedMiB)}`
      : "Governor · in attesa del device";
  
    if (!this.options.isEngineReady()) {
      this.previousTotalMiB = null;
      this.delta.hidden = true;
      return;
    }
  
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
    this.updateGpuMemoryAudit(declaredMiB, this.options.engine.measuredGpuMemory());
    this.previousTotalMiB = totalMiB;
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
    if (!result) throw new Error(`Elemento memoria #${id} non trovato.`);
    return result as T;
  }
}
