import {
  BRUSH_STUDIO_MAX_CUSTOM_BRUSHES,
  createBrushStudioBaseSettings,
  createBrushStudioCustomBrushId,
  isBrushStudioCustomBrushId,
  nextBrushStudioCustomBrushName,
  PENCIL_BRUSH_PRESET,
  resolveBrushPresetSettings,
  uniqueBrushStudioCustomBrushName,
  type BrushStudioCustomBrush,
  type BrushStudioCustomBrushId,
} from "./brush-catalog.ts";
import {
  Check,
  createElement as createLucideElement,
} from "lucide";
import type { BrushLibraryPreviewResult } from "./brush-library-preview";
import {
  brushStudioAssetStorageKey,
  deleteBrushStudioAsset,
  deleteBrushStudioSavedBrush,
  loadBrushStudioAsset,
  loadBrushStudioLibraryState,
  loadBrushStudioSavedBrush,
  saveBrushStudioAsset,
  saveBrushStudioLibraryState,
  saveBrushStudioSavedBrush,
} from "./brush-studio-storage";
import {
  BRUSH_STUDIO_TRANSFER_MAX_FILE_BYTES,
  BRUSH_STUDIO_TRANSFER_MIME_TYPE,
  brushStudioTransferFileName,
  createBrushStudioImportedAssetId,
  createBrushStudioTransferBlob,
  parseBrushStudioTransferBlob,
} from "./brush-studio-transfer";
import { defaultBrushSettings, type BrushSettings } from "./engine-types";
import { shouldCloseMobileToolsSheetDrag } from "./mobile-tools-sheet-gesture";

export type BrushLibraryCategory = "pencil" | "painting";
export type BrushLibraryBrushId =
  | typeof PENCIL_BRUSH_PRESET.id
  | "current"
  | BrushStudioCustomBrushId;

export interface BrushLibraryEnginePort {
  getSettings(): BrushSettings;
  ensureCurrentBrushResources(): Promise<void>;
}

export interface BrushStudioPort {
  readonly isOpen: boolean;
  readonly isBusy: boolean;
  rememberSettings(brushId: string, settings: Readonly<BrushSettings>): void;
  forgetSettings(brushId: string): void;
  settingsSnapshot(brushId: string, fallback: Readonly<BrushSettings>): BrushSettings;
  resolveBrushSettings(
    brushId: string,
    fallback: Readonly<BrushSettings>,
  ): Promise<BrushSettings>;
  releasePreviewAssets(
    brushId: string,
    settings: Readonly<BrushSettings>,
  ): Promise<void>;
  retryPendingAssetRelease(): void;
  open(
    brushId: string,
    brushName: string,
    settings: Readonly<BrushSettings>,
    originalSettings?: Readonly<BrushSettings>,
  ): void;
  cancel(reopenLibrary?: boolean): void;
}

export interface BrushLibraryPreviewPort {
  render(
    brushId: string,
    canvas: HTMLCanvasElement,
    settings: Readonly<BrushSettings>,
  ): Promise<BrushLibraryPreviewResult>;
  hasCompletePreview(
    brushId: string,
    canvas: HTMLCanvasElement,
    settings: Readonly<BrushSettings>,
  ): boolean;
}

export interface BrushLibraryStrokePreviewPort {
  invalidate(canvas: HTMLCanvasElement): void;
}

export interface BrushStudioLibraryIntegration {
  readonly setBrushLibraryOpen: (open: boolean) => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCommit: (
    brushId: string,
    brushName: string,
    settings: BrushSettings,
  ) => Promise<void>;
  readonly onCommitted: (
    brushId: string,
    brushName: string,
    settings: BrushSettings,
  ) => void;
  readonly onStatus: (message: string, kind: "ok" | "error" | "working") => void;
}

export interface BrushLibraryElements {
  readonly sheet: HTMLElement;
  readonly handle: HTMLButtonElement;
  readonly importButton: HTMLButtonElement;
  readonly exportButton: HTMLButtonElement;
  readonly importFile: HTMLInputElement;
  readonly addButton: HTMLButtonElement;
  readonly status: HTMLParagraphElement;
  readonly viewport: HTMLElement;
  readonly list: HTMLElement;
  readonly empty: HTMLParagraphElement;
  readonly categoryButtons: readonly HTMLButtonElement[];
  readonly cards: HTMLButtonElement[];
  readonly paintButton: HTMLButtonElement;
}

export interface BrushLibraryControllerOptions {
  readonly engine: BrushLibraryEnginePort;
  readonly browser: Window;
  readonly document: Document;
  readonly elements: BrushLibraryElements;
  readonly previewRenderer: BrushLibraryPreviewPort;
  readonly strokePreviewRenderer: BrushLibraryStrokePreviewPort;
  readonly applySettings: (settings: Readonly<BrushSettings>) => void;
  readonly canOpen: () => boolean;
  readonly beforeOpen: () => void;
  readonly beforeStudioOpen: () => void;
  readonly isPaintSelected: () => boolean;
  readonly onVisibilityChange: () => void;
  readonly onStatus: (message: string, kind: "ok" | "error" | "working") => void;
}

type TransferStatusKind = "ok" | "error" | "working" | "export-unavailable";

function currentBrushFallback(current: Readonly<BrushSettings>): BrushSettings {
  return {
    ...defaultBrushSettings,
    color: current.color,
    tool: "paint",
    hardness: 1,
  };
}

/**
 * Owns the complete Brush Library workflow, including its sheet, catalog,
 * asynchronous selection, previews and portable import/export transactions.
 * Brush Studio stays a separate editor and connects through a narrow port.
 */
export class BrushLibraryController {
  private readonly engine: BrushLibraryEnginePort;
  private readonly browser: Window;
  private readonly document: Document;
  private readonly elements: BrushLibraryElements;
  private readonly previewRenderer: BrushLibraryPreviewPort;
  private readonly strokePreviewRenderer: BrushLibraryStrokePreviewPort;
  private readonly applySettings: (settings: Readonly<BrushSettings>) => void;
  private readonly canOpen: () => boolean;
  private readonly beforeOpen: () => void;
  private readonly beforeStudioOpen: () => void;
  private readonly isPaintSelected: () => boolean;
  private readonly onVisibilityChange: () => void;
  private readonly onStatus: BrushLibraryControllerOptions["onStatus"];

  private studio: BrushStudioPort | null = null;
  private customBrushes: BrushStudioCustomBrush[];
  private openState = false;
  private category: BrushLibraryCategory;
  private activeBrushId: BrushLibraryBrushId;
  private transferBusy = false;
  private selectionQueue: Promise<void> = Promise.resolve();
  private selectionBusy = false;
  private offsetPx = 0;
  private dragPointerId: number | null = null;
  private dragStartY = 0;
  private dragStartOffsetPx = 0;
  private dragLastY = 0;
  private dragLastTime = 0;
  private dragVelocityY = 0;
  private dragMoved = false;
  private previewFrame: number | null = null;
  private scrollTimer: number | null = null;
  private previewDirty = true;
  private previewRevision = 0;

  private readonly handleAddClick = (): void => {
    void this.createBrush();
  };
  private readonly handleImportClick = (): void => {
    if (this.elements.importButton.disabled) return;
    this.elements.importFile.value = "";
    this.elements.importFile.click();
  };
  private readonly handleExportClick = (): void => {
    void this.exportActiveBrush();
  };
  private readonly handleImportChange = (): void => {
    const file = this.elements.importFile.files?.[0];
    this.elements.importFile.value = "";
    if (file) void this.importBrush(file);
  };
  private readonly handleListClick = (event: MouseEvent): void => {
    if (this.transferBusy || !(event.target instanceof Element)) return;
    const card = event.target.closest<HTMLButtonElement>("[data-mobile-brush-id]");
    const brushId = card?.dataset.mobileBrushId;
    if (!card || !this.elements.list.contains(card) || !brushId) return;
    if (this.isBrushId(brushId)) void this.selectBrush(brushId);
  };
  private readonly handleScroll = (): void => {
    if (this.scrollTimer !== null) this.browser.clearTimeout(this.scrollTimer);
    this.scrollTimer = this.browser.setTimeout(() => {
      this.scrollTimer = null;
      if (this.openState) this.markPreviewDirty();
    }, 90);
  };
  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (!this.openState || event.button !== 0) return;
    this.dragPointerId = event.pointerId;
    this.dragStartY = event.clientY;
    this.dragStartOffsetPx = this.offsetPx;
    this.dragLastY = event.clientY;
    this.dragLastTime = this.browser.performance.now();
    this.dragVelocityY = 0;
    this.dragMoved = false;
    this.elements.sheet.classList.add("is-dragging");
    this.elements.handle.setPointerCapture(event.pointerId);
  };
  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.dragPointerId) return;
    const deltaY = event.clientY - this.dragStartY;
    this.recordDragMotion(event.clientY);
    if (Math.abs(deltaY) >= 4) this.dragMoved = true;
    this.setOffset(this.dragStartOffsetPx + deltaY);
  };
  private readonly handlePointerUp = (event: PointerEvent): void => {
    this.finishDrag(event);
  };
  private readonly handlePointerCancel = (event: PointerEvent): void => {
    this.finishDrag(event, true);
  };
  private readonly handleHandleClick = (): void => {
    if (!this.openState) return;
    if (this.dragMoved) {
      this.dragMoved = false;
      return;
    }
    this.setOpen(false);
    this.elements.paintButton.focus({ preventScroll: true });
  };

  constructor(options: BrushLibraryControllerOptions) {
    this.engine = options.engine;
    this.browser = options.browser;
    this.document = options.document;
    this.elements = options.elements;
    this.previewRenderer = options.previewRenderer;
    this.strokePreviewRenderer = options.strokePreviewRenderer;
    this.applySettings = options.applySettings;
    this.canOpen = options.canOpen;
    this.beforeOpen = options.beforeOpen;
    this.beforeStudioOpen = options.beforeStudioOpen;
    this.isPaintSelected = options.isPaintSelected;
    this.onVisibilityChange = options.onVisibilityChange;
    this.onStatus = options.onStatus;

    const restored = loadBrushStudioLibraryState();
    this.customBrushes = [...(restored?.customBrushes ?? [])];
    const candidate = restored?.activeBrushId;
    this.activeBrushId = candidate === PENCIL_BRUSH_PRESET.id
      || candidate === "current"
      || this.customBrushes.some((brush) => brush.id === candidate)
      ? candidate as BrushLibraryBrushId
      : "current";
    this.category = this.activeBrushId === PENCIL_BRUSH_PRESET.id
      ? "pencil"
      : "painting";

    for (const brush of this.customBrushes) this.ensureCustomBrushCard(brush);
    this.bindControls();
    this.syncAddState();
    this.setCategory(this.category);
    this.syncSelection();
    this.elements.sheet.setAttribute("aria-hidden", "true");
    this.syncButtonState();
  }

  get isOpen(): boolean {
    return this.openState;
  }

  get isDragging(): boolean {
    return this.dragPointerId !== null;
  }

  attachStudio(studio: BrushStudioPort): void {
    if (this.studio && this.studio !== studio) {
      throw new Error("Brush Studio is already attached to the library.");
    }
    this.studio = studio;
    this.syncButtonState();
  }

  studioIntegration(): BrushStudioLibraryIntegration {
    return {
      setBrushLibraryOpen: (open) => this.setOpen(open),
      onOpenChange: (open) => {
        if (open) this.beforeStudioOpen();
        this.syncButtonState();
        this.onVisibilityChange();
      },
      onCommit: (brushId, brushName) => this.commitStudioBrush(brushId, brushName),
      onCommitted: (brushId) => this.finishStudioCommit(brushId),
      onStatus: (message, kind) => this.onStatus(message, kind),
    };
  }

  syncButtonState(): void {
    const paintSelected = this.isPaintSelected();
    const studioOpen = this.studio?.isOpen === true;
    const expanded = paintSelected && (this.openState || studioOpen);
    this.elements.paintButton.setAttribute("aria-expanded", String(expanded));
    this.elements.paintButton.setAttribute(
      "aria-label",
      paintSelected
        ? expanded
          ? studioOpen
            ? "Brush Studio open"
            : "Close brush library"
          : "Open brush library"
        : "Select Brush",
    );
  }

  setOpen(open: boolean): void {
    if (open && !this.canOpen()) return;
    if (open && this.studio?.isBusy) return;
    if (open) {
      this.studio?.cancel(false);
      if (this.studio?.isOpen) return;
      this.beforeOpen();
    }
    this.openState = open;
    this.elements.sheet.setAttribute("aria-hidden", String(!open));
    this.syncButtonState();
    if (open) {
      this.setCategory(this.category);
      this.setOffset(0);
      void this.elements.sheet.offsetHeight;
      this.elements.sheet.classList.add("is-open");
      if (this.previewsNeedRefresh()) this.schedulePreview();
      this.onVisibilityChange();
      return;
    }

    this.elements.sheet.classList.remove("is-open", "is-dragging");
    if (
      this.dragPointerId !== null
      && this.elements.handle.hasPointerCapture(this.dragPointerId)
    ) {
      this.elements.handle.releasePointerCapture(this.dragPointerId);
    }
    this.dragPointerId = null;
    this.dragMoved = false;
    this.previewDirty = true;
    this.previewRevision += 1;
    for (const card of this.elements.cards) {
      const preview = card.querySelector<HTMLCanvasElement>(".mobile-brush-card-preview");
      if (preview) this.strokePreviewRenderer.invalidate(preview);
    }
    if (this.previewFrame !== null) {
      this.browser.cancelAnimationFrame(this.previewFrame);
      this.previewFrame = null;
    }
    if (this.scrollTimer !== null) {
      this.browser.clearTimeout(this.scrollTimer);
      this.scrollTimer = null;
    }
    this.onVisibilityChange();
  }

  toggle(): void {
    this.setOpen(!this.openState);
  }

  markPreviewDirty(): void {
    this.previewDirty = true;
    this.previewRevision += 1;
    if (this.openState) this.schedulePreview();
  }

  handleResize(): void {
    if (this.openState && this.dragPointerId === null) this.setOffset(0);
  }

  async restoreActiveBrush(): Promise<void> {
    return this.enqueueSelection(() => this.performActiveBrushRestore());
  }

  private async performActiveBrushRestore(): Promise<void> {
    const studio = this.studio;
    if (!studio) return;
    const current = this.engine.getSettings();
    const fallback = this.fallbackFor(this.activeBrushId, current);
    try {
      const restored = await studio.resolveBrushSettings(this.activeBrushId, fallback);
      this.applySettings(restored);
      await this.engine.ensureCurrentBrushResources();
      this.setCategory(this.categoryFor(this.activeBrushId));
      this.syncSelection();
      this.syncAddState();
      this.markPreviewDirty();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        this.applySettings(currentBrushFallback(current));
        await this.engine.ensureCurrentBrushResources();
        this.activeBrushId = "current";
        this.setCategory("painting");
        this.persistActiveBrush();
        this.syncSelection();
        this.reportStatus(`${message} Default Brush selected.`, "error");
      } catch (fallbackError) {
        this.applySettings(current);
        this.reportStatus(
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          "error",
        );
      }
      this.onStatus(message, "error");
    }
  }

  dispose(): void {
    this.elements.addButton.removeEventListener("click", this.handleAddClick);
    this.elements.importButton.removeEventListener("click", this.handleImportClick);
    this.elements.exportButton.removeEventListener("click", this.handleExportClick);
    this.elements.importFile.removeEventListener("change", this.handleImportChange);
    this.elements.list.removeEventListener("click", this.handleListClick);
    this.elements.viewport.removeEventListener("scroll", this.handleScroll);
    this.elements.handle.removeEventListener("pointerdown", this.handlePointerDown);
    this.elements.handle.removeEventListener("pointermove", this.handlePointerMove);
    this.elements.handle.removeEventListener("pointerup", this.handlePointerUp);
    this.elements.handle.removeEventListener("pointercancel", this.handlePointerCancel);
    this.elements.handle.removeEventListener("click", this.handleHandleClick);
    for (const button of this.elements.categoryButtons) {
      button.removeEventListener("click", this.handleCategoryClick);
    }
    this.setOpen(false);
  }

  private readonly handleCategoryClick = (event: Event): void => {
    const button = event.currentTarget as HTMLButtonElement;
    const category = button.dataset.mobileBrushCategory;
    if (category === "pencil" || category === "painting") {
      this.setCategory(category);
    }
  };

  private bindControls(): void {
    this.elements.addButton.addEventListener("click", this.handleAddClick);
    this.elements.importButton.addEventListener("click", this.handleImportClick);
    this.elements.exportButton.addEventListener("click", this.handleExportClick);
    this.elements.importFile.addEventListener("change", this.handleImportChange);
    this.elements.list.addEventListener("click", this.handleListClick);
    this.elements.viewport.addEventListener("scroll", this.handleScroll, { passive: true });
    this.elements.handle.addEventListener("pointerdown", this.handlePointerDown);
    this.elements.handle.addEventListener("pointermove", this.handlePointerMove);
    this.elements.handle.addEventListener("pointerup", this.handlePointerUp);
    this.elements.handle.addEventListener("pointercancel", this.handlePointerCancel);
    this.elements.handle.addEventListener("click", this.handleHandleClick);
    for (const button of this.elements.categoryButtons) {
      button.addEventListener("click", this.handleCategoryClick);
    }
  }

  private fallbackFor(
    brushId: BrushLibraryBrushId,
    current: Readonly<BrushSettings>,
  ): BrushSettings {
    return brushId === PENCIL_BRUSH_PRESET.id
      ? resolveBrushPresetSettings(PENCIL_BRUSH_PRESET, current)
      : currentBrushFallback(current);
  }

  private isBrushId(value: string): value is BrushLibraryBrushId {
    return value === PENCIL_BRUSH_PRESET.id
      || value === "current"
      || (isBrushStudioCustomBrushId(value)
        && this.customBrushes.some((brush) => brush.id === value));
  }

  private categoryFor(brushId: BrushLibraryBrushId): BrushLibraryCategory {
    return brushId === PENCIL_BRUSH_PRESET.id ? "pencil" : "painting";
  }

  private brushName(brushId: BrushLibraryBrushId): string {
    const customName = this.customBrushes.find((brush) => brush.id === brushId)?.name;
    if (customName) return customName;
    const card = this.elements.cards.find(
      (candidate) => candidate.dataset.mobileBrushId === brushId,
    );
    return card?.querySelector<HTMLElement>(".mobile-brush-card-name")?.textContent?.trim()
      || (brushId === PENCIL_BRUSH_PRESET.id ? PENCIL_BRUSH_PRESET.name : "Default Brush");
  }

  private ensureCustomBrushCard(brush: BrushStudioCustomBrush): HTMLButtonElement {
    const existing = this.elements.cards.find(
      (card) => card.dataset.mobileBrushId === brush.id,
    );
    if (existing) {
      const name = existing.querySelector<HTMLElement>(".mobile-brush-card-name");
      if (name) name.textContent = brush.name;
      return existing;
    }

    const card = this.document.createElement("button");
    card.className = "mobile-brush-card";
    card.type = "button";
    card.dataset.mobileBrushId = brush.id;
    card.dataset.mobileBrushCategoryCard = "painting";
    card.setAttribute("aria-label", brush.name);
    card.setAttribute("aria-pressed", "false");

    const selected = this.document.createElement("span");
    selected.className = "mobile-brush-card-selected";
    selected.setAttribute("aria-hidden", "true");
    selected.append(createLucideElement(Check, { width: 16, height: 16 }));

    const name = this.document.createElement("span");
    name.className = "mobile-brush-card-name";
    name.textContent = brush.name;

    const canvas = this.document.createElement("canvas");
    canvas.className = "mobile-brush-card-preview";
    canvas.width = 240;
    canvas.height = 56;
    canvas.setAttribute("aria-hidden", "true");

    card.append(selected, name, canvas);
    this.elements.cards.push(card);
    this.elements.list.append(card);
    return card;
  }

  private syncAddState(): void {
    const full = this.customBrushes.length >= BRUSH_STUDIO_MAX_CUSTOM_BRUSHES;
    const canExport = isBrushStudioCustomBrushId(this.activeBrushId)
      && loadBrushStudioSavedBrush(this.activeBrushId) !== null;
    const busy = this.transferBusy || this.selectionBusy;
    this.elements.addButton.disabled = full || busy;
    this.elements.importButton.disabled = full || busy;
    this.elements.exportButton.disabled = busy;
    this.elements.exportButton.setAttribute(
      "aria-disabled",
      String(!canExport || busy),
    );
    this.elements.sheet.setAttribute("aria-busy", String(busy));
    this.elements.list.inert = busy;
    this.elements.addButton.title = full
      ? `Maximum ${BRUSH_STUDIO_MAX_CUSTOM_BRUSHES} custom brushes reached`
      : "New brush";
    this.elements.importButton.title = full
      ? `Maximum ${BRUSH_STUDIO_MAX_CUSTOM_BRUSHES} custom brushes reached`
      : "Import brush";
    this.elements.exportButton.title = canExport
      ? "Export selected brush"
      : "Select a saved custom brush to export";
    if (busy) return;
    if (canExport && this.elements.status.dataset.kind === "export-unavailable") {
      delete this.elements.status.dataset.kind;
      this.elements.status.textContent = "";
      this.elements.status.hidden = true;
    }
    if (
      full
      && (!this.elements.status.dataset.kind
        || this.elements.status.dataset.kind === "capacity")
    ) {
      this.elements.status.dataset.kind = "capacity";
      this.elements.status.textContent =
        `Maximum ${BRUSH_STUDIO_MAX_CUSTOM_BRUSHES} custom brushes reached.`;
      this.elements.status.hidden = false;
    } else if (this.elements.status.dataset.kind === "capacity") {
      delete this.elements.status.dataset.kind;
      this.elements.status.textContent = "";
      this.elements.status.hidden = true;
    }
  }

  private reportStatus(message: string, kind: TransferStatusKind): void {
    this.elements.status.dataset.kind = kind;
    this.elements.status.textContent = message;
    this.elements.status.hidden = !message;
  }

  private previewCanvas(brushId: BrushLibraryBrushId): HTMLCanvasElement {
    const card = this.elements.cards.find(
      (candidate) => candidate.dataset.mobileBrushId === brushId,
    );
    const canvas = card?.querySelector<HTMLCanvasElement>(".mobile-brush-card-preview");
    if (!canvas) throw new Error(`Brush preview canvas unavailable for ${brushId}.`);
    return canvas;
  }

  private visibleBrushIds(): BrushLibraryBrushId[] {
    const visible = [this.activeBrushId];
    const viewport = this.elements.viewport.getBoundingClientRect();
    const preloadMargin = 80;
    for (const card of this.elements.cards) {
      const brushId = card.dataset.mobileBrushId as BrushLibraryBrushId | undefined;
      const bounds = card.getBoundingClientRect();
      if (
        brushId
        && brushId !== this.activeBrushId
        && card.dataset.mobileBrushCategoryCard === this.category
        && bounds.bottom >= viewport.top - preloadMargin
        && bounds.top <= viewport.bottom + preloadMargin
      ) {
        visible.push(brushId);
      }
    }
    return visible;
  }

  private async settingsForPreview(
    brushId: BrushLibraryBrushId,
    current: Readonly<BrushSettings>,
  ): Promise<BrushSettings> {
    const fallback = this.fallbackFor(brushId, current);
    if (brushId === this.activeBrushId) return { ...current };
    const studio = this.studio;
    if (!studio) return fallback;
    const snapshot = studio.settingsSnapshot(brushId, fallback);
    if (this.previewRenderer.hasCompletePreview(
      brushId,
      this.previewCanvas(brushId),
      snapshot,
    )) {
      return snapshot;
    }
    return studio.resolveBrushSettings(brushId, fallback);
  }

  private renderPreview(): void {
    if (!this.openState) return;
    const current = this.engine.getSettings();
    const brushIds = this.visibleBrushIds();
    const revision = this.previewRevision;
    this.previewDirty = false;
    void (async () => {
      for (const brushId of brushIds) {
        if (!this.openState || revision !== this.previewRevision) return;
        let settings: BrushSettings;
        try {
          settings = await this.settingsForPreview(brushId, current);
        } catch {
          continue;
        }
        if (!this.openState || revision !== this.previewRevision) {
          if (brushId !== this.activeBrushId) {
            await this.studio?.releasePreviewAssets(brushId, settings);
          }
          return;
        }
        const releaseAfterRender = brushId !== this.activeBrushId;
        try {
          await this.previewRenderer.render(brushId, this.previewCanvas(brushId), settings);
        } finally {
          if (releaseAfterRender) {
            await this.studio?.releasePreviewAssets(brushId, settings);
          }
        }
      }
    })().then(() => {
      if (this.openState && this.previewDirty && revision !== this.previewRevision) {
        this.schedulePreview();
      }
    }).catch(() => {
      // Keep the last compact bitmap; reopening retries missing CPU assets.
    });
  }

  private schedulePreview(): void {
    if (this.previewFrame !== null) return;
    this.previewFrame = this.browser.requestAnimationFrame(() => {
      this.previewFrame = null;
      this.renderPreview();
    });
  }

  private previewsNeedRefresh(): boolean {
    return this.previewDirty || this.visibleBrushIds().some((brushId) => {
      const canvas = this.previewCanvas(brushId);
      return !canvas.dataset.previewFingerprint
        || canvas.dataset.previewSourceComplete !== "true";
    });
  }

  private setCategory(category: BrushLibraryCategory): void {
    if (this.category !== category) {
      this.previewDirty = true;
      this.previewRevision += 1;
    }
    this.category = category;
    for (const button of this.elements.categoryButtons) {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.mobileBrushCategory === category),
      );
    }
    const ordered = this.elements.cards.filter(
      (card) => card.dataset.mobileBrushId === this.activeBrushId,
    );
    ordered.push(...this.elements.cards.filter((card) => (
      card.dataset.mobileBrushId !== this.activeBrushId
      && card.dataset.mobileBrushCategoryCard === category
    )));
    for (const card of this.elements.cards) card.hidden = !ordered.includes(card);
    for (const card of ordered) this.elements.list.append(card);
    for (const card of this.elements.cards) {
      if (!ordered.includes(card)) this.elements.list.append(card);
    }
    this.elements.list.hidden = ordered.length === 0;
    this.elements.empty.hidden = ordered.length !== 0;
    if (this.openState && ordered.length > 0 && this.previewsNeedRefresh()) {
      this.schedulePreview();
    }
  }

  private syncSelection(): void {
    for (const card of this.elements.cards) {
      const selected = card.dataset.mobileBrushId === this.activeBrushId;
      card.classList.toggle("is-selected", selected);
      card.setAttribute("aria-pressed", String(selected));
      const name = card.querySelector<HTMLElement>(".mobile-brush-card-name")?.textContent
        ?.trim() || "Brush";
      card.setAttribute("aria-label", selected ? `${name}, selected` : name);
    }
  }

  private closedOffset(): number {
    return Math.max(0, Math.round(this.elements.sheet.offsetHeight));
  }

  private setOffset(offsetPx: number): void {
    this.offsetPx = Math.min(this.closedOffset(), Math.max(0, offsetPx));
    this.elements.sheet.style.setProperty(
      "--mobile-tools-sheet-offset",
      `${Math.round(this.offsetPx)}px`,
    );
  }

  private recordDragMotion(clientY: number): void {
    const sampleTime = this.browser.performance.now();
    const elapsedMs = sampleTime - this.dragLastTime;
    if (elapsedMs > 0 && elapsedMs <= 120) {
      const immediateVelocity = (clientY - this.dragLastY) / elapsedMs;
      this.dragVelocityY = this.dragVelocityY === 0
        ? immediateVelocity
        : this.dragVelocityY * 0.35 + immediateVelocity * 0.65;
    } else if (elapsedMs > 120) {
      this.dragVelocityY = 0;
    }
    this.dragLastY = clientY;
    this.dragLastTime = sampleTime;
  }

  private finishDrag(event: PointerEvent, cancelled = false): void {
    if (event.pointerId !== this.dragPointerId) return;
    if (this.elements.handle.hasPointerCapture(event.pointerId)) {
      this.elements.handle.releasePointerCapture(event.pointerId);
    }
    this.elements.sheet.classList.remove("is-dragging");
    const deltaY = event.clientY - this.dragStartY;
    const closedOffset = this.closedOffset();
    const releaseAgeMs = this.browser.performance.now() - this.dragLastTime;
    const releaseVelocityY = releaseAgeMs <= 100 ? this.dragVelocityY : 0;
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
      this.setOpen(false);
      return;
    }
    if (this.dragMoved) this.setOffset(0);
  }

  private async createBrush(): Promise<void> {
    await this.selectionQueue;
    const studio = this.studio;
    if (!studio) return;
    if (this.customBrushes.length >= BRUSH_STUDIO_MAX_CUSTOM_BRUSHES) {
      this.syncAddState();
      return;
    }
    const original = this.engine.getSettings();
    studio.rememberSettings(this.activeBrushId, original);
    const brushId = createBrushStudioCustomBrushId();
    const brushName = nextBrushStudioCustomBrushName(this.customBrushes);
    const base = createBrushStudioBaseSettings(defaultBrushSettings, original.color);
    this.applySettings(base);
    studio.open(brushId, brushName, base, original);
  }

  private latestCatalog(): BrushStudioCustomBrush[] {
    const latest = [...(loadBrushStudioLibraryState()?.customBrushes ?? [])];
    for (const localBrush of this.customBrushes) {
      if (
        latest.length < BRUSH_STUDIO_MAX_CUSTOM_BRUSHES
        && !latest.some((brush) => brush.id === localBrush.id)
      ) {
        latest.push(localBrush);
      }
    }
    return latest;
  }

  private adoptCatalog(catalog: readonly BrushStudioCustomBrush[]): void {
    this.customBrushes = [...catalog];
    for (const descriptor of this.customBrushes) this.ensureCustomBrushCard(descriptor);
  }

  private persistActiveBrush(): void {
    try {
      saveBrushStudioLibraryState(this.activeBrushId, this.customBrushes);
    } catch {
      // Saved settings remain authoritative; this pointer is only a restore hint.
    }
  }

  private async storedTransferAsset(key: string | null, kind: "shape" | "grain") {
    if (!key) return null;
    const asset = await loadBrushStudioAsset(key);
    if (!asset || asset.kind !== kind) {
      throw new Error(`The saved ${kind} source is unavailable. Nothing was exported.`);
    }
    return asset;
  }

  private async presentTransfer(
    blob: Blob,
    brushName: string,
  ): Promise<"shared" | "downloaded" | "cancelled"> {
    const fileName = brushStudioTransferFileName(brushName);
    const file = new File([blob], fileName, { type: BRUSH_STUDIO_TRANSFER_MIME_TYPE });
    const navigator = this.browser.navigator;
    if (
      typeof navigator.share === "function"
      && typeof navigator.canShare === "function"
      && navigator.canShare({ files: [file] })
    ) {
      try {
        await navigator.share({ files: [file], title: brushName, text: "M1M4 brush" });
        return "shared";
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      }
    }
    const url = URL.createObjectURL(blob);
    const anchor = this.document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.hidden = true;
    this.document.body.append(anchor);
    anchor.click();
    anchor.remove();
    this.browser.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return "downloaded";
  }

  private async exportActiveBrush(): Promise<void> {
    if (this.transferBusy) return;
    const brushId = this.activeBrushId;
    if (!isBrushStudioCustomBrushId(brushId)) {
      this.reportStatus("Select a saved custom brush to export.", "export-unavailable");
      return;
    }
    const savedBrush = loadBrushStudioSavedBrush(brushId);
    const descriptor = this.customBrushes.find((brush) => brush.id === brushId);
    if (!savedBrush || !descriptor) {
      this.reportStatus("This custom brush has not been saved yet.", "error");
      return;
    }
    this.transferBusy = true;
    this.syncAddState();
    this.reportStatus(`Preparing ${descriptor.name}…`, "working");
    try {
      const [shapeAsset, grainAsset] = await Promise.all([
        this.storedTransferAsset(savedBrush.shapeAssetKey, "shape"),
        this.storedTransferAsset(savedBrush.grainAssetKey, "grain"),
      ]);
      const blob = await createBrushStudioTransferBlob({
        name: descriptor.name,
        savedBrush,
        shapeAsset,
        grainAsset,
      });
      const outcome = await this.presentTransfer(blob, descriptor.name);
      this.reportStatus(
        outcome === "shared"
          ? `${descriptor.name} shared.`
          : outcome === "downloaded"
            ? `${descriptor.name} exported.`
            : "Export cancelled.",
        "ok",
      );
    } catch (error) {
      this.reportStatus(error instanceof Error ? error.message : String(error), "error");
    } finally {
      this.transferBusy = false;
      this.syncAddState();
    }
  }

  private async rollbackImport(
    brushId: BrushStudioCustomBrushId,
    assetKeys: readonly string[],
    resolvedSettings: Readonly<BrushSettings> | null,
  ): Promise<void> {
    if (resolvedSettings && this.studio) {
      try {
        await this.studio.releasePreviewAssets(brushId, resolvedSettings);
      } catch {
        // The brush was never active; a transient registry entry is recoverable.
      }
    }
    this.studio?.forgetSettings(brushId);
    try {
      deleteBrushStudioSavedBrush(brushId);
    } catch {
      // A unique import id cannot shadow an existing brush.
    }
    for (const key of assetKeys) {
      try {
        await deleteBrushStudioAsset(key);
      } catch {
        // Storage cleanup can reclaim an unreachable import blob later.
      }
    }
  }

  private async importBrush(file: File): Promise<void> {
    const studio = this.studio;
    if (!studio || this.transferBusy) return;
    if (file.size > BRUSH_STUDIO_TRANSFER_MAX_FILE_BYTES) {
      this.reportStatus("Choose an M1M4 brush file smaller than 42 MB.", "error");
      return;
    }
    const openingCatalog = this.latestCatalog();
    if (openingCatalog.length >= BRUSH_STUDIO_MAX_CUSTOM_BRUSHES) {
      this.adoptCatalog(openingCatalog);
      this.syncAddState();
      this.reportStatus(
        `Maximum ${BRUSH_STUDIO_MAX_CUSTOM_BRUSHES} custom brushes reached.`,
        "error",
      );
      return;
    }

    this.transferBusy = true;
    this.syncAddState();
    this.reportStatus(`Importing ${file.name}…`, "working");
    let brushId: BrushStudioCustomBrushId | null = null;
    let resolvedSettings: BrushSettings | null = null;
    const assetKeys: string[] = [];
    let catalogCommitted = false;
    try {
      const imported = await parseBrushStudioTransferBlob(file);
      let catalog = this.latestCatalog();
      if (catalog.length >= BRUSH_STUDIO_MAX_CUSTOM_BRUSHES) {
        this.adoptCatalog(catalog);
        throw new Error(`Maximum ${BRUSH_STUDIO_MAX_CUSTOM_BRUSHES} custom brushes reached.`);
      }

      brushId = createBrushStudioCustomBrushId();
      const settings = { ...imported.settings };
      let shapeAssetKey: string | null = null;
      let grainAssetKey: string | null = null;
      if (imported.shapeAsset) {
        const shapeAssetId = createBrushStudioImportedAssetId(brushId, "shape");
        settings.shapeAssetId = shapeAssetId;
        shapeAssetKey = brushStudioAssetStorageKey(brushId, "shape", shapeAssetId);
        assetKeys.push(shapeAssetKey);
        await saveBrushStudioAsset(
          shapeAssetKey,
          "shape",
          imported.shapeAsset.blob,
          imported.shapeAsset.name,
        );
      }
      if (imported.grainAsset) {
        const grainAssetId = createBrushStudioImportedAssetId(brushId, "grain");
        settings.grainAssetId = grainAssetId;
        grainAssetKey = brushStudioAssetStorageKey(brushId, "grain", grainAssetId);
        assetKeys.push(grainAssetKey);
        await saveBrushStudioAsset(
          grainAssetKey,
          "grain",
          imported.grainAsset.blob,
          imported.grainAsset.name,
        );
      }
      saveBrushStudioSavedBrush(brushId, {
        version: 1,
        settings,
        shapeAssetKey,
        grainAssetKey,
      });

      const current = this.engine.getSettings();
      resolvedSettings = await studio.resolveBrushSettings(brushId, currentBrushFallback(current));
      catalog = this.latestCatalog();
      if (catalog.length >= BRUSH_STUDIO_MAX_CUSTOM_BRUSHES) {
        this.adoptCatalog(catalog);
        throw new Error(`Maximum ${BRUSH_STUDIO_MAX_CUSTOM_BRUSHES} custom brushes reached.`);
      }
      const now = Date.now();
      const descriptor: BrushStudioCustomBrush = {
        id: brushId,
        name: uniqueBrushStudioCustomBrushName(imported.name, catalog),
        createdAt: now,
        updatedAt: now,
      };
      const nextCatalog = [...catalog, descriptor];
      saveBrushStudioLibraryState(brushId, nextCatalog);
      catalogCommitted = true;
      this.adoptCatalog(nextCatalog);
      await this.selectBrush(brushId);
      this.reportStatus(`${descriptor.name} imported.`, "ok");
    } catch (error) {
      if (brushId && !catalogCommitted) {
        await this.rollbackImport(brushId, assetKeys, resolvedSettings);
      }
      this.reportStatus(error instanceof Error ? error.message : String(error), "error");
    } finally {
      this.transferBusy = false;
      this.syncAddState();
    }
  }

  private async selectBrush(brushId: BrushLibraryBrushId): Promise<void> {
    return this.enqueueSelection(() => this.performBrushSelection(brushId));
  }

  private async performBrushSelection(brushId: BrushLibraryBrushId): Promise<void> {
    const studio = this.studio;
    if (!studio) return;
    if (brushId === this.activeBrushId) {
      studio.open(brushId, this.brushName(brushId), this.engine.getSettings());
      return;
    }
    const current = this.engine.getSettings();
    const previousBrushId = this.activeBrushId;
    studio.rememberSettings(this.activeBrushId, current);
    let applied = false;
    try {
      const settings = await studio.resolveBrushSettings(
        brushId,
        this.fallbackFor(brushId, current),
      );
      this.applySettings(settings);
      applied = true;
      await this.engine.ensureCurrentBrushResources();
      this.activeBrushId = brushId;
      this.setCategory(this.categoryFor(brushId));
      this.persistActiveBrush();
      this.syncSelection();
      this.syncAddState();
      this.markPreviewDirty();
      void studio.releasePreviewAssets(previousBrushId, current);
    } catch (error) {
      if (applied) {
        this.applySettings(current);
        try {
          await this.engine.ensureCurrentBrushResources();
        } catch {
          // The prior settings remain selected even if readiness cannot be
          // reconfirmed; the engine keeps its own last valid GPU resources.
        }
        this.activeBrushId = previousBrushId;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.onStatus(message, "error");
      this.reportStatus(message, "error");
    }
  }

  private enqueueSelection(operation: () => Promise<void>): Promise<void> {
    const queued = this.selectionQueue.then(async () => {
      this.selectionBusy = true;
      this.syncAddState();
      try {
        await operation();
      } finally {
        this.selectionBusy = false;
        this.syncAddState();
      }
    });
    this.selectionQueue = queued.catch(() => {
      // Keep the queue usable after a failed, externally supplied operation.
    });
    return queued;
  }

  private async commitStudioBrush(brushId: string, brushName: string): Promise<void> {
    const latest = this.latestCatalog();
    let next = latest;
    if (isBrushStudioCustomBrushId(brushId)) {
      const existing = latest.find((brush) => brush.id === brushId);
      if (!existing && latest.length >= BRUSH_STUDIO_MAX_CUSTOM_BRUSHES) {
        throw new Error(`Maximum ${BRUSH_STUDIO_MAX_CUSTOM_BRUSHES} custom brushes reached.`);
      }
      const now = Date.now();
      const committed: BrushStudioCustomBrush = {
        id: brushId,
        name: brushName,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      next = existing
        ? latest.map((brush) => brush.id === brushId ? committed : brush)
        : [...latest, committed];
    }
    const committedId = this.normalizedBrushId(brushId);
    // Resource readiness is part of the commit precondition. Publishing the
    // catalog first would leave a durable card pointing at a brush that the
    // engine failed to make usable, while Studio rolls its own record back.
    await this.engine.ensureCurrentBrushResources();
    saveBrushStudioLibraryState(committedId, next);
    this.customBrushes = next;
  }

  private finishStudioCommit(brushId: string): void {
    const committedId = this.normalizedBrushId(brushId);
    for (const descriptor of this.customBrushes) this.ensureCustomBrushCard(descriptor);
    this.activeBrushId = committedId;
    this.syncAddState();
    this.setCategory(this.categoryFor(committedId));
    this.syncSelection();
    this.markPreviewDirty();
  }

  private normalizedBrushId(brushId: string): BrushLibraryBrushId {
    return brushId === PENCIL_BRUSH_PRESET.id
      || brushId === "current"
      || isBrushStudioCustomBrushId(brushId)
      ? brushId
      : "current";
  }
}
