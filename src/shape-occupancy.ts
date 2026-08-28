/**
 * Griglia di occupazione della maschera Shape: mappe di bit per mip usate per
 * scartare i quad vuoti prima della rasterizzazione. Le dimensioni della griglia
 * vivono in `engine-limits`, qui c'e' l'algoritmo che le riempie.
 */
import {
  SHAPE_MASK_SIZE,
  SHAPE_MASK_FILTER_GUARD_TEXELS,
  SHAPE_MASK_FILTER_UV_SCALE,
  SHAPE_OCCUPANCY_CELL_COUNT,
  SHAPE_OCCUPANCY_CELL_SIZE,
  SHAPE_OCCUPANCY_GRID_SIZE,
  SHAPE_OCCUPANCY_MAP_COUNT,
  SHAPE_OCCUPANCY_WORDS_PER_MAP,
} from "./engine-limits";

export type ShapeOccupancyFallbackReason =
  | "none"
  | "minimum-radius"
  | "mip-out-of-range"
  | "coverage-too-dense"
  | "mixed";

export interface ShapeOccupancySelection {
  selectedMipLevel: number | null;
  fallbackReason: Exclude<ShapeOccupancyFallbackReason, "mixed">;
  candidateMipLevel: number;
  candidateActiveCells: number;
  candidateCoverageRatio: number;
}

export interface ShapeOccupancyBuildOptions {
  /** Protected masks include the transparent sampling guard and are mapped back to authored space. */
  coordinateFrame?: "logical" | "protected";
}

export function buildShapeOccupancyMaps(
  mipMasks: readonly Uint8Array[],
  options: ShapeOccupancyBuildOptions = {},
): {
  words: Uint32Array;
  activeCells: number[];
  coverageRatios: number[];
} {
  const words = new Uint32Array(SHAPE_OCCUPANCY_WORDS_PER_MAP * SHAPE_OCCUPANCY_MAP_COUNT);
  const occupied = new Uint8Array(SHAPE_OCCUPANCY_CELL_COUNT);
  const activeCells: number[] = [];
  const coverageRatios: number[] = [];
  const protectedFrame = options.coordinateFrame === "protected";
  const toLogicalCoordinate = protectedFrame
    ? (coordinate: number): number => (
      coordinate - SHAPE_MASK_FILTER_GUARD_TEXELS
    ) / SHAPE_MASK_FILTER_UV_SCALE
    : (coordinate: number): number => coordinate;

  for (let mipLevel = 0; mipLevel < SHAPE_OCCUPANCY_MAP_COUNT; mipLevel += 1) {
    const levelMask = mipMasks[mipLevel];
    const levelSize = SHAPE_MASK_SIZE >> mipLevel;
    const sourceScale = 1 << mipLevel;

    for (let y = 0; y < levelSize; y += 1) {
      for (let x = 0; x < levelSize; x += 1) {
        if (levelMask[y * levelSize + x] === 0) {
          continue;
        }

        const minimumSourceX = Math.max(
          0,
          toLogicalCoordinate((x - 0.5) * sourceScale),
        );
        const maximumSourceX = Math.min(
          SHAPE_MASK_SIZE,
          toLogicalCoordinate((x + 1.5) * sourceScale),
        );
        const minimumSourceY = Math.max(
          0,
          toLogicalCoordinate((y - 0.5) * sourceScale),
        );
        const maximumSourceY = Math.min(
          SHAPE_MASK_SIZE,
          toLogicalCoordinate((y + 1.5) * sourceScale),
        );
        const minimumCellX = Math.max(0, Math.floor(minimumSourceX / SHAPE_OCCUPANCY_CELL_SIZE));
        const maximumCellX = Math.min(
          SHAPE_OCCUPANCY_GRID_SIZE - 1,
          Math.ceil(maximumSourceX / SHAPE_OCCUPANCY_CELL_SIZE) - 1,
        );
        const minimumCellY = Math.max(0, Math.floor(minimumSourceY / SHAPE_OCCUPANCY_CELL_SIZE));
        const maximumCellY = Math.min(
          SHAPE_OCCUPANCY_GRID_SIZE - 1,
          Math.ceil(maximumSourceY / SHAPE_OCCUPANCY_CELL_SIZE) - 1,
        );

        for (let cellY = minimumCellY; cellY <= maximumCellY; cellY += 1) {
          const row = cellY * SHAPE_OCCUPANCY_GRID_SIZE;
          for (let cellX = minimumCellX; cellX <= maximumCellX; cellX += 1) {
            occupied[row + cellX] = 1;
          }
        }
      }
    }

    let count = 0;
    const wordOffset = mipLevel * SHAPE_OCCUPANCY_WORDS_PER_MAP;
    for (let cellIndex = 0; cellIndex < occupied.length; cellIndex += 1) {
      if (occupied[cellIndex] === 0) {
        continue;
      }
      count += 1;
      const wordIndex = wordOffset + (cellIndex >>> 5);
      words[wordIndex] |= (1 << (cellIndex & 31)) >>> 0;
    }
    activeCells.push(count);
    coverageRatios.push(count / SHAPE_OCCUPANCY_CELL_COUNT);
  }

  return { words, activeCells, coverageRatios };
}
