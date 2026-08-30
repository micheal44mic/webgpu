import {
  isEditorFilterKind,
  type EditorFilterKind,
} from "./editor-filters-contract.ts";

export interface EditorFiltersElements {
  readonly trigger: HTMLButtonElement;
  readonly panel: HTMLElement;
  readonly closeButton: HTMLButtonElement;
  readonly filterButtons: readonly HTMLButtonElement[];
}

export interface EditorFiltersBrowser {
  readonly AbortController: typeof AbortController;
}

export interface EditorFiltersControllerOptions {
  readonly browser: EditorFiltersBrowser;
  readonly document: Document;
  readonly elements: EditorFiltersElements;
  readonly canOpen: () => boolean;
  readonly beforeOpen: () => void;
  readonly onOpenChange: (open: boolean) => void;
  /**
   * Opens the selected filter after the catalog has closed. `returnFocus`
   * remains reachable while the filter editor is open and is the preferred
   * final focus target for its Apply or Cancel path.
   */
  readonly openFilter: (
    kind: EditorFilterKind,
    trigger: HTMLButtonElement,
    returnFocus: HTMLButtonElement,
  ) => void;
}

/** Owns the Filters catalog surface and routes typed filter selections. */
export class EditorFiltersController {
  private readonly abortController: AbortController;
  private openState = false;
  private disposed = false;

  constructor(private readonly options: EditorFiltersControllerOptions) {
    this.abortController = new options.browser.AbortController();
    this.syncClosedAccessibility();
    this.bindControls();
  }

  get isOpen(): boolean {
    return this.openState;
  }

  toggle(): void {
    this.setOpen(!this.openState);
  }

  setOpen(open: boolean): void {
    this.setOpenState(open);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortController.abort();
    if (this.openState) this.setOpenState(false);
    else this.syncClosedAccessibility();
  }

  private setOpenState(open: boolean): void {
    if ((this.disposed && open) || open === this.openState) return;
    if (open && !this.options.canOpen()) return;
    if (open) this.options.beforeOpen();

    const { trigger, panel } = this.options.elements;
    const focusWasInside = !open && panel.contains(this.options.document.activeElement);
    this.openState = open;
    trigger.setAttribute("aria-expanded", String(open));
    trigger.setAttribute("aria-label", open ? "Close filters" : "Open filters");

    // Move focus outside before making the catalog inaccessible. This also
    // covers typed filter routing, whose destination surface opens immediately
    // after this method returns.
    if (!open && focusWasInside && trigger.isConnected) {
      trigger.focus({ preventScroll: true });
    }
    panel.setAttribute("aria-hidden", String(!open));
    panel.toggleAttribute("inert", !open);

    if (open) {
      panel.hidden = false;
      void panel.offsetWidth;
      panel.classList.add("is-open");
      this.options.elements.closeButton.focus({ preventScroll: true });
    } else {
      panel.classList.remove("is-open");
    }
    this.options.onOpenChange(open);
  }

  private bindControls(): void {
    const { document, elements } = this.options;
    const signal = this.abortController.signal;
    elements.trigger.addEventListener("click", () => this.toggle(), { signal });
    elements.closeButton.addEventListener("click", () => this.setOpen(false), { signal });

    for (const button of elements.filterButtons) {
      const kind = button.dataset.editorFilterKind;
      if (!isEditorFilterKind(kind)) {
        button.disabled = true;
        continue;
      }
      button.addEventListener("click", () => {
        if (button.disabled || !this.openState) return;
        this.setOpenState(false);
        this.options.openFilter(kind, button, elements.trigger);
      }, { signal });
    }

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !this.openState) return;
      event.preventDefault();
      this.setOpen(false);
    }, { signal });
  }

  private syncClosedAccessibility(): void {
    const { trigger, panel } = this.options.elements;
    this.openState = false;
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-label", "Open filters");
    panel.classList.remove("is-open");
    panel.setAttribute("aria-hidden", "true");
    panel.setAttribute("inert", "");
  }
}
