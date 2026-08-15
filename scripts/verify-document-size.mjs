// Il documento espone larghezza e altezza indipendenti. Questa suite conserva
// i due profili quadrati storici (2048 telefono, 4096 desktop/legacy), mentre
// `verify-custom-document-dimensions.mjs` esercita la matrice rettangolare.
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
} = await import("../src/engine-limits.ts");
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
} = await import("../src/fill-core.ts");
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
} = await import("../src/selection-core.ts");
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
} = await import("../src/layer-storage-study.ts");
const {
  RASTER_TRANSFORM_DOCUMENT_SIZE,
  RASTER_TRANSFORM_TILE_GRID_SIZE,
  RASTER_TRANSFORM_TILE_SIZE,
  rasterTransformScratchRect,
} = await import("../src/raster-transform-math.ts");
const { DRY_BLEND_DEFAULT_DOCUMENT_SIZE } = await import("../src/blend-core.ts");
const {
  documentMipLevelCount,
  layerBaseMemoryMiB,
  lightGlazeAccumulatorBytesPerPixel,
  lightGlazeAdditionalMemoryMiB,
  paintDisplayPyramidAdditionalMemoryMiB,
} = await import("../src/engine-memory-model.ts");
const MEBIBYTE = 1024 * 1024;

const expected = Number(process.env.BRUSH_DOCUMENT_SIZE);
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const at = (label) => `${label} @ documento ${DOCUMENT_WIDTH}×${DOCUMENT_HEIGHT}`;

// --- L'override deve davvero cambiare la taglia -----------------------------
// Senza questa asserzione l'intera suite girerebbe due volte a 4096 e passerebbe
// senza aver mai esercitato la configurazione mobile.
assert.equal(LAYER_SIZE, expected, at("BRUSH_DOCUMENT_SIZE non ha avuto effetto"));
assert.equal(DOCUMENT_WIDTH, expected, at("Il profilo storico deve impostare la larghezza"));
assert.equal(DOCUMENT_HEIGHT, expected, at("Il profilo storico deve impostare l'altezza"));
assert.equal(DOCUMENT_MAX_EDGE, expected, at("Il massimo bordo del profilo e' errato"));
assert.ok(
  DOCUMENT_SIZES.includes(LAYER_SIZE),
  at("La taglia del documento deve restare una delle due previste"),
);

// --- Il formato del documento non e' piu' selezionabile ---------------------
// Il canvas di presentazione puo' restare nel formato preferito dal browser,
// ma livelli, storia e composizione devono partire sempre da RGBA16F. Questi
// guardrail impediscono di reintrodurre per errore il vecchio downgrade UI.
{
  const indexSource = read("../index.html");
  const mainSource = read("../src/main.ts");
  const brushEngineSource = read("../src/brush-engine.ts");
  assert.doesNotMatch(
    indexSource,
    /id="layerFormat"|data-layer-format-label/,
    at("un formato permanente non deve avere un finto controllo UI"),
  );
  assert.doesNotMatch(
    indexSource,
    /<option value="rgba8unorm"/,
    at("il selettore precisione non deve offrire RGBA8"),
  );
  assert.match(
    brushEngineSource,
    /layerFormat: LayerFormat = "rgba16float";/,
    at("BrushEngine deve possedere il default autorevole RGBA16F"),
  );
  assert.doesNotMatch(
    mainSource,
    /engine\.layerFormat\s*=/,
    at("main non deve sovrascrivere il formato autorevole di BrushEngine"),
  );
  assert.doesNotMatch(
    mainSource,
    /layerFormatSelect|setLayerFormat\(/,
    at("la UI non deve fingere di poter cambiare il formato del documento"),
  );
  assert.doesNotMatch(
    mainSource,
    /MOBILE_DEVICE_CLASS/,
    at("non deve esistere un override mobile o un downgrade formato dalla UI"),
  );
  assert.doesNotMatch(
    brushEngineSource,
    /\bsetLayerFormat\(/,
    at("l'API di cambio formato irraggiungibile deve restare rimossa"),
  );
}

// --- Fixture memoria coerenti col documento RGBA16F -------------------------
{
  const iphoneSource = read("../src/labs/memory/iphone-memory-limit-test.ts");
  const stressSource = read("../src/labs/memory/layer-memory-stress-test.ts");
  const mixedSource = read("../src/labs/memory/mixed-memory-benchmark.ts");
  const labOperationsSource = read("../src/labs/engine-lab-operations.ts");
  const reportsSource = read("../src/engine-reports.ts");
  assert.match(
    iphoneSource,
    /TILE_MEMORY_MIB_RGBA16F\s*=\s*\n?\s*LAYER_STORAGE_TILE_WIDTH \* LAYER_STORAGE_TILE_HEIGHT\s*\* RGBA16F_BYTES_PER_PIXEL \/ MEBIBYTE_BYTES;/,
    at("il fixture iPhone deve derivare il costo tile RGBA16F da 8 Bpp"),
  );
  assert.doesNotMatch(
    iphoneSource,
    /LAYER_STORAGE_TILE_SIZE \*\* 2/,
    at("il fixture iPhone non deve trasformare un tile rettangolare in un quadrato"),
  );
  assert.match(
    iphoneSource,
    /initialStats\.layerFormat !== "rgba16float"/,
    at("il fixture iPhone deve richiedere il documento RGBA16F reale"),
  );
  assert.match(
    stressSource,
    /initial\.layerFormat !== "rgba16float"/,
    at("lo stress livelli deve richiedere RGBA16F"),
  );
  assert.match(
    mixedSource,
    /initial\.layerFormat !== "rgba16float"/,
    at("lo scenario misto deve richiedere RGBA16F"),
  );
  assert.match(
    mixedSource,
    /const rgba16fColdTileMiB = layerStorageTileMemoryMiB\(1, 8\);/,
    at("lo scenario misto deve derivare il costo del tile RGBA16F"),
  );
  assert.match(
    mixedSource,
    /Math\.ceil\(remainingMiB \/ rgba16fColdTileMiB\)/,
    at("lo scenario misto deve derivare quanti tile RGBA16F servono al target"),
  );
  assert.match(
    labOperationsSource,
    /const pixels = new Uint16Array\(markerSize \* markerSize \* 4\);[\s\S]{0,700}bytesPerRow: markerSize \* 8/,
    at("il marker stress deve caricare pixel half-float con stride RGBA16F"),
  );
  assert.match(
    labOperationsSource,
    /const markerCellWidth = DOCUMENT_WIDTH \/ 4;\s*const markerCellHeight = DOCUMENT_HEIGHT \/ 4;/,
    at("il marker stress deve distribuire le celle su entrambi gli assi"),
  );
  assert.match(
    labOperationsSource,
    /analytic\.length !== live\.length \* 2[\s\S]{0,1800}decodeFloat16/,
    at("la diagnostica fwidth deve decodificare il readback RGBA16F"),
  );
}

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

// --- Modello di memoria dichiarato ------------------------------------------
// Il modello deve essere una funzione pura delle dimensioni, non della costante
// globale: e' cio' che lo rende gia' corretto per un canvas personalizzato.
for (const [format, bytesPerPixel] of [["rgba8unorm", 4], ["rgba16float", 8]]) {
  assert.equal(
    layerBaseMemoryMiB(format),
    DOCUMENT_WIDTH * DOCUMENT_HEIGHT * bytesPerPixel / MEBIBYTE,
    at(`La memoria dichiarata del livello ${format} deve derivare dal documento`),
  );
  // Taglie arbitrarie: non quadrate, non potenze di due, piu' grandi e piu'
  // piccole del documento corrente. Se una qualsiasi di queste sbaglia, il
  // pannello mentira' il giorno in cui il canvas diventa configurabile.
  for (const [width, height] of [[3000, 1800], [1024, 4096], [777, 333], [8192, 8192]]) {
    assert.equal(
      layerBaseMemoryMiB(format, { width, height }),
      width * height * bytesPerPixel / MEBIBYTE,
      at(`Il livello ${format} deve misurare ${width}×${height} senza cablature`),
    );
    // La piramide e' la somma esatta dei mip 1+, per asse, con clamp a 1.
    const levels = documentMipLevelCount({ width, height });
    assert.equal(levels, Math.floor(Math.log2(Math.max(width, height))) + 1);
    let pyramidPixels = 0;
    for (let level = 1; level < levels; level += 1) {
      pyramidPixels += Math.max(1, width >> level) * Math.max(1, height >> level);
    }
    assert.equal(
      paintDisplayPyramidAdditionalMemoryMiB(format, { width, height }),
      pyramidPixels * bytesPerPixel / MEBIBYTE,
      at(`La piramide ${format} deve misurare ${width}×${height} senza cablature`),
    );
  }
}
assert.equal(
  layerBaseMemoryMiB("rgba16float", { width: 2048, height: 2048 }),
  32,
  "Un layer RGBA16F 2048² deve costare esattamente 32 MiB",
);
assert.equal(
  layerBaseMemoryMiB("rgba16float", { width: 4096, height: 4096 }),
  128,
  "Un layer RGBA16F 4096² deve costare esattamente 128 MiB",
);

// L'accumulatore Light Glaze e' full-document e il suo costo dipende dalla
// modalita' di storage, non dal formato del livello. Il `128` cablato qui
// faceva riportare al pannello `137,3 MiB` invece di `41,3` su un telefono a
// 2048² (misurato su hardware reale il 6 agosto 2026, Sites 137).
for (const [storageMode, accumulatorBytesPerPixel] of [
  ["r16float-coverage", 2],
  ["rgba16float-stroke", 8],
]) {
  assert.equal(
    lightGlazeAccumulatorBytesPerPixel(storageMode),
    accumulatorBytesPerPixel,
    at(`Byte per pixel dell'accumulatore ${storageMode} errati`),
  );
  for (const format of ["rgba8unorm", "rgba16float"]) {
    for (const [width, height] of [[2048, 2048], [4096, 4096], [3000, 1800]]) {
      const commitTileMiB = storageMode === "rgba16float-stroke"
        ? 1024 * 1024 * (format === "rgba16float" ? 8 : 4) / MEBIBYTE
        : 0;
      const atteso = width * height * accumulatorBytesPerPixel / MEBIBYTE
        + paintDisplayPyramidAdditionalMemoryMiB(format, { width, height })
        + commitTileMiB;
      assert.equal(
        lightGlazeAdditionalMemoryMiB(format, storageMode, { width, height }),
        atteso,
        at(`Light Glaze ${storageMode}/${format} a ${width}×${height} non deriva dal documento`),
      );
    }
  }
}
assert.equal(lightGlazeAdditionalMemoryMiB("rgba8unorm", "none", { width: 4096, height: 4096 }), 0);

// Ancore del profilo universale RGBA16F su telefono. Light conserva una matte
// R16F (8 MiB) e Uniformed/Intense un accumulatore RGBA16F (32 MiB); entrambi
// condividono la piramide RGBA16F e solo il secondo usa il commit tile da 8 MiB.
{
  const pyramidBytes = Array.from({ length: 11 }, (_, index) => (2048 >> (index + 1)) ** 2)
    .reduce((sum, pixels) => sum + pixels, 0) * 8;
  const lightAtteso = (2048 * 2048 * 2) / MEBIBYTE + pyramidBytes / MEBIBYTE;
  assert.equal(
    lightGlazeAdditionalMemoryMiB("rgba16float", "r16float-coverage", { width: 2048, height: 2048 }),
    lightAtteso,
    at("Light RGBA16F/R16F mobile deve valere ~18,67 MiB"),
  );
  assert.ok(lightAtteso > 18 && lightAtteso < 19, "ancora Light R16F fuori intervallo");
  const intenseAtteso = (2048 * 2048 * 8) / MEBIBYTE + pyramidBytes / MEBIBYTE + 8;
  assert.equal(
    lightGlazeAdditionalMemoryMiB("rgba16float", "rgba16float-stroke", { width: 2048, height: 2048 }),
    intenseAtteso,
    at("Uniformed/Intense RGBA16F mobile deve valere ~50,67 MiB"),
  );
  assert.ok(intenseAtteso > 50 && intenseAtteso < 51, "ancora RGBA16F fuori intervallo");
}

// --- Revisione memoria GPU: dichiarato contro reale --------------------------
// La matematica del revisore deve valere per qualunque texture, non solo per
// quelle che il motore alloca oggi: e' il metro con cui si accorgera' da solo
// che un documento di taglia nuova non e' contabilizzato.
{
  const {
    GPU_FORMAT_BYTES_PER_PIXEL,
    GPU_MEMORY_AUDIT_TOLERANCE_BYTES,
    buildGpuMemoryAuditReport,
    collectGpuMemoryEntries,
    gpuTextureBytes,
  } = await import("../src/gpu-memory-audit.ts");

  const texture = (
    format,
    width,
    height,
    mipLevelCount = 1,
    depthOrArrayLayers = 1,
    sampleCount = 1,
  ) => ({ format, width, height, mipLevelCount, depthOrArrayLayers, sampleCount });

  // Mip singolo, per formato.
  for (const [format, bytesPerPixel] of Object.entries(GPU_FORMAT_BYTES_PER_PIXEL)) {
    assert.equal(
      gpuTextureBytes(texture(format, 2048, 2048)),
      2048 * 2048 * bytesPerPixel,
      at(`Byte per pixel errati per ${format}`),
    );
  }
  assert.equal(
    gpuTextureBytes(texture("rgba32uint", 256, 128)),
    256 * 128 * 16,
    at("la texture dati vettoriali RGBA32Uint deve entrare nel totale corrente/picco"),
  );
  // Catena mip completa: la somma per livello, con clamp a 1 su entrambi gli assi.
  for (const [width, height] of [[2048, 2048], [4096, 4096], [3000, 1800], [777, 333], [1, 1]]) {
    const levels = Math.floor(Math.log2(Math.max(width, height))) + 1;
    let atteso = 0;
    for (let level = 0; level < levels; level += 1) {
      atteso += Math.max(1, width >> level) * Math.max(1, height >> level) * 4;
    }
    assert.equal(
      gpuTextureBytes(texture("rgba8unorm", width, height, levels)),
      atteso,
      at(`Catena mip errata a ${width}×${height}`),
    );
  }
  // Array texture: i tile del cold storage sono strati, non mip.
  assert.equal(
    gpuTextureBytes(texture("rgba8unorm", 128, 128, 1, 256)),
    128 * 128 * 256 * 4,
    at("Gli strati di un array texture devono essere contati"),
  );
  assert.equal(
    gpuTextureBytes(texture("rgba16float", 1024, 512, 1, 1, 4)),
    1024 * 512 * 8 * 4,
    at("Una texture MSAA4 RGBA16F deve contare tutti e quattro i sample"),
  );
  // Un formato sconosciuto non deve essere inventato: vale zero e viene segnalato.
  assert.equal(gpuTextureBytes(texture("formato-inesistente", 512, 512)), 0);

  const voci = [
    { path: "a", label: "", kind: "texture", format: "rgba8unorm", width: 2048, height: 2048,
      layers: 1, mipLevelCount: 1, sampleCount: 1, bytes: 2048 * 2048 * 4 },
    { path: "b", label: "", kind: "buffer", format: null, width: 0, height: 0, layers: 0,
      mipLevelCount: 0, sampleCount: 1, bytes: 4 * MEBIBYTE },
    { path: "c", label: "", kind: "texture", format: "formato-inesistente", width: 4, height: 4,
      layers: 1, mipLevelCount: 1, sampleCount: 1, bytes: 0 },
  ];
  const esatto = buildGpuMemoryAuditReport(voci, 20 * MEBIBYTE);
  assert.equal(esatto.measuredBytes, 20 * MEBIBYTE, at("Somma reale errata"));
  assert.equal(esatto.deltaBytes, 0, at("Scarto nullo atteso quando dichiarato = reale"));
  assert.equal(esatto.textureCount, 2);
  assert.equal(esatto.bufferCount, 1);
  assert.deepEqual(esatto.unknownFormats, ["formato-inesistente"],
    at("I formati non contabilizzabili devono essere segnalati"));

  // Una sotto-dichiarazione oltre la tolleranza deve risultare visibile: e'
  // esattamente il caso "ho aggiunto una risorsa e non l'ho contabilizzata".
  const sotto = buildGpuMemoryAuditReport(voci, 4 * MEBIBYTE);
  assert.equal(sotto.deltaBytes, 16 * MEBIBYTE, at("Sotto-dichiarazione non rilevata"));
  assert.ok(
    sotto.deltaBytes > GPU_MEMORY_AUDIT_TOLERANCE_BYTES,
    at("La tolleranza deve lasciar passare l'arrotondamento, non un livello intero"),
  );
  assert.ok(
    GPU_MEMORY_AUDIT_TOLERANCE_BYTES < layerBaseMemoryMiB("rgba8unorm", { width: 2048, height: 2048 })
      * MEBIBYTE,
    at("La tolleranza non deve poter nascondere un livello non contabilizzato"),
  );

  // Sotto Node non esistono GPUTexture/GPUBuffer: il camminatore deve tornare
  // vuoto senza esplodere, cosi' la suite resta eseguibile fuori dal browser.
  assert.deepEqual(collectGpuMemoryEntries({ a: { b: 1 } }, "radice"), []);
}

// --- Contabilita' GPU misurata ----------------------------------------------
// La contabilita' non e' piu' un modello scritto a mano: si registra ogni
// texture e ogni buffer alla creazione. Questi test coprono la matematica e la
// categorizzazione, cioe' tutto cio' che puo' sbagliare senza una GPU.
{
  const {
    GPU_MEMORY_CATEGORY_ORDER,
    GPU_RESOURCE_REGISTRY_STRATEGY,
    GpuResourceRegistry,
    categoriseGpuResource,
    instrumentGpuDevice,
    textureDescriptorBytes,
  } = await import("../src/gpu-resource-registry.ts");

  assert.equal(
    GPU_RESOURCE_REGISTRY_STRATEGY,
    "device-intercepted-exact-descriptor-bytes-msaa-current-peak-categorised-v2",
  );
  assert.deepEqual(
    GPU_MEMORY_CATEGORY_ORDER.slice(0, 9),
    [
      "Layer RGBA16F",
      "Piramidi mip RGBA16F",
      "Maschere continue R16F",
      "Heightfield R32F",
      "Cache vettoriali",
      "Scratch temporanei",
      "Composite livelli",
      "Cronologia · Undo",
      "Cold storage livelli",
    ],
    at("Il pannello deve esporre le categorie di precisione richieste"),
  );

  // Byte esatti dal descrittore, in tutte le forme che WebGPU accetta per
  // `size`: oggetto completo, oggetto parziale e tupla.
  assert.equal(
    textureDescriptorBytes({ format: "rgba8unorm", size: { width: 2048, height: 2048 } }).bytes,
    2048 * 2048 * 4,
  );
  assert.equal(
    textureDescriptorBytes({ format: "rgba16float", size: [1024, 512] }).bytes,
    1024 * 512 * 8,
  );
  assert.equal(
    textureDescriptorBytes({ format: "rgba32uint", size: [256, 128] }).bytes,
    256 * 128 * 16,
    at("il registro deve contare la texture dati vettoriali RGBA32Uint"),
  );
  assert.equal(
    textureDescriptorBytes({
      format: "rgba16float",
      size: [1024, 512],
      sampleCount: 4,
    }).bytes,
    1024 * 512 * 8 * 4,
    at("Il registro deve moltiplicare le texture MSAA per sampleCount"),
  );
  assert.equal(
    textureDescriptorBytes({ format: "r8unorm", size: { width: 64 } }).bytes,
    64 * 1 * 1,
    at("Una size oggetto senza height deve valere 1, non NaN"),
  );
  // Stessa omissione nella forma tupla: `[64]` e' una texture 64×1, non 64×0.
  // Interpretarla come zero azzererebbe in silenzio una risorsa reale.
  assert.equal(
    textureDescriptorBytes({ format: "r8unorm", size: [64] }).bytes,
    64 * 1 * 1,
    at("Una size tupla senza height deve valere 1, non 0"),
  );
  assert.equal(
    textureDescriptorBytes({ format: "rgba8unorm", size: [32, 16] }).layers,
    1,
    at("Una tupla senza strati deve valere 1"),
  );
  // Le dimensioni riportate finiscono nei record e nella vista di dettaglio:
  // sui byte il clamp le salverebbe, ma un `0` qui sarebbe comunque una bugia.
  assert.deepEqual(
    (({ width, height, layers }) => ({ width, height, layers }))(
      textureDescriptorBytes({ format: "rgba8unorm", size: [64] }),
    ),
    { width: 64, height: 1, layers: 1 },
    at("Le dimensioni riportate da una tupla parziale devono essere 1, non 0"),
  );
  // Strati e mip, che sono i due modi in cui una texture costa piu' del suo
  // rettangolo: i tile del cold storage e le piramidi display.
  assert.equal(
    textureDescriptorBytes({
      format: "rgba8unorm",
      size: { width: 128, height: 128, depthOrArrayLayers: 256 },
    }).bytes,
    128 * 128 * 256 * 4,
  );
  {
    const levels = 11;
    let atteso = 0;
    for (let level = 0; level < levels; level += 1) {
      atteso += Math.max(1, 1024 >> level) * Math.max(1, 1024 >> level) * 4;
    }
    assert.equal(
      textureDescriptorBytes({
        format: "rgba8unorm",
        size: { width: 1024, height: 1024 },
        mipLevelCount: levels,
      }).bytes,
      atteso,
    );
  }
  // Un formato che non sappiamo misurare non deve valere zero in silenzio.
  const ignoto = textureDescriptorBytes({ format: "astc-4x4-unorm", size: { width: 256, height: 256 } });
  assert.equal(ignoto.bytes, 0);
  assert.equal(ignoto.unmeasurable, true, at("Un formato ignoto deve dichiararsi non misurabile"));

  // Categorie: le etichette reali del motore devono finire nel posto giusto,
  // e cio' che non combacia deve restare visibile invece di sparire.
  // Etichette reali osservate nel motore in esecuzione, non inventate.
  for (const [label, categoria] of [
    ["2048² authoritative paint layer rgba16float", "Layer RGBA16F"],
    ["Lazy Light Glaze stroke accumulator r16float", "Maschere continue R16F"],
    ["Lazy Light Glaze composited logical mip 1+ rgba16float", "Piramidi mip RGBA16F"],
    ["Smusso Heightfield V2 persistent R32F", "Heightfield R32F"],
    ["Smusso alpha threshold/fractional class mask", "Effetti raster"],
    ["Traccia persistent packed f16 coverage", "Maschere continue R16F"],
    ["Ombra esterna persistent packed f16 matte", "Maschere continue R16F"],
    ["Traccia styled derived mip 1+ rgba16float", "Piramidi mip RGBA16F"],
    ["Banco effetti scratch condiviso 16777216 byte", "Scratch temporanei"],
    ["Vector text GPU blur scratch A 512×512", "Scratch temporanei"],
    ["Vector text viewport cache 1024×1024", "Cache vettoriali"],
    ["Cronologia raster GPU · pagina 1 · 2097152 B", "Cronologia · Undo"],
    ["Persistent presentation cache 786×1704", "Presentazione"],
    ["Single active-layer display pyramid rgba16float", "Piramidi mip RGBA16F"],
    ["Cold tile History livello 1 #3", "Cronologia · Undo"],
    // Il seed riportato sulla GPU dall'Undo: senza "Cronologia" nell'etichetta
    // finiva in "Non categorizzato", cioe' memoria reale senza una provenienza.
    ["Cronologia checkpoint 7 ripristinato livello 2", "Cronologia · Undo"],
    ["Cold tile livello 2 #7", "Cold storage livelli"],
    ["Cold ripristinato livello 2 #7", "Cold storage livelli"],
    ["Merged below surface (1 layers) rgba16float 2048×2048", "Composite livelli"],
    ["Layer composite opacity", "Composite livelli"],
    ["Brush outline · cached alpha boundary", "Preview pennello"],
    ["", "Non categorizzato"],
    ["qualcosa che non esiste ancora", "Non categorizzato"],
  ]) {
    assert.equal(categoriseGpuResource(label), categoria, at(`Categoria errata per «${label}»`));
  }

  // Le categorie devono **partizionare** il registro: la loro somma e' il
  // totale. E' l'invariante che rende la ripartizione del pannello esatta per
  // costruzione invece che per manutenzione.
  {
    const partizione = new GpuResourceRegistry();
    const etichette = [
      ["2048² authoritative paint layer rgba16float", 32 * MEBIBYTE],
      ["Smusso Heightfield V2 persistent R32F", 16 * MEBIBYTE],
      ["Banco effetti scratch condiviso 16777216 byte", 16 * MEBIBYTE],
      ["etichetta che nessuna regola conosce", 3 * MEBIBYTE],
    ];
    for (const [label, bytes] of etichette) {
      partizione.register({
        kind: "texture", label, category: categoriseGpuResource(label), bytes,
        format: "rgba16float", width: 0, height: 0, layers: 1, mipLevelCount: 1,
        sampleCount: 1,
        unmeasurable: false,
      }, {});
    }
    const istantaneaPartizione = partizione.snapshot();
    assert.equal(
      istantaneaPartizione.categories.reduce((somma, voce) => somma + voce.bytes, 0),
      istantaneaPartizione.totalBytes,
      at("Le categorie devono sommare esattamente al totale del registro"),
    );
    assert.ok(
      istantaneaPartizione.categories.some((voce) => voce.category === "Non categorizzato"),
      at("Una risorsa senza regola deve restare visibile, non sparire dal conto"),
    );
  }

  // Ciclo di vita: creare, distruggere e ricontare. E' la proprieta' che rende
  // il numero automatico — nessuno deve ricordarsi di aggiornare un totale.
  const registro = new GpuResourceRegistry();
  const voce = (label, bytes, kind = "texture") => ({
    kind, label, category: categoriseGpuResource(label), bytes,
    format: kind === "texture" ? "rgba16float" : null,
    width: 0, height: 0, layers: 1, mipLevelCount: 1, sampleCount: 1,
    unmeasurable: false,
  });
  const risorsaA = {}, risorsaB = {};
  const idA = registro.register(voce("2048² authoritative paint layer rgba16float", 32 * MEBIBYTE), risorsaA);
  registro.register(voce("Traccia scratch", 4 * MEBIBYTE, "buffer"), risorsaB);
  let istantanea = registro.snapshot();
  assert.equal(istantanea.currentBytes, 36 * MEBIBYTE);
  assert.equal(istantanea.totalBytes, 36 * MEBIBYTE);
  assert.equal(istantanea.peakBytes, 36 * MEBIBYTE);
  assert.equal(istantanea.textureBytes, 32 * MEBIBYTE);
  assert.equal(istantanea.bufferBytes, 4 * MEBIBYTE);
  assert.equal(istantanea.liveCount, 2);
  assert.equal(istantanea.createdCount, 2);
  assert.equal(istantanea.destroyedCount, 0);
  assert.equal(istantanea.categories[0].category, "Layer RGBA16F");

  registro.release(idA, risorsaA);
  istantanea = registro.snapshot();
  assert.equal(istantanea.totalBytes, 4 * MEBIBYTE, at("La distruzione deve togliere i byte"));
  assert.equal(istantanea.peakBytes, 36 * MEBIBYTE, at("La distruzione non deve abbassare il picco"));
  const layerCategoryAfterRelease = istantanea.categories.find(
    (entry) => entry.category === "Layer RGBA16F",
  );
  assert.equal(layerCategoryAfterRelease?.bytes, 0);
  assert.equal(layerCategoryAfterRelease?.peakBytes, 32 * MEBIBYTE,
    at("Il picco di categoria deve sopravvivere all'ultima distruzione"));
  assert.equal(istantanea.liveCount, 1);
  assert.equal(istantanea.destroyedCount, 1);
  registro.release(idA, risorsaA);
  assert.equal(registro.snapshot().destroyedCount, 1, at("Una doppia distruzione non deve contare due volte"));

  // Le risorse non misurabili sono escluse dal totale ma contate e segnalate:
  // il numero non deve poter mentire per omissione silenziosa.
  const registroIgnoto = new GpuResourceRegistry();
  registroIgnoto.register({
    kind: "texture", label: "compressa", category: "Non categorizzato", bytes: 0,
    format: "astc-4x4-unorm", width: 256, height: 256, layers: 1, mipLevelCount: 1,
    sampleCount: 1,
    unmeasurable: true,
  }, {});
  const conIgnoto = registroIgnoto.snapshot();
  assert.equal(conIgnoto.unmeasurableCount, 1);
  assert.deepEqual(conIgnoto.unmeasurableFormats, ["astc-4x4-unorm"]);
  assert.equal(conIgnoto.totalBytes, 0);

  // Integrazione dell'intercettore: sampleCount entra nel record e destroy()
  // aggiorna il corrente lasciando intatti picco globale e picco di categoria.
  {
    const deviceFinto = {
      createTexture(descriptor) {
        return { label: descriptor.label ?? "", destroy() {} };
      },
      createBuffer(descriptor) {
        return { label: descriptor.label ?? "", destroy() {} };
      },
    };
    const strumentato = instrumentGpuDevice(deviceFinto);
    const textureMsaa = strumentato.device.createTexture({
      label: "Vector text shared MSAA4 color 1024×512",
      format: "rgba16float",
      size: { width: 1024, height: 512, depthOrArrayLayers: 1 },
      sampleCount: 4,
      usage: 0,
    });
    const record = strumentato.registry.records()[0];
    assert.equal(record.sampleCount, 4);
    assert.equal(record.bytes, 1024 * 512 * 8 * 4);
    assert.equal(record.category, "Cache vettoriali");
    textureMsaa.destroy();
    const dopoDestroy = strumentato.registry.snapshot();
    assert.equal(dopoDestroy.currentBytes, 0);
    assert.equal(dopoDestroy.peakBytes, 1024 * 512 * 8 * 4);
    assert.equal(
      dopoDestroy.categories.find((entry) => entry.category === "Cache vettoriali")?.peakBytes,
      1024 * 512 * 8 * 4,
    );
  }
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
      /all\(layerPosition < vec2<f32>\(\$\{DOCUMENT_WIDTH\}\.0, \$\{DOCUMENT_HEIGHT\}\.0\)\)/,
      "il compositore mixed-scene deve interpolare entrambi gli assi",
    ],
    [
      "../src/layer-blend-tile-compositor.ts",
      /this\.mipUniformU32\[word \+ 2\] = DOCUMENT_WIDTH;\n\s*this\.mipUniformU32\[word \+ 3\] = DOCUMENT_HEIGHT;/,
      "l'uniforme mip della fusione a tile deve usare entrambi gli assi",
    ],
    [
      "../src/fill-shaders.ts",
      /reduceMinX\[0\] \/ \$\{FILL_TILE_WIDTH\}u, reduceMinY\[0\] \/ \$\{FILL_TILE_HEIGHT\}u[\s\S]*?\(reduceMaxX\[0\] - 1u\) \/ \$\{FILL_TILE_WIDTH\}u,[\s\S]*?\(reduceMaxY\[0\] - 1u\) \/ \$\{FILL_TILE_HEIGHT\}u/,
      "il Riempimento deve marcare ogni tile rettangolare toccata dai pixel selezionati",
    ],
  ]
) {
  assert.match(read(path), pattern, at(message));
}

console.log(`  documento ${DOCUMENT_WIDTH}×${DOCUMENT_HEIGHT}: invarianti ok`);
