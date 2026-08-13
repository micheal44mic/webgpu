import assert from "node:assert/strict";
import { MEBIBYTE, at } from "./profile-context.mjs";
const { layerBaseMemoryMiB } = await import("../../../src/engine-memory-model.ts");

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
  } = await import("../../../src/gpu-memory-audit.ts");

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
