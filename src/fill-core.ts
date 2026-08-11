/**
 * Contratto puro del riempimento connesso. Il renderer usa blocchi 16x16 e
 * conserva la selezione come bitmask: un intero layer occupa
 * `LAYER_SIZE² / 8` byte, cioe' 2 MiB a 4096² e 512 KiB a 2048².
 */
import {
  DOCUMENT_TILE_GRID_SIZE,
  DOCUMENT_TILE_MASK_WORDS,
  DOCUMENT_TILE_SIZE,
  LAYER_SIZE,
} from "./engine-limits.ts";
import type { DirtyRect } from "./engine-stroke-types";

export const GPU_FILL_STRATEGY =
  "webgpu-hierarchical-ccl-4-connected-straight-srgb-alpha-history1-render8-v3" as const;

export const FILL_RENDER_MASK_STRATEGY =
  "history-1bit-compute-expanded-low8-reused-label-buffer-v1" as const;

export const FILL_REFERENCE_LAYER_STRATEGY =
  "single-raster-reference-full-resident-gpu-source-separate-active-target-no-fallback-v1" as const;

export const FILL_LAYER_SIZE = LAYER_SIZE;
export const FILL_BLOCK_SIZE = 16;
export const FILL_BLOCK_GRID_SIZE = FILL_LAYER_SIZE / FILL_BLOCK_SIZE;
export const FILL_BLOCK_COUNT = FILL_BLOCK_GRID_SIZE * FILL_BLOCK_GRID_SIZE;
export const FILL_PIXELS_PER_BLOCK = FILL_BLOCK_SIZE * FILL_BLOCK_SIZE;
export const FILL_MAX_COMPONENTS_PER_BLOCK = FILL_PIXELS_PER_BLOCK / 2;
export const FILL_LABEL_WORDS_PER_BLOCK = FILL_PIXELS_PER_BLOCK / 4;
export const FILL_LABEL_BUFFER_BYTES = FILL_BLOCK_COUNT * FILL_LABEL_WORDS_PER_BLOCK * 4;
export const FILL_PARENT_COUNT = FILL_BLOCK_COUNT * FILL_MAX_COMPONENTS_PER_BLOCK;
export const FILL_PARENT_BUFFER_BYTES = FILL_PARENT_COUNT * 4;
export const FILL_ACTIVE_NODE_BUFFER_BYTES = FILL_BLOCK_COUNT * 4;
export const FILL_ACTIVE_BLOCK_BUFFER_BYTES = FILL_BLOCK_COUNT * 4;
export const FILL_HISTORY_MASK_BYTES = FILL_LAYER_SIZE * FILL_LAYER_SIZE / 8;
export const FILL_HISTORY_MASK_WORDS = FILL_HISTORY_MASK_BYTES / 4;
/**
 * The authoritative/History mask remains 1 bit per pixel. For the render pass
 * it is expanded after CCL to four low-byte u32 words per source word. This
 * avoids bit 31 in fragment shaders on affected ARM Valhall drivers while
 * reusing packedLabels, whose classification data is dead after selection.
 */
export const FILL_RENDER_MASK_PIXELS_PER_WORD = 8;
export const FILL_RENDER_MASK_WORDS =
  FILL_LAYER_SIZE * FILL_LAYER_SIZE / FILL_RENDER_MASK_PIXELS_PER_WORD;
export const FILL_RENDER_MASK_BYTES = FILL_RENDER_MASK_WORDS * 4;
export const FILL_UNIFORM_BYTES = 48;
export const FILL_UNIFORM_BUFFER_BYTES = 256;
export const FILL_METADATA_WORDS = 16;
export const FILL_METADATA_BYTES = FILL_METADATA_WORDS * 4;
export const FILL_METADATA_BUFFER_BYTES = 256;
export const FILL_INDIRECT_BUFFER_BYTES = 16;
export const FILL_WORKGROUP_STORAGE_BYTES = 9_232;

export const FILL_META_SELECTED_PIXELS = 0;
export const FILL_META_MIN_X = 1;
export const FILL_META_MIN_Y = 2;
export const FILL_META_MAX_X = 3;
export const FILL_META_MAX_Y = 4;
export const FILL_META_ACTIVE_COMPONENTS = 5;
export const FILL_META_ACTIVE_BLOCKS = 6;
export const FILL_META_DIAGNOSTIC = 7;
export const FILL_META_TILE_MASK_START = 8;
export const FILL_TILE_MASK_WORDS = DOCUMENT_TILE_MASK_WORDS;

// La maschera tile prodotta dal Riempimento e' la stessa griglia 16×16 del cold
// storage e della Selezione: a 2048² il tile e' 128 px e vale 8 blocchi, non 16.
export const FILL_TILE_GRID_SIZE = DOCUMENT_TILE_GRID_SIZE;
export const FILL_TILE_SIZE = DOCUMENT_TILE_SIZE;
export const FILL_BLOCKS_PER_TILE = FILL_TILE_SIZE / FILL_BLOCK_SIZE;

/** Procreate salva 100% come soglia effettiva 97,6%; manteniamo lo stesso cap. */
export const FILL_MAX_TOLERANCE_PERCENT = 97.6;

export const FILL_RESIDENT_SCRATCH_BYTES =
  FILL_LABEL_BUFFER_BYTES
  + FILL_PARENT_BUFFER_BYTES
  + FILL_ACTIVE_NODE_BUFFER_BYTES
  + FILL_HISTORY_MASK_BYTES
  + FILL_ACTIVE_BLOCK_BUFFER_BYTES
  + FILL_METADATA_BUFFER_BYTES
  + FILL_INDIRECT_BUFFER_BYTES
  + FILL_UNIFORM_BUFFER_BYTES
  + FILL_METADATA_BUFFER_BYTES;

export interface FillAnalysis {
  readonly selectedPixels: number;
  readonly activeComponents: number;
  readonly activeBlocks: number;
  readonly activeTiles: number;
  readonly bounds: DirtyRect;
  readonly tileMask: Uint32Array;
  /** Include il completamento FIFO della queue e il risveglio della callback JS. */
  readonly queueCompletionMs: number;
}

export function countFillTiles(mask: Uint32Array): number {
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

export function normalizeFillTolerance(percent: number): number {
  if (!Number.isFinite(percent)) {
    throw new RangeError("La tolleranza del riempimento deve essere finita.");
  }
  return Math.min(FILL_MAX_TOLERANCE_PERCENT, Math.max(0, percent)) / 100;
}

export function srgbChannelToLinear(value: number): number {
  const normalized = Math.min(1, Math.max(0, value));
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function hexToLinearFillColor(hex: string): readonly [number, number, number, 1] {
  const normalized = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new Error(`Colore HEX del riempimento non valido: ${hex}`);
  }
  return [
    srgbChannelToLinear(Number.parseInt(normalized.slice(0, 2), 16) / 255),
    srgbChannelToLinear(Number.parseInt(normalized.slice(2, 4), 16) / 255),
    srgbChannelToLinear(Number.parseInt(normalized.slice(4, 6), 16) / 255),
    1,
  ];
}

/** Riferimento CPU usato soltanto dalle regressioni del contratto colore. */
export function premultipliedLinearToStraightSrgb(
  value: readonly [number, number, number, number],
): readonly [number, number, number, number] {
  const alpha = Math.min(1, Math.max(0, value[3]));
  const inverseAlpha = alpha > 1e-6 ? 1 / alpha : 0;
  const linearToSrgb = (channel: number): number => {
    const normalized = Math.min(1, Math.max(0, channel * inverseAlpha));
    return normalized <= 0.0031308
      ? 12.92 * normalized
      : 1.055 * normalized ** (1 / 2.4) - 0.055;
  };
  return [
    linearToSrgb(value[0]),
    linearToSrgb(value[1]),
    linearToSrgb(value[2]),
    alpha,
  ];
}

export function fillColorsMatch(
  left: readonly [number, number, number, number],
  right: readonly [number, number, number, number],
  tolerancePercent: number,
): boolean {
  const a = premultipliedLinearToStraightSrgb(left);
  const b = premultipliedLinearToStraightSrgb(right);
  const tolerance = normalizeFillTolerance(tolerancePercent);
  return Math.max(...a.map((channel, index) => Math.abs(channel - b[index])))
    <= tolerance + 1e-7;
}
