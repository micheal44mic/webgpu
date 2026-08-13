import assert from "node:assert/strict";
import { DOCUMENT_HEIGHT, DOCUMENT_WIDTH, MEBIBYTE, at } from "./profile-context.mjs";
const {
  documentMipLevelCount,
  layerBaseMemoryMiB,
  lightGlazeAccumulatorBytesPerPixel,
  lightGlazeAdditionalMemoryMiB,
  paintDisplayPyramidAdditionalMemoryMiB,
} = await import("../../../src/engine-memory-model.ts");

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
