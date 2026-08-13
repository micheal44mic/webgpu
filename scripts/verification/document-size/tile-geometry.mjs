import assert from "node:assert/strict";
import {
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
  at,
} from "./profile-context.mjs";
const {
  FILL_BLOCK_COUNT,
  FILL_BLOCK_GRID_HEIGHT,
  FILL_BLOCK_GRID_SIZE,
  FILL_BLOCK_GRID_WIDTH,
  FILL_BLOCK_SIZE,
  FILL_HISTORY_MASK_BYTES,
  FILL_HISTORY_WORDS_PER_ROW,
  FILL_LABEL_BUFFER_BYTES,
  FILL_LAYER_HEIGHT,
  FILL_LAYER_SIZE,
  FILL_LAYER_WIDTH,
  FILL_RENDER_MASK_BYTES,
  FILL_RENDER_MASK_WORDS_PER_ROW,
  FILL_TILE_GRID_SIZE,
  FILL_TILE_HEIGHT,
  FILL_TILE_MASK_WORDS,
  FILL_TILE_SIZE,
  FILL_TILE_WIDTH,
} = await import("../../../src/fill-core.ts");
const {
  SELECTION_LAYER_HEIGHT,
  SELECTION_LAYER_SIZE,
  SELECTION_LAYER_WIDTH,
  SELECTION_MASK_BYTES,
  SELECTION_TILE_GRID_SIZE,
  SELECTION_TILE_HEIGHT,
  SELECTION_TILE_MASK_WORDS,
  SELECTION_TILE_SIZE,
  SELECTION_TILE_WIDTH,
  SELECTION_WORDS_PER_ROW,
} = await import("../../../src/selection-core.ts");
const {
  LAYER_STORAGE_DOCUMENT_HEIGHT,
  LAYER_STORAGE_DOCUMENT_SIZE,
  LAYER_STORAGE_DOCUMENT_WIDTH,
  LAYER_STORAGE_GRID_SIZE,
  LAYER_STORAGE_MASK_WORD_COUNT,
  LAYER_STORAGE_TILE_COUNT,
  LAYER_STORAGE_TILE_HEIGHT,
  LAYER_STORAGE_TILE_SIZE,
  LAYER_STORAGE_TILE_WIDTH,
} = await import("../../../src/layer-storage-study.ts");
const {
  RASTER_TRANSFORM_DOCUMENT_SIZE,
  RASTER_TRANSFORM_TILE_GRID_SIZE,
  RASTER_TRANSFORM_TILE_SIZE,
  rasterTransformScratchRect,
} = await import("../../../src/raster-transform-math.ts");
const { DRY_BLEND_DEFAULT_DOCUMENT_SIZE } = await import("../../../src/blend-core.ts");

// --- Piramide display -------------------------------------------------------
assert.equal(
  PAINT_DISPLAY_MIP_LEVEL_COUNT,
  Math.floor(Math.log2(DOCUMENT_MAX_EDGE)) + 1,
  at("La catena mip deve scendere fino a 1×1"),
);
assert.equal(
  THICKNESS_TAIL_MAXIMUM_TEXTURE_DIMENSION,
  LAYER_SIZE,
  at("La coda thickness non puo' eccedere il documento"),
);
assert.equal(
  LIGHT_GLAZE_COMMIT_TILE_SLOT_COUNT,
  Math.ceil(DOCUMENT_WIDTH / LIGHT_GLAZE_COMMIT_TILE_EXTENT)
    * Math.ceil(DOCUMENT_HEIGHT / LIGHT_GLAZE_COMMIT_TILE_EXTENT),
  at("Gli slot di commit Light Glaze devono coprire il documento"),
);

// --- Griglia tile condivisa -------------------------------------------------
// L'invariante e' che il documento sia SEMPRE diviso 16×16: e' il lato del tile
// a scalare. Cosi' ogni maschera resta di 8 word e le maschere prodotte da un
// sottosistema restano leggibili dagli altri.
assert.equal(DOCUMENT_TILE_GRID_SIZE, 16, at("La griglia tile deve restare 16×16"));
assert.equal(
  DOCUMENT_TILE_WIDTH,
  Math.ceil(DOCUMENT_WIDTH / DOCUMENT_TILE_GRID_SIZE),
  at("La larghezza tile deve coprire il documento"),
);
assert.equal(
  DOCUMENT_TILE_HEIGHT,
  Math.ceil(DOCUMENT_HEIGHT / DOCUMENT_TILE_GRID_SIZE),
  at("L'altezza tile deve coprire il documento"),
);
assert.equal(
  DOCUMENT_TILE_SIZE,
  Math.max(DOCUMENT_TILE_WIDTH, DOCUMENT_TILE_HEIGHT),
  at("Il lato tile compatibile deve essere il massimo dei due assi"),
);
assert.equal(
  DOCUMENT_TILE_MASK_WORDS,
  DOCUMENT_TILE_GRID_SIZE ** 2 / 32,
  at("La maschera tile deve contenere un bit per tile"),
);

for (
  const [label, gridSize, tileWidth, tileHeight, tileSize, maskWords] of [
    [
      "Selezione",
      SELECTION_TILE_GRID_SIZE,
      SELECTION_TILE_WIDTH,
      SELECTION_TILE_HEIGHT,
      SELECTION_TILE_SIZE,
      SELECTION_TILE_MASK_WORDS,
    ],
    [
      "Riempimento",
      FILL_TILE_GRID_SIZE,
      FILL_TILE_WIDTH,
      FILL_TILE_HEIGHT,
      FILL_TILE_SIZE,
      FILL_TILE_MASK_WORDS,
    ],
    [
      "cold storage",
      LAYER_STORAGE_GRID_SIZE,
      LAYER_STORAGE_TILE_WIDTH,
      LAYER_STORAGE_TILE_HEIGHT,
      LAYER_STORAGE_TILE_SIZE,
      LAYER_STORAGE_MASK_WORD_COUNT,
    ],
    [
      "transform",
      RASTER_TRANSFORM_TILE_GRID_SIZE,
      RASTER_TRANSFORM_TILE_SIZE,
      RASTER_TRANSFORM_TILE_SIZE,
      RASTER_TRANSFORM_TILE_SIZE,
      DOCUMENT_TILE_MASK_WORDS,
    ],
  ]
) {
  assert.equal(gridSize, DOCUMENT_TILE_GRID_SIZE, at(`Griglia tile ${label} disallineata`));
  assert.equal(tileWidth, DOCUMENT_TILE_WIDTH, at(`Larghezza tile ${label} disallineata`));
  assert.equal(tileHeight, DOCUMENT_TILE_HEIGHT, at(`Altezza tile ${label} disallineata`));
  assert.equal(tileSize, DOCUMENT_TILE_SIZE, at(`Lato tile ${label} disallineato`));
  assert.equal(maskWords, DOCUMENT_TILE_MASK_WORDS, at(`Maschera tile ${label} disallineata`));
}

assert.equal(
  LAYER_STORAGE_TILE_COUNT,
  DOCUMENT_TILE_GRID_SIZE ** 2,
  at("Il cold storage deve restare a 256 tile per livello"),
);
assert.equal(
  LAYER_STORAGE_DOCUMENT_WIDTH,
  DOCUMENT_WIDTH,
  at("La larghezza del cold storage deve coincidere col documento"),
);
assert.equal(
  LAYER_STORAGE_DOCUMENT_HEIGHT,
  DOCUMENT_HEIGHT,
  at("L'altezza del cold storage deve coincidere col documento"),
);
assert.equal(
  LAYER_STORAGE_DOCUMENT_SIZE,
  DOCUMENT_MAX_EDGE,
  at("Il lato compatibile del cold storage deve essere il massimo bordo"),
);

// Le maschere tile del motore attraversano davvero i sottosistemi: la maschera
// prodotta dalla Selezione viene passata alle funzioni del transform. Se le due
// griglie divergessero, `requireTileMask` rifiuterebbe la maschera a runtime.
const fullMask = new Uint32Array(SELECTION_TILE_MASK_WORDS).fill(0xFFFF_FFFF);
assert.deepEqual(
  rasterTransformScratchRect(fullMask, LAYER_SIZE),
  { x: 0, y: 0, width: LAYER_SIZE, height: LAYER_SIZE },
  at("Il transform deve accettare una maschera tile della Selezione"),
);

// --- Taglie derivate dei sottosistemi ---------------------------------------
assert.equal(FILL_LAYER_SIZE, LAYER_SIZE, at("Il Riempimento deve seguire il documento"));
assert.equal(FILL_LAYER_WIDTH, DOCUMENT_WIDTH, at("Larghezza Riempimento disallineata"));
assert.equal(FILL_LAYER_HEIGHT, DOCUMENT_HEIGHT, at("Altezza Riempimento disallineata"));
assert.equal(
  SELECTION_LAYER_SIZE,
  LAYER_SIZE,
  at("La Selezione deve seguire il documento"),
);
assert.equal(SELECTION_LAYER_WIDTH, DOCUMENT_WIDTH, at("Larghezza Selezione disallineata"));
assert.equal(SELECTION_LAYER_HEIGHT, DOCUMENT_HEIGHT, at("Altezza Selezione disallineata"));
assert.equal(
  RASTER_TRANSFORM_DOCUMENT_SIZE,
  LAYER_SIZE,
  at("Il transform deve seguire il documento"),
);
assert.equal(
  DRY_BLEND_DEFAULT_DOCUMENT_SIZE,
  LAYER_SIZE,
  at("Il Blend dry deve seguire il documento"),
);
assert.equal(
  FILL_BLOCK_GRID_WIDTH,
  Math.ceil(DOCUMENT_WIDTH / FILL_BLOCK_SIZE),
  at("La griglia blocchi X del Riempimento deve coprire il documento"),
);
assert.equal(
  FILL_BLOCK_GRID_HEIGHT,
  Math.ceil(DOCUMENT_HEIGHT / FILL_BLOCK_SIZE),
  at("La griglia blocchi Y del Riempimento deve coprire il documento"),
);
assert.equal(
  FILL_BLOCK_GRID_SIZE,
  Math.max(FILL_BLOCK_GRID_WIDTH, FILL_BLOCK_GRID_HEIGHT),
  at("La griglia blocchi compatibile deve essere il massimo asse"),
);
assert.equal(
  FILL_BLOCK_COUNT,
  FILL_BLOCK_GRID_WIDTH * FILL_BLOCK_GRID_HEIGHT,
  at("Il conteggio blocchi deve derivare dalla griglia"),
);
assert.equal(
  FILL_HISTORY_WORDS_PER_ROW,
  Math.ceil(DOCUMENT_WIDTH / 32),
  at("La riga History del Riempimento deve coprire la larghezza"),
);
assert.equal(
  FILL_HISTORY_MASK_BYTES,
  Math.ceil(DOCUMENT_WIDTH / 32) * DOCUMENT_HEIGHT * 4,
  at("La maschera 1-bit del Riempimento deve coprire il documento"),
);
assert.equal(
  FILL_RENDER_MASK_WORDS_PER_ROW,
  Math.ceil(DOCUMENT_WIDTH / 8),
  at("La riga render del Riempimento deve coprire la larghezza"),
);
assert.equal(
  FILL_RENDER_MASK_BYTES,
  Math.ceil(DOCUMENT_WIDTH / 8) * DOCUMENT_HEIGHT * 4,
  at("La mask render low-8-bit deve coprire ogni pixel senza usare bit 31"),
);
assert.ok(
  FILL_RENDER_MASK_BYTES <= FILL_LABEL_BUFFER_BYTES,
  at("La mask render deve entrare nel buffer label riutilizzato"),
);
assert.equal(
  SELECTION_WORDS_PER_ROW,
  Math.ceil(DOCUMENT_WIDTH / 32),
  at("La riga della bitmask Selezione deve coprire il documento"),
);
assert.equal(
  SELECTION_MASK_BYTES,
  Math.ceil(DOCUMENT_WIDTH / 32) * DOCUMENT_HEIGHT * 4,
  at("La bitmask Selezione deve coprire il documento"),
);
