import {
  nextMobileBottomSheetTapSnap,
  resolveMobileBottomSheetDrag,
  type MobileBottomSheetSnap,
} from "./mobile-bottom-sheet-gesture.ts";

export interface MobileNoiseSheetOptions {
  readonly browser: Window & { readonly AbortController: typeof AbortController };
  readonly document: Document;
  readonly elements: {
    readonly sheet: HTMLElement;
    readonly handle: HTMLButtonElement;
    readonly header: HTMLElement;
    readonly controlsRegion: HTMLElement;
  };
  readonly beforeOpen: () => void;
  readonly onRequestCancel: () => void;
  readonly onOpenChange: (open: boolean) => void;
}

const MOBILE_NOISE_MIN_PEEK_PX = 176;
const MOBILE_NOISE_MAX_PEEK_PX = 240;
const MOBILE_NOISE_PEEK_VIEWPORT_RATIO = 0.26;

function peekHeight(viewportHeight: number): number {
  return Math.min(
    MOBILE_NOISE_MAX_PEEK_PX,
    Math.max(
      MOBILE_NOISE_MIN_PEEK_PX,
      viewportHeight * MOBILE_NOISE_PEEK_VIEWPORT_RATIO,
    ),
  );
}

/**
 * Presentation-only bottom sheet for the destructive Noise session.
 * The runtime remains the sole owner of preview pixels, commit and rollback;
 * a close gesture requests the same asynchronous Cancel path as the buttons.
 */
export class MobileNoiseSheetController {
  readonly sheet: HTMLElement;
  readonly handle: HTMLButtonElement;
  readonly header: HTMLElement;
  readonly controlsRegion: HTMLElement;

  private readonly abortController: AbortController;
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

  constructor(private readonly options: MobileNoiseSheetOptions) {
    this.sheet = options.elements.sheet;
    this.handle = options.elements.handle;
    this.header = options.elements.header;
    this.controlsRegion = options.elements.controlsRegion;
    this.abortController = new options.browser.AbortController();
    this.sheet.dataset.state = "closed";
    this.sheet.setAttribute("aria-hidden", "true");
    this.sheet.setAttribute("inert", "");
    this.bindEvents();
  }

  get isOpen(): boolean {
    return this.openState;
  }

  open(opener: HTMLElement | null = null): boolean {
    if (this.openState) return false;
    this.options.beforeOpen();
    this.opener = opener;
    this.openState = true;
    this.sheet.hidden = false;
    this.sheet.dataset.state = "open";
    this.sheet.setAttribute("aria-hidden", "false");
    this.sheet.removeAttribute("inert");
    this.snap = "peek";
    this.snapTo("peek");
    void this.sheet.offsetHeight;
    this.sheet.classList.add("is-open");
    this.options.onOpenChange(true);
    return true;
  }

  close(restoreFocus = false): void {
    if (!this.openState) return;
    this.openState = false;
    this.releaseDragCapture();
    const activeElement = this.options.document.activeElement;
    if (activeElement instanceof HTMLElement && this.sheet.contains(activeElement)) {
      if (restoreFocus && this.opener?.isConnected) {
        this.opener.focus({ preventScroll: true });
      } else {
        activeElement.blur();
      }
    }
    this.controlsRegion.removeAttribute("inert");
    this.controlsRegion.setAttribute("aria-hidden", "false");
    this.sheet.classList.remove("is-open", "is-dragging");
    this.sheet.dataset.state = "closed";
    this.sheet.setAttribute("aria-hidden", "true");
    this.sheet.setAttribute("inert", "");
    this.handle.setAttribute("aria-expanded", "false");
    this.setOffset(this.closedOffset());
    this.options.onOpenChange(false);
    this.opener = null;
  }

  handleResize(): void {
    if (!this.openState || this.dragPointerId !== null) return;
    this.snapTo(this.snap);
  }

  dispose(): void {
    this.abortController.abort();
    this.close(false);
  }

  private bindEvents(): void {
    const signal = this.abortController.signal;
    this.handle.addEventListener("pointerdown", (event) => this.startDrag(event), { signal });
    this.handle.addEventListener("pointermove", (event) => this.moveDrag(event), { signal });
    this.handle.addEventListener("pointerup", (event) => this.finishDrag(event), { signal });
    this.handle.addEventListener(
      "pointercancel",
      (event) => this.finishDrag(event, true),
      { signal },
    );
    this.handle.addEventListener("click", () => {
      if (!this.openState) return;
      if (this.dragMoved) {
        this.dragMoved = false;
        return;
      }
      this.snapTo(nextMobileBottomSheetTapSnap(this.snap));
    }, { signal });
    this.options.document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !this.openState) return;
      event.preventDefault();
      this.options.onRequestCancel();
    }, { signal });
  }

  private peekOffset(): number {
    return Math.max(
      0,
      Math.round(this.sheet.offsetHeight - peekHeight(this.options.browser.innerHeight)),
    );
  }

  private closedOffset(): number {
    return Math.max(0, Math.round(this.sheet.offsetHeight));
  }

  private minimizedHeight(): number {
    return Math.max(0, Math.round(this.handle.offsetHeight + this.header.offsetHeight));
  }

  private minimizedOffset(): number {
    return Math.max(0, this.closedOffset() - this.minimizedHeight());
  }

  private setOffset(offsetPx: number): void {
    const closed = this.closedOffset();
    this.offsetPx = Math.min(closed, Math.max(0, offsetPx));
    this.sheet.style.setProperty(
      "--mobile-tools-sheet-offset",
      `${Math.round(this.offsetPx)}px`,
    );
    this.sheet.style.setProperty(
      "--mobile-noise-visible-height",
      `${Math.max(0, Math.round(closed - this.offsetPx))}px`,
    );
  }

  private snapTo(snap: MobileBottomSheetSnap): void {
    this.snap = snap;
    this.sheet.dataset.snap = snap;
    const expanded = snap === "expanded";
    const minimized = snap === "minimized";
    this.setMinimizedAccessibility(minimized);
    this.handle.setAttribute("aria-expanded", String(expanded));
    this.handle.setAttribute(
      "aria-label",
      `${minimized ? "Restore" : expanded ? "Collapse" : "Expand"} Noise settings`,
    );
    this.setOffset(
      expanded ? 0 : minimized ? this.minimizedOffset() : this.peekOffset(),
    );
  }

  private setMinimizedAccessibility(minimized: boolean): void {
    const activeElement = this.options.document.activeElement;
    if (
      minimized
      && activeElement instanceof HTMLElement
      && this.controlsRegion.contains(activeElement)
    ) {
      this.handle.focus({ preventScroll: true });
    }
    this.controlsRegion.toggleAttribute("inert", minimized);
    this.controlsRegion.setAttribute("aria-hidden", String(minimized));
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
    this.sheet.classList.add("is-dragging");
    this.handle.setPointerCapture(event.pointerId);
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
    if (this.handle.hasPointerCapture(event.pointerId)) {
      this.handle.releasePointerCapture(event.pointerId);
    }
    this.sheet.classList.remove("is-dragging");
    const deltaY = event.clientY - this.dragStartY;
    const releaseVelocity = this.options.browser.performance.now() - this.dragLastTime <= 100
      ? this.dragVelocityY
      : 0;
    this.dragPointerId = null;
    if (cancelled) {
      this.snapTo(this.dragStartSnap);
      this.dragMoved = false;
      return;
    }
    const decision = resolveMobileBottomSheetDrag({
      startSnap: this.dragStartSnap,
      deltaY,
      releaseVelocityY: releaseVelocity,
      offsetPx: this.offsetPx,
      peekOffsetPx: this.peekOffset(),
      minimizedOffsetPx: this.minimizedOffset(),
    });
    if (this.dragMoved && decision === "closed") {
      this.snapTo("minimized");
      this.options.onRequestCancel();
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
