import assert from "node:assert/strict";
import { MEBIBYTE, at } from "./profile-context.mjs";

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
  } = await import("../../../src/gpu-resource-registry.ts");

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
