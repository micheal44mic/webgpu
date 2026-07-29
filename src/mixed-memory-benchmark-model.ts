export const MIXED_MEMORY_BENCHMARK_STRATEGY =
  "mixed-raster-vector-64-text-nine-runs-counted-gpu-800mib-v1" as const;
export const MIXED_MEMORY_BENCHMARK_STAGED_STRATEGY =
  "mixed-raster-vector-64-text-nine-runs-counted-gpu-600mib-staged-v1" as const;
export const MIXED_MEMORY_BENCHMARK_TARGET_MIB = 800;
export const MIXED_MEMORY_BENCHMARK_STAGED_TARGET_MIB = 600;
export const MIXED_MEMORY_BENCHMARK_STAGED_INTERLEAVED_TILE_COUNT = 128;
export const MIXED_MEMORY_BENCHMARK_STAGED_TEXT_BATCH_SIZE = 8;
export const MIXED_MEMORY_BENCHMARK_INTERLEAVED_TEXT_RUNS = 8;
export const MIXED_MEMORY_BENCHMARK_REPORT_VERSION = 1;

export type MixedMemoryBenchmarkStrategy =
  | typeof MIXED_MEMORY_BENCHMARK_STRATEGY
  | typeof MIXED_MEMORY_BENCHMARK_STAGED_STRATEGY;

export function mixedMemoryBenchmarkStrategy(
  targetMiB: number,
): MixedMemoryBenchmarkStrategy {
  return targetMiB === MIXED_MEMORY_BENCHMARK_STAGED_TARGET_MIB
    ? MIXED_MEMORY_BENCHMARK_STAGED_STRATEGY
    : MIXED_MEMORY_BENCHMARK_STRATEGY;
}

export interface MixedMemoryBenchmarkTextSeed {
  text: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  outlineWidth: number;
  outlineColor: string;
  outlineJoin: "bevel" | "miter" | "round";
  blockShadowEnabled: boolean;
  blockShadowColor: string;
  blockShadowOpacity: number;
  blockShadowOffset: number;
  blockShadowAngle: number;
  blockShadowOutlineWidth: number;
  singleShadowEnabled: boolean;
  singleShadowColor: string;
  singleShadowOpacity: number;
  singleShadowOffset: number;
  singleShadowAngle: number;
  singleShadowBlur: number;
  innerShadowEnabled: boolean;
  innerShadowColor: string;
  innerShadowOpacity: number;
  innerShadowOffset: number;
  innerShadowAngle: number;
  innerShadowBlur: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

function stressTextColor(index: number): string {
  return [
    "#111111",
    "#f47c5d",
    "#3c91e6",
    "#f4c95d",
    "#7b61ff",
    "#20a39e",
    "#e55934",
    "#536878",
  ][index % 8];
}

export function mixedMemoryBenchmarkTextSeed(
  index: number,
  layerSize: number,
): MixedMemoryBenchmarkTextSeed {
  const column = index % 8;
  const row = Math.floor(index / 8) % 8;
  const blockShadowEnabled = index % 2 === 0;
  const margin = 300;
  const span = Math.max(1, layerSize - margin * 2);
  return {
    text: `T${String(index + 1).padStart(2, "0")}`,
    fontFamily: ["Anton", "Bebas Neue", "Poppins"][index % 3],
    fontSize: 112 + (index % 4) * 12,
    color: stressTextColor(index),
    outlineWidth: 0,
    outlineColor: "#111111",
    outlineJoin: "round",
    blockShadowEnabled,
    blockShadowColor: "#727272",
    blockShadowOpacity: 1,
    blockShadowOffset: 23,
    blockShadowAngle: -104,
    blockShadowOutlineWidth: 0,
    singleShadowEnabled: !blockShadowEnabled,
    singleShadowColor: "#727272",
    singleShadowOpacity: 1,
    singleShadowOffset: 54,
    singleShadowAngle: -180,
    singleShadowBlur: 6,
    innerShadowEnabled: false,
    innerShadowColor: "#000000",
    innerShadowOpacity: 0.65,
    innerShadowOffset: 12,
    innerShadowAngle: -135,
    innerShadowBlur: 12,
    x: margin + (column + 0.5) * span / 8,
    y: margin + (row + 0.7) * span / 8,
    scale: 1,
    rotation: ((index % 5) - 2) * Math.PI / 180,
  };
}
