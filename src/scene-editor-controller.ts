import type { BrushEngine, LayerDuplicateResult } from "./brush-engine";
import type { EngineStats } from "./engine-stats";
import type { HistoryState } from "./engine-types";
import {
  LAYER_BLEND_MODE_LABELS,
  type LayerBlendMode,
} from "./layer-blend-modes";
import { mobileLayerMergeCompletionMatches } from "./mobile-layer-multi-selection";
import type { MixedVectorTextController } from "./mixed-vector-text-controller";
import {
  rasterIndexForSceneLayerKey,
  selectedSceneLayerProperties,
  type SceneLayerKey,
} from "./scene-layer-read-model";

export type SceneEditorEnginePort = Pick<
  BrushEngine,
  | "addClippingMaskLayer"
  | "addLayer"
  | "deleteLayer"
  | "deleteRasterImageNode"
  | "deleteVectorSvgNode"
  | "deleteVectorTextNode"
  | "duplicateSelectedLayer"
  | "getHistoryState"
  | "getMixedSceneReorderTargets"
  | "getMixedSceneSnapshot"
  | "getStats"
  | "moveMixedSceneItem"
  | "setActiveLayer"
  | "setActiveMixedSceneItem"
  | "setLayerBlendMode"
  | "setLayerClipping"
  | "setLayerOpacity"
  | "setLayerReference"
  | "setLayerVisibility"
  | "setRasterImageNodeOpacity"
  | "setRasterImageNodeVisibility"
  | "setVectorSvgNodeOpacity"
  | "setVectorSvgNodeVisibility"
  | "setVectorTextNodeOpacity"
  | "setVectorTextNodeVisibility"
  | "waitForIdle"
>;

export type SceneEditorVectorPort = Pick<
  MixedVectorTextController,
  "mergeSceneItems" | "syncScene"
>;

export interface SceneEditorBrowser {
  requestAnimationFrame(callback: FrameRequestCallback): number;
}

export interface SceneEditorElements {
  readonly app: HTMLElement;
  readonly loadingOverlay: HTMLElement;
  readonly loadingLabel: HTMLParagraphElement;
  readonly result: HTMLParagraphElement;
}

export interface SceneEditorControllerOptions {
  readonly engine: SceneEditorEnginePort;
  readonly browser: SceneEditorBrowser;
  readonly elements: SceneEditorElements;
  readonly getVectorController: () => SceneEditorVectorPort | null;
  readonly isInteractionLocked: () => boolean;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onHistoryState: (state: HistoryState) => void;
  readonly requestLayersRefresh: () => void;
  readonly renderLayers: (stats: EngineStats) => void;
  readonly syncActiveRasterControls: () => void;
  readonly syncToolSettings: () => void;
  readonly onStats: (stats: EngineStats) => void;
  readonly recordDiagnostic: (
    name: string,
    detail: string | null,
    error: unknown,
  ) => void;
}

interface FinishOptions {
  readonly loading?: boolean;
  readonly syncActiveRasterControls?: boolean;
}

/**
 * Owns scene mutations and their UI transaction boundary. Public mutations use
 * stable scene keys; raster indices are resolved only immediately before an
 * engine call, so a delayed UI action cannot silently target another layer.
 */
export class SceneEditorController {
  private busy = false;
  private disposed = false;

  constructor(private readonly options: SceneEditorControllerOptions) {}

  get isBusy(): boolean {
    return this.busy;
  }

  getReorderTargets(key: SceneLayerKey) {
    return this.options.engine.getMixedSceneReorderTargets(key);
  }

  rasterIndexForKey(key: SceneLayerKey): number {
    return rasterIndexForSceneLayerKey(this.options.engine.getStats(), key);
  }

  mergeCapabilityError(
    orderedKeys: readonly SceneLayerKey[],
    stats = this.options.engine.getStats(),
  ): string | null {
    if (
      stats.mixedScene?.items.some(
        (item) => orderedKeys.includes(item.key) && item.kind === "image",
      )
    ) {
      return "Questa versione non può ancora unire livelli immagine.";
    }
    return this.options.getVectorController() === null
      ? "Unione non disponibile: il controller dei livelli non è ancora pronto."
      : null;
  }

  async moveLayer(key: SceneLayerKey, targetTopFirstSlot: number): Promise<boolean> {
    this.beginOrThrow("Layer move canceled.");
    try {
      return await this.options.engine.moveMixedSceneItem(key, targetTopFirstSlot);
    } finally {
      this.finish();
    }
  }

  async mergeLayers(
    orderedKeys: readonly SceneLayerKey[],
  ): Promise<{ readonly itemCount: number }> {
    const vector = this.options.getVectorController();
    if (!vector) {
      throw new Error("Unione non disponibile: il controller dei livelli non è pronto.");
    }
    const beforeSnapshot = this.options.engine.getMixedSceneSnapshot();
    const beforeKeys = beforeSnapshot?.items.map((item) => item.key) ?? [];
    this.beginOrThrow("Unione non disponibile durante un'altra operazione.");
    try {
      if (!(await this.showLoading("Unione livelli…"))) {
        throw new Error("Scene editor disposed.");
      }
      const result = await vector.mergeSceneItems(orderedKeys);
      const mergedSnapshot = this.options.engine.getMixedSceneSnapshot();
      const outputKey = `raster:${result.layerId}` as SceneLayerKey;
      if (
        !mergedSnapshot
        || !mobileLayerMergeCompletionMatches(
          beforeKeys,
          orderedKeys,
          mergedSnapshot.items.map((item) => item.key),
          outputKey,
        )
      ) {
        throw new Error(
          "Il merge è terminato, ma la scena pubblicata non contiene il rimpiazzo atteso.",
        );
      }
      await this.options.engine.waitForIdle();
      return { itemCount: result.itemCount };
    } finally {
      this.finish({ loading: true, syncActiveRasterControls: true });
    }
  }

  async duplicateSelectedLayer(): Promise<LayerDuplicateResult> {
    this.beginOrThrow("Duplicazione non disponibile durante un'altra operazione.");
    let syncActiveRasterControls = false;
    try {
      if (!(await this.showLoading("Duplicazione livello…"))) {
        throw new Error("Scene editor disposed.");
      }
      const result = await this.options.engine.duplicateSelectedLayer();
      await this.options.engine.waitForIdle();
      syncActiveRasterControls = result.kind === "raster";
      return result;
    } finally {
      this.finish({ loading: true, syncActiveRasterControls });
    }
  }

  selectLayer(key: SceneLayerKey): void {
    void this.selectLayerTransaction(key);
  }

  setLayerVisibility(key: SceneLayerKey, visible: boolean): void {
    void this.setLayerVisibilityTransaction(key, visible);
  }

  setLayerOpacity(key: SceneLayerKey, opacity: number): void {
    void this.setLayerOpacityTransaction(key, opacity);
  }

  setRasterBlendMode(key: SceneLayerKey, blendMode: LayerBlendMode): void {
    void this.setRasterBlendModeTransaction(key, blendMode);
  }

  setRasterClipping(key: SceneLayerKey, enabled: boolean): void {
    void this.setRasterClippingTransaction(key, enabled);
  }

  setRasterReference(key: SceneLayerKey, enabled: boolean): void {
    void this.setRasterReferenceTransaction(key, enabled);
  }

  async deleteLayer(key: SceneLayerKey): Promise<void> {
    const stats = this.options.engine.getStats();
    const target = selectedSceneLayerProperties(stats, false, key);
    if (!target) throw new Error("Livello non trovato.");
    this.beginOrThrow("Eliminazione non disponibile durante un'altra operazione.");
    try {
      if (!(await this.showLoading("Eliminazione livello…"))) return;
      if (target.kind === "raster" && target.rasterIndex !== null) {
        await this.options.engine.deleteLayer(target.rasterIndex);
      } else if (target.kind === "text" && target.semanticId !== null) {
        await this.options.engine.deleteVectorTextNode(target.semanticId);
      } else if (target.kind === "svg" && target.semanticId !== null) {
        await this.options.engine.deleteVectorSvgNode(target.semanticId);
      } else if (target.kind === "image" && target.semanticId !== null) {
        await this.options.engine.deleteRasterImageNode(target.semanticId);
      } else {
        throw new Error("Livello non trovato.");
      }
      await this.options.engine.waitForIdle();
      this.options.elements.result.textContent = `${target.name} eliminato.`;
    } finally {
      this.finish({ loading: true, syncActiveRasterControls: true });
    }
  }

  addRasterLayer(): void {
    void this.addRasterLayerTransaction();
  }

  addClippingMaskLayer(): void {
    void this.addClippingMaskLayerTransaction();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.busy = false;
    this.hideLoading();
  }

  private begin(): boolean {
    if (this.disposed || this.busy || this.options.isInteractionLocked()) return false;
    this.busy = true;
    this.options.onBusyChange(true);
    this.options.requestLayersRefresh();
    return true;
  }

  private beginOrThrow(message: string): void {
    if (!this.begin()) throw new Error(message);
  }

  private finish(options: FinishOptions = {}): void {
    if (options.loading) this.hideLoading();
    this.busy = false;
    if (this.disposed) return;
    this.options.onHistoryState(this.options.engine.getHistoryState());
    if (options.syncActiveRasterControls) this.options.syncActiveRasterControls();
    this.options.onBusyChange(false);
    this.options.requestLayersRefresh();
    const stats = this.options.engine.getStats();
    this.options.onStats(stats);
    this.options.syncToolSettings();
  }

  private async showLoading(message: string): Promise<boolean> {
    if (this.disposed) return false;
    const { app, loadingLabel, loadingOverlay } = this.options.elements;
    loadingLabel.textContent = message;
    loadingOverlay.hidden = false;
    app.setAttribute("aria-busy", "true");
    await this.nextAnimationFrame();
    if (this.disposed) return false;
    await this.nextAnimationFrame();
    return !this.disposed;
  }

  private hideLoading(): void {
    const { app, loadingOverlay } = this.options.elements;
    loadingOverlay.hidden = true;
    app.removeAttribute("aria-busy");
  }

  private nextAnimationFrame(): Promise<number> {
    return new Promise((resolve) => this.options.browser.requestAnimationFrame(resolve));
  }

  private async selectLayerTransaction(key: SceneLayerKey): Promise<void> {
    const stats = this.options.engine.getStats();
    const target = selectedSceneLayerProperties(stats, false, key);
    if (!target) {
      this.options.elements.result.textContent = "Livello non trovato.";
      return;
    }
    const scene = stats.mixedScene;
    if (!scene) {
      if (target.rasterIndex === stats.activeLayerIndex) {
        this.options.elements.result.textContent = "Livello già attivo.";
        return;
      }
      if (target.rasterIndex === null || !this.begin()) return;
      try {
        if (!(await this.showLoading("Caricamento livello…"))) return;
        const result = await this.options.engine.setActiveLayer(target.rasterIndex);
        this.options.syncActiveRasterControls();
        await this.options.engine.waitForIdle();
        this.options.elements.result.textContent = result
          ? `Livello ${result.toIndex + 1} attivo in ${result.totalMs.toFixed(0)} ms`
            + ` (campi effetti ${result.effectsMs.toFixed(0)} ms).`
          : "Livello già attivo.";
      } catch (error) {
        this.options.recordDiagnostic(
          "raster-layer-selection-failed",
          JSON.stringify({ key, index: target.rasterIndex }),
          error,
        );
        this.options.elements.result.textContent = error instanceof Error
          ? error.message
          : "Cambio livello non riuscito.";
      } finally {
        this.finish({ loading: true });
      }
      return;
    }

    if (scene.selectedKey === key) {
      this.options.elements.result.textContent = "Livello già selezionato.";
      return;
    }
    const item = scene.items.find((candidate) => candidate.key === key);
    if (!item || !this.begin()) return;
    try {
      if (
        !(await this.showLoading(
          item.kind === "raster"
            ? "Caricamento raster…"
            : item.kind === "image"
              ? "Preparazione immagine WebGPU…"
              : "Preparazione vettore…",
        ))
      ) return;
      const result = await this.options.engine.setActiveMixedSceneItem(key);
      if (item.kind === "raster") this.options.syncActiveRasterControls();
      await this.options.engine.waitForIdle();
      const snapshot = this.options.engine.getMixedSceneSnapshot();
      if (snapshot) this.options.getVectorController()?.syncScene(snapshot);
      this.options.elements.result.textContent = item.kind === "text"
        ? "Testo selezionato: pennello sospeso; il raster di lavoro resta caldo."
        : item.kind === "svg"
          ? "SVG selezionato: usa Trasforma oppure modifica colori ed effetti."
          : item.kind === "image"
            ? "Immagine selezionata: scegli Trasforma, poi Applica o Annulla."
            : result
              ? `Raster ${result.toIndex + 1} attivo in ${result.totalMs.toFixed(0)} ms.`
              : "Raster selezionato: pennello attivo.";
    } catch (error) {
      this.options.recordDiagnostic(
        "mixed-scene-selection-failed",
        JSON.stringify({ key, kind: item.kind }),
        error,
      );
      this.options.elements.result.textContent = error instanceof Error
        ? error.message
        : "Selezione del livello non riuscita.";
    } finally {
      this.finish({ loading: true });
    }
  }

  private async setLayerVisibilityTransaction(
    key: SceneLayerKey,
    visible: boolean,
  ): Promise<void> {
    const target = selectedSceneLayerProperties(
      this.options.engine.getStats(),
      false,
      key,
    );
    if (!target || !this.begin()) return;
    try {
      if (target.kind === "raster" && target.rasterIndex !== null) {
        await this.options.engine.setLayerVisibility(target.rasterIndex, visible);
        this.options.elements.result.textContent = visible
          ? "Livello mostrato."
          : "Livello nascosto.";
      } else if (target.kind === "text" && target.semanticId !== null) {
        await this.options.engine.setVectorTextNodeVisibility(target.semanticId, visible);
        this.options.elements.result.textContent = visible ? "Testo mostrato." : "Testo nascosto.";
      } else if (target.kind === "svg" && target.semanticId !== null) {
        await this.options.engine.setVectorSvgNodeVisibility(target.semanticId, visible);
        this.options.elements.result.textContent = visible ? "SVG mostrato." : "SVG nascosto.";
      } else if (target.kind === "image" && target.semanticId !== null) {
        await this.options.engine.setRasterImageNodeVisibility(target.semanticId, visible);
        this.options.elements.result.textContent = visible
          ? "Immagine mostrata."
          : "Immagine nascosta.";
      }
    } catch (error) {
      this.options.elements.result.textContent = error instanceof Error
        ? error.message
        : `Visibilità ${target.name} non aggiornata.`;
    } finally {
      this.finish();
    }
  }

  private async setLayerOpacityTransaction(
    key: SceneLayerKey,
    opacity: number,
  ): Promise<void> {
    const target = selectedSceneLayerProperties(
      this.options.engine.getStats(),
      false,
      key,
    );
    if (!target || !this.begin()) return;
    try {
      if (target.kind === "raster" && target.rasterIndex !== null) {
        await this.options.engine.setLayerOpacity(target.rasterIndex, opacity);
      } else if (target.kind === "text" && target.semanticId !== null) {
        await this.options.engine.setVectorTextNodeOpacity(target.semanticId, opacity);
      } else if (target.kind === "svg" && target.semanticId !== null) {
        await this.options.engine.setVectorSvgNodeOpacity(target.semanticId, opacity);
      } else if (target.kind === "image" && target.semanticId !== null) {
        await this.options.engine.setRasterImageNodeOpacity(target.semanticId, opacity);
      }
      const label = target.kind === "raster"
        ? "livello"
        : target.kind === "text"
          ? "testo"
          : target.kind === "svg"
            ? "SVG"
            : "immagine";
      this.options.elements.result.textContent =
        `Opacità ${label} ${Math.round(opacity * 100)}%.`;
    } catch (error) {
      this.options.elements.result.textContent = error instanceof Error
        ? error.message
        : `Opacità ${target.name} non aggiornata.`;
    } finally {
      this.finish();
    }
  }

  private async setRasterBlendModeTransaction(
    key: SceneLayerKey,
    blendMode: LayerBlendMode,
  ): Promise<void> {
    const target = selectedSceneLayerProperties(
      this.options.engine.getStats(),
      false,
      key,
    );
    if (target?.kind !== "raster" || target.rasterIndex === null || !this.begin()) return;
    try {
      const changed = await this.options.engine.setLayerBlendMode(
        target.rasterIndex,
        blendMode,
      );
      this.options.elements.result.textContent = changed
        ? `Fusione livello: ${LAYER_BLEND_MODE_LABELS[blendMode]}.`
        : "Fusione livello già attiva.";
    } catch (error) {
      this.options.elements.result.textContent = error instanceof Error
        ? error.message
        : "Fusione del livello non aggiornata.";
    } finally {
      this.finish();
    }
  }

  private async setRasterClippingTransaction(
    key: SceneLayerKey,
    enabled: boolean,
  ): Promise<void> {
    const beforeStats = this.options.engine.getStats();
    const target = selectedSceneLayerProperties(beforeStats, false, key);
    if (target?.kind !== "raster" || target.rasterIndex === null || !this.begin()) return;
    const before = beforeStats.layers[target.rasterIndex];
    try {
      if (
        !(await this.showLoading(
          enabled ? "Collego la maschera di ritaglio…" : "Scollego la maschera di ritaglio…",
        ))
      ) return;
      const changed = await this.options.engine.setLayerClipping(target.rasterIndex, enabled);
      const stats = this.options.engine.getStats();
      const liveIndex = rasterIndexForSceneLayerKey(stats, key);
      const layer = stats.layers[liveIndex];
      const parent = layer?.clippingParentId === null || layer?.clippingParentId === undefined
        ? null
        : stats.layers.find((candidate) => candidate.id === layer.clippingParentId) ?? null;
      this.options.elements.result.textContent = changed
        ? enabled
          ? `${layer?.name ?? before?.name ?? "Livello"} ora è una maschera su `
            + `${parent?.name ?? "il raster sotto"}. Altre M consecutive useranno la stessa base.`
          : `${layer?.name ?? before?.name ?? "Livello"} ora è una base indipendente. `
            + "Le eventuali maschere sopra restano collegate a questa nuova base."
        : "Impostazione maschera già attiva.";
    } catch (error) {
      this.options.elements.result.textContent = error instanceof Error
        ? error.message
        : "Maschera di ritaglio non aggiornata.";
    } finally {
      this.finish({ loading: true });
    }
  }

  private async setRasterReferenceTransaction(
    key: SceneLayerKey,
    enabled: boolean,
  ): Promise<void> {
    const stats = this.options.engine.getStats();
    const target = selectedSceneLayerProperties(stats, false, key);
    if (target?.kind !== "raster" || target.rasterIndex === null) return;
    if (target.rasterIndex !== stats.activeLayerIndex) {
      this.options.elements.result.textContent =
        "Seleziona prima il livello raster da impostare come Riferimento.";
      return;
    }
    if (!this.begin()) return;
    try {
      if (
        !(await this.showLoading(
          enabled ? "Preparo il Riferimento GPU…" : "Rilascio il Riferimento GPU…",
        ))
      ) return;
      const changed = await this.options.engine.setLayerReference(
        target.rasterIndex,
        enabled,
      );
      const layer = this.options.engine.getStats().layers[target.rasterIndex];
      this.options.elements.result.textContent = changed
        ? enabled
          ? `${layer?.name ?? "Livello"} è ora il Riferimento del Riempimento.`
          : "Riferimento disattivato: il Riempimento usa il livello selezionato."
        : "Impostazione Riferimento già attiva.";
    } catch (error) {
      this.options.elements.result.textContent = error instanceof Error
        ? error.message
        : "Riferimento GPU non aggiornato.";
    } finally {
      this.finish({ loading: true });
    }
  }

  private async addClippingMaskLayerTransaction(): Promise<void> {
    if (!this.begin()) return;
    this.options.renderLayers(this.options.engine.getStats());
    try {
      if (!(await this.showLoading("Creazione maschera…"))) return;
      const result = await this.options.engine.addClippingMaskLayer();
      this.options.syncActiveRasterControls();
      await this.options.engine.waitForIdle();
      this.options.elements.result.textContent =
        `Clipping Mask ${result.toIndex + 1} creata e selezionata in `
        + `${result.totalMs.toFixed(0)} ms.`;
    } catch (error) {
      this.options.recordDiagnostic("raster-clipping-mask-add-failed", null, error);
      this.options.elements.result.textContent = error instanceof Error
        ? error.message
        : "Creazione della maschera non riuscita.";
    } finally {
      this.finish({ loading: true });
    }
  }

  private async addRasterLayerTransaction(): Promise<void> {
    if (!this.begin()) return;
    try {
      if (!(await this.showLoading("Creazione livello…"))) return;
      const result = await this.options.engine.addLayer();
      this.options.syncActiveRasterControls();
      await this.options.engine.waitForIdle();
      this.options.elements.result.textContent =
        `Livello ${result.toIndex + 1} creato e attivo in ${result.totalMs.toFixed(0)} ms.`;
    } catch (error) {
      this.options.recordDiagnostic("raster-layer-add-failed", null, error);
      this.options.elements.result.textContent = error instanceof Error
        ? error.message
        : "Creazione livello non riuscita.";
    } finally {
      this.finish({ loading: true });
    }
  }
}
