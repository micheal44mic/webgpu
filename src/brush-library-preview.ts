import {
  loadBrushStudioAsset,
  loadBrushStudioSavedBrush,
  type BrushStudioAssetKind,
} from "./brush-studio-storage";
import type { BrushSettings } from "./engine-types";
import {
  brushLibraryPreviewFingerprint,
  brushLibraryPreviewRandom,
  hashBrushLibraryPreviewPixels,
} from "./brush-library-preview-core";

/**
 * The library owns exactly two compact previews today (Pencil and the mutable
 * legacy/current slot). Their DOM canvases are the cache: no duplicate bitmap
 * is retained and no GPU resource is involved.
 */
export const BRUSH_LIBRARY_PREVIEW_WIDTH = 240;
export const BRUSH_LIBRARY_PREVIEW_HEIGHT = 56;
export const BRUSH_LIBRARY_PREVIEW_MAX_CARDS = 2;
export const BRUSH_LIBRARY_PREVIEW_ASSET_SIZE = 64;
export const BRUSH_LIBRARY_PREVIEW_MAX_ASSETS = 4;

const RGBA_BYTES_PER_PIXEL = 4;
const OUTPUT_BYTES = (
  BRUSH_LIBRARY_PREVIEW_WIDTH
  * BRUSH_LIBRARY_PREVIEW_HEIGHT
  * RGBA_BYTES_PER_PIXEL
);
const ASSET_BYTES = (
  BRUSH_LIBRARY_PREVIEW_ASSET_SIZE
  * BRUSH_LIBRARY_PREVIEW_ASSET_SIZE
  * RGBA_BYTES_PER_PIXEL
);

/** Pixel backing-store estimate; browser object overhead is deliberately excluded. */
export const BRUSH_LIBRARY_PREVIEW_MAX_STEADY_BYTES = (
  OUTPUT_BYTES * BRUSH_LIBRARY_PREVIEW_MAX_CARDS
  + ASSET_BYTES * BRUSH_LIBRARY_PREVIEW_MAX_ASSETS
  + ASSET_BYTES // shared tip/grain-tile scratch
  + OUTPUT_BYTES // shared grain-mask scratch
);

/** A single getImageData used for the diagnostic hash is the only extra peak bitmap. */
export const BRUSH_LIBRARY_PREVIEW_MAX_PEAK_BYTES = (
  BRUSH_LIBRARY_PREVIEW_MAX_STEADY_BYTES + OUTPUT_BYTES
);

interface PreviewAssetDescriptor {
  readonly kind: BrushStudioAssetKind;
  readonly url: URL;
  readonly authoredInvert: boolean;
  readonly sourceWidth: number;
}

const STATIC_ASSETS = {
  "legacy-shape": {
    kind: "shape",
    url: new URL("../Shape.png", import.meta.url),
    authoredInvert: false,
    sourceWidth: 2048,
  },
  "pencil-shape": {
    kind: "shape",
    url: new URL("../Shapepencil.png", import.meta.url),
    authoredInvert: true,
    sourceWidth: 2048,
  },
  "legacy-grain": {
    kind: "grain",
    url: new URL("../graincottonfleece.PNG", import.meta.url),
    authoredInvert: false,
    sourceWidth: 2500,
  },
  "pencil-grain": {
    kind: "grain",
    url: new URL("../Grainpencil.png", import.meta.url),
    authoredInvert: false,
    sourceWidth: 800,
  },
} as const satisfies Record<string, PreviewAssetDescriptor>;

interface PreviewAsset {
  readonly canvas: HTMLCanvasElement;
  readonly authoredInvert: boolean;
  readonly sourceWidth: number;
  lastUsed: number;
}

interface PreviewCardCacheEntry {
  readonly canvas: HTMLCanvasElement;
  readonly fingerprint: string;
  readonly pixelHash: string;
  readonly renderCount: number;
  readonly sourceComplete: boolean;
  lastUsed: number;
}

interface PreviewSources {
  readonly shape: PreviewAsset | null;
  readonly grain: PreviewAsset | null;
  readonly complete: boolean;
}

export interface BrushLibraryPreviewResult {
  readonly fingerprint: string;
  readonly pixelHash: string;
  readonly rendered: boolean;
  readonly renderCount: number;
  readonly sourceComplete: boolean;
}

export interface BrushLibraryPreviewStats {
  readonly cardEntries: number;
  readonly assetEntries: number;
  readonly renderCount: number;
  readonly cacheHitCount: number;
  readonly steadyBytes: number;
  readonly steadyKiB: number;
  readonly maximumSteadyBytes: number;
  readonly maximumPeakBytes: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

async function imageBlobToPreviewCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = BRUSH_LIBRARY_PREVIEW_ASSET_SIZE;
  canvas.height = BRUSH_LIBRARY_PREVIEW_ASSET_SIZE;
  const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
  if (!context) throw new Error("Brush preview Canvas2D unavailable.");

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(blob, {
      colorSpaceConversion: "none",
      premultiplyAlpha: "none",
      resizeWidth: BRUSH_LIBRARY_PREVIEW_ASSET_SIZE,
      resizeHeight: BRUSH_LIBRARY_PREVIEW_ASSET_SIZE,
      resizeQuality: "high",
    });
    context.drawImage(
      bitmap,
      0,
      0,
      BRUSH_LIBRARY_PREVIEW_ASSET_SIZE,
      BRUSH_LIBRARY_PREVIEW_ASSET_SIZE,
    );
    return canvas;
  } catch {
    const objectUrl = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.decoding = "async";
      await new Promise<void>((resolve, reject) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => reject(new Error("Brush preview image failed.")), {
          once: true,
        });
        image.src = objectUrl;
      });
      context.drawImage(
        image,
        0,
        0,
        BRUSH_LIBRARY_PREVIEW_ASSET_SIZE,
        BRUSH_LIBRARY_PREVIEW_ASSET_SIZE,
      );
      return canvas;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } finally {
    bitmap?.close();
  }
}

function cubicBezier(
  start: number,
  control1: number,
  control2: number,
  end: number,
  progress: number,
): number {
  const inverse = 1 - progress;
  return (
    inverse * inverse * inverse * start
    + 3 * inverse * inverse * progress * control1
    + 3 * inverse * progress * progress * control2
    + progress * progress * progress * end
  );
}

function cubicBezierDerivative(
  start: number,
  control1: number,
  control2: number,
  end: number,
  progress: number,
): number {
  const inverse = 1 - progress;
  return (
    3 * inverse * inverse * (control1 - start)
    + 6 * inverse * progress * (control2 - control1)
    + 3 * progress * progress * (end - control2)
  );
}

export class MobileBrushLibraryPreviewRenderer {
  private readonly cards = new Map<string, PreviewCardCacheEntry>();
  private readonly assets = new Map<string, PreviewAsset>();
  private readonly pendingAssets = new Map<string, Promise<PreviewAsset | null>>();
  private readonly pendingCards = new Map<string, Promise<BrushLibraryPreviewResult>>();
  private readonly tipScratch = document.createElement("canvas");
  private readonly grainMaskScratch = document.createElement("canvas");
  private usageClock = 0;
  private totalRenderCount = 0;
  private totalCacheHitCount = 0;

  constructor() {
    this.tipScratch.width = BRUSH_LIBRARY_PREVIEW_ASSET_SIZE;
    this.tipScratch.height = BRUSH_LIBRARY_PREVIEW_ASSET_SIZE;
    this.grainMaskScratch.width = BRUSH_LIBRARY_PREVIEW_WIDTH;
    this.grainMaskScratch.height = BRUSH_LIBRARY_PREVIEW_HEIGHT;
  }

  render(
    brushId: string,
    canvas: HTMLCanvasElement,
    settings: Readonly<BrushSettings>,
  ): Promise<BrushLibraryPreviewResult> {
    const fingerprint = brushLibraryPreviewFingerprint(brushId, settings);
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
        sourceComplete: cached.sourceComplete,
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

  stats(): BrushLibraryPreviewStats {
    const steadyBytes = (
      this.cards.size * OUTPUT_BYTES
      + this.assets.size * ASSET_BYTES
      + ASSET_BYTES
      + OUTPUT_BYTES
    );
    return {
      cardEntries: this.cards.size,
      assetEntries: this.assets.size,
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
    const sources = await this.resolveSources(brushId, settings);
    const latestFingerprint = brushLibraryPreviewFingerprint(brushId, settings);
    if (latestFingerprint !== fingerprint) {
      return this.render(brushId, canvas, settings);
    }

    canvas.width = BRUSH_LIBRARY_PREVIEW_WIDTH;
    canvas.height = BRUSH_LIBRARY_PREVIEW_HEIGHT;
    const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
    if (!context) throw new Error("Brush preview Canvas2D unavailable.");
    context.resetTransform();
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.clearRect(0, 0, BRUSH_LIBRARY_PREVIEW_WIDTH, BRUSH_LIBRARY_PREVIEW_HEIGHT);

    this.prepareTip(settings, sources.shape);
    this.drawFixedStroke(context, settings, fingerprint);
    if (sources.grain && settings.grainMode !== "off") {
      this.applyGrain(context, settings, sources.grain);
    }

    const pixels = context.getImageData(
      0,
      0,
      BRUSH_LIBRARY_PREVIEW_WIDTH,
      BRUSH_LIBRARY_PREVIEW_HEIGHT,
    ).data;
    const pixelHash = hashBrushLibraryPreviewPixels(pixels);
    const previousRenderCount = this.cards.get(brushId)?.renderCount ?? 0;
    const entry: PreviewCardCacheEntry = {
      canvas,
      fingerprint,
      pixelHash,
      renderCount: previousRenderCount + 1,
      sourceComplete: sources.complete,
      lastUsed: ++this.usageClock,
    };
    this.cards.set(brushId, entry);
    this.evictCards(brushId);
    this.totalRenderCount += 1;
    canvas.dataset.previewFingerprint = fingerprint;
    canvas.dataset.previewPixelHash = pixelHash;
    canvas.dataset.previewRenderCount = String(entry.renderCount);
    canvas.dataset.previewSourceComplete = String(sources.complete);
    return {
      fingerprint,
      pixelHash,
      rendered: true,
      renderCount: entry.renderCount,
      sourceComplete: sources.complete,
    };
  }

  private async resolveSources(
    brushId: string,
    settings: Readonly<BrushSettings>,
  ): Promise<PreviewSources> {
    const shapeRequired = settings.shape === "shape";
    const grainRequired = settings.grainMode !== "off";
    const [shape, grain] = await Promise.all([
      shapeRequired
        ? this.resolveAsset(brushId, "shape", settings.shapeAssetId)
        : Promise.resolve(null),
      grainRequired
        ? this.resolveAsset(brushId, "grain", settings.grainAssetId)
        : Promise.resolve(null),
    ]);
    return {
      shape,
      grain,
      complete: (!shapeRequired || shape !== null) && (!grainRequired || grain !== null),
    };
  }

  private resolveAsset(
    brushId: string,
    kind: BrushStudioAssetKind,
    assetId: string,
  ): Promise<PreviewAsset | null> {
    const cacheKey = `${kind}:${assetId}`;
    const cached = this.assets.get(cacheKey);
    if (cached) {
      cached.lastUsed = ++this.usageClock;
      return Promise.resolve(cached);
    }
    const pending = this.pendingAssets.get(cacheKey);
    if (pending) return pending;
    const task = this.loadAsset(brushId, kind, assetId)
      .then((asset) => {
        if (!asset) return null;
        asset.lastUsed = ++this.usageClock;
        this.assets.set(cacheKey, asset);
        this.evictAssets(cacheKey);
        return asset;
      })
      .catch(() => null)
      .finally(() => this.pendingAssets.delete(cacheKey));
    this.pendingAssets.set(cacheKey, task);
    return task;
  }

  private async loadAsset(
    brushId: string,
    kind: BrushStudioAssetKind,
    assetId: string,
  ): Promise<PreviewAsset | null> {
    const descriptor = STATIC_ASSETS[assetId as keyof typeof STATIC_ASSETS];
    if (descriptor) {
      if (descriptor.kind !== kind) return null;
      const response = await fetch(descriptor.url);
      if (!response.ok) throw new Error(`Brush preview asset ${assetId} unavailable.`);
      return {
        canvas: await imageBlobToPreviewCanvas(await response.blob()),
        authoredInvert: descriptor.authoredInvert,
        sourceWidth: descriptor.sourceWidth,
        lastUsed: 0,
      };
    }

    const saved = loadBrushStudioSavedBrush(brushId);
    const storedKey = kind === "shape" ? saved?.shapeAssetKey : saved?.grainAssetKey;
    if (!storedKey || !storedKey.includes(assetId)) return null;
    const stored = await loadBrushStudioAsset(storedKey);
    if (!stored || stored.kind !== kind) return null;
    return {
      canvas: await imageBlobToPreviewCanvas(stored.blob),
      authoredInvert: false,
      sourceWidth: Math.max(
        1,
        Number.parseInt(/^custom-(?:shape|grain):(\d+)x/.exec(assetId)?.[1] ?? "", 10)
          || (kind === "shape" ? 2048 : BRUSH_LIBRARY_PREVIEW_ASSET_SIZE),
      ),
      lastUsed: 0,
    };
  }

  private prepareTip(settings: Readonly<BrushSettings>, shape: PreviewAsset | null): void {
    const context = this.tipScratch.getContext("2d", {
      alpha: true,
      willReadFrequently: true,
    });
    if (!context) return;
    const size = BRUSH_LIBRARY_PREVIEW_ASSET_SIZE;
    context.resetTransform();
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.clearRect(0, 0, size, size);
    if (settings.shape !== "shape" || !shape) {
      context.fillStyle = "rgb(242 240 233)";
      context.beginPath();
      context.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
      context.fill();
      return;
    }

    context.drawImage(shape.canvas, 0, 0, size, size);
    const pixels = context.getImageData(0, 0, size, size);
    const invert = shape.authoredInvert !== settings.shapeInvert;
    for (let offset = 0; offset < pixels.data.length; offset += 4) {
      const luminance = Math.round(
        pixels.data[offset] * 0.2126
        + pixels.data[offset + 1] * 0.7152
        + pixels.data[offset + 2] * 0.0722,
      );
      const coverage = invert ? 255 - luminance : luminance;
      pixels.data[offset] = 242;
      pixels.data[offset + 1] = 240;
      pixels.data[offset + 2] = 233;
      pixels.data[offset + 3] = Math.round(coverage * pixels.data[offset + 3] / 255);
    }
    context.clearRect(0, 0, size, size);
    context.putImageData(pixels, 0, 0);
  }

  private drawFixedStroke(
    context: CanvasRenderingContext2D,
    settings: Readonly<BrushSettings>,
    fingerprint: string,
  ): void {
    const width = BRUSH_LIBRARY_PREVIEW_WIDTH;
    const height = BRUSH_LIBRARY_PREVIEW_HEIGHT;
    const sizeRatio = clamp01(Math.log10(Math.max(1, settings.size)) / 3);
    const baseDiameter = Math.min(height * 0.82, Math.max(10, height * (0.25 + sizeRatio * 0.48)));
    const startX = Math.max(3, baseDiameter * 0.42);
    const endX = Math.max(startX + 1, width - startX);
    const pathLength = endX - startX;
    const spacingPixels = Math.max(
      1.35,
      baseDiameter * Math.max(0.25, settings.spacingPercent) / 100,
    );
    const stampCount = Math.min(96, Math.max(2, Math.ceil(pathLength / spacingPixels)));
    const copies = Math.min(4, Math.max(1, Math.round(settings.count)));
    const seedBase = Number.parseInt(fingerprint, 16) >>> 0;
    const baseAlpha = Math.max(0.025, clamp01(settings.flow) * clamp01(settings.opacity));
    const y0 = height * 0.63;
    const y1 = height * 0.27;
    const y2 = height * 0.75;
    const y3 = height * 0.43;

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    for (let stampIndex = 0; stampIndex < stampCount; stampIndex += 1) {
      const progress = stampIndex / (stampCount - 1);
      const centerX = startX + pathLength * progress;
      const centerY = cubicBezier(y0, y1, y2, y3, progress);
      const tangentY = cubicBezierDerivative(y0, y1, y2, y3, progress);
      const followAngle = settings.shapeRotation === "follow-stroke"
        ? Math.atan2(tangentY, pathLength)
        : 0;
      const thickness = (
        settings.startThickness
        + (settings.endThickness - settings.startThickness) * progress
      );
      const diameter = Math.min(height * 0.92, Math.max(2.5, baseDiameter * Math.max(0.05, thickness)));
      for (let copy = 0; copy < copies; copy += 1) {
        const lane = stampIndex * 11 + copy * 193;
        const longitudinal = (
          brushLibraryPreviewRandom(seedBase, lane) - 0.5
        ) * diameter * clamp01(settings.positionJitterLinear) * 0.18;
        const lateral = (
          brushLibraryPreviewRandom(seedBase, lane + 1) - 0.5
        ) * diameter * clamp01(settings.positionJitterLateral) * 0.3;
        const rotation = followAngle + (
          brushLibraryPreviewRandom(seedBase, lane + 2) - 0.5
        ) * Math.PI * 2 * clamp01(settings.shapeScatter);
        const darkness = 1 - (
          brushLibraryPreviewRandom(seedBase, lane + 3)
          * clamp01(settings.darknessJitter)
          * 0.7
        );
        context.save();
        context.globalAlpha = baseAlpha * darkness;
        context.translate(centerX + longitudinal, centerY + lateral);
        context.rotate(rotation);
        context.drawImage(this.tipScratch, -diameter / 2, -diameter / 2, diameter, diameter);
        context.restore();
      }
    }
    context.globalAlpha = 1;
  }

  private applyGrain(
    output: CanvasRenderingContext2D,
    settings: Readonly<BrushSettings>,
    grain: PreviewAsset,
  ): void {
    const tile = this.tipScratch.getContext("2d", {
      alpha: true,
      willReadFrequently: true,
    });
    const mask = this.grainMaskScratch.getContext("2d", { alpha: true });
    if (!tile || !mask) return;
    const sourceSize = BRUSH_LIBRARY_PREVIEW_ASSET_SIZE;
    tile.resetTransform();
    tile.globalAlpha = 1;
    tile.globalCompositeOperation = "source-over";
    tile.clearRect(0, 0, sourceSize, sourceSize);
    tile.drawImage(grain.canvas, 0, 0, sourceSize, sourceSize);
    const pixels = tile.getImageData(0, 0, sourceSize, sourceSize);
    const depth = clamp01(settings.grainDepth);
    const contrast = Math.max(-1, Math.min(1, settings.grainContrast));
    const brightness = Math.max(-1, Math.min(1, settings.grainBrightness));
    for (let offset = 0; offset < pixels.data.length; offset += 4) {
      let value = (
        pixels.data[offset] * 0.299
        + pixels.data[offset + 1] * 0.587
        + pixels.data[offset + 2] * 0.114
      ) / 255;
      value = (value - 0.5) * (1 + contrast) + 0.5 + brightness;
      value = clamp01(settings.grainInvert ? 1 - value : value);
      const coverage = (1 - depth) + value * depth;
      pixels.data[offset] = 255;
      pixels.data[offset + 1] = 255;
      pixels.data[offset + 2] = 255;
      pixels.data[offset + 3] = Math.round(coverage * 255);
    }
    tile.putImageData(pixels, 0, 0);

    const sizeRatio = clamp01(Math.log10(Math.max(1, settings.size)) / 3);
    const baseDiameter = Math.min(
      BRUSH_LIBRARY_PREVIEW_HEIGHT * 0.82,
      Math.max(10, BRUSH_LIBRARY_PREVIEW_HEIGHT * (0.25 + sizeRatio * 0.48)),
    );
    const documentScale = baseDiameter / Math.max(1, settings.size);
    const period = Math.max(
      8,
      Math.min(
        BRUSH_LIBRARY_PREVIEW_WIDTH * 0.7,
        grain.sourceWidth * Math.max(0.1, settings.grainScale) * documentScale,
      ),
    );
    const movement = settings.grainMode === "moving" ? clamp01(settings.grainMovement) : 1;
    const phaseX = -period * (0.31 + (1 - movement) * 0.17);
    const phaseY = -period * (0.57 - (1 - movement) * 0.13);
    mask.resetTransform();
    mask.globalAlpha = 1;
    mask.globalCompositeOperation = "source-over";
    mask.clearRect(0, 0, BRUSH_LIBRARY_PREVIEW_WIDTH, BRUSH_LIBRARY_PREVIEW_HEIGHT);
    mask.imageSmoothingEnabled = settings.grainFiltering !== "no";
    mask.imageSmoothingQuality = settings.grainFiltering === "improved" ? "high" : "low";
    for (let y = phaseY; y < BRUSH_LIBRARY_PREVIEW_HEIGHT; y += period) {
      for (let x = phaseX; x < BRUSH_LIBRARY_PREVIEW_WIDTH; x += period) {
        mask.drawImage(this.tipScratch, x, y, period, period);
      }
    }
    output.save();
    output.globalAlpha = 1;
    output.globalCompositeOperation = "destination-in";
    output.drawImage(this.grainMaskScratch, 0, 0);
    output.restore();
  }

  private evictCards(protectedId: string): void {
    while (this.cards.size > BRUSH_LIBRARY_PREVIEW_MAX_CARDS) {
      const victim = [...this.cards.entries()]
        .filter(([id]) => id !== protectedId)
        .sort((left, right) => left[1].lastUsed - right[1].lastUsed)[0];
      if (!victim) return;
      victim[1].canvas.width = 1;
      victim[1].canvas.height = 1;
      this.cards.delete(victim[0]);
    }
  }

  private evictAssets(protectedKey: string): void {
    while (this.assets.size > BRUSH_LIBRARY_PREVIEW_MAX_ASSETS) {
      const victim = [...this.assets.entries()]
        .filter(([key]) => key !== protectedKey)
        .sort((left, right) => left[1].lastUsed - right[1].lastUsed)[0];
      if (!victim) return;
      victim[1].canvas.width = 1;
      victim[1].canvas.height = 1;
      this.assets.delete(victim[0]);
    }
  }
}
