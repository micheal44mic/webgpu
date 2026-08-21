export const LAYER_COMPRESSION_CODEC = "compression-stream-gzip" as const;
export const LAYER_COMPRESSION_CHUNK_TILE_COUNT = 4 as const;

const MEBIBYTE_BYTES = 1024 * 1024;

export interface LayerCompressionChunkMeasurement {
  rawBytes: number;
  gzipBytes: number;
  /** Il payload gzip e' stato prodotto dopo il byte shuffle a 16 bit. */
  usedShuffle: boolean;
  adaptiveStoredBytes: number;
  encodeMs: number;
  decodeMs: number;
  zeroTileCount: number;
  solidTileCount: number;
  sourceHash: number;
  restoredHash: number;
  byteIdentical: true;
  usedRawFallback: boolean;
}

export type LayerCompressionStorage = "gzip" | "gzip-shuffle16" | "raw";

export interface LosslessLayerCompressionChunk {
  storage: LayerCompressionStorage;
  bytes: Uint8Array;
  measurement: LayerCompressionChunkMeasurement;
}

export function hashCompressionBytes(bytes: Uint8Array): number {
  let hash = 0x811c9dc5;
  for (const value of bytes) {
    hash ^= value;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function combineCompressionHashes(
  previous: number,
  next: number,
  byteLength: number,
): number {
  let hash = previous >>> 0;
  hash ^= next >>> 0;
  hash = Math.imul(hash, 0x01000193);
  hash ^= byteLength >>> 0;
  return Math.imul(hash, 0x01000193) >>> 0;
}
function formatHash(value: number): string {
  return value.toString(16).padStart(8, "0");
}


export function formatCompressionHash(value: number): string {
  return formatHash(value);
}

async function transformBytes(
  bytes: Uint8Array,
  transform: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const input: ArrayBuffer = bytes.buffer instanceof ArrayBuffer
      && bytes.byteOffset === 0
      && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer
    : bytes.slice().buffer as ArrayBuffer;
  const output = new Blob([input])
    .stream()
    .pipeThrough(transform);
  return new Uint8Array(await new Response(output).arrayBuffer());
}

export async function gzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream !== "function") {
    throw new Error("CompressionStream is unavailable in this browser.");
  }
  return transformBytes(bytes, new CompressionStream("gzip"));
}

export async function gunzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== "function") {
    throw new Error("DecompressionStream is unavailable in this browser.");
  }
  return transformBytes(bytes, new DecompressionStream("gzip"));
}

function classifyTiles(
  bytes: Uint8Array,
  tileByteLength: number,
): { zeroTileCount: number; solidTileCount: number } {
  if (
    !Number.isInteger(tileByteLength)
    || tileByteLength <= 0
    || bytes.byteLength % tileByteLength !== 0
  ) {
    throw new Error("Tile payload is not aligned.");
  }
  let zeroTileCount = 0;
  let solidTileCount = 0;
  for (let tileOffset = 0; tileOffset < bytes.byteLength; tileOffset += tileByteLength) {
    const red = bytes[tileOffset];
    const green = bytes[tileOffset + 1];
    const blue = bytes[tileOffset + 2];
    const alpha = bytes[tileOffset + 3];
    let allZero = red === 0 && green === 0 && blue === 0 && alpha === 0;
    let solid = true;
    for (
      let offset = tileOffset;
      offset < tileOffset + tileByteLength;
      offset += 4
    ) {
      if (
        bytes[offset] !== red
        || bytes[offset + 1] !== green
        || bytes[offset + 2] !== blue
        || bytes[offset + 3] !== alpha
      ) {
        solid = false;
      }
      if (
        bytes[offset] !== 0
        || bytes[offset + 1] !== 0
        || bytes[offset + 2] !== 0
        || bytes[offset + 3] !== 0
      ) {
        allZero = false;
      }
      if (!solid && !allZero) {
        break;
      }
    }
    if (allZero) {
      zeroTileCount += 1;
    }
    if (solid) {
      solidTileCount += 1;
    }
  }
  return { zeroTileCount, solidTileCount };
}

export async function measureLosslessGzipChunk(
  bytes: Uint8Array,
  tileByteLength: number,
): Promise<LayerCompressionChunkMeasurement> {
  return (await compressLosslessGzipChunk(bytes, tileByteLength)).measurement;
}

/**
 * Separa i byte bassi dai byte alti dei valori a 16 bit.
 *
 * In un mezzo float i byte alti (esponente e mantissa superiore) variano
 * lentamente fra pixel vicini, i byte bassi quasi a caso. Interlacciati, il
 * rumore dei bassi spezza le ripetizioni degli alti e gzip non le vede.
 * Separati, gli alti formano lunghe sequenze comprimibili.
 *
 * Misurato il 7 agosto 2026 su una regione dipinta al 100% con grana, il caso
 * peggiore: gzip da solo 2,30:1, con questo shuffle 2,76:1. Uno shuffle per
 * canale invece peggiora a 1,68:1, perche' rompe la correlazione spaziale che
 * e' proprio cio' che gzip sfrutta.
 *
 * E' una permutazione: il suo inverso e' esatto e la verifica byte-per-byte
 * gia' presente lo dimostra a ogni chunk.
 */
export function shuffle16(bytes: Uint8Array): Uint8Array {
  const pairs = bytes.byteLength >> 1;
  const out = new Uint8Array(bytes.byteLength);
  for (let index = 0; index < pairs; index += 1) {
    out[index] = bytes[index * 2];
    out[pairs + index] = bytes[index * 2 + 1];
  }
  return out;
}

export function unshuffle16(bytes: Uint8Array): Uint8Array {
  const pairs = bytes.byteLength >> 1;
  const out = new Uint8Array(bytes.byteLength);
  for (let index = 0; index < pairs; index += 1) {
    out[index * 2] = bytes[index];
    out[index * 2 + 1] = bytes[pairs + index];
  }
  return out;
}

export async function compressLosslessGzipChunk(
  bytes: Uint8Array,
  tileByteLength: number,
  bytesPerComponent = 1,
): Promise<LosslessLayerCompressionChunk> {
  const classification = classifyTiles(bytes, tileByteLength);
  const sourceHash = hashCompressionBytes(bytes);
  // Lo shuffle si tenta solo dove ha senso: componenti a 16 bit e lunghezza
  // pari. Su byte singoli sarebbe una permutazione inutile che costa una copia.
  const tryShuffle = bytesPerComponent === 2 && (bytes.byteLength & 1) === 0;
  const encodeStart = performance.now();
  const plainGzip = await gzipBytes(bytes);
  const shuffledGzip = tryShuffle ? await gzipBytes(shuffle16(bytes)) : null;
  const useShuffle = shuffledGzip !== null
    && shuffledGzip.byteLength < plainGzip.byteLength;
  const compressed = useShuffle ? shuffledGzip : plainGzip;
  const encodeMs = performance.now() - encodeStart;
  const decodeStart = performance.now();
  const inflated = await gunzipBytes(compressed);
  const restored = useShuffle ? unshuffle16(inflated) : inflated;
  const decodeMs = performance.now() - decodeStart;
  if (restored.byteLength !== bytes.byteLength) {
    throw new Error(
      `gzip round trip produced ${restored.byteLength} bytes; expected ${bytes.byteLength}.`,
    );
  }
  for (let index = 0; index < bytes.byteLength; index += 1) {
    if (restored[index] !== bytes[index]) {
      throw new Error(
        `gzip round trip differs at byte ${index}: ${restored[index]} ≠ ${bytes[index]}.`,
      );
    }
  }
  const restoredHash = hashCompressionBytes(restored);
  if (restoredHash !== sourceHash) {
    throw new Error("gzip hash differs despite byte-for-byte equality.");
  }
  const usedRawFallback = compressed.byteLength >= bytes.byteLength;
  const measurement: LayerCompressionChunkMeasurement = {
    rawBytes: bytes.byteLength,
    gzipBytes: compressed.byteLength,
    usedShuffle: useShuffle && !usedRawFallback,
    adaptiveStoredBytes: Math.min(bytes.byteLength, compressed.byteLength),
    encodeMs,
    decodeMs,
    ...classification,
    sourceHash,
    restoredHash,
    byteIdentical: true,
    usedRawFallback,
  };
  return {
    // Il tag e' autodescrittivo: chi decomprime non deve sapere da quale
    // formato provenissero i byte per invertire la trasformazione giusta.
    storage: usedRawFallback ? "raw" : (useShuffle ? "gzip-shuffle16" : "gzip"),
    bytes: usedRawFallback ? bytes : compressed,
    measurement,
  };
}

export function bytesToMiB(bytes: number): number {
  return bytes / MEBIBYTE_BYTES;
}
