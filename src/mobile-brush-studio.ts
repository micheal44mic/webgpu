import {
  isCustomGrainAssetId,
  isCustomShapeAssetId,
  type CustomBrushAssetSnapshot,
  type DecodedCustomBrushImage,
} from "./brush-asset-registry";
import {
  builtinBrushAssetUrl,
  isBuiltinBrushAssetId,
} from "./brush-builtin-assets.ts";
import {
  isBrushStudioCustomBrushId,
  normalizeBrushStudioCustomBrushName,
} from "./brush-catalog.ts";
import {
  brushDefinitionSettingsFromRuntime,
  type BrushDefinitionSettings,
} from "./brush-definition.ts";
import { canonicalBrushColor16 } from "./brush-color";
import {
  brushStudioAssetStorageKey,
  deleteBrushStudioAsset,
  deleteBrushStudioSavedBrush,
  loadBrushStudioAsset,
  loadBrushStudioSavedBrush,
  saveBrushStudioAsset,
  saveBrushStudioSavedBrush,
  type BrushStudioAssetKind,
} from "./brush-studio-storage";
import {
  brushSourceDimensionsFromBytes,
  brushSourceResizePlan,
} from "./brush-source-image";
import { shouldCloseMobileToolsSheetDrag } from "./mobile-tools-sheet-gesture";
import type {
  BrushSettings,
  BrushGrainAssetId,
  BrushShapeAssetId,
  BrushShapeMaskFormat,
  CustomBrushGrainAssetId,
  CustomBrushShapeAssetId,
  GrainMode,
} from "./engine-types";
import { shapeMaskFormatForSettings } from "./engine-brush-assets";
import { decodeGrayscalePng } from "./png-mask";

type BrushStudioTab = "stroke" | "shape" | "grain" | "dynamics";
type BrushStudioSourceKind = "shape" | "grain";
type BrushStudioCanvasSource = HTMLCanvasElement | HTMLImageElement;

interface ImportedBrushStudioAsset {
  readonly kind: BrushStudioAssetKind;
  readonly blob: Blob;
  readonly name: string;
}

export interface MobileBrushStudioOptions {
  readonly settings: MobileBrushStudioSettingsPort;
  readonly assets: MobileBrushStudioAssetPort;
  readonly runtime: MobileBrushStudioRuntimePort;
  readonly previewRenderer: MobileBrushStudioPreviewPort;
  readonly root: HTMLElement;
  readonly appRoot: HTMLElement;
  readonly browser: MobileBrushStudioBrowser;
  getBrushPrecision(): BrushShapeMaskFormat;
  readonly applySettings: (settings: BrushSettings) => void;
  readonly setBrushLibraryOpen: (open: boolean) => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCommit: (
    brushId: string,
    brushName: string,
    settings: BrushSettings,
  ) => void | Promise<void>;
  readonly onCommitted: (
    brushId: string,
    brushName: string,
    settings: BrushSettings,
  ) => void;
  readonly onStatus: (message: string, kind: "ok" | "error" | "working") => void;
}

export interface MobileBrushStudioBrowser extends Window {
  readonly AbortController: typeof AbortController;
  readonly Image: typeof Image;
  readonly URL: typeof URL;
}

export interface MobileBrushStudioSettingsPort {
  getSettings(): BrushSettings;
}

export interface MobileBrushStudioAssetPort {
  registerCustomShapeAsset(
    source: DecodedCustomBrushImage,
    requestedId?: CustomBrushShapeAssetId,
  ): CustomBrushShapeAssetId;
  registerCustomGrainAsset(
    source: DecodedCustomBrushImage,
    requestedId?: CustomBrushGrainAssetId,
  ): CustomBrushGrainAssetId;
  getCustomBrushAsset(
    id: BrushShapeAssetId | BrushGrainAssetId,
  ): CustomBrushAssetSnapshot | null;
  hasCustomBrushAsset(id: BrushShapeAssetId | BrushGrainAssetId): boolean;
  removeCustomBrushAsset(id: BrushShapeAssetId | BrushGrainAssetId): boolean;
}

export interface MobileBrushStudioRuntimePort {
  waitForIdle(): Promise<void>;
}

export interface MobileBrushStudioPreviewPort {
  render(canvas: HTMLCanvasElement, settings: Readonly<BrushSettings>): Promise<unknown>;
  invalidate(canvas: HTMLCanvasElement): void;
}

const MAX_IMPORTED_SOURCE_BYTES = 64 * 1024 * 1024;
const BRUSH_SOURCE_HEADER_BYTES = 4 * 1024 * 1024;
const BRUSH_SOURCE_FALLBACK_MAX_INPUT_PIXELS = 8_388_608;

/** Freno all'eco delle statistiche del motore: vedi notifyEngineUpdate(). */
const ENGINE_NOTIFY_PREVIEW_INTERVAL_MS = 200;

function requiredDescendant<T extends HTMLElement>(root: HTMLElement, id: string): T {
  const value = root.querySelector<HTMLElement>(`#${id}`);
  if (!value) throw new Error(`Brush Studio element #${id} was not found.`);
  return value as T;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function percent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

function signedPercent(value: number): string {
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

function brushColor16Channels(color: string): readonly [number, number, number] {
  const canonical = canonicalBrushColor16(color).slice(1);
  return [
    Number.parseInt(canonical.slice(0, 4), 16),
    Number.parseInt(canonical.slice(4, 8), 16),
    Number.parseInt(canonical.slice(8, 12), 16),
  ];
}

function brushColor16FromChannels(red: number, green: number, blue: number): string {
  const channel = (value: number): string => Math.round(clamp(value, 0, 65_535))
    .toString(16)
    .padStart(4, "0");
  return `#${channel(red)}${channel(green)}${channel(blue)}`;
}

function settingsForPersistence(settings: BrushSettings): BrushDefinitionSettings {
  return brushDefinitionSettingsFromRuntime(settings);
}

function loadImage(browser: MobileBrushStudioBrowser, url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new browser.Image();
    image.decoding = "async";
    const cleanup = (): void => {
      image.removeEventListener("load", handleLoad);
      image.removeEventListener("error", handleError);
    };
    const handleLoad = (): void => {
      cleanup();
      resolve(image);
    };
    const handleError = (): void => {
      cleanup();
      reject(new Error("Image decode failed."));
    };
    image.addEventListener("load", handleLoad, { once: true });
    image.addEventListener("error", handleError, { once: true });
    image.src = url;
  });
}

async function decodeBrushSource(
  browser: MobileBrushStudioBrowser,
  document: Document,
  blob: Blob,
  name: string,
): Promise<DecodedCustomBrushImage> {
  const header = new Uint8Array(await blob.slice(0, BRUSH_SOURCE_HEADER_BYTES).arrayBuffer());
  const dimensions = brushSourceDimensionsFromBytes(header);
  if (!dimensions) {
    throw new Error("The selected image dimensions could not be read safely.");
  }
  const plan = brushSourceResizePlan(dimensions.width, dimensions.height);
  const directGrayscalePng = header.length >= 29
    && header[0] === 0x89
    && header[1] === 0x50
    && header[2] === 0x4e
    && header[3] === 0x47
    && (header[24] === 8 || header[24] === 16)
    && header[25] === 0
    && header[28] === 0;
  if (directGrayscalePng) {
    if (plan.width !== plan.sourceWidth || plan.height !== plan.sourceHeight) {
      throw new Error(
        "A native grayscale PNG must be at most 2048 px per side to preserve its samples.",
      );
    }
    const decoded = await decodeGrayscalePng(await blob.arrayBuffer());
    const rgba = new Uint8Array(decoded.pixels.length * 4);
    for (
      let pixelIndex = 0, rgbaIndex = 0;
      pixelIndex < decoded.pixels.length;
      pixelIndex += 1, rgbaIndex += 4
    ) {
      const value = Math.round(decoded.pixels[pixelIndex] / 257);
      rgba[rgbaIndex] = value;
      rgba[rgbaIndex + 1] = value;
      rgba[rgbaIndex + 2] = value;
      rgba[rgbaIndex + 3] = 255;
    }
    return {
      width: decoded.width,
      height: decoded.height,
      scalar16: decoded.pixels,
      sourceBitDepth: decoded.sourceBitDepth,
      rgba,
      name,
      mimeType: "image/png",
    };
  }
  let source: ImageBitmap | HTMLImageElement | null = null;
  let objectUrl: string | null = null;
  try {
    if (typeof browser.createImageBitmap === "function") {
      try {
        // Shape and Grain channels are coverage data, not display colors.
        // Preserve the authored bytes instead of baking ICC/premultiplication.
        source = await browser.createImageBitmap(blob, {
          colorSpaceConversion: "none",
          imageOrientation: "none",
          premultiplyAlpha: "none",
          resizeWidth: plan.width,
          resizeHeight: plan.height,
          resizeQuality: "high",
        });
      } catch {
        try {
          // Older WebKit builds can expose createImageBitmap while rejecting
          // newer decode options. Keep those devices on the previous bounded
          // decode path rather than making custom sources unavailable.
          source = await browser.createImageBitmap(blob, {
            imageOrientation: "none",
            premultiplyAlpha: "none",
            resizeWidth: plan.width,
            resizeHeight: plan.height,
            resizeQuality: "high",
          });
        } catch {
          source = null;
        }
      }
    }
    if (!source) {
      if (plan.sourceWidth * plan.sourceHeight > BRUSH_SOURCE_FALLBACK_MAX_INPUT_PIXELS) {
        throw new Error(
          "Resize this image below 8 megapixels before importing it on this device.",
        );
      }
      const fallbackUrl = browser.URL.createObjectURL(blob);
      objectUrl = fallbackUrl;
      source = await loadImage(browser, fallbackUrl);
    }
    const canvas = document.createElement("canvas");
    canvas.width = plan.width;
    canvas.height = plan.height;
    const context = canvas.getContext("2d", {
      alpha: true,
      willReadFrequently: true,
    });
    if (!context) throw new Error("Canvas 2D is unavailable for this image.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(source, 0, 0, plan.width, plan.height);
    return {
      width: plan.width,
      height: plan.height,
      rgba: context.getImageData(0, 0, plan.width, plan.height).data,
      name,
      mimeType: blob.type || "image/png",
    };
  } finally {
    if (source && "close" in source) source.close();
    if (objectUrl) browser.URL.revokeObjectURL(objectUrl);
  }
}

function canvasFromRgba(
  document: Document,
  width: number,
  height: number,
  rgba: Uint8Array | Uint8ClampedArray,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: true });
  if (context) {
    const image = context.createImageData(width, height);
    image.data.set(rgba);
    context.putImageData(image, 0, 0);
  }
  return canvas;
}

function normalizedBrushSourceBlob(
  document: Document,
  source: DecodedCustomBrushImage,
  originalBlob?: Blob,
): Promise<Blob> {
  if (source.scalar16 && originalBlob) {
    return Promise.resolve(originalBlob.slice(0, originalBlob.size, "image/png"));
  }
  if (!source.rgba) {
    return Promise.reject(new Error("The brush source has no display proxy."));
  }
  const canvas = canvasFromRgba(document, source.width, source.height, source.rgba);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The normalized brush source could not be encoded."));
    }, "image/png");
  });
}

export class MobileBrushStudioController {
  readonly sheet: HTMLElement;
  readonly handle: HTMLButtonElement;
  readonly cancelButton: HTMLButtonElement;
  readonly doneButton: HTMLButtonElement;
  readonly nameElement: HTMLInputElement;
  readonly statusElement: HTMLParagraphElement;
  readonly previewCanvas: HTMLCanvasElement;
  readonly scrollElement: HTMLElement;
  readonly tabs: HTMLButtonElement[];
  readonly panels: HTMLElement[];
  readonly renderingButtons: HTMLButtonElement[];
  readonly shapeRotationButtons: HTMLButtonElement[];
  readonly grainModeButtons: HTMLButtonElement[];

  private readonly browser: MobileBrushStudioBrowser;
  private readonly document: Document;
  private readonly appRoot: HTMLElement;
  private readonly eventAbortController: AbortController;
  private readonly settingsCache = new Map<string, BrushSettings>();
  private readonly importedAssets = new Map<string, ImportedBrushStudioAsset>();
  private readonly transientAssetIds = new Set<string>();
  private readonly imagePromises = new Map<string, Promise<HTMLImageElement>>();
  private readonly sourceCanvases = new Map<string, HTMLCanvasElement>();
  private readonly resolvedSources = new Map<string, BrushStudioCanvasSource>();
  private lastEngineNotifyAt = 0;

  private openState = false;
  private activeBrushId = "current";
  private activeBrushName = "Default Brush";
  private originalSettings: BrushSettings | null = null;
  private draftSettings: BrushSettings | null = null;
  private applyFrame: number | null = null;
  private previewFrame: number | null = null;
  private rootScrollFrame: number | null = null;
  private previewInFlight = false;
  private previewDirty = false;
  private commitPromise: Promise<void> | null = null;
  private importPromise: Promise<void> | null = null;
  private disposePromise: Promise<void> | null = null;
  private assetReleasePromise: Promise<void> | null = null;
  private assetReleaseRequested = false;
  private sourcePreviewRevision = 0;
  private importRevision = 0;
  private busy = false;
  private offsetPx = 0;
  private dragPointerId: number | null = null;
  private dragStartY = 0;
  private dragStartOffsetPx = 0;
  private dragLastY = 0;
  private dragLastTime = 0;
  private dragVelocityY = 0;
  private dragMoved = false;
  private disposed = false;

  constructor(private readonly options: MobileBrushStudioOptions) {
    this.sheet = options.root;
    this.browser = options.browser;
    this.document = options.root.ownerDocument;
    this.appRoot = options.appRoot;
    this.eventAbortController = new options.browser.AbortController();
    this.handle = requiredDescendant<HTMLButtonElement>(this.sheet, "mobileBrushStudioHandle");
    this.cancelButton = requiredDescendant<HTMLButtonElement>(this.sheet, "mobileBrushStudioCancel");
    this.doneButton = requiredDescendant<HTMLButtonElement>(this.sheet, "mobileBrushStudioDone");
    this.nameElement = requiredDescendant<HTMLInputElement>(this.sheet, "mobileBrushStudioName");
    this.statusElement = requiredDescendant<HTMLParagraphElement>(this.sheet, "mobileBrushStudioStatus");
    this.previewCanvas = requiredDescendant<HTMLCanvasElement>(this.sheet, "mobileBrushStudioPreviewCanvas");
    this.scrollElement = requiredDescendant<HTMLElement>(this.sheet, "mobileBrushStudioScroll");
    this.tabs = Array.from(
      this.sheet.querySelectorAll<HTMLButtonElement>("[data-mobile-brush-studio-tab]"),
    );
    this.panels = Array.from(
      this.sheet.querySelectorAll<HTMLElement>("[data-mobile-brush-studio-panel]"),
    );
    this.renderingButtons = Array.from(
      this.sheet.querySelectorAll<HTMLButtonElement>("[data-mobile-brush-rendering]"),
    );
    this.shapeRotationButtons = Array.from(
      this.sheet.querySelectorAll<HTMLButtonElement>("[data-mobile-brush-shape-rotation]"),
    );
    this.grainModeButtons = Array.from(
      this.sheet.querySelectorAll<HTMLButtonElement>("[data-mobile-brush-grain-mode]"),
    );
    this.bindControls();
    this.setTab("stroke", false);
    this.sheet.setAttribute("aria-hidden", "true");
  }

  get isOpen(): boolean {
    return this.openState;
  }

  get isBusy(): boolean {
    return this.busy;
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    if (this.disposed) return Promise.resolve();
    const original = this.originalSettings
      ? this.withBrushPrecision(this.originalSettings)
      : undefined;
    this.disposed = true;
    this.importRevision += 1;
    this.sourcePreviewRevision += 1;
    if (this.openState) {
      this.closeSheet();
      if (original) this.options.applySettings(original);
    } else {
      this.cancelScheduledWork();
    }
    this.eventAbortController.abort();
    this.disposePromise = (async () => {
      await Promise.allSettled([
        this.commitPromise ?? Promise.resolve(),
        this.importPromise ?? Promise.resolve(),
      ]);
      await this.requestTransientAssetRelease();
      this.settingsCache.clear();
      this.importedAssets.clear();
      this.imagePromises.clear();
      this.sourceCanvases.clear();
      this.resolvedSources.clear();
    })();
    return this.disposePromise;
  }

  rememberSettings(brushId: string, settings: Readonly<BrushSettings>): void {
    this.settingsCache.set(brushId, this.withBrushPrecision(settings));
  }

  forgetSettings(brushId: string): void {
    this.settingsCache.delete(brushId);
  }

  settingsSnapshot(
    brushId: string,
    fallback: Readonly<BrushSettings>,
  ): BrushSettings {
    const cached = this.settingsCache.get(brushId);
    if (cached) {
      return this.withBrushPrecision({
        ...cached,
        tool: "paint",
        color: fallback.color,
        hardness: 1,
      });
    }
    const saved = loadBrushStudioSavedBrush(brushId);
    if (!saved) {
      return this.withBrushPrecision({ ...fallback, tool: "paint", hardness: 1 });
    }
    return this.withBrushPrecision({
      ...fallback,
      ...saved.settings,
      tool: "paint",
      color: fallback.color,
      hardness: 1,
    });
  }

  async resolveBrushSettings(
    brushId: string,
    fallback: Readonly<BrushSettings>,
  ): Promise<BrushSettings> {
    this.assertUsable();
    const cached = this.settingsCache.get(brushId);
    if (cached) {
      return this.withBrushPrecision({
        ...cached,
        tool: "paint",
        color: fallback.color,
        hardness: 1,
      });
    }

    const saved = loadBrushStudioSavedBrush(brushId);
    if (!saved) {
      const resolved = this.withBrushPrecision({
        ...fallback,
        tool: "paint" as const,
        hardness: 1,
      });
      this.rememberSettings(brushId, resolved);
      return resolved;
    }

    const resolved: BrushSettings = {
      ...fallback,
      ...saved.settings,
      tool: "paint",
      color: fallback.color,
      hardness: 1,
    };
    try {
      await this.restoreSavedAsset(brushId, "shape", saved.shapeAssetKey, resolved);
      await this.restoreSavedAsset(brushId, "grain", saved.grainAssetKey, resolved);
    } catch (error) {
      await this.releasePreviewAssets(brushId, resolved);
      throw error;
    }
    this.assertUsable();
    resolved.shapeMaskFormat = this.options.getBrushPrecision();
    this.rememberSettings(brushId, resolved);
    return this.withBrushPrecision(resolved);
  }

  async releasePreviewAssets(
    brushId: string,
    settings: Readonly<BrushSettings>,
  ): Promise<void> {
    const candidates = new Set<CustomBrushShapeAssetId | CustomBrushGrainAssetId>();
    if (
      isCustomShapeAssetId(settings.shapeAssetId)
      && this.options.assets.hasCustomBrushAsset(settings.shapeAssetId)
    ) {
      candidates.add(settings.shapeAssetId);
    }
    if (
      isCustomGrainAssetId(settings.grainAssetId)
      && this.options.assets.hasCustomBrushAsset(settings.grainAssetId)
    ) {
      candidates.add(settings.grainAssetId);
    }
    if (candidates.size === 0) return;

    const activeSettings = this.options.settings.getSettings();
    if (isCustomShapeAssetId(activeSettings.shapeAssetId)) {
      candidates.delete(activeSettings.shapeAssetId);
    }
    if (isCustomGrainAssetId(activeSettings.grainAssetId)) {
      candidates.delete(activeSettings.grainAssetId);
    }
    if (candidates.size === 0) return;
    for (const assetId of candidates) this.transientAssetIds.add(assetId);
    await this.requestTransientAssetRelease();
    const allReleased = [...candidates].every(
      (assetId) => !this.options.assets.hasCustomBrushAsset(assetId),
    );
    if (allReleased) this.settingsCache.delete(brushId);
  }

  retryPendingAssetRelease(): void {
    if (this.transientAssetIds.size > 0) void this.requestTransientAssetRelease();
  }

  open(
    brushId: string,
    brushName: string,
    settings: Readonly<BrushSettings>,
    originalSettings: Readonly<BrushSettings> = settings,
  ): void {
    if (this.disposed || this.busy) return;
    this.activeBrushId = brushId;
    this.activeBrushName = brushName;
    this.originalSettings = this.withBrushPrecision(originalSettings);
    this.draftSettings = this.withBrushPrecision({ ...settings, tool: "paint", hardness: 1 });
    this.openState = true;
    this.nameElement.value = brushName;
    this.nameElement.readOnly = !isBrushStudioCustomBrushId(brushId);
    this.reportStatus("", "ok");
    this.setBusy(false);
    this.populateControls(this.draftSettings);
    this.setTab("stroke", false);
    this.setOffset(0);
    this.sheet.setAttribute("aria-hidden", "false");
    this.handle.setAttribute("aria-expanded", "true");
    this.options.setBrushLibraryOpen(false);
    void this.sheet.offsetHeight;
    this.sheet.classList.add("is-open");
    this.scrollElement.scrollTop = 0;
    this.schedulePreview();
    void this.drawSourcePreviews();
    this.options.onOpenChange(true);
  }

  cancel(reopenLibrary = true): void {
    if (!this.openState || this.busy) return;
    this.importRevision += 1;
    this.cancelScheduledWork();
    const original = this.originalSettings;
    this.closeSheet();
    if (original) this.options.applySettings(this.withBrushPrecision(original));
    void this.requestTransientAssetRelease();
    if (reopenLibrary) {
      this.options.setBrushLibraryOpen(true);
    }
  }

  notifyEngineUpdate(): void {
    if (!this.openState) return;
    // Il motore pubblica le statistiche alla fine di OGNI frame, e ogni modifica
    // del draft ne provoca uno: senza freno questo callback raddoppiava i
    // renderPreview per ogni evento slider. Le mutazioni del draft pianificano
    // gia il proprio preview, quindi qui resta solo da raccogliere cio che
    // cambia lato motore senza passare dal draft — in pratica la punta
    // ripubblicata al termine di un caricamento di shape asincrono, che puo
    // arrivare con un ritardo impercettibile.
    const now = this.browser.performance.now();
    if (now - this.lastEngineNotifyAt < ENGINE_NOTIFY_PREVIEW_INTERVAL_MS) return;
    this.lastEngineNotifyAt = now;
    this.schedulePreview();
  }

  handleResize(): void {
    if (!this.openState || this.dragPointerId !== null) return;
    this.setOffset(0);
    this.schedulePreview();
  }

  private bindControls(): void {
    this.listen(this.cancelButton, "click", () => this.cancel(true));
    this.listen(this.doneButton, "click", () => void this.requestCommit());

    for (const tab of this.tabs) {
      this.listen(tab, "click", () => {
        const value = tab.dataset.mobileBrushStudioTab;
        if (value === "stroke" || value === "shape" || value === "grain" || value === "dynamics") {
          this.setTab(value, false);
        }
      });
      this.listen(tab, "keydown", (event) => this.handleTabKeydown(event, tab));
    }

    this.bindColor16Controls();

    this.bindRange("mobileBrushStudioSize", "mobileBrushStudioSizeOut", (value) => {
      this.changeDraft((draft) => { draft.size = value; });
    }, (value) => `${Math.round(value)} px`);
    this.bindRange("mobileBrushStudioOpacity", "mobileBrushStudioOpacityOut", (value) => {
      this.changeDraft((draft) => { draft.opacity = value / 100; });
    }, percent);
    this.bindRange("mobileBrushStudioStabilization", "mobileBrushStudioStabilizationOut", (value) => {
      this.changeDraft((draft) => { draft.stabilization = value / 100; });
    }, percent);
    this.bindRange("mobileBrushStudioSpacing", "mobileBrushStudioSpacingOut", (value) => {
      this.changeDraft((draft) => { draft.spacingPercent = value; });
    }, percent);
    this.bindRange("mobileBrushStudioFlow", "mobileBrushStudioFlowOut", (value) => {
      this.changeDraft((draft) => { draft.flow = value / 100; });
    }, percent);
    this.bindRange("mobileBrushStudioShapeScatter", "mobileBrushStudioShapeScatterOut", (value) => {
      this.changeDraft((draft) => { draft.shapeScatter = value / 100; });
    }, percent);
    this.bindRange("mobileBrushStudioCount", "mobileBrushStudioCountOut", (value) => {
      this.changeDraft((draft) => { draft.count = Math.round(value); });
    }, (value) => Math.round(value).toString());
    this.bindRange("mobileBrushStudioJitterLateral", "mobileBrushStudioJitterLateralOut", (value) => {
      this.changeDraft((draft) => { draft.positionJitterLateral = value / 100; });
    }, percent);
    this.bindRange("mobileBrushStudioJitterLinear", "mobileBrushStudioJitterLinearOut", (value) => {
      this.changeDraft((draft) => { draft.positionJitterLinear = value / 100; });
    }, percent);
    this.bindRange("mobileBrushStudioGrainScale", "mobileBrushStudioGrainScaleOut", (value) => {
      this.changeDraft((draft) => { draft.grainScale = value / 100; });
    }, percent);
    this.bindRange("mobileBrushStudioGrainMovement", "mobileBrushStudioGrainMovementOut", (value) => {
      this.changeDraft((draft) => { draft.grainMovement = value / 100; });
    }, percent);
    this.bindRange("mobileBrushStudioGrainDepth", "mobileBrushStudioGrainDepthOut", (value) => {
      this.changeDraft((draft) => { draft.grainDepth = value / 100; });
    }, percent);
    this.bindRange("mobileBrushStudioGrainBrightness", "mobileBrushStudioGrainBrightnessOut", (value) => {
      this.changeDraft((draft) => { draft.grainBrightness = value / 100; });
    }, signedPercent);
    this.bindRange("mobileBrushStudioGrainContrast", "mobileBrushStudioGrainContrastOut", (value) => {
      this.changeDraft((draft) => { draft.grainContrast = value / 100; });
    }, signedPercent);
    this.bindRange("mobileBrushStudioHue", "mobileBrushStudioHueOut", (value) => {
      this.changeDraft((draft) => { draft.hueJitterDegrees = value; });
    }, (value) => `${Math.round(value)}°`);
    this.bindRange("mobileBrushStudioSaturation", "mobileBrushStudioSaturationOut", (value) => {
      this.changeDraft((draft) => { draft.saturationJitter = value / 100; });
    }, percent);
    this.bindRange("mobileBrushStudioLightness", "mobileBrushStudioLightnessOut", (value) => {
      this.changeDraft((draft) => { draft.lightnessJitter = value / 100; });
    }, percent);
    this.bindRange("mobileBrushStudioDarkness", "mobileBrushStudioDarknessOut", (value) => {
      this.changeDraft((draft) => { draft.darknessJitter = value / 100; });
    }, percent);
    this.bindRange("mobileBrushStudioStartThickness", "mobileBrushStudioStartThicknessOut", (value) => {
      this.changeDraft((draft) => { draft.startThickness = value / 100; });
    }, percent);
    this.bindRange("mobileBrushStudioEndThickness", "mobileBrushStudioEndThicknessOut", (value) => {
      this.changeDraft((draft) => { draft.endThickness = value / 100; });
    }, percent);

    this.bindCheckbox("mobileBrushStudioShapeInvert", (checked) => {
      this.changeDraft((draft) => { draft.shapeInvert = checked; }, true);
    });
    this.bindCheckbox("mobileBrushStudioGrainInvert", (checked) => {
      this.changeDraft((draft) => { draft.grainInvert = checked; }, true);
    });
    this.bindCheckbox("mobileBrushStudioJitterPerCopy", (checked) => {
      this.changeDraft((draft) => { draft.jitterPerCopy = checked; });
    });

    for (const button of this.renderingButtons) {
      this.listen(button, "click", () => {
        const mode = button.dataset.mobileBrushRendering;
        if (mode !== "light-glaze" && mode !== "uniformed-glaze" && mode !== "intense-blending") return;
        this.changeDraft((draft) => { draft.blendMode = mode; });
        this.syncRadioButtons(this.renderingButtons, "mobileBrushRendering", mode);
      });
    }
    for (const button of this.shapeRotationButtons) {
      this.listen(button, "click", () => {
        const rotation = button.dataset.mobileBrushShapeRotation;
        if (rotation !== "fixed" && rotation !== "follow-stroke") return;
        this.changeDraft((draft) => { draft.shapeRotation = rotation; });
        this.syncRadioButtons(this.shapeRotationButtons, "mobileBrushShapeRotation", rotation);
      });
    }
    for (const button of this.grainModeButtons) {
      this.listen(button, "click", () => {
        const mode = button.dataset.mobileBrushGrainMode;
        if (mode !== "off" && mode !== "texturized" && mode !== "moving") return;
        this.changeDraft((draft) => { draft.grainMode = mode; });
        this.syncRadioButtons(this.grainModeButtons, "mobileBrushGrainMode", mode);
        this.syncGrainAvailability(mode);
      });
    }

    const filtering = this.element<HTMLSelectElement>("mobileBrushStudioGrainFiltering");
    this.listen(filtering, "change", () => {
      const value = filtering.value;
      if (value !== "no" && value !== "classic" && value !== "improved") return;
      this.changeDraft((draft) => { draft.grainFiltering = value; });
    });

    for (const kind of ["shape", "grain"] as const) {
      const fileInput = this.element<HTMLInputElement>(
        kind === "shape" ? "mobileBrushStudioShapeFile" : "mobileBrushStudioGrainFile",
      );
      const sourceButton = this.element<HTMLButtonElement>(
        kind === "shape" ? "mobileBrushStudioShapeSource" : "mobileBrushStudioGrainSource",
      );
      this.listen(sourceButton, "click", () => fileInput.click());
      this.listen(fileInput, "change", () => {
        const file = fileInput.files?.[0];
        fileInput.value = "";
        if (file) void this.requestSourceImport(kind, file);
      });
      const removeButton = this.element<HTMLButtonElement>(
        kind === "shape" ? "mobileBrushStudioShapeRemove" : "mobileBrushStudioGrainRemove",
      );
      this.listen(removeButton, "click", () => this.removeSource(kind));
    }

    this.listen(this.handle, "pointerdown", (event) => this.startDrag(event));
    this.listen(this.handle, "pointermove", (event) => this.moveDrag(event));
    this.listen(this.handle, "pointerup", (event) => this.finishDrag(event));
    this.listen(this.handle, "pointercancel", (event) => this.finishDrag(event, true));
    this.listen(this.handle, "click", () => {
      if (!this.openState) return;
      if (this.dragMoved) {
        this.dragMoved = false;
        return;
      }
      this.cancel(true);
    });
  }

  private bindRange(
    inputId: string,
    outputId: string,
    update: (value: number) => void,
    format: (value: number) => string,
  ): void {
    const input = this.element<HTMLInputElement>(inputId);
    const output = this.element<HTMLOutputElement>(outputId);
    this.listen(input, "input", () => {
      const value = Number(input.value);
      output.value = format(value);
      update(value);
    });
  }

  private bindCheckbox(id: string, update: (checked: boolean) => void): void {
    const input = this.element<HTMLInputElement>(id);
    this.listen(input, "change", () => update(input.checked));
  }

  private bindColor16Controls(): void {
    const hexInput = this.element<HTMLInputElement>("mobileBrushStudioColor16Hex");
    const redInput = this.element<HTMLInputElement>("mobileBrushStudioColor16Red");
    const greenInput = this.element<HTMLInputElement>("mobileBrushStudioColor16Green");
    const blueInput = this.element<HTMLInputElement>("mobileBrushStudioColor16Blue");
    const status = this.element<HTMLOutputElement>("mobileBrushColor16Status");

    const applyHex = (): void => {
      if (!this.draftSettings) return;
      try {
        const color = canonicalBrushColor16(hexInput.value);
        hexInput.removeAttribute("aria-invalid");
        this.changeDraft((draft) => { draft.color = color; });
        if (this.draftSettings) this.syncColor16Controls(this.draftSettings);
      } catch {
        hexInput.setAttribute("aria-invalid", "true");
        status.value = "Enter exactly 12 hexadecimal digits";
      }
    };
    this.listen(hexInput, "change", applyHex);
    this.listen(hexInput, "keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      applyHex();
    });

    const applyChannels = (): void => {
      if (!this.draftSettings) return;
      const channels = [redInput, greenInput, blueInput].map((input) => (
        clamp(Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : 0, 0, 65_535)
      ));
      const color = brushColor16FromChannels(channels[0], channels[1], channels[2]);
      this.changeDraft((draft) => { draft.color = color; });
      if (this.draftSettings) this.syncColor16Controls(this.draftSettings);
    };
    for (const input of [redInput, greenInput, blueInput]) {
      this.listen(input, "change", applyChannels);
    }

    const sampleButton = this.element<HTMLButtonElement>("mobileBrushStudioColor16Sample");
    this.listen(sampleButton, "click", () => {
      this.changeDraft((draft) => {
        draft.color = "#7fff7fff7fff";
        draft.shape = "circle";
        draft.shapeAssetId = "legacy-shape";
        draft.shapeInvert = false;
        draft.shapeRotation = "follow-stroke";
        draft.shapeScatter = 0;
        draft.grainMode = "off";
        draft.grainInvert = false;
        draft.size = 160;
        draft.spacingPercent = 0.5;
        draft.flow = 0.035;
        draft.opacity = 1;
        draft.stabilization = 0;
        draft.count = 1;
        draft.blendMode = "light-glaze";
        draft.hueJitterDegrees = 0;
        draft.saturationJitter = 0;
        draft.lightnessJitter = 0;
        draft.darknessJitter = 0;
        draft.positionJitterLateral = 0;
        draft.positionJitterLinear = 0;
      }, true);
      if (!this.draftSettings) return;
      this.populateControls(this.draftSettings);
      this.reportStatus(
        "Comparison sample ready. Tap Done, then switch 8-bit and 16-bit in Settings.",
        "ok",
      );
    });
  }

  private element<T extends HTMLElement>(id: string): T {
    return requiredDescendant<T>(this.sheet, id);
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error("Brush Studio has been disposed.");
  }

  private withBrushPrecision(settings: Readonly<BrushSettings>): BrushSettings {
    return {
      ...settings,
      shapeMaskFormat: this.options.getBrushPrecision(),
    };
  }

  private requestSourceImport(
    kind: BrushStudioSourceKind,
    file: File,
  ): Promise<void> {
    if (this.disposed || this.importPromise || this.busy) return Promise.resolve();
    const operation = this.importSource(kind, file).finally(() => {
      if (this.importPromise === operation) this.importPromise = null;
    });
    this.importPromise = operation;
    return operation;
  }

  private listen<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
  ): void {
    target.addEventListener(type, listener as EventListener, {
      signal: this.eventAbortController.signal,
    });
  }

  private changeDraft(change: (draft: BrushSettings) => void, redrawSources = false): void {
    if (!this.draftSettings || !this.openState || this.busy || this.disposed) return;
    change(this.draftSettings);
    this.draftSettings.tool = "paint";
    this.draftSettings.hardness = 1;
    this.draftSettings.shapeMaskFormat = this.options.getBrushPrecision();
    this.scheduleApply();
    if (redrawSources) void this.drawSourcePreviews();
  }

  private scheduleApply(): void {
    if (this.disposed) return;
    if (this.applyFrame === null) {
      this.applyFrame = this.browser.requestAnimationFrame(() => {
        this.applyFrame = null;
        this.applyDraftNow();
      });
    }
    this.schedulePreview();
  }

  private applyDraftNow(): void {
    if (!this.openState || !this.draftSettings) return;
    this.draftSettings.shapeMaskFormat = this.options.getBrushPrecision();
    this.options.applySettings(this.withBrushPrecision(this.draftSettings));
    this.schedulePreview();
  }

  private flushDraft(): BrushSettings | null {
    if (this.applyFrame !== null) {
      this.browser.cancelAnimationFrame(this.applyFrame);
      this.applyFrame = null;
      this.applyDraftNow();
    }
    return this.draftSettings ? this.withBrushPrecision(this.draftSettings) : null;
  }

  private populateControls(settings: BrushSettings): void {
    this.setRange("mobileBrushStudioSize", "mobileBrushStudioSizeOut", settings.size, (value) => `${Math.round(value)} px`);
    this.setRange("mobileBrushStudioOpacity", "mobileBrushStudioOpacityOut", settings.opacity * 100, percent);
    this.setRange("mobileBrushStudioStabilization", "mobileBrushStudioStabilizationOut", settings.stabilization * 100, percent);
    this.setRange("mobileBrushStudioSpacing", "mobileBrushStudioSpacingOut", settings.spacingPercent, percent);
    this.setRange("mobileBrushStudioFlow", "mobileBrushStudioFlowOut", settings.flow * 100, percent);
    this.setRange("mobileBrushStudioShapeScatter", "mobileBrushStudioShapeScatterOut", settings.shapeScatter * 100, percent);
    this.setRange("mobileBrushStudioCount", "mobileBrushStudioCountOut", settings.count, (value) => Math.round(value).toString());
    this.setRange("mobileBrushStudioJitterLateral", "mobileBrushStudioJitterLateralOut", settings.positionJitterLateral * 100, percent);
    this.setRange("mobileBrushStudioJitterLinear", "mobileBrushStudioJitterLinearOut", settings.positionJitterLinear * 100, percent);
    this.setRange("mobileBrushStudioGrainScale", "mobileBrushStudioGrainScaleOut", settings.grainScale * 100, percent);
    this.setRange("mobileBrushStudioGrainMovement", "mobileBrushStudioGrainMovementOut", settings.grainMovement * 100, percent);
    this.setRange("mobileBrushStudioGrainDepth", "mobileBrushStudioGrainDepthOut", settings.grainDepth * 100, percent);
    this.setRange("mobileBrushStudioGrainBrightness", "mobileBrushStudioGrainBrightnessOut", settings.grainBrightness * 100, signedPercent);
    this.setRange("mobileBrushStudioGrainContrast", "mobileBrushStudioGrainContrastOut", settings.grainContrast * 100, signedPercent);
    this.setRange("mobileBrushStudioHue", "mobileBrushStudioHueOut", settings.hueJitterDegrees, (value) => `${Math.round(value)}°`);
    this.setRange("mobileBrushStudioSaturation", "mobileBrushStudioSaturationOut", settings.saturationJitter * 100, percent);
    this.setRange("mobileBrushStudioLightness", "mobileBrushStudioLightnessOut", settings.lightnessJitter * 100, percent);
    this.setRange("mobileBrushStudioDarkness", "mobileBrushStudioDarknessOut", settings.darknessJitter * 100, percent);
    this.setRange("mobileBrushStudioStartThickness", "mobileBrushStudioStartThicknessOut", settings.startThickness * 100, percent);
    this.setRange("mobileBrushStudioEndThickness", "mobileBrushStudioEndThicknessOut", settings.endThickness * 100, percent);

    this.element<HTMLInputElement>("mobileBrushStudioShapeInvert").checked = settings.shapeInvert;
    this.element<HTMLInputElement>("mobileBrushStudioGrainInvert").checked = settings.grainInvert;
    this.element<HTMLInputElement>("mobileBrushStudioJitterPerCopy").checked = settings.jitterPerCopy;
    this.element<HTMLSelectElement>("mobileBrushStudioGrainFiltering").value = settings.grainFiltering;
    const rendering = settings.blendMode === "uniformed-glaze" || settings.blendMode === "intense-blending"
      ? settings.blendMode
      : "light-glaze";
    this.syncRadioButtons(this.renderingButtons, "mobileBrushRendering", rendering);
    this.syncRadioButtons(this.shapeRotationButtons, "mobileBrushShapeRotation", settings.shapeRotation);
    this.syncRadioButtons(this.grainModeButtons, "mobileBrushGrainMode", settings.grainMode);
    this.syncGrainAvailability(settings.grainMode);
    this.syncColor16Controls(settings);
    this.syncSourcePrecisionLabels(settings);
  }

  private syncColor16Controls(settings: Readonly<BrushSettings>): void {
    const canonical = canonicalBrushColor16(settings.color);
    const [red, green, blue] = brushColor16Channels(canonical);
    const hexInput = this.element<HTMLInputElement>("mobileBrushStudioColor16Hex");
    hexInput.value = canonical;
    hexInput.removeAttribute("aria-invalid");
    this.element<HTMLInputElement>("mobileBrushStudioColor16Red").value = red.toString();
    this.element<HTMLInputElement>("mobileBrushStudioColor16Green").value = green.toString();
    this.element<HTMLInputElement>("mobileBrushStudioColor16Blue").value = blue.toString();
    const comparing8Bit = shapeMaskFormatForSettings(settings) === "r8unorm";
    const status = this.element<HTMLOutputElement>("mobileBrushColor16Status");
    status.value = comparing8Bit
      ? "8-bit comparison · 16-bit source retained"
      : "16-bit source · Full 16F";
    status.dataset.precision = comparing8Bit ? "compare-8" : "full-16f";
  }

  private syncSourcePrecisionLabels(settings: Readonly<BrushSettings>): void {
    const comparisonSuffix = shapeMaskFormatForSettings(settings) === "r8unorm"
      ? " · 8-bit comparison"
      : " · R16F GPU";
    const shapeLabel = settings.shape === "circle"
      ? `Analytic source${comparisonSuffix}`
      : this.assetPrecisionLabel(settings.shapeAssetId, comparisonSuffix);
    const grainLabel = settings.grainMode === "off"
      ? "Grain off"
      : this.assetPrecisionLabel(settings.grainAssetId, comparisonSuffix);
    this.element<HTMLOutputElement>("mobileBrushStudioShapeSourcePrecision").value = shapeLabel;
    this.element<HTMLOutputElement>("mobileBrushStudioGrainSourcePrecision").value = grainLabel;
  }

  private assetPrecisionLabel(
    assetId: BrushShapeAssetId | BrushGrainAssetId,
    suffix: string,
  ): string {
    const custom = this.options.assets.getCustomBrushAsset(assetId);
    if (custom) {
      return `${custom.sourceBitDepth === 16 ? "Native 16-bit source" : "8-bit source"}${suffix}`;
    }
    if (isCustomShapeAssetId(assetId) || isCustomGrainAssetId(assetId)) {
      return `Custom source pending${suffix}`;
    }
    return `8-bit source${suffix}`;
  }

  private setRange(
    inputId: string,
    outputId: string,
    value: number,
    format: (value: number) => string,
  ): void {
    const input = this.element<HTMLInputElement>(inputId);
    const clamped = clamp(value, Number(input.min), Number(input.max));
    input.value = clamped.toString();
    this.element<HTMLOutputElement>(outputId).value = format(clamped);
  }

  private syncRadioButtons(
    buttons: readonly HTMLButtonElement[],
    datasetKey:
      | "mobileBrushRendering"
      | "mobileBrushShapeRotation"
      | "mobileBrushGrainMode",
    value: string,
  ): void {
    for (const button of buttons) {
      button.setAttribute("aria-checked", String(button.dataset[datasetKey] === value));
    }
  }

  private syncGrainAvailability(mode: GrainMode): void {
    for (const id of [
      "mobileBrushStudioGrainScale",
      "mobileBrushStudioGrainDepth",
      "mobileBrushStudioGrainBrightness",
      "mobileBrushStudioGrainContrast",
      "mobileBrushStudioGrainFiltering",
    ]) {
      this.element<HTMLInputElement | HTMLSelectElement>(id).disabled = mode === "off";
    }
    this.element<HTMLInputElement>("mobileBrushStudioGrainMovement").disabled = mode !== "moving";
  }

  private setTab(tab: BrushStudioTab, focus: boolean): void {
    for (const button of this.tabs) {
      const selected = button.dataset.mobileBrushStudioTab === tab;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      if (selected && focus) button.focus({ preventScroll: true });
    }
    for (const panel of this.panels) {
      panel.hidden = panel.dataset.mobileBrushStudioPanel !== tab;
    }
    this.scrollElement.scrollTop = 0;
    this.resetRootScroll();
  }

  private resetRootScroll(): void {
    this.appRoot.scrollTop = 0;
    if (this.rootScrollFrame !== null) {
      this.browser.cancelAnimationFrame(this.rootScrollFrame);
    }
    this.rootScrollFrame = this.browser.requestAnimationFrame(() => {
      this.rootScrollFrame = null;
      if (this.openState) this.appRoot.scrollTop = 0;
    });
  }

  private handleTabKeydown(event: KeyboardEvent, current: HTMLButtonElement): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    const currentIndex = this.tabs.indexOf(current);
    if (currentIndex < 0) return;
    event.preventDefault();
    let nextIndex = currentIndex;
    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = this.tabs.length - 1;
    else if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % this.tabs.length;
    else nextIndex = (currentIndex - 1 + this.tabs.length) % this.tabs.length;
    const next = this.tabs[nextIndex];
    const value = next?.dataset.mobileBrushStudioTab;
    if (value === "stroke" || value === "shape" || value === "grain" || value === "dynamics") {
      this.setTab(value, true);
    }
  }

  private async importSource(kind: BrushStudioSourceKind, file: File): Promise<void> {
    const declaredType = file.type.trim().toLowerCase();
    if (
      declaredType
      && declaredType !== "application/octet-stream"
      && !declaredType.match(/^image\/(png|jpeg|webp)$/)
    ) {
      this.reportStatus("Choose a PNG, JPEG, or WebP image.", "error");
      return;
    }
    if (file.size > MAX_IMPORTED_SOURCE_BYTES) {
      this.reportStatus("Choose an image smaller than 64 MB.", "error");
      return;
    }
    const revision = ++this.importRevision;
    this.setBusy(true);
    this.reportStatus(`Loading ${kind} source…`, "working");
    try {
      const decoded = await decodeBrushSource(this.browser, this.document, file, file.name);
      if (!this.openState || revision !== this.importRevision || !this.draftSettings) return;
      const normalizedBlob = await normalizedBrushSourceBlob(this.document, decoded, file);
      if (!this.openState || revision !== this.importRevision || !this.draftSettings) return;
      const normalizedDecoded: DecodedCustomBrushImage = {
        ...decoded,
        mimeType: "image/png",
      };
      if (kind === "shape") {
        const id = this.options.assets.registerCustomShapeAsset(normalizedDecoded);
        this.importedAssets.set(id, { kind, blob: normalizedBlob, name: file.name });
        this.transientAssetIds.add(id);
        this.draftSettings.shape = "shape";
        this.draftSettings.shapeAssetId = id;
        this.draftSettings.shapeInvert = false;
        this.element<HTMLInputElement>("mobileBrushStudioShapeInvert").checked = false;
      } else {
        const id = this.options.assets.registerCustomGrainAsset(normalizedDecoded);
        this.importedAssets.set(id, { kind, blob: normalizedBlob, name: file.name });
        this.transientAssetIds.add(id);
        this.draftSettings.grainAssetId = id;
        if (this.draftSettings.grainMode === "off") this.draftSettings.grainMode = "moving";
        this.draftSettings.grainInvert = false;
        this.element<HTMLInputElement>("mobileBrushStudioGrainInvert").checked = false;
        this.syncRadioButtons(this.grainModeButtons, "mobileBrushGrainMode", this.draftSettings.grainMode);
        this.syncGrainAvailability(this.draftSettings.grainMode);
      }
      this.scheduleApply();
      void this.drawSourcePreviews();
      this.reportStatus(`${kind === "shape" ? "Shape" : "Grain"} source ready.`, "ok");
    } catch (error) {
      this.reportStatus(error instanceof Error ? error.message : String(error), "error");
    } finally {
      if (revision === this.importRevision) this.setBusy(false);
    }
  }

  private removeSource(kind: BrushStudioSourceKind): void {
    if (!this.draftSettings) return;
    if (kind === "shape") {
      this.draftSettings.shape = "circle";
      this.draftSettings.shapeAssetId = "legacy-shape";
      this.draftSettings.shapeInvert = false;
      this.element<HTMLInputElement>("mobileBrushStudioShapeInvert").checked = false;
    } else {
      this.draftSettings.grainMode = "off";
      this.draftSettings.grainAssetId = "pencil-grain";
      this.draftSettings.grainInvert = false;
      this.element<HTMLInputElement>("mobileBrushStudioGrainInvert").checked = false;
      this.syncRadioButtons(this.grainModeButtons, "mobileBrushGrainMode", "off");
      this.syncGrainAvailability("off");
    }
    this.scheduleApply();
    void this.drawSourcePreviews();
  }

  private async drawSourcePreviews(): Promise<void> {
    const settings = this.draftSettings;
    if (!settings) return;
    this.syncSourcePrecisionLabels(settings);
    const revision = ++this.sourcePreviewRevision;
    await Promise.all([
      this.drawSourcePreview("shape", settings, revision),
      this.drawSourcePreview("grain", settings, revision),
    ]);
  }

  private async drawSourcePreview(
    kind: BrushStudioSourceKind,
    settings: BrushSettings,
    revision: number,
  ): Promise<void> {
    const isShape = kind === "shape";
    const button = this.element<HTMLButtonElement>(
      isShape ? "mobileBrushStudioShapeSource" : "mobileBrushStudioGrainSource",
    );
    const canvas = this.element<HTMLCanvasElement>(
      isShape ? "mobileBrushStudioShapeSourceCanvas" : "mobileBrushStudioGrainSourceCanvas",
    );
    const select = this.element<HTMLElement>(
      isShape ? "mobileBrushStudioShapeSelect" : "mobileBrushStudioGrainSelect",
    );
    const replace = this.element<HTMLElement>(
      isShape ? "mobileBrushStudioShapeReplace" : "mobileBrushStudioGrainReplace",
    );
    const remove = this.element<HTMLButtonElement>(
      isShape ? "mobileBrushStudioShapeRemove" : "mobileBrushStudioGrainRemove",
    );
    const invert = this.element<HTMLInputElement>(
      isShape ? "mobileBrushStudioShapeInvert" : "mobileBrushStudioGrainInvert",
    );
    const hasSource = isShape ? settings.shape === "shape" : settings.grainMode !== "off";
    button.dataset.hasSource = String(hasSource);
    select.hidden = hasSource;
    replace.hidden = !hasSource;
    remove.hidden = !hasSource;
    remove.disabled = !hasSource;
    invert.disabled = !hasSource;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!hasSource) return;

    const assetId = isShape ? settings.shapeAssetId : settings.grainAssetId;
    const source = await this.sourceForAsset(assetId);
    if (!source || revision !== this.sourcePreviewRevision || !this.openState) return;
    context.save();
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.filter = (isShape ? settings.shapeInvert : settings.grainInvert) ? "invert(1)" : "none";
    context.fillStyle = "#f2f0e9";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(canvas.width / source.width, canvas.height / source.height);
    const width = source.width * scale;
    const height = source.height * scale;
    context.drawImage(source, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    context.restore();
  }

  private cachedSourceForAsset(
    assetId: BrushShapeAssetId | BrushSettings["grainAssetId"],
  ): BrushStudioCanvasSource | null {
    const cached = this.resolvedSources.get(assetId);
    if (cached) return cached;
    const custom = this.options.assets.getCustomBrushAsset(assetId);
    if (custom) {
      let canvas = this.sourceCanvases.get(assetId);
      if (!canvas) {
        canvas = canvasFromRgba(this.document, custom.width, custom.height, custom.rgba);
        this.sourceCanvases.set(assetId, canvas);
      }
      this.resolvedSources.set(assetId, canvas);
      return canvas;
    }
    return null;
  }

  private async sourceForAsset(
    assetId: BrushShapeAssetId | BrushSettings["grainAssetId"],
  ): Promise<BrushStudioCanvasSource | null> {
    const cached = this.cachedSourceForAsset(assetId);
    if (cached) return cached;
    if (!isBuiltinBrushAssetId(assetId)) return null;
    const url = builtinBrushAssetUrl(assetId);
    let promise = this.imagePromises.get(url);
    if (!promise) {
      promise = loadImage(this.browser, url);
      this.imagePromises.set(url, promise);
    }
    try {
      const image = await promise;
      if (this.disposed) return null;
      this.resolvedSources.set(assetId, image);
      return image;
    } catch {
      this.imagePromises.delete(url);
      return null;
    }
  }

  private schedulePreview(): void {
    if (this.disposed || !this.openState) return;
    this.previewDirty = true;
    if (this.previewInFlight || this.previewFrame !== null) return;
    this.previewFrame = this.browser.requestAnimationFrame(() => {
      this.previewFrame = null;
      if (this.disposed || !this.openState) return;
      this.previewDirty = false;
      this.previewInFlight = true;
      void this.renderPreview().finally(() => {
        this.previewInFlight = false;
        if (this.previewDirty) this.schedulePreview();
      });
    });
  }

  private async renderPreview(): Promise<void> {
    const settings = this.draftSettings
      ? this.withBrushPrecision(this.draftSettings)
      : null;
    if (!settings || !this.openState) return;
    this.draftSettings = settings;
    const bounds = this.previewCanvas.getBoundingClientRect();
    if (bounds.width < 1 || bounds.height < 1) return;
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    const pixelRatio = clamp(this.browser.devicePixelRatio || 1, 1, 2);
    const backingWidth = Math.round(width * pixelRatio);
    const backingHeight = Math.round(height * pixelRatio);
    if (this.previewCanvas.width !== backingWidth || this.previewCanvas.height !== backingHeight) {
      this.previewCanvas.width = backingWidth;
      this.previewCanvas.height = backingHeight;
    }
    try {
      await this.options.previewRenderer.render(this.previewCanvas, settings);
    } catch (error) {
      if (this.openState) {
        this.reportStatus(
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
    }
  }

  private requestCommit(): Promise<void> {
    if (this.disposed || this.commitPromise || this.busy || !this.openState) {
      return this.commitPromise ?? Promise.resolve();
    }
    const operation = this.commit().finally(() => {
      if (this.commitPromise === operation) this.commitPromise = null;
    });
    this.commitPromise = operation;
    return operation;
  }

  private async commit(): Promise<void> {
    if (this.busy || !this.openState) return;
    const settings = this.flushDraft();
    if (!settings) return;
    this.setBusy(true);
    this.reportStatus("Saving brush…", "working");
    const brushId = this.activeBrushId;
    const previousSavedBrush = loadBrushStudioSavedBrush(brushId);
    let shapeAssetKey: string | null = null;
    let grainAssetKey: string | null = null;
    let settingsRecordWritten = false;
    let catalogCommitted = false;
    try {
      const brushName = isBrushStudioCustomBrushId(brushId)
        ? normalizeBrushStudioCustomBrushName(this.nameElement.value)
        : this.activeBrushName;
      this.activeBrushName = brushName;
      this.nameElement.value = brushName;
      shapeAssetKey = await this.persistAssetIfNeeded("shape", settings);
      this.assertUsable();
      grainAssetKey = await this.persistAssetIfNeeded("grain", settings);
      this.assertUsable();
      saveBrushStudioSavedBrush(brushId, {
        version: 1,
        settings: settingsForPersistence(settings),
        shapeAssetKey,
        grainAssetKey,
      });
      settingsRecordWritten = true;
      await this.options.onCommit(brushId, brushName, settings);
      catalogCommitted = true;
      if (this.disposed) {
        await this.deleteSupersededStoredAssets(
          previousSavedBrush?.shapeAssetKey ?? null,
          previousSavedBrush?.grainAssetKey ?? null,
          shapeAssetKey,
          grainAssetKey,
        );
        return;
      }
      try {
        this.options.onCommitted(brushId, brushName, settings);
      } catch (error) {
        console.error("Brush catalog UI refresh failed after a durable save.", error);
      }
      await this.deleteSupersededStoredAssets(
        previousSavedBrush?.shapeAssetKey ?? null,
        previousSavedBrush?.grainAssetKey ?? null,
        shapeAssetKey,
        grainAssetKey,
      );
      if (isCustomShapeAssetId(settings.shapeAssetId)) {
        this.transientAssetIds.delete(settings.shapeAssetId);
      }
      if (isCustomGrainAssetId(settings.grainAssetId)) {
        this.transientAssetIds.delete(settings.grainAssetId);
      }
      this.rememberSettings(brushId, settings);
      this.reportStatus(`${brushName} saved.`, "ok");
      this.closeSheet();
      this.options.setBrushLibraryOpen(true);
      const supersededAssetIds = [
        previousSavedBrush?.settings.shapeAssetId,
        previousSavedBrush?.settings.grainAssetId,
      ].filter((assetId): assetId is CustomBrushShapeAssetId | CustomBrushGrainAssetId => (
        (isCustomShapeAssetId(assetId) || isCustomGrainAssetId(assetId))
        && assetId !== settings.shapeAssetId
        && assetId !== settings.grainAssetId
      ));
      for (const id of supersededAssetIds) this.transientAssetIds.add(id);
      void this.requestTransientAssetRelease();
    } catch (error) {
      let rollbackFailed = false;
      if (!catalogCommitted) {
        rollbackFailed = !(await this.rollbackPartialCommit(
          brushId,
          previousSavedBrush,
          settingsRecordWritten,
          shapeAssetKey,
          grainAssetKey,
        ));
      }
      const message = error instanceof Error ? error.message : String(error);
      if (!this.disposed) {
        this.reportStatus(
          rollbackFailed ? `${message} The previous saved brush could not be restored.` : message,
          "error",
        );
        this.setBusy(false);
      }
    }
  }

  private async rollbackPartialCommit(
    brushId: string,
    previousSavedBrush: ReturnType<typeof loadBrushStudioSavedBrush>,
    settingsRecordWritten: boolean,
    shapeAssetKey: string | null,
    grainAssetKey: string | null,
  ): Promise<boolean> {
    try {
      if (settingsRecordWritten) {
        if (previousSavedBrush) saveBrushStudioSavedBrush(brushId, previousSavedBrush);
        else deleteBrushStudioSavedBrush(brushId);
      }
      const newKeys = new Set<string>();
      if (shapeAssetKey && shapeAssetKey !== previousSavedBrush?.shapeAssetKey) {
        newKeys.add(shapeAssetKey);
      }
      if (grainAssetKey && grainAssetKey !== previousSavedBrush?.grainAssetKey) {
        newKeys.add(grainAssetKey);
      }
      for (const key of newKeys) await deleteBrushStudioAsset(key);
      return true;
    } catch {
      return false;
    }
  }

  private async persistAssetIfNeeded(
    kind: BrushStudioSourceKind,
    settings: BrushSettings,
  ): Promise<string | null> {
    const assetId = kind === "shape" ? settings.shapeAssetId : settings.grainAssetId;
    const custom = kind === "shape" ? isCustomShapeAssetId(assetId) : isCustomGrainAssetId(assetId);
    if (!custom) return null;
    const key = brushStudioAssetStorageKey(this.activeBrushId, kind, assetId);
    const imported = this.importedAssets.get(assetId);
    if (imported) {
      await saveBrushStudioAsset(key, kind, imported.blob, imported.name);
      return key;
    }
    const stored = await loadBrushStudioAsset(key);
    if (!stored) throw new Error(`The custom ${kind} source could not be saved.`);
    return key;
  }

  private async deleteSupersededStoredAssets(
    previousShapeKey: string | null,
    previousGrainKey: string | null,
    shapeKey: string | null,
    grainKey: string | null,
  ): Promise<void> {
    const staleKeys = new Set<string>();
    if (previousShapeKey && previousShapeKey !== shapeKey) staleKeys.add(previousShapeKey);
    if (previousGrainKey && previousGrainKey !== grainKey) staleKeys.add(previousGrainKey);
    for (const key of staleKeys) {
      try {
        await deleteBrushStudioAsset(key);
      } catch {
        // The committed settings already point only at the new key. A failed
        // cleanup can leave an unreachable blob, never a mismatched brush.
      }
    }
  }

  private async restoreSavedAsset(
    brushId: string,
    kind: BrushStudioSourceKind,
    storedKey: string | null,
    settings: BrushSettings,
  ): Promise<void> {
    this.assertUsable();
    const assetId = kind === "shape" ? settings.shapeAssetId : settings.grainAssetId;
    const custom = kind === "shape" ? isCustomShapeAssetId(assetId) : isCustomGrainAssetId(assetId);
    if (!custom) return;
    const key = storedKey ?? brushStudioAssetStorageKey(brushId, kind);
    try {
      const stored = await loadBrushStudioAsset(key);
      this.assertUsable();
      if (!stored) throw new Error("Stored asset missing.");
      const decoded = await decodeBrushSource(
        this.browser,
        this.document,
        stored.blob,
        stored.name,
      );
      this.assertUsable();
      if (kind === "shape") {
        this.options.assets.registerCustomShapeAsset(decoded, assetId as CustomBrushShapeAssetId);
      } else {
        this.options.assets.registerCustomGrainAsset(decoded, assetId as CustomBrushGrainAssetId);
      }
      this.importedAssets.set(assetId, {
        kind,
        blob: stored.blob,
        name: stored.name,
      });
    } catch (error) {
      throw new Error(
        `The saved ${kind} source is unavailable. The brush was not changed.`,
        { cause: error },
      );
    }
  }

  private requestTransientAssetRelease(): Promise<void> {
    this.assetReleaseRequested = true;
    if (this.assetReleasePromise) return this.assetReleasePromise;
    const operation = (async () => {
      while (this.assetReleaseRequested) {
        this.assetReleaseRequested = false;
        await this.releaseTransientAssets();
      }
    })().finally(() => {
      if (this.assetReleasePromise === operation) this.assetReleasePromise = null;
    });
    this.assetReleasePromise = operation;
    return operation;
  }

  private async releaseTransientAssets(): Promise<void> {
    const candidates = new Set<CustomBrushShapeAssetId | CustomBrushGrainAssetId>();
    for (const id of this.transientAssetIds) {
      candidates.add(id as CustomBrushShapeAssetId | CustomBrushGrainAssetId);
    }
    if (candidates.size === 0) return;
    try {
      await this.options.runtime.waitForIdle();
    } catch {
      return;
    }
    const activeSettings = this.options.settings.getSettings();
    if (isCustomShapeAssetId(activeSettings.shapeAssetId)) {
      candidates.delete(activeSettings.shapeAssetId);
    }
    if (isCustomGrainAssetId(activeSettings.grainAssetId)) {
      candidates.delete(activeSettings.grainAssetId);
    }
    for (const id of candidates) {
      try {
        if (this.options.assets.removeCustomBrushAsset(id)) {
          this.transientAssetIds.delete(id);
          this.importedAssets.delete(id);
          this.sourceCanvases.delete(id);
          this.resolvedSources.delete(id);
        }
      } catch {
        // A late resource transition can still own the asset. Keeping the small
        // CPU record is safer than invalidating an in-flight GPU publication.
      }
    }
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.cancelButton.disabled = busy;
    this.doneButton.disabled = busy;
    this.nameElement.disabled = busy;
    this.handle.disabled = busy;
    this.scrollElement.inert = busy;
    for (const tab of this.tabs) tab.disabled = busy;
    this.sheet.setAttribute("aria-busy", String(busy));
  }

  private reportStatus(
    message: string,
    kind: "ok" | "error" | "working",
  ): void {
    this.statusElement.textContent = message;
    this.statusElement.hidden = message.length === 0;
    this.statusElement.dataset.statusKind = kind;
    this.options.onStatus(message, kind);
  }

  private cancelScheduledWork(): void {
    if (this.applyFrame !== null) this.browser.cancelAnimationFrame(this.applyFrame);
    if (this.previewFrame !== null) this.browser.cancelAnimationFrame(this.previewFrame);
    if (this.rootScrollFrame !== null) this.browser.cancelAnimationFrame(this.rootScrollFrame);
    this.options.previewRenderer.invalidate(this.previewCanvas);
    this.applyFrame = null;
    this.previewFrame = null;
    this.rootScrollFrame = null;
    this.previewDirty = false;
  }

  private closeSheet(): void {
    this.cancelScheduledWork();
    this.openState = false;
    this.sheet.classList.remove("is-open", "is-dragging");
    this.sheet.setAttribute("aria-hidden", "true");
    this.handle.setAttribute("aria-expanded", "false");
    if (this.dragPointerId !== null && this.handle.hasPointerCapture(this.dragPointerId)) {
      this.handle.releasePointerCapture(this.dragPointerId);
    }
    this.dragPointerId = null;
    this.dragMoved = false;
    this.originalSettings = null;
    this.draftSettings = null;
    this.setBusy(false);
    this.options.onOpenChange(false);
  }

  private closedOffset(): number {
    return Math.max(0, Math.round(this.sheet.offsetHeight));
  }

  private setOffset(offsetPx: number): void {
    this.offsetPx = clamp(offsetPx, 0, this.closedOffset());
    this.sheet.style.setProperty("--mobile-tools-sheet-offset", `${Math.round(this.offsetPx)}px`);
  }

  private startDrag(event: PointerEvent): void {
    if (!this.openState || this.busy || event.button !== 0) return;
    this.dragPointerId = event.pointerId;
    this.dragStartY = event.clientY;
    this.dragStartOffsetPx = this.offsetPx;
    this.dragLastY = event.clientY;
    this.dragLastTime = this.browser.performance.now();
    this.dragVelocityY = 0;
    this.dragMoved = false;
    this.sheet.classList.add("is-dragging");
    this.handle.setPointerCapture(event.pointerId);
  }

  private moveDrag(event: PointerEvent): void {
    if (event.pointerId !== this.dragPointerId) return;
    const now = this.browser.performance.now();
    const elapsed = now - this.dragLastTime;
    if (elapsed > 0 && elapsed <= 120) {
      const immediate = (event.clientY - this.dragLastY) / elapsed;
      this.dragVelocityY = this.dragVelocityY === 0
        ? immediate
        : this.dragVelocityY * 0.35 + immediate * 0.65;
    } else if (elapsed > 120) {
      this.dragVelocityY = 0;
    }
    this.dragLastY = event.clientY;
    this.dragLastTime = now;
    const delta = event.clientY - this.dragStartY;
    if (Math.abs(delta) >= 4) this.dragMoved = true;
    this.setOffset(this.dragStartOffsetPx + delta);
  }

  private finishDrag(event: PointerEvent, cancelled = false): void {
    if (event.pointerId !== this.dragPointerId) return;
    if (this.handle.hasPointerCapture(event.pointerId)) this.handle.releasePointerCapture(event.pointerId);
    this.sheet.classList.remove("is-dragging");
    const deltaY = event.clientY - this.dragStartY;
    const closedOffset = this.closedOffset();
    const releaseVelocityY = this.browser.performance.now() - this.dragLastTime <= 100
      ? this.dragVelocityY
      : 0;
    const shouldClose = shouldCloseMobileToolsSheetDrag({
      startSnap: "expanded",
      deltaY,
      releaseVelocityY,
      offsetPx: this.offsetPx,
      peekOffsetPx: Math.min(closedOffset, Math.max(96, closedOffset * 0.22)),
      closedOffsetPx: closedOffset,
    });
    this.dragPointerId = null;
    if (cancelled) {
      this.setOffset(0);
      this.dragMoved = false;
      return;
    }
    if (this.dragMoved && shouldClose) {
      this.cancel(true);
      return;
    }
    if (this.dragMoved) this.setOffset(0);
  }
}
