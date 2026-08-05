import {
  nextMobileBottomSheetTapSnap,
  resolveMobileBottomSheetDrag,
  type MobileBottomSheetSnap,
} from "./mobile-bottom-sheet-gesture.ts";

export type MobileToolSettingsKind = "fill" | "selection" | "transform" | "text";
type MobileCanvasSettingsTool = Exclude<MobileToolSettingsKind, "text">;

export interface MobileToolSettingsSheetOptions {
  readonly mobileMediaQuery: MediaQueryList;
  readonly selectCanvasTool: (tool: MobileCanvasSettingsTool) => boolean;
  readonly getSelectionStatus: () => string;
  readonly beforeOpen: () => void;
  readonly onOpenChange: (open: boolean) => void;
}

const MOBILE_TOOL_MIN_PEEK_PX = 160;
const MOBILE_TOOL_MAX_PEEK_PX = 240;
const MOBILE_TOOL_PEEK_VIEWPORT_RATIO = 0.26;

const MOBILE_TOOL_TITLES: Readonly<Record<MobileToolSettingsKind, string>> = {
  fill: "Fill",
  selection: "Selection",
  transform: "Transform",
  text: "Text",
};

function requiredElement<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Elemento #${id} non trovato.`);
  return result as T;
}

function sourceControl<T extends HTMLElement>(id: string): T {
  return requiredElement<T>(id);
}

function dispatchMirroredValue(
  mobile: HTMLInputElement | HTMLSelectElement,
  sourceId: string,
  eventType: "input" | "change",
): void {
  const source = sourceControl<HTMLInputElement | HTMLSelectElement>(sourceId);
  source.value = mobile.value;
  source.dispatchEvent(new Event(eventType, { bubbles: true }));
}

export function mobileToolSettingsPeekHeight(viewportHeight: number): number {
  return Math.min(
    MOBILE_TOOL_MAX_PEEK_PX,
    Math.max(MOBILE_TOOL_MIN_PEEK_PX, viewportHeight * MOBILE_TOOL_PEEK_VIEWPORT_RATIO),
  );
}

/**
 * A mobile-only view over settings and actions which already exist elsewhere
 * in the app. It owns no tool state and creates no rendering resources.
 */
export class MobileToolSettingsSheetController {
  readonly sheet = requiredElement<HTMLElement>("mobileToolSettingsSheet");
  readonly handle = requiredElement<HTMLButtonElement>("mobileToolSettingsHandle");
  readonly header = requiredElement<HTMLElement>("mobileToolSettingsHeader");
  readonly title = requiredElement<HTMLElement>("mobileToolSettingsTitle");
  readonly scroll = requiredElement<HTMLElement>("mobileToolSettingsScroll");
  readonly panels = Array.from(
    this.scroll.querySelectorAll<HTMLElement>("[data-mobile-tool-settings-panel]"),
  );

  private readonly fillTolerance = requiredElement<HTMLInputElement>("mobileFillTolerance");
  private readonly fillToleranceOut = requiredElement<HTMLOutputElement>(
    "mobileFillToleranceOut",
  );
  private readonly selectionMethod = requiredElement<HTMLSelectElement>(
    "mobileSelectionMethod",
  );
  private readonly selectionReplace = requiredElement<HTMLButtonElement>(
    "mobileSelectionReplace",
  );
  private readonly selectionAdd = requiredElement<HTMLButtonElement>("mobileSelectionAdd");
  private readonly selectionSubtract = requiredElement<HTMLButtonElement>(
    "mobileSelectionSubtract",
  );
  private readonly selectionToleranceControl = requiredElement<HTMLElement>(
    "mobileSelectionToleranceControl",
  );
  private readonly selectionTolerance = requiredElement<HTMLInputElement>(
    "mobileSelectionTolerance",
  );
  private readonly selectionToleranceOut = requiredElement<HTMLOutputElement>(
    "mobileSelectionToleranceOut",
  );
  private readonly selectionColorControl = requiredElement<HTMLElement>(
    "mobileSelectionColorControl",
  );
  private readonly selectionColor = requiredElement<HTMLInputElement>("mobileSelectionColor");
  private readonly selectionColorApply = requiredElement<HTMLButtonElement>(
    "mobileSelectionColorApply",
  );
  private readonly selectionClear = requiredElement<HTMLButtonElement>("mobileSelectionClear");
  private readonly selectionResult = requiredElement<HTMLElement>("mobileSelectionResult");
  private readonly transformHint = requiredElement<HTMLElement>("mobileTransformHint");
  private readonly transformCancel = requiredElement<HTMLButtonElement>("mobileTransformCancel");
  private readonly transformApply = requiredElement<HTMLButtonElement>("mobileTransformApply");
  private readonly textValue = requiredElement<HTMLInputElement>("mobileTextValue");
  private readonly textFontFamily = requiredElement<HTMLSelectElement>("mobileTextFontFamily");
  private readonly textFontSize = requiredElement<HTMLInputElement>("mobileTextFontSize");
  private readonly textFontSizeOut = requiredElement<HTMLOutputElement>("mobileTextFontSizeOut");
  private readonly textColorControl = requiredElement<HTMLElement>("mobileTextColorControl");
  private readonly textColor = requiredElement<HTMLInputElement>("mobileTextColor");
  private readonly textAdd = requiredElement<HTMLButtonElement>("mobileTextAdd");

  private openState = false;
  private activeKind: MobileToolSettingsKind | null = null;
  private snap: MobileBottomSheetSnap = "peek";
  private offsetPx = 0;
  private dragPointerId: number | null = null;
  private dragStartY = 0;
  private dragStartOffsetPx = 0;
  private dragStartSnap: MobileBottomSheetSnap = "peek";
  private dragLastY = 0;
  private dragLastTime = 0;
  private dragVelocityY = 0;
  private dragMoved = false;
  private opener: HTMLElement | null = null;
  private readonly options: MobileToolSettingsSheetOptions;
  private readonly transformStateObserver: MutationObserver;

  constructor(options: MobileToolSettingsSheetOptions) {
    this.options = options;
    this.sheet.setAttribute("aria-hidden", "true");
    this.sheet.dataset.state = "closed";
    this.sheet.setAttribute("inert", "");
    this.bindEvents();
    this.transformStateObserver = new MutationObserver(() => {
      if (this.openState && this.activeKind === "transform") this.syncTransform();
    });
    this.transformStateObserver.observe(sourceControl<HTMLElement>("transformCommitBar"), {
      attributes: true,
      attributeFilter: ["hidden"],
    });
  }

  get isOpen(): boolean {
    return this.openState;
  }

  get toolKind(): MobileToolSettingsKind | null {
    return this.activeKind;
  }

  open(kind: MobileToolSettingsKind, opener: HTMLElement | null = null): void {
    if (!this.options.mobileMediaQuery.matches) return;
    if (kind !== "text" && !this.options.selectCanvasTool(kind)) return;
    if (this.openState && this.activeKind === kind) return;
    if (this.openState) this.close(false);
    this.options.beforeOpen();

    this.activeKind = kind;
    this.opener = opener;
    this.openState = true;
    this.snap = "peek";
    this.sheet.dataset.tool = kind;
    this.sheet.dataset.state = "open";
    this.sheet.hidden = false;
    this.sheet.setAttribute("aria-hidden", "false");
    this.sheet.removeAttribute("inert");
    this.sheet.setAttribute("aria-label", `${MOBILE_TOOL_TITLES[kind]} settings`);
    this.title.textContent = MOBILE_TOOL_TITLES[kind];
    for (const panel of this.panels) {
      panel.hidden = panel.dataset.mobileToolSettingsPanel !== kind;
    }
    this.syncOpenState();
    this.scroll.scrollTop = 0;
    this.snapTo("peek");
    void this.sheet.offsetHeight;
    this.sheet.classList.add("is-open");
    this.options.onOpenChange(true);
  }

  close(restoreFocus = false): void {
    if (!this.openState) return;
    this.openState = false;
    this.releaseDragCapture();
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && this.sheet.contains(activeElement)) {
      if (restoreFocus && this.opener?.isConnected) {
        this.opener.focus({ preventScroll: true });
      } else {
        activeElement.blur();
      }
    }
    this.sheet.classList.remove("is-open", "is-dragging");
    this.sheet.dataset.state = "closed";
    this.sheet.setAttribute("aria-hidden", "true");
    this.sheet.setAttribute("inert", "");
    this.handle.setAttribute("aria-expanded", "false");
    this.setOffset(this.closedOffset());
    this.options.onOpenChange(false);
    this.opener = null;
  }

  syncOpenState(): void {
    if (!this.openState || !this.activeKind) return;
    if (this.activeKind === "fill") this.syncFill();
    else if (this.activeKind === "selection") this.syncSelection();
    else if (this.activeKind === "transform") this.syncTransform();
    else this.syncText();
  }

  handleResize(): void {
    if (!this.openState || this.dragPointerId !== null) return;
    this.snapTo(this.snap);
  }

  private bindEvents(): void {
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
      this.snapTo(nextMobileBottomSheetTapSnap(this.snap));
    });

    for (const eventType of ["input", "change"] as const) {
      this.fillTolerance.addEventListener(eventType, () => {
        dispatchMirroredValue(this.fillTolerance, "fillTolerance", eventType);
        this.syncFill();
      });
      this.selectionTolerance.addEventListener(eventType, () => {
        dispatchMirroredValue(this.selectionTolerance, "selectionTolerance", eventType);
        this.syncSelection();
      });
      this.selectionColor.addEventListener(eventType, () => {
        dispatchMirroredValue(this.selectionColor, "selectionColor", eventType);
        this.selectionColorControl.style.setProperty(
          "--mobile-raster-effect-color",
          this.selectionColor.value,
        );
      });
      this.textValue.addEventListener(eventType, () => {
        dispatchMirroredValue(this.textValue, "vectorTextValue", eventType);
      });
      this.textFontSize.addEventListener(eventType, () => {
        dispatchMirroredValue(this.textFontSize, "vectorTextFontSize", eventType);
        this.syncText();
      });
      this.textColor.addEventListener(eventType, () => {
        dispatchMirroredValue(this.textColor, "vectorTextColor", eventType);
        this.textColorControl.style.setProperty(
          "--mobile-raster-effect-color",
          this.textColor.value,
        );
      });
    }
    this.selectionMethod.addEventListener("change", () => {
      dispatchMirroredValue(this.selectionMethod, "selectionMethod", "change");
      this.syncSelection();
    });
    this.textFontFamily.addEventListener("change", () => {
      dispatchMirroredValue(this.textFontFamily, "vectorTextFontFamily", "change");
      this.syncText();
    });

    for (const [mobile, sourceId] of [
      [this.selectionReplace, "selectionReplace"],
      [this.selectionAdd, "selectionAdd"],
      [this.selectionSubtract, "selectionSubtract"],
    ] as const) {
      mobile.addEventListener("click", () => {
        sourceControl<HTMLButtonElement>(sourceId).click();
        this.syncSelection();
      });
    }
    this.selectionColorApply.addEventListener("click", () => {
      sourceControl<HTMLButtonElement>("selectionColorApply").click();
      requestAnimationFrame(() => this.syncOpenState());
    });
    this.selectionClear.addEventListener("click", () => {
      sourceControl<HTMLButtonElement>("selectionClear").click();
      requestAnimationFrame(() => this.syncOpenState());
    });
    this.transformCancel.addEventListener("click", () => {
      sourceControl<HTMLButtonElement>("transformCancel").click();
      requestAnimationFrame(() => this.syncOpenState());
    });
    this.transformApply.addEventListener("click", () => {
      sourceControl<HTMLButtonElement>("transformApply").click();
      requestAnimationFrame(() => this.syncOpenState());
    });
    this.textAdd.addEventListener("click", () => {
      sourceControl<HTMLButtonElement>("addVectorText").click();
      requestAnimationFrame(() => this.syncOpenState());
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !this.openState) return;
      event.preventDefault();
      this.close(true);
    });
  }

  private syncFill(): void {
    const source = sourceControl<HTMLInputElement>("fillTolerance");
    this.fillTolerance.value = source.value;
    this.fillTolerance.disabled = source.disabled;
    this.fillToleranceOut.value = `${Number(source.value).toFixed(1)}%`;
  }

  private syncSelection(): void {
    const sourceMethod = sourceControl<HTMLSelectElement>("selectionMethod");
    const sourceTolerance = sourceControl<HTMLInputElement>("selectionTolerance");
    const sourceColor = sourceControl<HTMLInputElement>("selectionColor");
    this.selectionMethod.value = sourceMethod.value;
    this.selectionMethod.disabled = sourceMethod.disabled;
    this.selectionTolerance.value = sourceTolerance.value;
    this.selectionTolerance.disabled = sourceTolerance.disabled;
    this.selectionToleranceOut.value = `${Math.round(Number(sourceTolerance.value))}/255`;
    this.selectionColor.value = sourceColor.value;
    this.selectionColorControl.style.setProperty("--mobile-raster-effect-color", sourceColor.value);
    this.selectionColor.disabled = sourceColor.disabled;
    const colorRange = sourceMethod.value === "color-range";
    const lasso = sourceMethod.value === "lasso";
    this.selectionToleranceControl.hidden = lasso;
    this.selectionColorControl.hidden = !colorRange;
    this.selectionColorApply.hidden = !colorRange;
    for (const [mobile, sourceId] of [
      [this.selectionReplace, "selectionReplace"],
      [this.selectionAdd, "selectionAdd"],
      [this.selectionSubtract, "selectionSubtract"],
    ] as const) {
      const source = sourceControl<HTMLButtonElement>(sourceId);
      mobile.setAttribute("aria-pressed", source.getAttribute("aria-pressed") ?? "false");
      mobile.disabled = source.disabled;
    }
    this.selectionColorApply.disabled = sourceControl<HTMLButtonElement>(
      "selectionColorApply",
    ).disabled;
    this.selectionClear.disabled = sourceControl<HTMLButtonElement>("selectionClear").disabled;
    this.selectionResult.textContent = this.options.getSelectionStatus();
  }

  private syncTransform(): void {
    const commitBar = sourceControl<HTMLElement>("transformCommitBar");
    const cancel = sourceControl<HTMLButtonElement>("transformCancel");
    const apply = sourceControl<HTMLButtonElement>("transformApply");
    const transactionActive = !commitBar.hidden;
    this.transformCancel.disabled = !transactionActive || cancel.disabled;
    this.transformApply.disabled = !transactionActive || apply.disabled;
    this.transformHint.textContent = transactionActive
      ? "Preview active. Apply or cancel the transform."
      : "Select content on the canvas, then drag it to transform.";
  }

  private syncText(): void {
    const sourceValue = sourceControl<HTMLInputElement>("vectorTextValue");
    const sourceFont = sourceControl<HTMLSelectElement>("vectorTextFontFamily");
    const sourceSize = sourceControl<HTMLInputElement>("vectorTextFontSize");
    const sourceColor = sourceControl<HTMLInputElement>("vectorTextColor");
    const sourceAdd = sourceControl<HTMLButtonElement>("addVectorText");
    this.textValue.value = sourceValue.value;
    this.textValue.disabled = sourceValue.disabled;
    this.textFontFamily.value = sourceFont.value;
    this.textFontFamily.disabled = sourceFont.disabled;
    this.textFontSize.value = sourceSize.value;
    this.textFontSize.disabled = sourceSize.disabled;
    this.textFontSizeOut.value = `${Math.round(Number(sourceSize.value))} px`;
    this.textColor.value = sourceColor.value;
    this.textColorControl.style.setProperty("--mobile-raster-effect-color", sourceColor.value);
    this.textColor.disabled = sourceColor.disabled;
    this.textAdd.disabled = sourceAdd.disabled;
  }

  private peekOffset(): number {
    return Math.max(
      0,
      Math.round(this.closedOffset() - mobileToolSettingsPeekHeight(window.innerHeight)),
    );
  }

  private closedOffset(): number {
    return Math.max(0, Math.round(this.sheet.offsetHeight));
  }

  private minimizedOffset(): number {
    const visibleHeight = Math.round(this.handle.offsetHeight + this.header.offsetHeight);
    return Math.max(0, this.closedOffset() - visibleHeight);
  }

  private setOffset(offsetPx: number): void {
    const closed = this.closedOffset();
    this.offsetPx = Math.min(closed, Math.max(0, offsetPx));
    this.sheet.style.setProperty(
      "--mobile-tools-sheet-offset",
      `${Math.round(this.offsetPx)}px`,
    );
    this.sheet.style.setProperty(
      "--mobile-tool-settings-visible-height",
      `${Math.max(0, Math.round(closed - this.offsetPx))}px`,
    );
  }

  private snapTo(snap: MobileBottomSheetSnap): void {
    if (!this.activeKind) return;
    this.snap = snap;
    this.sheet.dataset.snap = snap;
    const minimized = snap === "minimized";
    const expanded = snap === "expanded";
    this.setMinimizedAccessibility(minimized);
    this.handle.setAttribute("aria-expanded", String(expanded));
    this.handle.setAttribute(
      "aria-label",
      `${minimized ? "Restore" : expanded ? "Collapse" : "Expand"} ${MOBILE_TOOL_TITLES[this.activeKind]} settings`,
    );
    this.setOffset(expanded ? 0 : minimized ? this.minimizedOffset() : this.peekOffset());
  }

  private setMinimizedAccessibility(minimized: boolean): void {
    const activeElement = document.activeElement;
    if (
      minimized
      && activeElement instanceof HTMLElement
      && this.scroll.contains(activeElement)
    ) {
      this.handle.focus({ preventScroll: true });
    }
    this.scroll.toggleAttribute("inert", minimized);
    this.scroll.setAttribute("aria-hidden", String(minimized));
  }

  private startDrag(event: PointerEvent): void {
    if (!this.openState || event.button !== 0) return;
    this.dragPointerId = event.pointerId;
    this.dragStartY = event.clientY;
    this.dragStartOffsetPx = this.offsetPx;
    this.dragStartSnap = this.snap;
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
    const deltaY = event.clientY - this.dragStartY;
    if (Math.abs(deltaY) >= 4) this.dragMoved = true;
    const maximumOffset = this.dragStartSnap === "minimized"
      ? this.closedOffset()
      : this.minimizedOffset();
    this.setOffset(Math.min(maximumOffset, this.dragStartOffsetPx + deltaY));
  }

  private finishDrag(event: PointerEvent, cancelled = false): void {
    if (event.pointerId !== this.dragPointerId) return;
    if (this.handle.hasPointerCapture(event.pointerId)) {
      this.handle.releasePointerCapture(event.pointerId);
    }
    this.sheet.classList.remove("is-dragging");
    const deltaY = event.clientY - this.dragStartY;
    const velocityAge = performance.now() - this.dragLastTime;
    const releaseVelocityY = velocityAge <= 100 ? this.dragVelocityY : 0;
    this.dragPointerId = null;
    if (cancelled) {
      this.snapTo(this.dragStartSnap);
      this.dragMoved = false;
      return;
    }
    const decision = resolveMobileBottomSheetDrag({
      startSnap: this.dragStartSnap,
      deltaY,
      releaseVelocityY,
      offsetPx: this.offsetPx,
      peekOffsetPx: this.peekOffset(),
      minimizedOffsetPx: this.minimizedOffset(),
    });
    if (this.dragMoved && decision === "closed") {
      this.close(false);
      this.dragMoved = false;
      return;
    }
    if (this.dragMoved && decision !== "closed") this.snapTo(decision);
  }

  private releaseDragCapture(): void {
    if (
      this.dragPointerId !== null
      && this.handle.hasPointerCapture(this.dragPointerId)
    ) {
      this.handle.releasePointerCapture(this.dragPointerId);
    }
    this.dragPointerId = null;
    this.dragMoved = false;
  }
}
