import { MobileBottomSheetController } from "./mobile-bottom-sheet-controller.ts";

export interface MobileGlassSheetOptions {
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

const MINIMUM_PEEK_HEIGHT = 220;
const MAXIMUM_PEEK_HEIGHT = 310;
const PEEK_VIEWPORT_RATIO = 0.34;

function glassPeekHeight(viewportHeight: number): number {
  return Math.min(
    MAXIMUM_PEEK_HEIGHT,
    Math.max(MINIMUM_PEEK_HEIGHT, viewportHeight * PEEK_VIEWPORT_RATIO),
  );
}

/** Presentation-only surface for a transactional Glass preview. */
export class MobileGlassSheetController {
  private readonly sheetState: MobileBottomSheetController;
  private readonly abortController: AbortController;
  private disposed = false;

  constructor(private readonly options: MobileGlassSheetOptions) {
    this.abortController = new options.browser.AbortController();
    this.sheetState = new MobileBottomSheetController({
      browser: options.browser,
      document: options.document,
      sheet: options.elements.sheet,
      handle: options.elements.handle,
      header: options.elements.header,
      accessibilityRegions: [options.elements.controlsRegion],
      peekHeight: glassPeekHeight,
      label: () => "Glass",
      onCloseRequest: options.onRequestCancel,
      visibleHeightCssProperty: "--mobile-glass-visible-height",
    });
    options.document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !this.isOpen) return;
      event.preventDefault();
      options.onRequestCancel();
    }, { signal: this.abortController.signal });
  }

  get isOpen(): boolean {
    return this.sheetState.isOpen;
  }

  open(opener: HTMLElement | null = null): boolean {
    if (this.disposed || this.isOpen) return false;
    this.options.beforeOpen();
    const opened = this.sheetState.open(opener);
    if (opened) {
      this.options.elements.handle.focus({ preventScroll: true });
      this.options.onOpenChange(true);
    }
    return opened;
  }

  close(restoreFocus = false): void {
    if (!this.sheetState.close(restoreFocus)) return;
    this.options.elements.controlsRegion.removeAttribute("inert");
    this.options.elements.controlsRegion.setAttribute("aria-hidden", "false");
    this.options.onOpenChange(false);
  }

  handleResize(): void {
    this.sheetState.handleResize();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortController.abort();
    this.close(false);
  }
}
