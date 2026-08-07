import {
  BRUSH_LIBRARY_PREVIEW_NEUTRAL_COLOR,
  type AuthoritativeBrushStrokePreviewRenderer,
} from "./brush-stroke-preview-renderer";
import type { BrushSettings } from "./engine-types";
import { brushLibraryPreviewFingerprint } from "./brush-library-preview-core";

export const BRUSH_LIBRARY_PREVIEW_WIDTH = 240;
export const BRUSH_LIBRARY_PREVIEW_HEIGHT = 56;
/** Two built-ins plus the bounded custom-brush catalog. */
export const BRUSH_LIBRARY_PREVIEW_MAX_CARDS = 10;
/** Assets are owned transiently by the shared authoritative renderer. */
export const BRUSH_LIBRARY_PREVIEW_MAX_ASSETS = 0;

const RGBA_BYTES_PER_PIXEL = 4;
const OUTPUT_BYTES = (
  BRUSH_LIBRARY_PREVIEW_WIDTH
  * BRUSH_LIBRARY_PREVIEW_HEIGHT
  * RGBA_BYTES_PER_PIXEL
);
const READBACK_BYTES_PER_ROW = Math.ceil(
  (BRUSH_LIBRARY_PREVIEW_WIDTH * RGBA_BYTES_PER_PIXEL) / 256,
) * 256;
const READBACK_BYTES = READBACK_BYTES_PER_ROW * BRUSH_LIBRARY_PREVIEW_HEIGHT;

/** DOM canvases are the only retained card bitmaps. GPU targets are shared. */
export const BRUSH_LIBRARY_PREVIEW_MAX_STEADY_BYTES =
  OUTPUT_BYTES * BRUSH_LIBRARY_PREVIEW_MAX_CARDS;
export const BRUSH_LIBRARY_PREVIEW_MAX_PEAK_BYTES =
  BRUSH_LIBRARY_PREVIEW_MAX_STEADY_BYTES + READBACK_BYTES;

interface PreviewCardCacheEntry {
  readonly canvas: HTMLCanvasElement;
  readonly fingerprint: string;
  readonly pixelHash: string;
  readonly renderCount: number;
  readonly sourceComplete: boolean;
  lastUsed: number;
}

export interface BrushLibraryPreviewResult {
  readonly fingerprint: string;
  readonly pixelHash: string;
  readonly rendered: boolean;
  readonly renderCount: number;
  readonly sourceComplete: boolean;
}

export interface BrushLibraryPreviewStats {
  readonly scope: "retained-library-card-bitmaps";
  readonly cardEntries: number;
  readonly assetEntries: number;
  readonly renderCount: number;
  readonly cacheHitCount: number;
  readonly steadyBytes: number;
  readonly steadyKiB: number;
  readonly maximumSteadyBytes: number;
  readonly maximumPeakBytes: number;
}

/**
 * Compact card cache over the same WebGPU renderer used by Brush Studio.
 * No Shape, Grain, spacing, jitter or blend math lives in this class.
 */
export class MobileBrushLibraryPreviewRenderer {
  private readonly cards = new Map<string, PreviewCardCacheEntry>();
  private readonly pendingCards = new Map<string, Promise<BrushLibraryPreviewResult>>();
  private usageClock = 0;
  private totalRenderCount = 0;
  private totalCacheHitCount = 0;

  constructor(
    private readonly renderer: AuthoritativeBrushStrokePreviewRenderer,
  ) {}

  render(
    brushId: string,
    canvas: HTMLCanvasElement,
    settings: Readonly<BrushSettings>,
  ): Promise<BrushLibraryPreviewResult> {
    const fingerprint = this.fingerprint(brushId, settings);
    const cached = this.cards.get(brushId);
    if (
      cached
      && cached.canvas === canvas
      && cached.fingerprint === fingerprint
      && cached.sourceComplete
      && canvas.width === BRUSH_LIBRARY_PREVIEW_WIDTH
      && canvas.height === BRUSH_LIBRARY_PREVIEW_HEIGHT
    ) {
      cached.lastUsed = ++this.usageClock;
      this.totalCacheHitCount += 1;
      return Promise.resolve({
        fingerprint,
        pixelHash: cached.pixelHash,
        rendered: false,
        renderCount: cached.renderCount,
        sourceComplete: true,
      });
    }

    const pendingKey = `${brushId}:${fingerprint}`;
    const pending = this.pendingCards.get(pendingKey);
    if (pending) return pending;
    const task = this.renderNow(brushId, canvas, settings, fingerprint)
      .finally(() => this.pendingCards.delete(pendingKey));
    this.pendingCards.set(pendingKey, task);
    return task;
  }

  hasCompletePreview(
    brushId: string,
    canvas: HTMLCanvasElement,
    settings: Readonly<BrushSettings>,
  ): boolean {
    const cached = this.cards.get(brushId);
    return cached?.canvas === canvas
      && cached.fingerprint === this.fingerprint(brushId, settings)
      && cached.sourceComplete
      && canvas.dataset.previewSourceComplete === "true"
      && canvas.width === BRUSH_LIBRARY_PREVIEW_WIDTH
      && canvas.height === BRUSH_LIBRARY_PREVIEW_HEIGHT;
  }

  stats(): BrushLibraryPreviewStats {
    const steadyBytes = this.cards.size * OUTPUT_BYTES;
    return {
      scope: "retained-library-card-bitmaps",
      cardEntries: this.cards.size,
      assetEntries: 0,
      renderCount: this.totalRenderCount,
      cacheHitCount: this.totalCacheHitCount,
      steadyBytes,
      steadyKiB: steadyBytes / 1024,
      maximumSteadyBytes: BRUSH_LIBRARY_PREVIEW_MAX_STEADY_BYTES,
      maximumPeakBytes: BRUSH_LIBRARY_PREVIEW_MAX_PEAK_BYTES,
    };
  }

  private async renderNow(
    brushId: string,
    canvas: HTMLCanvasElement,
    settings: Readonly<BrushSettings>,
    fingerprint: string,
  ): Promise<BrushLibraryPreviewResult> {
    canvas.width = BRUSH_LIBRARY_PREVIEW_WIDTH;
    canvas.height = BRUSH_LIBRARY_PREVIEW_HEIGHT;
    const rendered = await this.renderer.render(canvas, settings, {
      color: BRUSH_LIBRARY_PREVIEW_NEUTRAL_COLOR,
      computePixelHash: true,
    });
    if (rendered.stale) {
      const previous = this.cards.get(brushId);
      return {
        fingerprint,
        pixelHash: previous?.pixelHash ?? "00000000",
        rendered: false,
        renderCount: previous?.renderCount ?? 0,
        sourceComplete: false,
      };
    }

    const pixelHash = rendered.pixelHash ?? "00000000";
    const previousRenderCount = this.cards.get(brushId)?.renderCount ?? 0;
    const entry: PreviewCardCacheEntry = {
      canvas,
      fingerprint,
      pixelHash,
      renderCount: previousRenderCount + 1,
      sourceComplete: true,
      lastUsed: ++this.usageClock,
    };
    this.cards.set(brushId, entry);
    this.evictCards(brushId);
    this.totalRenderCount += 1;
    canvas.dataset.previewFingerprint = fingerprint;
    canvas.dataset.previewPixelHash = pixelHash;
    canvas.dataset.previewRenderCount = String(entry.renderCount);
    canvas.dataset.previewSourceComplete = "true";
    canvas.dataset.previewStampCount = String(rendered.stampCount);
    canvas.dataset.previewRenderer = "authoritative-webgpu";
    return {
      fingerprint,
      pixelHash,
      rendered: true,
      renderCount: entry.renderCount,
      sourceComplete: true,
    };
  }

  private fingerprint(
    brushId: string,
    settings: Readonly<BrushSettings>,
  ): string {
    return [
      brushLibraryPreviewFingerprint(brushId, settings),
      this.renderer.cacheIdentity,
    ].join(":");
  }

  private evictCards(protectedId: string): void {
    while (this.cards.size > BRUSH_LIBRARY_PREVIEW_MAX_CARDS) {
      const victim = [...this.cards.entries()]
        .filter(([id]) => id !== protectedId)
        .sort((left, right) => left[1].lastUsed - right[1].lastUsed)[0];
      if (!victim) return;
      this.cards.delete(victim[0]);
    }
  }
}
