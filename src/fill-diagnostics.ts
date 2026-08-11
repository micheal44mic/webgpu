/**
 * Content-bounded diagnostics for Android Fill corruption.
 *
 * The report never serializes the 2 MiB mask or layer pixels. It reduces them
 * to counts by x modulo 32 and a few word values around the seed, which is
 * enough to distinguish mask production, fragment commit and presentation.
 */
import type { LayerFormat } from "./engine-types";

export const FILL_DIAGNOSTIC_SCHEMA =
  "webgpu-brush-fill-mask-render-probe-v1" as const;

export interface FillMaskDiagnosticSummary {
  readonly metadataSelectedPixels: number;
  readonly readbackSelectedPixels: number;
  readonly selectedPixelDelta: number;
  readonly exactPopulationMatch: boolean;
  readonly wordCount: number;
  readonly zeroWords: number;
  readonly fullWords: number;
  readonly partialWords: number;
  readonly low31FullHighBitClearWords: number;
  readonly selectedByXModulo32: readonly number[];
  readonly bit31ToNeighborRatio: number | null;
  readonly bit31LikelyMissing: boolean;
  readonly seedWordNeighborhood: readonly {
    readonly wordIndex: number;
    readonly valueHex: string;
  }[];
}

export interface FillRenderedRowDiagnosticSummary {
  readonly format: LayerFormat;
  readonly y: number;
  readonly width: number;
  readonly maskSelectedPixels: number;
  readonly matchingFillPixels: number;
  readonly selectedButDifferentPixels: number;
  readonly selectedButDifferentByXModulo32: readonly number[];
  readonly firstDifferentX: readonly number[];
}

export type FillDiagnosticClassification =
  | "mask-bit31-write-loss"
  | "mask-write-loss"
  | "render-commit-loss"
  | "mask-and-layer-row-consistent"
  | "no-selected-pixels-on-seed-row";

function popcount32(source: number): number {
  let word = source >>> 0;
  let count = 0;
  while (word !== 0) {
    word = (word & (word - 1)) >>> 0;
    count += 1;
  }
  return count;
}

function wordHex(value: number): string {
  return `0x${(value >>> 0).toString(16).padStart(8, "0")}`;
}

export function summarizeFillMaskWords(
  words: Uint32Array,
  metadataSelectedPixels: number,
  seedX: number,
  seedY: number,
  layerWidth: number,
): FillMaskDiagnosticSummary {
  if (layerWidth <= 0 || layerWidth % 32 !== 0) {
    throw new Error("La larghezza della maschera Fill deve essere divisibile per 32.");
  }
  const selectedByXModulo32 = Array.from({ length: 32 }, () => 0);
  let readbackSelectedPixels = 0;
  let zeroWords = 0;
  let fullWords = 0;
  let partialWords = 0;
  let low31FullHighBitClearWords = 0;
  for (const source of words) {
    const word = source >>> 0;
    readbackSelectedPixels += popcount32(word);
    if (word === 0) {
      zeroWords += 1;
    } else if (word === 0xffffffff) {
      fullWords += 1;
      // Add the common full-fill case in one batch after the loop. On a 4K
      // document this avoids 16.7 million JS bit tests on the old phone.
      continue;
    } else {
      partialWords += 1;
    }
    if (word === 0x7fffffff) low31FullHighBitClearWords += 1;
    for (let bit = 0; bit < 32; bit += 1) {
      // Division by a constant is deliberate here: this is CPU diagnostic
      // code and does not repeat the shader operation under investigation.
      if ((word & (2 ** bit)) !== 0) selectedByXModulo32[bit] += 1;
    }
  }
  for (let bit = 0; bit < 32; bit += 1) {
    selectedByXModulo32[bit] += fullWords;
  }
  const neighborPopulation = (selectedByXModulo32[30] + selectedByXModulo32[0]) / 2;
  const bit31ToNeighborRatio = neighborPopulation > 0
    ? selectedByXModulo32[31] / neighborPopulation
    : null;
  const selectedPixelDelta = readbackSelectedPixels - metadataSelectedPixels;
  const bit31LikelyMissing = selectedPixelDelta < 0
    && neighborPopulation >= 8
    && (bit31ToNeighborRatio ?? 1) < 0.25;

  const wordsPerRow = layerWidth / 32;
  const seedWord = Math.max(
    0,
    Math.min(words.length - 1, seedY * wordsPerRow + Math.floor(seedX / 32)),
  );
  const seedWordNeighborhood = [];
  for (let index = Math.max(0, seedWord - 2); index <= Math.min(words.length - 1, seedWord + 2); index += 1) {
    seedWordNeighborhood.push({ wordIndex: index, valueHex: wordHex(words[index]) });
  }

  return {
    metadataSelectedPixels,
    readbackSelectedPixels,
    selectedPixelDelta,
    exactPopulationMatch: selectedPixelDelta === 0,
    wordCount: words.length,
    zeroWords,
    fullWords,
    partialWords,
    low31FullHighBitClearWords,
    selectedByXModulo32,
    bit31ToNeighborRatio,
    bit31LikelyMissing,
    seedWordNeighborhood,
  };
}

function decodeFloat16(bits: number): number {
  const sign = (bits & 0x8000) === 0 ? 1 : -1;
  const exponent = (bits >>> 10) & 0x1f;
  const mantissa = bits & 0x03ff;
  if (exponent === 0) {
    return sign * (mantissa / 1024) * 2 ** -14;
  }
  if (exponent === 0x1f) {
    return mantissa === 0 ? sign * Number.POSITIVE_INFINITY : Number.NaN;
  }
  return sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
}

function targetChannel(
  pixels: Uint8Array,
  format: LayerFormat,
  pixelIndex: number,
  channel: number,
): number {
  if (format === "rgba8unorm") {
    return pixels[pixelIndex * 4 + channel] / 255;
  }
  const offset = pixelIndex * 8 + channel * 2;
  return decodeFloat16(pixels[offset] | (pixels[offset + 1] << 8));
}

export function summarizeFillRenderedRow(
  pixels: Uint8Array,
  format: LayerFormat,
  maskWords: Uint32Array,
  expectedColor: readonly [number, number, number, number],
  y: number,
  layerWidth: number,
): FillRenderedRowDiagnosticSummary {
  const bytesPerPixel = format === "rgba16float" ? 8 : 4;
  if (pixels.byteLength !== layerWidth * bytesPerPixel) {
    throw new Error(
      `Readback riga Fill ${pixels.byteLength} B, attesi ${layerWidth * bytesPerPixel} B.`,
    );
  }
  const wordsPerRow = layerWidth / 32;
  const rowWordOffset = y * wordsPerRow;
  const selectedButDifferentByXModulo32 = Array.from({ length: 32 }, () => 0);
  const firstDifferentX: number[] = [];
  let maskSelectedPixels = 0;
  let matchingFillPixels = 0;
  let selectedButDifferentPixels = 0;
  const tolerance = format === "rgba16float" ? 0.002 : 2 / 255;
  for (let x = 0; x < layerWidth; x += 1) {
    const word = maskWords[rowWordOffset + Math.floor(x / 32)] >>> 0;
    const selected = (word & (2 ** (x % 32))) !== 0;
    if (!selected) continue;
    maskSelectedPixels += 1;
    let matches = true;
    for (let channel = 0; channel < 4; channel += 1) {
      if (Math.abs(targetChannel(pixels, format, x, channel) - expectedColor[channel]) > tolerance) {
        matches = false;
        break;
      }
    }
    if (matches) {
      matchingFillPixels += 1;
    } else {
      selectedButDifferentPixels += 1;
      selectedButDifferentByXModulo32[x % 32] += 1;
      if (firstDifferentX.length < 16) firstDifferentX.push(x);
    }
  }
  return {
    format,
    y,
    width: layerWidth,
    maskSelectedPixels,
    matchingFillPixels,
    selectedButDifferentPixels,
    selectedButDifferentByXModulo32,
    firstDifferentX,
  };
}

export function classifyFillDiagnostic(
  mask: FillMaskDiagnosticSummary,
  row: FillRenderedRowDiagnosticSummary,
): FillDiagnosticClassification {
  if (!mask.exactPopulationMatch) {
    return mask.bit31LikelyMissing ? "mask-bit31-write-loss" : "mask-write-loss";
  }
  if (row.maskSelectedPixels === 0) return "no-selected-pixels-on-seed-row";
  if (row.selectedButDifferentPixels > 0) return "render-commit-loss";
  return "mask-and-layer-row-consistent";
}
