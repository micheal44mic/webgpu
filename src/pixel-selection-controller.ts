import type { SelectionToolSettingsSnapshot } from "./canvas-tool-settings-controller.ts";

export interface PixelSelectionEnginePort {
  selectPixelsByColor(
    color: string,
    tolerance: number,
    combineMode: SelectionToolSettingsSnapshot["combineMode"],
  ): Promise<unknown>;
  previewPixelsByColor(
    color: string,
    tolerance: number,
    combineMode: SelectionToolSettingsSnapshot["combineMode"],
  ): Promise<unknown>;
  finishColorRangeSelectionPreview(): void;
  invertPixelSelection(): Promise<unknown>;
  clearPixelSelection(): Promise<unknown>;
}

export interface PixelSelectionControllerOptions {
  readonly engine: PixelSelectionEnginePort;
  readonly isEngineReady: () => boolean;
  readonly getActiveTool: () => string;
  readonly getSelectionSettings: () => SelectionToolSettingsSnapshot;
  readonly onBusyChange: () => void;
  readonly onSettled: () => void;
  readonly onError: (error: unknown) => void;
}

/**
 * Serializes pixel-selection commands shared by canvas input and visible UI.
 * Selection state remains authoritative in the engine; this controller owns
 * only the short-lived UI transaction lock.
 */
export class PixelSelectionController {
  private readonly options: PixelSelectionControllerOptions;
  private busyState = false;
  private colorPreviewRequested = false;
  private colorPreviewRunning = false;
  private colorPreviewActive = false;
  private colorPreviewPromise: Promise<void> | null = null;

  constructor(options: PixelSelectionControllerOptions) {
    this.options = options;
  }

  get isBusy(): boolean {
    return this.busyState || this.colorPreviewRunning;
  }

  get isColorRangePreviewBusy(): boolean {
    return this.colorPreviewRunning;
  }

  async run(operation: () => Promise<unknown>): Promise<boolean> {
    if (!this.options.isEngineReady() || this.isBusy) return false;
    this.busyState = true;
    this.options.onBusyChange();
    try {
      await operation();
      return true;
    } catch (error) {
      this.options.onError(error);
      return false;
    } finally {
      this.busyState = false;
      this.options.onSettled();
      this.options.onBusyChange();
    }
  }

  async applyColorRange(): Promise<boolean> {
    await this.finishColorRangePreview();
    if (this.options.getActiveTool() !== "selection") return Promise.resolve(false);
    const selection = this.options.getSelectionSettings();
    if (selection.method !== "color-range") return Promise.resolve(false);
    return this.run(() => this.options.engine.selectPixelsByColor(
      selection.color,
      selection.tolerance,
      selection.combineMode,
    ));
  }

  requestColorRangePreview(): boolean {
    if (
      !this.options.isEngineReady()
      || this.busyState
      || this.options.getActiveTool() !== "selection"
      || this.options.getSelectionSettings().method !== "color-range"
    ) {
      return false;
    }
    this.colorPreviewRequested = true;
    this.ensureColorPreviewDrain();
    return true;
  }

  async finishColorRangePreview(): Promise<void> {
    while (this.colorPreviewPromise) {
      await this.colorPreviewPromise;
    }
    if (!this.colorPreviewActive) return;
    this.options.engine.finishColorRangeSelectionPreview();
    this.colorPreviewActive = false;
    this.options.onSettled();
  }

  async invert(): Promise<boolean> {
    await this.finishColorRangePreview();
    return this.run(() => this.options.engine.invertPixelSelection());
  }

  async clear(): Promise<boolean> {
    await this.finishColorRangePreview();
    return this.run(() => this.options.engine.clearPixelSelection());
  }

  dispose(): void {
    this.colorPreviewRequested = false;
    if (this.colorPreviewActive) {
      this.options.engine.finishColorRangeSelectionPreview();
      this.colorPreviewActive = false;
    }
  }

  private ensureColorPreviewDrain(): void {
    if (this.colorPreviewPromise) return;
    this.colorPreviewPromise = this.drainColorPreview().finally(() => {
      this.colorPreviewPromise = null;
      if (this.colorPreviewRequested) this.ensureColorPreviewDrain();
    });
  }

  private async drainColorPreview(): Promise<void> {
    this.colorPreviewRunning = true;
    this.options.onBusyChange();
    try {
      while (this.colorPreviewRequested) {
        this.colorPreviewRequested = false;
        if (
          !this.options.isEngineReady()
          || this.options.getActiveTool() !== "selection"
        ) {
          break;
        }
        const selection = this.options.getSelectionSettings();
        if (selection.method !== "color-range") break;
        this.colorPreviewActive = true;
        try {
          await this.options.engine.previewPixelsByColor(
            selection.color,
            selection.tolerance,
            selection.combineMode,
          );
        } catch (error) {
          this.options.engine.finishColorRangeSelectionPreview();
          this.colorPreviewActive = false;
          this.colorPreviewRequested = false;
          this.options.onError(error);
          break;
        }
      }
    } finally {
      this.colorPreviewRunning = false;
      this.options.onSettled();
      this.options.onBusyChange();
    }
  }
}
