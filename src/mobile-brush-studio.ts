import type { BrushEngine } from "./brush-engine";
import type { AuthoritativeBrushStrokePreviewRenderer } from "./brush-stroke-preview-renderer";
import {
  isCustomGrainAssetId,
  isCustomShapeAssetId,
  type DecodedCustomBrushImage,
} from "./brush-asset-registry";
import {
  brushStudioAssetStorageKey,
  deleteBrushStudioAsset,
  deleteBrushStudioSavedBrush,
  isBrushStudioCustomBrushId,
  loadBrushStudioAsset,
  loadBrushStudioSavedBrush,
  normalizeBrushStudioCustomBrushName,
  saveBrushStudioAsset,
  saveBrushStudioSavedBrush,
  type BrushStudioAssetKind,
  type BrushStudioPersistedSettings,
} from "./brush-studio-storage";
import {
  brushSourceDimensionsFromBytes,
  brushSourceResizePlan,
} from "./brush-source-image";
import { shouldCloseMobileToolsSheetDrag } from "./mobile-tools-sheet-gesture";
import type {
  BrushSettings,
  BrushShapeAssetId,
  CustomBrushGrainAssetId,
  CustomBrushShapeAssetId,
  GrainMode,
} from "./engine-types";

type BrushStudioTab = "stroke" | "shape" | "grain" | "dynamics";
type BrushStudioSourceKind = "shape" | "grain";
type BrushStudioCanvasSource = HTMLCanvasElement | HTMLImageElement;

interface ImportedBrushStudioAsset {
  readonly kind: BrushStudioAssetKind;
  readonly blob: Blob;
  readonly name: string;
}

export interface MobileBrushStudioOptions {
  readonly engine: BrushEngine;
  readonly previewRenderer: AuthoritativeBrushStrokePreviewRenderer;
  readonly mobileMediaQuery: MediaQueryList;
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

const BUILTIN_BRUSH_SOURCE_URLS: Readonly<Record<string, string>> = {
  "legacy-shape": new URL("../Shape.png", import.meta.url).href,
  "pencil-shape": new URL("../Shapepencil.png", import.meta.url).href,
  "legacy-grain": new URL("../graincottonfleece.PNG", import.meta.url).href,
  "pencil-grain": new URL("../Grainpencil.png", import.meta.url).href,
};

const MAX_IMPORTED_SOURCE_BYTES = 64 * 1024 * 1024;
const BRUSH_SOURCE_HEADER_BYTES = 4 * 1024 * 1024;
const BRUSH_SOURCE_FALLBACK_MAX_INPUT_PIXELS = 8_388_608;

/** Freno all'eco delle statistiche del motore: vedi notifyEngineUpdate(). */
const ENGINE_NOTIFY_PREVIEW_INTERVAL_MS = 200;

function requiredElement<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Elemento Brush Studio #${id} non trovato.`);
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

function copySettings(settings: Readonly<BrushSettings>): BrushSettings {
  return { ...settings };
}

function settingsForPersistence(settings: BrushSettings): BrushStudioPersistedSettings {
  const { color: _color, tool: _tool, ...persisted } = settings;
  return persisted;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", () => reject(new Error("Image decode failed.")), {
      once: true,
    });
    image.src = url;
  });
}

async function decodeBrushSource(blob: Blob, name: string): Promise<DecodedCustomBrushImage> {
  const header = new Uint8Array(await blob.slice(0, BRUSH_SOURCE_HEADER_BYTES).arrayBuffer());
  const dimensions = brushSourceDimensionsFromBytes(header);
  if (!dimensions) {
    throw new Error("The selected image dimensions could not be read safely.");
  }
  const plan = brushSourceResizePlan(dimensions.width, dimensions.height);
  let source: ImageBitmap | HTMLImageElement | null = null;
  let objectUrl: string | null = null;
  try {
    if (typeof createImageBitmap === "function") {
      try {
        // Shape and Grain channels are coverage data, not display colors.
        // Preserve the authored bytes instead of baking ICC/premultiplication.
        source = await createImageBitmap(blob, {
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
          source = await createImageBitmap(blob, {
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
      objectUrl = URL.createObjectURL(blob);
      source = await loadImage(objectUrl);
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
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

function canvasFromRgba(
  width: number,
  height: number,
  rgba: Uint8Array | Uint8ClampedArray,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: true });
  if (context) {
    context.putImageData(
      new ImageData(new Uint8ClampedArray(rgba), width, height),
      0,
      0,
    );
  }
  return canvas;
}

function normalizedBrushSourceBlob(source: DecodedCustomBrushImage): Promise<Blob> {
  const canvas = canvasFromRgba(source.width, source.height, source.rgba);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The normalized brush source could not be encoded."));
    }, "image/png");
  });
}

export class MobileBrushStudioController {
  readonly sheet = requiredElement<HTMLElement>("mobileBrushStudioSheet");
  readonly handle = requiredElement<HTMLButtonElement>("mobileBrushStudioHandle");
  readonly cancelButton = requiredElement<HTMLButtonElement>("mobileBrushStudioCancel");
  readonly doneButton = requiredElement<HTMLButtonElement>("mobileBrushStudioDone");
  readonly nameElement = requiredElement<HTMLInputElement>("mobileBrushStudioName");
  readonly statusElement = requiredElement<HTMLParagraphElement>("mobileBrushStudioStatus");
  readonly previewCanvas = requiredElement<HTMLCanvasElement>("mobileBrushStudioPreviewCanvas");
  readonly scrollElement = requiredElement<HTMLElement>("mobileBrushStudioScroll");
  readonly tabs = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-mobile-brush-studio-tab]"),
  );
  readonly panels = Array.from(
    document.querySelectorAll<HTMLElement>("[data-mobile-brush-studio-panel]"),
  );
  readonly renderingButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-mobile-brush-rendering]"),
  );
  readonly shapeRotationButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-mobile-brush-shape-rotation]"),
  );
  readonly grainModeButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-mobile-brush-grain-mode]"),
  );

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
  private selectedTab: BrushStudioTab = "stroke";
  private applyFrame: number | null = null;
  private previewFrame: number | null = null;
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

  constructor(private readonly options: MobileBrushStudioOptions) {
    this.bindControls();
    this.setTab("stroke", false);
    this.sheet.setAttribute("aria-hidden", "true");
  }

  get isOpen(): boolean {
    return this.openState;
  }

  rememberSettings(brushId: string, settings: Readonly<BrushSettings>): void {
    this.settingsCache.set(brushId, copySettings(settings));
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
      return { ...cached, tool: "paint", color: fallback.color, hardness: 1 };
    }
    const saved = loadBrushStudioSavedBrush(brushId);
    if (!saved) return { ...fallback, tool: "paint", hardness: 1 };
    return {
      ...fallback,
      ...saved.settings,
      tool: "paint",
      color: fallback.color,
      hardness: 1,
    };
  }

  async resolveBrushSettings(
    brushId: string,
    fallback: Readonly<BrushSettings>,
  ): Promise<BrushSettings> {
    const cached = this.settingsCache.get(brushId);
    if (cached) {
      return { ...cached, tool: "paint", color: fallback.color, hardness: 1 };
    }

    const saved = loadBrushStudioSavedBrush(brushId);
    if (!saved) {
      const resolved = { ...fallback, tool: "paint" as const, hardness: 1 };
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
    this.rememberSettings(brushId, resolved);
    return copySettings(resolved);
  }

  async releasePreviewAssets(
    brushId: string,
    settings: Readonly<BrushSettings>,
  ): Promise<void> {
    const candidates = new Set<CustomBrushShapeAssetId | CustomBrushGrainAssetId>();
    if (
      isCustomShapeAssetId(settings.shapeAssetId)
      && this.options.engine.hasCustomBrushAsset(settings.shapeAssetId)
    ) {
      candidates.add(settings.shapeAssetId);
    }
    if (
      isCustomGrainAssetId(settings.grainAssetId)
      && this.options.engine.hasCustomBrushAsset(settings.grainAssetId)
    ) {
      candidates.add(settings.grainAssetId);
    }
    if (candidates.size === 0) return;

    const activeSettings = this.options.engine.getSettings();
    if (isCustomShapeAssetId(activeSettings.shapeAssetId)) {
      candidates.delete(activeSettings.shapeAssetId);
    }
    if (isCustomGrainAssetId(activeSettings.grainAssetId)) {
      candidates.delete(activeSettings.grainAssetId);
    }
    if (candidates.size === 0) return;

    try {
      await this.options.engine.waitForIdle();
    } catch {
      return;
    }
    const activeAfterIdle = this.options.engine.getSettings();
    if (isCustomShapeAssetId(activeAfterIdle.shapeAssetId)) {
      candidates.delete(activeAfterIdle.shapeAssetId);
    }
    if (isCustomGrainAssetId(activeAfterIdle.grainAssetId)) {
      candidates.delete(activeAfterIdle.grainAssetId);
    }
    let released = false;
    for (const assetId of candidates) {
      try {
        if (this.options.engine.removeCustomBrushAsset(assetId)) {
          released = true;
          this.importedAssets.delete(assetId);
          this.sourceCanvases.delete(assetId);
          this.resolvedSources.delete(assetId);
        }
      } catch {
        // The card bitmap is already complete. Keep an asset still referenced
        // by a late GPU publication and retry its release on a later preview.
      }
    }
    if (released) this.settingsCache.delete(brushId);
  }

  open(
    brushId: string,
    brushName: string,
    settings: Readonly<BrushSettings>,
    originalSettings: Readonly<BrushSettings> = settings,
  ): void {
    if (!this.options.mobileMediaQuery.matches) return;
    this.activeBrushId = brushId;
    this.activeBrushName = brushName;
    this.originalSettings = copySettings(originalSettings);
    this.draftSettings = { ...settings, tool: "paint", hardness: 1 };
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
    if (!this.openState) return;
    this.importRevision += 1;
    this.cancelScheduledWork();
    const original = this.originalSettings;
    this.closeSheet();
    if (original) this.options.applySettings(original);
    void this.releaseTransientAssets(original ?? undefined);
    if (reopenLibrary && this.options.mobileMediaQuery.matches) {
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
    const now = performance.now();
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
    this.cancelButton.addEventListener("click", () => this.cancel(true));
    this.doneButton.addEventListener("click", () => void this.commit());

    for (const tab of this.tabs) {
      tab.addEventListener("click", () => {
        const value = tab.dataset.mobileBrushStudioTab;
        if (value === "stroke" || value === "shape" || value === "grain" || value === "dynamics") {
          this.setTab(value, false);
        }
      });
      tab.addEventListener("keydown", (event) => this.handleTabKeydown(event, tab));
    }

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
      button.addEventListener("click", () => {
        const mode = button.dataset.mobileBrushRendering;
        if (mode !== "light-glaze" && mode !== "uniformed-glaze" && mode !== "intense-blending") return;
        this.changeDraft((draft) => { draft.blendMode = mode; });
        this.syncRadioButtons(this.renderingButtons, "mobileBrushRendering", mode);
      });
    }
    for (const button of this.shapeRotationButtons) {
      button.addEventListener("click", () => {
        const rotation = button.dataset.mobileBrushShapeRotation;
        if (rotation !== "fixed" && rotation !== "follow-stroke") return;
        this.changeDraft((draft) => { draft.shapeRotation = rotation; });
        this.syncRadioButtons(this.shapeRotationButtons, "mobileBrushShapeRotation", rotation);
      });
    }
    for (const button of this.grainModeButtons) {
      button.addEventListener("click", () => {
        const mode = button.dataset.mobileBrushGrainMode;
        if (mode !== "off" && mode !== "texturized" && mode !== "moving") return;
        this.changeDraft((draft) => { draft.grainMode = mode; });
        this.syncRadioButtons(this.grainModeButtons, "mobileBrushGrainMode", mode);
        this.syncGrainAvailability(mode);
      });
    }

    const filtering = requiredElement<HTMLSelectElement>("mobileBrushStudioGrainFiltering");
    filtering.addEventListener("change", () => {
      const value = filtering.value;
      if (value !== "no" && value !== "classic" && value !== "improved") return;
      this.changeDraft((draft) => { draft.grainFiltering = value; });
    });

    for (const kind of ["shape", "grain"] as const) {
      const fileInput = requiredElement<HTMLInputElement>(
        kind === "shape" ? "mobileBrushStudioShapeFile" : "mobileBrushStudioGrainFile",
      );
      const sourceButton = requiredElement<HTMLButtonElement>(
        kind === "shape" ? "mobileBrushStudioShapeSource" : "mobileBrushStudioGrainSource",
      );
      sourceButton.addEventListener("click", () => fileInput.click());
      fileInput.addEventListener("change", () => {
        const file = fileInput.files?.[0];
        fileInput.value = "";
        if (file) void this.importSource(kind, file);
      });
      requiredElement<HTMLButtonElement>(
        kind === "shape" ? "mobileBrushStudioShapeRemove" : "mobileBrushStudioGrainRemove",
      ).addEventListener("click", () => this.removeSource(kind));
    }

    this.handle.addEventListener("pointerdown", (event) => this.startDrag(event));
    this.handle.addEventListener("pointermove", (event) => this.moveDrag(event));
    this.handle.addEventListener("pointerup", (event) => this.finishDrag(event));
    this.handle.addEventListener("pointercancel", (event) => this.finishDrag(event, true));
    this.handle.addEventListener("click", () => {
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
    const input = requiredElement<HTMLInputElement>(inputId);
    const output = requiredElement<HTMLOutputElement>(outputId);
    input.addEventListener("input", () => {
      const value = Number(input.value);
      output.value = format(value);
      update(value);
    });
  }

  private bindCheckbox(id: string, update: (checked: boolean) => void): void {
    const input = requiredElement<HTMLInputElement>(id);
    input.addEventListener("change", () => update(input.checked));
  }

  private changeDraft(change: (draft: BrushSettings) => void, redrawSources = false): void {
    if (!this.draftSettings || !this.openState) return;
    change(this.draftSettings);
    this.draftSettings.tool = "paint";
    this.draftSettings.hardness = 1;
    this.scheduleApply();
    if (redrawSources) void this.drawSourcePreviews();
  }

  private scheduleApply(): void {
    if (this.applyFrame === null) {
      this.applyFrame = requestAnimationFrame(() => {
        this.applyFrame = null;
        this.applyDraftNow();
      });
    }
    this.schedulePreview();
  }

  private applyDraftNow(): void {
    if (!this.openState || !this.draftSettings) return;
    this.options.applySettings(copySettings(this.draftSettings));
    this.schedulePreview();
  }

  private flushDraft(): BrushSettings | null {
    if (this.applyFrame !== null) {
      cancelAnimationFrame(this.applyFrame);
      this.applyFrame = null;
      this.applyDraftNow();
    }
    return this.draftSettings ? copySettings(this.draftSettings) : null;
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

    requiredElement<HTMLInputElement>("mobileBrushStudioShapeInvert").checked = settings.shapeInvert;
    requiredElement<HTMLInputElement>("mobileBrushStudioGrainInvert").checked = settings.grainInvert;
    requiredElement<HTMLInputElement>("mobileBrushStudioJitterPerCopy").checked = settings.jitterPerCopy;
    requiredElement<HTMLSelectElement>("mobileBrushStudioGrainFiltering").value = settings.grainFiltering;
    const rendering = settings.blendMode === "uniformed-glaze" || settings.blendMode === "intense-blending"
      ? settings.blendMode
      : "light-glaze";
    this.syncRadioButtons(this.renderingButtons, "mobileBrushRendering", rendering);
    this.syncRadioButtons(this.shapeRotationButtons, "mobileBrushShapeRotation", settings.shapeRotation);
    this.syncRadioButtons(this.grainModeButtons, "mobileBrushGrainMode", settings.grainMode);
    this.syncGrainAvailability(settings.grainMode);
  }

  private setRange(
    inputId: string,
    outputId: string,
    value: number,
    format: (value: number) => string,
  ): void {
    const input = requiredElement<HTMLInputElement>(inputId);
    const clamped = clamp(value, Number(input.min), Number(input.max));
    input.value = clamped.toString();
    requiredElement<HTMLOutputElement>(outputId).value = format(clamped);
  }

  private syncRadioButtons(
    buttons: readonly HTMLButtonElement[],
    datasetKey: "mobileBrushRendering" | "mobileBrushShapeRotation" | "mobileBrushGrainMode",
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
      requiredElement<HTMLInputElement | HTMLSelectElement>(id).disabled = mode === "off";
    }
    requiredElement<HTMLInputElement>("mobileBrushStudioGrainMovement").disabled = mode !== "moving";
  }

  private setTab(tab: BrushStudioTab, focus: boolean): void {
    this.selectedTab = tab;
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
    const app = document.getElementById("app");
    if (!app) return;
    app.scrollTop = 0;
    requestAnimationFrame(() => {
      if (this.openState) app.scrollTop = 0;
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
      const decoded = await decodeBrushSource(file, file.name);
      if (!this.openState || revision !== this.importRevision || !this.draftSettings) return;
      const normalizedBlob = await normalizedBrushSourceBlob(decoded);
      if (!this.openState || revision !== this.importRevision || !this.draftSettings) return;
      const normalizedDecoded: DecodedCustomBrushImage = {
        ...decoded,
        mimeType: "image/png",
      };
      if (kind === "shape") {
        const id = this.options.engine.registerCustomShapeAsset(normalizedDecoded);
        this.importedAssets.set(id, { kind, blob: normalizedBlob, name: file.name });
        this.transientAssetIds.add(id);
        this.draftSettings.shape = "shape";
        this.draftSettings.shapeAssetId = id;
        this.draftSettings.shapeInvert = false;
        requiredElement<HTMLInputElement>("mobileBrushStudioShapeInvert").checked = false;
      } else {
        const id = this.options.engine.registerCustomGrainAsset(normalizedDecoded);
        this.importedAssets.set(id, { kind, blob: normalizedBlob, name: file.name });
        this.transientAssetIds.add(id);
        this.draftSettings.grainAssetId = id;
        if (this.draftSettings.grainMode === "off") this.draftSettings.grainMode = "moving";
        this.draftSettings.grainInvert = false;
        requiredElement<HTMLInputElement>("mobileBrushStudioGrainInvert").checked = false;
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
      requiredElement<HTMLInputElement>("mobileBrushStudioShapeInvert").checked = false;
    } else {
      this.draftSettings.grainMode = "off";
      this.draftSettings.grainAssetId = "legacy-grain";
      this.draftSettings.grainInvert = false;
      requiredElement<HTMLInputElement>("mobileBrushStudioGrainInvert").checked = false;
      this.syncRadioButtons(this.grainModeButtons, "mobileBrushGrainMode", "off");
      this.syncGrainAvailability("off");
    }
    this.scheduleApply();
    void this.drawSourcePreviews();
  }

  private async drawSourcePreviews(): Promise<void> {
    const settings = this.draftSettings;
    if (!settings) return;
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
    const button = requiredElement<HTMLButtonElement>(
      isShape ? "mobileBrushStudioShapeSource" : "mobileBrushStudioGrainSource",
    );
    const canvas = requiredElement<HTMLCanvasElement>(
      isShape ? "mobileBrushStudioShapeSourceCanvas" : "mobileBrushStudioGrainSourceCanvas",
    );
    const select = requiredElement<HTMLElement>(
      isShape ? "mobileBrushStudioShapeSelect" : "mobileBrushStudioGrainSelect",
    );
    const replace = requiredElement<HTMLElement>(
      isShape ? "mobileBrushStudioShapeReplace" : "mobileBrushStudioGrainReplace",
    );
    const remove = requiredElement<HTMLButtonElement>(
      isShape ? "mobileBrushStudioShapeRemove" : "mobileBrushStudioGrainRemove",
    );
    const invert = requiredElement<HTMLInputElement>(
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
    const custom = this.options.engine.getCustomBrushAsset(assetId);
    if (custom) {
      let canvas = this.sourceCanvases.get(assetId);
      if (!canvas) {
        canvas = canvasFromRgba(custom.width, custom.height, custom.rgba);
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
    const url = BUILTIN_BRUSH_SOURCE_URLS[assetId];
    if (!url) return null;
    let promise = this.imagePromises.get(url);
    if (!promise) {
      promise = loadImage(url);
      this.imagePromises.set(url, promise);
    }
    try {
      const image = await promise;
      this.resolvedSources.set(assetId, image);
      return image;
    } catch {
      this.imagePromises.delete(url);
      return null;
    }
  }

  private schedulePreview(): void {
    if (!this.openState || this.previewFrame !== null) return;
    this.previewFrame = requestAnimationFrame(() => {
      this.previewFrame = null;
      void this.renderPreview();
    });
  }

  private async renderPreview(): Promise<void> {
    const settings = this.draftSettings;
    if (!settings || !this.openState) return;
    const bounds = this.previewCanvas.getBoundingClientRect();
    if (bounds.width < 1 || bounds.height < 1) return;
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    const pixelRatio = clamp(window.devicePixelRatio || 1, 1, 2);
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
      grainAssetKey = await this.persistAssetIfNeeded("grain", settings);
      saveBrushStudioSavedBrush(brushId, {
        version: 1,
        settings: settingsForPersistence(settings),
        shapeAssetKey,
        grainAssetKey,
      });
      settingsRecordWritten = true;
      await this.options.onCommit(brushId, brushName, settings);
      catalogCommitted = true;
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
      void this.releaseTransientAssets(settings, supersededAssetIds);
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
      this.reportStatus(
        rollbackFailed ? `${message} The previous saved brush could not be restored.` : message,
        "error",
      );
      this.setBusy(false);
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
    const assetId = kind === "shape" ? settings.shapeAssetId : settings.grainAssetId;
    const custom = kind === "shape" ? isCustomShapeAssetId(assetId) : isCustomGrainAssetId(assetId);
    if (!custom) return;
    const key = storedKey ?? brushStudioAssetStorageKey(brushId, kind);
    try {
      const stored = await loadBrushStudioAsset(key);
      if (!stored) throw new Error("Stored asset missing.");
      const decoded = await decodeBrushSource(stored.blob, stored.name);
      if (kind === "shape") {
        this.options.engine.registerCustomShapeAsset(decoded, assetId as CustomBrushShapeAssetId);
      } else {
        this.options.engine.registerCustomGrainAsset(decoded, assetId as CustomBrushGrainAssetId);
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

  private async releaseTransientAssets(
    keep?: Readonly<BrushSettings>,
    additionalCandidates: readonly (
      CustomBrushShapeAssetId | CustomBrushGrainAssetId
    )[] = [],
  ): Promise<void> {
    const keepIds = new Set<string>();
    if (keep && isCustomShapeAssetId(keep.shapeAssetId)) keepIds.add(keep.shapeAssetId);
    if (keep && isCustomGrainAssetId(keep.grainAssetId)) keepIds.add(keep.grainAssetId);
    const candidates = new Set<CustomBrushShapeAssetId | CustomBrushGrainAssetId>(
      additionalCandidates,
    );
    for (const id of additionalCandidates) this.transientAssetIds.add(id);
    for (const id of this.transientAssetIds) {
      candidates.add(id as CustomBrushShapeAssetId | CustomBrushGrainAssetId);
    }
    for (const id of keepIds) {
      candidates.delete(id as CustomBrushShapeAssetId | CustomBrushGrainAssetId);
    }
    if (candidates.size === 0) return;
    try {
      await this.options.engine.waitForIdle();
    } catch {
      return;
    }
    const activeSettings = this.options.engine.getSettings();
    if (isCustomShapeAssetId(activeSettings.shapeAssetId)) {
      candidates.delete(activeSettings.shapeAssetId);
    }
    if (isCustomGrainAssetId(activeSettings.grainAssetId)) {
      candidates.delete(activeSettings.grainAssetId);
    }
    for (const id of candidates) {
      try {
        if (this.options.engine.removeCustomBrushAsset(id)) {
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
    this.doneButton.disabled = busy;
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
    if (this.applyFrame !== null) cancelAnimationFrame(this.applyFrame);
    if (this.previewFrame !== null) cancelAnimationFrame(this.previewFrame);
    this.options.previewRenderer.invalidate(this.previewCanvas);
    this.applyFrame = null;
    this.previewFrame = null;
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
    if (!this.openState || event.button !== 0) return;
    this.dragPointerId = event.pointerId;
    this.dragStartY = event.clientY;
    this.dragStartOffsetPx = this.offsetPx;
    this.dragLastY = event.clientY;
    this.dragLastTime = performance.now();
    this.dragVelocityY = 0;
    this.dragMoved = false;
    this.sheet.classList.add("is-dragging");
    this.handle.setPointerCapture(event.pointerId);
  }

  private moveDrag(event: PointerEvent): void {
    if (event.pointerId !== this.dragPointerId) return;
    const now = performance.now();
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
    const releaseVelocityY = performance.now() - this.dragLastTime <= 100 ? this.dragVelocityY : 0;
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
