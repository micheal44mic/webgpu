export const RUWA_WET_MIX_REVISION = 2 as const;

export const RUWA_WET_MIX_STRATEGY =
  "ruwa-distance-normalized-spatial-reservoir32-srgb-webgpu-v1" as const;

export type WetPresetId =
  | "off"
  | "ruwa-wet-1"
  | "ruwa-wet-2"
  | "ruwa-wet-3"
  | "custom";

export interface RuwaWetParameters {
  wetBlending: number;
  wetDilution: number;
  wetSpread: number;
  wetLength: number;
  wetFlow: number;
  wetBuildup: number;
  wetDrying: number;
}

export const DEFAULT_RUWA_WET_PARAMETERS: Readonly<RuwaWetParameters> = Object.freeze({
  wetBlending: 0,
  wetDilution: 0,
  wetSpread: 0,
  wetLength: 0.5,
  wetFlow: 0.75,
  wetBuildup: 0,
  wetDrying: 0,
});

/**
 * These are the seven Mixing values embedded in Ruwa's bundled
 * `Wet Brushes.rbf` at release 0.2.7-alpha. Shape, spacing, hardness and the
 * ordinary Flow control deliberately remain owned by this application's brush.
 */
export const RUWA_WET_PRESETS: Readonly<
  Record<Exclude<WetPresetId, "off" | "custom">, Readonly<RuwaWetParameters>>
> = Object.freeze({
  "ruwa-wet-1": Object.freeze({
    wetBlending: 1,
    wetDilution: 0,
    wetSpread: 0.3,
    wetLength: 0.62,
    wetFlow: 1,
    wetBuildup: 0,
    wetDrying: 0,
  }),
  "ruwa-wet-2": Object.freeze({
    wetBlending: 1,
    wetDilution: 0,
    wetSpread: 0.41,
    wetLength: 0.25,
    wetFlow: 1,
    wetBuildup: 0,
    wetDrying: 0,
  }),
  "ruwa-wet-3": Object.freeze({
    wetBlending: 0.27,
    wetDilution: 0,
    wetSpread: 0.26,
    wetLength: 0.78,
    wetFlow: 0.75,
    wetBuildup: 0,
    wetDrying: 0,
  }),
});

export const RUWA_WET_PARAMETER_KEYS = [
  "wetBlending",
  "wetDilution",
  "wetSpread",
  "wetLength",
  "wetFlow",
  "wetBuildup",
  "wetDrying",
] as const satisfies readonly (keyof RuwaWetParameters)[];

export function isWetPresetId(value: unknown): value is WetPresetId {
  return value === "off"
    || value === "ruwa-wet-1"
    || value === "ruwa-wet-2"
    || value === "ruwa-wet-3"
    || value === "custom";
}

export function wetPresetParameters(
  presetId: WetPresetId,
): Readonly<RuwaWetParameters> | null {
  return presetId === "ruwa-wet-1"
      || presetId === "ruwa-wet-2"
      || presetId === "ruwa-wet-3"
    ? RUWA_WET_PRESETS[presetId]
    : null;
}

export function normalizeRuwaWetParameter(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Math.min(1, Math.max(0, fallback));
  }
  return Math.min(1, Math.max(0, numeric));
}

/**
 * Converts a rate defined per half-radius of travel into the rate for this
 * physical dab. The clamp at sixteen reference intervals prevents precision
 * loss after long off-canvas jumps while preserving the limiting value.
 */
export function ruwaWetRatePerDab(
  rate: number,
  distancePixels: number,
  radiusPixels: number,
): number {
  const normalizedRate = normalizeRuwaWetParameter(rate);
  if (normalizedRate <= 0) {
    return 0;
  }
  if (normalizedRate >= 1) {
    return 1;
  }
  const referenceDistance = Math.max(0.5 * Math.max(0, radiusPixels), 1);
  const travel = Math.min(
    Math.max(0, Number.isFinite(distancePixels) ? distancePixels : 0)
      / referenceDistance,
    16,
  );
  return 1 - (1 - normalizedRate) ** travel;
}

export function ruwaWetBuildupCoatPerDab(
  buildup: number,
  distancePixels: number,
  baseRadiusPixels: number,
): number {
  const normalizedBuildup = normalizeRuwaWetParameter(buildup);
  if (normalizedBuildup <= 0.001) {
    return 0;
  }
  const body = 1 - 0.85 * normalizedBuildup;
  const ratePerHalfRadius = 1 - (1 - body) ** 0.25;
  return ruwaWetRatePerDab(
    ratePerHalfRadius,
    distancePixels,
    baseRadiusPixels,
  );
}
