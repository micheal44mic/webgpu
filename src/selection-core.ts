import { LAYER_SIZE } from "./engine-limits.ts";
import type { DirtyRect } from "./engine-stroke-types.ts";

export const PIXEL_SELECTION_MASK_STRATEGY =
  "document-wide-gpu-r32-bitmask-replace-add-subtract-v1" as const;
export const MAGIC_WAND_SELECTION_STRATEGY =
  "fill-ccl-reused-4-connected-straight-srgb-alpha-v1" as const;
export const COLOR_RANGE_SELECTION_STRATEGY =
  "global-straight-srgb-alpha-max-channel-range-v1" as const;
export const LASSO_SELECTION_STRATEGY =
  "cpu-even-odd-pixel-center-spans-gpu-bitmask-v1" as const;
export const SELECTION_OVERLAY_STRATEGY =
  "separate-transparent-webgpu-mask-overlay-v1" as const;

export type SelectionMethod = "magic-wand" | "lasso" | "color-range";
export type SelectionCombineMode = "replace" | "add" | "subtract";

export interface SelectionPoint {
  readonly x: number;
  readonly y: number;
}

export interface PixelSelectionState {
  readonly selectedPixels: number;
  readonly activeTiles: number;
  readonly bounds: DirtyRect | null;
  readonly revision: number;
}

export interface SelectionOperationResult extends PixelSelectionState {
  readonly method: SelectionMethod;
  readonly combineMode: SelectionCombineMode;
  /** Include il completamento FIFO della queue e il risveglio della callback JS. */
  readonly queueCompletionMs: number;
  readonly totalMs: number;
}

export interface LassoSpanRaster {
  /** Record u32 `y, startX, endXExclusive, 0`. */
  readonly packedSpans: Uint32Array;
  readonly spanCount: number;
  readonly pointCount: number;
  readonly bounds: DirtyRect | null;
}

export const SELECTION_LAYER_SIZE = LAYER_SIZE;
export const SELECTION_WORDS_PER_ROW = SELECTION_LAYER_SIZE / 32;
export const SELECTION_MASK_WORDS = SELECTION_WORDS_PER_ROW * SELECTION_LAYER_SIZE;
export const SELECTION_MASK_BYTES = SELECTION_MASK_WORDS * 4;
export const SELECTION_TILE_MASK_WORDS = 8;
export const SELECTION_TILE_GRID_SIZE = 16;
export const SELECTION_TILE_SIZE = SELECTION_LAYER_SIZE / SELECTION_TILE_GRID_SIZE;
export const SELECTION_METADATA_WORDS = 16;
export const SELECTION_METADATA_BYTES = SELECTION_METADATA_WORDS * 4;
export const SELECTION_METADATA_BUFFER_BYTES = 256;
export const SELECTION_OPERATION_UNIFORM_BYTES = 48;
export const SELECTION_OPERATION_UNIFORM_BUFFER_BYTES = 256;
export const SELECTION_OVERLAY_UNIFORM_BYTES = 48;
export const SELECTION_OVERLAY_UNIFORM_BUFFER_BYTES = 256;
export const SELECTION_LASSO_SPAN_WORDS = 4;
export const SELECTION_LASSO_SPAN_BYTES = SELECTION_LASSO_SPAN_WORDS * 4;
export const SELECTION_MAX_LASSO_POINTS = 8_192;
export const SELECTION_MAX_LASSO_SPANS = 65_536;
export const SELECTION_LASSO_SPAN_BUFFER_BYTES =
  SELECTION_MAX_LASSO_SPANS * SELECTION_LASSO_SPAN_BYTES;

export const SELECTION_META_SELECTED_PIXELS = 0;
export const SELECTION_META_MIN_X = 1;
export const SELECTION_META_MIN_Y = 2;
export const SELECTION_META_MAX_X = 3;
export const SELECTION_META_MAX_Y = 4;
export const SELECTION_META_TILE_MASK_START = 5;

export const SELECTION_RESIDENT_BUFFER_BYTES =
  SELECTION_MASK_BYTES * 2
  + SELECTION_LASSO_SPAN_BUFFER_BYTES
  + SELECTION_METADATA_BUFFER_BYTES
  + SELECTION_METADATA_BUFFER_BYTES
  + SELECTION_OPERATION_UNIFORM_BUFFER_BYTES
  + SELECTION_OVERLAY_UNIFORM_BUFFER_BYTES
  + SELECTION_LASSO_SPAN_BYTES;

export function emptyPixelSelectionState(revision = 0): PixelSelectionState {
  return {
    selectedPixels: 0,
    activeTiles: 0,
    bounds: null,
    revision,
  };
}

export function normalizeSelectionTolerance(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError("La tolleranza della selezione deve essere finita.");
  }
  return Math.min(255, Math.max(0, value)) / 255;
}

export function normalizeSelectionCombineMode(value: string): SelectionCombineMode {
  if (value === "replace" || value === "add" || value === "subtract") {
    return value;
  }
  throw new Error(`Modalità di combinazione selezione non valida: ${value}.`);
}

export function normalizeSelectionMethod(value: string): SelectionMethod {
  if (value === "magic-wand" || value === "lasso" || value === "color-range") {
    return value;
  }
  throw new Error(`Metodo di selezione non valido: ${value}.`);
}

export function selectionCombineModeCode(mode: SelectionCombineMode): number {
  return mode === "replace" ? 0 : mode === "add" ? 1 : 2;
}

export function selectionHexToStraightSrgb(
  hex: string,
): readonly [number, number, number, 1] {
  const normalized = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new Error(`Colore HEX della selezione non valido: ${hex}.`);
  }
  return [
    Number.parseInt(normalized.slice(0, 2), 16) / 255,
    Number.parseInt(normalized.slice(2, 4), 16) / 255,
    Number.parseInt(normalized.slice(4, 6), 16) / 255,
    1,
  ];
}

export function countSelectionTiles(mask: Uint32Array): number {
  let count = 0;
  for (const sourceWord of mask) {
    let word = sourceWord;
    while (word !== 0) {
      word &= word - 1;
      count += 1;
    }
  }
  return count;
}

function finiteLassoPoints(points: readonly SelectionPoint[]): SelectionPoint[] {
  if (points.length > SELECTION_MAX_LASSO_POINTS) {
    throw new RangeError(
      `Il lazo contiene ${points.length} punti; massimo ${SELECTION_MAX_LASSO_POINTS}.`,
    );
  }
  const result: SelectionPoint[] = [];
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new RangeError("Il lazo contiene coordinate non finite.");
    }
    const previous = result[result.length - 1];
    if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.01) {
      continue;
    }
    result.push({ x: point.x, y: point.y });
  }
  if (
    result.length > 1
    && Math.hypot(
      result[0].x - result[result.length - 1].x,
      result[0].y - result[result.length - 1].y,
    ) < 0.01
  ) {
    result.pop();
  }
  return result;
}

/**
 * Rasterizza il lazo con la regola even-odd sui centri dei pixel. La CPU crea
 * soltanto span geometrici; la maschera autorevole resta sempre sulla GPU.
 */
export function buildLassoSpans(
  sourcePoints: readonly SelectionPoint[],
  layerSize = SELECTION_LAYER_SIZE,
): LassoSpanRaster {
  if (!Number.isInteger(layerSize) || layerSize <= 0) {
    throw new RangeError("La dimensione raster del lazo deve essere un intero positivo.");
  }
  const points = finiteLassoPoints(sourcePoints);
  if (points.length < 3) {
    return { packedSpans: new Uint32Array(0), spanCount: 0, pointCount: points.length, bounds: null };
  }

  const intersectionsByRow = new Map<number, number[]>();
  let intersectionCount = 0;
  for (let index = 0; index < points.length; index += 1) {
    const first = points[index];
    const second = points[(index + 1) % points.length];
    if (Math.abs(first.y - second.y) < 1e-12) continue;
    const low = first.y < second.y ? first : second;
    const high = first.y < second.y ? second : first;
    const startY = Math.max(0, Math.ceil(low.y - 0.5));
    const endY = Math.min(layerSize, Math.ceil(high.y - 0.5));
    const inverseDy = 1 / (second.y - first.y);
    for (let y = startY; y < endY; y += 1) {
      const sampleY = y + 0.5;
      const x = first.x + (sampleY - first.y) * (second.x - first.x) * inverseDy;
      const row = intersectionsByRow.get(y);
      if (row) row.push(x);
      else intersectionsByRow.set(y, [x]);
      intersectionCount += 1;
      if (intersectionCount > SELECTION_MAX_LASSO_SPANS * 2) {
        throw new RangeError(
          `Il lazo supera ${SELECTION_MAX_LASSO_SPANS.toLocaleString("it-IT")} span raster.`,
        );
      }
    }
  }

  const packed: number[] = [];
  let minX = layerSize;
  let minY = layerSize;
  let maxX = 0;
  let maxY = 0;
  const rows = [...intersectionsByRow.keys()].sort((left, right) => left - right);
  for (const y of rows) {
    const intersections = intersectionsByRow.get(y)!;
    intersections.sort((left, right) => left - right);
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      const left = intersections[index];
      const right = intersections[index + 1];
      const startX = Math.max(0, Math.min(layerSize, Math.ceil(left - 0.5)));
      const endX = Math.max(0, Math.min(layerSize, Math.ceil(right - 0.5)));
      if (endX <= startX) continue;
      if (packed.length / SELECTION_LASSO_SPAN_WORDS >= SELECTION_MAX_LASSO_SPANS) {
        throw new RangeError(
          `Il lazo supera ${SELECTION_MAX_LASSO_SPANS.toLocaleString("it-IT")} span raster.`,
        );
      }
      packed.push(y, startX, endX, 0);
      minX = Math.min(minX, startX);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, endX);
      maxY = Math.max(maxY, y + 1);
    }
  }

  const spanCount = packed.length / SELECTION_LASSO_SPAN_WORDS;
  return {
    packedSpans: Uint32Array.from(packed),
    spanCount,
    pointCount: points.length,
    bounds: spanCount === 0
      ? null
      : { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  };
}
