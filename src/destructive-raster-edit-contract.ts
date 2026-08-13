import {
  DESTRUCTIVE_RASTER_ADJUSTMENT_KINDS,
  type DestructiveRasterAdjustmentKind,
} from "./raster-effects-contract.ts";

export const DESTRUCTIVE_RASTER_EDIT_KINDS = [
  "transform",
  ...DESTRUCTIVE_RASTER_ADJUSTMENT_KINDS,
] as const;

export type DestructiveRasterEditKind =
  | "transform"
  | DestructiveRasterAdjustmentKind;

const DESTRUCTIVE_RASTER_EDIT_LABELS = {
  transform: "Trasforma",
  liquify: "Liquify",
  "gaussian-blur": "Gaussian Blur",
  "motion-blur": "Motion Blur",
  noise: "Noise",
} as const satisfies Readonly<Record<DestructiveRasterEditKind, string>>;

export function destructiveRasterEditLabel(
  kind: DestructiveRasterEditKind,
): string {
  return DESTRUCTIVE_RASTER_EDIT_LABELS[kind];
}
