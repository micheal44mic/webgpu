import {
  loadEditorGuidePreferences,
  saveEditorGuidePreferences,
  type EditorGuidePreferences,
  type EditorSettingsStoragePort,
  type EditorSymmetryAxis,
} from "./editor-settings-storage.ts";

export interface EditorSettingsElements {
  readonly trigger: HTMLButtonElement;
  readonly panel: HTMLElement;
  readonly closeButton: HTMLButtonElement;
  readonly rulersInput: HTMLInputElement;
  readonly gridInput: HTMLInputElement;
  readonly snappingInput: HTMLInputElement;
  readonly symmetryEnabledInput: HTMLInputElement;
  readonly symmetryOptionsButton: HTMLButtonElement;
  readonly symmetryOptionsPanel: HTMLElement;
  readonly symmetryAxisInputs: readonly HTMLInputElement[];
}

export interface EditorSettingsBrowser {
  readonly AbortController: typeof AbortController;
}

export interface EditorSettingsControllerOptions {
  readonly browser: EditorSettingsBrowser;
  readonly document: Document;
  readonly storage: EditorSettingsStoragePort | null;
  readonly elements: EditorSettingsElements;
  readonly canOpen: () => boolean;
  readonly beforeOpen: () => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly onPreferencesChange: (
    preferences: Readonly<EditorGuidePreferences>,
  ) => void;
}

/** Owns the editor Settings surface and its locally persisted guide controls. */
export class EditorSettingsController {
  private readonly options: EditorSettingsControllerOptions;
  private readonly abortController: AbortController;
  private readonly symmetryEnabledInput: HTMLInputElement;
  private readonly symmetryOptionsButton: HTMLButtonElement;
  private readonly symmetryOptionsPanel: HTMLElement;
  private readonly symmetryAxisInputs: readonly HTMLInputElement[];
  private openState = false;
  private preferencesState: EditorGuidePreferences;
  private disposed = false;

  constructor(options: EditorSettingsControllerOptions) {
    this.options = options;
    this.abortController = new options.browser.AbortController();
    this.symmetryEnabledInput = options.elements.symmetryEnabledInput;
    this.symmetryOptionsButton = options.elements.symmetryOptionsButton;
    this.symmetryOptionsPanel = options.elements.symmetryOptionsPanel;
    this.symmetryAxisInputs = [...options.elements.symmetryAxisInputs];
    if (
      !this.symmetryAxisInputs.some((input) => input.value === "vertical")
      || !this.symmetryAxisInputs.some((input) => input.value === "horizontal")
    ) {
      throw new Error("Symmetry axis controls are incomplete.");
    }
    this.preferencesState = loadEditorGuidePreferences(options.storage);
    this.syncInputs();
    this.setSymmetryOptionsOpen(false);
    this.syncClosedAccessibility();
    this.bindControls();
  }

  get isOpen(): boolean {
    return this.openState;
  }

  get preferences(): Readonly<EditorGuidePreferences> {
    return { ...this.preferencesState };
  }

  toggle(): void {
    this.setOpen(!this.openState);
  }

  setOpen(open: boolean): void {
    if ((this.disposed && open) || open === this.openState) return;
    if (open && !this.options.canOpen()) return;
    if (open) this.options.beforeOpen();

    const { trigger, panel } = this.options.elements;
    const restoreFocus = !open && panel.contains(this.options.document.activeElement);
    this.openState = open;
    trigger.setAttribute("aria-expanded", String(open));
    trigger.setAttribute("aria-label", open ? "Close settings" : "Open settings");
    panel.setAttribute("aria-hidden", String(!open));
    panel.toggleAttribute("inert", !open);

    if (open) {
      panel.hidden = false;
      void panel.offsetWidth;
      panel.classList.add("is-open");
      this.options.elements.closeButton.focus({ preventScroll: true });
    } else {
      panel.classList.remove("is-open");
      this.setSymmetryOptionsOpen(false);
      if (restoreFocus && trigger.isConnected) trigger.focus({ preventScroll: true });
    }
    this.options.onOpenChange(open);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortController.abort();
    if (this.openState) this.setOpen(false);
    else this.syncClosedAccessibility();
  }

  private bindControls(): void {
    const { document, elements } = this.options;
    const signal = this.abortController.signal;
    elements.trigger.addEventListener("click", () => this.toggle(), { signal });
    elements.closeButton.addEventListener("click", () => this.closeAndRestoreFocus(), { signal });
    for (const input of [
      elements.rulersInput,
      elements.gridInput,
      elements.snappingInput,
      this.symmetryEnabledInput,
      ...this.symmetryAxisInputs,
    ]) {
      input.addEventListener("change", () => this.handlePreferenceChange(), { signal });
    }
    this.symmetryOptionsButton.addEventListener("click", () => {
      this.setSymmetryOptionsOpen(this.symmetryOptionsPanel.hidden !== false);
    }, { signal });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !this.openState) return;
      event.preventDefault();
      this.closeAndRestoreFocus();
    }, { signal });
  }

  private closeAndRestoreFocus(): void {
    if (!this.openState) return;
    const { trigger, panel } = this.options.elements;
    const focusWasInside = panel.contains(this.options.document.activeElement);
    this.setOpen(false);
    if (!focusWasInside && trigger.isConnected) trigger.focus({ preventScroll: true });
  }

  private handlePreferenceChange(): void {
    const { elements } = this.options;
    this.preferencesState = {
      rulers: elements.rulersInput.checked,
      grid: elements.gridInput.checked,
      snapping: elements.snappingInput.checked,
      symmetryEnabled: this.symmetryEnabledInput.checked,
      symmetryAxis: this.selectedSymmetryAxis(),
    };
    const preferences = this.preferences;
    this.options.onPreferencesChange(preferences);
    saveEditorGuidePreferences(this.options.storage, preferences);
  }

  private syncInputs(): void {
    const { elements } = this.options;
    elements.rulersInput.checked = this.preferencesState.rulers;
    elements.gridInput.checked = this.preferencesState.grid;
    elements.snappingInput.checked = this.preferencesState.snapping;
    this.symmetryEnabledInput.checked = this.preferencesState.symmetryEnabled;
    for (const input of this.symmetryAxisInputs) {
      input.checked = input.value === this.preferencesState.symmetryAxis;
    }
  }

  private selectedSymmetryAxis(): EditorSymmetryAxis {
    const selected = this.symmetryAxisInputs.find((input) => input.checked)?.value;
    return selected === "horizontal" ? "horizontal" : "vertical";
  }

  private setSymmetryOptionsOpen(open: boolean): void {
    this.symmetryOptionsButton.setAttribute("aria-expanded", String(open));
    this.symmetryOptionsPanel.hidden = !open;
    this.symmetryOptionsPanel.setAttribute("aria-hidden", String(!open));
  }

  private syncClosedAccessibility(): void {
    const { trigger, panel } = this.options.elements;
    this.openState = false;
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-label", "Open settings");
    panel.classList.remove("is-open");
    panel.setAttribute("aria-hidden", "true");
    panel.setAttribute("inert", "");
  }
}
