/**
 * Contratto puro del riempimento connesso. Il renderer usa blocchi 16x16 e
 * conserva la selezione come bitmask: un intero layer occupa
 * `LAYER_SIZE² / 8` byte, cioe' 2 MiB a 4096² e 512 KiB a 2048².
 */
import {
  DOCUMENT_TILE_GRID_SIZE,
  DOCUMENT_TILE_HEIGHT,
  DOCUMENT_TILE_MASK_WORDS,
  DOCUMENT_TILE_WIDTH,
  DOCUMENT_HEIGHT,
  DOCUMENT_WIDTH,
} from "./engine-limits.ts";
import type { DirtyRect } from "./engine-stroke-types";
import {
  CONNECTED_COLOR_MAX_DISTANCE,
  connectedStraightSrgbColorsMatch,
} from "./color-match-core.ts";

export const GPU_FILL_STRATEGY =
  "webgpu-hierarchical-ccl-4-connected-transparent-underlay-opaque-replace-history1-render8-v9" as const;

export const FILL_RENDER_MASK_STRATEGY =
  "history-1bit-compute-expanded-row-stride-selected8-reused-label-buffer-v4" as const;

export const FILL_REFERENCE_LAYER_STRATEGY =
  "single-raster-reference-full-resident-gpu-source-separate-active-target-no-fallback-v1" as const;

/** @deprecated Compatibility maximum edge. */
export const FILL_LAYER_SIZE = Math.max(DOCUMENT_WIDTH, DOCUMENT_HEIGHT);
export const FILL_LAYER_WIDTH = DOCUMENT_WIDTH;
export const FILL_LAYER_HEIGHT = DOCUMENT_HEIGHT;
export const FILL_BLOCK_SIZE = 16;
export const FILL_BLOCK_GRID_WIDTH = Math.ceil(FILL_LAYER_WIDTH / FILL_BLOCK_SIZE);
export const FILL_BLOCK_GRID_HEIGHT = Math.ceil(FILL_LAYER_HEIGHT / FILL_BLOCK_SIZE);
/** @deprecated Compatibility maximum grid edge. */
export const FILL_BLOCK_GRID_SIZE = Math.max(FILL_BLOCK_GRID_WIDTH, FILL_BLOCK_GRID_HEIGHT);
export const FILL_BLOCK_COUNT = FILL_BLOCK_GRID_WIDTH * FILL_BLOCK_GRID_HEIGHT;
export const FILL_PIXELS_PER_BLOCK = FILL_BLOCK_SIZE * FILL_BLOCK_SIZE;
export const FILL_MAX_COMPONENTS_PER_BLOCK = FILL_PIXELS_PER_BLOCK / 2;
export const FILL_LABEL_WORDS_PER_BLOCK = FILL_PIXELS_PER_BLOCK / 4;
export const FILL_LABEL_BUFFER_BYTES = FILL_BLOCK_COUNT * FILL_LABEL_WORDS_PER_BLOCK * 4;
export const FILL_PARENT_COUNT = FILL_BLOCK_COUNT * FILL_MAX_COMPONENTS_PER_BLOCK;
export const FILL_PARENT_BUFFER_BYTES = FILL_PARENT_COUNT * 4;
export const FILL_ACTIVE_NODE_BUFFER_BYTES = FILL_BLOCK_COUNT * 4;
export const FILL_ACTIVE_BLOCK_BUFFER_BYTES = FILL_BLOCK_COUNT * 4;
export const FILL_HISTORY_WORDS_PER_ROW = Math.ceil(FILL_LAYER_WIDTH / 32);
export const FILL_HISTORY_MASK_WORDS = FILL_HISTORY_WORDS_PER_ROW * FILL_LAYER_HEIGHT;
export const FILL_HISTORY_MASK_BYTES = FILL_HISTORY_MASK_WORDS * 4;
/**
 * The authoritative/History mask remains 1 bit per pixel. For the render pass
 * it is expanded after CCL to four u32 words per source word. Bits 0–7 carry
 * selection; the upper 24 bits are zero. This avoids bit 31 in fragment shaders
 * on affected ARM Valhall drivers while reusing packedLabels, whose
 * classification data is dead after selection.
 */
export const FILL_RENDER_MASK_PIXELS_PER_WORD = 8;
export const FILL_RENDER_MASK_WORDS_PER_ROW = Math.ceil(
  FILL_LAYER_WIDTH / FILL_RENDER_MASK_PIXELS_PER_WORD,
);
export const FILL_RENDER_MASK_WORDS =
  FILL_RENDER_MASK_WORDS_PER_ROW * FILL_LAYER_HEIGHT;
export const FILL_RENDER_MASK_BYTES = FILL_RENDER_MASK_WORDS * 4;

/**
 * Maps one byte from the authoritative 32-pixel history word into the tightly
 * row-packed 8-pixel render mask. The final history word of a row may contain
 * padding (for example 1080 px uses 34 history words but only 135 render
 * words), so its fourth byte must never spill into the following row.
 */
export function fillRenderMaskTargetWord(
  sourceWordIndex: number,
  byteIndex: number,
): number | null {
  if (
    !Number.isSafeInteger(sourceWordIndex)
    || sourceWordIndex < 0
    || sourceWordIndex >= FILL_HISTORY_MASK_WORDS
    || !Number.isSafeInteger(byteIndex)
    || byteIndex < 0
    || byteIndex > 3
  ) {
    throw new RangeError("Indice di espansione maschera Fill non valido.");
  }
  const row = Math.floor(sourceWordIndex / FILL_HISTORY_WORDS_PER_ROW);
  const sourceWordX = sourceWordIndex % FILL_HISTORY_WORDS_PER_ROW;
  const targetWordX = sourceWordX * 4 + byteIndex;
  if (targetWordX >= FILL_RENDER_MASK_WORDS_PER_ROW) return null;
  return row * FILL_RENDER_MASK_WORDS_PER_ROW + targetWordX;
}
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
export const FILL_DIAGNOSTIC_SEED_TRANSPARENT_BIT = 1 << 18;
export const FILL_META_TILE_MASK_START = 8;
export const FILL_TILE_MASK_WORDS = DOCUMENT_TILE_MASK_WORDS;

// La maschera tile prodotta dal Riempimento e' la stessa griglia 16×16 del cold
// storage e della Selezione: a 2048² il tile e' 128 px e vale 8 blocchi, non 16.
export const FILL_TILE_GRID_SIZE = DOCUMENT_TILE_GRID_SIZE;
/** @deprecated Compatibility maximum tile edge. */
export const FILL_TILE_SIZE = Math.max(DOCUMENT_TILE_WIDTH, DOCUMENT_TILE_HEIGHT);
export const FILL_TILE_WIDTH = DOCUMENT_TILE_WIDTH;
export const FILL_TILE_HEIGHT = DOCUMENT_TILE_HEIGHT;

export const FILL_MAX_TOLERANCE_PERCENT = 100;
export const FILL_LINEAR_TOLERANCE_PERCENT = 10;
export const FILL_MAX_COLOR_DISTANCE = CONNECTED_COLOR_MAX_DISTANCE;

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
  /** Exact alpha classification of the source seed used by the GPU CCL. */
  readonly sourceSeedTransparent: boolean;
  readonly bounds: DirtyRect;
  readonly tileMask: Uint32Array;
  /** Include il completamento FIFO della queue e il risveglio della callback JS. */
  readonly queueCompletionMs: number;
}

/**
 * A transparent seed on the destination keeps the solid-underlay behavior so
 * anti-aliased line art survives the first Fill. An already-colored seed must
 * instead be replaced, otherwise every later Fill becomes a visible no-op.
 * A separate reference layer also uses replacement because its line art is not
 * part of the destination texture.
 */
export function fillCommitReplacesSelectedColor(
  sourceIsTarget: boolean,
  sourceSeedTransparent: boolean,
): boolean {
  return !sourceIsTarget || !sourceSeedTransparent;
}

/**
 * CPU reference for the Fill commit. The chosen color is an opaque layer
 * underneath the existing premultiplied destination pixel. Consequently an
 * opaque destination is unchanged, an empty destination becomes the fill
 * color, and anti-aliased/semitransparent content is composited over the fill.
 */
export function compositeFillAsSolidUnderlay(
  destination: readonly [number, number, number, number],
  fill: readonly [number, number, number, number],
): readonly [number, number, number, number] {
  const destinationAlpha = Math.min(1, Math.max(0, destination[3]));
  if (destinationAlpha === 0) {
    return [
      Math.min(1, Math.max(0, fill[0])),
      Math.min(1, Math.max(0, fill[1])),
      Math.min(1, Math.max(0, fill[2])),
      1,
    ];
  }
  const fillContribution = 1 - destinationAlpha;
  return [
    destination[0] + Math.min(1, Math.max(0, fill[0])) * fillContribution,
    destination[1] + Math.min(1, Math.max(0, fill[1])) * fillContribution,
    destination[2] + Math.min(1, Math.max(0, fill[2])) * fillContribution,
    1,
  ];
}

/**
 * Transparent-seed Fill treats tolerance as an alpha barrier: 100% accepts
 * every non-opaque texel, 90% stops at alpha 90%, and 0% accepts alpha zero.
 */
export function transparentFillAlphaMatches(alpha: number, tolerancePercent: number): boolean {
  if (!Number.isFinite(alpha) || !Number.isFinite(tolerancePercent)) {
    throw new RangeError("Alpha e tolleranza del riempimento devono essere finiti.");
  }
  const storedAlpha = Math.fround(Math.min(1, Math.max(0, alpha)));
  const threshold = Math.fround(Math.min(1, Math.max(0, tolerancePercent / 100)));
  return threshold === 0 ? storedAlpha === 0 : storedAlpha < threshold;
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
  const normalized = Math.min(
    FILL_MAX_TOLERANCE_PERCENT,
    Math.max(0, percent),
  ) / 100;
  const pivot = FILL_LINEAR_TOLERANCE_PERCENT / 100;
  if (normalized <= pivot) return normalized;
  return pivot + (normalized - pivot)
    * (FILL_MAX_COLOR_DISTANCE - pivot) / (1 - pivot);
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
  return connectedStraightSrgbColorsMatch(
    a,
    b,
    normalizeFillTolerance(tolerancePercent),
  );
}
