import {
  type BrushSettings,
  type BrushTool,
} from "./engine-types";

export type BrushQuickControlKind = "size" | "opacity" | "stretch" | "paint" | "blur";

export interface BrushSettingsPort {
  getSettings(): BrushSettings;
  setBrushSettings(next: Partial<BrushSettings>): void;
}

export interface BrushQuickControlSnapshot {
  readonly value: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly percent: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  const finite = Number.isFinite(value) ? value : minimum;
  return Math.min(maximum, Math.max(minimum, finite));
}

/**
 * Owns the editor-facing brush state. The rendering engine remains the
 * normalization authority, while UI surfaces consume snapshots and commands
 * instead of using hidden form controls as a shared state bus.
 */
export class BrushSettingsController {
  private settings: BrushSettings;

  constructor(private readonly port: BrushSettingsPort) {
    this.settings = port.getSettings();
  }

  snapshot(): BrushSettings {
    return { ...this.settings };
  }

  adoptPortState(): BrushSettings {
    this.settings = this.port.getSettings();
    return this.snapshot();
  }

  replace(settings: Readonly<BrushSettings>): BrushSettings {
    this.port.setBrushSettings(settings);
    return this.adoptPortState();
  }

  update(patch: Partial<BrushSettings>): BrushSettings {
    this.port.setBrushSettings(patch);
    return this.adoptPortState();
  }

  selectTool(tool: BrushTool, _restoreSnapshot: boolean): BrushSettings {
    // Tool switches must preserve the active Brush Studio definition. Paint,
    // Eraser and Blend share one tip; only the operation changes.
    return this.update({
      tool,
      ...(tool === "blend" ? {} : { hardness: 1 }),
    });
  }

  quickControl(kind: BrushQuickControlKind): BrushQuickControlSnapshot {
    const settings = this.settings;
    const minimum = kind === "size" ? 1 : 0;
    const maximum = kind === "size" ? 1000 : 100;
    const value = kind === "size"
      ? clamp(settings.size, minimum, maximum)
      : kind === "opacity"
        ? clamp(settings.opacity * 100, minimum, maximum)
        : kind === "stretch"
          ? clamp(settings.blendStretch * 100, minimum, maximum)
          : kind === "paint"
            ? clamp(settings.blendPaint * 100, minimum, maximum)
            : clamp(settings.blendBlur * 100, minimum, maximum);
    return {
      value,
      minimum,
      maximum,
      percent: (value - minimum) / (maximum - minimum) * 100,
    };
  }

  setQuickControl(kind: BrushQuickControlKind, requested: number): BrushSettings {
    const { minimum, maximum } = this.quickControl(kind);
    const value = clamp(requested, minimum, maximum);
    if (kind === "size") return this.update({ size: Math.round(value) });
    const normalized = Math.round(value * 10) / 1_000;
    if (kind === "opacity") return this.update({ opacity: normalized });
    if (kind === "stretch") return this.update({ blendStretch: normalized });
    if (kind === "paint") return this.update({ blendPaint: normalized });
    return this.update({ blendBlur: normalized });
  }
}
