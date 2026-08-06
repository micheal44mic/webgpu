export const LAYER_COMPRESSION_STUDY_VERSION = 1 as const;
export const LAYER_COMPRESSION_STUDY_BUILD =
  "lossless-gzip-256-tile-1mib-streamed-measurement-v1" as const;
export const LAYER_COMPRESSION_CODEC = "compression-stream-gzip" as const;
export const LAYER_COMPRESSION_CHUNK_TILE_COUNT = 4 as const;

const MEBIBYTE_BYTES = 1024 * 1024;

export interface LayerCompressionChunkMeasurement {
  rawBytes: number;
  gzipBytes: number;
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

export type LayerCompressionStorage = "gzip" | "raw";

export interface LosslessLayerCompressionChunk {
  storage: LayerCompressionStorage;
  bytes: Uint8Array;
  measurement: LayerCompressionChunkMeasurement;
}

export interface LayerCompressionLayerReport {
  index: number;
  id: number;
  name: string;
  tileCount: number;
  chunkCount: number;
  rawMiB: number;
  gzipMiB: number;
  adaptiveStoredMiB: number;
  adaptiveSavingsMiB: number;
  adaptiveSavingsPercent: number;
  compressionRatio: number;
  encodeMs: number;
  decodeMs: number;
  zeroTileCount: number;
  solidTileCount: number;
  rawFallbackChunks: number;
  sourceHash: string;
  restoredHash: string;
  byteIdentical: true;
}

export interface LayerCompressionStudyReport {
  version: typeof LAYER_COMPRESSION_STUDY_VERSION;
  build: typeof LAYER_COMPRESSION_STUDY_BUILD;
  passed: true;
  measurementOnly: true;
  codec: typeof LAYER_COMPRESSION_CODEC;
  tileSizePx: number;
  chunkTileCount: typeof LAYER_COMPRESSION_CHUNK_TILE_COUNT;
  layerFormat: "rgba8unorm";
  bytesPerPixel: 4;
  recordedAt: string;
  elapsedMs: number;
  layerCount: number;
  inactiveLayerCount: number;
  measuredLayerCount: number;
  tileCount: number;
  chunkCount: number;
  rawMiB: number;
  gzipMiB: number;
  adaptiveStoredMiB: number;
  adaptiveSavingsMiB: number;
  adaptiveSavingsPercent: number;
  compressionRatio: number;
  encodeMs: number;
  decodeMs: number;
  zeroTileCount: number;
  solidTileCount: number;
  rawFallbackChunks: number;
  byteIdentical: true;
  countedGpuMiBBefore: number;
  countedGpuMiBAfter: number;
  temporaryReadbackPeakMiB: number;
  maximumLogicalChunkWorkingMiB: number;
  environment: {
    userAgent: string;
    platform: string;
    devicePixelRatio: number;
    viewportWidth: number;
    viewportHeight: number;
    gpuLabel: string;
  };
  layers: LayerCompressionLayerReport[];
}

export interface LayerCompressionStudyProgress {
  layerNumber: number;
  layerCount: number;
  layerName: string;
  completedTiles: number;
  totalTiles: number;
  rawMiB: number;
  adaptiveStoredMiB: number;
  savingsPercent: number;
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
    throw new Error("CompressionStream non disponibile in questo browser.");
  }
  return transformBytes(bytes, new CompressionStream("gzip"));
}

export async function gunzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== "function") {
    throw new Error("DecompressionStream non disponibile in questo browser.");
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
    throw new Error("Payload tile non allineato.");
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

export async function compressLosslessGzipChunk(
  bytes: Uint8Array,
  tileByteLength: number,
): Promise<LosslessLayerCompressionChunk> {
  const classification = classifyTiles(bytes, tileByteLength);
  const sourceHash = hashCompressionBytes(bytes);
  const encodeStart = performance.now();
  const compressed = await gzipBytes(bytes);
  const encodeMs = performance.now() - encodeStart;
  const decodeStart = performance.now();
  const restored = await gunzipBytes(compressed);
  const decodeMs = performance.now() - decodeStart;
  if (restored.byteLength !== bytes.byteLength) {
    throw new Error(
      `Round-trip gzip di ${restored.byteLength} byte; attesi ${bytes.byteLength}.`,
    );
  }
  for (let index = 0; index < bytes.byteLength; index += 1) {
    if (restored[index] !== bytes[index]) {
      throw new Error(
        `Round-trip gzip diverso al byte ${index}: ${restored[index]} ≠ ${bytes[index]}.`,
      );
    }
  }
  const restoredHash = hashCompressionBytes(restored);
  if (restoredHash !== sourceHash) {
    throw new Error("Hash gzip diverso nonostante il confronto byte-per-byte.");
  }
  const usedRawFallback = compressed.byteLength >= bytes.byteLength;
  const measurement: LayerCompressionChunkMeasurement = {
    rawBytes: bytes.byteLength,
    gzipBytes: compressed.byteLength,
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
    storage: usedRawFallback ? "raw" : "gzip",
    bytes: usedRawFallback ? bytes : compressed,
    measurement,
  };
}

export function bytesToMiB(bytes: number): number {
  return bytes / MEBIBYTE_BYTES;
}
