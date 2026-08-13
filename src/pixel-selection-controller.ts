import type { SelectionToolSettingsSnapshot } from "./canvas-tool-settings-controller.ts";

export interface PixelSelectionEnginePort {
  selectPixelsByColor(
    color: string,
    tolerance: number,
    combineMode: SelectionToolSettingsSnapshot["combineMode"],
  ): Promise<unknown>;
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

  constructor(options: PixelSelectionControllerOptions) {
    this.options = options;
  }

  get isBusy(): boolean {
    return this.busyState;
  }

  async run(operation: () => Promise<unknown>): Promise<boolean> {
    if (!this.options.isEngineReady() || this.busyState) return false;
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

  applyColorRange(): Promise<boolean> {
    if (this.options.getActiveTool() !== "selection") return Promise.resolve(false);
    const selection = this.options.getSelectionSettings();
    if (selection.method !== "color-range") return Promise.resolve(false);
    return this.run(() => this.options.engine.selectPixelsByColor(
      selection.color,
      selection.tolerance,
      selection.combineMode,
    ));
  }

  clear(): Promise<boolean> {
    return this.run(() => this.options.engine.clearPixelSelection());
  }
}
