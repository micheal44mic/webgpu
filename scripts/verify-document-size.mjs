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
// Il modello deve essere una funzione pura delle dimensioni, non della costante
// globale: e' cio' che lo rende gia' corretto per un canvas personalizzato.
for (const [format, bytesPerPixel] of [["rgba8unorm", 4], ["rgba16float", 8]]) {
  assert.equal(
    layerBaseMemoryMiB(format),
    LAYER_SIZE * LAYER_SIZE * bytesPerPixel / MEBIBYTE,
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

// L'accumulatore Light Glaze e' full-document e il suo costo dipende dalla
// modalita' di storage, non dal formato del livello. Il `128` cablato qui
// faceva riportare al pannello `137,3 MiB` invece di `41,3` su un telefono a
// 2048² (misurato su hardware reale il 6 agosto 2026, Sites 137).
for (const [storageMode, accumulatorBytesPerPixel] of [
  ["r8-coverage", 1],
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

// Il caso esatto letto sul telefono, tenuto come ancora di regressione.
// Accumulatore rgba16float full-document (32 MiB) + piramide mip del livello
// rgba8 + commit tile 1024² rgba8 (4 MiB). Il totale sta appena sopra 41 MiB;
// col `128` cablato il pannello ne dichiarava 137,3.
{
  const pyramidBytes = Array.from({ length: 11 }, (_, index) => (2048 >> (index + 1)) ** 2)
    .reduce((sum, pixels) => sum + pixels, 0) * 4;
  const atteso = (2048 * 2048 * 8) / MEBIBYTE + pyramidBytes / MEBIBYTE + 4;
  assert.equal(
    lightGlazeAdditionalMemoryMiB("rgba8unorm", "rgba16float-stroke", { width: 2048, height: 2048 }),
    atteso,
    at("Il caso misurato su telefono deve valere ~41,33 MiB, non 137,33"),
  );
  assert.ok(atteso > 41 && atteso < 42, "ancora di regressione fuori intervallo");
  assert.ok(atteso < 137, "il caso telefono non deve tornare al valore cablato");
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

  const texture = (format, width, height, mipLevelCount = 1, depthOrArrayLayers = 1) =>
    ({ format, width, height, mipLevelCount, depthOrArrayLayers });

  // Mip singolo, per formato.
  for (const [format, bytesPerPixel] of Object.entries(GPU_FORMAT_BYTES_PER_PIXEL)) {
    assert.equal(
      gpuTextureBytes(texture(format, 2048, 2048)),
      2048 * 2048 * bytesPerPixel,
      at(`Byte per pixel errati per ${format}`),
    );
  }
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
  // Un formato sconosciuto non deve essere inventato: vale zero e viene segnalato.
  assert.equal(gpuTextureBytes(texture("formato-inesistente", 512, 512)), 0);

  const voci = [
    { path: "a", label: "", kind: "texture", format: "rgba8unorm", width: 2048, height: 2048,
      layers: 1, mipLevelCount: 1, bytes: 2048 * 2048 * 4 },
    { path: "b", label: "", kind: "buffer", format: null, width: 0, height: 0, layers: 0,
      mipLevelCount: 0, bytes: 4 * MEBIBYTE },
    { path: "c", label: "", kind: "texture", format: "formato-inesistente", width: 4, height: 4,
      layers: 1, mipLevelCount: 1, bytes: 0 },
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
    GPU_RESOURCE_REGISTRY_STRATEGY,
    GpuResourceRegistry,
    categoriseGpuResource,
    textureDescriptorBytes,
  } = await import("../src/gpu-resource-registry.ts");

  assert.equal(
    GPU_RESOURCE_REGISTRY_STRATEGY,
    "device-intercepted-exact-descriptor-bytes-label-categorised-v1",
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
    ["2048² authoritative paint layer rgba8unorm", "Livelli raster"],
    ["Lazy Light Glaze stroke accumulator rgba16float", "Light Glaze"],
    ["Lazy Light Glaze composited logical mip 1+ rgba8unorm", "Light Glaze"],
    ["Smusso Heightfield V2 persistent R32F", "Smusso"],
    ["Smusso alpha threshold/fractional class mask", "Smusso"],
    ["Traccia persistent packed R8 coverage", "Traccia"],
    // Una piramide posseduta da un effetto sta con l'effetto: se finisse in
    // `Piramidi mip` la Traccia sembrerebbe costare 5 MiB meno del vero.
    ["Traccia styled derived mip 1+ rgba8unorm", "Traccia"],
    ["Banco effetti scratch condiviso 16777216 byte", "Banco effetti · scratch"],
    ["Cronologia raster GPU · pagina 1 · 2097152 B", "Cronologia raster"],
    ["Persistent presentation cache 786×1704", "Presentazione"],
    ["Single active-layer display pyramid rgba8unorm", "Piramidi mip"],
    ["Cold tile History livello 1 #3", "Livelli · cold storage"],
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
      ["2048² authoritative paint layer rgba8unorm", 16 * MEBIBYTE],
      ["Smusso Heightfield V2 persistent R32F", 16 * MEBIBYTE],
      ["Banco effetti scratch condiviso 16777216 byte", 16 * MEBIBYTE],
      ["etichetta che nessuna regola conosce", 3 * MEBIBYTE],
    ];
    for (const [label, bytes] of etichette) {
      partizione.register({
        kind: "texture", label, category: categoriseGpuResource(label), bytes,
        format: "rgba8unorm", width: 0, height: 0, layers: 1, mipLevelCount: 1,
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
    format: kind === "texture" ? "rgba8unorm" : null,
    width: 0, height: 0, layers: 1, mipLevelCount: 1, unmeasurable: false,
  });
  const risorsaA = {}, risorsaB = {};
  const idA = registro.register(voce("2048² authoritative paint layer rgba8unorm", 16 * MEBIBYTE), risorsaA);
  registro.register(voce("Traccia scratch", 4 * MEBIBYTE, "buffer"), risorsaB);
  let istantanea = registro.snapshot();
  assert.equal(istantanea.totalBytes, 20 * MEBIBYTE);
  assert.equal(istantanea.textureBytes, 16 * MEBIBYTE);
  assert.equal(istantanea.bufferBytes, 4 * MEBIBYTE);
  assert.equal(istantanea.liveCount, 2);
  assert.equal(istantanea.createdCount, 2);
  assert.equal(istantanea.destroyedCount, 0);
  assert.equal(istantanea.categories[0].category, "Livelli raster");

  registro.release(idA, risorsaA);
  istantanea = registro.snapshot();
  assert.equal(istantanea.totalBytes, 4 * MEBIBYTE, at("La distruzione deve togliere i byte"));
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
    unmeasurable: true,
  }, {});
  const conIgnoto = registroIgnoto.snapshot();
  assert.equal(conIgnoto.unmeasurableCount, 1);
  assert.deepEqual(conIgnoto.unmeasurableFormats, ["astc-4x4-unorm"]);
  assert.equal(conIgnoto.totalBytes, 0);
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
