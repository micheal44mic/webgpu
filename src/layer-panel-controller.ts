import {
  Eye,
  EyeOff,
  createElement as createLucideElement,
  type IconNode,
} from "lucide";
import type { EngineStats } from "./engine-stats";
import { LAYER_STACK_MAXIMUM } from "./layer-stack";
import {
  LAYER_THUMBNAIL_HEIGHT,
  LAYER_THUMBNAIL_SIZE,
  LAYER_THUMBNAIL_WIDTH,
} from "./layer-thumbnail-renderer";
import type { LayerThumbnailController } from "./layer-thumbnail-controller";
import {
  buildMobileLayerMergeSelectionPlan,
  type MobileLayerMergeSelectionItem,
  type MobileLayerMergeSelectionPlan,
} from "./mobile-layer-multi-selection";
import {
  MOBILE_LAYER_REORDER_HOLD_MS,
  mobileLayerReorderAutoScrollVelocity,
  mobileLayerReorderDropSlot,
  mobileLayerReorderHoldReached,
  mobileLayerReorderMovementExceeded,
  type MobileLayerReorderPlan,
  type MobileLayerReorderRowGeometry,
} from "./mobile-layer-reorder-core";
import {
  mobileSemanticLayerThumbnailSignature,
  type MobileSemanticLayerThumbnailSource,
} from "./mobile-semantic-layer-thumbnail";
import {
  RASTER_IMAGE_NODE_MAXIMUM,
  VECTOR_SVG_NODE_MAXIMUM,
  VECTOR_TEXT_NODE_MAXIMUM,
} from "./mixed-scene-stack";
import {
  isSceneLayerKey,
  sceneLayerDisplayName,
  selectedSceneLayerProperties,
  type SceneLayerKey,
  type SceneLayerKind,
  type SceneLayerProperties,
} from "./scene-layer-read-model";

export type LayerPanelKey = SceneLayerKey;
export type LayerPanelKind = SceneLayerKind;
export type LayerPanelProperties = SceneLayerProperties;
const DOCUMENT_BACKGROUND_ROW_KEY = "background" as const;
type LayerPanelRowKey = LayerPanelKey | typeof DOCUMENT_BACKGROUND_ROW_KEY;

export interface LayerPanelDuplicateResult {
  readonly kind: LayerPanelKind;
  readonly name: string;
  readonly totalMs: number;
  readonly sourceKey: LayerPanelKey;
  readonly duplicateKey: LayerPanelKey;
  readonly sourceRasterLayerId: number | null;
  readonly duplicateRasterLayerId: number | null;
}

export interface LayerPanelRasterizeResult {
  readonly kind: "raster" | "svg";
  readonly name: string;
  readonly changed: boolean;
  readonly outputKey: LayerPanelKey;
}

export interface LayerPanelElements {
  readonly trigger: HTMLButtonElement;
  readonly panel: HTMLElement;
  readonly addButton: HTMLButtonElement;
  readonly copyButton: HTMLButtonElement;
  readonly addMaskButton: HTMLButtonElement;
  readonly multiSelectButton: HTMLButtonElement;
  readonly list: HTMLElement;
  readonly multiActions: HTMLElement;
  readonly mergeSelectionButton: HTMLButtonElement;
  readonly contextMenu: HTMLElement;
  readonly clippingButton: HTMLButtonElement;
  readonly optionsButton: HTMLButtonElement;
  readonly rasterizeButton: HTMLButtonElement;
  readonly mergeButton: HTMLButtonElement;
  readonly mergeReason: HTMLParagraphElement;
  readonly mergeStatus: HTMLParagraphElement;
  readonly deleteButton: HTMLButtonElement;
  readonly reorderStatus: HTMLParagraphElement;
}

export interface LayerPanelReorderTargets {
  readonly movingKeys: readonly LayerPanelKey[];
  readonly topFirstKeysWithoutMoving: readonly LayerPanelKey[];
  readonly validTargetTopFirstSlots: readonly number[];
}

export interface LayerPanelMergeResult {
  readonly itemCount: number;
}

export interface LayerPanelBrowser extends Window {
  readonly AbortController: typeof AbortController;
  readonly CSS: typeof CSS;
  readonly Element: typeof Element;
  readonly HTMLElement: typeof HTMLElement;
  readonly Node: typeof Node;
}

export interface LayerPanelControllerOptions {
  readonly browser: LayerPanelBrowser;
  readonly document: Document;
  readonly elements: LayerPanelElements;
  readonly thumbnails: LayerThumbnailController;
  readonly getStats: () => EngineStats | null;
  readonly isInteractionLocked: () => boolean;
  readonly isRenderDeferred: () => boolean;
  readonly canOpen: () => boolean;
  readonly beforeOpen: () => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly getReorderTargets: (key: LayerPanelKey) => LayerPanelReorderTargets;
  readonly moveLayer: (key: LayerPanelKey, targetTopFirstSlot: number) => Promise<boolean>;
  readonly mergeCapabilityError: (
    orderedKeys: readonly LayerPanelKey[],
    stats: EngineStats,
  ) => string | null;
  readonly mergeLayers: (
    orderedKeys: readonly LayerPanelKey[],
  ) => Promise<LayerPanelMergeResult>;
  readonly rasterizeLayer: (
    key: LayerPanelKey,
  ) => Promise<LayerPanelRasterizeResult>;
  readonly addRasterLayer: () => void;
  readonly duplicateSelectedLayer: () => Promise<LayerPanelDuplicateResult>;
  readonly addClippingMaskLayer: () => void;
  readonly selectLayer: (key: LayerPanelKey) => void;
  readonly setLayerVisibility: (key: LayerPanelKey, visible: boolean) => void;
  readonly setRasterReference: (key: LayerPanelKey, enabled: boolean) => void;
  readonly setDocumentBackgroundVisibility: (visible: boolean) => boolean;
  readonly setDocumentBackgroundColor: (color: string) => boolean;
  readonly setRasterClipping: (key: LayerPanelKey, enabled: boolean) => void;
  readonly deleteLayer: (key: LayerPanelKey) => Promise<void>;
  readonly openLayerOptions: (trigger: HTMLElement) => void;
  readonly onLayerResult: (message: string) => void;
  readonly onStatus: (message: string, failed: boolean) => void;
  readonly recordDiagnostic: (
    name: string,
    detail: string | null,
    error: unknown,
  ) => void;
}

interface LayerPanelViewBase {
  readonly name: string;
  readonly visible: boolean;
  readonly selected: boolean;
  readonly rasterIndex: number | null;
  readonly rasterLayerId: number | null;
  readonly reference: boolean;
  readonly referenceAvailable: boolean;
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

interface SceneLayerPanelView extends LayerPanelViewBase {
  readonly key: LayerPanelKey;
  readonly kind: LayerPanelKind;
}

interface BackgroundLayerPanelView extends LayerPanelViewBase {
  readonly key: typeof DOCUMENT_BACKGROUND_ROW_KEY;
  readonly kind: "background";
}

type LayerPanelView = SceneLayerPanelView | BackgroundLayerPanelView;

interface LayerPanelReorderGesture {
  readonly pointerId: number;
  readonly key: LayerPanelKey;
  readonly name: string;
  readonly row: HTMLElement;
  readonly select: HTMLButtonElement;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly startTime: number;
  readonly startScrollTop: number;
  readonly restoreFocus: boolean;
  readonly sceneOrderSignature: string;
  holdTimer: number | null;
  phase: "pending" | "armed" | "dragging";
  plan: MobileLayerReorderPlan | null;
  currentSlot: number;
  clientY: number;
  frame: number | null;
  lastFrameTime: number;
}

export function layerPanelDisplayName(name: string): string {
  return sceneLayerDisplayName(name);
}

export function isLayerPanelKey(key: string): key is LayerPanelKey {
  return isSceneLayerKey(key);
}

/**
 * Owns the complete Layers UI surface. Scene mutations remain behind narrow
 * callbacks so this controller cannot become a second BrushEngine facade.
 */
export class LayerPanelController {
  private readonly abortController: AbortController;
  private openState = false;
  private renderSignature = "";
  private refreshRequested = true;
  private refreshFrame: number | null = null;
  private multiSelectEnabled = false;
  private readonly selectedKeys = new Set<LayerPanelKey>();
  private reorderGesture: LayerPanelReorderGesture | null = null;
  private contextKey: LayerPanelKey | null = null;
  private contextOrderSignature: string | null = null;
  private suppressClickKey: string | null = null;
  private suppressClickUntil = 0;
  private announcementFrame: number | null = null;
  private disposed = false;

  constructor(private readonly options: LayerPanelControllerOptions) {
    this.abortController = new options.browser.AbortController();
    this.options.elements.panel.setAttribute("aria-hidden", "true");
    this.options.elements.panel.setAttribute("inert", "");
    this.options.elements.contextMenu.setAttribute("inert", "");
    this.bindControls();
  }

  get isOpen(): boolean {
    return this.openState;
  }

  get isReordering(): boolean {
    return this.reorderGesture !== null;
  }

  get isMultiSelect(): boolean {
    return this.multiSelectEnabled;
  }

  toggle(): void {
    this.setOpen(!this.openState);
  }

  setOpen(open: boolean): void {
    if ((this.disposed && open) || open === this.openState) return;
    if (open && !this.options.canOpen()) return;
    if (open) this.options.beforeOpen();
    const { trigger, panel } = this.options.elements;

    if (!open) {
      const focusWasInside = panel.contains(this.options.document.activeElement)
        || this.reorderGesture !== null;
      this.closeContextMenu(false);
      this.cancelReorder(false, true, false);
      this.setMultiSelect(false, false);
      if (focusWasInside) trigger.focus({ preventScroll: true });
    }

    this.openState = open;
    trigger.setAttribute("aria-expanded", String(open));
    trigger.setAttribute("aria-label", open ? "Close layers menu" : "Open layers menu");
    if (open) panel.removeAttribute("inert");
    else panel.setAttribute("inert", "");
    panel.setAttribute("aria-hidden", String(!open));

    if (open) {
      this.renderSignature = "";
      this.requestRefresh();
      const stats = this.options.getStats();
      if (stats) this.render(stats);
      void panel.offsetWidth;
      panel.classList.add("is-open");
      this.options.thumbnails.setPanelOpen(true);
      this.options.onOpenChange(true);
      return;
    }

    panel.classList.remove("is-open");
    this.options.thumbnails.setPanelOpen(false);
    if (this.refreshFrame !== null) {
      this.options.browser.cancelAnimationFrame(this.refreshFrame);
      this.refreshFrame = null;
    }
    this.options.onOpenChange(false);
  }

  selectedLayerProperties(requestedKey: string | null = null): LayerPanelProperties | null {
    const stats = this.options.getStats();
    if (!stats) return null;
    return selectedSceneLayerProperties(
      stats,
      this.options.isInteractionLocked(),
      requestedKey,
    );
  }

  requestRefresh(): void {
    this.refreshRequested = true;
  }

  scheduleRefresh(): void {
    this.requestRefresh();
    if (!this.openState || this.refreshFrame !== null || this.disposed) return;
    this.refreshFrame = this.options.browser.requestAnimationFrame(() => {
      this.refreshFrame = null;
      const stats = this.options.getStats();
      if (stats) this.render(stats);
    });
  }

  requestActiveThumbnail(delayMs = 120): void {
    this.options.thumbnails.invalidateActive(delayMs);
  }

  ensureActiveThumbnail(delayMs = 0): void {
    this.options.thumbnails.ensureActive(delayMs);
  }

  resumeThumbnailCapture(delayMs = 0): void {
    this.options.thumbnails.resumeCapture(delayMs);
  }

  syncInteractionState(): void {
    if (this.disposed) return;
    const locked = this.options.isInteractionLocked();
    const { list } = this.options.elements;
    if (locked) {
      list.setAttribute("inert", "");
      this.closeContextMenu(false);
    } else {
      list.removeAttribute("inert");
    }
    list.setAttribute("aria-disabled", String(locked));
    const stats = this.options.getStats();
    if (stats) this.syncToolbar(stats, locked);
    this.requestRefresh();
  }

  render(stats: EngineStats): void {
    if (!this.openState || !this.refreshRequested) return;
    this.options.thumbnails.queueMissing();
    const locked = this.options.isInteractionLocked();
    const { list } = this.options.elements;
    if (locked) list.setAttribute("inert", "");
    else list.removeAttribute("inert");
    list.setAttribute("aria-disabled", String(locked));
    this.reconcileMultiSelection(stats);
    const liveKeys = new Set(this.mergeSelectionItems(stats).map((item) => item.key));
    const contextStillSelected = this.contextKey === null
      || (this.multiSelectEnabled
        ? this.selectedKeys.has(this.contextKey)
        : this.primaryKey(stats) === this.contextKey);
    if (
      this.contextKey !== null
      && (
        locked
        || !liveKeys.has(this.contextKey)
        || !contextStillSelected
        || this.contextOrderSignature !== this.orderSignature(stats)
      )
    ) {
      this.closeContextMenu(false);
    }
    if (
      this.reorderGesture !== null
      && this.reorderGesture.sceneOrderSignature !== this.orderSignature(stats)
    ) {
      this.cancelReorder(false, false, false);
    }
    this.syncToolbar(stats, locked);
    if (this.reorderGesture !== null || this.options.isRenderDeferred()) return;
    const views = this.views(stats);
    const { multiActions, mergeSelectionButton, mergeStatus } = this.options.elements;
    multiActions.hidden = !this.multiSelectEnabled;
    if (this.multiSelectEnabled) {
      const plan = this.currentMergePlan(stats);
      const mergeReason = this.mergeUnavailableReason(plan, stats);
      mergeSelectionButton.disabled = locked || mergeReason !== null;
      mergeSelectionButton.title = mergeReason ?? "Unisci i livelli selezionati";
      if (!mergeStatus.classList.contains("is-error")) this.setMergeStatus(mergeReason);
    } else {
      mergeSelectionButton.disabled = true;
      mergeSelectionButton.title = "";
    }
    const signature = this.listSignature(views, locked);
    if (signature === this.renderSignature) {
      this.refreshRequested = false;
      return;
    }

    const rowsMatch = list.childElementCount === views.length
      && views.every(
        (view, position) =>
          (list.children[position] as HTMLElement | undefined)?.dataset.layerKey === view.key,
      );
    if (!rowsMatch) {
      list.replaceChildren(...views.map((view) => this.createRow(view.key)));
    }

    views.forEach((view, position) => {
      const row = list.children[position] as HTMLDivElement;
      const select = row.querySelector<HTMLButtonElement>(".mobile-layer-select");
      const thumbnail = row.querySelector<HTMLSpanElement>(".mobile-layer-thumbnail");
      const name = row.querySelector<HTMLSpanElement>(".mobile-layer-name");
      const reference = row.querySelector<HTMLButtonElement>(".mobile-layer-reference");
      const backgroundColorControl = row.querySelector<HTMLLabelElement>(
        ".mobile-layer-background-color",
      );
      const backgroundColorInput = backgroundColorControl?.querySelector<HTMLInputElement>(
        'input[type="color"]',
      );
      const visibility = row.querySelector<HTMLButtonElement>(".mobile-layer-visibility");
      if (
        !select
        || !thumbnail
        || !name
        || !reference
        || !backgroundColorControl
        || !backgroundColorInput
        || !visibility
      ) return;

      const background = view.kind === "background";
      const selected = this.multiSelectEnabled && !background
        ? this.selectedKeys.has(view.key)
        : view.selected;
      row.className = `mobile-layer-row is-${view.kind}`
        + `${selected ? " is-selected" : ""}`
        + `${this.multiSelectEnabled && selected ? " is-multi-selected" : ""}`
        + `${view.selected ? " is-active-layer" : ""}`;
      row.setAttribute("aria-posinset", String(position + 1));
      row.setAttribute("aria-setsize", String(views.length));
      select.disabled = locked || background;
      select.setAttribute("aria-current", String(view.selected));
      if (this.multiSelectEnabled) select.setAttribute("aria-pressed", String(selected));
      else select.removeAttribute("aria-pressed");
      select.setAttribute(
        "aria-label",
        background
          ? `${view.name}, livello bloccato sempre in fondo`
          : this.multiSelectEnabled
          ? selected
            ? `${view.name}, selected. Tap to remove it from the merge selection; `
              + "hold for selection actions."
            : `Add ${view.name} to the merge selection`
          : view.selected
            ? `${view.name}. Hold for layer options, then drag to reorder; `
              + "Alt plus Arrow Up or Down also moves it."
            : `Select ${view.name}`,
      );
      if (!background && view.selected && !this.multiSelectEnabled) {
        select.setAttribute("aria-keyshortcuts", "Alt+ArrowUp Alt+ArrowDown");
      } else {
        select.removeAttribute("aria-keyshortcuts");
      }
      select.title = view.name;
      name.textContent = view.name;
      if (background) {
        thumbnail.dataset.kind = "background";
        thumbnail.dataset.thumbnailSignature = `background:${view.thumbnailColor ?? ""}`;
        thumbnail.style.setProperty(
          "--mobile-layer-background-color",
          view.thumbnailColor ?? "#ffffff",
        );
        thumbnail.querySelector<HTMLCanvasElement>(".mobile-layer-thumbnail-canvas")!.hidden = true;
        thumbnail.querySelector<HTMLSpanElement>(".mobile-layer-thumbnail-content")!.hidden = true;
        thumbnail.querySelector<HTMLSpanElement>(".mobile-layer-thumbnail-glyph")!.hidden = true;
      } else {
        thumbnail.style.removeProperty("--mobile-layer-background-color");
        this.options.thumbnails.render(thumbnail, view);
      }

      reference.hidden = view.kind !== "raster";
      reference.disabled = locked || this.multiSelectEnabled || !view.referenceAvailable;
      reference.setAttribute("aria-pressed", String(view.reference));
      reference.setAttribute(
        "aria-label",
        `${view.reference ? "Disable" : "Set"} Reference for ${view.name}`,
      );
      reference.title = view.reference ? "Reference on" : "Set as Reference";

      backgroundColorControl.hidden = !background;
      backgroundColorControl.style.setProperty(
        "--mobile-layer-background-color",
        view.thumbnailColor ?? "#ffffff",
      );
      backgroundColorInput.disabled = locked || this.multiSelectEnabled || !background;
      if (background && backgroundColorInput.value !== view.thumbnailColor) {
        backgroundColorInput.value = view.thumbnailColor ?? "#ffffff";
      }

      visibility.disabled = locked || this.multiSelectEnabled;
      visibility.setAttribute("aria-pressed", String(view.visible));
      visibility.setAttribute("aria-label", `${view.visible ? "Hide" : "Show"} ${view.name}`);
      visibility.title = view.visible ? "Hide layer" : "Show layer";
      visibility.replaceChildren(this.createIconStack(view.visible ? Eye : EyeOff));
    });

    this.renderSignature = signature;
    this.refreshRequested = false;
  }

  cancelTransientInteractions(): void {
    this.closeContextMenu(false);
    this.cancelReorder();
  }

  cancelActiveGesture(): void {
    this.cancelTransientInteractions();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortController.abort();
    this.closeContextMenu(false);
    this.cancelReorder(false, false, false);
    this.setMultiSelect(false, false);
    this.openState = false;
    const { trigger, panel } = this.options.elements;
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-label", "Open layers menu");
    panel.classList.remove("is-open");
    panel.setAttribute("inert", "");
    panel.setAttribute("aria-hidden", "true");
    this.options.thumbnails.setPanelOpen(false);
    if (this.refreshFrame !== null) {
      this.options.browser.cancelAnimationFrame(this.refreshFrame);
      this.refreshFrame = null;
    }
    if (this.announcementFrame !== null) {
      this.options.browser.cancelAnimationFrame(this.announcementFrame);
      this.announcementFrame = null;
    }
  }

  private bindControls(): void {
    const { elements, browser, document } = this.options;
    this.listen(elements.trigger, "click", () => this.toggle());
    this.listen(elements.addButton, "click", () => {
      if (!elements.addButton.disabled) this.options.addRasterLayer();
    });
    this.listen(elements.copyButton, "click", () => {
      if (!elements.copyButton.disabled) void this.duplicateSelected();
    });
    this.listen(elements.addMaskButton, "click", () => {
      if (!elements.addMaskButton.disabled) this.options.addClippingMaskLayer();
    });
    this.listen(elements.multiSelectButton, "click", () => {
      if (elements.multiSelectButton.disabled || this.options.isInteractionLocked()) return;
      this.setMultiSelect(!this.multiSelectEnabled);
    });
    this.listen(elements.list, "pointerdown", (raw) => {
      this.handleReorderPointerDown(raw as PointerEvent);
    });
    this.listen(elements.list, "pointermove", (raw) => {
      this.handleReorderPointerMove(raw as PointerEvent);
    });
    this.listen(elements.list, "pointerup", (raw) => {
      this.handleReorderPointerUp(raw as PointerEvent);
    });
    for (const type of ["pointercancel", "lostpointercapture"] as const) {
      this.listen(elements.list, type, (raw) => {
        this.handleReorderPointerEnd(raw as PointerEvent);
      });
    }
    this.listen(elements.list, "keydown", (raw) => {
      this.handleReorderKeydown(raw as KeyboardEvent);
    });
    this.listen(elements.list, "contextmenu", (raw) => {
      this.handleContextMenu(raw as MouseEvent);
    });
    this.listen(elements.list, "click", (raw) => this.handleListClick(raw as MouseEvent));
    this.listen(elements.list, "change", (raw) => this.handleBackgroundColorInput(raw));
    this.listen(elements.clippingButton, "click", () => this.requestClippingToggle());
    this.listen(elements.optionsButton, "click", () => this.requestLayerOptions());
    this.listen(elements.rasterizeButton, "click", () => {
      if (!elements.rasterizeButton.disabled) void this.requestRasterize();
    });
    this.listen(elements.mergeButton, "click", () => {
      if (!elements.mergeButton.disabled) void this.requestMerge();
    });
    this.listen(elements.mergeSelectionButton, "click", () => {
      if (!elements.mergeSelectionButton.disabled) void this.requestMerge();
    });
    this.listen(elements.deleteButton, "click", () => void this.requestDelete());
    this.listen(document, "pointerdown", (raw) => {
      const event = raw as PointerEvent;
      if (this.contextKey === null || !(event.target instanceof browser.Node)) return;
      if (elements.contextMenu.contains(event.target)) return;
      const activeRow = elements.list.querySelector<HTMLElement>(
        `[data-layer-key="${browser.CSS.escape(this.contextKey)}"]`,
      );
      if (activeRow?.contains(event.target)) return;
      this.closeContextMenu(false);
    }, true);
    this.listen(document, "keydown", (raw) => {
      const event = raw as KeyboardEvent;
      if (event.key !== "Escape" || this.contextKey === null) return;
      event.preventDefault();
      this.closeContextMenu(true);
    });
    this.listen(browser, "pointerdown", (raw) => {
      const event = raw as PointerEvent;
      if (this.reorderGesture && event.pointerId !== this.reorderGesture.pointerId) {
        this.cancelReorder();
      }
    }, true);
    this.listen(browser, "keydown", (raw) => {
      const event = raw as KeyboardEvent;
      if (event.key !== "Escape" || !this.reorderGesture) return;
      event.preventDefault();
      this.cancelReorder();
    });
    this.listen(document, "visibilitychange", () => {
      if (document.visibilityState !== "visible") this.cancelReorder();
    });
    this.listen(browser, "resize", () => this.cancelReorder());
    this.listen(browser, "blur", () => this.cancelReorder());
  }

  private listen(
    target: EventTarget,
    type: string,
    listener: (event: Event) => void,
    capture = false,
  ): void {
    target.addEventListener(type, listener, {
      capture,
      signal: this.abortController.signal,
    });
  }

  private primaryKey(stats: EngineStats): LayerPanelKey | null {
    const sceneKey = stats.mixedScene?.selectedKey ?? null;
    if (sceneKey) return sceneKey;
    const active = stats.layers[stats.activeLayerIndex];
    return active ? `raster:${active.id}` : null;
  }

  private orderSignature(stats: EngineStats): string {
    const scene = stats.mixedScene;
    if (!scene) {
      const entries = stats.layers.map((layer) => (
        `raster:${layer.id}>${layer.clippingParentId ?? "root"}`
      ));
      return `raster:${stats.activeLayerId}|`
        + entries.reverse().join("|");
    }
    const entries = scene.items.map((item) => (
      item.kind === "raster"
        ? `${item.key}>${item.rasterClippingParentId ?? "root"}`
        : `${item.key}>semantic`
    ));
    return `${scene.selectedKey}|${entries.reverse().join("|")}`;
  }

  private mergeSelectionItems(
    stats: EngineStats,
  ): MobileLayerMergeSelectionItem<LayerPanelKey>[] {
    const scene = stats.mixedScene;
    if (!scene) {
      return stats.layers.map((layer) => ({
        key: `raster:${layer.id}`,
        clippingParentKey: layer.clippingParentId === null
          ? null
          : `raster:${layer.clippingParentId}`,
      }));
    }
    return scene.items.map((item) => ({
      key: item.key,
      clippingParentKey: item.kind === "raster" && item.rasterClippingParentId !== null
        ? `raster:${item.rasterClippingParentId}`
        : null,
    }));
  }

  private currentMergePlan(
    stats: EngineStats,
  ): MobileLayerMergeSelectionPlan<LayerPanelKey> {
    return buildMobileLayerMergeSelectionPlan(
      this.mergeSelectionItems(stats),
      this.selectedKeys,
    );
  }

  private mergeUnavailableReason(
    plan: MobileLayerMergeSelectionPlan<LayerPanelKey>,
    stats: EngineStats,
  ): string | null {
    if (!plan.valid) return plan.reason;
    return this.options.mergeCapabilityError(plan.orderedKeys, stats);
  }

  private setMergeStatus(message: string | null, failed = false): void {
    const status = this.options.elements.mergeStatus;
    status.textContent = message ?? "";
    status.hidden = message === null;
    status.classList.toggle("is-error", failed && message !== null);
  }

  private reconcileMultiSelection(stats: EngineStats): void {
    if (!this.multiSelectEnabled) return;
    const liveKeys = new Set(this.mergeSelectionItems(stats).map((item) => item.key));
    for (const key of this.selectedKeys) {
      if (!liveKeys.has(key)) this.selectedKeys.delete(key);
    }
    if (this.selectedKeys.size > 0) return;
    const primaryKey = this.primaryKey(stats);
    if (primaryKey) this.selectedKeys.add(primaryKey);
  }

  private setMultiSelect(enabled: boolean, announce = true): void {
    if (enabled === this.multiSelectEnabled) return;
    this.closeContextMenu(false);
    this.cancelReorder(false, false, false);
    this.multiSelectEnabled = enabled;
    this.selectedKeys.clear();
    const stats = this.options.getStats();
    if (enabled && stats) {
      const primaryKey = this.primaryKey(stats);
      if (primaryKey) this.selectedKeys.add(primaryKey);
    }
    const { panel, multiActions, mergeSelectionButton, multiSelectButton } =
      this.options.elements;
    panel.classList.toggle("is-multi-select", enabled);
    multiActions.hidden = !enabled;
    if (!enabled) mergeSelectionButton.disabled = true;
    multiSelectButton.setAttribute("aria-pressed", String(enabled));
    multiSelectButton.setAttribute(
      "aria-label",
      enabled ? "Stop selecting multiple layers" : "Select multiple layers",
    );
    multiSelectButton.title = enabled ? "Done selecting layers" : "Select multiple layers";
    this.renderSignature = "";
    this.setMergeStatus(null);
    this.scheduleRefresh();
    if (announce) {
      this.announce(enabled
        ? "Multiple selection on. Select adjacent layers to merge."
        : "Multiple selection off.");
    }
  }

  private toggleMultiSelection(key: LayerPanelKey): void {
    if (!this.multiSelectEnabled) return;
    if (this.selectedKeys.has(key)) {
      if (this.selectedKeys.size === 1) {
        this.announce("Keep at least one layer selected.");
        return;
      }
      this.selectedKeys.delete(key);
    } else {
      this.selectedKeys.add(key);
    }
    const count = this.selectedKeys.size;
    this.setMergeStatus(null);
    this.announce(`${count} ${count === 1 ? "layer" : "layers"} selected.`);
    this.renderSignature = "";
    this.scheduleRefresh();
  }

  private focusFirstContextAction(): void {
    const { mergeButton, contextMenu, clippingButton, optionsButton } = this.options.elements;
    if (this.multiSelectEnabled) {
      (mergeButton.disabled ? contextMenu : mergeButton).focus({ preventScroll: true });
      return;
    }
    (clippingButton.hidden || clippingButton.disabled ? optionsButton : clippingButton)
      .focus({ preventScroll: true });
  }

  private closeContextMenu(restoreFocus = false): void {
    const { contextMenu, list } = this.options.elements;
    const key = this.contextKey;
    const activeElement = this.options.document.activeElement;
    if (
      activeElement instanceof this.options.browser.HTMLElement
      && contextMenu.contains(activeElement)
    ) {
      if (restoreFocus && key) {
        list.querySelector<HTMLButtonElement>(
          `[data-layer-key="${this.options.browser.CSS.escape(key)}"] .mobile-layer-select`,
        )?.focus({ preventScroll: true });
      } else {
        activeElement.blur();
      }
    }
    this.contextKey = null;
    this.contextOrderSignature = null;
    contextMenu.hidden = true;
    contextMenu.setAttribute("inert", "");
    delete contextMenu.dataset.layerKey;
  }

  private openContextMenu(key: LayerPanelKey, row: HTMLElement): boolean {
    const properties = this.selectedLayerProperties(key);
    const stats = this.options.getStats();
    if (!properties || properties.locked || !row.matches(".is-selected, .is-multi-selected")) {
      return false;
    }
    if (!stats) return false;
    const {
      panel,
      contextMenu,
      clippingButton,
      optionsButton,
      rasterizeButton,
      deleteButton,
      mergeButton,
      mergeReason,
    } = this.options.elements;
    this.contextKey = key;
    this.contextOrderSignature = this.orderSignature(stats);
    contextMenu.dataset.layerKey = key;
    clippingButton.hidden = this.multiSelectEnabled || properties.kind !== "raster";
    clippingButton.disabled = properties.kind !== "raster" || !properties.clippingAvailable;
    clippingButton.setAttribute("aria-checked", String(properties.clippingEnabled));
    clippingButton.textContent = properties.clippingEnabled
      ? "Disable Clipping Mask"
      : "Clipping Mask";
    optionsButton.hidden = this.multiSelectEnabled;
    optionsButton.disabled = this.multiSelectEnabled;
    const rasterizeAvailable = properties.kind === "raster" || properties.kind === "svg";
    rasterizeButton.hidden = this.multiSelectEnabled || !rasterizeAvailable;
    rasterizeButton.disabled = this.multiSelectEnabled || !rasterizeAvailable;
    deleteButton.hidden = this.multiSelectEnabled;
    mergeButton.hidden = !this.multiSelectEnabled;
    mergeReason.hidden = true;
    mergeReason.textContent = "";
    if (this.multiSelectEnabled) {
      const stats = this.options.getStats();
      const plan = stats ? this.currentMergePlan(stats) : null;
      const unavailableReason = stats && plan
        ? this.mergeUnavailableReason(plan, stats)
        : "Unione non disponibile: il controller dei livelli non è ancora pronto.";
      mergeButton.disabled = unavailableReason !== null;
      mergeButton.title = unavailableReason ?? "Unisci i livelli selezionati";
      if (unavailableReason) {
        mergeReason.textContent = unavailableReason;
        mergeReason.hidden = false;
      }
    } else {
      mergeButton.disabled = true;
      mergeButton.title = "";
    }
    contextMenu.hidden = false;
    contextMenu.removeAttribute("inert");
    const panelRect = panel.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const menuHeight = contextMenu.offsetHeight;
    const preferredBelow = rowRect.bottom - panelRect.top + 4;
    const preferredAbove = rowRect.top - panelRect.top - menuHeight - 4;
    const maximumTop = Math.max(8, panelRect.height - menuHeight - 8);
    const top = preferredBelow + menuHeight <= panelRect.height - 8
      ? preferredBelow
      : preferredAbove;
    contextMenu.style.setProperty(
      "--mobile-layer-context-top",
      `${Math.round(Math.min(maximumTop, Math.max(8, top)))}px`,
    );
    return true;
  }

  private handleContextMenu(event: MouseEvent): void {
    const target = event.target instanceof this.options.browser.Element ? event.target : null;
    const select = target?.closest<HTMLButtonElement>(
      ".mobile-layer-row.is-selected .mobile-layer-select, "
        + ".mobile-layer-row.is-multi-selected .mobile-layer-select",
    );
    const row = select?.closest<HTMLElement>(
      ".mobile-layer-row.is-selected, .mobile-layer-row.is-multi-selected",
    );
    const key = row?.dataset.layerKey;
    if (!select || !row || !key || !isLayerPanelKey(key)) return;
    event.preventDefault();
    this.cancelReorder(false, false, false);
    this.openContextMenu(key, row);
    this.focusFirstContextAction();
  }

  private requestClippingToggle(): void {
    const properties = this.selectedLayerProperties(this.contextKey);
    if (
      !properties
      || properties.kind !== "raster"
      || properties.rasterIndex === null
      || properties.locked
      || !properties.clippingAvailable
    ) return;
    this.closeContextMenu(false);
    this.options.setRasterClipping(properties.key, !properties.clippingEnabled);
  }

  private requestLayerOptions(): void {
    const properties = this.selectedLayerProperties(this.contextKey);
    if (!properties || properties.locked) return;
    this.closeContextMenu(false);
    this.options.openLayerOptions(this.options.elements.trigger);
  }

  private async requestRasterize(): Promise<void> {
    const properties = this.selectedLayerProperties(this.contextKey);
    if (
      !properties
      || (properties.kind !== "raster" && properties.kind !== "svg")
      || properties.locked
      || this.options.isInteractionLocked()
    ) return;
    const key = properties.key;
    this.closeContextMenu(false);
    const operation = this.options.rasterizeLayer(key);
    this.renderSignature = "";
    this.requestRefresh();
    try {
      const result = await operation;
      if (this.disposed) return;
      const message = result.changed
        ? `${result.name} rasterized.`
        : `${result.name} is already rasterized with no effects to bake.`;
      this.options.onLayerResult(message);
      this.announce(message);
    } catch (error) {
      if (this.disposed) return;
      const message = error instanceof Error
        ? error.message
        : "Layer rasterization failed.";
      this.options.recordDiagnostic(
        "mixed-scene-layer-rasterize-failed",
        JSON.stringify({ key }),
        error,
      );
      this.options.onStatus(message, true);
      this.announce(message);
    } finally {
      if (this.disposed) return;
      this.renderSignature = "";
      this.requestRefresh();
      const latest = this.options.getStats();
      if (latest) this.render(latest);
      this.options.thumbnails.ensureActive(0);
    }
  }

  private async requestMerge(): Promise<void> {
    const stats = this.options.getStats();
    if (!this.multiSelectEnabled || !stats || this.options.isInteractionLocked()) return;
    const plan = this.currentMergePlan(stats);
    const unavailableReason = this.mergeUnavailableReason(plan, stats);
    if (unavailableReason || !plan.valid) {
      const message = unavailableReason ?? "Unione non disponibile.";
      const { mergeButton, mergeReason } = this.options.elements;
      mergeButton.disabled = true;
      mergeButton.title = message;
      mergeReason.textContent = message;
      mergeReason.hidden = false;
      this.announce(message);
      return;
    }
    this.closeContextMenu(false);
    this.setMergeStatus(null);
    const operation = this.options.mergeLayers(plan.orderedKeys);
    this.renderSignature = "";
    this.requestRefresh();
    try {
      const result = await operation;
      if (this.disposed) return;
      this.setMultiSelect(false, false);
      const message = `${result.itemCount} livelli uniti.`;
      this.options.onLayerResult(message);
      this.setMergeStatus(message);
      this.announce(`${result.itemCount} layers merged.`);
    } catch (error) {
      if (this.disposed) return;
      const message = error instanceof Error ? error.message : "Unione dei livelli non riuscita.";
      this.options.recordDiagnostic(
        "mixed-scene-merge-failed",
        JSON.stringify({ selectedKeys: plan.orderedKeys }),
        error,
      );
      this.options.onLayerResult(message);
      this.setMergeStatus(message, true);
      this.announce(message);
    } finally {
      if (this.disposed) return;
      this.renderSignature = "";
      this.requestRefresh();
      const latest = this.options.getStats();
      if (latest) this.render(latest);
      this.options.thumbnails.ensureActive(0);
    }
  }

  private async requestDelete(): Promise<void> {
    const properties = this.selectedLayerProperties(this.contextKey);
    if (!properties) return;
    if (properties.locked) {
      this.closeContextMenu(false);
      this.options.onStatus("Livello bloccato: sbloccalo prima di eliminarlo.", false);
      return;
    }
    const key = properties.key;
    this.closeContextMenu(false);
    try {
      await this.options.deleteLayer(key);
    } catch (error) {
      if (this.disposed) return;
      this.options.recordDiagnostic(
        "mixed-scene-layer-delete-failed",
        JSON.stringify({ key, kind: properties.kind }),
        error,
      );
      const message = error instanceof Error ? error.message : String(error);
      this.options.onStatus(message, true);
    }
  }

  private async duplicateSelected(): Promise<void> {
    if (this.multiSelectEnabled || this.options.isInteractionLocked()) return;
    const beforeStats = this.options.getStats();
    if (!beforeStats) return;
    const sourceView = this.views(beforeStats).find((view) => view.selected);
    if (!sourceView) {
      const message = "Nessun livello selezionato da duplicare.";
      this.options.onLayerResult(message);
      this.announce(message);
      return;
    }
    const sourceThumbnailLayerId = sourceView.rasterLayerId;
    const restoreToolbarFocus = this.options.document.activeElement
      === this.options.elements.copyButton;
    this.setMergeStatus(null);
    const operation = this.options.duplicateSelectedLayer();
    this.renderSignature = "";
    this.requestRefresh();
    this.render(beforeStats);
    let duplicatedRaster = false;
    try {
      const result = await operation;
      if (this.disposed) return;
      duplicatedRaster = result.kind === "raster";
      if (result.kind === "raster" && sourceThumbnailLayerId !== null) {
        const afterStats = this.options.getStats();
        const sourceLayer = result.sourceRasterLayerId === null
          ? undefined
          : afterStats?.layers.find((layer) => layer.id === result.sourceRasterLayerId);
        const duplicateLayer = result.duplicateRasterLayerId === null
          ? undefined
          : afterStats?.layers.find((layer) => layer.id === result.duplicateRasterLayerId);
        const selectedKey = afterStats?.mixedScene?.selectedKey
          ?? (afterStats?.layers[afterStats.activeLayerIndex]
            ? `raster:${afterStats.layers[afterStats.activeLayerIndex].id}`
            : null);
        if (
          sourceView.key === result.sourceKey
          && sourceView.rasterLayerId === result.sourceRasterLayerId
          && sourceLayer
          && duplicateLayer
          && sourceLayer.hasContent === duplicateLayer.hasContent
          && selectedKey === result.duplicateKey
          && result.duplicateRasterLayerId !== null
        ) {
          this.options.thumbnails.copyRasterEntry(
            sourceThumbnailLayerId,
            result.duplicateRasterLayerId,
          );
        }
      }
      const message = `${layerPanelDisplayName(result.name)} duplicato in `
        + `${result.totalMs.toFixed(0)} ms.`;
      this.options.onLayerResult(message);
      this.setMergeStatus(message);
      this.announce(message);
    } catch (error) {
      if (this.disposed) return;
      const message = error instanceof Error
        ? error.message
        : "Duplicazione del livello non riuscita.";
      this.options.recordDiagnostic(
        "mixed-scene-duplicate-failed",
        JSON.stringify({ sourceKey: sourceView.key, kind: sourceView.kind }),
        error,
      );
      this.options.onLayerResult(message);
      this.setMergeStatus(message, true);
      this.announce(message);
    } finally {
      if (this.disposed) return;
      this.renderSignature = "";
      this.requestRefresh();
      const finalStats = this.options.getStats();
      if (finalStats) this.render(finalStats);
      if (duplicatedRaster) this.options.thumbnails.ensureActive(0);
      if (restoreToolbarFocus) {
        this.options.browser.requestAnimationFrame(() => {
          if (!this.openState || this.disposed) return;
          const { copyButton, list } = this.options.elements;
          const target = !copyButton.disabled
            ? copyButton
            : list.querySelector<HTMLButtonElement>(
              ".mobile-layer-row.is-active-layer .mobile-layer-select",
            );
          target?.focus({ preventScroll: true });
        });
      }
    }
  }

  private handleListClick(event: MouseEvent): void {
    if (!(event.target instanceof this.options.browser.Element)) return;
    const actionButton = event.target.closest<HTMLButtonElement>("[data-mobile-layer-action]");
    const row = actionButton?.closest<HTMLElement>("[data-layer-key]");
    const action = actionButton?.dataset.mobileLayerAction;
    const key = row?.dataset.layerKey;
    if (!actionButton || actionButton.disabled || !action || !key) {
      return;
    }
    if (key === DOCUMENT_BACKGROUND_ROW_KEY) {
      if (
        action !== "visibility"
        || this.multiSelectEnabled
        || this.options.isInteractionLocked()
      ) return;
      const stats = this.options.getStats();
      if (!stats) return;
      this.options.setDocumentBackgroundVisibility(!stats.documentBackground.visible);
      return;
    }
    if (!isLayerPanelKey(key)) return;
    if (
      action === "select"
      && key === this.suppressClickKey
      && this.options.browser.performance.now() <= this.suppressClickUntil
    ) {
      event.preventDefault();
      this.suppressClickKey = null;
      this.suppressClickUntil = 0;
      return;
    }
    if (this.options.isInteractionLocked()) return;
    if (action === "select" && this.multiSelectEnabled) {
      this.toggleMultiSelection(key);
      return;
    }
    const stats = this.options.getStats();
    if (!stats) return;
    const scene = stats.mixedScene;
    if (!scene) {
      const index = stats.layers.findIndex((layer) => `raster:${layer.id}` === key);
      const layer = stats.layers[index];
      if (index < 0 || !layer) return;
      if (action === "select") this.options.selectLayer(key);
      else if (action === "visibility") this.options.setLayerVisibility(key, !layer.visible);
      else if (action === "reference") {
        this.options.setRasterReference(key, !layer.reference);
      }
      return;
    }
    const item = scene.items.find((candidate) => candidate.key === key);
    if (!item) return;
    if (action === "select") {
      this.options.selectLayer(key);
      return;
    }
    if (item.kind === "raster") {
      const layer = stats.layers[item.rasterLayerIndex];
      if (!layer) return;
      if (action === "visibility") this.options.setLayerVisibility(key, !layer.visible);
      else if (action === "reference") {
        this.options.setRasterReference(key, !layer.reference);
      }
      return;
    }
    if (action !== "visibility") return;
    const visible = item.kind === "text"
      ? item.textNode.visible
      : item.kind === "svg"
        ? item.svgNode.visible
        : item.imageNode.visible;
    this.options.setLayerVisibility(key, !visible);
  }

  private handleBackgroundColorInput(event: Event): void {
    const input = event.target instanceof this.options.browser.HTMLElement
      && event.target.matches('.mobile-layer-background-color input[type="color"]')
      ? event.target as HTMLInputElement
      : null;
    if (
      !input
      || input.disabled
      || this.multiSelectEnabled
      || this.options.isInteractionLocked()
    ) return;
    this.options.setDocumentBackgroundColor(input.value);
  }

  private backgroundView(stats: EngineStats): BackgroundLayerPanelView {
    return {
      key: DOCUMENT_BACKGROUND_ROW_KEY,
      kind: "background",
      name: "Sfondo",
      visible: stats.documentBackground.visible,
      selected: false,
      rasterIndex: null,
      rasterLayerId: null,
      reference: false,
      referenceAvailable: false,
      hasContent: true,
      contentBounds: null,
      thumbnailGlyph: "",
      thumbnailColor: stats.documentBackground.color,
      semanticThumbnail: null,
      semanticThumbnailSignature: "",
    };
  }

  private views(stats: EngineStats): LayerPanelView[] {
    const scene = stats.mixedScene;
    const views: LayerPanelView[] = [];
    if (!scene) {
      for (let index = stats.layers.length - 1; index >= 0; index -= 1) {
        const layer = stats.layers[index];
        views.push({
          key: `raster:${layer.id}`,
          kind: "raster",
          name: layerPanelDisplayName(layer.name),
          visible: layer.visible,
          selected: index === stats.activeLayerIndex,
          rasterIndex: index,
          rasterLayerId: layer.id,
          reference: layer.reference,
          referenceAvailable: index === stats.activeLayerIndex,
          hasContent: layer.hasContent,
          contentBounds: null,
          thumbnailGlyph: "",
          thumbnailColor: null,
          semanticThumbnail: null,
          semanticThumbnailSignature: "",
        });
      }
      views.push(this.backgroundView(stats));
      return views;
    }

    for (let sceneIndex = scene.items.length - 1; sceneIndex >= 0; sceneIndex -= 1) {
      const item = scene.items[sceneIndex];
      const selected = item.key === scene.selectedKey;
      if (item.kind === "raster") {
        const layer = stats.layers[item.rasterLayerIndex];
        if (!layer) continue;
        views.push({
          key: item.key,
          kind: "raster",
          name: layerPanelDisplayName(layer.name),
          visible: layer.visible,
          selected,
          rasterIndex: item.rasterLayerIndex,
          rasterLayerId: item.rasterLayerId,
          reference: layer.reference,
          referenceAvailable: selected && item.rasterLayerId === scene.activeRasterLayerId,
          hasContent: item.rasterHasContent,
          contentBounds: item.rasterContentBounds,
          thumbnailGlyph: "",
          thumbnailColor: null,
          semanticThumbnail: null,
          semanticThumbnailSignature: "",
        });
        continue;
      }
      if (item.kind === "text") {
        const node = item.textNode;
        const firstCharacter = Array.from(node.text.trim())[0] ?? "T";
        const semanticThumbnail = {
          kind: "text",
          node,
        } as const satisfies MobileSemanticLayerThumbnailSource;
        views.push({
          key: item.key,
          kind: "text",
          name: layerPanelDisplayName(node.name),
          visible: node.visible,
          selected,
          rasterIndex: null,
          rasterLayerId: null,
          reference: false,
          referenceAvailable: false,
          hasContent: node.text.trim().length > 0,
          contentBounds: null,
          thumbnailGlyph: firstCharacter.toLocaleUpperCase("en-US"),
          thumbnailColor: node.color,
          semanticThumbnail,
          semanticThumbnailSignature: mobileSemanticLayerThumbnailSignature(semanticThumbnail),
        });
        continue;
      }
      if (item.kind === "svg") {
        const node = item.svgNode;
        const semanticThumbnail = {
          kind: "svg",
          node,
        } as const satisfies MobileSemanticLayerThumbnailSource;
        views.push({
          key: item.key,
          kind: "svg",
          name: layerPanelDisplayName(node.name),
          visible: node.visible,
          selected,
          rasterIndex: null,
          rasterLayerId: null,
          reference: false,
          referenceAvailable: false,
          hasContent: true,
          contentBounds: null,
          thumbnailGlyph: "S",
          thumbnailColor: node.paintColors[0] ?? node.outlineColor,
          semanticThumbnail,
          semanticThumbnailSignature: mobileSemanticLayerThumbnailSignature(semanticThumbnail),
        });
        continue;
      }
      const node = item.imageNode;
      views.push({
        key: item.key,
        kind: "image",
        name: layerPanelDisplayName(node.name),
        visible: node.visible,
        selected,
        rasterIndex: null,
        rasterLayerId: null,
        reference: false,
        referenceAvailable: false,
        hasContent: true,
        contentBounds: null,
        thumbnailGlyph: "I",
        thumbnailColor: null,
        semanticThumbnail: null,
        semanticThumbnailSignature: "",
      });
    }
    views.push(this.backgroundView(stats));
    return views;
  }

  private listSignature(views: readonly LayerPanelView[], locked: boolean): string {
    const selectionSignature = this.multiSelectEnabled
      ? [...this.selectedKeys].sort().join(",")
      : "";
    return `${locked ? 1 : 0}|${this.multiSelectEnabled ? 1 : 0}|${selectionSignature}|`
      + views.map((view) => {
        const bounds = view.contentBounds;
        return [
          view.key,
          view.kind,
          view.name,
          view.visible ? 1 : 0,
          view.selected ? 1 : 0,
          view.reference ? 1 : 0,
          view.referenceAvailable ? 1 : 0,
          view.hasContent ? 1 : 0,
          this.options.thumbnails.rasterRevision(view.rasterLayerId),
          bounds?.x ?? "",
          bounds?.y ?? "",
          bounds?.width ?? "",
          bounds?.height ?? "",
          view.thumbnailGlyph,
          view.thumbnailColor ?? "",
          view.semanticThumbnailSignature,
          view.kind === "background"
            ? 0
            : this.options.thumbnails.semanticFontRevision(view.kind),
        ].join(":");
      }).join("|");
  }

  private syncToolbar(stats: EngineStats, locked: boolean): void {
    const scene = stats.mixedScene;
    const selectedSceneItem = scene?.items.find((item) => item.key === scene.selectedKey);
    const fallbackRaster = scene === null ? stats.layers[stats.activeLayerIndex] : undefined;
    const selectedKind = selectedSceneItem?.kind ?? (fallbackRaster ? "raster" : undefined);
    const selectedRasterReferenceAvailable = selectedSceneItem?.kind === "raster"
      ? selectedSceneItem.rasterLayerId === scene?.activeRasterLayerId
      : fallbackRaster !== undefined;
    const { addButton, copyButton, addMaskButton, multiSelectButton } =
      this.options.elements;
    addButton.disabled = this.multiSelectEnabled
      || locked
      || stats.layers.length >= LAYER_STACK_MAXIMUM;
    const selectedKindCount = selectedKind === "raster"
      ? stats.layers.length
      : selectedKind && scene
        ? scene.items.reduce(
          (count, item) => count + (item.kind === selectedKind ? 1 : 0),
          0,
        )
        : Number.POSITIVE_INFINITY;
    const selectedKindMaximum = selectedKind === "raster"
      ? LAYER_STACK_MAXIMUM
      : selectedKind === "text"
        ? VECTOR_TEXT_NODE_MAXIMUM
        : selectedKind === "svg"
          ? VECTOR_SVG_NODE_MAXIMUM
          : RASTER_IMAGE_NODE_MAXIMUM;
    copyButton.disabled = this.multiSelectEnabled
      || locked
      || selectedKind === undefined
      || selectedKindCount >= selectedKindMaximum;
    addMaskButton.disabled = this.multiSelectEnabled
      || locked
      || stats.layers.length >= LAYER_STACK_MAXIMUM
      || selectedKind !== "raster"
      || !selectedRasterReferenceAvailable;
    const layerCount = scene?.items.length ?? stats.layers.length;
    multiSelectButton.disabled = locked
      || (!this.multiSelectEnabled && layerCount < 2);
  }

  private createIconStack(icon: IconNode): HTMLSpanElement {
    const stack = this.options.document.createElement("span");
    stack.className = "mobile-icon-stack";
    stack.setAttribute("aria-hidden", "true");
    stack.append(
      createLucideElement(icon, {
        class: "mobile-icon-layer mobile-icon-outline",
        width: 20,
        height: 20,
      }),
      createLucideElement(icon, {
        class: "mobile-icon-layer mobile-icon-face",
        width: 20,
        height: 20,
      }),
    );
    return stack;
  }

  private createRow(key: LayerPanelRowKey): HTMLDivElement {
    const row = this.options.document.createElement("div");
    row.className = "mobile-layer-row";
    row.setAttribute("role", "listitem");
    row.dataset.layerKey = key;
    const select = this.options.document.createElement("button");
    select.type = "button";
    select.className = "mobile-layer-select";
    select.dataset.mobileLayerAction = "select";
    const thumbnail = this.options.document.createElement("span");
    thumbnail.className = "mobile-layer-thumbnail";
    thumbnail.setAttribute("aria-hidden", "true");
    thumbnail.style.setProperty(
      "--mobile-layer-thumbnail-width",
      `${52 * LAYER_THUMBNAIL_WIDTH / LAYER_THUMBNAIL_SIZE}px`,
    );
    thumbnail.style.setProperty(
      "--mobile-layer-thumbnail-height",
      `${52 * LAYER_THUMBNAIL_HEIGHT / LAYER_THUMBNAIL_SIZE}px`,
    );
    const thumbnailCanvas = this.options.document.createElement("canvas");
    thumbnailCanvas.className = "mobile-layer-thumbnail-canvas";
    thumbnailCanvas.width = LAYER_THUMBNAIL_WIDTH;
    thumbnailCanvas.height = LAYER_THUMBNAIL_HEIGHT;
    thumbnailCanvas.hidden = true;
    const thumbnailContent = this.options.document.createElement("span");
    thumbnailContent.className = "mobile-layer-thumbnail-content";
    thumbnailContent.hidden = true;
    const thumbnailGlyph = this.options.document.createElement("span");
    thumbnailGlyph.className = "mobile-layer-thumbnail-glyph";
    thumbnail.append(thumbnailCanvas, thumbnailContent, thumbnailGlyph);
    const name = this.options.document.createElement("span");
    name.className = "mobile-layer-name";
    select.append(thumbnail, name);
    const reference = this.options.document.createElement("button");
    reference.type = "button";
    reference.className = "mobile-layer-reference";
    reference.dataset.mobileLayerAction = "reference";
    reference.textContent = "R";
    const backgroundColorControl = this.options.document.createElement("label");
    backgroundColorControl.className = "mobile-layer-background-color";
    backgroundColorControl.hidden = true;
    backgroundColorControl.title = "Scegli il colore dello sfondo";
    const backgroundColorSwatch = this.options.document.createElement("span");
    backgroundColorSwatch.setAttribute("aria-hidden", "true");
    const backgroundColorInput = this.options.document.createElement("input");
    backgroundColorInput.type = "color";
    backgroundColorInput.value = "#ffffff";
    backgroundColorInput.setAttribute("aria-label", "Scegli il colore dello sfondo");
    backgroundColorControl.append(backgroundColorSwatch, backgroundColorInput);
    const visibility = this.options.document.createElement("button");
    visibility.type = "button";
    visibility.className = "mobile-layer-visibility";
    visibility.dataset.mobileLayerAction = "visibility";
    row.append(select, reference, backgroundColorControl, visibility);
    return row;
  }

  private rows(): HTMLElement[] {
    return Array.from(
      this.options.elements.list.querySelectorAll<HTMLElement>(":scope > [data-layer-key]"),
    );
  }

  private reorderPlan(key: LayerPanelKey): MobileLayerReorderPlan | null {
    try {
      const targets = this.options.getReorderTargets(key);
      const orderedKeys = this.rows()
        .map((row) => row.dataset.layerKey)
        .filter((candidate): candidate is LayerPanelKey =>
          candidate !== undefined && isLayerPanelKey(candidate));
      const stats = this.options.getStats();
      if (!stats) return null;
      const snapshotTopFirstKeys = stats.mixedScene
        ? [...stats.mixedScene.items].reverse().map((item) => item.key)
        : [...stats.layers].reverse().map((layer) => `raster:${layer.id}` as LayerPanelKey);
      if (
        orderedKeys.length !== snapshotTopFirstKeys.length
        || orderedKeys.some((candidate, index) => candidate !== snapshotTopFirstKeys[index])
      ) {
        this.requestRefresh();
        return null;
      }
      const moving = new Set(targets.movingKeys);
      const firstMovingIndex = orderedKeys.findIndex((candidate) => moving.has(candidate));
      const originalSlot = firstMovingIndex < 0
        ? 0
        : orderedKeys.slice(0, firstMovingIndex).filter((candidate) => !moving.has(candidate)).length;
      return {
        selectedKey: key,
        draggedKeys: [...targets.movingKeys],
        remainingKeys: [...targets.topFirstKeysWithoutMoving],
        validSlots: [...targets.validTargetTopFirstSlots],
        originalSlot,
      };
    } catch (error) {
      this.options.onStatus("Riordino livello non disponibile.", true);
      console.warn("Riordino livello mobile non disponibile.", error);
      return null;
    }
  }

  private clearReorderIndicators(): void {
    for (const row of this.rows()) {
      row.classList.remove(
        "is-reordering",
        "is-reorder-companion",
        "is-drop-before",
        "is-drop-after",
      );
      row.style.removeProperty("--mobile-layer-reorder-y");
    }
    this.options.elements.list.classList.remove("is-reordering");
  }

  private setReorderDropIndicator(plan: MobileLayerReorderPlan, slot: number): void {
    const rowByKey = new Map(
      this.rows().map((row) => [row.dataset.layerKey ?? "", row] as const),
    );
    for (const row of rowByKey.values()) {
      row.classList.remove("is-drop-before", "is-drop-after");
    }
    if (plan.remainingKeys.length === 0) return;
    if (slot === plan.remainingKeys.length) {
      rowByKey.get(plan.remainingKeys[plan.remainingKeys.length - 1])
        ?.classList.add("is-drop-after");
      return;
    }
    rowByKey.get(plan.remainingKeys[slot])?.classList.add("is-drop-before");
  }

  private reorderSlotAnnouncement(plan: MobileLayerReorderPlan, slot: number): string {
    if (slot === 0) return "Move to top.";
    if (slot === plan.remainingKeys.length) return "Move to bottom.";
    const key = plan.remainingKeys[slot];
    const row = this.options.elements.list.querySelector<HTMLElement>(
      `[data-layer-key="${this.options.browser.CSS.escape(key)}"]`,
    );
    const name = row?.querySelector<HTMLElement>(".mobile-layer-name")?.textContent?.trim();
    return name ? `Move before ${name}.` : `Move to position ${slot + 1}.`;
  }

  private scheduleReorderFrame(): void {
    const gesture = this.reorderGesture;
    if (!gesture || gesture.phase !== "dragging" || gesture.frame !== null) return;
    gesture.frame = this.options.browser.requestAnimationFrame((time) => {
      this.runReorderFrame(time);
    });
  }

  private runReorderFrame(frameTime: number): void {
    const gesture = this.reorderGesture;
    if (!gesture || gesture.phase !== "dragging" || !gesture.plan) return;
    gesture.frame = null;
    const plan = gesture.plan;
    const elapsedSeconds = Math.min(
      0.05,
      Math.max(0, frameTime - gesture.lastFrameTime) / 1000,
    );
    gesture.lastFrameTime = frameTime;
    const list = this.options.elements.list;
    const listRect = list.getBoundingClientRect();
    const velocity = mobileLayerReorderAutoScrollVelocity(
      gesture.clientY,
      listRect.top,
      listRect.bottom,
    );
    let autoScrolled = false;
    if (velocity !== 0 && elapsedSeconds > 0) {
      const previousScrollTop = list.scrollTop;
      list.scrollTop += velocity * elapsedSeconds;
      autoScrolled = list.scrollTop !== previousScrollTop;
    }
    const offsetY = gesture.clientY - gesture.startClientY
      + (list.scrollTop - gesture.startScrollTop);
    gesture.row.style.setProperty("--mobile-layer-reorder-y", `${offsetY.toFixed(2)}px`);
    const rowGeometry: MobileLayerReorderRowGeometry[] = this.rows().map((row) => {
      const rect = row.getBoundingClientRect();
      return { key: row.dataset.layerKey ?? "", top: rect.top, bottom: rect.bottom };
    });
    const slot = mobileLayerReorderDropSlot(gesture.clientY, plan, rowGeometry);
    if (slot !== gesture.currentSlot) {
      gesture.currentSlot = slot;
      this.setReorderDropIndicator(plan, slot);
      this.announce(this.reorderSlotAnnouncement(plan, slot));
    }
    if (autoScrolled) this.scheduleReorderFrame();
  }

  private armContextGesture(): void {
    const gesture = this.reorderGesture;
    if (!gesture || gesture.phase !== "pending") return;
    gesture.holdTimer = null;
    const stats = this.options.getStats();
    if (
      !this.openState
      || this.options.isInteractionLocked()
      || !stats
      || gesture.sceneOrderSignature !== this.orderSignature(stats)
      || !gesture.row.matches(".is-selected, .is-multi-selected")
    ) {
      this.cancelReorder(false);
      return;
    }
    if (!this.openContextMenu(gesture.key, gesture.row)) {
      this.cancelReorder(false);
      return;
    }
    gesture.phase = "armed";
    this.announce(this.multiSelectEnabled
      ? `${gesture.name} selection actions open.`
      : `${gesture.name} options open. Keep dragging to move the layer.`);
  }

  private activateReorder(): void {
    const gesture = this.reorderGesture;
    if (!gesture || gesture.phase !== "armed") return;
    if (this.multiSelectEnabled) {
      this.announce("Layer options open for the current selection.");
      return;
    }
    this.closeContextMenu(false);
    const plan = this.reorderPlan(gesture.key);
    if (!plan || plan.validSlots.length <= 1) {
      this.cancelReorder(false);
      return;
    }
    gesture.phase = "dragging";
    gesture.plan = plan;
    gesture.currentSlot = plan.originalSlot;
    gesture.lastFrameTime = this.options.browser.performance.now();
    this.options.elements.list.classList.add("is-reordering");
    const moving = new Set(plan.draggedKeys);
    for (const row of this.rows()) {
      const rowKey = row.dataset.layerKey ?? "";
      if (rowKey === gesture.key) row.classList.add("is-reordering");
      else if (moving.has(rowKey)) row.classList.add("is-reorder-companion");
    }
    this.setReorderDropIndicator(plan, plan.originalSlot);
    this.announce(`Moving ${gesture.name}. Drag up or down, then release.`);
    this.scheduleReorderFrame();
  }

  private cancelReorder(
    announce = true,
    restoreScroll = true,
    restoreFocus = true,
  ): void {
    const gesture = this.reorderGesture;
    if (!gesture) return;
    this.reorderGesture = null;
    if (gesture.holdTimer !== null) this.options.browser.clearTimeout(gesture.holdTimer);
    if (gesture.frame !== null) this.options.browser.cancelAnimationFrame(gesture.frame);
    this.clearReorderIndicators();
    if (restoreScroll) this.options.elements.list.scrollTop = gesture.startScrollTop;
    if (gesture.select.hasPointerCapture(gesture.pointerId)) {
      gesture.select.releasePointerCapture(gesture.pointerId);
    }
    if (restoreFocus && gesture.restoreFocus && gesture.select.isConnected) {
      gesture.select.focus({ preventScroll: true });
    }
    if (announce && gesture.phase === "dragging") this.announce("Layer move canceled.");
    if (gesture.phase === "armed") this.closeContextMenu(false);
    if (this.openState) {
      this.scheduleRefresh();
      if (!this.options.isInteractionLocked()) this.options.thumbnails.resumeCapture();
    }
  }

  private async commitReorder(
    key: LayerPanelKey,
    name: string,
    targetTopFirstSlot: number,
    restoreScrollTop: number,
    expectedOrderSignature: string,
  ): Promise<void> {
    if (this.options.isInteractionLocked()) {
      this.announce("Layer move canceled.");
      return;
    }
    const currentStats = this.options.getStats();
    if (!currentStats || this.orderSignature(currentStats) !== expectedOrderSignature) {
      this.announce("Layer move canceled because the layer stack changed.");
      this.requestRefresh();
      return;
    }
    try {
      const changed = await this.options.moveLayer(key, targetTopFirstSlot);
      if (this.disposed) return;
      const message = changed ? `${name} moved.` : `${name} is already in that position.`;
      this.options.onLayerResult(message);
      this.announce(message);
    } catch (error) {
      if (this.disposed) return;
      const message = error instanceof Error ? error.message : "Layer move failed.";
      this.options.recordDiagnostic(
        "mixed-scene-reorder-failed",
        JSON.stringify({ key, targetTopFirstSlot }),
        error,
      );
      this.options.onLayerResult(message);
      this.announce(message);
    } finally {
      if (this.disposed) return;
      this.renderSignature = "";
      this.requestRefresh();
      const stats = this.options.getStats();
      if (this.openState && stats) {
        this.render(stats);
        const list = this.options.elements.list;
        list.scrollTop = Math.min(
          restoreScrollTop,
          Math.max(0, list.scrollHeight - list.clientHeight),
        );
        const row = list.querySelector<HTMLElement>(
          `[data-layer-key="${this.options.browser.CSS.escape(key)}"]`,
        );
        row?.querySelector<HTMLButtonElement>(".mobile-layer-select")
          ?.focus({ preventScroll: true });
        this.options.thumbnails.resumeCapture();
      }
    }
  }

  private handleReorderPointerDown(event: PointerEvent): void {
    if (this.reorderGesture && this.reorderGesture.pointerId !== event.pointerId) {
      this.cancelReorder();
      return;
    }
    if (
      this.reorderGesture
      || !event.isPrimary
      || (event.pointerType === "mouse" && event.button !== 0)
      || this.options.isInteractionLocked()
    ) return;
    const target = event.target instanceof this.options.browser.Element ? event.target : null;
    const select = target?.closest<HTMLButtonElement>(".mobile-layer-select");
    const row = select?.closest<HTMLElement>(
      ".mobile-layer-row.is-selected, .mobile-layer-row.is-multi-selected",
    );
    const key = row?.dataset.layerKey;
    if (!select || select.disabled || !row || !key || !isLayerPanelKey(key)) return;
    const stats = this.options.getStats();
    if (!stats) return;
    const name = row.querySelector<HTMLElement>(".mobile-layer-name")?.textContent?.trim()
      || "Layer";
    select.setPointerCapture(event.pointerId);
    const now = this.options.browser.performance.now();
    const gesture: LayerPanelReorderGesture = {
      pointerId: event.pointerId,
      key,
      name,
      row,
      select,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startTime: now,
      startScrollTop: this.options.elements.list.scrollTop,
      restoreFocus: this.options.document.activeElement === select,
      sceneOrderSignature: this.orderSignature(stats),
      holdTimer: null,
      phase: "pending",
      plan: null,
      currentSlot: 0,
      clientY: event.clientY,
      frame: null,
      lastFrameTime: now,
    };
    gesture.holdTimer = this.options.browser.setTimeout(
      () => this.armContextGesture(),
      MOBILE_LAYER_REORDER_HOLD_MS,
    );
    this.reorderGesture = gesture;
  }

  private handleReorderPointerMove(event: PointerEvent): void {
    const gesture = this.reorderGesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (gesture.phase === "pending") {
      if (mobileLayerReorderMovementExceeded(
        gesture.startClientX,
        gesture.startClientY,
        event.clientX,
        event.clientY,
      )) this.cancelReorder(false);
      return;
    }
    if (gesture.phase === "armed") {
      if (this.multiSelectEnabled) {
        event.preventDefault();
        return;
      }
      if (!mobileLayerReorderMovementExceeded(
        gesture.startClientX,
        gesture.startClientY,
        event.clientX,
        event.clientY,
      )) return;
      event.preventDefault();
      gesture.clientY = event.clientY;
      this.activateReorder();
      return;
    }
    event.preventDefault();
    gesture.clientY = event.clientY;
    this.scheduleReorderFrame();
  }

  private handleReorderPointerUp(event: PointerEvent): void {
    const gesture = this.reorderGesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (
      gesture.phase === "pending"
      && mobileLayerReorderHoldReached(
        gesture.startTime,
        this.options.browser.performance.now(),
      )
    ) {
      if (gesture.holdTimer !== null) this.options.browser.clearTimeout(gesture.holdTimer);
      gesture.holdTimer = null;
      this.armContextGesture();
    }
    if (gesture.phase === "armed") {
      event.preventDefault();
      this.suppressClickKey = gesture.key;
      this.suppressClickUntil = this.options.browser.performance.now() + 500;
      this.reorderGesture = null;
      if (gesture.holdTimer !== null) this.options.browser.clearTimeout(gesture.holdTimer);
      if (gesture.select.hasPointerCapture(gesture.pointerId)) {
        gesture.select.releasePointerCapture(gesture.pointerId);
      }
      this.options.thumbnails.resumeCapture();
      this.options.browser.requestAnimationFrame(() => {
        if (this.contextKey === gesture.key && !this.disposed) this.focusFirstContextAction();
      });
      return;
    }
    if (gesture.phase !== "dragging" || !gesture.plan) {
      this.cancelReorder(false);
      return;
    }
    event.preventDefault();
    gesture.clientY = event.clientY;
    if (gesture.frame !== null) {
      this.options.browser.cancelAnimationFrame(gesture.frame);
      gesture.frame = null;
    }
    this.runReorderFrame(this.options.browser.performance.now());
    const { key, name, currentSlot } = gesture;
    const finalScrollTop = this.options.elements.list.scrollTop;
    this.suppressClickKey = key;
    this.suppressClickUntil = this.options.browser.performance.now() + 500;
    this.reorderGesture = null;
    if (gesture.holdTimer !== null) this.options.browser.clearTimeout(gesture.holdTimer);
    if (gesture.frame !== null) this.options.browser.cancelAnimationFrame(gesture.frame);
    this.clearReorderIndicators();
    if (gesture.select.hasPointerCapture(gesture.pointerId)) {
      gesture.select.releasePointerCapture(gesture.pointerId);
    }
    void this.commitReorder(
      key,
      name,
      currentSlot,
      finalScrollTop,
      gesture.sceneOrderSignature,
    );
  }

  private handleReorderPointerEnd(event: PointerEvent): void {
    const gesture = this.reorderGesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    this.cancelReorder();
  }

  private keyboardTargetSlot(plan: MobileLayerReorderPlan, direction: -1 | 1): number | null {
    const candidates = plan.validSlots.filter((slot) =>
      direction < 0 ? slot < plan.originalSlot : slot > plan.originalSlot);
    if (candidates.length === 0) return null;
    return direction < 0 ? Math.max(...candidates) : Math.min(...candidates);
  }

  private handleReorderKeydown(event: KeyboardEvent): void {
    if (
      (this.multiSelectEnabled || this.reorderGesture !== null)
      && event.altKey
      && (event.key === "ArrowUp" || event.key === "ArrowDown")
    ) {
      event.preventDefault();
      return;
    }
    if (
      !event.altKey
      || event.ctrlKey
      || event.metaKey
      || (event.key !== "ArrowUp" && event.key !== "ArrowDown")
      || this.options.isInteractionLocked()
    ) return;
    const target = event.target instanceof this.options.browser.Element ? event.target : null;
    const select = target?.closest<HTMLButtonElement>(".mobile-layer-select");
    const row = select?.closest<HTMLElement>(
      ".mobile-layer-row.is-selected, .mobile-layer-row.is-multi-selected",
    );
    const key = row?.dataset.layerKey;
    if (!select || !row || !key || !isLayerPanelKey(key)) return;
    const plan = this.reorderPlan(key);
    if (!plan) return;
    const targetSlot = this.keyboardTargetSlot(
      plan,
      event.key === "ArrowUp" ? -1 : 1,
    );
    event.preventDefault();
    if (targetSlot === null) {
      this.announce(event.key === "ArrowUp"
        ? "Layer is already at the top."
        : "Layer is already at the bottom.");
      return;
    }
    const name = row.querySelector<HTMLElement>(".mobile-layer-name")?.textContent?.trim()
      || "Layer";
    const stats = this.options.getStats();
    if (!stats) return;
    void this.commitReorder(
      key,
      name,
      targetSlot,
      this.options.elements.list.scrollTop,
      this.orderSignature(stats),
    );
  }

  private announce(message: string): void {
    const status = this.options.elements.reorderStatus;
    status.textContent = "";
    if (this.announcementFrame !== null) {
      this.options.browser.cancelAnimationFrame(this.announcementFrame);
    }
    this.announcementFrame = this.options.browser.requestAnimationFrame(() => {
      this.announcementFrame = null;
      if (!this.disposed) status.textContent = message;
    });
  }
}
