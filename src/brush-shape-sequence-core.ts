/** Fixed upper bound shared by settings validation and GPU texture arrays. */
export const MAX_BRUSH_SHAPE_SEQUENCE_LENGTH = 4 as const;

export type BrushShapeSequenceMode = "ordered" | "random";

export function shapeLayerForStamp(
  mode: BrushShapeSequenceMode,
  ordinal: number,
  seed: number,
  layerCount: number,
): number {
  const count = Math.max(1, Math.min(MAX_BRUSH_SHAPE_SEQUENCE_LENGTH, Math.trunc(layerCount)));
  const stableOrdinal = Math.max(0, Math.trunc(ordinal));
  if (count === 1 || mode !== "random") return stableOrdinal % count;
  let value = (seed ^ 0x68bc21eb) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d) >>> 0;
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b) >>> 0;
  value ^= value >>> 16;
  return (value >>> 0) % count;
}
