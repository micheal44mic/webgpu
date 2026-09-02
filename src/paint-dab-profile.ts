import { enforceDirectDepositSettings } from "./direct-deposit-brush-core";
import type { BrushSettings, PaintDabProfile } from "./engine-types";

/** Profiles that accumulate per-dab optical depth before one encoded resolve. */
export function usesOpticalDepthPaintDabProfile(profile: PaintDabProfile): boolean {
  return profile === "direct-deposit-pressure-size";
}

/** Main editor profile whose permanent raster layers are encoded-sRGB RGBA8. */
export function usesEncodedSrgbRgba8PaintDabProfile(profile: PaintDabProfile): boolean {
  return profile === "encoded-srgb-rgba8";
}

/** The isolated experiment also owns a pressure-sized spacing geometry. */
export function usesDirectPressureSizePaintDabProfile(profile: PaintDabProfile): boolean {
  return profile === "direct-deposit-pressure-size";
}

/**
 * Applies only the rendering constraints required by each profile. The main
 * encoded-sRGB path deliberately preserves authored Shape, Grain, spacing,
 * count, scatter, taper, stabilization and positional dynamics.
 */
export function normalizePaintDabProfileSettings(
  profile: PaintDabProfile,
  settings: BrushSettings,
): BrushSettings {
  if (profile === "direct-deposit-pressure-size") {
    return enforceDirectDepositSettings(settings);
  }
  if (profile !== "encoded-srgb-rgba8" || settings.tool !== "paint") {
    return settings;
  }
  return {
    ...settings,
    shapeMaskFormat: "r16float",
  };
}
