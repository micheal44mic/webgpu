export const NON_DESTRUCTIVE_RASTER_EFFECT_KINDS = [
  "color-overlay",
  "stroke",
  "outer-shadow",
  "inner-shadow",
  "bevel",
] as const;

export type NonDestructiveRasterEffectKind =
  (typeof NON_DESTRUCTIVE_RASTER_EFFECT_KINDS)[number];

export const DESTRUCTIVE_RASTER_ADJUSTMENT_KINDS = [
  "liquify",
  "gaussian-blur",
  "motion-blur",
  "noise",
] as const;

export type DestructiveRasterAdjustmentKind =
  (typeof DESTRUCTIVE_RASTER_ADJUSTMENT_KINDS)[number];

export const RASTER_EFFECT_DOMAIN = Object.freeze({
  nonDestructive: {
    kinds: NON_DESTRUCTIVE_RASTER_EFFECT_KINDS,
    stateOwner: "layer-metadata",
    mutation: "re-renderable-style",
    historyScope: "raster-property",
  },
  destructive: {
    kinds: DESTRUCTIVE_RASTER_ADJUSTMENT_KINDS,
    stateOwner: "raster-adjustment-transaction",
    mutation: "baked-pixels",
    historyScope: "effect-transaction",
  },
} as const);

function includesValue<T extends string>(
  values: readonly T[],
  value: string | undefined,
): value is T {
  return value !== undefined && (values as readonly string[]).includes(value);
}

export function isNonDestructiveRasterEffectKind(
  value: string | undefined,
): value is NonDestructiveRasterEffectKind {
  return includesValue(NON_DESTRUCTIVE_RASTER_EFFECT_KINDS, value);
}

export function isDestructiveRasterAdjustmentKind(
  value: string | undefined,
): value is DestructiveRasterAdjustmentKind {
  return includesValue(DESTRUCTIVE_RASTER_ADJUSTMENT_KINDS, value);
}
