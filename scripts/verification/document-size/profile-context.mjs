import { readFileSync } from "node:fs";

export const DOCUMENT_SIZES = [2048, 4096];
export const expected = Number(process.env.BRUSH_DOCUMENT_SIZE);
const limits = await import("../../../src/engine-limits.ts");
export const {
  DOCUMENT_HEIGHT,
  DOCUMENT_MAX_EDGE,
  DOCUMENT_TILE_GRID_SIZE,
  DOCUMENT_TILE_HEIGHT,
  DOCUMENT_TILE_MASK_WORDS,
  DOCUMENT_TILE_SIZE,
  DOCUMENT_TILE_WIDTH,
  DOCUMENT_WIDTH,
  LAYER_SIZE,
  LIGHT_GLAZE_COMMIT_TILE_EXTENT,
  LIGHT_GLAZE_COMMIT_TILE_SLOT_COUNT,
  PAINT_DISPLAY_MIP_LEVEL_COUNT,
  THICKNESS_TAIL_MAXIMUM_TEXTURE_DIMENSION,
} = limits;
export const MEBIBYTE = 1024 * 1024;
export const at = (label) => `${label} @ documento ${DOCUMENT_WIDTH}×${DOCUMENT_HEIGHT}`;
export const read = (repositoryPath) => {
  const normalized = repositoryPath.startsWith("../")
    ? repositoryPath.slice(3)
    : repositoryPath;
  return readFileSync(new URL(`../../../${normalized}`, import.meta.url), "utf8");
};
