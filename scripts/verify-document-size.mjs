// La taglia del documento non e' piu' una costante letterale: `LAYER_SIZE` la
// decide al boot (2048 sui telefoni, 4096 altrove). Questa suite gira gli
// invarianti derivati a ENTRAMBE le taglie rilanciando se' stessa con
// `BRUSH_DOCUMENT_SIZE`, e asserisce in forma relativa a `LAYER_SIZE`: un
// numero assoluto qui tornerebbe a cablare 4096 dalla porta di servizio.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DOCUMENT_SIZES = [2048, 4096];

if (!process.env.BRUSH_DOCUMENT_SIZE) {
  for (const documentSize of DOCUMENT_SIZES) {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(import.meta.url)],
      {
        stdio: "inherit",
        env: { ...process.env, BRUSH_DOCUMENT_SIZE: String(documentSize) },
      },
    );
    assert.equal(
      result.status,
      0,
      `Gli invarianti del documento falliscono a ${documentSize}².`,
    );
  }
  console.log(`document:verify ok (${DOCUMENT_SIZES.map((s) => `${s}²`).join(", ")})`);
  process.exit(0);
}

const { readFileSync } = await import("node:fs");
const {
  DOCUMENT_TILE_GRID_SIZE,
  DOCUMENT_TILE_MASK_WORDS,
  DOCUMENT_TILE_SIZE,
  LAYER_SIZE,
  LIGHT_GLAZE_COMMIT_TILE_EXTENT,
  LIGHT_GLAZE_COMMIT_TILE_SLOT_COUNT,
  PAINT_DISPLAY_MIP_LEVEL_COUNT,
  THICKNESS_TAIL_MAXIMUM_TEXTURE_DIMENSION,
} = await import("../src/engine-limits.ts");
const {
  FILL_BLOCK_COUNT,
  FILL_BLOCK_GRID_SIZE,
  FILL_BLOCK_SIZE,
  FILL_BLOCKS_PER_TILE,
  FILL_HISTORY_MASK_BYTES,
  FILL_LAYER_SIZE,
  FILL_TILE_GRID_SIZE,
  FILL_TILE_MASK_WORDS,
  FILL_TILE_SIZE,
} = await import("../src/fill-core.ts");
const {
  SELECTION_LAYER_SIZE,
  SELECTION_MASK_BYTES,
  SELECTION_TILE_GRID_SIZE,
  SELECTION_TILE_MASK_WORDS,
  SELECTION_TILE_SIZE,
  SELECTION_WORDS_PER_ROW,
} = await import("../src/selection-core.ts");
const {
  LAYER_STORAGE_DOCUMENT_SIZE,
  LAYER_STORAGE_GRID_SIZE,
  LAYER_STORAGE_MASK_WORD_COUNT,
  LAYER_STORAGE_TILE_COUNT,
  LAYER_STORAGE_TILE_SIZE,
} = await import("../src/layer-storage-study.ts");
const {
  RASTER_TRANSFORM_DOCUMENT_SIZE,
  RASTER_TRANSFORM_TILE_GRID_SIZE,
  RASTER_TRANSFORM_TILE_SIZE,
  rasterTransformScratchRect,
} = await import("../src/raster-transform-math.ts");
const { DRY_BLEND_DEFAULT_DOCUMENT_SIZE } = await import("../src/blend-core.ts");
const { layerBaseMemoryMiB } = await import("../src/engine-memory-model.ts");

const expected = Number(process.env.BRUSH_DOCUMENT_SIZE);
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const at = (label) => `${label} @ documento ${LAYER_SIZE}²`;

// --- L'override deve davvero cambiare la taglia -----------------------------
// Senza questa asserzione l'intera suite girerebbe due volte a 4096 e passerebbe
// senza aver mai esercitato la configurazione mobile.
assert.equal(LAYER_SIZE, expected, at("BRUSH_DOCUMENT_SIZE non ha avuto effetto"));
assert.ok(
  DOCUMENT_SIZES.includes(LAYER_SIZE),
  at("La taglia del documento deve restare una delle due previste"),
);

// --- Piramide display -------------------------------------------------------
assert.equal(
  PAINT_DISPLAY_MIP_LEVEL_COUNT,
  Math.log2(LAYER_SIZE) + 1,
  at("La catena mip deve scendere fino a 1×1"),
);
assert.equal(
  THICKNESS_TAIL_MAXIMUM_TEXTURE_DIMENSION,
  LAYER_SIZE,
  at("La coda thickness non puo' eccedere il documento"),
);
assert.equal(
  LIGHT_GLAZE_COMMIT_TILE_SLOT_COUNT,
  (LAYER_SIZE / LIGHT_GLAZE_COMMIT_TILE_EXTENT) ** 2,
  at("Gli slot di commit Light Glaze devono coprire il documento"),
);

// --- Griglia tile condivisa -------------------------------------------------
// L'invariante e' che il documento sia SEMPRE diviso 16×16: e' il lato del tile
// a scalare. Cosi' ogni maschera resta di 8 word e le maschere prodotte da un
// sottosistema restano leggibili dagli altri.
assert.equal(DOCUMENT_TILE_GRID_SIZE, 16, at("La griglia tile deve restare 16×16"));
assert.equal(
  DOCUMENT_TILE_SIZE * DOCUMENT_TILE_GRID_SIZE,
  LAYER_SIZE,
  at("I tile devono ricoprire esattamente il documento"),
);
assert.equal(
  DOCUMENT_TILE_MASK_WORDS,
  DOCUMENT_TILE_GRID_SIZE ** 2 / 32,
  at("La maschera tile deve contenere un bit per tile"),
);

for (
  const [label, gridSize, tileSize, maskWords] of [
    ["Selezione", SELECTION_TILE_GRID_SIZE, SELECTION_TILE_SIZE, SELECTION_TILE_MASK_WORDS],
    ["Riempimento", FILL_TILE_GRID_SIZE, FILL_TILE_SIZE, FILL_TILE_MASK_WORDS],
    [
      "cold storage",
      LAYER_STORAGE_GRID_SIZE,
      LAYER_STORAGE_TILE_SIZE,
      LAYER_STORAGE_MASK_WORD_COUNT,
    ],
    [
      "transform",
      RASTER_TRANSFORM_TILE_GRID_SIZE,
      RASTER_TRANSFORM_TILE_SIZE,
      DOCUMENT_TILE_MASK_WORDS,
    ],
  ]
) {
  assert.equal(gridSize, DOCUMENT_TILE_GRID_SIZE, at(`Griglia tile ${label} disallineata`));
  assert.equal(tileSize, DOCUMENT_TILE_SIZE, at(`Lato tile ${label} disallineato`));
  assert.equal(maskWords, DOCUMENT_TILE_MASK_WORDS, at(`Maschera tile ${label} disallineata`));
}

assert.equal(
  LAYER_STORAGE_TILE_COUNT,
  DOCUMENT_TILE_GRID_SIZE ** 2,
  at("Il cold storage deve restare a 256 tile per livello"),
);
assert.equal(
  LAYER_STORAGE_DOCUMENT_SIZE,
  LAYER_SIZE,
  at("Il documento del cold storage deve coincidere col documento"),
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
assert.equal(
  SELECTION_LAYER_SIZE,
  LAYER_SIZE,
  at("La Selezione deve seguire il documento"),
);
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
  FILL_BLOCK_GRID_SIZE,
  LAYER_SIZE / FILL_BLOCK_SIZE,
  at("La griglia blocchi del Riempimento deve coprire il documento"),
);
assert.equal(
  FILL_BLOCK_COUNT,
  FILL_BLOCK_GRID_SIZE ** 2,
  at("Il conteggio blocchi deve derivare dalla griglia"),
);
assert.equal(
  FILL_BLOCKS_PER_TILE,
  FILL_TILE_SIZE / FILL_BLOCK_SIZE,
  at("I blocchi per tile del Riempimento devono derivare dal lato del tile"),
);
assert.equal(
  FILL_HISTORY_MASK_BYTES,
  LAYER_SIZE * LAYER_SIZE / 8,
  at("La maschera 1-bit del Riempimento deve coprire il documento"),
);
assert.equal(
  SELECTION_WORDS_PER_ROW,
  LAYER_SIZE / 32,
  at("La riga della bitmask Selezione deve coprire il documento"),
);
assert.equal(
  SELECTION_MASK_BYTES,
  LAYER_SIZE * LAYER_SIZE / 8,
  at("La bitmask Selezione deve coprire il documento"),
);

// --- Modello di memoria dichiarato ------------------------------------------
for (const [format, bytesPerPixel] of [["rgba8unorm", 4], ["rgba16float", 8]]) {
  assert.equal(
    layerBaseMemoryMiB(format),
    LAYER_SIZE * LAYER_SIZE * bytesPerPixel / (1024 * 1024),
    at(`La memoria dichiarata del livello ${format} deve derivare dal documento`),
  );
}

// --- Nessun 4096 residuo nel WGSL -------------------------------------------
// Gli shader interpolano `${LAYER_SIZE}`: a 2048 nessuna stringa emessa deve
// contenere ancora l'estensione del documento precedente.
if (LAYER_SIZE !== 4096) {
  const {
    fillComputeShader,
    fillRenderShader,
    fillSelectionIntersectionShader,
  } = await import("../src/fill-shaders.ts");
  const {
    selectionComputeShader,
    selectionOverlayShader,
  } = await import("../src/selection-shaders.ts");
  const emittedShaders = [
    ["fill compute", fillComputeShader],
    ["fill render", fillRenderShader],
    ["fill selection intersection", fillSelectionIntersectionShader],
    ["selection compute", selectionComputeShader],
    ["selection overlay", selectionOverlayShader],
  ];
  for (const [label, code] of emittedShaders) {
    assert.ok(
      typeof code === "string" && code.length > 0,
      at(`Shader ${label} vuoto: il controllo sul 4096 residuo sarebbe inerte`),
    );
    assert.ok(
      !/\b4096\b/.test(code),
      at(`Lo shader ${label} contiene ancora un 4096 cablato`),
    );
  }
}

// Il compositore mixed-scene e il compositore a tile della fusione non passano
// da Node (importano moduli WebGPU): li controlliamo sul sorgente, perche' un
// 4096 cablato li' e' esattamente il difetto che questa suite deve intercettare.
for (
  const [path, pattern, message] of [
    [
      "../src/mixed-scene-compositor-shader.ts",
      /all\(layerPosition < vec2<f32>\(\$\{LAYER_SIZE\}\.0\)\)/,
      "il compositore mixed-scene deve interpolare LAYER_SIZE",
    ],
    [
      "../src/layer-blend-tile-compositor.ts",
      /this\.mipUniformU32\[word \+ 2\] = LAYER_SIZE;\n\s*this\.mipUniformU32\[word \+ 3\] = LAYER_SIZE;/,
      "l'uniforme mip della fusione a tile deve usare LAYER_SIZE",
    ],
    [
      "../src/fill-shaders.ts",
      /let coldTile = \(block\.y \/ \$\{FILL_BLOCKS_PER_TILE\}u\)/,
      "il tile freddo del Riempimento deve derivare dai blocchi per tile",
    ],
  ]
) {
  assert.match(read(path), pattern, at(message));
}

console.log(`  documento ${LAYER_SIZE}²: invarianti ok`);
