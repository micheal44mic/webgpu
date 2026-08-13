import {
  LAYER_COMPRESSION_CHUNK_TILE_COUNT,
  LAYER_COMPRESSION_CODEC,
} from "../../layer-compression-codec.ts";

export const LAYER_COMPRESSION_STUDY_VERSION = 1 as const;
export const LAYER_COMPRESSION_STUDY_BUILD =
  "lossless-gzip-256-tile-1mib-streamed-measurement-v1" as const;

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
  layerFormat: "rgba8unorm" | "rgba16float";
  bytesPerPixel: 4 | 8;
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
