/**
 * Dimensioni fisse, budget e taglie dei buffer uniform. Sono i numeri che
 * determinano l'allocazione statica del motore: toccarli cambia la memoria
 * misurata dai benchmark.
 */

export const LAYER_SIZE = 4096;

export const MEBIBYTE_BYTES = 1024 * 1024;

export const PAINT_DISPLAY_MIP_LEVEL_COUNT = Math.floor(Math.log2(LAYER_SIZE)) + 1;

export const STAMP_STRIDE_BYTES = 32;

export const MAX_STAMPS_PER_BATCH = 65_536;

export const STABILIZATION_TAIL_TEXTURE_QUANTUM = 128;

// Il drenaggio dei batch Blend è limitato dai pixel-pass per frame, non da un
// conteggio fisso per size: col renderer compute un segmento costa il deposit
// sulla propria writeRect più la quota di gather/scatter del gruppo (~2 pass
// equivalenti sulla readRect). Un budget in pixel lascia alle size piccole
// centinaia di segmenti per frame (il tratto resta attaccato al puntatore) e
// continua a proteggere il frame time sulle size grandi.
export const DRY_BLEND_FRAME_PIXEL_BUDGET = 24_000_000;

export const DRY_BLEND_MAX_BATCHES_PER_FRAME = 256;

export const STAMP_VERTICES_PER_COPY = 4;

export const THICKNESS_TAIL_TEXTURE_QUANTUM = 256;

export const THICKNESS_TAIL_MAXIMUM_TEXTURE_DIMENSION = LAYER_SIZE;

export const SHAPE_MASK_SIZE = 2048;

export const GRAIN_TEXTURE_SIZE = 2500;

export const GRAIN_TEXTURE_MIP_LEVEL_COUNT = Math.floor(Math.log2(GRAIN_TEXTURE_SIZE)) + 1;

export const GRAIN_TEXTURE_PIXEL_COUNT = Array.from(
  { length: GRAIN_TEXTURE_MIP_LEVEL_COUNT },
  (_, mipLevel) => {
    const dimension = Math.max(1, Math.floor(GRAIN_TEXTURE_SIZE / (2 ** mipLevel)));
    return dimension * dimension;
  },
).reduce((sum, pixels) => sum + pixels, 0);

export const SHAPE_MASK_PIXEL_COUNT = Array.from(
  { length: Math.log2(SHAPE_MASK_SIZE) + 1 },
  (_, mipLevel) => {
    const dimension = Math.max(1, SHAPE_MASK_SIZE >> mipLevel);
    return dimension * dimension;
  },
).reduce((sum, pixels) => sum + pixels, 0);

export const SHAPE_OCCUPANCY_GRID_SIZE = 256;

export const SHAPE_OCCUPANCY_CELL_SIZE = SHAPE_MASK_SIZE / SHAPE_OCCUPANCY_GRID_SIZE;

export const SHAPE_OCCUPANCY_CELL_COUNT = SHAPE_OCCUPANCY_GRID_SIZE * SHAPE_OCCUPANCY_GRID_SIZE;

export const SHAPE_OCCUPANCY_WORDS_PER_MAP = SHAPE_OCCUPANCY_CELL_COUNT / 32;

export const SHAPE_OCCUPANCY_MAX_MIP = 4;

export const SHAPE_OCCUPANCY_MAP_COUNT = SHAPE_OCCUPANCY_MAX_MIP + 1;

export const SHAPE_OCCUPANCY_MIN_RADIUS = 128;

export const SHAPE_OCCUPANCY_MAX_COVERAGE_RATIO = 0.5;

export const SHAPE_OCCUPANCY_MAP_BYTES = SHAPE_OCCUPANCY_WORDS_PER_MAP * 4;

export const BRUSH_UNIFORM_BYTES = 96;

export const GRAIN_UNIFORM_BYTES = 32;

export const DISPLAY_UNIFORM_BYTES = 64;

export const VECTOR_TEXT_CAPTURE_UNIFORM_BYTES = 32;

export const VECTOR_TEXT_GPU_MAXIMUM_DRAWS = 512;

export const VIEW_ROTATION_SNAP_ENTER_RADIANS = 3 * Math.PI / 180;

export const VIEW_ROTATION_SNAP_RELEASE_RADIANS = 7 * Math.PI / 180;

export const LAYER_COMPOSITE_UNIFORM_BYTES = 32;

export const LIGHT_GLAZE_UNIFORM_BYTES = 32;

export const LIGHT_GLAZE_COMMIT_TILE_UNIFORM_BYTES = 16;

export const LIGHT_GLAZE_COMMIT_TILE_UNIFORM_STRIDE_BYTES = 256;

export const LIGHT_GLAZE_COMMIT_TILE_EXTENT = 1024;

export const LIGHT_GLAZE_COMMIT_TILE_SLOT_COUNT =
  (LAYER_SIZE / LIGHT_GLAZE_COMMIT_TILE_EXTENT) ** 2;

export const LIGHT_GLAZE_COMMIT_TILE_UNIFORM_BUFFER_BYTES =
  LIGHT_GLAZE_COMMIT_TILE_UNIFORM_STRIDE_BYTES * LIGHT_GLAZE_COMMIT_TILE_SLOT_COUNT;

export const THICKNESS_TAIL_UNIFORM_BYTES = 32;

export const STATIC_PAINT_BUFFER_BYTES =
  BRUSH_UNIFORM_BYTES * 2
  + GRAIN_UNIFORM_BYTES
  + DISPLAY_UNIFORM_BYTES
  + VECTOR_TEXT_CAPTURE_UNIFORM_BYTES
  + LAYER_COMPOSITE_UNIFORM_BYTES
  + THICKNESS_TAIL_UNIFORM_BYTES
  + LIGHT_GLAZE_UNIFORM_BYTES
  + LIGHT_GLAZE_COMMIT_TILE_UNIFORM_BUFFER_BYTES
  + MAX_STAMPS_PER_BATCH * STAMP_STRIDE_BYTES * 2
  + SHAPE_OCCUPANCY_MAP_BYTES * SHAPE_OCCUPANCY_MAP_COUNT;
