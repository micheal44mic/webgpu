import type { BrushSettings } from "./engine-types";

/**
 * Product-neutral spacing curve for a dense, direct-deposit round brush.
 *
 * Small tips need wider relative spacing to avoid turning every movement into
 * a fully opaque line. Large tips use tighter relative spacing so low deposit
 * values build a continuous core. Values are expressed against the effective
 * pressure-scaled diameter.
 */
const SPACING_PERCENT_BY_DIAMETER = Object.freeze([
  [1, 50],
  [4, 42.5],
  [16, 23.3333333333],
  [28, 13.3333333333],
  [60, 10],
  [100, 9],
  [200, 6.6666666667],
] as const);

const clampUnit = (value: number): number => Math.max(0, Math.min(1, value));

export function directDepositSpacingPercent(diameter: number): number {
  const normalizedDiameter = Math.max(1, Number.isFinite(diameter) ? diameter : 1);
  const first = SPACING_PERCENT_BY_DIAMETER[0];
  if (normalizedDiameter <= first[0]) return first[1];

  for (let index = 1; index < SPACING_PERCENT_BY_DIAMETER.length; index += 1) {
    const lower = SPACING_PERCENT_BY_DIAMETER[index - 1];
    const upper = SPACING_PERCENT_BY_DIAMETER[index];
    if (normalizedDiameter > upper[0]) continue;
    const interpolation = clampUnit(
      (normalizedDiameter - lower[0]) / (upper[0] - lower[0]),
    );
    return lower[1] + (upper[1] - lower[1]) * interpolation;
  }

  return SPACING_PERCENT_BY_DIAMETER[SPACING_PERCENT_BY_DIAMETER.length - 1][1];
}

export function directDepositEffectiveDiameter(
  authoredDiameter: number,
  pressure: number,
): number {
  const diameter = Math.max(1, Number.isFinite(authoredDiameter) ? authoredDiameter : 1);
  const normalizedPressure = Math.max(0.01, clampUnit(
    Number.isFinite(pressure) ? pressure : 1,
  ));
  return Math.max(1, diameter * normalizedPressure);
}

export function directDepositSpacingDistance(
  authoredDiameter: number,
  pressure: number,
): number {
  const effectiveDiameter = directDepositEffectiveDiameter(authoredDiameter, pressure);
  return Math.max(
    0.1,
    effectiveDiameter * directDepositSpacingPercent(effectiveDiameter) / 100,
  );
}

export function directDepositBaseRadius(
  authoredDiameter: number,
  pressure: number,
): number {
  return Math.max(0.5, directDepositEffectiveDiameter(authoredDiameter, pressure) * 0.5);
}

/** One controlled paint brush used by the isolated RGBA8 experiment. */
export function directDepositReferenceSettings(base: BrushSettings): BrushSettings {
  const size = 96;
  return {
    ...base,
    tool: "paint",
    color: "#000000",
    tipFalloff: "standard",
    shapeScatter: 0,
    // The authored mask is 8-bit, but filtering stays continuous after upload.
    // Quantizing every bilinear sample again would create visible contour bands.
    shapeMaskFormat: "r16float",
    grainMode: "off",
    size,
    spacingPercent: directDepositSpacingPercent(size),
    stabilization: 0,
    startThickness: 1,
    endThickness: 1,
    count: 1,
    flow: 0.06,
    opacity: 1,
    hardness: 1,
    blendIntensity: 1,
    // The isolated profile routes this mode to an R16F optical-depth scratch;
    // the authoritative document remains RGBA8.
    blendMode: "light-glaze",
    hueJitterDegrees: 0,
    saturationJitter: 0,
    lightnessJitter: 0,
    darknessJitter: 0,
    positionJitterLateral: 0,
    positionJitterLinear: 0,
  };
}

/**
 * Keeps the experiment unambiguous while still allowing size, color and the
 * per-dab deposit to be changed through the normal editor controls.
 */
export function enforceDirectDepositSettings(settings: BrushSettings): BrushSettings {
  if (settings.tool !== "paint") return settings;
  return {
    ...settings,
    tipFalloff: settings.tipFalloff === "gaussian" ? "gaussian" : "standard",
    shapeScatter: 0,
    shapeMaskFormat: "r16float",
    grainMode: "off",
    spacingPercent: directDepositSpacingPercent(settings.size),
    stabilization: 0,
    startThickness: 1,
    endThickness: 1,
    count: 1,
    opacity: 1,
    hardness: 1,
    blendMode: "light-glaze",
    hueJitterDegrees: 0,
    saturationJitter: 0,
    lightnessJitter: 0,
    darknessJitter: 0,
    positionJitterLateral: 0,
    positionJitterLinear: 0,
  };
}
