import type { BrushEngine, LayerDuplicateResult } from "./brush-engine";
import type { EngineStats } from "./engine-stats";
import type { HistoryState } from "./engine-types";
import {
  LAYER_BLEND_MODE_LABELS,
  type LayerBlendMode,
} from "./layer-blend-modes";
import { mobileLayerMergeCompletionMatches } from "./mobile-layer-multi-selection";
import type { MixedSceneController } from "./mixed-scene-controller";
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
  | "rasterizeActiveRasterLayer"
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
  MixedSceneController,
  "mergeSceneItems" | "rasterizeSelectedSvgLayer" | "syncScene"
>;

export interface SceneEditorRasterizeResult {
  readonly kind: "raster" | "svg";
  readonly name: string;
  readonly changed: boolean;
  readonly outputKey: SceneLayerKey;
}

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
      return "This version cannot merge image layers yet.";
    }
    return this.options.getVectorController() === null
      ? "Merge unavailable: the layer controller is not ready yet."
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
      throw new Error("Merge unavailable: the layer controller is not ready.");
    }
    const beforeSnapshot = this.options.engine.getMixedSceneSnapshot();
    const beforeKeys = beforeSnapshot?.items.map((item) => item.key) ?? [];
    this.beginOrThrow("Merge unavailable while another operation is in progress.");
    try {
      if (!(await this.showLoading("Merging layers…"))) {
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
          "The merge finished, but the published scene does not contain the expected replacement.",
        );
      }
      await this.options.engine.waitForIdle();
      return { itemCount: result.itemCount };
    } finally {
      this.finish({ loading: true, syncActiveRasterControls: true });
    }
  }

  async rasterizeLayer(key: SceneLayerKey): Promise<SceneEditorRasterizeResult> {
    const stats = this.options.engine.getStats();
    const target = selectedSceneLayerProperties(stats, false, key);
    if (!target || (target.kind !== "raster" && target.kind !== "svg")) {
      throw new Error("Rasterize is available only for raster and SVG layers.");
    }
    const selectedKey = stats.mixedScene?.selectedKey
      ?? `raster:${stats.activeLayerId}`;
    if (selectedKey !== key) {
      throw new Error("The layer to rasterize is no longer selected.");
    }
    this.beginOrThrow("Rasterize is unavailable while another operation is in progress.");
    try {
      if (!(await this.showLoading("Rasterizing layer…"))) {
        throw new Error("Scene editor disposed.");
      }
      const liveStats = this.options.engine.getStats();
      const liveTarget = selectedSceneLayerProperties(liveStats, false, key);
      const liveSelectedKey = liveStats.mixedScene?.selectedKey
        ?? `raster:${liveStats.activeLayerId}`;
      if (!liveTarget || liveTarget.kind !== target.kind || liveSelectedKey !== key) {
        throw new Error("The layer to rasterize changed during the operation.");
      }
      if (liveTarget.kind === "raster") {
        const result = await this.options.engine.rasterizeActiveRasterLayer();
        await this.options.engine.waitForIdle();
        this.options.elements.result.textContent = result
          ? `${liveTarget.name} rasterized; blend mode and opacity preserved.`
          : `${liveTarget.name} is already rasterized and has no effects to bake in.`;
        return {
          kind: "raster",
          name: liveTarget.name,
          changed: result !== null,
          outputKey: key,
        };
      }

      const vector = this.options.getVectorController();
      if (!vector) {
        throw new Error("SVG rasterization unavailable: the controller is not ready.");
      }
      const result = await vector.rasterizeSelectedSvgLayer();
      if (!result) throw new Error("SVG rasterization failed.");
      await this.options.engine.waitForIdle();
      const outputKey = `raster:${result.layerId}` as SceneLayerKey;
      this.options.elements.result.textContent = `${liveTarget.name} rasterized.`;
      return {
        kind: "svg",
        name: liveTarget.name,
        changed: true,
        outputKey,
      };
    } finally {
      this.finish({ loading: true, syncActiveRasterControls: true });
    }
  }

  async duplicateSelectedLayer(): Promise<LayerDuplicateResult> {
    this.beginOrThrow("Duplication unavailable while another operation is in progress.");
    let syncActiveRasterControls = false;
    try {
      if (!(await this.showLoading("Duplicating layer…"))) {
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
    if (!target) throw new Error("Layer not found.");
    this.beginOrThrow("Deletion unavailable while another operation is in progress.");
    try {
      if (!(await this.showLoading("Deleting layer…"))) return;
      if (target.kind === "raster" && target.rasterIndex !== null) {
        await this.options.engine.deleteLayer(target.rasterIndex);
      } else if (target.kind === "text" && target.semanticId !== null) {
        await this.options.engine.deleteVectorTextNode(target.semanticId);
      } else if (target.kind === "svg" && target.semanticId !== null) {
        await this.options.engine.deleteVectorSvgNode(target.semanticId);
      } else if (target.kind === "image" && target.semanticId !== null) {
        await this.options.engine.deleteRasterImageNode(target.semanticId);
      } else {
        throw new Error("Layer not found.");
      }
      await this.options.engine.waitForIdle();
      this.options.elements.result.textContent = `${target.name} deleted.`;
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
      this.options.elements.result.textContent = "Layer not found.";
      return;
    }
    const scene = stats.mixedScene;
    if (!scene) {
      if (target.rasterIndex === stats.activeLayerIndex) {
        this.options.elements.result.textContent = "Layer already active.";
        return;
      }
      if (target.rasterIndex === null || !this.begin()) return;
      try {
        if (!(await this.showLoading("Loading layer…"))) return;
        const result = await this.options.engine.setActiveLayer(target.rasterIndex);
        this.options.syncActiveRasterControls();
        await this.options.engine.waitForIdle();
        this.options.elements.result.textContent = result
          ? `Layer ${result.toIndex + 1} active in ${result.totalMs.toFixed(0)} ms`
            + ` (effects ${result.effectsMs.toFixed(0)} ms).`
          : "Layer already active.";
      } catch (error) {
        this.options.recordDiagnostic(
          "raster-layer-selection-failed",
          JSON.stringify({ key, index: target.rasterIndex }),
          error,
        );
        this.options.elements.result.textContent = error instanceof Error
          ? error.message
          : "Layer switch failed.";
      } finally {
        this.finish({ loading: true });
      }
      return;
    }

    if (scene.selectedKey === key) {
      this.options.elements.result.textContent = "Layer already selected.";
      return;
    }
    const item = scene.items.find((candidate) => candidate.key === key);
    if (!item || !this.begin()) return;
    try {
      if (
        !(await this.showLoading(
          item.kind === "raster"
            ? "Loading raster layer…"
            : item.kind === "image"
              ? "Preparing WebGPU image…"
              : "Preparing vector layer…",
        ))
      ) return;
      const result = await this.options.engine.setActiveMixedSceneItem(key);
      if (item.kind === "raster") this.options.syncActiveRasterControls();
      await this.options.engine.waitForIdle();
      const snapshot = this.options.engine.getMixedSceneSnapshot();
      if (snapshot) this.options.getVectorController()?.syncScene(snapshot);
      this.options.elements.result.textContent = item.kind === "text"
        ? "Text selected: brush suspended; the working raster stays resident."
        : item.kind === "svg"
          ? "SVG selected: use Transform or edit colors and effects."
          : item.kind === "image"
            ? "Image selected: choose Transform, then Apply or Cancel."
            : result
              ? `Raster ${result.toIndex + 1} active in ${result.totalMs.toFixed(0)} ms.`
              : "Raster selected: brush active.";
    } catch (error) {
      this.options.recordDiagnostic(
        "mixed-scene-selection-failed",
        JSON.stringify({ key, kind: item.kind }),
        error,
      );
      this.options.elements.result.textContent = error instanceof Error
        ? error.message
        : "Layer selection failed.";
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
          ? "Layer shown."
          : "Layer hidden.";
      } else if (target.kind === "text" && target.semanticId !== null) {
        await this.options.engine.setVectorTextNodeVisibility(target.semanticId, visible);
        this.options.elements.result.textContent = visible ? "Text shown." : "Text hidden.";
      } else if (target.kind === "svg" && target.semanticId !== null) {
        await this.options.engine.setVectorSvgNodeVisibility(target.semanticId, visible);
        this.options.elements.result.textContent = visible ? "SVG shown." : "SVG hidden.";
      } else if (target.kind === "image" && target.semanticId !== null) {
        await this.options.engine.setRasterImageNodeVisibility(target.semanticId, visible);
        this.options.elements.result.textContent = visible
          ? "Image shown."
          : "Image hidden.";
      }
    } catch (error) {
      this.options.elements.result.textContent = error instanceof Error
        ? error.message
        : `Could not update ${target.name} visibility.`;
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
        ? "Layer"
        : target.kind === "text"
          ? "Text"
          : target.kind === "svg"
            ? "SVG"
            : "Image";
      this.options.elements.result.textContent =
        `${label} opacity ${Math.round(opacity * 100)}%.`;
    } catch (error) {
      this.options.elements.result.textContent = error instanceof Error
        ? error.message
        : `Could not update ${target.name} opacity.`;
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
        ? `Layer blend mode: ${LAYER_BLEND_MODE_LABELS[blendMode]}.`
        : "Layer blend mode already active.";
    } catch (error) {
      this.options.elements.result.textContent = error instanceof Error
        ? error.message
        : "Could not update the layer blend mode.";
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
          enabled ? "Linking clipping mask…" : "Unlinking clipping mask…",
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
          ? `${layer?.name ?? before?.name ?? "Layer"} is now clipped to `
            + `${parent?.name ?? "the raster layer below"}. Additional consecutive masks will use the same base.`
          : `${layer?.name ?? before?.name ?? "Layer"} is now an independent base. `
            + "Any masks above remain linked to this new base."
        : "Clipping mask setting already active.";
    } catch (error) {
      this.options.elements.result.textContent = error instanceof Error
        ? error.message
        : "Could not update the clipping mask.";
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
        "First select the raster layer to use as the Fill Reference.";
      return;
    }
    if (!this.begin()) return;
    try {
      if (
        !(await this.showLoading(
          enabled ? "Preparing the GPU Reference…" : "Releasing the GPU Reference…",
        ))
      ) return;
      const changed = await this.options.engine.setLayerReference(
        target.rasterIndex,
        enabled,
      );
      const layer = this.options.engine.getStats().layers[target.rasterIndex];
      this.options.elements.result.textContent = changed
        ? enabled
          ? `${layer?.name ?? "Layer"} is now the Fill Reference.`
          : "Reference disabled: Fill uses the selected layer."
        : "Reference setting already active.";
    } catch (error) {
      this.options.elements.result.textContent = error instanceof Error
        ? error.message
        : "Could not update the GPU Reference.";
    } finally {
      this.finish({ loading: true });
    }
  }

  private async addClippingMaskLayerTransaction(): Promise<void> {
    if (!this.begin()) return;
    this.options.renderLayers(this.options.engine.getStats());
    try {
      if (!(await this.showLoading("Creating mask…"))) return;
      const result = await this.options.engine.addClippingMaskLayer();
      this.options.syncActiveRasterControls();
      await this.options.engine.waitForIdle();
      this.options.elements.result.textContent =
        `Clipping Mask ${result.toIndex + 1} created and selected in `
        + `${result.totalMs.toFixed(0)} ms.`;
    } catch (error) {
      this.options.recordDiagnostic("raster-clipping-mask-add-failed", null, error);
      this.options.elements.result.textContent = error instanceof Error
        ? error.message
        : "Could not create the mask.";
    } finally {
      this.finish({ loading: true });
    }
  }

  private async addRasterLayerTransaction(): Promise<void> {
    if (!this.begin()) return;
    try {
      if (!(await this.showLoading("Creating layer…"))) return;
      const result = await this.options.engine.addLayer();
      this.options.syncActiveRasterControls();
      await this.options.engine.waitForIdle();
      this.options.elements.result.textContent =
        `Layer ${result.toIndex + 1} created and active in ${result.totalMs.toFixed(0)} ms.`;
    } catch (error) {
      this.options.recordDiagnostic("raster-layer-add-failed", null, error);
      this.options.elements.result.textContent = error instanceof Error
        ? error.message
        : "Could not create the layer.";
    } finally {
      this.finish({ loading: true });
    }
  }
}
