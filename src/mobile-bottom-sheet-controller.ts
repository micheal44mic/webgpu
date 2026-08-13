import {
  nextMobileBottomSheetTapSnap,
  resolveMobileBottomSheetDrag,
  type MobileBottomSheetSnap,
} from "./mobile-bottom-sheet-gesture.ts";

export interface MobileBottomSheetControllerOptions {
  readonly browser: Window;
  readonly document: Document;
  readonly sheet: HTMLElement;
  readonly handle: HTMLButtonElement;
  readonly header: HTMLElement;
  readonly accessibilityRegions: readonly HTMLElement[];
  readonly peekHeight: (viewportHeight: number) => number;
  readonly label: () => string;
  readonly onCloseRequest: () => void;
  readonly beforeMinimizedFocus?: () => void;
  readonly visibleHeightCssProperty?: string;
}

/**
 * Shared lifecycle, focus, accessibility and three-detent gesture owner for
 * persistent mobile sheets. Feature controllers retain only their domain UI.
 */
export class MobileBottomSheetController {
  private readonly options: MobileBottomSheetControllerOptions;
  private openState = false;
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

  constructor(options: MobileBottomSheetControllerOptions) {
    this.options = options;
    options.sheet.setAttribute("aria-hidden", "true");
    options.sheet.dataset.state = "closed";
    options.sheet.setAttribute("inert", "");
    this.bindHandle();
  }

  get isOpen(): boolean {
    return this.openState;
  }

  get isDragging(): boolean {
    return this.dragPointerId !== null;
  }

  open(opener: HTMLElement | null = null): boolean {
    if (this.openState) return false;
    this.opener = opener;
    this.openState = true;
    this.options.sheet.hidden = false;
    this.options.sheet.dataset.state = "open";
    this.options.sheet.setAttribute("aria-hidden", "false");
    this.options.sheet.removeAttribute("inert");
    this.snapTo("peek");
    void this.options.sheet.offsetHeight;
    this.options.sheet.classList.add("is-open");
    return true;
  }

  close(restoreFocus = false): boolean {
    if (!this.openState) return false;
    this.openState = false;
    this.releaseDragCapture();
    const activeElement = this.options.document.activeElement;
    if (activeElement instanceof HTMLElement && this.options.sheet.contains(activeElement)) {
      if (restoreFocus && this.opener?.isConnected) {
        this.opener.focus({ preventScroll: true });
      } else {
        activeElement.blur();
      }
    }
    this.options.sheet.classList.remove("is-open", "is-dragging");
    this.options.sheet.dataset.state = "closed";
    this.options.sheet.setAttribute("aria-hidden", "true");
    this.options.sheet.setAttribute("inert", "");
    this.options.handle.setAttribute("aria-expanded", "false");
    this.setOffset(this.closedOffset());
    this.opener = null;
    return true;
  }

  handleResize(): void {
    if (!this.openState || this.isDragging) return;
    this.snapTo(this.snap);
  }

  private bindHandle(): void {
    const { handle } = this.options;
    handle.addEventListener("pointerdown", (event) => this.startDrag(event));
    handle.addEventListener("pointermove", (event) => this.moveDrag(event));
    handle.addEventListener("pointerup", (event) => this.finishDrag(event));
    handle.addEventListener("pointercancel", (event) => this.finishDrag(event, true));
    handle.addEventListener("click", () => {
      if (!this.openState) return;
      if (this.dragMoved) {
        this.dragMoved = false;
        return;
      }
      this.snapTo(nextMobileBottomSheetTapSnap(this.snap));
    });
  }

  private peekOffset(): number {
    return Math.max(
      0,
      Math.round(
        this.closedOffset() - this.options.peekHeight(this.options.browser.innerHeight),
      ),
    );
  }

  private closedOffset(): number {
    return Math.max(0, Math.round(this.options.sheet.offsetHeight));
  }

  private minimizedOffset(): number {
    const visibleHeight = Math.max(
      0,
      Math.round(this.options.handle.offsetHeight + this.options.header.offsetHeight),
    );
    return Math.max(0, this.closedOffset() - visibleHeight);
  }

  private setOffset(offsetPx: number): void {
    const closed = this.closedOffset();
    this.offsetPx = Math.min(closed, Math.max(0, offsetPx));
    this.options.sheet.style.setProperty(
      "--mobile-tools-sheet-offset",
      `${Math.round(this.offsetPx)}px`,
    );
    if (this.options.visibleHeightCssProperty) {
      this.options.sheet.style.setProperty(
        this.options.visibleHeightCssProperty,
        `${Math.max(0, Math.round(closed - this.offsetPx))}px`,
      );
    }
  }

  private snapTo(snap: MobileBottomSheetSnap): void {
    this.snap = snap;
    this.options.sheet.dataset.snap = snap;
    const expanded = snap === "expanded";
    const minimized = snap === "minimized";
    this.setMinimizedAccessibility(minimized);
    this.options.handle.setAttribute("aria-expanded", String(expanded));
    this.options.handle.setAttribute(
      "aria-label",
      `${minimized ? "Restore" : expanded ? "Collapse" : "Expand"} ${this.options.label()} settings`,
    );
    this.setOffset(expanded ? 0 : minimized ? this.minimizedOffset() : this.peekOffset());
  }

  private setMinimizedAccessibility(minimized: boolean): void {
    const activeElement = this.options.document.activeElement;
    if (
      minimized
      && activeElement instanceof HTMLElement
      && this.options.accessibilityRegions.some((region) => region.contains(activeElement))
    ) {
      this.options.beforeMinimizedFocus?.();
      this.options.handle.focus({ preventScroll: true });
    }
    for (const region of this.options.accessibilityRegions) {
      region.toggleAttribute("inert", minimized);
      region.setAttribute("aria-hidden", String(minimized));
    }
  }

  private startDrag(event: PointerEvent): void {
    if (!this.openState || event.button !== 0) return;
    this.dragPointerId = event.pointerId;
    this.dragStartY = event.clientY;
    this.dragStartOffsetPx = this.offsetPx;
    this.dragStartSnap = this.snap;
    this.dragLastY = event.clientY;
    this.dragLastTime = this.options.browser.performance.now();
    this.dragVelocityY = 0;
    this.dragMoved = false;
    this.options.sheet.classList.add("is-dragging");
    this.options.handle.setPointerCapture(event.pointerId);
  }

  private moveDrag(event: PointerEvent): void {
    if (event.pointerId !== this.dragPointerId) return;
    const now = this.options.browser.performance.now();
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
    if (this.options.handle.hasPointerCapture(event.pointerId)) {
      this.options.handle.releasePointerCapture(event.pointerId);
    }
    this.options.sheet.classList.remove("is-dragging");
    const deltaY = event.clientY - this.dragStartY;
    const velocityAge = this.options.browser.performance.now() - this.dragLastTime;
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
    if (decision === "closed") {
      if (this.dragMoved) this.options.onCloseRequest();
      this.dragMoved = false;
      return;
    }
    if (this.dragMoved) this.snapTo(decision);
  }

  private releaseDragCapture(): void {
    if (
      this.dragPointerId !== null
      && this.options.handle.hasPointerCapture(this.dragPointerId)
    ) {
      this.options.handle.releasePointerCapture(this.dragPointerId);
    }
    this.dragPointerId = null;
    this.dragMoved = false;
  }
}
