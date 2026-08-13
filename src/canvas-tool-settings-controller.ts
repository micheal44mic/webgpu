import type { SelectionCombineMode, SelectionMethod } from "./selection-core";

export interface FillToolSettingsSnapshot {
  readonly tolerance: number;
}

export interface SelectionToolSettingsSnapshot {
  readonly method: SelectionMethod;
  readonly tolerance: number;
  readonly color: string;
  readonly combineMode: SelectionCombineMode;
}

function clamp(value: number, minimum: number, maximum: number): number {
  const finite = Number.isFinite(value) ? value : minimum;
  return Math.min(maximum, Math.max(minimum, finite));
}

function normalizeColor(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : "#ff5b35";
}

/**
 * Owns the non-brush canvas-tool settings used by every UI surface.
 * Rendering operations consume snapshots instead of reading hidden controls.
 */
export class CanvasToolSettingsController {
  private fill: FillToolSettingsSnapshot = { tolerance: 10 };
  private selection: SelectionToolSettingsSnapshot = {
    method: "magic-wand",
    tolerance: 32,
    color: "#ff5b35",
    combineMode: "replace",
  };

  fillSnapshot(): FillToolSettingsSnapshot {
    return { ...this.fill };
  }

  setFillTolerance(tolerance: number): FillToolSettingsSnapshot {
    this.fill = { tolerance: clamp(tolerance, 0, 100) };
    return this.fillSnapshot();
  }

  selectionSnapshot(): SelectionToolSettingsSnapshot {
    return { ...this.selection };
  }

  setSelectionMethod(method: SelectionMethod): SelectionToolSettingsSnapshot {
    this.selection = { ...this.selection, method };
    return this.selectionSnapshot();
  }

  setSelectionTolerance(tolerance: number): SelectionToolSettingsSnapshot {
    this.selection = { ...this.selection, tolerance: Math.round(clamp(tolerance, 0, 255)) };
    return this.selectionSnapshot();
  }

  setSelectionColor(color: string): SelectionToolSettingsSnapshot {
    this.selection = { ...this.selection, color: normalizeColor(color) };
    return this.selectionSnapshot();
  }

  setSelectionCombineMode(
    combineMode: SelectionCombineMode,
  ): SelectionToolSettingsSnapshot {
    this.selection = { ...this.selection, combineMode };
    return this.selectionSnapshot();
  }
}
