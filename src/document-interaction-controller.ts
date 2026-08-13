import type { BrushEngine } from "./brush-engine";

export const DOUBLE_TAP_ZOOM_INTERVAL_MS = 350;
export const DOUBLE_TAP_ZOOM_DISTANCE_PX = 32;

const EDITABLE_TEXT_SELECTOR = [
  "input:not([type])",
  'input[type="text"]',
  'input[type="search"]',
  'input[type="email"]',
  'input[type="url"]',
  'input[type="tel"]',
  'input[type="password"]',
  'input[type="number"]',
  "textarea",
  '[contenteditable]:not([contenteditable="false"])',
  ".allow-text-selection",
].join(", ");

export type DocumentInteractionEnginePort = Pick<
  BrushEngine,
  | "interruptHistoryMaintenance"
  | "pauseLayerColdCompressionForInteraction"
  | "resumeDiscardedHistoryMaintenance"
  | "resumeLayerColdCompressionAfterInteraction"
  | "layerColdCompressionEnabled"
>;

export interface DocumentInteractionBrowser extends Window {
  readonly AbortController: typeof AbortController;
  readonly Element: typeof Element;
}

export interface DocumentInteractionControllerOptions {
  readonly browser: DocumentInteractionBrowser;
  readonly document: Document;
  readonly engine: DocumentInteractionEnginePort;
  readonly cancelTransientInteraction: () => void;
}

/**
 * Owns document-wide interaction policy that is independent from a particular
 * tool: browser zoom suppression, text-selection exceptions and compression /
 * history maintenance around active pointers.
 */
export class DocumentInteractionController {
  private readonly abortController: AbortController;
  private readonly compressionPointers = new Set<number>();
  private previousTouchEndTime = Number.NEGATIVE_INFINITY;
  private previousTouchEndX = Number.NEGATIVE_INFINITY;
  private previousTouchEndY = Number.NEGATIVE_INFINITY;
  private disposed = false;

  constructor(private readonly options: DocumentInteractionControllerOptions) {
    this.abortController = new options.browser.AbortController();
    this.bind();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortController.abort();
    this.compressionPointers.clear();
    this.resetDoubleTapZoomGuard();
  }

  private bind(): void {
    const { browser, document } = this.options;
    const signal = this.abortController.signal;

    document.addEventListener("touchstart", (event) => {
      if (event.touches.length > 1) this.resetDoubleTapZoomGuard();
    }, { capture: true, passive: true, signal });
    document.addEventListener("touchcancel", () => {
      this.resetDoubleTapZoomGuard();
    }, { capture: true, passive: true, signal });
    document.addEventListener("touchend", (event) => {
      this.handleTouchEnd(event);
    }, { capture: true, passive: false, signal });
    document.addEventListener("dblclick", (event) => {
      event.preventDefault();
    }, { capture: true, passive: false, signal });
    document.addEventListener("selectstart", (event) => {
      const target = event.target instanceof browser.Element ? event.target : null;
      if (!target?.closest(EDITABLE_TEXT_SELECTOR)) event.preventDefault();
    }, { capture: true, signal });

    browser.addEventListener("blur", () => {
      this.options.cancelTransientInteraction();
      if (!this.options.engine.layerColdCompressionEnabled) return;
      this.compressionPointers.clear();
      this.options.engine.pauseLayerColdCompressionForInteraction();
    }, { signal });
    browser.addEventListener("focus", () => {
      this.resumeCompressionIfIdle();
    }, { signal });
    browser.addEventListener("pointerdown", (event) => {
      if (this.options.engine.layerColdCompressionEnabled) {
        this.compressionPointers.add(event.pointerId);
        this.options.engine.pauseLayerColdCompressionForInteraction();
      }
      this.options.engine.interruptHistoryMaintenance();
    }, { capture: true, signal });
    browser.addEventListener("pointerup", (event) => {
      this.finishPointerInteraction(event.pointerId);
      this.options.engine.resumeDiscardedHistoryMaintenance();
    }, { capture: true, signal });
    browser.addEventListener("pointercancel", (event) => {
      this.finishPointerInteraction(event.pointerId);
      this.options.engine.resumeDiscardedHistoryMaintenance();
    }, { capture: true, signal });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") {
        if (this.options.engine.layerColdCompressionEnabled) {
          this.compressionPointers.clear();
          this.options.engine.pauseLayerColdCompressionForInteraction();
        }
        return;
      }
      this.resumeCompressionIfIdle();
    }, { signal });
  }

  private handleTouchEnd(event: TouchEvent): void {
    if (event.touches.length !== 0 || event.changedTouches.length !== 1) {
      this.resetDoubleTapZoomGuard();
      return;
    }
    const touch = event.changedTouches[0];
    const elapsed = event.timeStamp - this.previousTouchEndTime;
    const distance = Math.hypot(
      touch.clientX - this.previousTouchEndX,
      touch.clientY - this.previousTouchEndY,
    );
    if (
      elapsed > 0
      && elapsed <= DOUBLE_TAP_ZOOM_INTERVAL_MS
      && distance <= DOUBLE_TAP_ZOOM_DISTANCE_PX
    ) {
      event.preventDefault();
      this.resetDoubleTapZoomGuard();
      return;
    }
    this.previousTouchEndTime = event.timeStamp;
    this.previousTouchEndX = touch.clientX;
    this.previousTouchEndY = touch.clientY;
  }

  private finishPointerInteraction(pointerId: number): void {
    if (!this.options.engine.layerColdCompressionEnabled) return;
    this.compressionPointers.delete(pointerId);
    this.resumeCompressionIfIdle();
  }

  private resumeCompressionIfIdle(): void {
    if (
      this.options.engine.layerColdCompressionEnabled
      && this.compressionPointers.size === 0
      && this.options.document.visibilityState === "visible"
      && this.options.document.hasFocus()
    ) {
      this.options.engine.resumeLayerColdCompressionAfterInteraction();
    }
  }

  private resetDoubleTapZoomGuard(): void {
    this.previousTouchEndTime = Number.NEGATIVE_INFINITY;
    this.previousTouchEndX = Number.NEGATIVE_INFINITY;
    this.previousTouchEndY = Number.NEGATIVE_INFINITY;
  }
}
