import {
  loadEditorGuidePreferences,
  normalizeBrushPrecision,
  normalizeSymmetryAngleDegrees,
  saveEditorGuidePreferences,
  type BrushPrecision,
  type EditorGuidePreferences,
  type EditorSettingsStoragePort,
} from "./editor-settings-storage.ts";

export interface EditorSettingsElements {
  readonly trigger: HTMLButtonElement;
  readonly panel: HTMLElement;
  readonly closeButton: HTMLButtonElement;
  readonly brushPrecisionButtons: readonly HTMLButtonElement[];
  readonly rulersInput: HTMLInputElement;
  readonly gridInput: HTMLInputElement;
  readonly pixelGridInput: HTMLInputElement;
  readonly snappingInput: HTMLInputElement;
  readonly symmetryEnabledInput: HTMLInputElement;
  readonly symmetryOptionsButton: HTMLButtonElement;
  readonly symmetryOptionsPanel: HTMLElement;
  readonly symmetryPresetButtons: readonly HTMLButtonElement[];
  readonly symmetryAngleInput: HTMLInputElement;
  readonly symmetryAngleValueInput: HTMLInputElement;
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

/** Owns the editor Settings surface and its locally persisted preferences. */
export class EditorSettingsController {
  private readonly options: EditorSettingsControllerOptions;
  private readonly abortController: AbortController;
  private readonly brushPrecisionButtons: readonly HTMLButtonElement[];
  private readonly symmetryEnabledInput: HTMLInputElement;
  private readonly symmetryOptionsButton: HTMLButtonElement;
  private readonly symmetryOptionsPanel: HTMLElement;
  private readonly symmetryPresetButtons: readonly HTMLButtonElement[];
  private readonly symmetryAngleInput: HTMLInputElement;
  private readonly symmetryAngleValueInput: HTMLInputElement;
  private openState = false;
  private preferencesState: EditorGuidePreferences;
  private disposed = false;

  constructor(options: EditorSettingsControllerOptions) {
    this.options = options;
    this.abortController = new options.browser.AbortController();
    this.brushPrecisionButtons = [...options.elements.brushPrecisionButtons];
    this.symmetryEnabledInput = options.elements.symmetryEnabledInput;
    this.symmetryOptionsButton = options.elements.symmetryOptionsButton;
    this.symmetryOptionsPanel = options.elements.symmetryOptionsPanel;
    this.symmetryPresetButtons = [...options.elements.symmetryPresetButtons];
    this.symmetryAngleInput = options.elements.symmetryAngleInput;
    this.symmetryAngleValueInput = options.elements.symmetryAngleValueInput;
    const brushPrecisions = this.brushPrecisionButtons.map((button) =>
      this.brushPrecision(button)
    );
    if (
      brushPrecisions.length !== 2
      || brushPrecisions.some((precision) => precision === null)
      || new Set(brushPrecisions).size !== 2
      || !brushPrecisions.includes("r8unorm")
      || !brushPrecisions.includes("r16float")
    ) {
      throw new Error("Brush precision controls are incomplete.");
    }
    if (
      !this.symmetryPresetButtons.some((button) => this.symmetryPresetAngle(button) === 90)
      || !this.symmetryPresetButtons.some((button) => this.symmetryPresetAngle(button) === 0)
    ) {
      throw new Error("Symmetry angle presets are incomplete.");
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
    for (const button of this.brushPrecisionButtons) {
      button.addEventListener("click", () => {
        const brushPrecision = this.brushPrecision(button);
        if (brushPrecision !== null) this.applyBrushPrecision(brushPrecision);
      }, { signal });
      button.addEventListener("keydown", (event) => {
        const key = event.key;
        if (
          key !== "ArrowLeft"
          && key !== "ArrowRight"
          && key !== "ArrowUp"
          && key !== "ArrowDown"
          && key !== "Home"
          && key !== "End"
        ) return;
        event.preventDefault();
        const currentIndex = this.brushPrecisionButtons.indexOf(button);
        const lastIndex = this.brushPrecisionButtons.length - 1;
        const nextIndex = key === "Home"
          ? 0
          : key === "End"
            ? lastIndex
            : key === "ArrowLeft" || key === "ArrowUp"
              ? (currentIndex - 1 + this.brushPrecisionButtons.length)
                % this.brushPrecisionButtons.length
              : (currentIndex + 1) % this.brushPrecisionButtons.length;
        const nextButton = this.brushPrecisionButtons[nextIndex];
        const brushPrecision = this.brushPrecision(nextButton);
        if (brushPrecision === null) return;
        this.applyBrushPrecision(brushPrecision);
        nextButton.focus({ preventScroll: true });
      }, { signal });
    }
    for (const input of [
      elements.rulersInput,
      elements.gridInput,
      elements.pixelGridInput,
      elements.snappingInput,
      this.symmetryEnabledInput,
    ]) {
      input.addEventListener("change", () => this.handlePreferenceChange(), { signal });
    }
    for (const button of this.symmetryPresetButtons) {
      button.addEventListener("click", () => {
        this.applySymmetryAngle(this.symmetryPresetAngle(button), true);
      }, { signal });
    }
    this.symmetryAngleInput.addEventListener("input", () => {
      this.applySymmetryAngle(Number(this.symmetryAngleInput.value), false);
    }, { signal });
    this.symmetryAngleInput.addEventListener("change", () => {
      this.persistPreferences();
    }, { signal });
    this.symmetryAngleValueInput.addEventListener("input", () => {
      const value = this.symmetryAngleValue();
      if (value !== null) this.applySymmetryAngle(value, false);
    }, { signal });
    this.symmetryAngleValueInput.addEventListener("change", () => {
      const value = this.symmetryAngleValue();
      if (value === null) this.syncSymmetryAngleControls();
      else this.applySymmetryAngle(value, true);
    }, { signal });
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
      pixelGrid: elements.pixelGridInput.checked,
      snapping: elements.snappingInput.checked,
      symmetryEnabled: this.symmetryEnabledInput.checked,
      symmetryAngleDegrees: this.preferencesState.symmetryAngleDegrees,
      brushPrecision: this.preferencesState.brushPrecision,
    };
    const preferences = this.preferences;
    this.options.onPreferencesChange(preferences);
    this.persistPreferences();
  }

  private syncInputs(): void {
    const { elements } = this.options;
    elements.rulersInput.checked = this.preferencesState.rulers;
    elements.gridInput.checked = this.preferencesState.grid;
    elements.pixelGridInput.checked = this.preferencesState.pixelGrid;
    elements.snappingInput.checked = this.preferencesState.snapping;
    this.symmetryEnabledInput.checked = this.preferencesState.symmetryEnabled;
    this.syncBrushPrecisionButtons();
    this.syncSymmetryAngleControls();
  }

  private brushPrecision(button: HTMLButtonElement): BrushPrecision | null {
    const value = button.getAttribute("data-editor-brush-precision");
    return value === "r8unorm" || value === "r16float" ? value : null;
  }

  private applyBrushPrecision(value: BrushPrecision): void {
    const brushPrecision = normalizeBrushPrecision(value);
    const changed = brushPrecision !== this.preferencesState.brushPrecision;
    if (!changed) return;
    const previousPreferences = this.preferencesState;
    this.preferencesState = {
      ...this.preferencesState,
      brushPrecision,
    };
    this.syncBrushPrecisionButtons();
    try {
      this.options.onPreferencesChange(this.preferences);
    } catch (error) {
      this.preferencesState = previousPreferences;
      this.syncBrushPrecisionButtons();
      throw error;
    }
    this.persistPreferences();
  }

  private syncBrushPrecisionButtons(): void {
    for (const button of this.brushPrecisionButtons) {
      const selected = this.brushPrecision(button) === this.preferencesState.brushPrecision;
      button.setAttribute("aria-checked", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
  }

  private symmetryPresetAngle(button: HTMLButtonElement): number {
    return Number(button.getAttribute("data-editor-symmetry-angle"));
  }

  private applySymmetryAngle(value: number, persist: boolean): void {
    const symmetryAngleDegrees = normalizeSymmetryAngleDegrees(
      value,
      this.preferencesState.symmetryAngleDegrees,
    );
    const changed = symmetryAngleDegrees !== this.preferencesState.symmetryAngleDegrees;
    this.preferencesState = {
      ...this.preferencesState,
      symmetryAngleDegrees,
    };
    this.syncSymmetryAngleControls();
    if (changed) this.options.onPreferencesChange(this.preferences);
    if (persist) this.persistPreferences();
  }

  private symmetryAngleValue(): number | null {
    if (this.symmetryAngleValueInput.value.trim() === "") return null;
    const value = Number(this.symmetryAngleValueInput.value);
    return Number.isFinite(value) ? value : null;
  }

  private syncSymmetryAngleControls(): void {
    const value = String(this.preferencesState.symmetryAngleDegrees);
    this.symmetryAngleInput.value = value;
    this.symmetryAngleValueInput.value = value;
    for (const button of this.symmetryPresetButtons) {
      button.setAttribute(
        "aria-pressed",
        String(this.symmetryPresetAngle(button) === this.preferencesState.symmetryAngleDegrees),
      );
    }
  }

  private persistPreferences(): void {
    saveEditorGuidePreferences(this.options.storage, this.preferencesState);
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
