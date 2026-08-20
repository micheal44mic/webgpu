import {
  shouldCloseMobileToolsSheetDrag,
  type MobileToolsSheetSnap,
} from "./mobile-tools-sheet-gesture";
import {
  isEditorCanvasTool,
  isEditorRasterEffectKind,
  isEditorToolSettingsKind,
  isEditorVectorCommand,
  type EditorCanvasTool,
  type EditorRasterEffectKind,
  type EditorToolSettingsKind,
  type EditorVectorCommand,
} from "./editor-tools-contract";

export type {
  EditorCanvasTool,
  EditorRasterEffectKind,
  EditorToolSettingsKind,
  EditorVectorCommand,
} from "./editor-tools-contract";

export interface EditorToolsElements {
  readonly trigger: HTMLButtonElement;
  readonly sheet: HTMLElement;
  readonly handle: HTMLButtonElement;
  readonly content: HTMLElement;
  readonly searchField: HTMLLabelElement;
  readonly searchInput: HTMLInputElement;
  readonly empty: HTMLParagraphElement;
  readonly categories: readonly HTMLElement[];
  readonly canvasButtons: readonly HTMLButtonElement[];
  readonly toolSettingsButtons: readonly HTMLButtonElement[];
  readonly vectorCommandButtons: readonly HTMLButtonElement[];
  readonly effectButtons: readonly HTMLButtonElement[];
}

export interface EditorToolsControllerOptions {
  readonly browser: EditorToolsBrowser;
  readonly elements: EditorToolsElements;
  readonly canOpen: () => boolean;
  readonly beforeOpen: () => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly syncMenuState: () => void;
  readonly selectCanvasTool: (tool: EditorCanvasTool) => boolean;
  readonly openToolSettings: (
    kind: EditorToolSettingsKind,
    trigger: HTMLButtonElement,
  ) => void;
  readonly runVectorCommand: (command: EditorVectorCommand) => void;
  readonly openRasterEffect: (
    kind: EditorRasterEffectKind,
    trigger: HTMLButtonElement,
  ) => void;
}

export interface EditorToolsMenuState {
  readonly activeCanvasTool: EditorCanvasTool | "liquify";
  readonly engineReady: boolean;
  readonly interactionLocked: boolean;
  readonly vectorEditorReady: boolean;
  readonly vectorEditorLocked: boolean;
  readonly textSelected: boolean;
  readonly svgSelected: boolean;
  readonly textTransformActive: boolean;
  readonly vectorOutlineEnabled: boolean;
  readonly vectorDropShadowEnabled: boolean;
  readonly vectorInnerShadowEnabled: boolean;
  readonly vectorBlockShadowEnabled: boolean;
  readonly rasterColorOverlayTargetSelected: boolean;
  readonly rasterDeformTargetSelected: boolean;
  readonly rasterEffectsEnabled: Readonly<Record<EditorRasterEffectKind, boolean>>;
}

export interface EditorToolsBrowser extends Window {
  readonly AbortController: typeof AbortController;
}

function normalizedSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("it-IT")
    .trim();
}

/**
 * Owns the Tools sheet as a UI surface: open/close, search, detents, gestures
 * and routing of typed commands. Engine and feature policy stay behind the
 * callbacks supplied by the composition root.
 */
export class EditorToolsController {
  private readonly abortController: AbortController;
  private openState = false;
  private snapState: MobileToolsSheetSnap = "peek";
  private offsetPx = 0;
  private dragPointerId: number | null = null;
  private dragStartY = 0;
  private dragStartOffsetPx = 0;
  private dragStartSnap: MobileToolsSheetSnap = "peek";
  private dragLastY = 0;
  private dragLastTime = 0;
  private dragVelocityY = 0;
  private dragMoved = false;
  private searchFocusFrame: number | null = null;
  private disposed = false;

  constructor(private readonly options: EditorToolsControllerOptions) {
    this.abortController = new options.browser.AbortController();
    this.bindControls();
    this.options.elements.sheet.setAttribute("aria-hidden", "true");
    this.options.elements.sheet.setAttribute("inert", "");
  }

  get isOpen(): boolean {
    return this.openState;
  }

  get isDragging(): boolean {
    return this.dragPointerId !== null;
  }

  toggle(): void {
    this.setOpen(!this.openState);
  }

  setOpen(open: boolean): void {
    if ((this.disposed && open) || open === this.openState) return;
    if (open && !this.options.canOpen()) return;
    if (open) this.options.beforeOpen();

    const { trigger, sheet, searchInput } = this.options.elements;
    this.openState = open;
    trigger.setAttribute("aria-expanded", String(open));
    trigger.setAttribute("aria-label", open ? "Close tools menu" : "Open tools menu");
    if (open) sheet.removeAttribute("inert");
    sheet.setAttribute("aria-hidden", String(!open));
    if (open) {
      this.options.syncMenuState();
      this.filterTools();
      this.snap("peek");
      void sheet.offsetHeight;
      sheet.classList.add("is-open");
      this.options.onOpenChange(true);
      return;
    }

    this.cancelSearchFocusFrame();
    sheet.classList.remove("is-open", "is-dragging", "is-search-focus-snap");
    searchInput.blur();
    if (searchInput.value.length > 0) {
      searchInput.value = "";
      this.filterTools();
    }
    this.releaseDragCapture();
    this.dragMoved = false;
    if (sheet.contains(this.options.browser.document.activeElement)) {
      trigger.focus({ preventScroll: true });
    }
    sheet.setAttribute("inert", "");
    this.options.onOpenChange(false);
  }

  handleResize(): void {
    if (this.openState && this.dragPointerId === null) this.snap(this.snapState);
  }

  renderMenuState(state: Readonly<EditorToolsMenuState>): void {
    const { elements } = this.options;
    for (const button of elements.canvasButtons) {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.mobileCanvasTool === state.activeCanvasTool),
      );
    }
    for (const button of elements.vectorCommandButtons) {
      button.disabled = !state.vectorEditorReady
        || state.vectorEditorLocked
        || state.interactionLocked;
    }
    for (const button of elements.toolSettingsButtons) {
      const kind = button.dataset.mobileToolSheet;
      if (!isEditorToolSettingsKind(kind)) {
        button.disabled = true;
        continue;
      }
      const svgEditor = kind === "svg-style";
      const rasterDeformEditor = kind === "warp" || kind === "perspective";
      const textEditor = kind === "text" || kind === "text-warp";
      const vectorEffectEditor = kind === "text-outline"
        || kind === "text-drop-shadow"
        || kind === "text-inner-shadow"
        || kind === "text-block-shadow";
      button.disabled = !state.engineReady
        || state.interactionLocked
        || (rasterDeformEditor && !state.rasterDeformTargetSelected)
        || ((textEditor || vectorEffectEditor) && !state.vectorEditorReady)
        || (kind === "text-warp" && !state.textSelected)
        || (vectorEffectEditor && !state.textSelected && !state.svgSelected)
        || (svgEditor && (!state.vectorEditorReady || !state.svgSelected));
      const pressed = svgEditor
        ? state.svgSelected
        : kind === "text"
          ? state.textSelected
          : kind === "text-warp"
            ? state.textTransformActive
            : kind === "text-outline"
              ? state.vectorOutlineEnabled
              : kind === "text-drop-shadow"
                ? state.vectorDropShadowEnabled
                : kind === "text-inner-shadow"
                  ? state.vectorInnerShadowEnabled
                  : kind === "text-block-shadow"
                    ? state.vectorBlockShadowEnabled
                    : false;
      if (svgEditor || textEditor || vectorEffectEditor) {
        button.setAttribute("aria-pressed", String(pressed));
      }
    }
    for (const button of elements.effectButtons) {
      const kind = button.dataset.mobileEffectKind;
      if (!isEditorRasterEffectKind(kind)) {
        button.disabled = true;
        button.setAttribute("aria-pressed", "false");
        continue;
      }
      button.disabled = !state.engineReady
        || state.interactionLocked
        || (kind === "color-overlay" && !state.rasterColorOverlayTargetSelected);
      button.setAttribute(
        "aria-pressed",
        String(state.engineReady && state.rasterEffectsEnabled[kind]),
      );
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortController.abort();
    this.cancelSearchFocusFrame();
    if (this.openState) this.setOpen(false);
    else this.releaseDragCapture();
  }

  private bindControls(): void {
    const { elements } = this.options;
    this.listen(elements.trigger, "click", () => this.toggle());
    this.listen(elements.handle, "pointerdown", (event) => this.startDrag(event));
    this.listen(elements.handle, "pointermove", (event) => this.moveDrag(event));
    this.listen(elements.handle, "pointerup", (event) => this.finishDrag(event));
    this.listen(elements.handle, "pointercancel", (event) => this.finishDrag(event, true));
    this.listen(elements.handle, "click", () => {
      if (!this.openState) return;
      if (this.dragMoved) {
        this.dragMoved = false;
        return;
      }
      this.snap(this.snapState === "peek" ? "expanded" : "peek");
    });
    this.listen(elements.searchField, "pointerdown", (event) => {
      if (!this.openState || this.snapState === "expanded" || event.button !== 0) return;
      event.preventDefault();
      this.expandForSearchFocus();
      elements.searchInput.focus({ preventScroll: true });
    });
    this.listen(elements.searchInput, "focus", () => this.expandForSearchFocus());
    this.listen(elements.searchInput, "input", () => this.updateSearchResults());
    elements.searchInput.addEventListener("search", () => this.updateSearchResults(), {
      signal: this.abortController.signal,
    });

    for (const button of elements.canvasButtons) {
      this.listen(button, "click", () => {
        if (button.dataset.mobileToolSheet) return;
        const tool = button.dataset.mobileCanvasTool;
        if (isEditorCanvasTool(tool) && this.options.selectCanvasTool(tool)) {
          this.setOpen(false);
        }
      });
    }
    for (const button of elements.toolSettingsButtons) {
      this.listen(button, "click", () => {
        const kind = button.dataset.mobileToolSheet;
        if (isEditorToolSettingsKind(kind)) this.options.openToolSettings(kind, button);
      });
    }
    for (const button of elements.vectorCommandButtons) {
      this.listen(button, "click", () => {
        const command = button.dataset.mobileVectorCommand;
        if (!isEditorVectorCommand(command) || button.disabled) return;
        this.setOpen(false);
        this.options.runVectorCommand(command);
      });
    }
    for (const button of elements.effectButtons) {
      this.listen(button, "click", () => {
        const kind = button.dataset.mobileEffectKind;
        if (!isEditorRasterEffectKind(kind) || button.disabled) return;
        this.options.openRasterEffect(kind, button);
      });
    }
  }

  private listen<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
  ): void {
    target.addEventListener(type, listener as EventListener, {
      signal: this.abortController.signal,
    });
  }

  private filterTools(): void {
    const { categories, empty, searchInput } = this.options.elements;
    const query = normalizedSearch(searchInput.value);
    let visibleToolCount = 0;
    for (const category of categories) {
      let visibleInCategory = 0;
      const tools = category.querySelectorAll<HTMLButtonElement>("[data-mobile-tool]");
      for (const tool of tools) {
        const searchText = normalizedSearch(
          `${tool.textContent ?? ""} ${tool.dataset.mobileToolSearch ?? ""}`,
        );
        const visible = query.length === 0 || searchText.includes(query);
        tool.hidden = !visible;
        if (visible) visibleInCategory += 1;
      }
      category.hidden = visibleInCategory === 0;
      visibleToolCount += visibleInCategory;
    }
    empty.hidden = visibleToolCount !== 0;
  }

  private updateSearchResults(): void {
    this.filterTools();
    this.options.elements.content.scrollTop = 0;
  }

  private peekOffset(): number {
    const peekHeight = Math.min(240, Math.max(160, this.options.browser.innerHeight * 0.26));
    return Math.max(0, Math.round(this.options.elements.sheet.offsetHeight - peekHeight));
  }

  private closedOffset(): number {
    return Math.max(0, Math.round(this.options.elements.sheet.offsetHeight));
  }

  private setOffset(offsetPx: number, allowClose = false): void {
    const maximumOffset = allowClose ? this.closedOffset() : this.peekOffset();
    this.offsetPx = Math.min(maximumOffset, Math.max(0, offsetPx));
    this.options.elements.sheet.style.setProperty(
      "--mobile-tools-sheet-offset",
      `${Math.round(this.offsetPx)}px`,
    );
  }

  private snap(snap: MobileToolsSheetSnap): void {
    const { handle, sheet } = this.options.elements;
    this.snapState = snap;
    sheet.dataset.snap = snap;
    handle.setAttribute("aria-expanded", String(snap === "expanded"));
    handle.setAttribute(
      "aria-label",
      snap === "expanded" ? "Collapse tools menu" : "Expand tools menu",
    );
    this.setOffset(snap === "expanded" ? 0 : this.peekOffset());
  }

  private expandForSearchFocus(): void {
    if (!this.openState || this.snapState === "expanded") return;
    const { sheet, searchInput } = this.options.elements;
    sheet.classList.add("is-search-focus-snap");
    this.snap("expanded");
    void searchInput.getBoundingClientRect();
    if (this.searchFocusFrame !== null) {
      this.options.browser.cancelAnimationFrame(this.searchFocusFrame);
    }
    this.searchFocusFrame = this.options.browser.requestAnimationFrame(() => {
      this.searchFocusFrame = null;
      sheet.classList.remove("is-search-focus-snap");
    });
  }

  private startDrag(event: PointerEvent): void {
    if (!this.openState || event.button !== 0) return;
    this.dragPointerId = event.pointerId;
    this.dragStartY = event.clientY;
    this.dragStartOffsetPx = this.offsetPx;
    this.dragStartSnap = this.snapState;
    this.dragLastY = event.clientY;
    this.dragLastTime = this.options.browser.performance.now();
    this.dragVelocityY = 0;
    this.dragMoved = false;
    this.options.elements.sheet.classList.add("is-dragging");
    this.options.elements.handle.setPointerCapture(event.pointerId);
  }

  private moveDrag(event: PointerEvent): void {
    if (event.pointerId !== this.dragPointerId) return;
    const deltaY = event.clientY - this.dragStartY;
    this.recordDragMotion(event.clientY);
    if (Math.abs(deltaY) >= 4) this.dragMoved = true;
    this.setOffset(this.dragStartOffsetPx + deltaY, true);
  }

  private recordDragMotion(clientY: number): void {
    const sampleTime = this.options.browser.performance.now();
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
    const deltaY = event.clientY - this.dragStartY;
    const peekOffset = this.peekOffset();
    const releaseMotionAgeMs = this.options.browser.performance.now() - this.dragLastTime;
    const releaseVelocityY = releaseMotionAgeMs <= 100 ? this.dragVelocityY : 0;
    const shouldClose = shouldCloseMobileToolsSheetDrag({
      startSnap: this.dragStartSnap,
      deltaY,
      releaseVelocityY,
      offsetPx: this.offsetPx,
      peekOffsetPx: peekOffset,
      closedOffsetPx: this.closedOffset(),
    });
    this.releaseDragCapture();
    this.options.elements.sheet.classList.remove("is-dragging");
    if (cancelled) {
      this.snap(this.dragStartSnap);
      return;
    }
    if (this.dragMoved && shouldClose) {
      this.dragMoved = false;
      this.setOpen(false);
      return;
    }
    const target = deltaY <= -36
      ? "expanded"
      : deltaY >= 36
        ? "peek"
        : this.offsetPx <= peekOffset / 2
          ? "expanded"
          : "peek";
    if (this.dragMoved) this.snap(target);
  }

  private releaseDragCapture(): void {
    const pointerId = this.dragPointerId;
    if (
      pointerId !== null
      && this.options.elements.handle.hasPointerCapture(pointerId)
    ) {
      this.options.elements.handle.releasePointerCapture(pointerId);
    }
    this.dragPointerId = null;
  }

  private cancelSearchFocusFrame(): void {
    if (this.searchFocusFrame === null) return;
    this.options.browser.cancelAnimationFrame(this.searchFocusFrame);
    this.searchFocusFrame = null;
  }
}
