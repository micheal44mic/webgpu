import type { EngineStats } from "./engine-stats";
import { DOCUMENT_HEIGHT, DOCUMENT_WIDTH } from "./engine-limits";
import { BoundedMobileRasterThumbnailCache } from "./mobile-raster-thumbnail-cache";
import {
  renderMobileSemanticLayerThumbnail,
  requestMobileTextThumbnailFont,
  type MobileSemanticLayerThumbnailSource,
} from "./mobile-semantic-layer-thumbnail";

export type LayerThumbnailKind = "raster" | "text" | "svg" | "image";

export interface LayerThumbnailView {
  readonly kind: LayerThumbnailKind;
  readonly rasterLayerId: number | null;
  readonly hasContent: boolean;
  readonly contentBounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  } | null;
  readonly thumbnailGlyph: string;
  readonly thumbnailColor: string | null;
  readonly semanticThumbnail: MobileSemanticLayerThumbnailSource | null;
  readonly semanticThumbnailSignature: string;
}

export interface LayerThumbnailCapture {
  readonly layerId: number;
  readonly width: number;
  readonly height: number;
  readonly rgba: ArrayLike<number>;
}

export interface LayerThumbnailBrowser extends Window {
  readonly ImageData: typeof ImageData;
}

export interface LayerThumbnailControllerOptions {
  readonly browser: LayerThumbnailBrowser;
  readonly getStats: () => EngineStats | null;
  readonly captureRasterLayerThumbnail: (
    layerId: number,
  ) => Promise<LayerThumbnailCapture>;
  /** False while the engine/panel cannot even enqueue a GPU readback. */
  readonly canScheduleCapture: () => boolean;
  /** True for short-lived pointer, History or scene transactions. */
  readonly captureBusy: () => boolean;
  readonly onDirty: () => void;
  readonly onWarning?: (message: string, error: unknown) => void;
}

interface RasterThumbnailCacheEntry {
  readonly imageData: ImageData;
  readonly revision: number;
}

/**
 * Owns the bounded CPU thumbnail cache and the serialized GPU readback queue.
 * Layer rendering may consume it, but neither the panel nor main.ts owns its
 * timers, pending ids or memory-retention policy.
 */
export class LayerThumbnailController {
  private readonly cache =
    new BoundedMobileRasterThumbnailCache<RasterThumbnailCacheEntry>();
  private panelOpen = false;
  private revision = 0;
  private sourceGeneration = 0;
  private fontRevision = 0;
  private captureTimer: number | null = null;
  private readonly pendingLayerIds = new Set<number>();
  private readonly dirtyGenerationByLayerId = new Map<number, number>();
  private captureInFlight = false;
  private captureUnavailable = false;
  private disposed = false;

  constructor(private readonly options: LayerThumbnailControllerOptions) {}

  get isCaptureInFlight(): boolean {
    return this.captureInFlight;
  }

  setPanelOpen(open: boolean): void {
    if (this.disposed || open === this.panelOpen) return;
    this.panelOpen = open;
    if (open) {
      this.queueMissing(0);
      return;
    }
    this.cancelCaptureTimer();
  }

  requestActive(delayMs = 120): void {
    this.invalidateActive(delayMs);
  }

  invalidateActive(delayMs = 120): void {
    const stats = this.liveStats();
    if (!stats) return;
    const activeLayer = stats.layers[stats.activeLayerIndex];
    if (!activeLayer) return;
    this.invalidate(activeLayer.id, delayMs);
  }

  ensureActive(delayMs = 0): void {
    const stats = this.liveStats();
    if (!stats) return;
    const activeLayer = stats.layers[stats.activeLayerIndex];
    if (!activeLayer) return;
    if (!activeLayer.hasContent) {
      this.pendingLayerIds.delete(activeLayer.id);
      this.dirtyGenerationByLayerId.delete(activeLayer.id);
      if (this.cache.delete(activeLayer.id)) this.options.onDirty();
      return;
    }
    if (
      this.cache.get(activeLayer.id) !== undefined
      && !this.dirtyGenerationByLayerId.has(activeLayer.id)
    ) return;
    this.pendingLayerIds.add(activeLayer.id);
    this.scheduleCapture(delayMs);
  }

  resumeCapture(delayMs = 0): void {
    this.scheduleCapture(delayMs);
  }

  invalidate(layerId: number, delayMs = 120): void {
    if (this.disposed) return;
    const stats = this.liveStats();
    if (stats) {
      const liveIds = new Set(stats.layers.map((layer) => layer.id));
      for (const pendingLayerId of this.pendingLayerIds) {
        if (!liveIds.has(pendingLayerId)) this.pendingLayerIds.delete(pendingLayerId);
      }
      if (!liveIds.has(layerId)) return;
    }
    this.sourceGeneration += 1;
    this.dirtyGenerationByLayerId.delete(layerId);
    this.dirtyGenerationByLayerId.set(layerId, this.sourceGeneration);
    while (this.dirtyGenerationByLayerId.size > this.cache.maximum) {
      const oldest = this.dirtyGenerationByLayerId.keys().next();
      if (oldest.done) break;
      this.dirtyGenerationByLayerId.delete(oldest.value);
    }
    this.pendingLayerIds.add(layerId);
    this.scheduleCapture(delayMs);
  }

  queueMissing(delayMs = 0): void {
    const stats = this.liveStats();
    if (!stats) return;
    const activeLayer = stats.layers[stats.activeLayerIndex];
    if (!activeLayer) return;
    const liveIds = new Set(stats.layers.map((layer) => layer.id));
    for (const layerId of this.pendingLayerIds) {
      if (!liveIds.has(layerId)) {
        this.pendingLayerIds.delete(layerId);
      }
    }
    const activeFirst = [
      activeLayer,
      ...stats.layers.filter((layer) => layer.id !== activeLayer.id),
    ];
    let cacheChanged = false;
    for (const layer of activeFirst) {
      if (!layer.hasContent) {
        this.pendingLayerIds.delete(layer.id);
        this.dirtyGenerationByLayerId.delete(layer.id);
        cacheChanged = this.cache.delete(layer.id) || cacheChanged;
      } else if (
        this.cache.get(layer.id) === undefined
        || this.dirtyGenerationByLayerId.has(layer.id)
      ) {
        this.pendingLayerIds.add(layer.id);
      }
    }
    if (cacheChanged) this.options.onDirty();
    this.scheduleCapture(delayMs);
  }

  rasterRevision(layerId: number | null): number {
    return layerId === null ? 0 : this.cache.get(layerId)?.revision ?? 0;
  }

  semanticFontRevision(kind: LayerThumbnailKind): number | "" {
    return kind === "text" ? this.fontRevision : "";
  }

  copyRasterEntry(sourceLayerId: number, destinationLayerId: number): boolean {
    const entry = this.cache.get(sourceLayerId);
    if (
      !entry
      || this.dirtyGenerationByLayerId.has(sourceLayerId)
      || this.pendingLayerIds.has(sourceLayerId)
    ) {
      return false;
    }
    // ImageData is immutable from this controller's perspective. Sharing the
    // entry avoids a second 64² CPU allocation until either layer is recaptured.
    this.cache.set(destinationLayerId, entry);
    this.pendingLayerIds.delete(destinationLayerId);
    this.dirtyGenerationByLayerId.delete(destinationLayerId);
    this.options.onDirty();
    return true;
  }

  deleteRasterEntry(layerId: number): boolean {
    this.pendingLayerIds.delete(layerId);
    this.dirtyGenerationByLayerId.delete(layerId);
    const deleted = this.cache.delete(layerId);
    if (deleted) this.options.onDirty();
    return deleted;
  }

  render(thumbnail: HTMLSpanElement, view: LayerThumbnailView): void {
    const bounds = view.contentBounds;
    const cached = view.rasterLayerId === null
      ? null
      : this.cache.get(view.rasterLayerId) ?? null;
    const signature = [
      view.kind,
      view.hasContent ? 1 : 0,
      bounds?.x ?? "",
      bounds?.y ?? "",
      bounds?.width ?? "",
      bounds?.height ?? "",
      view.thumbnailGlyph,
      view.thumbnailColor ?? "",
      view.semanticThumbnailSignature,
      this.semanticFontRevision(view.kind),
      cached?.revision ?? 0,
    ].join(":");
    if (thumbnail.dataset.thumbnailSignature === signature) return;
    thumbnail.dataset.thumbnailSignature = signature;
    thumbnail.dataset.kind = view.kind;

    const content = thumbnail.querySelector<HTMLSpanElement>(
      ".mobile-layer-thumbnail-content",
    );
    const canvas = thumbnail.querySelector<HTMLCanvasElement>(
      ".mobile-layer-thumbnail-canvas",
    );
    const glyph = thumbnail.querySelector<HTMLSpanElement>(
      ".mobile-layer-thumbnail-glyph",
    );
    if (!content || !canvas || !glyph) return;
    glyph.textContent = view.thumbnailGlyph;
    if (view.thumbnailColor) {
      thumbnail.style.setProperty("--mobile-layer-thumbnail-color", view.thumbnailColor);
    } else {
      thumbnail.style.removeProperty("--mobile-layer-thumbnail-color");
    }

    let canvasRendered = false;
    const context = canvas.getContext("2d", { alpha: true });
    if (cached && context) {
      context.putImageData(cached.imageData, 0, 0);
      canvasRendered = true;
    } else if (view.semanticThumbnail && context) {
      if (view.semanticThumbnail.kind === "text") {
        requestMobileTextThumbnailFont(
          view.semanticThumbnail.node.fontFamily,
          () => {
            if (this.disposed) return;
            this.fontRevision += 1;
            this.options.onDirty();
          },
        );
      }
      canvasRendered = renderMobileSemanticLayerThumbnail(
        context,
        view.semanticThumbnail,
      );
    }
    canvas.hidden = !canvasRendered;
    glyph.hidden = canvasRendered;

    content.hidden = canvasRendered || view.kind !== "raster" || !view.hasContent;
    if (content.hidden) return;
    if (!bounds) {
      content.style.left = "26%";
      content.style.top = "32%";
      content.style.width = "48%";
      content.style.height = "36%";
      return;
    }
    const left = Math.max(0, Math.min(1, bounds.x / DOCUMENT_WIDTH));
    const top = Math.max(0, Math.min(1, bounds.y / DOCUMENT_HEIGHT));
    const right = Math.max(
      left,
      Math.min(1, (bounds.x + bounds.width) / DOCUMENT_WIDTH),
    );
    const bottom = Math.max(
      top,
      Math.min(1, (bounds.y + bounds.height) / DOCUMENT_HEIGHT),
    );
    content.style.left = `${(left * 100).toFixed(2)}%`;
    content.style.top = `${(top * 100).toFixed(2)}%`;
    content.style.width = `${((right - left) * 100).toFixed(2)}%`;
    content.style.height = `${((bottom - top) * 100).toFixed(2)}%`;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.panelOpen = false;
    this.pendingLayerIds.clear();
    this.dirtyGenerationByLayerId.clear();
    this.cancelCaptureTimer();
    this.cache.clear();
  }

  private schedulableStats(): EngineStats | null {
    if (
      this.disposed
      || !this.panelOpen
      || this.captureUnavailable
      || !this.options.canScheduleCapture()
    ) {
      return null;
    }
    return this.liveStats();
  }

  private liveStats(): EngineStats | null {
    return this.disposed ? null : this.options.getStats();
  }

  private scheduleCapture(delayMs = 120): void {
    if (
      !this.schedulableStats()
      || this.pendingLayerIds.size === 0
      || this.captureInFlight
      || this.captureTimer !== null
    ) {
      return;
    }
    this.captureTimer = this.options.browser.setTimeout(() => {
      this.captureTimer = null;
      void this.captureRequested();
    }, Math.max(0, delayMs));
  }

  private cancelCaptureTimer(): void {
    if (this.captureTimer === null) return;
    this.options.browser.clearTimeout(this.captureTimer);
    this.captureTimer = null;
  }

  private async captureRequested(): Promise<void> {
    const stats = this.schedulableStats();
    if (!stats || this.pendingLayerIds.size === 0) return;
    if (this.options.captureBusy()) {
      this.scheduleCapture(160);
      return;
    }

    const activeLayer = stats.layers[stats.activeLayerIndex];
    if (!activeLayer) return;
    const liveLayers = new Map(stats.layers.map((layer) => [layer.id, layer]));
    let cacheChanged = false;
    for (const layerId of this.pendingLayerIds) {
      const layer = liveLayers.get(layerId);
      if (!layer) {
        this.pendingLayerIds.delete(layerId);
      } else if (!layer.hasContent) {
        this.pendingLayerIds.delete(layerId);
        this.dirtyGenerationByLayerId.delete(layerId);
        cacheChanged = this.cache.delete(layerId) || cacheChanged;
      }
    }
    if (cacheChanged) this.options.onDirty();
    const layerId = this.pendingLayerIds.has(activeLayer.id)
      ? activeLayer.id
      : this.pendingLayerIds.values().next().value;
    if (layerId === undefined) return;
    this.pendingLayerIds.delete(layerId);
    const requestedGeneration = this.dirtyGenerationByLayerId.get(layerId) ?? 0;
    const requestedLayer = liveLayers.get(layerId);
    if (!requestedLayer?.hasContent) {
      this.deleteRasterEntry(layerId);
      return;
    }

    this.captureInFlight = true;
    try {
      const capture = await this.options.captureRasterLayerThumbnail(layerId);
      if (this.disposed) return;
      if (capture.layerId !== layerId) {
        throw new Error("Thumbnail capture returned an unexpected layer.");
      }
      const liveStats = this.options.getStats();
      const liveLayer = liveStats?.layers.find((layer) => layer.id === capture.layerId);
      if (!liveLayer) {
        return;
      }
      if (!liveLayer.hasContent) {
        this.deleteRasterEntry(capture.layerId);
        return;
      }
      if ((this.dirtyGenerationByLayerId.get(layerId) ?? 0) !== requestedGeneration) {
        this.pendingLayerIds.add(layerId);
        return;
      }
      this.revision += 1;
      const imageBytes = new Uint8ClampedArray(capture.rgba.length);
      imageBytes.set(capture.rgba);
      this.cache.set(capture.layerId, {
        imageData: new this.options.browser.ImageData(
          imageBytes,
          capture.width,
          capture.height,
        ),
        revision: this.revision,
      });
      this.dirtyGenerationByLayerId.delete(layerId);
      this.options.onDirty();
    } catch (error) {
      if (this.disposed) return;
      const message = error instanceof Error ? error.message : String(error);
      const liveStats = this.options.getStats();
      if (message.includes("deferred")) {
        this.pendingLayerIds.add(layerId);
      } else if (!liveStats?.layers.some((layer) => layer.id === layerId)) {
        this.pendingLayerIds.delete(layerId);
      } else {
        this.captureUnavailable = true;
        this.pendingLayerIds.clear();
        this.options.onWarning?.(
          "GPU raster thumbnails are unavailable; the structural fallback remains active.",
          error,
        );
      }
    } finally {
      this.captureInFlight = false;
      if (!this.disposed) this.scheduleCapture(160);
    }
  }
}
